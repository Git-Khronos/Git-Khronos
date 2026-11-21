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

fn assert_bulk_index_operation_preserves_conflict(
    operation: impl FnOnce(&Path) -> Result<(), AppError>,
    conflicted_path: &str,
) {
    let repo = Repository::new();
    repo.write(conflicted_path, b"base\n");
    repo.write("prepared.txt", b"before staging\n");
    repo.commit("Base");
    repo.git(&["switch", "-c", "side"]);
    repo.write(conflicted_path, b"side\n");
    let side = repo.commit("Side");
    repo.git(&["switch", "main"]);
    repo.write(conflicted_path, b"main\n");
    let main = repo.commit("Main");
    let merge = run_git(&repo.0, &["merge", "--no-edit", "side"]).unwrap();
    assert_eq!(merge.status.code(), Some(1));
    repo.write("prepared.txt", b"explicitly staged\n");
    repo.git(&["add", "prepared.txt"]);
    repo.write("unstaged.txt", b"leave unstaged\n");
    let index = fs::read(repo.0.join(".git/index")).unwrap();
    let conflict = fs::read(repo.0.join(conflicted_path)).unwrap();
    let unmerged = repo.git(&["ls-files", "--unmerged", "-z"]);
    assert!(!unmerged.is_empty());

    let result = operation(&repo.0);
    assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), index, "bulk command wrote the index");
    assert_eq!(repo.git(&["ls-files", "--unmerged", "-z"]), unmerged);
    assert_eq!(fs::read(repo.0.join(conflicted_path)).unwrap(), conflict);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), format!("{main}\n").as_bytes());
    assert_eq!(repo.git(&["rev-parse", "MERGE_HEAD"]), format!("{side}\n").as_bytes());
    assert_eq!(result.unwrap_err().kind, "bulkIndexConflicts");
}

#[test]
fn bulk_stage_refuses_to_resolve_unmerged_entries() {
    assert_bulk_index_operation_preserves_conflict(
        |root| {
            let subdir = root.join("nested");
            fs::create_dir(&subdir).unwrap();
            stage_all(&subdir)
        },
        "shared.txt",
    );
}

#[test]
fn bulk_unstage_refuses_to_remove_unmerged_entries() {
    // Three unmerged index stages for this path overflow the bounded probe.
    assert_bulk_index_operation_preserves_conflict(unstage_all, &"x".repeat(185));
}

