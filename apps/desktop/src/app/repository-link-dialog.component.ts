import { IncomingLinksDialogComponent } from './incoming-links-dialog.component';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ipc, type RepositoryLink, type RepositoryLinkDiscovery, type RepositoryLinkInspection, type RepositoryLinkTarget, type IncomingRepositoryLink } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { RepositoryDialogComponent, RepositoryFormDrafts } from './repository-dialog.component';

export interface RepositoryLinkDialogRequest {
  mode: 'open' | 'share' | 'inbox';
  rawLink?: string;
  inboxId?: string;
  repoId?: string;
  target?: RepositoryLinkTarget;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-repository-link-dialog',
  imports: [FormsModule, RepositoryDialogComponent, IncomingLinksDialogComponent],
  providers: [RepositoryFormDrafts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cloneReview()) {
      <gc-repository-dialog mode="clone" [cloneOnly]="true" (closed)="cloneReview.set(false)" (opening)="opening.emit()" (opened)="afterClone()" />
    } @else if (inboxView()) {
      <gc-incoming-links-dialog (closed)="close()" (review)="reviewIncoming($event)" />
    } @else {
      <div class="link-backdrop" (click)="close()">
        <section #dialog role="dialog" aria-modal="true" aria-labelledby="repository-link-title" (click)="$event.stopPropagation()" (keydown)="handleKey($event)" [attr.aria-busy]="busy()">
          <header><h2 id="repository-link-title">{{ request().mode === 'share' ? 'Share repository context' : 'Open repository link' }}</h2><button #closeButton type="button" aria-label="Close repository link" (click)="close()">Close</button></header>
          <div class="link-body">
            @if (request().mode === 'share') {
              <p>The link identifies a remote repository and an optional commit or reference. Recipients choose their own local copy.</p>
              <p><strong>{{ source()?.name ?? 'Source repository is closed' }}</strong> · {{ targetLabel() }}</p>
              <label>Remote<select aria-label="Link remote" [ngModel]="remote()" (ngModelChange)="changeRemote($event)"><option value="">Choose a remote</option>@for (entry of source()?.remotes ?? []; track entry.name) { <option [value]="entry.fetchUrl">{{ entry.name }} · {{ entry.fetchUrl }}</option> }</select></label>
              <button type="button" [disabled]="busy() || !remote() || !source()" (click)="generate()">Create share link</button>
              @if (shareUri()) { <label>Share link<textarea aria-label="Share link" readonly [value]="shareUri()"></textarea></label><button type="button" (click)="copy()">Copy share link</button> }
            } @else {
              <p>Find a matching repository among known locations, or choose a local folder. Opening a link does not fetch or checkout.</p>
              <label>Repository link<textarea aria-label="Repository link" spellcheck="false" [ngModel]="raw()" (ngModelChange)="changeRaw($event)"></textarea></label>
              <div class="actions"><button type="button" [disabled]="busy() || !raw().trim()" (click)="discover()">Find local copies</button><button type="button" [disabled]="busy() || !raw().trim()" (click)="chooseLocal()">Choose local copy…</button></div>
              @if (discovery(); as result) {
                <p>Shared target: {{ targetLabel(result.link.target) }}</p>
                <p role="status">{{ result.matches.length }} matching local copies · {{ result.inspectedPaths }} known locations checked</p>
                @for (match of result.matches; track match.path) {
                  <article><strong>{{ match.path }}</strong><small>Matched remotes: {{ match.matchedRemotes.join(', ') }}</small><small>{{ stateLabel(match) }}</small><button type="button" [disabled]="busy()" (click)="openMatch(match)">Open this local copy</button></article>
                }
                @for (issue of result.unavailable; track issue.path) { <p>{{ issue.path }}: {{ issue.message }}</p> }
                <p>Need another copy? Review the remote and destination before downloading.</p><button type="button" [disabled]="busy()" (click)="reviewClone()">Review clone…</button>
              }
            }
            @if (busy()) { <p role="status">{{ pendingLabel() }} <button type="button" (click)="cancel()">Cancel link operation</button></p> }
            @if (error()) { <p role="alert">{{ error() }}</p> }
            @if (notice()) { <p role="status">{{ notice() }}</p> }
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    .link-backdrop{position:fixed;inset:0;z-index:170;display:grid;place-items:center;background:rgb(0 0 0 / .45)}
    section{box-sizing:border-box;width:min(680px,calc(100vw - 24px));max-height:calc(100dvh - 24px);display:flex;flex-direction:column;background:var(--overlay-surface);color:var(--text);border:1px solid var(--overlay-border);border-radius:6px;overflow:hidden;font-size:13px}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--inspector-divider)}h2{margin:0;font-size:16px}.link-body{overflow:auto;padding:16px;display:grid;gap:12px}p{margin:0;line-height:1.6;overflow-wrap:anywhere}label,article{display:grid;gap:8px;min-width:0}article{padding:12px;border:1px solid var(--inspector-divider);overflow-wrap:anywhere}small{color:var(--muted)}
    textarea,select{box-sizing:border-box;width:100%;min-width:0;max-width:100%;background:var(--inspector-row);color:var(--text);border:1px solid var(--inspector-divider);padding:8px;font:inherit}textarea{min-height:90px;resize:vertical;overflow-wrap:anywhere}button{min-height:34px;padding:7px 12px;border:1px solid var(--inspector-divider);background:var(--inspector-row);color:var(--text);font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.actions{display:flex;gap:8px;flex-wrap:wrap}[role=alert]{color:var(--danger)}
  `,
})
export class RepositoryLinkDialogComponent {
  readonly request = input.required<RepositoryLinkDialogRequest>();
  readonly closed = output<void>();
  readonly opening = output<void>();
  readonly opened = output<string | null>();
  protected readonly git = inject(GitKhronosService);
  private readonly form = inject(RepositoryFormDrafts);
  protected readonly source = computed(() => this.git.repositories().find(repo => repo.id === this.request().repoId));
  protected readonly remote = signal('');
  protected readonly raw = signal('');
  protected readonly shareUri = signal('');
  protected readonly discovery = signal<RepositoryLinkDiscovery | null>(null);
  protected readonly busy = signal(false);
  protected readonly pendingLabel = signal('');
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly cloneReview = signal(false);
  protected readonly inboxView = signal(false);
  private currentInboxId: string | null = null;
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private generation = 0;
  private operation: string | null = null;
  private destroyed = false;
  private validatedLink: RepositoryLink | null = null;

  constructor() {
    afterRenderEffect(() => this.closeButton()?.nativeElement.focus());
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.stop(); });
    effect(() => {
      this.request();
      untracked(() => { this.stop(); this.remote.set(''); this.raw.set(this.request().rawLink ?? ''); this.shareUri.set(''); this.discovery.set(null); this.validatedLink = null; this.cloneReview.set(false); this.inboxView.set(this.request().mode === 'inbox'); this.currentInboxId = this.request().inboxId ?? null; });
    });
    effect(() => {
      const source = this.source();
      const request = this.request();
      if (request.mode === 'share') untracked(() => {
        if (!source || !source.remotes.some(entry => entry.fetchUrl === this.remote())) {
          this.stop(); this.remote.set(''); this.shareUri.set('');
        }
      });
    });
  }

  private stop(): void {
    this.generation++;
    const operationId = this.operation;
    this.operation = null;
    this.busy.set(false);
    if (operationId) void ipc.cancel_git_operation({ operationId }).catch(() => {});
  }
  private current(generation: number): boolean { return !this.destroyed && this.generation === generation; }
  private failure(error: unknown): string { return (error as { message?: string })?.message ?? 'The link operation could not be completed.'; }
  protected close(): void {
    this.stop();
    if (this.request().mode === 'inbox' && !this.inboxView()) { this.inboxView.set(true); this.currentInboxId = null; }
    else this.closed.emit();
  }
  protected reviewIncoming(request: IncomingRepositoryLink): void {
    const fresh = this.git.incomingRepositoryLinks().requests.find(entry => entry.id === request.id);
    if (this.git.busy() || fresh?.payload.kind !== 'ready') return;
    this.changeRaw(fresh.payload.uri); this.currentInboxId = fresh.id; this.inboxView.set(false);
  }
  protected cancel(): void { this.stop(); this.error.set('Link operation cancelled.'); }
  protected changeRaw(value: string): void { this.stop(); this.currentInboxId = null; this.raw.set(value); this.discovery.set(null); this.validatedLink = null; this.error.set(''); this.notice.set(''); }
  protected changeRemote(value: string): void { this.stop(); this.remote.set(value); this.shareUri.set(''); this.error.set(''); this.notice.set(''); }
  protected targetLabel(target: RepositoryLinkTarget | undefined = this.request().target): string {
    return target?.kind === 'commit' ? `Commit ${target.oid.slice(0, 12)}` : target?.kind === 'reference' ? target.reference : 'Repository';
  }
  protected async generate(): Promise<void> {
    this.stop(); this.shareUri.set(''); this.error.set(''); this.notice.set('');
    const remote = this.remote();
    if (!this.source()?.remotes.some(entry => entry.fetchUrl === remote)) return;
    const generation = this.generation;
    this.busy.set(true); this.pendingLabel.set('Creating share link…');
    try {
      const uri = await ipc.create_repository_link({ remote, target: this.request().target ?? { kind: 'repository' } });
      if (this.current(generation) && this.source()?.remotes.some(entry => entry.fetchUrl === remote)) this.shareUri.set(uri);
    } catch (error) { if (this.current(generation)) this.error.set(this.failure(error)); }
    finally { if (this.current(generation)) this.busy.set(false); }
  }
  protected async copy(): Promise<void> {
    const uri = this.shareUri();
    if (!uri || !this.source()?.remotes.some(entry => entry.fetchUrl === this.remote())) return;
    const generation = this.generation;
    try { await navigator.clipboard.writeText(uri); if (this.current(generation)) this.notice.set('Share link copied.'); }
    catch { if (this.current(generation)) this.error.set('Clipboard unavailable. Select and copy the share link above.'); }
  }
  private knownPaths(): string[] {
    return [...new Set([
      ...this.git.repositories().map(repo => repo.path), ...this.git.favoritePaths(),
      ...this.git.recentPaths(), ...this.git.workspaces().flatMap(workspace => workspace.repositoryPaths),
    ])].slice(0, 32);
  }
  protected async discover(paths = this.knownPaths()): Promise<void> {
    this.stop(); this.discovery.set(null); this.validatedLink = null; this.error.set(''); this.notice.set('');
    const generation = this.generation;
    const operationId = `repository-link-${crypto.randomUUID()}`;
    this.operation = operationId; this.busy.set(true); this.pendingLabel.set('Checking local copies…');
    try {
      const result = await ipc.discover_repository_link({ rawLink: this.raw().trim(), knownPaths: paths, operationId });
      if (this.current(generation)) { this.discovery.set(result); this.validatedLink = result.link; }
    } catch (error) { if (this.current(generation)) this.error.set(this.failure(error)); }
    finally { if (this.current(generation)) { this.operation = null; this.busy.set(false); } }
  }
  protected async chooseLocal(): Promise<void> {
    const generation = this.generation;
    const path = await this.git.chooseDirectory('Choose a local repository for this link');
    if (path && this.current(generation)) await this.discover([path]);
  }
  protected stateLabel(match: RepositoryLinkInspection): string {
    return match.target.kind === 'commit' ? `Local commit ${match.target.oid}` : match.target.kind === 'unavailable' ? match.target.message : 'Repository context';
  }
  protected async openMatch(match: RepositoryLinkInspection): Promise<void> {
    if (this.busy()) return;
    this.stop(); this.error.set(''); this.notice.set('');
    const generation = this.generation;
    const activeId = this.git.activeRepositoryId();
    const inboxId = this.currentInboxId;
    const operationId = `repository-link-${crypto.randomUUID()}`;
    this.operation = operationId; this.busy.set(true); this.pendingLabel.set('Opening local context…');
    this.opening.emit();
    try {
      const opened = await ipc.open_repository_link({ rawLink: this.raw().trim(), path: match.path,
        expectedOid: match.target.kind === 'commit' ? match.target.oid : null, operationId });
      if (!this.current(generation)) return;
      if (activeId !== this.git.activeRepositoryId()) { this.error.set('The active repository changed. Review the local copy again.'); return; }
      this.git.acceptRepositoryLink(opened);
      this.opened.emit(opened.inspection.target.kind === 'commit' ? opened.inspection.target.oid : null);
      if (opened.inspection.target.kind === 'unavailable') {
        this.error.set(opened.inspection.target.message);
        this.notice.set('The local repository is open. The shared target is retained here; no fetch or checkout was requested.');
      } else if (inboxId) {
        await this.git.acknowledgeIncomingRepositoryLink(inboxId);
        if (this.current(generation)) {
          if (this.request().mode === 'inbox') { this.inboxView.set(true); this.currentInboxId = null; }
          else this.closed.emit();
        }
      } else this.closed.emit();
    } catch (error) { if (this.current(generation)) this.error.set(this.failure(error)); }
    finally {
      await this.git.refreshRepositoryLinkPolicies();
      if (this.current(generation)) { this.operation = null; this.busy.set(false); }
    }
  }
  protected reviewClone(): void {
    const link = this.validatedLink;
    if (!link || this.busy()) return;
    this.form.cloneRemote.set(link.remote);
    const folder = link.remote.split(/[/:]/).at(-1)?.replace(/\.git$/i, '') ?? '';
    this.form.cloneFolder.set(/^[\w.-]+$/.test(folder) && folder !== '.' && folder !== '..' ? folder : 'repository');
    this.cloneReview.set(true);
  }
  protected async afterClone(): Promise<void> {
    this.cloneReview.set(false);
    const repository = this.git.repository();
    if (repository) await this.discover([repository.path]);
    this.notice.set('Clone complete. Review its matching local context before opening the shared target.');
  }
  protected handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(element => element.getClientRects().length > 0);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0]?.focus(); }
  }
}
