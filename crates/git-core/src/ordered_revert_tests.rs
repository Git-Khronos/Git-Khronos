use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

struct Repository(PathBuf);

impl Repository {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "khronos-ordered-revert-{}-{id}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Revert Author"],
            vec!["config", "user.email", "revert@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            run_mutation(&path, &args, "initialize owned revert fixture").unwrap();
        }
        let repository = Self(path);
        repository.edit("file", b"base\n", "Base");
        repository
    }

    fn oid(&self) -> String {
        String::from_utf8(run_git(&self.0, &["rev-parse", "HEAD"]).unwrap().stdout)
            .unwrap()
            .trim()
            .to_owned()
    }

    fn edit(&self, file: &str, bytes: &[u8], message: &str) -> String {
        fs::write(self.0.join(file), bytes).unwrap();
        stage_all(&self.0).unwrap();
        commit(&self.0, message).unwrap();
        self.oid()
    }

    fn recovery(&self) -> String {
        String::from_utf8(
            run_git(
                &self.0,
                &[
                    "for-each-ref",
                    "--format=%(objectname)",
                    "refs/git-khronos/recovery/",
                ],
            )
            .unwrap()
            .stdout,
        )
        .unwrap()
        .trim()
        .to_owned()
    }

    fn tree(&self) -> Vec<u8> {
        run_git(&self.0, &["write-tree"]).unwrap().stdout
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn ordered_revert_dependent_changes_reverse_newest_first_preserve_unselected_work_and_original_history()
 {
    let repository = Repository::new();
    let mut oids = vec![];
    for (bytes, message) in [
        (b"one\n".as_slice(), "One"),
        (b"two\n".as_slice(), "Two"),
        (b"three\n".as_slice(), "Three"),
    ] {
        oids.push(repository.edit("file", bytes, message));
    }
    let original = repository.edit("unselected", b"retained\n", "Retained outside selection");
    oids.reverse();
    revert_commits(&repository.0, &oids).unwrap();
    assert_eq!(repository.recovery(), original);
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"base\n");
    assert_eq!(
        fs::read(repository.0.join("unselected")).unwrap(),
        b"retained\n"
    );
    assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
    assert_eq!(read_status(&repository.0).unwrap().history_operation, None);
    assert_eq!(
        run_git(&repository.0, &["rev-parse", "HEAD~3"])
            .unwrap()
            .stdout,
        format!("{original}\n").as_bytes()
    );
    let messages = String::from_utf8(
        run_git(
            &repository.0,
            &[
                "log",
                "--reverse",
                "--format=%B%x00",
                &format!("{original}..HEAD"),
            ],
        )
        .unwrap()
        .stdout,
    )
    .unwrap();
    let messages: Vec<_> = messages
        .split('\0')
        .filter(|message| !message.trim().is_empty())
        .collect();
    assert_eq!(messages.len(), 3);
    for (message, oid) in messages.iter().zip(&oids) {
        assert!(message.contains(&format!("This reverts commit {oid}.")));
    }
}

#[test]
fn ordered_revert_uses_exact_argument_order_without_date_sorting_or_revision_traversal() {
    let repository = Repository::new();
    let a = repository.edit("a", b"a\n", "A");
    let b = repository.edit("b", b"b\n", "B");
    let c = repository.edit("c", b"c\n", "C");
    let original = repository.oid();
    let selected = [a, c, b];
    revert_commits(&repository.0, &selected).unwrap();
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"base\n");
    for file in ["a", "b", "c"] {
        assert!(!repository.0.join(file).exists());
    }
    let output = run_git(
        &repository.0,
        &[
            "log",
            "--reverse",
            "--format=%B%x00",
            &format!("{original}..HEAD"),
        ],
    )
    .unwrap();
    let text = String::from_utf8(output.stdout).unwrap();
    let messages: Vec<_> = text
        .split('\0')
        .filter(|message| !message.trim().is_empty())
        .collect();
    assert_eq!(messages.len(), 3);
    for (message, oid) in messages.iter().zip(selected) {
        assert!(message.contains(&oid));
    }
}

