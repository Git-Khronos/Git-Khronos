use super::*;
use crate::GitLabNamespaceKind;
use serde_json::{Value, json};
use std::collections::VecDeque;
struct Reads {
    values: VecDeque<Value>,
    calls: Vec<String>,
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
        Ok(self
            .values
            .pop_front()
            .expect("unexpected owned fixture read"))
    }
}
fn instance() -> GitLabInstance {
    GitLabInstance::parse("https://gitlab.example.test:8443").unwrap()
}
fn expected() -> GitLabAccount {
    GitLabAccount {
        origin: instance().origin().into(),
        id: "7".into(),
        login: "owned-reader".into(),
    }
}
fn user() -> Value {
    json!({"id":7,"username":"owned-reader"})
}
fn source(empty: Option<bool>) -> Value {
    let mut v = json!({"id":101,"name":"Owned source","path_with_namespace":"team/upstream",
        "web_url":"https://gitlab.example.test:8443/team/upstream","description":null,
        "default_branch":"main","visibility":"private","archived":false,
        "private_token":"owned-secret-marker"});
    if let Some(empty) = empty {
        v["empty_repo"] = json!(empty);
    }
    v
}
fn namespace() -> Value {
    json!({"id":9007199254740993u64,"name":"Destination","path":"nested",
        "full_path":"group/nested","kind":"group","can_create_project":true,
        "private_token":"owned-secret-marker"})
}
fn request() -> GitLabForkPrepareRequest {
    GitLabForkPrepareRequest {
        source_id: "101".into(),
        source_full_path: "team/upstream".into(),
        namespace: GitLabNamespaceSelection {
            id: "9007199254740993".into(),
            full_path: "group/nested".into(),
            kind: GitLabNamespaceKind::Group,
        },
        project_path: "reviewed-fork".into(),
        project_name: Some("Reviewed fork".into()),
    }
}
fn reads(empty: Option<bool>) -> Reads {
    Reads {
        values: vec![user(), source(empty), user(), namespace(), user(), user()].into(),
        calls: Vec::new(),
        cancel_at: None,
    }
}
fn plan(empty: Option<bool>) -> GitLabForkPlan {
    prepare_gitlab_fork_with(
        &mut reads(empty),
        &instance(),
        &expected(),
        request(),
        &CancellationToken::default(),
    )
    .unwrap()
}
#[test]
fn fork_plan_retains_exact_wide_destination_without_provider_secrets_or_write_claims() {
    let mut transport = reads(Some(false));
    let p = prepare_gitlab_fork_with(
        &mut transport,
        &instance(),
        &expected(),
        request(),
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(
        transport.calls,
        [
            "user",
            "projects/101",
            "user",
            "namespaces/9007199254740993",
            "user",
            "user"
        ]
    );
    assert_eq!(p.intent().namespace_id, "9007199254740993");
    assert_eq!(p.intent().target_full_path(), "group/nested/reviewed-fork");
    assert_eq!(p.preview().source_empty, Some(false));
    let text = serde_json::to_string(p.preview()).unwrap();
    for forbidden in [
        "owned-secret-marker",
        "can_create_project",
        "credential",
        "token",
        "endpoint",
    ] {
        assert!(!text.contains(forbidden));
    }
    let dispatch = revalidate_gitlab_fork_with(
        &mut reads(Some(false)),
        &instance(),
        &expected(),
        &p,
        &CancellationToken::default(),
    )
    .unwrap();
    let body: Value = serde_json::from_slice(&dispatch.body().unwrap()).unwrap();
    assert_eq!(
        body,
        json!({"namespace_id":9007199254740993u64,"path":"reviewed-fork","name":"Reviewed fork"})
    );
}
#[test]
fn fork_plan_rejects_invalid_selection_and_cross_instance_before_any_provider_read() {
    let mut bad = Vec::new();
    let mut r = request();
    r.source_id = "0101".into();
    bad.push(r);
    let mut r = request();
    r.namespace.full_path = "group/../nested".into();
    bad.push(r);
    let mut r = request();
    r.project_path = "../injected".into();
    bad.push(r);
    let mut r = request();
    r.project_path = " reviewed-fork ".into();
    bad.push(r);
    for r in bad {
        let mut t = reads(None);
        assert!(
            prepare_gitlab_fork_with(
                &mut t,
                &instance(),
                &expected(),
                r,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(t.calls.is_empty());
    }
    let mut account = expected();
    account.origin = "https://other.example.test".into();
    let mut t = reads(None);
    assert!(
        prepare_gitlab_fork_with(
            &mut t,
            &instance(),
            &account,
            request(),
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(t.calls.is_empty());
    let mut value = json!({"sourceId":"101","sourceFullPath":"team/upstream","namespace":{"id":"9007199254740993","fullPath":"group/nested","kind":"group"},"projectPath":"reviewed-fork","projectName":null});
    for key in [
        "token",
        "credential",
        "endpoint",
        "origin",
        "dispatchAuthority",
    ] {
        value[key] = json!("injected");
        assert!(serde_json::from_value::<GitLabForkPrepareRequest>(value.clone()).is_err());
        value.as_object_mut().unwrap().remove(key);
    }
}
#[test]
fn fork_plan_preparation_refuses_identity_substitutions_and_invalid_empty_state() {
    for (index, key, value) in [
        (1, "id", json!(102)),
        (1, "path_with_namespace", json!("moved/upstream")),
        (1, "empty_repo", json!("false")),
        (3, "id", json!(9007199254740995u64)),
        (3, "full_path", json!("moved/nested")),
        (3, "kind", json!("user")),
    ] {
        let mut t = reads(Some(false));
        t.values[index][key] = value;
        assert!(
            prepare_gitlab_fork_with(
                &mut t,
                &instance(),
                &expected(),
                request(),
                &CancellationToken::default()
            )
            .is_err()
        );
    }
    for index in [0, 2, 4, 5] {
        let mut t = reads(None);
        t.values[index]["id"] = json!(8);
        assert!(
            prepare_gitlab_fork_with(
                &mut t,
                &instance(),
                &expected(),
                request(),
                &CancellationToken::default()
            )
            .is_err()
        );
        assert_eq!(t.calls.len(), index + 1);
    }
}
#[test]
fn fork_plan_revalidation_checks_retained_account_source_namespace_and_empty_fact() {
    let p = plan(Some(false));
    for (index, key, value) in [
        (1, "id", json!(102)),
        (1, "path_with_namespace", json!("moved/upstream")),
        (1, "empty_repo", json!(true)),
        (3, "id", json!(9007199254740995u64)),
        (3, "full_path", json!("moved/nested")),
        (3, "kind", json!("user")),
    ] {
        let mut t = reads(Some(false));
        t.values[index][key] = value;
        assert!(
            revalidate_gitlab_fork_with(
                &mut t,
                &instance(),
                &expected(),
                &p,
                &CancellationToken::default()
            )
            .is_err()
        );
    }
    for index in [0, 2, 4, 5] {
        let mut t = reads(Some(false));
        t.values[index]["id"] = json!(8);
        assert!(
            revalidate_gitlab_fork_with(
                &mut t,
                &instance(),
                &expected(),
                &p,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert_eq!(t.calls.len(), index + 1);
    }
    let mut changed = expected();
    changed.id = "8".into();
    let mut t = reads(Some(false));
    assert!(
        revalidate_gitlab_fork_with(
            &mut t,
            &instance(),
            &changed,
            &p,
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(t.calls.is_empty());
    assert!(
        revalidate_gitlab_fork_with(
            &mut t,
            &GitLabInstance::parse("https://other.example.test").unwrap(),
            &expected(),
            &p,
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(t.calls.is_empty());
}
#[test]
fn fork_plan_preserves_unknown_and_empty_states_without_inventing_a_default_branch() {
    for empty in [None, Some(true), Some(false)] {
        let mut t = reads(empty);
        t.values[1]["default_branch"] = Value::Null;
        let p = prepare_gitlab_fork_with(
            &mut t,
            &instance(),
            &expected(),
            request(),
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(p.intent().source_empty, empty);
        assert_eq!(p.preview().source.default_branch, None);
        let mut t = reads(empty);
        t.values[1]["default_branch"] = json!("new-default");
        t.values[3]["name"] = json!("Renamed display label");
        let d = revalidate_gitlab_fork_with(
            &mut t,
            &instance(),
            &expected(),
            &p,
            &CancellationToken::default(),
        )
        .unwrap();
        let body: Value = serde_json::from_slice(&d.body().unwrap()).unwrap();
        assert!(body.get("branches").is_none());
        assert_eq!(body["path"], "reviewed-fork");
    }
}
#[test]
fn fork_plan_cancellation_stops_at_each_actual_read_and_never_dispatches() {
    for at in 0..=6 {
        let token = CancellationToken::default();
        let mut t = reads(None);
        if at == 0 {
            token.cancel();
        } else {
            t.cancel_at = Some(at);
        }
        assert!(
            prepare_gitlab_fork_with(&mut t, &instance(), &expected(), request(), &token).is_err()
        );
        assert_eq!(t.calls.len(), at);
        let p = plan(None);
        let token = CancellationToken::default();
        let mut t = reads(None);
        if at == 0 {
            token.cancel();
        } else {
            t.cancel_at = Some(at);
        }
        assert!(revalidate_gitlab_fork_with(&mut t, &instance(), &expected(), &p, &token).is_err());
        assert_eq!(t.calls.len(), at);
    }
}
