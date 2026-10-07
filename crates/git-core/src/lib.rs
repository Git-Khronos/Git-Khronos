use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Component;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

mod history_walk;

pub const MINIMUM_GIT_VERSION: &str = "2.34.0";
const EMPTY_TREE_OID: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_REFLOG_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_TAG_DETAILS_OUTPUT_BYTES: usize = 64 * 1024;

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemGitInfo {
    pub version: Option<String>,
    pub supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryData {
    pub name: String,
    pub path: String,
    pub identity: GitIdentity,
    pub signing: SigningInfo,
    pub head_oid: Option<String>,
    pub status: RepositoryStatus,
    pub remotes: Vec<Remote>,
    pub branches: Vec<Branch>,
    pub stashes: Vec<StashEntry>,
    pub tags: Vec<Tag>,
    pub worktrees: Vec<Worktree>,
    pub submodules: Vec<Submodule>,
    pub lfs: LfsInfo,
    pub sparse_checkout: SparseCheckoutInfo,
    pub commit_template: Option<String>,
    pub commits: Vec<CommitSummary>,
    pub history_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsInfo {
    pub enabled: bool,
    pub available: bool,
    pub version: Option<String>,
    pub tracked_files: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SparseCheckoutInfo {
    pub enabled: bool,
    pub cone_mode: bool,
    pub sparse_index: bool,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub oid: String,
    pub selector: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogPage {
    pub entries: Vec<ReflogEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningInfo {
    pub enabled: bool,
    pub format: String,
    pub key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningDiagnostic {
    pub available: bool,
    pub program: String,
    pub format: String,
    pub key_configured: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub name: String,
    pub path: String,
    pub absolute_path: String,
    pub url: String,
    pub oid: Option<String>,
    pub head_oid: Option<String>,
    pub initialized: bool,
    pub out_of_sync: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub oid: String,
    pub branch: Option<String>,
    pub current: bool,
    pub locked: bool,
    pub prunable: bool,
    pub status_loaded: bool,
    pub changes: usize,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryStatus {
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub conflicted: usize,
    pub merge_in_progress: bool,
    pub history_operation: Option<String>,
    pub rebase_in_progress: bool,
    pub bisect_in_progress: bool,
    pub entry_count: usize,
    pub entries_truncated: bool,
    pub entries: Vec<WorkingTreeEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeEntry {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub full_name: String,
    pub name: String,
    pub oid: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
    pub tracking: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub reference: String,
    pub oid: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub full_name: String,
    pub name: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDetails {
    pub name: String,
    pub oid: String,
    pub annotated: bool,
    pub message: Option<String>,
    pub tagger_name: Option<String>,
    pub tagger_email: Option<String>,
    pub tagged_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
    pub description: String,
    pub decorations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitHistoryPage {
    pub commits: Vec<CommitSummary>,
    pub history_truncated: bool,
}

/// Incremental history state used by the desktop to avoid increasingly
/// expensive `git log --skip=N` traversals in very large repositories.
///
/// Pages are produced in-process by a gitoxide-backed walk when the repository
/// can be opened that way, falling back to `git log` over a frontier otherwise.
#[derive(Default)]
pub struct CommitHistoryCursor {
    emitted: HashSet<String>,
    frontier: Vec<String>,
    walk: Option<history_walk::HistoryWalk>,
    stashes: Vec<StashEntry>,
}

impl CommitHistoryCursor {
    pub fn reset(&mut self, path: &Path, initial: &[CommitSummary]) -> Result<(), AppError> {
        self.emitted = initial.iter().map(|commit| commit.oid.clone()).collect();
        self.frontier.clear();
        self.stashes.clear();
        // Reusing the open repository keeps its loaded pack indexes and
        // object cache warm across refreshes of the same repository.
        let reusable = self.walk.take().filter(|walk| walk.opened_from(path));

        if let Some(mut walk) = reusable.or_else(|| history_walk::HistoryWalk::open(path)) {
            let tips = read_commits_with_arguments(
                path,
                &[
                    "log",
                    "--no-walk",
                    "--decorate=short",
                    "--decorate-refs-exclude=refs/remotes/*/HEAD",
                    "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f%D%x1e",
                    "--all",
                ],
            )?;
            self.stashes = read_stashes(path)?;
            let stash_oids = self
                .stashes
                .iter()
                .map(|stash| stash.oid.clone())
                .collect::<Vec<_>>();
            walk.reset(&tips, initial, &stash_oids);
            self.walk = Some(walk);
            return Ok(());
        }

        let tips = run_git(path, &["rev-list", "--no-walk", "--all"])?;
        ensure_success("prepare incremental commit history", &tips)?;
        let mut queued = HashSet::new();
        for oid in String::from_utf8_lossy(&tips.stdout)
            .lines()
            .map(str::trim)
            .filter(|oid| !oid.is_empty())
            .chain(
                initial
                    .iter()
                    .flat_map(|commit| commit.parents.iter().map(String::as_str)),
            )
        {
            if !self.emitted.contains(oid) && queued.insert(oid.to_owned()) {
                self.frontier.push(oid.to_owned());
            }
        }
        Ok(())
    }

    pub fn next_page(&mut self, path: &Path, limit: usize) -> Result<CommitHistoryPage, AppError> {
        if let Some(walk) = self.walk.as_mut() {
            let commits = walk.next_page(limit);
            return Ok(CommitHistoryPage {
                commits: normalize_stash_history(commits, &self.stashes),
                history_truncated: walk.has_more(),
            });
        }

        let mut commits = Vec::with_capacity(limit);
        while commits.len() < limit && !self.frontier.is_empty() {
            let remaining = limit - commits.len();
            let batch = read_commits_from_revisions(path, remaining, &self.frontier)?;
            if batch.is_empty() {
                self.frontier.clear();
                break;
            }

            let returned = batch
                .iter()
                .map(|commit| commit.oid.clone())
                .collect::<HashSet<_>>();
            self.frontier.retain(|oid| !returned.contains(oid));
            let mut queued = self.frontier.iter().cloned().collect::<HashSet<_>>();

            for commit in batch {
                let is_new = self.emitted.insert(commit.oid.clone());
                for parent in &commit.parents {
                    if !self.emitted.contains(parent)
                        && !returned.contains(parent)
                        && queued.insert(parent.clone())
                    {
                        self.frontier.push(parent.clone());
                    }
                }
                if is_new {
                    commits.push(commit);
                }
            }
            self.frontier.retain(|oid| !self.emitted.contains(oid));
        }

        let stashes = read_stashes(path)?;
        let commits = normalize_stash_history(commits, &stashes);
        Ok(CommitHistoryPage {
            commits,
            history_truncated: !self.frontier.is_empty(),
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedFileSearch {
    pub paths: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub status: String,
    pub path: String,
    pub previous_path: Option<String>,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub oid: String,
    pub message: String,
    pub signature: CommitSignature,
    pub files: Vec<CommitFile>,
    pub files_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSignature {
    pub status: String,
    pub signer: Option<String>,
    pub key: Option<String>,
    pub fingerprint: Option<String>,
    pub trust: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitComparison {
    pub base_oid: String,
    pub target_oid: String,
    pub working_tree: bool,
    pub files: Vec<CommitFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveRebaseCommit {
    pub oid: String,
    pub author_name: String,
    pub author_email: String,
    pub subject: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveRebasePlan {
    pub source: String,
    pub target: String,
    pub base: String,
    pub commits: Vec<InteractiveRebaseCommit>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveRebaseStep {
    pub oid: String,
    pub action: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileDiff {
    pub oid: String,
    pub path: String,
    pub patch: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeFileDiff {
    pub path: String,
    pub staged: bool,
    pub patch: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub oid: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBlameLine {
    pub line_number: usize,
    pub oid: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: i64,
    pub summary: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDetails {
    pub path: String,
    pub ancestor: Option<String>,
    pub current: Option<String>,
    pub incoming: Option<String>,
    pub output: Option<String>,
    pub binary: bool,
    pub truncated: bool,
}

// Keep previews comfortably below the payload size that can monopolize a
// WebView frame once each diff line becomes interactive DOM. Git is stopped as
// soon as this bound is crossed, so generated files do not consume unbounded
// native memory either.
const MAX_FILE_DIFF_BYTES: usize = 256_000;
// Commit selection is latency-sensitive: the resulting metadata is serialized
// through Tauri and immediately feeds several Angular views. Keep pathological
// root/generated commits from turning one click into a multi-megabyte UI update.
const MAX_COMMIT_DETAILS_BYTES: usize = 256_000;
const MAX_COMMIT_MESSAGE_BYTES: usize = 256_000;
const MAX_COMMIT_FILES: usize = 300;
const COMMIT_RENAME_LIMIT: usize = 200;
const MAX_TRACKED_FILE_SEARCH_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub kind: String,
    pub message: String,
    pub hint: Option<String>,
}

impl AppError {
    fn new(kind: &str, message: impl Into<String>, hint: Option<&str>) -> Self {
        Self {
            kind: kind.to_owned(),
            message: message.into(),
            hint: hint.map(str::to_owned),
        }
    }

    fn git_failure(operation: &str, output: &Output) -> Self {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let redacted = redact_url_credentials(stderr.trim());
        let detail = redacted.trim();
        let message = if detail.is_empty() {
            format!("Git could not {operation} (exit code {}).", output.status)
        } else {
            detail.to_owned()
        };
        Self::new(
            "gitFailure",
            message,
            Some("Resolve the Git error and refresh the repository."),
        )
    }
}

pub fn detect_git() -> SystemGitInfo {
    let output = Command::new("git").arg("--version").output();
    let Some(version) = output
        .ok()
        .filter(|result| result.status.success())
        .and_then(|result| parse_git_version(&result.stdout))
    else {
        return SystemGitInfo {
            version: None,
            supported: false,
        };
    };

    SystemGitInfo {
        supported: version_at_least(&version, MINIMUM_GIT_VERSION),
        version: Some(version),
    }
}

pub fn resolve_repository(path: &Path) -> Result<PathBuf, AppError> {
    if !path.exists() {
        return Err(AppError::new(
            "pathNotFound",
            "That path no longer exists.",
            Some("Choose an existing Git working tree."),
        ));
    }

    let output = run_git(path, &["rev-parse", "--show-toplevel"])?;
    ensure_success("open this repository", &output)?;
    let root = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    PathBuf::from(root).canonicalize().map_err(|error| {
        AppError::new(
            "invalidRepositoryPath",
            format!("Could not resolve the repository path: {error}"),
            None,
        )
    })
}

pub struct RepositoryWatchPaths {
    pub non_recursive: Vec<PathBuf>,
    pub recursive: Vec<PathBuf>,
}

pub fn repository_watch_paths(path: &Path) -> Result<RepositoryWatchPaths, AppError> {
    let mut metadata_roots = Vec::with_capacity(2);
    for args in [
        ["rev-parse", "--absolute-git-dir"].as_slice(),
        ["rev-parse", "--path-format=absolute", "--git-common-dir"].as_slice(),
    ] {
        let output = run_git(path, args)?;
        ensure_success("locate Git repository metadata", &output)?;
        let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if !value.is_empty() {
            let metadata = PathBuf::from(value);
            if !metadata_roots.contains(&metadata) {
                metadata_roots.push(metadata);
            }
        }
    }
    let mut recursive = Vec::new();
    if let Some(common_dir) = metadata_roots.last() {
        for relative in ["refs", "worktrees"] {
            let candidate = common_dir.join(relative);
            if candidate.is_dir() {
                recursive.push(candidate);
            }
        }
    }
    Ok(RepositoryWatchPaths {
        non_recursive: metadata_roots,
        recursive,
    })
}

pub fn clone_repository(
    remote: &str,
    parent: &Path,
    folder: &str,
    branch: Option<&str>,
    depth: Option<u32>,
) -> Result<PathBuf, AppError> {
    validate_parent_directory(parent)?;
    validate_folder_name(folder)?;
    let remote = remote.trim();
    if remote.is_empty()
        || remote.starts_with('-')
        || remote.chars().any(|char| matches!(char, '\n' | '\r'))
    {
        return Err(AppError::new(
            "invalidRemote",
            "Enter a valid repository URL or local repository path.",
            None,
        ));
    }
    if let Some(branch) = branch.filter(|value| !value.is_empty()) {
        validate_branch_name(parent, branch)?;
    }
    if depth == Some(0) {
        return Err(AppError::new(
            "invalidCloneDepth",
            "Shallow clone depth must be at least 1.",
            None,
        ));
    }
    let destination = parent.join(folder);
    if destination.exists() {
        return Err(AppError::new(
            "destinationExists",
            "The clone destination already exists.",
            Some("Choose another folder name or open the existing repository."),
        ));
    }
    let mut args = vec!["clone".to_owned()];
    if let Some(branch) = branch.filter(|value| !value.is_empty()) {
        args.extend([
            "--branch".to_owned(),
            branch.to_owned(),
            "--single-branch".to_owned(),
        ]);
    }
    if let Some(depth) = depth {
        args.extend(["--depth".to_owned(), depth.to_string()]);
    }
    args.extend([
        "--".to_owned(),
        remote.to_owned(),
        destination.to_string_lossy().into_owned(),
    ]);
    let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_git(parent, &borrowed)?;
    ensure_success("clone that repository", &output)?;
    destination.canonicalize().map_err(|error| {
        AppError::new(
            "invalidRepositoryPath",
            format!("Could not resolve the cloned repository: {error}"),
            None,
        )
    })
}

pub fn initialize_repository(
    parent: &Path,
    folder: &str,
    initial_branch: &str,
    create_readme: bool,
) -> Result<PathBuf, AppError> {
    validate_parent_directory(parent)?;
    validate_folder_name(folder)?;
    validate_branch_name(parent, initial_branch)?;
    let destination = parent.join(folder);
    if destination.exists() {
        return Err(AppError::new(
            "destinationExists",
            "The repository destination already exists.",
            Some("Choose another folder name or open the existing directory."),
        ));
    }
    let destination_text = destination.to_string_lossy().into_owned();
    let output = run_git(
        parent,
        &["init", "-b", initial_branch, "--", &destination_text],
    )?;
    ensure_success("initialize that repository", &output)?;
    if create_readme {
        fs::write(destination.join("README.md"), format!("# {folder}\n")).map_err(|error| {
            AppError::new(
                "createReadmeFailed",
                format!("The repository was created, but README.md could not be written: {error}"),
                Some("Open the repository and create README.md manually."),
            )
        })?;
    }
    destination.canonicalize().map_err(|error| {
        AppError::new(
            "invalidRepositoryPath",
            format!("Could not resolve the initialized repository: {error}"),
            None,
        )
    })
}

fn validate_parent_directory(parent: &Path) -> Result<(), AppError> {
    if parent.is_dir() {
        Ok(())
    } else {
        Err(AppError::new(
            "invalidParentDirectory",
            "Choose an existing destination directory.",
            None,
        ))
    }
}

fn validate_folder_name(folder: &str) -> Result<(), AppError> {
    let mut components = Path::new(folder).components();
    let valid = folder.trim() == folder
        && !folder.is_empty()
        && matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none();
    if valid {
        Ok(())
    } else {
        Err(AppError::new(
            "invalidFolderName",
            "Enter a single folder name without path separators.",
            None,
        ))
    }
}

pub fn snapshot(path: &Path) -> Result<RepositoryData, AppError> {
    snapshot_with_limits(path, 200, usize::MAX)
}

pub fn snapshot_with_commit_limit(
    path: &Path,
    commit_limit: usize,
) -> Result<RepositoryData, AppError> {
    snapshot_with_limits(path, commit_limit, usize::MAX)
}

pub fn snapshot_with_limits(
    path: &Path,
    commit_limit: usize,
    status_limit: usize,
) -> Result<RepositoryData, AppError> {
    snapshot_with_options(path, commit_limit, status_limit, true, true, "all")
}

/// Builds the latency-sensitive snapshot used by the desktop shell.
///
/// Linked worktrees can number in the hundreds and each `git status` walks a
/// separate checkout. Untracked-file discovery can also dominate startup in a
/// very large working tree. Both are deferred until after the first usable
/// frame; tracked changes are still included in this snapshot.
pub fn snapshot_with_limits_fast(
    path: &Path,
    commit_limit: usize,
    status_limit: usize,
) -> Result<RepositoryData, AppError> {
    snapshot_with_options(path, commit_limit, status_limit, false, false, "no")
}

/// Builds the first-frame snapshot without walking the working tree.
///
/// A tracked-file status scan can take tens of seconds on cold, very large
/// repositories. The desktop refreshes status asynchronously once the usable
/// repository view is visible, so startup only needs the current branch here.
pub fn snapshot_with_limits_startup(
    path: &Path,
    commit_limit: usize,
    status_limit: usize,
) -> Result<RepositoryData, AppError> {
    let status = read_head_status(path)?;
    snapshot_with_status(
        path,
        commit_limit,
        status_limit,
        false,
        false,
        false,
        status,
    )
}

fn snapshot_with_options(
    path: &Path,
    commit_limit: usize,
    status_limit: usize,
    include_linked_worktree_status: bool,
    include_all_branch_tracking: bool,
    untracked_files: &str,
) -> Result<RepositoryData, AppError> {
    let status = read_status_with_limit_mode(path, status_limit, untracked_files)?;
    snapshot_with_status(
        path,
        commit_limit,
        status_limit,
        include_linked_worktree_status,
        include_all_branch_tracking,
        true,
        status,
    )
}

fn snapshot_with_status(
    path: &Path,
    commit_limit: usize,
    _status_limit: usize,
    include_linked_worktree_status: bool,
    include_all_branch_tracking: bool,
    include_tags: bool,
    status: RepositoryStatus,
) -> Result<RepositoryData, AppError> {
    let remotes = read_remotes(path)?;
    let branches = read_branches(path, &status, include_all_branch_tracking)?;
    let stashes = read_stashes(path)?;
    // Large, long-lived repositories can have thousands of annotated tags.
    // Peeling every tag is expensive and is not required for the first usable
    // frame; the desktop hydrates complete reference metadata in the
    // background after the repository workspace is visible.
    let tags = if include_tags {
        read_tags(path)?
    } else {
        Vec::new()
    };
    let worktrees = read_worktrees(path, &status, include_linked_worktree_status)?;
    let submodules = read_submodules(path)?;
    let lfs = read_lfs_info(path);
    let sparse_checkout = read_sparse_checkout_info(path);
    let commit_template = read_commit_template(path)?;
    let (identity, signing) = read_identity_and_signing(path);
    let history_read_limit = commit_limit
        .saturating_add(stashes.len().saturating_mul(2))
        .saturating_add(1);
    let mut commits = normalize_stash_history(read_commits(path, history_read_limit)?, &stashes);
    let history_truncated = commits.len() > commit_limit;
    commits.truncate(commit_limit);
    let head_oid = run_git(path, &["rev-parse", "--verify", "HEAD"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned());

    Ok(RepositoryData {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        path: path.to_string_lossy().into_owned(),
        identity,
        signing,
        head_oid,
        status,
        remotes,
        branches,
        stashes,
        tags,
        worktrees,
        submodules,
        lfs,
        sparse_checkout,
        commit_template,
        commits,
        history_truncated,
    })
}

pub fn commit_history_page(
    path: &Path,
    offset: usize,
    limit: usize,
) -> Result<CommitHistoryPage, AppError> {
    let stashes = read_stashes(path)?;
    if stashes.is_empty() {
        let commits = read_commit_page(path, offset, limit.saturating_add(1))?;
        let history_truncated = commits.len() > limit;
        return Ok(CommitHistoryPage {
            commits: commits.into_iter().take(limit).collect(),
            history_truncated,
        });
    }
    let read_limit = offset
        .saturating_add(limit)
        .saturating_add(stashes.len().saturating_mul(2))
        .saturating_add(1);
    let commits = normalize_stash_history(read_commits(path, read_limit)?, &stashes)
        .into_iter()
        .skip(offset)
        .take(limit.saturating_add(1))
        .collect::<Vec<_>>();
    let history_truncated = commits.len() > limit;
    Ok(CommitHistoryPage {
        commits: commits.into_iter().take(limit).collect(),
        history_truncated,
    })
}

pub fn search_tracked_files(
    path: &Path,
    query: &str,
    limit: usize,
) -> Result<TrackedFileSearch, AppError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(TrackedFileSearch {
            paths: Vec::new(),
            truncated: false,
        });
    }
    if query.chars().count() > 200 || query.contains(['\0', '\n', '\r']) {
        return Err(AppError::new(
            "invalidFileSearch",
            "Enter a shorter single-line file search.",
            None,
        ));
    }
    let pathspec = format!(
        ":(icase,glob)**/*{}*",
        query.chars().fold(String::new(), |mut escaped, character| {
            match character {
                '*' => escaped.push_str("[*]"),
                '?' => escaped.push_str("[?]"),
                '[' => escaped.push_str("[[]"),
                ']' => escaped.push_str("[]]"),
                '\\' => escaped.push_str("[\\\\]"),
                _ => escaped.push(character),
            }
            escaped
        })
    );
    let (output, output_truncated) = run_git_with_stdout_limit(
        path,
        &["ls-files", "-z", "--cached", "--", &pathspec],
        MAX_TRACKED_FILE_SEARCH_BYTES,
    )?;
    if !output_truncated {
        ensure_success("search tracked files", &output)?;
    }
    let result_limit = limit.clamp(1, 100);
    let needle = query.to_lowercase();
    let complete_output = if output_truncated && output.stdout.last() != Some(&0) {
        output
            .stdout
            .iter()
            .rposition(|byte| *byte == 0)
            .map_or(&[][..], |index| &output.stdout[..=index])
    } else {
        &output.stdout
    };
    let mut matches = complete_output
        .split(|byte| *byte == 0)
        .filter(|bytes| !bytes.is_empty())
        .filter_map(|bytes| String::from_utf8(bytes.to_vec()).ok())
        .filter(|candidate| candidate.to_lowercase().contains(&needle))
        .take(result_limit.saturating_add(1))
        .collect::<Vec<_>>();
    let truncated = output_truncated || matches.len() > result_limit;
    matches.truncate(result_limit);
    Ok(TrackedFileSearch {
        paths: matches,
        truncated,
    })
}

pub fn reflog_entries(path: &Path, limit: usize) -> Result<ReflogPage, AppError> {
    let limit = limit.clamp(1, 500);
    let count = format!("--max-count={}", limit.saturating_add(1));
    let (output, output_truncated) = run_git_with_stdout_limit(
        path,
        &[
            "reflog",
            "show",
            "--all",
            &count,
            "--format=%H%x1f%gD%x1f%gs%x1f%gn%x1f%ge%x1e",
        ],
        MAX_REFLOG_OUTPUT_BYTES,
    )?;
    if !output_truncated {
        ensure_success("read repository recovery history", &output)?;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut entries = text
        .split('\x1e')
        .filter_map(|record| {
            let fields = record
                .trim_start_matches('\n')
                .split('\x1f')
                .collect::<Vec<_>>();
            (fields.len() >= 5).then(|| ReflogEntry {
                oid: fields[0].to_owned(),
                selector: fields[1].to_owned(),
                subject: fields[2].to_owned(),
                author_name: fields[3].to_owned(),
                author_email: fields[4].trim_end_matches('\n').to_owned(),
            })
        })
        .collect::<Vec<_>>();
    let truncated = output_truncated || entries.len() > limit;
    entries.truncate(limit);
    Ok(ReflogPage { entries, truncated })
}

fn read_remotes(path: &Path) -> Result<Vec<Remote>, AppError> {
    let output = run_git(path, &["remote"])?;
    ensure_success("read repository remotes", &output)?;
    let mut names = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
        .into_iter()
        .map(|name| {
            let fetch_url = remote_url(path, &name, false)?;
            let push_url = remote_url(path, &name, true)?;
            Ok(Remote {
                name,
                fetch_url,
                push_url,
            })
        })
        .collect()
}

fn remote_url(path: &Path, name: &str, push: bool) -> Result<String, AppError> {
    let args = if push {
        vec!["remote", "get-url", "--push", name]
    } else {
        vec!["remote", "get-url", name]
    };
    let output = run_git(path, &args)?;
    if !output.status.success() {
        return Ok(String::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn read_identity_and_signing(path: &Path) -> (GitIdentity, SigningInfo) {
    let output = run_git(
        path,
        &[
            "config",
            "--get-regexp",
            r"^(user\.name|user\.email|user\.signingkey|commit\.gpgsign|gpg\.format)$",
        ],
    );
    let mut name = None;
    let mut email = None;
    let mut key = None;
    let mut signing_enabled = false;
    let mut format = None;
    if let Ok(output) = output {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let Some((config_key, value)) = line.split_once(' ') else {
                continue;
            };
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            match config_key.to_ascii_lowercase().as_str() {
                "user.name" => name = Some(value.to_owned()),
                "user.email" => email = Some(value.to_owned()),
                "user.signingkey" => key = Some(value.to_owned()),
                "commit.gpgsign" => {
                    signing_enabled = matches!(
                        value.to_ascii_lowercase().as_str(),
                        "true" | "yes" | "on" | "1"
                    );
                }
                "gpg.format" => format = Some(value.to_ascii_lowercase()),
                _ => {}
            }
        }
    }
    (
        GitIdentity { name, email },
        SigningInfo {
            enabled: signing_enabled,
            format: format.unwrap_or_else(|| "openpgp".to_owned()),
            key,
        },
    )
}

pub fn signing_diagnostic(path: &Path) -> Result<SigningDiagnostic, AppError> {
    let (_, signing) = read_identity_and_signing(path);
    let (config_key, default_program) = match signing.format.as_str() {
        "openpgp" => ("gpg.program", "gpg"),
        "ssh" => ("gpg.ssh.program", "ssh-keygen"),
        "x509" => ("gpg.x509.program", "gpgsm"),
        _ => {
            return Ok(SigningDiagnostic {
                available: false,
                program: "Unknown".into(),
                format: signing.format.clone(),
                key_configured: signing.key.is_some(),
                message: format!(
                    "Git reports an unsupported signing format: {}.",
                    signing.format
                ),
            });
        }
    };
    let configured = run_git(path, &["config", "--get", config_key])?;
    let program = configured
        .status
        .success()
        .then(|| {
            String::from_utf8_lossy(&configured.stdout)
                .trim()
                .to_owned()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_program.to_owned());
    let available = executable_available(path, &program);
    let message = if available {
        if signing.key.is_some() {
            format!("{program} is available and Git has an explicit signing key configured.")
        } else {
            format!("{program} is available; Git will select its default signing key.")
        }
    } else {
        format!("{program} was not found in the configured path or system PATH.")
    };
    Ok(SigningDiagnostic {
        available,
        program,
        format: signing.format,
        key_configured: signing.key.is_some(),
        message,
    })
}

fn executable_available(repository: &Path, program: &str) -> bool {
    let configured = Path::new(program);
    if configured.is_absolute() || configured.components().count() > 1 {
        let candidate = if configured.is_absolute() {
            configured.to_path_buf()
        } else {
            repository.join(configured)
        };
        return executable_file(&candidate);
    }
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .any(|directory| {
            executable_candidates(&directory, program)
                .into_iter()
                .any(|path| executable_file(&path))
        })
}

fn executable_candidates(directory: &Path, program: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let path = Path::new(program);
        if path.extension().is_some() {
            return vec![directory.join(path)];
        }
        let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
        return extensions
            .split(';')
            .filter(|extension| !extension.is_empty())
            .map(|extension| directory.join(format!("{program}{}", extension.to_ascii_lowercase())))
            .collect();
    }
    #[cfg(not(windows))]
    {
        vec![directory.join(program)]
    }
}

fn executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub fn add_submodule(path: &Path, url: &str, target: &str) -> Result<(), AppError> {
    validate_submodule_url(url)?;
    validate_relative_path(
        target,
        "invalidSubmodulePath",
        "Enter a repository-relative submodule path.",
    )?;
    run_mutation(
        path,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "--",
            url,
            target,
        ],
        "add that submodule",
    )
}

pub fn initialize_submodule(path: &Path, target: &str) -> Result<(), AppError> {
    validate_known_submodule(path, target)?;
    run_mutation(
        path,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "update",
            "--init",
            "--recursive",
            "--",
            target,
        ],
        "initialize that submodule",
    )
}

pub fn update_submodule(path: &Path, target: &str) -> Result<(), AppError> {
    update_submodule_with_cancellation(path, target, None)
}

pub fn update_submodule_cancellable(
    path: &Path,
    target: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    update_submodule_with_cancellation(path, target, Some(cancellation))
}

fn update_submodule_with_cancellation(
    path: &Path,
    target: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    let submodule = validate_known_submodule(path, target)?;
    if !submodule.initialized {
        return Err(AppError::new(
            "submoduleNotInitialized",
            "Initialize that submodule before updating it.",
            None,
        ));
    }
    run_mutation_with_cancellation(
        path,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "update",
            "--remote",
            "--recursive",
            "--",
            target,
        ],
        "update that submodule",
        cancellation,
    )
}

pub fn stage_all(path: &Path) -> Result<(), AppError> {
    run_mutation(path, &["add", "--all", "--"], "stage all changes")
}

pub fn stage_path(path: &Path, file: &str) -> Result<(), AppError> {
    run_mutation(path, &["add", "--", file], "stage that file")
}

pub fn unstage_all(path: &Path) -> Result<(), AppError> {
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    if head.status.success() {
        run_mutation(path, &["reset", "--mixed", "HEAD", "--"], "unstage changes")
    } else {
        run_mutation(
            path,
            &["rm", "--cached", "-r", "--ignore-unmatch", "--", "."],
            "unstage changes",
        )
    }
}

pub fn unstage_path(path: &Path, file: &str) -> Result<(), AppError> {
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    if head.status.success() {
        run_mutation(
            path,
            &["reset", "--mixed", "HEAD", "--", file],
            "unstage that file",
        )
    } else {
        run_mutation(
            path,
            &["rm", "--cached", "--ignore-unmatch", "--", file],
            "unstage that file",
        )
    }
}

pub fn discard_path(path: &Path, file: &str, untracked: bool) -> Result<(), AppError> {
    let entry = validate_worktree_path(path, file)?;
    if untracked != (entry.index_status == "?") {
        return Err(AppError::new(
            "staleWorkingTreeFile",
            "That file's status changed before it could be discarded.",
            Some("Refresh the repository and try again."),
        ));
    }
    if untracked {
        run_mutation(
            path,
            &["clean", "-f", "-d", "--", file],
            "discard that untracked file",
        )
    } else {
        run_mutation(
            path,
            &["restore", "--worktree", "--", file],
            "discard that file's changes",
        )
    }
}

pub fn working_tree_file_recovery_patch(
    path: &Path,
    file: &str,
    untracked: bool,
) -> Result<Vec<u8>, AppError> {
    let entry = validate_worktree_path(path, file)?;
    if untracked != (entry.index_status == "?") {
        return Err(AppError::new(
            "staleWorkingTreeFile",
            "That file's status changed before it could be discarded.",
            Some("Refresh the repository and try again."),
        ));
    }
    let output = if untracked {
        run_git_allow_diff_exit(
            path,
            &[
                "diff",
                "--no-index",
                "--binary",
                "--full-index",
                "--",
                "/dev/null",
                file,
            ],
        )?
    } else {
        run_git(
            path,
            &[
                "diff",
                "--binary",
                "--full-index",
                "--no-ext-diff",
                "--no-color",
                "--",
                file,
            ],
        )?
    };
    if !untracked {
        ensure_success("prepare discard recovery", &output)?;
    }
    if output.stdout.is_empty() {
        return Err(AppError::new(
            "missingRecoveryPatch",
            "Git could not create a recovery patch for that file.",
            Some("Refresh the repository and review the file before discarding it."),
        ));
    }
    Ok(output.stdout)
}

pub fn working_tree_hunk_recovery_patch(
    path: &Path,
    file: &str,
    hunk_index: usize,
) -> Result<Vec<u8>, AppError> {
    let (_, output) = read_working_tree_patch(path, file, false)?;
    ensure_success("read that file's changes", &output)?;
    Ok(select_patch_hunk(&String::from_utf8_lossy(&output.stdout), hunk_index)?.into_bytes())
}

pub fn working_tree_lines_recovery_patch(
    path: &Path,
    file: &str,
    hunk_index: usize,
    line_indices: &[usize],
) -> Result<Vec<u8>, AppError> {
    let (_, output) = read_working_tree_patch(path, file, false)?;
    ensure_success("read that file's changes", &output)?;
    Ok(select_patch_lines(
        &String::from_utf8_lossy(&output.stdout),
        hunk_index,
        line_indices,
    )?
    .into_bytes())
}

pub fn apply_working_tree_recovery(
    path: &Path,
    patch_path: &Path,
    reverse: bool,
) -> Result<(), AppError> {
    let patch = fs::File::open(patch_path).map_err(|error| {
        AppError::new(
            "recoveryPatchUnavailable",
            format!("Could not open the discard recovery patch: {error}"),
            Some("The temporary recovery data may no longer be available."),
        )
    })?;
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(path)
        .args(["apply", "--recount", "--whitespace=nowarn"]);
    if reverse {
        command.arg("--reverse");
    }
    let output = command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::from(patch))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start Git: {error}"),
                Some("Install Git and ensure it is available on PATH."),
            )
        })?;
    ensure_success(
        if reverse {
            "discard those changes again"
        } else {
            "restore those discarded changes"
        },
        &output,
    )
}

pub fn ignore_path(
    path: &Path,
    file: &str,
    pattern_kind: &str,
    stop_tracking: bool,
) -> Result<(), AppError> {
    let entry = validate_worktree_path(path, file)?;
    let tracked = entry.index_status != "?";
    if tracked && !stop_tracking {
        return Err(AppError::new(
            "trackedFileRequiresUntracking",
            "Git cannot ignore a file that is still tracked.",
            Some("Choose Ignore and stop tracking instead."),
        ));
    }

    let file_path = Path::new(file);
    let rule = match pattern_kind {
        "file" => format!("/{}", escape_gitignore_literal(file)),
        "extension" => {
            let extension = file_path
                .extension()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::new(
                        "missingFileExtension",
                        "That file does not have an extension to ignore.",
                        None,
                    )
                })?;
            format!("*.{}", escape_gitignore_literal(extension))
        }
        "directory" => {
            let parent = file_path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .ok_or_else(|| {
                    AppError::new(
                        "missingParentDirectory",
                        "That file is already at the repository root.",
                        None,
                    )
                })?;
            format!("/{}/", escape_gitignore_literal(&parent.to_string_lossy()))
        }
        _ => {
            return Err(AppError::new(
                "invalidIgnorePattern",
                "Choose a valid ignore pattern.",
                None,
            ));
        }
    };

    let ignore_file = path.join(".gitignore");
    let existing = fs::read_to_string(&ignore_file).unwrap_or_default();
    if !existing.lines().any(|line| line == rule) {
        let mut updated = existing;
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str(&rule);
        updated.push('\n');
        fs::write(&ignore_file, updated).map_err(|error| {
            AppError::new(
                "writeIgnoreFileFailed",
                format!("Could not update .gitignore: {error}"),
                Some("Check that the repository is writable."),
            )
        })?;
    }
    if stop_tracking {
        run_mutation(
            path,
            &["rm", "--cached", "--ignore-unmatch", "--", file],
            "stop tracking that file",
        )?;
    }
    Ok(())
}

pub fn commit(path: &Path, message: &str) -> Result<(), AppError> {
    commit_with_options(path, message, false, false, None)
}

pub fn commit_with_options(
    path: &Path,
    message: &str,
    amend: bool,
    skip_hooks: bool,
    sign: Option<bool>,
) -> Result<(), AppError> {
    if message.trim().is_empty() {
        return Err(AppError::new(
            "invalidCommitMessage",
            "A commit message is required.",
            None,
        ));
    }
    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    if skip_hooks {
        args.push("--no-verify");
    }
    match sign {
        Some(true) => args.push("--gpg-sign"),
        Some(false) => args.push("--no-gpg-sign"),
        None => {}
    }
    args.extend(["-m", message]);
    run_mutation(path, &args, "create the commit")
}

pub fn update_head_message(
    path: &Path,
    expected_oid: &str,
    message: &str,
    skip_hooks: bool,
) -> Result<(), AppError> {
    validate_commit_oid(expected_oid)?;
    if message.trim().is_empty() {
        return Err(AppError::new(
            "invalidCommitMessage",
            "A commit message is required.",
            None,
        ));
    }
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("read the current commit", &head)?;
    if String::from_utf8_lossy(&head.stdout).trim() != expected_oid {
        return Err(AppError::new(
            "staleCommit",
            "HEAD changed before its message could be updated.",
            Some("Refresh the repository and try again."),
        ));
    }
    let mut args = vec!["commit", "--amend", "--only"];
    if skip_hooks {
        args.push("--no-verify");
    }
    args.extend(["-m", message]);
    run_mutation(path, &args, "update the commit message")
}

pub fn checkout_branch(path: &Path, name: &str) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    run_mutation(path, &["switch", "--", name], "switch branches")
}

pub fn checkout_remote_branch(path: &Path, name: &str) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    let (_, local_name) = name.split_once('/').ok_or_else(|| {
        AppError::new(
            "invalidRemoteBranch",
            "Select a branch that belongs to a configured remote.",
            None,
        )
    })?;
    if local_name == "HEAD" {
        return Err(AppError::new(
            "invalidRemoteBranch",
            "Select a remote branch instead of the remote HEAD alias.",
            None,
        ));
    }
    validate_branch_name(path, local_name)?;
    let reference = format!("refs/remotes/{name}");
    let output = run_git(path, &["show-ref", "--verify", "--quiet", &reference])?;
    if !output.status.success() {
        return Err(AppError::new(
            "remoteBranchNotFound",
            format!("Remote branch '{name}' no longer exists."),
            Some("Fetch the remotes and try again."),
        ));
    }
    run_mutation(
        path,
        &["switch", "--track", "--", name],
        "create a local tracking branch",
    )
}

pub fn set_branch_upstream(
    path: &Path,
    branch: &str,
    upstream: Option<&str>,
) -> Result<(), AppError> {
    validate_branch_name(path, branch)?;
    let local_reference = format!("refs/heads/{branch}");
    let local = run_git(path, &["show-ref", "--verify", "--quiet", &local_reference])?;
    if !local.status.success() {
        return Err(AppError::new(
            "localBranchNotFound",
            format!("Local branch '{branch}' no longer exists."),
            Some("Refresh the repository and try again."),
        ));
    }
    if let Some(upstream) = upstream {
        validate_branch_name(path, upstream)?;
        let remote_reference = format!("refs/remotes/{upstream}");
        let remote = run_git(
            path,
            &["show-ref", "--verify", "--quiet", &remote_reference],
        )?;
        if !remote.status.success() {
            return Err(AppError::new(
                "remoteBranchNotFound",
                format!("Remote branch '{upstream}' no longer exists."),
                Some("Fetch the remotes and try again."),
            ));
        }
        run_mutation(
            path,
            &["branch", "--set-upstream-to", upstream, branch],
            "set that branch upstream",
        )
    } else {
        run_mutation(
            path,
            &["branch", "--unset-upstream", branch],
            "unset that branch upstream",
        )
    }
}

pub fn create_branch(path: &Path, name: &str) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    run_mutation(path, &["switch", "-c", name], "create the branch")
}

pub fn create_branch_at(path: &Path, name: &str, oid: &str) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    validate_commit_oid(oid)?;
    run_mutation(
        path,
        &["switch", "-c", name, oid],
        "create the branch at that commit",
    )
}

pub fn create_worktree(
    path: &Path,
    parent: &Path,
    folder: &str,
    branch: &str,
    base: &str,
) -> Result<(), AppError> {
    validate_parent_directory(parent)?;
    validate_folder_name(folder)?;
    validate_branch_name(path, branch)?;
    validate_commitish(path, base)?;
    let destination = parent.join(folder);
    if destination.exists() {
        return Err(AppError::new(
            "destinationExists",
            "That worktree destination already exists.",
            Some("Choose another folder name or parent directory."),
        ));
    }
    let destination_text = destination.to_string_lossy().into_owned();
    run_mutation(
        path,
        &[
            "worktree",
            "add",
            "-b",
            branch,
            "--",
            &destination_text,
            base,
        ],
        "create that session worktree",
    )
}

pub fn create_worktree_for_branch(
    path: &Path,
    parent: &Path,
    folder: &str,
    branch: &str,
) -> Result<(), AppError> {
    validate_parent_directory(parent)?;
    validate_folder_name(folder)?;
    validate_branch_name(path, branch)?;
    validate_commitish(path, branch)?;
    let destination = parent.join(folder);
    if destination.exists() {
        return Err(AppError::new(
            "destinationExists",
            "That worktree destination already exists.",
            Some("Choose another folder name or parent directory."),
        ));
    }
    let destination_text = destination.to_string_lossy().into_owned();
    run_mutation(
        path,
        &["worktree", "add", "--", &destination_text, branch],
        "create a worktree for that branch",
    )
}

pub fn set_worktree_locked(path: &Path, target: &str, locked: bool) -> Result<(), AppError> {
    let worktree = managed_worktree(path, target)?;
    if worktree.current {
        return Err(AppError::new(
            "currentWorktree",
            "The currently open worktree cannot be locked here.",
            Some("Open another worktree first."),
        ));
    }
    let action = if locked { "lock" } else { "unlock" };
    run_mutation(
        path,
        &["worktree", action, target],
        if locked {
            "lock that worktree"
        } else {
            "unlock that worktree"
        },
    )
}

pub fn remove_worktree(
    path: &Path,
    target: &str,
    delete_branch: bool,
    force: bool,
) -> Result<(), AppError> {
    let worktree = managed_worktree(path, target)?;
    if worktree.current {
        return Err(AppError::new(
            "currentWorktree",
            "The currently open worktree cannot be removed.",
            Some("Open another worktree first."),
        ));
    }
    if worktree.locked {
        return Err(AppError::new(
            "lockedWorktree",
            "Unlock that worktree before removing it.",
            None,
        ));
    }
    let branch_to_delete = if delete_branch {
        Some(worktree.branch.clone().ok_or_else(|| {
            AppError::new(
                "detachedWorktree",
                "That worktree did not have a branch to delete.",
                None,
            )
        })?)
    } else {
        None
    };
    let mut arguments = vec!["worktree", "remove"];
    if force {
        arguments.push("--force");
    }
    arguments.push(target);
    run_mutation(path, &arguments, "remove that worktree")?;
    if let Some(branch) = branch_to_delete {
        run_mutation(
            path,
            &["branch", "-D", "--", &branch],
            "delete that worktree branch",
        )?;
    }
    Ok(())
}

pub fn checkout_commit(path: &Path, oid: &str) -> Result<(), AppError> {
    validate_commit_oid(oid)?;
    run_mutation(path, &["switch", "--detach", oid], "check out that commit")
}

pub fn rename_branch(path: &Path, old_name: &str, new_name: &str) -> Result<(), AppError> {
    validate_branch_name(path, old_name)?;
    validate_branch_name(path, new_name)?;
    run_mutation(
        path,
        &["branch", "--move", old_name, new_name],
        "rename that branch",
    )
}

pub fn delete_branch(path: &Path, name: &str, force: bool) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    let output = run_git(path, &["branch", if force { "-D" } else { "-d" }, name])?;
    if !force && !output.status.success() && is_unmerged_branch_refusal(&output.stderr) {
        // Report the safety refusal distinctly so the interface can offer an explicit force delete.
        return Err(AppError::new(
            "branchNotMerged",
            format!(
                "{name} has commits that are not merged into its upstream or the current branch."
            ),
            Some("Deleting it anyway can make those commits unreachable from any branch."),
        ));
    }
    ensure_success("delete that branch", &output)
}

fn is_unmerged_branch_refusal(stderr: &[u8]) -> bool {
    String::from_utf8_lossy(stderr).contains("is not fully merged")
}

pub fn integrate_branch(path: &Path, name: &str, strategy: &str) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    let args: Vec<&str> = match strategy {
        "merge" => vec!["merge", "--no-edit", name],
        "ff-only" => vec!["merge", "--ff-only", name],
        "squash" => vec!["merge", "--squash", name],
        "rebase" => vec!["rebase", name],
        _ => {
            return Err(AppError::new(
                "invalidIntegrationStrategy",
                "That branch integration strategy is not supported.",
                Some("Choose merge, fast-forward, squash, or rebase."),
            ));
        }
    };
    run_mutation(path, &args, "integrate that branch")
}

pub fn continue_merge(path: &Path) -> Result<(), AppError> {
    if !repository_operation_state(path)?.merge {
        return Err(AppError::new(
            "mergeNotInProgress",
            "No merge is currently in progress.",
            None,
        ));
    }
    run_mutation(
        path,
        &["-c", "core.editor=true", "merge", "--continue"],
        "continue the merge",
    )
}

pub fn abort_merge(path: &Path) -> Result<(), AppError> {
    if !repository_operation_state(path)?.merge {
        return Err(AppError::new(
            "mergeNotInProgress",
            "No merge is currently in progress.",
            None,
        ));
    }
    run_mutation(path, &["merge", "--abort"], "abort the merge")
}

pub fn prepare_interactive_rebase(
    path: &Path,
    source: &str,
    target: &str,
) -> Result<InteractiveRebasePlan, AppError> {
    validate_branch_name(path, source)?;
    validate_branch_name(path, target)?;
    if source == target {
        return Err(AppError::new(
            "invalidInteractiveRebase",
            "Choose two different branches for interactive rebase.",
            None,
        ));
    }
    if rebase_in_progress(path)? {
        return Err(AppError::new(
            "rebaseInProgress",
            "An interactive rebase is already in progress.",
            Some("Continue, skip, or abort the active rebase first."),
        ));
    }
    let status = read_status(path)?;
    if !status.entries.is_empty() {
        return Err(AppError::new(
            "dirtyWorkingTree",
            "Commit or stash working directory changes before interactive rebase.",
            None,
        ));
    }
    for branch in [source, target] {
        let reference = format!("refs/heads/{branch}");
        let output = run_git(path, &["show-ref", "--verify", "--quiet", &reference])?;
        if !output.status.success() {
            return Err(AppError::new(
                "unknownBranch",
                format!("Local branch '{branch}' no longer exists."),
                Some("Refresh the repository and choose another branch."),
            ));
        }
    }
    let base_output = run_git(path, &["merge-base", source, target])?;
    ensure_success("find a common ancestor for those branches", &base_output)?;
    let base = String::from_utf8_lossy(&base_output.stdout)
        .trim()
        .to_owned();
    if base.is_empty() {
        return Err(AppError::new(
            "unrelatedBranches",
            "Those branches do not share a common ancestor.",
            None,
        ));
    }
    let range = format!("{base}..{source}");
    let topology = run_git(path, &["rev-list", "--reverse", "--parents", &range])?;
    ensure_success("inspect the source branch history", &topology)?;
    let topology_lines = String::from_utf8_lossy(&topology.stdout);
    if topology_lines
        .lines()
        .any(|line| line.split_whitespace().count() > 2)
    {
        return Err(AppError::new(
            "mergeCommitInRebase",
            "Interactive rebase is unavailable because the source range contains a merge commit.",
            Some("Choose a linear source branch or use a regular rebase."),
        ));
    }
    let log = run_git(
        path,
        &[
            "log",
            "--reverse",
            "--format=%H%x1f%an%x1f%ae%x1f%s%x1f%B%x1e",
            &range,
            "--",
        ],
    )?;
    ensure_success("prepare the interactive rebase", &log)?;
    let commits = log
        .stdout
        .split(|byte| *byte == 0x1e)
        .filter_map(|record| {
            let record = record.strip_prefix(b"\n").unwrap_or(record);
            if record.is_empty() {
                return None;
            }
            let fields = record.split(|byte| *byte == 0x1f).collect::<Vec<_>>();
            (fields.len() == 5).then(|| InteractiveRebaseCommit {
                oid: String::from_utf8_lossy(fields[0]).trim().to_owned(),
                author_name: String::from_utf8_lossy(fields[1]).into_owned(),
                author_email: String::from_utf8_lossy(fields[2]).into_owned(),
                subject: String::from_utf8_lossy(fields[3]).trim().to_owned(),
                message: String::from_utf8_lossy(fields[4]).trim().to_owned(),
            })
        })
        .collect::<Vec<_>>();
    if commits.is_empty() {
        return Err(AppError::new(
            "emptyInteractiveRebase",
            format!("Branch '{source}' has no commits to replay onto '{target}'."),
            None,
        ));
    }
    Ok(InteractiveRebasePlan {
        source: source.to_owned(),
        target: target.to_owned(),
        base,
        commits,
    })
}

pub fn execute_interactive_rebase(
    path: &Path,
    source: &str,
    target: &str,
    steps: &[InteractiveRebaseStep],
) -> Result<(), AppError> {
    let plan = prepare_interactive_rebase(path, source, target)?;
    if steps.len() != plan.commits.len() {
        return Err(AppError::new(
            "staleInteractiveRebase",
            "The interactive rebase plan is incomplete.",
            Some("Reset the plan and try again."),
        ));
    }
    let expected = plan
        .commits
        .iter()
        .map(|commit| commit.oid.as_str())
        .collect::<std::collections::HashSet<_>>();
    let supplied = steps
        .iter()
        .map(|step| step.oid.as_str())
        .collect::<std::collections::HashSet<_>>();
    if expected != supplied || supplied.len() != steps.len() {
        return Err(AppError::new(
            "staleInteractiveRebase",
            "The interactive rebase commits changed.",
            Some("Reset the plan and try again."),
        ));
    }
    if steps.first().is_some_and(|step| step.action == "squash") {
        return Err(AppError::new(
            "invalidInteractiveRebase",
            "The first commit cannot be squashed because it has no preceding commit.",
            None,
        ));
    }

    let support_dir = rebase_support_dir(path)?;
    if support_dir.exists() {
        fs::remove_dir_all(&support_dir).map_err(|error| {
            AppError::new(
                "rebaseSetupFailed",
                format!("Could not reset interactive rebase support files: {error}"),
                None,
            )
        })?;
    }
    fs::create_dir_all(&support_dir).map_err(|error| {
        AppError::new(
            "rebaseSetupFailed",
            format!("Could not prepare interactive rebase support files: {error}"),
            None,
        )
    })?;
    let mut todo = String::new();
    for (index, step) in steps.iter().enumerate() {
        validate_commit_oid(&step.oid)?;
        match step.action.as_str() {
            "pick" => todo.push_str(&format!("pick {}\n", step.oid)),
            "drop" => todo.push_str(&format!("drop {}\n", step.oid)),
            "squash" => todo.push_str(&format!("squash {}\n", step.oid)),
            "reword" => {
                let message = step.message.as_deref().unwrap_or_default().trim();
                if message.is_empty() {
                    cleanup_rebase_support(path);
                    return Err(AppError::new(
                        "invalidInteractiveRebase",
                        "Every reworded commit needs a commit message.",
                        None,
                    ));
                }
                let message_path = support_dir.join(format!("message-{index}.txt"));
                fs::write(&message_path, format!("{message}\n")).map_err(|error| {
                    AppError::new(
                        "rebaseSetupFailed",
                        format!("Could not save a reworded commit message: {error}"),
                        None,
                    )
                })?;
                todo.push_str(&format!(
                    "pick {}\nexec git commit --amend -F {}\n",
                    step.oid,
                    shell_quote(&message_path.to_string_lossy())
                ));
            }
            _ => {
                cleanup_rebase_support(path);
                return Err(AppError::new(
                    "invalidInteractiveRebase",
                    "Choose Pick, Reword, Squash, or Drop for every commit.",
                    None,
                ));
            }
        }
    }
    let todo_path = support_dir.join("todo");
    let editor_path = support_dir.join("sequence-editor.sh");
    fs::write(&todo_path, todo).map_err(|error| {
        AppError::new(
            "rebaseSetupFailed",
            format!("Could not save the interactive rebase plan: {error}"),
            None,
        )
    })?;
    fs::write(&editor_path, "#!/bin/sh\ncp \"$GIT_CHRONOS_TODO\" \"$1\"\n").map_err(|error| {
        AppError::new(
            "rebaseSetupFailed",
            format!("Could not create the interactive rebase editor: {error}"),
            None,
        )
    })?;
    let sequence_editor = format!("sh {}", shell_quote(&editor_path.to_string_lossy()));
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["rebase", "-i", "--onto", target, &plan.base, source])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("GIT_SEQUENCE_EDITOR", sequence_editor)
        .env("GIT_CHRONOS_TODO", &todo_path)
        .env("GIT_EDITOR", "true")
        .output()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start Git: {error}"),
                None,
            )
        })?;
    finish_rebase_command(path, output, "run the interactive rebase")
}

pub fn continue_rebase(path: &Path) -> Result<(), AppError> {
    run_rebase_control(path, "--continue", "continue the interactive rebase")
}

pub fn skip_rebase(path: &Path) -> Result<(), AppError> {
    run_rebase_control(path, "--skip", "skip that interactive rebase commit")
}

pub fn abort_rebase(path: &Path) -> Result<(), AppError> {
    let output = run_git(path, &["rebase", "--abort"])?;
    let result = ensure_success("abort the interactive rebase", &output);
    if result.is_ok() {
        cleanup_rebase_support(path);
    }
    result
}

pub fn fetch(path: &Path) -> Result<(), AppError> {
    run_fetch_with_cancellation(path, None).map(|_| ())
}

pub fn fetch_cancellable(path: &Path, cancellation: &CancellationToken) -> Result<(), AppError> {
    run_fetch_with_cancellation(path, Some(cancellation)).map(|_| ())
}

pub fn fetch_remote(path: &Path, remote: &str) -> Result<(), AppError> {
    fetch_remote_with_cancellation(path, remote, None)
}

pub fn fetch_remote_cancellable(
    path: &Path,
    remote: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    fetch_remote_with_cancellation(path, remote, Some(cancellation))
}

fn fetch_remote_with_cancellation(
    path: &Path,
    remote: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    let mut args = fetch_command_args();
    args.retain(|argument| *argument != "--all");
    args.push(remote);
    let output = run_git_with_cancellation(path, &args, cancellation)?;
    ensure_success("fetch from the selected remote", &output)
}

/// Runs Git's repository-local maintenance strategy on demand.
///
/// Git owns task selection and safety semantics; Git Chronos only serializes the
/// operation with other repository mutations and reports its result.
pub fn perform_repository_maintenance(path: &Path) -> Result<(), AppError> {
    run_mutation(
        path,
        &["maintenance", "run"],
        "perform repository maintenance",
    )
}

/// Check advertised remote refs before starting the expensive object negotiation.
///
/// Large repositories can spend substantial CPU and memory negotiating an otherwise
/// empty fetch. The dry run is cheap when nothing changed, which is the common case
/// for periodic background synchronization.
pub fn fetch_if_needed(path: &Path) -> Result<bool, AppError> {
    let remotes = run_git(path, &["remote"])?;
    ensure_success("list repository remotes", &remotes)?;
    for remote in String::from_utf8_lossy(&remotes.stdout)
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
    {
        let preview = run_fetch_preview(path, remote)?;
        if !preview.stdout.is_empty() || !preview.stderr.is_empty() {
            run_fetch(path)?;
            return Ok(true);
        }
    }
    Ok(false)
}

fn fetch_command_args() -> Vec<&'static str> {
    vec![
        "-c",
        "fetch.parallel=1",
        "-c",
        "pack.threads=1",
        "-c",
        "index.threads=1",
        "-c",
        "fetch.negotiationAlgorithm=skipping",
        "fetch",
        "--all",
        "--prune",
        "--no-auto-maintenance",
        "--no-recurse-submodules",
    ]
}

fn run_fetch(path: &Path) -> Result<Output, AppError> {
    run_fetch_with_cancellation(path, None)
}

fn run_fetch_with_cancellation(
    path: &Path,
    cancellation: Option<&CancellationToken>,
) -> Result<Output, AppError> {
    let args = fetch_command_args();
    let output = run_git_with_cancellation(path, &args, cancellation)?;
    ensure_success("fetch from the remotes", &output)?;
    Ok(output)
}

fn run_fetch_preview(path: &Path, remote: &str) -> Result<Output, AppError> {
    let mut args = fetch_command_args();
    args.retain(|argument| *argument != "--all");
    args.push("--dry-run");
    args.push(remote);
    let output = run_git(path, &args)?;
    ensure_success("check for remote updates", &output)?;
    Ok(output)
}

pub fn pull(path: &Path) -> Result<(), AppError> {
    pull_with_strategy(path, "merge")
}

pub fn pull_with_strategy(path: &Path, strategy: &str) -> Result<(), AppError> {
    pull_from_remote_with_strategy(path, strategy, None, None)
}

pub fn pull_from_remote_with_strategy(
    path: &Path,
    strategy: &str,
    remote: Option<&str>,
    branch: Option<&str>,
) -> Result<(), AppError> {
    pull_from_remote_with_strategy_and_cancellation(path, strategy, remote, branch, None)
}

pub fn pull_with_strategy_cancellable(
    path: &Path,
    strategy: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    pull_from_remote_with_strategy_and_cancellation(path, strategy, None, None, Some(cancellation))
}

pub fn pull_from_remote_with_strategy_cancellable(
    path: &Path,
    strategy: &str,
    remote: Option<&str>,
    branch: Option<&str>,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    pull_from_remote_with_strategy_and_cancellation(
        path,
        strategy,
        remote,
        branch,
        Some(cancellation),
    )
}

fn pull_from_remote_with_strategy_and_cancellation(
    path: &Path,
    strategy: &str,
    remote: Option<&str>,
    branch: Option<&str>,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    let strategy_argument = match strategy {
        "merge" => None,
        "ff-only" => Some("--ff-only"),
        "rebase" => Some("--rebase"),
        _ => {
            return Err(AppError::new(
                "invalidPullStrategy",
                "That pull strategy is not supported.",
                Some("Choose fast-forward if possible, fast-forward only, or rebase."),
            ));
        }
    };

    let mut args = vec!["pull"];
    if let Some(argument) = strategy_argument {
        args.push(argument);
    }
    match (remote, branch) {
        (Some(remote), Some(branch)) => {
            validate_remote_name(path, remote)?;
            require_remote(path, remote)?;
            validate_branch_name(path, branch)?;
            args.push(remote);
            args.push(branch);
        }
        (None, None) => {}
        _ => {
            return Err(AppError::new(
                "invalidRemoteTarget",
                "Pull needs both a remote and a branch.",
                Some("Select a remote and try again."),
            ));
        }
    }
    run_mutation_with_cancellation(path, &args, "pull from the remote", cancellation)
}

pub fn push(path: &Path) -> Result<(), AppError> {
    run_mutation(path, &["push"], "push to the remote")
}

pub fn push_cancellable(path: &Path, cancellation: &CancellationToken) -> Result<(), AppError> {
    run_mutation_with_cancellation(path, &["push"], "push to the remote", Some(cancellation))
}

pub fn push_to_remote(path: &Path, remote: &str, branch: &str) -> Result<(), AppError> {
    push_to_remote_with_cancellation(path, remote, branch, None)
}

pub fn push_to_remote_cancellable(
    path: &Path,
    remote: &str,
    branch: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    push_to_remote_with_cancellation(path, remote, branch, Some(cancellation))
}

fn push_to_remote_with_cancellation(
    path: &Path,
    remote: &str,
    branch: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    validate_branch_name(path, branch)?;
    let refspec = format!("HEAD:refs/heads/{branch}");
    run_mutation_with_cancellation(
        path,
        &["push", remote, &refspec],
        "push to the selected remote",
        cancellation,
    )
}

pub fn push_force_with_lease(path: &Path) -> Result<(), AppError> {
    run_mutation(
        path,
        &["push", "--force-with-lease"],
        "force-push to the remote safely",
    )
}

pub fn push_force_with_lease_cancellable(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    run_mutation_with_cancellation(
        path,
        &["push", "--force-with-lease"],
        "force-push to the remote safely",
        Some(cancellation),
    )
}

pub fn push_force_with_lease_to_remote(
    path: &Path,
    remote: &str,
    branch: &str,
) -> Result<(), AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    validate_branch_name(path, branch)?;
    let refspec = format!("HEAD:refs/heads/{branch}");
    run_mutation(
        path,
        &["push", "--force-with-lease", remote, &refspec],
        "force-push to the selected remote safely",
    )
}

pub fn push_force_with_lease_to_remote_cancellable(
    path: &Path,
    remote: &str,
    branch: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    validate_branch_name(path, branch)?;
    let refspec = format!("HEAD:refs/heads/{branch}");
    run_mutation_with_cancellation(
        path,
        &["push", "--force-with-lease", remote, &refspec],
        "force-push to the selected remote safely",
        Some(cancellation),
    )
}

pub fn pull_lfs(path: &Path) -> Result<(), AppError> {
    run_lfs_mutation(path, "pull", "pull Git LFS objects")
}

pub fn pull_lfs_cancellable(path: &Path, cancellation: &CancellationToken) -> Result<(), AppError> {
    run_lfs_mutation_with_cancellation(path, "pull", "pull Git LFS objects", Some(cancellation))
}

pub fn prune_lfs(path: &Path) -> Result<(), AppError> {
    run_lfs_mutation(path, "prune", "prune old Git LFS objects")
}

pub fn prune_lfs_cancellable(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    run_lfs_mutation_with_cancellation(
        path,
        "prune",
        "prune old Git LFS objects",
        Some(cancellation),
    )
}

pub fn initialize_lfs(path: &Path) -> Result<(), AppError> {
    ensure_lfs_available(path)?;
    run_mutation(
        path,
        &["lfs", "install", "--local"],
        "initialize Git LFS for this repository",
    )
}

pub fn track_lfs_pattern(path: &Path, pattern: &str, lockable: bool) -> Result<(), AppError> {
    let pattern = pattern.trim();
    if pattern.is_empty()
        || pattern.starts_with('-')
        || pattern.chars().count() > 500
        || pattern.contains(['\0', '\n', '\r'])
    {
        return Err(AppError::new(
            "invalidLfsPattern",
            "Enter a valid Git LFS tracking pattern.",
            Some("Use a pattern such as *.psd or assets/*.zip."),
        ));
    }
    ensure_lfs_available(path)?;
    let args = if lockable {
        vec!["lfs", "track", "--lockable", pattern]
    } else {
        vec!["lfs", "track", pattern]
    };
    run_mutation(path, &args, "add that Git LFS tracking pattern")
}

pub fn set_sparse_checkout(
    path: &Path,
    paths: &[String],
    sparse_index: bool,
) -> Result<(), AppError> {
    if paths.len() > 4_096 || paths.iter().map(String::len).sum::<usize>() > 256 * 1_024 {
        return Err(AppError::new(
            "sparseCheckoutSelectionTooLarge",
            "That sparse checkout selection is too large.",
            Some("Choose fewer repository directories and try again."),
        ));
    }
    let mut normalized = Vec::with_capacity(paths.len());
    for value in paths {
        let value = value.trim().trim_end_matches('/');
        validate_relative_path(
            value,
            "invalidSparseCheckoutPath",
            "Sparse checkout paths must be relative repository directories.",
        )?;
        if !normalized.iter().any(|candidate| candidate == value) {
            normalized.push(value.to_owned());
        }
    }
    let input = if normalized.is_empty() {
        Vec::new()
    } else {
        format!("{}\n", normalized.join("\n")).into_bytes()
    };
    run_git_with_input(
        path,
        &[
            "sparse-checkout",
            "set",
            "--cone",
            if sparse_index {
                "--sparse-index"
            } else {
                "--no-sparse-index"
            },
            "--stdin",
        ],
        &input,
        "set sparse checkout directories",
    )
}

pub fn reapply_sparse_checkout(path: &Path) -> Result<(), AppError> {
    ensure_sparse_checkout_enabled(path)?;
    run_mutation(
        path,
        &["sparse-checkout", "reapply"],
        "reapply sparse checkout directories",
    )
}

pub fn disable_sparse_checkout(path: &Path) -> Result<(), AppError> {
    ensure_sparse_checkout_enabled(path)?;
    run_mutation(
        path,
        &["sparse-checkout", "disable"],
        "disable sparse checkout",
    )
}

fn ensure_sparse_checkout_enabled(path: &Path) -> Result<(), AppError> {
    if read_sparse_checkout_info(path).enabled {
        Ok(())
    } else {
        Err(AppError::new(
            "sparseCheckoutDisabled",
            "Sparse checkout is not enabled for this repository.",
            Some("Choose repository directories before running this action."),
        ))
    }
}

fn ensure_lfs_available(path: &Path) -> Result<(), AppError> {
    let output = run_git(path, &["lfs", "version"])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "lfsUnavailable",
            "Git LFS is not available on PATH.",
            Some("Install Git LFS 3.0 or newer and reopen the repository."),
        ))
    }
}

