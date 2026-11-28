import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, linkedSignal, output, viewChild } from '@angular/core';
import { HistorySearchService } from './history-search.service';

@Component({
  selector: 'gk-file-history',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="file-insight-panel history-insight" aria-label="File history" [attr.aria-busy]="!owned() || history.fileBusy()">
      <header><div><strong>File History</strong><small>{{ path() }} · renamed paths followed</small></div>
        <b>{{ owned() ? history.files().length : 0 }} {{ owned() && history.files().length === 1 ? 'commit' : 'commits' }}{{ owned() && history.fileComplete() ? ' · complete' : ' · incomplete' }}</b></header>
      <div class="history-feedback">
        <details class="history-start">
          <summary [title]="startingPoint() ?? ''">Starting point: {{ alternateStart() ? startingPoint() : 'Diff revision' }}</summary>
          <form (submit)="$event.preventDefault(); applyStartingPoint()">
            <label>
              <span>Branch, tag or commit</span>
              <input type="text" autocomplete="off" spellcheck="false" placeholder="e.g. release/1.0"
                aria-describedby="file-history-ref-note" [value]="draft()" (input)="draft.set($any($event.target).value)">
            </label>
            <small id="file-history-ref-note">Searches local history without switching branches or fetching.</small>
            <div class="history-start-actions">
              <button type="submit" [attr.aria-disabled]="!canChangeStart() || !draft().trim() ? 'true' : null">Search from revision</button>
              <button type="button" [attr.aria-disabled]="!canChangeStart() || !alternateStart() ? 'true' : null"
                (click)="useDiffRevision()">Use diff revision</button>
            </div>
          </form>
        </details>
        @if (!owned() || history.fileBusy()) {
          <small role="status">{{ owned() && history.fileCancelling() ? 'Stopping file history…' : owned() && history.fileCancellationRequested() ? 'Cancellation not confirmed. Retry, or wait for the read to finish.' : 'Reading file history…' }}</small>
        }
        @if (owned() && history.fileError()) { <p role="alert">{{ history.fileError() }}</p> }
        <div class="copy-feedback" role="status" aria-atomic="true">{{ copyAnnouncement() }}</div>
      </div>
      <div class="history-list" tabindex="0" aria-label="File history commits">
        @for (entry of entries(); track entry.oid) {
          <article class="history-entry">
            <span class="history-avatar" [style.--author-color]="authorColor()(entry.authorName, entry.authorEmail)">{{ initials()(entry.authorName) }}</span>
            <div>
              <button class="history-subject" type="button" [title]="entry.subject" (click)="navigate.emit(entry)">{{ entry.subject }}</button>
              <small>{{ entry.path }} · @if (entry.status === 'D') { Deleted · } {{ entry.authorName }} · {{ entry.authoredAt | date: 'MMM d, y, HH:mm' }}</small>
              @if (entry.previousPath && entry.previousPath !== entry.path) {
                <button class="copy-history-previous-path" type="button" [attr.aria-label]="'Copy previous path: ' + entry.previousPath"
                  [title]="'Copy previous path: ' + entry.previousPath"
                  (click)="copyEntryValue(entry.oid, entry.previousPath, 'previous path')">Previous path: {{ entry.previousPath }}</button>
              }
            </div>
            <button class="copy-history-path" type="button" [attr.aria-label]="'Copy path: ' + entry.path" [title]="'Copy path: ' + entry.path"
              (click)="copyEntryValue(entry.oid, entry.path, 'file path')">Copy path</button>
            <button class="copy-history-commit" type="button"
              [attr.aria-label]="'Copy commit ID: ' + entry.oid.slice(0, 8)" title="Copy full commit ID"
              (click)="copyEntryValue(entry.oid, entry.path, 'commit ID')"><code>{{ entry.oid.slice(0, 8) }}</code></button>
          </article>
        } @empty {
          @if (owned() && history.fileComplete()) { <div class="file-insight-empty">No history was found for this file at the selected revision.</div> }
        }
      </div>
      <footer>
        <button #retryButton type="button" [attr.aria-disabled]="canLoadMore() ? null : 'true'" (click)="loadMore()">{{ owned() && history.fileComplete() ? 'All available file history loaded' : owned() && history.fileError() ? 'Retry file history page' : 'Load older file history' }}</button>
        <button #reloadButton type="button" [attr.aria-disabled]="canChangeStart() ? null : 'true'" title="Read history again from the selected starting point" (click)="reload()">Reload file history</button>
        @if (owned() && history.fileBusy()) {
          <button #cancelButton type="button" [attr.aria-disabled]="history.fileCancelling() ? 'true' : null"
            (click)="!history.fileCancelling() && history.cancelFile()">{{ history.fileCancelling() ? 'Stopping…' : history.fileCancellationRequested() ? 'Retry cancellation' : 'Cancel file history' }}</button>
        }
      </footer>
    </section>
  `,
  styles: `
    :host { display: contents; }
    .history-insight { grid-template-rows: 46px auto minmax(0, 1fr) auto; background: var(--surface); color: var(--text); font-size: var(--font-size-body); }
    .history-insight > header { background: var(--surface-raised); border-color: var(--border); }
    .history-insight > header strong { color: var(--text); }
    .history-insight > header b { background: var(--surface); color: var(--muted); }
    .history-entry { border-color: var(--border); }
    .history-entry { grid-template-columns: 29px minmax(0, 1fr) max-content 78px; }
    .history-entry:hover { background: var(--surface-hover); }
    .history-entry small, .file-insight-empty { color: var(--muted); }
    .history-feedback { padding: 8px 14px; }
    .copy-feedback { color: var(--text); overflow-wrap: anywhere; }
    .copy-feedback:not(:empty) { margin-top: 6px; }
    .history-start { color: var(--muted); }
    .history-start summary { cursor: pointer; overflow-wrap: anywhere; }
    .history-start form { display: grid; gap: 6px; margin: 8px 0; }
    .history-start label { display: grid; gap: 4px; color: var(--text); }
    .history-start input { min-width: 0; padding: 5px 8px; background: var(--surface); color: var(--text); border: 1px solid var(--border); font: inherit; }
    button { font: inherit; }
    .history-entry button { padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; font-weight: 600; cursor: pointer; }
    .history-entry button:hover { color: var(--accent); }
    .history-entry :is(.history-subject, .copy-history-previous-path) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .history-entry .copy-history-previous-path { min-height: 24px; color: var(--muted); font-size: var(--font-size-caption); }
    .history-entry .copy-history-previous-path:hover { color: var(--accent); }
    .history-entry :is(.copy-history-path, .copy-history-commit) { min-height: 28px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); color: var(--text); font-size: var(--font-size-caption); white-space: nowrap; }
    .history-entry :is(.copy-history-path, .copy-history-commit):hover { background: var(--surface-hover); }
    .history-entry .copy-history-commit { text-align: center; }
    p { margin: 6px 0 0; color: var(--danger); overflow-wrap: anywhere; }
    .history-start-actions, footer { display: flex; flex-wrap: wrap; gap: 8px; }
    footer { padding: 8px 14px; border-top: 1px solid var(--border); }
    .history-start button, footer button { min-height: 28px; padding: 4px 8px; background: var(--surface); color: var(--text); border: 1px solid var(--border); cursor: pointer; }
    button:disabled, button[aria-disabled=true] { opacity: .5; cursor: default; }
    button:focus-visible, summary:focus-visible, input:focus-visible, .history-list:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class FileHistoryComponent {
  readonly history = inject(HistorySearchService);
  readonly path = input.required<string>();
  readonly revision = input.required<string>();
  readonly authorColor = input.required<(name: string, email: string) => string>();
  readonly initials = input.required<(name: string) => string>();
  readonly navigate = output<{ oid: string; path: string; previousPath?: string | null; status?: string | null }>();
  readonly owned = computed(() => this.history.matchesFile(this.revision(), this.path()));
  readonly entries = computed(() => this.owned() ? this.history.files() : []);
  readonly startingPoint = computed(() => this.history.fileStartingPoint(this.revision(), this.path()));
  readonly alternateStart = computed(() => this.startingPoint() !== null && this.startingPoint() !== this.revision());
  readonly canChangeStart = computed(() => this.owned() && (!this.history.fileBusy() || this.history.fileCancellationRequested()));
  readonly canLoadMore = computed(() => this.owned() && !this.history.fileBusy() && !this.history.fileComplete());
  private readonly copyContext = computed(() => ({
    revision: this.revision(), path: this.path(), start: this.startingPoint(),
  }));
  readonly copyAnnouncement = linkedSignal({ source: this.copyContext, computation: (): string => '' });
  readonly draft = linkedSignal({ source: () => [this.revision(), this.path()], computation: (): string => '' });
  private readonly injector = inject(Injector);
  private readonly retryButton = viewChild.required<ElementRef<HTMLButtonElement>>('retryButton');
  private readonly reloadButton = viewChild.required<ElementRef<HTMLButtonElement>>('reloadButton');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private wasBusy = false;
  private copyGeneration = 0;

  // Keep the active control focusable while a read is pending. A disabled
  // native button would drop keyboard focus before the next page arrives.
  loadMore(): void {
    if (this.canLoadMore()) void this.history.nextFile();
  }

  reload(): void {
    if (this.canChangeStart()) void this.history.reloadFile(this.revision(), this.path());
  }

  applyStartingPoint(): void {
    if (this.canChangeStart()) void this.history.changeFileStartingPoint(this.revision(), this.path(), this.draft());
  }

  useDiffRevision(): void {
    if (!this.canChangeStart() || !this.alternateStart()) return;
    this.draft.set('');
    void this.history.changeFileStartingPoint(this.revision(), this.path(), this.revision());
  }

  async copyEntryValue(oid: string, path: string, kind: 'file path' | 'previous path' | 'commit ID'): Promise<void> {
    const context = this.copyContext();
    const hasEntry = () => this.entries().some(entry => entry.oid === oid
      && (kind === 'previous path' ? entry.previousPath === path && entry.path !== path : entry.path === path));
    if (!this.owned() || !hasEntry()) return;
    const generation = ++this.copyGeneration;
    const current = () => generation === this.copyGeneration && this.owned()
      && this.copyContext() === context && hasEntry();
    this.copyAnnouncement.set('');
    const value = kind === 'commit ID' ? oid : path;
    try {
      await navigator.clipboard.writeText(value);
      if (current()) this.copyAnnouncement.set(`Copied ${kind}: ${value}`);
    } catch {
      if (current()) this.copyAnnouncement.set(`Could not copy ${kind}: ${value}. Clipboard access is unavailable.`);
    }
  }

  constructor() {
    effect(() => {
      const busy = this.owned() && this.history.fileBusy();
      const cancel = this.cancelButton()?.nativeElement;
      if (this.wasBusy && !busy && this.owned() && cancel && document.activeElement === cancel) {
        const context = this.copyContext();
        afterNextRender(() => {
          if (cancel.isConnected || document.activeElement !== document.body ||
            this.copyContext() !== context || !this.owned() || this.history.fileBusy()) return;
          const button = (this.canLoadMore() ? this.retryButton() : this.reloadButton()).nativeElement;
          if (button.getClientRects().length) button.focus();
        }, { injector: this.injector });
      }
      this.wasBusy = busy;
    });
  }
}
