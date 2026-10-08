import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { LfsCheckoutPreview, LfsFetchPreview, LfsFileAttributes, LfsObjects, LfsTrackingPattern, LfsTrackingRules } from '@git-chronos/contracts';
import { GitChronosService } from './git-chronos.service';
import { GitHelpComponent } from './git-help.component';

export interface LfsTrackingRequest {
  repositoryId: string;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-lfs-tracking-dialog',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="$event.stopPropagation(); close()">
        <section #dialog role="dialog" aria-modal="true" aria-labelledby="lfs-tracking-title"
          aria-describedby="lfs-tracking-scope" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
          <h2 id="lfs-tracking-title">LFS tracking patterns</h2>
          <p id="lfs-tracking-scope">These are configured rules, not a list of effective attributes for each file.
            Only root .gitattributes rules can be removed here. Nested or external rules must be edited in their own scope.
            Git LFS may initialize repository-local metadata; configured hooks are not changed.</p>
          @if (target.repositoryId !== git.activeRepositoryId()) {
            <p role="alert" tabindex="-1">The active repository changed. Close this dialog and review the intended repository.</p>
          }
          @if (git.error()) { <p role="alert" tabindex="-1">{{ git.error() }}</p> }
          @if (loading()) { <p role="status">Reading repository diagnostics…</p> }
          <details>
            <summary [attr.aria-disabled]="unavailable()" (click)="guardDisclosure($event)">Local LFS object diagnostics</summary>
            <p>Scan Git LFS pointers reported for the current index and HEAD, not all history or untracked files.
              Index entries take precedence for the same path; the CLI can still report HEAD paths deleted from the index.
              Zero-size objects are omitted by Git LFS. No download, checkout, prune or integrity check runs.</p>
            <button type="button" [disabled]="unavailable()" (click)="inspectObjects()">Inspect local objects</button>
            @if (objects(); as listing) {
              <div class="object-result" role="status" tabindex="-1">
                <p>{{ listing.files.length }} {{ listing.files.length === 1 ? 'path reported' : 'paths reported' }}.
                  Results are observations at scan time, not an atomic snapshot.</p>
                <p>Cache availability and the CLI's working-size flag are size checks, not hash verification.
                  Same-sized modified or corrupt content can still match. Extended or different pointers are marked pointer-like, not hydrated.</p>
                <label for="lfs-fetch-remote">Remote for selective fetch</label>
                @if (!git.repository()?.remotes?.length) {
                  <p>No remotes are configured. Add a remote before reviewing an LFS fetch.</p>
                }
                <select id="lfs-fetch-remote" [disabled]="unavailable()" [ngModel]="fetchRemote()" (ngModelChange)="changeFetchRemote($event)">
                  <option value="">Choose a remote</option>
                  @for (remote of git.repository()?.remotes ?? []; track remote.name) {
                    <option [value]="remote.name">{{ remote.name }}</option>
                  }
                </select>
                <p>Fetch is a separate, reviewed action for one committed HEAD object. Git LFS uses the remote's configured
                  endpoint, which can differ from the Git remote URL. Staged-only objects cannot be fetched here.</p>
                <gc-git-help topic="lfs-fetch" [disabled]="git.busy() || loading()" label="Learn about LFS fetching…" />
                @if (!listing.files.length) { <p>No nonempty LFS pointers were reported in this scope. This does not prove all files are hydrated.</p> }
                <ul aria-label="Local LFS objects">
                  @for (file of listing.files; track file.name) {
                    <li><div><code>{{ file.name }}</code>
                      <span>{{ file.size }} bytes · {{ file.oidType }}</span>
                      <code>{{ file.oid }}</code>
                      <span>Working file: {{ workingStateLabel(file.workingState) }}</span>
                      <span>Git LFS working-size flag: {{ file.checkout ? 'matches object size' : 'does not match or unavailable' }}</span>
                      <span>Local cache: {{ file.downloaded ? 'available by size (not hash-verified)' : 'missing or wrong size' }}</span>
                      @if (!file.downloaded) {
                        <p>Fetch the required objects from the intended LFS remote when connected.
                          If a transfer fails, check credentials, endpoint and server object availability before retrying.
                          Do not commit unresolved pointers as replacement contents or prune objects to resolve this state.</p>
                      } @else if (file.workingState === 'pointer') {
                        <p>The object is locally available by size, but the working file is still a pointer.
                          Use a reviewed checkout workflow; this diagnostic does not overwrite files.</p>
                      }
                      <button type="button" [disabled]="unavailable() || !fetchRemote()"
                        [attr.aria-label]="'Review fetch of ' + file.name" (click)="reviewFetch(file)">Review fetch…</button>
                      @if (file.workingState === 'pointer' && file.downloaded) {
                        <button type="button" [disabled]="unavailable()"
                          [attr.aria-label]="'Review hydration of ' + file.name" (click)="reviewCheckout(file)">Review hydration…</button>
                      }
                    </div></li>
                  }
                </ul>
              </div>
            }
            @if (fetchPreview(); as preview) {
              <div class="fetch-review">
                <h3>Fetch <code>{{ preview.file }}</code> from {{ preview.remote }}?</h3>
                <p>{{ preview.size }} bytes · sha256:<code>{{ preview.oid }}</code></p>
                <p>Committed HEAD: <code>{{ preview.head }}</code>. HEAD and effective Git/LFS settings are rechecked before transfer.</p>
                <p>Downloads this object into configured local LFS storage only. Does not hydrate, stage, prune or update Git references.
                  Remote autodetection/fallback, recent/history fetching and configured include/exclude filters are overridden for this single-file scope.
                  Failed or cancelled transfers can leave downloaded or partial cache data. Availability is checked by size, not hash.</p>
                <button data-lfs-fetch type="button" [disabled]="unavailable()" (click)="confirmFetch()">Fetch reviewed object</button>
                @if (fetching()) {
                  <button type="button" [disabled]="git.activeOperationCancelling()" (click)="git.cancelActiveOperation()">
                    {{ git.activeOperationCancelling() ? 'Cancelling…' : 'Cancel transfer' }}
                  </button>
                }
              </div>
            }
            @if (checkoutPreview(); as preview) {
              <div class="checkout-review">
                <gc-git-help topic="lfs-checkout" [disabled]="git.busy() || loading()" label="Learn about LFS hydration…" />
                <h3>Hydrate <code>{{ preview.file }}</code> from local storage?</h3>
                <p>{{ preview.size }} bytes · sha256:<code>{{ preview.oid }}</code></p>
                <p>Replaces only the existing canonical working pointer matching the included stage-zero index entry.
                  The index, HEAD, branch, effective LFS attributes, permissions and settings are rechecked before replacement.
                  Modified, missing, symlink, conflicted, sparse-excluded and assume-unchanged paths are refused.</p>
                <p>Copies cached contents to a private temporary file, verifies SHA-256 and size, then replaces the pointer.
                  No network transfer, staging, pruning, lock/unlock or reference update runs. Existing permissions are preserved.
                  Free disk space for the complete object is required. External edits can still race these checks.</p>
                <button data-lfs-checkout type="button" [disabled]="unavailable()" (click)="confirmCheckout()">Hydrate reviewed file</button>
                @if (hydrating()) {
                  <button type="button" [disabled]="git.activeOperationCancelling()" (click)="git.cancelActiveOperation()">
                    {{ git.activeOperationCancelling() ? 'Cancelling…' : 'Cancel hydration' }}
                  </button>
                }
              </div>
            }
          </details>
          <form (submit)="$event.preventDefault(); inspectAttributes()">
            <h3>Inspect effective file attributes</h3>
            <label for="lfs-attribute-path">Repository-relative file path</label>
            <input id="lfs-attribute-path" type="text" name="file" maxlength="4096" placeholder="assets/image.psd"
              aria-describedby="lfs-attribute-scope"
              [disabled]="unavailable()" [ngModel]="attributePath()" (ngModelChange)="changeAttributePath($event)" />
            <button type="submit" [disabled]="unavailable() || !attributePath()">Inspect attributes</button>
            <p id="lfs-attribute-scope">Works without Git LFS. Git resolves root, nested, info, global and system attributes.
              Working view can fall back to staged attributes for missing attribute files.
              Index view ignores working attribute files, but still uses configured external sources.
              A path may be untracked, missing or sparse-excluded; this checks rules, not file existence or hydration.</p>
          </form>
          @if (fileAttributes(); as inspected) {
            <div class="attribute-result" role="status" tabindex="-1">
              <h3>Attributes for <code>{{ inspected.path }}</code></h3>
              <p>Results at inspection time; working and index views are read sequentially. Inspect again after edits.</p>
              <table aria-label="Effective file attributes"><thead><tr><th>Attribute</th><th>Working view</th><th>Index view</th></tr></thead>
                <tbody>@for (attribute of inspected.attributes; track attribute.name) {
                  <tr><th scope="row">{{ attribute.name }}</th><td>{{ attribute.working }}</td><td>{{ attribute.index }}</td></tr>
                }</tbody></table>
              <p><code>filter=lfs</code> assigns the LFS filter. It does not prove LFS is installed or file contents are hydrated.
                Git reports set, unset, unspecified, or a custom value; literal values can use the same words.</p>
            </div>
          }
          @if (rules(); as listing) {
            @if (!listing.patterns.length) { <p>No LFS tracking patterns were reported by Git LFS.</p> }
            <ul aria-label="Configured LFS patterns">
              @for (rule of listing.patterns; track $index) {
                <li><div><code>{{ rule.pattern }}</code><span>Source: {{ rule.source }}</span>
                  <span>{{ rule.tracked ? 'LFS tracking' : 'Excluded from LFS' }}{{ rule.lockable ? ' · Lockable' : '' }}</span></div>
                  @if (rule.source === '.gitattributes' && rule.tracked && !rule.pattern.startsWith('[attr]')) {
                    <button type="button" [disabled]="unavailable()" [attr.aria-label]="'Review removal of ' + rule.pattern"
                      (click)="select(rule)">Review removal…</button>
                  } @else { <span>Read-only here</span> }
                </li>
              }
            </ul>
            @if (selected(); as rule) {
              <div class="review">
                <h3>Remove root rule <code>{{ rule.pattern }}</code>?</h3>
                <p>Git LFS removes matching lines from root .gitattributes, including lockable and any other attributes on those lines.
                  Git LFS can normalize line endings. Other rule files and the staged index are not changed.
                  Review the resulting diff and commit .gitattributes separately.</p>
                <p>This does not convert existing LFS pointers, rewrite history, delete LFS objects, or change tracked file contents.
                  It does not undo read-only permissions previously applied by lockable rules. Other attribute sources can still track matching files.</p>
                <p>Current root .gitattributes:</p>
                <pre aria-label="Current root attributes">{{ listing.rootAttributes }}</pre>
                <button class="danger" type="button" [disabled]="unavailable()" (click)="confirm()">Remove root rule</button>
              </div>
            }
          }
          @if (notice()) { <p role="status" tabindex="-1">{{ notice() }}</p> }
          <gc-git-help topic="lfs" [disabled]="git.busy() || loading()" label="Learn about tracking rules and LFS pointers…" />
          <footer><button type="button" [disabled]="unavailable()" (click)="reload()">Reload patterns</button>
            <button data-lfs-close type="button" [disabled]="git.busy() || loading()" (click)="close()">Close</button></footer>
        </section>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: var(--overlay-backdrop); }
    section { box-sizing: border-box; width: min(620px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    h3 { font-size: 14px; }
    p, li, button { font-size: 13px; line-height: 1.5; }
    ul { list-style: none; padding: 0; max-height: 240px; overflow: auto; }
    li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--inspector-divider); }
    li div { min-width: 0; flex: 1 1 240px; }
    li span { display: block; }
    code, li span { overflow-wrap: anywhere; }
    pre { padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: var(--inspector-row); }
    label { display: block; margin-bottom: 6px; font-size: 13px; }
    input { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px; margin-bottom: 8px; color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid var(--inspector-divider); overflow-wrap: anywhere; }
    footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    select { box-sizing: border-box; width: 100%; padding: 8px; color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    summary[aria-disabled=true] { opacity: .5; cursor: not-allowed; }
    .danger, [role=alert] { color: var(--danger); }
  `],
})
export class LfsTrackingDialogComponent {
  readonly git = inject(GitChronosService);
  readonly request = input<LfsTrackingRequest | null>(null);
  readonly closed = output<void>();
  readonly rules = signal<LfsTrackingRules | null>(null);
  readonly selected = signal<LfsTrackingPattern | null>(null);
  readonly notice = signal('');
  readonly loading = signal(false);
  readonly attributePath = signal('');
  readonly fileAttributes = signal<LfsFileAttributes | null>(null);
  readonly objects = signal<LfsObjects | null>(null);
  readonly fetchRemote = signal('');
  readonly fetchPreview = signal<LfsFetchPreview | null>(null);
  readonly fetching = signal(false);
  readonly checkoutPreview = signal<LfsCheckoutPreview | null>(null);
  readonly hydrating = signal(false);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    effect(() => {
      if (this.request()) untracked(() => { this.attributePath.set(''); void this.reload(); });
    });
  }

  unavailable(): boolean {
    return this.git.busy() || this.loading() || this.request()?.repositoryId !== this.git.activeRepositoryId();
  }

  guardDisclosure(event: MouseEvent): void {
    if (this.unavailable()) event.preventDefault();
  }

  async reload(): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable()) return;
    this.loading.set(true);
    this.selected.set(null);
    this.rules.set(null);
    this.notice.set('');
    this.fileAttributes.set(null);
    this.objects.set(null);
    this.fetchPreview.set(null);
    this.checkoutPreview.set(null);
    try {
      const rules = await this.git.loadLfsTrackingRules(target.repositoryId);
      if (this.request() === target) this.rules.set(rules);
    } finally {
      this.loading.set(false);
    }
    this.focus(this.git.error() ? '[role=alert]' : '[data-lfs-close]');
  }

  select(rule: LfsTrackingPattern): void {
    if (this.unavailable()) return;
    this.selected.set(rule);
    this.notice.set('');
    this.focus('.danger');
  }

  changeAttributePath(value: string): void {
    this.attributePath.set(value);
    this.fileAttributes.set(null);
  }

  async inspectAttributes(): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable() || !this.attributePath()) return;
    const file = this.attributePath();
    this.fileAttributes.set(null);
    this.notice.set('');
    this.loading.set(true);
    try {
      const attributes = await this.git.inspectLfsAttributes(file, target.repositoryId);
      if (this.request() === target && this.attributePath() === file) this.fileAttributes.set(attributes);
    } finally { this.loading.set(false); }
    this.focus(this.git.error() ? '[role=alert]' : '.attribute-result');
  }

  async inspectObjects(): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable()) return;
    this.objects.set(null);
    this.fetchPreview.set(null);
    this.checkoutPreview.set(null);
    this.notice.set('');
    this.loading.set(true);
    try {
      const objects = await this.git.inspectLfsObjects(target.repositoryId);
      if (this.request() === target) this.objects.set(objects);
    } finally { this.loading.set(false); }
    this.focus(this.git.error() ? '[role=alert]' : '.object-result');
  }

  changeFetchRemote(remote: string): void {
    this.fetchRemote.set(remote);
    this.fetchPreview.set(null);
  }

  async reviewFetch(file: LfsObjects['files'][number]): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable() || !this.fetchRemote()) return;
    this.fetchPreview.set(null);
    this.checkoutPreview.set(null);
    this.notice.set('');
    this.loading.set(true);
    try {
      const preview = await this.git.previewLfsFetch(file, this.fetchRemote(), target.repositoryId);
      if (this.request() === target) this.fetchPreview.set(preview);
    } finally { this.loading.set(false); }
    this.focus(this.git.error() ? '[role=alert]' : '[data-lfs-fetch]');
  }

  async confirmFetch(): Promise<void> {
    const target = this.request();
    const preview = this.fetchPreview();
    if (!target || !preview || this.unavailable()) return;
    this.fetching.set(true);
    this.notice.set('');
    let result: 'success' | 'error' | 'cancelled' | undefined;
    try { result = await this.git.fetchLfsObject(preview, target.repositoryId); }
    finally { this.fetching.set(false); }
    if (this.request() !== target) return;
    this.fetchPreview.set(null);
    if (target.repositoryId !== this.git.activeRepositoryId()) {
      this.focus('[role=alert]');
      return;
    }
    if (result === 'success') {
      await this.inspectObjects();
      if (this.git.error()) return;
      this.notice.set('Reviewed object fetched into local storage. Working files were not hydrated; cache availability is not hash verification.');
      this.focus('.object-result');
    } else if (result === 'cancelled') {
      this.notice.set('LFS fetch cancelled. Downloaded or partial cache data may remain. Inspect objects again and review before retrying; no working-file checkout was requested.');
      this.focus('[role=status][tabindex="-1"]:not(.object-result):not(.attribute-result)');
    } else this.focus('[role=alert]');
  }

  async reviewCheckout(file: LfsObjects['files'][number]): Promise<void> {
    const target = this.request();
    if (!target || this.unavailable()) return;
    this.fetchPreview.set(null);
    this.checkoutPreview.set(null);
    this.notice.set('');
    this.loading.set(true);
    try {
      const preview = await this.git.previewLfsCheckout(file, target.repositoryId);
      if (this.request() === target) this.checkoutPreview.set(preview);
    } finally { this.loading.set(false); }
    this.focus(this.git.error() ? '[role=alert]' : '[data-lfs-checkout]');
  }

  async confirmCheckout(): Promise<void> {
    const target = this.request();
    const preview = this.checkoutPreview();
    if (!target || !preview || this.unavailable()) return;
    this.hydrating.set(true);
    this.notice.set('');
    let result: 'success' | 'error' | 'cancelled' | undefined;
    try { result = await this.git.checkoutLfsObject(preview, target.repositoryId); }
    finally { this.hydrating.set(false); }
    if (this.request() !== target) return;
    this.checkoutPreview.set(null);
    if (target.repositoryId !== this.git.activeRepositoryId()) { this.focus('[role=alert]'); return; }
    if (result === 'success') {
      await this.inspectObjects();
      if (this.git.error()) return;
      this.notice.set('Reviewed working pointer hydrated from SHA-256-verified local contents. Index, references and permissions were not changed.');
      this.focus('.object-result');
    } else if (result === 'cancelled') {
      this.notice.set('Hydration cancelled. Refresh and inspect the working file before reviewing again; cancellation may arrive after replacement.');
      this.focus('[role=status][tabindex="-1"]:not(.object-result):not(.attribute-result)');
    } else this.focus('[role=alert]');
  }

  workingStateLabel(state: LfsObjects['files'][number]['workingState']): string {
    const labels: Record<typeof state, string> = {
      missing: 'missing (may be deleted or sparse-excluded)',
      symlink: 'symlink path; target was not inspected',
      nonFile: 'not an ordinary file',
      pointer: 'canonical pointer to this object; not hydrated',
      pointerLike: 'pointer-like content; different, extended or unsupported pointer',
      contentSizeMatches: 'content size matches; bytes are not verified',
      sizeMismatch: 'content size differs from the object',
    };
    return labels[state];
  }

  async confirm(): Promise<void> {
    const target = this.request();
    const rule = this.selected();
    const rules = this.rules();
    if (!target || !rule || !rules || this.unavailable()) return;
    const success = await this.git.untrackLfsPattern(rule.pattern, rules.state, target.repositoryId);
    if (this.request() !== target) return;
    if (success) {
      await this.reload();
      if (this.request() !== target) return;
      this.notice.set('Root tracking rule removed. Review and commit .gitattributes; existing file contents and history were not converted.');
      this.focus('[role=status]');
    } else this.focus('[role=alert]');
  }

  close(): void {
    if (this.git.busy() || this.loading()) return;
    const opener = this.request()?.returnFocus;
    this.closed.emit();
    setTimeout(() => { if (opener?.isConnected) opener.focus(); });
  }

  handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary:not([aria-disabled=true])') ?? [])]
      .filter((element) => element.getClientRects().length);
    if (!controls.length) { event.preventDefault(); return; }
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }

  private focus(selector: string): void {
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>(selector)?.focus());
  }
}
