//! Recovery metadata comes from an opened editor, never a renderer-supplied path.
use crate::draft_recovery::{
    MAX_RECOVERY_TEXT_BYTES, RecoveryDraftGitContext, RecoveryDraftGitContextMatch,
    RecoveryDraftRecord, recovery_invalid, recovery_text_sha256,
};
use crate::{AppError, CancellationToken, WorkingFileEdit, WorkingTextEncoding};
use serde::Serialize;
use std::path::Path;

/// Metadata only. This cannot save a file and is not deserializable from IPC.
#[derive(Clone)]
pub struct WorkingFileRecoveryBinding {
    repository_path: String,
    path: String,
    encoding: WorkingTextEncoding,
    baseline_sha256: String,
    git_context: Option<RecoveryDraftGitContext>,
}

/// Comparison with an independently opened, currently verified editor. Even all
/// matching fields do not authorize a write or establish filesystem identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftEditorReview {
    pub repository_location_matches: bool,
    pub path_matches: bool,
    pub encoding_matches: bool,
    /// Only the normalized editor text, not raw bytes, BOM or file identity.
    pub baseline_text_matches: bool,
    pub git_context: RecoveryDraftGitContextMatch,
}

/// HTML textareas normalize CRLF and CR to LF. Recovery fingerprints the same
/// representation, while the fresh editor controls actual file encoding/endings.
pub fn recovery_editor_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

impl WorkingFileRecoveryBinding {
    /// Metadata equality only, for identifying this session's stored copies.
    /// This does not authorize a working-file write or prove current identity.
    pub fn matches_record(&self, record: &RecoveryDraftRecord) -> bool {
        self.repository_path == record.repository_path
            && self.path == record.path
            && self.encoding == record.encoding
            && self.baseline_sha256 == record.baseline_sha256
            && self.git_context == record.git_context
    }
    pub(crate) fn capture(root: &Path, edit: &WorkingFileEdit) -> Result<Self, AppError> {
        let repository_path = root.to_str().ok_or_else(|| {
            recovery_invalid("The repository location cannot be represented exactly for recovery.")
        })?;
        let context = RecoveryDraftGitContext {
            working_reference: edit.working_reference().map(str::to_owned),
            head_oid: edit.head_oid().map(str::to_owned),
        };
        let git_context =
            (context.working_reference.is_some() || context.head_oid.is_some()).then_some(context);
        if let Some(context) = git_context.as_ref() {
            context.validate()?;
        }
        Ok(Self {
            repository_path: repository_path.into(),
            path: edit.path().into(),
            encoding: edit.text().encoding(),
            baseline_sha256: recovery_text_sha256(&recovery_editor_text(edit.text().text()))?,
            git_context,
        })
    }

    /// The native caller supplies its owned identifiers, ordering and clock.
    /// Producing a record does not persist it or touch its working path.
    pub fn record(
        &self,
        id: &str,
        revision: &str,
        sequence: u32,
        text: &str,
        updated_at_millis: &str,
    ) -> Result<RecoveryDraftRecord, AppError> {
        // Validate the bound before allocating another copy of an IPC draft.
        if text.len() > MAX_RECOVERY_TEXT_BYTES || text.contains('\0') {
            return Err(recovery_invalid(
                "The recovery text exceeds the size limit or contains NUL characters.",
            ));
        }
        let record = RecoveryDraftRecord {
            version: 1,
            id: id.into(),
            repository_path: self.repository_path.clone(),
            path: self.path.clone(),
            encoding: self.encoding,
            baseline_sha256: self.baseline_sha256.clone(),
            git_context: self.git_context.clone(),
            revision: revision.into(),
            sequence,
            text: text.into(),
            updated_at_millis: updated_at_millis.into(),
        };
        record.validate()?;
        Ok(record)
    }
}

impl RecoveryDraftRecord {
    /// This never opens a path from the record. The caller must independently
    /// select/open the current editor. Its ordinary save checks still apply.
    pub fn review_with_editor(
        &self,
        current: &WorkingFileEdit,
        cancellation: &CancellationToken,
    ) -> Result<RecoveryDraftEditorReview, AppError> {
        self.validate()?;
        current.verify_current(cancellation)?;
        let binding = current.recovery_binding()?;
        let git_context = match binding.git_context.as_ref() {
            Some(context) => self.compare_git_context(context)?,
            None => RecoveryDraftGitContextMatch::Unknown,
        };
        Ok(RecoveryDraftEditorReview {
            repository_location_matches: self.repository_path == binding.repository_path,
            path_matches: self.path == binding.path,
            encoding_matches: self.encoding == binding.encoding,
            baseline_text_matches: self.baseline_sha256 == binding.baseline_sha256,
            git_context,
        })
    }
}
