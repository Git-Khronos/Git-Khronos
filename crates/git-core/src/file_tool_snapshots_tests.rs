use super::*;
use std::{
    fs,
    os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt, symlink},
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).unwrap();
        let name: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("owned-file-tools-{name}"));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }
    fn uid(&self) -> u32 {
        fs::metadata(&self.0).unwrap().uid()
    }
    fn parent(&self) -> PathBuf {
        self.0.join("sessions")
    }
    fn session(&self) -> FileToolSnapshots {
        FileToolSnapshots::create(&self.parent(), self.uid()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn file_tool_snapshots_are_private_complete_literal_bytes_and_explicitly_discarded() {
    let fixture = Fixture::new();
    let mut session = fixture.session();
    let directory = session.path().to_owned();
    let raw = b"\xff\0not decoded\r\n";
    let before = session
        .materialize(FileToolSnapshotRole::Before, Some("rs"), raw)
        .unwrap();
    let after = session
        .materialize(FileToolSnapshotRole::After, Some("../../escape"), b"after")
        .unwrap();
    let merged = session
        .materialize(FileToolSnapshotRole::Merged, Some("rs"), b"initial")
        .unwrap();
    assert_eq!(
        fs::metadata(fixture.parent()).unwrap().mode() & 0o777,
        0o700
    );
    assert_eq!(fs::metadata(&directory).unwrap().mode() & 0o777, 0o700);
    assert_eq!(before.file_name().unwrap(), "before.rs");
    assert_eq!(after.file_name().unwrap(), "after");
    assert_eq!(fs::read(&before).unwrap(), raw);
    assert_eq!(fs::metadata(&before).unwrap().mode() & 0o777, 0o400);
    assert_eq!(fs::metadata(&merged).unwrap().mode() & 0o777, 0o600);
    session.verify_inputs().unwrap();
    assert_eq!(session.read_result().unwrap().bytes(), b"initial");
    session.discard().unwrap();
    assert!(!directory.exists());
    assert!(session.verify_inputs().is_err());
    assert!(
        session
            .materialize(FileToolSnapshotRole::Before, None, b"late")
            .is_err()
    );
}

#[test]
fn file_tool_snapshots_drop_retains_files_for_detached_program_lifetimes() {
    let fixture = Fixture::new();
    let directory;
    let file;
    {
        let mut session = fixture.session();
        directory = session.path().to_owned();
        file = session
            .materialize(FileToolSnapshotRole::Before, None, b"retained")
            .unwrap();
    }
    assert!(directory.is_dir());
    assert_eq!(fs::read(file).unwrap(), b"retained");
}

#[test]
fn file_tool_snapshots_refuse_links_foreign_owners_and_nonprivate_parents_without_changing_them() {
    let fixture = Fixture::new();
    let foreign = fixture.0.join("outside");
    fs::create_dir(&foreign).unwrap();
    fs::write(foreign.join("retain"), b"owned").unwrap();
    symlink(&foreign, fixture.parent()).unwrap();
    assert!(FileToolSnapshots::create(&fixture.parent(), fixture.uid()).is_err());
    assert_eq!(fs::read(foreign.join("retain")).unwrap(), b"owned");
    fs::remove_file(fixture.parent()).unwrap();
    fs::set_permissions(&foreign, fs::Permissions::from_mode(0o700)).unwrap();
    let linked_ancestor = fixture.0.join("linked");
    symlink(&foreign, &linked_ancestor).unwrap();
    assert!(
        FileToolSnapshots::create(&linked_ancestor.join("must-not-exist"), fixture.uid()).is_err()
    );
    assert!(!foreign.join("must-not-exist").exists());
    fs::create_dir(fixture.parent()).unwrap();
    fs::set_permissions(fixture.parent(), fs::Permissions::from_mode(0o755)).unwrap();
    assert!(FileToolSnapshots::create(&fixture.parent(), fixture.uid()).is_err());
    assert_eq!(
        fs::metadata(fixture.parent()).unwrap().mode() & 0o777,
        0o755
    );
    fs::set_permissions(fixture.parent(), fs::Permissions::from_mode(0o700)).unwrap();
    assert!(FileToolSnapshots::create(&fixture.parent(), fixture.uid().wrapping_add(1)).is_err());
    assert_eq!(fs::read_dir(fixture.parent()).unwrap().count(), 0);
}

#[test]
fn file_tool_snapshots_refuse_replaced_inputs_and_preserve_foreign_and_unknown_cleanup_entries() {
    let fixture = Fixture::new();
    let mut session = fixture.session();
    let before = session
        .materialize(FileToolSnapshotRole::Before, None, b"original")
        .unwrap();
    fs::remove_file(&before).unwrap();
    fs::write(&before, b"replacement").unwrap();
    assert!(session.verify_inputs().is_err());
    assert!(session.discard().is_err());
    assert_eq!(fs::read(&before).unwrap(), b"replacement");
    let mut another = fixture.session();
    let original = another
        .materialize(FileToolSnapshotRole::Before, None, b"original")
        .unwrap();
    let unknown = another.path().join("unexpected-not-ours");
    fs::write(&unknown, b"preserve").unwrap();
    assert!(another.discard().is_err());
    assert_eq!(fs::read(&unknown).unwrap(), b"preserve");
    assert_eq!(fs::read(&original).unwrap(), b"original");
}

#[test]
fn file_tool_snapshots_output_review_accepts_atomic_save_but_refuses_stale_results_links_and_oversize()
 {
    let fixture = Fixture::new();
    let mut session = fixture.session();
    session
        .materialize(FileToolSnapshotRole::Before, None, b"ours")
        .unwrap();
    let merged = session
        .materialize(FileToolSnapshotRole::Merged, None, b"initial")
        .unwrap();
    let first = session.read_result().unwrap();
    let replacement = fixture.0.join("atomic-output");
    fs::write(&replacement, b"new reviewed output\0").unwrap();
    fs::rename(&replacement, &merged).unwrap();
    assert!(session.verify_result(&first).is_err());
    let next = session.read_result().unwrap();
    assert_eq!(next.bytes(), b"new reviewed output\0");
    session.verify_result(&next).unwrap();
    fs::write(&merged, b"later change").unwrap();
    assert!(session.verify_result(&next).is_err());
    fs::remove_file(&merged).unwrap();
    let outside = fixture.0.join("outside-output");
    fs::write(&outside, b"outside").unwrap();
    symlink(&outside, &merged).unwrap();
    assert!(session.read_result().is_err());
    assert!(session.discard().is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"outside");
    fs::remove_file(&merged).unwrap();
    fs::hard_link(&outside, &merged).unwrap();
    assert!(session.read_result().is_err());
    fs::remove_file(&merged).unwrap();
    fs::write(&merged, b"").unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&merged)
        .unwrap()
        .set_len(MAX_FILE_CONTENT_BYTES as u64 + 1)
        .unwrap();
    assert!(session.read_result().is_err());
    assert!(!format!("{next:?}").contains("new reviewed output"));
}

#[test]
fn file_tool_snapshots_enforce_role_and_session_limits_and_preserve_foreign_parent_locks() {
    use rustix::fs::{FlockOperation, flock};
    let fixture = Fixture::new();
    let mut first = fixture.session();
    let before = first
        .materialize(FileToolSnapshotRole::Before, None, b"one")
        .unwrap();
    assert!(
        first
            .materialize(FileToolSnapshotRole::Before, Some("new"), b"two")
            .is_err()
    );
    assert_eq!(fs::read(before).unwrap(), b"one");
    let huge = vec![0; MAX_FILE_CONTENT_BYTES + 1];
    assert!(
        first
            .materialize(FileToolSnapshotRole::After, None, &huge)
            .is_err()
    );
    assert_eq!(fs::read_dir(first.path()).unwrap().count(), 1);
    let lock = fs::File::open(fixture.parent()).unwrap();
    flock(&lock, FlockOperation::NonBlockingLockExclusive).unwrap();
    assert!(FileToolSnapshots::create(&fixture.parent(), fixture.uid()).is_err());
    assert_eq!(fs::read_dir(fixture.parent()).unwrap().count(), 1);
    drop(lock);
    let mut sessions = vec![first];
    for _ in 1..16 {
        sessions.push(fixture.session());
    }
    assert!(FileToolSnapshots::create(&fixture.parent(), fixture.uid()).is_err());
    assert_eq!(fs::read_dir(fixture.parent()).unwrap().count(), 16);
    sessions.pop().unwrap().discard().unwrap();
    fixture.session().discard().unwrap();
}

#[test]
fn file_tool_snapshots_parent_or_session_replacement_never_redirects_reads_or_cleanup() {
    let fixture = Fixture::new();
    let mut session = fixture.session();
    let file = session
        .materialize(FileToolSnapshotRole::Before, None, b"original")
        .unwrap();
    let old = fixture.0.join("retained-original-session");
    fs::rename(session.path(), &old).unwrap();
    fs::create_dir(session.path()).unwrap();
    fs::set_permissions(session.path(), fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(&file, b"foreign").unwrap();
    assert!(session.verify_inputs().is_err());
    assert!(session.discard().is_err());
    assert_eq!(fs::read(&file).unwrap(), b"foreign");
    assert_eq!(fs::read(old.join("before")).unwrap(), b"original");
    let mut second = fixture.session();
    let current = second
        .materialize(FileToolSnapshotRole::Before, None, b"second")
        .unwrap();
    let saved_parent = fixture.0.join("old-parent");
    fs::rename(fixture.parent(), &saved_parent).unwrap();
    fs::DirBuilder::new()
        .mode(0o700)
        .create(fixture.parent())
        .unwrap();
    assert!(second.verify_inputs().is_err());
    assert!(second.discard().is_err());
    assert!(
        saved_parent
            .join(current.strip_prefix(fixture.parent()).unwrap())
            .exists()
    );
}

#[test]
fn file_tool_snapshots_result_fingerprint_covers_exact_bytes_and_matches_standard_sha256_vectors() {
    let fixture = Fixture::new();
    for (bytes, expected) in [
        (
            b"".as_slice(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ),
        (
            b"abc".as_slice(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        ),
    ] {
        let mut session = fixture.session();
        session
            .materialize(FileToolSnapshotRole::Merged, None, bytes)
            .unwrap();
        let result = session.read_result().unwrap();
        assert_eq!(result.bytes(), bytes);
        assert_eq!(result.sha256().unwrap(), expected);
        session.discard().unwrap();
    }
}
