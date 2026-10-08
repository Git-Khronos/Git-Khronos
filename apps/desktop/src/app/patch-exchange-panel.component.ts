import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { PatchReview, PatchTarget } from '@git-chronos/contracts';
import { GitChronosService } from './git-chronos.service';
import { GitHelpComponent } from './git-help.component';
import { BundleExchangePanelComponent } from './bundle-exchange-panel.component';
import { MailPatchPanelComponent } from './mail-patch-panel.component';

@Component({
  selector: 'gc-patch-exchange-panel',
  imports: [FormsModule, GitHelpComponent, BundleExchangePanelComponent, MailPatchPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details #panel>
      <summary>Patch exchange</summary>
      <p>Exchange complete tracked diffs, including binary changes. No commits, authors, signatures or
        references are imported. LFS diffs exchange pointers, not the LFS object cache. Mail patches
        and bundles use different Git workflows.</p>
      @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
      @if (notice()) { <p role="status">{{ notice() }}</p> }
      <fieldset [disabled]="disabled() || pending()">
        <legend>Export tracked changes</legend>
        <label for="patch-export-scope">Diff source</label>
        <select id="patch-export-scope" [ngModel]="staged()" (ngModelChange)="setExportScope($event)">
          <option [ngValue]="false">Unstaged: working files compared with index</option>
          <option [ngValue]="true">Staged: index compared with HEAD</option>
        </select>
        <label><input type="checkbox" [ngModel]="allFiles()" (ngModelChange)="allFiles.set($event)" />All tracked changes in this scope</label>
        @if (!allFiles()) {
          <div class="paths" aria-label="Patch export file selection">
            @for (file of exportFiles(); track file.path) {
              <label><input type="checkbox" [checked]="selected().includes(file.path)" (change)="toggle(file.path)" />{{ file.path }}</label>
            }
            @if (!exportFiles().length) { <p>No selectable tracked changes. Staged renames require all tracked changes.</p> }
          </div>
        }
        <p>Untracked files are excluded; stage new files first. Renames are exported as deletion/addition.
          Choose a new filename outside the repository; existing files are never overwritten.</p>
        <button type="button" [disabled]="!allFiles() && !selected().length" (click)="exportPatch()">Save diff patch…</button>
      </fieldset>
      <fieldset [disabled]="disabled() || pending()">
        <legend>Import a diff patch</legend>
        <label for="patch-import-target">Apply to</label>
        <select id="patch-import-target" [ngModel]="target()" (ngModelChange)="setTarget($event)">
          <option value="worktree">Working files only; leave index unchanged</option>
          <option value="index">Index only; leave working files unchanged</option>
          <option value="both">Index and working files</option>
        </select>
        <p>Requires a fully clean repository, including untracked files, with no active operation or
          hidden/sparse entries. Git checks the complete patch before showing a review. No three-way
          fallback, partial hunks, whitespace fixing or unsafe-path override is used.</p>
        <button type="button" (click)="reviewPatch()">Choose and check patch…</button>
      </fieldset>
      @if (review(); as checked) {
        <section #reviewRegion role="region" aria-label="Patch import review" tabindex="-1">
          <strong>Review before applying</strong>
          <p>File: {{ checked.request.file }}<br />{{ checked.request.patch.length }} bytes;
            base {{ checked.request.headOid }}. Target: {{ targetLabel(checked.request.target) }}.</p>
          <ul aria-label="Complete patch paths">
            @for (file of checked.files; track file.path) {
              <li>{{ file.path }}: {{ file.added === null ? 'Binary change' : '+' + file.added + ' / -' + file.deleted }}</li>
            }
          </ul>
          @if (checked.summary) { <pre aria-label="Patch creations deletions and modes">{{ checked.summary }}</pre> }
          <p>Index-only import can make working files appear to reverse the staged patch. Inspect both
            views before staging anything. Review validity is checked again against the exact file,
            HEAD, branch and index. No commit or reference will move. Keep the source patch for recovery.</p>
          <div class="actions">
            <button type="button" [disabled]="disabled() || pending()" (click)="cancelReview()">Cancel patch review</button>
            <button type="button" [disabled]="disabled() || pending()" (click)="apply()">Apply reviewed patch</button>
          </div>
        </section>
      }
      <p>Limits: complete 4 MiB patch and 2000 distinct paths. Symlinks, submodules, extended rename/copy
        records and non-UTF-8 paths require local Git. Ordinary file additions, deletions, executable
        modes and binary data are supported.</p>
      <gc-git-help topic="patch" label="Learn about diff patches and apply…" [disabled]="pending() || disabled()" />
    </details>
    <gc-mail-patch-panel [repositoryId]="repositoryId()" [disabled]="disabled() || pending()" />
    <gc-bundle-exchange-panel [repositoryId]="repositoryId()" [disabled]="disabled() || pending()" />
  `,
  styles: [`
    :host { display: block; margin-top: 16px; }
    p, label, li { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
    fieldset, section { min-width: 0; margin: 12px 0; padding: 10px; border: 1px solid var(--inspector-divider); }
    label { display: block; margin: 8px 0; } label:has(input) { display: flex; align-items: center; gap: 8px; min-height: 28px; }
    select { box-sizing: border-box; width: 100%; min-height: 32px; color: var(--text); background: var(--inspector-row); }
    .paths, ul { max-height: 200px; overflow: auto; } ul { padding-left: 20px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    button { min-height: 28px; padding: 6px 8px; color: var(--text); background: var(--inspector-row); cursor: pointer; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button:disabled, fieldset:disabled { opacity: .5; cursor: default; }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, section:focus-visible {
      outline: 2px solid var(--accent); outline-offset: 2px;
    }
    [role=alert] { color: var(--danger); }
  `],
})
export class PatchExchangePanelComponent {
  readonly git = inject(GitChronosService);
  readonly repositoryId = input.required<string>();
  readonly disabled = input(false);
  readonly pending = signal(false);
  readonly staged = signal(false);
  readonly allFiles = signal(true);
  readonly selected = signal<string[]>([]);
  readonly target = signal<PatchTarget>('worktree');
  readonly review = signal<PatchReview | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly reviewRegion = viewChild<ElementRef<HTMLElement>>('reviewRegion');
  private generation = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.generation++);
    effect(() => {
      this.repositoryId();
      this.generation++;
      this.review.set(null);
      this.selected.set([]);
      this.error.set('');
      this.notice.set('');
    });
  }

  exportFiles() {
    if (this.repositoryId() !== this.git.activeRepositoryId()) return [];
    return (this.git.repository()?.status.entries ?? []).filter(file =>
      !file.conflicted && file.indexStatus !== '?' && !['R', 'C'].includes(file.indexStatus)
      && (this.staged() ? file.indexStatus !== ' ' : file.worktreeStatus !== ' '));
  }

  setExportScope(staged: boolean): void { this.staged.set(staged); this.selected.set([]); }
  setTarget(target: PatchTarget): void { this.target.set(target); this.review.set(null); }
  toggle(path: string): void {
    this.selected.update(paths => paths.includes(path) ? paths.filter(file => file !== path) : [...paths, path]);
  }
  targetLabel(target: PatchTarget): string {
    return target === 'worktree' ? 'working files only' : target === 'index' ? 'index only' : 'index and working files';
  }
  cancelReview(): void {
    this.review.set(null);
    this.panel()?.nativeElement.querySelector<HTMLSelectElement>('#patch-import-target')?.focus();
  }

  private current(repositoryId: string, generation: number): boolean {
    return repositoryId === this.repositoryId() && repositoryId === this.git.activeRepositoryId()
      && generation === this.generation;
  }

  private async run(label: string, action: (repositoryId: string, generation: number) => Promise<void>): Promise<void> {
    if (this.disabled() || this.pending() || !this.git.requireRecoveryRepository(this.repositoryId())) return;
    const repositoryId = this.repositoryId();
    const generation = this.generation;
    this.pending.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const result = await this.git.run(label, () => action(repositoryId, generation), repositoryId);
      if (result !== 'success' && this.current(repositoryId, generation)) {
        this.error.set(this.git.error() ?? 'Patch exchange did not complete. Review the repository before retrying.');
        setTimeout(() => this.panel()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus());
      }
    } finally { this.pending.set(false); }
  }

  async exportPatch(): Promise<void> {
    const staged = this.staged();
    const paths = this.allFiles() ? [] : [...this.selected()];
    if (!this.allFiles() && !paths.length) return;
    await this.run('Exporting complete diff patch…', async (repositoryId, generation) => {
      const destination = await save({ title: 'Save a new diff patch outside the repository',
        filters: [{ name: 'Diff patch', extensions: ['patch', 'diff'] }] });
      if (!this.current(repositoryId, generation)) throw new Error('Repository changed while choosing the patch destination. No export started.');
      if (!destination) { this.notice.set('Export cancelled. No file was written.'); this.git.activity.set('Patch export cancelled'); return; }
      const bytes = await invoke<number>('export_diff_patch', { repoId: repositoryId, staged, paths, destination });
      this.git.activity.set('Complete diff patch exported');
      if (this.current(repositoryId, generation)) this.notice.set(`Saved ${bytes} bytes to ${destination}. Repository files and references unchanged.`);
    });
  }

  async reviewPatch(): Promise<void> {
    const target = this.target();
    this.review.set(null);
    await this.run('Checking complete diff patch…', async (repositoryId, generation) => {
      const file = await open({ title: 'Choose a diff patch to check', directory: false, multiple: false,
        filters: [{ name: 'Diff patch', extensions: ['patch', 'diff'] }] });
      if (!this.current(repositoryId, generation)) throw new Error('Repository changed while choosing the patch file. No review started.');
      if (!file) { this.notice.set('Import selection cancelled. No changes made.'); this.git.activity.set('Patch selection cancelled'); return; }
      if (typeof file !== 'string') throw new Error('The file chooser returned multiple paths. Choose one patch; no review started.');
      const review = await invoke<PatchReview>('review_diff_patch', { repoId: repositoryId, file, target });
      this.git.activity.set('Patch checked; no changes applied');
      if (this.current(repositoryId, generation)) {
        this.review.set(review);
        setTimeout(() => { if (this.current(repositoryId, generation)) this.reviewRegion()?.nativeElement.focus(); });
      }
    });
  }

  async apply(): Promise<void> {
    const review = this.review();
    if (!review || this.disabled() || this.pending()) return;
    const repositoryId = this.repositoryId();
    const generation = this.generation;
    this.pending.set(true);
    this.error.set('');
    this.review.set(null);
    try {
      const success = await this.git.importDiffPatch(repositoryId, review.request);
      if (!this.current(repositoryId, generation)) return;
      if (success) this.notice.set(`Patch applied to ${this.targetLabel(review.request.target)}. Inspect the changes before committing.`);
      else {
        this.error.set(this.git.error() ?? 'Patch import failed. Inspect changes and prepare a fresh review; do not repeat blindly.');
        setTimeout(() => this.panel()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus());
      }
    } finally { this.pending.set(false); }
  }
}
