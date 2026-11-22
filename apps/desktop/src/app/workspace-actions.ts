import type { RepositorySnapshot } from '@git-khronos/contracts';
import type { GitKhronosService } from './git-khronos.service';
import type { PullStrategy } from './pull-strategy';
import { PREPARED_MERGE_LABEL } from './repository-operation';

export type WorkspaceRemoteOperation = { kind: 'fetch' } | { kind: 'pull'; strategy: PullStrategy };

export async function runWorkspaceRemote(
  git: GitKhronosService,
  repository: RepositorySnapshot,
  operation: WorkspaceRemoteOperation,
): Promise<{ status: 'success' | 'review needed' | 'error' | 'cancelled'; detail: string | null }> {
  if (!git.repositories().some(item => item.id === repository.id && item.path === repository.path)) {
    return { status: 'error', detail: 'Repository is no longer open in this workspace.' };
  }
  if (git.busy() || git.browserPreview()) {
    return { status: 'error', detail: git.browserPreview() ? 'Network operations are unavailable in browser preview.' : 'Another Git operation is already running.' };
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
  if (result.preparedMerge) {
    const detail = result.refreshError
      ? `${PREPARED_MERGE_LABEL}. Refresh this repository before reviewing: ${result.refreshError}`
      : `${PREPARED_MERGE_LABEL}. Review the staged changes in this repository, then continue or abort the merge.`;
    return { status: 'review needed', detail };
  }
  const detail = result.refreshError
    ? [result.error, `${result.status === 'success' ? 'Operation completed, but repository reconciliation failed' : 'Repository reconciliation also failed'}: ${result.refreshError}`].filter(Boolean).join(' ')
    : result.error;
  return { status: result.status, detail };
}
