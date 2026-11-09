use super::*;

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceTransport {
    remote: String,
    name: String,
    kind: String,
    delete: bool,
    expected_oid: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn configure_remote(
    repo_id: String,
    name: String,
    fetch_url: String,
    push_url: Option<String>,
    change_push: bool,
    add: bool,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_and_refresh(&repo_id, &state, |path| {
            git_khronos_git_core::configure_remote_urls(
                path,
                &name,
                &fetch_url,
                push_url.as_deref(),
                change_push,
                add,
            )
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn manage_reference(
    repo_id: String,
    action: String,
    name: String,
    expected_oid: Option<String>,
    message: Option<String>,
    url: Option<String>,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_and_refresh(&repo_id, &state, |path| match action.as_str() {
            "delete-tag" => git_khronos_git_core::delete_local_tag(
                path,
                &name,
                expected_oid.as_deref().unwrap_or(""),
            ),
            "signed-tag" => git_khronos_git_core::create_signed_tag(
                path,
                &name,
                expected_oid.as_deref().unwrap_or(""),
                message.as_deref().unwrap_or(""),
            ),
            "verify-tag" => git_khronos_git_core::verify_tag(path, &name),
            "set-push-url" => {
                git_khronos_git_core::set_remote_push_url(path, &name, url.as_deref())
            }
            _ => Err(AppError {
                kind: "invalidReferenceAction".into(),
                message: "That reference action is not supported.".into(),
                hint: None,
            }),
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn transport_reference(
    repo_id: String,
    request: ReferenceTransport,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| {
            git_khronos_git_core::transport_reference(
                path,
                &request.remote,
                &request.name,
                &request.kind,
                request.delete,
                request.expected_oid.as_deref(),
                cancellation,
            )
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn preview_remote_tag(
    repo_id: String,
    remote: String,
    name: String,
    operation_id: String,
    app: AppHandle,
) -> Result<String, AppError> {
    let (cancellation, _guard) = register_active_operation(&app, operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        authentication::run(
            &app,
            &operation_id,
            Some(&repo_id),
            &cancellation,
            true,
            || {
                git_khronos_git_core::remote_tag_object(
                    &session.path,
                    &remote,
                    &name,
                    &cancellation,
                )
            },
        )
    })
    .await
    .map_err(background_task_error)?
}
