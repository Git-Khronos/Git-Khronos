import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { ipc, type BranchWorkflowControl, type BranchWorkflowFinishStatus, type BranchWorkflowKind, type BranchWorkflowMergePolicy, type BranchWorkflowRequest, type BranchWorkflowSettings, type BranchWorkflowView, type PreparedBranchWorkflow } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';

export interface BranchWorkflowDialogRequest { repositoryId: string; path: string; returnFocus: HTMLElement | null }
const DEFAULTS: BranchWorkflowSettings = { version: 1, production: 'main', development: 'develop', featurePrefix: 'feature/', releasePrefix: 'release/', hotfixPrefix: 'hotfix/', tagPrefix: '' };

@Component({
  selector: 'gc-branch-workflow-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close()"><section #dialog role="dialog" aria-modal="true" aria-labelledby="workflow-title" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
      <header><div><h2 id="workflow-title">Branch workflows</h2><p>{{ request().path }}</p></div><button type="button" (click)="close()">{{ busy() ? 'Cancel and close' : 'Close' }}</button></header>
      @if (!contextValid()) { <p role="alert">The selected repository changed. Close this dialog and reopen it for the intended repository.</p> }
      @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
      @if (notice()) { <p role="status">{{ notice() }}</p> }
      @if (busy() || applying()) { <div class="progress"><span role="status">{{ progress() }}</span><button type="button" [disabled]="cancelling() || !busy()" (click)="cancel()">{{ cancelling() ? 'Stopping…' : 'Cancel request' }}</button></div> }
      @if (view(); as view) {
        @if (view.finish; as finish) {
          <h3>{{ finish.plan.branch }}</h3><p>Workflow {{ phaseLabel(finish) }} · owning checkout: <code>{{ finish.ownerWorktree }}</code></p>
          <ol aria-label="Workflow stages">
            @for (target of finish.plan.targets; track target.branch; let i = $index) {
              <li><strong>{{ target.branch }}</strong> — {{ i < finish.completedTargets.length ? 'Integrated' : i === finish.completedTargets.length && finish.phase === 'conflicted' ? 'Merge needs resolution' : 'Pending' }}
                <code>{{ finish.completedTargets[i] ?? target.oid }}</code></li>
            }
            @if (finish.plan.tag; as tag) { <li>Tag <strong>{{ tag.name }}</strong> — {{ finish.tagOid ? 'Created' : 'Pending' }}<code>{{ finish.tagOid ?? 'Production integration result' }}</code></li> }
            @if (finish.plan.deleteTopic) { <li>Local topic cleanup — {{ finish.phase === 'complete' ? 'Finished' : 'Pending' }}</li> }
          </ol>
          @if (finish.notice) { <p role="status">{{ finish.notice }}</p> }
          @if (finish.phase === 'conflicted') { <p>Close this dialog to resolve and stage the conflicted files. Reopen Branch workflows to continue the saved merge.</p> }
          <details><summary>Saved recovery captures ({{ finish.recovery.length }})</summary><ul>@for (capture of finish.recovery; track capture.id) { <li>{{ capture.label }}<code>{{ capture.headReference }}</code><code>{{ capture.headOid }}</code></li> }</ul><p>Saved captures remain available after this workflow is closed or acknowledged.</p></details>
          @if (pendingControl(); as control) {
            <div class="review" role="region" aria-label="Review workflow control"><h3>{{ control === 'abort' ? 'Stop this workflow?' : 'Acknowledge this outcome?' }}</h3>
              <p>{{ control === 'abort' ? 'Only a currently active merge is aborted. Completed integrations and tags remain applied; saved captures are retained.' : 'Remove this finished workflow record. Its integrations, tags and saved recovery captures are retained.' }}</p>
              <button type="button" [disabled]="unavailable()" (click)="confirmControl()">{{ control === 'abort' ? 'Stop workflow' : 'Acknowledge outcome' }}</button><button type="button" [disabled]="busy()" (click)="pendingControl.set(null)">Keep record</button>
            </div>
          } @else {
            <footer>
              @if (finish.phase === 'complete' || finish.phase === 'aborted') { <button type="button" [disabled]="unavailable()" (click)="pendingControl.set('acknowledge')">Review acknowledgement</button> }
              @else {
                <button type="button" [disabled]="unavailable()" (click)="control({ action: 'continue', retry: false })">Inspect and continue</button>
                @if (finish.retryRequired) { <button type="button" [disabled]="unavailable()" (click)="retryConfirmed.set(!retryConfirmed())" [attr.aria-pressed]="retryConfirmed()">Review explicit retry</button> }
                <button type="button" [disabled]="unavailable()" (click)="pendingControl.set('abort')">Review stop</button>
              }
            </footer>
            @if (retryConfirmed()) { <div class="review"><p>The previous command may have run hooks or made partial changes. Inspect its effects before retrying the unconfirmed stage. Completed stages will be retained.</p><button type="button" [disabled]="unavailable()" (click)="control({ action: 'continue', retry: true })">Retry unconfirmed stage</button></div> }
          }
        } @else {
          <nav aria-label="Branch workflow sections"><button type="button" [disabled]="unavailable()" [attr.aria-pressed]="panel() === 'topics'" (click)="setPanel('topics')">Topics</button><button type="button" [disabled]="unavailable()" [attr.aria-pressed]="panel() === 'settings'" (click)="setPanel('settings')">Configuration</button></nav>
          @if (panel() === 'settings') {
            <p>Keep production and development branches separate. Missing branches are created at the reviewed initial commit; existing branches keep their current tips.</p>
            @if (!initialChoices().length) { <p>Create an initial commit before configuring workflow branches.</p> }
            <form (submit)="$event.preventDefault(); prepareSetup()"><fieldset [disabled]="unavailable()"><legend>Repository workflow configuration</legend><div class="fields">
              @for (field of settingFields; track field.key) { <label [for]="'workflow-' + field.key">{{ field.label }}<input [id]="'workflow-' + field.key" [value]="settings()[field.key]" [maxLength]="field.limit" (input)="editSetting(field.key, $any($event.target).value)" autocomplete="off" spellcheck="false" /></label> }
              <label for="workflow-initial">Initial commit for missing branches<select id="workflow-initial" [value]="initialOid()" (change)="initialOid.set($any($event.target).value); invalidate()">@for (base of initialChoices(); track base.oid) { <option [value]="base.oid">{{ base.label }} · {{ base.oid.slice(0, 12) }}</option> }</select></label>
            </div><button type="submit" [disabled]="!settingsValid() || !initialOid()">Review configuration</button></fieldset></form>
          } @else if (view.state.settings; as configured) {
            <dl><dt>Production</dt><dd>{{ configured.production }}<code>{{ view.state.productionOid ?? 'Branch missing — review configuration' }}</code></dd><dt>Development</dt><dd>{{ configured.development }}<code>{{ view.state.developmentOid ?? 'Branch missing — review configuration' }}</code></dd></dl>
            <form (submit)="$event.preventDefault(); prepareStart()"><fieldset [disabled]="unavailable()"><legend>Start a topic</legend><div class="fields"><label for="workflow-kind">Topic type<select id="workflow-kind" [value]="kind()" (change)="chooseKind($any($event.target).value)"><option value="feature">Feature</option><option value="release">Release</option><option value="hotfix">Hotfix</option></select></label><label for="workflow-suffix">Topic name<input id="workflow-suffix" [value]="suffix()" maxlength="512" (input)="suffix.set($any($event.target).value); invalidate()" autocomplete="off" spellcheck="false" /></label></div><p>New branch: <code>{{ newBranch() }}</code> · based on {{ kind() === 'hotfix' ? configured.production : configured.development }}. Creation switches the current checkout.</p><button type="submit" [disabled]="!suffix().trim()">Review topic creation</button></fieldset></form>
            <h3>Local topics</h3><ul class="topics" aria-label="Local workflow topics">@for (topic of view.state.topics; track topic.branch) { <li><div><strong>{{ topic.branch }}</strong><span>{{ topic.kind }} · {{ tracking(topic.branch) }}</span><code>{{ topic.oid }}</code>@if (topic.worktree) { <span>Checkout: {{ topic.worktree }}</span> }</div><button type="button" [disabled]="unavailable()" (click)="chooseTopic(topic.branch)">Finish {{ topic.branch }}</button></li> } @empty { <li>No local topics match the configured prefixes.</li> }</ul>
            @if (selectedTopic(); as topic) {
              <form (submit)="$event.preventDefault(); prepareFinish()"><fieldset [disabled]="unavailable()"><legend>Finish {{ topic.branch }}</legend><label for="workflow-policy">Integration policy<select id="workflow-policy" [value]="mergePolicy()" (change)="setPolicy($any($event.target).value)"><option value="mergeCommit">Create a merge commit when integration is needed</option><option value="fastForwardAllowed">Allow fast-forward</option></select></label><label for="workflow-message">Merge message (optional)<textarea id="workflow-message" [value]="mergeMessage()" maxlength="16000" (input)="mergeMessage.set($any($event.target).value); invalidate()"></textarea></label>
              <label class="check"><input type="checkbox" [checked]="topic.kind === 'feature' || deleteTopic()" [disabled]="topic.kind === 'feature'" (change)="deleteTopic.set($any($event.target).checked); invalidate()" />Delete the local topic after every required stage succeeds</label>
              @if (topic.kind !== 'feature') {
                @if (topic.kind === 'hotfix') { <label class="check"><input type="checkbox" [checked]="tagEnabled()" (change)="tagEnabled.set($any($event.target).checked); invalidate()" />Create an annotated version tag</label> }
                @if (topic.kind === 'release' || tagEnabled()) { <p>Version tag: <code>{{ configured.tagPrefix + topic.suffix }}</code></p><label for="workflow-tag-message">Tag annotation<textarea id="workflow-tag-message" [value]="tagMessage()" maxlength="16000" (input)="tagMessage.set($any($event.target).value); invalidate()"></textarea></label><label for="workflow-signing">Tag signing<select id="workflow-signing" [value]="tagSigning()" (change)="tagSigning.set($any($event.target).value); invalidate()"><option value="default">Repository default</option><option value="signed">Sign tag</option><option value="unsigned">Unsigned tag</option></select></label> }
              } @else { <p>For a feature rebase, use its branch actions first, then return to review a fresh finish plan.</p> }
              <button type="submit" [disabled]="(topic.kind === 'release' || tagEnabled()) && topic.kind !== 'feature' && !tagMessage().trim()">Review finish</button></fieldset></form>
            }
          } @else { <p>This repository has no branch workflow configuration.</p><button type="button" [disabled]="unavailable()" (click)="setPanel('settings')">Configure workflows</button> }
          @if (preview(); as preview) {
            <div #review class="review" role="region" tabindex="-1" aria-label="Review branch workflow"><h3>Review before applying</h3>
              @if (setupPreview(); as setup) { <p>Save this repository’s workflow settings. Checkout and files are retained.</p><ul>@for (branch of setup.branches; track branch.branch) { <li>{{ branch.branch }} — {{ branch.expectedOid ? 'Retain existing tip' : 'Create branch' }}<code>{{ branch.expectedOid ?? branch.createAt }}</code></li> }</ul> }
              @if (startPreview(); as start) { <p>Create and check out <strong>{{ start.branch }}</strong> from {{ start.baseBranch }}.</p><code>{{ start.baseOid }}</code> }
              @if (finishPreview(); as finish) { <p>Integrate <strong>{{ finish.branch }}</strong> at <code>{{ finish.sourceOid }}</code> into the targets below, in order.</p><ol>@for (target of finish.targets; track target.branch) { <li>{{ target.branch }}<code>{{ target.oid }}</code><pre>{{ target.message }}</pre></li> }</ol><p>{{ finish.mergePolicy === 'mergeCommit' ? 'Require a merge commit when integration is needed.' : 'Fast-forward is allowed.' }}</p>@if (finish.tag; as tag) { <p>Annotated tag <strong>{{ tag.name }}</strong> at the resulting production commit · {{ tag.sign ? 'Signing requested' : 'Unsigned' }}</p><pre>{{ tag.message }}</pre> }<p>{{ finish.deleteTopic ? 'Delete the reviewed local topic only after all required stages succeed.' : 'Retain the local topic after finishing.' }}</p><p>Completed stages are retained if a later stage fails. Saved recovery captures preserve the original tips. No remote operation is included.</p> }
              <footer><button type="button" [disabled]="unavailable()" (click)="apply()">Apply reviewed workflow</button><button type="button" [disabled]="busy()" (click)="invalidate()">Discard preview</button></footer>
            </div>
          }
        }
      } @else if (!busy()) { <button type="button" [disabled]="!contextValid() || git.busy()" (click)="load()">Load workflow state</button> }
      <footer><button type="button" [disabled]="unavailable()" (click)="reload()">Reload workflow state</button></footer>
    </section></div>
  `,
  styles: [`
    .backdrop{position:fixed;inset:0;z-index:65;background:#080811b8;display:grid;place-items:center;padding:12px}
    section{box-sizing:border-box;width:min(760px,100%);max-height:calc(100dvh - 24px);overflow:auto;padding:20px;color:var(--text);background:var(--inspector-list);border:1px solid var(--inspector-divider);border-radius:7px;scroll-padding:12px}
    header,footer,nav,.progress{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}nav{justify-content:flex-start;margin:16px 0}header>div{min-width:0;flex:1}h2{margin:0;font-size:18px}h3,legend{font-size:14px;font-weight:600}p,li,dt,dd,label,span{font-size:13px;line-height:1.5;overflow-wrap:anywhere}header p{margin:4px 0}code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}p code{display:inline}dd{margin:4px 0 12px}fieldset{border:1px solid var(--inspector-divider);padding:14px;margin:16px 0;min-width:0}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}label{display:block;margin:8px 0}input:not([type=checkbox]),select,textarea{box-sizing:border-box;width:100%;min-width:0;min-height:34px;display:block;margin-top:5px}textarea{min-height:66px;resize:vertical}.check{display:flex;align-items:flex-start;gap:8px}.check input{margin-top:3px}button,input,select,textarea{color:var(--text);background:var(--inspector-row);border:1px solid var(--inspector-divider);padding:7px 10px;font:inherit;font-size:13px}button{min-height:32px;cursor:pointer;white-space:normal;overflow-wrap:anywhere}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}nav [aria-pressed=true]{border-color:var(--accent)}.review{border:1px solid var(--accent);padding:14px;margin:18px 0;overflow-wrap:anywhere}.topics{padding:0;list-style:none}.topics li{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--inspector-divider);padding:12px 0}.topics li>div{min-width:0}.topics span{display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}footer{margin-top:16px;justify-content:flex-start}[role=alert]{color:var(--danger)}details{margin:12px 0}summary{cursor:pointer}@media(max-width:560px){section{padding:14px}.fields{grid-template-columns:minmax(0,1fr)}.topics li{align-items:flex-start;flex-direction:column}}
  `],
})
export class BranchWorkflowDialogComponent implements OnDestroy {
  readonly git = inject(GitKhronosService);
  readonly request = input.required<BranchWorkflowDialogRequest>();
  readonly closed = output<void>();
  readonly view = signal<BranchWorkflowView | null>(null);
  readonly panel = signal<'topics' | 'settings'>('topics');
  readonly settings = signal<BranchWorkflowSettings>({ ...DEFAULTS });
  readonly initialOid = signal('');
  readonly kind = signal<BranchWorkflowKind>('feature');
  readonly suffix = signal('');
  readonly selectedBranch = signal('');
  readonly mergePolicy = signal<BranchWorkflowMergePolicy>('mergeCommit');
  readonly mergeMessage = signal('');
  readonly deleteTopic = signal(false);
  readonly tagEnabled = signal(false);
  readonly tagMessage = signal('');
  readonly tagSigning = signal('default');
  readonly preview = signal<PreparedBranchWorkflow | null>(null);
  readonly busy = signal(false);
  readonly applying = signal(false);
  readonly cancelling = signal(false);
  readonly progress = signal('');
  readonly error = signal('');
  readonly notice = signal('');
  readonly retryConfirmed = signal(false);
  readonly pendingControl = signal<'abort' | 'acknowledge' | null>(null);
  readonly settingFields: { key: Exclude<keyof BranchWorkflowSettings, 'version'>; label: string; limit: number }[] = [
    { key: 'production', label: 'Production branch', limit: 1024 }, { key: 'development', label: 'Development branch', limit: 1024 },
    { key: 'featurePrefix', label: 'Feature prefix', limit: 512 }, { key: 'releasePrefix', label: 'Release prefix', limit: 512 },
    { key: 'hotfixPrefix', label: 'Hotfix prefix', limit: 512 }, { key: 'tagPrefix', label: 'Version tag prefix', limit: 512 },
  ];
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly review = viewChild<ElementRef<HTMLElement>>('review');
  private operation: { id: string; cancelRequested: boolean } | null = null;
  private destroyed = false;
  private closing = false;
  private closedOnce = false;
  private previewBinding = '';
  private lastRequestCancelled = false;
  readonly contextValid = computed(() => this.git.repository()?.id === this.request().repositoryId && this.git.repository()?.path === this.request().path);
  readonly unavailable = computed(() => this.busy() || this.applying() || this.git.busy() || !this.contextValid());
  readonly selectedTopic = computed(() => this.view()?.state.topics.find(topic => topic.branch === this.selectedBranch()) ?? null);
  readonly settingsValid = computed(() => {
    const s = this.settings(); const prefixes = [s.featurePrefix, s.releasePrefix, s.hotfixPrefix];
    return !!s.production.trim() && !!s.development.trim() && s.production !== s.development && prefixes.every((p, i) => !!p.trim() && prefixes.every((q, j) => i === j || !p.startsWith(q) && !q.startsWith(p)));
  });
  readonly initialChoices = computed(() => {
    const repo = this.git.repository(); const choices: { oid: string; label: string }[] = [];
    if (repo?.headOid) choices.push({ oid: repo.headOid, label: 'Current HEAD' });
    for (const branch of repo?.branches ?? []) if (!branch.remote && !choices.some(choice => choice.oid === branch.oid)) choices.push({ oid: branch.oid, label: branch.name });
    return choices;
  });
  readonly newBranch = computed(() => { const s = this.view()?.state.settings; return s ? s[this.kind() === 'feature' ? 'featurePrefix' : this.kind() === 'release' ? 'releasePrefix' : 'hotfixPrefix'] + this.suffix() : ''; });
  readonly setupPreview = computed(() => { const p = this.preview()?.plan; return p?.action === 'setup' ? p.plan : null; });
  readonly startPreview = computed(() => { const p = this.preview()?.plan; return p?.action === 'start' ? p.plan : null; });
  readonly finishPreview = computed(() => { const p = this.preview()?.plan; return p?.action === 'finish' ? p.plan : null; });
  private readonly binding = computed(() => { const repo = this.git.repository(); return JSON.stringify([repo?.id, repo?.path, repo?.headOid, repo?.status.branch, repo?.branches.map(b => [b.fullName, b.oid, b.upstream])]); });

  constructor() {
    effect(() => {
      const valid = this.contextValid(); const binding = this.binding();
      untracked(() => {
        if (!valid) { this.invalidate(); if (this.operation) void this.cancel(); }
        else if (this.preview() && binding !== this.previewBinding) { this.invalidate(); this.notice.set('Repository references changed. Review a fresh workflow plan.'); }
      });
    });
    afterNextRender(() => { this.focusFirst(); void this.load(); });
  }
  tracking(branch: string): string { return this.git.repository()?.branches.find(b => !b.remote && b.name === branch)?.upstream ?? 'No upstream configured'; }
  phaseLabel(status: BranchWorkflowFinishStatus): string { return ({ ready: 'paused between stages', checkingOut: 'checkout needs inspection', merging: 'integration needs inspection', conflicted: 'paused for conflicts', tagging: 'tagging needs inspection', cleaning: 'cleanup needs inspection', complete: 'complete', aborted: 'stopped' } as const)[status.phase]; }
  setPanel(panel: 'topics' | 'settings'): void { if (this.unavailable()) return; this.invalidate(); this.panel.set(panel); }
  editSetting(key: Exclude<keyof BranchWorkflowSettings, 'version'>, value: string): void { this.settings.update(s => ({ ...s, [key]: value })); this.invalidate(); }
  chooseKind(kind: BranchWorkflowKind): void { this.kind.set(kind); this.invalidate(); }
  setPolicy(policy: BranchWorkflowMergePolicy): void { this.mergePolicy.set(policy); this.invalidate(); }
  chooseTopic(branch: string): void {
    this.invalidate(); this.selectedBranch.set(branch); this.mergePolicy.set('mergeCommit'); this.mergeMessage.set(''); this.deleteTopic.set(false); this.tagEnabled.set(false); this.tagSigning.set('default');
    const topic = this.selectedTopic(); this.tagMessage.set(topic ? `${topic.kind === 'release' ? 'Release' : 'Hotfix'} ${topic.suffix}` : '');
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLSelectElement>('#workflow-policy')?.focus());
  }
  invalidate(): void {
    const preview = this.preview(); this.preview.set(null);
    if (preview) void ipc.discard_branch_workflow_plan({ repoId: this.request().repositoryId, token: preview.token }).catch(() => undefined);
  }
  async reload(): Promise<void> { this.invalidate(); this.pendingControl.set(null); this.retryConfirmed.set(false); await this.load(); }
  async load(preserveError = false, internal = false): Promise<void> {
    if (this.busy() || this.git.busy() || !this.contextValid() || this.applying() && !internal) return;
    await this.run('Loading branch workflows…', async id => {
      const view = await ipc.load_branch_workflow({ repoId: this.request().repositoryId, operationId: id });
      if (this.validReply()) { this.view.set(view); this.settings.set({ ...(view.state.settings ?? DEFAULTS) }); this.initialOid.set(this.git.repository()?.headOid ?? ''); if (!view.state.settings) this.panel.set('settings'); }
      return 'Branch workflow state loaded';
    }, preserveError);
  }
  prepareSetup(): Promise<void> { return this.prepare({ action: 'setup', settings: { ...this.settings() }, initialOid: this.initialOid() }); }
  prepareStart(): Promise<void> { return this.prepare({ action: 'start', kind: this.kind(), suffix: this.suffix() }); }
  async prepareFinish(): Promise<void> {
    const topic = this.selectedTopic(); if (!topic) return;
    await this.prepare({ action: 'finish', branch: topic.branch, options: { mergePolicy: this.mergePolicy(), mergeMessage: this.mergeMessage().trim() ? this.mergeMessage() : null,
      deleteTopic: topic.kind === 'feature' || this.deleteTopic(), tag: topic.kind === 'release' || topic.kind === 'hotfix' && this.tagEnabled() ? { message: this.tagMessage(), sign: this.tagSigning() === 'default' ? null : this.tagSigning() === 'signed' } : null } });
  }
  private async prepare(request: BranchWorkflowRequest): Promise<void> {
    if (this.unavailable()) return; this.invalidate(); this.notice.set('');
    const binding = this.binding();
    await this.run('Preparing branch workflow…', async id => {
      const preview = await ipc.prepare_branch_workflow({ repoId: this.request().repositoryId, request, operationId: id });
      if (!this.validReply() || this.operation?.cancelRequested || binding !== this.binding()) {
        await ipc.discard_branch_workflow_plan({ repoId: this.request().repositoryId, token: preview.token });
        throw { kind: 'operationCancelled', message: 'The workflow preview was canceled or its repository changed.' };
      }
      this.previewBinding = binding; this.preview.set(preview); setTimeout(() => this.review()?.nativeElement.focus());
      return 'Branch workflow preview ready';
    });
  }
  async apply(): Promise<void> {
    const preview = this.preview(); if (!preview || this.unavailable()) return;
    if (this.previewBinding !== this.binding()) { this.invalidate(); this.error.set('Repository state changed. Review a fresh workflow plan.'); return; }
    this.preview.set(null); this.notice.set(''); this.applying.set(true);
    try {
    await this.run('Applying reviewed branch workflow…', async id => {
      const finish = await ipc.execute_branch_workflow({ repoId: this.request().repositoryId, token: preview.token, operationId: id });
      const message = finish ? `Branch workflow ${this.phaseLabel(finish)}` : preview.plan.action === 'setup' ? 'Workflow configuration saved' : 'Workflow topic created';
      if (this.validReply()) this.notice.set(message);
      return message;
    });
    await this.refreshAfterAction();
    } finally { this.applying.set(false); }
  }
  confirmControl(): Promise<void> { const pending = this.pendingControl(); this.pendingControl.set(null); return pending ? this.control({ action: pending }) : Promise.resolve(); }
  async control(control: BranchWorkflowControl): Promise<void> {
    const finish = this.view()?.finish; if (!finish || this.unavailable()) return;
    this.retryConfirmed.set(false); this.notice.set(''); this.applying.set(true);
    try {
    await this.run('Updating saved branch workflow…', async operationId => {
      const result = await ipc.control_branch_workflow_finish({ repoId: this.request().repositoryId, id: finish.id, revision: finish.revision, control, operationId });
      const message = result ? `Branch workflow ${this.phaseLabel(result)}` : 'Workflow outcome acknowledged; saved captures retained';
      if (this.validReply()) this.notice.set(message);
      return message;
    });
    await this.refreshAfterAction();
    } finally { this.applying.set(false); }
  }
  private async refreshAfterAction(): Promise<void> {
    if (!this.validReply() || this.closing) return;
    if (!this.lastRequestCancelled) {
      const refreshed = await this.git.refreshRepositoryInBackground(this.request().repositoryId);
      if (this.validReply() && !refreshed) this.notice.update(message => `${message}. Repository graph refresh is pending; workflow state is reloaded separately.`);
    }
    if (this.validReply()) await this.load(true, true);
  }
  private validReply(): boolean { return !this.destroyed && this.contextValid(); }
  private async run(label: string, action: (id: string) => Promise<string>, preserveError = false): Promise<void> {
    if (this.busy() || this.git.busy() || !this.contextValid()) return;
    const operation = { id: crypto.randomUUID(), cancelRequested: false }; this.operation = operation; this.busy.set(true); this.cancelling.set(false); this.progress.set(label); if (!preserveError) this.error.set('');
    try {
      const outcome = await this.git.run(label, async report => { const message = await action(operation.id); report(message); }, this.request().repositoryId, operation.id, false);
      this.lastRequestCancelled = operation.cancelRequested || outcome === 'cancelled';
      if (this.validReply() && outcome !== 'success') this.error.set(this.git.error() ?? 'The request stopped. Reload workflow state to inspect any applied effects.');
    } finally {
      if (this.operation === operation) this.operation = null; this.busy.set(false); this.cancelling.set(false);
      if (this.closing && !this.destroyed) this.finishClose();
    }
  }
  async cancel(): Promise<void> {
    const operation = this.operation; if (!operation || this.cancelling()) return;
    operation.cancelRequested = true; this.cancelling.set(true);
    try {
      for (let attempt = 0; attempt < 3 && this.operation === operation; attempt++) {
        if (await ipc.cancel_git_operation({ operationId: operation.id })) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (this.validReply() && this.operation === operation) { this.error.set('Cancellation was not acknowledged. Wait for the result or retry cancellation.'); this.cancelling.set(false); }
    } catch (reason: unknown) { if (this.validReply() && this.operation === operation) { this.error.set(this.describe(reason)); this.cancelling.set(false); } }
  }
  private describe(reason: unknown): string { const e = reason as { message?: string; hint?: string }; return e?.message ? `${e.message}${e.hint ? ' ' + e.hint : ''}` : String(reason); }
  close(): void { if (this.busy()) { this.closing = true; void this.cancel(); } else this.finishClose(); }
  private finishClose(): void { if (this.closedOnce || this.destroyed) return; this.closedOnce = true; const opener = this.request().returnFocus; this.invalidate(); this.closed.emit(); setTimeout(() => { if (opener?.isConnected && opener.getClientRects().length) opener.focus(); else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus(); }); }
  ngOnDestroy(): void { this.destroyed = true; this.invalidate(); if (this.operation) void ipc.cancel_git_operation({ operationId: this.operation.id }).catch(() => undefined); }
  private focusFirst(): void { this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }
  @HostListener('document:focusin') containFocus(): void { const dialog = this.dialog()?.nativeElement; if (!this.destroyed && dialog && !dialog.contains(document.activeElement)) this.focusFirst(); }
  handleKey(event: KeyboardEvent): void {
    event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') ?? [])].filter(e => e.getClientRects().length);
    if (!controls.length) return; const index = controls.indexOf(document.activeElement as HTMLElement); event.preventDefault(); controls[event.shiftKey ? index <= 0 ? controls.length - 1 : index - 1 : (index + 1) % controls.length]?.focus();
  }
}
