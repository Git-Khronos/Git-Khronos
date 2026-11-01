import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { FileMediaComponent, type FileMediaSelection } from './file-media.component';

export interface FileContentDialogRequest {
  selection: FileMediaSelection;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-file-content-dialog',
  imports: [FileMediaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content-backdrop" (click)="closed.emit()">
      <section role="dialog" aria-modal="true" aria-labelledby="standalone-content-title"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <header>
          <div><p>File content · {{ contextLabel() }}</p><h2 id="standalone-content-title" [title]="request().selection.request.path">{{ request().selection.request.path }}</h2></div>
          <button #closeButton type="button" aria-label="Close file content" (click)="closed.emit()">Close</button>
        </header>
        <gc-file-media [selection]="request().selection" />
      </section>
    </div>
  `,
  styles: `
    .content-backdrop{position:fixed;inset:0;z-index:170;display:grid;place-items:center;background:rgb(0 0 0 / .45)}
    section{box-sizing:border-box;width:min(1080px,calc(100vw - 24px));height:min(820px,calc(100dvh - 24px));display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--overlay-surface);color:var(--text);border:1px solid var(--overlay-border);border-radius:6px;overflow:hidden}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--inspector-divider)}header>div{min-width:0}p{margin:0 0 4px;font-size:12px;color:var(--muted)}h2{margin:0;font-size:14px;line-height:1.5;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
    button{flex:none;min-height:34px;padding:7px 12px;border:1px solid var(--inspector-divider);background:var(--inspector-row);color:var(--text);font:inherit;font-size:13px;cursor:pointer}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  `,
})
export class FileContentDialogComponent {
  readonly request = input.required<FileContentDialogRequest>();
  readonly closed = output<void>();
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    afterRenderEffect(() => this.closeButton()?.nativeElement.focus({ preventScroll: true }));
  }

  contextLabel(): string {
    const context = this.request().selection.request.context;
    switch (context.kind) {
      case 'commit': return `Commit ${context.oid.slice(0, 12)}`;
      case 'revisions': return `${context.baseOid.slice(0, 12)} → ${context.targetOid.slice(0, 12)}`;
      case 'revisionWorktree': return `${context.baseOid.slice(0, 12)} → working copy`;
      case 'workingTree': return context.staged ? 'HEAD → index' : 'Index → working copy';
      case 'stash': return `Saved work ${context.oid.slice(0, 12)} · ${context.layer ?? 'combined'}`;
    }
  }

  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter(element => element.getClientRects().length > 0);
    if (!controls.length) { event.preventDefault(); return; }
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)!.focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  }
}
