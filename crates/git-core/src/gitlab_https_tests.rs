use super::*;

#[test]
fn gitlab_https_encoded_project_lookup_keeps_one_closed_component_and_no_query_aliases() {
    let instance = GitLabInstance::parse("https://gitlab.example.test:8443").unwrap();
    assert_eq!(
        endpoint_url(&instance, "projects/team%2Fnested%2Fproject_name")
            .unwrap()
            .as_str(),
        "https://gitlab.example.test:8443/api/v4/projects/team%2Fnested%2Fproject_name"
    );
    for bad in [
        "projects/team%2fnested%2fproject",
        "projects/team%2Fproject?statistics=true",
        "projects/team%252Fproject",
        "projects/team%2F..%2Fuser",
        "projects/team%2Fproject/forks",
        "projects/%74eam%2Fproject",
    ] {
        assert!(endpoint_url(&instance, bad).is_err(), "{bad}");
    }
}

#[test]
fn gitlab_https_endpoint_allowlist_refuses_arbitrary_routes_and_query_reinterpretation() {
    let instance = GitLabInstance::parse("https://gitlab.example.test:8443").unwrap();
    assert_eq!(
        endpoint_url(&instance, "user").unwrap().as_str(),
        "https://gitlab.example.test:8443/api/v4/user"
    );
    let base = "projects?per_page=20&page=1&order_by=id&sort=asc";
    assert!(endpoint_url(&instance, base).is_ok());
    assert_eq!(
        endpoint_url(&instance, "projects/18446744073709551615")
            .unwrap()
            .as_str(),
        "https://gitlab.example.test:8443/api/v4/projects/18446744073709551615"
    );
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
        "projects/0",
        "projects/01",
        "projects/18446744073709551616",
        "projects/1?token=other",
        "projects/1/repository",
        "projects/1#fragment",
        "projects/%31",
        "projects/../user",
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
        fn writer(&self) -> GitLabForkHttpsTransport {
            GitLabForkHttpsTransport::with_root(
                self.instance.clone(),
                "owned-api-fixture-token",
                reqwest::Certificate::from_pem(
                    &fs::read(self.root.join("certificate.pem")).unwrap(),
                )
                .unwrap(),
            )
            .unwrap()
        }
        fn mark_dispatch(&self) -> Result<(), AppError> {
            fs::write(self.root.join("dispatch-marker"), "owned-dispatch-callback").unwrap();
            Ok(())
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

    fn fork_account(fixture: &Fixture) -> crate::GitLabAccount {
        crate::GitLabAccount {
            origin: fixture.instance.origin().into(),
            id: "41".into(),
            login: "owned-reader".into(),
        }
    }

    fn fork_request() -> crate::GitLabForkDispatch {
        crate::GitLabForkDispatch::new(
            "101",
            "9007199254740993",
            "reviewed-project",
            Some("Reviewed project"),
        )
        .unwrap()
    }
    fn fork_error(result: Result<crate::GitLabForkPostReply, AppError>) -> AppError {
        match result {
            Err(error) => error,
            Ok(_) => panic!("Expected owned fork request failure"),
        }
    }

    #[cfg(target_os = "linux")]
    fn journal_record(fixture: &Fixture, id: &str) -> crate::GitLabForkRecord {
        crate::GitLabForkRecord::new(
            id.repeat(32),
            crate::GitLabForkIntent {
                origin: fixture.instance.origin().into(),
                account_id: "41".into(),
                account_login: "owned-reader".into(),
                source_id: "101".into(),
                source_full_path: "team/subgroup/owned-project".into(),
                source_empty: None,
                namespace_id: "9007199254740993".into(),
                namespace_full_path: "owned-reader".into(),
                namespace_kind: crate::GitLabNamespaceKind::User,
                project_path: "reviewed-project".into(),
                project_name: Some("Reviewed project".into()),
            },
            "1793580000000".into(),
        )
        .unwrap()
    }

    #[cfg(target_os = "linux")]
    fn reconciliation_resources(fixture: &Fixture) {
        let namespace = serde_json::json!({"id":9007199254740993u64,"name":"Owned reader","path":"owned-reader","full_path":"owned-reader","kind":"user"});
        let project = serde_json::json!({"id":202,"name":"Reviewed project","path_with_namespace":"owned-reader/reviewed-project","web_url":format!("{}/owned-reader/reviewed-project",fixture.instance.origin()),"description":null,"default_branch":"main","visibility":"private","archived":false,"empty_repo":false,"import_status":"finished","namespace":namespace.clone(),"forked_from_project":{"id":101,"path_with_namespace":"team/subgroup/owned-project"},"private_token":"owned-not-exported-marker"});
        fs::write(
            fixture.root.join("fork-resources.json"),
            serde_json::to_vec(&serde_json::json!({
                "/api/v4/namespaces/9007199254740993":namespace,
                "/api/v4/projects/owned-reader%2Freviewed-project":project,
            }))
            .unwrap(),
        )
        .unwrap();
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn gitlab_https_reconciliation_uses_exact_encoded_destination_and_only_verified_gets() {
        let fixture = Fixture::new();
        reconciliation_resources(&fixture);
        let next = crate::reconcile_gitlab_fork_with(
            &mut fixture.transport(),
            &fixture.instance,
            &fork_account(&fixture),
            &journal_record(&fixture, "a"),
            "1793580000001",
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(next.phase, crate::GitLabForkPhase::MetadataVerified);
        assert_eq!(next.project_id.as_deref(), Some("202"));
        let requests = fixture.requests();
        assert_eq!(requests.len(), 5);
        assert_eq!(
            requests[3]["path"],
            "/api/v4/projects/owned-reader%2Freviewed-project"
        );
        assert!(requests.iter().all(|r| r["method"] == "GET"
            && r["credentialMatched"] == true
            && r["destination"] == false));
        assert!(!fixture.root.join("dispatch-marker").exists());
        assert!(
            !serde_json::to_string(&next)
                .unwrap()
                .contains("owned-not-exported-marker")
        );
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn gitlab_https_reconciliation_404_preserves_known_id_and_never_falls_back_or_posts() {
        let fixture = Fixture::new();
        reconciliation_resources(&fixture);
        fs::write(
            fixture.root.join("read-status.json"),
            r#"{"/api/v4/projects/202":404}"#,
        )
        .unwrap();
        let known = journal_record(&fixture, "a")
            .observe_verified(
                "202",
                crate::GitLabForkImportState::Finished,
                Some(false),
                "1793580000000",
            )
            .unwrap();
        let next = crate::reconcile_gitlab_fork_with(
            &mut fixture.transport(),
            &fixture.instance,
            &fork_account(&fixture),
            &known,
            "1793580000001",
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(next.phase, crate::GitLabForkPhase::AcceptedPending);
        assert_eq!(next.project_id.as_deref(), Some("202"));
        let requests = fixture.requests();
        assert_eq!(requests.len(), 4);
        assert_eq!(requests[3]["path"], "/api/v4/projects/202");
        assert!(requests.iter().all(|r| r["method"] == "GET"));
        assert!(
            !serde_json::to_string(&next)
                .unwrap()
                .contains("owned-upstream-diagnostic")
        );
    }
    #[test]
    fn gitlab_https_encoded_project_lookup_never_redirects_or_uses_another_instance() {
        let fixture = Fixture::new();
        let mut reader = fixture.transport();
        let endpoint = "projects/team%2Fnested%2Fproject_name";
        for status in [301, 302, 303, 307, 308] {
            fixture.mode(&format!("redirect-{status}"));
            assert_eq!(
                reader
                    .get(&fixture.instance, endpoint, &CancellationToken::default())
                    .unwrap_err()
                    .kind,
                "gitlabRedirect"
            );
        }
        let cancelled = CancellationToken::default();
        cancelled.cancel();
        assert!(reader.get(&fixture.instance, endpoint, &cancelled).is_err());
        assert!(
            reader
                .get(
                    &GitLabInstance::parse("https://other.example.test").unwrap(),
                    endpoint,
                    &CancellationToken::default()
                )
                .is_err()
        );
        let requests = fixture.requests();
        assert_eq!(requests.len(), 5);
        assert!(requests.iter().all(|r| r["method"] == "GET"
            && r["destination"] == false
            && r["credentialMatched"] == true));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn gitlab_https_fork_lost_reply_keeps_real_durable_record_and_restart_does_not_replay_post() {
        use crate::GitLabForkWriteTransport;
        use std::os::unix::fs::MetadataExt;
        let fixture = Fixture::new();
        fixture.mode("disconnect");
        let path = fixture.root.join("fork-journal");
        let uid = fs::metadata(&fixture.root).unwrap().uid();
        let journal = crate::GitLabForkJournal::open(&path, uid).unwrap();
        let record = journal_record(&fixture, "a");
        let mut writer = fixture.writer();
        let mut lease = None;
        let error = fork_error(writer.post_fork(
            &fixture.instance,
            &fork_request(),
            &mut || {
                lease = Some(journal.begin(&record)?);
                Ok(())
            },
            &CancellationToken::default(),
        ));
        assert_eq!(error.kind, "gitlabForkConnection");
        assert_eq!(fixture.requests().len(), 1);
        assert_eq!(
            fixture.requests()[0]["journalRecordBeforePost"],
            serde_json::json!({"phase":"awaitingConfirmation","bodyMatched":true})
        );
        assert!(journal.load(&record.id).unwrap().unwrap().operation_active);
        drop(lease);
        drop(writer);
        drop(journal);
        let reopened = crate::GitLabForkJournal::open(&path, uid).unwrap();
        let restored = reopened.load(&record.id).unwrap().unwrap();
        assert_eq!(restored.record, Some(record.clone()));
        assert!(!restored.operation_active);
        assert!(reopened.begin(&record).is_err());
        assert!(reopened.begin(&journal_record(&fixture, "b")).is_err());
        assert_eq!(fixture.requests().len(), 1);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn gitlab_https_fork_unconfirmed_local_storage_prevents_actual_post_and_preserves_bytes() {
        use crate::GitLabForkWriteTransport;
        use std::os::unix::fs::MetadataExt;
        let fixture = Fixture::new();
        let path = fixture.root.join("fork-journal");
        let uid = fs::metadata(&fixture.root).unwrap().uid();
        let journal = crate::GitLabForkJournal::open(&path, uid).unwrap();
        let unknown = path.join("unrecognized");
        fs::write(&unknown, b"retained own fixture bytes").unwrap();
        let mut writer = fixture.writer();
        let record = journal_record(&fixture, "a");
        let error = fork_error(writer.post_fork(
            &fixture.instance,
            &fork_request(),
            &mut || {
                let _lease = journal.begin(&record)?;
                Ok(())
            },
            &CancellationToken::default(),
        ));
        assert_eq!(error.kind, "gitlabForkJournal");
        assert!(fixture.requests().is_empty());
        assert_eq!(fs::read(unknown).unwrap(), b"retained own fixture bytes");
    }

    #[test]
    fn gitlab_https_fork_posts_exact_wide_id_body_only_after_dispatch_callback() {
        use crate::GitLabForkWriteTransport;
        let fixture = Fixture::new();
        let mut writer = fixture.writer();
        let mut callbacks = 0;
        assert!(fixture.requests().is_empty());
        let reply = writer
            .post_fork(
                &fixture.instance,
                &fork_request(),
                &mut || {
                    callbacks += 1;
                    fixture.mark_dispatch()
                },
                &CancellationToken::default(),
            )
            .unwrap();
        assert_eq!(callbacks, 1);
        assert_eq!(reply.status, 201);
        assert_eq!(reply.body.as_ref().unwrap()["id"], 202);
        assert_eq!(reply.body.as_ref().unwrap()["import_status"], "scheduled");
        let requests = fixture.requests();
        assert_eq!(requests.len(), 1);
        let request = &requests[0];
        assert_eq!(request["method"], "POST");
        assert_eq!(request["path"], "/api/v4/projects/101/fork");
        assert_eq!(request["credentialMatched"], true);
        assert_eq!(request["gitCredentialPresent"], false);
        assert_eq!(request["destination"], false);
        assert_eq!(request["dispatchMarkerPresent"], true);
        assert_eq!(request["contentType"], "application/json");
        assert_eq!(
            request["body"]["namespace_id"].as_u64(),
            Some(9007199254740993)
        );
        assert_eq!(request["body"]["path"], "reviewed-project");
        assert_eq!(request["body"]["name"], "Reviewed project");
        assert_eq!(request["body"].as_object().unwrap().len(), 3);
        assert!(!fixture.root.join("git-requests.jsonl").exists());
    }

    #[test]
    fn gitlab_https_fork_refuses_storage_failure_cancellation_and_other_instance_without_sending() {
        use crate::GitLabForkWriteTransport;
        let fixture = Fixture::new();
        let mut writer = fixture.writer();
        let mut callbacks = 0;
        let error = fork_error(writer.post_fork(
            &fixture.instance,
            &fork_request(),
            &mut || {
                callbacks += 1;
                Err(AppError::new(
                    "ownedStorageRefusal",
                    "Owned storage unavailable",
                    None,
                ))
            },
            &CancellationToken::default(),
        ));
        assert_eq!(error.kind, "ownedStorageRefusal");
        assert_eq!(callbacks, 1);
        assert!(fixture.requests().is_empty());
        let cancelled = CancellationToken::default();
        cancelled.cancel();
        let error = fork_error(writer.post_fork(
            &fixture.instance,
            &fork_request(),
            &mut || {
                callbacks += 1;
                Ok(())
            },
            &cancelled,
        ));
        assert_eq!(error.kind, "operationCancelled");
        assert_eq!(callbacks, 1);
        let other = GitLabInstance::parse("https://other.example.test").unwrap();
        let error = fork_error(writer.post_fork(
            &other,
            &fork_request(),
            &mut || {
                callbacks += 1;
                Ok(())
            },
            &CancellationToken::default(),
        ));
        assert_eq!(error.kind, "gitlabForkRequest");
        assert_eq!(callbacks, 1);
        let cancellation = CancellationToken::default();
        let error = fork_error(writer.post_fork(
            &fixture.instance,
            &fork_request(),
            &mut || {
                callbacks += 1;
                cancellation.cancel();
                fixture.mark_dispatch()
            },
            &cancellation,
        ));
        assert_eq!(error.kind, "operationCancelled");
        assert_eq!(callbacks, 2);
        assert!(fixture.root.join("dispatch-marker").exists());
        assert!(fixture.requests().is_empty());
    }

    #[test]
    fn gitlab_https_fork_never_follows_redirects_retries_rejections_or_exposes_error_bodies() {
        use crate::GitLabForkWriteTransport;
        let fixture = Fixture::new();
        let mut writer = fixture.writer();
        let statuses = [
            301, 302, 303, 307, 308, 400, 401, 403, 409, 422, 429, 500, 503,
        ];
        for (index, status) in statuses.into_iter().enumerate() {
            fixture.mode(&format!(
                "{}-{status}",
                if status < 400 { "redirect" } else { "status" }
            ));
            let mut callbacks = 0;
            let reply = writer
                .post_fork(
                    &fixture.instance,
                    &fork_request(),
                    &mut || {
                        callbacks += 1;
                        fixture.mark_dispatch()
                    },
                    &CancellationToken::default(),
                )
                .unwrap();
            assert_eq!(callbacks, 1);
            assert_eq!(reply.status, status);
            assert!(reply.body.is_none());
            assert_eq!(fixture.requests().len(), index + 1);
        }
        assert_eq!(fixture.requests().len(), statuses.len());
        assert!(fixture.requests().iter().all(|r| r["method"] == "POST"
            && r["destination"] == false
            && r["credentialMatched"] == true
            && r["dispatchMarkerPresent"] == true));
    }

    #[test]
    fn gitlab_https_fork_received_post_lost_headers_partial_or_invalid_body_never_replays() {
        use crate::GitLabForkWriteTransport;
        let fixture = Fixture::new();
        let mut writer = fixture.writer();
        for (index, mode) in [
            "disconnect",
            "partial",
            "declared-large",
            "streamed-large",
            "malformed",
        ]
        .into_iter()
        .enumerate()
        {
            fixture.mode(mode);
            let mut callbacks = 0;
            let error = fork_error(writer.post_fork(
                &fixture.instance,
                &fork_request(),
                &mut || {
                    callbacks += 1;
                    fixture.mark_dispatch()
                },
                &CancellationToken::default(),
            ));
            assert!(matches!(
                error.kind.as_str(),
                "gitlabForkConnection" | "gitlabForkResponse"
            ));
            assert_eq!(callbacks, 1);
            let text = serde_json::to_string(&error).unwrap();
            assert!(
                !text.contains("owned-api-fixture-token")
                    && !text.contains("owned-upstream-diagnostic")
                    && !text.contains(fixture.instance.origin())
            );
            assert_eq!(fixture.requests().len(), index + 1);
        }
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(fixture.requests().len(), 5);
        assert!(
            fixture
                .requests()
                .iter()
                .all(|r| r["method"] == "POST" && r["dispatchMarkerPresent"] == true)
        );
    }

    #[test]
    fn gitlab_https_fork_cancels_after_owned_server_receives_post_without_another_submission() {
        use crate::GitLabForkWriteTransport;
        let fixture = Fixture::new();
        fixture.mode("stalled");
        let mut writer = fixture.writer();
        let token = CancellationToken::default();
        let worker_token = token.clone();
        let instance = fixture.instance.clone();
        let marker = fixture.root.join("dispatch-marker");
        let worker = std::thread::spawn(move || {
            writer.post_fork(
                &instance,
                &fork_request(),
                &mut || {
                    fs::write(&marker, "owned-dispatch-callback").unwrap();
                    Ok(())
                },
                &worker_token,
            )
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        while fixture.requests().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            fixture.requests().len(),
            1,
            "POST did not reach owned fixture"
        );
        let started = Instant::now();
        token.cancel();
        let error = fork_error(worker.join().unwrap());
        assert_eq!(error.kind, "operationCancelled");
        assert!(started.elapsed() < Duration::from_secs(2));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(fixture.requests().len(), 1);
        assert_eq!(fixture.requests()[0]["dispatchMarkerPresent"], true);
    }

    #[test]
    fn gitlab_https_fork_untrusted_tls_sends_no_credential_and_still_does_not_retry() {
        use crate::GitLabForkWriteTransport;
        let fixture = Fixture::new();
        let mut writer =
            GitLabForkHttpsTransport::new(fixture.instance.clone(), "owned-api-fixture-token")
                .unwrap();
        let mut callbacks = 0;
        let error = fork_error(writer.post_fork(
            &fixture.instance,
            &fork_request(),
            &mut || {
                callbacks += 1;
                fixture.mark_dispatch()
            },
            &CancellationToken::default(),
        ));
        assert_eq!(callbacks, 1);
        assert_eq!(error.kind, "gitlabForkConnection");
        assert!(fixture.requests().is_empty());
        assert!(
            !serde_json::to_string(&error)
                .unwrap()
                .contains("owned-api-fixture-token")
        );
    }

    #[test]
    fn gitlab_https_fork_accepts_json_at_exact_response_limit() {
        use crate::GitLabForkWriteTransport;
        let fixture = Fixture::new();
        fixture.mode("exact-boundary");
        let mut writer = fixture.writer();
        let reply = writer
            .post_fork(
                &fixture.instance,
                &fork_request(),
                &mut || fixture.mark_dispatch(),
                &CancellationToken::default(),
            )
            .unwrap();
        assert_eq!(reply.status, 201);
        assert_eq!(
            reply.body.unwrap().as_str().unwrap().len(),
            RESPONSE_LIMIT - 2
        );
        assert_eq!(fixture.requests().len(), 1);
    }

    #[test]
    fn gitlab_https_fork_writer_can_be_released_from_async_native_teardown() {
        let writer = GitLabForkHttpsTransport::new(
            GitLabInstance::parse("https://gitlab.example.test").unwrap(),
            "owned-api-fixture-token",
        )
        .unwrap();
        let outer = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        outer.block_on(async move {
            drop(writer);
        });
    }

    #[test]
    fn gitlab_https_namespace_pages_keep_personal_nested_and_wide_identities() {
        let fixture = Fixture::new();
        let endpoint = "/api/v4/namespaces?per_page=20&page=1&owned_only=true&search=team%2Fnested+%26+literal";
        let mut resources = serde_json::json!({endpoint: [
            {"id": 9007199254740993_u64, "name": "Personal", "path": "owned-reader", "full_path": "owned-reader", "kind": "user", "private_token": "owned-not-exported-marker"},
            {"id": 9007199254740995_u64, "name": "Nested", "path": "nested", "full_path": "team/nested", "kind": "group"}
        ]});
        resources["/api/v4/namespaces/9007199254740993"] = resources[endpoint][0].clone();
        resources["/api/v4/namespaces/9007199254740995"] = resources[endpoint][1].clone();
        fs::write(
            fixture.root.join("fork-resources.json"),
            resources.to_string(),
        )
        .unwrap();
        let page = crate::load_gitlab_namespace_page_with(
            &mut fixture.transport(),
            &fixture.instance,
            &fork_account(&fixture),
            crate::GitLabNamespaceQuery {
                page: 1,
                search: "team/nested & literal".into(),
                owned_only: true,
            },
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(page.entries[0].id, "9007199254740993");
        assert_eq!(page.entries[0].kind, crate::GitLabNamespaceKind::User);
        assert_eq!(page.entries[1].kind, crate::GitLabNamespaceKind::Group);
        assert_eq!(page.entries[1].full_path, "team/nested");
        assert!(page.next_page.is_none());
        assert!(
            !serde_json::to_string(&page)
                .unwrap()
                .contains("owned-not-exported-marker")
        );
        for namespace in &page.entries {
            let inspected = crate::inspect_gitlab_namespace_with(
                &mut fixture.transport(),
                &fixture.instance,
                &fork_account(&fixture),
                &crate::GitLabNamespaceSelection {
                    id: namespace.id.clone(),
                    full_path: namespace.full_path.clone(),
                    kind: namespace.kind,
                },
                &CancellationToken::default(),
            )
            .unwrap();
            assert_eq!(&inspected.namespace, namespace);
            let projected = serde_json::to_value(&inspected).unwrap();
            assert!(projected["namespace"].get("canCreateProject").is_none());
            assert!(!projected.to_string().contains("owned-not-exported-marker"));
        }
        let requests = fixture.requests();
        assert_eq!(
            requests
                .iter()
                .map(|r| r["path"].as_str().unwrap())
                .collect::<Vec<_>>(),
            [
                "/api/v4/user",
                endpoint,
                "/api/v4/user",
                "/api/v4/user",
                "/api/v4/namespaces/9007199254740993",
                "/api/v4/user",
                "/api/v4/user",
                "/api/v4/namespaces/9007199254740995",
                "/api/v4/user"
            ]
        );
        assert!(
            requests
                .iter()
                .all(|r| r["credentialMatched"] == true && r["destination"] == false)
        );
    }

    #[test]
    fn gitlab_https_fork_candidates_require_fresh_relationship_reads_and_keep_git_hosts_separate() {
        let fixture = Fixture::new();
        let candidate = serde_json::json!({
            "id": 9007199254740993_u64, "name": "Owned fork", "path_with_namespace": "owned-reader/project",
            "web_url": format!("{}/owned-reader/project", fixture.instance.origin()),
            "description": null, "default_branch": null, "visibility": "private", "archived": false,
            "namespace": {"id": 9007199254740995_u64, "name": "Personal", "path": "owned-reader", "full_path": "owned-reader", "kind": "user"},
            "forked_from_project": {"id": 101, "path_with_namespace": "team/subgroup/owned-project"},
            "import_status": "started", "import_error": "owned-not-exported-marker",
            "http_url_to_repo": "https://git.example.test:9443/owned-reader/project.git",
            "ssh_url_to_repo": "ssh://git@ssh.example.test:2222/owned-reader/project.git"
        });
        let endpoint = "/api/v4/projects/101/forks?per_page=20&page=1&order_by=id&sort=asc&search=owned+%26+literal";
        let resources = serde_json::json!({endpoint: [candidate.clone()], "/api/v4/projects/9007199254740993": candidate});
        fs::write(
            fixture.root.join("fork-resources.json"),
            resources.to_string(),
        )
        .unwrap();
        let account = fork_account(&fixture);
        let mut transport = fixture.transport();
        let page = crate::load_gitlab_fork_page_with(
            &mut transport,
            &fixture.instance,
            &account,
            crate::GitLabForkQuery {
                source_project_id: "101".into(),
                source_full_path: "team/subgroup/owned-project".into(),
                page: 1,
                search: "owned & literal".into(),
            },
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(page.entries.len(), 1);
        let inspected = crate::inspect_gitlab_fork_with(
            &mut transport,
            &fixture.instance,
            &account,
            &crate::GitLabForkSelection {
                source_project_id: "101".into(),
                source_full_path: "team/subgroup/owned-project".into(),
                fork_project_id: page.entries[0].id.clone(),
                fork_full_path: page.entries[0].full_path.clone(),
            },
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(
            inspected.import_state,
            crate::GitLabForkImportState::Started
        );
        assert_eq!(inspected.namespace.id, "9007199254740995");
        assert_eq!(
            inspected.clone_https.as_deref(),
            Some("https://git.example.test:9443/owned-reader/project.git")
        );
        assert_eq!(
            inspected.clone_ssh.as_deref(),
            Some("ssh://git@ssh.example.test:2222/owned-reader/project.git")
        );
        assert!(
            !serde_json::to_string(&inspected)
                .unwrap()
                .contains("owned-not-exported-marker")
        );
        let requests = fixture.requests();
        assert_eq!(
            requests
                .iter()
                .map(|r| r["path"].as_str().unwrap())
                .collect::<Vec<_>>(),
            [
                "/api/v4/user",
                "/api/v4/projects/101",
                endpoint,
                "/api/v4/user",
                "/api/v4/user",
                "/api/v4/projects/101",
                "/api/v4/projects/9007199254740993",
                "/api/v4/user"
            ]
        );
        assert!(
            requests
                .iter()
                .all(|r| r["credentialMatched"] == true && r["destination"] == false)
        );
        assert!(!fixture.root.join("git-requests.jsonl").exists());
    }

    #[test]
    fn gitlab_https_namespace_and_fork_routes_never_follow_redirects_or_cross_instances() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        let endpoints = [
            "namespaces?per_page=20&page=1",
            "namespaces/9007199254740993",
            "projects/101/forks?per_page=20&page=1&order_by=id&sort=asc",
        ];
        for status in [301, 302, 303, 307, 308] {
            fixture.mode(&format!("redirect-{status}"));
            for endpoint in endpoints {
                assert_eq!(
                    transport
                        .get(&fixture.instance, endpoint, &CancellationToken::default())
                        .unwrap_err()
                        .kind,
                    "gitlabRedirect"
                );
            }
        }
        let before = fixture.requests().len();
        assert_eq!(before, 15);
        for endpoint in endpoints {
            let cancelled = CancellationToken::default();
            cancelled.cancel();
            assert_eq!(
                transport
                    .get(&fixture.instance, endpoint, &cancelled)
                    .unwrap_err()
                    .kind,
                "operationCancelled"
            );
            let other = GitLabInstance::parse("https://other.example.test").unwrap();
            assert_eq!(
                transport
                    .get(&other, endpoint, &CancellationToken::default())
                    .unwrap_err()
                    .kind,
                "gitlabDiscoveryRequest"
            );
        }
        assert_eq!(fixture.requests().len(), before);
        assert!(
            fixture
                .requests()
                .iter()
                .all(|r| r["credentialMatched"] == true && r["destination"] == false)
        );
    }

    #[test]
    fn gitlab_https_inspects_selected_project_with_three_origin_bound_reads() {
        let fixture = Fixture::new();
        let expected = crate::GitLabAccount {
            origin: fixture.instance.origin().into(),
            id: "41".into(),
            login: "owned-reader".into(),
        };
        let inspected = crate::inspect_gitlab_project_with(
            &mut fixture.transport(),
            &fixture.instance,
            &expected,
            "101",
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(inspected.project.full_path, "team/subgroup/owned-project");
        assert!(inspected.project.default_branch.is_none());
        assert_eq!(
            inspected.clone_ssh.as_deref(),
            Some("ssh://git@ssh.example.test:2222/team/subgroup/owned-project.git")
        );
        let requests = fixture.requests();
        assert_eq!(
            requests
                .iter()
                .map(|r| r["path"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["/api/v4/user", "/api/v4/projects/101", "/api/v4/user"]
        );
        assert!(
            requests
                .iter()
                .all(|r| r["credentialMatched"] == true && r["destination"] == false)
        );
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

#[test]
fn gitlab_https_namespace_and_fork_reads_remain_closed_origin_bound_routes() {
    let instance = GitLabInstance::parse("https://gitlab.example.test:8443").unwrap();
    for endpoint in [
        "namespaces/9007199254740993",
        "namespaces?per_page=20&page=1",
        "namespaces?per_page=20&page=1&owned_only=true&search=team%2Fnested+%26+literal",
        "projects/10/forks?per_page=20&page=1&order_by=id&sort=asc&search=owned",
    ] {
        assert_eq!(
            endpoint_url(&instance, endpoint)
                .unwrap()
                .origin()
                .ascii_serialization(),
            instance.origin()
        );
    }
    for bad in [
        "namespaces/01",
        "namespaces/1?token=other",
        "namespaces/../user",
        "namespaces?per_page=20&page=1&order_by=id",
        "namespaces?per_page=20&page=1&owned_only=false",
        "namespaces?per_page=20&page=1&page=2",
        "namespaces?per_page=20&page=1&search=a&owned_only=other",
        "projects/10/fork",
        "projects/10/forks",
        "projects/10/forks?per_page=20&page=1&order_by=id&sort=desc",
        "projects/10/forks?per_page=20&page=1&order_by=id&sort=asc&membership=true",
        "projects/10/forks?per_page=20&page=1&order_by=id&sort=asc&search=x#other",
        "projects/10/forks?per_page=20&page=1&order_by=id&sort=asc&search=%00",
    ] {
        assert!(endpoint_url(&instance, bad).is_err(), "{bad}");
    }
}
