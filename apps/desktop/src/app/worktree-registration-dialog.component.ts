import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import type { WorktreeRegistrationReview } from '@git-chronos/contracts';
import { GitChronosService } from './git-chronos.service';
import { GitHelpComponent } from './git-help.component';

export interface WorktreeRegistrationRequest {
  repositoryId: string;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-worktree-registration-dialog',
  imports: [GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="close()">
        <section #dialog role="dialog" aria-modal="true" aria-labelledby="worktree-registration-title"
          (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
          <h2 id="worktree-registration-title">Review worktree registrations</h2>
          <p>Read-only inspection with Git worktree list and prune --dry-run --expire=now.
            No registration, working directory or branch is removed or repaired. Expiring now can show
            candidates not yet eligible under Git’s normal age-based pruning.</p>
          @if (target.repositoryId !== git.activeRepositoryId()) {
            <p role="alert" tabindex="-1">The active repository changed. Close this review and inspect the intended repository.</p>
          }
          @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
          @if (loading()) { <p role="status">Inspecting registrations…</p> }
          @if (review(); as result) {
            <div role="status" tabindex="-1" data-registration-result>
              <p>{{ result.registrations.length }} registrations reported. These are sequential observations, not a deletion lease.</p>
            </div>
            <ul aria-label="Worktree registrations">
              @for (entry of result.registrations; track entry.path) {
                <li><code>{{ entry.path }}</code>
                  <span>{{ entry.bare ? 'Bare repository' : entry.branch || 'Detached HEAD' }}</span>
                  @if (entry.oid) { <code>{{ entry.oid }}</code> }
                  @if (entry.locked) {
                    <strong>Locked — protected from pruning</strong>
                    @if (entry.lockReason) { <p>{{ entry.lockReason }}</p> }
                  } @else if (entry.prunable) {
                    <strong>Git reports this registration as prunable</strong>
                    @if (entry.pruneReason) { <p>{{ entry.pruneReason }}</p> }
                  } @else { <span>Not reported as prunable</span> }
                </li>
              }
            </ul>
            <h3>Git’s dry-run report</h3>
            @if (result.pruneReport) { <pre aria-label="Git worktree prune dry-run report">{{ result.pruneReport }}</pre> }
            @else { <p>No removals were reported by this dry-run. This does not prove every registration link is healthy.</p> }
            <p>If a directory was moved, repair its registration instead. If storage is disconnected,
              reconnect it or lock the registration. Pruning can lose administrative index/reflog metadata;
              do not use it to clean dirty or recoverable work. Safe removal is not available in this review.</p>
          }
          <gc-git-help topic="worktree" label="Learn about worktree registration and pruning…" />
          <footer><button type="button" [disabled]="unavailable()" (click)="reload()">Reload review</button>
            <button data-registration-close type="button" [disabled]="loading() || git.busy()" (click)="close()">Close</button></footer>
        </section>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: var(--overlay-backdrop); }
    section { box-sizing: border-box; width: min(620px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; } h3 { font-size: 14px; }
    p, li, button { font-size: 13px; line-height: 1.5; }
    ul { list-style: none; padding: 0; } li { padding: 10px 0; border-bottom: 1px solid var(--inspector-divider); }
    li span, li code, li strong { display: block; } code, p { overflow-wrap: anywhere; }
    pre { padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: var(--inspector-row); }
    footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class WorktreeRegistrationDialogComponent {
  readonly git = inject(GitChronosService);
  readonly request = input<WorktreeRegistrationRequest | null>(null);
  readonly closed = output<void>();
  readonly review = signal<WorktreeRegistrationReview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    effect(() => {
      if (this.request()) untracked(() => { void this.reload(); });
    });
  }

  unavailable(): boolean {
    return this.loading() || this.git.busy() || this.request()?.repositoryId !== this.git.activeRepositoryId();
  }

  async reload(): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable()) return;
    this.loading.set(true);
    this.review.set(null);
    this.error.set('');
    try {
      const review = await this.git.reviewWorktreeRegistrations(target.repositoryId);
      if (this.request() === target) {
        this.error.set(this.git.error() ?? '');
        if (target.repositoryId === this.git.activeRepositoryId()) this.review.set(review);
      }
    } finally {
      this.loading.set(false);
    }
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(
      this.error() || target.repositoryId !== this.git.activeRepositoryId() ? '[role=alert]' : '[data-registration-result]')?.focus());
  }

  close(): void {
    if (this.loading() || this.git.busy()) return;
    const opener = this.request()?.returnFocus;
    this.closed.emit();
    setTimeout(() => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus();
    });
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault(); event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
