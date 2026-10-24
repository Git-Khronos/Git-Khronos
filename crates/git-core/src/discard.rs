use super::*;
use std::fs::OpenOptions;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscardPreview {
    pub paths: Vec<String>,
    pub skipped_paths: Vec<String>,
    pub untracked: usize,
}

pub struct DiscardPlan {
    pub preview: DiscardPreview,
    selected: Option<Vec<String>>,
    patch: Vec<u8>,
    mutation_patch: Vec<u8>,
    index: Vec<u8>,
    selection_preview: Option<(String, String)>,
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscardRecoveryInfo {
    pub id: String,
    pub restored: bool,
}

fn pathspec(file: &str) -> String {
    format!(":(literal){file}")
}

fn safe_file(path: &Path, file: &str) -> bool {
    let candidate = Path::new(file);
    if file.is_empty()
        || file.contains('\0')
        || !candidate
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return false;
    }
    let mut ancestor = path.to_path_buf();
    let components = candidate.components().collect::<Vec<_>>();
    for component in &components[..components.len().saturating_sub(1)] {
        ancestor.push(component);
        if ancestor.join(".git").exists()
            || fs::symlink_metadata(&ancestor).is_ok_and(|metadata| metadata.is_symlink())
        {
            return false;
        }
    }
    !fs::symlink_metadata(path.join(file)).is_ok_and(|metadata| metadata.is_dir())
}

pub fn prepare_discard(
    path: &Path,
    selected: Option<Vec<String>>,
) -> Result<DiscardPlan, AppError> {
    if selected.as_ref().is_some_and(Vec::is_empty) {
        return Err(AppError::new(
            "emptyDiscard",
            "Select files to discard.",
            None,
        ));
    }
    let status = read_status(path)?;
    let index_output = run_git(path, &["ls-files", "--stage", "-z"])?;
    ensure_success("inspect the index before discarding", &index_output)?;
    let gitlinks = index_output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| record.starts_with(b"160000 "))
        .filter_map(|record| record.splitn(2, |byte| *byte == b'\t').nth(1))
        .map(|file| String::from_utf8_lossy(file).into_owned())
        .collect::<HashSet<_>>();
    let mut paths = Vec::new();
    let mut skipped_paths = Vec::new();
    let mut patch = Vec::new();
    let mut untracked = 0;
    for entry in status.entries {
        if selected.as_ref().is_some_and(|selection| {
            !selection.iter().any(|file| {
                file == &entry.path || (file.ends_with('/') && entry.path.starts_with(file))
            })
        }) {
            continue;
        }
        if entry.index_status != "?"
            && matches!(entry.worktree_status.as_str(), " " | "!")
            && !entry.conflicted
        {
            continue;
        }
        if entry.conflicted || gitlinks.contains(&entry.path) || !safe_file(path, &entry.path) {
            skipped_paths.push(entry.path);
            continue;
        }
        let output = if entry.index_status == "?" {
            untracked += 1;
            run_git_allow_diff_exit(
                path,
                &[
                    "-c",
                    "diff.noprefix=false",
                    "-c",
                    "diff.mnemonicPrefix=false",
                    "diff",
                    "--no-index",
                    "--binary",
                    "--full-index",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-color",
                    "--src-prefix=a/",
                    "--dst-prefix=b/",
                    "--unified=3",
                    "--",
                    "/dev/null",
                    &entry.path,
                ],
            )?
        } else {
            let output = run_git(
                path,
                &[
                    "-c",
                    "diff.noprefix=false",
                    "-c",
                    "diff.mnemonicPrefix=false",
                    "diff",
                    "--binary",
                    "--full-index",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-color",
                    "--no-renames",
                    "--src-prefix=a/",
                    "--dst-prefix=b/",
                    "--unified=3",
                    "--",
                    &pathspec(&entry.path),
                ],
            )?;
            ensure_success("capture discarded changes", &output)?;
            output
        };
        if output.stdout.is_empty() {
            return Err(AppError::new(
                "missingRecoveryPatch",
                format!("Git could not capture changes in '{}'.", entry.path),
                Some("No files were discarded. Refresh and review the file."),
            ));
        }
        patch.extend(output.stdout);
        paths.push(entry.path);
    }
    if paths.is_empty() {
        return Err(AppError::new(
            "emptyDiscard",
            "There are no eligible unstaged files to discard.",
            Some("Conflicts, submodule working trees and nested repositories are not discarded."),
        ));
    }
    Ok(DiscardPlan {
        preview: DiscardPreview {
            paths,
            skipped_paths,
            untracked,
        },
        selected,
        mutation_patch: patch.clone(),
        patch,
        index: index_output.stdout,
        selection_preview: None,
    })
}

