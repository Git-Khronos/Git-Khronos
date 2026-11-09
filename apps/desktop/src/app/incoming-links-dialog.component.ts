import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import type { IncomingRepositoryLink } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

@Component({
  selector: 'gc-incoming-links-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="inbox-backdrop" (click)="closed.emit()">
      <section role="dialog" aria-modal="true" aria-labelledby="incoming-links-title" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <header><h2 id="incoming-links-title">Incoming repository links</h2><button #closeButton type="button" aria-label="Close incoming links" (click)="closed.emit()">Close</button></header>
        <div class="inbox-body">
          <p>Choose a request to review. Existing tabs and drafts are retained. Automatic fetch waits until queued links are handled or dismissed.</p>
          @if (git.incomingRepositoryLinksError()) { <p role="alert">{{ git.incomingRepositoryLinksError() }}</p><button type="button" [disabled]="busy() || git.incomingRepositoryLinksLoading()" (click)="retry()">Retry incoming links</button> }
          @for (request of git.incomingRepositoryLinks().requests; track request.id) {
            <article>
              @if (request.payload.kind === 'ready') {
                <strong>{{ request.payload.link.remote }}</strong>
                <small>{{ targetLabel(request) }}</small>
                <label>Received link<textarea aria-label="Received repository link" readonly [value]="request.payload.uri"></textarea></label>
                <div class="actions"><button type="button" [disabled]="busy() || git.busy()" (click)="review.emit(request)">Review local context…</button><button type="button" [disabled]="busy()" (click)="dismiss(request.id)">Dismiss request</button></div>
              } @else {
                <p role="alert">{{ request.payload.message }}</p><button type="button" [disabled]="busy()" (click)="dismiss(request.id)">Dismiss invalid request</button>
              }
            </article>
          } @empty { <p role="status">No queued repository links.</p> }
          @if (git.incomingRepositoryLinks().overflowed) { <article><p role="alert">Additional links could not be queued. Review the current requests, then reopen any remaining links.</p><button type="button" [disabled]="busy()" (click)="dismissOverflow()">Dismiss overflow notice</button></article> }
          @if (busy() || git.incomingRepositoryLinksLoading()) { <p role="status">Updating incoming links…</p> }
        </div>
      </section>
    </div>
  `,
  styles: `
    .inbox-backdrop{position:fixed;inset:0;z-index:170;display:grid;place-items:center;background:rgb(0 0 0 / .45)}section{box-sizing:border-box;display:flex;flex-direction:column;width:min(700px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:hidden;background:var(--overlay-surface);color:var(--text);border:1px solid var(--overlay-border);border-radius:6px;font-size:13px}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--inspector-divider)}h2{font-size:16px;margin:0}.inbox-body{display:grid;gap:12px;overflow:auto;padding:16px}p{margin:0;line-height:1.6;overflow-wrap:anywhere}article,label{display:grid;gap:8px;min-width:0}article{padding:12px;border:1px solid var(--inspector-divider);overflow-wrap:anywhere}small{color:var(--muted)}textarea{box-sizing:border-box;min-height:70px;width:100%;resize:vertical;padding:8px;background:var(--inspector-row);color:var(--text);border:1px solid var(--inspector-divider);font:inherit}.actions{display:flex;flex-wrap:wrap;gap:8px}button{min-height:34px;padding:7px 12px;border:1px solid var(--inspector-divider);background:var(--inspector-row);color:var(--text);font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}[role=alert]{color:var(--danger)}
  `,
})
export class IncomingLinksDialogComponent {
  protected readonly git = inject(GitKhronosService);
  readonly closed = output<void>();
  readonly review = output<IncomingRepositoryLink>();
  protected readonly busy = signal(false);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  constructor() { afterRenderEffect(() => this.closeButton()?.nativeElement.focus()); }
  protected targetLabel(request: IncomingRepositoryLink): string {
    if (request.payload.kind !== 'ready') return '';
    const target = request.payload.link.target;
    return target.kind === 'commit' ? `Commit ${target.oid}` : target.kind === 'reference' ? target.reference : 'Repository context';
  }
  protected async dismiss(id: string): Promise<void> {
    if (this.busy()) return; this.busy.set(true);
    try { await this.git.acknowledgeIncomingRepositoryLink(id); }
    finally { this.busy.set(false); }
  }
  protected async dismissOverflow(): Promise<void> {
    if (this.busy()) return; this.busy.set(true);
    try { await this.git.dismissIncomingRepositoryLinkOverflow(); }
    finally { this.busy.set(false); }
  }
  protected async retry(): Promise<void> {
    if (this.busy()) return; this.busy.set(true);
    try { await this.git.retryIncomingRepositoryLinks(); }
    finally { this.busy.set(false); }
  }
  protected handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled)')].filter(element => element.getClientRects().length > 0);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0]?.focus(); }
  }
}
