use super::*;
use std::fs::OpenOptions;

fn io_error(error: std::io::Error) -> AppError {
    AppError::new(
        "writeIgnoreFileFailed",
        format!("Could not update .gitignore: {error}"),
        Some(
            "Preserve the current rules and index. Check repository permissions and other writers, then refresh before retrying.",
        ),
    )
}

pub(super) fn update(path: &Path, rule: &str, stop_tracking: Option<&str>) -> Result<(), AppError> {
    let destination = path.join(".gitignore");
    let lock = path.join(".gitignore.lock");
    // A failed acquisition must never remove another writer's lock.
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(io_error)?;
    let mut lock_owned = true;
    let result = (|| {
        let metadata = match fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => Some(metadata),
            Ok(_) => {
                return Err(AppError::new(
                    "invalidIgnoreFile",
                    "The repository .gitignore must be an ordinary file, not a symbolic link or directory.",
                    Some("Preserve the existing entry and inspect it before retrying."),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(io_error(error)),
        };
        let mut bytes = if metadata.is_some() {
            fs::read(&destination).map_err(io_error)?
        } else {
            Vec::new()
        };
        if let Some(file) = stop_tracking {
            // Refuse known index/staging conflicts before adding an ignore rule.
            run_mutation(
                path,
                &[
                    "--literal-pathspecs",
                    "rm",
                    "--cached",
                    "--ignore-unmatch",
                    "--dry-run",
                    "--",
                    file,
                ],
                "check whether that file can stop being tracked",
            )?;
        }
        let already_present = bytes
            .split(|byte| *byte == b'\n')
            .any(|line| line.strip_suffix(b"\r").unwrap_or(line) == rule.as_bytes());
        if !already_present {
            if !bytes.is_empty() && !bytes.ends_with(b"\n") {
                bytes.push(b'\n');
            }
            bytes.extend_from_slice(rule.as_bytes());
            bytes.push(b'\n');
            if let Some(metadata) = metadata {
                output
                    .set_permissions(metadata.permissions())
                    .map_err(io_error)?;
            }
            output.write_all(&bytes).map_err(io_error)?;
            output.sync_all().map_err(io_error)?;
            drop(output);
            // Replace only after the complete byte-preserving update is saved.
            fs::rename(&lock, &destination).map_err(io_error)?;
            lock_owned = false;
            #[cfg(unix)]
            fs::File::open(path)
                .and_then(|directory| directory.sync_all())
                .map_err(io_error)?;
        }
        if let Some(file) = stop_tracking {
            run_mutation(
                path,
                &[
                    "--literal-pathspecs",
                    "rm",
                    "--cached",
                    "--ignore-unmatch",
                    "--",
                    file,
                ],
                "stop tracking that file",
            )?;
        }
        Ok(())
    })();
    // Once renamed, this pathname is available to another writer. It is no
    // longer ours to remove, even if a subsequent Git operation fails.
    if !lock_owned {
        return result;
    }
    match fs::remove_file(&lock) {
        Ok(()) => result,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => result,
        Err(error) => result.and(Err(io_error(error))),
    }
}
