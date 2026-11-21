import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

// Install shared form rules only while one of the deferred repository dialogs
// renders. Selectors in the stylesheet are limited to those three hosts.
@Component({
  selector: 'gc-repository-form-styles',
  template: '',
  host: { style: 'display: none' },
  styleUrl: './repository-form-styles.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryFormStylesComponent {}
