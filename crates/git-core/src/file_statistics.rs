use super::{AppError, ensure_success, run_git, run_git_with_stdout_limit};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Mode {
    Auto,
    Text,
    Binary,
    Git,
}

fn invalid_statistics() -> AppError {
    AppError::new(
        "invalidFileStatistics",
        "Git returned unsupported file-statistics settings or attributes.",
        Some("Check the repository's diff configuration and retry."),
    )
}

struct Policy {
    threshold: u64,
    drivers: HashSet<String>,
    binary_drivers: HashSet<String>,
    modes: HashMap<String, Mode>,
}

impl Policy {
    fn load(repository: &Path) -> Result<Self, AppError> {
        let output = run_git(
            repository,
            &[
                "config",
                "--type=int",
                "--default=536870912",
                "--get",
                "core.bigFileThreshold",
            ],
        )?;
        ensure_success("read Git's large-file threshold", &output)?;
        let threshold = std::str::from_utf8(&output.stdout)
            .ok()
            .and_then(|value| value.trim().parse().ok())
            .ok_or_else(invalid_statistics)?;
        let (output, truncated) = run_git_with_stdout_limit(
            repository,
            &[
                "config",
                "--null",
                "--name-only",
                "--get-regexp",
                r"^diff\..*\.",
            ],
            1024 * 1024,
        )?;
        if output.status.code() != Some(1) {
            ensure_success("read Git's diff settings", &output)?;
        }
        if truncated {
            return Err(invalid_statistics());
        }
        let mut policy = Self {
            threshold,
            drivers: HashSet::new(),
            binary_drivers: HashSet::new(),
            modes: HashMap::new(),
        };
        for record in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|record| !record.is_empty())
        {
            let key = std::str::from_utf8(record).map_err(|_| invalid_statistics())?;
            let (driver, setting) = key
                .strip_prefix("diff.")
                .and_then(|key| key.rsplit_once('.'))
                .ok_or_else(invalid_statistics)?;
            policy.drivers.insert(driver.to_owned());
            if setting == "binary" {
                policy.binary_drivers.insert(driver.to_owned());
            }
        }
        Ok(policy)
    }

    fn driver(&mut self, repository: &Path, name: &str) -> Result<Mode, AppError> {
        if let Some(mode) = self.modes.get(name) {
            return Ok(*mode);
        }
        let mode = if !self.binary_drivers.contains(name) {
            Mode::Auto
        } else {
            let key = format!("diff.{name}.binary");
            let output = run_git(repository, &["config", "--null", "--get", &key])?;
            ensure_success("read Git's binary diff setting", &output)?;
            if output
                .stdout
                .strip_suffix(&[0])
                .is_some_and(|value| value.eq_ignore_ascii_case(b"auto"))
            {
                Mode::Auto
            } else {
                // Let Git interpret boolean spellings and numeric values.
                let output = run_git(repository, &["config", "--type=bool", "--get", &key])?;
                ensure_success("read Git's binary diff setting", &output)?;
                match output.stdout.as_slice() {
                    b"true\n" => Mode::Binary,
                    b"false\n" => Mode::Text,
                    _ => return Err(invalid_statistics()),
                }
            }
        };
        self.modes.insert(name.to_owned(), mode);
        Ok(mode)
    }

    fn attribute(
        &mut self,
        repository: &Path,
        value: gix::attrs::StateRef<'_>,
    ) -> Result<Mode, AppError> {
        use gix::attrs::StateRef;
        match value {
            StateRef::Set => Ok(Mode::Text),
            StateRef::Unset => Ok(Mode::Binary),
            StateRef::Unspecified => self.driver(repository, "default"),
            StateRef::Value(value) => {
                let name = std::str::from_utf8(value.as_bstr().as_ref())
                    .map_err(|_| invalid_statistics())?;
                if self.drivers.contains(name) {
                    return self.driver(repository, name);
                }
                // Unknown names use the default driver; built-in names do not.
                // Defer this uncommon ambiguity rather than hard-code Git's
                // version-dependent inventory of built-in language drivers.
                if self.driver(repository, "default")? == Mode::Auto {
                    Ok(Mode::Auto)
                } else {
                    Ok(Mode::Git)
                }
            }
        }
    }
}

