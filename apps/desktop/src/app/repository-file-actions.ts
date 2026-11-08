import { ipc, type RepositorySnapshot } from '@git-khronos/contracts';
import type { GitKhronosService } from './git-khronos.service';

export interface RepositoryFileActionResult {
  status: 'success' | 'error' | 'cancelled';
  error: string | null;
  refreshError: string | null;
  mayHaveChanged: boolean;
}

export interface RepositoryFileActionLifecycle {
  begin(): () => void;
  bump(): void;
  generation(): number;
  store(snapshot: RepositorySnapshot): void;
  refresh(): Promise<void>;
  clearInspection(): void;
  recordDiscard(): void;
  recordDiscardFailure(error: unknown): boolean;
  recordTrackedDeleteFailure(error: unknown): boolean;
}

export async function runRepositoryFileAction(
  git: GitKhronosService,
  lifecycle: RepositoryFileActionLifecycle,
  action: 'create' | 'delete-tracked' | 'delete-untracked',
  repositoryId: string,
  repositoryPath: string,
  path: string,
): Promise<RepositoryFileActionResult> {
  const repository = git.repositories().find(item => item.id === repositoryId && item.path === repositoryPath);
  if (!repository || git.activeRepositoryId() !== repositoryId || git.busy()) {
    return { status: 'error', error: 'The selected repository is no longer available for this action.', refreshError: null, mayHaveChanged: false };
  }
  const description = action === 'create' ? 'Creating file' : 'Deleting file';
  const finishHistoryBarrier = lifecycle.begin();
  lifecycle.bump();
  const generation = lifecycle.generation();
  let failure: string | null = null;
  let refreshError: string | null = null;
  let mayHaveChanged = false;
  const workspaceId = git.activeWorkspaceId();
  const ownsRepository = () => git.activeWorkspaceId() === workspaceId
    && git.repositories().some(item => item.id === repositoryId && item.path === repositoryPath);
  try {
    const status = await git.run(`${description}…`, async report => {
      let result;
      try {
        result = action === 'create'
          ? await ipc.create_repository_file({ repoId: repositoryId, path })
          : action === 'delete-tracked'
            ? await ipc.delete_repository_file({ repoId: repositoryId, path })
            : await ipc.delete_untracked_repository_file({ repoId: repositoryId, path });
      } catch (error: unknown) {
        failure = git.formatError(error);
        if (action === 'delete-untracked') {
          mayHaveChanged = lifecycle.recordDiscardFailure(error);
          const reportedByBackend = typeof error === 'object' && error !== null && 'kind' in error
            && (error.kind === 'discardFailedWithRecovery' || error.kind === 'discardRefreshFailed');
          if (mayHaveChanged && !reportedByBackend) {
            failure += ' The file may have changed. Refresh the repository and review discarded-change recovery before retrying.';
          }
        }
        if (action === 'delete-tracked') {
          mayHaveChanged = lifecycle.recordTrackedDeleteFailure(error);
          const reportedByBackend = typeof error === 'object' && error !== null
            && 'kind' in error && error.kind === 'repositoryFileDeletionUncertain';
          if (mayHaveChanged && !reportedByBackend) {
            failure += ' The file or index may have changed. Refresh the repository and inspect both before retrying.';
          }
        }
        if (mayHaveChanged && ownsRepository()) {
          lifecycle.bump();
          lifecycle.clearInspection();
        }
        throw error;
      }
      if (result.refreshError) refreshError = git.formatError(result.refreshError);
      if (!result.snapshot && !result.refreshError) refreshError = 'The repository returned no refreshed snapshot.';
      if (result.snapshot && (result.snapshot.id !== repositoryId || result.snapshot.path !== repositoryPath)) {
        refreshError = 'The returned snapshot belongs to a different repository.';
      } else if (result.snapshot && ownsRepository()) {
        if (generation === lifecycle.generation()) {
          lifecycle.store(result.snapshot);
        } else {
          try { await lifecycle.refresh(); }
          catch (error: unknown) { refreshError = git.formatError(error); }
        }
      }
      if (refreshError) lifecycle.bump();
      if (ownsRepository()) lifecycle.clearInspection();
      if (action === 'delete-untracked') lifecycle.recordDiscard();
      report(refreshError ? `${description} completed; refresh needs attention` : `${description} complete`);
    }, repositoryId, null, false);
    if (status !== 'success' && ownsRepository()) {
      try { await lifecycle.refresh(); }
      catch (error: unknown) { refreshError = git.formatError(error); }
    }
    if (ownsRepository()) void git.refreshStatusInBackground(repositoryId, true);
    return { status, error: status === 'success' ? null : failure ?? git.error(), refreshError, mayHaveChanged };
  } finally {
    finishHistoryBarrier();
  }
}
