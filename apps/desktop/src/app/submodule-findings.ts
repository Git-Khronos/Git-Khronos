import type { SubmoduleState } from '@git-khronos/contracts';

export interface SubmoduleFinding {
  label: string;
  detail: string;
  attention: boolean;
}

export function submoduleFindings(entry: SubmoduleState, fullCommitIds = false): SubmoduleFinding[] {
  const commit = (oid: string | null): string => (fullCommitIds ? oid : oid?.slice(0, 10)) ?? 'none';
  const findings: SubmoduleFinding[] = [];
  const add = (label: string, detail: string, attention = true) => findings.push({ label, detail, attention });
  if (entry.conflict) {
    const side = entry.conflict;
    add('Submodule commit conflict', `Base ${commit(side.base)}, ours ${commit(side.ours)}, theirs ${commit(side.theirs)}. `
      + 'Check out the commit to keep inside the submodule, then stage this path in the parent repository.');
    if (side.mixedTypes) add('File and submodule conflict', 'One side is not a submodule. Resolve this path with local Git.');
  }
  if (entry.undeclared) {
    add('Not declared in .gitmodules', 'A submodule commit is recorded here, but without a .gitmodules entry others cannot initialize or clone it.');
  }
  if (entry.missingGitlink) {
    add('Declared without a recorded commit', '.gitmodules names this path, but neither HEAD nor the index records a submodule commit for it.');
  } else if (!entry.checkedOut && !entry.conflict) {
    add(entry.registeredUrl ? 'Initialized, not checked out' : 'Not initialized', entry.registeredUrl
      ? 'Initialize this checkout at the recorded commit.'
      : 'Initialize to register its URL in local configuration and check out the recorded commit.');
  }
  if (entry.commitChanged) {
    add('Different commit checked out', `Checked out ${commit(entry.checkoutOid)}; recorded ${commit(entry.indexOid)}. `
      + 'Stage the path to record the new commit, or choose Check out recorded commit to return to it.');
  }
  if (entry.stagedChange) {
    add('Submodule commit change staged', `HEAD ${commit(entry.headOid)} → index ${entry.indexOid ? commit(entry.indexOid) : 'removed'}. `
      + 'Committing records this change for everyone who updates.');
  }
  if (entry.trackedChanges) {
    add('Uncommitted changes inside', 'Commit or stash them inside the submodule before updating it.');
  }
  if (entry.untrackedChanges) {
    add('Untracked files inside', 'These are not recorded by the parent. Review them inside the submodule before updating it.');
  }
  if (entry.urlMatches === false) {
    add('Local URL differs from .gitmodules', `.gitmodules: ${entry.declaredUrl}. Local: ${entry.registeredUrl}. `
      + 'git submodule sync would replace the local URL with the declared one.');
  } else if (entry.urlMatches === null && entry.declaredUrl && entry.registeredUrl) {
    add('Relative declared URL', `${entry.declaredUrl} resolves against this repository’s remote. Local: ${entry.registeredUrl}. Compare them before syncing.`, false);
  }
  if (!findings.some(finding => finding.attention)) {
    findings.unshift({ label: 'Matches the recorded commit', detail: 'No changes inside and no staged submodule commit change.', attention: false });
  }
  return findings;
}
