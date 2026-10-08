import { ChangeDetectionStrategy, Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HistorySearchService, emptyHistoryQuery } from './history-search.service';

@Component({
  selector: 'gc-history-search',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog id="repository-history-dialog" aria-labelledby="history-search-heading" (close)="closed()">
        <header><h2 id="history-search-heading">Search repository history</h2><button type="button" (click)="close()">Close history search</button></header>
        <section aria-label="Repository history search">
          <form (ngSubmit)="history.search(query)">
            <label>Message contains<input #messageInput name="message" [(ngModel)]="query.message" /></label>
            <details>
              <summary>Advanced filters</summary>
              <div class="filters">
              <label>Author name/email contains<input name="author" [(ngModel)]="query.author" /></label>
              <label>Commit ID prefix<input name="oid" [(ngModel)]="query.oid" /></label>
              <label>Author date from<input name="since" type="date" [(ngModel)]="query.since" /></label>
              <label>Author date through<input name="until" type="date" [(ngModel)]="query.until" /></label>
              <label>Repository-relative path<input name="path" [(ngModel)]="query.path" /></label>
              <label>Ref or A..B range<input name="scope" [(ngModel)]="query.scope" placeholder="Empty = all refs + HEAD" /></label>
              </div>
            </details>
            <p>Case-insensitive literal text. Dates are inclusive author calendar dates. Hidden graph branches are included; results pin current refs until a new search.</p>
            <button type="submit" [disabled]="history.busy()">Search repository</button>
            @if (history.busy()) { <button type="button" (click)="history.cancel()">Cancel history search</button> }
          </form>
          <p role="status" aria-live="polite">{{ history.status() }}</p>
          @if (history.error()) { <p role="alert">{{ history.error() }}</p> }
          <div class="results" [attr.aria-busy]="history.busy()">
            @for (entry of history.entries(); track entry.oid) {
              <button type="button" (click)="selectCommit(entry.oid)" [title]="entry.oid">
                <code>{{ entry.oid.slice(0, 8) }}</code> {{ entry.subject }}
                <small>{{ entry.authorName }} · {{ entry.authoredAt | date:'mediumDate' }}</small>
              </button>
            }
          </div>
          @if (!history.complete() && !history.busy() && (history.cursor() || history.error())) {
            <button type="button" (click)="history.next()">{{ history.error() ? 'Retry history page' : 'Continue searching older history' }}</button>
          }
          @if (history.complete() && !history.entries().length) { <p>No matching commits in the selected history.</p> }
          <details>
          <summary>Compare two revisions</summary>
          <form (ngSubmit)="compare()">
            <fieldset>
              <legend>Compare revisions</legend>
              <label>Base ref or commit<input name="base" [(ngModel)]="base" /></label>
              <label>Target ref or commit<input name="target" [(ngModel)]="target" /></label>
              <label>Comparison mode<select name="mode" [(ngModel)]="mode">
                <option value="direct">Direct tips: base → target</option>
                <option value="mergeBase">Merge base → target</option>
              </select></label>
              <p>Direct compares both trees. Merge base shows changes on the target since their common ancestor; multiple merge bases are rejected explicitly.</p>
              <button type="submit" [disabled]="comparing() || !base || !target">Compare revisions</button>
              @if (comparisonError()) { <p role="alert">{{ comparisonError() }}</p> }
            </fieldset>
          </form>
          </details>
        </section>
    </dialog>
  `,
  styles: [`
    :host { display: contents; }
    dialog { width: min(720px, calc(100vw - 48px)); max-height: calc(100vh - 64px); overflow: auto; color: var(--text); background: var(--overlay-surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
    dialog::backdrop { background: rgb(0 0 0 / .6); }
    header { display: flex; align-items: center; gap: 16px; justify-content: space-between; }
    h2 { font-size: 18px; margin: 0; }
    details { padding: 12px 0; }
    summary { cursor: pointer; }
    section { padding: 12px 0; }
    .filters, fieldset { display: flex; flex-wrap: wrap; gap: 12px; }
    label { display: grid; gap: 4px; min-width: 150px; flex: 1; }
    input, select, button { font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; }
    button { cursor: pointer; margin-right: 8px; }
    button:disabled { opacity: .5; cursor: default; }
    :is(input, select, button, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    p, small { font-size: 12px; }
    .results { max-height: 240px; overflow: auto; display: grid; gap: 4px; margin: 8px 0; }
    .results button { text-align: left; overflow-wrap: anywhere; }
    small { display: block; }
    fieldset { margin-top: 16px; }
    fieldset p { flex-basis: 100%; }
  `],
})
export class HistorySearchComponent {
  readonly history = inject(HistorySearchService);
  readonly commitSelected = output<string>();
  readonly comparisonReady = output<void>();
  readonly opened = signal(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly messageInput = viewChild.required<ElementRef<HTMLInputElement>>('messageInput');
  private opener: HTMLElement | null = null;
  readonly comparing = signal(false);
  readonly comparisonError = signal<string | null>(null);
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
    void this.history.cancel();
    queueMicrotask(() => this.opener?.isConnected && this.opener.focus());
  }
  selectCommit(oid: string): void { this.commitSelected.emit(oid); this.close(); }

  async compare(): Promise<void> {
    this.comparing.set(true); this.comparisonError.set(null);
    try { await this.history.compare(this.base, this.target, this.mode); this.comparisonReady.emit(); this.close(); }
    catch (error) { this.comparisonError.set(typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)); }
    finally { this.comparing.set(false); }
  }
}
