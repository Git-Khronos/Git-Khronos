import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

export interface CommitEditFieldChange {
  field: 'authorName' | 'authorEmail' | 'summary' | 'description';
  value: string;
}

export interface CommitEditFormView {
  authorName(): string;
  authorEmail(): string;
  summary(): string;
  description(): string;
  coAuthors(): readonly { name: string; email: string }[];
  authorValid(): boolean;
  published(): boolean;
  rewriteCount(): number;
  busy(): boolean;
  authorColor(name: string, email: string): string;
  initials(name: string): string;
}

@Component({
  selector: 'gk-commit-edit-form',
  imports: [IconComponent, TextValueDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './commit-edit-form.component.html',
  styleUrl: './commit-edit-form.component.scss',
})
export class CommitEditFormComponent {
  readonly model = input.required<CommitEditFormView>();
  readonly changed = output<CommitEditFieldChange>();
  readonly removed = output<string>();
  readonly saved = output<void>();
  readonly dismissed = output<void>();
  private readonly summaryInput = viewChild.required<ElementRef<HTMLInputElement>>('editedCommitSummaryInput');

  focusSummary(): void {
    const field = this.summaryInput().nativeElement;
    field.focus();
    field.select();
  }
}
