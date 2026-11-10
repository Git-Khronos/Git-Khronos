import { describe, expect, it } from 'vitest';
import { OperationTracker } from './operation-tracker';

describe('live operation ownership', () => {
  it('counts identities, not completion order, and cannot underflow', () => {
    const tracker = new OperationTracker();
    tracker.start(1, 'a', 'one');
    tracker.start(2, 'b', null);
    tracker.complete(1);
    tracker.complete(1);
    expect(tracker.busy()).toBe(true);
    expect(tracker.foreground().map(operation => operation.activityId)).toEqual([2]);
    tracker.complete(2);
    expect(tracker.busy()).toBe(false);
    tracker.start(3, null, null);
    expect(() => tracker.start(3, null, null)).toThrow('already running');
  });

  it('keeps acceptance distinct from completion and permits refused cancellation to retry', () => {
    const tracker = new OperationTracker();
    tracker.start(1, 'a', 'operation');
    const first = tracker.requestCancellation('operation')!;
    expect(tracker.foreground()[0].cancellation.kind).toBe('requested');
    expect(tracker.requestCancellation('operation')).toBeNull();
    tracker.settleCancellation(first, false);
    const retry = tracker.requestCancellation('operation')!;
    tracker.settleCancellation(first, true);
    expect(tracker.foreground()[0].cancellation.kind).toBe('requested');
    tracker.settleCancellation(retry, true);
    expect(tracker.foreground()[0].cancellation.kind).toBe('accepted');
    expect(tracker.busy()).toBe(true);
    expect(tracker.cancellingOperationIds()).toEqual(['operation']);
    tracker.complete(1);
    expect(tracker.cancellingOperationIds()).toEqual([]);
    expect(tracker.busy()).toBe(false);
  });

  it('cannot attach late cancellation acknowledgements to a completed or replacement operation', () => {
    const tracker = new OperationTracker();
    tracker.start(1, 'a', 'operation');
    const request = tracker.requestCancellation('operation')!;
    tracker.complete(1);
    tracker.start(2, 'a', 'operation');
    tracker.settleCancellation(request, true);
    expect(tracker.foreground()[0].cancellation.kind).toBe('idle');
    expect(tracker.requestCancellation('missing')).toBeNull();
  });

  it('owns background scope atomically and ignores retired cleanup without affecting foreground work', () => {
    const tracker = new OperationTracker();
    const first = tracker.beginBackground('a')!;
    expect(tracker.background()).toEqual({ kind: 'waitingForHistory', request: first });
    expect(tracker.beginBackground('b')).toBeNull();
    expect(tracker.busy()).toBe(false);
    tracker.advanceBackground(first, 'fetching');
    tracker.advanceBackground(first, 'reconciling');
    tracker.completeBackground(first);
    const next = tracker.beginBackground('b')!;
    tracker.start(1, 'b', null);
    tracker.advanceBackground(first, 'reconciling');
    tracker.completeBackground(first);
    expect(tracker.backgroundRepositoryId()).toBe('b');
    expect(tracker.backgroundBusy()).toBe(true);
    tracker.completeBackground(next);
    expect(tracker.backgroundRepositoryId()).toBeNull();
    expect(tracker.backgroundBusy()).toBe(false);
    expect(tracker.busy()).toBe(true);
  });
});
