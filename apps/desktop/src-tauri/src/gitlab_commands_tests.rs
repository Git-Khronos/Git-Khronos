use super::*;
use serde_json::{Value, json};
use std::sync::mpsc;

const FIRST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn instance() -> core::GitLabInstance {
    core::GitLabInstance::parse("https://gitlab.example.test").unwrap()
}
fn account() -> core::GitLabAccount {
    core::GitLabAccount {
        origin: instance().origin().into(),
        id: "41".into(),
        login: "owned-reader".into(),
    }
}
fn request(id: &str) -> GitLabProjectsRequest {
    GitLabProjectsRequest {
        connection_id: id.into(),
        query: Default::default(),
        operation_id: "owned-read".into(),
    }
}

#[derive(Default)]
struct FixtureTransport {
    calls: Arc<Mutex<Vec<String>>>,
    started: Option<mpsc::Sender<()>>,
    release: Option<mpsc::Receiver<()>>,
    changed_account: bool,
    first_user_resume_at: Option<Instant>,
}
impl core::GitLabReadTransport for FixtureTransport {
    fn get(
        &mut self,
        selected: &core::GitLabInstance,
        endpoint: &str,
        cancellation: &CancellationToken,
    ) -> Result<Value, AppError> {
        assert_eq!(selected, &instance());
        self.calls.lock().unwrap().push(endpoint.into());
        check(cancellation)?;
        if endpoint == "user" {
            if let Some(resume_at) = self.first_user_resume_at.take() {
                std::thread::sleep(resume_at.saturating_duration_since(Instant::now()));
            }
            return Ok(if self.changed_account {
                json!({"id": 42, "username": "another-reader"})
            } else {
                json!({"id": 41, "username": "owned-reader"})
            });
        }
        assert!(endpoint.starts_with("projects?"));
        if let Some(started) = self.started.take() {
            started.send(()).unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                check(cancellation)?;
                match self
                    .release
                    .as_ref()
                    .unwrap()
                    .recv_timeout(Duration::from_millis(10))
                {
                    Ok(()) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return Err(unavailable()),
                    Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() >= deadline => {
                        return Err(unavailable());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => (),
                }
            }
        }
        Ok(
            json!([{"id": 101, "name": "Owned project", "path_with_namespace": "team/project",
            "web_url": "https://gitlab.example.test/team/project", "description": null,
            "default_branch": "main", "visibility": "private", "archived": false,
            "private_token": "owned-not-exported-marker"}]),
        )
    }
}

fn connect(state: &GitLabAccounts, id: &str, transport: FixtureTransport) -> GitLabConnection {
    state
        .reserve_id(id.into())
        .unwrap()
        .finish(
            instance(),
            account(),
            Box::new(transport),
            &CancellationToken::default(),
        )
        .unwrap()
}

#[test]
fn gitlab_native_connection_inputs_reject_ambiguous_or_unknown_fields() {
    let valid = json!({"origin":"https://gitlab.example.test","token":"owned-fixture-token","operationId":"owned-connect"});
    assert!(serde_json::from_value::<GitLabConnectRequest>(valid.clone()).is_ok());
    let mut extra = valid;
    extra["persistToken"] = json!(true);
    assert!(serde_json::from_value::<GitLabConnectRequest>(extra).is_err());
    let valid = json!({"connectionId": FIRST,"query":{},"operationId":"owned-read"});
    assert!(serde_json::from_value::<GitLabProjectsRequest>(valid.clone()).is_ok());
    let mut extra = valid;
    extra["query"]["origin"] = json!("https://other.test");
    assert!(serde_json::from_value::<GitLabProjectsRequest>(extra).is_err());
    for id in ["", "a", "Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "../other"] {
        assert!(valid_id(id).is_err());
    }
}

#[test]
fn gitlab_native_connections_are_available_only_to_the_main_window() {
    assert!(main_label("main").is_ok());
    for label in ["", "MAIN", "editor", "main/other"] {
        assert!(main_label(label).is_err());
    }
}