pub fn prepare_partial_discard(
    path: &Path,
    file: &str,
    hunk_index: usize,
    lines: Option<&[usize]>,
) -> Result<DiscardPlan, AppError> {
    prepare_partial_discard_with_preview(path, file, hunk_index, lines, None)
}

pub fn prepare_partial_discard_with_preview(
    path: &Path,
    file: &str,
    hunk_index: usize,
    lines: Option<&[usize]>,
    expected_patch: Option<&str>,
) -> Result<DiscardPlan, AppError> {
    let mut plan = prepare_discard(path, Some(vec![file.to_owned()]))?;
    if plan.preview.untracked > 0 {
        return Err(AppError::new(
            "untrackedPartialDiscardUnsupported",
            "Discard an untracked file as a whole, not as individual changes.",
            None,
        ));
    }
    // Select from the same canonical preview the user saw, not the binary
    // recovery patch or repository-specific diff presentation settings.
    let patch = read_selection_patch(path, file, false, "discard", expected_patch)?;
    plan.mutation_patch = if let Some(lines) = lines {
        if lines.is_empty() || lines.len() > 10_000 {
            return Err(AppError::new(
                "invalidLineSelection",
                "Select at least one changed line.",
                None,
            ));
        }
        select_patch_lines_with_context(&patch, hunk_index, lines, true)?.into_bytes()
    } else {
        select_patch_hunk(&patch, hunk_index)?.into_bytes()
    };
    plan.selection_preview = Some((file.to_owned(), patch));
    Ok(plan)
}

pub(super) fn recovery_directory(path: &Path) -> Result<PathBuf, AppError> {
    // Ask for the owning Git directory, not an absolute --git-path: Git
    // canonicalizes the latter and hides a symlink at the recovery entry.
    let output = run_git(path, &["rev-parse", "--absolute-git-dir"])?;
    ensure_success("locate discarded-change recovery", &output)?;
    let git_directory = String::from_utf8_lossy(&output.stdout);
    let directory = PathBuf::from(git_directory.strip_suffix('\n').unwrap_or(&git_directory))
        .join("git-khronos-recovery");
    validate_recovery_directory(&directory)?;
    Ok(directory)
}

fn validate_recovery_directory(directory: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.is_symlink() => Ok(()),
        Ok(_) => Err(AppError::new(
            "invalidRecoveryPath",
            "The recovery directory must be an ordinary directory, not a symbolic link.",
            Some("Preserve the recovery data and inspect the Git directory before retrying."),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn recovery_file_exists(file: &Path) -> Result<bool, AppError> {
    match fs::symlink_metadata(file) {
        Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => Ok(true),
        Ok(_) => Err(AppError::new(
            "invalidRecoveryPath",
            "Recovery patches and markers must be ordinary files, not symbolic links.",
            Some("Preserve the recovery data and inspect the Git directory before retrying."),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(error)),
    }
}

fn require_recovery_file(file: &Path) -> Result<(), AppError> {
    if !recovery_file_exists(file)? {
        return Err(io_error(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "The recovery file is missing.",
        )));
    }
    Ok(())
}

pub(super) fn io_error(error: std::io::Error) -> AppError {
    AppError::new(
        "discardRecoveryUnavailable",
        format!("Could not access recovery data: {error}"),
        Some(
            "Check available disk space and repository permissions. Recovery data is kept in the Git directory.",
        ),
    )
}

fn apply_patch(path: &Path, capture: &Path, reverse: bool, check: bool) -> Result<(), AppError> {
    require_recovery_file(capture)?;
    let mut args = vec!["apply", "--binary", "--recount", "--whitespace=nowarn"];
    if reverse {
        args.push("--reverse");
    }
    if check {
        args.push("--check");
    }
    let capture = capture.to_str().ok_or_else(|| {
        AppError::new(
            "invalidRecoveryPath",
            "The recovery path cannot be represented for Git.",
            None,
        )
    })?;
    args.extend(["--", capture]);
    run_mutation(
        path,
        &args,
        if reverse {
            "discard the captured changes"
        } else {
            "recover discarded changes"
        },
    )
}

pub fn execute_discard(path: &Path, plan: &DiscardPlan) -> Result<String, AppError> {
    let current = prepare_discard(path, plan.selected.clone())?;
    if current.patch != plan.patch
        || current.index != plan.index
        || current.preview.paths != plan.preview.paths
        || current.preview.skipped_paths != plan.preview.skipped_paths
    {
        return Err(AppError::new(
            "staleDiscard",
            "Files or the index changed after the discard preview.",
            Some("Nothing was discarded. Review a new preview before continuing."),
        ));
    }
    if let Some((file, preview)) = &plan.selection_preview {
        read_selection_patch(path, file, false, "discard", Some(preview))?;
    }
    let directory = recovery_directory(path)?;
    fs::create_dir_all(&directory).map_err(io_error)?;
    validate_recovery_directory(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
    }
    let id = format!(
        "{:020}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::new("invalidSystemClock", "The system clock is invalid.", None))?
            .as_nanos(),
        std::process::id()
    );
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let pending = directory.join(format!("{id}.pending"));
    let mut file = options.open(&pending).map_err(io_error)?;
    file.write_all(&plan.mutation_patch).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    drop(file);
    apply_patch(path, &pending, true, true)?;
    let capture = directory.join(format!("{id}.patch"));
    fs::rename(pending, &capture).map_err(io_error)?;
    #[cfg(unix)]
    fs::File::open(&directory)
        .and_then(|directory| directory.sync_all())
        .map_err(io_error)?;
    // Retain the capture even if applying fails: a filesystem error can leave partial effects.
    apply_patch(path, &capture, true, false).map_err(|error| AppError::new(
        "discardFailedWithRecovery", error.message,
        Some("Discard may have partially changed files. The captured patch remains in discarded-change recovery.")))?;
    Ok(id)
}

fn validate_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-') {
        return Err(AppError::new(
            "invalidRecovery",
            "That recovery identifier is invalid.",
            None,
        ));
    }
    Ok(())
}

pub fn discarded_change_recoveries(path: &Path) -> Result<Vec<DiscardRecoveryInfo>, AppError> {
    let directory = recovery_directory(path)?;
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_error(error)),
    };
    let mut recoveries = Vec::new();
    for entry in entries {
        let entry = entry.map_err(io_error)?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".patch")) else {
            continue;
        };
        validate_id(id)?;
        require_recovery_file(&entry.path())?;
        recoveries.push(DiscardRecoveryInfo {
            id: id.to_owned(),
            restored: recovery_file_exists(&directory.join(format!("{id}.restored")))?,
        });
    }
    recoveries.sort_by(|left, right| right.id.cmp(&left.id));
    Ok(recoveries)
}

