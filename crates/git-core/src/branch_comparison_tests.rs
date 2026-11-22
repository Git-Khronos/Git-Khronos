use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("khronos-compare-{}-{id}", std::process::id()));
        fs::create_dir(&root).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Test"],
            vec!["config", "user.email", "test@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            run_mutation(&root, &args, "initialize fixture").unwrap();
        }
        let fixture = Self(root);
        fixture.commit_file("base", "Baseline");
        fixture
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn git(&self, args: &[&str]) -> String {
        let output = run_git(&self.0, args).unwrap();
        ensure_success("fixture git", &output).unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn commit_file(&self, file: &str, message: &str) {
        fs::write(self.0.join(file), format!("{message}\n")).unwrap();
        stage_all(&self.0).unwrap();
        commit(&self.0, message).unwrap();
    }

    /// `main` gains `ahead` commits and `feature` gains `behind` commits after
    /// a shared baseline; HEAD ends on `main`.
    fn diverge(&self, ahead: usize, behind: usize) {
        self.git(&["branch", "feature"]);
        for index in 0..ahead {
            self.commit_file(&format!("main-{index}"), &format!("Main {index}"));
        }
        self.git(&["switch", "-q", "feature"]);
        for index in 0..behind {
            self.commit_file(&format!("feature-{index}"), &format!("Feature {index}"));
        }
        self.git(&["switch", "-q", "main"]);
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn comparison_lists_commits_unique_to_each_branch() {
    let fixture = Fixture::new();
    fixture.diverge(1, 2);
    let comparison = compare_branches(fixture.path(), "main", "feature").unwrap();
    assert_eq!(comparison.incoming_count, 2);
    assert_eq!(comparison.outgoing_count, 1);
    assert_eq!(comparison.outgoing_published, 0);
    let incoming: Vec<_> = comparison
        .incoming
        .iter()
        .map(|c| c.subject.as_str())
        .collect();
    assert_eq!(incoming, ["Feature 1", "Feature 0"]);
    assert_eq!(comparison.outgoing[0].subject, "Main 0");
    assert_eq!(comparison.outgoing[0].author, "Test");
    assert_eq!(comparison.target_oid, fixture.git(&["rev-parse", "main"]));
    assert_eq!(
        comparison.source_oid,
        fixture.git(&["rev-parse", "feature"])
    );
    assert_eq!(
        comparison.merge_base.as_deref(),
        Some(fixture.git(&["merge-base", "main", "feature"]).as_str())
    );
}

#[test]
fn comparison_reports_behind_up_to_date_and_published_commits() {
    let fixture = Fixture::new();
    fixture.diverge(0, 3);
    let behind = compare_branches(fixture.path(), "main", "feature").unwrap();
    assert_eq!((behind.incoming_count, behind.outgoing_count), (3, 0));
    let reverse = compare_branches(fixture.path(), "feature", "main").unwrap();
    assert_eq!((reverse.incoming_count, reverse.outgoing_count), (0, 3));

    // Commits reachable from a remote-tracking ref count as published.
    fixture.git(&["update-ref", "refs/remotes/origin/feature", "feature~1"]);
    let published = compare_branches(fixture.path(), "feature", "main").unwrap();
    assert_eq!(published.outgoing_published, 2);
}

#[test]
fn comparison_handles_many_commits_unrelated_histories_and_bad_names() {
    let fixture = Fixture::new();
    fixture.diverge(0, 25);
    let comparison = compare_branches(fixture.path(), "main", "feature").unwrap();
    assert_eq!(comparison.incoming_count, 25);
    assert_eq!(comparison.incoming.len(), 20);

    fixture.git(&["switch", "-q", "--orphan", "island"]);
    fixture.commit_file("island", "Island");
    let unrelated = compare_branches(fixture.path(), "main", "island").unwrap();
    assert_eq!(unrelated.merge_base, None);
    assert_eq!(unrelated.incoming_count, 1);

    assert_eq!(
        compare_branches(fixture.path(), "main", "missing")
            .unwrap_err()
            .kind,
        "branchNotFound"
    );
    assert_eq!(
        compare_branches(fixture.path(), "main", "-x")
            .unwrap_err()
            .kind,
        "invalidBranchName"
    );
}

#[test]
fn fast_forward_moves_only_a_branch_that_is_behind() {
    let fixture = Fixture::new();
    fixture.diverge(0, 2);
    integrate_branch(fixture.path(), "feature", "ff-only").unwrap();
    assert_eq!(
        fixture.git(&["rev-parse", "main"]),
        fixture.git(&["rev-parse", "feature"])
    );

    let diverged = Fixture::new();
    diverged.diverge(1, 1);
    let before = diverged.git(&["rev-parse", "main"]);
    assert!(integrate_branch(diverged.path(), "feature", "ff-only").is_err());
    assert_eq!(diverged.git(&["rev-parse", "main"]), before);
    assert_eq!(diverged.git(&["status", "--porcelain"]), "");
}

#[test]
fn merge_squash_and_rebase_keep_their_git_semantics() {
    let merged = Fixture::new();
    merged.diverge(1, 1);
    integrate_branch(merged.path(), "feature", "merge").unwrap();
    assert_eq!(
        merged
            .git(&["rev-list", "--parents", "-n1", "main"])
            .split(' ')
            .count(),
        3
    );

    let squashed = Fixture::new();
    squashed.diverge(1, 1);
    squashed.git(&["config", "branch.main.mergeOptions", "--no-squash"]);
    fs::write(squashed.path().join(".git/info/exclude"), "/settings.local\n").unwrap();
    fs::write(squashed.path().join("settings.local"), "Keep local settings\n").unwrap();
    let before = squashed.git(&["rev-parse", "main"]);
    integrate_branch(squashed.path(), "feature", "squash").unwrap();
    assert_eq!(squashed.git(&["rev-parse", "main"]), before);
    assert_eq!(
        squashed.git(&["diff", "--cached", "--name-only"]),
        "feature-0"
    );
    assert_eq!(
        fs::read_to_string(squashed.path().join("settings.local")).unwrap(),
        "Keep local settings\n"
    );

    let rebased = Fixture::new();
    rebased.diverge(2, 1);
    integrate_branch(rebased.path(), "feature", "rebase").unwrap();
    assert_eq!(
        rebased.git(&["rev-parse", "main~2"]),
        rebased.git(&["rev-parse", "feature"])
    );
    assert_eq!(rebased.git(&["log", "-1", "--format=%s", "main"]), "Main 1");
}

fn integration_review(fixture: &Fixture) -> BranchIntegrationReview {
    let comparison = compare_branches(fixture.path(), "main", "feature").unwrap();
    BranchIntegrationReview {
        receiving_branch: comparison.target,
        receiving_oid: comparison.target_oid,
        source_branch: comparison.source,
        source_oid: comparison.source_oid,
    }
}

#[test]
fn reviewed_branch_integration_honors_selected_mode_over_squash_defaults() {
    for (strategy, ahead, ignored) in
        [("merge", 1, false), ("merge", 1, true), ("ff-only", 0, true)]
    {
        let fixture = Fixture::new();
        fixture.diverge(ahead, 1);
        fixture.git(&["config", "branch.main.mergeOptions", "--squash"]);
        if ignored {
            fs::write(fixture.path().join(".git/info/exclude"), "/settings.local\n").unwrap();
            fs::write(fixture.path().join("settings.local"), "Keep local settings\n").unwrap();
        }
        let config = fs::read(fixture.path().join(".git/config")).unwrap();
        let review = integration_review(&fixture);
        integrate_branch_with_review(fixture.path(), "feature", strategy, Some(&review)).unwrap();
        if ahead > 0 {
            assert_eq!(
                fixture.git(&["show", "-s", "--format=%P", "HEAD"]),
                format!("{} {}", review.receiving_oid, review.source_oid)
            );
        } else {
            assert_eq!(fixture.git(&["rev-parse", "HEAD"]), review.source_oid);
        }
        if ignored {
            assert_eq!(
                fs::read_to_string(fixture.path().join("settings.local")).unwrap(),
                "Keep local settings\n"
            );
        }
        assert_eq!(fixture.git(&["status", "--porcelain"]), "");
        assert_eq!(fs::read(fixture.path().join(".git/config")).unwrap(), config);
    }
}

#[test]
fn abort_rebase_preserves_ignored_data_and_uses_the_original_state_for_both_backends() {
    for backend in ["--merge", "--apply"] {
        let fixture = Fixture::new();
        fixture.commit_file("restore", "Original tracked file");
        fixture.commit_file("conflict", "Original text");
        fixture.commit_file("shared", "Tracked in both rebase trees");
        fixture.git(&["switch", "-c", "upstream"]);
        fixture.git(&["rm", "restore"]);
        fixture.commit_file("conflict", "Upstream text");
        fixture.git(&["switch", "main"]);
        fixture.commit_file("conflict", "Local text");
        let original = fixture.git(&["rev-parse", "HEAD"]);
        run_mutation(
            fixture.path(),
            &["rebase", backend, "upstream"],
            "begin owned rebase",
        )
        .unwrap_err();
        let before = fixture.git(&["rev-parse", "HEAD"]);
        assert_ne!(before, original);
        fixture.git(&["update-ref", "ORIG_HEAD", &before]);
        // shared is present in both commits but is untracked during the abort.
        fixture.git(&["rm", "--cached", "shared"]);
        fs::write(
            fixture.path().join(".git/info/exclude"),
            "/restore\n/shared\n",
        )
        .unwrap();
        fs::write(fixture.path().join("restore"), "Ignored-only copy\n").unwrap();
        fs::write(fixture.path().join("shared"), "Another ignored-only copy\n").unwrap();
        let status = read_status(fixture.path()).unwrap();
        assert!(status.rebase_in_progress, "{backend}");
        assert!(!status.mail_patch_in_progress, "{backend}");
        let index = fs::read(fixture.path().join(".git/index")).unwrap();
        let state = if backend == "--merge" {
            ".git/rebase-merge/orig-head"
        } else {
            ".git/rebase-apply/orig-head"
        };
        let state = fixture.path().join(state);
        let saved_state = fs::read(&state).unwrap();
        fs::write(&state, "not an object id\n").unwrap();
        assert_eq!(
            abort_rebase(fixture.path()).unwrap_err().kind,
            "rebaseAbortIgnoredPathsUnverified"
        );
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), before);
        assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
        fs::write(state, saved_state).unwrap();

        for name in ["restore", "shared"] {
            let error = abort_rebase(fixture.path()).unwrap_err();
            assert_eq!(error.kind, "rebaseAbortLocalPathObstruction", "{backend}");
            assert!(error.message.contains(name), "{} {name}", error.message);
            assert_eq!(fixture.git(&["rev-parse", "HEAD"]), before);
            assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
            assert!(read_status(fixture.path()).unwrap().rebase_in_progress);
            fs::rename(
                fixture.path().join(name),
                fixture.path().join(format!("{name}.kept")),
            )
            .unwrap();
        }

        abort_rebase(fixture.path()).unwrap();
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), original);
        assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
        assert!(!read_status(fixture.path()).unwrap().rebase_in_progress);
        assert_eq!(
            fs::read_to_string(fixture.path().join("restore.kept")).unwrap(),
            "Ignored-only copy\n"
        );
        assert_eq!(
            fs::read_to_string(fixture.path().join("shared.kept")).unwrap(),
            "Another ignored-only copy\n"
        );
    }
}

