use super::*;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

const RECOVERY_NAMESPACE: &str = "refs/git-khronos/recovery/";
const MAX_RECORD_BYTES: u64 = 64 * 1024;

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResetPreview {
    pub head_oid: String,
    pub target_oid: String,
    pub mode: String,
    pub paths: Vec<String>,
}

pub struct ResetPlan {
    pub preview: ResetPreview,
    state: OperationState,
}

#[derive(PartialEq, Eq)]
struct OperationState {
    head: String,
    reference: Vec<u8>,
    index: Vec<u8>,
    worktree: Vec<u8>,
    status: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationRecovery {
    pub id: String,
    pub label: String,
    pub head_oid: String,
    pub snapshot_oid: Option<String>,
    pub head_reference: String,
    pub snapshot_reference: Option<String>,
    pub restored: bool,
}

fn current_state(path: &Path) -> Result<OperationState, AppError> {
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("read HEAD for the operation preview", &head)?;
    let reference = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    if !reference.status.success() && reference.status.code() != Some(1) {
        return Err(AppError::git_failure("read the current branch", &reference));
    }
    let index = run_git(path, &["ls-files", "--stage", "-z"])?;
    ensure_success("inspect the index for the operation preview", &index)?;
    let worktree = run_git(
        path,
        &[
            "diff",
            "--binary",
            "--full-index",
            "--no-renames",
            "--ignore-submodules=all",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
        ],
    )?;
    ensure_success(
        "inspect working changes for the operation preview",
        &worktree,
    )?;
    let status = run_git(
        path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    ensure_success("inspect working state for the operation preview", &status)?;
    Ok(OperationState {
        head: String::from_utf8_lossy(&head.stdout).trim().to_owned(),
        reference: reference.stdout,
        index: index.stdout,
        worktree: worktree.stdout,
        status: status.stdout,
    })
}

fn require_idle(path: &Path) -> Result<(), AppError> {
    let operations = repository_operation_state(path)?;
    if operations.merge || operations.rebase || operations.bisect || operations.history.is_some() {
        return Err(AppError::new(
            "historyOperationInProgress",
            "Finish or abort the active Git operation before resetting or recovering history.",
            None,
        ));
    }
    let flags = run_git(path, &["ls-files", "-v", "-z"])?;
    ensure_success("check tracked-file visibility before recovery", &flags)?;
    if flags
        .stdout
        .split(|byte| *byte == 0)
        .any(|record| record.first().is_some_and(u8::is_ascii_lowercase))
    {
        return Err(AppError::new(
            "hiddenIndexChanges",
            "Assume-unchanged index entries prevent a complete tracked-content capture.",
            Some(
                "Clear assume-unchanged flags and review working changes before resetting or restoring history.",
            ),
        ));
    }
    if read_status(path)?.conflicted > 0 {
        return Err(AppError::new(
            "unresolvedConflicts",
            "Resolve the unmerged index before resetting or restoring history.",
            Some("Conflict stages cannot be saved as an ordinary tracked-content snapshot."),
        ));
    }
    Ok(())
}

fn obstruction(file: &Path) -> AppError {
    AppError::new(
        "resetPathObstruction",
        format!(
            "Reset would overwrite or remove local contents at '{}'.",
            file.display()
        ),
        Some(
            "Move or explicitly stash obstructing files first. Untracked files, ignored files and nested repositories are not backed up by reset.",
        ),
    )
}

fn reject_obstructing_files(path: &Path, target: &str) -> Result<(), AppError> {
    let tracked = run_git(path, &["ls-files", "--stage", "-z"])?;
    ensure_success("inspect tracked paths before resetting", &tracked)?;
    let tracked = tracked
        .stdout
        .split(|byte| *byte == 0)
        .filter_map(|record| {
            let mut fields = record.splitn(2, |byte| *byte == b'\t');
            let header = fields.next()?;
            let file = fields.next()?;
            Some((file, header.starts_with(b"160000 ")))
        })
        .collect::<HashMap<_, _>>();
    let files = run_git(path, &["ls-tree", "-r", "-z", target])?;
    ensure_success("inspect reset destination paths", &files)?;
    let mut target_gitlinks = HashSet::new();
    for record in files
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let mut fields = record.splitn(2, |byte| *byte == b'\t');
        let header = fields.next().unwrap_or_default();
        let bytes = fields.next().ok_or_else(|| {
            AppError::new(
                "invalidTreeOutput",
                "Git returned an invalid destination tree.",
                None,
            )
        })?;
        let gitlink = header.starts_with(b"160000 ");
        if gitlink {
            target_gitlinks.insert(bytes);
        }
        let file = std::str::from_utf8(bytes).map_err(|_| {
            AppError::new(
                "unsupportedPathEncoding",
                "Reset safety checks require UTF-8 paths.",
                None,
            )
        })?;
        if !Path::new(file)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        {
            return Err(obstruction(Path::new(file)));
        }
        let mut candidate = PathBuf::new();
        for component in Path::new(file).components() {
            candidate.push(component);
            let final_path = candidate == Path::new(file);
            let key = candidate
                .to_str()
                .ok_or_else(|| {
                    AppError::new(
                        "unsupportedPathEncoding",
                        "Reset safety checks require UTF-8 paths.",
                        None,
                    )
                })?
                .as_bytes();
            let absolute = path.join(&candidate);
            match fs::symlink_metadata(&absolute) {
                Ok(metadata) => {
                    let retained_gitlink = final_path && gitlink && tracked.get(key) == Some(&true);
                    if retained_gitlink && metadata.is_dir() {
                        continue;
                    }
                    if (final_path && !tracked.contains_key(key))
                        || (metadata.is_symlink() && !final_path)
                        || (metadata.is_file() && !final_path && !tracked.contains_key(key))
                        || (final_path && metadata.is_dir())
                        || (!final_path && absolute.join(".git").exists())
                    {
                        return Err(obstruction(&candidate));
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                    ) => {}
                Err(error) => return Err(discard::io_error(error)),
            }
        }
    }
    // Git's non-recursive reset must not remove an initialized gitlink while changing its type.
    for (file, gitlink) in tracked {
        if gitlink && !target_gitlinks.contains(file) {
            let file = std::str::from_utf8(file).map_err(|_| {
                AppError::new(
                    "unsupportedPathEncoding",
                    "Reset safety checks require UTF-8 paths.",
                    None,
                )
            })?;
            if path.join(file).exists() {
                return Err(obstruction(Path::new(file)));
            }
        }
    }
    Ok(())
}

pub fn prepare_reset(path: &Path, target: &str, mode: &str) -> Result<ResetPlan, AppError> {
    validate_commit_oid(target)?;
    if !matches!(mode, "soft" | "mixed" | "hard") {
        return Err(AppError::new(
            "invalidResetMode",
            "Choose soft, mixed or hard reset.",
            None,
        ));
    }
    require_idle(path)?;
    let target_commit = run_git(
        path,
        &["rev-parse", "--verify", &format!("{target}^{{commit}}")],
    )?;
    ensure_success("check the reset destination commit", &target_commit)?;
    let target = String::from_utf8_lossy(&target_commit.stdout)
        .trim()
        .to_owned();
    if mode == "hard" {
        reject_obstructing_files(path, &target)?;
    }
    let state = current_state(path)?;
    let mut paths = HashSet::new();
    if mode != "soft" {
        for cached in [true, false] {
            if mode == "mixed" && !cached {
                continue;
            }
            let mut args = vec![
                "diff",
                "--no-renames",
                "--no-ext-diff",
                "--no-textconv",
                "--ignore-submodules=all",
                "--name-only",
                "-z",
            ];
            if cached {
                args.push("--cached");
            }
            args.extend([&target, "--"]);
            let output = run_git(path, &args)?;
            ensure_success("inspect the reset scope", &output)?;
            for file in output
                .stdout
                .split(|byte| *byte == 0)
                .filter(|file| !file.is_empty())
            {
                paths.insert(String::from_utf8(file.to_vec()).map_err(|_| {
                    AppError::new(
                        "unsupportedPathEncoding",
                        "Reset previews require UTF-8 paths.",
                        None,
                    )
                })?);
            }
        }
    }
    let mut paths = paths.into_iter().collect::<Vec<_>>();
    paths.sort();
    Ok(ResetPlan {
        preview: ResetPreview {
            head_oid: state.head.clone(),
            target_oid: target,
            mode: mode.into(),
            paths,
        },
        state,
    })
}

fn timestamp() -> Result<u128, AppError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_nanos())
        .map_err(|_| AppError::new("invalidSystemClock", "The system clock is invalid.", None))
}

