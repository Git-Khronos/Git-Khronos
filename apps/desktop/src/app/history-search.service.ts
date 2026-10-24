import { Injectable, effect, inject, signal } from '@angular/core';
import { ipc } from '@git-khronos/contracts';
import type { BlameNavigation, CommitComparison, CommitSummary, FileHistoryCursor, FileHistoryPage, HistoricalFileEntry, HistoryCursor, HistoryQuery, HistorySearchPage } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

export const emptyHistoryQuery = (): HistoryQuery => ({
  message: '', author: '', oid: '', since: '', until: '', path: '', scope: '',
});

const searchPrompt = 'Enter filters and search all repository refs, independently of graph visibility.';

@Injectable({ providedIn: 'root' })
export class HistorySearchService {
  private readonly git = inject(GitKhronosService);
  readonly entries = signal<HistorySearchPage['entries']>([]);
  readonly cursor = signal<HistoryCursor | null>(null);
  readonly complete = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal(searchPrompt);
  readonly files = signal<HistoricalFileEntry[]>([]);
  readonly fileCursor = signal<FileHistoryCursor | null>(null);
  readonly fileComplete = signal(false);
  readonly fileBusy = signal(false);
  readonly fileError = signal<string | null>(null);
  private query = emptyHistoryQuery();
  private readonly fileTarget = signal<{ repoId: string; revision: string; path: string } | null>(null);
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
    this.clearSearch(); this.clearFileSearch(); this.fileTarget.set(null);
    this.status.set(searchPrompt);
    await cancellation;
  }

  private clearSearch(): void {
    this.operation = null; this.busy.set(false);
    this.entries.set([]); this.cursor.set(null); this.complete.set(false); this.error.set(null);
  }

  private clearFileSearch(): void {
    this.fileOperation = null; this.fileBusy.set(false);
    this.files.set([]); this.fileCursor.set(null); this.fileComplete.set(false); this.fileError.set(null);
  }

  async search(query: HistoryQuery): Promise<void> {
    const generation = ++this.generation;
    const repoId = this.git.activeRepositoryId();
    const submitted = { ...query };
    await this.cancel();
    // A later search or repository reset owns the continuation now.
    if (generation !== this.generation || repoId !== this.git.activeRepositoryId()) return;
    this.clearSearch();
    this.query = submitted;
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
      const page = await ipc.search_repository_history({
        repoId: repo.id, query: this.query, cursor: this.cursor(), operationId,
      });
      if (generation !== this.generation || repo.id !== this.git.activeRepositoryId()) return;
      this.entries.update(entries => [...entries, ...page.entries]);
      this.cursor.set(page.cursor); this.complete.set(page.complete);
      this.status.set(`${this.entries().length} results${page.complete
        ? ' · search complete for locally available history at the pinned refs'
        : ' so far · more history remains (continue searching)'}`);
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
    const generation = this.generation;
    if (!operation) return;
    try { await ipc.cancel_git_operation({ operationId: operation }); }
    catch (error) {
      if (operation === this.operation && generation === this.generation) {
        this.error.set(`Could not cancel search: ${this.message(error)}`);
      }
    }
  }

  async openFile(revision: string, path: string): Promise<void> {
    const generation = ++this.fileGeneration;
    const repoId = this.git.activeRepositoryId();
    // Old rows must not be presented or resumed while a replacement awaits cancellation.
    this.fileTarget.set(null);
    await this.cancelFile();
    if (generation !== this.fileGeneration || repoId !== this.git.activeRepositoryId()) return;
    this.clearFileSearch();
    if (!repoId) return;
    this.fileTarget.set({ repoId, revision, path });
    await this.nextFile();
  }

  matchesFile(revision: string, path: string): boolean {
    const target = this.fileTarget();
    return !!target && target.repoId === this.git.activeRepositoryId()
      && target.revision === revision && target.path === path;
  }

  async resumeFile(revision: string, path: string): Promise<void> {
    if (!this.matchesFile(revision, path)) await this.openFile(revision, path);
  }

  async nextFile(): Promise<void> {
    const repo = this.git.repository();
    const target = this.fileTarget();
    if (!repo || !target || target.repoId !== repo.id || this.fileBusy() || this.fileComplete()) return;
    const generation = this.fileGeneration;
    const operationId = `file-history-${crypto.randomUUID()}`;
    this.fileOperation = operationId; this.fileBusy.set(true); this.fileError.set(null);
    try {
      if (this.git.browserPreview()) throw new Error('Paginated file history requires the native desktop app.');
      const page = await ipc.inspect_file_history_page({
        repoId: repo.id, revision: target.revision, path: target.path, cursor: this.fileCursor(), operationId,
      });
      if (generation !== this.fileGeneration || repo.id !== this.git.activeRepositoryId()) return;
      this.files.update(entries => [...entries, ...page.entries]);
      this.fileCursor.set(page.cursor); this.fileComplete.set(page.complete);
    } catch (error) {
      if (generation === this.fileGeneration && repo.id === this.git.activeRepositoryId()
        && target === this.fileTarget()) this.fileError.set(this.message(error));
    } finally {
      if (this.fileOperation === operationId) { this.fileOperation = null; this.fileBusy.set(false); }
    }
  }

  async cancelFile(): Promise<void> {
    const operation = this.fileOperation;
    const generation = this.fileGeneration;
    if (!operation) return;
    try { await ipc.cancel_git_operation({ operationId: operation }); }
    catch (error) {
      if (operation === this.fileOperation && generation === this.fileGeneration) {
        this.fileError.set(`Could not cancel file history: ${this.message(error)}`);
      }
    }
  }

  async navigation(oid: string, path: string): Promise<BlameNavigation> {
    const repo = this.git.repository();
    if (!repo) throw new Error('Open a repository first.');
    return ipc.inspect_blame_navigation({ repoId: repo.id, oid, path });
  }

  async summary(oid: string): Promise<CommitSummary> {
    const repoId = this.git.activeRepositoryId();
    if (!repoId) throw new Error('Open a repository first.');
    return ipc.inspect_history_commit({ repoId, oid });
  }

  compare(base: string, target: string, mode: 'direct' | 'mergeBase'): Promise<boolean> {
    return this.git.compareCommits(base, target, mode);
  }

  cancelComparison(): void {
    this.git.cancelHistoryComparison();
  }
}