fn run_lfs_mutation(path: &Path, subcommand: &str, operation: &str) -> Result<(), AppError> {
    run_lfs_mutation_with_cancellation(path, subcommand, operation, None)
}

fn run_lfs_mutation_with_cancellation(
    path: &Path,
    subcommand: &str,
    operation: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    let info = read_lfs_info(path);
    if !info.enabled {
        return Err(AppError::new(
            "lfsNotEnabled",
            "Git LFS is not enabled for this repository.",
            Some("Add an LFS tracking rule before running this action."),
        ));
    }
    ensure_lfs_available(path)?;
    run_mutation_with_cancellation(path, &["lfs", subcommand], operation, cancellation)
}

pub fn publish_branch(path: &Path, remote: &str, branch: &str) -> Result<(), AppError> {
    publish_branch_with_cancellation(path, remote, branch, None)
}

pub fn publish_branch_cancellable(
    path: &Path,
    remote: &str,
    branch: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    publish_branch_with_cancellation(path, remote, branch, Some(cancellation))
}

fn publish_branch_with_cancellation(
    path: &Path,
    remote: &str,
    branch: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    validate_branch_name(path, branch)?;
    if remote.is_empty()
        || remote.starts_with('-')
        || remote.trim() != remote
        || remote.contains(['\0', '\n', '\r'])
        || !read_remotes(path)?
            .iter()
            .any(|candidate| candidate.name == remote)
    {
        return Err(AppError::new(
            "remoteNotFound",
            format!("Remote '{remote}' is not configured for this repository."),
            Some("Refresh the repository or choose another remote."),
        ));
    }
    let local_reference = format!("refs/heads/{branch}");
    let local = run_git(path, &["show-ref", "--verify", "--quiet", &local_reference])?;
    if !local.status.success() {
        return Err(AppError::new(
            "localBranchNotFound",
            format!("Local branch '{branch}' no longer exists."),
            Some("Refresh the repository and try again."),
        ));
    }
    run_mutation_with_cancellation(
        path,
        &["push", "--set-upstream", remote, branch],
        "publish that branch",
        cancellation,
    )
}