fn record_path(path: &Path, id: &str) -> Result<PathBuf, AppError> {
    if id.is_empty()
        || id.len() > 80
        || !id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-')
    {
        return Err(AppError::new(
            "invalidRecovery",
            "That recovery identifier is invalid.",
            None,
        ));
    }
    Ok(discard::recovery_directory(path)?.join(format!("{id}.json")))
}

fn sync_directory(directory: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    fs::File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(discard::io_error)?;
    #[cfg(not(unix))]
    let _ = directory;
    Ok(())
}

fn write_record(path: &Path, record: &OperationRecovery) -> Result<(), AppError> {
    let destination = record_path(path, &record.id)?;
    let directory = destination.parent().ok_or_else(|| {
        AppError::new(
            "invalidRecoveryPath",
            "The recovery directory is unavailable.",
            None,
        )
    })?;
    fs::create_dir_all(directory).map_err(discard::io_error)?;
    if fs::symlink_metadata(directory)
        .map_err(discard::io_error)?
        .is_symlink()
    {
        return Err(AppError::new(
            "invalidRecoveryPath",
            "The recovery directory must not be a symbolic link.",
            None,
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(discard::io_error)?;
    }
    let pending = destination.with_extension(format!("json.{}.pending", timestamp()?));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let data = serde_json::to_vec(record).map_err(|error| {
        AppError::new(
            "recoveryMetadataFailed",
            format!("Could not serialize recovery: {error}"),
            None,
        )
    })?;
    let mut file = options.open(&pending).map_err(discard::io_error)?;
    file.write_all(&data)
        .and_then(|_| file.sync_all())
        .map_err(discard::io_error)?;
    drop(file);
    fs::rename(&pending, &destination).map_err(discard::io_error)?;
    sync_directory(directory)
}

fn preserve_state(
    path: &Path,
    label: &str,
    state: &OperationState,
) -> Result<OperationRecovery, AppError> {
    if label.is_empty() || label.len() > 4096 || label.contains('\0') {
        return Err(AppError::new(
            "invalidRecoveryLabel",
            "The operation recovery label is invalid.",
            None,
        ));
    }
    let capture = run_git(path, &["stash", "create", label])?;
    ensure_success(
        "capture staged and working changes before changing history",
        &capture,
    )?;
    let snapshot = String::from_utf8_lossy(&capture.stdout).trim().to_owned();
    let snapshot_oid = (!snapshot.is_empty()).then_some(snapshot);
    if let Some(oid) = &snapshot_oid {
        validate_commit_oid(oid)?;
        let base = run_git(path, &["rev-parse", "--verify", &format!("{oid}^1")])?;
        ensure_success("verify the captured history base", &base)?;
        if String::from_utf8_lossy(&base.stdout).trim() != state.head {
            return Err(stale_reset());
        }
    }
    verify_capture_contents(path, snapshot_oid.as_deref(), state)?;
    let id = format!("{:020}-{}", timestamp()?, std::process::id());
    let head_reference = format!("{RECOVERY_NAMESPACE}{id}-head");
    let snapshot_reference = snapshot_oid
        .as_ref()
        .map(|_| format!("{RECOVERY_NAMESPACE}{id}-changes"));
    let mut transaction = format!("start\ncreate {head_reference} {}\n", state.head);
    if let (Some(reference), Some(oid)) = (&snapshot_reference, &snapshot_oid) {
        transaction.push_str(&format!("create {reference} {oid}\n"));
    }
    transaction.push_str("prepare\ncommit\n");
    run_git_with_input(
        path,
        &["update-ref", "--no-deref", "--stdin"],
        transaction.as_bytes(),
        "protect operation recovery",
    )?;
    let record = OperationRecovery {
        id,
        label: label.into(),
        head_oid: state.head.clone(),
        snapshot_oid,
        head_reference,
        snapshot_reference,
        restored: false,
    };
    write_record(path, &record).map_err(|error| AppError::new("recoveryCaptureIncomplete",
        format!("Reset was not started. Could not persist its recovery record: {}", error.message),
        Some(&format!("The original history remains protected at {}. Fix recovery storage before retrying.", record.head_reference))))?;
    Ok(record)
}

fn verify_capture_contents(
    path: &Path,
    snapshot: Option<&str>,
    state: &OperationState,
) -> Result<(), AppError> {
    let index_revision = snapshot
        .map(|oid| format!("{oid}^2"))
        .unwrap_or_else(|| state.head.clone());
    let index_tree = run_git(path, &["ls-tree", "-r", "-z", &index_revision])?;
    ensure_success("verify the captured index", &index_tree)?;
    let mut index = Vec::new();
    for record in index_tree
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let mut fields = record.splitn(2, |byte| *byte == b'\t');
        let header = fields.next().unwrap_or_default();
        let file = fields.next().ok_or_else(|| {
            AppError::new(
                "invalidTreeOutput",
                "Git returned an invalid captured index tree.",
                None,
            )
        })?;
        let mut header = header.split(|byte| *byte == b' ');
        let mode = header.next().unwrap_or_default();
        let _object_type = header.next();
        let oid = header.next().unwrap_or_default();
        index.extend_from_slice(mode);
        index.push(b' ');
        index.extend_from_slice(oid);
        index.extend_from_slice(b" 0\t");
        index.extend_from_slice(file);
        index.push(0);
    }
    let worktree = if let Some(snapshot) = snapshot {
        let output = run_git(
            path,
            &[
                "diff",
                "--binary",
                "--full-index",
                "--no-renames",
                "--ignore-submodules=all",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                &index_revision,
                snapshot,
                "--",
            ],
        )?;
        ensure_success("verify captured working contents", &output)?;
        output.stdout
    } else {
        Vec::new()
    };
    if index != state.index || worktree != state.worktree {
        return Err(AppError::new(
            "recoveryCaptureMismatch",
            "The captured index or working contents did not match the preview.",
            Some("Nothing was reset. Refresh and review the repository before retrying."),
        ));
    }
    Ok(())
}

pub fn preserve_operation(path: &Path, label: &str) -> Result<OperationRecovery, AppError> {
    require_idle(path)?;
    let state = current_state(path)?;
    let record = preserve_state(path, label, &state)?;
    if current_state(path)? != state {
        return Err(stale_reset());
    }
    Ok(record)
}

/// Protects an existing commit (and optionally a stash-shaped snapshot whose
/// first parent is that commit) before an operation removes its last reference.
pub(crate) fn preserve_commits(
    path: &Path,
    label: &str,
    head_oid: &str,
    snapshot_oid: Option<&str>,
) -> Result<OperationRecovery, AppError> {
    preserve_commits_inner(path, label, head_oid, snapshot_oid, None)
}

pub(crate) fn preserve_commits_cancellable(
    path: &Path,
    label: &str,
    head_oid: &str,
    cancellation: &CancellationToken,
) -> Result<OperationRecovery, AppError> {
    preserve_commits_inner(path, label, head_oid, None, Some(cancellation))
}

fn preserve_commits_inner(
    path: &Path,
    label: &str,
    head_oid: &str,
    snapshot_oid: Option<&str>,
    cancellation: Option<&CancellationToken>,
) -> Result<OperationRecovery, AppError> {
    if cancellation.is_some_and(CancellationToken::is_cancelled) {
        return Err(operation_cancelled());
    }
    if label.is_empty() || label.len() > 4096 || label.contains('\0') {
        return Err(AppError::new(
            "invalidRecoveryLabel",
            "The operation recovery label is invalid.",
            None,
        ));
    }
    validate_commit_oid(head_oid)?;
    if let Some(oid) = snapshot_oid {
        validate_commit_oid(oid)?;
        let base = run_git(path, &["rev-parse", "--verify", &format!("{oid}^1")])?;
        ensure_success("verify the saved changes base", &base)?;
        if String::from_utf8_lossy(&base.stdout).trim() != head_oid {
            return Err(AppError::new(
                "invalidRecoveryMetadata",
                "The saved changes do not belong to the saved history.",
                None,
            ));
        }
    }
    let id = format!("{:020}-{}", timestamp()?, std::process::id());
    let head_reference = format!("{RECOVERY_NAMESPACE}{id}-head");
    let snapshot_reference = snapshot_oid.map(|_| format!("{RECOVERY_NAMESPACE}{id}-changes"));
    let mut transaction = format!("start\ncreate {head_reference} {head_oid}\n");
    if let (Some(reference), Some(oid)) = (&snapshot_reference, snapshot_oid) {
        transaction.push_str(&format!("create {reference} {oid}\n"));
    }
    transaction.push_str("prepare\ncommit\n");
    let result = git_cancellation::with(cancellation, || {
        run_git_with_input(
            path,
            &["update-ref", "--no-deref", "--stdin"],
            transaction.as_bytes(),
            "protect operation recovery",
        )
    });
    if let Err(error) = &result {
        // A reference-transaction hook can fail or be canceled after commit.
        // Reconcile outside the canceled scope and persist a discoverable
        // recovery record whenever the exact protected refs were applied.
        let tip = run_git(path, &["show-ref", "--verify", "--hash", &head_reference])?;
        if !tip.status.success() || String::from_utf8_lossy(&tip.stdout).trim() != head_oid {
            return Err(error.clone());
        }
        if let (Some(reference), Some(oid)) = (&snapshot_reference, snapshot_oid) {
            let tip = run_git(path, &["show-ref", "--verify", "--hash", reference])?;
            if !tip.status.success() || String::from_utf8_lossy(&tip.stdout).trim() != oid {
                return Err(error.clone());
            }
        }
    }
    let record = OperationRecovery {
        id,
        label: label.into(),
        head_oid: head_oid.into(),
        snapshot_oid: snapshot_oid.map(Into::into),
        head_reference,
        snapshot_reference,
        restored: false,
    };
    write_record(path, &record).map_err(|error| {
        AppError::new(
            "recoveryCaptureIncomplete",
            format!(
                "The operation was not started. Could not persist its recovery record: {}",
                error.message
            ),
            Some(&format!(
                "The saved history remains protected at {}. Fix recovery storage before retrying.",
                record.head_reference
            )),
        )
    })?;
    if let Err(error) = result {
        return Err(AppError::new(
            "recoveryCaptureStopped",
            format!(
                "Recovery refs were verified and their record was saved, but Git stopped: {}",
                error.message
            ),
            Some(&format!(
                "The operation was not started. Inspect the saved capture at {} before retrying.",
                record.head_reference
            )),
        ));
    }
    Ok(record)
}

/// Runs `operation` after a capture exists. When Git refuses and `unchanged`
/// confirms the original reference still holds the data, the unused capture is
/// removed; otherwise it is retained because the operation may be partial.
pub(crate) fn with_commit_recovery<T>(
    path: &Path,
    record: OperationRecovery,
    operation: impl FnOnce() -> Result<T, AppError>,
    unchanged: impl FnOnce() -> bool,
) -> Result<T, AppError> {
    match operation() {
        Ok(value) => Ok(value),
        Err(error) => {
            if unchanged() {
                let _ = delete_operation_recovery(path, &record.id);
            }
            Err(error)
        }
    }
}

fn stale_reset() -> AppError {
    AppError::new(
        "staleReset",
        "The branch, index or working state changed after the reset preview.",
        Some(
            "Nothing was reset. Review a new preview. Any completed recovery capture is retained.",
        ),
    )
}

pub fn execute_reset(path: &Path, plan: &ResetPlan) -> Result<OperationRecovery, AppError> {
    let current = prepare_reset(path, &plan.preview.target_oid, &plan.preview.mode)?;
    if current.state != plan.state {
        return Err(stale_reset());
    }
    let recovery = preserve_state(
        path,
        &format!("{} reset to {}", plan.preview.mode, plan.preview.target_oid),
        &current.state,
    )?;
    // Capture can be slow. Recheck both tracked state and untracked/ignored obstructions before reset.
    let latest = prepare_reset(path, &plan.preview.target_oid, &plan.preview.mode)?;
    if latest.state != plan.state {
        return Err(stale_reset());
    }
    let option = format!("--{}", plan.preview.mode);
    run_mutation(path, &["reset", "--no-recurse-submodules", &option, &plan.preview.target_oid], "reset to the selected commit")
        .map_err(|error| AppError::new("resetFailedWithRecovery", error.message,
            Some("Reset may have partial effects. The saved original history and tracked changes remain in operation recovery.")))?;
    Ok(recovery)
}

fn read_record(path: &Path, id: &str) -> Result<OperationRecovery, AppError> {
    let filename = record_path(path, id)?;
    let metadata = fs::symlink_metadata(&filename).map_err(discard::io_error)?;
    if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES {
        return Err(AppError::new(
            "invalidRecoveryMetadata",
            "The recovery record is not a bounded regular file.",
            None,
        ));
    }
    let mut data = Vec::new();
    fs::File::open(&filename)
        .map_err(discard::io_error)?
        .take(MAX_RECORD_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(discard::io_error)?;
    if data.len() as u64 > MAX_RECORD_BYTES {
        return Err(AppError::new(
            "invalidRecoveryMetadata",
            "The recovery record exceeds its size limit.",
            None,
        ));
    }
    let record: OperationRecovery = serde_json::from_slice(&data).map_err(|error| {
        AppError::new(
            "invalidRecoveryMetadata",
            format!("Could not read operation recovery '{id}': {error}"),
            None,
        )
    })?;
    if record.id != id
        || record.label.is_empty()
        || record.label.len() > 4096
        || record.label.contains('\0')
        || record.head_reference != format!("{RECOVERY_NAMESPACE}{id}-head")
        || record.snapshot_oid.is_some() != record.snapshot_reference.is_some()
        || record
            .snapshot_reference
            .as_ref()
            .is_some_and(|reference| reference != &format!("{RECOVERY_NAMESPACE}{id}-changes"))
    {
        return Err(AppError::new(
            "invalidRecoveryMetadata",
            "The recovery fields do not match their owned references.",
            None,
        ));
    }
    validate_commit_oid(&record.head_oid)?;
    if let Some(oid) = &record.snapshot_oid {
        validate_commit_oid(oid)?;
    }
    Ok(record)
}

fn verify_reference(
    path: &Path,
    reference: &str,
    expected: &str,
    allow_missing: bool,
) -> Result<bool, AppError> {
    let symbolic = run_git(path, &["symbolic-ref", "--quiet", reference])?;
    if symbolic.status.success() {
        return Err(AppError::new(
            "recoveryReferenceChanged",
            "A recovery reference was replaced by a symbolic reference.",
            Some(
                "No referenced branch was changed. Inspect the recovery reference before retrying.",
            ),
        ));
    }
    if symbolic.status.code() != Some(1) {
        return Err(AppError::git_failure(
            "inspect the protected recovery reference",
            &symbolic,
        ));
    }
    let output = run_git(path, &["rev-parse", "--verify", "--quiet", reference])?;
    if allow_missing && output.status.code() == Some(1) {
        return Ok(false);
    }
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != expected {
        return Err(AppError::new(
            "recoveryReferenceChanged",
            "A protected recovery reference is missing or changed.",
            Some(
                "No recovery branch was created and no changed reference was removed. Inspect the repository before retrying.",
            ),
        ));
    }
    Ok(true)
}

fn verify_record(path: &Path, record: &OperationRecovery) -> Result<(), AppError> {
    verify_reference(path, &record.head_reference, &record.head_oid, false)?;
    if let (Some(reference), Some(oid)) = (&record.snapshot_reference, &record.snapshot_oid) {
        verify_reference(path, reference, oid, false)?;
        let base = run_git(path, &["rev-parse", "--verify", &format!("{oid}^1")])?;
        ensure_success("verify the recovery snapshot base", &base)?;
        if String::from_utf8_lossy(&base.stdout).trim() != record.head_oid {
            return Err(AppError::new(
                "invalidRecoveryMetadata",
                "The snapshot does not belong to the saved history.",
                None,
            ));
        }
    }
    Ok(())
}

pub(crate) fn verify_commit_capture(
    path: &Path,
    capture: &OperationRecovery,
    expected: &str,
) -> Result<(), AppError> {
    let saved = read_record(path, &capture.id)?;
    if saved.head_oid != expected
        || capture.head_oid != expected
        || saved.head_reference != capture.head_reference
        || saved.snapshot_oid.is_some()
        || capture.snapshot_oid.is_some()
        || saved.snapshot_reference.is_some()
        || capture.snapshot_reference.is_some()
    {
        return Err(AppError::new(
            "recoveryReferenceChanged",
            "The workflow recovery capture no longer matches its reviewed history.",
            None,
        ));
    }
    verify_record(path, &saved)
}

pub fn operation_recoveries(path: &Path) -> Result<Vec<OperationRecovery>, AppError> {
    let entries = match fs::read_dir(discard::recovery_directory(path)?) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(discard::io_error(error)),
    };
    let mut records = Vec::new();
    for entry in entries {
        let entry = entry.map_err(discard::io_error)?;
        let name = entry.file_name();
        if let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".json")) {
            let record = read_record(path, id)?;
            verify_record(path, &record)?;
            records.push(record);
        }
    }
    records.sort_by(|left, right| right.id.cmp(&left.id));
    Ok(records)
}

