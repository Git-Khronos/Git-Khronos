import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  CSP_NONCE,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  ViewChild,
  afterNextRender,
  effect,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ipc, events, type TerminalInfo, type ToolProfile } from '@git-khronos/contracts';
import { type UnlistenFn } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type IDisposable } from '@xterm/xterm';
import type { AppTheme } from './app-theme';
import { CONFIGURED_TOOLS } from './configured-tools.service';
import { IconComponent } from './icon.component';
import { ResizePointer } from './resize-pointer';
import {
  applyTerminalAppearance,
  terminalAppearance,
  type TerminalCursorStyle,
} from './terminal-appearance';
import {
  normalizeTerminalTabTitle,
  terminalShortcutForEvent,
  terminalTabNavigationIndex,
  terminalTabOverflowState,
  terminalTabScrollPosition,
  terminalTabStateAfterClose,
  type TerminalTabNavigationKey,
} from './terminal-tab-navigation';

const TERMINAL_PANEL_MIN_HEIGHT = 150;
const TERMINAL_PANEL_DEFAULT_HEIGHT = 280;
const TERMINAL_PANEL_VIEWPORT_ALLOWANCE = 170;
const TERMINAL_PANEL_HEIGHT_STORAGE_KEY = 'git-khronos.terminal.panel-height';
const TERMINAL_EXIT_MESSAGE = '\r\n\x1b[38;5;245m[Process exited]\x1b[0m\r\n';

interface TerminalTab extends TerminalInfo {
  title: string;
  fallbackTitle: string;
  terminal: Terminal;
  fit: FitAddon;
  input: IDisposable;
  cancelQueuedInput: () => void;
  titleChange: IDisposable;
  ended: boolean;
}