#[test]
fn abort_rebase_preserves_ignored_files_that_autostash_would_restore() {
    for (backend, directory) in [
        ("--merge", "rebase-merge"),
        ("--apply", "rebase-apply"),
    ] {
        let fixture = Fixture::new();
        fixture.commit_file("conflict", "Base");
        fixture.git(&["switch", "-c", "upstream"]);
        fixture.commit_file("conflict", "Upstream");
        fixture.git(&["switch", "main"]);
        fixture.commit_file("conflict", "Current");
        let original = fixture.git(&["rev-parse", "HEAD"]);
        let local_copy = fixture.path().join("new.local");
        fs::write(&local_copy, "Staged before rebase").unwrap();
        fixture.git(&["add", "new.local"]);
        run_mutation(
            fixture.path(),
            &["rebase", backend, "--autostash", "upstream"],
            "begin owned rebase with autostash",
        )
        .unwrap_err();
        let autostash = fixture.path().join(".git").join(directory).join("autostash");
        let stash_bytes = fs::read(&autostash).unwrap();
        let stopped = fixture.git(&["rev-parse", "HEAD"]);
        assert_ne!(original, stopped);
        assert!(!local_copy.exists());
        fs::write(
            fixture.path().join(".git/info/exclude"),
            "/new.local\n/new.saved\n",
        )
        .unwrap();
        fs::write(&local_copy, "Created during stopped rebase").unwrap();
        let index = fs::read(fixture.path().join(".git/index")).unwrap();

        fs::write(&autostash, "malformed stash object id\n").unwrap();
        assert_eq!(
            abort_rebase(fixture.path()).unwrap_err().kind,
            "rebaseAbortIgnoredPathsUnverified"
        );
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), stopped);
        assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
        #[cfg(unix)]
        {
            let outside = fixture.path().join(".git").join("owned-autostash-copy");
            fs::write(&outside, &stash_bytes).unwrap();
            fs::remove_file(&autostash).unwrap();
            std::os::unix::fs::symlink(&outside, &autostash).unwrap();
            assert_eq!(
                abort_rebase(fixture.path()).unwrap_err().kind,
                "rebaseAbortIgnoredPathsUnverified"
            );
            assert_eq!(fs::read(outside).unwrap(), stash_bytes);
            assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
            fs::remove_file(&autostash).unwrap();
        }
        fs::write(&autostash, &stash_bytes).unwrap();

        let error = abort_rebase(fixture.path()).unwrap_err();
        assert_eq!(error.kind, "rebaseAbortLocalPathObstruction", "{backend}");
        assert!(error.message.contains("new.local"), "{error:?}");
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), stopped);
        assert_eq!(fixture.git(&["rev-parse", "main"]), original);
        assert_eq!(fs::read(&autostash).unwrap(), stash_bytes);
        assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read_to_string(&local_copy).unwrap(),
            "Created during stopped rebase"
        );
        assert!(read_status(fixture.path()).unwrap().rebase_in_progress);

        let saved = local_copy.with_extension("saved");
        fs::rename(&local_copy, &saved).unwrap();
        abort_rebase(fixture.path()).unwrap();
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), original);
        assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
        assert_eq!(
            fs::read_to_string(local_copy).unwrap(),
            "Staged before rebase"
        );
        assert_eq!(
            fs::read_to_string(saved).unwrap(),
            "Created during stopped rebase"
        );
        assert!(!autostash.exists());
        assert!(!read_status(fixture.path()).unwrap().rebase_in_progress);
    }
}

