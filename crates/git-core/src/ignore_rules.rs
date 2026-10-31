use super::*;
use std::fs::OpenOptions;
use std::io::{Read, Seek, Write};

struct ExistingRules {
    already_present: bool,
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

fn scan_existing_rules(input: &mut impl Read, rule: &[u8]) -> std::io::Result<ExistingRules> {
    let mut result = ExistingRules {
        already_present: false,
        has_bytes: false,
        ends_with_newline: false,
    };
    let mut buffer = [0_u8; 64 * 1024];
    let mut length = 0_usize;
    let mut matching = true;
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
                result.already_present |= matches_line(rule, length, matching, last);
                length = 0;
                matching = true;
                last = None;
            } else if let Some(previous) = last.replace(byte) {
                matching &= rule.get(length) == Some(&previous);
                // Once a line is too long, retain only a bounded mismatch
                // state, never the line's contents or an unbounded counter.
                length = length.saturating_add(1).min(rule.len().saturating_add(1));
            }
        }
    }
    result.already_present |= matches_line(rule, length, matching, last);
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
        let mut input = if metadata.is_some() {
            Some(fs::File::open(&destination).map_err(io_error)?)
        } else {
            None
        };
        let existing = if let Some(input) = input.as_mut() {
            scan_existing_rules(input, rule.as_bytes()).map_err(io_error)?
        } else {
            ExistingRules {
                already_present: false,
                has_bytes: false,
                ends_with_newline: false,
            }
        };
        if !existing.already_present {
            // A duplicate is a no-op, even when there is no room to copy the
            // file. For a real update, stream a second pass into the owned lock
            // instead of retaining or growing a whole-file allocation.
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
            b"\r\n\n".to_vec(),
        ];
        let mut boundary = vec![b'x'; 64 * 1024 - 3];
        boundary.extend_from_slice(b"\n/target\r\nlast");
        inputs.push(boundary);
        for bytes in &inputs {
            for rule in [b"/target".as_slice(), b"/target\r", b"", b"last", b"\xff\0"] {
                let expected = bytes
                    .split(|byte| *byte == b'\n')
                    .any(|line| line.strip_suffix(b"\r").unwrap_or(line) == rule);
                for chunk in [1, 2, 7, 64 * 1024] {
                    let mut input = Chunked {
                        input: Cursor::new(bytes),
                        chunk,
                        interrupt: true,
                    };
                    let result = scan_existing_rules(&mut input, rule).unwrap();
                    assert_eq!(
                        result.already_present, expected,
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
        assert!(!result.already_present);
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
