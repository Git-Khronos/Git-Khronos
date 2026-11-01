import { afterNextRender, afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type GitLabAccount, type GitLabConnection, type GitLabProjectPage, type GitLabProjectQuery, type GitLabProjectScope } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

type Operation = { id: string; generation: number; kind: 'connecting' | 'reading'; cancelled: boolean };
type Busy = Operation['kind'] | 'listing' | 'disconnecting' | null;
type Filters = Pick<GitLabProjectQuery, 'scope' | 'search' | 'includeArchived'>;

function sameAccount(a: GitLabAccount, b: GitLabAccount): boolean {
  return a.origin === b.origin && a.id === b.id && a.login === b.login;
}

@Component({
  selector: 'gc-gitlab-projects',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gitlab-projects.component.html',
  styleUrl: './gitlab-projects.component.scss',
})
export class GitLabProjectsComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly origin = signal('https://gitlab.com');
  readonly token = signal('');
  readonly showToken = signal(false);
  readonly connections = signal<GitLabConnection[]>([]);
  readonly connectionsStale = signal(false);
  readonly selectedId = signal('');
  readonly selected = computed(() => this.connections().find(item => item.connectionId === this.selectedId()) ?? null);
  readonly filters = signal<Filters>({ scope: 'membership', search: '', includeArchived: false });
  readonly page = signal<GitLabProjectPage | null>(null);
  readonly stale = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal<Busy>(null);
  readonly cancelling = signal(false);
  readonly unavailable = computed(() => !!this.busy() || this.git.busy() || this.git.browserPreview());
  readonly validOrigin = computed(() => {
    try {
      const value = this.origin(), parsed = new URL(value);
      return value === value.trim() && value.length <= 2048 && parsed.protocol === 'https:'
        && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/'
        && !value.includes('\\') && !/[\u0000-\u001f\u007f]/.test(value);
    } catch { return false; }
  });
  readonly canConnect = computed(() => !this.unavailable() && this.validOrigin() && !!this.token() && this.token().length <= 8192);
  readonly queryChanged = computed(() => {
    const previous = this.page()?.query, draft = this.filters();
    return !!previous && (previous.scope !== draft.scope || previous.search !== draft.search || previous.includeArchived !== draft.includeArchived);
  });
  readonly searchError = computed(() => new TextEncoder().encode(this.filters().search).byteLength > 256
    || /[\u0000-\u001f\u007f]/.test(this.filters().search) ? 'Use a shorter, single-line project search.' : '');
  readonly canRead = computed(() => !this.unavailable() && !this.connectionsStale() && !!this.selected()
    && !this.searchError());
  readonly canDisconnect = computed(() => !!this.selected() && !this.git.browserPreview()
    && (this.busy() === null || this.busy() === 'reading'));
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly errorBox = viewChild<ElementRef<HTMLElement>>('errorBox');
  private readonly focusError = afterRenderEffect(() => { if (this.error()) this.errorBox()?.nativeElement.focus({ preventScroll: true }); });
  private operation: Operation | null = null;
  private generation = 0;
  private closing = false;
  private destroyed = false;

  constructor() {
    afterNextRender(() => { this.heading()?.nativeElement.focus(); if (!this.git.browserPreview()) void this.refreshConnections(); });
  }
  private current(generation: number): boolean { return !this.destroyed && !this.closing && generation === this.generation; }
  private accepted(operation: Operation): boolean { return this.current(operation.generation) && this.operation === operation && !operation.cancelled; }
  private message(reason: unknown, fallback: string): string {
    const error = reason as Partial<AppError> | null;
    return typeof error?.kind === 'string' && (error.kind.startsWith('gitlab') || error.kind === 'operationCancelled')
      && typeof error.message === 'string' && error.message.length <= 2048 ? error.message : fallback;
  }
  changeOrigin(value: string): void {
    if (this.unavailable()) return;
    this.origin.set(value); this.token.set(''); this.showToken.set(false);
  }
  selectConnection(id: string): void {
    if (this.unavailable() || id && !this.connections().some(item => item.connectionId === id)) return;
    this.generation++; this.selectedId.set(id); this.page.set(null); this.stale.set(false); this.error.set(''); this.notice.set('');
  }
  setFilter(key: keyof Filters, value: string | boolean): void {
    if (this.unavailable()) return;
    if (key === 'scope') this.filters.update(previous => ({ ...previous, scope: value as GitLabProjectScope }));
    else if (key === 'search') this.filters.update(previous => ({ ...previous, search: String(value) }));
    else this.filters.update(previous => ({ ...previous, includeArchived: value === true }));
  }
  async refreshConnections(): Promise<void> {
    if (this.unavailable() || this.closing || this.destroyed) return;
    const generation = ++this.generation; this.busy.set('listing'); this.error.set('');
    try {
      const connections = await ipc.gitlab_connections();
      if (!this.current(generation)) return;
      this.connections.set(connections); this.connectionsStale.set(false);
      if (!connections.some(item => item.connectionId === this.selectedId())) {
        this.selectedId.set(''); this.page.set(null); this.stale.set(false);
      }
    } catch (reason) {
      if (this.current(generation)) { this.connectionsStale.set(true); this.error.set(this.message(reason, 'Connections could not be refreshed. Existing results were retained.')); }
    } finally { if (this.current(generation)) this.busy.set(null); }
  }
  private begin(kind: Operation['kind']): Operation {
    const operation = { id: crypto.randomUUID(), generation: ++this.generation, kind, cancelled: false };
    this.operation = operation; this.busy.set(kind); this.cancelling.set(false); this.error.set(''); this.notice.set('');
    return operation;
  }
  private finish(operation: Operation): void {
    if (this.operation !== operation) return;
    this.operation = null;
    if (this.current(operation.generation)) {
      this.busy.set(null); this.cancelling.set(false);
      if (operation.cancelled && !this.error()) this.notice.set(operation.kind === 'connecting' ? 'Connection request cancelled.' : 'Project read cancelled. Earlier results were retained.');
    }
  }
  private async retire(id: string): Promise<void> {
    try { await ipc.disconnect_gitlab_account({ connectionId: id }); }
    catch (reason) {
      const connections = await ipc.gitlab_connections().catch(() => null);
      if (connections && !connections.some(connection => connection.connectionId === id)) return;
      throw reason;
    }
  }
  private async retireLate(id: string): Promise<void> {
    try { await this.retire(id); }
    catch { this.git.error.update(previous => previous || 'A cancelled GitLab connection could not be cleared. Review active GitLab connections.'); }
  }
  async connect(): Promise<void> {
    if (!this.canConnect() || this.closing || this.destroyed) return;
    const origin = this.origin(), token = this.token(), existing = new Set(this.connections().map(item => item.connectionId));
    const operation = this.begin('connecting');
    this.token.set(''); this.showToken.set(false);
    try {
      const connection = await ipc.connect_gitlab_account({ request: { origin, token, operationId: operation.id } });
      if (!/^[a-f0-9]{32}$/.test(connection.connectionId) || existing.has(connection.connectionId)) {
        if (this.accepted(operation)) this.error.set('A new GitLab connection was not confirmed. Refresh active connections before retrying.');
        return;
      }
      if (!this.accepted(operation)) { await this.retireLate(connection.connectionId); return; }
      if (connection.account.origin !== new URL(origin).origin) {
        await this.retireLate(connection.connectionId);
        if (this.accepted(operation)) this.error.set('The returned connection did not match the selected instance. Connect again.');
        return;
      }
      this.connections.update(previous => [...previous, connection]);
      this.selectedId.set(connection.connectionId); this.page.set(null); this.stale.set(false);
      this.notice.set(`Connected as ${connection.account.login}. Load projects to browse this account.`);
    } catch (reason) {
      if (this.accepted(operation)) this.error.set(this.message(reason, 'The GitLab connection could not be confirmed. Refresh connections before retrying.'));
    } finally { this.finish(operation); }
  }
  async load(number = 1): Promise<void> {
    const connection = this.selected();
    if (!connection || !this.canRead() || this.closing || this.destroyed) return;
    if (number !== 1 && (this.queryChanged() || !this.page())) return;
    const query: GitLabProjectQuery = { ...this.filters(), page: number, expectedAccount: connection.account };
    const operation = this.begin('reading'); this.stale.set(!!this.page());
    try {
      const page = await ipc.load_gitlab_projects({ request: { connectionId: connection.connectionId, query, operationId: operation.id } });
      if (!this.accepted(operation) || this.selectedId() !== connection.connectionId) return;
      if (!sameAccount(page.account, connection.account) || page.query.page !== number || page.query.search !== query.search
        || page.query.scope !== query.scope || page.query.includeArchived !== query.includeArchived) {
        this.error.set('The returned account or project query changed. Refresh connections and reload the first page.'); return;
      }
      this.page.set(page); this.stale.set(false); this.notice.set(`Loaded page ${page.query.page} for ${page.account.login}.`);
    } catch (reason) {
      if (this.accepted(operation)) this.error.set(this.message(reason, 'Projects could not be loaded. Earlier results were retained.'));
    } finally { this.finish(operation); }
  }
  async disconnect(): Promise<void> {
    const connection = this.selected(); if (!connection || !this.canDisconnect() || this.closing || this.destroyed) return;
    if (this.operation) this.operation.cancelled = true;
    this.operation = null;
    const generation = ++this.generation; this.busy.set('disconnecting'); this.error.set(''); this.stale.set(!!this.page());
    try {
      await this.retire(connection.connectionId);
      if (!this.current(generation)) return;
      this.connections.update(previous => previous.filter(item => item.connectionId !== connection.connectionId));
      this.selectedId.set(''); this.page.set(null); this.stale.set(false); this.notice.set('Disconnected this app’s GitLab connection.');
    } catch (reason) {
      if (this.current(generation)) this.error.set(this.message(reason, 'Disconnect was not confirmed. Refresh active connections.'));
    } finally { if (this.current(generation)) { this.busy.set(null); this.cancelling.set(false); } }
  }
  async cancel(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return;
    operation.cancelled = true; this.cancelling.set(true);
    try { await ipc.cancel_git_operation({ operationId: operation.id }); }
    catch { if (this.current(operation.generation) && this.operation === operation) this.error.set('Cancellation was not confirmed. Late results will be ignored; refresh connections before retrying.'); }
  }
  async copyPath(path: string): Promise<void> {
    const generation = this.generation;
    try { await navigator.clipboard.writeText(path); if (this.current(generation)) this.notice.set('Project path copied.'); }
    catch { if (this.current(generation)) this.error.set('Clipboard access is unavailable. Select the project path and copy it with the system shortcut.'); }
  }
  expiry(value: string): string {
    const date = Number(value);
    return Number.isSafeInteger(date) && date >= 0 && date <= 8640000000000000 ? new Date(date).toLocaleTimeString() : 'Expiry unavailable';
  }
  handleEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    if (event.target.id === 'gitlab-origin' || event.target.id === 'gitlab-token') void this.connect();
    else if (event.target.id === 'gitlab-search') void this.load();
  }
  dismiss(): void {
    if (this.closing) return;
    this.closing = true; this.generation++; this.token.set(''); this.showToken.set(false);
    const operation = this.operation;
    if (operation) { operation.cancelled = true; void ipc.cancel_git_operation({ operationId: operation.id }).catch(() => undefined); }
  }
  ngOnDestroy(): void { this.dismiss(); this.destroyed = true; }
}
