import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

// xterm creates its own DOM, so its existing base stylesheet must remain unscoped.
// Load it with the deferred terminal, not with the initial repository shell.
@Component({
  selector: 'gk-terminal-base-styles',
  template: '',
  host: { style: 'display: none' },
  styleUrl: '../../../../node_modules/@xterm/xterm/css/xterm.css',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalBaseStylesComponent {}
