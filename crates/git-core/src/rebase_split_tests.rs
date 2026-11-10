use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

struct Repository(PathBuf);

impl Repository {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("khronos-split-{}-{id}", std::process::id()));
        fs::create_dir(&path).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Split Author"],
            vec!["config", "user.email", "split@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            run_mutation(&path, &args, "initialize owned split fixture").unwrap();
        }
        let repository = Self(path);
        fs::write(repository.0.join("existing"), b"base\n").unwrap();
        fs::write(repository.0.join("deleted"), b"removed by split\n").unwrap();
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Base").unwrap();
        repository
    }

    fn text(&self, args: &[&str]) -> String {
        let output = run_git(&self.0, args).unwrap();
        ensure_success("inspect owned split fixture", &output).unwrap();
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn head(&self) -> String {
        self.text(&["rev-parse", "HEAD"])
    }

    fn pause(&self, later: bool) -> (String, String, String) {
        let base = self.head();
        fs::write(self.0.join("existing"), b"reviewed\n").unwrap();
        fs::write(self.0.join("new"), b"new file\n").unwrap();
        fs::remove_file(self.0.join("deleted")).unwrap();
        stage_all(&self.0).unwrap();
        commit(&self.0, "Combined changes").unwrap();
        let original = self.head();
        if later {
            fs::write(self.0.join("later"), b"later\n").unwrap();
            stage_all(&self.0).unwrap();
            commit(&self.0, "Later descendant").unwrap();
        }
        let tip = self.head();
        let selected = [original.clone()];
        let plan =
            prepare_interactive_rebase_with_selection(&self.0, "main", "main", Some(&selected))
                .unwrap();
        let steps: Vec<_> = plan
            .commits
            .iter()
            .enumerate()
            .map(|(index, commit)| InteractiveRebaseStep {
                oid: commit.oid.clone(),
                action: if index == 0 { "edit" } else { "pick" }.to_owned(),
                message: None,
            })
            .collect();
        execute_interactive_rebase_with_selection(&self.0, "main", "main", &steps, Some(&selected))
            .unwrap();
        assert!(read_status(&self.0).unwrap().rebase_edit_stopped);
        (base, original, tip)
    }

    fn split_file(&self) -> PathBuf {
        rebase_support_dir(&self.0).unwrap().join("split.json")
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[cfg(unix)]
#[test]
fn rebase_start_refuses_linked_support_before_replacing_files_or_creating_recovery_refs() {
    use std::os::unix::fs::symlink;
    let repository = Repository::new();
    fs::write(repository.0.join("existing"), b"next\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Next").unwrap();
    let tip = repository.head();
    let outside = Repository::new();
    let protected = outside.0.join("protected");
    fs::create_dir(&protected).unwrap();
    fs::write(protected.join("sentinel"), b"retain outside data\n").unwrap();
    let support = repository.0.join(".git/git-khronos-rebase");
    symlink(&protected, &support).unwrap();
    let references = repository.text(&["for-each-ref", "--format=%(refname) %(objectname)"]);
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    let selection = [tip.clone()];
    let steps = [InteractiveRebaseStep {
        oid: tip.clone(),
        action: "edit".into(),
        message: None,
    }];
    assert!(
        execute_interactive_rebase_with_selection(
            &repository.0,
            "main",
            "main",
            &steps,
            Some(&selection)
        )
        .is_err()
    );
    assert_eq!(repository.head(), tip);
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(
        repository.text(&["for-each-ref", "--format=%(refname) %(objectname)"]),
        references
    );
    assert_eq!(
        fs::read(protected.join("sentinel")).unwrap(),
        b"retain outside data\n"
    );
    assert_eq!(fs::read_dir(&protected).unwrap().count(), 1);
    assert!(fs::symlink_metadata(&support).unwrap().is_symlink());
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
}

#[cfg(unix)]
#[test]
fn rebase_abort_never_recursively_deletes_a_linked_support_directory_target() {
    use std::os::unix::fs::symlink;
    let repository = Repository::new();
    let (_, _, tip) = repository.pause(true);
    let outside = Repository::new();
    let protected = outside.0.join("protected");
    fs::create_dir(&protected).unwrap();
    fs::write(protected.join("sentinel"), b"retain outside data\n").unwrap();
    let support = rebase_support_dir(&repository.0).unwrap();
    fs::rename(&support, repository.0.join(".git/parked-support")).unwrap();
    symlink(&protected, &support).unwrap();
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.head(), tip);
    assert_eq!(
        fs::read(protected.join("sentinel")).unwrap(),
        b"retain outside data\n"
    );
    assert_eq!(fs::read_dir(&protected).unwrap().count(), 1);
    assert!(fs::symlink_metadata(&support).unwrap().is_symlink());
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
}

#[cfg(unix)]
#[test]
fn guided_split_refuses_linked_support_ancestors_without_resetting_or_losing_metadata() {
    use std::os::unix::fs::symlink;
    let repository = Repository::new();
    let (_, _, tip) = repository.pause(true);
    let stopped = repository.head();
    begin_rebase_split(&repository.0, &stopped).unwrap();
    let outside = Repository::new();
    let protected = outside.0.join("protected");
    let support = rebase_support_dir(&repository.0).unwrap();
    fs::rename(&support, &protected).unwrap();
    symlink(&protected, &support).unwrap();
    let bytes = fs::read(protected.join("split.json")).unwrap();
    let head = repository.head();
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    assert!(read_status(&repository.0).is_err());
    assert!(begin_rebase_split(&repository.0, &head).is_err());
    assert!(continue_rebase(&repository.0).is_err());
    assert_eq!(repository.head(), head);
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(protected.join("split.json")).unwrap(), bytes);
    // Native Abort remains available when application-owned metadata is refused.
    stage_all(&repository.0).unwrap();
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.head(), tip);
    assert_eq!(fs::read(protected.join("split.json")).unwrap(), bytes);
}

