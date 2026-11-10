import type { WritableSignal } from '@angular/core';
import { events, ipc, type IncomingRepositoryLinkState } from '@git-khronos/contracts';
import type { AsyncStateController } from './async-state';

interface IncomingLinksHost {
  read: AsyncStateController<IncomingRepositoryLinkState>;
  pending: WritableSignal<boolean>;
  supported: WritableSignal<boolean>;
  listenError: WritableSignal<string>;
  mutationError: WritableSignal<string>;
  refreshPolicies(): Promise<void>;
}

/** Loaded before native tab restoration; an inactive renderer never owns listeners. */
export class IncomingLinksController {
  private listener: (() => void) | null = null;
  private listenerRequest = 0;
  private acceptedSnapshot = 0;
  private mutationEpoch = 0;
  private readonly confirmedDismissals = new Set<string>();
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
    this.stopped = true; ++this.listenerRequest;
    this.host.read.invalidate();
    this.release(this.listener); this.listener = null;
  }

  async retry(): Promise<void> { await this.connect(); await this.refresh(); }

  private validate(state: IncomingRepositoryLinkState): void {
    if (!state || !Array.isArray(state.requests) || typeof state.overflowed !== 'boolean') {
      throw new Error('Invalid incoming-link inbox response');
    }
  }

  private apply(request: number, state: IncomingRepositoryLinkState, reconcilesUncertainty = false): void {
    this.validate(state);
    const requests = state.requests.filter(item => !this.confirmedDismissals.has(item.id));
    if (!this.host.read.publish(request, { ...state, requests })) return;
    for (const id of this.confirmedDismissals) {
      if (!state.requests.some(item => item.id === id)) this.confirmedDismissals.delete(id);
    }
    ++this.acceptedSnapshot;
    this.host.supported.set(true);
    if (reconcilesUncertainty) this.host.mutationError.set('');
    this.host.pending.set(requests.length > 0 || state.overflowed || Boolean(this.host.mutationError()));
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    const mutationEpoch = this.mutationEpoch;
    const request = this.host.read.begin();
    try {
      const state = await ipc.incoming_repository_links();
      if (this.stopped || !this.host.read.isCurrent(request)) return;
      this.apply(request, state, mutationEpoch === this.mutationEpoch); await this.host.refreshPolicies();
    } catch {
      if (!this.stopped && this.host.read.isCurrent(request)) {
        this.host.supported.set(true); this.host.pending.set(true);
        this.host.read.fail(request, 'Incoming links could not be read. Retry to preserve the pending requests.');
      }
    } finally { this.host.read.finish(request); }
  }

  async acknowledge(requestId: string): Promise<boolean> {
    if (this.stopped || this.host.mutationError()) return false;
    const request = this.host.read.begin(false);
    let confirmed = false;
    try {
      const state = await ipc.acknowledge_incoming_repository_link({ requestId });
      this.validate(state); confirmed = true;
      if (this.stopped) return true;
      this.confirmedDismissals.add(requestId);
      if (this.host.read.isCurrent(request)) this.apply(request, state);
      else {
        this.host.read.updateValue(value => ({
          ...value, requests: value.requests.filter(item => item.id !== requestId),
        }));
        ++this.acceptedSnapshot;
      }
      await this.host.refreshPolicies(); return true;
    } catch {
      if (!this.stopped) {
        if (confirmed) this.host.read.fail(request,
          'The request was dismissed, but read policies could not refresh. Retry reading the incoming links.');
        else this.requireReconciliation(
          'Dismissal could not be confirmed. Refresh the incoming links before deciding whether to retry.');
      }
      return confirmed;
    } finally { this.host.read.finish(request); }
  }

  async dismissOverflow(): Promise<void> {
    if (this.stopped || this.host.mutationError()) return;
    const request = this.host.read.begin(false);
    const acceptedSnapshot = this.acceptedSnapshot;
    let confirmed = false;
    try {
      const state = await ipc.dismiss_incoming_repository_link_overflow();
      this.validate(state); confirmed = true;
      if (this.stopped) return;
      if (this.host.read.isCurrent(request)) this.apply(request, state);
      else if (acceptedSnapshot === this.acceptedSnapshot) {
        this.host.read.updateValue(value => ({ ...value, overflowed: state.overflowed }));
        ++this.acceptedSnapshot;
      }
      await this.host.refreshPolicies();
    } catch {
      if (!this.stopped) {
        if (confirmed) this.host.read.fail(request,
          'The overflow notice was dismissed, but read policies could not refresh. Retry reading the incoming links.');
        else this.requireReconciliation(
          'Overflow dismissal could not be confirmed. Refresh the incoming links before deciding whether to retry.');
      }
    } finally { this.host.read.finish(request); }
  }

  private requireReconciliation(message: string): void {
    ++this.mutationEpoch;
    this.host.supported.set(true);
    this.host.pending.set(true);
    this.host.mutationError.set(message);
  }
}
