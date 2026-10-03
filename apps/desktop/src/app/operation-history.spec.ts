import { describe, expect, it } from 'vitest';
import {
  checkoutHistoryTarget,
  createCheckoutHistoryEntry,
  createHeadHistoryEntry,
  createRenameBranchHistoryEntry,
  headHistoryTarget,
  renameBranchHistoryTarget,
} from './operation-history';

describe('checkout operation history', () => {
  it('records named branch transitions for one-step undo and redo', () => {
    const entry = createCheckoutHistoryEntry('main', 'feature/performance');

    expect(entry).not.toBeNull();
    expect(entry?.label).toBe('Checkout feature/performance');
    expect(checkoutHistoryTarget(entry!, 'undo')).toBe('main');
    expect(checkoutHistoryTarget(entry!, 'redo')).toBe('feature/performance');
  });

  it('does not record detached, missing, or no-op transitions', () => {
    expect(createCheckoutHistoryEntry(null, 'feature')).toBeNull();
    expect(createCheckoutHistoryEntry('main', null)).toBeNull();
    expect(createCheckoutHistoryEntry('main', 'main')).toBeNull();
  });
});

describe('branch rename operation history', () => {
  it('reverses and reapplies a named branch transition', () => {
    const entry = createRenameBranchHistoryEntry('feature/old', 'feature/new');

    expect(entry?.label).toBe('Rename Branch feature/old to feature/new');
    expect(renameBranchHistoryTarget(entry!, 'undo')).toEqual({
      oldName: 'feature/new',
      newName: 'feature/old',
    });
    expect(renameBranchHistoryTarget(entry!, 'redo')).toEqual({
      oldName: 'feature/old',
      newName: 'feature/new',
    });
  });

  it('normalizes names and ignores invalid or unchanged transitions', () => {
    expect(createRenameBranchHistoryEntry(' feature ', ' topic ')).toMatchObject({
      beforeName: 'feature',
      afterName: 'topic',
    });
    expect(createRenameBranchHistoryEntry('', 'topic')).toBeNull();
    expect(createRenameBranchHistoryEntry('main', 'main')).toBeNull();
  });
});

describe('HEAD operation history', () => {
  it('records reversible commit-producing operations', () => {
    const entry = createHeadHistoryEntry('a'.repeat(40), 'b'.repeat(40), 'Revert Commit');

    expect(entry?.label).toBe('Revert Commit');
    expect(headHistoryTarget(entry!, 'undo')).toBe('a'.repeat(40));
    expect(headHistoryTarget(entry!, 'redo')).toBe('b'.repeat(40));
  });

  it('ignores missing and unchanged HEAD values', () => {
    expect(createHeadHistoryEntry(null, 'b'.repeat(40), 'Commit')).toBeNull();
    expect(createHeadHistoryEntry('a'.repeat(40), null, 'Commit')).toBeNull();
    expect(createHeadHistoryEntry('a'.repeat(40), 'a'.repeat(40), 'Commit')).toBeNull();
  });
});
