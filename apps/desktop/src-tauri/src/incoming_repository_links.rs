//! Bounded external-link inbox. Receiving a request performs no Git or file work.
use super::*;
use std::collections::VecDeque;
use std::sync::atomic::AtomicBool;

const CAPACITY: usize = 8;

#[derive(Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum IncomingRepositoryLinkPayload {
    Ready {
        uri: String,
        link: git_khronos_git_core::RepositoryLink,
    },
    Rejected {
        message: String,
    },
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct IncomingRepositoryLink {
    id: String,
    payload: IncomingRepositoryLinkPayload,
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct IncomingRepositoryLinkState {
    requests: Vec<IncomingRepositoryLink>,
    overflowed: bool,
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub(super) struct IncomingRepositoryLinksChanged {
    pending: bool,
}

#[derive(Default)]
struct Inbox {
    requests: VecDeque<IncomingRepositoryLink>,
    overflowed: bool,
    sequence: u64,
}

#[derive(Default)]
pub(super) struct IncomingRepositoryLinks {
    inbox: Mutex<Inbox>,
    pending: Arc<AtomicBool>,
}

fn error(kind: &str, message: &str) -> AppError {
    AppError {
        kind: kind.into(),
        message: message.into(),
        hint: Some("Review incoming repository links before resuming automatic fetch.".into()),
    }
}

impl IncomingRepositoryLinks {
    pub(super) fn guard(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.pending)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inbox>, AppError> {
        self.inbox.lock().map_err(|_| {
            self.pending.store(true, Ordering::Release);
            error(
                "incomingLinkState",
                "Incoming repository links could not be read.",
            )
        })
    }

    pub(super) fn receive(&self, raw: &str) -> Result<bool, AppError> {
        // Ordinary process arguments and other schemes are not repository requests.
        if !raw
            .get(..12)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("git-khronos:"))
        {
            return Ok(false);
        }
        let payload = match git_khronos_git_core::parse_repository_link(raw).and_then(|link| {
            git_khronos_git_core::create_repository_link(link.remote(), link.target())
                .map(|uri| (uri, link))
        }) {
            Ok((uri, link)) => IncomingRepositoryLinkPayload::Ready { uri, link },
            // Never retain or publish rejected input, which may contain credentials.
            Err(_) => IncomingRepositoryLinkPayload::Rejected {
                message: "One or more incoming repository links were malformed or unsupported."
                    .into(),
            },
        };
        let mut inbox = self.lock()?;
        if inbox
            .requests
            .iter()
            .any(|request| request.payload == payload)
        {
            return Ok(false);
        }
        self.pending.store(true, Ordering::Release);
        if inbox.requests.len() == CAPACITY || inbox.sequence == u64::MAX {
            let changed = !inbox.overflowed;
            inbox.overflowed = true;
            return Ok(changed);
        }
        inbox.sequence += 1;
        let id = format!("incoming-link-{}", inbox.sequence);
        inbox
            .requests
            .push_back(IncomingRepositoryLink { id, payload });
        Ok(true)
    }

    pub(super) fn snapshot(&self) -> Result<IncomingRepositoryLinkState, AppError> {
        let inbox = self.lock()?;
        Ok(IncomingRepositoryLinkState {
            requests: inbox.requests.iter().cloned().collect(),
            overflowed: inbox.overflowed,
        })
    }

    fn acknowledge(&self, id: &str) -> Result<(), AppError> {
        let mut inbox = self.lock()?;
        let Some(index) = inbox.requests.iter().position(|request| request.id == id) else {
            return Err(error(
                "staleIncomingRepositoryLink",
                "That incoming link was already handled or is no longer available.",
            ));
        };
        inbox.requests.remove(index);
        self.pending.store(
            !inbox.requests.is_empty() || inbox.overflowed,
            Ordering::Release,
        );
        Ok(())
    }

    fn dismiss_overflow(&self) -> Result<(), AppError> {
        let mut inbox = self.lock()?;
        inbox.overflowed = false;
        self.pending
            .store(!inbox.requests.is_empty(), Ordering::Release);
        Ok(())
    }
}

fn publish(app: &AppHandle) {
    let pending = app
        .state::<AppState>()
        .incoming_links
        .pending
        .load(Ordering::Acquire);
    let _ = IncomingRepositoryLinksChanged { pending }.emit(app);
}

pub(super) fn receive_arguments(app: &AppHandle, args: impl IntoIterator<Item = String>) {
    let state = app.state::<AppState>();
    let mut changed = false;
    for argument in args {
        changed |= state.incoming_links.receive(&argument).unwrap_or(true);
    }
    if changed {
        publish(app);
    }
}

#[cfg(target_os = "macos")]
pub(super) fn install_listener(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_deep_link::DeepLinkExt;
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        receive_arguments(&handle, event.urls().into_iter().map(|uri| uri.to_string()));
    });
    if let Some(urls) = app.deep_link().get_current()? {
        receive_arguments(app, urls.into_iter().map(|uri| uri.to_string()));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(super) fn install_listener(_app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(super) fn incoming_repository_links(
    state: tauri::State<'_, AppState>,
) -> Result<IncomingRepositoryLinkState, AppError> {
    state.incoming_links.snapshot()
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(super) fn acknowledge_incoming_repository_link(
    request_id: String,
    app: AppHandle,
) -> Result<IncomingRepositoryLinkState, AppError> {
    let state = app.state::<AppState>();
    state.incoming_links.acknowledge(&request_id)?;
    publish(&app);
    state.incoming_links.snapshot()
}

#[tauri::command]
#[specta::specta]
pub(super) fn dismiss_incoming_repository_link_overflow(
    app: AppHandle,
) -> Result<IncomingRepositoryLinkState, AppError> {
    let state = app.state::<AppState>();
    state.incoming_links.dismiss_overflow()?;
    publish(&app);
    state.incoming_links.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn uri(name: &str) -> String {
        git_khronos_git_core::create_repository_link(
            &format!("https://owned.example.test/{name}.git"),
            &git_khronos_git_core::RepositoryLinkTarget::Repository {},
        )
        .unwrap()
    }
    #[test]
    fn incoming_links_keep_order_deduplicate_pending_and_refuse_stale_acknowledgement() {
        let inbox = IncomingRepositoryLinks::default();
        let guard = inbox.guard();
        assert!(!guard.load(Ordering::Acquire));
        assert!(inbox.receive(&uri("first")).unwrap());
        assert!(!inbox.receive(&uri("first")).unwrap());
        assert!(inbox.receive(&uri("second")).unwrap());
        let initial = inbox.snapshot().unwrap();
        assert_eq!(initial.requests.len(), 2);
        assert!(
            matches!(&initial.requests[0].payload, IncomingRepositoryLinkPayload::Ready { uri: value, .. } if value == &uri("first"))
        );
        inbox.acknowledge(&initial.requests[0].id).unwrap();
        assert!(guard.load(Ordering::Acquire));
        assert!(inbox.receive(&uri("first")).unwrap());
        assert!(inbox.acknowledge(&initial.requests[0].id).is_err());
        let fresh = inbox.snapshot().unwrap();
        assert_eq!(fresh.requests.len(), 2);
        assert_ne!(fresh.requests[1].id, initial.requests[0].id);
        for request in fresh.requests {
            inbox.acknowledge(&request.id).unwrap();
        }
        assert!(!guard.load(Ordering::Acquire));
    }
    #[test]
    fn incoming_links_overflow_preserves_existing_requests_and_requires_explicit_notice_dismissal()
    {
        let inbox = IncomingRepositoryLinks::default();
        for number in 0..CAPACITY {
            assert!(inbox.receive(&uri(&number.to_string())).unwrap());
        }
        let before = inbox.snapshot().unwrap();
        assert!(inbox.receive(&uri("overflow")).unwrap());
        assert!(!inbox.receive(&uri("another-overflow")).unwrap());
        let full = inbox.snapshot().unwrap();
        assert!(full.overflowed);
        assert_eq!(
            full.requests.iter().map(|r| &r.id).collect::<Vec<_>>(),
            before.requests.iter().map(|r| &r.id).collect::<Vec<_>>()
        );
        for request in full.requests {
            inbox.acknowledge(&request.id).unwrap();
        }
        assert!(inbox.guard().load(Ordering::Acquire));
        inbox.dismiss_overflow().unwrap();
        assert!(!inbox.guard().load(Ordering::Acquire));
    }
    #[test]
    fn incoming_links_rejected_input_is_bounded_static_and_never_publishes_secret_material() {
        let inbox = IncomingRepositoryLinks::default();
        let raw = "git-khronos://repository?v=1&remote=https%3A%2F%2Fowned-secret-fixture%40owned.example.test%2Fprivate.git";
        assert!(inbox.receive(raw).unwrap());
        assert!(
            !inbox
                .receive(&format!("git-khronos:{}", "x".repeat(9000)))
                .unwrap()
        );
        let snapshot = inbox.snapshot().unwrap();
        assert_eq!(snapshot.requests.len(), 1);
        let serialized = serde_json::to_string(&snapshot).unwrap();
        assert!(
            !serialized.contains("owned-secret-fixture") && !serialized.contains("private.git")
        );
        assert!(matches!(
            &snapshot.requests[0].payload,
            IncomingRepositoryLinkPayload::Rejected { .. }
        ));
        inbox.acknowledge(&snapshot.requests[0].id).unwrap();
        assert!(!inbox.guard().load(Ordering::Acquire));
    }
    #[test]
    fn incoming_links_ignore_unrelated_arguments_and_canonicalize_only_valid_owned_uris() {
        let inbox = IncomingRepositoryLinks::default();
        for raw in [
            "/owned/path",
            "--arbitrary",
            "https://owned.example.test/repo",
            "other://repository",
            "git-khronosx://repository",
        ] {
            assert!(!inbox.receive(raw).unwrap());
        }
        assert!(inbox.snapshot().unwrap().requests.is_empty());
        assert!(!inbox.guard().load(Ordering::Acquire));
        let link = uri("canonical");
        assert!(
            inbox
                .receive(&link.replacen("git-khronos://repository", "GIT-KHRONOS://REPOSITORY", 1))
                .unwrap()
        );
        assert!(
            matches!(&inbox.snapshot().unwrap().requests[0].payload, IncomingRepositoryLinkPayload::Ready { uri: value, .. } if value == &link)
        );
    }
    #[test]
    fn incoming_links_concurrent_duplicate_delivery_retains_one_pending_identity() {
        let inbox = Arc::new(IncomingRepositoryLinks::default());
        let workers: Vec<_> = (0..16)
            .map(|_| {
                let inbox = Arc::clone(&inbox);
                std::thread::spawn(move || inbox.receive(&uri("concurrent")).unwrap())
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .filter(|changed| *changed)
                .count(),
            1
        );
        assert_eq!(inbox.snapshot().unwrap().requests.len(), 1);
        assert!(inbox.guard().load(Ordering::Acquire));
    }
}
