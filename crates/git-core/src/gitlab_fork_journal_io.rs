//! Linux descriptor-relative storage for immutable fork outcome revisions.
use super::{
    GitLabForkJournalEntry, Limits, busy, capacity, initial, revision, storage, valid_id,
    validate_next,
};
use crate::{AppError, GitLabForkRecord};
use rustix::fs::{
    FlockOperation, Mode, OFlags, RenameFlags, flock, mkdirat, openat, renameat_with,
};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

pub(super) fn io<T>(value: std::io::Result<T>) -> Result<T, AppError> {
    value.map_err(|_| storage())
}
fn system<T>(value: Result<T, rustix::io::Errno>) -> Result<T, AppError> {
    value.map_err(|_| storage())
}
fn fd_path(file: &File) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()))
}
fn private_dir(file: &File, uid: u32, exact: bool) -> Result<(), AppError> {
    let m = io(file.metadata())?;
    if !m.is_dir()
        || m.uid() != uid
        || (exact && m.mode() & 0o7777 != 0o700)
        || (!exact && m.mode() & 0o022 != 0)
    {
        return Err(storage());
    }
    Ok(())
}
fn private_file(m: &fs::Metadata, uid: u32, limit: usize) -> Result<(), AppError> {
    if !m.is_file()
        || m.uid() != uid
        || m.mode() & 0o7777 != 0o600
        || m.nlink() != 1
        || m.len() > limit as u64
    {
        return Err(storage());
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Fingerprint(u64, u64, u64, i64, i64, i64, i64);
fn fingerprint(m: &fs::Metadata) -> Fingerprint {
    Fingerprint(
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec(),
    )
}
fn same_directory(file: &File, path: &Path) -> Result<(), AppError> {
    let a = io(file.metadata())?;
    let b = io(fs::symlink_metadata(path))?;
    if !b.is_dir() || b.file_type().is_symlink() || (a.dev(), a.ino()) != (b.dev(), b.ino()) {
        return Err(storage());
    }
    Ok(())
}
pub(super) struct Lock {
    file: File,
}
impl Lock {
    fn acquire(file: File) -> Result<Self, AppError> {
        match flock(&file, FlockOperation::NonBlockingLockExclusive) {
            Ok(()) => Ok(Self { file }),
            Err(error) if error == rustix::io::Errno::WOULDBLOCK => Err(busy()),
            Err(_) => Err(storage()),
        }
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = flock(&self.file, FlockOperation::Unlock);
    }
}
pub(super) struct Root {
    pub path: PathBuf,
    pub file: File,
    parent: File,
    parent_path: PathBuf,
    name: OsString,
    pub uid: u32,
    pub limits: Limits,
}
impl Root {
    pub fn open(path: &Path, uid: u32, limits: Limits) -> Result<Self, AppError> {
        if !path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, Component::CurDir | Component::ParentDir))
        {
            return Err(storage());
        }
        let parent_path = path.parent().ok_or_else(storage)?.to_owned();
        let name = path.file_name().ok_or_else(storage)?.to_owned();
        let parent = File::from(system(openat(
            rustix::fs::CWD,
            parent_path.as_path(),
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ))?);
        private_dir(&parent, uid, false)?;
        match mkdirat(&parent, name.as_os_str(), Mode::RWXU) {
            Ok(()) => (),
            Err(error) if error == rustix::io::Errno::EXIST => (),
            Err(_) => return Err(storage()),
        }
        let file = File::from(system(openat(
            &parent,
            name.as_os_str(),
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ))?);
        let root = Self {
            path: path.into(),
            file,
            parent,
            parent_path,
            name,
            uid,
            limits,
        };
        root.check()?;
        Ok(root)
    }
    pub fn check(&self) -> Result<(), AppError> {
        private_dir(&self.parent, self.uid, false)?;
        same_directory(&self.parent, &self.parent_path)?;
        private_dir(&self.file, self.uid, true)?;
        same_directory(&self.file, &fd_path(&self.parent).join(&self.name))?;
        same_directory(&self.file, &self.path)
    }
    pub fn lock(&self) -> Result<Lock, AppError> {
        self.check()?;
        let file = File::from(system(openat(
            &self.file,
            ".",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ))?);
        Lock::acquire(file)
    }
    pub fn names(&self) -> Result<(Vec<String>, bool), AppError> {
        self.check()?;
        let mut names = Vec::new();
        let mut unknown = false;
        for (index, entry) in io(fs::read_dir(fd_path(&self.file)))?.enumerate() {
            if index >= self.limits.records {
                unknown = true;
                break;
            }
            let entry = io(entry)?;
            let name = entry.file_name();
            if let Some(id) = name.to_str().filter(|id| valid_id(id)) {
                names.push(id.to_owned());
            } else {
                unknown = true;
            }
        }
        names.sort();
        self.check()?;
        Ok((names, unknown))
    }
    pub fn row(&self, id: &str) -> Result<Option<Row>, AppError> {
        if !valid_id(id) {
            return Err(storage());
        }
        self.check()?;
        let file = match openat(
            &self.file,
            id,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ) {
            Ok(file) => File::from(file),
            Err(error) if error == rustix::io::Errno::NOENT => return Ok(None),
            Err(_) => return Err(storage()),
        };
        let row = Row {
            file,
            id: id.into(),
        };
        row.check(self)?;
        Ok(Some(row))
    }
    pub fn create_row(&self, id: &str) -> Result<Row, AppError> {
        if !valid_id(id) {
            return Err(storage());
        }
        self.check()?;
        system(mkdirat(&self.file, id, Mode::RWXU))?;
        self.row(id)?.ok_or_else(storage)
    }
    pub fn sync(&self) -> Result<(), AppError> {
        io(self.file.sync_all())?;
        io(self.parent.sync_all())?;
        self.check()
    }
}
pub(super) struct Row {
    pub file: File,
    pub id: String,
}
pub(super) struct Scan {
    pub committed: Vec<(GitLabForkRecord, Fingerprint)>,
    pub pending: Vec<Option<GitLabForkRecord>>,
    pub retired: Option<GitLabForkRecord>,
    pub bytes: u64,
}
impl Scan {
    pub fn latest(&self) -> Option<&GitLabForkRecord> {
        self.committed.last().map(|(record, _)| record)
    }
    pub fn entry(&self, id: &str, active: bool) -> GitLabForkJournalEntry {
        let mut record = self.latest().cloned();
        if self.pending.len() == 1
            && let Some(candidate) = &self.pending[0]
        {
            let allowed = match &record {
                Some(previous) => validate_next(previous, candidate).is_ok(),
                None => initial(candidate).is_ok(),
            };
            if allowed {
                record = Some(candidate.clone());
            }
        }
        GitLabForkJournalEntry {
            id: id.into(),
            record,
            pending: !self.pending.is_empty(),
            retired: self.retired.is_some(),
            operation_active: active,
        }
    }
}
impl Row {
    pub fn check(&self, root: &Root) -> Result<(), AppError> {
        root.check()?;
        private_dir(&self.file, root.uid, true)?;
        same_directory(&self.file, &fd_path(&root.file).join(&self.id))
    }
    pub fn lock(&self, root: &Root) -> Result<Lock, AppError> {
        self.check(root)?;
        let file = File::from(system(openat(
            &self.file,
            ".",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ))?);
        Lock::acquire(file)
    }
    pub fn active(&self, root: &Root) -> Result<bool, AppError> {
        match self.lock(root) {
            Ok(_) => Ok(false),
            Err(error) if error.kind == "gitlabForkJournalBusy" => Ok(true),
            Err(error) => Err(error),
        }
    }
    fn raw(&self, root: &Root, name: &str) -> Result<(Vec<u8>, Fingerprint), AppError> {
        self.check(root)?;
        let mut file = File::from(system(openat(
            &self.file,
            name,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        ))?);
        let before = io(file.metadata())?;
        private_file(&before, root.uid, root.limits.record_bytes)?;
        let mut bytes = Vec::new();
        io((&mut file)
            .take(root.limits.record_bytes as u64 + 1)
            .read_to_end(&mut bytes))?;
        let after = io(file.metadata())?;
        let named = io(fs::symlink_metadata(fd_path(&self.file).join(name)))?;
        if bytes.len() > root.limits.record_bytes
            || fingerprint(&before) != fingerprint(&after)
            || fingerprint(&after) != fingerprint(&named)
        {
            return Err(storage());
        }
        private_file(&named, root.uid, root.limits.record_bytes)?;
        self.check(root)?;
        Ok((bytes, fingerprint(&after)))
    }
    pub fn scan(&self, root: &Root) -> Result<Scan, AppError> {
        self.check(root)?;
        let mut committed = std::collections::BTreeMap::new();
        let mut pending = Vec::new();
        let mut retired = None;
        let mut bytes = 0u64;
        for (index, entry) in io(fs::read_dir(fd_path(&self.file)))?.enumerate() {
            if index >= root.limits.versions + 2 {
                return Err(capacity());
            }
            let name = io(entry)?.file_name();
            let name = name.to_str().ok_or_else(storage)?;
            let (number, is_pending) = if name == "retired.json" {
                (None, false)
            } else if name == "retirement.next" {
                (None, true)
            } else if let Some(n) = name.strip_suffix(".json") {
                (Some(revision(n)?), false)
            } else if let Some(n) = name.strip_suffix(".next") {
                (Some(revision(n)?), true)
            } else {
                return Err(storage());
            };
            let (raw, seal) = self.raw(root, name)?;
            bytes = bytes.checked_add(raw.len() as u64).ok_or_else(capacity)?;
            if name == "retired.json" {
                let record: GitLabForkRecord =
                    serde_json::from_slice(&raw).map_err(|_| storage())?;
                record.validate()?;
                retired = Some(record);
                continue;
            }
            let record = serde_json::from_slice::<GitLabForkRecord>(&raw)
                .ok()
                .filter(|record| {
                    record.validate().is_ok()
                        && record.id == self.id
                        && number.is_none_or(|n| record.revision.parse::<u64>().ok() == Some(n))
                });
            if is_pending {
                pending.push(record);
            } else if committed
                .insert(
                    number.ok_or_else(storage)?,
                    (record.ok_or_else(storage)?, seal),
                )
                .is_some()
            {
                return Err(storage());
            }
        }
        let committed = committed.into_values().collect::<Vec<_>>();
        for (index, (record, _)) in committed.iter().enumerate() {
            if revision(&record.revision)? != index as u64 + 1 {
                return Err(storage());
            }
            if index == 0 {
                initial(record)?;
            } else {
                validate_next(&committed[index - 1].0, record)?;
            }
        }
        if committed.len() > root.limits.versions || pending.len() > 1 {
            return Err(capacity());
        }
        if let Some(retired) = &retired
            && (!pending.is_empty() || committed.last().map(|(record, _)| record) != Some(retired))
        {
            return Err(storage());
        }
        self.check(root)?;
        Ok(Scan {
            committed,
            pending,
            retired,
            bytes,
        })
    }
    pub fn publish(&self, root: &Root, record: &GitLabForkRecord) -> Result<Fingerprint, AppError> {
        self.publish_with_hook(root, record, || {})
    }
    pub fn publish_with_hook(
        &self,
        root: &Root,
        record: &GitLabForkRecord,
        before_publish: impl FnOnce(),
    ) -> Result<Fingerprint, AppError> {
        let next = format!("{}.next", record.revision);
        let target = format!("{}.json", record.revision);
        self.publish_named(root, &next, &target, record, before_publish)
    }
    pub fn retire(&self, root: &Root, record: &GitLabForkRecord) -> Result<Fingerprint, AppError> {
        self.publish_named(root, "retirement.next", "retired.json", record, || {})
    }
    fn publish_named(
        &self,
        root: &Root,
        pending: &str,
        target: &str,
        record: &GitLabForkRecord,
        before_publish: impl FnOnce(),
    ) -> Result<Fingerprint, AppError> {
        self.check(root)?;
        record.validate()?;
        let bytes = serde_json::to_vec(record).map_err(|_| storage())?;
        if bytes.len() > root.limits.record_bytes {
            return Err(capacity());
        }
        let mut file = File::from(system(openat(
            &self.file,
            pending,
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        ))?);
        // Every failure leaves these private bytes for inspection. No unlink,
        // overwrite or implicit re-dispatch is a recovery strategy.
        io(file.write_all(&bytes))?;
        io(file.sync_all())?;
        let owned = io(file.metadata())?;
        private_file(&owned, root.uid, root.limits.record_bytes)?;
        before_publish();
        let (actual, seal) = self.raw(root, pending)?;
        if actual != bytes || seal != fingerprint(&owned) {
            return Err(storage());
        }
        self.check(root)?;
        system(renameat_with(
            &self.file,
            pending,
            &self.file,
            target,
            RenameFlags::NOREPLACE,
        ))?;
        io(self.file.sync_all())?;
        root.sync()?;
        let (published, seal) = self.raw(root, target)?;
        if published != bytes || seal != fingerprint(&io(file.metadata())?) {
            return Err(storage());
        }
        Ok(seal)
    }
}
