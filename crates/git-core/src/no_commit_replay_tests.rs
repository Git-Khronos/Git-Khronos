use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

struct Repository(PathBuf);

impl Repository {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("chronos-no-commit-{}-{id}", std::process::id()));
        fs::create_dir(&path).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Destination Author"],
            vec!["config", "user.email", "destination@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            run_mutation(&path, &args, "initialize owned fixture").unwrap();
        }
        fs::write(path.join("file"), b"base\n").unwrap();
        stage_all(&path).unwrap();
        commit(&path, "Base").unwrap();
        Self(path)
    }

    fn oid(&self) -> String {
        String::from_utf8(run_git(&self.0, &["rev-parse", "HEAD"]).unwrap().stdout)
            .unwrap()
            .trim()
            .to_owned()
    }

    fn state_file(&self) -> PathBuf {
        self.0.join(".git/git-chronos-no-commit.json")
    }

    fn recovery_tip(&self) -> String {
        String::from_utf8(
            run_git(
                &self.0,
                &[
                    "for-each-ref",
                    "--format=%(objectname)",
                    "refs/git-chronos/recovery/",
                ],
            )
            .unwrap()
            .stdout,
        )
        .unwrap()
        .trim()
        .to_owned()
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn fixture(conflicting: bool) -> (Repository, Vec<String>, String, String) {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(path, &["checkout", "-b", "source"], "create source").unwrap();
    run_mutation(
        path,
        &["config", "user.name", "Original Source Author"],
        "configure source author",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "user.email", "source@example.test"],
        "configure source email",
    )
    .unwrap();
    let mut oids = vec![];
    for (file, bytes, message) in [
        ("first", b"first\n".as_slice(), "First"),
        ("file", b"source\n".as_slice(), "Second"),
        ("last", b"last\n".as_slice(), "Last"),
    ] {
        fs::write(path.join(file), bytes).unwrap();
        stage_all(path).unwrap();
        commit(path, message).unwrap();
        oids.push(repository.oid());
    }
    let source = repository.oid();
    run_mutation(path, &["checkout", "main"], "return to destination").unwrap();
    run_mutation(
        path,
        &["config", "user.name", "Destination Author"],
        "restore destination identity",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "user.email", "destination@example.test"],
        "restore destination email",
    )
    .unwrap();
    if conflicting {
        fs::write(path.join("file"), b"destination\n").unwrap();
        stage_all(path).unwrap();
        commit(path, "Destination").unwrap();
    }
    let original = repository.oid();
    (repository, oids, source, original)
}

