//! Native-owned recovery snapshots; cache operations never open recorded paths.
use super::{EditorState, Revision, identifier, main_window};
use crate::{background_task_error, state_error};
use git_khronos_git_core::AppError;
use git_khronos_git_core::draft_recovery::{
    RecoveryDraftEntryKind, RecoveryDraftInspection, RecoveryDraftRecord, RecoveryDraftSummary,
};
use git_khronos_git_core::draft_recovery_editor::RecoveryDraftEditorReview;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

#[cfg(target_os = "linux")]
use super::EditorWriteResult;
#[cfg(target_os = "linux")]
use git_khronos_git_core::{
    WorkingFileEdit, draft_recovery_editor::WorkingFileRecoveryBinding,
    draft_recovery_store::RecoveryDraftStore,
};

#[derive(Default)]
pub struct RecoveryState {
    #[cfg(target_os = "linux")]
    store: std::sync::Mutex<Option<RecoveryDraftStore>>,
}

fn refused(message: &str) -> AppError {
    AppError {
        kind: "editorDraftRecoveryUnavailable".into(),
        message: message.into(),
        hint: Some(
            "Retain your editable text. Recovery storage does not replace a file save.".into(),
        ),
    }
}

#[cfg(not(target_os = "linux"))]
fn unsupported() -> AppError {
    refused("Private draft storage is not supported on this platform yet.")
}

#[cfg(target_os = "linux")]
fn with_store<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut RecoveryDraftStore) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<RecoveryState>();
    let mut store = state.store.lock().map_err(state_error)?;
    if store.is_none() {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|_| refused("The application-data location is unavailable."))?;
        std::fs::create_dir_all(&directory)
            .map_err(|_| refused("The application-data directory could not be created."))?;
        // libc is already declared by the native crate. The effective UID is
        // obtained from the OS, never from a renderer or directory owner.
        let uid = unsafe { libc::geteuid() };
        *store = Some(RecoveryDraftStore::open(
            &directory.join("editor-drafts-v1"),
            uid,
        )?);
    }
    action(
        store
            .as_mut()
            .ok_or_else(|| refused("Recovery storage is unavailable."))?,
    )
}

#[cfg(target_os = "linux")]
pub(super) struct Draft {
    id: String,
    binding: WorkingFileRecoveryBinding,
    last_attempt: Option<RecoveryDraftRecord>,
    last_committed: Option<RecoveryDraftRecord>,
    uncertain: bool,
    retired: bool,
}