pub fn add_remote(path: &Path, name: &str, url: &str) -> Result<(), AppError> {
    validate_remote_name(path, name)?;
    validate_remote_url(url)?;
    if read_remotes(path)?.iter().any(|remote| remote.name == name) {
        return Err(AppError::new(
            "remoteAlreadyExists",
            format!("Remote '{name}' already exists."),
            Some("Choose another remote name or edit the existing remote."),
        ));
    }
    run_mutation(path, &["remote", "add", name, url], "add that remote")
}

pub fn set_remote_url(path: &Path, name: &str, url: &str) -> Result<(), AppError> {
    validate_remote_name(path, name)?;
    validate_remote_url(url)?;
    require_remote(path, name)?;
    let args = if remote_has_configured_url(path, name)? {
        vec!["remote", "set-url", name, url]
    } else {
        vec!["remote", "set-url", "--add", name, url]
    };
    run_mutation(path, &args, "update that remote URL")
}

pub fn set_repository_identity(path: &Path, name: &str, email: &str) -> Result<(), AppError> {
    validate_identity_value(name, "invalidIdentityName", "Enter a Git author name.")?;
    validate_identity_value(email, "invalidIdentityEmail", "Enter a Git author email.")?;
    run_mutation(
        path,
        &["config", "--local", "--replace-all", "user.name", name],
        "update the repository author name",
    )?;
    run_mutation(
        path,
        &["config", "--local", "--replace-all", "user.email", email],
        "update the repository author email",
    )
}

fn remote_has_configured_url(path: &Path, name: &str) -> Result<bool, AppError> {
    let key = format!("remote.{name}.url");
    let output = run_git(path, &["config", "--get-all", &key])?;
    Ok(output.status.success() && !output.stdout.is_empty())
}

pub fn remove_remote(path: &Path, name: &str) -> Result<(), AppError> {
    validate_remote_name(path, name)?;
    require_remote(path, name)?;
    run_mutation(path, &["remote", "remove", name], "remove that remote")
}

fn require_remote(path: &Path, name: &str) -> Result<(), AppError> {
    if read_remotes(path)?.iter().any(|remote| remote.name == name) {
        return Ok(());
    }
    Err(remote_not_found(name))
}

fn remote_not_found(name: &str) -> AppError {
    AppError::new(
        "remoteNotFound",
        format!("Remote '{name}' is not configured for this repository."),
        Some("Refresh the repository and try again."),
    )
}

fn validate_remote_name(path: &Path, name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.starts_with('-')
        || name.trim() != name
        || name.contains(['\0', '\n', '\r'])
    {
        return Err(AppError::new(
            "invalidRemoteName",
            "Enter a valid remote name.",
            Some("Use a short name such as origin or upstream."),
        ));
    }
    let reference = format!("refs/remotes/{name}/placeholder");
    let output = run_git(path, &["check-ref-format", &reference])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "invalidRemoteName",
            format!("'{name}' cannot be used as a remote name."),
            Some("Use a short name without spaces or Git reference punctuation."),
        ))
    }
}

fn validate_remote_url(url: &str) -> Result<(), AppError> {
    if url.is_empty() || url.trim() != url || url.contains(['\0', '\n', '\r']) {
        return Err(AppError::new(
            "invalidRemoteUrl",
            "Enter a valid remote URL.",
            Some("Use an HTTPS, SSH, or local repository URL."),
        ));
    }
    Ok(())
}

pub fn stash(path: &Path) -> Result<(), AppError> {
    stash_with_message(path, None)
}

pub fn stash_with_message(path: &Path, message: Option<&str>) -> Result<(), AppError> {
    let message = message
        .map(validate_stash_message)
        .transpose()?
        .filter(|message| !message.is_empty());
    let mut args = vec!["stash", "push", "--include-untracked"];
    if let Some(message) = message {
        args.extend(["--message", message]);
    }
    run_mutation(path, &args, "stash working directory changes")
}

pub fn rename_stash(
    path: &Path,
    reference: &str,
    expected_oid: &str,
    message: &str,
) -> Result<(), AppError> {
    validate_stash_reference(reference)?;
    let message = validate_stash_message(message)?;
    if message.is_empty() {
        return Err(AppError::new(
            "invalidStashMessage",
            "Enter a stash message.",
            None,
        ));
    }

    let index = reference
        .strip_prefix("stash@{")
        .and_then(|value| value.strip_suffix('}'))
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| AppError::new("invalidStash", "That stash reference is invalid.", None))?;

    let output = run_git(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "logs/refs/stash",
        ],
    )?;
    ensure_success("find the stash log", &output)?;
    let reflog_path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let mut lock_name = reflog_path.as_os_str().to_os_string();
    lock_name.push(".lock");
    let lock_path = PathBuf::from(lock_name);
    let mut lock_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|error| {
            AppError::new(
                "stashLocked",
                format!("Could not lock the stash log: {error}"),
                Some("Wait for the current Git operation to finish, then try again."),
            )
        })?;

    let write_result = (|| -> Result<(), AppError> {
        let contents = fs::read(&reflog_path).map_err(|error| {
            AppError::new(
                "readStashLogFailed",
                format!("Could not read the stash log: {error}"),
                Some("Refresh the repository and try again."),
            )
        })?;
        let lines = contents
            .split(|byte| *byte == b'\n')
            .enumerate()
            .filter(|(_, line)| !line.is_empty())
            .collect::<Vec<_>>();
        let (line_number, line) = lines.iter().rev().nth(index).copied().ok_or_else(|| {
            AppError::new(
                "unknownStash",
                "That stash no longer exists.",
                Some("Refresh the repository and choose the stash again."),
            )
        })?;
        let message_offset = line.iter().position(|byte| *byte == b'\t').ok_or_else(|| {
            AppError::new(
                "invalidStashLog",
                "The stash log has an unexpected format.",
                Some("Use Git to inspect or repair the stash log, then refresh."),
            )
        })?;
        let actual_oid = line[..message_offset]
            .split(|byte| *byte == b' ')
            .nth(1)
            .unwrap_or_default();
        if actual_oid != expected_oid.as_bytes() {
            return Err(AppError::new(
                "staleStash",
                "The stash stack changed before its message could be updated.",
                Some("Refresh the repository and choose the stash again."),
            ));
        }
        let line_start = contents
            .split(|byte| *byte == b'\n')
            .take(line_number)
            .map(|line| line.len() + 1)
            .sum::<usize>();
        let message_start = line_start + message_offset + 1;
        let line_end = line_start + line.len();
        let mut updated = Vec::with_capacity(contents.len() + message.len());
        updated.extend_from_slice(&contents[..message_start]);
        updated.extend_from_slice(message.as_bytes());
        updated.extend_from_slice(&contents[line_end..]);
        lock_file.write_all(&updated).map_err(|error| {
            AppError::new(
                "writeStashLogFailed",
                format!("Could not update the stash log: {error}"),
                Some("Check that the repository is writable."),
            )
        })?;
        lock_file.sync_all().map_err(|error| {
            AppError::new(
                "writeStashLogFailed",
                format!("Could not save the stash log: {error}"),
                Some("Check that the repository is writable."),
            )
        })
    })();
    drop(lock_file);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&lock_path);
        return Err(error);
    }
    fs::rename(&lock_path, &reflog_path).map_err(|error| {
        let _ = fs::remove_file(&lock_path);
        AppError::new(
            "commitStashLogFailed",
            format!("Could not commit the stash message update: {error}"),
            Some("Check that the repository is writable, then try again."),
        )
    })
}

pub fn pop_stash(path: &Path) -> Result<(), AppError> {
    run_mutation(path, &["stash", "pop"], "pop the latest stash")
}

pub fn pop_stash_entry(path: &Path, reference: &str) -> Result<(), AppError> {
    validate_stash_reference(reference)?;
    run_mutation(path, &["stash", "pop", reference], "pop that stash")
}

pub fn apply_stash(path: &Path, reference: &str) -> Result<(), AppError> {
    validate_stash_reference(reference)?;
    run_mutation(path, &["stash", "apply", reference], "apply that stash")
}

pub fn stash_details(path: &Path, reference: &str) -> Result<CommitDetails, AppError> {
    validate_stash_reference(reference)?;
    let oid_output = run_git(path, &["rev-parse", "--verify", reference])?;
    ensure_success("resolve that stash", &oid_output)?;
    let oid = String::from_utf8_lossy(&oid_output.stdout)
        .trim()
        .to_owned();
    let (message_output, message_truncated) = run_git_with_stdout_limit(
        path,
        &["show", "-s", "--format=%B", &oid, "--"],
        MAX_COMMIT_MESSAGE_BYTES,
    )?;
    if !message_truncated {
        ensure_success("read that stash", &message_output)?;
    }
    let (files_output, files_output_truncated) = run_git_with_stdout_limit(
        path,
        &[
            "stash",
            "show",
            "--name-status",
            "-z",
            "--include-untracked",
            "--find-renames",
            reference,
        ],
        MAX_COMMIT_DETAILS_BYTES,
    )?;
    if !files_output_truncated {
        ensure_success("read the files in that stash", &files_output)?;
    }
    let (stats_output, stats_output_truncated) = run_git_with_stdout_limit(
        path,
        &[
            "stash",
            "show",
            "--numstat",
            "-z",
            "--include-untracked",
            "--find-renames",
            reference,
        ],
        MAX_COMMIT_DETAILS_BYTES,
    )?;
    if !stats_output_truncated {
        ensure_success("read the file statistics in that stash", &stats_output)?;
    }
    let mut files = parse_commit_files_with_stats(&files_output.stdout, &stats_output.stdout);
    let files_truncated =
        files_output_truncated || stats_output_truncated || files.len() > MAX_COMMIT_FILES;
    files.truncate(MAX_COMMIT_FILES);
    let mut message = String::from_utf8_lossy(&message_output.stdout)
        .trim_end()
        .to_owned();
    if message_truncated {
        message.push_str("\n\n[Commit message truncated]");
    }
    Ok(CommitDetails {
        oid,
        message,
        signature: CommitSignature {
            status: "unsigned".to_owned(),
            signer: None,
            key: None,
            fingerprint: None,
            trust: None,
        },
        files,
        files_truncated,
    })
}

pub fn stash_file_diff(
    path: &Path,
    reference: &str,
    file: &str,
    previous_file: Option<&str>,
) -> Result<CommitFileDiff, AppError> {
    validate_stash_reference(reference)?;
    if file.is_empty() {
        return Err(AppError::new(
            "invalidPath",
            "Choose a file to inspect.",
            None,
        ));
    }
    let oid_output = run_git(path, &["rev-parse", "--verify", reference])?;
    ensure_success("resolve that stash", &oid_output)?;
    let oid = String::from_utf8_lossy(&oid_output.stdout)
        .trim()
        .to_owned();
    let untracked_tree = format!("{oid}^3");
    let untracked = run_git(
        path,
        &[
            "ls-tree",
            "-r",
            "--name-only",
            "-z",
            &untracked_tree,
            "--",
            file,
        ],
    )
    .is_ok_and(|output| output.status.success() && !output.stdout.is_empty());
    let base = if untracked {
        EMPTY_TREE_OID.to_owned()
    } else {
        format!("{oid}^1")
    };
    let target = if untracked {
        untracked_tree
    } else {
        oid.clone()
    };
    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--unified=3",
        &base,
        &target,
        "--",
        file,
    ];
    if let Some(previous_file) = previous_file.filter(|previous| *previous != file) {
        args.push(previous_file);
    }
    let (output, truncated) = run_git_with_stdout_limit(path, &args, MAX_FILE_DIFF_BYTES)?;
    if !truncated {
        ensure_success("read that stashed file's changes", &output)?;
    }
    let bytes = &output.stdout[..output.stdout.len().min(MAX_FILE_DIFF_BYTES)];
    Ok(CommitFileDiff {
        oid,
        path: file.to_owned(),
        patch: String::from_utf8_lossy(bytes).into_owned(),
        truncated,
    })
}

pub fn drop_stash(path: &Path, reference: &str) -> Result<(), AppError> {
    validate_stash_reference(reference)?;
    run_mutation(path, &["stash", "drop", reference], "delete that stash")
}

pub fn create_tag(
    path: &Path,
    name: &str,
    oid: &str,
    message: Option<&str>,
) -> Result<(), AppError> {
    validate_tag_name(path, name)?;
    validate_commit_oid(oid)?;
    if let Some(message) = message {
        let message = message.trim();
        if message.is_empty() || message.len() > MAX_COMMIT_MESSAGE_BYTES || message.contains('\0')
        {
            return Err(AppError::new(
                "invalidTagMessage",
                "Enter a tag message between 1 byte and 1 MB.",
                None,
            ));
        }
        run_mutation(
            path,
            &["tag", "--annotate", "--message", message, name, oid],
            "create that annotated tag",
        )
    } else {
        run_mutation(path, &["tag", name, oid], "create that tag")
    }
}

pub fn cherry_pick(path: &Path, oid: &str) -> Result<(), AppError> {
    cherry_pick_commits(path, &[oid.to_owned()])
}

pub fn cherry_pick_commits(path: &Path, oids: &[String]) -> Result<(), AppError> {
    if oids.is_empty() {
        return Err(AppError::new(
            "invalidCommit",
            "Select at least one commit to cherry-pick.",
            None,
        ));
    }
    for oid in oids {
        validate_commit_oid(oid)?;
    }
    let mut arguments = Vec::with_capacity(oids.len() + 1);
    arguments.push("cherry-pick");
    arguments.extend(oids.iter().map(String::as_str));
    run_mutation(path, &arguments, "cherry-pick the selected commits")
}

pub fn revert_commit(path: &Path, oid: &str) -> Result<(), AppError> {
    validate_commit_oid(oid)?;
    run_mutation(path, &["revert", "--no-edit", oid], "revert that commit")
}

pub fn control_history_operation(
    path: &Path,
    operation: &str,
    action: &str,
) -> Result<(), AppError> {
    if !matches!(operation, "cherry-pick" | "revert") {
        return Err(AppError::new(
            "invalidHistoryOperation",
            "That history operation is not supported.",
            Some("Choose cherry-pick or revert."),
        ));
    }
    let active = repository_operation_state(path)?.history;
    if active.as_deref() != Some(operation) {
        return Err(AppError::new(
            "historyOperationNotInProgress",
            format!("No {operation} operation is currently in progress."),
            None,
        ));
    }
    let option = match action {
        "continue" => "--continue",
        "skip" => "--skip",
        "abort" => "--abort",
        _ => {
            return Err(AppError::new(
                "invalidHistoryOperationAction",
                "That recovery action is not supported.",
                Some("Choose continue, skip, or abort."),
            ));
        }
    };
    run_mutation(
        path,
        &["-c", "core.editor=true", operation, option],
        &format!("{action} the {operation}"),
    )
}

pub fn reset_to_commit(path: &Path, oid: &str, mode: &str) -> Result<(), AppError> {
    validate_commit_oid(oid)?;
    let option = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => {
            return Err(AppError::new(
                "invalidResetMode",
                "That reset mode is invalid.",
                None,
            ));
        }
    };
    run_mutation(path, &["reset", option, oid], "reset to that commit")
}

pub fn start_bisect(path: &Path, bad_oid: &str, good_oid: &str) -> Result<(), AppError> {
    validate_commit_oid(bad_oid)?;
    validate_commit_oid(good_oid)?;
    if bad_oid == good_oid {
        return Err(AppError::new(
            "invalidBisectRange",
            "Choose different known-good and known-bad commits.",
            None,
        ));
    }
    let operations = repository_operation_state(path)?;
    if operations.rebase {
        return Err(AppError::new(
            "rebaseInProgress",
            "Finish or abort the current rebase before starting bisect.",
            None,
        ));
    }
    if operations.bisect {
        return Err(AppError::new(
            "bisectInProgress",
            "A bisect session is already in progress.",
            Some("Mark the current commit or reset the active bisect session."),
        ));
    }
    if read_status(path)?.entry_count > 0 {
        return Err(AppError::new(
            "workingTreeNotClean",
            "Commit or stash working directory changes before starting bisect.",
            None,
        ));
    }
    run_mutation(
        path,
        &["bisect", "start", bad_oid, good_oid],
        "start bisect",
    )
}

pub fn mark_bisect(path: &Path, verdict: &str) -> Result<(), AppError> {
    if !repository_operation_state(path)?.bisect {
        return Err(AppError::new(
            "bisectNotInProgress",
            "No bisect session is in progress.",
            None,
        ));
    }
    let verdict = match verdict {
        "good" => "good",
        "bad" => "bad",
        "skip" => "skip",
        _ => {
            return Err(AppError::new(
                "invalidBisectVerdict",
                "Choose Good, Bad, or Skip for the current commit.",
                None,
            ));
        }
    };
    run_mutation(path, &["bisect", verdict], "advance bisect")
}

pub fn reset_bisect(path: &Path) -> Result<(), AppError> {
    if !repository_operation_state(path)?.bisect {
        return Ok(());
    }
    run_mutation(path, &["bisect", "reset"], "reset bisect")
}

pub fn move_head_if_current(
    path: &Path,
    expected_oid: &str,
    target_oid: &str,
) -> Result<(), AppError> {
    validate_commit_oid(expected_oid)?;
    validate_commit_oid(target_oid)?;
    let current = snapshot(path)?.head_oid;
    if current.as_deref() != Some(expected_oid) {
        return Err(AppError::new(
            "historyChanged",
            "HEAD changed after that operation, so it cannot be safely undone or redone.",
            Some("Refresh the repository and inspect its current history."),
        ));
    }
    reset_to_commit(path, target_oid, "soft")
}

pub fn commit_details(path: &Path, oid: &str) -> Result<CommitDetails, AppError> {
    validate_commit_oid(oid)?;
    let rename_limit = format!("-l{COMMIT_RENAME_LIMIT}");
    let (message_output, message_truncated) = run_git_with_stdout_limit(
        path,
        &[
            "show",
            "-s",
            "--format=%G?%x00%GS%x00%GK%x00%GF%x00%GT%x00%B",
            oid,
            "--",
        ],
        MAX_COMMIT_MESSAGE_BYTES,
    )?;
    if !message_truncated {
        ensure_success("read that commit", &message_output)?;
    }
    let (files_output, files_output_truncated) = run_git_with_stdout_limit(
        path,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-z",
            "--find-renames",
            &rename_limit,
            oid,
            "--",
        ],
        MAX_COMMIT_DETAILS_BYTES,
    )?;
    if !files_output_truncated {
        ensure_success("read the files in that commit", &files_output)?;
    }
    let (stats_output, stats_output_truncated) = run_git_with_stdout_limit(
        path,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--numstat",
            "-r",
            "-z",
            "--find-renames",
            &rename_limit,
            oid,
            "--",
        ],
        MAX_COMMIT_DETAILS_BYTES,
    )?;
    if !stats_output_truncated {
        ensure_success("read the file statistics in that commit", &stats_output)?;
    }
    let mut files = parse_commit_files_with_stats(&files_output.stdout, &stats_output.stdout);
    let files_truncated =
        files_output_truncated || stats_output_truncated || files.len() > MAX_COMMIT_FILES;
    files.truncate(MAX_COMMIT_FILES);
    let (signature, mut message) = parse_commit_signature(&message_output.stdout);
    if message_truncated {
        message.push_str("\n\n[Commit message truncated]");
    }

    Ok(CommitDetails {
        oid: oid.to_owned(),
        message,
        signature,
        files,
        files_truncated,
    })
}

fn parse_commit_signature(output: &[u8]) -> (CommitSignature, String) {
    let text = String::from_utf8_lossy(output);
    let mut fields = text.splitn(6, '\0');
    let status = match fields.next().unwrap_or("N").trim() {
        "G" => "valid",
        "U" => "valid-unknown",
        "B" => "invalid",
        "X" => "expired-signature",
        "Y" => "expired-key",
        "R" => "revoked-key",
        "E" => "unverifiable",
        _ => "unsigned",
    };
    let optional_field = |field: Option<&str>| {
        field
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let signature = CommitSignature {
        status: status.to_owned(),
        signer: optional_field(fields.next()),
        key: optional_field(fields.next()),
        fingerprint: optional_field(fields.next()),
        trust: optional_field(fields.next()),
    };
    let message = fields.next().unwrap_or_default().trim_end().to_owned();
    (signature, message)
}

pub fn commit_file_diff(
    path: &Path,
    oid: &str,
    file: &str,
    previous_file: Option<&str>,
) -> Result<CommitFileDiff, AppError> {
    validate_commit_oid(oid)?;
    if file.is_empty() {
        return Err(AppError::new(
            "invalidPath",
            "Choose a file to inspect.",
            None,
        ));
    }
    let mut args = vec![
        "show",
        "--format=",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--unified=3",
        oid,
        "--",
        file,
    ];
    if let Some(previous_file) = previous_file.filter(|previous| *previous != file) {
        args.push(previous_file);
    }
    let (output, truncated) = run_git_with_stdout_limit(path, &args, MAX_FILE_DIFF_BYTES)?;
    if !truncated {
        ensure_success("read that file's changes", &output)?;
    }
    let bytes = &output.stdout[..output.stdout.len().min(MAX_FILE_DIFF_BYTES)];
    Ok(CommitFileDiff {
        oid: oid.to_owned(),
        path: file.to_owned(),
        patch: String::from_utf8_lossy(bytes).into_owned(),
        truncated,
    })
}

pub fn compare_commits(
    path: &Path,
    base_oid: &str,
    target_oid: &str,
) -> Result<CommitComparison, AppError> {
    validate_commit_oid(base_oid)?;
    validate_commit_oid(target_oid)?;
    if base_oid == target_oid {
        return Err(AppError::new(
            "identicalCommits",
            "Choose two different commits to compare.",
            None,
        ));
    }
    let output = run_git(
        path,
        &[
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            base_oid,
            target_oid,
            "--",
        ],
    )?;
    ensure_success("compare those commits", &output)?;
    let stats_output = run_git(
        path,
        &[
            "diff",
            "--numstat",
            "-z",
            "--find-renames",
            base_oid,
            target_oid,
            "--",
        ],
    )?;
    ensure_success(
        "read the file statistics for that comparison",
        &stats_output,
    )?;
    Ok(CommitComparison {
        base_oid: base_oid.to_owned(),
        target_oid: target_oid.to_owned(),
        working_tree: false,
        files: parse_commit_files_with_stats(&output.stdout, &stats_output.stdout),
    })
}

pub fn compare_commit_with_working_tree(
    path: &Path,
    base_oid: &str,
) -> Result<CommitComparison, AppError> {
    validate_commit_oid(base_oid)?;
    let output = run_git(
        path,
        &[
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            base_oid,
            "--",
        ],
    )?;
    ensure_success("compare that commit with the working directory", &output)?;
    let stats_output = run_git(
        path,
        &["diff", "--numstat", "-z", "--find-renames", base_oid, "--"],
    )?;
    ensure_success(
        "read the file statistics for that working directory comparison",
        &stats_output,
    )?;
    let mut files = parse_commit_files_with_stats(&output.stdout, &stats_output.stdout);
    for entry in read_status(path)?.entries {
        if entry.index_status != "?" || files.iter().any(|file| file.path == entry.path) {
            continue;
        }
        let contents = fs::read(path.join(&entry.path)).ok();
        let additions = contents.as_deref().and_then(|bytes| {
            if bytes.contains(&0) {
                None
            } else {
                std::str::from_utf8(bytes)
                    .ok()
                    .map(|text| text.lines().count())
            }
        });
        files.push(CommitFile {
            status: "A".to_owned(),
            path: entry.path,
            previous_path: None,
            additions,
            deletions: additions.map(|_| 0),
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(CommitComparison {
        base_oid: base_oid.to_owned(),
        target_oid: base_oid.to_owned(),
        working_tree: true,
        files,
    })
}

pub fn compare_commit_file_with_working_tree(
    path: &Path,
    base_oid: &str,
    file: &str,
    previous_file: Option<&str>,
) -> Result<CommitFileDiff, AppError> {
    validate_commit_oid(base_oid)?;
    validate_relative_path(
        file,
        "invalidPath",
        "Choose a repository-relative file to compare.",
    )?;
    let untracked = read_status(path)?
        .entries
        .into_iter()
        .any(|entry| entry.path == file && entry.index_status == "?");
    let output = if untracked {
        run_git(
            path,
            &[
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-color",
                "--unified=3",
                "--",
                "/dev/null",
                file,
            ],
        )?
    } else {
        let mut args = vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--find-renames",
            "--unified=3",
            base_oid,
            "--",
            file,
        ];
        if let Some(previous_file) = previous_file.filter(|previous| *previous != file) {
            args.push(previous_file);
        }
        run_git(path, &args)?
    };
    if untracked {
        if !output.status.success() && output.status.code() != Some(1) {
            ensure_success("compare that untracked file", &output)?;
        }
    } else {
        ensure_success("compare that working directory file", &output)?;
    }
    let truncated = output.stdout.len() > MAX_FILE_DIFF_BYTES;
    let bytes = &output.stdout[..output.stdout.len().min(MAX_FILE_DIFF_BYTES)];
    Ok(CommitFileDiff {
        oid: base_oid.to_owned(),
        path: file.to_owned(),
        patch: String::from_utf8_lossy(bytes).into_owned(),
        truncated,
    })
}

pub fn compare_commit_file(
    path: &Path,
    base_oid: &str,
    target_oid: &str,
    file: &str,
    previous_file: Option<&str>,
) -> Result<CommitFileDiff, AppError> {
    validate_commit_oid(base_oid)?;
    validate_commit_oid(target_oid)?;
    if file.is_empty() {
        return Err(AppError::new(
            "invalidPath",
            "Choose a file to inspect.",
            None,
        ));
    }
    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--unified=3",
        base_oid,
        target_oid,
        "--",
        file,
    ];
    if let Some(previous_file) = previous_file.filter(|previous| *previous != file) {
        args.push(previous_file);
    }
    let (output, truncated) = run_git_with_stdout_limit(path, &args, MAX_FILE_DIFF_BYTES)?;
    if !truncated {
        ensure_success("compare that file", &output)?;
    }
    let bytes = &output.stdout[..output.stdout.len().min(MAX_FILE_DIFF_BYTES)];
    Ok(CommitFileDiff {
        oid: target_oid.to_owned(),
        path: file.to_owned(),
        patch: String::from_utf8_lossy(bytes).into_owned(),
        truncated,
    })
}

pub fn working_tree_file_diff(
    path: &Path,
    file: &str,
    staged: bool,
) -> Result<WorkingTreeFileDiff, AppError> {
    let (entry, output) = read_working_tree_patch(path, file, staged)?;
    if entry.index_status != "?" || staged {
        ensure_success("read that file's changes", &output)?;
    }
    let truncated = output.stdout.len() > MAX_FILE_DIFF_BYTES;
    let bytes = &output.stdout[..output.stdout.len().min(MAX_FILE_DIFF_BYTES)];
    Ok(WorkingTreeFileDiff {
        path: file.to_owned(),
        staged,
        patch: String::from_utf8_lossy(bytes).into_owned(),
        truncated,
    })
}

pub fn file_history(
    path: &Path,
    revision: &str,
    file: &str,
) -> Result<Vec<FileHistoryEntry>, AppError> {
    validate_commit_oid(revision)?;
    if file.is_empty() {
        return Err(AppError::new(
            "invalidPath",
            "Choose a file to inspect.",
            None,
        ));
    }
    let output = run_git(
        path,
        &[
            "log",
            "--follow",
            "-200",
            "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
            revision,
            "--",
            file,
        ],
    )?;
    ensure_success("read that file's history", &output)?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .split('\x1e')
        .filter_map(|record| {
            let fields = record
                .trim_start_matches('\n')
                .split('\x1f')
                .collect::<Vec<_>>();
            (fields.len() >= 5).then(|| FileHistoryEntry {
                oid: fields[0].to_owned(),
                author_name: fields[1].to_owned(),
                author_email: fields[2].to_owned(),
                authored_at: fields[3].to_owned(),
                subject: fields[4].trim_end_matches('\n').to_owned(),
            })
        })
        .collect())
}

pub fn file_blame(path: &Path, revision: &str, file: &str) -> Result<Vec<FileBlameLine>, AppError> {
    validate_commit_oid(revision)?;
    if file.is_empty() {
        return Err(AppError::new(
            "invalidPath",
            "Choose a file to inspect.",
            None,
        ));
    }
    let output = run_git(path, &["blame", "--line-porcelain", revision, "--", file])?;
    ensure_success("read blame information for that file", &output)?;
    parse_blame_porcelain(&String::from_utf8_lossy(&output.stdout))
}

pub fn restore_files_from_commit(path: &Path, oid: &str, files: &[String]) -> Result<(), AppError> {
    validate_commit_oid(oid)?;
    if files.is_empty() || files.iter().any(|file| file.is_empty()) {
        return Err(AppError::new(
            "invalidPath",
            "Choose at least one file to restore.",
            None,
        ));
    }
    let mut arguments = vec![
        "restore".to_owned(),
        "--source".to_owned(),
        oid.to_owned(),
        "--staged".to_owned(),
        "--worktree".to_owned(),
        "--".to_owned(),
    ];
    arguments.extend(files.iter().cloned());
    let borrowed = arguments.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_git(path, &borrowed)?;
    ensure_success("restore files from that commit", &output)
}

pub fn conflict_details(path: &Path, file: &str) -> Result<ConflictDetails, AppError> {
    let entry = validate_worktree_path(path, file)?;
    if !entry.conflicted {
        return Err(AppError::new(
            "notConflicted",
            "That file is no longer conflicted.",
            Some("Refresh the repository and choose another file."),
        ));
    }
    let ancestor = read_conflict_stage(path, file, 1)?;
    let current = read_conflict_stage(path, file, 2)?;
    let incoming = read_conflict_stage(path, file, 3)?;
    let output_bytes = fs::read(path.join(file)).ok();
    let truncated = [&ancestor, &current, &incoming, &output_bytes]
        .into_iter()
        .flatten()
        .any(|bytes| bytes.len() > MAX_FILE_DIFF_BYTES);
    let binary = [&ancestor, &current, &incoming, &output_bytes]
        .into_iter()
        .flatten()
        .any(|bytes| bytes.contains(&0) || std::str::from_utf8(bytes).is_err());
    let text = |value: Option<Vec<u8>>| {
        (!binary)
            .then(|| {
                value.map(|bytes| {
                    String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_FILE_DIFF_BYTES)])
                        .into_owned()
                })
            })
            .flatten()
    };
    Ok(ConflictDetails {
        path: file.to_owned(),
        ancestor: text(ancestor),
        current: text(current),
        incoming: text(incoming),
        output: text(output_bytes),
        binary,
        truncated,
    })
}

