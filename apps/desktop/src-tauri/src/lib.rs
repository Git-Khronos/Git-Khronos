use git_chronos_git_core::{
    AppError, CancellationToken, CommitComparison, CommitDetails, CommitFileDiff,
    CommitHistoryCursor, CommitHistoryPage, ConflictDetails, FileBlameLine, FileHistoryEntry,
    InteractiveRebasePlan, InteractiveRebaseStep, MINIMUM_GIT_VERSION, ReflogPage, RepositoryData,
    RepositoryStatus, SigningDiagnostic, TagDetails, TrackedFileSearch, WorkingTreeFileDiff,
    abort_merge as git_abort_merge, abort_rebase as git_abort_rebase, add_remote as git_add_remote,
    add_submodule as git_add_submodule, apply_stash as git_apply_stash,
    apply_working_tree_hunk as git_apply_working_tree_hunk,
    apply_working_tree_lines as git_apply_working_tree_lines,
    apply_working_tree_recovery as git_apply_working_tree_recovery,
    checkout_branch as git_checkout_branch, checkout_commit as git_checkout_commit,
    checkout_remote_branch as git_checkout_remote_branch,
    cherry_pick_commits as git_cherry_pick_commits, clone_repository as git_clone_repository,
    commit_details as git_commit_details, commit_file_diff as git_commit_file_diff,
    commit_with_options as git_commit, compare_commit_file as git_compare_commit_file,
    compare_commit_file_with_working_tree as git_compare_commit_file_with_working_tree,
    compare_commit_with_working_tree as git_compare_commit_with_working_tree,
    compare_commits as git_compare_commits, conflict_details as git_conflict_details,
    continue_merge as git_continue_merge, continue_rebase as git_continue_rebase,
    control_history_operation as git_control_history_operation, create_branch as git_create_branch,
    create_branch_at as git_create_branch_at, create_tag as git_create_tag,
    create_worktree as git_create_worktree,
    create_worktree_for_branch as git_create_worktree_for_branch,
    delete_branch as git_delete_branch, detect_git,
    disable_sparse_checkout as git_disable_sparse_checkout, discard_path as git_discard_path,
    drop_stash as git_drop_stash, execute_interactive_rebase as git_execute_interactive_rebase,
    fetch_cancellable as git_fetch_cancellable, fetch_if_needed as git_fetch_if_needed,
    fetch_remote_cancellable as git_fetch_remote_cancellable, file_blame as git_file_blame,
    file_history as git_file_history, ignore_path as git_ignore_path,
    initialize_lfs as git_initialize_lfs, initialize_repository as git_initialize_repository,
    initialize_submodule as git_initialize_submodule, integrate_branch as git_integrate_branch,
    mark_bisect as git_mark_bisect, move_head_if_current as git_move_head,
    perform_repository_maintenance as git_perform_repository_maintenance,
    pop_stash as git_pop_stash, pop_stash_entry as git_pop_stash_entry,
    prepare_interactive_rebase as git_prepare_interactive_rebase,
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
    resolve_conflict as git_resolve_conflict, resolve_repository,
    restore_files_from_commit as git_restore_files_from_commit, revert_commit as git_revert_commit,
    search_tracked_files as git_search_tracked_files,
    set_branch_upstream as git_set_branch_upstream, set_remote_url as git_set_remote_url,
    set_repository_identity as git_set_repository_identity,
    set_sparse_checkout as git_set_sparse_checkout, set_worktree_locked as git_set_worktree_locked,
    signing_diagnostic as git_signing_diagnostic, skip_rebase as git_skip_rebase,
    snapshot_with_limits_fast, snapshot_with_limits_startup, stage_all as git_stage_all,
    stage_path as git_stage_path, start_bisect as git_start_bisect,
    stash_details as git_stash_details, stash_file_diff as git_stash_file_diff,
    stash_with_message as git_stash, status_with_entry_limit, status_with_entry_limit_fast,
    tag_details as git_tag_details, track_lfs_pattern as git_track_lfs_pattern,
    unstage_all as git_unstage_all, unstage_path as git_unstage_path,
    update_head_message as git_update_head_message,
    update_submodule_cancellable as git_update_submodule_cancellable,
    working_tree_file_diff as git_working_tree_file_diff,
    working_tree_file_recovery_patch as git_working_tree_file_recovery_patch,
    working_tree_hunk_recovery_patch as git_working_tree_hunk_recovery_patch,
    working_tree_lines_recovery_patch as git_working_tree_lines_recovery_patch,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
struct AppState {
    repositories: Mutex<HashMap<String, Arc<RepositorySession>>>,
    repository_watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    discard_recoveries: Mutex<HashMap<String, DiscardRecovery>>,
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
    patch_path: PathBuf,
    undone: bool,
}

impl Drop for DiscardRecovery {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.patch_path);
    }
}

