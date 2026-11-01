import type { IncomingLinksController } from './incoming-links-controller';
import { Injectable, computed, signal } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { ipc } from '@git-khronos/contracts';
import { invokeCommand, type SnapshotCommand, type StatusCommand, type MutationOptions, type CommandArgs } from '@git-khronos/contracts';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  CommitComparison,
  CommitDetails,
  CommitFile,
  CommitFileDiff,
  CommitHistoryPage,
  CommitPolicy,
  ConflictDetails,
  DiscardPreview,
  DiscardRecovery,
  FileBlameLine,
  FileHistoryEntry,
  FetchOptions,
  InteractiveRebasePlan,
  InteractiveRebaseStep,
  MergeRebasePlan,
  MergeRebaseRequest,
  OperationRecovery,
  PatchRequest,
  ReflogPage,
  ResetMode,
  ResetPreview,
  RepositoryStatus,
  RepositorySnapshot,
  IncomingRepositoryLinkState,
  OpenedRepositoryLink,
  RepositoryLinkReadPolicy,
  SigningDiagnostic,
  StashOptions,
  StashEntry,
  SystemInfo,
  TagDetails,
  TrackedFileSearch,
  WorkingTreeFileDiff,
  WorktreeMove,
  WorktreeRepair,
  WorktreeRegistrationReview,
  LfsTrackingRules,
  LfsFileAttributes,
  LfsObjects,
  LfsFetchPreview,
  LfsCheckoutPreview,
  LfsPrunePreview,
} from '@git-khronos/contracts';
import {
  checkoutHistoryTarget,
  createCheckoutHistoryEntry,
  createHeadHistoryEntry,
  createRenameBranchHistoryEntry,
  headHistoryTarget,
  renameBranchHistoryTarget,
  type OperationHistoryEntry,
} from './operation-history';
import { FAVORITE_REPOSITORIES_KEY, toggleFavoriteRepository } from './repository-favorites';
import { reorderRepositoryTabs } from './repository-tabs';
import { reconcileCommitHistory } from './commit-history';
import {
  predictDiscardPath,
  predictStageAll,
  predictStagePath,
  predictUnstageAll,
  predictUnstagePath,
  preserveUntrackedEntries,
} from './working-tree-status';

const RECENTS_KEY = 'git-khronos.recent-repositories.v1';
const OPEN_TABS_KEY = 'git-khronos.open-repositories.v1';
const ACTIVE_PATH_KEY = 'git-khronos.active-repository.v1';
const REPOSITORY_ALIASES_KEY = 'git-khronos.repository-aliases.v1';
const WORKSPACES_KEY = 'git-khronos.workspaces.v1';
const ACTIVE_WORKSPACE_KEY = 'git-khronos.active-workspace.v1';
const DEFAULT_WORKSPACE_ID = 'default';

export type ActivityReporter = (message: string) => void;

interface WorkingTreeMutationResult {
  succeeded: boolean;
  // Recheck after awaiting: later navigation must keep its own inspection.
  inspectionRequest: number;
}

interface MutationInspection {
  workingTree: number;
  conflict: number;
}

function sameItems<T>(left: readonly T[], right: readonly T[], key: (item: T) => string): boolean {
  return left.length === right.length && left.every((item, index) => key(item) === key(right[index]));
}

function sameRepositoryStatus(left: RepositoryStatus, right: RepositoryStatus): boolean {
  return left.branch === right.branch
    && left.ahead === right.ahead
    && left.behind === right.behind
    && left.staged === right.staged
    && left.unstaged === right.unstaged
    && left.untracked === right.untracked
    && left.conflicted === right.conflicted
    && left.mergeInProgress === right.mergeInProgress
    && left.historyOperation === right.historyOperation
    && left.historyNoCommit === right.historyNoCommit
    && left.rebaseInProgress === right.rebaseInProgress
    && left.rebaseEditStopped === right.rebaseEditStopped
    && left.rebaseSplit?.preparing === right.rebaseSplit?.preparing
    && left.rebaseSplit?.partCount === right.rebaseSplit?.partCount
    && left.rebaseSplit?.treeMatches === right.rebaseSplit?.treeMatches
    && !!left.mailPatchInProgress === !!right.mailPatchInProgress
    && left.bisectInProgress === right.bisectInProgress
    && left.entryCount === right.entryCount
    && left.entriesTruncated === right.entriesTruncated
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      return !!other
        && entry.path === other.path
        && entry.indexStatus === other.indexStatus
        && entry.worktreeStatus === other.worktreeStatus
        && entry.conflicted === other.conflicted;
    });
}

function createPreviewConflictStatus(
  status: RepositoryStatus,
  operation: Partial<Pick<RepositoryStatus, 'mergeInProgress' | 'historyOperation'>>,
): RepositoryStatus {
  let conflictInserted = false;
  const entries = status.entries.map((entry) => {
    if (entry.conflicted) {
      conflictInserted = true;
      return entry;
    }
    if (conflictInserted) return entry;
    conflictInserted = true;
    return { ...entry, indexStatus: 'U', worktreeStatus: 'U', conflicted: true };
  });
  const ordinaryEntries = entries.filter((entry) => !entry.conflicted);
  const untracked = ordinaryEntries.filter((entry) => entry.indexStatus === '?').length;
  return {
    ...status,
    ...operation,
    staged: ordinaryEntries.filter((entry) => entry.indexStatus !== ' ' && entry.indexStatus !== '!' && entry.indexStatus !== '?').length,
    unstaged: ordinaryEntries.filter((entry) => entry.indexStatus !== '?' && entry.worktreeStatus !== ' ' && entry.worktreeStatus !== '!').length,
    untracked,
    conflicted: entries.filter((entry) => entry.conflicted).length,
    entries,
  };
}

export interface ActivityLogEntry {
  id: number;
  timestamp: string;
  description: string;
  durationMs: number | null;
  status: 'running' | 'success' | 'error' | 'cancelled';
  repositoryId: string | null;
  detail: string | null;
  operationId: string | null;
  cancelable: boolean;
}

export interface RepositoryWorkspace {
  id: string;
  name: string;
  repositoryPaths: string[];
  activeRepositoryPath: string | null;
}

interface ClosedRepository {
  path: string;
  preview: RepositorySnapshot | null;
}

@Injectable({ providedIn: 'root' })
export class GitKhronosService {
  readonly systemInfo = signal<SystemInfo | null>(null);
  readonly browserPreview = computed(() => this.systemInfo()?.appVersion === 'browser preview');
  readonly repositories = signal<RepositorySnapshot[]>([]);
  readonly activeRepositoryId = signal<string | null>(null);
  readonly workspaces = signal<RepositoryWorkspace[]>(this.readWorkspaces());
  readonly activeWorkspaceId = signal(this.readActiveWorkspaceId(this.workspaces()));
  readonly activeWorkspace = computed(() => this.workspaces().find(
    (workspace) => workspace.id === this.activeWorkspaceId(),
  ) ?? this.workspaces()[0]);
  readonly repository = computed(
    () => this.repositories().find((repository) => repository.id === this.activeRepositoryId()) ?? null,
  );
  readonly incomingRepositoryLinks = signal<IncomingRepositoryLinkState>({ requests: [], overflowed: false });
  readonly incomingRepositoryLinksPending = signal(false);
  readonly incomingRepositoryLinksReady = signal(false);
  readonly incomingRepositoryLinksLoading = signal(false);
  private readonly incomingLinksSupported = signal(false);
  private readonly incomingLinksReadError = signal('');
  private readonly incomingLinksListenError = signal('');
  readonly incomingRepositoryLinksError = computed(() => this.incomingLinksSupported()
    ? [this.incomingLinksReadError(), this.incomingLinksListenError()].filter(Boolean).join(' ') : '');
  private incomingInitializationRequest = 0;
  private incomingControllerRequest = 0;
  private incomingController: IncomingLinksController | null = null;
  private incomingControllerLoad: Promise<IncomingLinksController | null> | null = null;
  private repositoryLinkPolicyRequest = 0;
  readonly repositoryLinkPolicies = signal<Partial<Record<string, RepositoryLinkReadPolicy>>>({});
  readonly recentPaths = signal<string[]>(this.readRecents());
  readonly favoritePaths = signal<string[]>(this.readFavorites());
  readonly unpinnedRecentPaths = computed(() => {
    const favorites = new Set(this.favoritePaths());
    return this.recentPaths().filter((path) => !favorites.has(path));
  });
  readonly repositoryAliases = signal<Record<string, string>>(this.readAliases());
  readonly recentlyClosedRepositoryPath = signal<string | null>(null);
  readonly busy = signal(false);
  private runningOperations = 0;
  readonly backgroundFetchBusy = signal(false);
  readonly backgroundFetchRepositoryId = signal<string | null>(null);
  readonly backgroundFetchLastAt = signal<Record<string, number>>({});
  readonly backgroundFetchErrors = signal<Record<string, string>>({});
  readonly historyLoading = signal(false);
  private historyRequest: { repoId: string } | null = null;
  readonly changesLoading = signal(false);
  readonly trackedFileSearch = signal<TrackedFileSearch | null>(null);
  readonly trackedFileSearchBusy = signal(false);
  readonly reflog = signal<ReflogPage | null>(null);
  readonly reflogBusy = signal(false);
  readonly signingDiagnosticBusy = signal(false);
  private readonly signingDiagnostics = signal<Record<string, SigningDiagnostic>>({});
  readonly signingDiagnostic = computed(() => {
    const repositoryId = this.activeRepositoryId();
    return repositoryId ? this.signingDiagnostics()[repositoryId] ?? null : null;
  });
  readonly activity = signal('Ready');
  readonly activityLogs = signal<ActivityLogEntry[]>([]);
  readonly cancellingOperationIds = signal<string[]>([]);
  readonly activeActivity = computed(() =>
    [...this.activityLogs()].reverse().find((entry) => entry.status === 'running') ?? null,
  );
  readonly activeOperationCancelling = computed(() => {
    const operationId = this.activeActivity()?.operationId;
    return !!operationId && this.cancellingOperationIds().includes(operationId);
  });
  readonly error = signal<string | null>(null);
  private lastFailureKind: string | null = null;
  readonly commitDetails = signal<CommitDetails | null>(null);
  readonly commitFileDiff = signal<CommitFileDiff | null>(null);
  readonly selectedCommitFile = signal<string | null>(null);
  readonly inspectedStashReference = signal<string | null>(null);
  readonly commitComparison = signal<CommitComparison | null>(null);
  readonly comparisonFileDiff = signal<CommitFileDiff | null>(null);
  readonly selectedComparisonFile = signal<string | null>(null);
  readonly detailsBusy = signal(false);
  readonly tagDetails = signal<TagDetails | null>(null);
  readonly tagDetailsBusy = signal(false);
  readonly workingTreeFileDiff = signal<WorkingTreeFileDiff | null>(null);
  readonly selectedWorkingTreeFile = signal<string | null>(null);
  readonly conflictDetails = signal<ConflictDetails | null>(null);
  private conflictRepositoryId: string | null = null;
  private conflictRequest = 0;
  readonly fileHistory = signal<FileHistoryEntry[] | null>(null);
  readonly fileBlame = signal<FileBlameLine[] | null>(null);
  readonly fileBlameStart = signal(1);
  readonly fileBlameNext = signal<number | null>(null);
  readonly fileBlameError = signal<string | null>(null);
  private fileBlameTarget: { repoId: string; revision: string; path: string } | null = null;
  private fileBlameRequestedLine = 1;
  readonly fileInsightBusy = signal(false);
  private readonly operationHistory = signal<Record<string, OperationHistoryEntry>>({});
  readonly undoLabel = computed(() => {
    const repoId = this.activeRepositoryId();
    const entry = repoId ? this.operationHistory()[repoId] : null;
    return entry && !entry.undone ? `Undo ${entry.label}` : null;
  });
  readonly redoLabel = computed(() => {
    const repoId = this.activeRepositoryId();
    const entry = repoId ? this.operationHistory()[repoId] : null;
    return entry?.undone ? `Redo ${entry.label}` : null;
  });

  private detailsRequest = 0;
  private historyComparisonRequest: number | null = null;
  private readonly workspaceRepositoryCache = new Map<string, RepositorySnapshot[]>();
  private tagDetailsRequest = 0;
  private readonly tagDetailsCache = new Map<string, TagDetails>();
  private readonly previewBisectOriginalHeads = new Map<string, string>();
  private fileRequest = 0;
  private workingTreeRequest = 0;
  private fileInsightRequest = 0;
  private trackedFileSearchRequest = 0;
  private reflogRequest = 0;
  private nextActivityId = 1;
  private readonly liveRefreshes = new Set<string>();
  private readonly statusGenerations = new Map<string, number>();
  private readonly pendingWorkingTreeMutations = new Map<string, number>();
  private readonly deferredMetadataRefreshes = new Set<string>();
  private closedRepositories: ClosedRepository[] = [];

  async initialize(): Promise<void> {
    const initialization = ++this.incomingInitializationRequest;
    this.incomingRepositoryLinksReady.set(false);
    try {
      const info = await ipc.system_info();
      if (initialization !== this.incomingInitializationRequest) return;
      this.systemInfo.set(info);
    } catch (error: unknown) {
      if (initialization !== this.incomingInitializationRequest) return;
      if (isTauri()) {
        this.error.set(this.formatError(error));
        this.activity.set('Desktop initialization failed');
        return;
      }
      this.systemInfo.set({
        appVersion: 'browser preview',
        gitVersion: null,
        gitSupported: false,
        minimumGitVersion: '2.39.0',
      });
      const activeWorkspace = this.activeWorkspace();
      const shouldShowPreview = activeWorkspace?.id === DEFAULT_WORKSPACE_ID
        || Boolean(activeWorkspace?.repositoryPaths.length);
      if (typeof window !== 'undefined'
        && shouldShowPreview
        && !new URLSearchParams(window.location.search).has('welcome-preview')) {
        const preview = createRepositoryPreview();
        const previewOptions = new URLSearchParams(window.location.search);
        if (previewOptions.has('lfs-preview')) {
          preview.lfs = {
            enabled: true,
            available: true,
            version: 'git-lfs/3.7.1',
            trackedFiles: 12,
            pointerFiles: 2,
          };
        }
        if (previewOptions.has('sparse-preview')) {
          preview.sparseCheckout = {
            enabled: true,
            coneMode: true,
            sparseIndex: true,
            paths: ['apps/desktop', 'crates/git-core'],
          };
        }
        if (previewOptions.has('signing-preview')) {
          preview.signing = {
            enabled: true,
            format: 'ssh',
            key: '~/.ssh/id_ed25519.pub',
          };
        }
        const hostingPreview = previewOptions.get('hosting-preview');
        if (hostingPreview === 'gitlab') {
          preview.remotes = [{
            name: 'origin',
            fetchUrl: 'git@gitlab.com:example/platform/git-khronos.git',
            pushUrl: 'git@gitlab.com:example/platform/git-khronos.git',
          }];
        } else if (hostingPreview === 'bitbucket') {
          preview.remotes = [{
            name: 'origin',
            fetchUrl: 'git@bitbucket.org:example/git-khronos.git',
            pushUrl: 'git@bitbucket.org:example/git-khronos.git',
          }];
        }
        if (previewOptions.has('clean-preview')) {
          preview.status = {
            ...preview.status,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            entryCount: 0,
            entries: [],
          };
          preview.worktrees = preview.worktrees.map((worktree) => worktree.current
            ? { ...worktree, changes: 0 }
            : worktree);
        }
        if (previewOptions.has('untracked-directory-preview')) {
          preview.status = {
            ...preview.status,
            untracked: preview.status.untracked + 1,
            entryCount: preview.status.entryCount + 1,
            entries: [...preview.status.entries, {
              path: 'generated/',
              indexStatus: '?',
              worktreeStatus: '?',
              conflicted: false,
            }],
          };
        }
        if (previewOptions.has('unmerged-branch-preview')) {
          const unmergedOid = 'd478a94f7c0e2c7708f26c931a17b7a031895b36';
          const baseOid = 'ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2';
          preview.commits.splice(1, 0, {
            oid: unmergedOid,
            parents: [baseOid],
            authorName: 'Nora Singh',
            authorEmail: 'nora@example.test',
            authoredAt: '2026-10-03T09:55:00Z',
            subject: 'Prototype command history',
            description: 'Explore a separate interaction without merging it.',
            decorations: ['experiment/command-history'],
          });
          preview.branches.push({
            fullName: 'refs/heads/experiment/command-history',
            name: 'experiment/command-history',
            oid: unmergedOid,
            current: false,
            remote: false,
            upstream: null,
            tracking: null,
          });
        }
        if (previewOptions.has('merge-preview')) {
          preview.status = createPreviewConflictStatus(preview.status, { mergeInProgress: true });
        }
        const historyPreview = previewOptions.get('history-preview');
        if (historyPreview === 'cherry-pick' || historyPreview === 'revert') {
          preview.status = createPreviewConflictStatus(preview.status, { historyOperation: historyPreview });
        }
        const showWorktreeTabs = previewOptions.has('worktree-tabs');
        const linkedWorktree = preview.worktrees.find((worktree) => !worktree.current);
        const repositories = showWorktreeTabs && linkedWorktree
          ? [preview, {
              ...preview,
              id: `${preview.id}-worktree`,
              name: linkedWorktree.path.split(/[\\/]/).at(-1) ?? preview.name,
              path: linkedWorktree.path,
              status: { ...preview.status, branch: linkedWorktree.branch },
              worktrees: preview.worktrees.map((worktree) => ({
                ...worktree,
                current: worktree.path === linkedWorktree.path,
              })),
            }]
          : [preview];
        this.repositories.set(repositories);
        this.activeRepositoryId.set(preview.id);
        this.activity.set('Repository preview');
      }
      this.incomingRepositoryLinksReady.set(true);
      return;
    }

    await this.connectIncomingRepositoryLinks();
    if (initialization !== this.incomingInitializationRequest) return;
    await this.refreshIncomingRepositoryLinks();
    if (initialization !== this.incomingInitializationRequest) return;
    await this.refreshRepositoryLinkPolicies();
    if (initialization !== this.incomingInitializationRequest) return;
    try {
      await this.restoreRepositories();
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
      this.activity.set('Could not restore saved repositories');
    } finally {
      if (initialization === this.incomingInitializationRequest) this.incomingRepositoryLinksReady.set(true);
    }
  }