pub fn recover_discarded_changes(path: &Path, id: &str, reverse: bool) -> Result<(), AppError> {
    validate_id(id)?;
    let directory = recovery_directory(path)?;
    let marker = directory.join(format!("{id}.restored"));
    if recovery_file_exists(&marker)? != reverse {
        return Err(AppError::new(
            "discardRecoveryStateChanged",
            "That recovery was already applied.",
            Some("Refresh discarded-change recovery."),
        ));
    }
    let capture = directory.join(format!("{id}.patch"));
    apply_patch(path, &capture, reverse, true)?;
    apply_patch(path, &capture, reverse, false)?;
    if reverse {
        fs::remove_file(marker).map_err(io_error)?;
    } else {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(marker)
            .and_then(|file| file.sync_all())
            .map_err(io_error)?;
    }
    Ok(())
}

pub fn delete_discard_recovery(path: &Path, id: &str) -> Result<(), AppError> {
    validate_id(id)?;
    let directory = recovery_directory(path)?;
    let capture = directory.join(format!("{id}.patch"));
    let marker = directory.join(format!("{id}.restored"));
    // Validate both paths before removing either: a corrupt marker must not
    // cause the otherwise usable capture to be deleted on a refused request.
    require_recovery_file(&capture)?;
    recovery_file_exists(&marker)?;
    fs::remove_file(capture).map_err(io_error)?;
    match fs::remove_file(marker) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Repository(PathBuf);

    impl Repository {
        fn new() -> Self {
            let id = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("chronos-bulk-discard-{}-{id}", std::process::id()));
            fs::create_dir(&path).unwrap();
            for args in [
                vec!["init", "-b", "main"],
                vec!["config", "user.name", "Test"],
                vec!["config", "user.email", "test@example.test"],
                vec!["config", "commit.gpgsign", "false"],
            ] {
                ensure_success("initialize test", &run_git(&path, &args).unwrap()).unwrap();
            }
            Self(path)
        }

        fn write(&self, file: &str, contents: &[u8]) {
            let path = self.0.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }

        fn baseline(&self) {
            self.write("tracked.txt", b"base\n");
            stage_all(&self.0).unwrap();
            commit(&self.0, "Baseline").unwrap();
        }
    }

    impl Drop for Repository {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn bulk_discard_preserves_index_and_recovers_binary_empty_deleted_and_new_files() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"staged\n");
        stage_path(&repository.0, "tracked.txt").unwrap();
        repository.write("tracked.txt", b"unstaged\n");
        repository.write("binary.dat", &[0, 1, 2, 255]);
        repository.write("empty", b"");
        repository.write("folder/new.txt", b"new\n");
        let original_index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout;
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert_eq!(plan.preview.paths.len(), 4);
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"staged\n"
        );
        assert!(!repository.0.join("binary.dat").exists());
        assert_eq!(
            run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            original_index
        );
        assert_eq!(
            discarded_change_recoveries(&repository.0).unwrap()[0].id,
            id
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"unstaged\n"
        );
        assert_eq!(
            fs::read(repository.0.join("binary.dat")).unwrap(),
            [0, 1, 2, 255]
        );
        assert!(repository.0.join("empty").exists());
        recover_discarded_changes(&repository.0, &id, true).unwrap();
        delete_discard_recovery(&repository.0, &id).unwrap();
        assert!(
            discarded_change_recoveries(&repository.0)
                .unwrap()
                .is_empty()
        );
        fs::remove_file(repository.0.join("tracked.txt")).unwrap();
        let plan = prepare_discard(&repository.0, None).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert!(repository.0.join("tracked.txt").exists());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert!(!repository.0.join("tracked.txt").exists());
    }

    #[test]
    fn bulk_discard_skips_nested_repositories_and_preserves_ignored_and_unselected_files() {
        let repository = Repository::new();
        repository.baseline();
        repository.write(".gitignore", b"ignored/\n");
        stage_path(&repository.0, ".gitignore").unwrap();
        repository.write("ignored/secret", b"keep");
        repository.write("selected/new.txt", b"discard");
        repository.write("unselected.txt", b"keep");
        repository.write("nested/.git/HEAD", b"ref: refs/heads/main\n");
        repository.write("nested/new.txt", b"keep");
        // A real nested repository must be excluded even when status collapses it.
        ensure_success(
            "initialize nested",
            &run_git(&repository.0.join("nested"), &["init"]).unwrap(),
        )
        .unwrap();
        let plan = prepare_discard(&repository.0, Some(vec!["selected/".into()])).unwrap();
        execute_discard(&repository.0, &plan).unwrap();
        assert!(!repository.0.join("selected/new.txt").exists());
        assert!(repository.0.join("unselected.txt").exists());
        assert!(repository.0.join("ignored/secret").exists());
        let all = prepare_discard(&repository.0, None).unwrap();
        assert!(
            all.preview
                .skipped_paths
                .iter()
                .any(|file| file.starts_with("nested"))
        );
        execute_discard(&repository.0, &all).unwrap();
        assert!(repository.0.join("nested/new.txt").exists());
        assert!(repository.0.join("ignored/secret").exists());
    }

    #[test]
    fn bulk_discard_refuses_stale_file_and_index_previews() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"first\n");
        let plan = prepare_discard(&repository.0, None).unwrap();
        repository.write("tracked.txt", b"second\n");
        assert_eq!(
            execute_discard(&repository.0, &plan).unwrap_err().kind,
            "staleDiscard"
        );
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"second\n"
        );
        let plan = prepare_discard(&repository.0, None).unwrap();
        repository.write("staged.txt", b"new index");
        stage_path(&repository.0, "staged.txt").unwrap();
        assert_eq!(
            execute_discard(&repository.0, &plan).unwrap_err().kind,
            "staleDiscard"
        );
        assert!(
            discarded_change_recoveries(&repository.0)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn bulk_discard_recovery_refuses_conflicting_later_edits() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"discarded\n");
        let id = execute_discard(
            &repository.0,
            &prepare_discard(&repository.0, None).unwrap(),
        )
        .unwrap();
        repository.write("tracked.txt", b"later work\n");
        assert!(recover_discarded_changes(&repository.0, &id, false).is_err());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"later work\n"
        );
        assert!(!discarded_change_recoveries(&repository.0).unwrap()[0].restored);
    }

    #[test]
    fn bulk_discard_uses_literal_paths_and_includes_unloaded_status_entries() {
        let repository = Repository::new();
        repository.baseline();
        for index in 0..1010 {
            repository.write(&format!("new-{index}"), b"new");
        }
        repository.write(":(glob)*.txt", b"literal");
        assert!(
            status_with_entry_limit(&repository.0, 10)
                .unwrap()
                .entries_truncated
        );
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert_eq!(plan.preview.paths.len(), 1011);
        execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(read_status(&repository.0).unwrap().untracked, 0);
        assert!(repository.0.join("tracked.txt").exists());
    }

    #[test]
    fn bulk_discard_handles_unborn_repositories() {
        let repository = Repository::new();
        repository.write("new.txt", b"new");
        let id = execute_discard(
            &repository.0,
            &prepare_discard(&repository.0, None).unwrap(),
        )
        .unwrap();
        assert!(!repository.0.join("new.txt").exists());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(fs::read(repository.0.join("new.txt")).unwrap(), b"new");
    }

    #[test]
    fn bulk_discard_skips_conflicts_and_gitlinks() {
        let repository = Repository::new();
        repository.baseline();
        let oid = String::from_utf8_lossy(
            &run_git(&repository.0, &["rev-parse", "HEAD"])
                .unwrap()
                .stdout,
        )
        .trim()
        .to_owned();
        run_mutation(
            &repository.0,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{oid},submodule"),
            ],
            "create test gitlink",
        )
        .unwrap();
        run_mutation(
            &repository.0,
            &[
                "clone",
                "--no-hardlinks",
                "--no-local",
                repository.0.to_str().unwrap(),
                repository.0.join("submodule").to_str().unwrap(),
            ],
            "create test submodule checkout",
        )
        .unwrap();
        repository.write("submodule/dirty.txt", b"keep");
        let blob = run_git(&repository.0, &["rev-parse", "HEAD:tracked.txt"]).unwrap();
        let blob = String::from_utf8_lossy(&blob.stdout).trim().to_owned();
        let entries = format!("0 {}\\ttracked.txt\n100644 {blob} 1\\ttracked.txt\n100644 {blob} 2\\ttracked.txt\n100644 {blob} 3\\ttracked.txt\n", "0".repeat(40)).replace("\\t", "\t");
        run_git_with_input(
            &repository.0,
            &["update-index", "--index-info"],
            entries.as_bytes(),
            "create conflict",
        )
        .unwrap();
        repository.write("tracked.txt", b"conflicted work\n");
        repository.write("ordinary.txt", b"discard");
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert!(
            plan.preview
                .skipped_paths
                .contains(&"tracked.txt".to_owned())
        );
        execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"conflicted work\n"
        );
        assert!(repository.0.join("submodule/dirty.txt").exists());
    }

    #[test]
    fn bulk_discard_does_not_mutate_when_recovery_storage_is_unavailable() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"keep\n");
        repository.write(".git/git-khronos-recovery", b"not a directory");
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert!(execute_discard(&repository.0, &plan).is_err());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"keep\n"
        );
    }

    #[test]
    #[cfg(unix)]
    fn discard_refuses_a_redirected_recovery_directory_without_external_writes() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let repository = Repository::new();
        let outside = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"keep this edit\n");
        let storage = outside.0.join("protected");
        fs::create_dir(&storage).unwrap();
        fs::set_permissions(&storage, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(storage.join("123.patch"), b"outside sentinel\n").unwrap();
        symlink(&storage, repository.0.join(".git/git-khronos-recovery")).unwrap();
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert!(execute_discard(&repository.0, &plan).is_err());
        assert!(discarded_change_recoveries(&repository.0).is_err());
        assert!(delete_discard_recovery(&repository.0, "123").is_err());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"keep this edit\n"
        );
        assert_eq!(
            fs::read(storage.join("123.patch")).unwrap(),
            b"outside sentinel\n"
        );
        assert_eq!(fs::read_dir(&storage).unwrap().count(), 1);
        assert_eq!(
            fs::metadata(&storage).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[test]
    #[cfg(unix)]
    fn recovery_refuses_a_linked_capture_before_changing_files() {
        use std::os::unix::fs::symlink;
        let repository = Repository::new();
        let outside = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"captured edit\n");
        let id = execute_discard(
            &repository.0,
            &prepare_discard(&repository.0, None).unwrap(),
        )
        .unwrap();
        let capture = repository
            .0
            .join(format!(".git/git-khronos-recovery/{id}.patch"));
        let external = outside.0.join("outside.patch");
        fs::rename(&capture, &external).unwrap();
        symlink(&external, &capture).unwrap();
        let bytes = fs::read(&external).unwrap();
        assert!(recover_discarded_changes(&repository.0, &id, false).is_err());
        assert!(discarded_change_recoveries(&repository.0).is_err());
        assert!(delete_discard_recovery(&repository.0, &id).is_err());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        assert_eq!(fs::read(&external).unwrap(), bytes);
        assert!(fs::symlink_metadata(&capture).unwrap().is_symlink());
    }

    #[test]
    #[cfg(unix)]
    fn recovery_refuses_a_dangling_marker_link_without_creating_its_target() {
        use std::os::unix::fs::symlink;
        let repository = Repository::new();
        let outside = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"captured edit\n");
        let id = execute_discard(
            &repository.0,
            &prepare_discard(&repository.0, None).unwrap(),
        )
        .unwrap();
        let capture = repository
            .0
            .join(format!(".git/git-khronos-recovery/{id}.patch"));
        let marker = capture.with_extension("restored");
        let target = outside.0.join("must-not-be-created");
        symlink(&target, &marker).unwrap();
        assert!(recover_discarded_changes(&repository.0, &id, false).is_err());
        assert!(discarded_change_recoveries(&repository.0).is_err());
        assert!(delete_discard_recovery(&repository.0, &id).is_err());
        assert!(!target.exists());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        assert!(capture.is_file());
        assert!(fs::symlink_metadata(&marker).unwrap().is_symlink());
    }

    #[test]
    fn recovery_refuses_directory_entries_without_losing_the_capture() {
        for extension in ["patch", "restored"] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"captured edit\n");
            let id = execute_discard(
                &repository.0,
                &prepare_discard(&repository.0, None).unwrap(),
            )
            .unwrap();
            let capture = repository
                .0
                .join(format!(".git/git-khronos-recovery/{id}.patch"));
            let bytes = fs::read(&capture).unwrap();
            let invalid = capture.with_extension(extension);
            if extension == "patch" {
                fs::remove_file(&capture).unwrap();
            }
            fs::create_dir(&invalid).unwrap();
            assert_eq!(
                recover_discarded_changes(&repository.0, &id, false)
                    .unwrap_err()
                    .kind,
                "invalidRecoveryPath"
            );
            assert!(discarded_change_recoveries(&repository.0).is_err());
            assert!(delete_discard_recovery(&repository.0, &id).is_err());
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                b"base\n"
            );
            fs::remove_dir(&invalid).unwrap();
            if extension == "patch" {
                fs::write(&capture, &bytes).unwrap();
            } else {
                assert_eq!(fs::read(&capture).unwrap(), bytes);
            }
            recover_discarded_changes(&repository.0, &id, false).unwrap();
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                b"captured edit\n"
            );
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    fs::metadata(capture.with_extension("restored"))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o600
                );
            }
            recover_discarded_changes(&repository.0, &id, true).unwrap();
            delete_discard_recovery(&repository.0, &id).unwrap();
            assert!(
                discarded_change_recoveries(&repository.0)
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[test]
    fn discard_and_recovery_preserve_crlf_working_tree_contents() {
        let repository = Repository::new();
        repository.write(".gitattributes", b"tracked.txt text eol=crlf\n");
        repository.write("tracked.txt", b"base\r\n");
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "CRLF baseline").unwrap();
        repository.write("tracked.txt", b"changed\r\n");
        let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout;
        let plan = prepare_discard(&repository.0, Some(vec!["tracked.txt".to_owned()])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\r\n"
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"changed\r\n"
        );
        assert_eq!(
            run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            index
        );
    }

    #[cfg(unix)]
    #[test]
    fn discard_capture_never_executes_an_untracked_text_converter() {
        use std::os::unix::fs::PermissionsExt;
        let repository = Repository::new();
        repository.write(".gitattributes", b"*.owned diff=owned\n");
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Attributes").unwrap();
        let script = repository.0.join(".git/owned-textconv");
        fs::write(
            &script,
            b"#!/bin/sh\nprintf called > .git/textconv-called\nprintf 'converted contents\\n'\n",
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        ensure_success(
            "configure owned converter",
            &run_git(
                &repository.0,
                &["config", "diff.owned.textconv", script.to_str().unwrap()],
            )
            .unwrap(),
        )
        .unwrap();
        let bytes = b"owned raw contents\0\xff\n";
        repository.write("payload.owned", bytes);
        let plan = prepare_discard(&repository.0, Some(vec!["payload.owned".to_owned()])).unwrap();
        assert!(!repository.0.join(".git/textconv-called").exists());
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert!(!repository.0.join("payload.owned").exists());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(fs::read(repository.0.join("payload.owned")).unwrap(), bytes);
        assert!(!repository.0.join(".git/textconv-called").exists());
    }

    #[cfg(unix)]
    #[test]
    fn discard_and_recovery_preserve_reversible_clean_smudge_filters() {
        let repository = Repository::new();
        repository.write(".gitattributes", b"*.owned filter=owned\n");
        for (key, value) in [
            ("filter.owned.clean", "sed 's/^WORK://'"),
            ("filter.owned.smudge", "sed 's/^/WORK:/'"),
        ] {
            ensure_success(
                "configure owned conversion",
                &run_git(&repository.0, &["config", key, value]).unwrap(),
            )
            .unwrap();
        }
        repository.write("tracked.owned", b"WORK:base\n");
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Filtered baseline").unwrap();
        assert_eq!(
            run_git(&repository.0, &["show", ":tracked.owned"])
                .unwrap()
                .stdout,
            b"base\n"
        );
        repository.write("tracked.owned", b"WORK:changed\n");
        let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout;
        let plan = prepare_discard(&repository.0, Some(vec!["tracked.owned".to_owned()])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.owned")).unwrap(),
            b"WORK:base\n"
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.owned")).unwrap(),
            b"WORK:changed\n"
        );
        assert_eq!(
            run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            index
        );
    }

    #[test]
    fn partial_discard_refuses_a_stale_review_without_capture_or_index_changes() {
        for selected_lines in [false, true] {
            for changed_index in [false, true] {
                let repository = Repository::new();
                repository.baseline();
                repository.write("tracked.txt", b"reviewed\n");
                let preview = working_tree_file_diff(&repository.0, "tracked.txt", false).unwrap();
                if changed_index {
                    stage_path(&repository.0, "tracked.txt").unwrap();
                }
                repository.write("tracked.txt", b"later edit\n");
                let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
                    .unwrap()
                    .stdout;
                let lines = selected_lines.then_some([0usize, 1]);
                let error = prepare_partial_discard_with_preview(
                    &repository.0,
                    "tracked.txt",
                    0,
                    lines.as_ref().map(|lines| lines.as_slice()),
                    Some(&preview.patch),
                )
                .err()
                .expect("stale review must fail");
                assert_eq!(error.kind, "staleDiffSelection");
                assert_eq!(
                    fs::read(repository.0.join("tracked.txt")).unwrap(),
                    b"later edit\n"
                );
                assert_eq!(
                    run_git(&repository.0, &["ls-files", "--stage", "-z"])
                        .unwrap()
                        .stdout,
                    index
                );
                assert!(
                    discarded_change_recoveries(&repository.0)
                        .unwrap()
                        .is_empty()
                );
            }
        }
    }

    #[test]
    fn partial_discard_rechecks_the_displayed_preview_before_capture_creation() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"reviewed\n");
        let preview = working_tree_file_diff(&repository.0, "tracked.txt", false).unwrap();
        let plan = prepare_partial_discard_with_preview(
            &repository.0,
            "tracked.txt",
            0,
            None,
            Some(&preview.patch),
        )
        .unwrap();
        ensure_success(
            "change displayed object abbreviation",
            &run_git(&repository.0, &["config", "core.abbrev", "20"]).unwrap(),
        )
        .unwrap();
        let error = execute_discard(&repository.0, &plan).unwrap_err();
        assert_eq!(error.kind, "staleDiffSelection");
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"reviewed\n"
        );
        assert!(
            discarded_change_recoveries(&repository.0)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn bulk_discard_and_recovery_ignore_diff_presentation_configuration() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"changed\n");
        repository.write("new.txt", b"new contents\n");
        for (key, value) in [
            ("diff.context", "0"),
            ("diff.noprefix", "true"),
            ("diff.mnemonicPrefix", "true"),
        ] {
            ensure_success(
                "configure diff presentation",
                &run_git(&repository.0, &["config", key, value]).unwrap(),
            )
            .unwrap();
        }
        let plan = prepare_discard(&repository.0, None).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        assert!(!repository.0.join("new.txt").exists());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"changed\n"
        );
        assert_eq!(
            fs::read(repository.0.join("new.txt")).unwrap(),
            b"new contents\n"
        );
        assert!(
            run_git(&repository.0, &["diff", "--cached", "--name-only"])
                .unwrap()
                .stdout
                .is_empty()
        );
    }

    #[test]
    fn partial_discard_uses_displayed_hunks_despite_git_diff_configuration() {
        for selected_lines in [false, true] {
            let repository = Repository::new();
            let original = (1..=20)
                .map(|line| format!("line {line}\n"))
                .collect::<String>();
            repository.write("forest", original.as_bytes());
            stage_all(&repository.0).unwrap();
            commit(&repository.0, "Original").unwrap();
            for (key, value) in [
                ("diff.context", "0"),
                ("diff.noprefix", "true"),
                ("diff.mnemonicPrefix", "true"),
            ] {
                ensure_success(
                    "configure diff presentation",
                    &run_git(&repository.0, &["config", key, value]).unwrap(),
                )
                .unwrap();
            }
            let changed = original
                .replace("line 2\n", "changed two\n")
                .replace("line 5\n", "changed five\n")
                .replace("line 15\n", "changed fifteen\n");
            repository.write("forest", changed.as_bytes());
            let displayed = working_tree_file_diff(&repository.0, "forest", false).unwrap();
            assert_eq!(displayed.patch.matches("@@ -").count(), 2);
            let lines = selected_lines.then_some([0usize, 1]);
            let plan = prepare_partial_discard(
                &repository.0,
                "forest",
                0,
                lines.as_ref().map(|lines| lines.as_slice()),
            )
            .unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            let remaining = fs::read_to_string(repository.0.join("forest")).unwrap();
            assert!(remaining.contains("line 2\n"));
            assert_eq!(remaining.contains("changed five\n"), selected_lines);
            assert!(remaining.contains("changed fifteen\n"));
            assert!(
                run_git(&repository.0, &["diff", "--cached", "--name-only"])
                    .unwrap()
                    .stdout
                    .is_empty()
            );
            recover_discarded_changes(&repository.0, &id, false).unwrap();
            assert_eq!(
                fs::read_to_string(repository.0.join("forest")).unwrap(),
                changed
            );
        }
    }

    #[test]
    fn bulk_discard_partial_captures_survive_restart_and_leave_unselected_edits() {
        for selected_lines in [false, true] {
            let repository = Repository::new();
            let original = (1..=20)
                .map(|line| format!("line {line}\n"))
                .collect::<String>();
            repository.write("forest", original.as_bytes());
            stage_all(&repository.0).unwrap();
            commit(&repository.0, "Original").unwrap();
            let changed = original.replace("line 2\n", "changed two\n").replace(
                if selected_lines {
                    "line 5\n"
                } else {
                    "line 15\n"
                },
                "another edit\n",
            );
            repository.write("forest", changed.as_bytes());
            let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout;
            let lines = selected_lines.then_some([0usize, 1]);
            let plan = prepare_partial_discard(
                &repository.0,
                "forest",
                0,
                lines.as_ref().map(|lines| lines.as_slice()),
            )
            .unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            drop(plan);
            let remaining = fs::read_to_string(repository.0.join("forest")).unwrap();
            assert!(remaining.contains("line 2\n"));
            assert!(remaining.contains("another edit\n"));
            assert!(!remaining.contains("changed two\n"));
            assert_eq!(
                run_git(&repository.0, &["ls-files", "--stage", "-z"])
                    .unwrap()
                    .stdout,
                index
            );
            let captures = discarded_change_recoveries(&repository.0).unwrap();
            assert_eq!(captures[0].id, id);
            recover_discarded_changes(&repository.0, &id, false).unwrap();
            assert_eq!(
                fs::read_to_string(repository.0.join("forest")).unwrap(),
                changed
            );
            assert!(discarded_change_recoveries(&repository.0).unwrap()[0].restored);
            recover_discarded_changes(&repository.0, &id, true).unwrap();
            assert!(!discarded_change_recoveries(&repository.0).unwrap()[0].restored);
        }
    }

    #[cfg(unix)]
    #[test]
    fn bulk_discard_symlink_capture_preserves_targets_and_restores_links() {
        use std::os::unix::fs::symlink;
        let repository = Repository::new();
        repository.baseline();
        repository.write("target", b"keep target\n");
        symlink("target", repository.0.join("link")).unwrap();
        let plan = prepare_discard(&repository.0, Some(vec!["link".into()])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert!(!repository.0.join("link").exists());
        assert_eq!(
            fs::read(repository.0.join("target")).unwrap(),
            b"keep target\n"
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read_link(repository.0.join("link")).unwrap(),
            Path::new("target")
        );
        assert_eq!(
            fs::read(repository.0.join("target")).unwrap(),
            b"keep target\n"
        );
    }

    #[test]
    fn bulk_discard_partial_lines_keep_unselected_insertions_and_deletions() {
        let repository = Repository::new();
        let original = (1..=10)
            .map(|line| format!("line {line}\n"))
            .collect::<String>();
        repository.write("forest", original.as_bytes());
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Original").unwrap();
        let changed = original
            .replace("line 2\n", "changed two\n")
            .replace("line 5\n", "")
            .replace("line 7\n", "line 7\ninserted seven\n");
        repository.write("forest", changed.as_bytes());
        let plan = prepare_partial_discard(&repository.0, "forest", 0, Some(&[0, 1])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read_to_string(repository.0.join("forest")).unwrap(),
            changed.replace("changed two\n", "line 2\n")
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read_to_string(repository.0.join("forest")).unwrap(),
            changed
        );
    }
}