#[derive(Clone, Serialize)]
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
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInfo {
    id: String,
    label: String,
    cwd: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    app_version: &'static str,
    git_version: Option<String>,
    git_supported: bool,
    minimum_git_version: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositorySnapshot {
    id: String,
    #[serde(flatten)]
    data: RepositoryData,
}

#[tauri::command]
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
async fn open_repository(path: String, app: AppHandle) -> Result<RepositorySnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve_repository(Path::new(&path))?;
        let state = app.state::<AppState>();
        register_repository(root, &state, &app)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
fn clone_repository(
    remote: String,
    parent_path: String,
    folder: String,
    branch: Option<String>,
    depth: Option<u32>,
    state: tauri::State<'_, AppState>,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    let root = git_clone_repository(
        &remote,
        Path::new(&parent_path),
        &folder,
        branch.as_deref(),
        depth,
    )?;
    register_repository(root, &state, &app)
}

#[tauri::command(rename_all = "camelCase")]
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
            let _ = event_app.emit(
                "repository-changed",
                RepositoryChanged {
                    repository_id: event_repository_id.clone(),
                },
            );
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
async fn diagnose_signing(repo_id: String, app: AppHandle) -> Result<SigningDiagnostic, AppError> {
    with_repository_background_read(repo_id, app, git_signing_diagnostic).await
}

#[tauri::command(rename_all = "camelCase")]
async fn load_more_commits(repo_id: String, app: AppHandle) -> Result<CommitHistoryPage, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        session
            .history_cursor
            .lock()
            .map_err(state_error)?
            .next_page(&session.path, HISTORY_PAGE_SIZE)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
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
fn open_repository_in_file_manager(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let session = repository_session(&repo_id, &state)?;
    open_path_in_file_manager(&session.path)
}

#[tauri::command]
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
fn stage_all(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_stage_all)
}

#[tauri::command(rename_all = "camelCase")]
fn unstage_all(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_unstage_all)
}

#[tauri::command(rename_all = "camelCase")]
fn stage_path(
    repo_id: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_stage_path(repository, &path)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn unstage_path(
    repo_id: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_unstage_path(repository, &path)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn discard_path(
    repo_id: String,
    path: String,
    untracked: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_with_discard_recovery(
        &repo_id,
        &state,
        |repository| git_working_tree_file_recovery_patch(repository, &path, untracked),
        |repository| git_discard_path(repository, &path, untracked),
    )
}

#[tauri::command(rename_all = "camelCase")]
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
fn commit_changes(
    repo_id: String,
    message: String,
    amend: bool,
    skip_hooks: bool,
    sign: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_commit(path, &message, amend, skip_hooks, Some(sign))
    })
}

#[tauri::command(rename_all = "camelCase")]
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
fn checkout_branch(
    repo_id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_checkout_branch(path, &name))
}

#[tauri::command(rename_all = "camelCase")]
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
fn create_branch(
    repo_id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_create_branch(path, &name))
}

#[tauri::command(rename_all = "camelCase")]
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
fn add_submodule(
    repo_id: String,
    url: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_add_submodule(repository, &url, &path)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn initialize_submodule(
    repo_id: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_initialize_submodule(repository, &path)
    })
}

#[tauri::command(rename_all = "camelCase")]
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
fn checkout_commit(
    repo_id: String,
    oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_checkout_commit(path, &oid))
}

#[tauri::command(rename_all = "camelCase")]
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
fn continue_merge(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_continue_merge)
}

#[tauri::command(rename_all = "camelCase")]
fn abort_merge(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_abort_merge)
}

#[tauri::command(rename_all = "camelCase")]
fn prepare_interactive_rebase(
    repo_id: String,
    source: String,
    target: String,
    state: tauri::State<'_, AppState>,
) -> Result<InteractiveRebasePlan, AppError> {
    with_repository(&repo_id, &state, |path| {
        git_prepare_interactive_rebase(path, &source, &target)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn execute_interactive_rebase(
    repo_id: String,
    source: String,
    target: String,
    steps: Vec<InteractiveRebaseStep>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_execute_interactive_rebase(path, &source, &target, &steps)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn continue_rebase(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_continue_rebase)
}

#[tauri::command(rename_all = "camelCase")]
fn skip_rebase(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_skip_rebase)
}

#[tauri::command(rename_all = "camelCase")]
fn abort_rebase(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_abort_rebase)
}

#[tauri::command(rename_all = "camelCase")]
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
async fn perform_repository_maintenance(repo_id: String, app: AppHandle) -> Result<(), AppError> {
    with_repository_background(repo_id, app, git_perform_repository_maintenance).await
}

#[tauri::command(rename_all = "camelCase")]
async fn sync_repository(
    repo_id: String,
    app: AppHandle,
) -> Result<Option<RepositorySnapshot>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        if !git_fetch_if_needed(&session.path)? {
            return Ok(None);
        }
        build_snapshot(repo_id, &session).map(Some)
    })
    .await
    .map_err(background_task_error)?
}