  private async loadIncomingLinksController(): Promise<IncomingLinksController | null> {
    if (this.incomingController) return this.incomingController;
    if (this.incomingControllerLoad) return this.incomingControllerLoad;
    const request = ++this.incomingControllerRequest;
    const loading = import('./incoming-links-controller').then(({ IncomingLinksController }) => {
      if (request !== this.incomingControllerRequest) return null;
      return this.incomingController = new IncomingLinksController({
        state: this.incomingRepositoryLinks, pending: this.incomingRepositoryLinksPending,
        loading: this.incomingRepositoryLinksLoading, supported: this.incomingLinksSupported,
        readError: this.incomingLinksReadError, listenError: this.incomingLinksListenError,
        refreshPolicies: () => this.refreshRepositoryLinkPolicies(),
      });
    }).catch(() => {
      if (request === this.incomingControllerRequest) {
        this.incomingLinksSupported.set(true); this.incomingRepositoryLinksPending.set(true);
        this.incomingLinksReadError.set('Incoming link controls could not load. Preserve drafts and retry or restart.');
      }
      return null;
    }).finally(() => { if (request === this.incomingControllerRequest) this.incomingControllerLoad = null; });
    this.incomingControllerLoad = loading;
    return loading;
  }

  private async connectIncomingRepositoryLinks(): Promise<void> { await (await this.loadIncomingLinksController())?.connect(); }
  async refreshIncomingRepositoryLinks(): Promise<void> { await (await this.loadIncomingLinksController())?.refresh(); }
  async retryIncomingRepositoryLinks(): Promise<void> { await (await this.loadIncomingLinksController())?.retry(); }
  async acknowledgeIncomingRepositoryLink(id: string): Promise<boolean> { return await (await this.loadIncomingLinksController())?.acknowledge(id) ?? false; }
  async dismissIncomingRepositoryLinkOverflow(): Promise<void> { await (await this.loadIncomingLinksController())?.dismissOverflow(); }

  stopIncomingRepositoryLinks(): void {
    ++this.incomingInitializationRequest; ++this.incomingControllerRequest;
    this.incomingController?.stop(); this.incomingController = null;
    this.incomingControllerLoad = null; this.incomingRepositoryLinksLoading.set(false);
  }

  async refreshRepositoryLinkPolicies(): Promise<void> {
    const request = ++this.repositoryLinkPolicyRequest;
    try {
      const policies = await ipc.repository_link_read_policies();
      if (request === this.repositoryLinkPolicyRequest && policies && typeof policies === 'object') this.repositoryLinkPolicies.set(policies);
    } catch { /* A failed policy query must not resume a paused native session. */ }
  }

  acceptRepositoryLink(opened: OpenedRepositoryLink): void {
    ++this.repositoryLinkPolicyRequest;
    this.repositoryLinkPolicies.update(policies => ({ ...policies,
      [opened.repository.id]: { noLazyReads: true, autoFetchPaused: true },
    }));
    this.acceptOpenedRepository(opened.repository, 'Opened local repository link', message => this.activity.set(message));
  }

  async resumeRepositoryLinkAutoFetch(): Promise<void> {
    const repoId = this.activeRepositoryId();
    if (!repoId) return;
    await this.run('Resuming automatic fetch…', async report => {
      await ipc.resume_repository_link_auto_fetch({ repoId });
      ++this.repositoryLinkPolicyRequest;
      this.repositoryLinkPolicies.update(policies => ({ ...policies,
        [repoId]: { noLazyReads: policies[repoId]?.noLazyReads ?? true, autoFetchPaused: false },
      }));
      report('Automatic fetch schedule resumed');
    }, repoId);
  }

  async chooseRepository(): Promise<void> {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Open a Git repository' });
      if (typeof selected === 'string') await this.openRepository(selected);
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  async chooseDirectory(title: string): Promise<string | null> {
    try {
      const selected = await open({ directory: true, multiple: false, title });
      return typeof selected === 'string' ? selected : null;
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
      return null;
    }
  }

  async openRepository(path: string): Promise<void> {
    let openedRepositoryId: string | null = null;
    await this.run('Opening repository…', async report => {
      const snapshot = await ipc.open_repository({ path });
      openedRepositoryId = snapshot.id;
      this.storeSnapshot(snapshot, true);
      this.activeRepositoryId.set(snapshot.id);
      this.clearInspection();
      this.remember(snapshot.path);
      this.persistOpenTabs();
      this.forgetClosedRepository(snapshot.path);
      report(`Opened ${snapshot.name}`);
    });
    if (openedRepositoryId) this.deferMetadataRefresh(openedRepositoryId);
  }

  async cloneRepository(
    remote: string,
    parentPath: string,
    folder: string,
    options: { branch?: string; depth?: number; recurseSubmodules?: boolean } = {},
  ): Promise<boolean> {
    const operationId = crypto.randomUUID();
    await this.run(`Cloning ${folder.trim() || 'repository'}…`, async report => {
      const snapshot = await ipc.clone_repository({
        remote: remote.trim(),
        parentPath,
        folder: folder.trim(),
        branch: options.branch?.trim() || null,
        depth: options.depth ?? null,
        recurseSubmodules: options.recurseSubmodules ?? false,
        operationId,
      });
      this.acceptOpenedRepository(snapshot, `Cloned ${snapshot.name}`, report);
    }, null, operationId);
    return !this.error();
  }

  async cloneHostedRepository(contextId: string, token: string, operationId: string): Promise<boolean> {
    const outcome = await this.run('Cloning reviewed hosted repository…', async report => {
      const snapshot = await ipc.execute_hosted_clone({ contextId, token, operationId });
      this.acceptOpenedRepository(snapshot, `Cloned ${snapshot.name}`, report);
    }, null, operationId);
    return outcome === 'success';
  }

  async initializeRepository(
    parentPath: string,
    folder: string,
    initialBranch: string,
    createReadme: boolean,
  ): Promise<boolean> {
    await this.run('Creating repository…', async report => {
      const snapshot = await ipc.initialize_repository({
        parentPath,
        folder: folder.trim(),
        initialBranch: initialBranch.trim(),
        createReadme,
      });
      this.acceptOpenedRepository(snapshot, `Created ${snapshot.name}`, report);
    });
    return !this.error();
  }

  async refresh(): Promise<void> {
    const repo = this.repository();
    if (!repo) return;
    await this.run('Refreshing…', async report => {
      await this.storeRefreshedSnapshot(await ipc.refresh_repository({ repoId: repo.id }));
      this.deferredMetadataRefreshes.delete(repo.id);
      report('Repository refreshed');
    }, repo.id);
  }

  async refreshWorkspaceOverview(): Promise<Record<string, { at: number | null; error: string | null }>> {
    const results: Record<string, { at: number | null; error: string | null }> = {};
    if (this.busy() || this.browserPreview()) return results;
    const workspaceId = this.activeWorkspaceId();
    const repositories = [...this.repositories()];
    await this.run('Refreshing workspace overview…', async report => {
      for (const repository of repositories) {
        if (this.activeWorkspaceId() !== workspaceId) break;
        if (!this.repositories().some(item => item.id === repository.id && item.path === repository.path)) continue;
        const generation = this.statusGeneration(repository.id);
        try {
          const snapshot = await ipc.refresh_repository({ repoId: repository.id });
          const status = await ipc.refresh_repository_status({ repoId: repository.id });
          if (this.activeWorkspaceId() !== workspaceId || generation !== this.statusGeneration(repository.id)) continue;
          if (snapshot.id !== repository.id || snapshot.path !== repository.path || snapshot.status.branch !== status.branch) {
            results[repository.id] = { at: null, error: 'Repository context changed during refresh; retry to read a consistent checkout' };
            continue;
          }
          this.storeSnapshot({ ...snapshot, status });
          results[repository.id] = { at: Date.now(), error: null };
        } catch (error: unknown) {
          results[repository.id] = { at: null, error: this.formatError(error) };
        }
      }
      const failed = Object.values(results).filter(result => result.error).length;
      report(failed ? `Workspace refreshed with ${failed} unavailable repositories` : 'Workspace overview refreshed');
    });
    return results;
  }

  async refreshRepositoryInBackground(repositoryId: string): Promise<boolean> {
    const repository = this.repositories().find((candidate) => candidate.id === repositoryId);
    if (!repository
      || this.browserPreview()
      || this.busy()
      || this.backgroundFetchRepositoryId() === repositoryId
      || this.liveRefreshes.has(repositoryId)) return false;
    this.liveRefreshes.add(repositoryId);
    const generation = this.statusGeneration(repositoryId);
    try {
      const snapshot = await ipc.refresh_repository({ repoId: repositoryId });
      if (generation !== this.statusGeneration(repositoryId)) return true;
      await this.storeRefreshedSnapshot(snapshot);
      this.deferredMetadataRefreshes.delete(repositoryId);
      return true;
    } catch {
      return false;
    } finally {
      this.liveRefreshes.delete(repositoryId);
    }
  }

  async refreshStatusInBackground(
    repositoryId: string | null = this.activeRepositoryId(),
    force = false,
  ): Promise<boolean> {
    const repository = this.repositories().find((candidate) => candidate.id === repositoryId);
    if (!repository
      || this.browserPreview()
      || (!force && (this.busy()
        || this.backgroundFetchRepositoryId() === repository.id
        || this.liveRefreshes.has(repository.id)))) return false;
    this.liveRefreshes.add(repository.id);
    const generation = this.statusGeneration(repository.id);
    try {
      const status = await ipc.refresh_repository_status({ repoId: repository.id });
      const currentRepository = this.repositories().find((candidate) => candidate.id === repository.id);
      if (!currentRepository) return false;
      // Preserve pending predictions and results from newer mutations.
      if (generation !== this.statusGeneration(repository.id)
        || this.pendingWorkingTreeMutations.has(repository.id)) return true;
      if (status.branch !== currentRepository.status.branch) {
        const snapshot = await ipc.refresh_repository({ repoId: repository.id });
        // Branch changes need metadata too, but its fast status omits untracked
        // discovery. Reconcile it just like other metadata refreshes.
        if (generation === this.statusGeneration(repository.id)) await this.storeRefreshedSnapshot(snapshot);
      } else {
        this.storeStatus(repository.id, status);
      }
      return true;
    } catch {
      return false;
    } finally {
      this.liveRefreshes.delete(repository.id);
    }
  }

  async fetchInBackground(repositoryId: string | null = this.activeRepositoryId()): Promise<boolean> {
    const repository = this.repositories().find((candidate) => candidate.id === repositoryId);
    if (!repository || this.incomingRepositoryLinksPending() || this.repositoryLinkPolicies()[repository.id]?.autoFetchPaused || this.browserPreview() || this.busy() || this.backgroundFetchBusy()) return false;
    // An explicit fetch retries a failure; timers must not repeatedly retry authentication.
    if (this.backgroundFetchErrors()[repository.id]) return false;
    this.backgroundFetchBusy.set(true);
    this.backgroundFetchRepositoryId.set(repository.id);
    this.backgroundFetchErrors.update((errors) => {
      const updated = { ...errors };
      delete updated[repository.id];
      return updated;
    });
    const generation = this.statusGeneration(repository.id);
    try {
      const snapshot = await ipc.sync_repository({ repoId: repository.id });
      // Reconciliation itself ignores repositories closed while fetch ran.
      if (snapshot && generation === this.statusGeneration(repository.id)) {
        await this.storeRefreshedSnapshot(snapshot);
      }
      if (this.repositories().some((candidate) => candidate.id === repository.id)) {
        this.backgroundFetchLastAt.update((timestamps) => ({
          ...timestamps,
          [repository.id]: Date.now(),
        }));
      }
      return true;
    } catch (error: unknown) {
      this.backgroundFetchErrors.update((errors) => ({
        ...errors,
        [repository.id]: this.formatError(error),
      }));
      return false;
    } finally {
      this.backgroundFetchBusy.set(false);
      this.backgroundFetchRepositoryId.set(null);
    }
  }

  async openRepositoryInFileManager(repoId = this.activeRepositoryId()): Promise<void> {
    const repository = this.repositories().find((candidate) => candidate.id === repoId);
    if (!repository) return;
    await this.run('Opening repository folder…', async report => {
      await ipc.open_repository_in_file_manager({ repoId: repository.id });
      report('Repository folder opened');
    }, repository.id);
  }

  async openExternalUrl(url: string, successMessage = 'Link opened'): Promise<void> {
    if (!url.startsWith('https://')) {
      this.error.set('Only secure HTTPS links can be opened.');
      return;
    }
    if (this.browserPreview()) {
      window.open(url, '_blank', 'noopener,noreferrer');
      this.activity.set(successMessage);
      return;
    }
    await this.run('Opening link…', async report => {
      await ipc.open_external_url({ url });
      report(successMessage);
    }, this.activeRepositoryId());
  }

  async toggleFullscreen(): Promise<void> {
    this.error.set(null);
    try {
      await ipc.toggle_fullscreen();
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
    }
  }

  async loadMoreHistory(): Promise<boolean> {
    const repository = this.repository();
    if (!repository?.historyTruncated || this.historyLoading()) return false;
    const request = { repoId: repository.id };
    this.historyRequest = request;
    this.historyLoading.set(true);
    this.error.set(null);
    try {
      const page = await ipc.load_more_commits({
        repoId: repository.id,
      });
      if (this.historyRequest !== request) return false;
      this.repositories.update((repositories) => repositories.map((candidate) => {
        if (candidate.id !== repository.id) return candidate;
        const known = new Set(candidate.commits.map((commit) => commit.oid));
        return {
          ...candidate,
          commits: [...candidate.commits, ...page.commits.filter((commit) => !known.has(commit.oid))],
          historyTruncated: page.historyTruncated,
        };
      }));
      return true;
    } catch (error: unknown) {
      if (this.historyRequest === request) this.error.set(this.formatError(error));
      return false;
    } finally {
      if (this.historyRequest === request) {
        this.historyRequest = null;
        this.historyLoading.set(false);
      }
    }
  }

  async searchTrackedFiles(query: string, limit = 30): Promise<void> {
    const repository = this.repository();
    const normalized = query.trim();
    const request = ++this.trackedFileSearchRequest;
    if (!repository || !normalized) {
      this.trackedFileSearch.set(null);
      this.trackedFileSearchBusy.set(false);
      return;
    }
    this.trackedFileSearchBusy.set(true);
    try {
      const result = this.browserPreview()
        ? (() => {
          const paths = [...new Set(repository.status.entries.map((entry) => entry.path))]
            .filter((path) => path.toLocaleLowerCase().includes(normalized.toLocaleLowerCase()))
            .slice(0, limit);
          return { paths, truncated: false };
        })()
        : await ipc.search_tracked_files({
          repoId: repository.id,
          query: normalized,
          limit,
        });
      if (request === this.trackedFileSearchRequest && repository.id === this.activeRepositoryId()) {
        this.trackedFileSearch.set(result);
      }
    } catch {
      if (request === this.trackedFileSearchRequest) this.trackedFileSearch.set(null);
    } finally {
      if (request === this.trackedFileSearchRequest) this.trackedFileSearchBusy.set(false);
    }
  }

  clearTrackedFileSearch(): void {
    this.trackedFileSearchRequest += 1;
    this.trackedFileSearch.set(null);
    this.trackedFileSearchBusy.set(false);
  }

  async loadReflog(): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const request = ++this.reflogRequest;
    this.reflogBusy.set(true);
    this.error.set(null);
    try {
      const result: ReflogPage = this.browserPreview()
        ? {
            entries: repository.commits.slice(0, 12).map((commit, index) => ({
              oid: commit.oid,
              selector: `HEAD@{${index}}`,
              subject: `${index === 0 ? 'commit' : index === 1 ? 'merge' : 'commit'}: ${commit.subject}`,
              authorName: commit.authorName,
              authorEmail: commit.authorEmail,
            })),
            truncated: false,
          }
        : await ipc.load_reflog({ repoId: repository.id });
      if (request === this.reflogRequest && repository.id === this.activeRepositoryId()) {
        this.reflog.set(result);
      }
    } catch (error: unknown) {
      if (request === this.reflogRequest) this.error.set(this.formatError(error));
    } finally {
      if (request === this.reflogRequest) this.reflogBusy.set(false);
    }
  }

  clearReflog(): void {
    this.reflogRequest += 1;
    this.reflog.set(null);
    this.reflogBusy.set(false);
  }

