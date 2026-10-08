import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Worktree } from '@git-chronos/contracts';
import { GitChronosService } from './git-chronos.service';
import { GitHelpComponent } from './git-help.component';

export interface WorktreeMoveRequest {
  repositoryId: string;
  worktree: Worktree;
  returnFocus: HTMLElement | null;
  repair?: boolean;
}

@Component({
  selector: 'gc-worktree-move-dialog',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="close()">
        <form #dialog role="dialog" aria-modal="true" aria-labelledby="move-worktree-title"
          aria-describedby="move-worktree-scope" (click)="$event.stopPropagation()"
          (submit)="$event.preventDefault(); confirm()" (keydown)="handleKey($event)">
          <h2 id="move-worktree-title">{{ target.repair ? 'Repair moved worktree' : 'Move linked worktree' }}</h2>
          <p id="move-worktree-scope">@if (target.repair) {
            Repair Git links after an external directory move. No files are moved or deleted, no branch is changed, and no registration is pruned.
          } @else {
            Move the directory and update its Git registration. Branch, staged, unstaged, untracked and ignored files stay with the worktree. No branch is deleted.
          }</p>
          <p>{{ target.repair ? 'Registered old path' : 'Source' }}: <code>{{ target.worktree.path }}</code></p>
          <p>Branch: {{ target.worktree.branch || 'Detached HEAD' }} · <code>{{ target.worktree.oid }}</code></p>
          @if (target.repair) {
            <label for="repair-directory">Actual moved worktree directory</label>
            <div class="parent"><input id="repair-directory" name="actualPath" type="text" [disabled]="git.busy() || choosing()"
              [ngModel]="actualPath()" (ngModelChange)="actualPath.set($event)" /><button type="button" [disabled]="git.busy() || choosing()" (click)="chooseParent()">Browse…</button></div>
            <p>The old path must be missing. Select the original linked directory, not a copy or another worktree. Close its old and actual repository tabs first. Locked registrations, submodule entries, ambiguous or relative links, and other broken registrations require local Git repair.</p>
          } @else {
          <label for="move-parent">Destination parent directory</label>
          <div class="parent"><input id="move-parent" name="parent" type="text" [disabled]="git.busy() || choosing()"
            [ngModel]="parent()" (ngModelChange)="parent.set($event)" /><button type="button" [disabled]="git.busy() || choosing()" (click)="chooseParent()">Browse…</button></div>
          <label for="move-folder">New folder name</label>
          <input id="move-folder" name="folder" type="text" [disabled]="git.busy()"
            [ngModel]="folder()" (ngModelChange)="folder.set($event)" />
          <p class="destination">Destination: {{ destination() }}</p>
          <p>Use an unused folder outside the source. Locked, open or missing worktrees cannot move. Git also refuses worktrees containing submodules and unsupported filesystem moves. No force option is used.</p>
          }
          @if (target.repositoryId !== git.activeRepositoryId()) {
            <p role="alert" tabindex="-1">The active repository changed. Close this dialog and review the intended repository.</p>
          }
          @if (git.error()) { <p role="alert" tabindex="-1">{{ git.error() }}</p> }
          <gc-git-help topic="worktree" label="Learn about worktree move and repair…" />
          <footer><button type="button" data-move-cancel [disabled]="git.busy()" (click)="close()">Cancel</button>
            <button type="submit" [disabled]="(target.repair ? !actualPath().trim() : !parent().trim() || !folder().trim()) || git.busy() || choosing() || target.repositoryId !== git.activeRepositoryId()">{{ target.repair ? (git.busy() ? 'Repairing…' : 'Repair registration') : (git.busy() ? 'Moving…' : 'Move worktree') }}</button></footer>
        </form>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: #080811b8; }
    form { width: min(540px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p { font-size: 13px; line-height: 1.5; }
    code, .destination { overflow-wrap: anywhere; }
    label { display: block; margin: 14px 0 6px; font-size: 13px; }
    input { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px; background: var(--inspector-row); color: var(--text); border: 1px solid var(--inspector-divider); }
    .parent { display: flex; gap: 8px; }
    footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    button:disabled, input:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class WorktreeMoveDialogComponent {
  readonly git = inject(GitChronosService);
  readonly request = input<WorktreeMoveRequest | null>(null);
  readonly closed = output<void>();
  readonly parent = signal('');
  readonly folder = signal('');
  readonly actualPath = signal('');
  readonly choosing = signal(false);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    effect(() => {
      const target = this.request();
      if (!target) return;
      const separator = Math.max(target.worktree.path.lastIndexOf('/'), target.worktree.path.lastIndexOf('\\'));
      this.parent.set(target.worktree.path.slice(0, separator) || '/');
      this.folder.set('');
      this.actualPath.set('');
      setTimeout(() => {
        if (this.request() === target) this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-move-cancel]')?.focus();
      });
    });
  }

  destination(): string {
    const parent = this.parent().replace(/[\\/]+$/, '');
    return `${parent}${this.parent().includes('\\') ? '\\' : '/'}${this.folder() || '(choose a folder)'}`;
  }

  async chooseParent(): Promise<void> {
    const target = this.request();
    this.choosing.set(true);
    try {
      const parent = await this.git.chooseDirectory(target?.repair ? 'Choose the moved worktree directory' : 'Choose the worktree destination parent');
      if (parent && this.request() === target) {
        if (target?.repair) this.actualPath.set(parent);
        else this.parent.set(parent);
      }
    } finally {
      this.choosing.set(false);
    }
  }

  async confirm(): Promise<void> {
    const target = this.request();
    if (!target || this.git.busy() || this.choosing()) return;
    const success = target.repair ? await this.git.repairWorktree({
      path: target.worktree.path, actualPath: this.actualPath(),
      expectedOid: target.worktree.oid, expectedBranch: target.worktree.branch,
    }, target.repositoryId) : await this.git.moveWorktree({
      path: target.worktree.path, parentPath: this.parent(), folder: this.folder(),
      expectedOid: target.worktree.oid, expectedBranch: target.worktree.branch,
    }, target.repositoryId);
    if (this.request() !== target) return;
    if (success) this.close(target.repair ? this.actualPath() : this.destination());
    else setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus());
  }

  close(movedPath?: string): void {
    if (this.git.busy()) return;
    const opener = this.request()?.returnFocus;
    this.closed.emit();
    setTimeout(() => {
      const replacement = movedPath
        ? [...document.querySelectorAll<HTMLButtonElement>('button[data-worktree-path]')]
          .find((button) => button.dataset['worktreePath'] === movedPath)
        : null;
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else if (replacement?.getClientRects().length) replacement.focus();
      else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus();
    });
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])];
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault(); event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
