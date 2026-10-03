import { describe, expect, it } from 'vitest';
import { buildRemoteNameOrder, compareRemoteNames } from './remote-order';

describe('remote location ordering', () => {
  it('places the tracked remote before origin and the remaining configured remotes', () => {
    const order = buildRemoteNameOrder(['fork', 'origin', 'upstream'], 'upstream/main');
    const names = ['fork', 'origin', 'upstream'].sort((left, right) => compareRemoteNames(left, right, order));

    expect(names).toEqual(['upstream', 'origin', 'fork']);
  });

  it('uses origin first when the branch has no configured upstream', () => {
    const order = buildRemoteNameOrder(['fork', 'backup', 'origin'], null);
    const names = ['fork', 'backup', 'origin'].sort((left, right) => compareRemoteNames(left, right, order));

    expect(names).toEqual(['origin', 'fork', 'backup']);
  });

  it('keeps configured order when neither a tracked remote nor origin exists', () => {
    const order = buildRemoteNameOrder(['team', 'backup'], null);
    const names = ['backup', 'team'].sort((left, right) => compareRemoteNames(left, right, order));

    expect(names).toEqual(['team', 'backup']);
  });

  it('provides a stable icon index independent of the active branch upstream', () => {
    const configured = ['upstream', 'origin', 'fork'];
    const stableOrder = buildRemoteNameOrder(configured, null);
    const displayOrder = buildRemoteNameOrder(configured, 'upstream/main');

    expect(stableOrder.get('origin')).toBe(0);
    expect(stableOrder.get('upstream')).toBe(1);
    expect(displayOrder.get('upstream')).toBe(0);
    expect(displayOrder.get('origin')).toBe(1);
  });
});
