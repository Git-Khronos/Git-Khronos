import type { RepositoryOperation, RepositoryStatus } from '@git-khronos/contracts';

type OperationFields = 'mergeInProgress' | 'historyOperation' | 'historyNoCommit'
  | 'rebaseInProgress' | 'rebaseEditStopped' | 'rebaseSplit' | 'mailPatchInProgress' | 'bisectInProgress';

export type RepositoryOperationView = Pick<RepositoryStatus, OperationFields>;

/** Project native observations without choosing one operation over its siblings. */
export function repositoryOperationState(status: RepositoryStatus | null | undefined): RepositoryOperationView {
  const view: RepositoryOperationView = {
    mergeInProgress: false, historyOperation: null, historyNoCommit: false,
    rebaseInProgress: false, rebaseEditStopped: false, rebaseSplit: null,
    mailPatchInProgress: false, bisectInProgress: status?.bisectInProgress ?? false,
  };
  if (!status) return view;
  // Preview and older snapshot producers deliberately omit typed observations.
  if (status.operations == null) return {
    mergeInProgress: status.mergeInProgress, historyOperation: status.historyOperation,
    historyNoCommit: status.historyNoCommit, rebaseInProgress: status.rebaseInProgress,
    rebaseEditStopped: status.rebaseEditStopped, rebaseSplit: status.rebaseSplit,
    mailPatchInProgress: status.mailPatchInProgress, bisectInProgress: status.bisectInProgress,
  };
  for (const operation of status.operations) applyOperation(view, operation);
  return view;
}

function applyOperation(view: RepositoryOperationView, operation: RepositoryOperation): void {
  switch (operation.kind) {
    case 'merge': view.mergeInProgress = true; break;
    case 'cherryPick':
      view.historyOperation = 'cherry-pick';
      view.historyNoCommit = operation.noCommit;
      break;
    case 'revert':
      view.historyOperation = 'revert';
      view.historyNoCommit = operation.noCommit;
      break;
    case 'rebase':
      view.rebaseInProgress = true;
      view.rebaseEditStopped = operation.editStopped;
      view.rebaseSplit = operation.split;
      break;
    case 'mailPatch': view.mailPatchInProgress = true; break;
    default: {
      const exhaustive: never = operation;
      throw new Error(`Unsupported repository operation: ${JSON.stringify(exhaustive)}`);
    }
  }
}
