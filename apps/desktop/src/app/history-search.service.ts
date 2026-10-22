import { Injectable, effect, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import type { BlameNavigation, CommitComparison, CommitSummary, FileHistoryCursor, FileHistoryPage, HistoricalFileEntry, HistoryCursor, HistoryQuery, HistorySearchPage } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

export const emptyHistoryQuery = (): HistoryQuery => ({
  message: '', author: '', oid: '', since: '', until: '', path: '', scope: '',
});

@Injectable({ providedIn: 'root' })
export class HistorySearchService {
  private readonly git = inject(GitKhronosService);
  readonly entries = signal<HistorySearchPage['entries']>([]);
  readonly cursor = signal<HistoryCursor | null>(null);
  readonly complete = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal('Enter filters and search all repository refs, independently of graph visibility.');
  readonly files = signal<HistoricalFileEntry[]>([]);
  readonly fileCursor = signal<FileHistoryCursor | null>(null);
  readonly fileComplete = signal(false);
  readonly fileBusy = signal(false);
  readonly fileError = signal<string | null>(null);
  private query = emptyHistoryQuery();
  private fileTarget: { revision: string; path: string } | null = null;
  private operation: string | null = null;
  private fileOperation: string | null = null;
  private generation = 0;
  private fileGeneration = 0;

  constructor() {
    effect(() => {
      this.git.activeRepositoryId();
      void this.reset();
    });
  }

  private message(error: unknown): string {
    return typeof error === 'object' && error && 'message' in error
      ? String(error.message) : String(error);
  }

  async reset(): Promise<void> {
    this.generation++;
    this.fileGeneration++;
    const cancellation = Promise.all([this.cancel(), this.cancelFile()]);
    this.operation = null; this.fileOperation = null;
    this.busy.set(false); this.fileBusy.set(false);
    this.entries.set([]); this.cursor.set(null); this.complete.set(false);
    this.files.set([]); this.fileCursor.set(null); this.fileComplete.set(false);
    this.error.set(null); this.fileError.set(null); this.fileTarget = null;
    await cancellation;
  }

  async search(query: HistoryQuery): Promise<void> {
    this.generation++;
    await this.cancel();
    this.operation = null; this.busy.set(false);
    this.query = { ...query };
    this.entries.set([]); this.cursor.set(null); this.complete.set(false); this.error.set(null);
    await this.next();
  }

  async next(): Promise<void> {
    const repo = this.git.repository();
    if (!repo || this.busy() || this.complete()) return;
    const generation = this.generation;
    const operationId = `history-${crypto.randomUUID()}`;
    this.operation = operationId;
    this.busy.set(true); this.error.set(null); this.status.set('Searching a bounded history page…');
    try {
      // Preview is deliberately not a loaded-row fallback: native search must own results.
      if (this.git.browserPreview()) throw new Error('Whole-repository search requires the native desktop app.');
      const page = await invoke<HistorySearchPage>('search_repository_history', {
        repoId: repo.id, query: this.query, cursor: this.cursor(), operationId,
      });
      if (generation !== this.generation || repo.id !== this.git.activeRepositoryId()) return;
      this.entries.update(entries => [...entries, ...page.entries]);
      this.cursor.set(page.cursor); this.complete.set(page.complete);
      this.status.set(page.complete
        ? `${this.entries().length} results · search complete for locally available history at the pinned refs`
        : `${this.entries().length} results so far · more history remains (continue searching)`);
    } catch (error) {
      if (generation === this.generation) {
        this.error.set(this.message(error));
        this.status.set('Search incomplete. Previously returned results are retained; retry or narrow filters.');
      }
    } finally {
      if (this.operation === operationId) { this.operation = null; this.busy.set(false); }
    }
  }

  async cancel(): Promise<void> {
    const operation = this.operation;
    if (!operation) return;
    try { await invoke('cancel_git_operation', { operationId: operation }); }
    catch (error) { this.error.set(`Could not cancel search: ${this.message(error)}`); }
  }

  async openFile(revision: string, path: string): Promise<void> {
    this.fileGeneration++;
    await this.cancelFile();
    this.fileOperation = null; this.fileBusy.set(false);
    this.fileTarget = { revision, path };
    this.files.set([]); this.fileCursor.set(null); this.fileComplete.set(false);
    await this.nextFile();
  }

  async nextFile(): Promise<void> {
    const repo = this.git.repository();
    const target = this.fileTarget;
    if (!repo || !target || this.fileBusy() || this.fileComplete()) return;
    const generation = this.fileGeneration;
    const operationId = `file-history-${crypto.randomUUID()}`;
    this.fileOperation = operationId; this.fileBusy.set(true); this.fileError.set(null);
    try {
      if (this.git.browserPreview()) throw new Error('Paginated file history requires the native desktop app.');
      const page = await invoke<FileHistoryPage>('inspect_file_history_page', {
        repoId: repo.id, ...target, cursor: this.fileCursor(), operationId,
      });
      if (generation !== this.fileGeneration || repo.id !== this.git.activeRepositoryId()) return;
      this.files.update(entries => [...entries, ...page.entries]);
      this.fileCursor.set(page.cursor); this.fileComplete.set(page.complete);
    } catch (error) {
      if (generation === this.fileGeneration) this.fileError.set(this.message(error));
    } finally {
      if (this.fileOperation === operationId) { this.fileOperation = null; this.fileBusy.set(false); }
    }
  }

  async cancelFile(): Promise<void> {
    if (!this.fileOperation) return;
    try { await invoke('cancel_git_operation', { operationId: this.fileOperation }); }
    catch (error) { this.fileError.set(`Could not cancel file history: ${this.message(error)}`); }
  }

  async navigation(oid: string, path: string): Promise<BlameNavigation> {
    const repo = this.git.repository();
    if (!repo) throw new Error('Open a repository first.');
    return invoke<BlameNavigation>('inspect_blame_navigation', { repoId: repo.id, oid, path });
  }

  async summary(oid: string): Promise<CommitSummary> {
    return invoke<CommitSummary>('inspect_history_commit', { repoId: this.git.activeRepositoryId(), oid });
  }

  async compare(base: string, target: string, mode: 'direct' | 'mergeBase'): Promise<void> {
    const repo = this.git.repository();
    if (!repo) return;
    const comparison = await invoke<CommitComparison>('compare_history_revisions', { repoId: repo.id, base, target, mode });
    if (repo.id !== this.git.activeRepositoryId()) return;
    this.git.commitDetails.set(null); this.git.commitFileDiff.set(null);
    this.git.commitComparison.set({ ...comparison, comparisonMode: mode });
    this.git.comparisonFileDiff.set(null);
    if (comparison.files[0]) await this.git.inspectComparisonFile(comparison.files[0]);
  }
}
