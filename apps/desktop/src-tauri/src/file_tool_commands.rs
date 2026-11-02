//! Main-window review boundaries for independently configured file programs.
use super::{AppError, AppHandle};
use git_khronos_git_core as core;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "linux")]
#[path = "file_tool_runtime.rs"]
mod runtime;
#[cfg(target_os = "linux")]
pub use runtime::FileToolState;
#[cfg(not(target_os = "linux"))]
#[derive(Default)]
pub struct FileToolState {
    _private: (),
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareFileToolLaunchRequest {
    pub repo_id: String,
    pub context_id: String,
    pub request: core::FileToolRequest,
    pub profile: core::ToolProfile,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileToolReviewRequest {
    pub session_id: String,
    pub context_id: String,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteFileToolReviewRequest {
    pub context_id: String,
    pub token: String,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveFileToolResultRequest {
    pub context_id: String,
    pub token: String,
    pub operation_id: String,
    pub finished_editing: bool,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscardFileToolSessionRequest {
    pub context_id: String,
    pub token: String,
    pub operation_id: String,
    pub finished_using_files: bool,
}
#[derive(Clone, Copy, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileToolReviewPurpose {
    Launch,
    Result,
    Stage,
    Cleanup,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscardFileToolReviewRequest {
    pub context_id: String,
    pub token: String,
    pub purpose: FileToolReviewPurpose,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFileToolLaunch {
    pub token: String,
    pub review: core::FileToolLaunchReview,
}
#[derive(Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileToolSessionPhase {
    Launching,
    Launched,
    Failed,
    CleanupFailed,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolSessionSnapshot {
    pub requested_at_millis: String,
    pub id: String,
    pub revision: String,
    pub repo_id: String,
    pub review: core::FileToolLaunchReview,
    pub phase: FileToolSessionPhase,
    pub process: Option<core::FileToolProcessStatus>,
    pub error: Option<AppError>,
    pub can_review_staging: bool,
}
#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolOutputSummary {
    pub path: String,
    pub bytes: String,
    pub sha256: String,
    pub text_preview: Option<String>,
    pub truncated: bool,
    pub binary: bool,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFileToolResult {
    pub token: String,
    pub session_id: String,
    pub output: FileToolOutputSummary,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolSaveOutcome {
    pub session: FileToolSessionSnapshot,
    pub write: core::FileToolMergeWriteResult,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFileToolStage {
    pub token: String,
    pub session_id: String,
    pub path: String,
    pub bytes: String,
    pub sha256: String,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolStageOutcome {
    pub session: FileToolSessionSnapshot,
    pub stage: core::FileToolMergeStageResult,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFileToolCleanup {
    pub token: String,
    pub session_id: String,
    pub review: core::FileToolCleanupReview,
}
fn unavailable() -> AppError {
    AppError {
        kind: "fileToolUnavailable".into(),
        message: "External file tools are unavailable in this window or platform.".into(),
        hint: None,
    }
}
fn main_label(label: &str) -> Result<(), AppError> {
    if label != "main" {
        return Err(unavailable());
    }
    Ok(())
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), AppError> {
    main_label(window.label())
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_file_tool_launch(
    request: PrepareFileToolLaunchRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<PreparedFileToolLaunch, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::prepare_launch(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn launch_reviewed_file_tool(
    request: ExecuteFileToolReviewRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<FileToolSessionSnapshot, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::launch(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn list_file_tool_sessions(
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<Vec<FileToolSessionSnapshot>, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::sessions(app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn stop_file_tool_command(
    session_id: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<FileToolSessionSnapshot, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::stop(session_id, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn review_file_tool_result(
    request: FileToolReviewRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<PreparedFileToolResult, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::prepare_result(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn save_reviewed_file_tool_result(
    request: SaveFileToolResultRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<FileToolSaveOutcome, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::apply_result(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn review_file_tool_staging(
    request: FileToolReviewRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<PreparedFileToolStage, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::prepare_stage(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn stage_reviewed_file_tool_result(
    request: ExecuteFileToolReviewRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<FileToolStageOutcome, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::stage(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn review_file_tool_cleanup(
    request: FileToolReviewRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<PreparedFileToolCleanup, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::prepare_cleanup(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn discard_reviewed_file_tool_session(
    request: DiscardFileToolSessionRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<bool, AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::discard_session(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn discard_file_tool_review(
    request: DiscardFileToolReviewRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<(), AppError> {
    main_window(&window)?;
    #[cfg(target_os = "linux")]
    {
        runtime::discard_review(request, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (request, app);
        Err(unavailable())
    }
}

#[cfg(test)]
#[path = "file_tool_commands_tests.rs"]
mod tests;
