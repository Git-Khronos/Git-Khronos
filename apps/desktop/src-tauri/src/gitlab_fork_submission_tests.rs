use super::*;
use serde_json::{Value, json};

#[test]
fn fork_submission_inputs_never_accept_replacement_authority() {
    let value =
        json!({"context":"owned-review", "token":"a".repeat(32), "operationId":"owned-submit"});
    assert!(serde_json::from_value::<SubmitForkRequest>(value.clone()).is_ok());
    for field in [
        "connectionId",
        "plan",
        "record",
        "origin",
        "endpoint",
        "credential",
        "sourceId",
        "namespaceId",
        "projectPath",
    ] {
        let mut invalid = value.clone();
        invalid[field] = json!("replacement");
        assert!(
            serde_json::from_value::<SubmitForkRequest>(invalid).is_err(),
            "{field}"
        );
    }
    for field in ["context", "token", "operationId"] {
        let mut invalid = value.clone();
        invalid.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<SubmitForkRequest>(invalid).is_err());
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::{
        path::PathBuf,
        sync::{
            Arc, Mutex, Weak,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        },
    };

    const CONNECTION: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    fn instance() -> core::GitLabInstance {
        core::GitLabInstance::parse("https://gitlab.example.test:8443").unwrap()
    }
    fn account() -> core::GitLabAccount {
        core::GitLabAccount {
            origin: instance().origin().into(),
            id: "7".into(),
            login: "owned-reader".into(),
        }
    }
    struct Reader {
        calls: Arc<Mutex<Vec<String>>>,
        changed: Arc<AtomicBool>,
    }
    impl core::GitLabReadTransport for Reader {
        fn get(
            &mut self,
            selected: &core::GitLabInstance,
            endpoint: &str,
            _: &CancellationToken,
        ) -> Result<Value, AppError> {
            assert_eq!(selected, &instance());
            self.calls.lock().unwrap().push(endpoint.into());
            Ok(match endpoint {
                "user" if self.changed.load(Ordering::Acquire) => {
                    json!({"id":8,"username":"different-account"})
                }
                "user" => json!({"id":7,"username":"owned-reader"}),
                "projects/101" => {
                    json!({"id":101,"name":"Owned source","path_with_namespace":"team/upstream",
                    "web_url":"https://gitlab.example.test:8443/team/upstream","description":null,
                    "default_branch":"main","visibility":"private","archived":false,"empty_repo":false,
                    "private_token":"owned-secret-marker"})
                }
                "namespaces/202" => {
                    json!({"id":202,"name":"Owned group","path":"destination","full_path":"team/destination","kind":"group"})
                }
                _ => panic!("unexpected fixture read: {endpoint}"),
            })
        }
    }
    #[derive(Clone, Copy)]
    enum Behavior {
        Accepted,
        LostReply,
        Rejected,
        Disconnect,
        CancelAfterMarker,
        UnknownStorage,
        BeforeMarker,
        Twice,
    }
    struct Writer {
        calls: Arc<AtomicUsize>,
        journal: core::GitLabForkJournal,
        root: PathBuf,
        accounts: Weak<GitLabAccounts>,
        behavior: Behavior,
    }
    impl core::GitLabForkWriteTransport for Writer {
        fn post_fork(
            &mut self,
            selected: &core::GitLabInstance,
            _: &core::GitLabForkDispatch,
            before: &mut dyn FnMut() -> Result<(), AppError>,
            cancellation: &CancellationToken,
        ) -> Result<core::GitLabForkPostReply, AppError> {
            assert_eq!(selected, &instance());
            if matches!(self.behavior, Behavior::BeforeMarker) {
                return Err(refused("owned pre-marker refusal"));
            }
            before()?;
            // Read the actual immutable disk record through a second journal owner,
            // while the submitting operation still holds the row lease.
            let inspection = self.journal.inspect().unwrap();
            assert!(inspection.issues.is_empty());
            assert_eq!(inspection.entries.len(), 1);
            let entry = &inspection.entries[0];
            assert!(entry.operation_active);
            let record = entry.record.as_ref().unwrap();
            assert_eq!(record.revision, "1");
            assert_eq!(record.phase, core::GitLabForkPhase::AwaitingConfirmation);
            assert_eq!(
                record.intent.target_full_path(),
                "team/destination/reviewed-fork"
            );
            self.calls.fetch_add(1, Ordering::AcqRel);
            match self.behavior {
                Behavior::LostReply => {
                    return Err(AppError {
                        kind: "gitlabForkConnection".into(),
                        message: "owned-private-provider-text".into(),
                        hint: None,
                    });
                }
                Behavior::Disconnect => {
                    assert!(
                        self.accounts
                            .upgrade()
                            .unwrap()
                            .disconnect(CONNECTION)
                            .unwrap()
                    );
                }
                Behavior::CancelAfterMarker => {
                    cancellation.cancel();
                    return Err(AppError {
                        kind: "operationCancelled".into(),
                        message: "owned interruption".into(),
                        hint: None,
                    });
                }
                Behavior::UnknownStorage => {
                    std::fs::write(self.root.join("unknown-entry"), b"owned retained bytes")
                        .unwrap();
                }
                Behavior::Twice => {
                    assert!(before().is_err());
                }
                _ => (),
            }
            Ok(core::GitLabForkPostReply {
                status: if matches!(self.behavior, Behavior::Rejected) {
                    403
                } else {
                    202
                },
                body: Some(
                    json!({"id":303,"private_token":"owned-secret-marker","description":"owned-private-provider-text"}),
                ),
            })
        }
    }
    struct Fixture {
        root: PathBuf,
        accounts: Arc<GitLabAccounts>,
        reviews: GitLabForkReviews,
        journal: core::GitLabForkJournal,
        calls: Arc<AtomicUsize>,
        reads: Arc<Mutex<Vec<String>>>,
        changed: Arc<AtomicBool>,
    }
    impl Fixture {
        fn new(behavior: Behavior, write_capability: bool) -> Self {
            use std::os::unix::fs::DirBuilderExt;
            let root = std::env::temp_dir().join(format!(
                "git-khronos-fork-submit-{}-{}",
                std::process::id(),
                identifier().unwrap()
            ));
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&root)
                .unwrap();
            let journal_path = root.join("journal");
            let uid = unsafe { libc::geteuid() };
            let journal = core::GitLabForkJournal::open(&journal_path, uid).unwrap();
            let accounts = Arc::new(GitLabAccounts::default());
            let calls = Arc::new(AtomicUsize::new(0));
            let reads = Arc::new(Mutex::new(Vec::new()));
            let changed = Arc::new(AtomicBool::new(false));
            let writer: Option<Box<dyn core::GitLabForkWriteTransport + Send>> = write_capability
                .then(|| {
                    Box::new(Writer {
                        calls: calls.clone(),
                        journal: core::GitLabForkJournal::open(&journal_path, uid).unwrap(),
                        root: journal_path,
                        accounts: Arc::downgrade(&accounts),
                        behavior,
                    }) as Box<dyn core::GitLabForkWriteTransport + Send>
                });
            let view = accounts.fixture_connection(
                CONNECTION.into(),
                instance(),
                account(),
                Box::new(Reader {
                    calls: reads.clone(),
                    changed: changed.clone(),
                }),
                writer,
            );
            assert_eq!(view.can_create_fork, write_capability);
            Self {
                root,
                accounts,
                reviews: GitLabForkReviews::default(),
                journal,
                calls,
                reads,
                changed,
            }
        }
        fn request(&self) -> PrepareForkRequest {
            PrepareForkRequest {
                connection_id: CONNECTION.into(),
                context: "owned-review".into(),
                operation_id: "owned-prepare".into(),
                selection: core::GitLabForkPrepareRequest {
                    source_id: "101".into(),
                    source_full_path: "team/upstream".into(),
                    namespace: core::GitLabNamespaceSelection {
                        id: "202".into(),
                        full_path: "team/destination".into(),
                        kind: core::GitLabNamespaceKind::Group,
                    },
                    project_path: "reviewed-fork".into(),
                    project_name: Some("Owned fork".into()),
                },
            }
        }
        fn prepare(&self) -> PreparedFork {
            prepare(
                &self.accounts,
                &self.reviews,
                self.request(),
                &CancellationToken::default(),
            )
            .unwrap()
        }
        fn submit(
            &self,
            token: &str,
            cancellation: &CancellationToken,
        ) -> Result<ForkSubmissionOutcome, AppError> {
            submit_with(
                &self.accounts,
                &self.reviews,
                SubmitForkRequest {
                    context: "owned-review".into(),
                    token: token.into(),
                    operation_id: "owned-submit".into(),
                },
                cancellation,
                || Ok(self.journal.clone()),
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.accounts.disconnect(CONNECTION).unwrap();
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }
    #[test]
    fn fork_submit_read_connections_cannot_prepare_or_acquire_write_authority() {
        let f = Fixture::new(Behavior::Accepted, false);
        let error = prepare(
            &f.accounts,
            &f.reviews,
            f.request(),
            &CancellationToken::default(),
        )
        .err()
        .unwrap();
        assert_eq!(error.kind, "gitlabForkConnectionRequired");
        assert!(f.reads.lock().unwrap().is_empty());
        assert_eq!(f.calls.load(Ordering::Acquire), 0);
        assert!(f.journal.inspect().unwrap().entries.is_empty());
    }
    #[test]
    fn fork_submit_preparation_is_read_only_and_retains_no_provider_secrets() {
        let f = Fixture::new(Behavior::Accepted, true);
        let preview = f.prepare();
        assert_eq!(f.reads.lock().unwrap().len(), 6);
        assert_eq!(f.calls.load(Ordering::Acquire), 0);
        assert!(f.journal.inspect().unwrap().entries.is_empty());
        let text = serde_json::to_string(&preview).unwrap();
        assert!(!text.contains("owned-secret-marker"));
        assert!(!text.contains("endpoint"));
        assert_eq!(
            preview.preview.target_full_path,
            "team/destination/reviewed-fork"
        );
    }
    #[test]
    fn fork_submit_fresh_account_change_refuses_before_marker_and_consumes_review() {
        let f = Fixture::new(Behavior::Accepted, true);
        let preview = f.prepare();
        f.changed.store(true, Ordering::Release);
        assert!(
            f.submit(&preview.token, &CancellationToken::default())
                .is_err()
        );
        assert!(
            f.submit(&preview.token, &CancellationToken::default())
                .is_err()
        );
        assert_eq!(f.calls.load(Ordering::Acquire), 0);
        assert!(f.journal.inspect().unwrap().entries.is_empty());
    }
    #[test]
    fn fork_submit_success_persists_status_without_claiming_verified_import_or_leaking_body() {
        let f = Fixture::new(Behavior::Accepted, true);
        let preview = f.prepare();
        let outcome = f
            .submit(&preview.token, &CancellationToken::default())
            .unwrap();
        assert_eq!(outcome.phase, SubmissionPhase::AcceptedAwaitingInspection);
        assert_eq!(outcome.revision.as_deref(), Some("2"));
        assert_eq!(outcome.http_status, Some(202));
        let saved = f
            .journal
            .load(&outcome.record_id)
            .unwrap()
            .unwrap()
            .record
            .unwrap();
        assert_eq!(saved.phase, core::GitLabForkPhase::AwaitingConfirmation);
        assert!(saved.project_id.is_none());
        let text = serde_json::to_string(&saved).unwrap();
        assert!(!text.contains("owned-secret-marker"));
        assert!(!text.contains("owned-private-provider-text"));
        assert!(
            f.submit(&preview.token, &CancellationToken::default())
                .is_err()
        );
        assert_eq!(f.calls.load(Ordering::Acquire), 1);
    }
    #[test]
    fn fork_submit_lost_reply_retains_uncertainty_and_restart_never_replays() {
        let f = Fixture::new(Behavior::LostReply, true);
        let preview = f.prepare();
        let outcome = f
            .submit(&preview.token, &CancellationToken::default())
            .unwrap();
        assert_eq!(outcome.phase, SubmissionPhase::AwaitingConfirmation);
        let reopened =
            core::GitLabForkJournal::open(&f.root.join("journal"), unsafe { libc::geteuid() })
                .unwrap();
        let saved = reopened
            .load(&outcome.record_id)
            .unwrap()
            .unwrap()
            .record
            .unwrap();
        assert_eq!(
            saved.last_failure,
            Some(core::GitLabForkFailure::Connection)
        );
        assert!(
            !serde_json::to_string(&saved)
                .unwrap()
                .contains("owned-private-provider-text")
        );
        let restarted = GitLabForkReviews::default();
        assert!(
            submit_with(
                &f.accounts,
                &restarted,
                SubmitForkRequest {
                    context: "owned-review".into(),
                    token: preview.token,
                    operation_id: "restored".into()
                },
                &CancellationToken::default(),
                || Ok(reopened)
            )
            .is_err()
        );
        assert_eq!(f.calls.load(Ordering::Acquire), 1);
    }
    #[test]
    fn fork_submit_disconnect_after_marker_keeps_accepted_outcome() {
        let f = Fixture::new(Behavior::Disconnect, true);
        let preview = f.prepare();
        let outcome = f
            .submit(&preview.token, &CancellationToken::default())
            .unwrap();
        assert_eq!(outcome.phase, SubmissionPhase::AcceptedAwaitingInspection);
        assert_eq!(outcome.http_status, Some(202));
        assert!(
            f.journal
                .load(&outcome.record_id)
                .unwrap()
                .unwrap()
                .record
                .unwrap()
                .http_status
                .is_some()
        );
        assert_eq!(f.calls.load(Ordering::Acquire), 1);
    }
    #[test]
    fn fork_submit_cancellation_after_marker_retains_record_and_consumes_review() {
        let f = Fixture::new(Behavior::CancelAfterMarker, true);
        let preview = f.prepare();
        let cancellation = CancellationToken::default();
        let outcome = f.submit(&preview.token, &cancellation).unwrap();
        assert!(cancellation.is_cancelled());
        assert_eq!(outcome.phase, SubmissionPhase::AwaitingConfirmation);
        assert_eq!(
            f.journal
                .load(&outcome.record_id)
                .unwrap()
                .unwrap()
                .record
                .unwrap()
                .last_failure,
            Some(core::GitLabForkFailure::Interrupted)
        );
        assert!(
            f.submit(&preview.token, &CancellationToken::default())
                .is_err()
        );
        assert_eq!(f.calls.load(Ordering::Acquire), 1);
    }
    #[test]
    fn fork_submit_rejection_and_failed_status_append_remain_inspectable_without_replay() {
        for behavior in [Behavior::Rejected, Behavior::UnknownStorage] {
            let f = Fixture::new(behavior, true);
            let preview = f.prepare();
            let outcome = f
                .submit(&preview.token, &CancellationToken::default())
                .unwrap();
            if matches!(behavior, Behavior::Rejected) {
                assert_eq!(outcome.phase, SubmissionPhase::ResponseRejected);
                assert_eq!(outcome.http_status, Some(403));
            } else {
                assert_eq!(outcome.phase, SubmissionPhase::StorageUnconfirmed);
                assert_eq!(outcome.revision.as_deref(), Some("1"));
                assert_eq!(
                    std::fs::read(f.root.join("journal/unknown-entry")).unwrap(),
                    b"owned retained bytes"
                );
            }
            assert!(
                f.submit(&preview.token, &CancellationToken::default())
                    .is_err()
            );
            assert_eq!(f.calls.load(Ordering::Acquire), 1);
        }
    }
    #[test]
    fn fork_submit_storage_refusal_before_post_and_port_refusal_consume_without_sending() {
        for blocked_storage in [false, true] {
            let f = Fixture::new(Behavior::BeforeMarker, true);
            let preview = f.prepare();
            let result = submit_with(
                &f.accounts,
                &f.reviews,
                SubmitForkRequest {
                    context: "owned-review".into(),
                    token: preview.token.clone(),
                    operation_id: "owned-submit".into(),
                },
                &CancellationToken::default(),
                || {
                    if blocked_storage {
                        Err(refused("owned storage unavailable"))
                    } else {
                        Ok(f.journal.clone())
                    }
                },
            );
            assert!(result.is_err());
            assert!(
                f.submit(&preview.token, &CancellationToken::default())
                    .is_err()
            );
            assert_eq!(f.calls.load(Ordering::Acquire), 0);
            assert!(f.journal.inspect().unwrap().entries.is_empty());
        }
    }
    #[test]
    fn fork_submit_second_dispatch_callback_and_fresh_destination_attempt_cannot_repeat_post() {
        let f = Fixture::new(Behavior::Twice, true);
        let preview = f.prepare();
        assert!(
            f.submit(&preview.token, &CancellationToken::default())
                .is_ok()
        );
        let second = f.prepare();
        let outcome = f
            .submit(&second.token, &CancellationToken::default())
            .unwrap();
        assert_eq!(outcome.phase, SubmissionPhase::StorageUnconfirmed);
        assert_eq!(f.calls.load(Ordering::Acquire), 1);
        assert_eq!(f.journal.inspect().unwrap().entries.len(), 1);
    }
    #[test]
    fn fork_submit_wrong_context_preserves_review_and_pre_marker_cancellation_does_no_io() {
        let f = Fixture::new(Behavior::Accepted, true);
        let preview = f.prepare();
        assert!(
            submit_with(
                &f.accounts,
                &f.reviews,
                SubmitForkRequest {
                    context: "another-context".into(),
                    token: preview.token.clone(),
                    operation_id: "wrong".into()
                },
                &CancellationToken::default(),
                || panic!("wrong token reached storage")
            )
            .is_err()
        );
        let cancelled = CancellationToken::default();
        cancelled.cancel();
        assert!(
            submit_with(
                &f.accounts,
                &f.reviews,
                SubmitForkRequest {
                    context: "owned-review".into(),
                    token: preview.token.clone(),
                    operation_id: "cancelled".into()
                },
                &cancelled,
                || panic!("cancelled operation reached storage")
            )
            .is_err()
        );
        assert!(
            f.submit(&preview.token, &CancellationToken::default())
                .is_err()
        );
        assert_eq!(f.calls.load(Ordering::Acquire), 0);
        assert_eq!(f.reads.lock().unwrap().len(), 6);
    }
    #[test]
    fn fork_submit_concurrent_execution_returns_one_outcome_and_sends_once() {
        let f = Fixture::new(Behavior::Accepted, true);
        let preview = f.prepare();
        let start = std::sync::Barrier::new(8);
        let successes = std::thread::scope(|scope| {
            let handles = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        start.wait();
                        usize::from(
                            f.submit(&preview.token, &CancellationToken::default())
                                .is_ok(),
                        )
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .sum::<usize>()
        });
        assert_eq!(successes, 1);
        assert_eq!(f.calls.load(Ordering::Acquire), 1);
        assert_eq!(f.journal.inspect().unwrap().entries.len(), 1);
    }
    #[test]
    fn fork_submit_ambiguous_marker_storage_failure_returns_native_identity_without_post() {
        let f = Fixture::new(Behavior::Accepted, true);
        let preview = f.prepare();
        std::fs::write(
            f.root.join("journal/unknown-entry"),
            b"owned quarantine marker",
        )
        .unwrap();
        let outcome = f
            .submit(&preview.token, &CancellationToken::default())
            .unwrap();
        assert_eq!(outcome.phase, SubmissionPhase::StorageUnconfirmed);
        assert_eq!(outcome.record_id.len(), 32);
        assert!(outcome.revision.is_none());
        assert_eq!(f.calls.load(Ordering::Acquire), 0);
        assert!(
            f.submit(&preview.token, &CancellationToken::default())
                .is_err()
        );
        assert_eq!(
            std::fs::read(f.root.join("journal/unknown-entry")).unwrap(),
            b"owned quarantine marker"
        );
    }

    #[test]
    fn fork_storage_secures_framework_parent_and_preserves_existing_preferences() {
        use std::os::unix::fs::PermissionsExt;
        let f = Fixture::new(Behavior::Accepted, true);
        let directory = f.root.join("app-data");
        std::fs::create_dir(&directory).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o775)).unwrap();
        let preferences = directory.join("preferences.json");
        std::fs::write(&preferences, b"owned existing preferences").unwrap();
        let mode = std::fs::metadata(&preferences)
            .unwrap()
            .permissions()
            .mode();
        let journal = open_journal_at(&directory, unsafe { libc::geteuid() }).unwrap();
        assert!(journal.inspect().unwrap().entries.is_empty());
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o7777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(directory.join("gitlab-forks-v1"))
                .unwrap()
                .permissions()
                .mode()
                & 0o7777,
            0o700
        );
        assert_eq!(
            std::fs::read(&preferences).unwrap(),
            b"owned existing preferences"
        );
        assert_eq!(
            std::fs::metadata(&preferences)
                .unwrap()
                .permissions()
                .mode(),
            mode
        );
        assert_eq!(f.calls.load(Ordering::Acquire), 0);
    }
    #[test]
    fn fork_storage_refuses_symlink_without_changing_the_target() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let f = Fixture::new(Behavior::Accepted, true);
        let target = f.root.join("target");
        std::fs::create_dir(&target).unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o775)).unwrap();
        let alias = f.root.join("app-data");
        symlink(&target, &alias).unwrap();
        assert!(open_journal_at(&alias, unsafe { libc::geteuid() }).is_err());
        assert_eq!(
            std::fs::metadata(&target).unwrap().permissions().mode() & 0o7777,
            0o775
        );
        assert!(!target.join("gitlab-forks-v1").exists());
    }
    #[test]
    fn fork_storage_refuses_another_uid_before_changing_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let f = Fixture::new(Behavior::Accepted, true);
        let directory = f.root.join("app-data");
        std::fs::create_dir(&directory).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o775)).unwrap();
        assert!(open_journal_at(&directory, unsafe { libc::geteuid() } + 1).is_err());
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o7777,
            0o775
        );
        assert!(!directory.join("gitlab-forks-v1").exists());
    }
    #[test]
    fn fork_storage_does_not_repair_an_insecure_existing_journal() {
        use std::os::unix::fs::PermissionsExt;
        let f = Fixture::new(Behavior::Accepted, true);
        let directory = f.root.join("app-data");
        let child = directory.join("gitlab-forks-v1");
        std::fs::create_dir_all(&child).unwrap();
        std::fs::set_permissions(&child, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(child.join("retained"), b"owned retained journal bytes").unwrap();
        assert!(open_journal_at(&directory, unsafe { libc::geteuid() }).is_err());
        assert_eq!(
            std::fs::metadata(&child).unwrap().permissions().mode() & 0o7777,
            0o755
        );
        assert_eq!(
            std::fs::read(child.join("retained")).unwrap(),
            b"owned retained journal bytes"
        );
    }
    #[test]
    fn fork_storage_refuses_file_and_relative_locations_without_mutation() {
        let f = Fixture::new(Behavior::Accepted, true);
        let file = f.root.join("app-data");
        std::fs::write(&file, b"owned existing regular file").unwrap();
        let uid = unsafe { libc::geteuid() };
        assert!(open_journal_at(&file, uid).is_err());
        assert!(open_journal_at(std::path::Path::new("relative-app-data"), uid).is_err());
        assert!(open_journal_at(&f.root.join("../substituted"), uid).is_err());
        assert_eq!(
            std::fs::read(&file).unwrap(),
            b"owned existing regular file"
        );
    }
}
