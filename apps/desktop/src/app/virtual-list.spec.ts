import { describe, expect, it } from 'vitest';
import { calculateVirtualWindow } from './virtual-list';

describe('calculateVirtualWindow', () => {
  const items = Array.from({ length: 10_000 }, (_, index) => index);

  it('renders only the viewport and overscan buffer', () => {
    const window = calculateVirtualWindow(items, 4_000, 400, 40, 0, 12);

    expect(window.items).toHaveLength(34);
    expect(window.items[0]).toBe(88);
    expect(window.items.at(-1)).toBe(121);
    expect(window.start).toBe(88);
    expect(window.capacity).toBe(34);
  });

  it('preserves the complete scroll height with padding', () => {
    const window = calculateVirtualWindow(items, 120_000, 720, 40, 88, 12);

    expect(window.topPadding + window.items.length * 40 + window.bottomPadding)
      .toBe(items.length * 40);
  });

  it('does not advance the commit window while scrolling through leading rows', () => {
    const window = calculateVirtualWindow(items, 60, 400, 40, 88, 12);

    expect(window.items[0]).toBe(0);
    expect(window.topPadding).toBe(0);
  });

  it('clamps a stale scroll position when filtering to fewer items', () => {
    const filtered = calculateVirtualWindow(items.slice(0, 5), 300_000, 400, 40, 0, 12);

    expect(filtered.items).toEqual([0, 1, 2, 3, 4]);
    expect(filtered.topPadding).toBe(0);
    expect(filtered.bottomPadding).toBe(0);
  });

  it('rejects invalid row heights', () => {
    expect(() => calculateVirtualWindow(items, 0, 400, 0)).toThrow(RangeError);
  });
});
