use super::*;
use serde_json::json;
use std::collections::VecDeque;

struct Reads {
    values: VecDeque<Value>,
    calls: Vec<String>,
    cancel_on_read: Option<usize>,
}
impl GitLabReadTransport for Reads {
    fn get(
        &mut self,
        _: &GitLabInstance,
        endpoint: &str,
        cancellation: &CancellationToken,
    ) -> Result<Value, AppError> {
        self.calls.push(endpoint.into());
        if self.cancel_on_read == Some(self.calls.len()) {
            cancellation.cancel();
        }
        Ok(self.values.pop_front().expect("Unexpected fixture read"))
    }
}
fn reads(values: Vec<Value>) -> Reads {
    Reads {
        values: values.into(),
        calls: Vec::new(),
        cancel_on_read: None,
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
fn group(id: u64, full_path: &str) -> Value {
    json!({"id":id,"name":"Owned namespace","path":full_path.rsplit('/').next().unwrap(),"full_path":full_path,"kind":"group"})
}
fn project(id: u64, full_path: &str) -> Value {
    json!({"id":id,"name":"Owned project","path_with_namespace":full_path,
        "web_url":format!("{}{full_path}",instance().origin().to_owned()+"/"),"description":null,
        "default_branch":"main","visibility":"private","archived":false,
        "http_url_to_repo":format!("https://git.example.test:9443/{full_path}.git"),
        "ssh_url_to_repo":format!("ssh://git@ssh.example.test:2222/{full_path}.git")})
}
fn source() -> Value {
    project(10, "team/upstream")
}
fn fork(state: &str) -> Value {
    let mut value = project(20, "group/nested/owned-fork");
    value["forked_from_project"] = json!({"id":10,"path_with_namespace":"team/upstream"});
    value["namespace"] = group(9007199254740993, "group/nested");
    value["import_status"] = state.into();
    value
}
fn selection() -> GitLabForkSelection {
    GitLabForkSelection {
        source_project_id: "10".into(),
        source_full_path: "team/upstream".into(),
        fork_project_id: "20".into(),
        fork_full_path: "group/nested/owned-fork".into(),
    }
}
fn query() -> GitLabForkQuery {
    GitLabForkQuery {
        source_project_id: "10".into(),
        source_full_path: "team/upstream".into(),
        page: 1,
        search: String::new(),
    }
}

#[test]
fn gitlab_forks_namespace_inspection_freshly_binds_personal_and_nested_identities_without_write_claims()
 {
    for (full_path, kind) in [
        ("owned-reader", GitLabNamespaceKind::User),
        ("team/nested", GitLabNamespaceKind::Group),
    ] {
        let mut value = group(9007199254740993, full_path);
        value["kind"] = json!(if kind == GitLabNamespaceKind::User {
            "user"
        } else {
            "group"
        });
        value["name"] = json!("Updated display name");
        value["can_create_project"] = json!(true);
        value["private_token"] = json!("owned-secret-marker");
        let mut transport = reads(vec![user(), value, user()]);
        let inspected = inspect_gitlab_namespace_with(
            &mut transport,
            &instance(),
            &expected(),
            &GitLabNamespaceSelection {
                id: "9007199254740993".into(),
                full_path: full_path.into(),
                kind,
            },
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(inspected.namespace.id, "9007199254740993");
        assert_eq!(inspected.namespace.full_path, full_path);
        assert_eq!(inspected.namespace.kind, kind);
        assert_eq!(inspected.namespace.name, "Updated display name");
        assert_eq!(inspected.account, expected());
        assert_eq!(
            transport.calls,
            ["user", "namespaces/9007199254740993", "user"]
        );
        let encoded = serde_json::to_string(&inspected).unwrap();
        assert!(
            !encoded.contains("can_create_project") && !encoded.contains("owned-secret-marker")
        );
    }
}

#[test]
fn gitlab_forks_namespace_inspection_refuses_renames_transfers_type_changes_and_account_switches() {
    let selection = GitLabNamespaceSelection {
        id: "9007199254740993".into(),
        full_path: "team/nested".into(),
        kind: GitLabNamespaceKind::Group,
    };
    let original = group(9007199254740993, "team/nested");
    for mut changed in [
        group(9007199254740995, "team/nested"),
        group(9007199254740993, "moved/nested"),
        group(9007199254740993, "team/nested"),
    ] {
        if changed == original {
            changed["kind"] = json!("user");
        }
        let mut transport = reads(vec![user(), changed]);
        assert!(
            inspect_gitlab_namespace_with(
                &mut transport,
                &instance(),
                &expected(),
                &selection,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert_eq!(transport.calls.len(), 2);
    }
    for switched_before in [true, false] {
        let other = json!({"id":8,"username":"other"});
        let mut transport = reads(if switched_before {
            vec![other]
        } else {
            vec![user(), original.clone(), other]
        });
        assert!(
            inspect_gitlab_namespace_with(
                &mut transport,
                &instance(),
                &expected(),
                &selection,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert_eq!(transport.calls.len(), if switched_before { 1 } else { 3 });
    }
}

#[test]
fn gitlab_forks_namespace_inspection_rejects_invalid_selection_before_io_and_cancellation_stops_reads()
 {
    for (id, full_path, kind) in [
        ("01", "team/nested", GitLabNamespaceKind::Group),
        ("0", "owned", GitLabNamespaceKind::User),
        ("18446744073709551616", "owned", GitLabNamespaceKind::User),
        ("9", "team/../nested", GitLabNamespaceKind::Group),
        ("9", "team/nested", GitLabNamespaceKind::User),
    ] {
        let mut transport = reads(vec![]);
        assert!(
            inspect_gitlab_namespace_with(
                &mut transport,
                &instance(),
                &expected(),
                &GitLabNamespaceSelection {
                    id: id.into(),
                    full_path: full_path.into(),
                    kind
                },
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(transport.calls.is_empty());
    }
    let selection = GitLabNamespaceSelection {
        id: "9".into(),
        full_path: "team/nested".into(),
        kind: GitLabNamespaceKind::Group,
    };
    for cancel_at in [1, 2] {
        let mut transport = reads(vec![user(), group(9, "team/nested")]);
        transport.cancel_on_read = Some(cancel_at);
        assert_eq!(
            inspect_gitlab_namespace_with(
                &mut transport,
                &instance(),
                &expected(),
                &selection,
                &CancellationToken::default()
            )
            .unwrap_err()
            .kind,
            "operationCancelled"
        );
        assert_eq!(transport.calls.len(), cancel_at);
    }
    for field in ["canCreateProject", "token", "origin", "endpoint"] {
        let mut value = json!({"id":"9","fullPath":"team/nested","kind":"group"});
        value[field] = json!("forged");
        assert!(serde_json::from_value::<GitLabNamespaceSelection>(value).is_err());
    }
}

#[test]
fn gitlab_forks_namespaces_preserve_wide_ids_nested_paths_and_literal_search_without_writes() {
    let mut transport = reads(vec![
        user(),
        json!([group(9007199254740993, "group/nested")]),
        user(),
    ]);
    let page = load_gitlab_namespace_page_with(
        &mut transport,
        &instance(),
        &expected(),
        GitLabNamespaceQuery {
            search: "café & owned_only=false # path".into(),
            owned_only: true,
            ..Default::default()
        },
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(page.entries[0].id, "9007199254740993");
    assert_eq!(page.entries[0].full_path, "group/nested");
    assert_eq!(page.next_page, None);
    assert_eq!(page.account, expected());
    assert_eq!(transport.calls.len(), 3);
    let parsed = url::Url::parse(&format!(
        "{}/api/v4/{}",
        instance().origin(),
        transport.calls[1]
    ))
    .unwrap();
    assert_eq!(parsed.path(), "/api/v4/namespaces");
    let pairs: Vec<_> = parsed.query_pairs().collect();
    assert_eq!(
        pairs.iter().filter(|(key, _)| key == "owned_only").count(),
        1
    );
    assert!(
        pairs
            .iter()
            .any(|(key, value)| key == "search" && value == "café & owned_only=false # path")
    );
    assert!(
        pairs
            .iter()
            .any(|(key, value)| key == "owned_only" && value == "true")
    );
}

#[test]
fn gitlab_forks_namespace_candidates_never_imply_write_access_and_full_page_is_bounded() {
    let entries: Vec<_> = (1..=20).map(|n| group(n, &format!("owned-{n}"))).collect();
    let mut transport = reads(vec![user(), json!(entries), user()]);
    let page = load_gitlab_namespace_page_with(
        &mut transport,
        &instance(),
        &expected(),
        GitLabNamespaceQuery::default(),
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(page.entries.len(), 20);
    assert_eq!(page.next_page, Some(2));
    let serialized = serde_json::to_value(&page).unwrap();
    assert!(serialized["entries"][0].get("canCreateProject").is_none());
    let mut transport = reads(vec![
        user(),
        json!(
            (1..=21)
                .map(|n| group(n, &format!("owned-{n}")))
                .collect::<Vec<_>>()
        ),
    ]);
    assert!(
        load_gitlab_namespace_page_with(
            &mut transport,
            &instance(),
            &expected(),
            GitLabNamespaceQuery::default(),
            &CancellationToken::default()
        )
        .is_err()
    );
}

#[test]
fn gitlab_forks_namespace_duplicates_malformed_paths_and_unknown_kinds_refuse_whole_page() {
    let base = group(9, "group/nested");
    for bad in [
        json!([base.clone(), base.clone()]),
        json!([base.clone(), group(10, "group/nested")]),
        json!([{"id":10,"name":"Bad","path":"nested","full_path":"group/../nested","kind":"group"}]),
        json!([{"id":10,"name":"Bad","path":"other","full_path":"group/nested","kind":"group"}]),
        json!([{"id":10,"name":"Bad","path":"nested","full_path":"group/nested","kind":"user"}]),
        json!([{"id":10,"name":"Bad","path":"nested","full_path":"nested","kind":"future"}]),
    ] {
        let mut transport = reads(vec![user(), bad]);
        assert!(
            load_gitlab_namespace_page_with(
                &mut transport,
                &instance(),
                &expected(),
                GitLabNamespaceQuery::default(),
                &CancellationToken::default()
            )
            .is_err()
        );
    }
}

#[test]
fn gitlab_forks_page_is_stable_id_and_account_bound_and_candidates_require_fresh_inspection() {
    let mut transport = reads(vec![
        user(),
        source(),
        json!([project(20, "group/nested/owned-fork")]),
        user(),
    ]);
    let page = load_gitlab_fork_page_with(
        &mut transport,
        &instance(),
        &expected(),
        query(),
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.source.id, "10");
    assert_eq!(
        transport.calls,
        vec![
            "user",
            "projects/10",
            "projects/10/forks?per_page=20&page=1&order_by=id&sort=asc",
            "user"
        ]
    );
    let mut transport = reads(vec![
        user(),
        source(),
        project(20, "group/nested/owned-fork"),
    ]);
    assert!(
        inspect_gitlab_fork_with(
            &mut transport,
            &instance(),
            &expected(),
            &selection(),
            &CancellationToken::default()
        )
        .is_err()
    );
}

#[test]
fn gitlab_forks_page_refuses_duplicates_source_itself_moved_projects_and_cross_origin_metadata() {
    for candidates in [
        json!([fork("finished"), fork("finished")]),
        json!([source()]),
        json!([{"id":20,"name":"Foreign","path_with_namespace":"other/project","web_url":"https://other.test/other/project","archived":false,"visibility":"private"}]),
    ] {
        let mut transport = reads(vec![user(), source(), candidates]);
        assert!(
            load_gitlab_fork_page_with(
                &mut transport,
                &instance(),
                &expected(),
                query(),
                &CancellationToken::default()
            )
            .is_err()
        );
    }
    let mut moved = source();
    moved["path_with_namespace"] = "moved/upstream".into();
    moved["web_url"] = "https://gitlab.example.test:8443/moved/upstream".into();
    let mut transport = reads(vec![user(), moved]);
    assert!(
        load_gitlab_fork_page_with(
            &mut transport,
            &instance(),
            &expected(),
            query(),
            &CancellationToken::default()
        )
        .is_err()
    );
}

#[test]
fn gitlab_forks_inspection_preserves_import_states_and_separate_advertised_git_hosts() {
    for (state, expected_state) in [
        ("none", GitLabForkImportState::None),
        ("scheduled", GitLabForkImportState::Scheduled),
        ("started", GitLabForkImportState::Started),
        ("finished", GitLabForkImportState::Finished),
        ("failed", GitLabForkImportState::Failed),
        ("future-state", GitLabForkImportState::Unknown),
    ] {
        let mut transport = reads(vec![user(), source(), fork(state), user()]);
        let result = inspect_gitlab_fork_with(
            &mut transport,
            &instance(),
            &expected(),
            &selection(),
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(result.import_state, expected_state);
        assert_eq!(result.namespace.id, "9007199254740993");
        assert_eq!(
            result.clone_https.as_deref(),
            Some("https://git.example.test:9443/group/nested/owned-fork.git")
        );
        assert_eq!(
            result.clone_ssh.as_deref(),
            Some("ssh://git@ssh.example.test:2222/group/nested/owned-fork.git")
        );
        assert_eq!(
            transport.calls,
            vec!["user", "projects/10", "projects/20", "user"]
        );
    }
}

#[test]
fn gitlab_forks_inspection_refuses_changed_upstream_namespace_and_credentialled_transport() {
    for (field, bad) in [
        (
            "forked_from_project",
            json!({"id":11,"path_with_namespace":"team/upstream"}),
        ),
        (
            "forked_from_project",
            json!({"id":10,"path_with_namespace":"other/upstream"}),
        ),
        ("namespace", group(22, "other")),
        (
            "http_url_to_repo",
            json!("https://secret@git.example.test/group/nested/owned-fork.git"),
        ),
        (
            "ssh_url_to_repo",
            json!("ssh://git:secret@ssh.example.test/group/nested/owned-fork.git"),
        ),
    ] {
        let mut value = fork("finished");
        value[field] = bad;
        let mut transport = reads(vec![user(), source(), value]);
        let error = inspect_gitlab_fork_with(
            &mut transport,
            &instance(),
            &expected(),
            &selection(),
            &CancellationToken::default(),
        )
        .unwrap_err();
        assert!(!format!("{error:?}").contains("secret"));
    }
}

#[test]
fn gitlab_forks_reads_revalidate_account_after_metadata_and_honor_cancellation_without_further_reads()
 {
    let other = json!({"id":8,"username":"other"});
    let mut transport = reads(vec![user(), source(), fork("finished"), other]);
    assert!(
        inspect_gitlab_fork_with(
            &mut transport,
            &instance(),
            &expected(),
            &selection(),
            &CancellationToken::default()
        )
        .is_err()
    );
    let token = CancellationToken::default();
    let mut transport = reads(vec![user(), source()]);
    transport.cancel_on_read = Some(2);
    assert_eq!(
        inspect_gitlab_fork_with(
            &mut transport,
            &instance(),
            &expected(),
            &selection(),
            &token
        )
        .unwrap_err()
        .kind,
        "operationCancelled"
    );
    assert_eq!(transport.calls, vec!["user", "projects/10"]);
    let mut transport = reads(vec![]);
    let token = CancellationToken::default();
    token.cancel();
    assert!(
        load_gitlab_namespace_page_with(
            &mut transport,
            &instance(),
            &expected(),
            GitLabNamespaceQuery::default(),
            &token
        )
        .is_err()
    );
    assert!(transport.calls.is_empty());
}

#[test]
fn gitlab_forks_invalid_page_identity_origin_and_unknown_input_fields_refuse_before_io() {
    for page in [0, 1001] {
        let mut transport = reads(vec![]);
        let mut request = query();
        request.page = page;
        assert!(
            load_gitlab_fork_page_with(
                &mut transport,
                &instance(),
                &expected(),
                request,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(transport.calls.is_empty());
    }
    for bad in ["0", "01", "../1", "18446744073709551616"] {
        let mut transport = reads(vec![]);
        let mut request = query();
        request.source_project_id = bad.into();
        assert!(
            load_gitlab_fork_page_with(
                &mut transport,
                &instance(),
                &expected(),
                request,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(transport.calls.is_empty());
    }
    let mut transport = reads(vec![]);
    let mut account = expected();
    account.origin = "https://other.test".into();
    assert!(
        load_gitlab_namespace_page_with(
            &mut transport,
            &instance(),
            &account,
            GitLabNamespaceQuery::default(),
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(transport.calls.is_empty());
    assert!(
        serde_json::from_value::<GitLabNamespaceQuery>(json!({"page":1,"token":"forged"})).is_err()
    );
    assert!(serde_json::from_value::<GitLabForkSelection>(json!({"sourceProjectId":"10","sourceFullPath":"team/upstream","forkProjectId":"20","forkFullPath":"group/nested/owned-fork","cloneHttps":"forged"})).is_err());
}
