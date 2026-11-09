//! Private Linux draft storage. Stored paths never authorize working-file writes.
use crate::AppError;
use crate::draft_recovery::{
    MAX_RECOVERY_DRAFTS, MAX_RECOVERY_RECORD_BYTES, MAX_RECOVERY_TOTAL_BYTES, RecoveryDraftRecord,
    RecoveryDraftSummary, validate_recovery_id,
};
use rustix::fs::{AtFlags, FlockOperation, Mode, OFlags, flock, openat, renameat, unlinkat};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};

fn refused(message: &str) -> AppError {
    AppError::new(
        "draftRecoveryUnavailable",
        message,
        Some("Working files were not changed. Review retained recovery entries before retrying."),
    )
}
fn io<T>(result: std::io::Result<T>) -> Result<T, AppError> {
    result.map_err(|_| refused("The private draft store could not be accessed safely."))
}
fn syscall<T>(result: Result<T, rustix::io::Errno>) -> Result<T, AppError> {
    result.map_err(|_| refused("The private draft store operation could not be confirmed."))
}
fn identity(m: &fs::Metadata) -> (u64, u64, u64, i64, i64, i64, i64) {
    (
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec(),
    )
}

#[path = "draft_recovery_inspection.rs"]
mod inspection;

struct RawRecoveryEntry {
    file: File,
    metadata: fs::Metadata,
    bytes: Vec<u8>,
}
fn parse_entry(id: &str, bytes: &[u8]) -> Result<RecoveryDraftRecord, AppError> {
    let record: RecoveryDraftRecord = serde_json::from_slice(bytes).map_err(|_| {
        refused("A recovery entry is incomplete or has an unsupported format. It was preserved.")
    })?;
    record.validate()?;
    if record.id != id {
        return Err(refused(
            "A recovery entry does not match its stored identifier.",
        ));
    }
    Ok(record)
}

fn same_binding(a: &RecoveryDraftRecord, b: &RecoveryDraftRecord) -> bool {
    a.id == b.id
        && a.repository_path == b.repository_path
        && a.path == b.path
        && a.encoding == b.encoding
        && a.baseline_sha256 == b.baseline_sha256
        && a.git_context == b.git_context
}

