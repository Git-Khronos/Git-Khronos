use super::*;
use git_khronos_git_core::{
    OperationRecovery, ResetPreview, delete_operation_recovery, execute_reset,
    operation_recoveries, prepare_reset, restore_operation_branch,
};

#[derive(Serialize)]
pub struct PreparedReset {
    token: String,
    #[serde(flatten)]
    preview: ResetPreview,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn preview_reset(
    repo_id: String,
    oid: String,
    mode: String,
    app: AppHandle,
) -> Result<PreparedReset, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        let plan = prepare_reset(&session.path, &oid, &mode)?;
        let token = state.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let preview = plan.preview.clone();
        let mut plans = state.reset_plans.lock().map_err(state_error)?;
        plans.retain(|_, (repository, _)| repository != &repo_id);
        plans.insert(token.clone(), (repo_id, plan));
        Ok(PreparedReset { token, preview })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn execute_prepared_reset(
    repo_id: String,
    token: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        let mut plans = state.reset_plans.lock().map_err(state_error)?;
        if !plans
            .get(&token)
            .is_some_and(|(repository, _)| repository == &repo_id)
        {
            return Err(AppError {
                kind: "staleReset".into(),
                message: "That reset preview expired.".into(),
                hint: Some("Review a new preview before resetting.".into()),
            });
        }
        let (_, plan) = plans.remove(&token).expect("validated reset plan");
        drop(plans);
        execute_reset(&session.path, &plan)?;
        build_snapshot(repo_id, &session)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn load_operation_recoveries(
    repo_id: String,
    app: AppHandle,
) -> Result<Vec<OperationRecovery>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        operation_recoveries(&session.path)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn restore_operation_recovery(
    repo_id: String,
    id: String,
    branch: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_and_refresh(&repo_id, &state, |path| {
            restore_operation_branch(path, &id, &branch)
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn forget_operation_recovery(
    repo_id: String,
    id: String,
    app: AppHandle,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        delete_operation_recovery(&session.path, &id)
    })
    .await
    .map_err(background_task_error)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reset_preview_matches_the_flat_renderer_contract() {
        let preview = PreparedReset {
            token: "preview-token".into(),
            preview: ResetPreview {
                head_oid: "a".repeat(40),
                target_oid: "b".repeat(40),
                mode: "hard".into(),
                paths: vec!["a binary [file]".into()],
            },
        };
        assert_eq!(
            serde_json::to_value(preview).unwrap(),
            serde_json::json!({
                "token": "preview-token", "headOid": "a".repeat(40),
                "targetOid": "b".repeat(40), "mode": "hard",
                "paths": ["a binary [file]"],
            })
        );
    }
}
