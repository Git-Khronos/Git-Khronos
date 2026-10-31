import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterRenderEffect, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { ipc, type HostedCloneTransport, type HostedForkInspection, type HostedForkRemoteReceipt, type PreparedHostedForkRemote } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

@Component({
  selector: 'gc-hosted-fork-remote',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section #panel aria-label="Local fork remote" tabindex="-1">
      <h3>Add a local fork remote</h3>
      <p>Keep the source remote and add a separately reviewed name and URL for this fork.</p>
      @if (error()) { <p #feedback role="alert" tabindex="-1">{{ error() }}</p> }
      @if (notice()) { <p role="status" aria-atomic="true">{{ notice() }}</p> }
      @if (busy()) { <div class="actions"><span role="status">{{ progress() }}</span><button type="button" [disabled]="cancelling()" (click)="cancel()">{{ cancelling() ? 'Stopping…' : 'Cancel remote attachment' }}</button></div> }
      @if (repository(); as repository) {
        <p><strong>Local repository: {{ repository.name }}</strong><code>{{ repository.path }}</code></p>
        @if (fork(); as fork) {
          <p>Source: {{ fork.source.fullName }} · fork: {{ fork.repository.fullName }} · account: {{ fork.account.login }}</p>
          <fieldset [disabled]="unavailable()"><legend>Local remote options</legend>
            <label for="fork-source-remote">Source remote to preserve<select id="fork-source-remote" [value]="sourceRemote()" (change)="sourceRemote.set($any($event.target).value); invalidate()"><option value="" [selected]="!sourceRemote()">Choose a source remote</option>@for (remote of repository.remotes; track remote.name) { <option [value]="remote.name" [selected]="remote.name === sourceRemote()">{{ remote.name }}</option> }</select></label>
            <p>Choose the existing remote for {{ fork.source.fullName }}. Its configuration and branch upstreams stay as they are.</p>
            <label for="fork-remote-name">New remote name<input id="fork-remote-name" maxlength="128" autocomplete="off" [value]="remoteName()" (input)="remoteName.set($any($event.target).value); invalidate()" /></label>
            @if (collision()) { <p>That name is already configured. Choose a new name to preserve the existing remote.</p> }
            <label for="fork-remote-transport">Remote transport<select id="fork-remote-transport" [value]="transport()" (change)="transport.set($any($event.target).value); invalidate()"><option value="https" [disabled]="!fork.repository.cloneHttps">HTTPS</option><option value="ssh" [disabled]="!fork.repository.cloneSsh">SSH</option></select></label>
            <code>{{ selectedUrl() }}</code>
            <p>Git uses your configured credentials or SSH agent. This account check does not change your Git credentials.</p>
            <button type="button" [disabled]="!ready()" (click)="prepare()">Review local remote</button>
          </fieldset>
        }
      } @else { <p>Open a local repository before attaching a fork remote. A fork can still be cloned separately.</p> }
      @if (preview(); as review) {
        <section #reviewPanel class="review" aria-label="Review local fork remote" tabindex="-1"><h3>Review local configuration</h3>
          <dl><dt>Local repository</dt><dd><code>{{ review.plan.repositoryPath }}</code></dd><dt>Account</dt><dd>{{ review.plan.account.login }} on {{ review.plan.account.host }}</dd><dt>Source remote</dt><dd>{{ review.plan.sourceRemote }} · {{ review.plan.source.fullName }}</dd><dt>Fork and network</dt><dd>{{ review.plan.fork.fullName }} · {{ review.plan.network.fullName }}</dd><dt>New remote</dt><dd>{{ review.plan.remoteName }} · {{ review.plan.transport }}<code>{{ review.plan.url }}</code></dd><dt>Fetch mapping</dt><dd><code>{{ review.plan.fetchRefspec }}</code></dd><dt>Existing remote names</dt><dd>{{ review.plan.existingRemoteNames.join(', ') || 'None' }}</dd></dl>
          <p>Adds a URL and fetch mapping only. It does not fetch, push, clone, rename or remove remotes, or change branch tracking. Changed configuration or a name collision requires a fresh review.</p>
          <div class="actions"><button type="button" [disabled]="unavailable()" (click)="apply()">Add reviewed remote</button><button type="button" [disabled]="busy()" (click)="invalidate()">Discard remote review</button></div>
        </section>
      }
      @if (confirmed(); as confirmed) {
        <section #outcome class="outcome" aria-label="Confirmed local remote" tabindex="-1"><h3>Remote added</h3><p>{{ confirmed.receipt.remoteName }} was added to {{ confirmed.name }}.</p><code>{{ confirmed.path }}</code><code>{{ confirmed.receipt.url }}</code><p>The source remote {{ confirmed.receipt.sourceRemote }} was preserved. No fetch or push was requested.</p></section>
      }
      <button type="button" (click)="closed.emit()">Close local remote controls</button>
    </section>
  `,
  styles: [`
    :host{display:block;min-width:0}section,fieldset{min-width:0}h3{font-size:14px;margin:12px 0 8px}p,label,dt,dd{font-size:13px;line-height:1.5;overflow-wrap:anywhere}p{margin:8px 0}fieldset,.review,.outcome{border:1px solid var(--inspector-divider);padding:12px;margin:14px 0}.review{border-color:var(--accent)}label{display:block;margin:10px 0}input,select{display:block;width:100%;box-sizing:border-box;min-width:0;margin-top:5px}button,input,select{font:inherit;font-size:13px;min-height:34px;padding:8px 10px;color:var(--text);background:var(--inspector-row);border:1px solid var(--inspector-divider)}button{cursor:pointer;white-space:normal;overflow-wrap:anywhere}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}code{display:block;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}dd{margin:4px 0 10px}[role=alert]{color:var(--danger)}button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  `],
})
export class HostedForkRemoteComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly fork = input<HostedForkInspection | null>(null);
  readonly disabled = input(false);
  readonly busyChange = output<boolean>();
  readonly closed = output<void>();
  readonly repository = this.git.repository;
  readonly sourceRemote = signal('');
  readonly remoteName = signal('fork');
  readonly transport = signal<HostedCloneTransport>('https');
  readonly preview = signal<PreparedHostedForkRemote | null>(null);
  readonly confirmed = signal<{ receipt: HostedForkRemoteReceipt; name: string; path: string } | null>(null);
  readonly busy = signal(false);
  readonly cancelling = signal(false);
  readonly progress = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly unavailable = computed(() => this.disabled() || this.busy() || this.git.busy() || this.git.browserPreview());
  readonly selectedUrl = computed(() => this.transport() === 'https' ? this.fork()?.repository.cloneHttps : this.fork()?.repository.cloneSsh);
  readonly collision = computed(() => !!this.repository()?.remotes.some(remote => remote.name === this.remoteName().trim()));
  readonly ready = computed(() => !this.unavailable() && !!this.repository()?.remotes.some(remote => remote.name === this.sourceRemote()) && !!this.fork() && !!this.selectedUrl() && !!this.remoteName().trim() && !this.collision());
  private readonly contextId = crypto.randomUUID();
  private readonly contextKey = computed(() => JSON.stringify([this.repository()?.id, this.repository()?.path, this.repository()?.remotes, this.fork()]));
  private readonly binding = computed(() => JSON.stringify([this.contextKey(), this.sourceRemote(), this.remoteName(), this.transport()]));
  private observedContext = '';
  private previewBinding = '';
  private operation: { id: string; cancelled: boolean; mutation: boolean; result: boolean } | null = null;
  private destroyed = false;
  private readonly focusTarget = signal<'initial' | 'review' | 'outcome' | 'error' | null>('initial');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly reviewPanel = viewChild<ElementRef<HTMLElement>>('reviewPanel');
  private readonly outcome = viewChild<ElementRef<HTMLElement>>('outcome');
  private readonly feedback = viewChild<ElementRef<HTMLElement>>('feedback');
  private readonly focus = afterRenderEffect(() => {
    const target = this.focusTarget(); const element = target === 'initial' ? this.panel() : target === 'review' ? this.reviewPanel() : target === 'outcome' ? this.outcome() : target === 'error' ? this.feedback() : null;
    if (element) { element.nativeElement.focus(); this.focusTarget.set(null); }
  });
  constructor() {
    effect(() => {
      const key = this.contextKey(); if (key === this.observedContext) return;
      this.observedContext = key; this.invalidate();
      const repository = this.repository(); const source = this.fork()?.source.fullName;
      if (!repository?.remotes.some(remote => remote.name === this.sourceRemote())) {
        const matches = repository?.remotes.filter(remote => source && [
          `https://github.com/${source}`, `git@github.com:${source}`, `ssh://git@github.com/${source}`,
        ].includes(remote.fetchUrl.replace(/\.git$/, ''))) ?? [];
        this.sourceRemote.set(matches.length === 1 ? matches[0].name : '');
      }
      if (!this.selectedUrl()) this.transport.set(this.fork()?.repository.cloneHttps ? 'https' : 'ssh');
      if (this.operation && !this.operation.result) void this.cancel();
    });
  }
  invalidate(): void {
    const review = this.preview(); this.preview.set(null);
    if (review) void ipc.discard_hosted_fork_remote({ repoId: this.previewRepoId, contextId: this.contextId, token: review.token }).catch(() => undefined);
  }
  private previewRepoId = '';
  private current(id: string): boolean { return !this.destroyed && this.operation?.id === id && !this.operation.cancelled; }
  private alive(id: string): boolean { return !this.destroyed && this.operation?.id === id; }
  async prepare(): Promise<void> {
    const repository = this.repository(); const fork = this.fork(); if (!repository || !fork || !this.ready()) return;
    this.invalidate(); this.confirmed.set(null); const binding = this.binding();
    await this.perform('Checking fork and local configuration…', async id => {
      const prepared = await ipc.prepare_hosted_fork_remote({ repoId: repository.id, contextId: this.contextId, operationId: id, request: {
        sourceRemote: this.sourceRemote(), remoteName: this.remoteName().trim(), transport: this.transport(), selection: { sourceFullName: fork.source.fullName, sourceRepositoryId: fork.source.id, accountId: fork.account.id, forkFullName: fork.repository.fullName, forkRepositoryId: fork.repository.id, forkOwnerId: fork.repository.ownerId },
      } });
      if (!this.current(id) || binding !== this.binding()) { await ipc.discard_hosted_fork_remote({ repoId: repository.id, contextId: this.contextId, token: prepared.token }); return; }
      if (prepared.plan.account.id !== fork.account.id || prepared.plan.fork.id !== fork.repository.id || prepared.plan.forkOwnerId !== fork.repository.ownerId || prepared.plan.source.id !== fork.source.id || prepared.plan.network.id !== fork.network.id || prepared.plan.repositoryPath !== repository.path) {
        await ipc.discard_hosted_fork_remote({ repoId: repository.id, contextId: this.contextId, token: prepared.token }); throw Error('The fork or local repository identity changed. Inspect it again before attaching a remote.');
      }
      this.previewRepoId = repository.id; this.previewBinding = binding; this.preview.set(prepared); this.focusTarget.set('review');
    });
  }
  async apply(): Promise<void> {
    const repository = this.repository(); const review = this.preview(); if (!repository || !review || this.unavailable()) return;
    if (this.previewBinding !== this.binding() || this.previewRepoId !== repository.id) { this.invalidate(); this.error.set('The local attachment options changed. Review them again.'); this.focusTarget.set('error'); return; }
    this.preview.set(null);
    await this.perform('Adding the reviewed local remote…', async id => {
      const delivered: { receipt: HostedForkRemoteReceipt | null } = { receipt: null };
      await this.git.run('Adding reviewed fork remote…', async report => {
        delivered.receipt = await ipc.execute_hosted_fork_remote({ repoId: repository.id, contextId: this.contextId, token: review.token, operationId: id });
        report(`Added remote ${delivered.receipt.remoteName}`);
      }, repository.id, id, false);
      if (!delivered.receipt) throw Error(this.git.error() ?? 'The attachment stopped. Inspect the local remotes before another review.');
      const receipt = delivered.receipt;
      if (!this.alive(id)) return;
      this.operation!.result = true; this.confirmed.set({ receipt, name: repository.name, path: repository.path }); this.notice.set('The local remote was added.'); this.focusTarget.set('outcome');
      const refreshed = await this.git.refreshRepositoryInBackground(repository.id);
      if (this.alive(id) && !refreshed) this.notice.set('The remote was added, but the repository view could not be refreshed. Reload it to inspect the current remotes.');
    }, true);
  }
  private async perform(label: string, work: (id: string) => Promise<void>, mutation = false): Promise<void> {
    if (this.unavailable() || this.destroyed) return;
    const operation = { id: crypto.randomUUID(), cancelled: false, mutation, result: false }; this.operation = operation;
    this.busy.set(true); this.busyChange.emit(true); this.cancelling.set(false); this.error.set(''); this.notice.set(''); this.progress.set(label);
    try { await work(operation.id); }
    catch (reason: unknown) { if (this.alive(operation.id)) { const error = reason as { message?: string; hint?: string }; this.error.set(error?.message ? `${error.message}${error.hint ? ' ' + error.hint : ''}` : String(reason)); this.focusTarget.set('error'); } }
    finally {
      if (!this.destroyed && operation.cancelled && !operation.result && !this.error()) this.notice.set(operation.mutation ? 'Attachment stopped. Inspect the current local remotes before another review.' : 'Remote review canceled.');
      if (this.operation === operation) this.operation = null;
      this.busy.set(false); if (!this.destroyed) this.busyChange.emit(false); this.cancelling.set(false);
    }
  }
  async cancel(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return;
    operation.cancelled = true; this.cancelling.set(true);
    try {
      for (let attempt = 0; attempt < 3 && this.operation === operation; attempt++) { if (await ipc.cancel_git_operation({ operationId: operation.id })) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      if (this.alive(operation.id)) { this.error.set('Cancellation was not acknowledged. Wait for the result or try cancellation again.'); this.cancelling.set(false); }
    } catch { if (this.alive(operation.id)) { this.error.set('Cancellation could not be confirmed. Inspect the local remotes before another review.'); this.cancelling.set(false); } }
  }
  mutationInFlight(): boolean { return this.busy() && !!this.operation?.mutation; }
  dismiss(): void {
    if (this.destroyed) return; this.destroyed = true; this.invalidate();
    if (this.operation) void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined);
    this.busyChange.emit(false);
  }
  ngOnDestroy(): void { this.dismiss(); }
}
