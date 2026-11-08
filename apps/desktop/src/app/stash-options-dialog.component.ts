import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CommitFile, StashEntry, StashOptions } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';
import { IconComponent } from './icon.component';

export interface StashDialogRequest {
  action: 'save' | 'apply' | 'apply-file' | 'branch' | 'switch';
  repositoryId: string;
  message?: string;
  stash?: StashEntry;
  file?: CommitFile;
  branch?: { name: string; oid: string };
  headOid?: string;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-stash-options-dialog',
  imports: [FormsModule, GitHelpComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="close()">
        <section #dialog role="dialog" aria-modal="true" aria-labelledby="stash-options-title"
          aria-describedby="stash-options-description" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
          <header class="dialog-heading">
            <span class="dialog-icon" aria-hidden="true"><gc-icon name="archive" [size]="18" /></span>
            <span class="dialog-heading-copy">
              <small>{{ eyebrow() }}</small>
              <h2 id="stash-options-title">{{ title() }}</h2>
              <p id="stash-options-description">{{ description() }}</p>
            </span>
          </header>
          @if (target.action === 'save') {
            <div class="repository-context" role="group" aria-label="Stash source">
              <gc-icon name="branch" [size]="14" aria-hidden="true" />
              <span><strong>{{ git.repository()?.status?.branch || 'Detached HEAD' }}</strong><small>{{ git.repository()?.status?.entryCount || 0 }} changed {{ git.repository()?.status?.entryCount === 1 ? 'file' : 'files' }}</small></span>
              <code>HEAD</code>
            </div>
            <div class="form-section">
              <label>Message <small>Optional</small><input name="stashMessage" maxlength="500" [ngModel]="message()" (ngModelChange)="message.set($event)" /></label>
              <label>Changes to save<select name="stashMode" [ngModel]="mode()" (ngModelChange)="changeMode($event)">
                <option value="all">Staged and unstaged changes</option>
                <option value="keep-index">Save changes, keep staged contents in place</option>
                <option value="staged-only">Only staged changes (Git 2.35+)</option>
              </select></label>
              <p class="hint">{{ modeDescription() }}</p>
              <label class="check"><input type="checkbox" name="stashUntracked" [disabled]="mode() === 'staged-only'"
                [ngModel]="includeUntracked()" (ngModelChange)="includeUntracked.set($event)" />Include untracked files <small>Ignored files stay untouched</small></label>
            </div>
            <details>
              <summary>Choose specific files</summary>
              <label class="check"><input type="checkbox" name="stashSelectedOnly" [ngModel]="selectedOnly()" (ngModelChange)="selectedOnly.set($event)" />Save only selected files</label>
              @if (selectedOnly()) {
                <p class="hint">Unselected files remain untouched.
                  @if (git.repository()?.status?.entriesTruncated) { This list contains loaded files only. Turn off selection to include the complete native status. }
                </p>
                <div class="files">
                  @for (file of git.repository()?.status?.entries ?? []; track file.path) {
                    @if (!file.conflicted && (file.indexStatus !== '?' || includeUntracked())) {
                      <label class="check"><input type="checkbox" [attr.aria-label]="'Stash ' + file.path"
                        [checked]="selectedPaths().includes(file.path)" (change)="togglePath(file.path)" /><code>{{ file.path }}</code></label>
                    }
                  }
                </div>
              }
            </details>
          } @else if (target.action === 'apply') {
            <code>{{ target.stash?.reference }} — {{ target.stash?.message }}</code>
            <label class="check"><input type="checkbox" name="restoreStashIndex" [ngModel]="restoreIndex()" (ngModelChange)="restoreIndex.set($event)" />Restore which changes were staged</label>
            <p class="hint">The stash is kept. If applying conflicts, resolve the files before trying again.</p>
          } @else if (target.action === 'apply-file') {
            <code>{{ target.stash?.reference }} — {{ target.stash?.message }}</code>
            <p><strong>File:</strong> <code>@if (target.file; as file) { @if (file.previousPath) { {{ file.previousPath }} → }{{ file.path }} }</code></p>
            <p class="hint">Apply this file's combined saved changes to the working directory. The index and stash stay unchanged.
              Overlapping changes are refused; review current work before retrying.</p>
          } @else if (target.action === 'branch') {
            <code>{{ target.stash?.reference }} — {{ target.stash?.message }}</code>
            <label>New branch name<input name="stashBranchName" autocomplete="off" [ngModel]="branchName()" (ngModelChange)="branchName.set($event)" /></label>
            <p class="hint">Requires a clean working directory. The original stash remains available after restoration.</p>
          } @else {
            <code>{{ target.branch?.name }}</code>
            <p class="hint">Staged, unstaged and untracked changes are saved together. Ignored files are not saved.
              This does not automatically apply the stash on the destination branch.</p>
          }
          @if (git.error()) { <p class="error" role="alert">{{ git.error() }}</p> }
          <gc-git-help topic="stash" label="Learn about stash modes and recovery…" />
          <footer>
            <button type="button" data-stash-cancel [disabled]="git.busy()" (click)="close()">Cancel</button>
            <button class="primary" type="button" [disabled]="!canConfirm() || git.busy()" (click)="confirm()">{{ actionLabel() }}</button>
          </footer>
          @if (git.busy()) { <p role="status">Git is updating the repository. Wait before closing.</p> }
        </section>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: var(--modal-backdrop, #080811b8); }
    section { width: min(520px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); box-shadow: 0 20px 55px #0008; }
    .dialog-heading { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; align-items: start; }
    .dialog-icon { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
    .dialog-heading-copy { min-width: 0; display: grid; gap: 3px; }
    .dialog-heading-copy > small { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h2 { margin: 0; font-size: 16px; }
    .dialog-heading p { margin: 3px 0 0; }
    p, label, summary { font-size: 13px; line-height: 1.5; }
    code { overflow-wrap: anywhere; min-width: 0; }
    label { display: grid; gap: 6px; margin-top: 14px; }
    label > small { color: var(--muted); font-size: 11px; }
    .check { display: flex; align-items: start; gap: 8px; }
    .check small { margin-left: 2px; color: var(--muted); }
    .check input { flex: none; margin-top: 3px; }
    input:not([type=checkbox]), select { width: 100%; padding: 8px; background: var(--inspector-row); color: var(--text); border: 1px solid var(--inspector-divider); border-radius: 4px; }
    .repository-context { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 9px; margin-top: 16px; padding: 9px 10px; border: 1px solid var(--inspector-divider); border-radius: 5px; background: color-mix(in srgb, var(--inspector-row) 72%, transparent); color: var(--accent); }
    .repository-context > span { min-width: 0; display: grid; gap: 1px; color: var(--text); }
    .repository-context strong, .repository-context small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repository-context strong { font-size: 12px; }
    .repository-context small { color: var(--muted); font-size: 11px; }
    .repository-context code { color: var(--muted); font-size: 11px; }
    .form-section { margin-top: 14px; padding-top: 1px; border-top: 1px solid var(--inspector-divider); }
    details { margin-top: 16px; }
    summary { cursor: pointer; }
    .files { max-height: 210px; overflow: auto; }
    .hint { color: var(--muted); }
    footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { min-height: 34px; padding: 8px 12px; border: 1px solid var(--inspector-divider); border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    button.primary { border-color: color-mix(in srgb, var(--accent) 72%, #000); background: var(--accent); color: #10251e; font-weight: 700; }
    button:hover:not(:disabled), button:focus-visible { filter: brightness(1.08); }
    button:disabled { cursor: default; filter: none; opacity: .45; }
    .error { color: var(--danger); }
  `],
})
export class StashOptionsDialogComponent {
  readonly git = inject(GitKhronosService);
  readonly request = input<StashDialogRequest | null>(null);
  readonly closed = output<void>();
  readonly mode = signal<StashOptions['mode']>('all');
  readonly includeUntracked = signal(true);
  readonly message = signal('');
  readonly selectedOnly = signal(false);
  readonly selectedPaths = signal<string[]>([]);
  readonly restoreIndex = signal(true);
  readonly branchName = signal('');
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly title = computed(() => ({
    save: 'Stash with options', apply: 'Apply stash', 'apply-file': 'Apply stashed file', branch: 'Create branch from stash', switch: 'Stash and switch branch',
  })[this.request()?.action ?? 'save']);
  readonly eyebrow = computed(() => ({
    save: 'Working directory', apply: 'Saved work', 'apply-file': 'Saved work', branch: 'Saved work', switch: 'Working directory',
  })[this.request()?.action ?? 'save']);
  readonly description = computed(() => ({
    save: 'Save work locally without creating a commit. Review what will remain in the working directory.',
    apply: 'Restore saved changes without removing the stash.',
    'apply-file': 'Apply only the selected file without removing the stash.',
    branch: "Create and check out a new branch at the stash's original base, then restore its staged and unstaged changes.",
    switch: 'Explicitly save your current work in a stash before checking out the selected branch.',
  })[this.request()?.action ?? 'save']);
  readonly modeDescription = computed(() => ({
    all: 'Saved tracked changes are removed from the working directory and index.',
    'keep-index': 'The stash contains staged and unstaged changes; staged contents remain in the working directory and index.',
    'staged-only': 'Only the staged changes are saved and removed. Unstaged edits remain; overlapping changes may be refused by Git.',
  })[this.mode()]);
  readonly actionLabel = computed(() => ({
    save: 'Create stash', apply: 'Apply and keep stash', 'apply-file': 'Apply file and keep stash', branch: 'Create branch and restore', switch: 'Stash and checkout',
  })[this.request()?.action ?? 'save']);
  readonly canConfirm = computed(() => {
    const target = this.request();
    if (!target || target.repositoryId !== this.git.activeRepositoryId()) return false;
    if (target.action === 'save') return !this.selectedOnly() || this.selectedPaths().length > 0;
    if (target.action === 'apply-file') return !!target.stash && !!target.file;
    if (target.action === 'branch') return !!this.branchName().trim() && this.git.repository()?.status.entryCount === 0;
    return target.action === 'apply' || !!target.headOid;
  });

  constructor() {
    effect(() => {
      const target = this.request();
      if (!target) return;
      this.mode.set('all');
      this.includeUntracked.set(true);
      this.message.set(target.message ?? '');
      this.selectedOnly.set(false);
      this.selectedPaths.set([]);
      this.restoreIndex.set(true);
      this.branchName.set('');
      setTimeout(() => {
        if (this.request() === target) this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('[data-stash-cancel]')?.focus();
      });
    });
  }

  changeMode(mode: StashOptions['mode']): void {
    this.mode.set(mode);
    if (mode === 'staged-only') this.includeUntracked.set(false);
  }

  togglePath(path: string): void {
    this.selectedPaths.update(paths => paths.includes(path) ? paths.filter(candidate => candidate !== path) : [...paths, path]);
  }

  async confirm(): Promise<void> {
    const target = this.request();
    if (!target || !this.canConfirm() || this.git.busy()) return;
    switch (target.action) {
      case 'save':
        await this.git.stashSelected({ mode: this.mode(), includeUntracked: this.includeUntracked(),
          paths: this.selectedOnly() ? this.selectedPaths() : null, message: this.message().trim() });
        break;
      case 'apply':
        if (!target.stash) return;
        await this.git.applyStashOptions(target.stash.reference, target.stash.oid, this.restoreIndex());
        break;
      case 'apply-file':
        if (!target.stash || !target.file) return;
        if (await this.git.applyStashedFile(target.stash, target.file, target.repositoryId)
          && this.request() === target) this.close();
        return;
      case 'branch':
        if (!target.stash) return;
        await this.git.branchFromStash(target.stash.reference, target.stash.oid, this.branchName().trim());
        break;
      case 'switch':
        if (!target.branch || !target.headOid) return;
        await this.git.stashCheckout(target.branch.name, target.headOid, target.branch.oid, this.message().trim());
        break;
    }
    if (!this.git.error() && this.request() === target) this.close();
  }

  close(): void {
    if (this.git.busy()) return;
    const opener = this.request()?.returnFocus;
    this.closed.emit();
    setTimeout(() => { if (opener?.isConnected) opener.focus(); });
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary') ?? []).filter(control => control.getClientRects().length);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (!controls.length) return;
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0].focus(); }
  }
}
