import type { BisectCandidate } from '@git-khronos/contracts';

export function sameBisectCandidate(
  left: BisectCandidate | null | undefined,
  right: BisectCandidate | null | undefined,
): boolean {
  return left?.oid === right?.oid && left?.noCheckout === right?.noCheckout
    && !!left?.firstParent === !!right?.firstParent
    && left?.terms?.old === right?.terms?.old && left?.terms?.new === right?.terms?.new;
}

/** Preview fixtures only. Native Git owns the actual candidate walk. */
export function bisectPreviewHistory<T extends { oid: string; parents: string[] }>(
  commits: T[], start: string, firstParent: boolean,
): T[] {
  if (!firstParent) return commits;
  const byOid = new Map(commits.map(commit => [commit.oid, commit]));
  const visited = new Set<string>();
  const line: T[] = [];
  let oid: string | undefined = start;
  while (oid && !visited.has(oid)) {
    const commit = byOid.get(oid);
    if (!commit) break;
    visited.add(oid);
    line.push(commit);
    oid = commit.parents[0];
  }
  return line;
}
