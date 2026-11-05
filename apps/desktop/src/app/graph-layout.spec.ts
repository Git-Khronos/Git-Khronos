import { describe, expect, it } from 'vitest';
import {
  advanceRequiredGraphLaneCount,
  boundedGraphLaneOffset,
  buildGraphSegmentPath,
  graphColumnWidthForLaneCount,
  graphColumnLayout,
  GRAPH_LANE_COLOR_COUNT,
  graphLaneCapacity,
  graphLaneOffset,
  isAppendOnlyCommitHistory,
  isCompactAuthorColumn,
  isDefaultGraphColumnVisible,
  MAXIMUM_PERSISTED_GRAPH_COLUMN_WIDTH,
  normalizeGraphColumnWidth,
  requiredGraphLaneCount,
} from './graph-layout';

function inspectRoundedPath(path: string) {
  const tokens = path.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g)!;
  let x = 0, y = 0, start: number[] = [], arcs = 0;
  while (tokens.length) {
    const command = tokens.shift();
    if (command === 'M') { x = Number(tokens.shift()); y = Number(tokens.shift()); start = [x, y]; }
    else if (command === 'H') x = Number(tokens.shift());
    else if (command === 'V') y = Number(tokens.shift());
    else {
      expect(command, path).toBe('A');
      const [rx, ry, rotation, large, sweep, endX, endY] = tokens.splice(0, 7).map(Number);
      expect(rx).toBeGreaterThan(0);
      expect(rx).toBeLessThanOrEqual(6);
      expect([ry, rotation, large]).toEqual([rx, 0, 0]);
      expect([0, 1]).toContain(sweep);
      expect([Math.abs(endX - x), Math.abs(endY - y)], path).toEqual([rx, rx]);
      x = endX; y = endY; arcs++;
    }
  }
  return { start, end: [x, y], arcs };
}

