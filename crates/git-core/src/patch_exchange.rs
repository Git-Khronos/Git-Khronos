use super::*;
use std::fs::OpenOptions;

const MAX_PATCH_BYTES: usize = 4 * 1024 * 1024;
const MAX_PATCH_FILES: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchTarget {
    Worktree,
    Index,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchRequest {
    pub file: String,
    pub target: PatchTarget,
    pub patch: Vec<u8>,
    pub head_oid: String,
    pub head_ref: String,
    pub index_state: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFile {
    pub path: String,
    pub added: Option<usize>,
    pub deleted: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchReview {
    pub request: PatchRequest,
    pub files: Vec<PatchFile>,
    pub summary: String,
}

fn failure(message: impl Into<String>) -> AppError {
    AppError::new(
        "patchExchangeRefused",
        message,
        Some("Preserve local files, correct the patch or repository state, and prepare a fresh review."),
    )
}

fn io_error(error: std::io::Error) -> AppError {
    failure(format!("Patch file access failed: {error}"))
}

fn read_patch(file: &Path) -> Result<Vec<u8>, AppError> {
    if !fs::symlink_metadata(file).map_err(io_error)?.is_file() {
        return Err(failure(
            "Choose a regular patch file, not a symlink or special device.",
        ));
    }
    let input = fs::File::open(file).map_err(io_error)?;
    if !input.metadata().map_err(io_error)?.is_file() {
        return Err(failure("Choose a regular patch file."));
    }
    let mut bytes = Vec::new();
    input
        .take((MAX_PATCH_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.is_empty() || bytes.len() > MAX_PATCH_BYTES {
        return Err(failure(
            "A complete patch must contain 1 byte to 4 MiB; partial imports are not offered.",
        ));
    }
    Ok(bytes)
}

fn safe_path(root: &Path, file: &str) -> Result<(), AppError> {
    if file.is_empty()
        || file.contains(['\0', '\\', ':'])
        || !Path::new(file)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        || file
            .split('/')
            .any(|part| part.is_empty() || part == "." || part.eq_ignore_ascii_case(".git"))
    {
        return Err(failure(format!(
            "Patch path is not a safe repository-relative file: {file:?}"
        )));
    }
    let mut candidate = root.to_path_buf();
    for part in Path::new(file).components() {
        candidate.push(part);
        if fs::symlink_metadata(&candidate).is_ok_and(|metadata| metadata.is_symlink())
            || candidate.join(".git").exists()
        {
            return Err(failure(format!(
                "Patch path crosses a symlink or nested repository: {file:?}"
            )));
        }
    }
    Ok(())
}

// Drain stdout/stderr while sending bounded input so large diagnostics cannot
// deadlock against a full stdin pipe.
fn apply_command(path: &Path, patch: &[u8], flags: &[&str]) -> Result<Output, AppError> {
    let mut child = crate::git_in(path)
        .args(["-c", "apply.ignoreWhitespace=false"])
        .args(["apply", "--whitespace=nowarn"])
        .args(flags)
        .arg("-")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(io_error)?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| failure("Git patch input was unavailable."))?;
    let bytes = patch.to_vec();
    let writer = thread::spawn(move || stdin.write_all(&bytes));
    let output = child.wait_with_output().map_err(io_error)?;
    let written = writer
        .join()
        .map_err(|_| failure("Git patch input worker failed."))?;
    ensure_success("inspect or apply the complete patch", &output)?;
    written.map_err(io_error)?;
    if output.stdout.len() > MAX_PATCH_BYTES || output.stderr.len() > MAX_PATCH_BYTES {
        return Err(failure(
            "Git patch report exceeds the complete review limit.",
        ));
    }
    Ok(output)
}

fn describe_patch(path: &Path, bytes: &[u8]) -> Result<(Vec<PatchFile>, String), AppError> {
    if bytes.split(|byte| *byte == b'\n').any(|line| {
        line.starts_with(b"rename from ")
            || line.starts_with(b"copy from ")
            || line == b"new file mode 120000"
            || line == b"deleted file mode 120000"
            || line == b"new file mode 160000"
            || line == b"deleted file mode 160000"
            || (line.starts_with(b"index ")
                && (line.ends_with(b" 120000") || line.ends_with(b" 160000")))
            || line == b"old mode 120000"
            || line == b"new mode 120000"
            || line == b"old mode 160000"
            || line == b"new mode 160000"
    }) {
        return Err(failure("Symlink, submodule, copy and extended-rename patches require local Git. Export renames as deletion/addition."));
    }
    let report = apply_command(path, bytes, &["--numstat", "-z"])?;
    if !report.stdout.ends_with(&[0]) {
        return Err(failure("Git did not return a complete patch path list."));
    }
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for record in report.stdout[..report.stdout.len() - 1].split(|byte| *byte == 0) {
        let fields = record.splitn(3, |byte| *byte == b'\t').collect::<Vec<_>>();
        if fields.len() != 3 {
            return Err(failure("Git returned an unsupported patch path record."));
        }
        let file = std::str::from_utf8(fields[2])
            .map_err(|_| failure("Non-UTF-8 patch paths require local Git."))?;
        safe_path(path, file)?;
        let count = |field: &[u8]| -> Result<Option<usize>, AppError> {
            if field == b"-" {
                return Ok(None);
            }
            Ok(Some(
                std::str::from_utf8(field)
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .ok_or_else(|| failure("Git returned an invalid patch count."))?,
            ))
        };
        if !seen.insert(file.to_owned()) || files.len() == MAX_PATCH_FILES {
            return Err(failure("Review requires 1-2000 distinct file paths; repeated-path patches require local Git."));
        }
        files.push(PatchFile {
            path: file.into(),
            added: count(fields[0])?,
            deleted: count(fields[1])?,
        });
    }
    if files.is_empty() {
        return Err(failure("The patch contains no file changes."));
    }
    let summary = apply_command(path, bytes, &["--summary"])?;
    let summary = String::from_utf8(summary.stdout)
        .map_err(|_| failure("Patch mode summary is not UTF-8."))?;
    Ok((files, summary))
}

fn patch_root(path: &Path) -> Result<PathBuf, AppError> {
    let output = run_git(path, &["rev-parse", "--show-toplevel"])?;
    ensure_success("identify the patch exchange working tree", &output)?;
    let root = std::str::from_utf8(&output.stdout)
        .map_err(|_| failure("Working-tree path is not UTF-8."))?;
    let root = root
        .strip_suffix('\n')
        .ok_or_else(|| failure("Working-tree path is incomplete."))?;
    let root = fs::canonicalize(root).map_err(io_error)?;
    if fs::canonicalize(path).map_err(io_error)? != root {
        return Err(failure(
            "Open the working-tree root before exchanging patches.",
        ));
    }
    Ok(root)
}

fn clean_state(path: &Path) -> Result<(String, String, Vec<u8>), AppError> {
    patch_root(path)?;
    let status = read_status(path)?;
    if status.entry_count != 0 || status.entries_truncated {
        return Err(failure("Patch import requires a completely clean index and working tree, including untracked files."));
    }

    if status.merge_in_progress
        || status.rebase_in_progress
        || status.history_operation.is_some()
        || status.bisect_in_progress
        || status.rebase_split.is_some()
    {
        return Err(failure(
            "Finish or abort the active Git operation before importing a patch.",
        ));
    }
    require_visible_replay_index(path)?;
    let (flags, truncated) =
        run_git_with_stdout_limit(path, &["ls-files", "-v", "-z"], MAX_PATCH_BYTES)?;
    ensure_success("inspect excluded paths before patch import", &flags)?;
    if truncated
        || flags
            .stdout
            .split(|byte| *byte == 0)
            .any(|record| record.starts_with(b"S "))
    {
        return Err(failure("Sparse or skip-worktree entries prevent complete patch import. Restore a full working tree first."));
    }
    require_no_git_sequence(path)?;
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("identify the patch import base", &head)?;
    let head =
        String::from_utf8(head.stdout).map_err(|_| failure("HEAD is not a complete commit ID."))?;
    let head = head.trim().to_owned();
    validate_commit_oid(&head)?;
    let reference = run_git(path, &["rev-parse", "--symbolic-full-name", "HEAD"])?;
    ensure_success("identify the patch import branch", &reference)?;
    let reference = String::from_utf8(reference.stdout)
        .map_err(|_| failure("Branch identity is not UTF-8."))?;
    let (index, truncated) =
        run_git_with_stdout_limit(path, &["ls-files", "--stage", "-z"], MAX_PATCH_BYTES)?;
    ensure_success("capture the complete patch import index", &index)?;
    if truncated {
        return Err(failure(
            "The complete index exceeds the 4 MiB review limit.",
        ));
    }
    Ok((head, reference, index.stdout))
}

fn target_flags(target: PatchTarget) -> Vec<&'static str> {
    match target {
        PatchTarget::Worktree => vec![],
        PatchTarget::Index => vec!["--cached"],
        PatchTarget::Both => vec!["--index"],
    }
}

pub fn review_patch(
    path: &Path,
    file: &Path,
    target: PatchTarget,
) -> Result<PatchReview, AppError> {
    let (head_oid, head_ref, index_state) = clean_state(path)?;
    let patch = read_patch(file)?;
    let (files, summary) = describe_patch(path, &patch)?;
    let mut flags = target_flags(target);
    flags.push("--check");
    apply_command(path, &patch, &flags)?;
    if clean_state(path)? != (head_oid.clone(), head_ref.clone(), index_state.clone()) {
        return Err(failure("Repository state changed during patch review."));
    }
    Ok(PatchReview {
        request: PatchRequest {
            file: file
                .to_str()
                .ok_or_else(|| failure("Patch file path is not UTF-8."))?
                .into(),
            target,
            patch,
            head_oid,
            head_ref,
            index_state,
        },
        files,
        summary,
    })
}

pub fn import_patch(path: &Path, request: &PatchRequest) -> Result<(), AppError> {
    if request.patch.len() > MAX_PATCH_BYTES || request.index_state.len() > MAX_PATCH_BYTES {
        return Err(failure(
            "The captured patch or index exceeds the complete review limit.",
        ));
    }
    let review = review_patch(path, Path::new(&request.file), request.target)?;
    if review.request.patch != request.patch
        || review.request.head_oid != request.head_oid
        || review.request.head_ref != request.head_ref
        || review.request.index_state != request.index_state
    {
        return Err(failure(
            "The patch file, HEAD, branch or index changed after review. No patch was applied.",
        ));
    }
    apply_command(path, &review.request.patch, &target_flags(request.target))?;
    Ok(())
}

pub fn export_patch(
    path: &Path,
    staged: bool,
    selected: &[String],
    destination: &Path,
) -> Result<usize, AppError> {
    let root = patch_root(path)?;
    let status = read_status(path)?;
    if status.conflicted != 0 || status.entries_truncated {
        return Err(failure(
            "Export requires a complete, nonconflicted working-tree status.",
        ));
    }
    if selected.len() > MAX_PATCH_FILES {
        return Err(failure("Select at most 2000 tracked paths."));
    }
    for file in selected {
        safe_path(path, file)?;
        if status
            .entries
            .iter()
            .any(|entry| entry.path == *file && matches!(entry.index_status.as_str(), "R" | "C"))
        {
            return Err(failure(
                "Export all tracked changes to include both sides of staged renames or copies.",
            ));
        }
    }
    let mut args = vec![
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--no-renames",
        "--unified=3",
        "--output-indicator-new=+",
        "--output-indicator-old=-",
        "--output-indicator-context= ",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--submodule=short",
        "--ignore-submodules=none",
    ];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    let paths = selected
        .iter()
        .map(|file| format!(":(literal){file}"))
        .collect::<Vec<_>>();
    args.extend(paths.iter().map(String::as_str));
    let (diff, truncated) = run_git_with_stdout_limit(path, &args, MAX_PATCH_BYTES)?;
    ensure_success("export the complete tracked diff", &diff)?;
    if truncated || diff.stdout.is_empty() {
        return Err(failure(
            "No complete nonempty patch within the 4 MiB limit is available for this selection.",
        ));
    }
    let (files, _) = describe_patch(path, &diff.stdout)?;
    if !selected.is_empty()
        && (selected.len() != files.len()
            || selected
                .iter()
                .any(|file| !files.iter().any(|entry| entry.path == *file)))
    {
        return Err(failure("Every selected file must have a complete tracked diff in the chosen scope; no partial selection was exported."));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| failure("Choose a patch destination with an existing directory."))?;
    let parent = fs::canonicalize(parent).map_err(io_error)?;
    let metadata = run_git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    ensure_success("locate patch export metadata boundaries", &metadata)?;
    let metadata = std::str::from_utf8(&metadata.stdout)
        .map_err(|_| failure("Git metadata path is not UTF-8."))?;
    let metadata = metadata
        .strip_suffix('\n')
        .ok_or_else(|| failure("Git metadata path is incomplete."))?;
    if parent.starts_with(&root)
        || parent.starts_with(fs::canonicalize(metadata).map_err(io_error)?)
    {
        return Err(failure(
            "Save exported patches outside the repository and its Git directory.",
        ));
    }
    let name = destination
        .file_name()
        .ok_or_else(|| failure("Choose a patch filename."))?;
    let destination = parent.join(name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(io_error)?;
    file.write_all(&diff.stdout).and_then(|_| file.sync_all()).map_err(|error| AppError::new(
        "patchExportIncomplete", format!("Patch export failed: {error}"),
        Some("The new destination may contain a partial patch. Remove only that file after reviewing it, then retry.")))?;
    Ok(diff.stdout.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        directory: PathBuf,
        repository: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let id = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let directory =
                std::env::temp_dir().join(format!("chronos-patch-{}-{id}", std::process::id()));
            let repository = directory.join("repository");
            fs::create_dir_all(&repository).unwrap();
            let fixture = Self {
                directory,
                repository,
            };
            for args in [
                vec!["init", "-b", "main"],
                vec!["config", "user.name", "Patch Author"],
                vec!["config", "user.email", "patch@example.test"],
                vec!["config", "commit.gpgsign", "false"],
            ] {
                fixture.git(&args);
            }
            fs::write(fixture.repository.join("text"), b"old\n").unwrap();
            fs::write(fixture.repository.join("binary"), [0, 1, 2, 3]).unwrap();
            fixture.git(&["add", "."]);
            fixture.git(&["commit", "-m", "Base"]);
            fixture
        }
        fn git(&self, args: &[&str]) {
            run_mutation(&self.repository, args, "prepare owned patch fixture").unwrap();
        }
        fn output(&self, args: &[&str]) -> Vec<u8> {
            let output = run_git(&self.repository, args).unwrap();
            ensure_success("inspect owned patch fixture", &output).unwrap();
            output.stdout
        }
        fn patch(&self, staged: bool) -> PathBuf {
            let file = self.directory.join("exchange.patch");
            export_patch(&self.repository, staged, &[], &file).unwrap();
            file
        }
        fn clean(&self) {
            self.git(&["restore", "--staged", "--worktree", "."]);
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.directory).unwrap();
        }
    }

    #[test]
    fn binary_and_text_round_trip_respects_all_three_explicit_targets_and_preserves_refs() {
        for target in [PatchTarget::Worktree, PatchTarget::Index, PatchTarget::Both] {
            let fixture = Fixture::new();
            let original = fixture.output(&["rev-parse", "HEAD"]);
            fixture.git(&["branch", "unrelated"]);
            fixture.git(&["tag", "keep"]);
            fs::write(fixture.repository.join("text"), b"new\n").unwrap();
            fs::write(fixture.repository.join("binary"), [0, 4, 5, 6, 255]).unwrap();
            let file = fixture.patch(false);
            let exported = fs::read(&file).unwrap();
            assert!(exported
                .windows(16)
                .any(|bytes| bytes == b"GIT binary patch"));
            fixture.clean();
            let review = review_patch(&fixture.repository, &file, target).unwrap();
            assert_eq!(review.files.len(), 2);
            assert!(review
                .files
                .iter()
                .any(|file| file.path == "binary" && file.added.is_none()));
            assert_eq!(fixture.output(&["status", "--porcelain"]), b"");
            import_patch(&fixture.repository, &review.request).unwrap();
            let staged = fixture.output(&["show", ":text"]);
            let working = fs::read(fixture.repository.join("text")).unwrap();
            assert_eq!(
                staged,
                if target == PatchTarget::Worktree {
                    b"old\n"
                } else {
                    b"new\n"
                }
            );
            assert_eq!(
                working,
                if target == PatchTarget::Index {
                    b"old\n"
                } else {
                    b"new\n"
                }
            );
            assert_eq!(
                fs::read(fixture.repository.join("binary")).unwrap(),
                if target == PatchTarget::Index {
                    vec![0, 1, 2, 3]
                } else {
                    vec![0, 4, 5, 6, 255]
                }
            );
            for reference in ["HEAD", "unrelated", "keep"] {
                assert_eq!(fixture.output(&["rev-parse", reference]), original);
            }
        }
    }

    #[test]
    fn staged_selection_exports_only_captured_index_bytes_with_literal_paths_and_no_overwrite() {
        let fixture = Fixture::new();
        #[cfg(unix)]
        let name = "literal[1]\tline\nfile";
        #[cfg(not(unix))]
        let name = "literal[1] file";
        fs::write(fixture.repository.join(name), b"staged\n").unwrap();
        fixture.git(&["add", "--", name]);
        fs::write(fixture.repository.join(name), b"later working copy\n").unwrap();
        fs::write(fixture.repository.join("text"), b"unselected\n").unwrap();
        let destination = fixture.directory.join("selected.patch");
        export_patch(&fixture.repository, true, &[name.into()], &destination).unwrap();
        let bytes = fs::read(&destination).unwrap();
        let files = describe_patch(&fixture.repository, &bytes).unwrap().0;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, name);
        assert!(export_patch(&fixture.repository, true, &[name.into()], &destination).is_err());
        assert_eq!(fs::read(&destination).unwrap(), bytes);
        fixture.git(&["restore", "--staged", "."]);
        fs::remove_file(fixture.repository.join(name)).unwrap();
        fixture.clean();
        let review = review_patch(&fixture.repository, &destination, PatchTarget::Both).unwrap();
        import_patch(&fixture.repository, &review.request).unwrap();
        assert_eq!(
            fs::read(fixture.repository.join(name)).unwrap(),
            b"staged\n"
        );
        assert_eq!(fixture.output(&["show", &format!(":{name}")]), b"staged\n");
    }

    #[test]
    fn deletion_addition_and_executable_mode_round_trip_without_rename_reconstruction() {
        let fixture = Fixture::new();
        fs::rename(
            fixture.repository.join("text"),
            fixture.repository.join("moved"),
        )
        .unwrap();
        fixture.git(&["add", "."]);
        fixture.git(&["update-index", "--chmod=+x", "moved"]);
        let file = fixture.patch(true);
        let bytes = fs::read(&file).unwrap();
        assert!(!bytes.windows(12).any(|bytes| bytes == b"rename from "));
        fixture.clean();
        let review = review_patch(&fixture.repository, &file, PatchTarget::Both).unwrap();
        assert!(review.summary.contains("100755"));
        import_patch(&fixture.repository, &review.request).unwrap();
        assert!(!fixture.repository.join("text").exists());
        assert_eq!(
            fs::read(fixture.repository.join("moved")).unwrap(),
            b"old\n"
        );
        assert!(fixture
            .output(&["ls-files", "--stage", "moved"])
            .starts_with(b"100755 "));
    }

    fn text_patch(fixture: &Fixture) -> PathBuf {
        fs::write(fixture.repository.join("text"), b"new\n").unwrap();
        let file = fixture.patch(false);
        fixture.clean();
        file
    }

    #[test]
    fn changed_patch_head_branch_dirty_index_and_hidden_flags_refuse_without_applying() {
        let fixture = Fixture::new();
        let file = text_patch(&fixture);
        let review = review_patch(&fixture.repository, &file, PatchTarget::Both).unwrap();
        let bytes = fs::read(&file).unwrap();
        fs::write(
            &file,
            String::from_utf8(bytes.clone())
                .unwrap()
                .replace("+new", "+different"),
        )
        .unwrap();
        assert!(import_patch(&fixture.repository, &review.request).is_err());
        assert_eq!(fs::read(fixture.repository.join("text")).unwrap(), b"old\n");
        fs::write(&file, &bytes).unwrap();
        fixture.git(&["checkout", "-b", "other"]);
        assert!(import_patch(&fixture.repository, &review.request).is_err());
        fixture.git(&["checkout", "main"]);
        fixture.git(&["commit", "--allow-empty", "-m", "Moved HEAD"]);
        assert!(import_patch(&fixture.repository, &review.request).is_err());
        let review = review_patch(&fixture.repository, &file, PatchTarget::Both).unwrap();
        fs::write(fixture.repository.join("text"), b"local\n").unwrap();
        assert!(import_patch(&fixture.repository, &review.request).is_err());
        fixture.git(&["add", "text"]);
        assert!(import_patch(&fixture.repository, &review.request).is_err());
        fixture.clean();
        fixture.git(&["update-index", "--assume-unchanged", "text"]);
        assert!(import_patch(&fixture.repository, &review.request).is_err());
        fixture.git(&["update-index", "--no-assume-unchanged", "text"]);
        fixture.git(&["update-index", "--skip-worktree", "text"]);
        assert!(import_patch(&fixture.repository, &review.request).is_err());
        fixture.git(&["update-index", "--no-skip-worktree", "text"]);
        fs::write(fixture.repository.join("untracked"), b"keep\n").unwrap();
        assert!(import_patch(&fixture.repository, &review.request).is_err());
        assert_eq!(
            fs::read(fixture.repository.join("untracked")).unwrap(),
            b"keep\n"
        );
    }

    #[test]
    fn mismatched_later_hunk_is_atomic_and_active_metadata_is_not_modified() {
        let fixture = Fixture::new();
        let file = text_patch(&fixture);
        let bytes = fs::read(&file).unwrap();
        let bad = b"diff --git a/binary b/binary\n--- a/binary\n+++ b/binary\n@@ -1 +1 @@\n-wrong\n+new\n";
        fs::write(&file, [bytes.as_slice(), bad].concat()).unwrap();
        assert!(review_patch(&fixture.repository, &file, PatchTarget::Worktree).is_err());
        assert_eq!(fs::read(fixture.repository.join("text")).unwrap(), b"old\n");
        fs::write(&file, bytes).unwrap();
        for name in ["rebase-apply", "rebase-merge", "sequencer"] {
            let marker = fixture.repository.join(".git").join(name);
            fs::create_dir(&marker).unwrap();
            assert!(review_patch(&fixture.repository, &file, PatchTarget::Both).is_err());
            assert!(marker.is_dir());
            fs::remove_dir(marker).unwrap();
        }
    }

    #[test]
    fn traversal_metadata_special_modes_and_extended_renames_are_refused() {
        let fixture = Fixture::new();
        for name in [
            "../outside",
            "/absolute",
            ".git/config",
            ".GIT/config",
            "dir/../escape",
            "C:/escape",
            "dir\\escape",
        ] {
            let patch = format!("diff --git a/{name} b/{name}\nnew file mode 100644\n--- /dev/null\n+++ b/{name}\n@@ -0,0 +1 @@\n+new\n");
            assert!(
                describe_patch(&fixture.repository, patch.as_bytes()).is_err(),
                "{name}"
            );
        }
        for mode in ["120000", "160000"] {
            let patch = format!("diff --git a/new b/new\nnew file mode {mode}\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+new\n");
            assert!(describe_patch(&fixture.repository, patch.as_bytes()).is_err());
        }
        let rename = b"diff --git a/text b/moved\nsimilarity index 100%\nrename from text\nrename to moved\n";
        assert!(describe_patch(&fixture.repository, rename).is_err());
        fs::create_dir_all(fixture.repository.join("nested/.git")).unwrap();
        assert!(safe_path(&fixture.repository, "nested/file").is_err());
        assert!(export_patch(
            &fixture.repository,
            false,
            &[],
            &fixture.repository.join("unsafe.patch")
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_ancestors_inputs_and_export_destinations_never_follow_external_files() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let file = text_patch(&fixture);
        symlink(&fixture.directory, fixture.repository.join("link")).unwrap();
        assert!(safe_path(&fixture.repository, "link/external").is_err());
        let input = fixture.directory.join("linked.patch");
        symlink(&file, &input).unwrap();
        assert!(read_patch(&input).is_err());
        fs::write(fixture.repository.join("text"), b"new\n").unwrap();
        let destination = fixture.directory.join("destination.patch");
        symlink(&file, &destination).unwrap();
        let original = fs::read(&file).unwrap();
        assert!(export_patch(&fixture.repository, false, &[], &destination).is_err());
        assert_eq!(fs::read(file).unwrap(), original);
    }

    #[test]
    fn complete_byte_and_distinct_path_thresholds_never_offer_partial_imports() {
        let fixture = Fixture::new();
        let file = text_patch(&fixture);
        let bytes = fs::read(&file).unwrap();
        let padded = [vec![b'\n'; MAX_PATCH_BYTES - bytes.len()], bytes].concat();
        fs::write(&file, &padded).unwrap();
        assert_eq!(
            review_patch(&fixture.repository, &file, PatchTarget::Worktree)
                .unwrap()
                .request
                .patch
                .len(),
            MAX_PATCH_BYTES
        );
        fs::write(&file, [padded.as_slice(), b"\n"].concat()).unwrap();
        assert!(review_patch(&fixture.repository, &file, PatchTarget::Worktree).is_err());
        let mut patch = String::new();
        for index in 0..MAX_PATCH_FILES {
            patch.push_str(&format!("diff --git a/new-{index} b/new-{index}\nnew file mode 100644\n--- /dev/null\n+++ b/new-{index}\n@@ -0,0 +1 @@\n+new\n"));
        }
        assert_eq!(
            describe_patch(&fixture.repository, patch.as_bytes())
                .unwrap()
                .0
                .len(),
            MAX_PATCH_FILES
        );
        patch.push_str("diff --git a/extra b/extra\nnew file mode 100644\n--- /dev/null\n+++ b/extra\n@@ -0,0 +1 @@\n+new\n");
        assert!(describe_patch(&fixture.repository, patch.as_bytes()).is_err());
    }

    #[test]
    fn configured_whitespace_relaxation_and_fixing_cannot_change_reviewed_semantics() {
        let fixture = Fixture::new();
        fs::write(fixture.repository.join("text"), b"a b\nend\n").unwrap();
        fixture.git(&["add", "."]);
        fixture.git(&["commit", "-m", "Context"]);
        fixture.git(&["config", "apply.ignoreWhitespace", "change"]);
        fixture.git(&["config", "apply.whitespace", "fix"]);
        let file = fixture.directory.join("context.patch");
        fs::write(&file, b"diff --git a/text b/text\n--- a/text\n+++ b/text\n@@ -1,2 +1,3 @@\n a  b\n+new   \n end\n").unwrap();
        assert!(review_patch(&fixture.repository, &file, PatchTarget::Both).is_err());
        fs::write(&file, b"diff --git a/text b/text\n--- a/text\n+++ b/text\n@@ -1,2 +1,3 @@\n a b\n+new   \n end\n").unwrap();
        let review = review_patch(&fixture.repository, &file, PatchTarget::Both).unwrap();
        import_patch(&fixture.repository, &review.request).unwrap();
        assert_eq!(
            fs::read(fixture.repository.join("text")).unwrap(),
            b"a b\nnew   \nend\n"
        );
        assert_eq!(
            fixture.output(&["config", "apply.ignoreWhitespace"]),
            b"change\n"
        );
        assert_eq!(fixture.output(&["config", "apply.whitespace"]), b"fix\n");
    }

    #[test]
    fn linked_worktree_patch_scope_and_literal_root_paths_preserve_main_files_and_metadata() {
        let fixture = Fixture::new();
        #[cfg(unix)]
        let linked = fixture.directory.join("linked worktree\n");
        #[cfg(not(unix))]
        let linked = fixture.directory.join("linked worktree");
        fixture.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
        fs::write(linked.join("text"), b"linked\n").unwrap();
        let file = fixture.directory.join("linked.patch");
        export_patch(&linked, false, &[], &file).unwrap();
        run_mutation(&linked, &["restore", "."], "restore owned linked fixture").unwrap();
        let review = review_patch(&linked, &file, PatchTarget::Both).unwrap();
        assert_eq!(review.request.head_ref, "refs/heads/linked\n");
        import_patch(&linked, &review.request).unwrap();
        assert_eq!(fs::read(linked.join("text")).unwrap(), b"linked\n");
        assert_eq!(fs::read(fixture.repository.join("text")).unwrap(), b"old\n");
        assert_eq!(fixture.output(&["status", "--porcelain"]), b"");
        assert!(export_patch(
            &linked,
            true,
            &[],
            &fixture.repository.join(".git/forbidden.patch")
        )
        .is_err());
        assert!(!fixture.repository.join(".git/forbidden.patch").exists());
    }

    #[test]
    fn external_diff_configuration_cannot_execute_and_invalid_selection_writes_nothing() {
        let fixture = Fixture::new();
        fixture.git(&[
            "config",
            "diff.external",
            "definitely-missing-owned-test-program",
        ]);
        fixture.git(&["config", "diff.noprefix", "true"]);
        fixture.git(&["config", "diff.context", "0"]);
        fixture.git(&["config", "diff.ignoreSubmodules", "all"]);
        fs::write(fixture.repository.join("text"), b"old\nextra\n").unwrap();
        fs::write(fixture.repository.join("untracked"), b"keep\n").unwrap();
        let destination = fixture.directory.join("external.patch");
        export_patch(&fixture.repository, false, &[], &destination).unwrap();
        let bytes = fs::read(&destination).unwrap();
        assert!(bytes.starts_with(b"diff --git a/text b/text\n"));
        assert!(bytes
            .windows(b" old\n+extra\n".len())
            .any(|line| line == b" old\n+extra\n"));
        let partial = fixture.directory.join("partial.patch");
        assert!(export_patch(
            &fixture.repository,
            false,
            &["text".into(), "untracked".into()],
            &partial
        )
        .is_err());
        assert!(!partial.exists());
        let empty = fixture.directory.join("empty.patch");
        fs::write(&empty, []).unwrap();
        assert!(read_patch(&empty).is_err());
        fs::write(&empty, b"This is not a diff.\n").unwrap();
        assert!(describe_patch(&fixture.repository, &fs::read(empty).unwrap()).is_err());
        fixture.clean();
        fs::remove_file(fixture.repository.join("untracked")).unwrap();
        let review = review_patch(&fixture.repository, &destination, PatchTarget::Both).unwrap();
        import_patch(&fixture.repository, &review.request).unwrap();
        assert_eq!(
            fs::read(fixture.repository.join("text")).unwrap(),
            b"old\nextra\n"
        );
    }
}
