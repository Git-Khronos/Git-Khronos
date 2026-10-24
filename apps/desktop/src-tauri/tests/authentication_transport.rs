use git_khronos_git_core::authentication::{PromptKind, configure, with_authentication};
use git_khronos_git_core::{CancellationToken, fetch_cancellable};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

static NEXT: AtomicU64 = AtomicU64::new(0);

/// The askpass helper under test: the build's binary, or an installed/packaged
/// binary named by `GIT_KHRONOS_PACKAGED_BINARY` for packaged acceptance.
fn shipped_binary() -> PathBuf {
    std::env::var_os("GIT_KHRONOS_PACKAGED_BINARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_git-khronos")))
}

fn git(path: &Path, args: &[&str]) {
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
}

struct Fixture {
    directory: PathBuf,
    repository: PathBuf,
    reject: Arc<AtomicBool>,
    connections: Arc<AtomicU64>,
    stopped: Arc<AtomicBool>,
    server: Option<thread::JoinHandle<()>>,
    helper: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = std::env::current_dir()
            .unwrap()
            .join("target/authentication-fixtures")
            .join(format!(
                "{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir_all(&directory).unwrap();
        let source = directory.join("source");
        let repository = directory.join("client");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&repository).unwrap();
        git(&source, &["init", "-b", "main"]);
        git(&source, &["config", "user.name", "Fixture"]);
        git(&source, &["config", "user.email", "fixture@example.test"]);
        fs::write(source.join("file.txt"), "fixture\n").unwrap();
        git(&source, &["add", "file.txt"]);
        git(
            &source,
            &["-c", "commit.gpgsign=false", "commit", "-m", "fixture"],
        );
        let bare = directory.join("repo.git");
        git(
            &directory,
            &[
                "clone",
                "--bare",
                source.to_str().unwrap(),
                bare.to_str().unwrap(),
            ],
        );
        git(&bare, &["update-server-info"]);
        git(&repository, &["init", "-b", "main"]);
        git(&repository, &["config", "credential.helper", ""]);
        // Disable ambient credentials without changing process-global environment.
        git(&repository, &["config", "credential.useHttpPath", "true"]);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let remote = format!("http://{}/repo.git", listener.local_addr().unwrap());
        git(&repository, &["remote", "add", "origin", &remote]);
        let stopped = Arc::new(AtomicBool::new(false));
        let reject = Arc::new(AtomicBool::new(false));
        let stop = stopped.clone();
        let rejection = reject.clone();
        let connections = Arc::new(AtomicU64::new(0));
        let accepted_connections = connections.clone();
        let root = directory.clone();
        let server = thread::spawn(move || {
            while !stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        accepted_connections.fetch_add(1, Ordering::Relaxed);
                        serve(stream, &root, rejection.load(Ordering::Acquire));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });
        let helper = directory.join("shipped askpass executable");
        if fs::hard_link(shipped_binary(), &helper).is_err() {
            fs::copy(shipped_binary(), &helper).unwrap();
        }
        Self {
            directory,
            repository,
            reject,
            connections,
            stopped,
            server: Some(server),
            helper,
        }
    }

    fn fetch(
        &self,
        handler: Option<Arc<dyn Fn(PromptKind) -> Option<String> + Send + Sync>>,
    ) -> Result<(), git_khronos_git_core::AppError> {
        let cancellation = CancellationToken::default();
        with_authentication(&self.helper, &cancellation, handler, || {
            fetch_cancellable(&self.repository, &cancellation)
        })
    }

    fn lfs_endpoint(&self) -> String {
        let remote = Command::new("git")
            .arg("-C").arg(&self.repository)
            .args(["config", "--get", "remote.origin.url"])
            .output().unwrap();
        assert!(remote.status.success());
        format!("{}/info/lfs", String::from_utf8(remote.stdout).unwrap().trim())
    }

    fn locks(&self, path: &Path, interactive: bool) -> Result<git_khronos_git_core::LfsLocks, git_khronos_git_core::AppError> {
        let cancellation = CancellationToken::default();
        with_authentication(&self.helper, &cancellation, interactive.then(credentials), || {
            git_khronos_git_core::lfs_locks(path)
        })
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        if let Some(server) = self.server.take() {
            server.join().unwrap();
        }
        fs::remove_dir_all(&self.directory).unwrap();
    }
}

