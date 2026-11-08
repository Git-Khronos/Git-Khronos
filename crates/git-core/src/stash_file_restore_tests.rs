use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

struct Repository {
    directory: PathBuf,
    path: PathBuf,
}

impl Repository {
    fn new() -> Self {
        Self::with_format("sha1")
    }

    fn with_format(format: &str) -> Self {
        let directory = std::env::temp_dir().join(format!(
            "git-khronos-stash-file-test-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let path = directory.join("repo");
        fs::create_dir_all(&path).unwrap();
        let repository = Self { directory, path };
        for args in [
            vec!["init", "-b", "main", "--object-format", format],
            vec!["config", "user.name", "Stash File Tester"],
            vec!["config", "user.email", "stash-file@example.test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            repository.git(&args);
        }
        repository
    }

    fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = run_git(&self.path, args).unwrap();
        ensure_success("run the stash file fixture", &output).unwrap();
        output.stdout
    }

    fn write(&self, name: &str, content: &[u8]) {
        let destination = self.path.join(name);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(destination, content).unwrap();
    }

    fn read(&self, name: &str) -> Vec<u8> {
        fs::read(self.path.join(name)).unwrap()
    }

    fn commit(&self) {
        self.git(&["add", "--all"]);
        self.git(&["commit", "-m", "Base"]);
    }

    fn stash(&self) -> String {
        self.git(&["stash", "push", "--include-untracked", "-m", "Saved work"]);
        String::from_utf8(self.git(&["rev-parse", "--verify", "stash@{0}"]))
            .unwrap()
            .trim()
            .to_owned()
    }

    fn apply(&self, oid: &str, file: &str, previous: Option<&str>) -> Result<(), AppError> {
        apply_stashed_file(&self.path, "stash@{0}", oid, file, previous)
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn stash_file_restore_combines_saved_changes_without_replacing_current_work_or_index() {
    let repo = Repository::new();
    let baseline = (0..20)
        .map(|number| format!("line {number}\n"))
        .collect::<String>();
    repo.write("selected.txt", baseline.as_bytes());
    repo.write("other.txt", b"other base\n");
    repo.commit();
    let staged = baseline.replace("line 2\n", "staged change\n");
    repo.write("selected.txt", staged.as_bytes());
    repo.git(&["add", "--", "selected.txt"]);
    let saved = staged.replace("line 3\n", "unstaged change\n");
    repo.write("selected.txt", saved.as_bytes());
    repo.write("other.txt", b"other saved\n");
    let oid = repo.stash();

    let current = baseline.replace("line 17\n", "independent current work\n");
    repo.write("selected.txt", current.as_bytes());
    repo.write("other.txt", b"other current\n");
    repo.git(&["add", "--", "other.txt"]);
    repo.write("untracked.txt", b"keep untracked\n");
    let index = repo.git(&["ls-files", "--stage", "-z"]);

    repo.apply(&oid, "selected.txt", None).unwrap();

    assert_eq!(
        repo.read("selected.txt"),
        saved
            .replace("line 17\n", "independent current work\n")
            .as_bytes()
    );
    assert_eq!(repo.read("other.txt"), b"other current\n");
    assert_eq!(repo.read("untracked.txt"), b"keep untracked\n");
    assert_eq!(repo.git(&["ls-files", "--stage", "-z"]), index);
    assert_eq!(
        repo.git(&["rev-parse", "stash@{0}"]),
        format!("{oid}\n").as_bytes()
    );
}

#[cfg(unix)]
#[test]
fn stash_file_restore_treats_pattern_and_whitespace_names_as_literal() {
    for selected in [
        "*.txt",
        "[ab].txt",
        ":(glob)*.txt",
        "--selected.txt",
        "selected file.txt",
        "line\nname.txt",
    ] {
        let repo = Repository::new();
        repo.write(selected, b"selected base\n");
        repo.write("other.txt", b"other base\n");
        repo.commit();
        repo.write(selected, b"selected saved\n");
        repo.write("other.txt", b"other saved\n");
        let oid = repo.stash();
        repo.apply(&oid, selected, None).unwrap();
        assert_eq!(repo.read(selected), b"selected saved\n", "{selected:?}");
        assert_eq!(repo.read("other.txt"), b"other base\n", "{selected:?}");
    }
}

#[test]
fn stash_file_restore_keeps_untracked_binary_and_refuses_existing_destination() {
    let repo = Repository::new();
    repo.write("tracked", b"base\n");
    repo.commit();
    let bytes = b"\0\xff\0saved binary\n";
    repo.write("new.bin", bytes);
    repo.write("other.bin", b"other saved");
    let oid = repo.stash();
    repo.write("new.bin", b"existing work");
    let index = repo.git(&["ls-files", "--stage", "-z"]);

    assert!(repo.apply(&oid, "new.bin", None).is_err());
    assert_eq!(repo.read("new.bin"), b"existing work");
    assert_eq!(repo.git(&["ls-files", "--stage", "-z"]), index);
    fs::remove_file(repo.path.join("new.bin")).unwrap();
    repo.apply(&oid, "new.bin", None).unwrap();
    assert_eq!(repo.read("new.bin"), bytes);
    assert!(!repo.path.join("other.bin").exists());
    assert_eq!(repo.git(&["ls-files", "--stage", "-z"]), index);
    assert_eq!(
        repo.git(&["rev-parse", "stash@{0}"]),
        format!("{oid}\n").as_bytes()
    );
}

#[test]
fn stash_file_restore_applies_both_sides_of_a_rename_or_neither() {
    let repo = Repository::new();
    repo.write("old.txt", b"rename contents\n");
    repo.commit();
    repo.git(&["mv", "old.txt", "new.txt"]);
    let oid = repo.stash();
    let details = stash_details_at_oid(&repo.path, &oid).unwrap();
    let file = details
        .files
        .iter()
        .find(|file| file.path == "new.txt")
        .unwrap();
    assert_eq!(file.previous_path.as_deref(), Some("old.txt"));
    let index = repo.git(&["ls-files", "--stage", "-z"]);
    repo.write("new.txt", b"obstruction");
    assert!(repo.apply(&oid, "new.txt", Some("old.txt")).is_err());
    assert_eq!(repo.read("old.txt"), b"rename contents\n");
    assert_eq!(repo.read("new.txt"), b"obstruction");
    fs::remove_file(repo.path.join("new.txt")).unwrap();

    repo.apply(&oid, "new.txt", Some("old.txt")).unwrap();
    assert!(!repo.path.join("old.txt").exists());
    assert_eq!(repo.read("new.txt"), b"rename contents\n");
    assert_eq!(repo.git(&["ls-files", "--stage", "-z"]), index);
}

#[test]
fn stash_file_restore_rejects_stale_stashes_wrong_names_and_overlapping_edits() {
    let repo = Repository::new();
    repo.write("file.txt", b"base\n");
    repo.write("other.txt", b"other\n");
    repo.commit();
    repo.write("file.txt", b"saved\n");
    let oid = repo.stash();
    assert!(repo.apply(&oid, "file.txt", Some("other.txt")).is_err());
    repo.write("file.txt", b"local work\n");
    let index = repo.git(&["ls-files", "--stage", "-z"]);
    assert!(repo.apply(&oid, "file.txt", None).is_err());
    assert_eq!(repo.read("file.txt"), b"local work\n");
    assert_eq!(repo.git(&["ls-files", "--stage", "-z"]), index);
    let newer = repo.stash();
    assert_ne!(oid, newer);
    assert!(repo.apply(&oid, "file.txt", None).is_err());
    assert_eq!(repo.read("file.txt"), b"base\n");
    assert_eq!(repo.git(&["ls-files", "--stage", "-z"]), index);
}

#[cfg(unix)]
#[test]
fn stash_file_restore_handles_leaf_symlinks_but_refuses_symlink_ancestors() {
    use std::os::unix::fs::symlink;
    let repo = Repository::new();
    let outside = repo.directory.join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("file.txt"), b"outside unchanged\n").unwrap();
    repo.write("dir/file.txt", b"tracked base\n");
    symlink("old-target", repo.path.join("link")).unwrap();
    repo.commit();
    repo.write("dir/file.txt", b"tracked saved\n");
    fs::remove_file(repo.path.join("link")).unwrap();
    symlink("new-target", repo.path.join("link")).unwrap();
    let oid = repo.stash();
    repo.apply(&oid, "link", None).unwrap();
    assert_eq!(
        fs::read_link(repo.path.join("link")).unwrap(),
        Path::new("new-target")
    );
    fs::remove_file(repo.path.join("dir/file.txt")).unwrap();
    fs::remove_dir(repo.path.join("dir")).unwrap();
    symlink(&outside, repo.path.join("dir")).unwrap();
    assert!(repo.apply(&oid, "dir/file.txt", None).is_err());
    assert_eq!(
        fs::read(outside.join("file.txt")).unwrap(),
        b"outside unchanged\n"
    );
}

#[test]
fn stash_file_restore_preserves_crlf_worktree_content_for_tracked_and_new_files() {
    let repo = Repository::new();
    repo.write(".gitattributes", b"*.txt text eol=crlf\n");
    repo.write("tracked.txt", b"base\r\n");
    repo.commit();
    repo.write("tracked.txt", b"saved\r\n");
    repo.write("new.txt", b"new saved\r\n");
    let oid = repo.stash();
    repo.apply(&oid, "tracked.txt", None).unwrap();
    repo.apply(&oid, "new.txt", None).unwrap();
    assert_eq!(repo.read("tracked.txt"), b"saved\r\n");
    assert_eq!(repo.read("new.txt"), b"new saved\r\n");
}

#[cfg(unix)]
#[test]
fn stash_file_restore_respects_configured_clean_and_smudge_filters() {
    let repo = Repository::new();
    repo.git(&["config", "filter.fixture.clean", "sed s/WORKTREE/INDEX/g"]);
    repo.git(&["config", "filter.fixture.smudge", "sed s/INDEX/WORKTREE/g"]);
    repo.write(".gitattributes", b"*.txt filter=fixture\n");
    repo.write("tracked.txt", b"WORKTREE base\n");
    repo.commit();
    repo.write("tracked.txt", b"WORKTREE saved\n");
    repo.write("new.txt", b"WORKTREE new\n");
    let oid = repo.stash();
    repo.apply(&oid, "tracked.txt", None).unwrap();
    repo.apply(&oid, "new.txt", None).unwrap();
    assert_eq!(repo.read("tracked.txt"), b"WORKTREE saved\n");
    assert_eq!(repo.read("new.txt"), b"WORKTREE new\n");
}

#[test]
fn stash_file_restore_rejects_sparse_entries_and_nested_repositories() {
    let repo = Repository::new();
    repo.write("dir/file.txt", b"base\n");
    repo.commit();
    repo.write("dir/file.txt", b"saved\n");
    let oid = repo.stash();
    repo.git(&["update-index", "--skip-worktree", "dir/file.txt"]);
    assert!(repo.apply(&oid, "dir/file.txt", None).is_err());
    assert_eq!(repo.read("dir/file.txt"), b"base\n");
    repo.git(&["update-index", "--no-skip-worktree", "dir/file.txt"]);
    fs::create_dir(repo.path.join("dir/.git")).unwrap();
    assert!(repo.apply(&oid, "dir/file.txt", None).is_err());
    assert_eq!(repo.read("dir/file.txt"), b"base\n");
}

#[test]
fn stash_file_restore_supports_sha256_repositories() {
    let repo = Repository::with_format("sha256");
    repo.write("tracked.txt", b"base\n");
    repo.commit();
    repo.write("new.txt", b"saved\n");
    let oid = repo.stash();
    assert_eq!(oid.len(), 64);
    repo.apply(&oid, "new.txt", None).unwrap();
    assert_eq!(repo.read("new.txt"), b"saved\n");
}

#[test]
fn stash_file_restore_streams_large_binary_patches_without_preview_limits() {
    let repo = Repository::new();
    repo.write("tracked", b"base\n");
    repo.commit();
    let mut state = 0x1234_5678_u32;
    let bytes = (0..5 * 1024 * 1024)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        })
        .collect::<Vec<_>>();
    repo.write("large.bin", &bytes);
    let oid = repo.stash();
    repo.apply(&oid, "large.bin", None).unwrap();
    assert_eq!(repo.read("large.bin"), bytes);
}
