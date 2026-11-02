//! Explicit in-memory GitLab connections. Fork writes need a separate connection;
//! neither connection kind grants Git transport authority.
use super::{
    AppError, AppHandle, CancellationToken, Manager, background_task_error,
    register_active_operation, state_error,
};
use git_khronos_git_core as core;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const LIFETIME: Duration = Duration::from_secs(30 * 60);
const CAPACITY: usize = 8;

#[derive(Default)]
pub struct GitLabAccounts(Arc<Mutex<Registry>>);
#[derive(Default)]
struct Registry {
    sessions: HashMap<String, Arc<Session>>,
    connecting: HashSet<String>,
}
struct Session {
    view: GitLabConnection,
    instance: core::GitLabInstance,
    created: Instant,
    closed: AtomicBool,
    active: Mutex<Option<(String, CancellationToken)>>,
    transport: Mutex<Box<dyn core::GitLabReadTransport + Send>>,
    fork_writer: Option<Mutex<Box<dyn core::GitLabForkWriteTransport + Send>>>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabConnection {
    pub connection_id: String,
    pub account: core::GitLabAccount,
    pub expires_at_millis: String,
    pub can_create_fork: bool,
}

// Input only: do not derive Debug/Serialize or retain this request in settings.
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabConnectRequest {
    pub origin: String,
    pub token: String,
    pub operation_id: String,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabProjectsRequest {
    pub connection_id: String,
    pub query: core::GitLabProjectQuery,
    pub operation_id: String,
}

fn error(kind: &str, message: &str) -> AppError {
    AppError {
        kind: kind.into(),
        message: message.into(),
        hint: None,
    }
}
fn unavailable() -> AppError {
    error(
        "gitlabConnectionExpired",
        "This GitLab connection is unavailable or expired. Connect again.",
    )
}
fn busy() -> AppError {
    error(
        "gitlabConnectionBusy",
        "An operation is already using this GitLab connection. Cancel or wait for it to finish.",
    )
}
fn check(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(error(
            "operationCancelled",
            "Loading GitLab data was cancelled.",
        ));
    }
    Ok(())
}
pub(super) fn main_label(label: &str) -> Result<(), AppError> {
    if label != "main" {
        return Err(error(
            "gitlabWindowPermission",
            "GitLab connections are available only in the main window.",
        ));
    }
    Ok(())
}
pub(super) fn identifier() -> Result<String, AppError> {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        error(
            "gitlabConnectionUnavailable",
            "A GitLab connection identifier could not be created.",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn valid_id(id: &str) -> Result<(), AppError> {
    if id.len() != 32
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(unavailable());
    }
    Ok(())
}

impl Session {
    fn live(&self) -> bool {
        !self.closed.load(Ordering::Acquire) && self.created.elapsed() < LIFETIME
    }
    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        // Never acquire the HTTP transport lock to cancel an in-flight read.
        if let Ok(active) = self.active.lock()
            && let Some((_, token)) = active.as_ref()
        {
            token.cancel();
        }
    }
    fn begin<'a>(
        &'a self,
        operation: &str,
        cancellation: &CancellationToken,
    ) -> Result<ReadLease<'a>, AppError> {
        check(cancellation)?;
        let mut active = self.active.lock().map_err(state_error)?;
        if !self.live() {
            return Err(unavailable());
        }
        if active.is_some() {
            return Err(busy());
        }
        *active = Some((operation.into(), cancellation.clone()));
        Ok(ReadLease {
            session: self,
            operation: operation.into(),
            cancellation: cancellation.clone(),
        })
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

struct ReadLease<'a> {
    session: &'a Session,
    operation: String,
    cancellation: CancellationToken,
}
impl ReadLease<'_> {
    fn check(&self) -> Result<(), AppError> {
        check(&self.cancellation)?;
        if !self.session.live() {
            return Err(unavailable());
        }
        Ok(())
    }
}
// A page performs several provider reads. Each request needs a live native
// lease; an earlier request does not authorize the rest after expiry.
struct LeasedTransport<'read, 'session> {
    lease: &'read ReadLease<'session>,
    inner: &'read mut (dyn core::GitLabReadTransport + Send + 'static),
}
impl core::GitLabReadTransport for LeasedTransport<'_, '_> {
    fn get(
        &mut self,
        instance: &core::GitLabInstance,
        endpoint: &str,
        cancellation: &CancellationToken,
    ) -> Result<serde_json::Value, AppError> {
        self.lease.check()?;
        let result = self.inner.get(instance, endpoint, cancellation);
        self.lease.check()?;
        result
    }
}

