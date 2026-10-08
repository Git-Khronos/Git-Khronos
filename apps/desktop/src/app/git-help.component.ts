import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { GitDocumentationService, type GitDocumentationTopic } from './git-documentation.service';

@Component({
  selector: 'gc-git-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button #opener type="button" (click)="documentation.open(topic(), opener)"
    [disabled]="disabled()" [attr.aria-label]="label()" aria-haspopup="dialog">{{ label() }}</button>`,
  styles: [`
    button { margin-top: 8px; padding: 6px 8px; color: var(--accent); background: transparent; font-size: 12px; text-align: left; cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button:disabled { opacity: .5; cursor: not-allowed; }
  `],
})
export class GitHelpComponent {
  readonly documentation = inject(GitDocumentationService);
  readonly topic = input<GitDocumentationTopic | null>(null);
  readonly label = input('Git command reference…');
  readonly disabled = input(false);
}
