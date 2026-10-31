//! Bounded, read-only content for a selected Git file side.
//! Payloads stay outside repository snapshots and are not decoded here.
use super::*;

pub const MAX_FILE_CONTENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileContentLocation {
    Revision(String),
    Index,
    WorkingTree,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileContentKind {
    Absent,
    Regular,
    SymbolicLink,
    Submodule,
    Unmerged,
}
#[derive(Clone, PartialEq, Eq)]
pub struct FileContent {
    pub kind: FileContentKind,
    pub oid: Option<String>,
    pub size: Option<u64>,
    /// None means absent, non-blob, unresolved, or over budget; never partial data.
    pub bytes: Option<Vec<u8>>,
    pub over_limit: bool,
}
impl std::fmt::Debug for FileContent {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FileContent")
            .field("kind", &self.kind)
            .field("oid", &self.oid)
            .field("size", &self.size)
            .field("over_limit", &self.over_limit)
            .finish_non_exhaustive()
    }
}
impl FileContent {
    pub(super) fn empty(kind: FileContentKind) -> Self {
        Self {
            kind,
            oid: None,
            size: None,
            bytes: None,
            over_limit: false,
        }
    }
}
fn refused(message: &str) -> AppError {
    AppError::new(
        "fileContentRefused",
        message,
        Some("Reload the selected file. No repository data was changed."),
    )
}
fn io_error(_: impl std::fmt::Display) -> AppError {
    refused("The selected file could not be read as stable repository content.")
}
pub(super) fn validate_file(file: &str) -> Result<(), AppError> {
    let candidate = Path::new(file);
    if file.is_empty()
        || file.len() > 16_384
        || file.contains('\0')
        || file
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !candidate
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        || candidate
            .components()
            .any(|part| part.as_os_str() == ".git")
    {
        return Err(refused(
            "Choose a literal repository-relative file outside Git metadata.",
        ));
    }
    #[cfg(windows)]
    if candidate.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return Err(refused("Git metadata cannot be opened as file content."));
    }
    Ok(())
}
pub(super) fn content_git(
    path: &Path,
    args: &[&str],
    limit: usize,
) -> Result<(Output, bool), AppError> {
    // Fetch-free inspection must fail closed on Git versions without this flag.
    let mut guarded = Vec::with_capacity(args.len() + 1);
    guarded.push("--no-lazy-fetch");
    guarded.extend_from_slice(args);
    run_git_with_stdout_limit(path, &guarded, limit)
}

pub(super) fn metadata_git(path: &Path, args: &[&str]) -> Result<Vec<u8>, AppError> {
    let (output, truncated) = content_git(path, args, MAX_ENTRY_BYTES)?;
    ensure_success("inspect selected file content identity", &output)?;
    if truncated {
        return Err(refused(
            "The selected file metadata exceeds the inspection budget.",
        ));
    }
    Ok(output.stdout)
}
fn entry(path: &Path, file: &str, location: &FileContentLocation) -> Result<FileContent, AppError> {
    let records = match location {
        FileContentLocation::Revision(oid) => {
            validate_commit_oid(oid)?;
            metadata_git(
                path,
                &[
                    "--literal-pathspecs",
                    "ls-tree",
                    "--full-tree",
                    "-z",
                    oid,
                    "--",
                    file,
                ],
            )?
        }
        FileContentLocation::Index => metadata_git(
            path,
            &[
                "--literal-pathspecs",
                "ls-files",
                "--stage",
                "-z",
                "--",
                file,
            ],
        )?,
        FileContentLocation::WorkingTree => unreachable!("worktree uses directory-relative reads"),
    };
    if !records.is_empty() && !records.ends_with(&[0]) {
        return Err(refused("Git returned incomplete file metadata."));
    }
    let finish = |content| {
        if matches!(location, FileContentLocation::Index)
            && metadata_git(
                path,
                &[
                    "--literal-pathspecs",
                    "ls-files",
                    "--stage",
                    "-z",
                    "--",
                    file,
                ],
            )? != records
        {
            return Err(refused("The selected index entry changed while reading."));
        }
        Ok(content)
    };
    let mut selected: Option<(String, String)> = None;
    let mut unmerged = false;
    for record in records
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let separator = record
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or_else(|| refused("Git returned invalid file metadata."))?;
        let (header, tail) = record.split_at(separator);
        let name = &tail[1..];
        if name != file.as_bytes() {
            return Err(refused(
                "Git returned a different file than the selected literal path.",
            ));
        }
        let fields = header.split(|byte| *byte == b' ').collect::<Vec<_>>();
        if fields.len() != 3 {
            return Err(refused("Git returned invalid file metadata."));
        }
        let (mode, oid, stage) = match location {
            FileContentLocation::Index => (fields[0], fields[1], fields[2]),
            _ => (fields[0], fields[2], b"0".as_slice()),
        };
        if stage != b"0" {
            if !matches!(stage, b"1" | b"2" | b"3") {
                return Err(refused("Git returned an invalid index stage."));
            }
            unmerged = true;
            continue;
        }
        if selected.is_some() {
            return Err(refused("The selected path has multiple file identities."));
        }
        let mode = std::str::from_utf8(mode).map_err(io_error)?.to_owned();
        let oid = std::str::from_utf8(oid).map_err(io_error)?.to_owned();
        validate_commit_oid(&oid)?;
        selected = Some((mode, oid));
    }
    if unmerged {
        if selected.is_some() {
            return Err(refused("The index changed while selecting file content."));
        }
        return finish(FileContent::empty(FileContentKind::Unmerged));
    }
    let Some((mode, oid)) = selected else {
        return finish(FileContent::empty(FileContentKind::Absent));
    };
    let kind = match mode.as_str() {
        "100644" | "100755" => FileContentKind::Regular,
        "120000" => FileContentKind::SymbolicLink,
        "160000" => {
            return finish(FileContent {
                oid: Some(oid),
                ..FileContent::empty(FileContentKind::Submodule)
            });
        }
        _ => {
            return Err(refused(
                "The selected path is not a file, link or submodule.",
            ));
        }
    };
    if metadata_git(path, &["cat-file", "-t", &oid])? != b"blob\n" {
        return Err(refused("The selected file identity does not name a blob."));
    }
    let size = metadata_git(path, &["cat-file", "-s", &oid])?;
    let size: u64 = std::str::from_utf8(&size)
        .map_err(io_error)?
        .trim_end_matches('\n')
        .parse()
        .map_err(io_error)?;
    let mut content = FileContent {
        kind,
        oid: Some(oid.clone()),
        size: Some(size),
        bytes: None,
        over_limit: size > MAX_FILE_CONTENT_BYTES as u64,
    };
    if content.over_limit {
        return finish(content);
    }
    let (output, truncated) =
        content_git(path, &["cat-file", "blob", &oid], MAX_FILE_CONTENT_BYTES)?;
    ensure_success("read selected blob content", &output)?;
    if truncated || output.stdout.len() as u64 != size {
        return Err(refused(
            "The selected blob did not match its complete declared length.",
        ));
    }
    content.bytes = Some(output.stdout);
    finish(content)
}

