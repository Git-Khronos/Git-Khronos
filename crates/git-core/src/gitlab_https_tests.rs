use super::*;

#[test]
fn gitlab_https_endpoint_allowlist_refuses_arbitrary_routes_and_query_reinterpretation() {
    let instance = GitLabInstance::parse("https://gitlab.example.test:8443").unwrap();
    assert_eq!(
        endpoint_url(&instance, "user").unwrap().as_str(),
        "https://gitlab.example.test:8443/api/v4/user"
    );
    let base = "projects?per_page=20&page=1&order_by=id&sort=asc";
    assert!(endpoint_url(&instance, base).is_ok());
    assert!(
        endpoint_url(
            &instance,
            &format!("{base}&search=caf%C3%A9+%26+old%2Ffeature")
        )
        .is_ok()
    );
    for bad in [
        "https://other.test/user",
        "//other.test/user",
        "../user",
        "user?token=other",
        "graphql",
        "projects?per_page=100",
        "projects?per_page=20&page=01&order_by=id&sort=asc",
    ] {
        assert!(endpoint_url(&instance, bad).is_err(), "{bad}");
    }
    for suffix in [
        "&page=2",
        "&unknown=true",
        "&search=%00",
        "#ignored",
        "&membership=false",
        "&archived=true",
    ] {
        assert!(
            endpoint_url(&instance, &format!("{base}{suffix}")).is_err(),
            "{suffix}"
        );
    }
}

#[test]
fn gitlab_https_transport_can_be_released_from_async_application_teardown() {
    let transport = GitLabHttpsTransport::new(
        GitLabInstance::parse("https://gitlab.example.test").unwrap(),
        "owned-api-fixture-token",
    )
    .unwrap();
    let outer = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    outer.block_on(async move {
        drop(transport);
    });
}

#[test]
fn gitlab_https_invalid_credentials_are_refused_without_network_or_echo() {
    for credential in [
        "",
        "owned-api-fixture-token\n",
        "with space",
        "\0",
        &"x".repeat(8193),
    ] {
        let result = GitLabHttpsTransport::new(
            GitLabInstance::parse("https://example.test").unwrap(),
            credential,
        );
        let error = match result {
            Ok(_) => panic!("invalid credential accepted"),
            Err(error) => error,
        };
        assert!(!error.message.contains("owned-api-fixture-token"));
    }
}

#[cfg(unix)]
mod tls {
    use super::*;
    use std::os::unix::fs::DirBuilderExt;
    use std::{
        fs,
        io::{BufRead, BufReader},
        path::PathBuf,
        process::{Child, Command, Stdio},
        time::Instant,
    };

    struct Fixture {
        root: PathBuf,
        child: Child,
        instance: GitLabInstance,
    }
    impl Fixture {
        fn new() -> Self {
            let mut random = [0; 16];
            getrandom::fill(&mut random).unwrap();
            let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
            let root = std::env::temp_dir().join(format!("git-khronos-gitlab-https-{suffix}"));
            fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            fs::write(root.join("mode"), "normal").unwrap();
            fs::write(
                root.join("fixture.py"),
                include_str!("gitlab_https_fixture.py"),
            )
            .unwrap();
            let mut command = Command::new("python3");
            command
                .arg(root.join("fixture.py"))
                .arg(&root)
                .current_dir(&root)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            // The fixture creates its own certificate and never reads host credentials.
            for name in crate::GIT_CONTEXT_ENVIRONMENT_VARIABLES {
                command.env_remove(name);
            }
            let child = command.spawn().unwrap();
            let mut fixture = Self {
                root,
                child,
                instance: GitLabInstance::parse("https://placeholder.test").unwrap(),
            };
            let stdout = fixture.child.stdout.take().unwrap();
            let (sender, receiver) = std::sync::mpsc::channel();
            let reader = std::thread::spawn(move || {
                let mut line = String::new();
                let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
                let _ = sender.send(result);
            });
            let line = receiver
                .recv_timeout(Duration::from_secs(10))
                .expect("owned HTTPS fixture startup deadline")
                .unwrap();
            reader.join().unwrap();
            let ready: Value = serde_json::from_str(&line).unwrap();
            fixture.instance = GitLabInstance::parse(ready["origin"].as_str().unwrap()).unwrap();
            fixture
        }
        fn transport(&self) -> GitLabHttpsTransport {
            let certificate = reqwest::Certificate::from_pem(
                &fs::read(self.root.join("certificate.pem")).unwrap(),
            )
            .unwrap();
            GitLabHttpsTransport::build(
                self.instance.clone(),
                "owned-api-fixture-token",
                Some(certificate),
            )
            .unwrap()
        }
        fn mode(&self, mode: &str) {
            fs::write(self.root.join("mode"), mode).unwrap();
        }
        fn requests(&self) -> Vec<Value> {
            fs::read_to_string(self.root.join("requests.jsonl"))
                .unwrap_or_default()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        }
        fn read(&self, transport: &mut GitLabHttpsTransport) -> Result<Value, AppError> {
            transport.get(&self.instance, "user", &CancellationToken::default())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn gitlab_https_reads_a_real_verified_tls_account_and_normalized_project_page() {
        let fixture = Fixture::new();
        let page = crate::load_gitlab_project_page_with(
            &mut fixture.transport(),
            &fixture.instance,
            Default::default(),
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(page.account.id, "41");
        assert_eq!(page.entries[0].full_path, "team/subgroup/owned-project");
        assert!(
            !serde_json::to_string(&page)
                .unwrap()
                .contains("owned-not-exported-marker")
        );
        let requests = fixture.requests();
        assert_eq!(requests.len(), 3);
        assert!(
            requests
                .iter()
                .all(|request| request["credentialMatched"] == true
                    && request["destination"] == false)
        );
    }

    #[test]
    fn gitlab_https_refuses_untrusted_certificates_without_sending_a_credential() {
        let fixture = Fixture::new();
        let mut transport =
            GitLabHttpsTransport::new(fixture.instance.clone(), "owned-api-fixture-token").unwrap();
        assert_eq!(
            fixture.read(&mut transport).unwrap_err().kind,
            "gitlabConnection"
        );
        assert!(fixture.requests().is_empty());
    }

    #[test]
    fn gitlab_https_all_redirect_variants_stop_before_other_origin_receives_a_request() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        for status in [301, 302, 303, 307, 308] {
            fixture.mode(&format!("redirect-{status}"));
            assert_eq!(
                fixture.read(&mut transport).unwrap_err().kind,
                "gitlabRedirect"
            );
        }
        let requests = fixture.requests();
        assert_eq!(requests.len(), 5);
        assert!(
            requests
                .iter()
                .all(|request| request["destination"] == false)
        );
    }

    #[test]
    fn gitlab_https_bounds_declared_and_streamed_bodies_and_refuses_invalid_json() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        for mode in ["declared-large", "streamed-large", "malformed"] {
            fixture.mode(mode);
            assert_eq!(
                fixture.read(&mut transport).unwrap_err().kind,
                "gitlabDiscoveryResponse"
            );
        }
    }

