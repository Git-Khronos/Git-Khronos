//! One-use native fork review and durable submission. No Git operations.
use crate::gitlab_commands::{GitLabAccounts, identifier, main_label};
#[cfg(target_os = "linux")]
use crate::gitlab_fork_reviews::HeldFork;
use crate::gitlab_fork_reviews::{ForkReviews, ReviewError};
use crate::{
    AppError, AppHandle, CancellationToken, Manager, background_task_error,
    register_active_operation,
};
use git_khronos_git_core as core;
use serde::{Deserialize, Serialize};

pub(crate) type GitLabForkReviews = ForkReviews<core::GitLabForkPlan>;

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareForkRequest {
    pub connection_id: String,
    pub context: String,
    pub selection: core::GitLabForkPrepareRequest,
    pub operation_id: String,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitForkRequest {
    pub context: String,
    pub token: String,
    pub operation_id: String,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFork {
    pub token: String,
    pub preview: core::GitLabForkPreview,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SubmissionPhase {
    AwaitingConfirmation,
    AcceptedAwaitingInspection,
    ResponseRejected,
    StorageUnconfirmed,
}
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForkSubmissionOutcome {
    pub record_id: String,
    pub phase: SubmissionPhase,
    /// Last confirmed immutable revision, not a replay or restore token.
    pub revision: Option<String>,
    pub http_status: Option<u16>,
}
fn refused(message: &str) -> AppError {
    AppError {
        kind: "gitlabForkSubmission".into(),
        message: message.into(),
        hint: None,
    }
}
fn review_error(error: ReviewError) -> AppError {
    let message = match error {
        ReviewError::Busy => "This fork review is still being prepared.",
        ReviewError::Capacity => "Close another fork review before preparing this one.",
        _ => "This fork review is unavailable. Prepare a fresh review before submitting.",
    };
    refused(message)
}
fn check(token: &CancellationToken) -> Result<(), AppError> {
    if token.is_cancelled() {
        return Err(AppError {
            kind: "operationCancelled".into(),
            message: "Fork preparation or submission was interrupted.".into(),
            hint: None,
        });
    }
    Ok(())
}
fn prepare(
    accounts: &GitLabAccounts,
    reviews: &GitLabForkReviews,
    request: PrepareForkRequest,
    cancellation: &CancellationToken,
) -> Result<PreparedFork, AppError> {
    check(cancellation)?;
    let reservation = reviews
        .reserve(&request.context, identifier()?)
        .map_err(review_error)?;
    let token = reservation.token().to_owned();
    let plan = accounts.fork(
        &request.connection_id,
        &request.operation_id,
        cancellation,
        |reader, _writer, instance, account, live| {
            let plan = core::prepare_gitlab_fork_with(
                reader,
                instance,
                account,
                request.selection,
                cancellation,
            )?;
            live()?;
            Ok(plan)
        },
    )?;
    check(cancellation)?;
    let preview = plan.preview().clone();
    reservation
        .publish(request.connection_id, plan)
        .map_err(review_error)?;
    if let Err(error) = check(cancellation) {
        reviews
            .discard(&request.context, &token)
            .map_err(review_error)?;
        return Err(error);
    }
    Ok(PreparedFork { token, preview })
}

#[cfg(target_os = "linux")]
pub(super) fn now() -> Result<String, AppError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis().to_string())
        .map_err(|_| refused("The fork operation timestamp could not be confirmed."))
}

#[cfg(target_os = "linux")]
fn open_journal_at(
    directory: &std::path::Path,
    uid: u32,
) -> Result<core::GitLabForkJournal, AppError> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
    if !directory.is_absolute()
        || directory.file_name().is_none()
        || directory.components().any(|part| {
            matches!(
                part,
                std::path::Component::CurDir | std::path::Component::ParentDir
            )
        })
    {
        return Err(refused("The application-data location is unavailable."));
    }
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(directory)
        .map_err(|_| refused("The application-data directory could not be created."))?;
    let parent = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(directory)
        .map_err(|_| refused("The application-data directory could not be confirmed."))?;
    let metadata = parent
        .metadata()
        .map_err(|_| refused("The application-data owner could not be confirmed."))?;
    if !metadata.is_dir() || metadata.uid() != uid {
        return Err(refused(
            "The application-data directory belongs to another account.",
        ));
    }
    let confirm = || -> Result<(), AppError> {
        let current = std::fs::symlink_metadata(directory)
            .map_err(|_| refused("The application-data directory changed."))?;
        if !current.is_dir()
            || current.file_type().is_symlink()
            || current.uid() != uid
            || (current.dev(), current.ino()) != (metadata.dev(), metadata.ino())
        {
            return Err(refused("The application-data directory changed."));
        }
        Ok(())
    };
    confirm()?;
    // Framework storage can already have created this application-owned parent
    // using a permissive umask. Secure only the pinned directory owned by this
    // account; never chmod a symlink, foreign directory or a journal child.
    if metadata.mode() & 0o7777 != 0o700 {
        parent
            .set_permissions(std::fs::Permissions::from_mode(0o700))
            .map_err(|_| refused("The application-data directory could not be made private."))?;
    }
    confirm()?;
    core::GitLabForkJournal::open(&directory.join("gitlab-forks-v1"), uid)
}

