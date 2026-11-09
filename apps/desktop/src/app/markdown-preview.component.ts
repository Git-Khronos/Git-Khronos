import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, input, signal, untracked } from '@angular/core';
import type { MarkdownPreview } from './markdown-preview';

@Component({
  selector: 'gc-markdown-preview',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Markdown draft preview">
      <p class="preview-scope">Preview of the unsaved draft. HTML, links and images stay inactive.</p>
      @if (busy()) { <p role="status">Preparing Markdown preview…</p> }
      @if (result().error; as error) { <p role="alert">{{ error }}</p> }
      <ng-container *ngTemplateOutlet="nodes; context: { $implicit: result().nodes }" />
    </section>
    <ng-template #nodes let-items>
      @for (node of items; track $index) {
        @switch (node.kind) {
          @case ('paragraph') { <p><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></p> }
          @case ('heading') { <div role="heading" [attr.aria-level]="node.level" class="heading"><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></div> }
          @case ('strong') { <strong><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></strong> }
          @case ('em') { <em><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></em> }
          @case ('delete') { <del><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></del> }
          @case ('quote') { <blockquote><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></blockquote> }
          @case ('list') {
            @if (node.ordered) { <ol [attr.start]="node.start"><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></ol> }
            @else { <ul><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></ul> }
          }
          @case ('item') { <li><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></li> }
          @case ('code') { <pre><code>{{ node.text }}</code></pre> }
          @case ('codeSpan') { <code>{{ node.text }}</code> }
          @case ('line') { <br /> }
          @case ('rule') { <hr /> }
          @case ('table') { <div class="table-scroll"><table><tbody><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></tbody></table></div> }
          @case ('row') { <tr><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></tr> }
          @case ('cell') {
            @if (node.header) { <th><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></th> }
            @else { <td><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /></td> }
          }
          @case ('link') { <span class="inactive-link"><ng-container *ngTemplateOutlet="nodes; context: { $implicit: node.children }" /> ({{ node.text }})</span> }
          @default { {{ node.text }} }
        }
      }
    </ng-template>
  `,
  styles: `
    :host{display:block;flex:1;min-height:80px;overflow:auto;margin:8px 16px;border:1px solid var(--inspector-divider)}
    section{padding:12px;overflow-wrap:anywhere;font-size:14px;line-height:1.6}.preview-scope{color:var(--muted);font-size:13px}
    .heading{font-weight:700;font-size:1.25em;margin:1em 0 .4em}.heading[aria-level="1"]{font-size:1.7em}.heading[aria-level="2"]{font-size:1.45em}
    pre{overflow:auto;white-space:pre;padding:10px;background:var(--inspector-row)}code{font-family:monospace}
    blockquote{margin:8px 0;padding-left:12px;border-left:3px solid var(--inspector-divider)}li>p{margin:.2em 0}
    .table-scroll{overflow:auto}table{border-collapse:collapse}td,th{border:1px solid var(--inspector-divider);padding:6px 10px;text-align:left}
    .inactive-link{color:var(--text)}
  `,
})
export class MarkdownPreviewComponent {
  readonly text = input.required<string>();
  readonly result = signal<MarkdownPreview>({ nodes: [], error: null });
  readonly busy = signal(false);
  constructor() {
    effect(onCleanup => {
      const text = this.text();
      let worker: Worker | null = null, timeout: ReturnType<typeof setTimeout> | undefined;
      let closed = false;
      untracked(() => { this.busy.set(true); this.result.set({ nodes: [], error: null }); });
      const finish = (result: MarkdownPreview) => {
        if (closed) return;
        closed = true; worker?.terminate(); clearTimeout(timeout);
        this.result.set(result); this.busy.set(false);
      };
      const delay = setTimeout(() => {
        try {
          worker = new Worker(new URL('./markdown-preview.worker', import.meta.url), { type: 'module' });
          worker.onmessage = ({ data }: MessageEvent<MarkdownPreview>) => finish(data);
          worker.onerror = () => finish({ nodes: [], error: 'Markdown preview is unavailable. Your draft is unchanged.' });
          timeout = setTimeout(() => finish({ nodes: [], error: 'Markdown preview exceeded its time limit. Your draft is unchanged.' }), 2000);
          worker.postMessage(text);
        } catch { finish({ nodes: [], error: 'Markdown preview is unavailable. Your draft is unchanged.' }); }
      }, 200);
      onCleanup(() => { closed = true; clearTimeout(delay); clearTimeout(timeout); worker?.terminate(); });
    });
  }
}
