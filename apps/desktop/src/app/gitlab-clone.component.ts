import { afterNextRender, afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type GitLabAccount, type GitLabCloneRequest, type GitLabConnection, type GitLabProject, type GitLabProjectInspection, type HostedCloneTransport, type PreparedGitLabClone } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

type Operation = { id: string; kind: 'inspecting' | 'preparing' | 'cloning'; cancelled: boolean };
function sameAccount(a: GitLabAccount, b: GitLabAccount): boolean {
  return a.origin === b.origin && a.id === b.id && a.login === b.login;
}

@Component({
  selector: 'gc-gitlab-clone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gitlab-clone.component.html',
  styleUrl: './gitlab-clone.component.scss',
})
export class GitLabCloneComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly connection = input.required<GitLabConnection>();
  readonly project = input.required<GitLabProject>();
  readonly initialParentPath = input('');
  readonly opening = output<void>();
  readonly opened = output<void>();
  readonly back = output<void>();
  readonly busyChange = output<boolean>();
  readonly inspection = signal<GitLabProjectInspection | null>(null);
  readonly preview = signal<PreparedGitLabClone | null>(null);
  readonly transport = signal<HostedCloneTransport>('https');
  readonly parentPath = signal('');
  readonly folder = signal('');
  readonly branch = signal('');
  readonly shallow = signal(false);
  readonly depth = signal(1);
  readonly recurse = signal(false);
  readonly busy = signal<Operation['kind'] | null>(null);
  readonly picking = signal(false);
  readonly cancelling = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly unavailable = computed(() => !!this.busy() || this.picking() || this.git.busy() || this.git.browserPreview());
  readonly selectedUrl = computed(() => this.transport() === 'https' ? this.inspection()?.cloneHttps : this.inspection()?.cloneSsh);
  readonly ready = computed(() => !!this.inspection() && !!this.selectedUrl() && !!this.parentPath() && !!this.folder().trim()
    && (!this.shallow() || Number.isInteger(this.depth()) && this.depth() >= 1 && this.depth() <= 4294967295));
  private readonly binding = computed(() => JSON.stringify([this.connection().connectionId, this.project().id,
    this.transport(), this.parentPath(), this.folder(), this.branch(), this.shallow(), this.depth(), this.recurse()]));
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly options = viewChild<ElementRef<HTMLElement>>('options');
  private readonly review = viewChild<ElementRef<HTMLElement>>('review');
  private readonly errorBox = viewChild<ElementRef<HTMLElement>>('errorBox');
  private readonly focusOptions = signal(false);
  private readonly optionsFocus = afterRenderEffect(() => {
    if (this.focusOptions() && this.options()) { this.options()!.nativeElement.querySelector<HTMLElement>('select, input')?.focus(); this.focusOptions.set(false); }
  });
  private readonly reviewFocus = afterRenderEffect(() => this.review()?.nativeElement.focus());
  private readonly errorFocus = afterRenderEffect(() => { if (this.error()) this.errorBox()?.nativeElement.focus(); });
  private readonly contextId = crypto.randomUUID();
  private previewBinding = '';
  private operation: Operation | null = null;
  private closing = false;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      if (this.closing || this.destroyed) return;
      this.parentPath.set(this.initialParentPath());
      this.folder.set(this.project().fullPath.split('/').at(-1) ?? '');
      this.heading()?.nativeElement.focus();
      void this.inspect();
    });
  }
  private current(operation: Operation): boolean { return !this.closing && !this.destroyed && this.operation === operation && !operation.cancelled; }
  private message(reason: unknown, fallback: string): string {
    const error = reason as Partial<AppError> | null;
    return typeof error?.message === 'string' && error.message.length <= 4096
      ? `${error.message}${typeof error.hint === 'string' && error.hint.length <= 4096 ? ' ' + error.hint : ''}` : fallback;
  }
  private async discard(token: string): Promise<void> {
    if (!/^[a-f0-9]{32}$/.test(token)) return;
    try { await ipc.discard_gitlab_clone_plan({ contextId: this.contextId, token }); }
    catch { this.git.error.update(previous => previous || 'An unused GitLab clone review could not be cleared. It expires after five minutes; it will not execute automatically.'); }
  }
  invalidate(): void {
    const preview = this.preview(); this.preview.set(null); this.previewBinding = '';
    if (preview) void this.discard(preview.token);
  }
  async inspect(): Promise<void> {
    if (this.unavailable() || this.closing || this.destroyed) return;
    this.invalidate(); this.inspection.set(null);
    await this.perform('inspecting', async operation => {
      const result = await ipc.inspect_gitlab_project({ request: { connectionId: this.connection().connectionId,
        projectId: this.project().id, operationId: operation.id } });
      if (!this.current(operation)) return;
      if (!sameAccount(result.account, this.connection().account) || result.project.id !== this.project().id
        || result.project.fullPath !== this.project().fullPath) throw Error('The selected account or project changed. Return to projects and reload before cloning.');
      this.inspection.set(result);
      if (!this.selectedUrl()) this.transport.set(result.cloneHttps ? 'https' : 'ssh');
      this.notice.set('Project checked. Choose a destination and review the clone.'); this.focusOptions.set(true);
    });
  }
  async chooseParent(): Promise<void> {
    if (this.unavailable() || this.closing || this.destroyed) return;
    this.picking.set(true); this.busyChange.emit(true);
    try {
      const path = await this.git.chooseDirectory('Choose where to clone the GitLab project');
      if (!this.closing && !this.destroyed && path) { this.parentPath.set(path); this.invalidate(); }
    } catch (reason) { if (!this.closing && !this.destroyed) this.error.set(this.message(reason, 'A destination could not be selected.')); }
    finally { this.picking.set(false); if (!this.destroyed) this.busyChange.emit(false); }
  }
  async prepare(): Promise<void> {
    const selected = this.inspection();
    if (!selected || !this.ready() || this.unavailable() || this.closing || this.destroyed) return;
    this.invalidate(); const binding = this.binding();
    const request: GitLabCloneRequest = { projectId: selected.project.id, fullPath: selected.project.fullPath,
      transport: this.transport(), parentPath: this.parentPath(), folder: this.folder(), branch: this.branch() || null,
      depth: this.shallow() ? this.depth() : null, recurseSubmodules: this.recurse() };
    await this.perform('preparing', async operation => {
      const preview = await ipc.prepare_gitlab_clone({ request: { connectionId: this.connection().connectionId,
        contextId: this.contextId, request, operationId: operation.id } });
      if (!this.current(operation) || binding !== this.binding()) { await this.discard(preview.token); return; }
      const plan = preview.plan;
      if (!/^[a-f0-9]{32}$/.test(preview.token) || !sameAccount(plan.account, selected.account)
        || plan.project.id !== request.projectId || plan.project.fullPath !== request.fullPath || plan.project.url !== selected.project.url
        || plan.transport !== request.transport || plan.url !== this.selectedUrl() || plan.folder !== request.folder
        || plan.branch !== request.branch || plan.depth !== request.depth || plan.recurseSubmodules !== request.recurseSubmodules) {
        await this.discard(preview.token); this.inspection.set(null);
        throw Error('The clone review no longer matches the selected project or options. Refresh the selected project before reviewing again.');
      }
      this.previewBinding = binding; this.preview.set(preview);
    });
  }
  async apply(): Promise<void> {
    const preview = this.preview();
    if (!preview || this.unavailable() || this.closing || this.destroyed) return;
    if (this.previewBinding !== this.binding()) { this.invalidate(); this.error.set('Clone options changed. Review a fresh clone preview.'); return; }
    // A lost reply must never leave a clickable execution token.
    this.preview.set(null); this.previewBinding = '';
    await this.perform('cloning', async operation => {
      this.opening.emit();
      const opened = await this.git.cloneGitLabRepository(this.contextId, preview.token, operation.id);
      if (!this.closing && !this.destroyed && this.operation === operation) {
        if (opened) this.opened.emit();
        else this.error.set(`${this.git.error() ?? 'The clone result was not confirmed.'} Inspect ${preview.plan.destination} before preparing another clone; do not repeat execution blindly.`);
      }
    });
  }
  private async perform(kind: Operation['kind'], action: (operation: Operation) => Promise<void>): Promise<void> {
    if (this.unavailable() || this.closing || this.destroyed) return;
    const operation: Operation = { id: crypto.randomUUID(), kind, cancelled: false }; this.operation = operation;
    this.busy.set(kind); this.cancelling.set(false); this.error.set(''); this.notice.set(''); this.busyChange.emit(true);
    try { await action(operation); }
    catch (reason) { if (!this.closing && !this.destroyed && this.operation === operation) this.error.set(this.message(reason, 'The GitLab clone step could not complete. Review its state before retrying.')); }
    finally {
      if (!this.closing && !this.destroyed && operation.cancelled && !this.error()) this.notice.set(kind === 'cloning'
        ? 'Clone cancellation requested. Inspect the destination for partial data before retrying.' : 'GitLab clone request cancelled. Late reviews will be discarded.');
      if (this.operation === operation) { this.operation = null; this.busy.set(null); this.cancelling.set(false); }
      if (!this.destroyed) this.busyChange.emit(false);
    }
  }
  async cancel(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return;
    operation.cancelled = true; this.cancelling.set(true);
    try {
      for (let attempt = 0; attempt < 3 && this.operation === operation; attempt++) {
        if (await ipc.cancel_git_operation({ operationId: operation.id })) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!this.closing && !this.destroyed && this.operation === operation) this.error.set('Cancellation was not acknowledged. Wait for the result or retry cancellation.');
    } catch { if (!this.closing && !this.destroyed && this.operation === operation) this.error.set('Cancellation could not be confirmed. Late reviews will be ignored; wait for the operation result.'); }
    finally { if (this.operation === operation && !this.destroyed) this.cancelling.set(false); }
  }
  preventInputSubmit(event: KeyboardEvent): void {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.isComposing) { event.preventDefault(); event.stopPropagation(); }
  }
  executing(): boolean { return this.busy() === 'cloning'; }
  returnToProjects(): void { if (!this.unavailable()) { this.dismiss(); this.back.emit(); } }
  dismiss(): void {
    if (this.closing) return;
    this.closing = true; this.invalidate();
    if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); }
  }
  ngOnDestroy(): void { this.dismiss(); this.destroyed = true; }
}
