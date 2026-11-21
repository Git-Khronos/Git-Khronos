import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, input, output, viewChild } from '@angular/core';
import type { RepositoryWorkspace } from './git-khronos.service';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

@Component({
  selector: 'gc-workspace-edit-dialogs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TextValueDirective],
  templateUrl: './workspace-edit-dialogs.component.html',
  styleUrl: './workspace-edit-dialogs.component.scss',
})
export class WorkspaceEditDialogsComponent {
  readonly mode = input.required<'create' | 'rename' | null>();
  readonly deletingWorkspace = input.required<RepositoryWorkspace | null>();
  readonly name = input.required<string>();
  readonly nameConflict = input.required<boolean>();
  readonly busy = input.required<boolean>();
  readonly nameChanged = output<string>();
  readonly editClosed = output<void>();
  readonly editSubmitted = output<void>();
  readonly deleteClosed = output<void>();
  readonly deleteConfirmed = output<void>();
  readonly keyPressed = output<KeyboardEvent>();

  private readonly workspaceNameInput = viewChild<ElementRef<HTMLInputElement>>('workspaceNameInput');
  private readonly deleteCancel = viewChild<ElementRef<HTMLButtonElement>>('deleteCancel');

  constructor() {
    // Focus only once the deferred view's own controls exist.
    afterRenderEffect(() => {
      const field = this.workspaceNameInput()?.nativeElement;
      if (field) {
        field.focus();
        field.select();
      } else {
        this.deleteCancel()?.nativeElement.focus();
      }
    });
  }
}
