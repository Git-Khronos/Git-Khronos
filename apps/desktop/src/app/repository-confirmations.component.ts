import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, output, viewChild } from '@angular/core';
import type { Remote } from '@git-chronos/contracts';
import { GitChronosService } from './git-chronos.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'gc-repository-confirmations',
  imports: [IconComponent],
  templateUrl: './repository-confirmations.component.html',
  styleUrl: './repository-confirmations.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryConfirmationsComponent {
  protected readonly git = inject(GitChronosService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly remote = input<Remote | null>(null);
  readonly sparseAction = input<'set' | 'disable' | null>(null);
  readonly sparsePathCount = input(0);
  readonly remoteClosed = output<void>();
  readonly remoteConfirmed = output<void>();
  readonly sparseClosed = output<void>();
  readonly sparseConfirmed = output<void>();

  constructor() {
    effect(() => {
      this.remote();
      this.sparseAction();
      setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('footer button')?.focus());
    });
  }

  protected close(): void {
    if (this.remote()) this.remoteClosed.emit();
    else this.sparseClosed.emit();
  }

  protected handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