#[cfg(target_os = "linux")]
impl Draft {
    pub(super) fn capture(edit: &WorkingFileEdit) -> Result<Self, AppError> {
        Ok(Self {
            id: identifier()?,
            binding: edit.recovery_binding()?,
            last_attempt: None,
            last_committed: None,
            uncertain: false,
            retired: false,
        })
    }
    fn next_epoch(&self) -> Result<Self, AppError> {
        Ok(Self {
            id: identifier()?,
            binding: self.binding.clone(),
            last_attempt: None,
            last_committed: None,
            uncertain: false,
            retired: false,
        })
    }
    fn persist(
        &mut self,
        store: &mut RecoveryDraftStore,
        revision: &str,
        sequence: u32,
        text: &str,
        timestamp: &str,
    ) -> Result<RecoveryDraftSummary, AppError> {
        if self.retired {
            return Err(refused(
                "This recovery context has been retired. Reload it before snapshotting.",
            ));
        }
        if self.uncertain {
            match store.load(&self.id)? {
                None => (),
                Some((record, false))
                    if self.binding.matches_record(&record)
                        && (self
                            .last_attempt
                            .as_ref()
                            .is_some_and(|attempt| record.same_contents(attempt))
                            || self
                                .last_committed
                                .as_ref()
                                .is_some_and(|committed| record.same_contents(committed))) =>
                {
                    self.last_committed = Some(record);
                }
                _ => {
                    return Err(refused(
                        "An unfinished or changed recovery snapshot needs review before replacement.",
                    ));
                }
            }
            // An absent attempt or a freshly read known committed copy can be
            // retried. Pending, corrupt and unknown copies remain protected by
            // both the checks above and the store's own replacement checks.
            self.uncertain = false;
        }
        if self.last_attempt.is_none() && store.load(&self.id)?.is_some() {
            return Err(refused(
                "This recovery identifier already exists. Its data was preserved.",
            ));
        }
        let record = self
            .binding
            .record(&self.id, revision, sequence, text, timestamp)?;
        if let Some(previous) = self.last_attempt.as_ref()
            && (sequence < previous.sequence
                || sequence == previous.sequence && !record.same_contents(previous))
        {
            return Err(refused(
                "An older or conflicting recovery snapshot was refused.",
            ));
        }
        // Retain attempted bytes even if persistence leaves a pending copy.
        self.last_attempt = Some(record);
        self.uncertain = true;
        let record = self
            .last_attempt
            .as_ref()
            .ok_or_else(|| refused("The snapshot is unavailable."))?;
        store.persist(record)?;
        self.last_committed = Some(record.clone());
        self.uncertain = false;
        Ok(record.summary(false))
    }
    fn clear(&mut self, store: &mut RecoveryDraftStore) -> Result<(), AppError> {
        // A failed cleanup must not let an old queued snapshot recreate data.
        self.retired = true;
        let Some(attempt) = self.last_attempt.as_ref() else {
            return Ok(());
        };
        if store.load(&self.id)?.is_none() {
            return Ok(());
        }
        let inspection = store.inspect()?;
        let entries = inspection
            .entries
            .into_iter()
            .filter(|entry| entry.id == self.id)
            .collect::<Vec<_>>();
        if entries.is_empty() {
            return Err(refused(
                "The draft could not be fully inspected for cleanup. Its copies were preserved.",
            ));
        }
        // Validate every copy before deleting any. The actual unlink performs
        // another exact-token check and never follows a stored working path.
        let mut reviewed = Vec::new();
        for entry in entries {
            let token = entry.review_token.ok_or_else(|| {
                refused("A recovery copy could not be safely reviewed for cleanup.")
            })?;
            let record = store.load_reviewed_entry(&self.id, entry.kind, &token)?;
            let known = record.same_contents(attempt)
                || self
                    .last_committed
                    .as_ref()
                    .is_some_and(|committed| record.same_contents(committed));
            if !known || !self.binding.matches_record(&record) || record.sequence > attempt.sequence
            {
                return Err(refused(
                    "A recovery copy has changed ownership or sequence. It was preserved.",
                ));
            }
            reviewed.push((entry.kind, token));
        }
        for (kind, token) in reviewed {
            store.discard_reviewed_entry(&self.id, kind, &token)?;
        }
        self.last_attempt = None;
        self.last_committed = None;
        self.uncertain = false;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn warning(result: &mut EditorWriteResult, message: &str) {
    let previous = result.warning.take();
    result.warning = Some(previous.map_or_else(
        || message.into(),
        |previous| format!("{previous} {message}"),
    ));
}

#[cfg(target_os = "linux")]
pub(super) fn after_save(value: &mut Revision, result: &mut EditorWriteResult, app: &AppHandle) {
    finish_save(value, result, |draft| {
        with_store(app, |store| draft.clear(store))
    });
}

#[cfg(target_os = "linux")]
fn finish_save(
    value: &mut Revision,
    result: &mut EditorWriteResult,
    cleanup: impl FnOnce(&mut Draft) -> Result<(), AppError>,
) {
    if result.disk == git_khronos_git_core::WorkingFileWriteStatus::Unconfirmed {
        return;
    }
    let Some(current) = value.edit.as_ref() else {
        warning(
            result,
            "The current file needs a fresh review; recovery cleanup was not attempted.",
        );
        return;
    };
    let next = Draft::capture(current);
    let saved_text = super::textarea_text(current.text().text());
    if let Some(Ok(mut previous)) = value.recovery.take() {
        if previous
            .last_attempt
            .as_ref()
            .is_some_and(|record| record.text != saved_text)
        {
            warning(
                result,
                "The file save succeeded; a different recovery draft was retained for review.",
            );
        } else if previous.last_attempt.is_some()
            && let Err(error) = cleanup(&mut previous)
        {
            warning(
                result,
                &format!(
                    "The file save succeeded, but recovery cleanup was not confirmed: {}",
                    error.message
                ),
            );
        }
    }
    if let Err(error) = next.as_ref() {
        warning(
            result,
            &format!(
                "The file save succeeded, but new recovery snapshots are unavailable: {}",
                error.message
            ),
        );
    }
    value.recovery = Some(next);
}

#[cfg(target_os = "linux")]
fn timestamp() -> Result<String, AppError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis().to_string())
        .map_err(|_| refused("The snapshot clock is unavailable."))
}

