import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import type { SubmoduleDeinitResult, SubmoduleRemovalResult, SubmoduleRecordedCheckoutResult, SubmoduleState, SubmoduleStateReview, SubmoduleTrackingBranchResult, SubmoduleUrlSyncResult } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
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
          <header class="dialog-heading">
            <div><span>Repository settings</span><h2 id="submodule-review-title">Manage submodules</h2></div>
            <small>Inspect and safely reconcile repositories recorded inside this project.</small>
          </header>
          <p class="intro">Inspect every declared or recorded submodule using Git status, the index, .gitmodules and local
            configuration. A configured ignore setting does not hide changes here. Inspection changes nothing;
            available management actions explain their effects before they run.</p>
          @if (target.repositoryId !== git.activeRepositoryId()) {
            <p role="alert" tabindex="-1">The active repository changed. Close this review and inspect the intended repository.</p>
          }
          @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
          @if (loading()) { <p role="status">Inspecting submodules…</p> }
          @if (syncNotice()) { <p role="status" tabindex="-1" data-submodule-sync>{{ syncNotice() }}</p> }
          @if (review(); as result) {
            <div class="review-summary" [class.attention]="attentionCount(result)" role="status" tabindex="-1" data-submodule-result>
              <strong>{{ result.entries.length }}</strong>
              <span>{{ summary(result) }}</span>
            </div>
            @if (result.entries.length) {
              <div class="bulk-actions" role="group" aria-label="All submodule actions">
                <div><strong>All submodules</strong><small>Run one reviewed operation across the repository.</small></div>
                <button type="button" data-initialize-all-open [disabled]="!initializableCount(result) || unavailable() || syncing() || !!confirming()"
                  (click)="openBulk('initialize-all')">Initialize missing <span>{{ initializableCount(result) || '' }}</span></button>
                <button type="button" data-update-all-open [disabled]="!canUpdateAll(result) || unavailable() || syncing() || !!confirming()"
                  [title]="updateAllReason(result)" (click)="openBulk('update-all')">Update all from remotes</button>
              </div>
              @if (confirming() === 'initialize-all') {
                <div class="confirm bulk-confirm" role="group" aria-label="Initialize all missing submodules">
                  <p>Initialize {{ initializableCount(result) }} missing {{ initializableCount(result) === 1 ? 'submodule' : 'submodules' }} at the commits recorded by this repository, including nested submodules. Existing initialized checkouts are retained. Git may contact configured remotes.</p>
                  @if (syncing()) { <p role="status">Initializing missing submodules…</p> }
                  <div class="row"><button type="button" data-initialize-all-confirm [disabled]="unavailable() || syncing()" (click)="runBulk('initialize-all')">Initialize missing</button>
                    <button type="button" [disabled]="syncing()" (click)="cancelBulk('initialize-all')">Cancel</button></div>
                </div>
              } @else if (confirming() === 'update-all') {
                <div class="confirm bulk-confirm" role="group" aria-label="Update all submodules from remotes">
                  <p>Fetch each initialized submodule's configured remote-tracking branch recursively and check out its latest commit. Parent-repository gitlinks can become modified and still need an explicit commit. This action is available only when every reviewed submodule is initialized and has no conflict or local file changes.</p>
                  @if (syncing()) { <p role="status">Updating all submodules…</p> }
                  <div class="row"><button type="button" data-update-all-confirm [disabled]="unavailable() || syncing()" (click)="runBulk('update-all')">Update all from remotes</button>
                    <button type="button" [disabled]="syncing()" (click)="cancelBulk('update-all')">Cancel</button></div>
                </div>
              }
            }
            <ul class="entries" aria-label="Submodule states">
              @for (entry of result.entries; track entry.path) {
                <li class="entry-card" [attr.aria-label]="'Submodule ' + entry.path">
                  <div class="entry-heading">
                    <div><code>{{ entry.path }}</code>
                      @if (entry.name && entry.name !== entry.path) { <small>Name: {{ entry.name }}</small> }
                    </div>
                    <span class="state" [class.attention]="hasAttention(entry)">{{ hasAttention(entry) ? 'Needs attention' : 'Up to date' }}</span>
                  </div>
                  <dl class="metadata">
                    <div><dt>Recorded</dt><dd><code>{{ shortOid(entry.indexOid) }}</code></dd></div>
                    <div><dt>Checked out</dt><dd><code>{{ entry.checkedOut ? shortOid(entry.checkoutOid) : 'Not initialized' }}</code></dd></div>
                    @if (entry.name) { <div class="wide"><dt>Remote update branch</dt><dd>{{ trackingBranchLabel(entry.trackingBranch) }}</dd></div> }
                    @if (entry.declaredUrl) { <div class="wide"><dt>.gitmodules URL</dt><dd>{{ entry.declaredUrl }}</dd></div> }
                    @if (entry.registeredUrl) { <div class="wide"><dt>Local URL</dt><dd>{{ entry.registeredUrl }}</dd></div> }
                  </dl>
                  <ul class="findings">
                    @for (finding of findings(entry); track finding.label) {
                      <li [class.attention]="finding.attention"><strong>{{ finding.label }}</strong>
                        <span>{{ finding.detail }}</span></li>
                    }
                  </ul>
                  @if (entry.name) {
                    @if (confirming() === 'branch:' + entry.path) {
                      <div class="confirm branch-confirm" role="group" [attr.aria-label]="'Change tracking branch for ' + entry.path">
                        <p>Choose which remote branch <code>Update from remote</code> follows. This edits only the submodule's <code>branch</code> setting in .gitmodules; review and commit that file to share the choice.</p>
                        <label>Tracking behavior
                          <select data-branch-mode aria-label="Tracking behavior" [value]="trackingBranchMode()" [disabled]="syncing()" (change)="setTrackingBranchMode($any($event.target).value)">
                            <option value="default">Remote default branch</option>
                            <option value="same">Same branch name as parent</option>
                            <option value="specific">Specific remote branch</option>
                          </select>
                        </label>
                        @if (trackingBranchMode() === 'specific') {
                          <label>Remote branch name
                            <input data-branch-name type="text" aria-label="Remote branch name" autocomplete="off" spellcheck="false" placeholder="main" [value]="trackingBranchName()" [disabled]="syncing()" (input)="trackingBranchName.set($any($event.target).value)" />
                          </label>
                        }
                        @if (syncing()) { <p role="status">Saving tracking branch…</p> }
                        <div class="row"><button type="button" data-branch-confirm [disabled]="unavailable() || syncing() || (trackingBranchMode() === 'specific' && !trackingBranchName().trim())" (click)="saveTrackingBranch(entry)">Save tracking branch</button>
                          <button type="button" [disabled]="syncing()" (click)="cancel('branch-open', entry.path)">Cancel</button></div>
                      </div>
                    } @else {
                      <button type="button" [attr.data-branch-open]="entry.path" [disabled]="unavailable() || syncing() || !!confirming()" (click)="openTrackingBranch(entry)">Change tracking branch…</button>
                    }
                  }
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
                <li class="empty-state"><strong>No submodules</strong><span>This repository has no declared or recorded submodule paths.</span></li>
              }
            </ul>
            <p class="footnote">These are sequential observations. Nested submodules report their changes through their parent submodule.</p>
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
    section { box-sizing: border-box; width: min(760px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 8px; background: var(--inspector-list); color: var(--text); box-shadow: 0 20px 60px #0008; }
    .dialog-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--inspector-divider); }
    .dialog-heading div { min-width: 0; } .dialog-heading span { display: block; margin-bottom: 3px; color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .dialog-heading small { max-width: 310px; color: var(--muted); font-size: 12px; line-height: 1.4; text-align: right; }
    h2 { margin: 0; font-size: 18px; }
    .intro { margin: 14px 0; color: var(--muted); }
    p, li, button { font-size: 13px; line-height: 1.5; }
    ul { list-style: none; padding: 0; } .entries { display: grid; gap: 10px; margin: 12px 0; }
    .entry-card { min-width: 0; padding: 14px; border: 1px solid var(--inspector-divider); border-radius: 6px; background: var(--inspector-row); }
    code, p, span, dd { overflow-wrap: anywhere; }
    .entry-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
    .entry-heading > div { min-width: 0; } .entry-heading code { color: var(--text); font-size: 13px; font-weight: 700; }
    .entry-heading small { display: block; margin-top: 2px; color: var(--muted); }
    .state { flex: none; padding: 2px 7px; border: 1px solid #3d665b; border-radius: 999px; background: #203b35; color: #7cdbbf; font-size: 11px; font-weight: 750; }
    .state.attention { border-color: #735d36; background: #3c3020; color: #efbd69; }
    .metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; margin: 12px 0; padding: 9px 10px; border-radius: 5px; background: color-mix(in srgb, var(--inspector-list) 72%, transparent); }
    .metadata div { min-width: 0; } .metadata .wide { grid-column: 1 / -1; }
    dt { color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    dd { margin: 1px 0 0; color: var(--text); font-size: 12px; } dd code { font-weight: 500; }
    .findings { display: grid; gap: 5px; margin: 0 0 4px; }
    .findings li { padding: 6px 8px 6px 10px; border: 0; border-left: 3px solid var(--inspector-divider); border-radius: 0 4px 4px 0; background: color-mix(in srgb, var(--inspector-list) 58%, transparent); }
    .findings li.attention { border-left-color: var(--accent); }
    .findings strong, .findings span { display: block; }
    .review-summary { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: center; gap: 10px; margin: 12px 0; padding: 9px 11px; border: 1px solid #3d665b; border-radius: 6px; background: #203b35; color: #a6e5d1; }
    .review-summary.attention { border-color: #735d36; background: #3c3020; color: #f3ca83; }
    .review-summary strong { font-size: 17px; text-align: center; } .review-summary span { font-size: 12px; }
    .bulk-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px; margin: 10px 0 12px; padding: 10px 11px; border: 1px solid var(--inspector-divider); border-radius: 6px; background: color-mix(in srgb, var(--inspector-row) 70%, transparent); }
    .bulk-actions > div { min-width: 0; display: grid; gap: 1px; } .bulk-actions strong { font-size: 12px; } .bulk-actions small { color: var(--muted); font-size: 11px; }
    .bulk-actions button { margin: 0; white-space: nowrap; } .bulk-actions button span { min-width: 18px; margin-left: 4px; padding: 0 5px; border-radius: 999px; background: var(--inspector-row); font-size: 11px; }
    .bulk-confirm { margin-bottom: 12px; }
    .empty-state { display: grid; gap: 3px; padding: 18px; border: 1px dashed var(--inspector-divider); border-radius: 6px; color: var(--muted); text-align: center; }
    .empty-state strong { color: var(--text); }
    .footnote { color: var(--muted); font-size: 12px; }
    footer { position: sticky; bottom: -20px; display: flex; gap: 10px; justify-content: flex-end; margin: 18px -20px -20px; padding: 12px 20px; border-top: 1px solid var(--inspector-divider); background: var(--inspector-list); }
    button { margin: 6px 6px 0 0; padding: 7px 11px; border: 1px solid var(--inspector-divider); border-radius: 4px; background: var(--inspector-list); color: var(--text); }
    button:hover:not(:disabled) { border-color: var(--accent); background: var(--inspector-row); }
    footer button { margin: 0; }
    button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
    .confirm { margin-top: 10px; padding: 11px; border: 1px solid #735d36; border-radius: 5px; background: #302719; }
    .confirm p:first-child { margin-top: 0; } .confirm code { display: inline; } .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .branch-confirm { display: grid; gap: 10px; }
    .branch-confirm p { margin: 0; }
    .branch-confirm label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .branch-confirm select, .branch-confirm input { box-sizing: border-box; min-height: 34px; width: 100%; padding: 6px 8px; border: 1px solid var(--inspector-divider); border-radius: 4px; background: var(--inspector-list); color: var(--text); font: inherit; }
    .branch-confirm select:focus-visible, .branch-confirm input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    @media (max-width: 620px) { .backdrop { padding: 8px; } section { max-height: calc(100dvh - 16px); padding: 14px; } .dialog-heading { grid-template-columns: 1fr; gap: 5px; } .dialog-heading small { max-width: none; text-align: left; } .bulk-actions { grid-template-columns: 1fr; } .bulk-actions button { width: 100%; } footer { bottom: -14px; margin: 14px -14px -14px; padding: 10px 14px; } }
  `],
})
export class SubmoduleStateReviewComponent {
  readonly git = inject(GitKhronosService);
  readonly request = input<WorktreeRegistrationRequest | null>(null);
  readonly closed = output<void>();
  readonly review = signal<SubmoduleStateReview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly confirming = signal<string | null>(null);
  readonly syncing = signal(false);
  readonly syncNotice = signal('');
  readonly recursive = signal(false);
  readonly trackingBranchMode = signal<'default' | 'same' | 'specific'>('default');
  readonly trackingBranchName = signal('');
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

  trackingBranchLabel(branch: string | null): string {
    if (branch === '.') return 'Same branch name as parent';
    return branch || 'Remote default branch';
  }

  openTrackingBranch(entry: SubmoduleState): void {
    this.trackingBranchMode.set(entry.trackingBranch === '.' ? 'same' : entry.trackingBranch ? 'specific' : 'default');
    this.trackingBranchName.set(entry.trackingBranch && entry.trackingBranch !== '.' ? entry.trackingBranch : '');
    this.confirming.set(`branch:${entry.path}`);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-branch-mode]')?.focus());
  }

  setTrackingBranchMode(mode: 'default' | 'same' | 'specific'): void {
    this.trackingBranchMode.set(mode);
    if (mode === 'specific') {
      setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-branch-name]')?.focus());
    }
  }

  saveTrackingBranch(entry: SubmoduleState): Promise<void> {
    const mode = this.trackingBranchMode();
    const branch = mode === 'default' ? null : mode === 'same' ? '.' : this.trackingBranchName().trim();
    if (mode === 'specific' && !branch) return Promise.resolve();
    return this.run(async target => {
      const result = await invoke<SubmoduleTrackingBranchResult>('set_submodule_tracking_branch', { repoId: target.repositoryId, request: {
        path: entry.path, expectedTrackingBranch: entry.trackingBranch, trackingBranch: branch } });
      return `Tracking branch for ${result.path} changed from ${this.trackingBranchLabel(result.previousTrackingBranch)} to ${this.trackingBranchLabel(result.trackingBranch)}. Review and commit .gitmodules to share this setting.`;
    });
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
    const attention = this.attentionCount(result);
    const total = `${result.entries.length} submodule ${result.entries.length === 1 ? 'path' : 'paths'}`;
    return attention ? `${total}; ${attention} need attention.` : `${total}; none need attention.`;
  }

  attentionCount(result: SubmoduleStateReview): number {
    return result.entries.filter(entry => this.hasAttention(entry)).length;
  }

  hasAttention(entry: SubmoduleState): boolean {
    return submoduleFindings(entry).some(finding => finding.attention);
  }

  initializableCount(result: SubmoduleStateReview): number {
    return result.entries.filter(entry => !!entry.name && !!entry.indexOid && !entry.checkedOut).length;
  }

  canUpdateAll(result: SubmoduleStateReview): boolean {
    return !!result.entries.length && result.entries.every(entry =>
      !!entry.name && !!entry.indexOid && entry.checkedOut && !entry.conflict
      && !entry.trackedChanges && !entry.untrackedChanges);
  }

  updateAllReason(result: SubmoduleStateReview): string {
    if (this.canUpdateAll(result)) return 'Fetch and check out the latest configured remote commits recursively';
    if (this.initializableCount(result)) return 'Initialize missing submodules first';
    return 'Resolve conflicts and local file changes before updating every submodule';
  }

  openBulk(action: 'initialize-all' | 'update-all'): void {
    this.confirming.set(action);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(`[data-${action}-confirm]`)?.focus());
  }

  cancelBulk(action: 'initialize-all' | 'update-all'): void {
    this.confirming.set(null);
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(`[data-${action}-open]`)?.focus());
  }

  async runBulk(action: 'initialize-all' | 'update-all'): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable() || this.syncing()) return;
    this.syncing.set(true);
    this.syncNotice.set('');
    this.error.set('');
    const succeeded = action === 'initialize-all'
      ? await this.git.initializeAllSubmodules()
      : await this.git.updateAllSubmodules();
    const failure = succeeded ? '' : this.git.error() ?? 'The bulk submodule operation failed.';
    this.syncing.set(false);
    this.confirming.set(null);
    if (this.request() !== target) return;
    await this.reload();
    if (failure) this.error.set(failure);
    else this.syncNotice.set(action === 'initialize-all'
      ? 'Initialized all missing submodules at their recorded commits.'
      : 'Updated all submodules from their configured remotes. Review parent-repository gitlink changes before committing.');
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(failure ? '[role=alert]' : '[data-submodule-sync]')?.focus());
  }

  shortOid(oid: string | null): string {
    return oid?.slice(0, 10) ?? 'Not recorded';
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
