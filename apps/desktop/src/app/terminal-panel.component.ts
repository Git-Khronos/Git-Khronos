import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type IDisposable } from '@xterm/xterm';
import type { AppTheme } from './app-theme';
import { IconComponent } from './icon.component';
import { terminalTheme } from './terminal-theme';
import {
  terminalShortcutForEvent,
  terminalTabNavigationIndex,
  terminalTabScrollPosition,
  terminalTabStateAfterClose,
  type TerminalTabNavigationKey,
} from './terminal-tab-navigation';

interface TerminalInfo {
  id: string;
  label: string;
  cwd: string;
}

interface TerminalOutput {
  sessionId: string;
  data: number[];
}

interface TerminalExit {
  sessionId: string;
}

type TerminalCursorStyle = 'block' | 'underline' | 'bar';

const TERMINAL_PANEL_MIN_HEIGHT = 150;
const TERMINAL_PANEL_DEFAULT_HEIGHT = 280;
const TERMINAL_PANEL_VIEWPORT_ALLOWANCE = 170;
const TERMINAL_PANEL_HEIGHT_STORAGE_KEY = 'git-chronos.terminal.panel-height';

interface TerminalTab extends TerminalInfo {
  title: string;
  terminal: Terminal;
  fit: FitAddon;
  input: IDisposable;
  ended: boolean;
}

