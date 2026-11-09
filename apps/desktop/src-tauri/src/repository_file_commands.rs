use crate::{
    AppState, RepositorySession, RepositorySnapshot, background_task_error, build_snapshot,
    execute_discard_with_recovery, register_active_operation, repository_session, state_error,
};
use git_khronos_git_core::{
    AppError, FileContentKind, FileContentLocation, RepositoryFiles,
    create_repository_file as git_create_repository_file, decode_working_text,
    delete_repository_file as git_delete_repository_file, prepare_discard, read_file_content,
    repository_files as git_repository_files, with_repository_regular_file,
};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryFileMutation {
    snapshot: Option<RepositorySnapshot>,
    refresh_error: Option<AppError>,
}

fn file_mutation_result(repo_id: String, session: &RepositorySession) -> RepositoryFileMutation {
    match build_snapshot(repo_id, session) {
        Ok(snapshot) => RepositoryFileMutation {
            snapshot: Some(snapshot),
            refresh_error: None,
        },
        Err(error) => RepositoryFileMutation {
            snapshot: None,
            refresh_error: Some(error),
        },
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(crate) async fn list_repository_files(
    repo_id: String,
    query: String,
    cursor: Option<String>,
    app: AppHandle,
) -> Result<RepositoryFiles, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        session.with_read_policy(|| git_repository_files(&session.path, &query, cursor.as_deref()))
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(crate) async fn create_repository_file(
    repo_id: String,
    path: String,
    app: AppHandle,
) -> Result<RepositoryFileMutation, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        git_create_repository_file(&session.path, &path)?;
        Ok(file_mutation_result(repo_id, &session))
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(crate) async fn delete_repository_file(
    repo_id: String,
    path: String,
    app: AppHandle,
) -> Result<RepositoryFileMutation, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        git_delete_repository_file(&session.path, &path)?;
        Ok(file_mutation_result(repo_id, &session))
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(crate) async fn delete_untracked_repository_file(
    repo_id: String,
    path: String,
    app: AppHandle,
) -> Result<RepositoryFileMutation, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        with_repository_regular_file(&session.path, &path, || {
            execute_discard_with_recovery(
                &repo_id,
                &state,
                &session,
                |repository| {
                    let plan = prepare_discard(repository, Some(vec![path.clone()]))?;
                    if plan.preview.untracked != 1
                        || plan.preview.paths.as_slice() != [path.as_str()]
                        || !plan.preview.skipped_paths.is_empty()
                    {
                        return Err(AppError {
                            kind: "staleWorkingTreeFile".into(),
                            message: "That file is no longer an eligible untracked file.".into(),
                            hint: Some("Refresh the file list and review it again.".into()),
                        });
                    }
                    Ok(plan)
                },
                |id, session| Ok(file_mutation_result(id, session)),
            )
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(crate) async fn read_repository_file_text(
    repo_id: String,
    path: String,
    operation_id: String,
    app: AppHandle,
) -> Result<Option<String>, AppError> {
    let (token, operation) = register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let session = repository_session(&repo_id, &app.state::<AppState>())?;
        session.with_read_policy(|| {
            let content = read_file_content(
                &session.path,
                &FileContentLocation::WorkingTree,
                &path,
                &token,
            )?;
            if content.kind != FileContentKind::Regular || content.over_limit {
                return Err(AppError {
                    kind: "fileTextUnavailable".into(),
                    message: "This file is not available as a bounded regular text file.".into(),
                    hint: Some(
                        "Use the file content preview to inspect its available type.".into(),
                    ),
                });
            }
            let bytes = content.bytes.ok_or_else(|| AppError {
                kind: "fileTextUnavailable".into(),
                message: "The complete file contents could not be read.".into(),
                hint: Some("Refresh the preview and try again.".into()),
            })?;
            match decode_working_text(&bytes, None) {
                Ok(text) if text.text().contains('\0') => Ok(None),
                Ok(text) => Ok(Some(text.text().to_owned())),
                Err(error) if error.kind == "workingFileEncoding" => Ok(None),
                Err(error) => Err(error),
            }
        })
    })
    .await
    .map_err(background_task_error)?
}
