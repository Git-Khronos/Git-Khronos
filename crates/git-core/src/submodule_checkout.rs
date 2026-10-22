use super::submodule_review::unavailable;
use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmoduleRecordedCheckout {
    pub path: String,
    pub expected_index_oid: String,
    pub expected_checkout_oid: String,
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleRecordedCheckoutResult {
    pub path: String,
    pub previous_oid: String,
    pub previous_branch: Option<String>,
    pub recorded_oid: String,
    pub recovery_reference: Option<String>,
    pub nested: Vec<SubmoduleNestedCheckout>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleNestedCheckout {
    pub path: String,
    pub previous_oid: Option<String>,
    pub recorded_oid: Option<String>,
    pub recovery_reference: Option<String>,
    pub skipped: Option<String>,
}

const MAX_DEPTH: usize = 8;
const MAX_NESTED: usize = 200;

pub fn checkout_recorded_submodule_commit(
    path: &Path,
    request: &SubmoduleRecordedCheckout,
) -> Result<SubmoduleRecordedCheckoutResult, AppError> {
    let review = review_submodule_state(path)?;
    let entry = review
        .entries
        .iter()
        .find(|entry| entry.path == request.path)
        .ok_or_else(|| refused("The reviewed submodule path is no longer reported."))?;
    if entry.conflict.is_some() {
        return Err(refused(
            "The submodule commit is conflicted. Resolve the parent conflict first.",
        ));
    }
    if !entry.checked_out {
        return Err(refused(
            "The submodule is not checked out. Initialize it instead.",
        ));
    }
    let recorded = entry
        .index_oid
        .clone()
        .ok_or_else(|| refused("The parent index records no commit for this submodule."))?;
    let previous = entry
        .checkout_oid
        .clone()
        .ok_or_else(|| refused("The submodule has no checked-out commit to protect."))?;
    if recorded != request.expected_index_oid || previous != request.expected_checkout_oid {
        return Err(refused(
            "The submodule or its recorded commit changed after the review.",
        ));
    }
    let module = path.join(&entry.path);
    if recorded == previous && !request.recursive {
        return Err(refused("The recorded commit is already checked out."));
    }
    if request.recursive {
        if let Some(dirty) = edited_path(&module, &entry.path, 0)? {
            return Err(refused(&format!(
                "{dirty} has uncommitted changes. Commit or stash them inside that submodule first."
            )));
        }
    } else if entry.tracked_changes {
        return Err(refused(
            "The submodule has uncommitted changes (possibly in nested submodules). Commit or stash them inside the submodule first.",
        ));
    }
    let mut result = SubmoduleRecordedCheckoutResult {
        path: entry.path.clone(),
        previous_oid: previous.clone(),
        previous_branch: None,
        recorded_oid: recorded.clone(),
        recovery_reference: None,
        nested: Vec::new(),
    };
    if recorded != previous {
        let (branch, reference) = checkout_one(path, &entry.path, &recorded, &previous)?;
        result.previous_branch = branch;
        result.recovery_reference = Some(reference);
    }
    if request.recursive {
        checkout_nested(&module, &entry.path, 1, &mut result.nested).map_err(|mut error| {
            if let Some(reference) = &result.recovery_reference {
                error.hint = Some(format!(
                    "{} {} already moved to its recorded commit; its previous commit is protected as {reference}.",
                    error.hint.unwrap_or_default(),
                    entry.path
                ).trim_start().to_owned());
            }
            error
        })?;
        if recorded == previous
            && result
                .nested
                .iter()
                .all(|item| item.recovery_reference.is_none())
        {
            return Err(refused(
                "The submodule and its initialized nested submodules already match their recorded commits.",
            ));
        }
    }
    Ok(result)
}

fn checkout_one(
    path: &Path,
    entry_path: &str,
    recorded: &str,
    previous: &str,
) -> Result<(Option<String>, String), AppError> {
    let module = path.join(entry_path);
    let available = run_git(
        &module,
        &["cat-file", "-e", &format!("{recorded}^{{commit}}")],
    )?;
    if !available.status.success() {
        return Err(refused(
            "The recorded commit is not available in the submodule. Fetch inside the submodule first; this action never fetches.",
        ));
    }
    let head_ref = run_git(&module, &["symbolic-ref", "-q", "HEAD"])?;
    let previous_branch = head_ref
        .status
        .success()
        .then(|| String::from_utf8_lossy(&head_ref.stdout).trim().to_owned());
    let parent_head = run_git(path, &["rev-parse", "--verify", "-q", "HEAD"])?;
    let parent_index = index_entries(path)?;
    let refs_before = module_refs(&module)?;
    let recovery_reference = preserve_reference(
        &module,
        previous,
        "Git Khronos: before checking out the recorded submodule commit",
    )?;

    run_mutation(
        path,
        &[
            "submodule",
            "update",
            "--no-fetch",
            "--checkout",
            "--",
            entry_path,
        ],
        "check out the recorded submodule commit",
    )
    .map_err(|error| with_recovery(error, &recovery_reference))?;

    let head = run_git(&module, &["rev-parse", "--verify", "-q", "HEAD^{commit}"])?;
    if String::from_utf8_lossy(&head.stdout).trim() != recorded {
        return Err(unverified(
            "The submodule did not end at the recorded commit.",
            &recovery_reference,
        ));
    }
    if module_refs(&module)? != refs_before
        || run_git(path, &["rev-parse", "--verify", "-q", "HEAD"])?.stdout != parent_head.stdout
        || index_entries(path)? != parent_index
    {
        return Err(unverified(
            "References or the parent repository changed unexpectedly.",
            &recovery_reference,
        ));
    }
    Ok((previous_branch, recovery_reference))
}

fn checkout_nested(
    module: &Path,
    prefix: &str,
    depth: usize,
    out: &mut Vec<SubmoduleNestedCheckout>,
) -> Result<(), AppError> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let review = review_submodule_state(module)?;
    for entry in review.entries {
        if out.len() >= MAX_NESTED {
            return Ok(());
        }
        let display = format!("{prefix}/{}", entry.path);
        let mut item = SubmoduleNestedCheckout {
            path: display.clone(),
            previous_oid: entry.checkout_oid.clone(),
            recorded_oid: entry.index_oid.clone(),
            recovery_reference: None,
            skipped: None,
        };
        let reason = if entry.conflict.is_some() {
            Some("conflicted")
        } else if !entry.checked_out {
            Some("not initialized")
        } else if entry.index_oid.is_none() || entry.checkout_oid.is_none() {
            Some("no recorded commit")
        } else {
            None
        };
        if let Some(reason) = reason {
            item.skipped = Some(reason.into());
            out.push(item);
            continue;
        }
        let recorded = entry.index_oid.clone().unwrap_or_default();
        let previous = entry.checkout_oid.clone().unwrap_or_default();
        if recorded != previous {
            match checkout_one(module, &entry.path, &recorded, &previous) {
                Ok((_, reference)) => item.recovery_reference = Some(reference),
                Err(error) if error.kind == "submoduleCheckoutRefused" => {
                    item.skipped = Some(error.message);
                    out.push(item);
                    continue;
                }
                Err(error) => return Err(error),
            }
        }
        let changed = item.recovery_reference.is_some();
        if changed || entry.tracked_changes {
            out.push(item);
        }
        checkout_nested(&module.join(&entry.path), &display, depth + 1, out)?;
    }
    Ok(())
}

/// Returns the first path below `module` with edits that are not nested gitlink drift.
fn edited_path(module: &Path, display: &str, depth: usize) -> Result<Option<String>, AppError> {
    if depth > MAX_DEPTH {
        return Err(refused(
            "Nested submodules are deeper than this action supports.",
        ));
    }
    let status = bounded_output(
        module,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=no",
            "--ignore-submodules=none",
        ],
        "submodule status",
    )?;
    let mut records = status
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        let text = String::from_utf8_lossy(record);
        let fields: Vec<&str> = text.splitn(9, ' ').collect();
        if fields.first() == Some(&"2") {
            records.next();
        }
        let gitlink_drift = fields.first() == Some(&"1")
            && fields.len() == 9
            && fields[1].starts_with('.')
            && fields[2].starts_with('S');
        if !gitlink_drift {
            return Ok(Some(display.to_owned()));
        }
        if fields[2].as_bytes().get(2) == Some(&b'M') {
            let nested = fields[8];
            if let Some(dirty) = edited_path(
                &module.join(nested),
                &format!("{display}/{nested}"),
                depth + 1,
            )? {
                return Ok(Some(dirty));
            }
        }
    }
    Ok(None)
}

