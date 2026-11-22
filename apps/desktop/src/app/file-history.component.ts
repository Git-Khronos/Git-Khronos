import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, linkedSignal, output, viewChild } from '@angular/core';
import { HistorySearchService } from './history-search.service';

@Component({
  selector: 'gc-file-history',
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
      </div>
      <div class="history-list" tabindex="0" aria-label="File history commits">
        @for (entry of entries(); track entry.oid) {
          <article class="history-entry">
            <span class="history-avatar" [style.--author-color]="authorColor()(entry.authorName, entry.authorEmail)">{{ initials()(entry.authorName) }}</span>
            <div><button type="button" (click)="navigate.emit(entry)">{{ entry.subject }}</button><small>{{ entry.path }} · @if (entry.status === 'D') { Deleted · } {{ entry.authorName }} · {{ entry.authoredAt | date: 'MMM d, y, HH:mm' }}</small></div>
            <code>{{ entry.oid.slice(0, 8) }}</code>
          </article>
        } @empty {
          @if (owned() && history.fileComplete()) { <div class="file-insight-empty">No history was found for this file at the selected revision.</div> }
        }
      </div>
      <footer>
        <button #retryButton type="button" [disabled]="!owned() || history.fileBusy() || history.fileComplete()" (click)="history.nextFile()">{{ owned() && history.fileComplete() ? 'All available file history loaded' : history.fileError() ? 'Retry file history page' : 'Load older file history' }}</button>
        <button type="button" [disabled]="!canChangeStart()" title="Read history again from the selected starting point" (click)="history.reloadFile(revision(), path())">Reload file history</button>
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
    .history-entry:hover { background: var(--surface-hover); }
    .history-entry small, .file-insight-empty { color: var(--muted); }
    .history-feedback { padding: 8px 14px; }
    .history-start { color: var(--muted); }
    .history-start summary { cursor: pointer; overflow-wrap: anywhere; }
    .history-start form { display: grid; gap: 6px; margin: 8px 0; }
    .history-start label { display: grid; gap: 4px; color: var(--text); }
    .history-start input { min-width: 0; padding: 5px 8px; background: var(--surface); color: var(--text); border: 1px solid var(--border); font: inherit; }
    button { font: inherit; }
    .history-entry button { padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; font-weight: 600; cursor: pointer; }
    .history-entry button:hover { color: var(--accent); }
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
  readonly draft = linkedSignal({ source: () => [this.revision(), this.path()], computation: (): string => '' });
  private readonly injector = inject(Injector);
  private readonly retryButton = viewChild.required<ElementRef<HTMLButtonElement>>('retryButton');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');
  private wasBusy = false;

  applyStartingPoint(): void {
    if (this.canChangeStart()) void this.history.changeFileStartingPoint(this.revision(), this.path(), this.draft());
  }

  useDiffRevision(): void {
    if (!this.canChangeStart() || !this.alternateStart()) return;
    this.draft.set('');
    void this.history.changeFileStartingPoint(this.revision(), this.path(), this.revision());
  }

  constructor() {
    effect(() => {
      const busy = this.owned() && this.history.fileBusy();
      if (this.wasBusy && !busy && document.activeElement === this.cancelButton()?.nativeElement) {
        afterNextRender(() => {
          const button = this.retryButton().nativeElement;
          if (document.activeElement === document.body && !button.disabled && button.getClientRects().length) button.focus();
        }, { injector: this.injector });
      }
      this.wasBusy = busy;
    });
  }
}
