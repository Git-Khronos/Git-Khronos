import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, output, signal, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type RecoveryDraftEntryReview, type RecoveryDraftInspection, type RecoveryDraftRecord } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { discardReviewedEditorDraft, type EditorDraftOpenRequest, type EditorDraftReference } from './editor-draft-recovery';

@Component({
  selector: 'gc-editor-draft-recovery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="requestClose()">
      <section role="dialog" aria-modal="true" aria-labelledby="editor-recovery-title" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <header><div><h2 id="editor-recovery-title">Editor draft recovery</h2><p>Inspect retained text, then review a working file before loading it into an editor.</p></div>
          <button #closeButton type="button" [disabled]="busy() === 'deleting'" (click)="requestClose()">Close</button></header>
        <div class="toolbar"><button type="button" [disabled]="!!busy()" (click)="refresh()">Refresh recovery copies</button>
          @if (busy()) { <span role="status">{{ busy() === 'deleting' ? 'Discarding reviewed copy…' : 'Reading recovery data…' }}</span> }
        </div>
        @if (error()) { <p class="feedback" role="alert">{{ error() }}</p> }
        @if (notice()) { <p class="feedback" role="status">{{ notice() }}</p> }
        @if (inventory(); as data) {
          @if (data.incomplete) { <p class="feedback" role="alert">Some recovery data could not be fully inspected. Other copies were preserved.</p> }
          @for (issue of data.issues; track $index) { <p class="feedback">{{ issue.message }}</p> }
          <div class="body">
            <nav aria-label="Retained editor copies">
              @for (entry of data.entries; track entry.id + ':' + entry.kind) {
                <button type="button" [attr.aria-pressed]="selected()?.id === entry.id && selected()?.kind === entry.kind" [disabled]="busy() === 'deleting'" (click)="select(entry)">
                  <strong>{{ entry.draft?.path ?? 'Unreadable recovery copy' }}</strong>
                  <span>{{ entry.kind === 'pending' ? 'Pending replacement' : 'Committed copy' }} · {{ recordedTime(entry.draft?.updatedAtMillis) }}</span>
                  @if (entry.draft; as draft) { <small>{{ draft.repositoryPath }}</small> }
                  @else { <small>Copy {{ entry.id.slice(0, 8) }}</small> }
                </button>
              } @empty {
                <p>{{ data.incomplete ? 'No complete copy is shown in this partial inspection.' : 'No retained editor drafts.' }}</p>
              }
            </nav>
            <div class="detail">
              @if (selected(); as entry) {
                @if (entry.error) { <p role="alert">{{ entry.error.message }}</p> }
                @if (record(); as draft) {
                  <dl><dt>Repository</dt><dd>{{ draft.repositoryPath }}</dd><dt>File</dt><dd>{{ draft.path }}</dd>
                    <dt>Original context</dt><dd>{{ draft.gitContext?.workingReference ?? (draft.gitContext?.headOid ? 'Detached HEAD' : 'Unknown') }}</dd>
                    <dt>Original HEAD</dt><dd>{{ draft.gitContext?.headOid ?? 'Not recorded or unborn branch' }}</dd>
                    <dt>Text encoding</dt><dd>{{ draft.encoding }}</dd></dl>
                  <label for="retained-editor-text">Retained draft text</label>
                  <textarea id="retained-editor-text" readonly spellcheck="false" [value]="draft.text"></textarea>
                  <div class="actions"><button type="button" [disabled]="!!busy()" (click)="copyText()">Copy draft text</button>
                    <button type="button" [disabled]="!canReview()" (click)="reviewWorkingFile()">Review working file</button></div>
                  @if (git.repository()?.path !== draft.repositoryPath) { <p>Open the original repository with the repository controls, then return here to review its working file. This copy remains available even if the repository or file is missing.</p> }
                } @else if (!entry.error && busy() !== 'reading') { <p>Select a readable copy to inspect its text.</p> }
                @if (entry.reviewToken) {
                  @if (confirmDiscard()) {
                    <div class="discard-review" role="group" aria-label="Confirm recovery copy discard">
                      <p>Discard only this {{ entry.kind === 'pending' ? 'pending replacement' : 'committed copy' }}? Its retained text will be removed. Working files and other copies stay unchanged.</p>
                      <button type="button" [disabled]="!!busy()" (click)="discardSelected()">Discard this recovery copy</button>
                      <button type="button" [disabled]="!!busy()" (click)="confirmDiscard.set(false)">Keep copy</button>
                    </div>
                  } @else { <button type="button" [disabled]="!!busy()" (click)="confirmDiscard.set(true)">Discard selected copy…</button> }
                } @else { <p>This copy cannot be safely discarded through this panel. It was preserved.</p> }
              } @else { <p>Select a copy to inspect its text and available actions.</p> }
            </div>
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    .backdrop{position:fixed;inset:0;z-index:180;display:grid;place-items:center;background:rgb(0 0 0/.45)}
    section{box-sizing:border-box;width:min(1040px,calc(100vw - 24px));max-height:calc(100dvh - 24px);display:flex;flex-direction:column;overflow:auto;background:var(--overlay-surface);color:var(--text);border:1px solid var(--overlay-border);border-radius:6px}
    header{position:sticky;top:0;z-index:1;flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px;background:var(--overlay-surface);border-bottom:1px solid var(--inspector-divider)}h2{margin:0;font-size:16px}p{font-size:13px;line-height:1.5;margin:8px 0}header p,small,dt{color:var(--muted)}
    button{min-height:34px;padding:7px 12px;background:var(--inspector-row);color:var(--text);border:1px solid var(--inspector-divider);font:inherit;font-size:13px;cursor:pointer}button:disabled{opacity:.55;cursor:default}button:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .toolbar,.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.toolbar{padding:12px 16px}.feedback{padding:0 16px}.body{display:grid;grid-template-columns:minmax(180px,280px) minmax(0,1fr);min-height:260px;overflow:auto}
    nav{padding:0 12px 16px;overflow:auto}nav button{display:flex;flex-direction:column;gap:5px;width:100%;text-align:left;margin-bottom:8px;overflow-wrap:anywhere}nav button[aria-pressed=true]{border-color:var(--accent)}nav span,small{font-size:12px}strong{font-weight:600}
    .detail{min-width:0;padding:0 16px 16px;border-left:1px solid var(--inspector-divider)}dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;font-size:12px}dd{margin:0;overflow-wrap:anywhere}label{font-size:13px}textarea{box-sizing:border-box;width:100%;height:220px;resize:vertical;margin:8px 0;padding:10px;background:var(--inspector-row);color:var(--text);border:1px solid var(--inspector-divider);font:13px/1.5 monospace}.discard-review{margin-top:16px;padding-top:10px;border-top:1px solid var(--inspector-divider)}
    @media(max-width:640px){.body{display:flex;flex-direction:column;flex:none;min-height:0;overflow:visible}nav{flex:none;min-height:100px;max-height:180px}.detail{flex:none;border-left:0;border-top:1px solid var(--inspector-divider);padding-top:12px}header{padding:12px}dl{grid-template-columns:minmax(0,1fr)}dd{margin-bottom:6px}}
  `,
})
export class EditorDraftRecoveryComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly closed = output<void>();
  readonly openRequested = output<EditorDraftOpenRequest>();
  readonly inventory = signal<RecoveryDraftInspection | null>(null);
  readonly selected = signal<RecoveryDraftEntryReview | null>(null);
  readonly record = signal<RecoveryDraftRecord | null>(null);
  readonly busy = signal<'reading' | 'deleting' | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  readonly confirmDiscard = signal(false);
  readonly canReview = computed(() => !!this.record() && !this.busy() && !this.git.busy()
    && this.record()!.repositoryPath === this.git.repository()?.path);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private generation = 0;
  private destroyed = false;

  constructor() { afterNextRender(() => { this.closeButton()?.nativeElement.focus(); void this.refresh(); }); }
  private message(error: unknown): string { return (error as Partial<AppError> | null)?.message ?? 'The recovery request did not complete. Stored copies were preserved.'; }
  recordedTime(value?: string): string {
    if (!value) return 'Time unavailable';
    const time = Number(value);
    return Number.isSafeInteger(time) && time >= 0 && time <= 8640000000000000 ? new Date(time).toLocaleString() : 'Time unavailable';
  }
  async refresh(): Promise<void> {
    if (this.destroyed || this.busy()) return;
    const generation = ++this.generation;
    this.busy.set('reading'); this.error.set(''); this.selected.set(null); this.record.set(null); this.confirmDiscard.set(false);
    try {
      const result = await ipc.inspect_editor_drafts();
      if (!this.destroyed && generation === this.generation) this.inventory.set(result);
    } catch (error) { if (!this.destroyed && generation === this.generation) { this.inventory.set(null); this.error.set(this.message(error)); } }
    finally { if (!this.destroyed && generation === this.generation) this.busy.set(null); }
  }
  async select(entry: RecoveryDraftEntryReview): Promise<void> {
    if (this.destroyed || this.busy() === 'deleting') return;
    const generation = ++this.generation;
    this.selected.set(entry); this.record.set(null); this.confirmDiscard.set(false); this.error.set(''); this.notice.set('');
    if (!entry.draft || !entry.reviewToken) { this.busy.set(null); return; }
    this.busy.set('reading');
    try {
      const record = await ipc.load_editor_draft_entry({ id: entry.id, kind: entry.kind, reviewToken: entry.reviewToken });
      if (!this.destroyed && generation === this.generation) this.record.set(record);
    } catch (error) { if (!this.destroyed && generation === this.generation) this.error.set(this.message(error)); }
    finally { if (!this.destroyed && generation === this.generation) this.busy.set(null); }
  }
  private reference(): EditorDraftReference | null {
    const selected = this.selected();
    return selected?.reviewToken ? { id: selected.id, kind: selected.kind, reviewToken: selected.reviewToken } : null;
  }
  reviewWorkingFile(): void {
    const record = this.record(), reference = this.reference();
    if (!record || !reference || !this.canReview()) return;
    this.openRequested.emit({ repositoryPath: record.repositoryPath, path: record.path, reference });
  }
  async copyText(): Promise<void> {
    const record = this.record(); if (!record || this.busy()) return;
    const generation = this.generation;
    try { await navigator.clipboard.writeText(record.text); if (!this.destroyed && generation === this.generation) this.notice.set('Draft text copied.'); }
    catch { if (!this.destroyed && generation === this.generation) this.error.set('Clipboard access is unavailable. Select the retained text and use the system copy shortcut.'); }
  }
  async discardSelected(): Promise<void> {
    const reference = this.reference();
    if (!reference || !this.confirmDiscard() || this.busy()) return;
    this.busy.set('deleting'); this.error.set('');
    try {
      await discardReviewedEditorDraft(ipc, reference);
      if (!this.destroyed) { this.notice.set('The reviewed recovery copy was discarded.'); this.busy.set(null); await this.refresh(); }
    } catch (error) { if (!this.destroyed) this.error.set(this.message(error)); }
    finally { if (!this.destroyed && this.busy() === 'deleting') this.busy.set(null); }
  }
  requestClose(): void { if (this.busy() !== 'deleting') this.closed.emit(); }
  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.requestClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled)')]
      .filter(element => element.getClientRects().length > 0);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (index === controls.length - 1 || index === -1)) { event.preventDefault(); controls[0]?.focus(); }
  }
  ngOnDestroy(): void { this.destroyed = true; this.generation++; }
}
