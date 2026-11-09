use super::*;

fn refused(message: impl Into<String>) -> AppError {
    AppError::new(
        "invalidOperationStorage",
        message,
        Some(
            "Preserve current files and operation metadata. Inspect the application-owned Git entries before retrying; linked or special entries are never followed.",
        ),
    )
}

/// Resolve Git's owning directory, but retain the application entry itself.
/// Absolute --git-path canonicalizes symlinks and hides redirected storage.
pub(super) fn git_entry(path: &Path, name: &str) -> Result<PathBuf, AppError> {
    let output = run_git(path, &["rev-parse", "--absolute-git-dir"])?;
    ensure_success("locate application operation storage", &output)?;
    let value = std::str::from_utf8(&output.stdout)
        .map_err(|_| refused("Git returned an unsupported operation storage path."))?;
    let directory = Path::new(value.strip_suffix('\n').unwrap_or(value));
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(refused(
            "Git returned an invalid operation storage directory.",
        ));
    }
    Ok(directory.join(name))
}

pub(super) fn directory(path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.is_symlink() => Ok(()),
        Ok(_) => Err(refused(
            "Application operation storage must be an ordinary directory, not a symbolic link or special file.",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(refused(format!(
            "Could not inspect operation storage: {error}"
        ))),
    }
}

pub(super) fn file(path: &Path) -> Result<Option<fs::Metadata>, AppError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => Ok(Some(metadata)),
        Ok(_) => Err(refused(
            "Application operation metadata must be an ordinary file, not a symbolic link or special file.",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(refused(format!(
            "Could not inspect operation metadata: {error}"
        ))),
    }
}