fn ensure_context(
    editor: &super::Editor,
    value: &Revision,
    revision: &str,
) -> Result<(), AppError> {
    if editor.closed.load(std::sync::atomic::Ordering::Acquire) || value.id != revision {
        return Err(super::unavailable());
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn snapshot_editor_draft(
    editor_id: String,
    revision: String,
    sequence: u32,
    text: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<RecoveryDraftSummary, AppError> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            let editor = app.state::<EditorState>().get(&editor_id)?;
            let mut value = editor.value.lock().map_err(state_error)?;
            ensure_context(&editor, &value, &revision)?;
            let draft = value
                .recovery
                .as_mut()
                .ok_or_else(super::unavailable)?
                .as_mut()
                .map_err(|error| error.clone())?;
            let result = with_store(&app, |store| {
                if editor.closed.load(std::sync::atomic::Ordering::Acquire) {
                    return Err(super::unavailable());
                }
                draft.persist(store, &revision, sequence, &text, &timestamp()?)
            });
            // Even storage refusal must preserve an active data-only context.
            *editor.recovery_activity.lock().map_err(state_error)? =
                Some(std::time::Instant::now());
            result
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (editor_id, revision, sequence, text, app);
            Err(unsupported())
        }
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_editor_drafts(
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<RecoveryDraftInspection, AppError> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            with_store(&app, |store| store.inspect())
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = app;
            Err(unsupported())
        }
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_editor_draft_entry(
    id: String,
    kind: RecoveryDraftEntryKind,
    review_token: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<RecoveryDraftRecord, AppError> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            with_store(&app, |store| {
                store.load_reviewed_entry(&id, kind, &review_token)
            })
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (id, kind, review_token, app);
            Err(unsupported())
        }
    })
    .await
    .map_err(background_task_error)?
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorDraftReview {
    editor_id: String,
    revision: String,
    draft: RecoveryDraftRecord,
    comparison: RecoveryDraftEditorReview,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorDraftReviewRequest {
    editor_id: String,
    revision: String,
    id: String,
    kind: RecoveryDraftEntryKind,
    review_token: String,
    operation_id: String,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn review_editor_draft(
    request: EditorDraftReviewRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<EditorDraftReview, AppError> {
    main_window(&window)?;
    let EditorDraftReviewRequest {
        editor_id,
        revision,
        id,
        kind,
        review_token,
        operation_id,
    } = request;
    #[cfg(target_os = "linux")]
    let (token, operation) = crate::register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            let _operation = operation;
            let editor = app.state::<EditorState>().get(&editor_id)?;
            let session =
                crate::repository_session(&editor.repository, &app.state::<crate::AppState>())?;
            let _repository = session.operation.lock().map_err(state_error)?;
            let value = editor.value.lock().map_err(state_error)?;
            ensure_context(&editor, &value, &revision)?;
            let current = value.edit.as_ref().ok_or_else(super::unavailable)?;
            let draft = with_store(&app, |store| {
                store.load_reviewed_entry(&id, kind, &review_token)
            })?;
            let comparison =
                session.with_read_policy(|| draft.review_with_editor(current, &token))?;
            Ok(EditorDraftReview {
                editor_id,
                revision,
                draft,
                comparison,
            })
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (
                editor_id,
                revision,
                id,
                kind,
                review_token,
                operation_id,
                app,
            );
            Err(unsupported())
        }
    })
    .await
    .map_err(background_task_error)?
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorDraftDiscarded {
    editor_id: String,
    revision: String,
}

#[cfg(any(test, not(target_os = "linux")))]
fn discard_volatile(
    editor: &super::Editor,
    value: &mut Revision,
    revision: &str,
) -> Result<String, AppError> {
    ensure_context(editor, value, revision)?;
    // Unsupported platforms cannot create persisted copies. Retire the local
    // revision without making ordinary draft discard depend on storage support.
    let next_revision = identifier()?;
    value.id = next_revision.clone();
    Ok(next_revision)
}

#[cfg(target_os = "linux")]
fn discard_owned(
    value: &mut Revision,
    cleanup: impl FnOnce(&mut Draft) -> Result<(), AppError>,
) -> Result<String, AppError> {
    let next_revision = identifier()?;
    if let Some(Ok(draft)) = value.recovery.as_mut() {
        let next = draft.next_epoch()?;
        // Retire before acquiring storage too: a failed store open/lock must
        // not permit a previously queued snapshot to revive this epoch.
        draft.retired = true;
        if draft.last_attempt.is_some() {
            cleanup(draft)?;
        }
        value.recovery = Some(Ok(next));
    }
    // A failed initial metadata capture cannot own a persisted snapshot. It
    // must not trap editable text, but old file/snapshot revisions still retire.
    value.id = next_revision.clone();
    Ok(next_revision)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn discard_editor_draft(
    editor_id: String,
    revision: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<EditorDraftDiscarded, AppError> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            let editor = app.state::<EditorState>().get_for_cleanup(&editor_id)?;
            let mut value = editor.value.lock().map_err(state_error)?;
            ensure_context(&editor, &value, &revision)?;
            // Allocate the new epoch before deleting anything. A late request
            // carrying the old revision is refused under this same value lock.
            let next_revision = discard_owned(&mut value, |draft| {
                with_store(&app, |store| draft.clear(store))
            })?;
            Ok(EditorDraftDiscarded {
                editor_id,
                revision: next_revision,
            })
        }
        #[cfg(not(target_os = "linux"))]
        {
            let editor = app.state::<EditorState>().get_for_cleanup(&editor_id)?;
            let mut value = editor.value.lock().map_err(state_error)?;
            let next_revision = discard_volatile(&editor, &mut value, &revision)?;
            Ok(EditorDraftDiscarded {
                editor_id,
                revision: next_revision,
            })
        }
    })
    .await
    .map_err(background_task_error)?
}

