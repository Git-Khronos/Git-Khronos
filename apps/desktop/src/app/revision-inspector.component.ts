import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, type TemplateRef, input, viewChild } from '@angular/core';
import type { FileChangeStats, RevisionInspectorView } from './app.component';
import { CommitEditFormComponent } from './commit-edit-form.component';
import { CommitReferenceStripComponent } from './commit-reference-strip.component';
import { CommitSignatureComponent } from './commit-signature.component';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

/** On-demand presentation; checkout and review state remain in the app shell. */
@Component({
  selector: 'gk-revision-inspector',
  imports: [DatePipe, NgTemplateOutlet, CommitEditFormComponent, CommitReferenceStripComponent,
    CommitSignatureComponent, IconComponent, TextValueDirective],
  templateUrl: './revision-inspector.component.html',
  styleUrl: './revision-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RevisionInspectorComponent {
  readonly model = input.required<RevisionInspectorView>();
  readonly workingChanges = input.required<number>();
  readonly recap = input.required<TemplateRef<{ $implicit: FileChangeStats }>>();

  readonly referenceStrip = viewChild<CommitReferenceStripComponent>('commitReferenceStrip');
  readonly editForm = viewChild<CommitEditFormComponent>('commitEditForm');
  readonly editFallback = viewChild<ElementRef<HTMLButtonElement>>('commitEditFallback');
  readonly editTrigger = viewChild<ElementRef<HTMLButtonElement>>('commitEditTrigger');
}
