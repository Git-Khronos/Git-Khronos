import { describe, expect, it } from 'vitest';
import { highlightSearchText } from './search-highlight';

describe('highlightSearchText', () => {
  it('preserves text while marking every case-insensitive match', () => {
    expect(highlightSearchText('Fix Graph graph rendering', 'graph')).toEqual([
      { text: 'Fix ', matched: false },
      { text: 'Graph', matched: true },
      { text: ' ', matched: false },
      { text: 'graph', matched: true },
      { text: ' rendering', matched: false },
    ]);
  });

  it('returns plain text for blank or unmatched queries', () => {
    expect(highlightSearchText('Commit title', '  ')).toEqual([
      { text: 'Commit title', matched: false },
    ]);
    expect(highlightSearchText('Commit title', 'author')).toEqual([
      { text: 'Commit title', matched: false },
    ]);
  });
});