#[test]
fn no_commit_replay_combines_reviewed_order_in_index_without_commits_and_explicit_commit_has_current_identity(
) {
    let (repository, oids, source, original) = fixture(false);
    let path = &repository.0;
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(repository.recovery_tip(), original);
    assert_eq!(
        run_git(path, &["write-tree"]).unwrap().stdout,
        run_git(path, &["rev-parse", &format!("{source}^{{tree}}")])
            .unwrap()
            .stdout
    );
    assert_eq!(fs::read(path.join("file")).unwrap(), b"source\n");
    assert!(!repository.state_file().exists());
    let status = read_status(path).unwrap();
    assert_eq!(status.staged, 3);
    assert!(!status.history_no_commit);
    assert_eq!(status.history_operation, None);
    commit(path, "Independently reviewed changes").unwrap();
    assert_eq!(
        String::from_utf8(
            run_git(path, &["log", "-1", "--format=%s|%an|%ae|%P"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        format!(
            "Independently reviewed changes|Destination Author|destination@example.test|{original}"
        )
    );
}

#[test]
fn no_commit_replay_restart_continues_staged_resolution_and_remaining_rows_without_creating_commits(
) {
    let (repository, oids, _, original) = fixture(true);
    let path = &repository.0;
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
    assert_eq!(repository.oid(), original);
    let status = read_status(path).unwrap();
    assert!(status.history_no_commit);
    assert_eq!(status.history_operation.as_deref(), Some("cherry-pick"));
    assert_eq!(status.conflicted, 1);
    assert!(path.join("first").exists() && !path.join("last").exists());
    assert_eq!(
        control_history_operation(path, "cherry-pick", "continue")
            .unwrap_err()
            .kind,
        "noCommitResolutionRequired"
    );
    assert_eq!(
        control_history_operation(path, "cherry-pick", "skip")
            .unwrap_err()
            .kind,
        "invalidHistoryOperationAction"
    );
    fs::write(path.join("file"), b"resolved\n").unwrap();
    assert_eq!(
        control_history_operation(path, "cherry-pick", "continue")
            .unwrap_err()
            .kind,
        "noCommitResolutionRequired"
    );
    stage_path(path, "file").unwrap();
    assert_eq!(
        commit(path, "Premature commit").unwrap_err().kind,
        "noCommitReplayInProgress"
    );
    // No in-memory state is used: status and controls reload the worktree-local journal.
    assert!(read_head_status(path).unwrap().history_no_commit);
    control_history_operation(path, "cherry-pick", "continue").unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(fs::read(path.join("first")).unwrap(), b"first\n");
    assert_eq!(fs::read(path.join("file")).unwrap(), b"resolved\n");
    assert_eq!(fs::read(path.join("last")).unwrap(), b"last\n");
    assert_eq!(read_status(path).unwrap().staged, 3);
    assert!(!read_status(path).unwrap().history_no_commit);
    assert!(!repository.state_file().exists());
    assert_eq!(repository.recovery_tip(), original);
}

#[test]
fn no_commit_replay_abort_restores_original_tracked_state_and_keeps_untracked_files() {
    for resolve in [false, true] {
        let (repository, oids, _, original) = fixture(true);
        let path = &repository.0;
        cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
        if resolve {
            fs::write(path.join("file"), b"resolved\n").unwrap();
            stage_path(path, "file").unwrap();
        }
        fs::write(path.join("untracked"), b"retained\n").unwrap();
        control_history_operation(path, "cherry-pick", "abort").unwrap();
        assert_eq!(repository.oid(), original);
        assert_eq!(fs::read(path.join("file")).unwrap(), b"destination\n");
        assert_eq!(fs::read(path.join("untracked")).unwrap(), b"retained\n");
        assert!(!path.join("first").exists() && !path.join("last").exists());
        assert!(!repository.state_file().exists());
        assert_eq!(read_status(path).unwrap().staged, 0);
        assert_eq!(repository.recovery_tip(), original);
    }
}

#[test]
fn no_commit_replay_quit_keeps_current_conflict_stages_and_files_exactly_unchanged() {
    let (repository, oids, _, original) = fixture(true);
    let path = &repository.0;
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let bytes = fs::read(path.join("file")).unwrap();
    control_history_operation(path, "cherry-pick", "quit").unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert_eq!(fs::read(path.join("file")).unwrap(), bytes);
    assert!(!read_status(path).unwrap().history_no_commit);
    assert_eq!(read_status(path).unwrap().conflicted, 1);
}

#[test]
fn no_commit_replay_rejects_dirty_invalid_later_commits_oversized_and_recovery_failure_before_application(
) {
    let (repository, oids, _, original) = fixture(false);
    let path = &repository.0;
    fs::write(path.join("dirty"), b"retained\n").unwrap();
    assert_eq!(
        cherry_pick_commits_with_options(path, &oids, None, true)
            .unwrap_err()
            .kind,
        "dirtyWorkingTree"
    );
    fs::remove_file(path.join("dirty")).unwrap();
    cherry_pick_commits_with_options(path, &[oids[0].clone(), "f".repeat(40)], None, true)
        .unwrap_err();
    assert_eq!(
        cherry_pick_commits_with_options(path, &vec![oids[0].clone(); 501], None, true)
            .unwrap_err()
            .kind,
        "invalidNoCommitRange"
    );
    assert!(!repository.state_file().exists());
    assert!(repository.recovery_tip().is_empty());
    run_mutation(
        path,
        &["update-ref", "refs/git-chronos/recovery", &original],
        "obstruct owned namespace",
    )
    .unwrap();
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
    assert_eq!(repository.oid(), original);
    assert_eq!(read_status(path).unwrap().entry_count, 0);
    assert!(!path.join("first").exists());
    assert!(!repository.state_file().exists());
}

#[test]
fn no_commit_replay_uncertain_state_cannot_repeat_a_step_or_reset_a_changed_head() {
    let (repository, oids, _, original) = fixture(true);
    let path = &repository.0;
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
    let file = repository.state_file();
    let mut state: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    state["phase"] = "applying".into();
    fs::write(&file, serde_json::to_vec(&state).unwrap()).unwrap();
    assert_eq!(
        control_history_operation(path, "cherry-pick", "continue")
            .unwrap_err()
            .kind,
        "uncertainNoCommitReplay"
    );
    run_mutation(
        path,
        &["update-ref", "refs/heads/main", &oids[0]],
        "externally move destination",
    )
    .unwrap();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    assert_eq!(
        control_history_operation(path, "cherry-pick", "abort")
            .unwrap_err()
            .kind,
        "staleNoCommitReplay"
    );
    assert_eq!(repository.oid(), oids[0]);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    control_history_operation(path, "cherry-pick", "quit").unwrap();
    assert_eq!(repository.recovery_tip(), original);
}

#[test]
fn no_commit_replay_uses_explicit_mainline_and_retains_identical_effects_without_an_implicit_commit(
) {
    for parent in [1, 2] {
        let repository = Repository::new();
        let path = &repository.0;
        run_mutation(path, &["checkout", "-b", "side"], "create side").unwrap();
        fs::write(path.join("side"), b"side\n").unwrap();
        stage_all(path).unwrap();
        commit(path, "Side").unwrap();
        let second = repository.oid();
        run_mutation(path, &["checkout", "main"], "return main").unwrap();
        fs::write(path.join("main"), b"main\n").unwrap();
        stage_all(path).unwrap();
        commit(path, "Main").unwrap();
        let first = repository.oid();
        run_mutation(
            path,
            &["merge", "--no-ff", "--no-edit", "side"],
            "merge owned branches",
        )
        .unwrap();
        let merge = repository.oid();
        let original = if parent == 1 { first } else { second };
        run_mutation(
            path,
            &["checkout", "-b", "replay", &original],
            "create replay",
        )
        .unwrap();
        cherry_pick_commits_with_options(path, std::slice::from_ref(&merge), Some(parent), true)
            .unwrap();
        assert_eq!(repository.oid(), original);
        assert_eq!(
            run_git(path, &["write-tree"]).unwrap().stdout,
            run_git(path, &["rev-parse", &format!("{merge}^{{tree}}")])
                .unwrap()
                .stdout
        );
        assert_eq!(repository.recovery_tip(), original);
        assert_eq!(read_status(path).unwrap().staged, 1);
    }
}

#[test]
fn no_commit_replay_rejects_hidden_changes_and_competing_sequences_and_keeps_abort_refusals_recoverable(
) {
    let (repository, oids, _, original) = fixture(true);
    let path = &repository.0;
    run_mutation(
        path,
        &["update-index", "--assume-unchanged", "file"],
        "hide owned entry",
    )
    .unwrap();
    assert_eq!(
        cherry_pick_commits_with_options(path, &oids, None, true)
            .unwrap_err()
            .kind,
        "hiddenIndexChanges"
    );
    run_mutation(
        path,
        &["update-index", "--no-assume-unchanged", "file"],
        "restore owned visibility",
    )
    .unwrap();
    fs::create_dir(path.join(".git/rebase-apply")).unwrap();
    assert_eq!(
        cherry_pick_commits_with_options(path, &oids, None, true)
            .unwrap_err()
            .kind,
        "historyOperationInProgress"
    );
    fs::remove_dir(path.join(".git/rebase-apply")).unwrap();
    assert!(repository.recovery_tip().is_empty());
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
    fs::write(path.join("file"), b"staged resolution\n").unwrap();
    stage_path(path, "file").unwrap();
    fs::write(path.join("file"), b"later unstaged edits\n").unwrap();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    control_history_operation(path, "cherry-pick", "abort").unwrap_err();
    assert!(repository.state_file().exists());
    assert_eq!(repository.oid(), original);
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"later unstaged edits\n"
    );
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    control_history_operation(path, "cherry-pick", "quit").unwrap();
}

#[test]
fn no_commit_replay_empty_changes_are_explicit_noops_and_bad_saved_state_is_not_silently_ignored() {
    let repository = Repository::new();
    let path = &repository.0;
    let original = repository.oid();
    run_mutation(path, &["checkout", "-b", "empty"], "create empty source").unwrap();
    run_mutation(
        path,
        &["commit", "--allow-empty", "-m", "Empty selected change"],
        "create empty commit",
    )
    .unwrap();
    let empty = repository.oid();
    run_mutation(path, &["checkout", "main"], "return destination").unwrap();
    cherry_pick_commits_with_options(path, &[empty], None, true).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(read_status(path).unwrap().entry_count, 0);
    assert!(!repository.state_file().exists());
    fs::write(repository.state_file(), b"{}").unwrap();
    assert_eq!(read_status(path).unwrap_err().kind, "invalidNoCommitReplay");
    assert_eq!(
        commit(path, "Must not bypass unknown journal")
            .unwrap_err()
            .kind,
        "invalidNoCommitReplay"
    );
    assert_eq!(repository.oid(), original);
}

#[test]
fn no_commit_replay_journal_is_worktree_local_and_initial_storage_refusal_cannot_apply_a_prefix() {
    let (repository, oids, _, original) = fixture(true);
    let path = &repository.0;
    let linked = path.join(".git/linked-checkout");
    run_mutation(
        path,
        &[
            "worktree",
            "add",
            "-b",
            "linked",
            linked.to_str().unwrap(),
            "main",
        ],
        "create owned linked worktree",
    )
    .unwrap();
    cherry_pick_commits_with_options(&linked, &oids, None, true).unwrap_err();
    assert!(read_status(&linked).unwrap().history_no_commit);
    assert!(!read_status(path).unwrap().history_no_commit);
    assert_eq!(read_status(path).unwrap().entry_count, 0);
    assert_eq!(repository.oid(), original);
    control_history_operation(&linked, "cherry-pick", "abort").unwrap();
    assert_eq!(read_status(&linked).unwrap().entry_count, 0);
    fs::write(
        repository.state_file().with_extension("json.lock"),
        b"Existing lock must be preserved",
    )
    .unwrap();
    let error = cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
    assert_eq!(error.kind, "noCommitReplayStorage");
    assert_eq!(
        fs::read(repository.state_file().with_extension("json.lock")).unwrap(),
        b"Existing lock must be preserved"
    );
    assert!(!repository.state_file().exists());
    assert_eq!(read_status(path).unwrap().entry_count, 0);
    assert!(!path.join("first").exists());
}

#[cfg(unix)]
#[test]
fn no_commit_replay_does_not_run_commit_hooks_and_the_later_explicit_commit_keeps_hook_refusal() {
    use std::os::unix::fs::PermissionsExt;
    let (repository, oids, _, original) = fixture(false);
    let path = &repository.0;
    let hooks = path.join(".git/hooks");
    run_mutation(
        path,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
        "configure owned hooks",
    )
    .unwrap();
    let marker = path.join(".git/commit-hook-observed");
    let hook = hooks.join("prepare-commit-msg");
    fs::write(&hook, format!("#!/bin/sh\nprintf 'called\\n' >> '{}'\nprintf 'Owned explicit commit refused\\n' >&2\nexit 1\n", marker.display())).unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap();
    assert!(!marker.exists());
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    assert!(commit(path, "Explicit reviewed changes")
        .unwrap_err()
        .message
        .contains("Owned explicit commit refused"));
    assert_eq!(repository.oid(), original);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(marker).unwrap(), b"called\n");
}

#[test]
fn no_commit_replay_single_and_multiple_conflict_stops_finish_without_rereplaying_the_resolved_row()
{
    for multiple in [false, true] {
        let repository = Repository::new();
        let path = &repository.0;
        run_mutation(path, &["checkout", "-b", "source"], "create source").unwrap();
        let mut oids = vec![];
        for bytes in [b"source one\n", b"source two\n"] {
            fs::write(path.join("file"), bytes).unwrap();
            stage_all(path).unwrap();
            commit(path, "Source edit").unwrap();
            oids.push(repository.oid());
        }

        run_mutation(path, &["checkout", "main"], "return main").unwrap();
        fs::write(path.join("file"), b"destination\n").unwrap();
        stage_all(path).unwrap();
        commit(path, "Destination").unwrap();
        let original = repository.oid();
        let selected = if multiple {
            oids.as_slice()
        } else {
            &oids[..1]
        };
        cherry_pick_commits_with_options(path, selected, None, true).unwrap_err();
        assert!(!path.join(".git/CHERRY_PICK_HEAD").exists());
        fs::write(path.join("file"), b"resolved one\n").unwrap();
        stage_path(path, "file").unwrap();
        if multiple {
            control_history_operation(path, "cherry-pick", "continue").unwrap_err();
            assert!(read_status(path).unwrap().history_no_commit);
            assert_eq!(read_status(path).unwrap().conflicted, 1);
            fs::write(path.join("file"), b"resolved two\n").unwrap();
            stage_path(path, "file").unwrap();
        }
        control_history_operation(path, "cherry-pick", "continue").unwrap();
        assert_eq!(repository.oid(), original);
        assert_eq!(
            fs::read(path.join("file")).unwrap(),
            if multiple {
                b"resolved two\n"
            } else {
                b"resolved one\n"
            }
        );
        assert!(!repository.state_file().exists());
        assert_eq!(read_status(path).unwrap().staged, 1);
    }
}

#[cfg(unix)]
#[test]
fn no_commit_replay_detects_and_resumes_literal_whitespace_and_newline_repository_paths() {
    let (mut repository, oids, _, original) = fixture(true);
    let moved = repository.0.with_file_name(format!(
        "{} \n",
        repository.0.file_name().unwrap().to_string_lossy()
    ));
    fs::rename(&repository.0, &moved).unwrap();
    repository.0 = moved;
    let path = &repository.0;
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
    assert!(read_status(path).unwrap().history_no_commit);
    assert!(read_head_status(path).unwrap().history_no_commit);
    fs::write(path.join("file"), b"resolved\n").unwrap();
    stage_path(path, "file").unwrap();
    control_history_operation(path, "cherry-pick", "continue").unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(read_status(path).unwrap().staged, 3);
    assert!(!repository.state_file().exists());
}

#[test]
fn no_commit_replay_manual_finish_preserves_competing_unknown_native_sequence_and_conflicted_index()
{
    let (repository, oids, _, original) = fixture(true);
    let path = &repository.0;
    cherry_pick_commits_with_options(path, &oids, None, true).unwrap_err();
    let sequence = path.join(".git/sequencer");
    fs::create_dir(&sequence).unwrap();
    fs::write(sequence.join("todo"), b"unsupported external saved step\n").unwrap();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    assert!(read_status(path).unwrap().history_no_commit);
    assert_eq!(
        control_history_operation(path, "cherry-pick", "continue")
            .unwrap_err()
            .kind,
        "historyOperationInProgress"
    );
    control_history_operation(path, "cherry-pick", "quit").unwrap();
    assert!(!repository.state_file().exists());
    assert_eq!(repository.oid(), original);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert_eq!(
        fs::read(sequence.join("todo")).unwrap(),
        b"unsupported external saved step\n"
    );
    assert_eq!(
        read_status(path).unwrap_err().kind,
        "invalidHistorySequence"
    );
}
