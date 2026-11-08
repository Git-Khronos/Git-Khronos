import type { GitKhronosService } from './git-khronos.service';

export async function runWorkspaceRemote(
  git: GitKhronosService,
  repositoryId: string,
  operation: 'fetch' | 'pull',
): Promise<{ status: 'success' | 'error' | 'cancelled'; error: string | null }> {
  const repository = git.repositories().find(item => item.id === repositoryId);
  if (!repository) return { status: 'error', error: 'Repository is no longer open in this workspace.' };
  if (git.busy() || git.browserPreview()) {
    return { status: 'error', error: git.browserPreview() ? 'Network operations are unavailable in browser preview.' : 'Another Git operation is already running.' };
  }

  const label = operation === 'fetch' ? 'Fetching' : 'Pulling';
  const pending = `${label} ${git.pathLabel(repository.path)}…`;
  const done = `${label} complete · ${git.pathLabel(repository.path)}`;
  const result = operation === 'fetch'
    ? await git.mutateRepositoryWithResult(repository, 'fetch_repository', pending, done, {})
    : await git.mutateRepositoryWithResult(repository, 'pull_repository', pending, done, {});
  if (result.status === 'success' && operation === 'fetch') {
    git.backgroundFetchErrors.update(errors => {
      const updated = { ...errors };
      delete updated[repositoryId];
      return updated;
    });
  }
  const error = result.refreshError
    ? [result.error, `${result.status === 'success' ? 'Operation completed, but repository reconciliation failed' : 'Repository reconciliation also failed'}: ${result.refreshError}`].filter(Boolean).join(' ')
    : result.error;
  return { status: result.status, error };
}