  async loadMoreChanges(force = false): Promise<void> {
    const repository = this.repository();
    if (!repository || (!force && !repository.status.entriesTruncated) || this.changesLoading()) return;
    const generation = this.statusGeneration(repository.id);
    this.changesLoading.set(true);
    this.error.set(null);
    try {
      if (this.browserPreview()) {
        const entries = repository.status.entries.flatMap((entry) =>
          entry.indexStatus === '?' && entry.path.endsWith('/')
            ? [{ ...entry, path: `${entry.path}example.txt` }]
            : [entry]);
        this.storeStatus(repository.id, { ...repository.status, entries, entriesTruncated: false });
        return;
      }
      const status = await ipc.load_more_changes({
        repoId: repository.id,
      });
      if (generation === this.statusGeneration(repository.id)) this.storeStatus(repository.id, status);
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
    } finally {
      this.changesLoading.set(false);
    }
  }

  async stageAll(): Promise<void> {
    await this.mutateWorkingTree('stage_all', 'Staging all changes…', 'All changes staged', {}, predictStageAll);
  }

  async unstageAll(): Promise<void> {
    await this.mutateWorkingTree('unstage_all', 'Unstaging changes…', 'All changes unstaged', {}, predictUnstageAll);
  }

  async stagePath(path: string): Promise<void> {
    await this.mutateWorkingTree('stage_path', `Staging ${path}…`, 'File staged', { path },
      (status) => predictStagePath(status, path));
  }

  async unstagePath(path: string): Promise<void> {
    await this.mutateWorkingTree('unstage_path', `Unstaging ${path}…`, 'File unstaged', { path },
      (status) => predictUnstagePath(status, path));
  }

  async discardPath(path: string, untracked: boolean): Promise<void> {
    const repositoryId = this.activeRepositoryId();
    const result = await this.mutateWorkingTree('discard_path', `Discarding changes in ${path}…`, 'Changes discarded', {
      path,
      untracked,
    }, (status) => predictDiscardPath(status, path));
    if (repositoryId && result.succeeded) {
      this.recordDiscard(repositoryId, untracked ? 'Discard Untracked File' : 'Discard Changes');
    }
  }

    async previewDiscard(paths: string[] | null): Promise<DiscardPreview | null> {
      const repository = this.repository();
      if (!repository) return null;
      let preview: DiscardPreview | null = null;
      await this.run('Preparing discard preview…', async () => {
        if (this.browserPreview()) {
          const entries = repository.status.entries.filter(entry =>
            (!paths || paths.includes(entry.path))
            && (entry.conflicted || entry.indexStatus === '?' || entry.worktreeStatus.trim()));
          preview = {
            token: 'preview',
            paths: entries.filter(entry => !entry.conflicted).map(entry => entry.path),
            skippedPaths: entries.filter(entry => entry.conflicted).map(entry => entry.path),
            untracked: entries.filter(entry => entry.indexStatus === '?').length,
          };
        } else {
          preview = await ipc.preview_discard({ repoId: repository.id, paths });
        }
      }, repository.id);
      return preview;
    }

    async discardPrepared(preview: DiscardPreview, repositoryId: string): Promise<boolean> {
      if (!this.requireRecoveryRepository(repositoryId)) return false;
      const result = await this.changeWorkingTree('Discarding captured unstaged changes…',
        'Unstaged changes discarded; recovery saved', async repoId => {
          const { id, status } = this.browserPreview()
            ? { id: 'preview', status: preview.paths.reduce((current, path) => predictDiscardPath(current, path), this.repository()!.status) }
            : await ipc.discard_changes({ repoId, token: preview.token });
          this.recordDiscard(repoId, 'Discard Unstaged Changes', id);
          return status;
        });
      return result.succeeded;
    }

    async loadDiscardRecoveries(): Promise<DiscardRecovery[]> {
      const repository = this.repository();
      if (!repository) return [];
      let recoveries: DiscardRecovery[] = [];
      await this.run('Loading discarded-change recovery…', async () => {
        recoveries = this.browserPreview() ? []
          : await ipc.load_discard_recoveries({ repoId: repository.id });
      }, repository.id);
      return recoveries;
    }

    async applySavedDiscard(id: string, reverse = false): Promise<boolean> {
      const result = await this.mutateWorkingTree('apply_saved_discard', reverse ? 'Discarding recovered changes…' : 'Recovering discarded changes…',
        reverse ? 'Recovered changes discarded again' : 'Discarded changes recovered', { id, reverse });
      return result.succeeded;
    }

    async forgetSavedDiscard(id: string): Promise<void> {
      const repository = this.repository();
      if (!repository) return;
      await this.run('Removing saved recovery…', async report => {
        await ipc.forget_saved_discard({ repoId: repository.id, id });
        report('Saved recovery removed');
      }, repository.id);
    }

  async ignorePath(
    path: string,
    patternKind: 'file' | 'extension' | 'directory',
    stopTracking: boolean,
  ): Promise<void> {
    await this.mutate(
      'ignore_path',
      stopTracking ? `Ignoring and untracking ${path}…` : `Ignoring ${path}…`,
      stopTracking ? 'File ignored and no longer tracked' : 'Ignore rule added',
      { path, patternKind, stopTracking },
    );
  }

  async applyWorkingTreeHunk(
    path: string,
    staged: boolean,
    hunkIndex: number,
    action: 'stage' | 'unstage' | 'discard',
    expectedPatch?: string,
  ): Promise<boolean> {
    return this.applyWorkingTreeSelection('apply_working_tree_hunk', 'Hunk', {
      path,
      staged,
      hunkIndex,
      action,
      ...(expectedPatch !== undefined ? { expectedPatch } : {}),
    });
  }

  async applyWorkingTreeLines(
    path: string,
    staged: boolean,
    hunkIndex: number,
    lineIndices: number[],
    action: 'stage' | 'unstage' | 'discard',
    expectedPatch?: string,
  ): Promise<boolean> {
    return this.applyWorkingTreeSelection('apply_working_tree_lines', 'Selected lines', {
      path,
      staged,
      hunkIndex,
      lineIndices,
      action,
      ...(expectedPatch !== undefined ? { expectedPatch } : {}),
    });
  }

  private async applyWorkingTreeSelection<K extends 'apply_working_tree_hunk' | 'apply_working_tree_lines'>(
    command: K,
    subject: 'Hunk' | 'Selected lines',
    extra: Omit<CommandArgs<K>, 'repoId'> & { action: 'stage' | 'unstage' | 'discard' },
  ): Promise<boolean> {
    const repositoryId = this.activeRepositoryId();
    const labels = { stage: ['Staging', 'staged'], unstage: ['Unstaging', 'unstaged'], discard: ['Discarding', 'discarded'] };
    const [pending, done] = labels[extra.action];
    const result = await this.mutateWorkingTree(command, `${pending} ${subject.toLowerCase()}…`, `${subject} ${done}`, extra);
    if (!result.succeeded) return false;
    if (extra.action === 'discard' && repositoryId) this.recordDiscard(repositoryId, subject === 'Hunk' ? 'Discard Hunk' : 'Discard Selected Lines');
    await this.refreshWorkingTreeSelection(repositoryId, extra.path, extra.staged, result.inspectionRequest);
    return true;
  }

  private async refreshWorkingTreeSelection(
    repoId: string | null,
    path: string,
    staged: boolean,
    inspectionRequest: number,
  ): Promise<void> {
    if (repoId !== this.activeRepositoryId() || inspectionRequest !== this.workingTreeRequest) return;
    const entry = this.repository()?.status.entries.find((candidate) => candidate.path === path);
    const stillVisible = staged
      ? entry && entry.indexStatus !== ' ' && entry.indexStatus !== '?'
      : entry && (entry.worktreeStatus !== ' ' || entry.indexStatus === '?');
    if (stillVisible) await this.inspectWorkingTreeFile(path, staged);
  }

  async commit(
    message: string,
    options: { amend?: boolean; skipHooks?: boolean; pushAfter?: boolean; sign?: boolean } & Partial<CommitPolicy> = {},
  ): Promise<boolean> {
    if (!message.trim()) return false;
    const repository = this.repository();
    const beforeOid = repository?.headOid;
    const outcome = await this.mutate('commit_changes', options.amend ? 'Amending commit…' : 'Creating commit…', options.amend ? 'Commit amended' : 'Commit created', {
      message: message.trim(),
      amend: options.amend ?? false,
      skipHooks: options.skipHooks ?? false,
      sign: options.sign ?? false,
      policy: { signOff: options.signOff ?? false, allowEmpty: options.allowEmpty ?? false,
        author: options.author ?? null, committer: options.committer ?? null },
    });
    if (outcome !== 'success') return false;
    this.recordHeadChange(repository?.id, beforeOid, options.amend ? 'Amend Commit' : 'Commit');
    if (options.pushAfter && repository && this.requireRecoveryRepository(repository.id)) await this.remote('push_repository');
    return true;
  }

  async updateHeadMessage(expectedOid: string, message: string): Promise<boolean> {
    if (!message.trim()) return false;
    const repository = this.repository();
    if (!repository || repository.headOid !== expectedOid) return false;
    const outcome = await this.mutate(
      'update_head_message',
      'Updating commit message…',
      'Commit message updated',
      { expectedOid, message: message.trim(), skipHooks: false },
    );
    if (outcome !== 'success') return false;
    const afterOid = this.repositories().find(candidate => candidate.id === repository.id)?.headOid;
    this.recordHeadChange(repository.id, expectedOid, 'Edit Commit Message');
    return !!afterOid;
  }

  undo(): Promise<void> {
    return this.replayHistory(true);
  }

  redo(): Promise<void> {
    return this.replayHistory(false);
  }

  private async replayHistory(undone: boolean): Promise<void> {
    const repo = this.repository();
    const entry = repo ? this.operationHistory()[repo.id] : null;
    if (!repo || !entry || entry.undone === undone) return;
    const direction = undone ? 'undo' : 'redo';
    let succeeded: boolean;
    if (entry.kind === 'discard') {
      succeeded = entry.recoveryId
        ? await this.applySavedDiscard(entry.recoveryId, !undone)
        : await this.mutate(undone ? 'undo_discard' : 'redo_discard',
          `${undone ? 'Undoing' : 'Redoing'} ${entry.label.toLocaleLowerCase()}…`,
          undone ? 'Discarded changes restored' : 'Changes discarded again') === 'success';
    } else if (entry.kind === 'checkout') {
      const branch = checkoutHistoryTarget(entry, direction)!;
      succeeded = await this.mutate('checkout_branch', `Returning to ${branch}…`, `Checked out ${branch}`, {
        name: branch,
      }) === 'success';
    } else if (entry.kind === 'rename-branch') {
      const rename = renameBranchHistoryTarget(entry, direction)!;
      succeeded = await this.mutate(
        'rename_branch',
        undone ? `Restoring branch name ${rename.newName}…` : `Renaming branch to ${rename.newName} again…`,
        `Renamed ${rename.oldName} to ${rename.newName}`,
        rename,
      ) === 'success';
    } else {
      const targetOid = headHistoryTarget(entry, direction)!;
      succeeded = await this.mutate(
        'move_head',
        `${undone ? 'Undoing' : 'Redoing'} ${entry.label.toLocaleLowerCase()}…`,
        `${entry.label} ${undone ? 'undone' : 'redone'}`,
        { expectedOid: undone ? entry.afterOid : entry.beforeOid, targetOid },
      ) === 'success';
    }
    if (succeeded) this.setHistoryUndone(repo.id, entry, undone);
  }

  async checkout(name: string): Promise<void> {
    const repository = this.repository();
    const beforeBranch = repository?.status.branch;
    const outcome = await this.mutate('checkout_branch', `Checking out ${name}…`, `Checked out ${name}`, { name });
    if (outcome === 'success') this.recordCheckout(repository?.id, beforeBranch);
  }

  async checkoutRemote(name: string): Promise<void> {
    const repository = this.repository();
    const beforeBranch = repository?.status.branch;
    const outcome = await this.mutate(
      'checkout_remote_branch',
      `Creating a tracking branch for ${name}…`,
      `Checked out ${name} as a local tracking branch`,
      { name },
    );
    if (outcome === 'success') this.recordCheckout(repository?.id, beforeBranch);
  }

  async createBranch(name: string): Promise<void> {
    if (!name.trim()) return;
    await this.mutate('create_branch', `Creating ${name}…`, `Created ${name}`, { name: name.trim() });
  }

  async createBranchAt(name: string, oid: string, repositoryId?: string): Promise<void> {
    if (repositoryId && !this.requireRecoveryRepository(repositoryId)) return;
    if (!name.trim()) return;
    await this.mutate('create_branch_at', `Creating ${name}…`, `Created ${name}`, {
      name: name.trim(),
      oid,
    });
  }

  async createWorktree(
    parentPath: string,
    folder: string,
    branch: string,
    base: string,
  ): Promise<boolean> {
    await this.mutate(
      'create_worktree',
      `Creating worktree for ${branch}…`,
      `Created worktree for ${branch}`,
      { parentPath, folder, branch, base },
    );
    return !this.error();
  }

  async createWorktreeForBranch(
    parentPath: string,
    folder: string,
    branch: string,
  ): Promise<boolean> {
    await this.mutate(
      'create_worktree_for_branch',
      `Creating worktree for ${branch}…`,
      `Created worktree for ${branch}`,
      { parentPath, folder, branch },
    );
    return !this.error();
  }

  async setWorktreeLocked(path: string, locked: boolean): Promise<void> {
    await this.mutate(
      'set_worktree_locked',
      locked ? 'Locking worktree…' : 'Unlocking worktree…',
      locked ? 'Worktree locked' : 'Worktree unlocked',
      { path, locked },
    );
  }

  async removeWorktree(path: string, deleteBranch: boolean, force: boolean): Promise<void> {
    await this.mutate(
      'remove_worktree',
      deleteBranch ? 'Removing worktree and branch…' : 'Removing worktree…',
      deleteBranch ? 'Worktree and branch removed' : 'Worktree removed',
      { path, deleteBranch, force },
    );
  }

  async moveWorktree(request: WorktreeMove, repositoryId: string): Promise<boolean> {
    if (!this.requireRecoveryRepository(repositoryId)) return false;
    return await this.mutate('move_worktree', 'Moving linked worktree…',
      'Linked worktree moved; branch and files preserved', { request }) === 'success';
  }

  async repairWorktree(request: WorktreeRepair, repositoryId: string): Promise<boolean> {
    if (!this.requireRecoveryRepository(repositoryId)) return false;
    return await this.mutate('repair_worktree', 'Repairing moved worktree links…',
      'Worktree registration repaired; files and branch unchanged', { request }) === 'success';
  }

  private async readRepository<T>(repositoryId: string, pending: string, read: () => Promise<T>): Promise<T | null> {
    if (!this.requireRecoveryRepository(repositoryId)) return null;
    let value: T | null = null;
    const result = await this.run(pending, async () => {
      value = await read();
    }, repositoryId);
    return result === 'success' ? value : null;
  }

  reviewWorktreeRegistrations(repositoryId: string): Promise<WorktreeRegistrationReview | null> {
    return this.readRepository(repositoryId, 'Reviewing worktree registrations…',
      () => ipc.worktree_registration_review({ repoId: repositoryId }));
  }

  loadLfsTrackingRules(repositoryId: string): Promise<LfsTrackingRules | null> {
    return this.readRepository(repositoryId, 'Loading LFS tracking patterns…',
      () => ipc.lfs_tracking_rules({ repoId: repositoryId }));
  }

  inspectLfsAttributes(file: string, repositoryId: string): Promise<LfsFileAttributes | null> {
    return this.readRepository(repositoryId, 'Inspecting effective file attributes…',
      () => ipc.lfs_file_attributes({ repoId: repositoryId, file }));
  }

  inspectLfsObjects(repositoryId: string): Promise<LfsObjects | null> {
    return this.readRepository(repositoryId, 'Inspecting local LFS objects…',
      () => ipc.lfs_objects({ repoId: repositoryId }));
  }

  previewLfsFetch(file: LfsObjects['files'][number], remote: string, repositoryId: string): Promise<LfsFetchPreview | null> {
    return this.readRepository(repositoryId, 'Reviewing selective LFS fetch…',
      () => ipc.lfs_fetch_preview({
        repoId: repositoryId, file: file.name, remote, expectedOid: file.oid, expectedSize: file.size,
      }));
  }

  async fetchLfsObject(preview: LfsFetchPreview, repositoryId: string): Promise<'success' | 'error' | 'cancelled' | undefined> {
    if (!this.requireRecoveryRepository(repositoryId)) return 'error';
    return this.mutate('lfs_fetch_object', `Fetching LFS object for ${preview.file}…`,
      'Reviewed LFS object fetched into local storage; working files were not hydrated', { preview });
  }

  previewLfsCheckout(file: LfsObjects['files'][number], repositoryId: string): Promise<LfsCheckoutPreview | null> {
    return this.readRepository(repositoryId, 'Reviewing local LFS hydration…',
      () => ipc.lfs_checkout_preview({
        repoId: repositoryId, file: file.name, expectedOid: file.oid, expectedSize: file.size,
      }));
  }

  async checkoutLfsObject(preview: LfsCheckoutPreview, repositoryId: string): Promise<'success' | 'error' | 'cancelled' | undefined> {
    if (!this.requireRecoveryRepository(repositoryId)) return 'error';
    return this.mutate('lfs_checkout_object', `Verifying and hydrating ${preview.file}…`,
      'Working pointer replaced with SHA-256-verified local contents; index and references unchanged', { preview });
  }

