//! Account-leased, main-window reads for the independently implemented fork workflow.
//! No API writes, credential arguments, local repository changes or ready-made plans.
use crate::gitlab_commands::{GitLabAccounts, main_label};
use crate::{AppError, AppHandle, Manager, background_task_error, register_active_operation};
use git_khronos_git_core as core;
use serde::Deserialize;

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabNamespacesRequest {
    pub connection_id: String,
    pub query: core::GitLabNamespaceQuery,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabForksRequest {
    pub connection_id: String,
    pub query: core::GitLabForkQuery,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabInspectForkRequest {
    pub connection_id: String,
    pub selection: core::GitLabForkSelection,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabInspectNamespaceRequest {
    pub connection_id: String,
    pub selection: core::GitLabNamespaceSelection,
    pub operation_id: String,
}
async fn read<T: Send + 'static>(
    app: AppHandle,
    connection_id: String,
    operation_id: String,
    action: impl FnOnce(
        &mut dyn core::GitLabReadTransport,
        &core::GitLabInstance,
        &core::GitLabAccount,
        &core::CancellationToken,
    ) -> Result<T, AppError>
    + Send
    + 'static,
) -> Result<T, AppError> {
    let (cancellation, operation) = register_active_operation(&app, operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        app.state::<GitLabAccounts>().read(
            &connection_id,
            &operation_id,
            &cancellation,
            |transport, instance, account| action(transport, instance, account, &cancellation),
        )
    })
    .await
    .map_err(background_task_error)?
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_gitlab_namespaces(
    request: GitLabNamespacesRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<core::GitLabNamespacePage, AppError> {
    main_label(window.label())?;
    read(
        app,
        request.connection_id,
        request.operation_id,
        move |transport, instance, account, cancellation| {
            core::load_gitlab_namespace_page_with(
                transport,
                instance,
                account,
                request.query,
                cancellation,
            )
        },
    )
    .await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_gitlab_namespace(
    request: GitLabInspectNamespaceRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<core::GitLabNamespaceInspection, AppError> {
    main_label(window.label())?;
    read(
        app,
        request.connection_id,
        request.operation_id,
        move |transport, instance, account, cancellation| {
            core::inspect_gitlab_namespace_with(
                transport,
                instance,
                account,
                &request.selection,
                cancellation,
            )
        },
    )
    .await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_gitlab_forks(
    request: GitLabForksRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<core::GitLabForkPage, AppError> {
    main_label(window.label())?;
    read(
        app,
        request.connection_id,
        request.operation_id,
        move |transport, instance, account, cancellation| {
            core::load_gitlab_fork_page_with(
                transport,
                instance,
                account,
                request.query,
                cancellation,
            )
        },
    )
    .await
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_gitlab_fork(
    request: GitLabInspectForkRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<core::GitLabForkInspection, AppError> {
    main_label(window.label())?;
    read(
        app,
        request.connection_id,
        request.operation_id,
        move |transport, instance, account, cancellation| {
            core::inspect_gitlab_fork_with(
                transport,
                instance,
                account,
                &request.selection,
                cancellation,
            )
        },
    )
    .await
}
#[cfg(test)]
#[path = "gitlab_fork_commands_tests.rs"]
mod tests;
