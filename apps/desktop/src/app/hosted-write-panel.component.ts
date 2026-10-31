import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ipc, type HostedMergeMethod, type HostedReviewEvent, type HostedWriteRequest, type PreparedHostedWrite, type HostedWriteReceipt } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

export interface HostedWriteIntent { kind: 'createPull' | 'review' | 'merge'; number: number; headOid: string; }

@Component({
  selector: 'gc-hosted-write-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Hosted submission">
      <header><h3>{{ heading() }}</h3><button type="button" [disabled]="busy()" (click)="dismiss.emit()">Close submission</button></header>
      @if (error()) { <p role="alert" data-write-error tabindex="-1">{{ error() }}</p> }
      @if (uncertain()) {
        <p role="alert">The submission may already have been applied. Its preview cannot be reused. Inspect the provider result and current records before preparing another request.</p>
        <button type="button" [disabled]="git.busy()" (click)="inspectProvider()">Inspect result on GitHub</button>
      }
      @if (receipt(); as result) {
        <div role="status" data-write-receipt tabindex="-1"><h4>Provider confirmed the submission</h4><p>{{ result.actor }} · {{ result.repository }} · #{{ result.number }}</p><code>{{ result.commitOid }}</code>
          @if (result.notice) { <p role="alert">{{ result.notice }}</p> }
          <p>Reload hosted records to inspect their current state.</p>
          <button type="button" [disabled]="git.busy()" (click)="git.openExternalUrl(result.url)">Open confirmed result on GitHub</button>
        </div>
      } @else if (prepared(); as preview) {
        <div data-write-preview tabindex="-1"><h4>Review before submitting</h4>
          <dl><dt>Account</dt><dd>{{ preview.plan.actor }}</dd><dt>Repository</dt><dd>{{ preview.plan.repository }}</dd>
            @if (preview.plan.sourceRepository) { <dt>Source repository</dt><dd>{{ preview.plan.sourceRepository }}</dd> }
            <dt>Source commit</dt><dd><code>{{ preview.plan.headOid }}</code></dd><dt>Destination</dt><dd>{{ preview.plan.baseBranch }} <code>{{ preview.plan.baseOid }}</code></dd>
          </dl>
          <p>{{ submissionLabel() }}</p>
          @if (preview.plan.request.kind === 'createPull') { <p>Source branch: {{ preview.plan.request.headBranch }}</p> }
          @if (previewTitle()) { <h4>{{ previewTitle() }}</h4> }
          @if (previewBody()) { <pre>{{ previewBody() }}</pre> }
          @if (intent().kind === 'createPull') { <p>The provider creates a request from the current remote branch. Any source movement reported in its reply is disclosed.</p> }
          @if (intent().kind === 'merge') { <p>The provider checks the expected head and its current branch rules. The destination may advance after preparation.</p> }
          @if (!uncertain()) { <div class="actions"><button type="button" [disabled]="busy() || git.busy()" (click)="edit()">Edit request</button><button class="submit" type="button" [disabled]="busy() || git.busy()" (click)="submit()">{{ submissionLabel() }}</button></div> }
        </div>
      } @else {
        <form (submit)="$event.preventDefault(); prepare()">
          <fieldset [disabled]="busy() || git.busy() || uncertain()">
            <p>Titles allow up to 256 characters; descriptions and review text allow up to 65536.</p>
            @if (intent().kind === 'createPull') {
              <div class="fields"><label for="hosted-head-remote">Source remote<select id="hosted-head-remote" [value]="headRemote()" (change)="headRemote.set($any($event.target).value)">@for (item of remotes(); track item.name) { <option [value]="item.name">{{ item.name }} — {{ item.fetchUrl }}</option> }</select></label>
                <label for="hosted-head-branch">Local source branch<input id="hosted-head-branch" required [value]="headBranch()" (input)="headBranch.set($any($event.target).value)" /></label>
                <label for="hosted-base-branch">Destination branch<input id="hosted-base-branch" required [value]="baseBranch()" (input)="baseBranch.set($any($event.target).value)" /></label></div>
              <p>Publish the intended local source commit first. Preparation verifies that its remote branch matches.</p>
              <label for="hosted-write-title">Pull request title<input id="hosted-write-title" required [value]="title()" (input)="title.set($any($event.target).value)" /></label>
              <label class="toggle"><input type="checkbox" [checked]="draft()" (change)="draft.set($any($event.target).checked)" /> Create as draft</label>
            }
            @if (intent().kind === 'review') { <label for="hosted-review-event">Review action<select id="hosted-review-event" [value]="event()" (change)="event.set($any($event.target).value)"><option value="comment">Comment</option><option value="approve">Approve</option><option value="requestChanges">Request changes</option></select></label><p>Review commit: <code>{{ intent().headOid }}</code></p><p>Comments and change requests require review text. An approval may omit it.</p> }
            @if (intent().kind === 'merge') { <label for="hosted-merge-method">Merge method<select id="hosted-merge-method" [value]="method()" (change)="method.set($any($event.target).value)"><option value="merge">Merge commit</option><option value="squash">Squash</option><option value="rebase">Rebase</option></select></label>
              @if (method() !== 'rebase') { <label for="hosted-write-title">Optional commit title<input id="hosted-write-title" [value]="title()" (input)="title.set($any($event.target).value)" /></label> }
            }
            @if (intent().kind !== 'merge' || method() !== 'rebase') { <label for="hosted-write-body">{{ intent().kind === 'review' ? 'Review text' : 'Description' }}<textarea id="hosted-write-body" rows="6" [required]="intent().kind === 'review' && event() !== 'approve'" [value]="body()" (input)="body.set($any($event.target).value)"></textarea></label> }
            <button type="submit" [disabled]="!valid()">Prepare submission preview</button>
          </fieldset>
        </form>
      }
      @if (busy()) { <p role="status">{{ submitting() ? 'Waiting for provider submission…' : 'Preparing a provider snapshot…' }}</p><button type="button" [disabled]="cancelling()" (click)="cancel()">{{ submitting() ? 'Stop waiting for submission' : 'Cancel preparation' }}</button>
        @if (submitting()) { <p>Stopping the wait does not undo a remote write.</p> }
      }
    </section>
  `,
  styles: [`
    section { margin: 16px 0; padding: 16px; border: 1px solid var(--accent); border-radius: 5px; }
    header, .actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    h3 { margin: 0; font-size: 15px; } h4 { font-size: 14px; } p, label, dd, dt, pre, code { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr)); gap: 12px; }
    fieldset { border: 0; padding: 0; margin: 12px 0; min-width: 0; } label { display: grid; gap: 5px; margin: 12px 0; } .toggle { display: flex; align-items: center; gap: 8px; }
    input:not([type=checkbox]), select, textarea { box-sizing: border-box; width: 100%; min-width: 0; } textarea { resize: vertical; min-height: 100px; }
    input, select, textarea, button { padding: 8px 10px; min-height: 34px; color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); }
    input[type=checkbox] { min-height: auto; } button { cursor: pointer; } button.submit { border-color: var(--accent); } button:disabled { cursor: default; opacity: .5; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    dl { display: grid; grid-template-columns: minmax(90px, auto) minmax(0, 1fr); gap: 8px 12px; } dt { color: var(--muted); } dd { margin: 0; } pre { white-space: pre-wrap; max-height: 320px; overflow: auto; } [role=alert] { color: var(--danger); }
  `],
})
export class HostedWritePanelComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly remote = input.required<string>();
  readonly intent = input.required<HostedWriteIntent>();
  readonly dismiss = output<void>();
  readonly submitted = output<void>();
  readonly unconfirmed = output<void>();
  readonly headRemote = signal(''); readonly headBranch = signal(''); readonly baseBranch = signal('');
  readonly title = signal(''); readonly body = signal(''); readonly draft = signal(true);
  readonly event = signal<HostedReviewEvent>('comment'); readonly method = signal<HostedMergeMethod>('merge');
  readonly busy = signal(false); readonly submitting = signal(false); readonly cancelling = signal(false);
  readonly error = signal(''); readonly uncertain = signal(false);
  readonly prepared = signal<PreparedHostedWrite | null>(null); readonly receipt = signal<HostedWriteReceipt | null>(null);
  private operation: { id: string; cancelled: boolean } | null = null;
  private destroyed = false;
  readonly remotes = computed(() => (this.git.repository()?.remotes ?? []).filter(remote => /^(https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/.test(remote.fetchUrl)));
  private readonly context = computed(() => JSON.stringify([this.git.activeRepositoryId(), this.remote(), this.remotes().map(remote => [remote.name, remote.fetchUrl]), this.intent()]));
  readonly heading = computed(() => this.intent().kind === 'createPull' ? 'Create a pull request' : `${this.intent().kind === 'review' ? 'Review' : 'Merge'} pull request #${this.intent().number}`);
  readonly valid = computed(() => {
    const request = this.request();
    if (Array.from(request.body).length > 65536 || ('title' in request && Array.from(request.title).length > 256)) return false;
    if (request.kind === 'createPull') return !!request.headRemote && !!request.headBranch.trim() && !!request.baseBranch.trim() && !!request.title.trim();
    return request.kind === 'merge' || request.event === 'approve' || !!request.body.trim();
  });
  readonly previewTitle = computed(() => { const request = this.prepared()?.plan.request; return request && 'title' in request ? request.title : ''; });
  readonly previewBody = computed(() => this.prepared()?.plan.request.body ?? '');
  readonly submissionLabel = computed(() => {
    const request = this.prepared()?.plan.request ?? this.request();
    if (request.kind === 'createPull') return request.draft ? 'Create draft pull request' : 'Create pull request';
    if (request.kind === 'merge') return `${request.method === 'squash' ? 'Squash and merge' : request.method === 'rebase' ? 'Rebase and merge' : 'Merge pull request'} #${request.number}`;
    return `${request.event === 'approve' ? 'Submit approval' : request.event === 'requestChanges' ? 'Submit change request' : 'Submit review comment'} for #${request.number}`;
  });
  constructor() {
    effect(() => { this.context(); untracked(() => {
      this.releasePreview(); this.receipt.set(null); this.error.set(''); this.uncertain.set(false);
      if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); }
      this.headRemote.set(this.remote()); this.headBranch.set(this.git.repository()?.status.branch ?? ''); this.baseBranch.set('');
      this.title.set(''); this.body.set(''); this.draft.set(true); this.event.set('comment'); this.method.set('merge');
    }); });
  }
  private request(): HostedWriteRequest {
    const intent = this.intent();
    if (intent.kind === 'createPull') return { kind: 'createPull', headRemote: this.headRemote(), headBranch: this.headBranch(), baseBranch: this.baseBranch(), title: this.title(), body: this.body(), draft: this.draft() };
    if (intent.kind === 'review') return { kind: 'review', number: intent.number, expectedHeadOid: intent.headOid, event: this.event(), body: this.body() };
    return { kind: 'merge', number: intent.number, expectedHeadOid: intent.headOid, method: this.method(), title: this.method() === 'rebase' ? '' : this.title(), body: this.method() === 'rebase' ? '' : this.body() };
  }
  private releasePreview(): void {
    const preview = this.prepared(); this.prepared.set(null);
    const repoId = this.previewRepository; this.previewRepository = null;
    if (preview && repoId) void ipc.discard_hosted_write_plan({ repoId, token: preview.token }).catch(() => undefined);
  }
  private previewRepository: string | null = null;
  edit(): void { if (!this.busy() && !this.uncertain()) this.releasePreview(); }
  async prepare(): Promise<void> {
    if (!this.valid() || this.busy() || this.git.busy() || this.uncertain() || this.prepared() || this.receipt() || this.git.browserPreview()) return;
    const request = this.request(), remote = this.remote(), key = this.context();
    await this.run(false, async (repoId, id, report) => {
      const preview = await ipc.prepare_hosted_write({ repoId, remote, request, operationId: id });
      if (this.destroyed || this.operation?.cancelled || this.context() !== key) {
        void ipc.discard_hosted_write_plan({ repoId, token: preview.token }).catch(() => undefined);
        throw { kind: 'operationCancelled', message: 'Submission preparation cancelled.', hint: null };
      }
      this.previewRepository = repoId; this.prepared.set(preview); report('GitHub submission preview ready. Review before submitting.'); this.focus('[data-write-preview]', key);
    });
  }
  async submit(): Promise<void> {
    const preview = this.prepared(), repoId = this.previewRepository;
    if (!preview || !repoId || this.busy() || this.git.busy() || this.uncertain() || this.receipt() || repoId !== this.git.activeRepositoryId()) return;
    const key = this.context();
    await this.run(true, async (_repoId, id, report) => {
      const result = await ipc.execute_hosted_write({ repoId, token: preview.token, operationId: id });
      report(`GitHub submission confirmed: ${result.url}`);
      if (!this.destroyed && this.context() === key) { this.receipt.set(result); this.prepared.set(null); this.previewRepository = null; this.submitted.emit(); this.focus('[data-write-receipt]', key); }
    });
  }
  private async run(submitting: boolean, action: (repoId: string, id: string, report: (message: string) => void) => Promise<void>): Promise<void> {
    const repoId = this.git.activeRepositoryId(); if (!repoId) return;
    const key = this.context(), operation = { id: crypto.randomUUID(), cancelled: false };
    this.operation = operation; this.busy.set(true); this.submitting.set(submitting); this.cancelling.set(false); this.error.set('');
    try {
      const outcome = await this.git.run(submitting ? 'Submitting reviewed GitHub action…' : 'Preparing GitHub submission…', async report => {
        try { await action(repoId, operation.id, report); }
        catch (error) {
          const kind = error && typeof error === 'object' && 'kind' in error ? String(error.kind) : '';
          const unknown = submitting && !['hostingWriteRefused', 'staleHostedWritePlan', 'hostingAuthentication', 'operationCancelled'].includes(kind);
          if (!this.destroyed && this.context() === key && unknown) { this.uncertain.set(true); this.unconfirmed.emit(); }
          throw error;
        }
      }, repoId, operation.id);
      if (!this.destroyed && this.context() === key && outcome !== 'success') {
        this.error.set(this.git.error() ?? (operation.cancelled ? 'Request cancelled. Prepare a new preview before submitting.' : 'The request could not be completed.'));
        if (submitting && !this.uncertain()) this.releasePreview();
        this.focus('[data-write-error]', key);
      }
    } finally { this.operation = null; this.busy.set(false); this.submitting.set(false); this.cancelling.set(false); }
  }
  async cancel(): Promise<void> {
    if (!this.operation || this.cancelling()) return;
    this.operation.cancelled = true; this.cancelling.set(true);
    try { const acknowledged = await ipc.cancel_git_operation({ operationId: this.operation.id }); if (!acknowledged && !this.destroyed) this.error.set('Stopping the wait is not yet acknowledged. Wait for the provider result.'); }
    catch { if (!this.destroyed) { this.cancelling.set(false); this.error.set('Could not confirm that waiting stopped. The request is still pending.'); } }
  }
  inspectProvider(): void {
    const preview = this.prepared();
    if (preview) void this.git.openExternalUrl(`https://github.com/${preview.plan.repository}/pull${this.intent().number ? '/' + this.intent().number : 's'}`);
  }
  private focus(selector: string, key: string): void { setTimeout(() => { if (!this.destroyed && this.context() === key) this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(); }); }
  ngOnDestroy(): void { this.destroyed = true; this.releasePreview(); if (this.operation) { this.operation.cancelled = true; void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); } }
}
