use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

const FILES: [(&str, &str); 5] = [
    ("*.txt", "other.txt"),
    ("[ab].txt", "a.txt"),
    (":(glob)*.txt", "other.txt"),
    ("--selected.txt", "other.txt"),
    ("selected file.txt", "other.txt"),
];

struct Repository(PathBuf);

impl Repository {
    fn new() -> Self {
        Self::with_object_format("sha1")
    }

    fn with_object_format(format: &str) -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let repository =
            Self(std::env::temp_dir().join(format!("khronos-literal-{}-{id}", std::process::id())));
        fs::create_dir(&repository.0).unwrap();
        for args in [
            vec!["init", "--object-format", format, "-b", "main"],
            vec!["config", "user.name", "Literal Tester"],
            vec!["config", "user.email", "literal@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            repository.git(&args);
        }
        repository
    }

    fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = run_git(&self.0, args).unwrap();
        ensure_success("inspect owned literal-path fixture", &output).unwrap();
        output.stdout
    }

    fn write(&self, file: &str, bytes: &[u8]) {
        fs::write(self.0.join(file), bytes).unwrap();
    }

    fn commit(&self, message: &str) -> String {
        self.git(&["add", "--all"]);
        self.git(&["commit", "-m", message]);
        String::from_utf8(self.git(&["rev-parse", "HEAD"]))
            .unwrap()
            .trim()
            .into()
    }

    fn baseline(&self, selected: &str, other: &str) -> String {
        self.write(selected, b"selected old\n");
        self.write(other, b"unrelated old\n");
        self.commit("Base")
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn only_selected(diff: CommitFileDiff) {
    assert_eq!(
        diff.patch.matches("diff --git ").count(),
        1,
        "{}",
        diff.patch
    );
    assert!(diff.patch.contains("selected current"), "{}", diff.patch);
    assert!(!diff.patch.contains("unrelated"), "{}", diff.patch);
    assert!(!diff.truncated);
}

#[test]
fn historical_restore_of_a_pattern_named_file_cannot_overwrite_or_stage_neighbours() {
    for (selected, other) in FILES {
        let repository = Repository::new();
        let base = repository.baseline(selected, other);
        repository.write(selected, b"selected current\n");
        repository.write(other, b"unrelated current\n");
        let tip = repository.commit("Current");
        repository.write(other, b"unrelated dirty bytes\n");
        let other_index = repository.git(&[
            "--literal-pathspecs",
            "ls-files",
            "--stage",
            "-z",
            "--",
            other,
        ]);
        restore_files_from_commit(&repository.0, &base, &[selected.into()]).unwrap();
        assert_eq!(
            fs::read(repository.0.join(other)).unwrap(),
            b"unrelated dirty bytes\n",
            "restore {selected}"
        );
        assert_eq!(
            repository.git(&[
                "--literal-pathspecs",
                "ls-files",
                "--stage",
                "-z",
                "--",
                other
            ]),
            other_index
        );
        assert_eq!(
            fs::read(repository.0.join(selected)).unwrap(),
            b"selected old\n"
        );
        assert_eq!(
            repository.git(&["diff", "--cached", "--name-only", "-z"]),
            format!("{selected}\0").as_bytes()
        );
        assert_eq!(
            String::from_utf8(repository.git(&["rev-parse", "HEAD"]))
                .unwrap()
                .trim(),
            tip
        );
    }
}

#[test]
fn commit_diff_of_a_pattern_named_file_contains_only_that_file() {
    for (selected, other) in FILES {
        let repository = Repository::new();
        repository.baseline(selected, other);
        repository.write(selected, b"selected current\n");
        repository.write(other, b"unrelated current\n");
        let tip = repository.commit("Current");
        only_selected(commit_file_diff(&repository.0, &tip, selected, None).unwrap());
    }
}

#[test]
fn renamed_pattern_named_files_keep_both_old_and_new_paths_literal() {
    let repository = Repository::new();
    repository.write("old*.txt", b"selected unchanged\n");
    repository.write("old-neighbour.txt", b"unrelated old\n");
    repository.write("new-neighbour.txt", b"unrelated old\n");
    let base = repository.commit("Base");
    repository.git(&["--literal-pathspecs", "mv", "--", "old*.txt", "new*.txt"]);
    repository.write("old-neighbour.txt", b"unrelated current\n");
    repository.write("new-neighbour.txt", b"unrelated current\n");
    let tip = repository.commit("Rename selected and edit neighbours");
    for diff in [
        commit_file_diff(&repository.0, &tip, "new*.txt", Some("old*.txt")).unwrap(),
        compare_commit_file(&repository.0, &base, &tip, "new*.txt", Some("old*.txt")).unwrap(),
    ] {
        assert_eq!(
            diff.patch.matches("diff --git ").count(),
            1,
            "{}",
            diff.patch
        );
        assert!(
            diff.patch.contains("rename from old*.txt"),
            "{}",
            diff.patch
        );
        assert!(diff.patch.contains("rename to new*.txt"), "{}", diff.patch);
        assert!(!diff.patch.contains("unrelated"), "{}", diff.patch);
    }
}

#[test]
fn commit_comparison_of_a_pattern_named_file_contains_only_that_file() {
    for (selected, other) in FILES {
        let repository = Repository::new();
        let base = repository.baseline(selected, other);
        repository.write(selected, b"selected current\n");
        repository.write(other, b"unrelated current\n");
        let tip = repository.commit("Current");
        only_selected(compare_commit_file(&repository.0, &base, &tip, selected, None).unwrap());
    }
}

#[test]
fn working_directory_comparison_of_a_pattern_named_file_contains_only_that_file() {
    for (selected, other) in FILES {
        let repository = Repository::new();
        let base = repository.baseline(selected, other);
        repository.write(selected, b"selected current\n");
        repository.write(other, b"unrelated current\n");
        only_selected(
            compare_commit_file_with_working_tree(&repository.0, &base, selected, None).unwrap(),
        );
    }
}

#[test]
fn stashed_tracked_and_untracked_pattern_named_files_have_separate_previews() {
    for tracked in [true, false] {
        for (selected, other) in FILES {
            let repository = Repository::new();
            if tracked {
                repository.baseline(selected, other);
            } else {
                repository.write("seed", b"seed\n");
                repository.commit("Base");
            }
            repository.write(selected, b"selected current\n");
            repository.write(other, b"unrelated current\n");
            repository.write("untracked.txt", b"unrelated untracked\n");
            repository.git(&[
                "stash",
                "push",
                "--include-untracked",
                "-m",
                "Selected paths",
            ]);
            only_selected(stash_file_diff(&repository.0, "stash@{0}", selected, None).unwrap());
        }
    }
}

#[test]
fn history_of_a_pattern_named_file_excludes_neighbour_only_commits() {
    for (selected, other) in FILES {
        let repository = Repository::new();
        repository.baseline(selected, other);
        repository.write(other, b"unrelated current\n");
        repository.commit("Neighbour only");
        repository.write(selected, b"selected current\n");
        let tip = repository.commit("Selected change");
        let history = file_history(&repository.0, &tip, selected).unwrap();
        assert_eq!(
            history
                .iter()
                .map(|entry| entry.subject.as_str())
                .collect::<Vec<_>>(),
            ["Selected change", "Base"],
            "history {selected}"
        );
    }
}

#[test]
fn single_file_discard_and_its_recovery_never_change_pattern_matching_neighbours() {
    for tracked in [true, false] {
        for (selected, other) in FILES {
            let repository = Repository::new();
            if tracked {
                repository.baseline(selected, other);
            } else {
                repository.write("seed", b"seed\n");
                repository.commit("Base");
            }
            repository.write(selected, b"selected current\n");
            repository.write(other, b"unrelated current\n");
            let patch =
                working_tree_file_recovery_patch(&repository.0, selected, !tracked).unwrap();
            let text = String::from_utf8_lossy(&patch);
            assert_eq!(text.matches("diff --git ").count(), 1, "{text}");
            assert!(!text.contains("unrelated"), "{text}");
            let saved = repository.0.join(".git/owned-recovery.patch");
            fs::write(&saved, patch).unwrap();
            discard_path(&repository.0, selected, !tracked).unwrap();
            assert_eq!(
                fs::read(repository.0.join(other)).unwrap(),
                b"unrelated current\n"
            );
            if tracked {
                assert_eq!(
                    fs::read(repository.0.join(selected)).unwrap(),
                    b"selected old\n"
                );
            } else {
                assert!(!repository.0.join(selected).exists());
            }
            apply_working_tree_recovery(&repository.0, &saved, false).unwrap();
            assert_eq!(
                fs::read(repository.0.join(selected)).unwrap(),
                b"selected current\n"
            );
            assert_eq!(
                fs::read(repository.0.join(other)).unwrap(),
                b"unrelated current\n"
            );
        }
    }
}

fn converter_fixture(tracked: bool, binary: bool) -> (Repository, String, Vec<u8>) {
    use std::os::unix::fs::PermissionsExt;
    let repository = Repository::new();
    repository.write(".gitattributes", b"*.owned diff=owned\n");
    repository.write("seed", b"seed\n");
    if tracked {
        repository.write("preview.owned", b"base\n");
    }
    let base = repository.commit("Raw preview baseline");
    let converter = repository.0.join(".git/owned-converter");
    fs::write(
        &converter,
        b"#!/bin/sh\nprintf called > .git/converter-called\nprintf 'converted output\\n'\n",
    )
    .unwrap();
    fs::set_permissions(&converter, fs::Permissions::from_mode(0o700)).unwrap();
    repository.git(&["config", "diff.owned.textconv", converter.to_str().unwrap()]);
    let bytes = if binary {
        vec![0, 255, 13, 10, 0, 5]
    } else {
        b"raw comparison contents\n".to_vec()
    };
    repository.write("preview.owned", &bytes);
    (repository, base, bytes)
}

#[test]
fn working_directory_comparison_never_executes_text_converters_for_tracked_or_untracked_files() {
    for tracked in [false, true] {
        for binary in [false, true] {
            let (repository, base, bytes) = converter_fixture(tracked, binary);
            let index = repository.git(&["ls-files", "--stage", "-z"]);
            let result =
                compare_commit_file_with_working_tree(&repository.0, &base, "preview.owned", None);
            assert!(
                !repository.0.join(".git/converter-called").exists(),
                "converter executed for tracked={tracked}, binary={binary}"
            );
            let diff = result.unwrap();
            assert!(!diff.truncated);
            assert!(!diff.patch.contains("converted output"));
            assert!(
                diff.patch.contains(if binary {
                    "Binary files"
                } else {
                    "raw comparison contents"
                }),
                "{}",
                diff.patch
            );
            assert_eq!(fs::read(repository.0.join("preview.owned")).unwrap(), bytes);
            assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
        }
    }
}

#[test]
fn single_file_recovery_capture_never_executes_text_converters_and_restores_exact_bytes() {
    for tracked in [false, true] {
        let (repository, _, bytes) = converter_fixture(tracked, true);
        let index = repository.git(&["ls-files", "--stage", "-z"]);
        let result = working_tree_file_recovery_patch(&repository.0, "preview.owned", !tracked);
        assert!(
            !repository.0.join(".git/converter-called").exists(),
            "converter executed for tracked={tracked}"
        );
        let patch = result.unwrap();
        assert!(String::from_utf8_lossy(&patch).contains("GIT binary patch"));
        let saved = repository.0.join(".git/owned-raw-recovery.patch");
        fs::write(&saved, patch).unwrap();
        discard_path(&repository.0, "preview.owned", !tracked).unwrap();
        apply_working_tree_recovery(&repository.0, &saved, false).unwrap();
        assert_eq!(fs::read(repository.0.join("preview.owned")).unwrap(), bytes);
        assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
        assert!(!repository.0.join(".git/converter-called").exists());
    }
}

#[test]
fn working_directory_comparison_has_bounded_truthful_previews_and_preserves_exit_one_results() {
    for tracked in [false, true] {
        let repository = Repository::new();
        repository.write("seed", b"seed\n");
        if tracked {
            repository.write("preview.txt", b"base\n");
        }
        let base = repository.commit("Comparison baseline");
        repository.write("preview.txt", b"small comparison\n");
        let small =
            compare_commit_file_with_working_tree(&repository.0, &base, "preview.txt", None)
                .unwrap();
        assert!(!small.truncated && small.patch.contains("small comparison"));
        let large = b"large comparison contents\n".repeat(100_000);
        repository.write("preview.txt", &large);
        let diff = compare_commit_file_with_working_tree(&repository.0, &base, "preview.txt", None)
            .unwrap();
        assert!(diff.truncated);
        assert_eq!(diff.patch.len(), MAX_FILE_DIFF_BYTES);
        assert!(diff.patch.starts_with("diff --git "));
        assert_eq!(fs::read(repository.0.join("preview.txt")).unwrap(), large);
    }
}

#[test]
fn single_file_recovery_ignores_colour_prefix_and_context_display_settings() {
    for tracked in [false, true] {
        let repository = Repository::new();
        repository.write("seed", b"seed\n");
        if tracked {
            repository.write("preview.txt", b"north\nmiddle\nsouth\n");
        }
        repository.commit("Raw recovery baseline");
        for (key, value) in [
            ("color.ui", "always"),
            ("diff.noprefix", "true"),
            ("diff.mnemonicPrefix", "true"),
            ("diff.context", "0"),
        ] {
            repository.git(&["config", key, value]);
        }
        let bytes = b"north\nchanged\nsouth\n";
        repository.write("preview.txt", bytes);
        let patch =
            working_tree_file_recovery_patch(&repository.0, "preview.txt", !tracked).unwrap();
        assert!(
            patch.starts_with(b"diff --git a/preview.txt b/preview.txt\n"),
            "{}",
            String::from_utf8_lossy(&patch)
        );
        assert!(!patch.contains(&0x1b));
        let saved = repository.0.join(".git/owned-stable-recovery.patch");
        fs::write(&saved, patch).unwrap();
        discard_path(&repository.0, "preview.txt", !tracked).unwrap();
        apply_working_tree_recovery(&repository.0, &saved, false).unwrap();
        assert_eq!(fs::read(repository.0.join("preview.txt")).unwrap(), bytes);
        assert_eq!(repository.git(&["config", "diff.noprefix"]), b"true\n");
        assert_eq!(repository.git(&["config", "diff.context"]), b"0\n");
    }
}

#[test]
fn metadata_inspection_never_executes_configured_text_converters() {
    for action in ["commit", "stash", "commits", "working"] {
        let (repository, base, _) = converter_fixture(true, false);
        let result = match action {
            "commit" => {
                let tip = repository.commit("Raw metadata");
                commit_details(&repository.0, &tip).map(|details| details.files)
            }
            "stash" => {
                repository.git(&["stash", "push", "-m", "Raw metadata"]);
                stash_details(&repository.0, "stash@{0}").map(|details| details.files)
            }
            "commits" => {
                let tip = repository.commit("Raw metadata");
                compare_commits(&repository.0, &base, &tip).map(|comparison| comparison.files)
            }
            _ => compare_commit_with_working_tree(&repository.0, &base)
                .map(|comparison| comparison.files),
        };
        assert!(
            !repository.0.join(".git/converter-called").exists(),
            "converter executed for {action}"
        );
        let files = result.unwrap();
        let file = files
            .iter()
            .find(|file| file.path == "preview.owned")
            .unwrap();
        assert_eq!(
            (file.additions, file.deletions),
            (Some(1), Some(1)),
            "metadata for {action}"
        );
    }
}

fn git_new_file_counts(repository: &Repository, file: &str) -> (Option<usize>, Option<usize>) {
    // Use an owned alternate index: no-index neither represents directory links
    // as link blobs nor resolves attributes that only exist in the index.
    let directory = repository.git(&["rev-parse", "--absolute-git-dir"]);
    let directory = std::str::from_utf8(&directory)
        .unwrap()
        .strip_suffix('\n')
        .unwrap();
    let directory = PathBuf::from(directory);
    let index = directory.join("owned-statistics-oracle-index");
    fs::copy(directory.join("index"), &index).unwrap();
    let environment = [("GIT_INDEX_FILE", index.to_str().unwrap())];
    let add = run_git_with_environment(
        &repository.0,
        &["--literal-pathspecs", "add", "--sparse", "--", file],
        &environment,
    )
    .unwrap();
    ensure_success("prepare owned statistics oracle", &add).unwrap();
    let output = run_git_with_environment(
        &repository.0,
        &[
            "--literal-pathspecs",
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--numstat",
            "-z",
            "--",
            file,
        ],
        &environment,
    )
    .unwrap();
    ensure_success("read owned statistics oracle", &output).unwrap();
    fs::remove_file(index).unwrap();
    let fields: Vec<_> = output.stdout.split(|byte| *byte == b'\t').take(2).collect();
    assert_eq!(
        fields.len(),
        2,
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let count = |bytes: &[u8]| std::str::from_utf8(bytes).unwrap().parse::<usize>().ok();
    (count(fields[0]), count(fields[1]))
}

#[test]
fn untracked_symlink_statistics_describe_link_bytes_without_following_external_targets() {
    use std::os::unix::ffi::OsStringExt;
    use std::os::unix::fs::symlink;
    for kind in [
        "text",
        "binary",
        "directory",
        "missing",
        "newline",
        "non-utf8",
    ] {
        let repository = Repository::new();
        let outside = Repository::new();
        repository.write("seed", b"seed\n");
        let base = repository.commit("Base");
        let target = match kind {
            "newline" => PathBuf::from("missing\nsecond-line"),
            "non-utf8" => PathBuf::from(std::ffi::OsString::from_vec(b"missing-\xff".to_vec())),
            _ => outside.0.join("target"),
        };
        match kind {
            "text" => fs::write(
                &target,
                b"external first\nexternal second\nexternal third\n",
            )
            .unwrap(),
            "binary" => fs::write(&target, [0, 1, 255]).unwrap(),
            "directory" => fs::create_dir(&target).unwrap(),
            _ => {}
        }
        symlink(&target, repository.0.join("link")).unwrap();
        let expected = git_new_file_counts(&repository, "link");
        let index = repository.git(&["ls-files", "--stage", "-z"]);
        let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == "link")
            .unwrap();
        assert_eq!(
            (entry.additions, entry.deletions),
            expected,
            "link target {kind}"
        );
        assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
        assert_eq!(fs::read_link(repository.0.join("link")).unwrap(), target);
        if kind == "text" {
            assert_eq!(
                fs::read(&target).unwrap(),
                b"external first\nexternal second\nexternal third\n"
            );
        }
    }
}

#[test]
fn untracked_text_statistics_count_bytes_instead_of_requiring_utf8() {
    for bytes in [
        b"first\xff\nsecond\xfe".as_slice(),
        b"",
        b"one\n",
        b"one\r\ntwo\r\n",
        b"binary\0contents\n",
    ] {
        let repository = Repository::new();
        repository.write("seed", b"seed\n");
        let base = repository.commit("Base");
        repository.write("untracked.txt", bytes);
        let expected = git_new_file_counts(&repository, "untracked.txt");
        let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == "untracked.txt")
            .unwrap();
        assert_eq!(
            (entry.additions, entry.deletions),
            expected,
            "statistics for {bytes:?}"
        );
        assert_eq!(fs::read(repository.0.join("untracked.txt")).unwrap(), bytes);
    }
}

