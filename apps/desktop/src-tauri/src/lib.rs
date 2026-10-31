use git_khronos_git_core::{
    AppError, CancellationToken, CommitComparison, CommitDetails, CommitFileDiff,
    CommitHistoryCursor, CommitHistoryPage, ConflictDetails, FetchOptions, FileBlameLine,
    FileHistoryEntry, InteractiveRebasePlan, InteractiveRebaseStep, MINIMUM_GIT_VERSION,
    ReflogPage, RepositoryData, RepositoryStatus, SigningDiagnostic, TagDetails, TrackedFileSearch,
    WorkingTreeFileDiff, abort_merge as git_abort_merge, abort_rebase as git_abort_rebase,
    add_remote as git_add_remote, add_submodule as git_add_submodule,
    apply_stash_checked as git_apply_stash,
    apply_working_tree_hunk_with_preview as git_apply_working_tree_hunk,
    apply_working_tree_lines_with_preview as git_apply_working_tree_lines,
    begin_rebase_split as git_begin_rebase_split, checkout_branch as git_checkout_branch,
    checkout_commit as git_checkout_commit, checkout_remote_branch as git_checkout_remote_branch,
    cherry_pick_commits_with_options as git_cherry_pick_commits,
    clone_repository_with_submodules as git_clone_repository, commit_details as git_commit_details,
    commit_file_diff as git_commit_file_diff, compare_commit_file as git_compare_commit_file,
    compare_commit_file_with_working_tree as git_compare_commit_file_with_working_tree,
    compare_commit_with_working_tree as git_compare_commit_with_working_tree,
    compare_commits as git_compare_commits, conflict_details as git_conflict_details,
    continue_merge as git_continue_merge, continue_rebase as git_continue_rebase,
    control_history_operation as git_control_history_operation, create_branch as git_create_branch,
    create_branch_at as git_create_branch_at, create_tag as git_create_tag,
    create_worktree as git_create_worktree,
    create_worktree_for_branch as git_create_worktree_for_branch,
    delete_branch as git_delete_branch, detect_git,
    disable_sparse_checkout as git_disable_sparse_checkout, drop_stash_checked as git_drop_stash,
    execute_interactive_rebase_with_destination as git_execute_interactive_rebase,
    fetch_cancellable as git_fetch_cancellable, fetch_if_needed as git_fetch_if_needed,
    fetch_remote_cancellable as git_fetch_remote_cancellable,
    fetch_with_options as git_fetch_with_options, file_blame as git_file_blame,
    file_history as git_file_history, ignore_path as git_ignore_path,
    initialize_all_submodules_cancellable as git_initialize_all_submodules_cancellable,
    initialize_lfs as git_initialize_lfs, initialize_repository as git_initialize_repository,
    initialize_submodule as git_initialize_submodule, integrate_branch as git_integrate_branch,
    mark_bisect as git_mark_bisect, move_head_if_current as git_move_head,
    perform_repository_maintenance as git_perform_repository_maintenance,
    pop_stash_checked as git_pop_stash_entry,
    prepare_interactive_rebase_with_options as git_prepare_interactive_rebase,
    prune_lfs_cancellable as git_prune_lfs_cancellable,
    publish_branch_cancellable as git_publish_branch_cancellable,
    pull_from_remote_with_strategy_cancellable as git_pull_from_remote_cancellable,
    pull_lfs_cancellable as git_pull_lfs_cancellable, push_cancellable as git_push_cancellable,
    push_force_with_lease_cancellable as git_push_force_cancellable,
    push_force_with_lease_to_remote_cancellable as git_push_force_to_remote_cancellable,
    push_to_remote_cancellable as git_push_to_remote_cancellable,
    reapply_sparse_checkout as git_reapply_sparse_checkout, reflog_entries as git_reflog_entries,
    remove_remote as git_remove_remote, remove_worktree as git_remove_worktree,
    rename_branch as git_rename_branch, rename_stash as git_rename_stash, repository_watch_paths,
    reset_bisect as git_reset_bisect, reset_to_commit as git_reset_to_commit,
    resolve_conflict_with_preview as git_resolve_conflict, resolve_repository,
    restore_files_from_commit as git_restore_files_from_commit,
    revert_commit_with_mainline as git_revert_commit, revert_commits as git_revert_commits,
    search_tracked_files as git_search_tracked_files,
    set_branch_upstream as git_set_branch_upstream, set_remote_url as git_set_remote_url,
    set_repository_identity as git_set_repository_identity,
    set_sparse_checkout as git_set_sparse_checkout, set_worktree_locked as git_set_worktree_locked,
    signing_diagnostic as git_signing_diagnostic, skip_rebase as git_skip_rebase,
    snapshot_with_limits_fast, snapshot_with_limits_startup, stage_all as git_stage_all,
    stage_path as git_stage_path, start_bisect as git_start_bisect,
    stash_details_at_oid as git_stash_details, stash_file_diff_at_oid as git_stash_file_diff,
    stash_with_message as git_stash, status_with_entry_limit, status_with_entry_limit_fast,
    tag_details as git_tag_details, track_lfs_pattern as git_track_lfs_pattern,
    unstage_all as git_unstage_all, unstage_path as git_unstage_path,
    update_all_submodules_cancellable as git_update_all_submodules_cancellable,
    update_head_message as git_update_head_message,
    update_submodule_cancellable as git_update_submodule_cancellable,
    working_tree_file_diff as git_working_tree_file_diff,
};
use git_khronos_git_core::{
    DiscardPlan, DiscardPreview, DiscardRecoveryInfo, delete_discard_recovery,
    discarded_change_recoveries, execute_discard, prepare_discard, prepare_partial_discard_with_preview,
    recover_discarded_changes,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
mod reference_commands;
mod stash_commands;
mod terminal_io;
#[cfg(test)]
mod terminal_lifecycle_tests;
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

mod authentication;
mod recovery_commands;

#[derive(Default)]
struct AppState {
    repositories: Mutex<HashMap<String, Arc<RepositorySession>>>,
    repository_watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    discard_recoveries: Mutex<HashMap<String, DiscardRecovery>>,
    discard_plans: Mutex<HashMap<String, (String, DiscardPlan)>>,
    reset_plans: Mutex<HashMap<String, (String, git_khronos_git_core::ResetPlan)>>,
    active_operations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    terminals: Mutex<HashMap<String, TerminalSession>>,
    next_id: AtomicU64,
    next_terminal_id: AtomicU64,
}

struct ActiveOperationGuard {
    registry: Arc<Mutex<HashMap<String, CancellationToken>>>,
    operation_id: String,
}

impl Drop for ActiveOperationGuard {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.registry.lock() {
            operations.remove(&self.operation_id);
        }
    }
}

struct DiscardRecovery {
    id: String,
    undone: bool,
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
struct RepositoryChanged {
    repository_id: String,
}

struct RepositorySession {
    path: PathBuf,
    operation: Mutex<()>,
    history_cursor: Mutex<CommitHistoryCursor>,
    history_limit: AtomicUsize,
    status_limit: AtomicUsize,
}

const INITIAL_HISTORY_LIMIT: usize = 80;
const HISTORY_PAGE_SIZE: usize = 160;
const INITIAL_STATUS_LIMIT: usize = 1_000;
const STATUS_PAGE_SIZE: usize = 1_000;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<tauri::async_runtime::Mutex<Box<dyn Write + Send>>>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    lifecycle: Arc<Mutex<TerminalLifecycle>>,
}

#[derive(Default)]
struct TerminalLifecycle {
    reader_finished: bool,
    reaped: bool,
    announced: bool,
}

