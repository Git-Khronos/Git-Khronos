import type { RepositoryStatus, WorkingTreeEntry } from '@git-chronos/contracts';

type EntryUpdate = (entry: WorkingTreeEntry) => WorkingTreeEntry | null;

const isUntracked = (entry: WorkingTreeEntry) => entry.indexStatus === '?';
const isClean = (status: string) => status === ' ' || status === '!';

function contribution(entry: WorkingTreeEntry) {
  if (entry.conflicted) return { staged: 0, unstaged: 0, untracked: 0, conflicted: 1 };
  if (isUntracked(entry)) return { staged: 0, unstaged: 0, untracked: 1, conflicted: 0 };
  return {
    staged: isClean(entry.indexStatus) ? 0 : 1,
    unstaged: isClean(entry.worktreeStatus) ? 0 : 1,
    untracked: 0,
    conflicted: 0,
  };
}

/** Matches a path or, for collapsed untracked directories (`dir/`), anything inside it. */
function covers(entryPath: string, path: string): boolean {
  return entryPath === path || (path.endsWith('/') && entryPath.startsWith(path));
}

/**
 * Applies a predicted per-entry change and keeps the summary counters
 * consistent, so the change lists update before Git reports back.
 * Entries beyond a truncated list are left for the authoritative refresh.
 */
function applyEntryUpdate(
  status: RepositoryStatus,
  matches: (entry: WorkingTreeEntry) => boolean,
  update: EntryUpdate,
): RepositoryStatus {
  let changed = false;
  const counts = {
    staged: status.staged,
    unstaged: status.unstaged,
    untracked: status.untracked,
    conflicted: status.conflicted,
    entryCount: status.entryCount,
  };
  const entries: WorkingTreeEntry[] = [];
  for (const entry of status.entries) {
    if (entry.conflicted || !matches(entry)) {
      entries.push(entry);
      continue;
    }
    const next = update(entry);
    if (next && next.indexStatus === entry.indexStatus && next.worktreeStatus === entry.worktreeStatus) {
      entries.push(entry);
      continue;
    }
    changed = true;
    const before = contribution(entry);
    counts.staged -= before.staged;
    counts.unstaged -= before.unstaged;
    counts.untracked -= before.untracked;
    counts.conflicted -= before.conflicted;
    if (next) {
      const after = contribution(next);
      counts.staged += after.staged;
      counts.unstaged += after.unstaged;
      counts.untracked += after.untracked;
      counts.conflicted += after.conflicted;
      entries.push(next);
    } else {
      counts.entryCount -= 1;
    }
  }
  return changed ? { ...status, ...counts, entries } : status;
}

function stagedEntry(entry: WorkingTreeEntry): WorkingTreeEntry | null {
  if (isUntracked(entry)) return { ...entry, indexStatus: 'A', worktreeStatus: ' ' };
  if (isClean(entry.worktreeStatus)) return entry;
  if (entry.worktreeStatus === 'D') {
    return entry.indexStatus === 'A' ? null : { ...entry, indexStatus: 'D', worktreeStatus: ' ' };
  }
  return {
    ...entry,
    indexStatus: isClean(entry.indexStatus) ? entry.worktreeStatus : entry.indexStatus,
    worktreeStatus: ' ',
  };
}

function unstagedEntry(entry: WorkingTreeEntry): WorkingTreeEntry | null {
  if (isUntracked(entry) || isClean(entry.indexStatus)) return entry;
  // Renames and copies split into two entries; wait for Git to report them.
  if (entry.indexStatus === 'R' || entry.indexStatus === 'C') return entry;
  if (entry.indexStatus === 'A') {
    return entry.worktreeStatus === 'D' ? null : { ...entry, indexStatus: '?', worktreeStatus: '?' };
  }
  return {
    ...entry,
    indexStatus: ' ',
    worktreeStatus: isClean(entry.worktreeStatus) ? entry.indexStatus : entry.worktreeStatus,
  };
}

function discardedEntry(entry: WorkingTreeEntry): WorkingTreeEntry | null {
  if (isUntracked(entry)) return null;
  if (isClean(entry.indexStatus)) return null;
  // `restore --worktree` copies the index version back, keeping staged content.
  return { ...entry, worktreeStatus: ' ' };
}

export function predictStagePath(status: RepositoryStatus, path: string): RepositoryStatus {
  return applyEntryUpdate(status, (entry) => covers(entry.path, path), stagedEntry);
}

export function predictUnstagePath(status: RepositoryStatus, path: string): RepositoryStatus {
  return applyEntryUpdate(status, (entry) => entry.path === path, unstagedEntry);
}

export function predictStageAll(status: RepositoryStatus): RepositoryStatus {
  return applyEntryUpdate(status, () => true, stagedEntry);
}

export function predictUnstageAll(status: RepositoryStatus): RepositoryStatus {
  return applyEntryUpdate(status, () => true, unstagedEntry);
}

export function predictDiscardPath(status: RepositoryStatus, path: string): RepositoryStatus {
  return applyEntryUpdate(status, (entry) => covers(entry.path, path), discardedEntry);
}

/**
 * Fast snapshots omit untracked files to keep mutations cheap. Carry the
 * previously known untracked entries forward until the next status refresh so
 * they do not disappear and reappear after unrelated operations.
 */
export function preserveUntrackedEntries(
  previous: RepositoryStatus,
  next: RepositoryStatus,
): RepositoryStatus {
  if (next.untracked > 0 || previous.untracked === 0) return next;
  const known = new Set(next.entries.map((entry) => entry.path));
  const carried = previous.entries.filter((entry) => isUntracked(entry) && !known.has(entry.path));
  if (!carried.length) return next;
  return {
    ...next,
    untracked: previous.untracked,
    entryCount: next.entryCount + previous.untracked,
    entriesTruncated: next.entriesTruncated || previous.entriesTruncated,
    entries: [...next.entries, ...carried],
  };
}

const CHANGE_DESCRIPTIONS: Record<string, string> = {
  M: 'Modified',
  T: 'File type changed',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
};

const CONFLICT_DESCRIPTIONS: Record<string, string> = {
  UU: 'both sides modified this file',
  AA: 'both sides added this file',
  DD: 'both sides deleted this file',
  AU: 'added on this branch, changed on the other',
  UA: 'added on the other branch, changed on this one',
  DU: 'deleted on this branch, changed on the other',
  UD: 'deleted on the other branch, changed on this one',
};

/** Plain-language explanation of a working-tree status letter for tooltips and screen readers. */
export function describeWorkingTreeStatus(entry: WorkingTreeEntry, staged: boolean): string {
  if (entry.conflicted) {
    const detail = CONFLICT_DESCRIPTIONS[`${entry.indexStatus}${entry.worktreeStatus}`];
    return detail ? `Merge conflict: ${detail}` : 'Merge conflict';
  }
  if (isUntracked(entry)) {
    return entry.path.endsWith('/')
      ? 'New folder, not tracked by Git yet'
      : 'New file, not tracked by Git yet';
  }
  const code = staged ? entry.indexStatus : entry.worktreeStatus;
  const change = CHANGE_DESCRIPTIONS[code] ?? `Changed (${code.trim() || 'unknown'})`;
  return staged ? `${change}, staged for the next commit` : `${change}, not staged yet`;
}
