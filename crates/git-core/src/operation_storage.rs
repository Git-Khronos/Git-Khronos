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

/// Read a small, regular Git state entry without following links or a FIFO.
pub(super) fn read_bounded(
    directory: &Path,
    name: &str,
    limit: u64,
    unavailable: impl Fn() -> AppError,
) -> Result<Option<Vec<u8>>, AppError> {
    #[cfg(unix)]
    let file = {
        use rustix::{
            fs::{Mode, OFlags, open, openat},
            io::Errno,
        };
        let directory = open(
            directory,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| unavailable())?;
        match openat(
            directory,
            name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(file) => fs::File::from(file),
            Err(Errno::NOENT) => return Ok(None),
            Err(_) => return Err(unavailable()),
        }
    };
    #[cfg(not(unix))]
    let file = {
        let path = directory.join(name);
        if operation_storage::file(&path)
            .map_err(|_| unavailable())?
            .is_none()
        {
            return Ok(None);
        }
        let mut opts = fs::OpenOptions::new();
        opts.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
            opts.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        opts.open(path).map_err(|_| unavailable())?
    };
    let metadata = file.metadata().map_err(|_| unavailable())?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(unavailable());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    if bytes.len() as u64 > limit {
        return Err(unavailable());
    }
    Ok(Some(bytes))
}
