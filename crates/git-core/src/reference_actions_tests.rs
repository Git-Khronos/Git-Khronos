use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

struct Repository(PathBuf);

impl Repository {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("chronos-ref-actions-{}-{id}", std::process::id()));
        fs::create_dir(&root).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Test"],
            vec!["config", "user.email", "test@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            run_mutation(&root, &args, "initialize fixture").unwrap();
        }
        fs::write(root.join("file"), b"base\n").unwrap();
        stage_all(&root).unwrap();
        commit(&root, "Baseline").unwrap();
        Self(root)
    }

    fn oid(&self) -> String {
        String::from_utf8_lossy(&run_git(&self.0, &["rev-parse", "HEAD"]).unwrap().stdout)
            .trim()
            .to_owned()
    }

    fn remote_refs(&self, name: &str) -> Vec<u8> {
        let remote = self.0.join(format!("{name}.git"));
        let output = run_git(
            &self.0,
            &[
                "--git-dir",
                remote.to_str().unwrap(),
                "for-each-ref",
                "--format=%(refname)",
            ],
        )
        .unwrap();
        ensure_success("read bare remote refs", &output).unwrap();
        output.stdout
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn commit_identity(name: &str, email: &str) -> CommitIdentity {
    CommitIdentity {
        name: name.into(),
        email: email.into(),
    }
}

#[test]
fn interactive_rebase_metadata_is_lossless_and_rejects_incomplete_records() {
    let oid = "a".repeat(40);
    let body = "  Subject\u{1f} field\n\nBody\u{1e} record\n\n";
    let record = format!("{oid}\0Test\0test@example.test\0Subject\0{body}\0");
    let parsed = parse_interactive_rebase_commits(record.as_bytes()).unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].message, body);
    assert_eq!(parsed[0].subject, "Subject");
    for invalid in [
        record.trim_end_matches('\0').as_bytes().to_vec(),
        format!("{oid}\0Test\0test@example.test\0Subject\0body\0extra\0").into_bytes(),
        b"bad-oid\0Test\0test@example.test\0Subject\0body\0".to_vec(),
        [record.as_bytes(), record.as_bytes()].concat(),
        format!("{oid}\0Test\0test@example.test\0Subject\0body\0")
            .replace("body", "bad\0body")
            .into_bytes(),
        format!("{oid}\0Test\0test@example.test\0Subject\0")
            .into_bytes()
            .into_iter()
            .chain([0xff, 0])
            .collect(),
    ] {
        assert_eq!(
            parse_interactive_rebase_commits(&invalid).unwrap_err().kind,
            "invalidInteractiveRebasePlan"
        );
    }
    for (length, accepted) in [
        (MAX_COMMIT_MESSAGE_BYTES, true),
        (MAX_COMMIT_MESSAGE_BYTES + 1, false),
    ] {
        let record = format!(
            "{oid}\0Test\0test@example.test\0Subject\0{}\0",
            "x".repeat(length)
        );
        assert_eq!(
            parse_interactive_rebase_commits(record.as_bytes()).is_ok(),
            accepted
        );
    }
}

fn rebase_plan_commit(path: &Path, parent: &str, message: &[u8]) -> String {
    let tree = run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap();
    ensure_success("read fixture tree", &tree).unwrap();
    let mut object = format!(
        "tree {}\nparent {parent}\nauthor Test <test@example.test> 1700000000 +0000\ncommitter Test <test@example.test> 1700000000 +0000\n\n",
        String::from_utf8(tree.stdout).unwrap().trim()
    ).into_bytes();
    object.extend_from_slice(message);
    let mut child = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["hash-object", "-t", "commit", "-w", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(&object).unwrap();
    let output = child.wait_with_output().unwrap();
    ensure_success("create owned fixture commit", &output).unwrap();
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[test]
fn interactive_rebase_uses_local_branch_refs_when_tags_have_the_same_names() {
    let repository = Repository::new();
    let path = &repository.0;
    let base = repository.oid();
    fs::write(path.join("target"), b"main contents\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Target branch commit").unwrap();
    let target = repository.oid();
    run_mutation(
        path,
        &["checkout", "-b", "feature", &base],
        "create source branch",
    )
    .unwrap();
    let mut source_oids = Vec::new();
    for name in ["source-a", "source-b"] {
        fs::write(path.join(name), format!("{name}\n")).unwrap();
        stage_all(path).unwrap();
        commit(path, name).unwrap();
        source_oids.push(repository.oid());
    }
    let original = repository.oid();
    run_mutation(path, &["checkout", "main"], "return to target branch").unwrap();
    run_mutation(
        path,
        &["tag", "feature", &target],
        "create colliding source tag",
    )
    .unwrap();
    run_mutation(
        path,
        &["tag", "main", &original],
        "create colliding target tag",
    )
    .unwrap();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    assert_eq!(plan.base, base);
    assert_eq!(
        plan.commits
            .iter()
            .map(|commit| commit.oid.clone())
            .collect::<Vec<_>>(),
        source_oids
    );
    let steps = plan
        .commits
        .iter()
        .map(|commit| InteractiveRebaseStep {
            oid: commit.oid.clone(),
            action: "pick".into(),
            message: None,
        })
        .collect::<Vec<_>>();
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap();
    for name in ["target", "source-a", "source-b"] {
        assert!(path.join(name).is_file(), "{name}");
    }
    for (reference, expected) in [
        ("refs/heads/main", target.as_str()),
        ("refs/tags/feature", target.as_str()),
        ("refs/tags/main", original.as_str()),
        ("HEAD~2", target.as_str()),
    ] {
        let output = run_git(path, &["rev-parse", reference]).unwrap();
        ensure_success("inspect exact fixture refs", &output).unwrap();
        assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), expected);
    }
    assert_eq!(
        read_status(path).unwrap().branch.as_deref(),
        Some("feature")
    );
}

#[test]
fn interactive_rebase_real_log_preserves_control_characters_and_message_whitespace() {
    let repository = Repository::new();
    let message = b"Subject\x1fpart\n\n Body\x1epart\n\n";
    let oid = rebase_plan_commit(&repository.0, &repository.oid(), message);
    run_mutation(
        &repository.0,
        &["branch", "feature", &oid],
        "create fixture branch",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["config", "log.showSignature", "true"],
        "set log display policy",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["notes", "add", "-m", "Note not part of message", &oid],
        "annotate fixture",
    )
    .unwrap();
    let plan = prepare_interactive_rebase(&repository.0, "feature", "main").unwrap();
    assert_eq!(plan.commits.len(), 1);
    assert_eq!(plan.commits[0].oid, oid);
    assert_eq!(plan.commits[0].subject, "Subject\u{1f}part");
    assert_eq!(plan.commits[0].message.as_bytes(), message);
    assert_eq!(repository.oid(), plan.base);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

#[test]
fn interactive_rebase_real_log_refuses_invalid_utf8_and_oversized_individual_messages() {
    for message in [
        b"Invalid\xff\n".to_vec(),
        vec![b'x'; MAX_COMMIT_MESSAGE_BYTES + 1],
    ] {
        let repository = Repository::new();
        let original = repository.oid();
        let oid = rebase_plan_commit(&repository.0, &original, &message);
        run_mutation(
            &repository.0,
            &["branch", "feature", &oid],
            "create fixture branch",
        )
        .unwrap();
        assert_eq!(
            prepare_interactive_rebase(&repository.0, "feature", "main")
                .unwrap_err()
                .kind,
            "invalidInteractiveRebasePlan"
        );
        assert_eq!(repository.oid(), original);
        assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    }
}

#[test]
fn interactive_rebase_review_limits_refuse_partial_plans_at_exact_boundaries() {
    let repository = Repository::new();
    let original = repository.oid();
    let mut parent = original.clone();
    for index in 0..MAX_INTERACTIVE_REBASE_COMMITS {
        parent = rebase_plan_commit(
            &repository.0,
            &parent,
            format!("Commit {index}\n").as_bytes(),
        );
    }
    run_mutation(
        &repository.0,
        &["branch", "feature", &parent],
        "create fixture branch",
    )
    .unwrap();
    let plan = prepare_interactive_rebase(&repository.0, "feature", "main").unwrap();
    assert_eq!(plan.commits.len(), MAX_INTERACTIVE_REBASE_COMMITS);
    assert_eq!(plan.commits.last().unwrap().oid, parent);
    let extra = rebase_plan_commit(&repository.0, &parent, b"One more\n");
    run_mutation(
        &repository.0,
        &["update-ref", "refs/heads/feature", &extra],
        "extend fixture branch",
    )
    .unwrap();
    assert_eq!(
        prepare_interactive_rebase(&repository.0, "feature", "main")
            .unwrap_err()
            .kind,
        "interactiveRebasePlanIncomplete"
    );
    assert_eq!(repository.oid(), original);
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());

    let oversized = Repository::new();
    let original = oversized.oid();
    let mut parent = original.clone();
    for index in 0..10 {
        let message = format!("{index}\n{}", "x".repeat(220_000));
        parent = rebase_plan_commit(&oversized.0, &parent, message.as_bytes());
    }
    run_mutation(
        &oversized.0,
        &["branch", "feature", &parent],
        "create large-message branch",
    )
    .unwrap();
    assert_eq!(
        prepare_interactive_rebase(&oversized.0, "feature", "main")
            .unwrap_err()
            .kind,
        "interactiveRebasePlanIncomplete"
    );
    assert_eq!(oversized.oid(), original);
    assert!(!rebase_support_dir(&oversized.0).unwrap().exists());
}

#[test]
fn interactive_rebase_preflight_rechecks_operations_before_support_or_recovery_writes() {
    for marker in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_START",
    ] {
        let repository = Repository::new();
        let original = repository.oid();
        let oid = rebase_plan_commit(&repository.0, &original, b"Source\n");
        run_mutation(
            &repository.0,
            &["branch", "feature", &oid],
            "create fixture branch",
        )
        .unwrap();
        let plan = prepare_interactive_rebase(&repository.0, "feature", "main").unwrap();
        fs::write(
            repository.0.join(".git").join(marker),
            format!("{original}\n"),
        )
        .unwrap();
        let steps = plan
            .commits
            .iter()
            .map(|commit| InteractiveRebaseStep {
                oid: commit.oid.clone(),
                action: "pick".into(),
                message: None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            prepare_interactive_rebase(&repository.0, "feature", "main")
                .unwrap_err()
                .kind,
            "historyOperationInProgress",
            "{marker}"
        );
        assert_eq!(
            execute_interactive_rebase(&repository.0, "feature", "main", &steps)
                .unwrap_err()
                .kind,
            "historyOperationInProgress",
            "{marker}"
        );
        assert_eq!(repository.oid(), original);
        assert_eq!(
            fs::read(repository.0.join(".git").join(marker)).unwrap(),
            format!("{original}\n").as_bytes()
        );
        assert!(
            run_git(
                &repository.0,
                &[
                    "for-each-ref",
                    "--format=%(refname)",
                    "refs/git-khronos/recovery/"
                ]
            )
            .unwrap()
            .stdout
            .is_empty()
        );
        assert!(!rebase_support_dir(&repository.0).unwrap().exists());
    }
}

#[test]
fn interactive_rebase_refuses_occupied_and_missing_source_worktrees_without_partial_changes() {
    let repository = Repository::new();
    let original = repository.oid();
    let oid = rebase_plan_commit(&repository.0, &original, b"Source\n");
    run_mutation(
        &repository.0,
        &["branch", "feature", &oid],
        "create fixture branch",
    )
    .unwrap();
    let plan = prepare_interactive_rebase(&repository.0, "feature", "main").unwrap();
    let steps = plan
        .commits
        .iter()
        .map(|commit| InteractiveRebaseStep {
            oid: commit.oid.clone(),
            action: "pick".into(),
            message: None,
        })
        .collect::<Vec<_>>();
    let linked = repository.0.join("nested-linked");
    run_mutation(
        &repository.0,
        &["worktree", "add", linked.to_str().unwrap(), "feature"],
        "add nested fixture worktree",
    )
    .unwrap();
    assert_eq!(
        prepare_interactive_rebase(&repository.0, "feature", "main")
            .unwrap_err()
            .kind,
        "dirtyWorkingTree"
    );
    fs::write(repository.0.join(".git/info/exclude"), b"/nested-linked/\n").unwrap();
    assert_eq!(
        prepare_interactive_rebase(&repository.0, "feature", "main")
            .unwrap_err()
            .kind,
        "branchInAnotherWorktree"
    );
    assert_eq!(
        execute_interactive_rebase(&repository.0, "feature", "main", &steps)
            .unwrap_err()
            .kind,
        "branchInAnotherWorktree"
    );
    // The nested worktree is current, not the containing main worktree.
    assert!(prepare_interactive_rebase(&linked, "feature", "main").is_ok());
    assert_eq!(
        prepare_interactive_rebase(&linked, "main", "feature")
            .unwrap_err()
            .kind,
        "branchInAnotherWorktree"
    );
    run_mutation(
        &repository.0,
        &["worktree", "lock", linked.to_str().unwrap()],
        "lock fixture registration",
    )
    .unwrap();
    fs::remove_dir_all(&linked).unwrap();
    assert_eq!(
        prepare_interactive_rebase(&repository.0, "feature", "main")
            .unwrap_err()
            .kind,
        "branchInAnotherWorktree"
    );
    assert_eq!(repository.oid(), original);
    assert!(
        run_git(
            &repository.0,
            &[
                "for-each-ref",
                "--format=%(refname)",
                "refs/git-khronos/recovery/"
            ]
        )
        .unwrap()
        .stdout
        .is_empty()
    );
    assert!(!rebase_support_dir(&repository.0).unwrap().exists());
}

fn edit_rebase_fixture() -> (Repository, String, String, Vec<InteractiveRebaseStep>) {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["checkout", "-b", "feature"],
        "create editable branch",
    )
    .unwrap();
    fs::write(path.join("first"), b"first\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Editable first commit").unwrap();
    fs::write(path.join("second"), b"second\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Later commit").unwrap();
    let original = repository.oid();
    run_mutation(path, &["checkout", "main"], "return to target").unwrap();
    fs::write(path.join("target"), b"target\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Target change").unwrap();
    let target = repository.oid();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    let steps = plan
        .commits
        .iter()
        .enumerate()
        .map(|(index, commit)| InteractiveRebaseStep {
            oid: commit.oid.clone(),
            action: if index == 0 { "edit" } else { "reword" }.into(),
            message: (index == 1)
                .then(|| "Later rewritten message\n\nRetained after Edit pause".into()),
        })
        .collect();
    (repository, original, target, steps)
}

