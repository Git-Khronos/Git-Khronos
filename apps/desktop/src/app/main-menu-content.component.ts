import { ChangeDetectionStrategy, Component, afterNextRender, inject, input, output } from '@angular/core';
import type { MainMenuView } from './app.component';
import { IconComponent } from './icon.component';
import { WindowsLauncherService } from './windows-launcher.service';

/** Optional presentation; root retains actions, dismissal and keyboard ownership. */
@Component({
  selector: 'gc-main-menu-content',
  imports: [IconComponent],
  templateUrl: './main-menu-content.component.html',
  styleUrl: './main-menu-content.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainMenuContentComponent {
  readonly presenter = input.required<MainMenuView>();
  readonly ready = output<void>();
  protected readonly windowsLauncher = inject(WindowsLauncherService);

  constructor() {
    afterNextRender(() => {
      if (this.presenter().windowsLauncherAvailable()) void this.windowsLauncher.refresh();
      this.ready.emit();
    });
  }
}
