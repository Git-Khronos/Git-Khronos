import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { ipc, type AppError, type MergePreview, type MergePreviewRequest } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

export interface MergePreviewDialogRequest {
  repositoryId: string;
  source?: string;
  target?: string;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-merge-preview-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close()">
      <section #dialog role="dialog" aria-modal="true" aria-labelledby="merge-preview-title" aria-describedby="merge-preview-scope"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <header><h2 id="merge-preview-title">Preview merge conflicts</h2><button type="button" (click)="close()">Close</button></header>
        <p id="merge-preview-scope">Compare committed branch tips without starting a merge. HEAD, index and working files stay unchanged.
          Uncommitted changes and remote updates not yet fetched are excluded.</p>
        <label for="preview-source">Merge source branch</label>
        <select id="preview-source" [disabled]="busy()" (change)="choose('source', $any($event.target).value)">
          @for (branch of branches(); track branch.reference) {
            <option [value]="branch.reference" [selected]="source() === branch.reference">{{ branch.label }}</option>
          }
        </select>
        <label for="preview-target">Into target branch</label>
        <select id="preview-target" [disabled]="busy()" (change)="choose('target', $any($event.target).value)">
          <option value="" [selected]="!target()">Choose a target branch</option>
          @for (branch of branches(); track branch.reference) {
            <option [value]="branch.reference" [selected]="target() === branch.reference">{{ branch.label }}</option>
          }
        </select>
        <p>Requires Git 2.43 or newer. Uses default Git merge settings and committed attributes. Custom merge drivers, shallow histories and partial clones require a separate review.</p>
        @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
        @if (stale()) { <p role="status">References changed; this preview is invalid. Refresh the repository and request a new preview.</p> }
        @if (visibleResult(); as result) {
          <div role="status"><strong>{{ result.clean ? 'No conflicts reported for these commits' : 'Git reports merge conflicts' }}</strong></div>
          <dl><dt>Source: {{ result.request.source }}</dt><dd>{{ result.request.sourceOid }}</dd>
            <dt>Target: {{ result.request.target }}</dt><dd>{{ result.request.targetOid }}</dd></dl>
          @if (result.conflictedPaths.length) {
            <p>{{ result.conflictedPaths.length }} conflicted paths</p>
            <ul aria-label="Predicted conflicted paths">@for (path of result.conflictedPaths; track path) { <li><code>{{ path }}</code></li> }</ul>
          } @else if (!result.clean) { <p>Git reported a conflict without individual conflicted path records.</p> }
          <p>This result applies to the displayed commits. A clean preview does not guarantee that a later merge, custom strategy or uncommitted work will succeed.</p>
        }
        <footer>
          @if (busy()) {
            <span role="status">Previewing committed merge…</span>
            <button type="button" (click)="cancel()" [disabled]="cancelling()">Cancel preview</button>
          } @else {
            <button type="button" [disabled]="!canPreview() || git.busy()" (click)="preview()">Preview conflicts</button>
          }
        </footer>
      </section>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; background: #080811b8; display: grid; place-items: center; padding: 18px; }
    section { box-sizing: border-box; width: min(660px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; color: var(--text); background: var(--inspector-list); border: 1px solid var(--inspector-divider); border-radius: 7px; }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    footer { margin-top: 18px; } h2 { font-size: 18px; margin: 0; }
    p, li, dt, dd { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    dd { margin: 4px 0 12px; font-family: monospace; } li { white-space: pre-wrap; }
    label { display: block; margin: 12px 0 6px; } select { box-sizing: border-box; width: 100%; min-height: 32px; }
    button, select { color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); padding: 6px 10px; }
    button { min-height: 28px; cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
    button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); } ul { max-height: 240px; overflow: auto; }
  `],
})
export class MergePreviewDialogComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<MergePreviewDialogRequest>();
  readonly closed = output<void>();
  readonly source = signal('');
  readonly target = signal('');
  readonly busy = signal(false);
  readonly cancelling = signal(false);
  readonly error = signal('');
  readonly result = signal<MergePreview | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private operation: { id: string; cancelled: boolean } | null = null;
  private destroyed = false;
  readonly branches = computed(() => {
    const repo = this.git.repository();
    if (!repo || repo.id !== this.request().repositoryId) return [];
    const branches = repo.branches.map(branch => ({ reference: branch.fullName, label: branch.name, oid: branch.oid }));
    if (repo.headOid && !branches.some(branch => branch.reference === 'HEAD')) {
      branches.unshift({ reference: 'HEAD', label: 'HEAD (current checkout)', oid: repo.headOid });
    }
    return branches;
  });
  readonly canPreview = computed(() => this.source() !== this.target() && !!this.selectedOid(this.source()) && !!this.selectedOid(this.target()));
  readonly stale = computed(() => {
    const request = this.result()?.request;
    return !!request && (request.source !== this.source() || request.target !== this.target()
      || this.selectedOid(request.source) !== request.sourceOid || this.selectedOid(request.target) !== request.targetOid);
  });
  readonly visibleResult = computed(() => this.stale() ? null : this.result());

  constructor() {
    effect(() => {
      const request = this.request();
      untracked(() => {
        this.result.set(null);
        const repo = this.git.repository();
        const current = repo?.branches.find(branch => branch.current);
        this.source.set(request.source ?? current?.fullName ?? 'HEAD');
        const upstream = repo?.branches.find(branch => branch.name === current?.upstream);
        this.target.set(request.target ?? upstream?.fullName ?? repo?.branches.find(branch => !branch.current)?.fullName ?? '');
      });
    });
    afterNextRender(() => this.dialog()?.nativeElement.querySelector<HTMLSelectElement>('#preview-target')?.focus());
  }
  selectedOid(reference: string): string | null { return this.branches().find(branch => branch.reference === reference)?.oid ?? null; }
  choose(which: 'source' | 'target', reference: string): void {
    this[which].set(reference); this.result.set(null); this.error.set('');
  }
  async preview(): Promise<void> {
    if (!this.canPreview() || this.busy() || this.git.busy()) return;
    const request: MergePreviewRequest = { source: this.source(), target: this.target(), sourceOid: this.selectedOid(this.source())!, targetOid: this.selectedOid(this.target())! };
    const repositoryId = this.request().repositoryId;
    const operation = { id: crypto.randomUUID(), cancelled: false };
    this.operation = operation; this.busy.set(true); this.cancelling.set(false); this.error.set(''); this.result.set(null);
    try {
      const outcome = await this.git.run('Previewing merge conflicts…', async report => {
        const result = await ipc.preview_merge({ repoId: repositoryId, request, operationId: operation.id });
        if (this.destroyed || operation.cancelled || this.git.activeRepositoryId() !== repositoryId) {
          throw { kind: 'operationCancelled', message: 'Merge preview cancelled.', hint: null };
        }
        this.result.set(result);
        report(result.clean ? 'Merge preview completed without reported conflicts' : 'Merge preview found conflicts');
      }, repositoryId, operation.id);
      if (!this.destroyed && this.git.activeRepositoryId() === repositoryId && (outcome !== 'success' || operation.cancelled)) {
        this.error.set(operation.cancelled ? 'Preview cancelled. Request a new preview.' : this.git.error() ?? 'Preview did not complete. Request a new preview.');
      }
    } finally {
      this.operation = null; this.busy.set(false); this.cancelling.set(false);
    }
  }
  async cancel(): Promise<void> {
    const operation = this.operation;
    if (!operation || this.cancelling()) return;
    operation.cancelled = true; this.result.set(null); this.cancelling.set(true);
    try {
      const acknowledged = await ipc.cancel_git_operation({ operationId: operation.id });
      if (!this.destroyed && this.operation === operation && !acknowledged) this.error.set('Cancellation was not acknowledged; waiting for the preview to finish.');
    } catch (error: unknown) {
      if (!this.destroyed && this.operation === operation) {
        const payload = error as Partial<AppError>;
        this.error.set(payload?.message ?? 'Cancellation failed; close this preview or wait for it to finish.');
        this.cancelling.set(false);
      }
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); }
  }
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
      (dialog.querySelector<HTMLSelectElement>('#preview-target:not(:disabled)') ?? dialog.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
    }
  }
  @HostListener('window:resize')
  refocusAfterResize(): void {
    queueMicrotask(() => this.containFocus());
  }
  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...this.dialog()!.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')];
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault(); event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length]?.focus();
  }
}
