import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';
import { TextValueDirective } from './text-value.directive';

interface SuggestedCoAuthor {
  readonly name: string;
  readonly email: string;
  readonly initials: string;
  readonly color: string;
}

@Component({
  selector: 'gk-coauthor-picker',
  imports: [IconComponent, TextValueDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coauthor-picker.component.html',
  styleUrl: './coauthor-picker.component.scss',
})
export class CoauthorPickerComponent {
  readonly suggestions = input.required<readonly SuggestedCoAuthor[]>();
  readonly name = input.required<string>();
  readonly email = input.required<string>();
  readonly canAdd = input.required<boolean>();
  readonly nameChanged = output<string>();
  readonly emailChanged = output<string>();
  readonly suggested = output<SuggestedCoAuthor>();
  readonly added = output<void>();
}
