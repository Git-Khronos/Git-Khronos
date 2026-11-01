//! Single-use native GitLab clone reviews, with separate API and Git lifecycles.
use super::gitlab_commands::{GitLabAccounts, identifier, main_label};
use super::{
    AppError, AppHandle, Manager, RepositorySnapshot, authentication, background_task_error,
    register_active_operation, register_repository, state_error,
};
use git_khronos_git_core as core;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

const LIFETIME: Duration = Duration::from_secs(5 * 60);
const CAPACITY: usize = 8;

#[derive(Default)]
pub struct GitLabClonePlans(Mutex<HashMap<String, Slot>>);
struct Slot {
    token: String,
    created: Instant,
    ready: Option<CachedPlan>,
}
struct CachedPlan {
    connection_id: String,
    plan: core::GitLabClonePlan,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabInspectRequest {
    pub connection_id: String,
    pub project_id: String,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabPrepareCloneRequest {
    pub connection_id: String,
    pub context_id: String,
    pub request: core::GitLabCloneRequest,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabExecuteCloneRequest {
    pub context_id: String,
    pub token: String,
    pub operation_id: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedGitLabClone {
    pub token: String,
    pub plan: core::GitLabClonePlan,
}

fn error(message: &str) -> AppError {
    AppError {
        kind: "gitlabClonePreview".into(),
        message: message.into(),
        hint: Some("Review a fresh GitLab clone preview.".into()),
    }
}
fn context(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(error("The GitLab clone review context is invalid."));
    }
    Ok(())
}
fn check(cancellation: &core::CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(AppError {
            kind: "operationCancelled".into(),
            message:
                "The GitLab clone operation was cancelled. Inspect its destination before retrying."
                    .into(),
            hint: None,
        });
    }
    Ok(())
}

struct Reservation<'a> {
    state: &'a GitLabClonePlans,
    context: String,
    token: String,
    published: bool,
}
impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if !self.published {
            let _ = self.state.discard(&self.context, &self.token);
        }
    }
}
impl Reservation<'_> {
    fn finish(
        mut self,
        cached: CachedPlan,
        cancellation: &core::CancellationToken,
    ) -> Result<PreparedGitLabClone, AppError> {
        check(cancellation)?;
        let response = PreparedGitLabClone {
            token: self.token.clone(),
            plan: cached.plan.clone(),
        };
        {
            let mut plans = self.state.0.lock().map_err(state_error)?;
            let slot = plans
                .get_mut(&self.context)
                .filter(|slot| {
                    slot.token == self.token
                        && slot.created.elapsed() < LIFETIME
                        && slot.ready.is_none()
                })
                .ok_or_else(|| error("That GitLab clone review expired or was cancelled."))?;
            check(cancellation)?;
            slot.ready = Some(cached);
        }
        // Dropping an unpublished reservation also cleans cancellation just
        // after publication. A lost successful reply remains bounded by expiry.
        check(cancellation)?;
        self.published = true;
        Ok(response)
    }
}
impl GitLabClonePlans {
    fn reserve(&self, context_id: &str) -> Result<Reservation<'_>, AppError> {
        context(context_id)?;
        let token = identifier()?;
        let mut plans = self.0.lock().map_err(state_error)?;
        plans.retain(|_, slot| slot.created.elapsed() < LIFETIME);
        if plans
            .get(context_id)
            .is_some_and(|slot| slot.ready.is_none())
        {
            return Err(error(
                "A clone preview is already being prepared in this context.",
            ));
        }
        if !plans.contains_key(context_id) && plans.len() >= CAPACITY {
            return Err(error(
                "Close an unused GitLab clone review before opening another.",
            ));
        }
        if plans.values().any(|slot| slot.token == token) {
            return Err(error("A unique GitLab clone review could not be created."));
        }
        plans.insert(
            context_id.into(),
            Slot {
                token: token.clone(),
                created: Instant::now(),
                ready: None,
            },
        );
        Ok(Reservation {
            state: self,
            context: context_id.into(),
            token,
            published: false,
        })
    }
    fn discard(&self, context_id: &str, token: &str) -> Result<bool, AppError> {
        context(context_id)?;
        let mut plans = self.0.lock().map_err(state_error)?;
        if plans
            .get(context_id)
            .is_some_and(|slot| slot.token == token)
        {
            plans.remove(context_id);
            return Ok(true);
        }
        Ok(false)
    }
    fn take(&self, context_id: &str, token: &str) -> Result<CachedPlan, AppError> {
        context(context_id)?;
        let mut plans = self.0.lock().map_err(state_error)?;
        plans.retain(|_, slot| slot.created.elapsed() < LIFETIME);
        if !plans
            .get(context_id)
            .is_some_and(|slot| slot.token == token && slot.ready.is_some())
        {
            return Err(error(
                "That GitLab clone preview expired or was already used.",
            ));
        }
        plans
            .remove(context_id)
            .and_then(|slot| slot.ready)
            .ok_or_else(|| error("That GitLab clone preview is unavailable."))
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_gitlab_project(
    request: GitLabInspectRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<core::GitLabProjectInspection, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        app.state::<GitLabAccounts>().read(
            &request.connection_id,
            &request.operation_id,
            &cancellation,
            |transport, instance, account| {
                core::inspect_gitlab_project_with(
                    transport,
                    instance,
                    account,
                    &request.project_id,
                    &cancellation,
                )
            },
        )
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_gitlab_clone(
    request: GitLabPrepareCloneRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<PreparedGitLabClone, AppError> {
    main_label(window.label())?;
    context(&request.context_id)?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let plans = app.state::<GitLabClonePlans>();
        let reservation = plans.reserve(&request.context_id)?;
        let plan = app.state::<GitLabAccounts>().read(
            &request.connection_id,
            &request.operation_id,
            &cancellation,
            |transport, instance, account| {
                core::prepare_gitlab_clone_with(
                    transport,
                    instance,
                    account,
                    request.request,
                    &cancellation,
                )
            },
        )?;
        reservation.finish(
            CachedPlan {
                connection_id: request.connection_id,
                plan,
            },
            &cancellation,
        )
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn execute_gitlab_clone(
    request: GitLabExecuteCloneRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id.clone())?;
    // Consume on the request boundary before provider I/O or Git authentication.
    let cached = app
        .state::<GitLabClonePlans>()
        .take(&request.context_id, &request.token)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        app.state::<GitLabAccounts>().read(
            &cached.connection_id,
            &request.operation_id,
            &cancellation,
            |transport, _, _| {
                core::revalidate_gitlab_clone_with(transport, &cached.plan, &cancellation)
            },
        )?;
        // No API session/lease is held during this separate Git operation.
        check(&cancellation)?;
        let root = authentication::run(
            &app,
            &request.operation_id,
            None,
            &cancellation,
            true,
            || core::clone_gitlab_plan(&cached.plan, &cancellation),
        )?;
        register_repository(root, &app.state::<super::AppState>(), &app)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn discard_gitlab_clone_plan(
    context_id: String,
    token: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, GitLabClonePlans>,
) -> Result<bool, AppError> {
    main_label(window.label())?;
    state.discard(&context_id, &token)
}

#[cfg(test)]
#[path = "gitlab_clone_commands_tests.rs"]
mod tests;
