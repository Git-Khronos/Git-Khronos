use super::*;
use std::fs::OpenOptions;

fn refused(message: impl Into<String>) -> AppError {
    AppError::new(
        "offlineExchangeRefused",
        message,
        Some("Inspect the repository and destination, then prepare a fresh review. No existing file or reference is replaced."),
    )
}

/// Offline exchange must never trigger lazy object downloads, so partial and
/// promisor repositories refuse before any status or object inspection.
pub(crate) fn require_local_exchange_objects(path: &Path) -> Result<(), AppError> {
    let partial = run_git(path, &["config", "--get", "extensions.partialClone"])?;
    if partial.status.success() {
        return Err(refused("Offline exchange refuses partial clones to avoid implicit network downloads. Use local Git after obtaining complete objects."));
    }
    if partial.status.code() != Some(1) {
        ensure_success("inspect partial-clone exchange scope", &partial)?;
    }
    let promisors = run_git(
        path,
        &[
            "config",
            "--type=bool",
            "--get-regexp",
            "^remote\\..*\\.promisor$",
        ],
    )?;
    if promisors.status.code() != Some(1) {
        ensure_success("inspect promisor exchange scope", &promisors)?;
        if promisors
            .stdout
            .split(|byte| *byte == b'\n')
            .any(|line| line.ends_with(b" true"))
        {
            return Err(refused("Offline exchange refuses promisor repositories to avoid implicit network downloads. Use local Git after obtaining complete objects."));
        }
    }
    Ok(())
}

/// Exclusively creates a new synchronized file outside the worktree and all
/// Git metadata. Existing entries, including symlinks, are never replaced.
pub(crate) fn write_new_exchange_file(
    path: &Path,
    destination: &Path,
    bytes: &[u8],
) -> Result<usize, AppError> {
    let io_error = |error: std::io::Error| refused(format!("Output file access failed: {error}"));
    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| refused("Choose an existing output directory."))?;
    let parent = fs::canonicalize(parent).map_err(io_error)?;
    let name = destination
        .file_name()
        .ok_or_else(|| refused("Choose an output filename."))?;
    let root = resolve_repository(path)?;
    let roots = repository_watch_paths(path)?;
    if parent.starts_with(&root)
        || roots
            .non_recursive
            .iter()
            .any(|metadata| parent.starts_with(metadata))
    {
        return Err(refused(
            "Save exchange files outside the working tree and Git metadata.",
        ));
    }
    let destination = parent.join(name);
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(io_error)?;
    output
        .write_all(bytes)
        .and_then(|_| output.sync_all())
        .map_err(|error| {
            AppError::new(
                "exchangeExportIncomplete",
                format!("Export failed: {error}"),
                Some("The new output may contain partial data. Inspect that file before removing it and retrying."),
            )
        })?;
    Ok(bytes.len())
}