#[test]
fn gitlab_native_listing_and_disconnect_return_metadata_without_provider_requests() {
    let state = GitLabAccounts::default();
    let transport = FixtureTransport::default();
    let calls = transport.calls.clone();
    let connected = connect(&state, FIRST, transport);
    let views = state.connections().unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].connection_id, connected.connection_id);
    assert_eq!(views[0].account, account());
    assert!(views[0].expires_at_millis.parse::<u128>().unwrap() > 0);
    let wire = serde_json::to_value(views).unwrap();
    assert_eq!(
        wire[0]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<HashSet<_>>(),
        HashSet::from([
            "connectionId".into(),
            "account".into(),
            "expiresAtMillis".into(),
            "canCreateFork".into()
        ])
    );
    assert!(state.disconnect(FIRST).unwrap());
    assert!(!state.disconnect(FIRST).unwrap());
    assert!(state.connections().unwrap().is_empty());
    assert!(calls.lock().unwrap().is_empty());
}

#[test]
fn gitlab_native_capacity_includes_pending_connections_and_failed_attempts_release_slots() {
    let state = GitLabAccounts::default();
    let mut reservations = Vec::new();
    for number in 0..CAPACITY {
        reservations.push(state.reserve_id(format!("{number:032x}")).unwrap());
    }
    assert!(state.reserve_id(FIRST.into()).is_err());
    assert!(state.connections().unwrap().is_empty());
    reservations.pop();
    let view = connect(&state, FIRST, Default::default());
    assert_eq!(view.connection_id, FIRST);
    assert!(state.reserve_id(SECOND.into()).is_err());
    drop(reservations);
    assert!(state.reserve_id(SECOND.into()).is_ok());
    assert_eq!(state.connections().unwrap().len(), 1);
}

#[test]
fn gitlab_native_identifier_collisions_preserve_pending_and_connected_contexts() {
    let state = GitLabAccounts::default();
    let reservation = state.reserve_id(FIRST.into()).unwrap();
    assert!(state.reserve_id(FIRST.into()).is_err());
    drop(reservation);
    connect(&state, FIRST, Default::default());
    assert!(state.reserve_id(FIRST.into()).is_err());
    assert_eq!(state.connections().unwrap()[0].connection_id, FIRST);
}

#[test]
fn gitlab_native_cancelled_connection_publication_never_retains_a_session_or_reservation() {
    let state = GitLabAccounts::default();
    let reservation = state.reserve_id(FIRST.into()).unwrap();
    let cancellation = CancellationToken::default();
    cancellation.cancel();
    let error = reservation
        .finish(
            instance(),
            account(),
            Box::<FixtureTransport>::default(),
            &cancellation,
        )
        .unwrap_err();
    assert_eq!(error.kind, "operationCancelled");
    assert!(state.connections().unwrap().is_empty());
    assert!(state.reserve_id(FIRST.into()).is_ok());
}

#[test]
fn gitlab_native_foreign_account_origin_cannot_be_published_under_another_instance() {
    let state = GitLabAccounts::default();
    let reservation = state.reserve_id(FIRST.into()).unwrap();
    let mut wrong = account();
    wrong.origin = "https://other.example.test".into();
    assert!(
        reservation
            .finish(
                instance(),
                wrong,
                Box::<FixtureTransport>::default(),
                &CancellationToken::default()
            )
            .is_err()
    );
    assert!(state.connections().unwrap().is_empty());
    assert!(state.reserve_id(FIRST.into()).is_ok());
}

