//! Project-owned link parsing, known-location discovery and reviewed local opening.
use super::*;
use git_khronos_git_core::{
    RepositoryLink, RepositoryLinkInspection, RepositoryLinkTarget, RepositoryLinkTargetState,
    inspect_repository_link, without_lazy_fetch_cancellable,
};

const MAX_KNOWN_PATHS: usize = 32;
const MAX_PATH_BYTES: usize = 8 * 1024;

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepositoryLinkLocationIssue {
    path: String,
    message: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepositoryLinkDiscovery {
    link: RepositoryLink,
    inspected_paths: u32,
    matches: Vec<RepositoryLinkInspection>,
    unavailable: Vec<RepositoryLinkLocationIssue>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct OpenedRepositoryLink {
    repository: RepositorySnapshot,
    inspection: RepositoryLinkInspection,
}

fn refused(kind: &str, message: &str) -> AppError {
    AppError {
        kind: kind.into(),
        message: message.into(),
        hint: Some(
            "Review the link and local repository, then retry. No fetch or checkout was requested."
                .into(),
        ),
    }
}

fn validate_paths(paths: &[String]) -> Result<(), AppError> {
    if paths.len() > MAX_KNOWN_PATHS
        || paths.iter().any(|path| {
            path.is_empty() || path.len() > MAX_PATH_BYTES || !Path::new(path).is_absolute()
        })
    {
        return Err(refused(
            "invalidRepositoryLinkPaths",
            "Choose at most 32 known absolute repository locations.",
        ));
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(super) fn parse_repository_link(raw_link: String) -> Result<RepositoryLink, AppError> {
    git_khronos_git_core::parse_repository_link(&raw_link)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(super) fn create_repository_link(
    remote: String,
    target: RepositoryLinkTarget,
) -> Result<String, AppError> {
    git_khronos_git_core::create_repository_link(&remote, &target)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(super) async fn discover_repository_link(
    raw_link: String,
    known_paths: Vec<String>,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositoryLinkDiscovery, AppError> {
    let link = git_khronos_git_core::parse_repository_link(&raw_link)?;
    validate_paths(&known_paths)?;
    let (cancellation, active_operation) = register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _active_operation = active_operation;
        without_lazy_fetch_cancellable(&cancellation, || {
            let paths: std::collections::BTreeSet<_> = known_paths.into_iter().collect();
            let inspected_paths = paths.len() as u32;
            let mut matches = std::collections::BTreeMap::new();
            let mut unavailable = vec![];
            for path in paths {
                match inspect_repository_link(Path::new(&path), &raw_link, &cancellation) {
                    Ok(inspection) => {
                        if !inspection.matched_remotes.is_empty() {
                            matches.insert(inspection.path.clone(), inspection);
                        }
                    }
                    Err(error) if error.kind == "operationCancelled" => return Err(error),
                    Err(_) => unavailable.push(RepositoryLinkLocationIssue {
                        path,
                        message: "This known location could not be inspected completely.".into(),
                    }),
                }
            }
            Ok(RepositoryLinkDiscovery {
                link,
                inspected_paths,
                matches: matches.into_values().collect(),
                unavailable,
            })
        })
    })
    .await
    .map_err(background_task_error)?
}

fn same_selection(left: &RepositoryLinkInspection, right: &RepositoryLinkInspection) -> bool {
    left.link == right.link
        && left.path == right.path
        && left.bare == right.bare
        && left.matched_remotes == right.matched_remotes
        && left.target == right.target
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(super) async fn open_repository_link(
    raw_link: String,
    path: String,
    expected_oid: Option<String>,
    operation_id: String,
    app: AppHandle,
) -> Result<OpenedRepositoryLink, AppError> {
    git_khronos_git_core::parse_repository_link(&raw_link)?;
    validate_paths(std::slice::from_ref(&path))?;
    if expected_oid.as_ref().is_some_and(|oid| {
        !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|b| b.is_ascii_hexdigit())
    }) {
        return Err(refused(
            "invalidRepositoryLinkTarget",
            "The reviewed commit identifier is invalid.",
        ));
    }
    let (cancellation, active_operation) = register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _active_operation = active_operation;
        without_lazy_fetch_cancellable(&cancellation, || {
            let inspection = inspect_repository_link(Path::new(&path), &raw_link, &cancellation)?;
            if inspection.matched_remotes.is_empty() {
                return Err(refused("repositoryLinkMismatch", "This local copy no longer matches the shared repository."));
            }
            if let Some(expected) = &expected_oid
                && !matches!(&inspection.target, RepositoryLinkTargetState::Commit { oid } if oid.eq_ignore_ascii_case(expected))
            {
                return Err(refused("repositoryLinkChanged", "The reviewed local target changed. Find local copies again."));
            }
            let state = app.state::<AppState>();
            // Publish a guarded session before installing its watcher. A refused or
            // cancelled late result may leave this conservative policy cached; the UI
            // refreshes the policy map without navigating on a stale reply.
            let repository = register_repository_with_read_policy(PathBuf::from(&inspection.path), &state, &app, true)?;
            let fresh = inspect_repository_link(Path::new(&inspection.path), &raw_link, &cancellation)?;
            if !same_selection(&inspection, &fresh) {
                return Err(refused("repositoryLinkChanged", "The repository or target changed while opening. Review a fresh selection."));
            }
            if cancellation.is_cancelled() {
                return Err(refused("operationCancelled", "Opening the repository link was cancelled."));
            }
            let session = repository_session(&repository.id, &state)?;
            session.no_lazy_reads.store(true, Ordering::Release);
            session.pause_auto_sync.store(true, Ordering::Release);
            Ok(OpenedRepositoryLink { repository, inspection: fresh })
        })
    }).await.map_err(background_task_error)?
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepositoryLinkReadPolicy {
    no_lazy_reads: bool,
    auto_fetch_paused: bool,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(super) fn repository_link_read_policy(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositoryLinkReadPolicy, AppError> {
    let session = repository_session(&repo_id, &state)?;
    Ok(RepositoryLinkReadPolicy {
        no_lazy_reads: session.no_lazy_reads.load(Ordering::Acquire),
        auto_fetch_paused: session.pause_auto_sync.load(Ordering::Acquire),
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub(super) fn resume_repository_link_auto_fetch(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let session = repository_session(&repo_id, &state)?;
    session.pause_auto_sync.store(false, Ordering::Release);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(super) fn repository_link_read_policies(
    state: tauri::State<'_, AppState>,
) -> Result<HashMap<String, RepositoryLinkReadPolicy>, AppError> {
    let sessions = state.repositories.lock().map_err(state_error)?;
    let mut policies = HashMap::new();
    for (id, session) in sessions.iter() {
        let no_lazy_reads = session.no_lazy_reads.load(Ordering::Acquire);
        let auto_fetch_paused = session.pause_auto_sync.load(Ordering::Acquire);
        if no_lazy_reads || auto_fetch_paused {
            policies.insert(
                id.clone(),
                RepositoryLinkReadPolicy {
                    no_lazy_reads,
                    auto_fetch_paused,
                },
            );
        }
    }
    Ok(policies)
}