#[test]
fn guided_split_retains_all_files_unstaged_requires_two_parts_and_resumes_exact_suffix() {
    let repository = Repository::new();
    let (base, original, tip) = repository.pause(true);
    let stopped = repository.head();
    begin_rebase_split(&repository.0, &stopped).unwrap();
    assert_eq!(repository.head(), base);
    assert_eq!(
        update_head_message(&repository.0, &base, "Forbidden parent message edit", false)
            .unwrap_err()
            .kind,
        "rebaseSplitCommit"
    );
    let status = read_status(&repository.0).unwrap();
    assert_eq!(status.staged, 0);
    assert_eq!(status.untracked, 1);
    assert_eq!(status.unstaged, 2);
    assert_eq!(status.rebase_split.as_ref().unwrap().part_count, 0);
    assert!(!status.rebase_split.unwrap().preparing);
    assert_eq!(
        continue_rebase(&repository.0).unwrap_err().kind,
        "rebaseSplitIncomplete"
    );
    assert!(begin_rebase_split(&repository.0, &base).is_err());
    assert!(skip_rebase(&repository.0).is_err());
    stage_path(&repository.0, "existing").unwrap();
    commit(&repository.0, "First part").unwrap();
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .rebase_split
            .unwrap()
            .part_count,
        1
    );
    assert_eq!(
        continue_rebase(&repository.0).unwrap_err().kind,
        "rebaseSplitIncomplete"
    );
    stage_all(&repository.0).unwrap();
    assert_eq!(
        continue_rebase(&repository.0).unwrap_err().kind,
        "rebaseSplitIncomplete"
    );
    commit(&repository.0, "Second part").unwrap();
    let status = read_status(&repository.0).unwrap();
    assert_eq!(status.entry_count, 0);
    let split = status.rebase_split.unwrap();
    assert_eq!(split.part_count, 2);
    assert!(split.tree_matches);
    assert_eq!(
        repository.text(&["rev-parse", "HEAD^{tree}"]),
        repository.text(&["rev-parse", &format!("{original}^{{tree}}")])
    );
    continue_rebase(&repository.0).unwrap();
    assert_eq!(repository.text(&["rev-parse", "HEAD~3"]), base);
    assert_eq!(
        repository.text(&["log", "--reverse", "--format=%s", &format!("{base}..HEAD")]),
        "First part\nSecond part\nLater descendant"
    );
    assert_eq!(
        repository.text(&["rev-parse", "HEAD^{tree}"]),
        repository.text(&["rev-parse", &format!("{tip}^{{tree}}")])
    );
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert!(!repository.split_file().exists());
}

