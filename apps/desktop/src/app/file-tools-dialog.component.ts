import { afterNextRender, afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type FileToolReviewPurpose, type FileToolSessionSnapshot, type PreparedFileToolCleanup, type PreparedFileToolLaunch, type PreparedFileToolResult, type PreparedFileToolStage } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { CONFIGURED_TOOLS } from './configured-tools.service';
import { BackgroundOperationWarningsComponent } from './background-operation-warnings.component';
import { CancellableOperation } from './cancellable-operation';
import { FileToolActionsService } from './file-tool-actions.service';
import type { FileToolsDialogRequest } from './file-tools-dialog-request';
type ActionSafety = { inspection: string; refreshRepoId?: string; cancellationSupported?: boolean };
type Operation = {
  id: string; kind: string; cancelled: boolean; cancellation: CancellableOperation;
  cancellationSupported: boolean; safety: ActionSafety | null;
};
@Component({
  selector: 'gc-file-tools-dialog', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackgroundOperationWarningsComponent],
  templateUrl: './file-tools-dialog.component.html', styleUrl: './file-tools-dialog.component.scss',
})
export class FileToolsDialogComponent implements OnDestroy {
  readonly request = input.required<FileToolsDialogRequest>();
  readonly closed = output<void>();
  readonly changed = output<string>();
  readonly git = inject(GitKhronosService);
  readonly tools = inject(CONFIGURED_TOOLS);
  readonly actions = inject(FileToolActionsService);
  readonly profileId = signal('');
  readonly role = computed<'editor' | 'merge' | 'diff'>(() => this.request().action?.kind === 'editor' ? 'editor' : this.request().action?.kind === 'merge' ? 'merge' : 'diff');
  readonly profiles = computed(() => this.tools.profiles().filter(profile => profile.role === this.role()));
  readonly profile = computed(() => this.profiles().find(profile => profile.id === this.profileId()) ?? null);
  readonly sessions = signal<FileToolSessionSnapshot[]>([]);
  readonly selectedId = signal('');
  readonly selected = computed(() => this.sessions().find(session => session.id === this.selectedId()) ?? null);
  readonly busy = signal('');
  readonly refreshing = signal(false);
  readonly cancelling = signal(false);
  readonly cancellationAccepted = signal(false);
  readonly cancellationAttempted = signal(false);
  readonly cancellationError = signal('');
  readonly nativeFinished = signal(false);
  readonly error = signal('');
  readonly statusError = signal('');
  readonly notice = signal('');
  readonly inspectedUnknown = signal(false);
  readonly finishedEditing = signal(false);
  readonly finishedUsingFiles = signal(false);
  readonly launchReview = signal<PreparedFileToolLaunch | null>(null);
  readonly resultReview = signal<PreparedFileToolResult | null>(null);
  readonly stageReview = signal<PreparedFileToolStage | null>(null);
  readonly cleanupReview = signal<PreparedFileToolCleanup | null>(null);
  readonly unavailable = computed(() => !!this.busy() || !!this.actions.pending() || !!this.actions.uncertain()
    || this.git.busy() || this.git.browserPreview());
  readonly canCancel = computed(() => !!this.busy() && !this.nativeFinished() && !!this.operation?.cancellationSupported);
  readonly canPrepare = computed(() => !!this.request().action && !!this.profile() && !this.unavailable()
    && this.request().repoId === this.git.activeRepositoryId());
  private readonly binding = computed(() => JSON.stringify([this.request().repoId, this.request().action, this.profile()]));
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly reviewBox = viewChild<ElementRef<HTMLElement>>('reviewBox');
  private readonly sessionHeading = viewChild<ElementRef<HTMLElement>>('sessionHeading');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private readonly focusRequest = signal<'heading' | 'review' | 'session' | null>(null);
  private readonly focusedReview = afterRenderEffect(() => {
    const request = this.focusRequest(); if (!request) return;
    const target = request === 'review' ? this.reviewBox() : request === 'session' ? this.sessionHeading() : this.heading();
    if (target) { target.nativeElement.focus(); this.focusRequest.set(null); }
  });
  private readonly contextId = crypto.randomUUID();
  private launchBinding = '';
  private operation: Operation | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private closing = false;
  private observedPendingAction = false;
  private readonly retireChangedLaunch = effect(() => {
    if (this.launchReview() && this.launchBinding !== this.binding()) this.invalidateLaunch();
  });
  private readonly refreshAfterAction = effect(() => {
    if (this.actions.pending()) { this.observedPendingAction = true; return; }
    if (this.observedPendingAction && !this.destroyed) {
      this.observedPendingAction = false;
      untracked(() => void this.refreshSessions(true, true));
    }
  });
  constructor() {
    afterNextRender(() => {
      this.profileId.set(this.tools.defaultFor(this.role())?.id ?? '');
      this.heading()?.nativeElement.focus();
      if (!this.git.browserPreview()) {
        void this.refreshSessions();
        this.timer = setInterval(() => {
          if (!this.busy() && this.sessions().some(session => session.process?.state === 'running' || session.phase === 'launching')) void this.refreshSessions(false);
        }, 1000);
      }
    });
  }
  private alive(operation: Operation): boolean { return !this.destroyed && !this.closing && this.operation === operation; }
  private current(operation: Operation): boolean { return this.alive(operation) && !operation.cancelled; }
  private message(reason: unknown): string {
    const error = reason as Partial<AppError> | null;
    return typeof error?.message === 'string' && error.message.length <= 4096
      ? error.message + (typeof error.hint === 'string' && error.hint.length <= 4096 ? ' ' + error.hint : '')
      : 'The tool request could not be confirmed. Inspect the session before another action.';
  }
  private async discard(purpose: FileToolReviewPurpose, token: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Review retirement did not respond.')), 1000);
      });
      await Promise.race([ipc.discard_file_tool_review({ request: { contextId: this.contextId, purpose, token } }), deadline]);
    } catch (reason) {
      const message = `An unused review could not be retired. Private tool copies may remain; inspect them before retrying. ${this.message(reason)}`;
      if (this.destroyed || this.closing) this.git.reportBackgroundOperationWarning(`${this.contextId}:review:${purpose}:${token}`, message);
      else this.error.set(message);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  private async awaitNative<T>(operation: Operation, reply: Promise<T>): Promise<T> {
    try { return await reply; }
    finally {
      operation.cancellation.finish();
      if (this.alive(operation)) {
        const restoreFocus = this.cancelButton()?.nativeElement === document.activeElement;
        this.nativeFinished.set(true);
        if (restoreFocus) this.focusRequest.set('heading');
      }
    }
  }
  private async retireReview(operation: Operation, purpose: FileToolReviewPurpose, token: string): Promise<void> {
    if (this.alive(operation)) this.busy.set('Retiring unused tool review…');
    await this.discard(purpose, token);
  }
  invalidateLaunch(): void {
    const old = this.launchReview(); this.launchReview.set(null); this.launchBinding = '';
    if (old) void this.discard('launch', old.token);
  }
  private clearSessionReviews(): void {
    const result = this.resultReview(), stage = this.stageReview(), cleanup = this.cleanupReview();
    this.resultReview.set(null); this.stageReview.set(null); this.cleanupReview.set(null);
    this.finishedEditing.set(false); this.finishedUsingFiles.set(false);
    if (result) void this.discard('result', result.token);
    if (stage) void this.discard('stage', stage.token);
    if (cleanup) void this.discard('cleanup', cleanup.token);
  }
  requestedLabel(session: FileToolSessionSnapshot): string {
    const value = Number(session.requestedAtMillis), date = new Date(value);
    return /^\d+$/.test(session.requestedAtMillis) && Number.isSafeInteger(value) && !Number.isNaN(date.getTime())
      ? date.toLocaleString() : 'Request time unavailable';
  }
  stateLabel(session: FileToolSessionSnapshot): string {
    if (session.phase === 'launching') return 'Starting command';
    if (session.phase === 'failed') return 'Program did not start';
    if (session.phase === 'cleanupFailed') return 'Private files retained';
    return session.process?.state === 'running' ? 'Owned command running' : session.process?.state === 'exited' ? 'Owned command exited' : 'Command state unknown';
  }
  quote(argument: string): string { return JSON.stringify(argument); }
  chooseProfile(id: string): void { if (!this.busy()) { this.profileId.set(id); this.invalidateLaunch(); } }
  chooseSession(id: string): void { if (!this.busy()) { this.invalidateLaunch(); this.clearSessionReviews(); this.selectedId.set(id); } }
  async refreshSessions(showError = true, replace = false): Promise<void> {
    if (this.destroyed || this.closing || (this.refreshing() && !replace) || this.busy() || this.git.browserPreview()) return;
    const generation = ++this.generation; this.refreshing.set(true);
    try {
      const sessions = await ipc.list_file_tool_sessions();
      if (!this.destroyed && generation === this.generation) {
        this.sessions.set(sessions); this.statusError.set('');
        if (!sessions.some(session => session.id === this.selectedId())) { this.selectedId.set(''); this.clearSessionReviews(); }
      }
    } catch (reason) { if (!this.destroyed && generation === this.generation) this.statusError.set(showError ? this.message(reason) : 'Tool status could not be refreshed. Earlier results are retained; refresh before another action.'); }
    finally { if (!this.destroyed && generation === this.generation) this.refreshing.set(false); }
  }
  private upsert(session: FileToolSessionSnapshot): void {
    const active = document.activeElement;
    const focusResult = active === document.body || active === this.heading()?.nativeElement
      || active === this.cancelButton()?.nativeElement;
    this.generation++; this.refreshing.set(false);
    this.sessions.update(rows => rows.filter(row => row.id !== session.id).concat(session)); this.selectedId.set(session.id);
    if (focusResult) this.focusRequest.set('session');
  }
  private requireInspection(operation: Operation): void {
    if (!operation.safety) return;
    this.actions.requireInspection({ id: operation.id, guidance: operation.safety.inspection });
    if (this.alive(operation)) this.inspectedUnknown.set(false);
    else this.git.reportBackgroundOperationWarning(`${operation.id}:outcome`,
      `The external tool action's outcome was not confirmed. ${operation.safety.inspection}`);
  }
  private async refreshDetachedRepository(operation: Operation, repoId: string): Promise<void> {
    let refreshed = false;
    try { refreshed = await this.git.refreshRepositoryInBackground(repoId); }
    catch { /* Report the failed refresh below. */ }
    if (!refreshed) this.git.reportBackgroundOperationWarning(`${operation.id}:refresh`,
      'The external tool action finished, but repository status could not be refreshed. Refresh the repository and inspect its files and index.');
  }
  private async perform(kind: string, action: (operation: Operation) => Promise<void>, safety: ActionSafety | null = null): Promise<void> {
    if (this.busy() || this.destroyed || this.closing || this.git.browserPreview() || this.actions.pending() || this.actions.uncertain()) return;
    const id = crypto.randomUUID();
    const operation: Operation = { id, kind, cancelled: false, cancellation: new CancellableOperation(id),
      cancellationSupported: safety?.cancellationSupported !== false, safety };
    if (safety && !this.actions.begin({ id, description: kind })) return;
    this.operation = operation;
    this.busy.set(kind); this.error.set(''); this.notice.set(''); this.cancelling.set(false);
    this.cancellationAccepted.set(false); this.cancellationAttempted.set(false); this.cancellationError.set(''); this.nativeFinished.set(false);
    this.focusRequest.set('heading');
    try { await action(operation); }
    catch (reason) {
      if (safety) this.requireInspection(operation);
      if (this.alive(operation)) this.error.update(current => current ? `${current}\n${this.message(reason)}` : this.message(reason));
      else if (!safety && (!operation.cancelled
        || !(typeof reason === 'object' && reason !== null && 'kind' in reason && reason.kind === 'operationCancelled'))) {
        this.git.reportBackgroundOperationWarning(`${id}:outcome`, this.message(reason));
      }
    }
    finally {
      operation.cancellation.finish();
      if (this.alive(operation)) {
        const restoreFocus = this.cancelButton()?.nativeElement === document.activeElement;
        if (operation.cancelled && !this.notice() && !this.error()) this.notice.set(safety
          ? 'Cancellation was requested. Inspect the resulting session and files; a launched program may continue.'
          : 'Cancellation was requested. No new tool action was started.');
        this.operation = null; this.busy.set(''); this.cancelling.set(false); this.cancellationError.set('');
        if (restoreFocus) this.focusRequest.set('heading');
      }
      if (safety) this.actions.finish(id);
      if (this.destroyed && safety?.refreshRepoId) void this.refreshDetachedRepository(operation, safety.refreshRepoId);
    }
  }
  async prepareLaunch(): Promise<void> {
    const profile = this.profile(), action = this.request().action;
    if (!profile || !action || !this.canPrepare()) return;
    this.invalidateLaunch(); this.clearSessionReviews(); const binding = this.binding(), request = this.request();
    await this.perform('Preparing launch review…', async operation => {
      const prepared = await this.awaitNative(operation, ipc.prepare_file_tool_launch({ request: { repoId: request.repoId, contextId: this.contextId,
        operationId: operation.id, request: structuredClone(action), profile: structuredClone(profile) } }));
      if (!this.current(operation) || binding !== this.binding()) { await this.retireReview(operation, 'launch', prepared.token); return; }
      if (!/^[a-f0-9]{32}$/.test(prepared.token) || prepared.review.profileId !== profile.id || prepared.review.role !== profile.role
        || prepared.review.executable !== profile.executable || prepared.review.profileName !== profile.name) {
        await this.retireReview(operation, 'launch', prepared.token); throw Error('The launch review no longer matches the selected program. Prepare a fresh review.');
      }
      this.launchBinding = binding; this.launchReview.set(prepared); this.focusRequest.set('review');
    });
  }
  async launch(): Promise<void> {
    const review = this.launchReview(), captured = this.request(); if (!review || this.unavailable()) return;
    if (this.launchBinding !== this.binding()) { this.invalidateLaunch(); return; }
    this.launchReview.set(null); this.launchBinding = '';
    await this.perform('Starting reviewed program…', async operation => {
      const session = await this.awaitNative(operation, ipc.launch_reviewed_file_tool({ request: { contextId: this.contextId, token: review.token, operationId: operation.id } }));
      if (session.repoId !== captured.repoId || session.review.profileId !== review.review.profileId || session.review.executable !== review.review.executable) throw Error('The launch response did not match the reviewed program. Inspect active tool sessions.');
      if (this.alive(operation)) { this.upsert(session); this.notice.set(session.phase === 'failed' ? 'The program did not start. Inspect the recorded error and retained files.' : 'Launch recorded. A launcher exit does not confirm saving or merge resolution.'); }
    }, { inspection: 'Refresh tool sessions and inspect the program and its files before starting another command.' });
  }
  acknowledgeUnknown(): void {
    if (this.inspectedUnknown() && !this.busy() && !this.actions.pending()) {
      this.actions.acknowledge(); this.inspectedUnknown.set(false);
      this.notice.set('Earlier tool action inspected. Any new action still requires its own review.');
    }
  }
  async stop(): Promise<void> {
    const selected = this.selected(); if (!selected || this.unavailable()) return;
    await this.perform('Stopping owned command…', async operation => {
      const current = await this.awaitNative(operation, ipc.stop_file_tool_command({ sessionId: selected.id }));
      if (current.id !== selected.id || current.repoId !== selected.repoId) throw Error('The stop reply did not match the selected session. Inspect the owned process and recorded tools.');
      if (this.alive(operation)) { this.upsert(current); this.notice.set('Stop requested only for the owned command. Shared IDEs and separate GUI handoffs are not terminated.'); }
    }, { inspection: 'Inspect the owned process and tool session before another action.', cancellationSupported: false });
  }
  async reviewResult(): Promise<void> {
    const selected = this.selected(); if (!selected || this.unavailable() || this.statusError()) return;
    this.invalidateLaunch(); this.clearSessionReviews();
    await this.perform('Inspecting current tool output…', async operation => {
      const result = await this.awaitNative(operation, ipc.review_file_tool_result({ request: { sessionId: selected.id, contextId: this.contextId, operationId: operation.id } }));
      if (!this.current(operation)) { await this.retireReview(operation, 'result', result.token); return; }
      if (result.sessionId !== selected.id || !/^[a-f0-9]{32}$/.test(result.token)) { await this.retireReview(operation, 'result', result.token); throw Error('The output review did not match this session. Refresh tools before another action.'); }
      this.resultReview.set(result); this.finishedEditing.set(false); this.focusRequest.set('review');
    });
  }
  async saveResult(): Promise<void> {
    const review = this.resultReview(); if (!review || !this.finishedEditing() || this.unavailable()) return;
    const repoId = this.sessions().find(session => session.id === review.sessionId)?.repoId;
    if (!repoId) { this.error.set('The tool session is no longer available. Refresh sessions before saving.'); return; }
    this.resultReview.set(null);
    await this.perform('Saving reviewed merge output…', async operation => {
      const result = await this.awaitNative(operation, ipc.save_reviewed_file_tool_result({ request: { contextId: this.contextId, token: review.token, operationId: operation.id, finishedEditing: true } }));
      if (result.session.id !== review.sessionId || result.session.repoId !== repoId) throw Error('The save reply did not match the reviewed session. Inspect the working file and recorded tools.');
      if (result.write.status === 'unconfirmed') this.requireInspection(operation);
      if (this.alive(operation)) { this.upsert(result.session); this.notice.set(result.write.warning ?? (result.write.status === 'unconfirmed' ? 'Save outcome is unconfirmed. Inspect the working file before another action.' : 'Reviewed output saved. The index is unchanged; staging requires a separate review.')); this.changed.emit(result.session.repoId); }
    }, { inspection: 'Inspect the working file and recorded tool session before another action.', refreshRepoId: repoId });
  }
  async reviewStage(): Promise<void> {
    const selected = this.selected(); if (!selected || this.unavailable() || this.statusError()) return;
    this.invalidateLaunch(); this.clearSessionReviews();
    await this.perform('Reviewing saved-file staging…', async operation => {
      const stage = await this.awaitNative(operation, ipc.review_file_tool_staging({ request: { sessionId: selected.id, contextId: this.contextId, operationId: operation.id } }));
      if (!this.current(operation)) { await this.retireReview(operation, 'stage', stage.token); return; }
      if (stage.sessionId !== selected.id || !/^[a-f0-9]{32}$/.test(stage.token)) { await this.retireReview(operation, 'stage', stage.token); throw Error('The staging review did not match this session. Refresh tools before another action.'); }
      this.stageReview.set(stage); this.focusRequest.set('review');
    });
  }
  async stageResult(): Promise<void> {
    const review = this.stageReview(); if (!review || this.unavailable()) return;
    const repoId = this.sessions().find(session => session.id === review.sessionId)?.repoId;
    if (!repoId) { this.error.set('The tool session is no longer available. Refresh sessions before staging.'); return; }
    this.stageReview.set(null);
    await this.perform('Staging reviewed saved result…', async operation => {
      const result = await this.awaitNative(operation, ipc.stage_reviewed_file_tool_result({ request: { contextId: this.contextId, token: review.token, operationId: operation.id } }));
      if (result.session.id !== review.sessionId || result.session.repoId !== repoId) throw Error('The staging reply did not match the reviewed session. Inspect the Git index and recorded tools.');
      if (!result.stage.confirmed) this.requireInspection(operation);
      if (this.alive(operation)) { this.upsert(result.session); this.notice.set(result.stage.confirmed ? 'Saved result staged.' : 'Staging is unconfirmed. Inspect the index before another action.'); if (result.stage.error) this.error.set(this.message(result.stage.error)); if (result.stage.warning) this.error.set(result.stage.warning); this.changed.emit(result.session.repoId); }
    }, { inspection: 'Inspect the Git index and recorded tool session before another action.', refreshRepoId: repoId });
  }
  cleanupAvailable(session: FileToolSessionSnapshot): boolean { return session.phase === 'failed' || session.phase === 'cleanupFailed' || session.process?.state === 'exited'; }
  async reviewCleanup(): Promise<void> {
    const selected = this.selected(); if (!selected || !this.cleanupAvailable(selected) || this.unavailable() || this.statusError()) return;
    this.invalidateLaunch(); this.clearSessionReviews();
    await this.perform('Reviewing private-file cleanup…', async operation => {
      const cleanup = await this.awaitNative(operation, ipc.review_file_tool_cleanup({ request: { sessionId: selected.id, contextId: this.contextId, operationId: operation.id } }));
      if (!this.current(operation)) { await this.retireReview(operation, 'cleanup', cleanup.token); return; }
      if (cleanup.sessionId !== selected.id || !/^[a-f0-9]{32}$/.test(cleanup.token)) { await this.retireReview(operation, 'cleanup', cleanup.token); throw Error('The cleanup review did not match this session. Refresh tools before another action.'); }
      this.cleanupReview.set(cleanup); this.finishedUsingFiles.set(false); this.focusRequest.set('review');
    });
  }
  async cleanup(): Promise<void> {
    const review = this.cleanupReview(); if (!review || !this.finishedUsingFiles() || this.unavailable()) return; this.cleanupReview.set(null);
    await this.perform('Removing reviewed private copies…', async operation => {
      const removed = await this.awaitNative(operation, ipc.discard_reviewed_file_tool_session({ request: { contextId: this.contextId, token: review.token, operationId: operation.id, finishedUsingFiles: true } }));
      if (!removed) throw Error('Tool cleanup was not confirmed. Refresh sessions and inspect the retained files.');
      if (this.alive(operation)) { this.generation++; this.sessions.update(rows => rows.filter(row => row.id !== review.sessionId)); this.selectedId.set(''); this.notice.set('Tool session retired. Working files and the Git index were not changed by cleanup.'); }
    }, { inspection: 'Inspect the private copies and tool sessions before another action.' });
  }
  async cancelRequest(): Promise<void> {
    const operation = this.operation;
    if (!operation || !operation.cancellationSupported || this.cancelling()) return;
    operation.cancelled = true; this.cancellationAttempted.set(true); this.cancelling.set(true);
    await this.requestCancellation(operation);
  }
  close(): void {
    if (this.destroyed || this.closing) return;
    this.closing = true;
    this.closed.emit();
  }
  private async requestCancellation(operation: Operation): Promise<void> {
    const result = await operation.cancellation.cancel();
    if (result === 'finished' || operation.cancellation.settled) return;
    if (result === 'accepted') {
      if (this.alive(operation)) { this.cancellationAccepted.set(true); this.cancellationError.set(''); }
      return;
    }
    const detail = typeof result === 'object' ? ` ${this.message(result.error)}` : '';
    const message = `Cancellation was not confirmed. The tool request may still be running; wait for its outcome and inspect the session.${detail}`;
    if (this.alive(operation)) { this.cancellationError.set(message); this.cancelling.set(false); }
    else this.git.reportBackgroundOperationWarning(`${operation.id}:cancellation`, message);
  }
  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    if (!controls.length) { event.preventDefault(); return; } const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)!.focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  }
  ngOnDestroy(): void {
    this.destroyed = true; if (this.timer) clearInterval(this.timer); this.invalidateLaunch(); this.clearSessionReviews();
    const operation = this.operation;
    if (operation) {
      operation.cancelled = true;
      if (operation.safety) this.git.reportBackgroundOperationWarning(`${operation.id}:closed`,
        `An external tool action was still running when the panel closed. ${operation.safety.inspection}`);
      if (operation.cancellationSupported) void this.requestCancellation(operation);
    }
    const target = this.request().returnFocus; queueMicrotask(() => { if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true }); });
  }
}
