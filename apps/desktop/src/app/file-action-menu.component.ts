import { ChangeDetectionStrategy, Component, afterNextRender, input, output } from '@angular/core';
import type { FileActionMenu } from './app.component';
import { IconComponent } from './icon.component';

export type FileMenuAction = 'merge-tool' | 'content' | 'take-current' | 'take-incoming' | 'changes'
  | 'stage-toggle' | 'lfs' | 'discard' | 'ignore-file' | 'ignore-extension' | 'ignore-directory'
  | 'history' | 'blame' | 'apply-stash' | 'restore' | 'copy-path';

@Component({
  selector: 'gk-file-action-menu',
  imports: [IconComponent],
  templateUrl: './file-action-menu.component.html',
  styleUrl: './file-action-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileActionMenuComponent {
  readonly context = input.required<FileActionMenu>();
  readonly busy = input.required<boolean>();
  readonly hasExtension = input.required<boolean>();
  readonly hasParentDirectory = input.required<boolean>();
  readonly stash = input.required<boolean>();
  readonly ready = output<FileActionMenu>();
  readonly chosen = output<{ request: FileActionMenu; action: FileMenuAction }>();

  constructor() {
    afterNextRender(() => this.ready.emit(this.context()));
  }

  protected choose(action: FileMenuAction): void {
    this.chosen.emit({ request: this.context(), action });
  }
}
