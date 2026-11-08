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

mod configured_tools;
mod discard;
mod file_content;
mod file_statistics;
mod file_tool_model;
mod ignore_rules;
#[cfg(unix)]
mod process_pipe;
mod working_file_text;
pub use file_tool_model::{
    FileToolCleanupReview, FileToolLaunchReview, FileToolMergeStageResult,
    FileToolMergeWriteResult, FileToolProcessState, FileToolProcessStatus, FileToolRequest,
    FileToolSideReview, FileToolSource,
};
#[cfg(target_os = "linux")]
mod file_tool_process;
#[cfg(target_os = "linux")]
mod file_tool_snapshots;
#[cfg(target_os = "linux")]
mod file_tools;
#[cfg(target_os = "linux")]
pub use file_tool_process::FileToolProcess;
pub mod draft_recovery;
pub mod draft_recovery_editor;
#[cfg(target_os = "linux")]
pub mod draft_recovery_store;
pub use configured_tools::{ToolArgumentContext, ToolProfile, ToolRole};
#[cfg(target_os = "linux")]
pub use file_tool_snapshots::{FileToolResult, FileToolSnapshotRole, FileToolSnapshots};
#[cfg(target_os = "linux")]
pub use file_tools::{PreparedFileTool, PreparedFileToolCleanup, prepare_file_tool};
mod working_file_edit;
pub use working_file_edit::{
    WorkingFileEdit, WorkingFileSave, WorkingFileWriteStatus, open_working_file_edit,
};
pub use working_file_text::{
    DecodedWorkingText, MAX_WORKING_TEXT_BYTES, WorkingTextEncoding, decode_working_text,
};
mod file_comparison;
mod file_media;
mod no_lazy_fetch;
mod repository_files;
mod repository_link_inspection;
mod repository_links;
pub use file_comparison::{
    FileComparisonContent, FileComparisonContext, FileComparisonRequest, FileComparisonSide,
    FileComparisonUnavailable, FileComparisonValue, StashContentLayer, read_file_comparison,
};
pub use file_content::{
    FileContent, FileContentKind, FileContentLocation, MAX_FILE_CONTENT_BYTES, read_file_content,
};
pub use file_media::{
    FileLfsPointer, FileMediaComparison, FileMediaSide, FileMediaState, MAX_PREVIEW_DIMENSION,
    MAX_PREVIEW_PIXELS, RasterMetadata, read_file_media,
};
pub use no_lazy_fetch::{without_lazy_fetch, without_lazy_fetch_cancellable};
pub use repository_files::{
    RepositoryFile, RepositoryFiles, create_repository_file, delete_repository_file,
    repository_files, with_repository_regular_file,
};
pub use repository_link_inspection::{
    RepositoryLinkInspection, RepositoryLinkTargetState, inspect_repository_link,
};
pub use repository_links::{
    RepositoryLink, RepositoryLinkTarget, create_repository_link, parse_repository_link,
    repository_link_remote_identity,
};
mod no_commit_replay;
mod operation_recovery;
mod operation_storage;
mod rebase_split;
pub use rebase_split::{RebaseSplitStatus, begin_rebase_split};
mod branch_workflow;
mod git_cancellation;
mod hosting;
pub use branch_workflow::{
    BranchWorkflowBinding, BranchWorkflowFinishOptions, BranchWorkflowFinishPhase,
    BranchWorkflowFinishPlan, BranchWorkflowFinishStatus, BranchWorkflowFinishTag,
    BranchWorkflowFinishTarget, BranchWorkflowHead, BranchWorkflowKind, BranchWorkflowMergePolicy,
    BranchWorkflowSettings, BranchWorkflowSetup, BranchWorkflowStart, BranchWorkflowState,
    BranchWorkflowTagRequest, BranchWorkflowTopic, abort_branch_workflow_finish,
    acknowledge_branch_workflow_finish, apply_branch_workflow_setup,
    apply_branch_workflow_setup_cancellable, branch_workflow_state,
    branch_workflow_state_cancellable, finish_branch_workflow, load_branch_workflow_finish,
    load_branch_workflow_finish_cancellable, prepare_branch_workflow_finish,
    prepare_branch_workflow_finish_cancellable, prepare_branch_workflow_setup,
    prepare_branch_workflow_setup_cancellable, prepare_branch_workflow_start,
    prepare_branch_workflow_start_cancellable, resume_branch_workflow_finish,
    start_branch_workflow,
};
mod hosted_clone;
pub use hosted_clone::{
    HostedClonePlan, HostedCloneRequest, HostedCloneTransport, execute_hosted_clone,
    prepare_hosted_clone,
};
mod gitlab_clone;
mod hosted_repositories;
pub use gitlab_clone::{
    GitLabClonePlan, GitLabCloneRequest, GitLabProjectInspection, clone_gitlab_plan,
    execute_gitlab_clone_with, inspect_gitlab_project_with, prepare_gitlab_clone_with,
    revalidate_gitlab_clone_with,
};
mod gitlab_forks;
pub use gitlab_forks::{
    GitLabForkImportState, GitLabForkInspection, GitLabForkPage, GitLabForkQuery,
    GitLabForkSelection, GitLabNamespace, GitLabNamespaceInspection, GitLabNamespaceKind,
    GitLabNamespacePage, GitLabNamespaceQuery, GitLabNamespaceSelection, inspect_gitlab_fork_with,
    inspect_gitlab_namespace_with, load_gitlab_fork_page_with, load_gitlab_namespace_page_with,
};
mod gitlab_fork_reconcile;
mod gitlab_https;
mod gitlab_project_locator;
pub use gitlab_fork_reconcile::reconcile_gitlab_fork_with;
pub use gitlab_https::{GitLabForkHttpsTransport, GitLabHttpsTransport};
mod gitlab_fork_dispatch;
pub use gitlab_fork_dispatch::{GitLabForkDispatch, GitLabForkPostReply, GitLabForkWriteTransport};
mod gitlab_fork_record;
pub use gitlab_fork_record::{
    GitLabForkFailure, GitLabForkIntent, GitLabForkPhase, GitLabForkRecord,
};
mod gitlab_fork_plan;
pub use gitlab_fork_plan::{
    GitLabForkPlan, GitLabForkPrepareRequest, GitLabForkPreview, prepare_gitlab_fork_with,
    revalidate_gitlab_fork_with,
};
#[cfg(target_os = "linux")]
mod gitlab_fork_journal;
#[cfg(target_os = "linux")]
pub use gitlab_fork_journal::{
    GitLabForkJournal, GitLabForkJournalEntry, GitLabForkJournalInspection, GitLabForkJournalIssue,
    GitLabForkJournalIssueKind, GitLabForkJournalLease,
};
mod gitlab_projects;
pub use gitlab_projects::{
    GitLabAccount, GitLabInstance, GitLabProject, GitLabProjectPage, GitLabProjectQuery,
    GitLabProjectScope, GitLabReadTransport, load_gitlab_account_with,
    load_gitlab_project_page_with,
};
mod hosted_fork_remote;
mod hosted_fork_request;
mod hosted_forks;
pub use hosted_fork_remote::{
    HostedForkRemotePlan, HostedForkRemoteReceipt, HostedForkRemoteRequest,
    execute_hosted_fork_remote, prepare_hosted_fork_remote,
};
pub use hosted_fork_request::{
    HostedForkIntent, HostedForkOwner, HostedForkOwnerKind, HostedForkPhase, HostedForkPlan,
    HostedForkRepository, HostedForkRequest, HostedForkStatus, acknowledge_hosted_fork_request,
    archive_hosted_fork_request, execute_hosted_fork, list_hosted_fork_requests,
    load_hosted_fork_request, prepare_hosted_fork, reconcile_hosted_fork,
};
pub use hosted_forks::{
    HostedForkInspection, HostedForkPage, HostedForkQuery, HostedForkSelection,
    inspect_hosted_fork, load_hosted_fork_page,
};
pub use hosted_repositories::{
    HostedAccount, HostedRepository, HostedRepositoryAffiliation, HostedRepositoryDirection,
    HostedRepositoryIdentity, HostedRepositoryInspection, HostedRepositoryPage,
    HostedRepositoryQuery, HostedRepositorySort, HostedRepositoryVisibility,
    inspect_hosted_repository, load_hosted_repository_page,
};
mod hosting_writes;
pub use hosting::{
    HostedEntry, HostedReview, HostedReviewDecision, HostedReviewFile, HostedReviewQuery,
    HostedReviewSections, HostedReviewStatus, HostingPage, HostingQuery, HostingSection,
    HostingState, load_hosted_review, load_hosting_page,
};
pub use hosting_writes::{
    HostedMergeMethod, HostedReviewEvent, HostedWritePlan, HostedWriteReceipt, HostedWriteRequest,
    execute_hosted_write, prepare_hosted_write,
};
mod merge_preview;
pub use merge_preview::{MergePreview, MergePreviewRequest, preview_merge};
mod merge_rebase;
pub use merge_rebase::{
    MergeRebasePlan, MergeRebaseRequest, execute_merge_rebase, prepare_merge_rebase,
};
mod patch_exchange;
pub use patch_exchange::{
    PatchRequest, PatchReview, PatchTarget, export_patch, import_patch, review_patch,
};
mod bundle_exchange;
pub use bundle_exchange::{
    BundleRequest, BundleReview, BundleTip, export_bundle, import_bundle, review_bundle,
};
mod exchange_files;
mod mail_patch;
pub use mail_patch::{
    MailPatchAction, MailPatchCommit, MailPatchEntry, MailPatchImportRequest,
    MailPatchImportReview, MailPatchProgress, MailPatchRequest, MailPatchReview,
    control_mail_patch, export_mail_patch, import_mail_patch, review_mail_patch_export,
    review_mail_patch_import,
};
mod fetch_options;
mod worktree_actions;
mod worktree_diagnostics;
pub use worktree_diagnostics::{
    WorktreeRegistration, WorktreeRegistrationReview, review_worktree_registrations,
};
mod worktree_prune;
pub use worktree_prune::{
    WorktreeRegistrationPrune, WorktreeRegistrationPruneResult, prune_worktree_registration,
};
mod submodule_review;
pub use submodule_review::{
    SubmoduleConflict, SubmoduleState, SubmoduleStateReview, review_submodule_state,
};
mod submodule_sync;
pub use submodule_sync::{SubmoduleUrlSync, SubmoduleUrlSyncResult, sync_submodule_url};
mod submodule_branch;
pub use submodule_branch::{
    SubmoduleTrackingBranchChange, SubmoduleTrackingBranchResult, set_submodule_tracking_branch,
};
mod submodule_checkout;
pub use submodule_checkout::{
    SubmoduleNestedCheckout, SubmoduleRecordedCheckout, SubmoduleRecordedCheckoutResult,
    checkout_recorded_submodule_commit,
};
mod submodule_deinit;
pub use submodule_deinit::{
    SubmoduleDeinit, SubmoduleDeinitResult, SubmoduleSetting, deinit_submodule,
};
mod submodule_remove;
pub use submodule_remove::{SubmoduleRemoval, SubmoduleRemovalResult, remove_submodule};
mod lfs_checkout;
mod lfs_fetch;
mod lfs_locks;
mod lfs_objects;
mod lfs_prune;
mod lfs_tracking;
pub use fetch_options::{
    FetchHistory, FetchOptions, ShallowHistoryState, fetch_with_options, shallow_history_state,
};
pub use lfs_checkout::{LfsCheckoutPreview, checkout_lfs_object, preview_lfs_checkout};
pub use lfs_fetch::{LfsFetchPreview, fetch_lfs_object, preview_lfs_fetch};
pub use lfs_locks::{LfsLock, LfsLocks, lfs_locks, lock_lfs_file, unlock_lfs_file};
pub use lfs_objects::{LfsObjectFile, LfsObjects, lfs_objects};
pub use lfs_prune::{LfsPruneObject, LfsPrunePreview, preview_lfs_prune, prune_lfs_objects};
pub use lfs_tracking::{
    LfsAttribute, LfsFileAttributes, LfsTrackingPattern, LfsTrackingRules, lfs_file_attributes,
    lfs_tracking_rules, untrack_lfs_pattern,
};
pub use operation_recovery::{
    OperationRecovery, ResetPlan, ResetPreview, delete_operation_recovery, execute_reset,
    operation_recoveries, prepare_reset, preserve_operation, restore_operation_branch,
};
pub use worktree_actions::{WorktreeMove, WorktreeRepair, move_worktree, repair_worktree};
mod commit_template;
mod git_failure_hints;
mod history_walk;
mod integrity;
pub use integrity::{IntegrityReport, inspect_integrity};
mod reference_actions;
mod stash_file_restore;
mod stash_options;
pub use stash_file_restore::apply_stashed_file;
pub use stash_options::{
    StashOptions, apply_stash_with_index, create_branch_from_stash, stash_and_checkout,
    stash_with_options,
};
#[cfg(all(test, unix))]
mod literal_file_tests;
#[cfg(test)]
mod no_commit_replay_tests;
#[cfg(test)]
mod ordered_revert_tests;
#[cfg(test)]
mod rebase_split_tests;
#[cfg(test)]
mod reference_actions_tests;
#[cfg(test)]
mod selected_rebase_tests;
#[cfg(test)]
mod stash_file_restore_tests;
#[cfg(all(test, unix))]
mod transport_stderr_tests;
pub use reference_actions::{
    configure_remote_urls, create_signed_tag, delete_local_tag, preserve_reference,
    remote_tag_object, set_remote_push_url, transport_reference, verify_tag,
};
pub mod authentication;
pub mod history_search;
pub use discard::{
    DiscardPlan, DiscardPreview, DiscardRecoveryInfo, delete_discard_recovery,
    delete_discard_recovery_reviewed, discard_plan_fingerprint, discarded_change_recoveries,
    execute_discard, prepare_discard, prepare_partial_discard,
    prepare_partial_discard_with_preview, recover_discarded_changes,
    recover_discarded_changes_reviewed,
};

pub const MINIMUM_GIT_VERSION: &str = "2.39.0";
const EMPTY_TREE_OID: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EMPTY_TREE_SHA256_OID: &str =
    "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
