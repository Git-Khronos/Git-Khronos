import type { RepositoryStatus, WorkingTreeEntry } from '@git-chronos/contracts';
import { describe, expect, it } from 'vitest';
import {
  describeWorkingTreeStatus,
  predictDiscardPath,
  predictStageAll,
  predictStagePath,
  predictUnstageAll,
  predictUnstagePath,
  preserveUntrackedEntries,
} from './working-tree-status';

const entry = (path: string, xy: string, conflicted = false): WorkingTreeEntry => ({
  path,
  indexStatus: xy[0],
  worktreeStatus: xy[1],
  conflicted,
});

function status(entries: WorkingTreeEntry[]): RepositoryStatus {
  const result: RepositoryStatus = {
    branch: 'main',
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    mergeInProgress: false,
    historyOperation: null,
    historyNoCommit: false,
    rebaseInProgress: false,
    rebaseEditStopped: false,
    bisectInProgress: false,
    entryCount: entries.length,
    entriesTruncated: false,
    entries,
  };
  for (const item of entries) {
    if (item.conflicted) result.conflicted += 1;
    else if (item.indexStatus === '?') result.untracked += 1;
    else {
      if (item.indexStatus !== ' ') result.staged += 1;
      if (item.worktreeStatus !== ' ') result.unstaged += 1;
    }
  }
  return result;
}

const codes = (value: RepositoryStatus) =>
  value.entries.map((item) => `${item.indexStatus}${item.worktreeStatus} ${item.path}`);

const counters = ({ staged, unstaged, untracked, conflicted, entryCount }: RepositoryStatus) =>
  ({ staged, unstaged, untracked, conflicted, entryCount });

describe('working tree status predictions', () => {
  it('stages modified, deleted and untracked files with consistent counters', () => {
    const before = status([entry('a.ts', ' M'), entry('b.ts', ' D'), entry('new.ts', '??'), entry('c.ts', 'MM')]);

    const after = predictStageAll(before);

    expect(codes(after)).toEqual(['M  a.ts', 'D  b.ts', 'A  new.ts', 'M  c.ts']);
    expect(counters(after)).toEqual(counters(status(after.entries)));
  });

  it('stages only the requested path and keeps the original object when nothing changes', () => {
    const before = status([entry('a.ts', ' M'), entry('b.ts', ' M')]);

    expect(codes(predictStagePath(before, 'a.ts'))).toEqual(['M  a.ts', ' M b.ts']);
    expect(predictStagePath(before, 'missing.ts')).toBe(before);
  });

  it('stages a collapsed untracked directory summary', () => {
    const before = status([entry('dir/', '??'), entry('other.ts', '??')]);

    const after = predictStagePath(before, 'dir/');

    expect(codes(after)).toEqual(['A  dir/', '?? other.ts']);
    expect(after.untracked).toBe(1);
    expect(after.staged).toBe(1);
  });

  it('drops an added file that was later deleted when it is staged', () => {
    const after = predictStageAll(status([entry('gone.ts', 'AD')]));

    expect(after.entries).toEqual([]);
    expect(counters(after)).toEqual(counters(status([])));
  });

  it('unstages edits back into the worktree and new files back to untracked', () => {
    const before = status([entry('a.ts', 'M '), entry('b.ts', 'MM'), entry('new.ts', 'A '), entry('del.ts', 'D ')]);

    const after = predictUnstageAll(before);

    expect(codes(after)).toEqual([' M a.ts', ' M b.ts', '?? new.ts', ' D del.ts']);
    expect(counters(after)).toEqual(counters(status(after.entries)));
  });

  it('leaves renames for the authoritative refresh and only unstages the exact path', () => {
    const before = status([entry('renamed.ts', 'R '), entry('a.ts', 'M '), entry('a.ts.bak', 'M ')]);

    expect(codes(predictUnstagePath(before, 'a.ts'))).toEqual(['R  renamed.ts', ' M a.ts', 'M  a.ts.bak']);
    expect(predictUnstagePath(before, 'renamed.ts')).toBe(before);
  });

  it('discards worktree changes while keeping staged content', () => {
    const before = status([entry('a.ts', ' M'), entry('b.ts', 'MM'), entry('c.ts', 'AD'), entry('d.ts', 'AM')]);

    expect(codes(predictDiscardPath(before, 'a.ts'))).toEqual(['MM b.ts', 'AD c.ts', 'AM d.ts']);
    expect(codes(predictDiscardPath(before, 'b.ts'))).toEqual([' M a.ts', 'M  b.ts', 'AD c.ts', 'AM d.ts']);
    expect(codes(predictDiscardPath(before, 'c.ts'))).toEqual([' M a.ts', 'MM b.ts', 'A  c.ts', 'AM d.ts']);
    expect(codes(predictDiscardPath(before, 'd.ts'))).toEqual([' M a.ts', 'MM b.ts', 'AD c.ts', 'A  d.ts']);
  });

  it('discards untracked directories including entries inside them', () => {
    const before = status([entry('tmp/a.log', '??'), entry('tmp/b.log', '??'), entry('keep.ts', '??')]);

    const after = predictDiscardPath(before, 'tmp/');

    expect(codes(after)).toEqual(['?? keep.ts']);
    expect(counters(after)).toEqual(counters(status(after.entries)));
  });

  it('never predicts changes for conflicted entries', () => {
    const before = status([entry('conflict.ts', 'UU', true)]);

    expect(predictStageAll(before)).toBe(before);
    expect(predictUnstageAll(before)).toBe(before);
    expect(predictDiscardPath(before, 'conflict.ts')).toBe(before);
  });
});

describe('preserveUntrackedEntries', () => {
  it('carries known untracked files into a snapshot that omitted them', () => {
    const previous = status([entry('a.ts', ' M'), entry('new.ts', '??')]);
    const next = status([entry('a.ts', 'M ')]);

    const merged = preserveUntrackedEntries(previous, next);

    expect(codes(merged)).toEqual(['M  a.ts', '?? new.ts']);
    expect(counters(merged)).toEqual(counters(status(merged.entries)));
  });

  it('keeps authoritative untracked results and avoids duplicates', () => {
    const previous = status([entry('old.ts', '??')]);
    const next = status([entry('new.ts', '??')]);
    const tracked = status([entry('old.ts', 'A ')]);

    expect(preserveUntrackedEntries(previous, next)).toBe(next);
    expect(preserveUntrackedEntries(previous, tracked)).toBe(tracked);
  });
});

describe('describeWorkingTreeStatus', () => {
  it('explains staged, unstaged, untracked and conflicted letters', () => {
    expect(describeWorkingTreeStatus(entry('a.ts', ' M'), false)).toBe('Modified, not staged yet');
    expect(describeWorkingTreeStatus(entry('a.ts', 'MD'), false)).toBe('Deleted, not staged yet');
    expect(describeWorkingTreeStatus(entry('a.ts', 'A '), true)).toBe('Added, staged for the next commit');
    expect(describeWorkingTreeStatus(entry('b.ts', 'R '), true)).toBe('Renamed, staged for the next commit');
    expect(describeWorkingTreeStatus(entry('new.ts', '??'), false)).toBe('New file, not tracked by Git yet');
    expect(describeWorkingTreeStatus(entry('docs/', '??'), false)).toBe('New folder, not tracked by Git yet');
    expect(describeWorkingTreeStatus(entry('c.ts', 'UU', true), false)).toBe('Merge conflict: both sides modified this file');
    expect(describeWorkingTreeStatus(entry('c.ts', 'XY', true), false)).toBe('Merge conflict');
  });
});
