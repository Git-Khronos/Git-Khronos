import { afterRenderEffect, ChangeDetectionStrategy, Component, input, output, untracked } from '@angular/core';
import type { DiscardPreview, DiscardRecovery } from '@git-khronos/contracts';
import { displayRecoveryPath } from './discard-recovery-display';

export interface PendingFileAction {
  kind: 'discard' | 'discard-bulk' | 'recover-discard' | 'forget-discard' | 'discard-hunk' | 'discard-lines' | 'ignore' | 'restore-commit';
  path: string;
  untracked: boolean;
  oid?: string;
  paths?: string[];
  patternKind?: 'file' | 'extension' | 'directory';
  staged?: boolean;
  hunkIndex?: number;
  lineIndices?: number[];
  expectedPatch?: string;
  preview?: DiscardPreview;
  repositoryId?: string;
  recovery?: DiscardRecovery;
}

@Component({
  selector: 'gk-file-confirmation-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-confirmation-details.component.html',
  styleUrl: './file-confirmation-details.component.scss',
})
export class FileConfirmationDetailsComponent {
  readonly action = input.required<PendingFileAction>();
  readonly choicePaths = input.required<readonly string[] | null>();
  readonly selectedPaths = input.required<readonly string[]>();
  readonly busy = input.required<boolean>();
  readonly loading = input.required<boolean>();
  readonly error = input.required<string | null>();
  readonly ready = output<PendingFileAction>();
  readonly togglePath = output<string>();
  readonly selectAllChanged = output<boolean>();
  protected readonly displayRecoveryPath = displayRecoveryPath;

  constructor() {
    afterRenderEffect(() => {
      const action = this.action();
      if (action.kind !== 'discard-bulk' || this.choicePaths() === null) untracked(() => this.ready.emit(action));
    });
  }
}
