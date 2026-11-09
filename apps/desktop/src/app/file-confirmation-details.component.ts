import { afterNextRender, ChangeDetectionStrategy, Component, input, output } from '@angular/core';
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
  selector: 'gc-file-confirmation-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-confirmation-details.component.html',
  styleUrl: './file-confirmation-details.component.scss',
})
export class FileConfirmationDetailsComponent {
  readonly action = input.required<PendingFileAction>();
  readonly ready = output<void>();
  protected readonly displayRecoveryPath = displayRecoveryPath;

  constructor() {
    afterNextRender(() => this.ready.emit());
  }
}
