import { HostedRepositoryBrowserComponent } from './hosted-repository-browser.component';
import { ChangeDetectionStrategy, Component, type ElementRef, Injectable, computed, effect, inject, input, model, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GitKhronosService } from './git-khronos.service';
import { IconComponent } from './icon.component';

export type RepositoryDialogMode = 'manager' | 'clone' | 'init';

/** Keeps clone and initialize drafts while the dialog is closed and reopened. */
@Injectable({ providedIn: 'root' })
class RepositoryFormDrafts {
  readonly cloneRemote = signal('');
  readonly cloneParentPath = signal('');
  readonly cloneFolder = signal('');
  readonly shallowClone = signal(false);
  readonly cloneBranch = signal('');
  readonly cloneDepth = signal(1);
  readonly recurseSubmodules = signal(false);
  readonly initParentPath = signal('');
  readonly initFolder = signal('');
  readonly initBranch = signal('main');
  readonly initReadme = signal(true);
}

/** Loaded on demand so repository management stays out of the startup bundle. */
@Component({
  selector: 'gc-repository-dialog',
  imports: [FormsModule, IconComponent, HostedRepositoryBrowserComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="repository-backdrop" (click)="close()">
    <section #dialog class="repository-dialog" role="dialog" aria-modal="true" aria-label="Repository management" (click)="$event.stopPropagation()" (keydown)="trapFocus($event)">
      <header class="repository-dialog-header">
        <span class="brand-mark mini">GC</span><div><strong>Repository Management</strong><small>Open, clone, or initialize a repository</small></div>
        <button type="button" aria-label="Close repository management" (click)="close()"><gc-icon name="x" [size]="14" /></button>
      </header>
      <nav class="repository-dialog-tabs" role="tablist" aria-label="Repository actions" (keydown)="handleTabKey($event)">
        <button id="repository-tab-manager" type="button" role="tab" aria-controls="repository-dialog-panel" [attr.aria-selected]="mode() === 'manager'" [attr.tabindex]="mode() === 'manager' ? 0 : -1" [class.active]="mode() === 'manager'" (click)="setMode('manager')"><gc-icon name="folder-git" [size]="13" />Browse</button>
        <button id="repository-tab-clone" type="button" role="tab" aria-controls="repository-dialog-panel" [attr.aria-selected]="mode() === 'clone'" [attr.tabindex]="mode() === 'clone' ? 0 : -1" [class.active]="mode() === 'clone'" (click)="setMode('clone')"><gc-icon name="copy" [size]="13" />Clone</button>
        <button id="repository-tab-init" type="button" role="tab" aria-controls="repository-dialog-panel" [attr.aria-selected]="mode() === 'init'" [attr.tabindex]="mode() === 'init' ? 0 : -1" [class.active]="mode() === 'init'" (click)="setMode('init')"><gc-icon name="repo" [size]="13" />Initialize</button>
      </nav>
      @if (mode() === 'manager') {
        <div id="repository-dialog-panel" class="repository-manager-body" role="tabpanel" aria-labelledby="repository-tab-manager">
          @if (git.browserPreview()) {
            <div class="browser-preview-notice"><gc-icon name="terminal" [size]="16" /><span><strong>Sample-data preview</strong><small>Local repositories and Git commands are available in the desktop app. Run <code>task dev</code> to use them.</small></span></div>
          }
          <button class="repository-action-card" type="button" [disabled]="git.browserPreview()" (click)="browse.emit()"><span><gc-icon name="folder-git" [size]="22" /></span><div><strong>Open a repository</strong><small>Browse to an existing local Git working tree</small></div>@if (git.browserPreview()) { <b>Desktop only</b> } @else { <i class="repository-action-disclosure" aria-hidden="true"><gc-icon name="chevron-right" [size]="13" /></i> }</button>
          <button class="repository-action-card" type="button" (click)="openMode('clone')"><span><gc-icon name="copy" [size]="22" /></span><div><strong>Clone a repository</strong><small>Download a remote repository to this machine</small></div><i class="repository-action-disclosure" aria-hidden="true"><gc-icon name="chevron-right" [size]="13" /></i></button>
          <button class="repository-action-card" type="button" (click)="openMode('init')"><span><gc-icon name="repo" [size]="22" /></span><div><strong>Initialize a repository</strong><small>Create a new local Git working tree</small></div><i class="repository-action-disclosure" aria-hidden="true"><gc-icon name="chevron-right" [size]="13" /></i></button>
          @if (repositoryHistoryCount() >= 3) {
            <div class="manager-repository-filter" role="search" aria-label="Repository history">
              <label><gc-icon name="search" [size]="13" /><input #managerRepositoryFilter type="search" aria-label="Filter managed repositories" placeholder="Filter repositories by name or path" [value]="repositoryQuery()" (input)="repositoryQuery.set(managerRepositoryFilter.value)" (keydown.escape)="$event.stopPropagation(); clearRepositoryFilter()" />@if (repositoryQuery()) { <button type="button" aria-label="Clear repository filter" title="Clear repository filter (Esc)" (click)="clearRepositoryFilter()"><gc-icon name="x" [size]="11" /></button> }</label>
              <small data-manager-filter-status role="status" aria-live="polite">{{ visibleRepositoryCount() }} of {{ repositoryHistoryCount() }}</small>
            </div>
          }
          @if (repositoryQuery() && !visibleRepositoryCount()) {
            <div class="manager-repository-empty" role="region" aria-label="No matching repositories"><gc-icon name="search" [size]="16" /><span><strong>No matching repositories</strong><small>Try part of a repository name or folder path.</small></span><button type="button" (click)="clearRepositoryFilter()">Clear filter</button></div>
          }
          @if (filteredFavoritePaths().length) {
            <div class="manager-repositories manager-favorites"><h3>Favorites</h3>@for (path of filteredFavoritePaths(); track path) { @let index = git.favoritePaths().indexOf(path); <div class="manager-repository-row"><button class="manager-repository-main" type="button" [title]="path" [attr.aria-label]="'Open ' + git.pathLabel(path) + ' at ' + path" (click)="openFavorite.emit(path)"><gc-icon name="folder-git" [size]="13" /><span><strong>{{ git.pathLabel(path) }}</strong><small>{{ path }}</small></span><kbd>{{ index < 9 ? favoriteShortcut() + ' ' + (index + 1) : '' }}</kbd></button><button class="manager-favorite-toggle active" type="button" title="Remove {{ git.pathLabel(path) }} from favorites" [attr.aria-label]="'Remove ' + git.pathLabel(path) + ' from favorites'" aria-pressed="true" (click)="git.toggleFavoritePath(path)"><gc-icon name="star" [size]="13" /></button></div> }</div>
          }
          @if (filteredRecentPaths().length) {
            <div class="manager-repositories manager-recents"><h3>Recently opened</h3>@for (path of filteredRecentPaths(); track path) { <div class="manager-repository-row"><button class="manager-repository-main" type="button" [title]="path" [attr.aria-label]="'Open ' + git.pathLabel(path) + ' at ' + path" (click)="openPath.emit(path)"><gc-icon name="folder-git" [size]="13" /><span><strong>{{ git.pathLabel(path) }}</strong><small>{{ path }}</small></span></button><button class="manager-favorite-toggle" type="button" title="Add {{ git.pathLabel(path) }} to favorites" [attr.aria-label]="'Add ' + git.pathLabel(path) + ' to favorites'" aria-pressed="false" (click)="git.toggleFavoritePath(path)"><gc-icon name="star" [size]="13" /></button></div> }</div>
          }
        </div>
      } @else if (mode() === 'clone') {
        <form id="repository-dialog-panel" class="repository-form" role="tabpanel" aria-labelledby="repository-tab-clone" (submit)="$event.preventDefault(); submitClone()">
          <div class="repository-form-body">
            <div class="form-intro"><span><gc-icon name="copy" [size]="21" /></span><div><h2>Clone a Repository</h2><p>Enter a Git URL or a path to another local repository.</p></div></div>
            <button type="button" [disabled]="git.busy()" (click)="toggleHostedMode()">{{ hostedMode() ? 'Enter a repository URL instead' : 'Browse repositories on GitHub' }}</button>
            @if (hostedMode()) { @for (generation of hostedViews(); track generation) { <gc-hosted-repository-browser [initialParentPath]="form.cloneParentPath()" (opening)="opening.emit()" (opened)="opened.emit()" /> } } @else {
            <label>Repository URL<input name="cloneRemote" autocomplete="off" placeholder="https://host/owner/repository.git" [ngModel]="form.cloneRemote()" (ngModelChange)="updateCloneRemote($event)" /></label>
            <label>Where to clone<div class="path-picker"><input name="cloneParent" readonly placeholder="Choose a destination folder" [ngModel]="form.cloneParentPath()" /><button type="button" (click)="chooseCloneParent()">Browse</button></div></label>
            <label>Folder name<input name="cloneFolder" autocomplete="off" placeholder="repository" [ngModel]="form.cloneFolder()" (ngModelChange)="form.cloneFolder.set($event)" /></label>
            @if (cloneDestination()) {
              <div class="repository-destination"><gc-icon name="folder-git" [size]="14" /><span><small>Destination</small><code>{{ cloneDestination() }}</code></span></div>
            }
            <fieldset class="repository-options">
              <legend>Clone options</legend>
              <label class="option-row"><input type="checkbox" name="shallowClone" [ngModel]="form.shallowClone()" (ngModelChange)="form.shallowClone.set($event)" /><span><strong>Shallow clone</strong><small>Limit the downloaded commit history</small></span></label>
              @if (form.shallowClone()) { <div class="inline-options"><label>Branch<input name="cloneBranch" placeholder="Default branch" [ngModel]="form.cloneBranch()" (ngModelChange)="form.cloneBranch.set($event)" /></label><label>Depth<input type="number" name="cloneDepth" min="1" [ngModel]="form.cloneDepth()" (ngModelChange)="form.cloneDepth.set($event)" /></label></div> }
              <label class="option-row"><input type="checkbox" name="recurseSubmodules" [ngModel]="form.recurseSubmodules()" (ngModelChange)="form.recurseSubmodules.set($event)" /><span><strong>Include submodules</strong><small>Also clone every submodule, including nested ones, and keep submodules added later active{{ form.shallowClone() ? '. Submodule history is not shortened' : '' }}</small></span></label>
            </fieldset>
            }
          </div>
          @if (!hostedMode()) {
          <footer><small class="form-readiness" [class.ready]="cloneReady()">{{ cloneReadiness() }}</small><button type="button" (click)="close()">Cancel</button><button class="primary" type="submit" [disabled]="!cloneReady() || git.busy()">Clone repository</button></footer>
          }
        </form>
      } @else {
        <form id="repository-dialog-panel" class="repository-form" role="tabpanel" aria-labelledby="repository-tab-init" (submit)="$event.preventDefault(); submitInit()">
          <div class="repository-form-body">
            <div class="form-intro"><span><gc-icon name="repo" [size]="21" /></span><div><h2>Initialize a Repository</h2><p>Create a new local repository and open it immediately.</p></div></div>
            <label>Location<div class="path-picker"><input name="initParent" readonly placeholder="Choose a parent folder" [ngModel]="form.initParentPath()" /><button type="button" (click)="chooseInitParent()">Browse</button></div></label>
            <label>Repository name<input name="initFolder" autocomplete="off" placeholder="my-project" [ngModel]="form.initFolder()" (ngModelChange)="form.initFolder.set($event)" /></label>
            @if (initDestination()) {
              <div class="repository-destination"><gc-icon name="folder-git" [size]="14" /><span><small>Destination</small><code>{{ initDestination() }}</code></span></div>
            }
            <label>Initial branch<input name="initBranch" autocomplete="off" placeholder="main" [ngModel]="form.initBranch()" (ngModelChange)="form.initBranch.set($event)" /></label>
            <label class="option-row"><input type="checkbox" name="initReadme" [ngModel]="form.initReadme()" (ngModelChange)="form.initReadme.set($event)" /><span><strong>Add README.md</strong><small>Create a starter README in the working tree</small></span></label>
          </div>
          <footer><small class="form-readiness" [class.ready]="initReady()">{{ initReadiness() }}</small><button type="button" (click)="close()">Cancel</button><button class="primary" type="submit" [disabled]="!initReady() || git.busy()">Create repository</button></footer>
        </form>
      }
    </section>
  </div>
  `,
})
export class RepositoryDialogComponent {
  protected readonly git = inject(GitKhronosService);
  protected readonly form = inject(RepositoryFormDrafts);
  protected readonly hostedMode = signal(false);
  private readonly hostedGeneration = signal(0);
  protected readonly hostedViews = computed(() => this.hostedMode() ? [this.hostedGeneration()] : []);
  protected readonly repositoryQuery = signal('');
  protected readonly repositoryHistoryCount = computed(() => this.git.favoritePaths().length + this.git.unpinnedRecentPaths().length);
  protected readonly filteredFavoritePaths = computed(() => this.filterRepositoryPaths(this.git.favoritePaths()));
  protected readonly filteredRecentPaths = computed(() => this.filterRepositoryPaths(this.git.unpinnedRecentPaths()));
  protected readonly visibleRepositoryCount = computed(() => this.filteredFavoritePaths().length + this.filteredRecentPaths().length);
  protected readonly cloneDestination = computed(() => this.destinationPath(this.form.cloneParentPath(), this.form.cloneFolder()));
  protected readonly initDestination = computed(() => this.destinationPath(this.form.initParentPath(), this.form.initFolder()));
  protected readonly cloneReady = computed(() => !!this.form.cloneRemote().trim() && !!this.cloneDestination());
  protected readonly initReady = computed(() => !!this.initDestination() && !!this.form.initBranch().trim());
  protected readonly cloneReadiness = computed(() => !this.form.cloneRemote().trim()
    ? 'Enter a repository URL to continue'
    : !this.form.cloneParentPath() ? 'Choose where to clone the repository'
      : !this.form.cloneFolder().trim() ? 'Enter a folder name to continue' : 'Ready to clone');
  protected readonly initReadiness = computed(() => !this.form.initParentPath()
    ? 'Choose where to create the repository'
    : !this.form.initFolder().trim() ? 'Enter a repository name to continue'
      : !this.form.initBranch().trim() ? 'Enter an initial branch name' : 'Ready to create');
  readonly mode = model.required<RepositoryDialogMode>();
  /** Incremented by the opener to move focus to the selected mode's first control. */
  readonly focusRequest = input(0);
  readonly favoriteShortcut = input('');
  readonly closed = output<void>();
  readonly browse = output<void>();
  readonly openFavorite = output<string>();
  readonly openPath = output<string>();
  /** Emitted before a clone or initialization starts, then after it opens a repository. */
  readonly opening = output<void>();
  readonly opened = output<void>();
  private readonly hostedBrowser = viewChild(HostedRepositoryBrowserComponent);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly managerRepositoryFilter = viewChild<ElementRef<HTMLInputElement>>('managerRepositoryFilter');

  constructor() {
    effect(() => {
      this.focusRequest();
      const mode = untracked(this.mode);
      window.setTimeout(() => this.focusMode(mode));
    });
  }

  protected close(): void { this.hostedBrowser()?.dismiss(); this.closed.emit(); }
  protected toggleHostedMode(): void {
    if (this.hostedMode()) this.hostedBrowser()?.dismiss();
    else this.hostedGeneration.update(generation => generation + 1);
    this.hostedMode.set(!this.hostedMode());
  }
  protected setMode(mode: RepositoryDialogMode): void {
    if (mode !== 'clone') this.hostedBrowser()?.dismiss();
    else if (this.mode() !== 'clone' && this.hostedMode()) this.hostedGeneration.update(generation => generation + 1);
    this.mode.set(mode);
  }

  private focusMode(mode: RepositoryDialogMode): void {
    const dialog = this.dialog()?.nativeElement;
    const target = mode === 'clone'
      ? dialog?.querySelector<HTMLElement>('input[name="cloneRemote"], gc-hosted-repository-browser button:not(:disabled)')
      : mode === 'init'
        ? dialog?.querySelector<HTMLElement>('.path-picker button')
        : dialog?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    target?.focus();
  }

  protected openMode(mode: Exclude<RepositoryDialogMode, 'manager'>): void {
    this.setMode(mode);
    window.setTimeout(() => this.focusMode(mode));
  }

  private destinationPath(parent: string, folder: string): string {
    const base = parent.trim().replace(/[\\/]+$/, '');
    const name = folder.trim().replace(/^[\\/]+/, '');
    if (!base || !name) return '';
    const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
    return `${base}${separator}${name}`;
  }

  protected clearRepositoryFilter(): void {
    this.repositoryQuery.set('');
    queueMicrotask(() => this.managerRepositoryFilter()?.nativeElement.focus());
  }

  private filterRepositoryPaths(paths: readonly string[]): string[] {
    const query = this.repositoryQuery().trim().toLocaleLowerCase();
    if (!query) return [...paths];
    return paths.filter((path) => path.toLocaleLowerCase().includes(query)
      || this.git.pathLabel(path).toLocaleLowerCase().includes(query));
  }

  protected handleTabKey(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const modes: RepositoryDialogMode[] = ['manager', 'clone', 'init'];
    const tabs = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = Math.max(0, modes.indexOf(this.mode()));
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = modes.length - 1;
    else if (event.key === 'ArrowRight') next = (current + 1) % modes.length;
    else next = (current - 1 + modes.length) % modes.length;
    event.preventDefault();
    this.setMode(modes[next]);
    queueMicrotask(() => tabs[next]?.focus());
  }

  protected trapFocus(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected updateCloneRemote(remote: string): void {
    this.form.cloneRemote.set(remote);
    if (this.form.cloneFolder().trim()) return;
    const inferred = remote.trim().replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)?.replace(/\.git$/i, '');
    if (inferred) this.form.cloneFolder.set(inferred);
  }

  protected async chooseCloneParent(): Promise<void> {
    const path = await this.git.chooseDirectory('Choose where to clone the repository');
    if (path) this.form.cloneParentPath.set(path);
  }

  protected async chooseInitParent(): Promise<void> {
    const path = await this.git.chooseDirectory('Choose where to create the repository');
    if (path) this.form.initParentPath.set(path);
  }

  protected async submitClone(): Promise<void> {
    if (this.hostedMode() || !this.cloneReady() || this.git.busy()) return;
    const form = this.form;
    this.opening.emit();
    const depth = form.shallowClone() ? Math.max(1, Math.floor(Number(form.cloneDepth()) || 1)) : undefined;
    const opened = await this.git.cloneRepository(
      form.cloneRemote(),
      form.cloneParentPath(),
      form.cloneFolder(),
      { branch: form.shallowClone() ? form.cloneBranch() : undefined, depth, recurseSubmodules: form.recurseSubmodules() },
    );
    if (opened) this.opened.emit();
  }

  protected async submitInit(): Promise<void> {
    const form = this.form;
    this.opening.emit();
    const opened = await this.git.initializeRepository(form.initParentPath(), form.initFolder(), form.initBranch(), form.initReadme());
    if (opened) this.opened.emit();
  }
}