impl Drop for ReadLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.session.active.lock()
            && active
                .as_ref()
                .is_some_and(|(operation, _)| operation == &self.operation)
        {
            *active = None;
        }
    }
}

struct Reservation<'a> {
    state: &'a GitLabAccounts,
    id: String,
}
impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.state.0.lock() {
            registry.connecting.remove(&self.id);
        }
    }
}
impl Reservation<'_> {
    fn finish(
        self,
        instance: core::GitLabInstance,
        account: core::GitLabAccount,
        transport: Box<dyn core::GitLabReadTransport + Send>,
        cancellation: &CancellationToken,
    ) -> Result<GitLabConnection, AppError> {
        self.finish_with_writer(instance, account, transport, None, cancellation)
    }
    fn finish_with_writer(
        self,
        instance: core::GitLabInstance,
        account: core::GitLabAccount,
        transport: Box<dyn core::GitLabReadTransport + Send>,
        fork_writer: Option<Box<dyn core::GitLabForkWriteTransport + Send>>,
        cancellation: &CancellationToken,
    ) -> Result<GitLabConnection, AppError> {
        check(cancellation)?;
        if account.origin != instance.origin() {
            return Err(error(
                "gitlabAccountChanged",
                "The GitLab account does not belong to this connection's instance.",
            ));
        }
        let expires_at_millis = SystemTime::now()
            .checked_add(LIFETIME)
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .ok_or_else(|| {
                error(
                    "gitlabClockUnavailable",
                    "The GitLab connection expiry could not be recorded.",
                )
            })?
            .as_millis()
            .to_string();
        let view = GitLabConnection {
            connection_id: self.id.clone(),
            account,
            expires_at_millis,
            can_create_fork: fork_writer.is_some(),
        };
        let session = Arc::new(Session {
            view: view.clone(),
            instance,
            created: Instant::now(),
            closed: AtomicBool::new(false),
            active: Mutex::new(None),
            transport: Mutex::new(transport),
            fork_writer: fork_writer.map(Mutex::new),
        });
        {
            let mut registry = self.state.0.lock().map_err(state_error)?;
            check(cancellation)?;
            if !registry.connecting.remove(&self.id) || registry.sessions.contains_key(&self.id) {
                return Err(unavailable());
            }
            registry.sessions.insert(self.id.clone(), session);
        }
        // Cancellation immediately after publication still retires this connection.
        if cancellation.is_cancelled() {
            self.state.disconnect(&self.id)?;
            check(cancellation)?;
        }
        Ok(view)
    }
}

