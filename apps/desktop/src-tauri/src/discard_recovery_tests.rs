use super::{
    AppError, AppState, CommitHistoryCursor, DiscardRecoveryActionError, INITIAL_HISTORY_LIMIT,
    INITIAL_STATUS_LIMIT, RepositorySession, apply_discard_recovery_record,
    apply_discard_recovery_record_reviewed, discarded_change_recoveries,
    execute_discard_with_recovery, execute_prepared_discard_with_recovery,
    forget_discard_recovery_record, forget_discard_recovery_record_reviewed, prepare_discard,
};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

static NEXT: AtomicUsize = AtomicUsize::new(0);

#[test]
fn recovery_errors_expose_kind_and_toolbar_ownership_together() {
    let error = DiscardRecoveryActionError {
        error: AppError {
            kind: "discardRecoveryRecordFailed".into(),
            message: "Recovery completed but its record failed.".into(),
            hint: Some("Review the working tree.".into()),
        },
        affected_toolbar: true,
    };
    let value = serde_json::to_value(error).unwrap();
    assert_eq!(value["kind"], "discardRecoveryRecordFailed");
    assert_eq!(value["affectedToolbar"], true);
    assert_eq!(
        value["message"],
        "Recovery completed but its record failed."
    );
}

#[test]
fn missing_toolbar_recovery_is_distinct_from_a_temporary_storage_error() {
    let fixture = Fixture::new();
    let error = apply_discard_recovery_record(
        "repo",
        &AppState::default(),
        &fixture.session(),
        None,
        false,
    )
    .unwrap_err();
    assert_eq!(error.error.kind, "discardToolbarRecoveryUnavailable");
    assert!(!error.affected_toolbar);
}

struct Fixture {
    path: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "khronos-discard-recovery-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        let output = Command::new("git")
            .arg("-C")
            .arg(&path)
            .args(["init", "-q", "--template="])
            .env_remove("GIT_CONFIG_COUNT")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        fs::write(path.join("untracked.txt"), b"keep these bytes\n").unwrap();
        Self { path }
    }

    fn session(&self) -> RepositorySession {
        RepositorySession {
            incoming_link_guard: Arc::new(AtomicBool::new(false)),
            no_lazy_reads: AtomicBool::new(false),
            pause_auto_sync: AtomicBool::new(false),
            path: self.path.clone(),
            operation: Mutex::new(()),
            history_cursor: Mutex::new(CommitHistoryCursor::default()),
            history_limit: AtomicUsize::new(INITIAL_HISTORY_LIMIT),
            status_limit: AtomicUsize::new(INITIAL_STATUS_LIMIT),
            show_checkpoints: AtomicBool::new(false),
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).unwrap();
    }
}

#[test]
fn poisoned_recovery_state_refuses_discard_before_changing_files() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    let _ = std::panic::catch_unwind(|| {
        let _guard = state.discard_recoveries.lock().unwrap();
        panic!("poison recovery state");
    });

    let error = execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap_err();

    assert_eq!(error.kind, "internalState");
    assert_eq!(
        fs::read(fixture.path.join("untracked.txt")).unwrap(),
        b"keep these bytes\n"
    );
    assert!(
        discarded_change_recoveries(&fixture.path)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn successful_discard_registers_a_recoverable_copy() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();

    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();

    assert!(!fixture.path.join("untracked.txt").exists());
    let recoveries = state.discard_recoveries.lock().unwrap();
    let recovery = recoveries.get("repo").unwrap();
    assert!(!recovery.undone);
    assert_eq!(
        discarded_change_recoveries(&fixture.path).unwrap()[0].id,
        recovery.id
    );
    let id = recovery.id.clone();
    drop(recoveries);
    assert!(apply_discard_recovery_record("repo", &state, &session, Some(&id), false).unwrap());
    assert_eq!(
        fs::read(fixture.path.join("untracked.txt")).unwrap(),
        b"keep these bytes\n"
    );
    assert!(state.discard_recoveries.lock().unwrap()["repo"].undone);
    assert!(apply_discard_recovery_record("repo", &state, &session, None, true).unwrap());
    assert!(!fixture.path.join("untracked.txt").exists());
    assert!(!state.discard_recoveries.lock().unwrap()["repo"].undone);
}

