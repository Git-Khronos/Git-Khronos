import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { ipc, type AppError, type EditorDraftReview, type EditorSnapshot, type WorkingTextEncoding } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { MarkdownPreviewComponent } from './markdown-preview.component';
import { EditorDraftSnapshots, type DraftSnapshotState } from './editor-draft-snapshots';
import { discardReviewedEditorDraft, type EditorDraftReference } from './editor-draft-recovery';

export interface WorkingFileEditorRequest { repoId: string; path: string; recovery?: EditorDraftReference; }

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
      @if (recoveryState().kind === 'pending' || recoveryState().kind === 'saving') { <p role="status">Saving a local recovery copy…</p> }
      @if (recoveryState().kind === 'saved' && dirty()) { <p role="status">Local recovery copy saved. Save the file to update the working copy.</p> }
      @if (recoveryError()) {
        <p role="alert">Recovery copy not confirmed: {{ recoveryError() }} Your editable text is retained.</p>
        <button type="button" [disabled]="busy() || windowClosing() || !sameRepository()" (click)="retryRecovery()">Retry recovery snapshot</button>
      }
    </div>
    @if (recoveryReviewError()) { <p class="recovery-review-error" role="alert">Recovery review could not complete: {{ recoveryReviewError() }} Reopen editor draft recovery to inspect current copies.</p> }
    @if (recoveryReview(); as retained) {
      <section class="recovery-review" aria-label="Compare retained editor draft">
        <h3>Review retained text</h3>
        <p>The current working text {{ retained.comparison.baselineTextMatches ? 'matches' : 'differs from' }} the recorded baseline. Original Git context: {{ retained.comparison.gitContext }}.</p>
        <dl><dt>Original reference</dt><dd>{{ retained.draft.gitContext?.workingReference ?? 'Detached or unknown' }}</dd>
          <dt>Current reference</dt><dd>{{ file()?.workingReference ?? 'Detached HEAD' }}</dd>
          <dt>Original HEAD</dt><dd>{{ retained.draft.gitContext?.headOid ?? 'Unborn or unknown' }}</dd>
          <dt>Current HEAD</dt><dd>{{ file()?.headOid ?? 'Unborn branch' }}</dd></dl>
        <label for="editor-recovery-text">Retained text to load</label>
        <textarea id="editor-recovery-text" class="recovery-text" readonly spellcheck="false" [value]="retained.draft.text"></textarea>
        @if (!retained.comparison.repositoryLocationMatches || !retained.comparison.pathMatches || !retained.comparison.encodingMatches) {
          <p role="alert">The recorded repository, file or encoding differs from this editor. Review the matching working file and its actual encoding before loading this copy.</p>
        }
        @if (recoveryNeedsAcknowledgement()) {
          <label><input type="checkbox" [checked]="recoveryAcknowledged()" [disabled]="busy()" (change)="recoveryAcknowledged.set($any($event.target).checked)" /> I reviewed the changed or unknown file and Git context.</label>
        }
        @if (dirty()) { <p>Save or discard the current editor draft before loading another copy.</p> }
        <button type="button" [disabled]="!canApplyRecovery()" (click)="applyRecovery()">Load recovered text into editor</button>
        <p>Loading text leaves the working file and index unchanged. Use Save file after reviewing the loaded draft.</p>
      </section>
    }
    @if (markdown()) {
      <gc-markdown-preview [text]="draft()" />
    } @else {
    <label class="visually-hidden" for="working-editor-text">Working file text</label>
    <textarea #textArea id="working-editor-text" spellcheck="false" [value]="draft()"
      [readOnly]="windowClosing() || busy() || !file() || !!file()?.readOnlyReason || needsReload() || !sameRepository()"
      (input)="changeDraft($any($event.target).value)" aria-describedby="working-editor-scope"></textarea>
    }
    <footer>
      <p id="working-editor-scope">Edits affect the current working file. Historical content and the index change only through explicit actions.</p>
      @if (review()) {
        <div class="draft-review" role="group" aria-label="Review unsaved draft">
          <p>Keep this draft before {{ review() === 'window' ? 'closing the window' : review() === 'close' ? 'returning to the preview' : 'reloading disk' }}?</p>
          <button type="button" [disabled]="!canSave()" (click)="save(false, true)">Save draft</button>
          <button type="button" [disabled]="busy() || windowClosing()" (click)="discardReviewed()">Discard draft</button>
          <button type="button" [disabled]="busy() || windowClosing()" (click)="keepEditing()">Keep editing</button>
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
    .recovery-review{flex:0 1 auto;min-height:90px;max-height:35%;overflow:auto;margin:8px 16px;padding:10px;border:1px solid var(--inspector-divider)}.recovery-review h3{font-size:14px;margin:0}.recovery-review label{font-size:13px}.recovery-review dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;font-size:12px}.recovery-review dd{margin:0;overflow-wrap:anywhere}.recovery-review textarea.recovery-text{box-sizing:border-box;width:100%;height:100px;min-height:80px;flex:none;margin:6px 0;resize:vertical}.recovery-review-error{padding:0 16px}
  `,
})
export class WorkingFileEditorComponent {
  readonly request = input.required<WorkingFileEditorRequest>();
  readonly closed = output<void>();
  readonly recoveryResolved = output<EditorDraftReference>();
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
  readonly recoveryReview = signal<EditorDraftReview | null>(null);
  readonly recoveryReviewError = signal('');
  readonly recoveryAcknowledged = signal(false);
  readonly recoveryNeedsAcknowledgement = computed(() => {
    const comparison = this.recoveryReview()?.comparison;
    return !!comparison && (!comparison.baselineTextMatches || comparison.gitContext !== 'same');
  });
  readonly canApplyRecovery = computed(() => {
    const retained = this.recoveryReview(), file = this.file();
    return !!retained && !!file && retained.editorId === file.editorId && retained.revision === file.revision
      && this.sameRepository() && !this.busy() && !this.windowClosing() && !this.git.busy() && !this.dirty() && !this.needsReload()
      && !file.readOnlyReason && retained.comparison.repositoryLocationMatches && retained.comparison.pathMatches
      && retained.comparison.encodingMatches && (!this.recoveryNeedsAcknowledgement() || this.recoveryAcknowledged());
  });
  private restoredReference: EditorDraftReference | null = null;
  readonly recoveryState = signal<DraftSnapshotState>({ kind: 'idle' });
  readonly recoveryError = computed(() => {
    const state = this.recoveryState();
    return state.kind === 'failed' ? this.message(state.error) : '';
  });
  private readonly snapshots = new EditorDraftSnapshots({
    snapshot_editor_draft: args => ipc.snapshot_editor_draft(args),
    discard_editor_draft: args => ipc.discard_editor_draft(args),
  }, state => { if (!this.destroyed) this.recoveryState.set(state); });
  readonly needsReload = signal(false);
  readonly review = signal<'close' | 'reload' | 'window' | null>(null);
  readonly windowClosing = signal(false);
  private closeWindow: (() => Promise<void>) | null = null;
  private windowCloseAttempted = false;
  readonly markdown = signal(false);
  readonly dirty = computed(() => !!this.file() && this.draft() !== this.file()!.text);
  readonly sameRepository = computed(() => {
    const captured = this.captured(), request = this.request();
    return !!captured && captured.repoId === this.git.activeRepositoryId()
      && captured.repoId === request.repoId && captured.path === request.path;
  });
  readonly canSave = computed(() => this.sameRepository() && !!this.file() && !this.file()!.readOnlyReason
    && !this.windowClosing() && !this.busy() && !this.git.busy() && !this.needsReload() && this.dirty());
  readonly canStageSaved = computed(() => this.sameRepository() && !!this.file()
    && !this.windowClosing() && !this.busy() && !this.git.busy() && !this.needsReload());
  private operation: string | null = null;
  private destroyed = false;

  constructor() {
    afterNextRender(() => { this.captured.set({ ...this.request() }); void this.reload(); });
  }
  focusText(): void { queueMicrotask(() => this.textArea()?.nativeElement.focus()); }
  changeDraft(text: string): void {
    if (this.busy() || this.windowClosing() || !this.file() || !this.sameRepository()
      || this.needsReload() || this.file()?.readOnlyReason) return;
    this.draft.set(text); this.snapshots.schedule(text);
  }
  retryRecovery(): void {
    if (!this.busy() && !this.windowClosing() && this.sameRepository()) void this.snapshots.flush(this.draft());
  }
  applyRecovery(): void {
    const retained = this.recoveryReview(), reference = this.captured()?.recovery;
    if (!retained || !reference || !this.canApplyRecovery()) return;
    this.restoredReference = { ...reference };
    this.draft.set(retained.draft.text); this.snapshots.schedule(retained.draft.text);
    this.notice.set('Recovered text loaded for review. The working file and index are unchanged.');
    this.focusText();
  }
  private async cleanupRestoredCopy(): Promise<void> {
    const reference = this.restoredReference; if (!reference) return;
    await discardReviewedEditorDraft(ipc, reference);
    if (this.restoredReference === reference) {
      this.restoredReference = null; this.recoveryReview.set(null);
      const captured = this.captured();
      if (captured) this.captured.set({ ...captured, recovery: undefined });
      if (!this.destroyed) this.recoveryResolved.emit(reference);
    }
  }
  private async reviewRecovery(file: EditorSnapshot): Promise<void> {
    const reference = this.captured()?.recovery; if (!reference) return;
    const operationId = crypto.randomUUID(); this.operation = operationId;
    this.recoveryReview.set(null); this.recoveryReviewError.set(''); this.recoveryAcknowledged.set(false);
    try {
      const result = await ipc.review_editor_draft({ request: { ...reference, editorId: file.editorId, revision: file.revision, operationId } });
      if (!this.destroyed && this.operation === operationId && this.file()?.editorId === file.editorId
        && this.file()?.revision === file.revision && result.editorId === file.editorId
        && result.revision === file.revision && result.draft.id === reference.id) this.recoveryReview.set(result);
    } catch (error) { if (!this.destroyed && this.operation === operationId) this.recoveryReviewError.set(this.message(error)); }
  }
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
    if (this.windowClosing()) return;
    this.closeWindow = null;
    if (this.busy() || !this.sameRepository()) return;
    if (this.dirty()) this.review.set('reload'); else void this.reload();
  }
  requestClose(): void {
    if (this.windowClosing()) return;
    this.closeWindow = null;
    if (this.busy()) { if (!this.writing() && !this.dirty()) this.closed.emit(); return; }
    if (this.dirty()) this.review.set('close'); else this.closed.emit();
  }
  async discardReviewed(): Promise<void> {
    if (this.busy() || this.windowClosing()) return;
    const action = this.review(), file = this.file();
    if (!action || !file) return;
    this.busy.set(true); this.pending.set('Discarding this editor draft…'); this.error.set('');
    try {
      const result = await this.snapshots.discard();
      if (this.destroyed || this.file()?.editorId !== file.editorId) return;
      this.file.set({ ...file, revision: result.revision });
      await this.cleanupRestoredCopy();
      if (this.destroyed || this.file()?.editorId !== file.editorId) return;
      const finish = this.review() ?? action; this.review.set(null);
      if (finish === 'close') this.closed.emit();
      else if (finish === 'reload') { this.busy.set(false); await this.reload(); }
      else if (finish === 'window') { this.busy.set(false); await this.approveWindowClose(); }
    } catch (error) {
      if (!this.destroyed) { this.error.set(`${this.message(error)} Your draft is retained; recovery cleanup was not confirmed.`);
        this.snapshots.schedule(this.draft());
      }
    } finally { if (!this.destroyed) this.busy.set(false); }
  }
  requestWindowClose(close: () => Promise<void>): void {
    if (this.destroyed || this.windowClosing()) return;
    this.closeWindow = close; this.windowCloseAttempted = false;
    this.review.set('window');
    if (!this.writing() && !this.dirty()) void this.approveWindowClose();
  }
  keepEditing(): void {
    if (this.windowClosing() || this.busy()) return;
    this.closeWindow = null; this.review.set(null); this.focusText();
  }
  private async approveWindowClose(): Promise<void> {
    const close = this.closeWindow;
    if (!close || this.windowClosing() || this.writing()) return;
    this.windowCloseAttempted = true; this.windowClosing.set(true);
    try { await close(); this.closeWindow = null; }
    catch { if (!this.destroyed) { this.review.set('window'); this.error.set('The window could not close. Your draft is retained. Try again or keep editing.');
      if (this.dirty()) this.snapshots.schedule(this.draft());
    } }
    finally { if (!this.destroyed) this.windowClosing.set(false); }
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
      const result = await ipc.open_working_file_editor({ repoId: request.repoId, path: request.path, encoding: this.encoding() === 'auto' ? null : this.encoding() as WorkingTextEncoding, operationId });
      if (this.destroyed || this.operation !== operationId) { await this.release(result.editorId); return; }
      const old = this.file(); this.file.set(result); this.draft.set(result.text);
      this.snapshots.bind(result);
      this.needsReload.set(false); this.notice.set(''); this.review.set(null);
      if (old) await this.release(old.editorId);
      await this.reviewRecovery(result);
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
      // Cache refusal does not prevent the user's explicit ordinary file save.
      if (action !== 'stage' || this.dirty()) await this.snapshots.flush(submitted);
      if (this.destroyed || this.operation !== operationId || this.file()?.editorId !== file.editorId
        || this.file()?.revision !== file.revision) return;
      const args = { editorId: file.editorId, revision: file.revision, operationId };
      const result = action === 'stage' ? await ipc.stage_saved_working_file_editor(args)
        : await ipc.save_working_file_editor({ ...args, text: submitted, stage: action === 'save-stage' });
      if (this.destroyed) return;
      this.file.set(result.file ? result.file : { ...file, revision: result.revision });
      this.snapshots.bind(this.file()!, action !== 'stage' && result.disk !== 'unconfirmed' && !!result.file);
      this.needsReload.set(!result.file || result.disk === 'unconfirmed');
      if (action !== 'stage' && result.file && this.draft() === submitted) this.draft.set(result.file.text);
      if (this.dirty()) this.snapshots.schedule(this.draft());
      let restoredCleanupWarning = '';
      if (action !== 'stage' && result.file && result.disk !== 'unconfirmed' && !this.dirty()) {
        try { await this.cleanupRestoredCopy(); }
        catch (error) { restoredCleanupWarning = ` The file save is confirmed; cleanup of the loaded recovery copy was not confirmed: ${this.message(error)}`; }
      }
      if (this.destroyed || this.operation !== operationId || this.file()?.editorId !== file.editorId) return;
      const disk = result.disk === 'saved' ? 'File saved.' : result.disk === 'unchanged' ? 'Saved file unchanged.' : 'The disk outcome is unconfirmed. Reload and review before retrying.';
      const index = result.stage === 'staged' ? ' Saved file staged.' : result.stage === 'unconfirmed' ? ' Staging was not confirmed.' : '';
      this.notice.set(disk + index + (result.warning ? ` ${result.warning}` : '') + restoredCleanupWarning);
      if (result.stageError) this.error.set(result.stageError.message);
      if (finishReview && result.file && result.disk !== 'unconfirmed' && !this.dirty()) {
        const review = this.review(); this.review.set(null);
        if (review === 'close') this.closed.emit();
        else if (review === 'reload') { this.busy.set(false); await this.reload(); }
        else if (review === 'window') { this.writing.set(false); await this.approveWindowClose(); }
      }
      void this.git.refreshStatusInBackground(request.repoId);
    } catch (error) {
      if (!this.destroyed) {
        this.needsReload.set(true);
        this.error.set(`${this.message(error)} Retain your draft; reload and review disk before another save or stage.`);
      }
    } finally { if (!this.destroyed) { this.operation = null; this.writing.set(false); this.busy.set(false); this.focusText();
      if (this.review() === 'window' && !this.windowCloseAttempted && !this.dirty() && !this.needsReload() && !this.error()) void this.approveWindowClose();
    } }
  }
  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); if (this.review() === 'window') this.keepEditing(); else this.requestClose(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void this.save(false); }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.snapshots.dispose();
    if (this.operation) void ipc.cancel_git_operation({ operationId: this.operation }).catch(() => undefined);
    const file = this.file(); if (file) void this.release(file.editorId);
  }
}