impl GitLabAccounts {
    /// Retain one exact session and shared operation lease through preflight and
    /// submission. The action must check `live` at its durable dispatch boundary.
    /// There is deliberately no final lease check: after possible submission it
    /// must retain the outcome even if cancellation/disconnection wins the race.
    pub(super) fn fork<T>(
        &self,
        connection_id: &str,
        operation_id: &str,
        cancellation: &CancellationToken,
        action: impl FnOnce(
            &mut dyn core::GitLabReadTransport,
            &mut dyn core::GitLabForkWriteTransport,
            &core::GitLabInstance,
            &core::GitLabAccount,
            &dyn Fn() -> Result<(), AppError>,
        ) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let session = self.get(connection_id)?;
        let lease = session.begin(operation_id, cancellation)?;
        let writer = session.fork_writer.as_ref().ok_or_else(|| {
            error(
                "gitlabForkConnectionRequired",
                "Connect explicitly for fork creation before reviewing a submission.",
            )
        })?;
        let mut reader = session.transport.try_lock().map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => busy(),
            std::sync::TryLockError::Poisoned(error) => state_error(error),
        })?;
        let mut writer = writer.try_lock().map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => busy(),
            std::sync::TryLockError::Poisoned(error) => state_error(error),
        })?;
        lease.check()?;
        let mut reader = LeasedTransport {
            lease: &lease,
            inner: reader.as_mut(),
        };
        action(
            &mut reader,
            writer.as_mut(),
            &session.instance,
            &session.view.account,
            &|| lease.check(),
        )
    }

    // A closure cannot retain the transport or its lease. Git execution starts
    // only after this scope returns and releases provider read authority.
    pub(super) fn read<T>(
        &self,
        connection_id: &str,
        operation_id: &str,
        cancellation: &CancellationToken,
        action: impl FnOnce(
            &mut dyn core::GitLabReadTransport,
            &core::GitLabInstance,
            &core::GitLabAccount,
        ) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let session = self.get(connection_id)?;
        let lease = session.begin(operation_id, cancellation)?;
        let mut transport = session.transport.try_lock().map_err(|error| match error {
            std::sync::TryLockError::WouldBlock => busy(),
            std::sync::TryLockError::Poisoned(error) => state_error(error),
        })?;
        lease.check()?;
        let mut transport = LeasedTransport {
            lease: &lease,
            inner: transport.as_mut(),
        };
        let result = action(&mut transport, &session.instance, &session.view.account)?;
        lease.check()?;
        Ok(result)
    }

    pub fn start_cleanup(&self) {
        tauri::async_runtime::spawn(cleanup_loop(
            Arc::downgrade(&self.0),
            Duration::from_secs(60),
        ));
    }
    fn prune(registry: &mut Registry) {
        registry.sessions.retain(|_, session| {
            if session.live() {
                true
            } else {
                session.close();
                false
            }
        });
    }
    fn reserve_id(&self, id: String) -> Result<Reservation<'_>, AppError> {
        valid_id(&id)?;
        let mut registry = self.0.lock().map_err(state_error)?;
        Self::prune(&mut registry);
        if registry.sessions.len() + registry.connecting.len() >= CAPACITY {
            return Err(error(
                "gitlabConnectionCapacity",
                "Disconnect an existing GitLab account before connecting another.",
            ));
        }
        if registry.sessions.contains_key(&id) || !registry.connecting.insert(id.clone()) {
            return Err(unavailable());
        }
        Ok(Reservation { state: self, id })
    }
    fn reserve(&self) -> Result<Reservation<'_>, AppError> {
        self.reserve_id(identifier()?)
    }
    fn get(&self, id: &str) -> Result<Arc<Session>, AppError> {
        valid_id(id)?;
        let mut registry = self.0.lock().map_err(state_error)?;
        Self::prune(&mut registry);
        registry.sessions.get(id).cloned().ok_or_else(unavailable)
    }
    fn connections(&self) -> Result<Vec<GitLabConnection>, AppError> {
        let mut registry = self.0.lock().map_err(state_error)?;
        Self::prune(&mut registry);
        let mut views: Vec<_> = registry
            .sessions
            .values()
            .map(|session| session.view.clone())
            .collect();
        views.sort_by(|a, b| {
            a.account
                .origin
                .cmp(&b.account.origin)
                .then_with(|| a.account.login.cmp(&b.account.login))
                .then_with(|| a.connection_id.cmp(&b.connection_id))
        });
        Ok(views)
    }
    pub(super) fn disconnect(&self, id: &str) -> Result<bool, AppError> {
        valid_id(id)?;
        let session = self.0.lock().map_err(state_error)?.sessions.remove(id);
        if let Some(session) = session {
            session.close();
            return Ok(true);
        }
        Ok(false)
    }
}

#[cfg(test)]
impl GitLabAccounts {
    pub(super) fn fixture_connection(
        &self,
        id: String,
        instance: core::GitLabInstance,
        account: core::GitLabAccount,
        reader: Box<dyn core::GitLabReadTransport + Send>,
        writer: Option<Box<dyn core::GitLabForkWriteTransport + Send>>,
    ) -> GitLabConnection {
        self.reserve_id(id)
            .unwrap()
            .finish_with_writer(
                instance,
                account,
                reader,
                writer,
                &CancellationToken::default(),
            )
            .unwrap()
    }
}

