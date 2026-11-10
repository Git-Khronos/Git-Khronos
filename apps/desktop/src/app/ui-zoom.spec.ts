import { describe, expect, it } from 'vitest';
import { automaticZoom, effectiveZoom, normalizeZoom } from './ui-zoom';

describe('automatic interface zoom', () => {
  it('uses 100% for a 1080p-class or smaller screen', () => {
    expect(automaticZoom(1920, 1080)).toBe(100);
    expect(automaticZoom(1366, 768)).toBe(100);
    expect(automaticZoom(0, 0)).toBe(100);
  });

  it('grows with the limiting screen dimension', () => {
    expect(automaticZoom(2560, 1440)).toBe(135);
    expect(automaticZoom(2496, 1664)).toBe(130);
    expect(automaticZoom(3840, 800)).toBe(100);
  });

  it('is capped for very large screens', () => {
    expect(automaticZoom(7680, 4320)).toBe(175);
  });

  it('does not rescale a display the web view already scaled', () => {
    // 2496x1664 physical at 150% reaches the web view as 1664x1109 CSS pixels.
    expect(automaticZoom(2496 / 1.5, 1664 / 1.5)).toBe(100);
  });
});

describe('effective zoom', () => {
  it('multiplies the automatic scale by the user multiplier', () => {
    expect(effectiveZoom(135, 100)).toBe(135);
    expect(effectiveZoom(135, 110)).toBe(149);
    expect(effectiveZoom(100, 75)).toBe(75);
    expect(effectiveZoom(175, 200)).toBe(350);
  });
});

describe('zoom multiplier normalization', () => {
  it('snaps to a preset and falls back to 100', () => {
    expect(normalizeZoom('112')).toBe(110);
    expect(normalizeZoom('invalid')).toBe(100);
    expect(normalizeZoom('  ')).toBe(100);
    expect(normalizeZoom(500)).toBe(200);
  });
});