#[test]
fn ordered_revert_preflights_every_commit_bounds_duplicates_dirty_state_and_recovery_before_any_prefix()
 {
    let repository = Repository::new();
    let oid = repository.edit("first", b"first\n", "First");
    let head = repository.oid();
    let tree = repository.tree();
    for selection in [
        vec![],
        vec![oid.clone(), "bad".into()],
        vec![oid.clone(), "f".repeat(40)],
        vec![oid.clone(), oid.clone()],
        vec![oid.clone(), oid.to_ascii_uppercase()],
        vec![oid.clone(); 501],
    ] {
        revert_commits(&repository.0, &selection).unwrap_err();
        assert_eq!(repository.oid(), head);
        assert_eq!(repository.tree(), tree);
        assert!(repository.recovery().is_empty());
    }
    fs::write(repository.0.join("dirty"), b"local\n").unwrap();
    assert_eq!(
        revert_commits(&repository.0, std::slice::from_ref(&oid))
            .unwrap_err()
            .kind,
        "dirtyWorkingTree"
    );
    fs::remove_file(repository.0.join("dirty")).unwrap();
    run_mutation(
        &repository.0,
        &["update-ref", "refs/git-khronos/recovery", &head],
        "obstruct owned recovery namespace",
    )
    .unwrap();
    revert_commits(&repository.0, &[oid]).unwrap_err();
    assert_eq!(repository.oid(), head);
    assert_eq!(repository.tree(), tree);
    assert_eq!(fs::read(repository.0.join("first")).unwrap(), b"first\n");
}

#[test]
fn ordered_revert_rejects_a_merge_anywhere_in_selection_before_reverting_an_ordinary_prefix() {
    let repository = Repository::new();
    let base = repository.oid();
    run_mutation(&repository.0, &["checkout", "-b", "side"], "create side").unwrap();
    repository.edit("side", b"side\n", "Side");
    run_mutation(&repository.0, &["checkout", "main"], "return main").unwrap();
    let ordinary = repository.edit("ordinary", b"ordinary\n", "Ordinary");
    run_mutation(
        &repository.0,
        &["merge", "--no-ff", "--no-edit", "side"],
        "create owned merge",
    )
    .unwrap();
    let merge = repository.oid();
    let tree = repository.tree();
    assert_eq!(
        revert_commits(&repository.0, &[ordinary, merge.clone()])
            .unwrap_err()
            .kind,
        "mainlineRequired"
    );
    assert_eq!(repository.oid(), merge);
    assert_eq!(repository.tree(), tree);
    assert!(repository.recovery().is_empty());
    assert_ne!(base, merge);
}

#[test]
fn ordered_revert_conflict_continue_skip_abort_reload_native_sequence_and_preserve_original_tip() {
    for action in ["continue", "skip", "abort"] {
        let repository = Repository::new();
        let first = repository.edit("first", b"first\n", "First");
        let conflict = repository.edit("file", b"source\n", "Conflicting source");
        let original = repository.edit("file", b"destination\n", "Later edit retained");
        revert_commits(&repository.0, &[first, conflict]).unwrap_err();
        assert_eq!(repository.recovery(), original);
        assert_eq!(
            read_status(&repository.0)
                .unwrap()
                .history_operation
                .as_deref(),
            Some("revert")
        );
        assert_eq!(
            read_head_status(&repository.0)
                .unwrap()
                .history_operation
                .as_deref(),
            Some("revert")
        );
        assert_eq!(read_status(&repository.0).unwrap().conflicted, 1);
        assert!(!repository.0.join("first").exists());
        if action == "continue" {
            fs::write(repository.0.join("file"), b"reviewed resolution\n").unwrap();
            stage_path(&repository.0, "file").unwrap();
        }
        control_history_operation(&repository.0, "revert", action).unwrap();
        assert_eq!(read_status(&repository.0).unwrap().history_operation, None);
        assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
        assert_eq!(
            fs::read(repository.0.join("file")).unwrap(),
            if action == "continue" {
                b"reviewed resolution\n".as_slice()
            } else {
                b"destination\n".as_slice()
            }
        );
        if action == "abort" {
            assert_eq!(repository.oid(), original);
            assert_eq!(fs::read(repository.0.join("first")).unwrap(), b"first\n");
        } else {
            assert!(!repository.0.join("first").exists());
            assert_ne!(repository.oid(), original);
        }
    }
}