#[test]
fn gitlab_native_project_reads_are_bound_to_the_verified_account_even_on_first_page() {
    let state = GitLabAccounts::default();
    let transport = FixtureTransport::default();
    let calls = transport.calls.clone();
    connect(&state, FIRST, transport);
    let page = projects(&state, request(FIRST), &CancellationToken::default()).unwrap();
    assert_eq!(page.account, account());
    assert_eq!(page.query.expected_account, Some(account()));
    assert!(
        !serde_json::to_string(&page)
            .unwrap()
            .contains("owned-not-exported-marker")
    );
    assert_eq!(calls.lock().unwrap().len(), 3);
    let mut wrong = request(FIRST);
    let mut other = account();
    other.id = "42".into();
    wrong.query.expected_account = Some(other);
    assert_eq!(
        projects(&state, wrong, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "gitlabAccountChanged"
    );
    assert_eq!(calls.lock().unwrap().len(), 3);
    connect(
        &state,
        SECOND,
        FixtureTransport {
            changed_account: true,
            ..Default::default()
        },
    );
    let changed = projects(&state, request(SECOND), &CancellationToken::default()).unwrap_err();
    assert!(changed.message.contains("Reconnect the account"));
    // Local metadata refresh does not silently rebind a connection to a new user.
    let listed = state.connections().unwrap();
    assert!(
        listed
            .iter()
            .all(|connection| connection.account == account())
    );
    let retried = projects(&state, request(SECOND), &CancellationToken::default()).unwrap_err();
    assert!(retried.message.contains("Reconnect the account"));
}

#[test]
fn gitlab_native_expiry_retires_old_contexts_and_preserves_another_live_account() {
    let state = GitLabAccounts::default();
    connect(&state, FIRST, Default::default());
    connect(&state, SECOND, Default::default());
    let token = CancellationToken::default();
    let retained = {
        let mut registry = state.0.lock().unwrap();
        let session = registry.sessions.get_mut(FIRST).unwrap();
        let only = Arc::get_mut(session).unwrap();
        only.created = Instant::now() - LIFETIME;
        *only.active.lock().unwrap() = Some(("owned-old".into(), token.clone()));
        session.clone()
    };
    assert!(state.get(FIRST).is_err());
    assert!(token.is_cancelled());
    assert!(!retained.live());
    assert!(
        retained
            .begin("owned-late", &CancellationToken::default())
            .is_err()
    );
    let views = state.connections().unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].connection_id, SECOND);
}

#[test]
fn gitlab_native_one_read_lease_does_not_queue_or_clear_another_operation() {
    let state = GitLabAccounts::default();
    connect(&state, FIRST, Default::default());
    let session = state.get(FIRST).unwrap();
    let created = session.created;
    let first = session
        .begin("first", &CancellationToken::default())
        .unwrap();
    assert!(
        session
            .begin("second", &CancellationToken::default())
            .is_err()
    );
    first.check().unwrap();
    drop(first);
    let second = session
        .begin("second", &CancellationToken::default())
        .unwrap();
    second.check().unwrap();
    assert_eq!(session.created, created);
}

#[test]
fn gitlab_native_disconnect_cancels_the_owned_read_without_waiting_on_its_transport_lock() {
    let state = Arc::new(GitLabAccounts::default());
    let (started_sender, started_receiver) = mpsc::channel();
    let (_release_sender, release_receiver) = mpsc::channel();
    connect(
        &state,
        FIRST,
        FixtureTransport {
            started: Some(started_sender),
            release: Some(release_receiver),
            ..Default::default()
        },
    );
    connect(&state, SECOND, Default::default());
    let (finished_sender, finished_receiver) = mpsc::channel();
    let worker_state = state.clone();
    let worker = std::thread::spawn(move || {
        let result = projects(&worker_state, request(FIRST), &CancellationToken::default());
        finished_sender.send(result).unwrap();
    });
    started_receiver
        .recv_timeout(Duration::from_secs(2))
        .unwrap();
    assert!(state.disconnect(FIRST).unwrap());
    assert_eq!(
        finished_receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
    worker.join().unwrap();
    assert!(state.get(FIRST).is_err());
    assert_eq!(state.connections().unwrap()[0].connection_id, SECOND);
}

#[test]
fn gitlab_native_periodic_cleanup_releases_expired_connections_and_does_not_keep_state_alive() {
    let state = GitLabAccounts::default();
    connect(&state, FIRST, Default::default());
    {
        let mut registry = state.0.lock().unwrap();
        Arc::get_mut(registry.sessions.get_mut(FIRST).unwrap())
            .unwrap()
            .created = Instant::now() - LIFETIME;
    }
    let weak = Arc::downgrade(&state.0);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let worker = tokio::spawn(cleanup_loop(weak.clone(), Duration::from_millis(5)));
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if state.0.lock().unwrap().sessions.is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        drop(state);
        tokio::time::timeout(Duration::from_secs(1), worker)
            .await
            .unwrap()
            .unwrap();
    });
    assert!(weak.upgrade().is_none());
}