const MAX_REFLOG_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_TAG_DETAILS_OUTPUT_BYTES: usize = 64 * 1024;

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemGitInfo {
    pub version: Option<String>,
    pub supported: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
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
    pub commit_template_error: Option<AppError>,
    pub commits: Vec<CommitSummary>,
    pub history_truncated: bool,
    /// Bare repositories have no working tree; working-tree actions are unavailable.
    pub bare: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LfsInfo {
    pub enabled: bool,
    pub available: bool,
    pub version: Option<String>,
    pub tracked_files: Option<usize>,
    /// Tracked files currently checked out as LFS pointers.
    pub pointer_files: Option<usize>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SparseCheckoutInfo {
    pub enabled: bool,
    pub cone_mode: bool,
    pub sparse_index: bool,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub oid: String,
    pub selector: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReflogPage {
    pub entries: Vec<ReflogEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SigningInfo {
    pub enabled: bool,
    pub format: String,
    pub key: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SigningDiagnostic {
    pub available: bool,
    pub program: String,
    pub format: String,
    pub key_configured: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
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

#[derive(Debug, Clone, Serialize, specta::Type)]
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

#[derive(Debug, Clone, Default, Serialize, specta::Type)]
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
    pub history_no_commit: bool,
    pub rebase_in_progress: bool,
    pub rebase_edit_stopped: bool,
    pub rebase_split: Option<RebaseSplitStatus>,
    pub mail_patch_in_progress: bool,
    pub bisect_in_progress: bool,
    pub entry_count: usize,
    pub entries_truncated: bool,
    pub entries: Vec<WorkingTreeEntry>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeEntry {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
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

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub reference: String,
    pub oid: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub full_name: String,
    pub name: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
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

#[derive(Debug, Clone, Serialize, specta::Type)]
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

#[derive(Debug, Clone, Serialize, specta::Type)]
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
    reset_failure: Option<AppError>,
    show_checkpoints: bool,
}

impl CommitHistoryCursor {
    pub fn reset(&mut self, path: &Path, initial: &[CommitSummary]) -> Result<(), AppError> {
        self.reset_with_checkpoint_visibility(path, initial, false)
    }

    pub fn reset_with_checkpoint_visibility(
        &mut self,
        path: &Path,
        initial: &[CommitSummary],
        show_checkpoints: bool,
    ) -> Result<(), AppError> {
        // Reset may clear the old frontier before a metadata read fails. An
        // empty, partially initialized cursor must never mean complete history.
        self.show_checkpoints = show_checkpoints;
        let result = self.reset_inner(path, initial);
        self.reset_failure = result.as_ref().err().cloned();
        result
    }

    fn reset_inner(&mut self, path: &Path, initial: &[CommitSummary]) -> Result<(), AppError> {
        self.emitted = initial.iter().map(|commit| commit.oid.clone()).collect();
        self.frontier.clear();
        self.stashes.clear();
        // Reusing the open repository keeps its loaded pack indexes and
        // object cache warm across refreshes of the same repository.
        let reusable = self.walk.take().filter(|walk| walk.can_reuse_for(path));

        if let Some(mut walk) = reusable.or_else(|| history_walk::HistoryWalk::open(path)) {
            let mut args = vec!["log", "--no-walk"];
            add_history_format_arguments(&mut args, self.show_checkpoints);
            add_history_ref_arguments(&mut args, self.show_checkpoints);
            let tips = read_commits_with_arguments(path, &args)?;
            self.stashes = read_stashes(path)?;
            let stash_oids = self
                .stashes
                .iter()
                .map(|stash| stash.oid.clone())
                .collect::<Vec<_>>();
            if walk.reset(&tips, initial, &stash_oids).is_ok() {
                self.walk = Some(walk);
                return Ok(());
            }
        }

        self.reset_git_frontier(path, initial)
    }

    fn reset_git_frontier(
        &mut self,
        path: &Path,
        initial: &[CommitSummary],
    ) -> Result<(), AppError> {
        let mut args = vec!["rev-list", "--no-walk"];
        add_history_ref_arguments(&mut args, self.show_checkpoints);
        let tips = run_git(path, &args)?;
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
        if let Some(error) = &self.reset_failure {
            return Err(error.clone());
        }
        if let Some(walk) = self.walk.as_mut() {
            let commits = walk.next_page(limit)?;
            return Ok(CommitHistoryPage {
                commits: normalize_stash_history(commits, &self.stashes),
                history_truncated: walk.has_more(),
            });
        }

        let mut commits = Vec::with_capacity(limit);
        while commits.len() < limit && !self.frontier.is_empty() {
            let remaining = limit - commits.len();
            let batch = read_commits_from_revisions(
                path,
                remaining,
                &self.frontier,
                self.show_checkpoints,
            )?;
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

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TrackedFileSearch {
    pub paths: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub status: String,
    pub path: String,
    pub previous_path: Option<String>,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub oid: String,
    pub message: String,
    pub signature: CommitSignature,
    pub files: Vec<CommitFile>,
    pub files_truncated: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitSignature {
    pub status: String,
    pub signer: Option<String>,
    pub key: Option<String>,
    pub fingerprint: Option<String>,
    pub trust: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitComparison {
    pub base_oid: String,
    pub target_oid: String,
    pub working_tree: bool,
    pub files: Vec<CommitFile>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveRebaseCommit {
    pub oid: String,
    pub author_name: String,
    pub author_email: String,
    pub subject: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveRebasePlan {
    pub source: String,
    pub target: String,
    pub base: String,
    pub commits: Vec<InteractiveRebaseCommit>,
    pub remote_reachable_oids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveRebaseStep {
    pub oid: String,
    pub action: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileDiff {
    pub oid: String,
    pub path: String,
    pub patch: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeFileDiff {
    pub path: String,
    pub staged: bool,
    pub patch: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub oid: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileBlameLine {
    pub line_number: usize,
    pub oid: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: i64,
    pub summary: String,
    pub text: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileBlamePage {
    pub lines: Vec<FileBlameLine>,
    pub next_line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDetails {
    pub path: String,
    pub ancestor: Option<String>,
    pub current: Option<String>,
    pub incoming: Option<String>,
    pub output: Option<String>,
    pub binary: bool,
    pub truncated: bool,
    pub state: String,
    pub editable: bool,
    pub current_exists: bool,
    pub incoming_exists: bool,
    pub submodule: bool,
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
const MAX_FILE_HISTORY_BYTES: usize = 2 * 1024 * 1024;
const MAX_INTERACTIVE_REBASE_COMMITS: usize = 500;
const MAX_INTERACTIVE_REBASE_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMMIT_FILES: usize = 300;
const COMMIT_RENAME_LIMIT: usize = 200;
const MAX_TRACKED_FILE_SEARCH_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error, specta::Type)]
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
            Some(git_failure_hints::recovery_hint(detail)),
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
    if !output.status.success() {
        let error = classify_open_failure(path, &output);
        if error.kind == "bareRepositoryUnsupported"
            && let Some(bare) = explicit_bare_repository_root(path)
        {
            return Ok(bare);
        }
        return Err(error);
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    PathBuf::from(root).canonicalize().map_err(|error| {
        AppError::new(
            "invalidRepositoryPath",
            format!("Could not resolve the repository path: {error}"),
            None,
        )
    })
}

/// Accepts `path` as a read-only bare repository only when it is the
/// repository directory itself. The explicit `GIT_DIR` form keeps working
/// under `safe.bareRepository=explicit`, which refuses implicit discovery.
fn explicit_bare_repository_root(path: &Path) -> Option<PathBuf> {
    let root = path.canonicalize().ok()?;
    let output = git_in(&root)
        .arg("--git-dir")
        .arg(&root)
        .args(["rev-parse", "--is-bare-repository", "--absolute-git-dir"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    if !output.status.success() || lines.next()? != "true" {
        return None;
    }
    if PathBuf::from(lines.next()?).canonicalize().ok()? != root {
        return None;
    }
    remember_explicit_bare_repository(&root);
    Some(root)
}

/// Explains repository shapes Git Khronos cannot open as a working tree,
/// keeping Git's own wording as the detail.
fn classify_open_failure(path: &Path, output: &Output) -> AppError {
    let mut error = AppError::git_failure("open this repository", output);
    let detail = error.message.to_ascii_lowercase();
    let (kind, summary, hint) = if detail.contains("must be run in a work tree")
        || detail.contains("cannot use bare repository")
    {
        if path.components().any(|part| part.as_os_str() == ".git") {
            (
                "repositoryDataFolder",
                "This folder is Git's internal repository data, not the project's working tree.",
                "Open the project folder that contains this .git folder.",
            )
        } else {
            (
                "bareRepositoryUnsupported",
                "This folder belongs to a bare repository but is not its top-level folder.",
                "Open the bare repository folder itself (often named project.git) to browse it read-only. Nothing was changed.",
            )
        }
    } else if detail.contains("unknown repository extension")
        || detail.contains("expected git repo version")
    {
        (
            "unsupportedRepositoryFormat",
            "This repository uses a format that the installed Git does not support.",
            "Update Git, or use the tool that created the repository. Nothing was changed.",
        )
    } else if detail.contains("dubious ownership") {
        (
            "untrustedRepositoryOwner",
            "Git refused this repository because another user owns it.",
            "Check who owns the folder. Only if you trust it, add it to safe.directory with local Git, then open it again.",
        )
    } else {
        return error;
    };
    error.kind = kind.to_owned();
    error.message = format!("{summary} Git reported: {}", error.message);
    error.hint = Some(hint.to_owned());
    error
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
    clone_repository_with_submodules(remote, parent, folder, branch, depth, false)
}

/// Clones like [`clone_repository`]; `recurse_submodules` asks Git to initialize
/// and clone every submodule recursively, recording `submodule.active=.`.
pub fn clone_repository_with_submodules(
    remote: &str,
    parent: &Path,
    folder: &str,
    branch: Option<&str>,
    depth: Option<u32>,
    recurse_submodules: bool,
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
    authentication::validate_arguments(&[remote])?;
    // Reserve only the new, empty directory. Git's URL review needs the actual
    // destination context for conditional includes, not the parent repository.
    fs::create_dir(&destination).map_err(|error| {
        AppError::new(
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "destinationExists"
            } else {
                "createCloneDestinationFailed"
            },
            "The clone destination could not be created.",
            Some("Check the destination permissions or choose another folder name."),
        )
    })?;
    let destination = destination.canonicalize().map_err(|error| {
        let _ = fs::remove_dir(&destination);
        AppError::new(
            "invalidRepositoryPath",
            format!("Could not resolve the clone destination: {error}"),
            None,
        )
    })?;
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
    if recurse_submodules {
        args.push("--recurse-submodules".to_owned());
    }
    args.extend([
        "--".to_owned(),
        remote.to_owned(),
        destination.to_string_lossy().into_owned(),
    ]);
    let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
    let cloned = run_transport(parent, &borrowed, None, Some((remote, &destination)))
        .and_then(|output| ensure_success("clone that repository", &output));
    if let Err(mut error) = cloned {
        // Never recursively remove partial work. This succeeds only when the
        // directory reserved above is still empty (for example after refusal).
        let _ = fs::remove_dir(&destination);
        // Git keeps a checked-out superproject when only a submodule clone fails.
        let superproject_ready = recurse_submodules
            && error.kind != "operationCancelled"
            && run_git(&destination, &["rev-parse", "--verify", "--quiet", "HEAD"])
                .is_ok_and(|output| output.status.success())
            && run_git(&destination, &["rev-parse", "--show-toplevel"]).is_ok_and(|output| {
                output.status.success()
                    && Path::new(String::from_utf8_lossy(&output.stdout).trim())
                        .canonicalize()
                        .ok()
                        == destination.canonicalize().ok()
            });
        if superproject_ready {
            error.kind = "submoduleCloneIncomplete".to_owned();
            error.message = format!(
                "The repository was cloned, but some submodules could not be cloned. Git reported: {}",
                error.message
            );
            error.hint = Some(format!(
                "Open {} and review its Submodules to retry the missing ones, or delete that folder and clone again.",
                destination.display()
            ));
        } else if destination.symlink_metadata().is_ok() {
            // Cancellation stops Git before it can remove its own partial work.
            error.hint = Some(format!(
                "Partial clone data remains at {}. Delete that folder before retrying, or choose another folder name.",
                destination.display()
            ));
        }
        return Err(error);
    }
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
    snapshot_with_options(path, commit_limit, status_limit, true, true, "all", false)
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
    snapshot_with_limits_fast_and_checkpoint_visibility(path, commit_limit, status_limit, false)
}

/// Builds a fast snapshot with optional Copilot checkpoint history.
pub fn snapshot_with_limits_fast_and_checkpoint_visibility(
    path: &Path,
    commit_limit: usize,
    status_limit: usize,
    show_checkpoints: bool,
) -> Result<RepositoryData, AppError> {
    snapshot_with_options(
        path,
        commit_limit,
        status_limit,
        false,
        false,
        "no",
        show_checkpoints,
    )
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
    snapshot_with_limits_startup_and_checkpoint_visibility(path, commit_limit, status_limit, false)
}

/// Builds a startup snapshot with optional Copilot checkpoint history.
pub fn snapshot_with_limits_startup_and_checkpoint_visibility(
    path: &Path,
    commit_limit: usize,
    _status_limit: usize,
    show_checkpoints: bool,
) -> Result<RepositoryData, AppError> {
    let status = read_head_status(path)?;
    snapshot_with_status(
        path,
        commit_limit,
        false,
        false,
        false,
        show_checkpoints,
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
    show_checkpoints: bool,
) -> Result<RepositoryData, AppError> {
    let status = read_status_with_limit_mode(path, status_limit, untracked_files)?;
    snapshot_with_status(
        path,
        commit_limit,
        include_linked_worktree_status,
        include_all_branch_tracking,
        true,
        show_checkpoints,
        status,
    )
}

fn snapshot_with_status(
    path: &Path,
    commit_limit: usize,
    include_linked_worktree_status: bool,
    include_all_branch_tracking: bool,
    include_tags: bool,
    show_checkpoints: bool,
    status: RepositoryStatus,
) -> Result<RepositoryData, AppError> {
    let bare = is_explicit_bare_repository(path);
    // Three read-only lanes overlap Git process startup without creating one
    // thread per query. Fall back to serial reads if a worker cannot be started.
    let read_references = || {
        let remotes = read_remotes(path)?;
        let branches = read_branches(path, &status, include_all_branch_tracking)?;
        // Tag peeling is deferred for the first usable desktop frame.
        let tags = if include_tags {
            read_tags(path)?
        } else {
            Vec::new()
        };
        let worktrees = read_worktrees(path, &status, include_linked_worktree_status)?;
        Ok::<_, AppError>((remotes, branches, tags, worktrees))
    };
    let read_metadata = || {
        let submodules = if bare {
            Vec::new()
        } else {
            read_submodules(path)?
        };
        let lfs = read_lfs_info(path);
        let sparse_checkout = read_sparse_checkout_info(path);
        let (commit_template, commit_template_error) = match commit_template::read(path) {
            Ok(template) => (template, None),
            Err(error) => (None, Some(error)),
        };
        let (identity, signing) = read_identity_and_signing(path);
        Ok::<_, AppError>((
            submodules,
            lfs,
            sparse_checkout,
            commit_template,
            commit_template_error,
            identity,
            signing,
        ))
    };
    let (references, metadata, history) = thread::scope(|scope| {
        // A fetch-free scope is thread-bound. Keep its composed readers on the
        // current worker so cancellation and the no-lazy-fetch policy stay active.
        let references = if no_lazy_fetch::enabled() {
            None
        } else {
            thread::Builder::new()
                .name("snapshot-references".into())
                .spawn_scoped(scope, read_references)
                .ok()
        };
        let metadata = if no_lazy_fetch::enabled() {
            None
        } else {
            thread::Builder::new()
                .name("snapshot-metadata".into())
                .spawn_scoped(scope, read_metadata)
                .ok()
        };
        let history = (|| {
            let stashes = read_stashes(path)?;
            let history_read_limit = commit_limit
                .saturating_add(stashes.len().saturating_mul(2))
                .saturating_add(1);
            let commits = normalize_stash_history(
                read_commits_with_checkpoint_visibility(
                    path,
                    history_read_limit,
                    show_checkpoints,
                )?,
                &stashes,
            );
            let head_oid = run_git(path, &["rev-parse", "--verify", "HEAD"])
                .ok()
                .filter(|output| output.status.success())
                .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned());
            Ok::<_, AppError>((stashes, commits, head_oid))
        })();
        fn join<T>(handle: thread::ScopedJoinHandle<'_, T>) -> T {
            handle
                .join()
                .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
        }
        (
            references.map_or_else(read_references, join),
            metadata.map_or_else(read_metadata, join),
            history,
        )
    });
    let (remotes, branches, tags, worktrees) = references?;
    let (
        submodules,
        lfs,
        sparse_checkout,
        commit_template,
        commit_template_error,
        identity,
        signing,
    ) = metadata?;
    let (stashes, mut commits, head_oid) = history?;
    let history_truncated = commits.len() > commit_limit;
    commits.truncate(commit_limit);

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
        commit_template_error,
        commits,
        history_truncated,
        bare,
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

/// Deletes only the checkpoint ref the user reviewed, provided it has not moved.
pub fn delete_checkpoint_reference(
    path: &Path,
    reference: &str,
    expected_oid: &str,
) -> Result<(), AppError> {
    if !reference.starts_with(CHECKPOINT_REF_PREFIX)
        || reference.len() == CHECKPOINT_REF_PREFIX.len()
        || reference.contains(['\0', '\n', '\r'])
    {
        return Err(AppError::new(
            "invalidCheckpointReference",
            "That is not a valid Copilot checkpoint reference.",
            Some("Refresh the repository and choose a checkpoint again."),
        ));
    }
    let valid = run_git(path, &["check-ref-format", reference])?;
    if !valid.status.success() {
        return Err(AppError::new(
            "invalidCheckpointReference",
            "That is not a valid Copilot checkpoint reference.",
            Some("Refresh the repository and choose a checkpoint again."),
        ));
    }
    validate_commit_oid(expected_oid)?;
    if expected_oid.bytes().all(|byte| byte == b'0') {
        return Err(AppError::new(
            "invalidCommit",
            "That checkpoint identifier is invalid.",
            Some("Refresh the repository and choose a checkpoint again."),
        ));
    }

    let current = run_git(
        path,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            reference,
        ],
    )?;
    if current.status.code() == Some(1)
        || (current.status.success()
            && !String::from_utf8_lossy(&current.stdout)
                .trim()
                .eq_ignore_ascii_case(expected_oid))
    {
        return Err(AppError::new(
            "checkpointChanged",
            "That checkpoint has moved or no longer exists.",
            Some("Refresh the repository and review the checkpoint again."),
        ));
    }
    ensure_success("read that checkpoint", &current)?;
    run_mutation(
        path,
        &["update-ref", "--no-deref", "-d", reference, expected_oid],
        "delete that checkpoint reference",
    )
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
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "config",
            "--null",
            "--get-regexp",
            r"^(user\.signingkey|gpg\.(format|program|openpgp\.program|ssh\.program|x509\.program))$",
        ],
        64 * 1024,
    )?;
    if truncated {
        return Err(AppError::new(
            "signingConfigIncomplete",
            "Signing configuration exceeds the diagnostic output limit.",
            Some("Inspect effective signing settings with Git; no signer was invoked."),
        ));
    }
    if !(output.status.code() == Some(1) && output.stdout.is_empty() && output.stderr.is_empty()) {
        ensure_success("read effective signing configuration", &output)?;
    }
    let config = std::str::from_utf8(&output.stdout).map_err(|_| {
        AppError::new(
            "invalidSigningConfig",
            "Signing configuration is not valid UTF-8.",
            Some("Inspect the configured format, key and signer paths with Git."),
        )
    })?;
    let mut format = "openpgp";
    let mut key_configured = false;
    let mut openpgp = None;
    let mut ssh = None;
    let mut x509 = None;
    for record in config.split_inclusive('\0') {
        let Some((name, value)) = record
            .strip_suffix('\0')
            .and_then(|record| record.split_once('\n'))
        else {
            return Err(AppError::new(
                "invalidSigningConfig",
                "Git returned an incomplete or valueless signing setting.",
                Some(
                    "Set explicit signing values before retrying the diagnostic. No signer was invoked.",
                ),
            ));
        };
        match name {
            "gpg.format" => format = value,
            "user.signingkey" => key_configured = !value.is_empty(),
            "gpg.program" | "gpg.openpgp.program" => openpgp = Some(value),
            "gpg.ssh.program" => ssh = Some(value),
            "gpg.x509.program" => x509 = Some(value),
            _ => {}
        }
    }
    let program = match format {
        "openpgp" => openpgp.unwrap_or("gpg"),
        "ssh" => ssh.unwrap_or("ssh-keygen"),
        "x509" => x509.unwrap_or("gpgsm"),
        _ => {
            return Ok(SigningDiagnostic {
                available: false,
                program: "Unknown".into(),
                format: format.to_owned(),
                key_configured,
                message: format!("Git reports an unsupported signing format: {}.", format),
            });
        }
    };
    if program.is_empty() {
        return Err(AppError::new(
            "invalidSigningProgram",
            "The configured signing program is empty.",
            Some(
                "Correct the effective signer setting before retrying. No default program was substituted.",
            ),
        ));
    }
    let available = executable_available(path, program);
    let message = if available {
        if key_configured {
            format!("{program} is available and Git has an explicit signing key configured.")
        } else {
            format!("{program} is available; Git will select its default signing key.")
        }
    } else {
        format!("{program} was not found in the configured path or system PATH.")
    };
    Ok(SigningDiagnostic {
        available,
        program: program.to_owned(),
        format: format.to_owned(),
        key_configured,
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

pub fn initialize_all_submodules(path: &Path) -> Result<(), AppError> {
    initialize_all_submodules_with_cancellation(path, None)
}

pub fn initialize_all_submodules_cancellable(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    initialize_all_submodules_with_cancellation(path, Some(cancellation))
}

fn initialize_all_submodules_with_cancellation(
    path: &Path,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    if read_submodules(path)?.is_empty() {
        return Err(AppError::new(
            "noSubmodules",
            "This repository has no submodules to initialize.",
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
            "--init",
            "--recursive",
        ],
        "initialize all submodules",
        cancellation,
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

pub fn update_all_submodules_cancellable(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    let review = review_submodule_state(path)?;
    if review.entries.is_empty() {
        return Err(AppError::new(
            "noSubmodules",
            "This repository has no submodules to update.",
            None,
        ));
    }
    let missing = review
        .entries
        .iter()
        .filter(|submodule| !submodule.checked_out)
        .count();
    if missing > 0 {
        return Err(AppError::new(
            "submodulesNotInitialized",
            format!("{missing} submodule(s) are not initialized."),
            Some("Initialize missing submodules before updating all of them from their remotes."),
        ));
    }
    if review.entries.iter().any(|submodule| {
        submodule.name.is_none()
            || submodule.index_oid.is_none()
            || submodule.conflict.is_some()
            || submodule.tracked_changes
            || submodule.untracked_changes
    }) {
        return Err(AppError::new(
            "submoduleUpdateUnsafe",
            "Every submodule must be declared, recorded, conflict-free and clean before updating all of them.",
            Some("Review the submodule state and resolve local changes before trying again."),
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
        ],
        "update all submodules",
        Some(cancellation),
    )
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
    run_mutation(path, &["add", "--all", "--"], "stage all changes")?;
    if !read_sparse_checkout_info(path).enabled {
        return Ok(());
    }
    // `git add --all` succeeds silently while skipping changed tracked files
    // outside the sparse selection; report them instead of implying all staged.
    let output = run_git(
        path,
        &["status", "--porcelain=v2", "-z", "--untracked-files=no"],
    )?;
    ensure_success("check staged sparse checkout changes", &output)?;
    let mut skipped = Vec::new();
    let mut records = output.stdout.split(|byte| *byte == 0);
    while let Some(record) = records.next() {
        let record = String::from_utf8_lossy(record);
        let fields = if record.starts_with("1 ") {
            8
        } else if record.starts_with("2 ") {
            records.next();
            9
        } else {
            continue;
        };
        let mut parts = record.splitn(fields + 1, ' ');
        let worktree = parts.nth(1).and_then(|xy| xy.chars().nth(1));
        let submodule = parts.next().is_some_and(|sub| sub.starts_with('S'));
        if worktree != Some('.')
            && !submodule
            && let Some(file) = parts.nth(fields - 3)
        {
            skipped.push(file.to_owned());
        }
    }
    if skipped.is_empty() {
        return Ok(());
    }
    let shown = skipped
        .iter()
        .take(5)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    let more = skipped.len().saturating_sub(5);
    Err(AppError::new(
        "sparsePathsNotStaged",
        format!(
            "Other changes were staged, but Git left {} changed path(s) outside the sparse checkout selection unstaged: {shown}{}.",
            skipped.len(),
            if more > 0 {
                format!(" and {more} more")
            } else {
                String::new()
            }
        ),
        Some(SPARSE_OUTSIDE_HINT),
    ))
}

const SPARSE_OUTSIDE_HINT: &str = "Add their directories to the sparse checkout selection and stage again, or restore those files.";

pub fn stage_path(path: &Path, file: &str) -> Result<(), AppError> {
    let output = run_git(path, &["--literal-pathspecs", "add", "--", file])?;
    if !output.status.success()
        && String::from_utf8_lossy(&output.stderr)
            .contains("outside of your sparse-checkout definition")
    {
        return Err(AppError::new(
            "sparsePathOutsideSelection",
            format!("{file} is outside the sparse checkout selection, so Git did not stage it."),
            Some(SPARSE_OUTSIDE_HINT),
        ));
    }
    ensure_success("stage that file", &output)
}

pub fn unstage_all(path: &Path) -> Result<(), AppError> {
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    if head.status.success() {
        run_mutation(path, &["reset", "--mixed", "HEAD", "--"], "unstage changes")
    } else {
        run_mutation(
            path,
            &[
                "rm",
                "--cached",
                "--force",
                "-r",
                "--ignore-unmatch",
                "--",
                ".",
            ],
            "unstage changes",
        )
    }
}

pub fn unstage_path(path: &Path, file: &str) -> Result<(), AppError> {
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    if head.status.success() {
        run_mutation(
            path,
            &[
                "--literal-pathspecs",
                "reset",
                "--mixed",
                "HEAD",
                "--",
                file,
            ],
            "unstage that file",
        )
    } else {
        run_mutation(
            path,
            &[
                "--literal-pathspecs",
                "rm",
                "--cached",
                "--force",
                "--ignore-unmatch",
                "--",
                file,
            ],
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
            &["--literal-pathspecs", "clean", "-f", "-d", "--", file],
            "discard that untracked file",
        )
    } else {
        run_mutation(
            path,
            &["--literal-pathspecs", "restore", "--worktree", "--", file],
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
                "-c",
                "diff.noprefix=false",
                "-c",
                "diff.mnemonicPrefix=false",
                "diff",
                "--no-index",
                "--binary",
                "--full-index",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--src-prefix=a/",
                "--dst-prefix=b/",
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
                "--literal-pathspecs",
                "-c",
                "diff.noprefix=false",
                "-c",
                "diff.mnemonicPrefix=false",
                "diff",
                "--binary",
                "--full-index",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                "--unified=3",
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
    Ok(select_patch_lines_with_context(
        &String::from_utf8_lossy(&output.stdout),
        hunk_index,
        line_indices,
        true,
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
    let mut command = git_in(path);
    command.args(["apply", "--recount", "--whitespace=nowarn"]);
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

    ignore_rules::update(path, &rule, file, stop_tracking)
}

pub fn commit(path: &Path, message: &str) -> Result<(), AppError> {
    commit_with_options(path, message, false, false, None)
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitPolicy {
    pub sign_off: bool,
    pub allow_empty: bool,
    #[serde(default)]
    pub author: Option<CommitIdentity>,
    #[serde(default)]
    pub committer: Option<CommitIdentity>,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct CommitIdentity {
    pub name: String,
    pub email: String,
}

fn validate_commit_identity(identity: &CommitIdentity) -> Result<(), AppError> {
    let invalid = identity.name.is_empty()
        || identity.name.trim() != identity.name
        || identity.name.len() > 256
        || identity
            .name
            .chars()
            .any(|character| character.is_control() || matches!(character, '<' | '>'))
        || identity.email.is_empty()
        || identity.email.len() > 320
        || identity.email.chars().any(|character| {
            character.is_whitespace() || character.is_control() || matches!(character, '<' | '>')
        })
        || identity.email.split('@').count() != 2
        || identity.email.starts_with('@')
        || identity.email.ends_with('@');
    if invalid {
        return Err(AppError::new(
            "invalidCommitIdentity",
            "Enter a nonempty name and an explicit email for each enabled commit identity override.",
            Some(
                "Names cannot contain control characters or angle brackets. Emails need one @ with text on both sides. Repository configuration is not changed.",
            ),
        ));
    }
    Ok(())
}

pub fn commit_with_options(
    path: &Path,
    message: &str,
    amend: bool,
    skip_hooks: bool,
    sign: Option<bool>,
) -> Result<(), AppError> {
    commit_with_policy(
        path,
        message,
        amend,
        skip_hooks,
        sign,
        &CommitPolicy::default(),
    )
}

pub fn commit_with_policy(
    path: &Path,
    message: &str,
    amend: bool,
    skip_hooks: bool,
    sign: Option<bool>,
    policy: &CommitPolicy,
) -> Result<(), AppError> {
    let operations = repository_operation_state(path)?;
    if let Some(split) = &operations.rebase_split
        && (amend || policy.allow_empty || split.preparing || split.part_count >= 500)
    {
        return Err(AppError::new(
            "rebaseSplitCommit",
            "Create separate ordinary commits for the active split; do not amend its parent.",
            Some(
                "Disable Amend and unchanged-tree permission. A saved but unfinished reset requires Abort. At most 500 split commits are supported.",
            ),
        ));
    }
    if operations.history_no_commit {
        return Err(AppError::new(
            "noCommitReplayInProgress",
            "Finish the no-commit replay before creating a commit.",
            Some(
                "Stage resolved changes and Continue, or choose Finish manually to retain current changes and end the sequence.",
            ),
        ));
    }
    if operations.mail_patch {
        return Err(AppError::new(
            "mailPatchCommit",
            "Finish the paused mail-patch series before creating a commit.",
            Some(
                "Resolve and stage the current patch, then Continue, Skip this patch or Abort in Preferences → Git Features → Mail patches.",
            ),
        ));
    }
    if message.trim().is_empty() {
        return Err(AppError::new(
            "invalidCommitMessage",
            "A commit message is required.",
            None,
        ));
    }
    for identity in policy.author.iter().chain(policy.committer.iter()) {
        validate_commit_identity(identity)?;
    }
    let author = policy
        .author
        .as_ref()
        .map(|identity| format!("{} <{}>", identity.name, identity.email));
    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    if skip_hooks {
        args.push("--no-verify");
    }
    if policy.sign_off {
        args.push("--signoff");
    }
    if policy.allow_empty {
        args.push("--allow-empty");
    }
    if let Some(author) = &author {
        args.extend(["--author", author]);
    }
    match sign {
        Some(true) => args.push("--gpg-sign"),
        Some(false) => args.push("--no-gpg-sign"),
        None => {}
    }
    args.extend(["-m", message]);
    let mut environment = Vec::new();
    if let Some(committer) = &policy.committer {
        environment.extend([
            ("GIT_COMMITTER_NAME", committer.name.as_str()),
            ("GIT_COMMITTER_EMAIL", committer.email.as_str()),
        ]);
    }
    let output = run_git_with_environment(path, &args, &environment)?;
    ensure_success("create the commit", &output)
}

pub fn update_head_message(
    path: &Path,
    expected_oid: &str,
    message: &str,
    skip_hooks: bool,
) -> Result<(), AppError> {
    validate_commit_oid(expected_oid)?;
    if repository_operation_state(path)?.rebase_split.is_some() {
        return Err(AppError::new(
            "rebaseSplitCommit",
            "Message-only amendment is unavailable during a guided split.",
            Some("Create the reviewed split parts without amending the parent, then Continue."),
        ));
    }
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

pub fn create_branch_reference(path: &Path, name: &str, oid: &str) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    validate_commit_oid(oid)?;
    run_mutation(
        path,
        &["branch", "--", name, oid],
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
        let (tip, record) = protect_branch_tip(path, &branch)?;
        let reference = format!("refs/heads/{branch}");
        operation_recovery::with_commit_recovery(
            path,
            record,
            || {
                run_mutation(
                    path,
                    &["branch", "-D", "--", &branch],
                    "delete that worktree branch",
                )
            },
            || reference_tip(path, &reference).as_deref() == Some(tip.as_str()),
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

fn reference_tip(path: &Path, reference: &str) -> Option<String> {
    run_git(path, &["rev-parse", "--verify", "--quiet", reference])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn protect_branch_tip(path: &Path, name: &str) -> Result<(String, OperationRecovery), AppError> {
    let reference = format!("refs/heads/{name}");
    let tip = reference_tip(path, &reference).ok_or_else(|| {
        AppError::new(
            "branchNotFound",
            format!("{name} no longer exists."),
            Some("Refresh the repository and choose the branch again."),
        )
    })?;
    let record =
        operation_recovery::preserve_commits(path, &format!("Delete branch {name}"), &tip, None)?;
    Ok((tip, record))
}

pub fn delete_branch(path: &Path, name: &str, force: bool) -> Result<(), AppError> {
    validate_branch_name(path, name)?;
    let (tip, record) = protect_branch_tip(path, name)?;
    let reference = format!("refs/heads/{name}");
    operation_recovery::with_commit_recovery(
        path,
        record,
        || {
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
        },
        || reference_tip(path, &reference).as_deref() == Some(tip.as_str()),
    )
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
    prepare_interactive_rebase_with_selection(path, source, target, None)
}

pub fn prepare_interactive_rebase_with_selection(
    path: &Path,
    source: &str,
    target: &str,
    selection: Option<&[String]>,
) -> Result<InteractiveRebasePlan, AppError> {
    prepare_interactive_rebase_with_options(path, source, target, selection, false)
}

pub fn prepare_interactive_rebase_with_options(
    path: &Path,
    source: &str,
    target: &str,
    selection: Option<&[String]>,
    root: bool,
) -> Result<InteractiveRebasePlan, AppError> {
    prepare_rebase_review(path, source, target, selection, root, false)
}

fn prepare_rebase_review(
    path: &Path,
    source: &str,
    target: &str,
    selection: Option<&[String]>,
    root: bool,
    preserve_merges: bool,
) -> Result<InteractiveRebasePlan, AppError> {
    validate_branch_name(path, source)?;
    validate_branch_name(path, target)?;
    if root {
        if source != target || selection.is_some() {
            return Err(AppError::new(
                "invalidRootRebase",
                "Whole-history editing requires the current local branch without a selected range.",
                Some("Moving an entire history onto another base is a separate workflow."),
            ));
        }
        let shallow = run_git(path, &["rev-parse", "--is-shallow-repository"])?;
        ensure_success("check complete history for root editing", &shallow)?;
        if shallow.stdout != b"false\n" {
            return Err(AppError::new(
                "shallowRootRebase",
                "Whole-history editing requires complete history, not a shallow boundary.",
                Some("Deepen the repository to its actual root and prepare a fresh review."),
            ));
        }
    } else if let Some(oids) = selection {
        if source != target || oids.is_empty() || oids.len() > MAX_INTERACTIVE_REBASE_COMMITS {
            return Err(AppError::new(
                "invalidRebaseSelection",
                "Select 1-500 consecutive commits to edit on the current local branch.",
                Some(
                    "Selected-range editing keeps the original base; it does not move history to another branch.",
                ),
            ));
        }
        let mut seen = HashSet::new();
        for oid in oids {
            validate_commit_oid(oid)?;
            if !seen.insert(oid.to_ascii_lowercase()) {
                return Err(AppError::new(
                    "invalidRebaseSelection",
                    "A rebase selection cannot contain duplicate commits.",
                    None,
                ));
            }
        }
    } else if source == target {
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
    if status.merge_in_progress || status.history_operation.is_some() || status.bisect_in_progress {
        return Err(AppError::new(
            "historyOperationInProgress",
            "Finish or abort the active Git operation before preparing interactive rebase.",
            None,
        ));
    }
    if status.entry_count != 0 || status.entries_truncated {
        return Err(AppError::new(
            "dirtyWorkingTree",
            "Commit or stash working directory changes before interactive rebase.",
            None,
        ));
    }
    require_visible_replay_index(path)?;
    require_no_git_sequence(path)?;
    if selection.is_some() || root || preserve_merges {
        let head = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
        ensure_success("identify the branch for history editing", &head)?;
        if head.stdout != format!("refs/heads/{source}\n").as_bytes() {
            return Err(AppError::new(
                "staleInteractiveRebase",
                "The reviewed history belongs to a different current branch.",
                Some("Return to its local branch and prepare a fresh review."),
            ));
        }
    }
    let (worktrees, truncated) = run_git_with_stdout_limit(
        path,
        &["worktree", "list", "--porcelain", "-z"],
        1024 * 1024,
    )?;
    if truncated {
        return Err(AppError::new(
            "interactiveRebasePlanIncomplete",
            "The complete worktree list exceeds the interactive rebase review limit.",
            None,
        ));
    }
    ensure_success("check source branch occupancy", &worktrees)?;
    let registrations = worktree_diagnostics::parse_registrations(&worktrees.stdout)?;
    let current_path = resolve_repository(path)?;
    for registration in registrations {
        if registration.branch.as_deref() != Some(source) {
            continue;
        }
        let current =
            fs::canonicalize(&registration.path).is_ok_and(|registered| current_path == registered);
        if !current {
            return Err(AppError::new(
                "branchInAnotherWorktree",
                "The source branch is checked out in another worktree.",
                Some(
                    "Open its worktree to review and rebase that branch. Missing or locked registrations still occupy their branches.",
                ),
            ));
        }
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
    let source_ref = format!("refs/heads/{source}");
    let target_ref = format!("refs/heads/{target}");
    let source_output = run_git(path, &["rev-parse", "--verify", &source_ref])?;
    ensure_success(
        "capture the source tip for interactive rebase",
        &source_output,
    )?;
    let source_oid = std::str::from_utf8(&source_output.stdout)
        .map_err(|_| {
            AppError::new(
                "invalidInteractiveRebasePlan",
                "Git returned an unsupported source tip.",
                None,
            )
        })?
        .trim()
        .to_owned();
    validate_commit_oid(&source_oid)?;
    let base = if root {
        String::new()
    } else if let Some(oids) = selection {
        let output = run_git(
            path,
            &["rev-list", "--parents", "--no-walk", &oids[0], "--"],
        )?;
        ensure_success("inspect the selected range boundary", &output)?;
        let text = std::str::from_utf8(&output.stdout).map_err(|_| {
            AppError::new(
                "invalidRebaseSelection",
                "Git returned unsupported range boundary metadata.",
                None,
            )
        })?;
        let fields: Vec<_> = text.split_whitespace().collect();
        if fields.len() != 2 || !fields[0].eq_ignore_ascii_case(&oids[0]) {
            return Err(AppError::new(
                "invalidRebaseSelection",
                "The first selected commit must have exactly one available parent.",
                Some(
                    "Root, shallow-boundary and merge-start editing require a separate workflow. No history has been changed.",
                ),
            ));
        }
        validate_commit_oid(fields[1])?;
        fields[1].to_owned()
    } else {
        let base_output = run_git(path, &["merge-base", &source_ref, &target_ref])?;
        ensure_success("find a common ancestor for those branches", &base_output)?;
        String::from_utf8_lossy(&base_output.stdout)
            .trim()
            .to_owned()
    };
    if base.is_empty() && !root {
        return Err(AppError::new(
            "unrelatedBranches",
            "Those branches do not share a common ancestor.",
            None,
        ));
    }
    let range = if root {
        source_oid.clone()
    } else {
        format!("{base}..{source_oid}")
    };
    let count_limit = format!("--max-count={}", MAX_INTERACTIVE_REBASE_COMMITS + 1);
    let (topology, truncated) = run_git_with_stdout_limit(
        path,
        &["rev-list", "--reverse", "--parents", &count_limit, &range],
        MAX_INTERACTIVE_REBASE_BYTES,
    )?;
    if truncated {
        return Err(AppError::new(
            "interactiveRebasePlanIncomplete",
            "The complete source topology exceeds the interactive rebase review limit.",
            None,
        ));
    }
    ensure_success("inspect the source branch history", &topology)?;
    let topology_lines = std::str::from_utf8(&topology.stdout).map_err(|_| {
        AppError::new(
            "invalidInteractiveRebasePlan",
            "Git returned a non-UTF-8 rebase topology.",
            None,
        )
    })?;
    if topology_lines.lines().count() > MAX_INTERACTIVE_REBASE_COMMITS {
        return Err(AppError::new(
            "interactiveRebasePlanIncomplete",
            "Interactive rebase supports at most 500 commits in one reviewed plan.",
            Some("Choose a smaller source range in local Git. No partial plan is offered."),
        ));
    }
    if !preserve_merges
        && topology_lines
            .lines()
            .any(|line| line.split_whitespace().count() > 2)
    {
        return Err(AppError::new(
            "mergeCommitInRebase",
            "Interactive rebase is unavailable because the source range contains a merge commit.",
            Some("Choose a linear source branch or use a regular rebase."),
        ));
    }
    if root {
        let mut previous = None;
        for line in topology_lines.lines() {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            let valid = match previous {
                None => fields.len() == 1,
                Some(parent) => fields.len() == 2 && fields[1] == parent,
            };
            if !valid {
                return Err(AppError::new(
                    "invalidRootRebase",
                    "Whole-history editing requires one complete linear history from its actual root.",
                    Some("Merge-preserving history editing is a separate workflow."),
                ));
            }
            previous = fields.first().copied();
        }
    }
    let (log, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "log",
            "-z",
            "--no-notes",
            "--no-show-signature",
            "--encoding=none",
            "--reverse",
            &count_limit,
            "--format=%H%x00%an%x00%ae%x00%s%x00%B",
            &range,
            "--",
        ],
        MAX_INTERACTIVE_REBASE_BYTES,
    )?;
    if truncated {
        return Err(AppError::new(
            "interactiveRebasePlanIncomplete",
            "The complete commit messages exceed the 2 MiB interactive rebase review limit.",
            Some("Inspect and edit the history using local Git. No partial plan is offered."),
        ));
    }
    ensure_success("prepare the interactive rebase", &log)?;
    let commits = parse_interactive_rebase_commits(&log.stdout)?;
    if let Some(oids) = selection
        && (oids.len() > commits.len()
            || !oids
                .iter()
                .zip(&commits)
                .all(|(oid, commit)| oid.eq_ignore_ascii_case(&commit.oid)))
    {
        return Err(AppError::new(
            "invalidRebaseSelection",
            "The selected commits are not a consecutive oldest-to-newest range on the current branch.",
            Some(
                "Select one starting commit or a contiguous range. All later commits through HEAD will also be reviewed.",
            ),
        ));
    }
    let topology_oids = topology_lines
        .lines()
        .map(|line| line.split_whitespace().next().unwrap_or_default())
        .collect::<Vec<_>>();
    if !commits
        .iter()
        .map(|commit| commit.oid.as_str())
        .eq(topology_oids)
    {
        return Err(AppError::new(
            "staleInteractiveRebase",
            "The source history changed while the rebase plan was being prepared.",
            Some("Refresh and prepare the plan again."),
        ));
    }
    if commits.is_empty() {
        return Err(AppError::new(
            "emptyInteractiveRebase",
            format!("Branch '{source}' has no commits to replay onto '{target}'."),
            None,
        ));
    }
    let (reachability, truncated) = run_git_with_stdout_limit(
        path,
        &["rev-list", &count_limit, &range, "--not", "--remotes", "--"],
        MAX_INTERACTIVE_REBASE_BYTES,
    )?;
    ensure_success(
        "inspect recorded remote reachability for the rebase review",
        &reachability,
    )?;
    let unrecorded = std::str::from_utf8(&reachability.stdout)
        .map_err(|_| {
            AppError::new(
                "invalidInteractiveRebasePlan",
                "Git returned unsupported remote reachability metadata.",
                None,
            )
        })?
        .lines()
        .collect::<HashSet<_>>();
    if truncated
        || unrecorded.len() > commits.len()
        || unrecorded
            .iter()
            .any(|oid| !commits.iter().any(|commit| &commit.oid == oid))
    {
        return Err(AppError::new(
            "staleInteractiveRebase",
            "The source history changed while remote reachability was inspected.",
            Some("Refresh and prepare the complete plan again."),
        ));
    }
    let remote_reachable_oids = commits
        .iter()
        .filter(|commit| !unrecorded.contains(commit.oid.as_str()))
        .map(|commit| commit.oid.clone())
        .collect();
    let current_source = run_git(path, &["rev-parse", "--verify", &source_ref])?;
    ensure_success("check the reviewed source tip", &current_source)?;
    if current_source.stdout != source_output.stdout {
        return Err(AppError::new(
            "staleInteractiveRebase",
            "The source branch changed while the complete plan was being prepared.",
            Some("Refresh and review the complete plan again."),
        ));
    }
    Ok(InteractiveRebasePlan {
        source: source.to_owned(),
        target: target.to_owned(),
        base,
        commits,
        remote_reachable_oids,
    })
}

fn parse_interactive_rebase_commits(
    bytes: &[u8],
) -> Result<Vec<InteractiveRebaseCommit>, AppError> {
    let invalid = || {
        AppError::new(
            "invalidInteractiveRebasePlan",
            "Git returned incomplete or unsupported commit metadata for interactive rebase.",
            Some(
                "Inspect the history in local Git. No commits are silently omitted or text replaced.",
            ),
        )
    };
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| invalid())?;
    let text = text.strip_suffix('\0').ok_or_else(invalid)?;
    let fields = text.split('\0').collect::<Vec<_>>();
    let (records, remainder) = fields.as_chunks::<5>();
    if !remainder.is_empty() || records.len() > MAX_INTERACTIVE_REBASE_COMMITS {
        return Err(invalid());
    }
    let mut seen = std::collections::HashSet::new();
    records
        .iter()
        .map(|fields| {
            validate_commit_oid(fields[0]).map_err(|_| invalid())?;
            if !seen.insert(fields[0]) || fields[4].len() > MAX_COMMIT_MESSAGE_BYTES {
                return Err(invalid());
            }
            Ok(InteractiveRebaseCommit {
                oid: fields[0].to_owned(),
                author_name: fields[1].to_owned(),
                author_email: fields[2].to_owned(),
                subject: fields[3].to_owned(),
                message: fields[4].to_owned(),
            })
        })
        .collect()
}

pub fn execute_interactive_rebase(
    path: &Path,
    source: &str,
    target: &str,
    steps: &[InteractiveRebaseStep],
) -> Result<(), AppError> {
    execute_interactive_rebase_with_selection(path, source, target, steps, None)
}

pub fn execute_interactive_rebase_with_selection(
    path: &Path,
    source: &str,
    target: &str,
    steps: &[InteractiveRebaseStep],
    selection: Option<&[String]>,
) -> Result<(), AppError> {
    execute_interactive_rebase_with_options(path, source, target, steps, selection, false)
}

pub fn execute_interactive_rebase_with_options(
    path: &Path,
    source: &str,
    target: &str,
    steps: &[InteractiveRebaseStep],
    selection: Option<&[String]>,
    root: bool,
) -> Result<(), AppError> {
    execute_interactive_rebase_with_destination(path, source, target, steps, selection, root, None)
}

pub fn execute_interactive_rebase_with_destination(
    path: &Path,
    source: &str,
    target: &str,
    steps: &[InteractiveRebaseStep],
    selection: Option<&[String]>,
    root: bool,
    onto_oid: Option<&str>,
) -> Result<(), AppError> {
    if let Some(destination) = onto_oid {
        if !root && selection.is_none() {
            return Err(AppError::new(
                "invalidRebaseDestination",
                "Choose an explicit destination only for selected history or whole-history editing.",
                Some("Ordinary branch replay keeps its reviewed target branch."),
            ));
        }
        validate_commit_oid(destination)?;
        let output = run_git(
            path,
            &[
                "rev-parse",
                "--verify",
                &format!("{destination}^{{commit}}"),
            ],
        )?;
        ensure_success("verify the explicit rebase destination commit", &output)?;
        if !output
            .stdout
            .eq_ignore_ascii_case(format!("{destination}\n").as_bytes())
        {
            return Err(AppError::new(
                "invalidRebaseDestination",
                "The destination must identify the exact reviewed commit, not another object.",
                Some("Refresh the repository and select an available destination commit."),
            ));
        }
    }
    let plan = prepare_interactive_rebase_with_options(path, source, target, selection, root)?;
    if let Some(destination) = onto_oid
        && plan
            .commits
            .iter()
            .any(|commit| commit.oid.eq_ignore_ascii_case(destination))
    {
        return Err(AppError::new(
            "invalidRebaseDestination",
            "The destination cannot be a commit in the history being replayed.",
            Some("Choose a commit outside the history being replayed."),
        ));
    }
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
    let mut retained = false;
    let mut empty_rewords = HashSet::new();
    for step in steps {
        validate_commit_oid(&step.oid)?;
        match step.action.as_str() {
            "drop" => {}
            "squash" | "fixup" if !retained => {
                return Err(AppError::new(
                    "invalidInteractiveRebase",
                    "Squash and Fixup need a preceding retained commit.",
                    Some(
                        "Pick or reword an earlier commit, or change this action. Dropped commits cannot receive combined changes.",
                    ),
                ));
            }
            "pick" | "edit" | "squash" | "fixup" => retained = true,
            "reword" => {
                let message = step.message.as_deref().unwrap_or_default().trim();
                if message.is_empty()
                    || message.len() > MAX_COMMIT_MESSAGE_BYTES
                    || message.contains('\0')
                {
                    return Err(AppError::new(
                        "invalidInteractiveRebase",
                        format!(
                            "Every reworded commit needs a non-empty message no larger than {MAX_COMMIT_MESSAGE_BYTES} bytes, without NUL characters."
                        ),
                        None,
                    ));
                }
                let unchanged =
                    run_git(path, &["diff-tree", "--root", "--quiet", &step.oid, "--"])?;
                if unchanged.status.success() {
                    empty_rewords.insert(step.oid.as_str());
                } else if unchanged.status.code() != Some(1) {
                    ensure_success("inspect an originally empty reword commit", &unchanged)?;
                }
                retained = true;
            }
            _ => {
                return Err(AppError::new(
                    "invalidInteractiveRebase",
                    "Choose Pick, Reword, Edit, Squash, Fixup, or Drop for every commit.",
                    None,
                ));
            }
        }
    }
    if root && !retained {
        return Err(AppError::new(
            "invalidRootRebase",
            "Retain at least one commit when editing the whole history.",
            Some("Dropping every commit is not a branch deletion or unborn-branch workflow."),
        ));
    }

    let source_tip = run_git(
        path,
        &["rev-parse", "--verify", &format!("refs/heads/{source}")],
    )?;
    ensure_success("read the source tip before interactive rebase", &source_tip)?;
    let source_tip = String::from_utf8_lossy(&source_tip.stdout)
        .trim()
        .to_owned();
    if (selection.is_some() || root)
        && plan
            .commits
            .last()
            .is_none_or(|commit| commit.oid != source_tip)
    {
        return Err(AppError::new(
            "staleInteractiveRebase",
            "The source tip changed after history editing was prepared.",
            Some("Prepare and review the complete history again."),
        ));
    }
    let support_dir = rebase_support_dir(path)?;
    preserve_reference(
        path,
        &source_tip,
        &if let Some(destination) = onto_oid.filter(|_| root) {
            format!("Whole-history editing {source} including root onto {destination}")
        } else if let Some(destination) = onto_oid {
            format!("Selected history {source} onto {destination}")
        } else if root {
            format!("Whole-history editing {source} including root")
        } else {
            format!("Interactive rebase {source} onto {target}")
        },
    )?;
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
    operation_storage::directory(&support_dir)?;
    let mut todo = String::new();
    for (index, step) in steps.iter().enumerate() {
        match step.action.as_str() {
            "pick" => todo.push_str(&format!("pick {}\n", step.oid)),
            "edit" => todo.push_str(&format!("edit {}\n", step.oid)),
            "drop" => todo.push_str(&format!("drop {}\n", step.oid)),
            "squash" => todo.push_str(&format!("squash {}\n", step.oid)),
            "fixup" => todo.push_str(&format!("fixup {}\n", step.oid)),
            "reword" => {
                let message = step.message.as_deref().unwrap_or_default().trim();
                let message_path = support_dir.join(format!("message-{index}.txt"));
                fs::write(&message_path, format!("{message}\n")).map_err(|error| {
                    AppError::new(
                        "rebaseSetupFailed",
                        format!("Could not save a reworded commit message: {error}"),
                        None,
                    )
                })?;
                todo.push_str(&format!(
                    "pick {}\nexec git commit --amend {}-F {}\n",
                    step.oid,
                    if empty_rewords.contains(step.oid.as_str()) {
                        "--allow-empty "
                    } else {
                        ""
                    },
                    shell_quote(&message_path.to_string_lossy())
                ));
            }
            _ => {
                cleanup_rebase_support(path);
                return Err(AppError::new(
                    "invalidInteractiveRebase",
                    "Choose Pick, Reword, Edit, Squash, Fixup, or Drop for every commit.",
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
    fs::write(&editor_path, "#!/bin/sh\ncp \"$GIT_KHRONOS_TODO\" \"$1\"\n").map_err(|error| {
        AppError::new(
            "rebaseSetupFailed",
            format!("Could not create the interactive rebase editor: {error}"),
            None,
        )
    })?;
    let sequence_editor = format!("sh {}", shell_quote(&editor_path.to_string_lossy()));
    let target_ref = if let Some(destination) = onto_oid {
        destination.to_owned()
    } else if selection.is_some() {
        plan.base.clone()
    } else {
        format!("refs/heads/{target}")
    };
    let mut command = git_in(path);
    if selection.is_some() || root {
        command.args([
            "-c",
            "rebase.updateRefs=false",
            "-c",
            "rebase.rebaseMerges=false",
            "-c",
            "rebase.autoSquash=false",
            "-c",
            "rebase.autoStash=false",
        ]);
    }
    if root {
        command.args(["rebase", "-i", "--root"]);
        if onto_oid.is_some() {
            command.args(["--onto", &target_ref]);
        }
    } else {
        command.args(["rebase", "-i", "--onto", &target_ref, &plan.base]);
    }
    if selection.is_none() && !root {
        command.arg(source);
    }
    let output = command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("GIT_SEQUENCE_EDITOR", sequence_editor)
        .env("GIT_KHRONOS_TODO", &todo_path)
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
    let result = ensure_success("abort the interactive rebase", &output).map_err(|mut error| {
        if rebase_support_dir(path).is_ok_and(|directory| directory.join("split.json").is_file()) {
            error.hint = Some("Git refused to restore the branch; no force-reset is attempted. Preserve current changes. If split-created untracked files obstruct Abort, review and stage only those files, or move them safely outside the repository, then retry Abort.".into());
        }
        error
    });
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

/// Checks integrity before explicitly packing references and building commit graphs.
pub fn perform_repository_maintenance(path: &Path) -> Result<(), AppError> {
    let report = inspect_integrity(path, &CancellationToken::default())?;
    if !report.passed {
        return Err(AppError::new(
            "maintenanceIntegrityFailed",
            "Maintenance was not started because the integrity check failed or its report was incomplete.",
            Some(
                "Inspect integrity and preserve repository data before investigating. No maintenance task, pruning or repair was requested.",
            ),
        ));
    }
    run_mutation(
        path,
        &[
            "maintenance",
            "run",
            "--task=commit-graph",
            "--task=pack-refs",
        ],
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
    let strategy_arguments = match strategy {
        "merge" => ["--no-rebase", "--ff"],
        "ff-only" => ["--no-rebase", "--ff-only"],
        "rebase" => ["--rebase", "--ff"],
        _ => {
            return Err(AppError::new(
                "invalidPullStrategy",
                "That pull strategy is not supported.",
                Some("Choose fast-forward if possible, fast-forward only, or rebase."),
            ));
        }
    };

    let mut args = vec!["pull"];
    args.extend(strategy_arguments);
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

pub fn push_force_with_lease_to_remote(
    path: &Path,
    remote: &str,
    branch: &str,
    expected_remote_oid: &str,
    expected_head_oid: &str,
) -> Result<(), AppError> {
    push_force_with_reviewed_lease(
        path,
        remote,
        branch,
        expected_remote_oid,
        expected_head_oid,
        None,
    )
}

pub fn push_force_with_lease_to_remote_cancellable(
    path: &Path,
    remote: &str,
    branch: &str,
    expected_remote_oid: &str,
    expected_head_oid: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    push_force_with_reviewed_lease(
        path,
        remote,
        branch,
        expected_remote_oid,
        expected_head_oid,
        Some(cancellation),
    )
}

fn push_force_with_reviewed_lease(
    path: &Path,
    remote: &str,
    branch: &str,
    expected_remote_oid: &str,
    expected_head_oid: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    validate_branch_name(path, branch)?;
    validate_commit_oid(expected_remote_oid)?;
    validate_commit_oid(expected_head_oid)?;
    validate_commitish(path, expected_remote_oid)?;
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("check the local commit before force-pushing", &head)?;
    if String::from_utf8_lossy(&head.stdout).trim() != expected_head_oid {
        return Err(AppError::new(
            "staleForcePush",
            "The local branch changed after force-push review.",
            Some("Review the current branch and try again."),
        ));
    }
    let lease = format!("--force-with-lease=refs/heads/{branch}:{expected_remote_oid}");
    let refspec = format!("{expected_head_oid}:refs/heads/{branch}");
    run_mutation_with_cancellation(
        path,
        &["push", &lease, remote, &refspec],
        "force-push to the selected remote safely",
        cancellation,
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
    let output = run_git_with_input_output(
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
    )?;
    ensure_success("set sparse checkout directories", &output)?;
    ensure_no_sparse_paths_left(&output)
}

pub fn reapply_sparse_checkout(path: &Path) -> Result<(), AppError> {
    ensure_sparse_checkout_enabled(path)?;
    let output = run_git(path, &["sparse-checkout", "reapply"])?;
    ensure_success("reapply sparse checkout directories", &output)?;
    ensure_no_sparse_paths_left(&output)
}

/// Git applies the patterns but keeps modified or unmerged files outside them,
/// reporting those paths only as a warning (stable under `LC_ALL=C`).
fn ensure_no_sparse_paths_left(output: &Output) -> Result<(), AppError> {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut left = Vec::new();
    let mut listing = false;
    for line in stderr.lines() {
        if line.contains("were left despite sparse patterns") {
            listing = true;
        } else if let Some(entry) = line.strip_prefix('\t').filter(|_| listing) {
            if !left.iter().any(|known| known == entry) {
                left.push(entry.to_owned());
            }
        } else if let Some(entry) = line
            .strip_prefix("warning: unable to rmdir '")
            .and_then(|rest| rest.strip_suffix("': Directory not empty"))
        {
            listing = false;
            if !left.iter().any(|known| known == entry) {
                left.push(entry.to_owned());
            }
        } else {
            listing = false;
        }
    }
    if left.is_empty() {
        return Ok(());
    }
    let shown = left.iter().take(5).cloned().collect::<Vec<_>>().join(", ");
    let more = left.len().saturating_sub(5);
    Err(AppError::new(
        "sparsePathsLeft",
        format!(
            "The directory selection was applied, but Git kept {} path(s) outside it with local changes, conflicts or populated submodules: {shown}{}.",
            left.len(),
            if more > 0 {
                format!(" and {more} more")
            } else {
                String::new()
            }
        ),
        Some(
            "Commit, stash, discard or resolve changed paths, or deinitialize kept submodules, then choose Reapply. Nothing was deleted.",
        ),
    ))
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
    authentication::validate_arguments(&[url])?;
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

fn validate_selected_stash(
    path: &Path,
    reference: &str,
    expected_oid: &str,
) -> Result<(), AppError> {
    validate_stash_reference(reference)?;
    validate_commit_oid(expected_oid)?;
    if !reference_tip(path, reference).is_some_and(|oid| oid.eq_ignore_ascii_case(expected_oid)) {
        return Err(AppError::new(
            "staleStash",
            "The selected stash changed before the action could start.",
            Some(
                "Refresh the repository and select the stash again. No saved changes were applied.",
            ),
        ));
    }
    Ok(())
}

pub fn apply_stash_checked(
    path: &Path,
    reference: &str,
    expected_oid: &str,
) -> Result<(), AppError> {
    validate_selected_stash(path, reference, expected_oid)?;
    // A concurrent push may renumber the stack after validation. Apply the
    // captured object, never resolve the mutable selector a second time.
    run_mutation(path, &["stash", "apply", expected_oid], "apply the selected stash")
        .map_err(|mut error| {
            error.hint = Some("The stash was kept. Inspect the working directory for restored changes or conflicts before retrying.".to_owned());
            error
        })
}

pub fn pop_stash_checked(path: &Path, reference: &str, expected_oid: &str) -> Result<(), AppError> {
    apply_stash_checked(path, reference, expected_oid)?;
    // Do not replay an apply when only removal failed. Revalidate the selected
    // entry before capture/removal and report this partial outcome explicitly.
    drop_stash_checked(path, reference, expected_oid).map_err(|error| {
        AppError::new(
            "stashAppliedButRetained",
            format!("Saved changes were applied, but stash removal did not complete: {}", error.message),
            Some("Do not apply or pop this stash again. Review the working directory, refresh the stash list, then delete the saved entry separately if it is no longer needed. Recovery History may also contain its capture."),
        )
    })
}

pub fn stash_details(path: &Path, reference: &str) -> Result<CommitDetails, AppError> {
    validate_stash_reference(reference)?;
    let oid_output = run_git(path, &["rev-parse", "--verify", reference])?;
    ensure_success("resolve that stash", &oid_output)?;
    let oid = String::from_utf8_lossy(&oid_output.stdout)
        .trim()
        .to_owned();
    stash_details_at_oid(path, &oid)
}

pub fn stash_details_at_oid(path: &Path, oid: &str) -> Result<CommitDetails, AppError> {
    validate_commit_oid(oid)?;
    let (message_output, message_truncated) = run_git_with_stdout_limit(
        path,
        &[
            "show",
            "-s",
            "--encoding=UTF-8",
            "--no-notes",
            "--no-show-signature",
            "--no-color",
            "--format=%B",
            oid,
            "--",
        ],
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
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            oid,
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
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            oid,
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
    // Detect presence without invoking a configured verifier merely to preview
    // a stash. A signed object must not be presented as unsigned.
    let (object, truncated) =
        run_git_with_stdout_limit(path, &["cat-file", "commit", oid], MAX_COMMIT_DETAILS_BYTES)?;
    if !truncated {
        ensure_success("inspect the stash signature header", &object)?;
    }
    let has_signature = commit_has_signature_header(&object.stdout)?;
    Ok(CommitDetails {
        oid: oid.to_owned(),
        message,
        signature: CommitSignature {
            status: if has_signature {
                "unverifiable"
            } else {
                "unsigned"
            }
            .to_owned(),
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
    let oid_output = run_git(path, &["rev-parse", "--verify", reference])?;
    ensure_success("resolve that stash", &oid_output)?;
    let oid = String::from_utf8_lossy(&oid_output.stdout)
        .trim()
        .to_owned();
    stash_file_diff_at_oid(path, &oid, file, previous_file)
}

pub fn stash_file_diff_at_oid(
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
    let untracked_tree = format!("{oid}^3");
    let untracked = run_git(
        path,
        &[
            "--literal-pathspecs",
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
        // Both IDs hash the canonical `tree 0\0` object header. The selected
        // full OID identifies which of Git's supported object formats to use.
        if oid.len() == 64 {
            EMPTY_TREE_SHA256_OID
        } else {
            EMPTY_TREE_OID
        }
        .to_owned()
    } else {
        format!("{oid}^1")
    };
    let target = if untracked {
        untracked_tree
    } else {
        oid.to_owned()
    };
    let mut args = vec![
        "--literal-pathspecs",
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
        oid: oid.to_owned(),
        path: file.to_owned(),
        patch: String::from_utf8_lossy(bytes).into_owned(),
        truncated,
    })
}

pub fn drop_stash(path: &Path, reference: &str) -> Result<(), AppError> {
    drop_stash_inner(path, reference, None)
}

pub fn drop_stash_checked(
    path: &Path,
    reference: &str,
    expected_oid: &str,
) -> Result<(), AppError> {
    validate_commit_oid(expected_oid)?;
    drop_stash_inner(path, reference, Some(expected_oid))
}

fn drop_stash_inner(
    path: &Path,
    reference: &str,
    expected_oid: Option<&str>,
) -> Result<(), AppError> {
    validate_stash_reference(reference)?;
    let stale = || {
        AppError::new(
            "staleStash",
            "That stash changed since it was selected.",
            Some("Refresh the repository and choose the stash again."),
        )
    };
    let oid = reference_tip(path, reference).ok_or_else(stale)?;
    if expected_oid.is_some_and(|expected| !expected.eq_ignore_ascii_case(&oid)) {
        return Err(stale());
    }
    let base = reference_tip(path, &format!("{oid}^1")).ok_or_else(stale)?;
    let (subject, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "log",
            "-1",
            "--encoding=UTF-8",
            "--no-show-signature",
            "--no-notes",
            "--no-color",
            "--format=%s",
            &oid,
        ],
        2048,
    )?;
    if !truncated {
        ensure_success("read the stash message", &subject)?;
    }
    // This is a bounded display label, not the saved stash message. Preserve
    // the complete stash object by OID below; external Git can create labels
    // much longer than this application's input limit or in legacy encodings.
    let text = String::from_utf8_lossy(&subject.stdout[..subject.stdout.len().min(2048)]);
    let mut characters = text.trim().chars();
    let mut subject = characters
        .by_ref()
        .take(512)
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    if truncated || characters.next().is_some() {
        subject.push('…');
    }
    let record = operation_recovery::preserve_commits(
        path,
        &format!("Delete stash: {subject}"),
        &base,
        Some(&oid),
    )?;
    operation_recovery::with_commit_recovery(
        path,
        record,
        || {
            // Stash indexes shift when entries change; drop only the reviewed entry.
            if reference_tip(path, reference).as_deref() != Some(oid.as_str()) {
                return Err(stale());
            }
            run_mutation(path, &["stash", "drop", reference], "delete that stash")
        },
        || read_stashes(path).is_ok_and(|entries| entries.iter().any(|entry| entry.oid == oid)),
    )
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
    cherry_pick_commits_with_mainline(path, oids, None)
}

pub fn cherry_pick_commits_with_mainline(
    path: &Path,
    oids: &[String],
    mainline: Option<u32>,
) -> Result<(), AppError> {
    cherry_pick_commits_with_options(path, oids, mainline, false)
}

pub fn cherry_pick_commits_with_options(
    path: &Path,
    oids: &[String],
    mainline: Option<u32>,
    no_commit: bool,
) -> Result<(), AppError> {
    if no_commit {
        return no_commit_replay::start(path, oids, mainline);
    }
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
    validate_replay_mainline(path, oids, mainline)?;
    let mut arguments = Vec::with_capacity(oids.len() + 3);
    arguments.push("cherry-pick");
    let parent = mainline.map(|value| value.to_string());
    if let Some(parent) = &parent {
        preserve_replay_tip(path)?;
        arguments.extend(["--mainline", parent.as_str()]);
    }
    arguments.extend(oids.iter().map(String::as_str));
    run_mutation(path, &arguments, "cherry-pick the selected commits")
}

pub fn revert_commit(path: &Path, oid: &str) -> Result<(), AppError> {
    revert_commit_with_mainline(path, oid, None)
}

pub fn revert_commit_with_mainline(
    path: &Path,
    oid: &str,
    mainline: Option<u32>,
) -> Result<(), AppError> {
    validate_commit_oid(oid)?;
    validate_replay_mainline(path, &[oid.to_owned()], mainline)?;
    let parent = mainline.map(|value| value.to_string());
    let mut args = vec!["revert", "--no-edit"];
    if let Some(parent) = &parent {
        preserve_replay_tip(path)?;
        args.extend(["--mainline", parent.as_str()]);
    }
    args.push(oid);
    run_mutation(path, &args, "revert that commit")
}

pub fn revert_commits(path: &Path, oids: &[String]) -> Result<(), AppError> {
    if oids.is_empty() || oids.len() > 500 {
        return Err(AppError::new(
            "invalidRevertRange",
            "Select between 1 and 500 commits to revert.",
            None,
        ));
    }
    let mut unique = HashSet::new();
    for oid in oids {
        validate_commit_oid(oid)?;
        if !unique.insert(oid.to_ascii_lowercase()) {
            return Err(AppError::new(
                "invalidRevertRange",
                "The reviewed revert sequence contains a duplicate commit.",
                Some("Review each selected commit once before starting."),
            ));
        }
    }
    validate_replay_mainline(path, oids, None)?;
    require_no_git_sequence(path)?;
    require_visible_replay_index(path)?;
    preserve_replay_tip(path)?;
    let mut args = vec!["revert", "--no-edit", "--no-walk=unsorted"];
    args.extend(oids.iter().map(String::as_str));
    run_mutation(path, &args, "revert the reviewed commits in order")
}

fn require_visible_replay_index(path: &Path) -> Result<(), AppError> {
    let flags = run_git(path, &["ls-files", "-v", "-z"])?;
    ensure_success(
        "inspect hidden tracked changes before reviewed replay",
        &flags,
    )?;
    if flags
        .stdout
        .split(|byte| *byte == 0)
        .any(|record| record.first().is_some_and(u8::is_ascii_lowercase))
    {
        return Err(AppError::new(
            "hiddenIndexChanges",
            "Assume-unchanged entries prevent a complete reviewed replay preflight.",
            Some(
                "Clear assume-unchanged flags and review local changes before applying the sequence.",
            ),
        ));
    }
    Ok(())
}

fn require_no_git_sequence(path: &Path) -> Result<(), AppError> {
    let output = run_git(path, &["rev-parse", "--absolute-git-dir"])?;
    ensure_success("inspect competing Git operations", &output)?;
    let value = std::str::from_utf8(&output.stdout).map_err(|_| {
        AppError::new(
            "invalidGitDirectory",
            "Git returned an unsupported repository metadata path.",
            None,
        )
    })?;
    let directory = Path::new(value.strip_suffix('\n').unwrap_or(value));
    if [
        "sequencer",
        "rebase-apply",
        "rebase-merge",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
    ]
    .iter()
    .any(|file| directory.join(file).exists())
    {
        return Err(AppError::new(
            "historyOperationInProgress",
            "Another Git operation is active.",
            Some("Finish or abort that operation before starting another replay."),
        ));
    }
    Ok(())
}

fn validate_replay_mainline(
    path: &Path,
    oids: &[String],
    mainline: Option<u32>,
) -> Result<(), AppError> {
    if mainline.is_some() && oids.len() != 1 {
        return Err(AppError::new(
            "invalidMainline",
            "Replay merge commits individually so each parent choice can be reviewed.",
            None,
        ));
    }
    for oid in oids {
        let output = run_git(path, &["rev-list", "--parents", "--no-walk", oid, "--"])?;
        ensure_success("inspect replay commit parents", &output)?;
        let parents = String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .count()
            .saturating_sub(1);
        if parents > 1 {
            if !mainline.is_some_and(|parent| parent > 0 && parent as usize <= parents) {
                return Err(AppError::new(
                    "mainlineRequired",
                    "Choose a valid mainline parent before replaying this merge commit.",
                    Some(
                        "The chosen parent is the baseline: cherry-pick applies the merge difference; revert reverses that difference. Parent 1 is not selected automatically.",
                    ),
                ));
            }
        } else if mainline.is_some() {
            return Err(AppError::new(
                "invalidMainline",
                "Mainline selection is only valid for a merge commit.",
                None,
            ));
        }
    }
    Ok(())
}

fn preserve_replay_tip(path: &Path) -> Result<String, AppError> {
    let operations = repository_operation_state(path)?;
    if operations.merge || operations.rebase || operations.bisect || operations.history.is_some() {
        return Err(AppError::new(
            "historyOperationInProgress",
            "Finish or abort the active Git operation before replaying changes.",
            None,
        ));
    }
    let status = read_status(path)?;
    if status.entry_count != 0 || status.entries_truncated {
        return Err(AppError::new(
            "dirtyWorkingTree",
            "Commit or stash local changes before replaying changes.",
            None,
        ));
    }
    let output = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("read original history before replay", &output)?;
    let oid = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    preserve_reference(path, &oid, "Original tip before reviewed replay")?;
    Ok(oid)
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
    let state = repository_operation_state(path)?;
    let active = state.history;
    if active.as_deref() != Some(operation) {
        return Err(AppError::new(
            "historyOperationNotInProgress",
            format!("No {operation} operation is currently in progress."),
            None,
        ));
    }
    if state.history_no_commit {
        return no_commit_replay::control(path, action);
    }
    if operation == "revert"
        && action == "continue"
        && !state.revert_head_present
        && read_status(path)?.staged > 0
    {
        return Err(AppError::new(
            "revertCommitRequired",
            "The interrupted inverse step is staged but Git has no pending revert commit marker.",
            Some(
                "Review and explicitly commit the staged inverse step, then Continue the saved sequence; or Abort. Do not replay the full selection again.",
            ),
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
    execute_reset(path, &prepare_reset(path, oid, mode)?).map(|_| ())
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
    let read_message = |format: &str| {
        run_git_with_stdout_limit(
            path,
            &[
                "show",
                "-s",
                "--encoding=UTF-8",
                "--no-notes",
                "--no-show-signature",
                "--no-color",
                format,
                oid,
                "--",
            ],
            MAX_COMMIT_MESSAGE_BYTES,
        )
    };
    let (mut message_output, mut message_truncated) =
        read_message("--format=%G?%x00%GS%x00%GK%x00%GF%x00%GT%x00%B")?;
    // Git before 2.40 aborts on %GT when a signature has no trust level.
    if !message_output.status.success()
        && String::from_utf8_lossy(&message_output.stderr).contains("invalid trust level")
    {
        (message_output, message_truncated) =
            read_message("--format=%G?%x00%GS%x00%GK%x00%GF%x00%x00%B")?;
    }
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
    let (mut signature, mut message) = parse_commit_signature(&message_output.stdout)?;
    if signature.status == "unsigned" {
        let (object, truncated) = run_git_with_stdout_limit(
            path,
            &["cat-file", "commit", oid],
            MAX_COMMIT_DETAILS_BYTES,
        )?;
        if !truncated {
            ensure_success("inspect the commit signature header", &object)?;
        }
        if commit_has_signature_header(&object.stdout)? {
            signature.status = "unverifiable".to_owned();
        }
    }
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

fn parse_commit_signature(output: &[u8]) -> Result<(CommitSignature, String), AppError> {
    let text = String::from_utf8_lossy(output);
    let fields = text.splitn(6, '\0').collect::<Vec<_>>();
    let invalid = || {
        AppError::new(
            "invalidCommitSignatureOutput",
            "Commit verification metadata is incomplete or invalid.",
            Some(
                "Refresh the commit details. Incomplete metadata cannot establish a signature status.",
            ),
        )
    };
    if fields.len() != 6 {
        return Err(invalid());
    }
    let status = match fields[0] {
        "G" => "valid",
        "U" => "valid-unknown",
        "B" => "invalid",
        "X" => "expired-signature",
        "Y" => "expired-key",
        "R" => "revoked-key",
        "E" => "unverifiable",
        "N" => "unsigned",
        _ => return Err(invalid()),
    };
    let optional_field = |field: &str| {
        let value = field.trim();
        (!value.is_empty()).then(|| value.to_owned())
    };
    let signature = CommitSignature {
        status: status.to_owned(),
        signer: optional_field(fields[1]),
        key: optional_field(fields[2]),
        fingerprint: optional_field(fields[3]),
        trust: optional_field(fields[4]),
    };
    let message = fields[5].trim_end().to_owned();
    Ok((signature, message))
}

fn commit_has_signature_header(object: &[u8]) -> Result<bool, AppError> {
    let Some(end) = object.windows(2).position(|bytes| bytes == b"\n\n") else {
        return Err(AppError::new(
            "commitSignatureHeaderIncomplete",
            "The complete commit header could not be read; signature presence is unknown.",
            Some(
                "Inspect the commit with Git. An incomplete header cannot establish that it is unsigned.",
            ),
        ));
    };
    Ok(object[..end]
        .split(|byte| *byte == b'\n')
        .any(|line| line.starts_with(b"gpgsig ") || line.starts_with(b"gpgsig-sha256 ")))
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
        "--literal-pathspecs",
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
    let known: HashSet<_> = files.iter().map(|file| file.path.as_str()).collect();
    let entries: Vec<_> = read_status(path)?
        .entries
        .into_iter()
        .filter(|entry| entry.index_status == "?" && !known.contains(entry.path.as_str()))
        .collect();
    let paths: Vec<_> = entries.iter().map(|entry| entry.path.as_str()).collect();
    let counts = file_statistics::untracked_additions(path, &paths)?;
    for (entry, additions) in entries.into_iter().zip(counts) {
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
    let (output, truncated) = if untracked {
        run_git_with_stdout_limit(
            path,
            &[
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--unified=3",
                "--",
                "/dev/null",
                file,
            ],
            MAX_FILE_DIFF_BYTES,
        )?
    } else {
        let mut args = vec![
            "--literal-pathspecs",
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
        run_git_with_stdout_limit(path, &args, MAX_FILE_DIFF_BYTES)?
    };
    if !truncated {
        if untracked {
            if !output.status.success() && output.status.code() != Some(1) {
                ensure_success("compare that untracked file", &output)?;
            }
        } else {
            ensure_success("compare that working directory file", &output)?;
        }
    }
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
        "--literal-pathspecs",
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
    let output = history_search::bounded_git_with_limit(
        path,
        &[
            "--literal-pathspecs",
            "log",
            "--follow",
            "-200",
            "--encoding=UTF-8",
            "--no-notes",
            "--no-show-signature",
            "--no-color",
            "--no-decorate",
            "--no-patch",
            "--format=tformat:%H%x00%an%x00%ae%x00%aI%x00%s%x00",
            revision,
            "--",
            file,
        ]
        .map(str::to_owned),
        &CancellationToken::default(),
        MAX_FILE_HISTORY_BYTES,
    )?;
    ensure_success("read that file's history", &output)?;
    parse_file_history_records(&output.stdout)
}

fn parse_file_history_records(mut bytes: &[u8]) -> Result<Vec<FileHistoryEntry>, AppError> {
    let invalid = || {
        AppError::new(
            "invalidFileHistoryOutput",
            "Git returned incomplete or invalid file-history records.",
            Some(
                "File history was not replaced with partial results. Check repository integrity and retry the read.",
            ),
        )
    };
    let mut history = Vec::new();
    let mut seen = HashSet::new();
    while !bytes.is_empty() {
        let fields = decode_nul_record::<5>(&mut bytes)
            .ok_or_else(invalid)?
            .map(String::from_utf8_lossy);
        if validate_commit_oid(&fields[0]).is_err() || !seen.insert(fields[0].to_string()) {
            return Err(invalid());
        }
        history.push(FileHistoryEntry {
            oid: fields[0].to_string(),
            author_name: fields[1].to_string(),
            author_email: fields[2].to_string(),
            authored_at: fields[3].to_string(),
            subject: fields[4].to_string(),
        });
    }
    Ok(history)
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
    let output = read_blame_output(path, revision, file, None, 16 * 1024 * 1024)?;
    parse_blame_porcelain(&String::from_utf8_lossy(&output.stdout))
}

fn read_blame_output(
    path: &Path,
    revision: &str,
    file: &str,
    range: Option<&str>,
    limit: usize,
) -> Result<Output, AppError> {
    let mut args = vec![
        "--literal-pathspecs",
        "-c",
        "core.quotePath=true",
        "-c",
        "blame.blankBoundary=false",
        "-c",
        "blame.coloring=none",
        "blame",
        "--line-porcelain",
        "--encoding=UTF-8",
        "--no-textconv",
        "--root",
    ];
    if let Some(range) = range {
        args.extend(["-L", range]);
    }
    args.extend([revision, "--", file]);
    history_search::bounded_git_with_limit(
        path,
        &args.into_iter().map(str::to_owned).collect::<Vec<_>>(),
        &CancellationToken::default(),
        limit,
    )
}

pub fn file_blame_page(
    path: &Path,
    revision: &str,
    file: &str,
    first_line: usize,
) -> Result<FileBlamePage, AppError> {
    validate_commit_oid(revision)?;
    // This is a single literal argv path, not line-framed input. Whitespace and
    // control characters other than NUL are valid Git filename bytes.
    if file.is_empty()
        || file.contains('\0')
        || !Path::new(file)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(AppError::new(
            "invalidPath",
            "Choose a repository-relative file.",
            None,
        ));
    }
    if first_line == 0 || first_line > u32::MAX as usize - 100 {
        return Err(AppError::new(
            "invalidBlameRange",
            "Choose a positive whole line number within the file.",
            None,
        ));
    }
    let range = format!("{first_line},+101");
    let output = match read_blame_output(path, revision, file, Some(&range), 2 * 1024 * 1024) {
        Ok(output) => output,
        Err(error) => {
            // Git refuses -L on an empty blob. Verify the object, not a localized
            // stderr substring, before treating that failure as an empty file.
            if first_line == 1
                && error.kind != "historyTimeout"
                && error.kind != "historyOutputLimit"
            {
                let object = format!("{revision}:{file}");
                let query = |flag: &str| {
                    history_search::bounded_git_with_limit(
                        path,
                        &["cat-file".into(), flag.into(), object.clone()],
                        &CancellationToken::default(),
                        1024,
                    )
                };
                if query("-t").is_ok_and(|result| result.stdout == b"blob\n")
                    && query("-s").is_ok_and(|result| result.stdout == b"0\n")
                {
                    return Ok(FileBlamePage {
                        lines: Vec::new(),
                        next_line: None,
                    });
                }
            }
            return Err(error);
        }
    };
    let mut lines =
        parse_blame_porcelain_from(&String::from_utf8_lossy(&output.stdout), first_line)?;
    if lines.len() > 101 {
        return Err(AppError::new(
            "invalidBlameOutput",
            "Git returned lines outside the requested blame page.",
            None,
        ));
    }
    let next_line = (lines.len() > 100).then_some(first_line + 100);
    lines.truncate(100);
    Ok(FileBlamePage { lines, next_line })
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
        "--literal-pathspecs".to_owned(),
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
    let (state, editable_path, submodule) = conflict_state(path, file)?;
    let ancestor = read_conflict_stage(path, file, 1)?;
    let current = read_conflict_stage(path, file, 2)?;
    let incoming = read_conflict_stage(path, file, 3)?;
    let output_bytes = if editable_path {
        match fs::File::open(path.join(file)) {
            Ok(input) => {
                let mut bytes = Vec::new();
                input
                    .take((MAX_FILE_DIFF_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(discard::io_error)?;
                Some(bytes)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(discard::io_error(error)),
        }
    } else {
        None
    };
    let truncated = [&ancestor, &current, &incoming, &output_bytes]
        .into_iter()
        .flatten()
        .any(|bytes| bytes.len() > MAX_FILE_DIFF_BYTES);
    let binary = [&ancestor, &current, &incoming, &output_bytes]
        .into_iter()
        .flatten()
        .any(|bytes| bytes.contains(&0) || std::str::from_utf8(bytes).is_err());
    let current_exists = current.is_some();
    let incoming_exists = incoming.is_some();
    if conflict_state(path, file)?.0 != state {
        return Err(AppError::new(
            "staleConflictPreview",
            "The conflict changed while its preview was loading.",
            Some("Reload the conflict to inspect one consistent state."),
        ));
    }
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
        state,
        editable: editable_path && !binary && !truncated,
        current_exists,
        incoming_exists,
        submodule,
    })
}

fn conflict_state(path: &Path, file: &str) -> Result<(String, bool, bool), AppError> {
    let mut ancestor = path.to_path_buf();
    let components = Path::new(file).components().collect::<Vec<_>>();
    for component in components.iter().take(components.len().saturating_sub(1)) {
        ancestor.push(component);
        let metadata = fs::symlink_metadata(&ancestor).map_err(discard::io_error)?;
        if !metadata.is_dir() || metadata.is_symlink() {
            return Err(AppError::new(
                "conflictPathObstruction",
                "A conflict path has a non-directory or symbolic-link ancestor.",
                Some("Restore the tracked directory layout before resolving this conflict."),
            ));
        }
    }
    let stages = run_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--unmerged",
            "-z",
            "--",
            file,
        ],
    )?;
    ensure_success("read conflict index entries", &stages)?;
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("read conflict history base", &head)?;
    let branch = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    if !branch.status.success() && branch.status.code() != Some(1) {
        return Err(AppError::git_failure("read conflict branch", &branch));
    }
    let special = stages
        .stdout
        .split(|byte| *byte == 0)
        .any(|record| record.starts_with(b"120000 ") || record.starts_with(b"160000 "));
    let submodule = stages
        .stdout
        .split(|byte| *byte == 0)
        .any(|record| record.starts_with(b"160000 "));
    let (worktree, regular) = match fs::symlink_metadata(path.join(file)) {
        Ok(metadata) if metadata.is_file() => {
            let hash = run_git(path, &["hash-object", "--no-filters", "--", file])?;
            ensure_success("lease conflict working contents", &hash)?;
            let readonly = metadata.permissions().readonly();
            #[cfg(unix)]
            let mode = {
                use std::os::unix::fs::PermissionsExt;
                metadata.permissions().mode()
            };
            #[cfg(not(unix))]
            let mode = 0;
            (
                format!(
                    "file:{mode}:{readonly}:{}",
                    String::from_utf8_lossy(&hash.stdout)
                ),
                true,
            )
        }
        Ok(metadata) if metadata.is_symlink() => {
            let target = fs::read_link(path.join(file)).map_err(discard::io_error)?;
            (format!("symlink:{target:?}"), false)
        }
        Ok(_) => ("directory".into(), false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ("absent".into(), true),
        Err(error) => return Err(discard::io_error(error)),
    };
    Ok((
        format!(
            "{}\n{}\n{}\n{worktree}",
            String::from_utf8_lossy(&head.stdout),
            String::from_utf8_lossy(&branch.stdout),
            String::from_utf8_lossy(&stages.stdout)
        ),
        regular && !special,
        submodule,
    ))
}

pub fn resolve_conflict(
    path: &Path,
    file: &str,
    resolution: &str,
    output: Option<&str>,
) -> Result<(), AppError> {
    resolve_conflict_with_preview(path, file, resolution, output, None)
}

pub fn resolve_conflict_with_preview(
    path: &Path,
    file: &str,
    resolution: &str,
    output: Option<&str>,
    expected_state: Option<&str>,
) -> Result<(), AppError> {
    let entry = validate_worktree_path(path, file)?;
    if !entry.conflicted {
        return Err(AppError::new(
            "notConflicted",
            "That file is no longer conflicted.",
            Some("Refresh the repository and choose another file."),
        ));
    }
    let details = conflict_details(path, file)?;
    if expected_state.is_some_and(|state| state != details.state) {
        return Err(AppError::new(
            "staleConflictPreview",
            "The conflict index, branch or working file changed. Nothing was resolved.",
            Some("Reload the conflict and review the latest contents before resolving it."),
        ));
    }
    let stages = run_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--unmerged",
            "-z",
            "--",
            file,
        ],
    )?;
    ensure_success("inspect conflict file types", &stages)?;
    if details.submodule && matches!(resolution, "current" | "incoming") {
        let stage = if resolution == "current" { 2 } else { 3 };
        match conflict_stage_index_entry(&stages.stdout, stage)? {
            Some((mode, oid)) if mode == "160000" => run_mutation(
                path,
                &["update-index", "--add", "--cacheinfo", "160000", &oid, file],
                "stage that submodule commit",
            ),
            None => run_mutation(
                path,
                &["update-index", "--force-remove", "--", file],
                "accept that submodule deletion",
            ),
            Some(_) => Err(AppError::new(
                "mixedSubmoduleConflict",
                "The selected conflict side is not a submodule commit.",
                Some(
                    "Resolve this file-to-submodule type change with Git, then refresh the repository.",
                ),
            )),
        }?;
        return Ok(());
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
                    &["--literal-pathspecs", "checkout", option, "--", file],
                    "choose that conflict side",
                )?;
                run_mutation(
                    path,
                    &["--literal-pathspecs", "add", "--", file],
                    "mark that conflict resolved",
                ).map_err(|error| AppError::new(
                    "conflictSavedButNotStaged", error.message,
                    Some("The chosen side replaced the working file, but staging failed. Review it before marking it resolved."),
                ))
            } else {
                run_mutation(
                    path,
                    &["--literal-pathspecs", "rm", "-f", "--", file],
                    "accept that file deletion",
                )
            }
        }
        "output" => {
            if !details.editable {
                return Err(AppError::new(
                    "conflictNotEditable",
                    "This conflict cannot be saved through the text editor.",
                    Some(
                        "Choose a complete side for binary, symlink or oversized files, or resolve it with Git.",
                    ),
                ));
            }
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
                    "The resolved output is larger than 256 KB.",
                    Some("Use an external merge tool for this file."),
                ));
            }
            if contents.contains('\0') {
                return Err(AppError::new(
                    "binaryConflictOutput",
                    "Text conflict output cannot contain NUL bytes.",
                    Some("Use a complete side or a binary-aware local tool."),
                ));
            }
            if conflict_state(path, file)?.0 != details.state {
                return Err(AppError::new(
                    "staleConflictPreview",
                    "The conflict changed before saving. Nothing was resolved.",
                    Some("Reload the conflict and review its latest contents."),
                ));
            }
            let destination = path.join(file);
            let temporary = destination.with_file_name(format!(
                ".git-khronos-resolution-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|error| AppError::new("conflictWriteFailed", error.to_string(), None))?
                    .as_nanos()
            ));
            let mut options = fs::OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut created = false;
            let save = (|| {
                let mut target = options.open(&temporary).map_err(discard::io_error)?;
                created = true;
                match fs::metadata(&destination) {
                    Ok(metadata) => target
                        .set_permissions(metadata.permissions())
                        .map_err(discard::io_error)?,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            let executable = stages
                                .stdout
                                .split(|byte| *byte == 0)
                                .any(|record| record.starts_with(b"100755 "));
                            target
                                .set_permissions(fs::Permissions::from_mode(if executable {
                                    0o755
                                } else {
                                    0o644
                                }))
                                .map_err(discard::io_error)?;
                        }
                    }
                    Err(error) => return Err(discard::io_error(error)),
                }
                target
                    .write_all(contents.as_bytes())
                    .and_then(|_| target.sync_all())
                    .map_err(discard::io_error)?;
                drop(target);
                if conflict_state(path, file)?.0 != details.state {
                    return Err(AppError::new(
                        "staleConflictPreview",
                        "The conflict changed while saving. Nothing was resolved.",
                        Some("Reload the conflict and review its latest contents."),
                    ));
                }
                fs::rename(&temporary, &destination).map_err(discard::io_error)
            })();
            if let Err(error) = save {
                if created {
                    match fs::remove_file(&temporary) {
                        Ok(()) => {}
                        Err(cleanup) if cleanup.kind() == std::io::ErrorKind::NotFound => {}
                        Err(cleanup) => {
                            return Err(AppError::new(
                                "conflictWriteFailed",
                                format!(
                                    "{} Temporary output remains at {}: {cleanup}",
                                    error.message,
                                    temporary.display()
                                ),
                                Some(
                                    "The original conflict was not replaced. Inspect and remove the temporary file.",
                                ),
                            ));
                        }
                    }
                }
                return Err(error);
            }
            run_mutation(path, &["--literal-pathspecs", "add", "--", file], "mark that conflict resolved")
                .map_err(|error| AppError::new("conflictSavedButNotStaged", error.message,
                    Some("The edited working file was saved, but staging failed. Review it and retry marking it resolved.")))
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
    apply_working_tree_hunk_with_preview(path, file, staged, hunk_index, action, None)
}

pub fn apply_working_tree_hunk_with_preview(
    path: &Path,
    file: &str,
    staged: bool,
    hunk_index: usize,
    action: &str,
    expected_patch: Option<&str>,
) -> Result<(), AppError> {
    let full_patch = read_selection_patch(path, file, staged, action, expected_patch)?;
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
    apply_working_tree_lines_with_preview(
        path,
        file,
        staged,
        hunk_index,
        line_indices,
        action,
        None,
    )
}

pub fn apply_working_tree_lines_with_preview(
    path: &Path,
    file: &str,
    staged: bool,
    hunk_index: usize,
    line_indices: &[usize],
    action: &str,
    expected_patch: Option<&str>,
) -> Result<(), AppError> {
    if line_indices.is_empty() || line_indices.len() > 10_000 {
        return Err(AppError::new(
            "invalidLineSelection",
            "Select at least one changed line.",
            None,
        ));
    }
    let full_patch = read_selection_patch(path, file, staged, action, expected_patch)?;
    let patch = select_patch_lines_with_context(
        &full_patch,
        hunk_index,
        line_indices,
        staged || action == "discard",
    )?;
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

fn read_selection_patch(
    path: &Path,
    file: &str,
    staged: bool,
    action: &str,
    expected_patch: Option<&str>,
) -> Result<String, AppError> {
    let (entry, output) = read_working_tree_patch(path, file, staged)?;
    if entry.index_status == "?" {
        if staged || action != "stage" {
            return Err(AppError::new(
                "invalidUntrackedSelection",
                "New-file selections can be staged, but not unstaged or partially discarded.",
                Some("Use the file discard action to capture and remove an untracked file."),
            ));
        }
    } else {
        ensure_success("read that file's changes", &output)?;
    }
    if output.stdout.len() > MAX_FILE_DIFF_BYTES {
        return Err(AppError::new(
            "diffSelectionTooLarge",
            "This diff is too large for a complete selectable preview.",
            Some("Stage or unstage the whole file, or use a local Git tool to review its changes."),
        ));
    }
    let patch = String::from_utf8(output.stdout).map_err(|_| {
        AppError::new(
            "unsupportedDiffEncoding",
            "Individual changes require a UTF-8 text diff.",
            Some("Stage or unstage the whole file to preserve its original bytes."),
        )
    })?;
    if expected_patch.is_some_and(|expected| expected != patch) {
        return Err(AppError::new(
            "staleDiffSelection",
            "The file or index changed after this diff was opened. Nothing was staged or unstaged.",
            Some("Reload the diff and select changes from its current contents."),
        ));
    }
    Ok(patch)
}

fn read_working_tree_patch(
    path: &Path,
    file: &str,
    staged: bool,
) -> Result<(WorkingTreeEntry, Output), AppError> {
    let entry = validate_worktree_path(path, file)?;
    let mut output = if staged {
        run_git(
            path,
            &[
                "-c",
                "diff.noprefix=false",
                "-c",
                "diff.mnemonicPrefix=false",
                "--literal-pathspecs",
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                "--unified=3",
                "--",
                file,
            ],
        )?
    } else if entry.index_status == "?" {
        run_git_allow_diff_exit(
            path,
            &[
                "-c",
                "diff.noprefix=false",
                "-c",
                "diff.mnemonicPrefix=false",
                "--literal-pathspecs",
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--src-prefix=a/",
                "--dst-prefix=b/",
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
                "-c",
                "diff.noprefix=false",
                "-c",
                "diff.mnemonicPrefix=false",
                "--literal-pathspecs",
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                "--unified=3",
                "--",
                file,
            ],
        )?
    };
    if entry.index_status == "?" && !staged {
        let executable_mode = b"\nnew file mode 100755\n";
        if let Some(offset) = output
            .stdout
            .windows(executable_mode.len())
            .position(|bytes| bytes == executable_mode)
        {
            // No-index diff reports filesystem mode even when Git ignores executable bits.
            let mode = run_git(path, &["config", "--bool", "--get", "core.filemode"])?;
            if mode.status.success() && mode.stdout == b"false\n" {
                output.stdout.splice(
                    offset..offset + executable_mode.len(),
                    b"\nnew file mode 100644\n".iter().copied(),
                );
            } else if !mode.status.success() && mode.status.code() != Some(1) {
                return Err(AppError::git_failure(
                    "read Git executable-mode policy",
                    &mode,
                ));
            }
        }
    }
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

fn select_patch_lines_with_context(
    patch: &str,
    hunk_index: usize,
    line_indices: &[usize],
    reverse_context: bool,
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
                    output.push_str(if reverse_context {
                        &additions[pair].0[1..]
                    } else {
                        &deletions[pair].0[1..]
                    });
                }
                last_emitted = true;
            }
            for (line, line_index) in &deletions[pairs..] {
                if selected.contains(line_index) {
                    output.push_str(line);
                    seen += 1;
                } else if !reverse_context {
                    output.push(' ');
                    output.push_str(&line[1..]);
                }
                last_emitted = selected.contains(line_index) || !reverse_context;
            }
            for (line, line_index) in &additions[pairs..] {
                last_emitted = selected.contains(line_index);
                if last_emitted {
                    output.push_str(line);
                    seen += 1;
                } else if reverse_context {
                    output.push(' ');
                    output.push_str(&line[1..]);
                    last_emitted = true;
                }
            }
            continue;
        }
        if body[index].starts_with('+') {
            last_emitted = selected.contains(&change_index);
            if last_emitted {
                output.push_str(body[index]);
                seen += 1;
            } else if reverse_context {
                output.push(' ');
                output.push_str(&body[index][1..]);
                last_emitted = true;
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
    if seen < change_index
        && lines[..hunk_start]
            .iter()
            .any(|line| line.starts_with("new file mode 120000"))
    {
        return Err(AppError::new(
            "partialSymlinkUnsupported",
            "A symbolic link must be staged or unstaged as a complete target.",
            Some("Use the whole-file action to preserve the link target."),
        ));
    }
    if reverse_context
        && seen < change_index
        && lines[..hunk_start]
            .iter()
            .any(|line| line.starts_with("new file mode "))
    {
        // Keeping some new-file lines turns deletion into an ordinary content edit.
        let new_path = lines[..hunk_start]
            .iter()
            .find_map(|line| line.strip_prefix("+++ "))
            .ok_or_else(|| {
                AppError::new(
                    "invalidDiffHeader",
                    "The new-file diff has no destination path.",
                    None,
                )
            })?;
        let old_path = new_path.replacen("b/", "a/", 1);
        output = output
            .split_inclusive('\n')
            .filter_map(|line| {
                if line.starts_with("new file mode ") || line.starts_with("index ") {
                    None
                } else if line == "--- /dev/null\n" {
                    Some(format!("--- {old_path}"))
                } else if line.starts_with("@@ ") {
                    Some("@@ -1 +1 @@\n".into())
                } else {
                    Some(line.to_owned())
                }
            })
            .collect();
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
    parse_blame_porcelain_from(output, 1)
}

fn parse_blame_porcelain_from(
    output: &str,
    first_line: usize,
) -> Result<Vec<FileBlameLine>, AppError> {
    let invalid = || {
        AppError::new(
            "invalidBlameOutput",
            "Git returned incomplete or inconsistent blame information.",
            Some(
                "No partial blame lines were accepted. Retry the read or inspect the file with Git.",
            ),
        )
    };
    if !output.is_empty() && !output.ends_with('\n') {
        return Err(invalid());
    }
    let mut lines = output.split_terminator('\n');
    let mut blamed = Vec::new();
    while let Some(header) = lines.next() {
        let fields = header.split_ascii_whitespace().collect::<Vec<_>>();
        if !(fields.len() == 3 || fields.len() == 4)
            || validate_commit_oid(fields[0]).is_err()
            || fields[0].bytes().all(|byte| byte == b'0')
            || fields[1..]
                .iter()
                .any(|field| field.parse::<usize>().map_or(true, |number| number == 0))
        {
            return Err(invalid());
        }
        let line_number = fields[2].parse::<usize>().map_err(|_| invalid())?;
        if Some(line_number) != first_line.checked_add(blamed.len()) {
            return Err(invalid());
        }
        let oid = fields[0].to_owned();
        let mut author_name = None;
        let mut author_email = None;
        let mut authored_at = None;
        let mut summary = None;
        let mut text = None;
        let mut historical_path = None;
        for metadata in lines.by_ref() {
            if let Some(contents) = metadata.strip_prefix('\t') {
                text = Some(contents.to_owned());
                break;
            }
            if let Some(value) = metadata.strip_prefix("author ") {
                if author_name.replace(value.to_owned()).is_some() {
                    return Err(invalid());
                }
            } else if let Some(value) = metadata.strip_prefix("author-mail ") {
                let email = value
                    .strip_prefix('<')
                    .and_then(|value| value.strip_suffix('>'))
                    .ok_or_else(invalid)?;
                if author_email.replace(email.to_owned()).is_some() {
                    return Err(invalid());
                }
            } else if let Some(value) = metadata.strip_prefix("author-time ") {
                let time = value.parse::<i64>().map_err(|_| invalid())?;
                if !(-8_640_000_000_000..=8_640_000_000_000).contains(&time)
                    || authored_at.replace(time).is_some()
                {
                    return Err(invalid());
                }
            } else if let Some(value) = metadata.strip_prefix("summary ") {
                if summary.replace(value.to_owned()).is_some() {
                    return Err(invalid());
                }
            } else if let Some(value) = metadata.strip_prefix("filename ") {
                let decoded = history_search::decode_git_path(value)?;
                if decoded.is_empty() || historical_path.replace(decoded).is_some() {
                    return Err(invalid());
                }
            } else if metadata
                .split_ascii_whitespace()
                .next()
                .is_some_and(|field| validate_commit_oid(field).is_ok())
            {
                return Err(invalid());
            }
        }
        blamed.push(FileBlameLine {
            line_number,
            oid,
            author_name: author_name.ok_or_else(invalid)?,
            author_email: author_email.ok_or_else(invalid)?,
            authored_at: authored_at.ok_or_else(invalid)?,
            summary: summary.ok_or_else(invalid)?,
            text: text.ok_or_else(invalid)?,
            path: Some(historical_path.ok_or_else(invalid)?),
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
    if is_explicit_bare_repository(path) {
        return read_head_status(path);
    }
    let (output, output_truncated, overflow) =
        run_status_with_limit(path, entry_limit, untracked_files)?;
    let records = output.stdout.split(|byte| *byte == 0).collect::<Vec<_>>();
    let operations = repository_operation_state(path)?;
    let mut status = RepositoryStatus {
        merge_in_progress: operations.merge,
        history_operation: operations.history.clone(),
        history_no_commit: operations.history_no_commit,
        rebase_in_progress: operations.rebase,
        rebase_edit_stopped: operations.rebase_edit,
        rebase_split: operations.rebase_split,
        mail_patch_in_progress: operations.mail_patch,
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
        history_no_commit: operations.history_no_commit,
        rebase_in_progress: operations.rebase,
        rebase_edit_stopped: operations.rebase_edit,
        rebase_split: operations.rebase_split,
        mail_patch_in_progress: operations.mail_patch,
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

    let mut child = git_in(path)
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
            "Git Khronos could not read repository status output.",
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
                format!("Git Khronos could not read repository status: {error}"),
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
                format!("Git Khronos could not read a Git error: {error}"),
                Some("Try refreshing the repository."),
            )
        })?;
    }
    let status = child.wait().map_err(|error| {
        AppError::new(
            "gitFailure",
            format!("Git Khronos could not finish reading repository status: {error}"),
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
    // Names are action inputs: strip the known namespace, rather than using
    // ambiguity-dependent abbreviations such as `heads/main` or `remotes/x/y`.
    let format = if include_all_tracking {
        "%(refname)%1f%(refname:lstrip=2)%1f%(objectname)%1f%(HEAD)%1f%(upstream:lstrip=2)%1f%(upstream:track)%1f%(symref)%1e"
    } else {
        "%(refname)%1f%(refname:lstrip=2)%1f%(objectname)%1f%(HEAD)%1f%(upstream:lstrip=2)%1f%1f%(symref)%1e"
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
            pointer_files: None,
        };
    }
    let counts = available
        .then(|| {
            run_git(path, &["lfs", "ls-files"])
                .ok()
                .filter(|output| output.status.success())
                .map(|output| count_lfs_files(&String::from_utf8_lossy(&output.stdout)))
        })
        .flatten();
    let tracked_files = counts.map(|(tracked, _)| tracked);
    let pointer_files = counts.map(|(_, pointers)| pointers);
    LfsInfo {
        enabled,
        available,
        version,
        tracked_files,
        pointer_files,
    }
}

/// Counts `git lfs ls-files` lines (`<oid> <*|-> <path>`); `-` marks a file
/// checked out as a pointer, whether or not its object is cached locally.
fn count_lfs_files(output: &str) -> (usize, usize) {
    output.lines().filter(|line| !line.trim().is_empty()).fold(
        (0, 0),
        |(tracked, pointers), line| {
            let pointer = line.split_whitespace().nth(1) == Some("-");
            (tracked + 1, pointers + usize::from(pointer))
        },
    )
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
    if is_explicit_bare_repository(path) {
        return Ok(Vec::new());
    }
    let output = run_git(
        path,
        &[
            "stash",
            "list",
            "--encoding=UTF-8",
            "--no-color",
            "--no-notes",
            "--no-show-signature",
            "--format=tformat:%gd%x00%H%x00%gs%x00",
        ],
    )?;
    ensure_success("read stashes", &output)?;
    parse_stash_records(&output.stdout)
}

fn parse_stash_records(mut bytes: &[u8]) -> Result<Vec<StashEntry>, AppError> {
    let invalid = || {
        AppError::new(
            "invalidStashOutput",
            "Git returned incomplete or invalid stash records.",
            Some(
                "The stash list was not replaced with partial results. Check the stash reflog, then refresh. No stash was applied or removed by this read.",
            ),
        )
    };
    let mut stashes = Vec::new();
    while !bytes.is_empty() {
        let fields = decode_nul_record::<3>(&mut bytes)
            .ok_or_else(invalid)?
            .map(String::from_utf8_lossy);
        // This command lists the complete, newest-first stash reflog. Selectors
        // must remain its actual ordinals; a label cannot supply a new selector.
        if fields[0] != format!("stash@{{{}}}", stashes.len())
            || validate_commit_oid(&fields[1]).is_err()
        {
            return Err(invalid());
        }
        // Repeated object IDs are valid: Git can store one stash more than once.
        stashes.push(StashEntry {
            reference: fields[0].to_string(),
            oid: fields[1].to_string(),
            message: fields[2].to_string(),
        });
    }
    Ok(stashes)
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
    // Keep the exact tag name even when a branch has the same name.
    let output = run_git(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)%1f%(refname:lstrip=2)%1f%(objectname)%1f%(*objectname)%1e",
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

// Git-produced field terminators cannot collide with ordinary commit text.
// Explicit tformat also terminates the last record with a newline.
const HISTORY_FORMAT: &str = "--format=tformat:%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D%x00";

const CHECKPOINT_REF_PREFIX: &str = "refs/copilot/checkpoints/";

fn add_history_ref_arguments(args: &mut Vec<&str>, show_checkpoints: bool) {
    // Excluding decorations alone would still walk checkpoint commits;
    // --exclude must precede the --all argument it affects.
    args.push("--exclude=refs/git-khronos/recovery/*");
    if !show_checkpoints {
        args.push("--exclude=refs/copilot/checkpoints/*");
    }
    args.push("--all");
}

fn add_history_format_arguments(args: &mut Vec<&str>, show_checkpoints: bool) {
    args.extend([
        if show_checkpoints {
            "--decorate=full"
        } else {
            "--decorate=short"
        },
        "--decorate-refs-exclude=refs/remotes/*/HEAD",
        "--decorate-refs-exclude=refs/git-khronos/recovery/*",
    ]);
    if !show_checkpoints {
        args.push("--decorate-refs-exclude=refs/copilot/checkpoints/*");
    }
    args.push(HISTORY_FORMAT);
}

fn read_commits(path: &Path, limit: usize) -> Result<Vec<CommitSummary>, AppError> {
    read_commits_with_checkpoint_visibility(path, limit, false)
}

fn read_commits_with_checkpoint_visibility(
    path: &Path,
    limit: usize,
    show_checkpoints: bool,
) -> Result<Vec<CommitSummary>, AppError> {
    let count = format!("-{limit}");
    read_commits_with_pagination(path, &count, None, show_checkpoints)
}

fn read_commit_page(
    path: &Path,
    offset: usize,
    limit: usize,
) -> Result<Vec<CommitSummary>, AppError> {
    let count = format!("-{limit}");
    let skip = format!("--skip={offset}");
    read_commits_with_pagination(path, &count, Some(&skip), false)
}

fn read_commits_with_pagination(
    path: &Path,
    count: &str,
    skip: Option<&str>,
    show_checkpoints: bool,
) -> Result<Vec<CommitSummary>, AppError> {
    let mut args = vec!["log", count];
    if let Some(skip) = skip {
        args.push(skip);
    }
    add_history_format_arguments(&mut args, show_checkpoints);
    add_history_ref_arguments(&mut args, show_checkpoints);
    read_commits_with_arguments(path, &args)
}

fn read_commits_from_revisions(
    path: &Path,
    limit: usize,
    revisions: &[String],
    show_checkpoints: bool,
) -> Result<Vec<CommitSummary>, AppError> {
    if limit == 0 || revisions.is_empty() {
        return Ok(Vec::new());
    }
    let count = format!("-{limit}");
    let mut args = vec!["log", count.as_str()];
    add_history_format_arguments(&mut args, show_checkpoints);
    args.extend(revisions.iter().map(String::as_str));
    read_commits_with_arguments(path, &args)
}

fn read_commits_with_arguments(path: &Path, args: &[&str]) -> Result<Vec<CommitSummary>, AppError> {
    let mut arguments = args.to_vec();
    // These are log commands, not human-readable displays. Repository settings
    // must not inject notes, signature output, colors, or encoded NUL bytes into
    // the framed UTF-8 stream.
    arguments.splice(
        1..1,
        [
            "--encoding=UTF-8",
            "--no-notes",
            "--no-show-signature",
            "--no-color",
        ],
    );
    let output = run_git(path, &arguments)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not have any commits yet")
            || stderr.contains("your current branch")
        {
            return Ok(Vec::new());
        }
        ensure_success("read commit history", &output)?;
    }
    let mut commits = parse_history_records(&output.stdout)?;
    let mut full_names = args.contains(&"--decorate=full");
    // A branch can shorten to the exact spelling of a checkpoint ref.
    if !full_names
        && commits.iter().any(|commit| {
            commit.decorations.iter().any(|decoration| {
                decoration
                    .strip_prefix("HEAD -> ")
                    .unwrap_or(decoration)
                    .starts_with(CHECKPOINT_REF_PREFIX)
            })
        })
    {
        let full_arguments = arguments
            .iter()
            .map(|arg| {
                if *arg == "--decorate=short" {
                    "--decorate=full"
                } else {
                    *arg
                }
            })
            .collect::<Vec<_>>();
        let full = run_git(path, &full_arguments)?;
        ensure_success("read unambiguous commit references", &full)?;
        commits = parse_history_records(&full.stdout)?;
        full_names = true;
    }
    if full_names {
        for commit in &mut commits {
            for decoration in &mut commit.decorations {
                if let Some(name) = decoration.strip_prefix("tag: refs/tags/") {
                    *decoration = format!("tag: {name}");
                }
            }
        }
    }
    Ok(commits)
}

fn decode_nul_record<'a, const N: usize>(bytes: &mut &'a [u8]) -> Option<[&'a [u8]; N]> {
    let mut fields = [&[][..]; N];
    for field in &mut fields {
        let remaining = *bytes;
        let end = remaining.iter().position(|byte| *byte == 0)?;
        *field = &remaining[..end];
        *bytes = &remaining[end + 1..];
    }
    *bytes = bytes.strip_prefix(b"\n")?;
    Some(fields)
}

fn parse_history_records(mut bytes: &[u8]) -> Result<Vec<CommitSummary>, AppError> {
    let invalid = || {
        AppError::new(
            "invalidHistoryOutput",
            "Git returned incomplete or invalid commit history records.",
            Some(
                "History was not replaced with partial results. Check repository integrity, then refresh history.",
            ),
        )
    };
    let valid_oid = |oid: &str| {
        matches!(oid.len(), 40 | 64) && oid.as_bytes().iter().all(u8::is_ascii_hexdigit)
    };
    let mut commits = Vec::new();
    let mut seen = HashSet::new();
    while !bytes.is_empty() {
        let fields = decode_nul_record::<8>(&mut bytes)
            .ok_or_else(invalid)?
            .map(String::from_utf8_lossy);
        let oid = fields[0].as_ref();
        let parents = fields[1]
            .split_ascii_whitespace()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if !valid_oid(oid)
            || !seen.insert(oid.to_owned())
            || parents.iter().any(|oid| !valid_oid(oid))
        {
            return Err(invalid());
        }
        commits.push(CommitSummary {
            oid: oid.to_owned(),
            parents,
            author_name: fields[2].to_string(),
            author_email: fields[3].to_string(),
            authored_at: fields[4].to_string(),
            subject: fields[5].to_string(),
            description: fields[6].trim().to_owned(),
            decorations: fields[7]
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect(),
        });
    }
    Ok(commits)
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

fn conflict_stage_index_entry(
    entries: &[u8],
    stage: u8,
) -> Result<Option<(String, String)>, AppError> {
    let expected_stage = stage.to_string();
    for record in entries
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let header = record
            .split(|byte| *byte == b'\t')
            .next()
            .unwrap_or_default();
        let fields = header.split(|byte| *byte == b' ').collect::<Vec<_>>();
        if fields.len() != 3 {
            return Err(AppError::new(
                "invalidConflictIndex",
                "Git returned an invalid conflict index entry.",
                None,
            ));
        }
        if fields[2] != expected_stage.as_bytes() {
            continue;
        }
        let mode = std::str::from_utf8(fields[0]).map_err(|_| {
            AppError::new(
                "invalidConflictIndex",
                "Git returned an invalid conflict file mode.",
                None,
            )
        })?;
        let oid = std::str::from_utf8(fields[1]).map_err(|_| {
            AppError::new(
                "invalidConflictIndex",
                "Git returned an invalid conflict object.",
                None,
            )
        })?;
        return Ok(Some((mode.to_owned(), oid.to_owned())));
    }
    Ok(None)
}

fn read_conflict_stage(path: &Path, file: &str, stage: u8) -> Result<Option<Vec<u8>>, AppError> {
    let entries = run_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--unmerged",
            "-z",
            "--",
            file,
        ],
    )?;
    ensure_success("read conflict stage entries", &entries)?;
    if let Some((mode, oid)) = conflict_stage_index_entry(&entries.stdout, stage)? {
        if mode == "160000" {
            return Ok(Some(format!("Submodule commit {oid}\n").into_bytes()));
        }
        let (output, truncated) =
            run_git_with_stdout_limit(path, &["cat-file", "blob", &oid], MAX_FILE_DIFF_BYTES + 1)?;
        if !truncated {
            ensure_success("read conflict object contents", &output)?;
        }
        return Ok(Some(output.stdout));
    }
    Ok(None)
}

fn run_rebase_control(path: &Path, action: &str, operation: &str) -> Result<(), AppError> {
    if !rebase_in_progress(path)? {
        return Err(AppError::new(
            "noRebaseInProgress",
            "There is no interactive rebase in progress.",
            None,
        ));
    }
    if action == "--continue" {
        let status = read_status(path)?;
        rebase_split::require_continue(&status)?;
        if status.rebase_edit_stopped && (status.staged > 0 || status.unstaged > 0) {
            return Err(AppError::new(
                "rebaseEditNeedsAmend",
                "The Edit stop still has uncommitted changes.",
                Some(
                    "Stage and explicitly amend or commit the reviewed changes before Continue. Continue unchanged is available when tracked files are clean.",
                ),
            ));
        }
    }
    if action == "--skip" && read_status(path)?.rebase_split.is_some() {
        return Err(AppError::new(
            "rebaseSplitIncomplete",
            "Skip is unavailable during a guided split.",
            Some(
                "Complete and explicitly commit the split parts, then Continue; or Abort the entire rebase.",
            ),
        ));
    }
    let output = git_in(path)
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
        if !rebase_in_progress(path)? {
            cleanup_rebase_support(path);
        }
        return Ok(());
    }
    if rebase_in_progress(path).unwrap_or(false) {
        let mut error = AppError::git_failure(operation, &output);
        if error.hint.as_deref() == Some(git_failure_hints::GENERIC_HINT) {
            error.kind = "rebaseConflict".into();
            error.hint = Some(
                "Resolve conflicted files, stage them, then Continue; or choose Skip or Abort."
                    .into(),
            );
        }
        Err(error)
    } else {
        cleanup_rebase_support(path);
        Err(AppError::git_failure(operation, &output))
    }
}

struct RepositoryOperationState {
    merge: bool,
    history: Option<String>,
    history_no_commit: bool,
    revert_head_present: bool,
    rebase: bool,
    rebase_edit: bool,
    rebase_split: Option<RebaseSplitStatus>,
    mail_patch: bool,
    bisect: bool,
}

fn repository_operation_state(path: &Path) -> Result<RepositoryOperationState, AppError> {
    let output = run_git(path, &["rev-parse", "--absolute-git-dir"])?;
    ensure_success("inspect repository operation state", &output)?;
    let value = std::str::from_utf8(&output.stdout).map_err(|_| {
        AppError::new(
            "invalidGitDirectory",
            "Git returned an unsupported repository metadata path.",
            None,
        )
    })?;
    let directory = Path::new(value.strip_suffix('\n').unwrap_or(value));
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(AppError::new(
            "invalidGitDirectory",
            "Git returned an invalid repository metadata directory.",
            None,
        ));
    }
    let history_no_commit =
        no_commit_replay::active(&directory.join("git-khronos-no-commit.json"))?;
    let sequence = if history_no_commit {
        None
    } else {
        native_history_sequence(directory)?
    };
    let rebase_edit =
        directory.join("rebase-merge").is_dir() && directory.join("rebase-merge/amend").is_file();
    Ok(RepositoryOperationState {
        merge: directory.join("MERGE_HEAD").is_file(),
        history: if history_no_commit || directory.join("CHERRY_PICK_HEAD").is_file() {
            Some("cherry-pick".into())
        } else if directory.join("REVERT_HEAD").is_file() {
            Some("revert".into())
        } else {
            sequence
        },
        history_no_commit,
        revert_head_present: directory.join("REVERT_HEAD").is_file(),
        rebase: directory.join("rebase-merge").is_dir(),
        rebase_edit,
        rebase_split: rebase_split::inspect(
            path,
            directory,
            directory.join("rebase-merge").is_dir(),
            rebase_edit,
        )?,
        mail_patch: directory.join("rebase-apply/applying").is_file(),
        bisect: directory.join("BISECT_START").is_file(),
    })
}

fn native_history_sequence(directory: &Path) -> Result<Option<String>, AppError> {
    if !directory.join("sequencer").exists() {
        return Ok(None);
    }
    let mut prefix = Vec::new();
    fs::File::open(directory.join("sequencer/todo"))
        .and_then(|file| file.take(7).read_to_end(&mut prefix))
        .map_err(|error| {
            AppError::new(
                "invalidHistorySequence",
                format!("Could not inspect the active Git sequence: {error}"),
                Some("Inspect Git's sequencer state and preserve current changes before manual recovery."),
            )
        })?;
    if prefix.starts_with(b"revert ") {
        Ok(Some("revert".into()))
    } else if prefix.starts_with(b"pick ") {
        Ok(Some("cherry-pick".into()))
    } else {
        Err(AppError::new(
            "invalidHistorySequence",
            "The active Git sequence does not identify a supported replay operation.",
            Some(
                "Inspect Git's sequencer state and preserve current changes before manual recovery.",
            ),
        ))
    }
}

fn rebase_in_progress(path: &Path) -> Result<bool, AppError> {
    Ok(repository_operation_state(path)?.rebase)
}

fn rebase_support_dir(path: &Path) -> Result<PathBuf, AppError> {
    let directory = operation_storage::git_entry(path, "git-khronos-rebase")?;
    operation_storage::directory(&directory)?;
    Ok(directory)
}

fn cleanup_rebase_support(path: &Path) {
    if let Ok(directory) = rebase_support_dir(path) {
        let _ = fs::remove_dir_all(directory);
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Bare repositories the user explicitly opened. Git's `safe.bareRepository`
/// may refuse implicit discovery, so these get an explicit `GIT_DIR`.
static EXPLICIT_BARE_REPOSITORIES: std::sync::Mutex<Vec<PathBuf>> =
    std::sync::Mutex::new(Vec::new());

fn remember_explicit_bare_repository(path: &Path) {
    if let Ok(mut paths) = EXPLICIT_BARE_REPOSITORIES.lock()
        && !paths.iter().any(|known| known == path)
    {
        paths.push(path.to_path_buf());
    }
}

/// Reports whether `path` is a bare repository opened through [`resolve_repository`].
pub fn is_explicit_bare_repository(path: &Path) -> bool {
    EXPLICIT_BARE_REPOSITORIES
        .lock()
        .is_ok_and(|paths| paths.iter().any(|known| known == path))
}

/// Inherited shell overrides that must not replace a UI-selected Git context.
pub const GIT_CONTEXT_ENVIRONMENT_VARIABLES: [&str; 8] = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_LITERAL_PATHSPECS",
    "GIT_GLOB_PATHSPECS",
    "GIT_NOGLOB_PATHSPECS",
    "GIT_ICASE_PATHSPECS",
];

/// Starts a Git command scoped to `path`, the only way repository commands are spawned.
pub(crate) fn git_in(path: &Path) -> Command {
    let mut command = Command::new("git");
    if no_lazy_fetch::enabled() {
        command.arg("--no-lazy-fetch");
    }
    command.arg("-C").arg(path);
    // UI commands choose their repository and exact paths explicitly. Shell
    // overrides must not redirect its index/worktree or reinterpret path magic.
    // Internal callers can still set a scoped alternate index after this step.
    for variable in GIT_CONTEXT_ENVIRONMENT_VARIABLES {
        command.env_remove(variable);
    }
    // Unit fixtures configure their own repositories. Host signing settings,
    // hooks and LFS filters must not change their inputs or execute user hooks.
    // Keep normal application commands governed by the user's Git settings.
    #[cfg(test)]
    command.env("GIT_CONFIG_NOSYSTEM", "1").env(
        "GIT_CONFIG_GLOBAL",
        concat!(env!("CARGO_MANIFEST_DIR"), "/test-support/gitconfig"),
    );
    if is_explicit_bare_repository(path) {
        command.env("GIT_DIR", path);
    }
    command
}

fn run_git(path: &Path, args: &[&str]) -> Result<Output, AppError> {
    if authentication::is_transport(args) {
        return run_transport(path, args, None, None);
    }
    run_git_with_environment(path, args, &[])
}

fn run_git_with_environment(
    path: &Path,
    args: &[&str],
    environment: &[(&str, &str)],
) -> Result<Output, AppError> {
    let mut command = git_in(path);
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .envs(environment.iter().copied());
    if let Some(cancellation) = git_cancellation::current() {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_tree(&mut command);
        return run_cancellable_command(command, &cancellation);
    }
    command.output().map_err(|error| {
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
    if authentication::is_transport(args) {
        return run_transport(path, args, cancellation, None);
    }
    let Some(cancellation) = cancellation else {
        return run_git(path, args);
    };
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }

    let mut command = git_in(path);
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    run_cancellable_command(command, cancellation)
}

fn run_transport(
    path: &Path,
    args: &[&str],
    cancellation: Option<&CancellationToken>,
    clone_url: Option<(&str, &Path)>,
) -> Result<Output, AppError> {
    run_transport_with_stdout_limit(path, args, cancellation, clone_url, None)
        .map(|(output, _)| output)
}

fn run_transport_with_stdout_limit(
    path: &Path,
    args: &[&str],
    cancellation: Option<&CancellationToken>,
    clone_url: Option<(&str, &Path)>,
    stdout_limit: Option<usize>,
) -> Result<(Output, bool), AppError> {
    authentication::validate_arguments(args)?;
    let mut command = git_in(path);
    command.arg("-c").arg(if authentication::interactive() {
        "credential.interactive=true"
    } else {
        "credential.interactive=false"
    });
    // Git sees configuration copied by clone templates only after preflight.
    // Enforce its password-in-URL refusal at the actual transport boundary too.
    command.args(["-c", "transfer.credentialsInUrl=die"]);
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let scoped_cancellation = authentication::configure(&mut command);
    configure_process_tree(&mut command);
    let fallback = CancellationToken::default();
    let cancellation = cancellation
        .or(scoped_cancellation.as_ref())
        .unwrap_or(&fallback);
    if let Some((remote, destination)) = clone_url {
        authentication::validate_clone_url(remote, destination, cancellation)?;
    } else {
        authentication::validate_repository_urls(path, args, cancellation)?;
    }
    let CapturedCommand {
        output,
        truncated,
        diagnostics,
    } = capture_cancellable_command(
        command,
        cancellation,
        stdout_limit,
        StderrCapture::Transport,
    )?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    // A size refusal terminates the owned process group deliberately. Let the
    // caller report its inspection limit instead of classifying that termination
    // as an authentication or network failure.
    if truncated {
        Ok((output, true))
    } else {
        let facts = diagnostics.expect("transport capture always collects diagnostic facts");
        authentication::check_output_with_facts(output, args, facts).map(|output| (output, false))
    }
}

fn run_cancellable_command(
    command: Command,
    cancellation: &CancellationToken,
) -> Result<Output, AppError> {
    run_cancellable_command_with_stdout_limit(command, cancellation, None).map(|(output, _)| output)
}

fn run_cancellable_command_with_stdout_limit(
    command: Command,
    cancellation: &CancellationToken,
    stdout_limit: Option<usize>,
) -> Result<(Output, bool), AppError> {
    capture_cancellable_command(command, cancellation, stdout_limit, StderrCapture::Complete)
        .map(|capture| (capture.output, capture.truncated))
}

enum StderrCapture {
    Complete,
    Transport,
}

struct CapturedCommand {
    output: Output,
    truncated: bool,
    diagnostics: Option<authentication::diagnostics::DiagnosticFacts>,
}

fn capture_cancellable_command(
    mut command: Command,
    cancellation: &CancellationToken,
    stdout_limit: Option<usize>,
    stderr_capture: StderrCapture,
) -> Result<CapturedCommand, AppError> {
    let scoped = git_cancellation::current();
    let deadline = git_cancellation::deadline();
    let timed_out = || deadline.is_some_and(|deadline| std::time::Instant::now() >= deadline);
    let cancelled = || {
        cancellation.is_cancelled()
            || scoped.as_ref().is_some_and(CancellationToken::is_cancelled)
            || timed_out()
    };
    let cancellation_error = || {
        if timed_out() {
            AppError::new(
                "gitInspectionTimeout",
                "Git state inspection exceeded its time limit.",
                Some("The action may already have applied. Inspect current state before retrying."),
            )
        } else {
            operation_cancelled()
        }
    };
    if cancelled() {
        return Err(cancellation_error());
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
    let stop_readers = Arc::new(AtomicBool::new(false));
    #[cfg(unix)]
    let stdout =
        process_pipe::InterruptiblePipe::new(stdout, stop_readers.clone()).map_err(|error| {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            AppError::new(
                "gitOutputUnavailable",
                format!("Could not prepare Git output: {error}"),
                None,
            )
        })?;
    #[cfg(unix)]
    let stderr =
        process_pipe::InterruptiblePipe::new(stderr, stop_readers.clone()).map_err(|error| {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            AppError::new(
                "gitOutputUnavailable",
                format!("Could not prepare Git errors: {error}"),
                None,
            )
        })?;
    let truncated = Arc::new(AtomicBool::new(false));
    let reader_truncated = truncated.clone();
    let stdout_reader = thread::spawn(move || {
        let mut output = Vec::new();
        stdout
            .take(stdout_limit.map_or(u64::MAX, |limit| limit.saturating_add(1) as u64))
            .read_to_end(&mut output)
            .map(|_| {
                if let Some(limit) = stdout_limit
                    && output.len() > limit
                {
                    output.truncate(limit);
                    reader_truncated.store(true, Ordering::Release);
                }
                output
            })
    });
    let stderr_reader = thread::spawn(move || match stderr_capture {
        StderrCapture::Complete => {
            let mut output = Vec::new();
            let mut stderr = stderr;
            stderr.read_to_end(&mut output).map(|_| (output, None))
        }
        StderrCapture::Transport => authentication::diagnostics::read_transport_stderr(stderr)
            .map(|capture| (capture.retained, Some(capture.diagnostics))),
    });

    let mut parent_status = None;
    let mut limit_terminated = false;
    let status = loop {
        if truncated.load(Ordering::Acquire) && !limit_terminated {
            stop_readers.store(true, Ordering::Release);
            terminate_process_tree(&mut child);
            limit_terminated = true;
        }
        if parent_status.is_none() {
            match child.try_wait() {
                Ok(status) => parent_status = status,
                Err(error) => {
                    stop_readers.store(true, Ordering::Release);
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
        }
        if cancelled() {
            stop_readers.store(true, Ordering::Release);
            terminate_process_tree(&mut child);
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(cancellation_error());
        }
        // A descendant may still own a pipe after Git exits. Keep cancellation
        // active until both readers finish instead of blocking in their joins.
        if let Some(status) = parent_status
            && stdout_reader.is_finished()
            && stderr_reader.is_finished()
        {
            break status;
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
    let (stderr, diagnostics) = stderr_reader
        .join()
        .map_err(|_| AppError::new("gitOutputFailed", "Could not collect Git errors.", None))?
        .map_err(|error| {
            AppError::new(
                "gitOutputFailed",
                format!("Could not read Git errors: {error}"),
                None,
            )
        })?;
    Ok(CapturedCommand {
        output: Output {
            status,
            stdout,
            stderr,
        },
        truncated: truncated.load(Ordering::Acquire),
        diagnostics,
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
    // These commands inspect local LFS metadata. In particular, `lfs env`
    // fingerprints effective settings before and inside an authenticated action;
    // transport-only configuration would make an unchanged review look stale.
    let local_lfs_metadata = matches!(args, ["lfs", "env" | "ls-files", ..]);
    if authentication::is_transport(args) && !local_lfs_metadata {
        return run_transport_with_stdout_limit(path, args, None, None, Some(limit));
    }
    let mut command = git_in(path);
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    run_cancellable_command_with_stdout_limit(command, &CancellationToken::default(), Some(limit))
}

fn run_git_with_input(
    path: &Path,
    args: &[&str],
    input: &[u8],
    operation: &str,
) -> Result<(), AppError> {
    ensure_success(operation, &run_git_with_input_output(path, args, input)?)
}

fn run_git_with_input_output(path: &Path, args: &[&str], input: &[u8]) -> Result<Output, AppError> {
    run_git_with_input_environment(path, args, input, &[])
}

fn run_git_with_input_environment(
    path: &Path,
    args: &[&str],
    input: &[u8],
    environment: &[(&str, &std::ffi::OsStr)],
) -> Result<Output, AppError> {
    if let Some(cancellation) = git_cancellation::current() {
        let mut command = git_in(path);
        command
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .envs(environment.iter().copied());
        return git_cancellation::run_input(command, input, &cancellation);
    }
    let mut child = git_in(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .envs(environment.iter().copied())
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
    let Some(mut input_pipe) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(AppError::new(
            "gitInputUnavailable",
            "Could not send input to Git.",
            None,
        ));
    };
    thread::scope(|scope| {
        // Drain output while sending input: commands that respond per input
        // record can otherwise fill stdout and deadlock against a full stdin.
        let writer = scope.spawn(move || input_pipe.write_all(input));
        let output = child.wait_with_output().map_err(|error| {
            AppError::new(
                "gitWaitFailed",
                format!("Could not finish the Git operation: {error}"),
                None,
            )
        })?;
        let sent = writer.join();
        if !output.status.success() {
            // Preserve Git's diagnostic when it closes stdin early. The child
            // has been reaped and callers still inspect its exit status.
            return Ok(output);
        }
        sent.map_err(|_| {
            AppError::new(
                "gitInputFailed",
                "Could not finish sending input to Git.",
                None,
            )
        })?
        .map_err(|error| {
            AppError::new(
                "gitInputFailed",
                format!("Could not send input to Git: {error}"),
                None,
            )
        })?;
        Ok(output)
    })
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
                "git-khronos-test-{}-{}",
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
    fn counts_lfs_pointer_files() {
        let output = "4d7a2146 * assets/logo.png\n\
                      9f86d081 - assets/video file.mp4\n\
                      \n\
                      2c26b46b - docs/manual.pdf\n";
        assert_eq!(count_lfs_files(output), (3, 2));
        assert_eq!(count_lfs_files(""), (0, 0));
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
    fn bounded_command_preserves_complete_bytes_and_original_exit_status() {
        for limit in [3, 10] {
            let mut command = Command::new("sh");
            command
                .args(["-c", "printf abc; printf diagnostic >&2; exit 7"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            configure_process_tree(&mut command);
            let (output, truncated) = run_cancellable_command_with_stdout_limit(
                command,
                &CancellationToken::default(),
                Some(limit),
            )
            .unwrap();
            assert!(!truncated);
            assert_eq!(output.status.code(), Some(7));
            assert_eq!(output.stdout, b"abc");
            assert_eq!(output.stderr, b"diagnostic");
        }
    }

    #[cfg(unix)]
    #[test]
    fn bounded_command_limit_stops_descendants_holding_error_pipes() {
        for limit in [0, 3] {
            let mut command = Command::new("sh");
            command
                .args(["-c", "sleep 20 & printf abcdef; wait"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            configure_process_tree(&mut command);
            let cancellation = CancellationToken::default();
            let worker_cancellation = cancellation.clone();
            let (sender, receiver) = std::sync::mpsc::channel();
            thread::spawn(move || {
                let _ = sender.send(run_cancellable_command_with_stdout_limit(
                    command,
                    &worker_cancellation,
                    Some(limit),
                ));
            });
            let result = receiver.recv_timeout(Duration::from_secs(2));
            if result.is_err() {
                cancellation.cancel();
                let _ = receiver.recv_timeout(Duration::from_secs(2));
            }
            let (output, truncated) = result
                .expect("the size refusal must stop inherited pipe holders promptly")
                .unwrap();
            assert!(truncated);
            assert_eq!(output.stdout, &b"abcdef"[..limit]);
        }
    }

    #[cfg(unix)]
    #[test]
    fn bounded_command_remains_cancellable_after_parent_exit() {
        let repository = TestRepository::new();
        let marker = repository.path.join("bounded-child-started");
        let mut command = Command::new("sh");
        command
            .args(["-c", "sleep 20 & echo started > \"$1\"; exit 0", "git-test"])
            .arg(&marker)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_tree(&mut command);
        let cancellation = CancellationToken::default();
        let worker_cancellation = cancellation.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let _ = sender.send(run_cancellable_command_with_stdout_limit(
                command,
                &worker_cancellation,
                Some(1024),
            ));
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !marker.exists() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        cancellation.cancel();
        let error = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("bounded capture must remain cancellable while descendants hold pipes")
            .unwrap_err();
        assert_eq!(error.kind, "operationCancelled");
        assert!(marker.exists());
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
        assert!(version_at_least("2.39.0.windows.1", MINIMUM_GIT_VERSION));
        assert!(!version_at_least("2.38.9", MINIMUM_GIT_VERSION));
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
    fn checkpoint_refs_do_not_enter_commit_history() {
        let repository = TestRepository::new();
        for index in 1..=3 {
            repository.write("history.txt", &format!("revision {index}\n"));
            repository.git(&["add", "history.txt"]);
            let date = format!("2020-01-01T00:0{index}:00+0000");
            let output = Command::new("git")
                .arg("-C")
                .arg(&repository.path)
                .args(["commit", "-m", &format!("Revision {index}")])
                .env("GIT_AUTHOR_DATE", &date)
                .env("GIT_COMMITTER_DATE", &date)
                .output()
                .expect("create dated history commit");
            ensure_success("create dated history commit", &output).expect("commit created");
        }
        let checkpoint = run_git(
            &repository.path,
            &[
                "commit-tree",
                "HEAD^{tree}",
                "-p",
                "HEAD",
                "-m",
                "copilot checkpoint: private",
            ],
        )
        .expect("create checkpoint-only commit");
        ensure_success("create checkpoint-only commit", &checkpoint).expect("commit created");
        let checkpoint_oid = String::from_utf8(checkpoint.stdout).expect("checkpoint oid");
        let checkpoint_oid = checkpoint_oid.trim();
        let private_ref = "refs/copilot/checkpoints/session/00000000000000000001/checkpoint";
        let shared_ref = "refs/copilot/checkpoints/session/00000000000000000002/checkpoint";
        repository.git(&["update-ref", private_ref, checkpoint_oid]);
        repository.git(&["update-ref", shared_ref, "HEAD"]);
        repository.git(&["update-ref", "refs/custom/marker", "HEAD~1"]);
        repository.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
        repository.git(&["tag", "-a", "v1", "-m", "Release", "HEAD~1"]);

        let expected = vec!["Revision 3", "Revision 2", "Revision 1"];
        let check = |commits: &[CommitSummary]| {
            assert_eq!(
                commits
                    .iter()
                    .map(|commit| commit.subject.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
            assert!(commits.iter().all(|commit| commit.oid != checkpoint_oid));
            assert!(
                commits
                    .iter()
                    .flat_map(|commit| &commit.decorations)
                    .all(|decoration| !decoration.starts_with("refs/copilot/checkpoints/"))
            );
            let decorations = commits
                .iter()
                .flat_map(|commit| &commit.decorations)
                .collect::<Vec<_>>();
            for reference in [
                "HEAD -> main",
                "origin/main",
                "tag: v1",
                "refs/custom/marker",
            ] {
                assert!(
                    decorations
                        .iter()
                        .any(|decoration| *decoration == reference)
                );
            }
        };

        for packed in [false, true] {
            if packed {
                repository.git(&["pack-refs", "--all", "--prune"]);
            }
            for data in [
                snapshot_with_commit_limit(&repository.path, 3),
                snapshot_with_limits_fast(&repository.path, 3, 100),
                snapshot_with_limits_startup(&repository.path, 3, 100),
            ] {
                let data = data.expect("read snapshot without checkpoints");
                check(&data.commits);
                assert!(!data.history_truncated);
            }
            let initial = read_commits(&repository.path, 1).expect("read first history row");
            let page = commit_history_page(&repository.path, 1, 2).expect("read remaining history");
            assert!(!page.history_truncated);
            let mut paged = initial.clone();
            paged.extend(page.commits);
            check(&paged);

            for initial_count in [0, 1] {
                for use_git in [false, true] {
                    let mut cursor = CommitHistoryCursor::default();
                    cursor
                        .reset(&repository.path, &initial[..initial_count])
                        .expect("reset incremental history");
                    if use_git {
                        cursor.walk = None;
                        cursor
                            .reset_git_frontier(&repository.path, &initial[..initial_count])
                            .expect("prepare Git fallback history");
                    }
                    let mut commits = initial[..initial_count].to_vec();
                    loop {
                        let page = cursor
                            .next_page(&repository.path, 1)
                            .expect("read incremental page");
                        commits.extend(page.commits);
                        if !page.history_truncated {
                            break;
                        }
                    }
                    check(&commits);
                }
            }
            let shown_initial = read_commits_with_checkpoint_visibility(&repository.path, 1, true)
                .expect("read checkpoints when enabled");
            assert_eq!(shown_initial[0].oid, checkpoint_oid);
            for data in [
                snapshot_with_limits_fast_and_checkpoint_visibility(&repository.path, 4, 100, true),
                snapshot_with_limits_startup_and_checkpoint_visibility(
                    &repository.path,
                    4,
                    100,
                    true,
                ),
            ] {
                let data = data.expect("read snapshot with checkpoints");
                assert_eq!(data.commits.len(), 4);
                assert!(!data.history_truncated);
                assert!(data.commits.iter().any(|commit| {
                    commit.oid == checkpoint_oid
                        && commit
                            .decorations
                            .iter()
                            .any(|refname| refname == private_ref)
                }));
                assert!(data.commits.iter().any(|commit| {
                    commit.subject == "Revision 3"
                        && commit
                            .decorations
                            .iter()
                            .any(|refname| refname == shared_ref)
                }));
            }
            for use_git in [false, true] {
                let mut cursor = CommitHistoryCursor::default();
                cursor
                    .reset_with_checkpoint_visibility(&repository.path, &shown_initial, true)
                    .expect("enable checkpoints in incremental history");
                if use_git {
                    cursor.walk = None;
                    cursor
                        .reset_git_frontier(&repository.path, &shown_initial)
                        .expect("prepare enabled Git fallback history");
                }
                let mut commits = shown_initial.clone();
                loop {
                    let page = cursor
                        .next_page(&repository.path, 1)
                        .expect("read visible history");
                    commits.extend(page.commits);
                    if !page.history_truncated {
                        break;
                    }
                }
                assert_eq!(commits.len(), 4);
                assert!(commits.iter().any(|commit| {
                    commit.subject == "Revision 3"
                        && commit
                            .decorations
                            .iter()
                            .any(|refname| refname == shared_ref)
                }));
                cursor
                    .reset(&repository.path, &initial)
                    .expect("hide checkpoints again");
                let page = cursor
                    .next_page(&repository.path, 10)
                    .expect("read hidden history");
                let mut commits = initial.clone();
                commits.extend(page.commits);
                check(&commits);
            }
            // Hidden recovery refs and their objects must remain intact.
            repository.git(&["rev-parse", "--verify", private_ref]);
        }

        repository.git(&["branch", "recovered-work", checkpoint_oid]);
        let recovered = read_commits(&repository.path, 10).expect("read recovered checkpoint");
        let recovered = recovered
            .iter()
            .find(|commit| commit.oid == checkpoint_oid)
            .expect("branch-reachable checkpoint commit stays visible");
        assert_eq!(recovered.subject, "copilot checkpoint: private");
        assert_eq!(recovered.decorations, vec!["recovered-work"]);
    }

    #[test]
    fn checkpoint_names_do_not_alias_local_or_remote_branches() {
        let repository = TestRepository::new();
        repository.write("history.txt", "root\n");
        repository.git(&["add", "history.txt"]);
        repository.git(&["commit", "-m", "Root"]);

        let checkpoint = "refs/copilot/checkpoints/session/one";
        let local = format!("refs/heads/{checkpoint}");
        let remote = format!("refs/remotes/{checkpoint}");
        repository.git(&["branch", checkpoint, "HEAD"]);
        repository.git(&["update-ref", &remote, "HEAD"]);

        let check = |commits: &[CommitSummary], show_checkpoints: bool| {
            let decorations = &commits
                .iter()
                .find(|commit| commit.subject == "Root")
                .expect("root commit remains visible")
                .decorations;
            assert!(decorations.contains(&local));
            assert!(decorations.contains(&remote));
            assert_eq!(
                decorations
                    .iter()
                    .filter(|name| *name == checkpoint)
                    .count(),
                usize::from(show_checkpoints)
            );
        };
        check(
            &snapshot_with_limits_fast(&repository.path, 10, 100)
                .expect("read branch names without a checkpoint")
                .commits,
            false,
        );

        repository.git(&["update-ref", checkpoint, "HEAD"]);
        for packed in [false, true] {
            if packed {
                repository.git(&["pack-refs", "--all", "--prune"]);
            }
            for show in [false, true] {
                let initial = snapshot_with_limits_fast_and_checkpoint_visibility(
                    &repository.path,
                    10,
                    100,
                    show,
                )
                .expect("read unambiguous checkpoint history");
                check(&initial.commits, show);
                for use_git in [false, true] {
                    let mut cursor = CommitHistoryCursor::default();
                    cursor
                        .reset_with_checkpoint_visibility(&repository.path, &[], show)
                        .expect("prepare unambiguous incremental history");
                    if use_git {
                        cursor.walk = None;
                        cursor
                            .reset_git_frontier(&repository.path, &[])
                            .expect("prepare unambiguous Git fallback history");
                    }
                    let page = cursor
                        .next_page(&repository.path, 10)
                        .expect("read unambiguous history page");
                    check(&page.commits, show);
                }
            }
        }

        repository.git(&["symbolic-ref", "HEAD", &local]);
        let current = snapshot_with_limits_fast(&repository.path, 10, 100)
            .expect("read an ambiguous current branch");
        assert!(
            current.commits[0]
                .decorations
                .contains(&format!("HEAD -> {local}"))
        );
        assert!(!current.commits[0].decorations.contains(&checkpoint.into()));
    }

    #[test]
    fn deletes_only_reviewed_checkpoint_refs_with_an_exact_lease() {
        let repository = TestRepository::new();
        repository.write("history.txt", "root\n");
        repository.git(&["add", "history.txt"]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("history.txt", "next\n");
        repository.git(&["commit", "-am", "Next"]);
        let oid = |revision: &str| {
            let output = run_git(&repository.path, &["rev-parse", revision]).expect("read oid");
            ensure_success("read oid", &output).expect("oid exists");
            String::from_utf8(output.stdout)
                .expect("oid as text")
                .trim()
                .to_owned()
        };
        let old = oid("HEAD~1");
        let head = oid("HEAD");
        let checkpoint = "refs/copilot/checkpoints/session/one";
        let sibling = "refs/copilot/checkpoints/session/two";
        repository.git(&["update-ref", checkpoint, &old]);
        repository.git(&["update-ref", sibling, &head]);

        assert_eq!(
            delete_checkpoint_reference(&repository.path, "refs/heads/main", &head)
                .expect_err("cannot delete a branch as a checkpoint")
                .kind,
            "invalidCheckpointReference"
        );
        assert_eq!(
            delete_checkpoint_reference(
                &repository.path,
                "refs/copilot/checkpoints/../main",
                &head
            )
            .expect_err("reject invalid checkpoint names")
            .kind,
            "invalidCheckpointReference"
        );
        assert_eq!(
            delete_checkpoint_reference(&repository.path, checkpoint, &"0".repeat(40))
                .expect_err("reject an empty lease")
                .kind,
            "invalidCommit"
        );
        assert_eq!(
            delete_checkpoint_reference(&repository.path, checkpoint, &head)
                .expect_err("reject a moved checkpoint")
                .kind,
            "checkpointChanged"
        );
        assert_eq!(oid(checkpoint), old);
        assert_eq!(oid("refs/heads/main"), head);

        repository.git(&["pack-refs", "--all", "--prune"]);
        delete_checkpoint_reference(&repository.path, checkpoint, &old)
            .expect("delete the reviewed packed checkpoint");
        assert_eq!(
            delete_checkpoint_reference(&repository.path, checkpoint, &old)
                .expect_err("a missing checkpoint is not a successful deletion")
                .kind,
            "checkpointChanged"
        );
        assert_eq!(oid(sibling), head);
        assert_eq!(oid("refs/heads/main"), head);
        repository.git(&["cat-file", "-e", &old]);

        let loose = "refs/copilot/checkpoints/session/loose";
        repository.git(&["update-ref", loose, &head]);
        delete_checkpoint_reference(&repository.path, loose, &head)
            .expect("delete the reviewed loose checkpoint");
        assert_eq!(oid(sibling), head);

        let symbolic = "refs/copilot/checkpoints/session/symbolic";
        repository.git(&["symbolic-ref", symbolic, "refs/heads/main"]);
        delete_checkpoint_reference(&repository.path, symbolic, &head)
            .expect("delete the checkpoint symbolic ref without dereferencing it");
        let missing = run_git(
            &repository.path,
            &["show-ref", "--verify", "--quiet", symbolic],
        )
        .expect("check deleted symbolic ref");
        assert!(!missing.status.success());
        assert_eq!(oid("refs/heads/main"), head);
        assert_eq!(oid(sibling), head);
    }

    #[test]
    fn deletes_reviewed_checkpoint_in_sha256_repository() {
        let parent = TestRepository::new();
        let path = parent.path.join("sha256");
        fs::create_dir(&path).expect("create SHA-256 fixture directory");
        let repository = TestRepository { path };
        repository.git(&["init", "--object-format=sha256", "-b", "main"]);
        repository.git(&["config", "user.name", "Chronos Tester"]);
        repository.git(&["config", "user.email", "chronos@example.test"]);
        repository.write("history.txt", "root\n");
        repository.git(&["add", "history.txt"]);
        repository.git(&["commit", "-m", "Root"]);
        let output = run_git(&repository.path, &["rev-parse", "HEAD"]).expect("read SHA-256 oid");
        ensure_success("read SHA-256 oid", &output).expect("oid exists");
        let oid = String::from_utf8(output.stdout).expect("oid as text");
        let oid = oid.trim();
        assert_eq!(oid.len(), 64);
        let reference = "refs/copilot/checkpoints/sha256/one";
        repository.git(&["update-ref", reference, oid]);
        delete_checkpoint_reference(&repository.path, reference, oid)
            .expect("delete checkpoint with a SHA-256 lease");
        let missing = run_git(
            &repository.path,
            &["show-ref", "--verify", "--quiet", reference],
        )
        .expect("check deleted checkpoint");
        assert!(!missing.status.success());
        repository.git(&["cat-file", "-e", oid]);
    }

    #[test]
    fn history_cursor_reset_drops_deleted_refs_and_unreachable_commits() {
        let repository = TestRepository::new();
        repository.write("history.txt", "root\n");
        repository.git(&["add", "history.txt"]);
        repository.git(&["commit", "-m", "Root"]);
        repository.git(&["checkout", "-b", "temporary"]);
        repository.write("history.txt", "temporary\n");
        repository.git(&["commit", "-am", "Temporary branch work"]);
        repository.git(&["checkout", "main"]);
        repository.git(&["pack-refs", "--all", "--prune"]);

        let mut cursor = CommitHistoryCursor::default();
        cursor
            .reset(&repository.path, &[])
            .expect("prepare history before deletion");
        repository.git(&["branch", "-D", "temporary"]);
        let initial = read_commits(&repository.path, 1).expect("refresh history after deletion");
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].subject, "Root");
        assert_eq!(initial[0].decorations, vec!["HEAD -> main"]);
        cursor
            .reset(&repository.path, &initial)
            .expect("reset history after deletion");
        let page = cursor
            .next_page(&repository.path, 10)
            .expect("read refreshed cursor");
        assert!(page.commits.is_empty());
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
    fn incremental_history_honors_shallow_boundaries_with_locally_present_parents() {
        let repository = TestRepository::new();
        for index in 1..=4 {
            repository.write("history.txt", &format!("revision {index}\n"));
            repository.git(&["add", "history.txt"]);
            repository.git(&["commit", "-m", &format!("Revision {index}")]);
        }
        let complete = read_commits(&repository.path, 20).unwrap();
        let boundary = &complete[1].oid;
        fs::write(
            repository.path.join(".git/shallow"),
            format!("{boundary}\n"),
        )
        .unwrap();
        repository.git(&["cat-file", "-e", &complete[3].oid]);
        let expected = read_commits(&repository.path, 20).unwrap();
        assert_eq!(expected.len(), 2);
        assert!(expected[1].parents.is_empty());
        let mut cursor = CommitHistoryCursor::default();
        cursor.reset(&repository.path, &expected[..1]).unwrap();
        assert!(
            cursor.walk.is_some(),
            "Shallow history must retain the in-process walk"
        );
        let page = cursor.next_page(&repository.path, 20).unwrap();
        assert_eq!(
            page.commits.len(),
            1,
            "History crossed the shallow boundary"
        );
        assert_eq!(page.commits[0].oid, *boundary);
        assert!(
            page.commits[0].parents.is_empty(),
            "Shallow commit exposed grafted-away parents"
        );
        assert!(!page.history_truncated);
    }

    #[test]
    fn incremental_history_refreshes_shallow_boundaries_in_main_and_linked_worktrees() {
        let repository = TestRepository::new();
        for index in 1..=5 {
            repository.write("history.txt", &format!("revision {index}\n"));
            repository.git(&["add", "history.txt"]);
            repository.git(&["commit", "-m", &format!("Revision {index}")]);
        }
        let complete = read_commits(&repository.path, 20).unwrap();
        let linked = repository.path.join("linked-worktree");
        repository.git(&[
            "worktree",
            "add",
            "--detach",
            linked.to_str().unwrap(),
            "HEAD",
        ]);
        let shallow = repository.path.join(".git/shallow");
        for path in [&repository.path, &linked] {
            let mut cursor = CommitHistoryCursor::default();
            for visible in [1, 2, 4, 5] {
                if visible < 5 {
                    fs::write(&shallow, format!("{}\n", complete[visible - 1].oid)).unwrap();
                } else {
                    fs::remove_file(&shallow).unwrap();
                }
                let expected = read_commits(path, 20).unwrap();
                assert_eq!(expected.len(), visible);
                cursor.reset(path, &expected[..1]).unwrap();
                assert!(
                    cursor.walk.is_some(),
                    "Valid shallow walks must stay in-process"
                );
                let mut actual = expected[..1].to_vec();
                loop {
                    let page = cursor.next_page(path, 1).unwrap();
                    actual.extend(page.commits);
                    if !page.history_truncated {
                        break;
                    }
                    assert!(
                        actual.len() < expected.len(),
                        "Walk did not stop at its boundary"
                    );
                }
                assert_eq!(
                    serde_json::to_value(&actual).unwrap(),
                    serde_json::to_value(&expected).unwrap(),
                    "History differs from Git at depth {visible} in {}",
                    path.display()
                );
            }
        }
    }

    #[test]
    fn incremental_history_refuses_invalid_shallow_metadata_after_refresh() {
        let repository = TestRepository::new();
        for index in 1..=3 {
            repository.write("history.txt", &format!("revision {index}\n"));
            repository.git(&["add", "history.txt"]);
            repository.git(&["commit", "-m", &format!("Revision {index}")]);
        }
        let complete = read_commits(&repository.path, 20).unwrap();
        let initial = &complete[..1];
        let mut cursor = CommitHistoryCursor::default();
        cursor.reset(&repository.path, initial).unwrap();
        assert!(cursor.walk.is_some());
        fs::write(repository.path.join(".git/shallow"), "invalid object id\n").unwrap();
        let error = cursor.reset(&repository.path, initial).unwrap_err();
        assert!(
            cursor.walk.is_none(),
            "Invalid metadata retained a stale walk"
        );
        let page_error = cursor
            .next_page(&repository.path, 20)
            .expect_err("A failed reset was reported as complete history");
        assert_eq!(page_error.message, error.message);
        fs::remove_file(repository.path.join(".git/shallow")).unwrap();
        assert!(cursor.next_page(&repository.path, 20).is_err());
        cursor.reset(&repository.path, initial).unwrap();
        let page = cursor.next_page(&repository.path, 20).unwrap();
        assert_eq!(
            serde_json::to_value(page.commits).unwrap(),
            serde_json::to_value(&complete[1..]).unwrap()
        );
        assert!(!page.history_truncated);
    }

    #[test]
    fn incremental_history_keeps_failed_cli_initialization_unusable_until_reset() {
        let repository = TestRepository::new();
        for index in 1..=3 {
            repository.write("history.txt", &format!("revision {index}\n"));
            repository.git(&["add", "history.txt"]);
            repository.git(&["commit", "-m", &format!("Revision {index}")]);
        }
        let complete = read_commits(&repository.path, 20).unwrap();
        let config_path = repository.path.join(".git/config");
        let config = fs::read(&config_path).unwrap();
        repository.git(&["config", "core.repositoryformatversion", "999"]);
        let fast_walk_available = history_walk::HistoryWalk::open(&repository.path).is_some();
        let mut cursor = CommitHistoryCursor::default();
        let result = cursor.reset(&repository.path, &complete[..1]);
        fs::write(&config_path, config).unwrap();
        assert!(
            !fast_walk_available,
            "Fixture did not exercise CLI initialization"
        );
        let error = result.unwrap_err();
        let page_error = cursor
            .next_page(&repository.path, 20)
            .expect_err("Repair alone exposed an uninitialized CLI cursor as complete");
        assert_eq!(page_error.message, error.message);
        cursor.reset(&repository.path, &complete[..1]).unwrap();
        let page = cursor.next_page(&repository.path, 20).unwrap();
        assert_eq!(
            serde_json::to_value(page.commits).unwrap(),
            serde_json::to_value(&complete[1..]).unwrap()
        );
        assert!(!page.history_truncated);
    }

    #[test]
    fn incremental_history_reports_damaged_objects_until_an_explicit_refresh() {
        for damage in ["missing", "compressed", "decoded"] {
            let repository = TestRepository::new();
            for index in 1..=5 {
                repository.write("history.txt", &format!("revision {index}\n"));
                repository.git(&["add", "history.txt"]);
                repository.git(&["commit", "-m", &format!("Revision {index}")]);
            }
            let expected = read_commits(&repository.path, 20).unwrap();
            let mut cursor = CommitHistoryCursor::default();
            cursor.reset(&repository.path, &expected[..1]).unwrap();
            assert!(cursor.walk.is_some());
            let oid = &expected[3].oid;
            let object = repository
                .path
                .join(".git/objects")
                .join(&oid[..2])
                .join(&oid[2..]);
            let backup = object.with_extension("owned-backup");
            let replacement = match damage {
                "compressed" => Some(b"invalid compressed commit object".to_vec()),
                "decoded" => {
                    let output = run_git_with_input_output(
                        &repository.path,
                        &[
                            "hash-object",
                            "--literally",
                            "-t",
                            "commit",
                            "-w",
                            "--stdin",
                        ],
                        b"invalid commit\n",
                    )
                    .unwrap();
                    ensure_success("prepare malformed owned object", &output).unwrap();
                    let malformed = String::from_utf8(output.stdout).unwrap();
                    let malformed = malformed.trim();
                    Some(
                        fs::read(
                            repository
                                .path
                                .join(".git/objects")
                                .join(&malformed[..2])
                                .join(&malformed[2..]),
                        )
                        .unwrap(),
                    )
                }
                _ => None,
            };
            fs::rename(&object, &backup).unwrap();
            if let Some(bytes) = &replacement {
                fs::write(&object, bytes).unwrap();
            }
            let result = cursor.next_page(&repository.path, 20);
            if replacement.is_some() {
                fs::remove_file(&object).unwrap();
            }
            fs::rename(&backup, &object).unwrap();
            let error = result.expect_err("Object failure was reported as complete history");
            assert_eq!(error.kind, "historyObjectFailure");
            assert!(error.message.contains(oid));
            let repeated = cursor.next_page(&repository.path, 20).unwrap_err();
            assert_eq!(
                repeated.message, error.message,
                "A failed page silently skipped commits on retry"
            );
            cursor.reset(&repository.path, &expected[..1]).unwrap();
            let page = cursor.next_page(&repository.path, 20).unwrap();
            assert_eq!(
                serde_json::to_value(&page.commits).unwrap(),
                serde_json::to_value(&expected[1..]).unwrap(),
                "Refresh after repair failed to recover every commit"
            );
            assert!(!page.history_truncated);
        }
    }

    #[test]
    fn history_preserves_control_characters_without_phantom_commits() {
        let repository = TestRepository::new();
        repository.git(&["config", "user.name", "Author\u{1f}Field\u{1e}Record élève"]);
        repository.git(&["config", "i18n.logOutputEncoding", "UTF-16"]);
        let forged = "f".repeat(40);
        let messages = [
            "Ordinary root".to_owned(),
            "Subject\u{1f}field\n\nBody\u{1e}record\u{1f}field\nlast line".to_owned(),
            format!(
                "Newest subject\u{1e}record\n\nBefore\u{1e}{forged}\u{1f}\u{1f}Forged Author\u{1f}forged@example.test\u{1f}2020-01-01T00:00:00Z\u{1f}Forged subject\u{1f}Forged body\u{1f}forged/ref\u{1e}After"
            ),
        ];
        let mut oids = Vec::new();
        for message in messages {
            repository.git(&[
                "commit",
                "--allow-empty",
                "--cleanup=verbatim",
                "-m",
                &message,
            ]);
            let output = run_git(&repository.path, &["rev-parse", "HEAD"]).unwrap();
            oids.push(String::from_utf8(output.stdout).unwrap().trim().to_owned());
        }
        // Read each field independently: this oracle cannot be confused by the
        // combined record framing being tested, or by forged delimiter payloads.
        let expected = oids
            .iter()
            .rev()
            .map(|oid| {
                let field = |token: &str| {
                    let format = format!("--format={token}");
                    let output = run_git(
                        &repository.path,
                        &[
                            "show",
                            "-s",
                            "--encoding=UTF-8",
                            "--decorate=short",
                            &format,
                            oid,
                        ],
                    )
                    .unwrap();
                    ensure_success("read owned commit field", &output).unwrap();
                    String::from_utf8(output.stdout)
                        .unwrap()
                        .strip_suffix('\n')
                        .unwrap()
                        .to_owned()
                };
                CommitSummary {
                    oid: oid.clone(),
                    parents: field("%P")
                        .split_ascii_whitespace()
                        .map(str::to_owned)
                        .collect(),
                    author_name: field("%an"),
                    author_email: field("%ae"),
                    authored_at: field("%aI"),
                    subject: field("%s"),
                    description: field("%b").trim().to_owned(),
                    decorations: field("%D")
                        .split(',')
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned)
                        .collect(),
                }
            })
            .collect::<Vec<_>>();
        let actual = read_commits(&repository.path, 20).unwrap();
        assert_eq!(
            serde_json::to_value(&actual).unwrap(),
            serde_json::to_value(&expected).unwrap()
        );
        let page = read_commit_page(&repository.path, 1, 1).unwrap();
        assert_eq!(
            serde_json::to_value(page).unwrap(),
            serde_json::to_value(&expected[1..2]).unwrap()
        );
        for in_process in [true, false] {
            let mut cursor = CommitHistoryCursor::default();
            cursor.reset(&repository.path, &expected[..1]).unwrap();
            assert!(cursor.walk.is_some());
            if !in_process {
                cursor.walk = None;
                cursor.frontier = expected[0].parents.clone();
            }
            let page = cursor.next_page(&repository.path, 20).unwrap();
            assert_eq!(
                serde_json::to_value(page.commits).unwrap(),
                serde_json::to_value(&expected[1..]).unwrap()
            );
            assert!(!page.history_truncated);
        }
    }

    #[test]
    fn malformed_nul_commit_cannot_inject_history_metadata_or_records() {
        let repository = TestRepository::new();
        repository.git(&["commit", "--allow-empty", "-m", "Root"]);
        let output = run_git(&repository.path, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let tree = String::from_utf8(output.stdout).unwrap();
        let forged = "f".repeat(40);
        let raw = format!(
            "tree {}\nauthor Author <mail@example.test> 1700000000 +0000\ncommitter Author <mail@example.test> 1700000000 +0000\n\nOriginal subject\n\nprefix\0forged/ref\0\n{forged}\0\0Forged Author\0forged@example.test\02020-01-01T00:00:00Z\0Forged subject\0Forged body",
            tree.trim()
        );
        let output = run_git_with_input_output(
            &repository.path,
            &[
                "hash-object",
                "--literally",
                "-t",
                "commit",
                "-w",
                "--stdin",
            ],
            raw.as_bytes(),
        )
        .unwrap();
        ensure_success("create malformed owned NUL fixture", &output).unwrap();
        let oid = String::from_utf8(output.stdout).unwrap();
        let oid = oid.trim();
        repository.git(&["update-ref", "refs/heads/main", oid]);
        match read_commits(&repository.path, 20) {
            Err(error) => assert_eq!(error.kind, "invalidHistoryOutput"),
            Ok(commits) => {
                assert_eq!(
                    commits.len(),
                    1,
                    "Malformed NUL message created phantom history"
                );
                assert_eq!(commits[0].oid, oid);
                assert_eq!(commits[0].author_name, "Author");
                assert_eq!(commits[0].subject, "Original subject");
                assert_eq!(commits[0].decorations, vec!["HEAD -> main"]);
                let output =
                    run_git(&repository.path, &["show", "-s", "--format=%b", oid]).unwrap();
                assert_eq!(
                    commits[0].description,
                    String::from_utf8(output.stdout).unwrap().trim()
                );
            }
        }
    }

    #[test]
    fn history_record_decoder_refuses_partial_duplicate_and_invalid_oid_records() {
        let oid = "a".repeat(40);
        let parent = "b".repeat(40);
        let fields = [
            oid.as_str(),
            parent.as_str(),
            "Author",
            "mail@example.test",
            "2020-01-01T00:00:00Z",
            "Subject\u{1f}field",
            "Body\u{1e}record",
            "HEAD -> main",
        ];
        let mut bytes = fields.join("\0").into_bytes();
        bytes.extend_from_slice(b"\0\n");
        assert_eq!(parse_history_records(&bytes).unwrap().len(), 1);
        assert!(parse_history_records(b"").unwrap().is_empty());
        for end in 1..bytes.len() {
            assert!(
                parse_history_records(&bytes[..end]).is_err(),
                "Accepted truncated prefix {end}"
            );
        }
        let duplicate = [bytes.as_slice(), bytes.as_slice()].concat();
        assert!(parse_history_records(&duplicate).is_err());
        let mut invalid = bytes.clone();
        invalid[0] = b'z';
        assert!(parse_history_records(&invalid).is_err());
        invalid = bytes.clone();
        invalid[41] = b'z';
        assert!(parse_history_records(&invalid).is_err());
        bytes.extend_from_slice(b"unframed output");
        assert!(parse_history_records(&bytes).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn history_transport_does_not_run_configured_signature_presentation() {
        use std::os::unix::fs::PermissionsExt;
        let repository = TestRepository::new();
        repository.git(&["commit", "--allow-empty", "-m", "Root"]);
        let output = run_git(&repository.path, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let tree = String::from_utf8(output.stdout).unwrap();
        let raw = format!(
            "tree {}\nauthor Author <mail@example.test> 1700000000 +0000\ncommitter Author <mail@example.test> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n bogus\n -----END PGP SIGNATURE-----\n\nSigned-looking subject\n",
            tree.trim()
        );
        let output = run_git_with_input_output(
            &repository.path,
            &["hash-object", "-t", "commit", "-w", "--stdin"],
            raw.as_bytes(),
        )
        .unwrap();
        ensure_success("create owned signature fixture", &output).unwrap();
        let oid = String::from_utf8(output.stdout).unwrap();
        let oid = oid.trim();
        repository.git(&["update-ref", "refs/heads/main", oid]);
        repository.write(
            "signature-helper",
            "#!/bin/sh\nprintf invoked > \"${0%/*}/signature-helper-invoked\"\nexit 1\n",
        );
        let helper = repository.path.join("signature-helper");
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        repository.git(&["config", "gpg.program", helper.to_str().unwrap()]);
        repository.git(&["config", "log.showSignature", "true"]);
        let marker = repository.path.join("signature-helper-invoked");
        let baseline = run_git(
            &repository.path,
            &["log", "-1", "--show-signature", "--format=%H"],
        )
        .unwrap();
        ensure_success("verify owned signature fixture", &baseline).unwrap();
        assert!(
            marker.exists(),
            "Signature fixture did not exercise the configured helper"
        );
        fs::remove_file(&marker).unwrap();
        let commits = read_commits(&repository.path, 20).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].oid, oid);
        assert_eq!(commits[0].subject, "Signed-looking subject");
        assert!(
            !marker.exists(),
            "History executed an optional signature presentation helper"
        );
        let mut cursor = CommitHistoryCursor::default();
        cursor.reset(&repository.path, &commits).unwrap();
        assert!(
            !marker.exists(),
            "History tips executed the presentation helper"
        );
        repository.git(&[
            "update-ref",
            "--create-reflog",
            "-m",
            "Owned signature fixture",
            "refs/stash",
            oid,
        ]);
        let stashes = read_stashes(&repository.path).unwrap();
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].oid, oid);
        assert!(
            !marker.exists(),
            "Stash listing executed the presentation helper"
        );
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
                // Older Git writes UTC as +00:00 instead of Z; both are the same instant.
                .map(|commit| format!("{commit:?}").replace("+00:00\"", "Z\""))
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
    fn sparse_selection_discloses_modified_and_unmerged_paths_left_outside_without_deleting() {
        let repository = TestRepository::new();
        repository.write("README.md", "root\n");
        fs::create_dir_all(repository.path.join("src")).expect("create source directory");
        fs::create_dir_all(repository.path.join("docs")).expect("create docs directory");
        repository.write("src/main.rs", "fn main() {}\n");
        repository.write("docs/guide.md", "guide\n");
        repository.write("docs/notes.md", "notes\n");
        stage_all(&repository.path).expect("stage sparse fixture");
        commit(&repository.path, "Add sparse fixture").expect("commit sparse fixture");

        repository.write("docs/guide.md", "local edit\n");
        let error = set_sparse_checkout(&repository.path, &["src".into()], false)
            .expect_err("disclose modified path left outside the selection");
        assert_eq!(error.kind, "sparsePathsLeft");
        assert!(error.message.contains("1 path(s)"));
        assert!(error.message.contains("docs/guide.md"));
        let info = read_sparse_checkout_info(&repository.path);
        assert!(info.enabled);
        assert_eq!(info.paths, vec!["src"]);
        assert_eq!(
            fs::read_to_string(repository.path.join("docs/guide.md")).unwrap(),
            "local edit\n"
        );
        assert!(!repository.path.join("docs/notes.md").exists());
        let error = reapply_sparse_checkout(&repository.path)
            .expect_err("reapply keeps disclosing the modified path");
        assert_eq!(error.kind, "sparsePathsLeft");

        run_mutation(
            &repository.path,
            &["checkout", "--", "docs/guide.md"],
            "restore",
        )
        .expect("restore modified path");
        reapply_sparse_checkout(&repository.path).expect("clean reapply succeeds");
        assert!(!repository.path.join("docs/guide.md").exists());

        disable_sparse_checkout(&repository.path).expect("restore complete checkout");
        run_mutation(&repository.path, &["switch", "-c", "side"], "branch").expect("branch");
        repository.write("docs/guide.md", "side\n");
        stage_all(&repository.path).expect("stage Side guide");
        commit(&repository.path, "Side guide").expect("commit Side guide");
        run_mutation(&repository.path, &["switch", "-"], "return").expect("return");
        repository.write("docs/guide.md", "main\n");
        stage_all(&repository.path).expect("stage Main guide");
        commit(&repository.path, "Main guide").expect("commit Main guide");
        assert!(
            run_git(&repository.path, &["merge", "side"])
                .unwrap()
                .status
                .code()
                == Some(1)
        );
        let error = set_sparse_checkout(&repository.path, &["src".into()], false)
            .expect_err("disclose unmerged path left outside the selection");
        assert_eq!(error.kind, "sparsePathsLeft");
        assert!(error.message.contains("docs/guide.md"));
        assert!(read_status(&repository.path).unwrap().conflicted == 1);
        assert!(repository.path.join("docs/guide.md").is_file());
    }

    #[test]
    fn sparse_staging_commits_and_submodules_never_treat_excluded_paths_as_deleted() {
        let dependency = TestRepository::new();
        dependency.git(&["commit", "--allow-empty", "-m", "Dependency"]);
        let repository = TestRepository::new();
        fs::create_dir_all(repository.path.join("src")).expect("create source directory");
        fs::create_dir_all(repository.path.join("docs")).expect("create docs directory");
        repository.write("src/main.rs", "fn main() {}\n");
        repository.write("docs/guide.md", "guide\n");
        repository.git(&[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            dependency.path.to_str().unwrap(),
            "docs/dependency",
        ]);
        stage_all(&repository.path).expect("stage sparse fixture");
        commit(&repository.path, "Add sparse fixture").expect("commit sparse fixture");
        let tree = |repository: &TestRepository| {
            String::from_utf8(
                run_git(&repository.path, &["ls-tree", "-r", "--name-only", "HEAD"])
                    .unwrap()
                    .stdout,
            )
            .unwrap()
        };
        let full_tree = tree(&repository);

        let error = set_sparse_checkout(&repository.path, &["src".into()], true)
            .expect_err("disclose the populated submodule Git keeps");
        assert_eq!(error.kind, "sparsePathsLeft");
        assert!(error.message.contains("docs/dependency"));
        assert!(repository.path.join("docs/dependency/.git").exists());
        assert!(!repository.path.join("docs/guide.md").exists());
        assert!(read_status(&repository.path).unwrap().entries.is_empty());

        repository.write("src/main.rs", "fn main() { println!(); }\n");
        stage_all(&repository.path).expect("stage inside the selection");
        commit(&repository.path, "Change source only").expect("commit sparse change");
        assert_eq!(tree(&repository), full_tree);
        assert_eq!(
            String::from_utf8(
                run_git(&repository.path, &["show", "HEAD:docs/guide.md"])
                    .unwrap()
                    .stdout
            )
            .unwrap(),
            "guide\n"
        );

        repository.write("docs/guide.md", "outside edit\n");
        repository.write("src/main.rs", "fn main() {}\n");
        let error = stage_path(&repository.path, "docs/guide.md")
            .expect_err("refuse staging outside the selection explicitly");
        assert_eq!(error.kind, "sparsePathOutsideSelection");
        let error = stage_all(&repository.path).expect_err("disclose the skipped path");
        assert_eq!(error.kind, "sparsePathsNotStaged");
        assert!(error.message.contains("1 changed path(s)"));
        assert!(error.message.contains("docs/guide.md"));
        let staged = String::from_utf8(
            run_git(&repository.path, &["diff", "--cached", "--name-only"])
                .unwrap()
                .stdout,
        )
        .unwrap();
        assert_eq!(staged, "src/main.rs\n");
        assert_eq!(
            fs::read_to_string(repository.path.join("docs/guide.md")).unwrap(),
            "outside edit\n"
        );
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
        assert!(!repository.path.join(".git/git-khronos-rebase").exists());
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
    fn complete_conflict_sides_preserve_binary_and_oversized_blob_contents() {
        for binary in [true, false] {
            let repository = TestRepository::new();
            let current = if binary {
                b"main\0\xff\n".to_vec()
            } else {
                b"main\n".repeat(MAX_FILE_DIFF_BYTES)
            };
            let incoming = if binary {
                b"feature\0\xfe\n".to_vec()
            } else {
                b"feature\n".repeat(MAX_FILE_DIFF_BYTES)
            };
            repository.write("shared.txt", "base\n");
            stage_all(&repository.path).unwrap();
            commit(&repository.path, "Base").unwrap();
            create_branch(&repository.path, "feature").unwrap();
            fs::write(repository.path.join("shared.txt"), &incoming).unwrap();
            stage_all(&repository.path).unwrap();
            commit(&repository.path, "Incoming").unwrap();
            checkout_branch(&repository.path, "main").unwrap();
            fs::write(repository.path.join("shared.txt"), &current).unwrap();
            stage_all(&repository.path).unwrap();
            commit(&repository.path, "Current").unwrap();
            integrate_branch(&repository.path, "feature", "merge").unwrap_err();
            let preview = conflict_details(&repository.path, "shared.txt").unwrap();
            assert!(!preview.editable);
            assert_eq!(preview.binary, binary);
            if !binary {
                assert!(preview.truncated);
            }
            resolve_conflict_with_preview(
                &repository.path,
                "shared.txt",
                "incoming",
                None,
                Some(&preview.state),
            )
            .unwrap();
            assert_eq!(
                fs::read(repository.path.join("shared.txt")).unwrap(),
                incoming
            );
            assert_eq!(
                run_git(&repository.path, &["show", ":shared.txt"])
                    .unwrap()
                    .stdout,
                incoming
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn complete_symlink_conflict_sides_keep_link_targets_and_modes() {
        let repository = TestRepository::new();
        let file = repository.path.join("link");
        std::os::unix::fs::symlink("base", &file).unwrap();
        stage_all(&repository.path).unwrap();
        commit(&repository.path, "Base").unwrap();
        create_branch(&repository.path, "feature").unwrap();
        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink("feature-target", &file).unwrap();
        stage_all(&repository.path).unwrap();
        commit(&repository.path, "Incoming").unwrap();
        checkout_branch(&repository.path, "main").unwrap();
        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink("main-target", &file).unwrap();
        stage_all(&repository.path).unwrap();
        commit(&repository.path, "Current").unwrap();
        integrate_branch(&repository.path, "feature", "merge").unwrap_err();
        let preview = conflict_details(&repository.path, "link").unwrap();
        assert!(!preview.editable);
        resolve_conflict_with_preview(
            &repository.path,
            "link",
            "incoming",
            None,
            Some(&preview.state),
        )
        .unwrap();
        assert_eq!(fs::read_link(&file).unwrap(), Path::new("feature-target"));
        assert!(
            run_git(&repository.path, &["ls-files", "--stage", "--", "link"])
                .unwrap()
                .stdout
                .starts_with(b"120000 ")
        );
    }

    #[test]
    fn conflict_gitlinks_choose_a_reviewed_commit_without_touching_the_submodule_checkout() {
        let repository = text_conflict_fixture("shared.txt");
        let head = run_git(&repository.path, &["rev-parse", "HEAD"]).unwrap();
        let incoming = run_git(&repository.path, &["rev-parse", "feature"]).unwrap();
        let transaction = format!(
            "0 {}\tshared.txt\n160000 {} 2\tshared.txt\n160000 {} 3\tshared.txt\n",
            "0".repeat(40),
            String::from_utf8_lossy(&head.stdout).trim(),
            String::from_utf8_lossy(&incoming.stdout).trim()
        );
        run_git_with_input(
            &repository.path,
            &["update-index", "--index-info"],
            transaction.as_bytes(),
            "construct gitlink conflict",
        )
        .unwrap();
        fs::remove_file(repository.path.join("shared.txt")).unwrap();
        fs::create_dir(repository.path.join("shared.txt")).unwrap();
        repository.write("shared.txt/local.txt", "submodule working changes\n");
        let preview = conflict_details(&repository.path, "shared.txt").unwrap();
        assert!(preview.submodule && !preview.editable);
        assert!(preview.current.unwrap().starts_with("Submodule commit "));
        resolve_conflict_with_preview(
            &repository.path,
            "shared.txt",
            "current",
            None,
            Some(&preview.state),
        )
        .unwrap();
        let staged = run_git(
            &repository.path,
            &["ls-files", "--stage", "--", "shared.txt"],
        )
        .unwrap()
        .stdout;
        assert!(
            staged.starts_with(
                format!(
                    "160000 {} 0\t",
                    String::from_utf8_lossy(&head.stdout).trim()
                )
                .as_bytes()
            )
        );
        assert!(
            !staged
                .windows(3)
                .any(|window| window == b" 2\t" || window == b" 3\t")
        );
        assert_eq!(
            fs::read(repository.path.join("shared.txt/local.txt")).unwrap(),
            b"submodule working changes\n"
        );

        let deletion_conflict = format!(
            "0 {}\tshared.txt\n160000 {} 2\tshared.txt\n",
            "0".repeat(40),
            String::from_utf8_lossy(&head.stdout).trim(),
        );
        run_git_with_input(
            &repository.path,
            &["update-index", "--index-info"],
            deletion_conflict.as_bytes(),
            "construct submodule deletion conflict",
        )
        .unwrap();
        let preview = conflict_details(&repository.path, "shared.txt").unwrap();
        assert!(preview.submodule && !preview.incoming_exists);
        resolve_conflict_with_preview(
            &repository.path,
            "shared.txt",
            "incoming",
            None,
            Some(&preview.state),
        )
        .unwrap();
        assert!(
            run_git(
                &repository.path,
                &["ls-files", "--stage", "--", "shared.txt"],
            )
            .unwrap()
            .stdout
            .is_empty()
        );
        assert_eq!(
            fs::read(repository.path.join("shared.txt/local.txt")).unwrap(),
            b"submodule working changes\n"
        );
    }

    #[test]
    fn conflict_preview_leases_unmerged_stage_objects_and_branch_identity() {
        let repository = text_conflict_fixture("shared.txt");
        let preview = conflict_details(&repository.path, "shared.txt").unwrap();
        let current = run_git(&repository.path, &["rev-parse", ":2:shared.txt"]).unwrap();
        let current = String::from_utf8(current.stdout).unwrap();
        run_git_with_input(
            &repository.path,
            &["update-index", "--index-info"],
            format!("100644 {} 3\tshared.txt\n", current.trim()).as_bytes(),
            "change conflict fixture",
        )
        .unwrap();
        assert_eq!(
            resolve_conflict_with_preview(
                &repository.path,
                "shared.txt",
                "current",
                None,
                Some(&preview.state)
            )
            .unwrap_err()
            .kind,
            "staleConflictPreview"
        );
        let latest = conflict_details(&repository.path, "shared.txt").unwrap();
        repository.git(&["branch", "other"]);
        repository.git(&["symbolic-ref", "HEAD", "refs/heads/other"]);
        assert_eq!(
            resolve_conflict_with_preview(
                &repository.path,
                "shared.txt",
                "incoming",
                None,
                Some(&latest.state)
            )
            .unwrap_err()
            .kind,
            "staleConflictPreview"
        );
        assert_eq!(read_status(&repository.path).unwrap().conflicted, 1);
    }

    #[cfg(unix)]
    #[test]
    fn edited_conflict_output_preserves_executable_mode_and_leaves_no_temporary_files() {
        use std::os::unix::fs::PermissionsExt;
        let repository = text_conflict_fixture("shared.txt");
        fs::set_permissions(
            repository.path.join("shared.txt"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        let preview = conflict_details(&repository.path, "shared.txt").unwrap();
        resolve_conflict_with_preview(
            &repository.path,
            "shared.txt",
            "output",
            Some("resolved\n"),
            Some(&preview.state),
        )
        .unwrap();
        assert!(
            run_git(
                &repository.path,
                &["ls-files", "--stage", "--", "shared.txt"]
            )
            .unwrap()
            .stdout
            .starts_with(b"100755 ")
        );
        assert_eq!(
            fs::read(repository.path.join("shared.txt")).unwrap(),
            b"resolved\n"
        );
        assert!(!fs::read_dir(&repository.path).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".git-khronos-resolution-")
        }));
    }

    #[test]
    fn missing_conflict_objects_fail_instead_of_appearing_as_deleted_sides() {
        let repository = text_conflict_fixture("shared.txt");
        let incoming = run_git(&repository.path, &["rev-parse", ":3:shared.txt"]).unwrap();
        let oid = String::from_utf8(incoming.stdout)
            .unwrap()
            .trim()
            .to_owned();
        fs::remove_file(
            repository
                .path
                .join(".git/objects")
                .join(&oid[..2])
                .join(&oid[2..]),
        )
        .unwrap();
        let before = fs::read(repository.path.join("shared.txt")).unwrap();
        assert!(conflict_details(&repository.path, "shared.txt").is_err());
        assert!(resolve_conflict(&repository.path, "shared.txt", "incoming", None).is_err());
        assert_eq!(
            fs::read(repository.path.join("shared.txt")).unwrap(),
            before
        );
    }

    #[test]
    fn conflict_preview_refuses_intervening_working_edits_and_index_changes() {
        let repository = text_conflict_fixture("shared.txt");
        let preview = conflict_details(&repository.path, "shared.txt").unwrap();
        repository.write("shared.txt", "external edit\n");
        let index = run_git(&repository.path, &["ls-files", "--stage"])
            .unwrap()
            .stdout;
        let error = resolve_conflict_with_preview(
            &repository.path,
            "shared.txt",
            "output",
            Some("overwrite\n"),
            Some(&preview.state),
        )
        .unwrap_err();
        assert_eq!(error.kind, "staleConflictPreview");
        assert_eq!(
            fs::read(repository.path.join("shared.txt")).unwrap(),
            b"external edit\n"
        );
        assert_eq!(
            run_git(&repository.path, &["ls-files", "--stage"])
                .unwrap()
                .stdout,
            index
        );
        let latest = conflict_details(&repository.path, "shared.txt").unwrap();
        repository.git(&["add", "shared.txt"]);
        assert!(
            resolve_conflict_with_preview(
                &repository.path,
                "shared.txt",
                "current",
                None,
                Some(&latest.state)
            )
            .is_err()
        );
    }

    fn text_conflict_fixture(file: &str) -> TestRepository {
        let repository = TestRepository::new();
        repository.write(file, "root\n");
        stage_all(&repository.path).unwrap();
        commit(&repository.path, "Base").unwrap();
        create_branch(&repository.path, "feature").unwrap();
        repository.write(file, "feature\n");
        stage_all(&repository.path).unwrap();
        commit(&repository.path, "Feature").unwrap();
        checkout_branch(&repository.path, "main").unwrap();
        repository.write(file, "main\n");
        stage_all(&repository.path).unwrap();
        commit(&repository.path, "Main").unwrap();
        integrate_branch(&repository.path, "feature", "merge").unwrap_err();
        repository
    }

    #[test]
    fn conflict_text_saving_refuses_binary_truncated_and_nul_output() {
        let repository = text_conflict_fixture("shared.txt");
        repository.write("shared.txt", &"large output\n".repeat(MAX_FILE_DIFF_BYTES));
        let preview = conflict_details(&repository.path, "shared.txt").unwrap();
        assert!(preview.truncated);
        assert!(!preview.editable);
        assert!(preview.output.unwrap().len() <= MAX_FILE_DIFF_BYTES);
        assert_eq!(
            resolve_conflict(&repository.path, "shared.txt", "output", Some("short\n"))
                .unwrap_err()
                .kind,
            "conflictNotEditable"
        );
        fs::write(repository.path.join("shared.txt"), b"binary\0file").unwrap();
        let preview = conflict_details(&repository.path, "shared.txt").unwrap();
        assert!(preview.binary);
        assert!(preview.current_exists && preview.incoming_exists);
        assert_eq!(
            resolve_conflict(&repository.path, "shared.txt", "output", Some("short\n"))
                .unwrap_err()
                .kind,
            "conflictNotEditable"
        );
        repository.write("shared.txt", "text\n");
        assert_eq!(
            resolve_conflict(&repository.path, "shared.txt", "output", Some("NUL\0"))
                .unwrap_err()
                .kind,
            "binaryConflictOutput"
        );
        assert_eq!(
            fs::read(repository.path.join("shared.txt")).unwrap(),
            b"text\n"
        );
        resolve_conflict(&repository.path, "shared.txt", "incoming", None).unwrap();
        assert_eq!(
            fs::read(repository.path.join("shared.txt")).unwrap(),
            b"feature\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn conflict_text_saving_never_follows_working_symlinks() {
        let repository = text_conflict_fixture("shared.txt");
        repository.write("unrelated.txt", "protected\n");
        fs::remove_file(repository.path.join("shared.txt")).unwrap();
        std::os::unix::fs::symlink("unrelated.txt", repository.path.join("shared.txt")).unwrap();
        let preview = conflict_details(&repository.path, "shared.txt").unwrap();
        assert!(!preview.editable);
        assert_eq!(
            resolve_conflict_with_preview(
                &repository.path,
                "shared.txt",
                "output",
                Some("overwrite\n"),
                Some(&preview.state)
            )
            .unwrap_err()
            .kind,
            "conflictNotEditable"
        );
        assert_eq!(
            fs::read(repository.path.join("unrelated.txt")).unwrap(),
            b"protected\n"
        );
        resolve_conflict_with_preview(
            &repository.path,
            "shared.txt",
            "current",
            None,
            Some(&preview.state),
        )
        .unwrap();
        assert!(
            !fs::symlink_metadata(repository.path.join("shared.txt"))
                .unwrap()
                .is_symlink()
        );
        assert_eq!(
            fs::read(repository.path.join("shared.txt")).unwrap(),
            b"main\n"
        );
    }

    #[test]
    fn conflict_side_resolution_is_literal_and_deletion_is_not_empty_output() {
        let repository = text_conflict_fixture("shared[1].txt");
        repository.write("shared1.txt", "unrelated\n");
        repository.git(&["add", "shared1.txt"]);
        let unchanged = run_git(
            &repository.path,
            &["ls-files", "--stage", "--", "shared1.txt"],
        )
        .unwrap()
        .stdout;
        resolve_conflict(&repository.path, "shared[1].txt", "incoming", None).unwrap();
        assert_eq!(
            fs::read(repository.path.join("shared[1].txt")).unwrap(),
            b"feature\n"
        );
        assert_eq!(
            run_git(
                &repository.path,
                &["ls-files", "--stage", "--", "shared1.txt"]
            )
            .unwrap()
            .stdout,
            unchanged
        );
        assert_eq!(
            fs::read(repository.path.join("shared1.txt")).unwrap(),
            b"unrelated\n"
        );
    }

    #[test]
    fn conflict_missing_side_accepts_deletion_or_explicit_empty_file() {
        for resolution in ["incoming", "output"] {
            let repository = TestRepository::new();
            repository.write("shared.txt", "base\n");
            stage_all(&repository.path).unwrap();
            commit(&repository.path, "Base").unwrap();
            create_branch(&repository.path, "feature").unwrap();
            repository.git(&["rm", "shared.txt"]);
            commit(&repository.path, "Delete").unwrap();
            checkout_branch(&repository.path, "main").unwrap();
            repository.write("shared.txt", "changed\n");
            stage_all(&repository.path).unwrap();
            commit(&repository.path, "Modify").unwrap();
            integrate_branch(&repository.path, "feature", "merge").unwrap_err();
            let preview = conflict_details(&repository.path, "shared.txt").unwrap();
            assert!(!preview.incoming_exists);
            assert!(preview.current_exists);
            resolve_conflict_with_preview(
                &repository.path,
                "shared.txt",
                resolution,
                Some(""),
                Some(&preview.state),
            )
            .unwrap();
            if resolution == "incoming" {
                assert!(!repository.path.join("shared.txt").exists());
                assert!(
                    run_git(&repository.path, &["ls-files", "--", "shared.txt"])
                        .unwrap()
                        .stdout
                        .is_empty()
                );
            } else {
                assert_eq!(fs::read(repository.path.join("shared.txt")).unwrap(), b"");
                assert!(
                    !run_git(&repository.path, &["ls-files", "--", "shared.txt"])
                        .unwrap()
                        .stdout
                        .is_empty()
                );
            }
            assert_eq!(read_status(&repository.path).unwrap().conflicted, 0);
        }
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
            "git-khronos-destination-{}-{}",
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
            "git-khronos-fetch-{}-{}",
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
            "git-khronos-tracking-{}-{}",
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
            "git-khronos-publish-{}-{}",
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
            "git-khronos-selected-remote-{}-{}",
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
    fn force_push_with_lease_rejects_an_update_fetched_after_confirmation() {
        let repository = TestRepository::new();
        repository.write("story.txt", "first\n");
        stage_all(&repository.path).expect("stage first revision");
        commit(&repository.path, "First revision").expect("commit first revision");

        let parent = std::env::temp_dir().join(format!(
            "git-khronos-force-push-{}-{}",
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
        let reviewed_remote_oid = snapshot(&repository.path)
            .expect("read reviewed remote base")
            .head_oid
            .expect("reviewed remote base oid");

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
        repository.git(&["fetch", "origin"]);
        let fetched_oid = run_git(
            &repository.path,
            &["rev-parse", "--verify", "refs/remotes/origin/main"],
        )
        .expect("read fetched remote-tracking ref");
        ensure_success("read fetched remote-tracking ref", &fetched_oid)
            .expect("read fetched remote-tracking ref");
        assert_eq!(
            String::from_utf8_lossy(&fetched_oid.stdout).trim(),
            unseen_oid,
            "simulate a background fetch advancing the tracking ref"
        );

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
        let expected_head_oid = snapshot(&repository.path)
            .expect("read reviewed local commit")
            .head_oid
            .expect("reviewed local commit oid");

        let error = push_force_with_lease_to_remote(
            &repository.path,
            "origin",
            "main",
            &reviewed_remote_oid,
            &expected_head_oid,
        )
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
        push_force_with_lease_to_remote(
            &repository.path,
            "origin",
            "main",
            &unseen_oid,
            &expected_head_oid,
        )
        .expect("the lease should succeed when the reviewed remote commit still matches");
        let updated_remote_oid = Command::new("git")
            .arg("--git-dir")
            .arg(&remote)
            .args(["rev-parse", "refs/heads/main"])
            .output()
            .expect("read force-pushed remote main");
        assert!(
            updated_remote_oid.status.success(),
            "read force-pushed remote main"
        );
        assert_eq!(
            String::from_utf8_lossy(&updated_remote_oid.stdout).trim(),
            expected_head_oid
        );
        fs::remove_dir_all(parent).expect("remove force-push fixture directory");
    }

    #[test]
    fn force_push_with_lease_rejects_a_local_head_changed_after_confirmation() {
        let repository = TestRepository::new();
        repository.write("story.txt", "reviewed\n");
        stage_all(&repository.path).expect("stage reviewed revision");
        commit(&repository.path, "Reviewed revision").expect("commit reviewed revision");

        let parent = std::env::temp_dir().join(format!(
            "git-khronos-force-push-local-{}-{}",
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
        let reviewed_oid = snapshot(&repository.path)
            .expect("read reviewed commit")
            .head_oid
            .expect("reviewed commit oid");

        repository.write("story.txt", "changed after review\n");
        stage_all(&repository.path).expect("stage changed revision");
        commit(&repository.path, "Changed after review").expect("commit changed revision");
        let current_oid = snapshot(&repository.path)
            .expect("read changed commit")
            .head_oid
            .expect("changed commit oid");

        let error = push_force_with_lease_to_remote(
            &repository.path,
            "origin",
            "main",
            &reviewed_oid,
            &reviewed_oid,
        )
        .expect_err("the local head change must invalidate the review");
        assert_eq!(error.kind, "staleForcePush");
        assert_ne!(reviewed_oid, current_oid);

        let remote_oid = Command::new("git")
            .arg("--git-dir")
            .arg(&remote)
            .args(["rev-parse", "refs/heads/main"])
            .output()
            .expect("read protected remote main");
        assert!(remote_oid.status.success(), "read protected remote main");
        assert_eq!(
            String::from_utf8_lossy(&remote_oid.stdout).trim(),
            reviewed_oid
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
    fn blame_decoder_refuses_incomplete_metadata_and_invalid_line_order() {
        let oid = "a".repeat(40);
        let record = format!(
            "{oid} 1 1 1\nauthor Name\nauthor-mail <name@example.test>\nauthor-time 1767225600\nsummary Subject\nfilename file.txt\n\tline\n"
        );
        assert_eq!(parse_blame_porcelain(&record).unwrap().len(), 1);
        for invalid in [
            format!("{oid} 1 1 1\n"),
            record.replace("\tline\n", ""),
            record.replace("author-time 1767225600\n", ""),
            record.replace("1767225600", "not-a-time"),
            record.replace("filename file.txt\n", ""),
            record.replace(" 1 1 1\n", " 1 0 1\n"),
            format!("{record}{record}"),
        ] {
            assert!(
                parse_blame_porcelain(&invalid).is_err(),
                "Incomplete or inconsistent blame must not become valid lines"
            );
        }
    }

    #[test]
    fn blame_pages_preserve_unicode_paths_and_cover_exact_boundaries_and_empty_files() {
        let repository = TestRepository::new();
        repository.git(&["config", "user.name", "Élodie😀"]);
        let contents = (1..=205)
            .map(|number| format!("élève😀 line {number}\r\n"))
            .collect::<String>();
        repository.write("old.txt", &contents);
        repository.write("empty.txt", "");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "élève😀 subject"]);
        let original = reference_tip(&repository.path, "HEAD").unwrap();
        repository.git(&["mv", "old.txt", "renamed.txt"]);
        repository.git(&["commit", "-m", "Rename only"]);
        let revision = reference_tip(&repository.path, "HEAD").unwrap();
        repository.git(&["config", "i18n.logOutputEncoding", "UTF-16"]);
        repository.git(&["config", "blame.blankBoundary", "true"]);
        repository.git(&["config", "blame.coloring", "highlightRecent"]);
        let mut all = Vec::new();
        for (first, length, next) in [(1, 100, Some(101)), (101, 100, Some(201)), (201, 5, None)] {
            let page = file_blame_page(&repository.path, &revision, "renamed.txt", first).unwrap();
            assert_eq!(page.lines.len(), length);
            assert_eq!(page.next_line, next);
            assert_eq!(page.lines[0].line_number, first);
            assert!(page.lines.iter().all(|line| line.oid == original
                && line.path.as_deref() == Some("old.txt")
                && line.author_name == "Élodie😀"));
            all.extend(page.lines);
        }
        assert_eq!(
            all.iter()
                .map(|line| format!("{}\n", line.text))
                .collect::<String>(),
            contents
        );
        assert!(
            file_blame_page(&repository.path, &revision, "empty.txt", 1)
                .unwrap()
                .lines
                .is_empty()
        );
        assert!(file_blame_page(&repository.path, &revision, "renamed.txt", 206).is_err());
        assert_eq!(
            file_blame_page(&repository.path, &revision, "renamed.txt", 0)
                .unwrap_err()
                .kind,
            "invalidBlameRange"
        );
    }

    #[test]
    fn blame_pages_bound_large_files_and_refuse_oversized_lines() {
        let repository = TestRepository::new();
        repository.write(
            "large.txt",
            &(1..=100_000)
                .map(|number| format!("line {number}\n"))
                .collect::<String>(),
        );
        repository.write("huge-line.txt", &"x".repeat(2 * 1024 * 1024));
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Large blame fixtures"]);
        let revision = reference_tip(&repository.path, "HEAD").unwrap();
        let page = file_blame_page(&repository.path, &revision, "large.txt", 99_901).unwrap();
        assert_eq!(page.lines.len(), 100);
        assert!(page.next_line.is_none());
        assert_eq!(page.lines[99].text, "line 100000");
        assert_eq!(
            file_blame_page(&repository.path, &revision, "huge-line.txt", 1)
                .unwrap_err()
                .kind,
            "historyOutputLimit"
        );
    }

    #[test]
    #[cfg(unix)]
    fn blame_inspection_never_executes_configured_text_conversion() {
        use std::os::unix::fs::PermissionsExt;
        let repository = TestRepository::new();
        repository.write("file.txt", "raw owned source\n");
        repository.write(".gitattributes", "*.txt diff=owned\n");
        let helper = repository.path.join(".git/blame-textconv");
        fs::write(
            &helper,
            "#!/bin/sh\nprintf called > .git/blame-converter-called\nprintf converted\\n\n",
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        repository.git(&["config", "diff.owned.textconv", ".git/blame-textconv"]);
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Owned raw source"]);
        let revision = reference_tip(&repository.path, "HEAD").unwrap();
        repository.git(&[
            "blame",
            "--textconv",
            "--line-porcelain",
            &revision,
            "--",
            "file.txt",
        ]);
        let marker = repository.path.join(".git/blame-converter-called");
        assert!(
            marker.exists(),
            "The fixture must prove the converter is executable"
        );
        fs::remove_file(&marker).unwrap();
        assert_eq!(
            file_blame(&repository.path, &revision, "file.txt").unwrap()[0].text,
            "raw owned source"
        );
        assert_eq!(
            file_blame_page(&repository.path, &revision, "file.txt", 1)
                .unwrap()
                .lines[0]
                .text,
            "raw owned source"
        );
        assert!(!marker.exists());
    }

    #[test]
    #[cfg(unix)]
    fn blame_pages_accept_literal_control_space_and_quoted_filenames() {
        let repository = TestRepository::new();
        let files = [
            "line\nname.txt",
            " tail ",
            "quote\"",
            "bell\u{7}.txt",
            "*.txt",
        ];
        for file in files {
            repository.write(file, "literal file\n");
        }
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Literal filenames"]);
        let revision = reference_tip(&repository.path, "HEAD").unwrap();
        for file in files {
            let page = file_blame_page(&repository.path, &revision, file, 1).unwrap();
            assert_eq!(page.lines.len(), 1);
            assert_eq!(page.lines[0].path.as_deref(), Some(file));
            assert_eq!(page.lines[0].text, "literal file");
        }
        for file in ["", "../outside", "/absolute", "bad\0path"] {
            assert_eq!(
                file_blame_page(&repository.path, &revision, file, 1)
                    .unwrap_err()
                    .kind,
                "invalidPath"
            );
        }
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
    fn ignore_extension_reapplies_an_existing_rule_after_a_later_negation() {
        let repository = TestRepository::new();
        repository.write(".gitignore", "*.log\n!important.log\n");
        repository.write("important.log", "selected\n");
        repository.write("unrelated.txt", "keep\n");
        let before = run_git(
            &repository.path,
            &[
                "check-ignore",
                "--no-index",
                "--quiet",
                "--",
                "important.log",
            ],
        )
        .unwrap();
        assert_eq!(before.status.code(), Some(1));

        ignore_path(&repository.path, "important.log", "extension", false).unwrap();

        let ignored = run_git(
            &repository.path,
            &[
                "check-ignore",
                "--no-index",
                "--quiet",
                "--",
                "important.log",
            ],
        )
        .unwrap();
        assert!(ignored.status.success());
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"*.log\n!important.log\n*.log\n"
        );
        assert_eq!(
            fs::read(repository.path.join("important.log")).unwrap(),
            b"selected\n"
        );
        assert_eq!(
            fs::read(repository.path.join("unrelated.txt")).unwrap(),
            b"keep\n"
        );
    }

    #[test]
    fn ignore_extension_reapplies_a_rule_even_if_only_another_file_is_unignored() {
        let repository = TestRepository::new();
        repository.write(".gitignore", "*.log\n!keep.log\n");
        repository.write("chosen.log", "committed\n");
        repository.write("keep.log", "untracked\n");
        repository.git(&["add", ".gitignore"]);
        repository.git(&["add", "-f", "chosen.log"]);
        repository.git(&["commit", "-m", "Tracked file with exceptions"]);
        repository.write("chosen.log", "local edit\n");
        assert_eq!(
            run_git(
                &repository.path,
                &["check-ignore", "--no-index", "--quiet", "--", "keep.log"],
            )
            .unwrap()
            .status
            .code(),
            Some(1)
        );

        ignore_path(&repository.path, "chosen.log", "extension", true).unwrap();

        assert!(
            run_git(
                &repository.path,
                &["check-ignore", "--no-index", "--quiet", "--", "keep.log"],
            )
            .unwrap()
            .status
            .success()
        );
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"*.log\n!keep.log\n*.log\n"
        );
        assert_eq!(
            fs::read(repository.path.join("chosen.log")).unwrap(),
            b"local edit\n"
        );
        assert_eq!(
            run_git(
                &repository.path,
                &["ls-files", "--error-unmatch", "--", "chosen.log"],
            )
            .unwrap()
            .status
            .code(),
            Some(1)
        );

        let before_ignore = fs::read(repository.path.join(".gitignore")).unwrap();
        let before_index = fs::read(repository.path.join(".git/index")).unwrap();
        fs::create_dir(repository.path.join("folder")).unwrap();
        repository.write("folder/.gitignore", "!important.log\n");
        repository.write("folder/important.log", "selected\n");
        let retry =
            ignore_path(&repository.path, "folder/important.log", "extension", true).unwrap_err();
        assert_eq!(retry.kind, "ignoreRuleIneffective");
        assert!(retry.message.contains("existing rule"));
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            before_ignore
        );
        assert_eq!(
            fs::read(repository.path.join(".git/index")).unwrap(),
            before_index
        );
    }

    #[test]
    fn ignore_directory_uses_a_literal_root_relative_pattern() {
        let repository = TestRepository::new();
        #[cfg(not(target_os = "linux"))]
        repository.write(".gitignore", "");
        fs::create_dir(repository.path.join("logs [temp]")).unwrap();
        fs::create_dir(repository.path.join("logs t")).unwrap();
        repository.write("logs [temp]/selected.txt", "selected\n");
        repository.write("logs [temp]/other.bin", "other\n");
        repository.write("logs t/other.bin", "unrelated\n");

        ignore_path(
            &repository.path,
            "logs [temp]/selected.txt",
            "directory",
            false,
        )
        .unwrap();

        for (path, expected) in [
            ("logs [temp]/selected.txt", 0),
            ("logs [temp]/other.bin", 0),
            ("logs t/other.bin", 1),
        ] {
            assert_eq!(
                run_git(
                    &repository.path,
                    &["check-ignore", "--no-index", "--quiet", "--", path],
                )
                .unwrap()
                .status
                .code(),
                Some(expected),
                "{path}"
            );
        }
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"/logs\\ \\[temp\\]/\n"
        );
    }

    #[test]
    fn ignore_extension_untracks_only_the_selected_file_and_preserves_other_changes() {
        let repository = TestRepository::new();
        #[cfg(not(target_os = "linux"))]
        fs::write(repository.path.join(".gitignore"), b"").unwrap();
        fs::create_dir(repository.path.join("nested")).unwrap();
        repository.write("nested/selected.[x]", "selected base\n");
        repository.write("nested/tracked.[x]", "tracked base\n");
        repository.git(&[
            "--literal-pathspecs",
            "add",
            "--",
            "nested/selected.[x]",
            "nested/tracked.[x]",
        ]);
        repository.git(&["commit", "-m", "Track extension fixtures"]);
        repository.write("nested/selected.[x]", "selected edit\n");
        repository.write("nested/tracked.[x]", "staged edit\n");
        repository.git(&["--literal-pathspecs", "add", "--", "nested/tracked.[x]"]);
        repository.write("nested/tracked.[x]", "unstaged edit\n");
        repository.write("match.[x]", "untracked match\n");
        repository.write("decoy.x", "untracked decoy\n");
        let tracked_before = run_git(
            &repository.path,
            &[
                "--literal-pathspecs",
                "ls-files",
                "--stage",
                "--",
                "nested/tracked.[x]",
            ],
        )
        .unwrap()
        .stdout;
        assert!(!tracked_before.is_empty());
        assert!(
            run_git(
                &repository.path,
                &[
                    "--literal-pathspecs",
                    "ls-files",
                    "--error-unmatch",
                    "--",
                    "nested/selected.[x]"
                ]
            )
            .unwrap()
            .status
            .success()
        );

        ignore_path(&repository.path, "nested/selected.[x]", "extension", true).unwrap();

        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"*.\\[x\\]\n"
        );
        assert_eq!(
            run_git(
                &repository.path,
                &[
                    "--literal-pathspecs",
                    "ls-files",
                    "--stage",
                    "--",
                    "nested/tracked.[x]"
                ]
            )
            .unwrap()
            .stdout,
            tracked_before
        );
        assert_eq!(
            run_git(
                &repository.path,
                &[
                    "--literal-pathspecs",
                    "ls-files",
                    "--error-unmatch",
                    "--",
                    "nested/selected.[x]"
                ]
            )
            .unwrap()
            .status
            .code(),
            Some(1)
        );
        for (file, expected) in [("match.[x]", 0), ("decoy.x", 1)] {
            assert_eq!(
                run_git(
                    &repository.path,
                    &["check-ignore", "--no-index", "--quiet", "--", file]
                )
                .unwrap()
                .status
                .code(),
                Some(expected),
                "{file}"
            );
        }
        assert_eq!(
            fs::read(repository.path.join("nested/selected.[x]")).unwrap(),
            b"selected edit\n"
        );
        assert_eq!(
            fs::read(repository.path.join("nested/tracked.[x]")).unwrap(),
            b"unstaged edit\n"
        );
    }

    #[test]
    fn ignore_directory_untracks_only_the_selected_file_and_preserves_other_changes() {
        let repository = TestRepository::new();
        #[cfg(not(target_os = "linux"))]
        fs::write(repository.path.join(".gitignore"), b"").unwrap();
        fs::create_dir_all(repository.path.join("folder/nested")).unwrap();
        repository.write("folder/selected.log", "selected base\n");
        repository.write("folder/tracked.log", "tracked base\n");
        repository.git(&["add", "--", "folder/selected.log", "folder/tracked.log"]);
        repository.git(&["commit", "-m", "Track directory fixtures"]);
        repository.write("folder/selected.log", "selected edit\n");
        repository.write("folder/tracked.log", "staged edit\n");
        repository.git(&["add", "--", "folder/tracked.log"]);
        repository.write("folder/tracked.log", "unstaged edit\n");
        repository.write("folder/nested/other.txt", "untracked match\n");
        repository.write("other.txt", "untracked decoy\n");
        let tracked_before = run_git(
            &repository.path,
            &["ls-files", "--stage", "--", "folder/tracked.log"],
        )
        .unwrap()
        .stdout;
        assert!(!tracked_before.is_empty());
        assert!(
            run_git(
                &repository.path,
                &["ls-files", "--error-unmatch", "--", "folder/selected.log"]
            )
            .unwrap()
            .status
            .success()
        );

        ignore_path(&repository.path, "folder/selected.log", "directory", true).unwrap();

        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"/folder/\n"
        );
        assert_eq!(
            run_git(
                &repository.path,
                &["ls-files", "--stage", "--", "folder/tracked.log"]
            )
            .unwrap()
            .stdout,
            tracked_before
        );
        assert_eq!(
            run_git(
                &repository.path,
                &["ls-files", "--error-unmatch", "--", "folder/selected.log"]
            )
            .unwrap()
            .status
            .code(),
            Some(1)
        );
        for (file, expected) in [("folder/nested/other.txt", 0), ("other.txt", 1)] {
            assert_eq!(
                run_git(
                    &repository.path,
                    &["check-ignore", "--no-index", "--quiet", "--", file]
                )
                .unwrap()
                .status
                .code(),
                Some(expected),
                "{file}"
            );
        }
        assert_eq!(
            fs::read(repository.path.join("folder/selected.log")).unwrap(),
            b"selected edit\n"
        );
        assert_eq!(
            fs::read(repository.path.join("folder/tracked.log")).unwrap(),
            b"unstaged edit\n"
        );
    }

    #[test]
    #[cfg(unix)]
    fn ignore_extension_treats_backslashes_as_literal_filename_bytes() {
        let repository = TestRepository::new();
        #[cfg(not(target_os = "linux"))]
        repository.write(".gitignore", "");
        repository.write("report.part\\suffix", "selected\n");
        repository.write("other.part\\suffix", "matching\n");
        repository.write("other.part", "decoy\n");

        ignore_path(&repository.path, "report.part\\suffix", "extension", false).unwrap();

        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"*.part\\\\suffix\n"
        );
        for (file, expected) in [
            ("report.part\\suffix", 0),
            ("other.part\\suffix", 0),
            ("other.part", 1),
        ] {
            assert_eq!(
                run_git(
                    &repository.path,
                    &["check-ignore", "--no-index", "--quiet", "--", file]
                )
                .unwrap()
                .status
                .code(),
                Some(expected),
                "{file}"
            );
        }
        assert_eq!(
            fs::read(repository.path.join("report.part\\suffix")).unwrap(),
            b"selected\n"
        );
    }

    #[test]
    #[cfg(unix)]
    fn ignore_directory_treats_backslashes_as_literal_filename_bytes() {
        let repository = TestRepository::new();
        repository.write("root\\file", "root\n");
        let error = ignore_path(&repository.path, "root\\file", "directory", false).unwrap_err();
        assert_eq!(error.kind, "missingParentDirectory");
        assert!(!repository.path.join(".gitignore").exists());
        #[cfg(not(target_os = "linux"))]
        repository.write(".gitignore", "");
        fs::create_dir(repository.path.join("folder\\literal")).unwrap();
        fs::create_dir_all(repository.path.join("folder/literal")).unwrap();
        repository.write("folder\\literal/selected.txt", "selected\n");
        repository.write("folder\\literal/other.txt", "matching\n");
        repository.write("folder/literal/other.txt", "decoy\n");

        ignore_path(
            &repository.path,
            "folder\\literal/selected.txt",
            "directory",
            false,
        )
        .unwrap();

        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"/folder\\\\literal/\n"
        );
        for (file, expected) in [
            ("folder\\literal/selected.txt", 0),
            ("folder\\literal/other.txt", 0),
            ("folder/literal/other.txt", 1),
        ] {
            assert_eq!(
                run_git(
                    &repository.path,
                    &["check-ignore", "--no-index", "--quiet", "--", file]
                )
                .unwrap()
                .status
                .code(),
                Some(expected),
                "{file}"
            );
        }
        assert_eq!(
            fs::read(repository.path.join("root\\file")).unwrap(),
            b"root\n"
        );
    }

    #[test]
    fn ignore_refuses_to_untrack_when_a_nested_rule_overrides_the_root_rule() {
        let repository = TestRepository::new();
        fs::create_dir(repository.path.join("folder")).unwrap();
        repository.write(".gitignore", "# existing\n");
        repository.write("folder/.gitignore", "!important.log\n");
        repository.write("folder/important.log", "committed\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Tracked file with nested rules"]);
        repository.write("folder/important.log", "local edit\n");
        let before_index = fs::read(repository.path.join(".git/index")).unwrap();

        let error =
            ignore_path(&repository.path, "folder/important.log", "extension", true).unwrap_err();

        assert_eq!(error.kind, "ignoreRuleIneffective");
        assert!(error.message.contains("added"));
        assert!(error.hint.unwrap().contains("index was not changed"));
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"# existing\n*.log\n"
        );
        assert_eq!(
            fs::read(repository.path.join(".git/index")).unwrap(),
            before_index
        );
        assert_eq!(
            fs::read(repository.path.join("folder/important.log")).unwrap(),
            b"local edit\n"
        );
        assert_eq!(
            run_git(
                &repository.path,
                &[
                    "check-ignore",
                    "--no-index",
                    "--quiet",
                    "--",
                    "folder/important.log"
                ],
            )
            .unwrap()
            .status
            .code(),
            Some(1)
        );
    }

    #[test]
    fn ignore_preserves_existing_non_utf8_rules_and_line_endings() {
        let repository = TestRepository::new();
        repository.write("secret.log", "keep\n");
        let existing = b"# existing rules\r\n/old-\xff.log\r\n";
        fs::write(repository.path.join(".gitignore"), existing).unwrap();
        ignore_path(&repository.path, "secret.log", "file", false).unwrap();
        let updated = fs::read(repository.path.join(".gitignore")).unwrap();
        assert!(updated.starts_with(existing));
        assert!(updated.ends_with(b"/secret.log\n"));
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"keep\n"
        );
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn ignore_refuses_existing_and_dangling_ignore_file_symlinks() {
        #[cfg(unix)]
        use std::os::unix::fs::symlink as symlink_file;
        #[cfg(windows)]
        use std::os::windows::fs::symlink_file;
        for existing in [false, true] {
            let repository = TestRepository::new();
            repository.write("secret.log", "keep\n");
            let target = repository.path.join(".git/outside-ignore");
            if existing {
                fs::write(&target, b"# preserve outside\n").unwrap();
            }
            let ignore = repository.path.join(".gitignore");
            symlink_file(&target, &ignore).unwrap();
            assert!(ignore_path(&repository.path, "secret.log", "file", false).is_err());
            assert!(fs::symlink_metadata(ignore).unwrap().is_symlink());
            if existing {
                assert_eq!(fs::read(target).unwrap(), b"# preserve outside\n");
            } else {
                assert!(!target.exists());
            }
            assert_eq!(
                fs::read(repository.path.join("secret.log")).unwrap(),
                b"keep\n"
            );
        }
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn ignore_refuses_ignore_file_swapped_to_symlink_before_open() {
        #[cfg(unix)]
        use std::os::unix::fs::symlink as symlink_file;
        #[cfg(windows)]
        use std::os::windows::fs::symlink_file;

        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        repository.write(".gitignore", "# original rules\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let ignore = repository.path.join(".gitignore");
        let original = repository.path.join(".git/original-ignore");
        let outside_repository = TestRepository::new();
        let outside = outside_repository.path.join("outside-ignore");
        fs::write(&outside, b"# outside content must not be copied\n").unwrap();

        let result = ignore_rules::update_with_hook(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            || {
                fs::rename(&ignore, &original).unwrap();
                symlink_file(&outside, &ignore).unwrap();
            },
        );
        let error = result.expect_err("a swapped ignore file must be refused");
        assert_eq!(error.kind, "invalidIgnoreFile");
        assert!(fs::symlink_metadata(&ignore).unwrap().is_symlink());
        assert_eq!(
            fs::read(&outside).unwrap(),
            b"# outside content must not be copied\n"
        );
        assert_eq!(fs::read(&original).unwrap(), b"# original rules\n");
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
        assert!(!repository.path.join(".gitignore.lock").exists());
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_refuses_new_ignore_file_created_before_publication() {
        use std::os::unix::fs::symlink as symlink_file;

        for create_link in [false, true] {
            let repository = TestRepository::new();
            repository.write("secret.log", "committed\n");
            repository.git(&["add", "secret.log"]);
            repository.git(&["commit", "-m", "Tracked file"]);
            repository.write("secret.log", "local edit\n");
            let index = fs::read(repository.path.join(".git/index")).unwrap();
            let ignore = repository.path.join(".gitignore");
            let outside_repository = TestRepository::new();
            let outside = outside_repository.path.join("outside-ignore");
            fs::write(&outside, b"# outside rules\n").unwrap();

            let error = ignore_rules::update_with_hooks(
                &repository.path,
                "/secret.log",
                "secret.log",
                true,
                || {},
                || {
                    if create_link {
                        symlink_file(&outside, &ignore).unwrap();
                    } else {
                        fs::write(&ignore, b"# concurrent rules\n").unwrap();
                    }
                },
            )
            .expect_err("a concurrently created ignore file must not be replaced");

            assert_eq!(error.kind, "ignoreFileChanged");
            if create_link {
                assert!(fs::symlink_metadata(&ignore).unwrap().is_symlink());
            } else {
                assert_eq!(fs::read(&ignore).unwrap(), b"# concurrent rules\n");
            }
            assert_eq!(fs::read(&outside).unwrap(), b"# outside rules\n");
            assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
            assert_eq!(
                fs::read(repository.path.join("secret.log")).unwrap(),
                b"local edit\n"
            );
            assert!(!repository.path.join(".gitignore.lock").exists());
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_no_replace_refuses_entries_created_at_the_publication_call() {
        #[cfg(unix)]
        use std::os::unix::fs::symlink as symlink_file;
        #[cfg(windows)]
        use std::os::windows::fs::symlink_file;

        for entry in ["file", "symlink", "dangling symlink", "directory"] {
            let repository = TestRepository::new();
            repository.write("secret.log", "committed\n");
            repository.git(&["add", "secret.log"]);
            repository.git(&["commit", "-m", "Tracked file"]);
            repository.write("secret.log", "local edit\n");
            let index = fs::read(repository.path.join(".git/index")).unwrap();
            let ignore = repository.path.join(".gitignore");
            let outside_repository = TestRepository::new();
            let outside = outside_repository.path.join("outside-ignore");
            let missing = outside_repository.path.join("missing-ignore");
            fs::write(&outside, b"# outside rules\n").unwrap();

            let error = ignore_rules::update_with_publication_hook(
                &repository.path,
                "/secret.log",
                "secret.log",
                true,
                |staging, lock, destination| {
                    match entry {
                        "file" => fs::write(destination, b"# concurrent rules\n").unwrap(),
                        "symlink" => symlink_file(&outside, destination).unwrap(),
                        "dangling symlink" => symlink_file(&missing, destination).unwrap(),
                        "directory" => fs::create_dir(destination).unwrap(),
                        _ => unreachable!(),
                    }
                    ignore_rules::publish_new_ignore(staging, lock, destination)
                },
            )
            .unwrap_err();

            if cfg!(windows) && entry == "directory" {
                assert!(
                    matches!(
                        error.kind.as_str(),
                        "ignoreFileChanged" | "ignoreRulePublicationUncertain"
                    ),
                    "{entry}: {error:?}"
                );
            } else {
                assert_eq!(error.kind, "ignoreFileChanged", "{entry}");
            }
            match entry {
                "file" => assert_eq!(fs::read(&ignore).unwrap(), b"# concurrent rules\n"),
                "symlink" | "dangling symlink" => {
                    assert!(fs::symlink_metadata(&ignore).unwrap().is_symlink());
                }
                "directory" => assert!(ignore.is_dir()),
                _ => unreachable!(),
            }
            assert_eq!(fs::read(&outside).unwrap(), b"# outside rules\n");
            assert!(!missing.exists());
            assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
            assert_eq!(
                fs::read(repository.path.join("secret.log")).unwrap(),
                b"local edit\n"
            );
            assert!(!repository.path.join(".gitignore.lock").exists());
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_new_publication_uses_the_open_staging_file_not_a_replaced_lock_name() {
        use std::io::Write;

        for keep_original_link in [false, true] {
            let repository = TestRepository::new();
            let lock = repository.path.join(".gitignore.lock");
            let saved = repository.path.join(".git/saved-ignore-lock");
            let destination = repository.path.join(".gitignore");
            let mut staging = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock)
                .unwrap();
            staging.write_all(b"/secret.log\n").unwrap();
            if keep_original_link {
                fs::rename(&lock, &saved).unwrap();
            } else {
                fs::remove_file(&lock).unwrap();
            }
            fs::write(&lock, b"# another writer\n").unwrap();

            let result = ignore_rules::publish_new_ignore(&staging, &lock, &destination);
            if keep_original_link {
                result.unwrap();
                assert_eq!(fs::read(&destination).unwrap(), b"/secret.log\n");
                assert_eq!(fs::read(&saved).unwrap(), b"/secret.log\n");
            } else {
                assert!(result.is_err());
                assert!(!destination.exists());
            }
            assert_eq!(fs::read(&lock).unwrap(), b"# another writer\n");
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_reports_lock_replacement_during_new_rule_publication() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let ignore = repository.path.join(".gitignore");
        let lock = repository.path.join(".gitignore.lock");
        let saved = repository.path.join(".git/saved-ignore-lock");

        let error = ignore_rules::update_with_publication_hook(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            |staging, source, destination| {
                fs::rename(source, &saved).unwrap();
                fs::write(source, b"# another writer\n").unwrap();
                ignore_rules::publish_new_ignore(staging, source, destination)
            },
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreRuleLockCleanupFailed");
        assert_eq!(fs::read(&ignore).unwrap(), b"/secret.log\n");
        assert_eq!(fs::read(&saved).unwrap(), b"/secret.log\n");
        assert_eq!(fs::read(&lock).unwrap(), b"# another writer\n");
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(all(not(target_os = "linux"), any(unix, windows)))]
    fn ignore_refuses_to_create_a_new_ignore_file_when_handle_publication_is_unavailable() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();

        let error =
            ignore_rules::update(&repository.path, "/secret.log", "secret.log", true).unwrap_err();

        assert_eq!(error.kind, "unsupportedPlatform");
        assert!(error.message.contains("cannot be published safely"));
        assert!(!repository.path.join(".gitignore").exists());
        assert!(!repository.path.join(".gitignore.lock").exists());
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(all(not(target_os = "linux"), any(unix, windows)))]
    fn ignore_refuses_new_rule_before_checking_untracking_on_unsupported_platform() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "staged\n");
        repository.git(&["add", "secret.log"]);
        repository.write("secret.log", "worktree\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let dry_run = run_git(
            &repository.path,
            &[
                "--literal-pathspecs",
                "rm",
                "--cached",
                "--ignore-unmatch",
                "--dry-run",
                "--",
                "secret.log",
            ],
        )
        .unwrap();
        assert!(!dry_run.status.success());

        let error = ignore_rules::update_with_hook(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            || panic!("unsupported publication must refuse before opening the rule"),
        )
        .unwrap_err();

        assert_eq!(error.kind, "unsupportedPlatform");
        assert!(!repository.path.join(".gitignore").exists());
        assert!(!repository.path.join(".gitignore.lock").exists());
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"worktree\n"
        );
    }

    #[test]
    #[cfg(all(not(target_os = "linux"), any(unix, windows)))]
    fn ignore_reports_unsupported_creation_when_lock_cleanup_fails() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        let index = fs::read(repository.path.join(".git/index")).unwrap();

        let error = ignore_rules::update_with_test_hooks(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            (
                || panic!("unsupported publication must refuse before opening the rule"),
                || {},
                || {},
                |_| Err(std::io::Error::other("injected removal failure")),
            ),
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreLockCleanupFailed");
        assert!(error.message.contains("cannot be published safely"));
        assert!(error.message.contains("injected removal failure"));
        assert!(!repository.path.join(".gitignore").exists());
        assert!(repository.path.join(".gitignore.lock").exists());
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn ignore_reports_a_replaced_lock_before_publication_without_removing_it() {
        #[cfg(unix)]
        use std::os::unix::fs::symlink as symlink_file;
        #[cfg(windows)]
        use std::os::windows::fs::symlink_file;

        for existing in [false, true] {
            if !existing && !cfg!(target_os = "linux") {
                continue;
            }
            for replacement in ["file", "symlink", "directory"] {
                let repository = TestRepository::new();
                repository.write("secret.log", "committed\n");
                repository.git(&["add", "secret.log"]);
                repository.git(&["commit", "-m", "Tracked file"]);
                repository.write("secret.log", "local edit\n");
                let ignore = repository.path.join(".gitignore");
                let lock = repository.path.join(".gitignore.lock");
                let saved = repository.path.join(".git/saved-ignore-lock");
                let outside_repository = TestRepository::new();
                let outside = outside_repository.path.join("outside-lock");
                fs::write(&outside, b"# outside lock\n").unwrap();
                if existing {
                    fs::write(&ignore, b"# original rules\n").unwrap();
                }
                let index = fs::read(repository.path.join(".git/index")).unwrap();

                let error = ignore_rules::update_with_hooks(
                    &repository.path,
                    "/secret.log",
                    "secret.log",
                    true,
                    || {},
                    || {
                        fs::rename(&lock, &saved).unwrap();
                        match replacement {
                            "file" => fs::write(&lock, b"# another writer\n").unwrap(),
                            "symlink" => symlink_file(&outside, &lock).unwrap(),
                            "directory" => fs::create_dir(&lock).unwrap(),
                            _ => unreachable!(),
                        }
                    },
                )
                .unwrap_err();

                assert_eq!(error.kind, "ignoreLockCleanupFailed");
                assert!(error.message.contains("ownership"));
                assert!(error.message.contains("could not be safely removed"));
                if existing {
                    assert_eq!(fs::read(&ignore).unwrap(), b"# original rules\n");
                    assert_eq!(
                        fs::read(&saved).unwrap(),
                        b"# original rules\n/secret.log\n"
                    );
                } else {
                    assert!(!ignore.exists());
                    assert_eq!(fs::read(&saved).unwrap(), b"/secret.log\n");
                }
                match replacement {
                    "file" => assert_eq!(fs::read(&lock).unwrap(), b"# another writer\n"),
                    "symlink" => assert!(fs::symlink_metadata(&lock).unwrap().is_symlink()),
                    "directory" => assert!(lock.is_dir()),
                    _ => unreachable!(),
                }
                assert_eq!(fs::read(&outside).unwrap(), b"# outside lock\n");
                assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
                assert_eq!(
                    fs::read(repository.path.join("secret.log")).unwrap(),
                    b"local edit\n"
                );
            }
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_treats_an_existing_link_to_its_staging_file_as_uncertain() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let ignore = repository.path.join(".gitignore");
        let lock = repository.path.join(".gitignore.lock");

        let error = ignore_rules::update_with_hooks(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            || {},
            || fs::hard_link(&lock, &ignore).unwrap(),
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreRulePublicationUncertain");
        assert!(error.hint.unwrap().contains("index was not changed"));
        assert_eq!(fs::read(&ignore).unwrap(), b"/secret.log\n");
        assert!(!lock.exists());
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_never_falls_back_to_replacing_after_uncertain_publication() {
        for link_before_error in [false, true] {
            let repository = TestRepository::new();
            repository.write("secret.log", "committed\n");
            repository.git(&["add", "secret.log"]);
            repository.git(&["commit", "-m", "Tracked file"]);
            repository.write("secret.log", "local edit\n");
            let index = fs::read(repository.path.join(".git/index")).unwrap();
            let ignore = repository.path.join(".gitignore");
            let lock = repository.path.join(".gitignore.lock");

            let error = ignore_rules::update_with_publication_hook(
                &repository.path,
                "/secret.log",
                "secret.log",
                true,
                |_, source, destination| {
                    if link_before_error {
                        fs::hard_link(source, destination).unwrap();
                    }
                    Err(std::io::Error::new(
                        std::io::ErrorKind::Unsupported,
                        "injected no-replace publication failure",
                    ))
                },
            )
            .unwrap_err();

            assert_eq!(error.kind, "ignoreRulePublicationUncertain");
            assert!(error.hint.unwrap().contains("No overwrite fallback"));
            if link_before_error {
                assert_eq!(fs::read(&ignore).unwrap(), b"/secret.log\n");
            } else {
                assert!(!ignore.exists());
            }
            assert!(!lock.exists());
            assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
            assert_eq!(
                fs::read(repository.path.join("secret.log")).unwrap(),
                b"local edit\n"
            );
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_reports_a_changed_destination_after_new_rule_publication() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let ignore = repository.path.join(".gitignore");
        let saved = repository.path.join(".git/published-ignore");

        let error = ignore_rules::update_with_test_hooks(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            (
                || {},
                || {},
                || {
                    fs::rename(&ignore, &saved).unwrap();
                    fs::write(&ignore, b"# another writer\n").unwrap();
                },
                |path| fs::remove_file(path),
            ),
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreRulePublicationUncertain");
        assert!(error.message.contains("not the staged ignore file"));
        assert_eq!(fs::read(&ignore).unwrap(), b"# another writer\n");
        assert_eq!(fs::read(&saved).unwrap(), b"/secret.log\n");
        assert!(!repository.path.join(".gitignore.lock").exists());
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_reports_new_rule_when_its_publication_lock_cannot_be_removed() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();

        let error = ignore_rules::update_with_test_hooks(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            (
                || {},
                || {},
                || {},
                |_| Err(std::io::Error::other("injected removal failure")),
            ),
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreRuleLockCleanupFailed");
        assert!(error.message.contains("published"));
        assert!(error.message.contains("injected removal failure"));
        assert!(error.hint.unwrap().contains("index was not changed"));
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"/secret.log\n"
        );
        assert_eq!(
            fs::read(repository.path.join(".gitignore.lock")).unwrap(),
            b"/secret.log\n"
        );
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_reports_the_original_refusal_when_lock_cleanup_also_fails() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let ignore = repository.path.join(".gitignore");

        let error = ignore_rules::update_with_test_hooks(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            (
                || {},
                || fs::write(&ignore, b"# concurrent rules\n").unwrap(),
                || {},
                |_| Err(std::io::Error::other("injected removal failure")),
            ),
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreLockCleanupFailed");
        assert!(error.message.contains("appeared before the rule"));
        assert!(error.message.contains("injected removal failure"));
        assert!(error.hint.unwrap().contains(".gitignore.lock"));
        assert_eq!(fs::read(&ignore).unwrap(), b"# concurrent rules\n");
        assert_eq!(
            fs::read(repository.path.join(".gitignore.lock")).unwrap(),
            b"/secret.log\n"
        );
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn ignore_reports_completed_untracking_when_lock_cleanup_fails() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        repository.write(".gitignore", "/secret.log\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();

        let error = ignore_rules::update_with_test_hooks(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            (
                || {},
                || {},
                || {},
                |_| Err(std::io::Error::other("injected removal failure")),
            ),
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreLockCleanupFailed");
        assert!(error.message.contains("operation completed"));
        assert!(error.hint.unwrap().contains("index"));
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"/secret.log\n"
        );
        assert!(repository.path.join(".gitignore.lock").exists());
        assert_ne!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert!(
            run_git(&repository.path, &["ls-files", "-z"])
                .unwrap()
                .stdout
                .is_empty()
        );
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn ignore_preserves_a_replaced_lock_after_new_rule_publication() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let lock = repository.path.join(".gitignore.lock");
        let saved = repository.path.join(".git/saved-ignore-lock");

        let error = ignore_rules::update_with_test_hooks(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            (
                || {},
                || {},
                || {
                    fs::rename(&lock, &saved).unwrap();
                    fs::write(&lock, b"# another writer\n").unwrap();
                },
                |path| fs::remove_file(path),
            ),
        )
        .unwrap_err();

        assert_eq!(error.kind, "ignoreRuleLockCleanupFailed");
        assert!(error.hint.unwrap().contains("index was not changed"));
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"/secret.log\n"
        );
        assert_eq!(fs::read(&saved).unwrap(), b"/secret.log\n");
        assert_eq!(fs::read(&lock).unwrap(), b"# another writer\n");
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn ignore_does_not_remove_a_new_lock_after_existing_file_publication() {
        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        repository.write(".gitignore", "# original rules\n");
        let lock = repository.path.join(".gitignore.lock");

        ignore_rules::update_with_test_hooks(
            &repository.path,
            "/secret.log",
            "secret.log",
            true,
            (
                || {},
                || {},
                || fs::write(&lock, b"# another writer\n").unwrap(),
                |path| fs::remove_file(path),
            ),
        )
        .unwrap();

        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"# original rules\n/secret.log\n"
        );
        assert_eq!(fs::read(&lock).unwrap(), b"# another writer\n");
        assert!(
            run_git(&repository.path, &["ls-files", "-z"])
                .unwrap()
                .stdout
                .is_empty()
        );
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
    }

    #[test]
    #[cfg(unix)]
    fn ignore_refuses_ignore_file_swapped_to_fifo_without_blocking() {
        use std::os::unix::fs::FileTypeExt;
        use std::time::Duration;

        let repository = TestRepository::new();
        repository.write("secret.log", "committed\n");
        repository.git(&["add", "secret.log"]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "local edit\n");
        repository.write(".gitignore", "# original rules\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let root = repository.path.clone();
        let ignore = root.join(".gitignore");
        let original = root.join(".git/original-ignore");
        let (send, receive) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result =
                ignore_rules::update_with_hook(&root, "/secret.log", "secret.log", true, || {
                    fs::rename(&ignore, &original).unwrap();
                    rustix::fs::mkfifoat(
                        rustix::fs::CWD,
                        &ignore,
                        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
                    )
                    .unwrap();
                });
            send.send(result).unwrap();
        });
        let error = receive
            .recv_timeout(Duration::from_secs(3))
            .expect("ignore action blocked on a replaced FIFO")
            .expect_err("a FIFO must be refused");
        worker.join().unwrap();
        assert_eq!(error.kind, "invalidIgnoreFile");
        assert!(
            fs::symlink_metadata(repository.path.join(".gitignore"))
                .unwrap()
                .file_type()
                .is_fifo()
        );
        assert_eq!(
            fs::read(repository.path.join(".git/original-ignore")).unwrap(),
            b"# original rules\n"
        );
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"local edit\n"
        );
        assert!(!repository.path.join(".gitignore.lock").exists());
    }

    #[test]
    #[cfg(unix)]
    fn ignore_and_stop_tracking_treats_pattern_looking_filenames_literally() {
        for file in ["*.log", ":(glob)*.log", "[ab].log"] {
            let repository = TestRepository::new();
            repository.write(file, "selected\n");
            repository.write("a.log", "unrelated\n");
            repository.git(&["add", "."]);
            repository.git(&["commit", "-m", "Literal paths"]);
            #[cfg(not(target_os = "linux"))]
            repository.write(".gitignore", "");
            repository.write(file, "selected edit\n");
            ignore_path(&repository.path, file, "file", true).unwrap();
            let retained = run_git(&repository.path, &["ls-files", "-z"])
                .unwrap()
                .stdout;
            assert_eq!(retained, b"a.log\0", "untracking {file}");
            assert_eq!(
                fs::read(repository.path.join(file)).unwrap(),
                b"selected edit\n"
            );
            assert_eq!(
                fs::read(repository.path.join("a.log")).unwrap(),
                b"unrelated\n"
            );
        }
    }

    #[test]
    fn ignore_honors_an_existing_ignore_file_lock_without_changing_rules_or_index() {
        let repository = TestRepository::new();
        repository.write("secret.log", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "edit\n");
        repository.write(".gitignore", "# existing\n");
        repository.write(".gitignore.lock", "another writer\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let error = ignore_path(&repository.path, "secret.log", "file", true).unwrap_err();
        assert_eq!(error.kind, "ignoreLockUnavailable");
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"# existing\n"
        );
        assert_eq!(
            fs::read(repository.path.join(".gitignore.lock")).unwrap(),
            b"another writer\n"
        );
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
    }

    #[test]
    fn ignore_refuses_untracking_before_updating_rules_when_staged_contents_would_be_lost() {
        let repository = TestRepository::new();
        repository.write("secret.log", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "staged\n");
        repository.git(&["add", "secret.log"]);
        repository.write("secret.log", "worktree\n");
        repository.write(".gitignore", "# existing\n");
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        assert!(ignore_path(&repository.path, "secret.log", "file", true).is_err());
        assert_eq!(
            fs::read(repository.path.join(".gitignore")).unwrap(),
            b"# existing\n"
        );
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("secret.log")).unwrap(),
            b"worktree\n"
        );
    }

    #[test]
    fn ignore_preserves_duplicate_crlf_rules_and_refuses_directory_or_index_locks() {
        let repository = TestRepository::new();
        repository.write("secret.log", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Tracked file"]);
        repository.write("secret.log", "edit\n");
        let ignore = repository.path.join(".gitignore");
        fs::create_dir(&ignore).unwrap();
        assert!(ignore_path(&repository.path, "secret.log", "file", true).is_err());
        assert!(ignore.is_dir());
        assert!(!repository.path.join(".gitignore.lock").exists());
        fs::remove_dir(&ignore).unwrap();
        let existing = b"# existing\r\n/secret.log\r\n";
        fs::write(&ignore, existing).unwrap();
        repository.write(".git/index.lock", "other Git writer\n");
        assert!(ignore_path(&repository.path, "secret.log", "file", true).is_err());
        assert_eq!(fs::read(&ignore).unwrap(), existing);
        assert_eq!(
            fs::read(repository.path.join(".git/index.lock")).unwrap(),
            b"other Git writer\n"
        );
        assert!(!repository.path.join(".gitignore.lock").exists());
        fs::remove_file(repository.path.join(".git/index.lock")).unwrap();
        ignore_path(&repository.path, "secret.log", "file", true).unwrap();
        assert_eq!(fs::read(&ignore).unwrap(), existing);
        assert_eq!(
            run_git(&repository.path, &["ls-files", "-z"])
                .unwrap()
                .stdout,
            b""
        );
        assert!(!repository.path.join(".gitignore.lock").exists());
    }

    #[test]
    #[cfg(unix)]
    fn ignore_replaces_only_the_owned_entry_preserving_permissions_and_other_hard_links() {
        use std::os::unix::fs::PermissionsExt;
        let repository = TestRepository::new();
        repository.write("secret.log", "keep\n");
        let external = repository.path.join(".git/shared-ignore");
        fs::write(&external, b"# no final newline").unwrap();
        fs::set_permissions(&external, fs::Permissions::from_mode(0o600)).unwrap();
        let ignore = repository.path.join(".gitignore");
        fs::hard_link(&external, &ignore).unwrap();
        ignore_path(&repository.path, "secret.log", "file", false).unwrap();
        assert_eq!(fs::read(&external).unwrap(), b"# no final newline");
        assert_eq!(
            fs::read(&ignore).unwrap(),
            b"# no final newline\n/secret.log\n"
        );
        assert_eq!(
            fs::metadata(&ignore).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(!repository.path.join(".gitignore.lock").exists());
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

        let binary = b"\0git-khronos\xff\n";
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
    fn partially_stages_new_files_and_unstages_without_changing_working_bytes() {
        for committed in [false, true] {
            let repository = TestRepository::new();
            repository.write("other.txt", "keep this index entry\n");
            repository.git(&["add", "other.txt"]);
            if committed {
                repository.git(&["commit", "-m", "Base"]);
            }
            repository.write("new f.txt", "independent staged path\n");
            stage_path(&repository.path, "new f.txt").unwrap();
            let other = run_git(
                &repository.path,
                &["ls-files", "--stage", "--", "other.txt"],
            )
            .unwrap()
            .stdout;
            let file = "new [file].txt";
            let contents = "first\nsecond\nthird";
            repository.write(file, contents);
            repository.git(&["config", "diff.noprefix", "true"]);
            let preview = working_tree_file_diff(&repository.path, file, false).unwrap();
            apply_working_tree_lines_with_preview(
                &repository.path,
                file,
                false,
                0,
                &[0, 2],
                "stage",
                Some(&preview.patch),
            )
            .unwrap();
            assert_eq!(
                run_git(&repository.path, &["show", &format!(":{file}")])
                    .unwrap()
                    .stdout,
                b"first\nthird"
            );
            assert_eq!(
                fs::read(repository.path.join(file)).unwrap(),
                contents.as_bytes()
            );
            assert_eq!(
                run_git(
                    &repository.path,
                    &["ls-files", "--stage", "--", "other.txt"]
                )
                .unwrap()
                .stdout,
                other
            );
            apply_working_tree_lines(&repository.path, file, true, 0, &[0], "unstage").unwrap();
            assert_eq!(
                run_git(&repository.path, &["show", &format!(":{file}")])
                    .unwrap()
                    .stdout,
                b"third"
            );
            apply_working_tree_lines(&repository.path, file, true, 0, &[0], "unstage").unwrap();
            assert!(
                run_git(
                    &repository.path,
                    &["--literal-pathspecs", "ls-files", "--", file]
                )
                .unwrap()
                .stdout
                .is_empty()
            );
            assert_eq!(
                fs::read(repository.path.join(file)).unwrap(),
                contents.as_bytes()
            );
            apply_working_tree_hunk(&repository.path, file, false, 0, "stage").unwrap();
            assert_eq!(
                run_git(&repository.path, &["show", &format!(":{file}")])
                    .unwrap()
                    .stdout,
                contents.as_bytes()
            );
            unstage_path(&repository.path, file).unwrap();
            assert_eq!(
                run_git(&repository.path, &["show", ":new f.txt"])
                    .unwrap()
                    .stdout,
                b"independent staged path\n"
            );
            assert_eq!(
                fs::read(repository.path.join(file)).unwrap(),
                contents.as_bytes()
            );
        }
    }

    #[test]
    fn partial_new_file_unstage_keeps_quoted_path_headers_valid() {
        let repository = TestRepository::new();
        let file = "new \"quoted\".txt";
        repository.write(file, "first\nsecond\nthird\n");
        apply_working_tree_lines(&repository.path, file, false, 0, &[0, 2], "stage").unwrap();
        apply_working_tree_lines(&repository.path, file, true, 0, &[0], "unstage").unwrap();
        assert_eq!(
            run_git(&repository.path, &["show", &format!(":{file}")])
                .unwrap()
                .stdout,
            b"third\n"
        );
        assert_eq!(
            fs::read(repository.path.join(file)).unwrap(),
            b"first\nsecond\nthird\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_partial_new_symlink_targets_and_allows_whole_target_staging() {
        let repository = TestRepository::new();
        let target = "first\nsecond";
        std::os::unix::fs::symlink(target, repository.path.join("link")).unwrap();
        assert_eq!(
            apply_working_tree_lines(&repository.path, "link", false, 0, &[0], "stage")
                .unwrap_err()
                .kind,
            "partialSymlinkUnsupported"
        );
        assert!(
            run_git(&repository.path, &["ls-files", "--stage"])
                .unwrap()
                .stdout
                .is_empty()
        );
        apply_working_tree_hunk(&repository.path, "link", false, 0, "stage").unwrap();
        assert_eq!(
            run_git(&repository.path, &["show", ":link"])
                .unwrap()
                .stdout,
            target.as_bytes()
        );
        assert_eq!(
            fs::read_link(repository.path.join("link")).unwrap(),
            Path::new(target)
        );
    }

    #[test]
    fn new_file_line_staging_honors_crlf_attributes() {
        let repository = TestRepository::new();
        repository.write(".gitattributes", "*.txt text eol=lf\n");
        repository.write("new.txt", "first\r\nsecond\r\nthird\r\n");
        apply_working_tree_lines(&repository.path, "new.txt", false, 0, &[1], "stage").unwrap();
        assert_eq!(
            run_git(&repository.path, &["show", ":new.txt"])
                .unwrap()
                .stdout,
            b"second\n"
        );
        assert_eq!(
            fs::read(repository.path.join("new.txt")).unwrap(),
            b"first\r\nsecond\r\nthird\r\n"
        );
    }

    #[test]
    fn refuses_stale_new_file_selections_without_leaving_index_entries() {
        let repository = TestRepository::new();
        repository.write("new.txt", "first\nsecond\n");
        let preview = working_tree_file_diff(&repository.path, "new.txt", false).unwrap();
        repository.write("new.txt", "changed\nsecond\n");
        let error = apply_working_tree_lines_with_preview(
            &repository.path,
            "new.txt",
            false,
            0,
            &[0],
            "stage",
            Some(&preview.patch),
        )
        .unwrap_err();
        assert_eq!(error.kind, "staleDiffSelection");
        let error = apply_working_tree_hunk_with_preview(
            &repository.path,
            "new.txt",
            false,
            0,
            "stage",
            Some(&preview.patch),
        )
        .unwrap_err();
        assert_eq!(error.kind, "staleDiffSelection");
        assert!(
            run_git(&repository.path, &["ls-files", "--stage"])
                .unwrap()
                .stdout
                .is_empty()
        );
        assert_eq!(
            fs::read(repository.path.join("new.txt")).unwrap(),
            b"changed\nsecond\n"
        );
        stage_path(&repository.path, "new.txt").unwrap();
        let before = run_git(&repository.path, &["ls-files", "--stage"])
            .unwrap()
            .stdout;
        assert_eq!(
            apply_working_tree_lines_with_preview(
                &repository.path,
                "new.txt",
                false,
                0,
                &[0],
                "stage",
                Some(&preview.patch)
            )
            .unwrap_err()
            .kind,
            "staleDiffSelection",
        );
        assert_eq!(
            run_git(&repository.path, &["ls-files", "--stage"])
                .unwrap()
                .stdout,
            before
        );
    }

    #[test]
    fn refuses_nontext_and_invalid_new_file_selections_without_index_changes() {
        let repository = TestRepository::new();
        repository.write("new.txt", "first\nsecond\n");
        assert!(
            apply_working_tree_lines(&repository.path, "new.txt", false, 0, &[4], "stage").is_err()
        );
        assert!(
            apply_working_tree_lines(&repository.path, "new.txt", false, 0, &[0, 0], "stage")
                .is_err()
        );
        assert!(apply_working_tree_hunk(&repository.path, "new.txt", false, 0, "discard").is_err());
        fs::write(repository.path.join("binary"), b"\0binary\xff").unwrap();
        assert!(apply_working_tree_hunk(&repository.path, "binary", false, 0, "stage").is_err());
        fs::write(repository.path.join("invalid.txt"), b"line \xff\n").unwrap();
        assert_eq!(
            apply_working_tree_lines(&repository.path, "invalid.txt", false, 0, &[0], "stage")
                .unwrap_err()
                .kind,
            "unsupportedDiffEncoding"
        );
        assert!(
            run_git(&repository.path, &["ls-files", "--stage"])
                .unwrap()
                .stdout
                .is_empty()
        );
        assert_eq!(
            fs::read(repository.path.join("binary")).unwrap(),
            b"\0binary\xff"
        );
    }

    #[cfg(unix)]
    #[test]
    fn new_file_line_staging_preserves_executable_mode() {
        use std::os::unix::fs::PermissionsExt;
        let repository = TestRepository::new();
        repository.write("script.sh", "#!/bin/sh\necho first\necho second\n");
        fs::set_permissions(
            repository.path.join("script.sh"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        apply_working_tree_lines(&repository.path, "script.sh", false, 0, &[0, 2], "stage")
            .unwrap();
        let entry = run_git(
            &repository.path,
            &["ls-files", "--stage", "--", "script.sh"],
        )
        .unwrap();
        assert!(entry.stdout.starts_with(b"100755 "));
        assert_eq!(
            run_git(&repository.path, &["show", ":script.sh"])
                .unwrap()
                .stdout,
            b"#!/bin/sh\necho second\n"
        );
        apply_working_tree_lines(&repository.path, "script.sh", true, 0, &[1], "unstage").unwrap();
        assert!(
            run_git(
                &repository.path,
                &["ls-files", "--stage", "--", "script.sh"]
            )
            .unwrap()
            .stdout
            .starts_with(b"100755 ")
        );
        unstage_path(&repository.path, "script.sh").unwrap();
        repository.git(&["config", "core.filemode", "false"]);
        apply_working_tree_lines(&repository.path, "script.sh", false, 0, &[0], "stage").unwrap();
        assert!(
            run_git(
                &repository.path,
                &["ls-files", "--stage", "--", "script.sh"]
            )
            .unwrap()
            .stdout
            .starts_with(b"100644 ")
        );
    }

    #[test]
    fn refuses_truncated_new_file_selections_without_staging_any_contents() {
        let repository = TestRepository::new();
        repository.write(
            "large.txt",
            &"long line of content\n".repeat(MAX_FILE_DIFF_BYTES / 10),
        );
        assert!(
            working_tree_file_diff(&repository.path, "large.txt", false)
                .unwrap()
                .truncated
        );
        assert_eq!(
            apply_working_tree_lines(&repository.path, "large.txt", false, 0, &[0], "stage")
                .unwrap_err()
                .kind,
            "diffSelectionTooLarge"
        );
        assert!(
            run_git(&repository.path, &["ls-files", "--stage"])
                .unwrap()
                .stdout
                .is_empty()
        );
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
            "/definitely/missing/git-khronos-test-gpg",
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
            "/definitely/missing/git-khronos-test-gpg",
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
        )
        .unwrap();

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
    fn incomplete_signature_metadata_cannot_establish_a_valid_or_unsigned_status() {
        for output in [
            b"".as_slice(),
            b"G",
            b"G\0Signer",
            b"G\0Signer\0Key\0Fingerprint\0Trust",
            b"N",
        ] {
            assert_eq!(
                parse_commit_signature(output).unwrap_err().kind,
                "invalidCommitSignatureOutput"
            );
        }
        assert!(parse_commit_signature(b"unexpected\0\0\0\0\0body").is_err());
        let (signature, message) = parse_commit_signature(b"N\0\0\0\0\0body\0literal NUL").unwrap();
        assert_eq!(signature.status, "unsigned");
        assert_eq!(message, "body\0literal NUL");
    }

    #[test]
    fn file_history_decoder_rejects_incomplete_duplicate_and_invalid_frames() {
        let oid = "a".repeat(40);
        let frame = format!("{oid}\0Name\0mail@example.test\02026-01-01T00:00:00Z\0Subject\0\n");
        assert_eq!(
            parse_file_history_records(frame.as_bytes()).unwrap().len(),
            1
        );
        for end in 1..frame.len() {
            assert!(parse_file_history_records(&frame.as_bytes()[..end]).is_err());
        }
        assert!(parse_file_history_records(format!("{frame}{frame}").as_bytes()).is_err());
        assert!(
            parse_file_history_records(frame.replacen(&oid, "not-an-oid", 1).as_bytes()).is_err()
        );
        let sha256 = frame.replacen(&oid, &"a".repeat(64), 1);
        assert_eq!(
            parse_file_history_records(sha256.as_bytes()).unwrap()[0]
                .oid
                .len(),
            64
        );
    }

    #[test]
    fn commit_details_preserve_unicode_message_and_unsigned_status_under_log_presentation_settings()
    {
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "élève😀 summary\n\nUnicode élève😀 body"]);
        let oid = reference_tip(&repository.path, "HEAD").unwrap();
        repository.git(&["notes", "add", "-m", "Unexpected presentation note", &oid]);
        repository.git(&["config", "i18n.logOutputEncoding", "UTF-16"]);
        repository.git(&["config", "color.ui", "always"]);
        repository.git(&["config", "log.showNotes", "true"]);
        repository.git(&["config", "log.showSignature", "true"]);
        let details = commit_details(&repository.path, &oid).unwrap();
        assert_eq!(details.message, "élève😀 summary\n\nUnicode élève😀 body");
        assert_eq!(details.signature.status, "unsigned");
        assert!(details.signature.signer.is_none());
        assert!(details.signature.key.is_none());
    }

    #[test]
    fn file_history_preserves_unicode_and_separator_bytes_without_phantom_entries() {
        let repository = TestRepository::new();
        let name = "Élodie\x1ffield\x1erecord";
        repository.git(&["config", "user.name", name]);
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Root"]);
        let first = reference_tip(&repository.path, "HEAD").unwrap();
        repository.write("file.txt", "updated\n");
        repository.git(&["add", "."]);
        let subject = format!(
            "élève😀\x1ffield\x1erecord\x1e{}\x1fForged\x1ffake@example.test\x1f2020-01-01T00:00:00Z\x1fInjected",
            "f".repeat(40)
        );
        repository.git(&["commit", "-m", &subject]);
        let last = reference_tip(&repository.path, "HEAD").unwrap();
        for encoding in ["UTF-8", "UTF-16"] {
            repository.git(&["config", "i18n.logOutputEncoding", encoding]);
            let history = file_history(&repository.path, &last, "file.txt").unwrap();
            assert_eq!(history.len(), 2, "File history admitted a forged record");
            assert_eq!(history[0].oid, last);
            assert_eq!(history[1].oid, first);
            assert_eq!(history[0].subject, subject);
            assert_eq!(history[0].author_name, name);
        }
    }

    #[test]
    fn file_history_refuses_oversized_metadata_without_partial_results_or_repository_changes() {
        let repository = TestRepository::new();
        repository.write("file.txt", "owned contents\n");
        repository.git(&["add", "file.txt"]);
        fs::write(
            repository.path.join(".git/large-message"),
            "m".repeat(2 * 1024 * 1024 + 1),
        )
        .unwrap();
        repository.git(&["commit", "-F", ".git/large-message"]);
        let oid = reference_tip(&repository.path, "HEAD").unwrap();
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        let result = file_history(&repository.path, &oid, "file.txt");
        assert!(
            matches!(result, Err(ref error) if error.kind == "historyOutputLimit"),
            "Oversized file-history metadata must fail instead of returning a large or partial result"
        );
        assert_eq!(reference_tip(&repository.path, "HEAD").unwrap(), oid);
        assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read(repository.path.join("file.txt")).unwrap(),
            b"owned contents\n"
        );
    }

    #[test]
    fn signature_presence_requires_complete_headers_and_not_message_or_mergetag_content() {
        assert!(
            commit_has_signature_header(b"tree abc\ngpgsig signature\n continuation\n\nmessage")
                .unwrap()
        );
        assert!(
            commit_has_signature_header(b"tree abc\ngpgsig-sha256 signature\n\nmessage").unwrap()
        );
        assert!(!commit_has_signature_header(b"tree abc\n\nmessage\ngpgsig not-a-header").unwrap());
        assert!(
            !commit_has_signature_header(
                b"tree abc\nmergetag signed tag\n gpgsig nested\n\nmessage"
            )
            .unwrap()
        );
        assert_eq!(
            commit_has_signature_header(b"tree abc\ngpgsig incomplete")
                .unwrap_err()
                .kind,
            "commitSignatureHeaderIncomplete"
        );
        assert_eq!(
            parse_commit_signature(b"?\0\0\0\0\0message")
                .unwrap_err()
                .kind,
            "invalidCommitSignatureOutput"
        );
        assert_eq!(
            parse_commit_signature(b"").unwrap_err().kind,
            "invalidCommitSignatureOutput"
        );
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
            Some("Summary placeholder\n\nDescribe why this change is needed.\n")
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
            "/definitely/missing/git-khronos-signing-diagnostic",
        ]);
        repository.git(&["config", "user.signingKey", "A1B2C3D4"]);

        let diagnostic = signing_diagnostic(&repository.path).expect("diagnose missing signer");

        assert!(!diagnostic.available);
        assert_eq!(
            diagnostic.program,
            "/definitely/missing/git-khronos-signing-diagnostic"
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
    fn stash_delete_rejects_a_shifted_selected_object_before_capture_or_mutation() {
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "file.txt"]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("file.txt", "selected\n");
        stash(&repository.path).unwrap();
        let selected = reference_tip(&repository.path, "refs/stash").unwrap();
        repository.write("file.txt", "newer\n");
        stash(&repository.path).unwrap();
        let before = read_stashes(&repository.path).unwrap();
        let error = drop_stash_checked(&repository.path, "stash@{0}", &selected).unwrap_err();
        assert_eq!(error.kind, "staleStash");
        assert!(operation_recoveries(&repository.path).unwrap().is_empty());
        assert_eq!(
            serde_json::to_value(read_stashes(&repository.path).unwrap()).unwrap(),
            serde_json::to_value(&before).unwrap()
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("file.txt")).unwrap(),
            "base\n"
        );
        drop_stash_checked(&repository.path, "stash@{1}", &selected).unwrap();
        let after = read_stashes(&repository.path).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].oid, before[0].oid);
    }

    #[test]
    fn selected_stash_apply_and_pop_reject_shifted_ordinals_and_restore_only_the_selected_object() {
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("file.txt", "selected\n");
        stash(&repository.path).unwrap();
        let selected = reference_tip(&repository.path, "refs/stash").unwrap();
        repository.write("file.txt", "newer\n");
        stash(&repository.path).unwrap();
        let newer = reference_tip(&repository.path, "refs/stash").unwrap();
        let index = fs::read(repository.path.join(".git/index")).unwrap();
        for operation in [apply_stash_checked, pop_stash_checked] {
            assert_eq!(
                operation(&repository.path, "stash@{0}", &selected)
                    .unwrap_err()
                    .kind,
                "staleStash"
            );
            assert_eq!(fs::read(repository.path.join(".git/index")).unwrap(), index);
            assert_eq!(
                fs::read_to_string(repository.path.join("file.txt")).unwrap(),
                "base\n"
            );
            assert_eq!(read_stashes(&repository.path).unwrap().len(), 2);
            assert!(operation_recoveries(&repository.path).unwrap().is_empty());
        }
        apply_stash_checked(&repository.path, "stash@{1}", &selected).unwrap();
        assert_eq!(
            fs::read_to_string(repository.path.join("file.txt")).unwrap(),
            "selected\n"
        );
        assert_eq!(read_stashes(&repository.path).unwrap().len(), 2);
        repository.git(&["restore", "file.txt"]);
        pop_stash_checked(&repository.path, "stash@{1}", &selected).unwrap();
        assert_eq!(
            fs::read_to_string(repository.path.join("file.txt")).unwrap(),
            "selected\n"
        );
        let remaining = read_stashes(&repository.path).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].oid, newer);
    }

    #[test]
    fn stash_preview_is_utf8_and_excludes_presentation_notes_and_colour() {
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("file.txt", "saved élève😀\n");
        repository.write("*.tmp", "untracked saved\n");
        stash_with_message(&repository.path, Some("élève😀 selected stash")).unwrap();
        let oid = reference_tip(&repository.path, "refs/stash").unwrap();
        let expected = run_git(
            &repository.path,
            &[
                "show",
                "-s",
                "--encoding=UTF-8",
                "--no-notes",
                "--no-show-signature",
                "--format=%B",
                &oid,
            ],
        )
        .unwrap();
        repository.git(&["notes", "add", "-m", "Unexpected preview note", &oid]);
        repository.git(&["config", "i18n.logOutputEncoding", "UTF-16"]);
        repository.git(&["config", "log.showNotes", "true"]);
        repository.git(&["config", "color.ui", "always"]);
        let details = stash_details(&repository.path, "stash@{0}").unwrap();
        assert_eq!(details.oid, oid);
        assert_eq!(
            details.message,
            String::from_utf8(expected.stdout).unwrap().trim_end()
        );
        assert!(!details.message.contains('\0'));
        assert!(details.files.iter().any(|file| file.path == "file.txt"));
        assert!(details.files.iter().any(|file| file.path == "*.tmp"));
        assert_eq!(details.files.len(), 2);
        let patch = stash_file_diff(&repository.path, "stash@{0}", "file.txt", None).unwrap();
        assert!(patch.patch.contains("saved élève😀"));
        assert!(!patch.patch.contains('\u{1b}'));
    }

    #[test]
    fn stash_previews_pin_message_files_stats_and_untracked_diffs_after_stack_renumbering() {
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("file.txt", "selected\n");
        repository.write("*.tmp", "selected untracked\n");
        stash_with_message(&repository.path, Some("Selected stash")).unwrap();
        let selected = reference_tip(&repository.path, "refs/stash").unwrap();
        repository.write("other.txt", "newer unrelated\n");
        stash_with_message(&repository.path, Some("Newer stash")).unwrap();
        let details = stash_details_at_oid(&repository.path, &selected).unwrap();
        assert_eq!(details.oid, selected);
        assert!(details.message.contains("Selected stash"));
        assert_eq!(details.signature.status, "unsigned");
        assert_eq!(details.files.len(), 2);
        assert!(details.files.iter().all(|file| file.path != "other.txt"));
        for file in &details.files {
            let patch =
                stash_file_diff_at_oid(&repository.path, &selected, &file.path, None).unwrap();
            assert_eq!(patch.oid, selected);
            assert!(patch.patch.contains("selected"));
            assert!(!patch.patch.contains("newer unrelated"));
        }
        assert!(
            stash_details(&repository.path, "stash@{0}")
                .unwrap()
                .message
                .contains("Newer stash")
        );
        assert!(stash_details_at_oid(&repository.path, "--all").is_err());
        assert!(stash_file_diff_at_oid(&repository.path, "--all", "file.txt", None).is_err());
    }

    #[test]
    fn stash_preview_bounds_large_messages_and_refuses_an_incomplete_signature_header() {
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("file.txt", "saved\n");
        stash(&repository.path).unwrap();
        let raw = run_git(&repository.path, &["cat-file", "commit", "refs/stash"]).unwrap();
        let raw = String::from_utf8(raw.stdout).unwrap();
        let (headers, _) = raw.split_once("\n\n").unwrap();
        for large_header in [false, true] {
            let payload = if large_header {
                format!(
                    "{headers}\ngpgsig signature\n {}\n\nSmall message\n",
                    "x".repeat(MAX_COMMIT_DETAILS_BYTES)
                )
            } else {
                format!("{headers}\n\n{}\n", "é".repeat(MAX_COMMIT_MESSAGE_BYTES))
            };
            let output = run_git_with_input_output(
                &repository.path,
                &["hash-object", "-t", "commit", "-w", "--stdin"],
                payload.as_bytes(),
            )
            .unwrap();
            ensure_success("create owned bounded preview fixture", &output).unwrap();
            let oid = String::from_utf8(output.stdout).unwrap().trim().to_owned();
            let result = stash_details_at_oid(&repository.path, &oid);
            if large_header {
                assert_eq!(result.unwrap_err().kind, "commitSignatureHeaderIncomplete");
            } else {
                let details = result.unwrap();
                assert!(details.message.ends_with("[Commit message truncated]"));
                assert!(details.message.len() < MAX_COMMIT_MESSAGE_BYTES + 100);
                assert_eq!(details.signature.status, "unsigned");
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn stash_preview_does_not_execute_signature_helpers_or_call_signed_objects_unsigned() {
        use std::os::unix::fs::PermissionsExt;
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("file.txt", "saved\n");
        stash(&repository.path).unwrap();
        let raw = run_git(&repository.path, &["cat-file", "commit", "refs/stash"]).unwrap();
        let raw = String::from_utf8(raw.stdout).unwrap();
        let (headers, body) = raw.split_once("\n\n").unwrap();
        let signed = format!(
            "{headers}\ngpgsig -----BEGIN PGP SIGNATURE-----\n bogus\n -----END PGP SIGNATURE-----\n\n{body}"
        );
        let output = run_git_with_input_output(
            &repository.path,
            &["hash-object", "-t", "commit", "-w", "--stdin"],
            signed.as_bytes(),
        )
        .unwrap();
        ensure_success("create owned signed-looking stash", &output).unwrap();
        let oid = String::from_utf8(output.stdout).unwrap().trim().to_owned();
        repository.git(&["update-ref", "refs/stash", &oid]);
        repository.write(
            "signature-helper",
            "#!/bin/sh\nprintf invoked > \"${0%/*}/signature-helper-invoked\"\nexit 1\n",
        );
        let helper = repository.path.join("signature-helper");
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        repository.git(&["config", "gpg.program", helper.to_str().unwrap()]);
        repository.git(&["config", "log.showSignature", "true"]);
        let baseline = run_git(
            &repository.path,
            &["show", "-s", "--show-signature", "--format=%B", &oid],
        )
        .unwrap();
        ensure_success("exercise owned signature helper", &baseline).unwrap();
        let marker = repository.path.join("signature-helper-invoked");
        assert!(marker.exists());
        fs::remove_file(&marker).unwrap();
        let details = stash_details(&repository.path, "stash@{0}").unwrap();
        assert!(
            !marker.exists(),
            "Stash preview executed a signature presentation helper"
        );
        assert_eq!(details.signature.status, "unverifiable");
        assert_eq!(details.files.len(), 1);
    }

    #[test]
    fn selected_pop_reports_applied_but_retained_when_only_removal_is_locked() {
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Root"]);
        let head = reference_tip(&repository.path, "HEAD");
        repository.write("file.txt", "saved\n");
        stash(&repository.path).unwrap();
        let selected = reference_tip(&repository.path, "refs/stash").unwrap();
        repository.write(".git/refs/stash.lock", "owned lock\n");
        let error = pop_stash_checked(&repository.path, "stash@{0}", &selected).unwrap_err();
        assert_eq!(error.kind, "stashAppliedButRetained");
        assert!(error.hint.unwrap().contains("Do not apply or pop"));
        assert_eq!(reference_tip(&repository.path, "HEAD"), head);
        assert_eq!(
            reference_tip(&repository.path, "refs/stash"),
            Some(selected.clone())
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("file.txt")).unwrap(),
            "saved\n"
        );
        // Refused removal leaves the original stash reachable; the unused
        // deletion recovery capture is correctly discarded by its owner.
        assert!(operation_recoveries(&repository.path).unwrap().is_empty());
    }

    #[test]
    fn selected_pop_keeps_the_stash_and_conflict_stages_when_apply_conflicts() {
        let repository = TestRepository::new();
        repository.write("file.txt", "base\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("file.txt", "saved\n");
        stash(&repository.path).unwrap();
        let selected = reference_tip(&repository.path, "refs/stash").unwrap();
        repository.write("file.txt", "changed upstream\n");
        repository.git(&["add", "."]);
        repository.git(&["commit", "-m", "Upstream"]);
        let error = pop_stash_checked(&repository.path, "stash@{0}", &selected).unwrap_err();
        assert_eq!(error.kind, "gitFailure");
        assert!(error.hint.unwrap().contains("stash was kept"));
        assert_eq!(
            reference_tip(&repository.path, "refs/stash"),
            Some(selected)
        );
        assert!(
            !run_git(&repository.path, &["ls-files", "-u"])
                .unwrap()
                .stdout
                .is_empty()
        );
        assert!(operation_recoveries(&repository.path).unwrap().is_empty());
    }

    #[test]
    fn selected_stash_actions_use_the_captured_object_when_a_merge_driver_renumbers_the_stack() {
        for pop in [false, true] {
            let repository = TestRepository::new();
            repository.write(".gitattributes", "file.txt merge=owned\n");
            repository.write("file.txt", "base\n");
            repository.git(&["add", "."]);
            repository.git(&["commit", "-m", "Root"]);
            repository.write("file.txt", "selected\n");
            stash(&repository.path).unwrap();
            let selected = reference_tip(&repository.path, "refs/stash").unwrap();
            repository.write("file.txt", "other saved contents\n");
            stash(&repository.path).unwrap();
            let newer = reference_tip(&repository.path, "refs/stash").unwrap();
            repository.git(&["stash", "drop", "stash@{0}"]);
            repository.write("file.txt", "upstream\n");
            repository.git(&["add", "."]);
            repository.git(&["commit", "-m", "Upstream"]);
            repository.git(&[
                "config",
                "merge.owned.driver",
                &format!("git stash store -m 'Concurrent owned stash' {newer} && cat '%B' > '%A'"),
            ]);
            let result = if pop {
                pop_stash_checked(&repository.path, "stash@{0}", &selected)
            } else {
                apply_stash_checked(&repository.path, "stash@{0}", &selected)
            };
            if pop {
                assert_eq!(result.unwrap_err().kind, "stashAppliedButRetained");
            } else {
                result.unwrap();
            }
            assert_eq!(
                fs::read_to_string(repository.path.join("file.txt")).unwrap(),
                "selected\n"
            );
            let stashes = read_stashes(&repository.path).unwrap();
            assert_eq!(stashes.len(), 2);
            assert_eq!(stashes[0].oid, newer);
            assert_eq!(stashes[1].oid, selected);
            assert!(operation_recoveries(&repository.path).unwrap().is_empty());
        }
    }

    #[test]
    fn deleting_long_external_stash_labels_preserves_the_complete_recovery_object() {
        let repository = TestRepository::new();
        repository.write("story.txt", "base\n");
        repository.git(&["add", "story.txt"]);
        repository.git(&["commit", "-m", "Root"]);
        repository.write("story.txt", "complete saved contents\n");
        let message = "élève😀".repeat(1000);
        repository.git(&["stash", "push", "-m", &message]);
        let oid = reference_tip(&repository.path, "refs/stash").unwrap();
        let original = run_git(&repository.path, &["cat-file", "commit", &oid])
            .unwrap()
            .stdout;
        repository.git(&["config", "i18n.logOutputEncoding", "UTF-16"]);
        drop_stash(&repository.path, "stash@{0}").unwrap();
        assert!(read_stashes(&repository.path).unwrap().is_empty());
        let capture = operation_recoveries(&repository.path)
            .unwrap()
            .into_iter()
            .find(|entry| entry.snapshot_oid.as_deref() == Some(oid.as_str()))
            .unwrap();
        assert!(capture.label.starts_with("Delete stash: "));
        assert!(capture.label.ends_with('…'));
        assert!(capture.label.len() < 4096);
        assert!(!capture.label.chars().any(char::is_control));
        assert_eq!(
            run_git(&repository.path, &["cat-file", "commit", &oid])
                .unwrap()
                .stdout,
            original
        );
        restore_operation_branch(&repository.path, &capture.id, "restored-stash").unwrap();
        assert_eq!(
            fs::read_to_string(repository.path.join("story.txt")).unwrap(),
            "complete saved contents\n"
        );
    }

    #[test]
    fn stash_record_decoder_preserves_duplicate_objects_but_rejects_malformed_frames() {
        let oid = "a".repeat(40);
        let record = |reference: &str, object: &str| {
            format!("{reference}\0{object}\0Message\u{1e}record\u{1f}field\0\n").into_bytes()
        };
        let first = record("stash@{0}", &oid);
        let second = record("stash@{1}", &oid);
        let entries = parse_stash_records(&[first.as_slice(), second.as_slice()].concat()).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].oid, entries[1].oid);
        assert_ne!(entries[0].reference, entries[1].reference);
        for end in 1..first.len() {
            assert!(
                parse_stash_records(&first[..end]).is_err(),
                "Accepted truncated stash prefix {end}"
            );
        }
        assert!(parse_stash_records(&[first.as_slice(), first.as_slice()].concat()).is_err());
        assert!(parse_stash_records(&record("stash@{999}", &oid)).is_err());
        assert!(parse_stash_records(&record("HEAD", &oid)).is_err());
        assert!(parse_stash_records(&record("stash@{0}", "invalid")).is_err());
        assert_eq!(
            parse_stash_records(&record("stash@{0}", &"b".repeat(64))).unwrap()[0]
                .oid
                .len(),
            64
        );
        assert!(parse_stash_records(b"").unwrap().is_empty());
    }

    #[test]
    fn stash_listing_preserves_control_characters_without_forged_entries() {
        let repository = TestRepository::new();
        repository.write("story.txt", "base\n");
        repository.git(&["add", "story.txt"]);
        repository.git(&["commit", "-m", "Root"]);
        let forged = "f".repeat(40);
        let messages = [
            format!(
                "Older élève\u{1f}field\u{1e}stash@{{999}}\u{1f}{forged}\u{1f}Forged stash\u{1e}After"
            ),
            "Newer élève\u{1e}record\u{1f}field".to_owned(),
        ];
        let mut oids = Vec::new();
        for (index, message) in messages.iter().enumerate() {
            repository.write("story.txt", &format!("saved {index}\n"));
            stash_with_message(&repository.path, Some(message)).unwrap();
            let output = run_git(&repository.path, &["rev-parse", "refs/stash"]).unwrap();
            oids.push(String::from_utf8(output.stdout).unwrap().trim().to_owned());
        }
        let expected = oids
            .iter()
            .rev()
            .enumerate()
            .map(|(index, oid)| {
                let reference = format!("stash@{{{index}}}");
                let output = run_git(
                    &repository.path,
                    &[
                        "log",
                        "-g",
                        "-1",
                        "--encoding=UTF-8",
                        "--format=%gs",
                        &reference,
                    ],
                )
                .unwrap();
                ensure_success("read owned stash label independently", &output).unwrap();
                StashEntry {
                    reference,
                    oid: oid.clone(),
                    message: String::from_utf8(output.stdout)
                        .unwrap()
                        .strip_suffix('\n')
                        .unwrap()
                        .to_owned(),
                }
            })
            .collect::<Vec<_>>();
        for encoding in ["UTF-8", "UTF-16"] {
            repository.git(&["config", "i18n.logOutputEncoding", encoding]);
            repository.git(&["config", "log.date", "iso-strict"]);
            let actual = read_stashes(&repository.path).unwrap();
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                serde_json::to_value(&expected).unwrap()
            );
        }
        repository.git(&["stash", "store", "-m", "Duplicate owned stash", &oids[0]]);
        let duplicate = read_stashes(&repository.path).unwrap();
        assert_eq!(
            duplicate.iter().map(|entry| &entry.oid).collect::<Vec<_>>(),
            vec![&oids[0], &oids[1], &oids[0]]
        );
        drop_stash(&repository.path, "stash@{0}").unwrap();
        let renamed = "Renamed élève\u{1f}field\u{1e}record";
        rename_stash(&repository.path, "stash@{1}", &oids[0], renamed).unwrap();
        assert_eq!(read_stashes(&repository.path).unwrap()[1].message, renamed);
        apply_stash(&repository.path, "stash@{1}").unwrap();
        assert_eq!(
            fs::read_to_string(repository.path.join("story.txt")).unwrap(),
            "saved 0\n"
        );
        repository.git(&["restore", "--", "story.txt"]);
        drop_stash(&repository.path, "stash@{0}").unwrap();
        let remaining = read_stashes(&repository.path).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].oid, oids[0]);
        pop_stash_entry(&repository.path, "stash@{0}").unwrap();
        assert!(read_stashes(&repository.path).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(repository.path.join("story.txt")).unwrap(),
            "saved 0\n"
        );
    }

    #[test]
    fn creates_a_recovery_branch_without_changing_head_or_working_files() {
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
        repository.write("staged.txt", "staged\n");
        repository.git(&["add", "--", "staged.txt"]);
        repository.write("history.txt", "unstaged\n");
        repository.write("untracked.txt", "untracked\n");
        let before = snapshot(&repository.path).expect("snapshot before recovery");
        let index_before = run_git(&repository.path, &["diff", "--cached", "--", "staged.txt"])
            .expect("read index before recovery")
            .stdout;

        create_branch_reference(&repository.path, "recovery/first", &first_oid)
            .expect("preserve first commit");
        let after = snapshot(&repository.path).expect("snapshot after recovery");
        let branch = after
            .branches
            .iter()
            .find(|branch| branch.name == "recovery/first")
            .expect("recovery branch exists");
        assert_eq!(branch.oid, first_oid);
        assert!(!branch.current);
        assert_eq!(after.status.branch, before.status.branch);
        assert_eq!(after.head_oid, before.head_oid);
        assert_eq!(
            run_git(&repository.path, &["diff", "--cached", "--", "staged.txt"])
                .expect("read index after recovery")
                .stdout,
            index_before
        );
        assert_eq!(
            (
                after.status.staged,
                after.status.unstaged,
                after.status.untracked
            ),
            (
                before.status.staged,
                before.status.unstaged,
                before.status.untracked
            )
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("history.txt")).expect("read working file"),
            "unstaged\n"
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("staged.txt")).expect("read staged file"),
            "staged\n"
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("untracked.txt")).expect("read untracked file"),
            "untracked\n"
        );
        assert!(create_branch_reference(&repository.path, "recovery/first", &first_oid).is_err());
        assert!(create_branch_reference(&repository.path, "-invalid", &first_oid).is_err());
        assert!(
            create_branch_reference(&repository.path, "recovery/invalid", "not-an-oid").is_err()
        );
        assert!(
            create_branch_reference(&repository.path, "recovery/missing", &"0".repeat(40)).is_err()
        );
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
    fn tag_names_remain_exact_when_a_branch_has_the_same_name() {
        let repository = TestRepository::new();
        repository.write("release.txt", "shared name\n");
        stage_all(&repository.path).unwrap();
        commit(&repository.path, "Release").unwrap();
        let oid = snapshot(&repository.path).unwrap().head_oid.unwrap();
        create_tag(&repository.path, "main", &oid, Some("Main release")).unwrap();

        for ambiguous in ["true", "false"] {
            repository.git(&["config", "core.warnAmbiguousRefs", ambiguous]);
            let tags = read_tags(&repository.path).unwrap();
            assert_eq!(tags.len(), 1);
            assert_eq!(tags[0].full_name, "refs/tags/main");
            assert_eq!(tags[0].name, "main");
            assert_eq!(tags[0].oid, oid);
            assert_eq!(
                tag_details(&repository.path, &tags[0].name).unwrap().oid,
                oid
            );
        }

        let tag = read_tags(&repository.path).unwrap().remove(0);
        delete_local_tag(&repository.path, &tag.name, &tag.oid).unwrap();
        assert!(read_tags(&repository.path).unwrap().is_empty());
        let after = snapshot(&repository.path).unwrap();
        assert_eq!(after.head_oid.as_deref(), Some(oid.as_str()));
        assert_eq!(
            run_git(&repository.path, &["symbolic-ref", "--short", "HEAD"])
                .unwrap()
                .stdout,
            b"main\n"
        );
        assert_eq!(
            fs::read(repository.path.join("release.txt")).unwrap(),
            b"shared name\n"
        );
    }

    #[test]
    fn branch_names_and_upstreams_remain_exact_when_tags_share_their_names() {
        let repository = TestRepository::new();
        repository.write("release.txt", "shared names\n");
        stage_all(&repository.path).unwrap();
        commit(&repository.path, "Release").unwrap();
        let oid = snapshot(&repository.path).unwrap().head_oid.unwrap();
        repository.git(&["remote", "add", "origin", "."]);
        repository.git(&["update-ref", "refs/remotes/origin/main", &oid]);
        repository.git(&[
            "branch",
            "--set-upstream-to=refs/remotes/origin/main",
            "main",
        ]);
        for name in ["main", "origin/main"] {
            create_tag(&repository.path, name, &oid, None).unwrap();
        }
        for ambiguous in ["true", "false"] {
            repository.git(&["config", "core.warnAmbiguousRefs", ambiguous]);
            let status = snapshot(&repository.path).unwrap().status;
            for tracking in [true, false] {
                let branches = read_branches(&repository.path, &status, tracking).unwrap();
                let local = branches
                    .iter()
                    .find(|b| b.full_name == "refs/heads/main")
                    .unwrap();
                assert_eq!(local.name, "main");
                assert!(local.current && !local.remote);
                assert_eq!(local.upstream.as_deref(), Some("origin/main"));
                let remote = branches
                    .iter()
                    .find(|b| b.full_name == "refs/remotes/origin/main")
                    .unwrap();
                assert_eq!(remote.name, "origin/main");
                assert!(remote.remote && !remote.current);
            }
        }
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
            Some("Git Khronos 2.0 release"),
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
            "Git Khronos 2.0 release"
        );
        let details = tag_details(&repository.path, "v2.0.0").expect("read annotated tag");
        assert!(details.annotated);
        assert_eq!(details.oid, oid);
        assert_eq!(details.message.as_deref(), Some("Git Khronos 2.0 release"));
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

        let branch = set_submodule_tracking_branch(
            &repository.path,
            &SubmoduleTrackingBranchChange {
                path: "vendor/engine".into(),
                expected_tracking_branch: None,
                tracking_branch: Some("main".into()),
            },
        )
        .expect("set submodule tracking branch");
        assert_eq!(branch.previous_tracking_branch, None);
        assert_eq!(branch.tracking_branch.as_deref(), Some("main"));
        assert_eq!(
            review_submodule_state(&repository.path)
                .expect("review configured branch")
                .entries[0]
                .tracking_branch
                .as_deref(),
            Some("main")
        );
        assert_eq!(
            set_submodule_tracking_branch(
                &repository.path,
                &SubmoduleTrackingBranchChange {
                    path: "vendor/engine".into(),
                    expected_tracking_branch: None,
                    tracking_branch: Some("release".into()),
                },
            )
            .unwrap_err()
            .kind,
            "submoduleTrackingBranchRefused"
        );
        set_submodule_tracking_branch(
            &repository.path,
            &SubmoduleTrackingBranchChange {
                path: "vendor/engine".into(),
                expected_tracking_branch: Some("main".into()),
                tracking_branch: Some(".".into()),
            },
        )
        .expect("track the parent branch name");
        set_submodule_tracking_branch(
            &repository.path,
            &SubmoduleTrackingBranchChange {
                path: "vendor/engine".into(),
                expected_tracking_branch: Some(".".into()),
                tracking_branch: None,
            },
        )
        .expect("restore remote default branch");
        assert_eq!(
            set_submodule_tracking_branch(
                &repository.path,
                &SubmoduleTrackingBranchChange {
                    path: "vendor/engine".into(),
                    expected_tracking_branch: None,
                    tracking_branch: Some("bad branch".into()),
                },
            )
            .unwrap_err()
            .kind,
            "invalidSubmoduleTrackingBranch"
        );

        repository.git(&["submodule", "deinit", "-f", "--", "vendor/engine"]);
        let deinitialized = snapshot(&repository.path).expect("snapshot deinitialized submodule");
        assert!(!deinitialized.submodules[0].initialized);
        assert_eq!(
            update_all_submodules_cancellable(&repository.path, &CancellationToken::default())
                .unwrap_err()
                .kind,
            "submodulesNotInitialized"
        );
        initialize_all_submodules(&repository.path).expect("initialize all submodules");
        assert!(
            snapshot(&repository.path)
                .expect("snapshot bulk initialized submodule")
                .submodules[0]
                .initialized
        );
        repository.git(&["submodule", "deinit", "-f", "--", "vendor/engine"]);
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

        dependency.write("engine.txt", "version three\n");
        stage_all(&dependency.path).expect("stage second dependency update");
        commit(&dependency.path, "Dependency v3").expect("commit second dependency update");
        repository.write("vendor/engine/engine.txt", "local edit\n");
        assert_eq!(
            update_all_submodules_cancellable(&repository.path, &CancellationToken::default())
                .unwrap_err()
                .kind,
            "submoduleUpdateUnsafe"
        );
        repository.git(&["-C", "vendor/engine", "restore", "--", "engine.txt"]);
        update_all_submodules_cancellable(&repository.path, &CancellationToken::default())
            .expect("update all submodules");
        let bulk_updated = snapshot(&repository.path).expect("snapshot bulk updated submodule");
        assert!(bulk_updated.submodules[0].out_of_sync);
        assert_ne!(
            bulk_updated.submodules[0].head_oid,
            updated.submodules[0].head_oid
        );
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
