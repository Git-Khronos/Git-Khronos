import { describe, expect, it } from 'vitest';
import {
  buildCompactReferenceSummary,
  buildReferenceGroups,
  describeReferenceGroups,
} from './reference-summary';

describe('buildCompactReferenceSummary', () => {
  it('combines an aligned local and remote branch under the branch name', () => {
    expect(buildCompactReferenceSummary([
      { decoration: 'HEAD -> main', label: 'main', kind: 'head' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
    ])).toEqual({
      label: 'main',
      locations: [
        { decoration: 'HEAD -> main', label: 'main', kind: 'head', remote: null },
        { decoration: 'origin/main', label: 'origin/main', kind: 'remote', remote: 'origin' },
      ],
      hiddenCount: 0,
      ariaLabel: 'main: current local branch, remote origin. Show all 2 references.',
    });
  });

  it('combines the same branch name from multiple remote locations', () => {
    const summary = buildCompactReferenceSummary([
      { decoration: 'origin/feature/topic', label: 'origin/feature/topic', kind: 'remote' },
      { decoration: 'upstream/feature/topic', label: 'upstream/feature/topic', kind: 'remote' },
    ]);

    expect(summary.label).toBe('feature/topic');
    expect(summary.locations.map((location) => location.remote)).toEqual(['origin', 'upstream']);
    expect(summary.hiddenCount).toBe(0);
  });

  it('shows one location icon for duplicate names from the same location', () => {
    const summary = buildCompactReferenceSummary([
      { decoration: 'main', label: 'main', kind: 'local' },
      { decoration: 'HEAD -> main', label: 'main', kind: 'head' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
    ]);

    expect(summary.label).toBe('main');
    expect(summary.locations.map((location) => location.kind)).toEqual(['head', 'remote']);
    expect(summary.locations.map((location) => location.remote)).toEqual([null, 'origin']);
    expect(summary.hiddenCount).toBe(0);
  });

  it('keeps unrelated references available behind a compact count', () => {
    const summary = buildCompactReferenceSummary([
      { decoration: 'tag: v1.0.0', label: 'v1.0.0', kind: 'tag' },
      { decoration: 'main', label: 'main', kind: 'local' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
    ]);

    expect(summary.label).toBe('main');
    expect(summary.locations).toHaveLength(2);
    expect(summary.hiddenCount).toBe(1);
    expect(summary.ariaLabel).toContain('plus 1 other reference');
  });

  it('uses the current branch even when another local decoration arrives first', () => {
    const summary = buildCompactReferenceSummary([
      { decoration: 'feature/alpha', label: 'feature/alpha', kind: 'local' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
      { decoration: 'HEAD -> main', label: 'main', kind: 'head' },
    ]);

    expect(summary.label).toBe('main');
    expect(summary.locations.map((location) => location.kind)).toEqual(['head', 'remote']);
    expect(summary.hiddenCount).toBe(1);
  });

  it('identifies checkpoints separately from local branches', () => {
    const ref = 'refs/copilot/checkpoints/session/one';
    const summary = buildCompactReferenceSummary([
      { decoration: ref, label: ref, kind: 'checkpoint' },
      { decoration: 'HEAD -> main', label: 'main', kind: 'head' },
    ]);

    expect(summary.label).toBe('main');
    expect(summary.hiddenCount).toBe(1);
    expect(buildCompactReferenceSummary([{ decoration: ref, label: ref, kind: 'checkpoint' }]).ariaLabel)
      .toContain('Copilot checkpoint');
  });
});

describe('buildReferenceGroups', () => {
  it('keeps canonical comma-containing original refs separate from lookalike branches', () => {
    const ref = 'refs/original/refs/heads/dev,backup';
    const references = [
      { decoration: `original: ${ref}`, label: ref, kind: 'original' as const },
      { decoration: ref, label: ref, kind: 'local' as const },
    ];
    const groups = buildReferenceGroups(references);
    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.locations[0].kind)).toEqual(['original', 'local']);
    expect(buildCompactReferenceSummary([references[0]]).ariaLabel).toContain('original reference');
  });

  it('places the current branch first and combines its local and remote locations', () => {
    const groups = buildReferenceGroups([
      { decoration: 'feature/a', label: 'feature/a', kind: 'local' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
      { decoration: 'HEAD -> main', label: 'main', kind: 'head' },
      { decoration: 'upstream/main', label: 'upstream/main', kind: 'remote' },
    ]);

    expect(groups.map((group) => group.label)).toEqual(['main', 'feature/a']);
    expect(groups[0].locations.map((location) => location.kind)).toEqual(['head', 'remote', 'remote']);
    expect(groups[0].locations.map((location) => location.remote)).toEqual([null, 'origin', 'upstream']);
  });

  it('keeps the active branch first while merging interleaved local and remote locations', () => {
    const groups = buildReferenceGroups([
      { decoration: 'HEAD -> dev', label: 'dev', kind: 'head' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
      { decoration: 'origin/dev', label: 'origin/dev', kind: 'remote' },
      { decoration: 'main', label: 'main', kind: 'local' },
    ]);

    expect(groups.map((group) => group.label)).toEqual(['dev', 'main']);
    expect(groups.map((group) => group.locations.map((location) => location.kind))).toEqual([
      ['head', 'remote'],
      ['local', 'remote'],
    ]);
  });

  it('merges disambiguated full reference names into one branch row', () => {
    const groups = buildReferenceGroups([
      { decoration: 'heads/main', label: 'heads/main', kind: 'local' },
      { decoration: 'remotes/origin/main', label: 'remotes/origin/main', kind: 'remote' },
      { decoration: 'refs/remotes/upstream/main', label: 'refs/remotes/upstream/main', kind: 'remote' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('main');
    expect(groups[0].locations.map((location) => location.remote)).toEqual([null, 'origin', 'upstream']);
  });

  it('does not combine tags with branches that share their label', () => {
    const groups = buildReferenceGroups([
      { decoration: 'main', label: 'main', kind: 'local' },
      { decoration: 'tag: main', label: 'main', kind: 'tag' },
    ]);

    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.key)).size).toBe(2);
    expect(groups.map((group) => group.locations[0].kind)).toEqual(['local', 'tag']);
  });

  it('keeps individual checkpoints separate when they point to the same commit', () => {
    const groups = buildReferenceGroups([
      { decoration: 'refs/copilot/checkpoints/session/one', label: 'checkpoint', kind: 'checkpoint' },
      { decoration: 'refs/copilot/checkpoints/session/two', label: 'checkpoint', kind: 'checkpoint' },
    ]);

    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.key)).size).toBe(2);
  });

  it('describes a shared branch as one branch across multiple locations', () => {
    const groups = buildReferenceGroups([
      { decoration: 'main', label: 'main', kind: 'local' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
      { decoration: 'upstream/main', label: 'upstream/main', kind: 'remote' },
    ]);

    expect(describeReferenceGroups(groups)).toBe('1 branch · 3 locations');
  });

  it('deduplicates repeated local and remote locations inside a branch row', () => {
    const groups = buildReferenceGroups([
      { decoration: 'main', label: 'main', kind: 'local' },
      { decoration: 'HEAD -> main', label: 'main', kind: 'head' },
      { decoration: 'origin/main', label: 'origin/main', kind: 'remote' },
      { decoration: 'origin/main-copy', label: 'origin/main', kind: 'remote' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('main');
    expect(groups[0].locations.map((location) => location.kind)).toEqual(['head', 'remote']);
  });
});
