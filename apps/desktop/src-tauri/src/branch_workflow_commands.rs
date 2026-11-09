use super::*;
use git_khronos_git_core as core;
use serde::Deserialize;
use std::time::{Duration, Instant};

const LIFETIME: Duration = Duration::from_secs(15 * 60);
const MAX_PLANS: usize = 64;

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum BranchWorkflowRequest {
    Setup {
        settings: core::BranchWorkflowSettings,
        #[serde(rename = "initialOid")]
        initial_oid: String,
    },
    Start {
        kind: core::BranchWorkflowKind,
        suffix: String,
    },
    Finish {
        branch: String,
        options: core::BranchWorkflowFinishOptions,
    },
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum BranchWorkflowPlan {
    Setup {
        plan: core::BranchWorkflowSetup,
    },
    Start {
        plan: core::BranchWorkflowStart,
    },
    Finish {
        plan: core::BranchWorkflowFinishPlan,
    },
}

pub(super) struct CachedPlan {
    repo_id: String,
    plan: BranchWorkflowPlan,
    created: Instant,
}

#[derive(Serialize, specta::Type)]
pub struct PreparedBranchWorkflow {
    token: String,
    plan: BranchWorkflowPlan,
}

#[derive(Serialize, specta::Type)]
pub struct BranchWorkflowView {
    state: core::BranchWorkflowState,
    finish: Option<core::BranchWorkflowFinishStatus>,
}

#[derive(Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum BranchWorkflowControl {
    Continue { retry: bool },
    Abort {},
    Acknowledge {},
}

fn expired() -> AppError {
    AppError {
        kind: "staleBranchWorkflowPlan".into(),
        message: "This branch workflow preview expired or was already used.".into(),
        hint: Some("Review a fresh preview before applying another workflow action.".into()),
    }
}
fn take_plan(
    plans: &mut HashMap<String, CachedPlan>,
    repo_id: &str,
    token: &str,
) -> Result<BranchWorkflowPlan, AppError> {
    if !plans
        .get(token)
        .is_some_and(|cached| cached.repo_id == repo_id && cached.created.elapsed() < LIFETIME)
    {
        return Err(expired());
    }
    Ok(plans
        .remove(token)
        .expect("validated workflow preview")
        .plan)
}

fn workflow_lock<'a>(
    operation: &'a Mutex<()>,
    cancellation: &CancellationToken,
    timeout: Duration,
) -> Result<std::sync::MutexGuard<'a, ()>, AppError> {
    let started = Instant::now();
    loop {
        if cancellation.is_cancelled() {
            return Err(AppError {
                kind: "operationCancelled".into(),
                message: "The branch workflow request was canceled.".into(),
                hint: None,
            });
        }
        match operation.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(std::sync::TryLockError::Poisoned(error)) => return Err(state_error(error)),
            Err(std::sync::TryLockError::WouldBlock) if started.elapsed() >= timeout => {
                return Err(AppError {
                    kind: "repositoryBusy".into(),
                    message: "Another Git operation is still using this repository.".into(),
                    hint: Some("Wait for it to finish, then review the workflow again.".into()),
                });
            }
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(Duration::from_millis(10))
            }
        }
    }
}

