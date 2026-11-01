import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { ipc, type AppError, type EditorSnapshot, type WorkingTextEncoding } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { MarkdownPreviewComponent } from './markdown-preview.component';

export interface WorkingFileEditorRequest { repoId: string; path: string; }

@Component({
  selector: 'gc-working-file-editor',
  imports: [MarkdownPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <div><p>Working copy editor · {{ dirty() ? 'Unsaved draft' : 'Saved text' }}</p>
        <h2 id="working-editor-title" [title]="captured()?.path">{{ captured()?.path }}</h2></div>
      <button type="button" [disabled]="busy() && writing()" (click)="requestClose()">Back to preview</button>
    </header>
    <div class="editor-controls">
      <label for="working-editor-encoding">Read encoding</label>
      <select id="working-editor-encoding" [value]="encoding()" [disabled]="busy() || dirty() || !sameRepository()"
        (change)="changeEncoding($any($event.target).value)">
        <option value="auto">UTF-8 or BOM</option><option value="utf8">UTF-8</option>
        <option value="utf16Le">UTF-16 LE</option><option value="utf16Be">UTF-16 BE</option>
        <option value="windows1252">Windows-1252</option>
      </select>
      <button type="button" [disabled]="busy() || !sameRepository()" (click)="requestReload()">Reload disk</button>
      <div role="group" aria-label="Editor view">
        <button type="button" [attr.aria-pressed]="!markdown()" (click)="markdown.set(false); focusText()">Edit text</button>
        <button type="button" [attr.aria-pressed]="markdown()" (click)="markdown.set(true)">Preview Markdown</button>
      </div>
      @if (file(); as saved) { <span>{{ saved.encoding }} · {{ saved.lineEndings }} · {{ saved.encodedByteLen }} bytes{{ saved.bom ? ' · BOM' : '' }}</span> }
    </div>
    <div class="editor-feedback" aria-live="polite">
      @if (!sameRepository()) { <p role="alert">This draft belongs to another repository or file. Return to its original selection before saving.</p> }
      @if (file()?.readOnlyReason; as reason) { <p>{{ reason }}</p> }
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (notice()) { <p role="status">{{ notice() }}</p> }
      @if (busy()) { <p role="status">{{ pending() }}</p> }
    </div>
    @if (markdown()) {
      <gc-markdown-preview [text]="draft()" />
    } @else {
    <label class="visually-hidden" for="working-editor-text">Working file text</label>
    <textarea #textArea id="working-editor-text" spellcheck="false" [value]="draft()"
      [readOnly]="busy() || !file() || !!file()?.readOnlyReason || needsReload() || !sameRepository()"
      (input)="draft.set($any($event.target).value)" aria-describedby="working-editor-scope"></textarea>
    }
    <footer>
      <p id="working-editor-scope">Edits affect the current working file. Historical content and the index change only through explicit actions.</p>
      @if (review()) {
        <div class="draft-review" role="group" aria-label="Review unsaved draft">
          <p>Keep this draft before {{ review() === 'close' ? 'returning to the preview' : 'reloading disk' }}?</p>
          <button type="button" [disabled]="!canSave()" (click)="save(false, true)">Save draft</button>
          <button type="button" [disabled]="busy()" (click)="discardReviewed()">Discard draft</button>
          <button type="button" [disabled]="busy()" (click)="review.set(null); focusText()">Keep editing</button>
        </div>
      } @else {
        <div class="actions">
          <button type="button" [disabled]="!canSave()" (click)="save(false)">Save file</button>
          <button type="button" [disabled]="!canSave()" (click)="save(true)">Save and stage</button>
          <button type="button" [disabled]="!canStageSaved()" (click)="stageSaved()">Stage saved file</button>
        </div>
      }
    </footer>
  `,
  styles: `
    :host{display:flex;flex-direction:column;min-height:0;height:100%;color:var(--text)}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--inspector-divider)}header>div{min-width:0}
    h2{font-size:14px;line-height:1.5;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}p{font-size:13px;line-height:1.5;margin:4px 0}
    header p,.editor-controls span,footer>p{color:var(--muted)}
    button,select{min-height:34px;padding:7px 12px;border:1px solid var(--inspector-divider);background:var(--inspector-row);color:var(--text);font:inherit;font-size:13px}
    button{cursor:pointer;flex:none}button:disabled{opacity:.55;cursor:default}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .editor-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 16px;font-size:13px}.editor-feedback{padding:0 16px;max-height:120px;overflow:auto}
    textarea{box-sizing:border-box;flex:1;min-width:0;min-height:80px;resize:none;margin:8px 16px;padding:12px;background:var(--overlay-surface);color:var(--text);border:1px solid var(--inspector-divider);font:14px/1.6 monospace;tab-size:4}
    footer{padding:4px 16px 12px;max-height:40%;overflow:auto}.actions,.draft-review{display:flex;gap:8px;flex-wrap:wrap}.draft-review p{flex-basis:100%}
    .visually-hidden{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  `,
})
export class WorkingFileEditorComponent {
  readonly request = input.required<WorkingFileEditorRequest>();
  readonly closed = output<void>();
  private readonly git = inject(GitKhronosService);
  private readonly textArea = viewChild<ElementRef<HTMLTextAreaElement>>('textArea');
  readonly captured = signal<WorkingFileEditorRequest | null>(null);
  readonly file = signal<EditorSnapshot | null>(null);
  readonly draft = signal('');
  readonly encoding = signal<WorkingTextEncoding | 'auto'>('auto');
  readonly busy = signal(false);
  readonly writing = signal(false);
  readonly pending = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly needsReload = signal(false);
  readonly review = signal<'close' | 'reload' | null>(null);
  readonly markdown = signal(false);
  readonly dirty = computed(() => !!this.file() && this.draft() !== this.file()!.text);
  readonly sameRepository = computed(() => {
    const captured = this.captured(), request = this.request();
    return !!captured && captured.repoId === this.git.activeRepositoryId()
      && captured.repoId === request.repoId && captured.path === request.path;
  });
  readonly canSave = computed(() => this.sameRepository() && !!this.file() && !this.file()!.readOnlyReason
    && !this.busy() && !this.git.busy() && !this.needsReload() && this.dirty());
  readonly canStageSaved = computed(() => this.sameRepository() && !!this.file()
    && !this.busy() && !this.git.busy() && !this.needsReload());
  private operation: string | null = null;
  private destroyed = false;

  constructor() {
    afterNextRender(() => { this.captured.set({ ...this.request() }); void this.reload(); });
  }
  focusText(): void { queueMicrotask(() => this.textArea()?.nativeElement.focus()); }
  private message(error: unknown): string {
    const value = error as Partial<AppError> | null;
    return value?.message ?? 'The editor request did not complete.';
  }
  async changeEncoding(encoding: WorkingTextEncoding | 'auto'): Promise<void> {
    if (this.busy() || this.dirty() || !this.sameRepository()) return;
    const previous = this.encoding();
    this.encoding.set(encoding); await this.reload();
    if (this.error()) this.encoding.set(previous);
  }
  requestReload(): void {
    if (this.busy() || !this.sameRepository()) return;
    if (this.dirty()) this.review.set('reload'); else void this.reload();
  }
  requestClose(): void {
    if (this.busy()) { if (!this.writing() && !this.dirty()) this.closed.emit(); return; }
    if (this.dirty()) this.review.set('close'); else this.closed.emit();
  }
  discardReviewed(): void {
    if (this.busy()) return;
    const action = this.review(); this.review.set(null);
    if (action === 'close') this.closed.emit();
    else if (action === 'reload') void this.reload();
  }
  private async release(id: string): Promise<void> {
    await ipc.close_working_file_editor({ editorId: id }).catch(() => undefined);
  }
  private async reload(): Promise<void> {
    const request = this.captured();
    if (!request || !this.sameRepository() || this.busy()) return;
    const operationId = crypto.randomUUID();
    this.operation = operationId; this.writing.set(false); this.busy.set(true); this.pending.set('Reading working file…'); this.error.set('');
    try {
      const result = await ipc.open_working_file_editor({ ...request, encoding: this.encoding() === 'auto' ? null : this.encoding() as WorkingTextEncoding, operationId });
      if (this.destroyed || this.operation !== operationId) { await this.release(result.editorId); return; }
      const old = this.file(); this.file.set(result); this.draft.set(result.text);
      this.needsReload.set(false); this.notice.set(''); this.review.set(null);
      if (old) await this.release(old.editorId);
      this.focusText();
    } catch (error) { if (!this.destroyed) this.error.set(this.message(error)); }
    finally { if (!this.destroyed) { this.operation = null; this.busy.set(false); } }
  }
  async save(stage: boolean, finishReview = false): Promise<void> {
    if (!this.canSave()) return;
    await this.write(stage ? 'save-stage' : 'save', finishReview);
  }
  async stageSaved(): Promise<void> { if (this.canStageSaved()) await this.write('stage', false); }
  private async write(action: 'save' | 'save-stage' | 'stage', finishReview: boolean): Promise<void> {
    const file = this.file()!, request = this.captured()!, submitted = this.draft();
    const operationId = crypto.randomUUID();
    this.operation = operationId; this.writing.set(true); this.busy.set(true); this.pending.set(action === 'stage' ? 'Staging saved file…' : 'Saving working file…');
    this.error.set(''); this.notice.set('');
    try {
      const args = { editorId: file.editorId, revision: file.revision, operationId };
      const result = action === 'stage' ? await ipc.stage_saved_working_file_editor(args)
        : await ipc.save_working_file_editor({ ...args, text: submitted, stage: action === 'save-stage' });
      if (this.destroyed) return;
      this.file.set(result.file ? result.file : { ...file, revision: result.revision });
      this.needsReload.set(!result.file || result.disk === 'unconfirmed');
      if (action !== 'stage' && result.file && this.draft() === submitted) this.draft.set(result.file.text);
      const disk = result.disk === 'saved' ? 'File saved.' : result.disk === 'unchanged' ? 'Saved file unchanged.' : 'The disk outcome is unconfirmed. Reload and review before retrying.';
      const index = result.stage === 'staged' ? ' Saved file staged.' : result.stage === 'unconfirmed' ? ' Staging was not confirmed.' : '';
      this.notice.set(disk + index + (result.warning ? ` ${result.warning}` : ''));
      if (result.stageError) this.error.set(result.stageError.message);
      if (finishReview && result.file && result.disk !== 'unconfirmed' && !this.dirty()) {
        const review = this.review(); this.review.set(null);
        if (review === 'close') this.closed.emit();
        else if (review === 'reload') { this.busy.set(false); await this.reload(); }
      }
      void this.git.refreshStatusInBackground(request.repoId);
    } catch (error) {
      if (!this.destroyed) {
        this.needsReload.set(true);
        this.error.set(`${this.message(error)} Retain your draft; reload and review disk before another save or stage.`);
      }
    } finally { if (!this.destroyed) { this.operation = null; this.writing.set(false); this.busy.set(false); this.focusText(); } }
  }
  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.requestClose(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void this.save(false); }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.operation) void ipc.cancel_git_operation({ operationId: this.operation }).catch(() => undefined);
    const file = this.file(); if (file) void this.release(file.editorId);
  }
}
