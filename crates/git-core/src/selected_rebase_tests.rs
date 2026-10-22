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
            "chronos-selected-rebase-{}-{id}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Range Author"],
            vec!["config", "user.email", "range@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            run_mutation(&path, &args, "initialize owned selected-range fixture").unwrap();
        }
        let repository = Self(path);
        repository.edit("base", b"base\n", "Base");
        repository
    }

    fn git(&self, args: &[&str]) {
        run_mutation(&self.0, args, "prepare owned selected-range fixture").unwrap();
    }

    fn output(&self, args: &[&str]) -> String {
        let result = run_git(&self.0, args).unwrap();
        ensure_success("inspect owned selected-range fixture", &result).unwrap();
        String::from_utf8(result.stdout).unwrap().trim().to_owned()
    }

    fn oid(&self) -> String {
        self.output(&["rev-parse", "HEAD"])
    }

    fn edit(&self, path: &str, bytes: &[u8], message: &str) -> String {
        fs::write(self.0.join(path), bytes).unwrap();
        stage_all(&self.0).unwrap();
        commit(&self.0, message).unwrap();
        self.oid()
    }

    fn plan(&self, selected: &[String]) -> InteractiveRebasePlan {
        prepare_interactive_rebase_with_selection(&self.0, "main", "main", Some(selected)).unwrap()
    }

    fn unchanged(&self, original: &str) {
        assert_eq!(self.oid(), original);
        assert!(
            self.output(&[
                "for-each-ref",
                "--format=%(objectname)",
                "refs/git-khronos/recovery/"
            ])
            .is_empty()
        );
        assert!(!rebase_support_dir(&self.0).unwrap().exists());
        assert!(!read_status(&self.0).unwrap().rebase_in_progress);
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn picks(plan: &InteractiveRebasePlan) -> Vec<InteractiveRebaseStep> {
    plan.commits
        .iter()
        .map(|commit| InteractiveRebaseStep {
            oid: commit.oid.clone(),
            action: "pick".to_owned(),
            message: None,
        })
        .collect()
}

#[test]
fn merge_preserving_rebase_recreates_two_parent_topology_without_moving_other_refs() {
    let repository = Repository::new();
    let base = repository.oid();
    repository.git(&["checkout", "-b", "destination"]);
    let destination = repository.edit("destination", b"destination\n", "Destination");
    repository.git(&["checkout", "main"]);
    repository.git(&["checkout", "-b", "side"]);
    let side = repository.edit("side", b"side\n", "Side");
    repository.git(&["checkout", "main"]);
    repository.edit("main", b"main\n", "Main");
    repository.git(&["merge", "--no-ff", "-m", "Reviewed merge", "side"]);
    let original = repository.oid();
    repository.git(&["branch", "keep"]);
    repository.git(&["update-ref", "refs/remotes/origin/main", &original]);
    repository.git(&["tag", "destination", &base]);
    for key in ["rebase.updateRefs", "rebase.autoSquash", "rebase.autoStash"] {
        repository.git(&["config", key, "true"]);
    }
    repository.git(&["config", "rebase.rebaseMerges", "rebase-cousins"]);
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    assert_eq!(plan.request.source_oid, original);
    assert_eq!(plan.request.target_oid, destination);
    assert_eq!(plan.request.base, base);
    assert_eq!(plan.commits.len(), 3);
    assert_eq!(plan.commits.last().unwrap().parents.len(), 2);
    assert_eq!(plan.remote_reachable_oids.len(), 3);
    execute_merge_rebase(&repository.0, &plan.request).unwrap();
    let parents = repository.output(&["rev-list", "--parents", "--max-count=1", "HEAD"]);
    assert_eq!(parents.split_whitespace().count(), 3);
    assert_eq!(repository.output(&["rev-parse", "HEAD^1^"]), destination);
    assert_eq!(repository.output(&["rev-parse", "HEAD^2^"]), destination);
    assert_eq!(
        repository.output(&["log", "--format=%s", "-1"]),
        "Reviewed merge"
    );
    assert_eq!(
        repository.output(&["ls-tree", "--name-only", "HEAD"]),
        "base\ndestination\nmain\nside"
    );
    assert_eq!(repository.output(&["rev-parse", "refs/heads/side"]), side);
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/keep"]),
        original
    );
    assert_eq!(
        repository.output(&["rev-parse", "refs/remotes/origin/main"]),
        original
    );
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/destination"]),
        destination
    );
    assert_eq!(
        repository.output(&["rev-parse", "refs/tags/destination"]),
        base
    );
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
}

#[test]
fn merge_preserving_no_rebase_cousins_keeps_original_side_branch_point() {
    let repository = Repository::new();
    let root = repository.oid();
    repository.git(&["checkout", "-b", "cousin"]);
    let cousin = repository.edit("cousin", b"cousin\n", "Cousin");
    repository.git(&["checkout", "main"]);
    let boundary = repository.edit("boundary", b"boundary\n", "Boundary");
    repository.git(&["checkout", "-b", "destination"]);
    let destination = repository.edit("destination", b"destination\n", "Destination");
    repository.git(&["checkout", "main"]);
    repository.edit("main", b"main\n", "Main");
    repository.git(&["merge", "--no-ff", "-m", "Cousin merge", "cousin"]);
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    assert_eq!(plan.request.base, boundary);
    execute_merge_rebase(&repository.0, &plan.request).unwrap();
    assert_eq!(repository.output(&["rev-parse", "HEAD^1^"]), destination);
    assert_eq!(repository.output(&["rev-parse", "HEAD^2^"]), root);
    assert_eq!(repository.output(&["rev-parse", "HEAD^2"]), cousin);
    assert_eq!(
        repository.output(&["log", "--format=%s", "-1"]),
        "Cousin merge"
    );
}

