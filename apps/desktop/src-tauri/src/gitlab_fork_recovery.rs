//! Private fork records and read-only reconciliation. No write port, restored
//! review, provider deletion, clone, remote mutation or implicit retry.
use crate::gitlab_commands::main_label;
use crate::{AppError, AppHandle, background_task_error, register_active_operation};
#[cfg(target_os = "linux")]
use crate::{CancellationToken, Manager, gitlab_commands::GitLabAccounts};
use git_khronos_git_core as core;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkRecordListRequest {
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReconcileForkRequest {
    pub connection_id: String,
    pub record_id: String,
    pub expected_revision: String,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetireForkRequest {
    pub record_id: String,
    pub expected_revision: String,
    pub acknowledge_unconfirmed: bool,
    pub operation_id: String,
}
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForkRecordView {
    pub id: String,
    pub revision: String,
    pub created_at_millis: String,
    pub updated_at_millis: String,
    pub origin: String,
    pub account_id: String,
    pub account_login: String,
    pub source_id: String,
    pub source_full_path: String,
    pub source_empty: Option<bool>,
    pub namespace_id: String,
    pub namespace_full_path: String,
    pub namespace_kind: core::GitLabNamespaceKind,
    pub project_path: String,
    pub project_name: Option<String>,
    pub target_full_path: String,
    pub phase: core::GitLabForkPhase,
    pub project_id: Option<String>,
    pub project_empty: Option<bool>,
    pub http_status: Option<u16>,
    pub import_state: core::GitLabForkImportState,
    pub last_failure: Option<core::GitLabForkFailure>,
}
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForkRecordEntry {
    pub id: String,
    pub record: Option<ForkRecordView>,
    pub pending: bool,
    pub retired: bool,
    pub operation_active: bool,
}
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ForkStorageIssueKind {
    UnknownEntry,
    InvalidRecord,
    PendingWrite,
    Capacity,
}
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForkStorageIssue {
    pub id: Option<String>,
    pub kind: ForkStorageIssueKind,
}
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForkRecordList {
    pub entries: Vec<ForkRecordEntry>,
    pub issues: Vec<ForkStorageIssue>,
}
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForkRecordRefresh {
    pub observation: ForkRecordView,
    /// False means the new observation could not be saved. Reload the actual
    /// stored revision before another local action; this never authorizes POST.
    pub persisted: bool,
}
#[cfg(target_os = "linux")]
fn check(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(AppError {
            kind: "operationCancelled".into(),
            message: "Fork outcome inspection was cancelled.".into(),
            hint: None,
        });
    }
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn unsupported() -> AppError {
    AppError {
        kind: "gitlabForkPlatform".into(),
        message: "Private fork records are not supported on this platform yet.".into(),
        hint: None,
    }
}
#[cfg(target_os = "linux")]
impl From<&core::GitLabForkRecord> for ForkRecordView {
    fn from(record: &core::GitLabForkRecord) -> Self {
        let intent = &record.intent;
        Self {
            id: record.id.clone(),
            revision: record.revision.clone(),
            created_at_millis: record.created_at_millis.clone(),
            updated_at_millis: record.updated_at_millis.clone(),
            origin: intent.origin.clone(),
            account_id: intent.account_id.clone(),
            account_login: intent.account_login.clone(),
            source_id: intent.source_id.clone(),
            source_full_path: intent.source_full_path.clone(),
            source_empty: intent.source_empty,
            namespace_id: intent.namespace_id.clone(),
            namespace_full_path: intent.namespace_full_path.clone(),
            namespace_kind: intent.namespace_kind,
            project_path: intent.project_path.clone(),
            project_name: intent.project_name.clone(),
            target_full_path: intent.target_full_path(),
            phase: record.phase,
            project_id: record.project_id.clone(),
            project_empty: record.project_empty,
            http_status: record.http_status,
            import_state: record.import_state,
            last_failure: record.last_failure,
        }
    }
}
#[cfg(target_os = "linux")]
fn inspect(
    journal: &core::GitLabForkJournal,
    cancellation: &CancellationToken,
) -> Result<ForkRecordList, AppError> {
    check(cancellation)?;
    let inspection = journal.inspect()?;
    check(cancellation)?;
    Ok(ForkRecordList {
        entries: inspection
            .entries
            .into_iter()
            .map(|entry| ForkRecordEntry {
                id: entry.id,
                record: entry.record.as_ref().map(ForkRecordView::from),
                pending: entry.pending,
                retired: entry.retired,
                operation_active: entry.operation_active,
            })
            .collect(),
        issues: inspection
            .issues
            .into_iter()
            .map(|issue| ForkStorageIssue {
                id: issue.id,
                kind: match issue.kind {
                    core::GitLabForkJournalIssueKind::UnknownEntry => {
                        ForkStorageIssueKind::UnknownEntry
                    }
                    core::GitLabForkJournalIssueKind::InvalidRecord => {
                        ForkStorageIssueKind::InvalidRecord
                    }
                    core::GitLabForkJournalIssueKind::PendingWrite => {
                        ForkStorageIssueKind::PendingWrite
                    }
                    core::GitLabForkJournalIssueKind::Capacity => ForkStorageIssueKind::Capacity,
                },
            })
            .collect(),
    })
}
#[cfg(target_os = "linux")]
fn reconcile(
    accounts: &GitLabAccounts,
    journal: &core::GitLabForkJournal,
    request: ReconcileForkRequest,
    cancellation: &CancellationToken,
) -> Result<ForkRecordRefresh, AppError> {
    check(cancellation)?;
    let mut lease = journal.lease(&request.record_id, &request.expected_revision)?;
    let observation = accounts.read(
        &request.connection_id,
        &request.operation_id,
        cancellation,
        |reader, instance, account| {
            core::reconcile_gitlab_fork_with(
                reader,
                instance,
                account,
                lease.record(),
                &super::gitlab_fork_submission::now()?,
                cancellation,
            )
        },
    )?;
    check(cancellation)?;
    let persisted = lease.append(&observation).is_ok();
    Ok(ForkRecordRefresh {
        observation: ForkRecordView::from(&observation),
        persisted,
    })
}
#[cfg(target_os = "linux")]
fn retire(
    journal: &core::GitLabForkJournal,
    request: RetireForkRequest,
    cancellation: &CancellationToken,
) -> Result<bool, AppError> {
    check(cancellation)?;
    journal.retire(
        &request.record_id,
        &request.expected_revision,
        request.acknowledge_unconfirmed,
    )?;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn list_gitlab_fork_records(
    request: ForkRecordListRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<ForkRecordList, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        #[cfg(target_os = "linux")]
        {
            check(&cancellation)?;
            inspect(
                &super::gitlab_fork_submission::open_journal(&app)?,
                &cancellation,
            )
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (app, cancellation);
            Err(unsupported())
        }
    })
    .await
    .map_err(background_task_error)?
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reconcile_gitlab_fork_record(
    request: ReconcileForkRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<ForkRecordRefresh, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        #[cfg(target_os = "linux")]
        {
            check(&cancellation)?;
            reconcile(
                &app.state::<GitLabAccounts>(),
                &super::gitlab_fork_submission::open_journal(&app)?,
                request,
                &cancellation,
            )
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (app, request, cancellation);
            Err(unsupported())
        }
    })
    .await
    .map_err(background_task_error)?
}
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn retire_gitlab_fork_record(
    request: RetireForkRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<bool, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        #[cfg(target_os = "linux")]
        {
            check(&cancellation)?;
            retire(
                &super::gitlab_fork_submission::open_journal(&app)?,
                request,
                &cancellation,
            )
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (app, request, cancellation);
            Err(unsupported())
        }
    })
    .await
    .map_err(background_task_error)?
}

#[cfg(test)]
#[path = "gitlab_fork_recovery_tests.rs"]
mod tests;