#[test]
fn untracked_binary_detection_matches_gits_prefix_boundary() {
    let repository = Repository::new();
    repository.write("seed", b"seed\n");
    let base = repository.commit("Base");
    for offset in [0, 7999, 8000, 8191, 8192, 16000] {
        let mut bytes = vec![b'x'; 20000];
        bytes[offset] = 0;
        bytes[19000] = b'\n';
        repository.write("untracked.txt", &bytes);
        let expected = git_new_file_counts(&repository, "untracked.txt");
        let index = repository.git(&["ls-files", "--stage", "-z"]);
        let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == "untracked.txt")
            .unwrap();
        assert_eq!(
            (entry.additions, entry.deletions),
            expected,
            "NUL at byte {offset}"
        );
        assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
        assert_eq!(fs::read(repository.0.join("untracked.txt")).unwrap(), bytes);
    }
}

#[test]
fn untracked_statistics_respect_diff_attributes_and_driver_configuration() {
    for (rule, config, bytes) in [
        ("-diff", None, b"first\nsecond\n".as_slice()),
        ("binary", None, b"first\nsecond\n".as_slice()),
        ("diff", None, b"first\0\nsecond\n".as_slice()),
        (
            "diff=owned",
            Some(("diff.owned.binary", "true")),
            b"text\n".as_slice(),
        ),
        (
            "diff=owned",
            Some(("diff.owned.binary", "false")),
            b"first\0\nsecond\n".as_slice(),
        ),
        ("diff=owned", None, b"first\0\nsecond\n".as_slice()),
        ("diff=set", None, b"first\0\nsecond\n".as_slice()),
        ("diff=unset", None, b"text\n".as_slice()),
        (
            "diff=owned",
            Some(("diff.owned.binary", "auto")),
            b"first\0\nsecond\n".as_slice(),
        ),
        (
            "diff=owned",
            Some(("diff.owned.binary", "-1")),
            b"text\n".as_slice(),
        ),
        (
            "diff=Owned",
            Some(("diff.Owned.binary", "OFF")),
            b"first\0\nsecond\n".as_slice(),
        ),
        (
            "diff=set",
            Some(("diff.set.binary", "true")),
            b"text\n".as_slice(),
        ),
        (
            "diff",
            Some(("diff.set.binary", "true")),
            b"first\0\nsecond\n".as_slice(),
        ),
        (
            "diff=set",
            Some(("diff.default.binary", "true")),
            b"text\n".as_slice(),
        ),
        (
            "diff=cpp",
            Some(("diff.default.binary", "true")),
            b"text\n".as_slice(),
        ),
        (
            "!diff",
            Some(("diff.default.binary", "true")),
            b"text\n".as_slice(),
        ),
        (
            "diff=unknown",
            Some(("diff.default.binary", "true")),
            b"text\n".as_slice(),
        ),
    ] {
        let repository = Repository::new();
        repository.write("seed", b"seed\n");
        repository.write(".gitattributes", format!("*.owned {rule}\n").as_bytes());
        let base = repository.commit("Attributes");
        if let Some((key, value)) = config {
            repository.git(&["config", key, value]);
        }
        repository.write("selected.owned", bytes);
        let expected = git_new_file_counts(&repository, "selected.owned");
        let index = repository.git(&["ls-files", "--stage", "-z"]);
        let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == "selected.owned")
            .unwrap();
        assert_eq!(
            (entry.additions, entry.deletions),
            expected,
            "rule={rule}, config={config:?}"
        );
        assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
        assert_eq!(
            fs::read(repository.0.join("selected.owned")).unwrap(),
            bytes
        );
    }
}