#[test]
fn skipping_either_rebase_backend_preserves_ignored_files_restored_from_head() {
    for backend in ["--merge", "--apply"] {
        let fixture = Fixture::new();
        fixture.commit_file("conflict", "Base");
        fixture.git(&["switch", "-c", "upstream"]);
        fixture.commit_file("conflict", "Upstream");
        fixture.git(&["switch", "main"]);
        fixture.commit_file("conflict", "Local");
        let original = fixture.git(&["rev-parse", "HEAD"]);
        run_mutation(
            fixture.path(),
            &["rebase", backend, "upstream"],
            "begin owned rebase",
        )
        .unwrap_err();
        let head = fixture.git(&["rev-parse", "HEAD"]);
        assert_ne!(original, head);
        let local_copy = replace_conflict_with_ignored_file(&fixture);
        let index = fs::read(fixture.path().join(".git/index")).unwrap();

        let error = skip_rebase(fixture.path()).unwrap_err();
        assert_eq!(error.kind, "rebaseSkipLocalPathObstruction", "{backend}");
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
        assert_eq!(fixture.git(&["rev-parse", "main"]), original);
        assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read_to_string(&local_copy).unwrap(),
            "Local ignored data"
        );
        assert!(read_status(fixture.path()).unwrap().rebase_in_progress);

        let saved = local_copy.with_extension("saved");
        fs::rename(&local_copy, &saved).unwrap();
        skip_rebase(fixture.path()).unwrap();
        assert_eq!(fixture.git(&["rev-parse", "main"]), head);
        assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
        assert_eq!(fs::read_to_string(&local_copy).unwrap(), "Upstream\n");
        assert_eq!(fs::read_to_string(saved).unwrap(), "Local ignored data");
        assert_eq!(
            fs::read_to_string(fixture.path().join("unrelated.local")).unwrap(),
            "Unrelated"
        );
        assert!(!read_status(fixture.path()).unwrap().rebase_in_progress);
    }
}