#[test]
fn merge_preserving_review_refuses_linear_shallow_stale_dirty_hidden_and_recovery_failure() {
    let repository = Repository::new();
    repository.git(&["branch", "destination"]);
    repository.edit("main", b"main\n", "Main");
    assert_eq!(
        prepare_merge_rebase(&repository.0, "main", "destination")
            .unwrap_err()
            .kind,
        "noMergesToPreserve"
    );
    repository.git(&["checkout", "-b", "side", "destination"]);
    repository.edit("side", b"side\n", "Side");
    repository.git(&["checkout", "main"]);
    repository.git(&["merge", "--no-ff", "-m", "Merge", "side"]);
    let original = repository.oid();
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    repository.git(&["update-ref", "refs/heads/destination", &original]);
    assert!(execute_merge_rebase(&repository.0, &plan.request).is_err());
    repository.unchanged(&original);
    repository.git(&[
        "update-ref",
        "refs/heads/destination",
        &plan.request.target_oid,
    ]);
    let appended = repository.edit("appended", b"appended\n", "Appended");
    assert_eq!(
        execute_merge_rebase(&repository.0, &plan.request)
            .unwrap_err()
            .kind,
        "staleMergeRebase"
    );
    repository.unchanged(&appended);
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    fs::write(
        repository.0.join(".git/shallow"),
        format!("{}\n", plan.request.base),
    )
    .unwrap();
    assert_eq!(
        prepare_merge_rebase(&repository.0, "main", "destination")
            .unwrap_err()
            .kind,
        "shallowMergeRebase"
    );
    fs::remove_file(repository.0.join(".git/shallow")).unwrap();
    fs::write(repository.0.join("main"), b"dirty\n").unwrap();
    assert_eq!(
        execute_merge_rebase(&repository.0, &plan.request)
            .unwrap_err()
            .kind,
        "dirtyWorkingTree"
    );
    repository.git(&["update-index", "--assume-unchanged", "main"]);
    assert_eq!(
        execute_merge_rebase(&repository.0, &plan.request)
            .unwrap_err()
            .kind,
        "hiddenIndexChanges"
    );
    assert_eq!(fs::read(repository.0.join("main")).unwrap(), b"dirty\n");
    repository.git(&["update-index", "--no-assume-unchanged", "main"]);
    fs::write(repository.0.join("main"), b"main\n").unwrap();
    let blocked = repository.0.join(".git/refs/git-khronos");
    fs::write(&blocked, b"owned recovery obstruction").unwrap();
    assert!(execute_merge_rebase(&repository.0, &plan.request).is_err());
    assert_eq!(repository.oid(), appended);
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert_eq!(fs::read(blocked).unwrap(), b"owned recovery obstruction");
}

#[test]
fn merge_preserving_preflight_refuses_noncurrent_detached_competing_and_occupied_source() {
    let repository = Repository::new();
    repository.git(&["branch", "destination"]);
    repository.edit("main", b"main\n", "Main");
    repository.git(&["checkout", "-b", "side", "destination"]);
    repository.edit("side", b"side\n", "Side");
    repository.git(&["checkout", "main"]);
    repository.git(&["merge", "--no-ff", "-m", "Merge", "side"]);
    let original = repository.oid();
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    repository.git(&["branch", "other"]);
    repository.git(&["checkout", "other"]);
    assert_eq!(
        execute_merge_rebase(&repository.0, &plan.request)
            .unwrap_err()
            .kind,
        "staleInteractiveRebase"
    );
    repository.unchanged(&original);
    repository.git(&["checkout", "--detach", &original]);
    assert!(execute_merge_rebase(&repository.0, &plan.request).is_err());
    repository.unchanged(&original);
    repository.git(&["checkout", "main"]);
    for marker in ["rebase-merge", "rebase-apply", "sequencer"] {
        let directory = repository.0.join(".git").join(marker);
        fs::create_dir(&directory).unwrap();
        assert!(execute_merge_rebase(&repository.0, &plan.request).is_err());
        assert!(directory.is_dir());
        assert_eq!(repository.oid(), original);
        fs::remove_dir(&directory).unwrap();
        repository.unchanged(&original);
    }
    let cherry_pick = repository.0.join(".git/CHERRY_PICK_HEAD");
    fs::write(&cherry_pick, format!("{original}\n")).unwrap();
    assert_eq!(
        execute_merge_rebase(&repository.0, &plan.request)
            .unwrap_err()
            .kind,
        "historyOperationInProgress"
    );
    assert_eq!(
        fs::read_to_string(&cherry_pick).unwrap(),
        format!("{original}\n")
    );
    fs::remove_file(cherry_pick).unwrap();
    repository.unchanged(&original);
    let occupied = repository.0.join(".git/owned-occupied-worktree");
    repository.git(&[
        "worktree",
        "add",
        "--force",
        occupied.to_str().unwrap(),
        "main",
    ]);
    repository.git(&["worktree", "lock", occupied.to_str().unwrap()]);
    assert_eq!(
        execute_merge_rebase(&repository.0, &plan.request)
            .unwrap_err()
            .kind,
        "branchInAnotherWorktree"
    );
    repository.unchanged(&original);
    assert_eq!(
        run_git(&occupied, &["rev-parse", "HEAD"]).unwrap().stdout,
        format!("{original}\n").as_bytes()
    );
}

#[test]
fn merge_preserving_conflict_reload_continue_and_abort_retain_native_topology() {
    let repository = Repository::new();
    repository.git(&["checkout", "-b", "destination"]);
    let destination = repository.edit("base", b"destination\n", "Destination");
    repository.git(&["checkout", "main"]);
    repository.git(&["checkout", "-b", "side"]);
    repository.edit("side", b"side\n", "Side");
    repository.git(&["checkout", "main"]);
    repository.edit("base", b"source\n", "Source");
    repository.git(&["merge", "--no-ff", "-m", "Merge", "side"]);
    let original = repository.oid();
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    assert!(execute_merge_rebase(&repository.0, &plan.request).is_err());
    assert!(read_status(&repository.0).unwrap().conflicted > 0);
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(fs::read(repository.0.join("base")).unwrap(), b"source\n");
    assert!(execute_merge_rebase(&repository.0, &plan.request).is_err());
    assert!(read_head_status(&repository.0).unwrap().rebase_in_progress);
    fs::write(repository.0.join("base"), b"reviewed resolution\n").unwrap();
    stage_all(&repository.0).unwrap();
    continue_rebase(&repository.0).unwrap();
    assert_eq!(
        repository
            .output(&["rev-list", "--parents", "--max-count=1", "HEAD"])
            .split_whitespace()
            .count(),
        3
    );
    assert_eq!(repository.output(&["rev-parse", "HEAD^1^"]), destination);
    assert_eq!(
        fs::read(repository.0.join("base")).unwrap(),
        b"reviewed resolution\n"
    );
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
}

#[cfg(unix)]
#[test]
fn merge_preserving_actual_hook_refuses_without_unsigned_or_flattened_fallback() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    repository.git(&["branch", "destination"]);
    repository.git(&["checkout", "-b", "side"]);
    repository.edit("side", b"side\n", "Side");
    repository.git(&["checkout", "main"]);
    repository.edit("main", b"main\n", "Main");
    repository.git(&["merge", "--no-ff", "-m", "Merge", "side"]);
    let original = repository.oid();
    let hooks = repository.0.join(".git/owned-hooks");
    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("pre-rebase");
    fs::write(
        &hook,
        b"#!/bin/sh\necho owned-merge-rebase-hook >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    repository.git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    assert!(
        execute_merge_rebase(&repository.0, &plan.request)
            .unwrap_err()
            .message
            .contains("owned-merge-rebase-hook")
    );
    assert_eq!(repository.oid(), original);
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
}

