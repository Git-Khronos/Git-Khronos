import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, input, linkedSignal, output, viewChild } from '@angular/core';
import type { ConflictDetails } from '@git-khronos/contracts';
import { BackgroundOperationWarningsComponent } from './background-operation-warnings.component';
import { GitKhronosService } from './git-khronos.service';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

export type ConflictEditorAction =
  | { kind: 'close' | 'reload' | 'external' }
  | { kind: 'copy'; side: 'current' | 'incoming' }
  | { kind: 'edit'; value: string }
  | { kind: 'resolve'; side: 'current' | 'incoming' | 'output' }
  | { kind: 'dismissWarning'; id: string; event: MouseEvent };

@Component({
  selector: 'gk-conflict-editor',
  imports: [BackgroundOperationWarningsComponent, IconComponent, TextValueDirective],
  templateUrl: './conflict-editor.component.html',
  styleUrl: './conflict-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConflictEditorComponent {
  readonly details = input.required<ConflictDetails>();
  readonly draft = input.required<string>();
  readonly suspended = input.required<boolean>();
  readonly ownsDetails = input.required<(details: ConflictDetails) => boolean>();
  readonly requested = output<{ conflict: ConflictDetails; action: ConflictEditorAction }>();
  readonly keyPressed = output<{ conflict: ConflictDetails; event: KeyboardEvent }>();
  protected readonly git = inject(GitKhronosService);
  protected readonly copyFeedback = linkedSignal({ source: this.details, computation: (): string => '' });
  private draftCopyRequest = 0;
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    afterNextRender(() => {
      if (!this.suspended() && this.ownsDetails()(this.details())) this.closeButton()?.nativeElement.focus();
    });
  }

  protected async copyDraft(conflict: ConflictDetails): Promise<void> {
    if (this.suspended() || !this.ownsDetails()(conflict) || !conflict.editable) return;
    const request = ++this.draftCopyRequest;
    const value = this.draft();
    const current = () => request === this.draftCopyRequest && !this.suspended() && this.ownsDetails()(conflict);
    this.copyFeedback.set('');
    try {
      await navigator.clipboard.writeText(value);
      if (current()) this.copyFeedback.set('Copied merge draft.');
    } catch {
      if (current()) this.copyFeedback.set('Could not copy the merge draft. Clipboard access is unavailable.');
    }
  }

  protected act(conflict: ConflictDetails, action: ConflictEditorAction): void {
    if (!this.suspended() && this.ownsDetails()(conflict)) this.requested.emit({ conflict, action });
  }
}