#[cfg(target_os = "linux")]
pub(super) fn open_journal(app: &AppHandle) -> Result<core::GitLabForkJournal, AppError> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| refused("The application-data location is unavailable."))?;
    // Native-selected application namespace and actual effective UID, never
    // renderer-provided paths, permissions or identities.
    open_journal_at(&directory, unsafe { libc::geteuid() })
}

#[cfg(target_os = "linux")]
fn submit_with(
    accounts: &GitLabAccounts,
    reviews: &GitLabForkReviews,
    request: SubmitForkRequest,
    cancellation: &CancellationToken,
    open: impl FnOnce() -> Result<core::GitLabForkJournal, AppError>,
) -> Result<ForkSubmissionOutcome, AppError> {
    let held = reviews
        .take(&request.context, &request.token)
        .map_err(review_error)?;
    check(cancellation)?;
    let journal = open()?;
    dispatch(
        accounts,
        held,
        &journal,
        &request.operation_id,
        cancellation,
    )
}

#[cfg(target_os = "linux")]
fn dispatch(
    accounts: &GitLabAccounts,
    held: HeldFork<core::GitLabForkPlan>,
    journal: &core::GitLabForkJournal,
    operation_id: &str,
    cancellation: &CancellationToken,
) -> Result<ForkSubmissionOutcome, AppError> {
    let initial = core::GitLabForkRecord::new(identifier()?, held.plan.intent().clone(), now()?)?;
    accounts.fork(
        &held.connection_id,
        operation_id,
        cancellation,
        |reader, writer, instance, account, live| {
            let wire = core::revalidate_gitlab_fork_with(
                reader,
                instance,
                account,
                &held.plan,
                cancellation,
            )?;
            live()?;
            let mut attempted = false;
            let mut lease = None;
            let reply = writer.post_fork(
                instance,
                &wire,
                &mut || {
                    if attempted {
                        return Err(refused("The fork dispatch boundary was already used."));
                    }
                    live()?;
                    // Even an ambiguous failure to publish may leave a journal entry.
                    // Retain its native identity in the returned outcome, never replay.
                    attempted = true;
                    lease = Some(journal.begin(&initial)?);
                    live()
                },
                cancellation,
            );
            if !attempted {
                return Err(reply.err().unwrap_or_else(|| {
                    refused("The fork port did not confirm its dispatch boundary.")
                }));
            }
            let Some(mut lease) = lease else {
                return Ok(ForkSubmissionOutcome {
                    record_id: initial.id.clone(),
                    phase: SubmissionPhase::StorageUnconfirmed,
                    revision: None,
                    http_status: None,
                });
            };
            // No connection/cancellation gate after possible dispatch. Outcomes
            // survive a closed webview, a disconnected account and a lost reply.
            let mut phase = SubmissionPhase::AwaitingConfirmation;
            let next = now().and_then(|time| match reply {
                Ok(reply) if (200..=299).contains(&reply.status) => {
                    // A create reply is not fresh relationship/import evidence.
                    // Raw provider JSON is intentionally neither persisted nor returned.
                    phase = SubmissionPhase::AcceptedAwaitingInspection;
                    lease.record().accepted_status(reply.status, &time)
                }
                Ok(reply) => {
                    phase = SubmissionPhase::ResponseRejected;
                    lease.record().rejected(reply.status, &time)
                }
                Err(error) => {
                    let failure = match error.kind.as_str() {
                        "operationCancelled" | "gitlabConnectionExpired" => {
                            core::GitLabForkFailure::Interrupted
                        }
                        "gitlabForkConnection" | "gitlabForkTimeout" => {
                            core::GitLabForkFailure::Connection
                        }
                        _ => core::GitLabForkFailure::InvalidReply,
                    };
                    lease.record().interrupted(failure, &time)
                }
            });
            if next.and_then(|next| lease.append(&next)).is_err() {
                phase = SubmissionPhase::StorageUnconfirmed;
            }
            Ok(ForkSubmissionOutcome {
                record_id: initial.id.clone(),
                phase,
                revision: Some(lease.record().revision.clone()),
                http_status: lease.record().http_status,
            })
        },
    )
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn prepare_gitlab_fork(
    request: PrepareForkRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<PreparedFork, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        prepare(
            &app.state::<GitLabAccounts>(),
            &app.state::<GitLabForkReviews>(),
            request,
            &cancellation,
        )
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn discard_gitlab_fork(
    context: String,
    token: String,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<bool, AppError> {
    main_label(window.label())?;
    app.state::<GitLabForkReviews>()
        .discard(&context, &token)
        .map_err(review_error)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn execute_gitlab_fork(
    request: SubmitForkRequest,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<ForkSubmissionOutcome, AppError> {
    main_label(window.label())?;
    let (cancellation, operation) = register_active_operation(&app, request.operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        #[cfg(target_os = "linux")]
        {
            // A renderer cannot replace connection, intent, origin, endpoint or credential.
            submit_with(
                &app.state::<GitLabAccounts>(),
                &app.state::<GitLabForkReviews>(),
                request,
                &cancellation,
                || open_journal(&app),
            )
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (request, cancellation, app);
            Err(refused(
                "Durable fork submission is not supported on this platform yet.",
            ))
        }
    })
    .await
    .map_err(background_task_error)?
}

#[cfg(test)]
#[path = "gitlab_fork_submission_tests.rs"]
mod tests;