fn index_entries(path: &Path) -> Result<Vec<u8>, AppError> {
    bounded_output(path, &["ls-files", "-z", "--stage"], "parent index")
}

fn bounded_output(path: &Path, args: &[&str], label: &str) -> Result<Vec<u8>, AppError> {
    let (output, truncated) = run_git_with_stdout_limit(path, args, 16 * 1024 * 1024)?;
    ensure_success(&format!("read the {label}"), &output)?;
    if truncated {
        return Err(unavailable(&format!(
            "The {label} exceeds the review limit."
        )));
    }
    Ok(output.stdout)
}

fn module_refs(module: &Path) -> Result<Vec<u8>, AppError> {
    let output = bounded_output(
        module,
        &["for-each-ref", "--format=%(refname) %(objectname)"],
        "submodule references",
    )?;
    Ok(output
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.starts_with(b"refs/git-khronos/recovery/"))
        .flat_map(|line| line.iter().copied().chain(*b"\n"))
        .collect())
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "submoduleCheckoutRefused",
        message,
        Some("Review the submodule state again. Nothing was changed."),
    )
}

fn with_recovery(mut error: AppError, reference: &str) -> AppError {
    error.hint = Some(format!(
        "The previous submodule commit is protected as {reference} inside the submodule. Inspect the submodule before retrying."
    ));
    error
}

fn unverified(message: &str, reference: &str) -> AppError {
    with_recovery(
        AppError::new("submoduleCheckoutUnverified", message, None),
        reference,
    )
}
