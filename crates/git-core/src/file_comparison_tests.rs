use super::*;
use serde_json::json;

struct Repository(PathBuf);
impl Repository {
    fn new(format: &str) -> Self {
        let mut nonce = [0; 12];
        getrandom::fill(&mut nonce).unwrap();
        let suffix: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        let value = Self(std::env::temp_dir().join(format!("khronos-file-comparison-{suffix}")));
        fs::create_dir(&value.0).unwrap();
        value.git(&["init", "--initial-branch=main", "--object-format", format]);
        for (key, data) in [
            ("user.name", "Owned Comparison Fixture"),
            ("user.email", "comparison@example.test"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", "/dev/null"),
        ] {
            value.git(&["config", key, data]);
        }
        value
    }
    fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = run_git(&self.0, args).unwrap();
        ensure_success("inspect owned comparison fixture", &output).unwrap();
        output.stdout
    }
    fn oid(&self, expression: &str) -> String {
        String::from_utf8(self.git(&["rev-parse", expression]))
            .unwrap()
            .trim()
            .into()
    }
    fn write(&self, file: &str, data: &[u8]) {
        fs::write(self.0.join(file), data).unwrap();
    }
    fn commit(&self, message: &str) -> String {
        self.git(&["add", "--all"]);
        self.git(&["commit", "-qm", message]);
        self.oid("HEAD")
    }
    fn request(
        &self,
        context: FileComparisonContext,
        file: &str,
        previous: Option<&str>,
    ) -> FileComparisonRequest {
        FileComparisonRequest {
            context,
            path: file.into(),
            previous_path: previous.map(str::to_owned),
        }
    }
    fn compare(
        &self,
        context: FileComparisonContext,
        file: &str,
        previous: Option<&str>,
    ) -> FileComparisonContent {
        read_file_comparison(
            &self.0,
            &self.request(context, file, previous),
            &CancellationToken::default(),
        )
        .unwrap()
    }
}
impl Drop for Repository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn available(side: &FileComparisonSide) -> &FileContent {
    let FileComparisonValue::Available(content) = &side.content else {
        panic!("Expected available fixture content")
    };
    content
}
fn bytes(side: &FileComparisonSide) -> &[u8] {
    available(side).bytes.as_deref().unwrap()
}

#[test]
fn root_and_parent_commit_sides_use_actual_header_parents_not_message_text() {
    for format in ["sha1", "sha256"] {
        let repo = Repository::new(format);
        repo.write("image", b"root\0");
        let root = repo.commit(&format!(
            "Root\n\nparent {}\n",
            "a".repeat(if format == "sha256" { 64 } else { 40 })
        ));
        let content = repo.compare(
            FileComparisonContext::Commit { oid: root.clone() },
            "image",
            None,
        );
        assert_eq!(available(&content.before).kind, FileContentKind::Absent);
        assert_eq!(bytes(&content.after), b"root\0");
        repo.write("image", b"next\0");
        let next = repo.commit("Next");
        let content = repo.compare(
            FileComparisonContext::Commit { oid: next.clone() },
            "image",
            None,
        );
        assert_eq!(
            content.before.location,
            Some(FileContentLocation::Revision(root))
        );
        assert_eq!(bytes(&content.before), b"root\0");
        assert_eq!(bytes(&content.after), b"next\0");
        assert_eq!(
            content.after.location,
            Some(FileContentLocation::Revision(next))
        );
    }
}

