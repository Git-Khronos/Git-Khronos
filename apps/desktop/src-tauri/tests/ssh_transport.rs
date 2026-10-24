//! Live SSH qualification against a loopback OpenSSH server.
//!
//! Requires an OpenSSH `sshd` binary (set `GIT_KHRONOS_SSHD`, otherwise `/usr/sbin/sshd`)
//! plus `ssh` and `ssh-keygen`. It runs as the current user and never reads or writes the
//! user's own SSH configuration, keys, agent or known hosts.

use git_khronos_git_core::authentication::{PromptKind, with_authentication};
use git_khronos_git_core::{
    AppError, CancellationToken, fetch_cancellable, push_to_remote_cancellable,
};
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const PASSPHRASE: &str = "fixture-secret";

fn git(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "safe.bareRepository=all"])
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "fixture Git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn run(program: &str, args: &[&str]) {
    let status = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .status()
        .unwrap_or_else(|_| panic!("SSH qualification requires {program}"));
    assert!(status.success(), "{program} failed");
}

struct SshFixture {
    directory: PathBuf,
    repository: PathBuf,
    remote: PathBuf,
    known_hosts: PathBuf,
    host_key_line: String,
    other_host_key_line: String,
    server: Child,
}

impl SshFixture {
    fn new() -> Self {
        let sshd = std::env::var_os("GIT_KHRONOS_SSHD")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/usr/sbin/sshd"));
        assert!(
            sshd.is_absolute() && sshd.is_file(),
            "SSH qualification requires an OpenSSH sshd; set GIT_KHRONOS_SSHD to its absolute path"
        );
        let parent = std::env::current_dir()
            .unwrap()
            .join("target/authentication-fixtures");
        fs::create_dir_all(&parent).unwrap();
        let directory = parent.join(format!(
            "ssh-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory).unwrap();
        let path = |name: &str| directory.join(name);
        let text = |path: &Path| path.to_str().unwrap().to_owned();

        for key in ["host_key", "other_host_key"] {
            run(
                "ssh-keygen",
                &["-q", "-t", "ed25519", "-N", "", "-f", &text(&path(key))],
            );
        }
        run(
            "ssh-keygen",
            &[
                "-q",
                "-t",
                "ed25519",
                "-N",
                PASSPHRASE,
                "-f",
                &text(&path("client_key")),
            ],
        );
        fs::copy(path("client_key.pub"), path("authorized_keys")).unwrap();
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let helpers = sshd
            .parent()
            .and_then(Path::parent)
            .map(|prefix| prefix.join("lib/openssh"))
            .filter(|helpers| helpers.join("sshd-session").is_file());
        let mut config = format!(
            "ListenAddress 127.0.0.1\nPort {port}\nHostKey {}\nAuthorizedKeysFile {}\nPidFile none\nUsePAM no\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n",
            text(&path("host_key")),
            text(&path("authorized_keys")),
        );
        if let Some(helpers) = helpers {
            config.push_str(&format!(
                "SshdSessionPath {}\nSshdAuthPath {}\n",
                text(&helpers.join("sshd-session")),
                text(&helpers.join("sshd-auth")),
            ));
        }
        // OpenSSH 9.8+ would otherwise penalize loopback after the deliberate failures.
        fs::write(
            path("sshd_config"),
            format!("{config}PerSourcePenalties no\n"),
        )
        .unwrap();
        let supported = Command::new(&sshd)
            .args(["-t", "-f"])
            .arg(path("sshd_config"))
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success());
        if !supported {
            fs::write(path("sshd_config"), config).unwrap();
        }
        let mut server = Command::new(&sshd)
            .args(["-D", "-e", "-f"])
            .arg(path("sshd_config"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("sshd did not start");
        let mut log = BufReader::new(server.stderr.take().unwrap());
        let mut line = String::new();
        loop {
            line.clear();
            if log.read_line(&mut line).unwrap() == 0 {
                let _ = server.kill();
                let _ = server.wait();
                panic!("loopback sshd did not start");
            }
            if line.contains("Server listening") {
                break;
            }
        }
        std::thread::spawn(move || {
            let mut sink = String::new();
            while log.read_line(&mut sink).is_ok_and(|read| read > 0) {
                sink.clear();
            }
        });

        // Fixture-local trust: the app forces its own GIT_SSH_COMMAND, so a PATH-scoped
        // `ssh` wrapper adds only the fixture config and keeps every app-supplied option.
        let known_hosts = path("known_hosts");
        fs::write(&known_hosts, b"").unwrap();
        fs::write(
            path("ssh_config"),
            format!(
                "UserKnownHostsFile {}\nGlobalKnownHostsFile /dev/null\nIdentityFile {}\nIdentitiesOnly yes\nIdentityAgent none\nUpdateHostKeys no\n",
                text(&known_hosts),
                text(&path("client_key")),
            ),
        )
        .unwrap();
        let real_ssh = Command::new("sh")
            .args(["-c", "command -v ssh"])
            .output()
            .expect("SSH qualification requires ssh");
        let real_ssh = String::from_utf8(real_ssh.stdout)
            .unwrap()
            .trim()
            .to_owned();
        assert!(!real_ssh.is_empty(), "SSH qualification requires ssh");
        let bin = path("bin");
        fs::create_dir(&bin).unwrap();
        fs::write(
            bin.join("ssh"),
            format!(
                "#!/bin/sh\nexec '{real_ssh}' -F '{}' \"$@\"\n",
                text(&path("ssh_config"))
            ),
        )
        .unwrap();
        run("chmod", &["755", &text(&bin.join("ssh"))]);
        let search = std::env::var_os("PATH").unwrap_or_default();
        let mut entries = vec![bin];
        entries.extend(std::env::split_paths(&search));
        // SAFETY: this integration-test binary contains a single test, so no other
        // thread reads the environment concurrently.
        unsafe { std::env::set_var("PATH", std::env::join_paths(entries).unwrap()) };

        let source = path("source");
        let remote = path("repo.git");
        let repository = path("client");
        for directory in [&source, &repository] {
            fs::create_dir(directory).unwrap();
            git(directory, &["init", "-q", "-b", "main"]);
            git(directory, &["config", "user.name", "Fixture"]);
            git(directory, &["config", "user.email", "fixture@example.test"]);
            git(directory, &["config", "commit.gpgsign", "false"]);
        }
        fs::write(source.join("file.txt"), b"fixture\n").unwrap();
        git(&source, &["add", "file.txt"]);
        git(&source, &["commit", "-q", "-m", "fixture"]);
        git(
            &source,
            &["clone", "-q", "--bare", &text(&source), &text(&remote)],
        );
        let login = std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .expect("SSH qualification requires USER");
        git(
            &repository,
            &[
                "remote",
                "add",
                "origin",
                &format!("ssh://{login}@127.0.0.1:{port}{}", text(&remote)),
            ],
        );
        let entry = |name: &str| {
            let public = fs::read_to_string(path(name)).unwrap();
            let key: Vec<&str> = public.split_whitespace().take(2).collect();
            format!("[127.0.0.1]:{port} {}\n", key.join(" "))
        };
        Self {
            host_key_line: entry("host_key.pub"),
            other_host_key_line: entry("other_host_key.pub"),
            directory,
            repository,
            remote,
            known_hosts,
            server,
        }
    }

    fn trust(&self, line: &str) {
        fs::write(&self.known_hosts, line).unwrap();
    }

    fn helper(&self) -> PathBuf {
        std::env::var_os("GIT_KHRONOS_PACKAGED_BINARY")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_git-khronos")))
    }

    fn fetch(
        &self,
        handler: Option<Arc<dyn Fn(PromptKind) -> Option<String> + Send + Sync>>,
    ) -> Result<(), AppError> {
        let cancellation = CancellationToken::default();
        with_authentication(&self.helper(), &cancellation, handler, || {
            fetch_cancellable(&self.repository, &cancellation)
        })
    }

    fn push(
        &self,
        handler: Option<Arc<dyn Fn(PromptKind) -> Option<String> + Send + Sync>>,
    ) -> Result<(), AppError> {
        let cancellation = CancellationToken::default();
        with_authentication(&self.helper(), &cancellation, handler, || {
            push_to_remote_cancellable(&self.repository, "origin", "main", &cancellation)
        })
    }
}

impl Drop for SshFixture {
    fn drop(&mut self) {
        let _ = self.server.kill();
        let _ = self.server.wait();
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn answering(
    secret: &'static str,
    prompts: Arc<AtomicU64>,
) -> Arc<dyn Fn(PromptKind) -> Option<String> + Send + Sync> {
    Arc::new(move |kind| {
        assert_eq!(
            kind,
            PromptKind::Secret,
            "SSH keys ask only for a passphrase"
        );
        prompts.fetch_add(1, Ordering::Relaxed);
        Some(secret.into())
    })
}

fn assert_safe_failure(error: &AppError, kind: &str) {
    assert_eq!(error.kind, kind, "{error:?}");
    for value in [&error.message, error.hint.as_ref().unwrap()] {
        assert!(!value.contains(PASSPHRASE));
    }
}

#[test]
#[ignore = "requires an OpenSSH sshd; set GIT_KHRONOS_SSHD"]
fn real_ssh_host_trust_passphrase_rejection_cancel_background_fetch_and_push() {
    let fixture = SshFixture::new();
    let never = || -> Arc<dyn Fn(PromptKind) -> Option<String> + Send + Sync> {
        Arc::new(|_| panic!("host trust must fail before any passphrase prompt"))
    };

    let failure = fixture.fetch(Some(never())).unwrap_err();
    assert_safe_failure(&failure, "sshHostTrustRequired");
    fixture.trust(&fixture.other_host_key_line);
    let failure = fixture.fetch(Some(never())).unwrap_err();
    assert_eq!(
        failure.kind, "sshHostTrustRequired",
        "a mismatched key is never accepted"
    );
    assert_eq!(
        fs::read_to_string(&fixture.known_hosts).unwrap(),
        fixture.other_host_key_line,
        "known_hosts is never rewritten"
    );
    fixture.trust(&fixture.host_key_line);

    let failure = fixture.fetch(None).unwrap_err();
    assert_safe_failure(&failure, "authenticationRequired");

    let prompts = Arc::new(AtomicU64::new(0));
    let failure = fixture
        .fetch(Some(answering("wrong-fixture-secret", prompts.clone())))
        .unwrap_err();
    assert_safe_failure(&failure, "authenticationRequired");
    assert!(
        prompts.load(Ordering::Relaxed) >= 1,
        "ssh must invoke the shipped askpass"
    );

    let cancellation = CancellationToken::default();
    let cancel = cancellation.clone();
    let failure = with_authentication(
        &fixture.helper(),
        &cancellation,
        Some(Arc::new(move |_| {
            cancel.cancel();
            None
        })),
        || fetch_cancellable(&fixture.repository, &cancellation),
    )
    .unwrap_err();
    assert_safe_failure(&failure, "operationCancelled");

    let prompts = Arc::new(AtomicU64::new(0));
    fixture
        .fetch(Some(answering(PASSPHRASE, prompts.clone())))
        .unwrap();
    assert_eq!(prompts.load(Ordering::Relaxed), 1);
    let fetched = git(
        &fixture.repository,
        &["rev-parse", "refs/remotes/origin/main"],
    );
    assert_eq!(fetched, git(&fixture.remote, &["rev-parse", "main"]));

    git(
        &fixture.repository,
        &["switch", "-q", "-c", "main", "origin/main"],
    );
    fs::write(fixture.repository.join("file.txt"), b"pushed over ssh\n").unwrap();
    git(&fixture.repository, &["commit", "-q", "-am", "ssh push"]);
    let local = git(&fixture.repository, &["rev-parse", "HEAD"]);
    let failure = fixture.push(None).unwrap_err();
    assert_safe_failure(&failure, "authenticationRequired");
    assert_ne!(git(&fixture.remote, &["rev-parse", "main"]), local);
    fixture
        .push(Some(answering(PASSPHRASE, Arc::new(AtomicU64::new(0)))))
        .unwrap();
    assert_eq!(git(&fixture.remote, &["rev-parse", "main"]), local);

    // Authentication can succeed before Git discovers divergent history. Keep
    // that rejection actionable instead of asking for the same credentials again.
    let source = fixture.directory.join("source");
    git(&source, &["fetch", fixture.remote.to_str().unwrap(), "main"]);
    git(&source, &["merge", "--ff-only", "FETCH_HEAD"]);
    fs::write(source.join("file.txt"), b"advanced remote\n").unwrap();
    git(&source, &["commit", "-q", "-am", "remote advance"]);
    git(&source, &["push", fixture.remote.to_str().unwrap(), "main"]);
    let remote = git(&fixture.remote, &["rev-parse", "main"]);
    fs::write(fixture.repository.join("file.txt"), b"divergent local\n").unwrap();
    git(&fixture.repository, &["commit", "-q", "-am", "local advance"]);
    let local = git(&fixture.repository, &["rev-parse", "HEAD"]);
    let index = fs::read(fixture.repository.join(".git/index")).unwrap();
    let prompts = Arc::new(AtomicU64::new(0));
    let failure = fixture
        .push(Some(answering(PASSPHRASE, prompts.clone())))
        .unwrap_err();
    assert!(
        prompts.load(Ordering::Relaxed) >= 1,
        "the rejected push must authenticate through the shipped askpass helper"
    );
    assert_safe_failure(&failure, "gitFailure");
    assert!(failure.message.contains("remote rejected"));
    assert!(failure.hint.unwrap().contains("Fetch and inspect"));
    assert_eq!(git(&fixture.remote, &["rev-parse", "main"]), remote);
    assert_eq!(git(&fixture.repository, &["rev-parse", "HEAD"]), local);
    assert_eq!(fs::read(fixture.repository.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read(fixture.repository.join("file.txt")).unwrap(),
        b"divergent local\n"
    );
}
