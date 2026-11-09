use super::*;

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeMove {
    pub path: String,
    pub parent_path: String,
    pub folder: String,
    pub expected_oid: String,
    pub expected_branch: Option<String>,
}

pub fn move_worktree(path: &Path, request: &WorktreeMove) -> Result<(), AppError> {
    if request.parent_path.contains(['\0', '\n', '\r'])
        || request.folder.contains(['\0', '\n', '\r'])
    {
        return Err(AppError::new(
            "invalidWorktreeDestination",
            "Choose a destination without control characters.",
            None,
        ));
    }
    validate_commit_oid(&request.expected_oid)?;
    let selected = managed_worktree(path, &request.path)?;
    if selected.current {
        return Err(AppError::new(
            "currentWorktree",
            "The current worktree cannot be moved.",
            Some("Open another worktree first."),
        ));
    }
    if selected.locked || selected.prunable {
        return Err(AppError::new(
            "unavailableWorktree",
            "That worktree is locked or missing.",
            Some("Unlock or repair it explicitly before moving it."),
        ));
    }
    if selected.oid != request.expected_oid || selected.branch != request.expected_branch {
        return Err(AppError::new(
            "staleWorktree",
            "The selected worktree's HEAD or branch changed.",
            Some("Close this dialog, refresh and review the worktree again."),
        ));
    }
    let marker =
        fs::symlink_metadata(Path::new(&request.path).join(".git")).map_err(move_io_error)?;
    if !marker.is_file() || marker.file_type().is_symlink() {
        return Err(AppError::new(
            "mainWorktree",
            "Only linked worktrees can be moved here.",
            Some("The main repository directory is not a linked worktree."),
        ));
    }
    let parent = Path::new(&request.parent_path);
    validate_parent_directory(parent)?;
    validate_folder_name(&request.folder)?;
    let parent = fs::canonicalize(parent).map_err(move_io_error)?;
    let source = fs::canonicalize(&request.path).map_err(move_io_error)?;
    if parent.starts_with(&source) {
        return Err(AppError::new(
            "invalidWorktreeDestination",
            "A worktree cannot move into itself.",
            Some("Choose a parent outside the source worktree."),
        ));
    }
    let destination = parent.join(&request.folder);
    match fs::symlink_metadata(&destination) {
        Ok(_) => {
            return Err(AppError::new(
                "destinationExists",
                "That destination already exists.",
                Some(
                    "Choose an unused folder name; existing directories and files are not overwritten.",
                ),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(move_io_error(error)),
    }
    let destination = destination
        .to_str()
        .ok_or_else(|| move_io_error("Destination must be UTF-8."))?;
    run_mutation(path, &["worktree", "move", "--", &request.path, destination], "move the linked worktree")
        .map_err(|error| AppError::new(&error.kind, error.message,
            Some("No forced move or rollback was attempted. Refresh and inspect both paths; Git refuses unsupported moves, including worktrees containing submodules.")))
}

fn move_io_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "worktreeMoveUnavailable",
        format!("Could not inspect the worktree move: {error}"),
        Some("Check the source/destination paths and permissions, then retry."),
    )
}

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeRepair {
    pub path: String,
    pub actual_path: String,
    pub expected_oid: String,
    pub expected_branch: Option<String>,
}

pub fn repair_worktree(path: &Path, request: &WorktreeRepair) -> Result<(), AppError> {
    validate_commit_oid(&request.expected_oid)?;
    if request.actual_path.is_empty() || request.actual_path.contains(['\0', '\n', '\r']) {
        return Err(AppError::new(
            "invalidWorktreeDestination",
            "Choose the existing moved worktree directory.",
            None,
        ));
    }
    let selected = managed_worktree(path, &request.path)?;
    if selected.current || selected.locked {
        return Err(AppError::new(
            "unavailableWorktree",
            "The selected worktree is current or locked.",
            Some("Open another worktree or explicitly unlock this registration before repairing."),
        ));
    }
    if selected.oid != request.expected_oid || selected.branch != request.expected_branch {
        return Err(AppError::new(
            "staleWorktree",
            "The selected worktree's HEAD or branch changed.",
            Some("Refresh and review the worktree before repairing its registration."),
        ));
    }
    match fs::symlink_metadata(&request.path) {
        Ok(_) => {
            return Err(AppError::new(
                "worktreeSourceStillExists",
                "The registered source path still exists.",
                Some(
                    "This workflow repairs an externally moved worktree. Do not use it to register a copy.",
                ),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(repair_io_error(error)),
    }
    let actual = Path::new(&request.actual_path);
    let metadata = fs::symlink_metadata(actual).map_err(repair_io_error)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(repair_io_error(
            "The actual path must be an ordinary directory, not a symlink.",
        ));
    }
    let actual = fs::canonicalize(actual).map_err(repair_io_error)?;
    let marker = read_repair_link(&actual.join(".git"))?;
    let gitdir = marker
        .strip_prefix("gitdir: ")
        .ok_or_else(|| repair_io_error("The selected directory is not a linked worktree."))?;
    let gitdir = fs::canonicalize(actual.join(gitdir)).map_err(repair_io_error)?;
    let root = run_git(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "worktrees",
        ],
    )?;
    ensure_success("locate worktree registrations", &root)?;
    let root = fs::canonicalize(Path::new(String::from_utf8_lossy(&root.stdout).trim()))
        .map_err(repair_io_error)?;
    if gitdir.parent() != Some(root.as_path()) {
        return Err(AppError::new(
            "unrelatedWorktree",
            "That directory belongs to another repository or registration.",
            Some("Choose the directory moved from the selected source path."),
        ));
    }
    let common = read_repair_link(&gitdir.join("commondir"))?;
    if fs::canonicalize(gitdir.join(common)).map_err(repair_io_error)?
        != root
            .parent()
            .ok_or_else(|| repair_io_error("The common Git directory is unavailable."))?
    {
        return Err(repair_io_error(
            "The selected registration points to a different common repository.",
        ));
    }
    let backlink = read_repair_link(&gitdir.join("gitdir"))?;
    let backlink = PathBuf::from(backlink);
    if !backlink.is_absolute() || backlink != Path::new(&request.path).join(".git") {
        return Err(AppError::new(
            "unrelatedWorktree",
            "That directory does not belong to the selected missing worktree.",
            Some(
                "Choose its actual directory. Relative registration links require local Git repair.",
            ),
        ));
    }
    let index = run_git(&actual, &["ls-files", "--stage", "-z"])?;
    ensure_success("inspect moved worktree index", &index)?;
    if index
        .stdout
        .split(|byte| *byte == 0)
        .any(|entry| entry.starts_with(b"160000 "))
    {
        return Err(AppError::new(
            "submoduleWorktreeRepairUnsupported",
            "This moved worktree contains submodule index entries.",
            Some(
                "Repair the superproject and nested submodule links using local Git. This workflow does not rewrite submodule links.",
            ),
        ));
    }
    check_other_registration_links(&root, &gitdir)?;
    // Recheck registration immediately before Git changes the links.
    let current = managed_worktree(path, &request.path)?;
    if current.locked
        || current.oid != request.expected_oid
        || current.branch != request.expected_branch
    {
        return Err(AppError::new(
            "staleWorktree",
            "The worktree registration changed during review.",
            Some("Refresh and retry."),
        ));
    }
    if read_repair_link(&actual.join(".git"))? != marker
        || Path::new(&read_repair_link(&gitdir.join("gitdir"))?) != backlink
    {
        return Err(AppError::new(
            "staleWorktree",
            "The Git links changed during review.",
            Some("Refresh and retry."),
        ));
    }
    match fs::symlink_metadata(&request.path) {
        Ok(_) => {
            return Err(AppError::new(
                "staleWorktree",
                "The old worktree path reappeared during review.",
                Some("Refresh and retry."),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(repair_io_error(error)),
    }
    let actual_text = actual
        .to_str()
        .ok_or_else(|| repair_io_error("The path must be UTF-8."))?;
    run_mutation(path, &["worktree", "repair", "--", actual_text], "repair the selected moved worktree")
        .map_err(|error| AppError::new(&error.kind, error.message,
            Some("No rollback or registration pruning was attempted. Refresh and inspect the actual links before retrying.")))?;
    let repaired = managed_worktree(path, actual_text).map_err(|error| AppError::new(
        "worktreeRepairUnverified", format!("Git repair returned, but registration could not be verified: {}", error.message),
        Some("Links may have changed. Refresh and inspect them in local Git; no rollback was attempted.")))?;
    let resulting_link = read_repair_link(&gitdir.join("gitdir")).map_err(|error|
        AppError::new("worktreeRepairUnverified",
            format!("Git repair returned, but its link could not be read: {}", error.message),
            Some("Links may have changed. Refresh and inspect them in local Git; no rollback was attempted.")))?;
    if repaired.oid != request.expected_oid
        || repaired.branch != request.expected_branch
        || resulting_link != actual.join(".git").to_string_lossy()
    {
        return Err(AppError::new(
            "worktreeRepairUnverified",
            "Git repair returned, but the resulting registration differs from the reviewed worktree.",
            Some("Refresh and inspect actual links and HEAD; no rollback was attempted."),
        ));
    }
    Ok(())
}

fn read_repair_link(path: &Path) -> Result<String, AppError> {
    let metadata = fs::symlink_metadata(path).map_err(repair_io_error)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 16 * 1024 {
        return Err(repair_io_error(
            "The Git link is not a bounded ordinary file.",
        ));
    }
    let text = fs::read_to_string(path).map_err(repair_io_error)?;
    let text = text.trim_end_matches(['\n', '\r']);
    if text.is_empty() || text.contains(['\0', '\n', '\r']) {
        return Err(repair_io_error("The Git link is malformed."));
    }
    Ok(text.to_owned())
}

fn check_other_registration_links(root: &Path, selected: &Path) -> Result<(), AppError> {
    let check = || -> Result<(), AppError> {
        for entry in fs::read_dir(root).map_err(repair_io_error)? {
            let entry = entry.map_err(repair_io_error)?;
            let admin = entry.path();
            if admin == selected {
                continue;
            }
            if !entry.file_type().map_err(repair_io_error)?.is_dir() {
                return Err(repair_io_error(
                    "Another registration is not an ordinary directory.",
                ));
            }
            let backlink = PathBuf::from(read_repair_link(&admin.join("gitdir"))?);
            if !backlink.is_absolute() {
                return Err(repair_io_error("Another registration uses relative links."));
            }
            let worktree = backlink
                .parent()
                .ok_or_else(|| repair_io_error("Another registration has an invalid directory."))?;
            match fs::symlink_metadata(worktree) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(repair_io_error(error)),
                Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
                Ok(_) => {
                    return Err(repair_io_error(
                        "Another worktree path is not an ordinary directory.",
                    ));
                }
            }
            let marker = read_repair_link(&backlink)?;
            let target = marker
                .strip_prefix("gitdir: ")
                .ok_or_else(|| repair_io_error("Another worktree has a malformed Git link."))?;
            if fs::canonicalize(worktree.join(target)).map_err(repair_io_error)?
                != fs::canonicalize(&admin).map_err(repair_io_error)?
            {
                return Err(repair_io_error(
                    "Another worktree's Git link points to a different registration.",
                ));
            }
            let common = read_repair_link(&admin.join("commondir"))?;
            if fs::canonicalize(admin.join(common)).map_err(repair_io_error)?
                != root
                    .parent()
                    .ok_or_else(|| repair_io_error("The common Git directory is unavailable."))?
            {
                return Err(repair_io_error(
                    "Another registration has an inconsistent common directory.",
                ));
            }
        }
        Ok(())
    };
    check().map_err(|error| AppError::new("otherWorktreeNeedsRepair",
        format!("Scoped repair refused because another worktree's links cannot be verified: {}", error.message),
        Some("Review and repair the affected registrations with local Git. Git repair may otherwise change their links too.")))
}

fn repair_io_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "worktreeRepairUnavailable",
        format!("Could not verify the moved worktree: {error}"),
        Some(
            "Choose its existing directory and check the Git links and permissions. No links were intentionally rewritten before validation.",
        ),
    )
}