#[cfg(unix)]
#[test]
fn ordered_revert_later_hook_refusal_retains_staged_inverse_and_restart_controls() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let first = repository.edit("first", b"first\n", "First");
    let second = repository.edit("second", b"second\n", "Second");
    let original = repository.oid();
    let hooks = repository.0.join(".git/hooks");
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
        "use owned hooks",
    )
    .unwrap();
    let marker = repository.0.join(".git/seen-revert-hook");
    let hook = hooks.join("prepare-commit-msg");
    fs::write(&hook, format!("#!/bin/sh\nif test -f '{}'; then printf 'Owned later hook refusal\\n' >&2; exit 1; fi\nprintf 'seen\\n' > '{}'\n", marker.display(), marker.display())).unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let error = revert_commits(&repository.0, &[second, first]).unwrap_err();
    assert!(error.message.contains("Owned later hook refusal"));
    assert_eq!(repository.recovery(), original);
    assert!(!repository.0.join("second").exists());
    assert!(!repository.0.join("first").exists());
    assert_eq!(read_status(&repository.0).unwrap().staged, 1);
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .history_operation
            .as_deref(),
        Some("revert")
    );
    fs::remove_file(hook).unwrap();
    let index = repository.tree();
    assert_eq!(
        control_history_operation(&repository.0, "revert", "continue")
            .unwrap_err()
            .kind,
        "revertCommitRequired"
    );
    assert_eq!(repository.tree(), index);
    assert_eq!(read_status(&repository.0).unwrap().staged, 1);
    commit(&repository.0, "Reviewed inverse after hook retry").unwrap();
    control_history_operation(&repository.0, "revert", "continue").unwrap();
    assert_eq!(read_status(&repository.0).unwrap().history_operation, None);
    assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
    assert_eq!(
        run_git(&repository.0, &["rev-parse", "HEAD~2"])
            .unwrap()
            .stdout,
        format!("{original}\n").as_bytes()
    );
}

#[test]
fn ordered_revert_empty_inverse_requires_an_explicit_skip_instead_of_claiming_a_commit() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["commit", "--allow-empty", "-m", "Empty source"],
        "create owned empty source",
    )
    .unwrap();
    let empty = repository.oid();
    let changed = repository.edit("changed", b"changed\n", "Changed");
    let original = repository.oid();
    revert_commits(&repository.0, &[changed, empty]).unwrap_err();
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .history_operation
            .as_deref(),
        Some("revert")
    );
    assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
    control_history_operation(&repository.0, "revert", "skip").unwrap();
    assert_eq!(read_status(&repository.0).unwrap().history_operation, None);
    assert_eq!(
        run_git(&repository.0, &["rev-parse", "HEAD~1"])
            .unwrap()
            .stdout,
        format!("{original}\n").as_bytes()
    );
    assert!(!repository.0.join("changed").exists());
}

