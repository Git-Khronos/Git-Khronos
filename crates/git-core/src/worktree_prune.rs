use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ADMIN_ENTRIES: usize = 4096;
const MAX_ADMIN_BYTES: u64 = 512 * 1024 * 1024;
const MAX_LINK_BYTES: u64 = 16 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeRegistrationPrune {
    pub path: String,
    pub expected_oid: String,
    pub expected_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRegistrationPruneResult {
    pub recovery_references: Vec<String>,
    pub metadata_backup: String,
}

/// Removes one reviewed, missing, unlocked linked-worktree registration after
/// protecting its commits and copying its administrative metadata.
pub fn prune_worktree_registration(
    path: &Path,
    request: &WorktreeRegistrationPrune,
) -> Result<WorktreeRegistrationPruneResult, AppError> {
    if request.path.is_empty()
        || request.path.contains('\0')
        || !Path::new(&request.path).is_absolute()
    {
        return Err(refusal(
            "invalidWorktree",
            "That worktree registration path is invalid.",
        ));
    }
    validate_head(&request.expected_oid)?;
    let review = review_worktree_registrations(path)?;
    let selected = reviewed_entry(&review, request)?;
    ensure_missing(&request.path)?;
    let common = common_directory(path)?;
    let (admin, gitdir_link) = matching_admin(&common, &request.path)?;
    let manifest = admin_manifest(&admin)?;
    let protected = per_worktree_refs(&admin)?;
    let others = other_registrations(&review, &request.path);
    let refs = reference_listing(path)?;

    let mut recovery_references = Vec::new();
    let label = format!("Prune worktree registration {}", request.path);
    if !is_unborn(&request.expected_oid) {
        recovery_references.push(preserve_reference(path, &request.expected_oid, &label)?);
    }
    for oid in protected {
        recovery_references.push(preserve_reference(path, &oid, &label)?);
    }
    let backup = backup_admin(
        &common,
        &admin,
        &manifest,
        request,
        &recovery_references,
        &selected,
    )?;

    // Recheck every reviewed observation immediately before Git removes the registration.
    let current = review_worktree_registrations(path)?;
    reviewed_entry(&current, request)?;
    ensure_missing(&request.path)?;
    if other_registrations(&current, &request.path) != others
        || read_link(&admin.join("gitdir"))? != gitdir_link
        || admin_manifest(&admin)? != manifest
    {
        return Err(stale(
            "Worktree registrations changed after review. Nothing was removed; the recovery copy is retained.",
        ));
    }
    run_mutation(
        path,
        &["worktree", "remove", "--", &request.path],
        "remove the selected worktree registration",
    )
    .map_err(|error| {
        AppError::new(
            &error.kind,
            error.message,
            Some(
                "No forced removal or global prune was attempted. Recovery references and the metadata copy are retained.",
            ),
        )
    })?;
    verify_removal(path, &admin, request, &others, &refs, &recovery_references)?;
    Ok(WorktreeRegistrationPruneResult {
        recovery_references,
        metadata_backup: backup.to_string_lossy().into_owned(),
    })
}

fn reviewed_entry(
    review: &WorktreeRegistrationReview,
    request: &WorktreeRegistrationPrune,
) -> Result<WorktreeRegistration, AppError> {
    let index = review
        .registrations
        .iter()
        .position(|entry| entry.path == request.path)
        .ok_or_else(|| stale("That worktree is no longer registered with this repository."))?;
    let entry = &review.registrations[index];
    if index == 0 || entry.bare {
        return Err(refusal(
            "mainWorktree",
            "The main repository registration cannot be pruned.",
        ));
    }
    if entry.locked {
        return Err(AppError::new(
            "lockedWorktree",
            "That registration is locked and protected from pruning.",
            Some("Reconnect its storage, or explicitly unlock it first if it is truly gone."),
        ));
    }
    if !entry.prunable {
        return Err(refusal(
            "worktreeNotPrunable",
            "Git does not report that registration as prunable.",
        ));
    }
    if entry.oid.as_deref() != Some(request.expected_oid.as_str())
        || entry.branch != request.expected_branch
    {
        return Err(stale(
            "The registration's HEAD or branch changed after review.",
        ));
    }
    Ok(entry.clone())
}

fn ensure_missing(path: &str) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
        Ok(_) => Err(AppError::new(
            "worktreeSourceStillExists",
            "The registered worktree path exists.",
            Some(
                "Only registrations whose directory is gone can be pruned here. Repair a moved worktree, or reconnect storage.",
            ),
        )),
    }
}