#[test]
fn deleted_added_and_renamed_file_sides_preserve_the_selected_paths_and_objects() {
    let repo = Repository::new("sha1");
    repo.write("old *.img", b"owned\0image");
    let base = repo.commit("Base");
    fs::rename(repo.0.join("old *.img"), repo.0.join(":(glob)new.img")).unwrap();
    let target = repo.commit("Rename");
    assert!(
        String::from_utf8(repo.git(&["diff", "--name-status", "-M", &base, &target]))
            .unwrap()
            .contains("R100")
    );
    let pair = repo.compare(
        FileComparisonContext::Revisions {
            base_oid: base.clone(),
            target_oid: target.clone(),
        },
        ":(glob)new.img",
        Some("old *.img"),
    );
    assert_eq!(pair.before.path, "old *.img");
    assert_eq!(pair.after.path, ":(glob)new.img");
    assert_eq!(bytes(&pair.before), bytes(&pair.after));
    fs::remove_file(repo.0.join(":(glob)new.img")).unwrap();
    let deleted = repo.commit("Delete");
    let pair = repo.compare(
        FileComparisonContext::Revisions {
            base_oid: target,
            target_oid: deleted,
        },
        ":(glob)new.img",
        None,
    );
    assert_eq!(bytes(&pair.before), b"owned\0image");
    assert_eq!(available(&pair.after).kind, FileContentKind::Absent);
    let pair = repo.compare(
        FileComparisonContext::Revisions {
            base_oid: base,
            target_oid: repo.oid("HEAD~1"),
        },
        ":(glob)new.img",
        None,
    );
    assert_eq!(available(&pair.before).kind, FileContentKind::Absent);
    assert_eq!(bytes(&pair.after), b"owned\0image");
}

#[test]
#[cfg(unix)]
fn head_index_working_and_selected_revision_remain_distinct_without_mutation() {
    let repo = Repository::new("sha1");
    repo.write("image", b"head\0");
    let base = repo.commit("Base");
    repo.write("image", b"index\0");
    repo.git(&["add", "--", "image"]);
    repo.write("image", b"working\0");
    let index = fs::read(repo.0.join(".git/index")).unwrap();
    let config = fs::read(repo.0.join(".git/config")).unwrap();
    let refs = repo.git(&["show-ref"]);
    let staged = repo.compare(
        FileComparisonContext::WorkingTree { staged: true },
        "image",
        None,
    );
    assert_eq!(bytes(&staged.before), b"head\0");
    assert_eq!(bytes(&staged.after), b"index\0");
    let working = repo.compare(
        FileComparisonContext::WorkingTree { staged: false },
        "image",
        None,
    );
    assert_eq!(bytes(&working.before), b"index\0");
    assert_eq!(bytes(&working.after), b"working\0");
    let selected = repo.compare(
        FileComparisonContext::RevisionWorktree { base_oid: base },
        "image",
        None,
    );
    assert_eq!(bytes(&selected.before), b"head\0");
    assert_eq!(bytes(&selected.after), b"working\0");
    assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(repo.0.join(".git/config")).unwrap(), config);
    assert_eq!(repo.git(&["show-ref"]), refs);
    assert_eq!(fs::read(repo.0.join("image")).unwrap(), b"working\0");
}

#[test]
#[cfg(unix)]
fn an_unborn_head_has_no_before_side_but_keeps_the_actual_index_content() {
    let repo = Repository::new("sha1");
    repo.write("image", b"first\0");
    repo.git(&["add", "--", "image"]);
    let content = repo.compare(
        FileComparisonContext::WorkingTree { staged: true },
        "image",
        None,
    );
    assert_eq!(available(&content.before).kind, FileContentKind::Absent);
    assert_eq!(bytes(&content.after), b"first\0");
    fs::write(repo.0.join(".git/refs/heads/main"), "not an object\n").unwrap();
    assert!(
        read_file_comparison(
            &repo.0,
            &repo.request(
                FileComparisonContext::WorkingTree { staged: true },
                "image",
                None
            ),
            &CancellationToken::default()
        )
        .is_err()
    );
}

#[test]
fn a_merge_commit_uses_its_first_parent_as_the_defined_default_comparison() {
    let repo = Repository::new("sha1");
    repo.write("image", b"base\0");
    repo.commit("Base");
    repo.git(&["checkout", "-qb", "side"]);
    repo.write("image", b"side\0");
    repo.commit("Side");
    repo.git(&["checkout", "-q", "main"]);
    repo.write("main-only", b"main");
    let main = repo.commit("Main");
    repo.git(&["merge", "--no-ff", "-m", "Owned merge", "side"]);
    let merged = repo.oid("HEAD");
    let pair = repo.compare(FileComparisonContext::Commit { oid: merged }, "image", None);
    assert_eq!(
        pair.before.location,
        Some(FileContentLocation::Revision(main))
    );
    assert_eq!(bytes(&pair.before), b"base\0");
    assert_eq!(bytes(&pair.after), b"side\0");
}