@Component({
  selector: 'gc-terminal-panel',
  imports: [IconComponent],
  template: `
    <section [attr.id]="panelId()" class="terminal-panel" [class.inactive]="!visible()" [class.minimized]="minimized()" [style.height.px]="minimized() ? 32 : height()" aria-label="Repository terminals">
      @if (!minimized()) { <div class="terminal-resizer" role="separator" tabindex="0" aria-label="Resize terminal" [attr.aria-controls]="panelId()" aria-orientation="horizontal" [attr.aria-valuemin]="terminalMinimumHeight" [attr.aria-valuemax]="maximumHeight()" [attr.aria-valuenow]="height()" [attr.aria-valuetext]="height() + ' pixels'" title="Drag or use Up/Down to resize · Shift for larger steps · Double-click to reset" (pointerdown)="beginResize($event)" (keydown)="handleResizeKeydown($event)" (dblclick)="resetHeight($event)"></div> }
      <header>
        <div class="terminal-session-strip">
          <div #terminalTabs class="terminal-tabs" role="tablist" aria-label="Terminal tabs">
            @for (tab of tabs(); track tab.id) {
              <div class="terminal-tab" [class.active]="activeId() === tab.id" [class.ended]="tab.ended">
                <button class="terminal-tab-main" type="button" role="tab" [attr.id]="tabId(tab.id)" [attr.data-terminal-tab-id]="tab.id" [attr.tabindex]="activeId() === tab.id ? 0 : -1" [attr.aria-selected]="activeId() === tab.id" [attr.aria-controls]="tabPanelId(tab.id)" title="{{ tab.cwd }}" (click)="activate(tab.id)" (keydown)="handleTabKeydown($event, tab.id)">
                  <gc-icon name="terminal" [size]="12" /><span>{{ tab.title }}</span>@if (tab.ended) { <i>exited</i> }
                </button>
                <button class="terminal-tab-close" type="button" [attr.tabindex]="activeId() === tab.id ? 0 : -1" [attr.aria-keyshortcuts]="activeId() === tab.id ? 'Control+Shift+W' : null" aria-label="Close {{ tab.title }}" title="Close terminal tab" (click)="$event.stopPropagation(); closeTab(tab.id, true)"><gc-icon name="x" [size]="10" /></button>
              </div>
            }
          </div>
          <button class="new-terminal" type="button" title="New terminal tab (Ctrl+Shift+T)" aria-label="New terminal tab" aria-keyshortcuts="Control+Shift+T" [disabled]="opening() || !nativeAvailable()" (click)="openTab()"><gc-icon name="plus" [size]="12" /></button>
        </div>
        <span class="terminal-context"><gc-icon name="repo" [size]="11" />{{ repositoryLabel() }}</span>
        <button type="button" [attr.aria-label]="minimized() ? 'Restore terminal' : 'Minimize terminal'" [attr.aria-expanded]="!minimized()" [attr.aria-controls]="terminalBodyId()" title="{{ minimized() ? 'Restore terminal' : 'Minimize terminal' }}" (click)="toggleMinimized()"><gc-icon [name]="minimized() ? 'chevron-up' : 'chevron-down'" [size]="12" /></button>
        <button type="button" title="Hide terminal panel" aria-label="Hide terminal panel" (click)="dismissed.emit()"><gc-icon name="x" [size]="12" /></button>
      </header>
      @if (!minimized()) {
        <div #terminalBody [attr.id]="terminalBodyId()" class="terminal-body">
          @for (tab of tabs(); track tab.id) {
            <div class="terminal-host" role="tabpanel" [attr.id]="tabPanelId(tab.id)" [attr.aria-labelledby]="tabId(tab.id)" [attr.aria-hidden]="activeId() !== tab.id" [class.active]="activeId() === tab.id" [attr.data-terminal-id]="tab.id"></div>
          }
          @if (error(); as message) { <div class="terminal-error" role="status" aria-live="polite"><strong>Terminal unavailable</strong><span>{{ message }}</span>@if (nativeAvailable()) { <button type="button" (click)="openTab()">Try again</button> }</div> }
          @if (opening() && !tabs().length) { <div class="terminal-loading" role="status" aria-live="polite">Starting terminal…</div> }
        </div>
      }
    </section>
  `,
  styleUrl: './terminal-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalPanelComponent implements AfterViewInit, OnDestroy {
  @ViewChild('terminalBody') private terminalBody?: ElementRef<HTMLElement>;
  @ViewChild('terminalTabs') private terminalTabs?: ElementRef<HTMLElement>;

  readonly repositoryId = input.required<string>();
  readonly repositoryLabel = input.required<string>();
  readonly visible = input(true);
  readonly nativeAvailable = input(true);
  readonly fontFamily = input('"SFMono-Regular", Consolas, "Liberation Mono", monospace');
  readonly fontSize = input(12);
  readonly lineHeight = input(1.25);
  readonly cursorStyle = input<TerminalCursorStyle>('block');
  readonly theme = input<AppTheme>('chronos');
  readonly closed = output<void>();
  readonly dismissed = output<void>();

  protected readonly tabs = signal<TerminalTab[]>([]);
  protected readonly activeId = signal<string | null>(null);
  protected readonly minimized = signal(false);
  protected readonly opening = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly height = signal(this.readStoredHeight());
  protected readonly terminalMinimumHeight = TERMINAL_PANEL_MIN_HEIGHT;

  private unlistenOutput?: UnlistenFn;
  private unlistenExit?: UnlistenFn;
  private resizeObserver?: ResizeObserver;
  private readonly pendingOutput = new Map<string, Uint8Array[]>();
  private resizeStartY = 0;
  private resizeStartHeight = 0;
  private resizing = false;
  private nextTabNumber = 1;

  constructor() {
    effect(() => {
      if (this.visible()) setTimeout(() => {
        this.fitActive();
        this.focusActive();
      });
    });
    effect(() => {
      const palette = terminalTheme(this.theme());
      for (const tab of this.tabs()) tab.terminal.options.theme = palette;
    });
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.nativeAvailable()) {
      this.error.set('Terminal sessions are available in the desktop app.');
      return;
    }
    try {
      this.unlistenOutput = await listen<TerminalOutput>('terminal-output', ({ payload }) => {
        const bytes = new Uint8Array(payload.data);
        const tab = this.tabs().find((candidate) => candidate.id === payload.sessionId);
        if (tab) tab.terminal.write(bytes);
        else this.pendingOutput.set(payload.sessionId, [...(this.pendingOutput.get(payload.sessionId) ?? []), bytes]);
      });
      this.unlistenExit = await listen<TerminalExit>('terminal-exit', ({ payload }) => {
        this.tabs.update((tabs) => tabs.map((tab) => tab.id === payload.sessionId ? { ...tab, ended: true } : tab));
        this.tabs().find((tab) => tab.id === payload.sessionId)?.terminal.write('\r\n\x1b[38;5;245m[Process exited]\x1b[0m\r\n');
      });
    } catch (cause: unknown) {
      this.unlistenOutput?.();
      this.unlistenOutput = undefined;
      this.error.set(this.errorMessage(cause));
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.fitActive());
    if (this.terminalBody) this.resizeObserver.observe(this.terminalBody.nativeElement);
    await this.openTab();
  }

  ngOnDestroy(): void {
    this.unlistenOutput?.();
    this.unlistenExit?.();
    this.resizeObserver?.disconnect();
    for (const tab of this.tabs()) {
      tab.input.dispose();
      tab.terminal.dispose();
      void invoke('close_terminal', { sessionId: tab.id });
    }
  }

  protected async openTab(): Promise<void> {
    if (!this.nativeAvailable()) {
      this.error.set('Terminal sessions are available in the desktop app.');
      return;
    }
    if (this.opening()) return;
    this.opening.set(true);
    this.error.set(null);
    try {
      const info = await invoke<TerminalInfo>('open_terminal', {
        repoId: this.repositoryId(),
        rows: 24,
        cols: 80,
      });
      const terminal = new Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        cursorStyle: this.cursorStyle(),
        fontFamily: this.fontFamily(),
        fontSize: this.fontSize(),
        lineHeight: this.lineHeight(),
        scrollback: 5000,
        theme: terminalTheme(this.theme()),
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      const input = terminal.onData((data) => {
        void invoke('write_terminal', { sessionId: info.id, data: [...new TextEncoder().encode(data)] });
      });
      const tab: TerminalTab = { ...info, title: `${info.label} ${this.nextTabNumber++}`, terminal, fit, input, ended: false };
      this.tabs.update((tabs) => [...tabs, tab]);
      this.activeId.set(tab.id);
      setTimeout(() => this.mount(tab));
    } catch (cause: unknown) {
      this.error.set(this.errorMessage(cause));
    } finally {
      this.opening.set(false);
    }
  }

  protected activate(id: string): void {
    this.activateTab(id, true);
  }

  protected handleTabKeydown(event: KeyboardEvent, id: string): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = this.tabs();
    const index = terminalTabNavigationIndex(
      tabs.length,
      tabs.findIndex((tab) => tab.id === id),
      event.key as TerminalTabNavigationKey,
    );
    if (index === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.activateTab(tabs[index].id, false);
  }

  @HostListener('document:keydown', ['$event'])
  protected handleTerminalShortcut(event: KeyboardEvent): void {
    if (!this.visible()) return;
    const shortcut = terminalShortcutForEvent(event);
    if (!shortcut) return;
    if (shortcut === 'new') {
      if (!this.nativeAvailable()) return;
      event.preventDefault();
      event.stopPropagation();
      void this.openTab();
      return;
    }
    if (shortcut === 'close') {
      event.preventDefault();
      event.stopPropagation();
      this.closeActive();
      return;
    }
    const tabs = this.tabs();
    const index = terminalTabNavigationIndex(
      tabs.length,
      tabs.findIndex((tab) => tab.id === this.activeId()),
      shortcut === 'previous' ? 'ArrowLeft' : 'ArrowRight',
    );
    if (index === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.activateTab(tabs[index].id, true);
  }

  protected tabId(id: string): string {
    return `${this.panelId()}-tab-${this.domIdPart(id)}`;
  }

  protected tabPanelId(id: string): string {
    return `${this.panelId()}-content-${this.domIdPart(id)}`;
  }

  protected terminalBodyId(): string {
    return `${this.panelId()}-body`;
  }

  private activateTab(id: string, focusTerminal: boolean): void {
    this.activeId.set(id);
    this.minimized.set(false);
    setTimeout(() => {
      this.revealTab(id);
      this.fitActive();
      if (focusTerminal) this.focusActive();
      else this.focusTab(id);
    });
  }

  protected async closeTab(id: string, focusReplacementTab = false): Promise<void> {
    const tabs = this.tabs();
    const closingIndex = tabs.findIndex((candidate) => candidate.id === id);
    const tab = tabs[closingIndex];
    if (!tab) return;
    await invoke('close_terminal', { sessionId: id }).catch(() => undefined);
    tab.input.dispose();
    tab.terminal.dispose();
    const state = terminalTabStateAfterClose(tabs.map((candidate) => candidate.id), this.activeId(), id);
    const remaining = tabs.filter((candidate) => candidate.id !== id);
    this.tabs.set(remaining);
    this.pendingOutput.delete(id);
    this.activeId.set(state.activeId);
    const active = remaining.find((candidate) => candidate.id === state.activeId) ?? null;
    if (!remaining.length) this.closed.emit();
    else setTimeout(() => {
      if (active) this.revealTab(active.id);
      this.fitActive();
      if (focusReplacementTab && active) this.focusTab(active.id);
      else this.focusActive();
    });
  }

  protected closeActive(): void {
    const id = this.activeId();
    if (id) void this.closeTab(id);
    else this.closed.emit();
  }

  protected toggleMinimized(): void {
    this.minimized.update((minimized) => !minimized);
    if (!this.minimized()) setTimeout(() => {
      this.fitActive();
      this.focusActive();
    });
  }

  protected beginResize(event: PointerEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.resizeStartY = event.clientY;
    this.resizeStartHeight = this.height();
  }

  @HostListener('document:pointermove', ['$event'])
  protected resize(event: PointerEvent): void {
    if (!this.resizing) return;
    this.height.set(this.clampHeight(this.resizeStartHeight + this.resizeStartY - event.clientY));
  }

  @HostListener('document:pointerup')
  protected finishResize(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.storeHeight();
    this.fitActive();
  }

  @HostListener('window:resize')
  protected handleWindowResize(): void {
    const height = this.clampHeight(this.height());
    if (height !== this.height()) {
      this.height.set(height);
      this.storeHeight();
    }
    this.fitActive();
  }

  protected handleResizeKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 32 : 10;
    let height: number;
    switch (event.key) {
      case 'ArrowUp': height = this.height() + step; break;
      case 'ArrowDown': height = this.height() - step; break;
      case 'Home': height = TERMINAL_PANEL_MIN_HEIGHT; break;
      case 'End': height = this.maximumHeight(); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.height.set(this.clampHeight(height));
    this.storeHeight();
    setTimeout(() => this.fitActive());
  }

  protected resetHeight(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.height.set(this.clampHeight(TERMINAL_PANEL_DEFAULT_HEIGHT));
    try {
      localStorage.removeItem(TERMINAL_PANEL_HEIGHT_STORAGE_KEY);
    } catch {
      // The default remains restored for this session.
    }
    setTimeout(() => this.fitActive());
  }

  protected maximumHeight(): number {
    return Math.max(TERMINAL_PANEL_MIN_HEIGHT, window.innerHeight - TERMINAL_PANEL_VIEWPORT_ALLOWANCE);
  }

  protected panelId(): string {
    return `repository-terminal-panel-${this.domIdPart(this.repositoryId())}`;
  }

  private mount(tab: TerminalTab): void {
    const host = this.terminalBody?.nativeElement.querySelector<HTMLElement>(`[data-terminal-id="${tab.id}"]`);
    if (!host || host.childElementCount) return;
    tab.terminal.open(host);
    for (const bytes of this.pendingOutput.get(tab.id) ?? []) tab.terminal.write(bytes);
    this.pendingOutput.delete(tab.id);
    this.revealTab(tab.id);
    this.fitActive();
    tab.terminal.focus();
  }

  private fitActive(): void {
    const tab = this.tabs().find((candidate) => candidate.id === this.activeId());
    if (!tab || this.minimized()) return;
    try {
      tab.fit.fit();
      void invoke('resize_terminal', { sessionId: tab.id, rows: tab.terminal.rows, cols: tab.terminal.cols });
    } catch {
      // The terminal can be between Angular layout frames while switching tabs.
    }
  }

  private focusActive(): void {
    this.tabs().find((tab) => tab.id === this.activeId())?.terminal.focus();
  }

  private focusTab(id: string): void {
    const tab = Array.from(this.terminalTabs?.nativeElement
      .querySelectorAll<HTMLElement>('[data-terminal-tab-id]') ?? [])
      .find((candidate) => candidate.dataset['terminalTabId'] === id);
    tab?.focus({ preventScroll: true });
  }

  private revealTab(id: string): void {
    const container = this.terminalTabs?.nativeElement;
    const tab = Array.from(container?.querySelectorAll<HTMLElement>('[data-terminal-tab-id]') ?? [])
      .find((candidate) => candidate.dataset['terminalTabId'] === id);
    if (!container || !tab) return;
    const containerBounds = container.getBoundingClientRect();
    const tabBounds = tab.closest<HTMLElement>('.terminal-tab')?.getBoundingClientRect()
      ?? tab.getBoundingClientRect();
    const target = terminalTabScrollPosition({
      containerStart: containerBounds.left,
      containerEnd: containerBounds.right,
      tabStart: tabBounds.left,
      tabEnd: tabBounds.right,
      scrollPosition: container.scrollLeft,
      maximumScrollPosition: Math.max(0, container.scrollWidth - container.clientWidth),
    });
    if (target !== null) container.scrollTo({ left: target });
  }

  private domIdPart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  private clampHeight(height: number): number {
    return Math.round(Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.min(this.maximumHeight(), height)));
  }

  private readStoredHeight(): number {
    try {
      const value = Number(localStorage.getItem(TERMINAL_PANEL_HEIGHT_STORAGE_KEY));
      return Number.isFinite(value) && value >= TERMINAL_PANEL_MIN_HEIGHT
        ? this.clampHeight(value)
        : this.clampHeight(TERMINAL_PANEL_DEFAULT_HEIGHT);
    } catch {
      return this.clampHeight(TERMINAL_PANEL_DEFAULT_HEIGHT);
    }
  }

  private storeHeight(): void {
    try {
      localStorage.setItem(TERMINAL_PANEL_HEIGHT_STORAGE_KEY, String(this.height()));
    } catch {
      // The resized height still applies for this session.
    }
  }

  private errorMessage(cause: unknown): string {
    if (typeof cause === 'string') return cause;
    if (cause && typeof cause === 'object' && 'message' in cause) return String(cause.message);
    return 'The native terminal backend could not be started.';
  }
}
