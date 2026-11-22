import { afterNextRender, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, Injector, input, OnDestroy, signal, viewChild } from '@angular/core';
import { GitKhronosService } from './git-khronos.service';

const MAX_CLONES = 20;
type CloneTarget = { source: string; folder: string };
type CloneRow = CloneTarget & { state: string; detail?: string | null };
type CloneOwner = { workspaceId: string };

function suggestedFolder(source: string): string {
  const path = /^[a-z][\w+.-]*:\/\//i.test(source)
    ? source.replace(/^[a-z][\w+.-]*:\/\/[^/]*(\/|$)/i, '').split(/[?#]/, 1)[0]
    : source.replace(/^[^/\\:]+:(?![/\\])/, '');
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1)?.replace(/\.git$/i, '') ?? '';
}

function validFolder(folder: string): boolean {
  return !!folder && folder !== '.' && folder !== '..' && folder.length <= 255
    && !/[<>:"/\\|?*\u0000-\u001f]/.test(folder) && !folder.endsWith('.')
    && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(folder);
}

function containsCredentials(source: string): boolean {
  const match = /^(https?|ssh):\/\/([^/]+)/i.exec(source);
  const at = match?.[2].lastIndexOf('@') ?? -1;
  return !!match && at >= 0 && (match[1].toLowerCase() !== 'ssh' || match[2].slice(0, at).includes(':'));
}

@Component({
  selector: 'gc-workspace-clone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #start type="button" [disabled]="disabled() || git.browserPreview()" [attr.aria-expanded]="phase() !== 'closed'"
      (click)="toggle()">Clone multiple repositories</button>
    @if (phase() !== 'closed') {
      <section aria-label="Clone multiple repositories">
        <h3 #heading tabindex="-1">Clone multiple repositories</h3>
        @if (phase() === 'edit') {
          <p>Paste up to {{ limit }} repository URLs or local paths, one per line. All clones use the remote’s default branch and do not initialize submodules.</p>
          <label for="workspace-clone-sources">Repository URLs or paths</label>
          <textarea id="workspace-clone-sources" #sources rows="5" maxlength="40960" [value]="sourceText()" (input)="setSources(sources.value)"></textarea>
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
    input, textarea, button { color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); box-sizing: border-box; min-height: 32px; padding: 6px 10px; }
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
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly progress = viewChild<ElementRef<HTMLElement>>('progress');

  readonly disabled = input(false);
  readonly owner = input.required<() => CloneOwner | null>();
  protected readonly limit = MAX_CLONES;
  protected readonly phase = signal<'closed' | 'edit' | 'review' | 'running' | 'results'>('closed');
  protected readonly sourceText = signal('');
  protected readonly parent = signal('');
  protected readonly picking = signal(false);
  protected readonly error = signal('');
  protected readonly targets = signal<CloneTarget[]>([]);
  protected readonly results = signal<CloneRow[]>([]);
  protected readonly notice = signal('');
  protected readonly stopRequested = signal(false);
  private visit = 0;

  protected readonly planError = computed(() => {
    const names = new Set<string>();
    for (const [index, target] of this.targets().entries()) {
      const folder = target.folder.trim();
      if (!validFolder(folder)) return `Enter a single folder name for repository ${index + 1}.`;
      const key = folder.normalize('NFC').toLowerCase();
      if (names.has(key)) return 'Each clone needs a different folder name.';
      names.add(key);
    }
    return '';
  });

  protected toggle(): void {
    if (this.disabled() || this.git.browserPreview() || !this.owner()()) return;
    if (this.phase() === 'closed') {
      this.phase.set('edit');
      this.focus(this.heading);
    } else if (this.phase() !== 'running') {
      this.retire();
      this.phase.set('closed');
      this.focus(this.start);
    }
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
    const sources = this.sourceText().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
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
    this.error.set('');
    this.targets.set(sources.map(source => ({ source, folder: suggestedFolder(source) })));
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