pub struct RecoveryDraftStore {
    directory: File,
    path: PathBuf,
    uid: u32,
}
impl Drop for RecoveryDraftStore {
    fn drop(&mut self) {
        let _ = flock(&self.directory, FlockOperation::Unlock);
    }
}
impl RecoveryDraftStore {
    /// `path` must be a native-selected application-data location, never an IPC
    /// supplied working path. The caller supplies its effective operating UID.
    pub fn open(path: &Path, uid: u32) -> Result<Self, AppError> {
        if !path.is_absolute() {
            return Err(refused(
                "A private absolute draft-store location is required.",
            ));
        }
        match fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(_) => return Err(refused("The private draft directory could not be created.")),
        }
        let directory = File::from(syscall(openat(
            rustix::fs::CWD,
            path,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ))?);
        let store = Self {
            directory,
            path: path.to_owned(),
            uid,
        };
        store.check_directory()?;
        syscall(flock(
            &store.directory,
            FlockOperation::NonBlockingLockExclusive,
        ))?;
        Ok(store)
    }
    fn check_directory(&self) -> Result<(), AppError> {
        let fd = io(self.directory.metadata())?;
        let path = io(fs::symlink_metadata(&self.path))?;
        if !fd.is_dir()
            || !path.is_dir()
            || path.file_type().is_symlink()
            || fd.uid() != self.uid
            || fd.mode() & 0o077 != 0
            || (fd.dev(), fd.ino()) != (path.dev(), path.ino())
        {
            return Err(refused(
                "The draft directory has changed or is not private to this user.",
            ));
        }
        Ok(())
    }
    fn check_file(&self, m: &fs::Metadata) -> Result<(), AppError> {
        if !m.is_file()
            || m.uid() != self.uid
            || m.mode() & 0o777 != 0o600
            || m.nlink() != 1
            || m.len() > MAX_RECOVERY_RECORD_BYTES as u64
        {
            return Err(refused(
                "A recovery entry is not a bounded, private regular file.",
            ));
        }
        Ok(())
    }
    fn read(&self, id: &str, pending: bool) -> Result<Option<RecoveryDraftRecord>, AppError> {
        self.read_raw(id, pending)?
            .map(|entry| parse_entry(id, &entry.bytes))
            .transpose()
    }
    fn read_raw(&self, id: &str, pending: bool) -> Result<Option<RawRecoveryEntry>, AppError> {
        validate_recovery_id(id)?;
        let name = format!("{id}.{}", if pending { "next" } else { "json" });
        let fd = match openat(
            &self.directory,
            name.as_str(),
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(fd) => fd,
            Err(rustix::io::Errno::NOENT) => return Ok(None),
            Err(_) => return Err(refused("A recovery entry could not be opened safely.")),
        };
        let mut file = File::from(fd);
        let before = io(file.metadata())?;
        self.check_file(&before)?;
        let mut bytes = Vec::new();
        io((&mut file)
            .take(MAX_RECOVERY_RECORD_BYTES as u64 + 1)
            .read_to_end(&mut bytes))?;
        if bytes.len() > MAX_RECOVERY_RECORD_BYTES
            || identity(&before) != identity(&io(file.metadata())?)
        {
            return Err(refused("A recovery entry changed while being read."));
        }
        Ok(Some(RawRecoveryEntry {
            file,
            metadata: before,
            bytes,
        }))
    }
    fn entries(&self) -> Result<(BTreeSet<String>, u64), AppError> {
        self.check_directory()?;
        // Enumerate the opened directory rather than following a replaced path.
        let mut ids = BTreeSet::new();
        let mut bytes = 0u64;
        let mut count = 0usize;
        for entry in io(fs::read_dir(format!(
            "/proc/self/fd/{}",
            self.directory.as_raw_fd()
        )))? {
            let entry = io(entry)?;
            count += 1;
            if count > MAX_RECOVERY_DRAFTS * 2 {
                return Err(refused(
                    "The draft store contains too many entries. Nothing was removed.",
                ));
            }
            let name = entry.file_name();
            let name = name
                .to_str()
                .ok_or_else(|| refused("An unknown draft-store entry was preserved."))?;
            let id = name
                .strip_suffix(".json")
                .or_else(|| name.strip_suffix(".next"))
                .ok_or_else(|| refused("An unknown draft-store entry was preserved."))?;
            validate_recovery_id(id)?;
            let m = io(fs::symlink_metadata(entry.path()))?;
            self.check_file(&m)?;
            bytes = bytes
                .checked_add(m.len())
                .ok_or_else(|| refused("The draft storage size is invalid."))?;
            if bytes > MAX_RECOVERY_TOTAL_BYTES {
                return Err(refused(
                    "The draft store exceeds its size limit. Nothing was removed.",
                ));
            }
            ids.insert(id.to_owned());
        }
        if ids.len() > MAX_RECOVERY_DRAFTS {
            return Err(refused(
                "The draft count exceeds its limit. Nothing was removed.",
            ));
        }
        self.check_directory()?;
        Ok((ids, bytes))
    }
    pub fn load(&self, id: &str) -> Result<Option<(RecoveryDraftRecord, bool)>, AppError> {
        validate_recovery_id(id)?;
        self.check_directory()?;
        let committed = self.read(id, false)?;
        let pending = self.read(id, true)?;
        let result = match (committed, pending) {
            (Some(a), Some(b)) => {
                if !same_binding(&a, &b) {
                    return Err(refused(
                        "Recovery entries have different file bindings. Both were preserved.",
                    ));
                }
                if a.sequence == b.sequence && !a.same_contents(&b) {
                    return Err(refused(
                        "Recovery entries disagree at the same sequence. Both were preserved.",
                    ));
                }
                if b.sequence > a.sequence {
                    Some((b, true))
                } else {
                    Some((a, false))
                }
            }
            (Some(a), None) => Some((a, false)),
            (None, Some(b)) => Some((b, true)),
            (None, None) => None,
        };
        self.check_directory()?;
        Ok(result)
    }
    pub fn list(&self) -> Result<Vec<RecoveryDraftSummary>, AppError> {
        let (ids, _) = self.entries()?;
        let mut result = Vec::new();
        for id in ids {
            if let Some((record, pending)) = self.load(&id)? {
                result.push(record.summary(pending));
            }
        }
        result.sort_by(|a, b| {
            b.updated_at_millis
                .parse::<u64>()
                .unwrap_or_default()
                .cmp(&a.updated_at_millis.parse::<u64>().unwrap_or_default())
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(result)
    }
    /// Each call replaces recovery data only. It never opens a recorded path.
    pub fn persist(&mut self, record: &RecoveryDraftRecord) -> Result<(), AppError> {
        self.persist_with_hook(record, || {})
    }
    fn persist_with_hook(
        &mut self,
        record: &RecoveryDraftRecord,
        before_commit: impl FnOnce(),
    ) -> Result<(), AppError> {
        record.validate()?;
        let (ids, total) = self.entries()?;
        if self.read(&record.id, true)?.is_some() {
            return Err(refused(
                "An unfinished recovery snapshot needs review before replacement.",
            ));
        }
        let original = self.read(&record.id, false)?;
        if let Some(old) = original.as_ref() {
            if old.sequence == record.sequence && old.same_contents(record) {
                return Ok(());
            }
            if old.sequence >= record.sequence {
                return Err(refused(
                    "An older or conflicting recovery snapshot was refused.",
                ));
            }
            if !same_binding(old, record) {
                return Err(refused(
                    "The draft's original file binding changed. Its recovery data was preserved.",
                ));
            }
        } else if ids.len() >= MAX_RECOVERY_DRAFTS {
            return Err(refused("The draft count limit has been reached."));
        }
        let bytes = serde_json::to_vec(record)
            .map_err(|_| refused("The draft could not be encoded for recovery."))?;
        if bytes.len() > MAX_RECOVERY_RECORD_BYTES
            || total + bytes.len() as u64 > MAX_RECOVERY_TOTAL_BYTES
        {
            return Err(refused(
                "The recovery snapshot would exceed the storage limit.",
            ));
        }
        let pending = format!("{}.next", record.id);
        let committed = format!("{}.json", record.id);
        self.check_directory()?;
        let mut file = File::from(syscall(openat(
            &self.directory,
            pending.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        ))?);
        // A failed or killed write intentionally leaves .next for review. The
        // previous .json survives until the new complete record has been synced.
        io(file.write_all(&bytes))?;
        io(file.sync_all())?;
        before_commit();
        let owned = io(file.metadata())?;
        self.check_file(&owned)?;
        let pending_metadata = io(fs::symlink_metadata(
            PathBuf::from(format!("/proc/self/fd/{}", self.directory.as_raw_fd())).join(&pending),
        ))?;
        if !pending_metadata.is_file() || identity(&owned) != identity(&pending_metadata) {
            return Err(refused(
                "The pending recovery entry was replaced. It was preserved.",
            ));
        }
        if self.read(&record.id, false)? != original {
            return Err(refused(
                "The committed recovery entry changed before replacement. Both entries were preserved.",
            ));
        }
        if self.read(&record.id, true)?.as_ref() != Some(record) {
            return Err(refused(
                "The pending recovery snapshot changed before commit.",
            ));
        }
        self.check_directory()?;
        syscall(renameat(
            &self.directory,
            pending.as_str(),
            &self.directory,
            committed.as_str(),
        ))?;
        io(self.directory.sync_all())?;
        self.check_directory()
    }
    /// Explicit user discard requires the latest observed sequence, so a stale
    /// review cannot erase a newer snapshot.
    pub fn discard(&mut self, id: &str, expected_sequence: u32) -> Result<(), AppError> {
        let Some((record, _)) = self.load(id)? else {
            return Ok(());
        };
        if record.sequence != expected_sequence {
            return Err(refused(
                "The recovery draft changed after review. Reload it before discarding.",
            ));
        }
        self.entries()?;
        for suffix in ["next", "json"] {
            let name = format!("{id}.{suffix}");
            match unlinkat(&self.directory, name.as_str(), AtFlags::empty()) {
                Ok(()) | Err(rustix::io::Errno::NOENT) => (),
                Err(_) => {
                    return Err(refused(
                        "Recovery cleanup was not fully confirmed. Review the retained entries.",
                    ));
                }
            }
        }
        io(self.directory.sync_all())?;
        self.check_directory()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WorkingTextEncoding;
    use crate::draft_recovery::recovery_text_sha256;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    pub(super) struct OwnedDirectory(pub(super) PathBuf);
    impl OwnedDirectory {
        pub(super) fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "git-khronos-draft-store-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        pub(super) fn path(&self) -> PathBuf {
            self.0.join("drafts")
        }
        pub(super) fn uid(&self) -> u32 {
            fs::metadata(&self.0).unwrap().uid()
        }
        pub(super) fn open(&self) -> RecoveryDraftStore {
            RecoveryDraftStore::open(&self.path(), self.uid()).unwrap()
        }
        pub(super) fn put(&self, record: &RecoveryDraftRecord, suffix: &str) {
            let path = self.path().join(format!("{}.{suffix}", record.id));
            fs::write(&path, serde_json::to_vec(record).unwrap()).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }
    impl Drop for OwnedDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    pub(super) fn draft() -> RecoveryDraftRecord {
        RecoveryDraftRecord {
            version: 1,
            id: "a".repeat(32),
            repository_path: "/not-opened/repository".into(),
            path: "literal [file].txt".into(),
            encoding: WorkingTextEncoding::Utf8,
            baseline_sha256: recovery_text_sha256("base\n").unwrap(),
            git_context: None,
            revision: "b".repeat(32),
            sequence: 1,
            text: "unsaved é\n".into(),
            updated_at_millis: "1793510000000".into(),
        }
    }
    #[test]
    fn recovery_store_restarts_without_opening_recorded_paths_and_discards_only_reviewed_sequence()
    {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let mut record = draft();
        store.persist(&record).unwrap();
        store.persist(&record).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(
            store.load(&record.id).unwrap(),
            Some((record.clone(), false))
        );
        record.sequence += 1;
        record.text.push('x');
        store.persist(&record).unwrap();
        assert!(store.discard(&record.id, 1).is_err());
        drop(store);
        let mut reopened = dir.open();
        assert_eq!(
            reopened.load(&record.id).unwrap(),
            Some((record.clone(), false))
        );
        reopened.discard(&record.id, 2).unwrap();
        assert!(reopened.list().unwrap().is_empty());
    }
    #[test]
    fn recovery_store_refuses_competing_writers_changed_bindings_and_out_of_order_snapshots() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        assert!(RecoveryDraftStore::open(&dir.path(), dir.uid()).is_err());
        assert!(RecoveryDraftStore::open(&dir.path(), dir.uid()).is_err());
        let record = draft();
        store.persist(&record).unwrap();
        let mut changed = record.clone();
        changed.text.push('x');
        assert!(store.persist(&changed).is_err());
        changed.sequence = 2;
        changed.path = "another.txt".into();
        assert!(store.persist(&changed).is_err());
        assert_eq!(store.load(&record.id).unwrap(), Some((record, false)));
        drop(store);
        assert!(RecoveryDraftStore::open(&dir.path(), dir.uid()).is_ok());
    }
    #[test]
    fn recovery_store_releases_its_lock_even_if_the_directory_descriptor_is_duplicated() {
        let dir = OwnedDirectory::new();
        let store = dir.open();
        let inherited_directory = store.directory.try_clone().unwrap();
        drop(store);

        assert!(RecoveryDraftStore::open(&dir.path(), dir.uid()).is_ok());
        drop(inherited_directory);
    }
    #[test]
    fn recovery_store_retains_complete_pending_snapshot_after_interrupted_replacement() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let mut record = draft();
        store.persist(&record).unwrap();
        let old = fs::read(dir.path().join(format!("{}.json", record.id))).unwrap();
        record.sequence = 2;
        record.text = "latest interrupted snapshot\n".into();
        dir.put(&record, "next");
        drop(store);
        let mut reopened = dir.open();
        assert_eq!(
            reopened.load(&record.id).unwrap(),
            Some((record.clone(), true))
        );
        assert!(reopened.list().unwrap()[0].pending);
        assert!(reopened.persist(&record).is_err());
        assert_eq!(
            fs::read(dir.path().join(format!("{}.json", record.id))).unwrap(),
            old
        );
        reopened.discard(&record.id, 2).unwrap();
        assert!(reopened.list().unwrap().is_empty());
    }
    #[test]
    fn recovery_store_preserves_incomplete_unknown_and_conflicting_entries() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let record = draft();
        store.persist(&record).unwrap();
        let pending = dir.path().join(format!("{}.next", record.id));
        fs::write(&pending, b"{incomplete").unwrap();
        fs::set_permissions(&pending, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(store.load(&record.id).is_err());
        assert!(store.discard(&record.id, 1).is_err());
        assert_eq!(fs::read(&pending).unwrap(), b"{incomplete");
        fs::remove_file(&pending).unwrap();
        let mut conflicting = record.clone();
        conflicting.text.push('x');
        dir.put(&conflicting, "next");
        assert!(store.load(&record.id).is_err());
        fs::remove_file(&pending).unwrap();
        conflicting.sequence = 2;
        conflicting.path = "different-file.txt".into();
        dir.put(&conflicting, "next");
        assert!(store.load(&record.id).is_err());
        fs::remove_file(&pending).unwrap();
        let unknown = dir.path().join("unrecognized-data");
        fs::write(&unknown, b"preserve").unwrap();
        assert!(store.list().is_err());
        assert_eq!(fs::read(unknown).unwrap(), b"preserve");
    }
    #[test]
    fn recovery_store_refuses_symlinks_hardlinks_shared_directory_and_directory_replacement() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let record = draft();
        store.persist(&record).unwrap();
        let canonical = dir.path().join(format!("{}.json", record.id));
        let external = dir.0.join("outside");
        fs::rename(&canonical, &external).unwrap();
        symlink(&external, &canonical).unwrap();
        assert!(store.load(&record.id).is_err());
        fs::remove_file(&canonical).unwrap();
        fs::hard_link(&external, &canonical).unwrap();
        assert!(store.load(&record.id).is_err());
        fs::remove_file(&canonical).unwrap();
        let before = fs::read(&external).unwrap();
        let moved = dir.0.join("moved-private");
        fs::rename(dir.path(), &moved).unwrap();
        fs::create_dir(dir.path()).unwrap();
        assert!(store.persist(&record).is_err());
        assert_eq!(fs::read(&external).unwrap(), before);
        drop(store);
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o777)).unwrap();
        assert!(RecoveryDraftStore::open(&dir.path(), dir.uid()).is_err());
        fs::remove_dir(dir.path()).unwrap();
        symlink(&moved, dir.path()).unwrap();
        assert!(RecoveryDraftStore::open(&dir.path(), dir.uid()).is_err());
    }
    #[test]
    fn recovery_store_preserves_observed_foreign_pending_and_changed_committed_entries() {
        for replace_pending in [true, false] {
            let dir = OwnedDirectory::new();
            let mut store = dir.open();
            let mut record = draft();
            store.persist(&record).unwrap();
            record.sequence = 2;
            record.text = "new private snapshot".into();
            let pending = dir.path().join(format!("{}.next", record.id));
            let canonical = dir.path().join(format!("{}.json", record.id));
            let mut foreign = record.clone();
            if !replace_pending {
                foreign.sequence = 50;
                foreign.text = "externally changed recovery".into();
            }
            assert!(
                store
                    .persist_with_hook(&record, || {
                        if replace_pending {
                            fs::rename(&pending, dir.0.join("displaced-owned-pending")).unwrap();
                            dir.put(&foreign, "next");
                        } else {
                            dir.put(&foreign, "json");
                        }
                    })
                    .is_err()
            );
            let preserved = if replace_pending {
                &pending
            } else {
                &canonical
            };
            let actual: RecoveryDraftRecord =
                serde_json::from_slice(&fs::read(preserved).unwrap()).unwrap();
            assert_eq!(actual, foreign);
        }
    }

    #[test]
    fn recovery_store_bounds_json_expansion_and_total_disk_bytes_without_eviction() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let mut record = draft();
        record.text = "\u{0001}".repeat(crate::draft_recovery::MAX_RECOVERY_TEXT_BYTES);
        assert!(store.persist(&record).is_err());
        assert!(store.list().unwrap().is_empty());
        record.text = "\t".repeat(2 * 1024 * 1024);
        for index in 0..7 {
            record.id = format!("{index:032x}");
            store.persist(&record).unwrap();
        }
        record.id = "f".repeat(32);
        assert!(store.persist(&record).is_err());
        assert_eq!(store.list().unwrap().len(), 7);
    }

    #[test]
    fn recovery_store_rejects_ninth_draft_and_oversized_snapshot_without_evicting_records() {
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let mut record = draft();
        for index in 0..MAX_RECOVERY_DRAFTS {
            record.id = format!("{index:032x}");
            store.persist(&record).unwrap();
        }
        record.id = "f".repeat(32);
        assert!(store.persist(&record).is_err());
        assert_eq!(store.list().unwrap().len(), MAX_RECOVERY_DRAFTS);
        record.id = format!("{:032x}", 0);
        record.sequence = 2;
        record.text = "x".repeat(crate::draft_recovery::MAX_RECOVERY_TEXT_BYTES + 1);
        assert!(store.persist(&record).is_err());
        assert_eq!(store.load(&record.id).unwrap().unwrap().0.sequence, 1);
    }
    #[test]
    fn recovery_store_preserves_original_git_context_and_reviews_conflicting_copies() {
        use crate::draft_recovery::RecoveryDraftGitContext;
        let dir = OwnedDirectory::new();
        let mut store = dir.open();
        let mut original = draft();
        original.git_context = Some(RecoveryDraftGitContext {
            working_reference: Some("refs/heads/dev".into()),
            head_oid: Some("a".repeat(40)),
        });
        store.persist(&original).unwrap();
        let mut changed = original.clone();
        changed.sequence += 1;
        changed.git_context.as_mut().unwrap().working_reference = Some("refs/heads/other".into());
        assert!(store.persist(&changed).is_err());
        let mut changed_head = original.clone();
        changed_head.sequence += 1;
        changed_head.git_context.as_mut().unwrap().head_oid = Some("b".repeat(40));
        assert!(store.persist(&changed_head).is_err());
        let mut unknown = original.clone();
        unknown.sequence += 1;
        unknown.git_context = None;
        assert!(store.persist(&unknown).is_err());
        assert_eq!(
            store.load(&original.id).unwrap(),
            Some((original.clone(), false))
        );
        dir.put(&changed, "next");
        assert!(store.load(&original.id).is_err());
        let inspection = store.inspect().unwrap();
        assert!(inspection.incomplete);
        assert_eq!(inspection.entries.len(), 2);
        for entry in inspection.entries {
            let loaded = store
                .load_reviewed_entry(
                    &entry.id,
                    entry.kind,
                    entry.review_token.as_deref().unwrap(),
                )
                .unwrap();
            let expected = match entry.kind {
                crate::draft_recovery::RecoveryDraftEntryKind::Committed => &original,
                crate::draft_recovery::RecoveryDraftEntryKind::Pending => &changed,
            };
            assert_eq!(&loaded, expected);
            assert_eq!(entry.draft.unwrap().git_context, expected.git_context);
        }
    }
}
