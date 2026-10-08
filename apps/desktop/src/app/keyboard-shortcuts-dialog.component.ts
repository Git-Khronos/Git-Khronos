import { afterNextRender, ChangeDetectionStrategy, Component, type ElementRef, input, output, signal, viewChild } from '@angular/core';
import { IconComponent } from './icon.component';
import type { ShortcutLabels } from './shortcut-labels';

type ShortcutSection = 'repository' | 'navigation' | 'interface' | 'tabs-view';

/** Loaded on demand so the shortcut reference stays out of the startup bundle. */
@Component({
  selector: 'gc-keyboard-shortcuts-dialog',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="shortcuts-backdrop" (click)="closed.emit()">
    <section class="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" (click)="$event.stopPropagation()" (keydown)="trapFocus($event)">
      <header><span><gc-icon name="command" [size]="18" /></span><div><h2 id="shortcuts-title">Keyboard Shortcuts</h2><small>Familiar desktop Git navigation</small></div><button #close type="button" aria-label="Close keyboard shortcuts" title="Close keyboard shortcuts (Esc)" (click)="closed.emit()"><gc-icon name="x" [size]="14" /></button></header>
      <nav class="shortcut-section-nav" aria-label="Shortcut categories">
        <button type="button" aria-controls="shortcut-section-repository" [class.active]="section() === 'repository'" [attr.aria-current]="section() === 'repository' ? 'location' : null" (click)="scrollTo($event, 'repository')">Repository</button>
        <button type="button" aria-controls="shortcut-section-navigation" [class.active]="section() === 'navigation'" [attr.aria-current]="section() === 'navigation' ? 'location' : null" (click)="scrollTo($event, 'navigation')">Navigation</button>
        <button type="button" aria-controls="shortcut-section-interface" [class.active]="section() === 'interface'" [attr.aria-current]="section() === 'interface' ? 'location' : null" (click)="scrollTo($event, 'interface')">Interface</button>
        <button type="button" aria-controls="shortcut-section-tabs-view" [class.active]="section() === 'tabs-view'" [attr.aria-current]="section() === 'tabs-view' ? 'location' : null" (click)="scrollTo($event, 'tabs-view')">Tabs and view</button>
      </nav>
      <div class="shortcut-groups">
        <section id="shortcut-section-repository"><h3>Repository</h3><dl><div><dt>Undo repository action</dt><dd>@for (key of labels().undo.split(' '); track key) { <kbd>{{ key }}</kbd> }</dd></div><div><dt>Redo repository action</dt><dd>@for (key of labels().redo.split(' '); track key) { <kbd>{{ key }}</kbd> }</dd></div><div><dt>Create branch</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>B</kbd></dd></div><div><dt>Fetch all</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>L</kbd></dd></div><div><dt>Stage selected file</dt><dd><kbd>S</kbd></dd></div><div><dt>Stage all</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>S</kbd></dd></div><div><dt>Unstage selected file</dt><dd><kbd>U</kbd></dd></div><div><dt>Unstage all</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>U</kbd></dd></div><div><dt>Commit staged files</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Enter</kbd></dd></div><div><dt>Stage all and commit</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>Enter</kbd></dd></div></dl></section>
        <section id="shortcut-section-navigation"><h3>Navigation</h3><dl><div><dt>Older commit</dt><dd><kbd>J</kbd> / <kbd>↓</kbd></dd></div><div><dt>Newer commit</dt><dd><kbd>K</kbd> / <kbd>↑</kbd></dd></div><div><dt>Follow branch toward parent</dt><dd><kbd>Shift</kbd><kbd>J</kbd> / <kbd>↓</kbd></dd></div><div><dt>Follow branch toward child</dt><dd><kbd>Shift</kbd><kbd>K</kbd> / <kbd>↑</kbd></dd></div><div><dt>Connected commit to the left</dt><dd><kbd>H</kbd> / <kbd>←</kbd></dd></div><div><dt>Connected commit to the right</dt><dd><kbd>L</kbd> / <kbd>→</kbd></dd></div><div><dt>First commit</dt><dd>@for (key of labels().firstCommit.split(' '); track key) { <kbd>{{ key }}</kbd> }</dd></div><div><dt>Last commit</dt><dd>@for (key of labels().lastCommit.split(' '); track key) { <kbd>{{ key }}</kbd> }</dd></div><div><dt>Previous / next changed file</dt><dd><kbd>Alt</kbd><kbd>↑</kbd> / <kbd>↓</kbd></dd></div><div><dt>Previous diff change</dt><dd><kbd>Shift</kbd><kbd>F7</kbd></dd></div><div><dt>Next diff change</dt><dd><kbd>F7</kbd></dd></div><div><dt>Next repository tab</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Tab</kbd></dd></div><div><dt>Previous repository tab</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>Tab</kbd></dd></div></dl></section>
        <section id="shortcut-section-interface"><h3>Interface</h3><dl><div><dt>Command Palette</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>P</kbd></dd></div><div><dt>Search commits</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>F</kbd></dd></div><div><dt>Find file history or blame</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>H</kbd></dd></div><div><dt>Filter references</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>{{ labels().alternate }}</kbd><kbd>F</kbd></dd></div><div><dt>Open diff view</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>D</kbd></dd></div><div><dt>Toggle Left Panel</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>J</kbd></dd></div><div><dt>Toggle Commit Panel</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>K</kbd></dd></div><div><dt>Close focused panel</dt><dd><kbd>Esc</kbd></dd></div><div><dt>Focus commit message</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>M</kbd></dd></div></dl></section>
        <section id="shortcut-section-tabs-view"><h3>Tabs and view</h3><dl><div><dt>New repository tab</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>T</kbd></dd></div><div><dt>Reopen closed repository</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>T</kbd></dd></div><div><dt>Open repository</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>O</kbd></dd></div><div><dt>Close repository tab</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>W</kbd></dd></div><div><dt>Workspace 1–9</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>Shift</kbd><kbd>1–9</kbd></dd></div><div><dt>Favorite repository 1–9</dt><dd>@for (key of labels().favorite.split(' '); track key) { <kbd>{{ key }}</kbd> }<kbd>1–9</kbd></dd></div><div><dt>Repository terminal</dt><dd><kbd>{{ labels().alternate }}</kbd><kbd>T</kbd></dd></div><div><dt>New terminal tab</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>T</kbd></dd></div><div><dt>Close terminal tab</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>W</kbd></dd></div><div><dt>Previous / next terminal</dt><dd><kbd>Ctrl</kbd><kbd>Page ↑</kbd> / <kbd>Page ↓</kbd></dd></div><div><dt>Open repository folder</dt><dd><kbd>{{ labels().alternate }}</kbd><kbd>O</kbd></dd></div><div><dt>Toggle fullscreen</dt><dd>@for (key of labels().fullscreen.split(' '); track key) { <kbd>{{ key }}</kbd> }</dd></div><div><dt>Zoom in / out</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>+</kbd> / <kbd>-</kbd></dd></div><div><dt>Reset zoom</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>0</kbd></dd></div><div><dt>Shortcut reference</dt><dd><kbd>{{ labels().primary }}</kbd><kbd>/</kbd></dd></div></dl></section>
      </div>
      <footer>Press <kbd>Esc</kbd> to close</footer>
    </section>
  </div>
  `,
  styles: [`
.shortcuts-backdrop { position: fixed; z-index: 56; inset: 0; display: grid; place-items: center; padding: 22px; background: #070710d1; backdrop-filter: blur(4px); }
.shortcuts-dialog { width: min(780px, 100%); max-height: calc(100vh - 44px); overflow: hidden; border: 1px solid #55536d; border-radius: 7px; background: #1d1d2b; box-shadow: 0 30px 100px #000d; }
.shortcuts-dialog > header { display: grid; grid-template-columns: 34px minmax(0, 1fr) 30px; align-items: center; gap: 10px; padding: 13px 16px; border-bottom: 1px solid #39384b; background: #28273a; }
.shortcuts-dialog > header > span { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: #45415f; color: #c6bdff; }
.shortcuts-dialog h2 { margin: 0; color: #f0eff5; font-size: 15px; }
.shortcuts-dialog header small { color: #858397; font-size: 12px; }
.shortcuts-dialog header button { width: 30px; height: 30px; display: grid; place-items: center; align-self: start; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #858397; }
.shortcuts-dialog header button:hover { border-color: #55536d; background: #39374f; color: white; }
.shortcuts-dialog header button:focus-visible { outline: 2px solid var(--purple); outline-offset: 1px; }
.shortcut-section-nav { display: flex; gap: 5px; overflow-x: auto; padding: 7px 12px; border-bottom: 1px solid #39384b; background: #232234; scrollbar-width: none; }
.shortcut-section-nav::-webkit-scrollbar { display: none; }
.shortcut-section-nav button { flex: none; padding: 5px 9px; border: 1px solid #41405a; border-radius: 4px; background: #2c2b40; color: #aaa8ba; font-size: 12px; }
.shortcut-section-nav button:hover, .shortcut-section-nav button:focus-visible { border-color: #716ca0; background: #39374f; color: white; }
.shortcut-section-nav button.active { border-color: #6f69a4; background: #464260; color: #f2efff; box-shadow: inset 0 -2px #8b82df; }
.shortcut-section-nav button:focus-visible { outline: 2px solid var(--purple); outline-offset: 1px; }
.shortcut-groups { max-height: calc(100vh - 150px); overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 24px; padding: 18px 20px 20px; }
.shortcut-groups > section { scroll-margin-top: 18px; }
.shortcut-groups section { min-width: 0; }
.shortcut-groups h3 { margin: 0 0 7px; color: #77758c; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.shortcut-groups dl { display: block !important; margin: 0; }
.shortcut-groups dl > div { min-height: 31px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #2b2a3b; }
.shortcut-groups dt { flex: 1; color: #c7c6d2; font-size: 12px; }
.shortcut-groups dd { display: flex; align-items: center; gap: 3px; margin: 0; color: #77758a; font-size: 12px; }
.shortcuts-dialog kbd { min-width: 20px; padding: 3px 5px; border: 1px solid #4a4860; border-bottom-color: #65627c; border-radius: 3px; background: #302f43; color: #d7d5e2; font: 12px var(--mono); text-align: center; box-shadow: 0 1px 0 #11111b; }
.shortcuts-dialog > footer { padding: 8px 16px; border-top: 1px solid #39384b; background: #252436; color: #77758a; font-size: 12px; text-align: right; }
@media (max-width: 680px) { .shortcut-groups { grid-template-columns: 1fr; } }
  `],
})
export class KeyboardShortcutsDialogComponent {
  readonly labels = input.required<ShortcutLabels>();
  readonly closed = output<void>();
  protected readonly section = signal<ShortcutSection>('repository');
  private readonly close = viewChild<ElementRef<HTMLButtonElement>>('close');

  constructor() {
    afterNextRender(() => this.close()?.nativeElement.focus());
  }

  protected scrollTo(event: Event, section: ShortcutSection): void {
    this.section.set(section);
    const dialog = (event.currentTarget as HTMLElement).closest<HTMLElement>('.shortcuts-dialog');
    dialog?.querySelector<HTMLElement>(`#shortcut-section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget as HTMLElement;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')]
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