@Component({
  selector: 'gc-terminal-panel',
  imports: [IconComponent],
  template: `
    <section [attr.id]="panelId()" class="terminal-panel" [class.inactive]="!visible()" [class.minimized]="minimized()" [class.profiles-open]="profileLauncherOpen() && terminalProfiles().length > 0 && !minimized()" [style.height.px]="minimized() ? 32 : height()" tabindex="-1" [attr.aria-label]="'Repository terminals for ' + repositoryLabel()">
      @if (!minimized()) { <div class="terminal-resizer" role="separator" tabindex="0" aria-label="Resize terminal" [attr.aria-controls]="panelId()" aria-orientation="horizontal" [attr.aria-valuemin]="terminalMinimumHeight" [attr.aria-valuemax]="maximumHeight()" [attr.aria-valuenow]="height()" [attr.aria-valuetext]="height() + ' pixels'" title="Drag or use Up/Down to resize · Shift for larger steps · Double-click to reset" (pointerdown)="beginResize($event)" (keydown)="handleResizeKeydown($event)" (dblclick)="resetHeight($event)"></div> }
      <header>
        <div class="terminal-session-strip">
          <div class="terminal-tabs-shell">
            @if (tabStripOverflow()) {
              <button class="terminal-tab-scroll" type="button" aria-label="Show previous terminal tabs" title="Show previous terminal tabs" [disabled]="!canScrollTabsBack()" (click)="scrollTabs(-1)"><gc-icon name="chevron-left" [size]="11" /></button>
            }
            <div #terminalTabs class="terminal-tabs" role="tablist" aria-label="Terminal tabs" (scroll)="updateTabOverflow()">
              @if (!tabs().length) {
                <span class="terminal-empty-tab" aria-hidden="true"><gc-icon name="terminal" [size]="12" /><span>{{ opening() ? 'Starting…' : 'Terminal' }}</span></span>
              }
              @for (tab of tabs(); track tab.id) {
                <div class="terminal-tab" [class.active]="activeId() === tab.id" [class.ended]="tab.ended">
                  <button class="terminal-tab-main" type="button" role="tab" [attr.id]="tabId(tab.id)" [attr.data-terminal-tab-id]="tab.id" [attr.tabindex]="activeId() === tab.id ? 0 : -1" [attr.aria-selected]="activeId() === tab.id" [attr.aria-controls]="tabPanelId(tab.id)" title="{{ tab.title }} · {{ tab.cwd }}" (click)="activate(tab.id)" (keydown)="handleTabKeydown($event, tab.id)">
                    <gc-icon name="terminal" [size]="12" /><span>{{ tab.title }}</span>@if (tab.ended) { <i>exited</i> }
                  </button>
                  <button class="terminal-tab-close" type="button" [attr.tabindex]="activeId() === tab.id ? 0 : -1" [attr.aria-keyshortcuts]="activeId() === tab.id ? 'Control+Shift+W' : null" aria-label="Close {{ tab.title }}" title="Close terminal tab" (click)="$event.stopPropagation(); closeTab(tab.id, true)"><gc-icon name="x" [size]="10" /></button>
                </div>
              }
            </div>
            @if (tabStripOverflow()) {
              <button class="terminal-tab-scroll" type="button" aria-label="Show next terminal tabs" title="Show next terminal tabs" [disabled]="!canScrollTabsForward()" (click)="scrollTabs(1)"><gc-icon name="chevron-right" [size]="11" /></button>
            }
          </div>
          <button class="new-terminal" type="button" title="New terminal tab (Ctrl+Shift+T)" aria-label="New terminal tab" aria-keyshortcuts="Control+Shift+T" [disabled]="opening() || !!failedStartup() || !nativeAvailable()" (click)="openTab()"><gc-icon name="plus" [size]="12" /></button>
        </div>
        @if (terminalProfiles().length) {
          <button #profileLauncherButton class="terminal-profiles-button" type="button" aria-label="Choose terminal profile" title="Open a configured terminal profile" [attr.aria-expanded]="profileLauncherOpen() && !minimized()" [attr.aria-controls]="profileLauncherOpen() && !minimized() ? panelId() + '-profiles' : null" [disabled]="!nativeAvailable()" (click)="toggleProfileLauncher()">Profiles</button>
        }
        <span class="terminal-context"><gc-icon name="repo" [size]="11" />{{ repositoryLabel() }}</span>
        <button type="button" [attr.aria-label]="minimized() ? 'Restore terminal' : 'Minimize terminal'" [attr.aria-expanded]="!minimized()" [attr.aria-controls]="terminalBodyId()" title="{{ minimized() ? 'Restore terminal' : 'Minimize terminal' }}" (click)="toggleMinimized()"><gc-icon [name]="minimized() ? 'chevron-up' : 'chevron-down'" [size]="12" /></button>
        <button type="button" title="Hide terminal panel" aria-label="Hide terminal panel" (click)="dismissed.emit()"><gc-icon name="x" [size]="12" /></button>
      </header>
      @if (profileLauncherOpen() && terminalProfiles().length && !minimized()) {
        <div [id]="panelId() + '-profiles'" class="terminal-profile-launcher" aria-label="Open terminal profile" (keydown.escape)="$event.preventDefault(); $event.stopPropagation(); closeProfileLauncher()">
          <label [attr.for]="panelId() + '-profile'">Terminal profile</label><select #terminalProfileSelect [id]="panelId() + '-profile'" [value]="selectedProfileId()" (change)="selectedProfileId.set($any($event.target).value); profileSelectionError.set(null)"><option value="" disabled>Choose a profile</option>@for (profile of terminalProfiles(); track profile.id) { <option [value]="profile.id">{{ profile.name }}</option> }</select>
          <span>Starts in {{ repositoryLabel() }} with the selected program and arguments.</span>
          @if (profileSelectionError(); as message) { <span role="alert">{{ message }}</span> }
          <button type="button" [disabled]="opening() || !!failedStartup() || !nativeAvailable()" (click)="openSelectedProfile()">Open terminal</button>
          <button type="button" (click)="closeProfileLauncher()">Cancel</button>
        </div>
      }
      <div #terminalBody [attr.id]="terminalBodyId()" class="terminal-body" [hidden]="minimized()">
        @for (tab of tabs(); track tab.id) {
          <div class="terminal-host" role="tabpanel" [attr.id]="tabPanelId(tab.id)" [attr.aria-labelledby]="tabId(tab.id)" [attr.aria-hidden]="activeId() !== tab.id" [class.active]="activeId() === tab.id" [attr.data-terminal-id]="tab.id"></div>
        }
        @if (error(); as message) { <div class="terminal-error" role="status" aria-live="polite"><strong>{{ failedCloseId() ? 'Terminal could not close' : 'Terminal unavailable' }}</strong><span>{{ message }}</span>@if (nativeAvailable()) { @if (failedCloseId(); as id) { <button type="button" (click)="closeTab(id)">Retry closing terminal</button> } @else { <button type="button" (click)="openTab(retryProfile())">Try again</button> } }</div> }
        @if (opening() && !tabs().length) { <div class="terminal-loading" role="status" aria-live="polite">Starting terminal…</div> }
      </div>
    </section>
  `,
  styleUrl: './terminal-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalPanelComponent implements AfterViewInit, OnDestroy {
  @ViewChild('profileLauncherButton') private profileLauncherButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('terminalProfileSelect') private terminalProfileSelect?: ElementRef<HTMLSelectElement>;
  @ViewChild('terminalBody') private terminalBody?: ElementRef<HTMLElement>;
  @ViewChild('terminalTabs') private terminalTabs?: ElementRef<HTMLElement>;

  readonly repositoryId = input.required<string>();
  readonly repositoryLabel = input.required<string>();
  readonly visible = input(true);
  readonly nativeAvailable = input(true);
  readonly fontFamily = input('"SFMono-Regular", Consolas, "Liberation Mono", monospace');
  readonly fontSize = input(13);
  readonly lineHeight = input(1.25);
  readonly cursorStyle = input<TerminalCursorStyle>('block');
  readonly theme = input<AppTheme>('chronos');
  readonly closed = output<void>();
  readonly dismissed = output<void>();

  protected readonly profileLauncherOpen = signal(false);
  protected readonly retryProfile = signal<ToolProfile | null>(null);
  protected readonly tools = inject(CONFIGURED_TOOLS);
  protected readonly terminalProfiles = computed(() => this.tools.profiles().filter(p => p.role === 'terminal'));
  protected readonly selectedProfileId = signal('');
  protected readonly profileSelectionError = signal<string | null>(null);
  protected readonly tabs = signal<TerminalTab[]>([]);
  protected readonly activeId = signal<string | null>(null);
  protected readonly minimized = signal(false);
  protected readonly opening = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly failedCloseId = signal<string | null>(null);
  protected readonly failedStartup = signal<{ id: string; message: string } | null>(null);
  protected readonly tabStripOverflow = signal(false);
  protected readonly canScrollTabsBack = signal(false);
  protected readonly canScrollTabsForward = signal(false);
  protected readonly height = signal(this.readStoredHeight());
  protected readonly terminalMinimumHeight = TERMINAL_PANEL_MIN_HEIGHT;

  private unlistenOutput?: UnlistenFn;
  private unlistenExit?: UnlistenFn;
  private resizeObserver?: ResizeObserver;
  private readonly pendingOutput = new Map<string, Uint8Array[]>();
  private readonly pendingExits = new Set<string>();
  private resizeStartY = 0;
  private readonly resizePointer = new ResizePointer();
  private resizeStartHeight = 0;
  private resizing = false;
  private nextTabNumber = 1;
  private destroyed = false;
  private readonly closingTabs = new Set<string>();
  private readonly injector = inject(Injector);
  private readonly styleNonce = inject(CSP_NONCE, { optional: true });
  private finishPendingRender?: () => void;

  constructor() {
    effect(() => {
      if (this.profileLauncherOpen() && !this.terminalProfiles().length) this.profileLauncherOpen.set(false);
    });
    effect(() => {
      if (this.visible()) setTimeout(() => {
        this.fitActive();
        this.focusActive();
      });
    });
    effect(() => {
      const tabs = this.tabs();
      applyTerminalAppearance(tabs.map((tab) => tab.terminal), terminalAppearance({
        theme: this.theme(),
        cursorStyle: this.cursorStyle(),
        fontFamily: this.fontFamily(),
        fontSize: this.fontSize(),
        lineHeight: this.lineHeight(),
      }));
      if (tabs.length) setTimeout(() => this.fitActive());
    });
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.nativeAvailable()) {
      this.error.set('Terminal sessions are available in the desktop app.');
      return;
    }
    try {
      this.unlistenOutput = await events.terminalOutput.listen(({ payload }) => {
        if (this.destroyed) return;
        const bytes = new Uint8Array(payload.data);
        const tab = this.tabs().find((candidate) => candidate.id === payload.sessionId);
        if (tab) tab.terminal.write(bytes);
        else if (this.opening()) {
          // Output can precede open_terminal's reply. Ignore sessions belonging
          // to other repository panels once our own startup has completed.
          const pending = this.pendingOutput.get(payload.sessionId);
          if (pending) pending.push(bytes);
          else this.pendingOutput.set(payload.sessionId, [bytes]);
        }
      });
      if (this.destroyed) {
        this.unlistenOutput();
        return;
      }
      this.unlistenExit = await events.terminalExit.listen(({ payload }) => {
        if (this.destroyed) return;
        const tab = this.tabs().find((tab) => tab.id === payload.sessionId);
        if (!tab) {
          if (this.opening()) this.pendingExits.add(payload.sessionId);
          return;
        }
        if (tab.ended) return;
        this.tabs.update((tabs) => tabs.map((tab) => tab.id === payload.sessionId ? { ...tab, ended: true } : tab));
        if (tab.terminal.element) tab.terminal.write(TERMINAL_EXIT_MESSAGE);
      });
      if (this.destroyed) {
        this.unlistenExit();
        return;
      }
    } catch (cause: unknown) {
      this.unlistenOutput?.();
      this.unlistenOutput = undefined;
      this.error.set(this.errorMessage(cause));
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.fitActive();
      const activeId = this.activeId();
      if (activeId) this.revealTab(activeId);
      else this.updateTabOverflow();
    });
    if (this.terminalBody) this.resizeObserver.observe(this.terminalBody.nativeElement);
    if (this.terminalTabs) this.resizeObserver.observe(this.terminalTabs.nativeElement);
    await this.openTab();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.finishPendingRender?.();
    this.finishPendingRender = undefined;
    this.finishResize();
    this.unlistenOutput?.();
    this.unlistenExit?.();
    this.resizeObserver?.disconnect();
    for (const tab of this.tabs()) {
      this.disposeResources([tab.input, tab.titleChange, tab.terminal]);
      void ipc.close_terminal({ sessionId: tab.id }).catch(() => undefined);
    }
    const failedStartup = this.failedStartup();
    if (failedStartup) void ipc.close_terminal({ sessionId: failedStartup.id }).catch(() => undefined);
    this.failedStartup.set(null);
    this.tabs.set([]);
    this.pendingOutput.clear();
    this.pendingExits.clear();
  }

  protected toggleProfileLauncher(): void {
    if (this.profileLauncherOpen()) { this.closeProfileLauncher(); return; }
    this.selectedProfileId.set(this.terminalProfiles()[0]?.id ?? '');
    this.profileSelectionError.set(null);
    this.profileLauncherOpen.set(true);
    this.minimized.set(false);
    afterNextRender(() => { if (!this.destroyed) this.terminalProfileSelect?.nativeElement.focus(); }, { injector: this.injector });
  }

  protected closeProfileLauncher(): void {
    this.profileLauncherOpen.set(false);
    this.profileLauncherButton?.nativeElement.focus();
  }

  protected openSelectedProfile(): void {
    const profile = this.terminalProfiles().find((p) => p.id === this.selectedProfileId());
    if (!profile) {
      this.selectedProfileId.set('');
      this.profileSelectionError.set('The selected profile is no longer available. Choose another profile.');
      return;
    }
    void this.openTab(profile);
  }

  protected async openTab(profile: ToolProfile | null = this.tools.defaultTerminal()): Promise<void> {
    if (this.destroyed) return;
    if (!this.nativeAvailable()) {
      this.error.set('Terminal sessions are available in the desktop app.');
      return;
    }
    if (this.opening() || this.failedStartup()) return;
    this.opening.set(true);
    const selectedProfile = profile ? structuredClone(profile) : null;
    this.retryProfile.set(selectedProfile);
    this.error.set(null);
    this.failedCloseId.set(null);
    let nativeSession: TerminalInfo | null = null;
    let createdTerminal: Terminal | undefined;
    let createdInput: IDisposable | undefined;
    let createdTitleChange: IDisposable | undefined;
    try {
      const args = { repoId: this.repositoryId(), rows: 24, cols: 80 };
      const info = selectedProfile ? await ipc.open_configured_terminal({ ...args, profile: selectedProfile })
        : await ipc.open_terminal(args);
      if (selectedProfile) this.profileLauncherOpen.set(false);
      nativeSession = info;
      if (this.destroyed) {
        await ipc.close_terminal({ sessionId: info.id }).catch(() => undefined);
        return;
      }
      for (const id of this.pendingOutput.keys()) {
        if (id !== info.id) this.pendingOutput.delete(id);
      }
      const terminal = new Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        scrollback: 5000,
        ...terminalAppearance({
          theme: this.theme(),
          cursorStyle: this.cursorStyle(),
          fontFamily: this.fontFamily(),
          fontSize: this.fontSize(),
          lineHeight: this.lineHeight(),
        }),
      });
      createdTerminal = terminal;
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      let inputTail = Promise.resolve();
      let inputEpoch = 0;
      const input = terminal.onData((data) => {
        const current = this.tabs().find((tab) => tab.id === info.id);
        if (this.destroyed || !current || current.ended || this.closingTabs.has(info.id)) return;
        const epoch = inputEpoch;
        inputTail = inputTail.then(async () => {
          const tab = this.tabs().find((candidate) => candidate.id === info.id);
          if (epoch !== inputEpoch || this.destroyed || !tab || tab.ended || this.closingTabs.has(info.id)) return;
          await ipc.write_terminal({ sessionId: info.id, data: [...new TextEncoder().encode(data)] });
        }).catch((cause: unknown) => {
          // A failed write may have sent a prefix. Never replay it or dispatch
          // its queued suffix as a new command after an uncertain failure.
          inputEpoch += 1;
          const tab = this.tabs().find((candidate) => candidate.id === info.id);
          if (!this.destroyed && tab && !tab.ended && !this.closingTabs.has(info.id)) {
            this.failedCloseId.set(null);
            this.error.set(this.errorMessage(cause));
          }
        });
      });
      createdInput = input;
      const fallbackTitle = `${info.label} ${this.nextTabNumber++}`;
      const titleChange = terminal.onTitleChange((title) => this.updateTabTitle(info.id, title));
      createdTitleChange = titleChange;
      const tab: TerminalTab = { ...info, title: fallbackTitle, fallbackTitle, terminal, fit, input, cancelQueuedInput: () => { inputEpoch += 1; }, titleChange, ended: this.pendingExits.has(info.id) };
      this.pendingExits.clear();
      this.tabs.update((tabs) => [...tabs, tab]);
      this.activeId.set(tab.id);
      // Mount within this transaction, after Angular has created the host.
      // Destruction resolves the wait too; ngOnDestroy already owns cleanup.
      await new Promise<void>((resolve) => {
        this.finishPendingRender = resolve;
        afterNextRender(() => {
          this.finishPendingRender = undefined;
          resolve();
        }, { injector: this.injector });
      });
      if (!this.destroyed) this.mount(tab);
    } catch (cause: unknown) {
      const message = this.errorMessage(cause);
      if (nativeSession) {
        const id = nativeSession.id;
        const tabs = this.tabs();
        const state = terminalTabStateAfterClose(tabs.map((tab) => tab.id), this.activeId(), id);
        this.tabs.set(tabs.filter((tab) => tab.id !== id));
        this.activeId.set(state.activeId);
        this.disposeResources([createdInput, createdTitleChange, createdTerminal]);
        this.failedStartup.set({ id, message });
        await this.closeFailedStartup();
      } else if (!this.destroyed) {
        this.failedCloseId.set(null);
        this.error.set(message);
      }
    } finally {
      this.finishPendingRender = undefined;
      this.pendingOutput.clear();
      this.pendingExits.clear();
      this.opening.set(false);
    }
  }

  protected activate(id: string): void {
    this.activateTab(id, true);
  }

  protected updateTabOverflow(): void {
    const container = this.terminalTabs?.nativeElement;
    if (!container) return;
    const state = terminalTabOverflowState({
      scrollPosition: container.scrollLeft,
      viewportWidth: container.clientWidth,
      contentWidth: container.scrollWidth,
    });
    this.tabStripOverflow.set(state.overflowing);
    this.canScrollTabsBack.set(state.canScrollBack);
    this.canScrollTabsForward.set(state.canScrollForward);
  }

  protected scrollTabs(direction: -1 | 1): void {
    const container = this.terminalTabs?.nativeElement;
    if (!container) return;
    container.scrollBy({ left: direction * Math.max(118, Math.round(container.clientWidth * 0.72)) });
    this.updateTabOverflow();
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

  private updateTabTitle(id: string, title: string): void {
    let changed = false;
    this.tabs.update((tabs) => tabs.map((tab) => {
      if (tab.id !== id) return tab;
      const nextTitle = normalizeTerminalTabTitle(title, tab.fallbackTitle);
      if (nextTitle === tab.title) return tab;
      changed = true;
      return { ...tab, title: nextTitle };
    }));
    if (changed) setTimeout(() => {
      if (this.activeId() === id) this.revealTab(id);
      else this.updateTabOverflow();
    });
  }

  protected async closeTab(id: string, focusReplacementTab = false): Promise<void> {
    const requested = this.tabs().find((tab) => tab.id === id);
    if (this.closingTabs.has(id)) return;
    if (!requested) {
      if (this.failedStartup()?.id === id) await this.closeFailedStartup();
      return;
    }
    // A refused close must not allow old queued keystrokes to become commands
    // once the closing flag is cleared. Only explicit new input may resume.
    requested.cancelQueuedInput();
    this.closingTabs.add(id);
    if (this.failedCloseId() === id) {
      this.failedCloseId.set(null);
      this.error.set(null);
    }
    try {
      await ipc.close_terminal({ sessionId: id });
    } catch (cause: unknown) {
      this.closingTabs.delete(id);
      if (!this.destroyed && this.tabs().some((tab) => tab.id === id)) {
        this.failedCloseId.set(id);
        this.error.set(this.errorMessage(cause));
      }
      return;
    }
    if (this.destroyed) { this.closingTabs.delete(id); return; }
    // Other tabs may have opened or closed while the native request was in flight.
    // Never restore a snapshot captured before that request.
    const tabs = this.tabs();
    const closingIndex = tabs.findIndex((candidate) => candidate.id === id);
    const tab = tabs[closingIndex];
    if (!tab) { this.closingTabs.delete(id); return; }
    this.disposeResources([tab.input, tab.titleChange, tab.terminal]);
    const state = terminalTabStateAfterClose(tabs.map((candidate) => candidate.id), this.activeId(), id);
    const remaining = tabs.filter((candidate) => candidate.id !== id);
    this.tabs.set(remaining);
    this.closingTabs.delete(id);
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

  private async closeFailedStartup(): Promise<void> {
    const failed = this.failedStartup();
    if (!failed || this.closingTabs.has(failed.id)) return;
    this.closingTabs.add(failed.id);
    this.failedCloseId.set(null);
    this.error.set(null);
    try {
      await ipc.close_terminal({ sessionId: failed.id });
      if (this.destroyed) return;
      this.failedStartup.set(null);
      // Cleanup succeeded, but creating the screen did not. Keep the original
      // failure visible and let the user explicitly try a fresh session.
      this.error.set(failed.message);
    } catch (cause: unknown) {
      if (!this.destroyed) {
        this.failedCloseId.set(failed.id);
        this.error.set(`${failed.message} Cleanup also failed: ${this.errorMessage(cause)}`);
      }
    } finally {
      this.closingTabs.delete(failed.id);
    }
  }

  private disposeResources(resources: readonly (IDisposable | undefined)[]): void {
    for (const resource of resources) {
      try { resource?.dispose(); } catch {
        // One renderer teardown failure must not skip the remaining resources
        // or prevent the native process from being closed.
      }
    }
  }

  protected toggleMinimized(): void {
    this.minimized.update((minimized) => !minimized);
    if (!this.minimized()) setTimeout(() => {
      this.fitActive();
      this.focusActive();
    });
  }

  protected beginResize(event: PointerEvent): void {
    if (!this.resizePointer.begin(event, 'row-resize')) return;
    this.resizing = true;
    this.resizeStartY = event.clientY;
    this.resizeStartHeight = this.height();
  }

  @HostListener('document:pointermove', ['$event'])
  protected resize(event: PointerEvent): void {
    if (!this.resizing || !this.resizePointer.matches(event)) return;
    this.height.set(this.clampHeight(this.resizeStartHeight + this.resizeStartY - event.clientY));
  }

  @HostListener('document:pointerup', ['$event'])
  @HostListener('document:pointercancel', ['$event'])
  @HostListener('document:lostpointercapture', ['$event'])
  @HostListener('window:blur')
  protected finishResize(event?: PointerEvent): void {
    if (!this.resizePointer.finish(event)) return;
    this.resizing = false;
    this.storeHeight();
    this.fitActive();
    this.updateTabOverflow();
  }

  @HostListener('window:resize')
  protected handleWindowResize(): void {
    this.finishResize();
    const height = this.clampHeight(this.height());
    if (height !== this.height()) {
      this.height.set(height);
      this.storeHeight();
    }
    setTimeout(() => {
      this.fitActive();
      const activeId = this.activeId();
      if (activeId) this.revealTab(activeId);
      else this.updateTabOverflow();
    });
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
    const current = this.tabs().find((candidate) => candidate.id === tab.id);
    if (this.destroyed || !current) return;
    const host = this.terminalBody?.nativeElement.querySelector<HTMLElement>(`[data-terminal-id="${tab.id}"]`);
    if (!host) throw new Error('The terminal screen could not be created.');
    if (host.childElementCount) return;
    if (this.styleNonce) {
      // xterm creates its theme and sizing styles without a CSP nonce. Attach
      // them only after assigning Angular's nonce, then remeasure in the live DOM.
      const stagingHost = host.ownerDocument.createElement('div');
      tab.terminal.open(stagingHost);
      const terminalElement = tab.terminal.element;
      if (!terminalElement) throw new Error('The terminal screen could not be created.');
      for (const style of terminalElement.querySelectorAll('style')) style.nonce = this.styleNonce;
      host.appendChild(terminalElement);
      tab.terminal.resize(tab.terminal.cols, tab.terminal.rows);
    } else {
      tab.terminal.open(host);
    }
    for (const bytes of this.pendingOutput.get(tab.id) ?? []) tab.terminal.write(bytes);
    this.pendingOutput.delete(tab.id);
    if (current.ended) tab.terminal.write(TERMINAL_EXIT_MESSAGE);
    this.revealTab(tab.id);
    this.fitActive();
    if (this.visible() && !this.minimized() && this.activeId() === tab.id) tab.terminal.focus();
  }

  private fitActive(): void {
    const tab = this.tabs().find((candidate) => candidate.id === this.activeId());
    if (!tab || this.minimized()) return;
    try {
      tab.fit.fit();
      if (!tab.ended) void ipc.resize_terminal({ sessionId: tab.id, rows: tab.terminal.rows, cols: tab.terminal.cols })
        .catch(() => undefined);
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
    this.updateTabOverflow();
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
