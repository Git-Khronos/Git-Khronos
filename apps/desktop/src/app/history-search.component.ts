import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { HistoryQuery } from '@git-khronos/contracts';
import { HistorySearchService, emptyHistoryQuery } from './history-search.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'gc-history-search',
  imports: [FormsModule, DatePipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog id="repository-history-dialog" aria-labelledby="history-search-heading" (close)="closed()">
      <div class="dialog-shell">
        <header class="dialog-header">
          <span class="heading-icon" aria-hidden="true"><gc-icon name="search" [size]="18" /></span>
          <div class="heading-copy">
            <h2 id="history-search-heading">Search repository history</h2>
            <p>Find commits beyond the history currently loaded in the graph.</p>
          </div>
          <button class="icon-button close-button" type="button" aria-label="Close history search" title="Close" (click)="close()">
            <gc-icon name="x" [size]="17" />
          </button>
        </header>

        <div class="dialog-body">
          <section class="search-section" aria-label="Repository history search">
            <form class="search-form" (ngSubmit)="history.search(query)">
              <div class="primary-query">
                <label class="message-field" for="history-message">Message contains</label>
                <div class="search-control">
                  <gc-icon name="search" [size]="16" />
                  <input #messageInput id="history-message" name="message" [(ngModel)]="query.message"
                    autocomplete="off" placeholder="Commit subject or description" />
                </div>
                <button class="primary-action" type="submit" aria-label="Search repository" [disabled]="history.busy()">
                  @if (history.busy()) { Searching… } @else { Search repository }
                </button>
              </div>

              <details class="advanced-filters">
                <summary>
                  <span class="summary-label"><gc-icon name="settings" [size]="15" />Advanced filters</span>
                  @if (activeFilterCount()) { <span class="filter-count">{{ activeFilterCount() }} active</span> }
                  <gc-icon class="disclosure-icon" name="chevron-down" [size]="15" />
                </summary>
                <div class="filters">
                  <label>Author name/email contains<input name="author" [(ngModel)]="query.author" autocomplete="off" /></label>
                  <label>Commit ID prefix<input name="oid" [(ngModel)]="query.oid" autocomplete="off" spellcheck="false" /></label>
                  <label>Author date from<input name="since" type="date" [(ngModel)]="query.since" /></label>
                  <label>Author date through<input name="until" type="date" [(ngModel)]="query.until" /></label>
                  <label>Repository-relative path<input name="path" [(ngModel)]="query.path" autocomplete="off" spellcheck="false" /></label>
                  <label>Ref or A..B range<input name="scope" [(ngModel)]="query.scope" autocomplete="off" spellcheck="false" placeholder="All refs and HEAD" /></label>
                </div>
                <div class="filter-footer">
                  <p>Text matching is case-insensitive. Dates include their full calendar day.</p>
                  @if (activeFilterCount()) {
                    <button class="quiet-action" type="button" [disabled]="history.busy()" (click)="clearAdvancedFilters()">Clear filters</button>
                  }
                </div>
              </details>

              <div class="search-guidance">
                <gc-icon name="history" [size]="15" />
                <span>Search includes hidden branches and pins current refs until you start a new search.</span>
              </div>

              @if (history.busy()) {
                <div class="search-progress" role="status" aria-live="polite">
                  <span class="progress-indicator" aria-hidden="true"></span>
                  <span>{{ history.status() }}</span>
                  <button class="quiet-action" type="button" (click)="history.cancel()">Cancel history search</button>
                </div>
              } @else if (history.status()) {
                <p class="search-status" role="status" aria-live="polite">{{ history.status() }}</p>
              }
            </form>

            @if (history.error()) {
              <div class="feedback error-feedback" role="alert">
                <gc-icon name="warning" [size]="17" />
                <span>{{ history.error() }}</span>
              </div>
            }

            @if (history.entries().length) {
              <div class="results-heading">
                <div><h3>Commits</h3><span>{{ history.entries().length }} {{ history.entries().length === 1 ? 'result' : 'results' }}</span></div>
                @if (!history.complete()) { <span class="incomplete-badge">Search incomplete</span> }
              </div>
            }

            <div class="results" [attr.aria-busy]="history.busy()" aria-label="History search results">
              @for (entry of history.entries(); track entry.oid) {
                <button class="result-row" type="button" (click)="selectCommit(entry.oid)" [title]="entry.oid">
                  <span class="commit-mark" aria-hidden="true"><gc-icon name="git-commit" [size]="16" /></span>
                  <span class="result-copy">
                    <span class="result-subject">{{ entry.subject }}</span>
                    <span class="result-meta">
                      <code>{{ entry.oid.slice(0, 8) }}</code><span>{{ entry.authorName }}</span>
                      <time [attr.datetime]="entry.authoredAt">{{ entry.authoredAt | date:'mediumDate' }}</time>
                    </span>
                  </span>
                  <gc-icon class="result-arrow" name="chevron-right" [size]="16" />
                </button>
              }
            </div>

            @if (!history.complete() && !history.busy() && (history.cursor() || history.error())) {
              <button class="load-more" type="button" (click)="history.next()">
                <gc-icon name="history" [size]="15" />
                {{ history.error() ? 'Retry history page' : 'Continue searching older history' }}
              </button>
            }
            @if (history.complete() && !history.entries().length) {
              <div class="empty-state">
                <span class="empty-icon" aria-hidden="true"><gc-icon name="search" [size]="22" /></span>
                <div><strong>No matching commits in the selected history.</strong><p>Try fewer filters, a broader revision range, or a shorter message.</p></div>
              </div>
            }
          </section>

          <details class="comparison-section">
            <summary>
              <span class="summary-label"><gc-icon name="merge" [size]="15" />Compare two revisions</span>
              <span class="summary-hint">Open a focused file comparison</span>
              <gc-icon class="disclosure-icon" name="chevron-down" [size]="15" />
            </summary>
            <form (ngSubmit)="compare()">
              <fieldset>
                <legend>Revision comparison</legend>
                <div class="comparison-grid">
                  <label>Base ref or commit<input name="base" [(ngModel)]="base" autocomplete="off" spellcheck="false" /></label>
                  <span class="comparison-arrow" aria-hidden="true"><gc-icon name="chevron-right" [size]="17" /></span>
                  <label>Target ref or commit<input name="target" [(ngModel)]="target" autocomplete="off" spellcheck="false" /></label>
                </div>
                <div class="comparison-options">
                  <label>Comparison mode<select name="mode" [(ngModel)]="mode">
                    <option value="direct">Direct tips: base → target</option>
                    <option value="mergeBase">Merge base → target</option>
                  </select></label>
                  <p>Direct compares both trees. Merge base shows target changes since the common ancestor.</p>
                </div>
                @if (comparisonError()) {
                  <div class="feedback error-feedback" role="alert"><gc-icon name="warning" [size]="17" /><span>{{ comparisonError() }}</span></div>
                }
                <div class="comparison-actions">
                  <button class="primary-action" type="submit" [disabled]="comparing() || !base || !target">
                    @if (comparing()) { Comparing… } @else { Compare revisions }
                  </button>
                </div>
              </fieldset>
            </form>
          </details>
        </div>
      </div>
    </dialog>
  `,
  styles: [`
    :host { display: contents; }
    dialog {
      width: min(780px, calc(100vw - 40px)); max-width: none; max-height: min(820px, calc(100vh - 48px));
      overflow: hidden; color: var(--text); background: var(--overlay-surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 0; box-shadow: 0 24px 70px rgb(0 0 0 / .42), 0 2px 10px rgb(0 0 0 / .24);
    }
    dialog::backdrop { background: rgb(4 8 16 / .68); backdrop-filter: blur(2px); }
    .dialog-shell { display: grid; grid-template-rows: auto minmax(0, 1fr); max-height: inherit; min-height: 0; }
    .dialog-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 68px; padding: 12px 16px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--overlay-surface) 90%, var(--surface)); }
    .heading-icon, .empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 8px; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
    .heading-copy { min-width: 0; }
    h2 { margin: 0; font-size: 16px; line-height: 1.35; font-weight: 650; }
    .heading-copy p { margin: 2px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .dialog-body { overflow: auto; overscroll-behavior: contain; padding: 16px; scrollbar-gutter: stable; }
    .search-section, .search-form { display: grid; gap: 12px; }
    .search-form { gap: 10px; }
    .primary-query { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
    .message-field { grid-column: 1 / -1; color: var(--muted); font-size: 12px; font-weight: 650; letter-spacing: .02em; }
    .search-control { position: relative; min-width: 0; }
    .search-control > gc-icon { position: absolute; left: 10px; top: 50%; color: var(--muted); transform: translateY(-50%); pointer-events: none; }
    .search-control input { width: 100%; padding-left: 34px; }
    input, select, button { font: inherit; color: inherit; }
    input, select { box-sizing: border-box; min-width: 0; min-height: 34px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; background: var(--surface); }
    input::placeholder { color: color-mix(in srgb, var(--muted) 78%, transparent); }
    input:hover, select:hover { border-color: color-mix(in srgb, var(--text) 28%, var(--border)); }
    button { border: 0; background: transparent; cursor: pointer; }
    button:disabled { opacity: .48; cursor: default; }
    :is(input, select, button, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .primary-action { min-height: 34px; border: 1px solid color-mix(in srgb, var(--accent) 70%, var(--border)); border-radius: 6px; padding: 6px 14px; color: var(--on-accent, #fff); background: var(--accent); font-weight: 650; white-space: nowrap; }
    .primary-action:not(:disabled):hover { filter: brightness(1.08); }
    .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; color: var(--muted); }
    .icon-button:hover { color: var(--text); background: var(--hover); }
    details { min-width: 0; }
    summary { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px; min-height: 34px; cursor: pointer; list-style: none; border-radius: 5px; padding: 0 6px; }
    summary::-webkit-details-marker { display: none; }
    summary:hover { background: var(--hover); }
    .summary-label { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; font-weight: 650; }
    .summary-label gc-icon { color: var(--muted); }
    .disclosure-icon { color: var(--muted); transition: transform 120ms ease; }
    details[open] > summary .disclosure-icon { transform: rotate(180deg); }
    .filter-count, .incomplete-badge { border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border)); border-radius: 999px; padding: 2px 7px; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); font-size: 10px; font-weight: 650; white-space: nowrap; }
    .advanced-filters { border: 1px solid var(--border); border-radius: 7px; background: color-mix(in srgb, var(--surface) 45%, transparent); }
    .advanced-filters > summary { padding: 3px 10px; }
    .filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; padding: 12px 12px 10px; border-top: 1px solid var(--border); }
    .filters label, .comparison-grid label, .comparison-options label { display: grid; gap: 5px; min-width: 0; color: var(--muted); font-size: 12px; font-weight: 600; }
    .filter-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px 10px; }
    .filter-footer p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .quiet-action { min-height: 28px; border-radius: 5px; padding: 4px 8px; color: var(--accent); font-size: 12px; font-weight: 650; white-space: nowrap; }
    .quiet-action:hover { background: color-mix(in srgb, var(--accent) 11%, transparent); }
    .search-guidance { display: flex; align-items: flex-start; gap: 8px; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .search-guidance gc-icon { flex: 0 0 auto; margin-top: 1px; }
    .search-progress, .search-status { margin: 0; min-height: 28px; border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
    .search-progress { display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 9px; }
    .search-progress .quiet-action { margin-left: auto; }
    .search-status { display: flex; align-items: center; padding: 4px 9px; }
    .progress-indicator { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--accent) 28%, transparent); border-top-color: var(--accent); border-radius: 50%; animation: history-spin .7s linear infinite; }
    @keyframes history-spin { to { transform: rotate(360deg); } }
    .feedback { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 8px; border-radius: 7px; padding: 9px 10px; font-size: 12px; line-height: 1.45; }
    .error-feedback { border: 1px solid color-mix(in srgb, var(--danger, #d85b60) 52%, var(--border)); color: var(--text); background: color-mix(in srgb, var(--danger, #d85b60) 10%, transparent); }
    .error-feedback gc-icon { color: var(--danger, #d85b60); margin-top: 1px; }
    .results-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 2px; }
    .results-heading > div { display: flex; align-items: baseline; gap: 8px; }
    h3 { margin: 0; font-size: 12px; font-weight: 700; }
    .results-heading span { color: var(--muted); font-size: 11px; }
    .results { overflow: auto; display: grid; max-height: min(310px, 38vh); border: 1px solid var(--border); border-radius: 7px; background: var(--surface); }
    .results:empty { display: none; }
    .result-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 48px; padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--border); }
    .result-row:last-child { border-bottom: 0; }
    .result-row:hover { background: var(--hover); }
    .result-row:active { background: color-mix(in srgb, var(--accent) 9%, var(--hover)); }
    .commit-mark { display: inline-flex; color: var(--accent); }
    .result-copy { display: grid; gap: 3px; min-width: 0; }
    .result-subject { overflow: hidden; color: var(--text); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    .result-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; color: var(--muted); font-size: 11px; }
    .result-meta > * + *::before { content: '·'; margin-right: 5px; color: var(--border); }
    code { color: var(--accent); font-family: var(--font-mono, ui-monospace, monospace); font-size: inherit; }
    .result-arrow { color: var(--muted); }
    .load-more { display: inline-flex; align-items: center; justify-content: center; gap: 7px; width: 100%; min-height: 32px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--surface); font-size: 12px; font-weight: 650; }
    .load-more:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: var(--hover); }
    .empty-state { display: flex; align-items: center; gap: 12px; min-height: 74px; border: 1px dashed var(--border); border-radius: 7px; padding: 12px; }
    .empty-state strong { display: block; font-size: 12px; }
    .empty-state p { margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .comparison-section { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 10px; }
    .comparison-section > summary { padding: 2px 6px; }
    .summary-hint { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    fieldset { min-width: 0; margin: 10px 0 0; border: 1px solid var(--border); border-radius: 7px; padding: 12px; }
    legend { padding: 0 5px; color: var(--muted); font-size: 10px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; }
    .comparison-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 8px; }
    .comparison-arrow { display: inline-flex; align-items: center; justify-content: center; height: 34px; color: var(--muted); }
    .comparison-options { display: grid; grid-template-columns: minmax(190px, .65fr) minmax(0, 1fr); align-items: end; gap: 12px; margin-top: 10px; }
    .comparison-options p { margin: 0 0 2px; color: var(--muted); font-size: 10px; line-height: 1.45; }
    .comparison-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
    @media (max-width: 620px) {
      dialog { width: calc(100vw - 20px); max-height: calc(100vh - 20px); }
      .dialog-header { min-height: 62px; padding: 10px 12px; }
      .heading-copy p { display: none; }
      .dialog-body { padding: 12px; }
      .primary-query { grid-template-columns: 1fr; }
      .message-field { grid-column: auto; }
      .filters, .comparison-grid, .comparison-options { grid-template-columns: 1fr; }
      .comparison-arrow { display: none; }
      .filter-footer { align-items: flex-start; flex-direction: column; }
      .summary-hint { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .disclosure-icon { transition: none; }
      .progress-indicator { animation-duration: 1.4s; }
    }
  `],
})
export class HistorySearchComponent {
  readonly history = inject(HistorySearchService);
  readonly returnFocusFallback = input<HTMLElement | null>(null);
  readonly commitSelected = output<string>();
  readonly comparisonReady = output<void>();
  readonly opened = signal(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly messageInput = viewChild.required<ElementRef<HTMLInputElement>>('messageInput');
  private opener: HTMLElement | null = null;
  readonly comparing = signal(false);
  readonly comparisonError = signal<string | null>(null);
  private comparisonRequest = 0;
  query = emptyHistoryQuery();
  base = 'HEAD~1';
  target = 'HEAD';
  mode: 'direct' | 'mergeBase' = 'direct';

  open(): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.opened.set(true);
    this.dialog().nativeElement.showModal();
    this.messageInput().nativeElement.focus();
  }

  close(): void { this.dialog().nativeElement.close(); }
  closed(): void {
    this.opened.set(false);
    this.comparisonRequest++;
    this.comparing.set(false);
    this.history.cancelComparison();
    void this.history.cancel();
    const target = this.opener?.isConnected && this.opener !== document.body && this.opener !== document.documentElement
      ? this.opener
      : this.returnFocusFallback();
    setTimeout(() => target?.isConnected && target.focus());
  }
  selectCommit(oid: string): void { this.commitSelected.emit(oid); this.close(); }

  activeFilterCount(): number {
    return [this.query.author, this.query.oid, this.query.since, this.query.until, this.query.path, this.query.scope]
      .filter(Boolean).length;
  }

  clearAdvancedFilters(): void {
    const message = this.query.message;
    this.query = { ...emptyHistoryQuery(), message } satisfies HistoryQuery;
  }

  async compare(): Promise<void> {
    const request = ++this.comparisonRequest;
    this.comparing.set(true); this.comparisonError.set(null);
    try {
      const accepted = await this.history.compare(this.base, this.target, this.mode);
      if (request !== this.comparisonRequest || !accepted) return;
      this.comparisonReady.emit(); this.close();
    } catch (error) {
      if (request === this.comparisonRequest) this.comparisonError.set(typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error));
    } finally {
      if (request === this.comparisonRequest) this.comparing.set(false);
    }
  }
}
