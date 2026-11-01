import type { CommandMap, RecoveryDraftRecord } from '@git-khronos/contracts';

export type EditorDraftReference = Parameters<CommandMap['load_editor_draft_entry']>[0];
export type EditorDraftOpenRequest = Pick<RecoveryDraftRecord, 'repositoryPath' | 'path'> & {
  reference: EditorDraftReference;
};

/** One exact-token delete, followed only by read-only reconciliation on error. */
export async function discardReviewedEditorDraft(
  transport: Pick<CommandMap, 'discard_editor_draft_entry' | 'inspect_editor_drafts'>,
  reference: EditorDraftReference,
): Promise<void> {
  try { await transport.discard_editor_draft_entry(reference); }
  catch (error) {
    const inspection = await transport.inspect_editor_drafts().catch(() => null);
    if (inspection && !inspection.incomplete
      && !inspection.entries.some(entry => entry.id === reference.id && entry.kind === reference.kind)) return;
    throw error;
  }
}
