export type TerminalTabNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';
export type TerminalShortcut = 'new' | 'close' | 'previous' | 'next';

export interface TerminalShortcutEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface TerminalTabScrollMetrics {
  containerStart: number;
  containerEnd: number;
  tabStart: number;
  tabEnd: number;
  scrollPosition: number;
  maximumScrollPosition: number;
}

export interface TerminalTabCloseState {
  readonly activeId: string | null;
  readonly remainingIds: string[];
}

export function terminalTabNavigationIndex(
  count: number,
  currentIndex: number,
  key: TerminalTabNavigationKey,
): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const index = currentIndex >= 0 && currentIndex < count ? currentIndex : 0;
  return key === 'ArrowLeft'
    ? (index - 1 + count) % count
    : (index + 1) % count;
}

export function terminalShortcutForEvent(event: TerminalShortcutEvent): TerminalShortcut | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    if (key === 't') return 'new';
    if (key === 'w') return 'close';
    return null;
  }
  if (event.key === 'PageUp') return 'previous';
  if (event.key === 'PageDown') return 'next';
  return null;
}

export function terminalTabScrollPosition(metrics: TerminalTabScrollMetrics): number | null {
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

export function terminalTabStateAfterClose(
  ids: readonly string[],
  activeId: string | null,
  closingId: string,
): TerminalTabCloseState {
  const closingIndex = ids.indexOf(closingId);
  if (closingIndex < 0) return { activeId, remainingIds: [...ids] };

  const remainingIds = ids.filter((id) => id !== closingId);
  if (activeId !== closingId && activeId !== null && remainingIds.includes(activeId)) {
    return { activeId, remainingIds };
  }

  return {
    activeId: remainingIds[Math.min(closingIndex, remainingIds.length - 1)] ?? null,
    remainingIds,
  };
}