#[test]
fn prepared_discard_replaces_the_toolbar_recovery_and_supports_undo_redo() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    fs::write(fixture.path.join("older.txt"), b"older changes\n").unwrap();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["older.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let older_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();

    let plan = prepare_discard(&fixture.path, Some(vec!["untracked.txt".into()])).unwrap();
    let id = execute_prepared_discard_with_recovery("repo", &state, &session, &plan).unwrap();
    assert_ne!(id, older_id);
    assert_eq!(state.discard_recoveries.lock().unwrap()["repo"].id, id);
    assert!(!fixture.path.join("untracked.txt").exists());
    assert!(!fixture.path.join("older.txt").exists());

    assert!(apply_discard_recovery_record("repo", &state, &session, None, false).unwrap());
    assert_eq!(
        fs::read(fixture.path.join("untracked.txt")).unwrap(),
        b"keep these bytes\n"
    );
    assert!(!fixture.path.join("older.txt").exists());
    assert!(state.discard_recoveries.lock().unwrap()["repo"].undone);
    assert!(apply_discard_recovery_record("repo", &state, &session, None, true).unwrap());
    assert!(!fixture.path.join("untracked.txt").exists());
    assert!(!state.discard_recoveries.lock().unwrap()["repo"].undone);
    let captures = discarded_change_recoveries(&fixture.path).unwrap();
    assert!(captures.iter().any(|capture| capture.id == older_id));
    assert!(captures.iter().any(|capture| capture.id == id));
}

#[test]
fn prepared_discard_replay_refuses_a_replaced_capture_without_a_review_hash() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    fs::write(fixture.path.join("other.txt"), b"other changes\n").unwrap();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["other.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let older_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    let directory = fixture.path.join(".git/git-khronos-recovery");
    let replacement = fs::read(directory.join(format!("{older_id}.patch"))).unwrap();
    let plan = prepare_discard(&fixture.path, Some(vec!["untracked.txt".into()])).unwrap();
    let id = execute_prepared_discard_with_recovery("repo", &state, &session, &plan).unwrap();
    let capture = directory.join(format!("{id}.patch"));
    fs::write(&capture, &replacement).unwrap();

    let error =
        apply_discard_recovery_record_reviewed("repo", &state, &session, Some(&id), false, None)
            .unwrap_err();
    assert_eq!(error.error.kind, "discardRecoveryChanged");
    assert!(error.affected_toolbar);
    assert!(
        !state
            .discard_recoveries
            .lock()
            .unwrap()
            .contains_key("repo")
    );
    assert!(!fixture.path.join("untracked.txt").exists());
    assert!(!fixture.path.join("other.txt").exists());
    assert_eq!(fs::read(capture).unwrap(), replacement);
}