  previewLfsPrune(repositoryId: string): Promise<LfsPrunePreview | null> {
    return this.readRepository(repositoryId, 'Reviewing unreferenced LFS objects…',
      () => ipc.lfs_prune_preview({ repoId: repositoryId }));
  }

  async pruneLfsObjects(preview: LfsPrunePreview, repositoryId: string): Promise<'success' | 'error' | 'cancelled' | undefined> {
    if (!this.requireRecoveryRepository(repositoryId)) return 'error';
    const count = preview.objects.length;
    return this.mutate('lfs_prune_objects', `Removing ${count} unreferenced LFS ${count === 1 ? 'object' : 'objects'}…`,
      'Reviewed unreferenced LFS objects removed; Git history and working files unchanged', { preview });
  }

  async untrackLfsPattern(pattern: string, expectedState: string, repositoryId: string): Promise<boolean> {
    if (!this.requireRecoveryRepository(repositoryId)) return false;
    return await this.mutate('lfs_untrack_pattern', `Removing LFS rule ${pattern}…`,
      'LFS rule removed; review and commit .gitattributes. Existing history and file contents unchanged',
      { pattern, expectedState }) === 'success';
  }

  async addSubmodule(url: string, path: string): Promise<boolean> {
    await this.mutate(
      'add_submodule',
      `Adding submodule at ${path}…`,
      `Added submodule at ${path}`,
      { url: url.trim(), path: path.trim() },
    );
    return !this.error();
  }

  async initializeSubmodule(path: string): Promise<void> {
    await this.mutate(
      'initialize_submodule',
      `Initializing ${path}…`,
      `Initialized ${path}`,
      { path },
    );
  }

  async initializeAllSubmodules(): Promise<boolean> {
    return await this.mutate(
      'initialize_all_submodules',
      'Initializing missing submodules…',
      'Initialized all missing submodules at their recorded commits',
    ) === 'success';
  }

  async updateSubmodule(path: string): Promise<void> {
    await this.mutate(
      'update_submodule',
      `Updating ${path}…`,
      `Updated ${path}`,
      { path },
    );
  }

  async updateAllSubmodules(): Promise<boolean> {
    return await this.mutate(
      'update_all_submodules',
      'Updating all submodules from remotes…',
      'Updated all submodules from their configured remotes',
    ) === 'success';
  }

  async checkoutCommit(oid: string): Promise<void> {
    await this.mutate('checkout_commit', 'Checking out commit…', 'Checked out commit', { oid });
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    const normalized = newName.trim();
    if (!normalized) return;
    const repositoryId = this.activeRepositoryId();
    const outcome = await this.mutate('rename_branch', `Renaming ${oldName}…`, `Renamed ${oldName} to ${normalized}`, {
      oldName,
      newName: normalized,
    });
    const entry = createRenameBranchHistoryEntry(oldName, normalized);
    if (repositoryId && outcome === 'success' && entry) {
      this.operationHistory.update((history) => ({ ...history, [repositoryId]: entry }));
    }
  }

  async setBranchUpstream(branch: string, upstream: string | null): Promise<void> {
    await this.mutate(
      'set_branch_upstream',
      upstream ? `Setting ${branch} upstream…` : `Removing ${branch} upstream…`,
      upstream ? `${branch} now tracks ${upstream}` : `${branch} no longer tracks an upstream`,
      { branch, upstream },
    );
  }

  /** Returns 'notMerged' when Git refuses a safe delete, leaving the decision to force it to the caller. */
  async deleteBranch(name: string, force = false): Promise<'deleted' | 'notMerged' | 'failed'> {
    await this.mutate('delete_branch', `Deleting ${name}…`, `Deleted ${name}`, { name, force });
    if (!this.error()) return 'deleted';
    if (!force && this.lastFailureKind === 'branchNotMerged') {
      this.error.set(null);
      this.activity.set(`${name} is not fully merged`);
      return 'notMerged';
    }
    return 'failed';
  }

  async integrateBranch(name: string, strategy: 'merge' | 'ff-only' | 'squash' | 'rebase'): Promise<void> {
    const verbs = { merge: 'Merging', 'ff-only': 'Fast-forwarding', squash: 'Squashing', rebase: 'Rebasing' };
    await this.mutate('integrate_branch', `${verbs[strategy]} ${name}…`, `${verbs[strategy]} ${name} complete`, {
      name,
      strategy,
    });
  }

  async prepareInteractiveRebase(source: string, target: string, selectionOids?: string[], root = false): Promise<InteractiveRebasePlan | null> {
    const repo = this.repository();
    if (!repo) return null;
    let plan: InteractiveRebasePlan | null = null;
    await this.run('Preparing interactive rebase…', async report => {
      plan = await ipc.prepare_interactive_rebase({
        repoId: repo.id,
        source,
        target,
        ...(selectionOids ? { selectionOids } : {}),
        ...(root ? { root: true } : {}),
      });
      report(root ? `Whole-history rebase ready on ${source}` : selectionOids ? `Selected-range rebase ready on ${source}` : `Interactive rebase ready: ${source} onto ${target}`);
    }, repo.id);
    return plan;
  }

  async executeInteractiveRebase(
    source: string,
    target: string,
    steps: InteractiveRebaseStep[],
    selectionOids?: string[],
    root = false,
    ontoOid?: string,
  ): Promise<void> {
    await this.mutate(
      'execute_interactive_rebase',
      ontoOid ? `Replaying history on ${source} onto ${ontoOid.slice(0, 8)}…` : root ? `Editing entire history on ${source}…` : selectionOids ? `Editing selected history on ${source}…` : `Rebasing ${source} onto ${target}…`,
      snapshot => this.rebaseActivity(snapshot),
      { source, target, steps, ...(selectionOids ? { selectionOids } : {}), ...(root ? { root: true } : {}), ...(ontoOid ? { ontoOid } : {}) },
    );
  }

  async continueRebase(): Promise<void> {
    await this.mutate('continue_rebase', 'Continuing interactive rebase…', snapshot => this.rebaseActivity(snapshot));
  }

  async prepareMergeRebase(repositoryId: string, source: string, target: string): Promise<MergeRebasePlan | null> {
    if (!this.requireRecoveryRepository(repositoryId)) return null;
    let plan: MergeRebasePlan | null = null;
    await this.run('Reviewing merge-preserving rebase…', async report => {
      plan = await ipc.prepare_merge_rebase({ repoId: repositoryId, source, target });
      report('Merge-preserving review ready; no history changed');
    }, repositoryId);
    return plan;
  }

  async executeMergeRebase(repositoryId: string, request: MergeRebaseRequest): Promise<boolean> {
    if (!this.requireRecoveryRepository(repositoryId)) return false;
    return await this.mutate('execute_merge_rebase', 'Rebasing with merge topology…',
      snapshot => this.rebaseActivity(snapshot), { request }) === 'success';
  }

  async importDiffPatch(repositoryId: string, request: PatchRequest): Promise<boolean> {
    if (!this.requireRecoveryRepository(repositoryId)) return false;
    return await this.mutate('import_diff_patch', 'Applying reviewed patch…',
      'Patch applied; review changes before committing. No reference moved.', { request }) === 'success';
  }
  async beginRebaseSplit(expectedHead: string): Promise<void> {
    await this.mutate('begin_rebase_split', 'Preparing the stopped commit for splitting…',
      'Split started. Stage selected changes and create at least two separate commits, then Continue.',
      { expectedHead });
  }

  async skipRebase(): Promise<void> {
    await this.mutate('skip_rebase', 'Skipping conflicted commit…', snapshot => this.rebaseActivity(snapshot));
  }

  private rebaseActivity(snapshot: RepositorySnapshot): string {
    if (snapshot.status.rebaseSplit) return 'Rebase paused for splitting. Commit every part explicitly, then Continue; or Abort.';
    if (snapshot.status.rebaseEditStopped && !snapshot.status.conflicted) return 'Rebase paused for Edit. Amend the replayed commit, then Continue; or Continue unchanged.';
    return snapshot.status.rebaseInProgress ? 'Rebase remains in progress. Review the current stop before continuing.' : 'Interactive rebase complete';
  }

  async abortRebase(): Promise<void> {
    await this.mutate('abort_rebase', 'Aborting interactive rebase…', 'Interactive rebase aborted');
  }

  async continueMerge(): Promise<void> {
    const repository = this.repository();
    if (!repository?.status.mergeInProgress || repository.status.conflicted) return;
    if (this.browserPreview()) {
      this.updatePreviewMergeState(repository.id, false);
      this.activity.set('Merge complete');
      return;
    }
    await this.mutate('continue_merge', 'Completing merge…', 'Merge complete');
  }

  async abortMerge(): Promise<void> {
    const repository = this.repository();
    if (!repository?.status.mergeInProgress) return;
    if (this.browserPreview()) {
      this.updatePreviewMergeState(repository.id, false);
      this.activity.set('Merge aborted');
      return;
    }
    await this.mutate('abort_merge', 'Aborting merge…', 'Merge aborted');
  }

  private updatePreviewMergeState(repositoryId: string, inProgress: boolean): void {
    this.repositories.update((repositories) => repositories.map((repository) => repository.id === repositoryId
      ? {
          ...repository,
          status: {
            ...repository.status,
            mergeInProgress: inProgress,
            conflicted: inProgress ? repository.status.conflicted : 0,
            entries: inProgress ? repository.status.entries : repository.status.entries.map((entry) => entry.conflicted
              ? { ...entry, indexStatus: ' ', worktreeStatus: 'M', conflicted: false }
              : entry),
          },
        }
      : repository));
  }

  async controlHistoryOperation(action: 'continue' | 'skip' | 'abort' | 'quit'): Promise<void> {
    const repository = this.repository();
    const operation = repository?.status.historyOperation;
    if (!repository || !operation || (action === 'continue' && repository.status.conflicted)) return;
    if (this.browserPreview()) {
      this.repositories.update((repositories) => repositories.map((candidate) => candidate.id === repository.id
        ? {
            ...candidate,
            status: {
              ...candidate.status,
              historyOperation: null,
              historyNoCommit: false,
              conflicted: action === 'quit' ? candidate.status.conflicted : 0,
              entries: action === 'quit' ? candidate.status.entries : candidate.status.entries.map((entry) => entry.conflicted
                ? { ...entry, indexStatus: ' ', worktreeStatus: 'M', conflicted: false }
                : entry),
            },
          }
        : candidate));
      this.activity.set(action === 'quit' ? 'No-commit sequence ended; current files and staged changes retained'
        : `${operation === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} ${action === 'abort' ? 'aborted' : action === 'skip' ? 'skipped' : 'complete'}`);
      return;
    }
    const label = operation === 'cherry-pick' ? 'cherry-pick' : 'revert';
    await this.mutate(
      'control_history_operation',
      `${action === 'continue' ? 'Continuing' : action === 'skip' ? 'Skipping' : action === 'quit' ? 'Finishing manually' : 'Aborting'} ${label}…`,
      snapshot => snapshot.status.historyNoCommit ? 'No-commit replay paused; review and stage conflicts'
        : repository.status.historyNoCommit
          ? action === 'abort' ? 'No-commit replay aborted; original tracked state restored'
            : action === 'quit' ? 'No-commit sequence ended; current files and staged changes retained'
              : snapshot.status.staged ? 'Selected changes staged; no commit created' : 'Selected changes have no effect; HEAD unchanged and no commit created'
          : `${label === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} ${action === 'abort' ? 'aborted' : action === 'skip' ? 'skipped' : 'continued'}`,
      { operation, action },
    );
  }

  async inspectConflict(path: string): Promise<ConflictDetails | null> {
    const repo = this.repository();
    if (!repo) return null;
    if (this.conflictDetails() && this.conflictRepositoryId !== repo.id
      && this.conflictRepositoryId && !this.requireRecoveryRepository(this.conflictRepositoryId)) return null;
    let details: ConflictDetails | null = null;
    const request = ++this.conflictRequest;
    if (this.conflictDetails()?.path !== path) this.conflictDetails.set(null);
    this.conflictRepositoryId = repo.id;
    await this.run(`Opening merge tool for ${path}…`, async report => {
      details = await ipc.inspect_conflict({ repoId: repo.id, path });
      if (this.activeRepositoryId() !== repo.id || request !== this.conflictRequest) return;
      this.conflictDetails.set(details);
      report(`Resolving conflict in ${path}`);
    }, repo.id);
    return this.activeRepositoryId() === repo.id && request === this.conflictRequest ? details : null;
  }

  closeConflict(): void {
    this.conflictRequest++;
    this.conflictRepositoryId = null;
    this.conflictDetails.set(null);
  }

  async resolveConflict(
    path: string,
    resolution: 'current' | 'incoming' | 'output',
    output?: string,
  ): Promise<boolean> {
    let details = this.conflictDetails();
    if (!details || details.path !== path) {
      details = await this.inspectConflict(path);
    }
    if (!details || !this.conflictRepositoryId || !this.requireRecoveryRepository(this.conflictRepositoryId)) return false;
    const result = await this.mutate(
      'resolve_conflict',
      `Resolving ${path}…`,
      `Resolved ${path}`,
      { path, resolution, output: output ?? null, expectedState: details.state },
      true,
    );
    if (result === 'success' && this.conflictDetails() === details) this.closeConflict();
    return result === 'success';
  }

  async remote(
    operation: 'fetch_repository' | 'pull_repository' | 'push_repository',
    target: { remote?: string; branch?: string } = {},
  ): Promise<void> {
    const labels = {
      fetch_repository: ['Fetching…', 'Fetch complete'],
      pull_repository: ['Pulling…', 'Pull complete'],
      push_repository: ['Pushing…', 'Push complete'],
    } as const;
    const repositoryId = this.activeRepositoryId();
    const result = await this.mutate(operation, labels[operation][0], labels[operation][1], target);
    // Retry state belongs to the initiating repository and this operation's
    // result, not whichever tab or error toast is visible on completion.
    if (operation === 'fetch_repository' && result === 'success') {
      if (repositoryId) this.backgroundFetchErrors.update((errors) => {
        const updated = { ...errors };
        delete updated[repositoryId];
        return updated;
      });
    }
  }

  async fetchBranches(options: FetchOptions, repositoryId: string): Promise<'success' | 'error' | 'cancelled' | undefined> {
    if (!this.requireRecoveryRepository(repositoryId)) return;
    return this.mutate('fetch_branches', `Fetching from ${options.remote ?? 'all remotes'}…`,
      `Fetch complete${options.prune ? '; stale remote-tracking branches pruned' : ''}; local tags unchanged`,
      { options });
  }

  async forcePushWithLease(remote?: string, branch?: string): Promise<void> {
    if (!this.repository()) return;
    if (this.browserPreview()) {
      this.activity.set('Force push with lease complete');
      return;
    }
    await this.mutate(
      'force_push_repository',
      'Force pushing with lease…',
      'Force push with lease complete',
      { remote, branch },
    );
  }

    async manageReference(
      action: 'delete-tag' | 'signed-tag' | 'verify-tag' | 'set-push-url',
      name: string,
      extra: { expectedOid?: string; message?: string; url?: string | null } = {},
    ): Promise<void> {
      await this.mutate('manage_reference', 'Updating Git reference…',
        action === 'verify-tag' ? 'Tag signature verified by Git' : 'Git reference updated',
        { action, name, ...extra });
    }

    async transportReference(remote: string, name: string, kind: 'tag' | 'branch', deleteReference: boolean, expectedOid?: string): Promise<void> {
      await this.mutate('transport_reference', 'Updating selected remote reference…', 'Remote reference updated',
        { request: { remote, name, kind, delete: deleteReference, expectedOid: expectedOid ?? null } });
    }

    async previewRemoteTag(remote: string, name: string): Promise<string | null> {
      const repository = this.repository();
      if (!repository) return null;
      const operationId = crypto.randomUUID();
      let oid: string | null = null;
      await this.run('Checking selected remote tag…', async () => {
        oid = await ipc.preview_remote_tag({ repoId: repository.id, remote, name, operationId });
      }, repository.id, operationId);
      return oid;
    }

  async performRepositoryMaintenance(): Promise<boolean> {
    const repository = this.repository();
    if (!repository || this.busy()) return false;
    if (this.browserPreview()) {
      this.activity.set('Repository maintenance complete');
      return true;
    }
    const outcome = await this.run('Checking integrity and packing metadata…', async report => {
      await ipc.perform_repository_maintenance({ repoId: repository.id });
      report('Repository maintenance complete');
    }, repository.id);
    return outcome === 'success';
  }

  async diagnoseSigning(): Promise<void> {
    const repository = this.repository();
    if (!repository || this.signingDiagnosticBusy()) return;
    this.signingDiagnosticBusy.set(true);
    this.signingDiagnostics.update(diagnostics => {
      const remaining = { ...diagnostics };
      delete remaining[repository.id];
      return remaining;
    });
    this.error.set(null);
    try {
      const diagnostic = this.browserPreview()
        ? {
            available: typeof window === 'undefined' || !new URLSearchParams(window.location.search).has('signer-missing'),
            program: repository.signing.format === 'ssh' ? 'ssh-keygen' : 'gpg',
            format: repository.signing.format,
            keyConfigured: !!repository.signing.key,
            message: typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('signer-missing')
              ? 'The configured signing program was not found in the system PATH.'
              : `${repository.signing.format === 'ssh' ? 'ssh-keygen' : 'gpg'} is available and Git has an explicit signing key configured.`,
          }
        : await ipc.diagnose_signing({ repoId: repository.id });
      this.signingDiagnostics.update((diagnostics) => ({ ...diagnostics, [repository.id]: diagnostic }));
      this.activity.set(diagnostic.available ? 'Commit signer is available' : 'Commit signer needs attention');
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
    } finally {
      this.signingDiagnosticBusy.set(false);
    }
  }