#[test]
fn ordered_revert_hidden_index_and_unknown_sequence_refuse_before_mutation_without_silent_status() {
    let repository = Repository::new();
    let oid = repository.edit("first", b"first\n", "First");
    let original = repository.oid();
    run_mutation(
        &repository.0,
        &["update-index", "--assume-unchanged", "first"],
        "hide owned index entry",
    )
    .unwrap();
    assert_eq!(
        revert_commits(&repository.0, std::slice::from_ref(&oid))
            .unwrap_err()
            .kind,
        "hiddenIndexChanges"
    );
    run_mutation(
        &repository.0,
        &["update-index", "--no-assume-unchanged", "first"],
        "restore owned index entry",
    )
    .unwrap();
    fs::create_dir(repository.0.join(".git/rebase-apply")).unwrap();
    assert_eq!(
        revert_commits(&repository.0, std::slice::from_ref(&oid))
            .unwrap_err()
            .kind,
        "historyOperationInProgress"
    );
    fs::remove_dir(repository.0.join(".git/rebase-apply")).unwrap();
    let sequence = repository.0.join(".git/sequencer");
    fs::create_dir(&sequence).unwrap();
    fs::write(sequence.join("todo"), b"unknown unsupported saved action\n").unwrap();
    assert_eq!(
        read_status(&repository.0).unwrap_err().kind,
        "invalidHistorySequence"
    );
    assert_eq!(
        revert_commits(&repository.0, std::slice::from_ref(&oid))
            .unwrap_err()
            .kind,
        "historyOperationInProgress"
    );
    fs::write(
        sequence.join("todo"),
        format!("pick {oid} Owned pending pick\n"),
    )
    .unwrap();
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .history_operation
            .as_deref(),
        Some("cherry-pick")
    );
    assert_eq!(
        revert_commits(&repository.0, &[oid]).unwrap_err().kind,
        "historyOperationInProgress"
    );
    assert_eq!(repository.oid(), original);
    assert!(repository.recovery().is_empty());
    assert_eq!(fs::read(repository.0.join("first")).unwrap(), b"first\n");
}

#[cfg(unix)]
#[test]
fn ordered_revert_first_hook_refusal_abort_restores_whole_original_sequence_without_a_commit() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let first = repository.edit("first", b"first\n", "First");
    let second = repository.edit("second", b"second\n", "Second");
    let original = repository.oid();
    let hooks = repository.0.join(".git/hooks");
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
        "use owned hooks",
    )
    .unwrap();
    let hook = hooks.join("prepare-commit-msg");
    fs::write(
        &hook,
        "#!/bin/sh\nprintf 'Owned first hook refused\\n' >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    revert_commits(&repository.0, &[second, first]).unwrap_err();
    assert_eq!(repository.oid(), original);
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .history_operation
            .as_deref(),
        Some("revert")
    );
    assert!(!repository.0.join(".git/REVERT_HEAD").exists());
    control_history_operation(&repository.0, "revert", "abort").unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(read_status(&repository.0).unwrap().history_operation, None);
    assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
    assert_eq!(fs::read(repository.0.join("first")).unwrap(), b"first\n");
    assert_eq!(fs::read(repository.0.join("second")).unwrap(), b"second\n");
}

#[cfg(unix)]
#[test]
fn ordered_revert_hook_sequence_and_abort_are_isolated_to_the_linked_worktree() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let first = repository.edit("first", b"first\n", "First");
    let second = repository.edit("second", b"second\n", "Second");
    let original = repository.oid();
    let linked = repository.0.join(".git/owned-linked-worktree");
    run_mutation(
        &repository.0,
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
    let hooks = repository.0.join(".git/hooks");
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
        "use owned hooks",
    )
    .unwrap();
    let hook = hooks.join("prepare-commit-msg");
    fs::write(
        &hook,
        "#!/bin/sh\nprintf 'Owned linked hook refused\\n' >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    revert_commits(&linked, &[second, first]).unwrap_err();
    assert_eq!(
        read_status(&linked).unwrap().history_operation.as_deref(),
        Some("revert")
    );
    assert_eq!(
        read_head_status(&linked)
            .unwrap()
            .history_operation
            .as_deref(),
        Some("revert")
    );
    assert_eq!(read_status(&repository.0).unwrap().history_operation, None);
    assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
    assert_eq!(repository.oid(), original);
    control_history_operation(&linked, "revert", "abort").unwrap();
    assert_eq!(read_status(&linked).unwrap().history_operation, None);
    assert_eq!(read_status(&linked).unwrap().entry_count, 0);
    assert_eq!(fs::read(linked.join("second")).unwrap(), b"second\n");
}