#[test]
fn prepared_discard_refuses_poisoned_recovery_state_before_changing_files() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    let plan = prepare_discard(&fixture.path, Some(vec!["untracked.txt".into()])).unwrap();
    let _ = std::panic::catch_unwind(|| {
        let _guard = state.discard_recoveries.lock().unwrap();
        panic!("poison recovery state");
    });

    let error =
        execute_prepared_discard_with_recovery("repo", &state, &session, &plan).unwrap_err();
    assert_eq!(error.kind, "internalState");
    assert_eq!(
        fs::read(fixture.path.join("untracked.txt")).unwrap(),
        b"keep these bytes\n"
    );
    assert!(
        discarded_change_recoveries(&fixture.path)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn stale_prepared_discard_preserves_the_prior_toolbar_recovery() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    fs::write(fixture.path.join("older.txt"), b"older changes\n").unwrap();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["older.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let older_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    let plan = prepare_discard(&fixture.path, Some(vec!["untracked.txt".into()])).unwrap();
    fs::write(fixture.path.join("untracked.txt"), b"newer changes\n").unwrap();

    let error =
        execute_prepared_discard_with_recovery("repo", &state, &session, &plan).unwrap_err();
    assert_eq!(error.kind, "staleDiscard");
    assert_eq!(
        state.discard_recoveries.lock().unwrap()["repo"].id,
        older_id
    );
    assert_eq!(
        fs::read(fixture.path.join("untracked.txt")).unwrap(),
        b"newer changes\n"
    );
    assert_eq!(discarded_change_recoveries(&fixture.path).unwrap().len(), 1);
}

#[test]
fn changed_capture_refuses_toolbar_and_reviewed_replay_without_losing_the_capture() {
    for action in ["toolbar", "reviewed-apply", "reviewed-remove", "new-review"] {
        let fixture = Fixture::new();
        let session = fixture.session();
        let state = AppState::default();
        execute_discard_with_recovery(
            "repo",
            &state,
            &session,
            |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
            |_, _| Ok(()),
        )
        .unwrap();
        let reviewed = discarded_change_recoveries(&fixture.path)
            .unwrap()
            .remove(0);
        let fingerprint = reviewed.content_sha256.unwrap();
        let capture = fixture
            .path
            .join(".git/git-khronos-recovery")
            .join(format!("{}.patch", reviewed.id));
        fs::write(&capture, b"externally replaced capture").unwrap();
        let new_fingerprint = discarded_change_recoveries(&fixture.path)
            .unwrap()
            .remove(0)
            .content_sha256
            .unwrap();
        let result = match action {
            "toolbar" => apply_discard_recovery_record("repo", &state, &session, None, false),
            "reviewed-remove" => forget_discard_recovery_record_reviewed(
                "repo",
                &state,
                &session,
                &reviewed.id,
                Some(&fingerprint),
            ),
            "new-review" => apply_discard_recovery_record_reviewed(
                "repo",
                &state,
                &session,
                Some(&reviewed.id),
                false,
                Some(&new_fingerprint),
            ),
            _ => apply_discard_recovery_record_reviewed(
                "repo",
                &state,
                &session,
                Some(&reviewed.id),
                false,
                Some(&fingerprint),
            ),
        };
        let error = result.unwrap_err();
        assert_eq!(error.error.kind, "discardRecoveryChanged");
        assert!(error.affected_toolbar);
        assert!(
            !state
                .discard_recoveries
                .lock()
                .unwrap()
                .contains_key("repo")
        );
        assert!(!fixture.path.join("untracked.txt").exists());
        assert_eq!(fs::read(capture).unwrap(), b"externally replaced capture");
    }
}

#[test]
fn changed_older_capture_preserves_the_newer_toolbar_entry() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let reviewed = discarded_change_recoveries(&fixture.path)
        .unwrap()
        .remove(0);
    fs::write(fixture.path.join("other.txt"), b"newer\n").unwrap();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["other.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let newer = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    let capture = fixture
        .path
        .join(".git/git-khronos-recovery")
        .join(format!("{}.patch", reviewed.id));
    fs::write(&capture, b"externally replaced capture").unwrap();

    for result in [
        apply_discard_recovery_record_reviewed(
            "repo",
            &state,
            &session,
            Some(&reviewed.id),
            false,
            reviewed.content_sha256.as_deref(),
        ),
        forget_discard_recovery_record_reviewed(
            "repo",
            &state,
            &session,
            &reviewed.id,
            reviewed.content_sha256.as_deref(),
        ),
    ] {
        let error = result.unwrap_err();
        assert_eq!(error.error.kind, "discardRecoveryChanged");
        assert!(!error.affected_toolbar);
        assert_eq!(state.discard_recoveries.lock().unwrap()["repo"].id, newer);
    }
    assert_eq!(fs::read(capture).unwrap(), b"externally replaced capture");
}

#[test]
fn failed_refresh_reports_the_discard_completed_with_recovery() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    let error = execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
        |_, _| {
            Err::<(), _>(AppError {
                kind: "statusUnavailable".into(),
                message: "Status read failed.".into(),
                hint: None,
            })
        },
    )
    .unwrap_err();
    assert_eq!(error.kind, "discardRefreshFailed");
    assert!(error.message.contains("Changes were discarded"));
    assert!(error.hint.unwrap().contains("Do not repeat"));
    assert!(!fixture.path.join("untracked.txt").exists());
    let id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    assert!(apply_discard_recovery_record("repo", &state, &session, Some(&id), false).unwrap());
    assert_eq!(
        fs::read(fixture.path.join("untracked.txt")).unwrap(),
        b"keep these bytes\n"
    );
}

