import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TextValueDirective } from './text-value.directive';
import type { GraphRowView, WorktreeWipRow } from './app.component';
import { IconComponent } from './icon.component';

@Component({
  selector: 'gc-worktree-graph-row',
  imports: [TextValueDirective, IconComponent],
  templateUrl: './worktree-graph-row.component.html',
  styles: ':host { display: contents; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeGraphRowComponent {
  readonly presenter = input.required<GraphRowView>();
  readonly worktreeRow = input.required<WorktreeWipRow>();
}