#[test]
fn untracked_statistics_respect_large_file_threshold_and_explicit_overrides() {
    for (threshold, size, rule) in [
        ("32", 31, "!diff"),
        ("32", 32, "!diff"),
        ("32", 33, "!diff"),
        ("1k", 1024, "!diff"),
        ("1k", 1025, "!diff"),
        ("0", 1, "!diff"),
        ("32", 33, "diff"),
        ("32", 33, "diff=owned"),
    ] {
        let repository = Repository::new();
        repository.write("seed", b"seed\n");
        repository.write(
            ".gitattributes",
            format!("selected.owned {rule}\n").as_bytes(),
        );
        let base = repository.commit("Threshold");
        repository.git(&["config", "core.bigFileThreshold", threshold]);
        repository.git(&["config", "diff.owned.binary", "false"]);
        let bytes = vec![b'x'; size];
        repository.write("selected.owned", &bytes);
        let expected = git_new_file_counts(&repository, "selected.owned");
        let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == "selected.owned")
            .unwrap();
        assert_eq!(
            (entry.additions, entry.deletions),
            expected,
            "threshold={threshold}, size={size}, rule={rule}"
        );
        assert_eq!(
            fs::read(repository.0.join("selected.owned")).unwrap(),
            bytes
        );
    }
}

