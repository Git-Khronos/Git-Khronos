//! Ephemeral, versioned editor contexts. The frontend never supplies a disk fingerprint.
use crate::{
    AppState, authentication, background_task_error, register_active_operation, repository_session,
    state_error,
};
use git_khronos_git_core::{
    AppError, CancellationToken, WorkingFileEdit, WorkingFileWriteStatus, WorkingTextEncoding,
    open_working_file_edit, stage_path,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const CAPACITY: usize = 8;
const LIFETIME: Duration = Duration::from_secs(15 * 60);
#[derive(Default)]
pub struct EditorState(Mutex<HashMap<String, Arc<Editor>>>);
struct Editor {
    repository: String,
    created: Instant,
    closed: AtomicBool,
    active: Mutex<Option<CancellationToken>>,
    value: Mutex<Revision>,
}
struct Revision {
    id: String,
    edit: Option<WorkingFileEdit>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LineEndings {
    None,
    Lf,
    CrLf,
    Cr,
    Mixed,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorSnapshot {
    editor_id: String,
    revision: String,
    path: String,
    text: String,
    encoding: WorkingTextEncoding,
    bom: bool,
    encoded_byte_len: String,
    line_endings: LineEndings,
    read_only_reason: Option<String>,
    working_reference: Option<String>,
    head_oid: Option<String>,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum EditorStage {
    NotRequested,
    Staged,
    Unconfirmed,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorWriteResult {
    editor_id: String,
    revision: String,
    file: Option<EditorSnapshot>,
    disk: WorkingFileWriteStatus,
    stage: EditorStage,
    stage_error: Option<AppError>,
    warning: Option<String>,
}
fn unavailable() -> AppError {
    AppError {
        kind: "workingFileEditorExpired".into(),
        message: "This editor context is unavailable or has already been used.".into(),
        hint: Some(
            "Retain your draft, then reload the working file before saving or staging.".into(),
        ),
    }
}
fn identifier() -> Result<String, AppError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| AppError {
        kind: "workingFileEditorUnavailable".into(),
        message: "A private editor context could not be created.".into(),
        hint: None,
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn check(token: &CancellationToken) -> Result<(), AppError> {
    if token.is_cancelled() {
        Err(unavailable())
    } else {
        Ok(())
    }
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), AppError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(unavailable())
    }
}
impl Editor {
    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(active) = self.active.lock()
            && let Some(token) = active.as_ref()
        {
            token.cancel();
        }
    }
    fn live(&self) -> bool {
        !self.closed.load(Ordering::Acquire) && self.created.elapsed() < LIFETIME
    }
    fn activate(&self, token: &CancellationToken) -> Result<ActiveEdit<'_>, AppError> {
        let mut active = self.active.lock().map_err(state_error)?;
        if !self.live() {
            return Err(unavailable());
        }
        if active.is_some() {
            return Err(unavailable());
        }
        *active = Some(token.clone());
        if self.closed.load(Ordering::Acquire) {
            token.cancel();
        }
        drop(active);
        let guard = ActiveEdit(self);
        check(token)?;
        Ok(guard)
    }
}
struct ActiveEdit<'a>(&'a Editor);
impl Drop for ActiveEdit<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.active.lock() {
            *active = None;
        }
    }
}
impl EditorState {
    fn prune(entries: &mut HashMap<String, Arc<Editor>>) {
        entries.retain(|_, editor| {
            if editor.live() {
                true
            } else {
                editor.close();
                false
            }
        });
    }
    fn insert(&self, id: String, editor: Arc<Editor>) -> Result<(), AppError> {
        let mut entries = self.0.lock().map_err(state_error)?;
        Self::prune(&mut entries);
        if entries.len() >= CAPACITY || entries.contains_key(&id) {
            return Err(AppError {
                kind: "workingFileEditorCapacity".into(),
                message: "Close an existing editor before opening another file.".into(),
                hint: None,
            });
        }
        entries.insert(id, editor);
        Ok(())
    }
    fn get(&self, id: &str) -> Result<Arc<Editor>, AppError> {
        let mut entries = self.0.lock().map_err(state_error)?;
        Self::prune(&mut entries);
        entries.get(id).cloned().ok_or_else(unavailable)
    }
    fn close(&self, id: &str) -> Result<bool, AppError> {
        let editor = self.0.lock().map_err(state_error)?.remove(id);
        if let Some(editor) = editor {
            editor.close();
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
fn line_endings(text: &str) -> LineEndings {
    let mut kinds = 0;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\r' if chars.peek() == Some(&'\n') => {
                chars.next();
                kinds |= 2;
            }
            '\r' => kinds |= 4,
            '\n' => kinds |= 1,
            _ => {}
        }
    }
    match kinds {
        0 => LineEndings::None,
        1 => LineEndings::Lf,
        2 => LineEndings::CrLf,
        4 => LineEndings::Cr,
        _ => LineEndings::Mixed,
    }
}
fn textarea_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}
fn replacement(text: &str, original: &WorkingFileEdit) -> Result<String, AppError> {
    // Bound IPC text before normalization can allocate a second buffer.
    if text.len() > 3 * git_khronos_git_core::MAX_WORKING_TEXT_BYTES {
        return Err(unavailable());
    }
    let endings = line_endings(original.text().text());
    if endings == LineEndings::Mixed {
        return Err(AppError {
            kind: "workingFileMixedNewlines".into(),
            message: "This file uses mixed line endings and is read-only in this editor.".into(),
            hint: Some(
                "Use an external editor to preserve or explicitly convert its line endings.".into(),
            ),
        });
    }
    let normalized = textarea_text(text);
    Ok(match endings {
        LineEndings::CrLf => normalized.replace('\n', "\r\n"),
        LineEndings::Cr => normalized.replace('\n', "\r"),
        _ => normalized,
    })
}
fn snapshot(id: &str, revision: &str, edit: &WorkingFileEdit) -> EditorSnapshot {
    let endings = line_endings(edit.text().text());
    EditorSnapshot {
        editor_id: id.into(),
        revision: revision.into(),
        path: edit.path().into(),
        text: textarea_text(edit.text().text()),
        encoding: edit.text().encoding(),
        bom: edit.text().has_bom(),
        encoded_byte_len: edit.encoded_byte_len().to_string(),
        line_endings: endings,
        read_only_reason: edit.read_only_reason().map(str::to_owned).or_else(|| {
            (endings == LineEndings::Mixed)
                .then(|| "Mixed line endings require an external editor.".into())
        }),
        working_reference: edit.working_reference().map(str::to_owned),
        head_oid: edit.head_oid().map(str::to_owned),
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn open_working_file_editor(
    repo_id: String,
    path: String,
    encoding: Option<WorkingTextEncoding>,
    operation_id: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<EditorSnapshot, AppError> {
    main_window(&window)?;
    let (token, operation) = register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let session = repository_session(&repo_id, &app.state::<AppState>())?;
        let _repository = session.operation.lock().map_err(state_error)?;
        let edit = session
            .with_read_policy(|| open_working_file_edit(&session.path, &path, encoding, &token))?;
        check(&token)?;
        let id = identifier()?;
        let revision = identifier()?;
        let result = snapshot(&id, &revision, &edit);
        let state = app.state::<EditorState>();
        state.insert(
            id.clone(),
            Arc::new(Editor {
                repository: repo_id,
                created: Instant::now(),
                closed: AtomicBool::new(false),
                active: Mutex::new(None),
                value: Mutex::new(Revision {
                    id: revision,
                    edit: Some(edit),
                }),
            }),
        )?;
        if token.is_cancelled() {
            state.close(&id)?;
            return Err(unavailable());
        }
        Ok(result)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn save_working_file_editor(
    editor_id: String,
    revision: String,
    text: String,
    stage: bool,
    operation_id: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<EditorWriteResult, AppError> {
    main_window(&window)?;
    write(editor_id, revision, Some(text), stage, operation_id, app).await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn stage_saved_working_file_editor(
    editor_id: String,
    revision: String,
    operation_id: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<EditorWriteResult, AppError> {
    main_window(&window)?;
    // No draft parameter: this operation stages only the verified saved file.
    write(editor_id, revision, None, true, operation_id, app).await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn close_working_file_editor(
    editor_id: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, EditorState>,
) -> Result<bool, AppError> {
    main_window(&window)?;
    state.close(&editor_id)
}
async fn write(
    editor_id: String,
    revision: String,
    text: Option<String>,
    stage: bool,
    operation_id: String,
    app: AppHandle,
) -> Result<EditorWriteResult, AppError> {
    let editor = app.state::<EditorState>().get(&editor_id)?;
    let (token, operation) = register_active_operation(&app, operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let session = repository_session(&editor.repository, &app.state::<AppState>())?;
        let _repository = session.operation.lock().map_err(state_error)?;
        let _active = editor.activate(&token)?;
        let mut value = editor.value.lock().map_err(state_error)?;
        session.with_read_policy(|| {
            apply_write(
                &mut value,
                &editor_id,
                &revision,
                WriteAction { text, stage },
                &token,
                |current| {
                    authentication::run(
                        &app,
                        &operation_id,
                        Some(&editor.repository),
                        &token,
                        true,
                        || stage_path(&session.path, current.path()),
                    )
                },
            )
        })
    })
    .await
    .map_err(background_task_error)?
}

struct WriteAction {
    text: Option<String>,
    stage: bool,
}
fn apply_write(
    value: &mut Revision,
    editor_id: &str,
    revision: &str,
    action: WriteAction,
    token: &CancellationToken,
    stage_file: impl FnOnce(&WorkingFileEdit) -> Result<(), AppError>,
) -> Result<EditorWriteResult, AppError> {
    if value.id != revision {
        return Err(unavailable());
    }
    let edit = value.edit.as_ref().ok_or_else(unavailable)?;
    // Entropy failure must precede any filesystem/index side effect.
    let next_revision = identifier()?;
    let (disk, next, mut warning) = if let Some(text) = action.text {
        let text = replacement(&text, edit)?;
        let saved = edit.save(&text, token)?;
        (saved.status, saved.next, saved.warning)
    } else {
        edit.verify_current(token)?;
        (WorkingFileWriteStatus::Unchanged, Some(edit.clone()), None)
    };
    // From here errors are result fields: a disk save may already have happened.
    value.id = next_revision;
    value.edit = next;
    let mut outcome = EditorStage::NotRequested;
    let mut stage_error = None;
    if action.stage && disk != WorkingFileWriteStatus::Unconfirmed {
        if let Some(current) = value.edit.as_ref() {
            let staged = current
                .verify_current(token)
                .and_then(|()| stage_file(current));
            match staged {
                Ok(()) => outcome = EditorStage::Staged,
                Err(error) => {
                    outcome = EditorStage::Unconfirmed;
                    stage_error = Some(error);
                }
            }
            if current.verify_current(token).is_err() {
                value.edit = None;
                warning = Some("Reload the working file before another save or stage; retain any unsaved draft.".into());
            }
        } else {
            outcome = EditorStage::Unconfirmed;
            stage_error = Some(unavailable());
        }
    } else if action.stage {
        outcome = EditorStage::Unconfirmed;
        stage_error = Some(unavailable());
    }
    Ok(EditorWriteResult {
        editor_id: editor_id.into(),
        revision: value.id.clone(),
        file: value
            .edit
            .as_ref()
            .map(|edit| snapshot(editor_id, &value.id, edit)),
        disk,
        stage: outcome,
        stage_error,
        warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    struct Fixture(std::path::PathBuf);
    #[cfg(target_os = "linux")]
    impl Fixture {
        fn git(&self, args: &[&str]) -> Vec<u8> {
            let mut command = std::process::Command::new("git");
            for key in git_khronos_git_core::GIT_CONTEXT_ENVIRONMENT_VARIABLES {
                command.env_remove(key);
            }
            let result = command
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .args([
                    "-C",
                    self.0.to_str().unwrap(),
                    "-c",
                    "core.hooksPath=/dev/null",
                    "-c",
                    "core.attributesFile=/dev/null",
                    "-c",
                    "user.name=Owned fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "-c",
                    "commit.gpgSign=false",
                ])
                .args(args)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            result.stdout
        }
        fn new(bytes: &[u8]) -> Self {
            let fixture = Self(
                std::env::temp_dir().join(format!("git-khronos-editor-{}", identifier().unwrap())),
            );
            std::fs::create_dir(&fixture.0).unwrap();
            fixture.git(&["init", "--quiet"]);
            fixture.git(&["config", "core.hooksPath", "/dev/null"]);
            fixture.git(&["config", "core.attributesFile", "/dev/null"]);
            std::fs::write(fixture.0.join("literal [file].txt"), bytes).unwrap();
            fixture.git(&["--literal-pathspecs", "add", "--", "literal [file].txt"]);
            fixture.git(&["commit", "--quiet", "-m", "Owned baseline"]);
            fixture
        }
        fn revision(&self) -> Revision {
            Revision {
                id: "reviewed".into(),
                edit: Some(
                    open_working_file_edit(
                        &self.0,
                        "literal [file].txt",
                        None,
                        &CancellationToken::default(),
                    )
                    .unwrap(),
                ),
            }
        }
        fn disk(&self) -> Vec<u8> {
            std::fs::read(self.0.join("literal [file].txt")).unwrap()
        }
        fn index(&self) -> Vec<u8> {
            self.git(&["show", ":literal [file].txt"])
        }
    }
    #[cfg(target_os = "linux")]
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn saved_bytes_and_stage_saved_are_distinct_and_replay_is_refused() {
        let fixture = Fixture::new(b"before\r\n");
        let mut value = fixture.revision();
        let token = CancellationToken::default();
        let saved = apply_write(
            &mut value,
            "editor",
            "reviewed",
            WriteAction {
                text: Some("after\n".into()),
                stage: false,
            },
            &token,
            |_| panic!("save-only must not stage"),
        )
        .unwrap();
        assert_eq!(saved.disk, WorkingFileWriteStatus::Saved);
        assert!(matches!(saved.stage, EditorStage::NotRequested));
        assert_eq!(fixture.disk(), b"after\r\n");
        assert_eq!(fixture.index(), b"before\r\n");
        assert_eq!(saved.file.as_ref().unwrap().text, "after\n");
        assert_eq!(saved.file.as_ref().unwrap().line_endings, LineEndings::CrLf);
        assert!(
            apply_write(
                &mut value,
                "editor",
                "reviewed",
                WriteAction {
                    text: Some("replay".into()),
                    stage: true
                },
                &token,
                |_| panic!("stale revision must not stage")
            )
            .is_err()
        );
        assert_eq!(fixture.disk(), b"after\r\n");
        let staged = apply_write(
            &mut value,
            "editor",
            &saved.revision,
            WriteAction {
                text: None,
                stage: true,
            },
            &token,
            |edit| stage_path(&fixture.0, edit.path()),
        )
        .unwrap();
        assert_eq!(staged.disk, WorkingFileWriteStatus::Unchanged);
        assert!(matches!(staged.stage, EditorStage::Staged));
        assert_eq!(fixture.index(), b"after\r\n");
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn failed_stage_keeps_successful_save_explicit_and_the_original_index() {
        let fixture = Fixture::new(b"before\n");
        let mut value = fixture.revision();
        let saved = apply_write(
            &mut value,
            "editor",
            "reviewed",
            WriteAction {
                text: Some("saved\n".into()),
                stage: true,
            },
            &CancellationToken::default(),
            |_| {
                Err(AppError {
                    kind: "ownedStageFailure".into(),
                    message: "Fixture refusal".into(),
                    hint: None,
                })
            },
        )
        .unwrap();
        assert_eq!(saved.disk, WorkingFileWriteStatus::Saved);
        assert!(matches!(saved.stage, EditorStage::Unconfirmed));
        assert_eq!(
            saved.stage_error.as_ref().unwrap().kind,
            "ownedStageFailure"
        );
        assert_eq!(fixture.disk(), b"saved\n");
        assert_eq!(fixture.index(), b"before\n");
        assert!(saved.file.is_some());
        assert_ne!(value.id, "reviewed");
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn stale_disk_and_mixed_endings_refuse_before_save_or_stage() {
        let fixture = Fixture::new(b"a\r\nb\n");
        let mut value = fixture.revision();
        assert!(
            snapshot("editor", "reviewed", value.edit.as_ref().unwrap())
                .read_only_reason
                .is_some()
        );
        assert!(
            apply_write(
                &mut value,
                "editor",
                "reviewed",
                WriteAction {
                    text: Some("replacement\n".into()),
                    stage: true
                },
                &CancellationToken::default(),
                |_| panic!("mixed line endings cannot save-and-stage")
            )
            .is_err()
        );
        assert_eq!(value.id, "reviewed");
        assert_eq!(fixture.disk(), b"a\r\nb\n");
        std::fs::write(fixture.0.join("literal [file].txt"), b"external\n").unwrap();
        assert!(
            apply_write(
                &mut value,
                "editor",
                "reviewed",
                WriteAction {
                    text: None,
                    stage: true
                },
                &CancellationToken::default(),
                |_| panic!("changed disk must not stage")
            )
            .is_err()
        );
        assert_eq!(fixture.index(), b"a\r\nb\n");
        assert_eq!(value.id, "reviewed");
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn textarea_round_trip_preserves_utf16_bom_and_carriage_return_endings() {
        let encode = |text: &str| {
            b"\xff\xfe"
                .iter()
                .copied()
                .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
                .collect::<Vec<_>>()
        };
        let before = encode("before\r");
        let fixture = Fixture::new(&before);
        let mut value = fixture.revision();
        let saved = apply_write(
            &mut value,
            "editor",
            "reviewed",
            WriteAction {
                text: Some("edited\n".into()),
                stage: false,
            },
            &CancellationToken::default(),
            |_| panic!("save-only must not stage"),
        )
        .unwrap();
        assert_eq!(fixture.disk(), encode("edited\r"));
        assert_eq!(fixture.index(), before);
        let file = saved.file.unwrap();
        assert!(file.bom);
        assert_eq!(file.encoding, WorkingTextEncoding::Utf16Le);
        assert_eq!(file.line_endings, LineEndings::Cr);
        assert_eq!(file.text, "edited\n");
    }
    #[test]
    fn newline_classification_and_textarea_normalization_are_explicit() {
        for (input, expected, normalized) in [
            ("", LineEndings::None, ""),
            ("a\nb\n", LineEndings::Lf, "a\nb\n"),
            ("a\r\nb\r\n", LineEndings::CrLf, "a\nb\n"),
            ("a\rb\r", LineEndings::Cr, "a\nb\n"),
            ("a\r\nb\nc\r", LineEndings::Mixed, "a\nb\nc\n"),
        ] {
            assert_eq!(line_endings(input), expected);
            assert_eq!(textarea_text(input), normalized);
        }
    }
    fn editor() -> Arc<Editor> {
        Arc::new(Editor {
            repository: "owned-fixture".into(),
            created: Instant::now(),
            closed: AtomicBool::new(false),
            active: Mutex::new(None),
            value: Mutex::new(Revision {
                id: "revision".into(),
                edit: None,
            }),
        })
    }
    #[test]
    fn close_cancels_active_context_without_waiting_for_its_value_lock() {
        let state = EditorState::default();
        let editor = editor();
        state.insert("id".into(), editor.clone()).unwrap();
        let token = CancellationToken::default();
        let _active = editor.activate(&token).unwrap();
        let _held_value = editor.value.lock().unwrap();
        assert!(state.close("id").unwrap());
        assert!(token.is_cancelled());
        assert!(state.get("id").is_err());
        assert!(editor.activate(&CancellationToken::default()).is_err());
    }
    #[test]
    fn capacity_expiry_and_collision_do_not_evict_live_drafts() {
        let state = EditorState::default();
        for i in 0..CAPACITY {
            state.insert(i.to_string(), editor()).unwrap();
        }
        assert!(state.insert("overflow".into(), editor()).is_err());
        let first = state.get("0").unwrap();
        assert!(state.insert("0".into(), editor()).is_err());
        assert!(Arc::ptr_eq(&first, &state.get("0").unwrap()));
        state.close("1").unwrap();
        let mut expired = editor();
        Arc::get_mut(&mut expired).unwrap().created = Instant::now() - LIFETIME;
        state.insert("expired".into(), expired.clone()).unwrap();
        state.insert("replacement".into(), editor()).unwrap();
        assert!(expired.closed.load(Ordering::Acquire));
        assert!(state.get("expired").is_err());
    }
}
