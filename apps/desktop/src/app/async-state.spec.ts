import { describe, expect, it } from 'vitest';
import { AsyncStateController } from './async-state';

describe('request-guarded async state', () => {
  it('retains accepted values and errors while retrying, then settles with fresh data', () => {
    const read = new AsyncStateController<string | null>(null);
    expect(read.state().kind).toBe('idle');
    const first = read.begin();
    read.resolve(first, 'accepted');
    const failed = read.begin();
    read.fail(failed, 'offline');
    const retry = read.begin();
    expect(read.value()).toBe('accepted');
    expect(read.error()).toBe('offline');
    expect(read.loading()).toBe(true);
    read.publish(retry, 'fresh');
    expect(read.value()).toBe('fresh');
    expect(read.error()).toBeNull();
    expect(read.loading()).toBe(true);
    read.finish(retry);
    expect(read.state()).toEqual({ kind: 'ready', value: 'fresh' });
  });

  it('rejects every stale transition without clearing a newer owner', () => {
    const read = new AsyncStateController('initial');
    const stale = read.begin();
    const current = read.begin();
    expect(read.publish(stale, 'stale')).toBe(false);
    expect(read.resolve(stale, 'stale')).toBe(false);
    expect(read.fail(stale, 'stale')).toBe(false);
    read.finish(stale);
    expect(read.loading()).toBe(true);
    read.resolve(current, 'current');
    read.invalidate();
    expect(read.resolve(current, 'late')).toBe(false);
    expect(read.value()).toBe('current');
  });

  it('supports quiet acknowledgements and preserves error/value on teardown', () => {
    const read = new AsyncStateController('accepted');
    const quiet = read.begin(false);
    expect(read.loading()).toBe(false);
    read.fail(quiet, 'retry');
    read.begin();
    read.invalidate();
    expect(read.loading()).toBe(false);
    expect(read.error()).toBe('retry');
    expect(read.value()).toBe('accepted');
    read.reset();
    expect(read.state()).toEqual({ kind: 'idle' });
    expect(read.error()).toBeNull();
  });

  it('retains confirmed changes without completing a newer read or clearing its error', () => {
    const read = new AsyncStateController('before');
    const request = read.begin();
    read.updateValue(() => 'confirmed');
    expect(read.loading()).toBe(true);
    expect(read.isCurrent(request)).toBe(true);
    read.fail(request, 'refresh failed');
    read.updateValue(value => `${value} again`);
    expect(read.value()).toBe('confirmed again');
    expect(read.error()).toBe('refresh failed');
  });
});