#[test]
fn a_shallow_boundary_is_not_misreported_as_a_root_commit_or_an_absent_parent() {
    let repo = Repository::new("sha1");
    repo.write("image", b"old\0");
    let parent = repo.commit("Base");
    repo.write("image", b"new\0");
    let target = repo.commit("Tip");
    fs::write(repo.0.join(".git/shallow"), format!("{target}\n")).unwrap();
    let pair = repo.compare(
        FileComparisonContext::Commit {
            oid: target.clone(),
        },
        "image",
        None,
    );
    assert_eq!(bytes(&pair.before), b"old\0");
    assert_eq!(bytes(&pair.after), b"new\0");
    fs::remove_file(
        repo.0
            .join(".git/objects")
            .join(&parent[..2])
            .join(&parent[2..]),
    )
    .unwrap();
    let incomplete = repo.compare(FileComparisonContext::Commit { oid: target }, "image", None);
    assert!(matches!(
        incomplete.before.content,
        FileComparisonValue::Unavailable(_)
    ));
    assert_eq!(bytes(&incomplete.after), b"new\0");
}

#[test]
fn stash_layers_and_untracked_tree_do_not_read_current_working_copy_data() {
    for format in ["sha1", "sha256"] {
        let repo = Repository::new(format);
        repo.write("image", b"base\0");
        repo.commit("Base");
        repo.write("image", b"index\0");
        repo.git(&["add", "--", "image"]);
        repo.write("image", b"saved working\0");
        repo.write("untracked", b"saved untracked\0");
        repo.git(&["stash", "push", "--include-untracked", "-m", "Owned stash"]);
        let stash = repo.oid("refs/stash");
        repo.write("image", b"current unrelated\0");
        repo.write("untracked", b"current different\0");
        for (layer, before, after) in [
            (
                StashContentLayer::Combined,
                b"base\0".as_slice(),
                b"saved working\0".as_slice(),
            ),
            (StashContentLayer::Index, b"base\0", b"index\0"),
            (
                StashContentLayer::WorkingTree,
                b"index\0",
                b"saved working\0",
            ),
        ] {
            let pair = repo.compare(
                FileComparisonContext::Stash {
                    oid: stash.clone(),
                    layer,
                },
                "image",
                None,
            );
            assert_eq!(bytes(&pair.before), before);
            assert_eq!(bytes(&pair.after), after);
        }
        for layer in [StashContentLayer::Combined, StashContentLayer::Untracked] {
            let pair = repo.compare(
                FileComparisonContext::Stash {
                    oid: stash.clone(),
                    layer,
                },
                "untracked",
                None,
            );
            assert_eq!(available(&pair.before).kind, FileContentKind::Absent);
            assert_eq!(bytes(&pair.after), b"saved untracked\0");
        }
        assert_eq!(
            fs::read(repo.0.join("image")).unwrap(),
            b"current unrelated\0"
        );
        assert_eq!(repo.oid("refs/stash"), stash);
    }
}

#[test]
fn a_stash_without_untracked_parent_has_no_untracked_side_and_plain_commits_are_refused() {
    let repo = Repository::new("sha1");
    repo.write("image", b"base\0");
    let base = repo.commit("Base");
    repo.write("image", b"saved\0");
    repo.git(&["stash", "push", "-m", "Owned"]);
    let stash = repo.oid("refs/stash");
    let pair = repo.compare(
        FileComparisonContext::Stash {
            oid: stash,
            layer: StashContentLayer::Untracked,
        },
        "untracked",
        None,
    );
    assert_eq!(available(&pair.before).kind, FileContentKind::Absent);
    assert_eq!(available(&pair.after).kind, FileContentKind::Absent);
    assert!(
        read_file_comparison(
            &repo.0,
            &repo.request(
                FileComparisonContext::Stash {
                    oid: base,
                    layer: StashContentLayer::Combined
                },
                "image",
                None
            ),
            &CancellationToken::default()
        )
        .is_err()
    );
}

