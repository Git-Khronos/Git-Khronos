import { describe, expect, it, vi } from 'vitest';
import { OverlayController } from './overlay-controller';

type TestOverlay = { kind: 'menu' } | { kind: 'context'; value: { x: number; path: string } };

function opener(connected = true, inert = false): HTMLElement {
  return { isConnected: connected, closest: () => inert ? {} : null, focus: vi.fn() } as unknown as HTMLElement;
}

describe('scoped overlay ownership', () => {
  it('replaces its sibling atomically and retains context and opener together', () => {
    const controller = new OverlayController<TestOverlay>();
    const target = opener();
    controller.open({ kind: 'menu' });
    controller.open({ kind: 'context', value: { x: 25, path: 'file.txt' } }, target);
    expect(controller.isOpen('menu')()).toBe(false);
    expect(controller.activeOverlay()).toEqual({
      kind: 'context', value: { x: 25, path: 'file.txt' }, returnFocus: target,
    });
    controller.close('menu');
    expect(controller.isOpen('context')()).toBe(true);
    controller.closeAll();
    expect(controller.activeOverlay()).toBeNull();
  });

  it('toggles only its own kind, leaving orthogonal regions intact', () => {
    const menu = new OverlayController<TestOverlay>();
    const nestedDialog = new OverlayController<TestOverlay>();
    nestedDialog.open({ kind: 'context', value: { x: 0, path: 'draft' } });
    expect(menu.toggle({ kind: 'menu' })).toBe(true);
    expect(menu.toggle({ kind: 'menu' })).toBe(false);
    expect(nestedDialog.activeOverlay()?.kind).toBe('context');
  });

  it('restores focus only when requested and the closed generation still owns it', async () => {
    const controller = new OverlayController<TestOverlay>();
    const first = opener();
    controller.open({ kind: 'menu' }, first);
    controller.closeAll();
    await Promise.resolve();
    expect(first.focus).not.toHaveBeenCalled();
    controller.open({ kind: 'menu' }, first);
    controller.close('menu', true);
    await Promise.resolve();
    expect(first.focus).toHaveBeenCalledOnce();
    controller.open({ kind: 'menu' }, first);
    controller.closeAll(true);
    controller.open({ kind: 'context', value: { x: 0, path: 'new' } });
    await Promise.resolve();
    expect(first.focus).toHaveBeenCalledOnce();
  });

  it.each([[false, false], [true, true]])('does not focus a disconnected or inert opener (%s, %s)', async (connected, inert) => {
    const controller = new OverlayController<TestOverlay>();
    const target = opener(connected, inert);
    controller.open({ kind: 'menu' }, target);
    controller.closeAll(true);
    await Promise.resolve();
    expect(target.focus).not.toHaveBeenCalled();
  });
});