pub(super) fn untracked_additions(
    repository: &Path,
    paths: &[&str],
) -> Result<Vec<Option<usize>>, AppError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let mut policy = Policy::load(repository)?;
    let mut repo = gix::open(repository).map_err(|_| invalid_statistics())?;
    // Opening an explicit repository can still apply GIT_WORK_TREE. Attribute
    // lookup must use the same selected root as our Git CLI and file reads.
    repo.set_workdir(Some(repository.to_path_buf()))
        .map_err(|_| invalid_statistics())?;
    let index = attribute_index(repository, repo.object_hash())?;
    let mut attributes = repo
        .attributes_only(
            &index,
            gix::worktree::stack::state::attributes::Source::WorktreeThenIdMapping,
        )
        .map_err(|_| invalid_statistics())?;
    let mut matches = attributes.selected_attribute_matches(["diff"]);
    let mut counts = Vec::with_capacity(paths.len());
    for file in paths {
        attributes
            .at_path(file, None)
            .map_err(|_| invalid_statistics())?
            .matching_attributes(&mut matches);
        let state = matches
            .iter_selected()
            .next()
            .map(|matched| matched.assignment.state)
            .unwrap_or(gix::attrs::StateRef::Unspecified);
        let mode = policy.attribute(repository, state)?;
        counts.push(file_additions(repository, file, mode, policy.threshold));
    }
    Ok(counts)
}

fn attribute_index(
    repository: &Path,
    hash: gix::hash::Kind,
) -> Result<gix::index::State, AppError> {
    // Git expands sparse directories for this listing without rewriting the
    // index. Keep only attribute metadata, including staged rules, rather than
    // using HEAD or asking the user to hydrate excluded directories.
    let output = run_git(
        repository,
        &[
            "ls-files",
            "--stage",
            "-z",
            "--",
            ":(icase).gitattributes",
            ":(icase,glob)**/.gitattributes",
        ],
    )?;
    ensure_success("read indexed attribute files", &output)?;
    let mut index = gix::index::State::new(hash);
    for record in output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let separator = record
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or_else(invalid_statistics)?;
        let header: Vec<_> = record[..separator].split(|byte| *byte == b' ').collect();
        let path = &record[separator + 1..];
        if header.len() != 3 || path.is_empty() {
            return Err(invalid_statistics());
        }
        // Attribute files can be executable. Ignore symlink/gitlink entries;
        // during a conflict Git uses our side (stage 2), not base/their rules.
        if !matches!(header[0], b"100644" | b"100755") || !matches!(header[2], b"0" | b"2") {
            continue;
        }
        let id = gix::hash::ObjectId::from_hex(header[1]).map_err(|_| invalid_statistics())?;
        if id.kind() != hash {
            return Err(invalid_statistics());
        }
        index.dangerously_push_entry(
            Default::default(),
            id,
            gix::index::entry::Flags::empty(),
            gix::index::entry::Mode::FILE,
            path.into(),
        );
    }
    // Required by the insertion API before any path lookup is performed.
    index.sort_entries();
    Ok(index)
}

