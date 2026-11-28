import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { ipc, type ApplicationUpdateStatus } from '@git-khronos/contracts';
import { ApplicationUpdatesService } from './application-updates.service';
import { isTabKey } from './tab-key';

export interface ApplicationUpdatesRequest { readonly id: number; readonly returnFocus: HTMLElement | null }

@Component({
  selector: 'gk-application-updates-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let target = request();
    <div class="backdrop" (click)="close(target)">
      <section #dialog tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="application-updates-title" (click)="$event.stopPropagation()" (keydown)="key($event, target)">
        <header><h2 id="application-updates-title">Updates</h2><button #closeButton type="button" [disabled]="updates.installing()" (click)="close(target)">Close</button></header>
        @if (!updates.native()) {
          <p role="status">Application updates are available in the desktop app, not the browser preview.</p>
        } @else if (updates.state(); as state) {
          <dl><div><dt>Running version</dt><dd>{{ state.runningVersion }}</dd></div>
            @if (state.buildInputId) { <div><dt>Running build ID</dt><dd><code>{{ state.buildInputId }}</code></dd></div> }
            @if (state.installedVersion) { <div><dt>Installed version</dt><dd>{{ state.installedVersion }}</dd></div> }
            @if (state.offeredVersion) { <div><dt>Available version</dt><dd>{{ state.offeredVersion }}</dd></div> }
            @if (state.packageFormat) { <div><dt>Package</dt><dd>{{ state.packageFormat }}</dd></div> }
          </dl>
          <p class="feedback" role="status">@if (updates.statusError()) { <strong>Last known status: </strong> }{{ state.message }}</p>
          @if (state.verified) { <p class="verified">Package signature and signed version verified</p> }
          @if (state.installBlocker && !updates.statusError()) {
            <p id="application-update-install-blocker" class="help" role="status">{{ state.installBlocker }}</p>
          }
          @if (state.phase === 'downloading') {
            @let total = state.totalBytes !== null && state.totalBytes > 0 ? state.totalBytes : null;
            <p id="application-update-download-size">Downloaded {{ formatBytes(state.downloadedBytes) }}@if (total !== null) { of {{ formatBytes(total) }} }</p>
            <progress aria-label="Update download" aria-describedby="application-update-download-size"
              [attr.value]="total === null ? null : state.downloadedBytes" [attr.max]="total"></progress>
          }
          @if (state.notes) { <section class="notes" aria-label="Release notes"><h3>Release notes</h3><p>{{ state.notes }}</p></section> }
          <label class="automatic"><input type="checkbox" [checked]="state.automatic"
            aria-describedby="application-automatic-update-help"
            [disabled]="updates.settingPending() || ((!state.configured || !!state.storageError || !!updates.statusError()) && !state.automatic)"
            (change)="automatic($event, target)" />Enable automatic updates</label>
          <p id="application-automatic-update-help" class="help">
            @if (!state.configured) {
              This build cannot check for or install updates in the app. Use Browse official releases to find a package
              and install it manually.
            }
            Off by default. When enabled, the app checks for updates and downloads and verifies packages from the trusted publisher.
            @if (state.configured) {
              It checks shortly after enabling or reopening the app, then about every six hours while the app is open.
            }
            @if (state.packageFormat === 'msi' || state.packageFormat === 'nsis') {
              On Windows, you must install the update yourself.
            } @else {
              Where self-installation is supported, the app installs updates when no Git operation, terminal session or editor is active.
              Your system may ask for authorization. Turning this off does not stop an installer that has already started.
            }
          </p>
          @if (updates.settingPending()) { <p role="status">Saving automatic-update preference…</p> }
          @if (state.storageError) { <p role="alert">{{ state.storageError }} The saved preference or installer receipt may be unconfirmed.</p> }
        } @else if (!updates.statusError()) { <p role="status">Reading native update status…</p> }
        @if (updates.native()) {
          <footer>
            @if (updates.state(); as state) {
              <button type="button" [disabled]="!state.canCheck || !!updates.statusError() || updates.actionPending()" (click)="check(target)">Check for updates</button>
              @if (state.offerId) {
                <button type="button" [disabled]="!state.canDownload || !!updates.statusError() || updates.actionPending()" (click)="download(target, state)">Download and verify</button>
                <button class="primary" type="button" [disabled]="!state.canInstall || !!updates.statusError() || updates.actionPending()"
                  [attr.aria-describedby]="state.installBlocker && !updates.statusError() ? 'application-update-install-blocker' : null"
                  (click)="install(target, state)">Install verified update</button>
              }
              @if (state.canInspect) { <button type="button" [disabled]="updates.actionPending()" (click)="inspect(target)">Inspect installation</button> }
            }
            <button type="button" [disabled]="updates.installing()" [attr.aria-disabled]="openingReleases() ? 'true' : null" (click)="browseReleases(target)">Browse official releases (opens browser)</button>
            <button type="button" [disabled]="updates.actionPending()" (click)="refresh(target)">Refresh status</button>
          </footer>
          @if (releaseError()) {
            <div class="release-error">
              <p role="alert">Could not open the browser. Copy the official release page address into your browser to check manually.</p>
              <label class="release-address">Official release page address
                <input #releaseUrlField type="url" readonly [value]="officialReleasesUrl" (focus)="releaseUrlField.select()" />
              </label>
            </div>
          }
          <p class="help">Updates never change your repositories. Installation and restart are separate: a confirmed install does not mean this running window has switched versions.</p>
        }
        @if (updates.statusError(); as explanation) { <p role="alert">{{ explanation }}</p> }
        @if (updates.error()) { <p role="alert">{{ updates.error() }}</p> }
        @if (updates.liveError()) { <p class="help">{{ updates.liveError() }}</p> }
      </section>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 125; display: grid; place-items: center; padding: 20px; background: #080812aa; }
    section[role=dialog] { width: min(650px, 100%); max-height: calc(100vh - 40px); overflow: auto; padding: 20px; border: 1px solid var(--overlay-border); border-radius: 10px; background: var(--overlay-surface); color: var(--text); box-shadow: var(--overlay-shadow); }
    header, footer, dl > div { display: flex; align-items: center; gap: 10px; } header { justify-content: space-between; margin-bottom: 14px; }
    h2 { margin: 0; font-size: 19px; } h3 { font-size: 13px; } p { line-height: 1.5; }
    dl { margin: 0 0 14px; font-size: 13px; } dl > div { justify-content: space-between; padding: 4px 0; } dd { margin: 0; font-family: monospace; }
    button { padding: 8px 12px; border: 1px solid var(--overlay-border); border-radius: 5px; background: var(--inspector-row); color: var(--text); }
    button:disabled, button[aria-disabled=true] { opacity: .5; cursor: not-allowed; } button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .primary { color: var(--accent); } .automatic { display: flex; gap: 9px; align-items: center; font-size: 14px; margin-top: 16px; }
    .help { color: var(--muted); font-size: 12px; } .feedback { padding: 12px; border: 1px solid var(--overlay-border); border-radius: 5px; }
    .verified { color: var(--accent); font-size: 13px; } [role=alert] { color: var(--danger); } .notes p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; }
    footer { flex-wrap: wrap; margin-top: 16px; } progress { width: 100%; accent-color: var(--accent); }
    .release-address { display: grid; gap: 6px; }
    .release-address input { width: 100%; min-width: 0; box-sizing: border-box; padding: 8px; border: 1px solid var(--overlay-border); border-radius: 5px; background: var(--inspector-row); color: var(--text); font-family: monospace; }
  `],
})
export class ApplicationUpdatesDialogComponent {
  readonly request = input.required<ApplicationUpdatesRequest>();
  readonly ownsRequest = input.required<(request: ApplicationUpdatesRequest) => boolean>();
  readonly closed = output<ApplicationUpdatesRequest>();
  readonly updates = inject(ApplicationUpdatesService);
  protected readonly officialReleasesUrl = 'https://github.com/Git-Khronos/Git-Khronos/releases';
  protected readonly openingReleases = signal(false);
  protected readonly releaseError = signal(false);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  constructor() {
    void this.updates.activate();
    const timer = setInterval(() => { if (this.owns(this.request())) void this.updates.pollStatus(); }, 1500);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    afterNextRender(() => {
      if (this.owns(this.request())) {
        const close = this.closeButton()?.nativeElement;
        if (close && !close.disabled) close.focus(); else this.dialog()?.nativeElement.focus();
      }
    });
  }
  private owns(target: ApplicationUpdatesRequest): boolean { return this.request() === target && this.ownsRequest()(target); }
  close(target: ApplicationUpdatesRequest): void { if (this.owns(target) && !this.updates.installing()) this.closed.emit(target); }
  check(target: ApplicationUpdatesRequest): void { if (this.owns(target)) void this.updates.check(); }
  download(target: ApplicationUpdatesRequest, state: ApplicationUpdateStatus): void { if (this.owns(target)) void this.updates.download(state.offerId); }
  install(target: ApplicationUpdatesRequest, state: ApplicationUpdateStatus): void { if (this.owns(target)) void this.updates.install(state.offerId); }
  inspect(target: ApplicationUpdatesRequest): void { if (this.owns(target)) void this.updates.inspect(); }
  refresh(target: ApplicationUpdatesRequest): void { if (this.owns(target)) void this.updates.refresh(); }
  async browseReleases(target: ApplicationUpdatesRequest): Promise<void> {
    if (!this.owns(target) || !this.updates.native() || this.updates.installing() || this.openingReleases()) return;
    this.openingReleases.set(true);
    this.releaseError.set(false);
    try { await ipc.open_external_url({ url: this.officialReleasesUrl }); }
    catch { if (this.owns(target)) this.releaseError.set(true); }
    finally { this.openingReleases.set(false); }
  }
  automatic(event: Event, target: ApplicationUpdatesRequest): void {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    input.checked = this.updates.state()?.automatic ?? false;
    if (!this.owns(target)) return;
    void this.updates.setAutomatic(enabled).finally(() => {
      if (this.owns(target) && input.isConnected) input.checked = this.updates.state()?.automatic ?? false;
    });
  }
  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes % 1024 ? 1 : 0)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  private keyboardControls(): HTMLElement[] {
    return [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])]
      .filter(element => element.getClientRects().length);
  }

  focusKeyboardEdge(backwards: boolean): void {
    if (!this.owns(this.request())) return;
    const controls = this.keyboardControls();
    (controls[backwards ? controls.length - 1 : 0] ?? this.dialog()?.nativeElement)?.focus();
  }

  key(event: KeyboardEvent, target: ApplicationUpdatesRequest): void {
    if (!this.owns(target)) return;
    event.stopPropagation();
    if ((event.key === 'Enter' || event.key === ' ') && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || event.isComposing)) {
      event.preventDefault(); return;
    }
    if (event.key === 'Escape') { event.preventDefault(); this.close(target); }
    if (!isTabKey(event)) return;
    event.preventDefault();
    const controls = this.keyboardControls();
    if (!controls.length) { this.dialog()?.nativeElement.focus(); return; }
    const index = controls.indexOf(document.activeElement as HTMLElement);
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
