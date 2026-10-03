import { describe, expect, it } from 'vitest';
import { orderBranchesCurrentFirst } from './branch-order';

describe('orderBranchesCurrentFirst', () => {
  it('places the current branch first without mutating the repository snapshot', () => {
    const branches = [
      { name: 'feature/alpha', current: false },
      { name: 'release/2', current: false },
      { name: 'z-current', current: true },
      { name: 'release/10', current: false },
    ];

    expect(orderBranchesCurrentFirst(branches).map((branch) => branch.name)).toEqual([
      'z-current',
      'feature/alpha',
      'release/2',
      'release/10',
    ]);
    expect(branches[0].name).toBe('feature/alpha');
  });
});
