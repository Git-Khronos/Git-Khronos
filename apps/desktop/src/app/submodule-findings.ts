import type { SubmoduleState } from '@git-chronos/contracts';

export interface SubmoduleFinding {
  label: string;
  detail: string;
  attention: boolean;
}

const short = (oid: string | null): string => oid ? oid.slice(0, 10) : 'none';

export function submoduleFindings(entry: SubmoduleState): SubmoduleFinding[] {
  const findings: SubmoduleFinding[] = [];
  const add = (label: string, detail: string, attention = true) => findings.push({ label, detail, attention });
  if (entry.conflict) {
    const side = entry.conflict;
    add('Submodule commit conflict', `Base ${short(side.base)}, ours ${short(side.ours)}, theirs ${short(side.theirs)}. `
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
      ? 'Update the submodule to check out the recorded commit.'
      : 'Initialize to register its URL in local configuration, then update to check it out.');
  }
  if (entry.commitChanged) {
    add('Different commit checked out', `Checked out ${short(entry.checkoutOid)}; recorded ${short(entry.indexOid)}. `
      + 'Stage the path to record the new commit, or update the submodule to return to the recorded one.');
  }
  if (entry.stagedChange) {
    add('Submodule commit change staged', `HEAD ${short(entry.headOid)} → index ${entry.indexOid ? short(entry.indexOid) : 'removed'}. `
      + 'Committing records this change for everyone who updates.');
  }
  if (entry.trackedChanges) {
    add('Uncommitted changes inside', 'Commit or stash them inside the submodule before updating it.');
  }
  if (entry.untrackedChanges) {
    add('Untracked files inside', 'They stay in the submodule directory and are not recorded by the parent repository.', false);
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
