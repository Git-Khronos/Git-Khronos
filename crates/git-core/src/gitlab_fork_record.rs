//! Durable fork-outcome data model; disk storage and native dispatch are separate.
//! Records are data, never authority to dispatch, replay, open paths or run Git.
use crate::{
    AppError, GitLabForkDispatch, GitLabForkImportState, GitLabInstance, GitLabNamespaceKind,
};
use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabForkIntent {
    pub origin: String,
    pub account_id: String,
    pub account_login: String,
    pub source_id: String,
    pub source_full_path: String,
    pub source_empty: Option<bool>,
    pub namespace_id: String,
    pub namespace_full_path: String,
    pub namespace_kind: GitLabNamespaceKind,
    pub project_path: String,
    pub project_name: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GitLabForkPhase {
    AwaitingConfirmation,
    AcceptedPending,
    MetadataVerified,
    ImportFailed,
    Conflict,
    ResponseRejected,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GitLabForkFailure {
    Interrupted,
    Connection,
    InvalidReply,
    StorageUnconfirmed,
    IdentityMismatch,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabForkRecord {
    pub version: u8,
    pub id: String,
    pub revision: String,
    pub created_at_millis: String,
    pub updated_at_millis: String,
    pub intent: GitLabForkIntent,
    pub phase: GitLabForkPhase,
    pub project_id: Option<String>,
    pub project_empty: Option<bool>,
    pub http_status: Option<u16>,
    #[serde(deserialize_with = "saved_import_state")]
    pub import_state: GitLabForkImportState,
    pub last_failure: Option<GitLabForkFailure>,
}
fn refused() -> AppError {
    AppError::new(
        "gitlabForkRecord",
        "The saved fork outcome is incomplete or inconsistent. It was retained.",
        None,
    )
}
fn decimal(value: &str, positive: bool) -> Result<u64, AppError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|n| (!positive || *n > 0) && n.to_string() == value)
        .ok_or_else(refused)
}
fn resource(value: &str) -> bool {
    decimal(value, true).is_ok()
}
fn full_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4096
        && value.trim() == value
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|part| !part.is_empty() && !matches!(part, "." | "..") && !part.contains('\\'))
}
fn saved_import_state<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<GitLabForkImportState, D::Error> {
    let value = String::deserialize(deserializer)?;
    match value.as_str() {
        "none" => Ok(GitLabForkImportState::None),
        "scheduled" => Ok(GitLabForkImportState::Scheduled),
        "started" => Ok(GitLabForkImportState::Started),
        "finished" => Ok(GitLabForkImportState::Finished),
        "failed" => Ok(GitLabForkImportState::Failed),
        "unknown" => Ok(GitLabForkImportState::Unknown),
        _ => Err(serde::de::Error::custom("Unsupported saved import state")),
    }
}
impl GitLabForkIntent {
    pub fn validate(&self) -> Result<(), AppError> {
        GitLabForkDispatch::new(
            &self.source_id,
            &self.namespace_id,
            &self.project_path,
            self.project_name.as_deref(),
        )?;
        if GitLabInstance::parse(&self.origin)?.origin() != self.origin
            || !resource(&self.account_id)
            || self.account_login.is_empty()
            || self.account_login.len() > 255
            || self.account_login.trim() != self.account_login
            || self.account_login.chars().any(char::is_control)
            || !full_path(&self.source_full_path)
            || !self.source_full_path.contains('/')
            || !full_path(&self.namespace_full_path)
            || (self.namespace_kind == GitLabNamespaceKind::User
                && self.namespace_full_path.contains('/'))
            || self.target_full_path() == self.source_full_path
        {
            return Err(refused());
        }
        Ok(())
    }
    pub fn target_full_path(&self) -> String {
        format!("{}/{}", self.namespace_full_path, self.project_path)
    }
}
impl GitLabForkRecord {
    pub fn new(id: String, intent: GitLabForkIntent, now_millis: String) -> Result<Self, AppError> {
        let record = Self {
            version: 1,
            id,
            revision: "1".into(),
            created_at_millis: now_millis.clone(),
            updated_at_millis: now_millis,
            intent,
            phase: GitLabForkPhase::AwaitingConfirmation,
            project_id: None,
            project_empty: None,
            http_status: None,
            import_state: GitLabForkImportState::Unknown,
            last_failure: None,
        };
        record.validate()?;
        Ok(record)
    }
    pub fn validate(&self) -> Result<(), AppError> {
        self.intent.validate()?;
        if self.version != 1
            || self.id.len() != 32
            || !self
                .id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || decimal(&self.revision, true).is_err()
            || decimal(&self.updated_at_millis, false)? < decimal(&self.created_at_millis, false)?
            || self.project_id.as_deref().is_some_and(|id| !resource(id))
            || self
                .http_status
                .is_some_and(|status| !(100..=599).contains(&status))
        {
            return Err(refused());
        }
        let bound = self.project_id.is_some();
        let phase_valid = match self.phase {
            GitLabForkPhase::AwaitingConfirmation => {
                !bound
                    && self.project_empty.is_none()
                    && self
                        .http_status
                        .is_none_or(|status| (200..=299).contains(&status))
                    && self.import_state == GitLabForkImportState::Unknown
            }
            GitLabForkPhase::AcceptedPending => bound,
            GitLabForkPhase::MetadataVerified => {
                bound
                    && (self.import_state == GitLabForkImportState::Finished
                        || (self.import_state == GitLabForkImportState::None
                            && self.intent.source_empty == Some(true)
                            && self.project_empty == Some(true)))
            }
            GitLabForkPhase::ImportFailed => {
                bound && self.import_state == GitLabForkImportState::Failed
            }
            GitLabForkPhase::Conflict => self.last_failure.is_some(),
            GitLabForkPhase::ResponseRejected => {
                !bound
                    && self.project_empty.is_none()
                    && self.import_state == GitLabForkImportState::Unknown
                    && self
                        .http_status
                        .is_some_and(|status| !(200..=299).contains(&status))
            }
        };
        if !phase_valid {
            return Err(refused());
        }
        Ok(())
    }
    /// Call only with a freshly verified matching project, never list membership
    /// or a project found merely at the old destination path. Bind the ID once.
    pub fn observe_verified(
        &self,
        project_id: &str,
        state: GitLabForkImportState,
        project_empty: Option<bool>,
        now_millis: &str,
    ) -> Result<Self, AppError> {
        self.validate()?;
        if !resource(project_id)
            || self
                .project_id
                .as_deref()
                .is_some_and(|old| old != project_id)
        {
            return Err(refused());
        }
        let mut next = self.next(now_millis)?;
        next.project_id = Some(project_id.into());
        next.project_empty = project_empty;
        next.import_state = state;
        next.last_failure = None;
        next.phase = match state {
            GitLabForkImportState::Finished => GitLabForkPhase::MetadataVerified,
            GitLabForkImportState::None
                if next.intent.source_empty == Some(true) && project_empty == Some(true) =>
            {
                GitLabForkPhase::MetadataVerified
            }
            GitLabForkImportState::Failed => GitLabForkPhase::ImportFailed,
            _ => GitLabForkPhase::AcceptedPending,
        };
        next.validate()?;
        Ok(next)
    }
    pub fn conflict(&self, now_millis: &str) -> Result<Self, AppError> {
        self.validate()?;
        let mut next = self.next(now_millis)?;
        next.phase = GitLabForkPhase::Conflict;
        next.last_failure = Some(GitLabForkFailure::IdentityMismatch);
        next.validate()?;
        Ok(next)
    }
    /// A failed fresh inspection must not leave an earlier ready import looking
    /// current. Preserve the bound ID and original intent, and grant no replay.
    pub fn inspection_unconfirmed(
        &self,
        failure: GitLabForkFailure,
        now_millis: &str,
    ) -> Result<Self, AppError> {
        self.validate()?;
        if failure == GitLabForkFailure::IdentityMismatch {
            return self.conflict(now_millis);
        }
        let mut next = self.next(now_millis)?;
        next.phase = if next.project_id.is_some() {
            GitLabForkPhase::AcceptedPending
        } else if next
            .http_status
            .is_some_and(|status| !(200..=299).contains(&status))
        {
            GitLabForkPhase::ResponseRejected
        } else {
            GitLabForkPhase::AwaitingConfirmation
        };
        next.project_empty = None;
        next.import_state = GitLabForkImportState::Unknown;
        next.last_failure = Some(failure);
        next.validate()?;
        Ok(next)
    }
    pub fn interrupted(
        &self,
        failure: GitLabForkFailure,
        now_millis: &str,
    ) -> Result<Self, AppError> {
        self.validate()?;
        if failure == GitLabForkFailure::IdentityMismatch {
            return self.conflict(now_millis);
        }
        let mut next = self.next(now_millis)?;
        next.last_failure = Some(failure);
        next.validate()?;
        Ok(next)
    }
    /// A successful HTTP status alone does not identify or verify a project.
    pub fn accepted_status(&self, status: u16, now_millis: &str) -> Result<Self, AppError> {
        self.validate()?;
        if self.phase != GitLabForkPhase::AwaitingConfirmation
            || self.http_status.is_some()
            || !(200..=299).contains(&status)
        {
            return Err(refused());
        }
        let mut next = self.next(now_millis)?;
        next.http_status = Some(status);
        next.validate()?;
        Ok(next)
    }
    pub fn rejected(&self, status: u16, now_millis: &str) -> Result<Self, AppError> {
        self.validate()?;
        if self.phase != GitLabForkPhase::AwaitingConfirmation
            || self.http_status.is_some()
            || (200..=299).contains(&status)
            || !(100..=599).contains(&status)
        {
            return Err(refused());
        }
        let mut next = self.next(now_millis)?;
        next.http_status = Some(status);
        next.phase = GitLabForkPhase::ResponseRejected;
        next.validate()?;
        Ok(next)
    }
    fn next(&self, now_millis: &str) -> Result<Self, AppError> {
        let revision = decimal(&self.revision, true)?
            .checked_add(1)
            .ok_or_else(refused)?;
        let updated = decimal(&self.updated_at_millis, false)?.max(decimal(now_millis, false)?);
        let mut next = self.clone();
        next.revision = revision.to_string();
        next.updated_at_millis = updated.to_string();
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn intent() -> GitLabForkIntent {
        GitLabForkIntent {
            origin: "https://gitlab.example.test:8443".into(),
            account_id: "9007199254740993".into(),
            account_login: "owned-reader".into(),
            source_id: "101".into(),
            source_full_path: "team/upstream".into(),
            source_empty: None,
            namespace_id: "9007199254740995".into(),
            namespace_full_path: "owned-reader".into(),
            namespace_kind: GitLabNamespaceKind::User,
            project_path: "reviewed-project".into(),
            project_name: Some("Reviewed project".into()),
        }
    }
    fn record() -> GitLabForkRecord {
        GitLabForkRecord::new("a".repeat(32), intent(), "1793580000000".into()).unwrap()
    }
    #[test]
    fn fork_record_failed_fresh_inspection_revokes_readiness_without_losing_bound_identity() {
        let original = record()
            .observe_verified(
                "202",
                GitLabForkImportState::Finished,
                Some(false),
                "1793580000001",
            )
            .unwrap();
        let unknown = original
            .inspection_unconfirmed(GitLabForkFailure::Connection, "1793580000002")
            .unwrap();
        assert_eq!(original.phase, GitLabForkPhase::MetadataVerified);
        assert_eq!(unknown.phase, GitLabForkPhase::AcceptedPending);
        assert_eq!(unknown.project_id.as_deref(), Some("202"));
        assert_eq!(unknown.import_state, GitLabForkImportState::Unknown);
        assert_eq!(unknown.project_empty, None);
        assert_eq!(unknown.intent, original.intent);
        assert_eq!(unknown.last_failure, Some(GitLabForkFailure::Connection));
        unknown.validate().unwrap();
    }
    #[test]
    fn fork_record_unconfirmed_inspection_preserves_rejection_and_has_no_replay_authority() {
        let original = record().rejected(403, "1793580000001").unwrap();
        let next = original
            .inspection_unconfirmed(GitLabForkFailure::InvalidReply, "1793580000002")
            .unwrap();
        assert_eq!(next.phase, GitLabForkPhase::ResponseRejected);
        assert_eq!(next.http_status, Some(403));
        assert!(next.project_id.is_none());
        assert_eq!(next.intent, original.intent);
        assert_eq!(
            next.inspection_unconfirmed(GitLabForkFailure::IdentityMismatch, "1793580000003")
                .unwrap()
                .phase,
            GitLabForkPhase::Conflict
        );
    }
    #[test]
    fn fork_record_roundtrip_preserves_intent_wide_strings_and_uncertain_outcome_without_authority()
    {
        let original = record();
        let bytes = serde_json::to_vec(&original).unwrap();
        let restored: GitLabForkRecord = serde_json::from_slice(&bytes).unwrap();
        restored.validate().unwrap();
        assert_eq!(restored, original);
        assert_eq!(restored.phase, GitLabForkPhase::AwaitingConfirmation);
        assert!(restored.project_id.is_none());
        let value = serde_json::to_value(restored).unwrap();
        assert_eq!(value["intent"]["accountId"], "9007199254740993");
        for key in [
            "token",
            "connectionId",
            "endpoint",
            "credential",
            "dispatchAuthority",
        ] {
            assert!(value.get(key).is_none());
        }
    }
    #[test]
    fn fork_record_refuses_unknown_fields_versions_resource_paths_and_impossible_states() {
        for field in ["credential", "token", "endpoint"] {
            let mut v = serde_json::to_value(record()).unwrap();
            v[field] = serde_json::json!("owned-secret");
            assert!(serde_json::from_value::<GitLabForkRecord>(v).is_err());
        }
        let mut bad = record();
        bad.version = 2;
        assert!(bad.validate().is_err());
        let mut bad = record();
        bad.id = "../unowned".into();
        assert!(bad.validate().is_err());
        let mut bad = record();
        bad.http_status = Some(700);
        assert!(bad.validate().is_err());
        let mut bad = record();
        bad.updated_at_millis = "1".into();
        assert!(bad.validate().is_err());
        let mut bad = record();
        bad.phase = GitLabForkPhase::MetadataVerified;
        assert!(bad.validate().is_err());
        let mut bad = record();
        bad.intent.namespace_full_path = "owned/../reader".into();
        assert!(bad.validate().is_err());
        let mut bad = record();
        bad.intent.origin = "https://secret@gitlab.example.test".into();
        assert!(bad.validate().is_err());
        let mut bad = record();
        bad.revision = "01".into();
        assert!(bad.validate().is_err());
    }
    #[test]
    fn fork_record_metadata_does_not_invent_import_readiness_or_a_default_branch() {
        for state in [
            GitLabForkImportState::None,
            GitLabForkImportState::Scheduled,
            GitLabForkImportState::Started,
            GitLabForkImportState::Unknown,
        ] {
            assert_eq!(
                record()
                    .observe_verified("202", state, None, "1793580000001")
                    .unwrap()
                    .phase,
                GitLabForkPhase::AcceptedPending
            );
        }
        assert_eq!(
            record()
                .observe_verified(
                    "202",
                    GitLabForkImportState::Finished,
                    None,
                    "1793580000001"
                )
                .unwrap()
                .phase,
            GitLabForkPhase::MetadataVerified
        );
        assert_eq!(
            record()
                .observe_verified("202", GitLabForkImportState::Failed, None, "1793580000001")
                .unwrap()
                .phase,
            GitLabForkPhase::ImportFailed
        );
        let mut empty = record();
        empty.intent.source_empty = Some(true);
        for target_empty in [None, Some(false)] {
            assert_eq!(
                empty
                    .observe_verified(
                        "202",
                        GitLabForkImportState::None,
                        target_empty,
                        "1793580000001"
                    )
                    .unwrap()
                    .phase,
                GitLabForkPhase::AcceptedPending
            );
        }
        assert_eq!(
            empty
                .observe_verified(
                    "202",
                    GitLabForkImportState::None,
                    Some(true),
                    "1793580000001"
                )
                .unwrap()
                .phase,
            GitLabForkPhase::MetadataVerified
        );
    }
    #[test]
    fn fork_record_binds_project_once_and_conflict_never_retargets_it() {
        let bound = record()
            .observe_verified("202", GitLabForkImportState::Started, None, "1793580000001")
            .unwrap();
        let conflict = bound.conflict("1793580000002").unwrap();
        assert_eq!(conflict.project_id.as_deref(), Some("202"));
        assert_eq!(conflict.intent, bound.intent);
        assert!(
            conflict
                .observe_verified(
                    "203",
                    GitLabForkImportState::Finished,
                    None,
                    "1793580000003"
                )
                .is_err()
        );
        assert_eq!(
            conflict
                .observe_verified(
                    "202",
                    GitLabForkImportState::Finished,
                    None,
                    "1793580000003"
                )
                .unwrap()
                .phase,
            GitLabForkPhase::MetadataVerified
        );
    }
    #[test]
    fn fork_record_rejected_or_interrupted_outcome_remains_data_until_fresh_inspection() {
        let accepted = record().accepted_status(201, "1793580000001").unwrap();
        assert_eq!(accepted.phase, GitLabForkPhase::AwaitingConfirmation);
        assert!(accepted.project_id.is_none());
        assert_eq!(accepted.http_status, Some(201));
        assert!(accepted.accepted_status(201, "1793580000002").is_err());
        let failed_refresh = record()
            .conflict("1793580000001")
            .unwrap()
            .interrupted(GitLabForkFailure::Connection, "1793580000002")
            .unwrap();
        assert_eq!(failed_refresh.phase, GitLabForkPhase::Conflict);
        assert_eq!(
            failed_refresh.last_failure,
            Some(GitLabForkFailure::Connection)
        );
        let rejected = record().rejected(503, "1793580000001").unwrap();
        assert_eq!(rejected.phase, GitLabForkPhase::ResponseRejected);
        assert_eq!(rejected.http_status, Some(503));
        assert!(rejected.rejected(503, "1793580000002").is_err());
        let verified = rejected
            .observe_verified(
                "202",
                GitLabForkImportState::Finished,
                None,
                "1793580000002",
            )
            .unwrap();
        assert_eq!(verified.http_status, Some(503));
        assert_eq!(verified.phase, GitLabForkPhase::MetadataVerified);
        let interrupted = record()
            .interrupted(GitLabForkFailure::Interrupted, "1793580000001")
            .unwrap();
        assert_eq!(interrupted.phase, GitLabForkPhase::AwaitingConfirmation);
        assert!(interrupted.project_id.is_none());
        assert_eq!(
            interrupted.last_failure,
            Some(GitLabForkFailure::Interrupted)
        );
    }
    #[test]
    fn fork_record_revision_is_strict_and_clock_rollback_cannot_erase_an_outcome() {
        let original = record();
        let changed = original
            .interrupted(GitLabForkFailure::Connection, "1")
            .unwrap();
        assert_eq!(changed.revision, "2");
        assert_eq!(changed.updated_at_millis, original.updated_at_millis);
        assert_eq!(changed.created_at_millis, original.created_at_millis);
        let mut exhausted = record();
        exhausted.revision = u64::MAX.to_string();
        assert!(
            exhausted
                .interrupted(GitLabForkFailure::Connection, "1793580000001")
                .is_err()
        );
    }
}
