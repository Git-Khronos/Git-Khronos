import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'gc-hosted-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<nav [attr.aria-label]="label() + ' pages'">
    <button type="button" [disabled]="disabled() || page() <= 1" (click)="pageChange.emit(page() - 1)">Previous {{ label() }} page</button>
    <span>Page {{ page() }}</span>
    <button type="button" [disabled]="disabled() || !more() || page() >= 4294967295" (click)="pageChange.emit(page() + 1)">Next {{ label() }} page</button>
  </nav>`,
  styles: [`nav { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 0; font-size: 13px; } button { padding: 7px 10px; min-height: 32px; color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`],
})
export class HostedPagerComponent {
  readonly label = input.required<string>();
  readonly page = input.required<number>();
  readonly more = input.required<boolean>();
  readonly disabled = input(false);
  readonly pageChange = output<number>();
}