    #[test]
    fn gitlab_https_accepts_valid_json_at_the_exact_response_budget() {
        let fixture = Fixture::new();
        fixture.mode("exact-boundary");
        let result = fixture.read(&mut fixture.transport()).unwrap();
        assert_eq!(result.as_str().unwrap().len(), RESPONSE_LIMIT - 2);
    }

    #[test]
    fn gitlab_https_status_errors_never_echo_upstream_diagnostics_or_credentials() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        for (status, expected) in [
            (401, "gitlabAuthentication"),
            (403, "gitlabPermission"),
            (429, "gitlabRateLimit"),
            (503, "gitlabUnavailable"),
            (404, "gitlabReadRefused"),
        ] {
            fixture.mode(&format!("status-{status}"));
            let error = fixture.read(&mut transport).unwrap_err();
            assert_eq!(error.kind, expected);
            let encoded = serde_json::to_string(&error).unwrap();
            assert!(!encoded.contains("owned-api-fixture-token"));
            assert!(!encoded.contains("owned-upstream-diagnostic"));
        }
    }

    #[test]
    fn gitlab_https_cancelled_and_cross_instance_requests_do_not_send_credentials() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        assert_eq!(
            transport
                .get(&fixture.instance, "user", &cancellation)
                .unwrap_err()
                .kind,
            "operationCancelled"
        );
        let other = GitLabInstance::parse("https://other.example.test").unwrap();
        assert_eq!(
            transport
                .get(&other, "user", &CancellationToken::default())
                .unwrap_err()
                .kind,
            "gitlabDiscoveryRequest"
        );
        assert!(fixture.requests().is_empty());
    }

    #[test]
    fn gitlab_https_stalled_read_times_out_with_an_original_bounded_error() {
        let fixture = Fixture::new();
        fixture.mode("stalled");
        let started = Instant::now();
        let error = fixture.read(&mut fixture.transport()).unwrap_err();
        assert_eq!(error.kind, "gitlabTimeout");
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(
            !serde_json::to_string(&error)
                .unwrap()
                .contains("owned-api-fixture-token")
        );
    }

    #[test]
    fn gitlab_https_cancellation_drops_a_stalled_body_before_network_deadlines() {
        let fixture = Fixture::new();
        fixture.mode("stalled");
        let mut transport = fixture.transport();
        let cancellation = CancellationToken::default();
        let worker_token = cancellation.clone();
        let instance = fixture.instance.clone();
        let worker = std::thread::spawn(move || transport.get(&instance, "user", &worker_token));
        let deadline = Instant::now() + Duration::from_secs(3);
        while fixture.requests().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            !fixture.requests().is_empty(),
            "request did not reach owned fixture"
        );
        let started = Instant::now();
        cancellation.cancel();
        assert_eq!(
            worker.join().unwrap().unwrap_err().kind,
            "operationCancelled"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
