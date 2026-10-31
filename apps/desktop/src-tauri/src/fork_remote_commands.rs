//! Repository/context-bound fork attachment reviews. No client executable plan.
use super::*;
use git_khronos_git_core as core;
use std::time::{Duration, Instant};

const LIFETIME: Duration = Duration::from_secs(15 * 60);
// Plans hold private configuration snapshots; keep fewer than provider reviews.
const MAX_PLANS: usize = 16;

pub(super) struct Cached<T> {
    repo_id: String,
    context_id: String,
    created: Instant,
    plan: T,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedHostedForkRemote {
    token: String,
    plan: core::HostedForkRemotePlan,
}

fn stale() -> AppError {
    AppError {
        kind: "staleHostedForkRemotePlan".into(),
        message:
            "The fork attachment review expired, changed repository/context or was already used."
                .into(),
        hint: Some("Inspect the current remotes and prepare a fresh local review.".into()),
    }
}
fn canceled() -> AppError {
    AppError {
        kind: "operationCancelled".into(),
        message: "The fork attachment operation was canceled.".into(),
        hint: None,
    }
}
fn insert<T>(
    plans: &mut HashMap<String, Cached<T>>,
    repo_id: String,
    context_id: String,
    token: String,
    plan: T,
) -> Result<(), AppError> {
    fork_commands::context(&context_id)?;
    plans
        .retain(|_, cached| cached.context_id != context_id && cached.created.elapsed() < LIFETIME);
    if plans.len() >= MAX_PLANS {
        return Err(AppError {
            kind: "hostedForkRemoteCapacity".into(),
            message: "Too many local fork attachment reviews are open.".into(),
            hint: Some("Close an unused attachment review and try again.".into()),
        });
    }
    plans.insert(
        token,
        Cached {
            repo_id,
            context_id,
            created: Instant::now(),
            plan,
        },
    );
    Ok(())
}
fn matches<T>(cached: &Cached<T>, repo_id: &str, context_id: &str) -> bool {
    cached.repo_id == repo_id
        && cached.context_id == context_id
        && cached.created.elapsed() < LIFETIME
}
fn take<T>(
    plans: &mut HashMap<String, Cached<T>>,
    repo_id: &str,
    context_id: &str,
    token: &str,
) -> Result<T, AppError> {
    fork_commands::context(context_id)?;
    if !plans
        .get(token)
        .is_some_and(|cached| matches(cached, repo_id, context_id))
    {
        return Err(stale());
    }
    Ok(plans
        .remove(token)
        .expect("validated fork attachment review")
        .plan)
}
fn discard<T>(
    plans: &mut HashMap<String, Cached<T>>,
    repo_id: &str,
    context_id: &str,
    token: &str,
) -> Result<bool, AppError> {
    fork_commands::context(context_id)?;
    if plans
        .get(token)
        .is_some_and(|cached| cached.repo_id == repo_id && cached.context_id == context_id)
    {
        plans.remove(token);
        return Ok(true);
    }
    Ok(false)
}
fn operation_lock<'a>(
    operation: &'a Mutex<()>,
    cancellation: &CancellationToken,
    timeout: Duration,
) -> Result<std::sync::MutexGuard<'a, ()>, AppError> {
    let started = Instant::now();
    loop {
        if cancellation.is_cancelled() {
            return Err(canceled());
        }
        match operation.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(std::sync::TryLockError::Poisoned(error)) => return Err(state_error(error)),
            Err(std::sync::TryLockError::WouldBlock) if started.elapsed() >= timeout => {
                return Err(AppError {
                    kind: "repositoryBusy".into(),
                    message: "Another Git operation is still using this repository.".into(),
                    hint: Some(
                        "Wait for it to finish and prepare a fresh attachment review.".into(),
                    ),
                });
            }
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(Duration::from_millis(10))
            }
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_hosted_fork_remote(
    repo_id: String,
    context_id: String,
    request: core::HostedForkRemoteRequest,
    operation_id: String,
    app: AppHandle,
) -> Result<PreparedHostedForkRemote, AppError> {
    fork_commands::context(&context_id)?;
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    let completed = cancellation.clone();
    // Local comparison and provider reads do not hold the repository write
    // mutex. The core rejects a changed local snapshot before returning a plan.
    let plan = with_repository_background_read(repo_id.clone(), app.clone(), move |path| {
        core::prepare_hosted_fork_remote(path, &request, &cancellation)
    })
    .await?;
    if completed.is_cancelled() {
        return Err(canceled());
    }
    let state = app.state::<AppState>();
    let token = format!(
        "fork-remote-review-{}",
        state.next_id.fetch_add(1, Ordering::Relaxed)
    );
    let mut plans = state.hosted_fork_remote_plans.lock().map_err(state_error)?;
    insert(&mut plans, repo_id, context_id, token.clone(), plan.clone())?;
    Ok(PreparedHostedForkRemote { token, plan })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn execute_hosted_fork_remote(
    repo_id: String,
    context_id: String,
    token: String,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedForkRemoteReceipt, AppError> {
    fork_commands::context(&context_id)?;
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    // Spend before repository lookup or lock waiting. Refusal and cancellation
    // require a new explicit local review, never an automatic replay.
    let plan = {
        let state = app.state::<AppState>();
        let mut plans = state.hosted_fork_remote_plans.lock().map_err(state_error)?;
        take(&mut plans, &repo_id, &context_id, &token)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _guard = operation_lock(&session.operation, &cancellation, Duration::from_secs(10))?;
        core::execute_hosted_fork_remote(&session.path, &plan, &cancellation)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn discard_hosted_fork_remote(
    repo_id: String,
    context_id: String,
    token: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, AppError> {
    let mut plans = state.hosted_fork_remote_plans.lock().map_err(state_error)?;
    discard(&mut plans, &repo_id, &context_id, &token)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachment_reviews_preserve_wrong_bindings_and_consume_the_server_value_once() {
        let mut plans = HashMap::new();
        let mut client = "original owned value".to_owned();
        insert(
            &mut plans,
            "repo-a".into(),
            "context-a".into(),
            "token".into(),
            client.clone(),
        )
        .unwrap();
        client.clear();
        assert!(take(&mut plans, "repo-b", "context-a", "token").is_err());
        assert!(take(&mut plans, "repo-a", "context-b", "token").is_err());
        assert_eq!(plans.len(), 1);
        assert_eq!(
            take(&mut plans, "repo-a", "context-a", "token").unwrap(),
            "original owned value"
        );
        assert!(take(&mut plans, "repo-a", "context-a", "token").is_err());
    }
    #[test]
    fn fresh_context_review_retires_its_previous_repository_binding() {
        let mut plans = HashMap::new();
        insert(
            &mut plans,
            "repo-a".into(),
            "context".into(),
            "old".into(),
            1,
        )
        .unwrap();
        insert(
            &mut plans,
            "repo-b".into(),
            "context".into(),
            "new".into(),
            2,
        )
        .unwrap();
        assert!(take(&mut plans, "repo-a", "context", "old").is_err());
        assert_eq!(take(&mut plans, "repo-b", "context", "new").unwrap(), 2);
    }
    #[test]
    fn discard_requires_both_repository_and_context_and_never_erases_another_review() {
        let mut plans = HashMap::new();
        insert(
            &mut plans,
            "repo-a".into(),
            "context".into(),
            "token".into(),
            1,
        )
        .unwrap();
        assert!(!discard(&mut plans, "repo-b", "context", "token").unwrap());
        assert!(!discard(&mut plans, "repo-a", "other", "token").unwrap());
        assert!(discard(&mut plans, "repo-a", "context", "token").unwrap());
        assert!(plans.is_empty());
    }
    #[test]
    fn expired_and_excess_attachment_reviews_cannot_dispatch_and_invalid_contexts_do_not_mutate_cache()
     {
        let mut plans = HashMap::new();
        for i in 0..MAX_PLANS {
            insert(
                &mut plans,
                "repo".into(),
                format!("context-{i}"),
                format!("token-{i}"),
                i,
            )
            .unwrap();
        }
        assert!(
            insert(
                &mut plans,
                "repo".into(),
                "excess".into(),
                "excess".into(),
                1
            )
            .is_err()
        );
        assert!(
            insert(
                &mut plans,
                "repo".into(),
                "../invalid".into(),
                "invalid".into(),
                1
            )
            .is_err()
        );
        assert_eq!(plans.len(), MAX_PLANS);
        plans.get_mut("token-0").unwrap().created = Instant::now() - LIFETIME;
        assert!(take(&mut plans, "repo", "context-0", "token-0").is_err());
        insert(&mut plans, "repo".into(), "fresh".into(), "fresh".into(), 9).unwrap();
        assert!(!plans.contains_key("token-0"));
        assert_eq!(take(&mut plans, "repo", "fresh", "fresh").unwrap(), 9);
    }
    #[test]
    fn queued_attachment_locks_are_bounded_and_cancel_without_acquiring_the_mutex() {
        let operation = Arc::new(Mutex::new(()));
        let guard = operation.lock().unwrap();
        assert_eq!(
            operation_lock(&operation, &CancellationToken::default(), Duration::ZERO)
                .unwrap_err()
                .kind,
            "repositoryBusy"
        );
        let cancellation = CancellationToken::default();
        let worker_token = cancellation.clone();
        let worker_mutex = operation.clone();
        let (entered, ready) = std::sync::mpsc::channel();
        let (completed, outcome) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            entered.send(()).unwrap();
            let error =
                operation_lock(&worker_mutex, &worker_token, Duration::from_secs(10)).unwrap_err();
            completed.send(error.kind).unwrap();
        });
        ready.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(matches!(
            outcome.recv_timeout(Duration::from_millis(20)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        cancellation.cancel();
        assert_eq!(
            outcome.recv_timeout(Duration::from_secs(1)).unwrap(),
            "operationCancelled"
        );
        thread.join().unwrap();
        drop(guard);
        assert!(operation_lock(&operation, &CancellationToken::default(), Duration::ZERO).is_ok());
    }
    #[test]
    fn attachment_request_decoding_refuses_paths_and_numeric_provider_ids() {
        let request = serde_json::json!({"sourceRemote":"origin","remoteName":"fork","transport":"https","selection":{"sourceFullName":"team/source","sourceRepositoryId":"101","accountId":"7","forkFullName":"owned/fork","forkRepositoryId":"9007199254740993","forkOwnerId":"7"}});
        assert!(serde_json::from_value::<core::HostedForkRemoteRequest>(request.clone()).is_ok());
        let mut numeric = request.clone();
        numeric["selection"]["forkRepositoryId"] = serde_json::json!(9007199254740993u64);
        assert!(serde_json::from_value::<core::HostedForkRemoteRequest>(numeric).is_err());
        let mut path = request;
        path["configurationPath"] = serde_json::json!("/elsewhere/config");
        assert!(serde_json::from_value::<core::HostedForkRemoteRequest>(path).is_err());
    }
}
