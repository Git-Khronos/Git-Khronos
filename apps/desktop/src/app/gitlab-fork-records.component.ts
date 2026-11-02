import { afterNextRender, afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type ForkRecordEntry, type ForkRecordList, type ForkRecordRefresh, type ForkRecordView, type GitLabConnection } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

type Operation = { id: string; kind: 'listing' | 'inspecting' | 'archiving'; cancelled: boolean };
@Component({ selector: 'gc-gitlab-fork-records', changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gitlab-fork-records.component.html', styleUrl: './gitlab-fork-records.component.scss' })
export class GitLabForkRecordsComponent implements OnDestroy {
  readonly connection = input<GitLabConnection | null>(null);
  readonly initialId = input<string | null>(null);
  readonly back = output<void>();
  readonly git = inject(GitKhronosService);
  readonly listing = signal<ForkRecordList | null>(null);
  readonly observation = signal<ForkRecordRefresh | null>(null);
  readonly stale = signal(false); readonly busy = signal<Operation['kind'] | null>(null);
  readonly cancelling = signal(false); readonly error = signal(''); readonly notice = signal('');
  readonly acknowledgements = signal<ReadonlySet<string>>(new Set());
  readonly unavailable = computed(() => !!this.busy() || this.git.busy() || this.git.browserPreview());
  private operation: Operation | null = null; private closing = false; private destroyed = false;
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly errorBox = viewChild<ElementRef<HTMLElement>>('errorBox');
  private readonly observationBox = viewChild<ElementRef<HTMLElement>>('observationBox');
  private readonly focusError = afterRenderEffect(() => { if (this.error()) this.errorBox()?.nativeElement.focus(); });
  private readonly focusObservation = afterRenderEffect(() => { if (this.observation()) this.observationBox()?.nativeElement.focus(); });
  private previousConnection: string | null | undefined;
  private readonly changedConnection = effect(() => {
    const connection = this.connection(), key = connection ? JSON.stringify([connection.connectionId, connection.account.origin, connection.account.id]) : null;
    if (this.previousConnection !== undefined && key !== this.previousConnection) untracked(() => {
      if (this.operation?.kind === 'inspecting') void this.cancel();
      this.observation.set(null); this.notice.set('The connected account changed. Saved records remain local; inspect again with a matching account.');
    });
    this.previousConnection = key;
  });
  constructor() { afterNextRender(() => { this.heading()?.nativeElement.focus(); if (!this.git.browserPreview()) void this.load(); }); }
  private alive(operation: Operation): boolean { return !this.closing && !this.destroyed && this.operation === operation; }
  private accepted(operation: Operation): boolean { return this.alive(operation) && !operation.cancelled; }
  private async perform(kind: Operation['kind'], action: (operation: Operation) => Promise<void>): Promise<void> {
    if (this.unavailable() || this.closing || this.destroyed) return;
    const operation = { id: crypto.randomUUID(), kind, cancelled: false }; this.operation = operation;
    this.busy.set(kind); this.cancelling.set(false); this.error.set(''); this.notice.set('');
    try { await action(operation); }
    catch (reason) {
      if (this.alive(operation)) {
        const error = reason as Partial<AppError> | null;
        this.error.set(typeof error?.message === 'string' && error.message.length <= 2048 ? error.message : 'The saved outcome operation could not be confirmed. Reload saved outcomes before another action.');
        this.stale.set(true);
      }
    } finally {
      if (this.operation === operation) {
        this.operation = null; this.busy.set(null); this.cancelling.set(false);
        if (operation.cancelled && !this.error()) this.notice.set('Waiting stopped. Reload saved outcomes before another action.');
      }
    }
  }
  async load(): Promise<void> {
    await this.perform('listing', async operation => {
      const result = await ipc.list_gitlab_fork_records({ request: { operationId: operation.id } });
      if (!this.accepted(operation)) return;
      this.listing.set(result); this.stale.set(false); this.observation.set(null); this.acknowledgements.set(new Set());
      this.notice.set('Saved outcomes loaded. No creation request was sent.');
    });
  }
  matching(record: ForkRecordView): boolean {
    const connection = this.connection();
    return !!connection && connection.account.origin === record.origin && connection.account.id === record.accountId;
  }
  private actionable(entry: ForkRecordEntry): boolean {
    return !this.unavailable() && !this.stale() && !entry.retired && !entry.pending && !entry.operationActive && !!entry.record
      && this.listing()?.entries.some(item => item === entry) === true;
  }
  canInspect(entry: ForkRecordEntry): boolean { return this.actionable(entry) && !!entry.record && this.matching(entry.record); }
  async inspect(entry: ForkRecordEntry): Promise<void> {
    const connection = this.connection(), record = entry.record; if (!connection || !record || !this.canInspect(entry)) return;
    this.observation.set(null);
    await this.perform('inspecting', async operation => {
      const result = await ipc.reconcile_gitlab_fork_record({ request: { connectionId: connection.connectionId, recordId: entry.id, expectedRevision: record.revision, operationId: operation.id } });
      if (!this.accepted(operation) || connection.connectionId !== this.connection()?.connectionId) { this.stale.set(true); return; }
      if (result.observation.id !== entry.id || result.observation.origin !== record.origin || result.observation.accountId !== record.accountId
        || result.observation.sourceId !== record.sourceId || result.observation.targetFullPath !== record.targetFullPath) throw Error('The inspected outcome did not match the saved request. Reload before continuing.');
      this.observation.set(result);
      if (result.persisted) {
        this.listing.update(list => list ? { ...list, entries: list.entries.map(item => item === entry ? { ...item, record: result.observation } : item) } : list);
        this.notice.set('Fresh metadata was saved. It does not establish who created the project or confirm Git connectivity.');
      } else { this.stale.set(true); this.notice.set('Fresh metadata could not be saved. The stored revision remains unchanged. Reload saved outcomes before another action.'); }
    });
  }
  acknowledge(id: string, checked: boolean): void {
    if (this.unavailable()) return;
    this.acknowledgements.update(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
  }
  canArchive(entry: ForkRecordEntry): boolean { return this.actionable(entry) && this.acknowledgements().has(entry.id); }
  async archive(entry: ForkRecordEntry): Promise<void> {
    if (!this.canArchive(entry) || !entry.record) return;
    const revision = entry.record.revision;
    await this.perform('archiving', async operation => {
      const archived = await ipc.retire_gitlab_fork_record({ request: { recordId: entry.id, expectedRevision: revision, acknowledgeUnconfirmed: true, operationId: operation.id } });
      if (!this.accepted(operation)) { this.stale.set(true); return; }
      if (!archived) throw Error('Local archiving was not confirmed. Reload saved outcomes.');
      this.listing.update(list => list ? { ...list, entries: list.entries.map(item => item === entry ? { ...item, retired: true } : item) } : list);
      this.notice.set('The local outcome was archived. No project was deleted or changed on GitLab.');
    });
  }
  phase(record: ForkRecordView): string {
    return ({ awaitingConfirmation: 'Submission unconfirmed', acceptedPending: 'Import or inspection pending', metadataVerified: 'Project metadata verified', importFailed: 'Import failed', conflict: 'Project identity conflict', responseRejected: 'Request rejected' } as const)[record.phase] ?? 'Outcome unconfirmed';
  }
  cancelInspection(): void { if (this.operation?.kind === 'inspecting') void this.cancel(); }
  async cancel(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return;
    operation.cancelled = true; this.cancelling.set(true); this.stale.set(true);
    try { if (!await ipc.cancel_git_operation({ operationId: operation.id }) && this.alive(operation)) this.error.set('Stopping the wait was not acknowledged. Reload saved outcomes when it finishes.'); }
    catch { if (this.alive(operation)) this.error.set('Stopping the wait could not be confirmed. Reload saved outcomes when it finishes.'); }
  }
  returnToProjects(): void { if (!this.unavailable()) { this.dismiss(); this.back.emit(); } }
  dismiss(): void {
    if (this.closing) return; this.closing = true;
    if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); }
  }
  ngOnDestroy(): void { this.dismiss(); this.destroyed = true; }
}
