import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Worktree } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';

export interface WorktreeMoveRequest {
  repositoryId: string;
  repositoryPath: string;
  worktree: Worktree;
  returnFocus: HTMLElement | null;
  repair?: boolean;
}

@Component({
  selector: 'gk-worktree-move-dialog',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (target of reviews(); track target) {
      <div class="backdrop" (click)="close(target)">
        <form #dialog role="dialog" aria-modal="true" aria-labelledby="move-worktree-title"
          aria-describedby="move-worktree-scope" (click)="$event.stopPropagation()"
          (submit)="$event.preventDefault(); confirm(target)" (keydown)="handleKey($event, target)">
          <h2 id="move-worktree-title">{{ target.repair ? 'Repair moved worktree' : 'Move linked worktree' }}</h2>
          <p id="move-worktree-scope">@if (target.repair) {
            Repair Git links after an external directory move. No files are moved or deleted, no branch is changed, and no registration is pruned.
          } @else {
            Move the directory and update its Git registration. Branch, staged, unstaged, untracked and ignored files stay with the worktree. No branch is deleted.
          }</p>
          <p>Checkout: <code>{{ target.repositoryPath }}</code></p>
          <p>{{ target.repair ? 'Registered old path' : 'Source' }}: <code>{{ target.worktree.path }}</code></p>
          <p>Branch: {{ target.worktree.branch || 'Detached HEAD' }} · <code>{{ target.worktree.oid }}</code></p>
          @if (target.repair) {
            <label for="repair-directory">Actual moved worktree directory</label>
            <div class="parent"><input id="repair-directory" name="actualPath" type="text" [disabled]="git.busy() || choosing()"
              [ngModel]="actualPath()" (ngModelChange)="changePath('actualPath', $event, target)" /><button type="button" [disabled]="git.busy() || choosing()" (click)="chooseParent(target)">Browse…</button></div>
            <p>The old path must be missing. Select the original linked directory, not a copy or another worktree. Close its old and actual repository tabs first. Locked registrations, submodule entries, ambiguous or relative links, and other broken registrations require local Git repair.</p>
          } @else {
          <label for="move-parent">Destination parent directory</label>
          <div class="parent"><input id="move-parent" name="parent" type="text" [disabled]="git.busy() || choosing()"
            [ngModel]="parent()" (ngModelChange)="changePath('parent', $event, target)" /><button type="button" [disabled]="git.busy() || choosing()" (click)="chooseParent(target)">Browse…</button></div>
          <label for="move-folder">New folder name</label>
          <input id="move-folder" name="folder" type="text" [disabled]="git.busy() || choosing()"
            [ngModel]="folder()" (ngModelChange)="changePath('folder', $event, target)" />
          <p class="destination">Destination: {{ destination() }}</p>
          <p>Use an unused folder outside the source. Locked, open or missing worktrees cannot move. Git also refuses worktrees containing submodules and unsupported filesystem moves. No force option is used.</p>
          }
          @if (target.repositoryId !== git.activeRepositoryId() || target.repositoryPath !== git.repository()?.path) {
            <p role="alert" tabindex="-1">The active repository changed. Close this dialog and review the intended repository.</p>
          }
          @if (git.error()) { <p role="alert" tabindex="-1">{{ git.error() }}</p> }
          <gk-git-help topic="worktree" label="Learn about worktree move and repair…" />
          <footer><button type="button" data-move-cancel [disabled]="git.busy()" (click)="close(target)">Cancel</button>
            <button type="submit" [disabled]="!canConfirm(target)">{{ target.repair ? (git.busy() ? 'Repairing…' : 'Repair registration') : (git.busy() ? 'Moving…' : 'Move worktree') }}</button></footer>
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
  readonly git = inject(GitKhronosService);
  readonly request = input<WorktreeMoveRequest | null>(null);
  readonly ownsRequest = input.required<(request: WorktreeMoveRequest) => boolean>();
  readonly reviews = computed(() => { const request = this.request(); return request ? [request] : []; });
  readonly closed = output<{ request: WorktreeMoveRequest; movedPath?: string }>();
  readonly parent = signal('');
  readonly folder = signal('');
  readonly actualPath = signal('');
  readonly choosing = signal(false);
  private pickerGeneration = 0;
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    effect(() => {
      const target = this.request();
      this.pickerGeneration++;
      this.choosing.set(false);
      if (!target) return;
      const separator = Math.max(target.worktree.path.lastIndexOf('/'), target.worktree.path.lastIndexOf('\\'));
      this.parent.set(target.worktree.path.slice(0, separator) || '/');
      this.folder.set('');
      this.actualPath.set('');
      setTimeout(() => {
        if (this.owns(target)) this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-move-cancel]')?.focus();
      });
    });
  }

  destination(): string {
    const parent = this.parent().replace(/[\\/]+$/, '');
    return `${parent}${this.parent().includes('\\') ? '\\' : '/'}${this.folder() || '(choose a folder)'}`;
  }

  private owns(target: WorktreeMoveRequest | null): target is WorktreeMoveRequest {
    const repository = this.git.repository();
    return !!target && this.request() === target && this.ownsRequest()(target)
      && repository?.id === target.repositoryId && repository.path === target.repositoryPath;
  }

  changePath(field: 'parent' | 'folder' | 'actualPath', value: string, target: WorktreeMoveRequest): void {
    if (this.owns(target) && !this.git.busy() && !this.choosing()) this[field].set(value);
  }

  async chooseParent(target = this.request()): Promise<void> {
    if (!this.owns(target) || this.git.busy() || this.choosing()) return;
    const generation = ++this.pickerGeneration;
    const current = () => this.owns(target) && generation === this.pickerGeneration;
    this.choosing.set(true);
    try {
      const parent = await this.git.chooseDirectory(target.repair
        ? 'Choose the moved worktree directory' : 'Choose the worktree destination parent', current);
      if (parent && current()) {
        if (target.repair) this.actualPath.set(parent);
        else this.parent.set(parent);
      }
    } finally {
      if (current()) this.choosing.set(false);
    }
  }

  canConfirm(target = this.request()): boolean {
    return this.owns(target) && !this.git.busy() && !this.choosing()
      && (target.repair ? !!this.actualPath().trim() : !!this.parent().trim() && !!this.folder().trim());
  }

  async confirm(target = this.request()): Promise<void> {
    if (!this.owns(target) || !this.canConfirm(target)) return;
    const movedPath = target.repair ? this.actualPath() : this.destination();
    const success = target.repair ? await this.git.repairWorktree({
      path: target.worktree.path, actualPath: this.actualPath(),
      expectedOid: target.worktree.oid, expectedBranch: target.worktree.branch,
    }, target.repositoryId) : await this.git.moveWorktree({
      path: target.worktree.path, parentPath: this.parent(), folder: this.folder(),
      expectedOid: target.worktree.oid, expectedBranch: target.worktree.branch,
    }, target.repositoryId);
    if (!this.owns(target)) return;
    if (success) this.close(target, movedPath);
    else setTimeout(() => {
      if (this.owns(target)) this.dialog()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus();
    });
  }

  close(target = this.request(), movedPath?: string): void {
    if (!this.owns(target) || this.git.busy()) return;
    this.closed.emit({ request: target, movedPath });
  }

  handleKey(event: KeyboardEvent, target = this.request()): void {
    if (!this.owns(target)) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(target); }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])]
      .filter(control => control.getClientRects().length);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