#[test]
fn interactive_rebase_edit_amend_continue_retains_support_for_later_reword_and_recovery() {
    let (repository, original, target, steps) = edit_rebase_fixture();
    let path = &repository.0;
    let config = fs::read(path.join(".git/config")).unwrap();
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap();
    let stopped = read_status(path).unwrap();
    assert!(stopped.rebase_in_progress && stopped.rebase_edit_stopped);
    assert_eq!(stopped.conflicted, 0);
    assert_eq!(stopped.entry_count, 0);
    assert!(read_head_status(path).unwrap().rebase_edit_stopped);
    assert!(
        rebase_support_dir(path)
            .unwrap()
            .join("message-1.txt")
            .is_file()
    );
    assert_eq!(
        String::from_utf8(run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout)
            .unwrap()
            .trim(),
        target
    );
    assert!(!path.join("second").exists());
    fs::write(path.join("first"), b"amended first\n").unwrap();
    assert_eq!(
        continue_rebase(path).unwrap_err().kind,
        "rebaseEditNeedsAmend"
    );
    stage_all(path).unwrap();
    let paused_head = repository.oid();
    let error = continue_rebase(path).unwrap_err();
    assert_eq!(error.kind, "rebaseEditNeedsAmend");
    assert_eq!(repository.oid(), paused_head);
    assert!(
        rebase_support_dir(path)
            .unwrap()
            .join("message-1.txt")
            .is_file()
    );
    commit_with_options(path, "Amended first commit", true, false, Some(false)).unwrap();
    assert!(read_status(path).unwrap().rebase_edit_stopped);
    continue_rebase(path).unwrap();
    let status = read_status(path).unwrap();
    assert!(!status.rebase_in_progress && !status.rebase_edit_stopped);
    assert_eq!(status.branch.as_deref(), Some("feature"));
    assert_eq!(status.entry_count, 0);
    assert_eq!(fs::read(path.join("first")).unwrap(), b"amended first\n");
    assert_eq!(fs::read(path.join("second")).unwrap(), b"second\n");
    assert_eq!(fs::read(path.join("target")).unwrap(), b"target\n");
    let message = run_git(path, &["log", "-1", "--format=%B"]).unwrap();
    assert_eq!(
        String::from_utf8(message.stdout).unwrap().trim(),
        "Later rewritten message\n\nRetained after Edit pause"
    );
    let parent_message = run_git(path, &["log", "-1", "--format=%B", "HEAD^"]).unwrap();
    assert_eq!(
        String::from_utf8(parent_message.stdout).unwrap().trim(),
        "Amended first commit"
    );
    assert_eq!(
        String::from_utf8(run_git(path, &["rev-parse", "HEAD~2"]).unwrap().stdout)
            .unwrap()
            .trim(),
        target
    );
    assert_eq!(
        String::from_utf8(
            run_git(
                path,
                &[
                    "for-each-ref",
                    "--format=%(objectname)",
                    "refs/git-khronos/recovery/"
                ]
            )
            .unwrap()
            .stdout
        )
        .unwrap()
        .trim(),
        original
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert!(!rebase_support_dir(path).unwrap().exists());
}

#[test]
fn interactive_rebase_edit_multiple_pauses_continue_unchanged_and_preserve_fixup_recipient() {
    let (repository, _, target, mut steps) = edit_rebase_fixture();
    let path = &repository.0;
    steps[1].action = "edit".into();
    steps[1].message = None;
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap();
    assert!(read_status(path).unwrap().rebase_edit_stopped);
    continue_rebase(path).unwrap();
    assert!(read_status(path).unwrap().rebase_edit_stopped);
    assert!(rebase_support_dir(path).unwrap().exists());
    continue_rebase(path).unwrap();
    assert!(!read_status(path).unwrap().rebase_edit_stopped);
    assert!(!read_status(path).unwrap().rebase_in_progress);
    assert_eq!(
        String::from_utf8(run_git(path, &["rev-parse", "HEAD~2"]).unwrap().stdout)
            .unwrap()
            .trim(),
        target
    );

    let (fixup_repository, _, _, mut fixup_steps) = edit_rebase_fixture();
    let path = &fixup_repository.0;
    fixup_steps[1].action = "fixup".into();
    fixup_steps[1].message = None;
    execute_interactive_rebase(path, "feature", "main", &fixup_steps).unwrap();
    continue_rebase(path).unwrap();
    assert_eq!(
        String::from_utf8(run_git(path, &["log", "-1", "--format=%B"]).unwrap().stdout)
            .unwrap()
            .trim(),
        "Editable first commit"
    );
    assert!(path.join("first").is_file() && path.join("second").is_file());
}

#[test]
fn interactive_rebase_edit_abort_after_amend_restores_original_branch_and_keeps_recovery() {
    let (repository, original, target, steps) = edit_rebase_fixture();
    let path = &repository.0;
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap();
    fs::write(path.join("first"), b"aborted amendment\n").unwrap();
    stage_all(path).unwrap();
    commit_with_options(path, "Aborted amendment", true, false, Some(false)).unwrap();
    abort_rebase(path).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(fs::read(path.join("first")).unwrap(), b"first\n");
    assert_eq!(fs::read(path.join("second")).unwrap(), b"second\n");
    assert!(!path.join("target").exists());
    assert_eq!(
        String::from_utf8(
            run_git(path, &["rev-parse", "refs/heads/main"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        target
    );
    assert!(!read_status(path).unwrap().rebase_edit_stopped);
    assert!(!rebase_support_dir(path).unwrap().exists());
    assert_eq!(
        String::from_utf8(
            run_git(
                path,
                &[
                    "for-each-ref",
                    "--format=%(objectname)",
                    "refs/git-khronos/recovery/"
                ]
            )
            .unwrap()
            .stdout
        )
        .unwrap()
        .trim(),
        original
    );
}

#[test]
fn interactive_rebase_edit_conflict_is_not_reported_as_an_intentional_edit_stop() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["checkout", "-b", "feature"],
        "create conflicted source",
    )
    .unwrap();
    fs::write(path.join("file"), b"feature\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Conflicting edit").unwrap();
    let original = repository.oid();
    run_mutation(path, &["checkout", "main"], "return to target").unwrap();
    fs::write(path.join("file"), b"main\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Target conflict").unwrap();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    let steps = vec![InteractiveRebaseStep {
        oid: plan.commits[0].oid.clone(),
        action: "edit".into(),
        message: None,
    }];
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap_err();
    let status = read_status(path).unwrap();
    assert!(status.rebase_in_progress);
    assert_eq!(status.conflicted, 1);
    assert!(!status.rebase_edit_stopped);
    assert!(rebase_support_dir(path).unwrap().exists());
    abort_rebase(path).unwrap();
    assert_eq!(repository.oid(), original);
}

#[cfg(unix)]
#[test]
fn interactive_rebase_edit_hook_refusal_preserves_pause_index_and_support_for_explicit_retry() {
    use std::os::unix::fs::PermissionsExt;
    let (repository, _, _, steps) = edit_rebase_fixture();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "use owned edit fixture hooks",
    )
    .unwrap();
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap();
    let stopped = repository.oid();
    let support = rebase_support_dir(path).unwrap();
    let todo = fs::read(support.join("todo")).unwrap();
    let later_message = fs::read(support.join("message-1.txt")).unwrap();
    fs::write(path.join("first"), b"reviewed amendment\n").unwrap();
    stage_all(path).unwrap();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let hook = path.join(".git/hooks/pre-commit");
    fs::write(
        &hook,
        b"#!/bin/sh\nprintf '%s\\n' 'Edit amendment hook refusal' >&2\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let error =
        commit_with_options(path, "Reviewed amendment", true, false, Some(false)).unwrap_err();
    assert!(error.message.contains("Edit amendment hook refusal"));
    assert_eq!(repository.oid(), stopped);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert_eq!(
        fs::read(path.join("first")).unwrap(),
        b"reviewed amendment\n"
    );
    assert_eq!(fs::read(support.join("todo")).unwrap(), todo);
    assert_eq!(
        fs::read(support.join("message-1.txt")).unwrap(),
        later_message
    );
    assert!(read_status(path).unwrap().rebase_edit_stopped);
    assert_eq!(
        continue_rebase(path).unwrap_err().kind,
        "rebaseEditNeedsAmend"
    );
    fs::write(&hook, b"#!/bin/sh\nexit 0\n").unwrap();
    commit_with_options(path, "Reviewed amendment", true, false, Some(false)).unwrap();
    continue_rebase(path).unwrap();
    assert_eq!(
        fs::read(path.join("first")).unwrap(),
        b"reviewed amendment\n"
    );
    assert!(!read_status(path).unwrap().rebase_in_progress);
    assert!(!support.exists());
}

#[test]
fn interactive_rebase_autosquash_reviewed_order_combines_messages_and_preserves_independent_commits()
 {
    let repository = Repository::new();
    let path = &repository.0;
    let base = repository.oid();
    run_mutation(
        path,
        &["checkout", "-b", "feature"],
        "create autosquash source",
    )
    .unwrap();
    for (name, message) in [
        ("target-change", "Target message\n\nRetained target details"),
        ("independent", "Independent commit"),
        (
            "fixup-change",
            "fixup! Target message\n\nDiscard fixup details",
        ),
        (
            "squash-change",
            "squash! Target message\n\nRetained squash details",
        ),
        ("last", "Last commit"),
    ] {
        fs::write(path.join(name), format!("{name}\n")).unwrap();
        stage_all(path).unwrap();
        commit(path, message).unwrap();
    }
    let original = repository.oid();
    let original_tree = run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout;
    run_mutation(path, &["checkout", "main"], "return to autosquash target").unwrap();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    let steps = [
        (0, "pick"),
        (2, "fixup"),
        (3, "squash"),
        (1, "pick"),
        (4, "pick"),
    ]
    .into_iter()
    .map(|(index, action)| InteractiveRebaseStep {
        oid: plan.commits[index].oid.clone(),
        action: action.into(),
        message: None,
    })
    .collect::<Vec<_>>();
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap();
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout,
        original_tree
    );
    let output = run_git(
        path,
        &[
            "log",
            "-z",
            "--reverse",
            "--format=%B",
            &format!("{base}..HEAD"),
        ],
    )
    .unwrap();
    let messages = String::from_utf8(output.stdout).unwrap();
    let messages = messages
        .split('\0')
        .filter(|message| !message.is_empty())
        .collect::<Vec<_>>();
    assert_eq!(messages.len(), 3);
    assert!(messages[0].contains("Retained target details"));
    assert!(messages[0].contains("Retained squash details"));
    assert!(!messages[0].contains("Discard fixup details"));
    assert_eq!(messages[1].trim(), "Independent commit");
    assert_eq!(messages[2].trim(), "Last commit");
    assert_eq!(
        String::from_utf8(
            run_git(
                path,
                &[
                    "for-each-ref",
                    "--format=%(objectname)",
                    "refs/git-khronos/recovery/"
                ]
            )
            .unwrap()
            .stdout
        )
        .unwrap()
        .trim(),
        original
    );
    assert!(!read_status(path).unwrap().rebase_in_progress);
}

fn mainline_fixture() -> (Repository, String, String, String, String) {
    let repository = Repository::new();
    let path = &repository.0;
    let base = repository.oid();
    run_mutation(path, &["checkout", "-b", "side"], "create side branch").unwrap();
    fs::write(path.join("side-file"), b"side\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Side change").unwrap();
    let second = repository.oid();
    run_mutation(path, &["checkout", "main"], "return to main").unwrap();
    fs::write(path.join("main-file"), b"main\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Main change").unwrap();
    let first = repository.oid();
    run_mutation(
        path,
        &["merge", "--no-ff", "--no-edit", "side"],
        "merge owned side",
    )
    .unwrap();
    let merge = repository.oid();
    (repository, base, first, second, merge)
}

#[test]
fn mainline_cherry_pick_each_parent_applies_only_the_relative_merge_difference() {
    for parent in [1, 2] {
        let (repository, _, first, second, merge) = mainline_fixture();
        let path = &repository.0;
        let baseline = if parent == 1 { first } else { second };
        run_mutation(
            path,
            &["checkout", "-b", "replay", &baseline],
            "create replay branch",
        )
        .unwrap();
        let config = fs::read(path.join(".git/config")).unwrap();
        cherry_pick_commits_with_mainline(path, std::slice::from_ref(&merge), Some(parent))
            .unwrap();
        let output = run_git(path, &["rev-list", "--parents", "-1", "HEAD"]).unwrap();
        let fields = String::from_utf8(output.stdout).unwrap();
        assert_eq!(
            fields.split_whitespace().collect::<Vec<_>>(),
            [repository.oid().as_str(), baseline.as_str()]
        );
        assert_eq!(fs::read(path.join("side-file")).unwrap(), b"side\n");
        assert_eq!(fs::read(path.join("main-file")).unwrap(), b"main\n");
        assert_eq!(
            run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout,
            run_git(path, &["rev-parse", &format!("{merge}^{{tree}}")])
                .unwrap()
                .stdout
        );
        assert_eq!(
            run_git(path, &["log", "-1", "--format=%B", "HEAD"])
                .unwrap()
                .stdout,
            run_git(path, &["log", "-1", "--format=%B", &merge])
                .unwrap()
                .stdout
        );
        assert_eq!(
            String::from_utf8(
                run_git(
                    path,
                    &[
                        "for-each-ref",
                        "--format=%(objectname)",
                        "refs/git-khronos/recovery/"
                    ]
                )
                .unwrap()
                .stdout
            )
            .unwrap()
            .trim(),
            baseline
        );
        assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    }
}

#[test]
fn mainline_revert_each_parent_reverses_difference_without_erasing_merge_history() {
    for parent in [1, 2] {
        let (repository, _, first, second, merge) = mainline_fixture();
        let path = &repository.0;
        let baseline = if parent == 1 { first } else { second };
        revert_commit_with_mainline(path, &merge, Some(parent)).unwrap();
        assert_eq!(
            run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout,
            run_git(path, &["rev-parse", &format!("{baseline}^{{tree}}")])
                .unwrap()
                .stdout
        );
        assert_eq!(
            String::from_utf8(run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout)
                .unwrap()
                .trim(),
            merge
        );
        assert_eq!(
            String::from_utf8(
                run_git(
                    path,
                    &[
                        "for-each-ref",
                        "--format=%(objectname)",
                        "refs/git-khronos/recovery/"
                    ]
                )
                .unwrap()
                .stdout
            )
            .unwrap()
            .trim(),
            merge
        );
        assert_eq!(read_status(path).unwrap().history_operation, None);
    }
}

#[test]
fn mainline_validation_refuses_missing_out_of_range_and_nonmerge_choices_before_any_replay() {
    let (repository, base, first, _, merge) = mainline_fixture();
    let path = &repository.0;
    let original = repository.oid();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    for choice in [None, Some(0), Some(3), Some(u32::MAX)] {
        assert_eq!(
            cherry_pick_commits_with_mainline(path, std::slice::from_ref(&merge), choice)
                .unwrap_err()
                .kind,
            "mainlineRequired"
        );
        assert_eq!(
            revert_commit_with_mainline(path, &merge, choice)
                .unwrap_err()
                .kind,
            "mainlineRequired"
        );
    }
    assert_eq!(
        revert_commit_with_mainline(path, &first, Some(1))
            .unwrap_err()
            .kind,
        "invalidMainline"
    );
    assert_eq!(
        cherry_pick_commits_with_mainline(path, &[first.clone(), merge.clone()], Some(1))
            .unwrap_err()
            .kind,
        "invalidMainline"
    );
    // Validate every selected commit before starting, not after replaying a prefix.
    run_mutation(
        path,
        &["checkout", "-b", "preflight", &base],
        "create preflight destination",
    )
    .unwrap();
    assert_eq!(
        cherry_pick_commits(path, &[first, merge]).unwrap_err().kind,
        "mainlineRequired"
    );
    assert_eq!(repository.oid(), base);
    run_mutation(path, &["checkout", "main"], "restore fixture branch").unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert!(
        run_git(
            path,
            &[
                "for-each-ref",
                "--format=%(refname)",
                "refs/git-khronos/recovery/"
            ]
        )
        .unwrap()
        .stdout
        .is_empty()
    );
}

#[test]
fn mainline_replay_preserves_conflicts_and_abort_restores_destination_with_recovery() {
    for operation in ["cherry-pick", "revert"] {
        let (repository, _, first, _, merge) = mainline_fixture();
        let path = &repository.0;
        if operation == "cherry-pick" {
            run_mutation(
                path,
                &["checkout", "-b", "conflict", &first],
                "create conflicting destination",
            )
            .unwrap();
        }
        fs::write(path.join("side-file"), b"destination conflict\n").unwrap();
        stage_all(path).unwrap();
        commit(path, "Destination conflict").unwrap();
        let original = repository.oid();
        let result = if operation == "cherry-pick" {
            cherry_pick_commits_with_mainline(path, std::slice::from_ref(&merge), Some(1))
        } else {
            revert_commit_with_mainline(path, &merge, Some(1))
        };
        result.unwrap_err();
        let status = read_status(path).unwrap();
        assert_eq!(status.history_operation.as_deref(), Some(operation));
        assert_eq!(status.conflicted, 1);
        control_history_operation(path, operation, "abort").unwrap();
        assert_eq!(repository.oid(), original);
        assert_eq!(
            fs::read(path.join("side-file")).unwrap(),
            b"destination conflict\n"
        );
        assert_eq!(
            String::from_utf8(
                run_git(
                    path,
                    &[
                        "for-each-ref",
                        "--format=%(objectname)",
                        "refs/git-khronos/recovery/"
                    ]
                )
                .unwrap()
                .stdout
            )
            .unwrap()
            .trim(),
            original
        );
    }
}

#[test]
fn mainline_replay_refuses_dirty_active_operation_and_recovery_failure_without_changes() {
    let (repository, _, first, _, merge) = mainline_fixture();
    let path = &repository.0;
    run_mutation(
        path,
        &["checkout", "-b", "guarded", &first],
        "create guarded destination",
    )
    .unwrap();
    fs::write(path.join("file"), b"unstaged\n").unwrap();
    assert_eq!(
        cherry_pick_commits_with_mainline(path, std::slice::from_ref(&merge), Some(1))
            .unwrap_err()
            .kind,
        "dirtyWorkingTree"
    );
    fs::write(path.join("file"), b"base\n").unwrap();
    fs::write(path.join(".git/CHERRY_PICK_HEAD"), format!("{merge}\n")).unwrap();
    assert_eq!(
        cherry_pick_commits_with_mainline(path, std::slice::from_ref(&merge), Some(1))
            .unwrap_err()
            .kind,
        "historyOperationInProgress"
    );
    fs::remove_file(path.join(".git/CHERRY_PICK_HEAD")).unwrap();
    run_mutation(
        path,
        &["update-ref", "refs/git-khronos/recovery", &first],
        "obstruct recovery namespace",
    )
    .unwrap();
    cherry_pick_commits_with_mainline(path, std::slice::from_ref(&merge), Some(1)).unwrap_err();
    assert_eq!(repository.oid(), first);
    assert!(!path.join("side-file").exists());
    assert_eq!(read_status(path).unwrap().entry_count, 0);
}

#[cfg(unix)]
#[test]
fn mainline_replay_hook_refusal_keeps_staged_changes_for_explicit_continue_or_commit() {
    use std::os::unix::fs::PermissionsExt;
    for operation in ["cherry-pick", "revert"] {
        let (repository, _, _, second, merge) = mainline_fixture();
        let path = &repository.0;
        if operation == "cherry-pick" {
            run_mutation(
                path,
                &["checkout", "-b", "hooked", &second],
                "create hook destination",
            )
            .unwrap();
        }
        let original = repository.oid();
        let hooks = path.join(".git/hooks");
        run_mutation(
            path,
            &["config", "core.hooksPath", hooks.to_str().unwrap()],
            "configure owned hooks",
        )
        .unwrap();
        let hook = hooks.join("prepare-commit-msg");
        fs::write(
            &hook,
            b"#!/bin/sh\nprintf 'Owned merge replay hook refusal\\n' >&2\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        let config = fs::read(path.join(".git/config")).unwrap();
        let result = if operation == "cherry-pick" {
            cherry_pick_commits_with_mainline(path, std::slice::from_ref(&merge), Some(2))
        } else {
            revert_commit_with_mainline(path, &merge, Some(2))
        };
        assert!(
            result
                .unwrap_err()
                .message
                .contains("Owned merge replay hook refusal")
        );
        assert_eq!(repository.oid(), original);
        let status = read_status(path).unwrap();
        assert_eq!(
            status.history_operation.as_deref(),
            if operation == "cherry-pick" {
                Some(operation)
            } else {
                None
            }
        );
        assert_eq!(status.conflicted, 0);
        assert_eq!(status.staged, 1);
        assert_eq!(
            String::from_utf8(
                run_git(
                    path,
                    &[
                        "for-each-ref",
                        "--format=%(objectname)",
                        "refs/git-khronos/recovery/"
                    ]
                )
                .unwrap()
                .stdout
            )
            .unwrap()
            .trim(),
            original
        );
        fs::write(&hook, b"#!/bin/sh\nexit 0\n").unwrap();
        if operation == "cherry-pick" {
            control_history_operation(path, operation, "continue").unwrap();
        } else {
            commit(path, "Reviewed staged merge reversal").unwrap();
        }
        let expected_tree = if operation == "cherry-pick" {
            &merge
        } else {
            &second
        };
        assert_eq!(
            run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout,
            run_git(path, &["rev-parse", &format!("{expected_tree}^{{tree}}")])
                .unwrap()
                .stdout
        );
        assert_eq!(
            String::from_utf8(run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout)
                .unwrap()
                .trim(),
            original
        );
        assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
        assert_eq!(read_status(path).unwrap().history_operation, None);
        assert_eq!(read_status(path).unwrap().entry_count, 0);
    }
}

fn pull_fixture(divergent: bool, conflicting: bool) -> (Repository, PathBuf, String, String) {
    let repository = Repository::new();
    let path = &repository.0;
    let remote = path.join(".git/pull-remote.git");
    let publisher = path.join(".git/pull-publisher");
    run_mutation(
        path,
        &["init", "--bare", "-b", "main", remote.to_str().unwrap()],
        "create owned pull remote",
    )
    .unwrap();
    add_remote(path, "origin", remote.to_str().unwrap()).unwrap();
    run_mutation(
        path,
        &["push", "--set-upstream", "origin", "main"],
        "publish fixture baseline",
    )
    .unwrap();
    run_mutation(
        path,
        &[
            "clone",
            remote.to_str().unwrap(),
            publisher.to_str().unwrap(),
        ],
        "clone owned publisher",
    )
    .unwrap();
    for (key, value) in [
        ("user.name", "Publisher"),
        ("user.email", "publisher@example.test"),
        ("commit.gpgsign", "false"),
    ] {
        run_mutation(
            &publisher,
            &["config", key, value],
            "configure owned publisher",
        )
        .unwrap();
    }
    fs::write(
        publisher.join(if conflicting { "file" } else { "remote-file" }),
        b"remote change\n",
    )
    .unwrap();
    stage_all(&publisher).unwrap();
    commit(&publisher, "Remote change").unwrap();
    run_mutation(
        &publisher,
        &["push", "origin", "main"],
        "publish remote fixture change",
    )
    .unwrap();
    let remote_oid = String::from_utf8(run_git(&publisher, &["rev-parse", "HEAD"]).unwrap().stdout)
        .unwrap()
        .trim()
        .to_owned();
    if divergent {
        fs::write(
            path.join(if conflicting { "file" } else { "local-file" }),
            b"local change\n",
        )
        .unwrap();
        stage_all(path).unwrap();
        commit(path, "Local change").unwrap();
    }
    let local_oid = repository.oid();
    (repository, publisher, local_oid, remote_oid)
}

#[test]
fn pull_strategy_merge_overrides_configured_rebase_and_ff_only_without_rewriting_local_commits() {
    let (repository, publisher, local, remote) = pull_fixture(true, false);
    let path = &repository.0;
    for (key, value) in [
        ("pull.rebase", "true"),
        ("branch.main.rebase", "true"),
        ("pull.ff", "only"),
    ] {
        run_mutation(
            path,
            &["config", key, value],
            "configure opposing pull defaults",
        )
        .unwrap();
    }
    let config = fs::read(path.join(".git/config")).unwrap();
    pull_with_strategy(path, "merge").unwrap();
    let parents = String::from_utf8(
        run_git(path, &["show", "-s", "--format=%P", "HEAD"])
            .unwrap()
            .stdout,
    )
    .unwrap();
    assert_eq!(parents.trim(), format!("{local} {remote}"));
    assert_eq!(
        fs::read(path.join("local-file")).unwrap(),
        b"local change\n"
    );
    assert_eq!(
        fs::read(path.join("remote-file")).unwrap(),
        b"remote change\n"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(
        String::from_utf8(run_git(&publisher, &["rev-parse", "HEAD"]).unwrap().stdout)
            .unwrap()
            .trim(),
        remote
    );
    let status = read_status(path).unwrap();
    assert_eq!((status.ahead, status.behind), (2, 0));
    assert!(!status.merge_in_progress && !status.rebase_in_progress);
}

#[test]
fn pull_strategy_ff_only_refuses_divergence_despite_configured_rebase_and_refreshes_tracking_tip() {
    let (repository, _, local, remote) = pull_fixture(true, false);
    let path = &repository.0;
    for (key, value) in [
        ("pull.rebase", "true"),
        ("branch.main.rebase", "true"),
        ("pull.ff", "false"),
    ] {
        run_mutation(
            path,
            &["config", key, value],
            "configure opposing pull defaults",
        )
        .unwrap();
    }
    let config = fs::read(path.join(".git/config")).unwrap();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    assert_eq!(
        pull_with_strategy(path, "ff-only").unwrap_err().kind,
        "gitFailure"
    );
    assert_eq!(repository.oid(), local);
    assert_eq!(
        String::from_utf8(
            run_git(path, &["rev-parse", "refs/remotes/origin/main"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        remote
    );
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert_eq!(
        fs::read(path.join("local-file")).unwrap(),
        b"local change\n"
    );
    assert!(!path.join("remote-file").exists());
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    let status = read_status(path).unwrap();
    assert_eq!((status.ahead, status.behind), (1, 1));
    assert!(!status.merge_in_progress && !status.rebase_in_progress);
}

#[test]
fn pull_strategy_rebase_overrides_merge_defaults_and_replays_only_local_work() {
    let (repository, _, local, remote) = pull_fixture(true, false);
    let path = &repository.0;
    for (key, value) in [
        ("pull.rebase", "false"),
        ("branch.main.rebase", "false"),
        ("pull.ff", "only"),
    ] {
        run_mutation(
            path,
            &["config", key, value],
            "configure opposing pull defaults",
        )
        .unwrap();
    }
    let config = fs::read(path.join(".git/config")).unwrap();
    pull_with_strategy(path, "rebase").unwrap();
    assert_ne!(repository.oid(), local);
    assert_eq!(
        String::from_utf8(
            run_git(path, &["show", "-s", "--format=%P", "HEAD"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        remote
    );
    assert_eq!(
        fs::read(path.join("local-file")).unwrap(),
        b"local change\n"
    );
    assert_eq!(
        fs::read(path.join("remote-file")).unwrap(),
        b"remote change\n"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    let status = read_status(path).unwrap();
    assert_eq!((status.ahead, status.behind), (1, 0));
    assert!(!status.merge_in_progress && !status.rebase_in_progress);
}

#[test]
fn pull_strategy_fast_forwards_each_explicit_mode_despite_configured_no_ff() {
    for strategy in ["merge", "ff-only", "rebase"] {
        let (repository, _, _, remote) = pull_fixture(false, false);
        let path = &repository.0;
        run_mutation(
            path,
            &["config", "pull.ff", "false"],
            "configure no fast-forward default",
        )
        .unwrap();
        run_mutation(
            path,
            &["config", "merge.ff", "false"],
            "configure no fast-forward merge",
        )
        .unwrap();
        let config = fs::read(path.join(".git/config")).unwrap();
        pull_from_remote_with_strategy(path, strategy, Some("origin"), Some("main")).unwrap();
        assert_eq!(repository.oid(), remote, "{strategy}");
        assert_eq!(
            fs::read(path.join("remote-file")).unwrap(),
            b"remote change\n"
        );
        assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
        let status = read_status(path).unwrap();
        assert_eq!((status.ahead, status.behind), (0, 0));
    }
}

#[test]
fn pull_strategy_conflicts_offer_the_selected_operation_and_abort_restores_local_work() {
    for strategy in ["merge", "rebase"] {
        let (repository, _, local, remote) = pull_fixture(true, true);
        let path = &repository.0;
        run_mutation(
            path,
            &[
                "config",
                "pull.rebase",
                if strategy == "merge" { "true" } else { "false" },
            ],
            "configure opposing conflict strategy",
        )
        .unwrap();
        let config = fs::read(path.join(".git/config")).unwrap();
        assert_eq!(
            pull_with_strategy(path, strategy).unwrap_err().kind,
            "gitFailure"
        );
        let status = read_status(path).unwrap();
        assert_eq!(status.conflicted, 1);
        assert_eq!(status.merge_in_progress, strategy == "merge");
        assert_eq!(status.rebase_in_progress, strategy == "rebase");
        assert_eq!(
            String::from_utf8(
                run_git(path, &["rev-parse", "refs/remotes/origin/main"])
                    .unwrap()
                    .stdout
            )
            .unwrap()
            .trim(),
            remote
        );
        if strategy == "merge" {
            abort_merge(path).unwrap();
        } else {
            abort_rebase(path).unwrap();
        }
        assert_eq!(repository.oid(), local);
        assert_eq!(fs::read(path.join("file")).unwrap(), b"local change\n");
        assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
        let status = read_status(path).unwrap();
        assert_eq!(status.conflicted, 0);
        assert!(!status.merge_in_progress && !status.rebase_in_progress);
    }
}

#[test]
fn pull_strategy_missing_upstream_refuses_without_selecting_another_branch_or_losing_dirty_work() {
    let (repository, _, local, _) = pull_fixture(false, false);
    let path = &repository.0;
    fs::write(path.join("file"), b"unstaged remains\n").unwrap();
    fs::write(path.join("staged"), b"staged remains\n").unwrap();
    stage_path(path, "staged").unwrap();
    fs::write(path.join("untracked"), b"untracked remains\n").unwrap();
    set_branch_upstream(path, "main", None).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let error = pull_with_strategy(path, "merge").unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert!(error.message.contains("upstream"));
    assert_eq!(repository.oid(), local);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert_eq!(fs::read(path.join("file")).unwrap(), b"unstaged remains\n");
    assert_eq!(fs::read(path.join("staged")).unwrap(), b"staged remains\n");
    assert_eq!(
        fs::read(path.join("untracked")).unwrap(),
        b"untracked remains\n"
    );
    assert!(!read_status(path).unwrap().merge_in_progress);
}

#[test]
fn pull_strategy_deleted_upstream_retains_configuration_and_local_commits_after_pruning() {
    let (repository, _, local, _) = pull_fixture(true, false);
    let path = &repository.0;
    let remote = path.join(".git/pull-remote.git");
    run_mutation(
        path,
        &[
            "--git-dir",
            remote.to_str().unwrap(),
            "update-ref",
            "-d",
            "refs/heads/main",
        ],
        "delete owned remote upstream",
    )
    .unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    for explicit in [false, true] {
        let error = if explicit {
            pull_from_remote_with_strategy(path, "ff-only", Some("origin"), Some("main"))
        } else {
            pull_with_strategy(path, "ff-only")
        }
        .unwrap_err();
        assert_eq!(error.kind, "gitFailure");
        assert!(error.message.contains("upstream"));
        assert_eq!(repository.oid(), local);
    }
    fetch_with_options(
        path,
        &FetchOptions {
            remote: Some("origin".into()),
            prune: true,
            history: None,
        },
        &CancellationToken::default(),
    )
    .unwrap();
    let status = read_status(path).unwrap();
    let branch = read_branches(path, &status, true)
        .unwrap()
        .into_iter()
        .find(|branch| branch.current)
        .unwrap();
    assert_eq!(branch.upstream.as_deref(), Some("origin/main"));
    assert_eq!(branch.tracking.as_deref(), Some("gone"));
    assert_eq!(repository.oid(), local);
    assert_eq!(
        fs::read(path.join("local-file")).unwrap(),
        b"local change\n"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(
        set_branch_upstream(path, "main", Some("origin/main"))
            .unwrap_err()
            .kind,
        "remoteBranchNotFound"
    );
}

#[test]
fn pull_strategy_removed_remote_fails_explicitly_and_preserves_dirty_contents() {
    let (repository, _, local, _) = pull_fixture(true, false);
    let path = &repository.0;
    remove_remote(path, "origin").unwrap();
    fs::write(path.join("file"), b"retain dirty file\n").unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let error =
        pull_from_remote_with_strategy(path, "merge", Some("origin"), Some("main")).unwrap_err();
    assert_eq!(error.kind, "remoteNotFound");
    assert_eq!(repository.oid(), local);
    assert_eq!(fs::read(path.join("file")).unwrap(), b"retain dirty file\n");
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[test]
fn pull_strategy_overlapping_dirty_changes_are_preserved_without_automatic_stashing() {
    for strategy in ["merge", "rebase"] {
        let (repository, _, local, _) = pull_fixture(false, true);
        let path = &repository.0;
        for key in ["rebase.autoStash", "merge.autoStash"] {
            run_mutation(
                path,
                &["config", key, "false"],
                "disable fixture automatic stash",
            )
            .unwrap();
        }
        fs::write(path.join("file"), b"staged local contents\n").unwrap();
        stage_path(path, "file").unwrap();
        fs::write(path.join("file"), b"unstaged local contents\n").unwrap();
        fs::write(path.join("untracked"), b"untracked local contents\n").unwrap();
        let index = run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout;
        let config = fs::read(path.join(".git/config")).unwrap();
        let error = pull_with_strategy(path, strategy).unwrap_err();
        assert_eq!(error.kind, "gitFailure");
        assert!(
            error.message.contains("local changes"),
            "{strategy}: {error:?}"
        );
        assert_eq!(repository.oid(), local);
        assert_eq!(
            run_git(path, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            index
        );
        assert_eq!(
            fs::read(path.join("file")).unwrap(),
            b"unstaged local contents\n"
        );
        assert_eq!(
            fs::read(path.join("untracked")).unwrap(),
            b"untracked local contents\n"
        );
        assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
        assert!(read_stashes(path).unwrap().is_empty());
        let status = read_status(path).unwrap();
        assert!(!status.merge_in_progress && !status.rebase_in_progress);
    }
}

#[test]
fn reference_actions_occupied_branch_checkout_and_deletion_preserve_both_worktrees() {
    let repository = Repository::new();
    let path = &repository.0;
    let head = repository.oid();
    let linked = path.join(".git/occupied-worktree");
    run_mutation(
        path,
        &[
            "worktree",
            "add",
            "-b",
            "occupied",
            linked.to_str().unwrap(),
            &head,
        ],
        "create owned occupied branch",
    )
    .unwrap();
    fs::write(linked.join("file"), b"linked staged\n").unwrap();
    stage_path(&linked, "file").unwrap();
    fs::write(linked.join("file"), b"linked unstaged\n").unwrap();
    fs::write(path.join("file"), b"main unstaged\n").unwrap();
    let main_index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let linked_index = run_git(&linked, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let refs = run_git(path, &["show-ref"]).unwrap().stdout;
    assert_eq!(
        checkout_branch(path, "occupied").unwrap_err().kind,
        "gitFailure"
    );
    for force in [false, true] {
        assert_eq!(
            delete_branch(path, "occupied", force).unwrap_err().kind,
            "gitFailure"
        );
    }
    assert_eq!(repository.oid(), head);
    assert_eq!(run_git(path, &["show-ref"]).unwrap().stdout, refs);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        main_index
    );
    assert_eq!(
        run_git(&linked, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        linked_index
    );
    assert_eq!(fs::read(path.join("file")).unwrap(), b"main unstaged\n");
    assert_eq!(fs::read(linked.join("file")).unwrap(), b"linked unstaged\n");
    assert_eq!(
        read_status(&linked).unwrap().branch.as_deref(),
        Some("occupied")
    );
    assert_eq!(read_status(path).unwrap().branch.as_deref(), Some("main"));
}

#[test]
fn interactive_rebase_fixup_retains_preceding_message_and_original_tip_for_recovery() {
    let repository = Repository::new();
    let path = &repository.0;
    create_branch(path, "feature").unwrap();
    for (name, message) in [
        ("first", "Keep this message\n\nOriginal explanation"),
        ("fix", "Discard this fixup message"),
        ("last", "Independent later commit"),
    ] {
        fs::write(path.join(name), message).unwrap();
        stage_all(path).unwrap();
        commit(path, message).unwrap();
    }
    let original = repository.oid();
    checkout_branch(path, "main").unwrap();
    let target = repository.oid();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    let original_message = plan.commits[0].message.clone();
    let steps = plan
        .commits
        .iter()
        .enumerate()
        .map(|(index, commit)| InteractiveRebaseStep {
            oid: commit.oid.clone(),
            action: if index == 1 { "fixup" } else { "pick" }.into(),
            message: None,
        })
        .collect::<Vec<_>>();
    let config = fs::read(path.join(".git/config")).unwrap();
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap();
    let log = run_git(
        path,
        &["log", "--reverse", "--format=%B%x00", "main..feature"],
    )
    .unwrap();
    let messages = String::from_utf8(log.stdout).unwrap();
    assert!(messages.contains(&original_message));
    assert!(!messages.contains("Discard this fixup message"));
    assert!(messages.contains("Independent later commit"));
    assert_eq!(
        String::from_utf8(
            run_git(path, &["rev-list", "--count", "main..feature"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        "2"
    );
    for name in ["first", "fix", "last"] {
        assert!(path.join(name).is_file());
    }
    assert_ne!(repository.oid(), original);
    assert_eq!(
        String::from_utf8(run_git(path, &["rev-parse", "main"]).unwrap().stdout)
            .unwrap()
            .trim(),
        target
    );
    assert_eq!(
        String::from_utf8(
            run_git(
                path,
                &[
                    "for-each-ref",
                    "--format=%(objectname)",
                    "refs/git-khronos/recovery/"
                ]
            )
            .unwrap()
            .stdout
        )
        .unwrap()
        .trim(),
        original
    );
    create_branch_at(path, "recovered-original", &original).unwrap();
    assert_eq!(
        String::from_utf8(
            run_git(path, &["rev-list", "--count", "main..recovered-original"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        "3"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert!(!path.join(".git/git-khronos-rebase").exists());
}

#[test]
fn interactive_rebase_rejects_combination_without_retained_predecessor_before_any_changes() {
    for action in ["squash", "fixup"] {
        let repository = Repository::new();
        let path = &repository.0;
        create_branch(path, "feature").unwrap();
        for name in ["first", "second", "third"] {
            fs::write(path.join(name), name).unwrap();
            stage_all(path).unwrap();
            commit(path, name).unwrap();
        }
        checkout_branch(path, "main").unwrap();
        let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
        let head = repository.oid();
        let refs = run_git(path, &["show-ref"]).unwrap().stdout;
        let index = fs::read(path.join(".git/index")).unwrap();
        let support = path.join(".git/git-khronos-rebase");
        fs::create_dir(&support).unwrap();
        fs::write(support.join("preserved"), b"existing support data\n").unwrap();
        let steps = plan
            .commits
            .iter()
            .enumerate()
            .map(|(index, commit)| InteractiveRebaseStep {
                oid: commit.oid.clone(),
                action: if index == 2 { action } else { "drop" }.into(),
                message: None,
            })
            .collect::<Vec<_>>();
        let error = execute_interactive_rebase(path, "feature", "main", &steps).unwrap_err();
        assert_eq!(error.kind, "invalidInteractiveRebase");
        assert!(error.message.contains("preceding retained"));
        assert_eq!(repository.oid(), head);
        assert_eq!(read_status(path).unwrap().branch.as_deref(), Some("main"));
        assert_eq!(run_git(path, &["show-ref"]).unwrap().stdout, refs);
        assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(support.join("preserved")).unwrap(),
            b"existing support data\n"
        );
        assert!(!read_status(path).unwrap().rebase_in_progress);
    }
}

#[test]
fn interactive_rebase_fixup_after_dropped_commit_combines_into_retained_reword() {
    let repository = Repository::new();
    let path = &repository.0;
    create_branch(path, "feature").unwrap();
    for name in ["discarded", "retained", "combined"] {
        fs::write(path.join(name), name).unwrap();
        stage_all(path).unwrap();
        commit(path, name).unwrap();
    }
    let original = repository.oid();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    let actions = ["drop", "reword", "fixup"];
    let steps = plan
        .commits
        .iter()
        .enumerate()
        .map(|(index, commit)| InteractiveRebaseStep {
            oid: commit.oid.clone(),
            action: actions[index].into(),
            message: (index == 1)
                .then(|| "Retained replacement message\n\nKeep this explanation".into()),
        })
        .collect::<Vec<_>>();
    execute_interactive_rebase(path, "feature", "main", &steps).unwrap();
    assert_eq!(
        String::from_utf8(
            run_git(path, &["show", "-s", "--format=%B", "HEAD"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        "Retained replacement message\n\nKeep this explanation"
    );
    assert_eq!(
        String::from_utf8(
            run_git(path, &["rev-list", "--count", "main..feature"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        "1"
    );
    assert!(!path.join("discarded").exists());
    assert_eq!(fs::read(path.join("retained")).unwrap(), b"retained");
    assert_eq!(fs::read(path.join("combined")).unwrap(), b"combined");
    assert_eq!(
        String::from_utf8(
            run_git(
                path,
                &[
                    "for-each-ref",
                    "--format=%(objectname)",
                    "refs/git-khronos/recovery/"
                ]
            )
            .unwrap()
            .stdout
        )
        .unwrap()
        .trim(),
        original
    );
}

#[test]
fn interactive_rebase_reword_input_validation_precedes_recovery_and_support_writes() {
    let repository = Repository::new();
    let path = &repository.0;
    create_branch(path, "feature").unwrap();
    fs::write(path.join("new"), b"new\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "New").unwrap();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    let head = repository.oid();
    let refs = run_git(path, &["show-ref"]).unwrap().stdout;
    for message in [
        "".to_owned(),
        "nul\0message".to_owned(),
        "x".repeat(MAX_COMMIT_MESSAGE_BYTES + 1),
    ] {
        let steps = [InteractiveRebaseStep {
            oid: plan.commits[0].oid.clone(),
            action: "reword".into(),
            message: Some(message),
        }];
        assert_eq!(
            execute_interactive_rebase(path, "feature", "main", &steps)
                .unwrap_err()
                .kind,
            "invalidInteractiveRebase"
        );
        assert_eq!(repository.oid(), head);
        assert_eq!(run_git(path, &["show-ref"]).unwrap().stdout, refs);
        assert!(!path.join(".git/git-khronos-rebase").exists());
    }
}

#[test]
fn interactive_rebase_refuses_recovery_reference_failure_before_checkout_or_support_changes() {
    let repository = Repository::new();
    let path = &repository.0;
    create_branch(path, "feature").unwrap();
    fs::write(path.join("feature"), b"feature contents\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Feature").unwrap();
    let source = repository.oid();
    checkout_branch(path, "main").unwrap();
    let head = repository.oid();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    let steps = [InteractiveRebaseStep {
        oid: plan.commits[0].oid.clone(),
        action: "pick".into(),
        message: None,
    }];
    fs::write(
        path.join(".git/refs/git-khronos"),
        b"owned recovery namespace obstruction\n",
    )
    .unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let error = execute_interactive_rebase(path, "feature", "main", &steps).unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert_eq!(repository.oid(), head);
    assert_eq!(read_status(path).unwrap().branch.as_deref(), Some("main"));
    assert_eq!(
        String::from_utf8(run_git(path, &["rev-parse", "feature"]).unwrap().stdout)
            .unwrap()
            .trim(),
        source
    );
    assert!(!path.join("feature").exists());
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(path.join(".git/refs/git-khronos")).unwrap(),
        b"owned recovery namespace obstruction\n"
    );
    assert!(!path.join(".git/git-khronos-rebase").exists());
    assert!(!read_status(path).unwrap().rebase_in_progress);
}

#[test]
fn interactive_rebase_conflicted_fixup_plan_preserves_source_and_abort_restores_it() {
    let repository = Repository::new();
    let path = &repository.0;
    create_branch(path, "feature").unwrap();
    for contents in [b"feature first\n".as_slice(), b"feature fixup\n".as_slice()] {
        fs::write(path.join("file"), contents).unwrap();
        stage_path(path, "file").unwrap();
        commit(path, std::str::from_utf8(contents).unwrap()).unwrap();
    }
    let original = repository.oid();
    checkout_branch(path, "main").unwrap();
    fs::write(path.join("file"), b"target change\n").unwrap();
    stage_path(path, "file").unwrap();
    commit(path, "Target change").unwrap();
    let target = repository.oid();
    let plan = prepare_interactive_rebase(path, "feature", "main").unwrap();
    let steps = plan
        .commits
        .iter()
        .enumerate()
        .map(|(index, commit)| InteractiveRebaseStep {
            oid: commit.oid.clone(),
            action: if index == 0 { "pick" } else { "fixup" }.into(),
            message: None,
        })
        .collect::<Vec<_>>();
    let config = fs::read(path.join(".git/config")).unwrap();
    assert_eq!(
        execute_interactive_rebase(path, "feature", "main", &steps)
            .unwrap_err()
            .kind,
        "rebaseConflict"
    );
    let status = read_status(path).unwrap();
    assert!(status.rebase_in_progress);
    assert_eq!(status.conflicted, 1);
    let recovery = run_git(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)",
            "refs/git-khronos/recovery/",
        ],
    )
    .unwrap()
    .stdout;
    assert!(
        String::from_utf8(recovery.clone())
            .unwrap()
            .contains(&original)
    );
    abort_rebase(path).unwrap();
    assert_eq!(repository.oid(), original);
    assert_eq!(
        read_status(path).unwrap().branch.as_deref(),
        Some("feature")
    );
    assert_eq!(fs::read(path.join("file")).unwrap(), b"feature fixup\n");
    assert_eq!(
        String::from_utf8(run_git(path, &["rev-parse", "main"]).unwrap().stdout)
            .unwrap()
            .trim(),
        target
    );
    assert_eq!(
        run_git(
            path,
            &[
                "for-each-ref",
                "--format=%(refname)%00%(objectname)",
                "refs/git-khronos/recovery/"
            ]
        )
        .unwrap()
        .stdout,
        recovery
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert!(!path.join(".git/git-khronos-rebase").exists());
}

#[test]
fn maintenance_packs_metadata_without_pruning_objects_reflogs_or_missing_worktree_registrations() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["worktree", "add", "-b", "maintenance-linked", "linked"],
        "create linked fixture",
    )
    .unwrap();
    fs::rename(path.join("linked"), path.join("temporarily-offline-linked")).unwrap();
    fs::write(path.join("file"), b"unstaged remains\n").unwrap();
    fs::write(path.join("staged"), b"staged remains\n").unwrap();
    stage_path(path, "staged").unwrap();
    fs::write(path.join("unreachable"), b"unreachable object remains\n").unwrap();
    let object = run_git(path, &["hash-object", "-w", "unreachable"]).unwrap();
    let oid = String::from_utf8(object.stdout).unwrap().trim().to_owned();
    for args in [
        ["config", "maintenance.gc.enabled", "true"],
        ["config", "maintenance.prefetch.enabled", "true"],
        ["config", "gc.pruneExpire", "now"],
        ["config", "gc.reflogExpire", "now"],
        ["config", "gc.worktreePruneExpire", "now"],
    ] {
        run_mutation(
            path,
            &args,
            "set aggressive disposable maintenance settings",
        )
        .unwrap();
    }
    let config = fs::read(path.join(".git/config")).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let reflog = fs::read(path.join(".git/logs/HEAD")).unwrap();
    let head = repository.oid();
    let registrations = run_git(path, &["worktree", "list", "--porcelain", "-z"])
        .unwrap()
        .stdout;
    let refs = run_git(path, &["for-each-ref", "--format=%(refname) %(objectname)"])
        .unwrap()
        .stdout;
    perform_repository_maintenance(path).unwrap();
    assert!(path.join(".git/packed-refs").exists());
    assert!(
        path.join(".git/objects/info/commit-graphs").exists()
            || path.join(".git/objects/info/commit-graph").exists()
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(".git/logs/HEAD")).unwrap(), reflog);
    assert_eq!(repository.oid(), head);
    assert_eq!(
        run_git(path, &["worktree", "list", "--porcelain", "-z"])
            .unwrap()
            .stdout,
        registrations
    );
    assert_eq!(
        run_git(path, &["for-each-ref", "--format=%(refname) %(objectname)"])
            .unwrap()
            .stdout,
        refs
    );
    assert_eq!(fs::read(path.join("file")).unwrap(), b"unstaged remains\n");
    assert_eq!(fs::read(path.join("staged")).unwrap(), b"staged remains\n");
    let object = run_git(path, &["cat-file", "-p", &oid]).unwrap();
    ensure_success("read retained unreachable object", &object).unwrap();
    assert_eq!(object.stdout, b"unreachable object remains\n");
}

#[test]
fn maintenance_integrity_refusal_never_builds_metadata_or_changes_damaged_objects() {
    let repository = Repository::new();
    let path = &repository.0;
    let head = repository.oid();
    let object = path.join(".git/objects").join(&head[..2]).join(&head[2..]);
    let original = fs::read(&object).unwrap();
    fs::remove_file(&object).unwrap();
    fs::write(&object, b"").unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let error = perform_repository_maintenance(path).unwrap_err();
    assert_eq!(error.kind, "maintenanceIntegrityFailed");
    assert!(error.hint.unwrap().contains("No maintenance task"));
    assert!(!path.join(".git/packed-refs").exists());
    assert!(!path.join(".git/objects/info/commit-graphs").exists());
    assert_eq!(fs::read(&object).unwrap(), b"");
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    fs::write(object, original).unwrap();
}

#[test]
fn integrity_report_inspects_clean_dirty_and_damaged_repositories_without_repair_or_lost_found() {
    let repository = Repository::new();
    let path = &repository.0;
    fs::write(path.join("file"), b"unstaged edit\n").unwrap();
    fs::write(path.join("staged"), b"staged edit\n").unwrap();
    stage_path(path, "staged").unwrap();
    fs::write(path.join("unreferenced-blob"), b"orphan content\n").unwrap();
    run_mutation(
        path,
        &["hash-object", "-w", "unreferenced-blob"],
        "create dangling fixture",
    )
    .unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let head = repository.oid();
    let clean = inspect_integrity(path, &CancellationToken::default()).unwrap();
    assert!(clean.passed);
    assert_eq!(clean.exit_code, 0);
    assert!(!clean.truncated);
    assert!(clean.stdout.contains("dangling blob"));
    let object = path.join(".git/objects").join(&head[..2]).join(&head[2..]);
    let original = fs::read(&object).unwrap();
    fs::remove_file(&object).unwrap();
    fs::write(&object, b"").unwrap();
    let damaged = inspect_integrity(path, &CancellationToken::default()).unwrap();
    assert!(!damaged.passed);
    assert_ne!(damaged.exit_code, 0);
    assert!(damaged.stderr.contains("is empty") || damaged.stderr.contains("is corrupt"));
    assert_eq!(fs::read(&object).unwrap(), b"");
    assert!(!path.join(".git/lost-found").exists());
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(path.join("file")).unwrap(), b"unstaged edit\n");
    assert_eq!(fs::read(path.join("staged")).unwrap(), b"staged edit\n");
    fs::write(object, original).unwrap();
    assert!(
        inspect_integrity(path, &CancellationToken::default())
            .unwrap()
            .passed
    );
    assert_eq!(repository.oid(), head);
}

#[test]
fn integrity_refuses_promisor_configuration_and_precancellation_without_mutation() {
    let repository = Repository::new();
    let path = &repository.0;
    let cancellation = CancellationToken::default();
    cancellation.cancel();
    assert_eq!(
        inspect_integrity(path, &cancellation).unwrap_err().kind,
        "operationCancelled"
    );
    run_mutation(
        path,
        &["config", "remote.unavailable.promisor", "true"],
        "configure promisor",
    )
    .unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    assert_eq!(
        inspect_integrity(path, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "integrityScopeUnsupported"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert!(!path.join(".git/lost-found").exists());
}

#[test]
fn integrity_cancellation_during_large_object_check_never_returns_a_success_report() {
    let repository = Repository::new();
    let path = &repository.0;
    fs::write(
        path.join("large-integrity-object"),
        vec![b'x'; 64 * 1024 * 1024],
    )
    .unwrap();
    let hash = run_git(path, &["hash-object", "-w", "large-integrity-object"]).unwrap();
    ensure_success("write disposable large integrity object", &hash).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let head = repository.oid();
    let cancellation = CancellationToken::default();
    let cancel = cancellation.clone();
    let worker = thread::spawn(move || {
        thread::sleep(Duration::from_millis(20));
        cancel.cancel();
    });
    let result = inspect_integrity(path, &cancellation);
    worker.join().unwrap();
    assert_eq!(result.unwrap_err().kind, "operationCancelled");
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(repository.oid(), head);
    assert_eq!(
        fs::metadata(path.join("large-integrity-object"))
            .unwrap()
            .len(),
        64 * 1024 * 1024
    );
    assert!(!path.join(".git/lost-found").exists());
}

#[test]
fn integrity_preserves_linked_unborn_state_and_honors_configured_bare_repository_policy() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["worktree", "add", "-b", "inspection-linked", "linked"],
        "create linked fixture",
    )
    .unwrap();
    let linked = path.join("linked");
    let link = fs::read(linked.join(".git")).unwrap();
    assert!(
        inspect_integrity(&linked, &CancellationToken::default())
            .unwrap()
            .passed
    );
    assert_eq!(fs::read(linked.join(".git")).unwrap(), link);
    assert!(!linked.join(".git/lost-found").exists());
    run_mutation(
        path,
        &["clone", "--bare", ".", "inspection-bare.git"],
        "create bare fixture",
    )
    .unwrap();
    let bare = path.join("inspection-bare.git");
    let config = fs::read(bare.join("config")).unwrap();
    let head = fs::read(bare.join("HEAD")).unwrap();
    let report = inspect_integrity(&bare, &CancellationToken::default()).unwrap();
    let policy = run_git(path, &["config", "--get", "safe.bareRepository"]).unwrap();
    if String::from_utf8_lossy(&policy.stdout).trim() == "explicit" {
        assert!(!report.passed);
        assert_eq!(report.exit_code, 128);
        assert!(report.stderr.contains("safe.bareRepository is 'explicit'"));
    } else {
        assert!(report.passed, "{report:?}");
    }
    assert_eq!(fs::read(bare.join("config")).unwrap(), config);
    assert_eq!(fs::read(bare.join("HEAD")).unwrap(), head);
    assert!(!bare.join("lost-found").exists());
    let unborn = path.join("inspection-unborn");
    fs::create_dir(&unborn).unwrap();
    run_mutation(&unborn, &["init", "-b", "main"], "create unborn fixture").unwrap();
    let config = fs::read(unborn.join(".git/config")).unwrap();
    let report = inspect_integrity(&unborn, &CancellationToken::default()).unwrap();
    assert!(report.passed);
    assert_eq!(fs::read(unborn.join(".git/config")).unwrap(), config);
    assert!(!unborn.join(".git/index").exists());
    assert!(!unborn.join(".git/lost-found").exists());
}

#[test]
fn git_lock_failure_explains_safe_retry_without_touching_foreign_lock_or_repository_data() {
    let repository = Repository::new();
    let path = &repository.0;
    fs::write(path.join("file"), b"unstaged edit\n").unwrap();
    let lock = path.join(".git/index.lock");
    fs::write(&lock, b"owned by another operation\n").unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let head = repository.oid();
    let error = stage_path(path, "file").unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert!(error.message.contains("index.lock"));
    assert!(error.hint.as_ref().unwrap().contains("Never delete a lock"));
    assert_eq!(fs::read(&lock).unwrap(), b"owned by another operation\n");
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(path.join("file")).unwrap(), b"unstaged edit\n");
    assert_eq!(repository.oid(), head);
    fs::remove_file(lock).unwrap();
    stage_path(path, "file").unwrap();
    assert_ne!(fs::read(path.join(".git/index")).unwrap(), index);
}

#[test]
fn git_corrupt_object_failure_preserves_original_error_and_has_no_implicit_repair() {
    let repository = Repository::new();
    let path = &repository.0;
    let oid = repository.oid();
    let object = path.join(".git/objects").join(&oid[..2]).join(&oid[2..]);
    let original = fs::read(&object).unwrap();
    fs::remove_file(&object).unwrap();
    fs::write(&object, b"").unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let file = fs::read(path.join("file")).unwrap();
    let output = run_git(path, &["cat-file", "-p", &oid]).unwrap();
    let error = ensure_success("read the corrupt fixture commit", &output).unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert!(error.message.contains("is empty") || error.message.contains("is corrupt"));
    assert!(error.hint.as_ref().unwrap().contains("git fsck --full"));
    assert!(
        error
            .hint
            .as_ref()
            .unwrap()
            .contains("maintenance and pruning cannot restore missing data")
    );
    assert_eq!(fs::read(&object).unwrap(), b"");
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(path.join("file")).unwrap(), file);
    fs::write(object, original).unwrap();
    assert_eq!(repository.oid(), oid);
}

#[test]
fn git_corrupt_index_guidance_preserves_staged_bytes_and_does_not_reset_the_index() {
    let repository = Repository::new();
    let path = &repository.0;
    let index_path = path.join(".git/index");
    let index = fs::read(&index_path).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let head = repository.oid();
    fs::write(&index_path, b"damaged").unwrap();
    let output = run_git(path, &["status", "--porcelain"]).unwrap();
    let error = ensure_success("read status", &output).unwrap_err();
    assert!(
        error
            .hint
            .as_ref()
            .unwrap()
            .contains("Do not delete or rebuild the index")
    );
    assert_eq!(fs::read(&index_path).unwrap(), b"damaged");
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(repository.oid(), head);
    fs::write(index_path, index).unwrap();
}

#[test]
fn git_failure_guidance_retains_contract_and_redacts_credentials_in_original_diagnostics() {
    let repository = Repository::new();
    let mut output = run_git(&repository.0, &["rev-parse", "--verify", "no-such-ref"]).unwrap();
    output.stderr =
        b"fatal: unable to write https://user:secret@example.test/repo: No space left on device\n"
            .to_vec();
    let error = AppError::git_failure("write fixture", &output);
    assert_eq!(error.kind, "gitFailure");
    assert!(error.message.contains("No space left on device"));
    assert!(!error.message.contains("secret"));
    assert!(!error.message.contains("user:"));
    assert!(
        error
            .hint
            .as_ref()
            .unwrap()
            .contains("Writes may have partially completed")
    );
    assert_eq!(serde_json::to_value(&error).unwrap()["kind"], "gitFailure");
    output.stderr.clear();
    let error = AppError::git_failure("write fixture", &output);
    assert!(error.message.contains("Git could not write fixture"));
    assert_eq!(
        error.hint.as_deref(),
        Some("Resolve the Git error and refresh the repository.")
    );
}

#[test]
fn git_operational_failure_during_rebase_keeps_recovery_hint_instead_of_conflict_instructions() {
    let repository = Repository::new();
    let path = &repository.0;
    let state = path.join(".git/rebase-merge");
    fs::create_dir(&state).unwrap();
    fs::write(state.join("git-rebase-todo"), b"pick original\n").unwrap();
    let mut output = run_git(path, &["rev-parse", "--verify", "no-such-ref"]).unwrap();
    output.stderr = b"fatal: Unable to create index.lock: File exists.".to_vec();
    let error = finish_rebase_command(path, output, "continue rebase").unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert!(error.hint.as_ref().unwrap().contains("Never delete a lock"));
    assert_eq!(
        fs::read(state.join("git-rebase-todo")).unwrap(),
        b"pick original\n"
    );
    let mut output = run_git(path, &["rev-parse", "--verify", "no-such-ref"]).unwrap();
    output.stderr = b"error: could not apply the selected commit".to_vec();
    let error = finish_rebase_command(path, output, "continue rebase").unwrap_err();
    assert_eq!(error.kind, "rebaseConflict");
    assert!(
        error
            .hint
            .as_ref()
            .unwrap()
            .contains("Resolve conflicted files")
    );
    assert_eq!(
        fs::read(state.join("git-rebase-todo")).unwrap(),
        b"pick original\n"
    );
}

#[test]
fn commit_template_uses_git_comment_configuration_and_literal_paths_without_mutation() {
    let repository = Repository::new();
    let path = &repository.0;
    #[cfg(unix)]
    let template_name = " template\twith\nspaces ";
    #[cfg(not(unix))]
    let template_name = "template with spaces.txt";
    fs::write(
        path.join(template_name),
        b"; guidance\n# Literal heading\n\nBody  \n\n\n  ; literal indented text\n",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "commit.template", template_name],
        "configure template",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "core.commentChar", ";"],
        "configure comments",
    )
    .unwrap();
    fs::write(path.join("file"), b"unstaged contents remain\n").unwrap();
    fs::write(path.join("staged"), b"staged contents remain\n").unwrap();
    stage_path(path, "staged").unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let head = repository.oid();
    let template = commit_template::read(path).unwrap().unwrap();
    assert_eq!(
        template,
        "# Literal heading\n\nBody\n\n  ; literal indented text\n"
    );
    let data = snapshot(path).unwrap();
    assert_eq!(data.commit_template.as_deref(), Some(template.as_str()));
    assert!(data.commit_template_error.is_none());
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(repository.oid(), head);
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"unstaged contents remain\n"
    );
    assert_eq!(
        fs::read(path.join("staged")).unwrap(),
        b"staged contents remain\n"
    );
    assert_eq!(
        fs::read(path.join(template_name)).unwrap(),
        b"; guidance\n# Literal heading\n\nBody  \n\n\n  ; literal indented text\n"
    );
}

#[test]
fn commit_template_failures_remain_visible_in_usable_snapshots_and_repair_can_be_retried() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "commit.template", "missing-template"],
        "configure template",
    )
    .unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let head = repository.oid();
    let data = snapshot(path).unwrap();
    assert!(data.commit_template.is_none());
    let error = data.commit_template_error.as_ref().unwrap();
    assert_eq!(error.kind, "commitTemplateUnavailable");
    assert!(error.hint.as_ref().unwrap().contains("refresh"));
    assert_eq!(
        serde_json::to_value(&data).unwrap()["commitTemplateError"]["kind"],
        "commitTemplateUnavailable"
    );
    fs::write(
        path.join("missing-template"),
        b"Repaired template\n\n# guidance\n",
    )
    .unwrap();
    let repaired = snapshot(path).unwrap();
    assert_eq!(
        repaired.commit_template.as_deref(),
        Some("Repaired template\n")
    );
    assert!(repaired.commit_template_error.is_none());
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(repository.oid(), head);
}

#[test]
fn commit_template_bounds_and_invalid_text_are_explicit_and_empty_templates_are_distinct() {
    let repository = Repository::new();
    let path = &repository.0;
    assert!(commit_template::read(path).unwrap().is_none());
    run_mutation(
        path,
        &["config", "commit.template", "message-template"],
        "configure template",
    )
    .unwrap();
    for bytes in [
        b"\xff".as_slice(),
        b"Summary\0body",
        &vec![b'x'; 1024 * 1024 + 1],
    ] {
        fs::write(path.join("message-template"), bytes).unwrap();
        assert_eq!(
            commit_template::read(path).unwrap_err().kind,
            "commitTemplateUnavailable"
        );
    }
    fs::write(path.join("message-template"), vec![b'x'; 1024 * 1024]).unwrap();
    assert_eq!(
        commit_template::read(path).unwrap().unwrap().len(),
        1024 * 1024 + 1
    );
    for text in ["", "# Only guidance\n\n"] {
        fs::write(path.join("message-template"), text).unwrap();
        assert_eq!(commit_template::read(path).unwrap().as_deref(), Some(""));
    }
    run_mutation(
        path,
        &["config", "commit.template", ".git"],
        "configure directory",
    )
    .unwrap();
    assert_eq!(
        commit_template::read(path).unwrap_err().kind,
        "commitTemplateUnavailable"
    );
    run_mutation(
        path,
        &["config", "commit.template", ""],
        "configure empty path",
    )
    .unwrap();
    assert_eq!(
        commit_template::read(path).unwrap_err().kind,
        "commitTemplateUnavailable"
    );
}

#[test]
fn commit_identity_overrides_are_independent_scoped_and_signoff_uses_committer() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate hooks",
    )
    .unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let read = || {
        String::from_utf8(
            run_git(path, &["log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%B"])
                .unwrap()
                .stdout,
        )
        .unwrap()
    };
    let policy = CommitPolicy {
        allow_empty: true,
        sign_off: true,
        author: Some(commit_identity("Original Writer", "writer@example.test")),
        committer: Some(commit_identity("Recording Person", "recorder@example.test")),
    };
    commit_with_policy(path, "Both overrides", false, false, Some(false), &policy).unwrap();
    let actual = read();
    assert!(actual.starts_with(
        "Original Writer <writer@example.test>\nRecording Person <recorder@example.test>\n"
    ));
    assert!(actual.contains("Signed-off-by: Recording Person <recorder@example.test>"));
    assert!(!actual.contains("Signed-off-by: Original Writer"));
    let committer_only = CommitPolicy {
        allow_empty: true,
        committer: Some(commit_identity("Other Recorder", "other@example.test")),
        ..CommitPolicy::default()
    };
    commit_with_policy(
        path,
        "Only committer",
        false,
        false,
        Some(false),
        &committer_only,
    )
    .unwrap();
    assert!(read().starts_with("Test <test@example.test>\nOther Recorder <other@example.test>\n"));
    let author_only = CommitPolicy {
        allow_empty: true,
        author: Some(commit_identity("Unicode Writér", "author@example.test")),
        ..CommitPolicy::default()
    };
    commit_with_policy(path, "Only author", false, false, Some(false), &author_only).unwrap();
    assert!(read().starts_with("Unicode Writér <author@example.test>\nTest <test@example.test>\n"));
    commit_with_policy(
        path,
        "Configured identity restored",
        false,
        false,
        Some(false),
        &CommitPolicy {
            allow_empty: true,
            ..CommitPolicy::default()
        },
    )
    .unwrap();
    assert!(read().starts_with("Test <test@example.test>\nTest <test@example.test>\n"));
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[test]
fn commit_identity_amend_preserves_author_unless_explicitly_replaced() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate hooks",
    )
    .unwrap();
    let policy = CommitPolicy {
        allow_empty: true,
        author: Some(commit_identity("First Author", "first@example.test")),
        ..CommitPolicy::default()
    };
    commit_with_policy(path, "Original", false, false, Some(false), &policy).unwrap();
    let parent = run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout;
    let tree = run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout;
    commit_with_policy(
        path,
        "Keep author",
        true,
        false,
        Some(false),
        &CommitPolicy {
            allow_empty: true,
            committer: Some(commit_identity("New Committer", "new@example.test")),
            ..CommitPolicy::default()
        },
    )
    .unwrap();
    assert_eq!(
        run_git(path, &["log", "-1", "--format=%an <%ae>%n%cn <%ce>"])
            .unwrap()
            .stdout,
        b"First Author <first@example.test>\nNew Committer <new@example.test>\n"
    );
    commit_with_policy(
        path,
        "Replace author",
        true,
        false,
        Some(false),
        &CommitPolicy {
            allow_empty: true,
            author: Some(commit_identity(
                "Replacement Author",
                "replacement@example.test",
            )),
            ..CommitPolicy::default()
        },
    )
    .unwrap();
    assert_eq!(
        run_git(path, &["log", "-1", "--format=%an <%ae>%n%cn <%ce>"])
            .unwrap()
            .stdout,
        b"Replacement Author <replacement@example.test>\nTest <test@example.test>\n"
    );
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout,
        parent
    );
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout,
        tree
    );
}

#[test]
fn commit_identity_invalid_overrides_fail_before_git_without_reference_or_index_changes() {
    let repository = Repository::new();
    let path = &repository.0;
    let head = repository.oid();
    let index = fs::read(path.join(".git/index")).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    for (name, email) in [
        ("", "valid@example.test"),
        (" Name", "valid@example.test"),
        ("Name\nInjected", "valid@example.test"),
        ("<Name>", "valid@example.test"),
        ("Name", "pattern"),
        ("Name", "@example.test"),
        ("Name", "one@two@three"),
        ("Name", "name@"),
        ("Name", "name @example.test"),
        ("Name", "name@example.test\nInjected"),
        ("Name\tInjected", "name@example.test"),
    ] {
        for author in [true, false] {
            let identity = Some(commit_identity(name, email));
            let policy = CommitPolicy {
                allow_empty: true,
                author: if author { identity.clone() } else { None },
                committer: if author { None } else { identity },
                ..CommitPolicy::default()
            };
            assert_eq!(
                commit_with_policy(path, "Invalid override", false, false, Some(false), &policy)
                    .unwrap_err()
                    .kind,
                "invalidCommitIdentity"
            );
        }
    }
    assert!(
        validate_commit_identity(&commit_identity(&"n".repeat(257), "valid@example.test")).is_err()
    );
    assert!(
        validate_commit_identity(&commit_identity("Name", &format!("{}@e", "x".repeat(319))))
            .is_err()
    );
    assert!(
        validate_commit_identity(&commit_identity(
            &"n".repeat(256),
            &format!("{}@e", "x".repeat(318))
        ))
        .is_ok()
    );
    let old =
        serde_json::from_str::<CommitPolicy>(r#"{"signOff":false,"allowEmpty":true}"#).unwrap();
    assert!(old.author.is_none() && old.committer.is_none());
    assert!(serde_json::from_str::<CommitPolicy>(r#"{"signOff":false,"allowEmpty":true,"author":{"name":"Name","email":"name@example.test","date":"now"}}"#).is_err());
    assert_eq!(repository.oid(), head);
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[cfg(unix)]
#[test]
fn commit_identity_hooks_observe_scoped_committer_and_refusal_does_not_persist_it() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate hooks",
    )
    .unwrap();
    let hook = path.join(".git/hooks/commit-msg");
    fs::write(&hook, b"#!/bin/sh\nprintf '%s <%s>\\n' \"$GIT_COMMITTER_NAME\" \"$GIT_COMMITTER_EMAIL\" > hook-identity\nexit 1\n").unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let head = repository.oid();
    let policy = CommitPolicy {
        allow_empty: true,
        committer: Some(commit_identity("Scoped Recorder", "scoped@example.test")),
        ..CommitPolicy::default()
    };
    assert!(commit_with_policy(path, "Hook refuses", false, false, Some(false), &policy).is_err());
    assert_eq!(
        fs::read(path.join("hook-identity")).unwrap(),
        b"Scoped Recorder <scoped@example.test>\n"
    );
    assert_eq!(repository.oid(), head);
    fs::remove_file(hook).unwrap();
    commit_with_policy(
        path,
        "Next ordinary identity",
        false,
        false,
        Some(false),
        &CommitPolicy {
            allow_empty: true,
            ..CommitPolicy::default()
        },
    )
    .unwrap();
    assert_eq!(
        run_git(path, &["log", "-1", "--format=%cn <%ce>"])
            .unwrap()
            .stdout,
        b"Test <test@example.test>\n"
    );
}

#[test]
fn commit_policy_defaults_refuse_empty_and_opt_in_preserves_unstaged_files() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate hooks",
    )
    .unwrap();
    fs::write(path.join("file"), b"unstaged only\n").unwrap();
    fs::write(path.join("untracked"), b"keep\n").unwrap();
    let head = repository.oid();
    let tree = run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout;
    let staged = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let config = fs::read(path.join(".git/config")).unwrap();
    assert!(commit_with_options(path, "No staged files", false, false, Some(false)).is_err());
    assert_eq!(repository.oid(), head);
    let policy = CommitPolicy {
        sign_off: true,
        allow_empty: true,
        ..CommitPolicy::default()
    };
    assert!(commit_with_policy(path, " \n", false, false, Some(false), &policy).is_err());
    assert_eq!(repository.oid(), head);
    commit_with_policy(
        path,
        "Explicit unchanged tree",
        false,
        false,
        Some(false),
        &policy,
    )
    .unwrap();
    assert_ne!(repository.oid(), head);
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout,
        tree
    );
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout,
        format!("{head}\n").as_bytes()
    );
    let message =
        String::from_utf8(run_git(path, &["log", "-1", "--format=%B"]).unwrap().stdout).unwrap();
    assert!(message.contains("Signed-off-by: Test <test@example.test>"));
    assert_eq!(fs::read(path.join("file")).unwrap(), b"unstaged only\n");
    assert_eq!(fs::read(path.join("untracked")).unwrap(), b"keep\n");
    assert_eq!(
        run_git(path, &["diff", "--cached", "--exit-code"])
            .unwrap()
            .status
            .code(),
        Some(0)
    );
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        staged
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[test]
fn commit_policy_includes_staged_tree_and_git_deduplicates_committer_signoff() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate hooks",
    )
    .unwrap();
    fs::write(path.join("file"), b"staged contents\n").unwrap();
    stage_all(path).unwrap();
    fs::write(path.join("file"), b"later unstaged contents\n").unwrap();
    let expected_tree = run_git(path, &["write-tree"]).unwrap().stdout;
    let policy = CommitPolicy {
        sign_off: true,
        allow_empty: true,
        ..CommitPolicy::default()
    };
    commit_with_policy(path, "With staged contents\n\nCo-authored-by: Other <other@example.test>\nSigned-off-by: Test <test@example.test>", false, false, Some(false), &policy).unwrap();
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout,
        expected_tree
    );
    let message =
        String::from_utf8(run_git(path, &["log", "-1", "--format=%B"]).unwrap().stdout).unwrap();
    assert_eq!(
        message
            .matches("Signed-off-by: Test <test@example.test>")
            .count(),
        1
    );
    assert!(message.contains("Co-authored-by: Other <other@example.test>"));
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"later unstaged contents\n"
    );
    let parent = run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout;
    commit_with_policy(
        path,
        "Amended with signoff",
        true,
        false,
        Some(false),
        &policy,
    )
    .unwrap();
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout,
        parent
    );
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^{tree}"]).unwrap().stdout,
        expected_tree
    );
}

#[cfg(unix)]
#[test]
fn commit_policy_never_bypasses_failing_commit_hooks_or_signer() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate hooks",
    )
    .unwrap();
    fs::write(path.join("file"), b"staged work\n").unwrap();
    stage_all(path).unwrap();
    let head = repository.oid();
    let staged = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let policy = CommitPolicy {
        sign_off: true,
        allow_empty: true,
        ..CommitPolicy::default()
    };
    for name in ["pre-commit", "prepare-commit-msg", "commit-msg"] {
        let hook = path.join(".git/hooks").join(name);
        fs::write(
            &hook,
            b"#!/bin/sh\nprintf 'Fixture hook refused commit\\n' >&2\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        let error = commit_with_policy(path, "Hook must run", false, false, Some(false), &policy)
            .unwrap_err();
        assert_eq!(error.kind, "gitFailure");
        assert_eq!(repository.oid(), head);
        assert_eq!(
            run_git(path, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            staged
        );
        fs::remove_file(hook).unwrap();
    }
    run_mutation(
        path,
        &[
            "config",
            "gpg.program",
            "/definitely/missing/chronos-test-signer",
        ],
        "set unavailable signer",
    )
    .unwrap();
    assert!(
        commit_with_policy(
            path,
            "Signing must succeed",
            false,
            false,
            Some(true),
            &policy
        )
        .is_err()
    );
    assert_eq!(repository.oid(), head);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        staged
    );
    assert!(
        serde_json::from_str::<CommitPolicy>(
            r#"{"signOff":true,"allowEmpty":false,"skipHooks":true}"#
        )
        .is_err()
    );
}

