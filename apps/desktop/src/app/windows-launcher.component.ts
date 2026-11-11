import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, output, signal, viewChild, type OnDestroy } from '@angular/core';
import { ipc, type AppError, type WindowsLauncherInspection, type WindowsShortcut, type WindowsShortcutIdentity, type WindowsShortcutLaunch, type WindowsShortcutLocation, type WindowsShortcutRepair } from '@git-khronos/contracts';

const LOCATIONS: Record<WindowsShortcutLocation, string> = {
  startMenu: 'Start Menu shortcut',
  taskbarPin: 'Taskbar pins folder',
  implicit: 'Window record (ImplicitAppShortcuts)',
};

const LAUNCH: Record<WindowsShortcutLaunch, string> = {
  works: 'Launcher found',
  splitPath: 'Launcher path split at a space',
  launcherMissing: 'Launcher not found',
  unreadable: 'Could not be read',
};

const IDENTITY: Record<WindowsShortcutIdentity, string> = {
  matching: 'Same identity as the window record',
  missing: 'No application identity',
  different: 'Different application identity',
  unverified: 'Identity cannot be compared',
  unknown: 'Identity unknown',
};

@Component({
  selector: 'gc-windows-launcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="requestClose()">
      <section role="dialog" aria-modal="true" aria-labelledby="windows-launcher-title" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
        <header><div><h2 id="windows-launcher-title">Windows taskbar shortcut</h2>
          <p>Looks for Git Khronos shortcuts that start the wrong path or lack the identity Windows uses to group taskbar buttons. Checking changes nothing.</p></div>
          <button #closeButton type="button" [disabled]="busy() === 'repairing'" (click)="requestClose()">Close</button></header>
        <div class="toolbar"><button type="button" [disabled]="!!busy()" (click)="refresh()">Check again</button>
          @if (busy()) { <span role="status">{{ busy() === 'repairing' ? 'Updating the shortcut…' : 'Reading Windows shortcuts…' }}</span> }
        </div>
        @if (error()) { <div class="feedback" role="alert"><p>{{ error() }}</p>@if (errorHint()) { <p>{{ errorHint() }}</p> }</div> }
        @if (repaired(); as result) {
          <div class="feedback" role="status">
            <p>{{ repairSummary(result) }}</p>
            <p>Windows decides whether the taskbar button joins the running window; that could not be confirmed here and may only change after you sign out and back in. Git Khronos does not restart Windows Explorer.</p>
            <p>The original shortcut was saved to <code>{{ result.backupPath }}</code>.</p>
          </div>
        }
        @if (inspection(); as data) {
          <div class="body">
            @if (!data.supported) {
              <p>{{ data.message }}</p>
            } @else {
              <dl>
                <dt>WSL distribution</dt><dd>{{ data.distribution }}</dd>
                <dt>Recorded identity</dt><dd>{{ data.appIdentity ?? 'Not found' }}</dd>
                @if (data.identitySource) { <dt>Recorded in</dt><dd>{{ data.identitySource }}</dd> }
                @if (data.launcher) { <dt>Working launcher</dt><dd>{{ data.launcher }}</dd> }
              </dl>
              <p class="limit">This check reads shortcut files only. Windows does not report which file backs a visible pin or how buttons are grouped, so results describe files, not the taskbar itself.</p>
              @if (data.incomplete.length) {
                <div class="feedback" role="alert">
                  <p>Some shortcut files or folders could not be read, so this list may be incomplete.</p>
                  <ul aria-label="Read problems">@for (problem of data.incomplete; track $index) { <li>{{ problem }}</li> }</ul>
                </div>
              }
              @if (data.conflictingIdentities.length > 1) {
                <p role="alert">Windows recorded more than one identity for Git Khronos, so no identity is applied. Split launcher paths can still be repaired.</p>
              } @else if (!data.appIdentity) {
                <p>No window record with an application identity was found. Windows writes these records itself, and when it does so is not documented; Git Khronos cannot create one. Until a record exists, only a split launcher path can be repaired.</p>
                <p>Optional: on one tested machine, such a record was present after Git Khronos was pinned from its running taskbar button (right-click the button, then Pin to taskbar). This is an observation, not documented Windows behavior. A pin made that way may start a split C:\\Program path, which this check can then repair. A pin made from the Start Menu starts correctly but cannot receive an identity until a record exists.</p>
              }
              <ul aria-label="Windows shortcuts">
                @for (shortcut of data.shortcuts; track shortcut.path) {
                  <li>
                    <strong>{{ locationLabel(shortcut.location) }}</strong>
                    <span class="state" [attr.data-launch]="shortcut.launch">{{ launchLabel(shortcut.launch) }}</span>
                    @if (shortcut.launch !== 'unreadable') { <span class="state" [attr.data-identity]="shortcut.identity">{{ identityLabel(shortcut.identity) }}</span> }
                    <small>{{ shortcut.path }}</small>
                    @if (shortcut.note) { <p>{{ shortcut.note }}</p> }
                    @if (shortcut.repair; as plan) {
                      <p class="limit" data-working-pin-advice>A difference in this file does not prove a pin is broken. If your Git Khronos pin already opens the app and groups with its window, leave it unchanged.</p>
                      @if (pending()?.path === shortcut.path) {
                        <div class="confirm" role="group" aria-label="Confirm shortcut repair">
                          <p>Apply these changes to this shortcut file? Skip this if the pin already works as expected.</p>
                          <dl><dt>Shortcut</dt><dd>{{ shortcut.path }}</dd>
                            @if (plan.target !== null) {
                              <dt>Target</dt><dd>{{ shortcut.target }} → {{ plan.target }}</dd>
                              <dt>Arguments</dt><dd>{{ shortcut.arguments }} → {{ plan.arguments }}</dd>
                            }
                            @if (plan.appIdentity !== null) {
                              <dt>Identity</dt><dd>{{ shortcut.appIdentity ?? 'None' }} → {{ plan.appIdentity }}</dd>
                            }</dl>
                          <p>Only the values above are changed. The working directory, icon, description, window style and hotkey are checked to be unchanged in a staged copy before the shortcut is rewritten; other shortcut data is not compared. A backup copy is saved in a new folder under %LOCALAPPDATA%\\Git Khronos\\Windows shortcut backups first. No pin is added, moved, or removed.</p>
                          <button type="button" [disabled]="!!busy()" (click)="repair(shortcut)">Apply changes</button>
                          <button type="button" [disabled]="!!busy()" (click)="pending.set(null)">Cancel</button>
                        </div>
                      } @else { <button type="button" [disabled]="!!busy()" (click)="pending.set(shortcut)">Review possible repair…</button> }
                    }
                  </li>
                } @empty {
                  <li>No Git Khronos shortcuts were found for this distribution.</li>
                }
              </ul>
              @if (!hasPin()) { <p>No Git Khronos shortcut was found in the taskbar pins folder. To pin it, right-click Git Khronos in the Start Menu, choose Pin to taskbar, then check again.</p> }
            }
          </div>
        }
      </section>
    </div>
  `,
  styles: `
    .backdrop{position:fixed;inset:0;z-index:180;display:grid;place-items:center;background:rgb(0 0 0/.45)}
    section{box-sizing:border-box;width:min(820px,calc(100vw - 24px));max-height:calc(100dvh - 24px);display:flex;flex-direction:column;overflow:auto;background:var(--overlay-surface);color:var(--text);border:1px solid var(--overlay-border);border-radius:6px}
    header{position:sticky;top:0;z-index:1;flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px;background:var(--overlay-surface);border-bottom:1px solid var(--inspector-divider)}h2{margin:0;font-size:16px}p{font-size:13px;line-height:1.5;margin:8px 0}header p,small,dt,.limit{color:var(--muted)}
    button{min-height:34px;padding:7px 12px;background:var(--inspector-row);color:var(--text);border:1px solid var(--inspector-divider);font:inherit;font-size:13px;cursor:pointer}button:disabled{opacity:.55;cursor:default}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px}.feedback{padding:0 16px}.body{padding:0 16px 16px}code{overflow-wrap:anywhere}
    dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;font-size:12px}dd{margin:0;overflow-wrap:anywhere}
    ul{list-style:none;margin:12px 0 0;padding:0}li{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 0;border-top:1px solid var(--inspector-divider);font-size:13px}small{font-size:12px;overflow-wrap:anywhere}strong{font-weight:600}
    .state{font-size:12px}.confirm{align-self:stretch;margin-top:6px;padding-top:8px;border-top:1px dashed var(--inspector-divider)}.confirm button+button{margin-left:8px}
    @media(max-width:640px){header{padding:12px}dl{grid-template-columns:minmax(0,1fr)}dd{margin-bottom:6px}}
  `,
})
export class WindowsLauncherComponent implements OnDestroy {
  readonly closed = output<void>();
  readonly inspection = signal<WindowsLauncherInspection | null>(null);
  readonly busy = signal<'reading' | 'repairing' | null>(null);
  readonly error = signal('');
  readonly errorHint = signal('');
  readonly repaired = signal<WindowsShortcutRepair | null>(null);
  readonly pending = signal<WindowsShortcut | null>(null);
  readonly hasPin = computed(() => this.inspection()?.shortcuts.some(shortcut => shortcut.location === 'taskbarPin') ?? false);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private generation = 0;
  private destroyed = false;
  private repairFailed = false;

  constructor() { afterNextRender(() => { this.closeButton()?.nativeElement.focus(); void this.refresh(); }); }
  private fail(error: unknown, fallback: string, repair: boolean): void {
    this.repairFailed = repair;
    const details = error as Partial<AppError> | null;
    this.error.set(details?.message ?? fallback);
    this.errorHint.set(details?.hint ?? '');
  }
  locationLabel(location: WindowsShortcutLocation): string { return LOCATIONS[location] ?? location; }
  launchLabel(launch: WindowsShortcutLaunch): string { return LAUNCH[launch] ?? launch; }
  identityLabel(identity: WindowsShortcutIdentity): string { return IDENTITY[identity] ?? identity; }
  repairSummary(result: WindowsShortcutRepair): string {
    const changes = [
      result.plan.target !== null ? `starts ${result.plan.target}` : '',
      result.plan.appIdentity !== null ? 'carries the identity from the window record' : '',
    ].filter(Boolean);
    return `The shortcut file now ${changes.join(' and ')}.`;
  }
  async refresh(): Promise<void> {
    if (this.destroyed || this.busy()) return;
    const generation = ++this.generation;
    this.busy.set('reading'); this.pending.set(null);
    if (!this.repairFailed) { this.error.set(''); this.errorHint.set(''); }
    try {
      const result = await ipc.inspect_windows_launcher();
      if (!this.destroyed && generation === this.generation) this.inspection.set(result);
    } catch (error) {
      if (!this.destroyed && generation === this.generation) { this.inspection.set(null); this.fail(error, 'The Windows shortcuts could not be checked.', false); }
    } finally { if (!this.destroyed && generation === this.generation) this.busy.set(null); }
  }
  async repair(shortcut: WindowsShortcut): Promise<void> {
    const plan = shortcut.repair;
    if (this.destroyed || this.busy() || !plan || this.pending()?.path !== shortcut.path) return;
    this.busy.set('repairing'); this.error.set(''); this.errorHint.set(''); this.repairFailed = false; this.repaired.set(null);
    try {
      const result = await ipc.repair_windows_shortcut({ path: shortcut.path, fingerprint: shortcut.fingerprint, plan });
      if (this.destroyed) return;
      this.repaired.set(result); this.pending.set(null); this.busy.set(null);
      await this.refresh();
    } catch (error) {
      if (!this.destroyed) { this.pending.set(null); this.fail(error, 'The shortcut could not be updated.', true); }
    } finally { if (!this.destroyed && this.busy() === 'repairing') this.busy.set(null); }
  }
  requestClose(): void { if (this.busy() !== 'repairing') this.closed.emit(); }
  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.requestClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled)')]
      .filter(element => element.getClientRects().length > 0);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (index === controls.length - 1 || index === -1)) { event.preventDefault(); controls[0]?.focus(); }
  }
  ngOnDestroy(): void { this.destroyed = true; this.generation++; }
}
