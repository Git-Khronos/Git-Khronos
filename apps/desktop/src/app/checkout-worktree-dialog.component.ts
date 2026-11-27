import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, OnDestroy, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { GitKhronosService, type OpenRepositoryResult } from './git-khronos.service';
import { branchCheckoutOwner } from './repository-location';
import { isTabKey } from './tab-key';

export interface CheckoutWorktreeRequest {
  scope: string;
  repositoryPath: string;
  sourceRegistrationPath: string;
  branch: string;
  worktreePath: string;
  prunable: boolean;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gk-checkout-worktree-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close()">
      <section #dialog tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="checkout-worktree-title" aria-describedby="checkout-worktree-scope"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <h2 id="checkout-worktree-title">Branch is open in another checkout</h2>
        <p id="checkout-worktree-scope">
          @if (unavailable()) {
            <strong>{{ request().branch }}</strong> is registered to a checkout that cannot be opened.
            Copy its path or review the worktree registrations.
          } @else {
            <strong>{{ request().branch }}</strong> is already checked out elsewhere.
            Open that checkout instead of switching this one. No branch or working files will be changed.
          }
        </p>
        <p>Current checkout: <code>{{ request().repositoryPath }}</code></p>
        <p>Owning checkout: <code>{{ request().worktreePath }}</code></p>
        @if (unavailable()) {
          <p>No repair or pruning has been performed.</p>
        }
        @if (error(); as message) { <p role="alert" tabindex="-1">{{ message }}</p> }
        @if (copyStatus(); as message) { <p role="status">{{ message }}</p> }
        @if (copyFallback()) {
          <label class="copy-fallback">Owning checkout path for manual copy
            <textarea #copyPath rows="2" [value]="request().worktreePath" readonly></textarea>
          </label>
          @if (copyPathMayNormalize()) {
            <p>Manual copy may normalize carriage returns in this path. Retry automatic copy to preserve them.</p>
          }
        }
        @if (phase() !== 'idle') {
          <p role="status">{{ phase() === 'checking' ? 'Checking branch ownership…' : 'Opening existing checkout…' }}</p>
        }
        <footer>
          <button type="button" (click)="close()">{{ error() ? 'Close' : 'Cancel' }}</button>
          <button type="button" (click)="copyOwningPath()">Copy owning path</button>
          @if (unavailable()) {
            <button type="button" [disabled]="git.busy()" (click)="reviewRegistrations()">Review registrations…</button>
          } @else {
            <button type="button" [disabled]="phase() !== 'idle' || git.busy() || !!error()" (click)="confirm()">Open existing checkout</button>
          }
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
    .copy-fallback { display: grid; gap: 4px; font-size: 13px; }
    .copy-fallback textarea { width: 100%; min-width: 0; padding: 6px; resize: vertical; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
    footer { display: flex; flex-wrap: wrap; justify-content: end; gap: 8px; margin-top: 18px; }
    button { min-height: 32px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
    button:disabled { opacity: .55; }
    button:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class CheckoutWorktreeDialogComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<CheckoutWorktreeRequest>();
  readonly closed = output<void>();
  readonly registrationsRequested = output<CheckoutWorktreeRequest>();
  readonly openOwner = input.required<(request: CheckoutWorktreeRequest) => Promise<OpenRepositoryResult>>();
  readonly copyText = input.required<(text: string) => Promise<boolean>>();
  readonly phase = signal<'idle' | 'checking' | 'opening'>('idle');
  readonly error = signal<string | null>(null);
  readonly copyStatus = signal<string | null>(null);
  readonly copyFallback = signal(false);
  protected readonly copyPathMayNormalize = computed(() => this.request().worktreePath.includes('\r'));
  private readonly unavailableRequest = signal<CheckoutWorktreeRequest | null>(null);
  protected unavailable(): boolean {
    return this.request().prunable || this.unavailableRequest() === this.request();
  }
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly copyPath = viewChild<ElementRef<HTMLTextAreaElement>>('copyPath');
  private readonly injector = inject(Injector);
  private destroyed = false;
  private closing = false;
  private copyAttempt = 0;

  constructor() {
    afterNextRender(() => this.focusCancel());
  }

  ngOnDestroy(): void { this.destroyed = true; }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.closed.emit();
  }

  async copyOwningPath(): Promise<void> {
    const request = this.request();
    if (!this.owns(request)) return;
    const attempt = ++this.copyAttempt;
    const origin = document.activeElement;
    this.copyStatus.set(null);
    this.copyFallback.set(false);
    const copied = await this.copyText()(request.worktreePath);
    if (this.owns(request) && attempt === this.copyAttempt) {
      this.copyStatus.set(copied ? 'Owning checkout path copied.' : 'Could not copy the path automatically. Copy it from the field below.');
      if (!copied) {
        this.copyFallback.set(true);
        afterNextRender(() => {
          if (!this.owns(request) || attempt !== this.copyAttempt || document.activeElement !== origin) return;
          const field = this.copyPath()?.nativeElement;
          field?.focus();
          field?.select();
        }, { injector: this.injector });
      }
    }
  }

  reviewRegistrations(): void {
    const request = this.request();
    if (!this.unavailable() || this.git.busy() || !this.owns(request)) return;
    this.registrationsRequested.emit(request);
  }

  async confirm(): Promise<void> {
    const request = this.request();
    if (this.phase() !== 'idle' || this.git.busy() || this.error() || request.prunable || !this.owns(request)) return;
    this.phase.set('checking');
    this.dialog()?.nativeElement.focus();
    try {
      const refresh = await this.git.refresh({ stillCurrent: () => this.owns(request), inlineFailure: true });
      const current = this.git.repository();
      if (!current || !this.owns(request)) return;
      const owner = branchCheckoutOwner(current, request.branch);
      if (refresh.status === 'success' && owner?.path === request.worktreePath && owner.prunable) {
        this.unavailableRequest.set(request);
        this.showError(request, 'The owning checkout became unavailable during review. No checkout was opened.');
        return;
      }
      if (refresh.status !== 'success' || !owner || owner.path !== request.worktreePath || owner.prunable) {
        this.showError(request, refresh.error
          ?? 'Branch ownership changed or the checkout is unavailable. Close this review and select the branch again.');
        return;
      }
      this.phase.set('opening');
      const opened = await this.openOwner()(request);
      if (opened.status !== 'success' && this.owns(request)) {
        this.showError(request, opened.error ?? 'The checkout could not be opened. Close this review and select the branch again.');
      }
    } finally {
      if (this.owns(request)) this.phase.set('idle');
    }
  }

  private showError(request: CheckoutWorktreeRequest, message: string): void {
    this.error.set(message);
    setTimeout(() => {
      if (this.owns(request)) this.dialog()?.nativeElement.querySelector<HTMLElement>('[role="alert"][tabindex]')?.focus();
    });
  }

  @HostListener('document:focusin') containFocus(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog && !dialog.contains(document.activeElement)) this.focusCancel();
  }

  private owns(request: CheckoutWorktreeRequest): boolean {
    return !this.destroyed && !this.closing && this.request() === request
      && this.git.activeRepositoryReadScope() === request.scope;
  }

  private focusCancel(): void {
    if (!this.owns(this.request())) return;
    const dialog = this.dialog()?.nativeElement;
    (dialog?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? dialog)?.focus();
  }

  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    if (!isTabKey(event)) return;
    event.preventDefault();
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') ?? [])];
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