#[test]
#[ignore = "requires ssh-keygen with SSH signing support"]
fn signing_ssh_round_trip_preserves_policy_and_distinguishes_trust_revocation_and_unsigned() {
    let repository = Repository::new();
    let path = &repository.0;
    let key = path.join(".git/signing-fixture");
    let output = Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-C", "chronos-test", "-f"])
        .arg(&key)
        .output()
        .expect("ssh-keygen is required for this optional qualification");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let public_key = fs::read_to_string(key.with_extension("pub")).unwrap();
    let signers = path.join(".git/allowed-signers-fixture");
    let revoked = path.join(".git/revoked-signers-fixture");
    fs::write(&signers, format!("signer@example.test {public_key}")).unwrap();
    fs::write(&revoked, "").unwrap();
    for (name, value) in [
        ("gpg.format", "ssh"),
        ("gpg.ssh.program", "ssh-keygen"),
        ("user.signingkey", key.to_str().unwrap()),
        ("gpg.ssh.allowedSignersFile", signers.to_str().unwrap()),
        ("gpg.ssh.revocationFile", revoked.to_str().unwrap()),
        ("commit.gpgsign", "true"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        run_mutation(
            path,
            &["config", name, value],
            "set disposable signing policy",
        )
        .unwrap();
    }
    let config = fs::read(path.join(".git/config")).unwrap();
    let diagnostic = signing_diagnostic(path).unwrap();
    assert!(diagnostic.available && diagnostic.key_configured);
    assert_eq!(diagnostic.format, "ssh");
    let policy = CommitPolicy {
        sign_off: true,
        allow_empty: true,
        author: Some(commit_identity("Fixture Author", "author@example.test")),
        committer: Some(commit_identity(
            "Fixture Committer",
            "committer@example.test",
        )),
    };
    fs::write(path.join("file"), b"unstaged remains during signing\n").unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    commit_with_policy(path, "Signed marker", false, false, None, &policy).unwrap();
    let signed = repository.oid();
    let details = commit_details(path, &signed).unwrap();
    assert_eq!(details.signature.status, "valid");
    assert_eq!(
        details.signature.signer.as_deref(),
        Some("signer@example.test")
    );
    assert_eq!(details.signature.trust.as_deref(), Some("fully"));
    assert!(
        details
            .signature
            .fingerprint
            .as_deref()
            .is_some_and(|value| value.starts_with("SHA256:"))
    );
    assert!(
        details
            .message
            .contains("Signed-off-by: Fixture Committer <committer@example.test>")
    );
    let identities = run_git(
        path,
        &["show", "-s", "--format=%an <%ae>%n%cn <%ce>", &signed],
    )
    .unwrap();
    assert_eq!(
        String::from_utf8(identities.stdout).unwrap().trim(),
        "Fixture Author <author@example.test>\nFixture Committer <committer@example.test>"
    );
    ensure_success(
        "verify generated fixture signature",
        &run_git(path, &["verify-commit", &signed]).unwrap(),
    )
    .unwrap();
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"unstaged remains during signing\n"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);

    fs::write(&signers, "").unwrap();
    let unknown = commit_details(path, &signed).unwrap().signature;
    assert_ne!(unknown.status, "valid");
    assert_ne!(unknown.status, "unsigned");
    assert!(
        !run_git(path, &["verify-commit", &signed])
            .unwrap()
            .status
            .success()
    );
    run_mutation(
        path,
        &["config", "--unset", "gpg.ssh.allowedSignersFile"],
        "remove fixture trust configuration",
    )
    .unwrap();
    let unconfigured = commit_details(path, &signed).unwrap().signature;
    assert_eq!(unconfigured.status, "unverifiable");
    run_mutation(
        path,
        &[
            "config",
            "gpg.ssh.allowedSignersFile",
            signers.to_str().unwrap(),
        ],
        "restore fixture trust configuration",
    )
    .unwrap();
    fs::write(&signers, format!("signer@example.test {public_key}")).unwrap();
    fs::write(&revoked, &public_key).unwrap();
    let revoked_signature = commit_details(path, &signed).unwrap().signature;
    assert_eq!(revoked_signature.status, "invalid");
    assert!(
        !run_git(path, &["verify-commit", &signed])
            .unwrap()
            .status
            .success()
    );
    fs::write(&revoked, "").unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();

    let parent = run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout;
    commit_with_policy(
        path,
        "Unsigned amend opt-out",
        true,
        false,
        Some(false),
        &CommitPolicy {
            allow_empty: true,
            ..CommitPolicy::default()
        },
    )
    .unwrap();
    assert_eq!(
        commit_details(path, &repository.oid())
            .unwrap()
            .signature
            .status,
        "unsigned"
    );
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout,
        parent
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"unstaged remains during signing\n"
    );

    fs::write(path.join("staged"), b"keep staged on signing failure\n").unwrap();
    stage_path(path, "staged").unwrap();
    let staged = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let unsigned = repository.oid();
    fs::remove_file(&key).unwrap();
    let error = commit_with_policy(path, "Signer key unavailable", false, false, None, &policy)
        .unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert_eq!(repository.oid(), unsigned);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        staged
    );
    assert_eq!(
        fs::read(path.join("staged")).unwrap(),
        b"keep staged on signing failure\n"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[cfg(unix)]
#[test]
fn commit_hook_opt_out_retains_prepare_hook_and_custom_hook_configuration() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let path = &repository.0;
    let hooks = path.join(".git/custom-fixture-hooks");
    fs::create_dir(&hooks).unwrap();
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/custom-fixture-hooks"],
        "set custom fixture hooks",
    )
    .unwrap();
    for name in ["pre-commit", "commit-msg"] {
        let hook = hooks.join(name);
        fs::write(
            &hook,
            b"#!/bin/sh\nprintf 'Verification hook refused\\n' >&2\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let prepare = hooks.join("prepare-commit-msg");
    fs::write(
        &prepare,
        b"#!/bin/sh\nprintf '\\nPrepared by fixture\\n' >> \"$1\"\n",
    )
    .unwrap();
    fs::set_permissions(&prepare, fs::Permissions::from_mode(0o755)).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    fs::write(path.join("file"), b"staged fixture change\n").unwrap();
    stage_path(path, "file").unwrap();
    let head = repository.oid();
    let index = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    assert!(
        commit_with_policy(
            path,
            "Default retains hooks",
            false,
            false,
            Some(false),
            &CommitPolicy::default()
        )
        .is_err()
    );
    assert_eq!(repository.oid(), head);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    commit_with_policy(
        path,
        "Explicit verification opt-out",
        false,
        true,
        Some(false),
        &CommitPolicy::default(),
    )
    .unwrap();
    assert!(
        commit_details(path, &repository.oid())
            .unwrap()
            .message
            .contains("Prepared by fixture")
    );

    fs::write(
        &prepare,
        b"#!/bin/sh\nprintf 'Prepare hook still refuses\\n' >&2\nexit 1\n",
    )
    .unwrap();
    let head = repository.oid();
    let policy = CommitPolicy {
        allow_empty: true,
        ..CommitPolicy::default()
    };
    let error = commit_with_policy(
        path,
        "Prepare hook must still run",
        false,
        true,
        Some(false),
        &policy,
    )
    .unwrap_err();
    assert!(error.message.contains("Prepare hook still refuses"));
    assert_eq!(repository.oid(), head);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[cfg(unix)]
struct GnuPgHome {
    path: PathBuf,
    program: &'static str,
}

#[test]
fn signing_diagnostic_respects_openpgp_alias_order_and_other_format_programs() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "gpg.format", "openpgp"],
        "select fixture format",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "gpg.program", "legacy-first-fixture"],
        "set legacy alias first",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "gpg.openpgp.program", "format-last-fixture"],
        "set format alias last",
    )
    .unwrap();
    assert_eq!(
        signing_diagnostic(path).unwrap().program,
        "format-last-fixture"
    );
    run_mutation(
        path,
        &["config", "--add", "gpg.program", "legacy-last-fixture"],
        "append legacy alias",
    )
    .unwrap();
    assert_eq!(
        signing_diagnostic(path).unwrap().program,
        "format-last-fixture"
    );
    fs::OpenOptions::new()
        .append(true)
        .open(path.join(".git/config"))
        .unwrap()
        .write_all(b"\n[gpg]\nprogram = legacy-last-fixture\n")
        .unwrap();
    assert_eq!(
        signing_diagnostic(path).unwrap().program,
        "legacy-last-fixture"
    );
    run_mutation(
        path,
        &["config", "gpg.ssh.program", "ssh-fixture"],
        "set SSH fixture program",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "gpg.x509.program", "x509-fixture"],
        "set X509 fixture program",
    )
    .unwrap();
    for (format, program) in [("ssh", "ssh-fixture"), ("x509", "x509-fixture")] {
        run_mutation(
            path,
            &["config", "gpg.format", format],
            "switch fixture format",
        )
        .unwrap();
        let diagnostic = signing_diagnostic(path).unwrap();
        assert_eq!(diagnostic.format, format);
        assert_eq!(diagnostic.program, program);
    }
    run_mutation(
        path,
        &["config", "gpg.format", "unknown-fixture"],
        "select unsupported fixture format",
    )
    .unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let diagnostic = signing_diagnostic(path).unwrap();
    assert!(!diagnostic.available);
    assert!(diagnostic.message.contains("unsupported signing format"));
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[cfg(unix)]
#[test]
fn signing_diagnostic_preserves_literal_program_paths_and_never_invokes_them() {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    let path = &repository.0;
    let program = path.join(" fixture signer\nwith spaces ");
    let marker = path.join("signer-was-invoked");
    fs::write(&program, b"#!/bin/sh\ntouch signer-was-invoked\nexit 1\n").unwrap();
    fs::set_permissions(&program, fs::Permissions::from_mode(0o700)).unwrap();
    run_mutation(
        path,
        &["config", "gpg.format", "openpgp"],
        "select fixture format",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "gpg.openpgp.program", program.to_str().unwrap()],
        "set literal fixture program",
    )
    .unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let diagnostic = signing_diagnostic(path).unwrap();
    assert!(diagnostic.available);
    assert_eq!(diagnostic.program, program.to_str().unwrap());
    assert!(!marker.exists());
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[test]
fn signing_diagnostic_refuses_empty_malformed_and_oversized_settings_without_defaults() {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "gpg.format", "openpgp"],
        "select fixture format",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "gpg.openpgp.program", ""],
        "set empty fixture program",
    )
    .unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    assert_eq!(
        signing_diagnostic(path).unwrap_err().kind,
        "invalidSigningProgram"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    run_mutation(
        path,
        &["config", "gpg.openpgp.program", &"x".repeat(65 * 1024)],
        "set oversized fixture program",
    )
    .unwrap();
    assert_eq!(
        signing_diagnostic(path).unwrap_err().kind,
        "signingConfigIncomplete"
    );
    fs::write(
        path.join(".git/config"),
        b"[gpg]\nformat = openpgp\n[gpg \"openpgp\"]\nprogram\n",
    )
    .unwrap();
    assert_eq!(
        signing_diagnostic(path).unwrap_err().kind,
        "invalidSigningConfig"
    );
    fs::write(
        path.join(".git/config"),
        b"[gpg]\nformat = openpgp\n[gpg \"openpgp\"]\nprogram = invalid-\xff\n",
    )
    .unwrap();
    assert_eq!(
        signing_diagnostic(path).unwrap_err().kind,
        "invalidSigningConfig"
    );
    fs::write(path.join(".git/config"), b"[gpg\nmalformed\n").unwrap();
    let error = signing_diagnostic(path).unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert!(error.message.contains("bad config"));
    assert_eq!(
        fs::read(path.join(".git/config")).unwrap(),
        b"[gpg\nmalformed\n"
    );
}

#[cfg(unix)]
impl GnuPgHome {
    fn new(program: &'static str) -> Self {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        assert!(matches!(program, "gpg" | "gpgsm"));
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("chronos-pgp-{}-{id}", std::process::id()));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        let home = Self { path, program };
        let signer = home.signer();
        let offline = if program == "gpgsm" {
            " --disable-dirmngr --disable-crl-checks"
        } else {
            ""
        };
        fs::write(&signer, format!("#!/bin/sh\nexec {program} --no-options --homedir \"$(dirname \"$0\")\" --batch --no-tty --pinentry-mode loopback{offline} \"$@\"\n")).unwrap();
        fs::set_permissions(signer, fs::Permissions::from_mode(0o700)).unwrap();
        home
    }

    fn signer(&self) -> PathBuf {
        self.path.join("fixture-signer")
    }

    fn run(&self, args: &[&str], input: Option<&[u8]>) -> Vec<u8> {
        let mut command = Command::new(self.program);
        command
            .arg("--no-options")
            .arg("--homedir")
            .arg(&self.path)
            .args(["--batch", "--no-tty", "--pinentry-mode", "loopback"]);
        if self.program == "gpgsm" {
            command.args(["--disable-dirmngr", "--disable-crl-checks"]);
        }
        let mut child = command
            .args(args)
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the selected GnuPG program is required for this optional qualification");
        if let Some(input) = input {
            child.stdin.take().unwrap().write_all(input).unwrap();
        }
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }
}

#[cfg(unix)]
impl Drop for GnuPgHome {
    fn drop(&mut self) {
        let stopped = Command::new("gpgconf")
            .arg("--homedir")
            .arg(&self.path)
            .args(["--kill", "gpg-agent"])
            .output();
        let result = stopped
            .and_then(|output| {
                if output.status.success() {
                    Ok(())
                } else {
                    Err(std::io::Error::other(
                        String::from_utf8_lossy(&output.stderr).into_owned(),
                    ))
                }
            })
            .and_then(|()| fs::remove_dir_all(&self.path));
        if let Err(error) = result {
            if std::thread::panicking() {
                eprintln!(
                    "Could not clean disposable signing fixture {}: {error}",
                    self.path.display()
                );
            } else {
                panic!(
                    "Could not clean disposable signing fixture {}: {error}",
                    self.path.display()
                );
            }
        }
    }
}

#[cfg(unix)]
#[test]
#[ignore = "requires gpg/gpgconf with isolated disposable signing keys"]
fn signing_openpgp_round_trip_distinguishes_trust_missing_keys_tampering_and_explicit_retry() {
    let repository = Repository::new();
    let path = &repository.0;
    let signer = GnuPgHome::new("gpg");
    let verifier = GnuPgHome::new("gpg");
    signer.run(
        &[
            "--passphrase",
            "",
            "--quick-generate-key",
            "Chronos Signing Fixture <signer@example.test>",
            "ed25519",
            "sign",
            "0",
        ],
        None,
    );
    let keys =
        String::from_utf8(signer.run(&["--with-colons", "--list-secret-keys"], None)).unwrap();
    let fingerprint = keys
        .lines()
        .find_map(|line| {
            let fields: Vec<_> = line.split(':').collect();
            (fields.first() == Some(&"fpr")).then(|| fields[9].to_owned())
        })
        .expect("generated fixture fingerprint");
    let public = signer.run(&["--export", &fingerprint], None);
    verifier.run(&["--import"], Some(&public));
    let program = signer.signer();
    for (name, value) in [
        ("gpg.format", "openpgp"),
        ("gpg.program", "/definitely/missing/legacy-openpgp-fixture"),
        ("gpg.openpgp.program", program.to_str().unwrap()),
        ("user.signingkey", fingerprint.as_str()),
        ("commit.gpgsign", "true"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        run_mutation(
            path,
            &["config", name, value],
            "set isolated fixture OpenPGP policy",
        )
        .unwrap();
    }
    let config = fs::read(path.join(".git/config")).unwrap();
    let policy = CommitPolicy {
        sign_off: true,
        author: Some(commit_identity("Fixture Author", "author@example.test")),
        committer: Some(commit_identity(
            "Fixture Committer",
            "committer@example.test",
        )),
        ..CommitPolicy::default()
    };
    fs::write(path.join("staged"), b"OpenPGP staged change\n").unwrap();
    stage_path(path, "staged").unwrap();
    fs::write(path.join("file"), b"OpenPGP unstaged remains\n").unwrap();
    let parent = repository.oid();
    commit_with_policy(path, "OpenPGP fixture signed", false, false, None, &policy).unwrap();
    let signed = repository.oid();
    let details = commit_details(path, &signed).unwrap();
    assert_eq!(details.signature.status, "valid");
    assert_eq!(
        details.signature.fingerprint.as_deref(),
        Some(fingerprint.as_str())
    );
    assert_eq!(details.signature.trust.as_deref(), Some("ultimate"));
    assert_eq!(
        details.signature.signer.as_deref(),
        Some("Chronos Signing Fixture <signer@example.test>")
    );
    assert!(
        details
            .message
            .contains("Signed-off-by: Fixture Committer <committer@example.test>")
    );
    assert_eq!(
        String::from_utf8(run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout)
            .unwrap()
            .trim(),
        parent
    );
    assert_eq!(
        run_git(path, &["show", "HEAD:staged"]).unwrap().stdout,
        b"OpenPGP staged change\n"
    );
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"OpenPGP unstaged remains\n"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    let diagnostic = signing_diagnostic(path).unwrap();
    assert!(diagnostic.available && diagnostic.key_configured);
    assert_eq!(diagnostic.format, "openpgp");
    ensure_success(
        "verify isolated OpenPGP signature",
        &run_git(path, &["verify-commit", &signed]).unwrap(),
    )
    .unwrap();
    create_signed_tag(path, "openpgp-release", &signed, "Isolated OpenPGP release").unwrap();
    verify_tag(path, "openpgp-release").unwrap();
    assert_eq!(tag_details(path, "openpgp-release").unwrap().oid, signed);

    let verify_program = verifier.signer();
    run_mutation(
        path,
        &[
            "config",
            "gpg.openpgp.program",
            verify_program.to_str().unwrap(),
        ],
        "select fixture verifier",
    )
    .unwrap();
    let unknown = commit_details(path, &signed).unwrap().signature;
    assert_eq!(unknown.status, "valid-unknown");
    assert_ne!(unknown.trust.as_deref(), Some("ultimate"));
    assert_eq!(unknown.fingerprint.as_deref(), Some(fingerprint.as_str()));
    verify_tag(path, "openpgp-release").unwrap();
    let object = run_git(path, &["cat-file", "commit", &signed])
        .unwrap()
        .stdout;
    let tampered = String::from_utf8(object)
        .unwrap()
        .replace("OpenPGP fixture signed", "OpenPGP fixture altered");
    let mut writer = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["hash-object", "-t", "commit", "-w", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    writer
        .stdin
        .take()
        .unwrap()
        .write_all(tampered.as_bytes())
        .unwrap();
    let output = writer.wait_with_output().unwrap();
    ensure_success("write owned tampered signature fixture", &output).unwrap();
    let tampered_oid = String::from_utf8(output.stdout).unwrap().trim().to_owned();
    assert_eq!(
        commit_details(path, &tampered_oid)
            .unwrap()
            .signature
            .status,
        "invalid"
    );
    assert!(
        !run_git(path, &["verify-commit", &tampered_oid])
            .unwrap()
            .status
            .success()
    );
    assert_eq!(repository.oid(), signed);
    verifier.run(&["--yes", "--delete-key", &fingerprint], None);
    assert_eq!(
        commit_details(path, &signed).unwrap().signature.status,
        "unverifiable"
    );
    assert!(
        !run_git(path, &["verify-commit", &signed])
            .unwrap()
            .status
            .success()
    );

    fs::write(path.join("staged"), b"retained on missing OpenPGP key\n").unwrap();
    stage_path(path, "staged").unwrap();
    let staged = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let failed_config = fs::read(path.join(".git/config")).unwrap();
    assert_eq!(
        verify_tag(path, "openpgp-release").unwrap_err().kind,
        "gitFailure"
    );
    assert_eq!(
        create_signed_tag(path, "openpgp-unavailable", &signed, "Key unavailable")
            .unwrap_err()
            .kind,
        "gitFailure"
    );
    assert_eq!(
        run_git(
            path,
            &[
                "show-ref",
                "--verify",
                "--quiet",
                "refs/tags/openpgp-unavailable"
            ]
        )
        .unwrap()
        .status
        .code(),
        Some(1)
    );
    let error = commit_with_policy(
        path,
        "Retry after correcting signer",
        false,
        false,
        None,
        &policy,
    )
    .unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert_eq!(repository.oid(), signed);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        staged
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), failed_config);
    run_mutation(
        path,
        &["config", "gpg.openpgp.program", program.to_str().unwrap()],
        "restore owned fixture signer",
    )
    .unwrap();
    create_signed_tag(path, "openpgp-unavailable", &signed, "Corrected signer").unwrap();
    verify_tag(path, "openpgp-unavailable").unwrap();
    commit_with_policy(
        path,
        "Retry after correcting signer",
        false,
        false,
        Some(true),
        &policy,
    )
    .unwrap();
    assert_eq!(
        commit_details(path, &repository.oid())
            .unwrap()
            .signature
            .status,
        "valid"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    let parent = run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout;
    commit_with_policy(
        path,
        "Explicit OpenPGP unsigned amend",
        true,
        false,
        Some(false),
        &CommitPolicy::default(),
    )
    .unwrap();
    assert_eq!(
        commit_details(path, &repository.oid())
            .unwrap()
            .signature
            .status,
        "unsigned"
    );
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout,
        parent
    );
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"OpenPGP unstaged remains\n"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
}

