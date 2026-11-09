import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ipc } from '@git-khronos/contracts';
import type { FetchOptions, ShallowHistoryState } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';

export interface FetchDialogRequest {
  repositoryId: string;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-fetch-options-dialog',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="close()">
        <form #dialog role="dialog" aria-modal="true" aria-labelledby="fetch-options-title" aria-describedby="fetch-options-scope"
          (click)="$event.stopPropagation()" (submit)="$event.preventDefault(); confirm()" (keydown)="handleKey($event)">
          <h2 id="fetch-options-title">Fetch branches with options</h2>
          <p id="fetch-options-scope">Download branch tips into remote-tracking branches. Local branches, tags, index and working files are unchanged.</p>
          @if (target.repositoryId !== git.activeRepositoryId()) {
            <p role="alert">The active repository changed. Close this dialog and review the intended repository.</p>
          }
          @if (!git.repository()?.remotes?.length) {
            <p role="alert">No remotes are configured. Close this dialog and add a remote before fetching.</p>
          }
          <label for="fetch-options-remote">Fetch from</label>
          <select id="fetch-options-remote" name="fetchRemote" [disabled]="git.busy()"
            [ngModel]="remote()" (ngModelChange)="remote.set($event)">
            <option value="">All configured remotes</option>
            @for (candidate of git.repository()?.remotes ?? []; track candidate.name) {
              <option [value]="candidate.name">{{ candidate.name }}</option>
            }
          </select>
          @if (remote()) {
            <p class="destination">Fetch URL: {{ fetchUrl() }}</p>
          } @else {
            <p>Each remote is fetched separately. If a later remote fails or you cancel, earlier remotes may already be updated.</p>
          }
          <label class="checkbox"><input type="checkbox" name="pruneRemoteBranches" [disabled]="git.busy()"
            [ngModel]="prune()" (ngModelChange)="prune.set($event)" />Remove stale remote-tracking branches</label>
          <p>Pruning removes only cached branch references no longer advertised by the chosen remote(s), not branches on the server.</p>
          @if (shallow(); as state) {
            <fieldset [disabled]="git.busy()">
              <legend>History depth</legend>
              <p id="fetch-history-scope">This repository has shallow history: older commits are missing behind {{ state.boundaryCommits }} boundary commit{{ state.boundaryCommits === 1 ? '' : 's' }}. Extending it downloads more commits from one remote; files and branches are unchanged.</p>
              <label class="checkbox"><input type="radio" name="fetchHistory" value="keep" [ngModel]="history()" (ngModelChange)="history.set($event)" />Keep the current depth</label>
              <label class="checkbox"><input type="radio" name="fetchHistory" value="deepen" [ngModel]="history()" (ngModelChange)="history.set($event)" />Deepen by
                <input type="number" name="deepenCommits" min="1" [attr.max]="1000000" aria-label="Commits to deepen by" [disabled]="history() !== 'deepen'"
                  [ngModel]="commits()" (ngModelChange)="commits.set($event)" /> commits</label>
              <label class="checkbox"><input type="radio" name="fetchHistory" value="complete" [ngModel]="history()" (ngModelChange)="history.set($event)" />Download complete history</label>
              @if (history() !== 'keep' && !remote()) { <p role="alert">Choose one remote to extend history.</p> }
              @if (history() === 'deepen' && !validCommits()) { <p role="alert">Enter a whole number from 1 to 1,000,000.</p> }
              @if (history() === 'complete') { <p>Complete history can be large. If the chosen remote is itself shallow, Git Khronos reports that history is still incomplete.</p> }
            </fieldset>
          }
          <details><summary>Advanced scope</summary><p>This uses a standard branch-only mapping, not custom fetch refspecs or mirror settings. It never fetches or prunes tags and never updates submodule working trees. Shared tracking destinations are refused; symbolic destinations are checked.</p></details>
          @if (cancelled()) { <p role="status" tabindex="-1">Fetch was cancelled. Earlier remotes may already be updated. Review the refreshed graph before retrying.</p> }
          @if (git.error()) { <p role="alert" tabindex="-1">{{ git.error() }}</p> }
          <gc-git-help topic="fetch" label="Learn about fetch and remote-tracking pruning…" />
          <footer>
            @if (git.busy() && git.activeActivity()?.operationId) { <button type="button" [disabled]="git.activeOperationCancelling()" (click)="git.cancelActiveOperation()">Cancel operation</button> }
            <button type="button" data-fetch-cancel [disabled]="git.busy()" (click)="close()">Cancel</button>
            <button type="submit" [disabled]="git.busy() || !git.repository()?.remotes?.length || target.repositoryId !== git.activeRepositoryId() || !historyReady()">{{ history() === 'keep' ? 'Fetch branches' : 'Fetch and extend history' }}</button>
          </footer>
        </form>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: #080811b8; }
    form { width: min(520px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p, details { font-size: 13px; line-height: 1.5; }
    .destination { overflow-wrap: anywhere; }
    label { display: block; margin-top: 14px; font-size: 13px; }
    .checkbox { display: flex; gap: 8px; align-items: center; min-height: 28px; }
    fieldset { margin: 14px 0 0; padding: 10px 12px; border: 1px solid var(--inspector-divider); border-radius: 5px; }
    legend { font-size: 13px; font-weight: 600; }
    input[type=number] { width: 9ch; padding: 4px 6px; background: var(--inspector-row); color: var(--text); border: 1px solid var(--inspector-divider); }
    select { width: 100%; padding: 8px; background: var(--inspector-row); color: var(--text); border: 1px solid var(--inspector-divider); }
    footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    button:disabled, select:disabled, input:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class FetchOptionsDialogComponent {
  readonly git = inject(GitKhronosService);
  readonly request = input<FetchDialogRequest | null>(null);
  readonly closed = output<void>();
  readonly remote = signal('');
  readonly prune = signal(false);
  readonly cancelled = signal(false);
  readonly shallow = signal<ShallowHistoryState | null>(null);
  readonly history = signal<'keep' | 'deepen' | 'complete'>('keep');
  readonly commits = signal(50);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    effect(() => {
      const request = this.request();
      if (!request) return;
      this.remote.set(untracked(() => this.git.repository()?.remotes[0]?.name ?? ''));
      this.prune.set(false);
      this.cancelled.set(false);
      this.shallow.set(null);
      this.history.set('keep');
      this.commits.set(50);
      // Best effort: without this state the dialog keeps the ordinary branch fetch only.
      ipc.shallow_history_state({ repoId: request.repositoryId })
        .then((state) => { if (this.request() === request && state.shallow) this.shallow.set(state); }, () => undefined);
      setTimeout(() => {
        if (this.request() === request) this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-fetch-cancel]')?.focus();
      });
    });
  }

  fetchUrl(): string {
    return this.git.repository()?.remotes.find((remote) => remote.name === this.remote())?.fetchUrl ?? 'Remote no longer configured';
  }

  validCommits(): boolean {
    const commits = Number(this.commits());
    return Number.isInteger(commits) && commits >= 1 && commits <= 1_000_000;
  }

  historyReady(): boolean {
    const history = this.history();
    return history === 'keep' || (!!this.remote() && (history === 'complete' || this.validCommits()));
  }

  async confirm(): Promise<void> {
    const request = this.request();
    if (!request || this.git.busy() || !this.historyReady()) return;
    this.cancelled.set(false);
    const options: FetchOptions = { remote: this.remote() || null, prune: this.prune() };
    const history = this.shallow() ? this.history() : 'keep';
    if (history === 'deepen') options.history = { mode: 'deepen', commits: Number(this.commits()) };
    if (history === 'complete') options.history = { mode: 'complete' };
    const result = await this.git.fetchBranches(options, request.repositoryId);
    if (this.request() !== request) return;
    if (result === 'success') this.close();
    else {
      this.cancelled.set(result === 'cancelled');
      setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[role=alert],[role=status]')?.focus());
    }
  }

  close(): void {
    if (this.git.busy()) return;
    const opener = this.request()?.returnFocus;
    this.closed.emit();
    setTimeout(() => { if (opener?.isConnected) opener.focus(); });
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>(
      'button:not(:disabled),select:not(:disabled),input:not(:disabled),summary') ?? [])]
      .filter((element) => element.getClientRects().length);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
