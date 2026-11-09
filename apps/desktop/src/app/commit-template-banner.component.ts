import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal } from '@angular/core';
import type { AppError } from '@git-khronos/contracts';
import { GitHelpComponent } from './git-help.component';

@Component({
  selector: 'gc-commit-template-banner',
  imports: [GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'cancel($event)' },
  template: `
    @if (error(); as problem) {
      <div role="alert">
        <strong>Commit template unavailable</strong>
        <p>{{ problem.message }}</p>
        @if (problem.hint) { <p>{{ problem.hint }}</p> }
        <button #retry type="button" [disabled]="disabled()" (click)="requestRetry(retry)">Refresh template status</button>
      </div>
    } @else {
      <div role="group" aria-label="Commit template">
        <strong>Commit template configured</strong>
        @if (template() === '') { <p>The template is empty after removing guidance. Reload will clear the message and co-authors.</p> }
        <p>Git's configured comment prefix is used to remove template guidance before filling the form.
          Refresh the repository to read file changes. Reload replaces only the message and co-authors, not commit policy.</p>
        <button class="reload-template" type="button" [disabled]="disabled()" (click)="confirming.set(true)">Reload template</button>
        @if (confirming()) {
          <div role="group" aria-label="Replace draft with template">
            <p role="status">Replace this draft's summary, description and co-authors? Entered values will be lost.</p>
            <button type="button" [disabled]="disabled()" (click)="replace()">Replace draft</button>
            <button type="button" [disabled]="disabled()" (click)="cancel()">Keep draft</button>
          </div>
        }
      </div>
    }
    <gc-git-help topic="commit" label="Learn about commit templates…" [disabled]="disabled()" />
  `,
  styles: [`
    :host { display: block; padding: 8px; border: 1px solid var(--inspector-control-border); color: var(--text); background: var(--inspector-control); font-size: 12px; }
    p { margin: 6px 0; line-height: 1.5; overflow-wrap: anywhere; }
    button { min-height: 24px; margin: 4px 8px 4px 0; border: 1px solid var(--inspector-control-border); padding: 4px 8px; background: var(--inspector-control); color: var(--text); cursor: pointer; font: inherit; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button:disabled { opacity: .5; cursor: default; }
  `],
})
export class CommitTemplateBannerComponent {
  readonly repositoryId = input.required<string>();
  readonly template = input<string | null>(null);
  readonly error = input<AppError | null>(null);
  readonly disabled = input(false);
  readonly retry = output<void>();
  readonly accepted = output<void>();
  readonly confirming = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private retryRequest: { repositoryId: string; opener: HTMLButtonElement } | null = null;

  constructor() {
    effect(() => {
      const repositoryId = this.repositoryId();
      this.template();
      const error = this.error();
      this.confirming.set(false);
      const request = this.retryRequest;
      this.retryRequest = null;
      if (!error && request?.repositoryId === repositoryId &&
        (document.activeElement === request.opener || document.activeElement === document.body)) {
        window.setTimeout(() => {
          if (this.host.nativeElement.isConnected && this.repositoryId() === repositoryId &&
            document.activeElement === document.body) this.restoreFocus();
        });
      }
    });
  }

  requestRetry(opener: HTMLButtonElement): void {
    if (this.disabled()) return;
    this.retryRequest = { repositoryId: this.repositoryId(), opener };
    this.retry.emit();
  }

  replace(): void {
    if (this.disabled() || !this.confirming()) return;
    this.confirming.set(false);
    this.accepted.emit();
    this.restoreFocus();
  }

  cancel(event?: Event): void {
    if (!this.confirming() || this.disabled()) return;
    event?.preventDefault();
    event?.stopPropagation();
    this.confirming.set(false);
    this.restoreFocus();
  }

  private restoreFocus(): void {
    this.host.nativeElement.querySelector<HTMLButtonElement>('.reload-template')?.focus();
  }
}
