import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CommandAction, CommandPaletteScope } from './app.component';
import { GitChronosService } from './git-chronos.service';
import { IconComponent } from './icon.component';

export type CommandPaletteNavigation = number | 'first' | 'last';

@Component({
  selector: 'gc-command-palette',
  imports: [FormsModule, IconComponent],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent {
  protected readonly git = inject(GitChronosService);
  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  readonly commands = input.required<readonly CommandAction[]>();
  readonly scope = input.required<CommandPaletteScope>();
  readonly selection = input.required<number>();
  readonly query = input.required<string>();
  readonly shortcutKey = input.required<string>();

  readonly closed = output<void>();
  readonly queryChanged = output<string>();
  readonly navigated = output<CommandPaletteNavigation>();
  readonly previewed = output<{ index: number; enabled: boolean }>();
  readonly executed = output<CommandAction>();

  constructor() {
    afterNextRender(() => this.searchInput().nativeElement.focus());
  }

  protected handleSearchKey(event: KeyboardEvent): void {
    const navigation: Partial<Record<string, CommandPaletteNavigation>> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: 6,
      PageUp: -6,
      Home: 'first',
      End: 'last',
    };
    const direction = navigation[event.key];
    if (direction !== undefined) {
      event.preventDefault();
      this.navigated.emit(direction);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const action = this.commands()[this.selection()];
      if (action) this.executed.emit(action);
    }
  }

  protected clearSearch(): void {
    this.queryChanged.emit('');
    queueMicrotask(() => this.searchInput().nativeElement.focus());
  }

  protected handleDialogKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget as HTMLElement;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1)!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