  async lfs(operation: 'lfs_pull' | 'lfs_prune'): Promise<void> {
    const labels = {
      lfs_pull: ['Pulling Git LFS objects…', 'Git LFS objects pulled'],
      lfs_prune: ['Pruning old Git LFS objects…', 'Old Git LFS objects pruned'],
    } as const;
    await this.mutate(operation, labels[operation][0], labels[operation][1]);
  }

  async initializeLfs(): Promise<void> {
    await this.mutate(
      'lfs_initialize',
      'Initializing Git LFS for this repository…',
      'Git LFS initialized',
    );
  }

  async trackLfsPattern(pattern: string, lockable: boolean): Promise<void> {
    await this.mutate(
      'lfs_track_pattern',
      `Tracking ${pattern} with Git LFS…`,
      `Git LFS now tracks ${pattern}`,
      { pattern, lockable },
    );
  }

  async setSparseCheckout(paths: string[], sparseIndex: boolean): Promise<void> {
    await this.mutate(
      'sparse_checkout_set',
      'Updating sparse checkout…',
      'Sparse checkout updated',
      { paths, sparseIndex },
    );
  }

  async reapplySparseCheckout(): Promise<void> {
    await this.mutate(
      'sparse_checkout_reapply',
      'Reapplying sparse checkout…',
      'Sparse checkout reapplied',
    );
  }

  async disableSparseCheckout(): Promise<void> {
    await this.mutate(
      'sparse_checkout_disable',
      'Restoring the complete working tree…',
      'Sparse checkout disabled',
    );
  }

  async publishBranch(remote: string, branch: string): Promise<void> {
    await this.mutate(
      'publish_branch',
      `Publishing ${branch} to ${remote}…`,
      `Published ${branch} to ${remote}`,
      { remote, branch },
    );
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.mutate('add_remote', `Adding remote ${name}…`, `Remote ${name} added`, { name, url });
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.mutate('set_remote_url', `Updating remote ${name}…`, `Remote ${name} updated`, { name, url });
  }

  async setRepositoryIdentity(name: string, email: string): Promise<void> {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim();
    if (this.browserPreview()) {
      const repositoryId = this.activeRepositoryId();
      if (!repositoryId) return;
      this.repositories.update((repositories) => repositories.map((repository) => repository.id === repositoryId
        ? { ...repository, identity: { name: normalizedName, email: normalizedEmail } }
        : repository));
      this.error.set(null);
      this.activity.set('Repository Git identity updated');
      return;
    }
    await this.mutate(
      'set_repository_identity',
      'Updating repository Git identity…',
      'Repository Git identity updated',
      { name: normalizedName, email: normalizedEmail },
    );
  }

  async configureRemote(name: string, fetchUrl: string, pushUrl: string | null, changePush: boolean, add: boolean): Promise<void> {
    await this.mutate('configure_remote', `Saving remote ${name}…`, `Remote ${name} saved`,
      { name, fetchUrl, pushUrl, changePush, add });
  }

  async removeRemote(name: string): Promise<void> {
    await this.mutate('remove_remote', `Removing remote ${name}…`, `Remote ${name} removed`, { name });
  }

  async pull(
    strategy: 'merge' | 'ff-only' | 'rebase' = 'merge',
    remote?: string,
    branch?: string,
  ): Promise<void> {
    await this.mutate('pull_repository', 'Pulling…', 'Pull complete', { strategy, remote, branch });
  }

  async stash(message = ''): Promise<void> {
    const name = message.trim();
    await this.mutate(
      'stash_changes',
      name ? `Stashing “${name}”…` : 'Stashing changes…',
      name ? `Stash “${name}” created` : 'Changes stashed',
      { message: name || null },
    );
  }

  async stashSelected(options: StashOptions): Promise<void> {
    await this.mutate('stash_selected', 'Saving selected changes…', 'Selected changes stashed', { options });
  }

  async applyStashOptions(reference: string, expectedOid: string, restoreIndex: boolean): Promise<void> {
    await this.mutate('apply_stash_options', `Restoring ${reference}…`, `${reference} restored; stash kept`,
      { reference, expectedOid, restoreIndex });
  }

  async branchFromStash(reference: string, expectedOid: string, name: string): Promise<void> {
    await this.mutate('branch_from_stash', `Restoring ${reference} on ${name}…`,
      `Created ${name}; original stash kept`, { reference, expectedOid, name });
  }

  async stashCheckout(name: string, expectedHead: string, expectedTarget: string, message: string): Promise<void> {
    await this.mutate('stash_checkout', `Saving changes before checkout of ${name}…`,
      `Checked out ${name}; previous changes saved in stash`, { name, expectedHead, expectedTarget, message });
  }

  async popStash(stash: StashEntry | undefined, repositoryId: string): Promise<boolean> {
    if (!stash || !this.requireSelectedStash(stash.reference, stash.oid, repositoryId)) return false;
    return await this.mutate('pop_stash', 'Popping latest stash…', 'Stash popped', { expectedOid: stash.oid }) === 'success';
  }

  async applyStash(reference: string, expectedOid: string, repositoryId: string): Promise<boolean> {
    if (!this.requireSelectedStash(reference, expectedOid, repositoryId)) return false;
    return await this.mutate('apply_stash', `Applying ${reference}…`, `${reference} applied; stash kept`, { reference, expectedOid }) === 'success';
  }

  async popStashEntry(reference: string, expectedOid: string, repositoryId: string): Promise<boolean> {
    if (!this.requireSelectedStash(reference, expectedOid, repositoryId)) return false;
    return await this.mutate('pop_stash_entry', `Popping ${reference}…`, `${reference} popped`, { reference, expectedOid }) === 'success';
  }

  private requireSelectedStash(reference: string, expectedOid: string, repositoryId: string): boolean {
    if (this.busy()) return false;
    if (!this.requireRecoveryRepository(repositoryId)) return false;
    if (this.repository()?.stashes.some(stash => stash.reference === reference && stash.oid === expectedOid)) return true;
    this.error.set('The stash list changed. Refresh and select the intended stash again.');
    return false;
  }

  async dropStash(reference: string, expectedOid: string, repositoryId: string): Promise<boolean> {
    if (!this.requireRecoveryRepository(repositoryId)) return false;
    return await this.mutate('drop_stash', `Deleting ${reference}…`, `${reference} deleted`, { reference, expectedOid }) === 'success';
  }

  async renameStash(reference: string, expectedOid: string, message: string, repositoryId: string): Promise<boolean> {
    if (!this.requireSelectedStash(reference, expectedOid, repositoryId)) return false;
    return await this.mutate(
      'rename_stash',
      `Renaming ${reference}…`,
      'Stash message updated',
      { reference, expectedOid, message },
    ) === 'success';
  }

  async createTag(name: string, oid: string, message: string | null = null): Promise<void> {
    if (!name.trim()) return;
    await this.mutate('create_tag', `Creating tag ${name}…`, `Created tag ${name}`, {
      name: name.trim(),
      oid,
      message: message?.trim() || null,
    });
  }

  async cherryPick(oids: string[], mainline: number | null = null, noCommit = false): Promise<void> {
    const count = oids.length;
    if (!count) return;
    const repository = this.repository();
    const beforeOid = repository?.headOid;
    const outcome = await this.mutate(
      'cherry_pick_commits',
      noCommit ? 'Applying selected changes without committing…' : count === 1 ? 'Cherry-picking commit…' : `Cherry-picking ${count} commits…`,
      snapshot => noCommit
        ? snapshot.status.staged ? 'Selected changes staged; no commit created' : 'Selected changes have no effect; HEAD unchanged and no commit created'
        : count === 1 ? 'Commit cherry-picked' : `${count} commits cherry-picked`,
      { oids, mainline, noCommit },
    );
    if (noCommit || outcome !== 'success') return;
    this.recordHeadChange(
      repository?.id,
      beforeOid,
      count === 1 ? 'Cherry-pick Commit' : `Cherry-pick ${count} Commits`,
    );
  }

  async revertCommit(oid: string, mainline: number | null = null): Promise<void> {
    const repository = this.repository();
    const beforeOid = repository?.headOid;
    const outcome = await this.mutate('revert_commit', 'Reverting commit…', 'Revert commit created', { oid, mainline });
    if (outcome === 'success') this.recordHeadChange(repository?.id, beforeOid, 'Revert Commit');
  }

  async revertCommits(oids: string[]): Promise<void> {
    const repository = this.repository();
    const beforeOid = repository?.headOid;
    const outcome = await this.mutate('revert_commit', `Reverting ${oids.length} commits…`,
      `${oids.length} revert commits created`, { oid: oids[0], oids, mainline: null });
    if (outcome === 'success') this.recordHeadChange(repository?.id, beforeOid, `Revert ${oids.length} Commits`);
  }

  async resetToCommit(oid: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    await this.mutate('reset_to_commit', `Resetting ${mode}…`, `Reset ${mode} complete`, { oid, mode });
  }

  async previewReset(oid: string, mode: ResetMode): Promise<ResetPreview | null> {
    const repository = this.repository();
    if (!repository) return null;
    let preview: ResetPreview | null = null;
    const result = await this.run('Reviewing reset scope…', async () => {
      preview = await ipc.preview_reset({ repoId: repository.id, oid, mode });
    }, repository.id);
    return result === 'success' ? preview : null;
  }

  async resetPrepared(preview: ResetPreview, repositoryId: string): Promise<void> {
    if (!this.requireRecoveryRepository(repositoryId)) return;
    await this.mutate('execute_prepared_reset', `Resetting ${preview.mode}…`,
      'Reset complete; original history and tracked changes saved in Recovery History',
      { token: preview.token });
  }

  async loadOperationRecoveries(repositoryId: string): Promise<OperationRecovery[] | null> {
    if (!this.requireRecoveryRepository(repositoryId)) return null;
    let records: OperationRecovery[] | null = null;
    const result = await this.run('Loading saved operation recovery…', async () => {
      records = this.browserPreview() ? []
        : await ipc.load_operation_recoveries({ repoId: repositoryId });
    }, repositoryId);
    return result === 'success' ? records : null;
  }

  async restoreOperationRecovery(id: string, branch: string, repositoryId: string): Promise<void> {
    if (!this.requireRecoveryRepository(repositoryId)) return;
    await this.mutate('restore_operation_recovery', 'Restoring on a new branch…',
      'Original history and tracked changes restored; recovery capture retained', { id, branch });
  }

  async forgetOperationRecovery(id: string, repositoryId: string): Promise<void> {
    if (!this.requireRecoveryRepository(repositoryId)) return;
    await this.run('Removing saved capture…', async report => {
      await ipc.forget_operation_recovery({ repoId: repositoryId, id });
      report('Saved capture removed; current branch and files unchanged');
    }, repositoryId);
  }

  requireRecoveryRepository(repositoryId: string): boolean {
    if (repositoryId === this.activeRepositoryId()) return true;
    this.error.set('The active repository changed. Close this dialog and review the intended repository.');
    return false;
  }

  async startBisect(goodOid: string): Promise<void> {
    const repository = this.repository();
    const badOid = repository?.headOid;
    if (!repository || !badOid || goodOid === badOid) return;
    if (this.browserPreview()) {
      this.previewBisectOriginalHeads.set(repository.id, badOid);
      const goodIndex = repository.commits.findIndex((commit) => commit.oid === goodOid);
      const candidateIndex = Math.max(1, Math.floor(Math.max(1, goodIndex) / 2));
      const candidate = repository.commits[candidateIndex] ?? repository.commits[1] ?? repository.commits[0];
      this.repositories.update((repositories) => repositories.map((item) => item.id === repository.id
        ? { ...item, headOid: candidate?.oid ?? badOid, status: { ...item.status, branch: null, bisectInProgress: true } }
        : item));
      this.activity.set('Bisect started');
      return;
    }
    await this.mutate('start_bisect', 'Starting bisect…', 'Bisect started', { badOid, goodOid });
  }

  async markBisect(verdict: 'good' | 'bad' | 'skip'): Promise<void> {
    const repository = this.repository();
    if (!repository?.status.bisectInProgress) return;
    if (this.browserPreview()) {
      const currentIndex = repository.commits.findIndex((commit) => commit.oid === repository.headOid);
      const candidate = repository.commits[Math.min(repository.commits.length - 1, Math.max(0, currentIndex + 1))];
      this.repositories.update((repositories) => repositories.map((item) => item.id === repository.id
        ? { ...item, headOid: candidate?.oid ?? item.headOid }
        : item));
      this.activity.set(`Bisect marked ${verdict}`);
      return;
    }
    await this.mutate('mark_bisect', `Marking commit ${verdict}…`, `Commit marked ${verdict}`, { verdict });
  }

  async resetBisect(): Promise<void> {
    const repository = this.repository();
    if (!repository?.status.bisectInProgress) return;
    if (this.browserPreview()) {
      const originalHead = this.previewBisectOriginalHeads.get(repository.id) ?? repository.headOid;
      const branch = repository.branches.find((candidate) => candidate.current)?.name ?? 'main';
      this.previewBisectOriginalHeads.delete(repository.id);
      this.repositories.update((repositories) => repositories.map((item) => item.id === repository.id
        ? { ...item, headOid: originalHead, status: { ...item.status, branch, bisectInProgress: false } }
        : item));
      this.activity.set('Bisect reset');
      return;
    }
    await this.mutate('reset_bisect', 'Resetting bisect…', 'Bisect reset');
  }

  async restoreFilesFromCommit(oid: string, paths: string[]): Promise<boolean> {
    return await this.mutate(
      'restore_files_from_commit',
      paths.length === 1 ? 'Restoring file…' : `Restoring ${paths.length} files…`,
      paths.length === 1 ? 'File restored and staged' : `${paths.length} files restored and staged`,
      { oid, paths },
    ) === 'success';
  }