async fn cleanup_loop(registry: std::sync::Weak<Mutex<Registry>>, interval: Duration) {
    loop {
        tokio::time::sleep(interval).await;
        let Some(registry) = registry.upgrade() else {
            return;
        };
        if let Ok(mut registry) = registry.lock() {
            GitLabAccounts::prune(&mut registry);
        }
    }
}

impl Drop for GitLabAccounts {
    fn drop(&mut self) {
        if let Ok(registry) = self.0.lock() {
            for session in registry.sessions.values() {
                session.close();
            }
        }
    }
}

fn projects(
    state: &GitLabAccounts,
    request: GitLabProjectsRequest,
    cancellation: &CancellationToken,
) -> Result<core::GitLabProjectPage, AppError> {
    let session = state.get(&request.connection_id)?;
    let lease = session.begin(&request.operation_id, cancellation)?;
    let mut query = request.query;
    if query
        .expected_account
        .as_ref()
        .is_some_and(|account| account != &session.view.account)
    {
        return Err(error(
            "gitlabAccountChanged",
            "Select the account bound to this GitLab connection and reload its first page.",
        ));
    }
    query.expected_account = Some(session.view.account.clone());
    let mut transport = session.transport.try_lock().map_err(|error| match error {
        std::sync::TryLockError::WouldBlock => busy(),
        std::sync::TryLockError::Poisoned(error) => state_error(error),
    })?;
    lease.check()?;
    let mut transport = LeasedTransport {
        lease: &lease,
        inner: transport.as_mut(),
    };
    let page = core::load_gitlab_project_page_with(
        &mut transport,
        &session.instance,
        query,
        cancellation,
    )?;
    lease.check()?;
    Ok(page)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn connect_gitlab_account(
    request: GitLabConnectRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<GitLabConnection, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let state = app.state::<GitLabAccounts>();
        let reservation = state.reserve()?;
        let instance = core::GitLabInstance::parse(&request.origin)?;
        let mut transport = core::GitLabHttpsTransport::new(instance.clone(), &request.token)?;
        drop(request.token);
        let account = core::load_gitlab_account_with(&mut transport, &instance, &cancellation)?;
        reservation.finish(instance, account, Box::new(transport), &cancellation)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn connect_gitlab_fork_account(
    request: GitLabConnectRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<GitLabConnection, AppError> {
    main_label(window.label())?;
    if !cfg!(target_os = "linux") {
        return Err(error(
            "gitlabForkPlatform",
            "Durable fork submission is not supported on this platform yet.",
        ));
    }
    let (cancellation, operation) = register_active_operation(&app, request.operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let state = app.state::<GitLabAccounts>();
        let reservation = state.reserve()?;
        let instance = core::GitLabInstance::parse(&request.origin)?;
        let mut reader = core::GitLabHttpsTransport::new(instance.clone(), &request.token)?;
        let writer = core::GitLabForkHttpsTransport::new(instance.clone(), &request.token)?;
        drop(request.token);
        let account = core::load_gitlab_account_with(&mut reader, &instance, &cancellation)?;
        reservation.finish_with_writer(
            instance,
            account,
            Box::new(reader),
            Some(Box::new(writer)),
            &cancellation,
        )
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn gitlab_connections(
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<Vec<GitLabConnection>, AppError> {
    main_label(window.label())?;
    app.state::<GitLabAccounts>().connections()
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_gitlab_projects(
    request: GitLabProjectsRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<core::GitLabProjectPage, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        projects(&app.state::<GitLabAccounts>(), request, &cancellation)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn disconnect_gitlab_account(
    connection_id: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<bool, AppError> {
    main_label(window.label())?;
    app.state::<GitLabAccounts>().disconnect(&connection_id)
}

#[cfg(test)]
#[path = "gitlab_commands_tests.rs"]
mod tests;
