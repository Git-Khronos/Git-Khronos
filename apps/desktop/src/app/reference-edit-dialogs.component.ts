import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input } from '@angular/core';
import type { TagCreationView, BranchUpstreamView } from './app.component';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

@Component({
  selector: 'gk-tag-creation-dialog',
  imports: [IconComponent, TextValueDirective],
  templateUrl: './tag-creation-dialog.component.html',
  styleUrl: './reference-edit-dialogs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagCreationDialogComponent {
  readonly view = input.required<TagCreationView>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLElement>('[name=tagName]:not(:disabled), button:not(:disabled)')?.focus());
  }
}

@Component({
  selector: 'gk-branch-upstream-dialog',
  imports: [IconComponent],
  templateUrl: './branch-upstream-dialog.component.html',
  styleUrl: './reference-edit-dialogs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchUpstreamDialogComponent {
  readonly view = input.required<BranchUpstreamView>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLElement>('[name=branchUpstream]:not(:disabled), button:not(:disabled)')?.focus());
  }
}
