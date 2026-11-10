import { describe, expect, it } from 'vitest';
import type { RepositoryOperation, RepositoryStatus } from '@git-khronos/contracts';
import { repositoryOperationState } from './repository-operation';

function status(operations: RepositoryOperation[] | null): RepositoryStatus {
  return {
    branch: 'main', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0,
    conflicted: 0, entryCount: 0, entriesTruncated: false, entries: [],
    operations, mergeInProgress: false, historyOperation: null, historyNoCommit: false,
    rebaseInProgress: false, rebaseEditStopped: false, rebaseSplit: null,
    mailPatchInProgress: false, bisectInProgress: false,
  };
}

describe('repository operation observations', () => {
  it('projects every variant without hiding concurrent observations or bisect', () => {
    const snapshot = status([
      { kind: 'merge' }, { kind: 'cherryPick', noCommit: true },
      { kind: 'rebase', editStopped: true, split: { preparing: false, partCount: 2, treeMatches: true } },
      { kind: 'mailPatch' },
    ]);
    snapshot.bisectInProgress = true;
    expect(repositoryOperationState(snapshot)).toEqual({
      mergeInProgress: true, historyOperation: 'cherry-pick', historyNoCommit: true,
      rebaseInProgress: true, rebaseEditStopped: true,
      rebaseSplit: { preparing: false, partCount: 2, treeMatches: true },
      mailPatchInProgress: true, bisectInProgress: true,
    });
    expect(repositoryOperationState(status([{ kind: 'revert', noCommit: false }]))).toMatchObject({
      historyOperation: 'revert', historyNoCommit: false,
    });
  });

  it('uses the typed native snapshot rather than outdated legacy fields', () => {
    const snapshot = status([]);
    snapshot.mergeInProgress = true;
    snapshot.historyOperation = 'cherry-pick';
    expect(repositoryOperationState(snapshot)).toMatchObject({
      mergeInProgress: false, historyOperation: null,
    });
  });

  it('supports older and preview snapshots only when typed observations are absent', () => {
    const snapshot = status(null);
    snapshot.historyOperation = 'revert';
    snapshot.historyNoCommit = true;
    snapshot.bisectInProgress = true;
    expect(repositoryOperationState(snapshot)).toMatchObject({
      historyOperation: 'revert', historyNoCommit: true, bisectInProgress: true,
    });
    expect(repositoryOperationState(null)).toEqual(repositoryOperationState(status([])));
  });
});
