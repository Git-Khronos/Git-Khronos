use self::core::{GitLabAccount, GitLabClonePlan, GitLabProject, HostedCloneTransport};
use super::*;

fn cached() -> CachedPlan {
    CachedPlan {
        connection_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        plan: GitLabClonePlan {
            account: GitLabAccount {
                origin: "https://gitlab.example.test".into(),
                id: "1".into(),
                login: "reader".into(),
            },
            project: GitLabProject {
                id: "9007199254740993".into(),
                name: "Owned".into(),
                full_path: "group/sub/owned".into(),
                url: "https://gitlab.example.test/group/sub/owned".into(),
                description: None,
                default_branch: None,
                visibility: "private".into(),
                archived: false,
            },
            transport: HostedCloneTransport::Ssh,
            url: "git@ssh.example.test:group/sub/owned.git".into(),
            parent_path: "/owned/parent".into(),
            folder: "new".into(),
            destination: "/owned/parent/new".into(),
            branch: None,
            depth: Some(2),
            recurse_submodules: true,
        },
    }
}

#[test]
fn gitlab_clone_native_review_is_bound_to_context_and_consumed_once() {
    let state = GitLabClonePlans::default();
    let preview = state
        .reserve("first")
        .unwrap()
        .finish(cached(), &core::CancellationToken::default())
        .unwrap();
    assert!(state.take("other", &preview.token).is_err());
    assert!(state.take("first", "wrong-token").is_err());
    let taken = state.take("first", &preview.token).unwrap();
    assert_eq!(taken.plan.project.id, "9007199254740993");
    assert_eq!(taken.connection_id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert!(state.take("first", &preview.token).is_err());
}

#[test]
fn gitlab_clone_native_pending_and_ready_reviews_share_one_capacity_limit() {
    let state = GitLabClonePlans::default();
    let mut pending = Vec::new();
    for index in 0..CAPACITY {
        pending.push(state.reserve(&format!("context-{index}")).unwrap());
    }
    assert!(state.reserve("overflow").is_err());
    let preview = pending
        .pop()
        .unwrap()
        .finish(cached(), &core::CancellationToken::default())
        .unwrap();
    assert!(state.reserve("overflow").is_err());
    assert!(state.discard("context-7", &preview.token).unwrap());
    assert!(state.reserve("overflow").is_ok());
    drop(pending);
    assert!(state.0.lock().unwrap().is_empty());
}

#[test]
fn gitlab_clone_native_reprepare_retires_old_preview_and_excludes_pending_duplicates() {
    let state = GitLabClonePlans::default();
    let old = state
        .reserve("same")
        .unwrap()
        .finish(cached(), &core::CancellationToken::default())
        .unwrap();
    let pending = state.reserve("same").unwrap();
    assert!(state.take("same", &old.token).is_err());
    assert!(state.reserve("same").is_err());
    drop(pending);
    assert!(state.reserve("same").is_ok());
}

#[test]
fn gitlab_clone_native_cancelled_publication_releases_reservation() {
    let state = GitLabClonePlans::default();
    let pending = state.reserve("cancelled").unwrap();
    let token = core::CancellationToken::default();
    token.cancel();
    assert!(pending.finish(cached(), &token).is_err());
    assert!(state.0.lock().unwrap().is_empty());
}

#[test]
fn gitlab_clone_native_expiry_refuses_execution_and_late_publication() {
    let state = GitLabClonePlans::default();
    let preview = state
        .reserve("ready")
        .unwrap()
        .finish(cached(), &core::CancellationToken::default())
        .unwrap();
    state.0.lock().unwrap().get_mut("ready").unwrap().created = Instant::now() - LIFETIME;
    assert!(state.take("ready", &preview.token).is_err());
    let pending = state.reserve("pending").unwrap();
    state.0.lock().unwrap().get_mut("pending").unwrap().created = Instant::now() - LIFETIME;
    assert!(
        pending
            .finish(cached(), &core::CancellationToken::default())
            .is_err()
    );
    assert!(state.0.lock().unwrap().is_empty());
}

#[test]
fn gitlab_clone_native_discard_cannot_remove_another_context() {
    let state = GitLabClonePlans::default();
    let preview = state
        .reserve("first")
        .unwrap()
        .finish(cached(), &core::CancellationToken::default())
        .unwrap();
    assert!(!state.discard("other", &preview.token).unwrap());
    assert!(!state.discard("first", "wrong").unwrap());
    assert!(state.discard("first", &preview.token).unwrap());
    assert!(!state.discard("first", &preview.token).unwrap());
}

#[test]
fn gitlab_clone_native_requests_refuse_extra_authority_and_invalid_contexts() {
    for value in ["", "../other", "context with spaces", &"a".repeat(129)] {
        assert!(context(value).is_err());
    }
    let mut request = serde_json::json!({"contextId":"own-context","token":"owned-token","operationId":"owned-operation"});
    assert!(serde_json::from_value::<GitLabExecuteCloneRequest>(request.clone()).is_ok());
    request["plan"] = serde_json::json!({"url":"https://other.test/project.git"});
    assert!(serde_json::from_value::<GitLabExecuteCloneRequest>(request).is_err());
    let mut request =
        serde_json::json!({"connectionId":"owned","projectId":"1","operationId":"read"});
    assert!(serde_json::from_value::<GitLabInspectRequest>(request.clone()).is_ok());
    request["origin"] = serde_json::json!("https://other.test");
    assert!(serde_json::from_value::<GitLabInspectRequest>(request).is_err());
}
