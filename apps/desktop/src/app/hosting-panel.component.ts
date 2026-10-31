import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { ipc, type HostedEntry, type HostedReview, type HostingPage, type HostingSection } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

@Component({
  selector: 'gc-hosting-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3>Reviews, issues and workflows</h3>
    <p>Loads GitHub data using your installed, authenticated <code>gh</code> CLI. Requests use its current account. Select a remote and load explicitly.</p>
    <div class="tools"><div class="field"><label for="hosting-remote">GitHub remote</label><select id="hosting-remote" [disabled]="busy()" (change)="remote.set($any($event.target).value)">
      <option value="" [selected]="!remote()">Choose a remote</option>@for (item of remotes(); track item.name) { <option [value]="item.name" [selected]="remote() === item.name">{{ item.name }} — {{ item.fetchUrl }}</option> }
    </select></div><div class="field"><label for="hosting-section">Hosted section</label><select id="hosting-section" [value]="section()" [disabled]="busy()" (change)="section.set($any($event.target).value)"><option value="pullRequests">Open pull requests</option><option value="issues">Open issues</option><option value="workflows">Recent workflow runs</option></select></div>
      <button type="button" [disabled]="!remote() || busy() || git.busy() || git.browserPreview()" (click)="load()">Load from GitHub</button>
      @if (busy()) { <button type="button" [disabled]="cancelling()" (click)="cancel()">Cancel hosted request</button> }
    </div>
    <p>Repository: {{ git.repository()?.path ?? 'No repository selected' }}</p>
    @if (!remotes().length) { <p>Select a repository with a github.com fetch remote. Other hosting providers remain accessible through repository browser links.</p> }
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (busy()) { <p role="status">Loading hosted data…</p> }
    @if (visiblePage(); as page) {
      <p role="status">{{ page.entries.length }} records loaded for {{ page.repository }}. Snapshot from the last explicit load.</p>
      <label>Filter hosted records<input type="search" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
      @if (page.mayHaveMore) { <p>The first API page was full. More records may exist; open GitHub for the complete list.</p> }
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
      <section aria-label="Pull request inspection"><h3>Pull request #{{ reviewNumber() }}</h3><p>{{ review.headBranch }} → {{ review.baseBranch }}</p><code>Head commit: {{ review.headOid }}</code>
        <p>This is a read-only inspection. Use GitHub to submit reviews, comments or merge decisions.</p>
        <h4>Review decisions</h4>
        @for (item of review.reviews; track $index) { <article><strong>{{ item.name }} · {{ item.state }}</strong><pre>{{ item.body }}</pre></article> } @empty { <p>No review decisions on this page.</p> }
        @if (review.reviewsMayHaveMore) { <p>Additional review records may exist.</p> }
        <h4>Checks at this head commit</h4>
        @for (item of review.checks; track $index) { <p>{{ item.name }} · {{ item.state }}</p> } @empty { <p>No check runs returned. This does not establish that CI passed.</p> }
        @if (review.checksMayHaveMore) { <p>Additional checks may exist.</p> }
        <h4>Changed files</h4>
        @for (file of review.files; track file.path) { <details><summary>{{ file.path }} · {{ file.state }} · +{{ file.additions }} −{{ file.deletions }}</summary>
          @if (file.patch) { <pre>{{ file.patch }}</pre> } @else { <p>No textual patch supplied by the provider. Open GitHub for the complete file.</p> }
        </details> } @empty { <p>No changed files returned.</p> }
        @if (review.filesMayHaveMore) { <p>Only the first 50 changed files are shown. More files may exist.</p> }
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
  private readonly key = computed(() => JSON.stringify([this.git.activeRepositoryId(), this.remote(), this.remotes().find(remote => remote.name === this.remote())?.fetchUrl, this.section()]));
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
  async load(): Promise<void> {
    const key = this.key(), remote = this.remote(), section = this.section();
    this.page.set(null); this.review.set(null); this.query.set('');
    await this.run(async (repoId, id) => {
      const value = await ipc.load_hosting_page({ repoId, remote, section, operationId: id });
      if (!this.destroyed && !this.operation?.cancelled && key === this.key()) this.page.set({ key, value });
    });
  }
  async inspect(entry: HostedEntry): Promise<void> {
    if (!this.visiblePage()?.entries.includes(entry) || this.section() !== 'pullRequests') return;
    const key = this.key(), remote = this.remote(); this.review.set(null); this.reviewNumber.set(entry.number);
    await this.run(async (repoId, id) => {
      const value = await ipc.load_hosted_review({ repoId, remote, pullNumber: Number(entry.number), expectedHeadOid: entry.commitOid, operationId: id });
      if (!this.destroyed && !this.operation?.cancelled && key === this.key()) this.review.set({ key, value });
    });
  }
  async cancel(): Promise<void> {
    if (!this.operation || this.cancelling()) return;
    this.operation.cancelled = true; this.cancelling.set(true); this.page.set(null); this.review.set(null);
    try { await ipc.cancel_git_operation({ operationId: this.operation.id }); }
    catch { if (!this.destroyed) { this.error.set('Cancellation could not be confirmed. Close this panel or wait for the request.'); this.cancelling.set(false); } }
  }
  open(entry: HostedEntry): void { if (this.visiblePage()?.entries.includes(entry)) void this.git.openExternalUrl(entry.url); }
  ngOnDestroy(): void { this.destroyed = true; if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); } }
}