#[tauri::command(rename_all = "camelCase")]
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
async fn lfs_initialize(repo_id: String, app: AppHandle) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, git_initialize_lfs).await
}

#[tauri::command(rename_all = "camelCase")]
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
async fn sparse_checkout_reapply(
    repo_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, git_reapply_sparse_checkout).await
}

#[tauri::command(rename_all = "camelCase")]
async fn sparse_checkout_disable(
    repo_id: String,
    app: AppHandle,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh_background(repo_id, app, git_disable_sparse_checkout).await
}

#[tauri::command(rename_all = "camelCase")]
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
fn add_remote(
    repo_id: String,
    name: String,
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_add_remote(path, &name, &url))
}

#[tauri::command(rename_all = "camelCase")]
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
fn remove_remote(
    repo_id: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_remove_remote(path, &name))
}

#[tauri::command(rename_all = "camelCase")]
fn stash_changes(
    repo_id: String,
    message: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_stash(path, message.as_deref()))
}

#[tauri::command(rename_all = "camelCase")]
fn pop_stash(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_pop_stash)
}

#[tauri::command(rename_all = "camelCase")]
fn apply_stash(
    repo_id: String,
    reference: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_apply_stash(path, &reference))
}

#[tauri::command(rename_all = "camelCase")]
fn pop_stash_entry(
    repo_id: String,
    reference: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_pop_stash_entry(path, &reference)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn drop_stash(
    repo_id: String,
    reference: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_drop_stash(path, &reference))
}

#[tauri::command(rename_all = "camelCase")]
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
fn cherry_pick_commits(
    repo_id: String,
    oids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| {
        git_cherry_pick_commits(path, &oids)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn revert_commit(
    repo_id: String,
    oid: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_revert_commit(path, &oid))
}

#[tauri::command(rename_all = "camelCase")]
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
fn mark_bisect(
    repo_id: String,
    verdict: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |path| git_mark_bisect(path, &verdict))
}

#[tauri::command(rename_all = "camelCase")]
fn reset_bisect(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, git_reset_bisect)
}

#[tauri::command(rename_all = "camelCase")]
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
async fn inspect_commit(
    repo_id: String,
    oid: String,
    app: AppHandle,
) -> Result<CommitDetails, AppError> {
    with_repository_background_read(repo_id, app, move |path| git_commit_details(path, &oid)).await
}

#[tauri::command(rename_all = "camelCase")]
async fn inspect_tag(
    repo_id: String,
    name: String,
    app: AppHandle,
) -> Result<TagDetails, AppError> {
    with_repository_background_read(repo_id, app, move |path| git_tag_details(path, &name)).await
}

#[tauri::command(rename_all = "camelCase")]
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
fn inspect_stash(
    repo_id: String,
    reference: String,
    state: tauri::State<'_, AppState>,
) -> Result<CommitDetails, AppError> {
    with_repository(&repo_id, &state, |path| git_stash_details(path, &reference))
}

#[tauri::command(rename_all = "camelCase")]
fn inspect_stash_file(
    repo_id: String,
    reference: String,
    path: String,
    previous_path: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<CommitFileDiff, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_stash_file_diff(repository, &reference, &path, previous_path.as_deref())
    })
}

#[tauri::command(rename_all = "camelCase")]
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
fn inspect_file_history(
    repo_id: String,
    revision: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<FileHistoryEntry>, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_file_history(repository, &revision, &path)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn inspect_file_blame(
    repo_id: String,
    revision: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<FileBlameLine>, AppError> {
    with_repository(&repo_id, &state, |repository| {
        git_file_blame(repository, &revision, &path)
    })
}

#[tauri::command(rename_all = "camelCase")]
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
fn resolve_conflict(
    repo_id: String,
    path: String,
    resolution: String,
    output: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_resolve_conflict(repository, &path, &resolution, output.as_deref())
    })
}