#[test]
fn merge_preserving_manual_merge_resolution_is_not_silently_copied_and_abort_restores_it() {
    let repository = Repository::new();
    repository.git(&["branch", "destination"]);
    repository.git(&["checkout", "-b", "side"]);
    repository.edit("base", b"side\n", "Side");
    repository.git(&["checkout", "main"]);
    repository.edit("base", b"main\n", "Main");
    let merge = run_git(&repository.0, &["merge", "--no-ff", "side"]).unwrap();
    assert!(!merge.status.success());
    fs::write(
        repository.0.join("base"),
        b"Original deliberate merge resolution\n",
    )
    .unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Resolved merge").unwrap();
    let original = repository.oid();
    repository.git(&["checkout", "destination"]);
    repository.edit("destination", b"destination\n", "Destination advanced");
    repository.git(&["checkout", "main"]);
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    assert!(execute_merge_rebase(&repository.0, &plan.request).is_err());
    let status = read_status(&repository.0).unwrap();
    assert!(status.rebase_in_progress);
    assert!(status.conflicted > 0);
    assert!(
        String::from_utf8(fs::read(repository.0.join("base")).unwrap())
            .unwrap()
            .contains("<<<<<<<")
    );
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(
        fs::read(repository.0.join("base")).unwrap(),
        b"Original deliberate merge resolution\n"
    );
}

#[test]
fn merge_preserving_review_accepts_500_reachable_rows_refuses_501_octopus_and_ambiguous_bases() {
    let repository = Repository::new();
    let root = repository.oid();
    let tree = repository.output(&["rev-parse", "HEAD^{tree}"]);
    repository.git(&["branch", "destination"]);
    let side = repository.output(&["commit-tree", &tree, "-p", &root, "-m", "Side"]);
    let mut main = root.clone();
    for index in 0..498 {
        main = repository.output(&[
            "commit-tree",
            &tree,
            "-p",
            &main,
            "-m",
            &format!("Main {index}"),
        ]);
    }
    let merge = repository.output(&[
        "commit-tree",
        &tree,
        "-p",
        &main,
        "-p",
        &side,
        "-m",
        "Merge",
    ]);
    repository.git(&["update-ref", "refs/heads/main", &merge]);
    let plan = prepare_merge_rebase(&repository.0, "main", "destination").unwrap();
    assert_eq!(plan.commits.len(), 500);
    let appended = repository.output(&["commit-tree", &tree, "-p", &merge, "-m", "Row 501"]);
    repository.git(&["update-ref", "refs/heads/main", &appended]);
    assert_eq!(
        prepare_merge_rebase(&repository.0, "main", "destination")
            .unwrap_err()
            .kind,
        "interactiveRebasePlanIncomplete"
    );
    repository.unchanged(&appended);
    let other = repository.output(&["commit-tree", &tree, "-p", &root, "-m", "Other"]);
    let octopus = repository.output(&[
        "commit-tree",
        &tree,
        "-p",
        &root,
        "-p",
        &side,
        "-p",
        &other,
        "-m",
        "Octopus",
    ]);
    repository.git(&["update-ref", "refs/heads/main", &octopus]);
    assert_eq!(
        prepare_merge_rebase(&repository.0, "main", "destination")
            .unwrap_err()
            .kind,
        "unsupportedMergeRebase"
    );
    repository.unchanged(&octopus);
    let x = repository.output(&["commit-tree", &tree, "-p", &side, "-p", &other, "-m", "X"]);
    let y = repository.output(&["commit-tree", &tree, "-p", &other, "-p", &side, "-m", "Y"]);
    repository.git(&["update-ref", "refs/heads/main", &x]);
    repository.git(&["update-ref", "refs/heads/destination", &y]);
    assert_eq!(
        prepare_merge_rebase(&repository.0, "main", "destination")
            .unwrap_err()
            .kind,
        "ambiguousMergeRebase"
    );
    repository.unchanged(&x);
}

#[test]
fn selected_onto_replays_complete_suffix_on_captured_destination_without_moving_refs() {
    let repository = Repository::new();
    let base = repository.oid();
    repository.git(&["checkout", "-b", "destination"]);
    let destination = repository.edit("destination", b"destination\n", "Destination");
    repository.git(&["checkout", "main"]);
    let first = repository.edit("first", b"first\n", "First");
    let original = repository.edit("later", b"later\n", "Later descendant");
    repository.git(&["branch", "keep", &original]);
    repository.git(&["update-ref", "refs/remotes/origin/main", &original]);
    repository.git(&["tag", "destination", &base]);
    for key in [
        "rebase.updateRefs",
        "rebase.autoSquash",
        "rebase.autoStash",
        "rebase.rebaseMerges",
    ] {
        repository.git(&["config", key, "true"]);
    }
    let selected = [first];
    let plan = repository.plan(&selected);
    assert_eq!(plan.base, base);
    let mut steps = picks(&plan);
    steps[0].action = "reword".into();
    steps[0].message = Some("Moved first".into());
    // A moved destination branch does not replace the captured immutable commit.
    repository.git(&["update-ref", "refs/heads/destination", &base]);
    execute_interactive_rebase_with_destination(
        &repository.0,
        "main",
        "main",
        &steps,
        Some(&selected),
        false,
        Some(&destination),
    )
    .unwrap();
    assert_eq!(repository.output(&["rev-parse", "HEAD~2"]), destination);
    assert_eq!(
        repository.output(&["ls-tree", "--name-only", "HEAD"]),
        "base\ndestination\nfirst\nlater"
    );
    assert_eq!(
        repository.output(&[
            "log",
            "--reverse",
            "--format=%s",
            &format!("{destination}..HEAD")
        ]),
        "Moved first\nLater descendant"
    );
    assert_eq!(
        repository.output(&["log", "--format=%an <%ae>", &format!("{destination}..HEAD")]),
        "Range Author <range@example.test>\nRange Author <range@example.test>"
    );
    for reference in ["refs/heads/keep", "refs/remotes/origin/main"] {
        assert_eq!(repository.output(&["rev-parse", reference]), original);
    }
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/destination"]),
        base
    );
    assert_eq!(
        repository.output(&["rev-parse", "refs/tags/destination"]),
        base
    );
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
}

#[test]
fn selected_onto_refuses_missing_tree_in_range_and_wrong_mode_before_recovery() {
    let repository = Repository::new();
    let first = repository.edit("first", b"first\n", "First");
    let original = repository.edit("last", b"last\n", "Last");
    let selected = [first.clone()];
    let plan = repository.plan(&selected);
    let tree = repository.output(&["rev-parse", "HEAD^{tree}"]);
    for destination in [
        first,
        original.clone(),
        tree,
        "f".repeat(40),
        "--invalid".into(),
    ] {
        assert!(
            execute_interactive_rebase_with_destination(
                &repository.0,
                "main",
                "main",
                &picks(&plan),
                Some(&selected),
                false,
                Some(&destination),
            )
            .is_err()
        );
        repository.unchanged(&original);
    }
    let base = plan.base;
    for (selection, root) in [
        (None, false),
        (None, true),
        (Some(selected.as_slice()), true),
    ] {
        assert!(
            execute_interactive_rebase_with_destination(
                &repository.0,
                "main",
                "main",
                &[],
                selection,
                root,
                Some(&base),
            )
            .is_err()
        );
        repository.unchanged(&original);
    }
}

