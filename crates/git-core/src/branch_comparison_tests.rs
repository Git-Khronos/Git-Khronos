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
    let before = squashed.git(&["rev-parse", "main"]);
    integrate_branch(squashed.path(), "feature", "squash").unwrap();
    assert_eq!(squashed.git(&["rev-parse", "main"]), before);
    assert_eq!(
        squashed.git(&["diff", "--cached", "--name-only"]),
        "feature-0"
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