pub fn restore_operation_branch(path: &Path, id: &str, branch: &str) -> Result<(), AppError> {
    require_idle(path)?;
    validate_branch_name(path, branch)?;
    if read_status(path)?.entry_count > 0 {
        return Err(AppError::new(
            "dirtyWorkingTree",
            "Save current changes before recovering history on a new branch.",
            None,
        ));
    }
    let mut record = read_record(path, id)?;
    verify_record(path, &record)?;
    reject_obstructing_files(path, &record.head_oid)?;
    if let Some(oid) = &record.snapshot_oid {
        reject_obstructing_files(path, oid)?;
    }
    run_mutation(
        path,
        &[
            "switch",
            "--no-overwrite-ignore",
            "-c",
            branch,
            &record.head_oid,
        ],
        "create the operation recovery branch",
    )?;
    if let Some(oid) = &record.snapshot_oid {
        run_mutation(path, &["stash", "apply", "--index", oid], "restore original staged and working changes")
            .map_err(|error| AppError::new("recoveryBranchPartiallyRestored", error.message,
                Some("The new branch exists, but changes could not be fully restored. Recovery data is retained; resolve conflicts or review the repository.")))?;
    }
    record.restored = true;
    write_record(path, &record).map_err(|error| AppError::new("recoveryMetadataUpdateFailed", error.message,
        Some("The branch and tracked changes were restored, but the recovery marker could not be updated. The saved capture is retained.")))
}