#[test]
fn aborting_merge_preserves_ignored_files_restored_from_head() {
    let fixture = Fixture::new();
    fixture.commit_file("conflict", "Base");
    let base = fixture.git(&["rev-parse", "HEAD"]);
    fixture.git(&["switch", "-c", "upstream"]);
    fixture.commit_file("conflict", "Upstream");
    fixture.git(&["switch", "main"]);
    fixture.commit_file("conflict", "Current");
    let head = fixture.git(&["rev-parse", "HEAD"]);
    run_mutation(
        fixture.path(),
        &["merge", "--no-edit", "upstream"],
        "begin owned merge",
    )
    .unwrap_err();
    fixture.git(&["update-ref", "ORIG_HEAD", &base]);
    let local_copy = replace_conflict_with_ignored_file(&fixture);
    let index = fs::read(fixture.path().join(".git/index")).unwrap();
    let merge_head = fixture.git(&["rev-parse", "MERGE_HEAD"]);

    let error = abort_merge(fixture.path()).unwrap_err();
    assert_eq!(error.kind, "mergeAbortLocalPathObstruction");
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(fixture.git(&["rev-parse", "MERGE_HEAD"]), merge_head);
    assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read_to_string(&local_copy).unwrap(),
        "Local ignored data"
    );
    assert!(repository_operation_state(fixture.path()).unwrap().merge);

    let saved = local_copy.with_extension("saved");
    fs::rename(&local_copy, &saved).unwrap();
    abort_merge(fixture.path()).unwrap();
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(fs::read_to_string(local_copy).unwrap(), "Current\n");
    assert_eq!(fs::read_to_string(saved).unwrap(), "Local ignored data");
    assert_eq!(
        fs::read_to_string(fixture.path().join("unrelated.local")).unwrap(),
        "Unrelated"
    );
    assert!(!repository_operation_state(fixture.path()).unwrap().merge);
}

