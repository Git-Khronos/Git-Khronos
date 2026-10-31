import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterRenderEffect, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { ipc, type HostedForkInspection, type HostedForkPage, type HostedForkStatus, type HostedRepository, type HostedRepositoryInspection, type PreparedForkAcknowledgement, type PreparedHostedFork } from '@git-khronos/contracts';

@Component({
  selector: 'gc-hosted-forks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Forks and saved requests">
      <h3>Forks and saved requests</h3>
      <p>Create a repository fork with a separate provider review, or inspect an existing fork before choosing it for cloning.</p>
      @if (error()) { <p #feedback role="alert" tabindex="-1">{{ error() }}</p> }
      @if (notice()) { <p role="status" aria-atomic="true">{{ notice() }}</p> }
      @if (busy()) { <div class="actions"><span role="status">{{ progress() }}</span><button type="button" [disabled]="cancelling()" (click)="cancel()">{{ cancelling() ? 'Stopping…' : 'Cancel fork request' }}</button></div> }
      @if (source(); as selected) {
        <p><strong>Source: {{ selected.repository.fullName }}</strong><br />Account: {{ selected.account.login }} on {{ selected.account.host }}</p>
        <button type="button" [disabled]="unavailable()" (click)="loadForks(1)">Find existing forks</button>
        @if (forkPage(); as page) {
          <p>Page {{ page.query.page }} · {{ page.entries.length }} candidates · network {{ page.network.fullName }}. Inspect a candidate to verify its owner and ancestry.</p>
          <ul aria-label="Fork candidates">@for (fork of page.entries; track fork.id) {
            <li><span>{{ fork.fullName }}</span><button type="button" [disabled]="unavailable()" (click)="inspectCandidate(fork)">Inspect {{ fork.fullName }}</button></li>
          } @empty { <li>No candidates returned on this page. This does not establish that no fork exists.</li> }</ul>
          <nav aria-label="Fork candidate pages"><button type="button" [disabled]="unavailable() || page.query.page <= 1" (click)="loadForks(page.query.page - 1)">Previous fork page</button><button type="button" [disabled]="unavailable() || !page.nextPage" (click)="loadForks(page.nextPage!)">Next fork page</button></nav>
        }
        <fieldset [disabled]="unavailable()"><legend>Create a fork</legend>
          <p>Forking policy: {{ selected.repository.forkingAllowed === false ? 'Not allowed by the source' : selected.repository.forkingAllowed === true ? 'Allowed by the source' : 'Not reported; the provider will check access' }}.</p>
          <label class="check"><input type="checkbox" [checked]="organization()" (change)="organization.set($any($event.target).checked); invalidate()" />Use an organization destination</label>
          @if (organization()) { <label for="fork-owner">Destination organization<input id="fork-owner" maxlength="100" [value]="owner()" (input)="owner.set($any($event.target).value); invalidate()" autocomplete="off" /></label> }
          @else { <p>Personal destination: {{ selected.account.login }}</p> }
          <label for="fork-name">Fork repository name<input id="fork-name" maxlength="100" [value]="name()" (input)="name.set($any($event.target).value); invalidate()" autocomplete="off" /></label>
          <label class="check"><input type="checkbox" [checked]="defaultBranchOnly()" (change)="defaultBranchOnly.set($any($event.target).checked); invalidate()" />Copy only the default branch</label>
          <button type="button" [disabled]="!ready()" (click)="prepare()">Review fork creation</button>
        </fieldset>
      } @else { <p>Select a repository in the catalogue to find or create forks. Saved requests can be loaded independently.</p> }
      @if (preview(); as preview) {
        <section #creationReview class="review" aria-label="Review fork creation" tabindex="-1"><h3>Review provider request</h3>
          <dl><dt>Acting account</dt><dd>{{ preview.plan.intent.account.login }} on {{ preview.plan.intent.account.host }}</dd><dt>Source</dt><dd>{{ preview.plan.intent.source.fullName }}</dd><dt>Destination</dt><dd>{{ preview.plan.intent.destination.login }}/{{ preview.plan.intent.name }} · {{ preview.plan.intent.destination.kind }}</dd><dt>Branches</dt><dd>{{ preview.plan.intent.defaultBranchOnly ? 'Default branch only' : 'All branches' }}</dd></dl>
          <p>This submits a provider request. An accepted reply does not mean Git objects are ready. A stopped or interrupted request may still complete; its saved outcome must be checked before another submission. No local remote, clone, fetch or push is included.</p>
          <div class="actions"><button type="button" [disabled]="unavailable()" (click)="apply()">Submit reviewed fork request</button><button type="button" [disabled]="busy()" (click)="invalidate()">Discard fork review</button></div>
        </section>
      }
      <div class="actions"><button type="button" [disabled]="unavailable()" (click)="loadSaved()">Load saved fork requests</button></div>
      @if (savedLoaded()) {
        <ul aria-label="Saved fork requests">@for (record of records(); track record.id) {
          <li><span>{{ record.intent.destination.login }}/{{ record.intent.name }}<small>{{ record.intent.account.login }} · source {{ record.intent.source.fullName }} · {{ phase(record) }}</small></span><button type="button" [disabled]="unavailable()" (click)="inspectSaved(record.id)">Inspect saved {{ record.intent.destination.login }}/{{ record.intent.name }}</button></li>
        } @empty { <li>No active saved fork requests. Archived outcomes are retained separately.</li> }</ul>
      }
      @if (record(); as record) {
        <section #outcome class="outcome" aria-label="Saved fork outcome" tabindex="-1"><h3>{{ phase(record) }}</h3>
          <p><strong>{{ record.intent.destination.login }}/{{ record.intent.name }}</strong><br />Source: {{ record.intent.source.fullName }} · acting account: {{ record.intent.account.login }}</p>
          @if (record.notice) { <p>{{ record.notice }}</p> }
          <p>{{ record.serverReplyReceived ? 'The provider replied to the submission.' : 'A provider reply was not confirmed; this is not evidence that no fork was created.' }}</p>
          <div class="actions"><button type="button" [disabled]="unavailable()" (click)="reconcile(record.id)">Check fork status</button>
            @if (record.phase === 'ready' && record.repository) { <button type="button" [disabled]="unavailable()" (click)="inspectReady(record)">Inspect fork for cloning</button> }
            <button type="button" [disabled]="unavailable()" (click)="prepareAcknowledgement(record.id)">Review archiving this outcome</button></div>
        </section>
      }
      @if (acknowledgement(); as review) {
        <section #archiveReview class="review" aria-label="Review fork outcome archive" tabindex="-1"><h3>{{ review.unresolved ? 'Review unresolved outcome' : 'Review verified outcome' }}</h3>
          <p>{{ review.status.intent.destination.login }}/{{ review.status.intent.name }} · {{ review.status.intent.account.login }} · {{ phase(review.status) }}</p>
          <p>The original outcome is retained. Archiving does not cancel the provider request or delete a fork.</p>
          @if (review.unresolved) { <p>The request may still complete. Inspect the provider before preparing another submission.</p><label class="check"><input type="checkbox" [checked]="understood()" (change)="understood.set($any($event.target).checked)" [disabled]="unavailable()" />I reviewed the unresolved outcome and understand it may still complete</label> }
          <div class="actions"><button type="button" [disabled]="unavailable() || (review.unresolved && !understood())" (click)="applyAcknowledgement()">Archive reviewed outcome</button><button type="button" [disabled]="busy()" (click)="invalidate()">Discard archive review</button></div>
        </section>
      }
      @if (checked(); as checked) {
        <section #forkInspection class="inspection" aria-label="Verified fork for cloning" tabindex="-1"><h3>{{ checked.repository.fullName }}</h3><p>Owner and network {{ checked.network.fullName }} verified for {{ checked.account.login }}. Cloning requires a separate destination and transport review.</p>
          <button type="button" [disabled]="unavailable()" (click)="chooseChecked()">Use this fork for cloning</button>
        </section>
      }
    </section>
  `,
  styles: [`
    :host{display:block;min-width:0;border-top:1px solid var(--inspector-divider);margin:16px 0}section,fieldset{min-width:0}h3{font-size:14px;margin:14px 0 8px}p,label,li,dt,dd,small{font-size:13px;line-height:1.5;overflow-wrap:anywhere}p{margin:8px 0}fieldset,.review,.outcome,.inspection{border:1px solid var(--inspector-divider);padding:12px;margin:14px 0}.review{border-color:var(--accent)}label{display:block;margin:10px 0}input:not([type=checkbox]){display:block;width:100%;min-width:0;box-sizing:border-box;margin-top:5px}button,input{font:inherit;font-size:13px;color:var(--text);background:var(--inspector-row);border:1px solid var(--inspector-divider);padding:8px 10px;min-height:34px}button{cursor:pointer;white-space:normal;overflow-wrap:anywhere}button:disabled{opacity:.5;cursor:default}.actions,nav{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}.check{display:flex;gap:8px;align-items:flex-start}.check input{width:16px;height:16px;min-height:0;flex:0 0 16px;padding:0;margin:4px 0 0;accent-color:var(--accent)}ul{list-style:none;padding:0;max-height:260px;overflow:auto}li{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid var(--inspector-divider);padding:10px 0}li>span{min-width:0}small{display:block}dd{margin:4px 0 10px}[role=alert]{color:var(--danger)}button:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media(max-width:560px){li{align-items:flex-start;flex-direction:column}}
  `],
})
export class HostedForksComponent implements OnDestroy {
  readonly source = input<HostedRepositoryInspection | null>(null);
  readonly disabled = input(false);
  readonly busyChange = output<boolean>();
  readonly cloneRequested = output<HostedRepositoryInspection>();
  readonly organization = signal(false);
  readonly owner = signal('');
  readonly name = signal('');
  readonly defaultBranchOnly = signal(true);
  readonly forkPage = signal<HostedForkPage | null>(null);
  readonly checked = signal<HostedForkInspection | null>(null);
  readonly preview = signal<PreparedHostedFork | null>(null);
  readonly acknowledgement = signal<PreparedForkAcknowledgement | null>(null);
  readonly understood = signal(false);
  readonly records = signal<HostedForkStatus[]>([]);
  readonly savedLoaded = signal(false);
  readonly record = signal<HostedForkStatus | null>(null);
  readonly busy = signal(false);
  readonly cancelling = signal(false);
  readonly progress = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly unavailable = computed(() => this.disabled() || this.busy());
  readonly ready = computed(() => !!this.source() && this.source()?.repository.forkingAllowed !== false && !!this.name().trim() && (!this.organization() || !!this.owner().trim()));
  private readonly binding = computed(() => JSON.stringify([this.source(), this.organization(), this.owner(), this.name(), this.defaultBranchOnly()]));
  private readonly contextId = crypto.randomUUID();
  private previewBinding = '';
  private operation: { id: string; cancelled: boolean; mutation: boolean; result: boolean } | null = null;
  private destroyed = false;
  private autoName = '';
  private sourceKey = '';
  private readonly focusTarget = signal<'create' | 'archive' | 'outcome' | 'error' | 'fork' | null>(null);
  private readonly creationReview = viewChild<ElementRef<HTMLElement>>('creationReview');
  private readonly archiveReview = viewChild<ElementRef<HTMLElement>>('archiveReview');
  private readonly outcome = viewChild<ElementRef<HTMLElement>>('outcome');
  private readonly feedback = viewChild<ElementRef<HTMLElement>>('feedback');
  private readonly forkInspection = viewChild<ElementRef<HTMLElement>>('forkInspection');
  private readonly focus = afterRenderEffect(() => {
    const target = this.focusTarget();
    const element = target === 'create' ? this.creationReview() : target === 'archive' ? this.archiveReview() : target === 'outcome' ? this.outcome() : target === 'error' ? this.feedback() : target === 'fork' ? this.forkInspection() : null;
    if (element) { element.nativeElement.focus(); this.focusTarget.set(null); }
  });

  constructor() {
    effect(() => {
      const source = this.source(); const key = JSON.stringify([source?.account, source?.repository.id, source?.repository.fullName, source?.repository.forkingAllowed]);
      if (key === this.sourceKey) return;
      this.sourceKey = key; this.invalidate(); this.forkPage.set(null); this.checked.set(null);
      if (!this.name() || this.name() === this.autoName) this.name.set(source?.repository.name ?? '');
      this.autoName = source?.repository.name ?? '';
      if (this.operation) void this.cancel();
    });
  }
  phase(record: HostedForkStatus): string {
    return ({ awaitingConfirmation: 'Awaiting provider confirmation', acceptedPending: 'Accepted; verification pending', metadataAvailable: 'Repository metadata verified; Git objects pending', ready: 'Fork verified and ready for use', conflict: 'Fork identity or access conflict' })[record.phase];
  }
  invalidate(): void {
    const tokens = [this.preview()?.token, this.acknowledgement()?.token]; this.preview.set(null); this.acknowledgement.set(null); this.understood.set(false);
    for (const token of tokens) if (token) void ipc.discard_hosted_fork_review({ contextId: this.contextId, token }).catch(() => undefined);
  }
  private current(id: string): boolean { return !this.destroyed && this.operation?.id === id && !this.operation.cancelled; }
  private alive(id: string): boolean { return !this.destroyed && this.operation?.id === id; }
  private showRecord(record: HostedForkStatus): void {
    this.record.set(record); this.records.update(rows => [record, ...rows.filter(row => row.id !== record.id)]); this.savedLoaded.set(true);
    if (this.operation) this.operation.result = true;
    this.notice.set(this.phase(record)); this.focusTarget.set('outcome');
  }
  async loadForks(page: number): Promise<void> {
    const source = this.source(); if (!source || this.unavailable()) return;
    this.invalidate(); this.checked.set(null); const binding = this.sourceKey;
    await this.perform('Loading fork candidates…', async id => {
      const result = await ipc.load_hosted_forks({ query: { sourceFullName: source.repository.fullName, sourceRepositoryId: source.repository.id, accountId: source.account.id, page }, operationId: id });
      if (!this.current(id) || binding !== this.sourceKey) return;
      if (result.account.id !== source.account.id || result.source.id !== source.repository.id || result.source.fullName !== source.repository.fullName) throw Error('The fork account or source changed. Reload the repository catalogue.');
      this.forkPage.set(result);
    });
  }
  async inspectCandidate(fork: HostedRepository): Promise<void> {
    const source = this.source(); if (!source || this.unavailable()) return;
    await this.inspect(source.repository.fullName, source.repository.id, source.account.id, fork.fullName, fork.id, fork.ownerId);
  }
  async inspectReady(record: HostedForkStatus): Promise<void> {
    const fork = record.repository; if (!fork || record.phase !== 'ready' || this.unavailable()) return;
    await this.inspect(record.intent.source.fullName, record.intent.source.id, record.intent.account.id, fork.fullName, fork.id, fork.ownerId);
  }
  private async inspect(sourceFullName: string, sourceRepositoryId: string, accountId: string, forkFullName: string, forkRepositoryId: string, forkOwnerId: string): Promise<void> {
    this.invalidate(); this.checked.set(null);
    await this.perform('Verifying fork identity and network…', async id => {
      const checked = await ipc.inspect_hosted_fork({ selection: { sourceFullName, sourceRepositoryId, accountId, forkFullName, forkRepositoryId, forkOwnerId }, operationId: id });
      if (!this.current(id)) return;
      if (checked.account.id !== accountId || checked.source.id !== sourceRepositoryId || checked.source.fullName !== sourceFullName || checked.repository.id !== forkRepositoryId || checked.repository.fullName !== forkFullName || checked.repository.ownerId !== forkOwnerId) throw Error('The inspected fork identity changed. Reload and inspect it again.');
      this.checked.set(checked); this.focusTarget.set('fork');
    });
  }
  chooseChecked(): void { const checked = this.checked(); if (checked && !this.unavailable()) this.cloneRequested.emit({ account: checked.account, repository: checked.repository }); }
  async prepare(): Promise<void> {
    const source = this.source(); if (!source || !this.ready() || this.unavailable()) return;
    this.invalidate(); const binding = this.binding();
    await this.perform('Preparing fork creation review…', async id => {
      const preview = await ipc.prepare_hosted_fork({ contextId: this.contextId, operationId: id, request: { sourceFullName: source.repository.fullName, sourceRepositoryId: source.repository.id, accountId: source.account.id, destinationOwner: this.organization() ? this.owner().trim() : source.account.login, name: this.name().trim(), defaultBranchOnly: this.defaultBranchOnly() } });
      if (!this.current(id) || binding !== this.binding()) { await ipc.discard_hosted_fork_review({ contextId: this.contextId, token: preview.token }); return; }
      this.previewBinding = binding; this.preview.set(preview); this.focusTarget.set('create');
    });
  }
  async apply(): Promise<void> {
    const preview = this.preview(); if (!preview || this.unavailable()) return;
    if (this.previewBinding !== this.binding()) { this.invalidate(); this.error.set('Fork options changed. Review a fresh request.'); return; }
    this.preview.set(null);
    await this.perform('Submitting reviewed fork request…', async id => { const record = await ipc.execute_hosted_fork({ contextId: this.contextId, token: preview.token, operationId: id }); if (this.alive(id)) this.showRecord(record); }, true);
  }
  async loadSaved(): Promise<void> {
    await this.perform('Loading saved fork outcomes…', async id => { const rows = await ipc.list_hosted_fork_requests({ operationId: id }); if (this.current(id)) { this.records.set(rows); this.savedLoaded.set(true); } });
  }
  async inspectSaved(requestId: string): Promise<void> {
    if (this.unavailable()) return; this.invalidate(); this.checked.set(null);
    await this.perform('Loading saved fork request…', async id => { const record = await ipc.load_hosted_fork_request({ id: requestId, operationId: id }); if (this.current(id)) this.showRecord(record); });
  }
  async reconcile(requestId: string): Promise<void> {
    if (this.unavailable()) return; this.invalidate(); this.checked.set(null);
    await this.perform('Checking saved fork identity and Git objects…', async id => { const record = await ipc.reconcile_hosted_fork({ id: requestId, operationId: id }); if (this.current(id)) this.showRecord(record); });
  }
  async prepareAcknowledgement(requestId: string): Promise<void> {
    if (this.unavailable()) return; this.invalidate();
    await this.perform('Preparing saved-outcome review…', async id => {
      const review = await ipc.prepare_hosted_fork_acknowledgement({ contextId: this.contextId, id: requestId, operationId: id });
      if (!this.current(id)) { await ipc.discard_hosted_fork_review({ contextId: this.contextId, token: review.token }); return; }
      this.acknowledgement.set(review); this.focusTarget.set('archive');
    });
  }
  async applyAcknowledgement(): Promise<void> {
    const review = this.acknowledgement(); if (!review || this.unavailable() || review.unresolved && !this.understood()) return;
    this.acknowledgement.set(null);
    await this.perform('Archiving the reviewed saved outcome…', async id => {
      const archived = await ipc.execute_hosted_fork_acknowledgement({ contextId: this.contextId, token: review.token, operationId: id });
      if (!this.alive(id)) return;
      this.operation!.result = true; this.records.update(rows => rows.filter(row => row.id !== archived.id)); this.record.set(null); this.checked.set(null);
      this.notice.set(review.unresolved ? 'The unresolved outcome is archived. The provider request was not canceled and may still complete.' : 'The verified fork outcome is archived.');
    }, true);
  }
  private async perform(label: string, work: (id: string) => Promise<void>, mutation = false): Promise<void> {
    if (this.unavailable() || this.destroyed) return;
    const operation = { id: crypto.randomUUID(), cancelled: false, mutation, result: false }; this.operation = operation;
    this.busy.set(true); this.busyChange.emit(true); this.cancelling.set(false); this.error.set(''); this.notice.set(''); this.progress.set(label);
    try { await work(operation.id); }
    catch (reason: unknown) { if (this.alive(operation.id)) { const error = reason as { message?: string; hint?: string }; this.error.set(error?.message ? `${error.message}${error.hint ? ' ' + error.hint : ''}` : String(reason)); this.focusTarget.set('error'); } }
    finally {
      if (!this.destroyed && operation.cancelled && !operation.result && !this.error()) this.notice.set(operation.mutation ? 'The request stopped. Check saved outcomes before another submission.' : 'Request canceled.');
      if (this.operation === operation) this.operation = null;
      this.busy.set(false); if (!this.destroyed) this.busyChange.emit(false); this.cancelling.set(false);
    }
  }
  async cancel(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return;
    operation.cancelled = true; this.cancelling.set(true);
    try {
      for (let attempt = 0; attempt < 3 && this.operation === operation; attempt++) { if (await ipc.cancel_git_operation({ operationId: operation.id })) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      if (this.alive(operation.id)) { this.error.set('Cancellation was not acknowledged. Wait for the outcome or try cancellation again.'); this.cancelling.set(false); }
    } catch { if (this.alive(operation.id)) { this.error.set('Cancellation could not be confirmed. Inspect the saved outcome before another submission.'); this.cancelling.set(false); } }
  }
  submissionInFlight(): boolean { return this.busy() && !!this.operation?.mutation; }
  dismiss(): void {
    if (this.destroyed) return; this.destroyed = true; this.invalidate();
    if (this.operation) void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined);
    this.busyChange.emit(false);
  }
  ngOnDestroy(): void { this.dismiss(); }
}
