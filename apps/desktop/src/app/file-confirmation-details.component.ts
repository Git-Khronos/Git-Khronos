import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, input, output, signal, untracked } from '@angular/core';
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
  protected readonly oversizedPaths = computed(() => new Set(this.action().preview?.oversizedPaths ?? []));
  protected readonly pathQuery = signal('');
  protected readonly selectedPathSet = computed(() => new Set(this.selectedPaths()));
  protected readonly visibleChoicePaths = computed(() => {
    const paths = this.choicePaths() ?? [];
    const query = this.pathQuery().trim().toLowerCase();
    return query ? paths.filter(path => path.toLowerCase().includes(query)) : paths;
  });
  protected readonly hiddenSelectedCount = computed(() => {
    const visible = new Set(this.visibleChoicePaths());
    return this.selectedPaths().filter(path => !visible.has(path)).length;
  });

  constructor() {
    afterRenderEffect(() => {
      const action = this.action();
      if (action.kind !== 'discard-bulk' || this.choicePaths() === null) {
        this.pathQuery.set('');
        untracked(() => this.ready.emit(action));
      }
    });
  }
}
