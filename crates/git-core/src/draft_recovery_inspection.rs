//! Review individual private recovery entries without hiding a valid older copy.
use super::*;
use crate::draft_recovery::{
    RecoveryDraftEntryKind, RecoveryDraftEntryReview, RecoveryDraftInspection, RecoveryDraftIssue,
};
use std::collections::BTreeMap;

fn pending(kind: RecoveryDraftEntryKind) -> bool {
    kind == RecoveryDraftEntryKind::Pending
}
fn entry_name(id: &str, kind: RecoveryDraftEntryKind) -> String {
    format!("{id}.{}", if pending(kind) { "next" } else { "json" })
}
fn review_token(
    id: &str,
    kind: RecoveryDraftEntryKind,
    entry: &RawRecoveryEntry,
) -> Result<String, AppError> {
    let mut hash = gix::hash::hasher(gix::hash::Kind::Sha256);
    hash.update(b"git-khronos-private-draft-entry-v1\0");
    hash.update(id.as_bytes());
    let kind_tag: &[u8] = if pending(kind) {
        b"pending\0"
    } else {
        b"committed\0"
    };
    hash.update(kind_tag);
    for number in [
        entry.metadata.dev(),
        entry.metadata.ino(),
        entry.metadata.len(),
        entry.metadata.nlink(),
    ] {
        hash.update(&number.to_be_bytes());
    }
    for number in [
        entry.metadata.mtime(),
        entry.metadata.mtime_nsec(),
        entry.metadata.ctime(),
        entry.metadata.ctime_nsec(),
    ] {
        hash.update(&number.to_be_bytes());
    }
    for number in [
        entry.metadata.uid(),
        entry.metadata.gid(),
        entry.metadata.mode(),
    ] {
        hash.update(&number.to_be_bytes());
    }
    hash.update(&entry.bytes);
    hash.try_finalize()
        .map(|value| value.to_string())
        .map_err(|_| refused("The recovery entry could not be fingerprinted for review."))
}