impl TerminalLifecycle {
    fn claim_exit(&mut self) -> bool {
        if !self.reader_finished || !self.reaped || self.announced {
            return false;
        }
        self.announced = true;
        true
    }
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct TerminalInfo {
    id: String,
    label: String,
    cwd: String,
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    app_version: &'static str,
    git_version: Option<String>,
    git_supported: bool,
    minimum_git_version: &'static str,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct RepositorySnapshot {
    id: String,
    #[serde(flatten)]
    data: RepositoryData,
}

#[tauri::command]
#[specta::specta]
fn system_info() -> SystemInfo {
    let git = detect_git();
    SystemInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        git_version: git.version,
        git_supported: git.supported,
        minimum_git_version: MINIMUM_GIT_VERSION,
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn cancel_git_operation(
    operation_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, AppError> {
    let operations = state.active_operations.lock().map_err(state_error)?;
    let Some(cancellation) = operations.get(&operation_id) else {
        return Ok(false);
    };
    cancellation.cancel();
    Ok(true)
}

#[tauri::command]
#[specta::specta]
async fn open_repository(path: String, app: AppHandle) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve_repository(Path::new(&path))?;
        let state = app.state::<AppState>();
        register_repository(root, &state, &app)
    })
    .await
    .map_err(background_task_error)?
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn clone_repository(
    remote: String,
    parent_path: String,
    folder: String,
    branch: Option<String>,
    depth: Option<u32>,
    recurse_submodules: Option<bool>,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    let (cancellation, _active_operation) = register_active_operation(&app, operation_id.clone())?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = authentication::run(&app, &operation_id, None, &cancellation, true, || {
            git_clone_repository(
                &remote,
                Path::new(&parent_path),
                &folder,
                branch.as_deref(),
                depth,
                recurse_submodules.unwrap_or(false),
            )
        })?;
        let state = app.state::<AppState>();
        register_repository(root, &state, &app)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn initialize_repository(
    parent_path: String,
    folder: String,
    initial_branch: String,
    create_readme: bool,
    state: tauri::State<'_, AppState>,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    let root = git_initialize_repository(
        Path::new(&parent_path),
        &folder,
        &initial_branch,
        create_readme,
    )?;
    register_repository(root, &state, &app)
}

fn register_repository(
    root: PathBuf,
    state: &tauri::State<'_, AppState>,
    app: &AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    let mut repositories = state.repositories.lock().map_err(state_error)?;
    let existing = repositories
        .iter()
        .find_map(|(id, session)| (session.path == root).then(|| id.clone()));
    let id = existing.unwrap_or_else(|| {
        let id = format!("repo-{}", state.next_id.fetch_add(1, Ordering::Relaxed));
        repositories.insert(
            id.clone(),
            Arc::new(RepositorySession {
                path: root.clone(),
                operation: Mutex::new(()),
                history_cursor: Mutex::new(CommitHistoryCursor::default()),
                history_limit: AtomicUsize::new(INITIAL_HISTORY_LIMIT),
                status_limit: AtomicUsize::new(INITIAL_STATUS_LIMIT),
            }),
        );
        id
    });
    drop(repositories);
    let snapshot = startup_snapshot_for_id(&id, state)?;
    install_repository_watcher(&id, &root, state, app);
    Ok(snapshot)
}

fn install_repository_watcher(
    repository_id: &str,
    root: &Path,
    state: &tauri::State<'_, AppState>,
    app: &AppHandle,
) {
    let Ok(watchers) = state.repository_watchers.lock() else {
        return;
    };
    if watchers.contains_key(repository_id) {
        return;
    }
    drop(watchers);
    let event_repository_id = repository_id.to_owned();
    let event_app = app.clone();
    let Ok(mut watcher) =
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else { return };
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let _ = RepositoryChanged {
                repository_id: event_repository_id.clone(),
            }
            .emit(&event_app);
        })
    else {
        return;
    };
    if watcher.watch(root, RecursiveMode::NonRecursive).is_err() {
        return;
    }
    let Ok(metadata_paths) = repository_watch_paths(root) else {
        return;
    };
    for path in metadata_paths.non_recursive {
        if watcher.watch(&path, RecursiveMode::NonRecursive).is_err() {
            return;
        }
    }
    for path in metadata_paths.recursive {
        if watcher.watch(&path, RecursiveMode::Recursive).is_err() {
            return;
        }
    }
    if let Ok(mut watchers) = state.repository_watchers.lock() {
        watchers.entry(repository_id.to_owned()).or_insert(watcher);
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn refresh_repository(
    repo_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        snapshot_for_id(&repo_id, &state)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn refresh_repository_status(
    repo_id: String,
    app: AppHandle,
) -> Result<RepositoryStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        status_with_entry_limit_fast(&session.path, session.status_limit.load(Ordering::Relaxed))
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn diagnose_signing(repo_id: String, app: AppHandle) -> Result<SigningDiagnostic, AppError> {
    with_repository_background_read(repo_id, app, git_signing_diagnostic).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn load_more_commits(repo_id: String, app: AppHandle) -> Result<CommitHistoryPage, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        // Snapshot refreshes reset the cursor. Keep the page and its retained
        // snapshot limit in the same repository operation as that reset.
        let _operation = session.operation.lock().map_err(state_error)?;
        let page = session
            .history_cursor
            .lock()
            .map_err(state_error)?
            .next_page(&session.path, HISTORY_PAGE_SIZE)?;
        let limit = session.history_limit.load(Ordering::Relaxed);
        session
            .history_limit
            .store(limit.saturating_add(page.commits.len()), Ordering::Relaxed);
        Ok(page)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn search_tracked_files(
    repo_id: String,
    query: String,
    limit: usize,
    app: AppHandle,
) -> Result<TrackedFileSearch, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        git_search_tracked_files(&session.path, &query, limit)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn load_reflog(repo_id: String, app: AppHandle) -> Result<ReflogPage, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        git_reflog_entries(&session.path, 250)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn load_more_changes(repo_id: String, app: AppHandle) -> Result<RepositoryStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        let current = session.status_limit.load(Ordering::Relaxed);
        let next = current.saturating_add(STATUS_PAGE_SIZE);
        let status = status_with_entry_limit(&session.path, next)?;
        session.status_limit.store(next, Ordering::Relaxed);
        Ok(status)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn open_repository_in_file_manager(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let session = repository_session(&repo_id, &state)?;
    open_path_in_file_manager(&session.path)
}

#[tauri::command]
#[specta::specta]
fn open_external_url(url: String) -> Result<(), AppError> {
    validate_external_url(&url)?;

    #[cfg(target_os = "linux")]
    let child = Command::new("xdg-open").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let child = Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let child = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    return Err(AppError {
        kind: "externalUrlUnsupported".into(),
        message: "Opening external links is not supported on this platform.".into(),
        hint: None,
    });

    child.map(|_| ()).map_err(|_| AppError {
        kind: "externalUrlUnavailable".into(),
        message: "The link could not be opened.".into(),
        hint: Some("Check that a default web browser is installed and available.".into()),
    })
}

fn validate_external_url(url: &str) -> Result<(), AppError> {
    if url.len() <= 2_048 && url.starts_with("https://") && !url.chars().any(char::is_control) {
        return Ok(());
    }
    Err(AppError {
        kind: "invalidExternalUrl".into(),
        message: "Only secure HTTPS links can be opened.".into(),
        hint: None,
    })
}

#[tauri::command]
#[specta::specta]
fn toggle_fullscreen(window: tauri::Window) -> Result<bool, AppError> {
    let fullscreen = window.is_fullscreen().map_err(|_| AppError {
        kind: "windowStateUnavailable".into(),
        message: "The window state could not be read.".into(),
        hint: Some("Try the fullscreen shortcut again.".into()),
    })?;
    window.set_fullscreen(!fullscreen).map_err(|_| AppError {
        kind: "fullscreenUnavailable".into(),
        message: "Fullscreen mode could not be changed.".into(),
        hint: Some("The current desktop environment may not support this window operation.".into()),
    })?;
    Ok(!fullscreen)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn stage_all(repo_id: String, app: AppHandle) -> Result<RepositoryStatus, AppError> {
    mutate_working_tree_background(repo_id, app, git_stage_all).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn unstage_all(repo_id: String, app: AppHandle) -> Result<RepositoryStatus, AppError> {
    mutate_working_tree_background(repo_id, app, git_unstage_all).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn stage_path(
    repo_id: String,
    path: String,
    app: AppHandle,
) -> Result<RepositoryStatus, AppError> {
    mutate_working_tree_background(repo_id, app, move |repository| {
        git_stage_path(repository, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn unstage_path(
    repo_id: String,
    path: String,
    app: AppHandle,
) -> Result<RepositoryStatus, AppError> {
    mutate_working_tree_background(repo_id, app, move |repository| {
        git_unstage_path(repository, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn discard_path(
    repo_id: String,
    path: String,
    untracked: bool,
    app: AppHandle,
) -> Result<RepositoryStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_with_discard_recovery(
            &repo_id,
            &state,
            |repository| {
                let plan = prepare_discard(repository, Some(vec![path.clone()]))?;
                if untracked != (plan.preview.untracked > 0) {
                    return Err(AppError {
                        kind: "staleWorkingTreeFile".into(),
                        message: "That file's status changed before discarding.".into(),
                        hint: Some("Refresh and review a new discard preview.".into()),
                    });
                }
                Ok(plan)
            },
            working_tree_status,
        )
    })
    .await
    .map_err(background_task_error)?
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct PreparedDiscard {
    token: String,
    #[serde(flatten)]
    preview: DiscardPreview,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn preview_discard(
    repo_id: String,
    paths: Option<Vec<String>>,
    app: AppHandle,
) -> Result<PreparedDiscard, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        let plan = prepare_discard(&session.path, paths)?;
        let token = state.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let preview = plan.preview.clone();
        let mut plans = state.discard_plans.lock().map_err(state_error)?;
        plans.retain(|_, (repository, _)| repository != &repo_id);
        plans.insert(token.clone(), (repo_id, plan));
        Ok(PreparedDiscard { token, preview })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn discard_changes(
    repo_id: String,
    token: String,
    app: AppHandle,
) -> Result<DiscardResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        let mut plans = state.discard_plans.lock().map_err(state_error)?;
        let matches = plans
            .get(&token)
            .is_some_and(|(repository, _)| repository == &repo_id);
        if !matches {
            return Err(AppError {
                kind: "staleDiscard".into(),
                message: "That discard preview expired.".into(),
                hint: Some("Review a new preview before discarding.".into()),
            });
        }
        let (_, plan) = plans.remove(&token).expect("validated discard plan");
        drop(plans);
        let id = execute_discard(&session.path, &plan)?;
        Ok(DiscardResult {
            id,
            status: working_tree_status(repo_id, &session)?,
        })
    })
    .await
    .map_err(background_task_error)?
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct DiscardResult {
    id: String,
    status: RepositoryStatus,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn load_discard_recoveries(
    repo_id: String,
    app: AppHandle,
) -> Result<Vec<DiscardRecoveryInfo>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        discarded_change_recoveries(&session.path)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn apply_saved_discard(
    repo_id: String,
    id: String,
    reverse: bool,
    app: AppHandle,
) -> Result<RepositoryStatus, AppError> {
    mutate_working_tree_background(repo_id, app, move |repository| {
        recover_discarded_changes(repository, &id, reverse)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn forget_saved_discard(repo_id: String, id: String, app: AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        delete_discard_recovery(&session.path, &id)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn ignore_path(
    repo_id: String,
    path: String,
    pattern_kind: String,
    stop_tracking: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_ignore_path(repository, &path, &pattern_kind, stop_tracking)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn commit_changes(
    repo_id: String,
    message: String,
    amend: bool,
    skip_hooks: bool,
    sign: bool,
    policy: Option<git_khronos_git_core::CommitPolicy>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_khronos_git_core::commit_with_policy(
            path,
            &message,
            amend,
            skip_hooks,
            Some(sign),
            &policy.unwrap_or_default(),
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn update_head_message(
    repo_id: String,
    expected_oid: String,
    message: String,
    skip_hooks: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_update_head_message(path, &expected_oid, &message, skip_hooks)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn checkout_branch(
    repo_id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_checkout_branch(path, &name))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn checkout_remote_branch(
    repo_id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_checkout_remote_branch(path, &name)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn create_branch(
    repo_id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_create_branch(path, &name))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn create_branch_at(
    repo_id: String,
    name: String,
    oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_create_branch_at(path, &name, &oid)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn create_worktree(
    repo_id: String,
    parent_path: String,
    folder: String,
    branch: String,
    base: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_create_worktree(path, Path::new(&parent_path), &folder, &branch, &base)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn create_worktree_for_branch(
    repo_id: String,
    parent_path: String,
    folder: String,
    branch: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_create_worktree_for_branch(path, Path::new(&parent_path), &folder, &branch)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn set_worktree_locked(
    repo_id: String,
    path: String,
    locked: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_set_worktree_locked(repository, &path, locked)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn remove_worktree(
    repo_id: String,
    path: String,
    delete_branch: bool,
    force: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    let target = PathBuf::from(&path);
    let is_open = state
        .repositories
        .lock()
        .map_err(state_error)?
        .values()
        .any(|session| session.path == target);
    if is_open {
        return Err(AppError {
            kind: "openWorktree".into(),
            message: "Close that worktree's repository tab before removing it.".into(),
            hint: None,
        });
    }
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_remove_worktree(repository, &path, delete_branch, force)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn move_worktree(
    repo_id: String,
    request: git_khronos_git_core::WorktreeMove,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let target = std::fs::canonicalize(&request.path).map_err(|error| AppError {
            kind: "worktreeMoveUnavailable".into(),
            message: format!("Could not inspect the selected worktree: {error}"),
            hint: Some("Refresh and review its path before retrying.".into()),
        })?;
        let is_open = state
            .repositories
            .lock()
            .map_err(state_error)?
            .values()
            .any(|session| std::fs::canonicalize(&session.path).is_ok_and(|path| path == target));
        if is_open {
            return Err(AppError {
                kind: "openWorktree".into(),
                message: "Close that worktree's repository tab before moving it.".into(),
                hint: None,
            });
        }
        mutate_and_refresh(&repo_id, &state, |path| {
            git_khronos_git_core::move_worktree(path, &request)
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn repair_worktree(
    repo_id: String,
    request: git_khronos_git_core::WorktreeRepair,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let actual = std::fs::canonicalize(&request.actual_path).map_err(|error| AppError {
            kind: "worktreeRepairUnavailable".into(),
            message: format!("Could not inspect the actual worktree: {error}"),
            hint: Some("Choose its existing directory and retry.".into()),
        })?;
        let sessions = state.repositories.lock().map_err(state_error)?;
        if sessions.values().any(|session| {
            session.path == Path::new(&request.path)
                || std::fs::canonicalize(&session.path).is_ok_and(|path| path == actual)
        }) {
            return Err(AppError {
                kind: "openWorktree".into(),
                message:
                    "Close the old and actual worktree tabs before repairing its registration."
                        .into(),
                hint: None,
            });
        }
        drop(sessions);
        mutate_and_refresh(&repo_id, &state, |path| {
            git_khronos_git_core::repair_worktree(path, &request)
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn worktree_registration_review(
    repo_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::WorktreeRegistrationReview, AppError> {
    with_repository_background(
        repo_id,
        app,
        git_khronos_git_core::review_worktree_registrations,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn submodule_state_review(
    repo_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::SubmoduleStateReview, AppError> {
    with_repository_background(repo_id, app, git_khronos_git_core::review_submodule_state).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn sync_submodule_url(
    repo_id: String,
    request: git_khronos_git_core::SubmoduleUrlSync,
    app: AppHandle,
) -> Result<git_khronos_git_core::SubmoduleUrlSyncResult, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::sync_submodule_url(path, &request)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn set_submodule_tracking_branch(
    repo_id: String,
    request: git_khronos_git_core::SubmoduleTrackingBranchChange,
    app: AppHandle,
) -> Result<git_khronos_git_core::SubmoduleTrackingBranchResult, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::set_submodule_tracking_branch(path, &request)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn checkout_recorded_submodule_commit(
    repo_id: String,
    request: git_khronos_git_core::SubmoduleRecordedCheckout,
    app: AppHandle,
) -> Result<git_khronos_git_core::SubmoduleRecordedCheckoutResult, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::checkout_recorded_submodule_commit(path, &request)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn deinit_submodule(
    repo_id: String,
    request: git_khronos_git_core::SubmoduleDeinit,
    app: AppHandle,
) -> Result<git_khronos_git_core::SubmoduleDeinitResult, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::deinit_submodule(path, &request)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn remove_submodule(
    repo_id: String,
    request: git_khronos_git_core::SubmoduleRemoval,
    app: AppHandle,
) -> Result<git_khronos_git_core::SubmoduleRemovalResult, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::remove_submodule(path, &request)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn prune_worktree_registration(
    repo_id: String,
    request: git_khronos_git_core::WorktreeRegistrationPrune,
    app: AppHandle,
) -> Result<git_khronos_git_core::WorktreeRegistrationPruneResult, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::prune_worktree_registration(path, &request)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_repository_integrity(
    repo_id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::IntegrityReport, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::inspect_integrity(path, &cancellation)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn add_submodule(
    repo_id: String,
    url: String,
    path: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(repo_id, operation_id, app, move |repository, _| {
        git_add_submodule(repository, &url, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn initialize_submodule(
    repo_id: String,
    path: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(repo_id, operation_id, app, move |repository, _| {
        git_initialize_submodule(repository, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn initialize_all_submodules(
    repo_id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |repository, cancellation| {
            git_initialize_all_submodules_cancellable(repository, cancellation)
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn update_submodule(
    repo_id: String,
    path: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |repository, cancellation| {
            git_update_submodule_cancellable(repository, &path, cancellation)
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn update_all_submodules(
    repo_id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |repository, cancellation| {
            git_update_all_submodules_cancellable(repository, cancellation)
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn checkout_commit(
    repo_id: String,
    oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_checkout_commit(path, &oid))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn rename_branch(
    repo_id: String,
    old_name: String,
    new_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_rename_branch(path, &old_name, &new_name)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn set_branch_upstream(
    repo_id: String,
    branch: String,
    upstream: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_set_branch_upstream(path, &branch, upstream.as_deref())
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn delete_branch(
    repo_id: String,
    name: String,
    force: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_delete_branch(path, &name, force)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn integrate_branch(
    repo_id: String,
    name: String,
    strategy: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_integrate_branch(path, &name, &strategy)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn continue_merge(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_continue_merge)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn abort_merge(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_abort_merge)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn prepare_interactive_rebase(
    repo_id: String,
    source: String,
    target: String,
    selection_oids: Option<Vec<String>>,
    root: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<InteractiveRebasePlan, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_prepare_interactive_rebase(
            path,
            &source,
            &target,
            selection_oids.as_deref(),
            root.unwrap_or(false),
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
fn execute_interactive_rebase(
    repo_id: String,
    source: String,
    target: String,
    steps: Vec<InteractiveRebaseStep>,
    selection_oids: Option<Vec<String>>,
    root: Option<bool>,
    onto_oid: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_execute_interactive_rebase(
            path,
            &source,
            &target,
            &steps,
            selection_oids.as_deref(),
            root.unwrap_or(false),
            onto_oid.as_deref(),
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn begin_rebase_split(
    repo_id: String,
    expected_head: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_begin_rebase_split(path, &expected_head)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn load_hosted_review(
    repo_id: String,
    remote: String,
    pull_number: u32,
    expected_head_oid: String,
    operation_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::HostedReview, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    with_repository_background_read(repo_id, app, move |path| {
        git_khronos_git_core::load_hosted_review(path, &remote, pull_number, &expected_head_oid, &cancellation)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn load_hosting_page(
    repo_id: String,
    remote: String,
    section: git_khronos_git_core::HostingSection,
    operation_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::HostingPage, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    with_repository_background_read(repo_id, app, move |path| {
        git_khronos_git_core::load_hosting_page(path, &remote, section, &cancellation)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn preview_merge(
    repo_id: String,
    request: git_khronos_git_core::MergePreviewRequest,
    operation_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::MergePreview, AppError> {
    let (cancellation, _operation) = register_active_operation(&app, operation_id)?;
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::preview_merge(path, &request, &cancellation)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn prepare_merge_rebase(
    repo_id: String,
    source: String,
    target: String,
    state: tauri::State<'_, AppState>,
) -> Result<git_khronos_git_core::MergeRebasePlan, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::prepare_merge_rebase(path, &source, &target)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn execute_merge_rebase(
    repo_id: String,
    request: git_khronos_git_core::MergeRebaseRequest,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_khronos_git_core::execute_merge_rebase(path, &request)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn export_diff_patch(
    repo_id: String,
    staged: bool,
    paths: Vec<String>,
    destination: String,
    state: tauri::State<'_, AppState>,
) -> Result<usize, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::export_patch(path, staged, &paths, std::path::Path::new(&destination))
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn review_diff_patch(
    repo_id: String,
    file: String,
    target: git_khronos_git_core::PatchTarget,
    state: tauri::State<'_, AppState>,
) -> Result<git_khronos_git_core::PatchReview, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::review_patch(path, std::path::Path::new(&file), target)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn import_diff_patch(
    repo_id: String,
    request: git_khronos_git_core::PatchRequest,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_khronos_git_core::import_patch(path, &request)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn export_git_bundle(
    repo_id: String,
    branch: String,
    expected_oid: String,
    destination: String,
    state: tauri::State<'_, AppState>,
) -> Result<usize, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::export_bundle(
            path,
            &branch,
            &expected_oid,
            std::path::Path::new(&destination),
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn review_git_bundle(
    repo_id: String,
    file: String,
    state: tauri::State<'_, AppState>,
) -> Result<git_khronos_git_core::BundleReview, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::review_bundle(path, std::path::Path::new(&file))
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn import_git_bundle(
    repo_id: String,
    request: git_khronos_git_core::BundleRequest,
    tip: git_khronos_git_core::BundleTip,
    state: tauri::State<'_, AppState>,
) -> Result<String, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::import_bundle(path, &request, &tip)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn review_mail_patch_export(
    repo_id: String,
    oids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<git_khronos_git_core::MailPatchReview, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::review_mail_patch_export(path, &oids)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn export_mail_patch(
    repo_id: String,
    request: git_khronos_git_core::MailPatchRequest,
    destination: String,
    state: tauri::State<'_, AppState>,
) -> Result<usize, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::export_mail_patch(path, &request, std::path::Path::new(&destination))
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn review_mail_patch_import(
    repo_id: String,
    file: String,
    state: tauri::State<'_, AppState>,
) -> Result<git_khronos_git_core::MailPatchImportReview, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::review_mail_patch_import(path, std::path::Path::new(&file))
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn import_mail_patch(
    repo_id: String,
    request: git_khronos_git_core::MailPatchImportRequest,
    state: tauri::State<'_, AppState>,
) -> Result<git_khronos_git_core::MailPatchProgress, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::import_mail_patch(path, &request)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn control_mail_patch(
    repo_id: String,
    action: git_khronos_git_core::MailPatchAction,
    state: tauri::State<'_, AppState>,
) -> Result<git_khronos_git_core::MailPatchProgress, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_khronos_git_core::control_mail_patch(path, action)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn continue_rebase(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_continue_rebase)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn skip_rebase(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_skip_rebase)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn abort_rebase(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_abort_rebase)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn fetch_repository(
    repo_id: String,
    remote: Option<String>,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| match remote.as_deref() {
            Some(remote) => git_fetch_remote_cancellable(path, remote, cancellation),
            None => git_fetch_cancellable(path, cancellation),
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn fetch_branches(
    repo_id: String,
    options: FetchOptions,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| git_fetch_with_options(path, &options, cancellation),
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn shallow_history_state(
    repo_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::ShallowHistoryState, AppError> {
    with_repository_background(repo_id, app, git_khronos_git_core::shallow_history_state).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn perform_repository_maintenance(repo_id: String, app: AppHandle) -> Result<(), AppError> {
    with_repository_background(repo_id, app, git_perform_repository_maintenance).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn sync_repository(
    repo_id: String,
    app: AppHandle,
) -> Result<Option<RepositorySnapshot>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        let fetched = authentication::run(
            &app,
            "background-fetch",
            Some(&repo_id),
            &CancellationToken::default(),
            false,
            || git_fetch_if_needed(&session.path),
        )?;
        if !fetched {
            return Ok(None);
        }
        build_snapshot(repo_id, &session).map(Some)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_pull(
    repo_id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(repo_id, operation_id, app, |path, cancellation| {
        git_pull_lfs_cancellable(path, cancellation)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_prune(
    repo_id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(repo_id, operation_id, app, |path, cancellation| {
        git_prune_lfs_cancellable(path, cancellation)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_prune_preview(
    repo_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::LfsPrunePreview, AppError> {
    with_repository_background(repo_id, app, |path| {
        git_khronos_git_core::preview_lfs_prune(
            path,
            &git_khronos_git_core::CancellationToken::default(),
        )
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_prune_objects(
    repo_id: String,
    preview: git_khronos_git_core::LfsPrunePreview,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| {
            git_khronos_git_core::prune_lfs_objects(path, &preview, cancellation)
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_initialize(repo_id: String, app: AppHandle) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, git_initialize_lfs).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_track_pattern(
    repo_id: String,
    pattern: String,
    lockable: bool,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, move |path| {
        git_track_lfs_pattern(path, &pattern, lockable)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_tracking_rules(
    repo_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::LfsTrackingRules, AppError> {
    with_repository_background(repo_id, app, git_khronos_git_core::lfs_tracking_rules).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_file_attributes(
    repo_id: String,
    file: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::LfsFileAttributes, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::lfs_file_attributes(path, &file)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_objects(
    repo_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::LfsObjects, AppError> {
    with_repository_background(repo_id, app, git_khronos_git_core::lfs_objects).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_fetch_preview(
    repo_id: String,
    file: String,
    remote: String,
    expected_oid: String,
    expected_size: u64,
    app: AppHandle,
) -> Result<git_khronos_git_core::LfsFetchPreview, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::preview_lfs_fetch(path, &file, &remote, &expected_oid, expected_size)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_fetch_object(
    repo_id: String,
    preview: git_khronos_git_core::LfsFetchPreview,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| {
            git_khronos_git_core::fetch_lfs_object(path, &preview, cancellation)
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_checkout_preview(
    repo_id: String,
    file: String,
    expected_oid: String,
    expected_size: u64,
    app: AppHandle,
) -> Result<git_khronos_git_core::LfsCheckoutPreview, AppError> {
    with_repository_background(repo_id, app, move |path| {
        git_khronos_git_core::preview_lfs_checkout(path, &file, &expected_oid, expected_size)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_checkout_object(
    repo_id: String,
    preview: git_khronos_git_core::LfsCheckoutPreview,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| {
            git_khronos_git_core::checkout_lfs_object(path, &preview, cancellation)
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_locks(
    repo_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::LfsLocks, AppError> {
    with_repository_background(repo_id, app, git_khronos_git_core::lfs_locks).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_lock_file(
    repo_id: String,
    file: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, move |path| {
        git_khronos_git_core::lock_lfs_file(path, &file)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_unlock_file(
    repo_id: String,
    lock: git_khronos_git_core::LfsLock,
    force: bool,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, move |path| {
        git_khronos_git_core::unlock_lfs_file(path, &lock, force)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn lfs_untrack_pattern(
    repo_id: String,
    pattern: String,
    expected_state: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, move |path| {
        git_khronos_git_core::untrack_lfs_pattern(path, &pattern, &expected_state)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn sparse_checkout_set(
    repo_id: String,
    paths: Vec<String>,
    sparse_index: bool,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, move |path| {
        git_set_sparse_checkout(path, &paths, sparse_index)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn sparse_checkout_reapply(
    repo_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, git_reapply_sparse_checkout).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn sparse_checkout_disable(
    repo_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, git_disable_sparse_checkout).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn pull_repository(
    repo_id: String,
    strategy: Option<String>,
    remote: Option<String>,
    branch: Option<String>,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    let strategy = strategy.unwrap_or_else(|| "merge".into());
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| match (remote.as_deref(), branch.as_deref()) {
            (None, None) => {
                git_pull_from_remote_cancellable(path, &strategy, None, None, cancellation)
            }
            target => {
                git_pull_from_remote_cancellable(path, &strategy, target.0, target.1, cancellation)
            }
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn push_repository(
    repo_id: String,
    remote: Option<String>,
    branch: Option<String>,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| match (remote.as_deref(), branch.as_deref()) {
            (Some(remote), Some(branch)) => {
                git_push_to_remote_cancellable(path, remote, branch, cancellation)
            }
            (None, None) => git_push_cancellable(path, cancellation),
            _ => Err(AppError {
                kind: "invalidRemoteTarget".into(),
                message: "Push needs both a remote and a branch.".into(),
                hint: Some("Select a remote and try again.".into()),
            }),
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn force_push_repository(
    repo_id: String,
    remote: Option<String>,
    branch: Option<String>,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| match (remote.as_deref(), branch.as_deref()) {
            (Some(remote), Some(branch)) => {
                git_push_force_to_remote_cancellable(path, remote, branch, cancellation)
            }
            (None, None) => git_push_force_cancellable(path, cancellation),
            _ => Err(AppError {
                kind: "invalidRemoteTarget".into(),
                message: "Force push needs both a remote and a branch.".into(),
                hint: Some("Select a remote and try again.".into()),
            }),
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn publish_branch(
    repo_id: String,
    remote: String,
    branch: String,
    operation_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_cancellable_background(
        repo_id,
        operation_id,
        app,
        move |path, cancellation| {
            git_publish_branch_cancellable(path, &remote, &branch, cancellation)
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn add_remote(
    repo_id: String,
    name: String,
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_add_remote(path, &name, &url))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn set_remote_url(
    repo_id: String,
    name: String,
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_set_remote_url(path, &name, &url)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn set_repository_identity(
    repo_id: String,
    name: String,
    email: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_set_repository_identity(path, &name, &email)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn remove_remote(
    repo_id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_remove_remote(path, &name))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn stash_changes(
    repo_id: String,
    message: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_stash(path, message.as_deref()))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn pop_stash(
    repo_id: String,
    expected_oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_pop_stash_entry(path, "stash@{0}", &expected_oid))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn apply_stash(
    repo_id: String,
    reference: String,
    expected_oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_apply_stash(path, &reference, &expected_oid))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn pop_stash_entry(
    repo_id: String,
    reference: String,
    expected_oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_pop_stash_entry(path, &reference, &expected_oid)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn drop_stash(
    repo_id: String,
    reference: String,
    expected_oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_drop_stash(path, &reference, &expected_oid))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn rename_stash(
    repo_id: String,
    reference: String,
    expected_oid: String,
    message: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_rename_stash(path, &reference, &expected_oid, &message)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn create_tag(
    repo_id: String,
    name: String,
    oid: String,
    message: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_create_tag(path, &name, &oid, message.as_deref())
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn cherry_pick_commits(
    repo_id: String,
    oids: Vec<String>,
    mainline: Option<u32>,
    no_commit: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_cherry_pick_commits(path, &oids, mainline, no_commit.unwrap_or(false))
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn revert_commit(
    repo_id: String,
    oid: String,
    mainline: Option<u32>,
    oids: Option<Vec<String>>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        if let Some(oids) = &oids {
            if mainline.is_some() || oids.first() != Some(&oid) {
                return Err(AppError {
                    kind: "invalidRevertRange".into(),
                    message: "The revert selection does not match the reviewed first commit or includes a shared mainline.".into(),
                    hint: None,
                });
            }
            git_revert_commits(path, oids)
        } else {
            git_revert_commit(path, &oid, mainline)
        }
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn reset_to_commit(
    repo_id: String,
    oid: String,
    mode: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_reset_to_commit(path, &oid, &mode)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn control_history_operation(
    repo_id: String,
    operation: String,
    action: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_control_history_operation(path, &operation, &action)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn start_bisect(
    repo_id: String,
    bad_oid: String,
    good_oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_start_bisect(path, &bad_oid, &good_oid)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn mark_bisect(
    repo_id: String,
    verdict: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_mark_bisect(path, &verdict))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn reset_bisect(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_reset_bisect)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn move_head(
    repo_id: String,
    expected_oid: String,
    target_oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_move_head(path, &expected_oid, &target_oid)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_commit(
    repo_id: String,
    oid: String,
    app: AppHandle,
) -> Result<CommitDetails, AppError> {
    with_repository_background_read(repo_id, app, move |path| git_commit_details(path, &oid)).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_tag(
    repo_id: String,
    name: String,
    app: AppHandle,
) -> Result<TagDetails, AppError> {
    with_repository_background_read(repo_id, app, move |path| git_tag_details(path, &name)).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_commit_file(
    repo_id: String,
    oid: String,
    path: String,
    previous_path: Option<String>,
    app: AppHandle,
) -> Result<CommitFileDiff, AppError> {
    with_repository_background_read(repo_id, app, move |repository| {
        git_commit_file_diff(repository, &oid, &path, previous_path.as_deref())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn inspect_stash(
    repo_id: String,
    oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommitDetails, AppError> {
    with_repository(&repo_id, &state, |path| git_stash_details(path, &oid))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn inspect_stash_file(
    repo_id: String,
    oid: String,
    path: String,
    previous_path: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<CommitFileDiff, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_stash_file_diff(repository, &oid, &path, previous_path.as_deref())
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn compare_commits(
    repo_id: String,
    base_oid: String,
    target_oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommitComparison, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_compare_commits(repository, &base_oid, &target_oid)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn compare_commit_file(
    repo_id: String,
    base_oid: String,
    target_oid: String,
    path: String,
    previous_path: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<CommitFileDiff, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_compare_commit_file(
            repository,
            &base_oid,
            &target_oid,
            &path,
            previous_path.as_deref(),
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn compare_commit_with_working_tree(
    repo_id: String,
    base_oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommitComparison, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_compare_commit_with_working_tree(repository, &base_oid)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn compare_commit_file_with_working_tree(
    repo_id: String,
    base_oid: String,
    path: String,
    previous_path: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<CommitFileDiff, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_compare_commit_file_with_working_tree(
            repository,
            &base_oid,
            &path,
            previous_path.as_deref(),
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn inspect_working_tree_file(
    repo_id: String,
    path: String,
    staged: bool,
    state: tauri::State<'_, AppState>,
) -> Result<WorkingTreeFileDiff, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_working_tree_file_diff(repository, &path, staged)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_file_history(
    repo_id: String,
    revision: String,
    path: String,
    app: AppHandle,
) -> Result<Vec<FileHistoryEntry>, AppError> {
    with_repository_background_read(repo_id, app, move |repository| {
        git_file_history(repository, &revision, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn search_repository_history(
    repo_id: String,
    query: git_khronos_git_core::history_search::HistoryQuery,
    cursor: Option<git_khronos_git_core::history_search::HistoryCursor>,
    operation_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::history_search::HistorySearchPage, AppError> {
    let (token, guard) = register_active_operation(&app, operation_id)?;
    with_repository_background_read(repo_id, app, move |path| {
        let _guard = guard;
        git_khronos_git_core::history_search::search_history(path, query, cursor, &token)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_file_history_page(
    repo_id: String,
    revision: String,
    path: String,
    cursor: Option<git_khronos_git_core::history_search::FileHistoryCursor>,
    operation_id: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::history_search::FileHistoryPage, AppError> {
    let (token, guard) = register_active_operation(&app, operation_id)?;
    with_repository_background_read(repo_id, app, move |repository| {
        let _guard = guard;
        git_khronos_git_core::history_search::file_history_page(
            repository, &revision, &path, cursor, &token,
        )
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_blame_navigation(
    repo_id: String,
    oid: String,
    path: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::history_search::BlameNavigation, AppError> {
    with_repository_background_read(repo_id, app, move |repository| {
        git_khronos_git_core::history_search::blame_navigation(
            repository,
            &oid,
            &path,
            &CancellationToken::default(),
        )
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_history_commit(
    repo_id: String,
    oid: String,
    app: AppHandle,
) -> Result<git_khronos_git_core::CommitSummary, AppError> {
    with_repository_background_read(repo_id, app, move |repository| {
        git_khronos_git_core::history_search::history_commit(
            repository,
            &oid,
            &CancellationToken::default(),
        )
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn compare_history_revisions(
    repo_id: String,
    base: String,
    target: String,
    mode: String,
    app: AppHandle,
) -> Result<CommitComparison, AppError> {
    with_repository_background_read(repo_id, app, move |repository| {
        let token = CancellationToken::default();
        let base = git_khronos_git_core::history_search::comparison_base(
            repository, &base, &target, &mode, &token,
        )?;
        // The resolver validates and freezes the target, including symbolic refs.
        let target = git_khronos_git_core::history_search::comparison_base(
            repository, &target, &target, "direct", &token,
        )?;
        git_compare_commits(repository, &base, &target)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_file_blame(
    repo_id: String,
    revision: String,
    path: String,
    app: AppHandle,
) -> Result<Vec<FileBlameLine>, AppError> {
    with_repository_background_read(repo_id, app, move |repository| {
        git_file_blame(repository, &revision, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn inspect_file_blame_page(repo_id: String, revision: String, path: String, first_line: usize, app: AppHandle)
    -> Result<git_khronos_git_core::FileBlamePage, AppError> {
    with_repository_background_read(repo_id, app, move |repository| {
        git_khronos_git_core::file_blame_page(repository, &revision, &path, first_line)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn restore_files_from_commit(
    repo_id: String,
    oid: String,
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_restore_files_from_commit(repository, &oid, &paths)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn inspect_conflict(
    repo_id: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<ConflictDetails, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_conflict_details(repository, &path)
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn resolve_conflict(
    repo_id: String,
    path: String,
    resolution: String,
    output: Option<String>,
    expected_state: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_resolve_conflict(
            repository,
            &path,
            &resolution,
            output.as_deref(),
            expected_state.as_deref(),
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn apply_working_tree_hunk(
    repo_id: String,
    path: String,
    staged: bool,
    hunk_index: usize,
    action: String,
    expected_patch: Option<String>,
    app: AppHandle,
) -> Result<RepositoryStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if action == "discard" {
            if staged {
                return Err(AppError {
                    kind: "invalidHunkAction".into(),
                    message: "Staged changes cannot be discarded from this diff.".into(),
                    hint: None,
                });
            }
            return mutate_with_discard_recovery(
                &repo_id,
                &state,
                |repository| {
                    prepare_partial_discard_with_preview(
                        repository,
                        &path,
                        hunk_index,
                        None,
                        expected_patch.as_deref(),
                    )
                },
                working_tree_status,
            );
        }
        mutate_working_tree(&repo_id, &state, |repository| {
            git_apply_working_tree_hunk(
                repository,
                &path,
                staged,
                hunk_index,
                &action,
                expected_patch.as_deref(),
            )
        })
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
async fn apply_working_tree_lines(
    repo_id: String,
    path: String,
    staged: bool,
    hunk_index: usize,
    line_indices: Vec<usize>,
    action: String,
    expected_patch: Option<String>,
    app: AppHandle,
) -> Result<RepositoryStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let apply = |repository: &Path| {
            git_apply_working_tree_lines(
                repository,
                &path,
                staged,
                hunk_index,
                &line_indices,
                &action,
                expected_patch.as_deref(),
            )
        };
        if action == "discard" {
            if staged {
                return Err(AppError {
                    kind: "invalidLineAction".into(),
                    message: "Staged changes cannot be discarded from this diff.".into(),
                    hint: None,
                });
            }
            return mutate_with_discard_recovery(
                &repo_id,
                &state,
                |repository| {
                    prepare_partial_discard_with_preview(
                        repository,
                        &path,
                        hunk_index,
                        Some(&line_indices),
                        expected_patch.as_deref(),
                    )
                },
                working_tree_status,
            );
        }
        mutate_working_tree(&repo_id, &state, apply)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn undo_discard(repo_id: String, app: AppHandle) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        apply_discard_recovery(&repo_id, &state, false)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn redo_discard(repo_id: String, app: AppHandle) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        apply_discard_recovery(&repo_id, &state, true)
    })
    .await
    .map_err(background_task_error)?
}

fn mutate_with_discard_recovery<T>(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
    prepare: impl FnOnce(&Path) -> Result<DiscardPlan, AppError>,
    finish: impl FnOnce(String, &RepositorySession) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    let plan = prepare(&session.path)?;
    let id = execute_discard(&session.path, &plan)?;
    let mut recoveries = state.discard_recoveries.lock().map_err(state_error)?;
    recoveries.insert(repo_id.to_owned(), DiscardRecovery { id, undone: false });
    drop(recoveries);
    finish(repo_id.to_owned(), &session)
}

fn apply_discard_recovery(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
    reverse: bool,
) -> Result<RepositorySnapshot, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    let id = {
        let recoveries = state.discard_recoveries.lock().map_err(state_error)?;
        let recovery = recoveries.get(repo_id).ok_or_else(|| AppError {
            kind: "discardRecoveryUnavailable".into(),
            message: "There are no discarded changes to recover.".into(),
            hint: None,
        })?;
        if recovery.undone != reverse {
            return Err(AppError {
                kind: "discardRecoveryStateChanged".into(),
                message: "That discard recovery has already been applied.".into(),
                hint: Some("Refresh the repository and try the available toolbar action.".into()),
            });
        }
        recovery.id.clone()
    };
    recover_discarded_changes(&session.path, &id, reverse)?;
    if let Some(recovery) = state
        .discard_recoveries
        .lock()
        .map_err(state_error)?
        .get_mut(repo_id)
    {
        recovery.undone = !reverse;
    }
    build_snapshot(repo_id.to_owned(), &session)
}

fn mutate_and_refresh(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
    mutation: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<RepositorySnapshot, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    mutation(&session.path)?;
    build_snapshot(repo_id.to_owned(), &session)
}

/// Applies an index or working-tree change and returns only the refreshed
/// status. Staging, unstaging and discarding never move references or
/// history, so rebuilding the full snapshot would only add latency.
fn mutate_working_tree(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
    mutation: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<RepositoryStatus, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    mutation(&session.path)?;
    working_tree_status(repo_id.to_owned(), &session)
}

fn working_tree_status(
    _repo_id: String,
    session: &RepositorySession,
) -> Result<RepositoryStatus, AppError> {
    status_with_entry_limit_fast(&session.path, session.status_limit.load(Ordering::Relaxed))
}

async fn mutate_working_tree_background<F>(
    repo_id: String,
    app: AppHandle,
    mutation: F,
) -> Result<RepositoryStatus, AppError>
where
    F: FnOnce(&Path) -> Result<(), AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_working_tree(&repo_id, &state, mutation)
    })
    .await
    .map_err(background_task_error)?
}

fn snapshot_for_id(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    build_snapshot(repo_id.to_owned(), &session)
}

fn startup_snapshot_for_id(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    let snapshot = RepositorySnapshot {
        id: repo_id.to_owned(),
        data: snapshot_with_limits_startup(
            &session.path,
            session.history_limit.load(Ordering::Relaxed),
            session.status_limit.load(Ordering::Relaxed),
        )?,
    };
    session
        .history_cursor
        .lock()
        .map_err(state_error)?
        .reset(&session.path, &snapshot.data.commits)?;
    Ok(snapshot)
}

fn build_snapshot(id: String, session: &RepositorySession) -> Result<RepositorySnapshot, AppError> {
    let snapshot = RepositorySnapshot {
        id,
        data: snapshot_with_limits_fast(
            &session.path,
            session.history_limit.load(Ordering::Relaxed),
            session.status_limit.load(Ordering::Relaxed),
        )?,
    };
    session
        .history_cursor
        .lock()
        .map_err(state_error)?
        .reset(&session.path, &snapshot.data.commits)?;
    Ok(snapshot)
}

fn repository_session(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
) -> Result<Arc<RepositorySession>, AppError> {
    state
        .repositories
        .lock()
        .map_err(state_error)?
        .get(repo_id)
        .cloned()
        .ok_or_else(|| AppError {
            kind: "unknownRepository".into(),
            message: "This repository session has expired.".into(),
            hint: Some("Open the repository again.".into()),
        })
}

fn with_repository<T>(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
    action: impl FnOnce(&Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    action(&session.path)
}

async fn with_repository_background<T, F>(
    repo_id: String,
    app: AppHandle,
    action: F,
) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&Path) -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_repository(&repo_id, &state, action)
    })
    .await
    .map_err(background_task_error)?
}

async fn with_repository_background_read<T, F>(
    repo_id: String,
    app: AppHandle,
    action: F,
) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&Path) -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        action(&session.path)
    })
    .await
    .map_err(background_task_error)?
}

async fn mutate_and_refresh_background<F>(
    repo_id: String,
    app: AppHandle,
    action: F,
) -> Result<RepositorySnapshot, AppError>
where
    F: FnOnce(&Path) -> Result<(), AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mutate_and_refresh(&repo_id, &state, action)
    })
    .await
    .map_err(background_task_error)?
}

fn register_active_operation(
    app: &AppHandle,
    operation_id: String,
) -> Result<(CancellationToken, ActiveOperationGuard), AppError> {
    if operation_id.is_empty() || operation_id.len() > 128 {
        return Err(AppError {
            kind: "invalidOperationId".into(),
            message: "Git Khronos received an invalid operation identifier.".into(),
            hint: None,
        });
    }
    let registry = app.state::<AppState>().active_operations.clone();
    let cancellation = CancellationToken::default();
    let mut operations = registry.lock().map_err(state_error)?;
    if operations.contains_key(&operation_id) {
        return Err(AppError {
            kind: "duplicateOperationId".into(),
            message: "Git Khronos already has an operation with that identifier.".into(),
            hint: Some("Retry the operation.".into()),
        });
    }
    operations.insert(operation_id.clone(), cancellation.clone());
    drop(operations);
    Ok((
        cancellation,
        ActiveOperationGuard {
            registry,
            operation_id,
        },
    ))
}

async fn mutate_and_refresh_cancellable_background<F>(
    repo_id: String,
    operation_id: String,
    app: AppHandle,
    action: F,
) -> Result<RepositorySnapshot, AppError>
where
    F: FnOnce(&Path, &CancellationToken) -> Result<(), AppError> + Send + 'static,
{
    let (cancellation, _active_operation) = register_active_operation(&app, operation_id.clone())?;
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
            || action(&session.path, &cancellation),
        )?;
        build_snapshot(repo_id, &session)
    })
    .await
    .map_err(background_task_error)?
}

fn state_error<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError {
        kind: "internalState".into(),
        message: "Git Khronos could not access its repository registry.".into(),
        hint: Some("Restart the application and open the repository again.".into()),
    }
}

fn background_task_error(error: impl std::fmt::Display) -> AppError {
    AppError {
        kind: "backgroundTaskFailure".into(),
        message: format!("Git Khronos could not complete a repository task: {error}"),
        hint: Some("Try the operation again or reopen the repository.".into()),
    }
}

fn terminal_error(action: &str, error: impl std::fmt::Display) -> AppError {
    AppError {
        kind: "terminalFailure".into(),
        message: format!("Git Khronos could not {action}: {error}"),
        hint: Some("Close this terminal tab and open a new one.".into()),
    }
}

fn configure_terminal_command(command: &mut CommandBuilder, repository: &Path) {
    command.cwd(repository);
    for variable in git_khronos_git_core::GIT_CONTEXT_ENVIRONMENT_VARIABLES {
        command.env_remove(variable);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

fn stop_terminal_child(child: &mut (dyn Child + Send + Sync)) -> Result<(), AppError> {
    if child
        .try_wait()
        .map_err(|error| terminal_error("check the terminal process", error))?
        .is_some()
    {
        return Ok(());
    }
    if let Err(error) = child.kill() {
        // The shell may exit between the status check and the signal.
        if child.try_wait().ok().flatten().is_none() {
            return Err(terminal_error("stop the terminal", error));
        }
    }
    child
        .wait()
        .map_err(|error| terminal_error("reap the terminal process", error))?;
    Ok(())
}

#[derive(Clone, Copy, serde::Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
enum AgentProgram {
    Codex,
    Claude,
    Gemini,
    Opencode,
}

impl AgentProgram {
    fn executable(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Opencode => "opencode",
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn open_agent_terminal(
    repo_id: String,
    program: AgentProgram,
    rows: u16,
    cols: u16,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<TerminalInfo, AppError> {
    open_terminal_program(repo_id, rows, cols, Some(program), app, state)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn open_terminal(
    repo_id: String,
    rows: u16,
    cols: u16,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<TerminalInfo, AppError> {
    open_terminal_program(repo_id, rows, cols, None, app, state)
}

fn open_terminal_program(
    repo_id: String,
    rows: u16,
    cols: u16,
    program: Option<AgentProgram>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<TerminalInfo, AppError> {
    let repository = state
        .repositories
        .lock()
        .map_err(state_error)?
        .get(&repo_id)
        .cloned()
        .ok_or_else(|| AppError {
            kind: "unknownRepository".into(),
            message: "This repository session has expired.".into(),
            hint: Some("Open the repository again.".into()),
        })?;
    let shell = program.map(|agent| agent.executable().to_owned()).unwrap_or_else(default_shell);
    let label = Path::new(&shell)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| shell.clone());
    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| terminal_error("open a pseudo-terminal", error))?;
    let mut command = CommandBuilder::new(&shell);
    configure_terminal_command(&mut command, &repository.path);
    let terminal_io::Endpoints { mut reader, writer, cancelled } = terminal_io::connect(pair.master.as_ref())
        .map_err(|error| terminal_error("connect terminal I/O", error))?;
    // Finish fallible I/O setup and acquire registry ownership before spawning.
    // Otherwise an early return can leave an unregistered shell running.
    let mut terminals = state.terminals.lock().map_err(state_error)?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| terminal_error(&format!("start {label}; install and authenticate this program separately if needed"), error))?;
    drop(pair.slave);
    let id = format!(
        "terminal-{}",
        state.next_terminal_id.fetch_add(1, Ordering::Relaxed) + 1
    );
    let lifecycle = Arc::new(Mutex::new(TerminalLifecycle::default()));
    terminals.insert(
        id.clone(),
        TerminalSession {
            master: pair.master,
            writer: Arc::new(tauri::async_runtime::Mutex::new(writer)),
            cancelled,
            child: Arc::new(Mutex::new(child)),
            lifecycle: lifecycle.clone(),
        },
    );
    drop(terminals);
    let output_id = id.clone();
    std::thread::spawn(move || {
        let mut buffer = vec![0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
                Ok(length) => {
                    let _ = TerminalOutput {
                        session_id: output_id.clone(),
                        data: buffer[..length].to_vec(),
                    }
                    .emit(&app);
                }
            }
        }
        if let Err(error) = close_terminal_session(&app.state::<AppState>(), &output_id) {
            // EOF is not proof that the process was reaped. Retain the
            // handle for an explicit close retry and do not announce exit.
            let _ = TerminalOutput {
                session_id: output_id.clone(),
                data: format!(
                    "\r\nTerminal cleanup failed: {} Close this tab to retry.\r\n",
                    error.message,
                ).into_bytes(),
            }.emit(&app);
        }
        if let Ok(mut lifecycle) = lifecycle.lock() {
            lifecycle.reader_finished = true;
        }
        announce_terminal_exit(&app, &output_id, &lifecycle);
    });
    Ok(TerminalInfo {
        id,
        label,
        cwd: repository.path.to_string_lossy().into_owned(),
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn write_terminal(
    session_id: String,
    data: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    write_terminal_data(&state, &session_id, data).await
}

async fn write_terminal_data(
    state: &AppState,
    session_id: &str,
    data: Vec<u8>,
) -> Result<(), AppError> {
    let writer = state
        .terminals
        .lock()
        .map_err(state_error)?
        .get(session_id)
        .map(|terminal| terminal.writer.clone())
        .ok_or_else(|| AppError {
            kind: "unknownTerminal".into(),
            message: "That terminal session has ended.".into(),
            hint: Some("Open a new terminal tab.".into()),
        })?;
    // Only writes to the same PTY are serialized. Waiting for a busy writer is
    // asynchronous and never holds the registry or a blocking-pool thread.
    let mut writer = writer.lock_owned().await;
    tauri::async_runtime::spawn_blocking(move || {
        writer
            .write_all(&data)
            .and_then(|_| writer.flush())
            .map_err(|error| terminal_error("write to the terminal", error))
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
fn resize_terminal(
    session_id: String,
    rows: u16,
    cols: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let terminals = state.terminals.lock().map_err(state_error)?;
    let terminal = terminals.get(&session_id).ok_or_else(|| AppError {
        kind: "unknownTerminal".into(),
        message: "That terminal session has ended.".into(),
        hint: Some("Open a new terminal tab.".into()),
    })?;
    terminal
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| terminal_error("resize the terminal", error))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
async fn close_terminal(session_id: String, app: tauri::AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(lifecycle) = close_terminal_session(&app.state::<AppState>(), &session_id)? {
            announce_terminal_exit(&app, &session_id, &lifecycle);
        }
        Ok(())
    })
    .await
    .map_err(background_task_error)?
}

fn announce_terminal_exit(
    app: &tauri::AppHandle,
    session_id: &str,
    lifecycle: &Mutex<TerminalLifecycle>,
) {
    let announce = lifecycle.lock().is_ok_and(|mut lifecycle| lifecycle.claim_exit());
    if announce {
        let _ = TerminalExit {
            session_id: session_id.to_owned(),
        }.emit(app);
    }
}

fn close_terminal_session(
    state: &AppState,
    session_id: &str,
) -> Result<Option<Arc<Mutex<TerminalLifecycle>>>, AppError> {
    let Some((child, cancelled, lifecycle)) = state
        .terminals
        .lock()
        .map_err(state_error)?
        .get(session_id)
        .map(|terminal| (
            terminal.child.clone(),
            terminal.cancelled.clone(),
            terminal.lifecycle.clone(),
        ))
    else {
        return Ok(None);
    };
    cancelled.store(true, Ordering::Release);
    // Never hold the global registry while signalling or waiting. EOF cleanup
    // and explicit close may race; only this session's process is serialized.
    stop_terminal_child(child.lock().map_err(state_error)?.as_mut())?;
    lifecycle.lock().map_err(state_error)?.reaped = true;
    let mut terminals = state.terminals.lock().map_err(state_error)?;
    let owns_entry = terminals
        .get(session_id)
        .is_some_and(|terminal| Arc::ptr_eq(&terminal.child, &child));
    if owns_entry {
        terminals.remove(session_id);
    }
    Ok(Some(lifecycle))
}

#[cfg(unix)]
fn default_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| Path::new(shell).is_file())
        .unwrap_or_else(|| "/bin/sh".into())
}

fn open_path_in_file_manager(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "linux")]
    let child = Command::new("xdg-open").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let child = Command::new("open").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let child = Command::new("explorer.exe").arg(path).spawn();
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    return Err(AppError {
        kind: "fileManagerUnsupported".into(),
        message: "Opening the system file manager is not supported on this platform.".into(),
        hint: None,
    });

    child.map(|_| ()).map_err(|_| AppError {
        kind: "fileManagerUnavailable".into(),
        message: "The repository folder could not be opened.".into(),
        hint: Some("Check that a system file manager is installed and available.".into()),
    })
}

#[cfg(windows)]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bindings = ipc_registry();
    tauri::Builder::default()
        .manage(authentication::AuthenticationState::default())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(bindings.invoke_handler())
        .setup(move |app| {
            bindings.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Git Khronos could not start");
}

pub fn ipc_registry() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .events(tauri_specta::collect_events![
            RepositoryChanged,
            TerminalOutput,
            TerminalExit,
            authentication::GitAuthenticationPrompt,
            authentication::GitAuthenticationDismissed
        ])
        .commands(tauri_specta::collect_commands![
            authentication::answer_authentication,
            authentication::pending_authentication,
            system_info,
            cancel_git_operation,
            open_repository,
            clone_repository,
            initialize_repository,
            refresh_repository,
            refresh_repository_status,
            diagnose_signing,
            load_more_commits,
            search_tracked_files,
            load_reflog,
            load_more_changes,
            open_repository_in_file_manager,
            open_external_url,
            toggle_fullscreen,
            stage_all,
            unstage_all,
            stage_path,
            unstage_path,
            discard_path,
            reference_commands::manage_reference,
            reference_commands::configure_remote,
            reference_commands::transport_reference,
            reference_commands::preview_remote_tag,
            stash_commands::stash_selected,
            stash_commands::apply_stash_options,
            stash_commands::branch_from_stash,
            stash_commands::stash_checkout,
            preview_discard,
            discard_changes,
            load_discard_recoveries,
            apply_saved_discard,
            forget_saved_discard,
            ignore_path,
            commit_changes,
            update_head_message,
            checkout_branch,
            checkout_remote_branch,
            create_branch,
            create_branch_at,
            create_worktree,
            create_worktree_for_branch,
            set_worktree_locked,
            remove_worktree,
            move_worktree,
            repair_worktree,
            worktree_registration_review,
            prune_worktree_registration,
            submodule_state_review,
            sync_submodule_url,
            set_submodule_tracking_branch,
            checkout_recorded_submodule_commit,
            deinit_submodule,
            remove_submodule,
            inspect_repository_integrity,
            add_submodule,
            initialize_submodule,
            initialize_all_submodules,
            update_submodule,
            update_all_submodules,
            checkout_commit,
            rename_branch,
            set_branch_upstream,
            delete_branch,
            integrate_branch,
            continue_merge,
            abort_merge,
            prepare_interactive_rebase,
            execute_interactive_rebase,
            continue_rebase,
            begin_rebase_split,
            preview_merge,
            load_hosting_page,
            load_hosted_review,
            prepare_merge_rebase,
            execute_merge_rebase,
            export_diff_patch,
            review_diff_patch,
            import_diff_patch,
            export_git_bundle,
            review_git_bundle,
            import_git_bundle,
            review_mail_patch_export,
            export_mail_patch,
            review_mail_patch_import,
            import_mail_patch,
            control_mail_patch,
            skip_rebase,
            abort_rebase,
            fetch_repository,
            fetch_branches,
            shallow_history_state,
            perform_repository_maintenance,
            sync_repository,
            lfs_pull,
            lfs_prune,
            lfs_prune_preview,
            lfs_prune_objects,
            lfs_initialize,
            lfs_track_pattern,
            lfs_tracking_rules,
            lfs_file_attributes,
            lfs_objects,
            lfs_locks,
            lfs_lock_file,
            lfs_unlock_file,
            lfs_fetch_preview,
            lfs_fetch_object,
            lfs_checkout_preview,
            lfs_checkout_object,
            lfs_untrack_pattern,
            sparse_checkout_set,
            sparse_checkout_reapply,
            sparse_checkout_disable,
            pull_repository,
            push_repository,
            force_push_repository,
            publish_branch,
            add_remote,
            set_remote_url,
            set_repository_identity,
            remove_remote,
            stash_changes,
            pop_stash,
            apply_stash,
            pop_stash_entry,
            drop_stash,
            rename_stash,
            create_tag,
            cherry_pick_commits,
            revert_commit,
            control_history_operation,
            reset_to_commit,
            recovery_commands::preview_reset,
            recovery_commands::execute_prepared_reset,
            recovery_commands::load_operation_recoveries,
            recovery_commands::restore_operation_recovery,
            recovery_commands::forget_operation_recovery,
            start_bisect,
            mark_bisect,
            reset_bisect,
            move_head,
            inspect_commit,
            inspect_tag,
            inspect_commit_file,
            inspect_stash,
            inspect_stash_file,
            compare_commits,
            compare_commit_file,
            compare_commit_with_working_tree,
            compare_commit_file_with_working_tree,
            inspect_working_tree_file,
            inspect_file_history,
            search_repository_history,
            inspect_file_history_page,
            inspect_blame_navigation,
            inspect_history_commit,
            compare_history_revisions,
            inspect_file_blame,
            inspect_file_blame_page,
            restore_files_from_commit,
            inspect_conflict,
            resolve_conflict,
            apply_working_tree_hunk,
            apply_working_tree_lines,
            undo_discard,
            redo_discard,
            open_terminal,
            open_agent_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
        ])
}

#[cfg(all(test, unix))]
mod tests {
    use super::{repository_watch_paths, validate_external_url};
    use notify::{EventKind, RecursiveMode, Watcher};
    use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
    use std::fs;
    use std::io::Read;
    use std::path::Path;
    use std::process::Command;
    use std::sync::mpsc;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn external_links_require_bounded_https_urls() {
        assert!(validate_external_url("https://github.com/example/git-khronos/pulls").is_ok());
        for invalid in [
            "http://github.com/example/git-khronos/pulls",
            "file:///tmp/git-khronos",
            "javascript:alert(1)",
            "https://github.com/example\n/git-khronos",
        ] {
            assert_eq!(
                validate_external_url(invalid)
                    .expect_err("reject unsafe external URL")
                    .kind,
                "invalidExternalUrl"
            );
        }
        assert!(
            validate_external_url(&format!("https://example.test/{}", "a".repeat(2_049))).is_err()
        );
    }

    #[test]
    fn pseudo_terminal_starts_in_the_requested_repository() {
        let expected = Path::new(env!("CARGO_MANIFEST_DIR"));
        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open test pseudo-terminal");
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "printf '%s\\n' \"$PWD\""]);
        super::configure_terminal_command(&mut command, expected);
        let mut child = pair
            .slave
            .spawn_command(command)
            .expect("spawn shell in test pseudo-terminal");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("clone PTY reader");
        let mut output = Vec::new();
        let mut buffer = [0_u8; 256];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => output.extend_from_slice(&buffer[..length]),
            }
        }
        child.wait().expect("wait for test shell");
        assert!(
            String::from_utf8_lossy(&output).contains(&expected.to_string_lossy().to_string()),
            "PTY output did not contain its requested cwd: {}",
            String::from_utf8_lossy(&output),
        );
    }

    #[test]
    fn terminal_context_clears_git_overrides_but_preserves_user_configuration() {
        let mut command = CommandBuilder::new("/bin/sh");
        for variable in git_khronos_git_core::GIT_CONTEXT_ENVIRONMENT_VARIABLES {
            command.env(variable, "inherited override");
        }
        for (variable, value) in [
            ("PATH", "/owned/test/bin"),
            ("SSH_AUTH_SOCK", "/owned/test/agent"),
            ("GIT_CONFIG_GLOBAL", "/owned/test/gitconfig"),
        ] {
            command.env(variable, value);
        }
        super::configure_terminal_command(&mut command, Path::new(env!("CARGO_MANIFEST_DIR")));
        for variable in git_khronos_git_core::GIT_CONTEXT_ENVIRONMENT_VARIABLES {
            assert!(
                command.get_env(variable).is_none(),
                "Inherited {variable} survived terminal startup"
            );
        }
        for (variable, value) in [
            ("PATH", "/owned/test/bin"),
            ("SSH_AUTH_SOCK", "/owned/test/agent"),
            ("GIT_CONFIG_GLOBAL", "/owned/test/gitconfig"),
            ("TERM", "xterm-256color"),
            ("COLORTERM", "truecolor"),
        ] {
            assert_eq!(command.get_env(variable), Some(std::ffi::OsStr::new(value)));
        }
    }

    #[test]
    fn stopping_a_terminal_reaps_the_owned_child_and_is_idempotent() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exec sleep 30"])
            .spawn()
            .expect("spawn owned terminal process");
        let pid = child.id();
        super::stop_terminal_child(&mut child).expect("terminate and reap owned child");
        assert!(child.try_wait().unwrap().is_some());
        super::stop_terminal_child(&mut child).expect("already exited child is harmless");
        #[cfg(target_os = "linux")]
        assert!(
            !Path::new(&format!("/proc/{pid}/stat")).exists(),
            "Terminal process was not reaped"
        );
        #[cfg(not(target_os = "linux"))]
        let _ = pid;
    }

    #[test]
    fn blocked_terminal_input_does_not_hold_the_shared_registry() {
        use std::io::Write;
        use std::sync::{Arc, Condvar, Mutex};
        struct BlockedWriter {
            entered: mpsc::Sender<()>,
            release: Arc<(Mutex<bool>, Condvar)>,
        }
        impl Write for BlockedWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.entered.send(()).unwrap();
                let (lock, ready) = &*self.release;
                let mut released = lock.lock().unwrap();
                while !*released {
                    released = ready.wait(released).unwrap();
                }
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let state = Arc::new(super::AppState::default());
        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "exec sleep 30"]);
        let child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let (entered, observed) = mpsc::channel();
        state.terminals.lock().unwrap().insert(
            "blocked".into(),
            super::TerminalSession {
                master: pair.master,
                child: Arc::new(Mutex::new(child)),
                lifecycle: Arc::default(),
                cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                writer: Arc::new(tauri::async_runtime::Mutex::new(Box::new(BlockedWriter {
                    entered,
                    release: release.clone(),
                }))),
            },
        );
        let writer_state = state.clone();
        let worker = std::thread::spawn(move || {
            tauri::async_runtime::block_on(super::write_terminal_data(
                &writer_state, "blocked", b"paste".to_vec(),
            ))
        });
        let started = observed.recv_timeout(Duration::from_secs(5)).is_ok();
        let controls_available = state.terminals.try_lock().is_ok();
        // Release and reap the owned fixture before asserting, including on red.
        *release.0.lock().unwrap() = true;
        release.1.notify_all();
        let written = worker.join().unwrap();
        let terminal = state.terminals.lock().unwrap().remove("blocked").unwrap();
        super::stop_terminal_child(terminal.child.lock().unwrap().as_mut()).unwrap();
        assert!(
            started,
            "Owned writer did not reach its controlled blocking point"
        );
        written.unwrap();
        assert!(
            controls_available,
            "Blocked input held the shared terminal registry"
        );
    }

    #[test]
    fn metadata_watcher_observes_git_updates() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("read clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("git-khronos-watch-{}-{unique}", std::process::id()));
        fs::create_dir_all(&root).expect("create watcher fixture");
        let initialized = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["init", "-b", "main"])
            .output()
            .expect("initialize watcher repository");
        assert!(initialized.status.success());

        let metadata_paths = repository_watch_paths(&root).expect("locate watcher metadata");
        assert!(
            metadata_paths
                .recursive
                .iter()
                .all(|path| path.file_name().is_none_or(|name| name != "objects")),
            "object databases must never be watched recursively"
        );
        let (sender, receiver) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(sender).expect("create metadata watcher");
        for path in &metadata_paths.non_recursive {
            watcher
                .watch(path, RecursiveMode::NonRecursive)
                .expect("watch metadata root");
        }
        for path in &metadata_paths.recursive {
            watcher
                .watch(path, RecursiveMode::Recursive)
                .expect("watch mutable metadata tree");
        }

        let configured = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["config", "git-khronos.watcher-test", "changed"])
            .output()
            .expect("change Git metadata");
        assert!(configured.status.success());

        let deadline = Instant::now() + Duration::from_secs(5);
        let observed = loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break false;
            }
            match receiver.recv_timeout(remaining) {
                Ok(Ok(event))
                    if !matches!(event.kind, EventKind::Access(_))
                        && event.paths.iter().any(|path| {
                            metadata_paths
                                .non_recursive
                                .iter()
                                .chain(metadata_paths.recursive.iter())
                                .any(|metadata| path.starts_with(metadata))
                        }) =>
                {
                    break true;
                }
                Ok(_) => continue,
                Err(_) => break false,
            }
        };
        assert!(observed, "Git metadata change should emit a watcher event");

        drop(watcher);
        fs::remove_dir_all(root).expect("remove watcher fixture");
    }
}