#[test]
fn bulk_stage_and_unstage_still_work_before_the_first_commit() {
    let repo = Repository::new();
    repo.write("first.txt", b"keep these bytes\n");
    stage_all(&repo.0).unwrap();
    assert_eq!(repo.git(&["ls-files", "-z"]), b"first.txt\0");
    unstage_all(&repo.0).unwrap();
    assert!(repo.git(&["ls-files", "-z"]).is_empty());
    assert_eq!(fs::read(repo.0.join("first.txt")).unwrap(), b"keep these bytes\n");
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
    for (path, expected) in [
        ("tracked.txt", "saved tracked"),
        ("*.tmp", "saved untracked"),
    ] {
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

#[test]
fn unstaged_summary_counts_index_relative_edits_untracked_and_deleted_lines() {
    let repository = Repository::new();
    repository.write("tracked.txt", b"old\nretained\n");
    repository.write("deleted.txt", b"gone\nline\n");
    repository.commit("Base");
    repository.write("tracked.txt", b"staged\nretained\n");
    repository.git(&["add", "tracked.txt"]);
    repository.write("tracked.txt", b"unstaged\nretained\nextra\n");
    fs::remove_file(repository.0.join("deleted.txt")).unwrap();
    repository.write(":(glob)*.txt", b"new\nno-final-newline");
    repository.write("binary.dat", b"binary\0data");
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    let summary = working_tree_change_summary(&repository.0).unwrap();
    assert_eq!((summary.additions, summary.deletions), (4, 3));
    assert_eq!(summary.uncounted_files, 1);
    assert!(!summary.partial);
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
}

#[test]
fn unstaged_summary_excludes_staged_only_changes_and_handles_unborn_repositories() {
    let repository = Repository::new();
    repository.write("staged.txt", b"staged\n");
    repository.git(&["add", "staged.txt"]);
    let summary = working_tree_change_summary(&repository.0).unwrap();
    assert_eq!((summary.additions, summary.deletions, summary.uncounted_files), (0, 0, 0));
    repository.write("staged.txt", b"staged\nworking\n");
    assert_eq!(working_tree_change_summary(&repository.0).unwrap().additions, 1);
}

#[test]
fn unstaged_summary_counts_only_edits_in_an_intent_to_add_rename() {
    let repository = Repository::new();
    repository.write("before.txt", b"alpha\nbeta\ngamma\ndelta\n");
    repository.commit("Base");
    fs::rename(repository.0.join("before.txt"), repository.0.join("after.txt")).unwrap();
    repository.git(&["add", "-N", "--", "after.txt"]);
    let index = fs::read(repository.0.join(".git/index")).unwrap();

    let pure = working_tree_summaries(&repository.0).unwrap();
    let staged = pure.staged.unwrap();
    let unstaged = pure.unstaged.unwrap();
    assert_eq!((staged.additions, staged.deletions), (0, 0));
    assert_eq!((unstaged.additions, unstaged.deletions, unstaged.partial), (0, 0, false));

    repository.write("after.txt", b"alpha\nbeta\ngamma\nchanged\n");
    // Neither local status nor local diff configuration may split the same
    // rename differently when the recap matches their records.
    repository.git(&["config", "status.renames", "false"]);
    repository.git(&["config", "diff.renames", "false"]);
    let edited = working_tree_change_summary(&repository.0).unwrap();
    assert_eq!((edited.additions, edited.deletions, edited.uncounted_files, edited.partial), (1, 1, 0, false));
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
}

#[cfg(unix)]
#[test]
fn reviewed_index_rename_moves_both_literal_paths_and_preserves_unrelated_edits() {
    let repository = Repository::new();
    let source = "old\t[*].txt";
    let destination = "new\n[*].txt";
    let contents = b"alpha\nbeta\ngamma\n";
    repository.write(source, contents);
    repository.write("staged.txt", b"before\n");
    repository.write("unstaged.txt", b"before\n");
    repository.commit("Base");
    repository.write("staged.txt", b"separate staged edit\n");
    repository.git(&["add", "--", "staged.txt"]);
    repository.write("unstaged.txt", b"separate unstaged edit\n");
    fs::rename(repository.0.join(source), repository.0.join(destination)).unwrap();
    repository.git(&["--literal-pathspecs", "add", "-N", "--", destination]);

    let status = || repository.git(&["--no-optional-locks", "status", "--porcelain=v1", "-z"]);
    let baseline = status();
    let index = || fs::read(repository.0.join(".git/index")).unwrap();
    let initial_index = index();
    let head = repository.git(&["rev-parse", "HEAD"]);
    assert!(baseline.starts_with(format!(" R {destination}\0{source}\0").as_bytes()));
    let shown = read_status(&repository.0).unwrap();
    let row = shown.entries.iter().find(|entry| entry.path == destination).unwrap();
    assert_eq!(row.previous_path.as_deref(), Some(source));

    let wrong = stage_worktree_rename(&repository.0, "unstaged.txt", destination).unwrap_err();
    assert_eq!(wrong.kind, "staleWorkingTreeRename");
    assert_eq!(index(), initial_index);
    repository.git(&["config", "core.sparseCheckout", "true"]);
    let sparse = stage_worktree_rename(&repository.0, source, destination).unwrap_err();
    assert_eq!(sparse.kind, "sparseRenameIndexUnsupported");
    assert_eq!(index(), initial_index);
    repository.git(&["config", "--unset", "core.sparseCheckout"]);
    stage_worktree_rename(&repository.0, source, destination).unwrap();
    let staged = status();
    assert!(staged.starts_with(format!("R  {destination}\0{source}\0").as_bytes()));
    assert!(staged.ends_with(b"M  staged.txt\0 M unstaged.txt\0"));

    let staged_index = index();
    let wrong_side = stage_worktree_rename(&repository.0, source, destination).unwrap_err();
    assert_eq!(wrong_side.kind, "staleWorkingTreeRename");
    assert_eq!(index(), staged_index);
    unstage_index_rename(&repository.0, source, destination).unwrap();
    // Reset removes the intent-to-add entry: only the index moved, so the
    // destination is now untracked rather than a grouped worktree rename.
    let unstaged = status();
    assert!(unstaged.starts_with(format!(" D {source}\0").as_bytes()));
    assert!(unstaged.ends_with(format!("M  staged.txt\0 M unstaged.txt\0?? {destination}\0").as_bytes()));
    assert_eq!(repository.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repository.git(&["show", ":staged.txt"]), b"separate staged edit\n");
    assert_eq!(fs::read(repository.0.join(destination)).unwrap(), contents);
    assert_eq!(fs::read(repository.0.join("unstaged.txt")).unwrap(), b"separate unstaged edit\n");
}

#[test]
fn unstaged_summary_discloses_bounded_untracked_files_without_reading_them() {
    let repository = Repository::new();
    let file = fs::File::create(repository.0.join("large.txt")).unwrap();
    file.set_len(17 * 1024 * 1024).unwrap();
    let summary = working_tree_change_summary(&repository.0).unwrap();
    assert_eq!(summary.additions, 0);
    assert_eq!(summary.uncounted_files, 1);
    assert!(summary.partial);
}

#[test]
fn reviewed_index_rename_refuses_directory_pathspec_expansion() {
    let repository = Repository::new();
    repository.write("from", b"renamed content\n");
    fs::create_dir(repository.0.join("to")).unwrap();
    repository.write("to/keep", b"independent content\n");
    repository.commit("Base");
    fs::remove_dir_all(repository.0.join("to")).unwrap();
    fs::rename(repository.0.join("from"), repository.0.join("to")).unwrap();
    fs::create_dir(repository.0.join("from")).unwrap();
    repository.write("from/keep", b"new untracked content\n");
    repository.git(&["add", "-N", "--", "to"]);
    let index = || fs::read(repository.0.join(".git/index")).unwrap();
    let status = || repository.git(&["--no-optional-locks", "status", "--porcelain=v1", "-z"]);
    assert!(status().windows(b" R to\0from\0".len()).any(|part| part == b" R to\0from\0"));
    let before = index();
    assert_eq!(stage_worktree_rename(&repository.0, "from", "to").unwrap_err().kind, "staleWorkingTreeRename");
    assert_eq!(index(), before);

    fs::remove_dir_all(repository.0.join("from")).unwrap();
    repository.git(&["add", "--", "from", "to"]);
    assert!(status().starts_with(b"R  to\0from\0D  to/keep\0"));
    let before = index();
    assert_eq!(unstage_index_rename(&repository.0, "from", "to").unwrap_err().kind, "staleWorkingTreeRename");
    assert_eq!(index(), before);
}

#[test]
fn reviewed_working_tree_rename_diff_shows_only_actual_edits_on_either_side() {
    let repository = Repository::new();
    let source = "old\t\n[*].txt";
    let destination = "new[*].txt";
    let base = b"retained alpha\nretained beta\nretained gamma\nold\n";
    let changed = b"retained alpha\nretained beta\nretained gamma\nnew\n";
    repository.write(source, base);
    repository.commit("Base");
    fs::rename(repository.0.join(source), repository.0.join(destination)).unwrap();
    repository.git(&["--literal-pathspecs", "add", "-N", "--", destination]);
    let index = || fs::read(repository.0.join(".git/index")).unwrap();
    let pure_index = index();
    let pure = working_tree_rename_diff(&repository.0, source, destination, false).unwrap();
    assert!(pure.patch.contains("\nsimilarity index 100%\n"));
    assert!(!pure.patch.contains("\n@@"));
    assert_eq!(index(), pure_index);
    repository.write(destination, changed);
    for staged in [false, true] {
        if staged {
            stage_worktree_rename(&repository.0, source, destination).unwrap();
        }
        let before = index();
        let patch = working_tree_rename_diff(&repository.0, source, destination, staged).unwrap();
        assert_eq!(patch.previous_path.as_deref(), Some(source));
        assert_eq!(patch.path, destination);
        assert!(!patch.truncated);
        assert!(patch.patch.contains("\nrename from "));
        assert!(patch.patch.contains("\nrename to "));
        assert!(patch.patch.contains("\n-old\n+new\n"));
        assert!(!patch.patch.contains("\n+retained"));
        assert!(!patch.patch.contains("\n-retained"));
        assert_eq!(working_tree_rename_diff(&repository.0, source, destination, !staged).unwrap_err().kind,
            "staleWorkingTreeRename");
        assert_eq!(working_tree_rename_diff(&repository.0, "wrong", destination, staged).unwrap_err().kind,
            "staleWorkingTreeRename");
        assert_eq!(apply_working_tree_hunk_with_preview(&repository.0, destination, staged, 0,
            if staged { "unstage" } else { "stage" }, Some(&patch.patch)).unwrap_err().kind, "wholeRenameRequired");
        assert_eq!(index(), before);
        assert_eq!(fs::read(repository.0.join(destination)).unwrap(), changed);
    }
    repository.write(destination, b"retained alpha\nretained beta\nretained gamma\nlater\n");
    let unstaged_edit = working_tree_file_diff(&repository.0, destination, false).unwrap();
    assert!(unstaged_edit.previous_path.is_none());
    assert!(unstaged_edit.patch.contains("\n-new\n+later\n"));
}

#[cfg(unix)]
#[test]
fn unstaged_summary_counts_symlink_blob_without_opening_its_target() {
    let repository = Repository::new();
    std::os::unix::fs::symlink("/outside/never-open-this-target", repository.0.join("link")).unwrap();
    let summary = working_tree_change_summary(&repository.0).unwrap();
    assert_eq!((summary.additions, summary.deletions), (1, 0));
    assert!(!summary.partial);
}

#[cfg(unix)]
#[test]
fn unstaged_summary_never_fetches_a_promised_missing_index_blob() {
    use std::os::unix::fs::PermissionsExt;
    const CHILD: &str = "GIT_KHRONOS_SUMMARY_PROTOCOL_FIXTURE";
    if let Some(path) = std::env::var_os(CHILD) {
        let path = PathBuf::from(path);
        assert!(working_tree_change_summary(&path).is_err());
        assert!(!path.join(".git/unexpected-fetch").exists());
        return;
    }
    let repository = Repository::new();
    repository.write("tracked.txt", b"old\n");
    repository.commit("Base");
    let oid = String::from_utf8(repository.git(&["rev-parse", "HEAD:tracked.txt"])).unwrap().trim().to_owned();
    repository.write("tracked.txt", b"working\n");
    let remote = repository.0.join(".git/owned-promisor.git");
    repository.git(&["init", "--bare", remote.to_str().unwrap()]);
    let marker = repository.0.join(".git/unexpected-fetch");
    let helper = repository.0.join(".git/owned-upload-pack");
    fs::write(&helper, format!("#!/bin/sh\nprintf attempted > '{}'\nexit 1\n", marker.display())).unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
    for (key, value) in [
        ("extensions.partialClone", "owned"), ("remote.owned.promisor", "true"),
        ("remote.owned.url", remote.to_str().unwrap()), ("remote.owned.uploadpack", helper.to_str().unwrap()),
        ("protocol.file.allow", "always"),
    ] { repository.git(&["config", key, value]); }
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    let config = fs::read(repository.0.join(".git/config")).unwrap();
    let object = repository.0.join(".git/objects").join(&oid[..2]).join(&oid[2..]);
    fs::remove_file(&object).unwrap();
    assert!(working_tree_change_summary(&repository.0).is_err());
    assert!(!marker.exists(), "Optional unstaged totals attempted an implicit fetch");
    assert!(!object.exists());
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(repository.0.join(".git/config")).unwrap(), config);
    // The normal recap stays read-only even with inherited file transport.
    let inherited = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "literal_file_tests::unstaged_summary_never_fetches_a_promised_missing_index_blob", "--nocapture"])
        .env(CHILD, &repository.0)
        .env("GIT_ALLOW_PROTOCOL", "file")
        .output()
        .unwrap();
    assert!(
        inherited.status.success(),
        "Inherited protocol permission escaped the recap read scope:\n{}\n{}",
        String::from_utf8_lossy(&inherited.stdout),
        String::from_utf8_lossy(&inherited.stderr)
    );
    assert!(!marker.exists());
    assert!(!object.exists());
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(repository.0.join(".git/config")).unwrap(), config);
    let control = git_in(&repository.0).args(["cat-file", "-t", &oid]).env_remove("GIT_NO_LAZY_FETCH").output().unwrap();
    assert!(!control.status.success());
    assert_eq!(fs::read(marker).unwrap(), b"attempted");
}

