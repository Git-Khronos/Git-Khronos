export interface GraphColumnLayout {
  readonly firstLaneOffset: number;
  readonly laneGap: number;
  readonly defaultWidth: number;
}

export interface GraphSegmentGeometry {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly parentNodeRadius?: number;
  // Radius of the commit node a segment leaves from at its center (y1).
  readonly sourceNodeRadius?: number;
}

const EXPANDED_GRAPH_LAYOUT: GraphColumnLayout = {
  firstLaneOffset: 16,
  laneGap: 28,
  defaultWidth: 112,
};

const COMPACT_GRAPH_LAYOUT: GraphColumnLayout = {
  firstLaneOffset: 14,
  laneGap: 20,
  defaultWidth: 70,
};

// Expanded author nodes are 24px wide and the active HEAD ring extends another 4px.
// Keep both inside the graph column so they never cover the commit message.
const EXPANDED_GRAPH_NODE_TRAILING_CLEARANCE = 16;
const COMPACT_GRAPH_NODE_TRAILING_CLEARANCE = 14;
export const MINIMUM_GRAPH_COLUMN_WIDTH = 42;
export const MAXIMUM_PERSISTED_GRAPH_COLUMN_WIDTH = 4096;
export const GRAPH_LANE_COLOR_COUNT = 12;

export const COMPACT_AUTHOR_COLUMN_MAX_WIDTH = 76;
// Author and date are high-value scanning cues in a commit history. SHA stays
// optional because it is primarily useful for copy/paste and advanced review.
const DEFAULT_VISIBLE_GRAPH_COLUMNS = new Set(['branch', 'graph', 'message', 'author', 'date']);

export function isDefaultGraphColumnVisible(column: string): boolean {
  return DEFAULT_VISIBLE_GRAPH_COLUMNS.has(column);
}

export function graphColumnLayout(compact: boolean): GraphColumnLayout {
  return compact ? COMPACT_GRAPH_LAYOUT : EXPANDED_GRAPH_LAYOUT;
}

export function buildGraphSegmentPath(segment: GraphSegmentGeometry): string {
  if (segment.x1 === segment.x2) {
    return `M ${segment.x1} ${segment.y1} V ${segment.y2}`;
  }
  const direction = segment.y2 >= segment.y1 ? 1 : -1;
  const verticalDistance = Math.abs(segment.y2 - segment.y1);
  const horizontalDirection = segment.x2 > segment.x1 ? 1 : -1;
  if (segment.parentNodeRadius) {
    const attachmentX = segment.x2 - horizontalDirection * segment.parentNodeRadius;
    const radius = Math.min(
      segment.parentNodeRadius,
      Math.abs(segment.x1 - attachmentX),
      verticalDistance,
    );
    const arcStartY = segment.y2 - direction * radius;
    const arcEndX = segment.x1 + horizontalDirection * radius;
    const sweep = horizontalDirection < 0 ? 1 : 0;
    return `M ${segment.x1} ${segment.y1} V ${arcStartY} A ${radius} ${radius} 0 0 ${sweep} ${arcEndX} ${segment.y2} H ${attachmentX}`;
  }
  if (segment.sourceNodeRadius && direction > 0) {
    // A link to another lane leaves the node's side-middle edge facing that lane,
    // then curves down into the target lane so it arrives vertically.
    const exitX = segment.x1 + horizontalDirection * segment.sourceNodeRadius;
    const radius = Math.min(8, Math.abs(segment.x2 - exitX), segment.y2 - segment.y1);
    if (radius > 0 && Math.sign(segment.x2 - exitX) === horizontalDirection) {
      const sweep = horizontalDirection > 0 ? 1 : 0;
      return `M ${exitX} ${segment.y1} H ${segment.x2 - horizontalDirection * radius} A ${radius} ${radius} 0 0 ${sweep} ${segment.x2} ${segment.y1 + radius} V ${segment.y2}`;
    }
  }
  // Commit nodes are centered at y=20 with a 12px radius. Keep a straight
  // stem through the node so a branch visibly leaves its bottom center rather
  // than appearing to leak from one of the circle's lower corners.
  const departureLength = Math.min(segment.y1 === 20 ? 12 : 6, verticalDistance * 0.6);
  const departure = segment.y1 + direction * departureLength;
  // Leave and arrive vertically so a lane continues into the next row without a corner.
  const bendRadius = Math.min(
    8,
    Math.abs(segment.x2 - segment.x1) / 2,
    Math.abs(segment.y2 - departure) / 2,
  );
  const bridgeY = departure + direction * bendRadius;
  const departureBendX = segment.x1 + horizontalDirection * bendRadius;
  const arrivalBendX = segment.x2 - horizontalDirection * bendRadius;
  return `M ${segment.x1} ${segment.y1} V ${departure} Q ${segment.x1} ${bridgeY}, ${departureBendX} ${bridgeY} H ${arrivalBendX} Q ${segment.x2} ${bridgeY}, ${segment.x2} ${segment.y2}`;
}

