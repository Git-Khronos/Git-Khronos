import { afterNextRender, ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Submodule, Worktree } from '@git-khronos/contracts';
import { IconComponent } from './icon.component';

export type SidebarItemActionsView = { busy: boolean } & (
  { kind: 'worktree'; item: Worktree; open: boolean } | { kind: 'submodule'; item: Submodule }
);

export type SidebarItemAction = 'open' | 'copy-path' | 'move' | 'repair' | 'registrations'
  | 'toggle-lock' | 'remove' | 'remove-and-delete' | 'initialize' | 'update' | 'copy-url';

@Component({
  selector: 'gc-sidebar-item-actions',
  imports: [IconComponent],
  templateUrl: './sidebar-item-actions.component.html',
  styleUrl: './sidebar-item-actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarItemActionsComponent {
  readonly view = input.required<SidebarItemActionsView>();
  readonly ready = output<SidebarItemActionsView>();
  readonly chosen = output<{ view: SidebarItemActionsView; action: SidebarItemAction }>();

  constructor() {
    afterNextRender(() => this.ready.emit(this.view()));
  }

  protected choose(action: SidebarItemAction): void {
    this.chosen.emit({ view: this.view(), action });
  }
}
