export interface VirtualWindow<T> {
  items: T[];
  topPadding: number;
  bottomPadding: number;
}

export function calculateVirtualWindow<T>(
  items: readonly T[],
  scrollTop: number,
  viewportHeight: number,
  itemHeight: number,
  leadingHeight = 0,
  overscan = 0,
): VirtualWindow<T> {
  if (!items.length) return { items: [], topPadding: 0, bottomPadding: 0 };
  if (itemHeight <= 0) throw new RangeError('itemHeight must be greater than zero');

  const safeViewportHeight = Math.max(itemHeight, viewportHeight);
  const availableScroll = Math.max(0, items.length * itemHeight - safeViewportHeight);
  const relativeScroll = Math.min(Math.max(0, scrollTop - leadingHeight), availableScroll);
  const firstVisible = Math.floor(relativeScroll / itemHeight);
  const visibleCount = Math.ceil(safeViewportHeight / itemHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const start = Math.max(0, firstVisible - safeOverscan);
  const end = Math.min(items.length, firstVisible + visibleCount + safeOverscan);

  return {
    items: items.slice(start, end),
    topPadding: start * itemHeight,
    bottomPadding: (items.length - end) * itemHeight,
  };
}
