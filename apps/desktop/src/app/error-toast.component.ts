import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { GitChronosService } from './git-chronos.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'gc-error-toast',
  imports: [IconComponent],
  template: `<div class="error-toast" role="alert"><span>!</span><p><strong>Git needs attention</strong>{{ error() }}</p><button class="view-error-log" type="button" (click)="logRequested.emit()">View log</button><button type="button" aria-label="Dismiss error" (click)="git.dismissError()"><gc-icon name="x" [size]="15" /></button></div>`,
  styles: [`
    .error-toast { position: fixed; right: 18px; bottom: calc(var(--statusbar-height) + 10px); z-index: 70; display: flex; align-items: start; gap: 10px; max-width: 560px; padding: 13px; border: 1px solid #7a3d52; border-radius: 5px; background: #321d2a; box-shadow: 0 14px 50px #0008; }
    .error-toast > span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--danger); color: #210c0b; font-weight: 800; }
    .error-toast p { display: flex; flex-direction: column; gap: 3px; margin: 0; color: #e2c0cd; font-size: 12px; line-height: 1.45; }
    .error-toast p strong { color: #fff1f5; }
    .error-toast button { background: transparent; color: #b993a2; font-size: 19px; }
    .error-toast button.view-error-log { align-self: center; flex: 0 0 auto; padding: 5px 7px; border: 1px solid #794255; border-radius: 3px; color: #efb5c6; font-size: 12px; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorToastComponent {
  protected readonly git = inject(GitChronosService);
  readonly error = input.required<string>();
  readonly logRequested = output<void>();
}
