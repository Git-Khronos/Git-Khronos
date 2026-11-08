import { Injectable, effect, inject, signal } from '@angular/core';
import { ipc } from '@git-khronos/contracts';
import type { BlameNavigation, CommitComparison, CommitSummary, FileHistoryCursor, FileHistoryPage, HistoricalFileEntry, HistoryCursor, HistoryQuery, HistorySearchPage } from '@git-khronos/contracts';
import { CancellableOperation } from './cancellable-operation';
import { GitKhronosService } from './git-khronos.service';

interface HistoryReadOperation {
  read: CancellableOperation;
  dismissed: boolean;
  generation: number;
}

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
  readonly cancelling = signal(false);
  readonly cancellationRequested = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal(searchPrompt);
  readonly files = signal<HistoricalFileEntry[]>([]);
  readonly fileCursor = signal<FileHistoryCursor | null>(null);
  readonly fileComplete = signal(false);
  readonly fileBusy = signal(false);
  readonly fileCancelling = signal(false);
  readonly fileCancellationRequested = signal(false);
  readonly fileError = signal<string | null>(null);
  private query = emptyHistoryQuery();
  private readonly fileTarget = signal<{ repoId: string; revision: string; path: string } | null>(null);
  private operation: HistoryReadOperation | null = null;
  private fileOperation: HistoryReadOperation | null = null;
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
    this.operation = null; this.busy.set(false); this.cancelling.set(false); this.cancellationRequested.set(false);
    this.entries.set([]); this.cursor.set(null); this.complete.set(false); this.error.set(null);
  }

  private clearFileSearch(): void {
    this.fileOperation = null; this.fileBusy.set(false); this.fileCancelling.set(false); this.fileCancellationRequested.set(false);
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
    const operation: HistoryReadOperation = {
      read: new CancellableOperation(`history-${crypto.randomUUID()}`), dismissed: false, generation,
    };
    this.operation = operation;
    this.busy.set(true); this.cancellationRequested.set(false); this.error.set(null); this.status.set('Searching a bounded history page…');
    try {
      // Preview is deliberately not a loaded-row fallback: native search must own results.
      if (this.git.browserPreview()) throw new Error('Whole-repository search requires the native desktop app.');
      const page = await ipc.search_repository_history({
        repoId: repo.id, query: this.query, cursor: this.cursor(), operationId: operation.read.id,
      });
      if (generation !== this.generation || repo.id !== this.git.activeRepositoryId()) return;
      if (operation.dismissed) {
        this.dismissSearchPage();
        return;
      }
      this.entries.update(entries => [...entries, ...page.entries]);
      this.cursor.set(page.cursor); this.complete.set(page.complete);
      this.status.set(`${this.entries().length} results${page.complete
        ? ' · search complete for locally available history at the pinned refs'
        : ' so far · more history remains (continue searching)'}`);
    } catch (error) {
      if (generation === this.generation && repo.id === this.git.activeRepositoryId()) {
        if (operation.dismissed) {
          this.dismissSearchPage();
        } else {
          this.error.set(this.message(error));
          this.status.set('Search incomplete. Previously returned results are retained; retry or narrow filters.');
        }
      }
    } finally {
      operation.read.finish();
      if (this.operation === operation) {
        this.operation = null; this.busy.set(false); this.cancelling.set(false);
      }
    }
  }

  private dismissSearchPage(): void {
    this.error.set('The current page was discarded after cancellation was requested.');
    this.status.set('Search incomplete. Previously returned results are retained; retry or narrow filters.');
  }

  async cancel(): Promise<void> {
    const operation = this.operation;
    if (!operation) return;
    operation.dismissed = true;
    this.cancellationRequested.set(true); this.cancelling.set(true);
    if (operation.generation === this.generation) this.status.set('Stopping repository search…');
    const result = await operation.read.cancel();
    if (!operation.read.settled && (result === 'unacknowledged' || typeof result === 'object')) {
      const detail = result === 'unacknowledged'
        ? 'Cancellation was not acknowledged.'
        : `Could not confirm cancellation: ${this.message(result.error)}.`;
      this.git.reportBackgroundOperationWarning(operation.read.id, `${detail} The repository search may still be running.`);
      if (operation === this.operation && operation.generation === this.generation) {
        this.status.set('Cancellation not confirmed. Retry, or wait for the search to finish.');
      }
    }
    if (operation === this.operation && result !== 'accepted') this.cancelling.set(false);
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
    const operation: HistoryReadOperation = {
      read: new CancellableOperation(`file-history-${crypto.randomUUID()}`), dismissed: false, generation,
    };
    this.fileOperation = operation; this.fileBusy.set(true); this.fileCancellationRequested.set(false); this.fileError.set(null);
    try {
      if (this.git.browserPreview()) throw new Error('Paginated file history requires the native desktop app.');
      const page = await ipc.inspect_file_history_page({
        repoId: repo.id, revision: target.revision, path: target.path, cursor: this.fileCursor(), operationId: operation.read.id,
      });
      if (generation !== this.fileGeneration || repo.id !== this.git.activeRepositoryId()) return;
      if (operation.dismissed) {
        this.fileError.set('File history stopped. Retry to load this page.');
        return;
      }
      this.files.update(entries => [...entries, ...page.entries]);
      this.fileCursor.set(page.cursor); this.fileComplete.set(page.complete);
    } catch (error) {
      if (generation === this.fileGeneration && repo.id === this.git.activeRepositoryId()
        && target === this.fileTarget()) this.fileError.set(operation.dismissed
          ? 'File history stopped. Retry to load this page.'
          : this.message(error));
    } finally {
      operation.read.finish();
      if (this.fileOperation === operation) {
        this.fileOperation = null; this.fileBusy.set(false); this.fileCancelling.set(false);
      }
    }
  }

  async cancelFile(): Promise<void> {
    const operation = this.fileOperation;
    if (!operation) return;
    operation.dismissed = true;
    this.fileCancellationRequested.set(true); this.fileCancelling.set(true);
    const result = await operation.read.cancel();
    if (!operation.read.settled && (result === 'unacknowledged' || typeof result === 'object')) {
      const detail = result === 'unacknowledged'
        ? 'Cancellation was not acknowledged.'
        : `Could not confirm cancellation: ${this.message(result.error)}.`;
      this.git.reportBackgroundOperationWarning(operation.read.id, `${detail} The file history may still be running.`);
    }
    if (operation === this.fileOperation && result !== 'accepted') this.fileCancelling.set(false);
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