  async inspectCommit(oid: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const request = ++this.detailsRequest;
    this.fileRequest += 1;
    this.commitDetails.set(null);
    this.inspectedStashReference.set(null);
    this.commitFileDiff.set(null);
    this.selectedCommitFile.set(null);
    this.commitComparison.set(null);
    this.comparisonFileDiff.set(null);
    this.selectedComparisonFile.set(null);
    this.clearWorkingTreeInspection();
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const details = this.browserPreview()
        ? createPreviewCommitDetails(repository, oid)
        : await ipc.inspect_commit({ repoId: repository.id, oid });
      if (request !== this.detailsRequest || repository.id !== this.activeRepositoryId()) return;
      this.commitDetails.set(details);
    } catch (error: unknown) {
      if (request === this.detailsRequest) this.error.set(this.formatError(error));
    } finally {
      if (request === this.detailsRequest) this.detailsBusy.set(false);
    }
  }

  async inspectTag(name: string, oid: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const request = ++this.tagDetailsRequest;
    const cacheKey = `${repository.id}\0${name}\0${oid}`;
    const cached = this.tagDetailsCache.get(cacheKey);
    this.tagDetails.set(cached ?? null);
    this.tagDetailsBusy.set(!cached);
    if (cached) return;
    try {
      const details = this.browserPreview()
        ? {
          name,
          oid,
          annotated: name === 'v0.1.0',
          message: name === 'v0.1.0' ? 'First Git Khronos preview release' : null,
          taggerName: name === 'v0.1.0' ? 'Maya Chen' : null,
          taggerEmail: name === 'v0.1.0' ? 'maya@example.test' : null,
          taggedAt: name === 'v0.1.0' ? '2026-10-03T11:42:00+00:00' : null,
        } satisfies TagDetails
        : await ipc.inspect_tag({ repoId: repository.id, name });
      this.tagDetailsCache.set(cacheKey, details);
      if (request !== this.tagDetailsRequest || repository.id !== this.activeRepositoryId()) return;
      this.tagDetails.set(details);
    } catch {
      if (request === this.tagDetailsRequest) this.tagDetails.set(null);
    } finally {
      if (request === this.tagDetailsRequest) this.tagDetailsBusy.set(false);
    }
  }

  clearTagInspection(): void {
    this.tagDetailsRequest += 1;
    this.tagDetails.set(null);
    this.tagDetailsBusy.set(false);
  }

  async inspectStash(stash: StashEntry): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const request = ++this.detailsRequest;
    this.fileRequest += 1;
    this.commitDetails.set(null);
    this.inspectedStashReference.set(stash.reference);
    this.commitFileDiff.set(null);
    this.selectedCommitFile.set(null);
    this.commitComparison.set(null);
    this.comparisonFileDiff.set(null);
    this.selectedComparisonFile.set(null);
    this.clearWorkingTreeInspection();
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const details = this.browserPreview()
        ? createPreviewCommitDetails(repository, stash.oid)
        : await ipc.inspect_stash({ repoId: repository.id, oid: stash.oid });
      if (request !== this.detailsRequest || repository.id !== this.activeRepositoryId()) return;
      this.commitDetails.set(details);
    } catch (error: unknown) {
      if (request === this.detailsRequest) this.error.set(this.formatError(error));
    } finally {
      if (request === this.detailsRequest) this.detailsBusy.set(false);
    }
  }

  async inspectCommitFile(file: CommitFile): Promise<void> {
    const repository = this.repository();
    const details = this.commitDetails();
    if (!repository || !details) return;
    const request = ++this.fileRequest;
    this.clearFileInsights();
    this.selectedCommitFile.set(file.path);
    this.commitFileDiff.set(null);
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const stashReference = this.inspectedStashReference();
      const diff = this.browserPreview()
        ? createPreviewCommitFileDiff(details.oid, file)
        : stashReference
          ? await ipc.inspect_stash_file({
          repoId: repository.id,
          oid: details.oid,
          path: file.path,
          previousPath: file.previousPath,
        })
          : await ipc.inspect_commit_file({
            repoId: repository.id,
            oid: details.oid,
            path: file.path,
            previousPath: file.previousPath,
          });
      if (
        request === this.fileRequest &&
        repository.id === this.activeRepositoryId() &&
        details.oid === this.commitDetails()?.oid
      ) {
        this.commitFileDiff.set(diff);
      }
    } catch (error: unknown) {
      if (request === this.fileRequest) this.error.set(this.formatError(error));
    } finally {
      if (request === this.fileRequest) this.detailsBusy.set(false);
    }
  }

  async compareCommits(baseOid: string, targetOid: string, mode?: CommitComparison['comparisonMode']): Promise<boolean> {
    const repository = this.repository();
    if (!repository) return false;
    return this.loadComparison(repository.id, () => mode
      ? ipc.compare_history_revisions({ repoId: repository.id, base: baseOid, target: targetOid, mode })
      : this.browserPreview()
        ? Promise.resolve(createPreviewCommitComparison(baseOid, targetOid))
        : ipc.compare_commits({ repoId: repository.id, baseOid, targetOid }), mode);
  }

  async compareCommitWithWorkingTree(baseOid: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    await this.loadComparison(repository.id, () => this.browserPreview()
      ? Promise.resolve(createPreviewWorkingTreeComparison(baseOid))
      : ipc.compare_commit_with_working_tree({ repoId: repository.id, baseOid }));
  }

  cancelHistoryComparison(): void {
    if (this.historyComparisonRequest === this.detailsRequest) this.clearComparisonInspection();
    this.historyComparisonRequest = null;
  }

  private async loadComparison(
    repositoryId: string,
    load: () => Promise<CommitComparison>,
    mode?: CommitComparison['comparisonMode'],
  ): Promise<boolean> {
    this.clearComparisonInspection();
    const request = this.detailsRequest;
    if (mode) this.historyComparisonRequest = request;
    this.clearWorkingTreeInspection();
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const comparison = await load();
      if (request !== this.detailsRequest || repositoryId !== this.activeRepositoryId()) return false;
      this.commitComparison.set(mode ? { ...comparison, comparisonMode: mode } : comparison);
      const firstFile = comparison.files[0];
      if (firstFile) await this.inspectComparisonFile(firstFile);
      return request === this.detailsRequest && repositoryId === this.activeRepositoryId();
    } catch (error: unknown) {
      if (request === this.detailsRequest) {
        // History dialogs own their inline errors; graph inspections use the toast.
        if (mode) throw error;
        this.error.set(this.formatError(error));
      }
      return false;
    } finally {
      if (this.historyComparisonRequest === request) this.historyComparisonRequest = null;
      if (request === this.detailsRequest) this.detailsBusy.set(false);
    }
  }

  async inspectComparisonFile(file: CommitFile): Promise<void> {
    const repository = this.repository();
    const comparison = this.commitComparison();
    if (!repository || !comparison) return;
    const request = ++this.fileRequest;
    this.clearFileInsights();
    this.selectedComparisonFile.set(file.path);
    this.comparisonFileDiff.set(null);
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const diff = this.browserPreview()
        ? createPreviewCommitFileDiff(comparison.targetOid, file)
        : comparison.workingTree
          ? await ipc.compare_commit_file_with_working_tree({
            repoId: repository.id,
            baseOid: comparison.baseOid,
            path: file.path,
            previousPath: file.previousPath,
          })
          : await ipc.compare_commit_file({
            repoId: repository.id,
            baseOid: comparison.baseOid,
            targetOid: comparison.targetOid,
            path: file.path,
            previousPath: file.previousPath,
          });
      if (
        request === this.fileRequest &&
        repository.id === this.activeRepositoryId() &&
        comparison === this.commitComparison()
      ) {
        this.comparisonFileDiff.set(diff);
      }
    } catch (error: unknown) {
      if (request === this.fileRequest) this.error.set(this.formatError(error));
    } finally {
      if (request === this.fileRequest) this.detailsBusy.set(false);
    }
  }

  clearComparisonInspection(): void {
    this.detailsRequest += 1;
    this.fileRequest += 1;
    this.commitDetails.set(null);
    this.commitFileDiff.set(null);
    this.selectedCommitFile.set(null);
    this.commitComparison.set(null);
    this.comparisonFileDiff.set(null);
    this.selectedComparisonFile.set(null);
    this.detailsBusy.set(false);
  }

  async inspectWorkingTreeFile(path: string, staged: boolean): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    this.clearCommitInspection();
    const request = ++this.workingTreeRequest;
    this.clearFileInsights();
    this.selectedWorkingTreeFile.set(`${staged ? 'staged' : 'unstaged'}:${path}`);
    this.workingTreeFileDiff.set(null);
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const diff = this.browserPreview()
        ? createPreviewWorkingTreeDiff(path, staged)
        : await ipc.inspect_working_tree_file({
          repoId: repository.id,
          path,
          staged,
        });
      if (request === this.workingTreeRequest && repository.id === this.activeRepositoryId()) {
        this.workingTreeFileDiff.set(diff);
      }
    } catch (error: unknown) {
      if (request === this.workingTreeRequest) this.error.set(this.formatError(error));
    } finally {
      if (request === this.workingTreeRequest) this.detailsBusy.set(false);
    }
  }

  async inspectFileHistory(path: string, revision: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const request = ++this.fileInsightRequest;
    this.fileHistory.set(null);
    this.fileBlame.set(null);
    this.fileInsightBusy.set(true);
    this.error.set(null);
    try {
      const history = this.browserPreview()
        ? repository.commits.slice(0, 12).map((commit) => ({
          oid: commit.oid,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          authoredAt: commit.authoredAt,
          subject: commit.subject,
        }))
        : await ipc.inspect_file_history({
          repoId: repository.id,
          revision,
          path,
        });
      if (request === this.fileInsightRequest && repository.id === this.activeRepositoryId()) {
        this.fileHistory.set(history);
      }
    } catch (error: unknown) {
      if (request === this.fileInsightRequest) this.error.set(this.formatError(error));
    } finally {
      if (request === this.fileInsightRequest) this.fileInsightBusy.set(false);
    }
  }

  async inspectFileBlame(path: string, revision: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    this.fileBlameTarget = { repoId: repository.id, path, revision };
    this.fileBlameStart.set(1);
    this.fileBlameNext.set(null);
    this.fileBlame.set(null);
    await this.loadFileBlamePage(1, true);
  }

  async resumeFileBlame(path: string, revision: string): Promise<void> {
    const target = this.fileBlameTarget;
    if (target?.repoId === this.activeRepositoryId() && target.path === path && target.revision === revision) return;
    await this.inspectFileBlame(path, revision);
  }

  async retryFileBlame(): Promise<void> {
    await this.loadFileBlamePage(this.fileBlameRequestedLine);
  }

  async loadFileBlamePage(firstLine: number, replacePending = false): Promise<void> {
    const target = this.fileBlameTarget;
    const repository = this.repository();
    if (!target || target.repoId !== repository?.id || (this.fileInsightBusy() && !replacePending)) return;
    if (!Number.isInteger(firstLine) || firstLine < 1 || firstLine > 4_294_967_195) {
      this.fileBlameError.set('Choose a positive whole line number within the file.');
      return;
    }
    this.fileBlameRequestedLine = firstLine;
    const request = ++this.fileInsightRequest;
    this.fileHistory.set(null);
    this.fileBlameError.set(null);
    this.fileInsightBusy.set(true);
    try {
      const blame = this.browserPreview()
        ? { lines: repository.commits.slice(0, 3).map((commit, index) => ({
          lineNumber: index + 1,
          oid: commit.oid,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          authoredAt: Math.floor(Date.parse(commit.authoredAt) / 1_000),
          summary: commit.subject,
          text: index === 0 ? `// ${target.path}` : `preview line ${index + 1}`,
          path: target.path,
        })), nextLine: null }
        : await ipc.inspect_file_blame_page({
          repoId: repository.id,
          revision: target.revision,
          path: target.path,
          firstLine,
        });
      if (request === this.fileInsightRequest && repository.id === this.activeRepositoryId() && target === this.fileBlameTarget) {
        this.fileBlame.set(blame.lines);
        this.fileBlameStart.set(firstLine);
        this.fileBlameNext.set(blame.nextLine);
      }
    } catch (error: unknown) {
      if (request === this.fileInsightRequest && target === this.fileBlameTarget && repository.id === this.activeRepositoryId()) this.fileBlameError.set(this.formatError(error));
    } finally {
      if (request === this.fileInsightRequest) this.fileInsightBusy.set(false);
    }
  }

  async createWorkspace(name: string): Promise<RepositoryWorkspace | null> {
    const normalized = name.trim();
    if (!normalized || this.workspaces().some((workspace) => workspace.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return null;
    const workspace: RepositoryWorkspace = {
      id: this.createWorkspaceId(),
      name: normalized,
      repositoryPaths: [],
      activeRepositoryPath: null,
    };
    this.persistOpenTabs();
    this.workspaces.update((workspaces) => [...workspaces, workspace]);
    this.persistWorkspaces();
    await this.switchWorkspace(workspace.id);
    return workspace;
  }

  renameWorkspace(workspaceId: string, name: string): void {
    const normalized = name.trim();
    if (!normalized || this.workspaces().some((workspace) =>
      workspace.id !== workspaceId && workspace.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return;
    this.workspaces.update((workspaces) => workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, name: normalized } : workspace));
    this.persistWorkspaces();
  }

  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    const workspaces = this.workspaces();
    if (workspaces.length <= 1 || !workspaces.some((workspace) => workspace.id === workspaceId)) return false;
    if (workspaceId === this.activeWorkspaceId()) {
      const next = workspaces.find((workspace) => workspace.id !== workspaceId);
      if (!next) return false;
      await this.switchWorkspace(next.id);
    }
    this.workspaceRepositoryCache.delete(workspaceId);
    this.workspaces.update((items) => items.filter((workspace) => workspace.id !== workspaceId));
    this.persistWorkspaces();
    return true;
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    if (workspaceId === this.activeWorkspaceId() || this.busy()) return;
    const target = this.workspaces().find((workspace) => workspace.id === workspaceId);
    if (!target) return;

    this.persistOpenTabs();
    this.workspaceRepositoryCache.set(this.activeWorkspaceId(), this.repositories());
    this.activeWorkspaceId.set(workspaceId);
    this.persistWorkspaces();
    this.clearInspection();
    this.error.set(null);

    const cached = this.workspaceRepositoryCache.get(workspaceId);
    if (cached) {
      this.repositories.set(cached);
      const active = cached.find((repository) => repository.path === target.activeRepositoryPath) ?? cached[0] ?? null;
      this.activeRepositoryId.set(active?.id ?? null);
      this.activity.set(active ? `Workspace ${target.name}` : 'Ready');
      if (active) void this.refreshRepositoryInBackground(active.id);
      return;
    }

    this.repositories.set([]);
    this.activeRepositoryId.set(null);
    if (target.repositoryPaths.length && this.browserPreview()) {
      const preview = createRepositoryPreview();
      this.repositories.set([preview]);
      this.activeRepositoryId.set(preview.id);
      this.activity.set(`Workspace ${target.name}`);
      this.workspaceRepositoryCache.set(workspaceId, [preview]);
      return;
    }
    if (target.repositoryPaths.length) await this.restoreRepositories();
    else this.activity.set('Ready');
    this.workspaceRepositoryCache.set(workspaceId, this.repositories());
  }

  activateRepository(repoId: string): void {
    if (this.repositories().some((repository) => repository.id === repoId)) {
      this.activeRepositoryId.set(repoId);
      this.clearInspection();
      this.error.set(null);
      this.activity.set('Ready');
      this.persistOpenTabs();
      if (this.deferredMetadataRefreshes.has(repoId)) this.deferMetadataRefresh(repoId);
    }
  }

  closeRepository(repoId = this.activeRepositoryId()): void {
    if (!repoId) return;
    const repositories = this.repositories();
    const closingIndex = repositories.findIndex((repository) => repository.id === repoId);
    const closingRepository = repositories[closingIndex];
    if (!closingRepository) return;
    // A reopened path may reuse the same ID, but not the closed session's page.
    if (this.historyRequest?.repoId === repoId) {
      this.historyRequest = null;
      this.historyLoading.set(false);
    }
    this.bumpStatusGeneration(repoId);
    this.closedRepositories = [
      {
        path: closingRepository.path,
        preview: this.browserPreview() ? closingRepository : null,
      },
      ...this.closedRepositories.filter((repository) => repository.path !== closingRepository.path),
    ].slice(0, 10);
    this.recentlyClosedRepositoryPath.set(this.closedRepositories[0]?.path ?? null);
    const remaining = repositories.filter((repository) => repository.id !== repoId);
    this.deferredMetadataRefreshes.delete(repoId);
    this.repositories.set(remaining);
    if (this.activeRepositoryId() === repoId) {
      const next = remaining[Math.min(Math.max(closingIndex, 0), remaining.length - 1)] ?? null;
      this.activeRepositoryId.set(next?.id ?? null);
      this.clearInspection();
    }
    this.error.set(null);
    this.activity.set('Ready');
    this.persistOpenTabs();
  }

  async reopenClosedRepository(): Promise<boolean> {
    const closed = this.closedRepositories[0];
    if (!closed) return false;
    const openRepository = this.repositories().find((repository) => repository.path === closed.path);
    if (openRepository) {
      this.activateRepository(openRepository.id);
      this.forgetClosedRepository(closed.path);
      return true;
    }
    if (closed.preview && this.browserPreview()) {
      this.storeSnapshot(closed.preview, true);
      this.activeRepositoryId.set(closed.preview.id);
      this.clearInspection();
      this.remember(closed.preview.path);
      this.persistOpenTabs();
      this.forgetClosedRepository(closed.preview.path);
      this.activity.set(`Reopened ${closed.preview.name}`);
      return true;
    }
    await this.openRepository(closed.path);
    return this.repositories().some((repository) => repository.path === closed.path);
  }

  reorderRepository(sourceId: string, targetId: string): void {
    const repositories = this.repositories();
    const reordered = reorderRepositoryTabs(repositories, sourceId, targetId);
    if (reordered === repositories) return;
    this.repositories.set([...reordered]);
    this.persistOpenTabs();
  }

  repositoryLabel(repository: Pick<RepositorySnapshot, 'path' | 'name'>): string {
    return this.repositoryAliases()[repository.path] || repository.name;
  }

  workspaceRepositoryCount(workspace: RepositoryWorkspace): number {
    if (workspace.id !== this.activeWorkspaceId()) return workspace.repositoryPaths.length;
    return Math.max(workspace.repositoryPaths.length, this.repositories().length);
  }

  pathLabel(path: string): string {
    return this.repositoryAliases()[path] || path.split(/[\\/]/).filter(Boolean).at(-1) || path;
  }

  isFavoritePath(path: string): boolean {
    return this.favoritePaths().includes(path);
  }

  toggleFavoritePath(path: string): void {
    const favorites = toggleFavoriteRepository(this.favoritePaths(), path);
    this.favoritePaths.set(favorites);
    try {
      localStorage.setItem(FAVORITE_REPOSITORIES_KEY, JSON.stringify(favorites));
    } catch {
      // Favorites remain available for this session when storage is unavailable.
    }
  }

  removeRecentPath(path: string): void {
    const paths = this.recentPaths().filter((recent) => recent !== path);
    if (paths.length === this.recentPaths().length) return;
    this.recentPaths.set(paths);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(paths));
    } catch {
      // The current session still reflects the removal when storage is unavailable.
    }
  }

  setRepositoryAlias(repoId: string, alias: string): void {
    const repository = this.repositories().find((candidate) => candidate.id === repoId);
    if (!repository) return;
    const normalized = alias.trim();
    this.repositoryAliases.update((aliases) => {
      const updated = { ...aliases };
      if (normalized) updated[repository.path] = normalized;
      else delete updated[repository.path];
      return updated;
    });
    try {
      localStorage.setItem(REPOSITORY_ALIASES_KEY, JSON.stringify(this.repositoryAliases()));
    } catch {
      // Aliases remain available for this session when storage is unavailable.
    }
  }

  dismissError(): void {
    this.error.set(null);
  }

  showWorkingTree(): void {
    this.clearCommitInspection();
  }

  clearActivityLogs(repositoryId: string | null): void {
    this.activityLogs.update((entries) => entries.filter((entry) => entry.repositoryId !== repositoryId));
  }

  async cancelActiveOperation(): Promise<void> {
    const operation = this.activeActivity();
    const operationId = operation?.operationId;
    if (!operationId || !operation.cancelable || this.cancellingOperationIds().includes(operationId)) return;
    this.cancellingOperationIds.update((ids) => [...ids, operationId]);
    try {
      const accepted = await ipc.cancel_git_operation({ operationId });
      if (!accepted) this.finishCancellationRequest(operationId);
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
      this.finishCancellationRequest(operationId);
    }
  }

  private async mutate<K extends SnapshotCommand>(
    command: K,
    pending: string,
    done: string | ((snapshot: RepositorySnapshot) => string),
    ...options: MutationOptions<K>
  ): Promise<'success' | 'error' | 'cancelled' | undefined> {
    const [extra = {}, preserveConflictOnFailure = false] = options;
    const repo = this.repository();
    if (!repo) return;
    const inspectionRequest = { workingTree: this.workingTreeRequest, conflict: this.conflictRequest };
    this.bumpStatusGeneration(repo.id);
    const generation = this.statusGeneration(repo.id);
    const operationId = this.isCancelableCommand(command) ? crypto.randomUUID() : null;
    const result = await this.run(pending, async report => {
      const snapshot = await invokeCommand(command, {
        repoId: repo.id,
        ...extra,
        ...(operationId ? { operationId } : {}),
      } as CommandArgs<K>) as RepositorySnapshot;
      if (generation === this.statusGeneration(repo.id)) {
        this.storeMutationSnapshot(snapshot);
      } else if (this.repositories().some((repository) => repository.id === repo.id)) {
        // Reply order need not match Git's mutation order. Read current state
        // instead of replacing a newer result with this action's snapshot.
        try {
          await this.refreshMutationSnapshot(repo.id, inspectionRequest);
        } catch {
          // The mutation succeeded even if reconciliation needs a later retry.
          this.deferMetadataRefresh(repo.id);
        }
      }
      this.clearMutationInspection(repo.id, inspectionRequest);
      report(typeof done === 'function' ? done(snapshot) : done);
    }, repo.id, operationId);
    if (result === 'error' && this.repositories().some((repository) => repository.id === repo.id)) {
      try {
        await this.refreshMutationSnapshot(repo.id, inspectionRequest, preserveConflictOnFailure);
      } catch {
        // Keep the original mutation error; a manual refresh can retry the snapshot.
      }
    }
    // Fast snapshots skip untracked discovery; complete the status right away.
    if (this.repositories().some((repository) => repository.id === repo.id)) {
      void this.refreshStatusInBackground(repo.id, true);
    }
    return result;
  }

  /**
   * Runs an index or working-tree change that cannot move references or
   * history. The predicted status is shown immediately, and the backend
   * returns only the refreshed status instead of a full snapshot.
   */
  private async mutateWorkingTree<K extends StatusCommand>(
    command: K,
    pending: string,
    done: string,
    extra: Omit<CommandArgs<K>, 'repoId'>,
    predict?: (status: RepositoryStatus) => RepositoryStatus,
  ): Promise<WorkingTreeMutationResult> {
    return this.changeWorkingTree(pending, done,
      repoId => invokeCommand(command, { repoId, ...extra } as CommandArgs<K>) as Promise<RepositoryStatus>, predict);
  }

  private async changeWorkingTree(
    pending: string,
    done: string,
    change: (repoId: string) => Promise<RepositoryStatus>,
    predict: (status: RepositoryStatus) => RepositoryStatus = status => status,
  ): Promise<WorkingTreeMutationResult> {
    const repo = this.repository();
    if (!repo) return { succeeded: false, inspectionRequest: this.workingTreeRequest };
    const repoId = repo.id;
    let inspectionRequest = this.workingTreeRequest;
    const conflictRequest = this.conflictRequest;
    this.bumpStatusGeneration(repoId);
    const generation = this.statusGeneration(repoId);
    this.storeStatus(repoId, predict(repo.status));
    this.pendingWorkingTreeMutations.set(repoId, (this.pendingWorkingTreeMutations.get(repoId) ?? 0) + 1);
    let status: RepositoryStatus | null = null;
    const outcome = await this.run(pending, async report => {
      status = await change(repoId);
      // Only invalidate the inspection that existed when this change began.
      if (repoId === this.activeRepositoryId() && inspectionRequest === this.workingTreeRequest) {
        this.clearWorkingTreeInspection(conflictRequest !== this.conflictRequest);
        inspectionRequest = this.workingTreeRequest;
      }
      report(done);
    }, repoId);
    const result = { succeeded: outcome === 'success', inspectionRequest };
    const statusIsCurrent = generation === this.statusGeneration(repoId);
    // Every completion invalidates older replies, including overlapping work.
    this.bumpStatusGeneration(repoId);
    const remaining = (this.pendingWorkingTreeMutations.get(repoId) ?? 1) - 1;
    if (remaining > 0) {
      // Reply order does not establish the order in which Git applied changes.
      this.pendingWorkingTreeMutations.set(repoId, remaining);
      return result;
    }
    this.pendingWorkingTreeMutations.delete(repoId);
    if (status && statusIsCurrent) {
      this.storeStatus(repoId, status);
    } else {
      // Reconcile failures and changed contexts without overwriting newer work.
      await this.refreshStatusInBackground(repoId, true);
    }
    return result;
  }

  private statusGeneration(repoId: string): number {
    return this.statusGenerations.get(repoId) ?? 0;
  }

  private bumpStatusGeneration(repoId: string): void {
    this.statusGenerations.set(repoId, this.statusGeneration(repoId) + 1);
  }

  private storeStatus(repoId: string, status: RepositoryStatus): void {
    this.repositories.update((repositories) => {
      const index = repositories.findIndex((candidate) => candidate.id === repoId);
      if (index < 0 || sameRepositoryStatus(status, repositories[index].status)) return repositories;
      const candidate = repositories[index];
      const updated = [...repositories];
      updated[index] = {
        ...candidate,
        status,
        worktrees: candidate.worktrees.map((worktree) => worktree.current
          ? { ...worktree, changes: status.entryCount, ahead: status.ahead, behind: status.behind }
          : worktree),
      };
      return updated;
    });
  }

  private storeMutationSnapshot(snapshot: RepositorySnapshot): void {
    const previous = this.repositories().find((repository) => repository.id === snapshot.id);
    this.bumpStatusGeneration(snapshot.id);
    this.storeSnapshot(previous
      ? { ...snapshot, status: preserveUntrackedEntries(previous.status, snapshot.status) }
      : snapshot);
  }

  private clearMutationInspection(repoId: string, request: MutationInspection, preserveConflict = false): void {
    // A completion may invalidate its original inspection, never a newer one.
    if (repoId === this.activeRepositoryId() && request.workingTree === this.workingTreeRequest) {
      this.clearWorkingTreeInspection(preserveConflict || request.conflict !== this.conflictRequest);
    }
  }

  private async refreshMutationSnapshot(repoId: string, request: MutationInspection, preserveConflict = false): Promise<void> {
    const generation = this.statusGeneration(repoId);
    const snapshot = await ipc.refresh_repository({ repoId });
    // A newer mutation or close/reopen owns the state once this read is stale.
    if (generation !== this.statusGeneration(repoId)) return;
    this.storeMutationSnapshot(snapshot);
    this.clearMutationInspection(repoId, request, preserveConflict);
  }

  private acceptOpenedRepository(snapshot: RepositorySnapshot, activity: string, report: ActivityReporter): void {
    this.storeSnapshot(snapshot, true);
    this.activeRepositoryId.set(snapshot.id);
    this.clearInspection();
    this.remember(snapshot.path);
    this.persistOpenTabs(this.incomingRepositoryLinksPending());
    report(activity);
    this.deferMetadataRefresh(snapshot.id);
  }

  // Report completion through the callback; the shared status can belong to
  // another operation by the time this action's promise resolves.
  async run(
    label: string,
    action: (report: ActivityReporter) => Promise<void>,
    repositoryId: string | null = null,
    operationId: string | null = null,
    refreshOnCancel = true,
  ): Promise<'success' | 'error' | 'cancelled'> {
    const id = this.nextActivityId++;
    const startedAt = Date.now();
    const inspectionRequest = { workingTree: this.workingTreeRequest, conflict: this.conflictRequest };
    let description = label.replace(/…$/, '');
    const entry: ActivityLogEntry = {
      id,
      timestamp: new Date(startedAt).toISOString(),
      description,
      durationMs: null,
      status: 'running',
      repositoryId,
      detail: null,
      operationId,
      cancelable: operationId !== null,
    };
    this.activityLogs.update((entries) => [
      ...entries,
      entry,
    ].slice(-250));
    this.updateRunningOperations(1);
    this.error.set(null);
    this.lastFailureKind = null;
    this.activity.set(label);
    const report: ActivityReporter = message => {
      description = message;
      this.activity.set(message);
    };
    try {
      await action(report);
      this.finishActivity(id, 'success', description, startedAt, null);
      return 'success';
    } catch (error: unknown) {
      this.lastFailureKind = this.errorKind(error);
      const cancelled = this.isOperationCancelled(error);
      let detail = this.formatError(error);
      if (cancelled && repositoryId && refreshOnCancel) {
        try {
          await this.refreshMutationSnapshot(repositoryId, inspectionRequest);
          this.activity.set('Operation canceled; repository state refreshed');
        } catch (refreshError: unknown) {
          detail += ` Repository refresh also failed: ${this.formatError(refreshError)}`;
          this.error.set(detail);
          this.activity.set('Operation canceled; repository refresh failed');
        }
      } else {
        this.error.set(detail);
        this.activity.set(cancelled ? 'Operation canceled' : 'Operation failed');
      }
      const status = cancelled ? 'cancelled' : 'error';
      this.finishActivity(id, status, label.replace(/…$/, ''), startedAt, detail);
      return status;
    } finally {
      if (operationId) this.finishCancellationRequest(operationId);
      this.updateRunningOperations(-1);
    }
  }

  private updateRunningOperations(delta: 1 | -1): void {
    this.runningOperations += delta;
    this.busy.set(this.runningOperations > 0);
  }

  private finishActivity(
    id: number,
    status: Exclude<ActivityLogEntry['status'], 'running'>,
    description: string,
    startedAt: number,
    detail: string | null,
  ): void {
    this.activityLogs.update((entries) => entries.map((entry) => entry.id === id ? {
      ...entry,
      description,
      durationMs: Date.now() - startedAt,
      status,
      detail,
    } : entry));
  }

  private setHistoryUndone(repoId: string, entry: OperationHistoryEntry, undone: boolean): void {
    this.operationHistory.update((history) => {
      // A late replay must not toggle an entry recorded while it was pending.
      return history[repoId] === entry ? { ...history, [repoId]: { ...entry, undone } } : history;
    });
  }

  private recordDiscard(repoId: string, label: string, recoveryId?: string): void {
    this.operationHistory.update((history) => ({
      ...history,
      [repoId]: { kind: 'discard', label, undone: false, recoveryId },
    }));
  }

  // Completion belongs to the originating repository, not the active tab.
  // Callers check the mutation outcome; the shared error toast is independent.
  private recordCheckout(
    repoId: string | undefined,
    beforeBranch: string | null | undefined,
  ): void {
    const afterBranch = this.repositories().find(repository => repository.id === repoId)?.status.branch;
    const entry = createCheckoutHistoryEntry(beforeBranch, afterBranch);
    if (!repoId || !entry) return;
    this.operationHistory.update((history) => ({
      ...history,
      [repoId]: entry,
    }));
  }

  private recordHeadChange(
    repoId: string | undefined,
    beforeOid: string | null | undefined,
    label: string,
  ): void {
    const afterOid = this.repositories().find(repository => repository.id === repoId)?.headOid;
    const entry = createHeadHistoryEntry(beforeOid, afterOid, label);
    if (!repoId || !entry) return;
    this.operationHistory.update((history) => ({ ...history, [repoId]: entry }));
  }

  private clearInspection(): void {
    this.clearCommitInspection();
    this.clearWorkingTreeInspection();
    this.clearFileInsights();
  }

  private clearCommitInspection(): void {
    this.detailsRequest += 1;
    this.fileRequest += 1;
    this.commitDetails.set(null);
    this.inspectedStashReference.set(null);
    this.commitFileDiff.set(null);
    this.selectedCommitFile.set(null);
    this.commitComparison.set(null);
    this.comparisonFileDiff.set(null);
    this.selectedComparisonFile.set(null);
    this.detailsBusy.set(false);
  }

  private clearWorkingTreeInspection(preserveConflict = false): void {
    this.workingTreeRequest += 1;
    this.workingTreeFileDiff.set(null);
    this.selectedWorkingTreeFile.set(null);
    if (!preserveConflict) this.closeConflict();
    this.detailsBusy.set(false);
  }

  private clearFileInsights(): void {
    this.fileInsightRequest += 1;
    this.fileHistory.set(null);
    this.fileBlame.set(null);
    this.fileBlameTarget = null;
    this.fileBlameStart.set(1);
    this.fileBlameNext.set(null);
    this.fileBlameError.set(null);
    this.fileInsightBusy.set(false);
  }

  private formatError(error: unknown): string {
    const payload = error as { message?: string; hint?: string | null };
    return [payload?.message ?? String(error), payload?.hint].filter(Boolean).join(' ');
  }

  private errorKind(error: unknown): string | null {
    return typeof error === 'object' && error !== null && 'kind' in error && typeof error.kind === 'string'
      ? error.kind
      : null;
  }

  private isOperationCancelled(error: unknown): boolean {
    return typeof error === 'object'
      && error !== null
      && 'kind' in error
      && error.kind === 'operationCancelled';
  }

  private isCancelableCommand(command: string): boolean {
    return [
      'fetch_repository',
      'fetch_branches',
      'pull_repository',
      'push_repository',
      'force_push_repository',
      'publish_branch',
      'lfs_pull',
      'lfs_fetch_object',
      'lfs_checkout_object',
      'lfs_prune',
      'lfs_prune_objects',
      'update_submodule',
      'update_all_submodules',
      'transport_reference',
      'add_submodule',
      'initialize_submodule',
      'initialize_all_submodules',
    ].includes(command);
  }

  private finishCancellationRequest(operationId: string): void {
    this.cancellingOperationIds.update((ids) => ids.filter((id) => id !== operationId));
  }

  private remember(path: string): void {
    const paths = [path, ...this.recentPaths().filter((recent) => recent !== path)].slice(0, 8);
    this.recentPaths.set(paths);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(paths));
    } catch {
      // Repository access must keep working when WebView storage is unavailable.
    }
  }

  private forgetClosedRepository(path: string): void {
    this.closedRepositories = this.closedRepositories.filter((repository) => repository.path !== path);
    this.recentlyClosedRepositoryPath.set(this.closedRepositories[0]?.path ?? null);
  }

  private async restoreRepositories(): Promise<void> {
    const workspaceId = this.activeWorkspaceId();
    const workspace = this.activeWorkspace();
    const paths = workspace?.repositoryPaths ?? [];
    if (!paths.length) return;
    const activePath = workspace?.activeRepositoryPath ?? null;
    const ordered = [
      ...paths.filter((path) => path === activePath),
      ...paths.filter((path) => path !== activePath),
    ];
    const failedPaths: string[] = [];
    this.updateRunningOperations(1);
    this.activity.set('Restoring active repository…');
    let restoredPath: string | null = null;
    try {
      for (const path of ordered) {
        try {
          const snapshot = await ipc.open_repository({ path });
          if (this.activeWorkspaceId() !== workspaceId) return;
          this.storeSnapshot(snapshot, true);
          this.activeRepositoryId.set(snapshot.id);
          this.deferredMetadataRefreshes.add(snapshot.id);
          restoredPath = path;
          break;
        } catch {
          failedPaths.push(path);
        }
      }
      this.activity.set('Ready');
    } finally {
      this.updateRunningOperations(-1);
    }
    if (!restoredPath) {
      if (failedPaths.length) this.reportRestoreFailures(failedPaths);
      return;
    }
    const activeRepositoryId = this.activeRepositoryId();
    if (activeRepositoryId) this.deferMetadataRefresh(activeRepositoryId);
    const remaining = paths.filter((path) => path !== restoredPath);
    if (this.incomingRepositoryLinksPending()) await this.restoreRepositoryTabs(remaining, paths, workspaceId);
    else this.restoreRepositoryTabsWhenIdle(remaining, paths, workspaceId);
  }

  private restoreRepositoryTabsWhenIdle(paths: string[], originalOrder: string[], workspaceId: string): void {
    if (!paths.length) return;
    if (this.activeWorkspaceId() !== workspaceId) return;
    if (typeof window === 'undefined') {
      void this.restoreRepositoryTabs(paths, originalOrder, workspaceId);
      return;
    }
    window.setTimeout(() => {
      if (this.activeWorkspaceId() !== workspaceId) return;
      if (this.busy() || this.liveRefreshes.size || this.backgroundFetchBusy()) {
        this.restoreRepositoryTabsWhenIdle(paths, originalOrder, workspaceId);
        return;
      }
      void this.restoreRepositoryTabs(paths, originalOrder, workspaceId);
    }, 3_000);
  }

  private async restoreRepositoryTabs(paths: string[], originalOrder: string[], workspaceId: string): Promise<void> {
    const failedPaths: string[] = [];
    for (const path of paths) {
      if (this.activeWorkspaceId() !== workspaceId) return;
      try {
        const snapshot = await ipc.open_repository({ path });
        if (this.activeWorkspaceId() !== workspaceId) return;
        this.deferredMetadataRefreshes.add(snapshot.id);
        this.storeSnapshot(snapshot, true);
        this.repositories.update((repositories) => [...repositories].sort(
          (left, right) => originalOrder.indexOf(left.path) - originalOrder.indexOf(right.path),
        ));
      } catch {
        failedPaths.push(path);
      }
    }
    if (failedPaths.length) this.reportRestoreFailures(failedPaths);
    else this.persistOpenTabs();
  }

  private reportRestoreFailures(paths: readonly string[]): void {
    const labels = paths.map((path) => this.pathLabel(path));
    this.error.set(
      `Could not restore ${paths.length} saved ${paths.length === 1 ? 'repository' : 'repositories'}: ${labels.join(', ')}. Check the folder or reopen it from Recent repositories.`,
    );
  }

  private persistOpenTabs(preserveSavedPaths = false): void {
    const loadedPaths = this.repositories().map((repository) => repository.path);
    const repositoryPaths = preserveSavedPaths
      ? [...new Set([...(this.activeWorkspace()?.repositoryPaths ?? []), ...loadedPaths])]
      : loadedPaths;
    const activeRepositoryPath = this.repository()?.path ?? null;
    const workspaceId = this.activeWorkspaceId();
    this.workspaceRepositoryCache.set(workspaceId, this.repositories());
    this.workspaces.update((workspaces) => workspaces.map((workspace) => workspace.id === workspaceId
      ? { ...workspace, repositoryPaths, activeRepositoryPath }
      : workspace));
    try {
      this.persistWorkspaces();
      localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(repositoryPaths));
      if (activeRepositoryPath) localStorage.setItem(ACTIVE_PATH_KEY, activeRepositoryPath);
      else localStorage.removeItem(ACTIVE_PATH_KEY);
    } catch {
      // Tabs remain usable when WebView storage is unavailable.
    }
  }

  private deferMetadataRefresh(repositoryId: string): void {
    this.deferredMetadataRefreshes.add(repositoryId);
    if (typeof window === 'undefined') return;
    window.setTimeout(() => {
      if (this.activeRepositoryId() !== repositoryId || !this.deferredMetadataRefreshes.has(repositoryId)) return;
      if (this.busy() || this.detailsBusy() || this.historyLoading() || this.changesLoading() || this.backgroundFetchBusy()) {
        this.deferMetadataRefresh(repositoryId);
        return;
      }
      void this.refreshRepositoryInBackground(repositoryId);
    }, 1_200);
  }

  private async storeRefreshedSnapshot(snapshot: RepositorySnapshot): Promise<void> {
    const previous = this.repositories().find((repository) => repository.id === snapshot.id);
    if (!previous) return;
    // Metadata snapshots omit untracked discovery. Keep known entries visible
    // until the asynchronous status scan can discover additions and removals.
    this.storeSnapshot({ ...snapshot, status: preserveUntrackedEntries(previous.status, snapshot.status) });
    await this.refreshStatusInBackground(snapshot.id, true);
  }

  private storeSnapshot(snapshot: RepositorySnapshot, addIfMissing = false): void {
    this.repositories.update((repositories) => {
      const index = repositories.findIndex((repository) => repository.id === snapshot.id);
      if (index < 0) return addIfMissing ? [...repositories, snapshot] : repositories;
      const previous = repositories[index];
      // Preserve collection identities when a refresh reports the same graph.
      // Angular can then skip history layout work for status-only updates.
      snapshot = {
        ...snapshot,
        commits: reconcileCommitHistory(previous.commits, snapshot.commits),
        branches: sameItems(
          previous.branches,
          snapshot.branches,
          (branch) => `${branch.fullName}\0${branch.oid}\0${branch.current}\0${branch.upstream ?? ''}\0${branch.tracking ?? ''}`,
        ) ? previous.branches : snapshot.branches,
        stashes: sameItems(
          previous.stashes,
          snapshot.stashes,
          (stash) => `${stash.reference}\0${stash.oid}\0${stash.message}`,
        ) ? previous.stashes : snapshot.stashes,
      };
      const updated = [...repositories];
      updated[index] = snapshot;
      return updated;
    });
  }

  private readRecents(): string[] {
    return this.readStringArray(RECENTS_KEY);
  }

  private persistWorkspaces(): void {
    try {
      localStorage.setItem(WORKSPACES_KEY, JSON.stringify(this.workspaces()));
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, this.activeWorkspaceId());
    } catch {
      // Workspace changes remain available for this session.
    }
  }

  private readWorkspaces(): RepositoryWorkspace[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(WORKSPACES_KEY) ?? 'null');
      if (Array.isArray(value)) {
        const workspaces = value.flatMap((candidate): RepositoryWorkspace[] => {
          if (!candidate || typeof candidate !== 'object') return [];
          const workspace = candidate as Partial<RepositoryWorkspace>;
          if (typeof workspace.id !== 'string' || !workspace.id
            || typeof workspace.name !== 'string' || !workspace.name.trim()
            || !Array.isArray(workspace.repositoryPaths)
            || !workspace.repositoryPaths.every((path) => typeof path === 'string')
            || (workspace.activeRepositoryPath !== null && typeof workspace.activeRepositoryPath !== 'string')) {
            return [];
          }
          const repositoryPaths = [...new Set(workspace.repositoryPaths)];
          return [{
            id: workspace.id,
            name: workspace.name.trim(),
            repositoryPaths,
            activeRepositoryPath: repositoryPaths.includes(workspace.activeRepositoryPath ?? '')
              ? workspace.activeRepositoryPath ?? null
              : repositoryPaths[0] ?? null,
          }];
        });
        if (workspaces.length) return workspaces;
      }
    } catch {
      // Migrate the legacy single-workspace tab state below.
    }
    const repositoryPaths = this.readStringArray(OPEN_TABS_KEY);
    const activeRepositoryPath = this.readStorage(ACTIVE_PATH_KEY);
    return [{
      id: DEFAULT_WORKSPACE_ID,
      name: 'Default',
      repositoryPaths,
      activeRepositoryPath: activeRepositoryPath && repositoryPaths.includes(activeRepositoryPath)
        ? activeRepositoryPath
        : repositoryPaths[0] ?? null,
    }];
  }

  private readActiveWorkspaceId(workspaces: readonly RepositoryWorkspace[]): string {
    const stored = this.readStorage(ACTIVE_WORKSPACE_KEY);
    return workspaces.some((workspace) => workspace.id === stored) ? stored! : workspaces[0].id;
  }

  private createWorkspaceId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  private readFavorites(): string[] {
    return this.readStringArray(FAVORITE_REPOSITORIES_KEY);
  }

  private readAliases(): Record<string, string> {
    try {
      const value = JSON.parse(localStorage.getItem(REPOSITORY_ALIASES_KEY) ?? '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
        ),
      );
    } catch {
      return {};
    }
  }

  private readStringArray(key: string): string[] {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
    } catch {
      return [];
    }
  }

  private readStorage(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

function createPreviewCommitDetails(repository: RepositorySnapshot, oid: string | null): CommitDetails {
  const commit = repository.commits.find((candidate) => candidate.oid === oid) ?? repository.commits[0];
  const files = commit.subject.includes('graph')
    ? [
        { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 42, deletions: 11 },
        { status: 'M', path: 'apps/desktop/src/app/app.component.html', previousPath: null, additions: 18, deletions: 6 },
        { status: 'M', path: 'apps/desktop/src/app/app.component.scss', previousPath: null, additions: 27, deletions: 4 },
      ]
    : commit.subject.includes('staging')
      ? [
          { status: 'M', path: 'crates/git-core/src/lib.rs', previousPath: null, additions: 31, deletions: 9 },
          { status: 'M', path: 'apps/desktop/src/app/git-khronos.service.ts', previousPath: null, additions: 22, deletions: 7 },
          { status: 'A', path: 'apps/desktop/src/app/virtual-list.spec.ts', previousPath: null, additions: 38, deletions: 0 },
        ]
      : [
          { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 24, deletions: 8 },
          { status: 'M', path: 'apps/desktop/src/app/app.component.html', previousPath: null, additions: 16, deletions: 5 },
          { status: 'A', path: 'docs/interface-notes.md', previousPath: null, additions: 12, deletions: 0 },
        ];
  return {
    oid: commit.oid,
    message: `${commit.subject}\n\n${commit.description}`.trim(),
    signature: commit.oid === repository.headOid
      ? {
          status: 'valid',
          signer: `${commit.authorName} <${commit.authorEmail}>`,
          key: 'A1B2C3D4E5F60718',
          fingerprint: '9F3A54D2A1B2C3D4E5F6071829384756ABCDEF01',
          trust: 'ultimate',
        }
      : { status: 'unsigned', signer: null, key: null, fingerprint: null, trust: null },
    files,
    filesTruncated: false,
  };
}

function createPreviewCommitComparison(baseOid: string, targetOid: string): CommitComparison {
  return {
    baseOid,
    targetOid,
    workingTree: false,
    files: [
      { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 19, deletions: 7 },
      { status: 'A', path: 'apps/desktop/src/app/compare-panel.scss', previousPath: null, additions: 34, deletions: 0 },
    ],
  };
}

function createPreviewWorkingTreeComparison(baseOid: string): CommitComparison {
  return {
    baseOid,
    targetOid: baseOid,
    workingTree: true,
    files: [
      { status: 'M', path: 'apps/desktop/src/app/app.component.html', previousPath: null, additions: 16, deletions: 5 },
      { status: 'M', path: 'apps/desktop/src/app/app.component.scss', previousPath: null, additions: 8, deletions: 3 },
      { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 19, deletions: 7 },
      { status: 'A', path: 'docs/interface-notes.md', previousPath: null, additions: 12, deletions: 0 },
    ],
  };
}

function createPreviewCommitFileDiff(oid: string, file: CommitFile): CommitFileDiff {
  return {
    oid,
    path: file.path,
    patch: createPreviewPatch(file.path),
    truncated: false,
  };
}

function createPreviewWorkingTreeDiff(path: string, staged: boolean): WorkingTreeFileDiff {
  return {
    path,
    staged,
    patch: createPreviewPatch(path),
    truncated: false,
  };
}

function createPreviewPatch(path: string): string {
  const body = path.endsWith('.html')
    ? [' <section class="history-panel">', '-  <div class="commit-list">', '+  <div class="commit-list" aria-label="Commit history">', ' </section>']
    : path.endsWith('.scss')
      ? [' .commit-row {', '-  min-height: 38px;', '+  min-height: 40px;', '+  content-visibility: auto;', ' }']
      : path.endsWith('.md')
        ? [' # Interface notes', '', '+Keep repository context visible while inspecting file changes.']
        : [' export class AppComponent {', '-  readonly selectedCommit = signal<string | null>(null);', '+  readonly selectedCommits = signal<string[]>([]);', '+  readonly selectedCommit = computed(() => this.selectedCommits().at(-1) ?? null);', ' }'];
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,4 +1,5 @@',
    ...body,
  ].join('\n');
}

