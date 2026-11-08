//! Native-derived file roles for an explicitly reviewed external program.
//! Previews create only private copies. They do not launch programs or save/stage files.
use super::working_file_edit::bytes::WorkingFileBytesEdit;
use super::{
    AppError, CancellationToken, FileContent, FileContentKind, FileContentLocation,
    FileToolCleanupReview, FileToolLaunchReview, FileToolMergeStageResult,
    FileToolMergeWriteResult, FileToolRequest, FileToolResult, FileToolSideReview,
    FileToolSnapshotRole, FileToolSnapshots, FileToolSource, ToolArgumentContext, ToolProfile,
    ToolRole, file_content, git_cancellation, read_file_content, validate_commit_oid,
};
use rustix::fs::{Mode, OFlags, fstat, open, openat};
use std::{
    fs::File,
    os::fd::OwnedFd,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

impl FileToolSource {
    fn path(&self) -> &str {
        match self {
            Self::Revision { path, .. } | Self::Index { path } | Self::WorkingTree { path } => path,
        }
    }
    fn location(&self) -> FileContentLocation {
        match self {
            Self::Revision { oid, .. } => FileContentLocation::Revision(oid.clone()),
            Self::Index { .. } => FileContentLocation::Index,
            Self::WorkingTree { .. } => FileContentLocation::WorkingTree,
        }
    }
}
// Native-only: neither the launch review nor an argument vector is execution authority.
pub struct PreparedFileTool {
    root: RootLease,
    program: ProgramLease,
    review: FileToolLaunchReview,
    sources: Vec<(FileToolSource, FileContent)>,
    comparison: Option<(super::FileComparisonRequest, super::FileComparisonContent)>,
    editor: Option<EditorLease>,
    merge: Option<MergeLease>,
    snapshots: Option<FileToolSnapshots>,
    retired: bool,
    launched: bool,
}
struct RootLease {
    path: PathBuf,
    directory: OwnedFd,
    directory_id: (u64, u64),
    git_path: PathBuf,
    git_directory: OwnedFd,
    git_id: (u64, u64),
    common_path: PathBuf,
    common_directory: OwnedFd,
    common_id: (u64, u64),
    head: Vec<u8>,
    branch: Vec<u8>,
}
struct ProgramLease {
    path: String,
    file: File,
    metadata: std::fs::Metadata,
}
struct EditorLease {
    path: String,
    file: File,
    metadata: std::fs::Metadata,
}
struct MergeLease {
    path: String,
    entries: Vec<u8>,
    working: FileContent,
    working_file: Option<EditorLease>,
    byte_edit: Option<WorkingFileBytesEdit>,
    saved: Option<WorkingFileBytesEdit>,
}
/// Native-held cleanup snapshot. Display data alone is not removal authority.
pub struct PreparedFileToolCleanup {
    review: FileToolCleanupReview,
    output: Option<FileToolResult>,
}
impl PreparedFileToolCleanup {
    pub fn review(&self) -> &FileToolCleanupReview {
        &self.review
    }
}
type MergeSide = Option<(String, Vec<u8>)>;
struct PreparationCopies(Option<FileToolSnapshots>);
impl Drop for PreparationCopies {
    fn drop(&mut self) {
        if let Some(copies) = &mut self.0 {
            let _ = copies.discard();
        }
    }
}
fn refused(message: &str) -> AppError {
    AppError::new(
        "fileToolRefused",
        message,
        Some("Review a fresh tool launch. No repository data was changed."),
    )
}
fn io<T>(result: std::io::Result<T>) -> Result<T, AppError> {
    result.map_err(|_| refused("The captured program or repository file could not be inspected."))
}
fn syscall<T>(result: Result<T, rustix::io::Errno>) -> Result<T, AppError> {
    result.map_err(|_| {
        refused("The selected file could not be opened without following repository links.")
    })
}
fn check(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(super::operation_cancelled());
    }
    Ok(())
}
fn directory_id(fd: &OwnedFd) -> Result<(u64, u64), AppError> {
    let stat = syscall(fstat(fd))?;
    Ok((stat.st_dev, stat.st_ino))
}
fn optional_git(path: &Path, args: &[&str]) -> Result<Vec<u8>, AppError> {
    let (output, truncated) = file_content::content_git(path, args, 64 * 1024)?;
    if truncated
        || (!output.status.success()
            && (output.status.code() != Some(1)
                || !output.stdout.is_empty()
                || !output.stderr.is_empty()))
    {
        return Err(refused(
            "The repository's current history binding could not be inspected.",
        ));
    }
    Ok(output.stdout)
}
fn git_metadata_directory(path: &Path, common: bool) -> Result<PathBuf, AppError> {
    let args: &[&str] = if common {
        &["rev-parse", "--path-format=absolute", "--git-common-dir"]
    } else {
        &["rev-parse", "--absolute-git-dir"]
    };
    let bytes = file_content::metadata_git(path, args)?;
    let bytes = bytes
        .strip_suffix(b"\n")
        .ok_or_else(|| refused("Git returned an invalid repository directory."))?;
    let value = std::str::from_utf8(bytes)
        .map_err(|_| refused("The Git directory cannot be represented."))?;
    io(Path::new(value).canonicalize())
}
impl RootLease {
    fn capture(path: &Path) -> Result<Self, AppError> {
        let path = io(path.canonicalize())?;
        let directory = file_content::worktree::absolute(&path)?;
        let git_path = git_metadata_directory(&path, false)?;
        let git_directory = file_content::worktree::absolute(&git_path)?;
        let common_path = git_metadata_directory(&path, true)?;
        let common_directory = file_content::worktree::absolute(&common_path)?;
        let lease = Self {
            directory_id: directory_id(&directory)?,
            git_id: directory_id(&git_directory)?,
            common_id: directory_id(&common_directory)?,
            common_path,
            common_directory,
            head: optional_git(&path, &["rev-parse", "--verify", "--quiet", "HEAD"])?,
            branch: optional_git(&path, &["symbolic-ref", "--quiet", "HEAD"])?,
            path,
            directory,
            git_path,
            git_directory,
        };
        lease.verify()?;
        Ok(lease)
    }
    fn verify(&self) -> Result<(), AppError> {
        let current = file_content::worktree::absolute(&self.path)?;
        let git_path = git_metadata_directory(&self.path, false)?;
        let current_git = file_content::worktree::absolute(&git_path)?;
        let common_path = git_metadata_directory(&self.path, true)?;
        let current_common = file_content::worktree::absolute(&common_path)?;
        if directory_id(&current)? != self.directory_id
            || directory_id(&self.directory)? != self.directory_id
            || git_path != self.git_path
            || directory_id(&current_git)? != self.git_id
            || directory_id(&self.git_directory)? != self.git_id
            || common_path != self.common_path
            || directory_id(&current_common)? != self.common_id
            || directory_id(&self.common_directory)? != self.common_id
            || optional_git(&self.path, &["rev-parse", "--verify", "--quiet", "HEAD"])? != self.head
            || optional_git(&self.path, &["symbolic-ref", "--quiet", "HEAD"])? != self.branch
        {
            return Err(refused(
                "The repository, current branch or HEAD changed after tool review.",
            ));
        }
        Ok(())
    }
}
fn outside_repository(root: &RootLease, parent: &Path) -> Result<PathBuf, AppError> {
    if !parent.is_absolute() {
        return Err(refused(
            "An absolute application-owned snapshot parent is required.",
        ));
    }
    let ancestor = parent
        .parent()
        .ok_or_else(|| refused("Choose a dedicated snapshot directory."))?;
    let leaf = parent
        .file_name()
        .ok_or_else(|| refused("Choose a dedicated snapshot directory."))?;
    let destination = io(ancestor.canonicalize())?.join(leaf);
    if destination.starts_with(&root.path)
        || destination.starts_with(&root.git_path)
        || destination.starts_with(&root.common_path)
    {
        return Err(refused(
            "Tool copies must remain outside the working repository and all of its Git metadata.",
        ));
    }
    Ok(destination)
}
impl ProgramLease {
    fn capture(profile: &ToolProfile) -> Result<Self, AppError> {
        // Program symlinks are normal installed-program aliases. Capture their
        // target without changing argv[0], and revalidate before native execution.
        let file = File::from(
            open(
                profile.executable.as_str(),
                OFlags::PATH | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| refused("The configured executable is unavailable."))?,
        );
        let metadata = io(file.metadata())?;
        if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
            return Err(refused("Choose an executable regular program."));
        }
        let lease = Self {
            path: profile.executable.clone(),
            file,
            metadata,
        };
        lease.verify()?;
        Ok(lease)
    }
    fn verify(&self) -> Result<(), AppError> {
        let expected = file_content::worktree::identity(&self.metadata);
        if file_content::worktree::identity(&io(self.file.metadata())?) != expected
            || file_content::worktree::identity(&io(std::fs::metadata(&self.path))?) != expected
        {
            return Err(refused("The configured executable changed after review."));
        }
        Ok(())
    }
}
impl EditorLease {
    fn open(root: &RootLease, path: &str) -> Result<File, AppError> {
        file_content::validate_file(path)?;
        if file_content::worktree_root(&root.path)? != root.path {
            return Err(refused("Select a working repository file."));
        }
        let path = Path::new(path);
        let parent = path.parent().unwrap_or(Path::new(""));
        let name = path
            .file_name()
            .ok_or_else(|| refused("Choose a working file."))?;
        let directory =
            file_content::worktree::descend_worktree(&root.directory, parent).map_err(|error| {
                if matches!(
                    error,
                    file_content::worktree::WorktreeParentError::NestedRepository
                ) {
                    refused("External editors cannot cross a nested repository boundary.")
                } else {
                    refused(
                        "The selected file could not be opened without following repository links.",
                    )
                }
            })?;
        let file = File::from(syscall(openat(
            &directory,
            name,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ))?);
        if !io(file.metadata())?.is_file() {
            return Err(refused(
                "An external editor requires a regular working file.",
            ));
        }
        Ok(file)
    }
    fn capture(root: &RootLease, path: &str) -> Result<Self, AppError> {
        let file = Self::open(root, path)?;
        let lease = Self {
            metadata: io(file.metadata())?,
            file,
            path: path.to_owned(),
        };
        lease.verify(root)?;
        Ok(lease)
    }
    fn verify(&self, root: &RootLease) -> Result<(), AppError> {
        let current = Self::open(root, &self.path)?;
        let expected = file_content::worktree::identity(&self.metadata);
        if file_content::worktree::identity(&io(self.file.metadata())?) != expected
            || file_content::worktree::identity(&io(current.metadata())?) != expected
        {
            return Err(refused("The editor's working file changed after review."));
        }
        Ok(())
    }
}
fn source(
    root: &Path,
    request: &FileToolSource,
    cancellation: &CancellationToken,
) -> Result<FileContent, AppError> {
    let value = read_file_content(root, &request.location(), request.path(), cancellation)?;
    if value.over_limit
        || !matches!(
            value.kind,
            FileContentKind::Absent | FileContentKind::Regular | FileContentKind::SymbolicLink
        )
    {
        return Err(refused(
            "That file side is unavailable, unresolved, or exceeds the tool snapshot limit.",
        ));
    }
    if value.kind != FileContentKind::Absent && value.bytes.is_none() {
        return Err(refused("A complete selected file side is required."));
    }
    Ok(value)
}
fn side(role: &str, path: &str, content: &FileContent) -> FileToolSideReview {
    FileToolSideReview {
        role: role.into(),
        path: path.into(),
        bytes: content.bytes.as_ref().map_or(0, |b| b.len() as u64),
        oid: content.oid.clone(),
        kind: match content.kind {
            FileContentKind::Absent => "absent",
            FileContentKind::SymbolicLink => "symbolicLink",
            _ => "regular",
        }
        .into(),
    }
}
fn extension(path: &str) -> Option<&str> {
    Path::new(path).extension().and_then(|value| value.to_str())
}
fn merge_entries(root: &Path, path: &str) -> Result<Vec<u8>, AppError> {
    file_content::validate_file(path)?;
    if file_content::worktree_root(root)? != root {
        return Err(refused("Choose a conflicted working file."));
    }
    let entries = file_content::metadata_git(
        root,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--unmerged",
            "-z",
            "--",
            path,
        ],
    )?;
    if entries.is_empty() || !entries.ends_with(&[0]) {
        return Err(refused(
            "The selected file has no complete unmerged index entries.",
        ));
    }
    Ok(entries)
}
fn merge_sides(root: &Path, path: &str, entries: &[u8]) -> Result<[MergeSide; 3], AppError> {
    let mut result: [MergeSide; 3] = [None, None, None];
    for record in entries.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let separator = record
            .iter()
            .position(|b| *b == b'\t')
            .ok_or_else(|| refused("Git returned invalid conflict entries."))?;
        let (header, tail) = record.split_at(separator);
        let name = &tail[1..];
        if name != path.as_bytes() {
            return Err(refused("Git returned another conflict path."));
        }
        let fields: Vec<_> = header.split(|b| *b == b' ').collect();
        if fields.len() != 3 || !matches!(fields[0], b"100644" | b"100755") {
            return Err(refused(
                "Use Git's existing side-resolution actions for link or submodule type conflicts.",
            ));
        }
        let stage = match fields[2] {
            b"1" => 0,
            b"2" => 1,
            b"3" => 2,
            _ => return Err(refused("Git returned an unsupported conflict stage.")),
        };
        if result[stage].is_some() {
            return Err(refused("The selected conflict stage is duplicated."));
        }
        let oid = std::str::from_utf8(fields[1])
            .map_err(|_| refused("Git returned an invalid conflict object."))?;
        validate_commit_oid(oid)?;
        if file_content::metadata_git(root, &["cat-file", "-t", oid])? != b"blob\n" {
            return Err(refused("A conflict stage must identify a blob."));
        }
        let size = file_content::metadata_git(root, &["cat-file", "-s", oid])?;
        let size: u64 = std::str::from_utf8(&size)
            .map_err(|_| refused("Invalid conflict object size."))?
            .trim_end_matches('\n')
            .parse()
            .map_err(|_| refused("Invalid conflict object size."))?;
        if size > super::MAX_FILE_CONTENT_BYTES as u64 {
            return Err(refused(
                "The conflict side exceeds the tool snapshot limit.",
            ));
        }
        let (output, truncated) = file_content::content_git(
            root,
            &["cat-file", "blob", oid],
            super::MAX_FILE_CONTENT_BYTES,
        )?;
        super::ensure_success("read the selected conflict blob", &output)?;
        if truncated || output.stdout.len() as u64 != size {
            return Err(refused("A complete conflict side is required."));
        }
        result[stage] = Some((oid.to_owned(), output.stdout));
    }
    Ok(result)
}
impl PreparedFileTool {
    pub fn review(&self) -> &FileToolLaunchReview {
        &self.review
    }
    /// Launch once after native review. The session owner must retain both this
    /// plan and the returned child handle; it must not discard copies while the
    /// command is running or while a GUI handoff may still use them.
    pub fn launch(
        &mut self,
        cancellation: &CancellationToken,
    ) -> Result<super::FileToolProcess, AppError> {
        if self.launched {
            return Err(refused(
                "That reviewed command was already launched. Inspect its state instead of repeating execution.",
            ));
        }
        self.verify(cancellation)?;
        self.launched = true;
        let mut command = std::process::Command::new(&self.review.executable);
        command
            .args(&self.review.arguments)
            .current_dir(&self.root.path);
        super::FileToolProcess::spawn(command)
    }

