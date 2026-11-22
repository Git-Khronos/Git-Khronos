import '@angular/compiler';
import { createEnvironmentInjector, EnvironmentInjector, Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationUpdateStatus } from '@git-khronos/contracts';

const bridge = vi.hoisted(() => ({ native: false,
  status: vi.fn(), check: vi.fn(), download: vi.fn(), install: vi.fn(), inspect: vi.fn(), automatic: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native }));
vi.mock('@git-khronos/contracts', () => ({
  ipc: { application_update_status: bridge.status, check_application_update: bridge.check,
    download_application_update: bridge.download, install_application_update: bridge.install,
    inspect_application_update: bridge.inspect, set_automatic_application_updates: bridge.automatic },
  events: { applicationUpdateChanged: { listen: bridge.listen } },
}));
import { ApplicationUpdatesService } from './application-updates.service';

function state(patch: Partial<ApplicationUpdateStatus> = {}): ApplicationUpdateStatus {
  return { revision: 1, phase: 'idle', runningVersion: '0.1.6', installedVersion: null,
    packageFormat: 'deb', configured: true, automatic: false, offerId: null, offeredVersion: null,
    notes: '', verified: false, downloadedBytes: 0, totalBytes: null, message: 'Owned native status',
    storageError: null, canCheck: true, canDownload: false, canInstall: false, canInspect: false, ...patch };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('native-owned application updates service', () => {
  let injector: EnvironmentInjector;
  let destroyed = false;
  let publish: (event: { payload: { state: ApplicationUpdateStatus } }) => void;
  const unlisten = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks(); bridge.native = true; destroyed = false;
    bridge.status.mockResolvedValue(state());
    bridge.listen.mockImplementation((callback: typeof publish) => { publish = callback; return Promise.resolve(unlisten); });
    injector = createEnvironmentInjector([], Injector.NULL as EnvironmentInjector);
  });
  afterEach(() => { if (!destroyed) injector.destroy(); });
  const create = () => runInInjectionContext(injector, () => new ApplicationUpdatesService());
  const emit = (value: ApplicationUpdateStatus) => publish({ payload: { state: value } });

  it('does not read native status or start background work in browser preview', async () => {
    bridge.native = false;
    const service = create(); await service.activate();
    expect(service.native()).toBe(false);
    expect(service.state()).toBeNull();
    expect(bridge.status).not.toHaveBeenCalled(); expect(bridge.listen).not.toHaveBeenCalled();
  });

  it('coalesces initial and overlapping status refreshes into one native read', async () => {
    const read = deferred<ApplicationUpdateStatus>(); bridge.status.mockReturnValue(read.promise);
    const service = create(); const first = service.refresh(); const second = service.refresh();
    expect(first).toBe(second); expect(bridge.status).toHaveBeenCalledTimes(1);
    read.resolve(state()); await first;
    expect(service.state()?.automatic).toBe(false);
    expect(bridge.listen).toHaveBeenCalledTimes(1);
  });

  it('retires an unanswered status read without starting automatic replacements', async () => {
    vi.useFakeTimers();
    try {
      const unanswered = deferred<ApplicationUpdateStatus>();
      bridge.status.mockReturnValueOnce(unanswered.promise);
      const service = create();
      await vi.advanceTimersByTimeAsync(7000);
      expect(service.statusError()).toContain('did not respond in time');
      expect(service.state()).toBeNull();

      await service.pollStatus();
      await service.pollStatus();
      expect(bridge.status).toHaveBeenCalledTimes(1);
      await service.refresh();
      expect(bridge.status).toHaveBeenCalledTimes(2);
      expect(service.statusError()).toBe('');
      expect(service.state()?.revision).toBe(1);

      // Even a higher revision cannot revive this retired read.
      unanswered.resolve(state({ revision: 90, automatic: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(service.state()?.automatic).toBe(false);
      expect(service.state()?.revision).toBe(1);

      await service.pollStatus();
      expect(bridge.status).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('a superseded timeout cannot freeze install eligibility or replay an updater action', async () => {
    vi.useFakeTimers();
    try {
      const retired = deferred<ApplicationUpdateStatus>();
      bridge.status.mockReturnValueOnce(retired.promise);
      const service = create();
      const ready = state({ revision: 3, phase: 'ready', offerId: 'owned', verified: true,
        canInstall: false, installBlocker: 'Finish active Git work.' });
      emit(ready);
      await vi.advanceTimersByTimeAsync(7000);
      expect(service.state()?.canInstall).toBe(false);
      expect(service.statusError()).toBe('');
      // Finishing Git work changes native eligibility, not the updater
      // revision. No new updater event tells a stopped poll to resume.
      bridge.status.mockResolvedValueOnce({ ...ready, canInstall: true, installBlocker: null });
      await service.pollStatus();
      expect(bridge.status).toHaveBeenCalledTimes(2);
      expect(service.state()?.canInstall).toBe(true);
      retired.resolve({ ...ready, revision: 90 });
      await vi.advanceTimersByTimeAsync(0);
      expect(service.state()?.revision).toBe(3);

      // The recovery read does not remove the guard on a current timeout.
      bridge.status.mockReturnValueOnce(new Promise(() => {}));
      const unanswered = service.pollStatus();
      await vi.advanceTimersByTimeAsync(7000);
      await unanswered;
      expect(service.statusError()).toContain('did not respond in time');
      await service.pollStatus();
      expect(bridge.status).toHaveBeenCalledTimes(3);
      // An event after a genuine timeout still resumes polling.
      const newer = { ...ready, revision: 4 };
      emit(newer);
      bridge.status.mockResolvedValueOnce(newer);
      await service.pollStatus();
      expect(bridge.status).toHaveBeenCalledTimes(4);
      expect(service.statusError()).toBe('');
      expect(bridge.check).not.toHaveBeenCalled();
      expect(bridge.download).not.toHaveBeenCalled();
      expect(bridge.install).not.toHaveBeenCalled();
      expect(bridge.automatic).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('retries a failed live subscription on activation and clears the fallback notice', async () => {
    bridge.listen.mockRejectedValueOnce(new Error('Owned event registration failure'));
    const service = create();
    await service.refresh();
    expect(service.liveError()).toContain('unavailable');
    await service.activate();
    expect(bridge.listen).toHaveBeenCalledTimes(2);
    expect(service.liveError()).toBe('');
    emit(state({ revision: 3, automatic: true }));
    expect(service.state()?.automatic).toBe(true);
  });

  it('cannot let an old action response replace newer native offer state', async () => {
    const service = create(); await service.refresh();
    const check = deferred<ApplicationUpdateStatus>(); bridge.check.mockReturnValue(check.promise);
    const pending = service.check();
    emit(state({ revision: 5, phase: 'available', offerId: 'new-offer', offeredVersion: '0.3.0', canDownload: true }));
    check.resolve(state({ revision: 4, phase: 'available', offerId: 'retired-offer', offeredVersion: '0.2.0' }));
    await pending;
    expect(service.state()?.offerId).toBe('new-offer');
    expect(service.state()?.offeredVersion).toBe('0.3.0');
    expect(service.actionPending()).toBe(false);
  });

  it('keeps newer native eligibility when a held poll returns an equal revision', async () => {
    const ready = state({ revision: 3, phase: 'ready', offerId: 'owned', verified: true, canInstall: true });
    bridge.status.mockResolvedValue(ready);
    const service = create(); await service.refresh();
    const older = deferred<ApplicationUpdateStatus>(); bridge.status.mockReturnValue(older.promise);
    const pending = service.refresh();
    // Native activity can change install eligibility without changing the
    // updater model revision. This event was observed after the poll started.
    emit({ ...ready, canInstall: false });
    older.resolve(ready); await pending;
    expect(service.state()?.canInstall).toBe(false);
    await service.install('owned'); expect(bridge.install).not.toHaveBeenCalled();

    // A newly issued poll at the same revision may observe idle again.
    bridge.status.mockResolvedValue(ready);
    await service.refresh();
    expect(service.state()?.canInstall).toBe(true);
  });

  it('cannot mark newer event state invalid using an older action reply', async () => {
    const service = create(); await service.refresh();
    const check = deferred<ApplicationUpdateStatus>(); bridge.check.mockReturnValue(check.promise);
    const pending = service.check();
    emit(state({ revision: 5, phase: 'available', offerId: 'owned', canDownload: true }));
    check.resolve(null as unknown as ApplicationUpdateStatus); await pending;
    expect(service.statusError()).toBe('');
    expect(service.state()?.canDownload).toBe(true);
  });

  it('does not attach a retired offer failure to a replacement offer', async () => {
    bridge.status.mockResolvedValue(state({ phase: 'available', offerId: 'old', canDownload: true }));
    const service = create(); await service.refresh();
    const download = deferred<ApplicationUpdateStatus>(); bridge.download.mockReturnValue(download.promise);
    const pending = service.download('old');
    const replacement = state({ revision: 3, phase: 'available', offerId: 'new', canDownload: true });
    bridge.status.mockResolvedValue(replacement); emit(replacement);
    download.reject({ message: 'Retired download failed' }); await pending;
    expect(service.state()?.offerId).toBe('new'); expect(service.error()).toBe('');
    await service.download('old'); expect(bridge.download).toHaveBeenCalledTimes(1);
  });

  it('refreshes a lost install reply without replaying an uncertain installer', async () => {
    bridge.status.mockResolvedValue(state({ phase: 'ready', offerId: 'owned', canInstall: true, verified: true }));
    const service = create(); await service.refresh();
    const install = deferred<ApplicationUpdateStatus>(); bridge.install.mockReturnValue(install.promise);
    const pending = service.install('owned');
    expect(service.installing()).toBe(true);
    await service.install('owned'); expect(bridge.install).toHaveBeenCalledTimes(1);
    bridge.status.mockResolvedValue(state({ revision: 3, phase: 'uncertain', offerId: 'owned', canCheck: false, canInspect: true }));
    install.reject({ message: 'Owned reply lost' }); await pending;
    expect(service.state()?.phase).toBe('uncertain'); expect(service.installing()).toBe(false);
    await service.install('owned'); expect(bridge.install).toHaveBeenCalledTimes(1);
  });

  it('retires an event subscription that arrives after application destruction', async () => {
    const subscription = deferred<() => void>(); bridge.listen.mockReturnValue(subscription.promise);
    const service = create(); await service.refresh();
    injector.destroy(); destroyed = true; subscription.resolve(unlisten); await subscription.promise; await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