pub fn resolve_conflict(
    path: &Path,
    file: &str,
    resolution: &str,
    output: Option<&str>,
) -> Result<(), AppError> {
    let entry = validate_worktree_path(path, file)?;
    if !entry.conflicted {
        return Err(AppError::new(
            "notConflicted",
            "That file is no longer conflicted.",
            Some("Refresh the repository and choose another file."),
        ));
    }
    match resolution {
        "current" | "incoming" => {
            let (stage, option) = if resolution == "current" {
                (2, "--ours")
            } else {
                (3, "--theirs")
            };
            if read_conflict_stage(path, file, stage)?.is_some() {
                run_mutation(
                    path,
                    &["checkout", option, "--", file],
                    "choose that conflict side",
                )?;
                run_mutation(path, &["add", "--", file], "mark that conflict resolved")
            } else {
                run_mutation(path, &["rm", "-f", "--", file], "accept that file deletion")
            }
        }
        "output" => {
            let contents = output.ok_or_else(|| {
                AppError::new(
                    "missingConflictOutput",
                    "The resolved output is missing.",
                    None,
                )
            })?;
            if contents.len() > MAX_FILE_DIFF_BYTES {
                return Err(AppError::new(
                    "conflictOutputTooLarge",
                    "The resolved output is larger than 1 MB.",
                    Some("Use an external merge tool for this file."),
                ));
            }
            fs::write(path.join(file), contents).map_err(|error| {
                AppError::new(
                    "conflictWriteFailed",
                    format!("Could not save the resolved file: {error}"),
                    None,
                )
            })?;
            run_mutation(path, &["add", "--", file], "mark that conflict resolved")
        }
        _ => Err(AppError::new(
            "invalidConflictResolution",
            "Choose Current, Incoming, or edited Output.",
            None,
        )),
    }
}

pub fn apply_working_tree_hunk(
    path: &Path,
    file: &str,
    staged: bool,
    hunk_index: usize,
    action: &str,
) -> Result<(), AppError> {
    let (entry, output) = read_working_tree_patch(path, file, staged)?;
    if entry.index_status == "?" {
        return Err(AppError::new(
            "untrackedPartialStageUnsupported",
            "Stage the untracked file before selecting individual hunks.",
            None,
        ));
    }
    ensure_success("read that file's changes", &output)?;
    let full_patch = String::from_utf8_lossy(&output.stdout);
    let patch = select_patch_hunk(&full_patch, hunk_index)?;
    let (args, operation): (&[&str], &str) = match (staged, action) {
        (false, "stage") => (
            &["apply", "--cached", "--recount", "--whitespace=nowarn", "-"],
            "stage that hunk",
        ),
        (true, "unstage") => (
            &[
                "apply",
                "--cached",
                "--reverse",
                "--recount",
                "--whitespace=nowarn",
                "-",
            ],
            "unstage that hunk",
        ),
        (false, "discard") => (
            &[
                "apply",
                "--reverse",
                "--recount",
                "--whitespace=nowarn",
                "-",
            ],
            "discard that hunk",
        ),
        _ => {
            return Err(AppError::new(
                "invalidHunkAction",
                "That hunk action is not available for this diff.",
                Some("Refresh the repository and try again."),
            ));
        }
    };
    run_git_with_input(path, args, patch.as_bytes(), operation)
}

pub fn apply_working_tree_lines(
    path: &Path,
    file: &str,
    staged: bool,
    hunk_index: usize,
    line_indices: &[usize],
    action: &str,
) -> Result<(), AppError> {
    if line_indices.is_empty() || line_indices.len() > 10_000 {
        return Err(AppError::new(
            "invalidLineSelection",
            "Select at least one changed line.",
            None,
        ));
    }
    let (entry, output) = read_working_tree_patch(path, file, staged)?;
    if entry.index_status == "?" {
        return Err(AppError::new(
            "untrackedPartialStageUnsupported",
            "Stage the untracked file before selecting individual lines.",
            None,
        ));
    }
    ensure_success("read that file's changes", &output)?;
    let full_patch = String::from_utf8_lossy(&output.stdout);
    let patch = select_patch_lines(&full_patch, hunk_index, line_indices)?;
    let (args, operation): (&[&str], &str) = match (staged, action) {
        (false, "stage") => (
            &["apply", "--cached", "--recount", "--whitespace=nowarn", "-"],
            "stage those lines",
        ),
        (true, "unstage") => (
            &[
                "apply",
                "--cached",
                "--reverse",
                "--recount",
                "--whitespace=nowarn",
                "-",
            ],
            "unstage those lines",
        ),
        (false, "discard") => (
            &[
                "apply",
                "--reverse",
                "--recount",
                "--whitespace=nowarn",
                "-",
            ],
            "discard those lines",
        ),
        _ => {
            return Err(AppError::new(
                "invalidLineAction",
                "That line action is not available for this diff.",
                Some("Refresh the repository and try again."),
            ));
        }
    };
    run_git_with_input(path, args, patch.as_bytes(), operation)
}

fn read_working_tree_patch(
    path: &Path,
    file: &str,
    staged: bool,
) -> Result<(WorkingTreeEntry, Output), AppError> {
    let entry = validate_worktree_path(path, file)?;
    let output = if staged {
        run_git(
            path,
            &[
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-color",
                "--unified=3",
                "--",
                file,
            ],
        )?
    } else if entry.index_status == "?" {
        run_git_allow_diff_exit(
            path,
            &[
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-color",
                "--unified=3",
                "--",
                "/dev/null",
                file,
            ],
        )?
    } else {
        run_git(
            path,
            &[
                "diff",
                "--no-ext-diff",
                "--no-color",
                "--unified=3",
                "--",
                file,
            ],
        )?
    };
    Ok((entry, output))
}

fn select_patch_hunk(patch: &str, hunk_index: usize) -> Result<String, AppError> {
    let lines = patch.split_inclusive('\n').collect::<Vec<_>>();
    let first_hunk = lines
        .iter()
        .position(|line| line.starts_with("@@ "))
        .ok_or_else(|| {
            AppError::new(
                "missingDiffHunk",
                "That change has no selectable text hunk.",
                None,
            )
        })?;
    let starts = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| line.starts_with("@@ ").then_some(index))
        .collect::<Vec<_>>();
    let start = *starts.get(hunk_index).ok_or_else(|| {
        AppError::new(
            "staleDiffHunk",
            "That diff hunk no longer exists.",
            Some("The file changed. Review its latest diff and try again."),
        )
    })?;
    let end = starts.get(hunk_index + 1).copied().unwrap_or(lines.len());
    Ok(lines[..first_hunk]
        .iter()
        .chain(lines[start..end].iter())
        .copied()
        .collect())
}

fn select_patch_lines(
    patch: &str,
    hunk_index: usize,
    line_indices: &[usize],
) -> Result<String, AppError> {
    let selected = line_indices
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    if selected.len() != line_indices.len() {
        return Err(AppError::new(
            "invalidLineSelection",
            "The selected lines contain duplicates.",
            None,
        ));
    }
    let hunk = select_patch_hunk(patch, hunk_index)?;
    let lines = hunk.split_inclusive('\n').collect::<Vec<_>>();
    let hunk_start = lines
        .iter()
        .position(|line| line.starts_with("@@ "))
        .ok_or_else(|| AppError::new("missingDiffHunk", "That change has no text hunk.", None))?;
    let mut output = lines[..=hunk_start].concat();
    let body = &lines[hunk_start + 1..];
    let mut index = 0;
    let mut change_index = 0;
    let mut seen = 0;
    let mut last_emitted = true;
    while index < body.len() {
        if body[index].starts_with('-') {
            let mut deletions = Vec::new();
            while body.get(index).is_some_and(|line| line.starts_with('-')) {
                deletions.push((body[index], change_index));
                change_index += 1;
                index += 1;
            }
            let mut additions = Vec::new();
            while body.get(index).is_some_and(|line| line.starts_with('+')) {
                additions.push((body[index], change_index));
                change_index += 1;
                index += 1;
            }
            let pairs = deletions.len().min(additions.len());
            for pair in 0..pairs {
                let chosen =
                    selected.contains(&deletions[pair].1) || selected.contains(&additions[pair].1);
                if chosen {
                    output.push_str(deletions[pair].0);
                    output.push_str(additions[pair].0);
                    seen += usize::from(selected.contains(&deletions[pair].1));
                    seen += usize::from(selected.contains(&additions[pair].1));
                } else {
                    output.push(' ');
                    output.push_str(&deletions[pair].0[1..]);
                }
                last_emitted = true;
            }
            for (line, line_index) in &deletions[pairs..] {
                if selected.contains(line_index) {
                    output.push_str(line);
                    seen += 1;
                } else {
                    output.push(' ');
                    output.push_str(&line[1..]);
                }
                last_emitted = true;
            }
            for (line, line_index) in &additions[pairs..] {
                last_emitted = selected.contains(line_index);
                if last_emitted {
                    output.push_str(line);
                    seen += 1;
                }
            }
            continue;
        }
        if body[index].starts_with('+') {
            last_emitted = selected.contains(&change_index);
            if last_emitted {
                output.push_str(body[index]);
                seen += 1;
            }
            change_index += 1;
        } else if body[index].starts_with("\\ ") {
            if last_emitted {
                output.push_str(body[index]);
            }
        } else {
            output.push_str(body[index]);
            last_emitted = true;
        }
        index += 1;
    }
    if seen != selected.len() {
        return Err(AppError::new(
            "staleDiffLine",
            "One or more selected lines no longer exist.",
            Some("The file changed. Review its latest diff and try again."),
        ));
    }
    Ok(output)
}

fn validate_commit_oid(oid: &str) -> Result<(), AppError> {
    if matches!(oid.len(), 40 | 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(AppError::new(
            "invalidCommit",
            "That commit identifier is invalid.",
            Some("Refresh the repository and choose the commit again."),
        ))
    }
}

fn validate_commitish(path: &Path, reference: &str) -> Result<(), AppError> {
    if reference.is_empty() || reference.starts_with('-') || reference.contains(['\0', '\n', '\r'])
    {
        return Err(AppError::new(
            "invalidRevision",
            "Choose a valid base branch or commit.",
            None,
        ));
    }
    let revision = format!("{reference}^{{commit}}");
    let output = run_git(
        path,
        &["rev-parse", "--verify", "--end-of-options", &revision],
    )?;
    ensure_success("find that session base", &output)
}

fn validate_worktree_path(path: &Path, file: &str) -> Result<WorkingTreeEntry, AppError> {
    let candidate = Path::new(file);
    let safe = !file.is_empty()
        && !file.contains(['\0', '\n', '\r'])
        && candidate
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if !safe {
        return Err(AppError::new(
            "invalidWorkingTreePath",
            "That working tree path is invalid.",
            Some("Refresh the repository and choose the file again."),
        ));
    }
    read_status(path)?
        .entries
        .into_iter()
        .find(|entry| entry.path == file)
        .ok_or_else(|| {
            AppError::new(
                "unknownWorkingTreeFile",
                "That file is no longer changed.",
                Some("Refresh the repository and choose the file again."),
            )
        })
}

fn escape_gitignore_literal(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| {
            if matches!(character, '\\' | '!' | '#' | '[' | ']' | '*' | '?' | ' ') {
                vec!['\\', character]
            } else {
                vec![character]
            }
        })
        .collect()
}

fn parse_commit_files(output: &[u8]) -> Vec<CommitFile> {
    let records = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let status = String::from_utf8_lossy(records[index])
            .trim_start_matches('\n')
            .to_owned();
        index += 1;
        if index >= records.len() {
            break;
        }
        if (status.starts_with('R') || status.starts_with('C')) && index + 1 < records.len() {
            let previous_path = String::from_utf8_lossy(records[index]).into_owned();
            let path = String::from_utf8_lossy(records[index + 1]).into_owned();
            files.push(CommitFile {
                status,
                path,
                previous_path: Some(previous_path),
                additions: None,
                deletions: None,
            });
            index += 2;
        } else {
            files.push(CommitFile {
                status,
                path: String::from_utf8_lossy(records[index]).into_owned(),
                previous_path: None,
                additions: None,
                deletions: None,
            });
            index += 1;
        }
    }
    files
}

fn parse_commit_files_with_stats(status_output: &[u8], stats_output: &[u8]) -> Vec<CommitFile> {
    let mut files = parse_commit_files(status_output);
    let stats = parse_numstat(stats_output);
    for file in &mut files {
        if let Some((additions, deletions)) = stats.get(&file.path) {
            file.additions = *additions;
            file.deletions = *deletions;
        }
    }
    files
}

fn parse_numstat(
    output: &[u8],
) -> std::collections::HashMap<String, (Option<usize>, Option<usize>)> {
    let records = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    let mut stats = std::collections::HashMap::new();
    let mut index = 0;
    while index < records.len() {
        let record = records[index].strip_prefix(b"\n").unwrap_or(records[index]);
        let mut fields = record.splitn(3, |byte| *byte == b'\t');
        let additions = fields.next().and_then(parse_numstat_count);
        let deletions = fields.next().and_then(parse_numstat_count);
        let inline_path = fields.next().unwrap_or_default();
        index += 1;
        let path = if inline_path.is_empty() && index + 1 < records.len() {
            index += 1;
            let renamed_path = records[index];
            index += 1;
            renamed_path
        } else {
            inline_path
        };
        if !path.is_empty() {
            stats.insert(
                String::from_utf8_lossy(path).into_owned(),
                (additions, deletions),
            );
        }
    }
    stats
}

fn parse_numstat_count(value: &[u8]) -> Option<usize> {
    (value != b"-")
        .then(|| String::from_utf8_lossy(value).parse().ok())
        .flatten()
}

fn parse_blame_porcelain(output: &str) -> Result<Vec<FileBlameLine>, AppError> {
    let mut lines = output.lines();
    let mut blamed = Vec::new();
    while let Some(header) = lines.next() {
        let fields = header.split_ascii_whitespace().collect::<Vec<_>>();
        if fields.len() < 3
            || !(fields[0].len() == 40 || fields[0].len() == 64)
            || !fields[0].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(AppError::new(
                "invalidBlameOutput",
                "Git returned blame data in an unsupported format.",
                Some("Update Git and try inspecting the file again."),
            ));
        }
        let line_number = fields[2].parse::<usize>().map_err(|_| {
            AppError::new(
                "invalidBlameOutput",
                "Git returned an invalid blame line number.",
                None,
            )
        })?;
        let oid = fields[0].to_owned();
        let mut author_name = String::new();
        let mut author_email = String::new();
        let mut authored_at = 0_i64;
        let mut summary = String::new();
        let mut text = None;
        for metadata in lines.by_ref() {
            if let Some(contents) = metadata.strip_prefix('\t') {
                text = Some(contents.to_owned());
                break;
            }
            if let Some(value) = metadata.strip_prefix("author ") {
                author_name = value.to_owned();
            } else if let Some(value) = metadata.strip_prefix("author-mail ") {
                author_email = value.trim_matches(['<', '>']).to_owned();
            } else if let Some(value) = metadata.strip_prefix("author-time ") {
                authored_at = value.parse().unwrap_or_default();
            } else if let Some(value) = metadata.strip_prefix("summary ") {
                summary = value.to_owned();
            }
        }
        blamed.push(FileBlameLine {
            line_number,
            oid,
            author_name,
            author_email,
            authored_at,
            summary,
            text: text.unwrap_or_default(),
        });
    }
    Ok(blamed)
}

fn validate_branch_name(path: &Path, name: &str) -> Result<(), AppError> {
    if name.trim() != name || name.is_empty() || name.starts_with('-') {
        return Err(AppError::new(
            "invalidBranchName",
            "Enter a valid branch name.",
            None,
        ));
    }
    let output = run_git(path, &["check-ref-format", "--branch", name])?;
    ensure_success("validate that branch name", &output)
}

fn read_status(path: &Path) -> Result<RepositoryStatus, AppError> {
    read_status_with_limit(path, usize::MAX)
}

pub fn status_with_entry_limit(
    path: &Path,
    entry_limit: usize,
) -> Result<RepositoryStatus, AppError> {
    read_status_with_limit(path, entry_limit)
}

pub fn status_with_entry_limit_fast(
    path: &Path,
    entry_limit: usize,
) -> Result<RepositoryStatus, AppError> {
    read_status_with_limit_mode(path, entry_limit, "normal")
}

fn read_status_with_limit(path: &Path, entry_limit: usize) -> Result<RepositoryStatus, AppError> {
    read_status_with_limit_mode(path, entry_limit, "all")
}

fn read_status_with_limit_mode(
    path: &Path,
    entry_limit: usize,
    untracked_files: &str,
) -> Result<RepositoryStatus, AppError> {
    let (output, output_truncated, overflow) =
        run_status_with_limit(path, entry_limit, untracked_files)?;
    let records = output.stdout.split(|byte| *byte == 0).collect::<Vec<_>>();
    let operations = repository_operation_state(path)?;
    let mut status = RepositoryStatus {
        merge_in_progress: operations.merge,
        history_operation: operations.history.clone(),
        rebase_in_progress: operations.rebase,
        bisect_in_progress: operations.bisect,
        ..RepositoryStatus::default()
    };
    let mut index = 0;

    while index < records.len() {
        let record = records[index];
        if record.is_empty() {
            index += 1;
            continue;
        }
        if record.starts_with(b"## ") {
            parse_branch_header(&String::from_utf8_lossy(&record[3..]), &mut status);
            index += 1;
            continue;
        }
        if record.len() < 3 {
            index += 1;
            continue;
        }

        let x = record[0] as char;
        let y = record[1] as char;
        let code = &record[..2];
        let conflicted = matches!(code, b"DD" | b"AU" | b"UD" | b"UA" | b"DU" | b"AA" | b"UU");
        let untracked = code == b"??";
        if conflicted {
            status.conflicted += 1;
        } else if untracked {
            status.untracked += 1;
        } else {
            if x != ' ' && x != '!' {
                status.staged += 1;
            }
            if y != ' ' && y != '!' {
                status.unstaged += 1;
            }
        }
        status.entry_count += 1;
        if status.entries.len() < entry_limit {
            status.entries.push(WorkingTreeEntry {
                path: String::from_utf8_lossy(&record[3..]).into_owned(),
                index_status: x.to_string(),
                worktree_status: y.to_string(),
                conflicted,
            });
        }

        index += if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            2
        } else {
            1
        };
    }
    status.staged += overflow.staged;
    status.unstaged += overflow.unstaged;
    status.untracked += overflow.untracked;
    status.conflicted += overflow.conflicted;
    status.entry_count += overflow.entry_count;
    status.entries_truncated = output_truncated || status.entry_count > status.entries.len();
    Ok(status)
}

fn read_head_status(path: &Path) -> Result<RepositoryStatus, AppError> {
    let branch = run_git(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let branch = branch
        .status
        .success()
        .then(|| String::from_utf8_lossy(&branch.stdout).trim().to_owned())
        .filter(|value| !value.is_empty());
    let operations = repository_operation_state(path)?;
    Ok(RepositoryStatus {
        branch,
        merge_in_progress: operations.merge,
        history_operation: operations.history,
        rebase_in_progress: operations.rebase,
        bisect_in_progress: operations.bisect,
        ..RepositoryStatus::default()
    })
}

#[derive(Default)]
struct StatusOverflow {
    staged: usize,
    unstaged: usize,
    untracked: usize,
    conflicted: usize,
    entry_count: usize,
}

impl StatusOverflow {
    fn record(&mut self, code: &[u8]) {
        let x = code[0] as char;
        let y = code[1] as char;
        let conflicted = matches!(code, b"DD" | b"AU" | b"UD" | b"UA" | b"DU" | b"AA" | b"UU");
        if conflicted {
            self.conflicted += 1;
        } else if code == b"??" {
            self.untracked += 1;
        } else {
            if x != ' ' && x != '!' {
                self.staged += 1;
            }
            if y != ' ' && y != '!' {
                self.unstaged += 1;
            }
        }
        self.entry_count += 1;
    }
}

fn run_status_with_limit(
    path: &Path,
    entry_limit: usize,
    untracked_files: &str,
) -> Result<(Output, bool, StatusOverflow), AppError> {
    let untracked_argument = format!("--untracked-files={untracked_files}");
    let args = [
        "status",
        "--porcelain=v1",
        "-z",
        "--branch",
        untracked_argument.as_str(),
    ];
    if entry_limit == usize::MAX {
        let output = run_git(path, &args)?;
        ensure_success("read repository status", &output)?;
        return Ok((output, false, StatusOverflow::default()));
    }

    let mut child = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start Git: {error}"),
                Some("Install Git and ensure it is available on PATH."),
            )
        })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        AppError::new(
            "gitFailure",
            "Git Chronos could not read repository status output.",
            Some("Try refreshing the repository."),
        )
    })?;
    let mut reader = BufReader::new(stdout);
    let mut captured = Vec::new();
    let mut record = Vec::new();
    let mut entry_count = 0usize;
    let mut expect_rename_source = false;
    let mut capture_rename_source = false;
    let mut truncated = false;
    let mut overflow = StatusOverflow::default();

    loop {
        record.clear();
        if reader.read_until(0, &mut record).map_err(|error| {
            AppError::new(
                "gitFailure",
                format!("Git Chronos could not read repository status: {error}"),
                Some("Try refreshing the repository."),
            )
        })? == 0
        {
            break;
        }
        if expect_rename_source {
            if capture_rename_source {
                captured.extend_from_slice(&record);
            }
            expect_rename_source = false;
            capture_rename_source = false;
            continue;
        }
        let content = record.strip_suffix(&[0]).unwrap_or(&record);
        let status_record = content.len() >= 3 && !content.starts_with(b"## ");
        if status_record {
            entry_count = entry_count.saturating_add(1);
            if entry_count > entry_limit {
                truncated = true;
                overflow.record(&content[..2]);
                let x = content[0] as char;
                let y = content[1] as char;
                expect_rename_source = matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C');
                continue;
            }
            let x = content[0] as char;
            let y = content[1] as char;
            expect_rename_source = matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C');
            capture_rename_source = expect_rename_source;
        }
        captured.extend_from_slice(&record);
    }

    let mut stderr = Vec::new();
    if let Some(mut stream) = child.stderr.take() {
        stream.read_to_end(&mut stderr).map_err(|error| {
            AppError::new(
                "gitFailure",
                format!("Git Chronos could not read a Git error: {error}"),
                Some("Try refreshing the repository."),
            )
        })?;
    }
    let status = child.wait().map_err(|error| {
        AppError::new(
            "gitFailure",
            format!("Git Chronos could not finish reading repository status: {error}"),
            Some("Try refreshing the repository."),
        )
    })?;
    let output = Output {
        status,
        stdout: captured,
        stderr,
    };
    ensure_success("read repository status", &output)?;
    Ok((output, truncated, overflow))
}

fn parse_branch_header(header: &str, status: &mut RepositoryStatus) {
    let branch_part = header.split("...").next().unwrap_or(header);
    status.branch = if branch_part == "HEAD (no branch)" {
        None
    } else {
        Some(
            branch_part
                .strip_prefix("No commits yet on ")
                .or_else(|| branch_part.strip_prefix("Initial commit on "))
                .unwrap_or(branch_part)
                .to_owned(),
        )
    };
    if let Some(metadata) = header
        .split_once('[')
        .and_then(|(_, rest)| rest.strip_suffix(']'))
    {
        for part in metadata.split(',').map(str::trim) {
            if let Some(value) = part.strip_prefix("ahead ") {
                status.ahead = value.parse().unwrap_or_default();
            } else if let Some(value) = part.strip_prefix("behind ") {
                status.behind = value.parse().unwrap_or_default();
            }
        }
    }
}