fn serve(mut stream: TcpStream, root: &Path, reject: bool) {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut request = Vec::new();
    let mut byte = [0];
    while request.len() < 32 * 1024 {
        if stream.read_exact(&mut byte).is_err() {
            return;
        }
        request.push(byte[0]);
        if request.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let request = String::from_utf8_lossy(&request);
    let body_length = request
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    if body_length > 32 * 1024 {
        return;
    }
    if stream.read_exact(&mut vec![0; body_length]).is_err() {
        return;
    }
    // user:fixture-secret (test-only, never a real credential).
    let authorized = !reject
        && request
            .to_ascii_lowercase()
            .contains("authorization: basic dxnlcjpmaxh0dxjllxnly3jlda==");
    let (status, headers, body) = if !authorized {
        (
            "401 Unauthorized",
            "WWW-Authenticate: Basic realm=\"fixture\"\r\n",
            b"Authentication required".to_vec(),
        )
    } else {
        let path = request
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap();
        let path = path.split('?').next().unwrap().trim_start_matches('/');
        if path.contains("..") {
            return;
        }
        if path == "repo.git/info/lfs/locks/verify" {
            (
                "200 OK",
                "Content-Type: application/vnd.git-lfs+json\r\n",
                br#"{"ours":[{"id":"fixture-lock","path":"locked.psd","owner":{"name":"Fixture"},"locked_at":"2026-10-24T10:00:00Z"}],"theirs":[]}"#.to_vec(),
            )
        } else {
            match fs::read(root.join(path)) {
                Ok(body) => ("200 OK", "Content-Type: application/octet-stream\r\n", body),
                Err(_) => ("404 Not Found", "", Vec::new()),
            }
        }
    };
    let response = format!(
        "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(&body);
}

fn credentials() -> Arc<dyn Fn(PromptKind) -> Option<String> + Send + Sync> {
    Arc::new(|kind| {
        Some(
            match kind {
                PromptKind::Username => "user",
                PromptKind::Secret => "fixture-secret",
            }
            .into(),
        )
    })
}

#[test]
fn shipped_helper_answers_ssh_passphrase_and_refuses_host_trust_prompts() {
    let cancellation = CancellationToken::default();
    with_authentication(
        &shipped_binary(),
        &cancellation,
        Some(credentials()),
        || {
            let mut command = Command::new(shipped_binary());
            command.arg("Enter passphrase for key '/fixture':");
            configure(&mut command);
            let output = command.output().unwrap();
            assert!(
                output.status.success(),
                "the shipped executable helper did not answer"
            );
            assert_eq!(output.stdout, b"fixture-secret\n");
            assert!(output.stderr.is_empty());
            let mut command = Command::new(shipped_binary());
            command.arg("Are you sure you want to continue connecting (yes/no/[fingerprint])?");
            configure(&mut command);
            let output = command.output().unwrap();
            assert!(!output.status.success());
            assert!(output.stdout.is_empty());
            Ok(())
        },
    )
    .unwrap();
}

#[test]
fn shipped_helper_fetches_private_http_and_git_helper_owns_persistence() {
    let fixture = Fixture::new();
    let store = fixture.directory.join("git-owned-credentials");
    // Configuration contains only a helper path, never a credential.
    git(
        &fixture.repository,
        &[
            "config",
            "--add",
            "credential.helper",
            &format!("store --file '{}'", store.display()),
        ],
    );
    fixture.fetch(Some(credentials())).unwrap();
    assert!(
        fs::read_to_string(&store)
            .unwrap()
            .contains("fixture-secret")
    );
    fixture
        .fetch(Some(Arc::new(|_| {
            panic!("Git should use its saved credential")
        })))
        .unwrap();
    git(
        &fixture.repository,
        &["rev-parse", "--verify", "refs/remotes/origin/main"],
    );
}

#[test]
fn background_failure_is_quiet_and_explicit_retry_succeeds() {
    let fixture = Fixture::new();
    let failure = fixture.fetch(None).unwrap_err();
    assert_eq!(failure.kind, "authenticationRequired");
    assert!(failure.hint.unwrap().contains("explicit Fetch"));
    fixture.fetch(Some(credentials())).unwrap();
}

#[test]
#[ignore = "requires Git LFS with locks --json; run with --ignored"]
fn lfs_lock_listing_uses_authenticated_json() {
    let fixture = Fixture::new();
    let cancellation = CancellationToken::default();
    let locks = with_authentication(
        &fixture.helper,
        &cancellation,
        Some(credentials()),
        || git_khronos_git_core::lfs_locks(&fixture.repository),
    )
    .unwrap();
    assert_eq!(
        locks.locks.len(),
        1,
        "A successful authenticated probe must not turn an earlier unauthenticated failure into an empty lock list"
    );
    assert_eq!(locks.locks[0].id, "fixture-lock");
    assert_eq!(locks.locks[0].path, "locked.psd");
    assert!(locks.locks[0].ours);

    let cancellation = CancellationToken::default();
    let error = with_authentication(&fixture.helper, &cancellation, None, || {
        git_khronos_git_core::lfs_locks(&fixture.repository)
    })
    .unwrap_err();
    assert_eq!(error.kind, "authenticationRequired");
    assert!(!error.message.contains("fixture-secret"));

    let cancellation = CancellationToken::default();
    let secret_attempts = AtomicU64::new(0);
    let corrected = with_authentication(
        &fixture.helper,
        &cancellation,
        Some(Arc::new(move |kind| {
            Some(match kind {
                PromptKind::Username => "user".into(),
                PromptKind::Secret if secret_attempts.fetch_add(1, Ordering::Relaxed) == 0 => {
                    "wrong-fixture-secret".into()
                }
                PromptKind::Secret => "fixture-secret".into(),
            })
        })),
        || git_khronos_git_core::lfs_locks(&fixture.repository),
    );
    match corrected {
        Ok(listed) => assert_eq!(listed.locks, locks.locks),
        Err(error) => assert_eq!(error.kind, "authenticationRequired"),
    }

    let cancellation = CancellationToken::default();
    let prompt_cancellation = cancellation.clone();
    let error = with_authentication(
        &fixture.helper,
        &cancellation,
        Some(Arc::new(move |_| {
            prompt_cancellation.cancel();
            None
        })),
        || git_khronos_git_core::lfs_locks(&fixture.repository),
    )
    .unwrap_err();
    assert_eq!(error.kind, "operationCancelled");

    let cancellation = CancellationToken::default();
    let retry = with_authentication(
        &fixture.helper,
        &cancellation,
        Some(credentials()),
        || git_khronos_git_core::lfs_locks(&fixture.repository),
    )
    .unwrap();
    assert_eq!(retry.locks, locks.locks);
}

#[test]
#[ignore = "requires Git LFS with locks --json; run with --ignored"]
fn lfs_endpoint_urls_refuse_embedded_credentials_before_transport() {
    for key in ["lfs.url", "lfs.pushurl", "remote.origin.lfsurl", "remote.origin.lfspushurl"] {
        for prefix in ["http://user:fixture-secret@", "http://user@", "ssh://user:fixture-secret@"] {
            let fixture = Fixture::new();
            let endpoint = fixture.lfs_endpoint().replacen("http://", prefix, 1);
            git(&fixture.repository, &["config", key, &endpoint]);
            let error = fixture.locks(&fixture.repository, false)
                .expect_err("Embedded endpoint credentials must not authenticate a lock request");
            assert_safe_failure(&error, "credentialsInUrl");
            assert_eq!(fixture.connections.load(Ordering::Relaxed), 0);
        }
    }
}

#[test]
#[ignore = "requires Git LFS with locks --json; run with --ignored"]
fn lfs_endpoint_file_sources_refuse_credentials_before_transport() {
    for source in ["worktree", "index", "head", "bare"] {
        for prefix in ["http://user:fixture-secret@", "ssh://user:fixture-secret@"] {
            let fixture = Fixture::new();
            let endpoint = fixture.lfs_endpoint().replacen("http://", prefix, 1);
            git(&fixture.repository, &["config", "user.name", "Fixture"]);
            git(&fixture.repository, &["config", "user.email", "fixture@example.test"]);
            git(&fixture.repository, &["config", "-f", ".lfsconfig", "lfs.url", &endpoint]);
            let mut path = fixture.repository.clone();
            if source != "worktree" {
                git(&path, &["add", ".lfsconfig"]);
                if source != "index" {
                    git(&path, &["-c", "commit.gpgsign=false", "commit", "-m", "Owned LFS configuration"]);
                    git(&path, &["update-index", "--force-remove", "--", ".lfsconfig"]);
                }
                fs::remove_file(path.join(".lfsconfig")).unwrap();
                if source == "bare" {
                    let bare = fixture.directory.join("bare-client.git");
                    git(&fixture.directory, &["clone", "--bare", path.to_str().unwrap(), bare.to_str().unwrap()]);
                    path = git_khronos_git_core::resolve_repository(&bare).unwrap();
                }
            }
            let error = fixture.locks(&path, false).expect_err("A file-sourced credential URL must be refused");
            assert_safe_failure(&error, "credentialsInUrl");
            assert_eq!(fixture.connections.load(Ordering::Relaxed), 0, "{source}");
        }
    }
}

#[test]
#[ignore = "requires Git LFS with locks --json; run with --ignored"]
fn lfs_endpoint_overrides_preserve_safe_effective_configuration() {
    let fixture = Fixture::new();
    let safe = fixture.lfs_endpoint();
    let unsafe_url = safe.replacen("http://", "http://user:fixture-secret@", 1);
    git(&fixture.repository, &["config", "user.name", "Fixture"]);
    git(&fixture.repository, &["config", "user.email", "fixture@example.test"]);
    git(&fixture.repository, &["config", "-f", ".lfsconfig", "lfs.url", &unsafe_url]);
    git(&fixture.repository, &["add", ".lfsconfig"]);
    git(&fixture.repository, &["-c", "commit.gpgsign=false", "commit", "-m", "Owned LFS configuration"]);
    // Working configuration overrides the index/HEAD copy.
    git(&fixture.repository, &["config", "-f", ".lfsconfig", "lfs.url", &safe]);
    assert_eq!(fixture.locks(&fixture.repository, true).unwrap().locks.len(), 1);
    // An index copy overrides HEAD when the working file is absent.
    git(&fixture.repository, &["add", ".lfsconfig"]);
    fs::remove_file(fixture.repository.join(".lfsconfig")).unwrap();
    assert_eq!(fixture.locks(&fixture.repository, true).unwrap().locks.len(), 1);
    // Ordinary config overrides the selected file; its last value wins too.
    git(&fixture.repository, &["config", "--add", "lfs.url", &unsafe_url]);
    git(&fixture.repository, &["config", "--add", "lfs.url", &safe]);
    git(&fixture.repository, &["config", "-f", ".lfsconfig", "lfs.url", &unsafe_url]);
    let index = fs::read(fixture.repository.join(".git/index")).unwrap();
    let config = fs::read(fixture.repository.join(".git/config")).unwrap();
    let file = fs::read(fixture.repository.join(".lfsconfig")).unwrap();
    assert_eq!(fixture.locks(&fixture.repository, true).unwrap().locks.len(), 1);
    assert_eq!(fs::read(fixture.repository.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(fixture.repository.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(fixture.repository.join(".lfsconfig")).unwrap(), file);
}

#[cfg(unix)]
#[test]
#[ignore = "requires Git LFS with locks --json; run with --ignored"]
fn lfs_endpoint_review_preserves_literal_repository_path_bytes() {
    use std::os::unix::ffi::OsStringExt;
    for suffix in [b"space newline\n tab\t unicode-\xce\xbb".to_vec(), b"non-utf8-\xff".to_vec()] {
        let mut fixture = Fixture::new();
        let renamed = fixture.directory.join(std::ffi::OsString::from_vec(suffix));
        fs::rename(&fixture.repository, &renamed).unwrap();
        fixture.repository = renamed;
        let endpoint = fixture.lfs_endpoint().replacen("http://", "http://user:fixture-secret@", 1);
        git(&fixture.repository, &["config", "-f", ".lfsconfig", "lfs.url", &endpoint]);
        let error = fixture.locks(&fixture.repository, false).unwrap_err();
        assert_safe_failure(&error, "credentialsInUrl");
        assert_eq!(fixture.connections.load(Ordering::Relaxed), 0);
    }
}

#[test]
#[ignore = "requires Git LFS with locks --json; run with --ignored"]
fn lfs_endpoint_invalid_or_oversized_file_is_not_a_safe_configuration() {
    for oversized in [false, true] {
        let fixture = Fixture::new();
        let contents = if oversized {
            format!("[lfs]\nurl = {}/{}\n", fixture.lfs_endpoint(), "a".repeat(600 * 1024))
        } else {
            "[lfs\nurl = invalid-fixture-config\n".into()
        };
        fs::write(fixture.repository.join(".lfsconfig"), contents).unwrap();
        let error = fixture.locks(&fixture.repository, false).unwrap_err();
        assert_safe_failure(&error, "remoteConfigurationUnavailable");
        assert_eq!(fixture.connections.load(Ordering::Relaxed), 0);
    }
}

#[test]
#[ignore = "requires Git LFS with locks --json; run with --ignored"]
fn lfs_endpoint_ordinary_configuration_capture_stays_bounded_before_transport() {
    let fixture = Fixture::new();
    let endpoint = fixture.lfs_endpoint();
    git(&fixture.repository, &["config", "lfs.url", &endpoint]);
    assert_eq!(fixture.locks(&fixture.repository, true).unwrap().locks.len(), 1);
    let connections = fixture.connections.load(Ordering::Relaxed);
    let config_path = fixture.repository.join(".git/config");
    let mut contents = fs::read(&config_path).unwrap();
    let record = format!("\n[lfs]\nurl = {endpoint}\n");
    while contents.len() < 600 * 1024 {
        contents.extend_from_slice(record.as_bytes());
    }
    // Every repeated value is safe and identical: this exercises the size of
    // Git's complete configuration output, not a huge URL or an unsafe server.
    fs::write(&config_path, &contents).unwrap();
    let index_path = fixture.repository.join(".git/index");
    let index = index_path.try_exists().unwrap().then(|| fs::read(&index_path).unwrap());
    let error = fixture.locks(&fixture.repository, true)
        .expect_err("Oversized ordinary configuration must be refused before opening transport");
    assert_safe_failure(&error, "remoteConfigurationUnavailable");
    assert_eq!(fixture.connections.load(Ordering::Relaxed), connections);
    assert_eq!(fs::read(&config_path).unwrap(), contents);
    if let Some(index) = index {
        assert_eq!(fs::read(&index_path).unwrap(), index);
    } else {
        assert!(!index_path.try_exists().unwrap());
    }
}

#[test]
fn refuses_embedded_remote_credentials_without_logging_them() {
    let fixture = Fixture::new();
    git(
        &fixture.repository,
        &[
            "remote",
            "set-url",
            "origin",
            "https://user:fixture-secret@example.test/repo.git",
        ],
    );
    let failure = fixture
        .fetch(Some(Arc::new(|_| panic!("must not prompt"))))
        .unwrap_err();
    assert_eq!(failure.kind, "credentialsInUrl");
    assert!(!failure.message.contains("fixture-secret"));
    assert!(!failure.hint.unwrap().contains("fixture-secret"));
}

#[test]
fn rejection_and_cancellation_release_the_operation_for_retry() {
    let fixture = Fixture::new();
    fixture.reject.store(true, Ordering::Release);
    let failure = fixture.fetch(Some(credentials())).unwrap_err();
    assert_eq!(failure.kind, "authenticationRequired");
    assert!(!failure.message.contains("fixture-secret"));
    fixture.reject.store(false, Ordering::Release);
    let cancellation = CancellationToken::default();
    let cancel = cancellation.clone();
    let failure = with_authentication(
        &shipped_binary(),
        &cancellation,
        Some(Arc::new(move |_| {
            cancel.cancel();
            None
        })),
        || fetch_cancellable(&fixture.repository, &cancellation),
    )
    .unwrap_err();
    assert_eq!(failure.kind, "operationCancelled");
    fixture.fetch(Some(credentials())).unwrap();
}

struct HttpsFixture {
    fixture: Fixture,
    server: Child,
}

impl HttpsFixture {
    fn new() -> Self {
        let fixture = Fixture::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&fixture.directory, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let certificate = fixture.directory.join("certificate.pem");
        let key = fixture.directory.join("private-key.pem");
        let output = Command::new("openssl")
            .args([
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=Git Khronos loopback fixture",
                "-addext",
                "subjectAltName=IP:127.0.0.1",
                "-addext",
                "basicConstraints=critical,CA:TRUE",
                "-keyout",
            ])
            .arg(&key)
            .arg("-out")
            .arg(&certificate)
            .output()
            .expect("HTTPS qualification requires openssl already installed");
        assert!(
            output.status.success(),
            "fixture certificate generation failed"
        );
        let output = Command::new("git").arg("--exec-path").output().unwrap();
        assert!(output.status.success());
        let backend = PathBuf::from(String::from_utf8(output.stdout).unwrap().trim())
            .join("git-http-backend");
        assert!(
            backend.is_file(),
            "HTTPS qualification requires git-http-backend"
        );
        let script =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/https_git_server.py");
        let mut server = Command::new("python3")
            .arg(script)
            .arg(&fixture.directory)
            .arg(backend)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("HTTPS qualification requires Python stdlib SSL support");
        let mut port = String::new();
        BufReader::new(server.stdout.take().unwrap())
            .read_line(&mut port)
            .unwrap();
        if port.trim().parse::<u16>().is_err() {
            let _ = server.kill();
            let _ = server.wait();
            panic!("loopback HTTPS smart-Git server did not start");
        }
        let fixture = Self { fixture, server };
        let repository = &fixture.fixture.repository;
        git(
            repository,
            &[
                "remote",
                "set-url",
                "origin",
                &format!("https://127.0.0.1:{}/repo.git", port.trim()),
            ],
        );
        git(
            repository,
            &["config", "http.sslCAInfo", certificate.to_str().unwrap()],
        );
        git(repository, &["config", "http.sslVerify", "true"]);
        git(repository, &["config", "http.proxy", ""]);
        fixture
    }

    fn reject(&self, reject: bool) {
        let path = self.fixture.directory.join("reject-https");
        if reject {
            fs::write(path, b"reject").unwrap();
        } else {
            fs::remove_file(path).unwrap();
        }
    }
}

impl Drop for HttpsFixture {
    fn drop(&mut self) {
        let _ = self.server.kill();
        let _ = self.server.wait();
    }
}

fn assert_safe_failure(error: &git_khronos_git_core::AppError, kind: &str) {
    assert_eq!(error.kind, kind);
    for value in [&error.message, error.hint.as_ref().unwrap()] {
        assert!(!value.contains("fixture-secret"));
        assert!(!value.contains("wrong-fixture-secret"));
        assert!(!value.contains("dXNlcjpmaXh0dXJlLXNlY3JldA=="));
    }
}

#[test]
fn missing_local_remotes_with_tls_words_are_not_certificate_failures() {
    let fixture = Fixture::new();
    for name in ["certificate-assets.git", "ssl-assets.git", "SSL certificate problem.git"] {
        let missing = fixture.directory.join(name);
        assert!(!missing.exists());
        git(&fixture.repository, &["remote", "set-url", "origin", missing.to_str().unwrap()]);
        let failure = fixture.fetch(Some(Arc::new(|_| {
            panic!("A missing local repository must not request credentials")
        }))).unwrap_err();
        assert_safe_failure(&failure, "gitTransportFailure");
        assert!(failure.message.contains("transport failed"));
        assert!(!missing.exists());
        assert!(!fixture.repository.join(".git/refs/remotes/origin/main").exists());
    }
}

#[test]
fn quoted_targets_in_missing_local_remotes_do_not_impersonate_transport_failures() {
    let fixture = Fixture::new();
    for name in [
        "authentication failed.git",
        "Host key verification failed.git",
        "[rejected].git",
        "authentication failed' quoted.git",
    ] {
        let missing = fixture.directory.join(name);
        assert!(!missing.exists());
        git(&fixture.repository, &["remote", "set-url", "origin", missing.to_str().unwrap()]);
        let failure = fixture.fetch(Some(Arc::new(|_| {
            panic!("A missing local repository must not request credentials")
        }))).unwrap_err();
        assert_safe_failure(&failure, "gitTransportFailure");
        assert!(!missing.exists());
        assert!(!fixture.repository.join(".git/refs/remotes/origin/main").exists());
    }
}

#[test]
fn real_https_smart_git_authentication_rejection_retry_cancel_and_background() {
    let fixture = HttpsFixture::new();
    git(
        &fixture.fixture.repository,
        &["config", "--unset", "http.sslCAInfo"],
    );
    let tls_probe = Command::new("git")
        .arg("-C")
        .arg(&fixture.fixture.repository)
        .args(["ls-remote", "origin"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        .env("SSH_ASKPASS", "")
        .env("LC_ALL", "C")
        .output()
        .unwrap();
    assert!(!tls_probe.status.success(), "The untrusted TLS fixture unexpectedly succeeded");
    let failure = fixture
        .fixture
        .fetch(Some(Arc::new(|_| {
            panic!("TLS verification must fail before asking for a credential")
        })))
        .unwrap_err();
    assert_eq!(failure.kind, "tlsVerificationFailed", "Owned TLS fixture diagnostic: {}", String::from_utf8_lossy(&tls_probe.stderr));
    assert_safe_failure(&failure, "tlsVerificationFailed");
    git(
        &fixture.fixture.repository,
        &[
            "config",
            "http.sslCAInfo",
            fixture
                .fixture
                .directory
                .join("certificate.pem")
                .to_str()
                .unwrap(),
        ],
    );
    let failure = fixture.fixture.fetch(None).unwrap_err();
    assert_safe_failure(&failure, "authenticationRequired");
    assert!(failure.hint.unwrap().contains("explicit Fetch"));
    assert!(!fixture.fixture.directory.join("smart-requests").exists());

    let prompts = Arc::new(AtomicU64::new(0));
    let count = prompts.clone();
    let failure = fixture
        .fixture
        .fetch(Some(Arc::new(move |kind| {
            count.fetch_add(1, Ordering::Relaxed);
            Some(
                match kind {
                    PromptKind::Username => "user",
                    PromptKind::Secret => "wrong-fixture-secret",
                }
                .into(),
            )
        })))
        .unwrap_err();
    assert_safe_failure(&failure, "authenticationRequired");
    assert!(
        prompts.load(Ordering::Relaxed) >= 2,
        "HTTPS must actually invoke shipped askpass"
    );

    fixture.fixture.fetch(Some(credentials())).unwrap();
    git(
        &fixture.fixture.repository,
        &["rev-parse", "--verify", "refs/remotes/origin/main"],
    );
    let requests = fs::read_to_string(fixture.fixture.directory.join("smart-requests")).unwrap();
    assert!(requests.contains("GET /repo.git/info/refs 200"));
    assert!(
        requests.contains("POST /repo.git/git-upload-pack 200"),
        "fetch must use smart Git negotiation, not dumb file serving"
    );

    fixture.reject(true);
    let failure = fixture.fixture.fetch(Some(credentials())).unwrap_err();
    assert_safe_failure(&failure, "authenticationRequired");
    fixture.reject(false);
    let cancellation = CancellationToken::default();
    let cancel = cancellation.clone();
    let failure = with_authentication(
        &fixture.fixture.helper,
        &cancellation,
        Some(Arc::new(move |_| {
            cancel.cancel();
            None
        })),
        || fetch_cancellable(&fixture.fixture.repository, &cancellation),
    )
    .unwrap_err();
    assert_safe_failure(&failure, "operationCancelled");
    fixture.fixture.fetch(Some(credentials())).unwrap();
    let failure = fixture.fixture.fetch(None).unwrap_err();
    assert_safe_failure(&failure, "authenticationRequired");

    let store = fixture
        .fixture
        .directory
        .join("https-git-owned-credentials");
    git(
        &fixture.fixture.repository,
        &[
            "config",
            "--add",
            "credential.helper",
            &format!("store --file '{}'", store.display()),
        ],
    );
    fixture.fixture.fetch(Some(credentials())).unwrap();
    assert!(
        fs::read_to_string(store)
            .unwrap()
            .contains("fixture-secret")
    );
    fixture.fixture.fetch(None).unwrap();
}
