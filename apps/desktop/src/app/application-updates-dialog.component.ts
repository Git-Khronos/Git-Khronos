import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, viewChild } from '@angular/core';
import type { ApplicationUpdateStatus } from '@git-khronos/contracts';
import { ApplicationUpdatesService } from './application-updates.service';

export interface ApplicationUpdatesRequest { readonly id: number; readonly returnFocus: HTMLElement | null }

@Component({
  selector: 'gc-application-updates-dialog',
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
            @if (state.installedVersion) { <div><dt>Installed version</dt><dd>{{ state.installedVersion }}</dd></div> }
            @if (state.offeredVersion) { <div><dt>Available version</dt><dd>{{ state.offeredVersion }}</dd></div> }
            @if (state.packageFormat) { <div><dt>Package</dt><dd>{{ state.packageFormat }}</dd></div> }
          </dl>
          <p class="feedback" role="status">{{ state.message }}</p>
          @if (state.verified) { <p class="verified">Package signature and signed version verified</p> }
          @if (state.phase === 'downloading') {
            <p role="status">Downloaded {{ megabytes(state.downloadedBytes) }} MB@if (state.totalBytes !== null) { of {{ megabytes(state.totalBytes) }} MB }</p>
            <progress aria-label="Update download" [attr.value]="state.totalBytes === null ? null : state.downloadedBytes" [attr.max]="state.totalBytes ?? null"></progress>
          }
          @if (state.notes) { <section class="notes" aria-label="Release notes"><h3>Release notes</h3><p>{{ state.notes }}</p></section> }
          <label class="automatic"><input type="checkbox" [checked]="state.automatic"
            [disabled]="updates.settingPending() || ((!state.configured || !!state.storageError) && !state.automatic)"
            (change)="automatic($event, target)" />Enable automatic updates</label>
          <p class="help">Off by default. Automatic checks and verified downloads use the same publisher trust as manual updates. Installation waits for Git work, terminal sessions and editors to finish; OS authorization may be required. Turning this off does not cancel an installer that has already started.</p>
          @if (state.packageFormat === 'msi' || state.packageFormat === 'nsis') { <p class="help">Windows currently supports checks and verified downloads only. Self-installation awaits a safe restart flow.</p> }
          @if (updates.settingPending()) { <p role="status">Saving automatic-update preference…</p> }
          @if (state.storageError) { <p role="alert">{{ state.storageError }} The saved preference or installer receipt may be unconfirmed.</p> }
          <footer>
            <button type="button" [disabled]="!state.canCheck || updates.actionPending()" (click)="check(target)">Check for updates</button>
            @if (state.offerId) {
              <button type="button" [disabled]="!state.canDownload || updates.actionPending()" (click)="download(target, state)">Download and verify</button>
              <button class="primary" type="button" [disabled]="!state.canInstall || updates.actionPending()" (click)="install(target, state)">Install verified update</button>
            }
            @if (state.canInspect) { <button type="button" [disabled]="updates.actionPending()" (click)="inspect(target)">Inspect installation</button> }
            <button type="button" [disabled]="updates.actionPending()" (click)="refresh(target)">Refresh status</button>
          </footer>
          <p class="help">Updates never change your repositories. Installation and restart are separate: a confirmed install does not mean this running window has switched versions.</p>
        } @else { <p role="status">Reading native update status…</p> }
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
    button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .primary { color: var(--accent); } .automatic { display: flex; gap: 9px; align-items: center; font-size: 14px; margin-top: 16px; }
    .help { color: var(--muted); font-size: 12px; } .feedback { padding: 12px; border: 1px solid var(--overlay-border); border-radius: 5px; }
    .verified { color: var(--accent); font-size: 13px; } [role=alert] { color: var(--danger); } .notes p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; }
    footer { flex-wrap: wrap; margin-top: 16px; } progress { width: 100%; accent-color: var(--accent); }
  `],
})
export class ApplicationUpdatesDialogComponent {
  readonly request = input.required<ApplicationUpdatesRequest>();
  readonly ownsRequest = input.required<(request: ApplicationUpdatesRequest) => boolean>();
  readonly closed = output<ApplicationUpdatesRequest>();
  readonly updates = inject(ApplicationUpdatesService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  constructor() {
    void this.updates.activate();
    const timer = setInterval(() => { if (this.owns(this.request())) void this.updates.refresh(); }, 1500);
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
  automatic(event: Event, target: ApplicationUpdatesRequest): void {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    input.checked = this.updates.state()?.automatic ?? false;
    if (!this.owns(target)) return;
    void this.updates.setAutomatic(enabled).finally(() => {
      if (this.owns(target) && input.isConnected) input.checked = this.updates.state()?.automatic ?? false;
    });
  }
  megabytes(bytes: number): string { return (bytes / (1024 * 1024)).toFixed(1); }
  key(event: KeyboardEvent, target: ApplicationUpdatesRequest): void {
    if (!this.owns(target)) return;
    event.stopPropagation();
    if ((event.key === 'Enter' || event.key === ' ') && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || event.isComposing)) {
      event.preventDefault(); return;
    }
    if (event.key === 'Escape') { event.preventDefault(); this.close(target); }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])].filter(element => element.getClientRects().length);
    if (!controls.length) return;
    event.preventDefault(); const index = controls.indexOf(document.activeElement as HTMLElement);
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