#[test]
fn untracked_statistics_resolve_inherited_attributes_in_literal_path_batches() {
    let repository = Repository::new();
    repository.write(".gitattributes", b"*.owned -diff\ntext*.owned diff\n");
    fs::create_dir(repository.0.join("nested")).unwrap();
    repository.write("nested/.gitattributes", b"*.owned diff\n");
    let base = repository.commit("Inherited attributes");
    repository.write(".git/info/attributes", b"info.owned diff\n");
    for index in 0..260 {
        let name = format!(
            "{}-{index:03}-{}.owned",
            if index % 2 == 0 { "text" } else { "binary" },
            "x".repeat(64)
        );
        repository.write(&name, b"one\0\ntwo\n");
    }
    for name in [
        "nested/*.owned",
        "nested/[ab].owned",
        "nested/:(glob)*.owned",
        "nested/--file.owned",
        "nested/line\nbreak.owned",
        "info.owned",
    ] {
        repository.write(name, b"one\0\ntwo\n");
    }
    repository.git(&["add", "--all"]);
    let expected = parse_numstat(&repository.git(&[
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--numstat",
        "-z",
    ]));
    repository.git(&["reset"]);
    let index = repository.git(&["ls-files", "--stage", "-z"]);
    let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
    assert_eq!(comparison.files.len(), expected.len());
    for entry in comparison.files {
        assert_eq!(
            (entry.additions, entry.deletions),
            expected[&entry.path],
            "{}",
            entry.path
        );
        assert_eq!(
            fs::read(repository.0.join(entry.path)).unwrap(),
            b"one\0\ntwo\n"
        );
    }
    assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
}

#[test]
fn untracked_link_statistics_respect_attributes_without_reading_target_contents() {
    use std::os::unix::fs::symlink;
    for (rule, threshold) in [
        ("-diff", "0"),
        ("diff", "0"),
        ("diff=owned", "0"),
        ("!diff", "0"),
        ("-diff", "32"),
        ("diff", "32"),
        ("diff=owned", "32"),
        ("!diff", "32"),
    ] {
        let repository = Repository::new();
        repository.write(".gitattributes", format!("link {rule}\n").as_bytes());
        let base = repository.commit("Link attributes");
        repository.git(&["config", "core.bigFileThreshold", threshold]);
        repository.git(&["config", "diff.owned.binary", "true"]);
        symlink("missing\nsecond", repository.0.join("link")).unwrap();
        let expected = git_new_file_counts(&repository, "link");
        let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == "link")
            .unwrap();
        assert_eq!((entry.additions, entry.deletions), expected, "rule={rule}");
    }
}

#[test]
fn untracked_statistics_honor_global_macro_and_index_only_attributes() {
    for source in ["global", "macro", "index"] {
        let repository = Repository::new();
        let outside = Repository::new();
        repository.write("seed", b"seed\n");
        if source == "macro" {
            repository.write(
                ".gitattributes",
                b"[attr]ownedbinary -diff\n*.owned ownedbinary\n",
            );
        } else if source == "index" {
            repository.write(".gitattributes", b"*.owned -diff\n");
        }
        let base = repository.commit("Attribute sources");
        if source == "global" {
            outside.write("attributes", b"*.owned -diff\n");
            repository.git(&[
                "config",
                "core.attributesFile",
                outside.0.join("attributes").to_str().unwrap(),
            ]);
        } else if source == "index" {
            fs::remove_file(repository.0.join(".gitattributes")).unwrap();
        }
        repository.write("selected.owned", b"one\ntwo\n");
        let expected = git_new_file_counts(&repository, "selected.owned");
        let index = repository.git(&["ls-files", "--stage", "-z"]);
        let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == "selected.owned")
            .unwrap();
        assert_eq!(
            (entry.additions, entry.deletions),
            expected,
            "source={source}"
        );
        assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
        assert_eq!(
            fs::read(repository.0.join("selected.owned")).unwrap(),
            b"one\ntwo\n"
        );
    }
}

