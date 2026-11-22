import type { Branch } from '@git-khronos/contracts';
import { orderBranchesCurrentFirst } from './branch-order';

export interface PickerRemoteBranch {
  label: string;
  primary: Branch;
  locations: readonly Branch[];
}

interface SearchRow<T> {
  value: T;
  terms: readonly string[];
}

interface BranchPickerIndex {
  byRef: ReadonlyMap<string, Branch>;
  localByName: ReadonlyMap<string, Branch>;
  remoteByName: ReadonlyMap<string, { branch: Branch; group: PickerRemoteBranch }>;
  remoteByLabel: ReadonlyMap<string, PickerRemoteBranch>;
  remoteNamesFolded: ReadonlyMap<string, readonly string[]>;
  locals: readonly SearchRow<Branch>[];
  remotes: readonly SearchRow<PickerRemoteBranch>[];
}

export interface BranchPickerMatches {
  local: readonly Branch[];
  remote: readonly PickerRemoteBranch[];
  total: number;
  shown: number;
  exact: boolean;
}

const DISPLAY_LIMIT = 80;
const folded = (value: string) => value.toLocaleLowerCase();

export function indexBranchPicker(
  branches: readonly Branch[],
  remoteLabel: (name: string) => string,
  compareRemotes: (a: Branch, b: Branch) => number,
): BranchPickerIndex {
  const locals = orderBranchesCurrentFirst(branches.filter(branch => !branch.remote));
  const localByName = new Map(locals.map(branch => [branch.name, branch]));
  const byRef = new Map(branches.map(branch => [branch.fullName, branch]));
  const grouped = new Map<string, Branch[]>();
  for (const branch of branches) {
    if (!branch.remote) continue;
    const label = remoteLabel(branch.name);
    const locations = grouped.get(label);
    if (locations) locations.push(branch);
    else grouped.set(label, [branch]);
  }
  const remoteByName = new Map<string, { branch: Branch; group: PickerRemoteBranch }>();
  const remoteByLabel = new Map<string, PickerRemoteBranch>();
  const remoteNamesFolded = new Map<string, string[]>();
  const remotes: SearchRow<PickerRemoteBranch>[] = [];
  for (const [label, locations] of grouped) {
    locations.sort(compareRemotes);
    const group = { label, primary: locations[0], locations };
    for (const branch of locations) {
      remoteByName.set(branch.name, { branch, group });
      const key = folded(branch.name);
      const spellings = remoteNamesFolded.get(key);
      if (spellings) spellings.push(branch.name);
      else remoteNamesFolded.set(key, [branch.name]);
    }
    if (localByName.has(label)) continue;
    remoteByLabel.set(label, group);
    remotes.push({ value: group, terms: [folded(label), ...locations.map(branch => folded(branch.name))] });
  }
  remotes.sort((left, right) => left.value.label.localeCompare(
    right.value.label, undefined, { numeric: true, sensitivity: 'base' },
  ) || left.value.label.localeCompare(right.value.label));
  return {
    byRef, localByName, remoteByName, remoteByLabel, remoteNamesFolded, remotes,
    locals: locals.map(value => ({
      value, terms: [folded(value.name), ...(grouped.get(value.name) ?? []).map(branch => folded(branch.name))],
    })),
  };
}

export function isQualifiedBranchSearch(query: string): boolean {
  return query.trim().startsWith('refs/');
}

export function searchBranchPicker(index: BranchPickerIndex, input: string): BranchPickerMatches {
  const query = input.trim();
  const exactLocal = (branch: Branch): BranchPickerMatches =>
    ({ local: [branch], remote: [], total: 1, shown: 1, exact: true });
  const exactRemote = (group: PickerRemoteBranch): BranchPickerMatches =>
    ({ local: [], remote: [group], total: 1, shown: 1, exact: true });
  const exactLocation = (name: string, qualified: boolean): BranchPickerMatches | null => {
    const found = index.remoteByName.get(name);
    if (!found) return null;
    // An aligned shorthand is a local choice. Only a fully qualified
    // remote ref explicitly requests fetch/sync for an existing counterpart.
    const local = !qualified && index.localByName.get(found.group.label);
    return local ? exactLocal(local) : exactRemote({ ...found.group, primary: found.branch });
  };
  if (isQualifiedBranchSearch(query)) {
    const branch = index.byRef.get(query);
    if (branch && !branch.remote) return exactLocal(branch);
    if (branch?.remote) {
      const match = exactLocation(branch.name, true);
      if (match) return match;
    }
    return { local: [], remote: [], total: 0, shown: 0, exact: false };
  }
  if (query) {
    const local = index.localByName.get(query);
    if (local) return exactLocal(local);
    const location = exactLocation(query, false);
    if (location) return location;
    const group = index.remoteByLabel.get(query);
    if (group) return exactRemote(group);
  }
  const term = folded(query);
  const spellings = index.remoteNamesFolded.get(term);
  if (spellings?.length) {
    const local = new Map(index.locals
      .filter(row => row.terms[0] === term).map(row => [row.value.fullName, row.value]));
    const remote: PickerRemoteBranch[] = [];
    for (const spelling of spellings) {
      const match = exactLocation(spelling, false);
      if (match?.local[0]) local.set(match.local[0].fullName, match.local[0]);
      if (match?.remote[0]) remote.push(match.remote[0]);
    }
    const total = local.size + remote.length;
    return { local: [...local.values()].slice(0, DISPLAY_LIMIT), remote: remote.slice(0, DISPLAY_LIMIT),
      total, shown: Math.min(local.size, DISPLAY_LIMIT) + Math.min(remote.length, DISPLAY_LIMIT), exact: false };
  }
  let total = 0;
  const pick = <T>(rows: readonly SearchRow<T>[]): T[] => {
    const visible: T[] = [];
    for (const row of rows) {
      if (term && !row.terms.some(text => text.includes(term))) continue;
      total++;
      if (visible.length < DISPLAY_LIMIT) visible.push(row.value);
    }
    return visible;
  };
  const local = pick(index.locals);
  const remote = pick(index.remotes);
  return { local, remote, total, shown: local.length + remote.length, exact: false };
}
