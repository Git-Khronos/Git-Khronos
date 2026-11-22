import { HostingPanelComponent } from './hosting-panel.component';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, OnDestroy, afterNextRender, afterRenderEffect, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ipc, type RepositoryFiles, type RepositorySnapshot } from '@git-khronos/contracts';
import { open } from '@tauri-apps/plugin-dialog';
import { GitKhronosService, type OpenRepositoryResult, type SavedRepositoryReplacement } from './git-khronos.service';
import { IDENTITY_PROFILES_KEY, parseIdentityProfiles, validIdentityProfile, type IdentityProfile } from './identity-profiles';
import { runWorkspaceRemote, type WorkspaceRemoteOperation } from './workspace-actions';
import { PULL_STRATEGY_LABEL, type PullStrategy } from './pull-strategy';
import { runRepositoryFileAction } from './repository-file-actions';
import { BackgroundOperationWarningsComponent } from './background-operation-warnings.component';

export interface WorkspaceCenterRequest { workspaceId: string; panel: 'overview' | 'identities' | 'hosting' | 'files'; returnFocus: HTMLElement | null }
export interface WorkspaceTabsCloseRequest { workspaceId: string; scope: string; tabs: readonly Pick<RepositorySnapshot, 'id' | 'path'>[] }
interface SavedPathsRemoval { workspaceId: string; scope: string; paths: readonly string[] }
interface FileDeletionReview { file: RepositoryFiles['files'][number]; repositoryId: string; path: string; scope: string }
interface WorkspaceActionResult { id: string; path: string; action: 'fetch' | 'pull' | 'open' | 'close' | 'remove' | 'locate'; status: 'pending' | 'running' | 'success' | 'review needed' | 'error' | 'cancelled'; detail: string | null }

