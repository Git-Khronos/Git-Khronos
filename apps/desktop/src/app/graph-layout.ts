export interface GraphColumnLayout {
  readonly firstLaneOffset: number;
  readonly laneGap: number;
  readonly defaultWidth: number;
}

export interface GraphNodeConnection {
  readonly sourceOffset: number;
  readonly parentOffset: number;
  readonly nodeRadius: number;
  readonly part: 'source' | 'parent';
  // Another lane continues straight through the source column, so the stem
  // runs beside it instead of on top of it.
  readonly sharedColumn?: boolean;
}

export interface GraphSegmentGeometry {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly parentNodeRadius?: number;
  // Radius of the commit node a segment leaves from at its center (y1).
  readonly sourceNodeRadius?: number;
  readonly nodeConnection?: GraphNodeConnection;
  readonly bypassNode?: { readonly offset: number; readonly radius: number };
  readonly horizontalTrack?: { readonly y: number; readonly strokeWidth: number };
}

const EXPANDED_GRAPH_LAYOUT: GraphColumnLayout = {
  firstLaneOffset: 16,
  laneGap: 40,
  defaultWidth: 112,
};

const COMPACT_GRAPH_LAYOUT: GraphColumnLayout = {
  firstLaneOffset: 14,
  laneGap: 32,
  defaultWidth: 92,
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

type GraphPoint = readonly [number, number];

// Matches the spacing between stacked horizontal tracks.
const GRAPH_STACKED_EDGE_SPACING = 4;
const GRAPH_EDGE_CORNER_RADIUS = 10;

export function graphNodeConnectionStemOffset(
  connection: Pick<GraphNodeConnection, 'sourceOffset' | 'parentOffset' | 'nodeRadius' | 'sharedColumn'>,
): number {
  if (!connection.sharedColumn) return connection.sourceOffset;
  return connection.sourceOffset
    + Math.sign(connection.parentOffset - connection.sourceOffset) * GRAPH_STACKED_EDGE_SPACING;
}

// Round only the corners of an orthogonal route, never its straight stems.
// Sharing short interior segments equally prevents adjacent bends overlapping.
function roundedGraphRoute(points: readonly GraphPoint[]): string {
  const route: GraphPoint[] = [];
  for (const point of points) {
    const last = route.at(-1), previous = route.at(-2);
    if (last && point[0] === last[0] && point[1] === last[1]) continue;
    if (last && previous && (
      (point[0] === last[0] && last[0] === previous[0]
        && Math.sign(point[1] - last[1]) === Math.sign(last[1] - previous[1]))
      || (point[1] === last[1] && last[1] === previous[1]
        && Math.sign(point[0] - last[0]) === Math.sign(last[0] - previous[0]))
    )) route.pop();
    route.push(point);
  }
  let path = `M ${route[0][0]} ${route[0][1]}`;
  let cursor = route[0];
  const lineTo = (point: GraphPoint) => {
    if (point[0] === cursor[0] && point[1] === cursor[1]) return;
    path += point[0] === cursor[0] ? ` V ${point[1]}` : ` H ${point[0]}`;
    cursor = point;
  };
  for (let index = 1; index < route.length - 1; index++) {
    const previous = route[index - 1], corner = route[index], next = route[index + 1];
    const incoming = [Math.sign(corner[0] - previous[0]), Math.sign(corner[1] - previous[1])];
    const outgoing = [Math.sign(next[0] - corner[0]), Math.sign(next[1] - corner[1])];
    const radius = Math.min(GRAPH_EDGE_CORNER_RADIUS,
      (Math.abs(corner[0] - previous[0]) + Math.abs(corner[1] - previous[1])) / (index === 1 ? 1 : 2),
      (Math.abs(next[0] - corner[0]) + Math.abs(next[1] - corner[1])) / (index === route.length - 2 ? 1 : 2));
    lineTo([corner[0] - incoming[0] * radius, corner[1] - incoming[1] * radius]);
    const end: GraphPoint = [corner[0] + outgoing[0] * radius, corner[1] + outgoing[1] * radius];
    const sweep = incoming[0] * outgoing[1] - incoming[1] * outgoing[0] > 0 ? 1 : 0;
    path += ` A ${radius} ${radius} 0 0 ${sweep} ${end[0]} ${end[1]}`;
    cursor = end;
  }
  lineTo(route[route.length - 1]);
  return path;
}

interface GraphHorizontalSpan {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly y: number;
  readonly kind: 'incoming' | 'outgoing' | 'bypass';
  readonly nodeRadius?: number;
  readonly from: number;
  readonly to: number;
}

function graphHorizontalSpan(segment: GraphSegmentGeometry, index: number): GraphHorizontalSpan | null {
  let start: number, end: number, y: number;
  let kind: GraphHorizontalSpan['kind'];
  let nodeRadius: number | undefined;
  if (segment.nodeConnection) {
    const { sourceOffset, parentOffset, nodeRadius: radius, part } = segment.nodeConnection;
    if (part === 'source' || sourceOffset === parentOffset) return null;
    start = graphNodeConnectionStemOffset(segment.nodeConnection);
    end = parentOffset - Math.sign(parentOffset - sourceOffset) * radius;
    y = 20;
    kind = 'incoming';
    nodeRadius = radius;
  } else if (segment.x1 === segment.x2) {
    return null;
  } else if (segment.bypassNode) {
    const { offset, radius } = segment.bypassNode;
    start = segment.x1;
    end = segment.x2;
    y = segment.x1 === offset ? 20 - radius - 2 : 20 + radius + 2;
    kind = 'bypass';
  } else if (segment.parentNodeRadius && segment.y2 === 20) {
    start = segment.x1;
    end = segment.x2 - Math.sign(segment.x2 - segment.x1) * segment.parentNodeRadius;
    y = segment.y2;
    kind = 'incoming';
    nodeRadius = segment.parentNodeRadius;
  } else if (segment.sourceNodeRadius && segment.y1 === 20 && segment.y2 > segment.y1) {
    const direction = Math.sign(segment.x2 - segment.x1);
    start = segment.x1 + direction * segment.sourceNodeRadius;
    end = segment.x2;
    if (Math.sign(end - start) !== direction) return null;
    y = segment.y1;
    kind = 'outgoing';
    nodeRadius = segment.sourceNodeRadius;
  } else {
    return null;
  }
  return {
    index, start: Math.min(start, end), end: Math.max(start, end), y, kind, nodeRadius,
    from: segment.x1, to: segment.x2,
  };
}

function graphSpansOverlap(a: GraphHorizontalSpan, b: GraphHorizontalSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function assignBypassTrackSlots(group: readonly GraphHorizontalSpan[]): number[] {
  const occupied = new Map<number, GraphHorizontalSpan[]>();
  return group.map((span) => {
    let slot = 0;
    while (occupied.get(slot)?.some((other) => graphSpansOverlap(span, other))) slot++;
    const onTrack = occupied.get(slot) ?? [];
    onTrack.push(span);
    occupied.set(slot, onTrack);
    return slot;
  });
}

export function stackOverlappingGraphEdges<T extends GraphSegmentGeometry>(segments: T[]): T[] {
  const spans = segments.flatMap((segment, index) => {
    const span = graphHorizontalSpan(segment, index);
    return span ? [span] : [];
  });
  if (spans.length < 2) return segments;
  const byHeight = new Map<number, GraphHorizontalSpan[]>();
  for (const span of spans) {
    const sameHeight = byHeight.get(span.y) ?? [];
    sameHeight.push(span);
    byHeight.set(span.y, sameHeight);
  }
  const tracks = new Map<number, NonNullable<GraphSegmentGeometry['horizontalTrack']>>();
  for (const [height, sameHeight] of byHeight) {
    sameHeight.sort((a, b) => a.start - b.start);
    for (let first = 0; first < sameHeight.length;) {
      let end = first + 1;
      let right = sameHeight[first].end;
      while (end < sameHeight.length && sameHeight[end].start < right) {
        right = Math.max(right, sameHeight[end].end);
        end++;
      }
      if (end - first > 1) {
        const group = sameHeight.slice(first, end);
        let minY = 2, maxY = 38;
        if (height === 20) {
          const radius = Math.min(...group.map((span) => span.nodeRadius!));
          const inset = Math.min(1, radius / 2);
          minY = Math.max(minY, height - radius + inset);
          maxY = Math.min(maxY, height + radius - inset);
          for (const span of spans) {
            if (span.kind !== 'bypass' || span.start >= right || span.end <= group[0].start) continue;
            if (span.y < height) minY = Math.max(minY, span.y + 3);
            if (span.y > height) maxY = Math.min(maxY, span.y - 3);
          }
          // Nearby incoming lanes belong above distant ones; outgoing lanes use
          // the reverse order so their vertical stems do not cross the stack.
          group.sort((a, b) => {
            const kindOrder = (a.kind === 'incoming' ? 0 : 1) - (b.kind === 'incoming' ? 0 : 1);
            const lengthOrder = (a.end - a.start) - (b.end - b.start);
            return kindOrder || (a.kind === 'incoming' ? lengthOrder : -lengthOrder) || a.index - b.index;
          });
          const slots: number[] = [];
          for (const span of group) {
            let slot = 0;
            for (let index = 0; index < slots.length; index++) {
              if (graphSpansOverlap(span, group[index])) slot = Math.max(slot, slots[index] + 1);
            }
            slots.push(slot);
          }
          const lastSlot = Math.max(...slots);
          const available = Math.min(height - minY, maxY - height);
          const spacing = Math.min(4, available * 2 / lastSlot);
          const strokeWidth = Math.min(2, spacing * 0.7);
          group.forEach((span, index) => tracks.set(span.index, {
            y: height + (slots[index] - lastSlot / 2) * spacing, strokeWidth,
          }));
        } else {
          const direction = height < 20 ? -1 : 1;
          const available = direction < 0 ? height - minY : maxY - height;
          const movement = Math.sign(group[0].to - group[0].from);
          if (group.every((span) => Math.sign(span.to - span.from) === movement)) {
            group.sort((a, b) => -movement * direction * (a.from - b.from || a.to - b.to));
          }
          const slots = assignBypassTrackSlots(group);
          const spacing = Math.min(4, available / Math.max(...slots));
          const strokeWidth = Math.min(2, spacing * 0.7);
          group.forEach((span, index) => tracks.set(span.index, {
            y: height + direction * slots[index] * spacing, strokeWidth,
          }));
        }
      }
      first = end;
    }
  }
  if (!tracks.size) return segments;
  return segments.map((segment, index) => {
    const horizontalTrack = tracks.get(index);
    return horizontalTrack ? { ...segment, horizontalTrack } : segment;
  });
}

function graphNodeSideOffset(nodeX: number, nodeY: number, radius: number, side: number, trackY: number): number {
  const verticalOffset = trackY - nodeY;
  return nodeX + side * Math.sqrt(Math.max(0, radius * radius - verticalOffset * verticalOffset));
}

export function buildGraphSegmentPath(segment: GraphSegmentGeometry): string {
  if (segment.nodeConnection) {
    const { sourceOffset, parentOffset, nodeRadius, part } = segment.nodeConnection;
    const direction = Math.sign(parentOffset - sourceOffset);
    const sourceSide = graphNodeConnectionStemOffset(segment.nodeConnection);
    const trackY = segment.horizontalTrack?.y ?? 20;
    const parentSide = graphNodeSideOffset(parentOffset, 20, nodeRadius, -direction, trackY);
    return part === 'source'
      ? roundedGraphRoute([[sourceSide, 20 + Math.sqrt(Math.max(0,
        nodeRadius * nodeRadius - (sourceSide - sourceOffset) ** 2))], [sourceSide, 40]])
      : roundedGraphRoute([[sourceSide, 0], [sourceSide, trackY], [parentSide, trackY]]);
  }
  if (segment.x1 === segment.x2) {
    return `M ${segment.x1} ${segment.y1} V ${segment.y2}`;
  }
  const direction = segment.y2 >= segment.y1 ? 1 : -1;
  const verticalDistance = Math.abs(segment.y2 - segment.y1);
  const horizontalDirection = segment.x2 > segment.x1 ? 1 : -1;
  if (segment.bypassNode) {
    // A continuing lane is not an edge to this commit. Move away above the
    // circle when leaving its column, or cross below it when entering/crossing.
    const { offset, radius: nodeRadius } = segment.bypassNode;
    const bridgeY = segment.horizontalTrack?.y
      ?? (segment.x1 === offset ? 20 - nodeRadius - 2 : 20 + nodeRadius + 2);
    return roundedGraphRoute([[segment.x1, segment.y1], [segment.x1, bridgeY], [segment.x2, bridgeY], [segment.x2, segment.y2]]);
  }
  if (segment.parentNodeRadius) {
    const trackY = segment.horizontalTrack?.y ?? segment.y2;
    const attachmentX = graphNodeSideOffset(segment.x2, segment.y2, segment.parentNodeRadius,
      -horizontalDirection, trackY);
    return roundedGraphRoute([[segment.x1, segment.y1], [segment.x1, trackY], [attachmentX, trackY]]);
  }
  if (segment.sourceNodeRadius && direction > 0) {
    // Depart horizontally from the avatar, then turn into the target lane.
    const trackY = segment.horizontalTrack?.y ?? segment.y1;
    const exitX = graphNodeSideOffset(segment.x1, segment.y1, segment.sourceNodeRadius,
      horizontalDirection, trackY);
    if (Math.sign(segment.x2 - exitX) === horizontalDirection) {
      return roundedGraphRoute([[exitX, trackY], [segment.x2, trackY], [segment.x2, segment.y2]]);
    }
  }
  // Commit nodes are centered at y=20 with a 12px radius. Keep a straight
  // stem through the node so a branch visibly leaves its bottom center rather
  // than appearing to leak from one of the circle's lower corners.
  const departureLength = Math.min(segment.y1 === 20 ? 12 : 6, verticalDistance * 0.6);
  const departure = segment.y1 + direction * departureLength;
  const bridgeY = (departure + segment.y2) / 2;
  return roundedGraphRoute([[segment.x1, segment.y1], [segment.x1, bridgeY], [segment.x2, bridgeY], [segment.x2, segment.y2]]);
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
