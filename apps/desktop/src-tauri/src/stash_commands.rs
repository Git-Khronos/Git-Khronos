use super::*;
use git_khronos_git_core::StashOptions;

#[tauri::command(rename_all = "camelCase")]
pub async fn stash_selected(
    repo_id: String,
    options: StashOptions,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_and_refresh(&repo_id, &state, |path| {
            git_khronos_git_core::stash_with_options(path, &options)
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn apply_stash_options(
    repo_id: String,
    reference: String,
    expected_oid: String,
    restore_index: bool,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_and_refresh(&repo_id, &state, |path| {
            git_khronos_git_core::apply_stash_with_index(
                path,
                &reference,
                &expected_oid,
                restore_index,
            )
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn branch_from_stash(
    repo_id: String,
    reference: String,
    expected_oid: String,
    name: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_and_refresh(&repo_id, &state, |path| {
            git_khronos_git_core::create_branch_from_stash(path, &reference, &expected_oid, &name)
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stash_checkout(
    repo_id: String,
    name: String,
    expected_head: String,
    expected_target: String,
    message: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_and_refresh(&repo_id, &state, |path| {
            git_khronos_git_core::stash_and_checkout(
                path,
                &name,
                &expected_head,
                &expected_target,
                &message,
            )
        })
    })
    .await
    .map_err(background_task_error)?
}
