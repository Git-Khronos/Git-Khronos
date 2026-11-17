import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, viewChild } from '@angular/core';
import type { RecoveryHistoryView } from './app.component';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

// Recovery History is opened on demand, so its view lives in a lazy chunk. State and actions stay
// in AppComponent and arrive through the presenter, keeping keyboard and focus behaviour unchanged.
@Component({
  selector: 'gc-recovery-history-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TextValueDirective],
  template: `
    @let host = view();
    <div class="recovery-backdrop" [inert]="!!host.savedDiscards() || host.savedDiscardConfirmation()" (click)="host.closeRecoveryHistory()">
      <section class="recovery-dialog" role="dialog" aria-modal="true" aria-label="Recovery history" (click)="$event.stopPropagation()" (keydown)="host.handleRecoveryHistoryKeydown($event)">
        <header>
          <span class="recovery-mark"><gc-icon name="history" [size]="20" /></span>
          <div><small>LOCAL REPOSITORY</small><h2>Recovery History</h2><p>Find saved changes and commits recorded before a reference moved.</p></div>
          <button type="button" aria-label="Close recovery history" title="Close recovery history" (click)="host.closeRecoveryHistory()"><gc-icon name="x" [size]="14" /></button>
        </header>
        <div class="recovery-toolbar">
          <label><gc-icon name="search" [size]="14" /><input #recoverySearch type="search" aria-label="Search recovery history" placeholder="Search action, author, SHA, or reflog selector" [gcTextValue]="host.recoveryQuery()" (gcTextValueChange)="host.recoveryQuery.set($event)" /></label>
          <button type="button" title="Refresh recovery history" aria-label="Refresh recovery history" [disabled]="host.git.reflogBusy() || host.git.busy() || host.recoveryCaptureBusy()" (click)="host.refreshRecoveryHistory()"><gc-icon name="refresh" [size]="13" /></button>
        </div>
        <div class="recovery-guidance"><gc-icon name="branch" [size]="15" /><span><strong>Preserve a commit safely.</strong> Creating a recovery branch keeps the selected commit reachable without moving your current branch or changing working files.</span></div>
        <div class="recovery-list" aria-live="polite">
          <section class="operation-captures" aria-label="Discarded changes">
            <h3>Discarded changes</h3>
            <p>Recover working changes or untracked files saved before discarding.</p>
            <div class="capture-actions"><button type="button" [disabled]="host.git.busy() || host.recoveryCaptureBusy()" (click)="host.openSavedDiscardsFromHistory($event)">Open discarded-change recovery…</button></div>
            @if (host.savedDiscardsLoading()) { <p role="status">Reading discarded-change captures…</p> }
          </section>
          <section class="operation-captures" aria-label="Saved operation captures">
            <h3>Saved operation captures</h3>
            <p>Restore saved history and any captured changes on a new branch. Captures stay protected until you remove them. Reset captures exclude untracked, ignored and submodule files; deleted stashes keep everything the stash saved.</p>
            @if (host.recoveryCaptureBusy()) { <p role="status">Reading saved captures...</p> }
            @if (host.git.error()) { <p class="recovery-error" role="alert" tabindex="-1">{{ host.git.error() }}</p> }
            @for (record of host.filteredOperationRecoveries(); track record.id) {
              <article class="operation-capture" [attr.data-capture-id]="record.id">
                <strong>{{ record.label }}</strong>
                <small><code>{{ host.shortOid(record.headOid) }}</code> · {{ record.snapshotOid ? 'History and tracked contents' : 'History only; no tracked changes' }} · {{ record.restored ? 'Previously restored' : 'Saved' }}</small>
                <div class="capture-actions">
                  <button type="button" data-capture-action="restore" [disabled]="host.git.busy() || host.recoveryCaptureBusy()" (click)="host.beginRecoveryCaptureAction(record, 'restore')">Restore on new branch...</button>
                  <button type="button" data-capture-action="remove" [disabled]="host.git.busy() || host.recoveryCaptureBusy()" (click)="host.beginRecoveryCaptureAction(record, 'remove')">Remove capture...</button>
                </div>
                @if (host.recoveryCaptureAction(); as action) {
                  @if (action.record.id === record.id) {
                    <form novalidate class="recovery-capture-form" (submit)="$event.preventDefault(); host.confirmRecoveryCaptureAction()">
                      @if (action.kind === 'restore') {
                        <label>Recovery branch name<input name="recoveryCaptureBranch" autocomplete="off" [disabled]="host.git.busy()" [gcTextValue]="host.recoveryCaptureBranch()" (gcTextValueChange)="host.recoveryCaptureBranch.set($event)" /></label>
                        <p>This switches to the new branch and restores the saved index and working contents. Your current repository must be clean.</p>
                        @if (host.git.repository()?.status?.entryCount) { <p>Save current changes before restoring this capture.</p> }
                      } @else {
                        <p>Permanently remove this capture and its protected references? Current branches and files remain unchanged, but unsaved captured contents may become unrecoverable.</p>
                      }
                      <div class="capture-actions">
                        <button type="button" data-capture-cancel [disabled]="host.git.busy()" (click)="host.cancelRecoveryCaptureAction()">Cancel</button>
                        <button type="submit" [disabled]="host.git.busy() || host.recoveryCaptureBusy() || (action.kind === 'restore' && (!host.recoveryCaptureBranch().trim() || !!host.git.repository()?.status?.entryCount))">{{ action.kind === 'restore' ? 'Restore and switch' : 'Permanently remove capture' }}</button>
                      </div>
                    </form>
                  }
                }
              </article>
            } @empty {
              @if (host.operationRecoveries() && !host.recoveryCaptureBusy()) { <p>{{ host.recoveryQuery().trim() ? 'No matching saved captures.' : 'No saved operation captures. Reset, branch deletion and stash deletion create one before changing references.' }}</p> }
            }
          </section>
          @if (host.git.reflogBusy() && !host.git.reflog()) {
            <div class="recovery-empty"><gc-icon name="refresh" [size]="24" /><strong>Reading local history…</strong></div>
          } @else {
            @for (entry of host.filteredRecoveryEntries(); track entry.selector + entry.oid) {
              <article class="recovery-entry" [class.branching]="host.recoveryBranchEntry()?.selector === entry.selector && host.recoveryBranchEntry()?.oid === entry.oid">
                <span class="recovery-node"><gc-icon name="git-commit" [size]="13" /></span>
                <div class="recovery-copy"><strong>{{ entry.subject }}</strong><small>{{ entry.authorName }} · {{ entry.selector }}</small></div>
                <code title="{{ entry.oid }}">{{ host.shortOid(entry.oid) }}</code>
                <div class="recovery-actions">
                  @if (host.recoveryEntryInGraph(entry)) { <button type="button" (click)="host.viewRecoveryEntry(entry)">View in graph</button> }
                  <button type="button" title="Copy full commit SHA" (click)="host.copyRecoveryOid(entry)"><gc-icon name="copy" [size]="12" />Copy SHA</button>
                  <button class="primary" type="button" [disabled]="host.git.busy()" (click)="host.beginRecoveryBranch(entry)"><gc-icon name="branch" [size]="12" />Create branch</button>
                </div>
                @if (host.recoveryBranchEntry()?.selector === entry.selector && host.recoveryBranchEntry()?.oid === entry.oid) {
                  <form novalidate class="recovery-branch-form" (submit)="$event.preventDefault(); host.createRecoveryBranch()">
                    <label>New branch name<input name="recoveryBranchName" autocomplete="off" [disabled]="host.git.busy()" [attr.aria-invalid]="host.recoveryBranchError() ? 'true' : null" [attr.aria-describedby]="host.recoveryBranchError() ? 'recovery-branch-error' : null" [gcTextValue]="host.recoveryBranchName()" (gcTextValueChange)="host.recoveryBranchName.set($event); host.recoveryBranchError.set(null)" /></label>
                    <button type="button" [disabled]="host.git.busy()" (click)="host.recoveryBranchEntry.set(null); host.recoveryBranchName.set(''); host.recoveryBranchError.set(null)">Cancel</button>
                    <button class="primary" type="submit" [disabled]="!host.recoveryBranchName().trim() || host.git.busy()">Create at {{ host.shortOid(entry.oid) }}</button>
                    @if (host.recoveryBranchError()) { <p id="recovery-branch-error" class="recovery-branch-error" role="alert">{{ host.recoveryBranchError() }}</p> }
                  </form>
                }
              </article>
            } @empty {
              <div class="recovery-empty"><gc-icon name="history" [size]="25" /><strong>{{ host.recoveryQuery().trim() ? 'No matching recovery entries' : 'No recovery history found' }}</strong><small>{{ host.recoveryQuery().trim() ? 'Try another action, author, SHA, or selector.' : 'Git has not recorded any local reference movements yet.' }}</small></div>
            }
          }
        </div>
        <footer><span>{{ host.filteredRecoveryEntries().length }} shown @if (host.git.reflog()?.truncated) { · newest 250 entries }</span><button type="button" (click)="host.closeRecoveryHistory()">Close</button></footer>
      </section>
    </div>
  `,
  styles: `
    .capture-actions button { min-height: 28px; padding: 5px 9px; border: 1px solid var(--graph-menu-border); border-radius: 3px; background: var(--graph-menu-surface); color: var(--text); }
    .operation-captures { padding: 12px; border-bottom: 1px solid var(--graph-menu-border); color: var(--text); }
    .operation-captures h3 { margin: 0 0 8px; font-size: 14px; }
    .operation-captures p, .operation-capture small { font-size: 12px; line-height: 1.5; }
    .operation-capture { display: grid; gap: 8px; padding: 12px 0; overflow-wrap: anywhere; border-top: 1px solid var(--graph-menu-border); }
    .capture-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .recovery-capture-form { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--graph-menu-border); }
    .recovery-capture-form label { display: grid; gap: 6px; font-size: 12px; }
    .recovery-capture-form input { min-width: 0; padding: 7px; background: var(--graph-menu-surface); color: var(--text); border: 1px solid var(--graph-menu-border); }
    .recovery-error { color: var(--danger, #ef9cab); overflow-wrap: anywhere; }
  `,
})
export class RecoveryHistoryDialogComponent {
  readonly view = input.required<RecoveryHistoryView>();
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('recoverySearch');

  constructor() {
    afterNextRender(() => this.search()?.nativeElement.focus());
  }
}
