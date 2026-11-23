import { ChangeDetectionStrategy, Component, afterNextRender, input, output } from '@angular/core';
import type { StashContextMenuState } from './app.component';
import { IconComponent } from './icon.component';

export type StashMenuAction = 'apply' | 'apply-options' | 'branch' | 'pop' | 'rename'
  | 'visibility' | 'hide-all' | 'show-all' | 'delete' | 'clear-all';

@Component({
  selector: 'gk-stash-action-menu',
  imports: [IconComponent],
  templateUrl: './stash-action-menu.component.html',
  styleUrl: './stash-action-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StashActionMenuComponent {
  readonly request = input.required<StashContextMenuState>();
  readonly busy = input.required<boolean>();
  readonly hidden = input.required<boolean>();
  readonly canHideAll = input.required<boolean>();
  readonly canShowAll = input.required<boolean>();
  readonly ready = output<StashContextMenuState>();
  readonly chosen = output<{ request: StashContextMenuState; action: StashMenuAction }>();

  constructor() {
    afterNextRender(() => this.ready.emit(this.request()));
  }

  protected choose(action: StashMenuAction): void {
    this.chosen.emit({ request: this.request(), action });
  }
}
