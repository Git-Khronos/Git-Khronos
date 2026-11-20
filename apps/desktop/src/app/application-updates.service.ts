import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { events, ipc, type ApplicationUpdateStatus } from '@git-khronos/contracts';

@Injectable({ providedIn: 'root' })
export class ApplicationUpdatesService {
  readonly state = signal<ApplicationUpdateStatus | null>(null);
  readonly error = signal('');
  readonly liveError = signal('');
  private readonly pendingAction = signal<'check' | 'download' | 'install' | 'inspect' | null>(null);
  readonly actionPending = computed(() => this.pendingAction() !== null);
  readonly settingPending = signal(false);
  readonly installing = computed(() => this.state()?.phase === 'installing' || this.pendingAction() === 'install');
  readonly native = signal(false);
  private listening = false;
  private disposed = false;
  private unlisten: (() => void) | null = null;
  private refreshing: Promise<void> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.disposed = true; this.unlisten?.(); });
    if (isTauri()) void this.activate();
  }

  async activate(): Promise<void> {
    this.native.set(isTauri());
    if (!this.native()) return;
    if (!this.listening) {
      this.listening = true;
      void events.applicationUpdateChanged.listen(({ payload }) => this.accept(payload.state)).then(unlisten => {
        if (this.disposed) unlisten(); else this.unlisten = unlisten;
      }, () => this.liveError.set('Live update notifications are unavailable. This dialog still refreshes native status.'));
    }
    await this.refresh();
  }

  private accept(value: ApplicationUpdateStatus): void {
    if (this.disposed) return;
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0
      || typeof value.runningVersion !== 'string' || typeof value.configured !== 'boolean'
      || typeof value.automatic !== 'boolean' || typeof value.message !== 'string') {
      this.error.set('The native updater returned an invalid status. No installation was requested.'); return;
    }
    const previous = this.state();
    if (previous && previous.revision > value.revision) return;
    if (previous && previous.offerId !== value.offerId) this.error.set('');
    this.state.set(value);
  }

  refresh(): Promise<void> {
    if (!this.native() || this.disposed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = ipc.application_update_status().then(value => this.accept(value), () => {
      this.error.set('Native update status could not be read. An unknown installation outcome must be inspected, not retried blindly.');
    }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async action(kind: 'check' | 'download' | 'install' | 'inspect', work: () => Promise<ApplicationUpdateStatus>, offerId?: string): Promise<void> {
    if (!this.native() || this.actionPending()) return;
    this.pendingAction.set(kind); this.error.set('');
    try { this.accept(await work()); }
    catch (error: unknown) {
      if (offerId === undefined || this.state()?.offerId === offerId) this.error.set(this.message(error));
      await this.refresh();
    } finally { this.pendingAction.set(null); }
  }

  check(): Promise<void> {
    if (!this.state()?.canCheck) return Promise.resolve();
    return this.action('check', () => ipc.check_application_update());
  }
  download(offerId: string | null): Promise<void> {
    if (!offerId || this.state()?.offerId !== offerId || !this.state()?.canDownload) return Promise.resolve();
    return this.action('download', () => ipc.download_application_update({ offerId }), offerId);
  }
  install(offerId: string | null): Promise<void> {
    if (!offerId || this.state()?.offerId !== offerId || !this.state()?.canInstall) return Promise.resolve();
    return this.action('install', () => ipc.install_application_update({ offerId }), offerId);
  }
  inspect(): Promise<void> {
    if (!this.state()?.canInspect) return Promise.resolve();
    return this.action('inspect', () => ipc.inspect_application_update());
  }
  async setAutomatic(enabled: boolean): Promise<void> {
    if (!this.native() || this.settingPending()) return;
    this.settingPending.set(true); this.error.set('');
    try { this.accept(await ipc.set_automatic_application_updates({ enabled })); }
    catch (error: unknown) { this.error.set(this.message(error)); await this.refresh(); }
    finally { this.settingPending.set(false); }
  }
  private message(error: unknown): string {
    return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message : 'The updater request outcome could not be confirmed. Refresh native status before another action.';
  }
}
