import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import type { SubmoduleDeinitResult, SubmoduleRemovalResult, SubmoduleRecordedCheckoutResult, SubmoduleState, SubmoduleStateReview, SubmoduleUrlSyncResult } from '@git-chronos/contracts';
import { GitChronosService } from './git-chronos.service';
import { GitHelpComponent } from './git-help.component';
import type { WorktreeRegistrationRequest } from './worktree-registration-dialog.component';
import { submoduleFindings } from './submodule-findings';


@Component({
  selector: 'gc-submodule-state-review',
  imports: [GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="close()">
        <section #dialog role="dialog" aria-modal="true" aria-labelledby="submodule-review-title"
          (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
          <h2 id="submodule-review-title">Review submodule state</h2>
          <p>Read-only. Uses Git status with every submodule check enabled, the index, .gitmodules and local
            configuration. A configured ignore setting does not hide changes here. Reviewing changes nothing.</p>
          @if (target.repositoryId !== git.activeRepositoryId()) {
            <p role="alert" tabindex="-1">The active repository changed. Close this review and inspect the intended repository.</p>
          }
          @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
          @if (loading()) { <p role="status">Inspecting submodules…</p> }
          @if (syncNotice()) { <p role="status" tabindex="-1" data-submodule-sync>{{ syncNotice() }}</p> }
          @if (review(); as result) {
            <div role="status" tabindex="-1" data-submodule-result>
              <p>{{ summary(result) }}</p>
            </div>
            <ul aria-label="Submodule states">
              @for (entry of result.entries; track entry.path) {
                <li [attr.aria-label]="'Submodule ' + entry.path">
                  <code>{{ entry.path }}</code>
                  @if (entry.name && entry.name !== entry.path) { <span>Name: {{ entry.name }}</span> }
                  <ul class="findings">
                    @for (finding of findings(entry); track finding.label) {
                      <li [class.attention]="finding.attention"><strong>{{ finding.label }}</strong>
                        <span>{{ finding.detail }}</span></li>
                    }
                  </ul>
                  @if (canSync(entry)) {
                    @if (confirming() === 'sync:' + entry.path) {
                      <div class="confirm" role="group" [attr.aria-label]="'Synchronize URL for ' + entry.path">
                        <p>Copy the .gitmodules URL into this repository's local configuration and the submodule's default
                          remote. Git resolves relative URLs. Committed files, the index and other submodules do not change.</p>
                        <p>Declared: <code>{{ entry.declaredUrl }}</code> Local now: <code>{{ entry.registeredUrl }}</code></p>
                        @if (syncing()) { <p role="status">Synchronizing URL…</p> }
                        <div class="row"><button type="button" data-sync-confirm [disabled]="unavailable() || syncing()" (click)="sync(entry)">Sync URL</button>
                          <button type="button" [disabled]="syncing()" (click)="cancelSync(entry.path)">Cancel</button></div>
                      </div>
                    } @else {
                      <button type="button" [attr.data-sync-open]="entry.path" [disabled]="unavailable() || syncing() || !!confirming()"
                        (click)="confirmSync(entry.path)">Sync local URL from .gitmodules…</button>
                    }
                  }
                  @if (canCheckout(entry)) {
                    @if (confirming() === 'checkout:' + entry.path) {
                      <div class="confirm" role="group" [attr.aria-label]="'Check out recorded commit for ' + entry.path">
                        <p>Detach the submodule at the commit recorded by this repository's index without fetching. Each
                          replaced commit is kept under a recovery reference; branches, untracked files and the parent index
                          do not change.</p>
                        <p>Current: <code>{{ entry.checkoutOid!.slice(0, 10) }}</code> Recorded: <code>{{ entry.indexOid!.slice(0, 10) }}</code></p>
                        <label><input type="checkbox" data-checkout-recursive [checked]="recursive() || entry.indexOid === entry.checkoutOid"
                          [disabled]="syncing() || entry.indexOid === entry.checkoutOid" (change)="recursive.set($any($event.target).checked)">
                          Also check out recorded commits in initialized nested submodules</label>
                        @if (!recursive() && entry.indexOid !== entry.checkoutOid) { <p>Nested submodules are left as they are.</p> }
                        @if (syncing()) { <p role="status">Checking out recorded commit…</p> }
                        <div class="row"><button type="button" data-checkout-confirm [disabled]="unavailable() || syncing()" (click)="checkout(entry)">Check out recorded commit</button>
                          <button type="button" [disabled]="syncing()" (click)="cancelCheckout(entry.path)">Cancel</button></div>
                      </div>
                    } @else {
                      <button type="button" [attr.data-checkout-open]="entry.path" [disabled]="unavailable() || syncing() || !!confirming()"
                        (click)="confirmCheckout(entry.path)">{{ entry.indexOid === entry.checkoutOid ? 'Check out nested recorded commits…' : 'Check out recorded commit…' }}</button>
                    }
                  }
                  @if (canDeinit(entry)) {
                    @if (confirming() === 'deinit:' + entry.path) {
                      <div class="confirm" role="group" [attr.aria-label]="'Deinitialize ' + entry.path">
                        <p>Remove the checked-out files of {{ entry.path }} and its local submodule settings. Git refuses if
                          anything is uncommitted, untracked or on another commit. The submodule repository data, its
                          branches, the recorded commit and .gitmodules stay; Initialize restores the files.</p>
                        @if (syncing()) { <p role="status">Deinitializing…</p> }
                        <div class="row"><button type="button" data-deinit-confirm [disabled]="unavailable() || syncing()" (click)="deinit(entry)">Deinitialize</button>
                          <button type="button" [disabled]="syncing()" (click)="cancel('deinit-open', entry.path)">Cancel</button></div>
                      </div>
                    } @else {
                      <button type="button" [attr.data-deinit-open]="entry.path" [disabled]="unavailable() || syncing() || !!confirming()"
                        (click)="open('deinit', entry.path)">Deinitialize…</button>
                    }
                  }
                  @if (canRemove(entry)) {
                    @if (confirming() === 'remove:' + entry.path) {
                      <div class="confirm" role="group" [attr.aria-label]="'Remove ' + entry.path + ' from the project'">
                        <p>Stage the deletion of {{ entry.path }} and its .gitmodules declaration; nothing is committed. Any
                          checked-out files are removed, but Git refuses if anything is uncommitted or untracked. The
                          submodule repository data and local settings are kept, and other staged changes stay.</p>
                        @if (syncing()) { <p role="status">Staging removal…</p> }
                        <div class="row"><button type="button" data-remove-confirm [disabled]="unavailable() || syncing()" (click)="remove(entry)">Stage removal</button>
                          <button type="button" [disabled]="syncing()" (click)="cancel('remove-open', entry.path)">Cancel</button></div>
                      </div>
                    } @else {
                      <button type="button" [attr.data-remove-open]="entry.path" [disabled]="unavailable() || syncing() || !!confirming()"
                        (click)="open('remove', entry.path)">Remove from project…</button>
                    }
                  }
                </li>
              } @empty {
                <li>No submodules are declared or recorded.</li>
              }
            </ul>
            <p>These are sequential observations. Nested submodules report their changes through their parent submodule.</p>
          }
          <gc-git-help topic="submodule" label="Learn about submodule state…" />
          <footer><button type="button" [disabled]="unavailable()" (click)="reload()">Reload review</button>
            <button data-submodule-close type="button" [disabled]="loading() || syncing()" (click)="close()">Close</button></footer>
        </section>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: var(--overlay-backdrop); }
    section { box-sizing: border-box; width: min(620px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p, li, button { font-size: 13px; line-height: 1.5; }
    ul { list-style: none; padding: 0; } li { padding: 10px 0; border-bottom: 1px solid var(--inspector-divider); }
    code, p, span { overflow-wrap: anywhere; } code, li > span { display: block; }
    .findings li { padding: 4px 0 4px 10px; border: 0; border-left: 3px solid var(--inspector-divider); margin-top: 4px; }
    .findings li.attention { border-left-color: var(--accent); }
    .findings strong, .findings span { display: block; }
    footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
    .confirm { margin-top: 8px; padding: 10px; border: 1px solid var(--inspector-divider); border-radius: 4px; }
    .confirm code { display: inline; } .row { display: flex; flex-wrap: wrap; gap: 8px; } li > button { margin-top: 6px; }
  `],
})
export class SubmoduleStateReviewComponent {
  readonly git = inject(GitChronosService);
  readonly request = input<WorktreeRegistrationRequest | null>(null);
  readonly closed = output<void>();
  readonly review = signal<SubmoduleStateReview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly confirming = signal<string | null>(null);
  readonly syncing = signal(false);
  readonly syncNotice = signal('');
  readonly recursive = signal(false);
  readonly findings = submoduleFindings;
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    effect(() => {
      if (this.request()) untracked(() => { this.syncNotice.set(''); this.confirming.set(null); void this.reload(); });
    });
  }

  canSync(entry: SubmoduleState): boolean {
    return !!entry.name && !!entry.declaredUrl && !!entry.registeredUrl && entry.urlMatches !== true;
  }

  canCheckout(entry: SubmoduleState): boolean {
    return entry.checkedOut && !entry.conflict && !!entry.indexOid && !!entry.checkoutOid
      && (entry.indexOid !== entry.checkoutOid || entry.trackedChanges);
  }

  canDeinit(entry: SubmoduleState): boolean {
    return !!entry.name && entry.checkedOut && !entry.conflict && !entry.trackedChanges && !entry.untrackedChanges
      && !!entry.checkoutOid && entry.checkoutOid === entry.indexOid;
  }

  canRemove(entry: SubmoduleState): boolean {
    return !!entry.name && !!entry.indexOid && !entry.conflict && !entry.stagedChange
      && (!entry.checkedOut || this.canDeinit(entry));
  }

  remove(entry: SubmoduleState): Promise<void> {
    return this.run(async target => {
      const result = await invoke<SubmoduleRemovalResult>('remove_submodule', {
        repoId: target.repositoryId, request: { path: entry.path, expectedIndexOid: entry.indexOid } });
      const data = result.gitDirectory ? ` Repository data remains at ${result.gitDirectory}.` : '';
      const settings = result.keptSettings.length
        ? ` Local settings were kept; remove them with git config --remove-section submodule.${result.name} once committed.` : '';
      return `Staged removal of ${result.path} and its declaration. Commit to finish.${data}${settings}`;
    });
  }

  open(kind: string, path: string): void {
    this.confirming.set(`${kind}:${path}`);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(`[data-${kind}-confirm]`)?.focus());
  }

  cancel(attribute: string, path: string): void {
    this.confirming.set(null);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(`[data-${attribute}="${CSS.escape(path)}"]`)?.focus());
  }

  deinit(entry: SubmoduleState): Promise<void> {
    return this.run(async target => {
      const result = await invoke<SubmoduleDeinitResult>('deinit_submodule', {
        repoId: target.repositoryId, request: { path: entry.path, expectedCheckoutOid: entry.checkoutOid } });
      const settings = result.removedSettings.map(setting => `${setting.key}=${setting.value}`).join(', ');
      const absorbed = result.absorbed ? ' Its embedded repository was first moved there by Git.' : '';
      return `Deinitialized ${result.path}. Repository data remains at ${result.gitDirectory}.${absorbed} Removed local settings: ${settings || 'none'}.`;
    });
  }

  confirmCheckout(path: string): void {
    this.recursive.set(false);
    this.confirming.set(`checkout:${path}`);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-checkout-confirm]')?.focus());
  }

  cancelCheckout(path: string): void {
    this.confirming.set(null);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(`[data-checkout-open="${CSS.escape(path)}"]`)?.focus());
  }

  checkout(entry: SubmoduleState): Promise<void> {
    return this.run(async target => {
      const result = await invoke<SubmoduleRecordedCheckoutResult>('checkout_recorded_submodule_commit', {
        repoId: target.repositoryId, request: { path: entry.path, expectedIndexOid: entry.indexOid, expectedCheckoutOid: entry.checkoutOid,
          recursive: this.recursive() || entry.indexOid === entry.checkoutOid } });
      const branch = result.previousBranch ? ` Branch ${result.previousBranch.replace(/^refs\/heads\//, '')} was left unchanged.` : '';
      const top = result.recoveryReference
        ? `Checked out ${result.recordedOid.slice(0, 10)} in ${result.path}. The previous commit ${result.previousOid.slice(0, 10)} is kept at ${result.recoveryReference} inside the submodule.${branch}`
        : `${result.path} already matched its recorded commit.`;
      const moved = result.nested.filter(item => item.recoveryReference);
      const skipped = result.nested.filter(item => item.skipped);
      const nested = [
        ...moved.map(item => ` Nested ${item.path}: ${item.previousOid?.slice(0, 10)} → ${item.recordedOid?.slice(0, 10)}, previous kept at ${item.recoveryReference}.`),
        ...skipped.map(item => ` Nested ${item.path} skipped: ${item.skipped}`),
      ].join('');
      return top + nested;
    });
  }

  confirmSync(path: string): void {
    this.confirming.set(`sync:${path}`);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-sync-confirm]')?.focus());
  }

  cancelSync(path: string): void {
    this.confirming.set(null);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(`[data-sync-open="${CSS.escape(path)}"]`)?.focus());
  }

  sync(entry: SubmoduleState): Promise<void> {
    return this.run(async target => {
      const result = await invoke<SubmoduleUrlSyncResult>('sync_submodule_url', { repoId: target.repositoryId, request: {
        path: entry.path, expectedDeclaredUrl: entry.declaredUrl, expectedRegisteredUrl: entry.registeredUrl } });
      const remote = result.remoteName
        ? ` Submodule remote ${result.remoteName} changed from ${result.previousRemoteUrl ?? 'unset'} to ${result.remoteUrl}.`
        : ' The submodule remote was unchanged or not checked out.';
      return `Synchronized ${result.path}: local URL changed from ${result.previousRegisteredUrl} to ${result.registeredUrl}.${remote}`;
    });
  }

  private async run(action: (target: WorktreeRegistrationRequest) => Promise<string>): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable() || this.syncing()) return;
    this.syncing.set(true);
    this.syncNotice.set('');
    let failure = '';
    try {
      this.syncNotice.set(await action(target));
    } catch (reason) {
      failure = this.message(reason);
    } finally {
      this.syncing.set(false);
      this.confirming.set(null);
    }
    if (this.request() !== target) return;
    await this.reload();
    if (failure) this.error.set(failure);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(failure ? '[role=alert]' : '[data-submodule-sync]')?.focus());
  }

  unavailable(): boolean {
    return this.loading() || this.request()?.repositoryId !== this.git.activeRepositoryId();
  }

  summary(result: SubmoduleStateReview): string {
    const attention = result.entries.filter(entry => submoduleFindings(entry).some(finding => finding.attention)).length;
    const total = `${result.entries.length} submodule ${result.entries.length === 1 ? 'path' : 'paths'}`;
    return attention ? `${total}; ${attention} need attention.` : `${total}; none need attention.`;
  }

  async reload(): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable()) return;
    this.loading.set(true);
    this.review.set(null);
    this.error.set('');
    try {
      const review = await invoke<SubmoduleStateReview>('submodule_state_review', { repoId: target.repositoryId });
      if (this.request() === target && target.repositoryId === this.git.activeRepositoryId()) this.review.set(review);
    } catch (failure) {
      if (this.request() === target) this.error.set(this.message(failure));
    } finally {
      this.loading.set(false);
    }
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(
      this.error() || target.repositoryId !== this.git.activeRepositoryId() ? '[role=alert]' : '[data-submodule-result]')?.focus());
  }

  close(): void {
    if (this.loading() || this.syncing()) return;
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

  private message(failure: unknown): string {
    const detail = failure && typeof failure === 'object' ? failure as { message?: unknown; hint?: unknown } : null;
    const text = typeof detail?.message === 'string' ? detail.message : 'The submodule review failed.';
    return typeof detail?.hint === 'string' ? `${text} ${detail.hint}` : text;
  }
}
