use super::*;

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StashOptions {
    pub mode: String,
    pub include_untracked: bool,
    pub paths: Option<Vec<String>>,
    pub message: String,
}

pub fn stash_with_options(path: &Path, options: &StashOptions) -> Result<(), AppError> {
    let message = validate_stash_message(&options.message)?;
    let mut args = vec!["stash", "push"];
    match options.mode.as_str() {
        "all" => {}
        "keep-index" => args.push("--keep-index"),
        "staged-only" => {
            if options.include_untracked {
                return Err(AppError::new(
                    "invalidStashOptions",
                    "Staged-only stashes cannot include untracked files.",
                    None,
                ));
            }
            let version = run_git(path, &["version"])?;
            ensure_success("check Git stash capabilities", &version)?;
            let version = String::from_utf8_lossy(&version.stdout);
            let numbers = version
                .split_whitespace()
                .nth(2)
                .unwrap_or("")
                .split('.')
                .take(2)
                .map(str::parse::<u32>)
                .collect::<Result<Vec<_>, _>>();
            if !numbers
                .is_ok_and(|numbers| numbers.len() == 2 && (numbers[0], numbers[1]) >= (2, 35))
            {
                return Err(AppError::new(
                    "unsupportedStagedStash",
                    "Staged-only stash requires Git 2.35 or newer.",
                    Some("Upgrade Git or choose another stash mode."),
                ));
            }
            args.push("--staged");
        }
        _ => {
            return Err(AppError::new(
                "invalidStashOptions",
                "Choose all changes, keep staged changes, or staged-only.",
                None,
            ));
        }
    }
    let status = read_status(path)?;
    if status.conflicted > 0 {
        return Err(AppError::new(
            "conflictedStash",
            "Resolve conflicts before stashing changes.",
            None,
        ));
    }
    if let Some(paths) = &options.paths {
        if paths.is_empty() {
            return Err(AppError::new(
                "emptyStashSelection",
                "Select files to stash.",
                None,
            ));
        }
        for file in paths {
            validate_stash_path(
                file.trim_end_matches('/'),
                "invalidStashPath",
                "That stash path is invalid.",
            )?;
            if !status.entries.iter().any(|entry| {
                entry.path == *file || (file.ends_with('/') && entry.path.starts_with(file))
            }) {
                return Err(AppError::new(
                    "staleStashSelection",
                    format!("'{}' is no longer changed.", file),
                    Some("Refresh and review the selected files."),
                ));
            }
        }
    }
    let eligible = status.entries.iter().any(|entry| {
        let selected = options.paths.as_ref().is_none_or(|paths| {
            paths.iter().any(|file| {
                entry.path == *file || (file.ends_with('/') && entry.path.starts_with(file))
            })
        });
        selected
            && if entry.index_status == "?" {
                options.include_untracked
            } else if options.mode == "staged-only" {
                !matches!(entry.index_status.as_str(), " " | "!")
            } else {
                true
            }
    });
    if !eligible {
        return Err(AppError::new(
            "emptyStashSelection",
            "There are no changes matching these stash options.",
            None,
        ));
    }
    if options.include_untracked {
        args.push("--include-untracked");
    }
    if !message.is_empty() {
        args.extend(["--message", message]);
    }
    if let Some(paths) = &options.paths {
        if options.mode == "staged-only" {
            return stash_selected_index(path, &args, &status, paths);
        }
        let selection = selected_stash_paths(path, &status, paths, options.include_untracked)?;
        let scope = stash_selection_scope(path, &status, &selection)?;
        args.extend(["--pathspec-from-file=-", "--pathspec-file-nul"]);
        let output = run_git_with_input_output(path, &args, &scope)?;
        return ensure_success("stash the selected changes", &output);
    }
    args.push("--");
    run_mutation(path, &args, "stash the selected changes")
}

struct SelectedIndex {
    directory: PathBuf,
    index: PathBuf,
    lock: PathBuf,
    owns_lock: bool,
}

