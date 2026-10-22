import type { CommitSummary } from '@git-khronos/contracts';
import { describe, expect, it } from 'vitest';
import { reconcileCommitHistory } from './commit-history';

const commit = (oid: string, decorations: string[] = []): CommitSummary => ({
  oid, decorations, parents: [], authorName: 'Author', authorEmail: 'author@example.test',
  authoredAt: '2026-10-07T12:00:00Z', subject: 'Commit', description: '',
});

describe('commit history reconciliation', () => {
  it('moves a remote decoration without changing commit identities elsewhere', () => {
    const previous = [commit('new', ['HEAD -> dev']), commit('old', ['origin/dev']), commit('older')];
    const incoming = [commit('new', ['HEAD -> dev', 'origin/dev']), commit('old'), commit('older')];
    const result = reconcileCommitHistory(previous, incoming);
    expect(result).toEqual(incoming);
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(incoming[0]);
    expect(result[1]).toBe(incoming[1]);
    expect(result[2]).toBe(previous[2]);
  });

  it('preserves the history array and row identities on an unchanged status refresh', () => {
    const previous = [commit('a', ['dev']), commit('b')];
    expect(reconcileCommitHistory(previous, [commit('a', ['dev']), commit('b')])).toBe(previous);
  });

  it('accepts corrected metadata and reordered or appended history', () => {
    const previous = [commit('a'), commit('b')];
    const corrected = { ...commit('a'), description: 'Updated metadata' };
    expect(reconcileCommitHistory(previous, [corrected, commit('b')])[0]).toBe(corrected);
    expect(reconcileCommitHistory(previous, [commit('b'), commit('a')]).map(item => item.oid)).toEqual(['b', 'a']);
    expect(reconcileCommitHistory(previous, [commit('a'), commit('b'), commit('c')])[1]).toBe(previous[1]);
  });
});