#[test]
fn selected_onto_conflict_continue_and_abort_keep_destination_and_original_history() {
    let repository = Repository::new();
    let base = repository.oid();
    repository.git(&["checkout", "-b", "destination"]);
    let destination = repository.edit("base", b"destination\n", "Destination");
    repository.git(&["checkout", "main"]);
    let first = repository.edit("base", b"source\n", "Source change");
    let original = repository.edit("later", b"later\n", "Later");
    let selected = [first];
    let plan = repository.plan(&selected);
    assert!(
        execute_interactive_rebase_with_destination(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            Some(&selected),
            false,
            Some(&destination),
        )
        .is_err()
    );
    assert!(read_status(&repository.0).unwrap().conflicted > 0);
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(fs::read(repository.0.join("base")).unwrap(), b"source\n");
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/destination"]),
        destination
    );
    assert!(
        execute_interactive_rebase_with_destination(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            Some(&selected),
            false,
            Some(&destination),
        )
        .is_err()
    );
    fs::write(repository.0.join("base"), b"reviewed resolution\n").unwrap();
    stage_all(&repository.0).unwrap();
    continue_rebase(&repository.0).unwrap();
    assert_eq!(repository.output(&["rev-parse", "HEAD~2"]), destination);
    assert_eq!(
        fs::read(repository.0.join("base")).unwrap(),
        b"reviewed resolution\n"
    );
    assert_eq!(fs::read(repository.0.join("later")).unwrap(), b"later\n");
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/destination"]),
        destination
    );
    assert_ne!(repository.output(&["rev-parse", "HEAD~2"]), base);
}

#[test]
fn selected_onto_edit_continue_retains_captured_parent_and_ref_isolation() {
    let repository = Repository::new();
    repository.git(&["checkout", "-b", "destination"]);
    let destination = repository.edit("destination", b"destination\n", "Destination");
    repository.git(&["checkout", "main"]);
    let first = repository.edit("first", b"first\n", "First");
    let original = repository.edit("later", b"later\n", "Later");
    repository.git(&["branch", "keep"]);
    repository.git(&["config", "rebase.updateRefs", "true"]);
    let selected = [first];
    let plan = repository.plan(&selected);
    let mut steps = picks(&plan);
    steps[0].action = "edit".into();
    steps[1].action = "reword".into();
    steps[1].message = Some("Later reviewed".into());
    execute_interactive_rebase_with_destination(
        &repository.0,
        "main",
        "main",
        &steps,
        Some(&selected),
        false,
        Some(&destination),
    )
    .unwrap();
    assert!(read_status(&repository.0).unwrap().rebase_edit_stopped);
    assert_eq!(repository.output(&["rev-parse", "HEAD^"]), destination);
    continue_rebase(&repository.0).unwrap();
    assert_eq!(repository.output(&["rev-parse", "HEAD~2"]), destination);
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/keep"]),
        original
    );
    assert_eq!(
        repository.output(&["log", "--format=%s", "-1"]),
        "Later reviewed"
    );
}

#[test]
fn selected_onto_newly_empty_step_requires_explicit_skip_without_hidden_commit() {
    let repository = Repository::new();
    repository.git(&["checkout", "-b", "destination"]);
    let destination = repository.edit("same", b"same\n", "Destination effect");
    repository.git(&["checkout", "main"]);
    let first = repository.edit("same", b"same\n", "Same source effect");
    let original = repository.edit("later", b"later\n", "Later");
    let selected = [first];
    let plan = repository.plan(&selected);
    assert!(
        execute_interactive_rebase_with_destination(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            Some(&selected),
            false,
            Some(&destination),
        )
        .is_err()
    );
    assert!(read_status(&repository.0).unwrap().rebase_in_progress);
    assert_eq!(repository.oid(), destination);
    skip_rebase(&repository.0).unwrap();
    assert_eq!(repository.output(&["rev-parse", "HEAD^"]), destination);
    assert_eq!(repository.output(&["log", "--format=%s", "-1"]), "Later");
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
}

#[cfg(unix)]
#[test]
fn selected_onto_preserves_hooks_and_refuses_dirty_hidden_and_recovery_obstructions() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let base = repository.oid();
    let first = repository.edit("first", b"first\n", "First");
    let selected = [first.clone()];
    let plan = repository.plan(&selected);
    fs::write(repository.0.join("first"), b"dirty\n").unwrap();
    assert_eq!(
        execute_interactive_rebase_with_destination(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            Some(&selected),
            false,
            Some(&base),
        )
        .unwrap_err()
        .kind,
        "dirtyWorkingTree"
    );
    repository.git(&["update-index", "--assume-unchanged", "first"]);
    assert_eq!(
        execute_interactive_rebase_with_destination(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            Some(&selected),
            false,
            Some(&base),
        )
        .unwrap_err()
        .kind,
        "hiddenIndexChanges"
    );
    assert_eq!(fs::read(repository.0.join("first")).unwrap(), b"dirty\n");
    repository.git(&["update-index", "--no-assume-unchanged", "first"]);
    fs::write(repository.0.join("first"), b"first\n").unwrap();
    let blocked = repository.0.join(".git/refs/git-khronos");
    fs::write(&blocked, b"owned recovery obstruction").unwrap();
    assert!(
        execute_interactive_rebase_with_destination(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            Some(&selected),
            false,
            Some(&base),
        )
        .is_err()
    );
    assert_eq!(repository.oid(), first);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    fs::remove_file(&blocked).unwrap();
    let hooks = repository.0.join(".git/owned-hooks");
    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("pre-rebase");
    fs::write(
        &hook,
        b"#!/bin/sh\necho owned-onto-hook-refusal >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    repository.git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
    let error = execute_interactive_rebase_with_destination(
        &repository.0,
        "main",
        "main",
        &picks(&plan),
        Some(&selected),
        false,
        Some(&base),
    )
    .unwrap_err();
    assert!(error.message.contains("owned-onto-hook-refusal"));
    assert_eq!(repository.oid(), first);
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        first
    );
}

