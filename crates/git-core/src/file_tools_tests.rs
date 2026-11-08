use super::*;
use std::{
    fs,
    os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt, symlink},
};

struct Fixture {
    root: PathBuf,
    repo: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("owned-tool-context-{name}"));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let repo = root.join("repository [é] 'literal'");
        fs::create_dir(&repo).unwrap();
        let f = Self { root, repo };
        f.git(&["init", "--template=", "-q", "-b", "main"]);
        let hooks = f.root.join("hooks");
        fs::create_dir(&hooks).unwrap();
        for (key, value) in [
            ("core.hooksPath", hooks.to_str().unwrap()),
            ("core.fsmonitor", "false"),
            ("user.name", "Owned Tool Fixture"),
            ("user.email", "owned-tool@example.test"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
        ] {
            f.git(&["config", key, value]);
        }
        f
    }
    fn git(&self, args: &[&str]) -> String {
        let result = crate::run_git(&self.repo, args).unwrap();
        assert!(
            result.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8(result.stdout)
            .unwrap()
            .trim_end_matches('\n')
            .to_owned()
    }
    fn commit(&self, path: &str, bytes: &[u8]) -> String {
        fs::write(self.repo.join(path), bytes).unwrap();
        self.git(&["add", "--", path]);
        self.git(&["commit", "-qm", "Owned tool fixture commit"]);
        self.git(&["rev-parse", "HEAD"])
    }
    fn parent(&self) -> PathBuf {
        self.root.join("private-snapshots")
    }
    fn uid(&self) -> u32 {
        fs::metadata(&self.root).unwrap().uid()
    }
    fn profile(&self, role: ToolRole, args: &[&str]) -> ToolProfile {
        ToolProfile {
            version: 1,
            id: "owned-file-tool".into(),
            name: "Owned comparison program".into(),
            role,
            executable: "/usr/bin/true".into(),
            arguments: args.iter().map(|s| (*s).into()).collect(),
        }
    }
    fn prepare(&self, request: FileToolRequest, profile: ToolProfile) -> PreparedFileTool {
        prepare_file_tool(
            &self.repo,
            request,
            profile,
            &self.parent(),
            self.uid(),
            &CancellationToken::default(),
        )
        .unwrap()
    }
    fn state(&self) -> (String, Vec<u8>, Vec<u8>, String) {
        (
            self.git(&["show-ref"]),
            fs::read(self.repo.join(".git/index")).unwrap(),
            fs::read(self.repo.join(".git/config")).unwrap(),
            self.git(&["status", "--porcelain=v1", "-z"]),
        )
    }
    fn conflict(&self, base: Option<&[u8]>, ours: &[u8], theirs: &[u8]) {
        self.commit("readme.txt", b"base root\n");
        if let Some(base) = base {
            self.commit("file.txt", base);
        }
        self.git(&["checkout", "-q", "-b", "incoming"]);
        self.commit("file.txt", theirs);
        self.git(&["checkout", "-q", "main"]);
        self.commit("file.txt", ours);
        let result = crate::run_git(&self.repo, &["merge", "--no-edit", "incoming"]).unwrap();
        assert_eq!(result.status.code(), Some(1));
        assert!(!self.git(&["ls-files", "--unmerged"]).is_empty());
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn file_tools_editor_captures_literal_large_untracked_file_without_copies_or_execution() {
    let f = Fixture::new();
    let path = "literal 'é';$(not-a-command){repository}.txt";
    let file = fs::File::create(f.repo.join(path)).unwrap();
    file.set_len(crate::MAX_FILE_CONTENT_BYTES as u64 + 1)
        .unwrap();
    let sentinel = f.root.join("must-not-start");
    let script = f.root.join("owned recorder.py");
    fs::write(
        &script,
        "import pathlib,sys\npathlib.Path(sys.argv[1]).write_text('unexpected launch')\n",
    )
    .unwrap();
    let mut profile = f.profile(ToolRole::Editor, &["{file}:{line}", "{repository}", ""]);
    profile.executable = "/usr/bin/python3".into();
    profile
        .arguments
        .insert(0, sentinel.to_str().unwrap().into());
    profile.arguments.insert(0, script.to_str().unwrap().into());
    let mut plan = f.prepare(
        FileToolRequest::Editor {
            path: path.into(),
            line: Some(42),
        },
        profile,
    );
    assert_eq!(
        plan.review().arguments[2],
        format!("{}:42", f.repo.join(path).display())
    );
    assert_eq!(plan.review().arguments[3], f.repo.to_str().unwrap());
    assert_eq!(plan.review().arguments[4], "");
    assert_eq!(
        plan.review().sides[0].bytes,
        crate::MAX_FILE_CONTENT_BYTES as u64 + 1
    );
    plan.verify(&CancellationToken::default()).unwrap();
    assert!(!sentinel.exists());
    assert!(!f.parent().exists());
    plan.discard().unwrap();
    assert!(plan.verify(&CancellationToken::default()).is_err());
    assert!(f.repo.join(path).is_file());
}

#[test]
fn file_tools_editor_refuses_metadata_traversal_links_and_changed_file_identity() {
    let f = Fixture::new();
    f.commit("file.txt", b"original\n");
    let outside = f.root.join("outside");
    fs::write(&outside, b"preserve").unwrap();
    symlink(&outside, f.repo.join("link.txt")).unwrap();
    for path in ["../outside", ".git/config", "link.txt"] {
        assert!(
            prepare_file_tool(
                &f.repo,
                FileToolRequest::Editor {
                    path: path.into(),
                    line: None
                },
                f.profile(ToolRole::Editor, &["{file}"]),
                &f.parent(),
                f.uid(),
                &CancellationToken::default()
            )
            .is_err()
        );
    }
    assert_eq!(fs::read(&outside).unwrap(), b"preserve");
    let mut plan = f.prepare(
        FileToolRequest::Editor {
            path: "file.txt".into(),
            line: None,
        },
        f.profile(ToolRole::Editor, &["{file}"]),
    );
    fs::rename(f.repo.join("file.txt"), f.root.join("old-file.txt")).unwrap();
    fs::write(f.repo.join("file.txt"), b"original\n").unwrap();
    assert!(plan.verify(&CancellationToken::default()).is_err());
    plan.discard().unwrap();
    let plan = f.prepare(
        FileToolRequest::Editor {
            path: "file.txt".into(),
            line: None,
        },
        f.profile(ToolRole::Editor, &["{file}"]),
    );
    f.git(&["checkout", "-q", "-b", "other-branch"]);
    assert!(plan.verify(&CancellationToken::default()).is_err());
    assert!(!f.parent().exists());
}

#[test]
fn file_tools_editor_refuses_a_nested_repository_created_after_review() {
    let f = Fixture::new();
    fs::create_dir_all(f.repo.join("nested/deep")).unwrap();
    let file = f.repo.join("nested/deep/file.txt");
    fs::write(&file, b"owned content").unwrap();
    let mut plan = f.prepare(
        FileToolRequest::Editor {
            path: "nested/deep/file.txt".into(),
            line: None,
        },
        f.profile(ToolRole::Editor, &["{file}"]),
    );
    fs::write(f.repo.join("nested/.git"), b"gitdir: ../other").unwrap();
    assert!(plan.verify(&CancellationToken::default()).is_err());
    assert!(
        prepare_file_tool(
            &f.repo,
            FileToolRequest::Editor {
                path: "nested/deep/file.txt".into(),
                line: None,
            },
            f.profile(ToolRole::Editor, &["{file}"]),
            &f.parent(),
            f.uid(),
            &CancellationToken::default(),
        )
        .is_err()
    );
    plan.discard().unwrap();
    assert_eq!(fs::read(file).unwrap(), b"owned content");
    assert!(!f.parent().exists());
}

#[test]
fn file_tools_diff_captures_exact_index_working_bytes_and_preserves_git_until_discard() {
    let f = Fixture::new();
    f.commit("file.txt", b"base\0\n");
    fs::write(f.repo.join("file.txt"), b"staged\0\n").unwrap();
    f.git(&["add", "--", "file.txt"]);
    fs::write(f.repo.join("file.txt"), b"working\0\n").unwrap();
    let state = f.state();
    let request = FileToolRequest::Diff {
        before: FileToolSource::Index {
            path: "file.txt".into(),
        },
        after: FileToolSource::WorkingTree {
            path: "file.txt".into(),
        },
    };
    let mut plan = f.prepare(request, f.profile(ToolRole::Diff, &["{before}", "{after}"]));
    assert_eq!(
        fs::read(&plan.review().arguments[0]).unwrap(),
        b"staged\0\n"
    );
    assert_eq!(
        fs::read(&plan.review().arguments[1]).unwrap(),
        b"working\0\n"
    );
    assert_eq!(f.state(), state);
    plan.verify(&CancellationToken::default()).unwrap();
    assert_eq!(f.state(), state);
    fs::write(f.repo.join("file.txt"), b"intervening working edit").unwrap();
    assert!(plan.verify(&CancellationToken::default()).is_err());
    let copies = plan.snapshots.as_ref().unwrap().path().to_owned();
    plan.discard().unwrap();
    assert!(!copies.exists());
    assert_eq!(
        fs::read(f.repo.join("file.txt")).unwrap(),
        b"intervening working edit"
    );
}

#[test]
fn file_tools_historical_diff_supports_bare_repositories_and_distinguishes_absent_from_empty() {
    let f = Fixture::new();
    let oid = f.commit("empty.txt", b"");
    let bare = f.root.join("owned-bare.git");
    f.git(&[
        "clone",
        "--bare",
        "--no-hardlinks",
        f.repo.to_str().unwrap(),
        bare.to_str().unwrap(),
    ]);
    let bare = crate::resolve_repository(&bare).unwrap();
    let mut plan = prepare_file_tool(
        &bare,
        FileToolRequest::Diff {
            before: FileToolSource::Revision {
                oid: oid.clone(),
                path: "missing.txt".into(),
            },
            after: FileToolSource::Revision {
                oid,
                path: "empty.txt".into(),
            },
        },
        f.profile(ToolRole::Diff, &["{before}", "{after}"]),
        &f.parent(),
        f.uid(),
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(plan.review().sides[0].kind, "absent");
    assert_eq!(plan.review().sides[1].kind, "regular");
    assert_eq!(fs::read(&plan.review().arguments[0]).unwrap(), b"");
    assert_eq!(fs::read(&plan.review().arguments[1]).unwrap(), b"");
    plan.verify(&CancellationToken::default()).unwrap();
    plan.discard().unwrap();
}

#[test]
fn file_tools_merge_captures_real_stages_and_requires_fresh_output_and_repository_review() {
    let f = Fixture::new();
    f.conflict(Some(b"base\n"), b"ours\n", b"theirs\n");
    let state = f.state();
    let working = fs::read(f.repo.join("file.txt")).unwrap();
    let mut plan = f.prepare(
        FileToolRequest::Merge {
            path: "file.txt".into(),
        },
        f.profile(
            ToolRole::Merge,
            &["{base}", "{before}", "{after}", "{merged}"],
        ),
    );
    let args = &plan.review().arguments;
    assert_eq!(fs::read(&args[0]).unwrap(), b"base\n");
    assert_eq!(fs::read(&args[1]).unwrap(), b"ours\n");
    assert_eq!(fs::read(&args[2]).unwrap(), b"theirs\n");
    assert_eq!(fs::read(&args[3]).unwrap(), working);
    let output = PathBuf::from(&args[3]);
    fs::write(&output, b"reviewed result\n").unwrap();
    let result = plan
        .read_merge_result(&CancellationToken::default())
        .unwrap();
    assert_eq!(result.bytes(), b"reviewed result\n");
    plan.verify_merge_result(&result, &CancellationToken::default())
        .unwrap();
    assert_eq!(f.state(), state);
    assert_eq!(fs::read(f.repo.join("file.txt")).unwrap(), working);
    fs::write(&output, b"later output\n").unwrap();
    assert!(
        plan.verify_merge_result(&result, &CancellationToken::default())
            .is_err()
    );
    let next = plan
        .read_merge_result(&CancellationToken::default())
        .unwrap();
    f.git(&["add", "--", "file.txt"]);
    assert!(
        plan.verify_merge_result(&next, &CancellationToken::default())
            .is_err()
    );
    plan.discard().unwrap();
    assert_eq!(fs::read(f.repo.join("file.txt")).unwrap(), working);
}

#[test]
fn file_tools_add_add_binary_merge_keeps_absent_base_and_raw_output_without_staging() {
    let f = Fixture::new();
    f.conflict(None, b"\0ours\xff", b"\0theirs\xfe");
    let state = f.state();
    let mut plan = f.prepare(
        FileToolRequest::Merge {
            path: "file.txt".into(),
        },
        f.profile(
            ToolRole::Merge,
            &["{base}", "{before}", "{after}", "{merged}"],
        ),
    );
    assert_eq!(plan.review().sides[0].kind, "absent");
    assert_eq!(fs::read(&plan.review().arguments[0]).unwrap(), b"");
    assert_eq!(
        fs::read(&plan.review().arguments[1]).unwrap(),
        b"\0ours\xff"
    );
    assert_eq!(
        fs::read(&plan.review().arguments[2]).unwrap(),
        b"\0theirs\xfe"
    );
    fs::write(&plan.review().arguments[3], b"\xff\0literal result").unwrap();
    let result = plan
        .read_merge_result(&CancellationToken::default())
        .unwrap();
    assert_eq!(result.bytes(), b"\xff\0literal result");
    assert_eq!(f.state(), state);
    fs::set_permissions(f.repo.join("file.txt"), fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        plan.verify_merge_result(&result, &CancellationToken::default())
            .is_err()
    );
    plan.discard().unwrap();
}

#[test]
fn file_tools_profile_authority_is_role_bound_strict_and_revalidated_without_launch() {
    let f = Fixture::new();
    f.commit("file.txt", b"file\n");
    let mismatch = prepare_file_tool(
        &f.root.join("missing-repository"),
        FileToolRequest::Editor {
            path: "file.txt".into(),
            line: None,
        },
        f.profile(ToolRole::Terminal, &["{repository}"]),
        &f.parent(),
        f.uid(),
        &CancellationToken::default(),
    )
    .err()
    .unwrap();
    assert!(mismatch.message.contains("profile"));
    let mut missing = f.profile(ToolRole::Editor, &["{file}"]);
    missing.executable = f.root.join("missing-program").to_str().unwrap().into();
    assert!(
        prepare_file_tool(
            &f.repo,
            FileToolRequest::Editor {
                path: "file.txt".into(),
                line: None
            },
            missing,
            &f.parent(),
            f.uid(),
            &CancellationToken::default()
        )
        .is_err()
    );
    let executable = f.root.join("owned program");
    fs::write(&executable, b"#!/bin/sh\nexit 0\n").unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
    let mut profile = f.profile(ToolRole::Editor, &["{file}"]);
    profile.executable = executable.to_str().unwrap().into();
    let plan = f.prepare(
        FileToolRequest::Editor {
            path: "file.txt".into(),
            line: None,
        },
        profile,
    );
    let replacement = f.root.join("replacement program");
    fs::write(&replacement, b"#!/bin/sh\nexit 19\n").unwrap();
    fs::set_permissions(&replacement, fs::Permissions::from_mode(0o700)).unwrap();
    fs::rename(replacement, &executable).unwrap();
    assert!(plan.verify(&CancellationToken::default()).is_err());
    let forged = serde_json::json!({"kind":"editor","path":"file.txt","line":null,"root":"/other","program":"/other/program"});
    assert!(serde_json::from_value::<FileToolRequest>(forged).is_err());
    assert!(!f.parent().exists());
}

#[test]
fn file_tools_cancelled_preparation_and_invalid_editor_lines_create_no_tool_storage() {
    let f = Fixture::new();
    f.commit("file.txt", b"file\n");
    let token = CancellationToken::default();
    token.cancel();
    assert_eq!(
        prepare_file_tool(
            &f.repo,
            FileToolRequest::Editor {
                path: "file.txt".into(),
                line: None
            },
            f.profile(ToolRole::Editor, &["{file}"]),
            &f.parent(),
            f.uid(),
            &token
        )
        .err()
        .unwrap()
        .kind,
        "operationCancelled"
    );
    assert!(
        prepare_file_tool(
            &f.repo,
            FileToolRequest::Editor {
                path: "file.txt".into(),
                line: Some(0)
            },
            f.profile(ToolRole::Editor, &["{file}"]),
            &f.parent(),
            f.uid(),
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(!f.parent().exists());
}

#[test]
fn file_tools_comparison_never_fetches_a_missing_promised_blob_with_real_fetch_positive_control() {
    let f = Fixture::new();
    let oid = f.commit("file.txt", b"unique promised tool bytes\n");
    let blob = f.git(&["rev-parse", "HEAD:file.txt"]);
    let remote = f.root.join("owned-promisor.git");
    f.git(&[
        "clone",
        "--bare",
        "--no-hardlinks",
        f.repo.to_str().unwrap(),
        remote.to_str().unwrap(),
    ]);
    let sentinel = f.root.join("upload-pack-started");
    let upload = f.root.join("owned-upload-pack");
    let quoted = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    fs::write(
        &upload,
        format!(
            "#!/bin/sh\n: > {}\nexec git-upload-pack \"$@\"\n",
            quoted(sentinel.to_str().unwrap())
        ),
    )
    .unwrap();
    fs::set_permissions(&upload, fs::Permissions::from_mode(0o700)).unwrap();
    f.git(&["config", "extensions.partialClone", "owned"]);
    f.git(&["config", "remote.owned.url", remote.to_str().unwrap()]);
    f.git(&["config", "remote.owned.promisor", "true"]);
    f.git(&["config", "remote.owned.partialclonefilter", "blob:none"]);
    f.git(&[
        "config",
        "remote.owned.uploadpack",
        &quoted(upload.to_str().unwrap()),
    ]);
    f.git(&["config", "protocol.file.allow", "always"]);
    fs::remove_file(
        f.repo
            .join(".git/objects")
            .join(&blob[..2])
            .join(&blob[2..]),
    )
    .unwrap();
    assert!(
        prepare_file_tool(
            &f.repo,
            FileToolRequest::Diff {
                before: FileToolSource::Revision {
                    oid,
                    path: "file.txt".into()
                },
                after: FileToolSource::WorkingTree {
                    path: "file.txt".into()
                }
            },
            f.profile(ToolRole::Diff, &["{before}", "{after}"]),
            &f.parent(),
            f.uid(),
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(!sentinel.exists());
    assert!(!f.parent().exists());
    let control = crate::git_in(&f.repo)
        .args(["cat-file", "blob", &blob])
        .env_remove("GIT_NO_LAZY_FETCH")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        control.status.success(),
        "{}",
        String::from_utf8_lossy(&control.stderr)
    );
    assert_eq!(control.stdout, b"unique promised tool bytes\n");
    assert!(
        sentinel.exists(),
        "Owned upload-pack positive control did not run"
    );
}

#[test]
fn file_tools_repository_metadata_replacement_refuses_even_with_identical_git_contents() {
    fn copy_tree(from: &Path, to: &Path) {
        fs::create_dir(to).unwrap();
        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let target = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_tree(&entry.path(), &target);
            } else {
                assert!(entry.file_type().unwrap().is_file());
                fs::copy(entry.path(), target).unwrap();
            }
        }
    }
    let f = Fixture::new();
    f.commit("file.txt", b"same working file\n");
    let plan = f.prepare(
        FileToolRequest::Editor {
            path: "file.txt".into(),
            line: None,
        },
        f.profile(ToolRole::Editor, &["{file}"]),
    );
    let old = f.root.join("old-git");
    fs::rename(f.repo.join(".git"), &old).unwrap();
    copy_tree(&old, &f.repo.join(".git"));
    assert!(plan.verify(&CancellationToken::default()).is_err());
    assert_eq!(
        fs::read(f.repo.join("file.txt")).unwrap(),
        b"same working file\n"
    );
}

#[test]
fn file_tools_snapshots_cannot_be_created_in_worktree_or_shared_git_metadata() {
    let f = Fixture::new();
    let oid = f.commit("file.txt", b"preserved\n");
    let state = f.state();
    let request = FileToolRequest::Diff {
        before: FileToolSource::Revision {
            oid,
            path: "file.txt".into(),
        },
        after: FileToolSource::WorkingTree {
            path: "file.txt".into(),
        },
    };
    for parent in [
        f.repo.join("must-not-create"),
        f.repo.join(".git/must-not-create"),
    ] {
        assert!(
            prepare_file_tool(
                &f.repo,
                request.clone(),
                f.profile(ToolRole::Diff, &["{before}", "{after}"]),
                &parent,
                f.uid(),
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(!parent.exists());
    }
    assert_eq!(f.state(), state);
    let linked = f.root.join("linked-worktree");
    f.git(&[
        "worktree",
        "add",
        "-q",
        "--detach",
        linked.to_str().unwrap(),
        "HEAD",
    ]);
    let parent = f.repo.join(".git/shared-must-not-create");
    assert!(
        prepare_file_tool(
            &linked,
            request,
            f.profile(ToolRole::Diff, &["{before}", "{after}"]),
            &parent,
            f.uid(),
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(!parent.exists());
}

#[test]
fn file_tools_merge_save_publishes_only_reviewed_binary_bytes_then_stages_separately_once() {
    let f = Fixture::new();
    f.conflict(None, b"\0ours\xff", b"\0theirs\xfe");
    let before = f.state();
    let mut plan = f.prepare(
        FileToolRequest::Merge {
            path: "file.txt".into(),
        },
        f.profile(
            ToolRole::Merge,
            &["{base}", "{before}", "{after}", "{merged}"],
        ),
    );
    let output = plan.review().arguments[3].clone();
    fs::write(&output, b"\xff\x00reviewed binary\xfe").unwrap();
    let result = plan
        .read_merge_result(&CancellationToken::default())
        .unwrap();
    let saved = plan
        .apply_merge_result(&result, &CancellationToken::default())
        .unwrap();
    assert_eq!(saved.status, crate::WorkingFileWriteStatus::Saved);
    assert!(saved.warning.is_none() && saved.can_review_staging);
    assert_eq!(fs::read(f.repo.join("file.txt")).unwrap(), result.bytes());
    assert_eq!(fs::read(f.repo.join(".git/index")).unwrap(), before.1);
    assert_eq!(fs::read(f.repo.join(".git/config")).unwrap(), before.2);
    assert_eq!(f.git(&["show-ref"]), before.0);
    assert!(!f.git(&["ls-files", "--unmerged"]).is_empty());
    assert!(
        plan.apply_merge_result(&result, &CancellationToken::default())
            .is_err()
    );
    plan.verify_saved_merge(&CancellationToken::default())
        .unwrap();
    let staged = plan
        .stage_saved_merge(&CancellationToken::default())
        .unwrap();
    assert!(staged.confirmed && staged.error.is_none() && staged.warning.is_none());
    assert!(f.git(&["ls-files", "--unmerged"]).is_empty());
    let index = crate::run_git(&f.repo, &["show", ":file.txt"]).unwrap();
    assert!(index.status.success());
    assert_eq!(index.stdout, result.bytes());
    assert!(
        plan.stage_saved_merge(&CancellationToken::default())
            .is_err()
    );
    assert_eq!(fs::read(&output).unwrap(), result.bytes());
    plan.discard().unwrap();
    assert_eq!(fs::read(f.repo.join("file.txt")).unwrap(), result.bytes());
}
#[test]
fn file_tools_merge_save_refuses_changed_output_index_and_target_without_repository_writes() {
    for changed in ["output", "index", "working"] {
        let f = Fixture::new();
        f.conflict(Some(b"base\n"), b"ours\n", b"theirs\n");
        let mut plan = f.prepare(
            FileToolRequest::Merge {
                path: "file.txt".into(),
            },
            f.profile(ToolRole::Merge, &["{merged}"]),
        );
        let output = plan.review().arguments[0].clone();
        fs::write(&output, b"reviewed\n").unwrap();
        let result = plan
            .read_merge_result(&CancellationToken::default())
            .unwrap();
        match changed {
            "output" => fs::write(&output, b"later output\n").unwrap(),
            "index" => {
                f.git(&["add", "--", "file.txt"]);
            }
            _ => fs::write(f.repo.join("file.txt"), b"external working\n").unwrap(),
        }
        let state = f.state();
        let bytes = fs::read(f.repo.join("file.txt")).unwrap();
        assert!(
            plan.apply_merge_result(&result, &CancellationToken::default())
                .is_err(),
            "{changed}"
        );
        assert_eq!(f.state(), state);
        assert_eq!(fs::read(f.repo.join("file.txt")).unwrap(), bytes);
        plan.discard().unwrap();
    }
}
#[test]
fn file_tools_saved_merge_staging_refuses_external_file_index_branch_changes_and_retired_sessions()
{
    for changed in ["working", "index", "branch", "discard"] {
        let f = Fixture::new();
        f.conflict(Some(b"base\n"), b"ours\n", b"theirs\n");
        let mut plan = f.prepare(
            FileToolRequest::Merge {
                path: "file.txt".into(),
            },
            f.profile(ToolRole::Merge, &["{merged}"]),
        );
        fs::write(&plan.review().arguments[0], b"saved result\n").unwrap();
        let result = plan
            .read_merge_result(&CancellationToken::default())
            .unwrap();
        plan.apply_merge_result(&result, &CancellationToken::default())
            .unwrap();
        match changed {
            "working" => fs::write(f.repo.join("file.txt"), b"external\n").unwrap(),
            "index" => {
                f.git(&["add", "--", "file.txt"]);
            }
            "branch" => {
                f.git(&["symbolic-ref", "HEAD", "refs/heads/incoming"]);
            }
            _ => plan.discard().unwrap(),
        }
        let before = f.state();
        let bytes = fs::read(f.repo.join("file.txt")).unwrap();
        assert!(
            plan.stage_saved_merge(&CancellationToken::default())
                .is_err(),
            "{changed}"
        );
        assert_eq!(f.state(), before);
        assert_eq!(fs::read(f.repo.join("file.txt")).unwrap(), bytes);
        if changed != "discard" {
            plan.discard().unwrap();
        }
    }
}
#[test]
fn file_tools_saved_merge_failed_git_add_is_inspectable_and_consumes_staging_authority() {
    let f = Fixture::new();
    f.conflict(Some(b"base\n"), b"ours\n", b"theirs\n");
    let mut plan = f.prepare(
        FileToolRequest::Merge {
            path: "file.txt".into(),
        },
        f.profile(ToolRole::Merge, &["{merged}"]),
    );
    fs::write(&plan.review().arguments[0], b"saved result\n").unwrap();
    let result = plan
        .read_merge_result(&CancellationToken::default())
        .unwrap();
    plan.apply_merge_result(&result, &CancellationToken::default())
        .unwrap();
    let index = fs::read(f.repo.join(".git/index")).unwrap();
    let lock = f.repo.join(".git/index.lock");
    fs::write(&lock, b"foreign lock").unwrap();
    let staged = plan
        .stage_saved_merge(&CancellationToken::default())
        .unwrap();
    assert!(!staged.confirmed && staged.error.is_some());
    assert!(
        plan.stage_saved_merge(&CancellationToken::default())
            .is_err()
    );
    assert_eq!(fs::read(&lock).unwrap(), b"foreign lock");
    assert_eq!(fs::read(f.repo.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(f.repo.join("file.txt")).unwrap(),
        b"saved result\n"
    );
    plan.discard().unwrap();
}

fn await_file_tool_process(process: &mut crate::FileToolProcess) -> crate::FileToolProcessStatus {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let state = process.poll().unwrap();
        if state.state == crate::FileToolProcessState::Exited {
            return state;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
#[test]
fn file_tools_explicit_editor_launch_revalidates_context_and_executes_literal_arguments_once() {
    let f = Fixture::new();
    let path = "literal [é] 'file'.txt";
    f.commit(path, b"saved bytes\n");
    let record = f.root.join("record.json");
    let script = f.root.join("owned launch recorder.py");
    fs::write(&script, "import json,os,pathlib,sys\npathlib.Path(sys.argv[1]).write_text(json.dumps({'cwd':os.getcwd(),'args':sys.argv[2:]}))\n").unwrap();
    let mut profile = f.profile(
        ToolRole::Editor,
        &[
            script.to_str().unwrap(),
            record.to_str().unwrap(),
            "{file}",
            "",
            "; touch must-not-run",
            "{repository}",
        ],
    );
    profile.executable = "/usr/bin/python3".into();
    let mut plan = f.prepare(
        FileToolRequest::Editor {
            path: path.into(),
            line: None,
        },
        profile,
    );
    assert!(!record.exists());
    let before = f.state();
    let mut process = plan.launch(&CancellationToken::default()).unwrap();
    assert!(plan.launch(&CancellationToken::default()).is_err());
    assert_eq!(await_file_tool_process(&mut process).success, Some(true));
    let observed: serde_json::Value = serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
    assert_eq!(observed["cwd"], f.repo.to_str().unwrap());
    assert_eq!(
        observed["args"],
        serde_json::json!([
            f.repo.join(path).to_str().unwrap(),
            "",
            "; touch must-not-run",
            f.repo.to_str().unwrap()
        ])
    );
    assert!(!f.repo.join("must-not-run").exists());
    assert_eq!(f.state(), before);
    assert_eq!(fs::read(f.repo.join(path)).unwrap(), b"saved bytes\n");
    plan.discard().unwrap();
}
#[test]
fn file_tools_launch_refuses_stale_working_file_and_cancelled_review_before_any_program_starts() {
    for cancelled in [false, true] {
        let f = Fixture::new();
        f.commit("file.txt", b"saved bytes\n");
        let marker = f.root.join("must-not-start");
        let script = f.root.join("owned marker.py");
        fs::write(
            &script,
            "import pathlib,sys\npathlib.Path(sys.argv[1]).touch()\n",
        )
        .unwrap();
        let mut profile = f.profile(
            ToolRole::Editor,
            &[script.to_str().unwrap(), marker.to_str().unwrap(), "{file}"],
        );
        profile.executable = "/usr/bin/python3".into();
        let mut plan = f.prepare(
            FileToolRequest::Editor {
                path: "file.txt".into(),
                line: None,
            },
            profile,
        );
        let cancellation = CancellationToken::default();
        if cancelled {
            cancellation.cancel();
        } else {
            fs::write(f.repo.join("file.txt"), b"external bytes\n").unwrap();
        }
        assert!(plan.launch(&cancellation).is_err());
        assert!(!marker.exists());
        plan.discard().unwrap();
    }
}
#[test]
fn file_tools_diff_launch_retains_exact_copies_after_exit_until_explicit_discard() {
    let f = Fixture::new();
    f.commit("file.txt", b"indexed\n");
    fs::write(f.repo.join("file.txt"), b"working\n").unwrap();
    let record = f.root.join("comparison.json");
    let script = f.root.join("owned diff reader.py");
    fs::write(&script, "import json,pathlib,sys\npathlib.Path(sys.argv[1]).write_text(json.dumps([pathlib.Path(p).read_text() for p in sys.argv[2:]]))\n").unwrap();
    let mut profile = f.profile(
        ToolRole::Diff,
        &[
            script.to_str().unwrap(),
            record.to_str().unwrap(),
            "{before}",
            "{after}",
        ],
    );
    profile.executable = "/usr/bin/python3".into();
    let mut plan = f.prepare(
        FileToolRequest::Diff {
            before: FileToolSource::Index {
                path: "file.txt".into(),
            },
            after: FileToolSource::WorkingTree {
                path: "file.txt".into(),
            },
        },
        profile,
    );
    let copies: Vec<_> = plan.review().arguments[2..]
        .iter()
        .map(PathBuf::from)
        .collect();
    let before = f.state();
    let mut process = plan.launch(&CancellationToken::default()).unwrap();
    assert_eq!(await_file_tool_process(&mut process).success, Some(true));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fs::read(record).unwrap()).unwrap(),
        serde_json::json!(["indexed\n", "working\n"])
    );
    assert!(copies.iter().all(|p| p.exists()));
    assert_eq!(f.state(), before);
    plan.discard().unwrap();
    assert!(copies.iter().all(|p| !p.exists()));
}

#[test]
fn file_tools_cleanup_review_refuses_later_output_then_removes_only_copies_after_saved_working_file_changes()
 {
    let f = Fixture::new();
    f.conflict(Some(b"base\n"), b"ours\n", b"theirs\n");
    let mut plan = f.prepare(
        FileToolRequest::Merge {
            path: "file.txt".into(),
        },
        f.profile(ToolRole::Merge, &["{merged}"]),
    );
    let output = PathBuf::from(&plan.review().arguments[0]);
    fs::write(&output, b"reviewed result\n").unwrap();
    let old = plan.prepare_cleanup().unwrap();
    assert_eq!(old.review().output_bytes, Some(16));
    fs::write(&output, b"later result\n").unwrap();
    assert!(plan.discard_reviewed(old).is_err());
    assert!(output.exists());
    let result = plan
        .read_merge_result(&CancellationToken::default())
        .unwrap();
    plan.apply_merge_result(&result, &CancellationToken::default())
        .unwrap();
    let fresh = plan.prepare_cleanup().unwrap();
    assert_eq!(fresh.review().output_bytes, Some(13));
    let before = f.state();
    let bytes = fs::read(f.repo.join("file.txt")).unwrap();
    plan.discard_reviewed(fresh).unwrap();
    assert!(!output.exists());
    assert_eq!(f.state(), before);
    assert_eq!(fs::read(f.repo.join("file.txt")).unwrap(), bytes);
}
#[test]
fn file_tools_cleanup_review_cannot_authorize_another_copy_directory_or_delete_foreign_material() {
    let f = Fixture::new();
    f.commit("file.txt", b"indexed\n");
    fs::write(f.repo.join("file.txt"), b"working\n").unwrap();
    let request = || FileToolRequest::Diff {
        before: FileToolSource::Index {
            path: "file.txt".into(),
        },
        after: FileToolSource::WorkingTree {
            path: "file.txt".into(),
        },
    };
    let mut first = f.prepare(
        request(),
        f.profile(ToolRole::Diff, &["{before}", "{after}"]),
    );
    let mut second = f.prepare(
        request(),
        f.profile(ToolRole::Diff, &["{before}", "{after}"]),
    );
    let old = first.prepare_cleanup().unwrap();
    assert!(second.discard_reviewed(old).is_err());
    let fresh = second.prepare_cleanup().unwrap();
    let directory = PathBuf::from(fresh.review().copy_directory.as_ref().unwrap());
    fs::write(directory.join("foreign-file"), b"retained foreign bytes").unwrap();
    let before = f.state();
    assert!(second.discard_reviewed(fresh).is_err());
    assert_eq!(
        fs::read(directory.join("foreign-file")).unwrap(),
        b"retained foreign bytes"
    );
    assert_eq!(f.state(), before);
    first.discard().unwrap();
}

#[test]
fn file_tools_native_comparison_resolves_root_commit_absence_and_exact_history_in_bare_repository()
{
    let f = Fixture::new();
    let oid = f.commit("root.txt", b"root bytes\n");
    let bare = f.root.join("bare.git");
    f.git(&[
        "clone",
        "-q",
        "--bare",
        f.repo.to_str().unwrap(),
        bare.to_str().unwrap(),
    ]);
    let bare = crate::resolve_repository(&bare).unwrap();
    let mut plan = prepare_file_tool(
        &bare,
        FileToolRequest::Comparison {
            request: crate::FileComparisonRequest {
                context: crate::FileComparisonContext::Commit { oid },
                path: "root.txt".into(),
                previous_path: None,
            },
        },
        f.profile(ToolRole::Diff, &["{before}", "{after}"]),
        &f.parent(),
        f.uid(),
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(plan.review().sides[0].kind, "absent");
    assert_eq!(fs::read(&plan.review().arguments[0]).unwrap(), b"");
    assert_eq!(
        fs::read(&plan.review().arguments[1]).unwrap(),
        b"root bytes\n"
    );
    plan.verify(&CancellationToken::default()).unwrap();
    plan.discard().unwrap();
}
#[test]
fn file_tools_native_comparison_binds_staged_rename_original_path_and_refuses_changed_index() {
    let f = Fixture::new();
    let original = b"shared first\nshared second\nshared third\nshared fourth\nold tail\n";
    let renamed = b"shared first\nshared second\nshared third\nshared fourth\nnew tail\n";
    f.commit("old.txt", original);
    f.git(&["mv", "old.txt", "new.txt"]);
    fs::write(f.repo.join("new.txt"), renamed).unwrap();
    f.git(&["add", "--", "new.txt"]);
    let mut plan = f.prepare(
        FileToolRequest::Comparison {
            request: crate::FileComparisonRequest {
                context: crate::FileComparisonContext::WorkingTree { staged: true },
                path: "new.txt".into(),
                previous_path: Some("old.txt".into()),
            },
        },
        f.profile(ToolRole::Diff, &["{before}", "{after}"]),
    );
    assert_eq!(plan.review().sides[0].path, "old.txt");
    assert_eq!(plan.review().sides[1].path, "new.txt");
    assert_eq!(fs::read(&plan.review().arguments[0]).unwrap(), original);
    assert_eq!(fs::read(&plan.review().arguments[1]).unwrap(), renamed);
    fs::write(f.repo.join("new.txt"), b"later index\n").unwrap();
    f.git(&["add", "--", "new.txt"]);
    let before = f.state();
    assert!(plan.launch(&CancellationToken::default()).is_err());
    assert_eq!(f.state(), before);
    plan.discard().unwrap();
}
#[test]
fn file_tools_native_comparison_supports_unborn_staged_files_without_inventing_a_revision() {
    let f = Fixture::new();
    fs::write(f.repo.join("new.txt"), b"initial\n").unwrap();
    f.git(&["add", "--", "new.txt"]);
    let mut plan = f.prepare(
        FileToolRequest::Comparison {
            request: crate::FileComparisonRequest {
                context: crate::FileComparisonContext::WorkingTree { staged: true },
                path: "new.txt".into(),
                previous_path: None,
            },
        },
        f.profile(ToolRole::Diff, &["{before}", "{after}"]),
    );
    assert_eq!(plan.review().sides[0].kind, "absent");
    assert_eq!(fs::read(&plan.review().arguments[1]).unwrap(), b"initial\n");
    plan.verify(&CancellationToken::default()).unwrap();
    plan.discard().unwrap();
    assert!(f.git(&["ls-files", "--stage"]).contains("new.txt"));
}
#[test]
fn file_tools_native_comparison_resolves_stash_untracked_parent_and_leaves_stash_and_worktree_unchanged()
 {
    let f = Fixture::new();
    f.commit("tracked.txt", b"base\n");
    fs::write(f.repo.join("untracked.txt"), b"saved untracked\n").unwrap();
    f.git(&[
        "stash",
        "push",
        "--include-untracked",
        "-m",
        "Owned tool source",
    ]);
    let oid = f.git(&["rev-parse", "refs/stash"]);
    let before = f.state();
    let mut plan = f.prepare(
        FileToolRequest::Comparison {
            request: crate::FileComparisonRequest {
                context: crate::FileComparisonContext::Stash {
                    oid,
                    layer: crate::StashContentLayer::Untracked,
                },
                path: "untracked.txt".into(),
                previous_path: None,
            },
        },
        f.profile(ToolRole::Diff, &["{before}", "{after}"]),
    );
    assert_eq!(plan.review().sides[0].kind, "absent");
    assert_eq!(
        fs::read(&plan.review().arguments[1]).unwrap(),
        b"saved untracked\n"
    );
    plan.verify(&CancellationToken::default()).unwrap();
    plan.discard().unwrap();
    assert_eq!(f.state(), before);
    assert!(!f.repo.join("untracked.txt").exists());
}
