//! Per-operation askpass IPC. The shipped desktop executable also runs the helper
//! entry point before starting Tauri; no scripts or global environment changes.
use crate::{AppError, CancellationToken, Output};
use std::cell::RefCell;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

const MAX_RESPONSE: usize = 16 * 1024;
const TIMEOUT: Duration = Duration::from_secs(120);
const HELPER_ENV: &str = "GIT_CHRONOS_ASKPASS";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PromptKind {
    Username,
    Secret,
}

type Handler = Arc<dyn Fn(PromptKind) -> Option<String> + Send + Sync>;

#[derive(Clone)]
struct Context {
    address: String,
    token: String,
    executable: std::path::PathBuf,
    cancellation: CancellationToken,
    interactive: bool,
    requested: Arc<AtomicBool>,
}

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}

struct Scope(Option<Context>);
impl Drop for Scope {
    fn drop(&mut self) {
        CONTEXT.with(|slot| *slot.borrow_mut() = self.0.take());
    }
}

struct Worker {
    stopped: Arc<AtomicBool>,
    cancellation: CancellationToken,
    thread: Option<thread::JoinHandle<()>>,
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        self.cancellation.cancel();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn with_authentication<T>(
    executable: &Path,
    cancellation: &CancellationToken,
    handler: Option<Handler>,
    action: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| bridge_error())?;
    listener.set_nonblocking(true).map_err(|_| bridge_error())?;
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|_| bridge_error())?;
    let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let context = Context {
        address: listener
            .local_addr()
            .map_err(|_| bridge_error())?
            .to_string(),
        token,
        executable: executable.to_owned(),
        cancellation: cancellation.clone(),
        interactive: handler.is_some(),
        requested: Arc::new(AtomicBool::new(false)),
    };
    let stopped = Arc::new(AtomicBool::new(false));
    let stop = stopped.clone();
    let server_context = context.clone();
    let worker = thread::spawn(move || {
        let mut attempts = 0;
        while !stop.load(Ordering::Acquire) && !server_context.cancellation.is_cancelled() {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    let mut request = [0_u8; 65];
                    if stream.read_exact(&mut request).is_err()
                        || request[..64] != *server_context.token.as_bytes()
                    {
                        continue;
                    }
                    let kind = match request[64] {
                        1 => PromptKind::Username,
                        2 => PromptKind::Secret,
                        _ => {
                            let _ = stream.write_all(&[0]);
                            continue;
                        }
                    };
                    server_context.requested.store(true, Ordering::Release);
                    attempts += 1;
                    let answer = if attempts <= 12 {
                        handler.as_ref().and_then(|handler| handler(kind))
                    } else {
                        None
                    };
                    if let Some(answer) = answer.filter(|value| valid_response(value)) {
                        let _ = stream.write_all(&[1]);
                        let _ = stream.write_all(&(answer.len() as u32).to_be_bytes());
                        let _ = stream.write_all(answer.as_bytes());
                    } else {
                        let _ = stream.write_all(&[0]);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
    });
    let previous = CONTEXT.with(|slot| slot.replace(Some(context)));
    let _scope = Scope(previous);
    let _worker = Worker {
        stopped,
        cancellation: cancellation.clone(),
        thread: Some(worker),
    };
    action()
}

fn bridge_error() -> AppError {
    AppError::new(
        "authenticationUnavailable",
        "The authentication bridge could not start.",
        Some(
            "Retry the operation. Git credential helpers and SSH agents can also supply credentials.",
        ),
    )
}

fn valid_response(value: &str) -> bool {
    value.len() <= MAX_RESPONSE && !value.contains(['\0', '\r', '\n'])
}

fn prompt_kind(prompt: &str) -> Option<PromptKind> {
    let lower = prompt.to_ascii_lowercase();
    if lower.starts_with("username for 'http://") || lower.starts_with("username for 'https://") {
        Some(PromptKind::Username)
    } else if lower.starts_with("password for 'http://")
        || lower.starts_with("password for 'https://")
        || lower.starts_with("enter passphrase for key ")
        || lower.trim_end().ends_with("'s password:")
    {
        Some(PromptKind::Secret)
    } else {
        None
    }
}

/// Returns None for normal application startup. A helper failure never starts a UI.
pub fn helper_entry() -> Option<i32> {
    std::env::var_os(HELPER_ENV)?;
    Some(if helper_run().is_ok() { 0 } else { 1 })
}

fn helper_run() -> Result<(), ()> {
    let prompt = std::env::args().nth(1).ok_or(())?;
    let kind = prompt_kind(&prompt).ok_or(())?;
    let address: std::net::SocketAddr = std::env::var("GIT_CHRONOS_ASKPASS_ADDRESS")
        .map_err(|_| ())?
        .parse()
        .map_err(|_| ())?;
    if !address.ip().is_loopback() {
        return Err(());
    }
    let token = std::env::var("GIT_CHRONOS_ASKPASS_TOKEN").map_err(|_| ())?;
    if token.len() != 64 {
        return Err(());
    }
    let mut stream =
        TcpStream::connect_timeout(&address, Duration::from_secs(2)).map_err(|_| ())?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(|_| ())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| ())?;
    stream.write_all(token.as_bytes()).map_err(|_| ())?;
    stream
        .write_all(&[if kind == PromptKind::Username { 1 } else { 2 }])
        .map_err(|_| ())?;
    let mut status = [0];
    stream.read_exact(&mut status).map_err(|_| ())?;
    if status != [1] {
        return Err(());
    }
    let mut length = [0; 4];
    stream.read_exact(&mut length).map_err(|_| ())?;
    let length = u32::from_be_bytes(length) as usize;
    if length > MAX_RESPONSE {
        return Err(());
    }
    let mut response = vec![0; length];
    stream.read_exact(&mut response).map_err(|_| ())?;
    let response = String::from_utf8(response).map_err(|_| ())?;
    if !valid_response(&response) {
        return Err(());
    }
    std::io::stdout()
        .write_all(response.as_bytes())
        .map_err(|_| ())?;
    std::io::stdout().write_all(b"\n").map_err(|_| ())
}