#[cfg(unix)]
#[test]
#[ignore = "requires gpgsm/gpgconf and openssl for isolated offline X509 signing"]
fn signing_x509_round_trip_keeps_certificate_trust_and_signing_failures_explicit() {
    let repository = Repository::new();
    let path = &repository.0;
    let signer = GnuPgHome::new("gpgsm");
    let verifier = GnuPgHome::new("gpgsm");
    let key = signer.path.join("fixture-private.pem");
    let certificate = signer.path.join("fixture-certificate.pem");
    let container = signer.path.join("fixture-certificate.p12");
    let created = Command::new("openssl")
        .args([
            "req",
            "-new",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "2",
            "-subj",
            "/CN=Chronos X509 Fixture/emailAddress=signer@example.test",
            "-addext",
            "keyUsage=critical,digitalSignature",
            "-addext",
            "extendedKeyUsage=emailProtection",
            "-keyout",
        ])
        .arg(&key)
        .arg("-out")
        .arg(&certificate)
        .output()
        .expect("openssl is required");
    assert!(
        created.status.success(),
        "{}",
        String::from_utf8_lossy(&created.stderr)
    );
    let packed = Command::new("openssl")
        .args(["pkcs12", "-export", "-passout", "pass:", "-inkey"])
        .arg(&key)
        .arg("-in")
        .arg(&certificate)
        .arg("-out")
        .arg(&container)
        .output()
        .unwrap();
    assert!(
        packed.status.success(),
        "{}",
        String::from_utf8_lossy(&packed.stderr)
    );
    signer.run(
        &["--passphrase", "", "--import", container.to_str().unwrap()],
        None,
    );
    let keys =
        String::from_utf8(signer.run(&["--with-colons", "--list-secret-keys"], None)).unwrap();
    let fingerprint = keys
        .lines()
        .find_map(|line| {
            let fields: Vec<_> = line.split(':').collect();
            (fields.first() == Some(&"fpr")).then(|| fields[9].to_owned())
        })
        .expect("generated fixture certificate fingerprint");
    let trusted = format!("{fingerprint} S\n");
    fs::write(signer.path.join("trustlist.txt"), &trusted).unwrap();
    let reloaded = Command::new("gpgconf")
        .arg("--homedir")
        .arg(&signer.path)
        .args(["--reload", "gpg-agent"])
        .output()
        .unwrap();
    assert!(
        reloaded.status.success(),
        "{}",
        String::from_utf8_lossy(&reloaded.stderr)
    );
    let program = signer.signer();
    for (name, value) in [
        ("gpg.format", "x509"),
        ("gpg.x509.program", program.to_str().unwrap()),
        ("user.signingkey", fingerprint.as_str()),
        ("commit.gpgsign", "true"),
        ("core.hooksPath", ".git/hooks"),
    ] {
        run_mutation(
            path,
            &["config", name, value],
            "set isolated fixture X509 policy",
        )
        .unwrap();
    }
    let config = fs::read(path.join(".git/config")).unwrap();
    fs::write(path.join("staged"), b"X509 staged change\n").unwrap();
    stage_path(path, "staged").unwrap();
    fs::write(path.join("file"), b"X509 unstaged remains\n").unwrap();
    let parent = repository.oid();
    commit_with_policy(
        path,
        "X509 fixture signed",
        false,
        false,
        None,
        &CommitPolicy::default(),
    )
    .unwrap();
    let signed = repository.oid();
    let details = commit_details(path, &signed).unwrap();
    assert_eq!(details.signature.status, "valid");
    assert_eq!(
        details.signature.fingerprint.as_deref(),
        Some(fingerprint.as_str())
    );
    assert!(
        details
            .signature
            .signer
            .as_deref()
            .is_some_and(|value| value.contains("Chronos X509 Fixture"))
    );
    assert_eq!(
        String::from_utf8(run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout)
            .unwrap()
            .trim(),
        parent
    );
    ensure_success(
        "verify isolated fixture certificate signature",
        &run_git(path, &["verify-commit", &signed]).unwrap(),
    )
    .unwrap();
    create_signed_tag(
        path,
        "x509-release",
        &signed,
        "Isolated offline certificate release",
    )
    .unwrap();
    verify_tag(path, "x509-release").unwrap();
    assert_eq!(tag_details(path, "x509-release").unwrap().oid, signed);
    let diagnostic = signing_diagnostic(path).unwrap();
    assert!(diagnostic.available && diagnostic.key_configured);
    assert_eq!(diagnostic.format, "x509");
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"X509 unstaged remains\n"
    );
    let object = run_git(path, &["cat-file", "commit", &signed])
        .unwrap()
        .stdout;
    let tampered = String::from_utf8(object)
        .unwrap()
        .replace("X509 fixture signed", "X509 fixture altered");
    fs::write(path.join(".git/tampered-certificate-commit"), tampered).unwrap();
    let output = run_git(
        path,
        &[
            "hash-object",
            "-t",
            "commit",
            "-w",
            "--",
            ".git/tampered-certificate-commit",
        ],
    )
    .unwrap();
    ensure_success("write owned tampered certificate fixture", &output).unwrap();
    let tampered_oid = String::from_utf8(output.stdout).unwrap().trim().to_owned();
    assert_eq!(
        commit_details(path, &tampered_oid)
            .unwrap()
            .signature
            .status,
        "invalid"
    );
    assert!(
        !run_git(path, &["verify-commit", &tampered_oid])
            .unwrap()
            .status
            .success()
    );
    assert_eq!(repository.oid(), signed);

    verifier.run(&["--import", certificate.to_str().unwrap()], None);
    let rejected_trust = format!("!{fingerprint} S\n");
    fs::write(verifier.path.join("trustlist.txt"), &rejected_trust).unwrap();
    let reloaded = Command::new("gpgconf")
        .arg("--homedir")
        .arg(&verifier.path)
        .args(["--reload", "gpg-agent"])
        .output()
        .unwrap();
    assert!(
        reloaded.status.success(),
        "{}",
        String::from_utf8_lossy(&reloaded.stderr)
    );
    let verify_program = verifier.signer();
    run_mutation(
        path,
        &[
            "config",
            "gpg.x509.program",
            verify_program.to_str().unwrap(),
        ],
        "select public-only fixture verifier",
    )
    .unwrap();
    let untrusted = commit_details(path, &signed).unwrap().signature;
    assert_ne!(untrusted.status, "valid");
    assert_ne!(untrusted.status, "unsigned");
    assert!(
        !run_git(path, &["verify-commit", &signed])
            .unwrap()
            .status
            .success()
    );
    fs::write(
        path.join("staged"),
        b"retained on unavailable certificate key\n",
    )
    .unwrap();
    stage_path(path, "staged").unwrap();
    let staged = run_git(path, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let failed_config = fs::read(path.join(".git/config")).unwrap();
    assert_eq!(
        verify_tag(path, "x509-release").unwrap_err().kind,
        "gitFailure"
    );
    assert_eq!(
        create_signed_tag(
            path,
            "x509-unavailable",
            &signed,
            "Certificate key unavailable"
        )
        .unwrap_err()
        .kind,
        "gitFailure"
    );
    assert_eq!(
        run_git(
            path,
            &[
                "show-ref",
                "--verify",
                "--quiet",
                "refs/tags/x509-unavailable"
            ]
        )
        .unwrap()
        .status
        .code(),
        Some(1)
    );
    let error = commit_with_policy(
        path,
        "X509 retry after signer correction",
        false,
        false,
        None,
        &CommitPolicy::default(),
    )
    .unwrap_err();
    assert_eq!(error.kind, "gitFailure");
    assert_eq!(repository.oid(), signed);
    assert_eq!(
        run_git(path, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        staged
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), failed_config);
    run_mutation(
        path,
        &["config", "gpg.x509.program", program.to_str().unwrap()],
        "restore fixture certificate signer",
    )
    .unwrap();
    create_signed_tag(
        path,
        "x509-unavailable",
        &signed,
        "Corrected certificate signer",
    )
    .unwrap();
    verify_tag(path, "x509-unavailable").unwrap();
    commit_with_policy(
        path,
        "X509 retry after signer correction",
        false,
        false,
        Some(true),
        &CommitPolicy::default(),
    )
    .unwrap();
    assert_eq!(
        commit_details(path, &repository.oid())
            .unwrap()
            .signature
            .status,
        "valid"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    let parent = run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout;
    commit_with_policy(
        path,
        "X509 explicit unsigned amend",
        true,
        false,
        Some(false),
        &CommitPolicy::default(),
    )
    .unwrap();
    assert_eq!(
        commit_details(path, &repository.oid())
            .unwrap()
            .signature
            .status,
        "unsigned"
    );
    assert_eq!(
        fs::read(path.join("file")).unwrap(),
        b"X509 unstaged remains\n"
    );
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(
        run_git(path, &["rev-parse", "HEAD^"]).unwrap().stdout,
        parent
    );
    assert_eq!(
        fs::read_to_string(signer.path.join("trustlist.txt")).unwrap(),
        trusted
    );
    assert_eq!(
        fs::read_to_string(verifier.path.join("trustlist.txt")).unwrap(),
        rejected_trust
    );
}

#[test]
fn worktree_registration_review_reports_missing_locked_dirty_and_detached_without_mutation() {
    let repository = Repository::new();
    let path = &repository.0;
    for (folder, branch) in [
        ("dirty tree", "dirty"),
        ("missing tree", "missing"),
        ("locked tree", "locked"),
    ] {
        create_worktree(path, path, folder, branch, "HEAD").unwrap();
    }
    let dirty = path.join("dirty tree");
    fs::write(dirty.join("file"), b"staged\n").unwrap();
    stage_path(&dirty, "file").unwrap();
    fs::write(dirty.join("file"), b"unstaged\n").unwrap();
    fs::write(dirty.join("untracked"), b"keep\n").unwrap();
    set_worktree_locked(path, path.join("locked tree").to_str().unwrap(), true).unwrap();
    // External relocation retains every owned fixture file while leaving the registration missing.
    fs::rename(path.join("missing tree"), path.join("moved missing")).unwrap();
    fs::rename(path.join("locked tree"), path.join("moved locked")).unwrap();
    run_mutation(
        path,
        &["worktree", "add", "--detach", "detached", "HEAD"],
        "create detached worktree",
    )
    .unwrap();
    let index = fs::read(dirty.join(".git")).unwrap();
    let staged = run_git(&dirty, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let refs = run_git(path, &["show-ref"]).unwrap().stdout;
    let config = fs::read(path.join(".git/config")).unwrap();
    let registration = fs::read(path.join(".git/worktrees/missing-tree/gitdir")).unwrap();
    let review = review_worktree_registrations(path).unwrap();
    assert_eq!(review.registrations.len(), 5);
    let missing = review
        .registrations
        .iter()
        .find(|entry| entry.branch.as_deref() == Some("missing"))
        .unwrap();
    assert!(missing.prunable);
    assert!(!missing.locked);
    assert!(
        missing
            .prune_reason
            .as_deref()
            .unwrap()
            .contains("non-existent")
    );
    let locked = review
        .registrations
        .iter()
        .find(|entry| entry.branch.as_deref() == Some("locked"))
        .unwrap();
    assert!(locked.locked);
    assert!(!locked.prunable);
    let detached = review
        .registrations
        .iter()
        .find(|entry| entry.path.ends_with("/detached"))
        .unwrap();
    assert_eq!(detached.branch, None);
    assert_eq!(detached.oid, Some(repository.oid()));
    assert!(review.prune_report.contains("missing-tree"));
    assert!(!review.prune_report.contains("locked-tree"));
    assert_eq!(fs::read(dirty.join(".git")).unwrap(), index);
    assert_eq!(
        run_git(&dirty, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        staged
    );
    assert_eq!(fs::read(dirty.join("file")).unwrap(), b"unstaged\n");
    assert_eq!(fs::read(dirty.join("untracked")).unwrap(), b"keep\n");
    assert_eq!(run_git(path, &["show-ref"]).unwrap().stdout, refs);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(
        fs::read(path.join(".git/worktrees/missing-tree/gitdir")).unwrap(),
        registration
    );
    assert!(path.join("moved missing").exists());
    assert!(path.join("moved locked").exists());
}

#[test]
fn worktree_registration_review_handles_unborn_and_literal_paths_without_bypassing_bare_policy() {
    let repository = Repository::new();
    let path = &repository.0;
    let folder = "line\nwith\ttab";
    create_worktree(path, path, folder, "literal", "HEAD").unwrap();
    let review = review_worktree_registrations(path).unwrap();
    assert!(
        review
            .registrations
            .iter()
            .any(|entry| entry.path == path.join(folder).to_str().unwrap())
    );
    assert!(review.prune_report.is_empty());
    let unborn = path.join("unborn");
    run_mutation(
        path,
        &["init", "-b", "new", unborn.to_str().unwrap()],
        "create unborn repository",
    )
    .unwrap();
    let review = review_worktree_registrations(&unborn).unwrap();
    assert_eq!(review.registrations.len(), 1);
    assert_eq!(review.registrations[0].oid, Some("0".repeat(40)));
    assert_eq!(review.registrations[0].branch.as_deref(), Some("new"));
    let bare = path.join("bare.git");
    run_mutation(
        path,
        &["init", "--bare", bare.to_str().unwrap()],
        "create bare repository",
    )
    .unwrap();
    let expected = run_git(
        &bare,
        &["worktree", "list", "--porcelain", "-z", "--expire=now"],
    )
    .unwrap();
    match review_worktree_registrations(&bare) {
        Ok(review) => {
            assert!(expected.status.success());
            assert_eq!(review.registrations.len(), 1);
            assert!(review.registrations[0].bare);
            assert_eq!(review.registrations[0].oid, None);
        }
        Err(error) => {
            assert!(!expected.status.success());
            assert_eq!(error.kind, "gitFailure");
        }
    }
}

#[test]
fn worktree_registration_prune_protects_head_and_metadata_and_removes_only_the_selected_registration()
 {
    let repository = Repository::new();
    let path = &repository.0;
    create_worktree(path, path, "kept missing", "kept", "HEAD").unwrap();
    create_worktree(path, path, "locked tree", "locked", "HEAD").unwrap();
    run_mutation(
        path,
        &["worktree", "add", "--detach", "gone tree", "HEAD"],
        "create detached worktree",
    )
    .unwrap();
    let gone = path.join("gone tree");
    run_mutation(
        &gone,
        &["commit", "--allow-empty", "-m", "only here"],
        "commit inside worktree",
    )
    .unwrap();
    let only_here = String::from_utf8(run_git(&gone, &["rev-parse", "HEAD"]).unwrap().stdout)
        .unwrap()
        .trim()
        .to_owned();
    fs::write(gone.join("file"), b"staged\n").unwrap();
    stage_path(&gone, "file").unwrap();
    set_worktree_locked(path, path.join("locked tree").to_str().unwrap(), true).unwrap();
    fs::rename(path.join("locked tree"), path.join("moved locked")).unwrap();
    fs::rename(path.join("kept missing"), path.join("moved kept")).unwrap();
    let admin = path.join(".git/worktrees/gone-tree");
    let index = fs::read(admin.join("index")).unwrap();
    let reflog = fs::read(admin.join("logs/HEAD")).unwrap();
    fs::remove_dir_all(&gone).unwrap();
    let refs = run_git(path, &["for-each-ref", "refs/heads", "refs/tags"])
        .unwrap()
        .stdout;
    let before = review_worktree_registrations(path).unwrap();
    let request = WorktreeRegistrationPrune {
        path: gone.to_str().unwrap().into(),
        expected_oid: only_here.clone(),
        expected_branch: None,
    };
    let result = prune_worktree_registration(path, &request).unwrap();
    assert!(!admin.exists());
    let after = review_worktree_registrations(path).unwrap();
    assert_eq!(after.registrations.len(), before.registrations.len() - 1);
    assert!(
        after
            .registrations
            .iter()
            .all(|entry| entry.path != request.path)
    );
    assert!(
        after
            .registrations
            .iter()
            .any(|entry| entry.branch.as_deref() == Some("kept") && entry.prunable)
    );
    assert!(
        after
            .registrations
            .iter()
            .any(|entry| entry.branch.as_deref() == Some("locked") && entry.locked)
    );
    assert_eq!(
        run_git(path, &["for-each-ref", "refs/heads", "refs/tags"])
            .unwrap()
            .stdout,
        refs
    );
    assert_eq!(result.recovery_references.len(), 1);
    let protected = run_git(path, &["rev-parse", &result.recovery_references[0]])
        .unwrap()
        .stdout;
    assert_eq!(String::from_utf8(protected).unwrap().trim(), only_here);
    let backup = Path::new(&result.metadata_backup);
    assert_eq!(fs::read(backup.join("metadata/index")).unwrap(), index);
    assert_eq!(fs::read(backup.join("metadata/logs/HEAD")).unwrap(), reflog);
    let record: serde_json::Value =
        serde_json::from_slice(&fs::read(backup.join("registration.json")).unwrap()).unwrap();
    assert_eq!(record["worktreePath"], request.path.as_str());
    assert_eq!(record["head"], only_here.as_str());
    assert!(path.join(".git/worktrees/kept-missing").exists());
    assert!(path.join("moved kept").exists() && path.join("moved locked").exists());
}

#[test]
fn worktree_registration_prune_refuses_main_existing_locked_stale_and_unknown_registrations() {
    let repository = Repository::new();
    let path = &repository.0;
    create_worktree(path, path, "present", "present", "HEAD").unwrap();
    create_worktree(path, path, "locked tree", "locked", "HEAD").unwrap();
    create_worktree(path, path, "gone", "gone", "HEAD").unwrap();
    set_worktree_locked(path, path.join("locked tree").to_str().unwrap(), true).unwrap();
    fs::rename(path.join("locked tree"), path.join("moved locked")).unwrap();
    fs::rename(path.join("gone"), path.join("moved gone")).unwrap();
    let oid = repository.oid();
    let request = |folder: &Path, branch: &str, oid: &str| WorktreeRegistrationPrune {
        path: folder.to_str().unwrap().into(),
        expected_oid: oid.into(),
        expected_branch: Some(branch.into()),
    };
    let main = review_worktree_registrations(path).unwrap().registrations[0].clone();
    let before = review_worktree_registrations(path).unwrap();
    let refs = run_git(path, &["show-ref"]).unwrap().stdout;
    for (target, kind) in [
        (
            WorktreeRegistrationPrune {
                path: main.path.clone(),
                expected_oid: oid.clone(),
                expected_branch: main.branch.clone(),
            },
            "mainWorktree",
        ),
        (
            request(&path.join("present"), "present", &oid),
            "worktreeNotPrunable",
        ),
        (
            request(&path.join("locked tree"), "locked", &oid),
            "lockedWorktree",
        ),
        (
            request(&path.join("gone"), "gone", &"b".repeat(40)),
            "staleWorktree",
        ),
        (request(&path.join("gone"), "other", &oid), "staleWorktree"),
        (
            request(&path.join("unknown"), "gone", &oid),
            "staleWorktree",
        ),
        (
            request(Path::new("relative"), "gone", &oid),
            "invalidWorktree",
        ),
    ] {
        let error = prune_worktree_registration(path, &target).err().unwrap();
        assert_eq!(error.kind, kind, "{}", target.path);
    }
    assert_eq!(review_worktree_registrations(path).unwrap(), before);
    assert_eq!(run_git(path, &["show-ref"]).unwrap().stdout, refs);
    assert!(
        !path
            .join(".git/git-khronos-worktree-registrations")
            .exists()
    );
    // A directory that reappears is never removed, even after Git reported it missing.
    fs::create_dir(path.join("gone")).unwrap();
    let error = prune_worktree_registration(path, &request(&path.join("gone"), "gone", &oid))
        .err()
        .unwrap();
    assert!(matches!(
        error.kind.as_str(),
        "worktreeNotPrunable" | "worktreeSourceStillExists"
    ));
    assert!(path.join(".git/worktrees/gone").exists());
}

fn add_fixture_submodule(parent: &Path, url: &Path, target: &str) {
    run_mutation(
        parent,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            url.to_str().unwrap(),
            target,
        ],
        "add fixture submodule",
    )
    .unwrap();
}

fn rev(path: &Path, revision: &str) -> String {
    String::from_utf8_lossy(&run_git(path, &["rev-parse", revision]).unwrap().stdout)
        .trim()
        .to_owned()
}

#[test]
fn submodule_review_reports_dirty_moved_staged_undeclared_missing_and_url_state_without_changes() {
    let repository = Repository::new();
    let module = Repository::new();
    let first = module.oid();
    fs::write(module.0.join("file"), b"second\n").unwrap();
    stage_all(&module.0).unwrap();
    commit(&module.0, "Second").unwrap();
    let second = module.oid();
    for target in [
        "clean",
        "moved",
        "dirty",
        "untracked",
        "staged",
        "elsewhere",
    ] {
        add_fixture_submodule(&repository.0, &module.0, target);
    }
    commit(&repository.0, "Add submodules").unwrap();
    let root = &repository.0;
    run_mutation(&root.join("moved"), &["checkout", "-q", &first], "move").unwrap();
    fs::write(root.join("dirty/file"), b"edited\n").unwrap();
    fs::write(root.join("untracked/new"), b"new\n").unwrap();
    run_mutation(&root.join("staged"), &["checkout", "-q", &first], "move").unwrap();
    run_mutation(root, &["add", "staged"], "stage gitlink").unwrap();
    run_mutation(
        root,
        &["config", "submodule.elsewhere.url", "/elsewhere"],
        "url",
    )
    .unwrap();
    run_mutation(
        root,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("160000,{second},raw link"),
        ],
        "undeclared gitlink",
    )
    .unwrap();
    for (key, value) in [
        ("submodule.ghost.path", "ghost"),
        ("submodule.ghost.url", "/ghost"),
    ] {
        run_mutation(
            root,
            &["config", "--file", ".gitmodules", key, value],
            "declare",
        )
        .unwrap();
    }
    let snapshot = |path: &Path| {
        (
            fs::read(path.join(".git/index")).unwrap(),
            fs::read(path.join(".git/config")).unwrap(),
            fs::read(path.join(".gitmodules")).unwrap(),
            rev(path, "HEAD"),
        )
    };
    let before = snapshot(root);
    let review = review_submodule_state(root).unwrap();
    assert_eq!(snapshot(root), before);
    assert!(review.gitmodules_present);
    let entry = |target: &str| {
        review
            .entries
            .iter()
            .find(|entry| entry.path == target)
            .unwrap_or_else(|| panic!("{target} missing"))
    };
    assert_eq!(review.entries.len(), 8);
    let clean = entry("clean");
    assert_eq!(clean.name.as_deref(), Some("clean"));
    assert!(clean.checked_out && clean.url_matches == Some(true));
    assert_eq!(clean.head_oid.as_deref(), Some(second.as_str()));
    assert_eq!(clean.index_oid, clean.head_oid);
    assert_eq!(clean.checkout_oid, clean.head_oid);
    assert!(!clean.commit_changed && !clean.tracked_changes && !clean.untracked_changes);
    assert!(!clean.staged_change && !clean.undeclared && !clean.missing_gitlink);
    let moved = entry("moved");
    assert!(moved.commit_changed && !moved.staged_change);
    assert_eq!(moved.checkout_oid.as_deref(), Some(first.as_str()));
    assert!(entry("dirty").tracked_changes && !entry("dirty").commit_changed);
    assert!(entry("untracked").untracked_changes && !entry("untracked").tracked_changes);
    let staged = entry("staged");
    assert!(staged.staged_change && !staged.commit_changed);
    assert_eq!(staged.head_oid.as_deref(), Some(second.as_str()));
    assert_eq!(staged.index_oid.as_deref(), Some(first.as_str()));
    let elsewhere = entry("elsewhere");
    assert_eq!(elsewhere.url_matches, Some(false));
    assert_eq!(elsewhere.registered_url.as_deref(), Some("/elsewhere"));
    let raw = entry("raw link");
    assert!(raw.undeclared && raw.staged_change && !raw.checked_out);
    assert_eq!(raw.head_oid, None);
    let ghost = entry("ghost");
    assert!(ghost.missing_gitlink && !ghost.checked_out);
    assert_eq!(ghost.registered_url, None);
    assert_eq!(fs::read(root.join("dirty/file")).unwrap(), b"edited\n");
    assert!(root.join("untracked/new").exists());
    let value = serde_json::to_value(moved).unwrap();
    assert_eq!(value["commitChanged"], true);
    assert_eq!(value["checkoutOid"], first);
}

#[test]
fn submodule_review_reports_divergent_gitlink_conflict_sides_and_refuses_bare_repositories() {
    let repository = Repository::new();
    let module = Repository::new();
    let base = module.oid();
    let mut tips = Vec::new();
    for side in ["x", "y"] {
        run_mutation(&module.0, &["checkout", "-q", "-B", side, &base], "branch").unwrap();
        fs::write(module.0.join("file"), side).unwrap();
        stage_all(&module.0).unwrap();
        commit(&module.0, side).unwrap();
        tips.push(module.oid());
    }
    add_fixture_submodule(&repository.0, &module.0, "lib");
    let root = &repository.0;
    let lib = root.join("lib");
    run_mutation(&lib, &["checkout", "-q", &base], "base").unwrap();
    stage_all(root).unwrap();
    commit(root, "Add lib").unwrap();
    run_mutation(root, &["branch", "topic"], "branch").unwrap();
    run_mutation(&lib, &["checkout", "-q", &tips[0]], "x").unwrap();
    stage_all(root).unwrap();
    commit(root, "Lib x").unwrap();
    run_mutation(root, &["checkout", "-q", "topic"], "topic").unwrap();
    run_mutation(&lib, &["checkout", "-q", &tips[1]], "y").unwrap();
    stage_all(root).unwrap();
    commit(root, "Lib y").unwrap();
    run_mutation(root, &["checkout", "-q", "main"], "main").unwrap();
    run_mutation(&lib, &["checkout", "-q", &tips[0]], "x").unwrap();
    let merge = run_git(root, &["merge", "--no-edit", "topic"]).unwrap();
    assert!(!merge.status.success());
    let before = fs::read(root.join(".git/index")).unwrap();
    let review = review_submodule_state(root).unwrap();
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), before);
    assert!(root.join(".git/MERGE_HEAD").exists());
    let entry = &review.entries[0];
    assert_eq!(review.entries.len(), 1);
    let conflict = entry.conflict.as_ref().unwrap();
    assert_eq!(conflict.base.as_deref(), Some(base.as_str()));
    assert_eq!(conflict.ours.as_deref(), Some(tips[0].as_str()));
    assert_eq!(conflict.theirs.as_deref(), Some(tips[1].as_str()));
    assert!(!conflict.mixed_types && !entry.staged_change);
    assert_eq!(entry.index_oid, None);
    let bare = root.join("bare.git");
    run_mutation(
        root,
        &["clone", "-q", "--bare", ".", bare.to_str().unwrap()],
        "bare",
    )
    .unwrap();
    assert!(review_submodule_state(&bare).is_err());
}

fn config_value(path: &Path, key: &str) -> Option<String> {
    let output = run_git(path, &["config", "--local", "--get", key]).unwrap();
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_owned()
    })
}

fn url_sync(path: &str, declared: &str, registered: &str) -> SubmoduleUrlSync {
    SubmoduleUrlSync {
        path: path.into(),
        expected_declared_url: declared.into(),
        expected_registered_url: registered.into(),
    }
}

#[test]
fn submodule_url_sync_updates_only_the_reviewed_local_and_default_remote_urls() {
    let repository = Repository::new();
    let module = Repository::new();
    let mirror = Repository::new();
    let root = &repository.0;
    let source = module.0.to_str().unwrap().to_owned();
    let target = mirror.0.to_str().unwrap().to_owned();
    for path in ["lib", "other"] {
        add_fixture_submodule(root, &module.0, path);
    }
    commit(root, "Add submodules").unwrap();
    for path in ["lib", "other"] {
        let key = format!("submodule.{path}.url");
        run_mutation(
            root,
            &["config", "--file", ".gitmodules", &key, &target],
            "declare",
        )
        .unwrap();
    }
    run_mutation(
        &root.join("lib"),
        &["config", "remote.origin.pushurl", "/push"],
        "push",
    )
    .unwrap();
    let parent_before = |path: &Path| {
        (
            fs::read(path.join(".git/index")).unwrap(),
            fs::read(path.join(".gitmodules")).unwrap(),
            rev(path, "HEAD"),
        )
    };
    let stable = parent_before(root);

    let stale = sync_submodule_url(root, &url_sync("lib", &target, "/stale")).unwrap_err();
    assert_eq!(stale.kind, "submoduleUrlSyncRefused");
    let changed = sync_submodule_url(root, &url_sync("lib", "/stale", &source)).unwrap_err();
    assert_eq!(changed.kind, "submoduleUrlSyncRefused");
    assert_eq!(
        config_value(root, "submodule.lib.url").as_deref(),
        Some(source.as_str())
    );

    let result = sync_submodule_url(root, &url_sync("lib", &target, &source)).unwrap();
    assert_eq!(result.name, "lib");
    assert_eq!(result.previous_registered_url, source);
    assert_eq!(result.registered_url, target);
    assert_eq!(result.remote_name.as_deref(), Some("origin"));
    assert_eq!(result.previous_remote_url.as_deref(), Some(source.as_str()));
    assert_eq!(result.remote_url.as_deref(), Some(target.as_str()));
    assert_eq!(
        config_value(root, "submodule.lib.url").as_deref(),
        Some(target.as_str())
    );
    assert_eq!(
        config_value(&root.join("lib"), "remote.origin.url").as_deref(),
        Some(target.as_str())
    );
    assert_eq!(
        config_value(&root.join("lib"), "remote.origin.pushurl").as_deref(),
        Some("/push")
    );
    assert_eq!(
        config_value(root, "submodule.other.url").as_deref(),
        Some(source.as_str())
    );
    assert_eq!(
        config_value(&root.join("other"), "remote.origin.url").as_deref(),
        Some(source.as_str())
    );
    assert_eq!(parent_before(root), stable);
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["previousRegisteredUrl"], source);

    let again = sync_submodule_url(root, &url_sync("lib", &target, &target)).unwrap_err();
    assert!(again.message.contains("already matches"));
}

#[test]
fn submodule_url_sync_follows_renamed_remotes_relative_urls_and_refuses_uninitialized_entries() {
    let workspace = Repository::new();
    let base = workspace.0.as_path();
    for name in ["lib", "parent"] {
        run_mutation(base, &["init", "-q", "-b", "main", name], "init").unwrap();
        run_mutation(
            &base.join(name),
            &["commit", "-q", "--allow-empty", "-m", name],
            "commit",
        )
        .unwrap();
    }
    let root = base.join("parent");
    let lib = base.join("lib");
    add_fixture_submodule(&root, &lib, "lib");
    add_fixture_submodule(&root, &lib, "dormant");
    commit(&root, "Add").unwrap();
    run_mutation(&root, &["submodule", "deinit", "-q", "dormant"], "deinit").unwrap();
    let module = root.join("lib");
    run_mutation(&module, &["remote", "rename", "origin", "up"], "rename").unwrap();
    run_mutation(&module, &["checkout", "-q", "-b", "work"], "branch").unwrap();
    run_mutation(
        &root,
        &[
            "config",
            "--file",
            ".gitmodules",
            "submodule.lib.url",
            "../lib",
        ],
        "relative",
    )
    .unwrap();
    let previous = config_value(&root, "submodule.lib.url").unwrap();
    run_mutation(&root, &["config", "submodule.lib.url", "/old"], "drift").unwrap();
    run_mutation(
        &module,
        &["config", "remote.up.url", "/old-remote"],
        "drift",
    )
    .unwrap();
    let result = sync_submodule_url(&root, &url_sync("lib", "../lib", "/old")).unwrap();
    assert_eq!(result.registered_url, previous);
    if result.remote_name.as_deref() == Some("origin") {
        // Git before 2.42 uses "origin" when the branch has no upstream and reports the new remote.
        assert_eq!(result.previous_remote_url, None);
        assert_eq!(
            config_value(&module, "remote.origin.url"),
            Some(previous.clone())
        );
        assert_eq!(
            config_value(&module, "remote.up.url").as_deref(),
            Some("/old-remote")
        );
    } else {
        assert_eq!(result.remote_name.as_deref(), Some("up"));
        assert_eq!(result.previous_remote_url.as_deref(), Some("/old-remote"));
        assert_eq!(
            config_value(&module, "remote.up.url"),
            Some(previous.clone())
        );
    }
    let dormant_url = run_git(
        &root,
        &["config", "--file", ".gitmodules", "submodule.dormant.url"],
    )
    .unwrap();
    let declared = String::from_utf8_lossy(&dormant_url.stdout)
        .trim()
        .to_owned();
    let error = sync_submodule_url(&root, &url_sync("dormant", &declared, &declared)).unwrap_err();
    assert!(error.message.contains("not initialized"));
    assert_eq!(config_value(&root, "submodule.dormant.url"), None);
}

fn recorded_checkout(path: &str, index: &str, checkout: &str) -> SubmoduleRecordedCheckout {
    SubmoduleRecordedCheckout {
        path: path.into(),
        expected_index_oid: index.into(),
        expected_checkout_oid: checkout.into(),
        recursive: false,
    }
}

fn recovery_refs(path: &Path) -> String {
    String::from_utf8_lossy(
        &run_git(
            path,
            &[
                "for-each-ref",
                "--format=%(refname) %(objectname)",
                "refs/git-khronos/recovery/",
            ],
        )
        .unwrap()
        .stdout,
    )
    .into_owned()
}

#[test]
fn recorded_submodule_checkout_protects_the_previous_commit_and_keeps_branches_and_parent_state() {
    let repository = Repository::new();
    let module = Repository::new();
    let recorded = module.oid();
    let root = &repository.0;
    add_fixture_submodule(root, &module.0, "lib");
    commit(root, "Add lib").unwrap();
    let lib = root.join("lib");
    run_mutation(&lib, &["checkout", "-q", "-b", "local-work"], "branch").unwrap();
    fs::write(lib.join("file"), b"local\n").unwrap();
    stage_all(&lib).unwrap();
    commit(&lib, "Local work").unwrap();
    let local = rev(&lib, "HEAD");
    fs::write(lib.join("notes.txt"), b"untracked\n").unwrap();
    run_mutation(
        root,
        &["config", "submodule.lib.update", "none"],
        "update mode",
    )
    .unwrap();
    let parent = |path: &Path| {
        (
            String::from_utf8_lossy(&run_git(path, &["ls-files", "-s"]).unwrap().stdout)
                .into_owned(),
            rev(path, "HEAD"),
            fs::read(path.join(".gitmodules")).unwrap(),
        )
    };
    let before = parent(root);
    let result =
        checkout_recorded_submodule_commit(root, &recorded_checkout("lib", &recorded, &local))
            .unwrap();
    assert_eq!(rev(&lib, "HEAD"), recorded);
    assert!(
        !run_git(&lib, &["symbolic-ref", "-q", "HEAD"])
            .unwrap()
            .status
            .success()
    );
    assert_eq!(rev(&lib, "refs/heads/local-work"), local);
    assert_eq!(result.previous_oid, local);
    assert_eq!(
        result.previous_branch.as_deref(),
        Some("refs/heads/local-work")
    );
    assert_eq!(
        rev(&lib, result.recovery_reference.as_deref().unwrap()),
        local
    );
    assert!(result.nested.is_empty());
    assert_eq!(fs::read(lib.join("notes.txt")).unwrap(), b"untracked\n");
    assert_eq!(parent(root), before);
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["recordedOid"], recorded);
    let again =
        checkout_recorded_submodule_commit(root, &recorded_checkout("lib", &recorded, &recorded))
            .unwrap_err();
    assert!(again.message.contains("already checked out"));
}

#[test]
fn recorded_submodule_checkout_refuses_dirty_stale_and_unavailable_commits_without_changes() {
    let repository = Repository::new();
    let module = Repository::new();
    let first = module.oid();
    fs::write(module.0.join("file"), b"second\n").unwrap();
    stage_all(&module.0).unwrap();
    commit(&module.0, "Second").unwrap();
    let second = module.oid();
    let root = &repository.0;
    add_fixture_submodule(root, &module.0, "lib");
    commit(root, "Add lib").unwrap();
    let lib = root.join("lib");
    run_mutation(&lib, &["checkout", "-q", &first], "move").unwrap();
    fs::write(lib.join("file"), b"dirty\n").unwrap();
    let dirty =
        checkout_recorded_submodule_commit(root, &recorded_checkout("lib", &second, &first))
            .unwrap_err();
    assert_eq!(dirty.kind, "submoduleCheckoutRefused");
    assert!(dirty.message.contains("uncommitted changes"));
    assert_eq!(fs::read(lib.join("file")).unwrap(), b"dirty\n");
    run_mutation(&lib, &["checkout", "-q", "--", "file"], "clean").unwrap();
    let stale =
        checkout_recorded_submodule_commit(root, &recorded_checkout("lib", &second, &second))
            .unwrap_err();
    assert!(stale.message.contains("changed after the review"));
    let foreign = repository.oid();
    run_mutation(
        root,
        &[
            "update-index",
            "--cacheinfo",
            &format!("160000,{foreign},lib"),
        ],
        "record",
    )
    .unwrap();
    let missing =
        checkout_recorded_submodule_commit(root, &recorded_checkout("lib", &foreign, &first))
            .unwrap_err();
    assert!(missing.message.contains("never fetches"));
    assert_eq!(rev(&lib, "HEAD"), first);
    assert!(recovery_refs(&lib).is_empty());
}

#[test]
fn recursive_recorded_checkout_protects_each_nested_level_and_refuses_nested_edits() {
    let inner = Repository::new();
    let first_inner = inner.oid();
    let middle = Repository::new();
    add_fixture_submodule(&middle.0, &inner.0, "inner");
    commit(&middle.0, "Add inner").unwrap();
    let first_middle = middle.oid();
    fs::write(inner.0.join("file"), b"inner two\n").unwrap();
    stage_all(&inner.0).unwrap();
    commit(&inner.0, "Inner two").unwrap();
    let second_inner = inner.oid();
    let middle_inner = middle.0.join("inner");
    run_mutation(
        &middle_inner,
        &[
            "-c",
            "protocol.file.allow=always",
            "pull",
            "-q",
            "origin",
            "HEAD",
        ],
        "pull",
    )
    .unwrap();
    stage_all(&middle.0).unwrap();
    commit(&middle.0, "Bump inner").unwrap();
    let second_middle = middle.oid();
    let repository = Repository::new();
    let root = &repository.0;
    add_fixture_submodule(root, &middle.0, "lib");
    run_mutation(
        root,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "update",
            "-q",
            "--init",
            "--recursive",
        ],
        "init",
    )
    .unwrap();
    commit(root, "Add lib").unwrap();
    let lib = root.join("lib");
    let nested = lib.join("inner");
    assert_eq!(rev(&nested, "HEAD"), second_inner);

    run_mutation(&lib, &["checkout", "-q", &first_middle], "move lib").unwrap();
    run_mutation(&nested, &["checkout", "-q", &first_inner], "move inner").unwrap();
    let mut request = recorded_checkout("lib", &second_middle, &first_middle);
    request.recursive = true;
    let result = checkout_recorded_submodule_commit(root, &request).unwrap();
    assert_eq!(rev(&lib, "HEAD"), second_middle);
    assert_eq!(rev(&nested, "HEAD"), second_inner);
    assert_eq!(result.nested.len(), 1);
    assert_eq!(result.nested[0].path, "lib/inner");
    assert_eq!(
        rev(
            &nested,
            result.nested[0].recovery_reference.as_deref().unwrap()
        ),
        first_inner
    );

    run_mutation(&nested, &["checkout", "-q", &first_inner], "drift inner").unwrap();
    let single = checkout_recorded_submodule_commit(
        root,
        &recorded_checkout("lib", &second_middle, &second_middle),
    )
    .unwrap_err();
    assert!(single.message.contains("already checked out"));
    let drift = checkout_recorded_submodule_commit(root, &request_for(&second_middle)).unwrap();
    assert!(drift.recovery_reference.is_none());
    assert_eq!(rev(&nested, "HEAD"), second_inner);

    fs::write(nested.join("file"), b"edited\n").unwrap();
    run_mutation(&nested, &["checkout", "-q", "--detach"], "stay").unwrap();
    let dirty = checkout_recorded_submodule_commit(root, &request_for(&second_middle)).unwrap_err();
    assert!(
        dirty
            .message
            .starts_with("lib/inner has uncommitted changes"),
        "{}",
        dirty.message
    );
    assert_eq!(fs::read(nested.join("file")).unwrap(), b"edited\n");
    run_mutation(&nested, &["checkout", "-q", "--", "file"], "clean").unwrap();
    let nothing =
        checkout_recorded_submodule_commit(root, &request_for(&second_middle)).unwrap_err();
    assert!(nothing.message.contains("already match"));
}

fn request_for(oid: &str) -> SubmoduleRecordedCheckout {
    let mut request = recorded_checkout("lib", oid, oid);
    request.recursive = true;
    request
}

fn deinit(path: &str, checkout: &str) -> SubmoduleDeinit {
    SubmoduleDeinit {
        path: path.into(),
        expected_checkout_oid: checkout.into(),
    }
}