async fn workflow_task<T, F>(
    repo_id: String,
    app: AppHandle,
    cancellation: CancellationToken,
    action: F,
) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&Path, &CancellationToken) -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        // Cooperate with short snapshot refreshes without an uninterruptible
        // mutex wait. The reviewed core plan is revalidated after acquisition.
        let _guard = workflow_lock(&session.operation, &cancellation, Duration::from_secs(10))?;
        if cancellation.is_cancelled() {
            return Err(AppError {
                kind: "operationCancelled".into(),
                message: "The branch workflow request was canceled.".into(),
                hint: None,
            });
        }
        action(&session.path, &cancellation)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn load_branch_workflow(
    repo_id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<BranchWorkflowView, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    workflow_task(repo_id, app, cancellation, |path, token| {
        Ok(BranchWorkflowView {
            state: core::branch_workflow_state_cancellable(path, token)?,
            finish: core::load_branch_workflow_finish_cancellable(path, token)?,
        })
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_branch_workflow(
    repo_id: String,
    request: BranchWorkflowRequest,
    operation_id: String,
    app: AppHandle,
) -> Result<PreparedBranchWorkflow, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    let completed_token = cancellation.clone();
    let plan = workflow_task(
        repo_id.clone(),
        app.clone(),
        cancellation,
        move |path, token| {
            Ok(match request {
                BranchWorkflowRequest::Setup {
                    settings,
                    initial_oid,
                } => BranchWorkflowPlan::Setup {
                    plan: core::prepare_branch_workflow_setup_cancellable(
                        path,
                        settings,
                        &initial_oid,
                        token,
                    )?,
                },
                BranchWorkflowRequest::Start { kind, suffix } => BranchWorkflowPlan::Start {
                    plan: core::prepare_branch_workflow_start_cancellable(
                        path, kind, &suffix, token,
                    )?,
                },
                BranchWorkflowRequest::Finish { branch, options } => BranchWorkflowPlan::Finish {
                    plan: core::prepare_branch_workflow_finish_cancellable(
                        path, &branch, options, token,
                    )?,
                },
            })
        },
    )
    .await?;
    if completed_token.is_cancelled() {
        return Err(AppError {
            kind: "operationCancelled".into(),
            message: "Workflow preparation was canceled.".into(),
            hint: None,
        });
    }
    let state = app.state::<AppState>();
    let token = format!("workflow-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
    let mut plans = state.branch_workflow_plans.lock().map_err(state_error)?;
    plans.retain(|_, cached| cached.repo_id != repo_id && cached.created.elapsed() < LIFETIME);
    if plans.len() >= MAX_PLANS {
        return Err(AppError {
            kind: "workflowPreviewCapacity".into(),
            message: "Too many repositories have active workflow previews.".into(),
            hint: Some("Close an unused preview and try again.".into()),
        });
    }
    plans.insert(
        token.clone(),
        CachedPlan {
            repo_id,
            plan: plan.clone(),
            created: Instant::now(),
        },
    );
    Ok(PreparedBranchWorkflow { token, plan })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn execute_branch_workflow(
    repo_id: String,
    token: String,
    operation_id: String,
    app: AppHandle,
) -> Result<Option<core::BranchWorkflowFinishStatus>, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    // The client cannot replace a reviewed plan. Consume it before dispatch,
    // including busy-session refusal, cancellation and uncertain Git outcomes.
    let plan = {
        let state = app.state::<AppState>();
        let mut plans = state.branch_workflow_plans.lock().map_err(state_error)?;
        take_plan(&mut plans, &repo_id, &token)?
    };
    workflow_task(repo_id, app, cancellation, move |path, token| match plan {
        BranchWorkflowPlan::Setup { plan } => {
            core::apply_branch_workflow_setup_cancellable(path, &plan, token).map(|_| None)
        }
        BranchWorkflowPlan::Start { plan } => {
            core::start_branch_workflow(path, &plan, token).map(|_| None)
        }
        BranchWorkflowPlan::Finish { plan } => {
            core::finish_branch_workflow(path, &plan, token).map(Some)
        }
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn discard_branch_workflow_plan(
    repo_id: String,
    token: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, AppError> {
    let mut plans = state.branch_workflow_plans.lock().map_err(state_error)?;
    if plans
        .get(&token)
        .is_some_and(|cached| cached.repo_id == repo_id)
    {
        plans.remove(&token);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn control_branch_workflow_finish(
    repo_id: String,
    id: String,
    revision: u32,
    control: BranchWorkflowControl,
    operation_id: String,
    app: AppHandle,
) -> Result<Option<core::BranchWorkflowFinishStatus>, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    workflow_task(
        repo_id,
        app,
        cancellation,
        move |path, token| match control {
            BranchWorkflowControl::Continue { retry } => {
                core::resume_branch_workflow_finish(path, &id, revision, retry, token).map(Some)
            }
            BranchWorkflowControl::Abort {} => {
                core::abort_branch_workflow_finish(path, &id, revision, token).map(Some)
            }
            BranchWorkflowControl::Acknowledge {} => {
                core::acknowledge_branch_workflow_finish(path, &id, revision).map(|_| None)
            }
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cached() -> CachedPlan {
        CachedPlan {
            repo_id: "owned-repo".into(),
            created: Instant::now(),
            plan: BranchWorkflowPlan::Setup {
                plan: core::BranchWorkflowSetup {
                    previous: None,
                    settings: Default::default(),
                    initial_oid: "a".repeat(40),
                    branches: vec![],
                },
            },
        }
    }
    #[test]
    fn plans_are_repository_bound_immutable_and_consumed_once() {
        let mut plans = HashMap::from([("owned-token".into(), cached())]);
        assert!(take_plan(&mut plans, "other-repo", "owned-token").is_err());
        assert_eq!(plans.len(), 1);
        match take_plan(&mut plans, "owned-repo", "owned-token").unwrap() {
            BranchWorkflowPlan::Setup { plan } => assert_eq!(plan.initial_oid, "a".repeat(40)),
            _ => panic!("unexpected workflow preview"),
        }
        assert!(take_plan(&mut plans, "owned-repo", "owned-token").is_err());
    }
    #[test]
    fn expired_and_unknown_previews_cannot_dispatch_git() {
        let mut entry = cached();
        entry.created = Instant::now() - LIFETIME;
        let mut plans = HashMap::from([("expired".into(), entry)]);
        assert!(take_plan(&mut plans, "owned-repo", "expired").is_err());
        assert!(take_plan(&mut plans, "owned-repo", "unknown").is_err());
    }
    #[test]
    fn native_requests_reject_extra_or_ambiguous_fields() {
        assert!(
            serde_json::from_value::<BranchWorkflowRequest>(serde_json::json!({
                "action": "start", "kind": "feature", "suffix": "owned", "plan": {}
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<BranchWorkflowControl>(serde_json::json!({
                "action": "abort", "retry": true
            }))
            .is_err()
        );
        let request = serde_json::from_value::<BranchWorkflowRequest>(serde_json::json!({
            "action": "setup", "settings": core::BranchWorkflowSettings::default(), "initialOid": "a".repeat(40)
        })).unwrap();
        assert!(
            matches!(request, BranchWorkflowRequest::Setup { initial_oid, .. } if initial_oid == "a".repeat(40))
        );
    }
    #[test]
    fn a_short_repository_refresh_can_finish_before_the_workflow_acquires_its_lock() {
        let operation = Arc::new(Mutex::new(()));
        let held = operation.lock().unwrap();
        let worker_operation = operation.clone();
        let (started_sender, started_receiver) = std::sync::mpsc::channel();
        let (finished_sender, finished_receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            started_sender.send(()).unwrap();
            let guard = workflow_lock(
                &worker_operation,
                &CancellationToken::default(),
                Duration::from_secs(5),
            );
            finished_sender.send(guard.is_ok()).unwrap();
        });
        started_receiver
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        assert!(finished_receiver.try_recv().is_err());
        drop(held);
        assert!(
            finished_receiver
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
        );
        worker.join().unwrap();
    }

    #[test]
    fn queued_workflow_lock_waits_are_cancellable_and_bounded() {
        let operation = Arc::new(Mutex::new(()));
        let _held = operation.lock().unwrap();
        assert_eq!(
            workflow_lock(&operation, &CancellationToken::default(), Duration::ZERO)
                .unwrap_err()
                .kind,
            "repositoryBusy"
        );
        let cancellation = CancellationToken::default();
        let worker_token = cancellation.clone();
        let worker_operation = operation.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let error = workflow_lock(&worker_operation, &worker_token, Duration::from_secs(30))
                .unwrap_err();
            sender.send(error.kind).unwrap();
        });
        cancellation.cancel();
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(5)).unwrap(),
            "operationCancelled"
        );
        worker.join().unwrap();
    }
}
