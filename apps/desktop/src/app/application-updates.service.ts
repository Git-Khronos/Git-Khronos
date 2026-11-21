import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { events, ipc, type ApplicationUpdateStatus } from '@git-khronos/contracts';

const STATUS_READ_TIMEOUT_MS = 6_000;
const STATUS_READ_TIMEOUT = Symbol('application-update-status-timeout');

@Injectable({ providedIn: 'root' })
export class ApplicationUpdatesService {
  readonly state = signal<ApplicationUpdateStatus | null>(null);
  readonly error = signal('');
  readonly statusError = signal('');
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
  private statusPollingPaused = false;
  private acceptedStatusGeneration = 0;

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
        if (this.disposed) { unlisten(); return; }
        this.unlisten = unlisten;
        this.liveError.set('');
      }, () => {
        if (this.disposed) return;
        this.listening = false;
        this.liveError.set('Live update notifications are unavailable. This dialog still refreshes native status.');
      });
    }
    await this.refresh();
  }

  private accept(value: ApplicationUpdateStatus, issuedAt = this.acceptedStatusGeneration): void {
    if (this.disposed) return;
    const superseded = issuedAt !== this.acceptedStatusGeneration;
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0
      || typeof value.runningVersion !== 'string' || typeof value.configured !== 'boolean'
      || typeof value.automatic !== 'boolean' || typeof value.message !== 'string') {
      if (!superseded) this.statusError.set('The native updater returned an invalid status. Refresh before starting a new update.');
      return;
    }
    const previous = this.state();
    // Native activity can change canInstall without incrementing the updater
    // model's revision. An older reply at the same revision must not replace
    // an observed event; the next fresh poll can still report idle again.
    if (previous && (previous.revision > value.revision
      || (superseded && previous.revision === value.revision))) return;
    if (previous && previous.offerId !== value.offerId) this.error.set('');
    this.acceptedStatusGeneration++;
    this.statusPollingPaused = false;
    this.statusError.set('');
    this.state.set(value);
  }

  refresh(): Promise<void> {
    return this.readStatus(true);
  }

  pollStatus(): Promise<void> {
    return this.readStatus(false);
  }

  private readStatus(explicit: boolean): Promise<void> {
    if (!this.native() || this.disposed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    if (!explicit && this.statusPollingPaused) return Promise.resolve();
    const generation = this.acceptedStatusGeneration;
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<typeof STATUS_READ_TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(STATUS_READ_TIMEOUT), STATUS_READ_TIMEOUT_MS);
    });
    this.refreshing = Promise.race([ipc.application_update_status(), deadline]).then(
      value => {
        if (this.disposed) return;
        if (value !== STATUS_READ_TIMEOUT) { this.accept(value, generation); return; }

        // Abandon this view's read, not the native updater. Don't let the
        // dialog timer keep queuing requests into an unresponsive bridge.
        this.statusPollingPaused = true;
        if (generation === this.acceptedStatusGeneration) {
          this.statusError.set('Native update status did not respond in time. Select Refresh status to retry.');
        }
      },
      () => {
        if (!this.disposed && generation === this.acceptedStatusGeneration) {
          this.statusError.set('Native update status could not be read. Refresh status before starting a new update.');
        }
      },
    ).finally(() => { clearTimeout(timer); this.refreshing = null; });
    return this.refreshing;
  }

  private async action(kind: 'check' | 'download' | 'install' | 'inspect', work: () => Promise<ApplicationUpdateStatus>, offerId?: string): Promise<void> {
    if (!this.native() || this.actionPending()) return;
    this.pendingAction.set(kind); this.error.set('');
    const generation = this.acceptedStatusGeneration;
    try { this.accept(await work(), generation); }
    catch (error: unknown) {
      if (offerId === undefined || this.state()?.offerId === offerId) this.error.set(this.message(error));
      await this.refresh();
    } finally { this.pendingAction.set(null); }
  }

  check(): Promise<void> {
    if (this.statusError() || !this.state()?.canCheck) return Promise.resolve();
    return this.action('check', () => ipc.check_application_update());
  }
  download(offerId: string | null): Promise<void> {
    if (this.statusError() || !offerId || this.state()?.offerId !== offerId || !this.state()?.canDownload) return Promise.resolve();
    return this.action('download', () => ipc.download_application_update({ offerId }), offerId);
  }
  install(offerId: string | null): Promise<void> {
    if (this.statusError() || !offerId || this.state()?.offerId !== offerId || !this.state()?.canInstall) return Promise.resolve();
    return this.action('install', () => ipc.install_application_update({ offerId }), offerId);
  }
  inspect(): Promise<void> {
    if (!this.state()?.canInspect) return Promise.resolve();
    return this.action('inspect', () => ipc.inspect_application_update());
  }
  async setAutomatic(enabled: boolean): Promise<void> {
    const state = this.state();
    if (!this.native() || this.settingPending() || !state
      || (enabled && (this.statusError() || !state.configured || !!state.storageError))) return;
    this.settingPending.set(true); this.error.set('');
    const generation = this.acceptedStatusGeneration;
    try { this.accept(await ipc.set_automatic_application_updates({ enabled }), generation); }
    catch (error: unknown) { this.error.set(this.message(error)); await this.refresh(); }
    finally { this.settingPending.set(false); }
  }
  private message(error: unknown): string {
    return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message : 'The updater request outcome could not be confirmed. Refresh native status before another action.';
  }
}
