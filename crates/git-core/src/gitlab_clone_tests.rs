use super::*;
use serde_json::json;
use std::collections::VecDeque;

struct Reads {
    values: VecDeque<Value>,
    calls: Vec<String>,
}
impl GitLabReadTransport for Reads {
    fn get(
        &mut self,
        _: &GitLabInstance,
        endpoint: &str,
        _: &CancellationToken,
    ) -> Result<Value, AppError> {
        self.calls.push(endpoint.into());
        Ok(self.values.pop_front().expect("unexpected provider read"))
    }
}
fn instance() -> GitLabInstance {
    GitLabInstance::parse("https://gitlab.example.test:8443").unwrap()
}
fn account() -> GitLabAccount {
    GitLabAccount {
        origin: instance().origin().into(),
        id: "7".into(),
        login: "reader".into(),
    }
}
fn user() -> Value {
    json!({"id":7,"username":"reader"})
}
fn project() -> Value {
    json!({"id":9007199254740993u64,"name":"Nested project","path_with_namespace":"group/sub/project",
        "web_url":"https://gitlab.example.test:8443/group/sub/project","description":null,
        "default_branch":null,"visibility":"private","archived":true,
        "http_url_to_repo":"https://git.example.test:9443/group/sub/project.git",
        "ssh_url_to_repo":"ssh://git@ssh.example.test:2222/group/sub/project.git"})
}
fn reads(project: Value) -> Reads {
    Reads {
        values: VecDeque::from([user(), project, user()]),
        calls: vec![],
    }
}
fn inspect(source: &mut Reads) -> Result<GitLabProjectInspection, AppError> {
    inspect_gitlab_project_with(
        source,
        &instance(),
        &account(),
        "9007199254740993",
        &CancellationToken::default(),
    )
}
fn request(parent: &Path) -> GitLabCloneRequest {
    GitLabCloneRequest {
        project_id: "9007199254740993".into(),
        full_path: "group/sub/project".into(),
        transport: HostedCloneTransport::Ssh,
        parent_path: parent.to_str().unwrap().into(),
        folder: "new clone".into(),
        branch: Some("topic/literal-branch".into()),
        depth: Some(3),
        recurse_submodules: true,
    }
}
struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let path = std::env::temp_dir().join(format!(
            "khronos-gitlab-clone-{:x}",
            u128::from_le_bytes(random)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn gitlab_clone_inspection_preserves_nested_large_id_empty_and_archived_projects() {
    let mut source = reads(project());
    let inspected = inspect(&mut source).unwrap();
    assert_eq!(source.calls, ["user", "projects/9007199254740993", "user"]);
    assert_eq!(inspected.project.id, "9007199254740993");
    assert_eq!(inspected.project.full_path, "group/sub/project");
    assert!(inspected.project.default_branch.is_none());
    assert!(inspected.project.archived);
    assert_eq!(
        inspected.clone_https.as_deref(),
        Some("https://git.example.test:9443/group/sub/project.git")
    );
    assert_eq!(
        inspected.clone_ssh.as_deref(),
        Some("ssh://git@ssh.example.test:2222/group/sub/project.git")
    );
}

#[test]
fn gitlab_clone_inspection_accepts_scp_ssh_and_explicit_ipv6_ssh() {
    for url in [
        "git@ssh.example.test:group/sub/project.git",
        "git@[::1]:group/sub/project.git",
        "ssh://git@[::1]:2222/group/sub/project.git",
    ] {
        let mut p = project();
        p["ssh_url_to_repo"] = json!(url);
        assert_eq!(
            inspect(&mut reads(p)).unwrap().clone_ssh.as_deref(),
            Some(url)
        );
    }
}

#[test]
fn gitlab_clone_inspection_refuses_credential_or_option_injection_and_foreign_paths() {
    for (key, urls) in [
        (
            "http_url_to_repo",
            vec![
                "https://token@git.example.test/group/sub/project.git",
                "https://git.example.test/group/sub/project.git?token=secret",
                "file:///group/sub/project.git",
                "https://git.example.test/group/other/project.git",
                "https://git.example.test/group/sub/project.git#fragment",
            ],
        ),
        (
            "ssh_url_to_repo",
            vec![
                "git@ssh.example.test:other/project.git",
                "ssh://git:password@ssh.example.test/group/sub/project.git",
                "ssh://-option@ssh.example.test/group/sub/project.git",
                "ext::arbitrary command",
                "/local/path",
                "ssh://git@ssh.example.test/group/sub/project.git\n",
                "ssh://git@ssh.example.test/group/sub/project.git?x=1",
            ],
        ),
    ] {
        for url in urls {
            let mut p = project();
            p[key] = json!(url);
            assert!(inspect(&mut reads(p)).is_err(), "{url}");
        }
    }
}

#[test]
fn gitlab_clone_invalid_ids_and_foreign_accounts_are_refused_before_reads() {
    for id in [
        "0",
        "01",
        "-1",
        "1?x=y",
        "1/../../user",
        "18446744073709551616",
        "",
    ] {
        let mut source = reads(project());
        assert!(
            inspect_gitlab_project_with(
                &mut source,
                &instance(),
                &account(),
                id,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(source.calls.is_empty());
    }
    let mut other = account();
    other.origin = "https://another.test".into();
    let mut source = reads(project());
    assert!(
        inspect_gitlab_project_with(
            &mut source,
            &instance(),
            &other,
            "1",
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(source.calls.is_empty());
}

#[test]
fn gitlab_clone_changed_accounts_and_project_id_are_refused() {
    let mut source = reads(project());
    source.values[0] = json!({"id":8,"username":"reader"});
    assert!(inspect(&mut source).is_err());
    assert_eq!(source.calls, ["user"]);
    let mut source = reads(project());
    source.values[2] = json!({"id":7,"username":"renamed"});
    assert!(inspect(&mut source).is_err());
    assert_eq!(source.calls.len(), 3);
    let mut p = project();
    p["id"] = json!(12);
    assert!(inspect(&mut reads(p)).is_err());
}

#[test]
fn gitlab_clone_missing_transport_remains_explicit_without_invented_urls() {
    let mut p = project();
    p["http_url_to_repo"] = Value::Null;
    p["ssh_url_to_repo"] = json!("");
    let inspected = inspect(&mut reads(p.clone())).unwrap();
    assert!(inspected.clone_https.is_none() && inspected.clone_ssh.is_none());
    let d = Directory::new();
    assert!(
        prepare_gitlab_clone_with(
            &mut reads(p),
            &instance(),
            &account(),
            request(&d.0),
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(!d.0.join("new clone").exists());
}

#[test]
fn gitlab_clone_preview_is_read_only_and_preserves_literal_choices() {
    let d = Directory::new();
    let mut source = reads(project());
    let plan = prepare_gitlab_clone_with(
        &mut source,
        &instance(),
        &account(),
        request(&d.0),
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(plan.destination, d.0.join("new clone").to_str().unwrap());
    assert_eq!(plan.branch.as_deref(), Some("topic/literal-branch"));
    assert_eq!(plan.depth, Some(3));
    assert!(plan.recurse_submodules);
    assert!(!d.0.join("new clone").exists());
    revalidate_gitlab_clone_with(&mut reads(project()), &plan, &CancellationToken::default())
        .unwrap();
    assert!(!d.0.join("new clone").exists());
}

#[test]
fn gitlab_clone_invalid_destination_branch_depth_and_cancel_do_not_read_provider() {
    let d = Directory::new();
    for change in 0..5 {
        let mut r = request(&d.0);
        match change {
            0 => r.folder = "../escape".into(),
            1 => r.branch = Some("@{-1}".into()),
            2 => r.depth = Some(0),
            3 => r.folder = "occupied".into(),
            _ => r.parent_path = d.0.join("absent").to_str().unwrap().into(),
        }
        if change == 3 {
            std::fs::create_dir(d.0.join("occupied")).unwrap();
        }
        let mut source = reads(project());
        assert!(
            prepare_gitlab_clone_with(
                &mut source,
                &instance(),
                &account(),
                r,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert!(source.calls.is_empty());
    }
    let token = CancellationToken::default();
    token.cancel();
    let mut source = reads(project());
    assert!(
        prepare_gitlab_clone_with(&mut source, &instance(), &account(), request(&d.0), &token)
            .is_err()
    );
    assert!(source.calls.is_empty());
}

#[test]
fn gitlab_clone_revalidation_refuses_selected_url_namespace_or_occupied_destination() {
    let d = Directory::new();
    let plan = prepare_gitlab_clone_with(
        &mut reads(project()),
        &instance(),
        &account(),
        request(&d.0),
        &CancellationToken::default(),
    )
    .unwrap();
    let mut p = project();
    p["ssh_url_to_repo"] = json!("ssh://git@changed.example.test:2222/group/sub/project.git");
    assert!(
        revalidate_gitlab_clone_with(&mut reads(p), &plan, &CancellationToken::default()).is_err()
    );
    let mut p = project();
    p["path_with_namespace"] = json!("group/moved/project");
    p["web_url"] = json!("https://gitlab.example.test:8443/group/moved/project");
    p["http_url_to_repo"] = Value::Null;
    p["ssh_url_to_repo"] = json!("git@ssh.example.test:group/moved/project.git");
    assert!(
        revalidate_gitlab_clone_with(&mut reads(p), &plan, &CancellationToken::default()).is_err()
    );
    std::fs::create_dir(d.0.join("new clone")).unwrap();
    std::fs::write(d.0.join("new clone/keep"), "owned").unwrap();
    let mut source = reads(project());
    assert!(
        revalidate_gitlab_clone_with(&mut source, &plan, &CancellationToken::default()).is_err()
    );
    assert!(source.calls.is_empty());
    assert_eq!(
        std::fs::read_to_string(d.0.join("new clone/keep")).unwrap(),
        "owned"
    );
}

#[test]
fn gitlab_clone_unselected_transport_change_does_not_change_reviewed_authority() {
    let d = Directory::new();
    let plan = prepare_gitlab_clone_with(
        &mut reads(project()),
        &instance(),
        &account(),
        request(&d.0),
        &CancellationToken::default(),
    )
    .unwrap();
    let mut p = project();
    p["http_url_to_repo"] = json!("https://changed.example.test/group/sub/project.git");
    revalidate_gitlab_clone_with(&mut reads(p), &plan, &CancellationToken::default()).unwrap();
}

#[test]
fn gitlab_clone_unencrypted_http_is_unavailable_without_blocking_valid_ssh() {
    let mut p = project();
    p["http_url_to_repo"] = json!("http://git.example.test/group/sub/project.git");
    let inspected = inspect(&mut reads(p)).unwrap();
    assert!(inspected.clone_https.is_none());
    assert!(inspected.clone_ssh.is_some());
}
