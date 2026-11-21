import type { RepositorySnapshot } from '@git-khronos/contracts';
import type { GitKhronosService } from './git-khronos.service';
import type { PullStrategy } from './pull-strategy';

export type WorkspaceRemoteOperation = { kind: 'fetch' } | { kind: 'pull'; strategy: PullStrategy };

export async function runWorkspaceRemote(
  git: GitKhronosService,
  repository: RepositorySnapshot,
  operation: WorkspaceRemoteOperation,
): Promise<{ status: 'success' | 'error' | 'cancelled'; error: string | null }> {
  if (!git.repositories().some(item => item.id === repository.id && item.path === repository.path)) {
    return { status: 'error', error: 'Repository is no longer open in this workspace.' };
  }
  if (git.busy() || git.browserPreview()) {
    return { status: 'error', error: git.browserPreview() ? 'Network operations are unavailable in browser preview.' : 'Another Git operation is already running.' };
  }

  const label = operation.kind === 'fetch' ? 'Fetching' : 'Pulling';
  const pending = `${label} ${git.pathLabel(repository.path)}…`;
  const done = `${label} complete · ${git.pathLabel(repository.path)}`;
  const result = operation.kind === 'fetch'
    ? await git.mutateRepositoryWithResult(repository, 'fetch_repository', pending, done, {})
    : await git.mutateRepositoryWithResult(repository, 'pull_repository', pending, done, {
      strategy: operation.strategy,
      checkout: { headOid: repository.headOid, branch: repository.status.branch },
    });
  if (result.status === 'success' && operation.kind === 'fetch') {
    git.backgroundFetchErrors.update(errors => {
      const updated = { ...errors };
      delete updated[repository.id];
      return updated;
    });
  }
  const error = result.refreshError
    ? [result.error, `${result.status === 'success' ? 'Operation completed, but repository reconciliation failed' : 'Repository reconciliation also failed'}: ${result.refreshError}`].filter(Boolean).join(' ')
    : result.error;
  return { status: result.status, error };
}
