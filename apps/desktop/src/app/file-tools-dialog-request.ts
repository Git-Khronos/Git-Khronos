import type { FileToolRequest } from '@git-khronos/contracts';

export interface FileToolsDialogRequest {
  id: string;
  repoId: string;
  action: FileToolRequest | null;
  returnFocus: HTMLElement | null;
}