#[test]
fn unstaged_summary_does_not_rewrite_custom_protocol_configuration() {
    let repository = Repository::new();
    repository.git(&["config", "protocol.owned.allow", "always"]);
    repository.git(&["config", "protocol.file.allow", "always"]);
    repository.write("new.txt", b"local\n");
    assert_eq!(working_tree_change_summary(&repository.0).unwrap().additions, 1);
    for key in ["protocol.owned.allow", "protocol.file.allow"] {
        assert_eq!(repository.git(&["config", "--get", key]), b"always\n");
    }
    assert!(!git_in(&repository.0).args(["config", "--get", "protocol.allow"]).output().unwrap().status.success());
}

#[test]
fn staged_summary_counts_head_relative_lines_and_pure_renames_independently() {
    let repository = Repository::new();
    repository.write("tracked.txt", b"old\nretained\n");
    repository.write("before.txt", b"unique contents\nother line\n");
    repository.commit("Base");
    repository.write("tracked.txt", b"staged\nretained\n");
    repository.git(&["mv", "before.txt", "after.txt"]);
    repository.write("binary.dat", b"owned\0binary");
    repository.git(&["add", "--", "tracked.txt", "binary.dat"]);
    repository.write("tracked.txt", b"staged\nretained\nunstaged\n");
    let index = fs::read(repository.0.join(".git/index")).unwrap();
    let recaps = working_tree_summaries(&repository.0).unwrap();
    let staged = recaps.staged.unwrap();
    let unstaged = recaps.unstaged.unwrap();
    assert_eq!((staged.additions, staged.deletions, staged.uncounted_files, staged.partial), (1, 1, 1, false));
    assert_eq!((unstaged.additions, unstaged.deletions, unstaged.uncounted_files), (1, 0, 0));
    assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
}

