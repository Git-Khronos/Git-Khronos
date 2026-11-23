import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';

export type BranchDropStrategy = 'merge' | 'ff-only' | 'squash' | 'rebase';
export interface BranchDropAdvice {
  text: string;
  recommended: 'ff-only' | 'merge' | null;
  fastForwardBlocked: boolean;
}

@Component({
  selector: 'gk-branch-drop-menu',
  imports: [IconComponent],
  templateUrl: './branch-drop-menu.component.html',
  styleUrl: './branch-drop-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchDropMenuComponent {
  readonly source = input.required<string>();
  readonly target = input.required<string>();
  readonly busy = input.required<boolean>();
  readonly advice = input.required<BranchDropAdvice | null>();

  readonly strategy = output<BranchDropStrategy>();
  readonly interactive = output<void>();
  readonly compare = output<void>();
  readonly cancel = output<void>();
}