#[test]
fn guided_split_refuses_amending_parent_wrong_combined_tree_and_untracked_remaining_changes() {
    let repository = Repository::new();
    let (base, _, _) = repository.pause(false);
    begin_rebase_split(&repository.0, &repository.head()).unwrap();
    assert_eq!(
        commit_with_options(&repository.0, "Forbidden parent amend", true, false, None)
            .unwrap_err()
            .kind,
        "rebaseSplitCommit"
    );
    assert_eq!(repository.head(), base);
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Single combined part").unwrap();
    assert_eq!(
        continue_rebase(&repository.0).unwrap_err().kind,
        "rebaseSplitIncomplete"
    );
    fs::write(repository.0.join("existing"), b"unreviewed extra\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Wrong second tree").unwrap();
    let head = repository.head();
    assert_eq!(
        continue_rebase(&repository.0).unwrap_err().kind,
        "rebaseSplitIncomplete"
    );
    assert_eq!(repository.head(), head);
    fs::write(repository.0.join("existing"), b"reviewed\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Restore combined tree").unwrap();
    fs::write(repository.0.join("extra"), b"untracked keep\n").unwrap();
    assert_eq!(
        continue_rebase(&repository.0).unwrap_err().kind,
        "rebaseSplitIncomplete"
    );
    assert_eq!(
        fs::read(repository.0.join("extra")).unwrap(),
        b"untracked keep\n"
    );
    abort_rebase(&repository.0).unwrap();
    assert_eq!(
        fs::read(repository.0.join("extra")).unwrap(),
        b"untracked keep\n"
    );
}

#[test]
fn guided_split_preflight_refuses_stale_dirty_hidden_and_storage_lock_without_reset() {
    let repository = Repository::new();
    repository.pause(false);
    let head = repository.head();
    assert_eq!(
        begin_rebase_split(&repository.0, &"f".repeat(40))
            .unwrap_err()
            .kind,
        "staleRebaseSplit"
    );
    fs::write(repository.0.join("existing"), b"dirty\n").unwrap();
    assert_eq!(
        begin_rebase_split(&repository.0, &head).unwrap_err().kind,
        "dirtyWorkingTree"
    );
    run_mutation(
        &repository.0,
        &["update-index", "--assume-unchanged", "existing"],
        "hide owned split fixture edit",
    )
    .unwrap();
    assert_eq!(
        begin_rebase_split(&repository.0, &head).unwrap_err().kind,
        "hiddenIndexChanges"
    );
    run_mutation(
        &repository.0,
        &["update-index", "--no-assume-unchanged", "existing"],
        "unhide owned split fixture edit",
    )
    .unwrap();
    fs::write(repository.0.join("existing"), b"reviewed\n").unwrap();
    fs::write(
        repository.split_file().with_extension("json.lock"),
        b"owned external lock",
    )
    .unwrap();
    assert_eq!(
        begin_rebase_split(&repository.0, &head).unwrap_err().kind,
        "rebaseSplitState"
    );
    assert_eq!(repository.head(), head);
    assert_eq!(
        fs::read(repository.split_file().with_extension("json.lock")).unwrap(),
        b"owned external lock"
    );
    assert!(!repository.split_file().exists());
    abort_rebase(&repository.0).unwrap();
}

#[test]
fn guided_split_interrupted_reset_blocks_repeat_and_continue_but_abort_restores_original() {
    let repository = Repository::new();
    let (_, _, tip) = repository.pause(true);
    let head = repository.head();
    let index = rebase_support_dir(&repository.0)
        .unwrap()
        .parent()
        .unwrap()
        .join("index.lock");
    fs::write(&index, b"owned external index lock").unwrap();
    assert!(begin_rebase_split(&repository.0, &head).is_err());
    fs::remove_file(index).unwrap();
    assert!(
        read_status(&repository.0)
            .unwrap()
            .rebase_split
            .unwrap()
            .preparing
    );
    assert!(begin_rebase_split(&repository.0, &head).is_err());
    assert_eq!(
        continue_rebase(&repository.0).unwrap_err().kind,
        "rebaseSplitIncomplete"
    );
    assert_eq!(
        commit(&repository.0, "No automatic recovery")
            .unwrap_err()
            .kind,
        "rebaseSplitCommit"
    );
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.head(), tip);
    assert!(!repository.split_file().exists());
}

#[test]
fn guided_split_malformed_saved_state_errors_explicitly_and_direct_abort_remains_available() {
    let repository = Repository::new();
    let (_, _, tip) = repository.pause(true);
    fs::write(repository.split_file(), b"{\"unknown\":true}").unwrap();
    assert_eq!(
        read_status(&repository.0).unwrap_err().kind,
        "rebaseSplitState"
    );
    assert!(begin_rebase_split(&repository.0, &repository.head()).is_err());
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.head(), tip);
}

