import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, effect, inject, Injector, input, output, signal, untracked, viewChild } from '@angular/core';
import { ipc } from '@git-khronos/contracts';
import type { WorktreeRegistration, WorktreeRegistrationPruneResult, WorktreeRegistrationReview } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';
import { SubmoduleStateReviewComponent } from './submodule-state-review.component';
import { isTabKey } from './tab-key';

export interface SubmoduleReviewTarget {
  path: string;
  action: 'initialize' | 'update';
}

export interface WorktreeRegistrationRequest {
  repositoryId: string;
  scope: string;
  returnFocus: HTMLElement | null;
  submodules?: boolean;
  submoduleTarget?: SubmoduleReviewTarget;
}

@Component({
  selector: 'gk-worktree-registration-dialog',
  imports: [GitHelpComponent, SubmoduleStateReviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request()?.submodules) {
      <gk-submodule-state-review [request]="request()" (closed)="closed.emit()" />
    } @else if (request(); as target) {
      <div class="backdrop" (click)="close()">
        <section #dialog role="dialog" aria-modal="true" aria-labelledby="worktree-registration-title"
          (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
          <h2 id="worktree-registration-title">Review worktree registrations</h2>
          <p>Inspection uses Git worktree list and prune --dry-run --expire=now; reviewing changes nothing.
            Expiring now can show candidates not yet eligible under Git’s normal age-based pruning.
            A missing, unlocked registration can be removed individually after its HEAD and metadata are preserved.</p>
          @if (!ownsRequest(target)) {
            <p role="alert" tabindex="-1">The active repository changed. Close this review and inspect the intended repository.</p>
          }
          @if (ownsRequest(target) && error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
          @if (ownsRequest(target) ? pruned() : null; as done) {
            <div role="status" tabindex="-1" data-prune-result>
              <p>Registration removed. No branch, file or other registration was changed.</p>
              @for (reference of done.recoveryReferences; track reference) { <p>Protected commit: <code>{{ reference }}</code></p> }
              @empty { <p>Unborn HEAD: no commit needed protection.</p> }
              <p>Administrative index and reflog copy: <code>{{ done.metadataBackup }}</code></p>
            </div>
          }
          @if (loading()) { <p role="status">Inspecting registrations…</p> }
          @if (ownsRequest(target) ? review() : null; as result) {
            <div role="status" tabindex="-1" data-registration-result>
              <p>{{ result.registrations.length }} registrations reported. These are sequential observations, not a deletion lease.</p>
            </div>
            <ul aria-label="Worktree registrations">
              @for (entry of result.registrations; track entry.path; let first = $first) {
                <li><code>{{ entry.path }}</code>
                  <span>{{ entry.bare ? 'Bare repository' : entry.branch || 'Detached HEAD' }}</span>
                  @if (entry.oid) { <code>{{ entry.oid }}</code> }
                  @if (entry.locked) {
                    <strong>Locked — protected from pruning</strong>
                    @if (entry.lockReason) { <p>{{ entry.lockReason }}</p> }
                  } @else if (entry.prunable) {
                    <strong>Git reports this registration as prunable</strong>
                    @if (entry.pruneReason) { <p>{{ entry.pruneReason }}</p> }
                    @if (!first && !entry.bare && entry.oid) {
                      @if (confirming() === entry) {
                        <div class="confirm" role="group" aria-label="Confirm registration removal" data-prune-confirm>
                          <p>Only this registration is removed with git worktree remove, without force. Before that:</p>
                          <ul class="effects">
                            <li>HEAD {{ entry.oid }} is kept by a recovery reference{{ entry.branch ? '; branch ' + entry.branch + ' is not deleted' : '' }}.</li>
                            <li>Its index, reflog and per-worktree files are copied inside the Git directory.</li>
                            <li>Git rechecks every registration; if anything changed, nothing is removed.</li>
                          </ul>
                          <p>Uncommitted work in a disconnected directory is not recovered. Reconnect storage first if it still exists.</p>
                          <button type="button" data-prune-execute [disabled]="unavailable()" (click)="prune(entry)">Remove registration</button>
                          <button type="button" data-prune-cancel [disabled]="pending()" (click)="cancelPrune(entry)">Cancel</button>
                        </div>
                      } @else {
                        <button type="button" [attr.data-prune-open]="entry.path" [disabled]="unavailable()"
                          (click)="confirm(entry)">Remove with recovery…</button>
                      }
                    }
                  } @else { <span>Not reported as prunable</span> }
                </li>
              }
            </ul>
            <h3>Git’s dry-run report</h3>
            @if (result.pruneReport) { <pre aria-label="Git worktree prune dry-run report">{{ result.pruneReport }}</pre> }
            @else { <p>No removals were reported by this dry-run. This does not prove every registration link is healthy.</p> }
            <p>If a directory was moved, repair its registration instead. If storage is disconnected,
              reconnect it or lock the registration. Pruning can lose administrative index/reflog metadata;
              do not use it to clean dirty or recoverable work. Locked and main registrations are never removed here.</p>
          }
          <gk-git-help topic="worktree" label="Learn about worktree registration and pruning…" />
          <footer><button type="button" [disabled]="unavailable()" (click)="reload()">Reload review</button>
            <button data-registration-close type="button" [disabled]="loading() || pending() || git.busy()" (click)="close()">Close</button></footer>
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
    .confirm { margin-top: 8px; padding: 10px; border: 1px solid var(--inspector-divider); border-radius: 5px; }
    .confirm button { margin: 4px 8px 0 0; } .effects { list-style: disc; padding-left: 18px; } .effects li { padding: 2px 0; border: 0; display: list-item; }
    li > button { margin-top: 6px; }
  `],
})
export class WorktreeRegistrationDialogComponent {
  readonly git = inject(GitKhronosService);
  private readonly injector = inject(Injector);
  readonly request = input<WorktreeRegistrationRequest | null>(null);
  readonly closed = output<void>();
  readonly review = signal<WorktreeRegistrationReview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly confirming = signal<WorktreeRegistration | null>(null);
  readonly pending = signal(false);
  readonly pruned = signal<WorktreeRegistrationPruneResult | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    effect(() => {
      if (this.request() && !this.request()?.submodules) untracked(() => { void this.reload(); });
    });
  }

  unavailable(): boolean {
    return this.loading() || this.pending() || this.git.busy() || !this.ownsRequest(this.request());
  }

  ownsRequest(target: WorktreeRegistrationRequest | null): boolean {
    return !!target && this.request() === target && target.scope === this.git.activeRepositoryReadScope();
  }

  async reload(): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable()) return;
    this.loading.set(true);
    this.review.set(null);
    this.confirming.set(null);
    this.error.set('');
    try {
      const review = await this.git.reviewWorktreeRegistrations(target.repositoryId);
      if (this.ownsRequest(target)) {
        this.error.set(this.git.error() ?? '');
        this.review.set(review);
      }
    } finally {
      this.loading.set(false);
    }
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(
      this.error() || !this.ownsRequest(target) ? '[role=alert]' : '[data-registration-result]')?.focus());
  }

  confirm(entry: WorktreeRegistration): void {
    const target = this.request();
    if (!this.ownsRequest(target) || this.unavailable() || !this.review()?.registrations.includes(entry)) return;
    const opener = document.activeElement;
    this.pruned.set(null);
    this.error.set('');
    this.confirming.set(entry);
    afterNextRender(() => {
      if (this.ownsRequest(target) && this.confirming() === entry &&
        (document.activeElement === document.body || document.activeElement === opener)) {
        this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-prune-cancel]')?.focus({ preventScroll: true });
      }
    }, { injector: this.injector });
  }

  cancelPrune(entry: WorktreeRegistration): void {
    const target = this.request();
    if (!this.ownsRequest(target) || this.confirming() !== entry || this.pending()) return;
    const origin = document.activeElement;
    this.confirming.set(null);
    afterNextRender(() => {
      if (this.ownsRequest(target) && !this.confirming() &&
        (document.activeElement === document.body || document.activeElement === origin)) {
        [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('[data-prune-open]') ?? [])]
          .find(button => button.dataset['pruneOpen'] === entry.path)?.focus({ preventScroll: true });
      }
    }, { injector: this.injector });
  }

  async prune(entry: WorktreeRegistration): Promise<void> {
    const target = this.request();
    if (!target || !entry.oid || this.unavailable() || this.confirming() !== entry
      || !this.review()?.registrations.includes(entry) || !this.git.requireRecoveryRepository(target.repositoryId)) return;
    const expectedOid = entry.oid;
    this.pending.set(true);
    this.error.set('');
    let result: WorktreeRegistrationPruneResult | null = null;
    try {
      const outcome = await this.git.run('Removing reviewed worktree registration…', async () => {
        result = await ipc.prune_worktree_registration({ repoId: target.repositoryId,
          request: { path: entry.path, expectedOid, expectedBranch: entry.branch } });
      }, target.repositoryId);
      if (!this.ownsRequest(target)) return;
      if (outcome !== 'success' || !result) {
        this.confirming.set(null);
        this.error.set(`${this.git.error() ?? 'The registration was not removed.'} Reload the review before retrying.`);
        setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus());
        return;
      }
      this.git.activity.set('Worktree registration removed; HEAD and metadata preserved');
      await this.git.refreshRepositoryInBackground(target.repositoryId);
    } finally {
      this.pending.set(false);
    }
    if (!this.ownsRequest(target)) return;
    await this.reload();
    if (!this.ownsRequest(target)) return;
    this.pruned.set(result);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-prune-result]')?.focus());
  }

  close(): void {
    if (this.loading() || this.pending() || this.git.busy()) return;
    this.closed.emit();
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (!isTabKey(event)) return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault(); event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