export function graphLaneOffset(index: number, compact: boolean): number {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError('Graph lane index must be a non-negative integer');
  }
  const layout = graphColumnLayout(compact);
  return layout.firstLaneOffset + index * layout.laneGap;
}

export function graphLaneCapacity(width: number, compact: boolean): number {
  const layout = graphColumnLayout(compact);
  const trailingClearance = compact
    ? COMPACT_GRAPH_NODE_TRAILING_CLEARANCE
    : EXPANDED_GRAPH_NODE_TRAILING_CLEARANCE;
  const usableWidth = Number.isFinite(width)
    ? Math.max(0, width - layout.firstLaneOffset - trailingClearance)
    : 0;
  return Math.max(1, Math.floor(usableWidth / layout.laneGap) + 1);
}

export function boundedGraphLaneOffset(index: number, width: number, compact: boolean): number {
  const boundedIndex = Math.min(index, graphLaneCapacity(width, compact) - 1);
  return graphLaneOffset(boundedIndex, compact);
}

export function graphColumnWidthForLaneCount(laneCount: number, compact: boolean): number {
  const layout = graphColumnLayout(compact);
  const trailingClearance = compact
    ? COMPACT_GRAPH_NODE_TRAILING_CLEARANCE
    : EXPANDED_GRAPH_NODE_TRAILING_CLEARANCE;
  const lanes = Number.isFinite(laneCount) ? Math.max(1, Math.floor(laneCount)) : 1;
  const required = layout.firstLaneOffset + (lanes - 1) * layout.laneGap + trailingClearance;
  return Math.max(layout.defaultWidth, required);
}

export function normalizeGraphColumnWidth(width: number, compact: boolean, maximumWidth: number): number {
  if (!Number.isFinite(width)) return graphColumnLayout(compact).defaultWidth;
  const maximum = Number.isFinite(maximumWidth)
    ? Math.max(graphColumnLayout(compact).defaultWidth, maximumWidth)
    : graphColumnLayout(compact).defaultWidth;
  return Math.max(MINIMUM_GRAPH_COLUMN_WIDTH, Math.min(maximum, width));
}

export function requiredGraphLaneCount(
  commits: readonly { oid: string; parents: readonly string[] }[],
  seededOids: readonly string[] = [],
): number {
  let active = [...new Set(seededOids)];
  let maximum = Math.max(1, active.length);

  for (const commit of commits) {
    let lane = active.indexOf(commit.oid);
    if (lane < 0) {
      lane = active.length;
      active.push(commit.oid);
    }
    maximum = Math.max(maximum, active.length);

    const after = active.filter((_, index) => index !== lane);
    commit.parents.forEach((parent, parentIndex) => {
      if (after.includes(parent)) return;
      const insertion = Math.min(lane + Math.min(parentIndex, 1), after.length);
      after.splice(insertion, 0, parent);
    });
    active = after;
    maximum = Math.max(maximum, active.length);
  }

  return maximum;
}

export interface RequiredGraphLaneProgress {
  commits: readonly { oid: string; parents: readonly string[] }[];
  seedKey: string;
  active: string[];
  maximum: number;
}

/**
 * Incremental form of `requiredGraphLaneCount`: when `commits` only appended to the commits already
 * processed (same objects, same order), only the new tail is walked.
 */
export function advanceRequiredGraphLaneCount(
  progress: RequiredGraphLaneProgress | null,
  commits: readonly { oid: string; parents: readonly string[] }[],
  seededOids: readonly string[] = [],
): RequiredGraphLaneProgress {
  const seeds = [...new Set(seededOids)];
  const seedKey = seeds.join('\0');
  let start = 0;
  if (progress && progress.seedKey === seedKey && progress.commits.length <= commits.length) {
    start = progress.commits.length;
    for (let index = start - 1; index >= 0; index -= 1) {
      if (progress.commits[index] !== commits[index]) {
        start = 0;
        break;
      }
    }
  }
  let active = start ? [...progress!.active] : seeds;
  let maximum = start ? progress!.maximum : Math.max(1, active.length);
  for (let index = start; index < commits.length; index += 1) {
    const commit = commits[index];
    let lane = active.indexOf(commit.oid);
    if (lane < 0) {
      lane = active.length;
      active.push(commit.oid);
    }
    maximum = Math.max(maximum, active.length);
    const after = active.filter((_, candidate) => candidate !== lane);
    commit.parents.forEach((parent, parentIndex) => {
      if (after.includes(parent)) return;
      after.splice(Math.min(lane + Math.min(parentIndex, 1), after.length), 0, parent);
    });
    active = after;
    maximum = Math.max(maximum, active.length);
  }
  return { commits, seedKey, active, maximum };
}

export function isCompactAuthorColumn(width: number): boolean {
  return Number.isFinite(width) && width <= COMPACT_AUTHOR_COLUMN_MAX_WIDTH;
}

export function isAppendOnlyCommitHistory(
  previousOids: readonly string[],
  commits: readonly { oid: string }[],
): boolean {
  if (previousOids.length > commits.length) return false;
  return previousOids.every((oid, index) => commits[index]?.oid === oid);
}
