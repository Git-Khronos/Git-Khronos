import { afterNextRender, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, Injector, input, OnDestroy, signal, viewChild } from '@angular/core';
import { GitKhronosService } from './git-khronos.service';
import { cloneFolderKey, createCloneRecipe, MAX_CLONES, MAX_RECIPE_TEXT, portableCloneSource, readCloneRecipe,
  suggestedCloneFolder, type CloneTarget, validCloneFolder } from './workspace-clone-recipe';

type CloneRow = CloneTarget & { state: string; detail?: string | null };
type CloneOwner = { workspaceId: string };
type RecipeRow = { id: string; path: string; label: string; remotes: { name: string; fetchUrl: string }[];
  remoteName: string; selected: boolean };

function containsCredentials(source: string): boolean {
  const match = /^(https?|ssh):\/\/([^/]+)/i.exec(source);
  const at = match?.[2].lastIndexOf('@') ?? -1;
  return !!match && at >= 0 && (match[1].toLowerCase() !== 'ssh' || match[2].slice(0, at).includes(':'));
}

@Component({
  selector: 'gc-workspace-clone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="actions">
      <button #start type="button" [disabled]="disabled() || git.browserPreview() || phase() === 'export'" [attr.aria-expanded]="phase() !== 'closed' && phase() !== 'export'"
        (click)="toggle()">Clone multiple repositories</button>
      <button #share type="button" [disabled]="disabled() || git.browserPreview() || (phase() !== 'closed' && phase() !== 'export')"
        [attr.aria-expanded]="phase() === 'export'" [attr.aria-disabled]="copying()" (click)="toggleRecipe()">Share clone recipe…</button>
    </div>
    @if (phase() === 'export') {
      <section aria-label="Share clone recipe">
        <h3 #heading tabindex="-1">Share clone recipe</h3>
        <p>Choose up to {{ limit }} open repositories and their fetch remotes. Only the selected URLs and suggested folder names
          are copied, not local checkout paths, push URLs, or separate credentials. Review private URLs before sharing. Nothing is uploaded.</p>
        <ul class="recipe-rows">
          @for (row of recipeRows(); track row.id) {
            <li>
              <label><input type="checkbox" [checked]="row.selected" [disabled]="!row.remotes.length || copying()"
                (change)="setRecipeRow(row.id, { selected: $any($event.target).checked })" /> Include {{ row.label }}</label>
              @if (row.remotes.length) {
                <label>Fetch remote for {{ row.label }}
                  <select [disabled]="!row.selected || copying()"
                    (change)="setRecipeRow(row.id, { remoteName: $any($event.target).value })">
                    @for (remote of row.remotes; track remote.name) { <option [value]="remote.name" [selected]="remote.name === row.remoteName">{{ remote.name }} · {{ remote.fetchUrl }}</option> }
                  </select>
                </label>
              } @else { <small>No shareable HTTPS or SSH fetch URL.</small> }
            </li>
          } @empty { <li>Open repositories with remotes to make a recipe.</li> }
        </ul>
        @if (recipeCount() > limit) { <p role="status">Select no more than {{ limit }} repositories.</p> }
        @if (recipeText(); as recipe) {
          <label for="workspace-clone-recipe">Recipe preview</label>
          <textarea id="workspace-clone-recipe" readonly rows="7" [value]="recipe"></textarea>
          <p>Paste this recipe into <strong>Clone multiple repositories</strong> to review and clone it on another machine.</p>
          <button type="button" [disabled]="disabled()" [attr.aria-disabled]="copying()" (click)="copyRecipe()">Copy clone recipe ({{ recipeCount() }})</button>
        }
        @if (error()) { <p role="alert">{{ error() }}</p> }
        @if (notice()) { <p role="status">{{ notice() }}</p> }
      </section>
    } @else if (phase() !== 'closed') {
      <section aria-label="Clone multiple repositories">
        <h3 #heading tabindex="-1">Clone multiple repositories</h3>
        @if (phase() === 'edit') {
          <p>Paste a Git Khronos clone recipe, or up to {{ limit }} repository URLs or local paths, one per line. All clones use the remote’s default branch and do not initialize submodules.</p>
          <label for="workspace-clone-sources">Repository URLs or paths</label>
          <textarea id="workspace-clone-sources" #sources rows="5" [maxLength]="textLimit" [value]="sourceText()" (input)="setSources(sources.value)"></textarea>
          <label for="workspace-clone-parent">Destination parent folder</label>
          <div class="actions"><input id="workspace-clone-parent" readonly [value]="parent()" /><button type="button"
            [disabled]="picking() || disabled()" (click)="chooseParent()">Choose destination…</button></div>
          @if (error()) { <p role="alert">{{ error() }}</p> }
          <button type="button" [disabled]="picking() || disabled() || !parent() || !sourceText().trim()" (click)="review()">Review clones</button>
        } @else if (phase() === 'review') {
          <p>Clones will be added as tabs in <strong>{{ git.activeWorkspace().name }}</strong>, under <code>{{ parent() }}</code>. No existing folder will be overwritten. Leaving this view stops the queue after the current clone.</p>
          <ol>
            @for (target of targets(); track $index; let index = $index) {
              <li><code>{{ target.source }}</code>
                <label>Folder for repository {{ index + 1 }} <input [value]="target.folder" (input)="setFolder(index, $any($event.target).value)" /></label>
              </li>
            }
          </ol>
          @if (planError()) { <p role="status">{{ planError() }}</p> }
          <div class="actions">
            <button type="button" (click)="edit()">Edit sources or destination</button>
            <button type="button" [disabled]="disabled() || !!planError()" (click)="execute()">Clone {{ targets().length }} {{ targets().length === 1 ? 'repository' : 'repositories' }}</button>
          </div>
        } @else {
          <p role="status" #progress tabindex="-1">{{ notice() }}</p>
          @if (phase() === 'running') {
            <button type="button" [attr.aria-disabled]="stopRequested()" (click)="stop()">Stop after current clone</button>
          }
          <ol aria-label="Clone results">
            @for (row of results(); track $index) {
              <li><code>{{ row.folder }}</code> — {{ row.state }} @if (row.detail) { <small>{{ row.detail }}</small> }</li>
            }
          </ol>
          @if (phase() === 'results') { <button type="button" [disabled]="disabled()" (click)="newBatch()">Start a new batch</button> }
        }
      </section>
    }
  `,
  styles: `
    :host, section, label { display: block; }
    section { border: 1px solid var(--inspector-divider); border-radius: 5px; padding: 14px; margin: 8px 0; }
    h3 { font-size: 14px; margin: 0 0 8px; }
    p, label, li, small, code { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    li + li { margin-top: 8px; } li small { display: block; }
    .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    input, select, textarea, button { color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); box-sizing: border-box; min-height: 32px; padding: 6px 10px; }
    .recipe-rows { padding-inline-start: 20px; } .recipe-rows select { max-width: 100%; }
    textarea { width: 100%; margin: 4px 0 8px; resize: vertical; } input { max-width: 100%; }
    .actions input { flex: 1 1 220px; } button { cursor: pointer; }
    button:disabled, button[aria-disabled=true] { opacity: .5; cursor: default; } [role=alert] { color: var(--danger); }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class WorkspaceCloneComponent implements OnDestroy {
  protected readonly git = inject(GitKhronosService);
  private readonly injector = inject(Injector);
  private readonly start = viewChild<ElementRef<HTMLButtonElement>>('start');
  private readonly share = viewChild<ElementRef<HTMLButtonElement>>('share');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly progress = viewChild<ElementRef<HTMLElement>>('progress');

  readonly disabled = input(false);
  readonly owner = input.required<() => CloneOwner | null>();
  protected readonly limit = MAX_CLONES;
  protected readonly textLimit = MAX_RECIPE_TEXT;
  protected readonly phase = signal<'closed' | 'export' | 'edit' | 'review' | 'running' | 'results'>('closed');
  protected readonly sourceText = signal('');
  protected readonly parent = signal('');
  protected readonly picking = signal(false);
  protected readonly error = signal('');
  protected readonly targets = signal<CloneTarget[]>([]);
  protected readonly results = signal<CloneRow[]>([]);
  protected readonly notice = signal('');
  protected readonly stopRequested = signal(false);
  protected readonly recipeRows = signal<RecipeRow[]>([]);
  protected readonly recipeCount = computed(() => this.recipeRows().filter(row => row.selected).length);
  protected readonly recipeText = computed(() => createCloneRecipe(this.recipeSources(this.recipeRows())));
  protected readonly copying = signal(false);
  private visit = 0;

  protected readonly planError = computed(() => {
    const names = new Set<string>();
    for (const [index, target] of this.targets().entries()) {
      const folder = target.folder.trim();
      if (!validCloneFolder(folder)) return `Enter a single folder name for repository ${index + 1}.`;
      const key = cloneFolderKey(folder);
      if (names.has(key)) return 'Each clone needs a different folder name.';
      names.add(key);
    }
    return '';
  });

  protected toggle(): void {
    if (this.disabled() || this.git.browserPreview() || !this.owner()() || this.phase() === 'export') return;
    if (this.phase() === 'closed') {
      this.phase.set('edit');
      this.focus(this.heading);
    } else if (this.phase() !== 'running') {
      this.retire();
      this.phase.set('closed');
      this.focus(this.start);
    }
  }

  protected toggleRecipe(): void {
    if (this.disabled() || this.git.browserPreview() || !this.owner()() || this.copying()) return;
    if (this.phase() === 'export') {
      this.retire();
      this.phase.set('closed');
      this.focus(this.share);
    } else if (this.phase() === 'closed') {
      const rows = this.git.repositories().map(repository => {
        const remotes = repository.remotes.filter(remote => portableCloneSource(remote.fetchUrl))
          .map(({ name, fetchUrl }) => ({ name, fetchUrl }));
        return { id: repository.id, path: repository.path, label: this.git.repositoryLabel(repository), remotes,
          remoteName: remotes.find(remote => remote.name === 'origin')?.name ?? remotes[0]?.name ?? '', selected: !!remotes.length };
      });
      this.recipeRows.set(rows.filter(row => row.selected).length <= MAX_CLONES ? rows : rows.map(row => ({ ...row, selected: false })));
      this.error.set('');
      this.notice.set('');
      this.phase.set('export');
      this.focus(this.heading);
    }
  }

  protected setRecipeRow(id: string, value: Partial<Pick<RecipeRow, 'selected' | 'remoteName'>>): void {
    if (this.phase() !== 'export' || this.copying()) return;
    this.recipeRows.update(rows => rows.map(row => row.id === id ? { ...row, ...value } : row));
    this.error.set('');
    this.notice.set('');
  }

  protected async copyRecipe(): Promise<void> {
    if (this.phase() !== 'export' || this.disabled() || this.git.browserPreview() || this.copying() || !this.owner()()) return;
    const recipe = this.recipeText();
    if (!recipe) return;
    const current = this.currentVisit();
    const repositories = this.git.repositories();
    const stale = this.recipeRows().some(row => row.selected && !repositories.some(repository =>
      repository.id === row.id && repository.path === row.path && repository.remotes.some(remote =>
        remote.name === row.remoteName && remote.fetchUrl === row.remotes.find(item => item.name === row.remoteName)?.fetchUrl)));
    if (stale) {
      this.error.set('A selected remote changed. Close and reopen this recipe to review the latest URLs.');
      return;
    }
    this.copying.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await navigator.clipboard.writeText(recipe);
      if (current()) this.notice.set('Clone recipe copied.');
    } catch {
      if (current()) this.error.set('Could not copy automatically. Select the recipe preview and copy it manually.');
    } finally {
      if (current()) this.copying.set(false);
    }
  }

  private recipeSources(rows: RecipeRow[]): string[] {
    return rows.filter(row => row.selected).map(row => row.remotes.find(remote => remote.name === row.remoteName)?.fetchUrl ?? '');
  }

  protected setSources(value: string): void {
    this.sourceText.set(value);
    this.error.set('');
  }

  protected async chooseParent(): Promise<void> {
    if (!this.canStart('edit') || this.picking()) return;
    const current = this.currentVisit();
    this.picking.set(true);
    try {
      const selected = await this.git.chooseDirectory('Choose a destination for the workspace clones', current);
      if (selected && current()) this.parent.set(selected);
    } finally {
      if (current()) this.picking.set(false);
    }
  }

  protected review(): void {
    if (!this.canStart('edit') || this.picking() || !this.parent()) return;
    const input = this.sourceText().trim();
    if (input.startsWith('{')) {
      const recipe = readCloneRecipe(input);
      if ('error' in recipe) {
        this.error.set(recipe.error);
        return;
      }
      this.showReview(recipe.targets);
      return;
    }
    const sources = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!sources.length || sources.length > MAX_CLONES) {
      this.error.set(`Enter between 1 and ${MAX_CLONES} repository URLs or paths.`);
      return;
    }
    const target = sources.findIndex((source) => source.startsWith('-') || /[\u0000-\u001f]/.test(source));
    if (target >= 0) {
      this.error.set(`Repository ${target + 1} is not a valid URL or path.`);
      return;
    }
    const credential = sources.findIndex(containsCredentials);
    if (credential >= 0) {
      this.error.set(`Remove embedded credentials from repository ${credential + 1}. Git will ask for credentials if needed.`);
      return;
    }
    this.showReview(sources.map(source => ({ source, folder: suggestedCloneFolder(source) })));
  }

  private showReview(targets: CloneTarget[]): void {
    this.error.set('');
    this.targets.set(targets);
    this.phase.set('review');
    this.focus(this.heading);
  }

  protected setFolder(index: number, folder: string): void {
    if (this.phase() === 'review') this.targets.update(targets => targets.map((row, i) => i === index ? { ...row, folder } : row));
  }

  protected edit(): void {
    if (this.phase() !== 'review') return;
    this.phase.set('edit');
    this.focus(this.heading);
  }

  protected newBatch(): void {
    if (!this.canStart('results')) return;
    this.setSources('');
    this.targets.set([]);
    this.results.set([]);
    this.phase.set('edit');
    this.focus(this.heading);
  }

  protected async execute(): Promise<void> {
    if (!this.canStart('review') || this.planError()) return;
    const current = this.currentVisit();
    const parent = this.parent();
    const rows: CloneRow[] = this.targets().map(target => ({ ...target, folder: target.folder.trim(), state: 'Not started' }));
    this.phase.set('running');
    this.results.set([...rows]);
    this.stopRequested.set(false);
    this.focus(this.progress);
    let completed = 0;
    let attempted = 0;
    for (const row of rows) {
      if (!current() || this.stopRequested()) break;
      if (this.git.busy()) break; // An unrelated operation took ownership between items.
      this.notice.set(`Cloning ${attempted + 1} of ${rows.length}…`);
      row.state = 'Cloning…';
      this.results.set([...rows]);
      attempted++;
      const result = await this.git.cloneRepository(row.source, parent, row.folder, { preserveActiveTab: true }, current);
      if (!current()) return;
      if (result.status === 'opened' || result.status === 'saved') {
        row.state = result.status === 'opened' ? 'Cloned' : 'Cloned and saved';
        row.detail = result.status === 'saved' ? result.message : null;
        completed++;
      } else {
        row.state = result.status === 'cancelled' ? 'Cancelled' : 'Could not clone';
        row.detail = result.error;
        if (result.status === 'cancelled') this.stopRequested.set(true);
      }
      this.results.set([...rows]);
    }
    if (!current()) return;
    const notStarted = rows.length - attempted;
    this.notice.set(`Cloned ${completed} of ${rows.length} repositories.${notStarted ? ` ${notStarted} not started.` : ''}`);
    this.phase.set('results');
    this.focus(this.progress);
  }

  protected stop(): void {
    if (this.phase() !== 'running' || this.stopRequested()) return;
    this.stopRequested.set(true);
    this.notice.set('Stopping after the current clone finishes…');
  }

  retire(): void {
    this.visit++;
    this.picking.set(false);
    this.copying.set(false);
  }

  ngOnDestroy(): void { this.retire(); }

  private currentVisit(): () => boolean {
    const owner = this.owner()();
    const visit = this.visit;
    return () => !!owner && this.owner()() === owner && this.visit === visit;
  }

  private canStart(phase: ReturnType<typeof this.phase>): boolean {
    return this.phase() === phase && !this.disabled() && !this.git.browserPreview() && !!this.owner()();
  }

  private focus(element: typeof this.heading): void {
    const current = this.currentVisit();
    afterNextRender(() => { if (current()) element()?.nativeElement.focus(); }, { injector: this.injector });
  }
}
