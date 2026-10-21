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

describe('graph column layout', () => {
  it('keeps same-lane history straight and sweeps cross-lane links counter-clockwise', () => {
    expect(buildGraphSegmentPath({ x1: 32, y1: 0, x2: 32, y2: 40 })).toBe('M 32 0 V 40');
    expect(buildGraphSegmentPath({ x1: 48, y1: 20, x2: 32, y2: 40 }))
      .toBe('M 48 20 V 32 Q 48 36, 44 36 H 36 Q 32 36, 32 40');
    expect(buildGraphSegmentPath({ x1: 32, y1: 20, x2: 48, y2: 40 }))
      .toBe('M 32 20 V 32 Q 32 36, 36 36 H 44 Q 48 36, 48 40');
  });

  it('turns every lane change with tangent-continuous curves and no sharp corners', () => {
    const lanes = [16, 44, 72, 100, 156];
    const starts: [number, number][] = [[0, 40], [20, 40], [0, 20]];
    for (const x1 of lanes) {
      for (const x2 of lanes) {
        if (x1 === x2) continue;
        for (const [y1, y2] of starts) {
          const path = buildGraphSegmentPath({ x1, y1, x2, y2 });
          expect(path, path).not.toMatch(/[LA]/);
          const match = path.match(
            /^M (\S+) (\S+) V (\S+) Q (\S+) (\S+), (\S+) (\S+) H (\S+) Q (\S+) (\S+), (\S+) (\S+)$/,
          );
          expect(match, path).not.toBeNull();
          const [, mx, , vy, q1x, q1y, b1x, b1y, hx, q2x, q2y, ex, ey] = match!.map(Number);
          // Vertical departure, then a curve whose control point keeps the departure tangent.
          expect(q1x).toBe(mx);
          expect(q1y).toBeGreaterThan(vy);
          // The curve ends horizontally, matching the horizontal bridge.
          expect(b1y).toBe(q1y);
          expect(q2y).toBe(b1y);
          expect(Math.sign(hx - b1x)).toBe(Math.sign(x2 - x1));
          // The second curve arrives vertically, so the lane continues straight into the next row.
          expect(q2x).toBe(ex);
          expect(ex).toBe(x2);
          expect(ey).toBe(y2);
        }
      }
    }
  });

  it('leaves the author node from the side facing the target lane', () => {
    expect(buildGraphSegmentPath({ x1: 16, y1: 20, x2: 44, y2: 40, sourceNodeRadius: 12 }))
      .toBe('M 28 20 H 32 A 12 12 0 0 1 44 32 V 40');
    expect(buildGraphSegmentPath({ x1: 44, y1: 20, x2: 16, y2: 40, sourceNodeRadius: 12 }))
      .toBe('M 32 20 H 28 A 12 12 0 0 0 16 32 V 40');
    expect(buildGraphSegmentPath({ x1: 14, y1: 20, x2: 34, y2: 40, sourceNodeRadius: 10 }))
      .toBe('M 24 20 H 24 A 10 10 0 0 1 34 30 V 40');
  });

  it('joins a converging branch at the parent author node side', () => {
    expect(buildGraphSegmentPath({ x1: 44, y1: 0, x2: 16, y2: 20, parentNodeRadius: 12 }))
      .toBe('M 44 0 V 8 A 12 12 0 0 1 32 20 H 28');
    expect(buildGraphSegmentPath({ x1: 14, y1: 0, x2: 34, y2: 20, parentNodeRadius: 10 }))
      .toBe('M 14 0 V 10 A 10 10 0 0 0 24 20 H 24');
  });

  it('preserves the expanded graph geometry', () => {
    expect(GRAPH_LANE_COLOR_COUNT).toBe(12);
    expect(graphColumnLayout(false)).toEqual({
      firstLaneOffset: 16,
      laneGap: 28,
      defaultWidth: 112,
    });
    expect([0, 1, 2].map((lane) => graphLaneOffset(lane, false))).toEqual([16, 44, 72]);
  });

  it('compresses lane spacing and the preferred column width', () => {
    expect(graphColumnLayout(true)).toEqual({
      firstLaneOffset: 14,
      laneGap: 20,
      defaultWidth: 70,
    });
    expect([0, 1, 2].map((lane) => graphLaneOffset(lane, true))).toEqual([14, 34, 54]);
  });

  it('bounds active lanes to the graph column that can be displayed', () => {
    expect(graphLaneCapacity(112, false)).toBe(3);
    expect(graphLaneCapacity(110, true)).toBe(5);
    expect(graphLaneCapacity(10_000, false)).toBe(357);
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
    expect(boundedGraphLaneOffset(4, 70, true)).toBe(54);
    expect(boundedGraphLaneOffset(20, 70, true)).toBe(54);
    expect(boundedGraphLaneOffset(20, 112, false)).toBe(72);
  });

  it('sizes and normalizes the graph column for every active lane', () => {
    const expandedMaximum = graphColumnWidthForLaneCount(40, false);
    const compactMaximum = graphColumnWidthForLaneCount(40, true);

    expect(expandedMaximum).toBe(1124);
    expect(compactMaximum).toBe(808);
    expect(graphLaneCapacity(expandedMaximum, false)).toBe(40);
    expect(graphLaneCapacity(compactMaximum, true)).toBe(40);
    expect(normalizeGraphColumnWidth(1, false, expandedMaximum)).toBe(42);
    expect(normalizeGraphColumnWidth(500, false, expandedMaximum)).toBe(500);
    expect(normalizeGraphColumnWidth(800, false, expandedMaximum)).toBe(800);
    expect(normalizeGraphColumnWidth(1_200, false, expandedMaximum)).toBe(expandedMaximum);
    expect(normalizeGraphColumnWidth(8_000, false, MAXIMUM_PERSISTED_GRAPH_COLUMN_WIDTH)).toBe(4096);
    expect(normalizeGraphColumnWidth(Number.NaN, true, compactMaximum)).toBe(70);
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
