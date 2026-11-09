//! Private, bounded file copies for explicitly launched comparison/merge tools.
//! The native caller supplies its own application-data parent and effective UID.
//! Creating, reading or discarding these files never changes repository content.
use super::{AppError, MAX_FILE_CONTENT_BYTES};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum FileToolSnapshotRole {
    Before,
    After,
    Base,
    Merged,
}
impl FileToolSnapshotRole {
    fn name(self) -> &'static str {
        match self {
            Self::Before => "before",
            Self::After => "after",
            Self::Base => "base",
            Self::Merged => "merged",
        }
    }
}
fn refused(message: &str) -> AppError {
    AppError::new(
        "fileToolSnapshotRefused",
        message,
        Some("Review the retained tool files. No repository content was changed."),
    )
}
fn io<T>(value: std::io::Result<T>) -> Result<T, AppError> {
    value.map_err(|_| refused("The private tool files could not be inspected or persisted."))
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use crate::file_content::worktree::{absolute, identity};
    use rustix::fs::{AtFlags, FlockOperation, Mode, OFlags, flock, mkdirat, openat, unlinkat};
    use std::{
        collections::BTreeMap,
        fs::File,
        io::{Read, Write},
        os::{fd::AsRawFd, unix::fs::MetadataExt},
    };

    struct ParentLock<'a>(&'a File);
    impl Drop for ParentLock<'_> {
        fn drop(&mut self) {
            let _ = flock(self.0, FlockOperation::Unlock);
        }
    }
    struct Input {
        file: File,
        name: String,
        metadata: std::fs::Metadata,
        bytes: Option<Vec<u8>>,
    }
    /// Kept alive until the native tool owner confirms that cleanup is appropriate.
    /// Drop deliberately does not remove files: detached GUI tools may still use them.
    pub struct FileToolSnapshots {
        parent: File,
        parent_path: PathBuf,
        directory: File,
        path: PathBuf,
        name: String,
        uid: u32,
        files: BTreeMap<FileToolSnapshotRole, Input>,
        discarded: bool,
    }
    /// A particular complete output read. Replacement or subsequent edits invalidate it.
    /// This is deliberately not deserializable and cannot authorize renderer paths.
    pub struct FileToolResult {
        file: File,
        metadata: std::fs::Metadata,
        bytes: Vec<u8>,
    }
    impl std::fmt::Debug for FileToolResult {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("FileToolResult")
                .field("bytes", &self.bytes.len())
                .finish_non_exhaustive()
        }
    }
    impl FileToolResult {
        pub fn bytes(&self) -> &[u8] {
            &self.bytes
        }
        pub fn sha256(&self) -> Result<String, AppError> {
            let mut hasher = gix::hash::hasher(gix::hash::Kind::Sha256);
            hasher.update(&self.bytes);
            hasher
                .try_finalize()
                .map(|hash| hash.to_string())
                .map_err(|_| refused("The reviewed tool output could not be fingerprinted."))
        }
    }
    fn syscall<T>(value: Result<T, rustix::io::Errno>) -> Result<T, AppError> {
        value.map_err(|_| {
            refused("The private tool file could not be opened without following links.")
        })
    }
    fn same_directory(a: &std::fs::Metadata, b: &std::fs::Metadata, uid: u32) -> bool {
        a.is_dir()
            && b.is_dir()
            && a.uid() == uid
            && b.uid() == uid
            && a.mode() & 0o077 == 0
            && b.mode() & 0o077 == 0
            && (a.dev(), a.ino()) == (b.dev(), b.ino())
    }
    fn bounded_file(metadata: &std::fs::Metadata, uid: u32) -> bool {
        metadata.is_file()
            && metadata.uid() == uid
            && metadata.nlink() == 1
            && metadata.len() <= MAX_FILE_CONTENT_BYTES as u64
    }
    impl FileToolSnapshots {
        /// The parent is native-selected, not an IPC path. Existing foreign or
        /// non-private parents are refused rather than chmodded or replaced.
        pub fn create(parent: &Path, uid: u32) -> Result<Self, AppError> {
            if !parent.is_absolute() {
                return Err(refused("An absolute private tool directory is required."));
            }
            let ancestor = parent
                .parent()
                .ok_or_else(|| refused("Choose a dedicated tool parent directory."))?;
            let leaf = parent
                .file_name()
                .ok_or_else(|| refused("Choose a dedicated tool parent directory."))?;
            let ancestor_file = File::from(absolute(ancestor)?);
            match mkdirat(&ancestor_file, leaf, Mode::RWXU) {
                Ok(()) => (),
                Err(rustix::io::Errno::EXIST) => (),
                Err(_) => return Err(refused("The private tool parent could not be created.")),
            }
            let parent_file = File::from(syscall(openat(
                &ancestor_file,
                leaf,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            ))?);
            if !same_directory(
                &io(parent_file.metadata())?,
                &io(std::fs::symlink_metadata(parent))?,
                uid,
            ) {
                return Err(refused(
                    "The tool parent is not private to the current user.",
                ));
            }
            let (name, directory) = {
                flock(&parent_file, FlockOperation::NonBlockingLockExclusive)
                    .map_err(|_| refused("Another preparation owns the tool parent lock. Wait before preparing again."))?;
                let _lock = ParentLock(&parent_file);
                let entries = io(std::fs::read_dir(format!(
                    "/proc/self/fd/{}",
                    parent_file.as_raw_fd()
                )))?;
                let mut count = 0;
                for entry in entries {
                    let entry = io(entry)?;
                    let name = entry.file_name();
                    let name = name
                        .to_str()
                        .ok_or_else(|| refused("Unknown tool-parent material was retained."))?;
                    if name.len() != 32
                        || !name
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    {
                        return Err(refused("Unknown tool-parent material was retained."));
                    }
                    let child = File::from(syscall(openat(
                        &parent_file,
                        name,
                        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                        Mode::empty(),
                    ))?);
                    let metadata = io(child.metadata())?;
                    if !same_directory(&metadata, &metadata, uid) {
                        return Err(refused(
                            "A foreign or non-private tool session was retained.",
                        ));
                    }
                    count += 1;
                    if count >= 16 {
                        return Err(refused(
                            "Review retained tool sessions before preparing another.",
                        ));
                    }
                }
                let mut random = [0u8; 16];
                getrandom::fill(&mut random)
                    .map_err(|_| refused("A unique tool session could not be created."))?;
                let name: String = random.iter().map(|value| format!("{value:02x}")).collect();
                syscall(mkdirat(&parent_file, name.as_str(), Mode::RWXU))?;
                let directory = File::from(syscall(openat(
                    &parent_file,
                    name.as_str(),
                    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                ))?);
                (name, directory)
            };
            let snapshots = Self {
                path: parent.join(&name),
                parent: parent_file,
                parent_path: parent.to_owned(),
                directory,
                name,
                uid,
                files: BTreeMap::new(),
                discarded: false,
            };
            snapshots.check()?;
            io(snapshots.parent.sync_all())?;
            snapshots.check()?;
            Ok(snapshots)
        }
        pub fn path(&self) -> &Path {
            &self.path
        }
        fn check(&self) -> Result<(), AppError> {
            if self.discarded {
                return Err(refused("That tool session was already discarded."));
            }
            let current_parent = File::from(absolute(&self.parent_path)?);
            if !same_directory(
                &io(self.parent.metadata())?,
                &io(current_parent.metadata())?,
                self.uid,
            ) {
                return Err(refused("The private tool parent changed."));
            }
            let current = File::from(syscall(openat(
                &current_parent,
                self.name.as_str(),
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            ))?);
            if !same_directory(
                &io(self.directory.metadata())?,
                &io(current.metadata())?,
                self.uid,
            ) {
                return Err(refused("The private tool session directory changed."));
            }
            Ok(())
        }
        fn opened(&self, name: &str) -> Result<File, AppError> {
            let file = File::from(syscall(openat(
                &self.directory,
                name,
                OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            ))?);
            if !bounded_file(&io(file.metadata())?, self.uid) {
                return Err(refused(
                    "The tool file is not a bounded regular file owned by this user.",
                ));
            }
            Ok(file)
        }
        /// Fixed roles own at most four files. The optional extension is only a
        /// presentation hint; it cannot supply a path or a second role.
        pub fn materialize(
            &mut self,
            role: FileToolSnapshotRole,
            extension: Option<&str>,
            bytes: &[u8],
        ) -> Result<PathBuf, AppError> {
            self.check()?;
            if bytes.len() > MAX_FILE_CONTENT_BYTES || self.files.contains_key(&role) {
                return Err(refused(
                    "That tool file already exists or exceeds the content limit.",
                ));
            }
            let extension = extension.filter(|value| {
                !value.is_empty()
                    && value.len() <= 16
                    && value.bytes().all(|b| b.is_ascii_alphanumeric())
            });
            let name = extension.map_or_else(
                || role.name().to_owned(),
                |value| format!("{}.{value}", role.name()),
            );
            let mut file = File::from(syscall(openat(
                &self.directory,
                name.as_str(),
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            ))?);
            io(file.write_all(bytes))?;
            let mode = if role == FileToolSnapshotRole::Merged {
                0o600
            } else {
                0o400
            };
            io(file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(mode)))?;
            io(file.sync_all())?;
            let metadata = io(file.metadata())?;
            if !bounded_file(&metadata, self.uid) {
                return Err(refused("The prepared tool file changed."));
            }
            self.files.insert(
                role,
                Input {
                    file,
                    name: name.clone(),
                    metadata,
                    bytes: (role != FileToolSnapshotRole::Merged).then(|| bytes.to_vec()),
                },
            );
            self.check()?;
            io(self.directory.sync_all())?;
            self.check()?;
            Ok(self.path.join(name))
        }
        pub fn verify_inputs(&self) -> Result<(), AppError> {
            self.check()?;
            for (role, input) in &self.files {
                if *role == FileToolSnapshotRole::Merged {
                    continue;
                }
                let mut current = self.opened(&input.name)?;
                if identity(&io(input.file.metadata())?) != identity(&input.metadata)
                    || identity(&io(current.metadata())?) != identity(&input.metadata)
                {
                    return Err(refused(
                        "A tool input changed or was replaced after preparation.",
                    ));
                }
                let mut bytes = Vec::new();
                io((&mut current)
                    .take(MAX_FILE_CONTENT_BYTES as u64 + 1)
                    .read_to_end(&mut bytes))?;
                if input.bytes.as_deref() != Some(bytes.as_slice())
                    || identity(&io(current.metadata())?) != identity(&input.metadata)
                {
                    return Err(refused(
                        "A tool input changed while its complete bytes were checked.",
                    ));
                }
            }
            self.check()
        }
        /// Atomic replacement by a tool is permitted. A later review binds the
        /// exact resulting inode/metadata/bytes, independently of its exit code.
        pub fn read_result(&self) -> Result<FileToolResult, AppError> {
            self.verify_inputs()?;
            let input = self
                .files
                .get(&FileToolSnapshotRole::Merged)
                .ok_or_else(|| refused("This tool session has no merge output."))?;
            let mut file = self.opened(&input.name)?;
            let metadata = io(file.metadata())?;
            let mut bytes = Vec::new();
            io((&mut file)
                .take(MAX_FILE_CONTENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes))?;
            if bytes.len() > MAX_FILE_CONTENT_BYTES
                || identity(&metadata) != identity(&io(file.metadata())?)
            {
                return Err(refused("The tool output changed during review."));
            }
            let result = FileToolResult {
                file,
                metadata,
                bytes,
            };
            self.verify_result(&result)?;
            Ok(result)
        }
        pub fn verify_result(&self, result: &FileToolResult) -> Result<(), AppError> {
            self.verify_inputs()?;
            let input = self
                .files
                .get(&FileToolSnapshotRole::Merged)
                .ok_or_else(|| refused("This tool session has no merge output."))?;
            let mut current = self.opened(&input.name)?;
            if identity(&io(result.file.metadata())?) != identity(&result.metadata)
                || identity(&io(current.metadata())?) != identity(&result.metadata)
            {
                return Err(refused(
                    "The reviewed tool output changed. Review it again before applying.",
                ));
            }
            let mut bytes = Vec::new();
            io((&mut current)
                .take(MAX_FILE_CONTENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes))?;
            if bytes != result.bytes
                || identity(&io(current.metadata())?) != identity(&result.metadata)
            {
                return Err(refused(
                    "The reviewed tool output bytes changed. Review it again before applying.",
                ));
            }
            self.check()
        }
        /// Caller must first settle its owned process lifetime, including detached
        /// launches. Unexpected/replaced inputs and unknown entries are preserved.
        pub fn discard(&mut self) -> Result<(), AppError> {
            self.verify_inputs()?;
            let mut known = BTreeMap::new();
            for (role, input) in &self.files {
                let current = self.opened(&input.name)?;
                let metadata = io(current.metadata())?;
                if *role != FileToolSnapshotRole::Merged
                    && identity(&metadata) != identity(&input.metadata)
                {
                    return Err(refused("A replaced tool input was retained."));
                }
                known.insert(input.name.clone(), (*role, metadata));
            }
            let entries = io(std::fs::read_dir(format!(
                "/proc/self/fd/{}",
                self.directory.as_raw_fd()
            )))?;
            for entry in entries {
                let name = io(entry)?.file_name();
                if !known.contains_key(
                    name.to_str()
                        .ok_or_else(|| refused("An unknown tool file was retained."))?,
                ) {
                    return Err(refused(
                        "The tool directory contains unexpected files. They were retained.",
                    ));
                }
            }
            self.check()?;
            for (name, (role, expected)) in known {
                let current = self.opened(&name)?;
                if identity(&io(current.metadata())?) != identity(&expected) {
                    return Err(refused(
                        "A tool file changed during cleanup and was retained.",
                    ));
                }
                syscall(unlinkat(&self.directory, name.as_str(), AtFlags::empty()))?;
                self.files.remove(&role);
            }
            self.check()?;
            syscall(unlinkat(
                &self.parent,
                self.name.as_str(),
                AtFlags::REMOVEDIR,
            ))?;
            self.discarded = true;
            io(self.parent.sync_all())
        }
    }
}
#[cfg(target_os = "linux")]
pub use linux::{FileToolResult, FileToolSnapshots};

#[cfg(test)]
#[cfg(target_os = "linux")]
#[path = "file_tool_snapshots_tests.rs"]
mod tests;