#[test]
fn guided_split_abort_after_one_part_restores_original_tip_and_preserves_unrelated_untracked_files()
{
    let repository = Repository::new();
    let (_, _, tip) = repository.pause(true);
    begin_rebase_split(&repository.0, &repository.head()).unwrap();
    stage_path(&repository.0, "existing").unwrap();
    commit(&repository.0, "Partial split").unwrap();
    fs::write(repository.0.join("extra"), b"untracked keep\n").unwrap();
    let failure = abort_rebase(&repository.0).unwrap_err();
    assert!(
        failure
            .hint
            .unwrap()
            .contains("split-created untracked files")
    );
    assert_eq!(fs::read(repository.0.join("new")).unwrap(), b"new file\n");
    assert!(read_status(&repository.0).unwrap().rebase_split.is_some());
    stage_path(&repository.0, "new").unwrap();
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.head(), tip);
    assert_eq!(fs::read(repository.0.join("new")).unwrap(), b"new file\n");
    assert_eq!(
        fs::read(repository.0.join("extra")).unwrap(),
        b"untracked keep\n"
    );
    assert!(
        repository
            .text(&[
                "for-each-ref",
                "--format=%(objectname)",
                "refs/git-khronos/recovery/"
            ])
            .lines()
            .any(|oid| oid == tip)
    );
}

#[cfg(unix)]
#[test]
fn guided_split_commit_hook_refusal_retains_staged_part_for_explicit_retry() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    repository.pause(false);
    begin_rebase_split(&repository.0, &repository.head()).unwrap();
    let hooks = repository.0.join(".git/owned-hooks");
    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("pre-commit");
    fs::write(
        &hook,
        b"#!/bin/sh\necho owned-split-hook-refusal >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
        "configure owned split fixture hook",
    )
    .unwrap();
    stage_path(&repository.0, "existing").unwrap();
    let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    assert!(
        commit(&repository.0, "Explicit part")
            .unwrap_err()
            .message
            .contains("owned-split-hook-refusal")
    );
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .rebase_split
            .unwrap()
            .part_count,
        0
    );
    assert_eq!(
        run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    fs::remove_file(hook).unwrap();
    commit(&repository.0, "Explicit part retry").unwrap();
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .rebase_split
            .unwrap()
            .part_count,
        1
    );
    stage_path(&repository.0, "new").unwrap();
    abort_rebase(&repository.0).unwrap();
}

#[test]
fn guided_split_empty_commit_and_unchanged_tree_permission_are_explicitly_refused() {
    let repository = Repository::new();
    let base = repository.head();
    run_mutation(
        &repository.0,
        &["commit", "--allow-empty", "-m", "Intentional empty"],
        "create owned empty split fixture",
    )
    .unwrap();
    let empty = repository.head();
    let selected = [empty.clone()];
    let steps = [InteractiveRebaseStep {
        oid: empty.clone(),
        action: "edit".to_owned(),
        message: None,
    }];
    execute_interactive_rebase_with_selection(
        &repository.0,
        "main",
        "main",
        &steps,
        Some(&selected),
    )
    .unwrap();
    assert_eq!(
        begin_rebase_split(&repository.0, &repository.head())
            .unwrap_err()
            .kind,
        "rebaseSplitUnavailable"
    );
    assert_eq!(repository.head(), empty);
    assert!(!repository.split_file().exists());
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.text(&["rev-parse", "HEAD^"]), base);

    repository.pause(false);
    begin_rebase_split(&repository.0, &repository.head()).unwrap();
    assert_eq!(
        commit_with_policy(
            &repository.0,
            "Not a split part",
            false,
            false,
            None,
            &CommitPolicy {
                allow_empty: true,
                ..CommitPolicy::default()
            }
        )
        .unwrap_err()
        .kind,
        "rebaseSplitCommit"
    );
    stage_path(&repository.0, "new").unwrap();
    abort_rebase(&repository.0).unwrap();
}

