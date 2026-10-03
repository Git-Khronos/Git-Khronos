export function graphScrollMarkerPosition(
  rowTop: number,
  rowHeight: number,
  totalHeight: number,
): number {
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) return 50;
  const center = Math.max(0, rowTop) + Math.max(0, rowHeight) / 2;
  return Math.max(1, Math.min(99, center / totalHeight * 100));
}

export function sampleGraphMarkers<T>(items: readonly T[], limit: number): T[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (!safeLimit) return [];
  if (items.length <= safeLimit) return [...items];
  if (safeLimit === 1) return [items[0]];
  return Array.from({ length: safeLimit }, (_, index) =>
    items[Math.round(index * (items.length - 1) / (safeLimit - 1))]
  );
}
