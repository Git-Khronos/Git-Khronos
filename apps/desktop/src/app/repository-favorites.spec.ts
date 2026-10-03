import { describe, expect, it } from 'vitest';
import { toggleFavoriteRepository } from './repository-favorites';

describe('repository favorites', () => {
  it('pins new favorites first and removes an existing favorite', () => {
    const pinned = toggleFavoriteRepository(['/repos/first'], '/repos/second');
    expect(pinned).toEqual(['/repos/second', '/repos/first']);
    expect(toggleFavoriteRepository(pinned, '/repos/first')).toEqual(['/repos/second']);
  });

  it('bounds the persisted favorite list', () => {
    expect(toggleFavoriteRepository(['/repos/first', '/repos/second'], '/repos/third', 2))
      .toEqual(['/repos/third', '/repos/first']);
  });
});
