import { describe, expect, it } from 'vitest';
import type { Branch } from '@git-khronos/contracts';
import { indexBranchPicker, searchBranchPicker } from './branch-picker';

const branch = (name: string, remote = false, current = false): Branch => ({
  name, remote, current, oid: 'a'.repeat(40), upstream: null, upstreamTarget: null, tracking: null,
  fullName: `refs/${remote ? 'remotes' : 'heads'}/${name}`,
});
const index = (branches: Branch[]) => indexBranchPicker(
  branches, name => name.split('/').slice(1).join('/'), (a, b) => a.name.localeCompare(b.name),
);

describe('branch picker search', () => {
  it('finds an exact local name beyond the display limit and reports partial counts accurately', () => {
    const target = branch('release');
    const catalog = index([...Array.from({ length: 150 }, (_, i) => branch(`a${i}/release`)), target]);
    expect(searchBranchPicker(catalog, 'rele')).toMatchObject({ total: 151, shown: 80, exact: false });
    expect(searchBranchPicker(catalog, 'release')).toEqual({ local: [target], remote: [], total: 1, shown: 1, exact: true });
  });

  it('keeps the normal group and puts a named remote peer on the actual selectable row', () => {
    const origin = branch('origin/docs', true);
    const upstream = branch('upstream/docs', true);
    const catalog = index([upstream, origin]);
    for (const typed of ['upstream/docs', 'UPSTREAM/DOCS', 'refs/remotes/upstream/docs']) {
      expect(searchBranchPicker(catalog, typed)).toMatchObject({
        total: 1, remote: [{ label: 'docs', primary: upstream, locations: [origin, upstream] }],
      });
    }
    expect(searchBranchPicker(catalog, 'upstream').remote[0].primary).toBe(origin);
    expect(searchBranchPicker(catalog, 'docs').remote[0].primary).toBe(origin);
  });

  it('distinguishes short aliases, fully qualified paths and case variants', () => {
    const local = branch('docs', false, true);
    const upper = branch('Docs');
    const remote = branch('upstream/docs', true);
    const catalog = index([local, upper, remote]);
    expect(searchBranchPicker(catalog, 'upstream/docs').local).toEqual([local]);
    expect(searchBranchPicker(catalog, 'refs/remotes/upstream/docs').remote[0].primary).toBe(remote);
    expect(searchBranchPicker(catalog, 'refs/heads/Docs').local).toEqual([upper]);
    expect(searchBranchPicker(catalog, 'refs/heads/DOCS').total).toBe(0);
    expect(searchBranchPicker(catalog, 'DOCS')).toMatchObject({ exact: false, total: 2, local: [local, upper] });
    expect(searchBranchPicker(catalog, 'refs/tags/docs').total).toBe(0);
  });

  it('keeps exact peers distinct when remote names differ only by case', () => {
    const lower = branch('origin/docs', true);
    const upper = branch('Origin/docs', true);
    const catalog = index([lower, upper]);
    expect(searchBranchPicker(catalog, 'Origin/docs').remote[0].primary).toBe(upper);
    const matches = searchBranchPicker(catalog, 'ORIGIN/DOCS');
    expect(matches.total).toBe(2);
    expect(matches.remote.map(row => row.primary.name)).toEqual(['origin/docs', 'Origin/docs']);
  });
});
