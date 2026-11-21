import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '@git-khronos/contracts';
import { GitKhronosService, type RepositoryWorkspace } from './git-khronos.service';
import { createRepositoryPreview } from './repository-preview';

const native = vi.hoisted(() => ({ open: vi.fn(), refresh: vi.fn() }));
vi.mock('@git-khronos/contracts', () => ({
  ipc: { open_repository: native.open, refresh_repository: native.refresh },
}));

const WORKSPACES = 'git-khronos.workspaces.v1';
const OPEN = 'git-khronos.open-repositories.v1';
const workspace = (id: string, paths: string[]): RepositoryWorkspace => ({
  id, name: id, repositoryPaths: paths, activeRepositoryPath: paths[0] ?? null,
});
const snapshot = (path: string): RepositorySnapshot => ({
  ...createRepositoryPreview(), id: path, path, name: path.slice(1),
});
function heldRead() {
  let finish!: (snapshot: RepositorySnapshot) => void;
  const promise = new Promise<RepositorySnapshot>(resolve => { finish = resolve; });
  return { promise, finish };
}

describe('deferred restoration of saved repository tabs', () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    vi.useFakeTimers();
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    storage.set(WORKSPACES, JSON.stringify([workspace('empty', []), workspace('saved', ['/a', '/b', '/c'])]));
    native.open.mockReset().mockImplementation(async ({ path }) => snapshot(path));
    native.refresh.mockReset().mockRejectedValue(new Error('Optional metadata unavailable'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const loaded = (service: GitKhronosService) => service.repositories().map(tab => tab.path);
  const saved = () => (JSON.parse(storage.get(WORKSPACES)!) as RepositoryWorkspace[])
    .find(item => item.id === 'saved')?.repositoryPaths;

  it('preserves unloaded tabs on disk before the timer even when the visible tabs change', async () => {
    const service = new GitKhronosService();
    await service.switchWorkspace('saved');
    expect(loaded(service)).toEqual(['/a']);

    await service.openRepository('/new');
    service.closeRepository('/a');
    expect(saved()).toEqual(['/b', '/c', '/new']);
    expect(JSON.parse(storage.get(OPEN)!)).toEqual(saved());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(loaded(service)).toEqual(['/b', '/c', '/new']);
    expect(service.repository()?.path).toEqual('/new');
    expect(saved()).toEqual(loaded(service));
  });

  it('resumes missing tabs when switching back to a partially cached workspace', async () => {
    const service = new GitKhronosService();
    await service.switchWorkspace('saved');
    await service.switchWorkspace('empty');
    expect(saved()).toEqual(['/a', '/b', '/c']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(native.open).toHaveBeenCalledTimes(1);

    await service.switchWorkspace('saved');
    expect(loaded(service)).toEqual(['/a']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(loaded(service)).toEqual(['/a', '/b', '/c']);
  });

  it('does not resurrect a tab explicitly opened and closed while its deferred read was in flight', async () => {
    const deferred = heldRead();
    const service = new GitKhronosService();
    await service.switchWorkspace('saved');
    native.open.mockImplementationOnce(() => deferred.promise);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(native.open).toHaveBeenLastCalledWith({ path: '/b' });

    await service.openRepository('/b');
    service.closeRepository('/b');
    deferred.finish(snapshot('/b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded(service)).toEqual(['/a', '/c']);
    expect(saved()).toEqual(['/a', '/c']);
  });

  it('ignores a reply from an earlier visit even after returning to the same workspace', async () => {
    const deferred = heldRead();
    const service = new GitKhronosService();
    await service.switchWorkspace('saved');
    native.open.mockImplementationOnce(() => deferred.promise);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(native.open).toHaveBeenLastCalledWith({ path: '/b' });
    await service.switchWorkspace('empty');
    await service.switchWorkspace('saved');

    deferred.finish(snapshot('/b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded(service)).toEqual(['/a']);
    expect(saved()).toEqual(['/a', '/b', '/c']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(loaded(service)).toEqual(['/a', '/b', '/c']);
  });

  it('preserves the user’s visible tab order when delayed tabs fill saved slots', async () => {
    const service = new GitKhronosService();
    await service.switchWorkspace('saved');
    await service.openRepository('/new');
    service.reorderRepository('/new', '/a');
    expect(loaded(service)).toEqual(['/new', '/a']);
    expect(saved()).toEqual(['/new', '/b', '/c', '/a']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(loaded(service)).toEqual(['/new', '/b', '/c', '/a']);
    expect(service.repository()?.path).toEqual('/new');
  });

  it('preserves a missing saved path while restoring the other tabs and reports the failure', async () => {
    const service = new GitKhronosService();
    native.open.mockImplementation(async ({ path }) => {
      if (path === '/a') throw new Error('No such directory');
      return snapshot(path);
    });
    await service.switchWorkspace('saved');
    expect(service.repository()?.path).toEqual('/b');
    expect(saved()).toEqual(['/a', '/b', '/c']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(loaded(service)).toEqual(['/b', '/c']);
    expect(saved()).toEqual(['/a', '/b', '/c']);
    expect(service.error()).toContain('Could not restore 1 saved repository: a');
  });
});
