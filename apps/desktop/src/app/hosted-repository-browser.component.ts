import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterRenderEffect, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { ipc, type HostedCloneTransport, type HostedRepository, type HostedRepositoryInspection, type HostedRepositoryPage, type HostedRepositoryQuery, type PreparedHostedClone } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { HostedForksComponent } from './hosted-forks.component';

type Filters = Omit<HostedRepositoryQuery, 'page' | 'expectedAccountId'>;
const DEFAULT_FILTERS: Filters = { visibility: 'all', affiliation: 'accessible', sort: 'fullName', direction: 'ascending' };

@Component({
  selector: 'gc-hosted-repository-browser',
  imports: [HostedForksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="GitHub repository catalogue" (keydown.enter)="preventInputSubmit($event)">
      <h3>Repositories on GitHub</h3>
      <p>Browse using the current account signed in with GitHub CLI. Load explicitly to check the account and its accessible repositories.</p>
      @if (git.browserPreview()) { <p role="status">Hosted repositories are available in the desktop app.</p> }
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (notice()) { <p role="status">{{ notice() }}</p> }
      <details><summary>Catalogue filters</summary><fieldset [disabled]="unavailable()"><div class="fields">
        <label for="hosted-visibility">Visibility<select id="hosted-visibility" [value]="filters().visibility" (change)="setFilter('visibility', $any($event.target).value)"><option value="all">All visibility</option><option value="public">Public</option><option value="private">Private</option></select></label>
        <label for="hosted-affiliation">Access<select id="hosted-affiliation" [value]="filters().affiliation" (change)="setFilter('affiliation', $any($event.target).value)"><option value="accessible">All accessible</option><option value="owned">Owned by account</option><option value="collaborating">Collaborator access</option><option value="organizationMember">Organization access</option></select></label>
        <label for="hosted-sort">Sort by<select id="hosted-sort" [value]="filters().sort" (change)="setFilter('sort', $any($event.target).value)"><option value="fullName">Repository name</option><option value="updated">Last update</option><option value="pushed">Last push</option><option value="created">Creation date</option></select></label>
        <label for="hosted-direction">Order<select id="hosted-direction" [value]="filters().direction" (change)="setFilter('direction', $any($event.target).value)"><option value="ascending">Ascending</option><option value="descending">Descending</option></select></label>
      </div></fieldset></details>
      <div class="actions"><button type="button" [disabled]="unavailable()" (click)="loadFresh()">{{ page() ? 'Reload account and repositories' : 'Load repositories' }}</button>
        <button type="button" [disabled]="parentUnavailable()" (click)="toggleForks()">{{ showForks() ? 'Close fork controls' : 'Manage forks and saved requests' }}</button>
        @if (busy()) { <span role="status">{{ progress() }}</span><button type="button" [disabled]="cancelling()" (click)="cancel()">{{ cancelling() ? 'Stopping…' : 'Cancel hosted request' }}</button> }
      </div>
      @if (page(); as page) {
        <p class="account" data-hosted-account><strong>{{ page.account.host }} · {{ page.account.login }}</strong> · page {{ page.query.page }} · {{ page.entries.length }} repositories on this page</p>
        <label for="hosted-page-filter">Filter this page<input id="hosted-page-filter" type="search" [value]="pageFilter()" (input)="pageFilter.set($any($event.target).value)" placeholder="Repository name or description" /></label>
        <ul aria-label="Hosted repositories">@for (repository of visibleEntries(); track repository.id) {
          <li><div><strong>{{ repository.fullName }}</strong><span>{{ visibility(repository) }}{{ repository.archived ? ' · Archived' : '' }}{{ repository.fork ? ' · Fork' : '' }}</span>@if (repository.description) { <p>{{ repository.description }}</p> }</div><button type="button" [disabled]="unavailable() || repository.disabled === true || repository.canPull === false" (click)="select(repository)">Select {{ repository.fullName }}</button></li>
        } @empty { <li>{{ page.entries.length ? 'No matching repositories on this page.' : 'No repositories returned for this page and access filter.' }}</li> }</ul>
        <nav aria-label="Repository catalogue pages"><button type="button" [disabled]="unavailable() || page.query.page <= 1" (click)="loadPage(page.query.page - 1)">Previous page</button><button type="button" [disabled]="unavailable() || !page.nextPage" (click)="loadPage(page.nextPage!)">Next page</button></nav>
        <p>{{ page.mayHaveMore ? 'More repositories may be available on the next page.' : 'No further page was indicated by this result.' }} A page is not a snapshot of the entire account.</p>
      }
      @for (generation of forkViews(); track generation) { <gc-hosted-forks [source]="selection()" [disabled]="parentUnavailable()" (busyChange)="forkBusy.set($event)" (cloneRequested)="useFork($event)" /> }
      @if (selection(); as selected) {
        <section class="selection" aria-label="Selected hosted repository"><h3>{{ selected.repository.fullName }}</h3>
          <p>Catalogue account: {{ selected.account.login }} · {{ visibility(selected.repository) }}</p>
          <p>Default branch: {{ selected.repository.defaultBranch ?? 'Not reported' }}@if (selected.repository.parent) { · Parent: {{ selected.repository.parent.fullName }} }</p>
          <fieldset #cloneOptions [disabled]="unavailable()"><legend>Clone destination and options</legend><div class="fields">
            <label for="hosted-transport">Clone transport<select id="hosted-transport" [value]="transport()" (change)="transport.set($any($event.target).value); invalidate()"><option value="https" [disabled]="!selected.repository.cloneHttps">HTTPS</option><option value="ssh" [disabled]="!selected.repository.cloneSsh">SSH</option></select></label>
            <label for="hosted-folder">Folder name<input id="hosted-folder" [value]="folder()" maxlength="255" (input)="folder.set($any($event.target).value); invalidate()" autocomplete="off" /></label>
          </div>
          <label for="hosted-parent">Where to clone</label><div class="path"><input id="hosted-parent" [value]="parentPath()" (input)="parentPath.set($any($event.target).value); invalidate()" placeholder="Enter or choose a destination directory" autocomplete="off" /><button type="button" (click)="chooseParent()">Choose folder</button></div>
          <code>{{ selectedUrl() }}</code><p>Git uses your configured credentials or SSH agent for this transport. The catalogue account is rechecked before cloning; it does not replace your Git credentials.</p>
          <label for="hosted-branch">Branch (optional)<input id="hosted-branch" [value]="branch()" maxlength="1024" (input)="branch.set($any($event.target).value); invalidate()" placeholder="Repository default" /></label>
          <p>Choosing a branch limits the clone to that branch. Leave it blank to use the default clone behavior.</p>
          <label class="check"><input type="checkbox" [checked]="shallow()" (change)="shallow.set($any($event.target).checked); invalidate()" />Limit history depth</label>
          @if (shallow()) { <label for="hosted-depth">History depth<input id="hosted-depth" type="number" min="1" max="4294967295" [value]="depth()" (input)="depth.set(+$any($event.target).value); invalidate()" /></label> }
          <label class="check"><input type="checkbox" [checked]="recurse()" (change)="recurse.set($any($event.target).checked); invalidate()" />Include nested submodules</label>
          @if (recurse()) { <p>Submodule history is not shortened by the parent clone depth.</p> }
          <button type="button" [disabled]="!ready()" (click)="prepare()">Review hosted clone</button></fieldset>
        </section>
      }
      @if (preview(); as preview) {
        <section #review class="review" aria-label="Review hosted clone" tabindex="-1"><h3>Review before cloning</h3><dl><dt>Account</dt><dd>{{ preview.plan.account.login }} on {{ preview.plan.account.host }}</dd><dt>Repository</dt><dd>{{ preview.plan.repository.fullName }}</dd><dt>Transport</dt><dd>{{ preview.plan.transport }}<code>{{ preview.plan.url }}</code></dd><dt>Destination</dt><dd><code>{{ preview.plan.destination }}</code></dd><dt>Branch and history</dt><dd>{{ preview.plan.branch ?? 'Default branch' }} · {{ preview.plan.depth ? 'Depth ' + preview.plan.depth : 'Full history' }}</dd><dt>Submodules</dt><dd>{{ preview.plan.recurseSubmodules ? 'Include nested submodules' : 'Do not initialize submodules' }}</dd></dl>
          <p>This creates a new local directory. An existing destination is refused. A stopped or failed clone can leave partial data; inspect that directory before retrying.</p>
          <div class="actions"><button type="button" [disabled]="unavailable()" (click)="apply()">Clone reviewed repository</button><button type="button" [disabled]="busy()" (click)="invalidate()">Discard clone preview</button></div>
        </section>
      }
    </section>
  `,
  styles: [`
    :host{display:block;min-width:0}section{min-width:0}h3{font-size:14px;margin:14px 0 8px}p,li,label,dt,dd,summary,span{font-size:13px;line-height:1.5;overflow-wrap:anywhere}p{margin:8px 0}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}fieldset{min-width:0;border:1px solid var(--inspector-divider);padding:12px;margin:12px 0}label{display:block;margin:8px 0}input:not([type=checkbox]),select{display:block;width:100%;box-sizing:border-box;min-width:0;min-height:34px;margin-top:5px}button,input,select{font:inherit;font-size:13px;color:var(--text);background:var(--inspector-row);border:1px solid var(--inspector-divider);padding:7px 10px}button{min-height:34px;cursor:pointer;white-space:normal;overflow-wrap:anywhere}button:disabled{opacity:.5;cursor:default}.actions,nav,.path{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.path{flex-wrap:nowrap}.path input{margin:0}.path button{flex-shrink:0}.check{display:flex;gap:8px;align-items:flex-start}.check input{margin-top:4px}ul{list-style:none;padding:0;max-height:280px;overflow:auto;scroll-padding:8px}li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--inspector-divider)}li>div{min-width:0}li span{display:block}li p{margin:4px 0}code{display:block;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}dd{margin:4px 0 10px}.review{border:1px solid var(--accent);padding:12px;margin:16px 0}[role=alert]{color:var(--danger)}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}summary{cursor:pointer}@media(max-width:560px){.fields{grid-template-columns:minmax(0,1fr)}li{align-items:flex-start;flex-direction:column}.path{flex-wrap:wrap}}
  `],
})
export class HostedRepositoryBrowserComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly initialParentPath = input('');
  readonly opening = output<void>();
  readonly opened = output<void>();
  readonly filters = signal<Filters>({ ...DEFAULT_FILTERS });
  readonly page = signal<HostedRepositoryPage | null>(null);
  readonly pageFilter = signal('');
  readonly selection = signal<HostedRepositoryInspection | null>(null);
  readonly transport = signal<HostedCloneTransport>('https');
  readonly parentPath = signal('');
  readonly folder = signal('');
  readonly branch = signal('');
  readonly shallow = signal(false);
  readonly depth = signal(1);
  readonly recurse = signal(false);
  readonly preview = signal<PreparedHostedClone | null>(null);
  readonly busy = signal(false);
  readonly picking = signal(false);
  readonly cancelling = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly progress = signal('');
  readonly showForks = signal(false);
  private readonly forkGeneration = signal(0);
  readonly forkViews = computed(() => this.showForks() ? [this.forkGeneration()] : []);
  readonly forkBusy = signal(false);
  private readonly forks = viewChild(HostedForksComponent);
  private readonly cloneOptions = viewChild<ElementRef<HTMLElement>>('cloneOptions');
  private readonly focusCloneOptions = signal(false);
  private readonly cloneOptionsFocus = afterRenderEffect(() => {
    if (this.focusCloneOptions() && this.cloneOptions()) { this.cloneOptions()!.nativeElement.querySelector<HTMLElement>('select, input, button')?.focus(); this.focusCloneOptions.set(false); }
  });
  private readonly contextId = crypto.randomUUID();
  private readonly review = viewChild<ElementRef<HTMLElement>>('review');
  private readonly reviewFocus = afterRenderEffect(() => this.review()?.nativeElement.focus());
  private operation: { id: string; cancelled: boolean } | null = null;
  private destroyed = false;
  private previewBinding = '';
  private autoFolder = '';
  private initialParentApplied = false;
  readonly parentUnavailable = computed(() => this.busy() || this.picking() || this.git.busy() || this.git.browserPreview());
  readonly unavailable = computed(() => this.parentUnavailable() || this.forkBusy());
  readonly visibleEntries = computed(() => {
    const query = this.pageFilter().trim().toLocaleLowerCase();
    return (this.page()?.entries ?? []).filter(repository => !query || repository.fullName.toLocaleLowerCase().includes(query) || repository.description?.toLocaleLowerCase().includes(query));
  });
  readonly selectedUrl = computed(() => this.transport() === 'https' ? this.selection()?.repository.cloneHttps : this.selection()?.repository.cloneSsh);
  readonly ready = computed(() => !!this.selection() && !!this.selectedUrl() && !!this.parentPath() && !!this.folder().trim() && (!this.shallow() || Number.isInteger(this.depth()) && this.depth() >= 1 && this.depth() <= 4294967295));
  private readonly binding = computed(() => JSON.stringify([this.selection(), this.transport(), this.parentPath(), this.folder(), this.branch(), this.shallow(), this.depth(), this.recurse()]));

  constructor() {
    effect(() => {
      const initial = this.initialParentPath();
      if (!this.initialParentApplied) { this.initialParentApplied = true; this.parentPath.set(initial); }
    });
  }
  visibility(repository: HostedRepository): string { return repository.private === null ? 'Visibility not reported' : repository.private ? 'Private' : 'Public'; }
  toggleForks(): void {
    if (this.parentUnavailable()) return;
    if (this.showForks()) { const submitted = this.forks()?.submissionInFlight(); this.forks()?.dismiss(); if (submitted) this.notice.set('Check saved fork requests for the submitted outcome.'); }
    else this.forkGeneration.update(generation => generation + 1);
    this.showForks.set(!this.showForks());
  }
  useFork(selected: HostedRepositoryInspection): void {
    this.invalidate(); this.forks()?.dismiss(); this.showForks.set(false);
    if (this.page()?.account.id !== selected.account.id) { this.page.set(null); this.pageFilter.set(''); }
    this.selection.set(selected);
    if (!this.folder() || this.folder() === this.autoFolder) this.folder.set(selected.repository.name);
    this.autoFolder = selected.repository.name;
    if (!this.selectedUrl()) this.transport.set(selected.repository.cloneHttps ? 'https' : 'ssh');
    this.notice.set(`Selected verified fork ${selected.repository.fullName}. Review its clone destination and transport separately.`);
    this.focusCloneOptions.set(true);
  }
  preventInputSubmit(event: Event): void { if (event.target instanceof HTMLInputElement) event.preventDefault(); }
  setFilter(key: keyof Filters, value: string): void {
    if (this.unavailable()) return;
    this.filters.update(filters => ({ ...filters, [key]: value }));
    this.invalidate(); this.page.set(null); this.selection.set(null); this.notice.set('Filters changed. Load repositories to apply them.');
  }
  async loadFresh(): Promise<void> {
    if (this.unavailable()) return;
    this.invalidate(); this.page.set(null); this.selection.set(null); this.pageFilter.set('');
    await this.loadPage(1);
  }
  async loadPage(number: number): Promise<void> {
    if (this.unavailable()) return;
    this.invalidate(); this.selection.set(null);
    const expectedAccountId = this.page()?.account.id ?? null;
    const query = { ...this.filters(), page: number, expectedAccountId };
    await this.perform('Loading repository catalogue…', async id => {
      const result = await ipc.load_hosted_repositories({ query, operationId: id });
      if (!this.current(id)) return;
      if (expectedAccountId && result.account.id !== expectedAccountId) throw Error('The account changed. Reload account and repositories.');
      this.page.set(result); this.notice.set(`Loaded page ${number} for ${result.account.login}.`);
    });
  }
  async select(repository: HostedRepository): Promise<void> {
    const account = this.page()?.account; if (!account || this.unavailable()) return;
    this.invalidate(); this.selection.set(null);
    await this.perform('Checking selected repository…', async id => {
      const result = await ipc.inspect_hosted_repository({ fullName: repository.fullName, repositoryId: repository.id, accountId: account.id, operationId: id });
      if (!this.current(id)) return;
      if (result.account.id !== account.id || result.repository.id !== repository.id) throw Error('The account or repository identity changed. Reload its catalogue.');
      this.selection.set(result);
      if (!this.folder() || this.folder() === this.autoFolder) this.folder.set(result.repository.name);
      this.autoFolder = result.repository.name;
      if (!this.selectedUrl()) this.transport.set(result.repository.cloneHttps ? 'https' : 'ssh');
      this.notice.set(`Selected ${result.repository.fullName}. Choose a destination and review the clone.`);
    });
  }
  async chooseParent(): Promise<void> {
    if (this.unavailable()) return; this.picking.set(true);
    try { const path = await this.git.chooseDirectory('Choose where to clone the hosted repository'); if (!this.destroyed && path) { this.parentPath.set(path); this.invalidate(); } }
    finally { this.picking.set(false); }
  }
  invalidate(): void {
    const preview = this.preview(); this.preview.set(null);
    if (preview) void ipc.discard_hosted_clone_plan({ contextId: this.contextId, token: preview.token }).catch(() => undefined);
  }
  async prepare(): Promise<void> {
    const selection = this.selection(); if (!selection || !this.ready() || this.unavailable()) return;
    this.invalidate(); const binding = this.binding();
    const request = { fullName: selection.repository.fullName, repositoryId: selection.repository.id, accountId: selection.account.id, transport: this.transport(), parentPath: this.parentPath(), folder: this.folder().trim(), branch: this.branch().trim() || null, depth: this.shallow() ? this.depth() : null, recurseSubmodules: this.recurse() };
    await this.perform('Preparing hosted clone review…', async id => {
      const preview = await ipc.prepare_hosted_clone({ contextId: this.contextId, request, operationId: id });
      if (!this.current(id) || binding !== this.binding()) { await ipc.discard_hosted_clone_plan({ contextId: this.contextId, token: preview.token }); return; }
      this.previewBinding = binding; this.preview.set(preview);
    });
  }
  async apply(): Promise<void> {
    const preview = this.preview(); if (!preview || this.unavailable()) return;
    if (this.previewBinding !== this.binding()) { this.invalidate(); this.error.set('Clone options changed. Review a fresh preview.'); return; }
    this.preview.set(null);
    await this.perform('Cloning reviewed repository…', async id => {
      this.opening.emit();
      const opened = await this.git.cloneHostedRepository(this.contextId, preview.token, id);
      if (!this.destroyed && this.operation?.id === id) {
        if (opened) this.opened.emit();
        else this.error.set(this.git.error() ?? 'The clone stopped. Inspect the destination before preparing another clone.');
      }
    });
  }
  private current(id: string): boolean { return !this.destroyed && this.operation?.id === id && !this.operation.cancelled; }
  private async perform(label: string, action: (id: string) => Promise<void>): Promise<void> {
    if (this.unavailable()) return;
    const operation = { id: crypto.randomUUID(), cancelled: false }; this.operation = operation;
    this.busy.set(true); this.cancelling.set(false); this.error.set(''); this.notice.set(''); this.progress.set(label);
    try { await action(operation.id); }
    catch (reason: unknown) { if (!this.destroyed && this.operation === operation) { const error = reason as { message?: string; hint?: string }; this.error.set(error?.message ? `${error.message}${error.hint ? ' ' + error.hint : ''}` : String(reason)); } }
    finally {
      if (!this.destroyed && operation.cancelled && !this.error()) this.notice.set('Request canceled. Inspect any clone destination before retrying.');
      if (this.operation === operation) this.operation = null;
      this.busy.set(false); this.cancelling.set(false);
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
      if (!this.destroyed && this.operation === operation) { this.error.set('Cancellation was not acknowledged. Wait for the result or retry cancellation.'); this.cancelling.set(false); }
    } catch { if (!this.destroyed && this.operation === operation) { this.error.set('Cancellation could not be confirmed. Wait for the result or retry cancellation.'); this.cancelling.set(false); } }
  }
  dismiss(): void {
    if (this.destroyed) return;
    this.forks()?.dismiss();
    this.destroyed = true; this.invalidate();
    if (this.operation) void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined);
  }
  ngOnDestroy(): void { this.dismiss(); }
}
