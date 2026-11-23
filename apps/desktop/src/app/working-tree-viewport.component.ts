import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, input, type TemplateRef } from '@angular/core';

export type WorkingTreeFileListSection = 'unstaged' | 'staged';
type WorkingTreeViewportContext = { $implicit: WorkingTreeFileListSection };

@Component({
  selector: 'gk-working-tree-viewport',
  imports: [NgTemplateOutlet],
  template: '<ng-container [ngTemplateOutlet]="content()" [ngTemplateOutletContext]="{ $implicit: section() }" />',
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkingTreeViewportComponent {
  readonly content = input.required<TemplateRef<WorkingTreeViewportContext>>();
  readonly section = input.required<WorkingTreeFileListSection>();
  private readonly changeDetector = inject(ChangeDetectorRef);

  render(): void {
    this.changeDetector.detectChanges();
  }
}