#[test]
fn untracked_statistics_support_sha256_repositories() {
    let repository = Repository::with_object_format("sha256");
    repository.write("seed", b"seed\n");
    let base = repository.commit("SHA-256 baseline");
    assert_eq!(base.len(), 64);
    repository.write("untracked.txt", b"one\ntwo\n");
    let expected = git_new_file_counts(&repository, "untracked.txt");
    let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
    let entry = comparison
        .files
        .iter()
        .find(|entry| entry.path == "untracked.txt")
        .unwrap();
    assert_eq!((entry.additions, entry.deletions), expected);
}

#[test]
fn stash_previews_support_sha256_tracked_and_untracked_objects() {
    let repository = Repository::with_object_format("sha256");
    repository.write("tracked.txt", b"base\n");
    repository.commit("SHA-256 baseline");
    repository.write("tracked.txt", b"saved tracked\n");
    repository.write("*.tmp", b"saved untracked\n");
    stash(&repository.0).unwrap();
    let selected = reference_tip(&repository.0, "refs/stash").unwrap();
    assert_eq!(selected.len(), 64);
    let details = stash_details_at_oid(&repository.0, &selected).unwrap();
    assert_eq!(details.files.len(), 2);
    for (path, expected) in [("tracked.txt", "saved tracked"), ("*.tmp", "saved untracked")] {
        let patch = stash_file_diff_at_oid(&repository.0, &selected, path, None).unwrap();
        assert_eq!(patch.oid, selected);
        assert!(patch.patch.contains(expected));
    }
}

#[test]
fn untracked_statistics_preserve_index_variants_and_attribute_modes() {
    for variant in ["v4", "split", "separate", "executable"] {
        let repository = Repository::new();
        let outside = Repository::new();
        repository.write(".gitattributes", b"*.owned -diff\n");
        let base = repository.commit("Index variants");
        repository.write(".gitattributes", b"*.owned diff\n");
        if variant == "executable" {
            repository.git(&["add", "--chmod=+x", ".gitattributes"]);
        } else {
            repository.git(&["add", ".gitattributes"]);
        }
        fs::remove_file(repository.0.join(".gitattributes")).unwrap();
        repository.write("selected.owned", b"one\0\ntwo\n");
        let expected = git_new_file_counts(&repository, "selected.owned");
        match variant {
            "v4" => {
                repository.git(&["update-index", "--index-version=4"]);
            }
            "split" => {
                repository.git(&["update-index", "--split-index"]);
            }
            "executable" => {}
            _ => {
                repository.git(&[
                    "init",
                    "--separate-git-dir",
                    outside.0.join("metadata").to_str().unwrap(),
                ]);
            }
        }
        let index = if variant == "separate" {
            outside.0.join("metadata/index")
        } else {
            repository.0.join(".git/index")
        };
        let original_index = fs::read(&index).unwrap();
        let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == "selected.owned")
            .unwrap();
        assert_eq!(
            (entry.additions, entry.deletions),
            expected,
            "variant={variant}"
        );
        assert_eq!(fs::read(&index).unwrap(), original_index);
        assert_eq!(
            repository.git(&["rev-parse", "HEAD"]),
            format!("{base}\n").as_bytes()
        );
        assert_eq!(
            fs::read(repository.0.join("selected.owned")).unwrap(),
            b"one\0\ntwo\n"
        );
    }
}

#[test]
fn untracked_statistics_use_attributes_inside_sparse_index_directories() {
    let repository = Repository::new();
    fs::create_dir(repository.0.join("included")).unwrap();
    fs::create_dir(repository.0.join("excluded")).unwrap();
    repository.write("included/seed", b"seed\n");
    repository.write("excluded/.gitattributes", b"*.owned -diff\n");
    repository.write("excluded/seed", b"seed\n");
    let base = repository.commit("Sparse attribute tree");
    repository.git(&[
        "sparse-checkout",
        "set",
        "--cone",
        "--sparse-index",
        "included",
    ]);
    assert!(!repository.0.join("excluded/.gitattributes").exists());
    let listing = repository.git(&["ls-files", "--sparse", "--stage"]);
    assert!(
        String::from_utf8_lossy(&listing).contains("040000 "),
        "{}",
        String::from_utf8_lossy(&listing)
    );
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    fs::create_dir_all(repository.0.join("excluded")).unwrap();
    repository.write("excluded/selected.owned", b"one\ntwo\n");
    let expected = git_new_file_counts(&repository, "excluded/selected.owned");
    assert_eq!(expected, (None, None));
    let comparison = compare_commit_with_working_tree(&repository.0, &base).unwrap();
    let entry = comparison
        .files
        .iter()
        .find(|entry| entry.path == "excluded/selected.owned")
        .unwrap();
    assert_eq!((entry.additions, entry.deletions), expected);
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert!(!repository.0.join("excluded/.gitattributes").exists());
    assert_eq!(
        fs::read(repository.0.join("excluded/selected.owned")).unwrap(),
        b"one\ntwo\n"
    );
}

#[test]
fn linked_worktree_statistics_use_its_index_and_common_attribute_overrides() {
    let repository = Repository::new();
    let outside = Repository::new();
    repository.write(".gitattributes", b"*.owned -diff\n");
    let base = repository.commit("Linked attributes");
    let linked_path = outside.0.join("linked");
    repository.git(&[
        "worktree",
        "add",
        "-b",
        "statistics-linked",
        linked_path.to_str().unwrap(),
    ]);
    let linked = Repository(linked_path);
    linked.write(".gitattributes", b"*.owned diff\n");
    linked.git(&["add", ".gitattributes"]);
    fs::remove_file(linked.0.join(".gitattributes")).unwrap();
    repository.write(".git/info/attributes", b"forced.owned -diff\n");
    linked.write("selected.owned", b"one\0\ntwo\n");
    linked.write("forced.owned", b"one\ntwo\n");
    let selected = git_new_file_counts(&linked, "selected.owned");
    let forced = git_new_file_counts(&linked, "forced.owned");
    assert_eq!(selected, (Some(2), Some(0)));
    assert_eq!(forced, (None, None));
    let main_index = fs::read(repository.0.join(".git/index")).unwrap();
    let linked_git = linked.git(&["rev-parse", "--absolute-git-dir"]);
    let linked_git = std::str::from_utf8(&linked_git)
        .unwrap()
        .strip_suffix('\n')
        .unwrap();
    let linked_index = fs::read(Path::new(linked_git).join("index")).unwrap();
    let comparison = compare_commit_with_working_tree(&linked.0, &base).unwrap();
    for (path, expected) in [("selected.owned", selected), ("forced.owned", forced)] {
        let entry = comparison
            .files
            .iter()
            .find(|entry| entry.path == path)
            .unwrap();
        assert_eq!((entry.additions, entry.deletions), expected, "{path}");
    }
    assert_eq!(
        fs::read(repository.0.join(".git/index")).unwrap(),
        main_index
    );
    assert_eq!(
        fs::read(Path::new(linked_git).join("index")).unwrap(),
        linked_index
    );
    assert_eq!(
        repository.git(&["rev-parse", "HEAD"]),
        format!("{base}\n").as_bytes()
    );
    assert_eq!(
        linked.git(&["rev-parse", "HEAD"]),
        format!("{base}\n").as_bytes()
    );
}

