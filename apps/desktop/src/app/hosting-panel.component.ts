import { HostedPagerComponent } from './hosted-pager.component';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { ipc, type HostedEntry, type HostedReview, type HostingPage, type HostingSection, type HostingState, type HostedReviewQuery } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

@Component({
  selector: 'gc-hosting-panel',
  imports: [HostedPagerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3>Reviews, issues and workflows</h3>
    <p>Loads GitHub data using your installed, authenticated <code>gh</code> CLI. Requests use its current account. Select a remote and load explicitly.</p>
    <div class="tools"><div class="field"><label for="hosting-remote">GitHub remote</label><select id="hosting-remote" [disabled]="busy()" (change)="remote.set($any($event.target).value)">
      <option value="" [selected]="!remote()">Choose a remote</option>@for (item of remotes(); track item.name) { <option [value]="item.name" [selected]="remote() === item.name">{{ item.name }} — {{ item.fetchUrl }}</option> }
    </select></div><div class="field"><label for="hosting-section">Hosted section</label><select id="hosting-section" [value]="section()" [disabled]="busy()" (change)="section.set($any($event.target).value)"><option value="pullRequests">Pull requests</option><option value="issues">Issues</option><option value="workflows">Recent workflow runs</option></select></div>
      @if (section() !== 'workflows') { <div class="field"><label for="hosting-state">Record state</label><select id="hosting-state" [value]="state()" [disabled]="busy()" (change)="state.set($any($event.target).value)"><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></select></div> }
      <button type="button" [disabled]="!remote() || busy() || git.busy() || git.browserPreview()" (click)="load()">Load from GitHub</button>
      @if (busy()) { <button type="button" [disabled]="cancelling()" (click)="cancel()">Cancel hosted request</button> }
    </div>
    <p>Repository: {{ git.repository()?.path ?? 'No repository selected' }}</p>
    @if (!remotes().length) { <p>Select a repository with a github.com fetch remote. Other hosting providers remain accessible through repository browser links.</p> }
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (busy()) { <p role="status">Loading hosted data…</p> }
    @if (visiblePage(); as page) {
      <p data-hosted-page-status tabindex="-1" role="status">{{ page.entries.length }} records loaded for {{ page.repository }}. Snapshot from the last explicit load.</p>
      <label>Filter this page<input type="search" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
      @if (page.mayHaveMore) { <p>More records may exist. Use the page controls to continue reading.</p> }
      <gc-hosted-pager label="hosted records" [page]="page.page" [more]="page.nextPage !== null" [disabled]="busy() || git.busy()" (pageChange)="load($event)" />
      @for (entry of entries(); track entry.number) {
        <article><h4>#{{ entry.number }} {{ entry.title }}</h4><p>{{ entry.state }} · {{ entry.author }} @if (entry.branch) { · {{ entry.branch }} }</p>
          @if (entry.commitOid) { <code>{{ entry.commitOid }}</code> }
          @if (entry.body) { <details><summary>Description</summary><pre>{{ entry.body }}</pre></details> }
          <div class="tools"><button type="button" [disabled]="git.busy()" (click)="open(entry)">Open #{{ entry.number }} on GitHub</button>
          @if (section() === 'pullRequests') { <button type="button" [disabled]="busy() || git.busy()" (click)="inspect(entry)">Inspect #{{ entry.number }}</button> }</div>
        </article>
      } @empty { <p>{{ page.entries.length ? 'No records match this filter.' : 'No records on this API page.' }}</p> }
    }
    @if (visibleReview(); as review) {
      <section aria-label="Pull request inspection" data-hosted-review-status tabindex="-1"><h3>Pull request #{{ reviewNumber() }}</h3><p>{{ review.headBranch }} → {{ review.baseBranch }}</p><code>Head commit: {{ review.headOid }}</code>
        <p>This is a read-only inspection. Use GitHub to submit reviews, comments or merge decisions.</p>
        @for (warning of review.warnings; track $index) { <p role="alert">{{ warning }}</p> }
        @if (review.sections.reviews) {
          <h4>Latest submitted decisions</h4><p>Latest approval, change request or dismissal per reviewer, after reading every review page. Comment-only reviews do not replace decisions. Provider branch rules still determine merge eligibility.</p>
          <ul aria-label="Latest submitted review decisions">@for (item of review.currentReviews; track item.name) { <li>{{ item.name }} · {{ item.state }} · {{ item.submittedAt }}
            @if (item.commitOid !== review.headOid) { · Review on another commit: {{ item.commitOid || 'commit not reported' }} }
          </li> } @empty { <li>No submitted approval or change-request decisions.</li> }</ul>
          <h4>Review history</h4>
          <gc-hosted-pager label="review history" [page]="review.query.reviewsPage" [more]="review.reviewsMayHaveMore" [disabled]="busy() || git.busy()" (pageChange)="reviewPage('reviewsPage', $event)" />
          @for (item of review.reviews; track $index) { <article><strong>{{ item.name }} · {{ item.state }}</strong><pre>{{ item.body }}</pre></article> } @empty { <p>No review events on this page.</p> }
        }
        <h4>Checks at this head commit</h4>
        @if (review.sections.checks) {
          <gc-hosted-pager label="check runs" [page]="review.query.checksPage" [more]="review.checksMayHaveMore" [disabled]="busy() || git.busy()" (pageChange)="reviewPage('checksPage', $event)" />
          @for (item of review.checks; track $index) { <p>{{ item.name }} · {{ item.state }}</p> } @empty { <p>No check runs returned. This does not establish that CI passed.</p> }
        }
        <h4>Commit status contexts</h4>
        @if (review.sections.statuses) {
          <p>Provider combined commit-status state: {{ review.legacyState }}. Check runs and branch rules are separate.</p>
          <gc-hosted-pager label="status contexts" [page]="review.query.statusesPage" [more]="review.statusesMayHaveMore" [disabled]="busy() || git.busy()" (pageChange)="reviewPage('statusesPage', $event)" />
          @for (item of review.legacyStatuses; track $index) { <p>{{ item.name }} · {{ item.state }} · {{ item.body }}</p> } @empty { <p>No commit status contexts on this page.</p> }
        }
        <h4>Changed files</h4>
        @if (review.sections.files) {
          <gc-hosted-pager label="changed files" [page]="review.query.filesPage" [more]="review.filesMayHaveMore" [disabled]="busy() || git.busy()" (pageChange)="reviewPage('filesPage', $event)" />
          @for (file of review.files; track file.path) { <details><summary>{{ file.path }} · {{ file.state }} · +{{ file.additions }} −{{ file.deletions }}</summary>
            @if (file.patch) { <pre>{{ file.patch }}</pre> } @else { <p>No textual patch supplied by the provider. Open GitHub for the complete file.</p> }
          </details> } @empty { <p>No changed files on this page.</p> }
          @if (review.filesMayHaveMore) { <p>More files may exist. Use Next changed files page to continue.</p> }
        }
        <p>Provider patches may be truncated. Review the complete change on GitHub before deciding.</p>
      </section>
    }
  `,
  styles: [`
    h3 { font-size: 15px; } h4 { font-size: 14px; margin: 0 0 8px; } p, label, code, pre, summary { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .tools { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; margin: 12px 0; } .field { flex: 1 1 200px; min-width: 0; } label { display: block; }
    input, select { display: block; box-sizing: border-box; width: 100%; margin-top: 4px; } button, input, select { padding: 7px 10px; min-height: 32px; color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); }
    button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    article, section { border: 1px solid var(--inspector-divider); padding: 14px; margin: 12px 0; border-radius: 5px; } pre { white-space: pre-wrap; max-height: 400px; overflow: auto; } summary { cursor: pointer; padding: 8px 0; } [role=alert] { color: var(--danger); }
  `],
})
export class HostingPanelComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly remote = signal('');
  readonly section = signal<HostingSection>('pullRequests');
  readonly state = signal<HostingState>('open');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private selectedReview: HostedEntry | null = null;
  readonly query = signal('');
  readonly busy = signal(false);
  readonly cancelling = signal(false);
  readonly error = signal('');
  readonly page = signal<{ key: string; value: HostingPage } | null>(null);
  readonly review = signal<{ key: string; value: HostedReview } | null>(null);
  readonly reviewNumber = signal('');
  private operation: { id: string; cancelled: boolean } | null = null;
  private destroyed = false;
  readonly remotes = computed(() => (this.git.repository()?.remotes ?? []).filter(remote => /^(https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/.test(remote.fetchUrl)));
  private readonly key = computed(() => JSON.stringify([this.git.activeRepositoryId(), this.remote(), this.remotes().find(remote => remote.name === this.remote())?.fetchUrl, this.section(), this.section() === 'workflows' ? 'all' : this.state()]));
  readonly visiblePage = computed(() => this.page()?.key === this.key() ? this.page()!.value : null);
  readonly visibleReview = computed(() => this.review()?.key === this.key() ? this.review()!.value : null);
  readonly entries = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    return (this.visiblePage()?.entries ?? []).filter(item => !query || `${item.number} ${item.title} ${item.author} ${item.state} ${item.branch}`.toLocaleLowerCase().includes(query));
  });
  constructor() {
    effect(() => { const remotes = this.remotes(); if (!remotes.some(remote => remote.name === this.remote())) this.remote.set(remotes.find(remote => remote.name === 'origin')?.name ?? remotes[0]?.name ?? ''); });
    effect(() => { this.key(); this.error.set(''); if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); } });
  }
  private async run(action: (repoId: string, id: string) => Promise<void>): Promise<void> {
    const repoId = this.git.activeRepositoryId();
    if (!repoId || this.busy() || this.git.busy() || !this.remote()) return;
    const operation = { id: crypto.randomUUID(), cancelled: false }; const key = this.key();
    this.operation = operation; this.busy.set(true); this.cancelling.set(false); this.error.set('');
    try {
      const outcome = await this.git.run('Loading hosted repository data…', async report => {
        await action(repoId, operation.id);
        if (this.destroyed || operation.cancelled || this.key() !== key) throw { kind: 'operationCancelled', message: 'Hosted request cancelled.', hint: null };
        report('Hosted repository snapshot loaded');
      }, repoId, operation.id);
      if (!this.destroyed && this.key() === key && outcome !== 'success') { this.error.set(operation.cancelled ? 'Hosted request cancelled.' : this.git.error() ?? 'Hosted request failed.'); this.page.set(null); this.review.set(null); }
    } finally { this.operation = null; this.busy.set(false); this.cancelling.set(false); }
  }
  async load(page = 1): Promise<void> {
    if (this.busy() || this.git.busy()) return;
    this.selectedReview = null;
    const state = this.state();
    const key = this.key(), remote = this.remote(), section = this.section();
    this.page.set(null); this.review.set(null); this.query.set('');
    await this.run(async (repoId, id) => {
      const value = await ipc.load_hosting_page({ repoId, remote, section, query: { page, state }, operationId: id });
      if (!this.destroyed && !this.operation?.cancelled && key === this.key()) { this.page.set({ key, value }); this.focusResult('[data-hosted-page-status]', key); }
    });
  }
  async inspect(entry: HostedEntry, query: HostedReviewQuery = { filesPage: 1, reviewsPage: 1, checksPage: 1, statusesPage: 1 }): Promise<void> {
    if (this.busy() || this.git.busy() || !this.visiblePage()?.entries.includes(entry) || this.section() !== 'pullRequests') return;
    this.selectedReview = entry;
    const key = this.key(), remote = this.remote(); this.review.set(null); this.reviewNumber.set(entry.number);
    await this.run(async (repoId, id) => {
      const value = await ipc.load_hosted_review({ repoId, remote, pullNumber: Number(entry.number), expectedHeadOid: entry.commitOid, query, operationId: id });
      if (!this.destroyed && !this.operation?.cancelled && key === this.key()) { this.review.set({ key, value }); this.focusResult('[data-hosted-review-status]', key); }
    });
  }
  reviewPage(field: keyof HostedReviewQuery, page: number): void {
    const review = this.visibleReview(), entry = this.selectedReview;
    if (review && entry && !this.busy() && !this.git.busy()) void this.inspect(entry, { ...review.query, [field]: page });
  }
  private focusResult(selector: string, key: string): void {
    setTimeout(() => { if (!this.destroyed && this.key() === key) this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(); });
  }
  async cancel(): Promise<void> {
    if (!this.operation || this.cancelling()) return;
    this.operation.cancelled = true; this.cancelling.set(true); this.page.set(null); this.review.set(null);
    try {
      const acknowledged = await ipc.cancel_git_operation({ operationId: this.operation.id });
      if (!acknowledged && !this.destroyed) this.error.set('Cancellation is not yet acknowledged; the result will be discarded.');
    }
    catch { if (!this.destroyed) { this.error.set('Cancellation could not be confirmed. Close this panel or wait for the request.'); this.cancelling.set(false); } }
  }
  open(entry: HostedEntry): void { if (this.visiblePage()?.entries.includes(entry)) void this.git.openExternalUrl(entry.url); }
  ngOnDestroy(): void { this.destroyed = true; if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); } }
}