impl Drop for SelectedIndex {
    fn drop(&mut self) {
        if self.owns_lock {
            let _ = fs::remove_file(&self.lock);
        }
        // This directory was created exclusively for this invocation.
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn stash_selected_index(
    path: &Path,
    args: &[&str],
    reviewed: &RepositoryStatus,
    selected: &[String],
) -> Result<(), AppError> {
    let index = operation_storage::git_entry(path, "index")?;
    let metadata = operation_storage::file(&index)?
        .ok_or_else(|| AppError::new("missingIndex", "The repository index is missing.", None))?;
    let directory = index.parent().unwrap().join(format!(
        "git-khronos-stash-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let storage_error = |error| {
        AppError::new(
            "stashIndexFailed",
            format!("Could not prepare the selected stash index: {error}"),
            Some("No stash was started. Check index locks and available storage before retrying."),
        )
    };
    fs::create_dir(&directory).map_err(storage_error)?;
    let mut owned = SelectedIndex {
        directory,
        lock: index.with_extension("lock"),
        index,
        owns_lock: false,
    };
    // Reserve Git's real index lock throughout capture and publication. Other
    // Git writers cannot change the unselected entries while we preserve them.
    let mut lock = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&owned.lock)
        .map_err(storage_error)?;
    owned.owns_lock = true;
    let original = fs::read(&owned.index).map_err(storage_error)?;
    lock.write_all(&original).map_err(storage_error)?;
    lock.set_permissions(metadata.permissions())
        .map_err(storage_error)?;
    drop(lock);
    let current = read_status(path)?;
    let entries = |status: &RepositoryStatus| {
        status
            .entries
            .iter()
            .map(|entry| {
                (
                    entry.path.clone(),
                    entry.index_status.clone(),
                    entry.worktree_status.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    if entries(reviewed) != entries(&current) {
        return Err(AppError::new(
            "staleStashSelection",
            "The file selection changed before stashing.",
            Some("Refresh and review the selected files. Nothing was stashed."),
        ));
    }
    let selection = selected_stash_paths(path, &current, selected, false)?;
    let scope = stash_selection_scope(path, &current, &selection)?;
    let capture = owned.directory.join("index");
    fs::write(&capture, &original).map_err(storage_error)?;
    let capture_env = [("GIT_INDEX_FILE", capture.as_os_str())];
    // --staged ignores path filtering in its reverse patch. Give it an index
    // containing only selected staged changes, without altering the real one.
    let mut unselected = Vec::new();
    for exclusion in scope
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
    {
        unselected.extend_from_slice(b":(top,literal)");
        unselected.extend_from_slice(
            exclusion
                .strip_prefix(b":(top,exclude,literal)")
                .expect("scope contains only literal exclusions"),
        );
        unselected.push(0);
    }
    let reset = [
        "reset",
        "-q",
        "HEAD",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
    ];
    if !unselected.is_empty() {
        let output = run_git_with_input_environment(path, &reset, &unselected, &capture_env)?;
        ensure_success("prepare the selected staged changes", &output)?;
    }
    let output = run_git_with_input_environment(path, args, &[], &capture_env)?;
    ensure_success("stash the selected staged changes", &output)?;
    // Start from the untouched original index and reset only selected entries.
    let publish_env = [("GIT_INDEX_FILE", owned.lock.as_os_str())];
    let publish = (|| {
        let output = run_git_with_input_environment(path, &reset, &scope, &publish_env)?;
        ensure_success("update the selected index entries after stashing", &output)?;
        fs::rename(&owned.lock, &owned.index).map_err(storage_error)?;
        owned.owns_lock = false;
        Ok::<_, AppError>(())
    })();
    publish.map_err(|error| AppError::new(
        "stashSavedIndexUpdateFailed", error.message,
        Some("The stash was saved and working changes were rolled back, but the original index was retained. Review the latest stash and refresh before retrying.")))
}

struct StashSelection {
    paths: Vec<String>,
    origins: Vec<Vec<u8>>,
}

fn overlapping_selection() -> AppError {
    AppError::new(
        "overlappingStashSelection",
        "The selected rename overlaps another change that was not selected for stashing.",
        Some(
            "Preserve contents occupying the old path, or select all linked rename destinations and reused untracked paths. Nothing was stashed.",
        ),
    )
}

fn intersects(left: &[u8], right: &[u8]) -> bool {
    let left = left.strip_suffix(b"/").unwrap_or(left);
    let right = right.strip_suffix(b"/").unwrap_or(right);
    left == right
        || (left.starts_with(right) && left.get(right.len()) == Some(&b'/'))
        || (right.starts_with(left) && right.get(left.len()) == Some(&b'/'))
}

fn selected_path(paths: &[String], file: &[u8]) -> bool {
    paths.iter().any(|path| {
        file == path.as_bytes() || (path.ends_with('/') && file.starts_with(path.as_bytes()))
    })
}

fn validate_stash_path(value: &str, kind: &str, message: &str) -> Result<(), AppError> {
    // Stash paths are exact, NUL-framed filenames, not line-oriented input.
    // Whitespace is significant, including leading spaces and newlines.
    if !value.is_empty()
        && !value.contains('\0')
        && Path::new(value)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        Ok(())
    } else {
        Err(AppError::new(kind, message, None))
    }
}

fn selected_stash_paths(
    path: &Path,
    status: &RepositoryStatus,
    selected: &[String],
    include_untracked: bool,
) -> Result<StashSelection, AppError> {
    let mut expanded = selected.to_vec();
    if !status
        .entries
        .iter()
        .any(|entry| entry.index_status == "R" || entry.worktree_status == "R")
    {
        return Ok(StashSelection {
            paths: expanded,
            origins: Vec::new(),
        });
    }
    // Porcelain v1 -z retains rename origins as separate records, whereas the
    // public status contract intentionally exposes only the displayed path.
    let output = run_git(
        path,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignored=matching",
        ],
    )?;
    ensure_success("inspect both names of selected renames", &output)?;
    let invalid = || {
        AppError::new(
            "invalidStashPath",
            "Git returned an incomplete rename selection.",
            Some("Refresh the file list and review the selection. Nothing was stashed."),
        )
    };
    let mut records = output.stdout.split(|byte| *byte == 0);
    let mut renames = Vec::new();
    let mut ignored = Vec::new();
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        if record.len() < 4 || record[2] != b' ' {
            return Err(invalid());
        }
        if &record[..2] == b"!!" {
            ignored.push(&record[3..]);
        }
        if [record[0], record[1]]
            .iter()
            .any(|status| matches!(status, b'R' | b'C'))
        {
            let old = records
                .next()
                .filter(|record| !record.is_empty())
                .ok_or_else(invalid)?;
            if record[0] == b'R' || record[1] == b'R' {
                renames.push((old, &record[3..]));
            }
        }
    }
    for (old, new) in &renames {
        if !selected_path(selected, new) {
            continue;
        }
        let old = std::str::from_utf8(old).map_err(|_| invalid())?;
        validate_stash_path(
            old,
            "invalidStashPath",
            "The rename's original path cannot be stashed safely.",
        )?;
        // Stop at ancestor symlinks/non-directories without inspecting targets.
        // A selected tracked endpoint can legitimately replace a directory.
        let mut source = path.to_path_buf();
        for component in Path::new(old).components() {
            source.push(component);
            match fs::symlink_metadata(&source) {
                Ok(metadata) => {
                    let relative = source.strip_prefix(path).map_err(|_| invalid())?;
                    let relative = relative.to_str().ok_or_else(invalid)?;
                    let tracked = status
                        .entries
                        .iter()
                        .any(|entry| entry.path == relative && entry.index_status != "?");
                    if (metadata.is_symlink() || !metadata.is_dir()) && relative != old {
                        if tracked && selected_path(selected, relative.as_bytes()) {
                            break;
                        }
                        return Err(overlapping_selection());
                    }
                    if relative == old && !tracked {
                        let visible = status.entries.iter().any(|entry| {
                            entry.index_status == "?"
                                && intersects(entry.path.as_bytes(), old.as_bytes())
                        });
                        if !visible
                            || ignored
                                .iter()
                                .any(|entry| intersects(entry, old.as_bytes()))
                        {
                            return Err(overlapping_selection());
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                Err(_) => return Err(invalid()),
            }
        }
        // Restoring HEAD at the old name must not replace an unselected new
        // file, directory, or nested repository now occupying that name.
        for entry in status
            .entries
            .iter()
            .filter(|entry| entry.index_status == "?")
        {
            if (entry.path == old
                || entry.path.starts_with(&format!("{old}/"))
                || old.starts_with(&format!("{}/", entry.path.trim_end_matches('/'))))
                && (!include_untracked || !selected_path(selected, entry.path.as_bytes()))
            {
                return Err(overlapping_selection());
            }
        }
        if !selected_path(&expanded, old.as_bytes()) {
            expanded.push(old.to_owned());
        }
    }
    // Rename chains can share an endpoint. Do not silently select another
    // rename merely because its source is also a selected destination.
    for (old, new) in &renames {
        if expanded.iter().any(|file| intersects(file.as_bytes(), old))
            && !selected_path(selected, new)
        {
            return Err(overlapping_selection());
        }
    }
    Ok(StashSelection {
        paths: expanded,
        origins: renames.iter().map(|(old, _)| old.to_vec()).collect(),
    })
}

fn stash_selection_scope(
    path: &Path,
    status: &RepositoryStatus,
    selection: &StashSelection,
) -> Result<Vec<u8>, AppError> {
    let output = run_git(path, &["ls-files", "--cached", "-z"])?;
    ensure_success("inspect the selected stash scope", &output)?;
    let mut known: HashSet<Vec<u8>> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|file| !file.is_empty())
        .map(<[u8]>::to_vec)
        .collect();
    known.extend(
        status
            .entries
            .iter()
            .map(|entry| entry.path.as_bytes().to_vec()),
    );
    known.extend(selection.origins.iter().cloned());
    // Public status strings are display text and can replace invalid UTF-8.
    // Scope exclusions must retain the actual bytes of every unselected path,
    // including untracked files and staged deletions absent from the index.
    let raw = run_git(
        path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    ensure_success("inspect literal stash exclusions", &raw)?;
    let invalid = || {
        AppError::new(
            "invalidStashPath",
            "Git returned an incomplete stash scope.",
            Some("Refresh and review the file selection. Nothing was stashed."),
        )
    };
    if !raw.stdout.is_empty() && !raw.stdout.ends_with(&[0]) {
        return Err(invalid());
    }
    let mut records = raw.stdout.split(|byte| *byte == 0);
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        if record.len() < 4 || record[2] != b' ' {
            return Err(invalid());
        }
        known.insert(record[3..].to_vec());
        if [record[0], record[1]]
            .iter()
            .any(|status| matches!(status, b'R' | b'C'))
        {
            known.insert(
                records
                    .next()
                    .filter(|record| !record.is_empty())
                    .ok_or_else(invalid)?
                    .to_vec(),
            );
        }
    }
    let mut excluded = HashSet::new();
    for file in known {
        if selected_path(&selection.paths, &file) {
            continue;
        }
        // Excluding a parent would also exclude a selected descendant. Such a
        // file/directory transition needs the linked change selected too.
        if selection.paths.iter().any(|selected| {
            selected.as_bytes().starts_with(&file)
                && selected.as_bytes().get(file.len()) == Some(&b'/')
        }) {
            return Err(overlapping_selection());
        }
        let mut exclusion = file.clone();
        for (offset, _) in file.iter().enumerate().filter(|(_, byte)| **byte == b'/') {
            let prefix = &file[..offset];
            if !selection
                .paths
                .iter()
                .any(|selected| intersects(selected.as_bytes(), prefix))
            {
                exclusion = prefix.to_vec();
                break;
            }
        }
        excluded.insert(exclusion);
    }
    let mut excluded: Vec<_> = excluded.into_iter().collect();
    excluded.sort();
    let mut input = Vec::new();
    // Only exclusions avoid Git's validation against the current index, which
    // cannot match an explicitly named staged-deleted path. Their implicit
    // positive scope is all paths; every unselected indexed/status path and
    // rename origin above is excluded. NUL framing preserves literal names.
    for file in excluded {
        input.extend_from_slice(b":(top,exclude,literal)");
        input.extend_from_slice(&file);
        input.push(0);
    }
    Ok(input)
}

pub fn apply_stash_with_index(
    path: &Path,
    reference: &str,
    expected_oid: &str,
    restore_index: bool,
) -> Result<(), AppError> {
    validate_stash_reference(reference)?;
    validate_commit_oid(expected_oid)?;
    let current = run_git(path, &["rev-parse", "--verify", reference])?;
    ensure_success("check the stash before applying", &current)?;
    if String::from_utf8_lossy(&current.stdout).trim() != expected_oid {
        return Err(AppError::new(
            "staleStash",
            "The selected stash changed.",
            Some("Refresh the stash list before applying."),
        ));
    }
    let mut args = vec!["-c", "stash.index=false", "stash", "apply"];
    if restore_index {
        args.push("--index");
    }
    args.push(expected_oid);
    run_mutation(path, &args, "apply the stash without removing it")
}

pub fn create_branch_from_stash(
    path: &Path,
    reference: &str,
    expected_oid: &str,
    name: &str,
) -> Result<(), AppError> {
    validate_stash_reference(reference)?;
    validate_commit_oid(expected_oid)?;
    validate_branch_name(path, name)?;
    require_stash_checkout_ready(path)?;
    let status = read_status(path)?;
    if status.entry_count > 0 {
        return Err(AppError::new(
            "dirtyWorkingTree",
            "Commit or stash current changes before creating a branch from a stash.",
            None,
        ));
    }
    let current = run_git(path, &["rev-parse", "--verify", reference])?;
    ensure_success("check the stash before branching", &current)?;
    if String::from_utf8_lossy(&current.stdout).trim() != expected_oid {
        return Err(AppError::new(
            "staleStash",
            "The selected stash changed.",
            Some("Refresh the stash list."),
        ));
    }
    // Applying the immutable object keeps the original stash even on successful branch creation.
    let base = run_git(
        path,
        &["rev-parse", "--verify", &format!("{expected_oid}^1")],
    )?;
    ensure_success("read the stash base", &base)?;
    let base = String::from_utf8_lossy(&base.stdout).trim().to_owned();
    run_mutation(
        path,
        &["checkout", "--no-overwrite-ignore", "-b", name, &base],
        "create the stash recovery branch",
    )?;
    run_mutation(
        path,
        &["stash", "apply", "--index", expected_oid],
        "restore the stash on its original base",
    )
}

pub fn stash_and_checkout(
    path: &Path,
    name: &str,
    expected_head: &str,
    expected_target: &str,
    message: &str,
) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    validate_commit_oid(expected_head)?;
    validate_commit_oid(expected_target)?;
    require_stash_checkout_ready(path)?;
    let status = read_status(path)?;
    if status.branch.as_deref() == Some(name) {
        return Err(AppError::new(
            "alreadyCurrentBranch",
            "That branch is already checked out.",
            None,
        ));
    }
    if read_worktrees(path, &status, false)?
        .iter()
        .any(|worktree| !worktree.current && worktree.branch.as_deref() == Some(name))
    {
        return Err(AppError::new(
            "branchInAnotherWorktree",
            "That branch is checked out in another worktree.",
            Some("Open that worktree instead; current changes have not been stashed."),
        ));
    }
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("check the current branch before switching", &head)?;
    let target = run_git(
        path,
        &["rev-parse", "--verify", &format!("refs/heads/{name}")],
    )?;
    ensure_success("check the checkout target", &target)?;
    if String::from_utf8_lossy(&head.stdout).trim() != expected_head
        || String::from_utf8_lossy(&target.stdout).trim() != expected_target
    {
        return Err(AppError::new(
            "staleCheckout",
            "A branch moved after the checkout preview.",
            Some("Refresh and review the branches before continuing."),
        ));
    }
    stash_with_options(
        path,
        &StashOptions {
            mode: "all".into(),
            include_untracked: true,
            paths: None,
            message: message.into(),
        },
    )?;
    run_mutation(path, &["switch", "--no-overwrite-ignore", "--", name], "check out the selected branch").map_err(|error| AppError::new(
        "checkoutFailedAfterStash", error.message,
        Some("Your changes remain saved in the latest stash. Review the repository before retrying checkout.")))
}

fn require_stash_checkout_ready(path: &Path) -> Result<(), AppError> {
    let operations = repository_operation_state(path)?;
    if operations.merge || operations.rebase || operations.bisect || operations.history.is_some() {
        return Err(AppError::new(
            "historyOperationInProgress",
            "Finish or abort the active Git operation before restoring or switching branches.",
            None,
        ));
    }
    Ok(())
}
