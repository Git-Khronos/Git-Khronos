//! Native-owned fork reviews; clients never submit an executable fork plan.
use super::*;
use git_khronos_git_core as core;
use std::time::{Duration, Instant};

const LIFETIME: Duration = Duration::from_secs(15 * 60);
const MAX_REVIEWS: usize = 64;

enum Action {
    Create(Box<core::HostedForkPlan>),
    Acknowledge(Box<core::HostedForkStatus>),
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Purpose {
    Create,
    Acknowledge,
}
impl Action {
    fn purpose(&self) -> Purpose {
        match self {
            Self::Create(_) => Purpose::Create,
            Self::Acknowledge(_) => Purpose::Acknowledge,
        }
    }
}
pub(super) struct CachedReview {
    context_id: String,
    created: Instant,
    action: Action,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedHostedFork {
    token: String,
    plan: core::HostedForkPlan,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedForkAcknowledgement {
    token: String,
    status: core::HostedForkStatus,
    unresolved: bool,
}

fn error(kind: &str, message: &str, hint: Option<&str>) -> AppError {
    AppError {
        kind: kind.into(),
        message: message.into(),
        hint: hint.map(str::to_owned),
    }
}
pub(super) fn context(id: &str) -> Result<(), AppError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err(error(
            "hostedForkContext",
            "The fork review context is invalid.",
            None,
        ));
    }
    Ok(())
}
fn canceled() -> AppError {
    error(
        "operationCancelled",
        "The fork request preparation was canceled.",
        None,
    )
}
fn stale() -> AppError {
    error(
        "staleHostedForkReview",
        "That fork review expired, changed purpose or was already used.",
        Some("Review a fresh request before applying it."),
    )
}
fn storage(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("hosted-fork-requests"))
        .map_err(|_| {
            error(
                "hostedForkStorage",
                "The application's private fork-request storage could not be located.",
                None,
            )
        })
}
fn insert(
    reviews: &mut HashMap<String, CachedReview>,
    context_id: String,
    token: String,
    action: Action,
) -> Result<(), AppError> {
    context(&context_id)?;
    reviews
        .retain(|_, cached| cached.context_id != context_id && cached.created.elapsed() < LIFETIME);
    if reviews.len() >= MAX_REVIEWS {
        return Err(error(
            "hostedForkCapacity",
            "Too many fork reviews are open.",
            Some("Close an unused review, then prepare this request again."),
        ));
    }
    reviews.insert(
        token,
        CachedReview {
            context_id,
            created: Instant::now(),
            action,
        },
    );
    Ok(())
}
fn take(
    reviews: &mut HashMap<String, CachedReview>,
    context_id: &str,
    token: &str,
    purpose: Purpose,
) -> Result<Action, AppError> {
    context(context_id)?;
    if !reviews.get(token).is_some_and(|cached| {
        cached.context_id == context_id
            && cached.created.elapsed() < LIFETIME
            && cached.action.purpose() == purpose
    }) {
        return Err(stale());
    }
    Ok(reviews.remove(token).expect("validated fork review").action)
}
fn cache(app: &AppHandle, context_id: String, action: Action) -> Result<String, AppError> {
    let state = app.state::<AppState>();
    let token = format!(
        "fork-review-{}",
        state.next_id.fetch_add(1, Ordering::Relaxed)
    );
    let mut reviews = state.hosted_fork_reviews.lock().map_err(state_error)?;
    insert(&mut reviews, context_id, token.clone(), action)?;
    Ok(token)
}
fn consume(
    app: &AppHandle,
    context_id: &str,
    token: &str,
    purpose: Purpose,
) -> Result<Action, AppError> {
    let state = app.state::<AppState>();
    let mut reviews = state.hosted_fork_reviews.lock().map_err(state_error)?;
    take(&mut reviews, context_id, token, purpose)
}
async fn background<T: Send + 'static>(
    app: &AppHandle,
    operation_id: String,
    work: impl FnOnce(CancellationToken) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    let (cancellation, _operation) = register_active_operation(app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        if cancellation.is_cancelled() {
            return Err(canceled());
        }
        work(cancellation)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_hosted_forks(
    query: core::HostedForkQuery,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedForkPage, AppError> {
    background(&app, operation_id, move |c| {
        core::load_hosted_fork_page(query, &c)
    })
    .await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_hosted_fork(
    selection: core::HostedForkSelection,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedForkInspection, AppError> {
    background(&app, operation_id, move |c| {
        core::inspect_hosted_fork(&selection, &c)
    })
    .await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_hosted_fork(
    context_id: String,
    request: core::HostedForkRequest,
    operation_id: String,
    app: AppHandle,
) -> Result<PreparedHostedFork, AppError> {
    context(&context_id)?;
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    let completed = cancellation.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || {
        core::prepare_hosted_fork(&request, &cancellation)
    })
    .await
    .map_err(background_task_error)??;
    if completed.is_cancelled() {
        return Err(canceled());
    }
    let token = cache(&app, context_id, Action::Create(Box::new(plan.clone())))?;
    Ok(PreparedHostedFork { token, plan })
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn execute_hosted_fork(
    context_id: String,
    token: String,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedForkStatus, AppError> {
    context(&context_id)?;
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    // Consume before resolving storage or dispatching. Refusal, cancellation,
    // accepted and unconfirmed outcomes all spend this native review token.
    let Action::Create(plan) = consume(&app, &context_id, &token, Purpose::Create)? else {
        return Err(stale());
    };
    let directory = storage(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        core::execute_hosted_fork(&directory, &plan, &cancellation)
    })
    .await
    .map_err(background_task_error)?
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn list_hosted_fork_requests(
    operation_id: String,
    app: AppHandle,
) -> Result<Vec<core::HostedForkStatus>, AppError> {
    let directory = storage(&app)?;
    background(&app, operation_id, move |_| {
        core::list_hosted_fork_requests(&directory)
    })
    .await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_hosted_fork_request(
    id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedForkStatus, AppError> {
    let directory = storage(&app)?;
    background(&app, operation_id, move |_| {
        core::load_hosted_fork_request(&directory, &id)
    })
    .await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reconcile_hosted_fork(
    id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedForkStatus, AppError> {
    let directory = storage(&app)?;
    background(&app, operation_id, move |c| {
        core::load_hosted_fork_request(&directory, &id)?;
        core::reconcile_hosted_fork(&directory, &id, &c)
    })
    .await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_hosted_fork_acknowledgement(
    context_id: String,
    id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<PreparedForkAcknowledgement, AppError> {
    context(&context_id)?;
    let directory = storage(&app)?;
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    let status = tauri::async_runtime::spawn_blocking(move || {
        core::load_hosted_fork_request(&directory, &id)
    })
    .await
    .map_err(background_task_error)??;
    if cancellation.is_cancelled() {
        return Err(canceled());
    }
    let token = cache(
        &app,
        context_id,
        Action::Acknowledge(Box::new(status.clone())),
    )?;
    Ok(PreparedForkAcknowledgement {
        token,
        unresolved: status.phase != core::HostedForkPhase::Ready,
        status,
    })
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn execute_hosted_fork_acknowledgement(
    context_id: String,
    token: String,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedForkStatus, AppError> {
    context(&context_id)?;
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    let Action::Acknowledge(reviewed) = consume(&app, &context_id, &token, Purpose::Acknowledge)?
    else {
        return Err(stale());
    };
    let directory = storage(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if cancellation.is_cancelled() {
            return Err(canceled());
        }
        core::acknowledge_hosted_fork_request(&directory, &reviewed)?;
        // A confirmed local archive remains confirmed if cancellation races it.
        core::load_hosted_fork_request(&directory, &reviewed.id)
    })
    .await
    .map_err(background_task_error)?
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn discard_hosted_fork_review(
    context_id: String,
    token: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, AppError> {
    context(&context_id)?;
    let mut reviews = state.hosted_fork_reviews.lock().map_err(state_error)?;
    if reviews
        .get(&token)
        .is_some_and(|cached| cached.context_id == context_id)
    {
        reviews.remove(&token);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn status() -> core::HostedForkStatus {
        core::HostedForkStatus {
            id: "a".repeat(32),
            phase: core::HostedForkPhase::AwaitingConfirmation,
            intent: core::HostedForkIntent {
                account: core::HostedAccount {
                    host: "github.com".into(),
                    id: "7".into(),
                    login: "owned".into(),
                },
                source: core::HostedRepositoryIdentity {
                    id: "101".into(),
                    full_name: "team/source".into(),
                },
                network: core::HostedRepositoryIdentity {
                    id: "101".into(),
                    full_name: "team/source".into(),
                },
                destination: core::HostedForkOwner {
                    id: "7".into(),
                    login: "owned".into(),
                    kind: core::HostedForkOwnerKind::Personal,
                },
                name: "forked".into(),
                default_branch_only: true,
                forking_allowed: Some(true),
            },
            server_reply_received: false,
            observed_repository_id: None,
            repository: None,
            head_oid: None,
            notice: None,
        }
    }
    #[test]
    fn fork_reviews_bind_context_purpose_lifetime_and_consume_once() {
        let mut reviews = HashMap::new();
        insert(
            &mut reviews,
            "owned-context".into(),
            "token".into(),
            Action::Acknowledge(Box::new(status())),
        )
        .unwrap();
        assert!(take(&mut reviews, "other-context", "token", Purpose::Acknowledge).is_err());
        assert!(take(&mut reviews, "owned-context", "token", Purpose::Create).is_err());
        assert_eq!(reviews.len(), 1);
        assert!(matches!(
            take(&mut reviews, "owned-context", "token", Purpose::Acknowledge).unwrap(),
            Action::Acknowledge(_)
        ));
        assert!(take(&mut reviews, "owned-context", "token", Purpose::Acknowledge).is_err());
        insert(
            &mut reviews,
            "owned-context".into(),
            "expired".into(),
            Action::Acknowledge(Box::new(status())),
        )
        .unwrap();
        reviews.get_mut("expired").unwrap().created = Instant::now() - LIFETIME;
        assert!(
            take(
                &mut reviews,
                "owned-context",
                "expired",
                Purpose::Acknowledge
            )
            .is_err()
        );
    }
    #[test]
    fn new_fork_reviews_replace_only_their_context_and_capacity_is_bounded() {
        let mut reviews = HashMap::new();
        for i in 0..MAX_REVIEWS {
            insert(
                &mut reviews,
                format!("context-{i}"),
                format!("token-{i}"),
                Action::Acknowledge(Box::new(status())),
            )
            .unwrap();
        }
        assert!(
            insert(
                &mut reviews,
                "overflow".into(),
                "overflow".into(),
                Action::Acknowledge(Box::new(status()))
            )
            .is_err()
        );
        insert(
            &mut reviews,
            "context-0".into(),
            "replacement".into(),
            Action::Acknowledge(Box::new(status())),
        )
        .unwrap();
        assert!(!reviews.contains_key("token-0"));
        assert_eq!(reviews.len(), MAX_REVIEWS);
        reviews.get_mut("token-1").unwrap().created = Instant::now() - LIFETIME;
        insert(
            &mut reviews,
            "fresh".into(),
            "fresh".into(),
            Action::Acknowledge(Box::new(status())),
        )
        .unwrap();
        assert!(!reviews.contains_key("token-1"));
    }
    #[test]
    fn fork_review_contexts_and_requests_reject_forged_controls() {
        for invalid in ["", "../other", "context/other", "with space"] {
            assert!(context(invalid).is_err());
        }
        assert!(context("owned-context_7").is_ok());
        let request = serde_json::json!({"sourceFullName":"team/source","sourceRepositoryId":"101","accountId":"7","destinationOwner":"owned","name":"forked","defaultBranchOnly":true});
        assert!(serde_json::from_value::<core::HostedForkRequest>(request.clone()).is_ok());
        let mut forged = request.clone();
        forged["storagePath"] = serde_json::json!("/elsewhere");
        assert!(serde_json::from_value::<core::HostedForkRequest>(forged).is_err());
        let mut imprecise = request;
        imprecise["sourceRepositoryId"] = serde_json::json!(9007199254740993u64);
        assert!(serde_json::from_value::<core::HostedForkRequest>(imprecise).is_err());
    }
}
