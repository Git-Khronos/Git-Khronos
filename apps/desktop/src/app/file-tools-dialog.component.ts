import { afterNextRender, afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type FileToolReviewPurpose, type FileToolSessionSnapshot, type PreparedFileToolCleanup, type PreparedFileToolLaunch, type PreparedFileToolResult, type PreparedFileToolStage } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { CONFIGURED_TOOLS } from './configured-tools.service';
import type { FileToolsDialogRequest } from './file-tools-dialog-request';
type Operation = { id: string; kind: string; cancelled: boolean };
@Component({
  selector: 'gc-file-tools-dialog', changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-tools-dialog.component.html', styleUrl: './file-tools-dialog.component.scss',
})
export class FileToolsDialogComponent implements OnDestroy {
  readonly request = input.required<FileToolsDialogRequest>();
  readonly closed = output<void>();
  readonly changed = output<string>();
  readonly git = inject(GitKhronosService);
  readonly tools = inject(CONFIGURED_TOOLS);
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
  readonly error = signal('');
  readonly statusError = signal('');
  readonly notice = signal('');
  readonly launchUnknown = signal(false);
  readonly inspectedUnknown = signal(false);
  readonly finishedEditing = signal(false);
  readonly finishedUsingFiles = signal(false);
  readonly launchReview = signal<PreparedFileToolLaunch | null>(null);
  readonly resultReview = signal<PreparedFileToolResult | null>(null);
  readonly stageReview = signal<PreparedFileToolStage | null>(null);
  readonly cleanupReview = signal<PreparedFileToolCleanup | null>(null);
  readonly unavailable = computed(() => !!this.busy() || this.git.busy() || this.git.browserPreview());
  readonly canPrepare = computed(() => !!this.request().action && !!this.profile() && !this.unavailable()
    && !this.launchUnknown() && this.request().repoId === this.git.activeRepositoryId());
  private readonly binding = computed(() => JSON.stringify([this.request().repoId, this.request().action, this.profile()]));
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly reviewBox = viewChild<ElementRef<HTMLElement>>('reviewBox');
  private readonly sessionHeading = viewChild<ElementRef<HTMLElement>>('sessionHeading');
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
  private readonly retireChangedLaunch = effect(() => {
    if (this.launchReview() && this.launchBinding !== this.binding()) this.invalidateLaunch();
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
  private alive(operation: Operation): boolean { return !this.destroyed && this.operation === operation; }
  private current(operation: Operation): boolean { return this.alive(operation) && !operation.cancelled; }
  private message(reason: unknown): string {
    const error = reason as Partial<AppError> | null;
    return typeof error?.message === 'string' && error.message.length <= 4096
      ? error.message + (typeof error.hint === 'string' && error.hint.length <= 4096 ? ' ' + error.hint : '')
      : 'The tool request could not be confirmed. Inspect the session before another action.';
  }
  private async discard(purpose: FileToolReviewPurpose, token: string): Promise<void> {
    try { await ipc.discard_file_tool_review({ request: { contextId: this.contextId, purpose, token } }); }
    catch { if (!this.destroyed) this.error.set('An unused review could not be retired. It expires after five minutes and will not execute automatically.'); }
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
  async refreshSessions(showError = true): Promise<void> {
    if (this.destroyed || this.refreshing() || this.busy() || this.git.browserPreview()) return;
    const generation = ++this.generation; this.refreshing.set(true);
    try {
      const sessions = await ipc.list_file_tool_sessions();
      if (!this.destroyed && generation === this.generation) {
        this.sessions.set(sessions); this.statusError.set('');
        if (!sessions.some(session => session.id === this.selectedId())) { this.selectedId.set(''); this.clearSessionReviews(); }
      }
    } catch (reason) { if (!this.destroyed && generation === this.generation) this.statusError.set(showError ? this.message(reason) : 'Tool status could not be refreshed. Earlier results are retained; refresh before another action.'); }
    finally { if (!this.destroyed) this.refreshing.set(false); }
  }
  private upsert(session: FileToolSessionSnapshot): void {
    this.generation++; this.sessions.update(rows => rows.filter(row => row.id !== session.id).concat(session)); this.selectedId.set(session.id); this.focusRequest.set('session');
  }
  private async perform(kind: string, action: (operation: Operation) => Promise<void>): Promise<void> {
    if (this.busy() || this.destroyed || this.git.browserPreview()) return;
    const operation = { id: crypto.randomUUID(), kind, cancelled: false }; this.operation = operation;
    this.busy.set(kind); this.error.set(''); this.notice.set(''); this.cancelling.set(false); this.focusRequest.set('heading');
    try { await action(operation); }
    catch (reason) { if (this.alive(operation)) this.error.set(this.message(reason)); }
    finally {
      if (this.alive(operation)) {
        if (operation.cancelled && !this.notice() && !this.error()) this.notice.set('Cancellation was requested. Inspect the resulting session and files; a launched program may continue.');
        this.operation = null; this.busy.set(''); this.cancelling.set(false);
      }
    }
  }
  async prepareLaunch(): Promise<void> {
    const profile = this.profile(), action = this.request().action;
    if (!profile || !action || !this.canPrepare()) return;
    this.invalidateLaunch(); this.clearSessionReviews(); const binding = this.binding(), request = this.request();
    await this.perform('Preparing launch review…', async operation => {
      const prepared = await ipc.prepare_file_tool_launch({ request: { repoId: request.repoId, contextId: this.contextId,
        operationId: operation.id, request: structuredClone(action), profile: structuredClone(profile) } });
      if (!this.current(operation) || binding !== this.binding()) { await this.discard('launch', prepared.token); return; }
      if (!/^[a-f0-9]{32}$/.test(prepared.token) || prepared.review.profileId !== profile.id || prepared.review.role !== profile.role
        || prepared.review.executable !== profile.executable || prepared.review.profileName !== profile.name) {
        await this.discard('launch', prepared.token); throw Error('The launch review no longer matches the selected program. Prepare a fresh review.');
      }
      this.launchBinding = binding; this.launchReview.set(prepared); this.focusRequest.set('review');
    });
  }
  async launch(): Promise<void> {
    const review = this.launchReview(), captured = this.request(); if (!review || this.unavailable()) return;
    if (this.launchBinding !== this.binding()) { this.invalidateLaunch(); return; }
    this.launchReview.set(null); this.launchBinding = '';
    await this.perform('Starting reviewed program…', async operation => {
      try {
        const session = await ipc.launch_reviewed_file_tool({ request: { contextId: this.contextId, token: review.token, operationId: operation.id } });
        if (!this.alive(operation)) return;
        if (session.repoId !== captured.repoId || session.review.profileId !== review.review.profileId || session.review.executable !== review.review.executable) throw Error('The launch response did not match the reviewed program. Inspect active tool sessions.');
        this.upsert(session); this.notice.set(session.phase === 'failed' ? 'The program did not start. Inspect the recorded error and retained files.' : 'Launch recorded. A launcher exit does not confirm saving or merge resolution.');
      } catch (reason) { if (this.alive(operation)) { this.launchUnknown.set(true); this.inspectedUnknown.set(false); } throw reason; }
    });
  }
  acknowledgeUnknown(): void {
    if (this.inspectedUnknown() && !this.busy()) { this.launchUnknown.set(false); this.inspectedUnknown.set(false); this.notice.set('Earlier launch inspected. A new launch still requires a fresh review.'); }
  }
  async stop(): Promise<void> {
    const selected = this.selected(); if (!selected || this.busy()) return;
    await this.perform('Stopping owned command…', async operation => {
      const current = await ipc.stop_file_tool_command({ sessionId: selected.id });
      if (this.alive(operation)) { this.upsert(current); this.notice.set('Stop requested only for the owned command. Shared IDEs and separate GUI handoffs are not terminated.'); }
    });
  }
  async reviewResult(): Promise<void> {
    const selected = this.selected(); if (!selected || this.unavailable() || this.statusError()) return;
    this.invalidateLaunch(); this.clearSessionReviews();
    await this.perform('Inspecting current tool output…', async operation => {
      const result = await ipc.review_file_tool_result({ request: { sessionId: selected.id, contextId: this.contextId, operationId: operation.id } });
      if (!this.current(operation)) { await this.discard('result', result.token); return; }
      if (result.sessionId !== selected.id || !/^[a-f0-9]{32}$/.test(result.token)) { await this.discard('result', result.token); throw Error('The output review did not match this session. Refresh tools before another action.'); }
      this.resultReview.set(result); this.finishedEditing.set(false); this.focusRequest.set('review');
    });
  }
  async saveResult(): Promise<void> {
    const review = this.resultReview(); if (!review || !this.finishedEditing() || this.unavailable()) return;
    this.resultReview.set(null);
    await this.perform('Saving reviewed merge output…', async operation => {
      const result = await ipc.save_reviewed_file_tool_result({ request: { contextId: this.contextId, token: review.token, operationId: operation.id, finishedEditing: true } });
      if (this.alive(operation) && result.session.id !== review.sessionId) throw Error('The save reply did not match the reviewed session. Inspect the working file and recorded tools.');
      if (this.alive(operation)) { this.upsert(result.session); this.notice.set(result.write.warning ?? (result.write.status === 'unconfirmed' ? 'Save outcome is unconfirmed. Inspect the working file before another action.' : 'Reviewed output saved. The index is unchanged; staging requires a separate review.')); this.changed.emit(result.session.repoId); }
    });
  }
  async reviewStage(): Promise<void> {
    const selected = this.selected(); if (!selected || this.unavailable() || this.statusError()) return;
    this.invalidateLaunch(); this.clearSessionReviews();
    await this.perform('Reviewing saved-file staging…', async operation => {
      const stage = await ipc.review_file_tool_staging({ request: { sessionId: selected.id, contextId: this.contextId, operationId: operation.id } });
      if (!this.current(operation)) { await this.discard('stage', stage.token); return; }
      if (stage.sessionId !== selected.id || !/^[a-f0-9]{32}$/.test(stage.token)) { await this.discard('stage', stage.token); throw Error('The staging review did not match this session. Refresh tools before another action.'); }
      this.stageReview.set(stage); this.focusRequest.set('review');
    });
  }
  async stageResult(): Promise<void> {
    const review = this.stageReview(); if (!review || this.unavailable()) return; this.stageReview.set(null);
    await this.perform('Staging reviewed saved result…', async operation => {
      const result = await ipc.stage_reviewed_file_tool_result({ request: { contextId: this.contextId, token: review.token, operationId: operation.id } });
      if (this.alive(operation) && result.session.id !== review.sessionId) throw Error('The staging reply did not match the reviewed session. Inspect the Git index and recorded tools.');
      if (this.alive(operation)) { this.upsert(result.session); this.notice.set(result.stage.confirmed ? 'Saved result staged.' : 'Staging is unconfirmed. Inspect the index before another action.'); if (result.stage.error) this.error.set(this.message(result.stage.error)); if (result.stage.warning) this.error.set(result.stage.warning); this.changed.emit(result.session.repoId); }
    });
  }
  cleanupAvailable(session: FileToolSessionSnapshot): boolean { return session.phase === 'failed' || session.phase === 'cleanupFailed' || session.process?.state === 'exited'; }
  async reviewCleanup(): Promise<void> {
    const selected = this.selected(); if (!selected || !this.cleanupAvailable(selected) || this.unavailable() || this.statusError()) return;
    this.invalidateLaunch(); this.clearSessionReviews();
    await this.perform('Reviewing private-file cleanup…', async operation => {
      const cleanup = await ipc.review_file_tool_cleanup({ request: { sessionId: selected.id, contextId: this.contextId, operationId: operation.id } });
      if (!this.current(operation)) { await this.discard('cleanup', cleanup.token); return; }
      if (cleanup.sessionId !== selected.id || !/^[a-f0-9]{32}$/.test(cleanup.token)) { await this.discard('cleanup', cleanup.token); throw Error('The cleanup review did not match this session. Refresh tools before another action.'); }
      this.cleanupReview.set(cleanup); this.finishedUsingFiles.set(false); this.focusRequest.set('review');
    });
  }
  async cleanup(): Promise<void> {
    const review = this.cleanupReview(); if (!review || !this.finishedUsingFiles() || this.unavailable()) return; this.cleanupReview.set(null);
    await this.perform('Removing reviewed private copies…', async operation => {
      const removed = await ipc.discard_reviewed_file_tool_session({ request: { contextId: this.contextId, token: review.token, operationId: operation.id, finishedUsingFiles: true } });
      if (!removed) throw Error('Tool cleanup was not confirmed. Refresh sessions and inspect the retained files.');
      if (this.alive(operation)) { this.generation++; this.sessions.update(rows => rows.filter(row => row.id !== review.sessionId)); this.selectedId.set(''); this.notice.set('Tool session retired. Working files and the Git index were not changed by cleanup.'); }
    });
  }
  async cancelRequest(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return; operation.cancelled = true; this.cancelling.set(true);
    try { for (let attempt = 0; attempt < 3 && this.operation === operation; attempt++) { if (await ipc.cancel_git_operation({ operationId: operation.id })) return; await new Promise(resolve => setTimeout(resolve, 50)); } }
    catch { if (this.alive(operation)) this.error.set('Cancellation was not confirmed. Wait for the recorded outcome or inspect the session.'); }
    finally { if (this.alive(operation)) this.cancelling.set(false); }
  }
  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    if (!controls.length) { event.preventDefault(); return; } const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)!.focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  }
  ngOnDestroy(): void {
    this.destroyed = true; if (this.timer) clearInterval(this.timer); this.invalidateLaunch(); this.clearSessionReviews();
    if (this.operation) void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined);
    const target = this.request().returnFocus; queueMicrotask(() => { if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true }); });
  }
}
