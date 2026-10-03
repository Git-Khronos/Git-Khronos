import { describe, expect, it } from 'vitest';
import { reorderRepositoryTabs, repositoryTabDropEdge } from './repository-tabs';

const tabs = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];

describe('repository tab reordering', () => {
  it('moves a tab after a target to its right', () => {
    expect(reorderRepositoryTabs(tabs, 'one', 'three').map((tab) => tab.id))
      .toEqual(['two', 'three', 'one']);
    expect(repositoryTabDropEdge(tabs.map((tab) => tab.id), 'one', 'three')).toBe('after');
  });

  it('moves a tab before a target to its left', () => {
    expect(reorderRepositoryTabs(tabs, 'three', 'one').map((tab) => tab.id))
      .toEqual(['three', 'one', 'two']);
    expect(repositoryTabDropEdge(tabs.map((tab) => tab.id), 'three', 'one')).toBe('before');
  });

  it('preserves the original collection for invalid and no-op drops', () => {
    expect(reorderRepositoryTabs(tabs, 'one', 'one')).toBe(tabs);
    expect(reorderRepositoryTabs(tabs, 'missing', 'two')).toBe(tabs);
  });
});