#[test]
fn aborting_merge_preserves_ignored_files_that_autostash_would_restore() {
    let fixture = Fixture::new();
    fixture.commit_file("conflict", "Base");
    fixture.git(&["switch", "-c", "upstream"]);
    fixture.commit_file("conflict", "Upstream");
    fixture.git(&["switch", "main"]);
    fixture.commit_file("conflict", "Current");
    let head = fixture.git(&["rev-parse", "HEAD"]);
    fs::write(fixture.path().join("new.local"), "Staged before merge").unwrap();
    fixture.git(&["add", "new.local"]);
    run_mutation(
        fixture.path(),
        &["merge", "--autostash", "--no-edit", "upstream"],
        "begin owned merge with autostash",
    )
    .unwrap_err();
    let autostash = fixture.git(&["rev-parse", "MERGE_AUTOSTASH"]);
    let index = fs::read(fixture.path().join(".git/index")).unwrap();
    let local_copy = fixture.path().join("new.local");
    assert!(!local_copy.exists());
    fs::write(fixture.path().join(".git/info/exclude"), "/new.local\n").unwrap();
    fs::write(&local_copy, "Created during conflicted merge").unwrap();

    let error = abort_merge(fixture.path()).unwrap_err();
    assert_eq!(error.kind, "mergeAbortLocalPathObstruction");
    assert!(error.message.contains("new.local"));
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(fixture.git(&["rev-parse", "MERGE_AUTOSTASH"]), autostash);
    assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read_to_string(&local_copy).unwrap(),
        "Created during conflicted merge"
    );
    assert!(repository_operation_state(fixture.path()).unwrap().merge);

    let saved = local_copy.with_extension("saved");
    fs::rename(&local_copy, &saved).unwrap();
    // An unrelated ignored file keeps the preflight enabled on the retry.
    fs::write(
        fixture.path().join(".git/info/exclude"),
        "/new.local\n/new.saved\n",
    )
    .unwrap();
    abort_merge(fixture.path()).unwrap();
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(
        fs::read_to_string(local_copy).unwrap(),
        "Staged before merge"
    );
    assert_eq!(
        fs::read_to_string(saved).unwrap(),
        "Created during conflicted merge"
    );
    assert!(!fixture.path().join(".git/MERGE_AUTOSTASH").exists());
    assert!(!repository_operation_state(fixture.path()).unwrap().merge);
}

