use super::submodule_review::{config, parse_config};
use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmoduleTrackingBranchChange {
    pub path: String,
    pub expected_tracking_branch: Option<String>,
    pub tracking_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleTrackingBranchResult {
    pub path: String,
    pub name: String,
    pub previous_tracking_branch: Option<String>,
    pub tracking_branch: Option<String>,
}

pub fn set_submodule_tracking_branch(
    path: &Path,
    request: &SubmoduleTrackingBranchChange,
) -> Result<SubmoduleTrackingBranchResult, AppError> {
    let review = review_submodule_state(path)?;
    let entry = review
        .entries
        .iter()
        .find(|entry| entry.path == request.path)
        .ok_or_else(|| refused("The reviewed submodule path is no longer reported."))?;
    let name = entry
        .name
        .clone()
        .ok_or_else(|| refused("The submodule has no .gitmodules declaration to update."))?;
    if entry.tracking_branch != request.expected_tracking_branch {
        return Err(refused(
            "The tracking branch in .gitmodules changed after the review.",
        ));
    }
    if entry.tracking_branch == request.tracking_branch {
        return Err(refused("The submodule already uses that tracking branch."));
    }
    if let Some(branch) = request.tracking_branch.as_deref() {
        validate_branch(path, branch)?;
    }

    let before = parse_config(&config(path, &["--file", ".gitmodules"])?)?;
    let arguments = match request.tracking_branch.as_deref() {
        Some(branch) => vec![
            "submodule",
            "set-branch",
            "--branch",
            branch,
            "--",
            entry.path.as_str(),
        ],
        None => vec![
            "submodule",
            "set-branch",
            "--default",
            "--",
            entry.path.as_str(),
        ],
    };
    run_mutation(path, &arguments, "set the submodule tracking branch")?;

    let after = parse_config(&config(path, &["--file", ".gitmodules"])?)?;
    let actual = after
        .get(&name)
        .and_then(|values| values.get("branch"))
        .cloned();
    if actual != request.tracking_branch {
        return Err(unverified(
            "The tracking branch after the Git command does not match the requested value.",
        ));
    }
    if without_branch(before, &name) != without_branch(after, &name) {
        return Err(unverified(
            "Git changed other .gitmodules settings while setting the tracking branch.",
        ));
    }

    Ok(SubmoduleTrackingBranchResult {
        path: entry.path.clone(),
        name,
        previous_tracking_branch: entry.tracking_branch.clone(),
        tracking_branch: actual,
    })
}

fn validate_branch(path: &Path, branch: &str) -> Result<(), AppError> {
    if branch == "." {
        return Ok(());
    }
    if branch.is_empty() || branch.contains(['\0', '\n', '\r']) {
        return Err(invalid_branch());
    }
    let output = run_git(path, &["check-ref-format", "--branch", branch])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(invalid_branch())
    }
}

fn without_branch(
    mut values: super::submodule_review::ConfigValues,
    name: &str,
) -> super::submodule_review::ConfigValues {
    if let Some(entry) = values.get_mut(name) {
        entry.remove("branch");
    }
    values
}

fn invalid_branch() -> AppError {
    AppError::new(
        "invalidSubmoduleTrackingBranch",
        "Enter a valid Git branch name, or choose a predefined tracking mode.",
        None,
    )
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "submoduleTrackingBranchRefused",
        message,
        Some("Review the submodule state again. Nothing was changed."),
    )
}

fn unverified(message: &str) -> AppError {
    AppError::new(
        "submoduleTrackingBranchUnverified",
        message,
        Some(
            "Git changed .gitmodules. Inspect and restore that file before trying another tracking-branch change.",
        ),
    )
}