pub fn read_file_content(
    path: &Path,
    location: &FileContentLocation,
    file: &str,
    cancellation: &CancellationToken,
) -> Result<FileContent, AppError> {
    validate_file(file)?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    git_cancellation::with(Some(cancellation), || match location {
        FileContentLocation::WorkingTree => worktree::read(path, file, cancellation),
        _ => entry(path, file, location),
    })
}

pub(super) fn worktree_root(path: &Path) -> Result<PathBuf, AppError> {
    if metadata_git(path, &["rev-parse", "--is-inside-git-dir"])? == b"true\n" {
        return Err(refused(
            "Git metadata directories are not working-file roots.",
        ));
    }
    let top = metadata_git(
        path,
        &["rev-parse", "--path-format=absolute", "--show-toplevel"],
    )?;
    let top = top
        .strip_suffix(b"\n")
        .ok_or_else(|| refused("Git did not identify a worktree root."))?;
    let root_path = Path::new(std::str::from_utf8(top).map_err(io_error)?)
        .canonicalize()
        .map_err(io_error)?;
    if root_path != path.canonicalize().map_err(io_error)? {
        return Err(refused(
            "Working content must be selected relative to the worktree root.",
        ));
    }
    Ok(root_path)
}

#[cfg(unix)]
mod worktree {
    use super::*;
    use rustix::fs::{AtFlags, FileType, Mode, OFlags, open, openat, readlinkat, statat};
    use std::os::fd::OwnedFd;
    use std::os::unix::fs::MetadataExt;