#[test]
fn root_rebase_reviews_actual_root_and_rewords_it_without_moving_unrelated_refs() {
    let repository = Repository::new();
    let root = repository.oid();
    let first = repository.edit("first", b"first\n", "First");
    let original = repository.edit("last", b"last\n", "Last");
    repository.git(&["branch", "keep", &first]);
    repository.git(&["tag", "main", &root]);
    repository.git(&["update-ref", "refs/remotes/origin/main", &first]);
    for key in [
        "rebase.updateRefs",
        "rebase.autoSquash",
        "rebase.autoStash",
        "rebase.rebaseMerges",
    ] {
        repository.git(&["config", key, "true"]);
    }
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    assert!(plan.base.is_empty());
    assert_eq!(plan.commits[0].oid, root);
    assert_eq!(plan.commits.len(), 3);
    assert_eq!(plan.remote_reachable_oids, [root, first.clone()]);
    let mut steps = picks(&plan);
    steps[0].action = "reword".into();
    steps[0].message = Some("Reviewed root\n\nIndependent history".into());
    steps[1].action = "fixup".into();
    execute_interactive_rebase_with_options(&repository.0, "main", "main", &steps, None, true)
        .unwrap();
    assert_eq!(
        repository.output(&["log", "--reverse", "--format=%s"]),
        "Reviewed root\nLast"
    );
    let root_row = repository.output(&["rev-list", "--parents", "--max-parents=0", "HEAD"]);
    assert_eq!(root_row.split_whitespace().count(), 1);
    assert_eq!(
        repository.output(&["rev-parse", "HEAD^{tree}"]),
        repository.output(&["rev-parse", &format!("{original}^{{tree}}")])
    );
    assert_eq!(
        repository.output(&["log", "--format=%an <%ae>"]),
        "Range Author <range@example.test>\nRange Author <range@example.test>"
    );
    for reference in ["refs/heads/keep", "refs/remotes/origin/main"] {
        assert_eq!(repository.output(&["rev-parse", reference]), first);
    }
    assert_eq!(
        repository.output(&["rev-parse", "refs/tags/main"]),
        plan.commits[0].oid
    );
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

#[test]
fn root_rebase_can_drop_the_original_root_but_refuses_all_drop_before_side_effects() {
    let repository = Repository::new();
    let original = repository.edit("independent", b"independent\n", "Independent");
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let mut steps = picks(&plan);
    for step in &mut steps {
        step.action = "drop".into();
    }
    let error =
        execute_interactive_rebase_with_options(&repository.0, "main", "main", &steps, None, true)
            .unwrap_err();
    assert_eq!(error.kind, "invalidRootRebase");
    repository.unchanged(&original);
    steps[1].action = "pick".into();
    execute_interactive_rebase_with_options(&repository.0, "main", "main", &steps, None, true)
        .unwrap();
    assert_eq!(repository.output(&["rev-list", "--count", "HEAD"]), "1");
    assert_eq!(
        repository.output(&["ls-tree", "--name-only", "HEAD"]),
        "independent"
    );
    assert_eq!(repository.output(&["log", "--format=%s"]), "Independent");
}

#[test]
fn root_rebase_edit_restart_continue_and_abort_retain_protected_history() {
    let repository = Repository::new();
    let root = repository.oid();
    let original = repository.edit("last", b"last\n", "Last");
    repository.git(&["branch", "keep", &original]);
    repository.git(&["config", "rebase.updateRefs", "true"]);
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let mut steps = picks(&plan);
    steps[0].action = "edit".into();
    steps[1].action = "reword".into();
    steps[1].message = Some("Later after root Edit".into());
    execute_interactive_rebase_with_options(&repository.0, "main", "main", &steps, None, true)
        .unwrap();
    let status = read_status(&repository.0).unwrap();
    assert!(status.rebase_edit_stopped);
    assert_eq!(repository.oid(), root);
    assert!(begin_rebase_split(&repository.0, &root).is_err());
    assert!(
        !rebase_support_dir(&repository.0)
            .unwrap()
            .join("split.json")
            .exists()
    );
    fs::write(repository.0.join("base"), b"Reviewed root edit\n").unwrap();
    stage_all(&repository.0).unwrap();
    assert!(continue_rebase(&repository.0).is_err());
    update_head_message(&repository.0, &root, "Root after explicit amendment", false).unwrap();
    // Message-only amendment does not silently absorb staged changes.
    assert!(continue_rebase(&repository.0).is_err());
    commit_with_options(
        &repository.0,
        "Root after explicit amendment",
        true,
        false,
        None,
    )
    .unwrap();
    assert!(read_status(&repository.0).unwrap().rebase_edit_stopped);
    continue_rebase(&repository.0).unwrap();
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/keep"]),
        original
    );
    assert_eq!(
        repository.output(&["log", "--reverse", "--format=%s"]),
        "Root after explicit amendment\nLater after root Edit"
    );
    assert_eq!(
        fs::read(repository.0.join("base")).unwrap(),
        b"Reviewed root edit\n"
    );
    let revised =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let revised_tip = repository.oid();
    let mut steps = picks(&revised);
    steps[0].action = "edit".into();
    execute_interactive_rebase_with_options(&repository.0, "main", "main", &steps, None, true)
        .unwrap();
    fs::write(repository.0.join("unrelated"), b"keep\n").unwrap();
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.oid(), revised_tip);
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/keep"]),
        original
    );
    assert_eq!(fs::read(repository.0.join("unrelated")).unwrap(), b"keep\n");
    assert!(
        repository
            .output(&[
                "for-each-ref",
                "--format=%(objectname)",
                "refs/git-khronos/recovery/"
            ])
            .lines()
            .any(|oid| oid == original)
    );
}

#[test]
fn root_rebase_rewords_an_originally_empty_root() {
    let repository = Repository::new();
    repository.git(&["checkout", "--orphan", "empty"]);
    repository.git(&["rm", "-f", "base"]);
    repository.git(&["commit", "--allow-empty", "-m", "Empty root"]);
    repository.git(&["branch", "-D", "main"]);
    repository.git(&["branch", "-m", "main"]);
    let empty = repository.oid();
    let original = repository.edit("later", b"later\n", "Later");
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let mut steps = picks(&plan);
    steps[0].action = "reword".into();
    steps[0].message = Some("Reworded empty root".into());
    execute_interactive_rebase_with_options(&repository.0, "main", "main", &steps, None, true)
        .unwrap();
    assert_eq!(repository.output(&["rev-list", "--count", "HEAD"]), "2");
    assert_eq!(
        repository.output(&["log", "--reverse", "--format=%s"]),
        "Reworded empty root\nLater"
    );
    assert_eq!(
        repository.output(&["rev-parse", "HEAD~^{tree}"]),
        repository.output(&["rev-parse", &format!("{empty}^{{tree}}")])
    );
    assert_eq!(
        repository.output(&["rev-parse", "HEAD^{tree}"]),
        repository.output(&["rev-parse", &format!("{original}^{{tree}}")])
    );
}

#[test]
fn root_rebase_refuses_selected_moving_detached_shallow_merge_and_stale_history() {
    let repository = Repository::new();
    let root = repository.oid();
    let original = repository.edit("last", b"last\n", "Last");
    repository.git(&["branch", "other"]);
    for (source, target, selection) in [
        ("main", "other", None),
        ("main", "main", Some(std::slice::from_ref(&original))),
        ("other", "other", None),
    ] {
        assert!(
            prepare_interactive_rebase_with_options(&repository.0, source, target, selection, true)
                .is_err()
        );
        repository.unchanged(&original);
    }
    repository.git(&["checkout", "--detach"]);
    assert!(
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).is_err()
    );
    repository.unchanged(&original);
    repository.git(&["checkout", "main"]);
    fs::write(repository.0.join(".git/shallow"), format!("{root}\n")).unwrap();
    assert_eq!(
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true)
            .unwrap_err()
            .kind,
        "shallowRootRebase"
    );
    repository.unchanged(&original);
    fs::remove_file(repository.0.join(".git/shallow")).unwrap();
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let appended = repository.edit("appended", b"appended\n", "Appended after review");
    assert!(
        execute_interactive_rebase_with_options(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            None,
            true
        )
        .is_err()
    );
    repository.unchanged(&appended);
    repository.git(&["checkout", "other"]);
    repository.edit("side", b"side\n", "Side");
    repository.git(&["checkout", "main"]);
    repository.git(&["merge", "--no-ff", "--no-edit", "other"]);
    let merge = repository.oid();
    assert_eq!(
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true)
            .unwrap_err()
            .kind,
        "mergeCommitInRebase"
    );
    repository.unchanged(&merge);
}

