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
            std::env::temp_dir().join(format!("khronos-ref-rename-{}-{id}", std::process::id()));
        fs::create_dir(&root).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Test"],
            vec!["config", "user.email", "test@example.test"],
            vec!["config", "commit.gpgsign", "false"],
            vec!["config", "tag.gpgsign", "false"],
        ] {
            run_mutation(&root, &args, "initialize fixture").unwrap();
        }
        fs::write(root.join("file"), b"base\n").unwrap();
        stage_all(&root).unwrap();
        commit(&root, "Baseline").unwrap();
        Self(root)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn git(&self, args: &[&str]) -> String {
        let output = run_git(&self.0, args).unwrap();
        ensure_success("fixture git", &output).unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn tip(&self, reference: &str) -> Option<String> {
        reference_tip(&self.0, reference)
    }

    fn head(&self) -> String {
        self.tip("HEAD").unwrap()
    }

    fn add_bare_remote(&self, name: &str) -> PathBuf {
        let remote = self.0.join(format!("{name}.git"));
        run_mutation(
            &self.0,
            &["init", "--bare", remote.to_str().unwrap()],
            "create remote",
        )
        .unwrap();
        add_remote(&self.0, name, remote.to_str().unwrap()).unwrap();
        remote
    }

    fn remote_tip(&self, remote: &Path, reference: &str) -> Option<String> {
        let output = run_git(
            &self.0,
            &[
                "--git-dir",
                remote.to_str().unwrap(),
                "rev-parse",
                "--verify",
                "--quiet",
                reference,
            ],
        )
        .unwrap();
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn token() -> CancellationToken {
    CancellationToken::default()
}

#[test]
fn local_branch_rename_keeps_upstream_and_current_branch() {
    let fixture = Fixture::new();
    fixture.add_bare_remote("origin");
    fixture.git(&["push", "-u", "origin", "main"]);
    rename_branch(fixture.path(), "main", "trunk").unwrap();
    assert_eq!(fixture.git(&["branch", "--show-current"]), "trunk");
    assert_eq!(
        fixture.git(&["rev-parse", "--abbrev-ref", "trunk@{upstream}"]),
        "origin/main"
    );
    assert!(fixture.tip("refs/heads/main").is_none());
}

#[test]
fn local_tag_rename_keeps_lightweight_and_annotated_objects() {
    let fixture = Fixture::new();
    let head = fixture.head();
    create_tag(fixture.path(), "light", &head, None).unwrap();
    create_tag(fixture.path(), "annotated", &head, Some("Release notes")).unwrap();
    let annotated = fixture.tip("refs/tags/annotated").unwrap();
    assert_ne!(annotated, head);

    rename_tag(fixture.path(), "light", "light-2", &head, None, &token()).unwrap();
    rename_tag(
        fixture.path(),
        "annotated",
        "release/v1",
        &head,
        None,
        &token(),
    )
    .unwrap();

    assert!(fixture.tip("refs/tags/light").is_none());
    assert!(fixture.tip("refs/tags/annotated").is_none());
    assert_eq!(fixture.tip("refs/tags/light-2").as_deref(), Some(&*head));
    assert_eq!(
        fixture.tip("refs/tags/release/v1").as_deref(),
        Some(&*annotated)
    );
    assert_eq!(
        fixture
            .git(&["cat-file", "-p", "refs/tags/release/v1"])
            .lines()
            .last(),
        Some("Release notes")
    );
}

#[test]
fn tag_rename_rejects_duplicate_invalid_same_and_stale_names() {
    let fixture = Fixture::new();
    let head = fixture.head();
    create_tag(fixture.path(), "v1", &head, None).unwrap();
    create_tag(fixture.path(), "v2", &head, None).unwrap();
    let kind = |new: &str, expected: &str| {
        rename_tag(fixture.path(), "v1", new, expected, None, &token())
            .unwrap_err()
            .kind
    };
    assert_eq!(kind("v2", &head), "referenceExists");
    assert_eq!(kind("v1", &head), "sameReferenceName");
    assert!(rename_tag(fixture.path(), "v1", "bad..name", &head, None, &token()).is_err());
    assert!(rename_tag(fixture.path(), "v1", "bad name", &head, None, &token()).is_err());
    assert_eq!(kind("v3", &"0".repeat(40)), "staleReference");
    assert_eq!(fixture.tip("refs/tags/v1").as_deref(), Some(&*head));
    assert!(fixture.tip("refs/tags/v3").is_none());
}

#[test]
fn tag_rename_on_remote_renames_both_or_refuses_a_different_remote_object() {
    let fixture = Fixture::new();
    let remote = fixture.add_bare_remote("origin");
    let head = fixture.head();
    create_tag(fixture.path(), "v1", &head, Some("First")).unwrap();
    fixture.git(&["push", "origin", "refs/tags/v1"]);
    let object = remote_tag_object(fixture.path(), "origin", "v1", &token()).unwrap();

    rename_tag(
        fixture.path(),
        "v1",
        "release/v1",
        &head,
        Some(RemoteTagLease {
            remote: "origin",
            expected_object: &object,
        }),
        &token(),
    )
    .unwrap();
    assert!(fixture.remote_tip(&remote, "refs/tags/v1").is_none());
    assert_eq!(
        fixture
            .remote_tip(&remote, "refs/tags/release/v1")
            .as_deref(),
        Some(&*object)
    );
    assert_eq!(
        fixture.tip("refs/tags/release/v1").as_deref(),
        Some(&*object)
    );

    create_tag(fixture.path(), "v2", &head, Some("Second")).unwrap();
    let error = rename_tag(
        fixture.path(),
        "v2",
        "v3",
        &head,
        Some(RemoteTagLease {
            remote: "origin",
            expected_object: &head,
        }),
        &token(),
    )
    .unwrap_err();
    assert_eq!(error.kind, "remoteTagDiffers");
    assert!(fixture.tip("refs/tags/v2").is_some());
    assert!(fixture.remote_tip(&remote, "refs/tags/v3").is_none());
}

#[test]
fn remote_branch_rename_moves_remote_tracking_refs_and_upstreams() {
    let fixture = Fixture::new();
    let remote = fixture.add_bare_remote("origin");
    let head = fixture.head();
    fixture.git(&["switch", "-c", "feature"]);
    fixture.git(&["push", "-u", "origin", "feature"]);
    fixture.git(&["switch", "-c", "other", "--track", "origin/feature"]);
    fixture.git(&["switch", "main"]);

    rename_remote_branch(
        fixture.path(),
        "origin",
        "feature",
        "team/feature",
        &head,
        &token(),
    )
    .unwrap();

    assert!(fixture.remote_tip(&remote, "refs/heads/feature").is_none());
    assert_eq!(
        fixture
            .remote_tip(&remote, "refs/heads/team/feature")
            .as_deref(),
        Some(&*head)
    );
    assert!(fixture.tip("refs/remotes/origin/feature").is_none());
    assert_eq!(
        fixture.tip("refs/remotes/origin/team/feature").as_deref(),
        Some(&*head)
    );
    for branch in ["feature", "other"] {
        assert_eq!(
            fixture.git(&[
                "rev-parse",
                "--abbrev-ref",
                &format!("{branch}@{{upstream}}")
            ]),
            "origin/team/feature"
        );
    }
    assert_eq!(fixture.tip("refs/heads/feature").as_deref(), Some(&*head));
}

#[test]
fn remote_branch_rename_rejects_duplicate_invalid_and_stale_requests() {
    let fixture = Fixture::new();
    let remote = fixture.add_bare_remote("origin");
    let head = fixture.head();
    fixture.git(&["push", "origin", "main", "main:taken"]);
    let rename = |new: &str, expected: &str| {
        rename_remote_branch(fixture.path(), "origin", "main", new, expected, &token())
            .unwrap_err()
            .kind
    };
    assert_eq!(rename("taken", &head), "referenceExists");
    assert_eq!(rename("main", &head), "sameReferenceName");
    assert!(
        rename_remote_branch(
            fixture.path(),
            "origin",
            "main",
            "bad..name",
            &head,
            &token()
        )
        .is_err()
    );
    assert_eq!(rename("renamed", &"0".repeat(40)), "staleReference");
    assert!(rename_remote_branch(fixture.path(), "missing", "main", "x", &head, &token()).is_err());
    assert_eq!(
        fixture.remote_tip(&remote, "refs/heads/main").as_deref(),
        Some(&*head)
    );
    assert!(fixture.remote_tip(&remote, "refs/heads/renamed").is_none());
}

#[test]
fn remote_branch_rename_refuses_when_the_new_name_appeared_on_the_remote() {
    let fixture = Fixture::new();
    let remote = fixture.add_bare_remote("origin");
    let head = fixture.head();
    fixture.git(&["push", "origin", "main"]);
    // Someone else created the target name after our last fetch.
    run_git(
        &fixture.0,
        &[
            "--git-dir",
            remote.to_str().unwrap(),
            "update-ref",
            "refs/heads/renamed",
            &head,
        ],
    )
    .unwrap();
    assert!(
        rename_remote_branch(fixture.path(), "origin", "main", "renamed", &head, &token()).is_err()
    );
    assert_eq!(
        fixture.remote_tip(&remote, "refs/heads/main").as_deref(),
        Some(&*head)
    );
    assert_eq!(
        fixture.tip("refs/remotes/origin/main").as_deref(),
        Some(&*head)
    );
}