pub fn delete_operation_recovery(path: &Path, id: &str) -> Result<(), AppError> {
    let record = read_record(path, id)?;
    let mut transaction = String::from("start\n");
    for (reference, oid) in std::iter::once((&record.head_reference, &record.head_oid)).chain(
        record
            .snapshot_reference
            .as_ref()
            .zip(record.snapshot_oid.as_ref()),
    ) {
        if verify_reference(path, reference, oid, true)? {
            transaction.push_str(&format!("delete {reference} {oid}\n"));
        }
    }
    transaction.push_str("prepare\ncommit\n");
    run_git_with_input(
        path,
        &["update-ref", "--no-deref", "--stdin"],
        transaction.as_bytes(),
        "remove only the selected recovery references",
    )?;
    let filename = record_path(path, id)?;
    fs::remove_file(&filename).map_err(|error| AppError::new("recoveryCleanupIncomplete",
        format!("The protected references were removed, but the record could not be removed: {error}"),
        Some("Retry removing this capture to finish cleanup.")))?;
    let directory = filename.parent().ok_or_else(|| {
        AppError::new(
            "invalidRecoveryPath",
            "The recovery directory is unavailable.",
            None,
        )
    })?;
    sync_directory(directory).map_err(|error| {
        AppError::new(
            "recoveryCleanupIncomplete",
            format!(
                "The capture was removed, but its removal could not be durably synced: {}",
                error.message
            ),
            Some("Inspect recovery storage before relying on cleanup surviving a restart."),
        )
    })
}
