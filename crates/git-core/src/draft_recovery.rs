//! Original versioned data model for local unsaved-editor recovery.
//! Records are recovery data, never authority to overwrite a working file.
use crate::{AppError, WorkingTextEncoding};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path};

pub const MAX_RECOVERY_TEXT_BYTES: usize = 3 * 1024 * 1024;
pub const MAX_RECOVERY_RECORD_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_RECOVERY_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_RECOVERY_DRAFTS: usize = 8;
const MAX_PATH_BYTES: usize = 16 * 1024;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryDraftRecord {
    pub version: u8,
    pub id: String,
    pub repository_path: String,
    pub path: String,
    pub encoding: WorkingTextEncoding,
    pub baseline_sha256: String,
    pub revision: String,
    pub sequence: u32,
    pub text: String,
    /// Canonical decimal milliseconds; no lossy wide-integer JSON conversion.
    pub updated_at_millis: String,
}
impl std::fmt::Debug for RecoveryDraftRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RecoveryDraftRecord")
            .field("id", &self.id)
            .field("encoding", &self.encoding)
            .field("sequence", &self.sequence)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftSummary {
    pub id: String,
    pub repository_path: String,
    pub path: String,
    pub encoding: WorkingTextEncoding,
    pub text_bytes: String,
    pub updated_at_millis: String,
    pub pending: bool,
    pub sequence: u32,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryDraftEntryKind {
    Committed,
    Pending,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftEntryReview {
    pub id: String,
    pub kind: RecoveryDraftEntryKind,
    pub review_token: Option<String>,
    pub draft: Option<RecoveryDraftSummary>,
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftIssue {
    pub id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftInspection {
    pub entries: Vec<RecoveryDraftEntryReview>,
    pub issues: Vec<RecoveryDraftIssue>,
    pub incomplete: bool,
}

pub(crate) fn recovery_invalid(message: &str) -> AppError {
    AppError::new(
        "draftRecoveryInvalid",
        message,
        Some("Your working file was not changed."),
    )
}
pub fn validate_recovery_id(id: &str) -> Result<(), AppError> {
    if lower_hex(id, 32) {
        Ok(())
    } else {
        Err(recovery_invalid("The recovery identifier is invalid."))
    }
}
fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}
fn bounded_path(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_PATH_BYTES && !value.contains('\0')
}

pub fn recovery_text_sha256(text: &str) -> Result<String, AppError> {
    if text.len() > MAX_RECOVERY_TEXT_BYTES || text.contains('\0') {
        return Err(recovery_invalid(
            "The recovery text exceeds the size limit or contains NUL characters.",
        ));
    }
    let mut hasher = gix::hash::hasher(gix::hash::Kind::Sha256);
    hasher.update(text.as_bytes());
    hasher
        .try_finalize()
        .map(|hash| hash.to_string())
        .map_err(|_| recovery_invalid("The recovery baseline could not be fingerprinted."))
}
impl RecoveryDraftRecord {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_recovery_id(&self.id)?;
        if self.version != 1 || !lower_hex(&self.revision, 32) || self.sequence == 0 {
            return Err(recovery_invalid(
                "The recovery version, revision or sequence is invalid.",
            ));
        }
        if !bounded_path(&self.repository_path) || !Path::new(&self.repository_path).is_absolute() {
            return Err(recovery_invalid(
                "A recovery draft requires a bounded absolute repository location.",
            ));
        }
        if !bounded_path(&self.path) || Path::new(&self.path).is_absolute()
            || !Path::new(&self.path).components().all(|component| {
                matches!(component, Component::Normal(name) if !name.to_string_lossy().eq_ignore_ascii_case(".git"))
            }) {
            return Err(recovery_invalid("A recovery draft requires a literal working-file path outside Git metadata."));
        }
        if !lower_hex(&self.baseline_sha256, 64) {
            return Err(recovery_invalid(
                "The recovery baseline fingerprint is invalid.",
            ));
        }
        if self.text.len() > MAX_RECOVERY_TEXT_BYTES || self.text.contains('\0') {
            return Err(recovery_invalid(
                "Recovery text exceeds the size limit or contains NUL characters.",
            ));
        }
        if self
            .updated_at_millis
            .parse::<u64>()
            .ok()
            .is_none_or(|time| time.to_string() != self.updated_at_millis)
        {
            return Err(recovery_invalid("The recovery timestamp is invalid."));
        }
        Ok(())
    }
    pub fn summary(&self, pending: bool) -> RecoveryDraftSummary {
        RecoveryDraftSummary {
            id: self.id.clone(),
            repository_path: self.repository_path.clone(),
            path: self.path.clone(),
            encoding: self.encoding,
            text_bytes: self.text.len().to_string(),
            updated_at_millis: self.updated_at_millis.clone(),
            pending,
            sequence: self.sequence,
        }
    }
    /// Timestamp changes alone do not turn a repeated sequence into new content.
    pub fn same_contents(&self, other: &Self) -> bool {
        self.version == other.version
            && self.id == other.id
            && self.repository_path == other.repository_path
            && self.path == other.path
            && self.encoding == other.encoding
            && self.baseline_sha256 == other.baseline_sha256
            && self.revision == other.revision
            && self.sequence == other.sequence
            && self.text == other.text
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    fn record() -> RecoveryDraftRecord {
        RecoveryDraftRecord {
            version: 1,
            id: "a".repeat(32),
            repository_path: "/owned/repository [one]".into(),
            path: "literal 'file';[x].txt".into(),
            encoding: WorkingTextEncoding::Utf16Le,
            baseline_sha256: recovery_text_sha256("baseline\n").unwrap(),
            revision: "b".repeat(32),
            sequence: 1,
            text: "unsaved é\n".into(),
            updated_at_millis: "1793510000000".into(),
        }
    }
    #[test]
    fn recovery_model_keeps_literal_text_paths_and_encodings_without_authorizing_a_write() {
        let data = record();
        data.validate().unwrap();
        let encoded = serde_json::to_vec(&data).unwrap();
        let decoded: RecoveryDraftRecord = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(decoded, data);
        assert_eq!(decoded.summary(true).text_bytes, "11");
        assert!(decoded.summary(true).pending);
        assert!(!format!("{data:?}").contains("unsaved"));
        assert!(!format!("{data:?}").contains("/owned"));
    }
    #[test]
    fn recovery_baselines_use_standard_sha256_and_bounded_utf8_text() {
        assert_eq!(
            recovery_text_sha256("abc").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(recovery_text_sha256("bad\0text").is_err());
        assert!(recovery_text_sha256(&"x".repeat(MAX_RECOVERY_TEXT_BYTES + 1)).is_err());
    }
    #[test]
    fn recovery_model_refuses_metadata_escape_unknown_versions_and_bad_sequences() {
        for path in [
            "",
            "/absolute",
            "../outside",
            "x/../outside",
            ".git/config",
            "x/.GiT/index",
        ] {
            let mut data = record();
            data.path = path.into();
            assert!(data.validate().is_err(), "{path}");
        }
        for value in ["../outside", "f", "A00000000000000000000000000000000"] {
            assert!(validate_recovery_id(value).is_err());
        }
        let mut data = record();
        data.version = 2;
        assert!(data.validate().is_err());
        data.version = 1;
        data.sequence = 0;
        assert!(data.validate().is_err());
        data.sequence = 1;
        data.updated_at_millis = "01".into();
        assert!(data.validate().is_err());
    }
    #[test]
    fn recovery_sequences_are_idempotent_only_for_the_same_captured_content_and_binding() {
        let data = record();
        let mut next = data.clone();
        next.updated_at_millis = "1793510000001".into();
        assert!(data.same_contents(&next));
        next.text.push('x');
        assert!(!data.same_contents(&next));
        next = data.clone();
        next.revision = "c".repeat(32);
        assert!(!data.same_contents(&next));
        let mut value = serde_json::to_value(&data).unwrap();
        value["extra"] = serde_json::json!(true);
        assert!(serde_json::from_value::<RecoveryDraftRecord>(value).is_err());
    }
}
