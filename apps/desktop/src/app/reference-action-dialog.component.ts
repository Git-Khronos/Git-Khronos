import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GitKhronosService } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';

export interface ReferenceActionRequest {
  action: 'push-tag' | 'delete-tag' | 'delete-remote-tag' | 'delete-remote-branch' | 'rename-tag' | 'rename-remote-branch';
  repositoryId: string;
  repositoryPath: string;
  readonly checkoutVisit: string;
  name: string;
  oid: string;
  remote?: string;
  returnFocus: HTMLElement | null;
}

export interface ReferenceRenamed {
  request: ReferenceActionRequest;
  kind: 'tag' | 'remote-branch';
  remote?: string;
  name: string;
  newName: string;
}

/** Mirrors the main `git check-ref-format` rules so obvious mistakes are flagged before Git runs. */
const INVALID_REFERENCE_NAME = /\s|\.\.|[~^:?*[\\\x00-\x1f\x7f]|^[-/.]|[/.]$|\/\/|\/\.|@\{|\.lock(\/|$)|^@$/;

@Component({
  selector: 'gk-reference-action-dialog',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (target of reviews(); track target) {
      <div class="backdrop" (click)="close(target)">
        <section #dialog role="alertdialog" aria-modal="true" aria-labelledby="reference-action-title"
          aria-describedby="reference-action-description" (click)="$event.stopPropagation()" (keydown)="handleKey($event, target)">
          <h2 id="reference-action-title">{{ title() }}</h2>
          <p id="reference-action-description">
            @if (target.action === 'delete-tag') {
              Delete only the local tag. Remote tags and working files are unchanged.
              Its object is preserved under a Git Khronos recovery reference.
            } @else if (target.action === 'rename-tag') {
              Rename the tag without changing the commit or annotation it points to.
              The remote copy is renamed only when you choose to below.
            } @else if (target.action === 'rename-remote-branch') {
              Create the new branch name on the remote and delete the old one in a single push.
              Local branches that track it are updated to track the new name.
              Git refuses the rename if the remote branch moved or the new name is taken.
            } @else if (target.action === 'push-tag') {
              Push only this tag. Other tags and branches are unchanged. An existing different remote tag is not overwritten.
            } @else {
              Delete only this reference from the selected remote's push destination.
              Local branches, local tags and working files are unchanged.
              Git refuses deletion if the remote reference has moved from the expected object.
            }
          </p>
          <p class="source">Checkout: <code>{{ target.repositoryPath }}</code></p>
          <code>{{ target.action === 'rename-remote-branch' ? target.remote + '/' + target.name : target.name }}</code>
          @if (renaming()) {
            <label for="reference-new-name">New name</label>
            <input id="reference-new-name" name="referenceNewName" autocomplete="off" spellcheck="false"
              [ngModel]="newName()" (ngModelChange)="changeName($event, target)" [disabled]="git.busy()"
              [attr.aria-invalid]="nameProblem() ? 'true' : null"
              [attr.aria-describedby]="nameProblem() ? 'reference-new-name-problem' : null"
              (keydown.enter)="$event.preventDefault(); confirmFromKeyboard($event, target)" />
            @if (nameProblem(); as problem) { <p id="reference-new-name-problem" class="error" role="alert">{{ problem }}</p> }
          }
          @if (target.action === 'rename-tag' && (git.repository()?.remotes?.length ?? 0) > 0) {
            <label class="check"><input type="checkbox" name="referenceRenameRemote" [ngModel]="renameOnRemote()"
              (ngModelChange)="toggleRemoteRename($event, target)" [disabled]="git.busy()" />Also rename the tag on a remote</label>
          }
          <gk-git-help [topic]="target.action === 'delete-remote-branch' || target.action === 'rename-remote-branch' ? 'push' : 'tag'" label="Learn about local and remote references…" />
          @if (target.action !== 'delete-tag' && (target.action !== 'rename-tag' || renameOnRemote())) {
            <label for="reference-remote">Remote</label>
              <select id="reference-remote" name="referenceRemote" [ngModel]="remote()" (ngModelChange)="changeRemote($event, target)"
                [disabled]="git.busy() || target.action === 'delete-remote-branch' || target.action === 'rename-remote-branch'">
                @for (candidate of git.repository()?.remotes ?? []; track candidate.name) {
                  <option [value]="candidate.name">{{ candidate.name }}</option>
                }
              </select>
            <p class="destination">{{ destination() || 'No remote configured' }}</p>
          }
          @if (target.action === 'delete-remote-tag' || (target.action === 'rename-tag' && renameOnRemote())) {
            <button type="button" [disabled]="!remote() || git.busy()" (click)="checkRemoteTag(target)">Check remote tag</button>
            <p>{{ remoteExpected() ? 'Expected remote object: ' + remoteExpected()
              : target.action === 'rename-tag' ? 'Check the remote tag before renaming it there.' : 'Check the remote tag before confirming deletion.' }}</p>
          } @else if (target.action === 'delete-remote-branch' || target.action === 'rename-remote-branch') {
            <p>Expected remote commit: <code>{{ target.oid }}</code></p>
          }
          @if (git.error()) { <p class="error" role="alert">{{ git.error() }}</p> }
          <footer>
            @if (git.busy()) { <button type="button" (click)="cancelOperation(target)">Cancel operation</button> }
            <button type="button" data-reference-cancel [disabled]="git.busy()" (click)="close(target)">Cancel</button>
            <button type="button" [class.danger]="target.action !== 'push-tag' && !renaming()"
              [disabled]="!canConfirm() || git.busy()" (click)="confirm(target)">
              {{ confirmLabel() }}
            </button>
          </footer>
        </section>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; background: #080811b8; }
    section { width: min(480px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p { font-size: 13px; line-height: 1.5; }
    code, .destination { overflow-wrap: anywhere; }
    label { display: block; margin: 14px 0 6px; font-size: 13px; }
    input:not([type=checkbox]) { box-sizing: border-box; width: 100%; padding: 8px; background: var(--inspector-row); color: var(--text); border: 1px solid var(--inspector-divider); font: inherit; }
    input[aria-invalid=true] { border-color: var(--danger); }
    .check { display: flex; align-items: center; gap: 8px; }
    select { width: 100%; padding: 8px; background: var(--inspector-row); color: var(--text); border: 1px solid var(--inspector-divider); }
    footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--inspector-divider); }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    .danger, .error { color: var(--danger); }
  `],
})
export class ReferenceActionDialogComponent {
  readonly git = inject(GitKhronosService);
  readonly request = input<ReferenceActionRequest | null>(null);
  // Form-control instances belong to a review, not merely to this loaded chunk.
  readonly reviews = computed(() => { const request = this.request(); return request ? [request] : []; });
  readonly ownsRequest = input.required<(request: ReferenceActionRequest) => boolean>();
  readonly closed = output<ReferenceActionRequest>();
  readonly renamed = output<ReferenceRenamed>();
  readonly remote = signal('');
  readonly remoteExpected = signal<string | null>(null);
  readonly newName = signal('');
  readonly renameOnRemote = signal(false);
  private remoteReadGeneration = 0;
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly renaming = computed(() => {
    const action = this.request()?.action;
    return action === 'rename-tag' || action === 'rename-remote-branch';
  });
  readonly nameProblem = computed(() => {
    const target = this.request();
    if (!target || !this.renaming()) return null;
    const name = this.newName().trim();
    if (!name) return 'Enter a name.';
    if (name === target.name) return null;
    const repository = this.git.repository();
    if (target.action === 'rename-tag'
      ? repository?.tags.some((tag) => tag.name === name)
      : repository?.branches.some((branch) => branch.remote && branch.name === `${target.remote}/${name}`)) {
      return target.action === 'rename-tag' ? 'A tag with this name already exists.' : 'This remote already has a branch with this name.';
    }
    return INVALID_REFERENCE_NAME.test(name) ? 'Git does not allow this name.' : null;
  });
  readonly confirmLabel = computed(() => {
    switch (this.request()?.action) {
      case 'push-tag': return 'Push tag';
      case 'delete-tag': return 'Delete local tag';
      case 'rename-tag': return this.renameOnRemote() ? 'Rename tag here and on remote' : 'Rename tag';
      case 'rename-remote-branch': return 'Rename remote branch';
      default: return 'Delete remote reference';
    }
  });
  readonly title = computed(() => {
    switch (this.request()?.action) {
      case 'push-tag': return 'Push selected tag';
      case 'delete-tag': return 'Delete local tag';
      case 'delete-remote-tag': return 'Delete tag on remote';
      case 'rename-tag': return 'Rename tag';
      case 'rename-remote-branch': return 'Rename branch on remote';
      default: return 'Delete branch on remote';
    }
  });
  readonly destination = computed(() => this.git.repository()?.remotes.find(candidate =>
    candidate.name === this.remote())?.pushUrl);
  readonly canConfirm = computed(() => {
    const target = this.request();
    if (!this.owns(target)) return false;
    if (this.renaming()) {
      if (this.newName().trim() === target.name || this.nameProblem()) return false;
      if (target.action === 'rename-remote-branch') return !!this.destination();
      return !this.renameOnRemote() || (!!this.destination() && !!this.remoteExpected());
    }
    return (target.action === 'delete-tag' || !!this.destination())
      && (target.action !== 'delete-remote-tag' || !!this.remoteExpected());
  });

  constructor() {
    effect(() => {
      const target = this.request();
      if (!target) return;
      this.remoteReadGeneration++;
      this.remote.set(target.remote ?? untracked(() => this.git.repository()?.remotes[0]?.name ?? ''));
      this.remoteExpected.set(null);
      this.newName.set(target.name);
      this.renameOnRemote.set(false);
      setTimeout(() => {
        if (!this.owns(target)) return;
        const field = this.dialog()?.nativeElement.querySelector<HTMLInputElement>('#reference-new-name');
        if (field) {
          field.focus();
          field.select();
        } else {
          this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('[data-reference-cancel]')?.focus();
        }
      });
    });
  }

  private owns(target: ReferenceActionRequest | null): target is ReferenceActionRequest {
    const repository = this.git.repository();
    return !!target && this.request() === target && this.ownsRequest()(target)
      && repository?.id === target.repositoryId && repository.path === target.repositoryPath;
  }

  changeName(name: string, target = this.request()): void {
    if (this.owns(target) && !this.git.busy()) this.newName.set(name);
  }

  changeRemote(remote: string, target = this.request()): void {
    if (!this.owns(target) || this.git.busy()) return;
    this.remoteReadGeneration++;
    this.remote.set(remote);
    this.remoteExpected.set(null);
  }

  toggleRemoteRename(enabled: boolean, target = this.request()): void {
    if (!this.owns(target) || this.git.busy()) return;
    this.remoteReadGeneration++;
    this.renameOnRemote.set(enabled);
    this.remoteExpected.set(null);
  }

  async checkRemoteTag(target = this.request()): Promise<void> {
    if (!this.owns(target) || this.git.busy()) return;
    const remote = this.remote();
    const generation = ++this.remoteReadGeneration;
    const oid = await this.git.previewRemoteTag(remote, target.name);
    if (this.owns(target) && generation === this.remoteReadGeneration && this.remote() === remote) this.remoteExpected.set(oid);
  }

  confirmFromKeyboard(event: Event, target: ReferenceActionRequest): void {
    if (event instanceof KeyboardEvent && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) void this.confirm(target);
  }

  async confirm(target = this.request()): Promise<void> {
    if (!this.owns(target) || !this.canConfirm() || this.git.busy()) return;
    let succeeded: boolean;
    if (this.renaming()) {
      const newName = this.newName().trim();
      const kind = target.action === 'rename-tag' ? 'tag' : 'remote-branch';
      const remote = kind === 'remote-branch' || this.renameOnRemote() ? this.remote() : undefined;
      succeeded = await this.git.renameReference({
        kind, name: target.name, newName, expectedOid: target.oid,
        remote: remote ?? null,
        remoteObject: kind === 'tag' && remote ? this.remoteExpected() : null,
      });
      if (succeeded && this.owns(target)) this.renamed.emit({ request: target, kind, remote, name: target.name, newName });
    } else if (target.action === 'delete-tag') {
      succeeded = await this.git.manageReference('delete-tag', target.name, { expectedOid: target.oid });
    } else {
      succeeded = await this.git.transportReference(this.remote(), target.name,
        target.action === 'delete-remote-branch' ? 'branch' : 'tag', target.action !== 'push-tag',
        target.action === 'delete-remote-branch' || target.action === 'push-tag' ? target.oid : this.remoteExpected() ?? undefined);
    }
    if (succeeded && this.owns(target)) this.close(target);
  }

  close(target = this.request()): void {
    if (!this.owns(target) || this.git.busy()) return;
    this.remoteReadGeneration++;
    this.closed.emit(target);
  }

  cancelOperation(target: ReferenceActionRequest): void {
    if (this.owns(target)) void this.git.cancelActiveOperation();
  }

  handleKey(event: KeyboardEvent, target = this.request()): void {
    if (!this.owns(target)) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(target); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])') ?? []);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (!controls.length) return;
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0].focus(); }
  }
}