#[test]
fn guided_split_accepts_exactly_500_part_chain_and_refuses_501_or_additional_application_commit() {
    let repository = Repository::new();
    let (base, original, _) = repository.pause(false);
    let original_tree = repository.text(&["rev-parse", &format!("{original}^{{tree}}")]);
    let base_tree = repository.text(&["rev-parse", &format!("{base}^{{tree}}")]);
    begin_rebase_split(&repository.0, &repository.head()).unwrap();
    let mut tip = base;
    for number in 1..=500 {
        let tree = if number % 2 == 1 {
            &original_tree
        } else {
            &base_tree
        };
        tip = repository.text(&[
            "commit-tree",
            tree,
            "-p",
            &tip,
            "-m",
            &format!("Owned split bound part {number}"),
        ]);
    }
    run_mutation(
        &repository.0,
        &["update-ref", "HEAD", &tip],
        "install owned bounded split chain",
    )
    .unwrap();
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .rebase_split
            .unwrap()
            .part_count,
        500
    );
    assert_eq!(
        commit(&repository.0, "Part past limit").unwrap_err().kind,
        "rebaseSplitCommit"
    );
    let beyond = repository.text(&[
        "commit-tree",
        &base_tree,
        "-p",
        &tip,
        "-m",
        "Owned part 501",
    ]);
    run_mutation(
        &repository.0,
        &["update-ref", "HEAD", &beyond],
        "install owned oversized split chain",
    )
    .unwrap();
    assert_eq!(
        read_status(&repository.0).unwrap_err().kind,
        "rebaseSplitState"
    );
    assert_eq!(repository.head(), beyond);
    stage_path(&repository.0, "new").unwrap();
    abort_rebase(&repository.0).unwrap();
}

#[test]
fn guided_split_new_edit_stop_can_start_a_separate_split_without_reusing_previous_parent() {
    let repository = Repository::new();
    fs::write(repository.0.join("existing"), b"one\n").unwrap();
    fs::write(repository.0.join("new"), b"new\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "First compound commit").unwrap();
    let first = repository.head();
    fs::write(repository.0.join("existing"), b"two\n").unwrap();
    fs::write(repository.0.join("new"), b"new two\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Second compound commit").unwrap();
    let original = repository.head();
    let selected = [first];
    let plan =
        prepare_interactive_rebase_with_selection(&repository.0, "main", "main", Some(&selected))
            .unwrap();
    let steps: Vec<_> = plan
        .commits
        .iter()
        .map(|commit| InteractiveRebaseStep {
            oid: commit.oid.clone(),
            action: "edit".to_owned(),
            message: None,
        })
        .collect();
    execute_interactive_rebase_with_selection(
        &repository.0,
        "main",
        "main",
        &steps,
        Some(&selected),
    )
    .unwrap();
    for number in 1..=2 {
        assert!(read_status(&repository.0).unwrap().rebase_split.is_none());
        begin_rebase_split(&repository.0, &repository.head()).unwrap();
        stage_path(&repository.0, "existing").unwrap();
        commit(&repository.0, &format!("Existing part {number}")).unwrap();
        stage_path(&repository.0, "new").unwrap();
        commit(&repository.0, &format!("New part {number}")).unwrap();
        continue_rebase(&repository.0).unwrap();
    }
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert_eq!(
        repository.text(&["rev-parse", "HEAD^{tree}"]),
        repository.text(&["rev-parse", &format!("{original}^{{tree}}")])
    );
    assert_eq!(
        repository.text(&["rev-list", "--count", "HEAD~4..HEAD"]),
        "4"
    );
}

#[test]
fn guided_split_journal_is_worktree_local_and_oversized_or_missing_edit_state_is_not_silently_ignored()
 {
    let repository = Repository::new();
    let linked = repository.0.with_file_name(format!(
        "{}-linked",
        repository.0.file_name().unwrap().to_string_lossy()
    ));
    run_mutation(
        &repository.0,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
        "create owned split isolation fixture",
    )
    .unwrap();
    repository.pause(false);
    begin_rebase_split(&repository.0, &repository.head()).unwrap();
    assert!(read_status(&linked).unwrap().rebase_split.is_none());
    assert!(!read_status(&linked).unwrap().rebase_in_progress);
    let amend = repository.0.join(".git/rebase-merge/amend");
    let saved_amend = fs::read(&amend).unwrap();
    fs::remove_file(&amend).unwrap();
    assert_eq!(
        read_status(&repository.0).unwrap_err().kind,
        "rebaseSplitState"
    );
    fs::write(amend, saved_amend).unwrap();
    fs::write(repository.split_file(), vec![b' '; 4097]).unwrap();
    assert_eq!(
        read_status(&repository.0).unwrap_err().kind,
        "rebaseSplitState"
    );
    stage_path(&repository.0, "new").unwrap();
    abort_rebase(&repository.0).unwrap();
    run_mutation(
        &repository.0,
        &["worktree", "remove", linked.to_str().unwrap()],
        "remove owned split isolation fixture",
    )
    .unwrap();
}