@Component({
  selector: 'gc-workspace-center',
  imports: [BackgroundOperationWarningsComponent, DatePipe, HostingPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" [inert]="suspended()" (click)="close()"><section #dialog role="dialog" aria-modal="true" aria-label="Workspace center" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
      <div [inert]="reviewPending()">
      <header><div><h2 id="workspace-center-title">Workspace center</h2><p>{{ git.activeWorkspace().name }}</p></div><button type="button" (click)="close()">Close</button></header>
      @if (!suspended() && git.backgroundOperationWarnings().length) { <gc-background-operation-warnings /> }
      <nav aria-label="Workspace center sections"><button type="button" [disabled]="!!locatingPath()" [attr.aria-pressed]="panel() === 'overview'" (click)="panel.set('overview')">Repository overview</button><button type="button" [disabled]="!!locatingPath()" [attr.aria-pressed]="panel() === 'files'" (click)="panel.set('files')">Repository files</button><button type="button" [disabled]="!!locatingPath()" [attr.aria-pressed]="panel() === 'identities'" (click)="panel.set('identities')">Identity profiles</button><button type="button" [disabled]="!!locatingPath()" [attr.aria-pressed]="panel() === 'hosting'" (click)="panel.set('hosting')">Reviews and checks</button></nav>
      @if (panel() === 'overview') {
        <p>Local repository state. Ahead and behind counts use tracking references already fetched.</p>
        <div class="tools"><label>Filter repositories<input #filter type="search" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
          <label><input type="checkbox" [checked]="attentionOnly()" (change)="attentionOnly.set($any($event.target).checked)" />Needs attention</label>
          <button type="button" [disabled]="git.busy() || refreshing() || openingRepositories() || bulkRunning() || git.browserPreview() || !git.repositories().length" (click)="refresh()">{{ refreshing() ? 'Refreshing…' : 'Refresh local state' }}</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || git.browserPreview()" (click)="openMultipleRepositories()">Open multiple repositories…</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || !rows().length" (click)="selectShown()">Select shown</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || !selectedRepositoryIds().length" (click)="selectedRepositoryIds.set([])">Clear selection</button>
          <button type="button" [disabled]="git.busy() || openingRepositories() || bulkRunning() || git.browserPreview() || !selectedRepositoryIds().length" (click)="runBulk('fetch')">Fetch selected ({{ selectedRepositoryIds().length }})</button>
          <button type="button" aria-describedby="workspace-pull-strategy" [disabled]="git.busy() || openingRepositories() || bulkRunning() || git.browserPreview() || !selectedRepositoryIds().length" (click)="runBulk('pull')">Pull selected ({{ selectedRepositoryIds().length }})</button>
          <button type="button" [disabled]="overviewBusy() || !selectedOpenTabs().length" (click)="reviewTabClose($event)">Close selected ({{ selectedOpenTabs().length }})…</button></div>
        <p id="workspace-pull-strategy">Pull uses each repository’s configured upstream. Default strategy: {{ pullStrategyLabel() }}.</p>
        <p role="status">{{ rows().length }} of {{ git.repositories().length }} open repositories shown{{ refreshing() ? ' · reading local repositories' : '' }}</p>
        @if (bulkError()) { <p role="alert">{{ bulkError() }}</p> }
        @if (bulkResults().length) {
          <aside aria-label="Repository action results"><h3 #bulkResultsTitle tabindex="-1">Repository action results</h3>
          @if (bulkRunning() && (hasQueuedRemoteActions() || bulkStopRequested())) {
            <button #bulkStopButton type="button" [attr.aria-disabled]="bulkStopRequested()" (click)="requestBulkStop()">Stop after current repository</button>
          }
          @if (bulkRunning() && bulkStopRequested()) { <p role="status">The current operation can finish. No further repositories will be started.</p> }
          <ul>@for (result of bulkResults(); track result.id + result.action) {
            <li>@if (result.action === 'remove' || result.action === 'locate') { <code>{{ result.path }}</code> } @else { <strong>{{ git.pathLabel(result.path) }}</strong> } — {{ result.status }}{{ result.detail ? ': ' + result.detail : '' }}</li>
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
        @if (unopenedPaths().length || savedPathNotice() || savedPathError()) {
          <section class="saved-repositories" aria-label="Saved repositories not open">
            @if (savedPathNotice()) { <p role="status">{{ savedPathNotice() }}</p> }
            @if (savedPathError()) { <p role="alert">{{ savedPathError() }}</p> }
            @if (unopenedPaths().length) {
              <h3>Saved repositories not open</h3>
              <p>These paths are still in this workspace. Locate a moved repository to replace its saved path, or remove the entry without changing files on disk.</p>
              <div class="tools">
                <button type="button" [disabled]="overviewBusy() || selectedUnopenedPaths().length === unopenedPaths().length" (click)="selectedSavedPaths.set(unopenedPaths())">Select all saved paths</button>
                <button type="button" [disabled]="overviewBusy() || !selectedUnopenedPaths().length" (click)="selectedSavedPaths.set([])">Clear saved path selection</button>
                <button type="button" [disabled]="overviewBusy() || git.browserPreview() || !selectedUnopenedPaths().length"
                  aria-describedby="locate-saved-paths-hint" (click)="locateSelectedPaths($event)">Locate selected saved paths ({{ selectedUnopenedPaths().length }})…</button>
                <button type="button" [disabled]="overviewBusy() || !selectedUnopenedPaths().length" (click)="reviewSavedRemoval($event)">Remove selected saved paths ({{ selectedUnopenedPaths().length }})…</button>
              </div>
              <p id="locate-saved-paths-hint">Choose one new folder per selected path. Cancel stops any remaining prompts; saved replacements stay in place.</p>
              <ul>@for (path of unopenedPaths(); track path) {
                <li><label class="saved-path"><input type="checkbox" [attr.aria-label]="'Select saved path ' + path" [checked]="selectedSavedPaths().includes(path)" [disabled]="overviewBusy()" (change)="toggleSavedPath(path, $any($event.target).checked)" /><code>{{ path }}</code></label>
                  <div class="tools">
                    <button type="button" [attr.aria-label]="'Retry opening ' + path" [disabled]="overviewBusy() || git.browserPreview()" (click)="retrySavedPath(path)">Retry opening</button>
                    <button type="button" [attr.aria-label]="'Locate and open ' + path" [disabled]="overviewBusy() || git.browserPreview()" (click)="locateSavedPath(path, $event)">Locate and open…</button>
                    <button type="button" [attr.aria-label]="'Remove ' + path + ' from workspace'" [disabled]="overviewBusy()" (click)="removeSavedPath(path)">Remove from workspace</button>
                  </div>
                  @if (locatingPath() === path) { <p role="status">Locating repository…</p> }
                </li>
              }</ul>
            }
          </section>
        }
      } @else if (panel() === 'files') {
        <p>Browse repository files, including ignored files. Git metadata, nested repositories and symbolic-link targets are excluded. Deleting ignored files is disabled because they are not covered by Git recovery. Tracked deletion requires a clean committed file without index flags that hide changes. Untracked deletion with recovery is limited to supported files in the top-level folder of a Linux working tree.</p>
        @if (fileError()) { <p role="alert">{{ fileError() }}</p> }
        @if (fileNotice()) { <p role="status">{{ fileNotice() }}</p> }
        @if (git.systemInfo()?.repositoryFileCreationAvailable === false && hasFileCheckout()) {
          <p>Create files in your file manager or editor, then refresh this list.</p>
        }
        <div class="tools file-tools">
          <label>Filter files<input type="search" [value]="fileQuery()" (input)="changeFileQuery($any($event.target).value)" /></label>
          @if (canCreateFile()) {
            <form (submit)="$event.preventDefault(); createFile()">
              <label>Create an empty file<input aria-label="New repository-relative file path" aria-describedby="root-file-help" [attr.aria-invalid]="fileNameIncludesFolder() ? 'true' : null" maxlength="16384" [value]="newFilePath()" (input)="newFilePath.set($any($event.target).value)" placeholder="notes.txt" />
                <small id="root-file-help">{{ fileNameIncludesFolder() ? 'Enter a file name without folders.' : 'Files are created in the repository’s top-level folder.' }}</small>
              </label>
              <button type="submit" [disabled]="git.busy() || fileMutating() || filesLoading() || !newFilePath() || fileNameIncludesFolder()">Create file</button>
            </form>
          }
          <button type="button" [disabled]="git.busy() || fileMutating() || filesLoading()" (click)="loadFiles()">{{ filesLoading() ? 'Loading…' : 'Refresh files' }}</button>
        </div>
        @if (filesLoading()) { <p role="status">Reading repository files…</p> }
        @if (files(); as fileList) {
          <p role="status">Showing {{ fileList.files.length }} files · page {{ filePage() + 1 }}</p>
          @if (fileList.incomplete) { <p role="alert">Some matching paths could not be displayed safely. Check file permissions or excluded repository boundaries and refresh.</p> }
          <div class="file-list" aria-label="Repository files">
            @for (file of fileList.files; track file.path) {
              <article class="file-entry"><code>{{ file.path }}</code><span>{{ file.symbolicLink ? 'Symbolic link' : file.ignored ? 'Ignored · read-only' : file.tracked ? (file.deletable ? 'Tracked' : 'Tracked · deletion unavailable') : (file.deletableWithRecovery ? 'Untracked' : 'Untracked · deletion unavailable') }}</span>
                <div class="tools"><button type="button" [disabled]="file.symbolicLink || git.busy() || fileMutating()" (click)="openFileRequested.emit(file)">Open</button>
                  @if (file.tracked && file.deletable && !file.symbolicLink) { <button type="button" class="danger" [disabled]="git.busy() || fileMutating()" (click)="confirmDelete(file)">Delete and stage</button> }
                  @else if (!file.tracked && !file.ignored && !file.symbolicLink && file.deletableWithRecovery) { <button type="button" class="danger" [disabled]="git.busy() || fileMutating()" (click)="confirmDelete(file)">Delete with recovery</button> }
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
        <aside #reviewDialog role="alertdialog" aria-modal="true" aria-labelledby="file-delete-title" tabindex="-1" [attr.aria-busy]="fileMutating()">
          <h3 id="file-delete-title">Delete {{ deletion.file.path }}?</h3>
          @if (deletion.file.tracked) { <p>This clean committed file will be removed from disk and its deletion staged. The current commit retains its contents.</p> }
          @else { <p>This untracked file will be removed from disk and saved to Recovery History so it can be restored.</p> }
          @if (fileError()) { <p role="alert">{{ fileError() }}</p> }
          <div class="tools"><button #reviewCancel type="button" [disabled]="git.busy() || fileMutating()" (click)="cancelDelete(deletion)">Cancel</button><button type="button" class="danger" [disabled]="git.busy() || fileMutating()" (click)="deleteFile(deletion)">Delete file</button></div>
        </aside>
      } @else if (pendingTabsClose(); as review) {
        <aside #reviewDialog role="alertdialog" aria-modal="true" aria-labelledby="tabs-close-title" aria-describedby="tabs-close-description" tabindex="-1">
          <h3 id="tabs-close-title">Close selected repository tabs?</h3>
          <p id="tabs-close-description">These tabs will be removed from this workspace. Their commit drafts will be discarded and their terminals closed. Repository folders, Git data and working files stay on disk.</p>
          <ul class="close-paths">@for (tab of review.tabs; track tab.id) { <li><code>{{ tab.path }}</code></li> }</ul>
          <div class="tools"><button #reviewCancel type="button" (click)="cancelWorkspaceReview()">Cancel</button><button type="button" class="danger" [disabled]="overviewBusy()" (click)="closeReviewedTabs()">Close {{ review.tabs.length }} {{ review.tabs.length === 1 ? 'tab' : 'tabs' }}</button></div>
        </aside>
      } @else if (pendingSavedRemoval(); as review) {
        <aside #reviewDialog role="alertdialog" aria-modal="true" aria-labelledby="saved-paths-remove-title" aria-describedby="saved-paths-remove-description" tabindex="-1">
          <h3 id="saved-paths-remove-title">Remove selected saved paths?</h3>
          <p id="saved-paths-remove-description">Only the entries below will be removed from this workspace. Open tabs, other workspaces, and files on disk are not changed.</p>
          <ul class="close-paths">@for (path of review.paths; track path) { <li><code>{{ path }}</code></li> }</ul>
          <div class="tools"><button #reviewCancel type="button" (click)="cancelWorkspaceReview()">Cancel</button><button type="button" class="danger" [disabled]="overviewBusy()" (click)="removeReviewedSavedPaths()">Remove {{ review.paths.length }} saved {{ review.paths.length === 1 ? 'path' : 'paths' }}</button></div>
        </aside>
      }
    </section></div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 65; background: #080811b8; display: grid; place-items: center; padding: 18px; }
    .backdrop > section { box-sizing: border-box; width: min(900px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; color: var(--text); background: var(--inspector-list); border: 1px solid var(--inspector-divider); border-radius: 7px; }
    header, nav, .tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; } nav { justify-content: start; margin: 12px 0; }
    h2 { font-size: 18px; margin: 0; } h3 { font-size: 14px; margin: 0 0 8px; } p, dd, dt, label, small, code { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    article, aside, form { border: 1px solid var(--inspector-divider); border-radius: 5px; padding: 14px; margin: 12px 0; } article p { margin: 8px 0; }
    dl { display: grid; grid-template-columns: max-content minmax(0,1fr); gap: 4px 16px; } dd { margin: 0; } label { display: block; } form input, input[type=search] { display: block; box-sizing: border-box; width: 100%; margin: 4px 0 10px; } form label { margin-bottom: 10px; }
    button, input { color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); padding: 7px 10px; min-height: 32px; } input[type=checkbox] { min-height: auto; }
    button { cursor: pointer; } button:disabled, button[aria-disabled=true] { opacity: .5; cursor: default; } button[aria-pressed=true] { border-color: var(--accent); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } [role=alert] { color: var(--danger); }
    .profile-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .profile-layout > * { min-width: 0; } .tools { justify-content: start; }
    gc-background-operation-warnings { position: sticky; top: 0; z-index: 1; background: var(--inspector-list); }
    .repositories article > header { align-items: start; } .repositories article > header > label { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; } .repositories article > header > div { min-width: 0; flex: 1; }
    .saved-repositories { margin-block-start: 20px; } .saved-repositories li + li { margin-block-start: 12px; }
    .saved-repositories code { white-space: break-spaces; } .saved-repositories .tools { margin-block-start: 4px; }
    .saved-path { display: flex; align-items: baseline; gap: 8px; }
    .close-paths code { white-space: break-spaces; }
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
  readonly pullStrategy = input.required<PullStrategy>();
  readonly pullStrategyLabel = computed(() => PULL_STRATEGY_LABEL[this.pullStrategy()]);
  readonly openRepository = input.required<(path: string, replacement?: SavedRepositoryReplacement) => Promise<OpenRepositoryResult>>();
  readonly closeRepositories = input.required<(request: WorkspaceTabsCloseRequest) => boolean>();
  readonly suspended = input(false);
  readonly closed = output<void>();
  readonly repositorySelected = output<string>();
  readonly savedRepositoryRequested = output<string>();
  readonly openFileRequested = output<RepositoryFiles['files'][number]>();
  readonly panel = signal<'overview' | 'identities' | 'hosting' | 'files'>('overview');
  readonly query = signal('');
  readonly attentionOnly = signal(false);
  readonly refreshing = signal(false);
  readonly refreshes = signal<Record<string, { at: number | null; error: string | null }>>({});
  readonly selectedRepositoryIds = signal<string[]>([]);
  readonly selectedOpenTabs = computed(() => {
    const selected = new Set(this.selectedRepositoryIds());
    return this.git.repositories().filter(repository => selected.has(repository.id));
  });
  readonly bulkResults = signal<WorkspaceActionResult[]>([]);
  readonly openingRepositories = signal(false);
  readonly bulkRunning = signal(false);
  readonly bulkStopRequested = signal(false);
  readonly hasQueuedRemoteActions = computed(() => this.bulkResults().some(result =>
    result.status === 'pending' && (result.action === 'fetch' || result.action === 'pull')));
  readonly bulkError = signal('');
  readonly savedPathNotice = signal('');
  readonly savedPathError = signal('');
  readonly locatingPath = signal<string | null>(null);
  readonly overviewBusy = computed(() => this.git.busy() || this.refreshing() || this.openingRepositories() || this.bulkRunning());
  readonly unopenedPaths = computed(() => {
    const opened = new Set(this.git.repositories().map(repository => repository.path));
    return (this.git.activeWorkspace()?.repositoryPaths ?? []).filter(path => !opened.has(path));
  });
  readonly selectedSavedPaths = signal<readonly string[]>([]);
  readonly selectedUnopenedPaths = computed(() => {
    const selected = new Set(this.selectedSavedPaths());
    return this.unopenedPaths().filter(path => selected.has(path));
  });
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
  readonly hasFileCheckout = computed(() => {
    const repository = this.git.repository();
    return !!repository && !repository.bare;
  });
  readonly canCreateFile = computed(() => this.hasFileCheckout() && this.git.systemInfo()?.repositoryFileCreationAvailable === true);
  readonly fileNameIncludesFolder = computed(() => {
    const name = this.newFilePath();
    return name.includes('/') || name.includes('\\');
  });
  readonly filePage = signal(0);
  readonly pendingFileDelete = signal<FileDeletionReview | null>(null);
  readonly pendingTabsClose = signal<WorkspaceTabsCloseRequest | null>(null);
  readonly pendingSavedRemoval = signal<SavedPathsRemoval | null>(null);
  readonly reviewPending = computed(() => !!this.pendingFileDelete() || !!this.pendingTabsClose() || !!this.pendingSavedRemoval());
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly reviewDialog = viewChild<ElementRef<HTMLElement>>('reviewDialog');
  private readonly reviewCancel = viewChild<ElementRef<HTMLButtonElement>>('reviewCancel');
  private readonly bulkStopButton = viewChild<ElementRef<HTMLButtonElement>>('bulkStopButton');
  private readonly bulkResultsTitle = viewChild<ElementRef<HTMLElement>>('bulkResultsTitle');
  private readonly injector = inject(Injector);
  private deleteOpener: HTMLElement | null = null;
  private workspaceReviewOpener: HTMLButtonElement | null = null;
  private fileRequest = 0;
  private fileCursors: (string | null)[] = [null];
  private fileQueryTimer: ReturnType<typeof setTimeout> | null = null;
  private filePanelActive = false;
  private fileBinding: string | null = null;
  private locationRequest: object | null = null;
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
      const scope = this.git.activeRepositoryReadScope();
      untracked(() => {
        if (panel !== 'files') {
          this.filePanelActive = false;
          this.newFilePath.set('');
          this.invalidateFileRequest();
        } else if (!this.filePanelActive || this.fileBinding !== scope) {
          this.filePanelActive = true;
          this.fileCursors = [null];
          this.filePage.set(0);
          this.pendingFileDelete.set(null);
          this.fileNotice.set('');
          void this.loadFiles();
        }
      });
    });
    effect(() => {
      if (this.request().workspaceId !== this.git.activeWorkspaceId()) {
        this.pendingFileDelete.set(null);
        this.pendingTabsClose.set(null);
        this.pendingSavedRemoval.set(null);
        this.close(false);
      }
    });
    effect(() => {
      const unopened = new Set(this.unopenedPaths());
      this.selectedSavedPaths.update(paths => paths.every(path => unopened.has(path)) ? paths : paths.filter(path => unopened.has(path)));
    });
    effect(() => { const pending = this.pending(); if (pending && (pending.repositoryId !== this.git.activeRepositoryId() || pending.path !== this.git.repository()?.path)) this.pending.set(null); });
    afterNextRender(() => this.focusFirst());
    afterRenderEffect(() => {
      if (this.reviewPending()) this.focusReview();
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
    const scope = this.git.activeRepositoryReadScope();
    const repository = this.git.repository();
    const repositoryId = this.git.activeRepositoryId();
    const workspaceId = this.request().workspaceId;
    if (this.fileBinding !== scope) {
      this.fileBinding = scope;
      this.newFilePath.set('');
    }
    if (!repository || !repositoryId || repository.bare) {
      this.files.set(null);
      this.filesLoading.set(false);
      this.fileError.set('Open a non-bare repository to browse its files.');
      return false;
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
      if (!this.destroyed && request === this.fileRequest && this.panel() === 'files' && workspaceId === this.git.activeWorkspaceId() && scope === this.git.activeRepositoryReadScope()) {
        this.files.set(result);
        return true;
      }
    } catch (error: unknown) {
      if (!this.destroyed && request === this.fileRequest && workspaceId === this.git.activeWorkspaceId() && scope === this.git.activeRepositoryReadScope()) this.fileError.set(this.git.formatError(error));
    } finally {
      if (!this.destroyed && request === this.fileRequest) this.filesLoading.set(false);
    }
    return false;
  }
  async createFile(): Promise<void> {
    const repository = this.git.repository();
    const repositoryId = this.git.activeRepositoryId();
    const scope = this.git.activeRepositoryReadScope();
    const path = this.newFilePath();
    if (!this.canCreateFile() || this.panel() !== 'files' || !repository || !repositoryId
      || this.fileBinding !== scope
      || !path || this.fileNameIncludesFolder() || this.git.busy() || this.fileMutating() || this.filesLoading()) return;
    const workspaceId = this.request().workspaceId;
    const current = () => !this.destroyed && this.panel() === 'files' && workspaceId === this.git.activeWorkspaceId()
      && scope === this.git.activeRepositoryReadScope();
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
    const scope = this.git.activeRepositoryReadScope();
    if (this.destroyed || this.panel() !== 'files' || this.suspended() || this.reviewPending()
      || this.fileBinding !== scope || !this.files()?.files.includes(file) || !repository || !repositoryId
      || this.git.busy() || this.fileMutating() || file.ignored || file.symbolicLink
      || !(file.tracked ? file.deletable : file.deletableWithRecovery)) return;
    this.deleteOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.fileError.set('');
    this.fileNotice.set('');
    this.pendingFileDelete.set({ file, repositoryId, path: repository.path, scope });
  }
  async deleteFile(pending: FileDeletionReview): Promise<void> {
    if (this.pendingFileDelete() !== pending || this.fileMutating() || this.git.busy()) return;
    const workspaceId = this.request().workspaceId;
    const current = () => !this.destroyed && this.panel() === 'files'
      && workspaceId === this.git.activeWorkspaceId() && this.git.activeRepositoryReadScope() === pending.scope;
    if (this.suspended()) return;
    if (!current()) {
      this.pendingFileDelete.set(null);
      this.deleteOpener = null;
      return;
    }
    const restoreFileFocus = () => afterNextRender(() => {
      const active = document.activeElement;
      if (!current() || this.pendingFileDelete() || this.suspended()
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
  cancelDelete(pending: FileDeletionReview): void {
    if (this.pendingFileDelete() !== pending || this.fileMutating() || this.git.busy()) return;
    this.pendingFileDelete.set(null);
    const opener = this.deleteOpener;
    this.deleteOpener = null;
    afterNextRender(() => {
      if (this.destroyed || this.panel() !== 'files' || this.git.activeRepositoryReadScope() !== pending.scope
        || this.pendingFileDelete() || this.suspended()) return;
      if (opener?.isConnected) opener.focus();
      else this.focusFirst();
    }, { injector: this.injector });
  }
  activate(repositoryId: string): void { if (!this.git.busy() && !this.openingRepositories() && !this.bulkRunning()) { this.repositorySelected.emit(repositoryId); this.close(false); } }
  retrySavedPath(path: string): void {
    if (this.destroyed || this.overviewBusy() || this.git.browserPreview()
      || this.request().workspaceId !== this.git.activeWorkspaceId() || !this.unopenedPaths().includes(path)) return;
    this.close();
    this.savedRepositoryRequested.emit(path);
  }
  locateSavedPath(path: string, event: MouseEvent): Promise<void> {
    return this.locatePaths([path], event, false);
  }
  locateSelectedPaths(event: MouseEvent): Promise<void> {
    return this.locatePaths(this.selectedUnopenedPaths(), event, true);
  }
  private async locatePaths(paths: readonly string[], event: MouseEvent, batch: boolean): Promise<void> {
    if (this.destroyed || this.suspended() || this.reviewPending() || this.overviewBusy() || this.git.browserPreview()
      || this.request().workspaceId !== this.git.activeWorkspaceId() || !paths.length
      || paths.some(path => !this.unopenedPaths().includes(path))) return;
    const request = this.request();
    const location = this.locationRequest = {};
    const opener = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    this.savedPathNotice.set('');
    this.savedPathError.set('');
    this.openingRepositories.set(true);
    const owns = () => !this.destroyed && this.locationRequest === location && this.request() === request
      && request.workspaceId === this.git.activeWorkspaceId()
      && !this.suspended() && this.panel() === 'overview';
    if (batch) this.bulkResults.set(paths.map(path => ({ id: path, path, action: 'locate', status: 'pending', detail: null })));
    let replaced = 0;
    try {
      for (const [index, path] of paths.entries()) {
        if (!owns()) return;
        if (!this.unopenedPaths().includes(path)) {
          if (batch) this.setBulkResult(path, 'locate', 'cancelled', 'The saved path changed or is already open.');
          continue;
        }
        this.locatingPath.set(path);
        if (batch) this.setBulkResult(path, 'locate', 'running', 'Choose a replacement folder.');
        const scope = this.git.activeRepositoryReadScope();
        const current = () => owns() && this.git.activeRepositoryReadScope() === scope;
        const label = batch ? `${path} (${index + 1} of ${paths.length})` : this.git.pathLabel(path);
        const result = await this.pickSavedReplacement(path, label, current);
        if (!owns()) return;
        if (result.status === 'success') {
          replaced++;
          const detail = result.path === path ? `Opened ${path}.` : `Replaced the saved path with ${result.path} in this workspace.`;
          if (batch) this.setBulkResult(path, 'locate', 'success', detail);
          else this.savedPathNotice.set(detail);
          if (this.git.activeRepositoryId() === result.repositoryId && this.git.repository()?.path === result.path) continue;
        } else if (result.status === 'error') {
          const detail = result.error ?? 'The repository could not be opened. The saved path was not replaced.';
          if (batch) this.setBulkResult(path, 'locate', 'error', detail);
          else this.savedPathError.set(detail);
          if (current()) continue;
        } else if (batch) {
          this.setBulkResult(path, 'locate', 'cancelled', result.error ?? 'The saved path was not replaced.');
        }
        if (batch) this.bulkResults.update(results => results.map(result => result.action === 'locate' && result.status === 'pending'
          ? { ...result, status: 'cancelled', detail: 'Stopped before choosing a folder for this path.' } : result));
        break;
      }
      if (batch) this.savedPathNotice.set(`Located ${replaced} of ${paths.length} selected repositories. Review the results above.`);
    } finally {
      if (!this.destroyed) {
        const restoreFocus = owns();
        this.locationRequest = null;
        this.locatingPath.set(null);
        this.openingRepositories.set(false);
        if (restoreFocus) afterNextRender(() => {
          if (this.destroyed || this.suspended() || this.request() !== request || this.panel() !== 'overview'
            || (document.activeElement !== document.body && document.activeElement !== opener)) return;
          if (batch) this.bulkResultsTitle()?.nativeElement.focus();
          else if (!replaced && opener?.isConnected && !opener.disabled) opener.focus();
          else this.focusFirst();
        }, { injector: this.injector });
      }
    }
  }
  private async pickSavedReplacement(path: string, label: string, current: () => boolean): Promise<OpenRepositoryResult> {
    const retired = { status: 'cancelled' as const, error: 'The checkout or workspace changed.' };
    const busy = { status: 'cancelled' as const, error: 'Another repository operation started.' };
    if (this.git.busy()) return busy;
    try {
      const choice = await open({
        directory: true, multiple: false, defaultPath: path, title: `Locate the new folder for ${label}`,
      });
      if (!current()) return retired;
      if (typeof choice !== 'string' || !choice) return { status: 'cancelled', error: 'No replacement folder chosen.' };
      if (this.git.busy()) return busy;
      return await this.openRepository()(choice, { path, current });
    } catch (error: unknown) {
      return current() ? { status: 'error', error: this.git.formatError(error) } : retired;
    }
  }
  removeSavedPath(path: string): void {
    if (this.destroyed || this.overviewBusy() || !this.git.removeUnopenedWorkspaceRepositories(this.request().workspaceId, [path])) return;
    this.savedPathError.set('');
    this.savedPathNotice.set(`Removed ${path} from this workspace. No files were changed.`);
    afterNextRender(() => { if (!this.destroyed) this.focusFirst(); }, { injector: this.injector });
  }
  toggleSavedPath(path: string, selected: boolean): void {
    if (this.overviewBusy() || !this.unopenedPaths().includes(path)) return;
    this.selectedSavedPaths.update(paths => selected
      ? paths.includes(path) ? paths : [...paths, path]
      : paths.filter(item => item !== path));
  }
  reviewSavedRemoval(event: MouseEvent): void {
    const workspaceId = this.request().workspaceId;
    const paths = this.selectedUnopenedPaths();
    if (this.destroyed || this.suspended() || this.overviewBusy() || this.reviewPending() || !paths.length
      || workspaceId !== this.git.activeWorkspaceId()) return;
    this.workspaceReviewOpener = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    this.savedPathNotice.set('');
    this.savedPathError.set('');
    this.pendingSavedRemoval.set({ workspaceId, paths, scope: this.git.activeRepositoryReadScope() });
  }
  removeReviewedSavedPaths(): void {
    const review = this.pendingSavedRemoval();
    if (!review || this.destroyed || this.suspended() || this.overviewBusy()) return;
    this.cancelWorkspaceReview();
    if (review.scope !== this.git.activeRepositoryReadScope()
      || !this.git.removeUnopenedWorkspaceRepositories(review.workspaceId, review.paths)) {
      this.savedPathError.set('Saved paths changed. Review your selection again. No paths were removed.');
      return;
    }
    this.savedPathNotice.set(`Removed ${review.paths.length} saved ${review.paths.length === 1 ? 'path' : 'paths'} from this workspace. No files were changed.`);
    this.bulkResults.set(review.paths.map(path => ({ id: path, path, action: 'remove', status: 'success', detail: 'Saved path removed' })));
  }
  toggleSelected(repositoryId: string, selected: boolean): void {
    this.selectedRepositoryIds.update(ids => selected
      ? ids.includes(repositoryId) ? ids : [...ids, repositoryId]
      : ids.filter(id => id !== repositoryId));
  }
  selectShown(): void { this.selectedRepositoryIds.set([...new Set([...this.selectedRepositoryIds(), ...this.rows().map(repo => repo.id)])]); }
  reviewTabClose(event: MouseEvent): void {
    if (this.destroyed || this.suspended() || this.overviewBusy() || this.reviewPending()
      || this.request().workspaceId !== this.git.activeWorkspaceId()) return;
    const tabs = this.selectedOpenTabs().map(({ id, path }) => ({ id, path }));
    if (!tabs.length) return;
    this.workspaceReviewOpener = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    this.bulkError.set('');
    this.pendingTabsClose.set({ workspaceId: this.request().workspaceId, scope: this.git.activeRepositoryReadScope(), tabs });
  }
  cancelWorkspaceReview(): void {
    const opener = this.workspaceReviewOpener;
    this.workspaceReviewOpener = null;
    this.pendingTabsClose.set(null);
    this.pendingSavedRemoval.set(null);
    afterNextRender(() => {
      if (this.destroyed || this.reviewPending() || this.suspended()) return;
      if (opener?.isConnected && !opener.disabled) opener.focus();
      else this.focusFirst();
    }, { injector: this.injector });
  }
  closeReviewedTabs(): void {
    const review = this.pendingTabsClose();
    if (!review || this.destroyed || this.suspended() || this.overviewBusy()) return;
    this.cancelWorkspaceReview();
    if (!this.closeRepositories()(review)) {
      this.bulkError.set('Repository tabs changed. Review your selection again. No tabs were closed.');
      return;
    }
    const closed = new Set(review.tabs.map(tab => tab.id));
    this.selectedRepositoryIds.update(ids => ids.filter(id => !closed.has(id)));
    this.bulkResults.set(review.tabs.map(tab => ({ ...tab, action: 'close', status: 'success', detail: 'Tab closed' })));
  }
  async runBulk(action: 'fetch' | 'pull'): Promise<void> {
    if (this.git.busy() || this.openingRepositories() || this.bulkRunning() || this.git.browserPreview() || !this.selectedRepositoryIds().length) return;
    this.bulkError.set('');
    this.bulkStopRequested.set(false);
    this.bulkRunning.set(true);
    const workspaceId = this.git.activeWorkspaceId();
    const operation: WorkspaceRemoteOperation = action === 'pull'
      ? { kind: 'pull', strategy: this.pullStrategy() }
      : { kind: 'fetch' };
    const selected = this.selectedRepositoryIds().map(id => this.git.repositories().find(repo => repo.id === id)).filter((repo): repo is RepositorySnapshot => !!repo);
    this.bulkResults.set(selected.map(repo => ({ id: repo.id, path: repo.path, action, status: 'pending', detail: null })));
    try {
      for (const repository of selected) {
        if (this.destroyed) return;
        if (this.bulkStopRequested()) break;
        if (workspaceId !== this.git.activeWorkspaceId()) {
          this.retireQueuedRemoteActions('Workspace changed before this repository was processed.');
          break;
        }
        if (!this.git.repositories().some(item => item.id === repository.id && item.path === repository.path)) {
          this.setBulkResult(repository.id, action, 'error', 'Repository is no longer open.');
          continue;
        }
        this.setBulkResult(repository.id, action, 'running', null);
        const result = await runWorkspaceRemote(this.git, repository, operation);
        if (this.destroyed) return;
        this.setBulkResult(repository.id, action, result.status, result.detail);
        if (result.status === 'cancelled') {
          this.retireQueuedRemoteActions('Not started because the current operation was cancelled.');
          break;
        }
      }
    } catch (error: unknown) {
      if (!this.destroyed) {
        const detail = this.git.formatError(error);
        this.bulkError.set(detail);
        this.bulkResults.update(results => results.map(result => result.status === 'running'
          ? { ...result, status: 'error', detail } : result));
        this.retireQueuedRemoteActions('Not started because the batch ended unexpectedly.');
      }
    } finally {
      if (!this.destroyed) {
        const hadFocus = this.bulkStopButton()?.nativeElement === document.activeElement;
        this.bulkRunning.set(false);
        if (hadFocus) afterNextRender(() => {
          if (!this.destroyed && !this.suspended() && this.panel() === 'overview' && document.activeElement === document.body) {
            this.bulkResultsTitle()?.nativeElement.focus();
          }
        }, { injector: this.injector });
      }
    }
  }
  requestBulkStop(): void {
    if (!this.destroyed && this.bulkRunning() && !this.bulkStopRequested() && this.hasQueuedRemoteActions()) {
      this.retireQueuedRemoteActions('Stopped before this repository was started.');
    }
  }
  private retireQueuedRemoteActions(detail: string): void {
    this.bulkStopRequested.set(true);
    this.bulkResults.update(results => results.map(result => result.status === 'pending'
      ? { ...result, status: 'cancelled', detail } : result));
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
        const result = await this.openRepository()(path);
        if (this.destroyed) return;
        this.setBulkResult(path, 'open', result.status,
          result.status === 'success' ? (result.path === path ? null : `Opened repository at ${result.path}.`) : result.error);
      }
    } catch (error: unknown) {
      if (!this.destroyed) this.bulkError.set(this.git.formatError(error));
    } finally {
      if (!this.destroyed) this.openingRepositories.set(false);
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
    const deletion = this.pendingFileDelete();
    if (deletion) { this.cancelDelete(deletion); return; }
    if (this.pendingTabsClose() || this.pendingSavedRemoval()) { this.cancelWorkspaceReview(); return; }
    this.locationRequest = null;
    this.locatingPath.set(null);
    const opener = this.request().returnFocus; this.closed.emit();
    if (restoreFocus) setTimeout(() => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else {
        const fallback = document.querySelector<HTMLButtonElement>('button.workspace-toggle:not(:disabled)')
          ?? document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]');
        fallback?.focus();
      }
    });
  }
  private focusFirst(): void { const dialog = this.dialog()?.nativeElement; const target = dialog?.querySelector<HTMLInputElement>('input[type=search]') ?? dialog?.querySelector<HTMLButtonElement>('button'); target?.focus(); }
  private focusReview(): void {
    const cancel = this.reviewCancel()?.nativeElement;
    const busy = this.pendingFileDelete() && (this.fileMutating() || this.git.busy());
    (!busy && cancel && !cancel.disabled ? cancel : this.reviewDialog()?.nativeElement)?.focus();
  }
  @HostListener('document:focusin') containFocus(): void {
    if (this.destroyed || this.suspended()) return;
    const dialog = this.reviewPending() ? this.reviewDialog()?.nativeElement : this.dialog()?.nativeElement;
    if (dialog && !dialog.contains(document.activeElement)) {
      if (this.reviewPending()) this.focusReview();
      else this.focusFirst();
    }
  }
  handleKey(event: KeyboardEvent): void {
    if (this.reviewPending()) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
      if (event.key === 'Tab') {
        const controls = [...(this.reviewDialog()?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
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