#[test]
fn root_rebase_conflict_preserves_original_history_and_abort_restores_files() {
    let repository = Repository::new();
    let original = repository.edit("base", b"modified\n", "Modify base");
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let mut steps = picks(&plan);
    steps.reverse();
    assert!(
        execute_interactive_rebase_with_options(&repository.0, "main", "main", &steps, None, true)
            .is_err()
    );
    let status = read_status(&repository.0).unwrap();
    assert!(status.rebase_in_progress);
    assert!(status.conflicted > 0);
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(fs::read(repository.0.join("base")).unwrap(), b"modified\n");
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

#[test]
fn root_rebase_review_accepts_exactly_500_total_commits_and_refuses_501() {
    let repository = Repository::new();
    let tree = repository.output(&["rev-parse", "HEAD^{tree}"]);
    let mut parent = repository.oid();
    for index in 1..500 {
        parent = repository.output(&[
            "commit-tree",
            &tree,
            "-p",
            &parent,
            "-m",
            &format!("Bounded row {index}"),
        ]);
    }
    repository.git(&["update-ref", "refs/heads/main", &parent]);
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    assert_eq!(plan.commits.len(), 500);
    parent = repository.output(&["commit-tree", &tree, "-p", &parent, "-m", "Row 501"]);
    repository.git(&["update-ref", "refs/heads/main", &parent]);
    assert_eq!(
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true)
            .unwrap_err()
            .kind,
        "interactiveRebasePlanIncomplete"
    );
    repository.unchanged(&parent);
}

#[test]
fn root_rebase_dirty_hidden_operation_and_recovery_obstructions_refuse_without_setup() {
    let repository = Repository::new();
    let original = repository.edit("first", b"first\n", "First");
    fs::write(repository.0.join("first"), b"dirty\n").unwrap();
    assert_eq!(
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true)
            .unwrap_err()
            .kind,
        "dirtyWorkingTree"
    );
    repository.git(&["update-index", "--assume-unchanged", "first"]);
    assert_eq!(
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true)
            .unwrap_err()
            .kind,
        "hiddenIndexChanges"
    );
    assert_eq!(fs::read(repository.0.join("first")).unwrap(), b"dirty\n");
    repository.git(&["update-index", "--no-assume-unchanged", "first"]);
    fs::write(repository.0.join("first"), b"first\n").unwrap();
    let competing = repository.0.join(".git/rebase-apply");
    fs::create_dir(&competing).unwrap();
    assert!(
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).is_err()
    );
    assert!(competing.is_dir());
    assert_eq!(repository.oid(), original);
    fs::remove_dir(&competing).unwrap();
    repository.unchanged(&original);
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let blocked = repository.0.join(".git/refs/git-khronos");
    fs::write(&blocked, b"owned recovery obstruction").unwrap();
    assert!(
        execute_interactive_rebase_with_options(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            None,
            true
        )
        .is_err()
    );
    assert_eq!(repository.oid(), original);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    assert_eq!(fs::read(blocked).unwrap(), b"owned recovery obstruction");
}

#[cfg(unix)]
#[test]
fn root_rebase_respects_actual_hook_refusal_and_protects_the_original_tip() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let original = repository.edit("last", b"last\n", "Last");
    let hooks = repository.0.join(".git/owned-hooks");
    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("pre-rebase");
    fs::write(
        &hook,
        b"#!/bin/sh\necho owned-root-hook-refusal >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    repository.git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let error = execute_interactive_rebase_with_options(
        &repository.0,
        "main",
        "main",
        &picks(&plan),
        None,
        true,
    )
    .unwrap_err();
    assert!(error.message.contains("owned-root-hook-refusal"));
    assert_eq!(repository.oid(), original);
    assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
}

#[test]
fn selected_rebase_reviews_entire_suffix_preserves_base_and_unrelated_refs_with_configured_update_refs()
 {
    let repository = Repository::new();
    let base = repository.oid();
    let first = repository.edit("first", b"first\n", "First");
    let second = repository.edit("second", b"second\n", "Second");
    let last = repository.edit("last", b"last\n", "Later descendant");
    repository.git(&["branch", "keep", &second]);
    repository.git(&["tag", "main", &base]);
    repository.git(&["update-ref", "refs/remotes/origin/main", &second]);
    for key in ["rebase.updateRefs", "rebase.autoSquash", "rebase.autoStash"] {
        repository.git(&["config", key, "true"]);
    }
    let selected = [first.clone(), second.clone()];
    let plan = repository.plan(&selected);
    assert_eq!(plan.base, base);
    assert_eq!(
        plan.commits
            .iter()
            .map(|commit| &commit.oid)
            .collect::<Vec<_>>(),
        [&first, &second, &last]
    );
    assert_eq!(plan.remote_reachable_oids, selected);
    let mut steps = picks(&plan);
    steps[0].action = "reword".to_owned();
    steps[0].message = Some("Reviewed first\n\nOriginal requirement preserved".to_owned());
    steps[1].action = "fixup".to_owned();
    execute_interactive_rebase_with_selection(
        &repository.0,
        "main",
        "main",
        &steps,
        Some(&selected),
    )
    .unwrap();
    assert_eq!(repository.output(&["rev-parse", "HEAD~2"]), base);
    assert_eq!(
        repository.output(&["log", "--reverse", "--format=%s", &format!("{base}..HEAD")]),
        "Reviewed first\nLater descendant"
    );
    assert_eq!(
        repository.output(&["rev-parse", "HEAD^{tree}"]),
        repository.output(&["rev-parse", &format!("{last}^{{tree}}")])
    );
    for reference in ["refs/heads/keep", "refs/remotes/origin/main"] {
        assert_eq!(repository.output(&["rev-parse", reference]), second);
    }
    assert_eq!(repository.output(&["rev-parse", "refs/tags/main"]), base);
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        last
    );
    assert_eq!(
        read_status(&repository.0).unwrap().branch.as_deref(),
        Some("main")
    );
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

