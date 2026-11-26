import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Worktree } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { isTabKey } from './tab-key';

export interface WorktreeLockRequest {
  repositoryId: string;
  repositoryPath: string;
  worktree: Worktree;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gk-worktree-lock-dialog',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="close(target)">
        <form #dialog role="dialog" aria-modal="true" aria-labelledby="lock-title"
          aria-describedby="lock-description" (click)="$event.stopPropagation()"
          (submit)="$event.preventDefault(); confirm(target)" (keydown)="handleKey($event, target)">
          <h2 id="lock-title">Lock linked worktree</h2>
          <p id="lock-description">A lock protects this worktree registration from pruning, moving, or removal until it is unlocked.</p>
          <p>Worktree: <code>{{ target.worktree.branch || 'Detached HEAD' }}</code> · <code>{{ target.worktree.path }}</code></p>
          <label for="worktree-lock-reason">Reason (optional)</label>
          <input #reasonInput id="worktree-lock-reason" name="reason" type="text" maxlength="500"
            autocomplete="off" [disabled]="git.busy()" [ngModel]="reason()"
            (ngModelChange)="changeReason($event, target)" />
          <small>A short note helps explain why this worktree must be kept.</small>
          @if (!owns(target)) {
            <p role="alert" tabindex="-1">The active repository or worktree changed. Close this dialog and review the intended worktree.</p>
          }
          @if (git.error()) { <p role="alert" tabindex="-1">{{ git.error() }}</p> }
          <footer>
            <button type="button" data-lock-cancel [disabled]="git.busy()" (click)="close(target)">Cancel</button>
            <button type="submit" [disabled]="!canConfirm(target)">{{ git.busy() ? 'Locking…' : 'Lock worktree' }}</button>
          </footer>
        </form>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: #080811b8; }
    form { width: min(500px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    code { overflow-wrap: anywhere; }
    label { display: block; margin: 14px 0 6px; font-size: 13px; }
    input { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--inspector-divider); background: var(--inspector-row); color: var(--text); }
    small { display: block; margin-top: 5px; color: var(--muted); }
    footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    button:disabled, input:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class WorktreeLockDialogComponent {
  readonly git = inject(GitKhronosService);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly reasonInput = viewChild<ElementRef<HTMLInputElement>>('reasonInput');
  readonly request = input<WorktreeLockRequest | null>(null);
  readonly ownsRequest = input.required<(request: WorktreeLockRequest) => boolean>();
  readonly closed = output<WorktreeLockRequest>();
  readonly reason = signal('');

  constructor() {
    effect(() => {
      const target = this.request();
      this.reason.set('');
      if (target) afterNextRender(() => {
        if (this.owns(target)) this.reasonInput()?.nativeElement.focus();
      }, { injector: this.injector });
    });
  }

  owns(target: WorktreeLockRequest): boolean {
    const repository = this.git.repository();
    return this.request() === target && this.ownsRequest()(target)
      && repository?.id === target.repositoryId && repository.path === target.repositoryPath
      && repository.worktrees.some(worktree => worktree.path === target.worktree.path && !worktree.locked);
  }

  canConfirm(target: WorktreeLockRequest): boolean {
    const reason = this.reason();
    return this.owns(target) && !this.git.busy() && reason.length <= 500
      && !reason.includes('\0') && !reason.includes('\n') && !reason.includes('\r');
  }

  changeReason(value: string, target: WorktreeLockRequest): void {
    if (this.owns(target) && !this.git.busy()) this.reason.set(value.slice(0, 500).replace(/[\0\r\n]/g, ' '));
  }

  async confirm(target: WorktreeLockRequest): Promise<void> {
    if (!this.canConfirm(target)) return;
    const reason = this.reason().trim();
    const succeeded = await this.git.setWorktreeLocked(target.worktree.path, true, reason || null);
    if (succeeded && this.request() === target) this.closed.emit(target);
    else afterNextRender(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[role="alert"]')?.focus(), { injector: this.injector });
  }

  close(target: WorktreeLockRequest): void {
    if (this.request() === target && !this.git.busy()) this.closed.emit(target);
  }

  handleKey(event: KeyboardEvent, target: WorktreeLockRequest): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close(target);
      return;
    }
    if (!isTabKey(event)) return;
    const dialog = event.currentTarget as HTMLElement;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
      .filter(control => control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