#[test]
fn restoring_an_older_capture_keeps_the_newer_toolbar_entry() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let old_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    fs::write(fixture.path.join("other.txt"), b"newer\n").unwrap();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["other.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let new_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();

    assert!(
        !apply_discard_recovery_record("repo", &state, &session, Some(&old_id), false).unwrap()
    );
    assert_eq!(
        fs::read(fixture.path.join("untracked.txt")).unwrap(),
        b"keep these bytes\n"
    );
    assert!(!fixture.path.join("other.txt").exists());
    let recoveries = state.discard_recoveries.lock().unwrap();
    assert_eq!(recoveries["repo"].id, new_id);
    assert!(!recoveries["repo"].undone);
    drop(recoveries);
    assert!(!forget_discard_recovery_record("repo", &state, &session, &old_id).unwrap());
    assert_eq!(state.discard_recoveries.lock().unwrap()["repo"].id, new_id);
    assert!(forget_discard_recovery_record("repo", &state, &session, &new_id).unwrap());
    assert!(
        !state
            .discard_recoveries
            .lock()
            .unwrap()
            .contains_key("repo")
    );
}

#[test]
fn missing_toolbar_capture_invalidates_only_its_owned_entry() {
    for action in ["apply", "forget", "toolbar"] {
        let fixture = Fixture::new();
        let session = fixture.session();
        let state = AppState::default();
        execute_discard_with_recovery(
            "repo",
            &state,
            &session,
            |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
            |_, _| Ok(()),
        )
        .unwrap();
        let id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
        fs::remove_file(
            fixture
                .path
                .join(".git/git-khronos-recovery")
                .join(format!("{id}.patch")),
        )
        .unwrap();
        let error = match action {
            "apply" => apply_discard_recovery_record("repo", &state, &session, Some(&id), false),
            "toolbar" => apply_discard_recovery_record("repo", &state, &session, None, false),
            _ => forget_discard_recovery_record("repo", &state, &session, &id),
        }
        .unwrap_err();
        assert_eq!(error.error.kind, "discardRecoveryMissing");
        assert!(error.affected_toolbar);
        assert!(
            !state
                .discard_recoveries
                .lock()
                .unwrap()
                .contains_key("repo")
        );
    }
}

#[cfg(unix)]
#[test]
fn temporary_recovery_access_failure_preserves_toolbar_replay() {
    use std::os::unix::fs::PermissionsExt;

    for action in ["apply", "forget", "toolbar"] {
        let fixture = Fixture::new();
        let session = fixture.session();
        let state = AppState::default();
        execute_discard_with_recovery(
            "repo",
            &state,
            &session,
            |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
            |_, _| Ok(()),
        )
        .unwrap();
        let id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
        let directory = fixture.path.join(".git/git-khronos-recovery");
        let original = fs::metadata(&directory).unwrap().permissions();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o000)).unwrap();
        let probe = fs::symlink_metadata(directory.join(format!("{id}.patch")));
        if !matches!(probe, Err(ref error) if error.kind() == std::io::ErrorKind::PermissionDenied)
        {
            fs::set_permissions(directory, original).unwrap();
            eprintln!("Skipping permission test: the process can access the recovery directory.");
            return;
        }

        let result = match action {
            "apply" => apply_discard_recovery_record("repo", &state, &session, Some(&id), false),
            "toolbar" => apply_discard_recovery_record("repo", &state, &session, None, false),
            _ => forget_discard_recovery_record("repo", &state, &session, &id),
        };
        fs::set_permissions(directory, original).unwrap();
        let error = result.unwrap_err();
        assert_eq!(error.error.kind, "discardRecoveryUnavailable");
        assert!(error.affected_toolbar);
        assert_eq!(state.discard_recoveries.lock().unwrap()["repo"].id, id);
        assert!(apply_discard_recovery_record("repo", &state, &session, None, false).unwrap());
        assert_eq!(
            fs::read(fixture.path.join("untracked.txt")).unwrap(),
            b"keep these bytes\n"
        );
    }
}

#[test]
fn missing_older_capture_preserves_newer_toolbar_replay() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let old_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    fs::write(fixture.path.join("other.txt"), b"newer\n").unwrap();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["other.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let new_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    fs::remove_file(
        fixture
            .path
            .join(".git/git-khronos-recovery")
            .join(format!("{old_id}.patch")),
    )
    .unwrap();

    for result in [
        apply_discard_recovery_record("repo", &state, &session, Some(&old_id), false),
        forget_discard_recovery_record("repo", &state, &session, &old_id),
    ] {
        let error = result.unwrap_err();
        assert_eq!(error.error.kind, "discardRecoveryMissing");
        assert!(!error.affected_toolbar);
        assert_eq!(state.discard_recoveries.lock().unwrap()["repo"].id, new_id);
    }
}