fn replace_conflict_with_ignored_file(fixture: &Fixture) -> PathBuf {
    fixture.git(&["rm", "-f", "conflict"]);
    fs::write(
        fixture.path().join(".git/info/exclude"),
        "/conflict\n/unrelated.local\n",
    )
    .unwrap();
    fs::write(fixture.path().join("unrelated.local"), "Unrelated").unwrap();
    let local_copy = fixture.path().join("conflict");
    fs::write(&local_copy, "Local ignored data").unwrap();
    assert_eq!(fixture.git(&["check-ignore", "conflict"]), "conflict");
    local_copy
}

#[test]
fn rebase_preserves_ignored_files_in_the_way_of_the_new_base() {
    for reviewed in [false, true] {
        let fixture = Fixture::new();
        fixture.diverge(1, 1);
        let review = integration_review(&fixture);
        fs::write(fixture.path().join(".git/info/exclude"), "/feature-0\n").unwrap();
        fs::write(fixture.path().join("feature-0"), "Owned ignored settings\n").unwrap();
        let index = fs::read(fixture.path().join(".git/index")).unwrap();
        let error = integrate_branch_with_review(
            fixture.path(),
            "feature",
            "rebase",
            reviewed.then_some(&review),
        )
        .unwrap_err();
        assert_eq!(error.kind, "rebaseLocalPathObstruction");
        assert!(error.message.contains("feature-0"));
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), review.receiving_oid);
        assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
        assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read_to_string(fixture.path().join("feature-0")).unwrap(),
            "Owned ignored settings\n"
        );
        assert!(!read_status(fixture.path()).unwrap().rebase_in_progress);
    }
}

