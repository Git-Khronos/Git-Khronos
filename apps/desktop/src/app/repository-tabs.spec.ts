import { describe, expect, it } from 'vitest';
import {
  reorderRepositoryTabs,
  repositoryTabDropEdge,
  repositoryTabOverflowState,
  repositoryTabScrollPosition,
} from './repository-tabs';

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

describe('repository tab visibility', () => {
  it('keeps fully visible tabs in place', () => {
    expect(repositoryTabScrollPosition({
      containerStart: 100,
      containerEnd: 500,
      tabStart: 180,
      tabEnd: 360,
      scrollPosition: 220,
      maximumScrollPosition: 600,
    })).toBeNull();
  });

  it('reveals clipped tabs and clamps to the strip bounds', () => {
    expect(repositoryTabScrollPosition({
      containerStart: 100,
      containerEnd: 500,
      tabStart: 440,
      tabEnd: 620,
      scrollPosition: 220,
      maximumScrollPosition: 600,
    })).toBe(340);
    expect(repositoryTabScrollPosition({
      containerStart: 100,
      containerEnd: 500,
      tabStart: 20,
      tabEnd: 140,
      scrollPosition: 40,
      maximumScrollPosition: 600,
    })).toBe(0);
  });

  it('exposes stable scroll-control state only while the strip overflows', () => {
    expect(repositoryTabOverflowState({ scrollPosition: 0, viewportWidth: 400, contentWidth: 400 }))
      .toEqual({ overflowing: false, canScrollBack: false, canScrollForward: false });
    expect(repositoryTabOverflowState({ scrollPosition: 0, viewportWidth: 400, contentWidth: 900 }))
      .toEqual({ overflowing: true, canScrollBack: false, canScrollForward: true });
    expect(repositoryTabOverflowState({ scrollPosition: 250, viewportWidth: 400, contentWidth: 900 }))
      .toEqual({ overflowing: true, canScrollBack: true, canScrollForward: true });
    expect(repositoryTabOverflowState({ scrollPosition: 500, viewportWidth: 400, contentWidth: 900 }))
      .toEqual({ overflowing: true, canScrollBack: true, canScrollForward: false });
  });
});
