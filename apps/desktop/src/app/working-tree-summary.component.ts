import { ChangeDetectionStrategy, Component, DestroyRef, Directive, effect, inject, input, output, signal } from '@angular/core';
import { ipc, type RepositoryStatus, type WorkingTreeChangeSummary, type WorkingTreeSummaries } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

type RecapSection = 'staged' | 'unstaged';
type SummaryState = { phase: 'loading' | 'unavailable' | 'preview' }
  | { phase: 'ready' | 'refreshing'; value: WorkingTreeChangeSummary };
const EMPTY: SummaryState = { phase: 'ready', value: { additions: 0, deletions: 0, uncountedFiles: 0, partial: false } };

interface Request {
  repositoryId: string;
  repositoryPath: string;
  checkoutScope: string;
  status: RepositoryStatus;
  contentRevision: number;
  retainedOnRetry?: { section: RecapSection; value: WorkingTreeChangeSummary };
}

function sameSnapshot(first: Request, next: Request): boolean {
  return first.repositoryId === next.repositoryId && first.repositoryPath === next.repositoryPath
    && first.checkoutScope === next.checkoutScope && first.status === next.status;
}

@Component({
  selector: 'gc-working-tree-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let current = state();
    @if (current.phase === 'ready' || current.phase === 'refreshing') {
      @let refreshing = current.phase === 'refreshing';
      <span class="summary" role="img" [attr.aria-label]="label(current.value, refreshing)" [title]="description(refreshing)">
        <span>+{{ current.value.additions }}</span><i>−{{ current.value.deletions }}</i>
        @if (current.value.uncountedFiles) { <em>{{ current.value.uncountedFiles }} other</em> }
        @if (current.value.partial) { <em>(partial)</em> }
        @if (refreshing) { <em aria-hidden="true">…</em> }
      </span>
    } @else if (current.phase === 'loading') {
      <span class="pending" role="status">Counting lines…</span>
    } @else if (current.phase === 'unavailable') {
      <span class="pending">Line counts unavailable</span>
      <button class="retry" type="button" [attr.aria-label]="'Retry ' + section() + ' line counts'"
        (click)="retryRequested.emit(current)">Retry</button>
    } @else {
      <span class="pending" title="Line totals are calculated by Git in the desktop app.">+— −—</span>
    }
  `,
  styles: [`
    :host { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 4px; text-transform: none; }
    .summary { display: inline-flex; align-items: center; gap: 5px; font: 12px "SFMono-Regular", Consolas, monospace; font-variant-numeric: tabular-nums; }
    .summary span { color: #62d7a6; }
    .summary i { color: #ef849b; font-style: normal; }
    .summary em, .pending { color: var(--text-muted); font-size: 11px; font-style: normal; font-weight: 400; }
    .retry { min-block-size: 24px; padding-inline: 4px; border: 0; background: transparent;
      color: var(--accent); font: inherit; font-size: 11px; text-decoration: underline; }
    .retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  `],
})
export class WorkingTreeSummaryComponent {
  readonly state = input.required<SummaryState>();
  readonly section = input.required<RecapSection>();
  readonly retryRequested = output<SummaryState>();

  description(refreshing: boolean): string {
    const basis = this.section() === 'staged'
      ? 'Staged line changes relative to the last commit, or an empty tree before the first commit.'
      : 'Unstaged line changes relative to the index, including untracked text files.';
    return `${basis} Binary or uncounted files are excluded from line totals.`
      + (refreshing ? ' Updating; showing the last measured totals.' : '');
  }

  label(value: WorkingTreeChangeSummary, refreshing: boolean): string {
    const additions = `${value.additions} ${value.additions === 1 ? 'addition' : 'additions'}`;
    const deletions = `${value.deletions} ${value.deletions === 1 ? 'deletion' : 'deletions'}`;
    return `${additions} and ${deletions} in ${this.section()} files`
      + (value.uncountedFiles ? `; ${value.uncountedFiles} binary or uncounted ${value.uncountedFiles === 1 ? 'file' : 'files'} excluded` : '')
      + (value.partial ? '; partial totals' : '')
      + (refreshing ? '; updating' : '');
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
  private lastMeasurement: { request: Request; result: WorkingTreeSummaries } | null = null;
  private reading = false;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.desired = null;
      this.lastMeasurement = null;
    });
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
      const canRead = visible && !busy && !preview && (hasStaged || hasUnstaged);
      if (!canRead || (this.lastMeasurement && !sameSnapshot(this.lastMeasurement.request, request))) {
        this.lastMeasurement = null;
      }
      const pending: SummaryState = { phase: preview ? 'preview' : 'loading' };
      const previous = this.lastMeasurement?.result;
      const duringRead = (hasChanges: boolean, value?: WorkingTreeChangeSummary | null): SummaryState =>
        !hasChanges ? EMPTY : value ? { phase: 'refreshing', value } : pending;
      this.desired = null;
      this.staged.set(duringRead(hasStaged, previous?.staged));
      this.unstaged.set(duringRead(hasUnstaged, previous?.unstaged));
      if (canRead) {
        this.desired = request;
        this.pump();
      }
    });
  }

  retry(section: RecapSection, painted: SummaryState): boolean {
    const previous = this.desired;
    if (!previous || this.reading || !this.current(previous)
      || painted.phase !== 'unavailable' || this[section]() !== painted) return false;
    const other = section === 'staged' ? 'unstaged' : 'staged';
    const sibling = this[other]();
    this.desired = {
      ...previous,
      retainedOnRetry: sibling.phase === 'ready' ? { section: other, value: sibling.value } : undefined,
    };
    this[section].set({ phase: 'loading' });
    if (sibling.phase === 'unavailable') this[other].set({ phase: 'loading' });
    this.pump();
    return true;
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
    const retained = request.retainedOnRetry;
    if (retained && !result?.[retained.section]) {
      // An explicit retry belongs to this exact snapshot. An error at the
      // other read must not erase this already measured, unchanged side.
      result = { staged: result?.staged ?? null, unstaged: result?.unstaged ?? null,
        [retained.section]: retained.value };
    }
    this.lastMeasurement = result ? { request, result } : null;
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
