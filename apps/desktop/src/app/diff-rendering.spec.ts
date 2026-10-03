import { describe, expect, it } from 'vitest';
import {
  MAX_DETAILED_DIFF_CHARACTERS,
  MAX_DETAILED_DIFF_LINES,
  shouldDecorateDiff,
} from './diff-rendering';

describe('diff rendering budget', () => {
  it('keeps detailed decoration for ordinary patches', () => {
    expect(shouldDecorateDiff(12_000, 240)).toBe(true);
  });

  it('uses lightweight rendering for large patches', () => {
    expect(shouldDecorateDiff(MAX_DETAILED_DIFF_CHARACTERS + 1, 20)).toBe(false);
    expect(shouldDecorateDiff(2_000, MAX_DETAILED_DIFF_LINES + 1)).toBe(false);
  });
});
