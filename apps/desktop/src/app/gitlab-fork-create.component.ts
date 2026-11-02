import { afterNextRender, afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type ForkSubmissionOutcome, type GitLabConnection, type GitLabAccount, type GitLabNamespacePage, type GitLabProject, type PreparedFork } from '@git-khronos/contracts';

import { GitKhronosService } from './git-khronos.service';

const sameAccount = (a: GitLabAccount, b: GitLabAccount) => a.origin === b.origin && a.id === b.id && a.login === b.login;
type Operation = { id: string; scope: string; kind: 'namespaces' | 'preparing' | 'submitting'; cancelled: boolean };
const identity = (value: string) => /^[a-f0-9]{32}$/.test(value);
@Component({ selector: 'gc-gitlab-fork-create', changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gitlab-fork-create.component.html', styleUrl: './gitlab-fork-create.component.scss' })
export class GitLabForkCreateComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly connection = input.required<GitLabConnection>();
  readonly project = input.required<GitLabProject>();
  readonly back = output<void>();
  readonly outcomes = output<string | null>();
  readonly search = signal(''); readonly ownedOnly = signal(false);
  readonly namespaces = signal<GitLabNamespacePage | null>(null);
  readonly namespaceId = signal(''); readonly projectPath = signal(''); readonly projectName = signal('');
  readonly prepared = signal<PreparedFork | null>(null); readonly outcome = signal<ForkSubmissionOutcome | null>(null);
  readonly uncertain = signal(false); readonly busy = signal<Operation['kind'] | null>(null);
  readonly cancelling = signal(false); readonly error = signal(''); readonly notice = signal('');
  readonly selectedNamespace = computed(() => this.namespaces()?.entries.find(item => item.id === this.namespaceId()) ?? null);
  readonly searchError = computed(() => new TextEncoder().encode(this.search()).byteLength > 256 || /[\u0000-\u001f\u007f]/.test(this.search()));
  readonly pathError = computed(() => !/^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(this.projectPath()) || this.projectPath().length > 255);
  readonly nameError = computed(() => this.projectName() !== this.projectName().trim() || Array.from(this.projectName()).length > 255 || /[\u0000-\u001f\u007f]/.test(this.projectName()));
  readonly locked = computed(() => !!this.busy() || !!this.outcome() || this.uncertain() || this.git.busy() || this.git.browserPreview());
  readonly namespaceQueryChanged = computed(() => !!this.namespaces() && this.appliedQuery() !== JSON.stringify([this.search(), this.ownedOnly()]));
  readonly canPrepare = computed(() => this.connection().canCreateFork && !this.locked() && !this.prepared() && !this.namespaceQueryChanged()
    && !!this.selectedNamespace() && !this.pathError() && !this.nameError());
  private readonly scope = computed(() => JSON.stringify([this.connection().connectionId, this.connection().account, this.project().id, this.project().fullPath]));
  private readonly binding = computed(() => JSON.stringify([this.scope(), this.namespaceId(), this.projectPath(), this.projectName()]));
  private readonly context = crypto.randomUUID(); private preparedBinding = ''; private readonly appliedQuery = signal('');
  private operation: Operation | null = null; private closing = false; private destroyed = false; private previousScope: string | null = null;
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly review = viewChild<ElementRef<HTMLElement>>('review');
  private readonly errorBox = viewChild<ElementRef<HTMLElement>>('errorBox');
  private readonly reviewFocus = afterRenderEffect(() => { if (this.prepared()) this.review()?.nativeElement.focus(); });
  private readonly errorFocus = afterRenderEffect(() => { if (this.error()) this.errorBox()?.nativeElement.focus(); });
  private readonly resetScope = effect(() => {
    const scope = this.scope();
    if (this.previousScope !== null && scope !== this.previousScope) untracked(() => {
      this.invalidate(); this.stop(); this.namespaces.set(null); this.namespaceId.set(''); this.outcome.set(null); this.uncertain.set(false);
      this.notice.set('The account or source changed. Load namespaces and prepare a new review.');
    });
    this.previousScope = scope;
  });
  constructor() { afterNextRender(() => { this.projectPath.set(this.project().fullPath.split('/').at(-1) ?? ''); this.heading()?.nativeElement.focus(); }); }
  private alive(operation: Operation): boolean { return !this.closing && !this.destroyed && this.operation === operation && operation.scope === this.scope(); }
  private accepted(operation: Operation): boolean { return this.alive(operation) && !operation.cancelled; }
  private message(reason: unknown): string {
    const value = reason as Partial<AppError> | null;
    return typeof value?.message === 'string' && value.message.length <= 2048 ? value.message : 'The fork operation could not be confirmed. Inspect saved outcomes before another submission.';
  }
  private async discard(token: string): Promise<void> {
    if (!identity(token)) return;
    try { await ipc.discard_gitlab_fork({ context: this.context, token }); }
    catch { if (!this.destroyed) this.error.set('The unused review could not be cleared. It will expire; it will not submit automatically.'); }
  }
  invalidate(): void { const old = this.prepared(); this.prepared.set(null); this.preparedBinding = ''; if (old) void this.discard(old.token); }
  change(kind: 'search' | 'path' | 'name' | 'namespace', value: string): void {
    if (this.locked()) return; this.invalidate();
    if (kind === 'search') { this.search.set(value); this.namespaceId.set(''); }
    else if (kind === 'path') this.projectPath.set(value);
    else if (kind === 'name') this.projectName.set(value);
    else this.namespaceId.set(value);
  }
  changeOwned(value: boolean): void { if (!this.locked()) { this.invalidate(); this.ownedOnly.set(value); this.namespaceId.set(''); } }
  private async perform(kind: Operation['kind'], action: (operation: Operation) => Promise<void>): Promise<void> {
    if (this.locked() || this.closing || this.destroyed) return;
    const operation = { id: crypto.randomUUID(), scope: this.scope(), kind, cancelled: false }; this.operation = operation;
    this.busy.set(kind); this.error.set(''); this.notice.set(''); this.cancelling.set(false);
    try { await action(operation); }
    catch (reason) { if (this.alive(operation)) { if (kind === 'submitting') this.uncertain.set(true); this.error.set(this.message(reason)); } }
    finally { if (this.operation === operation) { this.operation = null; this.busy.set(null); this.cancelling.set(false); if (operation.cancelled && !this.error() && !this.outcome()) this.notice.set('Waiting stopped. Load fresh data before preparing another review.'); } }
  }
  async loadNamespaces(page = 1): Promise<void> {
    if (this.searchError() || this.locked() || !this.connection().canCreateFork || page !== 1 && this.namespaceQueryChanged()) return;
    this.invalidate(); this.namespaceId.set(''); const connection = this.connection(), search = this.search(), ownedOnly = this.ownedOnly();
    await this.perform('namespaces', async operation => {
      const result = await ipc.load_gitlab_namespaces({ request: { connectionId: connection.connectionId, operationId: operation.id, query: { page, search, ownedOnly } } });
      if (!this.accepted(operation) || search !== this.search() || ownedOnly !== this.ownedOnly()) return;
      if (!sameAccount(result.account, connection.account) || result.page !== page || result.entries.length > 20) throw Error('Namespace results did not match the selected account and page.');
      this.namespaces.set(result); this.appliedQuery.set(JSON.stringify([search, ownedOnly]));
      this.notice.set('Select a namespace. GitLab checks creation permission when the reviewed request is submitted.');
    });
  }
  async prepare(): Promise<void> {
    if (!this.canPrepare()) return;
    const connection = this.connection(), source = this.project(), namespace = this.selectedNamespace()!, path = this.projectPath(), name = this.projectName() || null, binding = this.binding();
    await this.perform('preparing', async operation => {
      const result = await ipc.prepare_gitlab_fork({ request: { connectionId: connection.connectionId, context: this.context, operationId: operation.id,
        selection: { sourceId: source.id, sourceFullPath: source.fullPath, namespace: { id: namespace.id, fullPath: namespace.fullPath, kind: namespace.kind }, projectPath: path, projectName: name } } });
      if (!this.accepted(operation) || this.binding() !== binding) { await this.discard(result.token); return; }
      const preview = result.preview;
      if (!identity(result.token) || !sameAccount(preview.account, connection.account) || preview.source.id !== source.id || preview.source.fullPath !== source.fullPath
        || preview.namespace.id !== namespace.id || preview.namespace.fullPath !== namespace.fullPath || preview.namespace.kind !== namespace.kind
        || preview.projectPath !== path || preview.projectName !== name || preview.targetFullPath !== `${namespace.fullPath}/${path}`) {
        await this.discard(result.token); throw Error('The fork review changed its account, source or destination. Prepare it again from fresh data.');
      }
      this.preparedBinding = binding; this.prepared.set(result);
    });
  }
  async submit(): Promise<void> {
    const prepared = this.prepared(); if (!prepared || this.preparedBinding !== this.binding() || this.locked()) return;
    this.prepared.set(null); this.preparedBinding = '';
    await this.perform('submitting', async operation => {
      const result = await ipc.execute_gitlab_fork({ request: { context: this.context, token: prepared.token, operationId: operation.id } });
      // A cancelled wait can still return a durable accepted/uncertain outcome.
      if (!this.alive(operation)) return;
      if (!identity(result.recordId)) throw Error('The outcome identity was not confirmed. Inspect saved outcomes.');
      this.outcome.set(result); this.notice.set('The request outcome was retained. Inspect it before cloning or starting another request.');
    });
  }
  outcomeLabel(value: ForkSubmissionOutcome): string {
    return ({ awaitingConfirmation: 'Submission not confirmed', acceptedAwaitingInspection: 'Accepted; inspect import status', responseRejected: 'GitLab rejected the request', storageUnconfirmed: 'Local outcome storage is unconfirmed' } as const)[value.phase] ?? 'Submission not confirmed';
  }
  viewOutcomes(): void { if (!this.busy()) this.outcomes.emit(this.outcome()?.recordId ?? null); }
  async cancel(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return; operation.cancelled = true; this.cancelling.set(true);
    try { const stopped = await ipc.cancel_git_operation({ operationId: operation.id }); if (!stopped && this.alive(operation)) this.error.set('Stopping the wait was not acknowledged. Keep the outcome for inspection.'); }
    catch { if (this.alive(operation)) this.error.set('Cancellation could not be confirmed. Keep the outcome for inspection.'); }
  }
  private stop(): void { if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); } this.operation = null; this.busy.set(null); }
  returnToForks(): void { if (!this.busy()) { this.dismiss(); this.back.emit(); } }
  preventSubmit(event: KeyboardEvent): void { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); } }
  dismiss(): void { if (!this.closing) { this.closing = true; this.invalidate(); this.stop(); } }
  ngOnDestroy(): void { this.dismiss(); this.destroyed = true; }
}
