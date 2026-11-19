import type { RepositorySnapshot, Worktree } from '@git-khronos/contracts';

/** Advisory only: native Git remains authoritative if occupancy changes. */
export function branchCheckoutOwner(
  repository: Pick<RepositorySnapshot, 'path' | 'worktrees'>,
  branch: string,
): Worktree | null {
  return repository.worktrees.find(worktree => worktree.branch === branch
    && !worktree.current && worktree.path !== repository.path) ?? null;
}

/** Use the shortest distinguishing path suffix when visible repository names collide. */
export function repositoryLocationLabel(
  repository: { path: string; label: string },
  repositories: readonly { path: string; label: string }[],
): string {
  const others = repositories.filter(other => other.path !== repository.path && other.label === repository.label);
  if (!others.length) return repository.label;
  const parts = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean);
  const ownParts = parts(repository.path);
  for (let length = 1; length <= ownParts.length; length++) {
    const suffix = ownParts.slice(-length).join('/');
    if (others.every(other => parts(other.path).slice(-length).join('/') !== suffix)) {
      return `${repository.label} · ${suffix}`;
    }
  }
  return `${repository.label} · ${repository.path}`;
}