#[tauri::command(rename_all = "camelCase")]
fn apply_working_tree_hunk(
    repo_id: String,
    path: String,
    staged: bool,
    hunk_index: usize,
    action: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    if action == "discard" {
        return mutate_with_discard_recovery(
            &repo_id,
            &state,
            |repository| git_working_tree_hunk_recovery_patch(repository, &path, hunk_index),
            |repository| {
                git_apply_working_tree_hunk(repository, &path, staged, hunk_index, &action)
            },
        );
    }
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_apply_working_tree_hunk(repository, &path, staged, hunk_index, &action)
    })
}

#[tauri::command(rename_all = "camelCase")]
fn apply_working_tree_lines(
    repo_id: String,
    path: String,
    staged: bool,
    hunk_index: usize,
    line_indices: Vec<usize>,
    action: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    if action == "discard" {
        return mutate_with_discard_recovery(
            &repo_id,
            &state,
            |repository| {
                git_working_tree_lines_recovery_patch(repository, &path, hunk_index, &line_indices)
            },
            |repository| {
                git_apply_working_tree_lines(
                    repository,
                    &path,
                    staged,
                    hunk_index,
                    &line_indices,
                    &action,
                )
            },
        );
    }
    mutate_and_refresh(&repo_id, &state, |repository| {
        git_apply_working_tree_lines(
            repository,
            &path,
            staged,
            hunk_index,
            &line_indices,
            &action,
        )
    })
}

#[tauri::command(rename_all = "camelCase")]
fn undo_discard(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    apply_discard_recovery(&repo_id, &state, false)
}

#[tauri::command(rename_all = "camelCase")]
fn redo_discard(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RepositorySnapshot, AppError> {
    apply_discard_recovery(&repo_id, &state, true)
}

fn mutate_with_discard_recovery(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
    prepare: impl FnOnce(&Path) -> Result<Vec<u8>, AppError>,
    mutation: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<RepositorySnapshot, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    let patch = prepare(&session.path)?;
    let patch_path = write_discard_recovery_patch(state, repo_id, &patch)?;
    if let Err(error) = mutation(&session.path) {
        let _ = fs::remove_file(&patch_path);
        return Err(error);
    }
    let mut recoveries = state.discard_recoveries.lock().map_err(state_error)?;
    if let Some(previous) = recoveries.insert(
        repo_id.to_owned(),
        DiscardRecovery {
            patch_path,
            undone: false,
        },
    ) {
        let _ = fs::remove_file(&previous.patch_path);
    }
    drop(recoveries);
    build_snapshot(repo_id.to_owned(), &session)
}

fn apply_discard_recovery(
    repo_id: &str,
    state: &tauri::State<'_, AppState>,
    reverse: bool,
) -> Result<RepositorySnapshot, AppError> {
    let session = repository_session(repo_id, state)?;
    let _operation = session.operation.lock().map_err(state_error)?;
    let patch_path = {
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
        recovery.patch_path.clone()
    };
    git_apply_working_tree_recovery(&session.path, &patch_path, reverse)?;
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

fn write_discard_recovery_patch(
    state: &tauri::State<'_, AppState>,
    repo_id: &str,
    patch: &[u8],
) -> Result<PathBuf, AppError> {
    let directory = std::env::temp_dir().join("git-chronos-discard-recovery");
    fs::create_dir_all(&directory).map_err(|error| AppError {
        kind: "discardRecoveryUnavailable".into(),
        message: format!("Could not prepare discard recovery storage: {error}"),
        hint: Some("Check that the temporary directory is writable.".into()),
    })?;
    let sequence = state.next_id.fetch_add(1, Ordering::Relaxed);
    let safe_repo_id = repo_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let path = directory.join(format!(
        "{}-{safe_repo_id}-{sequence}.patch",
        std::process::id()
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|error| AppError {
        kind: "discardRecoveryUnavailable".into(),
        message: format!("Could not create the discard recovery patch: {error}"),
        hint: Some("Check that the temporary directory is writable.".into()),
    })?;
    if let Err(error) = file.write_all(patch) {
        let _ = fs::remove_file(&path);
        return Err(AppError {
            kind: "discardRecoveryUnavailable".into(),
            message: format!("Could not save the discard recovery patch: {error}"),
            hint: Some("No changes were discarded.".into()),
        });
    }
    Ok(path)
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
            message: "Git Chronos received an invalid operation identifier.".into(),
            hint: None,
        });
    }
    let registry = app.state::<AppState>().active_operations.clone();
    let cancellation = CancellationToken::default();
    let mut operations = registry.lock().map_err(state_error)?;
    if operations.contains_key(&operation_id) {
        return Err(AppError {
            kind: "duplicateOperationId".into(),
            message: "Git Chronos already has an operation with that identifier.".into(),
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
    let (cancellation, _active_operation) = register_active_operation(&app, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let _operation = session.operation.lock().map_err(state_error)?;
        action(&session.path, &cancellation)?;
        build_snapshot(repo_id, &session)
    })
    .await
    .map_err(background_task_error)?
}

fn state_error<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError {
        kind: "internalState".into(),
        message: "Git Chronos could not access its repository registry.".into(),
        hint: Some("Restart the application and open the repository again.".into()),
    }
}

fn background_task_error(error: impl std::fmt::Display) -> AppError {
    AppError {
        kind: "backgroundTaskFailure".into(),
        message: format!("Git Chronos could not complete a repository task: {error}"),
        hint: Some("Try the operation again or reopen the repository.".into()),
    }
}

fn terminal_error(action: &str, error: impl std::fmt::Display) -> AppError {
    AppError {
        kind: "terminalFailure".into(),
        message: format!("Git Chronos could not {action}: {error}"),
        hint: Some("Close this terminal tab and open a new one.".into()),
    }
}

#[tauri::command(rename_all = "camelCase")]
fn open_terminal(
    repo_id: String,
    rows: u16,
    cols: u16,
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
    let shell = default_shell();
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
    command.cwd(&repository.path);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| terminal_error("start the default shell", error))?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| terminal_error("connect terminal output", error))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| terminal_error("connect terminal input", error))?;
    let id = format!(
        "terminal-{}",
        state.next_terminal_id.fetch_add(1, Ordering::Relaxed) + 1
    );
    state.terminals.lock().map_err(state_error)?.insert(
        id.clone(),
        TerminalSession {
            master: pair.master,
            writer,
            child,
        },
    );
    let output_id = id.clone();
    std::thread::spawn(move || {
        let mut buffer = vec![0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    let _ = app.emit(
                        "terminal-output",
                        TerminalOutput {
                            session_id: output_id.clone(),
                            data: buffer[..length].to_vec(),
                        },
                    );
                }
            }
        }
        let _ = app.emit(
            "terminal-exit",
            TerminalExit {
                session_id: output_id.clone(),
            },
        );
        if let Ok(mut terminals) = app.state::<AppState>().terminals.lock() {
            terminals.remove(&output_id);
        }
    });
    Ok(TerminalInfo {
        id,
        label,
        cwd: repository.path.to_string_lossy().into_owned(),
    })
}

