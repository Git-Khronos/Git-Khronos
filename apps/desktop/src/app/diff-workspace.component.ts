import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import type { AppComponent } from './app.component';
import { FileBlameComponent } from './file-blame.component';
import { FileHistoryComponent } from './file-history.component';
import { FileMediaComponent } from './file-media.component';
import { IconComponent } from './icon.component';

@Component({
  selector: 'gc-diff-workspace',
  imports: [IconComponent, FileBlameComponent, FileHistoryComponent, FileMediaComponent],
  templateUrl: './diff-workspace.component.html',
  styleUrl: './diff-workspace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Retain the established responsive shell and theme selector specificity.
  encapsulation: ViewEncapsulation.None,
})
export class DiffWorkspaceComponent {
  readonly model = input.required<AppComponent['diffWorkspaceView']>();
}
