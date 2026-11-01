import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, type OnDestroy, output, signal, type WritableSignal, viewChild } from '@angular/core';
import { GitKhronosService } from './git-khronos.service';
import { FileMediaComponent, type FileMediaSelection } from './file-media.component';
import { WorkingFileEditorComponent } from './working-file-editor.component';

export interface FileContentDialogRequest {
  selection: FileMediaSelection;
  returnFocus: HTMLElement | null;
  editing: WritableSignal<boolean>;
}

@Component({
  selector: 'gc-file-content-dialog',
  imports: [FileMediaComponent, WorkingFileEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content-backdrop" (click)="requestClose()">
      <section role="dialog" aria-modal="true" [attr.aria-labelledby]="editing() ? 'working-editor-title' : 'standalone-content-title'"
        [class.editing]="editing()"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        @if (editing()) {
          <gc-working-file-editor [request]="{ repoId: request().selection.repoId, path: request().selection.request.path }"
            (closed)="leaveEditor()" />
        } @else {
        <header>
          <div><p>File content · {{ contextLabel() }}</p><h2 id="standalone-content-title" [title]="request().selection.request.path">{{ request().selection.request.path }}</h2></div>
          <button type="button" [disabled]="preparingEditor()" (click)="editWorkingCopy()">{{ preparingEditor() ? 'Preparing editor…' : 'Edit working copy' }}</button>
          <button #closeButton type="button" aria-label="Close file content" (click)="requestClose()">Close</button>
          @if (closeProtectionError()) { <p role="alert" style="flex-basis:100%">{{ closeProtectionError() }}</p> }
        </header>
        <gc-file-media [selection]="request().selection" />
        }
      </section>
    </div>
  `,
  styles: `
    .content-backdrop{position:fixed;inset:0;z-index:170;display:grid;place-items:center;background:rgb(0 0 0 / .45)}
    section{box-sizing:border-box;width:min(1080px,calc(100vw - 24px));height:min(820px,calc(100dvh - 24px));display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);background:var(--overlay-surface);color:var(--text);border:1px solid var(--overlay-border);border-radius:6px;overflow:hidden}
    section.editing{grid-template-rows:minmax(0,1fr)}
    header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px 16px;border-bottom:1px solid var(--inspector-divider)}header>div{min-width:0;flex:1 1 140px}p{margin:0 0 4px;font-size:12px;color:var(--muted)}h2{margin:0;font-size:14px;line-height:1.5;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
    button{flex:none;min-height:34px;padding:7px 12px;border:1px solid var(--inspector-divider);background:var(--inspector-row);color:var(--text);font:inherit;font-size:13px;cursor:pointer}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  `,
})
export class FileContentDialogComponent implements OnDestroy {
  private readonly git = inject(GitKhronosService);
  readonly preparingEditor = signal(false);
  readonly closeProtectionError = signal('');
  private unlistenWindowClose: (() => void) | null = null;
  private destroyed = false;
  readonly request = input.required<FileContentDialogRequest>();
  readonly closed = output<void>();
  editing(): boolean { return this.request().editing(); }
  private readonly editor = viewChild(WorkingFileEditorComponent);
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

  requestClose(): void {
    const editor = this.editor();
    if (editor) editor.requestClose(); else this.closed.emit();
  }

  async editWorkingCopy(): Promise<void> {
    if (this.destroyed || this.preparingEditor()) return;
    this.closeProtectionError.set('');
    const request = this.request();
    if (this.git.browserPreview() || this.unlistenWindowClose) { this.request().editing.set(true); return; }
    // Install protection before creating a writable editor. A failed or late
    // listener must never leave an editable draft without close protection.
    this.preparingEditor.set(true);
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      if (this.destroyed) return;
      const window = getCurrentWindow();
      const unlisten = await window.onCloseRequested(event => {
        if (this.destroyed) { event.preventDefault(); return; }
        const editor = this.editor();
        if (editor) {
          event.preventDefault();
          editor.requestWindowClose(async () => {
            if (this.destroyed) throw new Error('The editor window is no longer available.');
            await window.destroy();
          });
        }
      });
      if (this.destroyed || this.request() !== request) { unlisten(); return; }
      this.unlistenWindowClose = unlisten;
      this.request().editing.set(true);
    } catch {
      if (!this.destroyed) this.closeProtectionError.set('Window close protection could not be enabled. Editing has not opened. Try again.');
    } finally { if (!this.destroyed) this.preparingEditor.set(false); }
  }

  @HostListener('window:beforeunload', ['$event'])
  protectBrowserDraft(event: BeforeUnloadEvent): void {
    if (!this.git.browserPreview()) return;
    const editor = this.editor();
    if (editor && (editor.dirty() || editor.writing())) {
      event.preventDefault(); event.returnValue = '';
    }
  }

  ngOnDestroy(): void { this.destroyed = true; this.unlistenWindowClose?.(); this.unlistenWindowClose = null; }
  leaveEditor(): void { this.request().editing.set(false); }

  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    const editing = this.editing();
    if (editing) this.editor()?.handleKey(event);
    if (event.key === 'Escape') { event.preventDefault(); if (!editing) this.requestClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter(element => element.getClientRects().length > 0);
    if (!controls.length) { event.preventDefault(); return; }
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)!.focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
  }
}