#[test]
fn interactive_rebase_checks_both_the_source_checkout_and_the_base() {
    for (source, target) in [("main", "feature"), ("feature", "main")] {
        let fixture = Fixture::new();
        fixture.diverge(1, 1);
        // An incoming file must not replace a directory of ignored files.
        fs::create_dir(fixture.path().join("feature-0")).unwrap();
        fs::write(fixture.path().join(".git/info/exclude"), "/feature-0/\n").unwrap();
        let local = fixture.path().join("feature-0/only-copy");
        fs::write(&local, "Owned ignored directory\n").unwrap();
        let plan = prepare_interactive_rebase(fixture.path(), source, target).unwrap();
        let steps = plan
            .commits
            .iter()
            .map(|commit| InteractiveRebaseStep {
                oid: commit.oid.clone(),
                action: "pick".into(),
                message: None,
            })
            .collect::<Vec<_>>();
        let refs = fixture.git(&["for-each-ref"]);
        let index = fs::read(fixture.path().join(".git/index")).unwrap();

        let error = execute_interactive_rebase(fixture.path(), source, target, &steps).unwrap_err();

        assert_eq!(error.kind, "rebaseLocalPathObstruction", "{source}");
        assert!(error.message.contains("feature-0/only-copy"));
        assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
        assert_eq!(fixture.git(&["for-each-ref"]), refs);
        assert_eq!(fs::read(fixture.path().join(".git/index")).unwrap(), index);
        assert_eq!(fs::read_to_string(local).unwrap(), "Owned ignored directory\n");
    }
}

#[test]
fn rebase_preserves_ignored_files_outside_the_initial_base_changes() {
    let fixture = Fixture::new();
    fixture.diverge(1, 1);
    fs::write(fixture.path().join(".git/info/exclude"), "/local.cfg\n").unwrap();
    fs::write(fixture.path().join("local.cfg"), "Owned unrelated settings\n").unwrap();
    let review = integration_review(&fixture);
    integrate_branch_with_review(fixture.path(), "feature", "rebase", Some(&review)).unwrap();
    assert_eq!(fixture.git(&["rev-parse", "HEAD^"]), review.source_oid);
    assert_eq!(
        fs::read_to_string(fixture.path().join("local.cfg")).unwrap(),
        "Owned unrelated settings\n"
    );
}

#[test]
fn integrate_exact_local_branch_even_when_a_tag_shadows_its_name() {
    for (strategy, ahead) in [("merge", 1), ("ff-only", 0), ("squash", 1), ("rebase", 1)] {
        let fixture = Fixture::new();
        fixture.diverge(ahead, 1);
        let branch_tip = fixture.git(&["rev-parse", "refs/heads/feature"]);
        fixture.git(&["tag", "-a", "-m", "Different object", "feature", "HEAD"]);
        assert_ne!(fixture.git(&["rev-parse", "feature^{commit}"]), branch_tip);
        integrate_branch(fixture.path(), "feature", strategy).unwrap();
        assert!(fixture.path().join("feature-0").exists(), "{strategy}");
        if strategy == "ff-only" {
            assert_eq!(fixture.git(&["rev-parse", "HEAD"]), branch_tip);
        } else if strategy == "rebase" {
            assert_eq!(fixture.git(&["rev-parse", "HEAD^"]), branch_tip);
        }
    }
}

#[test]
fn tag_or_remote_name_without_a_local_branch_does_not_satisfy_integration() {
    let fixture = Fixture::new();
    fixture.diverge(0, 1);
    let initial = fixture.git(&["rev-parse", "HEAD"]);
    fixture.git(&["tag", "feature-release", "feature"]);
    fixture.git(&["update-ref", "refs/tags/refs/heads/feature-release", "feature"]);
    fixture.git(&["update-ref", "refs/remotes/origin/feature-release", "feature"]);
    assert_eq!(
        integrate_branch(fixture.path(), "feature-release", "ff-only").unwrap_err().kind,
        "branchNotFound"
    );
    assert_eq!(
        compare_branches(fixture.path(), "main", "feature-release").unwrap_err().kind,
        "branchNotFound"
    );
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), initial);
    assert_eq!(fixture.git(&["status", "--porcelain"]), "");
}

