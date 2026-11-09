import { HostingPanelComponent } from './hosting-panel.component';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, OnDestroy, afterNextRender, afterRenderEffect, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ipc, type RepositoryFiles, type RepositorySnapshot } from '@git-khronos/contracts';
import { open } from '@tauri-apps/plugin-dialog';
import { GitKhronosService } from './git-khronos.service';
import { IDENTITY_PROFILES_KEY, parseIdentityProfiles, validIdentityProfile, type IdentityProfile } from './identity-profiles';
import { runWorkspaceRemote } from './workspace-actions';
import { runRepositoryFileAction } from './repository-file-actions';
import { BackgroundOperationWarningsComponent } from './background-operation-warnings.component';

export interface WorkspaceCenterRequest { workspaceId: string; panel: 'overview' | 'identities' | 'hosting' | 'files'; returnFocus: HTMLElement | null }
interface WorkspaceActionResult { id: string; path: string; action: 'fetch' | 'pull' | 'open'; status: 'pending' | 'success' | 'error' | 'cancelled'; detail: string | null }

@Component({
  selector: 'gc-workspace-center',
  imports: [BackgroundOperationWarningsComponent, DatePipe, HostingPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" [inert]="suspended()" (click)="close()"><section #dialog role="dialog" aria-modal="true" aria-label="Workspace center" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
      <div [inert]="!!pendingFileDelete()">
      <header><div><h2 id="workspace-center-title">Workspace center</h2><p>{{ git.activeWorkspace().name }}</p></div><button type="button" (click)="close()">Close</button></header>
      @if (!suspended() && git.backgroundOperationWarnings().length) { <gc-background-operation-warnings /> }
      <nav aria-label="Workspace center sections"><button type="button" [attr.aria-pressed]="panel() === 'overview'" (click)="panel.set('overview')">Repository overview</button><button type="button" [attr.aria-pressed]="panel() === 'files'" (click)="panel.set('files')">Repository files</button><button type="button" [attr.aria-pressed]="panel() === 'identities'" (click)="panel.set('identities')">Identity profiles</button><button type="button" [attr.aria-pressed]="panel() === 'hosting'" (click)="panel.set('hosting')">Reviews and checks</button></nav>
      @if (panel() === 'overview') {
        <p>Local repository state. Ahead and behind counts use tracking references already fetched.</p>
        <div class="tools"><label>Filter repositories<input #filter type="search" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
          <label><input type="checkbox" [checked]="attentionOnly()" (change)="attentionOnly.set($any($event.target).checked)" />Needs attention</label>
          <button type="button" [disabled]="git.busy() || refreshing() || openingRepositories() || bulkRunning() || git.browserPreview() || !git.repositories().length" (click)="refresh()">{{ refreshing() ? 'Refreshing…' : 'Refresh local state' }}</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || git.browserPreview()" (click)="openMultipleRepositories()">Open multiple repositories…</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || !rows().length" (click)="selectShown()">Select shown</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || !selectedRepositoryIds().length" (click)="selectedRepositoryIds.set([])">Clear selection</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || git.browserPreview() || !selectedRepositoryIds().length" (click)="runBulk('fetch')">Fetch selected ({{ selectedRepositoryIds().length }})</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || git.browserPreview() || !selectedRepositoryIds().length" (click)="runBulk('pull')">Pull selected ({{ selectedRepositoryIds().length }})</button></div>
        <p role="status">{{ rows().length }} of {{ git.repositories().length }} open repositories shown{{ refreshing() ? ' · reading local repositories' : '' }}</p>
        @if (bulkError()) { <p role="alert">{{ bulkError() }}</p> }
        @if (bulkResults().length) {
          <aside aria-label="Repository action results"><h3>Repository action results</h3><ul>@for (result of bulkResults(); track result.id + result.action) {
            <li><strong>{{ git.pathLabel(result.path) }}</strong> — {{ result.status }}{{ result.detail ? ': ' + result.detail : '' }}</li>
          }</ul></aside>
        }
        <div class="repositories" aria-label="Workspace repositories">
          @for (repo of rows(); track repo.id) {
            <article [attr.aria-label]="repo.name"><header><label><input type="checkbox" [checked]="selectedRepositoryIds().includes(repo.id)" [disabled]="git.busy() || openingRepositories() || bulkRunning()" (change)="toggleSelected(repo.id, $any($event.target).checked)" />Select {{ git.pathLabel(repo.path) }}</label><div><h3>{{ git.pathLabel(repo.path) }}</h3><code>{{ repo.path }}</code></div><button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning()" (click)="activate(repo.id)">Open repository</button></header>
              <dl><dt>Checkout</dt><dd>{{ repo.status.branch ?? (repo.headOid ? 'Detached HEAD' : 'Unborn HEAD') }}{{ repo.bare ? ' · bare repository' : '' }}</dd>
              <dt>Working tree</dt><dd>{{ repo.status.staged }} staged · {{ repo.status.unstaged }} unstaged · {{ repo.status.untracked }} untracked · {{ repo.status.conflicted }} conflicts{{ repo.status.entriesTruncated ? ' · file list truncated' : '' }}</dd>
              <dt>Tracking</dt><dd>{{ tracking(repo) }}</dd>
              <dt>Operation</dt><dd>{{ operation(repo) }}</dd></dl>
              @if (refreshes()[repo.id]; as result) {
                @if (result.error) { <p role="alert">Refresh failed: {{ result.error }}. Displaying cached state.</p> }
                @else { <small>Read locally at {{ result.at | date:'mediumTime' }}</small> }
              } @else { <small>Cached state. Refresh to check local changes.</small> }
            </article>
          } @empty { <p>{{ git.repositories().length ? 'No repositories match these filters.' : 'Open a repository in this workspace to see its status.' }}</p> }
        </div>
      } @else if (panel() === 'files') {
        <p>Browse repository files, including ignored files. Git metadata, nested repositories and symbolic-link targets are excluded. Deleting ignored files is disabled because they are not covered by Git recovery. Tracked deletion requires a clean committed file without index flags that hide changes.</p>
        @if (fileError()) { <p role="alert">{{ fileError() }}</p> }
        @if (fileNotice()) { <p role="status">{{ fileNotice() }}</p> }
        <p>Creating files is currently limited to root-level paths on Windows; other platforms and subdirectories are refused for safety.</p>
        <div class="tools file-tools">
          <label>Filter files<input type="search" [value]="fileQuery()" (input)="changeFileQuery($any($event.target).value)" /></label>
          <form (submit)="$event.preventDefault(); createFile()">
            <label>Create an empty file<input aria-label="New repository-relative file path" maxlength="16384" [value]="newFilePath()" (input)="newFilePath.set($any($event.target).value)" placeholder="path/to/file.txt" /></label>
            <button type="submit" [disabled]="git.busy() || fileMutating() || filesLoading() || !newFilePath()">Create file</button>
          </form>
          <button type="button" [disabled]="git.busy() || fileMutating() || filesLoading()" (click)="loadFiles()">{{ filesLoading() ? 'Loading…' : 'Refresh files' }}</button>
        </div>
        @if (filesLoading()) { <p role="status">Reading repository files…</p> }
        @if (files(); as fileList) {
          <p role="status">Showing {{ fileList.files.length }} files · page {{ filePage() + 1 }}</p>
          @if (fileList.incomplete) { <p role="alert">Some matching paths could not be displayed safely. Check file permissions or excluded repository boundaries and refresh.</p> }
          <div class="file-list" aria-label="Repository files">
            @for (file of fileList.files; track file.path) {
              <article class="file-entry"><code>{{ file.path }}</code><span>{{ file.symbolicLink ? 'Symbolic link' : file.ignored ? 'Ignored · read-only' : file.tracked ? (file.deletable ? 'Tracked' : 'Tracked · deletion unavailable') : 'Untracked' }}</span>
                <div class="tools"><button type="button" [disabled]="file.symbolicLink || git.busy() || fileMutating()" (click)="openFileRequested.emit(file)">Open</button>
                  @if (file.tracked && file.deletable && !file.symbolicLink) { <button type="button" class="danger" [disabled]="git.busy() || fileMutating()" (click)="confirmDelete(file)">Delete and stage</button> }
                  @else if (!file.tracked && !file.ignored && !file.symbolicLink) { <button type="button" class="danger" [disabled]="git.busy() || fileMutating()" (click)="confirmDelete(file)">Delete with recovery</button> }
                </div>
              </article>
            } @empty { <p>{{ fileList.incomplete ? 'No files could be displayed safely on this page.' : filePage() > 0 ? 'No files remain on this page. Use Previous to review earlier results.' : fileQuery().trim() ? 'No files match this filter.' : 'No Git-visible files in this repository.' }}</p> }
          </div>
        }
        @if (filePage() > 0 || files()?.nextCursor) {
          <div class="tools"><button type="button" [disabled]="filePage() === 0 || filesLoading()" (click)="previousFilePage()">Previous</button><span>Page {{ filePage() + 1 }}</span><button type="button" [disabled]="!files()?.nextCursor || filesLoading()" (click)="nextFilePage()">Next</button></div>
        }
      } @else if (panel() === 'hosting') {
        <gc-hosting-panel />
      } @else {
        <p>Save reusable commit names and email addresses on this device. Profiles contain no authentication credentials. Applying a profile writes local Git identity settings only for the displayed repository.</p>
        @if (error()) { <p role="alert">{{ error() }}</p> }
        <div class="profile-layout"><div>
          <h3>Saved identities</h3>
          @for (profile of profiles(); track profile.id) {
            <article><strong>{{ profile.label }}</strong><p>{{ profile.name }} &lt;{{ profile.email }}&gt;</p><div class="tools">
              <button type="button" (click)="edit(profile)">Edit {{ profile.label }}</button><button type="button" (click)="remove(profile.id)">Delete {{ profile.label }}</button>
              <button type="button" [disabled]="!git.repository() || git.busy()" (click)="prepareApply(profile)">Use {{ profile.label }}…</button></div></article>
          } @empty { <p>No saved identities.</p> }
        </div><form (submit)="$event.preventDefault(); save()">
          <h3>{{ editingId() ? 'Edit identity profile' : 'New identity profile' }}</h3>
          <label>Profile label<input required maxlength="320" [value]="label()" (input)="label.set($any($event.target).value)" /></label>
          <label>Commit author name<input required maxlength="320" autocomplete="name" [value]="name()" (input)="name.set($any($event.target).value)" /></label>
          <label>Commit author email<input required maxlength="320" [value]="email()" (input)="email.set($any($event.target).value)" /></label>
          @if (draftError()) { <p role="status">{{ draftError() }}</p> }
          <div class="tools"><button type="submit" [disabled]="!!draftError()">Save profile</button><button type="button" (click)="newProfile()">New profile</button>
          <button type="button" [disabled]="!git.repository()" (click)="copyCurrent()">Fill from current repository</button></div>
        </form></div>
        @if (pending(); as apply) {
          <aside aria-label="Confirm repository identity"><h3>Apply {{ apply.profile.label }}?</h3><p>{{ apply.profile.name }} &lt;{{ apply.profile.email }}&gt;</p><p>Repository: <code>{{ apply.path }}</code></p><p>Future commits will use this identity. Local settings are shared by linked worktrees. Existing commits and global Git settings remain unchanged.</p>
          <div class="tools"><button type="button" (click)="pending.set(null)">Cancel identity change</button><button type="button" [disabled]="git.busy()" (click)="applyIdentity()">Apply to this repository</button></div></aside>
        }
        @if (notice()) { <p role="status">{{ notice() }}</p> }
      }
      </div>
      @if (pendingFileDelete(); as deletion) {
        <aside #deleteDialog role="alertdialog" aria-modal="true" aria-labelledby="file-delete-title" tabindex="-1" [attr.aria-busy]="fileMutating()">
          <h3 id="file-delete-title">Delete {{ deletion.file.path }}?</h3>
          @if (deletion.file.tracked) { <p>This clean committed file will be removed from disk and its deletion staged. The current commit retains its contents.</p> }
          @else { <p>This untracked file will be removed from disk and saved to Recovery History so it can be restored.</p> }
          @if (fileError()) { <p role="alert">{{ fileError() }}</p> }
          <div class="tools"><button #deleteCancel type="button" [disabled]="git.busy() || fileMutating()" (click)="cancelDelete()">Cancel</button><button type="button" class="danger" [disabled]="git.busy() || fileMutating()" (click)="deleteFile()">Delete file</button></div>
        </aside>
      }
    </section></div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 65; background: #080811b8; display: grid; place-items: center; padding: 18px; }
    section { box-sizing: border-box; width: min(900px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; color: var(--text); background: var(--inspector-list); border: 1px solid var(--inspector-divider); border-radius: 7px; }
    header, nav, .tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; } nav { justify-content: start; margin: 12px 0; }
    h2 { font-size: 18px; margin: 0; } h3 { font-size: 14px; margin: 0 0 8px; } p, dd, dt, label, small, code { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    article, aside, form { border: 1px solid var(--inspector-divider); border-radius: 5px; padding: 14px; margin: 12px 0; } article p { margin: 8px 0; }
    dl { display: grid; grid-template-columns: max-content minmax(0,1fr); gap: 4px 16px; } dd { margin: 0; } label { display: block; } form input, input[type=search] { display: block; box-sizing: border-box; width: 100%; margin: 4px 0 10px; } form label { margin-bottom: 10px; }
    button, input { color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); padding: 7px 10px; min-height: 32px; } input[type=checkbox] { min-height: auto; }
    button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button[aria-pressed=true] { border-color: var(--accent); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } [role=alert] { color: var(--danger); }
    .profile-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .profile-layout > * { min-width: 0; } .tools { justify-content: start; }
    gc-background-operation-warnings { position: sticky; top: 0; z-index: 1; background: var(--inspector-list); }
    .repositories article > header { align-items: start; } .repositories article > header > label { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; } .repositories article > header > div { min-width: 0; flex: 1; }
    .file-tools { align-items: end; } .file-tools > label, .file-tools form { flex: 1 1 220px; min-width: 180px; } .file-tools form { display: flex; align-items: end; gap: 8px; } .file-tools form label { flex: 1; }
    .file-list { max-height: 45vh; overflow: auto; } .file-entry { display: grid; grid-template-columns: minmax(0,1fr) max-content max-content; align-items: center; gap: 10px; } .file-entry code { white-space: break-spaces; overflow-wrap: anywhere; } .danger { color: var(--danger); }
    @media(max-width:650px) {
      .profile-layout, dl, .file-entry { grid-template-columns: 1fr; }
      .file-entry { align-items: start; gap: 6px; }
      .file-tools form { flex-wrap: wrap; }
      .file-tools form label { flex: 1 1 100%; }
    }
  `],
})
export class WorkspaceCenterComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<WorkspaceCenterRequest>();
  readonly suspended = input(false);
  readonly closed = output<void>();
  readonly repositorySelected = output<string>();
  readonly openFileRequested = output<RepositoryFiles['files'][number]>();
  readonly panel = signal<'overview' | 'identities' | 'hosting' | 'files'>('overview');
  readonly query = signal('');
  readonly attentionOnly = signal(false);
  readonly refreshing = signal(false);
  readonly refreshes = signal<Record<string, { at: number | null; error: string | null }>>({});
  readonly selectedRepositoryIds = signal<string[]>([]);
  readonly bulkResults = signal<WorkspaceActionResult[]>([]);
  readonly openingRepositories = signal(false);
  readonly bulkRunning = signal(false);
  readonly bulkError = signal('');
  readonly profiles = signal<IdentityProfile[]>([]);
  readonly editingId = signal<string | null>(null);
  readonly label = signal(''); readonly name = signal(''); readonly email = signal('');
  readonly error = signal(''); readonly notice = signal('');
  readonly pending = signal<{ profile: IdentityProfile; repositoryId: string; path: string } | null>(null);
  readonly files = signal<RepositoryFiles | null>(null);
  readonly filesLoading = signal(false);
  readonly fileMutating = signal(false);
  readonly fileError = signal('');
  readonly fileNotice = signal('');
  readonly fileQuery = signal('');
  readonly newFilePath = signal('');
  readonly filePage = signal(0);
  readonly pendingFileDelete = signal<{ file: RepositoryFiles['files'][number]; repositoryId: string; path: string } | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly deleteDialog = viewChild<ElementRef<HTMLElement>>('deleteDialog');
  private readonly deleteCancel = viewChild<ElementRef<HTMLButtonElement>>('deleteCancel');
  private readonly injector = inject(Injector);
  private deleteOpener: HTMLElement | null = null;
  private fileRequest = 0;
  private fileCursors: (string | null)[] = [null];
  private fileQueryTimer: ReturnType<typeof setTimeout> | null = null;
  private filePanelActive = false;
  private fileBinding: { repositoryId: string; path: string } | null = null;
  private destroyed = false;
  readonly draftError = computed(() => {
    if (!validIdentityProfile({ id: this.editingId() ?? 'new', label: this.label().trim(), name: this.name().trim(), email: this.email().trim() })) return 'Enter a label, name and email without control characters.';
    if (this.profiles().some(item => item.id !== this.editingId() && item.label.toLocaleLowerCase() === this.label().trim().toLocaleLowerCase())) return 'Choose a different profile label.';
    if (!this.editingId() && this.profiles().length >= 50) return 'Up to 50 profiles can be saved.';
    return '';
  });
  readonly rows = computed(() => this.git.repositories().filter(repo => {
    const query = this.query().trim().toLocaleLowerCase();
    return (!query || `${repo.name} ${repo.path} ${this.git.pathLabel(repo.path)} ${repo.status.branch ?? ''}`.toLocaleLowerCase().includes(query))
      && (!this.attentionOnly() || this.needsAttention(repo) || !!this.refreshes()[repo.id]?.error);
  }));
  constructor() {
    try { this.profiles.set(parseIdentityProfiles(localStorage.getItem(IDENTITY_PROFILES_KEY))); }
    catch { this.error.set('Saved identities could not be read from device storage.'); }
    effect(() => this.panel.set(this.request().panel));
    effect(() => {
      const panel = this.panel();
      const repositoryId = this.git.activeRepositoryId();
      const path = this.git.repository()?.path ?? null;
      untracked(() => {
        if (panel !== 'files') {
          this.filePanelActive = false;
          this.invalidateFileRequest();
        } else if (!this.filePanelActive || this.fileBinding?.repositoryId !== repositoryId || this.fileBinding?.path !== path) {
          this.filePanelActive = true;
          this.fileCursors = [null];
          this.filePage.set(0);
          this.pendingFileDelete.set(null);
          this.fileNotice.set('');
          void this.loadFiles();
        }
      });
    });
    effect(() => { if (this.request().workspaceId !== this.git.activeWorkspaceId()) { this.pendingFileDelete.set(null); this.close(); } });
    effect(() => { const pending = this.pending(); if (pending && (pending.repositoryId !== this.git.activeRepositoryId() || pending.path !== this.git.repository()?.path)) this.pending.set(null); });
    afterNextRender(() => this.focusFirst());
    afterRenderEffect(() => {
      if (this.pendingFileDelete()) {
        if (this.fileMutating()) this.deleteDialog()?.nativeElement.focus();
        else this.deleteCancel()?.nativeElement.focus();
      }
    });
  }
  needsAttention(repo: RepositorySnapshot): boolean { const s = repo.status; return !!(s.staged || s.unstaged || s.untracked || s.conflicted || s.ahead || s.behind || s.mergeInProgress || s.rebaseInProgress || s.historyOperation || s.mailPatchInProgress || s.bisectInProgress); }
  tracking(repo: RepositorySnapshot): string { const branch = repo.branches.find(item => item.current); return branch?.upstream ? `${branch.upstream}: ${repo.status.ahead} ahead · ${repo.status.behind} behind` : 'No upstream configured'; }
  operation(repo: RepositorySnapshot): string { const s = repo.status; return [s.mergeInProgress ? 'Merge' : '', s.rebaseInProgress ? 'Rebase' : '', s.historyOperation ?? '', s.mailPatchInProgress ? 'Mail patch' : '', s.bisectInProgress ? 'Bisect' : ''].filter(Boolean).join(' · ') || 'None'; }
  async refresh(): Promise<void> {
    if (this.refreshing() || this.openingRepositories() || this.git.busy()) return;
    this.refreshing.set(true);
    try { const results = await this.git.refreshWorkspaceOverview(); if (!this.destroyed && this.request().workspaceId === this.git.activeWorkspaceId()) this.refreshes.set(results); }
    finally { this.refreshing.set(false); }
  }
  private invalidateFileRequest(): void {
    this.fileRequest += 1;
    if (this.fileQueryTimer !== null) clearTimeout(this.fileQueryTimer);
    this.fileQueryTimer = null;
    this.filesLoading.set(false);
  }
  changeFileQuery(value: string): void {
    this.fileQuery.set(value);
    this.invalidateFileRequest();
    this.fileCursors = [null];
    this.filePage.set(0);
    this.files.set(null);
    this.fileError.set('');
    this.filesLoading.set(true);
    this.fileQueryTimer = setTimeout(() => {
      this.fileQueryTimer = null;
      void this.loadFiles();
    }, 150);
  }
  previousFilePage(): void {
    if (this.filesLoading() || this.filePage() === 0) return;
    this.filePage.update(page => page - 1);
    void this.loadFiles();
  }
  nextFilePage(): void {
    const cursor = this.files()?.nextCursor;
    if (this.filesLoading() || !cursor) return;
    this.fileCursors = [...this.fileCursors.slice(0, this.filePage() + 1), cursor];
    this.filePage.update(page => page + 1);
    void this.loadFiles();
  }
  async loadFiles(): Promise<boolean> {
    const request = ++this.fileRequest;
    const repository = this.git.repository();
    const repositoryId = this.git.activeRepositoryId();
    const workspaceId = this.request().workspaceId;
    if (!repository || !repositoryId || repository.bare) {
      this.files.set(null);
      this.filesLoading.set(false);
      this.fileError.set('Open a non-bare repository to browse its files.');
      return false;
    }
    if (!this.fileBinding || this.fileBinding.repositoryId !== repositoryId || this.fileBinding.path !== repository.path) {
      this.fileBinding = { repositoryId, path: repository.path };
      this.files.set(null);
    }
    this.filesLoading.set(true);
    this.files.set(null);
    this.fileError.set('');
    try {
      const result = await ipc.list_repository_files({
        repoId: repositoryId,
        query: this.fileQuery().trim(),
        cursor: this.fileCursors[this.filePage()] ?? null,
      });
      if (!this.destroyed && request === this.fileRequest && this.panel() === 'files' && workspaceId === this.git.activeWorkspaceId() && this.git.activeRepositoryId() === repositoryId && this.git.repository()?.path === repository.path) {
        this.files.set(result);
        return true;
      }
    } catch (error: unknown) {
      if (!this.destroyed && request === this.fileRequest && workspaceId === this.git.activeWorkspaceId() && this.git.activeRepositoryId() === repositoryId && this.git.repository()?.path === repository.path) this.fileError.set(this.git.formatError(error));
    } finally {
      if (!this.destroyed && request === this.fileRequest) this.filesLoading.set(false);
    }
    return false;
  }
  async createFile(): Promise<void> {
    const repository = this.git.repository();
    const repositoryId = this.git.activeRepositoryId();
    const path = this.newFilePath();
    if (!repository || !repositoryId || !path || this.git.busy() || this.fileMutating() || this.filesLoading()) return;
    const workspaceId = this.request().workspaceId;
    const current = () => !this.destroyed && workspaceId === this.git.activeWorkspaceId()
      && this.git.activeRepositoryId() === repositoryId && this.git.repository()?.path === repository.path;
    this.fileMutating.set(true);
    this.fileError.set('');
    this.fileNotice.set('');
    try {
      const result = await runRepositoryFileAction(
        this.git, this.git.repositoryFileActionLifecycle(repositoryId), 'create', repositoryId, repository.path, path,
      );
      if (!current()) return;
      if (result.status !== 'success') {
        this.fileError.set([result.error ?? 'The file could not be created.', result.refreshError ? `Repository refresh also failed: ${result.refreshError}` : ''].filter(Boolean).join(' '));
        return;
      }
      this.newFilePath.set('');
      this.fileNotice.set(`Created ${path}. Open it to edit or stage it from the working tree.`);
      const loaded = await this.loadFiles();
      if (!current()) return;
      const listError = loaded ? '' : this.fileError();
      this.fileError.set([
        result.refreshError ? `The file was created, but repository refresh failed: ${result.refreshError}` : '',
        listError ? `The file was created, but the file list could not be refreshed: ${listError}` : '',
      ].filter(Boolean).join(' '));
    } catch (error: unknown) {
      if (current()) this.fileError.set(this.git.formatError(error));
    } finally { if (!this.destroyed) this.fileMutating.set(false); }
  }
  confirmDelete(file: RepositoryFiles['files'][number]): void {
    const repository = this.git.repository();
    const repositoryId = this.git.activeRepositoryId();
    if (!repository || !repositoryId || this.git.busy() || this.fileMutating() || file.ignored || file.symbolicLink || (file.tracked && !file.deletable)) return;
    this.deleteOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.fileError.set('');
    this.fileNotice.set('');
    this.pendingFileDelete.set({ file, repositoryId, path: repository.path });
  }
  async deleteFile(): Promise<void> {
    const pending = this.pendingFileDelete();
    if (this.fileMutating() || this.git.busy()) return;
    if (!pending || pending.repositoryId !== this.git.activeRepositoryId() || pending.path !== this.git.repository()?.path) {
      this.pendingFileDelete.set(null);
      return;
    }
    const workspaceId = this.request().workspaceId;
    const current = () => !this.destroyed && workspaceId === this.git.activeWorkspaceId()
      && this.git.activeRepositoryId() === pending.repositoryId && this.git.repository()?.path === pending.path;
    const restoreFileFocus = () => afterNextRender(() => {
      const active = document.activeElement;
      if (!current() || this.panel() !== 'files' || this.pendingFileDelete() || this.suspended()
        || (active && active !== document.body && active !== document.documentElement)) return;
      this.focusFirst();
    }, { injector: this.injector });
    this.fileMutating.set(true);
    this.fileError.set('');
    this.fileNotice.set('');
    try {
      const result = await runRepositoryFileAction(
        this.git, this.git.repositoryFileActionLifecycle(pending.repositoryId),
        pending.file.tracked ? 'delete-tracked' : 'delete-untracked', pending.repositoryId, pending.path, pending.file.path,
      );
      if (!current()) return;
      if (result.status !== 'success') {
        let listError = '';
        if (result.mayHaveChanged) {
          this.pendingFileDelete.set(null);
          this.deleteOpener = null;
          restoreFileFocus();
          const loaded = await this.loadFiles();
          if (!current()) return;
          listError = loaded ? '' : this.fileError();
        }
        this.fileError.set([
          result.error ?? 'The file could not be deleted.',
          result.refreshError ? `Repository refresh also failed: ${result.refreshError}` : '',
          listError ? `The file list could not be refreshed: ${listError}` : '',
        ].filter(Boolean).join(' '));
        return;
      }
      this.pendingFileDelete.set(null);
      this.deleteOpener = null;
      restoreFileFocus();
      this.fileNotice.set(pending.file.tracked
        ? `Staged deletion of ${pending.file.path}. Its committed contents remain recoverable from history.`
        : `Deleted ${pending.file.path} and saved it to Recovery History.`);
      const loaded = await this.loadFiles();
      if (!current()) return;
      const listError = loaded ? '' : this.fileError();
      this.fileError.set([
        result.refreshError ? `The file was deleted, but repository refresh failed: ${result.refreshError}` : '',
        listError ? `The file was deleted, but the file list could not be refreshed: ${listError}` : '',
      ].filter(Boolean).join(' '));
    } catch (error: unknown) {
      if (current()) this.fileError.set(this.git.formatError(error));
    } finally { if (!this.destroyed) this.fileMutating.set(false); }
  }
  cancelDelete(): void {
    if (this.fileMutating() || this.git.busy()) return;
    this.pendingFileDelete.set(null);
    const opener = this.deleteOpener;
    this.deleteOpener = null;
    afterNextRender(() => {
      if (this.destroyed || this.pendingFileDelete() || this.suspended()) return;
      if (opener?.isConnected) opener.focus();
      else this.focusFirst();
    }, { injector: this.injector });
  }
  activate(repositoryId: string): void { if (!this.git.busy() && !this.openingRepositories() && !this.bulkRunning()) { this.repositorySelected.emit(repositoryId); this.close(false); } }
  toggleSelected(repositoryId: string, selected: boolean): void {
    this.selectedRepositoryIds.update(ids => selected
      ? ids.includes(repositoryId) ? ids : [...ids, repositoryId]
      : ids.filter(id => id !== repositoryId));
  }
  selectShown(): void { this.selectedRepositoryIds.set([...new Set([...this.selectedRepositoryIds(), ...this.rows().map(repo => repo.id)])]); }
  async runBulk(action: 'fetch' | 'pull'): Promise<void> {
    if (this.git.busy() || this.openingRepositories() || this.bulkRunning() || this.git.browserPreview() || !this.selectedRepositoryIds().length) return;
    this.bulkError.set('');
    this.bulkRunning.set(true);
    const workspaceId = this.git.activeWorkspaceId();
    const selected = this.selectedRepositoryIds().map(id => this.git.repositories().find(repo => repo.id === id)).filter((repo): repo is RepositorySnapshot => !!repo);
    this.bulkResults.set(selected.map(repo => ({ id: repo.id, path: repo.path, action, status: 'pending', detail: null })));
    try {
      for (const repository of selected) {
        if (this.destroyed) return;
        if (workspaceId !== this.git.activeWorkspaceId()) {
          this.setBulkResult(repository.id, action, 'cancelled', 'Workspace changed before this repository was processed.');
          continue;
        }
        if (!this.git.repositories().some(item => item.id === repository.id && item.path === repository.path)) {
          this.setBulkResult(repository.id, action, 'error', 'Repository is no longer open.');
          continue;
        }
        const result = await runWorkspaceRemote(this.git, repository.id, action);
        if (!this.destroyed) this.setBulkResult(repository.id, action, result.status, result.error);
      }
    } catch (error: unknown) {
      if (!this.destroyed) this.bulkError.set(this.git.formatError(error));
    } finally { if (!this.destroyed) this.bulkRunning.set(false); }
  }
  async openMultipleRepositories(): Promise<void> {
    if (this.git.busy() || this.openingRepositories() || this.bulkRunning() || this.git.browserPreview()) return;
    this.bulkError.set('');
    const workspaceId = this.git.activeWorkspaceId();
    this.openingRepositories.set(true);
    try {
      const choice = await open({ directory: true, multiple: true, title: 'Open repositories in this workspace' });
      const paths = [...new Set((Array.isArray(choice) ? choice : choice ? [choice] : []).filter((path): path is string => typeof path === 'string'))];
      if (!paths.length || this.destroyed) return;
      this.bulkResults.set(paths.map(path => ({ id: path, path, action: 'open', status: 'pending', detail: null })));
      for (const path of paths) {
        if (this.destroyed) return;
        if (workspaceId !== this.git.activeWorkspaceId()) {
          this.setBulkResult(path, 'open', 'cancelled', 'Workspace changed before this repository was processed.');
          continue;
        }
        if (this.git.repositories().some(repo => repo.path === path)) {
          this.setBulkResult(path, 'open', 'success', 'Already open in this workspace.');
          continue;
        }
        const result = await this.git.openRepository(path);
        this.setBulkResult(path, 'open', result.status,
          result.status === 'success' ? (result.path === path ? null : `Opened repository at ${result.path}.`) : result.error);
      }
    } catch (error: unknown) {
      this.bulkError.set(this.git.formatError(error));
    } finally {
      this.openingRepositories.set(false);
    }
  }
  private setBulkResult(id: string, action: WorkspaceActionResult['action'], status: WorkspaceActionResult['status'], detail: string | null): void {
    this.bulkResults.update(results => results.map(result => result.id === id && result.action === action
      ? { ...result, status, detail } : result));
  }
  private persist(profiles: IdentityProfile[]): boolean {
    try { localStorage.setItem(IDENTITY_PROFILES_KEY, JSON.stringify(profiles)); this.profiles.set(profiles); this.error.set(''); return true; }
    catch { this.notice.set(''); this.error.set('Could not save identities on this device. No saved profiles were changed.'); return false; }
  }
  save(): void {
    if (this.draftError()) return;
    const profile = { id: this.editingId() ?? crypto.randomUUID(), label: this.label().trim(), name: this.name().trim(), email: this.email().trim() };
    if (this.persist([...this.profiles().filter(item => item.id !== profile.id), profile])) { this.editingId.set(profile.id); this.pending.set(null); this.notice.set(`Saved ${profile.label}`); }
  }
  edit(profile: IdentityProfile): void { this.editingId.set(profile.id); this.label.set(profile.label); this.name.set(profile.name); this.email.set(profile.email); this.pending.set(null); this.notice.set(''); }
  newProfile(): void { this.editingId.set(null); this.label.set(''); this.name.set(''); this.email.set(''); this.pending.set(null); this.notice.set(''); }
  copyCurrent(): void { const identity = this.git.repository()?.identity; if (identity) { this.name.set(identity.name ?? ''); this.email.set(identity.email ?? ''); } }
  remove(id: string): void { if (this.persist(this.profiles().filter(item => item.id !== id))) { if (this.editingId() === id) this.newProfile(); this.pending.set(null); this.notice.set('Identity profile deleted. Repository settings were not changed.'); } }
  prepareApply(profile: IdentityProfile): void { const repo = this.git.repository(); if (repo && !this.git.busy()) { this.pending.set({ profile: { ...profile }, repositoryId: repo.id, path: repo.path }); this.error.set(''); this.notice.set(''); } }
  async applyIdentity(): Promise<void> {
    const apply = this.pending();
    if (!apply || this.git.busy() || apply.repositoryId !== this.git.activeRepositoryId() || apply.path !== this.git.repository()?.path) { this.pending.set(null); return; }
    await this.git.setRepositoryIdentity(apply.profile.name, apply.profile.email);
    if (this.destroyed) return;
    if (this.git.error()) this.error.set(this.git.error()!);
    else { this.pending.set(null); this.notice.set(`Applied ${apply.profile.label} to ${apply.path}`); }
  }
  ngOnDestroy(): void { this.destroyed = true; this.invalidateFileRequest(); }
  close(restoreFocus = true): void {
    if (this.destroyed) return;
    if (this.pendingFileDelete()) { this.cancelDelete(); return; }
    const opener = this.request().returnFocus; this.closed.emit();
    if (restoreFocus) setTimeout(() => { if (opener?.isConnected && opener.getClientRects().length) opener.focus(); else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus(); });
  }
  private focusFirst(): void { const dialog = this.dialog()?.nativeElement; const target = dialog?.querySelector<HTMLInputElement>('input[type=search]') ?? dialog?.querySelector<HTMLButtonElement>('button'); target?.focus(); }
  @HostListener('document:focusin') containFocus(): void {
    if (this.destroyed || this.suspended()) return;
    const dialog = this.pendingFileDelete() ? this.deleteDialog()?.nativeElement : this.dialog()?.nativeElement;
    if (dialog && !dialog.contains(document.activeElement)) {
      if (this.pendingFileDelete()) {
        if (this.fileMutating()) dialog.focus(); else this.deleteCancel()?.nativeElement.focus();
      } else this.focusFirst();
    }
  }
  handleKey(event: KeyboardEvent): void {
    if (this.pendingFileDelete()) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancelDelete(); return; }
      if (event.key === 'Tab') {
        const controls = [...(this.deleteDialog()?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (!controls.length) { event.preventDefault(); }
        else if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
        event.stopPropagation();
      }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const items = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary') ?? [])].filter(item => item.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    event.stopPropagation();
  }
}