#[test]
fn strict_comparison_requests_refuse_expressions_extra_fields_and_early_cancellation() {
    let valid = json!({"context":{"kind":"revisions","baseOid":"a".repeat(40),"targetOid":"b".repeat(40)},"path":"image"});
    assert!(serde_json::from_value::<FileComparisonRequest>(valid.clone()).is_ok());
    let mut extra = valid.clone();
    extra["context"]["plan"] = json!({"path":"outside"});
    assert!(serde_json::from_value::<FileComparisonRequest>(extra).is_err());
    let mut wrong = valid.clone();
    wrong["context"]["baseOid"] = json!(12);
    assert!(serde_json::from_value::<FileComparisonRequest>(wrong).is_err());
    let repo = Repository::new("sha1");
    let request = repo.request(
        FileComparisonContext::Commit {
            oid: "HEAD~1".into(),
        },
        "image",
        None,
    );
    assert!(read_file_comparison(&repo.0, &request, &CancellationToken::default()).is_err());
    let canceled = CancellationToken::default();
    canceled.cancel();
    assert_eq!(
        read_file_comparison(&repo.0, &request, &canceled)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
}

#[test]
fn bare_revision_comparison_works_but_working_comparison_cannot_read_git_metadata() {
    let repo = Repository::new("sha1");
    repo.write("image", b"historical\0");
    let oid = repo.commit("Base");
    repo.git(&["config", "core.bare", "true"]);
    let root = repo.0.join(".git");
    let content = read_file_comparison(
        &root,
        &repo.request(
            FileComparisonContext::Revisions {
                base_oid: oid.clone(),
                target_oid: oid,
            },
            "image",
            None,
        ),
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(bytes(&content.before), b"historical\0");
    assert_eq!(bytes(&content.after), b"historical\0");
    assert!(
        read_file_comparison(
            &root,
            &repo.request(
                FileComparisonContext::WorkingTree { staged: true },
                "config",
                None
            ),
            &CancellationToken::default()
        )
        .is_err()
    );
}

#[test]
fn a_missing_target_blob_is_explicitly_unavailable_without_hiding_the_readable_before_side() {
    let repo = Repository::new("sha1");
    repo.write("image", b"before\0");
    repo.commit("Base");
    repo.write("image", b"after\0");
    let target = repo.commit("Target");
    let blob = repo.oid(&format!("{target}:image"));
    fs::remove_file(
        repo.0
            .join(".git/objects")
            .join(&blob[..2])
            .join(&blob[2..]),
    )
    .unwrap();
    let pair = repo.compare(FileComparisonContext::Commit { oid: target }, "image", None);
    assert_eq!(bytes(&pair.before), b"before\0");
    assert!(matches!(
        pair.after.content,
        FileComparisonValue::Unavailable(_)
    ));
    assert_eq!(fs::read(repo.0.join("image")).unwrap(), b"after\0");
}

#[test]
fn staged_rename_discovers_its_native_original_path_without_a_client_hint() {
    let repo = Repository::new("sha1");
    repo.write("original *.img", b"original\0pixels");
    repo.commit("Original");
    repo.git(&["mv", "original *.img", ":(glob)destination"]);
    let pair = repo.compare(
        FileComparisonContext::WorkingTree { staged: true },
        ":(glob)destination",
        None,
    );
    assert_eq!(pair.before.path, "original *.img");
    assert_eq!(pair.after.path, ":(glob)destination");
    assert_eq!(bytes(&pair.before), b"original\0pixels");
    assert_eq!(bytes(&pair.after), bytes(&pair.before));
    assert!(
        read_file_comparison(
            &repo.0,
            &repo.request(
                FileComparisonContext::WorkingTree { staged: true },
                ":(glob)destination",
                Some("wrong-original")
            ),
            &CancellationToken::default()
        )
        .is_err()
    );
}

#[test]
fn a_completed_staged_rename_refuses_a_stale_original_path_hint() {
    let repo = Repository::new("sha1");
    repo.write("original", b"old\0image");
    repo.commit("Original");
    repo.git(&["mv", "original", "renamed"]);
    repo.git(&["commit", "-qm", "Complete rename"]);
    let request = repo.request(
        FileComparisonContext::WorkingTree { staged: true },
        "renamed",
        Some("original"),
    );
    assert_eq!(
        read_file_comparison(&repo.0, &request, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "fileComparisonRefused"
    );
}
