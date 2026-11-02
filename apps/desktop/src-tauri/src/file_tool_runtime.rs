//! Linux native ownership; no renderer-supplied executable argv or storage paths.
use super::*;
use crate::file_tool_reviews::{Purpose, ReviewStore};
use crate::{
    AppState, authentication, background_task_error, register_active_operation, repository_session,
    state_error,
};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Manager;
const SESSION_CAPACITY: usize = 16;
#[derive(Default)]
pub struct FileToolState {
    reviews: Mutex<ReviewStore<Payload>>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
struct Session {
    requested_at_millis: String,
    id: String,
    repo_id: String,
    closed: AtomicBool,
    value: Mutex<SessionValue>,
}
struct SessionValue {
    revision: String,
    tool: core::PreparedFileTool,
    child: Option<core::FileToolProcess>,
    phase: FileToolSessionPhase,
    error: Option<AppError>,
    saved: Option<FileToolOutputSummary>,
}
enum Payload {
    Launch {
        repo_id: String,
        tool: Box<core::PreparedFileTool>,
    },
    Result {
        session: Arc<Session>,
        revision: String,
        result: core::FileToolResult,
        summary: FileToolOutputSummary,
    },
    Stage {
        session: Arc<Session>,
        revision: String,
    },
    Cleanup {
        session: Arc<Session>,
        revision: String,
        cleanup: core::PreparedFileToolCleanup,
    },
}
fn refused(message: &str) -> AppError {
    AppError {
        kind: "fileToolSessionUnavailable".into(),
        message: message.into(),
        hint: Some(
            "Inspect the tool session and retained files before preparing another action.".into(),
        ),
    }
}
fn identifier() -> Result<String, AppError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|_| refused("A unique tool review could not be created."))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn check(token: &core::CancellationToken) -> Result<(), AppError> {
    if token.is_cancelled() {
        return Err(AppError {
            kind: "operationCancelled".into(),
            message: "The tool review request was cancelled.".into(),
            hint: None,
        });
    }
    Ok(())
}
fn retire(value: Payload) {
    if let Payload::Launch { mut tool, .. } = value {
        let _ = tool.discard();
    }
}
impl FileToolState {
    fn prune(&self) -> Result<(), AppError> {
        let expired = self.reviews.lock().map_err(state_error)?.prune();
        for value in expired {
            retire(value);
        }
        Ok(())
    }
    fn take(&self, context: &str, purpose: Purpose, token: &str) -> Result<Payload, AppError> {
        self.prune()?;
        self.reviews
            .lock()
            .map_err(state_error)?
            .take(context, purpose, token)
    }
    fn get(&self, id: &str) -> Result<Arc<Session>, AppError> {
        if id.len() != 32
            || !id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(refused("That tool session identifier is invalid."));
        }
        let session = self
            .sessions
            .lock()
            .map_err(state_error)?
            .get(id)
            .cloned()
            .ok_or_else(|| refused("That tool session is unavailable."))?;
        session.live()?;
        Ok(session)
    }
    fn insert(&self, session: Arc<Session>) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().map_err(state_error)?;
        if sessions.len() >= SESSION_CAPACITY || sessions.contains_key(&session.id) {
            return Err(refused(
                "Finish and retire an unused tool session before launching another.",
            ));
        }
        sessions.insert(session.id.clone(), session);
        Ok(())
    }
}
struct Reservation<'a> {
    state: &'a FileToolState,
    context: String,
    purpose: Purpose,
    token: String,
    published: bool,
}
impl<'a> Reservation<'a> {
    fn new(state: &'a FileToolState, context: &str, purpose: Purpose) -> Result<Self, AppError> {
        state.prune()?;
        let token = identifier()?;
        let old = state
            .reviews
            .lock()
            .map_err(state_error)?
            .reserve(context, purpose, &token)?;
        if let Some(old) = old {
            retire(old);
        }
        Ok(Self {
            state,
            context: context.into(),
            purpose,
            token,
            published: false,
        })
    }
    fn publish(
        mut self,
        payload: Payload,
        cancellation: &core::CancellationToken,
    ) -> Result<String, AppError> {
        if let Err(error) = check(cancellation) {
            retire(payload);
            return Err(error);
        }
        let outcome = self.state.reviews.lock().map_err(state_error)?.publish(
            &self.context,
            self.purpose,
            &self.token,
            payload,
        );
        if let Err((error, payload)) = outcome {
            retire(payload);
            return Err(error);
        }
        check(cancellation)?;
        self.published = true;
        Ok(self.token.clone())
    }
}
impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if !self.published {
            let removed = self
                .state
                .reviews
                .lock()
                .ok()
                .and_then(|mut store| store.discard(&self.context, self.purpose, &self.token).ok())
                .flatten();
            if let Some(value) = removed {
                retire(value);
            }
        }
    }
}
impl Session {
    fn live(&self) -> Result<(), AppError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(refused("That tool session was retired."));
        }
        Ok(())
    }
    fn snapshot(&self, value: &mut SessionValue) -> FileToolSessionSnapshot {
        let (process, error) = match value.child.as_mut().map(core::FileToolProcess::poll) {
            Some(Ok(state)) => (Some(state), value.error.clone()),
            Some(Err(error)) => (None, Some(error)),
            None => (None, value.error.clone()),
        };
        FileToolSessionSnapshot {
            requested_at_millis: self.requested_at_millis.clone(),
            id: self.id.clone(),
            revision: value.revision.clone(),
            repo_id: self.repo_id.clone(),
            review: value.tool.review().clone(),
            phase: value.phase,
            process,
            error,
            can_review_staging: value.saved.is_some()
                && matches!(value.phase, FileToolSessionPhase::Launched),
        }
    }
}
async fn job<T: Send + 'static>(
    app: AppHandle,
    operation_id: String,
    action: impl FnOnce(&AppHandle, &core::CancellationToken) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    let (token, operation) = register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        action(&app, &token)
    })
    .await
    .map_err(background_task_error)?
}
fn repository<T>(
    app: &AppHandle,
    id: &str,
    action: impl FnOnce(&std::path::Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let session = repository_session(id, &app.state::<AppState>())?;
    let _guard = session.operation.lock().map_err(state_error)?;
    session.with_read_policy(|| action(&session.path))
}
fn tool_repository<T>(
    app: &AppHandle,
    id: &str,
    tool: &mut core::PreparedFileTool,
    action: impl FnOnce(&mut core::PreparedFileTool) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let expected = tool.review().repository_path.clone();
    repository(app, id, |root| {
        if root
            .canonicalize()
            .map_err(|_| refused("The registered repository is unavailable."))?
            != std::path::Path::new(&expected)
        {
            return Err(refused(
                "The registered repository no longer matches this tool session.",
            ));
        }
        action(tool)
    })
}
fn storage(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|_| refused("The application tool storage is unavailable."))?;
    std::fs::create_dir_all(&data)
        .map_err(|_| refused("The application tool storage could not be prepared."))?;
    Ok(data.join("file-tools"))
}
fn output_summary(
    tool: &core::PreparedFileTool,
    result: &core::FileToolResult,
) -> Result<FileToolOutputSummary, AppError> {
    let path = tool
        .review()
        .sides
        .iter()
        .find(|side| side.role == "merged")
        .ok_or_else(|| refused("That session has no merge target."))?
        .path
        .clone();
    let bytes = result.bytes();
    let text = std::str::from_utf8(bytes)
        .ok()
        .filter(|text| !text.contains('\0'));
    let preview = text.map(|text| text.chars().take(16384).collect::<String>());
    let truncated = preview
        .as_ref()
        .is_some_and(|preview| preview.len() < bytes.len());
    Ok(FileToolOutputSummary {
        path,
        bytes: bytes.len().to_string(),
        sha256: result.sha256()?,
        text_preview: preview,
        truncated,
        binary: text.is_none(),
    })
}
pub(super) async fn prepare_launch(
    request: PrepareFileToolLaunchRequest,
    app: AppHandle,
) -> Result<PreparedFileToolLaunch, AppError> {
    job(app, request.operation_id, move |app, token| {
        let state = app.state::<FileToolState>();
        let reservation = Reservation::new(&state, &request.context_id, Purpose::Launch)?;
        let parent = storage(app)?;
        // SAFETY: geteuid takes no arguments and has no pointer or memory effects.
        let uid = unsafe { libc::geteuid() };
        let mut tool = repository(app, &request.repo_id, |root| {
            core::prepare_file_tool(root, request.request, request.profile, &parent, uid, token)
        })?;
        if let Err(error) = check(token) {
            let _ = tool.discard();
            return Err(error);
        }
        let review = tool.review().clone();
        let token = reservation.publish(
            Payload::Launch {
                repo_id: request.repo_id,
                tool: Box::new(tool),
            },
            token,
        )?;
        Ok(PreparedFileToolLaunch { token, review })
    })
    .await
}
pub(super) async fn launch(
    request: ExecuteFileToolReviewRequest,
    app: AppHandle,
) -> Result<FileToolSessionSnapshot, AppError> {
    job(app, request.operation_id, move |app, token| {
        let state = app.state::<FileToolState>();
        let id = identifier()?;
        let revision = identifier()?;
        let requested_at_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| refused("The command request time could not be recorded."))?
            .as_millis()
            .to_string();
        let Payload::Launch { repo_id, tool } =
            state.take(&request.context_id, Purpose::Launch, &request.token)?
        else {
            return Err(refused("That review is not a launch."));
        };
        let session = Arc::new(Session {
            requested_at_millis,
            id,
            repo_id,
            closed: AtomicBool::new(false),
            value: Mutex::new(SessionValue {
                revision,
                tool: *tool,
                child: None,
                phase: FileToolSessionPhase::Launching,
                error: None,
                saved: None,
            }),
        });
        if let Err(error) = state.insert(session.clone()) {
            let _ = session.value.lock().map_err(state_error)?.tool.discard();
            return Err(error);
        }
        let mut value = session.value.lock().map_err(state_error)?;
        match tool_repository(app, &session.repo_id, &mut value.tool, |tool| {
            tool.launch(token)
        }) {
            Ok(child) => {
                value.child = Some(child);
                value.phase = FileToolSessionPhase::Launched;
            }
            Err(error) => {
                value.error = Some(error);
                value.phase = FileToolSessionPhase::Failed;
            }
        }
        Ok(session.snapshot(&mut value))
    })
    .await
}
pub(super) async fn sessions(app: AppHandle) -> Result<Vec<FileToolSessionSnapshot>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FileToolState>();
        state.prune()?;
        let sessions: Vec<_> = state
            .sessions
            .lock()
            .map_err(state_error)?
            .values()
            .filter(|session| !session.closed.load(Ordering::Acquire))
            .cloned()
            .collect();
        let mut result = Vec::new();
        for session in sessions {
            let mut value = session.value.lock().map_err(state_error)?;
            result.push(session.snapshot(&mut value));
        }
        result.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(result)
    })
    .await
    .map_err(background_task_error)?
}
pub(super) async fn stop(id: String, app: AppHandle) -> Result<FileToolSessionSnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = app.state::<FileToolState>().get(&id)?;
        let mut value = session.value.lock().map_err(state_error)?;
        session.live()?;
        let child = value
            .child
            .as_mut()
            .ok_or_else(|| refused("No owned command is available to stop."))?;
        if let Err(error) = child.cancel() {
            value.error = Some(error.clone());
            return Err(error);
        }
        Ok(session.snapshot(&mut value))
    })
    .await
    .map_err(background_task_error)?
}
pub(super) async fn prepare_result(
    request: FileToolReviewRequest,
    app: AppHandle,
) -> Result<PreparedFileToolResult, AppError> {
    job(app, request.operation_id, move |app, token| {
        let state = app.state::<FileToolState>();
        let reservation = Reservation::new(&state, &request.context_id, Purpose::Merge)?;
        let session = state.get(&request.session_id)?;
        let mut value = session.value.lock().map_err(state_error)?;
        session.live()?;
        let result = tool_repository(app, &session.repo_id, &mut value.tool, |tool| {
            tool.read_merge_result(token)
        })?;
        let output = output_summary(&value.tool, &result)?;
        let revision = value.revision.clone();
        drop(value);
        let token = reservation.publish(
            Payload::Result {
                session: session.clone(),
                revision,
                result,
                summary: output.clone(),
            },
            token,
        )?;
        Ok(PreparedFileToolResult {
            token,
            session_id: session.id.clone(),
            output,
        })
    })
    .await
}
pub(super) async fn apply_result(
    request: SaveFileToolResultRequest,
    app: AppHandle,
) -> Result<FileToolSaveOutcome, AppError> {
    job(app, request.operation_id, move |app, token| {
        if !request.finished_editing {
            return Err(refused(
                "Confirm that editing the tool output is finished before saving.",
            ));
        }
        let state = app.state::<FileToolState>();
        let Payload::Result {
            session,
            revision,
            result,
            summary,
        } = state.take(&request.context_id, Purpose::Merge, &request.token)?
        else {
            return Err(refused("That review is not a merge output."));
        };
        session.live()?;
        let mut value = session.value.lock().map_err(state_error)?;
        session.live()?;
        if value.revision != revision {
            return Err(refused("That session changed after result review."));
        }
        value.revision = identifier()?;
        let write = match tool_repository(app, &session.repo_id, &mut value.tool, |tool| {
            tool.apply_merge_result(&result, token)
        }) {
            Ok(write) => write,
            Err(error) => {
                value.error = Some(error.clone());
                return Err(error);
            }
        };
        value.error = write.warning.as_ref().map(|warning| refused(warning));
        value.saved = write.can_review_staging.then_some(summary);
        Ok(FileToolSaveOutcome {
            session: session.snapshot(&mut value),
            write,
        })
    })
    .await
}
pub(super) async fn prepare_stage(
    request: FileToolReviewRequest,
    app: AppHandle,
) -> Result<PreparedFileToolStage, AppError> {
    job(app, request.operation_id, move |app, token| {
        let state = app.state::<FileToolState>();
        let reservation = Reservation::new(&state, &request.context_id, Purpose::Stage)?;
        let session = state.get(&request.session_id)?;
        let mut value = session.value.lock().map_err(state_error)?;
        session.live()?;
        tool_repository(app, &session.repo_id, &mut value.tool, |tool| {
            tool.verify_saved_merge(token)
        })?;
        let summary = value
            .saved
            .clone()
            .ok_or_else(|| refused("No saved tool result is available for staging."))?;
        let revision = value.revision.clone();
        drop(value);
        let token = reservation.publish(
            Payload::Stage {
                session: session.clone(),
                revision,
            },
            token,
        )?;
        Ok(PreparedFileToolStage {
            token,
            session_id: session.id.clone(),
            path: summary.path,
            bytes: summary.bytes,
            sha256: summary.sha256,
        })
    })
    .await
}
pub(super) async fn stage(
    request: ExecuteFileToolReviewRequest,
    app: AppHandle,
) -> Result<FileToolStageOutcome, AppError> {
    let operation_id = request.operation_id.clone();
    job(app, request.operation_id, move |app, token| {
        let state = app.state::<FileToolState>();
        let Payload::Stage { session, revision } =
            state.take(&request.context_id, Purpose::Stage, &request.token)?
        else {
            return Err(refused("That review is not a staging action."));
        };
        session.live()?;
        let mut value = session.value.lock().map_err(state_error)?;
        session.live()?;
        if value.revision != revision {
            return Err(refused("That session changed after staging review."));
        }
        value.revision = identifier()?;
        let stage = match tool_repository(app, &session.repo_id, &mut value.tool, |tool| {
            authentication::run(
                app,
                &operation_id,
                Some(&session.repo_id),
                token,
                true,
                || tool.stage_saved_merge(token),
            )
        }) {
            Ok(stage) => stage,
            Err(error) => {
                value.error = Some(error.clone());
                return Err(error);
            }
        };
        value.error = stage
            .error
            .clone()
            .or_else(|| stage.warning.as_ref().map(|warning| refused(warning)));
        value.saved = None;
        Ok(FileToolStageOutcome {
            session: session.snapshot(&mut value),
            stage,
        })
    })
    .await
}
fn finished(value: &mut SessionValue) -> Result<(), AppError> {
    if matches!(value.phase, FileToolSessionPhase::Launching) {
        return Err(refused(
            "The command launch has not been confirmed. Inspect its outcome before cleanup.",
        ));
    }
    if let Some(child) = &mut value.child
        && child.poll()?.state != core::FileToolProcessState::Exited
    {
        return Err(refused(
            "The owned command is still running. Finish it before removing private copies.",
        ));
    }
    Ok(())
}
pub(super) async fn prepare_cleanup(
    request: FileToolReviewRequest,
    app: AppHandle,
) -> Result<PreparedFileToolCleanup, AppError> {
    job(app, request.operation_id, move |app, token| {
        let state = app.state::<FileToolState>();
        let reservation = Reservation::new(&state, &request.context_id, Purpose::Cleanup)?;
        let session = state.get(&request.session_id)?;
        let mut value = session.value.lock().map_err(state_error)?;
        session.live()?;
        finished(&mut value)?;
        let cleanup = value.tool.prepare_cleanup()?;
        let review = cleanup.review().clone();
        let revision = value.revision.clone();
        drop(value);
        let token = reservation.publish(
            Payload::Cleanup {
                session: session.clone(),
                revision,
                cleanup,
            },
            token,
        )?;
        Ok(PreparedFileToolCleanup {
            token,
            session_id: session.id.clone(),
            review,
        })
    })
    .await
}
pub(super) async fn discard_session(
    request: DiscardFileToolSessionRequest,
    app: AppHandle,
) -> Result<bool, AppError> {
    job(app, request.operation_id, move |app, token| {
        if !request.finished_using_files {
            return Err(refused(
                "Confirm that the GUI handoff has finished using these private files.",
            ));
        }
        let state = app.state::<FileToolState>();
        let Payload::Cleanup {
            session,
            revision,
            cleanup,
        } = state.take(&request.context_id, Purpose::Cleanup, &request.token)?
        else {
            return Err(refused("That review is not a cleanup action."));
        };
        session.live()?;
        let mut value = session.value.lock().map_err(state_error)?;
        session.live()?;
        if value.revision != revision {
            return Err(refused("That session changed after cleanup review."));
        }
        check(token)?;
        finished(&mut value)?;
        value.revision = identifier()?;
        if let Err(error) = value.tool.discard_reviewed(cleanup) {
            value.phase = FileToolSessionPhase::CleanupFailed;
            value.error = Some(error.clone());
            return Err(error);
        }
        session.closed.store(true, Ordering::Release);
        drop(value);
        state
            .sessions
            .lock()
            .map_err(state_error)?
            .remove(&session.id);
        Ok(true)
    })
    .await
}
pub(super) async fn discard_review(
    request: DiscardFileToolReviewRequest,
    app: AppHandle,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let purpose = match request.purpose {
            FileToolReviewPurpose::Launch => Purpose::Launch,
            FileToolReviewPurpose::Result => Purpose::Merge,
            FileToolReviewPurpose::Stage => Purpose::Stage,
            FileToolReviewPurpose::Cleanup => Purpose::Cleanup,
        };
        let state = app.state::<FileToolState>();
        let value = state.reviews.lock().map_err(state_error)?.discard(
            &request.context_id,
            purpose,
            &request.token,
        )?;
        if let Some(value) = value {
            retire(value);
        }
        Ok(())
    })
    .await
    .map_err(background_task_error)?
}

#[cfg(test)]
#[path = "file_tool_runtime_tests.rs"]
mod tests;