describe('graph column layout', () => {
  it('routes cross-lane parent links from the source bottom center into the parent side', () => {
    for (const nodeRadius of [10, 12]) {
      for (const [sourceOffset, parentOffset] of [[14, 46], [46, 14], [16, 56], [56, 16], [16, 136], [136, 16]]) {
        if (Math.abs(parentOffset - sourceOffset) < nodeRadius * 2 + 12) continue;
        const connection = { sourceOffset, parentOffset, nodeRadius };
        const direction = Math.sign(parentOffset - sourceOffset);
        const sourceSide = sourceOffset;
        const parentSide = parentOffset - direction * nodeRadius;
        const sourcePath = buildGraphSegmentPath({ x1: sourceOffset, y1: 20, x2: sourceSide, y2: 40,
          nodeConnection: { ...connection, part: 'source' } });
        const parentPath = buildGraphSegmentPath({ x1: sourceSide, y1: 0, x2: parentOffset, y2: 20,
          nodeConnection: { ...connection, part: 'parent' } });
        const source = inspectRoundedPath(sourcePath), parent = inspectRoundedPath(parentPath);
        expect(source.start).toEqual([sourceSide, 20 + nodeRadius]);
        expect(parent.end).toEqual([parentSide, 20]);
        expect(source.end).toEqual([sourceSide, 40]);
        expect(parent.start).toEqual([sourceSide, 0]);
        expect([source.arcs, parent.arcs]).toEqual([0, 1]);
      }
    }
  });

  it('routes a right-to-left history edge down the source bottom center before turning into its parent', () => {
    const connection = { sourceOffset: 56, parentOffset: 16, nodeRadius: 12 };
    expect(buildGraphSegmentPath({
      x1: 56, y1: 20, x2: 56, y2: 40,
      nodeConnection: { ...connection, part: 'source' },
    })).toBe('M 56 32 V 40');
    expect(buildGraphSegmentPath({
      x1: 56, y1: 0, x2: 16, y2: 20,
      nodeConnection: { ...connection, part: 'parent' },
    })).toBe('M 56 0 V 14 A 6 6 0 0 1 50 20 H 28');
  });

  it('routes continuing lane changes outside an unrelated avatar', () => {
    expect(buildGraphSegmentPath({ x1: 44, y1: 0, x2: 16, y2: 40,
      bypassNode: { offset: 16, radius: 12 } }))
      .toBe('M 44 0 V 28 A 6 6 0 0 1 38 34 H 22 A 6 6 0 0 0 16 40');
    expect(buildGraphSegmentPath({ x1: 16, y1: 0, x2: 44, y2: 40,
      bypassNode: { offset: 16, radius: 12 } }))
      .toBe('M 16 0 A 6 6 0 0 0 22 6 H 38 A 6 6 0 0 1 44 12 V 40');
  });

  it('keeps same-lane history straight and turns cross-lane links at right angles', () => {
    expect(buildGraphSegmentPath({ x1: 32, y1: 0, x2: 32, y2: 40 })).toBe('M 32 0 V 40');
    expect(buildGraphSegmentPath({ x1: 48, y1: 20, x2: 32, y2: 40 }))
      .toBe('M 48 20 V 30 A 6 6 0 0 1 42 36 H 36 A 4 4 0 0 0 32 40');
    expect(buildGraphSegmentPath({ x1: 32, y1: 20, x2: 48, y2: 40 }))
      .toBe('M 32 20 V 30 A 6 6 0 0 0 38 36 H 44 A 4 4 0 0 1 48 40');
  });

  it('uses straight orthogonal stems and circular quarter turns, including reverse traversal', () => {
    const lanes = [16, 44, 72, 100, 156];
    const starts: [number, number][] = [[0, 40], [20, 40], [0, 20], [40, 0], [20, 0]];
    for (const x1 of lanes) {
      for (const x2 of lanes) {
        if (x1 === x2) continue;
        for (const [y1, y2] of starts) {
          const path = buildGraphSegmentPath({ x1, y1, x2, y2 });
          const geometry = inspectRoundedPath(path);
          expect(geometry.start).toEqual([x1, y1]);
          expect(geometry.end).toEqual([x2, y2]);
          expect(geometry.arcs).toBe(2);
        }
      }
    }
  });

  it('leaves the author node from the side facing the target lane', () => {
    expect(buildGraphSegmentPath({ x1: 16, y1: 20, x2: 44, y2: 40, sourceNodeRadius: 12 }))
      .toBe('M 28 20 H 38 A 6 6 0 0 1 44 26 V 40');
    expect(buildGraphSegmentPath({ x1: 44, y1: 20, x2: 16, y2: 40, sourceNodeRadius: 12 }))
      .toBe('M 32 20 H 22 A 6 6 0 0 0 16 26 V 40');
    expect(buildGraphSegmentPath({ x1: 14, y1: 20, x2: 34, y2: 40, sourceNodeRadius: 10 }))
      .toBe('M 24 20 H 28 A 6 6 0 0 1 34 26 V 40');
  });

  it('joins a converging branch at the parent author node side', () => {
    expect(buildGraphSegmentPath({ x1: 44, y1: 0, x2: 16, y2: 20, parentNodeRadius: 12 }))
      .toBe('M 44 0 V 14 A 6 6 0 0 1 38 20 H 28');
    expect(buildGraphSegmentPath({ x1: 14, y1: 0, x2: 34, y2: 20, parentNodeRadius: 10 }))
      .toBe('M 14 0 V 14 A 6 6 0 0 0 20 20 H 24');
  });

  it('gives expanded avatars room for a rounded side connection', () => {
    expect(GRAPH_LANE_COLOR_COUNT).toBe(12);
    expect(graphColumnLayout(false)).toEqual({
      firstLaneOffset: 16,
      laneGap: 40,
      defaultWidth: 112,
    });
    expect([0, 1, 2].map((lane) => graphLaneOffset(lane, false))).toEqual([16, 56, 96]);
  });

  it('compresses lane spacing and the preferred column width', () => {
    expect(graphColumnLayout(true)).toEqual({
      firstLaneOffset: 14,
      laneGap: 32,
      defaultWidth: 92,
    });
    expect([0, 1, 2].map((lane) => graphLaneOffset(lane, true))).toEqual([14, 46, 78]);
  });

  it('bounds active lanes to the graph column that can be displayed', () => {
    expect(graphLaneCapacity(112, false)).toBe(3);
    expect(graphLaneCapacity(110, true)).toBe(3);
    expect(graphLaneCapacity(10_000, false)).toBe(250);
    expect(graphLaneCapacity(Number.NaN, false)).toBe(1);
  });

  it('keeps the final author node clear of the commit message column', () => {
    const expandedAuthorNodeRadius = 12;
    const compactAuthorNodeRadius = 10;
    const expandedCapacity = graphLaneCapacity(112, false);
    const compactCapacity = graphLaneCapacity(70, true);

    expect(graphLaneOffset(expandedCapacity - 1, false) + expandedAuthorNodeRadius).toBeLessThanOrEqual(108);
    expect(graphLaneOffset(compactCapacity - 1, true) + compactAuthorNodeRadius).toBeLessThanOrEqual(66);
    expect(graphLaneOffset(0, false) - expandedAuthorNodeRadius).toBeGreaterThanOrEqual(4);
    expect(graphLaneOffset(0, true) - compactAuthorNodeRadius).toBeGreaterThanOrEqual(4);
  });

  it('folds excess WIP lanes into the last visible graph lane', () => {
    expect(boundedGraphLaneOffset(0, 70, true)).toBe(14);
    expect(boundedGraphLaneOffset(4, 70, true)).toBe(46);
    expect(boundedGraphLaneOffset(20, 70, true)).toBe(46);
    expect(boundedGraphLaneOffset(20, 112, false)).toBe(96);
  });

  it('sizes and normalizes the graph column for every active lane', () => {
    const expandedMaximum = graphColumnWidthForLaneCount(40, false);
    const compactMaximum = graphColumnWidthForLaneCount(40, true);

    expect(expandedMaximum).toBe(1592);
    expect(compactMaximum).toBe(1276);
    expect(graphLaneCapacity(expandedMaximum, false)).toBe(40);
    expect(graphLaneCapacity(compactMaximum, true)).toBe(40);
    expect(normalizeGraphColumnWidth(1, false, expandedMaximum)).toBe(42);
    expect(normalizeGraphColumnWidth(500, false, expandedMaximum)).toBe(500);
    expect(normalizeGraphColumnWidth(800, false, expandedMaximum)).toBe(800);
    expect(normalizeGraphColumnWidth(2_000, false, expandedMaximum)).toBe(expandedMaximum);
    expect(normalizeGraphColumnWidth(8_000, false, MAXIMUM_PERSISTED_GRAPH_COLUMN_WIDTH)).toBe(4096);
    expect(normalizeGraphColumnWidth(Number.NaN, true, compactMaximum)).toBe(92);
  });

  it('measures the peak topology width without dropping branch paths', () => {
    expect(requiredGraphLaneCount([
      { oid: 'merge', parents: ['left', 'right'] },
      { oid: 'left', parents: ['base'] },
      { oid: 'right', parents: ['base'] },
      { oid: 'base', parents: [] },
    ])).toBe(2);
    expect(requiredGraphLaneCount([
      { oid: 'main', parents: ['base'] },
      { oid: 'side', parents: ['base'] },
      { oid: 'base', parents: [] },
    ], ['main', 'side', 'linked-worktree'])).toBe(3);
  });

  it('rejects invalid lane indexes', () => {
    expect(() => graphLaneOffset(-1, true)).toThrow(RangeError);
    expect(() => graphLaneOffset(1.5, false)).toThrow(RangeError);
  });

  it('uses avatars only at compact author widths', () => {
    expect(isCompactAuthorColumn(76)).toBe(true);
    expect(isCompactAuthorColumn(77)).toBe(false);
    expect(isCompactAuthorColumn(Number.NaN)).toBe(false);
  });

  it('starts with commit identity and time while keeping SHA optional', () => {
    expect(['branch', 'graph', 'message', 'author', 'date'].every(isDefaultGraphColumnVisible)).toBe(true);
    expect(isDefaultGraphColumnVisible('sha')).toBe(false);
  });

  it('recognizes history pages that only extend the existing graph', () => {
    expect(isAppendOnlyCommitHistory(['a', 'b'], [{ oid: 'a' }, { oid: 'b' }, { oid: 'c' }])).toBe(true);
    expect(isAppendOnlyCommitHistory(['a', 'b'], [{ oid: 'a' }, { oid: 'c' }])).toBe(false);
    expect(isAppendOnlyCommitHistory(['a', 'b'], [{ oid: 'a' }])).toBe(false);
  });

  it('extends the required lane count page by page with the same result as a full walk', () => {
    const commits = Array.from({ length: 600 }, (_, index) => ({
      oid: `c${index}`,
      parents: index % 5 === 0 ? [`c${index + 1}`, `c${index + 4}`] : [`c${index + 1}`],
    }));
    let progress = null as ReturnType<typeof advanceRequiredGraphLaneCount> | null;
    for (let size = 100; size <= commits.length; size += 100) {
      const page = commits.slice(0, size);
      const previous = progress;
      progress = advanceRequiredGraphLaneCount(progress, page, ['c0']);
      expect(progress.maximum).toBe(requiredGraphLaneCount(page, ['c0']));
      if (previous) expect(progress.maximum).toBeGreaterThanOrEqual(previous.maximum);
    }
    const rewritten = [{ oid: 'x', parents: ['c0'] }, ...commits.slice(0, 50)];
    expect(advanceRequiredGraphLaneCount(progress, rewritten).maximum).toBe(requiredGraphLaneCount(rewritten));
  });
});
