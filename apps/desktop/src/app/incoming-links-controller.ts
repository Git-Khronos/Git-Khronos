import type { WritableSignal } from '@angular/core';
import { events, ipc, type IncomingRepositoryLinkState } from '@git-khronos/contracts';

interface IncomingLinksHost {
  state: WritableSignal<IncomingRepositoryLinkState>;
  pending: WritableSignal<boolean>;
  loading: WritableSignal<boolean>;
  supported: WritableSignal<boolean>;
  readError: WritableSignal<string>;
  listenError: WritableSignal<string>;
  refreshPolicies(): Promise<void>;
}

/** Loaded before native tab restoration; an inactive renderer never owns listeners. */
export class IncomingLinksController {
  private listener: (() => void) | null = null;
  private listenerRequest = 0;
  private stateRequest = 0;
  private stopped = false;
  constructor(private readonly host: IncomingLinksHost) {}

  async connect(): Promise<void> {
    if (this.stopped) return;
    const request = ++this.listenerRequest;
    this.release(this.listener); this.listener = null;
    try {
      const stop = await events.incomingRepositoryLinksChanged.listen(({ payload }) => {
        if (this.stopped || request !== this.listenerRequest) return;
        if (payload.pending) this.host.pending.set(true);
        void this.refresh();
      });
      if (this.stopped || request !== this.listenerRequest) { this.release(stop); return; }
      this.listener = stop; this.host.listenError.set('');
    } catch {
      if (!this.stopped && request === this.listenerRequest) this.host.listenError.set('Incoming-link notifications are unavailable. Retry to reconnect.');
    }
  }

  private release(listener: (() => void) | null): void {
    // Invalidated callbacks already ignore events. A failed native unlisten
    // must not prevent teardown or prevent a fresh subscription on retry.
    try { void Promise.resolve(listener?.()).catch(() => undefined); }
    catch { /* The old callback remains inert even if native cleanup fails. */ }
  }

  stop(): void {
    this.stopped = true; ++this.listenerRequest; ++this.stateRequest;
    this.release(this.listener); this.listener = null; this.host.loading.set(false);
  }

  async retry(): Promise<void> { await this.connect(); await this.refresh(); }

  private apply(state: IncomingRepositoryLinkState): void {
    this.host.supported.set(true); this.host.state.set(state);
    this.host.pending.set(state.requests.length > 0 || state.overflowed);
    this.host.readError.set('');
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    const request = ++this.stateRequest;
    this.host.loading.set(true);
    try {
      const state = await ipc.incoming_repository_links();
      if (this.stopped || request !== this.stateRequest) return;
      if (!state || !Array.isArray(state.requests)) return;
      this.apply(state); await this.host.refreshPolicies();
    } catch {
      if (!this.stopped && request === this.stateRequest) {
        this.host.supported.set(true); this.host.pending.set(true);
        this.host.readError.set('Incoming links could not be read. Retry to preserve the pending requests.');
      }
    } finally { if (!this.stopped && request === this.stateRequest) this.host.loading.set(false); }
  }

  async acknowledge(requestId: string): Promise<boolean> {
    if (this.stopped) return false;
    const request = ++this.stateRequest;
    try {
      const state = await ipc.acknowledge_incoming_repository_link({ requestId });
      if (this.stopped || request !== this.stateRequest) return false;
      this.apply(state); await this.host.refreshPolicies(); return true;
    } catch {
      if (!this.stopped && request === this.stateRequest) this.host.readError.set('That request could not be dismissed. Refresh the incoming links and retry.');
      return false;
    }
  }

  async dismissOverflow(): Promise<void> {
    if (this.stopped) return;
    const request = ++this.stateRequest;
    try {
      const state = await ipc.dismiss_incoming_repository_link_overflow();
      if (this.stopped || request !== this.stateRequest) return;
      this.apply(state); await this.host.refreshPolicies();
    } catch {
      if (!this.stopped && request === this.stateRequest) this.host.readError.set('The overflow notice could not be dismissed. Refresh and retry.');
    }
  }
}
