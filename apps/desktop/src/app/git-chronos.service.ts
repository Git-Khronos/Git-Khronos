import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  CommitComparison,
  CommitDetails,
  CommitFile,
  CommitFileDiff,
  CommitHistoryPage,
  ConflictDetails,
  FileBlameLine,
  FileHistoryEntry,
  InteractiveRebasePlan,
  InteractiveRebaseStep,
  ReflogPage,
  RepositoryStatus,
  RepositorySnapshot,
  SigningDiagnostic,
  SystemInfo,
  TagDetails,
  TrackedFileSearch,
  WorkingTreeFileDiff,
} from '@git-chronos/contracts';
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
import {
  predictDiscardPath,
  predictStageAll,
  predictStagePath,
  predictUnstageAll,
  predictUnstagePath,
  preserveUntrackedEntries,
} from './working-tree-status';

const RECENTS_KEY = 'git-chronos.recent-repositories.v1';
const OPEN_TABS_KEY = 'git-chronos.open-repositories.v1';
const ACTIVE_PATH_KEY = 'git-chronos.active-repository.v1';
const REPOSITORY_ALIASES_KEY = 'git-chronos.repository-aliases.v1';
const WORKSPACES_KEY = 'git-chronos.workspaces.v1';
const ACTIVE_WORKSPACE_KEY = 'git-chronos.active-workspace.v1';
const DEFAULT_WORKSPACE_ID = 'default';

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
    && left.rebaseInProgress === right.rebaseInProgress
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
export class GitChronosService {
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
  readonly recentPaths = signal<string[]>(this.readRecents());
  readonly favoritePaths = signal<string[]>(this.readFavorites());
  readonly repositoryAliases = signal<Record<string, string>>(this.readAliases());
  readonly recentlyClosedRepositoryPath = signal<string | null>(null);
  readonly busy = signal(false);
  readonly backgroundFetchBusy = signal(false);
  readonly backgroundFetchRepositoryId = signal<string | null>(null);
  readonly backgroundFetchLastAt = signal<Record<string, number>>({});
  readonly backgroundFetchErrors = signal<Record<string, string>>({});
  readonly historyLoading = signal(false);
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
  readonly fileHistory = signal<FileHistoryEntry[] | null>(null);
  readonly fileBlame = signal<FileBlameLine[] | null>(null);
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
    try {
      this.systemInfo.set(await invoke<SystemInfo>('system_info'));
      await this.restoreRepositories();
    } catch {
      this.systemInfo.set({
        appVersion: 'browser preview',
        gitVersion: null,
        gitSupported: false,
        minimumGitVersion: '2.34.0',
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
            fetchUrl: 'git@gitlab.com:example/platform/git-chronos.git',
            pushUrl: 'git@gitlab.com:example/platform/git-chronos.git',
          }];
        } else if (hostingPreview === 'bitbucket') {
          preview.remotes = [{
            name: 'origin',
            fetchUrl: 'git@bitbucket.org:example/git-chronos.git',
            pushUrl: 'git@bitbucket.org:example/git-chronos.git',
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
          preview.status = {
            ...preview.status,
            conflicted: 1,
            mergeInProgress: true,
            entries: preview.status.entries.map((entry, index) => index === 0
              ? { ...entry, indexStatus: 'U', worktreeStatus: 'U', conflicted: true }
              : entry),
          };
        }
        const historyPreview = previewOptions.get('history-preview');
        if (historyPreview === 'cherry-pick' || historyPreview === 'revert') {
          preview.status = {
            ...preview.status,
            conflicted: 1,
            historyOperation: historyPreview,
            entries: preview.status.entries.map((entry, index) => index === 0
              ? { ...entry, indexStatus: 'U', worktreeStatus: 'U', conflicted: true }
              : entry),
          };
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
    }
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
    await this.run('Opening repository…', async () => {
      const snapshot = await invoke<RepositorySnapshot>('open_repository', { path });
      openedRepositoryId = snapshot.id;
      this.storeSnapshot(snapshot, true);
      this.activeRepositoryId.set(snapshot.id);
      this.clearInspection();
      this.remember(snapshot.path);
      this.persistOpenTabs();
      this.forgetClosedRepository(snapshot.path);
      this.activity.set(`Opened ${snapshot.name}`);
    });
    if (openedRepositoryId) this.deferMetadataRefresh(openedRepositoryId);
  }

  async cloneRepository(
    remote: string,
    parentPath: string,
    folder: string,
    options: { branch?: string; depth?: number } = {},
  ): Promise<boolean> {
    await this.run('Cloning repository…', async () => {
      const snapshot = await invoke<RepositorySnapshot>('clone_repository', {
        remote: remote.trim(),
        parentPath,
        folder: folder.trim(),
        branch: options.branch?.trim() || null,
        depth: options.depth ?? null,
      });
      this.acceptOpenedRepository(snapshot, `Cloned ${snapshot.name}`);
    });
    return !this.error();
  }

  async initializeRepository(
    parentPath: string,
    folder: string,
    initialBranch: string,
    createReadme: boolean,
  ): Promise<boolean> {
    await this.run('Creating repository…', async () => {
      const snapshot = await invoke<RepositorySnapshot>('initialize_repository', {
        parentPath,
        folder: folder.trim(),
        initialBranch: initialBranch.trim(),
        createReadme,
      });
      this.acceptOpenedRepository(snapshot, `Created ${snapshot.name}`);
    });
    return !this.error();
  }

  async refresh(): Promise<void> {
    const repo = this.repository();
    if (!repo) return;
    await this.run('Refreshing…', async () => {
      this.storeSnapshot(await invoke<RepositorySnapshot>('refresh_repository', { repoId: repo.id }));
      this.deferredMetadataRefreshes.delete(repo.id);
      this.activity.set('Repository refreshed');
    }, repo.id);
  }

  async refreshRepositoryInBackground(repositoryId: string): Promise<boolean> {
    const repository = this.repositories().find((candidate) => candidate.id === repositoryId);
    if (!repository
      || this.browserPreview()
      || this.busy()
      || this.backgroundFetchRepositoryId() === repositoryId
      || this.liveRefreshes.has(repositoryId)) return false;
    this.liveRefreshes.add(repositoryId);
    try {
      const snapshot = await invoke<RepositorySnapshot>('refresh_repository', { repoId: repositoryId });
      if (this.repositories().some((candidate) => candidate.id === repositoryId)) {
        this.storeSnapshot(snapshot);
        this.deferredMetadataRefreshes.delete(repositoryId);
      }
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
      const status = await invoke<RepositoryStatus>('refresh_repository_status', { repoId: repository.id });
      const currentRepository = this.repositories().find((candidate) => candidate.id === repository.id);
      if (!currentRepository) return false;
      // A stage/unstage/discard started meanwhile; its own result is newer.
      if (generation !== this.statusGeneration(repository.id)) return true;
      if (status.branch !== currentRepository.status.branch) {
        this.storeSnapshot(await invoke<RepositorySnapshot>('refresh_repository', { repoId: repository.id }));
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
    if (!repository || this.browserPreview() || this.busy() || this.backgroundFetchBusy()) return false;
    this.backgroundFetchBusy.set(true);
    this.backgroundFetchRepositoryId.set(repository.id);
    this.backgroundFetchErrors.update((errors) => {
      const updated = { ...errors };
      delete updated[repository.id];
      return updated;
    });
    try {
      const snapshot = await invoke<RepositorySnapshot | null>('sync_repository', { repoId: repository.id });
      if (snapshot && this.repositories().some((candidate) => candidate.id === repository.id)) {
        this.storeSnapshot(snapshot);
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
    await this.run('Opening repository folder…', async () => {
      await invoke('open_repository_in_file_manager', { repoId: repository.id });
      this.activity.set('Repository folder opened');
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
    await this.run('Opening link…', async () => {
      await invoke('open_external_url', { url });
      this.activity.set(successMessage);
    }, this.activeRepositoryId());
  }

  async toggleFullscreen(): Promise<void> {
    this.error.set(null);
    try {
      await invoke<boolean>('toggle_fullscreen');
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
    }
  }

  async loadMoreHistory(): Promise<boolean> {
    const repository = this.repository();
    if (!repository?.historyTruncated || this.historyLoading()) return false;
    this.historyLoading.set(true);
    this.error.set(null);
    try {
      const page = await invoke<CommitHistoryPage>('load_more_commits', {
        repoId: repository.id,
      });
      if (this.repositories().some((candidate) => candidate.id === repository.id)) {
        this.repositories.update((repositories) => repositories.map((candidate) => {
          if (candidate.id !== repository.id) return candidate;
          const known = new Set(candidate.commits.map((commit) => commit.oid));
          return {
            ...candidate,
            commits: [...candidate.commits, ...page.commits.filter((commit) => !known.has(commit.oid))],
            historyTruncated: page.historyTruncated,
          };
        }));
      }
      return true;
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
      return false;
    } finally {
      this.historyLoading.set(false);
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
        : await invoke<TrackedFileSearch>('search_tracked_files', {
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
        : await invoke<ReflogPage>('load_reflog', { repoId: repository.id });
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
    this.changesLoading.set(true);
    this.error.set(null);
    try {
      if (this.browserPreview()) {
        const entries = repository.status.entries.flatMap((entry) =>
          entry.indexStatus === '?' && entry.path.endsWith('/')
            ? [{ ...entry, path: `${entry.path}example.txt` }]
            : [entry]);
        this.repositories.update((repositories) => repositories.map((candidate) =>
          candidate.id === repository.id
            ? { ...candidate, status: { ...candidate.status, entries, entriesTruncated: false } }
            : candidate));
        return;
      }
      const status = await invoke<RepositoryStatus>('load_more_changes', {
        repoId: repository.id,
      });
      this.repositories.update((repositories) => repositories.map((candidate) =>
        candidate.id === repository.id ? { ...candidate, status } : candidate
      ));
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
    await this.mutateWorkingTree('discard_path', `Discarding changes in ${path}…`, 'Changes discarded', {
      path,
      untracked,
    }, (status) => predictDiscardPath(status, path));
    if (repositoryId && !this.error()) {
      this.recordDiscard(repositoryId, untracked ? 'Discard Untracked File' : 'Discard Changes');
    }
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
  ): Promise<void> {
    const repositoryId = this.activeRepositoryId();
    const labels = {
      stage: ['Staging hunk…', 'Hunk staged'],
      unstage: ['Unstaging hunk…', 'Hunk unstaged'],
      discard: ['Discarding hunk…', 'Hunk discarded'],
    } as const;
    await this.mutateWorkingTree('apply_working_tree_hunk', labels[action][0], labels[action][1], {
      path,
      staged,
      hunkIndex,
      action,
    });
    if (this.error()) return;
    if (action === 'discard' && repositoryId) this.recordDiscard(repositoryId, 'Discard Hunk');
    const entry = this.repository()?.status.entries.find((candidate) => candidate.path === path);
    const stillVisible = staged
      ? entry && entry.indexStatus !== ' ' && entry.indexStatus !== '?'
      : entry && (entry.worktreeStatus !== ' ' || entry.indexStatus === '?');
    if (stillVisible) await this.inspectWorkingTreeFile(path, staged);
  }

  async applyWorkingTreeLines(
    path: string,
    staged: boolean,
    hunkIndex: number,
    lineIndices: number[],
    action: 'stage' | 'unstage' | 'discard',
  ): Promise<void> {
    const repositoryId = this.activeRepositoryId();
    const labels = {
      stage: ['Staging selected lines…', 'Selected lines staged'],
      unstage: ['Unstaging selected lines…', 'Selected lines unstaged'],
      discard: ['Discarding selected lines…', 'Selected lines discarded'],
    } as const;
    await this.mutateWorkingTree('apply_working_tree_lines', labels[action][0], labels[action][1], {
      path,
      staged,
      hunkIndex,
      lineIndices,
      action,
    });
    if (this.error()) return;
    if (action === 'discard' && repositoryId) this.recordDiscard(repositoryId, 'Discard Selected Lines');
    const entry = this.repository()?.status.entries.find((candidate) => candidate.path === path);
    const stillVisible = staged
      ? entry && entry.indexStatus !== ' ' && entry.indexStatus !== '?'
      : entry && (entry.worktreeStatus !== ' ' || entry.indexStatus === '?');
    if (stillVisible) await this.inspectWorkingTreeFile(path, staged);
  }

  async commit(
    message: string,
    options: { amend?: boolean; skipHooks?: boolean; pushAfter?: boolean; sign?: boolean } = {},
  ): Promise<boolean> {
    if (!message.trim()) return false;
    const repository = this.repository();
    const beforeOid = repository?.headOid;
    await this.mutate('commit_changes', options.amend ? 'Amending commit…' : 'Creating commit…', options.amend ? 'Commit amended' : 'Commit created', {
      message: message.trim(),
      amend: options.amend ?? false,
      skipHooks: options.skipHooks ?? false,
      sign: options.sign ?? false,
    });
    if (this.error()) return false;
    const afterOid = this.repository()?.headOid;
    this.recordHeadChange(repository?.id, beforeOid, afterOid, options.amend ? 'Amend Commit' : 'Commit');
    if (options.pushAfter) await this.remote('push_repository');
    return true;
  }

  async updateHeadMessage(expectedOid: string, message: string): Promise<boolean> {
    if (!message.trim()) return false;
    const repository = this.repository();
    if (!repository || repository.headOid !== expectedOid) return false;
    await this.mutate(
      'update_head_message',
      'Updating commit message…',
      'Commit message updated',
      { expectedOid, message: message.trim(), skipHooks: false },
    );
    if (this.error()) return false;
    const afterOid = this.repository()?.headOid;
    this.recordHeadChange(repository.id, expectedOid, afterOid, 'Edit Commit Message');
    return !!afterOid;
  }

  async undo(): Promise<void> {
    const repo = this.repository();
    const entry = repo ? this.operationHistory()[repo.id] : null;
    if (!repo || !entry || entry.undone) return;
    if (entry.kind === 'discard') {
      await this.mutate('undo_discard', `Undoing ${entry.label.toLocaleLowerCase()}…`, 'Discarded changes restored');
    } else if (entry.kind === 'checkout') {
      const branch = checkoutHistoryTarget(entry, 'undo')!;
      await this.mutate('checkout_branch', `Returning to ${branch}…`, `Checked out ${branch}`, {
        name: branch,
      });
    } else if (entry.kind === 'rename-branch') {
      const rename = renameBranchHistoryTarget(entry, 'undo')!;
      await this.mutate(
        'rename_branch',
        `Restoring branch name ${rename.newName}…`,
        `Renamed ${rename.oldName} to ${rename.newName}`,
        rename,
      );
    } else {
      const targetOid = headHistoryTarget(entry, 'undo')!;
      await this.mutate('move_head', `Undoing ${entry.label.toLocaleLowerCase()}…`, `${entry.label} undone`, {
        expectedOid: entry.afterOid,
        targetOid,
      });
    }
    if (!this.error()) this.setHistoryUndone(repo.id, true);
  }

  async redo(): Promise<void> {
    const repo = this.repository();
    const entry = repo ? this.operationHistory()[repo.id] : null;
    if (!repo || !entry || !entry.undone) return;
    if (entry.kind === 'discard') {
      await this.mutate('redo_discard', `Redoing ${entry.label.toLocaleLowerCase()}…`, 'Changes discarded again');
    } else if (entry.kind === 'checkout') {
      const branch = checkoutHistoryTarget(entry, 'redo')!;
      await this.mutate('checkout_branch', `Returning to ${branch}…`, `Checked out ${branch}`, {
        name: branch,
      });
    } else if (entry.kind === 'rename-branch') {
      const rename = renameBranchHistoryTarget(entry, 'redo')!;
      await this.mutate(
        'rename_branch',
        `Renaming branch to ${rename.newName} again…`,
        `Renamed ${rename.oldName} to ${rename.newName}`,
        rename,
      );
    } else {
      const targetOid = headHistoryTarget(entry, 'redo')!;
      await this.mutate('move_head', `Redoing ${entry.label.toLocaleLowerCase()}…`, `${entry.label} redone`, {
        expectedOid: entry.beforeOid,
        targetOid,
      });
    }
    if (!this.error()) this.setHistoryUndone(repo.id, false);
  }

  async checkout(name: string): Promise<void> {
    const repository = this.repository();
    const beforeBranch = repository?.status.branch;
    await this.mutate('checkout_branch', `Checking out ${name}…`, `Checked out ${name}`, { name });
    this.recordCheckout(repository?.id, beforeBranch, this.repository()?.status.branch);
  }

  async checkoutRemote(name: string): Promise<void> {
    const repository = this.repository();
    const beforeBranch = repository?.status.branch;
    await this.mutate(
      'checkout_remote_branch',
      `Creating a tracking branch for ${name}…`,
      `Checked out ${name} as a local tracking branch`,
      { name },
    );
    this.recordCheckout(repository?.id, beforeBranch, this.repository()?.status.branch);
  }

  async createBranch(name: string): Promise<void> {
    if (!name.trim()) return;
    await this.mutate('create_branch', `Creating ${name}…`, `Created ${name}`, { name: name.trim() });
  }

  async createBranchAt(name: string, oid: string): Promise<void> {
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

  async updateSubmodule(path: string): Promise<void> {
    await this.mutate(
      'update_submodule',
      `Updating ${path}…`,
      `Updated ${path}`,
      { path },
    );
  }

  async checkoutCommit(oid: string): Promise<void> {
    await this.mutate('checkout_commit', 'Checking out commit…', 'Checked out commit', { oid });
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    const normalized = newName.trim();
    if (!normalized) return;
    const repositoryId = this.activeRepositoryId();
    await this.mutate('rename_branch', `Renaming ${oldName}…`, `Renamed ${oldName} to ${normalized}`, {
      oldName,
      newName: normalized,
    });
    const entry = createRenameBranchHistoryEntry(oldName, normalized);
    if (repositoryId && !this.error() && entry) {
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

  async prepareInteractiveRebase(source: string, target: string): Promise<InteractiveRebasePlan | null> {
    const repo = this.repository();
    if (!repo) return null;
    let plan: InteractiveRebasePlan | null = null;
    await this.run('Preparing interactive rebase…', async () => {
      plan = await invoke<InteractiveRebasePlan>('prepare_interactive_rebase', {
        repoId: repo.id,
        source,
        target,
      });
      this.activity.set(`Interactive rebase ready: ${source} onto ${target}`);
    }, repo.id);
    return plan;
  }

  async executeInteractiveRebase(
    source: string,
    target: string,
    steps: InteractiveRebaseStep[],
  ): Promise<void> {
    await this.mutate(
      'execute_interactive_rebase',
      `Rebasing ${source} onto ${target}…`,
      `Interactive rebase of ${source} complete`,
      { source, target, steps },
    );
  }

  async continueRebase(): Promise<void> {
    await this.mutate('continue_rebase', 'Continuing interactive rebase…', 'Interactive rebase complete');
  }

  async skipRebase(): Promise<void> {
    await this.mutate('skip_rebase', 'Skipping conflicted commit…', 'Interactive rebase advanced');
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

  async controlHistoryOperation(action: 'continue' | 'skip' | 'abort'): Promise<void> {
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
              conflicted: 0,
              entries: candidate.status.entries.map((entry) => entry.conflicted
                ? { ...entry, indexStatus: ' ', worktreeStatus: 'M', conflicted: false }
                : entry),
            },
          }
        : candidate));
      this.activity.set(`${operation === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} ${action === 'abort' ? 'aborted' : action === 'skip' ? 'skipped' : 'complete'}`);
      return;
    }
    const label = operation === 'cherry-pick' ? 'cherry-pick' : 'revert';
    await this.mutate(
      'control_history_operation',
      `${action === 'continue' ? 'Continuing' : action === 'skip' ? 'Skipping' : 'Aborting'} ${label}…`,
      `${label === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} ${action === 'abort' ? 'aborted' : action === 'skip' ? 'skipped' : 'continued'}`,
      { operation, action },
    );
  }

  async inspectConflict(path: string): Promise<ConflictDetails | null> {
    const repo = this.repository();
    if (!repo) return null;
    let details: ConflictDetails | null = null;
    this.conflictDetails.set(null);
    await this.run(`Opening merge tool for ${path}…`, async () => {
      details = await invoke<ConflictDetails>('inspect_conflict', { repoId: repo.id, path });
      this.conflictDetails.set(details);
      this.activity.set(`Resolving conflict in ${path}`);
    }, repo.id);
    return details;
  }

  async resolveConflict(
    path: string,
    resolution: 'current' | 'incoming' | 'output',
    output?: string,
  ): Promise<void> {
    await this.mutate(
      'resolve_conflict',
      `Resolving ${path}…`,
      `Resolved ${path}`,
      { path, resolution, output: output ?? null },
    );
    if (!this.error()) this.conflictDetails.set(null);
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
    await this.mutate(operation, labels[operation][0], labels[operation][1], target);
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

  async performRepositoryMaintenance(): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    if (this.browserPreview()) {
      this.activity.set('Repository maintenance complete');
      return;
    }
    await this.run('Optimizing repository data…', async () => {
      await invoke('perform_repository_maintenance', { repoId: repository.id });
      this.activity.set('Repository maintenance complete');
    }, repository.id);
  }

  async diagnoseSigning(): Promise<void> {
    const repository = this.repository();
    if (!repository || this.signingDiagnosticBusy()) return;
    this.signingDiagnosticBusy.set(true);
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
        : await invoke<SigningDiagnostic>('diagnose_signing', { repoId: repository.id });
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

  async popStash(): Promise<void> {
    await this.mutate('pop_stash', 'Popping latest stash…', 'Stash popped');
  }

  async applyStash(reference: string): Promise<void> {
    await this.mutate('apply_stash', `Applying ${reference}…`, `${reference} applied`, { reference });
  }

  async popStashEntry(reference: string): Promise<void> {
    await this.mutate('pop_stash_entry', `Popping ${reference}…`, `${reference} popped`, { reference });
  }

  async dropStash(reference: string): Promise<void> {
    await this.mutate('drop_stash', `Deleting ${reference}…`, `${reference} deleted`, { reference });
  }

  async renameStash(reference: string, expectedOid: string, message: string): Promise<void> {
    await this.mutate(
      'rename_stash',
      `Renaming ${reference}…`,
      'Stash message updated',
      { reference, expectedOid, message },
    );
  }

  async createTag(name: string, oid: string, message: string | null = null): Promise<void> {
    if (!name.trim()) return;
    await this.mutate('create_tag', `Creating tag ${name}…`, `Created tag ${name}`, {
      name: name.trim(),
      oid,
      message: message?.trim() || null,
    });
  }

  async cherryPick(oids: string[]): Promise<void> {
    const count = oids.length;
    if (!count) return;
    const repository = this.repository();
    const beforeOid = repository?.headOid;
    await this.mutate(
      'cherry_pick_commits',
      count === 1 ? 'Cherry-picking commit…' : `Cherry-picking ${count} commits…`,
      count === 1 ? 'Commit cherry-picked' : `${count} commits cherry-picked`,
      { oids },
    );
    this.recordHeadChange(
      repository?.id,
      beforeOid,
      this.repository()?.headOid,
      count === 1 ? 'Cherry-pick Commit' : `Cherry-pick ${count} Commits`,
    );
  }

  async revertCommit(oid: string): Promise<void> {
    const repository = this.repository();
    const beforeOid = repository?.headOid;
    await this.mutate('revert_commit', 'Reverting commit…', 'Revert commit created', { oid });
    this.recordHeadChange(repository?.id, beforeOid, this.repository()?.headOid, 'Revert Commit');
  }

  async resetToCommit(oid: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    await this.mutate('reset_to_commit', `Resetting ${mode}…`, `Reset ${mode} complete`, { oid, mode });
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

  async restoreFilesFromCommit(oid: string, paths: string[]): Promise<void> {
    await this.mutate(
      'restore_files_from_commit',
      paths.length === 1 ? 'Restoring file…' : `Restoring ${paths.length} files…`,
      paths.length === 1 ? 'File restored and staged' : `${paths.length} files restored and staged`,
      { oid, paths },
    );
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
        : await invoke<CommitDetails>('inspect_commit', { repoId: repository.id, oid });
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
          message: name === 'v0.1.0' ? 'First Git Chronos preview release' : null,
          taggerName: name === 'v0.1.0' ? 'Maya Chen' : null,
          taggerEmail: name === 'v0.1.0' ? 'maya@example.test' : null,
          taggedAt: name === 'v0.1.0' ? '2026-10-03T11:42:00+00:00' : null,
        } satisfies TagDetails
        : await invoke<TagDetails>('inspect_tag', { repoId: repository.id, name });
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

  async inspectStash(reference: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const request = ++this.detailsRequest;
    this.fileRequest += 1;
    this.commitDetails.set(null);
    this.inspectedStashReference.set(reference);
    this.commitFileDiff.set(null);
    this.selectedCommitFile.set(null);
    this.commitComparison.set(null);
    this.comparisonFileDiff.set(null);
    this.selectedComparisonFile.set(null);
    this.clearWorkingTreeInspection();
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const stash = repository.stashes.find((candidate) => candidate.reference === reference);
      const details = this.browserPreview()
        ? createPreviewCommitDetails(repository, stash?.oid ?? repository.headOid)
        : await invoke<CommitDetails>('inspect_stash', { repoId: repository.id, reference });
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
          ? await invoke<CommitFileDiff>('inspect_stash_file', {
          repoId: repository.id,
          reference: stashReference,
          path: file.path,
          previousPath: file.previousPath,
        })
          : await invoke<CommitFileDiff>('inspect_commit_file', {
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

  async compareCommits(baseOid: string, targetOid: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const request = ++this.detailsRequest;
    this.fileRequest += 1;
    this.commitDetails.set(null);
    this.commitFileDiff.set(null);
    this.selectedCommitFile.set(null);
    this.commitComparison.set(null);
    this.comparisonFileDiff.set(null);
    this.selectedComparisonFile.set(null);
    this.clearWorkingTreeInspection();
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const comparison = this.browserPreview()
        ? createPreviewCommitComparison(baseOid, targetOid)
        : await invoke<CommitComparison>('compare_commits', {
          repoId: repository.id,
          baseOid,
          targetOid,
        });
      if (request !== this.detailsRequest || repository.id !== this.activeRepositoryId()) return;
      this.commitComparison.set(comparison);
      const firstFile = comparison.files[0];
      if (firstFile) await this.inspectComparisonFile(firstFile);
    } catch (error: unknown) {
      if (request === this.detailsRequest) this.error.set(this.formatError(error));
    } finally {
      if (request === this.detailsRequest) this.detailsBusy.set(false);
    }
  }

  async compareCommitWithWorkingTree(baseOid: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const request = ++this.detailsRequest;
    this.fileRequest += 1;
    this.commitDetails.set(null);
    this.commitFileDiff.set(null);
    this.selectedCommitFile.set(null);
    this.commitComparison.set(null);
    this.comparisonFileDiff.set(null);
    this.selectedComparisonFile.set(null);
    this.clearWorkingTreeInspection();
    this.detailsBusy.set(true);
    this.error.set(null);
    try {
      const comparison = this.browserPreview()
        ? createPreviewWorkingTreeComparison(baseOid)
        : await invoke<CommitComparison>('compare_commit_with_working_tree', {
          repoId: repository.id,
          baseOid,
        });
      if (request !== this.detailsRequest || repository.id !== this.activeRepositoryId()) return;
      this.commitComparison.set(comparison);
      const firstFile = comparison.files[0];
      if (firstFile) await this.inspectComparisonFile(firstFile);
    } catch (error: unknown) {
      if (request === this.detailsRequest) this.error.set(this.formatError(error));
    } finally {
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
          ? await invoke<CommitFileDiff>('compare_commit_file_with_working_tree', {
            repoId: repository.id,
            baseOid: comparison.baseOid,
            path: file.path,
            previousPath: file.previousPath,
          })
          : await invoke<CommitFileDiff>('compare_commit_file', {
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
        : await invoke<WorkingTreeFileDiff>('inspect_working_tree_file', {
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
        : await invoke<FileHistoryEntry[]>('inspect_file_history', {
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
    const request = ++this.fileInsightRequest;
    this.fileHistory.set(null);
    this.fileBlame.set(null);
    this.fileInsightBusy.set(true);
    this.error.set(null);
    try {
      const blame = this.browserPreview()
        ? repository.commits.slice(0, 3).map((commit, index) => ({
          lineNumber: index + 1,
          oid: commit.oid,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          authoredAt: Math.floor(Date.parse(commit.authoredAt) / 1_000),
          summary: commit.subject,
          text: index === 0 ? `// ${path}` : `preview line ${index + 1}`,
        }))
        : await invoke<FileBlameLine[]>('inspect_file_blame', {
          repoId: repository.id,
          revision,
          path,
        });
      if (request === this.fileInsightRequest && repository.id === this.activeRepositoryId()) {
        this.fileBlame.set(blame);
      }
    } catch (error: unknown) {
      if (request === this.fileInsightRequest) this.error.set(this.formatError(error));
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
      const accepted = await invoke<boolean>('cancel_git_operation', { operationId });
      if (!accepted) this.finishCancellationRequest(operationId);
    } catch (error: unknown) {
      this.error.set(this.formatError(error));
      this.finishCancellationRequest(operationId);
    }
  }

  private async mutate(
    command: string,
    pending: string,
    done: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const repo = this.repository();
    if (!repo) return;
    const operationId = this.isCancelableCommand(command) ? crypto.randomUUID() : null;
    const result = await this.run(pending, async () => {
      this.storeMutationSnapshot(await invoke<RepositorySnapshot>(command, {
        repoId: repo.id,
        ...extra,
        ...(operationId ? { operationId } : {}),
      }));
      this.clearWorkingTreeInspection();
      this.activity.set(done);
    }, repo.id, operationId);
    if (result === 'error' && this.error() && this.repositories().some((repository) => repository.id === repo.id)) {
      try {
        this.storeMutationSnapshot(await invoke<RepositorySnapshot>('refresh_repository', { repoId: repo.id }));
        this.clearWorkingTreeInspection();
      } catch {
        // Keep the original mutation error; a manual refresh can retry the snapshot.
      }
    }
    // Fast snapshots skip untracked discovery; complete the status right away.
    if (this.repositories().some((repository) => repository.id === repo.id)) {
      void this.refreshStatusInBackground(repo.id, true);
    }
  }

  /**
   * Runs an index or working-tree change that cannot move references or
   * history. The predicted status is shown immediately, and the backend
   * returns only the refreshed status instead of a full snapshot.
   */
  private async mutateWorkingTree(
    command: string,
    pending: string,
    done: string,
    extra: Record<string, unknown>,
    predict: (status: RepositoryStatus) => RepositoryStatus = (status) => status,
  ): Promise<void> {
    const repo = this.repository();
    if (!repo) return;
    const repoId = repo.id;
    this.bumpStatusGeneration(repoId);
    this.storeStatus(repoId, predict(repo.status));
    this.pendingWorkingTreeMutations.set(repoId, (this.pendingWorkingTreeMutations.get(repoId) ?? 0) + 1);
    let status: RepositoryStatus | null = null;
    await this.run(pending, async () => {
      status = await invoke<RepositoryStatus>(command, { repoId, ...extra });
      this.clearWorkingTreeInspection();
      this.activity.set(done);
    }, repoId);
    const remaining = (this.pendingWorkingTreeMutations.get(repoId) ?? 1) - 1;
    if (remaining > 0) {
      // A later change is still running; its status will include this one.
      this.pendingWorkingTreeMutations.set(repoId, remaining);
      return;
    }
    this.pendingWorkingTreeMutations.delete(repoId);
    this.bumpStatusGeneration(repoId);
    if (status) {
      this.storeStatus(repoId, status);
    } else if (this.repositories().some((repository) => repository.id === repoId)) {
      // Replace the prediction with Git's actual state after a failure.
      try {
        this.storeStatus(repoId, await invoke<RepositoryStatus>('refresh_repository_status', { repoId }));
      } catch {
        // Keep the original mutation error; the live refresh retries later.
      }
    }
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

  private acceptOpenedRepository(snapshot: RepositorySnapshot, activity: string): void {
    this.storeSnapshot(snapshot, true);
    this.activeRepositoryId.set(snapshot.id);
    this.clearInspection();
    this.remember(snapshot.path);
    this.persistOpenTabs();
    this.activity.set(activity);
    this.deferMetadataRefresh(snapshot.id);
  }

  private async run(
    label: string,
    action: () => Promise<void>,
    repositoryId: string | null = null,
    operationId: string | null = null,
  ): Promise<'success' | 'error' | 'cancelled'> {
    const id = this.nextActivityId++;
    const startedAt = Date.now();
    const entry: ActivityLogEntry = {
      id,
      timestamp: new Date(startedAt).toISOString(),
      description: label.replace(/…$/, ''),
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
    this.busy.set(true);
    this.error.set(null);
    this.lastFailureKind = null;
    this.activity.set(label);
    try {
      await action();
      this.finishActivity(id, 'success', this.activity(), startedAt, null);
      return 'success';
    } catch (error: unknown) {
      this.lastFailureKind = this.errorKind(error);
      const cancelled = this.isOperationCancelled(error);
      let detail = this.formatError(error);
      if (cancelled && repositoryId) {
        try {
          this.storeSnapshot(await invoke<RepositorySnapshot>('refresh_repository', { repoId: repositoryId }));
          this.clearWorkingTreeInspection();
          this.activity.set('Operation canceled; repository state refreshed');
        } catch (refreshError: unknown) {
          detail += ` Repository refresh also failed: ${this.formatError(refreshError)}`;
          this.error.set(detail);
          this.activity.set('Operation canceled; repository refresh failed');
        }
      } else {
        this.error.set(detail);
        this.activity.set('Operation failed');
      }
      const status = cancelled ? 'cancelled' : 'error';
      this.finishActivity(id, status, label.replace(/…$/, ''), startedAt, detail);
      return status;
    } finally {
      if (operationId) this.finishCancellationRequest(operationId);
      this.busy.set(false);
    }
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

  private setHistoryUndone(repoId: string, undone: boolean): void {
    this.operationHistory.update((history) => {
      const entry = history[repoId];
      return entry ? { ...history, [repoId]: { ...entry, undone } } : history;
    });
  }

  private recordDiscard(repoId: string, label: string): void {
    this.operationHistory.update((history) => ({
      ...history,
      [repoId]: { kind: 'discard', label, undone: false },
    }));
  }

  private recordCheckout(
    repoId: string | undefined,
    beforeBranch: string | null | undefined,
    afterBranch: string | null | undefined,
  ): void {
    const entry = createCheckoutHistoryEntry(beforeBranch, afterBranch);
    if (!repoId || this.error() || !entry) return;
    this.operationHistory.update((history) => ({
      ...history,
      [repoId]: entry,
    }));
  }

  private recordHeadChange(
    repoId: string | undefined,
    beforeOid: string | null | undefined,
    afterOid: string | null | undefined,
    label: string,
  ): void {
    const entry = createHeadHistoryEntry(beforeOid, afterOid, label);
    if (!repoId || this.error() || !entry) return;
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

  private clearWorkingTreeInspection(): void {
    this.workingTreeRequest += 1;
    this.workingTreeFileDiff.set(null);
    this.selectedWorkingTreeFile.set(null);
    this.conflictDetails.set(null);
    this.detailsBusy.set(false);
  }

  private clearFileInsights(): void {
    this.fileInsightRequest += 1;
    this.fileHistory.set(null);
    this.fileBlame.set(null);
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
      'pull_repository',
      'push_repository',
      'force_push_repository',
      'publish_branch',
      'lfs_pull',
      'lfs_prune',
      'update_submodule',
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
    this.busy.set(true);
    this.activity.set('Restoring active repository…');
    let restoredPath: string | null = null;
    try {
      for (const path of ordered) {
        try {
          const snapshot = await invoke<RepositorySnapshot>('open_repository', { path });
          if (this.activeWorkspaceId() !== workspaceId) return;
          this.storeSnapshot(snapshot, true);
          this.activeRepositoryId.set(snapshot.id);
          this.deferredMetadataRefreshes.add(snapshot.id);
          restoredPath = path;
          break;
        } catch {
          // Try the next saved tab if the preferred repository is unavailable.
        }
      }
      this.activity.set('Ready');
    } finally {
      this.busy.set(false);
    }
    if (!restoredPath) {
      this.persistOpenTabs();
      return;
    }
    const activeRepositoryId = this.activeRepositoryId();
    if (activeRepositoryId) this.deferMetadataRefresh(activeRepositoryId);
    const remaining = paths.filter((path) => path !== restoredPath);
    this.restoreRepositoryTabsWhenIdle(remaining, paths, workspaceId);
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
    for (const path of paths) {
      if (this.activeWorkspaceId() !== workspaceId) return;
      try {
        const snapshot = await invoke<RepositorySnapshot>('open_repository', { path });
        if (this.activeWorkspaceId() !== workspaceId) return;
        this.deferredMetadataRefreshes.add(snapshot.id);
        this.storeSnapshot(snapshot, true);
        this.repositories.update((repositories) => [...repositories].sort(
          (left, right) => originalOrder.indexOf(left.path) - originalOrder.indexOf(right.path),
        ));
      } catch {
        // Missing, inaccessible, or unhealthy tabs do not block the active repository.
      }
    }
    this.persistOpenTabs();
  }

  private persistOpenTabs(): void {
    const repositoryPaths = this.repositories().map((repository) => repository.path);
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

  private storeSnapshot(snapshot: RepositorySnapshot, addIfMissing = false): void {
    this.repositories.update((repositories) => {
      const index = repositories.findIndex((repository) => repository.id === snapshot.id);
      if (index < 0) return addIfMissing ? [...repositories, snapshot] : repositories;
      const previous = repositories[index];
      // Preserve collection identities when a refresh reports the same graph.
      // Angular can then skip history layout work for status-only updates.
      snapshot = {
        ...snapshot,
        commits: sameItems(previous.commits, snapshot.commits, (commit) => commit.oid)
          ? previous.commits
          : snapshot.commits,
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
          { status: 'M', path: 'apps/desktop/src/app/git-chronos.service.ts', previousPath: null, additions: 22, deletions: 7 },
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
    { oid: '14adfbb0c1685f62cba66f031306a510e3f501a2', parents: [], authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-09-29T08:17:00Z', subject: 'Initialize Git Chronos desktop', description: 'Create the Angular, Nx, Rust, and Tauri workspace.', decorations: [] },
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
    name: 'git-chronos',
    path: '/home/maya/projects/git-chronos',
    identity: { name: 'Maya Chen', email: 'maya@example.test' },
    headOid,
    status: {
      branch: 'main', ahead: 1, behind: 0, staged: 1, unstaged: 2, untracked: 1, conflicted: 0, mergeInProgress: false, historyOperation: null, rebaseInProgress: false, bisectInProgress: false, entryCount: 4, entriesTruncated: false,
      entries: [
        { path: 'apps/desktop/src/app/app.component.ts', indexStatus: 'M', worktreeStatus: ' ', conflicted: false },
        { path: 'apps/desktop/src/app/app.component.html', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
        { path: 'apps/desktop/src/app/app.component.scss', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
        { path: 'docs/interface-notes.md', indexStatus: '?', worktreeStatus: '?', conflicted: false },
      ],
    },
    signing: { enabled: false, format: 'openpgp', key: null },
    remotes: [
      { name: 'origin', fetchUrl: 'git@github.com:example/git-chronos.git', pushUrl: 'git@github.com:example/git-chronos.git' },
      { name: 'upstream', fetchUrl: 'https://github.com/example/git-chronos.git', pushUrl: 'https://github.com/example/git-chronos.git' },
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
      { path: '/home/maya/projects/git-chronos', oid: headOid, branch: 'main', current: true, locked: false, prunable: false, statusLoaded: true, changes: 4, ahead: 1, behind: 0 },
      { path: '/home/maya/projects/git-chronos-partial-staging', oid: featureOid, branch: 'feature/partial-staging', current: false, locked: false, prunable: false, statusLoaded: true, changes: 2, ahead: 0, behind: 0 },
    ],
    submodules: [
      { name: 'vendor/lane-engine', path: 'vendor/lane-engine', absolutePath: '/home/maya/projects/git-chronos/vendor/lane-engine', url: 'https://github.com/example/lane-engine.git', oid: commits[4].oid, headOid: commits[4].oid, initialized: true, outOfSync: false },
      { name: 'plugins/diff-driver', path: 'plugins/diff-driver', absolutePath: '/home/maya/projects/git-chronos/plugins/diff-driver', url: 'git@github.com:example/diff-driver.git', oid: commits[5].oid, headOid: null, initialized: false, outOfSync: false },
    ],
    lfs: { enabled: false, available: false, version: null, trackedFiles: null },
    sparseCheckout: { enabled: false, coneMode: true, sparseIndex: false, paths: [] },
    commitTemplate: null,
    commits,
    historyTruncated: false,
  };
}
