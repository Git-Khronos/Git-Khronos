import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injector, input, output, signal, viewChild } from '@angular/core';
import type { MergeRebasePlan } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';

export interface MergeRebaseDialogState {
  repositoryId: string;
  plan: MergeRebasePlan;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-merge-rebase-dialog',
  imports: [GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close()">
      <section #dialog role="dialog" aria-modal="true" aria-labelledby="merge-rebase-title"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <h2 id="merge-rebase-title">Rebase preserving merges</h2>
        <p><strong>{{ state().plan.request.source }}</strong> onto <strong>{{ state().plan.request.target }}</strong>.
          Source <code>{{ state().plan.request.sourceOid }}</code>;
          destination <code>{{ state().plan.request.targetOid }}</code>;
          original common base <code>{{ state().plan.request.base }}</code>.</p>
        <p>Git will recreate the branching structure with no-rebase-cousins. Side histories not descended
          from the common base retain their original branch points. Other branches, tags and remote-tracking
          references are not moved. The original source tip is saved for recovery.</p>
        <p>Merge IDs, parents and signatures may change. Previous manual merge resolutions are not
          automatically preserved: resolve conflicts again, then Continue, Skip or Abort. Final contents
          can differ from the original tree. Hooks and configured signing remain enabled.</p>
        <p>This separate workflow preserves Git's generated merge instructions. It does not offer row
          reordering, Reword, Edit, guided splitting or autosquash. Coordinate before rewriting shared
          history; recorded remote reachability uses local tracking refs only, not a network check.</p>
        <ol aria-label="Reviewed merge-preserving topology">
          @for (commit of state().plan.commits; track commit.oid) {
            <li><strong>{{ commit.subject }}</strong><code>{{ commit.oid }}</code>
              <span>{{ commit.parents.length === 2 ? 'Recreated merge' : 'Ordinary commit' }} ·
                {{ state().plan.remoteReachableOids.includes(commit.oid) ? 'Recorded remote-reachable' : 'Publication unknown' }}</span>
              <span>Original parents:</span>@for (parent of commit.parents; track parent) { <code>{{ parent }}</code> }
            </li>
          }
        </ol>
        @if (git.error()) { <p role="alert" tabindex="-1">{{ git.error() }}</p>
          <p>If Git is now paused, close this review and use the operation controls rather than restarting replay.</p> }
        <gc-git-help topic="merge-rebase" label="Learn about preserving merge topology…" />
        <footer><button data-merge-rebase-cancel type="button" [disabled]="git.busy()" (click)="close()">Cancel</button>
          <button type="button" [disabled]="git.busy() || failed() || state().repositoryId !== git.activeRepositoryId()" (click)="start()">Start merge-preserving rebase</button></footer>
      </section>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: var(--overlay-backdrop); }
    section { box-sizing: border-box; width: min(700px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; } p, li, button { font-size: 13px; line-height: 1.5; }
    p, code { overflow-wrap: anywhere; } ol { padding-left: 20px; } li { margin: 12px 0; }
    li code, li span { display: block; } footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class MergeRebaseDialogComponent {
  readonly git = inject(GitKhronosService);
  readonly state = input.required<MergeRebaseDialogState>();
  readonly closed = output<void>();
  protected readonly failed = signal(false);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-merge-rebase-cancel]')?.focus());
  }

  protected close(): void {
    if (this.git.busy()) return;
    const state = this.state();
    this.closed.emit();
    setTimeout(() => {
      if (state.repositoryId !== this.git.activeRepositoryId()) return;
      if (state.returnFocus?.isConnected && state.returnFocus.getClientRects().length) state.returnFocus.focus();
      else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus();
    });
  }

  protected async start(): Promise<void> {
    if (this.failed() || this.git.busy()) return;
    const state = this.state();
    const success = await this.git.executeMergeRebase(state.repositoryId, state.plan.request);
    if (success) this.close();
    else {
      this.failed.set(true);
      afterNextRender(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus(), { injector: this.injector });
    }
  }

  private readonly injector = inject(Injector);

  protected handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault(); event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