fn file_additions(repository: &Path, file: &str, mode: Mode, threshold: u64) -> Option<usize> {
    let path = repository.join(file);
    let metadata = fs::symlink_metadata(&path).ok()?;
    if metadata.is_symlink() {
        // Git stores the link's target path as its blob. Never open that target:
        // it may be missing, external, a directory, or a blocking special file.
        let target = fs::read_link(&path).ok()?;
        if target.as_os_str().as_encoded_bytes().len() as u64 > threshold {
            return None;
        }
        // Git counts link blobs independently of regular-file diff attributes,
        // but still applies the size threshold. Never delegate to no-index:
        // it can treat a directory link as a directory argument.
        return text_lines(target.as_os_str().as_encoded_bytes(), false);
    }
    if !metadata.is_file() {
        return None;
    }
    if mode == Mode::Binary || (mode == Mode::Auto && metadata.len() > threshold) {
        return None;
    }
    if mode == Mode::Git {
        let (output, truncated) = run_git_with_stdout_limit(
            repository,
            &[
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-textconv",
                "--numstat",
                "-z",
                "--",
                "/dev/null",
                file,
            ],
            64 * 1024,
        )
        .ok()?;
        if truncated || !matches!(output.status.code(), Some(0 | 1)) {
            return None;
        }
        let value = output.stdout.split(|byte| *byte == b'\t').next()?;
        return std::str::from_utf8(value).ok()?.parse().ok();
    }
    // Bound memory and the observed extent, even if a log grows during the read.
    text_lines(
        fs::File::open(path).ok()?.take(metadata.len()),
        mode == Mode::Auto,
    )
}

fn text_lines(mut input: impl Read, probe_binary: bool) -> Option<usize> {
    let mut buffer = [0; 8192];
    // Match Git's automatic binary probe without treating later NUL bytes as
    // binary. Track bytes, not reads: a reader can return short chunks.
    let mut probe_remaining = if probe_binary { 8000usize } else { 0 };
    let mut lines = 0usize;
    let mut last = None;
    loop {
        let size = match input.read(&mut buffer) {
            Ok(size) => size,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return None,
        };
        if size == 0 {
            return lines.checked_add(usize::from(last.is_some_and(|byte| byte != b'\n')));
        }
        let bytes = &buffer[..size];
        let probe_size = probe_remaining.min(size);
        if bytes[..probe_size].contains(&0) {
            return None;
        }
        probe_remaining -= probe_size;
        lines = lines.checked_add(bytes.iter().filter(|byte| **byte == b'\n').count())?;
        last = bytes.last().copied();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_statistics_use_small_reads_across_many_chunks() {
        struct Rows(usize);
        impl Read for Rows {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                assert!(buffer.len() <= 8192);
                let size = buffer.len().min(self.0);
                for (index, byte) in buffer[..size].iter_mut().enumerate() {
                    *byte = if (self.0 - index).is_multiple_of(2) {
                        b'x'
                    } else {
                        b'\n'
                    };
                }
                self.0 -= size;
                Ok(size)
            }
        }
        assert_eq!(text_lines(Rows(2_000_000), true), Some(1_000_000));
        assert_eq!(text_lines(&b"first\xff\nsecond\xfe"[..], true), Some(2));
        assert_eq!(text_lines(&b"binary\0bytes"[..], true), None);
    }

    #[test]
    fn interrupted_reads_are_retried_without_losing_counts() {
        struct InterruptedOnce(bool, std::io::Cursor<&'static [u8]>);
        impl Read for InterruptedOnce {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                if !self.0 {
                    self.0 = true;
                    return Err(std::io::ErrorKind::Interrupted.into());
                }
                self.1.read(buffer)
            }
        }
        assert_eq!(
            text_lines(
                InterruptedOnce(false, std::io::Cursor::new(b"one\ntwo")),
                true
            ),
            Some(2)
        );
    }

    #[test]
    fn binary_probe_boundary_is_independent_of_read_chunk_sizes() {
        struct Chunks(std::io::Cursor<Vec<u8>>, usize);
        impl Read for Chunks {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                let size = buffer.len().min(self.1);
                self.0.read(&mut buffer[..size])
            }
        }
        for chunk in [1, 17, 7999, 8000, 8192] {
            for offset in [0, 7999, 8000, 8191, 8192, 16000] {
                let mut bytes = vec![b'x'; 20000];
                bytes[offset] = 0;
                bytes[19000] = b'\n';
                assert_eq!(
                    text_lines(Chunks(std::io::Cursor::new(bytes), chunk), true),
                    if offset < 8000 { None } else { Some(2) },
                    "chunk={chunk}, NUL at byte {offset}"
                );
            }
        }
    }
}