#[test]
fn staged_summary_counts_inaugural_commit_but_not_intent_to_add() {
    let repository = Repository::new();
    repository.write("staged.txt", b"first\nsecond");
    repository.write("intent.txt", b"not yet staged\n");
    repository.git(&["add", "--", "staged.txt"]);
    repository.git(&["add", "-N", "--", "intent.txt"]);
    let recaps = working_tree_summaries(&repository.0).unwrap();
    let staged = recaps.staged.unwrap();
    let unstaged = recaps.unstaged.unwrap();
    assert_eq!((staged.additions, staged.deletions, staged.uncounted_files, staged.partial), (2, 0, 0, false));
    assert_eq!((unstaged.additions, unstaged.deletions), (1, 0));
}

#[test]
fn staged_summary_ignores_unmerged_entries_while_counting_other_index_changes() {
    let repository = Repository::new();
    repository.write("conflict.txt", b"base\n");
    repository.commit("Base");
    let main = String::from_utf8(repository.git(&["branch", "--show-current"])).unwrap();
    repository.git(&["switch", "-c", "side"]);
    repository.write("conflict.txt", b"other\n");
    repository.commit("Side");
    repository.git(&["switch", main.trim()]);
    repository.write("conflict.txt", b"ours\n");
    repository.commit("Main");
    assert!(!git_in(&repository.0).args(["merge", "--no-edit", "side"]).output().unwrap().status.success());
    repository.write("independent.txt", b"added\n");
    repository.git(&["add", "--", "independent.txt"]);
    repository.write("independent.txt", b"added\nworking\n");
    let recaps = working_tree_summaries(&repository.0).unwrap();
    let staged = recaps.staged.unwrap();
    let unstaged = recaps.unstaged.unwrap();
    assert_eq!((staged.additions, staged.deletions, staged.uncounted_files, staged.partial), (1, 0, 0, false));
    assert_eq!((unstaged.additions, unstaged.deletions), (1, 0));
}

