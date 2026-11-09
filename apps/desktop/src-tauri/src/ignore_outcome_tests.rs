use super::{AppError, execute_ignore_with_refresh};
use std::cell::Cell;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Fixture {
    path: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "khronos-ignore-outcome-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        let fixture = Self { path };
        assert!(fixture.git(&["init", "-q", "--template="]).status.success());
        fs::write(fixture.path.join("selected.txt"), b"keep these bytes\n").unwrap();
        fixture
    }

    fn git(&self, args: &[&str]) -> Output {
        Command::new("git")
            .arg("-C")
            .arg(&self.path)
            .args(args)
            .env_remove("GIT_CONFIG_COUNT")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).unwrap();
    }
}

#[test]
fn completed_ignore_reports_snapshot_failure_after_rule_and_index_changes() {
    for stop_tracking in [false, true] {
        let fixture = Fixture::new();
        if stop_tracking {
            assert!(fixture.git(&["add", "--", "selected.txt"]).status.success());
            assert!(
                fixture
                    .git(&["ls-files", "--error-unmatch", "--", "selected.txt"])
                    .status
                    .success()
            );
        }

        let error = execute_ignore_with_refresh(
            &fixture.path,
            "selected.txt",
            "file",
            stop_tracking,
            || -> Result<(), AppError> {
                Err(AppError {
                    kind: "snapshotUnavailable".into(),
                    message: "Snapshot unavailable.".into(),
                    hint: Some("Check repository permissions.".into()),
                })
            },
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreRuleRefreshFailed");
        assert!(error.message.contains("ignore operation completed"));
        assert!(error.message.contains("Snapshot unavailable."));
        let hint = error.hint.unwrap();
        assert!(hint.contains(".gitignore"));
        assert!(hint.contains("index before retrying"));
        assert!(hint.contains("Check repository permissions."));
        assert_eq!(
            fs::read(fixture.path.join(".gitignore")).unwrap(),
            b"/selected.txt\n"
        );
        assert_eq!(
            fs::read(fixture.path.join("selected.txt")).unwrap(),
            b"keep these bytes\n"
        );
        assert!(
            !fixture
                .git(&["ls-files", "--error-unmatch", "--", "selected.txt"])
                .status
                .success()
        );
    }
}

#[test]
fn ignore_refusal_preserves_index_and_skips_snapshot_refresh() {
    let fixture = Fixture::new();
    assert!(fixture.git(&["add", "--", "selected.txt"]).status.success());
    let index = fs::read(fixture.path.join(".git/index")).unwrap();
    let refreshed = Cell::new(false);

    let error = execute_ignore_with_refresh(&fixture.path, "selected.txt", "file", false, || {
        refreshed.set(true);
        Ok(())
    })
    .unwrap_err();

    assert_eq!(error.kind, "trackedFileRequiresUntracking");
    assert!(!refreshed.get());
    assert!(!fixture.path.join(".gitignore").exists());
    assert_eq!(fs::read(fixture.path.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(fixture.path.join("selected.txt")).unwrap(),
        b"keep these bytes\n"
    );
}

#[test]
fn successful_ignore_returns_the_refreshed_value() {
    let fixture = Fixture::new();
    let result =
        execute_ignore_with_refresh(&fixture.path, "selected.txt", "file", false, || Ok("fresh"))
            .unwrap();
    assert_eq!(result, "fresh");
    assert_eq!(
        fs::read(fixture.path.join(".gitignore")).unwrap(),
        b"/selected.txt\n"
    );
}
