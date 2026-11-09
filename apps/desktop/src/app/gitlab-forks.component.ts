import { afterNextRender, afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type GitLabAccount, type GitLabConnection, type GitLabForkImportState, type GitLabForkInspection, type GitLabForkPage, type GitLabProject } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { GitLabForkCreateComponent } from './gitlab-fork-create.component';
import { GitLabCloneComponent } from './gitlab-clone.component';

type Operation = { id: string; scope: string; cancelled: boolean };
const sameAccount = (a: GitLabAccount, b: GitLabAccount) => a.origin === b.origin && a.id === b.id && a.login === b.login;
@Component({
  selector: 'gc-gitlab-forks', imports: [GitLabCloneComponent, GitLabForkCreateComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gitlab-forks.component.html', styleUrl: './gitlab-forks.component.scss',
})
export class GitLabForksComponent implements OnDestroy {
  readonly connection = input.required<GitLabConnection>();
  readonly project = input.required<GitLabProject>();
  readonly initialParentPath = input('');
  readonly back = output<void>();
  readonly opening = output<void>();
  readonly outcomes = output<string | null>();
  readonly creating = signal(false);
  private readonly creator = viewChild(GitLabForkCreateComponent);
  readonly opened = output<void>();
  readonly git = inject(GitKhronosService);
  readonly search = signal('');
  readonly appliedSearch = signal('');
  readonly page = signal<GitLabForkPage | null>(null);
  readonly inspection = signal<GitLabForkInspection | null>(null);
  readonly stale = signal(false);
  readonly busy = signal('');
  readonly cancelling = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly cloneTarget = signal<{ key: string; connection: GitLabConnection; project: GitLabProject } | null>(null);
  private readonly clone = viewChild(GitLabCloneComponent);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly errorBox = viewChild<ElementRef<HTMLElement>>('errorBox');
  private readonly details = viewChild<ElementRef<HTMLElement>>('details');
  private readonly focusDetails = signal(false);
  private readonly focusResult = afterRenderEffect(() => {
    if (this.focusDetails() && this.details()) { this.details()!.nativeElement.focus(); this.focusDetails.set(false); }
  });
  private readonly focusError = afterRenderEffect(() => { if (this.error()) this.errorBox()?.nativeElement.focus(); });
  readonly unavailable = computed(() => !!this.busy() || !!this.cloneTarget() || this.creating() || this.git.busy() || this.git.browserPreview());
  readonly searchError = computed(() => new TextEncoder().encode(this.search()).byteLength > 256
    || /[\u0000-\u001f\u007f]/.test(this.search()) ? 'Use a single-line fork search of at most 256 bytes.' : '');
  readonly queryChanged = computed(() => !!this.page() && this.search() !== this.appliedSearch());
  readonly pageMatches = computed(() => {
    const page = this.page(); return !!page && sameAccount(page.account, this.connection().account)
      && page.source.id === this.project().id && page.source.fullPath === this.project().fullPath;
  });
  readonly canRead = computed(() => !this.unavailable() && !this.searchError());
  private readonly scope = computed(() => JSON.stringify([this.connection(), this.project().id, this.project().fullPath, this.project().url]));
  private previousScope: string | null = null;
  private readonly resetChangedScope = effect(() => {
    const scope = this.scope();
    if (this.previousScope !== null && scope !== this.previousScope) untracked(() => this.reset());
    this.previousScope = scope;
  });
  private operation: Operation | null = null;
  private closing = false;
  private destroyed = false;
  constructor() {
    afterNextRender(() => { if (!this.closing && !this.destroyed) { this.heading()?.nativeElement.focus(); void this.load(); } });
  }
  private alive(operation: Operation): boolean { return !this.closing && !this.destroyed && this.operation === operation && operation.scope === this.scope(); }
  private accepted(operation: Operation): boolean { return this.alive(operation) && !operation.cancelled; }
  private message(reason: unknown): string {
    const value = reason as Partial<AppError> | null;
    return typeof value?.message === 'string' && value.message.length <= 2048 ? value.message
      : 'The GitLab fork read could not complete. Review the selected account and reload.';
  }
  private reset(): void {
    this.creator()?.dismiss(); this.creating.set(false);
    this.clone()?.dismiss(); this.cloneTarget.set(null);
    if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); }
    this.operation = null; this.busy.set(''); this.cancelling.set(false); this.page.set(null); this.inspection.set(null);
    this.stale.set(false); this.error.set(''); this.notice.set('The selected account or source changed. Reload forks.');
  }
  private async perform(label: string, action: (operation: Operation) => Promise<void>): Promise<void> {
    if (this.unavailable() || this.closing || this.destroyed) return;
    const operation = { id: crypto.randomUUID(), scope: this.scope(), cancelled: false }; this.operation = operation;
    this.busy.set(label); this.error.set(''); this.notice.set(''); this.cancelling.set(false);
    try { await action(operation); }
    catch (reason) { if (this.alive(operation)) this.error.set(this.message(reason)); }
    finally {
      if (this.operation === operation) {
        this.operation = null; this.busy.set(''); this.cancelling.set(false);
        if (!this.closing && !this.destroyed && operation.cancelled && !this.error()) this.notice.set('Fork read cancelled. Earlier results are retained and need refreshing.');
      }
    }
  }
  async load(number = 1): Promise<void> {
    if (!this.canRead() || number !== 1 && (!this.pageMatches() || this.stale() || this.queryChanged())) return;
    const connection = this.connection(), source = this.project(), search = this.search();
    this.stale.set(!!this.page()); this.inspection.set(null);
    await this.perform('Reading accessible forks…', async operation => {
      const result = await ipc.load_gitlab_forks({ request: { connectionId: connection.connectionId, operationId: operation.id,
        query: { sourceProjectId: source.id, sourceFullPath: source.fullPath, page: number, search } } });
      if (!this.accepted(operation) || this.search() !== search) return;
      if (!sameAccount(result.account, connection.account) || result.source.id !== source.id || result.source.fullPath !== source.fullPath
        || result.page !== number || !Array.isArray(result.entries) || result.entries.length > 20) throw Error('The fork page did not match this source and account. Reload the source project.');
      this.page.set(result); this.appliedSearch.set(search); this.stale.set(false); this.notice.set(`Loaded fork page ${result.page}. Inspect a candidate before using it.`);
    });
  }
  canInspect(project: GitLabProject): boolean {
    return !this.unavailable() && this.pageMatches() && !this.stale() && !this.queryChanged()
      && !!this.page()?.entries.some(entry => entry.id === project.id && entry.fullPath === project.fullPath);
  }
  async inspect(project: GitLabProject): Promise<void> {
    if (!this.canInspect(project)) return;
    const connection = this.connection(), source = this.project(); this.inspection.set(null);
    await this.perform('Checking the selected fork relationship…', async operation => {
      const result = await ipc.inspect_gitlab_fork({ request: { connectionId: connection.connectionId, operationId: operation.id,
        selection: { sourceProjectId: source.id, sourceFullPath: source.fullPath, forkProjectId: project.id, forkFullPath: project.fullPath } } });
      if (!this.accepted(operation)) return;
      if (!sameAccount(result.account, connection.account) || result.source.id !== source.id || result.source.fullPath !== source.fullPath
        || result.project.id !== project.id || result.project.fullPath !== project.fullPath || result.project.url !== project.url) throw Error('The selected fork identity or relationship changed. Reload forks before continuing.');
      this.inspection.set(result); this.focusDetails.set(true);
    });
  }
  inspectAgain(): void { const project = this.inspection()?.project; if (project) void this.inspect(project); }
  reviewClone(): void {
    const result = this.inspection(); if (!result || !this.canInspect(result.project) || (!result.cloneHttps && !result.cloneSsh)) return;
    this.cloneTarget.set({ key: crypto.randomUUID(), connection: this.connection(), project: result.project });
  }
  closeClone(): void {
    this.clone()?.dismiss(); this.cloneTarget.set(null); this.focusDetails.set(true);
  }
  importLabel(state: GitLabForkImportState): string {
    return ({ none: 'None reported', scheduled: 'Queued', started: 'Running', finished: 'Finished', failed: 'Failed', unknown: 'Unknown' } as const)[state] ?? 'Unknown';
  }
  async cancel(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return;
    operation.cancelled = true; this.cancelling.set(true);
    try {
      const acknowledged = await ipc.cancel_git_operation({ operationId: operation.id });
      if (!acknowledged && this.alive(operation)) this.error.set('Cancellation was not acknowledged. Wait for the read to finish; its late data will be ignored.');
    } catch { if (this.alive(operation)) this.error.set('Cancellation could not be confirmed. Late data will be ignored.'); }
  }
  preventSubmit(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.isComposing) { event.preventDefault(); event.stopPropagation(); void this.load(); }
  }
  startCreation(): void { if (!this.unavailable() && this.connection().canCreateFork) this.creating.set(true); }
  closeCreation(): void { this.creator()?.dismiss(); this.creating.set(false); this.heading()?.nativeElement.focus(); }
  inspectOutcomes(id: string | null): void { this.closeCreation(); this.outcomes.emit(id); }
  executing(): boolean { return this.clone()?.executing() ?? false; }
  returnToProjects(): void { if (!this.unavailable()) { this.dismiss(); this.back.emit(); } }
  dismiss(): void {
    if (this.closing) return;
    this.closing = true; this.creator()?.dismiss(); this.clone()?.dismiss();
    if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); }
  }
  ngOnDestroy(): void { this.dismiss(); this.destroyed = true; }
}
