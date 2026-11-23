import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { iconPrimitives, type IconName } from './icon-shapes';
export type { IconName } from './icon-shapes';

@Component({
  selector: 'gk-icon',
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @for (shape of shapes(); track $index) {
        @switch (shape.kind) {
          @case ('path') { <path [attr.d]="shape.d" /> }
          @case ('circle') { <circle [attr.cx]="shape.cx" [attr.cy]="shape.cy" [attr.r]="shape.r" [attr.fill]="shape.fill ?? null" /> }
          @case ('rect') { <rect [attr.x]="shape.x" [attr.y]="shape.y" [attr.width]="shape.width" [attr.height]="shape.height" [attr.rx]="shape.rx" /> }
        }
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  protected readonly shapes = computed(() => iconPrimitives(this.name()));
  readonly size = input(16);
  readonly strokeWidth = input(1.8);
}
