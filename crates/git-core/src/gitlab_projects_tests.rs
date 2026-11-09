use super::*;
use serde_json::json;
use std::collections::VecDeque;

fn instance() -> GitLabInstance {
    GitLabInstance::parse("https://gitlab.example.test").unwrap()
}

fn account() -> Value {
    json!({"id": 9007199254740993_u64, "username": "owned-reader",
           "private_token": "owned-unused-marker"})
}

fn selected_account() -> GitLabAccount {
    GitLabAccount {
        origin: instance().origin().into(),
        id: "9007199254740993".into(),
        login: "owned-reader".into(),
    }
}

fn row(id: u64) -> Value {
    json!({"id": id, "name": "Owned project", "path_with_namespace": format!("team/subgroup/project-{id}"),
           "web_url": format!("https://gitlab.example.test/team/subgroup/project-{id}"),
           "description": "Owned\nmetadata", "default_branch": null,
           "visibility": "internal", "archived": false,
           "private_token": "owned-unused-marker", "http_url_to_repo": "untrusted-not-exported"})
}

struct Fixture {
    accounts: VecDeque<Value>,
    projects: Value,
    calls: Vec<(String, String)>,
    cancel_on_projects: bool,
}

impl Fixture {
    fn new(projects: Value) -> Self {
        Self {
            accounts: VecDeque::from([account(), account()]),
            projects,
            calls: Vec::new(),
            cancel_on_projects: false,
        }
    }
}

impl GitLabReadTransport for Fixture {
    fn get(
        &mut self,
        instance: &GitLabInstance,
        endpoint: &str,
        cancellation: &CancellationToken,
    ) -> Result<Value, AppError> {
        self.calls.push((instance.origin().into(), endpoint.into()));
        if endpoint == "user" {
            return self.accounts.pop_front().ok_or_else(response_error);
        }
        if endpoint.starts_with("projects?") {
            if self.cancel_on_projects {
                cancellation.cancel();
            }
            return Ok(self.projects.clone());
        }
        Err(response_error())
    }
}

fn load(fixture: &mut Fixture, query: GitLabProjectQuery) -> Result<GitLabProjectPage, AppError> {
    load_gitlab_project_page_with(fixture, &instance(), query, &CancellationToken::default())
}

#[test]
fn gitlab_instances_are_canonical_https_roots_without_embedded_credentials() {
    assert_eq!(
        GitLabInstance::parse("https://GITLAB.example.test:443/")
            .unwrap()
            .origin(),
        "https://gitlab.example.test"
    );
    assert_eq!(
        GitLabInstance::parse("https://gitlab.example.test:8443")
            .unwrap()
            .origin(),
        "https://gitlab.example.test:8443"
    );
    for invalid in [
        "http://gitlab.example.test",
        "https://user:owned-unused-marker@gitlab.example.test",
        "https://gitlab.example.test/group",
        "https://gitlab.example.test?scope=other",
        "https://gitlab.example.test#other",
        "https://gitlab.example.test\\other",
        " https://gitlab.example.test",
        "https://gitlab.example.test\n",
    ] {
        let error = GitLabInstance::parse(invalid).unwrap_err();
        assert!(!error.message.contains("owned-unused-marker"));
    }
}

#[test]
fn gitlab_projects_preserve_nested_namespaces_and_large_ids_without_exporting_raw_fields() {
    let mut fixture = Fixture::new(json!([row(9007199254740994)]));
    let page = load(&mut fixture, Default::default()).unwrap();
    assert_eq!(page.account, selected_account());
    assert_eq!(page.entries[0].id, "9007199254740994");
    assert_eq!(
        page.entries[0].full_path,
        "team/subgroup/project-9007199254740994"
    );
    assert_eq!(
        page.entries[0].description.as_deref(),
        Some("Owned\nmetadata")
    );
    assert_eq!(page.entries[0].default_branch, None);
    assert!(!page.may_have_more);
    assert_eq!(page.next_page, None);
    let output = serde_json::to_string(&page).unwrap();
    assert!(!output.contains("owned-unused-marker"));
    assert!(!output.contains("untrusted-not-exported"));
    assert_eq!(fixture.calls.len(), 3);
    assert!(
        fixture
            .calls
            .iter()
            .all(|(origin, _)| origin == instance().origin())
    );
    assert_eq!(fixture.calls[0].1, "user");
    assert_eq!(fixture.calls[2].1, "user");
}