fn common_directory(path: &Path) -> Result<PathBuf, AppError> {
    let output = run_git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    ensure_success("locate the common Git directory", &output)?;
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| io_error("The common Git directory is not UTF-8."))?;
    let common = PathBuf::from(text.strip_suffix('\n').unwrap_or(text));
    if common.join("reftable").exists() {
        return Err(AppError::new(
            "worktreePruneUnsupported",
            "Recoverable registration pruning supports file-based references only.",
            Some("Use local Git for repositories with reftable storage."),
        ));
    }
    Ok(common)
}

fn matching_admin(common: &Path, worktree: &str) -> Result<(PathBuf, String), AppError> {
    let root = common.join("worktrees");
    let expected = Path::new(worktree).join(".git");
    let mut found = None;
    let mut relative = false;
    for (count, entry) in fs::read_dir(&root).map_err(io_error)?.enumerate() {
        if count >= 1000 {
            return Err(io_error("Too many worktree registrations to inspect."));
        }
        let entry = entry.map_err(io_error)?;
        if !entry.file_type().map_err(io_error)?.is_dir() {
            continue;
        }
        let admin = entry.path();
        let Ok(link) = read_link(&admin.join("gitdir")) else {
            continue;
        };
        if !Path::new(&link).is_absolute() {
            relative = true;
        } else if Path::new(&link) == expected {
            if found.is_some() {
                return Err(io_error("More than one registration names that worktree."));
            }
            found = Some((admin, link));
        }
    }
    found.ok_or_else(|| {
        AppError::new(
            "worktreeRegistrationUnmatched",
            "The administrative metadata for that registration could not be identified exactly.",
            Some(if relative {
                "Relative registration links require local Git worktree prune."
            } else {
                "Refresh the review; use local Git if the registration links are damaged."
            }),
        )
    })
}

fn read_link(path: &Path) -> Result<String, AppError> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if !metadata.is_file() || metadata.len() > MAX_LINK_BYTES {
        return Err(io_error(
            "A registration link is not a bounded ordinary file.",
        ));
    }
    let text = fs::read_to_string(path).map_err(io_error)?;
    let text = text.strip_suffix('\n').unwrap_or(&text);
    if text.is_empty() || text.contains('\0') {
        return Err(io_error("A registration link is malformed."));
    }
    Ok(text.to_owned())
}

#[derive(Debug, PartialEq, Eq)]
struct ManifestEntry {
    relative: PathBuf,
    directory: bool,
    len: u64,
    modified: Option<SystemTime>,
}

fn admin_manifest(admin: &Path) -> Result<Vec<ManifestEntry>, AppError> {
    let mut entries = Vec::new();
    let mut total = 0u64;
    let mut pending = vec![admin.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
            if entries.len() >= MAX_ADMIN_ENTRIES {
                return Err(unsupported(
                    "The registration metadata has too many entries.",
                ));
            }
            let relative = entry
                .path()
                .strip_prefix(admin)
                .map_err(io_error)?
                .to_path_buf();
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if !metadata.is_file() {
                return Err(unsupported(
                    "The registration metadata contains a symlink or special file.",
                ));
            }
            total += metadata.len();
            if total > MAX_ADMIN_BYTES {
                return Err(unsupported("The registration metadata exceeds 512 MiB."));
            }
            entries.push(ManifestEntry {
                relative,
                directory: metadata.is_dir(),
                len: metadata.len(),
                modified: metadata.modified().ok(),
            });
        }
    }
    if entries.iter().any(|entry| {
        entry.relative == Path::new("locked") || entry.relative.starts_with("reftable")
    }) {
        return Err(unsupported(
            "The registration metadata is locked or uses unsupported reference storage.",
        ));
    }
    entries.sort_by(|left, right| left.relative.cmp(&right.relative));
    Ok(entries)
}

fn per_worktree_refs(admin: &Path) -> Result<Vec<String>, AppError> {
    let mut oids = Vec::new();
    let mut pending = vec![admin.join("refs")];
    while let Some(directory) = pending.pop() {
        let entries = match fs::read_dir(&directory) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            other => other.map_err(io_error)?,
        };
        for entry in entries {
            let entry = entry.map_err(io_error)?;
            if entry.file_type().map_err(io_error)?.is_dir() {
                pending.push(entry.path());
                continue;
            }
            let value = read_link(&entry.path())?;
            if validate_head(&value).is_err() || is_unborn(&value) {
                return Err(unsupported(
                    "A worktree-specific reference is symbolic or malformed.",
                ));
            }
            if !oids.contains(&value) {
                oids.push(value);
            }
        }
    }
    Ok(oids)
}