#[test]
fn submodule_deinit_keeps_repository_data_and_removes_only_its_local_settings() {
    let repository = Repository::new();
    let module = Repository::new();
    let recorded = module.oid();
    let root = &repository.0;
    add_fixture_submodule(root, &module.0, "lib");
    add_fixture_submodule(root, &module.0, "other");
    commit(root, "Add submodules").unwrap();
    let lib = root.join("lib");
    run_mutation(
        root,
        &["config", "submodule.lib.update", "rebase"],
        "update",
    )
    .unwrap();
    run_mutation(&lib, &["branch", "keep"], "branch").unwrap();
    fs::write(lib.join("notes.txt"), b"untracked\n").unwrap();
    let untracked = deinit_submodule(root, &deinit("lib", &recorded)).unwrap_err();
    assert_eq!(untracked.kind, "submoduleDeinitRefused");
    assert!(untracked.message.contains("untracked files"));
    fs::remove_file(lib.join("notes.txt")).unwrap();
    let stale = deinit_submodule(root, &deinit("lib", &repository.oid())).unwrap_err();
    assert!(stale.message.contains("changed after the review"));
    run_mutation(
        &lib,
        &["commit", "-q", "--allow-empty", "-m", "local"],
        "ahead",
    )
    .unwrap();
    let ahead = deinit_submodule(root, &deinit("lib", &rev(&lib, "HEAD"))).unwrap_err();
    assert!(ahead.message.contains("not at the commit recorded"));
    run_mutation(&lib, &["checkout", "-q", "--detach", &recorded], "back").unwrap();
    let index_before = run_git(root, &["ls-files", "-s"]).unwrap().stdout;

    let result = deinit_submodule(root, &deinit("lib", &recorded)).unwrap();
    assert!(fs::read_dir(&lib).unwrap().next().is_none());
    assert!(!result.absorbed);
    let keys: Vec<_> = result
        .removed_settings
        .iter()
        .map(|setting| setting.key.as_str())
        .collect();
    assert!(
        keys.contains(&"submodule.lib.url")
            && keys.contains(&"submodule.lib.update")
            && keys.contains(&"submodule.lib.active")
    );
    assert_eq!(config_value(root, "submodule.lib.url"), None);
    assert!(config_value(root, "submodule.other.url").is_some());
    let data = PathBuf::from(&result.git_directory);
    let dir = data.to_string_lossy().into_owned();
    assert!(
        run_git(
            root,
            &[
                "--git-dir",
                &dir,
                "rev-parse",
                "--verify",
                "-q",
                "refs/heads/keep"
            ]
        )
        .unwrap()
        .status
        .success()
    );
    assert_eq!(
        run_git(root, &["ls-files", "-s"]).unwrap().stdout,
        index_before
    );
    assert!(
        run_git(root, &["status", "--porcelain"])
            .unwrap()
            .stdout
            .is_empty()
    );
    let again = deinit_submodule(root, &deinit("lib", &recorded)).unwrap_err();
    assert!(again.message.contains("not checked out"));
}

#[test]
fn submodule_deinit_absorbs_an_embedded_repository_before_clearing_it() {
    let repository = Repository::new();
    let module = Repository::new();
    let recorded = module.oid();
    let root = &repository.0;
    run_mutation(
        root,
        &["clone", "-q", module.0.to_str().unwrap(), "lib"],
        "clone",
    )
    .unwrap();
    fs::write(
        root.join(".gitmodules"),
        format!(
            "[submodule \"lib\"]\n\tpath = lib\n\turl = {}\n",
            module.0.display()
        ),
    )
    .unwrap();
    run_mutation(root, &["add", ".gitmodules", "lib"], "stage").unwrap();
    commit(root, "Embedded").unwrap();
    run_mutation(root, &["submodule", "init", "-q"], "init").unwrap();
    let result = deinit_submodule(root, &deinit("lib", &recorded)).unwrap();
    assert!(result.absorbed);
    assert!(!root.join("lib/.git").exists());
    let dir = result.git_directory.clone();
    assert!(dir.ends_with("modules/lib"), "{dir}");
    assert_eq!(rev_in(root, &dir), recorded);
}

fn rev_in(root: &Path, git_dir: &str) -> String {
    String::from_utf8_lossy(
        &run_git(root, &["--git-dir", git_dir, "rev-parse", "HEAD"])
            .unwrap()
            .stdout,
    )
    .trim()
    .to_owned()
}

fn removal(path: &str, oid: &str) -> SubmoduleRemoval {
    SubmoduleRemoval {
        path: path.into(),
        expected_index_oid: oid.into(),
    }
}

#[test]
fn submodule_removal_stages_only_its_gitlink_and_declaration_and_keeps_data() {
    let repository = Repository::new();
    let module = Repository::new();
    let recorded = module.oid();
    let root = &repository.0;
    add_fixture_submodule(root, &module.0, "lib");
    add_fixture_submodule(root, &module.0, "other");
    commit(root, "Add submodules").unwrap();
    let lib = root.join("lib");
    run_mutation(&lib, &["branch", "keep"], "branch").unwrap();
    fs::write(lib.join("notes.txt"), b"untracked\n").unwrap();
    let untracked = remove_submodule(root, &removal("lib", &recorded)).unwrap_err();
    assert_eq!(untracked.kind, "submoduleRemovalRefused");
    fs::remove_file(lib.join("notes.txt")).unwrap();
    fs::write(
        root.join(".gitmodules"),
        [
            fs::read(root.join(".gitmodules")).unwrap(),
            b"# note\n".to_vec(),
        ]
        .concat(),
    )
    .unwrap();
    let declaration = remove_submodule(root, &removal("lib", &recorded)).unwrap_err();
    assert!(
        declaration
            .message
            .contains(".gitmodules has unstaged changes")
    );
    run_mutation(root, &["checkout", "-q", "--", ".gitmodules"], "restore").unwrap();
    let stale = remove_submodule(root, &removal("lib", &repository.oid())).unwrap_err();
    assert!(stale.message.contains("changed after the review"));
    fs::write(root.join("staged.txt"), b"staged\n").unwrap();
    run_mutation(root, &["add", "staged.txt"], "stage").unwrap();

    let result = remove_submodule(root, &removal("lib", &recorded)).unwrap();
    assert!(!lib.exists());
    let status =
        String::from_utf8_lossy(&run_git(root, &["status", "--porcelain"]).unwrap().stdout)
            .into_owned();
    assert_eq!(status, "M  .gitmodules\nD  lib\nA  staged.txt\n");
    let declared =
        String::from_utf8_lossy(&fs::read(root.join(".gitmodules")).unwrap()).into_owned();
    assert!(!declared.contains("\"lib\"") && declared.contains("\"other\""));
    assert_eq!(
        config_value(root, "submodule.lib.url").as_deref(),
        Some(module.0.to_str().unwrap())
    );
    assert!(
        result
            .kept_settings
            .iter()
            .any(|setting| setting.key == "submodule.lib.url")
    );
    let dir = result.git_directory.clone().unwrap();
    assert!(
        run_git(
            root,
            &[
                "--git-dir",
                &dir,
                "--work-tree",
                ".",
                "rev-parse",
                "--verify",
                "-q",
                "refs/heads/keep"
            ]
        )
        .unwrap()
        .status
        .success()
    );
    assert_eq!(result.recorded_oid, recorded);
    assert!(remove_submodule(root, &removal("lib", &recorded)).is_err());
}

#[test]
fn submodule_removal_handles_uninitialized_entries_and_refuses_moved_checkouts() {
    let repository = Repository::new();
    let module = Repository::new();
    let recorded = module.oid();
    let root = &repository.0;
    add_fixture_submodule(root, &module.0, "lib");
    add_fixture_submodule(root, &module.0, "idle");
    commit(root, "Add submodules").unwrap();
    let lib = root.join("lib");
    run_mutation(
        &lib,
        &["commit", "-q", "--allow-empty", "-m", "ahead"],
        "ahead",
    )
    .unwrap();
    let moved = remove_submodule(root, &removal("lib", &recorded)).unwrap_err();
    assert!(moved.message.contains("another commit"));
    assert!(lib.join(".git").exists());
    let deinit_result = deinit_submodule(root, &deinit("idle", &recorded)).unwrap();
    let result = remove_submodule(root, &removal("idle", &recorded)).unwrap();
    assert_eq!(
        result.git_directory.as_deref(),
        Some(deinit_result.git_directory.as_str())
    );
    assert!(result.kept_settings.is_empty());
    assert!(!root.join("idle").exists());
}

#[test]
fn clone_limits_history_depth_and_selected_branch() {
    let source = Repository::new();
    for message in ["second", "third"] {
        run_mutation(
            &source.0,
            &["commit", "-q", "--allow-empty", "-m", message],
            message,
        )
        .unwrap();
    }
    run_mutation(&source.0, &["branch", "side"], "branch").unwrap();
    let parent = source.0.with_extension("clones");
    fs::create_dir(&parent).unwrap();
    let url = format!("file://{}", source.0.display());
    let shallow = clone_repository(&url, &parent, "shallow", Some("side"), Some(2)).unwrap();
    let text = |args: &[&str]| {
        String::from_utf8_lossy(&run_git(&shallow, args).unwrap().stdout)
            .trim()
            .to_owned()
    };
    assert_eq!(text(&["rev-parse", "--is-shallow-repository"]), "true");
    assert_eq!(text(&["rev-list", "--count", "HEAD"]), "2");
    assert_eq!(text(&["branch", "--show-current"]), "side");
    assert_eq!(
        text(&["for-each-ref", "--format=%(refname)", "refs/remotes"]),
        "refs/remotes/origin/side"
    );
    let full = clone_repository(&url, &parent, "full", None, None).unwrap();
    let count = run_git(&full, &["rev-list", "--count", "HEAD"])
        .unwrap()
        .stdout;
    assert_eq!(String::from_utf8_lossy(&count).trim(), "3");
    let zero = clone_repository(&url, &parent, "zero", None, Some(0)).unwrap_err();
    assert_eq!(zero.kind, "invalidCloneDepth");
    assert!(!parent.join("zero").exists());
    let existing = clone_repository(&url, &parent, "full", None, None).unwrap_err();
    assert_eq!(existing.kind, "destinationExists");
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn cancelled_clone_discloses_partial_destination() {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/stalled.git", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let connection = listener.accept();
        std::thread::sleep(std::time::Duration::from_secs(3));
        drop(connection);
    });
    let parent = Repository::new().0.with_extension("cancelled");
    fs::create_dir(&parent).unwrap();
    let cancellation = CancellationToken::default();
    let canceller = cancellation.clone();
    let timer = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        canceller.cancel();
    });
    let error = authentication::with_authentication(
        &std::env::current_exe().unwrap(),
        &cancellation,
        None,
        || clone_repository(&url, &parent, "partial", None, None),
    )
    .unwrap_err();
    timer.join().unwrap();
    assert_eq!(error.kind, "operationCancelled");
    let partial = parent.join("partial");
    assert!(partial.exists());
    let hint = error.hint.unwrap();
    assert!(hint.contains("Partial clone data remains"));
    assert!(hint.contains(&partial.display().to_string()));
    let retry = clone_repository(&url, &parent, "partial", None, None).unwrap_err();
    assert_eq!(retry.kind, "destinationExists");
    server.join().unwrap();
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn fetch_deepens_and_completes_shallow_history_from_one_remote() {
    let source = Repository::new();
    for message in ["c2", "c3", "c4", "c5", "c6"] {
        run_mutation(
            &source.0,
            &["commit", "-q", "--allow-empty", "-m", message],
            message,
        )
        .unwrap();
    }
    let parent = source.0.with_extension("deepen");
    fs::create_dir(&parent).unwrap();
    let url = format!("file://{}", source.0.display());
    let clone = clone_repository(&url, &parent, "work", None, Some(1)).unwrap();
    run_mutation(&clone, &["remote", "add", "mirror", &url], "mirror").unwrap();
    let count = |rev: &str| {
        let out = run_git(&clone, &["rev-list", "--count", rev])
            .unwrap()
            .stdout;
        String::from_utf8_lossy(&out)
            .trim()
            .parse::<usize>()
            .unwrap()
    };
    let token = CancellationToken::default();
    let options = |remote: Option<&str>, history| FetchOptions {
        remote: remote.map(str::to_owned),
        prune: false,
        history: Some(history),
    };
    assert_eq!(shallow_history_state(&clone).unwrap().boundary_commits, 1);
    let head = run_git(&clone, &["rev-parse", "HEAD"]).unwrap().stdout;
    let all = fetch_with_options(
        &clone,
        &options(None, FetchHistory::Deepen { commits: 2 }),
        &token,
    )
    .unwrap_err();
    assert_eq!(all.kind, "historyDepthRefused");
    let zero = fetch_with_options(
        &clone,
        &options(Some("origin"), FetchHistory::Deepen { commits: 0 }),
        &token,
    )
    .unwrap_err();
    assert_eq!(zero.kind, "historyDepthRefused");
    assert_eq!(count("HEAD"), 1);
    fetch_with_options(
        &clone,
        &options(Some("origin"), FetchHistory::Deepen { commits: 2 }),
        &token,
    )
    .unwrap();
    assert_eq!(count("HEAD"), 3);
    assert!(shallow_history_state(&clone).unwrap().shallow);
    assert_eq!(
        run_git(&clone, &["rev-parse", "HEAD"]).unwrap().stdout,
        head
    );
    fetch_with_options(
        &clone,
        &options(Some("mirror"), FetchHistory::Complete),
        &token,
    )
    .unwrap();
    assert_eq!(count("HEAD"), 6);
    assert_eq!(count("refs/remotes/mirror/main"), 6);
    let state = shallow_history_state(&clone).unwrap();
    assert!(!state.shallow);
    assert_eq!(state.boundary_commits, 0);
    let complete = fetch_with_options(
        &clone,
        &options(Some("origin"), FetchHistory::Complete),
        &token,
    )
    .unwrap_err();
    assert_eq!(complete.kind, "historyDepthRefused");
    assert!(complete.message.contains("already has complete history"));
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn unborn_and_detached_heads_open_commit_and_attach_without_fabricating_branches() {
    let base = Repository::new().0.with_extension("heads");
    fs::create_dir(&base).unwrap();
    let unborn = base.join("unborn");
    fs::create_dir(&unborn).unwrap();
    run_mutation(&unborn, &["init", "-q", "-b", "trunk"], "init").unwrap();
    for args in [
        ["config", "user.name", "Test"],
        ["config", "user.email", "test@example.test"],
    ] {
        run_mutation(&unborn, &args, "identity").unwrap();
    }
    fs::write(unborn.join("first.txt"), "first\n").unwrap();
    assert_eq!(
        resolve_repository(&unborn).unwrap(),
        unborn.canonicalize().unwrap()
    );
    let empty = snapshot(&unborn).unwrap();
    assert_eq!(empty.status.branch.as_deref(), Some("trunk"));
    assert!(empty.commits.is_empty());
    assert_eq!(empty.status.untracked, 1);
    let refs = run_git(&unborn, &["for-each-ref"]).unwrap().stdout;
    assert!(refs.is_empty());
    create_branch(&unborn, "feature").unwrap();
    assert_eq!(
        snapshot(&unborn).unwrap().status.branch.as_deref(),
        Some("feature")
    );
    stage_all(&unborn).unwrap();
    commit(&unborn, "First").unwrap();
    let first = snapshot(&unborn).unwrap();
    assert_eq!(first.commits.len(), 1);
    assert_eq!(first.status.branch.as_deref(), Some("feature"));

    let repository = Repository::new();
    let original = repository.oid();
    run_mutation(&repository.0, &["checkout", "-q", "--detach"], "detach").unwrap();
    let detached = snapshot(&repository.0).unwrap();
    assert!(detached.status.branch.is_none());
    fs::write(repository.0.join("file"), "detached\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Detached work").unwrap();
    let after = snapshot(&repository.0).unwrap();
    assert!(after.status.branch.is_none());
    assert_ne!(repository.oid(), original);
    let main = run_git(&repository.0, &["rev-parse", "main"])
        .unwrap()
        .stdout;
    assert_eq!(String::from_utf8_lossy(&main).trim(), original);
    let detached_tip = repository.oid();
    create_branch(&repository.0, "rescued").unwrap();
    assert_eq!(
        snapshot(&repository.0).unwrap().status.branch.as_deref(),
        Some("rescued")
    );
    assert_eq!(repository.oid(), detached_tip);
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn opening_repository_data_without_a_working_tree_is_explained_and_unchanged() {
    let repository = Repository::new();
    let base = repository.0.with_extension("shapes");
    fs::create_dir(&base).unwrap();
    let bare = base.join("shared.git");
    run_mutation(
        &base,
        &[
            "clone",
            "-q",
            "--bare",
            &repository.0.display().to_string(),
            &bare.display().to_string(),
        ],
        "bare",
    )
    .unwrap();
    let config = fs::read(bare.join("config")).unwrap();
    assert_eq!(
        resolve_repository(&bare).unwrap(),
        bare.canonicalize().unwrap()
    );
    let error = resolve_repository(&bare.join("refs")).unwrap_err();
    assert_eq!(error.kind, "bareRepositoryUnsupported", "{}", error.message);
    assert!(error.message.contains("bare repository"));
    assert!(error.hint.unwrap().contains("browse it read-only"));
    assert_eq!(fs::read(bare.join("config")).unwrap(), config);
    assert!(!bare.join("index").exists());

    let data = resolve_repository(&repository.0.join(".git")).unwrap_err();
    assert_eq!(data.kind, "repositoryDataFolder");
    assert!(data.hint.unwrap().contains("contains this .git folder"));
    assert_eq!(
        resolve_repository(&repository.0).unwrap(),
        repository.0.canonicalize().unwrap()
    );

    run_mutation(
        &repository.0,
        &["config", "core.repositoryformatversion", "1"],
        "format",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["config", "extensions.chronosUnknownFeature", "true"],
        "ext",
    )
    .unwrap();
    let format = resolve_repository(&repository.0).unwrap_err();
    assert_eq!(format.kind, "unsupportedRepositoryFormat");
    assert!(format.message.contains("chronosunknownfeature"));
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn foreign_owner_refusal_keeps_git_detail_and_explains_trust_choice() {
    use std::os::unix::process::ExitStatusExt;
    let output = std::process::Output {
        status: std::process::ExitStatus::from_raw(128 << 8),
        stdout: Vec::new(),
        stderr: b"fatal: detected dubious ownership in repository at '/srv/project'\n".to_vec(),
    };
    let error = classify_open_failure(Path::new("/srv/project"), &output);
    assert_eq!(error.kind, "untrustedRepositoryOwner");
    assert!(
        error
            .message
            .contains("dubious ownership in repository at '/srv/project'")
    );
    assert!(error.hint.unwrap().contains("safe.directory"));
    let other = std::process::Output {
        stderr: b"fatal: not a git repository (or any of the parent directories): .git\n".to_vec(),
        ..output
    };
    assert_eq!(
        classify_open_failure(Path::new("/tmp"), &other).kind,
        "gitFailure"
    );
}

fn stash_options(mode: &str, include_untracked: bool, paths: Option<Vec<String>>) -> StashOptions {
    StashOptions {
        mode: mode.into(),
        include_untracked,
        paths,
        message: "Checkpoint".into(),
    }
}

fn fetch_fixture() -> Repository {
    let repository = Repository::new();
    for name in ["origin", "backup"] {
        let bare = repository.0.join(format!("{name}.git"));
        run_mutation(
            &repository.0,
            &["init", "--bare", bare.to_str().unwrap()],
            "init bare",
        )
        .unwrap();
        run_mutation(
            &repository.0,
            &["remote", "add", name, bare.to_str().unwrap()],
            "add remote",
        )
        .unwrap();
        run_mutation(&repository.0, &["push", name, "main"], "seed remote").unwrap();
    }
    repository
}

fn fixture_ref(repository: &Repository, reference: &str) -> Option<String> {
    let output = run_git(
        &repository.0,
        &["show-ref", "--verify", "--hash", reference],
    )
    .unwrap();
    output
        .status
        .success()
        .then(|| String::from_utf8(output.stdout).unwrap().trim().into())
}

fn remote_fixture_ref(repository: &Repository, remote: &str, reference: &str, oid: Option<&str>) {
    let bare = repository.0.join(format!("{remote}.git"));
    let mut args = vec!["--git-dir", bare.to_str().unwrap(), "update-ref"];
    if let Some(oid) = oid {
        args.extend([reference, oid]);
    } else {
        args.extend(["-d", reference]);
    }
    run_mutation(&repository.0, &args, "modify remote fixture ref").unwrap();
}

#[test]
fn scoped_fetch_prunes_only_selected_remote_branches_despite_tag_and_mirror_config() {
    let repository = fetch_fixture();
    let base = repository.oid();
    for remote in ["origin", "backup"] {
        remote_fixture_ref(&repository, remote, "refs/heads/gone", Some(&base));
        fetch_with_options(
            &repository.0,
            &FetchOptions {
                remote: Some(remote.into()),
                prune: false,
                history: None,
            },
            &CancellationToken::default(),
        )
        .unwrap();
        remote_fixture_ref(&repository, remote, "refs/heads/gone", None);
    }
    run_mutation(&repository.0, &["tag", "local-only"], "local tag").unwrap();
    run_mutation(&repository.0, &["branch", "local-only"], "local branch").unwrap();
    run_mutation(
        &repository.0,
        &["update-ref", "refs/custom/keep", &base],
        "custom ref",
    )
    .unwrap();
    remote_fixture_ref(&repository, "origin", "refs/tags/remote-only", Some(&base));
    fs::write(repository.0.join("file"), b"new branch content\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "New remote branch").unwrap();
    let tip = repository.oid();
    run_mutation(
        &repository.0,
        &["push", "origin", "HEAD:refs/heads/new"],
        "seed new branch",
    )
    .unwrap();
    for args in [
        vec![
            "config",
            "--replace-all",
            "remote.origin.fetch",
            "+refs/*:refs/*",
        ],
        vec![
            "config",
            "--add",
            "remote.origin.fetch",
            "+refs/tags/*:refs/tags/*",
        ],
        vec!["config", "remote.origin.mirror", "true"],
        vec!["config", "fetch.pruneTags", "true"],
        vec!["config", "remote.origin.pruneTags", "true"],
        vec!["config", "remote.origin.tagOpt", "--tags"],
        vec!["config", "fetch.prune", "true"],
        vec!["config", "fetch.all", "true"],
    ] {
        run_mutation(&repository.0, &args, "configure hostile fetch scope").unwrap();
    }
    let before_head = fixture_ref(&repository, "refs/heads/main");
    let before_index = fs::read(repository.0.join(".git/index")).unwrap();
    fs::write(repository.0.join("file"), b"unstaged must survive\n").unwrap();
    fetch_with_options(
        &repository.0,
        &FetchOptions {
            remote: Some("origin".into()),
            prune: false,
            history: None,
        },
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(
        fixture_ref(&repository, "refs/remotes/origin/gone"),
        Some(base.clone())
    );
    fetch_with_options(
        &repository.0,
        &FetchOptions {
            remote: Some("origin".into()),
            prune: true,
            history: None,
        },
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(fixture_ref(&repository, "refs/remotes/origin/gone"), None);
    assert_eq!(
        fixture_ref(&repository, "refs/remotes/origin/new"),
        Some(tip)
    );
    for reference in [
        "refs/remotes/backup/gone",
        "refs/tags/local-only",
        "refs/heads/local-only",
        "refs/custom/keep",
    ] {
        assert_eq!(
            fixture_ref(&repository, reference),
            Some(base.clone()),
            "{reference}"
        );
    }
    assert_eq!(fixture_ref(&repository, "refs/tags/remote-only"), None);
    assert_eq!(fixture_ref(&repository, "refs/heads/new"), None);
    assert_eq!(fixture_ref(&repository, "refs/heads/main"), before_head);
    assert_eq!(
        fs::read(repository.0.join(".git/index")).unwrap(),
        before_index
    );
    assert_eq!(
        fs::read(repository.0.join("file")).unwrap(),
        b"unstaged must survive\n"
    );
}

#[test]
fn scoped_fetch_all_remote_prune_is_explicit_and_uses_fetch_not_push_url() {
    let repository = fetch_fixture();
    let base = repository.oid();
    for remote in ["origin", "backup"] {
        remote_fixture_ref(&repository, remote, "refs/heads/gone", Some(&base));
    }
    run_mutation(
        &repository.0,
        &[
            "remote",
            "set-url",
            "--push",
            "origin",
            "/no-such-chronos-push-destination",
        ],
        "separate push URL",
    )
    .unwrap();
    fetch_with_options(
        &repository.0,
        &FetchOptions {
            remote: None,
            prune: false,
            history: None,
        },
        &CancellationToken::default(),
    )
    .unwrap();
    for remote in ["origin", "backup"] {
        assert_eq!(
            fixture_ref(&repository, &format!("refs/remotes/{remote}/gone")),
            Some(base.clone())
        );
        remote_fixture_ref(&repository, remote, "refs/heads/gone", None);
    }
    fetch_with_options(
        &repository.0,
        &FetchOptions {
            remote: None,
            prune: true,
            history: None,
        },
        &CancellationToken::default(),
    )
    .unwrap();
    for remote in ["origin", "backup"] {
        assert_eq!(
            fixture_ref(&repository, &format!("refs/remotes/{remote}/gone")),
            None
        );
        assert_eq!(
            fixture_ref(&repository, &format!("refs/remotes/{remote}/main")),
            Some(base.clone())
        );
    }
}

#[test]
fn scoped_fetch_refuses_missing_and_overlapping_remotes_before_updates() {
    let repository = Repository::new();
    assert_eq!(
        fetch_with_options(
            &repository.0,
            &FetchOptions {
                remote: None,
                prune: true,
                history: None
            },
            &CancellationToken::default()
        )
        .unwrap_err()
        .kind,
        "missingRemote"
    );
    run_mutation(
        &repository.0,
        &["remote", "add", "origin", "/no-such-remote"],
        "remote",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["config", "remote.origin/nested.url", "/no-such-remote"],
        "nested remote configuration",
    )
    .unwrap();
    assert_eq!(
        fetch_with_options(
            &repository.0,
            &FetchOptions {
                remote: Some("origin".into()),
                prune: true,
                history: None
            },
            &CancellationToken::default()
        )
        .unwrap_err()
        .kind,
        "overlappingRemoteNamespaces"
    );
    assert!(
        fetch_with_options(
            &repository.0,
            &FetchOptions {
                remote: Some("missing".into()),
                prune: false,
                history: None
            },
            &CancellationToken::default()
        )
        .is_err()
    );
}

#[test]
fn scoped_fetch_cancel_and_failure_leave_actual_updates_visible() {
    let repository = fetch_fixture();
    let base = repository.oid();
    let token = CancellationToken::default();
    token.cancel();
    assert_eq!(
        fetch_with_options(
            &repository.0,
            &FetchOptions {
                remote: None,
                prune: true,
                history: None
            },
            &token
        )
        .unwrap_err()
        .kind,
        "operationCancelled"
    );
    assert_eq!(
        fixture_ref(&repository, "refs/remotes/backup/main"),
        Some(base.clone())
    );
    run_mutation(
        &repository.0,
        &[
            "remote",
            "set-url",
            "origin",
            "/no-such-chronos-fetch-destination",
        ],
        "break later remote",
    )
    .unwrap();
    remote_fixture_ref(&repository, "backup", "refs/heads/added", Some(&base));
    let error = fetch_with_options(
        &repository.0,
        &FetchOptions {
            remote: None,
            prune: true,
            history: None,
        },
        &CancellationToken::default(),
    )
    .unwrap_err();
    assert!(error.message.contains("origin"));
    assert!(error.hint.unwrap().contains("1 earlier remote"));
    assert_eq!(
        fixture_ref(&repository, "refs/remotes/backup/added"),
        Some(base)
    );
}

#[test]
fn scoped_fetch_refuses_shared_custom_tracking_destinations_without_changes() {
    let repository = fetch_fixture();
    let baseline = fixture_ref(&repository, "refs/remotes/origin/main");
    for destination in [
        "refs/remotes/origin/main",
        "refs/remotes/origin/*",
        "refs/*",
    ] {
        let source = if destination.contains('*') {
            "refs/heads/*"
        } else {
            "refs/heads/main"
        };
        let mapping = format!("+{source}:{destination}");
        run_mutation(
            &repository.0,
            &["config", "--replace-all", "remote.backup.fetch", &mapping],
            "share remote namespace",
        )
        .unwrap();
        let error = fetch_with_options(
            &repository.0,
            &FetchOptions {
                remote: Some("origin".into()),
                prune: true,
                history: None,
            },
            &CancellationToken::default(),
        )
        .unwrap_err();
        assert_eq!(error.kind, "sharedRemoteTrackingNamespace", "{destination}");
        assert_eq!(
            fixture_ref(&repository, "refs/remotes/origin/main"),
            baseline
        );
    }
}

#[test]
fn scoped_fetch_refuses_tracking_aliases_that_redirect_to_local_branches() {
    let repository = fetch_fixture();
    run_mutation(&repository.0, &["branch", "local-only"], "local branch").unwrap();
    let base = fixture_ref(&repository, "refs/heads/local-only");
    run_mutation(
        &repository.0,
        &[
            "symbolic-ref",
            "refs/remotes/origin/main",
            "refs/heads/local-only",
        ],
        "redirect tracking alias",
    )
    .unwrap();
    let error = fetch_with_options(
        &repository.0,
        &FetchOptions {
            remote: Some("origin".into()),
            prune: true,
            history: None,
        },
        &CancellationToken::default(),
    )
    .unwrap_err();
    assert_eq!(error.kind, "redirectedRemoteTrackingReference");
    assert_eq!(fixture_ref(&repository, "refs/heads/local-only"), base);
}

#[test]
fn scoped_fetch_does_not_create_local_branches_through_dangling_tracking_aliases() {
    let repository = fetch_fixture();
    run_mutation(
        &repository.0,
        &[
            "symbolic-ref",
            "refs/remotes/origin/main",
            "refs/heads/not-created",
        ],
        "dangling tracking alias",
    )
    .unwrap();
    let result = fetch_with_options(
        &repository.0,
        &FetchOptions {
            remote: Some("origin".into()),
            prune: false,
            history: None,
        },
        &CancellationToken::default(),
    );
    assert_eq!(
        result.unwrap_err().kind,
        "redirectedRemoteTrackingReference"
    );
    assert_eq!(fixture_ref(&repository, "refs/heads/not-created"), None);
}

#[test]
fn scoped_fetch_refuses_unresolved_aliases_inside_its_tracking_namespace() {
    let repository = fetch_fixture();
    run_mutation(
        &repository.0,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/missing",
        ],
        "dangling tracking HEAD",
    )
    .unwrap();
    let error = fetch_with_options(
        &repository.0,
        &FetchOptions {
            remote: Some("origin".into()),
            prune: false,
            history: None,
        },
        &CancellationToken::default(),
    )
    .unwrap_err();
    assert_eq!(error.kind, "invalidRemoteTrackingReferences");
    assert_eq!(
        fixture_ref(&repository, "refs/remotes/origin/missing"),
        None
    );
}

#[test]
fn worktree_move_preserves_branch_index_and_all_working_files() {
    let repository = Repository::new();
    create_worktree(&repository.0, &repository.0, "old tree", "topic", "HEAD").unwrap();
    let source = repository.0.join("old tree");
    fs::write(source.join("file"), b"staged\n").unwrap();
    stage_all(&source).unwrap();
    fs::write(source.join("file"), b"unstaged\n").unwrap();
    fs::write(source.join("untracked"), b"\0\xffdata").unwrap();
    fs::write(source.join(".gitignore"), b"ignored\n").unwrap();
    fs::write(source.join("ignored"), b"keep ignored\n").unwrap();
    let before_index = run_git(&source, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let before_status = run_git(
        &source,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .unwrap()
    .stdout;
    let request = WorktreeMove {
        path: source.to_str().unwrap().into(),
        parent_path: repository.0.to_str().unwrap().into(),
        folder: "new tree".into(),
        expected_oid: repository.oid(),
        expected_branch: Some("topic".into()),
    };
    move_worktree(&repository.0, &request).unwrap();
    let destination = repository.0.join("new tree");
    assert!(!source.exists());
    assert_eq!(
        run_git(&destination, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        before_index
    );
    assert_eq!(
        run_git(
            &destination,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"]
        )
        .unwrap()
        .stdout,
        before_status
    );
    for (file, bytes) in [
        ("file", b"unstaged\n".as_slice()),
        ("untracked", b"\0\xffdata"),
        ("ignored", b"keep ignored\n"),
    ] {
        assert_eq!(fs::read(destination.join(file)).unwrap(), bytes);
    }
    assert_eq!(
        fixture_ref(&repository, "refs/heads/topic"),
        Some(repository.oid())
    );
    let list = run_git(&repository.0, &["worktree", "list", "--porcelain"]).unwrap();
    assert!(String::from_utf8_lossy(&list.stdout).contains(destination.to_str().unwrap()));
    assert!(!String::from_utf8_lossy(&list.stdout).contains(source.to_str().unwrap()));
    assert!(delete_branch(&repository.0, "topic", true).is_err());
    assert_eq!(
        fixture_ref(&repository, "refs/heads/topic"),
        Some(repository.oid())
    );
}

#[test]
fn worktree_move_refuses_locked_stale_occupied_nested_and_main_sources() {
    let repository = Repository::new();
    create_worktree(&repository.0, &repository.0, "linked", "topic", "HEAD").unwrap();
    let source = repository.0.join("linked");
    let mut request = WorktreeMove {
        path: source.to_str().unwrap().into(),
        parent_path: repository.0.to_str().unwrap().into(),
        folder: "moved".into(),
        expected_oid: repository.oid(),
        expected_branch: Some("topic".into()),
    };
    set_worktree_locked(&repository.0, &request.path, true).unwrap();
    assert_eq!(
        move_worktree(&repository.0, &request).unwrap_err().kind,
        "unavailableWorktree"
    );
    set_worktree_locked(&repository.0, &request.path, false).unwrap();
    request.expected_branch = Some("other".into());
    assert_eq!(
        move_worktree(&repository.0, &request).unwrap_err().kind,
        "staleWorktree"
    );
    request.expected_branch = Some("topic".into());
    fs::create_dir(repository.0.join("moved")).unwrap();
    fs::write(repository.0.join("moved/keep"), b"do not replace").unwrap();
    assert_eq!(
        move_worktree(&repository.0, &request).unwrap_err().kind,
        "destinationExists"
    );
    request.parent_path = source.to_str().unwrap().into();
    assert_eq!(
        move_worktree(&repository.0, &request).unwrap_err().kind,
        "invalidWorktreeDestination"
    );
    request.parent_path = repository.0.to_str().unwrap().into();
    request.folder = "../escape".into();
    assert!(move_worktree(&repository.0, &request).is_err());
    request.folder = "elsewhere".into();
    request.path = repository.0.to_str().unwrap().into();
    request.expected_branch = Some("main".into());
    assert_eq!(
        move_worktree(&repository.0, &request).unwrap_err().kind,
        "currentWorktree"
    );
    assert_eq!(
        move_worktree(&source, &request).unwrap_err().kind,
        "mainWorktree"
    );
    assert!(source.exists());
    assert_eq!(
        fs::read(repository.0.join("moved/keep")).unwrap(),
        b"do not replace"
    );
}

#[test]
fn worktree_move_detached_head_preserves_symlink_executable_and_git_registration() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["worktree", "add", "--detach", "detached", "HEAD"],
        "detached worktree",
    )
    .unwrap();
    let source = repository.0.join("detached");
    #[cfg(unix)]
    {
        use std::os::unix::fs::{PermissionsExt, symlink};
        fs::write(source.join("executable"), b"#!/bin/sh\n").unwrap();
        fs::set_permissions(source.join("executable"), fs::Permissions::from_mode(0o755)).unwrap();
        symlink("file", source.join("link")).unwrap();
    }
    move_worktree(
        &repository.0,
        &WorktreeMove {
            path: source.to_str().unwrap().into(),
            parent_path: repository.0.to_str().unwrap().into(),
            folder: "detached moved".into(),
            expected_oid: repository.oid(),
            expected_branch: None,
        },
    )
    .unwrap();
    let destination = repository.0.join("detached moved");
    assert_eq!(
        run_git(&destination, &["rev-parse", "HEAD"])
            .unwrap()
            .stdout,
        run_git(&repository.0, &["rev-parse", "HEAD"])
            .unwrap()
            .stdout
    );
    assert!(
        !run_git(&destination, &["symbolic-ref", "-q", "HEAD"])
            .unwrap()
            .status
            .success()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(destination.join("executable"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
        assert_eq!(
            fs::read_link(destination.join("link")).unwrap(),
            PathBuf::from("file")
        );
    }
    fs::write(destination.join("file"), b"after move\n").unwrap();
    stage_all(&destination).unwrap();
    commit(&destination, "After move").unwrap();
}

#[test]
fn worktree_move_refuses_missing_source_and_changed_head_without_updates() {
    let repository = Repository::new();
    create_worktree(&repository.0, &repository.0, "linked", "topic", "HEAD").unwrap();
    let source = repository.0.join("linked");
    let request = WorktreeMove {
        path: source.to_str().unwrap().into(),
        parent_path: repository.0.to_str().unwrap().into(),
        folder: "moved".into(),
        expected_oid: repository.oid(),
        expected_branch: Some("topic".into()),
    };
    fs::write(source.join("file"), b"new commit\n").unwrap();
    stage_all(&source).unwrap();
    commit(&source, "New tip").unwrap();
    assert_eq!(
        move_worktree(&repository.0, &request).unwrap_err().kind,
        "staleWorktree"
    );
    fs::rename(&source, repository.0.join("externally-moved")).unwrap();
    assert!(move_worktree(&repository.0, &request).is_err());
    assert!(!repository.0.join("moved").exists());
    assert!(repository.0.join("externally-moved/file").exists());
}

#[test]
fn worktree_move_refuses_initialized_submodules_without_changing_files() {
    let repository = Repository::new();
    let module = Repository::new();
    create_worktree(&repository.0, &repository.0, "linked", "topic", "HEAD").unwrap();
    let source = repository.0.join("linked");
    run_mutation(
        &source,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            module.0.to_str().unwrap(),
            "nested",
        ],
        "initialize fixture submodule",
    )
    .unwrap();
    let before = run_git(&source, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let error = move_worktree(
        &repository.0,
        &WorktreeMove {
            path: source.to_str().unwrap().into(),
            parent_path: repository.0.to_str().unwrap().into(),
            folder: "moved".into(),
            expected_oid: repository.oid(),
            expected_branch: Some("topic".into()),
        },
    )
    .unwrap_err();
    assert!(error.message.contains("submodules"));
    assert_eq!(
        run_git(&source, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        before
    );
    assert_eq!(fs::read(source.join("nested/file")).unwrap(), b"base\n");
    assert!(!repository.0.join("moved").exists());
}

#[test]
fn worktree_repair_reconnects_moved_dirty_directory_without_changing_files_or_other_links() {
    let repository = Repository::new();
    create_worktree(&repository.0, &repository.0, "old", "topic", "HEAD").unwrap();
    create_worktree(&repository.0, &repository.0, "other", "other", "HEAD").unwrap();
    let old = repository.0.join("old");
    let actual = repository.0.join("actual moved");
    let other_link = fs::read(repository.0.join(".git/worktrees/other/gitdir")).unwrap();
    fs::write(old.join("file"), b"staged\n").unwrap();
    stage_all(&old).unwrap();
    fs::write(old.join("file"), b"unstaged\n").unwrap();
    fs::write(old.join(".gitignore"), b"ignored\n").unwrap();
    fs::write(old.join("ignored"), b"keep ignored").unwrap();
    fs::write(old.join("untracked"), b"\0\xffkeep").unwrap();
    let index = fs::read(repository.0.join(".git/worktrees/old/index")).unwrap();
    fs::rename(&old, &actual).unwrap();
    let marker = fs::read(actual.join(".git")).unwrap();
    repair_worktree(
        &repository.0,
        &WorktreeRepair {
            path: old.to_str().unwrap().into(),
            actual_path: actual.to_str().unwrap().into(),
            expected_oid: repository.oid(),
            expected_branch: Some("topic".into()),
        },
    )
    .unwrap();
    assert_eq!(fs::read(actual.join(".git")).unwrap(), marker);
    assert_eq!(
        fs::read(repository.0.join(".git/worktrees/old/index")).unwrap(),
        index
    );
    assert_eq!(
        fs::read(repository.0.join(".git/worktrees/other/gitdir")).unwrap(),
        other_link
    );
    assert_eq!(fs::read(actual.join("file")).unwrap(), b"unstaged\n");
    assert_eq!(fs::read(actual.join("ignored")).unwrap(), b"keep ignored");
    assert_eq!(fs::read(actual.join("untracked")).unwrap(), b"\0\xffkeep");
    assert_eq!(
        managed_worktree(&repository.0, actual.to_str().unwrap())
            .unwrap()
            .branch,
        Some("topic".into())
    );
    assert!(managed_worktree(&repository.0, old.to_str().unwrap()).is_err());
    assert!(delete_branch(&repository.0, "topic", true).is_err());
    commit(&actual, "After repair").unwrap();
}

#[test]
fn worktree_repair_does_not_repair_another_missing_registration() {
    let repository = Repository::new();
    create_worktree(&repository.0, &repository.0, "old", "topic", "HEAD").unwrap();
    create_worktree(&repository.0, &repository.0, "other", "other", "HEAD").unwrap();
    let old = repository.0.join("old");
    let actual = repository.0.join("actual");
    let other = repository.0.join("other");
    let other_actual = repository.0.join("other-actual");
    fs::rename(&old, &actual).unwrap();
    fs::rename(&other, &other_actual).unwrap();
    let backlink = fs::read(repository.0.join(".git/worktrees/other/gitdir")).unwrap();
    repair_worktree(
        &repository.0,
        &WorktreeRepair {
            path: old.to_str().unwrap().into(),
            actual_path: actual.to_str().unwrap().into(),
            expected_oid: repository.oid(),
            expected_branch: Some("topic".into()),
        },
    )
    .unwrap();
    assert_eq!(
        fs::read(repository.0.join(".git/worktrees/other/gitdir")).unwrap(),
        backlink
    );
    assert!(managed_worktree(&repository.0, other.to_str().unwrap()).is_ok());
    assert!(managed_worktree(&repository.0, other_actual.to_str().unwrap()).is_err());
}

#[test]
fn worktree_repair_does_not_rewrite_another_worktrees_broken_link() {
    let repository = Repository::new();
    create_worktree(&repository.0, &repository.0, "old", "topic", "HEAD").unwrap();
    create_worktree(&repository.0, &repository.0, "other", "other", "HEAD").unwrap();
    let old = repository.0.join("old");
    let actual = repository.0.join("actual");
    fs::rename(&old, &actual).unwrap();
    let other_marker = repository.0.join("other/.git");
    let broken = b"gitdir: /no-such-chronos-worktree-registration\n";
    fs::write(&other_marker, broken).unwrap();
    let result = repair_worktree(
        &repository.0,
        &WorktreeRepair {
            path: old.to_str().unwrap().into(),
            actual_path: actual.to_str().unwrap().into(),
            expected_oid: repository.oid(),
            expected_branch: Some("topic".into()),
        },
    );
    assert_eq!(result.unwrap_err().kind, "otherWorktreeNeedsRepair");
    assert_eq!(fs::read(&other_marker).unwrap(), broken);
}

#[test]
fn worktree_repair_refuses_other_worktree_unrelated_repository_locked_and_stale_state() {
    let repository = Repository::new();
    let foreign = Repository::new();
    create_worktree(&repository.0, &repository.0, "old", "topic", "HEAD").unwrap();
    create_worktree(&repository.0, &repository.0, "other", "other", "HEAD").unwrap();
    create_worktree(&foreign.0, &foreign.0, "foreign", "foreign", "HEAD").unwrap();
    let old = repository.0.join("old");
    let actual = repository.0.join("actual");
    let mut request = WorktreeRepair {
        path: old.to_str().unwrap().into(),
        actual_path: actual.to_str().unwrap().into(),
        expected_oid: repository.oid(),
        expected_branch: Some("topic".into()),
    };
    fs::rename(&old, &actual).unwrap();
    let before = fs::read(repository.0.join(".git/worktrees/old/gitdir")).unwrap();
    request.actual_path = foreign.0.join("foreign").to_str().unwrap().into();
    assert_eq!(
        repair_worktree(&repository.0, &request).unwrap_err().kind,
        "unrelatedWorktree"
    );
    request.actual_path = repository.0.join("other").to_str().unwrap().into();
    assert_eq!(
        repair_worktree(&repository.0, &request).unwrap_err().kind,
        "unrelatedWorktree"
    );
    request.actual_path = actual.to_str().unwrap().into();
    request.expected_branch = Some("changed".into());
    assert_eq!(
        repair_worktree(&repository.0, &request).unwrap_err().kind,
        "staleWorktree"
    );
    request.expected_branch = Some("topic".into());
    run_mutation(
        &repository.0,
        &["worktree", "lock", &request.path],
        "lock missing registration",
    )
    .unwrap();
    assert_eq!(
        repair_worktree(&repository.0, &request).unwrap_err().kind,
        "unavailableWorktree"
    );
    assert_eq!(
        fs::read(repository.0.join(".git/worktrees/old/gitdir")).unwrap(),
        before
    );
}

#[test]
fn worktree_repair_refuses_registration_redirected_to_another_common_repository() {
    let repository = Repository::new();
    let foreign = Repository::new();
    let foreign_head = foreign.oid();
    create_worktree(&repository.0, &repository.0, "old", "topic", "HEAD").unwrap();
    let old = repository.0.join("old");
    let actual = repository.0.join("actual");
    fs::rename(&old, &actual).unwrap();
    fs::write(
        repository.0.join(".git/worktrees/old/commondir"),
        foreign.0.join(".git").to_str().unwrap(),
    )
    .unwrap();
    let backlink = fs::read(repository.0.join(".git/worktrees/old/gitdir")).unwrap();
    let result = repair_worktree(
        &repository.0,
        &WorktreeRepair {
            path: old.to_str().unwrap().into(),
            actual_path: actual.to_str().unwrap().into(),
            expected_oid: repository.oid(),
            expected_branch: Some("topic".into()),
        },
    );
    assert!(result.is_err());
    assert_eq!(
        fs::read(repository.0.join(".git/worktrees/old/gitdir")).unwrap(),
        backlink
    );
    assert_eq!(fs::read(actual.join("file")).unwrap(), b"base\n");
    assert_eq!(foreign.oid(), foreign_head);
}

#[test]
fn worktree_repair_refuses_existing_source_copy_malformed_link_and_directory_symlink() {
    let repository = Repository::new();
    create_worktree(&repository.0, &repository.0, "old", "topic", "HEAD").unwrap();
    let old = repository.0.join("old");
    let actual = repository.0.join("actual");
    fs::create_dir(&actual).unwrap();
    fs::copy(old.join(".git"), actual.join(".git")).unwrap();
    let request = WorktreeRepair {
        path: old.to_str().unwrap().into(),
        actual_path: actual.to_str().unwrap().into(),
        expected_oid: repository.oid(),
        expected_branch: Some("topic".into()),
    };
    assert_eq!(
        repair_worktree(&repository.0, &request).unwrap_err().kind,
        "worktreeSourceStillExists"
    );
    fs::rename(&old, repository.0.join("really-moved")).unwrap();
    fs::write(actual.join(".git"), b"not a git link\n").unwrap();
    assert_eq!(
        repair_worktree(&repository.0, &request).unwrap_err().kind,
        "worktreeRepairUnavailable"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let alias = repository.0.join("alias");
        symlink(repository.0.join("really-moved"), &alias).unwrap();
        let request = WorktreeRepair {
            actual_path: alias.to_str().unwrap().into(),
            ..request
        };
        assert_eq!(
            repair_worktree(&repository.0, &request).unwrap_err().kind,
            "worktreeRepairUnavailable"
        );
    }
    assert_eq!(
        fs::read(repository.0.join("really-moved/file")).unwrap(),
        b"base\n"
    );
}

#[test]
fn worktree_repair_refuses_initialized_submodule_without_rewriting_links() {
    let repository = Repository::new();
    let module = Repository::new();
    run_mutation(
        &repository.0,
        &["worktree", "add", "--detach", "old", "HEAD"],
        "detached worktree",
    )
    .unwrap();
    let old = repository.0.join("old");
    let actual = repository.0.join("actual");
    run_mutation(
        &old,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            module.0.to_str().unwrap(),
            "nested",
        ],
        "fixture submodule",
    )
    .unwrap();
    fs::write(old.join("nested/file"), b"dirty submodule\n").unwrap();
    fs::rename(&old, &actual).unwrap();
    let backlink = fs::read(repository.0.join(".git/worktrees/old/gitdir")).unwrap();
    let error = repair_worktree(
        &repository.0,
        &WorktreeRepair {
            path: old.to_str().unwrap().into(),
            actual_path: actual.to_str().unwrap().into(),
            expected_oid: repository.oid(),
            expected_branch: None,
        },
    )
    .unwrap_err();
    assert_eq!(error.kind, "submoduleWorktreeRepairUnsupported");
    assert_eq!(
        fs::read(repository.0.join(".git/worktrees/old/gitdir")).unwrap(),
        backlink
    );
    assert_eq!(
        fs::read(actual.join("nested/file")).unwrap(),
        b"dirty submodule\n"
    );
    assert!(
        !run_git(&actual, &["symbolic-ref", "-q", "HEAD"])
            .unwrap()
            .status
            .success()
    );
    assert!(managed_worktree(&repository.0, old.to_str().unwrap()).is_ok());
}

#[test]
fn worktree_repair_reconnects_detached_head_and_preserves_symlinks_and_permissions() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["worktree", "add", "--detach", "old", "HEAD"],
        "detached worktree",
    )
    .unwrap();
    let old = repository.0.join("old");
    let actual = repository.0.join("actual");
    #[cfg(unix)]
    {
        use std::os::unix::fs::{PermissionsExt, symlink};
        symlink("file", old.join("link")).unwrap();
        fs::set_permissions(old.join("file"), fs::Permissions::from_mode(0o755)).unwrap();
    }
    fs::rename(&old, &actual).unwrap();
    repair_worktree(
        &repository.0,
        &WorktreeRepair {
            path: old.to_str().unwrap().into(),
            actual_path: actual.to_str().unwrap().into(),
            expected_oid: repository.oid(),
            expected_branch: None,
        },
    )
    .unwrap();
    let selected = managed_worktree(&repository.0, actual.to_str().unwrap()).unwrap();
    assert_eq!(selected.branch, None);
    assert_eq!(selected.oid, repository.oid());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::read_link(actual.join("link")).unwrap(),
            PathBuf::from("file")
        );
        assert_eq!(
            fs::metadata(actual.join("file"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
    }
}

#[test]
#[ignore = "requires Git LFS with track --json; run with --ignored"]
fn lfs_tracking_untrack_preserves_index_files_other_rules_and_nested_attributes() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    track_lfs_pattern(&repository.0, "*.psd", true).unwrap();
    track_lfs_pattern(&repository.0, "space folder/*.bin", false).unwrap();
    fs::create_dir(repository.0.join("nested")).unwrap();
    fs::write(
        repository.0.join("nested/.gitattributes"),
        b"*.psd filter=lfs diff=lfs merge=lfs -text\n",
    )
    .unwrap();
    fs::write(repository.0.join("image.psd"), b"working image bytes\n").unwrap();
    let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let head = repository.oid();
    let nested = fs::read(repository.0.join("nested/.gitattributes")).unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    assert!(rules.patterns.iter().any(|rule| rule.pattern == "*.psd"
        && rule.source == ".gitattributes"
        && rule.lockable
        && rule.tracked));
    assert!(
        rules
            .patterns
            .iter()
            .any(|rule| rule.source == "nested/.gitattributes")
    );
    untrack_lfs_pattern(&repository.0, "*.psd", &rules.state).unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    assert!(
        !rules
            .patterns
            .iter()
            .any(|rule| rule.pattern == "*.psd" && rule.source == ".gitattributes")
    );
    assert_eq!(
        fs::read(repository.0.join("nested/.gitattributes")).unwrap(),
        nested
    );
    assert_eq!(
        fs::read(repository.0.join("image.psd")).unwrap(),
        b"working image bytes\n"
    );
    assert_eq!(
        run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert_eq!(repository.oid(), head);
    let spaced = rules
        .patterns
        .iter()
        .find(|rule| rule.source == ".gitattributes")
        .unwrap()
        .pattern
        .clone();
    untrack_lfs_pattern(&repository.0, &spaced, &rules.state).unwrap();
    assert!(
        lfs_tracking_rules(&repository.0)
            .unwrap()
            .patterns
            .iter()
            .all(|rule| rule.source != ".gitattributes")
    );
}

#[test]
fn lfs_attributes_compare_working_and_index_rules_without_changing_files_or_index() {
    let repository = Repository::new();
    fs::write(
        repository.0.join(".gitattributes"),
        b"*.chrasset filter=lfs diff=lfs merge=lfs -text lockable\n",
    )
    .unwrap();
    stage_path(&repository.0, ".gitattributes").unwrap();
    fs::create_dir(repository.0.join("nested")).unwrap();
    fs::write(
        repository.0.join("nested/.gitattributes"),
        b"*.chrasset -filter diff=custom !merge text -lockable\n",
    )
    .unwrap();
    let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let root = fs::read(repository.0.join(".gitattributes")).unwrap();
    let nested = fs::read(repository.0.join("nested/.gitattributes")).unwrap();
    let attrs = lfs_file_attributes(&repository.0, "nested/space [*] file.chrasset").unwrap();
    assert_eq!(attrs.path, "nested/space [*] file.chrasset");
    assert_eq!(attrs.attributes[0].working, "unset");
    assert_eq!(attrs.attributes[0].index, "lfs");
    assert_eq!(attrs.attributes[1].working, "custom");
    assert_eq!(attrs.attributes[2].working, "unspecified");
    assert_eq!(attrs.attributes[3].working, "set");
    assert_eq!(attrs.attributes[3].index, "unset");
    assert_eq!(attrs.attributes[4].working, "unset");
    assert_eq!(attrs.attributes[4].index, "set");
    assert_eq!(fs::read(repository.0.join(".gitattributes")).unwrap(), root);
    assert_eq!(
        fs::read(repository.0.join("nested/.gitattributes")).unwrap(),
        nested
    );
    assert_eq!(
        run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    fs::remove_file(repository.0.join(".gitattributes")).unwrap();
    let attrs = lfs_file_attributes(&repository.0, "missing.chrasset").unwrap();
    assert_eq!(attrs.attributes[0].working, "lfs");
    assert_eq!(attrs.attributes[0].index, "lfs");
}

#[test]
#[ignore = "requires Git LFS with ls-files --json; run with --ignored"]
fn lfs_objects_distinguish_pointer_missing_cache_and_unverified_content_without_mutating() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["config", "lfs.storage", "custom-lfs"],
        "configure alternate cache",
    )
    .unwrap();
    initialize_lfs(&repository.0).unwrap();
    track_lfs_pattern(&repository.0, "*.bin", false).unwrap();
    let file = repository.0.join("space [*].bin");
    fs::write(&file, b"original object contents\n").unwrap();
    stage_path(&repository.0, "space [*].bin").unwrap();
    stage_path(&repository.0, ".gitattributes").unwrap();
    commit(&repository.0, "LFS object").unwrap();
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    let head = repository.oid();
    let objects = lfs_objects(&repository.0).unwrap();
    assert_eq!(objects.files.len(), 1);
    let object = &objects.files[0];
    assert_eq!(object.name, "space [*].bin");
    assert_eq!(object.working_state, "contentSizeMatches");
    assert!(object.downloaded && object.checkout);
    let oid = object.oid.clone();
    let pointer = run_git(&repository.0, &["show", ":space [*].bin"])
        .unwrap()
        .stdout;
    fs::write(&file, &pointer).unwrap();
    let objects = lfs_objects(&repository.0).unwrap();
    assert_eq!(objects.files[0].working_state, "pointer");
    assert!(!objects.files[0].checkout);
    assert!(objects.files[0].downloaded);
    let cache = repository.0.join(format!(
        ".git/custom-lfs/objects/{}/{}/{}",
        &oid[..2],
        &oid[2..4],
        oid
    ));
    assert!(cache.is_file());
    fs::remove_file(&cache).unwrap();
    let objects = lfs_objects(&repository.0).unwrap();
    assert!(!objects.files[0].downloaded);
    assert_eq!(objects.files[0].working_state, "pointer");
    fs::write(&file, b"modified object contents\n").unwrap();
    assert_eq!(
        lfs_objects(&repository.0).unwrap().files[0].working_state,
        "contentSizeMatches"
    );
    fs::write(&file, b"short\n").unwrap();
    assert_eq!(
        lfs_objects(&repository.0).unwrap().files[0].working_state,
        "sizeMismatch"
    );
    fs::write(
        &file,
        b"version https://git-lfs.github.com/spec/v1\nother pointer\n",
    )
    .unwrap();
    assert_eq!(
        lfs_objects(&repository.0).unwrap().files[0].working_state,
        "pointerLike"
    );
    fs::remove_file(&file).unwrap();
    assert_eq!(
        lfs_objects(&repository.0).unwrap().files[0].working_state,
        "missing"
    );
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(repository.oid(), head);
    assert!(!cache.exists());
    assert!(!file.exists());
}

fn lfs_fetch_fixture() -> Repository {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS hooks",
    )
    .unwrap();
    run_mutation(path, &["config", "lfs.storage", "custom-lfs"], "set cache").unwrap();
    initialize_lfs(path).unwrap();
    track_lfs_pattern(path, "*.bin", false).unwrap();
    for directory in ["assets", "nested", "code"] {
        fs::create_dir(path.join(directory)).unwrap();
    }
    fs::write(path.join("code/file"), b"code\n").unwrap();
    fs::write(path.join("assets/space file.bin"), b"previous object\n").unwrap();
    fs::write(path.join("nested/space file.bin"), b"unselected object\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Original LFS objects").unwrap();
    fs::write(
        path.join("assets/space file.bin"),
        b"selected current object\n",
    )
    .unwrap();
    stage_path(path, "assets/space file.bin").unwrap();
    commit(path, "Updated selected object").unwrap();
    let bare = path.join("origin.git");
    run_mutation(
        path,
        &["init", "--bare", bare.to_str().unwrap()],
        "create LFS remote",
    )
    .unwrap();
    run_mutation(
        path,
        &["remote", "add", "origin", bare.to_str().unwrap()],
        "configure LFS remote",
    )
    .unwrap();
    run_mutation(
        path,
        &["push", "origin", "HEAD:main"],
        "publish LFS objects",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "lfs.fetchrecentalways", "true"],
        "enable broad fetch policy",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "lfs.fetchrecentcommitsdays", "30"],
        "enable historical fetch",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "lfs.fetchinclude", "does-not-match"],
        "restrict configured include",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "lfs.fetchexclude", "*"],
        "exclude configured paths",
    )
    .unwrap();
    let hooks = path.join("shared-hooks");
    fs::create_dir(&hooks).unwrap();
    fs::write(hooks.join("pre-push"), b"# fixture hook, not an LFS hook\n").unwrap();
    run_mutation(
        path,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
        "select shared fixture hooks",
    )
    .unwrap();
    repository
}

fn lfs_hydration_pointer(repository: &Repository) -> LfsCheckoutPreview {
    let path = &repository.0;
    let file = lfs_objects(path)
        .unwrap()
        .files
        .into_iter()
        .find(|file| file.name == "assets/space file.bin")
        .unwrap();
    let pointer = run_git(path, &["show", ":assets/space file.bin"])
        .unwrap()
        .stdout;
    fs::write(path.join(&file.name), pointer).unwrap();
    preview_lfs_checkout(path, &file.name, &file.oid, file.size).unwrap()
}

#[test]
#[ignore = "requires Git LFS with pointer and env commands; run with --ignored"]
fn lfs_checkout_hydrates_one_verified_pointer_preserving_index_refs_modes_config_and_other_files() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = lfs_hydration_pointer(&repository);
    fs::write(
        path.join("nested/space file.bin"),
        b"dirty other contents\n",
    )
    .unwrap();
    fs::write(path.join("file"), b"staged ordinary contents\n").unwrap();
    stage_path(path, "file").unwrap();
    let preview = preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let refs = run_git(path, &["show-ref"]).unwrap().stdout;
    let permissions = fs::metadata(path.join(&preview.file))
        .unwrap()
        .permissions();
    checkout_lfs_object(path, &preview, &CancellationToken::default()).unwrap();
    assert_eq!(
        fs::read(path.join(&preview.file)).unwrap(),
        b"selected current object\n"
    );
    assert_eq!(
        fs::read(path.join("nested/space file.bin")).unwrap(),
        b"dirty other contents\n"
    );
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(run_git(path, &["show-ref"]).unwrap().stdout, refs);
    assert_eq!(
        fs::metadata(path.join(&preview.file))
            .unwrap()
            .permissions(),
        permissions
    );
    assert!(!fs::read_dir(path.join("assets")).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".chronos-lfs-")
    }));
}

