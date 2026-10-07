import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, input } from '@angular/core';
import type { GraphRow, GraphRowView } from './app.component';
import { GraphRowComponent } from './graph-row.component';
import type { VirtualWindow } from './virtual-list';

@Component({
  selector: 'gc-graph-viewport',
  imports: [GraphRowComponent],
  template: `
    @let window = windowSource()();
    <div class="virtual-commit-rows"
      [style.height.px]="window.topPadding + window.items.length * 40 + window.bottomPadding"
      [style.min-width.px]="widthSource()()">
      @for (slot of slotsSource()(); track $index) { @if (slot) {
        <gc-graph-row [presenter]="presenter()" [graphRow]="slot.row" [top]="slot.top" />
      } }
    </div>
  `,
  styles: ':host { display: contents; } .virtual-commit-rows { position: relative; width: 100%; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphViewportComponent {
  readonly windowSource = input.required<() => VirtualWindow<GraphRow>>();
  readonly slotsSource = input.required<() => ({ row: GraphRow; top: number } | null)[]>();
  readonly widthSource = input.required<() => number>();
  readonly presenter = input.required<GraphRowView>();
  private readonly changeDetector = inject(ChangeDetectorRef);

  render(): void {
    this.changeDetector.detectChanges();
  }
}