#[test]
fn selected_rebase_rejects_noncontiguous_reversed_duplicate_unrelated_root_missing_and_invalid_selections()
 {
    let repository = Repository::new();
    let base = repository.oid();
    let first = repository.edit("first", b"first\n", "First");
    let second = repository.edit("second", b"second\n", "Second");
    let last = repository.edit("last", b"last\n", "Last");
    repository.git(&["checkout", "-b", "other", &base]);
    let outside = repository.edit("outside", b"outside\n", "Outside selection");
    repository.git(&["checkout", "main"]);
    for selected in [
        vec![],
        vec![first.clone(), last.clone()],
        vec![second.clone(), first.clone()],
        vec![first.clone(), first.to_ascii_uppercase()],
        vec![outside],
        vec![base],
        vec!["f".repeat(40)],
        vec!["HEAD".to_owned()],
        vec![first.clone(); 501],
    ] {
        assert!(
            prepare_interactive_rebase_with_selection(
                &repository.0,
                "main",
                "main",
                Some(&selected)
            )
            .is_err()
        );
        assert!(
            execute_interactive_rebase_with_selection(
                &repository.0,
                "main",
                "main",
                &[],
                Some(&selected)
            )
            .is_err()
        );
        repository.unchanged(&last);
    }
    assert!(
        prepare_interactive_rebase_with_selection(&repository.0, "main", "other", Some(&[first]))
            .is_err()
    );
    repository.unchanged(&last);
}

#[test]
fn selected_rebase_revalidates_appended_tip_current_branch_and_recovery_before_mutation() {
    let repository = Repository::new();
    let first = repository.edit("first", b"first\n", "First");
    let selected = [first];
    let old_plan = repository.plan(&selected);
    let original = repository.edit("later", b"later\n", "Appended after review");
    let steps = picks(&old_plan);
    assert_eq!(
        execute_interactive_rebase_with_selection(
            &repository.0,
            "main",
            "main",
            &steps,
            Some(&selected)
        )
        .unwrap_err()
        .kind,
        "staleInteractiveRebase"
    );
    repository.unchanged(&original);
    repository.git(&["checkout", "-b", "switched"]);
    assert_eq!(
        prepare_interactive_rebase_with_selection(&repository.0, "main", "main", Some(&selected))
            .unwrap_err()
            .kind,
        "staleInteractiveRebase"
    );
    assert_eq!(
        read_status(&repository.0).unwrap().branch.as_deref(),
        Some("switched")
    );
    repository.unchanged(&original);
    repository.git(&["checkout", "main"]);
    let plan = repository.plan(&selected);
    let blocked = repository.0.join(".git/refs/git-khronos");
    fs::write(&blocked, b"owned recovery obstruction").unwrap();
    assert!(
        execute_interactive_rebase_with_selection(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            Some(&selected)
        )
        .is_err()
    );
    assert_eq!(repository.oid(), original);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    assert_eq!(fs::read(blocked).unwrap(), b"owned recovery obstruction");
}

