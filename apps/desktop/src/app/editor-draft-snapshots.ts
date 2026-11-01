import type { CommandMap, EditorDraftDiscarded, EditorSnapshot, RecoveryDraftSummary } from '@git-khronos/contracts';

type Context = Pick<EditorSnapshot, 'editorId' | 'revision'>;
type Transport = Pick<CommandMap, 'snapshot_editor_draft' | 'discard_editor_draft'>;
export type DraftSnapshotState =
  | { kind: 'idle' | 'pending' | 'saving' }
  | { kind: 'saved'; summary: RecoveryDraftSummary }
  | { kind: 'failed'; error: unknown };

/** Serializes data-only snapshots. File saves remain the editor's explicit job. */
export class EditorDraftSnapshots {
  private context: Context | null = null;
  private generation = 0;
  private sequence = 0;
  private desired: string | null = null;
  private acknowledged: string | null = null;
  private summary: RecoveryDraftSummary | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private destroyed = false;
  private discarding = false;
  private paused = false;
  private failure: unknown;
  private readonly transport: Transport;
  private readonly changed: (state: DraftSnapshotState) => void;
  private readonly delay: number;

  constructor(transport: Transport, changed: (state: DraftSnapshotState) => void, delay = 350) {
    this.transport = transport; this.changed = changed; this.delay = delay;
  }

  bind(context: Context, resetSequence = true): void {
    if (this.destroyed) return;
    const sameEditor = this.context?.editorId === context.editorId;
    this.cancelPending();
    this.discarding = false;
    this.paused = false; this.failure = undefined;
    this.context = { editorId: context.editorId, revision: context.revision };
    if (resetSequence || !sameEditor) this.sequence = 0;
    this.acknowledged = null; this.summary = null;
    this.changed({ kind: 'idle' });
  }

  schedule(text: string): void {
    if (this.destroyed || this.discarding || !this.context) return;
    this.clearTimer(); this.desired = text;
    if (this.paused) { this.changed({ kind: 'failed', error: this.failure }); return; }
    if (this.acknowledged === text && this.summary) {
      this.changed({ kind: 'saved', summary: this.summary }); return;
    }
    this.changed({ kind: 'pending' });
    this.timer = setTimeout(() => { this.timer = null; this.enqueue(); }, this.delay);
  }

  async flush(text?: string): Promise<boolean> {
    if (this.destroyed || this.discarding || !this.context) return false;
    this.clearTimer();
    if (text !== undefined) this.desired = text;
    const wanted = this.desired, generation = this.generation;
    this.enqueue(true);
    await this.queue;
    return !this.destroyed && generation === this.generation && wanted !== null
      && this.desired === wanted && this.acknowledged === wanted;
  }

  /** Drop queued work before an approved save/discard changes native revision. */
  cancelPending(): void {
    this.clearTimer(); this.generation++; this.desired = null;
    this.acknowledged = null; this.summary = null;
  }

  async discard(): Promise<EditorDraftDiscarded> {
    const context = this.context;
    if (this.destroyed || this.discarding || !context) throw new Error('The editor recovery context is unavailable.');
    const wanted = this.desired;
    this.cancelPending();
    this.discarding = true;
    const generation = this.generation;
    // A sent request may finish; its response cannot retarget this context.
    try {
      await this.queue;
      if (this.destroyed || generation !== this.generation) {
        throw new Error('An obsolete recovery discard was not sent.');
      }
      const result = await this.transport.discard_editor_draft(context);
      if (result.editorId !== context.editorId || !result.revision) {
        throw new Error('Recovery discard could not be matched to this editor. Retain the draft.');
      }
      if (!this.destroyed && generation === this.generation) this.bind(result);
      return result;
    } catch (error) {
      if (!this.destroyed && generation === this.generation) {
        this.desired = wanted; this.paused = true; this.failure = error;
        this.changed({ kind: 'failed', error });
      }
      throw error;
    } finally {
      if (generation === this.generation) this.discarding = false;
    }
  }

  dispose(): void {
    this.cancelPending(); this.destroyed = true; this.context = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  private enqueue(retry = false): void {
    const context = this.context, text = this.desired, generation = this.generation;
    if (this.destroyed || !context || text === null) return;
    this.queue = this.queue.then(async () => {
      if (this.destroyed || generation !== this.generation || this.acknowledged === text) return;
      if (this.paused && !retry) return;
      this.paused = false;
      if (this.sequence >= 0xffffffff) {
        this.changed({ kind: 'failed', error: new Error('Reload the editor before another recovery snapshot.') });
        return;
      }
      const sequence = ++this.sequence;
      this.changed({ kind: 'saving' });
      try {
        if (text.length > 3 * 1024 * 1024) throw new Error('The text exceeds the local recovery snapshot limit. Retain it and use an external editor for larger files.');
        const bytes = new TextEncoder().encode(text).byteLength;
        if (bytes > 3 * 1024 * 1024) throw new Error('The text exceeds the local recovery snapshot limit. Retain it and use an external editor for larger files.');
        const summary = await this.transport.snapshot_editor_draft({ ...context, sequence, text });
        if (this.destroyed || generation !== this.generation) return;
        if (!summary || typeof summary.id !== 'string' || !summary.id
          || summary.sequence !== sequence || summary.textBytes !== String(bytes)) {
          throw new Error('The recovery reply did not confirm this snapshot. Retain the draft and retry.');
        }
        this.acknowledged = text; this.summary = summary;
        this.changed(this.desired === text ? { kind: 'saved', summary } : { kind: 'pending' });
      } catch (error) {
        if (!this.destroyed && generation === this.generation) {
          this.acknowledged = null; this.summary = null;
          this.paused = true; this.failure = error;
          this.changed({ kind: 'failed', error });
        }
      }
    });
  }
}
