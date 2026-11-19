import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { GitKhronosService } from './git-khronos.service';
import { branchCheckoutOwner } from './repository-location';

export interface CheckoutWorktreeRequest {
  repositoryId: string;
  repositoryPath: string;
  branch: string;
  worktreePath: string;
  prunable: boolean;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-checkout-worktree-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close()">
      <section #dialog tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="checkout-worktree-title" aria-describedby="checkout-worktree-scope"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <h2 id="checkout-worktree-title">Branch is open in another checkout</h2>
        <p id="checkout-worktree-scope"><strong>{{ request().branch }}</strong> is already checked out elsewhere.
          Open that checkout instead of switching this one. No branch or working files will be changed.</p>
        <p>Current checkout: <code>{{ request().repositoryPath }}</code></p>
        <p>Owning checkout: <code>{{ request().worktreePath }}</code></p>
        @if (request().prunable) {
          <p role="alert">The registered checkout is missing. Review its registration from Worktrees. No repair or pruning has been performed.</p>
        }
        @if (error(); as message) { <p role="alert" tabindex="-1">{{ message }}</p> }
        @if (busy()) { <p role="status">Checking branch ownership…</p> }
        <footer>
          <button type="button" [disabled]="busy()" (click)="close()">Cancel</button>
          <button type="button" [disabled]="busy() || git.busy() || request().prunable || !!error()" (click)="confirm()">Open existing checkout</button>
        </footer>
      </section>
    </div>
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: #080811b8; }
    section { box-sizing: border-box; width: min(560px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    code { overflow-wrap: anywhere; }
    footer { display: flex; flex-wrap: wrap; justify-content: end; gap: 8px; margin-top: 18px; }
    button { min-height: 32px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
    button:disabled { opacity: .55; }
    button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class CheckoutWorktreeDialogComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<CheckoutWorktreeRequest>();
  readonly closed = output<void>();
  readonly opened = output<string>();
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private destroyed = false;
  private closing = false;

  constructor() {
    afterNextRender(() => this.focusCancel());
  }

  ngOnDestroy(): void { this.destroyed = true; }

  close(): void {
    if (this.busy() || this.closing) return;
    this.closing = true;
    this.closed.emit();
  }

  async confirm(): Promise<void> {
    const request = this.request();
    const source = this.git.repository();
    if (this.busy() || this.git.busy() || this.error() || request.prunable || source?.id !== request.repositoryId
      || source.path !== request.repositoryPath) return;
    this.busy.set(true);
    try {
      await this.git.refresh();
      const current = this.git.repository();
      if (this.destroyed || this.request() !== request || current?.id !== request.repositoryId
        || current.path !== request.repositoryPath) return;
      const owner = branchCheckoutOwner(current, request.branch);
      if (this.git.error() || !owner || owner.path !== request.worktreePath || owner.prunable) {
        this.error.set(this.git.error()
          ?? 'Branch ownership changed or the checkout is unavailable. Close this review and select the branch again.');
        setTimeout(() => { if (!this.destroyed) this.dialog()?.nativeElement.querySelector<HTMLElement>('[tabindex="-1"]')?.focus(); });
        return;
      }
      this.closing = true;
      this.opened.emit(owner.path);
    } finally {
      this.busy.set(false);
    }
  }

  @HostListener('document:focusin') containFocus(): void {
    const dialog = this.dialog()?.nativeElement;
    if (!this.destroyed && !this.closing && dialog && !dialog.contains(document.activeElement)) this.focusCancel();
  }

  private focusCancel(): void {
    const dialog = this.dialog()?.nativeElement;
    (dialog?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? dialog)?.focus();
  }

  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const buttons = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length].focus();
  }
}
