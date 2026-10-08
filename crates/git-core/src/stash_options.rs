use super::*;

#[derive(Deserialize)]
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
            validate_relative_path(
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
    let paths = options.paths.as_ref().map(|paths| {
        paths
            .iter()
            .map(|file| format!(":(literal){file}"))
            .collect::<Vec<_>>()
    });
    args.push("--");
    if let Some(paths) = &paths {
        args.extend(paths.iter().map(String::as_str));
    }
    run_mutation(path, &args, "stash the selected changes")
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
    let mut args = vec!["stash", "apply"];
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
        return Err(AppError::new("alreadyCurrentBranch", "That branch is already checked out.", None));
    }
    if read_worktrees(path, &status, false)?.iter().any(|worktree|
        !worktree.current && worktree.branch.as_deref() == Some(name)) {
        return Err(AppError::new("branchInAnotherWorktree", "That branch is checked out in another worktree.",
            Some("Open that worktree instead; current changes have not been stashed.")));
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
        return Err(AppError::new("historyOperationInProgress",
            "Finish or abort the active Git operation before restoring or switching branches.", None));
    }
    Ok(())
}
