import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ipc } from '@git-khronos/contracts';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { BundleExportRange, BundleReview, BundleTip } from '@git-khronos/contracts';
import { GitKhronosService, type ActivityReporter } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';

@Component({
  selector: 'gk-bundle-exchange-panel',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details #panel class="form-disclosure" [attr.aria-busy]="pending()">
      <summary>Offline Git bundles</summary>
      <p>Transfer committed history and Git objects without a network connection. Working files,
        index changes, repository settings, hooks, credentials and LFS cached objects are not included.</p>
      <p>Verification checks format and available prerequisites, not authenticity or commit signatures.
        Git checks the object payload during import; review does not unpack every object.
        Only open bundles from a source you trust.</p>
      @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
      @if (pending()) { <p role="status">{{ git.activity() }}</p> }
      @if (notice()) { <p role="status">{{ notice() }}</p> }
      <fieldset [disabled]="disabled() || pending()">
        <legend>Export one local branch</legend>
        <label for="bundle-export-branch">Source branch</label>
        <select id="bundle-export-branch" [ngModel]="branch()" (ngModelChange)="setBranch($event)">
          <option value="">Choose a local branch</option>
          @for (candidate of localBranches(); track candidate.name) { <option [value]="candidate.name">{{ candidate.name }}</option> }
        </select>
        <label><input type="checkbox" [ngModel]="incremental()" (ngModelChange)="setIncremental($event)" />
          Export incrementally from a commit the recipient already has</label>
        @if (incremental()) {
          <label for="bundle-export-base">Prerequisite commit ID</label>
          <input id="bundle-export-base" type="text" [ngModel]="baseInput()" (ngModelChange)="setBase($event)"
            maxlength="64" autocomplete="off" spellcheck="false" aria-describedby="bundle-base-help" />
          <p id="bundle-base-help">Paste the full commit ID (40 or 64 hex characters) of a shared ancestor, not a branch or tag name.
            The recipient must already have the prerequisite and its history. They should verify the bundle before importing it.</p>
          <button type="button" [disabled]="!exportBranch() || !baseValid()" (click)="reviewExportRange()">Review incremental range</button>
          @if (currentExportRange(); as range) {
            <section #rangeRegion aria-label="Incremental bundle export review" role="region" tabindex="-1">
              <p><strong>{{ range.commitCount }} {{ range.commitCount === 1 ? 'commit' : 'commits' }} to export</strong> on {{ range.branch }}.</p>
              <p>Excluded prerequisite: <code>{{ range.baseOid }}</code></p>
              <p>Advertised branch tip: <code>{{ range.tipOid }}</code></p>
            </section>
          }
        } @else {
          <p>Includes all committed history reachable from this branch, without a prerequisite cutoff.</p>
        }
        <p>Committed secrets may be included. Save a new file outside the repository; existing files are never overwritten.</p>
        <button type="button" [disabled]="!exportBranch() || (incremental() && !currentExportRange())" (click)="exportBundle()">
          {{ incremental() ? 'Save incremental bundle…' : 'Save branch bundle…' }}
        </button>
      </fieldset>
      <button #verifyButton type="button" [disabled]="disabled() || pending()" (click)="verify()">Choose and verify bundle…</button>
      @if (review(); as checked) {
        <section #reviewRegion role="region" aria-label="Bundle import review" tabindex="-1">
          <strong>Verified bundle review</strong>
          <p>{{ checked.request.file }}: {{ checked.request.bytes }} bytes.
            A content fingerprint detects ordinary source-file changes before import;
            it is not a trusted signature.</p>
          <pre tabindex="0" aria-label="Bundle prerequisite verification">{{ checked.verification }}</pre>
          <ul tabindex="0" aria-label="All advertised bundle tips">
            @for (candidate of checked.request.tips; track candidate.reference) {
              <li>{{ candidate.reference }}<code>{{ candidate.oid }}</code></li>
            }
          </ul>
          <label for="bundle-import-tip">Advertised branch to preserve</label>
          <select id="bundle-import-tip" [disabled]="disabled() || pending()" [ngModel]="selected()" (ngModelChange)="selected.set($event)">
            <option value="">Choose a branch explicitly</option>
            @for (candidate of checked.request.tips; track candidate.reference) {
              @if (candidate.reference.startsWith('refs/heads/')) {
                <option [value]="candidate.reference">{{ candidate.reference }}</option>
              }
            }
          </select>
          @if (selectedTip(); as tip) { <p>Captured tip: <code>{{ tip.oid }}</code></p> }
          <p>Import adds objects, then creates a new protected recovery reference for the chosen tip.
            Existing branches, tags, remote-tracking refs, HEAD, index and working files stay unchanged.
            Other advertised tips are not mapped to local references. Dirty files may stay in place.
            Use reflog/recovery tools to create a local branch afterwards; nothing is checked out.
            If preserving the new reference fails, downloaded objects can remain; inspect before retrying.</p>
          <div class="actions">
            <button type="button" [disabled]="disabled() || pending()" (click)="cancel()">Cancel bundle review</button>
            <button type="button" [disabled]="disabled() || pending() || !selectedTip()" (click)="importBundle()">Import into new recovery reference</button>
          </div>
        </section>
      }
      <p>Bundle files up to 16 MiB and 500 advertised references. Missing incremental prerequisites,
        tag-only bundles, special/symlink source files, partial/promisor repositories and active Git operations refuse.
        Export also refuses shallow repositories and legacy grafted history. Larger exports,
        bare repositories and tag import require local Git. Git may retain
        imported objects after a failure; disk errors and outside processes are not transactional.</p>
      <gk-git-help topic="bundle" label="Learn about offline bundles…" [disabled]="disabled() || pending()" />
    </details>
  `,
  styles: [`
    :host { display: block; margin-top: 16px; } p, label, li { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
    fieldset, section { min-width: 0; margin: 12px 0; padding: 10px; border: 1px solid var(--inspector-divider); }
    label { display: block; margin: 8px 0; } code { display: block; overflow-wrap: anywhere; }
    select, input[type=text] { width: 100%; box-sizing: border-box; min-height: 32px; background: var(--inspector-row); color: var(--text); }
    pre { max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
    ul { max-height: 200px; overflow: auto; padding-left: 20px; }
    button { min-height: 28px; padding: 6px 8px; background: var(--inspector-row); color: var(--text); cursor: pointer; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; } button:disabled, fieldset:disabled { opacity: .5; cursor: default; }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, section:focus-visible, pre:focus-visible, ul:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class BundleExchangePanelComponent {
  readonly git = inject(GitKhronosService);
  readonly repositoryId = input.required<string>();
  readonly disabled = input(false);
  readonly pending = signal(false);
  readonly branch = signal('');
  readonly incremental = signal(false);
  readonly baseInput = signal('');
  readonly baseOid = computed(() => this.baseInput().trim().toLowerCase());
  readonly baseValid = computed(() => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(this.baseOid()));
  readonly exportBranch = computed(() => this.localBranches().find(branch => branch.name === this.branch()));
  private readonly exportRange = signal<BundleExportRange | null>(null);
  readonly currentExportRange = computed(() => {
    const range = this.exportRange(), branch = this.exportBranch();
    return this.incremental() && range && branch?.name === range.branch
      && branch.oid === range.tipOid && this.baseOid() === range.baseOid ? range : null;
  });
  readonly selected = signal('');
  readonly review = signal<BundleReview | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly reviewRegion = viewChild<ElementRef<HTMLElement>>('reviewRegion');
  private readonly rangeRegion = viewChild<ElementRef<HTMLElement>>('rangeRegion');
  private readonly verifyButton = viewChild<ElementRef<HTMLButtonElement>>('verifyButton');
  private generation = 0;
  private viewedScope = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => this.generation++);
    effect(() => {
      this.repositoryId();
      this.viewedScope = this.git.activeRepositoryReadScope();
      this.generation++;
      this.review.set(null); this.branch.set(''); this.selected.set('');
      this.incremental.set(false); this.baseInput.set(''); this.exportRange.set(null);
      this.error.set(''); this.notice.set('');
    });
  }
  localBranches() { return this.git.repository()?.branches.filter(branch => !branch.remote) ?? []; }
  selectedTip(): BundleTip | null {
    return this.review()?.request.tips.find(tip => tip.reference === this.selected() && tip.reference.startsWith('refs/heads/')) ?? null;
  }
  private current(repositoryId: string, generation: number): boolean {
    return generation === this.generation && repositoryId === this.repositoryId() && repositoryId === this.git.activeRepositoryId()
      && this.viewedScope === this.git.activeRepositoryReadScope();
  }
  private async run(label: string, action: (repositoryId: string, generation: number, report: ActivityReporter) => Promise<void>): Promise<void> {
    if (this.pending() || this.disabled() || !this.git.requireRecoveryRepository(this.repositoryId())) return;
    const repositoryId = this.repositoryId(), generation = this.generation;
    this.pending.set(true); this.error.set(''); this.notice.set('');
    try {
      const result = await this.git.run(label, report => action(repositoryId, generation, report), repositoryId);
      if (result !== 'success' && this.current(repositoryId, generation)) {
        this.error.set(this.git.error() ?? 'Bundle exchange failed. Inspect the repository before retrying.');
        setTimeout(() => { if (this.current(repositoryId, generation)) this.panel()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus(); });
      }
    } finally { this.pending.set(false); }
  }
  cancel(): void {
    this.review.set(null); this.selected.set('');
    this.verifyButton()?.nativeElement.focus();
  }
  setBranch(branch: string): void { this.branch.set(branch); this.exportRange.set(null); }
  setIncremental(incremental: boolean): void { this.incremental.set(incremental); this.exportRange.set(null); }
  setBase(base: string): void { this.baseInput.set(base); this.exportRange.set(null); }

  async reviewExportRange(): Promise<void> {
    const branch = this.exportBranch(), baseOid = this.baseOid();
    if (!this.incremental() || !branch || !this.baseValid() || this.pending()) return;
    this.exportRange.set(null);
    const matches = (range: BundleExportRange) => this.incremental() && this.baseOid() === baseOid
      && range.baseOid === baseOid && range.branch === branch.name && range.tipOid === branch.oid
      && this.exportBranch()?.name === branch.name && this.exportBranch()?.oid === branch.oid;
    await this.run('Checking the offline bundle range…', async (repositoryId, generation, report) => {
      const range = await ipc.review_git_bundle_export_range({ repoId: repositoryId, branch: branch.name, expectedOid: branch.oid, baseOid });
      if (!this.current(repositoryId, generation)) return;
      if (!matches(range)) throw new Error('The export range changed. Review it again before saving.');
      this.exportRange.set(range);
      report('Incremental range reviewed; no file written');
      setTimeout(() => {
        if (this.current(repositoryId, generation) && this.currentExportRange() === range) this.rangeRegion()?.nativeElement.focus();
      });
    });
  }

  async exportBundle(): Promise<void> {
    const branch = this.exportBranch(), range = this.currentExportRange(), incremental = this.incremental();
    if (!branch || (incremental && !range)) return;
    await this.run('Exporting offline branch bundle…', async (repositoryId, generation, report) => {
      const destination = await save({ title: incremental ? 'Save a new incremental bundle outside the repository' : 'Save a new branch bundle outside the repository',
        filters: [{ name: 'Git bundle', extensions: ['bundle'] }] });
      if (!destination) {
        if (this.current(repositoryId, generation)) this.notice.set('Bundle export cancelled. No file written.');
        report('Bundle export cancelled');
        return;
      }
      if (!this.current(repositoryId, generation)) throw new Error('Repository changed while choosing a bundle destination. No export started.');
      if (incremental && this.currentExportRange() !== range) throw new Error('The reviewed export range changed. No export started.');
      const bytes = await ipc.export_git_bundle({ repoId: repositoryId, branch: branch.name, expectedOid: branch.oid,
        baseOid: range?.baseOid ?? null, destination });
      report(incremental ? 'Incremental branch bundle exported' : 'Self-contained branch bundle exported');
      if (this.current(repositoryId, generation)) this.notice.set(`Saved ${bytes} bytes to ${destination}. Existing repository state is unchanged.`);
    });
  }
  async verify(): Promise<void> {
    this.review.set(null); this.selected.set('');
    await this.run('Verifying complete offline bundle…', async (repositoryId, generation, report) => {
      const file = await open({ title: 'Choose a Git bundle to verify', directory: false, multiple: false,
        filters: [{ name: 'Git bundle', extensions: ['bundle'] }] });
      if (!file) {
        if (this.current(repositoryId, generation)) this.notice.set('Bundle selection cancelled. No objects imported.');
        report('Bundle selection cancelled');
        return;
      }
      if (!this.current(repositoryId, generation)) throw new Error('Repository changed while choosing a bundle. No verification started.');
      if (typeof file !== 'string') throw new Error('Select one bundle file. No verification started.');
      const review = await ipc.review_git_bundle({ repoId: repositoryId, file });
      report('Bundle verified; no objects imported');
      if (this.current(repositoryId, generation)) {
        this.review.set(review);
        setTimeout(() => { if (this.current(repositoryId, generation)) this.reviewRegion()?.nativeElement.focus(); });
      }
    });
  }
  async importBundle(): Promise<void> {
    const review = this.review(), tip = this.selectedTip();
    if (!review || !tip || this.disabled() || this.pending()) return;
    const repositoryId = this.repositoryId(), generation = this.generation;
    let imported = false;
    this.review.set(null); this.selected.set('');
    await this.run('Importing reviewed bundle into recovery…', async (repositoryId, generation, report) => {
      const reference = await ipc.import_git_bundle({ repoId: repositoryId, request: review.request, tip });
      imported = true;
      report('Bundle imported into a new recovery reference');
      if (this.current(repositoryId, generation)) this.notice.set(`Imported ${tip.oid} into ${reference}. No existing branch or working file moved.`);
    });
    if (imported && !await this.git.refreshRepositoryInBackground(repositoryId) && this.current(repositoryId, generation)) {
      this.error.set('Bundle import completed, but repository refresh failed. The recovery reference above remains valid. Refresh manually; do not reimport blindly.');
      setTimeout(() => { if (this.current(repositoryId, generation)) this.panel()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus(); });
    }
  }
}