#[test]
#[ignore = "requires Git LFS with pointer and env commands; run with --ignored"]
fn lfs_checkout_refuses_same_size_corrupt_cache_without_replacing_pointer_or_leaving_temp() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = lfs_hydration_pointer(&repository);
    let pointer = fs::read(path.join(&preview.file)).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    fs::write(
        lfs_cache_path(&repository, &preview.oid),
        vec![b'x'; preview.size as usize],
    )
    .unwrap();
    assert_eq!(
        checkout_lfs_object(path, &preview, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "corruptLfsHydrationObject"
    );
    assert_eq!(fs::read(path.join(&preview.file)).unwrap(), pointer);
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert!(!fs::read_dir(path.join("assets")).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".chronos-lfs-")
    }));
}

#[test]
#[ignore = "requires Git LFS with pointer and env commands; run with --ignored"]
fn lfs_checkout_refuses_modified_missing_sparse_assume_unchanged_and_different_index_pointers() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = lfs_hydration_pointer(&repository);
    let pointer = fs::read(path.join(&preview.file)).unwrap();
    fs::write(path.join(&preview.file), b"modified working file\n").unwrap();
    assert!(checkout_lfs_object(path, &preview, &CancellationToken::default()).is_err());
    assert_eq!(
        fs::read(path.join(&preview.file)).unwrap(),
        b"modified working file\n"
    );
    fs::remove_file(path.join(&preview.file)).unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    assert!(!path.join(&preview.file).exists());
    fs::write(path.join(&preview.file), &pointer).unwrap();
    run_mutation(
        path,
        &["update-index", "--assume-unchanged", "--", &preview.file],
        "assume fixture",
    )
    .unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    run_mutation(
        path,
        &["update-index", "--no-assume-unchanged", "--", &preview.file],
        "clear assume fixture",
    )
    .unwrap();
    fs::write(path.join(&preview.file), b"different staged object\n").unwrap();
    stage_path(path, &preview.file).unwrap();
    fs::write(path.join(&preview.file), &pointer).unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    run_mutation(
        path,
        &["restore", "--staged", "--", &preview.file],
        "restore index pointer",
    )
    .unwrap();
    run_mutation(
        path,
        &["update-index", "--skip-worktree", "--", &preview.file],
        "exclude selected entry",
    )
    .unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(&preview.file)).unwrap(), pointer);
}

#[test]
#[ignore = "requires Git LFS with pointer and env commands; run with --ignored"]
fn lfs_checkout_preserves_real_sparse_index_and_allows_literal_pattern_names_without_scope_expansion()
 {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = selected_lfs_fetch(&repository);
    run_mutation(
        path,
        &["sparse-checkout", "set", "--cone", "--sparse-index", "code"],
        "exclude selected assets",
    )
    .unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    assert!(
        !path.join(&preview.file).exists(),
        "sparse state: {:?}; status: {:?}",
        run_git(path, &["ls-files", "-v", "--", &preview.file])
            .unwrap()
            .stdout,
        run_git(path, &["status", "--porcelain"]).unwrap().stdout
    );
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    run_mutation(
        path,
        &["sparse-checkout", "disable"],
        "restore included files",
    )
    .unwrap();
    let literal = "literal [*],.bin";
    fs::write(path.join(literal), b"literal object\n").unwrap();
    stage_path(path, literal).unwrap();
    let file = lfs_objects(path)
        .unwrap()
        .files
        .into_iter()
        .find(|file| file.name == literal)
        .unwrap();
    let pointer = run_git(path, &["show", &format!(":{literal}")])
        .unwrap()
        .stdout;
    fs::write(path.join(literal), pointer).unwrap();
    let preview = preview_lfs_checkout(path, literal, &file.oid, file.size).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    checkout_lfs_object(path, &preview, &CancellationToken::default()).unwrap();
    assert_eq!(fs::read(path.join(literal)).unwrap(), b"literal object\n");
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
}

#[test]
#[ignore = "requires Git LFS with pointer and env commands; run with --ignored"]
fn lfs_checkout_refuses_stale_full_index_head_attributes_and_config_and_honors_precancellation() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = lfs_hydration_pointer(&repository);
    let pointer = fs::read(path.join(&preview.file)).unwrap();
    let cancellation = CancellationToken::default();
    cancellation.cancel();
    assert_eq!(
        checkout_lfs_object(path, &preview, &cancellation)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
    run_mutation(
        path,
        &["config", "lfs.storage", "different-cache"],
        "change cache",
    )
    .unwrap();
    assert!(checkout_lfs_object(path, &preview, &CancellationToken::default()).is_err());
    run_mutation(
        path,
        &["config", "lfs.storage", "custom-lfs"],
        "restore cache",
    )
    .unwrap();
    fs::write(path.join("file"), b"staged unrelated edit\n").unwrap();
    stage_path(path, "file").unwrap();
    assert_eq!(
        checkout_lfs_object(path, &preview, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "staleLfsCheckout"
    );
    let preview = preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).unwrap();
    fs::write(path.join(".gitattributes"), b"*.bin -filter\n").unwrap();
    assert!(checkout_lfs_object(path, &preview, &CancellationToken::default()).is_err());
    fs::write(
        path.join(".gitattributes"),
        b"*.bin filter=lfs diff=lfs merge=lfs -text\n",
    )
    .unwrap();
    let preview = preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).unwrap();
    run_mutation(
        path,
        &["symbolic-ref", "HEAD", "refs/heads/other"],
        "change branch identity",
    )
    .unwrap();
    assert_eq!(
        checkout_lfs_object(path, &preview, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "staleLfsCheckout"
    );
    assert_eq!(fs::read(path.join(&preview.file)).unwrap(), pointer);
}

#[cfg(unix)]
#[test]
#[ignore = "requires Git LFS with pointer and env commands; run with --ignored"]
fn lfs_checkout_refuses_symlink_working_and_cache_paths_and_preserves_executable_permissions() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = lfs_hydration_pointer(&repository);
    let pointer = fs::read(path.join(&preview.file)).unwrap();
    let target = path.join(&preview.file);
    fs::remove_file(&target).unwrap();
    fs::write(path.join("private"), &pointer).unwrap();
    symlink("../private", &target).unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    fs::remove_file(&target).unwrap();
    fs::write(&target, &pointer).unwrap();
    let cache = lfs_cache_path(&repository, &preview.oid);
    let bytes = fs::read(&cache).unwrap();
    fs::remove_file(&cache).unwrap();
    fs::write(path.join("private"), &bytes).unwrap();
    symlink(path.join("private"), &cache).unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    fs::remove_file(&cache).unwrap();
    fs::write(&cache, &bytes).unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
    let preview = preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).unwrap();
    checkout_lfs_object(path, &preview, &CancellationToken::default()).unwrap();
    assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o755
    );
    assert_eq!(fs::read(&target).unwrap(), bytes);
}

#[test]
#[ignore = "requires Git LFS with pointer and env commands; run with --ignored"]
fn lfs_checkout_refuses_missing_cache_unmerged_and_nonordinary_index_entries_without_replacement() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = lfs_hydration_pointer(&repository);
    let pointer = fs::read(path.join(&preview.file)).unwrap();
    let cache = lfs_cache_path(&repository, &preview.oid);
    let contents = fs::read(&cache).unwrap();
    fs::remove_file(&cache).unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    assert_eq!(fs::read(path.join(&preview.file)).unwrap(), pointer);
    fs::write(&cache, contents).unwrap();
    let blob = run_git(path, &["rev-parse", &format!(":{}", preview.file)])
        .unwrap()
        .stdout;
    let blob = std::str::from_utf8(&blob).unwrap().trim();
    run_mutation(
        path,
        &[
            "update-index",
            "--cacheinfo",
            &format!("120000,{blob},{}", preview.file),
        ],
        "set symlink index fixture",
    )
    .unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    let input = format!(
        "0 {}\t{}\n100644 {blob} 1\t{}\n100644 {blob} 2\t{}\n",
        "0".repeat(40),
        preview.file,
        preview.file,
        preview.file
    );
    run_git_with_input(
        path,
        &["update-index", "--index-info"],
        input.as_bytes(),
        "set unmerged fixture",
    )
    .unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    assert!(preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size).is_err());
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(&preview.file)).unwrap(), pointer);
}

#[test]
#[ignore = "requires Git LFS with pointer and env commands; run with --ignored"]
fn lfs_checkout_active_cancellation_cleans_owned_copy_and_retains_working_pointer() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let name = "assets/large.bin";
    fs::File::create(path.join(name))
        .unwrap()
        .set_len(64 * 1024 * 1024)
        .unwrap();
    stage_path(path, name).unwrap();
    let file = lfs_objects(path)
        .unwrap()
        .files
        .into_iter()
        .find(|file| file.name == name)
        .unwrap();
    let pointer = run_git(path, &["show", &format!(":{name}")])
        .unwrap()
        .stdout;
    fs::write(path.join(name), &pointer).unwrap();
    let preview = preview_lfs_checkout(path, name, &file.oid, file.size).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let cancellation = CancellationToken::default();
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| checkout_lfs_object(path, &preview, &cancellation));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if fs::read_dir(path.join("assets")).unwrap().any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".chronos-lfs-")
            }) {
                cancellation.cancel();
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "hydration did not create its owned temporary copy"
            );
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert_eq!(
            worker.join().unwrap().unwrap_err().kind,
            "operationCancelled"
        );
    });
    assert_eq!(fs::read(path.join(name)).unwrap(), pointer);
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert!(!fs::read_dir(path.join("assets")).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".chronos-lfs-")
    }));
}

fn lfs_cache_path(repository: &Repository, oid: &str) -> PathBuf {
    repository.0.join(format!(
        ".git/custom-lfs/objects/{}/{}/{oid}",
        &oid[..2],
        &oid[2..4]
    ))
}

fn selected_lfs_fetch(repository: &Repository) -> LfsFetchPreview {
    let objects = lfs_objects(&repository.0).unwrap();
    let file = objects
        .files
        .iter()
        .find(|file| file.name == "assets/space file.bin")
        .unwrap();
    preview_lfs_fetch(&repository.0, &file.name, "origin", &file.oid, file.size).unwrap()
}

#[test]
#[ignore = "requires Git LFS with local standalone-file transfers; run with --ignored"]
fn lfs_fetch_downloads_only_reviewed_head_object_preserving_dirty_files_index_refs_and_config() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = selected_lfs_fetch(&repository);
    let objects = lfs_objects(path).unwrap();
    for file in &objects.files {
        fs::remove_file(lfs_cache_path(&repository, &file.oid)).unwrap();
    }
    let historic = run_git(path, &["show", "HEAD~:assets/space file.bin"])
        .unwrap()
        .stdout;
    let previous_oid = std::str::from_utf8(&historic)
        .unwrap()
        .lines()
        .find_map(|line| line.strip_prefix("oid sha256:"))
        .unwrap();
    fs::remove_file(lfs_cache_path(&repository, previous_oid)).unwrap();
    let pointer = run_git(path, &["show", "HEAD:assets/space file.bin"])
        .unwrap()
        .stdout;
    fs::write(path.join("assets/space file.bin"), &pointer).unwrap();
    fs::write(path.join("nested/space file.bin"), b"dirty unselected\n").unwrap();
    fs::write(path.join("file"), b"staged ordinary changes\n").unwrap();
    stage_path(path, "file").unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let config = fs::read(path.join(".git/config")).unwrap();
    let refs = run_git(path, &["show-ref"]).unwrap().stdout;
    let cancellation = CancellationToken::default();
    authentication::with_authentication(
        &std::env::current_exe().unwrap(),
        &cancellation,
        Some(std::sync::Arc::new(|_| None)),
        || fetch_lfs_object(path, &preview, &cancellation),
    )
    .unwrap();
    assert_eq!(
        fs::read(lfs_cache_path(&repository, &preview.oid)).unwrap(),
        b"selected current object\n"
    );
    assert!(!lfs_cache_path(&repository, previous_oid).exists());
    let other = objects
        .files
        .iter()
        .find(|file| file.name.starts_with("nested/"))
        .unwrap();
    assert!(!lfs_cache_path(&repository, &other.oid).exists());
    assert_eq!(
        fs::read(path.join("assets/space file.bin")).unwrap(),
        pointer
    );
    assert_eq!(
        fs::read(path.join("nested/space file.bin")).unwrap(),
        b"dirty unselected\n"
    );
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(path.join(".git/config")).unwrap(), config);
    assert_eq!(run_git(path, &["show-ref"]).unwrap().stdout, refs);
    assert_eq!(
        fs::read(path.join("shared-hooks/pre-push")).unwrap(),
        b"# fixture hook, not an LFS hook\n"
    );
    assert_eq!(fs::read_dir(path.join("shared-hooks")).unwrap().count(), 1);
}

#[test]
#[ignore = "requires Git LFS with local standalone-file transfers; run with --ignored"]
fn lfs_fetch_sparse_excluded_object_does_not_hydrate_or_expand_index() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    run_mutation(
        path,
        &["sparse-checkout", "set", "--cone", "--sparse-index", "code"],
        "exclude assets",
    )
    .unwrap();
    let preview = selected_lfs_fetch(&repository);
    fs::remove_file(lfs_cache_path(&repository, &preview.oid)).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let head = repository.oid();
    fetch_lfs_object(path, &preview, &CancellationToken::default()).unwrap();
    assert!(lfs_cache_path(&repository, &preview.oid).exists());
    assert!(!path.join("assets").exists());
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(repository.oid(), head);
}

#[test]
#[ignore = "requires Git LFS with local standalone-file transfers; run with --ignored"]
fn lfs_fetch_refuses_stale_head_settings_and_staged_only_objects_before_transfer() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = selected_lfs_fetch(&repository);
    fs::remove_file(lfs_cache_path(&repository, &preview.oid)).unwrap();
    // Keep a pointer so subsequent Git refreshes cannot recache hydrated working bytes.
    let pointer = run_git(path, &["show", "HEAD:assets/space file.bin"])
        .unwrap()
        .stdout;
    fs::write(path.join(&preview.file), pointer).unwrap();
    run_mutation(
        path,
        &["config", "remote.origin.url", "missing.git"],
        "change destination",
    )
    .unwrap();
    assert_eq!(
        fetch_lfs_object(path, &preview, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "staleLfsFetch"
    );
    assert!(!lfs_cache_path(&repository, &preview.oid).exists());
    run_mutation(
        path,
        &[
            "config",
            "remote.origin.url",
            path.join("origin.git").to_str().unwrap(),
        ],
        "restore destination",
    )
    .unwrap();
    let fresh = selected_lfs_fetch(&repository);
    fs::write(
        path.join(".lfsconfig"),
        b"[lfs]\n\turl = https://changed.invalid/lfs\n",
    )
    .unwrap();
    assert_eq!(
        fetch_lfs_object(path, &fresh, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "staleLfsFetch"
    );
    assert!(!lfs_cache_path(&repository, &preview.oid).exists());
    fs::remove_file(path.join(".lfsconfig")).unwrap();
    run_mutation(
        path,
        &[
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "--allow-empty",
            "-m",
            "Changed HEAD",
        ],
        "advance HEAD",
    )
    .unwrap();
    assert!(!lfs_cache_path(&repository, &preview.oid).exists());
    assert_eq!(
        fetch_lfs_object(path, &fresh, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "staleLfsFetch"
    );
    assert!(!lfs_cache_path(&repository, &preview.oid).exists());
    fs::write(
        path.join("assets/space file.bin"),
        b"staged different object\n",
    )
    .unwrap();
    stage_path(path, "assets/space file.bin").unwrap();
    let staged = lfs_objects(path).unwrap();
    let file = staged
        .files
        .iter()
        .find(|file| file.name.starts_with("assets/"))
        .unwrap();
    assert_eq!(
        preview_lfs_fetch(path, &file.name, "origin", &file.oid, file.size)
            .unwrap_err()
            .kind,
        "stagedLfsObjectNotFetchable"
    );
    assert!(!lfs_cache_path(&repository, &preview.oid).exists());
}

#[test]
#[ignore = "requires Git LFS with local standalone-file transfers; run with --ignored"]
fn lfs_fetch_missing_server_object_fails_and_retry_and_cancellation_are_explicit() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let preview = selected_lfs_fetch(&repository);
    fs::remove_file(lfs_cache_path(&repository, &preview.oid)).unwrap();
    let cancellation = CancellationToken::default();
    cancellation.cancel();
    assert_eq!(
        fetch_lfs_object(path, &preview, &cancellation)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
    assert!(!lfs_cache_path(&repository, &preview.oid).exists());
    let cache = path.join(format!(
        "origin.git/lfs/objects/{}/{}/{}",
        &preview.oid[..2],
        &preview.oid[2..4],
        preview.oid
    ));
    let bytes = fs::read(&cache).unwrap();
    fs::remove_file(&cache).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    let working = fs::read(path.join("assets/space file.bin")).unwrap();
    let error = fetch_lfs_object(path, &preview, &CancellationToken::default()).unwrap_err();
    assert!(error.hint.unwrap().contains("review and retry"));
    assert!(!lfs_cache_path(&repository, &preview.oid).exists());
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(path.join("assets/space file.bin")).unwrap(),
        working
    );
    fs::write(&cache, bytes).unwrap();
    let preview = selected_lfs_fetch(&repository);
    fetch_lfs_object(path, &preview, &CancellationToken::default()).unwrap();
    assert!(lfs_cache_path(&repository, &preview.oid).exists());
}

#[test]
#[ignore = "requires Git LFS with local standalone-file transfers; run with --ignored"]
fn lfs_fetch_option_looking_literal_name_is_not_an_option_or_a_wider_filter() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    fs::write(
        path.join("-leading.bin"),
        b"literal option-looking object\n",
    )
    .unwrap();
    stage_path(path, "-leading.bin").unwrap();
    commit(path, "Option-looking LFS path").unwrap();
    run_mutation(
        path,
        &["lfs", "push", "origin", "HEAD"],
        "publish LFS object",
    )
    .unwrap();
    let objects = lfs_objects(path).unwrap();
    let file = objects
        .files
        .iter()
        .find(|file| file.name == "-leading.bin")
        .unwrap();
    let preview = preview_lfs_fetch(path, &file.name, "origin", &file.oid, file.size).unwrap();
    fs::remove_file(lfs_cache_path(&repository, &file.oid)).unwrap();
    let index = fs::read(path.join(".git/index")).unwrap();
    fetch_lfs_object(path, &preview, &CancellationToken::default()).unwrap();
    assert_eq!(
        fs::read(lfs_cache_path(&repository, &file.oid)).unwrap(),
        b"literal option-looking object\n"
    );
    assert_eq!(fs::read(path.join(".git/index")).unwrap(), index);
}