#[tauri::command(rename_all = "camelCase")]
fn write_terminal(
    session_id: String,
    data: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let mut terminals = state.terminals.lock().map_err(state_error)?;
    let terminal = terminals.get_mut(&session_id).ok_or_else(|| AppError {
        kind: "unknownTerminal".into(),
        message: "That terminal session has ended.".into(),
        hint: Some("Open a new terminal tab.".into()),
    })?;
    terminal
        .writer
        .write_all(&data)
        .and_then(|_| terminal.writer.flush())
        .map_err(|error| terminal_error("write to the terminal", error))
}

#[tauri::command(rename_all = "camelCase")]
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
fn close_terminal(session_id: String, state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    let Some(mut terminal) = state
        .terminals
        .lock()
        .map_err(state_error)?
        .remove(&session_id)
    else {
        return Ok(());
    };
    terminal
        .child
        .kill()
        .map_err(|error| terminal_error("stop the terminal", error))
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
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
            add_submodule,
            initialize_submodule,
            update_submodule,
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
            skip_rebase,
            abort_rebase,
            fetch_repository,
            perform_repository_maintenance,
            sync_repository,
            lfs_pull,
            lfs_prune,
            lfs_initialize,
            lfs_track_pattern,
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
            inspect_file_blame,
            restore_files_from_commit,
            inspect_conflict,
            resolve_conflict,
            apply_working_tree_hunk,
            apply_working_tree_lines,
            undo_discard,
            redo_discard,
            open_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("Git Chronos could not start");
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
        assert!(validate_external_url("https://github.com/example/git-chronos/pulls").is_ok());
        for invalid in [
            "http://github.com/example/git-chronos/pulls",
            "file:///tmp/git-chronos",
            "javascript:alert(1)",
            "https://github.com/example\n/git-chronos",
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
        command.cwd(expected);
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
    fn metadata_watcher_observes_git_updates() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("read clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("git-chronos-watch-{}-{unique}", std::process::id()));
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
            .args(["config", "git-chronos.watcher-test", "changed"])
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
