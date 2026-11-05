use super::{
    CommitHistoryCursor, INITIAL_HISTORY_LIMIT, INITIAL_STATUS_LIMIT, RepositorySession,
    set_session_checkpoint_visibility,
};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Fixture {
    dir: PathBuf,
    repo: PathBuf,
    marker: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "khronos-checkpoint-policy-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let repo = dir.join("repository");
        fs::create_dir_all(&repo).unwrap();
        fs::write(dir.join("empty-config"), b"").unwrap();
        let fixture = Self {
            marker: dir.join("unexpected-fetch"),
            dir,
            repo,
        };
        fixture.git(&["-c", "init.templateDir=", "init", "-q", "-b", "main"]);
        let no_hooks = fixture.dir.join("no-hooks");
        for (key, value) in [
            ("user.name", "Checkpoint Test"),
            ("user.email", "checkpoint@example.test"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", no_hooks.to_str().unwrap()),
        ] {
            fixture.git(&["config", key, value]);
        }
        fs::write(fixture.repo.join("tracked"), b"tracked\n").unwrap();
        fixture.git(&["add", "tracked"]);
        fixture.git(&["commit", "-qm", "Initial commit"]);
        let oid = fixture.git(&["rev-parse", "HEAD:tracked"]);
        fixture.git(&["tag", "missing-object", &oid]);

        let remote = fixture.dir.join("promisor.git");
        fixture.git(&["init", "--bare", remote.to_str().unwrap()]);
        let helper = fixture.dir.join("upload-pack");
        let marker = fixture.marker.to_str().unwrap().replace('\'', "'\\''");
        fs::write(
            &helper,
            format!("#!/bin/sh\nprintf owned > '{marker}'\nexit 1\n"),
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        for (key, value) in [
            ("extensions.partialClone", "owned"),
            ("remote.owned.promisor", "true"),
            ("remote.owned.url", remote.to_str().unwrap()),
            ("remote.owned.uploadpack", helper.to_str().unwrap()),
            ("protocol.file.allow", "always"),
        ] {
            fixture.git(&["config", key, value]);
        }
        fs::remove_file(
            fixture
                .repo
                .join(".git/objects")
                .join(&oid[..2])
                .join(&oid[2..]),
        )
        .unwrap();
        fixture
    }

    fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(&self.repo)
            .args(args)
            .env("GIT_CONFIG_GLOBAL", self.dir.join("empty-config"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().into()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn session(path: &Path) -> RepositorySession {
    RepositorySession {
        incoming_link_guard: Arc::new(AtomicBool::new(false)),
        no_lazy_reads: AtomicBool::new(false),
        pause_auto_sync: AtomicBool::new(false),
        path: path.to_owned(),
        operation: Mutex::new(()),
        history_cursor: Mutex::new(CommitHistoryCursor::default()),
        history_limit: AtomicUsize::new(INITIAL_HISTORY_LIMIT),
        status_limit: AtomicUsize::new(INITIAL_STATUS_LIMIT),
        show_checkpoints: AtomicBool::new(false),
    }
}

#[test]
fn checkpoint_visibility_obeys_repository_read_policy() {
    let fixture = Fixture::new();
    let session = session(&fixture.repo);
    for (no_lazy_reads, incoming_guard) in [(true, false), (false, true)] {
        session
            .no_lazy_reads
            .store(no_lazy_reads, Ordering::Release);
        session
            .incoming_link_guard
            .store(incoming_guard, Ordering::Release);
        let _ = set_session_checkpoint_visibility("test".into(), &session, true);
        assert!(
            !fixture.marker.exists(),
            "checkpoint visibility unexpectedly fetched a missing object"
        );
    }
    session.no_lazy_reads.store(false, Ordering::Release);
    session.incoming_link_guard.store(false, Ordering::Release);
    let _ = set_session_checkpoint_visibility("test".into(), &session, true);
    assert_eq!(
        fs::read(&fixture.marker).unwrap(),
        b"owned",
        "the unguarded operation must exercise the fetch sentinel"
    );
}
