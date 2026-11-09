export type GraphReferenceKind = 'head' | 'tag' | 'remote' | 'local' | 'checkpoint';

export interface GraphReferenceIdentity {
  decoration: string;
  label: string;
  kind: GraphReferenceKind;
}

export interface CompactReferenceLocation extends GraphReferenceIdentity {
  remote: string | null;
}

export interface CompactReferenceSummary {
  label: string;
  locations: CompactReferenceLocation[];
  hiddenCount: number;
  ariaLabel: string;
}

export interface ReferenceGroup {
  key: string;
  label: string;
  locations: CompactReferenceLocation[];
  current: boolean;
}

export function buildReferenceGroups(
  references: readonly GraphReferenceIdentity[],
): ReferenceGroup[] {
  const groups = new Map<string, { group: ReferenceGroup; index: number }>();

  references.forEach((reference, index) => {
    const label = displayLabel(reference);
    const key = isBranch(reference) ? `branch:${label}` : `${reference.kind}:${reference.decoration}`;
    const location = {
      ...reference,
      remote: reference.kind === 'remote' ? remoteName(reference.label) : null,
    };
    const existing = groups.get(key);
    if (existing) {
      const duplicateIndex = existing.group.locations.findIndex(
        (candidate) => locationKey(candidate) === locationKey(location),
      );
      if (duplicateIndex < 0) {
        existing.group.locations.push(location);
      } else if (location.kind === 'head') {
        // HEAD and the checked-out local ref describe the same location. Keep
        // the HEAD variant so the UI can identify the active branch without
        // rendering a second local icon.
        existing.group.locations[duplicateIndex] = location;
      }
      existing.group.current ||= reference.kind === 'head';
    } else {
      groups.set(key, {
        index,
        group: { key, label, locations: [location], current: reference.kind === 'head' },
      });
    }
  });

  return [...groups.values()]
    .sort((left, right) => Number(right.group.current) - Number(left.group.current) || left.index - right.index)
    .map(({ group }) => ({
      ...group,
      locations: [...group.locations].sort((left, right) => locationRank(left) - locationRank(right)),
    }));
}

export function describeReferenceGroups(groups: readonly ReferenceGroup[]): string {
  const locationCount = groups.reduce((count, group) => count + group.locations.length, 0);
  const oneBranch = groups.length === 1 && groups[0].locations.every(isBranch);
  const groupLabel = oneBranch ? '1 branch' : `${groups.length} ${groups.length === 1 ? 'reference' : 'references'}`;
  return `${groupLabel} · ${locationCount} ${locationCount === 1 ? 'location' : 'locations'}`;
}

export function primaryReferenceGroup(groups: readonly ReferenceGroup[]): ReferenceGroup | null {
  return groups.find((group) => group.current)
    ?? groups.find((group) => group.locations.some((location) => location.kind === 'local'))
    ?? groups.find((group) => group.locations.some((location) => location.kind === 'remote'))
    ?? groups[0]
    ?? null;
}

export function buildCompactReferenceSummary(
  references: readonly GraphReferenceIdentity[],
): CompactReferenceSummary {
  const groups = buildReferenceGroups(references);
  const primary = primaryReferenceGroup(groups);
  if (!primary) {
    return { label: '', locations: [], hiddenCount: 0, ariaLabel: 'Show references' };
  }

  const label = primary.label;
  const locations = primary.locations;
  const hiddenCount = groups.length - 1;
  const locationLabels = locations.map((location) => location.remote
    ? `remote ${location.remote}`
    : location.kind === 'tag'
      ? 'tag'
      : location.kind === 'checkpoint'
        ? 'Copilot checkpoint'
        : location.kind === 'head'
          ? 'current local branch'
          : 'local branch');
  const remainder = hiddenCount
    ? `, plus ${hiddenCount} other ${hiddenCount === 1 ? 'reference' : 'references'}`
    : '';

  return {
    label,
    locations,
    hiddenCount,
    ariaLabel: `${label}: ${locationLabels.join(', ')}${remainder}. Show all ${references.length} references.`,
  };
}

function displayLabel(reference: GraphReferenceIdentity): string {
  const label = normalizedBranchReference(reference.label, reference.kind);
  if (reference.kind !== 'remote') return label;
  const separator = label.indexOf('/');
  return separator > 0 ? label.slice(separator + 1) : label;
}

function remoteName(label: string): string {
  const normalized = normalizedBranchReference(label, 'remote');
  const separator = normalized.indexOf('/');
  return separator > 0 ? normalized.slice(0, separator) : normalized;
}

function normalizedBranchReference(label: string, kind: GraphReferenceKind): string {
  if (kind === 'remote') return label.replace(/^refs\/remotes\//, '').replace(/^remotes\//, '');
  if (kind === 'head' || kind === 'local') return label.replace(/^refs\/heads\//, '').replace(/^heads\//, '');
  return label;
}

function isBranch(reference: GraphReferenceIdentity): boolean {
  return reference.kind === 'head' || reference.kind === 'local' || reference.kind === 'remote';
}

function locationRank(reference: GraphReferenceIdentity): number {
  if (reference.kind === 'head') return 0;
  if (reference.kind === 'local') return 1;
  if (reference.kind === 'remote') return 2;
  return 3;
}

function locationKey(reference: CompactReferenceLocation): string {
  if (reference.kind === 'head' || reference.kind === 'local') return 'local';
  if (reference.kind === 'remote') return `remote:${reference.remote}`;
  return `${reference.kind}:${reference.decoration}`;
}
