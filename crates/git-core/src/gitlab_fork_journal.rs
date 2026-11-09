//! Linux fork journal. Stored records never restore provider write authority.
use crate::{AppError, GitLabForkPhase, GitLabForkRecord};
use std::path::Path;
use std::sync::Arc;
#[path = "gitlab_fork_journal_io.rs"]
mod disk;
use disk::{Fingerprint, Lock, Root, Row, Scan};

#[derive(Clone, Copy)]
struct Limits {
    records: usize,
    versions: usize,
    record_bytes: usize,
    total_bytes: u64,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            records: 256,
            versions: 128,
            record_bytes: 64 * 1024,
            total_bytes: 64 * 1024 * 1024,
        }
    }
}
fn storage() -> AppError {
    AppError::new(
        "gitlabForkJournal",
        "The private fork journal could not be confirmed. Existing entries were retained.",
        None,
    )
}
fn busy() -> AppError {
    AppError::new(
        "gitlabForkJournalBusy",
        "Another local operation holds this fork journal or record.",
        None,
    )
}
fn capacity() -> AppError {
    AppError::new(
        "gitlabForkJournalCapacity",
        "The fork journal reached its configured storage limit. No records were removed.",
        None,
    )
}
fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn revision(value: &str) -> Result<u64, AppError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|n| *n > 0 && n.to_string() == value)
        .ok_or_else(storage)
}
fn initial(record: &GitLabForkRecord) -> Result<(), AppError> {
    record.validate()?;
    if record.revision != "1"
        || record.created_at_millis != record.updated_at_millis
        || record.phase != GitLabForkPhase::AwaitingConfirmation
        || record.project_id.is_some()
        || record.project_empty.is_some()
        || record.http_status.is_some()
        || record.last_failure.is_some()
    {
        return Err(storage());
    }
    Ok(())
}
fn validate_next(previous: &GitLabForkRecord, next: &GitLabForkRecord) -> Result<(), AppError> {
    previous.validate()?;
    next.validate()?;
    if previous.id != next.id
        || previous.version != next.version
        || previous.intent != next.intent
        || previous.created_at_millis != next.created_at_millis
        || revision(&previous.revision)?.checked_add(1) != Some(revision(&next.revision)?)
        || next
            .updated_at_millis
            .parse::<u64>()
            .map_err(|_| storage())?
            < previous
                .updated_at_millis
                .parse::<u64>()
                .map_err(|_| storage())?
        || previous
            .project_id
            .as_ref()
            .is_some_and(|id| next.project_id.as_ref() != Some(id))
        || previous
            .http_status
            .is_some_and(|status| next.http_status != Some(status))
    {
        return Err(storage());
    }
    Ok(())
}
fn same_destination(a: &GitLabForkRecord, b: &GitLabForkRecord) -> bool {
    a.intent.origin == b.intent.origin
        && a.intent.namespace_id == b.intent.namespace_id
        && a.intent
            .project_path
            .eq_ignore_ascii_case(&b.intent.project_path)
}
#[derive(Debug, Clone)]
pub struct GitLabForkJournalEntry {
    pub id: String,
    pub record: Option<GitLabForkRecord>,
    pub pending: bool,
    pub retired: bool,
    pub operation_active: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitLabForkJournalIssueKind {
    UnknownEntry,
    InvalidRecord,
    PendingWrite,
    Capacity,
}
#[derive(Debug, Clone)]
pub struct GitLabForkJournalIssue {
    pub id: Option<String>,
    pub kind: GitLabForkJournalIssueKind,
}
#[derive(Debug, Clone)]
pub struct GitLabForkJournalInspection {
    pub entries: Vec<GitLabForkJournalEntry>,
    pub issues: Vec<GitLabForkJournalIssue>,
    bytes: u64,
}
#[derive(Clone)]
pub struct GitLabForkJournal {
    root: Arc<Root>,
}
pub struct GitLabForkJournalLease {
    root: Arc<Root>,
    row: Row,
    _lock: Lock,
    record: GitLabForkRecord,
    seal: Fingerprint,
}
impl GitLabForkJournal {
    /// Use a native-selected application-data child and its actual effective UID.
    /// The existing parent must belong to that UID and must not be group/world writable.
    pub fn open(path: &Path, uid: u32) -> Result<Self, AppError> {
        Self::with_limits(path, uid, Limits::default())
    }
    fn with_limits(path: &Path, uid: u32, limits: Limits) -> Result<Self, AppError> {
        Ok(Self {
            root: Arc::new(Root::open(path, uid, limits)?),
        })
    }
    fn inspect_locked(&self) -> Result<GitLabForkJournalInspection, AppError> {
        let (ids, unknown) = self.root.names()?;
        let mut result = GitLabForkJournalInspection {
            entries: Vec::new(),
            issues: Vec::new(),
            bytes: 0,
        };
        if unknown {
            result.issues.push(GitLabForkJournalIssue {
                id: None,
                kind: GitLabForkJournalIssueKind::UnknownEntry,
            });
        }
        for id in ids {
            let loaded = (|| {
                let row = self.root.row(&id)?.ok_or_else(storage)?;
                let scan = row.scan(&self.root)?;
                let active = row.active(&self.root)?;
                Ok::<_, AppError>((scan, active))
            })();
            match loaded {
                Ok((scan, active)) => {
                    result.bytes = result.bytes.checked_add(scan.bytes).ok_or_else(capacity)?;
                    let entry = scan.entry(&id, active);
                    if entry.pending {
                        result.issues.push(GitLabForkJournalIssue {
                            id: Some(id.clone()),
                            kind: GitLabForkJournalIssueKind::PendingWrite,
                        });
                    }
                    if entry.record.is_none() {
                        result.issues.push(GitLabForkJournalIssue {
                            id: Some(id.clone()),
                            kind: GitLabForkJournalIssueKind::InvalidRecord,
                        });
                    }
                    result.entries.push(entry);
                }
                Err(_) => result.issues.push(GitLabForkJournalIssue {
                    id: Some(id),
                    kind: GitLabForkJournalIssueKind::InvalidRecord,
                }),
            }
        }
        if result.bytes > self.root.limits.total_bytes {
            result.issues.push(GitLabForkJournalIssue {
                id: None,
                kind: GitLabForkJournalIssueKind::Capacity,
            });
        }
        self.root.check()?;
        Ok(result)
    }
    pub fn inspect(&self) -> Result<GitLabForkJournalInspection, AppError> {
        let _global = self.root.lock()?;
        self.inspect_locked()
    }
    pub fn load(&self, id: &str) -> Result<Option<GitLabForkJournalEntry>, AppError> {
        let _global = self.root.lock()?;
        let Some(row) = self.root.row(id)? else {
            return Ok(None);
        };
        let scan = row.scan(&self.root)?;
        Ok(Some(scan.entry(id, row.active(&self.root)?)))
    }
    fn available(
        &self,
        inspection: &GitLabForkJournalInspection,
        extra: usize,
    ) -> Result<(), AppError> {
        if !inspection.issues.is_empty() {
            return Err(storage());
        }
        if extra > self.root.limits.record_bytes {
            return Err(capacity());
        }
        if inspection
            .bytes
            .checked_add(extra as u64)
            .is_none_or(|n| n > self.root.limits.total_bytes)
        {
            return Err(capacity());
        }
        Ok(())
    }
    /// Called by the one-shot write flow's before-dispatch callback, never on
    /// startup. Only success authorizes that callback to let its POST proceed.
    pub fn begin(&self, record: &GitLabForkRecord) -> Result<GitLabForkJournalLease, AppError> {
        initial(record)?;
        let _global = self.root.lock()?;
        let inspection = self.inspect_locked()?;
        let bytes = serde_json::to_vec(record).map_err(|_| storage())?;
        self.available(&inspection, bytes.len())?;
        if inspection.entries.len() >= self.root.limits.records {
            return Err(capacity());
        }
        if inspection.entries.iter().any(|entry| {
            entry.id == record.id
                || (!entry.retired
                    && entry
                        .record
                        .as_ref()
                        .is_some_and(|old| same_destination(old, record)))
        }) {
            return Err(AppError::new(
                "gitlabForkAlreadyRecorded",
                "Inspect the existing saved fork outcome before another request to this destination.",
                None,
            ));
        }
        let row = self.root.create_row(&record.id)?;
        let lock = row.lock(&self.root)?;
        let seal = row.publish(&self.root, record)?;
        Ok(GitLabForkJournalLease {
            root: self.root.clone(),
            row,
            _lock: lock,
            record: record.clone(),
            seal,
        })
    }
    /// Reacquiring a record permits status persistence, never another POST.
    pub fn lease(
        &self,
        id: &str,
        expected_revision: &str,
    ) -> Result<GitLabForkJournalLease, AppError> {
        revision(expected_revision)?;
        let _global = self.root.lock()?;
        let row = self.root.row(id)?.ok_or_else(storage)?;
        let lock = row.lock(&self.root)?;
        let scan = row.scan(&self.root)?;
        if !scan.pending.is_empty() || scan.retired.is_some() {
            return Err(storage());
        }
        let (record, seal) = scan.committed.last().cloned().ok_or_else(storage)?;
        if record.revision != expected_revision {
            return Err(storage());
        }
        Ok(GitLabForkJournalLease {
            root: self.root.clone(),
            row,
            _lock: lock,
            record,
            seal,
        })
    }
    /// Local retirement retains all bytes and changes no provider resource.
    pub fn retire(
        &self,
        id: &str,
        expected_revision: &str,
        acknowledge_unconfirmed: bool,
    ) -> Result<(), AppError> {
        revision(expected_revision)?;
        let _global = self.root.lock()?;
        let row = self.root.row(id)?.ok_or_else(storage)?;
        let _record = row.lock(&self.root)?;
        let scan = row.scan(&self.root)?;
        if !scan.pending.is_empty() {
            return Err(storage());
        }
        let current = scan.latest().ok_or_else(storage)?;
        if current.revision != expected_revision {
            return Err(storage());
        }
        if scan.retired.is_some() {
            return self.root.sync();
        }
        if !acknowledge_unconfirmed
            && !matches!(
                current.phase,
                GitLabForkPhase::MetadataVerified | GitLabForkPhase::ImportFailed
            )
        {
            return Err(AppError::new(
                "gitlabForkUnconfirmed",
                "Retiring this unconfirmed outcome requires explicit acknowledgement. The provider project will not be deleted.",
                None,
            ));
        }
        let inspection = self.inspect_locked()?;
        let bytes = serde_json::to_vec(current).map_err(|_| storage())?;
        self.available(&inspection, bytes.len())?;
        row.retire(&self.root, current)?;
        Ok(())
    }
}
impl GitLabForkJournalLease {
    pub fn record(&self) -> &GitLabForkRecord {
        &self.record
    }
    fn current(&self) -> Result<Scan, AppError> {
        let scan = self.row.scan(&self.root)?;
        if !scan.pending.is_empty()
            || scan.retired.is_some()
            || !scan
                .committed
                .last()
                .is_some_and(|(record, seal)| record == &self.record && seal == &self.seal)
        {
            return Err(storage());
        }
        Ok(scan)
    }
    /// Add one immutable successor. No earlier revision is overwritten or removed.
    pub fn append(&mut self, next: &GitLabForkRecord) -> Result<(), AppError> {
        self.append_with_hook(next, || {})
    }
    fn append_with_hook(
        &mut self,
        next: &GitLabForkRecord,
        before_publish: impl FnOnce(),
    ) -> Result<(), AppError> {
        validate_next(&self.record, next)?;
        let _global = self.root.lock()?;
        let scan = self.current()?;
        if scan.committed.len() >= self.root.limits.versions {
            return Err(capacity());
        }
        let journal = GitLabForkJournal {
            root: self.root.clone(),
        };
        let inspection = journal.inspect_locked()?;
        let bytes = serde_json::to_vec(next).map_err(|_| storage())?;
        journal.available(&inspection, bytes.len())?;
        let seal = self
            .row
            .publish_with_hook(&self.root, next, before_publish)?;
        self.record = next.clone();
        self.seal = seal;
        Ok(())
    }
}
#[cfg(test)]
#[path = "gitlab_fork_journal_tests.rs"]
mod tests;
