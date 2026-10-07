import type { CommitSummary } from '@git-chronos/contracts';

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCommit(left: CommitSummary, right: CommitSummary): boolean {
  return left.oid === right.oid
    && left.authorName === right.authorName
    && left.authorEmail === right.authorEmail
    && left.authoredAt === right.authoredAt
    && left.subject === right.subject
    && left.description === right.description
    && sameStrings(left.parents, right.parents)
    && sameStrings(left.decorations, right.decorations);
}

export function reconcileCommitHistory(previous: CommitSummary[], incoming: CommitSummary[]): CommitSummary[] {
  let unchanged = previous.length === incoming.length;
  const commits = incoming.map((commit, index) => {
    const old = previous[index];
    if (old && sameCommit(old, commit)) return old;
    unchanged = false;
    return commit;
  });
  return unchanged ? previous : commits;
}