#[test]
fn gitlab_account_changes_before_or_during_a_page_refuse_mixed_account_data() {
    let mut expected = selected_account();
    expected.id = "17".into();
    let mut fixture = Fixture::new(json!([row(1)]));
    let error = load(
        &mut fixture,
        GitLabProjectQuery {
            expected_account: Some(expected),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert_eq!(error.kind, "gitlabDiscoveryRequest");
    assert_eq!(fixture.calls.len(), 1);

    for changed in [
        json!({"id":17,"username":"another-reader"}),
        json!({"id":9007199254740993_u64,"username":"renamed-reader"}),
    ] {
        let mut fixture = Fixture::new(json!([row(1)]));
        fixture.accounts = VecDeque::from([account(), changed]);
        assert_eq!(
            load(&mut fixture, Default::default()).unwrap_err().kind,
            "gitlabDiscoveryRequest"
        );
        assert_eq!(fixture.calls.len(), 3);
    }
}

#[test]
fn gitlab_queries_encode_literal_search_and_bound_explicit_pagination() {
    let records = Value::Array((1..=PAGE_SIZE as u64).map(row).collect());
    let mut fixture = Fixture::new(records.clone());
    let search = "café & old/feature";
    let page = load(
        &mut fixture,
        GitLabProjectQuery {
            search: search.into(),
            scope: GitLabProjectScope::Accessible,
            include_archived: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(page.may_have_more);
    assert_eq!(page.next_page, Some(2));
    let endpoint = &fixture.calls[1].1;
    assert!(endpoint.contains("search=caf%C3%A9+%26+old%2Ffeature"));
    assert!(!endpoint.contains("membership="));
    assert!(!endpoint.contains("archived="));
    assert!(endpoint.contains("per_page=20&page=1&order_by=id&sort=asc"));

    let mut fixture = Fixture::new(records);
    let page = load(
        &mut fixture,
        GitLabProjectQuery {
            page: MAX_PAGE,
            expected_account: Some(selected_account()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(page.may_have_more);
    assert_eq!(page.next_page, None);
    assert!(!page.warnings.is_empty());
    assert!(
        fixture.calls[1]
            .1
            .contains("membership=true&archived=false")
    );
}

#[test]
fn gitlab_invalid_page_bindings_and_search_fail_before_any_provider_read() {
    let mut wrong_origin = selected_account();
    wrong_origin.origin = "https://other.example.test".into();
    let mut noncanonical_id = selected_account();
    noncanonical_id.id = "01".into();
    for query in [
        GitLabProjectQuery {
            page: 0,
            ..Default::default()
        },
        GitLabProjectQuery {
            page: MAX_PAGE + 1,
            ..Default::default()
        },
        GitLabProjectQuery {
            page: 2,
            ..Default::default()
        },
        GitLabProjectQuery {
            search: "é".repeat(129),
            ..Default::default()
        },
        GitLabProjectQuery {
            search: "line\nnext".into(),
            ..Default::default()
        },
        GitLabProjectQuery {
            expected_account: Some(wrong_origin),
            ..Default::default()
        },
        GitLabProjectQuery {
            expected_account: Some(noncanonical_id),
            ..Default::default()
        },
    ] {
        let mut fixture = Fixture::new(json!([]));
        assert_eq!(
            load(&mut fixture, query).unwrap_err().kind,
            "gitlabDiscoveryRequest"
        );
        assert!(fixture.calls.is_empty());
    }
}

#[test]
fn gitlab_malformed_or_duplicate_data_never_becomes_an_empty_successful_page() {
    let mut no_name = row(1);
    no_name.as_object_mut().unwrap().remove("name");
    let mut wrong_archive_type = row(1);
    wrong_archive_type["archived"] = json!("false");
    let mut bad_description = row(1);
    bad_description["description"] = json!(true);
    let mut bad_branch = row(1);
    bad_branch["default_branch"] = json!("main\nother");
    for records in [
        json!({"message":"owned-unused-marker"}),
        json!([row(1), row(1)]),
        Value::Array((1..=PAGE_SIZE as u64 + 1).map(row).collect()),
        json!([no_name]),
        json!([wrong_archive_type]),
        json!([bad_description]),
        json!([bad_branch]),
    ] {
        let mut fixture = Fixture::new(records);
        let error = load(&mut fixture, Default::default()).unwrap_err();
        assert_eq!(error.kind, "gitlabDiscoveryResponse");
        assert!(!error.message.contains("owned-unused-marker"));
    }
    let mut empty = Fixture::new(json!([]));
    let page = load(&mut empty, Default::default()).unwrap();
    assert!(page.entries.is_empty());
    assert!(!page.may_have_more);
}

#[test]
fn gitlab_project_links_must_match_the_selected_instance_and_literal_namespace() {
    for url in [
        "https://other.example.test/team/subgroup/project-1",
        "http://gitlab.example.test/team/subgroup/project-1",
        "https://gitlab.example.test/team/another/project-1",
        "https://gitlab.example.test/team/subgroup/project-1?token=owned-unused-marker",
        "https://owned-unused-marker@gitlab.example.test/team/subgroup/project-1",
        "javascript:owned-unused-marker",
    ] {
        let mut value = row(1);
        value["web_url"] = json!(url);
        assert_eq!(
            load(&mut Fixture::new(json!([value])), Default::default())
                .unwrap_err()
                .kind,
            "gitlabDiscoveryResponse"
        );
    }
    let mut value = row(1);
    value["path_with_namespace"] = json!("team/../project-1");
    assert!(load(&mut Fixture::new(json!([value])), Default::default()).is_err());
}

#[test]
fn gitlab_cancellation_before_and_between_reads_never_returns_a_late_page() {
    let token = CancellationToken::default();
    token.cancel();
    let mut fixture = Fixture::new(json!([row(1)]));
    assert_eq!(
        load_gitlab_project_page_with(&mut fixture, &instance(), Default::default(), &token)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
    assert!(fixture.calls.is_empty());

    let token = CancellationToken::default();
    let mut fixture = Fixture::new(json!([row(1)]));
    fixture.cancel_on_projects = true;
    assert_eq!(
        load_gitlab_project_page_with(&mut fixture, &instance(), Default::default(), &token)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
    assert_eq!(fixture.calls.len(), 2);
}
