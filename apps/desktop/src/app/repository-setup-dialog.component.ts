import { RepositoryFormStylesComponent } from './repository-form-styles.component';
import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, inject, input, untracked, viewChild } from '@angular/core';
import type { Signal, WritableSignal } from '@angular/core';
import { GitKhronosService } from './git-khronos.service';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

export interface RepositoryEditorOwner {
  readonly repositoryId: string;
  readonly repositoryPath: string;
}

export type RemoteLocationIcon = 'remote' | 'server' | 'globe' | 'link';
export type RemoteDialogMode = 'add' | 'edit';

export type RepositorySetupRequest =
  | { readonly kind: 'worktree' | 'submodule'; readonly owner: RepositoryEditorOwner }
  | { readonly kind: 'remote'; readonly owner: RepositoryEditorOwner; readonly mode: RemoteDialogMode };

/** Rendering surface only: the root retains native actions, drafts and return focus. */
export interface RepositorySetupView {
  readonly worktreeBranch: WritableSignal<string>;
  readonly worktreeBase: WritableSignal<string>;
  readonly worktreeFolder: WritableSignal<string>;
  readonly worktreeHandoff: WritableSignal<'none' | 'terminal'>;
  readonly worktreeParent: Signal<string>;
  readonly worktreeCreationSource: Signal<string | null>;
  readonly submoduleUrl: WritableSignal<string>;
  readonly submodulePath: WritableSignal<string>;
  readonly remoteName: WritableSignal<string>;
  readonly remoteNameTaken: Signal<boolean>;
  readonly remoteDialogOriginalName: Signal<string>;
  readonly remoteDialogIcon: WritableSignal<RemoteLocationIcon>;
  readonly remoteUrl: WritableSignal<string>;
  readonly remotePushUrl: WritableSignal<string>;
  readonly remoteIconOptions: readonly { value: RemoteLocationIcon; label: string }[];
  readonly editedRemotePushUrl: () => string;
  readonly owns: (request: RepositorySetupRequest) => boolean;
  readonly close: (request: RepositorySetupRequest) => void;
  readonly submit: (request: RepositorySetupRequest) => void;
  readonly browseWorktree: (request: RepositorySetupRequest) => void;
  readonly removeRemote: (request: RepositorySetupRequest) => void;
  readonly trapTab: (event: KeyboardEvent) => void;
}

@Component({
  selector: 'gk-repository-setup-dialog',
  imports: [RepositoryFormStylesComponent, IconComponent, TextValueDirective],
  templateUrl: './repository-setup-dialog.component.html',
  styleUrl: './repository-setup-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositorySetupDialogComponent {
  readonly request = input.required<RepositorySetupRequest>();
  readonly view = input.required<RepositorySetupView>();
  protected readonly git = inject(GitKhronosService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  private readonly focusRenderedRequest = afterRenderEffect(() => {
    const request = this.request();
    const dialog = this.dialog()?.nativeElement;
    if (!dialog || !untracked(() => this.view().owns(request))) return;
    const first = request.kind === 'remote' && request.mode === 'edit'
      ? 'input[name="remoteUrl"]:not(:disabled)'
      : 'input:not([readonly]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';
    (dialog.querySelector<HTMLElement>(first)
      ?? dialog.querySelector<HTMLElement>('footer button:not(:disabled)')
      ?? dialog.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
  });

  protected handleKey(event: KeyboardEvent, request: RepositorySetupRequest): void {
    const view = this.view();
    if (!view.owns(request)) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      view.close(request);
    } else {
      view.trapTab(event);
    }
  }
}
