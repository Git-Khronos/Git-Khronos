export interface HeadHistoryEntry {
  kind: 'head';
  beforeOid: string;
  afterOid: string;
  label: string;
  undone: boolean;
}

export interface CheckoutHistoryEntry {
  kind: 'checkout';
  beforeBranch: string;
  afterBranch: string;
  label: string;
  undone: boolean;
}

export interface RenameBranchHistoryEntry {
  kind: 'rename-branch';
  beforeName: string;
  afterName: string;
  label: string;
  undone: boolean;
}

export interface DiscardHistoryEntry {
  kind: 'discard';
  label: string;
  undone: boolean;
}

export type OperationHistoryEntry =
  | HeadHistoryEntry
  | CheckoutHistoryEntry
  | RenameBranchHistoryEntry
  | DiscardHistoryEntry;

export function createHeadHistoryEntry(
  beforeOid: string | null | undefined,
  afterOid: string | null | undefined,
  label: string,
): HeadHistoryEntry | null {
  if (!beforeOid || !afterOid || beforeOid === afterOid) return null;
  return { kind: 'head', beforeOid, afterOid, label, undone: false };
}

export function createCheckoutHistoryEntry(
  beforeBranch: string | null | undefined,
  afterBranch: string | null | undefined,
): CheckoutHistoryEntry | null {
  if (!beforeBranch || !afterBranch || beforeBranch === afterBranch) return null;
  return {
    kind: 'checkout',
    beforeBranch,
    afterBranch,
    label: `Checkout ${afterBranch}`,
    undone: false,
  };
}

export function checkoutHistoryTarget(
  entry: OperationHistoryEntry,
  direction: 'undo' | 'redo',
): string | null {
  if (entry.kind !== 'checkout') return null;
  return direction === 'undo' ? entry.beforeBranch : entry.afterBranch;
}

export function headHistoryTarget(
  entry: OperationHistoryEntry,
  direction: 'undo' | 'redo',
): string | null {
  if (entry.kind !== 'head') return null;
  return direction === 'undo' ? entry.beforeOid : entry.afterOid;
}

export function createRenameBranchHistoryEntry(
  beforeName: string,
  afterName: string,
): RenameBranchHistoryEntry | null {
  const before = beforeName.trim();
  const after = afterName.trim();
  if (!before || !after || before === after) return null;
  return {
    kind: 'rename-branch',
    beforeName: before,
    afterName: after,
    label: `Rename Branch ${before} to ${after}`,
    undone: false,
  };
}

export function renameBranchHistoryTarget(
  entry: OperationHistoryEntry,
  direction: 'undo' | 'redo',
): { oldName: string; newName: string } | null {
  if (entry.kind !== 'rename-branch') return null;
  return direction === 'undo'
    ? { oldName: entry.afterName, newName: entry.beforeName }
    : { oldName: entry.beforeName, newName: entry.afterName };
}
