import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, input, type TemplateRef } from '@angular/core';

@Component({
  selector: 'gc-working-tree-viewport',
  imports: [NgTemplateOutlet],
  template: '<ng-container [ngTemplateOutlet]="content()" />',
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkingTreeViewportComponent {
  readonly content = input.required<TemplateRef<unknown>>();
  private readonly changeDetector = inject(ChangeDetectorRef);

  render(): void {
    this.changeDetector.detectChanges();
  }
}