#[test]
#[ignore = "requires Git LFS with local standalone-file transfers; run with --ignored"]
fn lfs_fetch_does_not_search_other_remotes_when_selected_remote_lacks_object() {
    let repository = lfs_fetch_fixture();
    let path = &repository.0;
    let backup = path.join("backup.git");
    run_mutation(
        path,
        &["init", "--bare", backup.to_str().unwrap()],
        "create backup",
    )
    .unwrap();
    run_mutation(
        path,
        &["remote", "add", "backup", backup.to_str().unwrap()],
        "add backup",
    )
    .unwrap();
    run_mutation(
        path,
        &["lfs", "push", "backup", "HEAD"],
        "publish backup objects",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "lfs.remote.searchall", "true"],
        "enable remote fallback",
    )
    .unwrap();
    run_mutation(
        path,
        &["config", "lfs.remote.autodetect", "true"],
        "enable autodetection",
    )
    .unwrap();
    let preview = selected_lfs_fetch(&repository);
    fs::remove_file(lfs_cache_path(&repository, &preview.oid)).unwrap();
    let server_object = path.join(format!(
        "origin.git/lfs/objects/{}/{}/{}",
        &preview.oid[..2],
        &preview.oid[2..4],
        preview.oid
    ));
    fs::remove_file(server_object).unwrap();
    assert!(fetch_lfs_object(path, &preview, &CancellationToken::default()).is_err());
    assert!(!lfs_cache_path(&repository, &preview.oid).exists());
    let backup =
        preview_lfs_fetch(path, &preview.file, "backup", &preview.oid, preview.size).unwrap();
    fetch_lfs_object(path, &backup, &CancellationToken::default()).unwrap();
    assert!(lfs_cache_path(&repository, &preview.oid).exists());
    assert_eq!(
        run_git(path, &["config", "--get", "lfs.remote.searchall"])
            .unwrap()
            .stdout,
        b"true\n"
    );
}

#[test]
#[ignore = "requires Git LFS with ls-files --json; run with --ignored"]
fn lfs_objects_empty_unborn_scope_keeps_configured_hooks_untouched() {
    let repository = Repository::new();
    let hooks = repository.0.join("shared-hooks");
    fs::create_dir(&hooks).unwrap();
    fs::write(hooks.join("pre-push"), b"# unrelated hook\n").unwrap();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
        "set hook fixture",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["checkout", "--orphan", "unborn"],
        "unborn fixture",
    )
    .unwrap();
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    assert!(lfs_objects(&repository.0).unwrap().files.is_empty());
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(hooks.join("pre-push")).unwrap(),
        b"# unrelated hook\n"
    );
    assert_eq!(fs::read_dir(&hooks).unwrap().count(), 1);
}

#[test]
#[ignore = "requires Git LFS with ls-files --json; run with --ignored"]
fn lfs_objects_scope_keeps_index_precedence_and_sparse_paths_without_hydrating() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    initialize_lfs(&repository.0).unwrap();
    track_lfs_pattern(&repository.0, "*.bin", false).unwrap();
    fs::create_dir(repository.0.join("assets")).unwrap();
    fs::create_dir(repository.0.join("code")).unwrap();
    fs::write(repository.0.join("assets/file.bin"), b"original\n").unwrap();
    fs::write(repository.0.join("code/file"), b"code\n").unwrap();
    stage_path(&repository.0, "assets/file.bin").unwrap();
    stage_path(&repository.0, ".gitattributes").unwrap();
    stage_path(&repository.0, "code/file").unwrap();
    commit(&repository.0, "LFS scope").unwrap();
    let original = lfs_objects(&repository.0).unwrap().files[0].oid.clone();
    fs::write(repository.0.join("assets/file.bin"), b"changed\n").unwrap();
    stage_path(&repository.0, "assets/file.bin").unwrap();
    let staged = lfs_objects(&repository.0).unwrap();
    assert_eq!(staged.files.len(), 1);
    assert_ne!(staged.files[0].oid, original);
    assert_eq!(staged.files[0].size, 8);
    run_mutation(
        &repository.0,
        &["rm", "--cached", "-f", "--", "assets/file.bin"],
        "remove index fixture",
    )
    .unwrap();
    assert_eq!(lfs_objects(&repository.0).unwrap().files[0].oid, original);
    stage_path(&repository.0, "assets/file.bin").unwrap();
    commit(&repository.0, "Updated LFS scope").unwrap();
    run_mutation(
        &repository.0,
        &["sparse-checkout", "set", "--cone", "--sparse-index", "code"],
        "exclude LFS fixture",
    )
    .unwrap();
    assert!(!repository.0.join("assets/file.bin").exists());
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    let head = repository.oid();
    let objects = lfs_objects(&repository.0).unwrap();
    assert_eq!(objects.files.len(), 1);
    assert_eq!(objects.files[0].working_state, "missing");
    assert!(objects.files[0].downloaded);
    assert!(!repository.0.join("assets").exists());
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(repository.oid(), head);
}

#[cfg(unix)]
#[test]
#[ignore = "requires Git LFS with ls-files --json; run with --ignored"]
fn lfs_objects_do_not_follow_symlink_working_paths() {
    use std::os::unix::fs::symlink;
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    initialize_lfs(&repository.0).unwrap();
    track_lfs_pattern(&repository.0, "*.bin", false).unwrap();
    fs::create_dir(repository.0.join("nested")).unwrap();
    fs::write(repository.0.join("nested/file.bin"), b"object\n").unwrap();
    stage_path(&repository.0, "nested/file.bin").unwrap();
    fs::remove_file(repository.0.join("nested/file.bin")).unwrap();
    fs::write(repository.0.join("target"), b"private target\n").unwrap();
    symlink("../target", repository.0.join("nested/file.bin")).unwrap();
    assert_eq!(
        lfs_objects(&repository.0).unwrap().files[0].working_state,
        "symlink"
    );
    fs::remove_file(repository.0.join("nested/file.bin")).unwrap();
    fs::remove_dir(repository.0.join("nested")).unwrap();
    symlink(".", repository.0.join("nested")).unwrap();
    assert_eq!(
        lfs_objects(&repository.0).unwrap().files[0].working_state,
        "symlink"
    );
    assert_eq!(
        fs::read(repository.0.join("target")).unwrap(),
        b"private target\n"
    );
}

#[test]
fn lfs_attributes_resolve_macros_external_and_info_precedence_in_both_views() {
    let repository = Repository::new();
    let external = repository.0.join("external-attributes");
    fs::write(&external, b"*.chrasset filter=external diff=external\n").unwrap();
    run_mutation(
        &repository.0,
        &["config", "core.attributesFile", external.to_str().unwrap()],
        "set external fixture attributes",
    )
    .unwrap();
    let attrs = lfs_file_attributes(&repository.0, "file.chrasset").unwrap();
    assert_eq!(attrs.attributes[0].working, "external");
    assert_eq!(attrs.attributes[0].index, "external");
    fs::write(
        repository.0.join(".gitattributes"),
        b"[attr]large filter=lfs diff=lfs merge=lfs -text lockable\n*.chrasset large\n",
    )
    .unwrap();
    stage_path(&repository.0, ".gitattributes").unwrap();
    let attrs = lfs_file_attributes(&repository.0, "file.chrasset").unwrap();
    assert_eq!(attrs.attributes[0].working, "lfs");
    assert_eq!(attrs.attributes[0].index, "lfs");
    assert_eq!(attrs.attributes[4].working, "set");
    fs::write(
        repository.0.join(".git/info/attributes"),
        b"*.chrasset !filter -lockable diff=info\n",
    )
    .unwrap();
    let attrs = lfs_file_attributes(&repository.0, "file.chrasset").unwrap();
    for value in attrs
        .attributes
        .iter()
        .filter(|value| value.name == "filter")
    {
        assert_eq!(value.working, "unspecified");
        assert_eq!(value.index, "unspecified");
    }
    assert_eq!(attrs.attributes[1].working, "info");
    assert_eq!(attrs.attributes[1].index, "info");
    assert_eq!(attrs.attributes[4].working, "unset");
    assert_eq!(attrs.attributes[4].index, "unset");
}

#[test]
fn lfs_attributes_use_literal_paths_and_refuse_unsafe_paths() {
    let repository = Repository::new();
    fs::write(
        repository.0.join(".gitattributes"),
        b"literal.chrasset filter=lfs\n",
    )
    .unwrap();
    let attrs = lfs_file_attributes(&repository.0, "literal.chrasset").unwrap();
    assert_eq!(attrs.attributes[0].working, "lfs");
    assert_eq!(
        lfs_file_attributes(&repository.0, "*.chrasset")
            .unwrap()
            .attributes[0]
            .working,
        "unspecified"
    );
    assert_eq!(
        lfs_file_attributes(&repository.0, "-file.chrasset")
            .unwrap()
            .attributes[0]
            .working,
        "unspecified"
    );
    for value in [
        "",
        "../file",
        "/file",
        "dir/../file",
        ".git/config",
        "dir/.GIT/config",
        "file\n",
        "\0",
        " leading",
        "trailing ",
    ] {
        assert_eq!(
            lfs_file_attributes(&repository.0, value).unwrap_err().kind,
            "invalidAttributePath"
        );
    }
    assert_eq!(
        lfs_file_attributes(&repository.0, &"a".repeat(4097))
            .unwrap_err()
            .kind,
        "invalidAttributePath"
    );
}

#[test]
fn lfs_attributes_inspect_sparse_excluded_paths_without_hydration_or_index_changes() {
    let repository = Repository::new();
    fs::create_dir(repository.0.join("assets")).unwrap();
    fs::create_dir(repository.0.join("code")).unwrap();
    fs::write(
        repository.0.join("assets/data.chrasset"),
        b"existing contents\n",
    )
    .unwrap();
    fs::write(repository.0.join("code/file"), b"code\n").unwrap();
    stage_path(&repository.0, "assets/data.chrasset").unwrap();
    fs::write(
        repository.0.join("assets/.gitattributes"),
        b"*.chrasset filter=lfs diff=lfs merge=lfs -text\n",
    )
    .unwrap();
    stage_path(&repository.0, "assets/.gitattributes").unwrap();
    stage_path(&repository.0, "code/file").unwrap();
    commit(&repository.0, "Sparse attribute fixture").unwrap();
    run_mutation(
        &repository.0,
        &["sparse-checkout", "set", "--cone", "--sparse-index", "code"],
        "exclude assets fixture",
    )
    .unwrap();
    assert!(!repository.0.join("assets/data.chrasset").exists());
    assert!(!repository.0.join("assets/.gitattributes").exists());
    let index_bytes = fs::read(repository.0.join(".git/index")).unwrap();
    let head = repository.oid();
    match lfs_file_attributes(&repository.0, "assets/data.chrasset") {
        Ok(attrs) => {
            assert_eq!(attrs.attributes[0].working, "lfs");
            assert_eq!(attrs.attributes[0].index, "lfs");
        }
        Err(error) => {
            assert_eq!(error.kind, "sparseAttributesUnreadable");
            assert!(error.message.contains("assets/.gitattributes"), "{error:?}");
            assert!(!version_at_least(
                detect_git().version.as_deref().unwrap(),
                "2.43.0"
            ));
        }
    }
    assert_eq!(
        fs::read(repository.0.join(".git/index")).unwrap(),
        index_bytes
    );
    assert_eq!(repository.oid(), head);
    assert!(!repository.0.join("assets").exists());
}

#[test]
#[ignore = "requires Git LFS with track --json; run with --ignored"]
fn lfs_tracking_untrack_rejects_changed_working_index_branch_and_unknown_selection() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    track_lfs_pattern(&repository.0, "*.bin", false).unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    let file = repository.0.join(".gitattributes");
    let original = fs::read(&file).unwrap();
    fs::write(&file, [original.as_slice(), b"# external edit\n"].concat()).unwrap();
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "*.bin", &rules.state)
            .unwrap_err()
            .kind,
        "staleLfsAttributes"
    );
    fs::write(&file, &original).unwrap();
    stage_path(&repository.0, ".gitattributes").unwrap();
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "*.bin", &rules.state)
            .unwrap_err()
            .kind,
        "staleLfsAttributes"
    );
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "*.missing", &rules.state)
            .unwrap_err()
            .kind,
        "unknownLfsTrackingPattern"
    );
    run_mutation(&repository.0, &["switch", "-c", "other"], "change branch").unwrap();
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "*.bin", &rules.state)
            .unwrap_err()
            .kind,
        "staleLfsAttributes"
    );
    assert_eq!(fs::read(&file).unwrap(), original);
    for pattern in ["--all", "", "\0", "*.bin\n"] {
        assert_eq!(
            untrack_lfs_pattern(&repository.0, pattern, &rules.state)
                .unwrap_err()
                .kind,
            "invalidLfsPattern"
        );
    }
}

#[test]
#[ignore = "requires Git LFS with track --json; run with --ignored"]
fn lfs_tracking_refuses_unsafe_attribute_files_and_nested_only_untrack() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    fs::create_dir(repository.0.join("nested")).unwrap();
    fs::write(
        repository.0.join("nested/.gitattributes"),
        b"*.bin filter=lfs diff=lfs merge=lfs -text\n",
    )
    .unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    assert!(rules.root_attributes.is_none());
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "*.bin", &rules.state)
            .unwrap_err()
            .kind,
        "unknownLfsTrackingPattern"
    );
    let root = repository.0.join(".gitattributes");
    for bytes in [
        b"\0".as_slice(),
        b"\xff",
        &vec![b'a'; MAX_FILE_DIFF_BYTES + 1],
    ] {
        fs::write(&root, bytes).unwrap();
        assert_eq!(
            lfs_tracking_rules(&repository.0).unwrap_err().kind,
            "lfsAttributesUnavailable"
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        fs::remove_file(&root).unwrap();
        symlink("nested/.gitattributes", &root).unwrap();
        assert_eq!(
            lfs_tracking_rules(&repository.0).unwrap_err().kind,
            "lfsAttributesUnavailable"
        );
        assert_eq!(
            fs::read(repository.0.join("nested/.gitattributes")).unwrap(),
            b"*.bin filter=lfs diff=lfs merge=lfs -text\n"
        );
    }
}

#[test]
#[ignore = "requires Git LFS with track --json; run with --ignored"]
fn lfs_tracking_untrack_works_in_unborn_repo_and_preserves_other_attributes() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["checkout", "--orphan", "unborn"],
        "unborn fixture",
    )
    .unwrap();
    track_lfs_pattern(&repository.0, "*.bin", false).unwrap();
    let root = repository.0.join(".gitattributes");
    let mut contents = fs::read(&root).unwrap();
    contents.extend_from_slice(b"*.txt text eol=lf\n# preserve comment\n");
    fs::write(&root, contents).unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    untrack_lfs_pattern(&repository.0, "*.bin", &rules.state).unwrap();
    assert_eq!(
        fs::read(&root).unwrap(),
        b"*.txt text eol=lf\n# preserve comment\n"
    );
}

#[test]
#[ignore = "requires Git LFS with track --json; run with --ignored"]
fn lfs_tracking_untrack_leaves_staged_attributes_and_lockable_file_modes_unchanged() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    fs::write(repository.0.join("image.psd"), b"image bytes\n").unwrap();
    track_lfs_pattern(&repository.0, "*.psd", true).unwrap();
    let attributes = repository.0.join(".gitattributes");
    let mut contents = fs::read(&attributes).unwrap();
    contents.extend_from_slice(b"*.txt text eol=lf\n# other attributes\n");
    fs::write(&attributes, contents).unwrap();
    stage_path(&repository.0, ".gitattributes").unwrap();
    let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    #[cfg(unix)]
    let image_mode = {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(repository.0.join("image.psd"))
            .unwrap()
            .permissions()
            .mode()
    };
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    untrack_lfs_pattern(&repository.0, "*.psd", &rules.state).unwrap();
    assert_eq!(
        run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
    assert_eq!(
        fs::read(&attributes).unwrap(),
        b"*.txt text eol=lf\n# other attributes\n"
    );
    assert_eq!(
        fs::read(repository.0.join("image.psd")).unwrap(),
        b"image bytes\n"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(repository.0.join("image.psd"))
                .unwrap()
                .permissions()
                .mode(),
            image_mode
        );
    }
}

#[test]
#[ignore = "requires Git LFS with track --json; run with --ignored"]
fn lfs_tracking_untrack_refuses_unmerged_attributes_without_changing_working_or_index() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    track_lfs_pattern(&repository.0, "*.bin", false).unwrap();
    let oid = String::from_utf8(
        run_git(&repository.0, &["rev-parse", "HEAD:file"])
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();
    run_git_with_input(
        &repository.0,
        &["update-index", "--index-info"],
        format!("100644 {oid} 2\t.gitattributes\n100644 {oid} 3\t.gitattributes\n").as_bytes(),
        "seed attribute conflict",
    )
    .unwrap();
    let attributes = fs::read(repository.0.join(".gitattributes")).unwrap();
    let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "*.bin", &rules.state)
            .unwrap_err()
            .kind,
        "conflictedLfsAttributes"
    );
    assert_eq!(
        fs::read(repository.0.join(".gitattributes")).unwrap(),
        attributes
    );
    assert_eq!(
        run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        index
    );
}

#[test]
#[ignore = "requires Git LFS with track --json; run with --ignored"]
fn lfs_tracking_never_installs_or_replaces_configured_hooks_and_rejects_long_lines() {
    let repository = Repository::new();
    let hooks = repository.0.join("shared-hooks");
    fs::create_dir(&hooks).unwrap();
    fs::write(hooks.join("pre-push"), b"# user's unrelated hook\n").unwrap();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
        "set hook fixture",
    )
    .unwrap();
    let attributes = repository.0.join(".gitattributes");
    fs::write(&attributes, b"*.bin filter=lfs diff=lfs merge=lfs -text\n").unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    untrack_lfs_pattern(&repository.0, "*.bin", &rules.state).unwrap();
    assert_eq!(
        fs::read(hooks.join("pre-push")).unwrap(),
        b"# user's unrelated hook\n"
    );
    assert_eq!(fs::read_dir(&hooks).unwrap().count(), 1);
    assert_eq!(
        String::from_utf8(
            run_git(&repository.0, &["config", "--get", "core.hooksPath"])
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim(),
        hooks.to_str().unwrap()
    );
    fs::write(
        &attributes,
        [
            vec![b'#'; 64 * 1024],
            b"\n*.bin filter=lfs diff=lfs merge=lfs -text\n".to_vec(),
        ]
        .concat(),
    )
    .unwrap();
    let before = fs::read(&attributes).unwrap();
    assert_eq!(
        lfs_tracking_rules(&repository.0).unwrap_err().kind,
        "lfsAttributesUnavailable"
    );
    assert_eq!(fs::read(&attributes).unwrap(), before);
    assert_eq!(fs::read_dir(&hooks).unwrap().count(), 1);
}

#[test]
#[ignore = "requires Git LFS with track --json; run with --ignored"]
fn lfs_tracking_untrack_verifies_other_attributes_and_refuses_macro_and_substring_rules() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS fixture hooks",
    )
    .unwrap();
    let attributes = repository.0.join(".gitattributes");
    fs::write(&attributes, b"# preserve\r\n*.bin filter=lfs diff=lfs merge=lfs -text custom=value\r\n\r\n*.txt text eol=lf\r\n*.bin other=value\r\n").unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    untrack_lfs_pattern(&repository.0, "*.bin", &rules.state).unwrap();
    assert_eq!(
        fs::read(&attributes).unwrap(),
        b"# preserve\n\n*.txt text eol=lf\n*.bin other=value\n"
    );

    fs::write(
        &attributes,
        b"*.bin filter=lfs diff=lfs merge=lfs -text\n*.bin custom=filter=lfs\n",
    )
    .unwrap();
    let original = fs::read(&attributes).unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "*.bin", &rules.state)
            .unwrap_err()
            .kind,
        "unsupportedLfsTrackingRule"
    );
    assert_eq!(fs::read(&attributes).unwrap(), original);

    fs::write(
        &attributes,
        b"[attr]large filter=lfs diff=lfs merge=lfs -text\n*.bin large\n",
    )
    .unwrap();
    let original = fs::read(&attributes).unwrap();
    let rules = lfs_tracking_rules(&repository.0).unwrap();
    assert!(
        rules
            .patterns
            .iter()
            .any(|rule| rule.pattern == "*.bin" && rule.tracked)
    );
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "[attr]large", &rules.state)
            .unwrap_err()
            .kind,
        "unsupportedLfsTrackingRule"
    );
    assert_eq!(
        untrack_lfs_pattern(&repository.0, "*.bin", &rules.state)
            .unwrap_err()
            .kind,
        "unsupportedLfsTrackingRule"
    );
    assert_eq!(fs::read(&attributes).unwrap(), original);
}

#[test]
fn operation_recovery_reset_modes_restore_exact_index_and_worktree_after_restart() {
    for mode in ["soft", "mixed", "hard"] {
        let repository = Repository::new();
        let base = repository.oid();
        fs::write(repository.0.join("file"), b"second\n").unwrap();
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Second").unwrap();
        let head = repository.oid();
        fs::write(repository.0.join("file"), b"staged\n").unwrap();
        fs::write(repository.0.join("empty"), b"").unwrap();
        stage_all(&repository.0).unwrap();
        fs::write(repository.0.join("file"), b"working\n").unwrap();
        fs::write(repository.0.join("binary"), b"\0\xffunstaged").unwrap();
        stage_path(&repository.0, "binary").unwrap();
        fs::write(repository.0.join("binary"), b"\0\xfeworktree").unwrap();
        fs::write(repository.0.join("untracked"), b"never discarded").unwrap();
        let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout;
        let plan = prepare_reset(&repository.0, &base, mode).unwrap();
        assert_eq!(plan.preview.head_oid, head);
        if mode == "soft" {
            assert!(plan.preview.paths.is_empty());
        } else {
            assert!(plan.preview.paths.contains(&"file".into()));
        }
        let record = execute_reset(&repository.0, &plan).unwrap();
        assert_eq!(repository.oid(), base);
        assert_eq!(
            fs::read(repository.0.join("untracked")).unwrap(),
            b"never discarded"
        );
        assert_eq!(
            operation_recoveries(&repository.0).unwrap()[0].id,
            record.id
        );
        assert!(read_stashes(&repository.0).unwrap().is_empty());
        if mode == "hard" {
            assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"base\n");
            assert!(!repository.0.join("empty").exists());
        }
        // Clear current changes explicitly, then recover on a separate branch from persisted data.
        run_mutation(
            &repository.0,
            &["reset", "--hard", &base],
            "clear test changes",
        )
        .unwrap();
        fs::remove_file(repository.0.join("untracked")).unwrap();
        for file in ["empty", "binary"] {
            if repository.0.join(file).exists() {
                fs::remove_file(repository.0.join(file)).unwrap();
            }
        }
        run_mutation(
            &repository.0,
            &["gc", "--prune=now"],
            "test protected captures",
        )
        .unwrap();
        restore_operation_branch(&repository.0, &record.id, "recovered").unwrap();
        assert_eq!(repository.oid(), head);
        assert_eq!(
            run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            index
        );
        assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"working\n");
        assert_eq!(
            fs::read(repository.0.join("binary")).unwrap(),
            b"\0\xfeworktree"
        );
        assert_eq!(fs::read(repository.0.join("empty")).unwrap(), b"");
        assert!(operation_recoveries(&repository.0).unwrap()[0].restored);
        assert!(record.snapshot_oid.is_some());
        delete_operation_recovery(&repository.0, &record.id).unwrap();
        assert!(operation_recoveries(&repository.0).unwrap().is_empty());
        assert_eq!(repository.oid(), head);
        assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"working\n");
    }
}

#[test]
fn operation_recovery_reset_rejects_stale_head_branch_index_worktree_and_untracked_state() {
    for change in ["head", "branch", "index", "worktree", "untracked"] {
        let repository = Repository::new();
        let oid = repository.oid();
        let plan = prepare_reset(&repository.0, &oid, "hard").unwrap();
        match change {
            "head" => {
                run_mutation(
                    &repository.0,
                    &["commit", "--allow-empty", "-m", "Moved"],
                    "advance HEAD",
                )
                .unwrap();
            }
            "branch" => {
                run_mutation(&repository.0, &["switch", "-c", "other"], "change branch").unwrap();
            }
            "index" => {
                fs::write(repository.0.join("file"), b"staged").unwrap();
                stage_all(&repository.0).unwrap();
            }
            "worktree" => fs::write(repository.0.join("file"), b"working").unwrap(),
            _ => fs::write(repository.0.join("new"), b"new").unwrap(),
        }
        let current_head = repository.oid();
        let current_file = fs::read(repository.0.join("file")).unwrap();
        assert_eq!(
            execute_reset(&repository.0, &plan).unwrap_err().kind,
            "staleReset",
            "{change}"
        );
        assert_eq!(repository.oid(), current_head);
        assert_eq!(fs::read(repository.0.join("file")).unwrap(), current_file);
        assert!(operation_recoveries(&repository.0).unwrap().is_empty());
    }
}

#[test]
fn operation_recovery_hard_reset_refuses_untracked_ignored_and_nested_obstructions() {
    for parent in [false, true] {
        let repository = Repository::new();
        let base = repository.oid();
        let file = if parent { "folder/file" } else { "blocked" };
        if parent {
            fs::create_dir(repository.0.join("folder")).unwrap();
        }
        fs::write(repository.0.join(file), b"committed").unwrap();
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Destination").unwrap();
        let destination = repository.oid();
        run_mutation(&repository.0, &["reset", "--hard", &base], "return fixture").unwrap();
        let blocked = if parent { "folder" } else { "blocked" };
        fs::write(repository.0.join(blocked), b"local").unwrap();
        for ignored in [false, true] {
            if ignored {
                fs::write(
                    repository.0.join(".git/info/exclude"),
                    format!("{blocked}\n"),
                )
                .unwrap();
            }
            let error = prepare_reset(&repository.0, &destination, "hard")
                .err()
                .unwrap();
            assert_eq!(error.kind, "resetPathObstruction");
            assert_eq!(fs::read(repository.0.join(blocked)).unwrap(), b"local");
            assert_eq!(repository.oid(), base);
        }
    }
    let repository = Repository::new();
    let base = repository.oid();
    fs::create_dir(repository.0.join("nested")).unwrap();
    fs::write(repository.0.join("nested/file"), b"committed").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Destination").unwrap();
    let target = repository.oid();
    run_mutation(&repository.0, &["reset", "--hard", &base], "return fixture").unwrap();
    fs::create_dir(repository.0.join("nested")).unwrap();
    run_mutation(
        &repository.0,
        &["init", "nested"],
        "create independent nested repository",
    )
    .unwrap();
    fs::write(repository.0.join("nested/local"), b"protected").unwrap();
    assert_eq!(
        prepare_reset(&repository.0, &target, "hard")
            .err()
            .unwrap()
            .kind,
        "resetPathObstruction"
    );
    assert_eq!(
        fs::read(repository.0.join("nested/local")).unwrap(),
        b"protected"
    );
}

#[test]
fn operation_recovery_reset_retains_initialized_submodule_worktree() {
    let repository = Repository::new();
    let child = Repository::new();
    run_mutation(
        &repository.0,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            child.0.to_str().unwrap(),
            "module",
        ],
        "initialize real submodule",
    )
    .unwrap();
    commit(&repository.0, "Submodule").unwrap();
    let with_module = repository.oid();
    fs::write(repository.0.join("module/file"), b"dirty child").unwrap();
    let record = execute_reset(
        &repository.0,
        &prepare_reset(&repository.0, &with_module, "hard").unwrap(),
    )
    .unwrap();
    assert_eq!(
        fs::read(repository.0.join("module/file")).unwrap(),
        b"dirty child"
    );
    // Removing an initialized gitlink is refused, even though recursive reset is disabled.
    let base = run_git(&repository.0, &["rev-parse", "HEAD^"]).unwrap();
    let base = String::from_utf8_lossy(&base.stdout).trim().to_owned();
    assert_eq!(
        prepare_reset(&repository.0, &base, "hard")
            .err()
            .unwrap()
            .kind,
        "resetPathObstruction"
    );
    delete_operation_recovery(&repository.0, &record.id).unwrap();
}

#[test]
fn operation_recovery_capture_failure_prevents_reset_and_preview_includes_index_only_paths() {
    let repository = Repository::new();
    let base = repository.oid();
    run_mutation(
        &repository.0,
        &["commit", "--allow-empty", "-m", "Second"],
        "advance HEAD",
    )
    .unwrap();
    let head = repository.oid();
    fs::write(repository.0.join("file"), b"staged").unwrap();
    stage_all(&repository.0).unwrap();
    fs::write(repository.0.join("file"), b"base\n").unwrap();
    let plan = prepare_reset(&repository.0, &base, "hard").unwrap();
    assert!(plan.preview.paths.contains(&"file".into()));
    let directory = discard::recovery_directory(&repository.0).unwrap();
    fs::write(directory, b"obstruction").unwrap();
    assert!(execute_reset(&repository.0, &plan).is_err());
    assert_eq!(repository.oid(), head);
    assert_eq!(
        run_git(&repository.0, &["show", ":file"]).unwrap().stdout,
        b"staged"
    );
}

#[test]
fn operation_recovery_ref_validation_cleanup_and_independent_entries() {
    let repository = Repository::new();
    let record = preserve_operation(&repository.0, "Original").unwrap();
    let other = preserve_operation(&repository.0, "Other").unwrap();
    run_mutation(
        &repository.0,
        &["commit", "--allow-empty", "-m", "Other HEAD"],
        "advance HEAD",
    )
    .unwrap();
    let head = repository.oid();
    run_mutation(
        &repository.0,
        &["update-ref", &record.head_reference, &head],
        "simulate changed recovery ref",
    )
    .unwrap();
    assert_eq!(
        restore_operation_branch(&repository.0, &record.id, "recovered")
            .unwrap_err()
            .kind,
        "recoveryReferenceChanged"
    );
    assert_eq!(
        delete_operation_recovery(&repository.0, &record.id)
            .unwrap_err()
            .kind,
        "recoveryReferenceChanged"
    );
    assert_eq!(repository.oid(), head);
    run_mutation(
        &repository.0,
        &["update-ref", &record.head_reference, &record.head_oid],
        "repair fixture",
    )
    .unwrap();
    delete_operation_recovery(&repository.0, &record.id).unwrap();
    let entries = operation_recoveries(&repository.0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].id, other.id);
    assert_eq!(repository.oid(), head);
}

#[test]
fn operation_recovery_rejects_tampered_metadata_without_touching_user_refs() {
    let repository = Repository::new();
    let record = preserve_operation(&repository.0, "Original").unwrap();
    let filename = discard::recovery_directory(&repository.0)
        .unwrap()
        .join(format!("{}.json", record.id));
    let mut modified = record.clone();
    modified.head_reference = "refs/heads/main".into();
    fs::write(&filename, serde_json::to_vec(&modified).unwrap()).unwrap();
    assert_eq!(
        delete_operation_recovery(&repository.0, &record.id)
            .unwrap_err()
            .kind,
        "invalidRecoveryMetadata"
    );
    assert_eq!(
        restore_operation_branch(&repository.0, &record.id, "recovered")
            .unwrap_err()
            .kind,
        "invalidRecoveryMetadata"
    );
    assert_eq!(repository.oid(), record.head_oid);
    fs::write(filename, vec![b' '; 65537]).unwrap();
    assert_eq!(
        operation_recoveries(&repository.0).err().unwrap().kind,
        "invalidRecoveryMetadata"
    );
}

#[test]
fn operation_recovery_cleanup_rejects_symbolic_ref_aliases_without_deleting_the_branch() {
    let repository = Repository::new();
    let record = preserve_operation(&repository.0, "Original").unwrap();
    run_mutation(
        &repository.0,
        &["update-ref", "-d", &record.head_reference],
        "replace fixture ref",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["symbolic-ref", &record.head_reference, "refs/heads/main"],
        "simulate aliased recovery ref",
    )
    .unwrap();
    assert_eq!(
        delete_operation_recovery(&repository.0, &record.id)
            .unwrap_err()
            .kind,
        "recoveryReferenceChanged"
    );
    assert_eq!(
        restore_operation_branch(&repository.0, &record.id, "recovered")
            .unwrap_err()
            .kind,
        "recoveryReferenceChanged"
    );
    assert_eq!(repository.oid(), record.head_oid);
    assert!(
        run_git(&repository.0, &["show-ref", "--verify", "refs/heads/main"])
            .unwrap()
            .status
            .success()
    );
}

#[test]
fn operation_recovery_snapshots_do_not_leak_into_graph_pages_or_decorations() {
    let repository = Repository::new();
    fs::write(repository.0.join("file"), b"dirty").unwrap();
    let record = preserve_operation(&repository.0, "Invisible capture").unwrap();
    let snapshot = record.snapshot_oid.unwrap();
    let index = run_git(&repository.0, &["rev-parse", &format!("{snapshot}^2")]).unwrap();
    let index = String::from_utf8_lossy(&index.stdout).trim().to_owned();
    let commits = read_commit_page(&repository.0, 0, 100).unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].oid, repository.oid());
    assert!(!format!("{:?}", commits[0]).contains("git-khronos/recovery"));
    for fallback in [false, true] {
        let mut cursor = CommitHistoryCursor::default();
        cursor.reset(&repository.0, &[]).unwrap();
        if fallback {
            cursor.walk = None;
        }
        let page = cursor.next_page(&repository.0, 100).unwrap();
        assert!(
            page.commits
                .iter()
                .all(|commit| commit.oid != snapshot && commit.oid != index)
        );
    }
}

#[test]
fn operation_recovery_restore_refuses_ignored_snapshot_collisions_before_creating_branch() {
    let repository = Repository::new();
    let oid = repository.oid();
    fs::write(repository.0.join("new"), b"captured").unwrap();
    stage_path(&repository.0, "new").unwrap();
    let record = execute_reset(
        &repository.0,
        &prepare_reset(&repository.0, &oid, "hard").unwrap(),
    )
    .unwrap();
    fs::write(repository.0.join(".git/info/exclude"), b"new\n").unwrap();
    fs::write(repository.0.join("new"), b"ignored work").unwrap();
    assert_eq!(
        restore_operation_branch(&repository.0, &record.id, "recovered")
            .unwrap_err()
            .kind,
        "resetPathObstruction"
    );
    assert_eq!(fs::read(repository.0.join("new")).unwrap(), b"ignored work");
    assert_eq!(repository.oid(), oid);
    assert!(
        !run_git(
            &repository.0,
            &["show-ref", "--verify", "refs/heads/recovered"]
        )
        .unwrap()
        .status
        .success()
    );
    assert!(!operation_recoveries(&repository.0).unwrap()[0].restored);
}

#[test]
fn operation_recovery_cleanup_can_retry_missing_owned_refs_and_keeps_detached_head() {
    let repository = Repository::new();
    run_mutation(&repository.0, &["switch", "--detach"], "detach fixture").unwrap();
    let record = preserve_operation(&repository.0, "Detached history").unwrap();
    run_mutation(
        &repository.0,
        &["update-ref", "-d", &record.head_reference],
        "simulate partially removed capture",
    )
    .unwrap();
    delete_operation_recovery(&repository.0, &record.id).unwrap();
    assert!(operation_recoveries(&repository.0).unwrap().is_empty());
    assert!(
        !run_git(&repository.0, &["symbolic-ref", "--quiet", "HEAD"])
            .unwrap()
            .status
            .success()
    );
}

#[test]
fn operation_recovery_is_scoped_to_linked_worktrees() {
    let repository = Repository::new();
    let worktree = repository.0.join("linked");
    run_mutation(
        &repository.0,
        &[
            "worktree",
            "add",
            "-b",
            "linked",
            worktree.to_str().unwrap(),
        ],
        "create linked worktree",
    )
    .unwrap();
    let main_record = preserve_operation(&repository.0, "Main capture").unwrap();
    let linked_record = preserve_operation(&worktree, "Linked capture").unwrap();
    assert_eq!(
        operation_recoveries(&repository.0).unwrap()[0].id,
        main_record.id
    );
    assert_eq!(
        operation_recoveries(&worktree).unwrap()[0].id,
        linked_record.id
    );
    delete_operation_recovery(&worktree, &linked_record.id).unwrap();
    assert_eq!(operation_recoveries(&repository.0).unwrap().len(), 1);
}