pub(crate) fn is_transport(args: &[&str]) -> bool {
    let mut arguments = args.iter();
    while let Some(argument) = arguments.next() {
        if matches!(*argument, "-c" | "-C" | "--git-dir" | "--work-tree") {
            arguments.next();
        } else if !argument.starts_with('-') {
            return matches!(
                *argument,
                "clone" | "fetch" | "pull" | "push" | "ls-remote" | "submodule" | "lfs"
            );
        }
    }
    false
}

pub(crate) fn validate_arguments(args: &[&str]) -> Result<(), AppError> {
    for arg in args {
        let lower = arg.to_ascii_lowercase();
        let http = lower
            .strip_prefix("https://")
            .or_else(|| lower.strip_prefix("http://"));
        let ssh = lower.strip_prefix("ssh://");
        if let Some(url) = http.or(ssh) {
            let authority = url.split('/').next().unwrap_or("");
            let userinfo = authority.rsplit_once('@').map(|(userinfo, _)| userinfo);
            if userinfo.is_some_and(|userinfo| http.is_some() || userinfo.contains(':')) {
                return Err(AppError::new(
                    "credentialsInUrl",
                    "Use a repository URL without embedded credentials.",
                    Some(
                        "Enter credentials in the authentication dialog or configure a Git credential helper.",
                    ),
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_repository_urls(path: &Path, args: &[&str]) -> Result<(), AppError> {
    if args.first() == Some(&"clone") {
        return Ok(());
    }
    let mut command = crate::git_in(path);
    command.args([
        "config",
        "--null",
        "--get-regexp",
        r"^(remote\..*\.(url|pushurl)|url\..*\.(insteadof|pushinsteadof))$",
    ]);
    configure(&mut command);
    let output = command.output().map_err(|_| bridge_error())?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(AppError::new(
            "remoteConfigurationUnavailable",
            "Git remote configuration could not be inspected safely.",
            Some("Check the repository configuration before retrying."),
        ));
    }
    for record in String::from_utf8_lossy(&output.stdout).split('\0') {
        if let Some((key, value)) = record.split_once('\n') {
            validate_arguments(&[value])?;
            if let Some(base) = key.strip_prefix("url.")
                && let Some((base, _)) = base.rsplit_once('.')
            {
                validate_arguments(&[base])?;
            }
        }
    }
    Ok(())
}

/// Applies the current operation's authentication environment to a transport
/// command. Callers must keep the command inside `with_authentication`.
pub fn configure(command: &mut Command) -> Option<CancellationToken> {
    // Never launch ambient askpass programs or helper-owned interactive windows.
    command
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS")
        .env_remove("GIT_SSH")
        .env_remove("GIT_SSH_COMMAND")
        .env("GCM_INTERACTIVE", "Never")
        .env(
            "GIT_CREDENTIAL_INTERACTIVE",
            if interactive() { "true" } else { "false" },
        )
        .env("GIT_TRACE", "0")
        .env("GIT_TRACE_CURL", "0")
        .env("GIT_CURL_VERBOSE", "0")
        .env("GIT_TRACE_PACKET", "0")
        .env("GIT_TRACE2", "0")
        .env("GIT_TRACE2_EVENT", "0")
        .env("GIT_TRACE2_PERF", "0")
        .env_remove("GCM_TRACE")
        .env_remove("GCM_TRACE_SECRETS");
    CONTEXT.with(|slot| {
        let context = slot.borrow();
        if let Some(context) = context.as_ref() {
            command
                .env("GIT_ASKPASS", &context.executable)
                .env("SSH_ASKPASS", &context.executable)
                .env("SSH_ASKPASS_REQUIRE", "force")
                .env("DISPLAY", "git-chronos")
                .env(HELPER_ENV, "1")
                .env("GIT_CHRONOS_ASKPASS_ADDRESS", &context.address)
                .env("GIT_CHRONOS_ASKPASS_TOKEN", &context.token);
            command.env("GIT_SSH_COMMAND", if context.interactive {
                "ssh -o StrictHostKeyChecking=yes -o BatchMode=no -o NumberOfPasswordPrompts=3"
            } else { "ssh -o StrictHostKeyChecking=yes -o BatchMode=yes" })
                .env("GIT_SSH_VARIANT", "ssh");
            Some(context.cancellation.clone())
        } else {
            command
                .env("GIT_ASKPASS", "")
                .env("SSH_ASKPASS", "")
                .env("SSH_ASKPASS_REQUIRE", "never")
                .env(
                    "GIT_SSH_COMMAND",
                    "ssh -o StrictHostKeyChecking=yes -o BatchMode=yes",
                )
                .env("GIT_SSH_VARIANT", "ssh");
            None
        }
    })
}

pub(crate) fn interactive() -> bool {
    CONTEXT.with(|slot| {
        slot.borrow()
            .as_ref()
            .is_some_and(|context| context.interactive)
    })
}

pub(crate) fn check_output(output: Output, args: &[&str]) -> Result<Output, AppError> {
    if output.status.success() {
        return Ok(output);
    }
    // Transport diagnostics can contain credentials from arbitrary helpers or URLs.
    // Only classified, original messages reach logs and the renderer.
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    if stderr.contains("host key verification failed")
        || stderr.contains("remote host identification has changed")
    {
        return Err(AppError::new(
            "sshHostTrustRequired",
            "SSH host verification failed.",
            Some(
                "Verify the server fingerprint independently and update known_hosts using SSH outside Git Chronos. Unknown and changed keys are never accepted automatically.",
            ),
        ));
    }
    let requested = CONTEXT.with(|slot| {
        slot.borrow()
            .as_ref()
            .is_some_and(|context| context.requested.load(Ordering::Acquire))
    });
    let authentication_failed = [
        "authentication failed",
        "could not read username",
        "could not read password",
        "permission denied",
        "invalid username",
        "terminal prompts disabled",
        "access denied",
        "unable to get password",
        "unable to get username",
    ]
    .iter()
    .any(|message| stderr.contains(message));
    if !authentication_failed && args.first() == Some(&"pull") {
        if stderr.contains("not possible to fast-forward") {
            return Err(AppError::new(
                "gitFailure",
                "Pull stopped because the histories cannot fast-forward.",
                Some(
                    "Fetch may have updated remote-tracking references. Inspect the divergent commits, then explicitly choose merge or rebase if appropriate. Local commits were not replayed by fast-forward-only pull.",
                ),
            ));
        }
        let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
        if stdout.contains("automatic merge failed; fix conflicts")
            || stderr
                .split(['\r', '\n'])
                .any(|line| line.starts_with("error: could not apply "))
        {
            return Err(AppError::new(
                "gitFailure",
                "Pull stopped while integrating local and remote changes.",
                Some(
                    "Inspect conflicts and the active merge or rebase. Resolve and continue, or abort that operation to return to its starting state. Fetch may already have updated remote-tracking references.",
                ),
            ));
        }
        if stderr.contains("there is no tracking information for the current branch")
            || stderr.contains("but no such ref was fetched")
            || stderr
                .lines()
                .any(|line| line.starts_with("fatal: couldn't find remote ref "))
        {
            return Err(AppError::new(
                "gitFailure",
                "Pull could not find its upstream branch.",
                Some(
                    "Check the selected remote and branch, fetch to review current references, and configure a valid upstream if needed. No replacement branch is selected automatically.",
                ),
            ));
        }
        if [
            "your local changes to the following files would be overwritten by merge",
            "the following untracked working tree files would be overwritten by merge",
            "cannot pull with rebase: you have unstaged changes",
            "cannot pull with rebase: your index contains uncommitted changes",
            "cannot rebase: you have unstaged changes",
            "cannot rebase: your index contains uncommitted changes",
        ]
        .iter()
        .any(|message| stderr.contains(message))
        {
            return Err(AppError::new(
                "gitFailure",
                "Pull stopped to protect local changes.",
                Some(
                    "Review staged, unstaged and untracked files. Commit or explicitly stash the changes before retrying. No automatic discard or alternative integration is performed; fetch may already have updated remote-tracking references.",
                ),
            ));
        }
    }
    if requested || authentication_failed {
        return Err(AppError::new(
            "authenticationRequired",
            "Git authentication is required or was rejected.",
            Some(
                "Retry with an explicit Fetch, Pull or Push. Check your Git credential helper, SSH agent, credentials and repository access.",
            ),
        ));
    }
    if stderr.contains("non-fast-forward")
        || stderr.contains("[rejected]")
        || stderr.contains("failed to push some refs")
    {
        return Err(AppError::new(
            "gitFailure",
            "The remote rejected the push.",
            Some(
                "Fetch and inspect the remote history. A branch policy or stale force-with-lease expectation may prevent pushing; do not bypass it automatically.",
            ),
        ));
    }
    if stderr.contains("certificate") || stderr.contains("ssl") {
        return Err(AppError::new(
            "tlsVerificationFailed",
            "The HTTPS connection could not be verified.",
            Some(
                "Check the server certificate and your Git TLS configuration. Do not disable certificate verification to retry.",
            ),
        ));
    }
    Err(AppError::new(
        "gitTransportFailure",
        "Git transport failed.",
        Some(
            "Check the remote URL, network, repository access and SSH configuration, then retry. No remote rollback is implied.",
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_host_trust_and_unrecognized_prompts() {
        for prompt in [
            "Are you sure you want to continue connecting (yes/no/[fingerprint])?",
            "The authenticity of host cannot be established",
            "Verification code:",
        ] {
            assert_eq!(prompt_kind(prompt), None);
        }
        assert_eq!(
            prompt_kind("Username for 'https://example.test':"),
            Some(PromptKind::Username)
        );
        assert_eq!(
            prompt_kind("Password for 'https://user@example.test':"),
            Some(PromptKind::Secret)
        );
        assert_eq!(
            prompt_kind("Enter passphrase for key '/key':"),
            Some(PromptKind::Secret)
        );
        assert_eq!(
            prompt_kind("git@example.test's password:"),
            Some(PromptKind::Secret)
        );
    }

    #[test]
    fn rejects_secrets_in_urls_and_multiline_responses() {
        assert!(is_transport(&["-c", "fetch.parallel=1", "fetch", "--all"]));
        assert!(!is_transport(&["show", "fetch"]));
        assert!(validate_arguments(&["clone", "https://user:secret@example.test/repo"]).is_err());
        assert!(validate_arguments(&["clone", "https://example.test/repo"]).is_ok());
        assert!(validate_arguments(&["ssh://git:secret@example.test/repo"]).is_err());
        assert!(validate_arguments(&["ssh://git@example.test/repo"]).is_ok());
        assert!(!valid_response("secret\ninjected"));
        assert!(!valid_response(&"x".repeat(MAX_RESPONSE + 1)));
    }

    #[test]
    fn scoped_bridge_authenticates_and_cleans_up() {
        let cancellation = CancellationToken::default();
        let started = std::time::Instant::now();
        with_authentication(
            Path::new("helper"),
            &cancellation,
            Some(Arc::new(|kind| {
                assert_eq!(kind, PromptKind::Secret);
                Some("test-response".into())
            })),
            || {
                let context = CONTEXT.with(|slot| slot.borrow().clone().unwrap());
                let mut invalid = TcpStream::connect(&context.address).unwrap();
                invalid
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                invalid.write_all(&[b'x'; 65]).unwrap();
                let mut denied = [0];
                assert_eq!(invalid.read(&mut denied).unwrap(), 0);
                let mut stream = TcpStream::connect(&context.address).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                stream.write_all(context.token.as_bytes()).unwrap();
                stream.write_all(&[2]).unwrap();
                let mut response = [0; 18];
                stream.read_exact(&mut response).unwrap();
                assert_eq!(&response[5..], b"test-response");
                Ok(())
            },
        )
        .unwrap();
        assert!(CONTEXT.with(|slot| slot.borrow().is_none()));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn openssh_always_preserves_strict_host_verification() {
        let mut command = Command::new("git");
        configure(&mut command);
        let ssh = command
            .get_envs()
            .find(|(key, _)| *key == "GIT_SSH_COMMAND")
            .unwrap()
            .1
            .unwrap()
            .to_string_lossy();
        assert!(ssh.contains("StrictHostKeyChecking=yes"));
        assert!(ssh.contains("BatchMode=yes"));
        with_authentication(
            Path::new("helper"),
            &CancellationToken::default(),
            Some(Arc::new(|_| None)),
            || {
                let mut command = Command::new("git");
                configure(&mut command);
                let ssh = command
                    .get_envs()
                    .find(|(key, _)| *key == "GIT_SSH_COMMAND")
                    .unwrap()
                    .1
                    .unwrap()
                    .to_string_lossy();
                assert!(ssh.contains("StrictHostKeyChecking=yes"));
                assert!(ssh.contains("BatchMode=no"));
                Ok(())
            },
        )
        .unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn pull_local_failures_remain_actionable_and_redacted_after_an_authentication_prompt() {
        use std::os::unix::process::ExitStatusExt;
        with_authentication(
            Path::new("helper"),
            &CancellationToken::default(),
            Some(Arc::new(|_| None)),
            || {
                CONTEXT.with(|slot| slot.borrow().as_ref().unwrap().requested.store(true, Ordering::Release));
                for (stdout, stderr, expected) in [
                    ("", "fatal: Not possible to fast-forward, aborting.\nfixture-secret", "fast-forward"),
                    ("Automatic merge failed; fix conflicts and then commit the result.\nfixture-secret", "", "integrating"),
                    ("CONFLICT (content): fixture-secret", "Rebasing (1/1)\rerror: could not apply deadbeef... fixture-secret", "integrating"),
                    ("", "There is no tracking information for the current branch.\nfixture-secret", "upstream"),
                    ("", "Your configuration specifies to merge with a ref, but no such ref was fetched.\nfixture-secret", "upstream"),
                    ("", "fatal: couldn't find remote ref fixture-secret", "upstream"),
                    ("", "error: Your local changes to the following files would be overwritten by merge:\nfixture-secret", "local changes"),
                    ("", "error: The following untracked working tree files would be overwritten by merge:\nfixture-secret", "local changes"),
                    ("", "error: cannot pull with rebase: Your index contains uncommitted changes.\nfixture-secret", "local changes"),
                ] {
                    let error = check_output(Output {
                        status: std::process::ExitStatus::from_raw(256),
                        stdout: stdout.as_bytes().to_vec(),
                        stderr: stderr.as_bytes().to_vec(),
                    }, &["pull", "--no-rebase", "--ff"]).unwrap_err();
                    assert_eq!(error.kind, "gitFailure");
                    assert!(error.message.contains(expected));
                    assert!(!error.message.contains("fixture-secret"));
                    assert!(!error.hint.unwrap().contains("fixture-secret"));
                }
                let error = check_output(Output {
                    status: std::process::ExitStatus::from_raw(256),
                    stdout: b"Automatic merge failed; fix conflicts".to_vec(),
                    stderr: b"Authentication failed: fixture-secret".to_vec(),
                }, &["pull"]).unwrap_err();
                assert_eq!(error.kind, "authenticationRequired");
                assert!(!error.message.contains("fixture-secret"));
                Ok(())
            },
        ).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn pull_classification_does_not_relabel_other_transport_commands_or_expose_diagnostics() {
        use std::os::unix::process::ExitStatusExt;
        for command in ["fetch", "push", "ls-remote"] {
            let error = check_output(
                Output {
                    status: std::process::ExitStatus::from_raw(256),
                    stdout: b"Automatic merge failed; fix conflicts fixture-secret".to_vec(),
                    stderr: b"fatal: Not possible to fast-forward, aborting.\nfixture-secret".to_vec(),
                },
                &[command],
            )
            .unwrap_err();
            assert_eq!(error.kind, "gitTransportFailure");
            assert!(!error.message.contains("fixture-secret"));
            assert!(!error.hint.unwrap().contains("fixture-secret"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn host_trust_errors_are_actionable_and_transport_diagnostics_never_expose_secrets() {
        use std::os::unix::process::ExitStatusExt;
        for diagnostic in [
            "Host key verification failed. fixture-secret",
            "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! fixture-secret",
            "Authentication failed for 'https://user:fixture-secret@example.test'",
            "arbitrary remote error fixture-secret",
        ] {
            let failure = check_output(Output {
                status: std::process::ExitStatus::from_raw(256),
                stdout: Vec::new(),
                stderr: diagnostic.as_bytes().to_vec(),
            }, &["fetch"])
            .unwrap_err();
            assert!(!failure.message.contains("fixture-secret"));
            assert!(!failure.hint.as_ref().unwrap().contains("fixture-secret"));
            if diagnostic.contains("key") || diagnostic.contains("IDENTIFICATION") {
                assert_eq!(failure.kind, "sshHostTrustRequired");
                assert!(failure.hint.unwrap().contains("fingerprint"));
            }
        }
    }
}
