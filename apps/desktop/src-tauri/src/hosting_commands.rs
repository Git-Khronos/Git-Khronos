use super::*;
use git_khronos_git_core::{HostedWritePlan, HostedWriteReceipt, HostedWriteRequest};
use std::time::{Duration, Instant};

const PLAN_LIFETIME: Duration = Duration::from_secs(15 * 60);

pub(super) struct CachedPlan {
    repo_id: String,
    remote: String,
    plan: HostedWritePlan,
    created: Instant,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedHostedWrite {
    token: String,
    plan: HostedWritePlan,
}

fn take_plan(
    plans: &mut HashMap<String, CachedPlan>,
    repo_id: &str,
    token: &str,
) -> Result<CachedPlan, AppError> {
    if !plans
        .get(token)
        .is_some_and(|plan| plan.repo_id == repo_id && plan.created.elapsed() < PLAN_LIFETIME)
    {
        return Err(AppError {
            kind: "staleHostedWritePlan".into(),
            message: "That hosted submission preview expired or was already used.".into(),
            hint: Some(
                "Reload the provider state and prepare a fresh preview before submitting.".into(),
            ),
        });
    }
    Ok(plans.remove(token).expect("validated hosted write plan"))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_hosted_write(
    repo_id: String,
    remote: String,
    request: HostedWriteRequest,
    operation_id: String,
    app: AppHandle,
) -> Result<PreparedHostedWrite, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    let completed_cancellation = cancellation.clone();
    // Provider requests never mutate Git files or refs. Core revalidates local
    // bindings; do not hold a Git operation lock across remote HTTP requests.
    let selected_remote = remote.clone();
    let plan = with_repository_background_read(repo_id.clone(), app.clone(), move |path| {
        git_khronos_git_core::prepare_hosted_write(path, &selected_remote, request, &cancellation)
    })
    .await?;
    if completed_cancellation.is_cancelled() {
        return Err(AppError {
            kind: "operationCancelled".into(),
            message: "Hosted request preparation was cancelled.".into(),
            hint: None,
        });
    }
    let state = app.state::<AppState>();
    let token = format!("hosted-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
    let mut plans = state.hosted_write_plans.lock().map_err(state_error)?;
    plans.retain(|_, cached| cached.repo_id != repo_id && cached.created.elapsed() < PLAN_LIFETIME);
    plans.insert(
        token.clone(),
        CachedPlan {
            repo_id,
            remote,
            plan: plan.clone(),
            created: Instant::now(),
        },
    );
    Ok(PreparedHostedWrite { token, plan })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn execute_hosted_write(
    repo_id: String,
    token: String,
    operation_id: String,
    app: AppHandle,
) -> Result<HostedWriteReceipt, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    // Consume the immutable server-side plan before resolving the repository
    // or starting any process. Success, cancellation and uncertain outcomes
    // all require a fresh, explicit preparation for another submission.
    let cached = {
        let state = app.state::<AppState>();
        let mut plans = state.hosted_write_plans.lock().map_err(state_error)?;
        take_plan(&mut plans, &repo_id, &token)?
    };
    with_repository_background_read(repo_id, app, move |path| {
        git_khronos_git_core::execute_hosted_write(
            path,
            &cached.remote,
            &cached.plan,
            &cancellation,
        )
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn discard_hosted_write_plan(
    repo_id: String,
    token: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, AppError> {
    let mut plans = state.hosted_write_plans.lock().map_err(state_error)?;
    if plans
        .get(&token)
        .is_some_and(|cached| cached.repo_id == repo_id)
    {
        plans.remove(&token);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cached() -> CachedPlan {
        CachedPlan {
            repo_id: "owned-repo".into(),
            remote: "origin".into(),
            created: Instant::now(),
            plan: HostedWritePlan {
                repository: "team/owned".into(),
                actor: "owned-author".into(),
                actor_id: "501".into(),
                source_repository: None,
                head_oid: "a".repeat(40),
                base_oid: "b".repeat(40),
                base_branch: "main".into(),
                request: HostedWriteRequest::Review {
                    number: 1,
                    expected_head_oid: "a".repeat(40),
                    event: git_khronos_git_core::HostedReviewEvent::Comment,
                    body: "Owned text".into(),
                },
            },
        }
    }
    #[test]
    fn a_submission_token_is_repository_bound_and_consumed_exactly_once() {
        let mut plans = HashMap::from([("owned-token".into(), cached())]);
        assert!(take_plan(&mut plans, "other-repo", "owned-token").is_err());
        assert_eq!(plans.len(), 1);
        let plan = take_plan(&mut plans, "owned-repo", "owned-token").unwrap();
        assert_eq!(plan.remote, "origin");
        assert!(plans.is_empty());
        assert!(take_plan(&mut plans, "owned-repo", "owned-token").is_err());
    }
    #[test]
    fn expired_or_unknown_tokens_cannot_dispatch_a_submission() {
        let mut expired = cached();
        expired.created = Instant::now() - PLAN_LIFETIME;
        let mut plans = HashMap::from([("expired".into(), expired)]);
        assert!(take_plan(&mut plans, "owned-repo", "expired").is_err());
        assert!(take_plan(&mut plans, "owned-repo", "unknown").is_err());
    }
}
