import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { ipc } from '@git-khronos/contracts';
import type { AppError, IntegrityReport } from '@git-khronos/contracts';
import { GitHelpComponent } from './git-help.component';
import { GitKhronosService } from './git-khronos.service';

@Component({
  selector: 'gc-integrity-panel',
  imports: [GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <strong>Repository integrity</strong>
    <p>Explicit git fsck --full inspects objects and connectivity. No repairs, lost-found files,
      maintenance or downloads are requested. Results are an observation, not a guarantee against concurrent changes.
      Promisor/partial-clone configurations are refused. LFS content, filesystem health and signatures are not verified.</p>
    @if (busy()) {
      <p role="status">Inspecting repository…</p>
      <button type="button" (click)="cancel()" [disabled]="cancelling()">Cancel inspection</button>
    } @else {
      <button type="button" [disabled]="disabled()" (click)="inspect()">Inspect integrity</button>
    }
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (result(); as report) {
      <div role="status"><strong>{{ report.truncated ? 'Incomplete report — output limit reached' :
        report.passed ? 'Git completed the check without reported integrity errors' : 'Git reported findings or a check failure' }}</strong>
        <p>Exit {{ report.exitCode }}. Dangling objects can be normal; inspect the actual report.
          A successful check is not a backup or proof that every aspect of this repository is healthy.</p></div>
      @if (report.stdout) { <pre aria-label="Integrity standard output">{{ report.stdout }}</pre> }
      @if (report.stderr) { <pre aria-label="Integrity diagnostic output">{{ report.stderr }}</pre> }
      @if (!report.stdout && !report.stderr) { <p>No output reported by Git.</p> }
      <p>Preserve the repository and working files before investigating damage. Maintenance and pruning
        cannot restore missing data. Recover from a verified backup or known-good source.</p>
    }
    <gc-git-help topic="maintenance" label="Learn about integrity and maintenance…" [disabled]="busy() || disabled()" />
    <details (toggle)="maintenanceConfirmed.set(false)">
      <summary>Non-pruning maintenance</summary>
      <p>Checks integrity first, then builds the commit graph and packs references.
        No garbage collection, object pruning, reflog expiry, worktree cleanup, prefetch or scheduling.
        This changes repository metadata and uses disk space; it cannot repair missing data.
        Inspect failures and partial effects before retrying. This operation is not cancellable.
        The command-palette action uses the same bounded scope.</p>
      @if (maintenancePending()) { <p role="status">Checking integrity and packing metadata…</p> }
      @if (maintenanceConfirmed()) {
        <p role="status">Run integrity-checked commit-graph and ref packing in this repository?</p>
        <button type="button" [disabled]="disabled() || busy()" (click)="maintain()">Run maintenance</button>
        <button type="button" [disabled]="disabled() || busy()" (click)="maintenanceConfirmed.set(false)">Cancel maintenance</button>
      } @else {
        <button type="button" [disabled]="disabled() || busy()" (click)="maintenanceConfirmed.set(true)">Review maintenance</button>
      }
    </details>
  `,
  styles: [`
    :host { display: block; }
    p { line-height: 1.5; font-size: 12px; overflow-wrap: anywhere; }
    pre { max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--inspector-row); padding: 8px; }
    button { min-height: 28px; padding: 6px 8px; color: var(--text); background: var(--inspector-row); cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class IntegrityPanelComponent {
  readonly git = inject(GitKhronosService);
  readonly repositoryId = input.required<string>();
  readonly disabled = input(false);
  readonly busy = signal(false);
  readonly cancelling = signal(false);
  readonly error = signal('');
  readonly result = signal<IntegrityReport | null>(null);
  readonly maintenanceConfirmed = signal(false);
  readonly maintenancePending = signal(false);
  private operationId: string | null = null;

  constructor() {
    effect(() => {
      this.repositoryId();
      this.result.set(null);
      this.error.set('');
      this.maintenanceConfirmed.set(false);
    });
  }

  async inspect(): Promise<void> {
    if (this.busy() || this.disabled()) return;
    const repositoryId = this.repositoryId();
    const operationId = crypto.randomUUID();
    this.operationId = operationId;
    this.busy.set(true);
    this.cancelling.set(false);
    this.error.set('');
    this.result.set(null);
    try {
      const outcome = await this.git.run('Inspecting integrity…', async reportActivity => {
        const report = await ipc.inspect_repository_integrity({ repoId: repositoryId, operationId });
        reportActivity(report.truncated ? 'Integrity report incomplete' :
          report.passed ? 'Integrity check finished' : 'Integrity check reported findings or failure');
        if (this.repositoryId() === repositoryId) this.result.set(report);
      }, repositoryId, operationId);
      if (outcome !== 'success' && this.repositoryId() === repositoryId) {
        this.error.set(this.git.error() ?? 'Inspection cancelled. No complete result is available.');
      }
    } finally {
      this.operationId = null;
      this.busy.set(false);
    }
  }

  async cancel(): Promise<void> {
    if (!this.operationId || this.cancelling()) return;
    const operationId = this.operationId;
    const repositoryId = this.repositoryId();
    this.cancelling.set(true);
    try {
      const acknowledged = await ipc.cancel_git_operation({ operationId });
      if (this.operationId !== operationId || this.repositoryId() !== repositoryId) return;
      this.error.set(acknowledged ? 'Cancellation requested; waiting for Git to stop.' : 'The inspection may have finished before cancellation was received.');
      if (!acknowledged) this.cancelling.set(false);
    } catch (error: unknown) {
      if (this.operationId === operationId && this.repositoryId() === repositoryId) {
        this.error.set(this.describe(error));
        this.cancelling.set(false);
      }
    }
  }

  async maintain(): Promise<void> {
    if (this.disabled() || this.busy() || this.maintenancePending() || !this.maintenanceConfirmed()) return;
    const repositoryId = this.repositoryId();
    this.maintenanceConfirmed.set(false);
    this.maintenancePending.set(true);
    this.error.set('');
    this.result.set(null);
    try {
      const outcome = await this.git.performRepositoryMaintenance();
      if (this.repositoryId() === repositoryId) {
        this.error.set(outcome ? '' : this.git.error() ?? 'Maintenance did not complete. Inspect the repository before retrying.');
      }
    } finally {
      this.maintenancePending.set(false);
    }
  }

  private describe(error: unknown): string {
    const payload = error as Partial<AppError> | null;
    return [payload?.message ?? String(error), payload?.hint].filter(Boolean).join(' ');
  }
}
