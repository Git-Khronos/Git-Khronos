use super::*;
use std::fs::OpenOptions;
use std::io::{Read, Seek, Write};

struct ExistingRules {
    last_effective_is_rule: bool,
    has_bytes: bool,
    ends_with_newline: bool,
}

fn matches_line(rule: &[u8], length: usize, matching: bool, last: Option<u8>) -> bool {
    // Keep the last byte pending so a single trailing CR has the same meaning
    // as strip_suffix(b"\r"), even when CR/LF straddles a read boundary.
    match last {
        Some(last) if last != b'\r' => {
            matching && rule.get(length) == Some(&last) && length + 1 == rule.len()
        }
        _ => matching && length == rule.len(),
    }
}

fn record_line(
    result: &mut ExistingRules,
    rule: &[u8],
    length: usize,
    matching: bool,
    first: Option<u8>,
    last: Option<u8>,
) {
    if first.is_some_and(|byte| byte != b'#') && (first != Some(b'\r') || length != 0) {
        result.last_effective_is_rule = matches_line(rule, length, matching, last);
    }
}

fn scan_existing_rules(input: &mut impl Read, rule: &[u8]) -> std::io::Result<ExistingRules> {
    let mut result = ExistingRules {
        last_effective_is_rule: false,
        has_bytes: false,
        ends_with_newline: false,
    };
    let mut buffer = [0_u8; 64 * 1024];
    let mut length = 0_usize;
    let mut matching = true;
    let mut first = None;
    let mut last = None;
    loop {
        let count = match input.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        result.has_bytes = true;
        result.ends_with_newline = buffer[count - 1] == b'\n';
        for &byte in &buffer[..count] {
            if byte == b'\n' {
                record_line(&mut result, rule, length, matching, first, last);
                length = 0;
                matching = true;
                first = None;
                last = None;
            } else {
                first.get_or_insert(byte);
                if let Some(previous) = last.replace(byte) {
                    matching &= rule.get(length) == Some(&previous);
                    // Once a line is too long, retain only a bounded mismatch
                    // state, never the line's contents or an unbounded counter.
                    length = length.saturating_add(1).min(rule.len().saturating_add(1));
                }
            }
        }
    }
    record_line(&mut result, rule, length, matching, first, last);
    Ok(result)
}

fn io_error(error: std::io::Error) -> AppError {
    AppError::new(
        "writeIgnoreFileFailed",
        format!("Could not update .gitignore: {error}"),
        Some(
            "Preserve the current rules and index. Check repository permissions and other writers, then refresh before retrying.",
        ),
    )
}

fn invalid_ignore_file() -> AppError {
    AppError::new(
        "invalidIgnoreFile",
        "The repository .gitignore must be an ordinary file, not a symbolic link or directory.",
        Some("Preserve the existing entry and inspect it before retrying."),
    )
}

#[cfg(unix)]
fn open_ignore_no_follow(path: &Path) -> Result<fs::File, AppError> {
    use rustix::fs::{Mode, OFlags, open};

    let descriptor = open(
        path,
        OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|error| {
        if error == rustix::io::Errno::LOOP {
            invalid_ignore_file()
        } else {
            io_error(error.into())
        }
    })?;
    Ok(fs::File::from(descriptor))
}

#[cfg(windows)]
fn open_ignore_no_follow(path: &Path) -> Result<fs::File, AppError> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(io_error)
}

#[cfg(not(any(unix, windows)))]
fn open_ignore_no_follow(_path: &Path) -> Result<fs::File, AppError> {
    Err(AppError::new(
        "unsupportedPlatform",
        "Existing ignore rules cannot be opened safely on this platform.",
        Some("Edit .gitignore manually instead."),
    ))
}

fn is_ignored(path: &Path, file: &str) -> Result<bool, AppError> {
    // check-ignore rejects pathspec magic, including names beginning with ':'.
    let literal_file = format!("./{file}");
    let output = run_git(
        path,
        &["check-ignore", "--no-index", "--quiet", "--", &literal_file],
    )?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(AppError::git_failure("verify the ignore rule", &output)),
    }
}

pub(super) fn update(
    path: &Path,
    rule: &str,
    file: &str,
    stop_tracking: bool,
) -> Result<(), AppError> {
    update_with_hook(path, rule, file, stop_tracking, || {})
}

