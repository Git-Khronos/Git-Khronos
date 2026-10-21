export function reorderRepositoryTabs<T extends { id: string }>(
  repositories: readonly T[],
  sourceId: string,
  targetId: string,
): readonly T[] {
  if (sourceId === targetId) return repositories;
  const sourceIndex = repositories.findIndex((repository) => repository.id === sourceId);
  const targetIndex = repositories.findIndex((repository) => repository.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return repositories;

  const reordered = [...repositories];
  const [source] = reordered.splice(sourceIndex, 1);
  // Keeping the original target index places rightward moves after the target
  // and leftward moves before it, matching the displayed insertion marker.
  reordered.splice(targetIndex, 0, source);
  return reordered;
}

export function repositoryTabDropEdge(
  repositoryIds: readonly string[],
  sourceId: string,
  targetId: string,
): 'before' | 'after' | null {
  const sourceIndex = repositoryIds.indexOf(sourceId);
  const targetIndex = repositoryIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
  return sourceIndex < targetIndex ? 'after' : 'before';
}

export interface RepositoryTabScrollMetrics {
  containerStart: number;
  containerEnd: number;
  tabStart: number;
  tabEnd: number;
  scrollPosition: number;
  maximumScrollPosition: number;
}

export interface RepositoryTabStripMetrics {
  scrollPosition: number;
  viewportWidth: number;
  contentWidth: number;
}

export interface RepositoryTabOverflowState {
  overflowing: boolean;
  canScrollBack: boolean;
  canScrollForward: boolean;
}

export function repositoryTabScrollPosition(metrics: RepositoryTabScrollMetrics): number | null {
  let target = metrics.scrollPosition;
  if (metrics.tabStart < metrics.containerStart) {
    target -= metrics.containerStart - metrics.tabStart;
  } else if (metrics.tabEnd > metrics.containerEnd) {
    target += metrics.tabEnd - metrics.containerEnd;
  } else {
    return null;
  }
  return Math.max(0, Math.min(metrics.maximumScrollPosition, target));
}

export function repositoryTabOverflowState(metrics: RepositoryTabStripMetrics): RepositoryTabOverflowState {
  const tolerance = 1;
  const maximumScrollPosition = Math.max(0, metrics.contentWidth - metrics.viewportWidth);
  const overflowing = maximumScrollPosition > tolerance;
  return {
    overflowing,
    canScrollBack: overflowing && metrics.scrollPosition > tolerance,
    canScrollForward: overflowing && metrics.scrollPosition < maximumScrollPosition - tolerance,
  };
}
