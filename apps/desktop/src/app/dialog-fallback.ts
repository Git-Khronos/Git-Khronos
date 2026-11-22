import { afterNextRender, Directive, ElementRef, inject } from '@angular/core';

export interface DialogFallbackCopy {
  loading: [label: string, message: string];
  unavailable: [label: string, message: string];
  wide?: boolean;
  footer?: boolean;
  layer?: number;
  loadingButton?: string;
}

/** Eager, inert copy for dialogs whose actual controls are loaded on demand. */
export const DIALOG_FALLBACKS = {
  repositoryLink: {
    loading: ['Opening repository link controls', 'Opening link controls…'],
    unavailable: ['Repository link controls unavailable', 'Link controls could not open. Preserve drafts and restart to try again.'],
  },
  editorDrafts: {
    loading: ['Loading editor draft recovery', 'Loading recovery controls…'],
    unavailable: ['Editor draft recovery unavailable', 'Recovery controls could not load. Stored copies were preserved. Restart to try again.'],
  },
  windowsLauncher: {
    loading: ['Loading Windows taskbar shortcut check', 'Loading shortcut check…'],
    unavailable: ['Windows taskbar shortcut check unavailable', 'The shortcut check could not load. No shortcuts were changed. Restart to try again.'],
  },
  fileTools: {
    loading: ['Opening external file tools', 'Opening file tools…'],
    unavailable: ['External file tools unavailable', 'File tools could not load. Save your work before restarting the application.'],
    layer: 175,
  },
  fileContent: {
    loading: ['Opening file content', 'Opening file content…'],
    unavailable: ['File content unavailable', 'File content could not open. Preserve drafts and restart to try again.'],
    layer: 170,
  },
  integration: {
    loading: ['Loading merge and rebase options', 'Loading…'],
    unavailable: ['Merge and rebase options unavailable', 'Could not load merge and rebase options. Close and restart Git Khronos to try again.'],
    wide: true, footer: true, loadingButton: 'Close',
  },
  mergePreview: {
    loading: ['Loading merge preview', 'Loading merge preview…'],
    unavailable: ['Merge preview unavailable', 'Could not load merge preview. Close and restart Git Khronos to try again.'],
    wide: true, footer: true, loadingButton: 'Close',
  },
  workspaceCenter: {
    loading: ['Loading workspace center', 'Loading workspace center…'],
    unavailable: ['Workspace center unavailable', 'Could not load workspace center. Close and restart Git Khronos to try again.'],
    wide: true, loadingButton: 'Close',
  },
  branchWorkflow: {
    loading: ['Loading branch workflows', 'Loading branch workflows…'],
    unavailable: ['Branch workflows unavailable', 'Could not load branch workflows. Close and restart Git Khronos to try again.'],
    wide: true, loadingButton: 'Close',
  },
} satisfies Record<string, DialogFallbackCopy>;

export type DialogFallbackKind = keyof typeof DIALOG_FALLBACKS;

@Directive({ selector: 'button[gcDialogFallbackFocus]' })
export class DialogFallbackFocusDirective {
  constructor() {
    const button = inject<ElementRef<HTMLButtonElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (button.isConnected && !button.closest('[inert]') && button.getClientRects().length) button.focus();
    });
  }
}
