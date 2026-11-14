import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { ipc } from '@git-khronos/contracts';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { CommitSummary, MailPatchAction, MailPatchImportReview, MailPatchProgress, MailPatchReview } from '@git-khronos/contracts';
import { GitKhronosService, type ActivityReporter } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';
import { repositoryOperationState } from './repository-operation';

const MAX_SERIES = 500;

@Component({
  selector: 'gc-mail-patch-panel',
  imports: [GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details #panel class="form-disclosure" [attr.aria-busy]="pending()">
      <summary>Mail patches (format-patch / am)</summary>
      <p>Exchange commits as email-formatted patches that keep each author, date and message.
        Applying records you as committer; signatures, notes and merge commits are not carried.</p>
      @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
      @if (pending()) { <p role="status">{{ git.activity() }}</p> }
      @if (notice()) { <p role="status">{{ notice() }}</p> }
      @if (active()) {
        <section #stopRegion role="region" aria-label="Mail-patch application paused" tabindex="-1">
          <strong>Patch application paused</strong>
          @if (progress(); as state) {
            <p>Patch {{ state.current ?? '?' }} of {{ state.total ?? '?' }}.</p>
            @if (state.message) { <pre tabindex="0" aria-label="Git am report">{{ state.message }}</pre> }
          }
          <p>Resolve conflicts or fix the reported problem, stage the result, then Continue.
            Skip discards only the current patch. Abort returns the branch, index and files to the
            state before applying. Ordinary commits are refused until this finishes.</p>
          <div class="actions">
            <button type="button" [disabled]="disabled() || pending()" (click)="control('continue')">Continue</button>
            <button type="button" [disabled]="disabled() || pending()" (click)="control('skip')">Skip this patch</button>
            <button type="button" [disabled]="disabled() || pending()" (click)="control('abort')">Abort</button>
          </div>
        </section>
      } @else {
        <fieldset [disabled]="disabled() || pending()">
          <legend>Export recent commits of {{ branchName() || 'HEAD' }}</legend>
          <label for="mail-export-count">Number of commits ending at HEAD</label>
          <input id="mail-export-count" type="number" min="1" [max]="chain().length || 1"
            [value]="count()" (change)="setCount(countInput.value); countInput.value = '' + count()" #countInput aria-describedby="mail-export-scope" />
          <p id="mail-export-scope">{{ chain().length ? chosen().length + ' of ' + chain().length + ' available ordinary commits, oldest first.' : 'No exportable commits are loaded. Merge commits stop the range.' }}</p>
          <ol tabindex="0" aria-label="Commits to export">
            @for (commit of chosen(); track commit.oid) { <li>{{ commit.subject }} <span>{{ commit.oid.slice(0, 10) }}</span></li> }
          </ol>
          <button type="button" [disabled]="!chosen().length" (click)="reviewExport()">Review series</button>
        </fieldset>
        @if (exportReview(); as checked) {
          <section #exportRegion role="region" aria-label="Mail-patch export review" tabindex="-1">
            <strong>{{ checked.commits.length }} patches, {{ checked.request.bytes }} bytes</strong>
            @for (commit of checked.commits; track commit.oid) {
              @if (commit.empty) { <p>“{{ commit.subject }}” has no changes; Git am will stop on it.</p> }
            }
            <p>Committed contents, including secrets, are written in plain text. Save a new file outside
              the repository; existing files are never overwritten.</p>
            <div class="actions">
              <button type="button" (click)="exportReview.set(null)">Cancel</button>
              <button type="button" [disabled]="disabled() || pending()" (click)="exportSeries()">Save series…</button>
            </div>
          </section>
        }
        <button #chooseButton type="button" [disabled]="disabled() || pending()" (click)="reviewImport()">Choose series to apply…</button>
        @if (importReview(); as checked) {
          <section #importRegion role="region" aria-label="Mail-patch import review" tabindex="-1">
            <strong>Apply {{ checked.patches.length }} patches on {{ shortBranch(checked.request.branch) }}</strong>
            <ol tabindex="0" aria-label="Patches to apply">
              @for (patch of checked.patches; track $index) {
                <li>{{ patch.subject }} — {{ patch.authorName }} &lt;{{ patch.authorEmail }}&gt;
                  @if (patch.empty) { <em>(empty: Git am will stop; choose Skip)</em> }</li>
              }
            </ol>
            <p>Each patch becomes a new commit on the current branch. The current tip is saved as a
              protected recovery reference first. Commit hooks and configured signing run normally.
              Conflicts pause with Continue, Skip and Abort; no three-way fallback is attempted.</p>
            <div class="actions">
              <button type="button" (click)="cancelImport()">Cancel</button>
              <button type="button" [disabled]="disabled() || pending()" (click)="applySeries()">Apply patches</button>
            </div>
          </section>
        }
        <p>Series up to 16 MiB and {{ max }} patches. Applying requires a committed current branch with
          no staged or modified tracked files; untracked files are kept.</p>
      }
      <gc-git-help topic="mail-patch" label="Learn about format-patch and am…" [disabled]="disabled() || pending()" />
    </details>
  `,
  styles: [`
    :host { display: block; margin-top: 16px; } p, label, li { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
    fieldset, section { min-width: 0; margin: 12px 0; padding: 10px; border: 1px solid var(--inspector-divider); }
    label { display: block; margin: 8px 0; } li span { opacity: .7; font-family: monospace; }
    input { min-height: 28px; width: 96px; background: var(--inspector-row); color: var(--text); }
    pre { max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
    ol { max-height: 200px; overflow: auto; padding-left: 24px; }
    button { min-height: 28px; padding: 6px 8px; background: var(--inspector-row); color: var(--text); cursor: pointer; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; } button:disabled, fieldset:disabled { opacity: .5; cursor: default; }
    button:focus-visible, input:focus-visible, summary:focus-visible, section:focus-visible, pre:focus-visible, ol:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class MailPatchPanelComponent {
  readonly git = inject(GitKhronosService);
  readonly repositoryId = input.required<string>();
  readonly disabled = input(false);
  readonly max = MAX_SERIES;
  readonly pending = signal(false);
  readonly count = signal(1);
  readonly exportReview = signal<MailPatchReview | null>(null);
  readonly importReview = signal<MailPatchImportReview | null>(null);
  readonly progress = signal<MailPatchProgress | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  readonly active = computed(() => repositoryOperationState(this.git.repository()?.status).mailPatchInProgress);
  readonly branchName = computed(() => this.git.repository()?.branches.find(branch => branch.current && !branch.remote)?.name ?? '');
  /** Ordinary first-parent commits ending at HEAD, newest first, among loaded history. */
  readonly chain = computed(() => {
    const repository = this.git.repository();
    const byOid = new Map<string, CommitSummary>((repository?.commits ?? []).map(commit => [commit.oid, commit]));
    const result: CommitSummary[] = [];
    let commit = repository?.headOid ? byOid.get(repository.headOid) : undefined;
    while (commit && commit.parents.length <= 1 && result.length < MAX_SERIES) {
      result.push(commit);
      commit = commit.parents[0] ? byOid.get(commit.parents[0]) : undefined;
    }
    return result;
  });
  readonly chosen = computed(() => this.chain().slice(0, Math.min(this.count(), this.chain().length)).reverse());
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly exportRegion = viewChild<ElementRef<HTMLElement>>('exportRegion');
  private readonly importRegion = viewChild<ElementRef<HTMLElement>>('importRegion');
  private readonly stopRegion = viewChild<ElementRef<HTMLElement>>('stopRegion');
  private readonly chooseButton = viewChild<ElementRef<HTMLButtonElement>>('chooseButton');
  private generation = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.generation++);
    effect(() => {
      this.repositoryId();
      this.generation++;
      this.exportReview.set(null); this.importReview.set(null); this.progress.set(null);
      this.count.set(1); this.error.set(''); this.notice.set('');
    });
    effect(() => {
      const panel = this.panel()?.nativeElement as HTMLDetailsElement | undefined;
      if (this.active() && panel) panel.open = true;
    });
  }
  shortBranch(reference: string): string { return reference.replace(/^refs\/heads\//, ''); }
  setCount(value: string): void {
    const parsed = Math.trunc(Number(value));
    this.count.set(Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, this.chain().length || 1)) : 1);
    this.exportReview.set(null);
  }
  private current(repositoryId: string, generation: number): boolean {
    return generation === this.generation && repositoryId === this.repositoryId() && repositoryId === this.git.activeRepositoryId();
  }
  private focusLater(repositoryId: string, generation: number, target: () => HTMLElement | null | undefined): void {
    setTimeout(() => { if (this.current(repositoryId, generation)) target()?.focus(); });
  }
  private async run(label: string, action: (repositoryId: string, generation: number, report: ActivityReporter) => Promise<void>, refresh = false): Promise<void> {
    if (this.pending() || this.disabled() || !this.git.requireRecoveryRepository(this.repositoryId())) return;
    const repositoryId = this.repositoryId(), generation = this.generation;
    this.pending.set(true); this.error.set(''); this.notice.set('');
    try {
      const result = await this.git.run(label, report => action(repositoryId, generation, report), repositoryId);
      if (refresh && !await this.git.refreshRepositoryInBackground(repositoryId) && this.current(repositoryId, generation) && result === 'success') {
        this.error.set('Git finished, but repository refresh failed. Refresh manually before continuing; do not reapply blindly.');
      } else if (result !== 'success' && this.current(repositoryId, generation)) {
        this.error.set(this.git.error() ?? 'Mail-patch operation failed. Inspect the repository before retrying.');
      }
      if (this.error() && this.current(repositoryId, generation)) {
        this.focusLater(repositoryId, generation, () => this.panel()?.nativeElement.querySelector<HTMLElement>('[role=alert]'));
      }
    } finally { this.pending.set(false); }
  }
  async reviewExport(): Promise<void> {
    const oids = this.chosen().map(commit => commit.oid);
    if (!oids.length) return;
    this.exportReview.set(null);
    await this.run('Preparing mail-patch series…', async (repositoryId, generation, report) => {
      const review = await ipc.review_mail_patch_export({ repoId: repositoryId, oids });
      report('Mail-patch series reviewed; nothing written');
      if (this.current(repositoryId, generation)) {
        this.exportReview.set(review);
        this.focusLater(repositoryId, generation, () => this.exportRegion()?.nativeElement);
      }
    });
  }
  async exportSeries(): Promise<void> {
    const review = this.exportReview();
    if (!review) return;
    await this.run('Saving mail-patch series…', async (repositoryId, generation, report) => {
      const destination = await save({ title: 'Save a new mail-patch series outside the repository',
        filters: [{ name: 'Mailbox patch series', extensions: ['mbox', 'patch'] }] });
      if (!this.current(repositoryId, generation)) throw new Error('Repository changed while choosing a destination. Nothing was written.');
      if (!destination) { this.notice.set('Export cancelled. No file written.'); report('Mail-patch export cancelled'); return; }
      const bytes = await ipc.export_mail_patch({ repoId: repositoryId, request: review.request, destination });
      report('Mail-patch series exported');
      if (this.current(repositoryId, generation)) {
        this.exportReview.set(null);
        this.notice.set(`Saved ${review.commits.length} patches (${bytes} bytes) to ${destination}.`);
      }
    });
  }
  cancelImport(): void {
    this.importReview.set(null);
    this.chooseButton()?.nativeElement.focus();
  }
  async reviewImport(): Promise<void> {
    this.importReview.set(null);
    await this.run('Reviewing mail-patch series…', async (repositoryId, generation, report) => {
      const file = await open({ title: 'Choose a mail-patch series to apply', directory: false, multiple: false,
        filters: [{ name: 'Mailbox patch series', extensions: ['mbox', 'patch', 'eml', 'txt'] }] });
      if (!this.current(repositoryId, generation)) throw new Error('Repository changed while choosing a series. Nothing was applied.');
      if (!file) { this.notice.set('Selection cancelled. Nothing was applied.'); report('Mail-patch selection cancelled'); return; }
      if (typeof file !== 'string') throw new Error('Select one series file. Nothing was applied.');
      const review = await ipc.review_mail_patch_import({ repoId: repositoryId, file });
      report('Mail-patch series reviewed; nothing applied');
      if (this.current(repositoryId, generation)) {
        this.importReview.set(review);
        this.focusLater(repositoryId, generation, () => this.importRegion()?.nativeElement);
      }
    });
  }
  async applySeries(): Promise<void> {
    const review = this.importReview();
    if (!review) return;
    this.importReview.set(null);
    await this.run('Applying mail patches…', async (repositoryId, generation, report) => {
      const progress = await ipc.import_mail_patch({ repoId: repositoryId, request: review.request });
      this.report(progress, repositoryId, generation, `Applied ${review.patches.length} patches.`, report);
    }, true);
  }
  async control(action: MailPatchAction): Promise<void> {
    await this.run(action === 'abort' ? 'Aborting mail-patch application…' : action === 'skip' ? 'Skipping current patch…' : 'Continuing mail-patch application…',
      async (repositoryId, generation, report) => {
        const progress = await ipc.control_mail_patch({ repoId: repositoryId, action });
        this.report(progress, repositoryId, generation, action === 'abort' ? 'Application aborted; the branch is back at its original tip.' : 'All remaining patches applied.', report);
      }, true);
  }
  private report(progress: MailPatchProgress, repositoryId: string, generation: number, done: string, reportActivity: ActivityReporter): void {
    reportActivity(progress.stopped ? 'Mail-patch application paused' : 'Mail-patch application finished');
    if (!this.current(repositoryId, generation)) return;
    this.progress.set(progress.stopped ? progress : null);
    const recovery = progress.recoveryRef ? ` Original tip saved at ${progress.recoveryRef}.` : '';
    this.notice.set(progress.stopped ? `Paused at patch ${progress.current ?? '?'} of ${progress.total ?? '?'}.${recovery}` : done + recovery);
    if (progress.stopped) this.focusLater(repositoryId, generation, () => this.stopRegion()?.nativeElement);
  }
}
