import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { GitKhronosService } from './git-khronos.service';

export interface StashClearRequest {
  repositoryId: string;
  entries: { reference: string; oid: string; message: string }[];
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gk-stash-clear-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close(false)">
      <section #dialog role="alertdialog" aria-modal="true" aria-label="Clear all stashes" tabindex="-1" [attr.aria-busy]="clearing()" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <h2>Clear all stashes?</h2>
        <p>Remove {{ request().entries.length }} reviewed entries from the stash list. Before clearing, each complete stash object—including staged, unstaged and untracked changes—is saved in Recovery History.</p>
        <ul>@for (entry of request().entries; track entry.oid) { <li class="entry">{{ entry.reference }} — {{ entry.message }}</li> }</ul>
        <p>Recovery captures remain available until you remove them from Recovery History.</p>
        @if (!available()) { <p role="status">The repository or stash list changed. Cancel and review it again.</p> }
        @if (error()) { <p role="alert" class="error">{{ error() }}</p> }
        <footer><button #cancel type="button" [disabled]="clearing()" (click)="close(false)">Cancel</button><button class="danger" type="button" [disabled]="!available() || git.busy() || clearing()" (click)="confirm()">{{ clearing() ? 'Preserving and clearing…' : 'Clear All Stashes' }}</button></footer>
      </section>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: #080811b8; }
    section { box-sizing: border-box; width: min(560px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; } p, li { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; } ul { max-height: 24dvh; overflow: auto; padding-left: 22px; }
    footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; } button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); } .danger, .error { color: var(--danger); } button:disabled { opacity: .5; }
  `],
})
export class StashClearDialogComponent {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<StashClearRequest>();
  readonly closed = output<{ request: StashClearRequest; cleared: boolean }>();
  readonly clearing = signal(false);
  readonly error = signal<string | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');
  private focusedRequest: StashClearRequest | null = null;
  readonly available = computed(() => {
    const target = this.request();
    const entries = this.git.repository()?.stashes;
    return this.git.repository()?.id === target.repositoryId && entries?.length === target.entries.length
      && entries.every((entry, index) => entry.oid === target.entries[index]?.oid);
  });

  constructor() {
    afterRenderEffect(() => {
      const cancel = this.cancel()?.nativeElement;
      if (cancel && this.focusedRequest !== this.request()) { this.focusedRequest = this.request(); cancel.focus(); }
      if (this.clearing()) this.dialog()?.nativeElement.focus();
    });
  }

  async confirm(): Promise<void> {
    if (!this.available() || this.git.busy() || this.clearing()) return;
    const request = this.request();
    this.clearing.set(true); this.error.set(null);
    try {
      const cleared = await this.git.clearStashes(request.entries.map(entry => entry.oid), request.repositoryId);
      if (this.request() !== request) return;
      if (cleared) this.closed.emit({ request, cleared: true });
      else this.error.set(this.git.error() ?? 'Clear did not complete. Check Recovery History before retrying.');
    } catch { if (this.request() === request) this.error.set('Clear could not be confirmed. Check Recovery History before retrying.'); }
    finally { if (this.request() === request) this.clearing.set(false); }
  }

  close(cleared: boolean): void { if (!this.clearing()) this.closed.emit({ request: this.request(), cleared }); }
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
