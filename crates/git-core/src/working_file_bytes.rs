//! Native raw-byte write authority sharing the contained text editor publication path.
//! No decoding, assumed encoding, Git staging or program execution occurs here.
use super::*;

pub(crate) struct WorkingFileBytesEdit {
    root: PathBuf,
    file: String,
    bytes: Vec<u8>,
    identity: platform::Identity,
    context: RepositoryEditContext,
    consumed: std::sync::Mutex<bool>,
}
pub(crate) struct WorkingFileBytesSave {
    pub status: WorkingFileWriteStatus,
    pub next: Option<WorkingFileBytesEdit>,
    pub warning: Option<String>,
}
fn stale() -> AppError {
    refused(
        "This byte write review was already used or its outcome is unconfirmed. Reload the working file.",
    )
}
impl WorkingFileBytesEdit {
    pub(crate) fn capture(
        root: &Path,
        file: &str,
        cancellation: &CancellationToken,
    ) -> Result<Self, AppError> {
        validate(file)?;
        check_cancel(cancellation)?;
        let root =
            git_cancellation::with(Some(cancellation), || file_content::worktree_root(root))?;
        let context = repository_context(&root, cancellation)?;
        let (bytes, identity) =
            platform::read_bounded(&root, file, cancellation, MAX_FILE_CONTENT_BYTES)?;
        if repository_context(&root, cancellation)? != context {
            return Err(changed());
        }
        Ok(Self {
            root,
            file: file.into(),
            bytes,
            identity,
            context,
            consumed: Default::default(),
        })
    }
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    fn baseline(&self) -> ByteBaseline<'_> {
        ByteBaseline {
            root: &self.root,
            file: &self.file,
            bytes: &self.bytes,
            identity: &self.identity,
            context: &self.context,
            limit: MAX_FILE_CONTENT_BYTES,
        }
    }
    pub(crate) fn verify_current(&self, cancellation: &CancellationToken) -> Result<(), AppError> {
        let consumed = self.consumed.lock().map_err(|_| stale())?;
        if *consumed {
            return Err(stale());
        }
        self.baseline().verify_context(cancellation)?;
        let (bytes, identity) =
            platform::read_bounded(&self.root, &self.file, cancellation, MAX_FILE_CONTENT_BYTES)?;
        if bytes != self.bytes || identity != self.identity {
            return Err(changed());
        }
        Ok(())
    }
    /// The guard validates caller-owned context before the final file rewalk.
    /// This observes external changes; it is not a lock against concurrent writers.
    pub(crate) fn save(
        &self,
        replacement: &[u8],
        cancellation: &CancellationToken,
        guard: impl FnOnce() -> Result<(), AppError>,
    ) -> Result<WorkingFileBytesSave, AppError> {
        let mut consumed = self.consumed.lock().map_err(|_| stale())?;
        if *consumed {
            return Err(stale());
        }
        check_cancel(cancellation)?;
        if replacement.len() > MAX_FILE_CONTENT_BYTES {
            return Err(refused("The merge output exceeds the byte write limit."));
        }
        self.baseline().verify_context(cancellation)?;
        let (status, durability) =
            platform::replace_bytes(&self.baseline(), replacement, cancellation, guard)?;
        *consumed = true;
        if status == WorkingFileWriteStatus::Unconfirmed {
            return Ok(WorkingFileBytesSave {
                status,
                next: None,
                warning: durability,
            });
        }
        let confirmed = repository_context(&self.root, cancellation).ok();
        let next = match platform::read_bounded(
            &self.root,
            &self.file,
            cancellation,
            MAX_FILE_CONTENT_BYTES,
        ) {
            Ok((bytes, identity))
                if bytes == replacement && confirmed.as_ref() == Some(&self.context) =>
            {
                Some(Self {
                    root: self.root.clone(),
                    file: self.file.clone(),
                    bytes,
                    identity,
                    context: self.context.clone(),
                    consumed: Default::default(),
                })
            }
            _ => None,
        };
        let warning = if next.is_none() {
            Some("The byte write returned, but the current working file could not be confirmed. Reload before saving or staging.".into())
        } else {
            durability
        };
        Ok(WorkingFileBytesSave {
            status,
            next,
            warning,
        })
    }
}

#[cfg(test)]
#[path = "working_file_bytes_tests.rs"]
mod tests;
