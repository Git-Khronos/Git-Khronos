import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from './icon.component';
import type { ShortcutLabels } from './shortcut-labels';

type ShortcutSection = 'repository' | 'navigation' | 'interface' | 'tabs-view';

interface ShortcutEntry {
  label: string;
  keys: string[];
}

interface ShortcutGroup {
  id: ShortcutSection;
  title: string;
  entries: ShortcutEntry[];
}

function chord(value: string): string[] {
  return value.split(' ').filter(Boolean);
}

/** Loaded on demand so the shortcut reference stays out of the startup bundle. */
@Component({
  selector: 'gc-keyboard-shortcuts-dialog',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="shortcuts-backdrop" (click)="closed.emit()">
    <section class="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" (click)="$event.stopPropagation()" (keydown)="trapFocus($event)">
      <header><span><gc-icon name="keyboard" [size]="18" /></span><div><h2 id="shortcuts-title">Keyboard Shortcuts</h2><small>Fast paths through Git Khronos</small></div><button type="button" aria-label="Close keyboard shortcuts" title="Close keyboard shortcuts (Esc)" (click)="closed.emit()"><gc-icon name="x" [size]="14" /></button></header>
      <div class="shortcut-search-row">
        <div class="shortcut-search"><gc-icon name="search" [size]="15" /><input #searchInput type="text" role="searchbox" aria-label="Search keyboard shortcuts" placeholder="Search actions or keys" autocomplete="off" [value]="query()" (input)="updateQuery($event)" />@if (query()) { <button type="button" aria-label="Clear shortcut search" title="Clear search" (click)="clearSearch()"><gc-icon name="x" [size]="12" /></button> }</div>
        <small role="status" aria-live="polite">{{ resultCount() }} {{ resultCount() === 1 ? 'shortcut' : 'shortcuts' }}</small>
      </div>
      @if (filteredGroups().length) {
        <nav class="shortcut-section-nav" aria-label="Shortcut sections">
          <span>Jump to</span>
          <div>
            @for (group of filteredGroups(); track group.id) {
              <button type="button" [attr.aria-controls]="'shortcut-section-' + group.id" [class.active]="section() === group.id" [attr.aria-current]="section() === group.id ? 'location' : null" (click)="scrollTo($event, group.id)">{{ group.title }}</button>
            }
          </div>
        </nav>
      }
      <div class="shortcut-groups" (scroll)="syncSection($event)">
        @for (group of filteredGroups(); track group.id) {
          <section [id]="'shortcut-section-' + group.id">
            <h3>{{ group.title }}</h3>
            <dl>
              @for (entry of group.entries; track entry.label) {
                <div><dt>{{ entry.label }}</dt><dd>@for (key of entry.keys; track $index) { @if (key === ' / ') { <span aria-hidden="true">/</span> } @else { <kbd>{{ key }}</kbd> } }</dd></div>
              }
            </dl>
          </section>
        } @empty {
          <div class="shortcut-empty"><gc-icon name="search" [size]="23" /><strong>No matching shortcuts</strong><small>Try an action such as “branch” or a key such as “Ctrl”.</small><button type="button" (click)="clearSearch()"><gc-icon name="reset" [size]="13" /> Clear search</button></div>
        }
      </div>
      <footer><span>Search by action or key</span><span>Press <kbd>Esc</kbd> to close</span></footer>
    </section>
  </div>
  `,
  styles: [`
:host { display: contents; }
.shortcuts-backdrop { position: fixed; z-index: 56; inset: 0; display: grid; place-items: center; padding: 22px; background: var(--overlay-backdrop); backdrop-filter: blur(4px); }
.shortcuts-dialog { width: min(780px, 100%); max-height: calc(100vh - 44px); display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; overflow: hidden; border: 1px solid var(--overlay-border); border-radius: 7px; background: var(--overlay-surface); box-shadow: 0 30px 100px #000d; }
.shortcuts-dialog > header { display: grid; grid-template-columns: 34px minmax(0, 1fr) 30px; align-items: center; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--overlay-header-border); background: var(--overlay-search); }
.shortcuts-dialog > header > span { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: var(--overlay-icon); color: var(--accent); }
.shortcuts-dialog h2 { margin: 0; color: var(--overlay-strong); font-size: 15px; }
.shortcuts-dialog header small { color: var(--overlay-muted); font-size: 12px; }
.shortcuts-dialog header button { width: 30px; height: 30px; display: grid; place-items: center; align-self: start; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--overlay-muted); }
.shortcuts-dialog header button:hover { border-color: var(--overlay-control-border); background: var(--overlay-hover); color: var(--overlay-strong); }
.shortcuts-dialog button:focus-visible, .shortcut-search:focus-within { outline: 2px solid var(--purple); outline-offset: 1px; }
.shortcut-search-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 9px 12px; border-bottom: 1px solid var(--overlay-divider); background: var(--overlay-search); }
.shortcut-search { min-width: 0; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 10px; border: 1px solid var(--overlay-control-border); border-radius: 5px; background: var(--overlay-control); color: var(--accent); }
.shortcut-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--overlay-search-text); font: inherit; font-size: var(--font-size-body); }
.shortcut-search input::placeholder { color: var(--overlay-muted); }
.shortcut-search button { width: 25px; height: 25px; display: grid; place-items: center; border: 0; border-radius: 3px; background: transparent; color: var(--overlay-muted); }
.shortcut-search button:hover { background: var(--overlay-hover); color: var(--overlay-strong); }
.shortcut-search-row > small { min-width: 78px; color: var(--overlay-muted); font-size: var(--font-size-caption); font-variant-numeric: tabular-nums; text-align: right; }
.shortcut-section-nav { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 7px 12px; border-bottom: 1px solid var(--overlay-divider); background: var(--overlay-surface); }
.shortcut-section-nav > span { flex: none; color: var(--overlay-muted); font-size: var(--font-size-caption); font-weight: 650; letter-spacing: .02em; }
.shortcut-section-nav > div { display: flex; gap: 5px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.shortcut-section-nav > div::-webkit-scrollbar { display: none; }
.shortcut-section-nav button { flex: none; padding: 5px 9px; border: 1px solid var(--overlay-control-border); border-radius: 4px; background: var(--overlay-control); color: var(--overlay-list-text); font-size: var(--font-size-body); }
.shortcut-section-nav button:hover, .shortcut-section-nav button:focus-visible { border-color: var(--overlay-border); background: var(--overlay-hover); color: var(--overlay-strong); }
.shortcut-section-nav button.active { border-color: color-mix(in srgb, var(--accent) 52%, var(--overlay-border)); background: color-mix(in srgb, var(--accent) 12%, var(--overlay-control)); color: var(--overlay-strong); box-shadow: inset 0 -2px var(--accent); }
.shortcut-groups { min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 18px 24px; padding: 18px 20px 20px; }
.shortcut-groups > section { min-width: 0; scroll-margin-top: 18px; }
.shortcut-groups > section:only-child { grid-column: 1 / -1; width: min(100%, 560px); justify-self: center; }
.shortcut-groups h3 { margin: 0 0 7px; color: var(--overlay-muted); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.shortcut-groups dl { display: block !important; margin: 0; }
.shortcut-groups dl > div { min-height: 31px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--overlay-divider); }
.shortcut-groups dt { min-width: 0; flex: 1; color: var(--overlay-list-text); font-size: var(--font-size-body); }
.shortcut-groups dd { display: flex; align-items: center; gap: 3px; margin: 0; color: var(--overlay-muted); font-size: 12px; white-space: nowrap; }
.shortcut-groups dd > span { padding-inline: 1px; color: var(--overlay-muted); }
.shortcuts-dialog kbd { min-width: 20px; padding: 3px 5px; border: 1px solid var(--overlay-control-border); border-bottom-color: var(--overlay-border); border-radius: 3px; background: var(--overlay-control); color: var(--overlay-kbd); font: 12px var(--mono); text-align: center; box-shadow: 0 1px 0 #11111b; }
.shortcut-empty { grid-column: 1 / -1; min-height: 210px; display: grid; place-items: center; align-content: center; gap: 8px; color: var(--overlay-muted); text-align: center; }
.shortcut-empty strong { color: var(--overlay-list-text); font-size: var(--font-size-body); }
.shortcut-empty small { color: var(--overlay-muted); font-size: var(--font-size-caption); }
.shortcut-empty button { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; margin-top: 3px; padding: 5px 10px; border: 1px solid var(--overlay-control-border); border-radius: 4px; background: var(--overlay-control); color: var(--overlay-strong); font: inherit; font-weight: 650; }
.shortcut-empty button:hover { border-color: var(--overlay-border); background: var(--overlay-hover); }
.shortcuts-dialog > footer { display: flex; justify-content: space-between; gap: 16px; padding: 8px 16px; border-top: 1px solid var(--overlay-divider); background: var(--overlay-search); color: var(--overlay-muted); font-size: 12px; }
@media (max-width: 680px) { .shortcut-groups { grid-template-columns: 1fr; } .shortcut-search-row { grid-template-columns: 1fr; gap: 5px; } .shortcut-search-row > small { text-align: left; } }
  `],
})
export class KeyboardShortcutsDialogComponent {
  readonly labels = input.required<ShortcutLabels>();
  readonly closed = output<void>();
  protected readonly section = signal<ShortcutSection>('repository');
  protected readonly query = signal('');
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly groups = computed<ShortcutGroup[]>(() => {
    const labels = this.labels();
    return [
      { id: 'repository', title: 'Repository', entries: [
        { label: 'Undo repository action', keys: chord(labels.undo) },
        { label: 'Redo repository action', keys: chord(labels.redo) },
        { label: 'Create branch', keys: [labels.primary, 'B'] },
        { label: 'Fetch all', keys: [labels.primary, 'L'] },
        { label: 'Stage selected file', keys: ['S'] },
        { label: 'Stage all', keys: [labels.primary, 'Shift', 'S'] },
        { label: 'Unstage selected file', keys: ['U'] },
        { label: 'Unstage all', keys: [labels.primary, 'Shift', 'U'] },
        { label: 'Commit staged files', keys: [labels.primary, 'Enter'] },
        { label: 'Stage all and commit', keys: [labels.primary, 'Shift', 'Enter'] },
      ] },
      { id: 'navigation', title: 'Navigation', entries: [
        { label: 'Next / previous workspace region', keys: ['F6', ' / ', 'Shift', 'F6'] },
        { label: 'Older commit', keys: ['J', ' / ', '↓'] },
        { label: 'Newer commit', keys: ['K', ' / ', '↑'] },
        { label: 'Follow branch toward parent', keys: ['Shift', 'J', ' / ', '↓'] },
        { label: 'Follow branch toward child', keys: ['Shift', 'K', ' / ', '↑'] },
        { label: 'Connected commit to the left', keys: ['H', ' / ', '←'] },
        { label: 'Connected commit to the right', keys: ['L', ' / ', '→'] },
        { label: 'First commit', keys: chord(labels.firstCommit) },
        { label: 'Last commit', keys: chord(labels.lastCommit) },
        { label: 'Previous / next changed file', keys: [labels.alternate, '↑', ' / ', '↓'] },
        { label: 'Previous diff change', keys: ['Shift', 'F7'] },
        { label: 'Next diff change', keys: ['F7'] },
        { label: 'Next repository tab', keys: ['Ctrl', 'Tab'] },
        { label: 'Previous repository tab', keys: ['Ctrl', 'Shift', 'Tab'] },
      ] },
      { id: 'interface', title: 'Interface', entries: [
        { label: 'Command Palette', keys: [labels.primary, 'P'] },
        { label: 'Filter loaded commits', keys: [labels.primary, 'F'] },
        { label: 'Search all repository history', keys: [labels.primary, 'Shift', 'F'] },
        { label: 'Find file history or blame', keys: [labels.primary, 'Shift', 'H'] },
        { label: 'Filter references', keys: [labels.primary, labels.alternate, 'F'] },
        { label: 'Open diff view', keys: [labels.primary, 'D'] },
        { label: 'Toggle Left Panel', keys: [labels.primary, 'J'] },
        { label: 'Toggle Commit Panel', keys: [labels.primary, 'K'] },
        { label: 'Close focused panel', keys: ['Esc'] },
        { label: 'Focus commit message', keys: [labels.primary, 'Shift', 'M'] },
      ] },
      { id: 'tabs-view', title: 'Tabs and view', entries: [
        { label: 'New repository tab', keys: [labels.primary, 'T'] },
        { label: 'Reopen closed repository', keys: [labels.primary, 'Shift', 'T'] },
        { label: 'Open repository', keys: [labels.primary, 'Shift', 'O'] },
        { label: 'Close repository tab', keys: [labels.primary, 'W'] },
        { label: 'Move repository tab left / right', keys: [labels.primary, 'Shift', 'Page ↑', ' / ', 'Page ↓'] },
        { label: 'Workspace 1–9', keys: [labels.primary, 'Shift', '1–9'] },
        { label: 'Favorite repository 1–9', keys: [...chord(labels.favorite), '1–9'] },
        { label: 'Repository terminal', keys: [labels.alternate, 'T', ' / ', labels.primary, '`'] },
        { label: 'New terminal tab', keys: ['Ctrl', 'Shift', 'T'] },
        { label: 'Close terminal tab', keys: ['Ctrl', 'Shift', 'W'] },
        { label: 'Previous / next terminal', keys: ['Ctrl', 'Page ↑', ' / ', 'Page ↓'] },
        { label: 'Open repository folder', keys: [labels.alternate, 'O'] },
        { label: 'Toggle fullscreen', keys: chord(labels.fullscreen) },
        { label: 'Zoom in / out', keys: [labels.primary, '+', ' / ', '-'] },
        { label: 'Reset zoom', keys: [labels.primary, '0'] },
        { label: 'Shortcut reference', keys: [labels.primary, '/'] },
      ] },
    ];
  });

  protected readonly filteredGroups = computed(() => {
    const tokens = this.query().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return this.groups();
    return this.groups().map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => {
        const searchable = `${group.title} ${entry.label} ${entry.keys.join(' ')}`.toLocaleLowerCase();
        return tokens.every((token) => searchable.includes(token));
      }),
    })).filter((group) => group.entries.length > 0);
  });

  protected readonly resultCount = computed(() => this.filteredGroups()
    .reduce((total, group) => total + group.entries.length, 0));

  constructor() {
    afterNextRender(() => this.searchInput().nativeElement.focus());
  }

  protected updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    const first = this.filteredGroups()[0]?.id;
    if (first) this.section.set(first);
  }

  protected clearSearch(): void {
    this.query.set('');
    this.section.set('repository');
    queueMicrotask(() => this.searchInput().nativeElement.focus());
  }

  protected scrollTo(event: Event, section: ShortcutSection): void {
    this.section.set(section);
    const dialog = (event.currentTarget as HTMLElement).closest<HTMLElement>('.shortcuts-dialog');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    dialog?.querySelector<HTMLElement>(`#shortcut-section-${section}`)
      ?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  protected syncSection(event: Event): void {
    const scroller = event.currentTarget as HTMLElement;
    const visibleGroups = this.filteredGroups();
    if (!visibleGroups.length) return;

    if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2) {
      this.section.set(visibleGroups.at(-1)!.id);
      return;
    }

    const activationLine = scroller.getBoundingClientRect().top + 24;
    let active = visibleGroups[0].id;
    for (const group of visibleGroups) {
      const element = scroller.querySelector<HTMLElement>(`#shortcut-section-${group.id}`);
      if (element && element.getBoundingClientRect().top <= activationLine) active = group.id;
    }
    this.section.set(active);
  }

  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget as HTMLElement;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
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
}