impl RecoveryDraftStore {
    /// Reports bounded individual copies and problems, including a valid committed
    /// copy beside a damaged pending replacement. Unknown names are never opened.
    pub fn inspect(&self) -> Result<RecoveryDraftInspection, AppError> {
        self.check_directory()?;
        let mut candidates: BTreeMap<String, BTreeSet<RecoveryDraftEntryKind>> = BTreeMap::new();
        let mut result = RecoveryDraftInspection {
            entries: Vec::new(),
            issues: Vec::new(),
            incomplete: false,
        };
        let mut unknown = false;
        let directory = io(fs::read_dir(format!(
            "/proc/self/fd/{}",
            self.directory.as_raw_fd()
        )))?;
        for (count, entry) in directory.enumerate() {
            if count >= MAX_RECOVERY_DRAFTS * 8 {
                result.issues.push(RecoveryDraftIssue { id: None, message: "Only part of the recovery directory could be inspected within the entry limit. Other data was preserved.".into() });
                break;
            }
            let entry = io(entry)?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                unknown = true;
                continue;
            };
            let candidate = name
                .strip_suffix(".json")
                .map(|id| (id, RecoveryDraftEntryKind::Committed))
                .or_else(|| {
                    name.strip_suffix(".next")
                        .map(|id| (id, RecoveryDraftEntryKind::Pending))
                });
            let Some((id, kind)) = candidate else {
                unknown = true;
                continue;
            };
            if validate_recovery_id(id).is_err() {
                unknown = true;
                continue;
            }
            candidates.entry(id.into()).or_default().insert(kind);
        }
        if unknown {
            result.issues.push(RecoveryDraftIssue {
                id: None,
                message:
                    "Unrecognized recovery-directory entries were preserved without opening them."
                        .into(),
            });
        }
        if candidates.len() > MAX_RECOVERY_DRAFTS {
            result.issues.push(RecoveryDraftIssue { id: None, message: "More recovery drafts exist than can be inspected at once. Other entries were preserved.".into() });
        }
        let mut inspected_bytes = 0u64;
        for (id, kinds) in candidates.into_iter().take(MAX_RECOVERY_DRAFTS) {
            let mut previous: Option<RecoveryDraftRecord> = None;
            for kind in kinds {
                let mut item = RecoveryDraftEntryReview {
                    id: id.clone(),
                    kind,
                    review_token: None,
                    draft: None,
                    error: None,
                };
                match self.read_raw(&id, pending(kind)) {
                    Ok(Some(entry)) => {
                        inspected_bytes += entry.metadata.len();
                        item.review_token = Some(review_token(&id, kind, &entry)?);
                        match parse_entry(&id, &entry.bytes) {
                            Ok(record) => {
                                item.draft = Some(record.summary(pending(kind)));
                                if let Some(old) = previous.as_ref() {
                                    if !same_binding(old, &record)
                                        || old.sequence == record.sequence
                                            && !old.same_contents(&record)
                                    {
                                        result.issues.push(RecoveryDraftIssue { id: Some(id.clone()), message: "These recovery copies disagree. Review each copy before choosing or discarding one.".into() });
                                    }
                                } else {
                                    previous = Some(record);
                                }
                            }
                            Err(error) => item.error = Some(error),
                        }
                    }
                    Ok(None) => {
                        item.error = Some(refused(
                            "The recovery entry disappeared before inspection. Reload the stored copies.",
                        ))
                    }
                    Err(error) => item.error = Some(error),
                }
                result.entries.push(item);
            }
        }
        if inspected_bytes > MAX_RECOVERY_TOTAL_BYTES {
            result.issues.push(RecoveryDraftIssue { id: None, message: "The inspected recovery copies exceed the storage limit. No copies were removed.".into() });
        }
        result.incomplete =
            !result.issues.is_empty() || result.entries.iter().any(|item| item.error.is_some());
        self.check_directory()?;
        Ok(result)
    }

    fn reviewed_entry(
        &self,
        id: &str,
        kind: RecoveryDraftEntryKind,
        expected_token: &str,
    ) -> Result<RawRecoveryEntry, AppError> {
        validate_recovery_id(id)?;
        if expected_token.len() != 64
            || !expected_token
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        {
            return Err(refused(
                "The recovery review token is invalid. Reload the stored copies.",
            ));
        }
        self.check_directory()?;
        let entry = self
            .read_raw(id, pending(kind))?
            .ok_or_else(|| refused("The reviewed recovery entry is no longer present."))?;
        if review_token(id, kind, &entry)? != expected_token
            || identity(&entry.metadata) != identity(&io(entry.file.metadata())?)
        {
            return Err(refused(
                "The recovery entry changed after review. Reload it before continuing.",
            ));
        }
        self.check_directory()?;
        Ok(entry)
    }

    /// Read the exact reviewed copy. Its recorded paths remain data, never file-
    /// write authority. A fresh native editor context is required for restoration.
    pub fn load_reviewed_entry(
        &self,
        id: &str,
        kind: RecoveryDraftEntryKind,
        expected_token: &str,
    ) -> Result<RecoveryDraftRecord, AppError> {
        let entry = self.reviewed_entry(id, kind, expected_token)?;
        parse_entry(id, &entry.bytes)
    }

    /// Delete only the explicitly reviewed private entry, including an incomplete
    /// snapshot. The other copy and unrelated directory entries are preserved.
    pub fn discard_reviewed_entry(
        &mut self,
        id: &str,
        kind: RecoveryDraftEntryKind,
        expected_token: &str,
    ) -> Result<(), AppError> {
        self.discard_reviewed_with_hook(id, kind, expected_token, || {})
    }
    fn discard_reviewed_with_hook(
        &mut self,
        id: &str,
        kind: RecoveryDraftEntryKind,
        expected_token: &str,
        before_unlink: impl FnOnce(),
    ) -> Result<(), AppError> {
        let entry = self.reviewed_entry(id, kind, expected_token)?;
        before_unlink();
        self.check_directory()?;
        let name = entry_name(id, kind);
        let current = io(fs::symlink_metadata(
            PathBuf::from(format!("/proc/self/fd/{}", self.directory.as_raw_fd())).join(&name),
        ))?;
        self.check_file(&current)?;
        if identity(&current) != identity(&entry.metadata)
            || identity(&entry.metadata) != identity(&io(entry.file.metadata())?)
        {
            return Err(refused(
                "The reviewed recovery entry was replaced. It was preserved.",
            ));
        }
        syscall(unlinkat(&self.directory, name.as_str(), AtFlags::empty()))?;
        io(self.directory.sync_all())?;
        self.check_directory()
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{OwnedDirectory, draft};
    use super::*;
    use std::os::unix::fs::symlink;

    fn item(
        report: &RecoveryDraftInspection,
        kind: RecoveryDraftEntryKind,
    ) -> &RecoveryDraftEntryReview {
        report
            .entries
            .iter()
            .find(|entry| entry.kind == kind)
            .unwrap()
    }
    #[test]
    fn inspection_recovers_committed_text_beside_corrupt_pending_and_unknown_data() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let record = draft();
        store.persist(&record).unwrap();
        let committed = dir.path().join(format!("{}.json", record.id));
        let original = fs::read(&committed).unwrap();
        let pending_path = dir.path().join(format!("{}.next", record.id));
        dir.put(&record, "next");
        fs::write(&pending_path, b"{interrupted").unwrap();
        let unknown = dir.path().join("do-not-open-or-remove");
        fs::write(&unknown, b"retained unknown data").unwrap();
        let report = store.inspect().unwrap();
        assert!(report.incomplete);
        assert_eq!(report.entries.len(), 2);
        assert!(report.issues.iter().any(|issue| issue.id.is_none()));
        let complete = item(&report, RecoveryDraftEntryKind::Committed);
        assert!(complete.error.is_none());
        assert_eq!(complete.draft.as_ref().unwrap().sequence, 1);
        assert_eq!(
            store
                .load_reviewed_entry(
                    &record.id,
                    complete.kind,
                    complete.review_token.as_ref().unwrap()
                )
                .unwrap(),
            record
        );
        let pending = item(&report, RecoveryDraftEntryKind::Pending);
        assert!(pending.error.is_some() && pending.draft.is_none());
        assert!(
            store
                .load_reviewed_entry(
                    &record.id,
                    pending.kind,
                    pending.review_token.as_ref().unwrap()
                )
                .is_err()
        );
        assert_eq!(fs::read(&pending_path).unwrap(), b"{interrupted");
        assert_eq!(fs::read(&committed).unwrap(), original);
        store
            .discard_reviewed_entry(
                &record.id,
                pending.kind,
                pending.review_token.as_ref().unwrap(),
            )
            .unwrap();
        assert!(!pending_path.exists());
        assert_eq!(fs::read(&committed).unwrap(), original);
        assert_eq!(fs::read(unknown).unwrap(), b"retained unknown data");
    }
    #[test]
    fn reviewed_load_and_discard_refuse_new_content_and_identical_bytes_on_a_foreign_inode() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let mut record = draft();
        store.persist(&record).unwrap();
        let report = store.inspect().unwrap();
        let old = item(&report, RecoveryDraftEntryKind::Committed);
        let token = old.review_token.as_ref().unwrap();
        record.sequence = 2;
        record.text = "newer user text".into();
        store.persist(&record).unwrap();
        assert!(
            store
                .load_reviewed_entry(&record.id, old.kind, token)
                .is_err()
        );
        assert!(
            store
                .discard_reviewed_entry(&record.id, old.kind, token)
                .is_err()
        );
        let report = store.inspect().unwrap();
        let reviewed = item(&report, old.kind);
        let canonical = dir.path().join(format!("{}.json", record.id));
        fs::rename(&canonical, dir.0.join("displaced-private-copy")).unwrap();
        dir.put(&record, "json");
        assert!(
            store
                .discard_reviewed_entry(
                    &record.id,
                    old.kind,
                    reviewed.review_token.as_ref().unwrap()
                )
                .is_err()
        );
        assert_eq!(store.load(&record.id).unwrap().unwrap().0, record);
        let report = store.inspect().unwrap();
        let latest = item(&report, old.kind);
        store
            .discard_reviewed_entry(&record.id, old.kind, latest.review_token.as_ref().unwrap())
            .unwrap();
        assert!(!canonical.exists());
        assert!(dir.0.join("displaced-private-copy").exists());
    }
    #[test]
    fn discard_preserves_an_observed_foreign_replacement_after_token_verification() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let record = draft();
        store.persist(&record).unwrap();
        let report = store.inspect().unwrap();
        let entry = item(&report, RecoveryDraftEntryKind::Committed);
        let canonical = dir.path().join(format!("{}.json", record.id));
        let displaced = dir.0.join("reviewed-owned-copy");
        assert!(
            store
                .discard_reviewed_with_hook(
                    &record.id,
                    entry.kind,
                    entry.review_token.as_ref().unwrap(),
                    || {
                        fs::rename(&canonical, &displaced).unwrap();
                        dir.put(&record, "json");
                    }
                )
                .is_err()
        );
        assert_eq!(
            parse_entry(&record.id, &fs::read(&canonical).unwrap()).unwrap(),
            record
        );
        assert_eq!(
            parse_entry(&record.id, &fs::read(&displaced).unwrap()).unwrap(),
            record
        );
    }

    #[test]
    fn inspection_refuses_links_and_fifo_without_reading_the_external_target_or_blocking() {
        for hard in [false, true] {
            let dir = OwnedDirectory::new();
            let mut store = dir.open();
            let record = draft();
            store.persist(&record).unwrap();
            let canonical = dir.path().join(format!("{}.json", record.id));
            let outside = dir.0.join("outside");
            fs::rename(&canonical, &outside).unwrap();
            let before = fs::read(&outside).unwrap();
            if hard {
                fs::hard_link(&outside, &canonical).unwrap();
            } else {
                symlink(&outside, &canonical).unwrap();
            }
            let report = store.inspect().unwrap();
            let entry = item(&report, RecoveryDraftEntryKind::Committed);
            assert!(report.incomplete && entry.review_token.is_none() && entry.error.is_some());
            assert!(
                store
                    .discard_reviewed_entry(&record.id, entry.kind, &"a".repeat(64))
                    .is_err()
            );
            assert_eq!(fs::read(&outside).unwrap(), before);
            assert!(fs::symlink_metadata(&canonical).is_ok());
        }
        let dir = OwnedDirectory::new();
        let store = dir.open();
        let id = "a".repeat(32);
        rustix::fs::mkfifoat(
            rustix::fs::CWD,
            dir.path().join(format!("{id}.json")),
            Mode::RUSR | Mode::WUSR,
        )
        .unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            send.send(store.inspect()).unwrap();
        });
        let report = receive
            .recv_timeout(std::time::Duration::from_secs(3))
            .expect("inspection blocked on an owned FIFO")
            .unwrap();
        worker.join().unwrap();
        let entry = item(&report, RecoveryDraftEntryKind::Committed);
        assert!(entry.error.is_some() && entry.review_token.is_none());
        assert!(fs::symlink_metadata(dir.path().join(format!("{id}.json"))).is_ok());
    }
    #[test]
    fn conflicting_copies_are_both_reviewable_and_only_the_confirmed_copy_is_discarded() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let record = draft();
        store.persist(&record).unwrap();
        let mut other = record.clone();
        other.path = "another-file.txt".into();
        other.text = "other retained text".into();
        dir.put(&other, "next");
        assert!(store.load(&record.id).is_err());
        let report = store.inspect().unwrap();
        assert!(
            report.incomplete
                && report
                    .issues
                    .iter()
                    .any(|issue| issue.id.as_deref() == Some(record.id.as_str()))
        );
        let committed = item(&report, RecoveryDraftEntryKind::Committed);
        let pending = item(&report, RecoveryDraftEntryKind::Pending);
        assert_eq!(
            store
                .load_reviewed_entry(
                    &record.id,
                    committed.kind,
                    committed.review_token.as_ref().unwrap()
                )
                .unwrap(),
            record
        );
        assert_eq!(
            store
                .load_reviewed_entry(
                    &other.id,
                    pending.kind,
                    pending.review_token.as_ref().unwrap()
                )
                .unwrap(),
            other
        );
        assert!(
            store
                .discard_reviewed_entry(
                    &record.id,
                    pending.kind,
                    committed.review_token.as_ref().unwrap()
                )
                .is_err()
        );
        store
            .discard_reviewed_entry(
                &record.id,
                pending.kind,
                pending.review_token.as_ref().unwrap(),
            )
            .unwrap();
        assert_eq!(store.load(&record.id).unwrap(), Some((record, false)));
    }
    #[test]
    fn inspection_bounds_extra_entries_without_claiming_an_empty_complete_store() {
        let dir = OwnedDirectory::new();
        let store = dir.open();
        let mut record = draft();
        for index in 0..MAX_RECOVERY_DRAFTS + 1 {
            record.id = format!("{index:032x}");
            dir.put(&record, "json");
        }
        let report = store.inspect().unwrap();
        assert!(report.incomplete);
        assert_eq!(report.entries.len(), MAX_RECOVERY_DRAFTS);
        assert!(!report.issues.is_empty());
        for index in 0..MAX_RECOVERY_DRAFTS * 8 {
            fs::write(dir.path().join(format!("unknown-{index}")), b"preserve").unwrap();
        }
        let report = store.inspect().unwrap();
        assert!(report.incomplete);
        assert!(!report.issues.is_empty());
        assert_eq!(
            fs::read_dir(dir.path()).unwrap().count(),
            MAX_RECOVERY_DRAFTS + 1 + MAX_RECOVERY_DRAFTS * 8
        );
    }
    #[test]
    fn oversized_entry_remains_untouched_while_its_valid_other_copy_can_be_reviewed() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let record = draft();
        store.persist(&record).unwrap();
        dir.put(&record, "next");
        let path = dir.path().join(format!("{}.next", record.id));
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_RECOVERY_RECORD_BYTES as u64 + 1)
            .unwrap();
        let report = store.inspect().unwrap();
        let pending = item(&report, RecoveryDraftEntryKind::Pending);
        assert!(report.incomplete && pending.review_token.is_none() && pending.error.is_some());
        let committed = item(&report, RecoveryDraftEntryKind::Committed);
        assert_eq!(
            store
                .load_reviewed_entry(
                    &record.id,
                    committed.kind,
                    committed.review_token.as_ref().unwrap()
                )
                .unwrap(),
            record
        );
        assert_eq!(
            fs::metadata(path).unwrap().len(),
            MAX_RECOVERY_RECORD_BYTES as u64 + 1
        );
    }
}