#[test]
fn operation_recovery_refuses_assume_unchanged_files_before_discarding_uncaptured_contents() {
    let repository = Repository::new();
    let base = repository.oid();
    run_mutation(
        &repository.0,
        &["update-index", "--assume-unchanged", "file"],
        "hide fixture working edits",
    )
    .unwrap();
    fs::write(repository.0.join("file"), b"hidden working contents").unwrap();
    assert_eq!(
        prepare_reset(&repository.0, &base, "hard")
            .err()
            .unwrap()
            .kind,
        "hiddenIndexChanges"
    );
    assert_eq!(
        fs::read(repository.0.join("file")).unwrap(),
        b"hidden working contents"
    );
    assert_eq!(repository.oid(), base);
    assert!(operation_recoveries(&repository.0).unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn operation_recovery_symlink_and_deleted_contents_roundtrip_and_private_records() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let repository = Repository::new();
    let base = repository.oid();
    symlink("file", repository.0.join("link")).unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Link").unwrap();
    fs::remove_file(repository.0.join("file")).unwrap();
    stage_path(&repository.0, "file").unwrap();
    fs::remove_file(repository.0.join("link")).unwrap();
    symlink("other", repository.0.join("link")).unwrap();
    let plan = prepare_reset(&repository.0, &base, "hard").unwrap();
    let record = execute_reset(&repository.0, &plan).unwrap();
    let directory = discard::recovery_directory(&repository.0).unwrap();
    assert_eq!(
        fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(directory.join(format!("{}.json", record.id)))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    restore_operation_branch(&repository.0, &record.id, "recovered").unwrap();
    assert!(!repository.0.join("file").exists());
    assert_eq!(
        fs::read_link(repository.0.join("link")).unwrap(),
        Path::new("other")
    );
    assert_eq!(read_status(&repository.0).unwrap().staged, 1);
}

#[test]
fn stash_options_selected_paths_leave_other_changes_and_index_intact() {
    let repository = Repository::new();
    fs::write(repository.0.join("file"), b"staged\n").unwrap();
    stage_path(&repository.0, "file").unwrap();
    fs::write(repository.0.join("file"), b"unstaged\n").unwrap();
    fs::write(repository.0.join("selected [new]"), b"\0binary").unwrap();
    fs::write(repository.0.join("other"), b"untouched\n").unwrap();
    let index = run_git(&repository.0, &["ls-files", "--stage"])
        .unwrap()
        .stdout;
    stash_with_options(
        &repository.0,
        &stash_options("all", true, Some(vec!["selected [new]".into()])),
    )
    .unwrap();
    assert!(!repository.0.join("selected [new]").exists());
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"unstaged\n");
    assert_eq!(
        fs::read(repository.0.join("other")).unwrap(),
        b"untouched\n"
    );
    assert_eq!(
        run_git(&repository.0, &["ls-files", "--stage"])
            .unwrap()
            .stdout,
        index
    );
    let stash = read_stashes(&repository.0).unwrap().remove(0);
    apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, false).unwrap();
    assert_eq!(
        fs::read(repository.0.join("selected [new]")).unwrap(),
        b"\0binary"
    );
}

#[test]
fn stash_options_restore_staged_and_unstaged_separation() {
    let repository = Repository::new();
    fs::write(repository.0.join("file"), b"staged\n").unwrap();
    stage_path(&repository.0, "file").unwrap();
    fs::write(repository.0.join("file"), b"unstaged\n").unwrap();
    fs::write(repository.0.join("untracked"), b"leave\n").unwrap();
    stash_with_options(&repository.0, &stash_options("all", false, None)).unwrap();
    assert_eq!(
        fs::read(repository.0.join("untracked")).unwrap(),
        b"leave\n"
    );
    let stash = read_stashes(&repository.0).unwrap().remove(0);
    apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, true).unwrap();
    assert_eq!(
        run_git(&repository.0, &["show", ":file"]).unwrap().stdout,
        b"staged\n"
    );
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"unstaged\n");
    assert_eq!(read_stashes(&repository.0).unwrap().len(), 1);
}

#[test]
fn stash_options_keep_index_and_staged_only_respect_working_contents() {
    let repository = Repository::new();
    fs::write(repository.0.join("file"), b"staged\n").unwrap();
    stage_path(&repository.0, "file").unwrap();
    fs::write(repository.0.join("file"), b"unstaged\n").unwrap();
    stash_with_options(&repository.0, &stash_options("keep-index", false, None)).unwrap();
    assert_eq!(
        run_git(&repository.0, &["show", ":file"]).unwrap().stdout,
        b"staged\n"
    );
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"staged\n");
    fs::write(repository.0.join("other"), b"unstaged other\n").unwrap();
    let result = stash_with_options(&repository.0, &stash_options("staged-only", false, None));
    if let Err(error) = &result {
        assert_eq!(error.kind, "unsupportedStagedStash");
        return;
    }
    result.unwrap();
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"base\n");
    assert_eq!(
        fs::read(repository.0.join("other")).unwrap(),
        b"unstaged other\n"
    );
}

#[test]
fn stash_options_stale_apply_and_conflicts_keep_the_stash() {
    let repository = Repository::new();
    fs::write(repository.0.join("file"), b"saved\n").unwrap();
    stash_with_options(&repository.0, &stash_options("all", false, None)).unwrap();
    let stash = read_stashes(&repository.0).unwrap().remove(0);
    assert_eq!(
        apply_stash_with_index(&repository.0, &stash.reference, &"1".repeat(40), true)
            .unwrap_err()
            .kind,
        "staleStash"
    );
    fs::write(repository.0.join("file"), b"different\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Conflicting change").unwrap();
    assert!(apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, false).is_err());
    assert_eq!(read_stashes(&repository.0).unwrap()[0].oid, stash.oid);
    assert_eq!(read_status(&repository.0).unwrap().conflicted, 1);
}

#[test]
fn stash_options_branch_uses_original_base_and_preserves_stash() {
    let repository = Repository::new();
    let base = repository.oid();
    fs::write(repository.0.join("file"), b"staged\n").unwrap();
    stage_all(&repository.0).unwrap();
    fs::write(repository.0.join("file"), b"saved\n").unwrap();
    stash_with_options(&repository.0, &stash_options("all", false, None)).unwrap();
    let stash = read_stashes(&repository.0).unwrap().remove(0);
    fs::write(repository.0.join("file"), b"later\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Later commit").unwrap();
    create_branch_from_stash(&repository.0, &stash.reference, &stash.oid, "recovered").unwrap();
    assert_eq!(repository.oid(), base);
    assert_eq!(
        run_git(&repository.0, &["show", ":file"]).unwrap().stdout,
        b"staged\n"
    );
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"saved\n");
    assert_eq!(read_stashes(&repository.0).unwrap()[0].oid, stash.oid);
}

#[test]
fn stash_options_checkout_refuses_stale_target_before_saving_and_keeps_saved_work() {
    let repository = Repository::new();
    let base = repository.oid();
    run_mutation(
        &repository.0,
        &["branch", "destination", &base],
        "create checkout target",
    )
    .unwrap();
    fs::write(repository.0.join("file"), b"saved\n").unwrap();
    assert_eq!(
        stash_and_checkout(
            &repository.0,
            "destination",
            &base,
            &"1".repeat(40),
            "Switch"
        )
        .unwrap_err()
        .kind,
        "staleCheckout"
    );
    assert!(read_stashes(&repository.0).unwrap().is_empty());
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"saved\n");
    stash_and_checkout(&repository.0, "destination", &base, &base, "Switch").unwrap();
    assert_eq!(
        read_status(&repository.0).unwrap().branch.as_deref(),
        Some("destination")
    );
    assert_eq!(read_stashes(&repository.0).unwrap().len(), 1);
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"base\n");
}

#[test]
fn stash_options_checkout_preserves_ignored_collisions_and_saved_changes() {
    let repository = Repository::new();
    run_mutation(
        &repository.0,
        &["switch", "-c", "destination"],
        "create target branch",
    )
    .unwrap();
    fs::write(repository.0.join("ignored-file"), b"target tracked\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Track destination file").unwrap();
    let target = repository.oid();
    checkout_branch(&repository.0, "main").unwrap();
    fs::write(repository.0.join(".gitignore"), b"ignored-file\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Ignore local file").unwrap();
    let head = repository.oid();
    fs::write(
        repository.0.join("ignored-file"),
        b"local ignored contents\n",
    )
    .unwrap();
    fs::write(repository.0.join("file"), b"save this work\n").unwrap();
    assert_eq!(
        stash_and_checkout(&repository.0, "destination", &head, &target, "Save")
            .unwrap_err()
            .kind,
        "checkoutFailedAfterStash"
    );
    assert_eq!(
        fs::read(repository.0.join("ignored-file")).unwrap(),
        b"local ignored contents\n"
    );
    assert_eq!(
        read_status(&repository.0).unwrap().branch.as_deref(),
        Some("main")
    );
    let stash = read_stashes(&repository.0).unwrap().remove(0);
    apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, true).unwrap();
    assert_eq!(
        fs::read(repository.0.join("file")).unwrap(),
        b"save this work\n"
    );
}

#[test]
fn stash_options_checkout_refuses_occupied_worktrees_before_saving() {
    let repository = Repository::new();
    let head = repository.oid();
    run_mutation(
        &repository.0,
        &["branch", "occupied"],
        "create target branch",
    )
    .unwrap();
    let linked = repository.0.join(".git/linked");
    run_mutation(
        &repository.0,
        &["worktree", "add", linked.to_str().unwrap(), "occupied"],
        "create occupied worktree",
    )
    .unwrap();
    fs::write(repository.0.join("file"), b"unchanged local work\n").unwrap();
    assert_eq!(
        stash_and_checkout(&repository.0, "occupied", &head, &head, "Save")
            .unwrap_err()
            .kind,
        "branchInAnotherWorktree"
    );
    assert!(read_stashes(&repository.0).unwrap().is_empty());
    assert_eq!(
        fs::read(repository.0.join("file")).unwrap(),
        b"unchanged local work\n"
    );
}

#[test]
fn reference_actions_delete_local_tag_preserves_annotation_and_rejects_stale_target() {
    let repository = Repository::new();
    let oid = repository.oid();
    create_tag(&repository.0, "release", &oid, Some("Release notes")).unwrap();
    let object = run_git(&repository.0, &["rev-parse", "refs/tags/release"])
        .unwrap()
        .stdout;
    assert!(delete_local_tag(&repository.0, "release", &"1".repeat(40)).is_err());
    delete_local_tag(&repository.0, "release", &oid).unwrap();
    assert!(read_tags(&repository.0).unwrap().is_empty());
    let protected = run_git(
        &repository.0,
        &[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery",
        ],
    )
    .unwrap();
    assert_eq!(protected.stdout, object);
}

#[test]
fn reference_actions_push_only_selected_tag_and_delete_with_exact_remote_lease() {
    let repository = Repository::new();
    for name in ["origin", "upstream"] {
        let remote = repository.0.join(format!("{name}.git"));
        run_mutation(
            &repository.0,
            &["init", "--bare", remote.to_str().unwrap()],
            "create remote",
        )
        .unwrap();
        add_remote(&repository.0, name, remote.to_str().unwrap()).unwrap();
    }
    let oid = repository.oid();
    create_tag(&repository.0, "release", &oid, Some("Release")).unwrap();
    create_tag(
        &repository.0,
        "private",
        &oid,
        Some("Unselected annotation"),
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["config", "push.followTags", "true"],
        "test explicit selected-tag scope",
    )
    .unwrap();
    let token = CancellationToken::default();
    transport_reference(
        &repository.0,
        "upstream",
        "release",
        "tag",
        false,
        Some(&oid),
        &token,
    )
    .unwrap();
    let remote_object = remote_tag_object(&repository.0, "upstream", "release", &token).unwrap();
    let refs = repository.remote_refs("upstream");
    assert_eq!(String::from_utf8_lossy(&refs).trim(), "refs/tags/release");
    assert!(repository.remote_refs("origin").is_empty());
    assert!(
        transport_reference(
            &repository.0,
            "upstream",
            "release",
            "tag",
            true,
            Some(&oid),
            &token
        )
        .is_err()
    );
    transport_reference(
        &repository.0,
        "upstream",
        "release",
        "tag",
        true,
        Some(&remote_object),
        &token,
    )
    .unwrap();
    assert!(repository.remote_refs("upstream").is_empty());
    assert_eq!(read_tags(&repository.0).unwrap().len(), 2);
}

#[test]
fn reference_actions_use_the_separate_push_destination() {
    let repository = Repository::new();
    for name in ["fetch", "push"] {
        let remote = repository.0.join(format!("{name}.git"));
        run_mutation(
            &repository.0,
            &["init", "--bare", remote.to_str().unwrap()],
            "create remote",
        )
        .unwrap();
    }
    add_remote(
        &repository.0,
        "origin",
        repository.0.join("fetch.git").to_str().unwrap(),
    )
    .unwrap();
    set_remote_push_url(
        &repository.0,
        "origin",
        Some(repository.0.join("push.git").to_str().unwrap()),
    )
    .unwrap();
    create_tag(&repository.0, "release", &repository.oid(), None).unwrap();
    let token = CancellationToken::default();
    transport_reference(
        &repository.0,
        "origin",
        "release",
        "tag",
        false,
        Some(&repository.oid()),
        &token,
    )
    .unwrap();
    assert_eq!(
        remote_tag_object(&repository.0, "origin", "release", &token).unwrap(),
        repository.oid()
    );
    assert!(repository.remote_refs("fetch").is_empty());
    set_remote_push_url(&repository.0, "origin", None).unwrap();
    assert_eq!(
        read_remotes(&repository.0).unwrap()[0].fetch_url,
        read_remotes(&repository.0).unwrap()[0].push_url
    );
}

#[test]
fn reference_actions_delete_only_the_leased_remote_branch() {
    let repository = Repository::new();
    let remote = repository.0.join("origin.git");
    run_mutation(
        &repository.0,
        &["init", "--bare", remote.to_str().unwrap()],
        "create remote",
    )
    .unwrap();
    add_remote(&repository.0, "origin", remote.to_str().unwrap()).unwrap();
    let original = repository.oid();
    run_mutation(
        &repository.0,
        &[
            "push",
            "origin",
            "HEAD:refs/heads/review",
            "HEAD:refs/heads/main",
        ],
        "populate remote",
    )
    .unwrap();
    let token = CancellationToken::default();
    assert!(
        transport_reference(
            &repository.0,
            "origin",
            "review",
            "branch",
            true,
            Some(&"1".repeat(40)),
            &token
        )
        .is_err()
    );
    transport_reference(
        &repository.0,
        "origin",
        "review",
        "branch",
        true,
        Some(&original),
        &token,
    )
    .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&repository.remote_refs("origin")).trim(),
        "refs/heads/main"
    );
    assert_eq!(repository.oid(), original);
}

#[test]
fn reference_actions_validate_both_urls_before_changing_configuration() {
    let repository = Repository::new();
    configure_remote_urls(
        &repository.0,
        "origin",
        "/original",
        Some("/push"),
        true,
        true,
    )
    .unwrap();
    assert!(
        configure_remote_urls(
            &repository.0,
            "origin",
            "/changed",
            Some("bad\nurl"),
            true,
            false
        )
        .is_err()
    );
    let remote = read_remotes(&repository.0).unwrap().remove(0);
    assert_eq!(remote.fetch_url, "/original");
    assert_eq!(remote.push_url, "/push");
    configure_remote_urls(&repository.0, "origin", "/changed", None, true, false).unwrap();
    let remote = read_remotes(&repository.0).unwrap().remove(0);
    assert_eq!(remote.fetch_url, "/changed");
    assert_eq!(remote.push_url, "/changed");
}

#[test]
fn reference_actions_refuse_multiple_push_destinations_and_stale_local_tags() {
    let repository = Repository::new();
    let remote = repository.0.join("origin.git");
    run_mutation(
        &repository.0,
        &["init", "--bare", remote.to_str().unwrap()],
        "create remote",
    )
    .unwrap();
    add_remote(&repository.0, "origin", remote.to_str().unwrap()).unwrap();
    let oid = repository.oid();
    create_tag(&repository.0, "release", &oid, None).unwrap();
    let token = CancellationToken::default();
    assert_eq!(
        transport_reference(
            &repository.0,
            "origin",
            "release",
            "tag",
            false,
            Some(&"1".repeat(40)),
            &token
        )
        .unwrap_err()
        .kind,
        "staleReference"
    );
    assert!(repository.remote_refs("origin").is_empty());
    run_mutation(
        &repository.0,
        &[
            "config",
            "--add",
            "remote.origin.pushurl",
            remote.to_str().unwrap(),
        ],
        "set push destination",
    )
    .unwrap();
    run_mutation(
        &repository.0,
        &["config", "--add", "remote.origin.pushurl", "/other"],
        "add second push destination",
    )
    .unwrap();
    assert_eq!(
        transport_reference(
            &repository.0,
            "origin",
            "release",
            "tag",
            false,
            Some(&oid),
            &token
        )
        .unwrap_err()
        .kind,
        "ambiguousPushDestination"
    );
    assert!(repository.remote_refs("origin").is_empty());
}

#[test]
fn reference_actions_sign_and_verify_annotated_tags_with_configured_ssh_key() {
    let repository = Repository::new();
    let key = repository.0.join(".git/test-signing-key");
    let output = Command::new("ssh-keygen")
        .args([
            "-q",
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            "test@example.test",
            "-f",
        ])
        .arg(&key)
        .output()
        .expect("ssh-keygen must be installed for signing tests");
    assert!(output.status.success());
    let public = fs::read_to_string(key.with_extension("pub")).unwrap();
    let allowed = repository.0.join(".git/allowed-signers");
    let revoked = repository.0.join(".git/revoked-signers");
    fs::write(&allowed, format!("test@example.test {public}")).unwrap();
    fs::write(&revoked, "").unwrap();
    for (name, value) in [
        ("gpg.format", "ssh"),
        ("user.signingkey", key.to_str().unwrap()),
        ("gpg.ssh.allowedSignersFile", allowed.to_str().unwrap()),
        ("gpg.ssh.revocationFile", revoked.to_str().unwrap()),
    ] {
        run_mutation(&repository.0, &["config", name, value], "configure signer").unwrap();
    }
    let oid = repository.oid();
    fs::write(repository.0.join("file"), b"unstaged tag fixture\n").unwrap();
    fs::write(repository.0.join("staged"), b"staged tag fixture\n").unwrap();
    stage_path(&repository.0, "staged").unwrap();
    let staged = run_git(&repository.0, &["ls-files", "--stage", "-z"])
        .unwrap()
        .stdout;
    let config = fs::read(repository.0.join(".git/config")).unwrap();
    create_signed_tag(&repository.0, "signed", &oid, "Signed release").unwrap();
    verify_tag(&repository.0, "signed").unwrap();
    let tag = run_git(&repository.0, &["rev-parse", "refs/tags/signed"])
        .unwrap()
        .stdout;
    let details = tag_details(&repository.0, "signed").unwrap();
    assert!(details.annotated);
    assert_eq!(details.oid, oid);
    assert_eq!(details.message.as_deref(), Some("Signed release"));
    assert_eq!(
        create_signed_tag(&repository.0, "signed", &oid, "Must not overwrite")
            .unwrap_err()
            .kind,
        "gitFailure"
    );
    assert_eq!(
        run_git(&repository.0, &["rev-parse", "refs/tags/signed"])
            .unwrap()
            .stdout,
        tag
    );
    fs::write(&allowed, "").unwrap();
    assert_eq!(
        verify_tag(&repository.0, "signed").unwrap_err().kind,
        "gitFailure"
    );
    fs::write(&allowed, format!("test@example.test {public}")).unwrap();
    fs::write(&revoked, &public).unwrap();
    assert_eq!(
        verify_tag(&repository.0, "signed").unwrap_err().kind,
        "gitFailure"
    );
    fs::write(&revoked, "").unwrap();
    verify_tag(&repository.0, "signed").unwrap();
    let object = run_git(&repository.0, &["cat-file", "tag", "refs/tags/signed"])
        .unwrap()
        .stdout;
    let altered = String::from_utf8(object.clone())
        .unwrap()
        .replace("Signed release", "Altered release");
    fs::write(repository.0.join(".git/tampered-tag-fixture"), altered).unwrap();
    let output = run_git(
        &repository.0,
        &[
            "hash-object",
            "-t",
            "tag",
            "-w",
            "--",
            ".git/tampered-tag-fixture",
        ],
    )
    .unwrap();
    ensure_success("write owned tampered tag fixture", &output).unwrap();
    let altered_oid = String::from_utf8(output.stdout).unwrap().trim().to_owned();
    run_mutation(
        &repository.0,
        &["update-ref", "refs/tags/tampered", &altered_oid, ""],
        "reference owned tampered tag",
    )
    .unwrap();
    assert_eq!(
        verify_tag(&repository.0, "tampered").unwrap_err().kind,
        "gitFailure"
    );
    create_tag(
        &repository.0,
        "unsigned",
        &repository.oid(),
        Some("Unsigned"),
    )
    .unwrap();
    assert!(verify_tag(&repository.0, "unsigned").is_err());
    fs::remove_file(&key).unwrap();
    assert!(matches!(
        create_signed_tag(&repository.0, "unavailable", &oid, "Missing key")
            .unwrap_err()
            .kind
            .as_str(),
        "gitFailure" | "tagSigningFailed"
    ));
    assert_eq!(
        run_git(
            &repository.0,
            &["show-ref", "--verify", "--quiet", "refs/tags/unavailable"]
        )
        .unwrap()
        .status
        .code(),
        Some(1)
    );
    delete_local_tag(&repository.0, "signed", &oid).unwrap();
    let recovery = run_git(
        &repository.0,
        &[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/git-khronos/recovery/",
        ],
    )
    .unwrap()
    .stdout;
    assert_eq!(recovery, tag);
    let recovered_oid = String::from_utf8(tag).unwrap().trim().to_owned();
    assert_eq!(
        run_git(&repository.0, &["cat-file", "tag", &recovered_oid])
            .unwrap()
            .stdout,
        object
    );
    run_mutation(
        &repository.0,
        &["update-ref", "refs/tags/restored", &recovered_oid, ""],
        "restore owned signed tag fixture",
    )
    .unwrap();
    verify_tag(&repository.0, "restored").unwrap();
    assert_eq!(repository.oid(), oid);
    assert_eq!(
        run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout,
        staged
    );
    assert_eq!(
        fs::read(repository.0.join("file")).unwrap(),
        b"unstaged tag fixture\n"
    );
    assert_eq!(
        fs::read(repository.0.join("staged")).unwrap(),
        b"staged tag fixture\n"
    );
    assert_eq!(fs::read(repository.0.join(".git/config")).unwrap(), config);
}

struct GitDaemon(std::process::Child);

impl Drop for GitDaemon {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Serves `base` over git:// so submodule clones use an allowed transport.
fn serve_git_daemon(base: &Path) -> (GitDaemon, String) {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let child = std::process::Command::new("git")
        .args([
            "daemon",
            "--export-all",
            "--reuseaddr",
            "--listen=127.0.0.1",
        ])
        .arg(format!("--port={port}"))
        .arg(format!("--base-path={}", base.display()))
        .arg(base)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let daemon = GitDaemon(child);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::net::TcpStream::connect(("127.0.0.1", port)).is_err() {
        assert!(
            std::time::Instant::now() < deadline,
            "git daemon did not start"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    (daemon, format!("git://127.0.0.1:{port}"))
}

#[test]
fn recursive_clone_initializes_nested_submodules() {
    let base = Repository::new().0.with_extension("recursive-base");
    fs::create_dir(&base).unwrap();
    let (_daemon, url) = serve_git_daemon(&base);
    let make = |name: &str| {
        let path = base.join(name);
        fs::create_dir(&path).unwrap();
        run_mutation(&path, &["init", "-q", "-b", "main"], name).unwrap();
        fs::write(path.join(format!("{name}.txt")), name).unwrap();
        run_mutation(&path, &["add", "."], name).unwrap();
        run_mutation(&path, &["commit", "-q", "-m", name], name).unwrap();
        path
    };
    let inner = make("inner");
    let middle = make("middle");
    let top = make("top");
    let add = |parent: &Path, child: &str, path: &str| {
        run_mutation(
            parent,
            &["submodule", "add", "-q", &format!("{url}/{child}"), path],
            "add",
        )
        .unwrap();
        run_mutation(parent, &["commit", "-q", "-m", "add submodule"], "commit").unwrap();
    };
    add(&middle, "inner", "deps/inner");
    add(&top, "middle", "vendor/middle");
    let _ = inner;

    let parent = base.join("clones");
    fs::create_dir(&parent).unwrap();
    let plain = clone_repository(&format!("{url}/top"), &parent, "plain", None, None).unwrap();
    assert!(plain.join("vendor/middle").is_dir());
    assert!(!plain.join("vendor/middle/middle.txt").exists());

    let full =
        clone_repository_with_submodules(&format!("{url}/top"), &parent, "full", None, None, true)
            .unwrap();
    assert_eq!(
        fs::read_to_string(full.join("vendor/middle/middle.txt")).unwrap(),
        "middle"
    );
    assert_eq!(
        fs::read_to_string(full.join("vendor/middle/deps/inner/inner.txt")).unwrap(),
        "inner"
    );
    let active = run_git(&full, &["config", "--get-all", "submodule.active"]).unwrap();
    assert_eq!(String::from_utf8_lossy(&active.stdout).trim(), ".");
    let status = run_git(&full, &["submodule", "status", "--recursive"]).unwrap();
    let status = String::from_utf8_lossy(&status.stdout);
    assert_eq!(status.lines().count(), 2, "{status}");
    assert!(status.lines().all(|line| line.starts_with(' ')), "{status}");

    let shallow = clone_repository_with_submodules(
        &format!("{url}/top"),
        &parent,
        "shallow",
        None,
        Some(1),
        true,
    )
    .unwrap();
    assert!(shallow.join("vendor/middle/deps/inner/inner.txt").is_file());

    // A submodule whose server repository disappeared leaves the superproject usable.
    fs::rename(&middle, base.join("moved")).unwrap();
    let error = clone_repository_with_submodules(
        &format!("{url}/top"),
        &parent,
        "broken",
        None,
        None,
        true,
    )
    .unwrap_err();
    assert_eq!(error.kind, "submoduleCloneIncomplete", "{error:?}");
    let broken = parent.join("broken");
    assert!(broken.join("top.txt").is_file());
    assert!(error.hint.unwrap().contains(&broken.display().to_string()));
    let retry = clone_repository_with_submodules(
        &format!("{url}/top"),
        &parent,
        "broken",
        None,
        None,
        true,
    )
    .unwrap_err();
    assert_eq!(retry.kind, "destinationExists");
    drop(_daemon);
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn bare_repository_opens_read_only_with_explicit_git_dir() {
    let source = Repository::new();
    run_git(&source.0, &["tag", "v1"]).unwrap();
    let bare = source.0.with_extension("bare.git");
    run_git(
        &source.0,
        &[
            "clone",
            "-q",
            "--bare",
            "--",
            source.0.to_str().unwrap(),
            bare.to_str().unwrap(),
        ],
    )
    .unwrap();
    let before = fs::read_dir(&bare).unwrap().count();

    let resolved = resolve_repository(&bare).unwrap();
    assert_eq!(resolved, bare.canonicalize().unwrap());
    assert!(is_explicit_bare_repository(&resolved));
    let data = snapshot_with_limits(&resolved, 20, 100).unwrap();
    assert!(data.bare);
    assert_eq!(data.status.entry_count, 0);
    assert_eq!(data.status.branch.as_deref(), Some("main"));
    assert_eq!(data.head_oid.as_deref(), Some(source.oid().as_str()));
    assert!(data.commits.iter().any(|commit| commit.oid == source.oid()));
    assert!(data.tags.iter().any(|tag| tag.name == "v1"));
    assert!(data.submodules.is_empty());
    let startup = snapshot_with_limits_startup(&resolved, 20, 100).unwrap();
    assert!(startup.bare && startup.status.entries.is_empty());
    assert!(repository_watch_paths(&resolved).is_ok());

    let refused = stage_all(&resolved).unwrap_err();
    assert_eq!(refused.kind, "gitFailure");
    assert_eq!(fs::read_dir(&bare).unwrap().count(), before);

    let refs = bare.join("refs");
    assert_eq!(
        resolve_repository(&refs).unwrap_err().kind,
        "bareRepositoryUnsupported"
    );
    fs::remove_dir_all(bare).unwrap();
}

fn lfs_prune_fixture() -> Repository {
    let repository = Repository::new();
    let path = &repository.0;
    run_mutation(
        path,
        &["config", "core.hooksPath", ".git/hooks"],
        "isolate LFS hooks",
    )
    .unwrap();
    initialize_lfs(path).unwrap();
    track_lfs_pattern(path, "*.bin", false).unwrap();
    fs::write(path.join("committed.bin"), b"committed object\n").unwrap();
    stage_all(path).unwrap();
    commit(path, "Committed LFS object").unwrap();
    // Staged then unstaged: only a dangling pointer blob still names this object.
    fs::write(path.join("dangling.bin"), b"dangling pointer object\n").unwrap();
    stage_path(path, "dangling.bin").unwrap();
    run_mutation(path, &["reset", "-q"], "unstage").unwrap();
    fs::remove_file(path.join("dangling.bin")).unwrap();
    repository
}

/// Stores contents in LFS storage without writing any Git object, returning its OID.
fn lfs_orphan(path: &Path, contents: &[u8], age: Duration) -> String {
    let mut child = git_in(path)
        .args(["lfs", "clean"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(contents).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let pointer = String::from_utf8(output.stdout).unwrap();
    let oid = pointer
        .lines()
        .find_map(|line| line.strip_prefix("oid sha256:"))
        .unwrap()
        .to_owned();
    let object = lfs_object_path(path, &oid);
    fs::File::options()
        .write(true)
        .open(&object)
        .unwrap()
        .set_modified(SystemTime::now() - age)
        .unwrap();
    oid
}

fn lfs_object_path(path: &Path, oid: &str) -> PathBuf {
    let environment = run_git(path, &["lfs", "env"]).unwrap().stdout;
    let media = String::from_utf8(environment)
        .unwrap()
        .lines()
        .find_map(|line| line.strip_prefix("LocalMediaDir=").map(str::to_owned))
        .unwrap();
    Path::new(&media).join(&oid[..2]).join(&oid[2..4]).join(oid)
}

fn lfs_stored(path: &Path) -> usize {
    let media = lfs_object_path(path, &"0".repeat(64));
    let media = media.parent().unwrap().parent().unwrap().parent().unwrap();
    fs::read_dir(media)
        .unwrap()
        .flat_map(|first| fs::read_dir(first.unwrap().path()).unwrap())
        .flat_map(|second| fs::read_dir(second.unwrap().path()).unwrap())
        .count()
}

#[test]
#[ignore = "requires Git LFS with clean and env commands; run with --ignored"]
fn lfs_prune_offers_only_old_objects_no_git_object_references_and_removes_exactly_them() {
    let repository = lfs_prune_fixture();
    let path = &repository.0;
    let old = Duration::from_secs(2 * 60 * 60);
    let orphan = lfs_orphan(path, b"orphaned object\n", old);
    let recent = lfs_orphan(path, b"recent orphan\n", Duration::ZERO);
    let pointer = run_git(path, &["show", "HEAD:committed.bin"])
        .unwrap()
        .stdout;
    let pointer = String::from_utf8(pointer).unwrap();
    let committed = pointer
        .lines()
        .find_map(|line| line.strip_prefix("oid sha256:"))
        .unwrap();
    fs::File::options()
        .write(true)
        .open(lfs_object_path(path, committed))
        .unwrap()
        .set_modified(SystemTime::now() - old)
        .unwrap();
    assert_eq!(lfs_stored(path), 4);
    let cancellation = CancellationToken::default();
    let preview = preview_lfs_prune(path, &cancellation).unwrap();
    assert_eq!(
        preview.objects,
        vec![LfsPruneObject {
            oid: orphan.clone(),
            size: 16
        }]
    );
    assert_eq!((preview.total_size, preview.remaining), (16, 0));
    assert_eq!((preview.referenced, preview.recent), (2, 1));
    let refs = run_git(path, &["show-ref"]).unwrap().stdout;
    prune_lfs_objects(path, &preview, &cancellation).unwrap();
    assert!(!lfs_object_path(path, &orphan).exists());
    assert!(lfs_object_path(path, &recent).exists());
    assert_eq!(lfs_stored(path), 3);
    assert_eq!(run_git(path, &["show-ref"]).unwrap().stdout, refs);
    assert_eq!(
        fs::read(path.join("committed.bin")).unwrap(),
        b"committed object\n"
    );
    let again = preview_lfs_prune(path, &cancellation).unwrap();
    assert!(again.objects.is_empty());
    let failure = prune_lfs_objects(path, &again, &cancellation).unwrap_err();
    assert_eq!(failure.kind, "unsafeLfsPrune");
}

#[test]
#[ignore = "requires Git LFS with clean and env commands; run with --ignored"]
fn lfs_prune_refuses_stale_reviews_shared_storage_incomplete_history_and_cancellation() {
    let repository = lfs_prune_fixture();
    let path = &repository.0;
    let orphan = lfs_orphan(path, b"orphaned object\n", Duration::from_secs(7200));
    let cancellation = CancellationToken::default();
    let preview = preview_lfs_prune(path, &cancellation).unwrap();
    assert_eq!(preview.objects.len(), 1);

    // A pointer written after review, even only as a loose Git object, protects the object.
    let pointer =
        format!("version https://git-lfs.github.com/spec/v1\noid sha256:{orphan}\nsize 16\n");
    let mut child = git_in(path)
        .args(["hash-object", "-w", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(pointer.as_bytes())
        .unwrap();
    assert!(child.wait().unwrap().success());
    let failure = prune_lfs_objects(path, &preview, &cancellation).unwrap_err();
    assert_eq!(failure.kind, "staleLfsPrune");
    assert!(lfs_object_path(path, &orphan).exists());
    let mut changed = preview.clone();
    changed.objects[0].size += 1;
    assert_eq!(
        prune_lfs_objects(path, &changed, &cancellation)
            .unwrap_err()
            .kind,
        "staleLfsPrune"
    );

    let cancelled = CancellationToken::default();
    cancelled.cancel();
    assert_eq!(
        preview_lfs_prune(path, &cancelled).unwrap_err().kind,
        "operationCancelled"
    );

    run_mutation(
        path,
        &["config", "remote.origin.promisor", "true"],
        "promisor",
    )
    .unwrap();
    assert_eq!(
        preview_lfs_prune(path, &cancellation).unwrap_err().kind,
        "unsafeLfsPrune"
    );
    run_mutation(
        path,
        &["config", "--unset", "remote.origin.promisor"],
        "unset",
    )
    .unwrap();

    let head = repository.oid();
    fs::write(path.join(".git/shallow"), format!("{head}\n")).unwrap();
    assert_eq!(
        preview_lfs_prune(path, &cancellation).unwrap_err().kind,
        "unsafeLfsPrune"
    );
    fs::remove_file(path.join(".git/shallow")).unwrap();

    let shared = path.with_extension("shared-lfs");
    run_mutation(
        path,
        &["config", "lfs.storage", shared.to_str().unwrap()],
        "external storage",
    )
    .unwrap();
    let failure = preview_lfs_prune(path, &cancellation).unwrap_err();
    assert_eq!(failure.kind, "unsafeLfsPrune");
    assert!(failure.message.contains("shared"));
    assert!(lfs_object_path(path, &orphan).starts_with(&shared));
    run_mutation(
        path,
        &["config", "lfs.storage", "private-lfs"],
        "private storage",
    )
    .unwrap();
    assert!(
        preview_lfs_prune(path, &cancellation)
            .unwrap()
            .objects
            .is_empty()
    );
    let _ = fs::remove_dir_all(shared);
}

#[test]
fn branch_deletion_keeps_a_restorable_capture_and_refusals_leave_none() {
    let repository = Repository::new();
    run_mutation(&repository.0, &["switch", "-c", "topic"], "create topic").unwrap();
    fs::write(repository.0.join("file"), b"topic\n").unwrap();
    stage_all(&repository.0).unwrap();
    commit(&repository.0, "Topic work").unwrap();
    let tip = repository.oid();
    checkout_branch(&repository.0, "main").unwrap();

    let refusal = delete_branch(&repository.0, "topic", false).unwrap_err();
    assert_eq!(refusal.kind, "branchNotMerged");
    assert!(operation_recoveries(&repository.0).unwrap().is_empty());

    delete_branch(&repository.0, "topic", true).unwrap();
    let records = operation_recoveries(&repository.0).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].label, "Delete branch topic");
    assert_eq!(records[0].head_oid, tip);
    assert!(records[0].snapshot_oid.is_none());
    run_mutation(
        &repository.0,
        &["reflog", "expire", "--expire=now", "--all"],
        "expire",
    )
    .unwrap();
    run_mutation(&repository.0, &["gc", "--prune=now"], "prune").unwrap();
    restore_operation_branch(&repository.0, &records[0].id, "topic-restored").unwrap();
    assert_eq!(repository.oid(), tip);
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"topic\n");

    let missing = delete_branch(&repository.0, "absent", true).unwrap_err();
    assert_eq!(missing.kind, "branchNotFound");
    assert_eq!(operation_recoveries(&repository.0).unwrap().len(), 1);
}

#[test]
fn stash_deletion_keeps_index_worktree_and_untracked_contents_restorable() {
    let repository = Repository::new();
    let base = repository.oid();
    fs::write(repository.0.join("file"), b"staged\n").unwrap();
    stage_all(&repository.0).unwrap();
    fs::write(repository.0.join("file"), b"working\n").unwrap();
    fs::write(repository.0.join("new"), b"untracked\n").unwrap();
    run_mutation(
        &repository.0,
        &["stash", "push", "-u", "-m", "Keep me"],
        "stash",
    )
    .unwrap();
    fs::write(repository.0.join("file"), b"other\n").unwrap();
    stash_with_message(&repository.0, Some("Other")).unwrap();
    let kept = reference_tip(&repository.0, "stash@{0}").unwrap();

    delete_stash_and_check_refusal(&repository);
    drop_stash(&repository.0, "stash@{1}").unwrap();
    let stashes = read_stashes(&repository.0).unwrap();
    assert_eq!(stashes.len(), 1);
    assert_eq!(reference_tip(&repository.0, "stash@{0}").unwrap(), kept);
    let records = operation_recoveries(&repository.0).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].label, "Delete stash: On main: Keep me");
    assert_eq!(records[0].head_oid, base);

    run_mutation(&repository.0, &["stash", "clear"], "clear").unwrap();
    run_mutation(
        &repository.0,
        &["reflog", "expire", "--expire=now", "--all"],
        "expire",
    )
    .unwrap();
    run_mutation(&repository.0, &["gc", "--prune=now"], "prune").unwrap();
    restore_operation_branch(&repository.0, &records[0].id, "stash-restored").unwrap();
    assert_eq!(repository.oid(), base);
    assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"working\n");
    assert_eq!(fs::read(repository.0.join("new")).unwrap(), b"untracked\n");
    let staged = run_git(&repository.0, &["show", ":file"]).unwrap().stdout;
    assert_eq!(staged, b"staged\n");
}

fn delete_stash_and_check_refusal(repository: &Repository) {
    let missing = drop_stash(&repository.0, "stash@{9}").unwrap_err();
    assert_eq!(missing.kind, "staleStash");
    assert!(operation_recoveries(&repository.0).unwrap().is_empty());
}