#[test]
fn reviewed_integration_refuses_either_moved_tip_or_another_current_branch() {
    for moved in ["source", "receiving", "different-branch", "detached"] {
        let fixture = Fixture::new();
        fixture.diverge(0, 1);
        let review = integration_review(&fixture);
        match moved {
            "source" => {
                fixture.git(&["switch", "feature"]);
                fixture.commit_file("new-source", "New source tip");
                fixture.git(&["switch", "main"]);
            }
            "receiving" => fixture.commit_file("new-main", "New receiving tip"),
            "different-branch" => {
                fixture.git(&["switch", "-c", "other"]);
            }
            _ => {
                fixture.git(&["switch", "--detach", "HEAD"]);
            }
        }
        fs::write(fixture.path().join("owned.txt"), "unsaved worktree data\n").unwrap();
        let before_head = fixture.git(&["rev-parse", "HEAD"]);
        let before_refs = fixture.git(&["for-each-ref", "refs/heads"]);
        let before_status = fixture.git(&["status", "--porcelain"]);
        assert_eq!(
            integrate_branch_with_review(fixture.path(), "feature", "ff-only", Some(&review))
                .unwrap_err().kind,
            "integrationReviewChanged",
            "{moved}"
        );
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), before_head, "{moved}");
        assert_eq!(fixture.git(&["for-each-ref", "refs/heads"]), before_refs, "{moved}");
        assert_eq!(fixture.git(&["status", "--porcelain"]), before_status, "{moved}");
        assert!(!fixture.path().join("feature-0").exists(), "{moved}");
    }
}

#[test]
fn reviewed_checkout_does_not_switch_if_a_branch_moved_after_preview() {
    let fixture = Fixture::new();
    fixture.diverge(1, 1);
    let review = integration_review(&fixture);
    fixture.git(&["switch", "feature"]);
    fixture.commit_file("new-source", "New source tip");
    assert_eq!(
        checkout_branch_for_integration(fixture.path(), "main", &review).unwrap_err().kind,
        "integrationReviewChanged"
    );
    assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/feature");
    assert!(fixture.path().join("new-source").exists());
}

#[test]
fn reviewed_checkout_then_merge_uses_the_reviewed_object_and_branch_subject() {
    let fixture = Fixture::new();
    fixture.diverge(1, 1);
    let review = integration_review(&fixture);
    fixture.git(&["switch", "feature"]);
    fixture.git(&["tag", "-a", "-m", "Different object", "feature", "refs/heads/main"]);
    checkout_branch_for_integration(fixture.path(), "main", &review).unwrap();
    integrate_branch_with_review(fixture.path(), "feature", "merge", Some(&review)).unwrap();
    assert_eq!(fixture.git(&["rev-parse", "HEAD^2"]), review.source_oid);
    assert_eq!(fixture.git(&["log", "-1", "--format=%s"]), "Merge branch 'feature'");
}

#[test]
fn reviewed_rebase_keeps_sibling_tips_even_when_git_is_configured_to_update_refs() {
    let fixture = Fixture::new();
    fixture.diverge(1, 2);
    fixture.git(&["config", "rebase.updateRefs", "true"]);
    fixture.git(&["branch", "sibling", "feature^"]);
    fixture.git(&["switch", "feature"]);
    let sibling = fixture.git(&["rev-parse", "refs/heads/sibling"]);
    let review = BranchIntegrationReview {
        receiving_branch: "feature".into(),
        receiving_oid: fixture.git(&["rev-parse", "refs/heads/feature"]),
        source_branch: "main".into(),
        source_oid: fixture.git(&["rev-parse", "refs/heads/main"]),
    };
    integrate_branch_with_review(fixture.path(), "main", "rebase", Some(&review)).unwrap();
    assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/feature");
    assert_ne!(fixture.git(&["rev-parse", "HEAD"]), review.receiving_oid);
    assert_eq!(fixture.git(&["rev-parse", "HEAD^^"]), review.source_oid);
    assert_eq!(fixture.git(&["rev-parse", "refs/heads/main"]), review.source_oid);
    assert_eq!(fixture.git(&["rev-parse", "refs/heads/sibling"]), sibling);
    assert_eq!(fixture.git(&["config", "rebase.updateRefs"]), "true");
    assert_eq!(fixture.git(&["status", "--porcelain"]), "");
}
