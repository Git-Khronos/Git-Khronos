import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, output, viewChild } from '@angular/core';
import type { LfsPrunePreview } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'gc-lfs-prune-dialog',
  imports: [IconComponent],
  templateUrl: './lfs-prune-dialog.component.html',
  styleUrl: './lfs-prune-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LfsPruneDialogComponent {
  protected readonly git = inject(GitKhronosService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly preview = input<LfsPrunePreview | null>(null);
  readonly reviewing = input(false);
  readonly closed = output<void>();
  readonly confirmed = output<void>();
  readonly retentionConfirmed = output<void>();

  constructor() {
    effect(() => {
      this.preview();
      setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('footer button')?.focus());
    });
  }

  protected actionLabel(): string {
    const count = this.preview()?.objects.length ?? 0;
    return count ? `Remove ${count} ${count === 1 ? 'Object' : 'Objects'}` : 'Remove Objects';
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
  }

  protected handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closed.emit(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), summary')]
      .filter((element) => element.getClientRects().length > 0);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
