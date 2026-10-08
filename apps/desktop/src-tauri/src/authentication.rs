use git_chronos_git_core::authentication::{PromptKind, with_authentication};
use git_chronos_git_core::{AppError, CancellationToken};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticationPrompt {
    request_id: String,
    operation_id: String,
    repository_id: Option<String>,
    secret: bool,
}

struct Pending {
    prompt: AuthenticationPrompt,
    sender: mpsc::SyncSender<Option<String>>,
}

#[derive(Default)]
pub struct AuthenticationState {
    pending: Mutex<HashMap<String, Pending>>,
    next_id: AtomicU64,
}

fn auth_error() -> AppError {
    AppError {
        kind: "authenticationUnavailable".into(),
        message: "This authentication request is no longer available.".into(),
        hint: Some("Retry the Git operation.".into()),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn answer_authentication(
    request_id: String,
    answer: Option<String>,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AuthenticationState>,
) -> Result<(), AppError> {
    if window.label() != "main"
        || answer
            .as_ref()
            .is_some_and(|value| value.len() > 16 * 1024 || value.contains(['\0', '\n', '\r']))
    {
        return Err(auth_error());
    }
    let mut pending = state.pending.lock().map_err(|_| auth_error())?;
    let request = pending.remove(&request_id).ok_or_else(auth_error)?;
    request.sender.try_send(answer).map_err(|_| auth_error())
}

#[tauri::command]
pub fn pending_authentication(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AuthenticationState>,
) -> Result<Vec<AuthenticationPrompt>, AppError> {
    if window.label() != "main" {
        return Err(auth_error());
    }
    Ok(state
        .pending
        .lock()
        .map_err(|_| auth_error())?
        .values()
        .map(|pending| pending.prompt.clone())
        .collect())
}

pub fn run<T>(
    app: &AppHandle,
    operation_id: &str,
    repository_id: Option<&str>,
    cancellation: &CancellationToken,
    interactive: bool,
    action: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let executable = std::env::current_exe().map_err(|_| auth_error())?;
    let handle = app.clone();
    let operation_id = operation_id.to_owned();
    let repository_id = repository_id.map(str::to_owned);
    let token = cancellation.clone();
    let handler = interactive.then(|| {
        Arc::new(move |kind: PromptKind| {
            let state = handle.state::<AuthenticationState>();
            let request_id = format!("auth-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
            let prompt = AuthenticationPrompt {
                request_id: request_id.clone(),
                operation_id: operation_id.clone(),
                repository_id: repository_id.clone(),
                secret: kind == PromptKind::Secret,
            };
            let (sender, receiver) = mpsc::sync_channel(1);
            state.pending.lock().ok()?.insert(
                request_id.clone(),
                Pending {
                    prompt: prompt.clone(),
                    sender,
                },
            );
            let emitted = handle
                .emit_to("main", "git-authentication-prompt", &prompt)
                .is_ok();
            let started = Instant::now();
            let answer = loop {
                if !emitted || token.is_cancelled() || started.elapsed() >= Duration::from_secs(110)
                {
                    break None;
                }
                match receiver.recv_timeout(Duration::from_millis(50)) {
                    Ok(answer) => break answer,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break None,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
            };
            if let Ok(mut pending) = state.pending.lock() {
                pending.remove(&request_id);
            }
            let _ = handle.emit_to("main", "git-authentication-dismissed", &request_id);
            if answer.is_none() {
                token.cancel();
            }
            answer
        }) as Arc<dyn Fn(PromptKind) -> Option<String> + Send + Sync>
    });
    with_authentication(&executable, cancellation, handler, action)
}
