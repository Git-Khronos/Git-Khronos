use super::*;
use crate::{GitLabForkIntent, GitLabForkPhase, GitLabNamespaceKind};
use serde_json::json;
use std::collections::VecDeque;

struct Reads {
    values: VecDeque<Value>,
    calls: Vec<String>,
    fail_at: Option<usize>,
    cancel_at: Option<usize>,
}
impl GitLabReadTransport for Reads {
    fn get(
        &mut self,
        _: &GitLabInstance,
        endpoint: &str,
        cancellation: &CancellationToken,
    ) -> Result<Value, AppError> {
        self.calls.push(endpoint.into());
        if self.cancel_at == Some(self.calls.len()) {
            cancellation.cancel();
        }
        if self.fail_at == Some(self.calls.len()) {
            return Err(AppError::new(
                "gitlabNotFound",
                "owned-secret-upstream-diagnostic",
                None,
            ));
        }
        Ok(self
            .values
            .pop_front()
            .expect("unexpected owned provider read"))
    }
}
fn instance() -> GitLabInstance {
    GitLabInstance::parse("https://gitlab.example.test:8443").unwrap()
}
fn account() -> GitLabAccount {
    GitLabAccount {
        origin: instance().origin().into(),
        id: "41".into(),
        login: "owned-reader".into(),
    }
}
fn record() -> GitLabForkRecord {
    GitLabForkRecord::new(
        "a".repeat(32),
        GitLabForkIntent {
            origin: instance().origin().into(),
            account_id: "41".into(),
            account_login: "owned-reader".into(),
            source_id: "101".into(),
            source_full_path: "team/upstream".into(),
            source_empty: Some(false),
            namespace_id: "9007199254740993".into(),
            namespace_full_path: "owned-reader".into(),
            namespace_kind: GitLabNamespaceKind::User,
            project_path: "reviewed-fork".into(),
            project_name: Some("Owned fork".into()),
        },
        "1793598000000".into(),
    )
    .unwrap()
}
fn reads() -> Reads {
    let user = json!({"id":41,"username":"owned-reader"});
    let namespace = json!({"id":9007199254740993u64,"name":"Owned reader","path":"owned-reader","full_path":"owned-reader","kind":"user"});
    let source = json!({"id":101,"name":"Upstream","path_with_namespace":"team/upstream","web_url":"https://gitlab.example.test:8443/team/upstream",
        "description":null,"default_branch":"main","visibility":"private","archived":false});
    let destination = json!({"id":202,"name":"Owned fork","path_with_namespace":"owned-reader/reviewed-fork","web_url":"https://gitlab.example.test:8443/owned-reader/reviewed-fork",
        "description":"owned-secret-provider-description","default_branch":"main","visibility":"private","archived":false,
        "namespace":namespace.clone(),"forked_from_project":{"id":101,"path_with_namespace":"team/upstream"},
        "empty_repo":false,"import_status":"finished","private_token":"owned-secret-token"});
    Reads {
        values: vec![user.clone(), source, namespace, destination, user].into(),
        calls: vec![],
        fail_at: None,
        cancel_at: None,
    }
}
fn inspect(r: &GitLabForkRecord, reads: &mut Reads) -> GitLabForkRecord {
    reconcile_gitlab_fork_with(
        reads,
        &instance(),
        &account(),
        r,
        "1793598000001",
        &CancellationToken::default(),
    )
    .unwrap()
}
#[test]
fn fork_reconcile_lost_reply_looks_up_exact_destination_and_binds_only_verified_metadata() {
    let original = record();
    let mut reader = reads();
    let next = inspect(&original, &mut reader);
    assert_eq!(
        reader.calls,
        [
            "user",
            "projects/101",
            "namespaces/9007199254740993",
            "projects/owned-reader%2Freviewed-fork",
            "user"
        ]
    );
    assert_eq!(next.phase, GitLabForkPhase::MetadataVerified);
    assert_eq!(next.project_id.as_deref(), Some("202"));
    assert_eq!(next.intent, original.intent);
    assert!(original.project_id.is_none());
    let saved = serde_json::to_string(&next).unwrap();
    assert!(!saved.contains("owned-secret"));
    assert!(!saved.contains("endpoint"));
}
#[test]
fn fork_reconcile_known_project_is_read_by_stable_id_without_destination_fallback() {
    let original = record()
        .observe_verified(
            "202",
            GitLabForkImportState::Finished,
            Some(false),
            "1793598000000",
        )
        .unwrap();
    let mut reader = reads();
    reader.values[3]["id"] = json!(303);
    let next = inspect(&original, &mut reader);
    assert_eq!(next.phase, GitLabForkPhase::Conflict);
    assert_eq!(next.project_id.as_deref(), Some("202"));
    assert_eq!(reader.calls[3], "projects/202");
    let mut absent = reads();
    absent.fail_at = Some(4);
    let next = inspect(&original, &mut absent);
    assert_eq!(next.phase, GitLabForkPhase::AcceptedPending);
    assert_eq!(next.project_id.as_deref(), Some("202"));
    assert_eq!(next.import_state, GitLabForkImportState::Unknown);
    assert_eq!(absent.calls.len(), 4);
}
#[test]
fn fork_reconcile_different_connection_origin_or_account_refuses_before_io() {
    for expected in [
        GitLabAccount {
            id: "42".into(),
            ..account()
        },
        GitLabAccount {
            origin: "https://other.example.test".into(),
            ..account()
        },
    ] {
        let mut reader = reads();
        assert!(
            reconcile_gitlab_fork_with(
                &mut reader,
                &instance(),
                &expected,
                &record(),
                "1793598000001",
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(reader.calls.is_empty());
    }
    let mut invalid = record();
    invalid.revision = "18446744073709551615".into();
    let mut reader = reads();
    assert!(
        reconcile_gitlab_fork_with(
            &mut reader,
            &instance(),
            &account(),
            &invalid,
            "1793598000001",
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(reader.calls.is_empty());
}
#[test]
fn fork_reconcile_changed_display_login_keeps_original_stable_account_and_intent() {
    let expected = GitLabAccount {
        login: "renamed-reader".into(),
        ..account()
    };
    let mut reader = reads();
    reader.values[0]["username"] = json!("renamed-reader");
    reader.values[4]["username"] = json!("renamed-reader");
    let next = reconcile_gitlab_fork_with(
        &mut reader,
        &instance(),
        &expected,
        &record(),
        "1793598000001",
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(next.phase, GitLabForkPhase::MetadataVerified);
    assert_eq!(next.intent.account_login, "owned-reader");
    assert_eq!(next.intent.account_id, "41");
}
#[test]
fn fork_reconcile_account_substitution_at_either_boundary_is_not_a_verified_observation() {
    for at in [0, 4] {
        let mut reader = reads();
        reader.values[at]["id"] = json!(42);
        assert_eq!(
            reconcile_gitlab_fork_with(
                &mut reader,
                &instance(),
                &account(),
                &record(),
                "1793598000001",
                &CancellationToken::default()
            )
            .unwrap_err()
            .kind,
            ACCOUNT_CHANGED
        );
    }
}
#[test]
fn fork_reconcile_source_namespace_destination_and_parent_path_substitutions_are_conflicts() {
    for (at, field, value) in [
        (1, "id", json!(303)),
        (2, "id", json!(9007199254740994u64)),
        (3, "path_with_namespace", json!("owned-reader/another")),
    ] {
        let mut reader = reads();
        reader.values[at][field] = value;
        if field == "path_with_namespace" {
            reader.values[at]["web_url"] =
                json!("https://gitlab.example.test:8443/owned-reader/another");
        }
        assert_eq!(
            inspect(&record(), &mut reader).phase,
            GitLabForkPhase::Conflict
        );
    }
    let mut reader = reads();
    reader.values[3]["namespace"]["id"] = json!(999);
    assert_eq!(
        inspect(&record(), &mut reader).phase,
        GitLabForkPhase::Conflict
    );
    let mut reader = reads();
    reader.values[3]["forked_from_project"]["path_with_namespace"] = json!("team/another");
    assert_eq!(
        inspect(&record(), &mut reader).phase,
        GitLabForkPhase::Conflict
    );
}
#[test]
fn fork_reconcile_hidden_or_indirect_relationship_and_malformed_metadata_stay_unconfirmed() {
    for replacement in [
        Value::Null,
        json!({"id":303,"path_with_namespace":"team/ancestor"}),
        json!({"id":101}),
    ] {
        let mut reader = reads();
        reader.values[3]["forked_from_project"] = replacement;
        let next = inspect(&record(), &mut reader);
        assert_eq!(next.phase, GitLabForkPhase::AwaitingConfirmation);
        assert!(next.project_id.is_none());
    }
    for (key, value) in [("empty_repo", json!("true")), ("namespace", Value::Null)] {
        let mut reader = reads();
        reader.values[3][key] = value;
        assert_eq!(
            inspect(&record(), &mut reader).phase,
            GitLabForkPhase::AwaitingConfirmation
        );
    }
}
#[test]
fn fork_reconcile_unknown_or_pending_import_never_infers_readiness_from_default_branch() {
    for state in [
        Value::Null,
        json!("none"),
        json!("scheduled"),
        json!("started"),
        json!("provider-future-value"),
    ] {
        let mut reader = reads();
        reader.values[3]["import_status"] = state;
        let next = inspect(&record(), &mut reader);
        assert_eq!(next.phase, GitLabForkPhase::AcceptedPending);
        assert_eq!(next.project_id.as_deref(), Some("202"));
    }
    let mut reader = reads();
    reader.values[3]["import_status"] = json!("failed");
    assert_eq!(
        inspect(&record(), &mut reader).phase,
        GitLabForkPhase::ImportFailed
    );
}
#[test]
fn fork_reconcile_empty_fork_requires_explicit_original_and_current_empty_facts() {
    for original_empty in [None, Some(false), Some(true)] {
        let mut original = record();
        original.intent.source_empty = original_empty;
        let mut reader = reads();
        reader.values[3]["import_status"] = json!("none");
        reader.values[3]["empty_repo"] = json!(true);
        reader.values[3]["default_branch"] = Value::Null;
        let next = inspect(&original, &mut reader);
        assert_eq!(
            next.phase,
            if original_empty == Some(true) {
                GitLabForkPhase::MetadataVerified
            } else {
                GitLabForkPhase::AcceptedPending
            }
        );
    }
}
#[test]
fn fork_reconcile_not_found_or_cancelled_reads_never_prove_absence_or_repeat_submission() {
    let original = record();
    for at in 2..=5 {
        let mut reader = reads();
        reader.fail_at = Some(at);
        let next = inspect(&original, &mut reader);
        assert_eq!(next.phase, GitLabForkPhase::AwaitingConfirmation);
        assert!(next.project_id.is_none());
        assert!(
            !serde_json::to_string(&next)
                .unwrap()
                .contains("owned-secret")
        );
    }
    for at in 1..=5 {
        let cancellation = CancellationToken::default();
        let mut reader = reads();
        reader.cancel_at = Some(at);
        let next = reconcile_gitlab_fork_with(
            &mut reader,
            &instance(),
            &account(),
            &original,
            "1793598000001",
            &cancellation,
        );
        assert!(cancellation.is_cancelled());
        assert_eq!(reader.calls.len(), at);
        if let Ok(next) = next {
            assert_ne!(next.phase, GitLabForkPhase::MetadataVerified);
        }
    }
}
#[test]
fn fork_reconcile_matching_existing_project_is_metadata_evidence_not_creation_receipt() {
    let rejected = record().rejected(403, "1793598000000").unwrap();
    let next = inspect(&rejected, &mut reads());
    assert_eq!(next.phase, GitLabForkPhase::MetadataVerified);
    assert_eq!(next.http_status, Some(403));
    assert_eq!(next.intent, rejected.intent);
}
