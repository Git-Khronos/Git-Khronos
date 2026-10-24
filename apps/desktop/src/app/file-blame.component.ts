import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GitKhronosService } from './git-khronos.service';
import { shouldDecorateDiff } from './diff-rendering';

@Component({
  selector: 'gc-file-blame',
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="file-insight-panel blame-insight" aria-label="File blame" [attr.aria-busy]="git.fileInsightBusy()" [style.--blame-line-number-width]="lineNumberWidth()">
      <header><div><strong>Blame</strong><small>{{ path() }} · line-by-line ownership</small></div>
        <b aria-live="polite">{{ rangeLabel() }}</b></header>
      <form class="blame-pagination" aria-label="Blame line navigation" (ngSubmit)="git.loadFileBlamePage(jumpLine())">
        <button type="button" (click)="git.loadFileBlamePage(previousLine())" [disabled]="git.fileInsightBusy() || git.fileBlameStart() <= 1">Previous lines</button>
        <button type="button" (click)="git.loadFileBlamePage(git.fileBlameNext()!)" [disabled]="git.fileInsightBusy() || git.fileBlameNext() === null">Next lines</button>
        <label>Go to line <input type="number" name="line" min="1" max="4294967195" step="1" [ngModel]="jumpLine()" (ngModelChange)="jumpLine.set($event)" [disabled]="git.fileInsightBusy()" /></label>
        <button type="submit" [disabled]="git.fileInsightBusy()">Go</button>
        <button type="button" [disabled]="git.fileInsightBusy()" (click)="git.loadFileBlamePage(git.fileBlameStart())">Refresh blame page</button>
        @if (git.fileInsightBusy()) { <small role="status">Reading blame information…</small> }
      </form>
      <div class="blame-feedback">
        @if (git.fileBlameError(); as error) {
          <div role="alert"><p>{{ error }}</p><button type="button" (click)="git.retryFileBlame()" [disabled]="git.fileInsightBusy()">Retry blame page</button></div>
        }
      </div>
      @if (git.fileInsightBusy() && git.fileBlame() === null) {
        <div class="file-insight-loading" aria-hidden="true">Reading blame information…</div>
      } @else {
        @for (page of [git.fileBlame()]; track page) {
          <div class="blame-lines" tabindex="0" role="region" aria-label="Blame source lines" (keydown.ArrowLeft)="$event.stopPropagation()" (keydown.ArrowRight)="$event.stopPropagation()">
            @for (line of rows(); track line.lineNumber) {
              <div class="blame-line" title="{{ line.summary }} · {{ line.authorEmail }}">
                <span>{{ line.lineNumber }}</span><button type="button" class="blame-sha" (click)="navigate.emit({oid: line.oid, path: line.path || path(), parent: false})" title="Open blamed commit">{{ line.oid.slice(0, 8) }}</button>
                <button type="button" (click)="navigate.emit({oid: line.oid, path: line.path || path(), parent: true})" title="Open first parent of blamed commit">Parent</button>
                <span class="blame-author" [title]="line.authorName">{{ line.authorName }}</span><time>{{ (line.authoredAt * 1000) | date: 'MMM d, y' }}</time>
                <code class="blame-source">@for (token of line.tokens; track $index) {<span class="syntax-{{ token.kind }}">{{ token.text }}</span>}</code>
              </div>
            } @empty {
              @if (git.fileBlame() !== null && !git.fileBlameError()) { <div class="file-insight-empty">This file has no lines at this revision.</div> }
            }
          </div>
        }
      }
    </section>
  `,
  styles: `
    :host { display: contents; }
    .blame-insight { grid-template-rows: 46px auto auto minmax(0, 1fr); }
    .blame-line { width: max-content; min-width: 100%; grid-template-columns: var(--blame-line-number-width, 43px) 76px 64px 120px 105px minmax(400px, max-content); }
    .blame-line > span:first-child, .blame-line > time { color: var(--muted); }
    .blame-pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); }
    .blame-pagination label { display: flex; align-items: center; gap: 6px; }
    input { width: 100px; min-height: 28px; background: var(--surface); color: var(--text); border: 1px solid var(--border); }
    .blame-pagination button, .blame-feedback button { min-height: 28px; padding: 4px 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    button:focus-visible, input:focus-visible, .blame-lines:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .blame-feedback [role=alert] { padding: 8px 14px; color: var(--danger); }
    p { margin: 0 0 6px; overflow-wrap: anywhere; }
  `,
})
export class FileBlameComponent {
  readonly git = inject(GitKhronosService);
  readonly path = input.required<string>();
  readonly tokenize = input.required<(text: string, path: string) => {text: string; kind: string}[]>();
  readonly navigate = output<{ oid: string; path: string; parent: boolean }>();
  readonly jumpLine = signal(1);
  readonly previousLine = computed(() => Math.max(1, this.git.fileBlameStart() - 100));
  readonly lineNumberWidth = computed(() => `${Math.max(43, String(this.git.fileBlame()?.at(-1)?.lineNumber ?? 1).length * 9 + 14)}px`);
  readonly rangeLabel = computed(() => {
    const lines = this.git.fileBlame();
    if (!lines?.length) return this.git.fileInsightBusy() ? 'Loading' : '0 lines loaded';
    return `Lines ${lines[0].lineNumber}–${lines.at(-1)!.lineNumber}${this.git.fileBlameNext() === null ? ' · end' : ' · more available'}`;
  });
  readonly rows = computed(() => {
    const lines = this.git.fileBlame() ?? [];
    const decorate = shouldDecorateDiff(lines.reduce((length, line) => length + line.text.length, 0), lines.length);
    return lines.map(line => ({ ...line, tokens: decorate ? this.tokenize()(line.text, this.path()) : [{text: line.text, kind: 'plain'}] }));
  });
  constructor() { effect(() => this.jumpLine.set(this.git.fileBlameStart())); }
}
