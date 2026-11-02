use super::*;
use serde_json::json;

#[test]
fn fork_recovery_requests_cannot_restore_submission_or_replace_native_storage_and_identity() {
    let value = json!({"connectionId":"a".repeat(32),"recordId":"b".repeat(32),"expectedRevision":"1","operationId":"owned-read"});
    assert!(serde_json::from_value::<ReconcileForkRequest>(value.clone()).is_ok());
    for field in [
        "token",
        "plan",
        "record",
        "origin",
        "endpoint",
        "directory",
        "credential",
        "accountId",
    ] {
        let mut invalid = value.clone();
        invalid[field] = json!("replacement");
        assert!(serde_json::from_value::<ReconcileForkRequest>(invalid).is_err());
    }
    let mut numeric = value;
    numeric["expectedRevision"] = json!(1);
    assert!(serde_json::from_value::<ReconcileForkRequest>(numeric).is_err());
    assert!(
        serde_json::from_value::<RetireForkRequest>(
            json!({"recordId":"b".repeat(32),"expectedRevision":"1","operationId":"owned-retire"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<ForkRecordListRequest>(
            json!({"operationId":"owned-list","directory":"/elsewhere"})
        )
        .is_err()
    );
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use serde_json::Value;
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };
    const CONNECTION: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    struct Reader {
        calls: Arc<Mutex<Vec<String>>>,
        account_id: u64,
        root: PathBuf,
        fail_storage: bool,
    }
    impl core::GitLabReadTransport for Reader {
        fn get(
            &mut self,
            _: &core::GitLabInstance,
            endpoint: &str,
            _: &CancellationToken,
        ) -> Result<Value, AppError> {
            self.calls.lock().unwrap().push(endpoint.into());
            if self.fail_storage && endpoint == "projects/owned-reader%2Freviewed-fork" {
                std::fs::write(
                    self.root.join("journal/unknown-entry"),
                    b"owned storage witness",
                )
                .unwrap();
            }
            Ok(match endpoint {
                "user" => json!({"id":self.account_id,"username":"owned-reader"}),
                "projects/101" => {
                    json!({"id":101,"name":"Source","path_with_namespace":"team/upstream","web_url":"https://gitlab.example.test/team/upstream","description":null,"default_branch":"main","visibility":"private","archived":false})
                }
                "namespaces/77" => {
                    json!({"id":77,"name":"Owned reader","path":"owned-reader","full_path":"owned-reader","kind":"user"})
                }
                "projects/owned-reader%2Freviewed-fork" | "projects/202" => {
                    json!({"id":202,"name":"Fork","path_with_namespace":"owned-reader/reviewed-fork","web_url":"https://gitlab.example.test/owned-reader/reviewed-fork","description":"owned-private-text","default_branch":"main","visibility":"private","archived":false,"empty_repo":false,"import_status":"finished","namespace":{"id":77,"name":"Owned reader","path":"owned-reader","full_path":"owned-reader","kind":"user"},"forked_from_project":{"id":101,"path_with_namespace":"team/upstream"},"private_token":"owned-private-token"})
                }
                _ => panic!("unexpected fixture read: {endpoint}"),
            })
        }
    }
    struct Fixture {
        root: PathBuf,
        journal: core::GitLabForkJournal,
        accounts: GitLabAccounts,
        calls: Arc<Mutex<Vec<String>>>,
        record: core::GitLabForkRecord,
    }
    impl Fixture {
        fn new(account_id: u64, fail_storage: bool) -> Self {
            use std::os::unix::fs::DirBuilderExt;
            let root = std::env::temp_dir().join(format!(
                "git-khronos-fork-inspect-{}",
                crate::gitlab_commands::identifier().unwrap()
            ));
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&root)
                .unwrap();
            let journal =
                core::GitLabForkJournal::open(&root.join("journal"), unsafe { libc::geteuid() })
                    .unwrap();
            let record = core::GitLabForkRecord::new(
                "b".repeat(32),
                core::GitLabForkIntent {
                    origin: "https://gitlab.example.test".into(),
                    account_id: "41".into(),
                    account_login: "owned-reader".into(),
                    source_id: "101".into(),
                    source_full_path: "team/upstream".into(),
                    source_empty: Some(false),
                    namespace_id: "77".into(),
                    namespace_full_path: "owned-reader".into(),
                    namespace_kind: core::GitLabNamespaceKind::User,
                    project_path: "reviewed-fork".into(),
                    project_name: None,
                },
                "1793598000000".into(),
            )
            .unwrap();
            drop(journal.begin(&record).unwrap());
            let accounts = GitLabAccounts::default();
            let calls = Arc::new(Mutex::new(Vec::new()));
            let instance = core::GitLabInstance::parse("https://gitlab.example.test").unwrap();
            let view = accounts.fixture_connection(
                CONNECTION.into(),
                instance,
                core::GitLabAccount {
                    origin: "https://gitlab.example.test".into(),
                    id: account_id.to_string(),
                    login: "owned-reader".into(),
                },
                Box::new(Reader {
                    calls: calls.clone(),
                    account_id,
                    root: root.clone(),
                    fail_storage,
                }),
                None,
            );
            assert!(!view.can_create_fork);
            Self {
                root,
                journal,
                accounts,
                calls,
                record,
            }
        }
        fn request(&self, version: &str) -> ReconcileForkRequest {
            ReconcileForkRequest {
                connection_id: CONNECTION.into(),
                record_id: self.record.id.clone(),
                expected_revision: version.into(),
                operation_id: "owned-reconcile".into(),
            }
        }
        fn retire_request(&self, version: &str, ack: bool) -> RetireForkRequest {
            RetireForkRequest {
                record_id: self.record.id.clone(),
                expected_revision: version.into(),
                acknowledge_unconfirmed: ack,
                operation_id: "owned-retire".into(),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.accounts.disconnect(CONNECTION).unwrap();
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }
    #[test]
    fn fork_recovery_lists_records_after_reopen_as_data_without_provider_calls_or_tokens() {
        let f = Fixture::new(41, false);
        let reopened =
            core::GitLabForkJournal::open(&f.root.join("journal"), unsafe { libc::geteuid() })
                .unwrap();
        let listed = inspect(&reopened, &CancellationToken::default()).unwrap();
        assert_eq!(listed.entries.len(), 1);
        assert!(listed.issues.is_empty());
        assert_eq!(
            listed.entries[0].record.as_ref().unwrap().phase,
            core::GitLabForkPhase::AwaitingConfirmation
        );
        let output = serde_json::to_string(&listed).unwrap();
        for forbidden in [
            "token",
            "credential",
            "endpoint",
            "directory",
            "dispatchAuthority",
        ] {
            assert!(!output.contains(forbidden));
        }
        assert!(f.calls.lock().unwrap().is_empty());
    }
    #[test]
    fn fork_recovery_read_connection_can_verify_and_append_without_submission_authority() {
        let f = Fixture::new(41, false);
        let result = reconcile(
            &f.accounts,
            &f.journal,
            f.request("1"),
            &CancellationToken::default(),
        )
        .unwrap();
        assert!(result.persisted);
        assert_eq!(
            result.observation.phase,
            core::GitLabForkPhase::MetadataVerified
        );
        assert_eq!(result.observation.project_id.as_deref(), Some("202"));
        let record = f
            .journal
            .load(&f.record.id)
            .unwrap()
            .unwrap()
            .record
            .unwrap();
        assert_eq!(record.revision, "2");
        assert_eq!(record.intent, f.record.intent);
        let text = serde_json::to_string(&result).unwrap();
        assert!(!text.contains("owned-private"));
        assert_eq!(f.calls.lock().unwrap().len(), 5);
    }
    #[test]
    fn fork_recovery_stale_revision_active_lease_and_wrong_account_stop_before_provider_reads() {
        let f = Fixture::new(41, false);
        assert!(
            reconcile(
                &f.accounts,
                &f.journal,
                f.request("2"),
                &CancellationToken::default()
            )
            .is_err()
        );
        let lease = f.journal.lease(&f.record.id, "1").unwrap();
        assert!(
            reconcile(
                &f.accounts,
                &f.journal,
                f.request("1"),
                &CancellationToken::default()
            )
            .is_err()
        );
        drop(lease);
        assert!(f.calls.lock().unwrap().is_empty());
        let wrong = Fixture::new(42, false);
        assert!(
            reconcile(
                &wrong.accounts,
                &wrong.journal,
                wrong.request("1"),
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(wrong.calls.lock().unwrap().is_empty());
    }
    #[test]
    fn fork_recovery_failed_append_reports_unsaved_observation_and_retains_old_disk_revision() {
        let f = Fixture::new(41, true);
        let result = reconcile(
            &f.accounts,
            &f.journal,
            f.request("1"),
            &CancellationToken::default(),
        )
        .unwrap();
        assert!(!result.persisted);
        assert_eq!(result.observation.revision, "2");
        let record = f
            .journal
            .load(&f.record.id)
            .unwrap()
            .unwrap()
            .record
            .unwrap();
        assert_eq!(record.revision, "1");
        assert!(record.project_id.is_none());
        assert_eq!(
            std::fs::read(f.root.join("journal/unknown-entry")).unwrap(),
            b"owned storage witness"
        );
    }
    #[test]
    fn fork_recovery_retirement_requires_explicit_uncertainty_ack_and_preserves_archive() {
        let f = Fixture::new(41, false);
        assert!(
            retire(
                &f.journal,
                f.retire_request("1", false),
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(
            retire(
                &f.journal,
                f.retire_request("1", true),
                &CancellationToken::default()
            )
            .unwrap()
        );
        let view = inspect(&f.journal, &CancellationToken::default()).unwrap();
        assert!(view.entries[0].retired);
        assert_eq!(view.entries[0].record.as_ref().unwrap().revision, "1");
        assert!(
            f.root
                .join("journal")
                .join(&f.record.id)
                .join("1.json")
                .is_file()
        );
        assert!(f.calls.lock().unwrap().is_empty());
        assert!(
            reconcile(
                &f.accounts,
                &f.journal,
                f.request("1"),
                &CancellationToken::default()
            )
            .is_err()
        );
    }
    #[test]
    fn fork_recovery_verified_retirement_and_pre_cancelled_actions_do_not_contact_provider() {
        let f = Fixture::new(41, false);
        let cancelled = CancellationToken::default();
        cancelled.cancel();
        assert!(inspect(&f.journal, &cancelled).is_err());
        assert!(retire(&f.journal, f.retire_request("1", true), &cancelled).is_err());
        assert!(reconcile(&f.accounts, &f.journal, f.request("1"), &cancelled).is_err());
        assert!(f.calls.lock().unwrap().is_empty());
        let result = reconcile(
            &f.accounts,
            &f.journal,
            f.request("1"),
            &CancellationToken::default(),
        )
        .unwrap();
        assert!(result.persisted);
        assert!(
            retire(
                &f.journal,
                f.retire_request("2", false),
                &CancellationToken::default()
            )
            .unwrap()
        );
        assert_eq!(f.calls.lock().unwrap().len(), 5);
    }
    #[test]
    fn fork_recovery_unknown_storage_is_reported_and_not_silently_deleted() {
        let f = Fixture::new(41, false);
        std::fs::write(f.root.join("journal/unknown-entry"), b"retained").unwrap();
        let view = inspect(&f.journal, &CancellationToken::default()).unwrap();
        assert!(
            view.issues
                .iter()
                .any(|i| matches!(i.kind, ForkStorageIssueKind::UnknownEntry))
        );
        assert_eq!(
            std::fs::read(f.root.join("journal/unknown-entry")).unwrap(),
            b"retained"
        );
        assert!(f.calls.lock().unwrap().is_empty());
    }
}