#[test]
fn staged_summary_discloses_its_bound_without_erasing_the_unstaged_side() {
    let repository = Repository::new();
    for index in 0..2001 {
        repository.write(&format!("file-{index:04}.txt"), b"staged\n");
    }
    repository.git(&["add", "--all"]);
    let recaps = working_tree_summaries(&repository.0).unwrap();
    let staged = recaps.staged.unwrap();
    let unstaged = recaps.unstaged.unwrap();
    assert_eq!((staged.additions, staged.deletions, staged.partial), (2000, 0, true));
    assert_eq!((unstaged.additions, unstaged.deletions, unstaged.partial), (0, 0, false));
}

#[cfg(unix)]
#[test]
fn working_tree_recaps_reap_stalled_git_without_misreporting_counts() {
    use std::os::unix::fs::PermissionsExt;

    const MODE: &str = "GIT_KHRONOS_RECAP_FIXTURE_MODE";
    const MARKER: &str = "GIT_KHRONOS_RECAP_FIXTURE_MARKER";
    const REAL: &str = "GIT_KHRONOS_RECAP_FIXTURE_REAL_GIT";
    if let Ok(mode) = std::env::var(MODE) {
        let marker = PathBuf::from(std::env::var_os(MARKER).unwrap());
        let repository = Repository::new();
        repository.write("tracked.txt", b"baseline\n");
        if mode == "untracked_grew" {
            repository.write(".gitattributes", b"new.txt diff\n");
        }
        repository.commit("Base");
        repository.write("tracked.txt", b"staged\n");
        repository.git(&["add", "tracked.txt"]);
        if matches!(mode.as_str(), "untracked" | "untracked_grew") {
            repository.write("new.txt", b"one\ntwo");
        } else {
            repository.write("tracked.txt", b"unstaged\n");
        }

        let started = std::time::Instant::now();
        let result = working_tree_summaries(&repository.0);
        match mode.as_str() {
            "status" => assert_eq!(result.unwrap_err().kind, "workingTreeSummaryTimedOut"),
            "limit" => assert_eq!(result.unwrap_err().kind, "workingTreeSummaryStatusLimit"),
            "unstaged" => {
                let recaps = result.unwrap();
                let staged = recaps.staged.unwrap();
                assert_eq!((staged.additions, staged.deletions, staged.partial), (1, 1, false));
                assert!(recaps.unstaged.is_none());
            }
            "untracked" => {
                assert!(!marker.exists(), "untracked-only recap ran tracked-file diff");
                let recaps = result.unwrap();
                let staged = recaps.staged.unwrap();
                let unstaged = recaps.unstaged.unwrap();
                assert_eq!((staged.additions, staged.deletions), (1, 1));
                assert_eq!((unstaged.additions, unstaged.deletions, unstaged.partial), (2, 0, false));
                return;
            }
            "untracked_grew" => {
                assert!(marker.exists(), "fixture must grow after Git status");
                let recaps = result.unwrap();
                let unstaged = recaps.unstaged.unwrap();
                assert_eq!(
                    (unstaged.additions, unstaged.deletions, unstaged.uncounted_files, unstaged.partial),
                    (0, 0, 1, true),
                );
                return;
            }
            _ => panic!("unexpected fixture mode"),
        }
        assert!(started.elapsed() < Duration::from_secs(7));
        let pid = fs::read_to_string(marker).expect("fixture Git must start");
        assert!(pid.trim().parse::<u32>().is_ok());
        #[cfg(target_os = "linux")]
        assert!(!Path::new("/proc").join(pid.trim()).exists());
        return;
    }

    let fixture = Repository::new();
    let marker = fixture.0.join("pid");
    let helper = fixture.0.join("git");
    fs::write(&helper, r#"#!/bin/sh
case "$GIT_KHRONOS_RECAP_FIXTURE_MODE:$3:$5" in
  status:-c:status)
    printf '%s\n' "$$" >"$GIT_KHRONOS_RECAP_FIXTURE_MARKER"
    printf ' M tracked.txt\000'
    exec sleep 10 ;;
  limit:-c:status)
    printf '%s\n' "$$" >"$GIT_KHRONOS_RECAP_FIXTURE_MARKER"
    exec dd if=/dev/zero bs=1048576 count=5 ;;
