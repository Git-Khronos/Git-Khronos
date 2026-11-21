import { ChangeDetectionStrategy, Component, DestroyRef, Directive, effect, inject, input, signal } from '@angular/core';
import { ipc, type RepositoryStatus, type WorkingTreeChangeSummary, type WorkingTreeSummaries } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

type SummaryState = { phase: 'loading' | 'unavailable' | 'preview' } | { phase: 'ready'; value: WorkingTreeChangeSummary };
const EMPTY: SummaryState = { phase: 'ready', value: { additions: 0, deletions: 0, uncountedFiles: 0, partial: false } };

interface Request {
  repositoryId: string;
  repositoryPath: string;
  checkoutScope: string;
  status: RepositoryStatus;
  contentRevision: number;
}

@Component({
  selector: 'gc-working-tree-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let current = state();
    @if (current.phase === 'ready') {
      <span class="summary" [attr.aria-label]="label(current.value)" [title]="description()">
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
  readonly state = input.required<SummaryState>();
  readonly section = input.required<'staged' | 'unstaged'>();

  description(): string {
    const basis = this.section() === 'staged'
      ? 'Staged line changes relative to the last commit, or an empty tree before the first commit.'
      : 'Unstaged line changes relative to the index, including untracked text files.';
    return `${basis} Binary or uncounted files are excluded from line totals.`;
  }

  label(value: WorkingTreeChangeSummary): string {
    return `${value.additions} additions and ${value.deletions} deletions in ${this.section()} files`
      + (value.uncountedFiles ? `; ${value.uncountedFiles} binary or uncounted files excluded` : '')
      + (value.partial ? '; partial totals' : '');
  }
}

@Directive({
  selector: '[gcWorkingTreeSummaries]',
  exportAs: 'gcWorkingTreeSummaries',
})
export class WorkingTreeSummariesDirective {
  readonly repositoryId = input.required<string>();
  readonly repositoryPath = input.required<string>();
  readonly status = input.required<RepositoryStatus>();
  readonly visible = input(true);
  readonly staged = signal<SummaryState>(EMPTY);
  readonly unstaged = signal<SummaryState>(EMPTY);
  private readonly git = inject(GitKhronosService);
  private desired: Request | null = null;
  private reading = false;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.desired = null; });
    effect(() => {
      const request = {
        repositoryId: this.repositoryId(), repositoryPath: this.repositoryPath(),
        checkoutScope: this.git.activeRepositoryReadScope(),
        status: this.status(), contentRevision: this.git.workingTreeContentRevision(),
      };
      const busy = this.git.busy();
      const preview = this.git.browserPreview();
      const visible = this.visible();
      const { status } = request;
      const hasUnstaged = !!(status.unstaged || status.untracked);
      const hasStaged = !!status.staged;
      const pending: SummaryState = { phase: preview ? 'preview' : 'loading' };
      this.desired = null;
      this.staged.set(hasStaged ? pending : EMPTY);
      this.unstaged.set(hasUnstaged ? pending : EMPTY);
      if (visible && !busy && !preview && (hasStaged || hasUnstaged)) {
        this.desired = request;
        this.pump();
      }
    });
  }

  private current(request: Request): boolean {
    const repository = this.git.repository();
    return !this.destroyed && this.desired === request && !this.git.busy() && this.visible()
      && this.git.activeRepositoryReadScope() === request.checkoutScope
      && repository?.id === request.repositoryId && repository.path === request.repositoryPath
      && repository.status === request.status && this.status() === request.status
      && this.git.workingTreeContentRevision() === request.contentRevision;
  }

  private apply(request: Request, result?: WorkingTreeSummaries): void {
    if (!this.current(request)) return;
    const project = (hasChanges: boolean, summary: WorkingTreeChangeSummary | null | undefined): SummaryState =>
      !hasChanges ? EMPTY : summary ? { phase: 'ready', value: summary } : { phase: 'unavailable' };
    this.staged.set(project(!!request.status.staged, result?.staged));
    this.unstaged.set(project(!!(request.status.unstaged || request.status.untracked), result?.unstaged));
  }

  private pump(): void {
    const request = this.desired;
    if (!request || this.reading || this.destroyed) return;
    this.reading = true;
    ipc.working_tree_change_summary({ repoId: request.repositoryId }).then(
      result => this.apply(request, result),
      () => this.apply(request),
    ).finally(() => {
      this.reading = false;
      // One in-flight request covers both recaps; rapid updates coalesce to
      // the newest snapshot rather than stacking extra native reads.
      if (this.desired !== request) this.pump();
    });
  }
}
