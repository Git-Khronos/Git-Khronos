use super::*;
use crate::{GitLabForkFailure, GitLabForkImportState, GitLabForkIntent, GitLabNamespaceKind};
use std::fs;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt, symlink};
use std::path::PathBuf;
struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let root = std::env::temp_dir().join(format!("khronos-fork-journal-{name}"));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        Self { root }
    }
    fn path(&self) -> PathBuf {
        self.root.join("journal")
    }
    fn uid(&self) -> u32 {
        fs::metadata(&self.root).unwrap().uid()
    }
    fn open(&self) -> GitLabForkJournal {
        GitLabForkJournal::open(&self.path(), self.uid()).unwrap()
    }
    fn event(&self, id: &str, version: &str) -> PathBuf {
        self.path().join(id).join(format!("{version}.json"))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn record(letter: &str, path: &str) -> GitLabForkRecord {
    GitLabForkRecord::new(
        letter.repeat(32),
        GitLabForkIntent {
            origin: "https://gitlab.example.test".into(),
            account_id: "41".into(),
            account_login: "owned-reader".into(),
            source_id: "101".into(),
            source_full_path: "team/upstream".into(),
            source_empty: None,
            namespace_id: "9007199254740993".into(),
            namespace_full_path: "owned-reader".into(),
            namespace_kind: GitLabNamespaceKind::User,
            project_path: path.into(),
            project_name: None,
        },
        "1793580000000".into(),
    )
    .unwrap()
}
fn private_write(path: &Path, bytes: &[u8]) {
    fs::write(path, bytes).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
}
#[test]
fn fork_journal_syncs_private_initial_record_and_reopens_as_data_without_dispatch() {
    let f = Fixture::new();
    let journal = f.open();
    let original = record("a", "reviewed");
    let lease = journal.begin(&original).unwrap();
    assert_eq!(fs::metadata(f.path()).unwrap().mode() & 0o777, 0o700);
    assert_eq!(
        fs::metadata(f.path().join(&original.id)).unwrap().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(f.event(&original.id, "1")).unwrap().mode() & 0o777,
        0o600
    );
    assert!(
        journal
            .load(&original.id)
            .unwrap()
            .unwrap()
            .operation_active
    );
    drop(lease);
    drop(journal);
    let reopened = f.open();
    let entry = reopened.load(&original.id).unwrap().unwrap();
    assert_eq!(entry.record, Some(original.clone()));
    assert!(!entry.pending && !entry.retired && !entry.operation_active);
    assert_eq!(reopened.inspect().unwrap().entries.len(), 1);
    assert!(reopened.begin(&original).is_err());
    assert!(reopened.begin(&record("b", "reviewed")).is_err());
}
#[test]
fn fork_journal_record_lease_does_not_hold_global_lock_during_network_scope() {
    let f = Fixture::new();
    let one = f.open();
    let two = f.open();
    let original = record("a", "first");
    let a = one.begin(&original).unwrap();
    assert!(two.lease(&original.id, "1").is_err());
    assert!(two.load(&original.id).unwrap().unwrap().operation_active);
    let b = two.begin(&record("b", "second")).unwrap();
    assert_eq!(one.inspect().unwrap().entries.len(), 2);
    assert!(one.retire(&original.id, "1", true).is_err());
    drop(a);
    drop(b);
    assert!(one.lease(&original.id, "1").is_ok());
}
#[test]
fn fork_journal_concurrent_destinations_have_one_reservation_and_no_duplicate_marker() {
    let f = Fixture::new();
    let a = f.open();
    let b = f.open();
    let barrier = std::sync::Barrier::new(2);
    let results = std::thread::scope(|scope| {
        let one = scope.spawn(|| {
            barrier.wait();
            a.begin(&record("a", "reviewed")).is_ok()
        });
        let two = scope.spawn(|| {
            barrier.wait();
            b.begin(&record("b", "REVIEWED")).is_ok()
        });
        (one.join().unwrap(), two.join().unwrap())
    });
    assert_ne!(results.0, results.1);
    assert_eq!(a.inspect().unwrap().entries.len(), 1);
    assert!(a.begin(&record("c", "reviewed")).is_err());
}
#[test]
fn fork_journal_appends_immutable_revisions_and_refuses_stale_or_retargeted_updates() {
    let f = Fixture::new();
    let journal = f.open();
    let first = record("a", "reviewed");
    let mut lease = journal.begin(&first).unwrap();
    let bytes = fs::read(f.event(&first.id, "1")).unwrap();
    let accepted = first.accepted_status(201, "1793580000001").unwrap();
    lease.append(&accepted).unwrap();
    let verified = accepted
        .observe_verified(
            "202",
            GitLabForkImportState::Finished,
            Some(false),
            "1793580000002",
        )
        .unwrap();
    lease.append(&verified).unwrap();
    assert_eq!(fs::read(f.event(&first.id, "1")).unwrap(), bytes);
    assert_eq!(lease.record(), &verified);
    let next = verified
        .interrupted(GitLabForkFailure::Connection, "1793580000003")
        .unwrap();
    for field in ["intent", "project", "http"] {
        let mut bad = next.clone();
        match field {
            "intent" => bad.intent.project_path = "unrelated".into(),
            "project" => bad.project_id = Some("203".into()),
            _ => bad.http_status = None,
        }
        assert!(lease.append(&bad).is_err());
    }
    assert!(!f.event(&first.id, "4").exists());
    drop(lease);
    assert!(journal.lease(&first.id, "2").is_err());
    assert_eq!(
        journal.load(&first.id).unwrap().unwrap().record,
        Some(verified)
    );
}
#[test]
fn fork_journal_no_replace_collision_preserves_foreign_revision_and_owned_pending_bytes() {
    let f = Fixture::new();
    let journal = f.open();
    let first = record("a", "reviewed");
    let mut lease = journal.begin(&first).unwrap();
    let next = first
        .interrupted(GitLabForkFailure::Interrupted, "1793580000001")
        .unwrap();
    let foreign = first
        .interrupted(GitLabForkFailure::Connection, "1793580000001")
        .unwrap();
    let foreign_bytes = serde_json::to_vec(&foreign).unwrap();
    assert!(
        lease
            .append_with_hook(&next, || private_write(
                &f.event(&first.id, "2"),
                &foreign_bytes
            ))
            .is_err()
    );
    assert_eq!(fs::read(f.event(&first.id, "2")).unwrap(), foreign_bytes);
    assert_eq!(
        fs::read(f.path().join(&first.id).join("2.next")).unwrap(),
        serde_json::to_vec(&next).unwrap()
    );
    drop(lease);
    let entry = f.open().load(&first.id).unwrap().unwrap();
    assert!(entry.pending);
    assert_eq!(entry.record, Some(foreign));
    assert!(journal.lease(&first.id, "2").is_err());
    assert!(journal.begin(&record("b", "another")).is_err());
}
#[test]
fn fork_journal_incomplete_pending_write_is_retained_and_blocks_new_dispatch_reservation() {
    let f = Fixture::new();
    let journal = f.open();
    let first = record("a", "reviewed");
    drop(journal.begin(&first).unwrap());
    let pending = f.path().join(&first.id).join("2.next");
    private_write(&pending, b"{incomplete");
    let inspection = journal.inspect().unwrap();
    assert!(
        inspection
            .issues
            .iter()
            .any(|i| i.kind == GitLabForkJournalIssueKind::PendingWrite)
    );
    let entry = journal.load(&first.id).unwrap().unwrap();
    assert_eq!(entry.record, Some(first));
    assert!(entry.pending);
    assert!(journal.begin(&record("b", "another")).is_err());
    assert_eq!(fs::read(pending).unwrap(), b"{incomplete");
}
#[test]
fn fork_journal_refuses_symlinks_hardlinks_shared_modes_and_directory_replacement() {
    let f = Fixture::new();
    let journal = f.open();
    let first = record("a", "reviewed");
    drop(journal.begin(&first).unwrap());
    let canonical = f.event(&first.id, "1");
    let outside = f.root.join("owned-original");
    fs::rename(&canonical, &outside).unwrap();
    symlink(&outside, &canonical).unwrap();
    assert!(journal.load(&first.id).is_err());
    fs::remove_file(&canonical).unwrap();
    fs::hard_link(&outside, &canonical).unwrap();
    assert!(journal.load(&first.id).is_err());
    fs::remove_file(&canonical).unwrap();
    let bytes = fs::read(&outside).unwrap();
    private_write(&canonical, &bytes);
    let moved = f.root.join("moved");
    fs::rename(f.path(), &moved).unwrap();
    fs::DirBuilder::new().mode(0o700).create(f.path()).unwrap();
    assert!(journal.inspect().is_err());
    assert_eq!(fs::read(&outside).unwrap(), bytes);
    fs::set_permissions(f.path(), fs::Permissions::from_mode(0o777)).unwrap();
    assert!(GitLabForkJournal::open(&f.path(), f.uid()).is_err());
    assert!(GitLabForkJournal::open(&f.root.join("wrong-user"), f.uid().wrapping_add(1)).is_err());
    assert!(!f.root.join("wrong-user").exists());
}
#[test]
fn fork_journal_changed_current_inode_cannot_be_overwritten_or_used_as_append_authority() {
    let f = Fixture::new();
    let journal = f.open();
    let first = record("a", "reviewed");
    let mut lease = journal.begin(&first).unwrap();
    let canonical = f.event(&first.id, "1");
    let bytes = fs::read(&canonical).unwrap();
    fs::rename(&canonical, f.root.join("displaced")).unwrap();
    private_write(&canonical, &bytes);
    assert!(
        lease
            .append(
                &first
                    .interrupted(GitLabForkFailure::Connection, "1793580000001")
                    .unwrap()
            )
            .is_err()
    );
    assert_eq!(fs::read(canonical).unwrap(), bytes);
    assert!(!f.event(&first.id, "2").exists());
}
#[test]
fn fork_journal_retirement_is_explicit_revision_bound_and_keeps_all_provider_outcome_bytes() {
    let f = Fixture::new();
    let journal = f.open();
    let first = record("a", "reviewed");
    drop(journal.begin(&first).unwrap());
    let original = fs::read(f.event(&first.id, "1")).unwrap();
    assert!(journal.retire(&first.id, "1", false).is_err());
    assert!(journal.retire(&first.id, "2", true).is_err());
    journal.retire(&first.id, "1", true).unwrap();
    assert!(journal.load(&first.id).unwrap().unwrap().retired);
    assert_eq!(fs::read(f.event(&first.id, "1")).unwrap(), original);
    assert!(journal.lease(&first.id, "1").is_err());
    assert!(journal.begin(&first).is_err());
    assert!(journal.begin(&record("b", "reviewed")).is_ok());
}
#[test]
fn fork_journal_capacity_and_unknown_files_never_evict_or_silently_hide_existing_outcomes() {
    let f = Fixture::new();
    let journal = GitLabForkJournal::with_limits(
        &f.path(),
        f.uid(),
        Limits {
            records: 1,
            versions: 2,
            ..Limits::default()
        },
    )
    .unwrap();
    let first = record("a", "reviewed");
    let mut lease = journal.begin(&first).unwrap();
    assert!(journal.begin(&record("b", "other")).is_err());
    let next = first
        .interrupted(GitLabForkFailure::Connection, "1793580000001")
        .unwrap();
    lease.append(&next).unwrap();
    assert!(
        lease
            .append(
                &next
                    .interrupted(GitLabForkFailure::Interrupted, "1793580000002")
                    .unwrap()
            )
            .is_err()
    );
    assert_eq!(lease.record(), &next);
    drop(lease);
    let unknown = f.path().join("unrecognized");
    private_write(&unknown, b"retained unknown bytes");
    assert!(!journal.inspect().unwrap().issues.is_empty());
    assert!(journal.begin(&record("c", "third")).is_err());
    assert_eq!(fs::read(unknown).unwrap(), b"retained unknown bytes");
    let small = Fixture::new();
    let tiny = GitLabForkJournal::with_limits(
        &small.path(),
        small.uid(),
        Limits {
            total_bytes: 8,
            ..Limits::default()
        },
    )
    .unwrap();
    assert!(tiny.begin(&first).is_err());
    assert!(tiny.inspect().unwrap().entries.is_empty());
}