fn read_branches(
    path: &Path,
    status: &RepositoryStatus,
    include_all_tracking: bool,
) -> Result<Vec<Branch>, AppError> {
    // `%(upstream:track)` walks commit history for every local branch. On
    // repositories with many long-lived branches (such as the Linux kernel),
    // that optional decoration can dominate the entire first-frame snapshot.
    // The latency-sensitive snapshot keeps upstream names and derives current
    // branch divergence from `git status`; full snapshots retain all tracking.
    let format = if include_all_tracking {
        "%(refname)%1f%(refname:short)%1f%(objectname)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)%1f%(symref)%1e"
    } else {
        "%(refname)%1f%(refname:short)%1f%(objectname)%1f%(HEAD)%1f%(upstream:short)%1f%1f%(symref)%1e"
    };
    let format_argument = format!("--format={format}");
    let output = run_git(
        path,
        &[
            "for-each-ref",
            &format_argument,
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    ensure_success("read branches", &output)?;
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .split('\x1e')
        .filter_map(|record| {
            let fields = record
                .trim_start_matches('\n')
                .split('\x1f')
                .collect::<Vec<_>>();
            (fields.len() >= 7 && fields[6].trim_end_matches('\n').is_empty()).then(|| {
                let current = fields[3].trim() == "*";
                let remote = fields[0].starts_with("refs/remotes/");
                let tracking = non_empty(
                    fields[5]
                        .trim_end_matches('\n')
                        .trim_start_matches('[')
                        .trim_end_matches(']'),
                );
                Branch {
                    full_name: fields[0].to_owned(),
                    name: fields[1].to_owned(),
                    oid: fields[2].to_owned(),
                    current,
                    remote,
                    upstream: non_empty(fields[4].trim_end_matches('\n')),
                    tracking: (!remote)
                        .then_some(tracking)
                        .flatten()
                        .or_else(|| current.then(|| tracking_label(status)).flatten()),
                }
            })
        })
        .collect())
}

fn tracking_label(status: &RepositoryStatus) -> Option<String> {
    let mut parts = Vec::new();
    if status.ahead > 0 {
        parts.push(format!("ahead {}", status.ahead));
    }
    if status.behind > 0 {
        parts.push(format!("behind {}", status.behind));
    }
    (!parts.is_empty()).then(|| format!("[{}]", parts.join(", ")))
}

fn read_worktrees(
    path: &Path,
    current_status: &RepositoryStatus,
    include_linked_status: bool,
) -> Result<Vec<Worktree>, AppError> {
    let output = run_git(path, &["worktree", "list", "--porcelain"])?;
    ensure_success("read repository worktrees", &output)?;
    let current_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let text = String::from_utf8_lossy(&output.stdout);

    Ok(text
        .split("\n\n")
        .filter_map(|record| {
            let mut worktree_path = None;
            let mut oid = String::new();
            let mut branch = None;
            let mut locked = false;
            let mut prunable = false;
            for line in record.lines() {
                if let Some(value) = line.strip_prefix("worktree ") {
                    worktree_path = Some(PathBuf::from(value));
                } else if let Some(value) = line.strip_prefix("HEAD ") {
                    oid = value.to_owned();
                } else if let Some(value) = line.strip_prefix("branch ") {
                    branch = Some(
                        value
                            .strip_prefix("refs/heads/")
                            .unwrap_or(value)
                            .to_owned(),
                    );
                } else if line == "locked" || line.starts_with("locked ") {
                    locked = true;
                } else if line == "prunable" || line.starts_with("prunable ") {
                    prunable = true;
                }
            }
            let worktree_path = worktree_path?;
            let resolved = worktree_path
                .canonicalize()
                .unwrap_or_else(|_| worktree_path.clone());
            let current = resolved == current_path;
            let linked_status = (!current && include_linked_status)
                .then(|| read_status(&worktree_path).ok())
                .flatten();
            let status = if current {
                Some(current_status)
            } else {
                linked_status.as_ref()
            };
            Some(Worktree {
                path: worktree_path.to_string_lossy().into_owned(),
                oid,
                branch,
                current,
                locked,
                prunable,
                status_loaded: current || linked_status.is_some(),
                changes: status.as_ref().map_or(0, |value| value.entry_count),
                ahead: status.as_ref().map_or(0, |value| value.ahead),
                behind: status.as_ref().map_or(0, |value| value.behind),
            })
        })
        .collect())
}

fn read_submodules(path: &Path) -> Result<Vec<Submodule>, AppError> {
    if !path.join(".gitmodules").is_file() {
        return Ok(Vec::new());
    }
    let output = run_git(
        path,
        &[
            "config",
            "--file",
            ".gitmodules",
            "--get-regexp",
            r"^submodule\..*\.path$",
        ],
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let mut submodules = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((key, target)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let target = target.trim_start();
        let Some(name) = key
            .strip_prefix("submodule.")
            .and_then(|value| value.strip_suffix(".path"))
        else {
            continue;
        };
        if validate_relative_path(
            target,
            "invalidSubmodulePath",
            "That submodule path is invalid.",
        )
        .is_err()
        {
            continue;
        }
        let url_key = format!("submodule.{name}.url");
        let url = run_git(
            path,
            &["config", "--file", ".gitmodules", "--get", &url_key],
        )
        .ok()
        .filter(|value| value.status.success())
        .map(|value| String::from_utf8_lossy(&value.stdout).trim().to_owned())
        .unwrap_or_default();
        let oid = run_git(path, &["ls-files", "--stage", "--", target])
            .ok()
            .filter(|value| value.status.success())
            .and_then(|value| {
                String::from_utf8_lossy(&value.stdout)
                    .split_ascii_whitespace()
                    .nth(1)
                    .map(str::to_owned)
            });
        let absolute_path = path.join(target);
        let initialized = absolute_path.join(".git").exists();
        let head_oid = initialized
            .then(|| run_git(&absolute_path, &["rev-parse", "--verify", "HEAD"]))
            .transpose()?
            .filter(|value| value.status.success())
            .map(|value| String::from_utf8_lossy(&value.stdout).trim().to_owned());
        let out_of_sync = initialized && oid.is_some() && head_oid != oid;
        submodules.push(Submodule {
            name: name.to_owned(),
            path: target.to_owned(),
            absolute_path: absolute_path.to_string_lossy().into_owned(),
            url,
            oid,
            head_oid,
            initialized,
            out_of_sync,
        });
    }
    submodules.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(submodules)
}

fn read_lfs_info(path: &Path) -> LfsInfo {
    let version_output = run_git(path, &["lfs", "version"]);
    let available = version_output
        .as_ref()
        .is_ok_and(|output| output.status.success());
    let version = version_output
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty());
    let attributes = run_git(
        path,
        &[
            "grep",
            "-I",
            "-l",
            "-e",
            "filter=lfs",
            "--",
            ".gitattributes",
            ":(glob)**/.gitattributes",
        ],
    );
    let tracking_configured = attributes
        .as_ref()
        .is_ok_and(|output| output.status.success() && !output.stdout.is_empty())
        || path.join(".lfsconfig").is_file();
    let locally_installed = run_git(path, &["config", "--local", "--get", "filter.lfs.process"])
        .is_ok_and(|output| output.status.success() && !output.stdout.is_empty());
    let enabled = tracking_configured || locally_installed;
    if !enabled {
        return LfsInfo {
            enabled: false,
            available,
            version,
            tracked_files: None,
        };
    }
    let tracked_files = available
        .then(|| {
            run_git(path, &["lfs", "ls-files", "--name-only"])
                .ok()
                .filter(|output| output.status.success())
                .map(|output| {
                    String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .filter(|line| !line.trim().is_empty())
                        .count()
                })
        })
        .flatten();
    LfsInfo {
        enabled,
        available,
        version,
        tracked_files,
    }
}

fn read_sparse_checkout_info(path: &Path) -> SparseCheckoutInfo {
    let config_enabled = |key: &str| {
        run_git(path, &["config", "--bool", "--get", key])
            .ok()
            .filter(|output| output.status.success())
            .is_some_and(|output| String::from_utf8_lossy(&output.stdout).trim() == "true")
    };
    let enabled = config_enabled("core.sparseCheckout");
    let paths = if enabled {
        run_git(path, &["sparse-checkout", "list"])
            .ok()
            .filter(|output| output.status.success())
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    SparseCheckoutInfo {
        enabled,
        cone_mode: enabled && config_enabled("core.sparseCheckoutCone"),
        sparse_index: enabled && config_enabled("index.sparse"),
        paths,
    }
}

fn read_commit_template(path: &Path) -> Result<Option<String>, AppError> {
    let output = run_git(path, &["config", "--path", "--get", "commit.template"])?;
    if !output.status.success() {
        return Ok(None);
    }
    let configured = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if configured.is_empty() || configured.contains(['\0', '\n', '\r']) {
        return Ok(None);
    }
    let configured_path = PathBuf::from(configured);
    let template_path = if configured_path.is_absolute() {
        configured_path
    } else {
        path.join(configured_path)
    };
    let metadata = match fs::metadata(&template_path) {
        Ok(metadata) if metadata.is_file() && metadata.len() <= 1024 * 1024 => metadata,
        _ => return Ok(None),
    };
    if metadata.len() == 0 {
        return Ok(None);
    }
    Ok(fs::read_to_string(template_path).ok())
}

fn validate_submodule_url(url: &str) -> Result<(), AppError> {
    if url.trim() == url
        && !url.is_empty()
        && !url.starts_with('-')
        && !url.contains(['\0', '\n', '\r'])
    {
        Ok(())
    } else {
        Err(AppError::new(
            "invalidSubmoduleUrl",
            "Enter a valid HTTPS, SSH, or local repository URL.",
            None,
        ))
    }
}

fn validate_relative_path(value: &str, kind: &str, message: &str) -> Result<(), AppError> {
    let candidate = Path::new(value);
    let safe = !value.is_empty()
        && value.trim() == value
        && !value.contains(['\0', '\n', '\r'])
        && candidate
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if safe {
        Ok(())
    } else {
        Err(AppError::new(kind, message, None))
    }
}

fn validate_known_submodule(path: &Path, target: &str) -> Result<Submodule, AppError> {
    validate_relative_path(
        target,
        "invalidSubmodulePath",
        "That submodule path is invalid.",
    )?;
    read_submodules(path)?
        .into_iter()
        .find(|submodule| submodule.path == target)
        .ok_or_else(|| {
            AppError::new(
                "unknownSubmodule",
                "That submodule is no longer registered with this repository.",
                Some("Refresh the repository and try again."),
            )
        })
}

fn managed_worktree(path: &Path, target: &str) -> Result<Worktree, AppError> {
    if target.is_empty() || target.contains(['\0', '\n', '\r']) {
        return Err(AppError::new(
            "invalidWorktree",
            "That worktree path is invalid.",
            None,
        ));
    }
    let status = read_status(path)?;
    read_worktrees(path, &status, true)?
        .into_iter()
        .find(|worktree| worktree.path == target)
        .ok_or_else(|| {
            AppError::new(
                "unknownWorktree",
                "That worktree is no longer registered with this repository.",
                Some("Refresh the repository and try again."),
            )
        })
}

fn read_stashes(path: &Path) -> Result<Vec<StashEntry>, AppError> {
    let output = run_git(path, &["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1e"])?;
    ensure_success("read stashes", &output)?;
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .split('\x1e')
        .filter_map(|record| {
            let fields = record
                .trim_start_matches('\n')
                .split('\x1f')
                .collect::<Vec<_>>();
            (fields.len() >= 3).then(|| StashEntry {
                reference: fields[0].to_owned(),
                oid: fields[1].to_owned(),
                message: fields[2].trim_end_matches('\n').to_owned(),
            })
        })
        .collect())
}

fn normalize_stash_history(
    mut commits: Vec<CommitSummary>,
    stashes: &[StashEntry],
) -> Vec<CommitSummary> {
    let stash_oids = stashes
        .iter()
        .map(|stash| stash.oid.as_str())
        .collect::<std::collections::HashSet<_>>();
    let synthetic_parents = commits
        .iter()
        .filter(|commit| stash_oids.contains(commit.oid.as_str()))
        .flat_map(|commit| commit.parents.iter().skip(1).cloned())
        .collect::<std::collections::HashSet<_>>();
    commits.retain(|commit| !synthetic_parents.contains(&commit.oid));
    for commit in &mut commits {
        if stash_oids.contains(commit.oid.as_str()) {
            commit.parents.truncate(1);
        }
    }
    commits
}

fn read_tags(path: &Path) -> Result<Vec<Tag>, AppError> {
    let output = run_git(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(*objectname)%1e",
            "refs/tags",
        ],
    )?;
    ensure_success("read tags", &output)?;
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .split('\x1e')
        .filter_map(|record| {
            let fields = record
                .trim_start_matches('\n')
                .split('\x1f')
                .collect::<Vec<_>>();
            (fields.len() >= 4).then(|| Tag {
                full_name: fields[0].to_owned(),
                name: fields[1].to_owned(),
                oid: non_empty(fields[3].trim_end_matches('\n'))
                    .unwrap_or_else(|| fields[2].to_owned()),
            })
        })
        .collect())
}

pub fn tag_details(path: &Path, name: &str) -> Result<TagDetails, AppError> {
    validate_tag_name(path, name)?;
    let reference = format!("refs/tags/{name}");
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "for-each-ref",
            "--format=%(objectname)%00%(*objectname)%00%(objecttype)%00%(taggername)%00%(taggeremail)%00%(taggerdate:iso-strict)%00%(contents:subject)",
            &reference,
        ],
        MAX_TAG_DETAILS_OUTPUT_BYTES,
    )?;
    ensure_success("read tag details", &output)?;
    if truncated {
        return Err(AppError::new(
            "tagDetailsTooLarge",
            "That tag annotation is too large to preview safely.",
            Some("Inspect the tag from the terminal for its complete annotation."),
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let fields = text
        .trim_end_matches('\n')
        .splitn(7, '\0')
        .collect::<Vec<_>>();
    if fields.len() < 7 || fields[0].is_empty() {
        return Err(AppError::new(
            "tagNotFound",
            format!("Tag '{name}' was not found."),
            Some("Refresh the repository and try again."),
        ));
    }
    let annotated = fields[2] == "tag";
    let optional = |value: &str| (!value.is_empty()).then(|| value.to_owned());
    Ok(TagDetails {
        name: name.to_owned(),
        oid: non_empty(fields[1]).unwrap_or_else(|| fields[0].to_owned()),
        annotated,
        message: annotated
            .then(|| fields[6].to_owned())
            .filter(|value| !value.is_empty()),
        tagger_name: annotated.then(|| optional(fields[3])).flatten(),
        tagger_email: annotated
            .then(|| optional(fields[4].trim_matches(|character| matches!(character, '<' | '>'))))
            .flatten(),
        tagged_at: annotated.then(|| optional(fields[5])).flatten(),
    })
}

fn validate_tag_name(path: &Path, name: &str) -> Result<(), AppError> {
    if name.trim() != name || name.is_empty() || name.starts_with('-') {
        return Err(AppError::new(
            "invalidTagName",
            "Enter a valid tag name.",
            None,
        ));
    }
    let full_name = format!("refs/tags/{name}");
    let output = run_git(path, &["check-ref-format", &full_name])?;
    ensure_success("validate that tag name", &output)
}

fn validate_stash_reference(reference: &str) -> Result<(), AppError> {
    let index = reference
        .strip_prefix("stash@{")
        .and_then(|value| value.strip_suffix('}'));
    if index
        .is_some_and(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
    {
        Ok(())
    } else {
        Err(AppError::new(
            "invalidStash",
            "That stash reference is invalid.",
            Some("Refresh the repository and choose the stash again."),
        ))
    }
}

fn validate_stash_message(message: &str) -> Result<&str, AppError> {
    let message = message.trim();
    if message.chars().count() > 500
        || message
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        Err(AppError::new(
            "invalidStashMessage",
            "That stash message is not valid.",
            Some("Use a single-line stash message of 500 characters or fewer."),
        ))
    } else {
        Ok(message)
    }
}

fn read_commits(path: &Path, limit: usize) -> Result<Vec<CommitSummary>, AppError> {
    let count = format!("-{limit}");
    read_commits_with_pagination(path, &count, None)
}

fn read_commit_page(
    path: &Path,
    offset: usize,
    limit: usize,
) -> Result<Vec<CommitSummary>, AppError> {
    let count = format!("-{limit}");
    let skip = format!("--skip={offset}");
    read_commits_with_pagination(path, &count, Some(&skip))
}

fn read_commits_with_pagination(
    path: &Path,
    count: &str,
    skip: Option<&str>,
) -> Result<Vec<CommitSummary>, AppError> {
    let mut args = vec!["log", count];
    if let Some(skip) = skip {
        args.push(skip);
    }
    args.extend([
        "--decorate=short",
        "--decorate-refs-exclude=refs/remotes/*/HEAD",
        "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f%D%x1e",
        "--all",
    ]);
    read_commits_with_arguments(path, &args)
}

fn read_commits_from_revisions(
    path: &Path,
    limit: usize,
    revisions: &[String],
) -> Result<Vec<CommitSummary>, AppError> {
    if limit == 0 || revisions.is_empty() {
        return Ok(Vec::new());
    }
    let count = format!("-{limit}");
    let mut args = vec![
        "log",
        count.as_str(),
        "--decorate=short",
        "--decorate-refs-exclude=refs/remotes/*/HEAD",
        "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f%D%x1e",
    ];
    args.extend(revisions.iter().map(String::as_str));
    read_commits_with_arguments(path, &args)
}

fn read_commits_with_arguments(path: &Path, args: &[&str]) -> Result<Vec<CommitSummary>, AppError> {
    let output = run_git(path, args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not have any commits yet")
            || stderr.contains("your current branch")
        {
            return Ok(Vec::new());
        }
        ensure_success("read commit history", &output)?;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .split('\x1e')
        .filter_map(|record| {
            let fields = record
                .trim_start_matches('\n')
                .split('\x1f')
                .collect::<Vec<_>>();
            (fields.len() >= 8).then(|| CommitSummary {
                oid: fields[0].to_owned(),
                parents: fields[1]
                    .split_ascii_whitespace()
                    .map(str::to_owned)
                    .collect(),
                author_name: fields[2].to_owned(),
                author_email: fields[3].to_owned(),
                authored_at: fields[4].to_owned(),
                subject: fields[5].to_owned(),
                description: fields[6].trim().to_owned(),
                decorations: fields[7]
                    .trim_end_matches('\n')
                    .split(',')
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(str::to_owned)
                    .collect(),
            })
        })
        .collect())
}

fn non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

fn validate_identity_value(value: &str, kind: &str, message: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.trim() != value
        || value
            .chars()
            .any(|character| matches!(character, '\0' | '\n' | '\r'))
    {
        return Err(AppError::new(kind, message, None));
    }
    Ok(())
}

fn run_mutation(path: &Path, args: &[&str], operation: &str) -> Result<(), AppError> {
    let output = run_git(path, args)?;
    ensure_success(operation, &output)
}

fn run_mutation_with_cancellation(
    path: &Path,
    args: &[&str],
    operation: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    let output = run_git_with_cancellation(path, args, cancellation)?;
    ensure_success(operation, &output)
}

fn read_conflict_stage(path: &Path, file: &str, stage: u8) -> Result<Option<Vec<u8>>, AppError> {
    let revision = format!(":{stage}:{file}");
    let output = run_git(path, &["show", &revision])?;
    if output.status.success() {
        Ok(Some(output.stdout))
    } else {
        Ok(None)
    }
}

fn run_rebase_control(path: &Path, action: &str, operation: &str) -> Result<(), AppError> {
    if !rebase_in_progress(path)? {
        return Err(AppError::new(
            "noRebaseInProgress",
            "There is no interactive rebase in progress.",
            None,
        ));
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["rebase", action])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("GIT_EDITOR", "true")
        .output()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start Git: {error}"),
                None,
            )
        })?;
    finish_rebase_command(path, output, operation)
}

fn finish_rebase_command(path: &Path, output: Output, operation: &str) -> Result<(), AppError> {
    if output.status.success() {
        cleanup_rebase_support(path);
        return Ok(());
    }
    if rebase_in_progress(path).unwrap_or(false) {
        let mut error = AppError::git_failure(operation, &output);
        error.kind = "rebaseConflict".into();
        error.hint = Some(
            "Resolve conflicted files, stage them, then Continue; or choose Skip or Abort.".into(),
        );
        Err(error)
    } else {
        cleanup_rebase_support(path);
        Err(AppError::git_failure(operation, &output))
    }
}

struct RepositoryOperationState {
    merge: bool,
    history: Option<String>,
    rebase: bool,
    bisect: bool,
}

fn repository_operation_state(path: &Path) -> Result<RepositoryOperationState, AppError> {
    let output = run_git(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "MERGE_HEAD",
            "--git-path",
            "CHERRY_PICK_HEAD",
            "--git-path",
            "REVERT_HEAD",
            "--git-path",
            "rebase-merge",
            "--git-path",
            "BISECT_START",
        ],
    )?;
    ensure_success("inspect repository operation state", &output)?;
    let paths = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    Ok(RepositoryOperationState {
        merge: paths.first().is_some_and(|path| path.is_file()),
        history: if paths.get(1).is_some_and(|path| path.is_file()) {
            Some("cherry-pick".into())
        } else if paths.get(2).is_some_and(|path| path.is_file()) {
            Some("revert".into())
        } else {
            None
        },
        rebase: paths.get(3).is_some_and(|path| path.is_dir()),
        bisect: paths.get(4).is_some_and(|path| path.is_file()),
    })
}

fn rebase_in_progress(path: &Path) -> Result<bool, AppError> {
    Ok(repository_operation_state(path)?.rebase)
}

fn rebase_support_dir(path: &Path) -> Result<PathBuf, AppError> {
    let output = run_git(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "git-chronos-rebase",
        ],
    )?;
    ensure_success("locate interactive rebase storage", &output)?;
    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim(),
    ))
}

fn cleanup_rebase_support(path: &Path) {
    if let Ok(directory) = rebase_support_dir(path) {
        let _ = fs::remove_dir_all(directory);
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn run_git(path: &Path, args: &[&str]) -> Result<Output, AppError> {
    Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start Git: {error}"),
                Some("Install Git and ensure it is available on PATH."),
            )
        })
}

fn run_git_with_cancellation(
    path: &Path,
    args: &[&str],
    cancellation: Option<&CancellationToken>,
) -> Result<Output, AppError> {
    let Some(cancellation) = cancellation else {
        return run_git(path, args);
    };
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    run_cancellable_command(command, cancellation)
}

fn run_cancellable_command(
    mut command: Command,
    cancellation: &CancellationToken,
) -> Result<Output, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let mut child = command.spawn().map_err(|error| {
        AppError::new(
            "gitUnavailable",
            format!("Could not start Git: {error}"),
            Some("Install Git and ensure it is available on PATH."),
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        terminate_process_tree(&mut child);
        AppError::new("gitOutputUnavailable", "Could not read Git output.", None)
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        terminate_process_tree(&mut child);
        AppError::new("gitOutputUnavailable", "Could not read Git errors.", None)
    })?;
    let stdout_reader = thread::spawn(move || {
        let mut output = Vec::new();
        stdout
            .take(u64::MAX)
            .read_to_end(&mut output)
            .map(|_| output)
    });
    let stderr_reader = thread::spawn(move || {
        let mut output = Vec::new();
        let mut stderr = stderr;
        stderr.read_to_end(&mut output).map(|_| output)
    });

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                terminate_process_tree(&mut child);
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(AppError::new(
                    "gitWaitFailed",
                    format!("Could not check whether Git completed: {error}"),
                    None,
                ));
            }
        }
        if cancellation.is_cancelled() {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(operation_cancelled());
        }
        thread::sleep(Duration::from_millis(30));
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| AppError::new("gitOutputFailed", "Could not collect Git output.", None))?
        .map_err(|error| {
            AppError::new(
                "gitOutputFailed",
                format!("Could not read Git output: {error}"),
                None,
            )
        })?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| AppError::new("gitOutputFailed", "Could not collect Git errors.", None))?
        .map_err(|error| {
            AppError::new(
                "gitOutputFailed",
                format!("Could not read Git errors: {error}"),
                None,
            )
        })?;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn operation_cancelled() -> AppError {
    AppError::new(
        "operationCancelled",
        "The Git operation was canceled. It may have made partial changes.",
        Some("Refresh the repository and check its state before retrying."),
    )
}

fn configure_process_tree(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
}

fn terminate_process_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        unsafe extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }
        const SIGKILL: i32 = 9;
        if let Ok(process_group) = i32::try_from(child.id()) {
            unsafe {
                kill(-process_group, SIGKILL);
            }
        }
    }
    #[cfg(windows)]
    {
        let process_id = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &process_id, "/T", "/F"])
            .output();
    }
    let _ = child.kill();
}

fn run_git_with_stdout_limit(
    path: &Path,
    args: &[&str],
    limit: usize,
) -> Result<(Output, bool), AppError> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start Git: {error}"),
                Some("Install Git and ensure it is available on PATH."),
            )
        })?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(AppError::new(
            "gitOutputUnavailable",
            "Could not read Git output.",
            None,
        ));
    };
    let Some(mut stderr) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(AppError::new(
            "gitOutputUnavailable",
            "Could not read Git errors.",
            None,
        ));
    };
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stderr.read_to_end(&mut bytes);
        (bytes, result)
    });
    let mut output_bytes = Vec::with_capacity(limit.saturating_add(1));
    let output_result = stdout
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut output_bytes);
    if let Err(error) = output_result {
        let _ = child.kill();
        let _ = child.wait();
        let _ = stderr_reader.join();
        return Err(AppError::new(
            "gitOutputFailed",
            format!("Could not read Git output: {error}"),
            None,
        ));
    }
    let truncated = output_bytes.len() > limit;
    if truncated {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|error| {
        AppError::new(
            "gitWaitFailed",
            format!("Could not finish the Git operation: {error}"),
            None,
        )
    })?;
    let (error_bytes, error_result) = stderr_reader
        .join()
        .map_err(|_| AppError::new("gitOutputFailed", "Could not collect Git errors.", None))?;
    error_result.map_err(|error| {
        AppError::new(
            "gitOutputFailed",
            format!("Could not read Git errors: {error}"),
            None,
        )
    })?;
    output_bytes.truncate(limit);
    Ok((
        Output {
            status,
            stdout: output_bytes,
            stderr: error_bytes,
        },
        truncated,
    ))
}

fn run_git_with_input(
    path: &Path,
    args: &[&str],
    input: &[u8],
    operation: &str,
) -> Result<(), AppError> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start Git: {error}"),
                Some("Install Git and ensure it is available on PATH."),
            )
        })?;
    child
        .stdin
        .take()
        .ok_or_else(|| {
            AppError::new(
                "gitInputUnavailable",
                "Could not send the patch to Git.",
                None,
            )
        })?
        .write_all(input)
        .map_err(|error| {
            AppError::new(
                "gitInputFailed",
                format!("Could not send the patch to Git: {error}"),
                None,
            )
        })?;
    let output = child.wait_with_output().map_err(|error| {
        AppError::new(
            "gitWaitFailed",
            format!("Could not finish the Git operation: {error}"),
            None,
        )
    })?;
    ensure_success(operation, &output)
}

fn run_git_allow_diff_exit(path: &Path, args: &[&str]) -> Result<Output, AppError> {
    let output = run_git(path, args)?;
    if output.status.success() || output.status.code() == Some(1) {
        Ok(output)
    } else {
        Err(AppError::git_failure("read that file's changes", &output))
    }
}

fn ensure_success(operation: &str, output: &Output) -> Result<(), AppError> {
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::git_failure(operation, output))
    }
}

fn redact_url_credentials(input: &str) -> String {
    let mut output = input.to_owned();
    for scheme in ["https://", "http://"] {
        let mut search_from = 0;
        while let Some(relative_start) = output[search_from..].find(scheme) {
            let authority_start = search_from + relative_start + scheme.len();
            let authority_end = output[authority_start..]
                .find(['/', ' ', '\n', '\r'])
                .map(|offset| authority_start + offset)
                .unwrap_or(output.len());
            let Some(at_offset) = output[authority_start..authority_end].rfind('@') else {
                search_from = authority_end;
                continue;
            };
            let at = authority_start + at_offset;
            output.replace_range(authority_start..=at, "[credentials]@");
            search_from = authority_start + "[credentials]@".len();
        }
    }
    output
}

fn parse_git_version(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .split_ascii_whitespace()
        .find(|part| {
            part.chars()
                .next()
                .is_some_and(|char| char.is_ascii_digit())
        })
        .map(|part| part.trim().to_owned())
}

