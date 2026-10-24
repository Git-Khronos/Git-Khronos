import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import type { StashEntry } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

export interface StashDeleteRequest {
  repositoryId: string;
  stash: StashEntry;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-stash-delete-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close(false)">
      <section #dialog role="alertdialog" aria-modal="true" aria-label="Delete stash"
        aria-describedby="stash-delete-description" tabindex="-1" [attr.aria-busy]="deleting()"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <h2>Delete stash</h2>
        <h3>{{ request().stash.message }}</h3>
        <p id="stash-delete-description">Remove {{ request().stash.reference }} from the stash list. Its staged, unstaged and untracked contents are saved in Recovery History first, so you can restore them on a new branch until you remove that capture.</p>
        @if (!available()) { <p role="status">The repository or stash list changed. Cancel and select the stash again.</p> }
        @if (error()) { <p #failure role="alert" tabindex="-1" class="error">{{ error() }}</p> }
        @if (deleting()) { <p role="status">Deleting stash and preserving its recovery capture…</p> }
        <footer>
          <button #cancel type="button" [disabled]="deleting()" (click)="close(false)">Cancel</button>
          <button type="button" class="danger" [disabled]="!available() || git.busy() || deleting()" (click)="confirm()">{{ deleting() ? 'Deleting…' : error() ? 'Retry Delete' : 'Delete Stash' }}</button>
        </footer>
      </section>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: #080811b8; }
    section { box-sizing: border-box; width: min(480px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; } h3 { font-size: 14px; max-height: 25dvh; overflow: auto; }
    p { font-size: 13px; line-height: 1.5; } h3, p { overflow-wrap: anywhere; }
    footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    .danger, .error { color: var(--danger); } button:disabled { opacity: .5; }
  `],
})
export class StashDeleteDialogComponent {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<StashDeleteRequest>();
  readonly closed = output<{ request: StashDeleteRequest; deleted: boolean }>();
  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);
  private readonly failureAttempt = signal(0);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');
  private readonly failure = viewChild<ElementRef<HTMLElement>>('failure');
  private focusedRequest: StashDeleteRequest | null = null;
  private focusedFailureAttempt = 0;
  readonly available = computed(() => {
    const target = this.request();
    const repository = this.git.repository();
    return repository?.id === target.repositoryId && repository.stashes.some(stash =>
      stash.reference === target.stash.reference && stash.oid === target.stash.oid);
  });

  constructor() {
    afterRenderEffect(() => {
      const request = this.request();
      const cancel = this.cancel()?.nativeElement;
      if (cancel && request !== this.focusedRequest) {
        this.focusedRequest = request;
        cancel.focus();
      }
      const failure = this.failure()?.nativeElement;
      const attempt = this.failureAttempt();
      if (failure && attempt !== this.focusedFailureAttempt) {
        failure.focus();
        this.focusedFailureAttempt = attempt;
      }
      if (this.deleting()) this.dialog()?.nativeElement.focus();
    });
  }

  async confirm(): Promise<void> {
    if (!this.available() || this.git.busy() || this.deleting()) return;
    const request = this.request();
    this.deleting.set(true);
    this.error.set(null);
    try {
      const deleted = await this.git.dropStash(request.stash.reference, request.stash.oid, request.repositoryId);
      if (this.request() !== request) return;
      if (deleted) this.closed.emit({ request, deleted: true });
      else this.showFailure(this.git.error() ?? 'Deletion did not complete. Check Recovery History before retrying.');
    } catch {
      if (this.request() === request) this.showFailure('Deletion could not be confirmed. Check Recovery History before retrying.');
    } finally {
      if (this.request() === request) this.deleting.set(false);
    }
  }

  private showFailure(message: string): void {
    this.error.set(message);
    this.failureAttempt.update(attempt => attempt + 1);
  }

  close(deleted: boolean): void {
    if (!this.deleting()) this.closed.emit({ request: this.request(), deleted });
  }

  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(false); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.dialog()?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (!controls.length) { event.preventDefault(); this.dialog()?.nativeElement.focus(); }
    else if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  }
}