#[cfg(target_os = "linux")]
fn active_draft(state: &EditorState, id: &str) -> Result<bool, AppError> {
    let editors = {
        let mut entries = state.0.lock().map_err(state_error)?;
        EditorState::prune(&mut entries);
        entries.values().cloned().collect::<Vec<_>>()
    };
    for editor in editors {
        let value = editor.value.lock().map_err(state_error)?;
        if let Some(Ok(draft)) = value.recovery.as_ref()
            && !draft.retired
            && draft.id == id
            && !editor.closed.load(std::sync::atomic::Ordering::Acquire)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn discard_editor_draft_entry(
    id: String,
    kind: RecoveryDraftEntryKind,
    review_token: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<(), AppError> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            if active_draft(&app.state::<EditorState>(), &id)? {
                return Err(refused(
                    "This draft belongs to an open editor. Discard it through that editor first.",
                ));
            }
            with_store(&app, |store| {
                store.discard_reviewed_entry(&id, kind, &review_token)
            })
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (id, kind, review_token, app);
            Err(unsupported())
        }
    })
    .await
    .map_err(background_task_error)?
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::working_file_commands::{WriteAction, apply_write, tests::Fixture};
    use git_khronos_git_core::{CancellationToken, WorkingFileWriteStatus};
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn native_recovery_expired_save_keeps_owned_binding_available_for_explicit_cleanup() {
        let fixture = Fixture::new(b"original\n");
        let index = fixture.index();
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let old_revision = value.id.clone();
        let id = draft(&mut value).id.clone();
        draft(&mut value)
            .persist(&mut store, &old_revision, 1, "retained\n", "1")
            .unwrap();
        let mut editor = crate::working_file_commands::tests::editor();
        std::sync::Arc::get_mut(&mut editor).unwrap().created =
            std::time::Instant::now() - crate::working_file_commands::LIFETIME;
        *editor.value.lock().unwrap() = value;
        let state = EditorState::default();
        state
            .insert("expired-editor".into(), editor.clone())
            .unwrap();
        assert!(state.get("expired-editor").is_err());
        let cleanup = state.get_for_cleanup("expired-editor").unwrap();
        assert!(std::sync::Arc::ptr_eq(&editor, &cleanup));
        assert!(cleanup.activate(&CancellationToken::default()).is_err());
        {
            let mut value = cleanup.value.lock().unwrap();
            ensure_context(&cleanup, &value, &old_revision).unwrap();
            discard_owned(&mut value, |draft| draft.clear(&mut store)).unwrap();
            assert!(ensure_context(&cleanup, &value, &old_revision).is_err());
        }
        assert!(store.load(&id).unwrap().is_none());
        assert_eq!(fixture.disk(), b"original\n");
        assert_eq!(fixture.index(), index);
        assert!(state.close("expired-editor").unwrap());
        assert!(state.get_for_cleanup("expired-editor").is_err());
    }

    #[test]
    fn native_recovery_unsupported_storage_allows_volatile_discard_but_retires_old_revision() {
        let fixture = Fixture::new(b"original\n");
        let editor = crate::working_file_commands::tests::editor();
        let mut value = fixture.revision();
        let old_revision = value.id.clone();
        let index = fixture.index();
        let next_revision = discard_volatile(&editor, &mut value, &old_revision).unwrap();
        assert_ne!(next_revision, old_revision);
        assert_eq!(value.id, next_revision);
        assert!(ensure_context(&editor, &value, &old_revision).is_err());
        assert!(discard_volatile(&editor, &mut value, &old_revision).is_err());
        editor
            .closed
            .store(true, std::sync::atomic::Ordering::Release);
        assert!(discard_volatile(&editor, &mut value, &next_revision).is_err());
        assert_eq!(value.id, next_revision);
        assert_eq!(fixture.disk(), b"original\n");
        assert_eq!(fixture.index(), index);
    }

    struct Cache(std::path::PathBuf);
    impl Cache {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("owned-native-recovery-{}", identifier().unwrap()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn open(&self) -> RecoveryDraftStore {
            RecoveryDraftStore::open(&self.0.join("drafts"), unsafe { libc::geteuid() }).unwrap()
        }
        fn entry(&self, id: &str, suffix: &str) -> std::path::PathBuf {
            self.0.join("drafts").join(format!("{id}.{suffix}"))
        }
        fn put(&self, id: &str, suffix: &str, bytes: &[u8]) {
            let path = self.entry(id, suffix);
            std::fs::write(&path, bytes).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
    }
    impl Drop for Cache {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn revision(fixture: &Fixture) -> Revision {
        let mut value = fixture.revision();
        value.id = "b".repeat(32);
        value.recovery = Some(Draft::capture(value.edit.as_ref().unwrap()));
        value
    }
    fn draft(value: &mut Revision) -> &mut Draft {
        value.recovery.as_mut().unwrap().as_mut().ok().unwrap()
    }
    #[test]
    fn native_recovery_snapshots_restart_without_mutating_working_file_index_refs_or_config() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let revision = value.id.clone();
        let refs = fixture.git(&["show-ref"]);
        let config = std::fs::read(fixture.0.join(".git/config")).unwrap();
        let summary = draft(&mut value)
            .persist(&mut store, &revision, 1, "unsaved é\n", "1")
            .unwrap();
        drop(store);
        let reopened = cache.open();
        let retained = reopened.load(&summary.id).unwrap().unwrap().0;
        assert_eq!(retained.text, "unsaved é\n");
        assert!(
            value
                .edit
                .as_ref()
                .unwrap()
                .recovery_binding()
                .unwrap()
                .matches_record(&retained)
        );
        assert_eq!(fixture.disk(), b"original\n");
        assert_eq!(fixture.index(), b"original\n");
        assert_eq!(fixture.git(&["show-ref"]), refs);
        assert_eq!(
            std::fs::read(fixture.0.join(".git/config")).unwrap(),
            config
        );
    }
    #[test]
    fn native_recovery_sequences_refuse_out_of_order_and_conflicting_buffers() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let revision = value.id.clone();
        let draft = draft(&mut value);
        draft.persist(&mut store, &revision, 1, "one", "1").unwrap();
        draft.persist(&mut store, &revision, 1, "one", "2").unwrap();
        assert!(
            draft
                .persist(&mut store, &revision, 1, "conflict", "3")
                .is_err()
        );
        assert!(
            draft
                .persist(&mut store, &revision, 0, "older", "3")
                .is_err()
        );
        draft.persist(&mut store, &revision, 2, "two", "4").unwrap();
        assert_eq!(store.load(&draft.id).unwrap().unwrap().0.text, "two");
        assert_eq!(fixture.disk(), b"original\n");
    }
    #[test]
    fn native_recovery_retry_reconciles_absent_or_known_commits_and_preserves_foreign_data() {
        for phase in ["absent", "known", "foreign"] {
            let fixture = Fixture::new(b"original\n");
            let cache = Cache::new();
            let mut store = cache.open();
            let mut value = revision(&fixture);
            let revision = value.id.clone();
            let draft = draft(&mut value);
            if phase == "absent" {
                let blocker = cache.0.join("drafts/unrecognized-owned-fixture");
                std::fs::write(&blocker, b"owned transient blocker").unwrap();
                assert!(
                    draft
                        .persist(&mut store, &revision, 1, "first attempt", "1")
                        .is_err()
                );
                assert!(draft.uncertain);
                assert!(!cache.entry(&draft.id, "json").exists());
                assert!(!cache.entry(&draft.id, "next").exists());
                std::fs::remove_file(blocker).unwrap();
            } else {
                draft
                    .persist(&mut store, &revision, 1, "first commit", "1")
                    .unwrap();
                let attempt = draft
                    .binding
                    .record(&draft.id, &revision, 2, "known second commit", "2")
                    .unwrap();
                let mut stored = attempt.clone();
                if phase == "foreign" {
                    stored.text = "foreign changed text".into();
                }
                cache.put(&draft.id, "json", &serde_json::to_vec(&stored).unwrap());
                draft.last_attempt = Some(attempt);
                draft.uncertain = true;
            }
            let retry = draft.persist(&mut store, &revision, 3, "latest retained text", "3");
            if phase == "foreign" {
                assert!(retry.is_err());
                assert_eq!(
                    store.load(&draft.id).unwrap().unwrap().0.text,
                    "foreign changed text"
                );
            } else {
                retry.unwrap();
                assert_eq!(
                    store.load(&draft.id).unwrap().unwrap().0.text,
                    "latest retained text"
                );
                assert!(!draft.uncertain);
            }
            assert_eq!(fixture.disk(), b"original\n");
            assert_eq!(fixture.index(), b"original\n");
        }
    }
    #[test]
    fn native_recovery_pending_failure_preserves_both_known_copies_until_explicit_cleanup() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let revision = value.id.clone();
        let draft = draft(&mut value);
        draft.persist(&mut store, &revision, 1, "one", "1").unwrap();
        let pending = draft
            .binding
            .record(&draft.id, &revision, 2, "two", "2")
            .unwrap();
        cache.put(&draft.id, "next", &serde_json::to_vec(&pending).unwrap());
        assert!(draft.persist(&mut store, &revision, 2, "two", "2").is_err());
        assert!(
            draft
                .persist(&mut store, &revision, 3, "three", "3")
                .is_err()
        );
        assert_eq!(
            store
                .load_reviewed_entry(
                    &draft.id,
                    RecoveryDraftEntryKind::Pending,
                    store
                        .inspect()
                        .unwrap()
                        .entries
                        .iter()
                        .find(|entry| entry.kind == RecoveryDraftEntryKind::Pending)
                        .unwrap()
                        .review_token
                        .as_deref()
                        .unwrap()
                )
                .unwrap()
                .text,
            "two"
        );
        draft.clear(&mut store).unwrap();
        assert!(store.load(&draft.id).unwrap().is_none());
        assert!(
            draft
                .persist(&mut store, &revision, 3, "late", "3")
                .is_err()
        );
    }
    #[test]
    fn native_recovery_corrupt_pending_refuses_cleanup_and_retired_context_cannot_recreate_it() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let revision = value.id.clone();
        let draft = draft(&mut value);
        draft.persist(&mut store, &revision, 1, "one", "1").unwrap();
        let committed = std::fs::read(cache.entry(&draft.id, "json")).unwrap();
        cache.put(&draft.id, "next", b"{unfinished");
        assert!(draft.clear(&mut store).is_err());
        assert_eq!(
            std::fs::read(cache.entry(&draft.id, "json")).unwrap(),
            committed
        );
        assert_eq!(
            std::fs::read(cache.entry(&draft.id, "next")).unwrap(),
            b"{unfinished"
        );
        assert!(
            draft
                .persist(&mut store, &revision, 2, "late", "2")
                .is_err()
        );
        let inspection = store.inspect().unwrap();
        let pending = inspection
            .entries
            .iter()
            .find(|entry| entry.kind == RecoveryDraftEntryKind::Pending)
            .unwrap();
        store
            .discard_reviewed_entry(
                &draft.id,
                pending.kind,
                pending.review_token.as_deref().unwrap(),
            )
            .unwrap();
        draft.clear(&mut store).unwrap();
        assert!(store.inspect().unwrap().entries.is_empty());
    }
    #[test]
    fn native_recovery_foreign_changed_text_is_preserved_even_with_matching_metadata_and_sequence()
    {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let revision = value.id.clone();
        let draft = draft(&mut value);
        draft
            .persist(&mut store, &revision, 1, "owned", "1")
            .unwrap();
        let mut foreign = draft.last_attempt.clone().unwrap();
        foreign.text = "foreign changed text".into();
        let bytes = serde_json::to_vec(&foreign).unwrap();
        cache.put(&draft.id, "json", &bytes);
        assert!(draft.clear(&mut store).is_err());
        assert_eq!(
            std::fs::read(cache.entry(&draft.id, "json")).unwrap(),
            bytes
        );
    }
    #[test]
    fn native_recovery_confirmed_save_rotates_epoch_and_keeps_cleanup_failure_separate() {
        for corrupt in [false, true] {
            let fixture = Fixture::new(b"original\n");
            let cache = Cache::new();
            let mut store = cache.open();
            let mut value = revision(&fixture);
            let reviewed = value.id.clone();
            let old_id = draft(&mut value).id.clone();
            draft(&mut value)
                .persist(&mut store, &reviewed, 1, "saved\n", "1")
                .unwrap();
            if corrupt {
                cache.put(&old_id, "next", b"{unfinished");
            }
            let mut result = apply_write(
                &mut value,
                "editor",
                &reviewed,
                WriteAction {
                    text: Some("saved\n".into()),
                    stage: false,
                },
                &CancellationToken::default(),
                |_| panic!("save-only must not stage"),
            )
            .unwrap();
            finish_save(&mut value, &mut result, |draft| draft.clear(&mut store));
            assert_eq!(result.disk, WorkingFileWriteStatus::Saved);
            assert_eq!(fixture.disk(), b"saved\n");
            assert_eq!(fixture.index(), b"original\n");
            assert_ne!(draft(&mut value).id, old_id);
            if corrupt {
                assert!(
                    result
                        .warning
                        .unwrap()
                        .contains("recovery cleanup was not confirmed")
                );
                assert!(
                    cache.entry(&old_id, "json").exists() && cache.entry(&old_id, "next").exists()
                );
            } else {
                assert!(store.load(&old_id).unwrap().is_none());
            }
            let current_revision = value.id.clone();
            draft(&mut value)
                .persist(&mut store, &current_revision, 1, "new draft\n", "2")
                .unwrap();
            let retained = store.load(&draft(&mut value).id).unwrap().unwrap().0;
            assert!(
                value
                    .edit
                    .as_ref()
                    .unwrap()
                    .recovery_binding()
                    .unwrap()
                    .matches_record(&retained)
            );
        }
    }
    #[test]
    fn native_recovery_retains_snapshot_binding_when_stage_invalidates_file_write_authority() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let reviewed = value.id.clone();
        draft(&mut value)
            .persist(&mut store, &reviewed, 1, "unsaved\n", "1")
            .unwrap();
        let original = draft(&mut value).last_attempt.clone().unwrap();
        let result = apply_write(
            &mut value,
            "editor",
            &reviewed,
            WriteAction {
                text: None,
                stage: true,
            },
            &CancellationToken::default(),
            |_| {
                std::fs::write(fixture.0.join("literal [file].txt"), b"external\n").unwrap();
                Err(refused("Owned stage refusal"))
            },
        )
        .unwrap();
        assert!(result.file.is_none() && value.edit.is_none());
        let current_revision = value.id.clone();
        let summary = draft(&mut value)
            .persist(&mut store, &current_revision, 2, "still unsaved\n", "2")
            .unwrap();
        let retained = store.load(&summary.id).unwrap().unwrap().0;
        assert_eq!(retained.baseline_sha256, original.baseline_sha256);
        assert_eq!(retained.git_context, original.git_context);
        assert_eq!(retained.text, "still unsaved\n");
        assert_eq!(fixture.disk(), b"external\n");
        assert_eq!(fixture.index(), b"original\n");
    }
    #[test]
    fn native_recovery_discard_rotates_revision_and_refuses_late_snapshots_for_the_old_context() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let reviewed = value.id.clone();
        let old_id = draft(&mut value).id.clone();
        draft(&mut value)
            .persist(&mut store, &reviewed, 1, "unsaved\n", "1")
            .unwrap();
        let editor = crate::working_file_commands::tests::editor();
        ensure_context(&editor, &value, &reviewed).unwrap();
        let next = discard_owned(&mut value, |draft| draft.clear(&mut store)).unwrap();
        assert_ne!(next, reviewed);
        assert!(ensure_context(&editor, &value, &reviewed).is_err());
        assert!(store.load(&old_id).unwrap().is_none());
        assert_ne!(draft(&mut value).id, old_id);
        let current = value.id.clone();
        draft(&mut value)
            .persist(&mut store, &current, 1, "retained after store refusal", "2")
            .unwrap();
        assert!(
            discard_owned(&mut value, |_| Err(refused(
                "Owned store acquisition refusal"
            )))
            .is_err()
        );
        assert!(draft(&mut value).retired);
        assert!(
            draft(&mut value)
                .persist(&mut store, &current, 2, "late queued text", "3")
                .is_err()
        );
        assert_eq!(
            store.load(&draft(&mut value).id).unwrap().unwrap().0.text,
            "retained after store refusal"
        );
        discard_owned(&mut value, |draft| draft.clear(&mut store)).unwrap();
        let prior = value.id.clone();
        value.recovery = Some(Err(refused("Owned metadata-capture failure")));
        let next = discard_owned(&mut value, |_| {
            panic!("an uncaptured binding cannot own cache data")
        })
        .unwrap();
        assert_ne!(next, prior);
        assert!(ensure_context(&editor, &value, &prior).is_err());
        assert_eq!(fixture.disk(), b"original\n");
        assert_eq!(fixture.index(), b"original\n");
    }
    #[test]
    fn native_recovery_save_preserves_a_different_buffer_and_existing_warnings() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let reviewed = value.id.clone();
        let old_id = draft(&mut value).id.clone();
        draft(&mut value)
            .persist(&mut store, &reviewed, 1, "newer unsaved buffer\n", "1")
            .unwrap();
        let mut result = apply_write(
            &mut value,
            "editor",
            &reviewed,
            WriteAction {
                text: Some("older submitted text\n".into()),
                stage: false,
            },
            &CancellationToken::default(),
            |_| panic!("save-only must not stage"),
        )
        .unwrap();
        result.warning = Some("Owned existing write warning.".into());
        finish_save(&mut value, &mut result, |_| {
            panic!("a different buffer must not be cleared")
        });
        assert_eq!(result.disk, WorkingFileWriteStatus::Saved);
        assert_eq!(fixture.disk(), b"older submitted text\n");
        assert_eq!(fixture.index(), b"original\n");
        assert_eq!(
            store.load(&old_id).unwrap().unwrap().0.text,
            "newer unsaved buffer\n"
        );
        let warning = result.warning.unwrap();
        assert!(warning.contains("Owned existing write warning."));
        assert!(warning.contains("different recovery draft was retained"));
        assert_ne!(draft(&mut value).id, old_id);
    }
    #[test]
    fn native_recovery_uncertain_save_preserves_the_original_snapshot_without_cleanup() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let reviewed = value.id.clone();
        let old_id = draft(&mut value).id.clone();
        draft(&mut value)
            .persist(&mut store, &reviewed, 1, "retained\n", "1")
            .unwrap();
        let mut result = EditorWriteResult {
            editor_id: "editor".into(),
            revision: reviewed.clone(),
            file: None,
            disk: WorkingFileWriteStatus::Unconfirmed,
            stage: super::super::EditorStage::NotRequested,
            stage_error: None,
            warning: Some("Owned unconfirmed-save warning".into()),
        };
        finish_save(&mut value, &mut result, |_| {
            panic!("an uncertain save must not clear recovery")
        });
        assert_eq!(draft(&mut value).id, old_id);
        assert_eq!(store.load(&old_id).unwrap().unwrap().0.text, "retained\n");
        assert_eq!(
            result.warning.as_deref(),
            Some("Owned unconfirmed-save warning")
        );
        assert_eq!(fixture.disk(), b"original\n");
    }
    #[test]
    fn native_recovery_live_entries_require_editor_discard_before_individual_cleanup() {
        let fixture = Fixture::new(b"original\n");
        let cache = Cache::new();
        let mut store = cache.open();
        let mut value = revision(&fixture);
        let reviewed = value.id.clone();
        let id = draft(&mut value).id.clone();
        draft(&mut value)
            .persist(&mut store, &reviewed, 1, "retained\n", "1")
            .unwrap();
        cache.put(&id, "next", b"{unfinished");
        let state = EditorState::default();
        let editor = crate::working_file_commands::tests::editor();
        *editor.value.lock().unwrap() = value;
        state.insert("editor".into(), editor.clone()).unwrap();
        assert!(active_draft(&state, &id).unwrap());
        {
            let mut value = editor.value.lock().unwrap();
            assert!(discard_owned(&mut value, |draft| draft.clear(&mut store)).is_err());
        }
        assert!(!active_draft(&state, &id).unwrap());
        let inspection = store.inspect().unwrap();
        let pending = inspection
            .entries
            .iter()
            .find(|entry| entry.kind == RecoveryDraftEntryKind::Pending)
            .unwrap();
        store
            .discard_reviewed_entry(&id, pending.kind, pending.review_token.as_deref().unwrap())
            .unwrap();
        assert_eq!(store.load(&id).unwrap().unwrap().0.text, "retained\n");
        assert!(state.close("editor").unwrap());
    }
}