pub(super) fn update_with_hook(
    path: &Path,
    rule: &str,
    file: &str,
    stop_tracking: bool,
    before_open: impl FnOnce(),
) -> Result<(), AppError> {
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
        let exists = match fs::symlink_metadata(&destination) {
            Ok(metadata)
                if metadata.is_file() && !repository_files::is_link_or_reparse_point(&metadata) =>
            {
                true
            }
            Ok(_) => return Err(invalid_ignore_file()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(io_error(error)),
        };
        if stop_tracking {
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
        before_open();
        let (mut input, metadata) = if exists {
            let input = open_ignore_no_follow(&destination)?;
            let metadata = input.metadata().map_err(io_error)?;
            if !metadata.is_file() || repository_files::is_link_or_reparse_point(&metadata) {
                return Err(invalid_ignore_file());
            }
            (Some(input), Some(metadata))
        } else {
            (None, None)
        };
        let existing = if let Some(input) = input.as_mut() {
            scan_existing_rules(input, rule.as_bytes()).map_err(io_error)?
        } else {
            ExistingRules {
                last_effective_is_rule: false,
                has_bytes: false,
                ends_with_newline: false,
            }
        };
        let add_rule = !existing.last_effective_is_rule;
        if add_rule {
            // Stream the update into the owned lock without retaining the
            // existing file in memory.
            if let Some(input) = input.as_mut() {
                input.rewind().map_err(io_error)?;
                std::io::copy(input, &mut output).map_err(io_error)?;
            }
            drop(input);
            if existing.has_bytes && !existing.ends_with_newline {
                output.write_all(b"\n").map_err(io_error)?;
            }
            output.write_all(rule.as_bytes()).map_err(io_error)?;
            output.write_all(b"\n").map_err(io_error)?;
            if let Some(metadata) = metadata {
                output
                    .set_permissions(metadata.permissions())
                    .map_err(io_error)?;
            }
            output.sync_all().map_err(io_error)?;
            drop(output);
            // Replace only after the complete byte-preserving update is saved.
            fs::rename(&lock, &destination).map_err(io_error)?;
            lock_owned = false;
            #[cfg(unix)]
            fs::File::open(path)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| {
                    AppError::new(
                        "ignoreRuleSyncFailed",
                        format!("The ignore rule was added, but its persistence could not be confirmed: {error}"),
                        Some("The index was not changed. Review .gitignore and refresh before retrying."),
                    )
                })?;
        }
        let ignored = is_ignored(path, file).map_err(|error| {
            if add_rule {
                AppError::new(
                    "ignoreRuleVerificationFailed",
                    format!(
                        "The ignore rule was added, but Git could not verify it: {}",
                        error.message
                    ),
                    Some(
                        "The index was not changed. Review .gitignore and refresh before retrying.",
                    ),
                )
            } else {
                error
            }
        })?;
        if !ignored {
            return Err(AppError::new(
                "ignoreRuleIneffective",
                if add_rule {
                    "The rule was added to the root .gitignore, but Git does not ignore the selected file."
                } else {
                    "The existing rule does not ignore the selected file."
                },
                Some(
                    "The index was not changed. Review higher-priority ignore rules and refresh before retrying.",
                ),
            ));
        }
        if stop_tracking {
            let result = run_mutation(
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
            );
            if let Err(error) = result {
                return Err(if add_rule {
                    AppError::new(
                        "ignoreRuleAddedButUntrackingFailed",
                        format!(
                            "The ignore rule was added, but Git could not confirm untracking: {}",
                            error.message
                        ),
                        Some("Inspect .gitignore and the index before retrying."),
                    )
                } else {
                    error
                });
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Error, ErrorKind};

    struct Chunked<'a> {
        input: Cursor<&'a [u8]>,
        chunk: usize,
        interrupt: bool,
    }

    impl Read for Chunked<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            assert!(
                buffer.len() <= 64 * 1024,
                "ignore scanning must stay bounded"
            );
            if std::mem::take(&mut self.interrupt) {
                return Err(Error::from(ErrorKind::Interrupted));
            }
            let count = buffer.len().min(self.chunk);
            self.input.read(&mut buffer[..count])
        }
    }

    #[test]
    fn streaming_ignore_scan_preserves_exact_byte_and_crlf_matching_across_chunks() {
        let mut inputs: Vec<Vec<u8>> = vec![
            b"".to_vec(),
            b"/target".to_vec(),
            b"/target\r\n".to_vec(),
            b"/target\r".to_vec(),
            b"/target\r\r\n".to_vec(),
            b"not/target\n/target-extra\n".to_vec(),
            b"\xff\0\n/target\n".to_vec(),
            b"/target\n# comment\n\r\n".to_vec(),
            b"/target\n!/target\n# comment\n".to_vec(),
            b"\r\n\n".to_vec(),
        ];
        let mut boundary = vec![b'x'; 64 * 1024 - 3];
        boundary.extend_from_slice(b"\n/target\r\nlast");
        inputs.push(boundary);
        for bytes in &inputs {
            for rule in [b"/target".as_slice(), b"/target\r", b"", b"last", b"\xff\0"] {
                let expected = bytes
                    .split(|byte| *byte == b'\n')
                    .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
                    .rfind(|line| !line.is_empty() && line[0] != b'#')
                    .is_some_and(|line| line == rule);
                for chunk in [1, 2, 7, 64 * 1024] {
                    let mut input = Chunked {
                        input: Cursor::new(bytes),
                        chunk,
                        interrupt: true,
                    };
                    let result = scan_existing_rules(&mut input, rule).unwrap();
                    assert_eq!(
                        result.last_effective_is_rule, expected,
                        "rule={rule:?}, chunk={chunk}"
                    );
                    assert_eq!(result.has_bytes, !bytes.is_empty());
                    assert_eq!(result.ends_with_newline, bytes.ends_with(b"\n"));
                }
            }
        }
    }

    #[test]
    fn streaming_ignore_scan_never_retains_a_long_unterminated_line() {
        let mut input = std::io::repeat(b'x').take(64 * 1024 * 1024);
        let result = scan_existing_rules(&mut input, b"/target").unwrap();
        assert!(!result.last_effective_is_rule);
        assert!(result.has_bytes);
        assert!(!result.ends_with_newline);
    }

    #[test]
    fn streaming_ignore_scan_propagates_non_interrupted_read_failures() {
        struct Failing;
        impl Read for Failing {
            fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
                Err(Error::from(ErrorKind::PermissionDenied))
            }
        }
        assert_eq!(
            scan_existing_rules(&mut Failing, b"/target")
                .err()
                .unwrap()
                .kind(),
            ErrorKind::PermissionDenied
        );
    }
}