    pub fn verify(&self, cancellation: &CancellationToken) -> Result<(), AppError> {
        git_cancellation::with(Some(cancellation), || {
            check(cancellation)?;
            if self.retired {
                return Err(refused("That tool review was discarded."));
            }
            self.root.verify()?;
            self.program.verify()?;
            if let Some(editor) = &self.editor {
                editor.verify(&self.root)?;
            }
            for (request, expected) in &self.sources {
                if source(&self.root.path, request, cancellation)? != *expected {
                    return Err(refused("A selected comparison side changed after review."));
                }
            }
            if let Some((request, expected)) = &self.comparison
                && super::read_file_comparison(&self.root.path, request, cancellation)? != *expected
            {
                return Err(refused(
                    "The selected comparison or its native ancestry changed after review.",
                ));
            }
            if let Some(merge) = &self.merge {
                if let Some(file) = &merge.working_file {
                    file.verify(&self.root)?;
                }
                if merge_entries(&self.root.path, &merge.path)? != merge.entries
                    || read_file_content(
                        &self.root.path,
                        &FileContentLocation::WorkingTree,
                        &merge.path,
                        cancellation,
                    )? != merge.working
                {
                    return Err(refused(
                        "The conflict index or working contents changed after review.",
                    ));
                }
            }
            if let Some(copies) = &self.snapshots {
                copies.verify_inputs()?;
            }
            check(cancellation)
        })
    }
    pub fn read_merge_result(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<FileToolResult, AppError> {
        self.verify(cancellation)?;
        if self.merge.is_none() {
            return Err(refused("This tool review has no merge result."));
        }
        let value = self
            .snapshots
            .as_ref()
            .ok_or_else(|| refused("The merge copies are unavailable."))?
            .read_result()?;
        self.verify_merge_result(&value, cancellation)?;
        Ok(value)
    }
    pub fn verify_merge_result(
        &self,
        result: &FileToolResult,
        cancellation: &CancellationToken,
    ) -> Result<(), AppError> {
        self.verify(cancellation)?;
        if self.merge.is_none() {
            return Err(refused("This tool review has no merge result."));
        }
        self.snapshots
            .as_ref()
            .ok_or_else(|| refused("The merge copies are unavailable."))?
            .verify_result(result)?;
        check(cancellation)
    }
    /// Consume this result's publication authority before any disk write.
    /// Saving never stages; the result is not interpreted as text or resolution.
    pub fn apply_merge_result(
        &mut self,
        result: &FileToolResult,
        cancellation: &CancellationToken,
    ) -> Result<FileToolMergeWriteResult, AppError> {
        self.verify_merge_result(result, cancellation)?;
        let edit = self.merge.as_mut().and_then(|merge| merge.byte_edit.take())
            .ok_or_else(|| refused("This working target is absent or this merge save was already used. Review a fresh working-file action."))?;
        let saved = edit.save(result.bytes(), cancellation, || {
            self.verify_merge_result(result, cancellation)
        })?;
        let outcome = FileToolMergeWriteResult {
            status: saved.status,
            warning: saved.warning,
            can_review_staging: saved.next.is_some(),
        };
        if let Some(merge) = &mut self.merge {
            merge.saved = saved.next;
        }
        Ok(outcome)
    }
    /// Validate a saved disk version and still-unmerged index for a separate
    /// native staging review. Neither tool exit nor a successful save stages it.
    pub fn verify_saved_merge(&self, cancellation: &CancellationToken) -> Result<(), AppError> {
        git_cancellation::with(Some(cancellation), || {
            check(cancellation)?;
            if self.retired {
                return Err(refused("That tool session was discarded."));
            }
            self.root.verify()?;
            let merge = self
                .merge
                .as_ref()
                .ok_or_else(|| refused("This session has no merge result."))?;
            let saved = merge
                .saved
                .as_ref()
                .ok_or_else(|| refused("No confirmed saved merge version is available."))?;
            saved.verify_current(cancellation)?;
            if merge_entries(&self.root.path, &merge.path)? != merge.entries {
                return Err(refused(
                    "The conflicted index changed after merge review. Review its current state before staging.",
                ));
            }
            check(cancellation)
        })
    }
    /// Consume staging authority before one Git add. Errors after dispatch are
    /// uncertain outcomes for inspection, never permission to repeat the action.
    pub fn stage_saved_merge(
        &mut self,
        cancellation: &CancellationToken,
    ) -> Result<FileToolMergeStageResult, AppError> {
        self.verify_saved_merge(cancellation)?;
        let merge = self
            .merge
            .as_mut()
            .ok_or_else(|| refused("This session has no merge result."))?;
        let saved = merge
            .saved
            .take()
            .ok_or_else(|| refused("That staging review was already used."))?;
        let staged = git_cancellation::with(Some(cancellation), || {
            super::stage_path(&self.root.path, &merge.path)
        });
        let still_current = saved.verify_current(cancellation);
        Ok(FileToolMergeStageResult {
            confirmed: staged.is_ok() && still_current.is_ok(),
            error: staged.err(),
            warning: still_current.err().map(|_| "The current saved file could not be confirmed after staging. Inspect the index and working file before any further action.".into()),
        })
    }
    /// Cleanup is independent of current repository bytes or program identity:
    /// it removes only this session's checked private copies, never Git data.
    /// The native owner must additionally require an exited direct child and
    /// explicit user acknowledgement that any GUI handoff has finished.
    pub fn prepare_cleanup(&self) -> Result<PreparedFileToolCleanup, AppError> {
        let (directory, output) = if let Some(copies) = &self.snapshots {
            copies.verify_inputs()?;
            let output = if self.merge.is_some() {
                Some(copies.read_result()?)
            } else {
                None
            };
            (
                Some(
                    copies
                        .path()
                        .to_str()
                        .ok_or_else(|| refused("The private tool path cannot be represented."))?
                        .into(),
                ),
                output,
            )
        } else {
            (None, None)
        };
        Ok(PreparedFileToolCleanup {
            review: FileToolCleanupReview {
                copy_directory: directory,
                sides: self.review.sides.clone(),
                output_bytes: output.as_ref().map(|value| value.bytes().len() as u64),
            },
            output,
        })
    }
    pub fn discard_reviewed(&mut self, cleanup: PreparedFileToolCleanup) -> Result<(), AppError> {
        let path = self
            .snapshots
            .as_ref()
            .map(|copies| {
                copies
                    .path()
                    .to_str()
                    .ok_or_else(|| refused("The private tool path cannot be represented."))
            })
            .transpose()?;
        if path != cleanup.review.copy_directory.as_deref() {
            return Err(refused(
                "The cleanup review belongs to another tool session.",
            ));
        }
        if let Some(output) = &cleanup.output {
            self.snapshots
                .as_ref()
                .ok_or_else(|| refused("The tool copies are unavailable."))?
                .verify_result(output)?;
        }
        self.discard()
    }
    pub fn discard(&mut self) -> Result<(), AppError> {
        self.retired = true;
        if let Some(copies) = &mut self.snapshots {
            copies.discard()?;
        }
        Ok(())
    }
}
/// `snapshot_parent` and `uid` are native-selected authority, never IPC inputs.
/// The returned plan must remain native-held; the review is display data only.
pub fn prepare_file_tool(
    root: &Path,
    request: FileToolRequest,
    profile: ToolProfile,
    snapshot_parent: &Path,
    uid: u32,
    cancellation: &CancellationToken,
) -> Result<PreparedFileTool, AppError> {
    git_cancellation::with(Some(cancellation), || {
        check(cancellation)?;
        profile.validate()?;
        let role = match &request {
            FileToolRequest::Editor { .. } => ToolRole::Editor,
            FileToolRequest::Diff { .. } | FileToolRequest::Comparison { .. } => ToolRole::Diff,
            FileToolRequest::Merge { .. } => ToolRole::Merge,
        };
        if profile.role != role {
            return Err(refused(
                "The selected profile does not match the file action.",
            ));
        }
        let root = RootLease::capture(root)?;
        let snapshot_parent = if role == ToolRole::Editor {
            snapshot_parent.to_owned()
        } else {
            outside_repository(&root, snapshot_parent)?
        };
        let program = ProgramLease::capture(&profile)?;
        let mut context = ToolArgumentContext {
            repository: root.path.clone(),
            ..Default::default()
        };
        let mut sources = Vec::new();
        let mut comparison = None;
        let mut sides = Vec::new();
        let mut editor = None;
        let mut merge = None;
        let mut copies = PreparationCopies(None);
        match request {
            FileToolRequest::Editor { path, line } => {
                if line == Some(0) {
                    return Err(refused("Use a positive one-based editor line."));
                }
                let captured = EditorLease::capture(&root, &path)?;
                sides.push(FileToolSideReview {
                    role: "file".into(),
                    path: path.clone(),
                    kind: "regular".into(),
                    bytes: captured.metadata.len(),
                    oid: None,
                });
                context.file = Some(root.path.join(&path));
                context.line = line;
                editor = Some(captured);
            }
            FileToolRequest::Diff { before, after } => {
                let a = source(&root.path, &before, cancellation)?;
                let b = source(&root.path, &after, cancellation)?;
                check(cancellation)?;
                let snapshots = copies
                    .0
                    .insert(FileToolSnapshots::create(&snapshot_parent, uid)?);
                context.before = Some(snapshots.materialize(
                    FileToolSnapshotRole::Before,
                    extension(before.path()),
                    a.bytes.as_deref().unwrap_or_default(),
                )?);
                context.after = Some(snapshots.materialize(
                    FileToolSnapshotRole::After,
                    extension(after.path()),
                    b.bytes.as_deref().unwrap_or_default(),
                )?);
                sides.push(side("before", before.path(), &a));
                sides.push(side("after", after.path(), &b));
                sources.push((before, a));
                sources.push((after, b));
            }
            FileToolRequest::Comparison { request } => {
                let resolved = super::read_file_comparison(&root.path, &request, cancellation)?;
                let content = |side: &super::FileComparisonSide| -> Result<FileContent, AppError> {
                    let super::FileComparisonValue::Available(value) = &side.content else {
                        return Err(refused(
                            "A selected comparison side is unavailable. No partial comparison was launched.",
                        ));
                    };
                    if value.over_limit
                        || !matches!(
                            value.kind,
                            FileContentKind::Absent
                                | FileContentKind::Regular
                                | FileContentKind::SymbolicLink
                        )
                        || (value.kind != FileContentKind::Absent && value.bytes.is_none())
                    {
                        return Err(refused(
                            "Both complete comparison sides must fit the tool snapshot limit.",
                        ));
                    }
                    Ok(value.clone())
                };
                let before = content(&resolved.before)?;
                let after = content(&resolved.after)?;
                check(cancellation)?;
                let snapshots = copies
                    .0
                    .insert(FileToolSnapshots::create(&snapshot_parent, uid)?);
                context.before = Some(snapshots.materialize(
                    FileToolSnapshotRole::Before,
                    extension(&resolved.before.path),
                    before.bytes.as_deref().unwrap_or_default(),
                )?);
                context.after = Some(snapshots.materialize(
                    FileToolSnapshotRole::After,
                    extension(&resolved.after.path),
                    after.bytes.as_deref().unwrap_or_default(),
                )?);
                sides.push(side("before", &resolved.before.path, &before));
                sides.push(side("after", &resolved.after.path, &after));
                comparison = Some((request, resolved));
            }
            FileToolRequest::Merge { path } => {
                let entries = merge_entries(&root.path, &path)?;
                let values = merge_sides(&root.path, &path, &entries)?;
                let working = read_file_content(
                    &root.path,
                    &FileContentLocation::WorkingTree,
                    &path,
                    cancellation,
                )?;
                if working.over_limit
                    || !matches!(
                        working.kind,
                        FileContentKind::Regular | FileContentKind::Absent
                    )
                {
                    return Err(refused(
                        "The merge output needs a bounded regular working file or an absent path.",
                    ));
                }
                let working_file = if working.kind == FileContentKind::Regular {
                    Some(EditorLease::capture(&root, &path)?)
                } else {
                    None
                };
                let byte_edit = if working.kind == FileContentKind::Regular {
                    let edit = WorkingFileBytesEdit::capture(&root.path, &path, cancellation)?;
                    if Some(edit.bytes()) != working.bytes.as_deref() {
                        return Err(refused("The working merge file changed during capture."));
                    }
                    Some(edit)
                } else {
                    None
                };
                check(cancellation)?;
                let snapshots = copies
                    .0
                    .insert(FileToolSnapshots::create(&snapshot_parent, uid)?);
                for ((slot, label), value) in [
                    (FileToolSnapshotRole::Base, "base"),
                    (FileToolSnapshotRole::Before, "current"),
                    (FileToolSnapshotRole::After, "incoming"),
                ]
                .into_iter()
                .zip(values)
                {
                    let (oid, bytes) =
                        value.map_or((None, Vec::new()), |(oid, bytes)| (Some(oid), bytes));
                    let destination = snapshots.materialize(slot, extension(&path), &bytes)?;
                    sides.push(FileToolSideReview {
                        role: label.into(),
                        path: path.clone(),
                        kind: if oid.is_some() { "regular" } else { "absent" }.into(),
                        bytes: bytes.len() as u64,
                        oid,
                    });
                    match slot {
                        FileToolSnapshotRole::Base => context.base = Some(destination),
                        FileToolSnapshotRole::Before => context.before = Some(destination),
                        FileToolSnapshotRole::After => context.after = Some(destination),
                        _ => unreachable!(),
                    }
                }
                context.merged = Some(snapshots.materialize(
                    FileToolSnapshotRole::Merged,
                    extension(&path),
                    working.bytes.as_deref().unwrap_or_default(),
                )?);
                sides.push(side("merged", &path, &working));
                merge = Some(MergeLease {
                    path,
                    entries,
                    working,
                    working_file,
                    byte_edit,
                    saved: None,
                });
            }
        }
        let review = FileToolLaunchReview {
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            role,
            executable: profile.executable.clone(),
            arguments: profile.expanded_arguments(&context)?,
            repository_path: root
                .path
                .to_str()
                .ok_or_else(|| refused("The repository path cannot be represented."))?
                .into(),
            sides,
        };
        let prepared = PreparedFileTool {
            root,
            program,
            review,
            sources,
            comparison,
            editor,
            merge,
            snapshots: copies.0.take(),
            retired: false,
            launched: false,
        };
        if let Err(error) = prepared.verify(cancellation) {
            let mut prepared = prepared;
            let _ = prepared.discard();
            return Err(error);
        }
        Ok(prepared)
    })
}
#[cfg(test)]
#[path = "file_tools_tests.rs"]
mod tests;
