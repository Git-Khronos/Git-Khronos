import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

export interface RepositoryTabMenuView {
  readonly requestId: number;
  readonly label: string;
  readonly path: string;
  readonly editing: boolean;
  readonly alias: string;
  readonly canShare: boolean;
  readonly favorite: boolean;
  readonly canMoveLeft: boolean;
  readonly canMoveRight: boolean;
  readonly shortcutKey: string;
  readonly rightCount: number;
  readonly otherCount: number;
}

type Action =
  | { kind: 'alias'; value: string }
  | { kind: 'move'; direction: -1 | 1 }
  | { kind: 'save-alias' | 'cancel-alias' | 'begin-alias' | 'share' | 'terminal' | 'folder'
      | 'favorite' | 'close-right' | 'close-others' | 'close' };

export type RepositoryTabMenuAction = Action & { requestId: number };

@Component({
  selector: 'gc-repository-tab-menu-content',
  imports: [IconComponent, TextValueDirective],
  templateUrl: './repository-tab-menu-content.component.html',
  styleUrl: './repository-tab-menu-content.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryTabMenuContentComponent {
  readonly view = input.required<RepositoryTabMenuView>();
  readonly action = output<RepositoryTabMenuAction>();

  protected send(view: RepositoryTabMenuView, action: Action): void {
    this.action.emit({ ...action, requestId: view.requestId });
  }
}
