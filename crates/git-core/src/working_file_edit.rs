//! Explicit, bounded working-file saves with fresh byte/identity preconditions.
use super::*;

#[derive(Clone)]
pub struct WorkingFileEdit {
    root: PathBuf,
    file: String,
    bytes: Vec<u8>,
    text: DecodedWorkingText,
    identity: platform::Identity,
    context: RepositoryEditContext,
    consumed: std::sync::Arc<std::sync::Mutex<bool>>,
}
impl std::fmt::Debug for WorkingFileEdit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkingFileEdit")
            .field("encoding", &self.text.encoding())
            .finish_non_exhaustive()
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WorkingFileWriteStatus {
    Unchanged,
    Saved,
    Unconfirmed,
}
#[derive(Debug)]
pub struct WorkingFileSave {
    /// Unconfirmed invalidates this edit: reload; never replay or stage it.
    pub status: WorkingFileWriteStatus,
    /// None means the committed/current path could not be confirmed; reload it.
    pub next: Option<WorkingFileEdit>,
    pub warning: Option<String>,
}
#[derive(Clone, PartialEq, Eq)]
struct RepositoryEditContext {
    git_directory: PathBuf,
    directory_identity: Option<(u64, u64)>,
    common_directory: PathBuf,
    common_identity: Option<(u64, u64)>,
    reference: Option<String>,
    head_oid: Option<String>,
    object_format: String,
}
fn metadata_line(bytes: &[u8]) -> Result<String, AppError> {
    let bytes = bytes
        .strip_suffix(b"\n")
        .ok_or_else(|| refused("Repository context was incomplete."))?;
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| refused("Repository context is not valid UTF-8."))
}
fn repository_context(
    root: &Path,
    cancellation: &CancellationToken,
) -> Result<RepositoryEditContext, AppError> {
    check_cancel(cancellation)?;
    git_cancellation::with(Some(cancellation), || {
        let git_directory = PathBuf::from(metadata_line(&file_content::metadata_git(
            root,
            &["rev-parse", "--absolute-git-dir"],
        )?)?)
        .canonicalize()
        .map_err(|_| changed())?;
        let metadata = fs::metadata(&git_directory).map_err(|_| changed())?;
        if !metadata.is_dir() {
            return Err(changed());
        }
        #[cfg(target_os = "linux")]
        let directory_identity = {
            use std::os::unix::fs::MetadataExt;
            Some((metadata.dev(), metadata.ino()))
        };
        #[cfg(not(target_os = "linux"))]
        let directory_identity = None;
        let common_directory = PathBuf::from(metadata_line(&file_content::metadata_git(
            root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?)?)
        .canonicalize()
        .map_err(|_| changed())?;
        let common_metadata = fs::metadata(&common_directory).map_err(|_| changed())?;
        if !common_metadata.is_dir() {
            return Err(changed());
        }
        #[cfg(target_os = "linux")]
        let common_identity = {
            use std::os::unix::fs::MetadataExt;
            Some((common_metadata.dev(), common_metadata.ino()))
        };
        #[cfg(not(target_os = "linux"))]
        let common_identity = None;
        let (symbolic, truncated) =
            file_content::content_git(root, &["symbolic-ref", "--quiet", "HEAD"], 64 * 1024)?;
        if truncated {
            return Err(refused(
                "The current reference exceeds the editor context limit.",
            ));
        }
        let reference = match symbolic.status.code() {
            Some(0) => Some(metadata_line(&symbolic.stdout)?),
            Some(1) => None,
            _ => return Err(refused("The current symbolic HEAD could not be read.")),
        };
        let (head, truncated) =
            file_content::content_git(root, &["rev-parse", "--verify", "--quiet", "HEAD"], 1024)?;
        if truncated {
            return Err(refused(
                "The current HEAD exceeds the editor context limit.",
            ));
        }
        let head_oid = match head.status.code() {
            Some(0) => {
                let oid = metadata_line(&head.stdout)?;
                validate_commit_oid(&oid)?;
                Some(oid)
            }
            Some(1) if reference.is_some() => None,
            _ => return Err(refused("The current HEAD is unavailable for editing.")),
        };
        let object_format = metadata_line(&file_content::metadata_git(
            root,
            &["rev-parse", "--show-object-format"],
        )?)?;
        if !matches!(object_format.as_str(), "sha1" | "sha256") {
            return Err(refused(
                "The repository object format is unsupported for editing.",
            ));
        }
        check_cancel(cancellation)?;
        Ok(RepositoryEditContext {
            git_directory,
            directory_identity,
            common_directory,
            common_identity,
            reference,
            head_oid,
            object_format,
        })
    })
}
fn refused(message: &str) -> AppError {
    AppError::new(
        "workingFileEditRefused",
        message,
        Some("Reload the working file before retrying. Retain your unsaved draft."),
    )
}
fn changed() -> AppError {
    refused("The working file or its containing repository changed. No edit was saved.")
}
fn check_cancel(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        Err(operation_cancelled())
    } else {
        Ok(())
    }
}
fn validate(file: &str) -> Result<(), AppError> {
    file_content::validate_file(file)?;
    if Path::new(file).components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return Err(refused("Git metadata is not an editable working file."));
    }
    Ok(())
}
pub fn open_working_file_edit(
    root: &Path,
    file: &str,
    encoding: Option<WorkingTextEncoding>,
    cancellation: &CancellationToken,
) -> Result<WorkingFileEdit, AppError> {
    validate(file)?;
    check_cancel(cancellation)?;
    let root = git_cancellation::with(Some(cancellation), || file_content::worktree_root(root))?;
    let context = repository_context(&root, cancellation)?;
    let (bytes, identity) = platform::read(&root, file, cancellation)?;
    let text = decode_working_text(&bytes, encoding)?;
    if repository_context(&root, cancellation)? != context {
        return Err(changed());
    }
    Ok(WorkingFileEdit {
        root,
        file: file.into(),
        bytes,
        text,
        identity,
        context,
        consumed: Default::default(),
    })
}
impl WorkingFileEdit {
    /// Capture this editor's original metadata without retaining save authority.
    pub fn recovery_binding(
        &self,
    ) -> Result<crate::draft_recovery_editor::WorkingFileRecoveryBinding, AppError> {
        crate::draft_recovery_editor::WorkingFileRecoveryBinding::capture(&self.root, self)
    }
    pub fn path(&self) -> &str {
        &self.file
    }
    pub fn encoded_byte_len(&self) -> usize {
        self.bytes.len()
    }
    pub fn text(&self) -> &DecodedWorkingText {
        &self.text
    }
    pub fn working_reference(&self) -> Option<&str> {
        self.context.reference.as_deref()
    }
    pub fn head_oid(&self) -> Option<&str> {
        self.context.head_oid.as_deref()
    }
    fn verify_context(&self, cancellation: &CancellationToken) -> Result<(), AppError> {
        let root = git_cancellation::with(Some(cancellation), || {
            file_content::worktree_root(&self.root)
        })?;
        if root != self.root || repository_context(&self.root, cancellation)? != self.context {
            return Err(changed());
        }
        Ok(())
    }
    /// Read-only validation for staging the reviewed disk version, without
    /// submitting or interpreting an unsaved client buffer.
    pub fn verify_current(&self, cancellation: &CancellationToken) -> Result<(), AppError> {
        let consumed = self.consumed.lock().map_err(|_| {
            refused("The edit context is no longer available. Reload before retrying.")
        })?;
        if *consumed {
            return Err(refused(
                "This edit context was already used. Reload before retrying.",
            ));
        }
        self.verify_context(cancellation)?;
        let (bytes, identity) = platform::read(&self.root, &self.file, cancellation)?;
        if bytes != self.bytes || identity != self.identity {
            return Err(changed());
        }
        Ok(())
    }
    pub fn read_only_reason(&self) -> Option<&'static str> {
        platform::read_only_reason(&self.identity)
    }

    /// The final pre-rename check detects observed external changes; it is not
    /// a transaction lock against unrelated programs writing after that check.
    /// Once replacement succeeds, a later confirmation/durability problem is
    /// returned as a successful write with a warning, never as an unsaved error.
    pub fn save(
        &self,
        replacement: &str,
        cancellation: &CancellationToken,
    ) -> Result<WorkingFileSave, AppError> {
        self.save_using(replacement, cancellation, platform::replace)
    }
    fn save_using(
        &self,
        replacement: &str,
        cancellation: &CancellationToken,
        replace: impl FnOnce(
            &Self,
            &[u8],
            &CancellationToken,
        ) -> Result<(WorkingFileWriteStatus, Option<String>), AppError>,
    ) -> Result<WorkingFileSave, AppError> {
        let stale = || {
            AppError::new(
                "workingFileEditStale",
                "This edit context was already used or its save outcome is unconfirmed.",
                Some("Retain the draft and reload the current disk version before retrying."),
            )
        };
        let mut consumed = self.consumed.lock().map_err(|_| stale())?;
        if *consumed {
            return Err(stale());
        }
        check_cancel(cancellation)?;
        let encoded = self.text.encode_replacement(replacement)?;
        let encoded_text = decode_working_text(&encoded, Some(self.text.encoding()))?;
        self.verify_context(cancellation)?;
        let (status, durability) = replace(self, &encoded, cancellation)?;
        *consumed = true;
        if status == WorkingFileWriteStatus::Unconfirmed {
            return Ok(WorkingFileSave {
                status,
                next: None,
                warning: durability,
            });
        }
        let confirmed_context = repository_context(&self.root, cancellation).ok();
        let next = match platform::read(&self.root, &self.file, cancellation) {
            Ok((bytes, identity))
                if bytes == encoded && confirmed_context.as_ref() == Some(&self.context) =>
            {
                Some(Self {
                    root: self.root.clone(),
                    file: self.file.clone(),
                    text: encoded_text,
                    bytes,
                    identity,
                    context: self.context.clone(),
                    consumed: Default::default(),
                })
            }
            _ => None,
        };
        let warning = if next.is_none() {
            Some(if status == WorkingFileWriteStatus::Saved { "The edit was saved, but the current path could not be confirmed. Reload before saving again." }
                 else { "The file was not rewritten, and its current path could not be confirmed. Reload before saving again." }.into())
        } else {
            durability
        };
        Ok(WorkingFileSave {
            status,
            next,
            warning,
        })
    }
}