#[test]
fn changed_recovery_state_invalidates_only_its_owned_toolbar_entry() {
    for older in [false, true] {
        let fixture = Fixture::new();
        let session = fixture.session();
        let state = AppState::default();
        execute_discard_with_recovery(
            "repo",
            &state,
            &session,
            |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
            |_, _| Ok(()),
        )
        .unwrap();
        let id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
        let expected_toolbar = if older {
            fs::write(fixture.path.join("other.txt"), b"newer\n").unwrap();
            execute_discard_with_recovery(
                "repo",
                &state,
                &session,
                |path| prepare_discard(path, Some(vec!["other.txt".into()])),
                |_, _| Ok(()),
            )
            .unwrap();
            Some(state.discard_recoveries.lock().unwrap()["repo"].id.clone())
        } else {
            None
        };
        fs::write(
            fixture
                .path
                .join(".git/git-khronos-recovery")
                .join(format!("{id}.restored")),
            b"",
        )
        .unwrap();

        let error =
            apply_discard_recovery_record("repo", &state, &session, Some(&id), false).unwrap_err();
        assert_eq!(error.error.kind, "discardRecoveryStateChanged");
        assert_eq!(error.affected_toolbar, !older);
        assert_eq!(
            state
                .discard_recoveries
                .lock()
                .unwrap()
                .get("repo")
                .map(|entry| entry.id.clone()),
            expected_toolbar
        );
        assert!(!fixture.path.join("untracked.txt").exists());
    }
}

#[cfg(unix)]
#[test]
fn unavailable_recovery_storage_preserves_toolbar_replay() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    let directory = fixture.path.join(".git/git-khronos-recovery");
    let original = fs::metadata(&directory).unwrap().permissions();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    let probe = directory.join("permission-probe");
    if fs::write(&probe, b"").is_ok() {
        fs::remove_file(probe).unwrap();
        fs::set_permissions(directory, original).unwrap();
        eprintln!("Skipping permission test: the process can write to a read-only directory.");
        return;
    }

    let result = apply_discard_recovery_record("repo", &state, &session, Some(&id), false);
    fs::set_permissions(directory, original).unwrap();
    let error = result.unwrap_err();
    assert_eq!(error.error.kind, "discardRecoveryUnavailable");
    assert!(error.affected_toolbar);
    assert!(!fixture.path.join("untracked.txt").exists());
    assert_eq!(state.discard_recoveries.lock().unwrap()["repo"].id, id);
    assert!(apply_discard_recovery_record("repo", &state, &session, None, false).unwrap());
    assert_eq!(
        fs::read(fixture.path.join("untracked.txt")).unwrap(),
        b"keep these bytes\n"
    );
}

#[cfg(unix)]
#[test]
fn unavailable_older_recovery_does_not_invalidate_newer_toolbar_replay() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = Fixture::new();
    let session = fixture.session();
    let state = AppState::default();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["untracked.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let old_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    fs::write(fixture.path.join("other.txt"), b"newer\n").unwrap();
    execute_discard_with_recovery(
        "repo",
        &state,
        &session,
        |path| prepare_discard(path, Some(vec!["other.txt".into()])),
        |_, _| Ok(()),
    )
    .unwrap();
    let new_id = state.discard_recoveries.lock().unwrap()["repo"].id.clone();
    let directory = fixture.path.join(".git/git-khronos-recovery");
    let original = fs::metadata(&directory).unwrap().permissions();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    let probe = directory.join("permission-probe");
    if fs::write(&probe, b"").is_ok() {
        fs::remove_file(probe).unwrap();
        fs::set_permissions(directory, original).unwrap();
        eprintln!("Skipping permission test: the process can write to a read-only directory.");
        return;
    }

    let result = apply_discard_recovery_record("repo", &state, &session, Some(&old_id), false);
    fs::set_permissions(directory, original).unwrap();
    let error = result.unwrap_err();
    assert_eq!(error.error.kind, "discardRecoveryUnavailable");
    assert!(!error.affected_toolbar);
    assert!(!fixture.path.join("untracked.txt").exists());
    assert_eq!(state.discard_recoveries.lock().unwrap()["repo"].id, new_id);
}