    fn directories() -> OFlags {
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
    }
    fn descend(root: &OwnedFd, relative: &Path) -> Result<OwnedFd, rustix::io::Errno> {
        let mut directory = root.try_clone().map_err(|_| rustix::io::Errno::IO)?;
        for part in relative.components() {
            let Component::Normal(name) = part else {
                return Err(rustix::io::Errno::INVAL);
            };
            directory = openat(&directory, name, directories(), Mode::empty())?;
        }
        Ok(directory)
    }
    fn absolute(path: &Path) -> Result<OwnedFd, AppError> {
        let root = open("/", directories(), Mode::empty()).map_err(io_error)?;
        descend(&root, path.strip_prefix("/").map_err(io_error)?).map_err(io_error)
    }
    fn identity(metadata: &fs::Metadata) -> (u64, u64, u32, u64, i64, i64, i64, i64) {
        (
            metadata.dev(),
            metadata.ino(),
            metadata.mode(),
            metadata.len(),
            metadata.mtime(),
            metadata.mtime_nsec(),
            metadata.ctime(),
            metadata.ctime_nsec(),
        )
    }
    fn link_identity(stat: &rustix::fs::Stat) -> [i128; 8] {
        [
            stat.st_dev as i128,
            stat.st_ino as i128,
            stat.st_mode as i128,
            stat.st_size as i128,
            stat.st_mtime as i128,
            stat.st_mtime_nsec as i128,
            stat.st_ctime as i128,
            stat.st_ctime_nsec as i128,
        ]
    }
    pub(super) fn read(
        path: &Path,
        file: &str,
        cancellation: &CancellationToken,
    ) -> Result<FileContent, AppError> {
        let root_path = worktree_root(path)?;
        let root = absolute(&root_path)?;
        let relative = Path::new(file);
        let parent = relative.parent().unwrap_or(Path::new(""));
        let name = relative
            .file_name()
            .ok_or_else(|| refused("Choose a file name."))?;
        let directory = match descend(&root, parent) {
            Ok(directory) => directory,
            Err(rustix::io::Errno::NOENT) => {
                return Ok(FileContent::empty(FileContentKind::Absent));
            }
            // An obstructed parent is not an absent file.
            Err(error) => return Err(io_error(error)),
        };
        let before = match statat(&directory, name, AtFlags::SYMLINK_NOFOLLOW) {
            Ok(stat) => stat,
            Err(rustix::io::Errno::NOENT) => {
                return Ok(FileContent::empty(FileContentKind::Absent));
            }
            Err(error) => return Err(io_error(error)),
        };
        let kind = match FileType::from_raw_mode(before.st_mode) {
            FileType::RegularFile => FileContentKind::Regular,
            FileType::Symlink => FileContentKind::SymbolicLink,
            _ => {
                return Err(refused(
                    "The selected working path is not a regular file or symbolic link.",
                ));
            }
        };
        let size = u64::try_from(before.st_size).map_err(io_error)?;
        let mut content = FileContent {
            kind,
            oid: None,
            size: Some(size),
            bytes: None,
            over_limit: size > MAX_FILE_CONTENT_BYTES as u64,
        };
        if !content.over_limit {
            if kind == FileContentKind::SymbolicLink {
                content.bytes = Some(
                    readlinkat(&directory, name, Vec::new())
                        .map_err(io_error)?
                        .into_bytes(),
                );
            } else {
                let descriptor = openat(
                    &directory,
                    name,
                    OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )
                .map_err(io_error)?;
                let mut input = fs::File::from(descriptor);
                let metadata = input.metadata().map_err(io_error)?;
                if !metadata.is_file()
                    || metadata.dev() as i128 != before.st_dev as i128
                    || metadata.ino() as i128 != before.st_ino as i128
                {
                    return Err(refused("The selected working file changed before reading."));
                }
                let mut bytes = Vec::with_capacity(size as usize);
                let mut buffer = [0; 64 * 1024];
                loop {
                    if cancellation.is_cancelled() {
                        return Err(operation_cancelled());
                    }
                    let count = match input.read(&mut buffer) {
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        result => result.map_err(io_error)?,
                    };
                    if count == 0 {
                        break;
                    }
                    if bytes.len() + count > MAX_FILE_CONTENT_BYTES {
                        return Err(refused(
                            "The working file grew beyond its inspection budget.",
                        ));
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                }
                if identity(&metadata) != identity(&input.metadata().map_err(io_error)?)
                    || bytes.len() as u64 != size
                {
                    return Err(refused("The selected working file changed while reading."));
                }
                content.bytes = Some(bytes);
            }
        }
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        let current_root = absolute(&root_path)?;
        let original_metadata = fs::File::from(root.try_clone().map_err(io_error)?)
            .metadata()
            .map_err(io_error)?;
        let current_metadata = fs::File::from(current_root.try_clone().map_err(io_error)?)
            .metadata()
            .map_err(io_error)?;
        if original_metadata.dev() != current_metadata.dev()
            || original_metadata.ino() != current_metadata.ino()
        {
            return Err(refused("The worktree directory changed while reading."));
        }
        let current_parent = descend(&current_root, parent).map_err(io_error)?;
        let after = statat(&current_parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(io_error)?;
        if link_identity(&before) != link_identity(&after) {
            return Err(refused("The selected working path changed while reading."));
        }
        if content
            .bytes
            .as_ref()
            .is_some_and(|bytes| bytes.len() as u64 != size)
        {
            return Err(refused("The selected link content changed while reading."));
        }
        Ok(content)
    }
}
#[cfg(not(unix))]
mod worktree {
    use super::*;
    pub(super) fn read(_: &Path, _: &str, _: &CancellationToken) -> Result<FileContent, AppError> {
        Err(refused(
            "Working-file content inspection needs a repository-contained file reader on this platform.",
        ))
    }
}

#[cfg(test)]
#[path = "file_content_tests.rs"]
mod tests;
