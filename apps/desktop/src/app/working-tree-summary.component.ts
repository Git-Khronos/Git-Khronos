import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { ipc, type RepositoryStatus, type WorkingTreeChangeSummary } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

type SummaryState = { phase: 'loading' | 'unavailable' | 'preview' } | { phase: 'ready'; value: WorkingTreeChangeSummary };
interface Request { repositoryId: string; repositoryPath: string; status: RepositoryStatus }

@Component({
  selector: 'gc-working-tree-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let current = state();
    @if (current.phase === 'ready') {
      <span class="summary" [attr.aria-label]="label(current.value)" title="Unstaged line changes relative to the index, including untracked text files. Binary or uncounted files are excluded from line totals.">
        <span>+{{ current.value.additions }}</span><i>−{{ current.value.deletions }}</i>
        @if (current.value.uncountedFiles) { <em>{{ current.value.uncountedFiles }} other</em> }
        @if (current.value.partial) { <em>(partial)</em> }
      </span>
    } @else if (current.phase === 'loading') {
      <span class="pending" role="status">Counting lines…</span>
    } @else if (current.phase === 'unavailable') {
      <span class="pending" title="Refresh the repository to retry.">Line counts unavailable</span>
    } @else {
      <span class="pending" title="Line totals are calculated by Git in the desktop app.">+— −—</span>
    }
  `,
  styles: [`
    :host { display: inline-flex; flex: 0 0 auto; align-items: center; text-transform: none; }
    .summary { display: inline-flex; align-items: center; gap: 5px; font: 12px "SFMono-Regular", Consolas, monospace; font-variant-numeric: tabular-nums; }
    .summary span { color: #62d7a6; }
    .summary i { color: #ef849b; font-style: normal; }
    .summary em, .pending { color: var(--text-muted); font-size: 11px; font-style: normal; font-weight: 400; }
  `],
})
export class WorkingTreeSummaryComponent {
  readonly repositoryId = input.required<string>();
  readonly repositoryPath = input.required<string>();
  readonly status = input.required<RepositoryStatus>();
  readonly state = signal<SummaryState>({ phase: 'loading' });
  private readonly git = inject(GitKhronosService);
  private desired: Request | null = null;
  private reading = false;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.desired = null; });
    effect(() => {
      const request = { repositoryId: this.repositoryId(), repositoryPath: this.repositoryPath(), status: this.status() };
      const busy = this.git.busy();
      const preview = this.git.browserPreview();
      this.desired = null;
      if (!request.status.unstaged && !request.status.untracked) {
        this.state.set({ phase: 'ready', value: { additions: 0, deletions: 0, uncountedFiles: 0, partial: false } });
      } else if (preview) this.state.set({ phase: 'preview' });
      else {
        this.state.set({ phase: 'loading' });
        if (!busy) { this.desired = request; this.pump(); }
      }
    });
  }

  label(value: WorkingTreeChangeSummary): string {
    return `${value.additions} additions and ${value.deletions} deletions in unstaged files`
      + (value.uncountedFiles ? `; ${value.uncountedFiles} binary or uncounted files excluded` : '')
      + (value.partial ? '; partial totals' : '');
  }

  private current(request: Request): boolean {
    const repository = this.git.repository();
    return !this.destroyed && this.desired === request && !this.git.busy()
      && repository?.id === request.repositoryId && repository.path === request.repositoryPath
      && repository.status === request.status && this.status() === request.status;
  }

  private pump(): void {
    const request = this.desired;
    if (!request || this.reading || this.destroyed) return;
    this.reading = true;
    ipc.working_tree_change_summary({ repoId: request.repositoryId }).then(value => {
      if (this.current(request)) this.state.set({ phase: 'ready', value });
    }, () => {
      if (this.current(request)) this.state.set({ phase: 'unavailable' });
    }).finally(() => {
      this.reading = false;
      // At most one read is in flight. Superseded status events coalesce to the
      // newest snapshot rather than starting a diff process for each event.
      if (this.desired !== request) this.pump();
    });
  }
}