#[test]
fn selected_stash_of_a_renamed_file_rolls_back_both_names_and_preserves_neighbours() {
    for (old, new) in [
        ("old.txt", "new.txt"),
        ("old*.txt", "new*.txt"),
        ("old[ab].txt", "new[ab].txt"),
        ("old\nline.txt", "new\nline.txt"),
        ("-old.txt", "-new.txt"),
        ("old space.txt", "new space.txt"),
        (" old.txt ", " new.txt "),
    ] {
        for mode in ["all", "staged-only"] {
            let repository = Repository::new();
            repository.write(old, b"selected original\n");
            repository.write("neighbour.txt", b"neighbour original\n");
            let base = repository.commit("Rename baseline");
            repository.git(&["--literal-pathspecs", "mv", "--", old, new]);
            repository.write("neighbour.txt", b"preserve neighbour edit\n");
            stash_with_options(
                &repository.0,
                &StashOptions {
                    mode: mode.into(),
                    include_untracked: false,
                    paths: Some(vec![new.into()]),
                    message: "Selected rename".into(),
                },
            )
            .unwrap();
            assert_eq!(
                fs::read(repository.0.join(old)).unwrap(),
                b"selected original\n",
                "mode={mode}, {old}->{new}"
            );
            assert!(!repository.0.join(new).exists());
            assert_eq!(
                fs::read(repository.0.join("neighbour.txt")).unwrap(),
                b"preserve neighbour edit\n"
            );
            assert!(
                repository
                    .git(&["diff", "--cached", "--name-only", "-z"])
                    .is_empty()
            );
            assert_eq!(
                repository.git(&["rev-parse", "HEAD"]),
                format!("{base}\n").as_bytes()
            );
            let stash = read_stashes(&repository.0).unwrap().remove(0);
            apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, true).unwrap();
            assert!(!repository.0.join(old).exists());
            assert_eq!(
                fs::read(repository.0.join(new)).unwrap(),
                b"selected original\n"
            );
            assert_eq!(
                fs::read(repository.0.join("neighbour.txt")).unwrap(),
                b"preserve neighbour edit\n"
            );
        }
    }
}

#[test]
fn selected_rename_stash_refuses_unselected_files_reusing_the_old_name() {
    for include_untracked in [false, true] {
        for directory in [false, true] {
            let repository = Repository::new();
            repository.write("old", b"original\n");
            let base = repository.commit("Old path reuse");
            repository.git(&["mv", "old", "new"]);
            let occupant = if directory {
                fs::create_dir(repository.0.join("old")).unwrap();
                "old/occupant"
            } else {
                "old"
            };
            repository.write(occupant, b"unselected contents\n");
            let index = fs::read(repository.0.join(".git/index")).unwrap();
            let error = stash_with_options(
                &repository.0,
                &StashOptions {
                    mode: "all".into(),
                    include_untracked,
                    paths: Some(vec!["new".into()]),
                    message: "Guard reuse".into(),
                },
            )
            .unwrap_err();
            assert_eq!(error.kind, "overlappingStashSelection");
            assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
            assert_eq!(
                fs::read(repository.0.join(occupant)).unwrap(),
                b"unselected contents\n"
            );
            assert_eq!(fs::read(repository.0.join("new")).unwrap(), b"original\n");
            assert!(read_stashes(&repository.0).unwrap().is_empty());
            assert_eq!(
                repository.git(&["rev-parse", "HEAD"]),
                format!("{base}\n").as_bytes()
            );
        }
    }
}

#[test]
fn selected_rename_chains_require_all_destinations_and_can_round_trip_together() {
    let repository = Repository::new();
    repository.write("source", b"alpha\n");
    fs::create_dir(repository.0.join("folder")).unwrap();
    repository.write("folder/item", b"bravo\n");
    let base = repository.commit("Rename chain");
    repository.git(&["mv", "folder/item", "destination"]);
    if repository.0.join("folder").exists() {
        fs::remove_dir(repository.0.join("folder")).unwrap();
    }
    repository.git(&["mv", "source", "folder"]);
    assert_eq!(
        read_status(&repository.0)
            .unwrap()
            .entries
            .iter()
            .filter(|entry| entry.index_status == "R")
            .count(),
        2
    );
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    let original_entries = repository.git(&["ls-files", "--stage", "-z"]);
    let mut options = StashOptions {
        mode: "all".into(),
        include_untracked: false,
        paths: Some(vec!["folder".into()]),
        message: "Rename chain".into(),
    };
    assert_eq!(
        stash_with_options(&repository.0, &options)
            .unwrap_err()
            .kind,
        "overlappingStashSelection"
    );
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(repository.0.join("folder")).unwrap(), b"alpha\n");
    assert_eq!(
        fs::read(repository.0.join("destination")).unwrap(),
        b"bravo\n"
    );
    assert!(read_stashes(&repository.0).unwrap().is_empty());
    options.paths = Some(vec!["folder".into(), "destination".into()]);
    stash_with_options(&repository.0, &options).unwrap();
    assert_eq!(fs::read(repository.0.join("source")).unwrap(), b"alpha\n");
    assert_eq!(
        fs::read(repository.0.join("folder/item")).unwrap(),
        b"bravo\n"
    );
    assert!(!repository.0.join("destination").exists());
    assert!(
        repository
            .git(&["diff", "--cached", "--name-only"])
            .is_empty()
    );
    let stash = read_stashes(&repository.0).unwrap().remove(0);
    apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, true).unwrap();
    assert_eq!(
        repository.git(&["ls-files", "--stage", "-z"]),
        original_entries
    );
    assert!(!repository.0.join("source").exists());
    assert_eq!(fs::read(repository.0.join("folder")).unwrap(), b"alpha\n");
    assert_eq!(
        fs::read(repository.0.join("destination")).unwrap(),
        b"bravo\n"
    );
    assert_eq!(
        repository.git(&["rev-parse", "HEAD"]),
        format!("{base}\n").as_bytes()
    );
}

#[test]
fn keep_index_selected_rename_leaves_staged_contents_and_captures_complete_changes() {
    let repository = Repository::new();
    repository.write("old", b"one\ntwo\n");
    repository.commit("Keep index rename");
    repository.git(&["mv", "old", "new"]);
    repository.write("new", b"one\nchanged\n");
    let index = repository.git(&["ls-files", "--stage", "-z"]);
    stash_with_options(
        &repository.0,
        &StashOptions {
            mode: "keep-index".into(),
            include_untracked: false,
            paths: Some(vec!["new".into()]),
            message: "Keep renamed index".into(),
        },
    )
    .unwrap();
    assert!(!repository.0.join("old").exists());
    assert_eq!(fs::read(repository.0.join("new")).unwrap(), b"one\ntwo\n");
    assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
    let stash = read_stashes(&repository.0).unwrap().remove(0);
    assert_eq!(
        repository.git(&["show", &format!("{}:new", stash.oid)]),
        b"one\nchanged\n"
    );
    assert_eq!(
        repository.git(&["show", &format!("{}^2:new", stash.oid)]),
        b"one\ntwo\n"
    );
    // --keep-index retains staged changes but also records them in the stash.
    // Reapplying on top of those same changes can conflict in Git itself;
    // verify restoration from the original base instead.
    repository.git(&["restore", "--source=HEAD", "--staged", "--worktree", "."]);
    apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, true).unwrap();
    assert!(!repository.0.join("old").exists());
    assert_eq!(
        fs::read(repository.0.join("new")).unwrap(),
        b"one\nchanged\n"
    );
    assert_eq!(repository.git(&["ls-files", "--stage", "-z"]), index);
}