function createRepositoryPreview(): RepositorySnapshot {
  const commits = [
    { oid: 'f19b263a8af31408d5f665caf7a5508e108c0fd1', parents: ['83e6d15fb82672899688b93f59251dfc669888a3'], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-10-03T09:42:00Z', subject: 'Polish repository activity drawer', description: 'Make operation history easier to scan and diagnose.', decorations: ['HEAD -> main'] },
    { oid: '83e6d15fb82672899688b93f59251dfc669888a3', parents: ['160acd10ef9e0c202cd3985aa41ee45d971bbb11', '7c17b9d37d6a36dc9477e611109136f86477041a'], authorName: 'Leo Martin', authorEmail: 'leo@example.test', authoredAt: '2026-10-02T15:28:00Z', subject: 'Merge feature/partial-staging', description: 'Bring selective staging into the main workflow.', decorations: ['origin/main', 'upstream/main'] },
    { oid: '160acd10ef9e0c202cd3985aa41ee45d971bbb11', parents: ['ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2'], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-10-02T12:11:00Z', subject: 'Add hunk-level staging actions', description: 'Stage, unstage, and discard individual diff hunks.', decorations: ['tag: v0.1.0'] },
    { oid: '7c17b9d37d6a36dc9477e611109136f86477041a', parents: ['ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2'], authorName: 'Sam Rivera', authorEmail: 'sam@example.test', authoredAt: '2026-10-02T10:03:00Z', subject: 'Refine graph lane rendering', description: 'Keep first-parent histories straight through commit nodes.', decorations: ['feature/partial-staging'] },
    { oid: 'ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2', parents: ['14adfbb0c1685f62cba66f031306a510e3f501a2'], authorName: 'Alex Kim', authorEmail: 'alex@example.test', authoredAt: '2026-10-01T17:45:00Z', subject: 'Persist graph column preferences', description: 'Restore widths, ordering, and visibility per repository.', decorations: ['heads/release', 'remotes/origin/release', 'refs/remotes/upstream/release'] },
    { oid: '14adfbb0c1685f62cba66f031306a510e3f501a2', parents: [], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-09-29T08:17:00Z', subject: 'Initialize Git Khronos desktop', description: 'Create the Angular, Nx, Rust, and Tauri workspace.', decorations: [] },
  ];
  const headOid = commits[0].oid;
  const mergeOid = commits[1].oid;
  const tagOid = commits[2].oid;
  const featureOid = commits[3].oid;
  const releaseOid = commits[4].oid;
  const stashOid = 'b894e72d924a593884fad954e31fa5cc6f4b0bd9';
  commits.unshift({ oid: stashOid, parents: [headOid], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-10-03T10:05:00Z', subject: 'WIP on graph polish', description: '', decorations: ['refs/stash'] });
  return {
    id: 'browser-preview',
    name: 'git-khronos',
    path: '/home/maya/projects/git-khronos',
    identity: { name: 'Maya Chen', email: 'maya@example.test' },
    headOid,
    status: {
      branch: 'main', ahead: 1, behind: 0, staged: 1, unstaged: 2, untracked: 1, conflicted: 0, mergeInProgress: false, historyOperation: null, historyNoCommit: false, rebaseInProgress: false, rebaseEditStopped: false, rebaseSplit: null, mailPatchInProgress: false, bisectInProgress: false, entryCount: 4, entriesTruncated: false,
      entries: [
        { path: 'apps/desktop/src/app/app.component.ts', indexStatus: 'M', worktreeStatus: ' ', conflicted: false },
        { path: 'apps/desktop/src/app/app.component.html', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
        { path: 'apps/desktop/src/app/app.component.scss', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
        { path: 'docs/interface-notes.md', indexStatus: '?', worktreeStatus: '?', conflicted: false },
      ],
    },
    signing: { enabled: false, format: 'openpgp', key: null },
    remotes: [
      { name: 'origin', fetchUrl: 'git@github.com:example/git-khronos.git', pushUrl: 'git@github.com:example/git-khronos.git' },
      { name: 'upstream', fetchUrl: 'https://github.com/example/git-khronos.git', pushUrl: 'https://github.com/example/git-khronos.git' },
    ],
    branches: [
      { fullName: 'refs/heads/feature/partial-staging', name: 'feature/partial-staging', oid: featureOid, current: false, remote: false, upstream: null, tracking: null },
      { fullName: 'refs/heads/main', name: 'main', oid: headOid, current: true, remote: false, upstream: 'origin/main', tracking: 'ahead 1' },
      { fullName: 'refs/heads/release', name: 'release', oid: releaseOid, current: false, remote: false, upstream: 'origin/release', tracking: null },
      { fullName: 'refs/remotes/origin/main', name: 'origin/main', oid: mergeOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/origin/release', name: 'origin/release', oid: releaseOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/upstream/main', name: 'upstream/main', oid: mergeOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/upstream/release', name: 'upstream/release', oid: releaseOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/origin/docs', name: 'origin/docs', oid: tagOid, current: false, remote: true, upstream: null, tracking: null },
      { fullName: 'refs/remotes/upstream/docs', name: 'upstream/docs', oid: featureOid, current: false, remote: true, upstream: null, tracking: null },
    ],
    stashes: [{ reference: 'stash@{0}', oid: stashOid, message: 'WIP on graph polish' }],
    tags: [{ fullName: 'refs/tags/v0.1.0', name: 'v0.1.0', oid: tagOid }],
    worktrees: [
      { path: '/home/maya/projects/git-khronos', oid: headOid, branch: 'main', current: true, locked: false, prunable: false, statusLoaded: true, changes: 4, ahead: 1, behind: 0 },
      { path: '/home/maya/projects/git-khronos-partial-staging', oid: featureOid, branch: 'feature/partial-staging', current: false, locked: false, prunable: false, statusLoaded: true, changes: 2, ahead: 0, behind: 0 },
    ],
    submodules: [
      { name: 'vendor/lane-engine', path: 'vendor/lane-engine', absolutePath: '/home/maya/projects/git-khronos/vendor/lane-engine', url: 'https://github.com/example/lane-engine.git', oid: commits[4].oid, headOid: commits[4].oid, initialized: true, outOfSync: false },
      { name: 'plugins/diff-driver', path: 'plugins/diff-driver', absolutePath: '/home/maya/projects/git-khronos/plugins/diff-driver', url: 'git@github.com:example/diff-driver.git', oid: commits[5].oid, headOid: null, initialized: false, outOfSync: false },
    ],
    lfs: { enabled: false, available: false, version: null, trackedFiles: null, pointerFiles: null },
    sparseCheckout: { enabled: false, coneMode: true, sparseIndex: false, paths: [] },
    commitTemplate: null,
    commitTemplateError: null,
    bare: false,
    commits,
    historyTruncated: false,
  };
}
