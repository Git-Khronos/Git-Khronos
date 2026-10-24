use super::submodule_review::{config, unavailable};
use super::*;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmoduleDeinit {
    pub path: String,
    pub expected_checkout_oid: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleDeinitResult {
    pub path: String,
    pub name: String,
    pub checkout_oid: String,
    pub removed_settings: Vec<SubmoduleSetting>,
    pub git_directory: String,
    pub absorbed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleSetting {
    pub key: String,
    pub value: String,
}

pub fn deinit_submodule(
    path: &Path,
    request: &SubmoduleDeinit,
) -> Result<SubmoduleDeinitResult, AppError> {
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
    if !entry.checked_out {
        return Err(refused("The submodule is not checked out."));
    }
    let checkout = entry
        .checkout_oid
        .clone()
        .ok_or_else(|| refused("The submodule has no checked-out commit."))?;
    if checkout != request.expected_checkout_oid {
        return Err(refused("The submodule commit changed after the review."));
    }
    if entry.index_oid.as_deref() != Some(checkout.as_str()) {
        return Err(refused(
            "The submodule is not at the commit recorded by the parent index. Check out the recorded commit or stage the new one first.",
        ));
    }
    if entry.tracked_changes || entry.untracked_changes {
        return Err(refused(
            "The submodule (or a nested submodule) has changes or untracked files that deinitializing would delete. Commit, stash or remove them first.",
        ));
    }

    let module = path.join(&entry.path);
    let embedded = module.join(".git").is_dir();
    let git_directory = if !embedded {
        absolute_git_dir(&module)?
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
        PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())
    };
    let refs_before = refs(path, &absolute_git_dir(&module)?)?;
    let settings_before = config(path, &["--local"])?;
    let prefix = format!("submodule.{name}.");
    let removed_settings = settings(&settings_before)
        .into_iter()
        .filter(|setting| setting.key.starts_with(&prefix))
        .collect::<Vec<_>>();
    let parent_head = run_git(path, &["rev-parse", "--verify", "-q", "HEAD"])?.stdout;
    let parent_index = index_entries(path)?;
    let gitmodules = fs::read(path.join(".gitmodules")).ok();

    run_mutation(
        path,
        &["submodule", "deinit", "--", &entry.path],
        "deinitialize the submodule",
    )?;

    let empty = fs::read_dir(&module)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false);
    let remaining = settings(&config(path, &["--local"])?);
    let others_before = settings(&settings_before)
        .into_iter()
        .filter(|setting| !setting.key.starts_with(&prefix))
        .collect::<Vec<_>>();
    if !empty
        || remaining != others_before
        || !git_directory.is_dir()
        || refs(path, &git_directory)? != refs_before
        || run_git(path, &["rev-parse", "--verify", "-q", "HEAD"])?.stdout != parent_head
        || index_entries(path)? != parent_index
        || fs::read(path.join(".gitmodules")).ok() != gitmodules
    {
        return Err(AppError::new(
            "submoduleDeinitUnverified",
            "Deinitialization finished, but its effects did not match the reviewed scope.",
            Some(&format!(
                "The submodule repository data should remain at {}. Inspect it and the local submodule configuration before continuing.",
                git_directory.display()
            )),
        ));
    }
    Ok(SubmoduleDeinitResult {
        path: entry.path.clone(),
        name,
        checkout_oid: checkout,
        removed_settings,
        git_directory: git_directory.display().to_string(),
        absorbed: embedded,
    })
}

pub(super) fn absolute_git_dir(module: &Path) -> Result<PathBuf, AppError> {
    let output = run_git(module, &["rev-parse", "--absolute-git-dir"])?;
    ensure_success("locate the submodule repository", &output)?;
    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim(),
    ))
}

pub(super) fn refs(path: &Path, git_dir: &Path) -> Result<Vec<u8>, AppError> {
    let dir = git_dir.to_string_lossy();
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        // The recorded work tree may be gone; listing references needs none.
        &[
            "--git-dir",
            &dir,
            "--work-tree",
            ".",
            "for-each-ref",
            "--format=%(refname) %(objectname)",
        ],
        16 * 1024 * 1024,
    )?;
    ensure_success("list submodule references", &output)?;
    if truncated {
        return Err(unavailable("Submodule references exceed the review limit."));
    }
    Ok(output.stdout)
}

pub(super) fn index_entries(path: &Path) -> Result<Vec<u8>, AppError> {
    let (output, truncated) =
        run_git_with_stdout_limit(path, &["ls-files", "-z", "--stage"], 16 * 1024 * 1024)?;
    ensure_success("read the parent index", &output)?;
    if truncated {
        return Err(unavailable("The parent index exceeds the review limit."));
    }
    Ok(output.stdout)
}

pub(super) fn settings(bytes: &[u8]) -> Vec<SubmoduleSetting> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let text = String::from_utf8_lossy(record);
            let (key, value) = text.split_once('\n').unwrap_or((&text, ""));
            SubmoduleSetting {
                key: key.to_owned(),
                value: value.to_owned(),
            }
        })
        .collect()
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "submoduleDeinitRefused",
        message,
        Some("Review the submodule state again. Nothing was changed."),
    )
}
