use super::submodule_deinit::{SubmoduleSetting, absolute_git_dir, index_entries, refs, settings};
use super::*;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmoduleRemoval {
    pub path: String,
    pub expected_index_oid: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleRemovalResult {
    pub path: String,
    pub name: String,
    pub recorded_oid: String,
    pub git_directory: Option<String>,
    pub kept_settings: Vec<SubmoduleSetting>,
}

pub fn remove_submodule(
    path: &Path,
    request: &SubmoduleRemoval,
) -> Result<SubmoduleRemovalResult, AppError> {
    let review = review_submodule_state(path)?;
    let entry = review
        .entries
        .iter()
        .find(|entry| entry.path == request.path)
        .ok_or_else(|| refused("The reviewed submodule path is no longer reported."))?;
    let name = entry
        .name
        .clone()
        .ok_or_else(|| refused("The submodule is not declared in .gitmodules."))?;
    if entry.conflict.is_some() {
        return Err(refused(
            "The submodule commit is conflicted. Resolve the parent conflict first.",
        ));
    }
    let recorded = entry
        .index_oid
        .clone()
        .ok_or_else(|| refused("The parent index records no commit for this submodule."))?;
    if recorded != request.expected_index_oid {
        return Err(refused(
            "The recorded submodule commit changed after the review.",
        ));
    }
    if entry.staged_change {
        return Err(refused(
            "The submodule has a staged commit change. Commit or unstage it first.",
        ));
    }
    if entry.checked_out
        && (entry.checkout_oid.as_deref() != Some(recorded.as_str())
            || entry.tracked_changes
            || entry.untracked_changes)
    {
        return Err(refused(
            "The checked-out submodule has edits, untracked files or another commit that removal would delete. Commit, push or remove them first, or check out the recorded commit.",
        ));
    }
    if !run_git(path, &["diff", "--quiet", "--", ".gitmodules"])?
        .status
        .success()
    {
        return Err(refused(
            ".gitmodules has unstaged changes. Stage or discard them first.",
        ));
    }

    let module = path.join(&entry.path);
    let git_directory = if entry.checked_out {
        Some(absolute_git_dir(&module)?)
    } else {
        let output = run_git(
            path,
            &[
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                &format!("modules/{name}"),
            ],
        )?;
        ensure_success("locate the submodule repository data", &output)?;
        Some(PathBuf::from(
            String::from_utf8_lossy(&output.stdout).trim(),
        ))
        .filter(|directory| directory.is_dir())
    };
    let refs_before = git_directory
        .as_deref()
        .map(|directory| refs(path, directory))
        .transpose()?;
    let local_before = submodule_config(path, &["--local"])?;
    let prefix = format!("submodule.{name}.");
    let (declared_before, _) = declarations(path, &prefix)?;
    let parent_head = run_git(path, &["rev-parse", "--verify", "-q", "HEAD"])?.stdout;
    let index_before = other_entries(&index_entries(path)?, &entry.path);

    run_mutation(
        path,
        &["rm", "-q", "--", &entry.path],
        "remove the submodule from the project",
    )?;

    let index_after = index_entries(path)?;
    let still_recorded = index_after
        .split(|byte| *byte == 0)
        .any(|record| record_path(record) == Some(entry.path.as_bytes()));
    if still_recorded
        || module.exists()
        || other_entries(&index_after, &entry.path) != index_before
        || declarations(path, &prefix)? != (declared_before, false)
        || submodule_config(path, &["--local"])? != local_before
        || run_git(path, &["rev-parse", "--verify", "-q", "HEAD"])?.stdout != parent_head
        || match (&git_directory, &refs_before) {
            (Some(directory), Some(before)) => refs(path, directory)? != *before,
            _ => false,
        }
    {
        return Err(AppError::new(
            "submoduleRemovalUnverified",
            "The removal finished, but its effects did not match the reviewed scope.",
            Some(
                "Inspect staged changes before committing. Restore the staged removal with git restore --staged --worktree on the submodule path and .gitmodules if needed.",
            ),
        ));
    }
    let kept_settings = settings(&local_before)
        .into_iter()
        .filter(|setting| setting.key.starts_with(&prefix))
        .collect();
    Ok(SubmoduleRemovalResult {
        path: entry.path.clone(),
        name,
        recorded_oid: recorded,
        git_directory: git_directory.map(|directory| directory.display().to_string()),
        kept_settings,
    })
}

fn submodule_config(path: &Path, scope: &[&str]) -> Result<Vec<u8>, AppError> {
    super::submodule_review::config(path, scope)
}

/// Declarations of other submodules must survive; this one's must be gone.
fn declarations(path: &Path, prefix: &str) -> Result<(Vec<SubmoduleSetting>, bool), AppError> {
    let file = path.join(".gitmodules");
    if !file.exists() {
        return Ok((Vec::new(), false));
    }
    let file = file.to_string_lossy();
    let entries = settings(&submodule_config(path, &["--file", &file])?);
    let own = entries
        .iter()
        .any(|setting| setting.key.starts_with(prefix));
    Ok((
        entries
            .into_iter()
            .filter(|setting| !setting.key.starts_with(prefix))
            .collect(),
        own,
    ))
}

fn record_path(record: &[u8]) -> Option<&[u8]> {
    record
        .iter()
        .position(|byte| *byte == b'\t')
        .map(|tab| &record[tab + 1..])
}

fn other_entries(index: &[u8], path: &str) -> Vec<Vec<u8>> {
    index
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .filter(|record| {
            let entry = record_path(record);
            entry != Some(path.as_bytes()) && entry != Some(b".gitmodules".as_slice())
        })
        .map(<[u8]>::to_vec)
        .collect()
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "submoduleRemovalRefused",
        message,
        Some("Review the submodule state again. Nothing was changed."),
    )
}