#[test]
fn explicit_stash_index_option_overrides_repository_default() {
    for configured in ["true", "false"] {
        for restore_index in [false, true] {
            let repository = Repository::new();
            repository.write("file", b"base\n");
            repository.commit("Index option");
            repository.write("file", b"staged\n");
            repository.git(&["add", "file"]);
            repository.write("file", b"working\n");
            stash_with_options(
                &repository.0,
                &StashOptions {
                    mode: "all".into(),
                    include_untracked: false,
                    paths: None,
                    message: "Index option".into(),
                },
            )
            .unwrap();
            let stash = read_stashes(&repository.0).unwrap().remove(0);
            repository.git(&["config", "stash.index", configured]);
            apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, restore_index)
                .unwrap();
            assert_eq!(
                repository.git(&["show", ":file"]),
                if restore_index {
                    b"staged\n".as_slice()
                } else {
                    b"base\n".as_slice()
                },
                "configured={configured}, restore={restore_index}"
            );
            assert_eq!(fs::read(repository.0.join("file")).unwrap(), b"working\n");
        }
    }
}

#[test]
fn git_input_and_output_can_exceed_pipe_capacity_without_losing_records() {
    let repository = Repository::new();
    let input = b"file\0".repeat(100_000);
    let output = run_git_with_input_output(
        &repository.0,
        &["check-attr", "--stdin", "-z", "diff"],
        &input,
    )
    .unwrap();
    ensure_success("inspect streamed attributes", &output).unwrap();
    assert_eq!(output.stdout, b"file\0diff\0unspecified\0".repeat(100_000));
}

#[test]
fn early_git_input_refusal_preserves_the_actual_failure_diagnostic() {
    let repository = Repository::new();
    let output = run_git_with_input_output(
        &repository.0,
        &["check-attr", "--not-a-valid-option"],
        &vec![b'x'; 1_000_000],
    )
    .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("unknown option"));
}

#[test]
fn selected_staged_deletions_preserve_unselected_changes() {
    for mode in ["all", "staged-only"] {
        let repository = Repository::new();
        repository.baseline("deleted*.txt", "neighbour.txt");
        repository.git(&["--literal-pathspecs", "rm", "deleted*.txt"]);
        repository.write("neighbour.txt", b"neighbour staged\n");
        repository.git(&["add", "neighbour.txt"]);
        repository.write("neighbour.txt", b"neighbour working\n");
        stash_with_options(
            &repository.0,
            &StashOptions {
                mode: mode.into(),
                include_untracked: false,
                paths: Some(vec!["deleted*.txt".into()]),
                message: "Selected deletion".into(),
            },
        )
        .unwrap();
        assert_eq!(
            fs::read(repository.0.join("deleted*.txt")).unwrap(),
            b"selected old\n"
        );
        assert_eq!(
            repository.git(&["show", ":neighbour.txt"]),
            b"neighbour staged\n"
        );
        assert_eq!(
            fs::read(repository.0.join("neighbour.txt")).unwrap(),
            b"neighbour working\n"
        );
        let stash = read_stashes(&repository.0).unwrap().remove(0);
        // As in Git, --index can conflict with the already-retained staged
        // neighbour. Applying without it must still restore the deletion and
        // preserve both layers of the unselected change.
        apply_stash_with_index(&repository.0, &stash.reference, &stash.oid, false).unwrap();
        assert!(!repository.0.join("deleted*.txt").exists());
        assert_eq!(
            repository.git(&["show", ":neighbour.txt"]),
            b"neighbour staged\n"
        );
        assert_eq!(
            fs::read(repository.0.join("neighbour.txt")).unwrap(),
            b"neighbour working\n"
        );
    }
}

#[test]
fn selected_rename_refuses_ignored_contents_reusing_its_old_path() {
    for include_untracked in [false, true] {
        let repository = Repository::new();
        repository.write("old", b"original\n");
        repository.write(".gitignore", b"/old\n");
        repository.git(&["add", "--force", "old", ".gitignore"]);
        repository.git(&["commit", "-m", "Ignored old path"]);
        repository.git(&["mv", "old", "new"]);
        repository.write("old", b"ignored precious contents\n");
        let index = fs::read(repository.0.join(".git/index")).unwrap();
        let error = stash_with_options(
            &repository.0,
            &StashOptions {
                mode: "all".into(),
                include_untracked,
                paths: Some(vec!["new".into()]),
                message: "Do not overwrite ignored data".into(),
            },
        )
        .unwrap_err();
        assert_eq!(error.kind, "overlappingStashSelection");
        assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.0.join("old")).unwrap(),
            b"ignored precious contents\n"
        );
        assert_eq!(fs::read(repository.0.join("new")).unwrap(), b"original\n");
        assert!(read_stashes(&repository.0).unwrap().is_empty());
    }
}

#[test]
fn selected_staged_stash_respects_foreign_index_locks_without_mutation() {
    let repository = Repository::new();
    repository.baseline("selected", "neighbour");
    repository.write("selected", b"staged contents\n");
    repository.git(&["add", "selected"]);
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    repository.write(".git/index.lock", b"foreign lock\n");
    let error = stash_with_options(
        &repository.0,
        &StashOptions {
            mode: "staged-only".into(),
            include_untracked: false,
            paths: Some(vec!["selected".into()]),
            message: "Respect another writer".into(),
        },
    )
    .unwrap_err();
    assert_eq!(error.kind, "stashIndexFailed");
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(repository.0.join(".git/index.lock")).unwrap(),
        b"foreign lock\n"
    );
    assert_eq!(
        fs::read(repository.0.join("selected")).unwrap(),
        b"staged contents\n"
    );
    assert!(read_stashes(&repository.0).unwrap().is_empty());
    assert!(
        !fs::read_dir(repository.0.join(".git"))
            .unwrap()
            .any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("git-khronos-stash-")
            })
    );
}