esac
case "$GIT_KHRONOS_RECAP_FIXTURE_MODE:$3:$4" in
  untracked_grew:config:--type=int)
    dd if=/dev/null of="$2/new.txt" bs=1048576 seek=17 count=0 2>/dev/null || exit
    printf '%s\n' "$$" >"$GIT_KHRONOS_RECAP_FIXTURE_MARKER" ;;
  untracked:diff:--numstat)
    printf '%s\n' "$$" >"$GIT_KHRONOS_RECAP_FIXTURE_MARKER"
    exit 1 ;;
  unstaged:diff:--numstat)
    printf '%s\n' "$$" >"$GIT_KHRONOS_RECAP_FIXTURE_MARKER"
    printf '99\t99\ttracked.txt\000'
    exec sleep 10 ;;
esac
exec "$GIT_KHRONOS_RECAP_FIXTURE_REAL_GIT" "$@"
"#).unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH").unwrap_or_default();
    let real_git = std::env::split_paths(&original_path)
        .map(|entry| entry.join("git"))
        .find(|candidate| candidate.is_absolute() && candidate.is_file())
        .expect("Git must be available on PATH");
    let path = std::env::join_paths(
        std::iter::once(fixture.0.clone()).chain(std::env::split_paths(&original_path)),
    ).unwrap();
    for mode in ["untracked_grew", "untracked", "status", "unstaged", "limit"] {
        let result = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "literal_file_tests::working_tree_recaps_reap_stalled_git_without_misreporting_counts", "--nocapture"])
            .env("PATH", &path)
            .env(MODE, mode)
            .env(MARKER, &marker)
            .env(REAL, &real_git)
            .output().unwrap();
        assert!(
            result.status.success(), "{mode}:\n{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr),
        );
        if mode != "untracked" {
            fs::remove_file(&marker).unwrap();
        }
    }
}

#[cfg(unix)]
#[test]
fn staged_summary_fails_locally_when_head_blob_is_missing_but_unstaged_still_counts() {
    let repository = Repository::new();
    repository.write("tracked.txt", b"head\n");
    repository.commit("Base");
    let oid = String::from_utf8(repository.git(&["rev-parse", "HEAD:tracked.txt"])).unwrap();
    let oid = oid.trim();
    repository.write("tracked.txt", b"staged replacement\n");
    repository.git(&["add", "--", "tracked.txt"]);
    repository.write("untracked.txt", b"separate working file\n");
    fs::remove_file(repository.0.join(".git/objects").join(&oid[..2]).join(&oid[2..])).unwrap();
    let recaps = working_tree_summaries(&repository.0).unwrap();
    assert!(recaps.staged.is_none());
    assert_eq!(recaps.unstaged.unwrap().additions, 1);
}