fn backup_admin(
    common: &Path,
    admin: &Path,
    manifest: &[ManifestEntry],
    request: &WorktreeRegistrationPrune,
    references: &[String],
    entry: &WorktreeRegistration,
) -> Result<PathBuf, AppError> {
    let parent = common.join("git-chronos-worktree-registrations");
    fs::create_dir_all(&parent).map_err(io_error)?;
    let sequence = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io_error)?
        .as_nanos();
    let name = admin
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io_error("The registration name is not UTF-8."))?;
    let backup = parent.join(format!("{sequence:020}-{}-{name}", std::process::id()));
    fs::create_dir(&backup).map_err(io_error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&backup, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
    }
    let files = backup.join("metadata");
    fs::create_dir(&files).map_err(io_error)?;
    for item in manifest {
        let target = files.join(&item.relative);
        if item.directory {
            fs::create_dir_all(&target).map_err(io_error)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        let source = admin.join(&item.relative);
        fs::copy(&source, &target).map_err(io_error)?;
        if fs::read(&source).map_err(io_error)? != fs::read(&target).map_err(io_error)? {
            return Err(io_error("The metadata copy differs from its source."));
        }
        fs::File::open(&target)
            .and_then(|file| file.sync_all())
            .map_err(io_error)?;
    }
    let description = serde_json::json!({
        "worktreePath": request.path,
        "head": entry.oid,
        "branch": entry.branch,
        "pruneReason": entry.prune_reason,
        "recoveryReferences": references,
    });
    let description = serde_json::to_vec_pretty(&description).map_err(io_error)?;
    let record = backup.join("registration.json");
    fs::write(&record, description).map_err(io_error)?;
    fs::File::open(&record)
        .and_then(|file| file.sync_all())
        .map_err(io_error)?;
    Ok(backup)
}

fn other_registrations(
    review: &WorktreeRegistrationReview,
    selected: &str,
) -> Vec<WorktreeRegistration> {
    review
        .registrations
        .iter()
        .filter(|entry| entry.path != selected)
        .cloned()
        .collect()
}

fn reference_listing(path: &Path) -> Result<Vec<u8>, AppError> {
    let output = run_git(
        path,
        &[
            "for-each-ref",
            "--format=%(objectname) %(refname)",
            "refs/heads",
            "refs/tags",
            "refs/remotes",
        ],
    )?;
    ensure_success("inspect references", &output)?;
    Ok(output.stdout)
}

fn verify_removal(
    path: &Path,
    admin: &Path,
    request: &WorktreeRegistrationPrune,
    others: &[WorktreeRegistration],
    refs: &[u8],
    recovery: &[String],
) -> Result<(), AppError> {
    let unverified = |message: &str| {
        AppError::new(
            "worktreePruneUnverified",
            format!("Git removed the registration, but {message}"),
            Some(
                "Refresh and inspect registrations and references in local Git. Recovery references and the metadata copy are retained; no rollback was attempted.",
            ),
        )
    };
    if fs::symlink_metadata(admin).is_ok() {
        return Err(unverified("its administrative directory still exists."));
    }
    let after = review_worktree_registrations(path).map_err(|error| {
        unverified(&format!(
            "the result could not be reviewed: {}",
            error.message
        ))
    })?;
    if after
        .registrations
        .iter()
        .any(|entry| entry.path == request.path)
    {
        return Err(unverified("the registration is still listed."));
    }
    if other_registrations(&after, &request.path) != others {
        return Err(unverified("another registration changed."));
    }
    if reference_listing(path)? != refs {
        return Err(unverified(
            "branch, tag or remote-tracking references changed.",
        ));
    }
    for reference in recovery {
        let output = run_git(path, &["rev-parse", "--verify", "--quiet", reference])?;
        if !output.status.success() {
            return Err(unverified("a recovery reference is missing."));
        }
    }
    Ok(())
}

fn validate_head(oid: &str) -> Result<(), AppError> {
    if matches!(oid.len(), 40 | 64)
        && oid
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(refusal("invalidCommit", "That worktree HEAD is invalid."))
    }
}

fn is_unborn(oid: &str) -> bool {
    oid.bytes().all(|byte| byte == b'0')
}

fn refusal(kind: &str, message: &str) -> AppError {
    AppError::new(
        kind,
        message,
        Some("Refresh the review and choose an eligible registration."),
    )
}

fn stale(message: &str) -> AppError {
    AppError::new(
        "staleWorktree",
        message,
        Some("Reload the registration review before retrying."),
    )
}

fn unsupported(message: &str) -> AppError {
    AppError::new(
        "worktreePruneUnsupported",
        message,
        Some("Nothing was removed. Inspect this registration with local Git."),
    )
}

fn io_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "worktreePruneUnavailable",
        format!("Could not prepare the registration removal: {error}"),
        Some("Check repository permissions and disk space. Nothing was removed by this step."),
    )
}
