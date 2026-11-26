import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CommandAction, CommandPaletteActionSources, CommandPaletteScope } from './app.component';
import { buildCommandActions, rankCommandActions } from './command-palette-actions';
import { GitKhronosService } from './git-khronos.service';
import { IconComponent } from './icon.component';

type CommandPaletteNavigation = number | 'first' | 'last';

@Component({
  selector: 'gk-command-palette',
  imports: [FormsModule, IconComponent],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent {
  protected readonly git = inject(GitKhronosService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly source = input.required<CommandPaletteActionSources>();
  readonly scope = input.required<CommandPaletteScope>();
  readonly visit = input.required<number>();
  readonly query = input.required<string>();
  readonly shortcutKey = input.required<string>();
  readonly recent = input.required<readonly string[]>();
  readonly notice = input<{ readonly message: string; readonly hideActions: boolean; readonly error?: boolean } | null>(null);
  readonly commandActions = computed(() => this.notice()?.hideActions ? [] :
    buildCommandActions(this.source(), this.query(), this.scope()));
  protected readonly commands = computed(() => this.scope() === 'branches'
    ? this.commandActions() // Already matched against branch names, grouped aliases and full refs.
    : rankCommandActions(this.commandActions(), this.query(), this.recent()));
  protected readonly selection = signal(0);

  readonly closed = output<void>();
  readonly queryChanged = output<string>();
  readonly executed = output<CommandAction>();

  constructor() {
    effect(() => {
      this.visit();
      this.scope();
      this.query();
      untracked(() => this.moveSelection('first'));
    });
    afterRenderEffect(() => {
      this.visit();
      this.searchInput()?.nativeElement.focus();
    });
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
      this.moveSelection(direction);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const action = this.commands()[this.selection()];
      if (action?.enabled) this.executed.emit(action);
    }
  }

  protected clearSearch(): void {
    this.queryChanged.emit('');
    queueMicrotask(() => this.searchInput()?.nativeElement.focus());
  }

  protected previewSelection(index: number, enabled: boolean): void {
    if (enabled) this.selection.set(index);
  }

  private moveSelection(direction: CommandPaletteNavigation): void {
    const commands = this.commands();
    if (!commands.length) {
      this.selection.set(0);
      return;
    }
    if (direction === 'first' || direction === 'last') {
      const step = direction === 'first' ? 1 : -1;
      for (let index = step > 0 ? 0 : commands.length - 1;
        index >= 0 && index < commands.length; index += step) {
        if (commands[index].enabled) {
          this.selection.set(index);
          this.scrollSelectionIntoView(index);
          return;
        }
      }
      return;
    }

    const step = Math.sign(direction);
    const current = this.selection();
    const target = Math.max(0, Math.min(commands.length - 1, current + direction));
    for (let index = target; index >= 0 && index < commands.length; index += step) {
      if (commands[index].enabled) {
        this.selection.set(index);
        this.scrollSelectionIntoView(index);
        return;
      }
    }
    // A page jump can land on a disabled row at the boundary. In that case,
    // settle on the closest enabled row between the target and prior selection.
    for (let index = target - step; step > 0 ? index >= current : index <= current; index -= step) {
      if (commands[index]?.enabled) {
        this.selection.set(index);
        this.scrollSelectionIntoView(index);
        return;
      }
    }
    // The result set may have changed while the palette was open; recover to
    // the first enabled action rather than retaining a stale disabled index.
    const firstEnabled = commands.findIndex((action) => action.enabled);
    if (firstEnabled >= 0) {
      this.selection.set(firstEnabled);
      this.scrollSelectionIntoView(firstEnabled);
    }
  }

  private scrollSelectionIntoView(index: number): void {
    queueMicrotask(() => this.searchInput()?.nativeElement.closest('.command-palette')
      ?.querySelector<HTMLElement>(`#command-palette-option-${index}`)?.scrollIntoView({ block: 'nearest' }));
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
