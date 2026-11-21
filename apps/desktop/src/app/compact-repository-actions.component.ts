import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

export type CompactRepositoryAction =
  | 'switchBranch' | 'fetchAll' | 'fetchOptions' | 'terminal' | 'undo' | 'redo'
  | 'stashAll' | 'stashOptions' | 'popStash' | 'pullLfs' | 'pruneLfs'
  | 'editSparse' | 'reapplySparse' | 'disableSparse'
  | { readonly remote: string };

export interface CompactRepositoryActionsView {
  readonly repositoryId: string;
  readonly repositoryPath: string;
  readonly repositoryName: string;
  readonly branchName: string;
  readonly selectedRemote: string | null;
  readonly remoteTarget: string | null;
  readonly remotes: readonly { readonly name: string; readonly icon: IconName }[];
  readonly busy: boolean;
  readonly fetchDisabled: boolean;
  readonly terminalShown: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly undoShortcut: string;
  readonly redoShortcut: string;
  readonly primaryShortcut: string;
  readonly alternateShortcut: string;
  readonly hasChanges: boolean;
  readonly hasStashes: boolean;
  readonly lfsEnabled: boolean;
  readonly lfsAvailable: boolean;
  readonly sparseEnabled: boolean;
}

/** The root retains keyboard intent, repository identity and Git dispatch. */
@Component({
  selector: 'div[gcCompactRepositoryActions]',
  imports: [IconComponent],
  templateUrl: './compact-repository-actions.component.html',
  styleUrl: './compact-repository-actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactRepositoryActionsComponent {
  readonly view = input.required<CompactRepositoryActionsView>();
  readonly activate = output<CompactRepositoryAction>();
  readonly ready = output<HTMLElement>();

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement;
    afterNextRender(() => this.ready.emit(host));
  }
}
