import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { AppComponent } from './app.component';
import { IconComponent } from './icon.component';

@Component({
  selector: 'gc-graph-settings-options',
  imports: [IconComponent],
  templateUrl: './graph-settings-options.component.html',
  styleUrl: './graph-settings-options.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphSettingsOptionsComponent {
  readonly model = input.required<AppComponent['graphSettingsView']>();
}
