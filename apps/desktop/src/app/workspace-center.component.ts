import { HostingPanelComponent } from './hosting-panel.component';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { RepositorySnapshot } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { IDENTITY_PROFILES_KEY, parseIdentityProfiles, validIdentityProfile, type IdentityProfile } from './identity-profiles';

export interface WorkspaceCenterRequest { workspaceId: string; panel: 'overview' | 'identities' | 'hosting'; returnFocus: HTMLElement | null }

@Component({
  selector: 'gc-workspace-center',
  imports: [DatePipe, HostingPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close()"><section #dialog role="dialog" aria-modal="true" aria-label="Workspace center" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
      <header><div><h2 id="workspace-center-title">Workspace center</h2><p>{{ git.activeWorkspace().name }}</p></div><button type="button" (click)="close()">Close</button></header>
      <nav aria-label="Workspace center sections"><button type="button" [attr.aria-pressed]="panel() === 'overview'" (click)="panel.set('overview')">Repository overview</button><button type="button" [attr.aria-pressed]="panel() === 'identities'" (click)="panel.set('identities')">Identity profiles</button><button type="button" [attr.aria-pressed]="panel() === 'hosting'" (click)="panel.set('hosting')">Reviews and checks</button></nav>
      @if (panel() === 'overview') {
        <p>Local repository state. Ahead and behind counts use tracking references already fetched.</p>
        <div class="tools"><label>Filter repositories<input #filter type="search" [value]="query()" (input)="query.set($any($event.target).value)" /></label>
          <label><input type="checkbox" [checked]="attentionOnly()" (change)="attentionOnly.set($any($event.target).checked)" />Needs attention</label>
          <button type="button" [disabled]="git.busy() || refreshing() || git.browserPreview() || !git.repositories().length" (click)="refresh()">{{ refreshing() ? 'Refreshing…' : 'Refresh local state' }}</button></div>
        <p role="status">{{ rows().length }} of {{ git.repositories().length }} open repositories shown{{ refreshing() ? ' · reading local repositories' : '' }}</p>
        <div class="repositories" aria-label="Workspace repositories">
          @for (repo of rows(); track repo.id) {
            <article [attr.aria-label]="repo.name"><header><div><h3>{{ git.pathLabel(repo.path) }}</h3><code>{{ repo.path }}</code></div><button type="button" [disabled]="git.busy()" (click)="activate(repo.id)">Open repository</button></header>
              <dl><dt>Checkout</dt><dd>{{ repo.status.branch ?? (repo.headOid ? 'Detached HEAD' : 'Unborn HEAD') }}{{ repo.bare ? ' · bare repository' : '' }}</dd>
              <dt>Working tree</dt><dd>{{ repo.status.staged }} staged · {{ repo.status.unstaged }} unstaged · {{ repo.status.untracked }} untracked · {{ repo.status.conflicted }} conflicts{{ repo.status.entriesTruncated ? ' · file list truncated' : '' }}</dd>
              <dt>Tracking</dt><dd>{{ tracking(repo) }}</dd>
              <dt>Operation</dt><dd>{{ operation(repo) }}</dd></dl>
              @if (refreshes()[repo.id]; as result) {
                @if (result.error) { <p role="alert">Refresh failed: {{ result.error }}. Displaying cached state.</p> }
                @else { <small>Read locally at {{ result.at | date:'mediumTime' }}</small> }
              } @else { <small>Cached state. Refresh to check local changes.</small> }
            </article>
          } @empty { <p>{{ git.repositories().length ? 'No repositories match these filters.' : 'Open a repository in this workspace to see its status.' }}</p> }
        </div>
      } @else if (panel() === 'hosting') {
        <gc-hosting-panel />
      } @else {
        <p>Save reusable commit names and email addresses on this device. Profiles contain no authentication credentials. Applying a profile writes local Git identity settings only for the displayed repository.</p>
        @if (error()) { <p role="alert">{{ error() }}</p> }
        <div class="profile-layout"><div>
          <h3>Saved identities</h3>
          @for (profile of profiles(); track profile.id) {
            <article><strong>{{ profile.label }}</strong><p>{{ profile.name }} &lt;{{ profile.email }}&gt;</p><div class="tools">
              <button type="button" (click)="edit(profile)">Edit {{ profile.label }}</button><button type="button" (click)="remove(profile.id)">Delete {{ profile.label }}</button>
              <button type="button" [disabled]="!git.repository() || git.busy()" (click)="prepareApply(profile)">Use {{ profile.label }}…</button></div></article>
          } @empty { <p>No saved identities.</p> }
        </div><form (submit)="$event.preventDefault(); save()">
          <h3>{{ editingId() ? 'Edit identity profile' : 'New identity profile' }}</h3>
          <label>Profile label<input required maxlength="320" [value]="label()" (input)="label.set($any($event.target).value)" /></label>
          <label>Commit author name<input required maxlength="320" autocomplete="name" [value]="name()" (input)="name.set($any($event.target).value)" /></label>
          <label>Commit author email<input required maxlength="320" [value]="email()" (input)="email.set($any($event.target).value)" /></label>
          @if (draftError()) { <p role="status">{{ draftError() }}</p> }
          <div class="tools"><button type="submit" [disabled]="!!draftError()">Save profile</button><button type="button" (click)="newProfile()">New profile</button>
          <button type="button" [disabled]="!git.repository()" (click)="copyCurrent()">Fill from current repository</button></div>
        </form></div>
        @if (pending(); as apply) {
          <aside aria-label="Confirm repository identity"><h3>Apply {{ apply.profile.label }}?</h3><p>{{ apply.profile.name }} &lt;{{ apply.profile.email }}&gt;</p><p>Repository: <code>{{ apply.path }}</code></p><p>Future commits will use this identity. Local settings are shared by linked worktrees. Existing commits and global Git settings remain unchanged.</p>
          <div class="tools"><button type="button" (click)="pending.set(null)">Cancel identity change</button><button type="button" [disabled]="git.busy()" (click)="applyIdentity()">Apply to this repository</button></div></aside>
        }
        @if (notice()) { <p role="status">{{ notice() }}</p> }
      }
    </section></div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 65; background: #080811b8; display: grid; place-items: center; padding: 18px; }
    section { box-sizing: border-box; width: min(900px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; color: var(--text); background: var(--inspector-list); border: 1px solid var(--inspector-divider); border-radius: 7px; }
    header, nav, .tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; } nav { justify-content: start; margin: 12px 0; }
    h2 { font-size: 18px; margin: 0; } h3 { font-size: 14px; margin: 0 0 8px; } p, dd, dt, label, small, code { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    article, aside, form { border: 1px solid var(--inspector-divider); border-radius: 5px; padding: 14px; margin: 12px 0; } article p { margin: 8px 0; }
    dl { display: grid; grid-template-columns: max-content minmax(0,1fr); gap: 4px 16px; } dd { margin: 0; } label { display: block; } form input, input[type=search] { display: block; box-sizing: border-box; width: 100%; margin: 4px 0 10px; } form label { margin-bottom: 10px; }
    button, input { color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); padding: 7px 10px; min-height: 32px; } input[type=checkbox] { min-height: auto; }
    button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button[aria-pressed=true] { border-color: var(--accent); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } [role=alert] { color: var(--danger); }
    .profile-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .profile-layout > * { min-width: 0; } .tools { justify-content: start; }
    @media(max-width:650px) { .profile-layout { grid-template-columns: 1fr; } dl { grid-template-columns: 1fr; } }
  `],
})
export class WorkspaceCenterComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<WorkspaceCenterRequest>();
  readonly closed = output<void>();
  readonly repositorySelected = output<string>();
  readonly panel = signal<'overview' | 'identities' | 'hosting'>('overview');
  readonly query = signal('');
  readonly attentionOnly = signal(false);
  readonly refreshing = signal(false);
  readonly refreshes = signal<Record<string, { at: number | null; error: string | null }>>({});
  readonly profiles = signal<IdentityProfile[]>([]);
  readonly editingId = signal<string | null>(null);
  readonly label = signal(''); readonly name = signal(''); readonly email = signal('');
  readonly error = signal(''); readonly notice = signal('');
  readonly pending = signal<{ profile: IdentityProfile; repositoryId: string; path: string } | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private destroyed = false;
  readonly draftError = computed(() => {
    if (!validIdentityProfile({ id: this.editingId() ?? 'new', label: this.label().trim(), name: this.name().trim(), email: this.email().trim() })) return 'Enter a label, name and email without control characters.';
    if (this.profiles().some(item => item.id !== this.editingId() && item.label.toLocaleLowerCase() === this.label().trim().toLocaleLowerCase())) return 'Choose a different profile label.';
    if (!this.editingId() && this.profiles().length >= 50) return 'Up to 50 profiles can be saved.';
    return '';
  });
  readonly rows = computed(() => this.git.repositories().filter(repo => {
    const query = this.query().trim().toLocaleLowerCase();
    return (!query || `${repo.name} ${repo.path} ${this.git.pathLabel(repo.path)} ${repo.status.branch ?? ''}`.toLocaleLowerCase().includes(query))
      && (!this.attentionOnly() || this.needsAttention(repo) || !!this.refreshes()[repo.id]?.error);
  }));
  constructor() {
    try { this.profiles.set(parseIdentityProfiles(localStorage.getItem(IDENTITY_PROFILES_KEY))); }
    catch { this.error.set('Saved identities could not be read from device storage.'); }
    effect(() => this.panel.set(this.request().panel));
    effect(() => { if (this.request().workspaceId !== this.git.activeWorkspaceId()) this.close(); });
    effect(() => { const pending = this.pending(); if (pending && (pending.repositoryId !== this.git.activeRepositoryId() || pending.path !== this.git.repository()?.path)) this.pending.set(null); });
    afterNextRender(() => this.focusFirst());
  }
  needsAttention(repo: RepositorySnapshot): boolean { const s = repo.status; return !!(s.staged || s.unstaged || s.untracked || s.conflicted || s.ahead || s.behind || s.mergeInProgress || s.rebaseInProgress || s.historyOperation || s.mailPatchInProgress || s.bisectInProgress); }
  tracking(repo: RepositorySnapshot): string { const branch = repo.branches.find(item => item.current); return branch?.upstream ? `${branch.upstream}: ${repo.status.ahead} ahead · ${repo.status.behind} behind` : 'No upstream configured'; }
  operation(repo: RepositorySnapshot): string { const s = repo.status; return [s.mergeInProgress ? 'Merge' : '', s.rebaseInProgress ? 'Rebase' : '', s.historyOperation ?? '', s.mailPatchInProgress ? 'Mail patch' : '', s.bisectInProgress ? 'Bisect' : ''].filter(Boolean).join(' · ') || 'None'; }
  async refresh(): Promise<void> {
    if (this.refreshing() || this.git.busy()) return;
    this.refreshing.set(true);
    try { const results = await this.git.refreshWorkspaceOverview(); if (!this.destroyed && this.request().workspaceId === this.git.activeWorkspaceId()) this.refreshes.set(results); }
    finally { this.refreshing.set(false); }
  }
  activate(repositoryId: string): void { if (!this.git.busy()) { this.repositorySelected.emit(repositoryId); this.close(false); } }
  private persist(profiles: IdentityProfile[]): boolean {
    try { localStorage.setItem(IDENTITY_PROFILES_KEY, JSON.stringify(profiles)); this.profiles.set(profiles); this.error.set(''); return true; }
    catch { this.notice.set(''); this.error.set('Could not save identities on this device. No saved profiles were changed.'); return false; }
  }
  save(): void {
    if (this.draftError()) return;
    const profile = { id: this.editingId() ?? crypto.randomUUID(), label: this.label().trim(), name: this.name().trim(), email: this.email().trim() };
    if (this.persist([...this.profiles().filter(item => item.id !== profile.id), profile])) { this.editingId.set(profile.id); this.pending.set(null); this.notice.set(`Saved ${profile.label}`); }
  }
  edit(profile: IdentityProfile): void { this.editingId.set(profile.id); this.label.set(profile.label); this.name.set(profile.name); this.email.set(profile.email); this.pending.set(null); this.notice.set(''); }
  newProfile(): void { this.editingId.set(null); this.label.set(''); this.name.set(''); this.email.set(''); this.pending.set(null); this.notice.set(''); }
  copyCurrent(): void { const identity = this.git.repository()?.identity; if (identity) { this.name.set(identity.name ?? ''); this.email.set(identity.email ?? ''); } }
  remove(id: string): void { if (this.persist(this.profiles().filter(item => item.id !== id))) { if (this.editingId() === id) this.newProfile(); this.pending.set(null); this.notice.set('Identity profile deleted. Repository settings were not changed.'); } }
  prepareApply(profile: IdentityProfile): void { const repo = this.git.repository(); if (repo && !this.git.busy()) { this.pending.set({ profile: { ...profile }, repositoryId: repo.id, path: repo.path }); this.error.set(''); this.notice.set(''); } }
  async applyIdentity(): Promise<void> {
    const apply = this.pending();
    if (!apply || this.git.busy() || apply.repositoryId !== this.git.activeRepositoryId() || apply.path !== this.git.repository()?.path) { this.pending.set(null); return; }
    await this.git.setRepositoryIdentity(apply.profile.name, apply.profile.email);
    if (this.destroyed) return;
    if (this.git.error()) this.error.set(this.git.error()!);
    else { this.pending.set(null); this.notice.set(`Applied ${apply.profile.label} to ${apply.path}`); }
  }
  ngOnDestroy(): void { this.destroyed = true; }
  close(restoreFocus = true): void {
    if (this.destroyed) return;
    const opener = this.request().returnFocus; this.closed.emit();
    if (restoreFocus) setTimeout(() => { if (opener?.isConnected && opener.getClientRects().length) opener.focus(); else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus(); });
  }
  private focusFirst(): void { const dialog = this.dialog()?.nativeElement; const target = dialog?.querySelector<HTMLInputElement>('input[type=search]') ?? dialog?.querySelector<HTMLButtonElement>('button'); target?.focus(); }
  @HostListener('document:focusin') containFocus(): void { const dialog = this.dialog()?.nativeElement; if (!this.destroyed && dialog && !dialog.contains(document.activeElement)) this.focusFirst(); }
  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const items = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary') ?? [])].filter(item => item.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    event.stopPropagation();
  }
}
