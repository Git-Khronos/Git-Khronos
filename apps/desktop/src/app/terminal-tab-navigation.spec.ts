import { describe, expect, it } from 'vitest';
import {
  terminalShortcutForEvent,
  terminalTabNavigationIndex,
  terminalTabScrollPosition,
  terminalTabStateAfterClose,
} from './terminal-tab-navigation';

describe('terminal tab keyboard navigation', () => {
  it('moves in either direction and wraps at both boundaries', () => {
    expect(terminalTabNavigationIndex(3, 1, 'ArrowLeft')).toBe(0);
    expect(terminalTabNavigationIndex(3, 1, 'ArrowRight')).toBe(2);
    expect(terminalTabNavigationIndex(3, 0, 'ArrowLeft')).toBe(2);
    expect(terminalTabNavigationIndex(3, 2, 'ArrowRight')).toBe(0);
  });

  it('moves directly to the first or last tab', () => {
    expect(terminalTabNavigationIndex(4, 2, 'Home')).toBe(0);
    expect(terminalTabNavigationIndex(4, 1, 'End')).toBe(3);
  });

  it('handles missing selections and empty tab lists safely', () => {
    expect(terminalTabNavigationIndex(2, -1, 'ArrowRight')).toBe(1);
    expect(terminalTabNavigationIndex(0, -1, 'Home')).toBeNull();
  });
});

describe('terminal session shortcuts', () => {
  const keyboard = (key: string, shiftKey = false) => ({
    key,
    ctrlKey: true,
    shiftKey,
    altKey: false,
    metaKey: false,
  });

  it('recognizes session creation, closing, and cycling', () => {
    expect(terminalShortcutForEvent(keyboard('T', true))).toBe('new');
    expect(terminalShortcutForEvent(keyboard('w', true))).toBe('close');
    expect(terminalShortcutForEvent(keyboard('PageUp'))).toBe('previous');
    expect(terminalShortcutForEvent(keyboard('PageDown'))).toBe('next');
  });

  it('does not consume unrelated or conflicting platform shortcuts', () => {
    expect(terminalShortcutForEvent(keyboard('t'))).toBeNull();
    expect(terminalShortcutForEvent({ ...keyboard('PageUp'), altKey: true })).toBeNull();
    expect(terminalShortcutForEvent({ ...keyboard('PageDown'), metaKey: true })).toBeNull();
    expect(terminalShortcutForEvent({ ...keyboard('PageDown'), ctrlKey: false })).toBeNull();
  });
});

describe('terminal tab visibility', () => {
  const baseMetrics = {
    containerStart: 100,
    containerEnd: 500,
    tabStart: 180,
    tabEnd: 320,
    scrollPosition: 240,
    maximumScrollPosition: 720,
  };

  it('leaves fully visible tabs in place', () => {
    expect(terminalTabScrollPosition(baseMetrics)).toBeNull();
  });

  it('reveals tabs hidden beyond either edge', () => {
    expect(terminalTabScrollPosition({ ...baseMetrics, tabStart: 40, tabEnd: 160 })).toBe(180);
    expect(terminalTabScrollPosition({ ...baseMetrics, tabStart: 460, tabEnd: 580 })).toBe(320);
  });

  it('clamps the target to the scrollable range', () => {
    expect(terminalTabScrollPosition({ ...baseMetrics, tabStart: -400, tabEnd: -280 })).toBe(0);
    expect(terminalTabScrollPosition({ ...baseMetrics, tabStart: 900, tabEnd: 1020 })).toBe(720);
  });
});

describe('terminal tab closing', () => {
  it('keeps the active session selected when a background tab closes', () => {
    expect(terminalTabStateAfterClose(['one', 'two', 'three'], 'one', 'two')).toEqual({
      activeId: 'one',
      remainingIds: ['one', 'three'],
    });
  });

  it('selects the next tab, then the previous tab, when the active session closes', () => {
    expect(terminalTabStateAfterClose(['one', 'two', 'three'], 'two', 'two').activeId).toBe('three');
    expect(terminalTabStateAfterClose(['one', 'two'], 'two', 'two').activeId).toBe('one');
  });

  it('clears selection after the final tab and ignores unknown tab ids', () => {
    expect(terminalTabStateAfterClose(['one'], 'one', 'one')).toEqual({ activeId: null, remainingIds: [] });
    expect(terminalTabStateAfterClose(['one'], 'one', 'missing')).toEqual({
      activeId: 'one',
      remainingIds: ['one'],
    });
  });
});
