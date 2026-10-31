import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injector, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { InteractiveRebaseCommit, InteractiveRebaseStep } from '@git-khronos/contracts';
import { IconComponent } from './icon.component';
import { GitHelpComponent } from './git-help.component';
import { previewAutosquash } from './rebase-autosquash';

export type RebaseAction = InteractiveRebaseStep['action'];
export interface RebaseStepView extends InteractiveRebaseCommit {
  action: RebaseAction;
  message: string;
}
export interface InteractiveRebaseState {
  repositoryId: string;
  source: string;
  target: string;
  base: string;
  original: RebaseStepView[];
  steps: RebaseStepView[];
  selectionOids?: string[];
  root?: boolean;
  ontoOid?: string;
  destinations?: { oid: string; label: string }[];
  remoteReachableOids?: string[];
}

@Component({
  selector: 'gc-interactive-rebase-editor',
  imports: [FormsModule, IconComponent, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './interactive-rebase-editor.component.html',
  styleUrl: './interactive-rebase-editor.component.scss',
})
export class InteractiveRebaseEditorComponent {
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly state = input.required<InteractiveRebaseState>();
  readonly selected = input<string | null>(null);
  readonly dragged = input<string | null>(null);
  readonly ready = input(false);
  readonly colorFor = input.required<(name: string, email: string) => string>();
  readonly closed = output<void>();
  readonly selectedChanged = output<string>();
  readonly actionChanged = output<{ oid: string; action: RebaseAction }>();
  readonly messageChanged = output<{ oid: string; message: string }>();
  readonly dragStarted = output<{ event: DragEvent; oid: string }>();
  readonly dropped = output<{ event: DragEvent; oid: string }>();
  readonly dragEnded = output<void>();
  readonly reset = output<void>();
  readonly execute = output<void>();
  readonly planChanged = output<RebaseStepView[]>();
  readonly stepMoved = output<{ oid: string; direction: -1 | 1 }>();
  readonly destinationChanged = output<string>();
  protected readonly autosquashError = signal<string | null>(null);
  protected readonly autosquashNotice = signal<string | null>(null);
  protected readonly reorderNotice = signal<string | null>(null);

  protected moveStep(oid: string, direction: -1 | 1): void {
    if (!this.state().steps.some(step => step.oid === oid)) return;
    this.selectedChanged.emit(oid);
    // The parent owns the current plan. Emitting an intent avoids losing rapid
    // moves when this input still describes the preceding rendered frame.
    this.stepMoved.emit({ oid, direction });
    afterNextRender(() => {
      if (this.selected() !== oid) return;
      const steps = this.state().steps;
      const index = steps.findIndex(step => step.oid === oid);
      if (index < 0) return;
      const row = this.dialog()?.nativeElement.querySelector<HTMLElement>(`[data-rebase-oid="${oid}"]`);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
      this.reorderNotice.set(`Moved ${steps[index].subject} to position ${index + 1} of ${steps.length}. Review the order before Start Rebase.`);
    }, { injector: this.injector });
    this.autosquashNotice.set(null);
    this.autosquashError.set(null);
  }

  protected autosquash(): void {
    const result = previewAutosquash(this.state().steps);
    this.autosquashError.set(result.error);
    this.autosquashNotice.set(null);
    if (result.steps) {
      this.planChanged.emit(result.steps);
      this.autosquashNotice.set(`Matched ${result.matched} commit(s). Review the reordered actions before Start Rebase; no Git command has run.`);
    }
  }

  protected resetPlan(): void {
    this.autosquashError.set(null);
    this.autosquashNotice.set(null);
    this.reorderNotice.set(null);
    this.reset.emit();
  }

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('[data-rebase-close]')?.focus());
  }

  protected handleKey(event: KeyboardEvent): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const row = target?.closest<HTMLElement>('[data-rebase-oid]');
    if (event.altKey && !event.ctrlKey && !event.metaKey
      && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      && row && !target?.closest('select, textarea, input')) {
      event.preventDefault();
      event.stopPropagation();
      const oid = row.dataset['rebaseOid'];
      if (oid) this.moveStep(oid, event.key === 'ArrowUp' ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
    } else if (event.key === 'Tab') {
      const controls = Array.from(this.dialog()?.nativeElement
        .querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [data-rebase-oid]') ?? []);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  protected canCombine(index: number): boolean {
    return this.state().steps.slice(0, index).some(step => step.action !== 'drop');
  }
  protected initials(name: string): string {
    return name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  }
}