#[test]
fn gitlab_native_state_teardown_retires_and_cancels_a_retained_active_context() {
    let state = GitLabAccounts::default();
    connect(&state, FIRST, Default::default());
    let session = state.get(FIRST).unwrap();
    let token = CancellationToken::default();
    let lease = session.begin("owned-read", &token).unwrap();
    drop(state);
    assert!(token.is_cancelled());
    assert!(lease.check().is_err());
    assert!(!session.live());
}

#[test]
fn gitlab_native_expiry_between_requests_prevents_later_provider_reads() {
    let state = GitLabAccounts::default();
    let expires = Instant::now() + Duration::from_secs(1);
    let calls = Arc::new(Mutex::new(Vec::new()));
    connect(
        &state,
        FIRST,
        FixtureTransport {
            calls: calls.clone(),
            first_user_resume_at: Some(expires + Duration::from_millis(10)),
            ..Default::default()
        },
    );
    {
        let mut registry = state.0.lock().unwrap();
        Arc::get_mut(registry.sessions.get_mut(FIRST).unwrap())
            .unwrap()
            .created = expires - LIFETIME;
    }
    let error = projects(&state, request(FIRST), &CancellationToken::default()).unwrap_err();
    assert_eq!(error.kind, "gitlabConnectionExpired");
    // The first account read crosses the deadline. Neither the projects read
    // nor the final account check may start with that expired authority.
    assert_eq!(*calls.lock().unwrap(), vec!["user".to_owned()]);
}

#[test]
fn gitlab_native_scoped_read_releases_api_authority_before_git_handoff() {
    let state = GitLabAccounts::default();
    connect(&state, FIRST, FixtureTransport::default());
    let cancellation = CancellationToken::default();
    let value = state
        .read(
            FIRST,
            "inspect",
            &cancellation,
            |transport, instance, account| {
                assert_eq!(account, &self::account());
                assert!(
                    state
                        .read(
                            FIRST,
                            "concurrent",
                            &CancellationToken::default(),
                            |_, _, _| Ok(())
                        )
                        .is_err()
                );
                transport.get(instance, "user", &cancellation)
            },
        )
        .unwrap();
    assert_eq!(value["id"], 41);
    state
        .read(FIRST, "fresh", &CancellationToken::default(), |_, _, _| {
            Ok(())
        })
        .unwrap();
    assert!(state.disconnect(FIRST).unwrap());
    // The API operation is over. Its token is no longer held in Session.active;
    // a separately accepted Git operation is not cancelled by disconnect.
    assert!(!cancellation.is_cancelled());
}

#[test]
fn gitlab_native_scoped_read_rechecks_retirement_before_handoff() {
    let state = GitLabAccounts::default();
    connect(&state, FIRST, FixtureTransport::default());
    let cancellation = CancellationToken::default();
    let result = state.read(FIRST, "inspect", &cancellation, |_, _, _| {
        state.disconnect(FIRST).unwrap();
        Ok("must not authorize Git")
    });
    assert!(result.is_err());
    assert!(cancellation.is_cancelled());
}
