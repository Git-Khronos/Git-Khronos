import { ChangeDetectionStrategy, Component, afterNextRender, input, output } from '@angular/core';
import type { GraphActionMenuContext, GraphActionMenuView } from './app.component';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

/** Optional presentation only. Root owns requests, focus, positioning and Git writes. */
@Component({
  selector: 'gc-graph-action-menu',
  imports: [IconComponent, TextValueDirective],
  templateUrl: './graph-action-menu.component.html',
  styleUrl: './graph-action-menu.component.scss',
  host: { '[class.commit-actions]': "context().kind === 'commit'" },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphActionMenuComponent {
  readonly context = input.required<GraphActionMenuContext>();
  readonly presenter = input.required<GraphActionMenuView>();
  readonly ready = output<void>();

  constructor() {
    afterNextRender(() => this.ready.emit());
  }
}
