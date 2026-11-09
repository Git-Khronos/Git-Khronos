import { describe, expect, it } from 'vitest';
import {
  MAX_DETAILED_DIFF_CHARACTERS,
  MAX_DETAILED_DIFF_LINES,
  MAX_SYNTAX_LINE_CHARACTERS,
  MAX_SYNTAX_TOKENS_PER_LINE,
  shouldDecorateDiff,
  tokenizeDiffLine,
} from './diff-rendering';

describe('diff rendering budget', () => {
  it('keeps detailed decoration for ordinary patches', () => {
    expect(shouldDecorateDiff(12_000, 240)).toBe(true);
  });

  it('uses lightweight rendering for large patches', () => {
    expect(shouldDecorateDiff(MAX_DETAILED_DIFF_CHARACTERS + 1, 20)).toBe(false);
    expect(shouldDecorateDiff(2_000, MAX_DETAILED_DIFF_LINES + 1)).toBe(false);
  });

  describe('syntax token budget', () => {
    it('preserves syntax kinds and word-change flags for ordinary lines', () => {
      const segments = [
        { text: '-const answer = ', changed: false },
        { text: '42', changed: true },
        { text: ';', changed: false },
      ];
      const tokens = tokenizeDiffLine(segments, 'answer.ts');
      expect(tokens.map((token) => token.text).join('')).toBe('-const answer = 42;');
      expect(tokens).toContainEqual({ text: 'const', kind: 'keyword', changed: false });
      expect(tokens).toContainEqual({ text: '42', kind: 'number', changed: true });
      expect(tokens).toContainEqual({ text: ';', kind: 'punctuation', changed: false });
    });

    it('keeps syntax highlighting at the exact limit', () => {
      const text = 'a+'.repeat(MAX_SYNTAX_TOKENS_PER_LINE / 2);
      const tokens = tokenizeDiffLine([{ text, changed: false }], 'dense.ts');
      expect(tokens).toHaveLength(MAX_SYNTAX_TOKENS_PER_LINE);
      expect(tokens.map((token) => token.text).join('')).toBe(text);
      expect(tokens.at(-1)).toEqual({ text: '+', kind: 'punctuation', changed: false });
    });

    it('limits scanning across long line segments while preserving text and changes', () => {
      const prefix = 'const ';
      const withinLimit = prefix + 'a'.repeat(MAX_SYNTAX_LINE_CHARACTERS - prefix.length);
      expect(tokenizeDiffLine([{ text: withinLimit, changed: false }], 'long.ts'))
        .toContainEqual({ text: 'const', kind: 'keyword', changed: false });

      const longValue = 'a'.repeat(MAX_SYNTAX_LINE_CHARACTERS - prefix.length + 1);
      expect(tokenizeDiffLine([
        { text: prefix, changed: false },
        { text: longValue, changed: true },
      ], 'long.ts')).toEqual([
        { text: prefix, kind: 'plain', changed: false },
        { text: longValue, kind: 'plain', changed: true },
      ]);
    });

    it('does not scan an excessively long unterminated string', () => {
      const text = '"' + '\\"'.repeat(MAX_SYNTAX_LINE_CHARACTERS / 2 + 1) + ' const';
      expect(tokenizeDiffLine([{ text, changed: false }], 'long.ts')).toEqual([
        { text, kind: 'plain', changed: false },
      ]);
    });

    it('falls back across segments while preserving text and word changes', () => {
      const dense = 'a+'.repeat(MAX_SYNTAX_TOKENS_PER_LINE / 2);
      expect(tokenizeDiffLine([
        { text: '-', changed: false },
        { text: dense, changed: true },
      ], 'dense.ts')).toEqual([
        { text: '-', kind: 'plain', changed: false },
        { text: dense, kind: 'plain', changed: true },
      ]);
    });

    it('bounds even heavily fragmented input without dropping text', () => {
      const segments = Array.from({ length: MAX_SYNTAX_TOKENS_PER_LINE + 1 }, (_, index) => ({
        text: 'a',
        changed: index % 2 === 0,
      }));
      expect(tokenizeDiffLine(segments, 'dense.ts')).toEqual([
        { text: 'a'.repeat(segments.length), kind: 'plain', changed: false },
      ]);
      expect(tokenizeDiffLine([{ text: '', changed: false }], 'empty.ts')).toEqual([]);
    });

    it('keeps CSS hashes distinct from comments', () => {
      expect(tokenizeDiffLine([{ text: '#fff', changed: false }], 'style.css')).toEqual([
        { text: '#fff', kind: 'plain', changed: false },
      ]);
      expect(tokenizeDiffLine([{ text: '# note', changed: false }], 'script.py')).toEqual([
        { text: '# note', kind: 'comment', changed: false },
      ]);
    });
  });
});