fn version_at_least(actual: &str, minimum: &str) -> bool {
    let parts = |version: &str| {
        version
            .split('.')
            .take(3)
            .map(|part| {
                part.chars()
                    .take_while(|char| char.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u32>()
                    .unwrap_or_default()
            })
            .chain(std::iter::repeat(0))
            .take(3)
            .collect::<Vec<_>>()
    };
    parts(actual) >= parts(minimum)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    struct TestRepository {
        path: PathBuf,
    }

    impl TestRepository {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "git-chronos-test-{}-{}",
                std::process::id(),
                TEST_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).expect("create test repository directory");
            let repository = Self { path };
            repository.git(&["init", "-b", "main"]);
            repository.git(&["config", "user.name", "Chronos Tester"]);
            repository.git(&["config", "user.email", "chronos@example.test"]);
            repository
        }

        fn git(&self, args: &[&str]) {
            let output = Command::new("git")
                .arg("-C")
                .arg(&self.path)
                .args(args)
                .output()
                .expect("run Git in test repository");
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn write(&self, path: &str, content: &str) {
            fs::write(self.path.join(path), content).expect("write fixture file");
        }
    }

    #[test]
    fn reads_bounded_reflog_recovery_entries() {
        let repository = TestRepository::new();
        repository.write("story.txt", "first\n");
        repository.git(&["add", "story.txt"]);
        repository.git(&["commit", "-m", "First recovery point"]);
        repository.write("story.txt", "second\n");
        repository.git(&["commit", "-am", "Second recovery point"]);

        let page = reflog_entries(&repository.path, 1).expect("read reflog");
        assert_eq!(page.entries.len(), 1);
        assert!(page.truncated);
        assert_eq!(page.entries[0].oid.len(), 40);
        assert!(page.entries[0].selector.contains("@{"));
        assert!(page.entries[0].subject.contains("Second recovery point"));
        assert_eq!(page.entries[0].author_name, "Chronos Tester");
        assert_eq!(page.entries[0].author_email, "chronos@example.test");
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_stops_a_command_and_its_child_process_group() {
        let repository = TestRepository::new();
        let marker = repository.path.join("child-started");
        let mut command = Command::new("sh");
        command
            .args(["-c", "sleep 20 & echo started > \"$1\"; wait", "git-test"])
            .arg(marker.as_os_str())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_tree(&mut command);

        let cancellation = CancellationToken::default();
        let worker_cancellation = cancellation.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let _ = sender.send(run_cancellable_command(command, &worker_cancellation));
        });

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !marker.exists() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        cancellation.cancel();

        let error = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("the process tree should stop promptly after cancellation")
            .expect_err("a canceled command should return a cancellation error");
        assert_eq!(error.kind, "operationCancelled");
        assert!(
            marker.exists(),
            "the descendant process should have started"
        );
    }

    impl Drop for TestRepository {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn omits_remote_default_branch_aliases_from_branch_locations() {
        let repository = TestRepository::new();
        repository.write("story.txt", "first\n");
        repository.git(&["add", "story.txt"]);
        repository.git(&["commit", "-m", "First commit"]);
        repository.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
        repository.git(&[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ]);

        let data = snapshot(&repository.path).expect("read repository with remote alias");

        assert!(
            data.branches
                .iter()
                .any(|branch| branch.name == "origin/main")
        );
        assert!(!data.branches.iter().any(|branch| branch.name == "origin"));
        assert!(
            data.commits
                .iter()
                .flat_map(|commit| &commit.decorations)
                .any(|decoration| decoration == "origin/main")
        );
        assert!(
            !data
                .commits
                .iter()
                .flat_map(|commit| &commit.decorations)
                .any(|decoration| decoration == "origin")
        );
    }

    #[test]
    fn parses_git_versions() {
        assert_eq!(
            parse_git_version(b"git version 2.53.0\n"),
            Some("2.53.0".into())
        );
        assert!(version_at_least("2.53.0", MINIMUM_GIT_VERSION));
        assert!(version_at_least("2.34.0.windows.1", MINIMUM_GIT_VERSION));
        assert!(!version_at_least("2.33.9", MINIMUM_GIT_VERSION));
    }

    #[test]
    fn locates_repository_metadata_without_scanning_the_working_tree() {
        let repository = TestRepository::new();
        let paths = repository_watch_paths(&repository.path).expect("locate metadata paths");
        assert_eq!(paths.non_recursive, vec![repository.path.join(".git")]);
        assert_eq!(paths.recursive, vec![repository.path.join(".git/refs")]);
        assert!(
            paths
                .non_recursive
                .iter()
                .chain(&paths.recursive)
                .all(|path| path.is_dir())
        );
        assert!(
            paths
                .recursive
                .iter()
                .all(|path| path.file_name().is_none_or(|name| name != "objects"))
        );
    }

    #[test]
    fn reports_when_more_commit_history_is_available() {
        let repository = TestRepository::new();
        for index in 1..=3 {
            repository.write("history.txt", &format!("revision {index}\n"));
            repository.git(&["add", "history.txt"]);
            repository.git(&["commit", "-m", &format!("Revision {index}")]);
        }

        let limited = snapshot_with_commit_limit(&repository.path, 2)
            .expect("read a limited repository snapshot");
        assert_eq!(limited.commits.len(), 2);
        assert!(limited.history_truncated);

        let complete = snapshot_with_commit_limit(&repository.path, 3)
            .expect("read the complete repository snapshot");
        assert_eq!(complete.commits.len(), 3);
        assert!(!complete.history_truncated);

        let page = commit_history_page(&repository.path, 2, 2)
            .expect("read only the next commit history page");
        assert_eq!(page.commits.len(), 1);
        assert_eq!(page.commits[0].subject, "Revision 1");
        assert!(!page.history_truncated);
    }

    #[test]
    fn incrementally_walks_branched_history_without_duplicates() {
        let repository = TestRepository::new();
        for index in 1..=4 {
            repository.write("history.txt", &format!("main revision {index}\n"));
            repository.git(&["add", "history.txt"]);
            repository.git(&["commit", "-m", &format!("Main revision {index}")]);
        }
        repository.git(&["checkout", "-b", "topic", "HEAD~2"]);
        repository.write("topic.txt", "topic revision\n");
        repository.git(&["add", "topic.txt"]);
        repository.git(&["commit", "-m", "Topic revision"]);

        let initial = read_commits(&repository.path, 2).expect("read initial history window");
        let expected = read_commits(&repository.path, 20)
            .expect("read complete fixture history")
            .into_iter()
            .map(|commit| commit.oid)
            .collect::<HashSet<_>>();
        let mut cursor = CommitHistoryCursor::default();
        cursor
            .reset(&repository.path, &initial)
            .expect("initialize incremental history");
        let mut observed = initial
            .iter()
            .map(|commit| commit.oid.clone())
            .collect::<Vec<_>>();

        loop {
            let page = cursor
                .next_page(&repository.path, 2)
                .expect("read incremental history page");
            observed.extend(page.commits.into_iter().map(|commit| commit.oid));
            if !page.history_truncated {
                break;
            }
        }

        assert_eq!(
            observed.iter().collect::<HashSet<_>>().len(),
            observed.len()
        );
        assert_eq!(observed.into_iter().collect::<HashSet<_>>(), expected);
    }

    #[test]
    fn in_process_history_walk_matches_git_log_output() {
        let repository = TestRepository::new();
        let clock = std::cell::Cell::new(0);
        let git_at = |zone: &str, args: &[&str]| {
            clock.set(clock.get() + 1);
            let date = format!("2020-01-01T00:{:02}:00{zone}", clock.get());
            let output = Command::new("git")
                .arg("-C")
                .arg(&repository.path)
                .args(args)
                .env("GIT_AUTHOR_DATE", &date)
                .env("GIT_COMMITTER_DATE", &date)
                .output()
                .expect("run Git in test repository");
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };

        repository.write("a.txt", "one\n");
        git_at("+0000", &["add", "a.txt"]);
        git_at("+0000", &["commit", "-m", "Root commit"]);
        git_at("+0000", &["tag", "-a", "v0.1", "-m", "Annotated release"]);
        repository.write("a.txt", "two\n");
        git_at(
            "-0230",
            &[
                "commit",
                "-am",
                "  Leading spaced subject  \ncontinued subject\n\nBody line\n\nSecond paragraph",
            ],
        );
        git_at("+0000", &["tag", "light"]);
        git_at("+0000", &["checkout", "-b", "topic", "HEAD~1"]);
        repository.write("b.txt", "topic\n");
        git_at("+0530", &["add", "b.txt"]);
        git_at("+0530", &["commit", "-m", "Topic work"]);
        git_at("+0000", &["checkout", "main"]);
        git_at("+0100", &["merge", "--no-ff", "topic", "-m", "Merge topic"]);
        git_at(
            "+0000",
            &["update-ref", "refs/remotes/origin/main", "HEAD~1"],
        );
        git_at(
            "+0000",
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ],
        );
        git_at("+0000", &["update-ref", "refs/custom/marker", "topic"]);
        repository.write("a.txt", "dirty\n");
        repository.write("untracked.txt", "untracked\n");
        git_at("+0000", &["stash", "push", "-u", "-m", "Work in progress"]);
        repository.write("a.txt", "after stash\n");
        git_at("-0800", &["commit", "-am", "After stash"]);
        git_at("+0000", &["checkout", "--detach", "HEAD~1"]);

        let stashes = read_stashes(&repository.path).expect("read fixture stashes");
        let expected = normalize_stash_history(
            read_commits(&repository.path, 100).expect("read fixture history with Git"),
            &stashes,
        );
        let render = |commits: &[CommitSummary]| {
            commits
                .iter()
                .map(|commit| format!("{commit:?}"))
                .collect::<Vec<_>>()
        };

        for initial_count in [0, 3] {
            let initial = expected[..initial_count].to_vec();
            let mut cursor = CommitHistoryCursor::default();
            cursor
                .reset(&repository.path, &initial)
                .expect("initialize in-process history");
            assert!(cursor.walk.is_some(), "the in-process walk should be used");
            let mut observed = initial.clone();
            loop {
                let page = cursor
                    .next_page(&repository.path, 2)
                    .expect("read in-process history page");
                observed.extend(page.commits);
                if !page.history_truncated {
                    break;
                }
            }
            assert_eq!(render(&observed), render(&expected));
        }
    }

    #[test]
    fn searches_tracked_files_case_insensitively_with_bounded_results() {
        let repository = TestRepository::new();
        fs::create_dir_all(repository.path.join("src/ui")).expect("create source fixture");
        fs::create_dir_all(repository.path.join("docs")).expect("create docs fixture");
        repository.write("README.md", "read me\n");
        repository.write("src/ui/AppComponent.ts", "component\n");
        repository.write("src/ui/AppComponent.html", "component template\n");
        repository.write("docs/guide[old].md", "guide\n");
        stage_all(&repository.path).expect("stage tracked file fixtures");

        let component = search_tracked_files(&repository.path, "component", 10)
            .expect("search tracked components");
        assert_eq!(
            component.paths,
            vec!["src/ui/AppComponent.html", "src/ui/AppComponent.ts"]
        );
        assert!(!component.truncated);

        let limited =
            search_tracked_files(&repository.path, "app", 1).expect("limit tracked file results");
        assert_eq!(limited.paths.len(), 1);
        assert!(limited.truncated);

        let bracket = search_tracked_files(&repository.path, "[old]", 10)
            .expect("treat glob punctuation literally");
        assert_eq!(bracket.paths, vec!["docs/guide[old].md"]);
    }

    #[test]
    fn limits_working_tree_entries_without_losing_aggregate_counts() {
        let repository = TestRepository::new();
        repository.write("one.txt", "one\n");
        repository.write("two.txt", "two\n");
        repository.write("three.txt", "three\n");

        let limited = status_with_entry_limit(&repository.path, 2)
            .expect("read a limited working tree status");
        assert_eq!(limited.entry_count, 3);
        assert_eq!(limited.untracked, 3);
        assert_eq!(limited.entries.len(), 2);
        assert!(limited.entries_truncated);

        let complete = status_with_entry_limit(&repository.path, 3)
            .expect("read the complete working tree status");
        assert_eq!(complete.entries.len(), 3);
        assert!(!complete.entries_truncated);
    }

    #[test]
    fn distinguishes_fast_untracked_directory_summaries_from_full_file_status() {
        let repository = TestRepository::new();
        fs::create_dir_all(repository.path.join("generated")).expect("create untracked directory");
        repository.write("generated/example.txt", "generated\n");

        let fast = status_with_entry_limit_fast(&repository.path, 1_000)
            .expect("read fast working tree status");
        assert!(fast.entries.iter().any(|entry| entry.path == "generated/"));

        let complete = status_with_entry_limit(&repository.path, 1_000)
            .expect("read complete working tree status");
        assert!(
            complete
                .entries
                .iter()
                .any(|entry| entry.path == "generated/example.txt")
        );
        assert!(
            !complete
                .entries
                .iter()
                .any(|entry| entry.path == "generated/")
        );
    }

    #[test]
    fn parses_branch_tracking_header() {
        let mut status = RepositoryStatus::default();
        parse_branch_header("main...origin/main [ahead 2, behind 3]", &mut status);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 3);
        assert_eq!(
            tracking_label(&status).as_deref(),
            Some("[ahead 2, behind 3]")
        );
    }

    #[test]
    fn parses_unborn_branch_header() {
        let mut status = RepositoryStatus::default();
        parse_branch_header("No commits yet on trunk", &mut status);
        assert_eq!(status.branch.as_deref(), Some("trunk"));
    }

    #[test]
    fn redacts_credentials_from_urls() {
        assert_eq!(
            redact_url_credentials("fatal: https://user:secret@example.com/repo.git failed"),
            "fatal: https://[credentials]@example.com/repo.git failed"
        );
        assert_eq!(
            redact_url_credentials("https://example.com/repo.git"),
            "https://example.com/repo.git"
        );
    }

    #[test]
    fn parses_changed_and_renamed_commit_files() {
        let files = parse_commit_files(b"M\0src/main.rs\0R100\0old name.txt\0new name.txt\0");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[0].previous_path, None);
        assert_eq!(files[1].status, "R100");
        assert_eq!(files[1].path, "new name.txt");
        assert_eq!(files[1].previous_path.as_deref(), Some("old name.txt"));
    }

    #[test]
    fn attaches_text_binary_and_rename_statistics_to_commit_files() {
        let files = parse_commit_files_with_stats(
            b"M\0src/main.rs\0M\0image.png\0R100\0old name.txt\0new name.txt\0",
            b"12\t3\tsrc/main.rs\0-\t-\timage.png\0\n4\t1\t\0old name.txt\0new name.txt\0",
        );
        assert_eq!(
            (files[0].additions, files[0].deletions),
            (Some(12), Some(3))
        );
        assert_eq!((files[1].additions, files[1].deletions), (None, None));
        assert_eq!((files[2].additions, files[2].deletions), (Some(4), Some(1)));
    }

    #[test]
    fn stops_reading_commit_patches_at_the_preview_limit() {
        let repository = TestRepository::new();
        repository.write("large.txt", "seed\n");
        stage_all(&repository.path).expect("stage seed file");
        commit(&repository.path, "Seed large file").expect("commit seed file");
        repository.write("large.txt", &"changed line\n".repeat(100_000));
        stage_all(&repository.path).expect("stage large change");
        commit(&repository.path, "Change large file").expect("commit large change");
        let oid = snapshot(&repository.path)
            .expect("read large change")
            .head_oid
            .expect("large change oid");

        let diff = commit_file_diff(&repository.path, &oid, "large.txt", None)
            .expect("read bounded commit preview");
        assert!(diff.truncated);
        assert_eq!(diff.patch.len(), MAX_FILE_DIFF_BYTES);
        assert!(diff.patch.starts_with("diff --git"));
    }

    #[test]
    fn rejects_unsafe_commit_identifiers() {
        let error = validate_commit_oid("--help").expect_err("reject option-like revision");
        assert_eq!(error.kind, "invalidCommit");
        assert!(validate_commit_oid("0123456789abcdef0123456789abcdef01234567").is_ok());
    }

    #[test]
    fn rejects_unknown_pull_strategies_before_running_git() {
        let error = pull_with_strategy(Path::new("."), "octopus")
            .expect_err("reject an unsupported pull strategy");
        assert_eq!(error.kind, "invalidPullStrategy");
    }

    #[test]
    fn rejects_lfs_actions_when_the_repository_does_not_enable_lfs() {
        let repository = TestRepository::new();
        let pull_error = pull_lfs(&repository.path).expect_err("reject LFS pull");
        let prune_error = prune_lfs(&repository.path).expect_err("reject LFS prune");
        assert_eq!(pull_error.kind, "lfsNotEnabled");
        assert_eq!(prune_error.kind, "lfsNotEnabled");

        let invalid_pattern = track_lfs_pattern(&repository.path, "--help", false)
            .expect_err("reject an option-like pattern");
        assert_eq!(invalid_pattern.kind, "invalidLfsPattern");
    }

    #[test]
    fn configures_reapplies_and_disables_sparse_checkout() {
        let repository = TestRepository::new();
        repository.write("README.md", "root\n");
        fs::create_dir_all(repository.path.join("src")).expect("create source directory");
        fs::create_dir_all(repository.path.join("docs")).expect("create docs directory");
        repository.write("src/main.rs", "fn main() {}\n");
        repository.write("docs/guide.md", "guide\n");
        stage_all(&repository.path).expect("stage sparse checkout fixture");
        commit(&repository.path, "Add sparse checkout fixture").expect("commit fixture");

        let initial = snapshot(&repository.path).expect("read full checkout");
        assert!(!initial.sparse_checkout.enabled);
        set_sparse_checkout(&repository.path, &["src".into()], true)
            .expect("enable sparse checkout");

        let sparse = snapshot(&repository.path).expect("read sparse checkout");
        assert!(sparse.sparse_checkout.enabled);
        assert!(sparse.sparse_checkout.cone_mode);
        assert!(sparse.sparse_checkout.sparse_index);
        assert_eq!(sparse.sparse_checkout.paths, vec!["src"]);
        assert!(repository.path.join("README.md").is_file());
        assert!(repository.path.join("src/main.rs").is_file());
        assert!(!repository.path.join("docs/guide.md").exists());

        reapply_sparse_checkout(&repository.path).expect("reapply sparse checkout");
        let invalid = set_sparse_checkout(&repository.path, &["../outside".into()], false)
            .expect_err("reject unsafe sparse checkout path");
        assert_eq!(invalid.kind, "invalidSparseCheckoutPath");

        disable_sparse_checkout(&repository.path).expect("disable sparse checkout");
        let restored = snapshot(&repository.path).expect("read restored checkout");
        assert!(!restored.sparse_checkout.enabled);
        assert!(repository.path.join("docs/guide.md").is_file());
    }

    #[test]
    fn moves_head_only_from_the_expected_commit() {
        let repository = TestRepository::new();
        repository.write("history.txt", "one\n");
        stage_all(&repository.path).expect("stage first revision");
        commit(&repository.path, "First").expect("create first revision");
        let first = snapshot(&repository.path)
            .expect("read first revision")
            .head_oid
            .expect("first oid");
        repository.write("history.txt", "two\n");
        stage_all(&repository.path).expect("stage second revision");
        commit(&repository.path, "Second").expect("create second revision");
        let second = snapshot(&repository.path)
            .expect("read second revision")
            .head_oid
            .expect("second oid");

        move_head_if_current(&repository.path, &second, &first).expect("undo second revision");
        assert_eq!(
            snapshot(&repository.path).expect("read undo").head_oid,
            Some(first.clone())
        );
        let stale = move_head_if_current(&repository.path, &second, &first)
            .expect_err("reject a stale history operation");
        assert_eq!(stale.kind, "historyChanged");
        move_head_if_current(&repository.path, &first, &second).expect("redo second revision");
        assert_eq!(
            snapshot(&repository.path).expect("read redo").head_oid,
            Some(second)
        );
    }

    #[test]
    fn renames_fast_forwards_and_deletes_branches() {
        let repository = TestRepository::new();
        repository.write("tree.txt", "root\n");
        stage_all(&repository.path).expect("stage root");
        commit(&repository.path, "Root").expect("commit root");
        create_branch(&repository.path, "feature").expect("create feature");
        repository.write("tree.txt", "feature\n");
        stage_all(&repository.path).expect("stage feature");
        commit(&repository.path, "Feature").expect("commit feature");
        let feature_oid = snapshot(&repository.path)
            .expect("read feature")
            .head_oid
            .expect("feature oid");

        checkout_branch(&repository.path, "main").expect("return to main");
        integrate_branch(&repository.path, "feature", "ff-only").expect("fast-forward feature");
        assert_eq!(
            snapshot(&repository.path).expect("read merge").head_oid,
            Some(feature_oid)
        );

        rename_branch(&repository.path, "feature", "canopy").expect("rename feature");
        delete_branch(&repository.path, "canopy", false).expect("delete merged branch");
        let branches = snapshot(&repository.path).expect("read branches").branches;
        assert!(
            !branches
                .iter()
                .any(|branch| branch.name == "feature" || branch.name == "canopy")
        );

        create_branch(&repository.path, "experiment").expect("create experiment");
        repository.write("tree.txt", "experiment\n");
        stage_all(&repository.path).expect("stage experiment");
        commit(&repository.path, "Experiment").expect("commit experiment");
        checkout_branch(&repository.path, "main").expect("leave experiment");
        let unmerged = delete_branch(&repository.path, "experiment", false)
            .expect_err("protect unmerged branch");
        assert_eq!(unmerged.kind, "branchNotMerged");
        assert!(
            snapshot(&repository.path)
                .expect("read protected branch")
                .branches
                .iter()
                .any(|branch| branch.name == "experiment")
        );
        delete_branch(&repository.path, "experiment", true).expect("force delete unmerged branch");
        assert!(
            !snapshot(&repository.path)
                .expect("read forced deletion")
                .branches
                .iter()
                .any(|branch| branch.name == "experiment")
        );

        let error = integrate_branch(&repository.path, "main", "octopus")
            .expect_err("reject unknown integration strategy");
        assert_eq!(error.kind, "invalidIntegrationStrategy");
    }

    #[test]
    fn plans_and_executes_interactive_rebase_actions() {
        let repository = TestRepository::new();
        repository.write("root.txt", "root\n");
        stage_all(&repository.path).expect("stage root");
        commit(&repository.path, "Root").expect("commit root");
        create_branch(&repository.path, "feature").expect("create feature");
        for (file, subject) in [
            ("one.txt", "One"),
            ("two.txt", "Two"),
            ("three.txt", "Three"),
            ("four.txt", "Four"),
        ] {
            repository.write(file, subject);
            stage_all(&repository.path).expect("stage feature commit");
            commit(&repository.path, subject).expect("create feature commit");
        }
        checkout_branch(&repository.path, "main").expect("checkout main");
        repository.write("main.txt", "main\n");
        stage_all(&repository.path).expect("stage main");
        commit(&repository.path, "Main").expect("commit main");

        let plan = prepare_interactive_rebase(&repository.path, "feature", "main")
            .expect("prepare interactive rebase");
        assert_eq!(plan.commits.len(), 4);
        let steps = vec![
            InteractiveRebaseStep {
                oid: plan.commits[0].oid.clone(),
                action: "pick".into(),
                message: None,
            },
            InteractiveRebaseStep {
                oid: plan.commits[1].oid.clone(),
                action: "reword".into(),
                message: Some("Renamed Two".into()),
            },
            InteractiveRebaseStep {
                oid: plan.commits[2].oid.clone(),
                action: "squash".into(),
                message: None,
            },
            InteractiveRebaseStep {
                oid: plan.commits[3].oid.clone(),
                action: "drop".into(),
                message: None,
            },
        ];
        execute_interactive_rebase(&repository.path, "feature", "main", &steps)
            .expect("execute interactive rebase");

        let log = run_git(
            &repository.path,
            &["log", "--format=%s", "--reverse", "main..feature"],
        )
        .expect("read rebased history");
        assert!(log.status.success());
        assert_eq!(
            String::from_utf8_lossy(&log.stdout)
                .lines()
                .collect::<Vec<_>>(),
            vec!["One", "Renamed Two"]
        );
        assert!(!repository.path.join(".git/git-chronos-rebase").exists());
    }

    #[test]
    fn preserves_and_aborts_a_conflicted_interactive_rebase() {
        let repository = TestRepository::new();
        repository.write("shared.txt", "root\n");
        stage_all(&repository.path).expect("stage root");
        commit(&repository.path, "Root").expect("commit root");
        create_branch(&repository.path, "feature").expect("create feature");
        repository.write("shared.txt", "feature\n");
        stage_all(&repository.path).expect("stage feature");
        commit(&repository.path, "Feature").expect("commit feature");
        checkout_branch(&repository.path, "main").expect("checkout main");
        repository.write("shared.txt", "main\n");
        stage_all(&repository.path).expect("stage main");
        commit(&repository.path, "Main").expect("commit main");

        let plan = prepare_interactive_rebase(&repository.path, "feature", "main")
            .expect("prepare conflicting rebase");
        let steps = vec![InteractiveRebaseStep {
            oid: plan.commits[0].oid.clone(),
            action: "pick".into(),
            message: None,
        }];
        let error = execute_interactive_rebase(&repository.path, "feature", "main", &steps)
            .expect_err("surface rebase conflict");
        assert_eq!(error.kind, "rebaseConflict");
        assert!(
            snapshot(&repository.path)
                .expect("read conflict state")
                .status
                .rebase_in_progress
        );
        abort_rebase(&repository.path).expect("abort rebase");
        assert!(
            !snapshot(&repository.path)
                .expect("read aborted state")
                .status
                .rebase_in_progress
        );
    }

    #[test]
    fn inspects_and_resolves_a_text_merge_conflict() {
        let repository = TestRepository::new();
        repository.write("shared.txt", "root\n");
        stage_all(&repository.path).expect("stage root");
        commit(&repository.path, "Root").expect("commit root");
        create_branch(&repository.path, "feature").expect("create feature");
        repository.write("shared.txt", "feature\n");
        stage_all(&repository.path).expect("stage feature");
        commit(&repository.path, "Feature").expect("commit feature");
        checkout_branch(&repository.path, "main").expect("checkout main");
        repository.write("shared.txt", "main\n");
        stage_all(&repository.path).expect("stage main");
        commit(&repository.path, "Main").expect("commit main");

        integrate_branch(&repository.path, "feature", "merge").expect_err("create merge conflict");
        assert!(
            snapshot(&repository.path)
                .expect("read active merge")
                .status
                .merge_in_progress
        );
        let details =
            conflict_details(&repository.path, "shared.txt").expect("inspect conflict stages");
        assert_eq!(details.ancestor.as_deref(), Some("root\n"));
        assert_eq!(details.current.as_deref(), Some("main\n"));
        assert_eq!(details.incoming.as_deref(), Some("feature\n"));
        assert!(!details.binary);

        resolve_conflict(&repository.path, "shared.txt", "output", Some("resolved\n"))
            .expect("save resolved output");
        let status = snapshot(&repository.path)
            .expect("read resolved status")
            .status;
        assert_eq!(status.conflicted, 0);
        assert_eq!(status.staged, 1);
        assert_eq!(
            fs::read_to_string(repository.path.join("shared.txt")).expect("read resolution"),
            "resolved\n"
        );
        continue_merge(&repository.path).expect("continue resolved merge");
        assert!(
            !snapshot(&repository.path)
                .expect("read completed merge")
                .status
                .merge_in_progress
        );
    }

    #[test]
    fn aborts_a_conflicted_merge_and_restores_the_original_branch() {
        let repository = TestRepository::new();
        repository.write("shared.txt", "root\n");
        stage_all(&repository.path).expect("stage root");
        commit(&repository.path, "Root").expect("commit root");
        create_branch(&repository.path, "feature").expect("create feature");
        repository.write("shared.txt", "feature\n");
        stage_all(&repository.path).expect("stage feature");
        commit(&repository.path, "Feature").expect("commit feature");
        checkout_branch(&repository.path, "main").expect("checkout main");
        repository.write("shared.txt", "main\n");
        stage_all(&repository.path).expect("stage main");
        commit(&repository.path, "Main").expect("commit main");
        let before = snapshot(&repository.path)
            .expect("read pre-merge head")
            .head_oid;

        integrate_branch(&repository.path, "feature", "merge").expect_err("create merge conflict");
        abort_merge(&repository.path).expect("abort merge");
        let restored = snapshot(&repository.path).expect("read restored merge state");
        assert!(!restored.status.merge_in_progress);
        assert_eq!(restored.status.conflicted, 0);
        assert_eq!(restored.head_oid, before);
        assert_eq!(
            fs::read_to_string(repository.path.join("shared.txt")).expect("read restored file"),
            "main\n"
        );
    }

    #[test]
    fn initializes_and_clones_repositories_into_validated_destinations() {
        let source = TestRepository::new();
        source.write("seed.txt", "seed\n");
        stage_all(&source.path).expect("stage seed");
        commit(&source.path, "Seed").expect("commit seed");
        let parent = std::env::temp_dir().join(format!(
            "git-chronos-destination-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&parent).expect("create destination parent");

        let initialized = initialize_repository(&parent, "new-grove", "trunk", true)
            .expect("initialize repository");
        let initialized_snapshot = snapshot(&initialized).expect("read initialized repository");
        assert_eq!(initialized_snapshot.status.branch.as_deref(), Some("trunk"));
        assert!(initialized.join("README.md").is_file());

        let source_text = source.path.to_string_lossy().into_owned();
        let cloned = clone_repository(&source_text, &parent, "cloned-grove", None, Some(1))
            .expect("clone repository");
        assert_eq!(snapshot(&cloned).expect("read clone").commits.len(), 1);
        let invalid = initialize_repository(&parent, "../escape", "main", false)
            .expect_err("reject a path-like folder name");
        assert_eq!(invalid.kind, "invalidFolderName");

        fs::remove_dir_all(parent).expect("remove destination parent");
    }

    #[test]
    fn fetches_updates_from_every_configured_remote() {
        let source = TestRepository::new();
        source.write("seed.txt", "seed\n");
        stage_all(&source.path).expect("stage seed");
        commit(&source.path, "Seed").expect("commit seed");

        let parent = std::env::temp_dir().join(format!(
            "git-chronos-fetch-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&parent).expect("create fetch fixture directory");
        let origin = parent.join("origin.git");
        let upstream = parent.join("upstream.git");
        for remote in [&origin, &upstream] {
            let output = Command::new("git")
                .args(["clone", "--bare"])
                .arg(&source.path)
                .arg(remote)
                .output()
                .expect("create bare remote");
            assert!(
                output.status.success(),
                "create bare remote failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        let origin_text = origin.to_string_lossy().into_owned();
        let upstream_text = upstream.to_string_lossy().into_owned();
        let working = clone_repository(&origin_text, &parent, "working", None, None)
            .expect("clone working repository");
        let working_repository = TestRepository {
            path: working.clone(),
        };
        assert!(
            !fetch_if_needed(&working).expect("check unchanged origin"),
            "background synchronization should skip object negotiation when refs are unchanged"
        );
        working_repository.git(&["remote", "add", "upstream", &upstream_text]);
        source.git(&["remote", "add", "origin-fixture", &origin_text]);
        source.git(&["remote", "add", "upstream-fixture", &upstream_text]);

        source.write("seed.txt", "seed\nremote update\n");
        stage_all(&source.path).expect("stage remote update");
        commit(&source.path, "Remote update").expect("commit remote update");
        source.git(&["push", "origin-fixture", "main"]);
        source.git(&["push", "upstream-fixture", "main"]);

        assert!(
            fetch_if_needed(&working).expect("fetch changed remotes"),
            "background synchronization should fetch advertised ref changes"
        );
        assert!(
            !fetch_if_needed(&working).expect("recheck synchronized remotes"),
            "a synchronized repository should return to the cheap no-op path"
        );
        let expected = snapshot(&source.path)
            .expect("read source head")
            .head_oid
            .expect("source head oid");
        let refreshed = snapshot(&working).expect("refresh fetched repository view");
        assert!(
            refreshed
                .commits
                .iter()
                .any(|commit| commit.oid == expected),
            "the repository view should include commits reachable only from updated remote refs"
        );
        for remote_branch in ["origin/main", "upstream/main"] {
            assert!(
                refreshed.branches.iter().any(|branch| {
                    branch.remote && branch.name == remote_branch && branch.oid == expected
                }),
                "the repository view should expose the updated {remote_branch} tip"
            );
        }
        for reference in ["refs/remotes/origin/main", "refs/remotes/upstream/main"] {
            let output = run_git(&working, &["rev-parse", reference]).expect("read remote ref");
            assert!(output.status.success(), "missing fetched ref {reference}");
            assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), expected);
        }

        drop(working_repository);
        fs::remove_dir_all(parent).expect("remove fetch fixture directory");
    }

    #[test]
    fn creates_a_local_tracking_branch_from_a_remote_branch() {
        let source = TestRepository::new();
        source.write("seed.txt", "seed\n");
        stage_all(&source.path).expect("stage seed");
        commit(&source.path, "Seed").expect("commit seed");

        let parent = std::env::temp_dir().join(format!(
            "git-chronos-tracking-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&parent).expect("create tracking fixture directory");
        let remote = parent.join("origin.git");
        let output = Command::new("git")
            .args(["clone", "--bare"])
            .arg(&source.path)
            .arg(&remote)
            .output()
            .expect("create bare remote");
        assert!(
            output.status.success(),
            "create bare remote failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let remote_text = remote.to_string_lossy().into_owned();
        let working = clone_repository(&remote_text, &parent, "working", None, None)
            .expect("clone working repository");
        source.git(&["remote", "add", "fixture", &remote_text]);
        create_branch(&source.path, "remote-feature").expect("create remote feature");
        source.write("feature.txt", "remote feature\n");
        stage_all(&source.path).expect("stage remote feature");
        commit(&source.path, "Remote feature").expect("commit remote feature");
        source.git(&["push", "fixture", "remote-feature"]);

        fetch(&working).expect("fetch remote feature");
        checkout_remote_branch(&working, "origin/remote-feature").expect("create tracking branch");
        let tracked = snapshot(&working).expect("read tracking branch");
        assert_eq!(tracked.status.branch.as_deref(), Some("remote-feature"));
        let branch = tracked
            .branches
            .iter()
            .find(|branch| branch.name == "remote-feature" && !branch.remote)
            .expect("find local tracking branch");
        assert_eq!(branch.upstream.as_deref(), Some("origin/remote-feature"));

        fs::write(working.join("local.txt"), "ahead locally\n").expect("write local change");
        stage_all(&working).expect("stage local change");
        commit(&working, "Advance local feature").expect("commit local change");
        checkout_branch(&working, "main").expect("leave tracking branch");
        let non_current = snapshot(&working).expect("read non-current tracking branch");
        let branch = non_current
            .branches
            .iter()
            .find(|branch| branch.name == "remote-feature" && !branch.remote)
            .expect("find non-current tracking branch");
        assert_eq!(branch.tracking.as_deref(), Some("ahead 1"));

        fs::remove_dir_all(parent).expect("remove tracking fixture directory");
    }

    #[test]
    fn sets_and_unsets_a_local_branch_upstream() {
        let repository = TestRepository::new();
        repository.write("seed.txt", "seed\n");
        stage_all(&repository.path).expect("stage seed");
        commit(&repository.path, "Seed").expect("commit seed");
        let oid = snapshot(&repository.path)
            .expect("read seed")
            .head_oid
            .expect("seed oid");
        let repository_path = repository.path.to_string_lossy().into_owned();
        repository.git(&["remote", "add", "origin", &repository_path]);
        repository.git(&["branch", "feature"]);
        repository.git(&["update-ref", "refs/remotes/origin/feature", &oid]);

        set_branch_upstream(&repository.path, "feature", Some("origin/feature"))
            .expect("set upstream");
        let tracked = snapshot(&repository.path).expect("read tracked branch");
        let feature = tracked
            .branches
            .iter()
            .find(|branch| branch.name == "feature" && !branch.remote)
            .expect("find feature branch");
        assert_eq!(feature.upstream.as_deref(), Some("origin/feature"));

        set_branch_upstream(&repository.path, "feature", None).expect("unset upstream");
        let untracked = snapshot(&repository.path).expect("read untracked branch");
        let feature = untracked
            .branches
            .iter()
            .find(|branch| branch.name == "feature" && !branch.remote)
            .expect("find feature branch");
        assert_eq!(feature.upstream, None);
    }

    #[test]
    fn publishes_a_local_branch_and_sets_its_upstream() {
        let repository = TestRepository::new();
        repository.write("seed.txt", "seed\n");
        stage_all(&repository.path).expect("stage seed");
        commit(&repository.path, "Seed").expect("commit seed");
        create_branch(&repository.path, "feature").expect("create feature branch");

        let parent = std::env::temp_dir().join(format!(
            "git-chronos-publish-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&parent).expect("create publish fixture directory");
        let remote = parent.join("origin.git");
        let output = Command::new("git")
            .args(["init", "--bare"])
            .arg(&remote)
            .output()
            .expect("create bare remote");
        assert!(output.status.success(), "create bare remote");
        let remote_text = remote.to_string_lossy().into_owned();
        repository.git(&["remote", "add", "origin", &remote_text]);

        publish_branch(&repository.path, "origin", "feature").expect("publish feature");
        let published = snapshot(&repository.path).expect("read published branch");
        let feature = published
            .branches
            .iter()
            .find(|branch| branch.name == "feature" && !branch.remote)
            .expect("find feature branch");
        assert_eq!(feature.upstream.as_deref(), Some("origin/feature"));
        assert!(
            published
                .remotes
                .iter()
                .any(|remote| remote.name == "origin")
        );

        let output = Command::new("git")
            .arg("--git-dir")
            .arg(&remote)
            .args(["show-ref", "--verify", "--quiet", "refs/heads/feature"])
            .output()
            .expect("read published remote branch");
        assert!(
            output.status.success(),
            "remote feature branch should exist"
        );
        fs::remove_dir_all(parent).expect("remove publish fixture directory");
    }

    #[test]
    fn pushes_only_to_the_selected_remote() {
        let repository = TestRepository::new();
        repository.write("seed.txt", "seed\n");
        stage_all(&repository.path).expect("stage seed");
        commit(&repository.path, "Seed").expect("commit seed");

        let parent = std::env::temp_dir().join(format!(
            "git-chronos-selected-remote-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&parent).expect("create selected remote fixture directory");
        let origin = parent.join("origin.git");
        let upstream = parent.join("upstream.git");
        for remote in [&origin, &upstream] {
            let output = Command::new("git")
                .args(["init", "--bare"])
                .arg(remote)
                .output()
                .expect("create bare remote");
            assert!(output.status.success(), "create bare remote");
        }
        let origin_text = origin.to_string_lossy().into_owned();
        let upstream_text = upstream.to_string_lossy().into_owned();
        repository.git(&["remote", "add", "origin", &origin_text]);
        repository.git(&["remote", "add", "upstream", &upstream_text]);

        push_to_remote(&repository.path, "upstream", "main").expect("push selected remote");

        let has_branch = |remote: &Path| {
            Command::new("git")
                .arg("--git-dir")
                .arg(remote)
                .args(["show-ref", "--verify", "--quiet", "refs/heads/main"])
                .status()
                .expect("inspect remote branch")
                .success()
        };
        assert!(!has_branch(&origin), "origin must remain untouched");
        assert!(has_branch(&upstream), "selected remote must receive main");
        repository.git(&["branch", "--set-upstream-to=upstream/main", "main"]);
        repository.write("next.txt", "next\n");
        stage_all(&repository.path).expect("stage next commit");
        commit(&repository.path, "Advance local branch").expect("commit local change");
        assert_eq!(
            snapshot(&repository.path)
                .expect("before push")
                .status
                .ahead,
            1
        );
        push_to_remote_cancellable(
            &repository.path,
            "upstream",
            "main",
            &CancellationToken::default(),
        )
        .expect("push next commit");
        let synchronized = snapshot_with_limits_fast(&repository.path, 50, 50)
            .expect("snapshot immediately after push");
        assert_eq!(synchronized.status.ahead, 0);
        assert_eq!(synchronized.status.behind, 0);
        let local = synchronized
            .branches
            .iter()
            .find(|branch| branch.current)
            .expect("local branch");
        let remote = synchronized
            .branches
            .iter()
            .find(|branch| branch.name == "upstream/main")
            .expect("remote branch");
        assert_eq!(local.oid, remote.oid);
        assert!(local.tracking.is_none());
        let tip = synchronized
            .commits
            .iter()
            .find(|commit| commit.oid == local.oid)
            .expect("tip commit");
        assert!(
            tip.decorations
                .iter()
                .any(|decoration| decoration == "upstream/main")
        );
        assert!(
            synchronized
                .commits
                .iter()
                .filter(|commit| commit.oid != local.oid)
                .all(|commit| !commit
                    .decorations
                    .iter()
                    .any(|decoration| decoration == "upstream/main"))
        );
        fs::remove_dir_all(parent).expect("remove selected remote fixture directory");
    }

    #[test]
    fn force_push_with_lease_rejects_an_unseen_remote_update() {
        let repository = TestRepository::new();
        repository.write("story.txt", "first\n");
        stage_all(&repository.path).expect("stage first revision");
        commit(&repository.path, "First revision").expect("commit first revision");

        let parent = std::env::temp_dir().join(format!(
            "git-chronos-force-push-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&parent).expect("create force-push fixture directory");
        let remote = parent.join("origin.git");
        let output = Command::new("git")
            .args(["init", "--bare"])
            .arg(&remote)
            .output()
            .expect("create bare remote");
        assert!(output.status.success(), "create bare remote");
        let remote_text = remote.to_string_lossy().into_owned();
        repository.git(&["remote", "add", "origin", &remote_text]);
        publish_branch(&repository.path, "origin", "main").expect("publish main");

        repository.write("story.txt", "second\n");
        stage_all(&repository.path).expect("stage second revision");
        commit(&repository.path, "Second revision").expect("commit second revision");
        let unseen_oid = snapshot(&repository.path)
            .expect("read second revision")
            .head_oid
            .expect("second revision oid");
        repository.git(&["push", "origin", "HEAD:refs/heads/unseen"]);
        let output = Command::new("git")
            .arg("--git-dir")
            .arg(&remote)
            .args(["update-ref", "refs/heads/main", &unseen_oid])
            .output()
            .expect("advance remote without updating the local tracking ref");
        assert!(output.status.success(), "advance remote main");

        repository.write("story.txt", "rewritten\n");
        stage_all(&repository.path).expect("stage rewritten revision");
        commit_with_options(
            &repository.path,
            "Rewritten revision",
            true,
            false,
            Some(false),
        )
        .expect("rewrite local revision");

        let error = push_force_with_lease(&repository.path)
            .expect_err("the stale lease must reject the force push");
        assert_eq!(error.kind, "gitFailure");
        let remote_oid = Command::new("git")
            .arg("--git-dir")
            .arg(&remote)
            .args(["rev-parse", "refs/heads/main"])
            .output()
            .expect("read protected remote main");
        assert!(remote_oid.status.success(), "read protected remote main");
        assert_eq!(
            String::from_utf8_lossy(&remote_oid.stdout).trim(),
            unseen_oid
        );
        fs::remove_dir_all(parent).expect("remove force-push fixture directory");
    }

    #[test]
    fn adds_updates_and_removes_remote_configuration() {
        let repository = TestRepository::new();
        let first_url = "https://example.test/team/forest.git";
        let second_url = "ssh://git@example.test/team/forest.git";

        add_remote(&repository.path, "origin", first_url).expect("add remote");
        let added = snapshot(&repository.path).expect("read added remote");
        let origin = added
            .remotes
            .iter()
            .find(|remote| remote.name == "origin")
            .expect("find origin");
        assert_eq!(origin.fetch_url, first_url);
        assert_eq!(origin.push_url, first_url);

        set_remote_url(&repository.path, "origin", second_url).expect("update remote URL");
        let updated = snapshot(&repository.path).expect("read updated remote");
        let origin = updated
            .remotes
            .iter()
            .find(|remote| remote.name == "origin")
            .expect("find updated origin");
        assert_eq!(origin.fetch_url, second_url);
        assert_eq!(origin.push_url, second_url);

        remove_remote(&repository.path, "origin").expect("remove remote");
        assert!(
            snapshot(&repository.path)
                .expect("read removed remote")
                .remotes
                .is_empty()
        );

        repository.git(&[
            "config",
            "remote.broken.fetch",
            "+refs/heads/*:refs/remotes/broken/*",
        ]);
        let incomplete = snapshot(&repository.path).expect("read remote without URL");
        let broken = incomplete
            .remotes
            .iter()
            .find(|remote| remote.name == "broken")
            .expect("find remote without URL");
        assert_eq!(broken.fetch_url, "broken");
        assert_eq!(broken.push_url, "broken");
        set_remote_url(&repository.path, "broken", first_url).expect("repair remote URL");
        assert_eq!(
            snapshot(&repository.path)
                .expect("read repaired remote")
                .remotes
                .iter()
                .find(|remote| remote.name == "broken")
                .expect("find repaired remote")
                .fetch_url,
            first_url
        );

        let invalid = add_remote(&repository.path, "../escape", first_url)
            .expect_err("reject invalid remote name");
        assert_eq!(invalid.kind, "invalidRemoteName");
    }

    #[test]
    fn compares_commits_and_reads_the_selected_file_diff() {
        let repository = TestRepository::new();
        repository.write("forest.txt", "oak\n");
        stage_all(&repository.path).expect("stage base file");
        commit(&repository.path, "Plant oak").expect("commit base");
        let base = snapshot(&repository.path).expect("read base").commits[0]
            .oid
            .clone();

        repository.write("forest.txt", "oak\nbeech\n");
        repository.write("trail.txt", "north\n");
        stage_all(&repository.path).expect("stage target files");
        commit(&repository.path, "Add beech and trail").expect("commit target");
        let target = snapshot(&repository.path).expect("read target").commits[0]
            .oid
            .clone();

        let comparison =
            compare_commits(&repository.path, &base, &target).expect("compare revisions");
        assert_eq!(comparison.base_oid, base);
        assert_eq!(comparison.target_oid, target);
        assert!(!comparison.working_tree);
        assert!(
            comparison
                .files
                .iter()
                .any(|file| file.path == "forest.txt" && file.status == "M")
        );
        assert!(
            comparison
                .files
                .iter()
                .any(|file| file.path == "trail.txt" && file.status == "A")
        );

        let diff = compare_commit_file(&repository.path, &base, &target, "forest.txt", None)
            .expect("compare file");
        assert!(diff.patch.contains("+beech"));
    }

    #[test]
    fn compares_a_commit_with_tracked_and_untracked_working_directory_files() {
        let repository = TestRepository::new();
        repository.write("forest.txt", "oak\n");
        stage_all(&repository.path).expect("stage base file");
        commit(&repository.path, "Plant oak").expect("commit base");
        let base = snapshot(&repository.path).expect("read base").commits[0]
            .oid
            .clone();

        repository.write("canopy.txt", "green\n");
        stage_all(&repository.path).expect("stage later committed file");
        commit(&repository.path, "Grow canopy").expect("commit later file");
        repository.write("forest.txt", "oak\nbeech\n");
        repository.write("trail.txt", "north\n");

        let comparison = compare_commit_with_working_tree(&repository.path, &base)
            .expect("compare commit with working directory");
        assert_eq!(comparison.base_oid, base);
        assert_eq!(comparison.target_oid, base);
        assert!(comparison.working_tree);
        assert!(comparison.files.iter().any(|file| {
            file.path == "forest.txt"
                && file.status == "M"
                && file.additions == Some(1)
                && file.deletions == Some(0)
        }));
        assert!(comparison.files.iter().any(|file| {
            file.path == "trail.txt"
                && file.status == "A"
                && file.additions == Some(1)
                && file.deletions == Some(0)
        }));
        let canopy = comparison
            .files
            .iter()
            .find(|file| file.path == "canopy.txt")
            .unwrap_or_else(|| panic!("missing canopy.txt from {:#?}", comparison.files));
        assert_eq!(canopy.status, "A");

        let tracked =
            compare_commit_file_with_working_tree(&repository.path, &base, "forest.txt", None)
                .expect("compare tracked file with working directory");
        assert!(tracked.patch.contains("+beech"));

        let clean_since_head =
            compare_commit_file_with_working_tree(&repository.path, &base, "canopy.txt", None)
                .expect("compare file changed after the selected commit");
        assert!(clean_since_head.patch.contains("+green"));

        let untracked =
            compare_commit_file_with_working_tree(&repository.path, &base, "trail.txt", None)
                .expect("compare untracked file with working directory");
        assert!(untracked.patch.contains("+north"));
    }

    #[test]
    fn snapshots_and_mutates_a_real_repository() {
        let repository = TestRepository::new();
        repository.write("README.md", "# Sapling\n");

        let untracked = snapshot(&repository.path).expect("snapshot untracked repository");
        assert_eq!(untracked.status.untracked, 1);
        assert!(untracked.commits.is_empty());

        stage_all(&repository.path).expect("stage initial file");
        let staged = snapshot(&repository.path).expect("snapshot staged repository");
        assert_eq!(staged.status.staged, 1);

        commit(
            &repository.path,
            "Plant the first tree\n\nExplain why this sapling belongs in the forest.",
        )
        .expect("commit initial file");
        create_branch(&repository.path, "canopy").expect("create branch");
        let committed = snapshot(&repository.path).expect("snapshot committed repository");
        assert_eq!(committed.status.branch.as_deref(), Some("canopy"));
        assert_eq!(committed.commits.len(), 1);
        assert_eq!(committed.commits[0].subject, "Plant the first tree");
        assert_eq!(
            committed.commits[0].description,
            "Explain why this sapling belongs in the forest."
        );
        assert!(
            committed
                .branches
                .iter()
                .any(|branch| branch.current && branch.name == "canopy")
        );

        let oid = committed.commits[0].oid.clone();
        let details = commit_details(&repository.path, &oid).expect("read commit details");
        assert_eq!(
            details.message,
            "Plant the first tree\n\nExplain why this sapling belongs in the forest."
        );
        assert_eq!(details.files.len(), 1);
        assert_eq!(details.files[0].status, "A");
        assert_eq!(details.files[0].path, "README.md");
        let diff = commit_file_diff(&repository.path, &oid, "README.md", None)
            .expect("read committed file diff");
        assert!(!diff.truncated);
        assert!(diff.patch.contains("+# Sapling"));

        repository.write("README.md", "# Canopy\n");
        repository.write("new.txt", "new growth\n");
        let changed = snapshot(&repository.path).expect("snapshot changed repository");
        assert_eq!(changed.status.unstaged, 1);
        assert_eq!(changed.status.untracked, 1);
        let unstaged_diff = working_tree_file_diff(&repository.path, "README.md", false)
            .expect("read unstaged diff");
        assert!(unstaged_diff.patch.contains("+# Canopy"));
        let untracked_diff = working_tree_file_diff(&repository.path, "new.txt", false)
            .expect("read untracked diff");
        assert!(untracked_diff.patch.contains("+new growth"));

        stage_path(&repository.path, "README.md").expect("stage one path");
        let partially_staged =
            snapshot(&repository.path).expect("snapshot partially staged repository");
        assert_eq!(partially_staged.status.staged, 1);
        assert_eq!(partially_staged.status.untracked, 1);
        let staged_diff =
            working_tree_file_diff(&repository.path, "README.md", true).expect("read staged diff");
        assert!(staged_diff.patch.contains("+# Canopy"));
        unstage_path(&repository.path, "README.md").expect("unstage one path");
        let restored = snapshot(&repository.path).expect("snapshot unstaged repository");
        assert_eq!(restored.status.staged, 0);
        assert_eq!(restored.status.unstaged, 1);
        assert_eq!(restored.status.untracked, 1);
    }

    #[test]
    fn performs_repository_maintenance_through_git() {
        let repository = TestRepository::new();
        repository.write("README.md", "# Maintained repository\n");
        stage_all(&repository.path).expect("stage maintenance fixture");
        commit(&repository.path, "Create maintenance fixture").expect("commit maintenance fixture");

        perform_repository_maintenance(&repository.path).expect("perform repository maintenance");

        let snapshot = snapshot(&repository.path).expect("read maintained repository");
        assert_eq!(snapshot.commits.len(), 1);
    }

    #[test]
    fn fast_snapshot_defers_non_current_branch_divergence() {
        let repository = TestRepository::new();
        repository.write("README.md", "# Branch tracking\n");
        stage_all(&repository.path).expect("stage branch fixture");
        commit(&repository.path, "Create branch fixture").expect("commit branch fixture");
        let remote_path = repository.path.to_string_lossy().into_owned();
        repository.git(&["remote", "add", "origin", &remote_path]);
        repository.git(&["branch", "topic"]);
        repository.git(&["update-ref", "refs/remotes/origin/topic", "topic"]);
        repository.git(&["config", "branch.topic.remote", "origin"]);
        repository.git(&["config", "branch.topic.merge", "refs/heads/topic"]);
        repository.git(&["checkout", "topic"]);
        repository.write("README.md", "# Branch tracking\n\nAhead\n");
        stage_all(&repository.path).expect("stage topic change");
        commit(&repository.path, "Advance topic").expect("commit topic change");
        repository.git(&["checkout", "main"]);

        let full = snapshot_with_limits(&repository.path, 200, 1_000)
            .expect("read complete branch tracking");
        let full_topic = full
            .branches
            .iter()
            .find(|branch| branch.name == "topic")
            .expect("full topic branch");
        assert_eq!(full_topic.upstream.as_deref(), Some("origin/topic"));
        assert_eq!(full_topic.tracking.as_deref(), Some("ahead 1"));

        let fast = snapshot_with_limits_fast(&repository.path, 200, 1_000)
            .expect("read latency-sensitive branch tracking");
        let fast_topic = fast
            .branches
            .iter()
            .find(|branch| branch.name == "topic")
            .expect("fast topic branch");
        assert_eq!(fast_topic.upstream.as_deref(), Some("origin/topic"));
        assert_eq!(fast_topic.tracking, None);
    }

    #[test]
    fn startup_snapshot_defers_the_working_tree_scan() {
        let repository = TestRepository::new();
        repository.write("README.md", "# Initial\n");
        stage_all(&repository.path).expect("stage startup fixture");
        commit(&repository.path, "Create startup fixture").expect("commit startup fixture");
        repository.git(&["tag", "startup-v1"]);
        repository.write("README.md", "# Changed\n");
        repository.write("untracked.txt", "not indexed\n");

        let startup = snapshot_with_limits_startup(&repository.path, 200, 1_000)
            .expect("read first-frame snapshot");
        assert_eq!(startup.status.branch.as_deref(), Some("main"));
        assert_eq!(startup.status.entry_count, 0);
        assert!(startup.status.entries.is_empty());
        assert!(startup.tags.is_empty());

        let refreshed_status =
            status_with_entry_limit_fast(&repository.path, 1_000).expect("refresh deferred status");
        assert_eq!(refreshed_status.unstaged, 1);
        assert_eq!(refreshed_status.untracked, 1);

        let refreshed = snapshot_with_limits_fast(&repository.path, 200, 1_000)
            .expect("hydrate deferred repository metadata");
        assert_eq!(refreshed.status.unstaged, 1);
        assert_eq!(refreshed.tags.len(), 1);
    }

    #[test]
    fn reads_file_history_and_line_blame() {
        let repository = TestRepository::new();
        repository.write("forest.txt", "oak\nbirch\n");
        repository.write("trail.txt", "north\n");
        stage_all(&repository.path).expect("stage initial forest");
        commit(&repository.path, "Plant the forest").expect("commit initial forest");
        repository.write("forest.txt", "oak\nbeech\n");
        repository.write("trail.txt", "south\n");
        stage_all(&repository.path).expect("stage forest update");
        commit(&repository.path, "Replace birch with beech").expect("commit forest update");
        let revision = snapshot(&repository.path)
            .expect("read forest revision")
            .head_oid
            .expect("forest head");

        let history =
            file_history(&repository.path, &revision, "forest.txt").expect("read file history");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].subject, "Replace birch with beech");
        assert_eq!(history[1].subject, "Plant the forest");

        let blame = file_blame(&repository.path, &revision, "forest.txt").expect("read file blame");
        assert_eq!(blame.len(), 2);
        assert_eq!(blame[0].text, "oak");
        assert_eq!(blame[0].summary, "Plant the forest");
        assert_eq!(blame[1].text, "beech");
        assert_eq!(blame[1].summary, "Replace birch with beech");

        restore_files_from_commit(
            &repository.path,
            &history[1].oid,
            &["forest.txt".into(), "trail.txt".into()],
        )
        .expect("restore files from initial commit");
        assert_eq!(
            fs::read_to_string(repository.path.join("forest.txt")).expect("read restored file"),
            "oak\nbirch\n"
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("trail.txt")).expect("read restored trail"),
            "north\n"
        );
        assert_eq!(
            snapshot(&repository.path)
                .expect("read restored status")
                .status
                .staged,
            2
        );
    }

    #[test]
    fn discards_and_ignores_working_tree_files_safely() {
        let repository = TestRepository::new();
        repository.write("tracked.txt", "original\n");
        stage_all(&repository.path).expect("stage tracked file");
        commit(&repository.path, "Add tracked file").expect("commit tracked file");

        repository.write("tracked.txt", "changed\n");
        discard_path(&repository.path, "tracked.txt", false).expect("discard tracked change");
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("read restored file"),
            "original\n"
        );

        repository.write("scratch.tmp", "temporary\n");
        discard_path(&repository.path, "scratch.tmp", true).expect("discard untracked file");
        assert!(!repository.path.join("scratch.tmp").exists());

        repository.write("secret.log", "private\n");
        ignore_path(&repository.path, "secret.log", "file", false).expect("ignore untracked file");
        let ignore_contents =
            fs::read_to_string(repository.path.join(".gitignore")).expect("read ignore file");
        assert!(ignore_contents.lines().any(|line| line == "/secret.log"));
        assert!(
            !snapshot(&repository.path)
                .expect("snapshot ignored file")
                .status
                .entries
                .iter()
                .any(|entry| entry.path == "secret.log")
        );

        repository.write("settings.toml", "enabled = true\n");
        stage_path(&repository.path, "settings.toml").expect("stage settings");
        commit(&repository.path, "Add settings").expect("commit settings");
        repository.write("settings.toml", "enabled = false\n");
        ignore_path(&repository.path, "settings.toml", "extension", true)
            .expect("ignore and stop tracking settings");
        let ignored = snapshot(&repository.path).expect("snapshot stopped tracking file");
        assert!(
            ignored
                .status
                .entries
                .iter()
                .any(|entry| { entry.path == "settings.toml" && entry.index_status == "D" })
        );
        assert!(repository.path.join("settings.toml").is_file());
        assert!(
            fs::read_to_string(repository.path.join(".gitignore"))
                .expect("read updated ignore file")
                .lines()
                .any(|line| line == "*.toml")
        );
    }

    #[test]
    fn restores_and_reapplies_discarded_tracked_and_untracked_files() {
        let repository = TestRepository::new();
        repository.write("tracked.txt", "original\n");
        stage_all(&repository.path).expect("stage tracked file");
        commit(&repository.path, "Add tracked file").expect("commit tracked file");

        repository.write("tracked.txt", "changed\n");
        let tracked_patch =
            working_tree_file_recovery_patch(&repository.path, "tracked.txt", false)
                .expect("capture tracked recovery");
        let tracked_patch_path = repository.path.join(".git/tracked-recovery.patch");
        fs::write(&tracked_patch_path, tracked_patch).expect("write tracked recovery");
        discard_path(&repository.path, "tracked.txt", false).expect("discard tracked change");
        apply_working_tree_recovery(&repository.path, &tracked_patch_path, false)
            .expect("restore tracked change");
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("read changed file"),
            "changed\n"
        );
        apply_working_tree_recovery(&repository.path, &tracked_patch_path, true)
            .expect("discard tracked change again");
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("read original file"),
            "original\n"
        );

        let binary = b"\0git-chronos\xff\n";
        fs::write(repository.path.join("scratch.bin"), binary).expect("write binary file");
        let untracked_patch =
            working_tree_file_recovery_patch(&repository.path, "scratch.bin", true)
                .expect("capture untracked recovery");
        let untracked_patch_path = repository.path.join(".git/untracked-recovery.patch");
        fs::write(&untracked_patch_path, untracked_patch).expect("write untracked recovery");
        discard_path(&repository.path, "scratch.bin", true).expect("discard untracked binary");
        apply_working_tree_recovery(&repository.path, &untracked_patch_path, false)
            .expect("restore untracked binary");
        assert_eq!(
            fs::read(repository.path.join("scratch.bin")).expect("read restored binary"),
            binary
        );
        apply_working_tree_recovery(&repository.path, &untracked_patch_path, true)
            .expect("discard untracked binary again");
        assert!(!repository.path.join("scratch.bin").exists());

        fs::write(repository.path.join("empty.txt"), []).expect("write empty file");
        let empty_patch = working_tree_file_recovery_patch(&repository.path, "empty.txt", true)
            .expect("capture empty-file recovery");
        let empty_patch_path = repository.path.join(".git/empty-recovery.patch");
        fs::write(&empty_patch_path, empty_patch).expect("write empty-file recovery");
        discard_path(&repository.path, "empty.txt", true).expect("discard empty file");
        apply_working_tree_recovery(&repository.path, &empty_patch_path, false)
            .expect("restore empty file");
        assert_eq!(
            fs::metadata(repository.path.join("empty.txt"))
                .expect("read empty file metadata")
                .len(),
            0
        );
    }

    #[test]
    fn stages_unstages_and_discards_individual_diff_hunks() {
        let repository = TestRepository::new();
        let original = (1..=16)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        repository.write("forest.txt", &original);
        stage_all(&repository.path).expect("stage original file");
        commit(&repository.path, "Add forest").expect("commit original file");

        let changed = original
            .replace("line 2\n", "line two changed\n")
            .replace("line 15\n", "line fifteen changed\n");
        repository.write("forest.txt", &changed);
        let diff = working_tree_file_diff(&repository.path, "forest.txt", false)
            .expect("read two-hunk diff");
        assert_eq!(
            diff.patch
                .lines()
                .filter(|line| line.starts_with("@@ "))
                .count(),
            2,
            "{}",
            diff.patch
        );

        apply_working_tree_hunk(&repository.path, "forest.txt", false, 0, "stage")
            .expect("stage first hunk");
        let partial = snapshot(&repository.path).expect("snapshot partially staged file");
        assert_eq!(partial.status.staged, 1);
        assert_eq!(partial.status.unstaged, 1);
        let staged = working_tree_file_diff(&repository.path, "forest.txt", true)
            .expect("read staged first hunk");
        assert!(staged.patch.contains("line two changed"));
        assert!(!staged.patch.contains("line fifteen changed"));

        apply_working_tree_hunk(&repository.path, "forest.txt", true, 0, "unstage")
            .expect("unstage first hunk");
        assert_eq!(
            snapshot(&repository.path)
                .expect("snapshot unstaged hunks")
                .status
                .staged,
            0
        );

        apply_working_tree_hunk(&repository.path, "forest.txt", false, 0, "stage")
            .expect("restage first hunk");
        let recovery = working_tree_hunk_recovery_patch(&repository.path, "forest.txt", 0)
            .expect("capture second hunk recovery");
        let recovery_path = repository.path.join(".git/hunk-recovery.patch");
        fs::write(&recovery_path, recovery).expect("write hunk recovery");
        apply_working_tree_hunk(&repository.path, "forest.txt", false, 0, "discard")
            .expect("discard remaining hunk");
        let contents = fs::read_to_string(repository.path.join("forest.txt"))
            .expect("read partially restored file");
        assert!(contents.contains("line two changed"));
        assert!(contents.contains("line 15\n"));
        assert!(!contents.contains("line fifteen changed"));
        apply_working_tree_recovery(&repository.path, &recovery_path, false)
            .expect("restore discarded hunk");
        assert!(
            fs::read_to_string(repository.path.join("forest.txt"))
                .expect("read restored hunk")
                .contains("line fifteen changed")
        );
        apply_working_tree_recovery(&repository.path, &recovery_path, true)
            .expect("discard restored hunk again");
    }

    #[test]
    fn stages_unstages_and_discards_selected_lines_within_one_hunk() {
        let repository = TestRepository::new();
        let original = (1..=10)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        repository.write("forest.txt", &original);
        stage_all(&repository.path).expect("stage original file");
        commit(&repository.path, "Add forest").expect("commit original file");

        let changed = original
            .replace("line 2\n", "line two changed\n")
            .replace("line 5\n", "line five changed\n");
        repository.write("forest.txt", &changed);
        let diff = working_tree_file_diff(&repository.path, "forest.txt", false)
            .expect("read one-hunk diff");
        assert_eq!(
            diff.patch
                .lines()
                .filter(|line| line.starts_with("@@ "))
                .count(),
            1,
            "{}",
            diff.patch
        );

        apply_working_tree_lines(&repository.path, "forest.txt", false, 0, &[0, 1], "stage")
            .expect("stage first replacement");
        let partial = snapshot(&repository.path).expect("snapshot selected lines");
        assert_eq!(partial.status.staged, 1);
        assert_eq!(partial.status.unstaged, 1);
        let staged = working_tree_file_diff(&repository.path, "forest.txt", true)
            .expect("read staged lines");
        assert!(staged.patch.contains("line two changed"));
        assert!(!staged.patch.contains("line five changed"));

        apply_working_tree_lines(&repository.path, "forest.txt", true, 0, &[0, 1], "unstage")
            .expect("unstage first replacement");
        assert_eq!(
            snapshot(&repository.path)
                .expect("snapshot unstaged lines")
                .status
                .staged,
            0
        );

        apply_working_tree_lines(&repository.path, "forest.txt", false, 0, &[0, 1], "stage")
            .expect("restage first replacement");
        let recovery =
            working_tree_lines_recovery_patch(&repository.path, "forest.txt", 0, &[0, 1])
                .expect("capture second replacement recovery");
        let recovery_path = repository.path.join(".git/line-recovery.patch");
        fs::write(&recovery_path, recovery).expect("write line recovery");
        apply_working_tree_lines(&repository.path, "forest.txt", false, 0, &[0, 1], "discard")
            .expect("discard second replacement");
        let contents = fs::read_to_string(repository.path.join("forest.txt"))
            .expect("read partially restored file");
        assert!(contents.contains("line two changed"));
        assert!(contents.contains("line 5\n"));
        assert!(!contents.contains("line five changed"));
        apply_working_tree_recovery(&repository.path, &recovery_path, false)
            .expect("restore discarded replacement");
        assert!(
            fs::read_to_string(repository.path.join("forest.txt"))
                .expect("read restored replacement")
                .contains("line five changed")
        );
        apply_working_tree_recovery(&repository.path, &recovery_path, true)
            .expect("discard restored replacement again");
    }

    #[test]
    fn handles_independent_insertions_and_deletions_in_a_line_selection() {
        let repository = TestRepository::new();
        let original = (1..=10)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        repository.write("forest.txt", &original);
        stage_all(&repository.path).expect("stage original file");
        commit(&repository.path, "Add forest").expect("commit original file");

        let changed = original
            .replace("line 2\n", "line 2\ninserted line\n")
            .replace("line 5\n", "");
        repository.write("forest.txt", &changed);

        apply_working_tree_lines(&repository.path, "forest.txt", false, 0, &[0], "stage")
            .expect("stage inserted line");
        let staged = working_tree_file_diff(&repository.path, "forest.txt", true)
            .expect("read staged insertion");
        assert!(staged.patch.contains("+inserted line"));
        assert!(!staged.patch.contains("-line 5"));

        apply_working_tree_lines(&repository.path, "forest.txt", false, 0, &[0], "discard")
            .expect("discard deleted line");
        let contents = fs::read_to_string(repository.path.join("forest.txt"))
            .expect("read partially restored file");
        assert!(contents.contains("inserted line"));
        assert!(contents.contains("line 5\n"));

        apply_working_tree_lines(&repository.path, "forest.txt", true, 0, &[0], "unstage")
            .expect("unstage inserted line");
        assert_eq!(
            snapshot(&repository.path)
                .expect("snapshot unstaged insertion")
                .status
                .staged,
            0
        );
    }

    #[test]
    fn unstages_an_unborn_repository() {
        let repository = TestRepository::new();
        repository.write("seed.txt", "seed\n");
        stage_all(&repository.path).expect("stage in unborn repository");
        unstage_all(&repository.path).expect("unstage in unborn repository");
        let status = snapshot(&repository.path)
            .expect("snapshot unborn repository")
            .status;
        assert_eq!(status.staged, 0);
        assert_eq!(status.untracked, 1);
    }

    #[test]
    fn inspects_a_renamed_file() {
        let repository = TestRepository::new();
        repository.write("old name.txt", "tree rings\n");
        stage_all(&repository.path).expect("stage original file");
        commit(&repository.path, "Add tree rings").expect("commit original file");
        fs::rename(
            repository.path.join("old name.txt"),
            repository.path.join("new name.txt"),
        )
        .expect("rename fixture file");
        stage_all(&repository.path).expect("stage rename");
        commit(&repository.path, "Rename tree rings").expect("commit rename");

        let latest = snapshot(&repository.path).expect("snapshot renamed repository");
        let oid = &latest.commits[0].oid;
        let details = commit_details(&repository.path, oid).expect("read renamed file details");
        assert_eq!(details.files.len(), 1);
        assert!(details.files[0].status.starts_with('R'));
        assert_eq!(
            details.files[0].previous_path.as_deref(),
            Some("old name.txt")
        );
        assert_eq!(details.files[0].path, "new name.txt");
        assert_eq!(details.files[0].additions, Some(0));
        assert_eq!(details.files[0].deletions, Some(0));

        let diff = commit_file_diff(&repository.path, oid, "new name.txt", Some("old name.txt"))
            .expect("read renamed file diff");
        assert!(diff.patch.contains("rename from old name.txt"));
        assert!(diff.patch.contains("rename to new name.txt"));
    }

    #[test]
    fn bounds_file_metadata_for_pathological_commits() {
        let repository = TestRepository::new();
        for index in 0..MAX_COMMIT_FILES + 5 {
            repository.write(&format!("generated-file-{index:04}.txt"), "content\n");
        }
        stage_all(&repository.path).expect("stage large commit fixture");
        commit(&repository.path, "Add many generated files").expect("commit large fixture");

        let oid = snapshot(&repository.path)
            .expect("snapshot large fixture")
            .head_oid
            .expect("large fixture oid");
        let details = commit_details(&repository.path, &oid).expect("read bounded details");

        assert_eq!(details.files.len(), MAX_COMMIT_FILES);
        assert!(details.files_truncated);
    }

    #[test]
    fn amends_the_head_commit() {
        let repository = TestRepository::new();
        repository.write("README.md", "first\n");
        stage_all(&repository.path).expect("stage initial file");
        commit(&repository.path, "Initial message").expect("create initial commit");
        let original_oid = snapshot(&repository.path)
            .expect("snapshot initial commit")
            .head_oid
            .expect("initial oid");

        repository.write("README.md", "amended\n");
        stage_all(&repository.path).expect("stage amendment");
        commit_with_options(&repository.path, "Amended message", true, false, None)
            .expect("amend commit");
        let amended = snapshot(&repository.path).expect("snapshot amended commit");
        assert_eq!(amended.commits.len(), 1);
        assert_eq!(amended.commits[0].subject, "Amended message");
        assert_ne!(amended.head_oid.as_deref(), Some(original_oid.as_str()));
    }

    #[test]
    fn requests_a_signature_when_commit_signing_is_enabled() {
        let repository = TestRepository::new();
        repository.write("signed.txt", "signed work\n");
        stage_all(&repository.path).expect("stage signed fixture");
        repository.git(&["config", "gpg.format", "openpgp"]);
        repository.git(&[
            "config",
            "gpg.program",
            "/definitely/missing/git-chronos-test-gpg",
        ]);

        let error = commit_with_options(
            &repository.path,
            "Require a signature",
            false,
            false,
            Some(true),
        )
        .expect_err("explicit signing must invoke the configured signer");

        assert_eq!(error.kind, "gitFailure");
        assert!(
            snapshot(&repository.path)
                .expect("read unsigned repository")
                .head_oid
                .is_none()
        );
    }

    #[test]
    fn explicitly_disables_repository_default_signing() {
        let repository = TestRepository::new();
        repository.write("unsigned.txt", "unsigned work\n");
        stage_all(&repository.path).expect("stage unsigned fixture");
        repository.git(&["config", "commit.gpgSign", "true"]);
        repository.git(&["config", "gpg.format", "openpgp"]);
        repository.git(&[
            "config",
            "gpg.program",
            "/definitely/missing/git-chronos-test-gpg",
        ]);

        commit_with_options(
            &repository.path,
            "Explicitly unsigned",
            false,
            false,
            Some(false),
        )
        .expect("explicit unsigned override should bypass the configured signer");

        assert!(
            snapshot(&repository.path)
                .expect("read explicitly unsigned repository")
                .head_oid
                .is_some()
        );
    }

    #[test]
    fn parses_verified_commit_signature_metadata() {
        let (signature, message) = parse_commit_signature(
            b"G\0Maya Chen <maya@example.test>\0A1B2C3D4\0FFEEDDCCBBAA\0ultimate\0Signed work\n",
        );

        assert_eq!(signature.status, "valid");
        assert_eq!(
            signature.signer.as_deref(),
            Some("Maya Chen <maya@example.test>")
        );
        assert_eq!(signature.key.as_deref(), Some("A1B2C3D4"));
        assert_eq!(signature.fingerprint.as_deref(), Some("FFEEDDCCBBAA"));
        assert_eq!(signature.trust.as_deref(), Some("ultimate"));
        assert_eq!(message, "Signed work");
    }

    #[test]
    fn preserves_co_author_trailers_in_commit_history() {
        let repository = TestRepository::new();
        repository.write("pairing.txt", "paired work\n");
        stage_all(&repository.path).expect("stage paired work");
        commit(
            &repository.path,
            "Pair on commit panel\n\nKeep attribution visible.\n\nCo-authored-by: Pair Partner <pair@example.test>",
        )
        .expect("commit paired work");

        let data = snapshot(&repository.path).expect("snapshot co-authored commit");
        assert!(
            data.commits[0]
                .description
                .contains("Keep attribution visible.")
        );
        assert!(
            data.commits[0]
                .description
                .contains("Co-authored-by: Pair Partner <pair@example.test>")
        );
        let details = commit_details(&repository.path, &data.commits[0].oid)
            .expect("inspect co-authored commit");
        assert!(details.message.contains("Co-authored-by: Pair Partner"));
    }

    #[test]
    fn reads_the_configured_commit_template() {
        let repository = TestRepository::new();
        fs::create_dir_all(repository.path.join(".git/templates"))
            .expect("create template directory");
        fs::write(
            repository.path.join(".git/templates/commit.txt"),
            "Summary placeholder\n\nDescribe why this change is needed.\n# hidden guidance\n",
        )
        .expect("write commit template");
        repository.git(&["config", "commit.template", ".git/templates/commit.txt"]);

        let data = snapshot(&repository.path).expect("snapshot commit template");
        assert_eq!(
            data.commit_template.as_deref(),
            Some("Summary placeholder\n\nDescribe why this change is needed.\n# hidden guidance\n")
        );
    }

    #[test]
    fn reads_identity_and_signing_configuration_together() {
        let repository = TestRepository::new();
        repository.git(&["config", "commit.gpgSign", "true"]);
        repository.git(&["config", "gpg.format", "ssh"]);
        repository.git(&["config", "user.signingKey", "~/.ssh/id_ed25519.pub"]);

        let data = snapshot(&repository.path).expect("snapshot signing configuration");

        assert_eq!(data.identity.name.as_deref(), Some("Chronos Tester"));
        assert_eq!(data.identity.email.as_deref(), Some("chronos@example.test"));
        assert!(data.signing.enabled);
        assert_eq!(data.signing.format, "ssh");
        assert_eq!(data.signing.key.as_deref(), Some("~/.ssh/id_ed25519.pub"));
    }

    #[test]
    fn updates_repository_local_identity() {
        let repository = TestRepository::new();

        set_repository_identity(&repository.path, "Morgan Lee", "morgan@example.test")
            .expect("update repository identity");

        let data = snapshot(&repository.path).expect("snapshot updated identity");
        assert_eq!(data.identity.name.as_deref(), Some("Morgan Lee"));
        assert_eq!(data.identity.email.as_deref(), Some("morgan@example.test"));
    }

    #[test]
    fn rejects_invalid_repository_identity_without_changing_configuration() {
        let repository = TestRepository::new();

        let error = set_repository_identity(
            &repository.path,
            "Chronos Tester\nAnother Author",
            "other@example.test",
        )
        .expect_err("reject multiline identity");

        assert_eq!(error.kind, "invalidIdentityName");
        let data = snapshot(&repository.path).expect("snapshot preserved identity");
        assert_eq!(data.identity.name.as_deref(), Some("Chronos Tester"));
        assert_eq!(data.identity.email.as_deref(), Some("chronos@example.test"));
    }

    #[test]
    fn reports_a_missing_configured_signer_without_invoking_it() {
        let repository = TestRepository::new();
        repository.git(&["config", "gpg.format", "openpgp"]);
        repository.git(&[
            "config",
            "gpg.program",
            "/definitely/missing/git-chronos-signing-diagnostic",
        ]);
        repository.git(&["config", "user.signingKey", "A1B2C3D4"]);

        let diagnostic = signing_diagnostic(&repository.path).expect("diagnose missing signer");

        assert!(!diagnostic.available);
        assert_eq!(
            diagnostic.program,
            "/definitely/missing/git-chronos-signing-diagnostic"
        );
        assert!(diagnostic.key_configured);
        assert!(diagnostic.message.contains("was not found"));
    }

    #[cfg(unix)]
    #[test]
    fn reports_an_available_configured_signer() {
        let repository = TestRepository::new();
        repository.git(&["config", "gpg.format", "openpgp"]);
        repository.git(&["config", "gpg.program", "/bin/sh"]);

        let diagnostic = signing_diagnostic(&repository.path).expect("diagnose available signer");

        assert!(diagnostic.available);
        assert_eq!(diagnostic.program, "/bin/sh");
        assert!(!diagnostic.key_configured);
        assert!(diagnostic.message.contains("default signing key"));
    }

    #[test]
    fn starts_advances_and_resets_a_bisect_session() {
        let repository = TestRepository::new();
        for index in 0..4 {
            repository.write("bisect.txt", &format!("revision {index}\n"));
            stage_all(&repository.path).expect("stage bisect revision");
            commit(&repository.path, &format!("Bisect revision {index}"))
                .expect("commit bisect revision");
        }
        let bad_oid = snapshot(&repository.path)
            .expect("snapshot bad revision")
            .head_oid
            .expect("bad revision oid");
        let good_output = run_git(&repository.path, &["rev-parse", "HEAD~3"])
            .expect("resolve known-good revision");
        let good_oid = String::from_utf8_lossy(&good_output.stdout)
            .trim()
            .to_owned();

        start_bisect(&repository.path, &bad_oid, &good_oid).expect("start bisect session");
        assert!(
            snapshot(&repository.path)
                .expect("snapshot active bisect")
                .status
                .bisect_in_progress
        );

        mark_bisect(&repository.path, "good").expect("mark current revision good");
        reset_bisect(&repository.path).expect("reset bisect session");
        let reset = snapshot(&repository.path).expect("snapshot reset bisect");
        assert!(!reset.status.bisect_in_progress);
        assert_eq!(reset.head_oid.as_deref(), Some(bad_oid.as_str()));
    }

    #[test]
    fn reads_the_effective_repository_identity() {
        let repository = TestRepository::new();
        let data = snapshot(&repository.path).expect("snapshot repository identity");

        assert_eq!(data.identity.name.as_deref(), Some("Chronos Tester"));
        assert_eq!(data.identity.email.as_deref(), Some("chronos@example.test"));
    }

    #[test]
    fn updates_only_the_head_message_and_preserves_the_index() {
        let repository = TestRepository::new();
        repository.write("committed.txt", "committed\n");
        stage_all(&repository.path).expect("stage initial file");
        commit(&repository.path, "Original message").expect("commit initial file");
        let original = snapshot(&repository.path)
            .expect("snapshot original commit")
            .head_oid
            .expect("original oid");

        repository.write("staged.txt", "keep staged\n");
        stage_all(&repository.path).expect("stage unrelated file");
        update_head_message(
            &repository.path,
            &original,
            "Updated message\n\nOnly rewrite the message.",
            false,
        )
        .expect("update head message");

        let updated = snapshot(&repository.path).expect("snapshot updated message");
        assert_ne!(updated.head_oid.as_deref(), Some(original.as_str()));
        assert_eq!(updated.commits[0].subject, "Updated message");
        assert_eq!(updated.status.staged, 1);
        let details = commit_details(&repository.path, &updated.commits[0].oid)
            .expect("inspect updated commit");
        assert!(details.files.iter().all(|file| file.path != "staged.txt"));
        assert_eq!(
            update_head_message(&repository.path, &original, "Stale", false)
                .expect_err("reject stale head")
                .kind,
            "staleCommit"
        );
    }

    #[test]
    fn checks_out_a_commit_and_creates_a_branch_there() {
        let repository = TestRepository::new();
        repository.write("history.txt", "one\n");
        stage_all(&repository.path).expect("stage first version");
        commit(&repository.path, "First").expect("commit first version");
        let first_oid = snapshot(&repository.path)
            .expect("snapshot first version")
            .head_oid
            .expect("first oid");
        repository.write("history.txt", "two\n");
        stage_all(&repository.path).expect("stage second version");
        commit(&repository.path, "Second").expect("commit second version");

        checkout_commit(&repository.path, &first_oid).expect("detach at first commit");
        let detached = snapshot(&repository.path).expect("snapshot detached head");
        assert_eq!(detached.status.branch, None);
        assert_eq!(detached.head_oid.as_deref(), Some(first_oid.as_str()));

        create_branch_at(&repository.path, "from-first", &first_oid)
            .expect("create branch at first commit");
        let branched = snapshot(&repository.path).expect("snapshot created branch");
        assert_eq!(branched.status.branch.as_deref(), Some("from-first"));
        assert_eq!(branched.head_oid.as_deref(), Some(first_oid.as_str()));
    }

    #[test]
    fn stashes_applies_and_pops_working_tree_changes() {
        let repository = TestRepository::new();
        repository.write("tracked.txt", "base\n");
        stage_all(&repository.path).expect("stage base file");
        commit(&repository.path, "Base").expect("commit base file");
        repository.write("tracked.txt", "changed\n");
        repository.write("untracked.txt", "new\n");

        stash_with_message(&repository.path, Some("Park the graph polish"))
            .expect("stash working tree with a name");
        let stashed = snapshot(&repository.path).expect("snapshot stash");
        assert!(stashed.status.entries.is_empty());
        assert_eq!(stashed.stashes.len(), 1);
        assert_eq!(stashed.stashes[0].reference, "stash@{0}");
        assert!(
            stashed.stashes[0]
                .message
                .ends_with("Park the graph polish")
        );
        rename_stash(
            &repository.path,
            "stash@{0}",
            &stashed.stashes[0].oid,
            "Rename the graph polish",
        )
        .expect("rename stash");
        let renamed = snapshot(&repository.path).expect("snapshot renamed stash");
        assert_eq!(renamed.stashes.len(), 1);
        assert!(
            renamed.stashes[0]
                .message
                .ends_with("Rename the graph polish")
        );
        assert_eq!(stashed.commits.len(), 2);
        let stash_commit = stashed
            .commits
            .iter()
            .find(|commit| commit.oid == stashed.stashes[0].oid)
            .expect("stash appears as one graph commit");
        assert_eq!(stash_commit.parents.len(), 1);
        let details = stash_details(&repository.path, "stash@{0}").expect("inspect stash");
        assert_eq!(details.files.len(), 2);
        assert!(details.files.iter().any(|file| file.path == "tracked.txt"));
        assert!(
            details
                .files
                .iter()
                .any(|file| file.path == "untracked.txt")
        );
        let tracked_diff = stash_file_diff(&repository.path, "stash@{0}", "tracked.txt", None)
            .expect("inspect stashed tracked file");
        assert!(tracked_diff.patch.contains("+changed"));
        let untracked_diff = stash_file_diff(&repository.path, "stash@{0}", "untracked.txt", None)
            .expect("inspect stashed untracked file");
        assert!(untracked_diff.patch.contains("+new"));

        apply_stash(&repository.path, "stash@{0}").expect("apply stash");
        let applied = snapshot(&repository.path).expect("snapshot applied stash");
        assert_eq!(applied.stashes.len(), 1);
        assert_eq!(applied.status.entries.len(), 2);

        repository.git(&["reset", "--hard", "HEAD"]);
        repository.git(&["clean", "-fd"]);
        pop_stash_entry(&repository.path, "stash@{0}").expect("pop selected stash");
        let popped = snapshot(&repository.path).expect("snapshot popped stash");
        assert!(popped.stashes.is_empty());
        assert_eq!(popped.status.entries.len(), 2);

        repository.git(&["reset", "--hard", "HEAD"]);
        repository.git(&["clean", "-fd"]);
        repository.write("tracked.txt", "drop me\n");
        stash(&repository.path).expect("create disposable stash");
        drop_stash(&repository.path, "stash@{0}").expect("drop selected stash");
        assert!(
            snapshot(&repository.path)
                .expect("snapshot dropped stash")
                .stashes
                .is_empty()
        );
    }

    #[test]
    fn renames_an_older_stash_without_reordering_the_stack() {
        let repository = TestRepository::new();
        repository.write("tracked.txt", "base\n");
        stage_all(&repository.path).expect("stage base file");
        commit(&repository.path, "Base").expect("commit base file");

        repository.write("tracked.txt", "first change\n");
        stash_with_message(&repository.path, Some("First parked change"))
            .expect("create first stash");
        repository.write("tracked.txt", "second change\n");
        stash_with_message(&repository.path, Some("Second parked change"))
            .expect("create second stash");
        let before = snapshot(&repository.path).expect("snapshot stash stack");

        let stale = rename_stash(
            &repository.path,
            "stash@{0}",
            &before.stashes[1].oid,
            "Must not rename the wrong stash",
        )
        .expect_err("reject a stale stash selection");
        assert_eq!(stale.kind, "staleStash");

        rename_stash(
            &repository.path,
            "stash@{1}",
            &before.stashes[1].oid,
            "Renamed first change",
        )
        .expect("rename older stash");
        let after = snapshot(&repository.path).expect("snapshot renamed stash stack");

        assert_eq!(after.stashes.len(), 2);
        assert_eq!(
            after
                .stashes
                .iter()
                .map(|stash| (&stash.reference, &stash.oid))
                .collect::<Vec<_>>(),
            before
                .stashes
                .iter()
                .map(|stash| (&stash.reference, &stash.oid))
                .collect::<Vec<_>>()
        );
        assert!(after.stashes[0].message.ends_with("Second parked change"));
        assert!(after.stashes[1].message.ends_with("Renamed first change"));
    }

    #[test]
    fn rejects_unsafe_stash_references() {
        let error = validate_stash_reference("--help").expect_err("reject option-like stash");
        assert_eq!(error.kind, "invalidStash");
        assert!(validate_stash_reference("stash@{12}").is_ok());
    }

    #[test]
    fn rejects_multiline_or_oversized_stash_messages() {
        let repository = TestRepository::new();
        assert_eq!(
            stash_with_message(&repository.path, Some("first\nsecond"))
                .expect_err("reject multiline message")
                .kind,
            "invalidStashMessage"
        );
        let oversized = "x".repeat(501);
        assert_eq!(
            stash_with_message(&repository.path, Some(&oversized))
                .expect_err("reject oversized message")
                .kind,
            "invalidStashMessage"
        );
    }

    #[test]
    fn creates_and_reads_a_tag_at_a_commit() {
        let repository = TestRepository::new();
        repository.write("release.txt", "v1\n");
        stage_all(&repository.path).expect("stage release file");
        commit(&repository.path, "Release").expect("commit release");
        let oid = snapshot(&repository.path)
            .expect("snapshot release")
            .head_oid
            .expect("release oid");

        create_tag(&repository.path, "v1.0.0", &oid, None).expect("create tag");
        let tagged = snapshot(&repository.path).expect("snapshot tag");
        assert_eq!(tagged.tags.len(), 1);
        assert_eq!(tagged.tags[0].name, "v1.0.0");
        assert_eq!(tagged.tags[0].oid, oid);
        let details = tag_details(&repository.path, "v1.0.0").expect("read lightweight tag");
        assert!(!details.annotated);
        assert_eq!(details.oid, oid);
        assert!(details.message.is_none());
    }

    #[test]
    fn creates_an_annotated_tag_with_a_message() {
        let repository = TestRepository::new();
        repository.write("release.txt", "v2\n");
        stage_all(&repository.path).expect("stage release file");
        commit(&repository.path, "Release v2").expect("commit release");
        let oid = snapshot(&repository.path)
            .expect("snapshot release")
            .head_oid
            .expect("release oid");

        create_tag(
            &repository.path,
            "v2.0.0",
            &oid,
            Some("Git Chronos 2.0 release"),
        )
        .expect("create annotated tag");

        let object_type = run_git(&repository.path, &["cat-file", "-t", "v2.0.0"])
            .expect("read annotated tag object type");
        assert_eq!(String::from_utf8_lossy(&object_type.stdout).trim(), "tag");
        let message = run_git(
            &repository.path,
            &["for-each-ref", "--format=%(contents)", "refs/tags/v2.0.0"],
        )
        .expect("read annotated tag message");
        assert_eq!(
            String::from_utf8_lossy(&message.stdout).trim(),
            "Git Chronos 2.0 release"
        );
        let details = tag_details(&repository.path, "v2.0.0").expect("read annotated tag");
        assert!(details.annotated);
        assert_eq!(details.oid, oid);
        assert_eq!(details.message.as_deref(), Some("Git Chronos 2.0 release"));
        assert!(details.tagger_name.is_some());
        assert!(details.tagger_email.is_some());
        assert!(details.tagged_at.is_some());
    }

    #[test]
    fn snapshots_linked_worktrees_for_agent_sessions_view() {
        let repository = TestRepository::new();
        repository.write("README.md", "# Worktrees\n");
        stage_all(&repository.path).expect("stage base file");
        commit(&repository.path, "Base worktree").expect("commit base");

        let linked_path = repository.path.join("agent-task");
        let linked_text = linked_path.to_string_lossy().into_owned();
        create_worktree(
            &repository.path,
            &repository.path,
            "agent-task",
            "agent/task",
            "main",
        )
        .expect("create agent session worktree");
        fs::write(
            linked_path.join("agent-notes.txt"),
            "uncommitted agent work\n",
        )
        .expect("write linked worktree change");
        set_worktree_locked(&repository.path, &linked_text, true).expect("lock linked worktree");

        let data = snapshot(&repository.path).expect("snapshot worktrees");
        assert_eq!(data.worktrees.len(), 2);
        let current = data
            .worktrees
            .iter()
            .find(|worktree| worktree.current)
            .expect("current worktree");
        assert_eq!(current.branch.as_deref(), Some("main"));
        let linked = data
            .worktrees
            .iter()
            .find(|worktree| worktree.branch.as_deref() == Some("agent/task"))
            .expect("linked agent worktree");
        assert_eq!(linked.path, linked_text);
        assert!(linked.status_loaded);
        assert_eq!(linked.changes, 1);
        assert!(linked.locked);
        assert!(!linked.current);
        assert!(!linked.prunable);

        let fast = snapshot_with_limits_fast(&repository.path, 200, 1_000)
            .expect("snapshot without walking linked worktrees");
        let deferred = fast
            .worktrees
            .iter()
            .find(|worktree| worktree.branch.as_deref() == Some("agent/task"))
            .expect("deferred linked agent worktree");
        assert!(!deferred.status_loaded);
        assert_eq!(deferred.changes, 0);
        assert!(
            fast.worktrees
                .iter()
                .any(|worktree| worktree.current && worktree.status_loaded)
        );

        set_worktree_locked(&repository.path, &linked_text, false).expect("unlock linked worktree");
        let dirty_error = remove_worktree(&repository.path, &linked_text, false, false)
            .expect_err("protect dirty linked worktree");
        assert_eq!(dirty_error.kind, "gitFailure");
        remove_worktree(&repository.path, &linked_text, true, true)
            .expect("force remove linked worktree and branch");
        let removed = snapshot(&repository.path).expect("snapshot removed worktree");
        assert_eq!(removed.worktrees.len(), 1);
        assert!(
            removed
                .branches
                .iter()
                .all(|branch| branch.name != "agent/task")
        );

        repository.git(&["branch", "review", "main"]);
        create_worktree_for_branch(&repository.path, &repository.path, "review-task", "review")
            .expect("create worktree for existing branch");
        let existing_branch = snapshot(&repository.path).expect("snapshot branch worktree");
        let review = existing_branch
            .worktrees
            .iter()
            .find(|worktree| worktree.branch.as_deref() == Some("review"))
            .expect("review branch worktree");
        assert!(review.path.ends_with("review-task"));
        remove_worktree(&repository.path, &review.path, true, false)
            .expect("remove clean review worktree and branch");
    }

    #[test]
    fn adds_initializes_and_updates_submodules() {
        let dependency = TestRepository::new();
        dependency.write("engine.txt", "version one\n");
        stage_all(&dependency.path).expect("stage dependency");
        commit(&dependency.path, "Dependency v1").expect("commit dependency");

        let repository = TestRepository::new();
        repository.write("README.md", "# Parent\n");
        stage_all(&repository.path).expect("stage parent");
        commit(&repository.path, "Parent repository").expect("commit parent");
        let dependency_url = dependency.path.to_string_lossy().into_owned();
        add_submodule(&repository.path, &dependency_url, "vendor/engine")
            .expect("add local submodule");

        let added = snapshot(&repository.path).expect("snapshot added submodule");
        assert_eq!(added.submodules.len(), 1);
        assert_eq!(added.submodules[0].name, "vendor/engine");
        assert_eq!(added.submodules[0].path, "vendor/engine");
        assert!(added.submodules[0].initialized);
        assert!(!added.submodules[0].out_of_sync);
        assert_eq!(added.submodules[0].oid, added.submodules[0].head_oid);

        repository.git(&["submodule", "deinit", "-f", "--", "vendor/engine"]);
        let deinitialized = snapshot(&repository.path).expect("snapshot deinitialized submodule");
        assert!(!deinitialized.submodules[0].initialized);
        initialize_submodule(&repository.path, "vendor/engine").expect("initialize submodule");
        assert!(
            snapshot(&repository.path)
                .expect("snapshot initialized submodule")
                .submodules[0]
                .initialized
        );

        dependency.write("engine.txt", "version two\n");
        stage_all(&dependency.path).expect("stage dependency update");
        commit(&dependency.path, "Dependency v2").expect("commit dependency update");
        update_submodule(&repository.path, "vendor/engine").expect("update submodule");
        let updated = snapshot(&repository.path).expect("snapshot updated submodule");
        assert!(updated.submodules[0].out_of_sync);
        assert_ne!(updated.submodules[0].oid, updated.submodules[0].head_oid);
    }

    #[test]
    fn cherry_picks_reverts_and_resets_commits() {
        let repository = TestRepository::new();
        repository.write("history.txt", "one\n");
        stage_all(&repository.path).expect("stage first state");
        commit(&repository.path, "First state").expect("commit first state");
        let first_oid = snapshot(&repository.path)
            .expect("snapshot first state")
            .head_oid
            .expect("first oid");
        repository.write("history.txt", "two\n");
        stage_all(&repository.path).expect("stage second state");
        commit(&repository.path, "Second state").expect("commit second state");
        let second_oid = snapshot(&repository.path)
            .expect("snapshot second state")
            .head_oid
            .expect("second oid");

        create_branch_at(&repository.path, "replay", &first_oid).expect("return to first state");
        cherry_pick(&repository.path, &second_oid).expect("cherry-pick second state");
        assert_eq!(
            fs::read_to_string(repository.path.join("history.txt")).expect("read picked file"),
            "two\n"
        );
        revert_commit(
            &repository.path,
            &snapshot(&repository.path)
                .expect("snapshot pick")
                .head_oid
                .expect("picked oid"),
        )
        .expect("revert picked commit");
        assert_eq!(
            fs::read_to_string(repository.path.join("history.txt")).expect("read reverted file"),
            "one\n"
        );

        reset_to_commit(&repository.path, &first_oid, "hard").expect("hard reset to first state");
        assert_eq!(
            snapshot(&repository.path)
                .expect("snapshot reset")
                .head_oid
                .as_deref(),
            Some(first_oid.as_str())
        );
        assert_eq!(
            reset_to_commit(&repository.path, &first_oid, "invalid")
                .expect_err("reject reset mode")
                .kind,
            "invalidResetMode"
        );
    }

    #[test]
    fn recovers_an_interrupted_cherry_pick_with_abort_and_continue() {
        let repository = TestRepository::new();
        repository.write("shared.txt", "root\n");
        stage_all(&repository.path).expect("stage root");
        commit(&repository.path, "Root").expect("commit root");
        create_branch(&repository.path, "feature").expect("create feature");
        repository.write("shared.txt", "feature\n");
        stage_all(&repository.path).expect("stage feature");
        commit(&repository.path, "Feature").expect("commit feature");
        let source_oid = snapshot(&repository.path)
            .expect("read source commit")
            .head_oid
            .expect("source oid");
        checkout_branch(&repository.path, "main").expect("checkout main");
        repository.write("shared.txt", "main\n");
        stage_all(&repository.path).expect("stage main");
        commit(&repository.path, "Main").expect("commit main");
        let original_head = snapshot(&repository.path)
            .expect("read original head")
            .head_oid;

        cherry_pick(&repository.path, &source_oid).expect_err("create cherry-pick conflict");
        assert_eq!(
            snapshot(&repository.path)
                .expect("read interrupted cherry-pick")
                .status
                .history_operation
                .as_deref(),
            Some("cherry-pick")
        );
        control_history_operation(&repository.path, "cherry-pick", "abort")
            .expect("abort cherry-pick");
        assert_eq!(
            snapshot(&repository.path)
                .expect("read aborted cherry-pick")
                .head_oid,
            original_head
        );

        cherry_pick(&repository.path, &source_oid).expect_err("repeat cherry-pick conflict");
        resolve_conflict(&repository.path, "shared.txt", "output", Some("resolved\n"))
            .expect("resolve cherry-pick conflict");
        control_history_operation(&repository.path, "cherry-pick", "continue")
            .expect("continue cherry-pick");
        let completed = snapshot(&repository.path).expect("read completed cherry-pick");
        assert_eq!(completed.status.history_operation, None);
        assert_eq!(completed.status.conflicted, 0);
        assert_eq!(
            fs::read_to_string(repository.path.join("shared.txt")).expect("read resolution"),
            "resolved\n"
        );
    }

    #[test]
    fn detects_and_aborts_an_interrupted_revert() {
        let repository = TestRepository::new();
        repository.write("shared.txt", "root\n");
        stage_all(&repository.path).expect("stage root");
        commit(&repository.path, "Root").expect("commit root");
        repository.write("shared.txt", "change\n");
        stage_all(&repository.path).expect("stage change");
        commit(&repository.path, "Change").expect("commit change");
        let reverted_oid = snapshot(&repository.path)
            .expect("read changed commit")
            .head_oid
            .expect("changed oid");
        repository.write("shared.txt", "later\n");
        stage_all(&repository.path).expect("stage later change");
        commit(&repository.path, "Later").expect("commit later change");
        let original_head = snapshot(&repository.path)
            .expect("read pre-revert head")
            .head_oid;

        revert_commit(&repository.path, &reverted_oid).expect_err("create revert conflict");
        assert_eq!(
            snapshot(&repository.path)
                .expect("read interrupted revert")
                .status
                .history_operation
                .as_deref(),
            Some("revert")
        );
        control_history_operation(&repository.path, "revert", "abort").expect("abort revert");
        let restored = snapshot(&repository.path).expect("read aborted revert");
        assert_eq!(restored.status.history_operation, None);
        assert_eq!(restored.head_oid, original_head);
        assert_eq!(
            fs::read_to_string(repository.path.join("shared.txt")).expect("read restored file"),
            "later\n"
        );
    }

    #[test]
    fn cherry_picks_multiple_commits_in_the_requested_order() {
        let repository = TestRepository::new();
        repository.write("base.txt", "base\n");
        stage_all(&repository.path).expect("stage base");
        commit(&repository.path, "Base").expect("commit base");
        let base_oid = snapshot(&repository.path)
            .expect("snapshot base")
            .head_oid
            .expect("base oid");

        repository.write("first.txt", "first\n");
        stage_all(&repository.path).expect("stage first source change");
        commit(&repository.path, "First selected commit").expect("commit first source change");
        let first_oid = snapshot(&repository.path)
            .expect("snapshot first source commit")
            .head_oid
            .expect("first source oid");

        repository.write("second.txt", "second\n");
        stage_all(&repository.path).expect("stage second source change");
        commit(&repository.path, "Second selected commit").expect("commit second source change");
        let second_oid = snapshot(&repository.path)
            .expect("snapshot second source commit")
            .head_oid
            .expect("second source oid");

        create_branch_at(&repository.path, "replay-many", &base_oid)
            .expect("create replay branch at base");
        cherry_pick_commits(&repository.path, &[first_oid, second_oid])
            .expect("cherry-pick selected commits");

        let log = run_git(
            &repository.path,
            &[
                "log",
                "--format=%s",
                "--reverse",
                &format!("{base_oid}..replay-many"),
            ],
        )
        .expect("read replayed history");
        assert!(log.status.success());
        assert_eq!(
            String::from_utf8_lossy(&log.stdout)
                .lines()
                .collect::<Vec<_>>(),
            vec!["First selected commit", "Second selected commit"]
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("first.txt")).expect("read first file"),
            "first\n"
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("second.txt")).expect("read second file"),
            "second\n"
        );
    }
}
