import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { ipc, type AppError, type BranchComparison, type MergePreview } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { IconComponent } from './icon.component';

export type IntegrationStrategy = 'ff-only' | 'merge' | 'squash' | 'rebase';

export interface IntegrateBranchDialogRequest {
  repositoryId: string;
  repositoryPath: string;
  /** Branch that receives the changes. */
  target: string;
  /** Branch whose changes are brought in; chosen in the dialog when absent. */
  source?: string;
  returnFocus: HTMLElement | null;
}

export interface IntegrationChoice {
  target: string;
  source: string;
  strategy: IntegrationStrategy | 'interactive';
  comparedTips?: Pick<BranchComparison, 'sourceOid' | 'targetOid'>;
}

type Relationship = 'up-to-date' | 'behind' | 'diverged' | 'unknown';

interface StrategyOption {
  strategy: IntegrationStrategy;
  title: string;
  detail: string;
  unavailable: string | null;
}

@Component({
  selector: 'gc-integrate-branch-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="backdrop" (click)="close()">
      <section #dialog role="dialog" aria-modal="true" aria-labelledby="integrate-title" aria-describedby="integrate-summary"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <header>
          <span class="eyebrow">Merge, rebase or fast-forward</span>
          <h2 id="integrate-title">Bring changes into {{ target() }}</h2>
        </header>
        <div class="pair">
          <label for="integrate-source">Bring changes from</label>
          <select id="integrate-source" (change)="chooseSource($any($event.target).value)">
            @if (!source()) { <option value="" selected>Choose a branch</option> }
            @for (branch of sourceChoices(); track branch) {
              <option [value]="branch" [selected]="branch === source()">{{ branch }}</option>
            }
          </select>
          <span class="arrow" aria-hidden="true">→</span>
          <strong class="target-name" title="Branch that changes">{{ target() }}</strong>
          <button type="button" class="swap" [disabled]="!source()" (click)="swap()"
            title="Bring {{ target() }} into {{ source() || 'the other branch' }} instead">
            <gc-icon name="refresh" [size]="12" />Swap direction
          </button>
        </div>

        <p id="integrate-summary" class="summary" [class.muted]="relationship() === 'unknown'" role="status">{{ summary() }}</p>

        @if (comparison(); as c) {
          @if (c.incomingCount) {
            <details class="commits" [open]="c.incomingCount <= 5">
              <summary>{{ c.incomingCount }} {{ c.incomingCount === 1 ? 'commit' : 'commits' }} coming from {{ c.source }}</summary>
              <ul aria-label="Commits coming in">
                @for (commit of c.incoming; track commit.oid) { <li><code>{{ commit.oid.slice(0, 7) }}</code> {{ commit.subject }} <small>{{ commit.author }}</small></li> }
                @if (c.incomingCount > c.incoming.length) { <li class="more">and {{ c.incomingCount - c.incoming.length }} more</li> }
              </ul>
            </details>
          }
          @if (c.outgoingCount && c.incomingCount) {
            <details class="commits">
              <summary>{{ c.outgoingCount }} {{ c.outgoingCount === 1 ? 'commit' : 'commits' }} only on {{ c.target }}</summary>
              <ul aria-label="Commits only on the receiving branch">
                @for (commit of c.outgoing; track commit.oid) { <li><code>{{ commit.oid.slice(0, 7) }}</code> {{ commit.subject }} <small>{{ commit.author }}</small></li> }
                @if (c.outgoingCount > c.outgoing.length) { <li class="more">and {{ c.outgoingCount - c.outgoing.length }} more</li> }
              </ul>
            </details>
          }
        }

        @if (relationship() !== 'up-to-date') {
          <fieldset [disabled]="!source() || loading()">
            <legend>How should {{ target() }} get these changes?</legend>
            @for (option of options(); track option.strategy) {
              <label class="option" [class.selected]="strategy() === option.strategy" [class.unavailable]="!!option.unavailable">
                <input type="radio" name="integration-strategy" [value]="option.strategy" [checked]="strategy() === option.strategy"
                  [disabled]="!!option.unavailable" (change)="strategy.set(option.strategy)" />
                <span>
                  <strong>{{ option.title }} @if (option.strategy === recommended()) { <em class="badge">Recommended</em> }</strong>
                  <small>{{ option.unavailable ?? option.detail }}</small>
                </span>
              </label>
            }
          </fieldset>
        }

        @if (comparisonError(); as message) { <p class="note warning">Could not compare the branches: {{ message }} You can still choose an option; Git checks again when it runs.</p> }
        @if (rebaseWarning(); as warning) { <p class="note warning" role="note"><gc-icon name="warning" [size]="13" />{{ warning }}</p> }
        @if (workingTreeNote(); as note) { <p class="note">{{ note }}</p> }
        @if (canCheckConflicts()) {
          <div class="conflicts">
            @if (conflictResult(); as result) {
              <p role="status" [class.warning]="!result.clean">
                @if (result.clean) { No conflicts expected for the committed changes. }
                @else { Conflicts expected in {{ result.conflictedPaths.length || 'some' }} {{ result.conflictedPaths.length === 1 ? 'file' : 'files' }}. You will resolve them before the result is saved. }
              </p>
              @if (result.conflictedPaths.length) {
                <ul aria-label="Files expected to conflict">@for (path of result.conflictedPaths; track path) { <li><code>{{ path }}</code></li> }</ul>
              }
            } @else if (conflictError(); as message) {
              <p class="note">Conflict check unavailable: {{ message }}</p>
            } @else {
              <button type="button" [disabled]="checkingConflicts() || git.busy()" (click)="checkConflicts()">{{ checkingConflicts() ? 'Checking…' : 'Check for conflicts' }}</button>
            }
          </div>
        }
        @if (recoveryNote(); as note) { <p class="note recovery">{{ note }}</p> }

        <footer>
          @if (relationship() === 'diverged' && strategy() === 'rebase') {
            <button type="button" class="link" (click)="choose('interactive')">Pick, reorder or squash commits first…</button>
          } @else { <span></span> }
          <div>
            <button type="button" data-integrate-cancel (click)="close()">{{ relationship() === 'up-to-date' ? 'Close' : 'Cancel' }}</button>
            @if (relationship() !== 'up-to-date') {
              <button type="button" class="primary" [disabled]="!canConfirm()" (click)="confirm()">{{ confirmLabel() }}</button>
            }
          </div>
        </footer>
      </section>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; background: #080811b8; display: grid; place-items: center; padding: 18px; }
    section { box-sizing: border-box; width: min(600px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px 22px; color: var(--text); background: var(--inspector-list); border: 1px solid var(--inspector-divider); border-radius: 8px; box-shadow: 0 20px 60px #0008; }
    header { margin-bottom: 14px; } .eyebrow { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
    h2 { font-size: 18px; margin: 4px 0 0; overflow-wrap: anywhere; }
    .pair { display: grid; grid-template-columns: 1fr auto auto; grid-template-areas: "label label label" "select arrow target" "swap swap swap"; align-items: center; gap: 6px 10px; }
    .pair label { grid-area: label; font-size: 12px; color: var(--muted); } .pair select { grid-area: select; min-width: 0; }
    .arrow { grid-area: arrow; color: var(--muted); } .target-name { grid-area: target; overflow-wrap: anywhere; }
    .swap { grid-area: swap; justify-self: start; display: inline-flex; gap: 6px; align-items: center; font-size: 12px; }
    .summary { margin: 14px 0 8px; font-size: 14px; line-height: 1.5; } .summary.muted { color: var(--muted); }
    .commits { margin: 6px 0; font-size: 13px; } .commits summary { cursor: pointer; color: var(--muted); }
    .commits ul { list-style: none; margin: 6px 0 0; padding: 0 0 0 4px; max-height: 160px; overflow: auto; }
    .commits li { padding: 3px 0; overflow-wrap: anywhere; } .commits small { color: var(--muted); margin-left: 6px; } .more { color: var(--muted); }
    fieldset { border: 0; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; } legend { font-size: 13px; font-weight: 600; margin-bottom: 6px; padding: 0; }
    .option { display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border: 1px solid var(--inspector-divider); border-radius: 6px; cursor: pointer; background: var(--inspector-row); }
    .option.selected { border-color: var(--accent); } .option.unavailable { opacity: .55; cursor: default; }
    .option input { margin-top: 3px; } .option span { display: grid; gap: 2px; } .option strong { font-size: 13px; } .option small { font-size: 12px; color: var(--muted); line-height: 1.4; }
    .badge { font-style: normal; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; margin-left: 6px; padding: 1px 6px; border-radius: 9px; color: var(--accent); border: 1px solid var(--accent); }
    .note { font-size: 12px; line-height: 1.5; color: var(--muted); margin: 10px 0 0; display: flex; gap: 6px; align-items: baseline; }
    .warning { color: var(--warning, #e8b04b); } .conflicts { margin-top: 10px; font-size: 13px; } .conflicts ul { max-height: 120px; overflow: auto; margin: 4px 0; }
    footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 18px; flex-wrap: wrap; } footer div { display: flex; gap: 8px; margin-left: auto; }
    button, select { color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); border-radius: 5px; padding: 6px 12px; font: inherit; font-size: 13px; }
    button { min-height: 30px; cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
    button.primary { background: var(--accent); color: var(--accent-contrast, #0b1a14); border-color: var(--accent); font-weight: 700; }
    button.link { background: none; border: 0; padding: 0; color: var(--accent); text-decoration: underline; }
    button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `],
})
export class IntegrateBranchDialogComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<IntegrateBranchDialogRequest>();
  readonly closed = output<void>();
  readonly chosen = output<IntegrationChoice>();
  readonly target = signal('');
  readonly source = signal('');
  readonly strategy = signal<IntegrationStrategy | null>(null);
  readonly comparison = signal<BranchComparison | null>(null);
  readonly comparisonError = signal('');
  readonly loading = signal(false);
  readonly conflictResult = signal<MergePreview | null>(null);
  readonly conflictError = signal('');
  readonly checkingConflicts = signal(false);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private destroyed = false;
  private comparisonToken = 0;

  private readonly localBranches = computed(() => {
    const repo = this.git.repository();
    if (!repo || repo.id !== this.request().repositoryId || repo.path !== this.request().repositoryPath) return [];
    return repo.branches.filter(branch => !branch.remote);
  });
  readonly sourceChoices = computed(() => this.localBranches().map(branch => branch.name).filter(name => name !== this.target()));
  private readonly tips = computed(() => {
    const tips = new Map(this.localBranches().map(branch => [branch.name, branch.oid]));
    return `${tips.get(this.target()) ?? ''}:${tips.get(this.source()) ?? ''}`;
  });
  readonly relationship = computed<Relationship>(() => {
    const comparison = this.comparison();
    if (!comparison) return 'unknown';
    if (!comparison.incomingCount) return 'up-to-date';
    return comparison.outgoingCount ? 'diverged' : 'behind';
  });
  readonly recommended = computed<IntegrationStrategy | null>(() => {
    const relationship = this.relationship();
    return relationship === 'behind' ? 'ff-only' : relationship === 'diverged' ? 'merge' : null;
  });
  readonly options = computed<StrategyOption[]>(() => {
    const target = this.target();
    const source = this.source() || 'the other branch';
    const relationship = this.relationship();
    const incoming = this.comparison()?.incomingCount ?? 0;
    const outgoing = this.comparison()?.outgoingCount ?? 0;
    const commits = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`;
    return [
      {
        strategy: 'ff-only',
        title: `Fast-forward ${target}`,
        detail: relationship === 'behind'
          ? `Move ${target} ahead to ${source}. No new commit is created and nothing is rewritten.`
          : `Move ${target} ahead to ${source}. Works only when ${target} has no commits of its own.`,
        unavailable: relationship === 'diverged' ? `Not possible: ${target} has ${commits(outgoing)} that ${source} does not have.` : null,
      },
      {
        strategy: 'merge',
        title: `Merge ${source} into ${target}`,
        detail: relationship === 'behind'
          ? `Git fast-forwards here because ${target} has no commits of its own.`
          : `Adds a merge commit that joins both histories. Existing commits stay unchanged.`,
        unavailable: null,
      },
      {
        strategy: 'rebase',
        title: `Rebase ${target} onto ${source}`,
        detail: relationship === 'diverged'
          ? `Replays the ${commits(outgoing)} only on ${target} on top of ${source} for a straight history. Those commits get new IDs.`
          : `Replays commits only on ${target} on top of ${source} for a straight history. Those commits get new IDs.`,
        unavailable: relationship === 'behind' ? `Not needed: ${target} has no commits of its own to replay.` : null,
      },
      {
        strategy: 'squash',
        title: `Squash ${source} into ${target}`,
        detail: `Stages ${incoming ? `the ${commits(incoming)}` : 'the changes'} as one set of changes for you to commit. ${source} itself is not marked as merged.`,
        unavailable: null,
      },
    ];
  });
  readonly summary = computed(() => {
    const comparison = this.comparison();
    const target = this.target();
    const source = this.source();
    if (!source) return `Choose the branch whose changes ${target} should get.`;
    if (this.loading() && !comparison) return `Comparing ${source} with ${target}…`;
    if (!comparison) return `${target} will get the changes from ${source}.`;
    const commits = (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`;
    if (!comparison.incomingCount) {
      return comparison.outgoingCount
        ? `${target} already has every commit from ${source}. Nothing to bring in. Use Swap direction to update ${source} instead.`
        : `${target} and ${source} point to the same commit. Nothing to do.`;
    }
    if (!comparison.mergeBase) return `${target} and ${source} share no history. Git refuses to combine unrelated histories by default.`;
    if (!comparison.outgoingCount) return `${target} is ${commits(comparison.incomingCount)} behind ${source} and has nothing of its own, so it can simply move forward.`;
    return `Both branches changed: ${source} has ${commits(comparison.incomingCount)} that ${target} lacks, and ${target} has ${commits(comparison.outgoingCount)} of its own.`;
  });
  readonly rebaseWarning = computed(() => {
    const published = this.comparison()?.outgoingPublished ?? 0;
    if (this.strategy() !== 'rebase' || !published) return null;
    return `${published} of the commits being replayed ${published === 1 ? 'is' : 'are'} already pushed. Rebasing changes ${published === 1 ? 'its ID' : 'their IDs'}, so you would need to force-push and collaborators would need to update. Merge avoids this.`;
  });
  readonly workingTreeNote = computed(() => {
    const repo = this.git.repository();
    if (!repo || !this.source() || this.relationship() === 'up-to-date') return null;
    if (repo.status.branch !== this.target()) return `Git Khronos switches to ${this.target()} first.`;
    const changes = repo.status.entryCount;
    return changes
      ? `You have ${changes} uncommitted ${changes === 1 ? 'change' : 'changes'}. Git stops without touching files it would overwrite; stash first to be safe.`
      : null;
  });
  readonly recoveryNote = computed(() => {
    switch (this.strategy()) {
      case 'merge': case 'rebase':
        return 'If Git stops on a conflict, resolve the files in Changes and continue, or abort to return exactly to where you started.';
      case 'squash':
        return 'Nothing is committed automatically: review the staged result, then commit it or discard it.';
      default: return null;
    }
  });
  readonly canCheckConflicts = computed(() => this.relationship() === 'diverged' && !!this.comparison()?.mergeBase && this.strategy() !== 'ff-only');
  readonly canConfirm = computed(() => {
    const strategy = this.strategy();
    if (!strategy || !this.source() || this.loading() || this.git.busy()) return false;
    return !this.options().find(option => option.strategy === strategy)?.unavailable;
  });
  readonly confirmLabel = computed(() => {
    const strategy = this.strategy();
    return this.options().find(option => option.strategy === strategy)?.title ?? 'Choose an option';
  });

  constructor() {
    effect(() => {
      const request = this.request();
      untracked(() => {
        this.target.set(request.target);
        this.source.set(request.source && request.source !== request.target ? request.source : '');
      });
    });
    effect(() => {
      this.tips();
      const target = this.target();
      const source = this.source();
      untracked(() => void this.compare(target, source));
    });
    afterNextRender(() => {
      const dialog = this.dialog()?.nativeElement;
      (this.source() ? dialog?.querySelector<HTMLElement>('[data-integrate-cancel]') : dialog?.querySelector<HTMLElement>('#integrate-source'))?.focus();
    });
  }

  chooseSource(name: string): void { this.source.set(name); }

  swap(): void {
    const source = this.source();
    if (!source) return;
    this.source.set(this.target());
    this.target.set(source);
  }

  private async compare(target: string, source: string): Promise<void> {
    const token = ++this.comparisonToken;
    const repositoryId = this.request().repositoryId;
    this.comparison.set(null);
    this.comparisonError.set('');
    this.conflictResult.set(null);
    this.conflictError.set('');
    this.strategy.set(null);
    if (!source || !target) return;
    this.loading.set(true);
    try {
      const comparison = await ipc.compare_branches({ repoId: repositoryId, target, source });
      if (this.destroyed || token !== this.comparisonToken) return;
      this.comparison.set(comparison);
    } catch (error: unknown) {
      if (this.destroyed || token !== this.comparisonToken) return;
      this.comparisonError.set((error as Partial<AppError>)?.message ?? 'Git did not answer.');
    } finally {
      if (!this.destroyed && token === this.comparisonToken) {
        this.loading.set(false);
        this.strategy.set(this.recommended() ?? (this.relationship() === 'up-to-date' ? null : 'merge'));
      }
    }
  }

  async checkConflicts(): Promise<void> {
    const comparison = this.comparison();
    if (!comparison || this.checkingConflicts()) return;
    const token = this.comparisonToken;
    const repositoryId = this.request().repositoryId;
    this.checkingConflicts.set(true);
    this.conflictError.set('');
    try {
      const result = await ipc.preview_merge({
        repoId: repositoryId,
        operationId: crypto.randomUUID(),
        request: {
          source: `refs/heads/${comparison.source}`,
          target: `refs/heads/${comparison.target}`,
          sourceOid: comparison.sourceOid,
          targetOid: comparison.targetOid,
        },
      });
      if (!this.destroyed && token === this.comparisonToken) this.conflictResult.set(result);
    } catch (error: unknown) {
      if (!this.destroyed && token === this.comparisonToken) this.conflictError.set((error as Partial<AppError>)?.message ?? 'Git did not answer.');
    } finally {
      if (!this.destroyed) this.checkingConflicts.set(false);
    }
  }

  confirm(): void {
    const strategy = this.strategy();
    if (!strategy || !this.canConfirm()) return;
    this.choose(strategy);
  }

  choose(strategy: IntegrationChoice['strategy']): void {
    const source = this.source();
    if (!source) return;
    const target = this.target();
    const comparison = this.comparison();
    const comparedTips = comparison && comparison.source === source && comparison.target === target
      ? { sourceOid: comparison.sourceOid, targetOid: comparison.targetOid }
      : undefined;
    this.chosen.emit({ target, source, strategy, comparedTips });
  }

  ngOnDestroy(): void { this.destroyed = true; }

  close(): void {
    const opener = this.request().returnFocus;
    this.closed.emit();
    setTimeout(() => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus();
    });
  }

  @HostListener('document:focusin')
  containFocus(): void {
    const dialog = this.dialog()?.nativeElement;
    if (!this.destroyed && dialog && !dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>('[data-integrate-cancel]')?.focus();
    }
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'radio') {
      event.preventDefault();
      this.confirm();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...this.dialog()!.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary')]
      .filter(control => !(control instanceof HTMLInputElement && control.type === 'radio' && !control.checked));
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault(); event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length]?.focus();
  }
}
