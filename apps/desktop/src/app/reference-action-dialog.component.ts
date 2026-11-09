import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GitKhronosService } from './git-khronos.service';
import { GitHelpComponent } from './git-help.component';

export interface ReferenceActionRequest {
  action: 'push-tag' | 'delete-tag' | 'delete-remote-tag' | 'delete-remote-branch';
  repositoryId: string;
  name: string;
  oid: string;
  remote?: string;
  returnFocus: HTMLElement | null;
}

@Component({
  selector: 'gc-reference-action-dialog',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as target) {
      <div class="backdrop" (click)="close()">
        <section #dialog role="alertdialog" aria-modal="true" aria-labelledby="reference-action-title"
          aria-describedby="reference-action-description" (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
          <h2 id="reference-action-title">{{ title() }}</h2>
          <p id="reference-action-description">
            @if (target.action === 'delete-tag') {
              Delete only the local tag. Remote tags and working files are unchanged.
              Its object is preserved under a Git Khronos recovery reference.
            } @else if (target.action === 'push-tag') {
              Push only this tag. Other tags and branches are unchanged. An existing different remote tag is not overwritten.
            } @else {
              Delete only this reference from the selected remote's push destination.
              Local branches, local tags and working files are unchanged.
              Git refuses deletion if the remote reference has moved from the expected object.
            }
          </p>
          <code>{{ target.name }}</code>
          <gc-git-help [topic]="target.action === 'delete-remote-branch' ? 'push' : 'tag'" label="Learn about local and remote references…" />
          @if (target.action !== 'delete-tag') {
            <label for="reference-remote">Remote</label>
              <select id="reference-remote" name="referenceRemote" [ngModel]="remote()" (ngModelChange)="changeRemote($event)"
                [disabled]="git.busy() || target.action === 'delete-remote-branch'">
                @for (candidate of git.repository()?.remotes ?? []; track candidate.name) {
                  <option [value]="candidate.name">{{ candidate.name }}</option>
                }
              </select>
            <p class="destination">{{ destination() || 'No remote configured' }}</p>
          }
          @if (target.action === 'delete-remote-tag') {
            <button type="button" [disabled]="!remote() || git.busy()" (click)="checkRemoteTag()">Check remote tag</button>
            <p>{{ remoteExpected() ? 'Expected remote object: ' + remoteExpected() : 'Check the remote tag before confirming deletion.' }}</p>
          } @else if (target.action === 'delete-remote-branch') {
            <p>Expected remote commit: <code>{{ target.oid }}</code></p>
          }
          @if (git.error()) { <p class="error" role="alert">{{ git.error() }}</p> }
          <footer>
            @if (git.busy()) { <button type="button" (click)="git.cancelActiveOperation()">Cancel operation</button> }
            <button type="button" data-reference-cancel [disabled]="git.busy()" (click)="close()">Cancel</button>
            <button type="button" [class.danger]="target.action !== 'push-tag'"
              [disabled]="!canConfirm() || git.busy()" (click)="confirm()">
              {{ target.action === 'push-tag' ? 'Push tag' : target.action === 'delete-tag' ? 'Delete local tag' : 'Delete remote reference' }}
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
    label { display: grid; gap: 6px; margin-top: 14px; font-size: 13px; }
    select { width: 100%; padding: 8px; background: var(--inspector-row); color: var(--text); border: 1px solid var(--inspector-divider); }
    footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    button { padding: 8px 12px; border-radius: 4px; background: var(--inspector-row); color: var(--text); }
    .danger, .error { color: var(--danger); }
  `],
})
export class ReferenceActionDialogComponent {
  readonly git = inject(GitKhronosService);
  readonly request = input<ReferenceActionRequest | null>(null);
  readonly closed = output<void>();
  readonly remote = signal('');
  readonly remoteExpected = signal<string | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly title = computed(() => {
    switch (this.request()?.action) {
      case 'push-tag': return 'Push selected tag';
      case 'delete-tag': return 'Delete local tag';
      case 'delete-remote-tag': return 'Delete tag on remote';
      default: return 'Delete branch on remote';
    }
  });
  readonly destination = computed(() => this.git.repository()?.remotes.find(candidate =>
    candidate.name === this.remote())?.pushUrl);
  readonly canConfirm = computed(() => {
    const target = this.request();
    return !!target && target.repositoryId === this.git.activeRepositoryId()
      && (target.action === 'delete-tag' || !!this.destination())
      && (target.action !== 'delete-remote-tag' || !!this.remoteExpected());
  });

  constructor() {
    effect(() => {
      const target = this.request();
      if (!target) return;
      this.remote.set(target.remote ?? untracked(() => this.git.repository()?.remotes[0]?.name ?? ''));
      this.remoteExpected.set(null);
      setTimeout(() => {
        if (this.request() === target) this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('[data-reference-cancel]')?.focus();
      });
    });
  }

  changeRemote(remote: string): void {
    this.remote.set(remote);
    this.remoteExpected.set(null);
  }

  async checkRemoteTag(): Promise<void> {
    const target = this.request();
    const remote = this.remote();
    if (!target) return;
    const oid = await this.git.previewRemoteTag(remote, target.name);
    if (this.request() === target && this.remote() === remote) this.remoteExpected.set(oid);
  }

  async confirm(): Promise<void> {
    const target = this.request();
    if (!target || !this.canConfirm() || this.git.busy()) return;
    if (target.action === 'delete-tag') {
      await this.git.manageReference('delete-tag', target.name, { expectedOid: target.oid });
    } else {
      await this.git.transportReference(this.remote(), target.name,
        target.action === 'delete-remote-branch' ? 'branch' : 'tag', target.action !== 'push-tag',
        target.action === 'delete-remote-branch' || target.action === 'push-tag' ? target.oid : this.remoteExpected() ?? undefined);
    }
    if (!this.git.error() && this.request() === target) this.close();
  }

  close(): void {
    if (this.git.busy()) return;
    const opener = this.request()?.returnFocus;
    this.closed.emit();
    setTimeout(() => { if (opener?.isConnected) opener.focus(); });
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])') ?? []);
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (!controls.length) return;
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0].focus(); }
  }
}
