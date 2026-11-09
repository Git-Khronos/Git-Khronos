import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { DiscardRecovery } from '@git-khronos/contracts';
import { displayRecoveryPath, savedDiscardLabel } from './discard-recovery-display';

@Component({
  selector: 'gc-saved-discard-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="saved-discard-list">
      @for (recovery of recoveries(); track recovery.id) {
        <div class="saved-discard-item">
          <div class="saved-discard-heading">
            <strong>{{ savedDiscardLabel(recovery.id) }} — {{ recovery.stateBlocked ? 'State needs review' : recovery.restored ? 'Recovered' : 'Captured' }}</strong>
            <div class="capture-actions"><button type="button" [disabled]="recovery.stateBlocked" (click)="requested.emit({ recovery, remove: false })">{{ recovery.restored ? 'Discard again…' : 'Recover…' }}</button><button type="button" (click)="requested.emit({ recovery, remove: true })">Remove capture…</button></div>
          </div>
          <div class="saved-discard-details">
            @if (recovery.stateWarning) { <p role="alert">{{ recovery.stateWarning }}</p> }
            @if (recovery.paths.length) { <ul aria-label="Files in this capture">@for (path of recovery.paths; track $index) { <li><code>{{ displayRecoveryPath(path) }}</code></li> }</ul> }
            @if (recovery.pathsTruncated) { <p>Additional files are not shown. Recovery applies the entire capture.</p> }
            @if (recovery.pathsError) { <p role="alert">File list unavailable: {{ recovery.pathsError }} Recovery may affect files not shown here.</p> }
            @if (!recovery.contentSha256) { <p role="alert">Changes to this capture after review cannot be detected. Inspect the saved patch before continuing.</p> }
          </div>
        </div>
      } @empty { <p>No saved discarded changes in this worktree.</p> }
    </div>
  `,
  styles: `
    :host { display: contents; }
    .saved-discard-list { max-height: 260px; overflow: auto; margin-top: 12px; }
    .saved-discard-item { display: grid; gap: 8px; padding: 10px 0; border-top: 1px solid var(--graph-menu-border); font-size: 12px; }
    .saved-discard-heading { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: 8px; }
    .saved-discard-heading strong { min-width: 0; overflow-wrap: anywhere; }
    .saved-discard-details { min-width: 0; overflow-wrap: anywhere; }
    .saved-discard-details ul { margin: 0; padding-left: 18px; }
    .capture-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button { min-height: 28px; padding: 6px; border: 1px solid var(--graph-menu-border); border-radius: 3px; background: var(--graph-menu-surface); color: var(--text); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    p { margin: 0; color: #a09fb1; font-size: 12px; line-height: 1.5; }
  `,
})
export class SavedDiscardListComponent {
  readonly recoveries = input.required<DiscardRecovery[]>();
  readonly requested = output<{ recovery: DiscardRecovery; remove: boolean }>();
  protected readonly savedDiscardLabel = savedDiscardLabel;
  protected readonly displayRecoveryPath = displayRecoveryPath;
}