// Shared native byte baseline; text decoding is deliberately outside publication.
#[cfg(target_os = "linux")]
struct ByteBaseline<'a> {
    root: &'a Path,
    file: &'a str,
    bytes: &'a [u8],
    identity: &'a platform::Identity,
    context: &'a RepositoryEditContext,
    limit: usize,
}
#[cfg(target_os = "linux")]
impl ByteBaseline<'_> {
    fn verify_context(&self, cancellation: &CancellationToken) -> Result<(), AppError> {
        let current = git_cancellation::with(Some(cancellation), || {
            file_content::worktree_root(self.root)
        })?;
        if current != self.root || repository_context(self.root, cancellation)? != *self.context {
            return Err(changed());
        }
        Ok(())
    }
}
#[cfg(target_os = "linux")]
#[path = "working_file_bytes.rs"]
pub(crate) mod bytes;

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use rustix::fs::{
        AtFlags, Mode, OFlags, XattrFlags, fchmod, fgetxattr, flistxattr, fremovexattr, fsetxattr,
        openat, renameat, statat, unlinkat,
    };
    use std::ffi::{CString, OsString};
    use std::io::{Read, Write};
    use std::os::fd::OwnedFd;
    use std::os::unix::fs::MetadataExt;
    type FileIdentity = (u64, u64, u32, u64, i64, i64, i64, i64);
    type Attributes = Vec<(CString, Vec<u8>)>;
    #[derive(Clone, PartialEq, Eq)]
    pub(super) struct Identity {
        root: (u64, u64),
        parent: (u64, u64),
        file: FileIdentity,
        uid: u32,
        gid: u32,
        attributes: Attributes,
    }
    struct Location {
        root: OwnedFd,
        parent: OwnedFd,
        name: OsString,
    }
    fn io<T>(result: std::io::Result<T>) -> Result<T, AppError> {
        result.map_err(|_| {
            refused("The working file could not be accessed with its original metadata.")
        })
    }
    fn syscall<T>(result: Result<T, rustix::io::Errno>) -> Result<T, AppError> {
        result.map_err(|_| {
            refused("The working file could not be accessed safely. No edit was saved.")
        })
    }
    fn inode(metadata: &fs::Metadata) -> (u64, u64) {
        (metadata.dev(), metadata.ino())
    }
    fn directory_inode(fd: &OwnedFd) -> Result<(u64, u64), AppError> {
        Ok(inode(&io(fs::File::from(io(fd.try_clone())?).metadata())?))
    }
    impl Location {
        fn new(root: &Path, file: &str) -> Result<Self, AppError> {
            let root = file_content::worktree::absolute(root).map_err(|_| changed())?;
            let relative = Path::new(file);
            let parent = file_content::worktree::descend_worktree(
                &root,
                relative.parent().unwrap_or(Path::new("")),
            )
            .map_err(|error| {
                if matches!(
                    error,
                    file_content::worktree::WorktreeParentError::NestedRepository
                ) {
                    refused("Working-file editing cannot cross a nested repository boundary.")
                } else {
                    changed()
                }
            })?;
            let name = relative.file_name().ok_or_else(changed)?.to_owned();
            Ok(Self { root, parent, name })
        }
        fn open(&self) -> Result<fs::File, AppError> {
            let fd = syscall(openat(
                &self.parent,
                self.name.as_os_str(),
                OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            ))?;
            let file = fs::File::from(fd);
            if !io(file.metadata())?.is_file() {
                return Err(refused(
                    "Only existing regular working files can be edited.",
                ));
            }
            Ok(file)
        }
    }
    fn attributes(file: &fs::File) -> Result<Attributes, AppError> {
        let mut names = vec![0; 64 * 1024];
        let count = match flistxattr(file, names.as_mut_slice()) {
            Ok(count) => count,
            Err(rustix::io::Errno::NOTSUP) => return Ok(Vec::new()),
            Err(_) => {
                return Err(refused(
                    "The file's extended attributes could not be inspected.",
                ));
            }
        };
        names.truncate(count);
        if !names.is_empty() && names.last() != Some(&0) {
            return Err(refused("The file's metadata could not be read completely."));
        }
        let mut values = Vec::new();
        let mut total = count;
        for name in names
            .split(|byte| *byte == 0)
            .filter(|name| !name.is_empty())
        {
            let name =
                CString::new(name).map_err(|_| refused("The file has unsupported metadata."))?;
            let mut value = vec![0; 64 * 1024];
            let count = syscall(fgetxattr(file, name.as_c_str(), value.as_mut_slice()))?;
            value.truncate(count);
            total += count;
            if total > 256 * 1024 {
                return Err(refused(
                    "The file's extended metadata exceeds the editor limit.",
                ));
            }
            values.push((name, value));
        }
        values.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
        Ok(values)
    }
    pub(super) fn read_only_reason(identity: &Identity) -> Option<&'static str> {
        if identity.file.2 & 0o200 == 0 {
            return Some("The file owner has no write permission.");
        }
        if identity.file.2 & 0o7000 != 0 {
            return Some("Files with special permission bits require an external editor.");
        }
        if identity.attributes.iter().any(|(name, _)| {
            let name = name.as_bytes();
            name.starts_with(b"trusted.")
                || (name.starts_with(b"security.") && name != b"security.selinux")
        }) {
            return Some(
                "This file has protected metadata that this editor cannot safely maintain.",
            );
        }
        None
    }
    pub(super) fn read(
        root: &Path,
        file: &str,
        cancellation: &CancellationToken,
    ) -> Result<(Vec<u8>, Identity), AppError> {
        read_bounded(root, file, cancellation, MAX_WORKING_TEXT_BYTES)
    }
    pub(super) fn read_bounded(
        root: &Path,
        file: &str,
        cancellation: &CancellationToken,
        limit: usize,
    ) -> Result<(Vec<u8>, Identity), AppError> {
        check_cancel(cancellation)?;
        let location = Location::new(root, file)?;
        let mut input = location.open()?;
        let before = io(input.metadata())?;
        if before.len() > limit as u64 {
            return Err(refused(
                "The working file exceeds the selected write limit.",
            ));
        }
        let mut bytes = Vec::new();
        let mut buffer = [0; 64 * 1024];
        loop {
            check_cancel(cancellation)?;
            let count = match input.read(&mut buffer) {
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                result => io(result)?,
            };
            if count == 0 {
                break;
            }
            if bytes.len() + count > limit {
                return Err(refused(
                    "The working file grew beyond the selected write limit.",
                ));
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        let attributes = attributes(&input)?;
        let identity = Identity {
            root: directory_inode(&location.root)?,
            parent: directory_inode(&location.parent)?,
            file: file_content::worktree::identity(&before),
            uid: before.uid(),
            gid: before.gid(),
            attributes,
        };
        let fresh = Location::new(root, file)?;
        if identity.root != directory_inode(&fresh.root)?
            || identity.parent != directory_inode(&fresh.parent)?
            || identity.file != file_content::worktree::identity(&io(input.metadata())?)
            || identity.file != file_content::worktree::identity(&io(fresh.open()?.metadata())?)
            || bytes.len() as u64 != before.len()
        {
            return Err(changed());
        }
        check_cancel(cancellation)?;
        Ok((bytes, identity))
    }
    struct Temporary<'a> {
        location: &'a Location,
        name: String,
        file: &'a fs::File,
        armed: bool,
    }
    impl Temporary<'_> {
        fn remove(&self) -> Result<(), rustix::io::Errno> {
            let actual = match statat(
                &self.location.parent,
                self.name.as_str(),
                AtFlags::SYMLINK_NOFOLLOW,
            ) {
                Ok(actual) => actual,
                Err(rustix::io::Errno::NOENT) => return Ok(()),
                Err(error) => return Err(error),
            };
            let owned = self.file.metadata().map_err(|_| rustix::io::Errno::IO)?;
            if (actual.st_dev, actual.st_ino) != inode(&owned) {
                return Err(rustix::io::Errno::BUSY);
            }
            unlinkat(&self.location.parent, self.name.as_str(), AtFlags::empty())
        }
    }
    impl Drop for Temporary<'_> {
        fn drop(&mut self) {
            if self.armed {
                let _ = self.remove();
            }
        }
    }
    fn copy_attributes(from: &Identity, output: &fs::File) -> Result<(), AppError> {
        let current = attributes(output)?;
        for (name, _) in &current {
            if !from.attributes.iter().any(|(key, _)| key == name) {
                syscall(fremovexattr(output, name.as_c_str()))?;
            }
        }
        for (name, value) in &from.attributes {
            if !current
                .iter()
                .any(|(key, data)| key == name && data == value)
            {
                syscall(fsetxattr(
                    output,
                    name.as_c_str(),
                    value,
                    XattrFlags::empty(),
                ))?;
            }
        }
        Ok(())
    }
    type RenameOperation =
        fn(&OwnedFd, &str, &OwnedFd, &std::ffi::OsStr) -> Result<(), rustix::io::Errno>;
    fn rename_file(
        from: &OwnedFd,
        name: &str,
        to: &OwnedFd,
        target: &std::ffi::OsStr,
    ) -> Result<(), rustix::io::Errno> {
        renameat(from, name, to, target)
    }
    #[cfg(test)]
    pub(super) fn replace_with_lost_reply(
        edit: &WorkingFileEdit,
        encoded: &[u8],
        cancellation: &CancellationToken,
        apply: bool,
    ) -> Result<(WorkingFileWriteStatus, Option<String>), AppError> {
        fn applied(
            from: &OwnedFd,
            name: &str,
            to: &OwnedFd,
            target: &std::ffi::OsStr,
        ) -> Result<(), rustix::io::Errno> {
            renameat(from, name, to, target)?;
            Err(rustix::io::Errno::IO)
        }
        fn unapplied(
            _: &OwnedFd,
            _: &str,
            _: &OwnedFd,
            _: &std::ffi::OsStr,
        ) -> Result<(), rustix::io::Errno> {
            Err(rustix::io::Errno::IO)
        }
        replace_using(
            edit,
            encoded,
            cancellation,
            if apply { applied } else { unapplied },
            |_, _| Ok(()),
        )
    }
    pub(super) fn replace(
        edit: &WorkingFileEdit,
        encoded: &[u8],
        cancellation: &CancellationToken,
    ) -> Result<(WorkingFileWriteStatus, Option<String>), AppError> {
        replace_using(edit, encoded, cancellation, rename_file, |_, _| Ok(()))
    }
    #[cfg(test)]
    pub(super) fn replace_with_changed_temporary(
        edit: &WorkingFileEdit,
        encoded: &[u8],
        cancellation: &CancellationToken,
        swap: bool,
    ) -> Result<(WorkingFileWriteStatus, Option<String>), AppError> {
        replace_using(edit, encoded, cancellation, rename_file, |parent, name| {
            if swap {
                // Keep the old inode linked so the replacement cannot reuse it.
                renameat(parent, name, parent, "owned-displaced-temporary")?;
            }
            let fd = openat(
                parent,
                name,
                OFlags::WRONLY | OFlags::CREATE | OFlags::TRUNC | OFlags::NOFOLLOW,
                Mode::RUSR | Mode::WUSR,
            )?;
            fs::File::from(fd)
                .write_all(b"owned changed temporary")
                .map_err(|_| rustix::io::Errno::IO)
        })
    }
    fn replace_using(
        edit: &WorkingFileEdit,
        encoded: &[u8],
        cancellation: &CancellationToken,
        rename: RenameOperation,
        before_verify_temporary: impl FnOnce(&OwnedFd, &str) -> Result<(), rustix::io::Errno>,
    ) -> Result<(WorkingFileWriteStatus, Option<String>), AppError> {
        let baseline = ByteBaseline {
            root: &edit.root,
            file: &edit.file,
            bytes: &edit.bytes,
            identity: &edit.identity,
            context: &edit.context,
            limit: MAX_WORKING_TEXT_BYTES,
        };
        replace_bytes_using(
            &baseline,
            encoded,
            cancellation,
            rename,
            before_verify_temporary,
            || Ok(()),
        )
    }
    pub(super) fn replace_bytes(
        baseline: &ByteBaseline<'_>,
        replacement: &[u8],
        cancellation: &CancellationToken,
        guard: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(WorkingFileWriteStatus, Option<String>), AppError> {
        replace_bytes_using(
            baseline,
            replacement,
            cancellation,
            rename_file,
            |_, _| Ok(()),
            guard,
        )
    }
    fn replace_bytes_using(
        edit: &ByteBaseline<'_>,
        encoded: &[u8],
        cancellation: &CancellationToken,
        rename: RenameOperation,
        before_verify_temporary: impl FnOnce(&OwnedFd, &str) -> Result<(), rustix::io::Errno>,
        guard: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<(WorkingFileWriteStatus, Option<String>), AppError> {
        if encoded.len() > edit.limit {
            return Err(refused("The replacement exceeds the selected write limit."));
        }
        let (current, identity) = read_bounded(edit.root, edit.file, cancellation, edit.limit)?;
        if &identity != edit.identity || current != edit.bytes {
            return Err(changed());
        }
        if let Some(reason) = read_only_reason(&identity) {
            return Err(refused(reason));
        }
        if encoded == edit.bytes {
            return Ok((WorkingFileWriteStatus::Unchanged, None));
        }
        let location = Location::new(edit.root, edit.file)?;
        if identity.root != directory_inode(&location.root)?
            || identity.parent != directory_inode(&location.parent)?
        {
            return Err(changed());
        }
        let mut random = [0; 16];
        getrandom::fill(&mut random)
            .map_err(|_| refused("An owned save temporary file could not be named."))?;
        let name = format!(
            ".git-khronos-edit-{}",
            random
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        let fd = syscall(openat(
            &location.parent,
            name.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        ))?;
        let output = fs::File::from(fd);
        let mut temporary = Temporary {
            location: &location,
            name,
            file: &output,
            armed: true,
        };
        let mut commit_attempted = false;
        let attempt = (|| {
            let created = io(output.metadata())?;
            if created.uid() != identity.uid || created.gid() != identity.gid {
                return Err(refused(
                    "The file's original ownership cannot be preserved by this editor.",
                ));
            }
            let mut writer = &output;
            for chunk in encoded.chunks(64 * 1024) {
                check_cancel(cancellation)?;
                io(writer.write_all(chunk))?;
            }
            copy_attributes(&identity, &output)?;
            syscall(fchmod(
                &output,
                Mode::from_bits_truncate(identity.file.2 & 0o777),
            ))?;
            if attributes(&output)? != identity.attributes {
                return Err(refused(
                    "The original file attributes could not be preserved exactly.",
                ));
            }
            io(output.sync_all())?;
            let prepared = io(output.metadata())?;
            guard()?;
            // Rewalk the actual root and parents after preparing the temporary;
            // compare fresh bytes and metadata immediately before replacement.
            let (current, fresh) = read_bounded(edit.root, edit.file, cancellation, edit.limit)?;
            if fresh != identity || current != edit.bytes {
                return Err(changed());
            }
            let final_location = Location::new(edit.root, edit.file)?;
            if directory_inode(&final_location.root)? != identity.root
                || directory_inode(&final_location.parent)? != identity.parent
            {
                return Err(changed());
            }
            check_cancel(cancellation)?;
            edit.verify_context(cancellation)?;
            syscall(before_verify_temporary(&location.parent, &temporary.name))?;
            let temporary_path = Path::new(edit.file).with_file_name(&temporary.name);
            let (temporary_bytes, temporary_identity) = read_bounded(
                edit.root,
                temporary_path.to_str().ok_or_else(changed)?,
                cancellation,
                edit.limit,
            )?;
            if temporary_identity.file != file_content::worktree::identity(&prepared)
                || inode(&prepared) != inode(&created)
                || temporary_identity.root != identity.root
                || temporary_identity.parent != identity.parent
                || temporary_identity.uid != identity.uid
                || temporary_identity.gid != identity.gid
                || temporary_identity.file.2 & 0o7777 != identity.file.2 & 0o7777
                || temporary_identity.attributes != identity.attributes
                || temporary_bytes != encoded
            {
                return Err(refused(
                    "The prepared save temporary changed. No edit was saved.",
                ));
            }
            check_cancel(cancellation)?;
            commit_attempted = true;
            syscall(rename(
                &location.parent,
                temporary.name.as_str(),
                &final_location.parent,
                final_location.name.as_os_str(),
            ))?;
            temporary.armed = false;
            Ok(())
        })();
        if let Err(mut error) = attempt {
            if commit_attempted {
                // A remote filesystem may commit rename and still return an
                // error. Preserve any owned temporary; never blindly roll back.
                temporary.armed = false;
                return Ok((
                    WorkingFileWriteStatus::Unconfirmed,
                    Some(format!(
                        "The save outcome is unconfirmed. Reload before saving or staging. An owned temporary file ({}) may remain; inspect it before removing it.",
                        temporary.name
                    )),
                ));
            }
            if temporary.remove().is_err() {
                error.hint = Some(format!(
                    "The file was not replaced. The temporary path ({}) changed or could not be removed; retain your draft and inspect it before removing anything.",
                    temporary.name
                ));
            }
            temporary.armed = false;
            return Err(error);
        }
        let durability =
            io(location.parent.try_clone()).and_then(|fd| io(fs::File::from(fd).sync_all()));
        Ok((WorkingFileWriteStatus::Saved, durability.err().map(|_| "The edit was saved, but directory durability could not be confirmed. Inspect the current file before retrying.".into())))
    }
}

#[cfg(not(target_os = "linux"))]
mod platform {
    use super::*;
    #[derive(Clone, PartialEq, Eq)]
    pub(super) struct Identity;
    pub(super) fn read_only_reason(_: &Identity) -> Option<&'static str> {
        Some("Contained working-file editing is not qualified on this platform.")
    }
    pub(super) fn read(
        _: &Path,
        _: &str,
        _: &CancellationToken,
    ) -> Result<(Vec<u8>, Identity), AppError> {
        Err(refused(
            "Contained working-file editing is not supported on this platform yet.",
        ))
    }
    pub(super) fn replace(
        _: &WorkingFileEdit,
        _: &[u8],
        _: &CancellationToken,
    ) -> Result<(WorkingFileWriteStatus, Option<String>), AppError> {
        Err(refused(
            "Contained working-file saving is not supported on this platform yet.",
        ))
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
    struct Repository(PathBuf);
    impl Repository {
        fn new() -> Self {
            Self::new_format("sha1")
        }
        fn new_format(format: &str) -> Self {
            let mut random = [0; 12];
            getrandom::fill(&mut random).unwrap();
            let path = std::env::temp_dir().join(format!(
                "owned-working-editor-{}",
                random
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>()
            ));
            fs::create_dir(&path).unwrap();
            let repo = Self(path);
            repo.git(&["init", "-q", "-b", "main", "--object-format", format]);
            for (key, value) in [
                ("user.name", "Owned Editor Fixture"),
                ("user.email", "editor@example.test"),
                ("commit.gpgsign", "false"),
                ("core.hooksPath", "/dev/null"),
                ("core.attributesFile", "/dev/null"),
            ] {
                repo.git(&["config", key, value]);
            }
            repo
        }
        fn git(&self, args: &[&str]) -> Vec<u8> {
            let output = run_git(&self.0, args).unwrap();
            ensure_success("inspect owned editor fixture", &output).unwrap();
            output.stdout
        }
        fn open(&self, file: &str, encoding: Option<WorkingTextEncoding>) -> WorkingFileEdit {
            open_working_file_edit(&self.0, file, encoding, &CancellationToken::default()).unwrap()
        }
        fn temporary_files(&self) -> Vec<OsString> {
            fs::read_dir(&self.0)
                .unwrap()
                .map(|x| x.unwrap().file_name())
                .filter(|n| n.to_string_lossy().starts_with(".git-khronos-edit-"))
                .collect()
        }
    }
    impl Drop for Repository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn recovery_record(edit: &WorkingFileEdit) -> crate::draft_recovery::RecoveryDraftRecord {
        edit.recovery_binding()
            .unwrap()
            .record(
                &"a".repeat(32),
                &"b".repeat(32),
                1,
                "retained unsaved text\n",
                "1793510000000",
            )
            .unwrap()
    }
    #[test]
    fn draft_recovery_binding_uses_opened_editor_metadata_and_preserves_unborn_repository() {
        use crate::draft_recovery::{RecoveryDraftGitContextMatch, recovery_text_sha256};
        let repo = Repository::new();
        let bytes = "original é\r\n".as_bytes();
        fs::write(repo.0.join("literal [file].txt"), bytes).unwrap();
        let config = fs::read(repo.0.join(".git/config")).unwrap();
        let head = fs::read(repo.0.join(".git/HEAD")).unwrap();
        let edit = repo.open("literal [file].txt", None);
        let record = recovery_record(&edit);
        assert_eq!(record.repository_path, repo.0.to_str().unwrap());
        assert_eq!(record.path, "literal [file].txt");
        assert_eq!(record.encoding, WorkingTextEncoding::Utf8);
        assert_eq!(
            record.baseline_sha256,
            recovery_text_sha256("original é\n").unwrap()
        );
        let context = record.git_context.as_ref().unwrap();
        assert_eq!(
            context.working_reference.as_deref(),
            Some("refs/heads/main")
        );
        assert!(context.head_oid.is_none());
        let review = record
            .review_with_editor(&edit, &CancellationToken::default())
            .unwrap();
        assert!(
            review.repository_location_matches
                && review.path_matches
                && review.encoding_matches
                && review.baseline_text_matches
        );
        assert_eq!(review.git_context, RecoveryDraftGitContextMatch::Same);
        assert_eq!(fs::read(repo.0.join("literal [file].txt")).unwrap(), bytes);
        assert!(!repo.0.join(".git/index").exists());
        assert_eq!(fs::read(repo.0.join(".git/config")).unwrap(), config);
        assert_eq!(fs::read(repo.0.join(".git/HEAD")).unwrap(), head);
    }
    #[test]
    fn draft_recovery_review_detects_changed_branch_with_identical_head_and_file() {
        use crate::draft_recovery::RecoveryDraftGitContextMatch;
        let repo = Repository::new();
        fs::write(repo.0.join("file"), b"original\n").unwrap();
        repo.git(&["add", "--", "file"]);
        repo.git(&["commit", "-q", "-m", "Owned baseline"]);
        let original = repo.open("file", None);
        let record = recovery_record(&original);
        repo.git(&["checkout", "-q", "-b", "other"]);
        let current = repo.open("file", None);
        assert_eq!(original.head_oid(), current.head_oid());
        let refs = repo.git(&["show-ref"]);
        let index = fs::read(repo.0.join(".git/index")).unwrap();
        let review = record
            .review_with_editor(&current, &CancellationToken::default())
            .unwrap();
        assert!(review.baseline_text_matches);
        assert_eq!(review.git_context, RecoveryDraftGitContextMatch::Changed);
        assert!(
            record
                .review_with_editor(&original, &CancellationToken::default())
                .is_err()
        );
        assert_eq!(repo.git(&["show-ref"]), refs);
        assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(repo.0.join("file")).unwrap(), b"original\n");
    }
    #[test]
    fn draft_recovery_review_detects_head_changes_and_detached_sha1_and_sha256_contexts() {
        use crate::draft_recovery::RecoveryDraftGitContextMatch;
        for format in ["sha1", "sha256"] {
            let repo = Repository::new_format(format);
            fs::write(repo.0.join("file"), b"original\n").unwrap();
            repo.git(&["add", "--", "file"]);
            repo.git(&["commit", "-q", "-m", "Owned baseline"]);
            let record = recovery_record(&repo.open("file", None));
            repo.git(&["commit", "-q", "--allow-empty", "-m", "Owned newer HEAD"]);
            let current = repo.open("file", None);
            assert_eq!(
                record
                    .git_context
                    .as_ref()
                    .unwrap()
                    .working_reference
                    .as_deref(),
                current.working_reference()
            );
            let review = record
                .review_with_editor(&current, &CancellationToken::default())
                .unwrap();
            assert!(review.baseline_text_matches);
            assert_eq!(review.git_context, RecoveryDraftGitContextMatch::Changed);
            repo.git(&["checkout", "-q", "--detach"]);
            let detached = repo.open("file", None);
            let detached_record = recovery_record(&detached);
            let context = detached_record.git_context.as_ref().unwrap();
            assert!(context.working_reference.is_none());
            assert_eq!(
                context.head_oid.as_ref().unwrap().len(),
                if format == "sha1" { 40 } else { 64 }
            );
            assert_eq!(
                detached_record
                    .review_with_editor(&detached, &CancellationToken::default())
                    .unwrap()
                    .git_context,
                RecoveryDraftGitContextMatch::Same
            );
        }
    }
    #[test]
    fn draft_recovery_review_checks_fresh_file_path_repository_and_encoding_independently() {
        let repo = Repository::new();
        fs::write(repo.0.join("file"), b"original\n").unwrap();
        let old = repo.open("file", None);
        let record = recovery_record(&old);
        fs::write(repo.0.join("file"), b"external\n").unwrap();
        assert!(
            record
                .review_with_editor(&old, &CancellationToken::default())
                .is_err()
        );
        let current = repo.open("file", None);
        assert!(
            !record
                .review_with_editor(&current, &CancellationToken::default())
                .unwrap()
                .baseline_text_matches
        );
        fs::write(repo.0.join("other"), b"original\n").unwrap();
        let other = repo.open("other", Some(WorkingTextEncoding::Windows1252));
        let review = record
            .review_with_editor(&other, &CancellationToken::default())
            .unwrap();
        assert!(review.repository_location_matches && review.baseline_text_matches);
        assert!(!review.path_matches);
        assert!(!review.encoding_matches);
        let second = Repository::new();
        fs::write(second.0.join("file"), b"original\n").unwrap();
        let review = record
            .review_with_editor(&second.open("file", None), &CancellationToken::default())
            .unwrap();
        assert!(!review.repository_location_matches);
        assert!(review.path_matches && review.baseline_text_matches);
        let cancelled = CancellationToken::default();
        cancelled.cancel();
        assert!(record.review_with_editor(&current, &cancelled).is_err());
        assert_eq!(fs::read(repo.0.join("file")).unwrap(), b"external\n");
    }
    #[test]
    fn draft_recovery_capture_refuses_lossy_repository_locations() {
        use std::os::unix::ffi::OsStringExt;
        let repo = Repository::new();
        fs::write(repo.0.join("file"), b"original\n").unwrap();
        let edit = repo.open("file", None);
        let mut name = repo.0.file_name().unwrap().as_encoded_bytes().to_vec();
        name.push(0xff);
        let invalid_location = repo.0.with_file_name(OsString::from_vec(name));
        assert!(
            crate::draft_recovery_editor::WorkingFileRecoveryBinding::capture(
                &invalid_location,
                &edit,
            )
            .is_err()
        );
        assert_eq!(fs::read(repo.0.join("file")).unwrap(), b"original\n");
    }
    #[test]
    fn draft_recovery_binding_retains_data_after_write_authority_is_consumed() {
        let repo = Repository::new();
        fs::write(repo.0.join("file"), b"original\n").unwrap();
        let edit = repo.open("file", None);
        let binding = edit.recovery_binding().unwrap();
        let saved = edit.save("saved\n", &CancellationToken::default()).unwrap();
        assert_eq!(saved.status, WorkingFileWriteStatus::Saved);
        assert!(edit.verify_current(&CancellationToken::default()).is_err());
        let record = binding
            .record(&"a".repeat(32), &"b".repeat(32), 1, "still unsaved\n", "1")
            .unwrap();
        let review = record
            .review_with_editor(saved.next.as_ref().unwrap(), &CancellationToken::default())
            .unwrap();
        assert!(!review.baseline_text_matches);
        let mut relocated_record = record.clone();
        relocated_record.repository_path = repo
            .0
            .join("never-opened-repository")
            .to_str()
            .unwrap()
            .into();
        relocated_record.path = "never-opened-file".into();
        let review = relocated_record
            .review_with_editor(saved.next.as_ref().unwrap(), &CancellationToken::default())
            .unwrap();
        assert!(!review.repository_location_matches && !review.path_matches);
        assert!(!repo.0.join("never-opened-repository").exists());
        assert!(!repo.0.join("never-opened-file").exists());
        assert_eq!(fs::read(repo.0.join("file")).unwrap(), b"saved\n");
        assert!(!repo.0.join(".git/index").exists());
    }
    #[test]
    fn draft_recovery_binding_refuses_invalid_snapshot_inputs_and_unknown_legacy_context() {
        use crate::draft_recovery::{MAX_RECOVERY_TEXT_BYTES, RecoveryDraftGitContextMatch};
        let repo = Repository::new();
        fs::write(repo.0.join("file"), b"original\n").unwrap();
        let edit = repo.open("file", None);
        let binding = edit.recovery_binding().unwrap();
        let id = "a".repeat(32);
        let revision = "b".repeat(32);
        assert!(
            binding
                .record("invalid", &revision, 1, "draft", "1")
                .is_err()
        );
        assert!(binding.record(&id, "invalid", 1, "draft", "1").is_err());
        assert!(binding.record(&id, &revision, 0, "draft", "1").is_err());
        assert!(binding.record(&id, &revision, 1, "draft", "01").is_err());
        assert!(binding.record(&id, &revision, 1, "draft\0", "1").is_err());
        assert!(
            binding
                .record(
                    &id,
                    &revision,
                    1,
                    &"x".repeat(MAX_RECOVERY_TEXT_BYTES + 1),
                    "1"
                )
                .is_err()
        );
        let mut legacy = recovery_record(&edit);
        legacy.git_context = None;
        let review = legacy
            .review_with_editor(&edit, &CancellationToken::default())
            .unwrap();
        assert!(review.baseline_text_matches);
        assert_eq!(review.git_context, RecoveryDraftGitContextMatch::Unknown);
    }
    #[test]
    fn working_file_edit_refuses_modified_or_swapped_save_temporary_and_preserves_foreign_path() {
        for swap in [false, true] {
            let repo = Repository::new();
            fs::write(repo.0.join("file"), b"original target").unwrap();
            let edit = repo.open("file", None);
            let error = edit
                .save_using(
                    "intended edit",
                    &CancellationToken::default(),
                    |edit, bytes, token| {
                        platform::replace_with_changed_temporary(edit, bytes, token, swap)
                    },
                )
                .unwrap_err();
            assert_eq!(fs::read(repo.0.join("file")).unwrap(), b"original target");
            if swap {
                let paths = repo.temporary_files();
                assert_eq!(paths.len(), 1);
                assert_eq!(
                    fs::read(repo.0.join(&paths[0])).unwrap(),
                    b"owned changed temporary"
                );
                assert_eq!(
                    fs::read(repo.0.join("owned-displaced-temporary")).unwrap(),
                    b"intended edit"
                );
                assert!(
                    error
                        .hint
                        .unwrap()
                        .contains("changed or could not be removed")
                );
            } else {
                assert!(repo.temporary_files().is_empty());
            }
            assert_eq!(
                edit.save("fresh explicit retry", &CancellationToken::default())
                    .unwrap()
                    .status,
                WorkingFileWriteStatus::Saved
            );
        }
    }
    #[test]
    fn working_file_edit_saves_exact_encoding_bytes_and_modes_without_staging_or_ref_changes() {
        let repo = Repository::new();
        let cases = [
            (
                "utf8",
                b"A\r\n".as_slice(),
                None,
                "B\r\n",
                b"B\r\n".as_slice(),
            ),
            (
                "utf16le",
                b"\xff\xfeA\x00\r\x00\n\x00",
                None,
                "B\r\n",
                b"\xff\xfeB\x00\r\x00\n\x00",
            ),
            (
                "utf16be",
                b"\xfe\xff\x00A\x00\r\x00\n",
                None,
                "B\r\n",
                b"\xfe\xff\x00B\x00\r\x00\n",
            ),
            (
                "legacy",
                b"\x80old\r\n",
                Some(WorkingTextEncoding::Windows1252),
                "€new\r\n",
                b"\x80new\r\n",
            ),
        ];
        for (index, (name, bytes, _, _, _)) in cases.iter().enumerate() {
            fs::write(repo.0.join(name), bytes).unwrap();
            fs::set_permissions(
                repo.0.join(name),
                fs::Permissions::from_mode(if index == 0 { 0o755 } else { 0o640 }),
            )
            .unwrap();
        }
        repo.git(&["add", "--all"]);
        repo.git(&["commit", "-qm", "Owned unchanged source files"]);
        let index = fs::read(repo.0.join(".git/index")).unwrap();
        let config = fs::read(repo.0.join(".git/config")).unwrap();
        let refs = repo.git(&["show-ref"]);
        for (index, (name, _, encoding, text, expected)) in cases.iter().enumerate() {
            let edit = repo.open(name, *encoding);
            assert!(edit.read_only_reason().is_none());
            let saved = edit.save(text, &CancellationToken::default()).unwrap();
            assert!(saved.status == WorkingFileWriteStatus::Saved && saved.warning.is_none());
            assert_eq!(saved.next.as_ref().unwrap().text().text(), *text);
            assert_eq!(fs::read(repo.0.join(name)).unwrap(), *expected);
            assert_eq!(
                fs::metadata(repo.0.join(name)).unwrap().mode() & 0o777,
                if index == 0 { 0o755 } else { 0o640 }
            );
        }
        assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), index);
        assert_eq!(fs::read(repo.0.join(".git/config")).unwrap(), config);
        assert_eq!(repo.git(&["show-ref"]), refs);
        assert!(repo.temporary_files().is_empty());
    }
    #[test]
    fn working_file_edit_refuses_external_bytes_permissions_and_unrepresentable_replacements() {
        let repo = Repository::new();
        let path = repo.0.join("file");
        fs::write(&path, b"owned original").unwrap();
        let edit = repo.open("file", None);
        fs::write(&path, b"external update").unwrap();
        assert!(
            edit.save("must not overwrite", &CancellationToken::default())
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), b"external update");
        let edit = repo.open("file", None);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        assert!(
            edit.save("must not overwrite", &CancellationToken::default())
                .is_err()
        );
        let read_only = repo.open("file", None);
        assert!(read_only.read_only_reason().is_some());
        assert!(
            read_only
                .save("must not overwrite", &CancellationToken::default())
                .is_err()
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&path, b"\x80 original").unwrap();
        let legacy = repo.open("file", Some(WorkingTextEncoding::Windows1252));
        assert!(legacy.save("😀", &CancellationToken::default()).is_err());
        // An apparent new conflicting BOM must fail before the filesystem write.
        assert!(legacy.save("ï»¿", &CancellationToken::default()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"\x80 original");
        assert!(repo.temporary_files().is_empty());
    }
    #[test]
    fn working_file_edit_never_follows_selected_or_swapped_parent_symlinks() {
        let repo = Repository::new();
        let outside = Repository::new();
        fs::write(outside.0.join("file"), b"owned outside bytes").unwrap();
        symlink(outside.0.join("file"), repo.0.join("link")).unwrap();
        assert!(
            open_working_file_edit(&repo.0, "link", None, &CancellationToken::default()).is_err()
        );
        fs::create_dir(repo.0.join("dir")).unwrap();
        fs::write(repo.0.join("dir/file"), b"inside bytes").unwrap();
        let edit = repo.open("dir/file", None);
        fs::rename(repo.0.join("dir"), repo.0.join("retained-dir")).unwrap();
        symlink(&outside.0, repo.0.join("dir")).unwrap();
        assert!(
            edit.save("must stay inside", &CancellationToken::default())
                .is_err()
        );
        assert_eq!(
            fs::read(outside.0.join("file")).unwrap(),
            b"owned outside bytes"
        );
        assert_eq!(
            fs::read(repo.0.join("retained-dir/file")).unwrap(),
            b"inside bytes"
        );
        for path in [
            "../outside",
            "/absolute",
            ".git/config",
            ".GIT/config",
            "dir/../file",
        ] {
            assert!(
                open_working_file_edit(&repo.0, path, None, &CancellationToken::default()).is_err(),
                "{path}"
            );
        }
        assert!(repo.temporary_files().is_empty());
    }
    #[test]
    fn working_file_edit_refuses_a_nested_repository_created_after_opening() {
        let repo = Repository::new();
        fs::create_dir_all(repo.0.join("nested/deep")).unwrap();
        let file = repo.0.join("nested/deep/file");
        fs::write(&file, b"inside bytes").unwrap();
        let edit = repo.open("nested/deep/file", None);
        fs::write(repo.0.join("nested/.git"), b"gitdir: ../other").unwrap();
        assert!(
            open_working_file_edit(
                &repo.0,
                "nested/deep/file",
                None,
                &CancellationToken::default(),
            )
            .is_err()
        );
        assert!(
            edit.save("must not overwrite", &CancellationToken::default())
                .is_err()
        );
        assert_eq!(fs::read(file).unwrap(), b"inside bytes");
        assert!(
            fs::read_dir(repo.0.join("nested/deep"))
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".git-khronos-edit-"))
        );
    }
    #[test]
    fn working_file_edit_preserves_user_attributes_and_refuses_special_permissions() {
        let repo = Repository::new();
        let path = repo.0.join("file");
        fs::write(&path, b"original").unwrap();
        let fd = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        rustix::fs::fsetxattr(
            &fd,
            "user.khronos-owned",
            b"owned metadata",
            rustix::fs::XattrFlags::empty(),
        )
        .unwrap();
        let edit = repo.open("file", None);
        let result = edit.save("edited", &CancellationToken::default()).unwrap();
        assert!(result.status == WorkingFileWriteStatus::Saved && result.next.is_some());
        let fd = fs::File::open(&path).unwrap();
        let mut value = [0; 100];
        let length = rustix::fs::fgetxattr(&fd, "user.khronos-owned", &mut value[..]).unwrap();
        assert_eq!(&value[..length], b"owned metadata");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o4755)).unwrap();
        let protected = repo.open("file", None);
        assert!(protected.read_only_reason().is_some());
        assert!(
            protected
                .save("must not replace", &CancellationToken::default())
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), b"edited");
    }
    #[test]
    fn working_file_edit_cancel_and_identical_save_preserve_inode_bytes_and_drafts() {
        let repo = Repository::new();
        let path = repo.0.join("file");
        fs::write(&path, b"same bytes\r\n").unwrap();
        let before = fs::metadata(&path).unwrap();
        let edit = repo.open("file", None);
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        assert!(edit.save("cancelled edit", &cancellation).is_err());
        let saved = edit
            .save("same bytes\r\n", &CancellationToken::default())
            .unwrap();
        assert!(
            saved.status == WorkingFileWriteStatus::Unchanged
                && saved.next.is_some()
                && saved.warning.is_none()
        );
        let after = fs::metadata(&path).unwrap();
        assert_eq!(
            (after.dev(), after.ino(), after.mtime(), after.ctime()),
            (before.dev(), before.ino(), before.mtime(), before.ctime())
        );
        assert_eq!(fs::read(&path).unwrap(), b"same bytes\r\n");
        assert!(repo.temporary_files().is_empty());
    }
    #[test]
    fn working_file_edit_refuses_identical_file_bytes_after_an_external_branch_switch() {
        let repo = Repository::new();
        let path = repo.0.join("file");
        fs::write(&path, b"same bytes").unwrap();
        repo.git(&["add", "--all"]);
        repo.git(&["commit", "-qm", "Owned base"]);
        repo.git(&["branch", "topic"]);
        let edit = repo.open("file", None);
        let before = fs::metadata(&path).unwrap();
        repo.git(&["checkout", "-q", "topic"]);
        let after = fs::metadata(&path).unwrap();
        assert_eq!(
            (before.ino(), before.mtime(), before.ctime()),
            (after.ino(), after.mtime(), after.ctime())
        );
        assert!(edit.verify_current(&CancellationToken::default()).is_err());
        assert!(
            edit.save("wrong branch", &CancellationToken::default())
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), b"same bytes");
        assert!(repo.temporary_files().is_empty());
    }
    #[test]
    fn working_file_edit_refuses_head_advance_even_when_the_selected_file_is_unchanged() {
        let repo = Repository::new();
        let path = repo.0.join("file");
        fs::write(&path, b"same bytes").unwrap();
        repo.git(&["add", "--all"]);
        repo.git(&["commit", "-qm", "Owned base"]);
        let edit = repo.open("file", None);
        let before = fs::metadata(&path).unwrap();
        fs::write(repo.0.join("other"), b"other change").unwrap();
        repo.git(&["add", "--all"]);
        repo.git(&["commit", "-qm", "Other file"]);
        let after = fs::metadata(&path).unwrap();
        assert_eq!(
            (before.ino(), before.mtime(), before.ctime()),
            (after.ino(), after.mtime(), after.ctime())
        );
        assert!(
            edit.save("stale edit", &CancellationToken::default())
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), b"same bytes");
    }
    #[test]
    fn working_file_edit_supports_unborn_detached_and_sha256_but_refuses_replaced_git_metadata() {
        for format in ["sha1", "sha256"] {
            let repo = Repository::new_format(format);
            let path = repo.0.join("file");
            fs::write(&path, b"unborn").unwrap();
            let unborn = repo.open("file", None);
            assert_eq!(unborn.working_reference(), Some("refs/heads/main"));
            assert_eq!(unborn.head_oid(), None);
            assert_eq!(
                unborn
                    .save("first edit", &CancellationToken::default())
                    .unwrap()
                    .status,
                WorkingFileWriteStatus::Saved
            );
            assert!(!repo.0.join(".git/index").exists());
            repo.git(&["add", "--all"]);
            repo.git(&["commit", "-qm", "Owned base"]);
            repo.git(&["checkout", "-q", "--detach", "HEAD"]);
            let detached = repo.open("file", None);
            assert_eq!(detached.working_reference(), None);
            assert_eq!(
                detached.head_oid().unwrap().len(),
                if format == "sha1" { 40 } else { 64 }
            );
            let saved = detached
                .save("detached edit", &CancellationToken::default())
                .unwrap();
            assert_eq!(saved.status, WorkingFileWriteStatus::Saved);
            let edit = saved.next.unwrap();
            let oid = repo.git(&["rev-parse", "HEAD"]);
            let retained = repo.0.join("retained-metadata");
            fs::rename(repo.0.join(".git"), &retained).unwrap();
            let copied = Command::new("cp")
                .arg("-a")
                .arg(&retained)
                .arg(repo.0.join(".git"))
                .output()
                .unwrap();
            assert!(copied.status.success());
            assert_eq!(repo.git(&["rev-parse", "HEAD"]), oid);
            assert!(
                edit.save("wrong metadata", &CancellationToken::default())
                    .is_err()
            );
            assert_eq!(fs::read(&path).unwrap(), b"detached edit");
        }
    }
    #[test]
    fn working_file_edit_refuses_a_linked_worktree_retargeted_to_other_common_metadata() {
        let repo = Repository::new();
        fs::write(repo.0.join("file"), b"owned bytes").unwrap();
        repo.git(&["add", "--all"]);
        repo.git(&["commit", "-qm", "Owned base"]);
        let worktree = repo.0.join("owned-worktree");
        repo.git(&[
            "worktree",
            "add",
            "-q",
            "-b",
            "editor-side",
            worktree.to_str().unwrap(),
        ]);
        let edit =
            open_working_file_edit(&worktree, "file", None, &CancellationToken::default()).unwrap();
        let before = run_git(&worktree, &["rev-parse", "HEAD"]).unwrap().stdout;
        let alternate = repo.0.join("alternate-common");
        let copied = Command::new("cp")
            .arg("-a")
            .arg(repo.0.join(".git"))
            .arg(&alternate)
            .output()
            .unwrap();
        assert!(copied.status.success());
        let git_directory =
            file_content::metadata_git(&worktree, &["rev-parse", "--absolute-git-dir"]).unwrap();
        let git_directory = PathBuf::from(metadata_line(&git_directory).unwrap());
        fs::write(
            git_directory.join("commondir"),
            format!("{}\n", alternate.display()),
        )
        .unwrap();
        let after = run_git(&worktree, &["rev-parse", "HEAD"]).unwrap();
        assert!(after.status.success());
        assert_eq!(after.stdout, before);
        assert!(
            edit.save("must not rebind", &CancellationToken::default())
                .is_err()
        );
        assert_eq!(fs::read(worktree.join("file")).unwrap(), b"owned bytes");
    }
    #[test]
    fn working_file_edit_commit_error_preserves_both_disk_outcomes_and_refuses_replay() {
        for applied in [false, true] {
            let repo = Repository::new();
            let path = repo.0.join("file");
            fs::write(&path, b"original").unwrap();
            let edit = repo.open("file", None);
            let old_context = edit.clone();
            let outcome = edit
                .save_using(
                    "edited",
                    &CancellationToken::default(),
                    |edit, bytes, cancellation| {
                        platform::replace_with_lost_reply(edit, bytes, cancellation, applied)
                    },
                )
                .unwrap();
            assert_eq!(outcome.status, WorkingFileWriteStatus::Unconfirmed);
            assert!(outcome.next.is_none());
            assert!(outcome.warning.as_ref().unwrap().contains("unconfirmed"));
            assert_eq!(
                fs::read(&path).unwrap(),
                if applied {
                    b"edited".as_slice()
                } else {
                    b"original".as_slice()
                }
            );
            assert_eq!(repo.temporary_files().len(), usize::from(!applied));
            assert_eq!(
                old_context
                    .save("blind retry", &CancellationToken::default())
                    .unwrap_err()
                    .kind,
                "workingFileEditStale"
            );
        }
    }
    #[test]
    fn working_file_edit_refuses_binary_oversize_absent_and_fifo_paths() {
        let repo = Repository::new();
        fs::write(repo.0.join("binary"), b"not\0editable").unwrap();
        fs::write(repo.0.join("large"), vec![b'a'; MAX_WORKING_TEXT_BYTES + 1]).unwrap();
        let output = Command::new("mkfifo")
            .arg(repo.0.join("pipe"))
            .output()
            .unwrap();
        assert!(output.status.success());
        for path in ["binary", "large", "absent", "pipe"] {
            assert!(
                open_working_file_edit(&repo.0, path, None, &CancellationToken::default()).is_err(),
                "{path}"
            );
        }
        assert!(repo.temporary_files().is_empty());
    }
}
