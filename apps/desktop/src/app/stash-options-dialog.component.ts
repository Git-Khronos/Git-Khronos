import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { StashEntry, StashOptions } from '@git-chronos/contracts';
import { GitChronosService } from './git-chronos.service';
import { GitHelpComponent } from './git-help.component';

export interface StashDialogRequest {
  action: 'save' | 'apply' | 'branch' | 'switch';
  repositoryId: string;
  message?: string;
  stash?: StashEntry;
  branch?: { name: string; oid: string };
  headOid?: string;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-stash-options-dialog',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="close()">
        <section #dialog role="dialog" aria-modal="true" aria-labelledby="stash-options-title"
          aria-describedby="stash-options-description" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
          <h2 id="stash-options-title">{{ title() }}</h2>
          <p id="stash-options-description">{{ description() }}</p>
          @if (target.action === 'save') {
            <label>Message (optional)<input name="stashMessage" maxlength="500" [ngModel]="message()" (ngModelChange)="message.set($event)" /></label>
            <label>What to save<select name="stashMode" [ngModel]="mode()" (ngModelChange)="changeMode($event)">
              <option value="all">Staged and unstaged changes</option>
              <option value="keep-index">Save changes, keep staged contents in place</option>
              <option value="staged-only">Only staged changes (Git 2.35+)</option>
            </select></label>
            <p class="hint">{{ modeDescription() }}</p>
            <label class="check"><input type="checkbox" name="stashUntracked" [disabled]="mode() === 'staged-only'"
              [ngModel]="includeUntracked()" (ngModelChange)="includeUntracked.set($event)" />Include untracked files (ignored files stay untouched)</label>
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
            <button type="button" [disabled]="!canConfirm() || git.busy()" (click)="confirm()">{{ actionLabel() }}</button>
          </footer>
          @if (git.busy()) { <p role="status">Git is updating the repository. Wait before closing.</p> }
        </section>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: var(--modal-backdrop, #080811b8); }
    section { width: min(520px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p, label, summary { font-size: 13px; line-height: 1.5; }
    code { overflow-wrap: anywhere; min-width: 0; }
    label { display: grid; gap: 6px; margin-top: 14px; }
    .check { display: flex; align-items: start; gap: 8px; }
    .check input { flex: none; margin-top: 3px; }
    input:not([type=checkbox]), select { width: 100%; padding: 8px; background: var(--inspector-row); color: var(--text); border: 1px solid var(--inspector-divider); border-radius: 4px; }
    details { margin-top: 16px; }
    summary { cursor: pointer; }
    .files { max-height: 210px; overflow: auto; }
    .hint { color: var(--muted); }
    footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    .error { color: var(--danger); }
  `],
})
export class StashOptionsDialogComponent {
  readonly git = inject(GitChronosService);
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
    save: 'Stash with options', apply: 'Apply stash', branch: 'Create branch from stash', switch: 'Stash and switch branch',
  })[this.request()?.action ?? 'save']);
  readonly description = computed(() => ({
    save: 'Save work locally without creating a commit. Review what will remain in the working directory.',
    apply: 'Restore saved changes without removing the stash.',
    branch: "Create and check out a new branch at the stash's original base, then restore its staged and unstaged changes.",
    switch: 'Explicitly save your current work in a stash before checking out the selected branch.',
  })[this.request()?.action ?? 'save']);
  readonly modeDescription = computed(() => ({
    all: 'Saved tracked changes are removed from the working directory and index.',
    'keep-index': 'The stash contains staged and unstaged changes; staged contents remain in the working directory and index.',
    'staged-only': 'Only the staged changes are saved and removed. Unstaged edits remain; overlapping changes may be refused by Git.',
  })[this.mode()]);
  readonly actionLabel = computed(() => ({
    save: 'Create stash', apply: 'Apply and keep stash', branch: 'Create branch and restore', switch: 'Stash and checkout',
  })[this.request()?.action ?? 'save']);
  readonly canConfirm = computed(() => {
    const target = this.request();
    if (!target || target.repositoryId !== this.git.activeRepositoryId()) return false;
    if (target.action === 'save') return !this.selectedOnly() || this.selectedPaths().length > 0;
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
