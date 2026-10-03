import { describe, expect, it } from 'vitest';
import { graphScrollMarkerPosition, sampleGraphMarkers } from './graph-scroll-markers';

describe('graph scroll markers', () => {
  it('places markers at the center of their graph rows', () => {
    expect(graphScrollMarkerPosition(200, 40, 1_000)).toBe(22);
  });

  it('keeps edge markers inside the interactive rail', () => {
    expect(graphScrollMarkerPosition(0, 1, 10_000)).toBe(1);
    expect(graphScrollMarkerPosition(10_000, 40, 10_000)).toBe(99);
    expect(graphScrollMarkerPosition(0, 40, 0)).toBe(50);
  });

  it('samples large result sets evenly without changing small sets', () => {
    expect(sampleGraphMarkers([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(sampleGraphMarkers([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4]);
    expect(sampleGraphMarkers([1, 2], 0)).toEqual([]);
  });
});