#[test]
fn selected_staged_stash_excludes_both_names_of_unselected_renames() {
    for split in [false, true] {
        let repository = Repository::new();
        repository.baseline("selected", "old");
        repository.git(&["mv", "old", "new"]);
        repository.write("new", b"unselected working\n");
        repository.write("selected", b"selected staged\n");
        repository.git(&["add", "selected"]);
        if split {
            repository.git(&["update-index", "--split-index"]);
        }
        stash_with_options(
            &repository.0,
            &StashOptions {
                mode: "staged-only".into(),
                include_untracked: false,
                paths: Some(vec!["selected".into()]),
                message: "Exact staged scope".into(),
            },
        )
        .unwrap();
        assert_eq!(
            fs::read(repository.0.join("selected")).unwrap(),
            b"selected old\n"
        );
        assert!(!repository.0.join("old").exists());
        assert_eq!(
            fs::read(repository.0.join("new")).unwrap(),
            b"unselected working\n"
        );
        assert_eq!(repository.git(&["show", ":new"]), b"unrelated old\n");
        let stash = read_stashes(&repository.0).unwrap().remove(0);
        assert_eq!(
            repository.git(&[
                "diff",
                "--name-only",
                &format!("{}^1", stash.oid),
                &stash.oid
            ]),
            b"selected\n"
        );
        assert_eq!(repository.git(&["show", ":selected"]), b"selected old\n");
        assert_eq!(repository.git(&["show", ":new"]), b"unrelated old\n");
        assert_eq!(
            fs::read(repository.0.join("new")).unwrap(),
            b"unselected working\n"
        );
        assert!(!repository.0.join("old").exists());
        assert!(!repository.0.join(".git/index.lock").exists());
    }
}

#[cfg(unix)]
#[test]
fn selected_stash_leaves_unselected_non_utf8_untracked_names_in_place() {
    use std::os::unix::ffi::OsStringExt;
    let repository = Repository::new();
    repository.baseline("selected", "neighbour");
    repository.write("selected", b"selected changes\n");
    let other = repository
        .0
        .join(std::ffi::OsString::from_vec(b"unselected-\xff".to_vec()));
    fs::write(&other, b"unselected precious contents\n").unwrap();
    stash_with_options(
        &repository.0,
        &StashOptions {
            mode: "all".into(),
            include_untracked: true,
            paths: Some(vec!["selected".into()]),
            message: "Keep raw names".into(),
        },
    )
    .unwrap();
    assert_eq!(fs::read(&other).unwrap(), b"unselected precious contents\n");
    assert_eq!(
        fs::read(repository.0.join("selected")).unwrap(),
        b"selected old\n"
    );
}

#[test]
fn inherited_pathspec_flags_cannot_change_exact_file_selections() {
    const FLAGS: [&str; 4] = [
        "GIT_LITERAL_PATHSPECS",
        "GIT_GLOB_PATHSPECS",
        "GIT_NOGLOB_PATHSPECS",
        "GIT_ICASE_PATHSPECS",
    ];
    const CHILD: &str = "GIT_KHRONOS_PATHSPEC_TEST_CHILD";
    if std::env::var_os(CHILD).is_some() {
        selected_staged_stash_excludes_both_names_of_unselected_renames();
        historical_restore_of_a_pattern_named_file_cannot_overwrite_or_stage_neighbours();
        let repository = Repository::new();
        repository.baseline("selected.txt", "SELECTED.txt");
        repository.write("selected.txt", b"selected staged\n");
        repository.write("SELECTED.txt", b"unselected working\n");
        stage_path(&repository.0, "selected.txt").unwrap();
        assert_eq!(
            repository.git(&["show", ":selected.txt"]),
            b"selected staged\n"
        );
        assert_eq!(
            repository.git(&["show", ":SELECTED.txt"]),
            b"unrelated old\n"
        );
        assert_eq!(
            fs::read(repository.0.join("SELECTED.txt")).unwrap(),
            b"unselected working\n"
        );
        return;
    }
    for flag in FLAGS {
        let mut child = Command::new(std::env::current_exe().unwrap());
        child.args([
            "--exact",
            "literal_file_tests::inherited_pathspec_flags_cannot_change_exact_file_selections",
            "--nocapture",
        ]);
        for variable in FLAGS {
            child.env_remove(variable);
        }
        let output = child.env(CHILD, "1").env(flag, "1").output().unwrap();
        assert!(
            output.status.success(),
            "Inherited {flag} changed file selection:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn inherited_repository_routing_cannot_redirect_selected_repository_operations() {
    const ROUTING: [&str; 4] = [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
    ];
    const CHILD: &str = "GIT_KHRONOS_ROUTING_TEST_TARGET";
    if let Some(target) = std::env::var_os(CHILD) {
        let target = PathBuf::from(target);
        let outside = PathBuf::from(std::env::var_os("GIT_KHRONOS_ROUTING_TEST_OUTSIDE").unwrap());
        let outside_index = fs::read(outside.join(".git/index")).unwrap();
        stage_path(&target, "selected").unwrap();
        assert_eq!(
            fs::read(outside.join(".git/index")).unwrap(),
            outside_index,
            "An operation on the selected repository changed another repository's index"
        );
        let staged = run_git(&target, &["show", ":selected"]).unwrap();
        ensure_success("inspect the selected repository's staged data", &staged).unwrap();
        assert_eq!(staged.stdout, b"target staged contents\n");
        let head = run_git(&target, &["rev-parse", "HEAD"]).unwrap();
        ensure_success("inspect the selected repository's HEAD", &head).unwrap();
        assert_eq!(
            String::from_utf8(head.stdout).unwrap().trim(),
            std::env::var("GIT_KHRONOS_ROUTING_TEST_HEAD").unwrap()
        );
        let comparison = compare_commit_with_working_tree(
            &target,
            &std::env::var("GIT_KHRONOS_ROUTING_TEST_HEAD").unwrap(),
        )
        .unwrap();
        let untracked = comparison
            .files
            .iter()
            .find(|file| file.path == "new.bin")
            .unwrap();
        assert_eq!(
            untracked.additions, None,
            "Statistics read attributes from the inherited worktree instead of the selected repository"
        );
        assert_eq!(
            fs::read(outside.join("selected")).unwrap(),
            b"outside working contents\n"
        );
        return;
    }
    for variable in ROUTING {
        let target = Repository::new();
        target.baseline("selected", "neighbour");
        let outside = Repository::new();
        outside.write("selected", b"outside committed contents\n");
        outside.write(".gitattributes", b"new.bin diff\n");
        outside.commit("Different outside history");
        target.write(".gitattributes", b"new.bin -diff\n");
        target.commit("Selected repository attributes");
        target.write("selected", b"target staged contents\n");
        target.write("new.bin", b"untracked text governed by binary attributes\n");
        outside.write("selected", b"outside working contents\n");
        let value = match variable {
            "GIT_WORK_TREE" => outside.0.clone(),
            "GIT_INDEX_FILE" => outside.0.join(".git/index"),
            _ => outside.0.join(".git"),
        };
        let mut child = Command::new(std::env::current_exe().unwrap());
        child.args(["--exact", "literal_file_tests::inherited_repository_routing_cannot_redirect_selected_repository_operations", "--nocapture"]);
        for name in ROUTING {
            child.env_remove(name);
        }
        let output = child
            .env(CHILD, &target.0)
            .env("GIT_KHRONOS_ROUTING_TEST_OUTSIDE", &outside.0)
            .env(
                "GIT_KHRONOS_ROUTING_TEST_HEAD",
                String::from_utf8(target.git(&["rev-parse", "HEAD"]))
                    .unwrap()
                    .trim(),
            )
            .env(variable, value)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Inherited {variable} redirected the repository:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
