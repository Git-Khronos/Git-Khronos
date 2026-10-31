use super::*;
use git_khronos_git_core as core;
use std::time::{Duration, Instant};

const LIFETIME: Duration = Duration::from_secs(15 * 60);
const MAX_PLANS: usize = 64;
pub(super) struct CachedClone {
    context_id: String,
    plan: core::HostedClonePlan,
    created: Instant,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedHostedClone {
    token: String,
    plan: core::HostedClonePlan,
}

fn context(id: &str) -> Result<(), AppError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err(AppError {
            kind: "hostedCloneContext".into(),
            message: "The clone review context is invalid.".into(),
            hint: None,
        });
    }
    Ok(())
}
fn expired() -> AppError {
    AppError {
        kind: "staleHostedClonePlan".into(),
        message: "That clone preview expired or was already used.".into(),
        hint: Some("Review a fresh hosted clone preview.".into()),
    }
}
fn take_plan(
    plans: &mut HashMap<String, CachedClone>,
    context_id: &str,
    token: &str,
) -> Result<core::HostedClonePlan, AppError> {
    if !plans.get(token).is_some_and(|cached| {
        cached.context_id == context_id && cached.created.elapsed() < LIFETIME
    }) {
        return Err(expired());
    }
    Ok(plans.remove(token).expect("validated clone preview").plan)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_hosted_repositories(
    query: core::HostedRepositoryQuery,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedRepositoryPage, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        core::load_hosted_repository_page(query, &cancellation)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_hosted_repository(
    full_name: String,
    repository_id: String,
    account_id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<core::HostedRepositoryInspection, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        core::inspect_hosted_repository(&full_name, &repository_id, &account_id, &cancellation)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_hosted_clone(
    context_id: String,
    request: core::HostedCloneRequest,
    operation_id: String,
    app: AppHandle,
) -> Result<PreparedHostedClone, AppError> {
    context(&context_id)?;
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    let completed = cancellation.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || {
        core::prepare_hosted_clone(request, &cancellation)
    })
    .await
    .map_err(background_task_error)??;
    if completed.is_cancelled() {
        return Err(AppError {
            kind: "operationCancelled".into(),
            message: "The hosted clone preview was canceled.".into(),
            hint: None,
        });
    }
    let state = app.state::<AppState>();
    let token = format!(
        "hosted-clone-{}",
        state.next_id.fetch_add(1, Ordering::Relaxed)
    );
    let mut plans = state.hosted_clone_plans.lock().map_err(state_error)?;
    plans
        .retain(|_, cached| cached.context_id != context_id && cached.created.elapsed() < LIFETIME);
    if plans.len() >= MAX_PLANS {
        return Err(AppError {
            kind: "hostedCloneCapacity".into(),
            message: "Too many clone previews are open.".into(),
            hint: Some("Close an unused preview, then retry.".into()),
        });
    }
    plans.insert(
        token.clone(),
        CachedClone {
            context_id,
            plan: plan.clone(),
            created: Instant::now(),
        },
    );
    Ok(PreparedHostedClone { token, plan })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn execute_hosted_clone(
    context_id: String,
    token: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    context(&context_id)?;
    let (cancellation, _operation) = register_active_operation(&app, operation_id.clone())?;
    let plan = {
        let state = app.state::<AppState>();
        let mut plans = state.hosted_clone_plans.lock().map_err(state_error)?;
        take_plan(&mut plans, &context_id, &token)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let root = authentication::run(&app, &operation_id, None, &cancellation, true, || {
            core::execute_hosted_clone(&plan, &cancellation)
        })?;
        let state = app.state::<AppState>();
        register_repository(root, &state, &app)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn discard_hosted_clone_plan(
    context_id: String,
    token: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, AppError> {
    context(&context_id)?;
    let mut plans = state.hosted_clone_plans.lock().map_err(state_error)?;
    if plans
        .get(&token)
        .is_some_and(|cached| cached.context_id == context_id)
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
    fn cached() -> CachedClone {
        CachedClone {
            context_id: "owned-context".into(),
            created: Instant::now(),
            plan: core::HostedClonePlan {
                account: core::HostedAccount {
                    host: "github.com".into(),
                    id: "7".into(),
                    login: "owned-user".into(),
                },
                repository: core::HostedRepositoryIdentity {
                    id: "11".into(),
                    full_name: "team/owned".into(),
                },
                transport: core::HostedCloneTransport::Https,
                url: "https://github.com/team/owned.git".into(),
                parent_path: "/owned".into(),
                folder: "checkout".into(),
                destination: "/owned/checkout".into(),
                branch: None,
                depth: None,
                recurse_submodules: false,
            },
        }
    }
    #[test]
    fn clone_reviews_are_context_bound_immutable_expiring_and_single_use() {
        let mut plans = HashMap::from([("owned-token".into(), cached())]);
        assert!(take_plan(&mut plans, "other-context", "owned-token").is_err());
        assert_eq!(plans.len(), 1);
        let plan = take_plan(&mut plans, "owned-context", "owned-token").unwrap();
        assert_eq!(plan.url, "https://github.com/team/owned.git");
        assert!(take_plan(&mut plans, "owned-context", "owned-token").is_err());
        let mut old = cached();
        old.created = Instant::now() - LIFETIME;
        plans.insert("old".into(), old);
        assert!(take_plan(&mut plans, "owned-context", "old").is_err());
    }
    #[test]
    fn malformed_context_and_unexpected_clone_request_fields_are_refused() {
        for id in ["", "a/b", "space id"] {
            assert!(context(id).is_err());
        }
        let mut request = serde_json::json!({"fullName":"team/owned","repositoryId":"11","accountId":"7","transport":"https","parentPath":"/owned","folder":"checkout","branch":null,"depth":null,"recurseSubmodules":false});
        assert!(serde_json::from_value::<core::HostedCloneRequest>(request.clone()).is_ok());
        request["url"] = serde_json::json!("https://elsewhere.test/redirect.git");
        assert!(serde_json::from_value::<core::HostedCloneRequest>(request).is_err());
    }
}
