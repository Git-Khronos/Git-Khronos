import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, input } from '@angular/core';
import type { GraphRow, GraphRowView } from './app.component';
import { GraphRowComponent } from './graph-row.component';

@Component({
  selector: 'gk-graph-viewport',
  imports: [GraphRowComponent],
  template: `
    <div class="virtual-commit-rows">
      @for (slot of slotsSource()(); track $index) { @if (slot) {
        <gk-graph-row [presenter]="presenter()" [graphRow]="slot.row" [top]="slot.top" />
      } }
    </div>
  `,
  styles: ':host { display: contents; } .virtual-commit-rows { position: relative; width: 100%; height: 100%; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphViewportComponent {
  readonly slotsSource = input.required<() => ({ row: GraphRow; top: number } | null)[]>();
  readonly presenter = input.required<GraphRowView>();
  private readonly changeDetector = inject(ChangeDetectorRef);

  render(): void {
    this.changeDetector.detectChanges();
  }
}
