//! Real-Git transport checks. All scripts, repositories, and refs are exclusively
//! owned by these fixtures; no user's configuration or repository is changed.
use crate::{git_in, run_transport};
use std::fs;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const RETAINED_STDERR_LIMIT: usize = 64 * 1024;
const NOISE: &str = "dd if=/dev/zero bs=1024 count=1024 2>/dev/null | tr '\\000' x >&2\n";

struct Fixture {
    root: PathBuf,
    source: PathBuf,
    destination: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("git-khronos-stderr-{}-{id}", std::process::id()));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let fixture = Self {
            source: root.join("source"),
            destination: root.join("destination"),
            root,
        };
        for path in [&fixture.source, &fixture.destination] {
            fs::create_dir(path).unwrap();
            fixture.git(path, &["init", "-b", "main"]);
            fixture.git(path, &["config", "user.name", "Stderr Fixture"]);
            fixture.git(path, &["config", "user.email", "stderr@example.test"]);
            fixture.git(path, &["config", "commit.gpgsign", "false"]);
            fixture.git(path, &["config", "core.hooksPath", "/dev/null"]);
        }
        fs::write(
            fixture.source.join("tracked.txt"),
            b"preserved fixture contents\n",
        )
        .unwrap();
        fixture.git(&fixture.source, &["add", "tracked.txt"]);
        fixture.git(&fixture.source, &["commit", "-m", "Fixture base"]);
        fixture.git(
            &fixture.destination,
            &["remote", "add", "noisy", fixture.source.to_str().unwrap()],
        );
        fixture
    }

    fn git(&self, path: &Path, args: &[&str]) -> Vec<u8> {
        let output = git_in(path).args(args).env("LC_ALL", "C").output().unwrap();
        assert!(
            output.status.success(),
            "owned Git fixture failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    fn upload_pack(&self, body: &str) {
        let script = self.root.join("fixture-upload-pack");
        fs::write(&script, format!("#!/bin/sh\nset -eu\n{body}")).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let quoted = format!("'{}'", script.to_str().unwrap().replace('\'', "'\\''"));
        self.git(
            &self.destination,
            &["config", "remote.noisy.uploadpack", &quoted],
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // The top-level directory was created exclusively, never reused.
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn transport_stderr_success_is_bounded_and_fetch_completes() {
    let fixture = Fixture::new();
    fixture.upload_pack(&format!("{NOISE}exec git-upload-pack \"$@\"\n"));
    let output = run_transport(&fixture.destination, &["fetch", "noisy"], None, None).unwrap();
    assert!(output.status.success());
    assert!(
        !output.stderr.is_empty(),
        "fetch preview still detects output"
    );
    assert!(
        output.stderr.len() <= RETAINED_STDERR_LIMIT,
        "transport retained {} stderr bytes, exceeding the {}-byte bound",
        output.stderr.len(),
        RETAINED_STDERR_LIMIT
    );
    assert_eq!(
        fixture.git(
            &fixture.destination,
            &["rev-parse", "refs/remotes/noisy/main"]
        ),
        fixture.git(&fixture.source, &["rev-parse", "HEAD"])
    );
    assert_eq!(
        fs::read(fixture.source.join("tracked.txt")).unwrap(),
        b"preserved fixture contents\n"
    );
}

#[test]
fn transport_stderr_classifies_a_failure_marker_outside_the_retained_prefix() {
    let fixture = Fixture::new();
    fixture.upload_pack(&format!(
        "{NOISE}printf 'host key verification failed' >&2\n{NOISE}exit 1\n"
    ));
    let error = run_transport(&fixture.destination, &["fetch", "noisy"], None, None).unwrap_err();
    assert_eq!(error.kind, "sshHostTrustRequired");
    assert!(!error.message.contains("xxxxx"));
    assert!(
        !fixture
            .destination
            .join(".git/refs/remotes/noisy/main")
            .exists()
    );
}

#[test]
fn transport_stderr_policy_does_not_truncate_generic_command_output() {
    use crate::{CancellationToken, configure_process_tree, run_cancellable_command};
    use std::process::{Command, Stdio};
    let mut command = Command::new("sh");
    command
        .args(["-c", &format!("{NOISE}printf 'binary\\000stdout'; exit 7")])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    let output = run_cancellable_command(command, &CancellationToken::default()).unwrap();
    assert_eq!(output.status.code(), Some(7));
    assert_eq!(output.stdout, b"binary\0stdout");
    assert_eq!(output.stderr, vec![b'x'; 1024 * 1024]);
}

#[cfg(target_os = "linux")]
pub(super) fn check_escaped_pipe_holder(
    cancel: bool,
    expected_error: Option<&str>,
    capture: impl FnOnce(
        std::process::Command,
        PathBuf,
        crate::CancellationToken,
    ) -> Result<(), crate::AppError>
    + Send
    + 'static,
) {
    use crate::{CancellationToken, configure_process_tree};
    use std::os::unix::ffi::OsStrExt;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

    // This helper deliberately leaves Git's group while retaining both pipes.
    // Cleanup may signal only the new session whose command contains our
    // exclusively owned marker path. Its six-second lifetime is also bounded.
    struct OwnedSession(PathBuf);
    impl OwnedSession {
        fn stop(&self) {
            let Some(pid) = fs::read_to_string(&self.0)
                .ok()
                .and_then(|value| value.trim().parse::<i32>().ok())
                .filter(|pid| *pid > 1)
            else {
                return;
            };
            let Ok(stat) = fs::read_to_string(format!("/proc/{pid}/stat")) else {
                return;
            };
            let Some((_, fields)) = stat.rsplit_once(')') else {
                return;
            };
            let fields: Vec<_> = fields.split_whitespace().collect();
            let expected = pid.to_string();
            if fields.get(2) != Some(&expected.as_str())
                || fields.get(3) != Some(&expected.as_str())
            {
                return;
            }
            let Ok(command) = fs::read(format!("/proc/{pid}/cmdline")) else {
                return;
            };
            if !command
                .windows(self.0.as_os_str().as_bytes().len())
                .any(|part| part == self.0.as_os_str().as_bytes())
            {
                return;
            }
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
            }
            unsafe {
                kill(-pid, 9);
            }
        }
    }
    impl Drop for OwnedSession {
        fn drop(&mut self) {
            self.stop();
        }
    }

    let fixture = Fixture::new();
    let helper = OwnedSession(fixture.root.join("escaped-helper-pid"));
    let body = "setsid sh -c 'printf \"%s\" \"$$\" > \"$1\"; sleep 6' owned-helper \"$1\" & while [ ! -s \"$1\" ]; do sleep .01; done; printf 'abcdef\\n'; exit 0";
    let script = fixture.root.join("escaped-holder");
    fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    let quote = |path: &Path| format!("'{}'", path.to_str().unwrap().replace('\'', "'\\''"));
    fixture.git(
        &fixture.destination,
        &[
            "config",
            "alias.owned-holder",
            &format!("!{} {}", quote(&script), quote(&helper.0)),
        ],
    );
    let repository = fixture.destination.clone();
    let mut command = Command::new("sh");
    command
        .args(["-c", body, "owned-parent"])
        .arg(&helper.0)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    let cancellation = CancellationToken::default();
    let worker_token = cancellation.clone();
    let (sender, receiver) = mpsc::channel();
    let worker = thread::spawn(move || {
        let result = capture(command, repository, worker_token);
        let _ = sender.send(result);
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    while fs::read_to_string(&helper.0).map_or(true, |value| value.trim().is_empty())
        && Instant::now() < deadline
    {
        thread::sleep(Duration::from_millis(10));
    }
    let ready = fs::read_to_string(&helper.0).is_ok_and(|value| !value.trim().is_empty());
    if cancel {
        cancellation.cancel();
    }
    let result = receiver.recv_timeout(Duration::from_secs(2));
    let returned_promptly = result.is_ok();
    helper.stop();
    let result = result.unwrap_or_else(|_| receiver.recv_timeout(Duration::from_secs(8)).unwrap());
    worker.join().unwrap();
    assert!(
        ready,
        "the escaped helper must actually have inherited the pipes"
    );
    if let Some(kind) = expected_error {
        assert_eq!(result.unwrap_err().kind, kind);
    } else {
        result.unwrap();
    }
    assert!(
        returned_promptly,
        "termination blocked on pipes held outside Git's process group (cancel={cancel}, expected={expected_error:?})"
    );
}

#[cfg(target_os = "linux")]
#[test]
fn transport_capture_interrupts_escaped_pipe_holders_on_cancel_and_limit() {
    check_escaped_pipe_holder(true, Some("operationCancelled"), |command, _, token| {
        crate::run_cancellable_command(command, &token).map(|_| ())
    });
    check_escaped_pipe_holder(false, None, |command, _, token| {
        let (output, truncated) =
            crate::run_cancellable_command_with_stdout_limit(command, &token, Some(0))?;
        assert!(truncated);
        assert!(output.stdout.is_empty());
        Ok(())
    });
}

#[cfg(target_os = "linux")]
#[test]
fn history_capture_cancel_interrupts_escaped_pipe_holders() {
    check_escaped_pipe_holder(true, Some("operationCancelled"), |_, repository, token| {
        crate::history_search::bounded_git_with_limit(
            &repository,
            &["owned-holder".to_owned()],
            &token,
            1024,
        )
        .map(|_| ())
    });
}

#[cfg(target_os = "linux")]
#[test]
fn history_capture_output_limit_interrupts_escaped_pipe_holders() {
    check_escaped_pipe_holder(false, Some("historyOutputLimit"), |_, repository, token| {
        crate::history_search::bounded_git_with_limit(
            &repository,
            &["owned-holder".to_owned()],
            &token,
            0,
        )
        .map(|_| ())
    });
}
