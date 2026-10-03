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