#[test]
fn selected_rebase_dirty_hidden_and_native_operation_state_are_preserved_on_refusal() {
    let repository = Repository::new();
    let first = repository.edit("first", b"first\n", "First");
    let selected = [first.clone()];
    fs::write(repository.0.join("first"), b"dirty\n").unwrap();
    assert_eq!(
        prepare_interactive_rebase_with_selection(&repository.0, "main", "main", Some(&selected))
            .unwrap_err()
            .kind,
        "dirtyWorkingTree"
    );
    assert_eq!(fs::read(repository.0.join("first")).unwrap(), b"dirty\n");
    repository.git(&["update-index", "--assume-unchanged", "first"]);
    assert_eq!(
        prepare_interactive_rebase_with_selection(&repository.0, "main", "main", Some(&selected))
            .unwrap_err()
            .kind,
        "hiddenIndexChanges"
    );
    repository.git(&["update-index", "--no-assume-unchanged", "first"]);
    fs::write(repository.0.join("first"), b"first\n").unwrap();
    fs::create_dir(repository.0.join(".git/rebase-apply")).unwrap();
    assert!(
        prepare_interactive_rebase_with_selection(&repository.0, "main", "main", Some(&selected))
            .is_err()
    );
    assert_eq!(repository.oid(), first);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

#[test]
fn selected_rebase_refuses_merge_descendants_without_flattening_or_support_writes() {
    let repository = Repository::new();
    let first = repository.edit("first", b"first\n", "First");
    repository.git(&["checkout", "-b", "side"]);
    repository.edit("side", b"side\n", "Side");
    repository.git(&["checkout", "main"]);
    repository.edit("main", b"main\n", "Main");
    repository.git(&["merge", "--no-ff", "--no-edit", "side"]);
    let original = repository.oid();
    assert_eq!(
        prepare_interactive_rebase_with_selection(&repository.0, "main", "main", Some(&[first]))
            .unwrap_err()
            .kind,
        "mergeCommitInRebase"
    );
    repository.unchanged(&original);
}

#[test]
fn selected_rebase_edit_stop_survives_reload_and_abort_restores_whole_reviewed_suffix() {
    let repository = Repository::new();
    let first = repository.edit("first", b"first\n", "First");
    let original = repository.edit("later", b"later\n", "Later");
    let selected = [first];
    let plan = repository.plan(&selected);
    let mut steps = picks(&plan);
    steps[0].action = "edit".to_owned();
    execute_interactive_rebase_with_selection(
        &repository.0,
        "main",
        "main",
        &steps,
        Some(&selected),
    )
    .unwrap();
    assert!(read_status(&repository.0).unwrap().rebase_edit_stopped);
    assert!(repository.output(&["rev-parse", "HEAD"]).len() == 40);
    assert!(rebase_support_dir(&repository.0).unwrap().exists());
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(
        read_status(&repository.0).unwrap().branch.as_deref(),
        Some("main")
    );
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
}

#[test]
fn selected_rebase_preserves_empty_commits_and_unknown_publication_without_remote_tracking_refs() {
    let repository = Repository::new();
    let base = repository.oid();
    repository.git(&["commit", "--allow-empty", "-m", "Intentional empty"]);
    let empty = repository.oid();
    let original = repository.edit("later", b"later\n", "Later");
    let selected = [empty.clone()];
    let plan = repository.plan(&selected);
    assert!(plan.remote_reachable_oids.is_empty());
    let mut steps = picks(&plan);
    steps[0].action = "reword".to_owned();
    steps[0].message = Some("Reviewed intentional empty".to_owned());
    execute_interactive_rebase_with_selection(
        &repository.0,
        "main",
        "main",
        &steps,
        Some(&selected),
    )
    .unwrap();
    assert_eq!(
        repository.output(&["log", "--reverse", "--format=%s", &format!("{base}..HEAD")]),
        "Reviewed intentional empty\nLater"
    );
    assert_eq!(
        repository.output(&["rev-parse", "HEAD~1^{tree}"]),
        repository.output(&["rev-parse", &format!("{base}^{{tree}}")])
    );
    assert_eq!(
        repository.output(&["rev-parse", "HEAD^{tree}"]),
        repository.output(&["rev-parse", &format!("{original}^{{tree}}")])
    );
}

#[test]
fn selected_rebase_conflict_and_later_conflict_continue_remain_abortable_with_original_tree() {
    let repository = Repository::new();
    let first = repository.edit("base", b"one\n", "First");
    let original = repository.edit("base", b"two\n", "Later");
    let selected = [first];
    let plan = repository.plan(&selected);
    let mut steps = picks(&plan);
    steps.reverse();
    assert_eq!(
        execute_interactive_rebase_with_selection(
            &repository.0,
            "main",
            "main",
            &steps,
            Some(&selected)
        )
        .unwrap_err()
        .kind,
        "rebaseConflict"
    );
    assert!(read_status(&repository.0).unwrap().conflicted > 0);
    assert!(!read_status(&repository.0).unwrap().rebase_edit_stopped);
    fs::write(repository.0.join("base"), b"two\n").unwrap();
    stage_all(&repository.0).unwrap();
    assert_eq!(
        continue_rebase(&repository.0).unwrap_err().kind,
        "rebaseConflict"
    );
    assert!(read_status(&repository.0).unwrap().conflicted > 0);
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(fs::read(repository.0.join("base")).unwrap(), b"two\n");
    assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

#[test]
fn selected_rebase_complete_suffix_accepts_500_and_refuses_501_without_partial_plan() {
    let repository = Repository::new();
    let tree = repository.output(&["rev-parse", "HEAD^{tree}"]);
    let mut tip = repository.oid();
    let mut oids = vec![];
    for index in 0..501 {
        tip = repository.output(&[
            "commit-tree",
            &tree,
            "-p",
            &tip,
            "-m",
            &format!("Owned empty row {index}"),
        ]);
        oids.push(tip.clone());
    }
    repository.git(&["update-ref", "refs/heads/main", &tip]);
    assert_eq!(
        prepare_interactive_rebase_with_selection(
            &repository.0,
            "main",
            "main",
            Some(&[oids[0].clone()])
        )
        .unwrap_err()
        .kind,
        "interactiveRebasePlanIncomplete"
    );
    repository.unchanged(&tip);
    let plan = repository.plan(&[oids[1].clone()]);
    assert_eq!(plan.commits.len(), 500);
    assert_eq!(plan.commits[0].oid, oids[1]);
    assert_eq!(plan.commits[499].oid, tip);
    assert!(plan.remote_reachable_oids.is_empty());
    repository.unchanged(&tip);
}

#[cfg(unix)]
#[test]
fn selected_rebase_respects_actual_pre_rebase_hook_refusal_and_retains_protected_tip() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let original = repository.edit("first", b"first\n", "First");
    let selected = [original.clone()];
    let hooks = repository.0.join(".git/owned-hooks");
    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("pre-rebase");
    fs::write(
        &hook,
        b"#!/bin/sh\necho owned-range-hook-refusal >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    repository.git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
    let plan = repository.plan(&selected);
    let error = execute_interactive_rebase_with_selection(
        &repository.0,
        "main",
        "main",
        &picks(&plan),
        Some(&selected),
    )
    .unwrap_err();
    assert!(error.message.contains("owned-range-hook-refusal"));
    assert_eq!(repository.oid(), original);
    assert_eq!(read_status(&repository.0).unwrap().entry_count, 0);
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
}

#[test]
fn selected_rebase_continue_after_edit_keeps_unrelated_refs_and_original_author_with_auto_updates_configured()
 {
    let repository = Repository::new();
    let base = repository.oid();
    let first = repository.edit("first", b"first\n", "First");
    let original = repository.edit("later", b"later\n", "Later");
    repository.git(&["branch", "keep", &original]);
    repository.git(&["config", "rebase.updateRefs", "true"]);
    let selected = [first];
    let plan = repository.plan(&selected);
    let mut steps = picks(&plan);
    steps[0].action = "edit".to_owned();
    steps[1].action = "reword".to_owned();
    steps[1].message = Some("Reviewed later message".to_owned());
    execute_interactive_rebase_with_selection(
        &repository.0,
        "main",
        "main",
        &steps,
        Some(&selected),
    )
    .unwrap();
    assert!(read_status(&repository.0).unwrap().rebase_edit_stopped);
    continue_rebase(&repository.0).unwrap();
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert_ne!(repository.oid(), original);
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/keep"]),
        original
    );
    assert_eq!(repository.output(&["rev-parse", "HEAD~2"]), base);
    assert_eq!(
        repository.output(&[
            "log",
            "--reverse",
            "--format=%s%n%an <%ae>",
            &format!("{base}..HEAD")
        ]),
        "First\nRange Author <range@example.test>\nReviewed later message\nRange Author <range@example.test>"
    );
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

#[test]
fn root_onto_replays_entire_history_on_captured_destination_without_moving_refs() {
    let repository = Repository::new();
    let root = repository.oid();
    let first = repository.edit("first", b"first\n", "First");
    let original = repository.edit("last", b"last\n", "Last");
    repository.git(&["switch", "-q", "--orphan", "platform"]);
    let platform = repository.edit("platform", b"platform\n", "Platform");
    repository.git(&["switch", "-q", "main"]);
    repository.git(&["branch", "keep", &first]);
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    assert_eq!(plan.commits[0].oid, root);
    for inside in [&root, &first, &original] {
        let error = execute_interactive_rebase_with_destination(
            &repository.0,
            "main",
            "main",
            &picks(&plan),
            None,
            true,
            Some(inside),
        )
        .unwrap_err();
        assert_eq!(error.kind, "invalidRebaseDestination");
        repository.unchanged(&original);
    }
    let mut steps = picks(&plan);
    steps[0].action = "reword".into();
    steps[0].message = Some("Base on platform".into());
    execute_interactive_rebase_with_destination(
        &repository.0,
        "main",
        "main",
        &steps,
        None,
        true,
        Some(&platform),
    )
    .unwrap();
    assert_eq!(
        repository.output(&["log", "--reverse", "--format=%s"]),
        "Platform\nBase on platform\nFirst\nLast"
    );
    assert_eq!(repository.output(&["rev-parse", "HEAD~2^"]), platform);
    assert_eq!(
        repository.output(&["ls-tree", "--name-only", "HEAD"]),
        "base\nfirst\nlast\nplatform"
    );
    assert_eq!(
        repository.output(&["rev-parse", "refs/heads/platform"]),
        platform
    );
    assert_eq!(repository.output(&["rev-parse", "refs/heads/keep"]), first);
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
    assert!(!read_status(&repository.0).unwrap().rebase_in_progress);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

#[test]
fn root_onto_conflict_stops_for_explicit_resolution_and_abort_restores_history() {
    let repository = Repository::new();
    let original = repository.edit("first", b"first\n", "First");
    repository.git(&["switch", "-q", "--orphan", "other"]);
    let other = repository.edit("base", b"different base\n", "Other base");
    repository.git(&["switch", "-q", "main"]);
    let plan =
        prepare_interactive_rebase_with_options(&repository.0, "main", "main", None, true).unwrap();
    let error = execute_interactive_rebase_with_destination(
        &repository.0,
        "main",
        "main",
        &picks(&plan),
        None,
        true,
        Some(&other),
    );
    assert!(error.is_err() || read_status(&repository.0).unwrap().rebase_in_progress);
    let status = read_status(&repository.0).unwrap();
    assert!(status.rebase_in_progress);
    assert_eq!(status.conflicted, 1);
    abort_rebase(&repository.0).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(repository.output(&["rev-parse", "refs/heads/other"]), other);
    assert_eq!(
        repository.output(&[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/"
        ]),
        original
    );
}
