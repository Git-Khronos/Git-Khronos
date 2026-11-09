import { afterNextRender, afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, Injector, input, type OnDestroy, output, signal, type WritableSignal, viewChild } from '@angular/core';
import { ipc } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { FileMediaComponent, type FileMediaSelection } from './file-media.component';
import { CancellableOperation } from './cancellable-operation';
import { BackgroundOperationWarningsComponent } from './background-operation-warnings.component';
import { FileToolsDialogComponent } from './file-tools-dialog.component';
import type { FileToolsDialogRequest } from './file-tools-dialog-request';
import type { ExternalEditorRequest } from './working-file-editor.component';
import { WorkingFileEditorComponent } from './working-file-editor.component';
import type { EditorDraftReference } from './editor-draft-recovery';

export interface FileContentDialogRequest {
  selection: FileMediaSelection;
  returnFocus: HTMLElement | null;
  editing: WritableSignal<boolean>;
  recovery?: EditorDraftReference;
  readOnly?: boolean;
  showWorkingText?: boolean;
}

@Component({
  selector: 'gc-file-content-dialog',
  imports: [BackgroundOperationWarningsComponent, FileMediaComponent, WorkingFileEditorComponent, FileToolsDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="content-backdrop" (click)="requestClose()">
      <section role="dialog" aria-modal="true" [attr.aria-labelledby]="editing() ? 'working-editor-title' : 'standalone-content-title'"
        [class.editing]="editing()" [class.has-content-warnings]="git.backgroundOperationWarnings().length > 0" [inert]="!!toolRequest()"
        (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        @if (git.backgroundOperationWarnings().length) { <gc-background-operation-warnings /> }
        @if (editing()) {
          <gc-working-file-editor [request]="{ repoId: request().selection.repoId, path: request().selection.request.path, recovery: editorRecovery() }"
            (closed)="leaveEditor()" (recoveryResolved)="resolvedRecovery.set($event)" (externalRequested)="reviewExternalEditor($event)" />
        } @else {
        <header>
          <div><p>File content · {{ contextLabel() }}</p><h2 id="standalone-content-title" [title]="request().selection.request.path">{{ request().selection.request.path }}</h2></div>
          @if (request().readOnly) { <p>Ignored file · read-only</p> }
          @else {
            <button type="button" [disabled]="preparingEditor()" (click)="editWorkingCopy()">{{ preparingEditor() ? 'Preparing editor…' : 'Edit working copy' }}</button>
            <button type="button" [disabled]="git.browserPreview() || git.busy()" (click)="reviewExternalEditor({ repoId: request().selection.repoId, path: request().selection.request.path, line: 1 })">Review external editor for working file</button>
          }
          <button type="button" [disabled]="git.browserPreview() || git.busy()" (click)="reviewExternalComparison()">Compare with external program</button>
          <button #closeButton type="button" aria-label="Close file content" (click)="requestClose()">Close</button>
          @if (closeProtectionError()) { <p role="alert" style="flex-basis:100%">{{ closeProtectionError() }}</p> }
        </header>
        <div class="content">
          @if (showWorkingText()) {
            <section class="readonly-text" aria-label="Read-only working text">
              <h3>Working text</h3>
              @if (textLoading()) { <p role="status">Reading text…</p> }
              @else if (textError()) { <p role="alert">{{ textError() }}</p><button type="button" (click)="loadReadOnlyText()">Retry text preview</button> }
              @else if (textUnavailable()) {
                <p>{{ request().readOnly ? 'Text could not be decoded automatically. The file remains read-only.' : 'Text preview is unavailable for this file.' }}</p>
              }
              @else { <pre tabindex="0">{{ readOnlyText() }}</pre> }
            </section>
          }
          <gc-file-media [selection]="request().selection" [showWorkingText]="showWorkingText()" (reloadRequested)="refreshWorkingText()" />
        </div>
        }
      </section>
    </div>
    @for (tool of toolRequest() ? [toolRequest()!] : []; track tool.id) {
      @defer (on immediate) {
        <gc-file-tools-dialog [request]="tool" (closed)="closeTool()" (changed)="changed.emit($event)" />
      } @placeholder {
        <div class="tool-loader"><section role="dialog" aria-modal="true" aria-label="Opening file tools" (keydown)="handleToolLoaderKey($event)"><p role="status">Opening file tools…</p><button #toolLoaderClose type="button" (click)="closeToolLoader()">Cancel</button></section></div>
      } @error {
        <div class="tool-loader"><section role="dialog" aria-modal="true" aria-label="File tools unavailable" (keydown)="handleToolLoaderKey($event)"><p role="alert">File tools could not load. Save your work before restarting the application.</p><button #toolLoaderClose type="button" (click)="closeToolLoader()">Close</button></section></div>
      }
    }
  `,
  styles: `
    .tool-loader{position:fixed;inset:0;z-index:175;display:grid;place-items:center;background:rgb(0 0 0 / .45)}.tool-loader section{height:auto;max-height:calc(100dvh - 24px);padding:16px;overflow:auto;display:block}.tool-loader button{margin-top:12px}
    .content-backdrop{position:fixed;inset:0;z-index:170;display:grid;place-items:center;background:rgb(0 0 0 / .45)}
    section{box-sizing:border-box;width:min(1080px,calc(100vw - 24px));height:min(820px,calc(100dvh - 24px));display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);background:var(--overlay-surface);color:var(--text);border:1px solid var(--overlay-border);border-radius:6px;overflow:hidden}
    section.editing{grid-template-rows:minmax(0,1fr)}
    section.has-content-warnings{grid-template-rows:auto auto minmax(0,1fr)}section.editing.has-content-warnings{grid-template-rows:auto minmax(0,1fr)}
    .content{min-height:0;overflow:auto}.readonly-text{display:block;width:auto;height:auto;margin:16px;padding:12px;border:1px solid var(--inspector-divider);border-radius:0}.readonly-text h3{margin:0;font-size:13px}.readonly-text pre{max-height:35vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 monospace}.readonly-text pre:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px 16px;border-bottom:1px solid var(--inspector-divider)}header>div{min-width:0;flex:1 1 140px}p{margin:0 0 4px;font-size:12px;color:var(--muted)}h2{margin:0;font-size:14px;line-height:1.5;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
    button{flex:none;min-height:34px;padding:7px 12px;border:1px solid var(--inspector-divider);background:var(--inspector-row);color:var(--text);font:inherit;font-size:13px;cursor:pointer}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  `,
})
export class FileContentDialogComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly preparingEditor = signal(false);
  readonly readOnlyText = signal('');
  readonly textLoading = signal(false);
  readonly textUnavailable = signal(false);
  readonly textError = signal('');
  readonly closeProtectionError = signal('');
  readonly resolvedRecovery = signal<EditorDraftReference | null>(null);
  private unlistenWindowClose: (() => void) | null = null;
  private textOperation: CancellableOperation | null = null;
  private destroyed = false;
  private readonly injector = inject(Injector);
  readonly request = input.required<FileContentDialogRequest>();
  readonly closed = output<void>();
  readonly changed = output<string>();
  readonly toolRequest = signal<FileToolsDialogRequest | null>(null);
  private readonly toolLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('toolLoaderClose');
  reviewExternalEditor(request: ExternalEditorRequest): void {
    if (this.destroyed || this.request().readOnly || this.git.browserPreview() || this.git.busy() || request.repoId !== this.git.activeRepositoryId()) return;
    this.openTool({ kind: 'editor', path: request.path, line: request.line }, request.returnFocus);
  }
  reviewExternalComparison(): void {
    if (this.destroyed || this.git.browserPreview() || this.git.busy() || this.request().selection.repoId !== this.git.activeRepositoryId()) return;
    this.openTool({ kind: 'comparison', request: this.request().selection.request });
  }
  private openTool(action: NonNullable<FileToolsDialogRequest['action']>,
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null): void {
    this.toolRequest.set({ id: crypto.randomUUID(), repoId: this.request().selection.repoId, action,
      returnFocus });
  }
  closeToolLoader(): void {
    const request = this.request(), opener = this.toolRequest()?.returnFocus;
    this.toolRequest.set(null);
    afterNextRender(() => {
      if (this.destroyed || this.toolRequest() || this.request() !== request) return;
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    }, { injector: this.injector });
  }
  closeTool(): void {
    this.toolRequest.set(null);
    if (!this.editing()) {
      this.refreshWorkingText();
      this.media()?.reload();
    }
  }
  handleToolLoaderKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.closeToolLoader(); }
    else if (event.key === 'Tab') { event.preventDefault(); this.toolLoaderClose()?.nativeElement.focus(); }
  }
  editing(): boolean { return this.request().editing(); }
  editorRecovery(): EditorDraftReference | undefined {
    const reference = this.request().recovery, resolved = this.resolvedRecovery();
    return reference && resolved && reference.id === resolved.id && reference.kind === resolved.kind
      && reference.reviewToken === resolved.reviewToken ? undefined : reference;
  }
  private readonly editor = viewChild(WorkingFileEditorComponent);
  private readonly media = viewChild(FileMediaComponent);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    afterRenderEffect(() => { if (!this.toolRequest()) this.closeButton()?.nativeElement.focus({ preventScroll: true }); });
    afterRenderEffect(() => this.toolLoaderClose()?.nativeElement.focus());
    afterNextRender(() => {
      if (this.request().recovery) void this.editWorkingCopy();
      if (this.showWorkingText()) void this.loadReadOnlyText();
    });
  }

  showWorkingText(): boolean {
    return !!(this.request().readOnly || this.request().showWorkingText);
  }

  async loadReadOnlyText(): Promise<void> {
    if (this.destroyed || !this.showWorkingText() || this.textLoading()) return;
    const request = this.request();
    const operation = new CancellableOperation(crypto.randomUUID());
    this.textOperation = operation;
    this.textLoading.set(true);
    this.textError.set('');
    this.textUnavailable.set(false);
    try {
      const text = await ipc.read_repository_file_text({
        repoId: request.selection.repoId,
        path: request.selection.request.path,
        operationId: operation.id,
      });
      if (this.destroyed || this.textOperation !== operation || this.request() !== request) return;
      this.readOnlyText.set(text ?? '');
      this.textUnavailable.set(text === null);
    } catch (error: unknown) {
      if (!this.destroyed && this.textOperation === operation && this.request() === request) this.textError.set(this.git.formatError(error));
    } finally {
      operation.finish();
      if (this.textOperation === operation) {
        this.textOperation = null;
        if (!this.destroyed) this.textLoading.set(false);
      }
    }
  }

  refreshWorkingText(): void {
    if (this.destroyed || !this.showWorkingText()) return;
    this.cancelTextRead();
    this.textLoading.set(false);
    void this.loadReadOnlyText();
  }

  private cancelTextRead(): void {
    const operation = this.textOperation;
    this.textOperation = null;
    if (operation) void operation.cancel().then(result => {
      if (operation.settled || result === 'accepted' || result === 'finished') return;
      const detail = result === 'unacknowledged'
        ? 'Cancellation was not acknowledged.'
        : `Cancellation failed: ${this.git.formatError(result.error)}.`;
      const message = `${detail} A previous text preview may still be running.`;
      this.git.reportBackgroundOperationWarning(operation.id, message);
    });
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
    if (this.destroyed || this.request().readOnly || this.preparingEditor()) return;
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
          this.toolRequest.set(null);
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

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cancelTextRead();
    this.unlistenWindowClose?.();
    this.unlistenWindowClose = null;
  }
  leaveEditor(): void {
    this.request().editing.set(false);
    this.refreshWorkingText();
  }

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
