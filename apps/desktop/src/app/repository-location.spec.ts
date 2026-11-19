import { describe, expect, it } from 'vitest';
import type { Worktree } from '@git-khronos/contracts';
import { branchCheckoutOwner, repositoryLocationLabel } from './repository-location';

const worktree = (path: string, branch: string | null, current = false, prunable = false): Worktree => ({
  path, branch, current, prunable, oid: 'a'.repeat(40), locked: false,
  statusLoaded: false, changes: 0, ahead: 0, behind: 0,
});

describe('branch checkout occupancy', () => {
  const repository = { path: '/main', worktrees: [
    worktree('/main', 'main', true), worktree('/topic', 'topic'),
    worktree('/missing', 'old', false, true), worktree('/detached', null),
  ] };
  it('identifies only another checkout of the exact local branch', () => {
    expect(branchCheckoutOwner(repository, 'topic')?.path).toBe('/topic');
    for (const branch of ['main', 'new', 'origin/topic', 'Topic']) {
      expect(branchCheckoutOwner(repository, branch)).toBeNull();
    }
  });
  it('retains missing registrations for explanation, not automatic checkout or pruning', () => {
    expect(branchCheckoutOwner(repository, 'old')?.prunable).toBe(true);
  });
  it('never treats the source path as another checkout even with stale current flags', () => {
    expect(branchCheckoutOwner({ path: '/main', worktrees: [worktree('/main', 'main')] }, 'main')).toBeNull();
  });
});

describe('repository location labels', () => {
  it('preserves unique names and distinguishes duplicate names by their shortest unique suffix', () => {
    const repositories = [
      { path: '/work/team/app', label: 'app' }, { path: '/home/other/app', label: 'app' },
      { path: '/work/unique', label: 'unique' },
    ];
    expect(repositoryLocationLabel(repositories[0], repositories)).toBe('app · team/app');
    expect(repositoryLocationLabel(repositories[1], repositories)).toBe('app · other/app');
    expect(repositoryLocationLabel(repositories[2], repositories)).toBe('unique');
  });
  it('handles Windows paths and colliding user aliases without changing the actual path', () => {
    const repositories = [
      { path: 'C:\\work\\one', label: 'Project' }, { path: 'D:\\work\\two', label: 'Project' },
    ];
    expect(repositoryLocationLabel(repositories[0], repositories)).toBe('Project · one');
    expect(repositories[0].path).toBe('C:\\work\\one');
  });
});
