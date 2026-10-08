import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ResetMode, ResetPreview } from '@git-chronos/contracts';
import { GitChronosService } from './git-chronos.service';
import { GitDocumentationService } from './git-documentation.service';
import { IconComponent } from './icon.component';

export interface PendingHistoryAction {
  kind: 'cherry-pick' | 'revert' | 'reset' | 'split';
  oid: string;
  oids: string[];
  label: string;
  targetBranch?: string;
}

@Component({
  selector: 'gc-history-review-dialog',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './history-review-dialog.component.html',
  styleUrl: './history-review-dialog.component.scss',
})
export class HistoryReviewDialogComponent {
  protected readonly git = inject(GitChronosService);
  protected readonly documentation = inject(GitDocumentationService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly action = input.required<PendingHistoryAction>();
  readonly parents = input<string[]>([]);
  readonly mainline = input<number | null>(null);
  readonly noCommit = input(false);
  readonly resetMode = input<ResetMode>('mixed');
  readonly preview = input<ResetPreview | null>(null);
  readonly previewBusy = input(false);
  readonly mainlineChanged = output<number | null>();
  readonly noCommitChanged = output<boolean>();
  readonly previewRequested = output<ResetMode>();
  readonly closed = output<void>();
  readonly execute = output<void>();
  readonly keyPressed = output<KeyboardEvent>();
  protected readonly revertSteps = computed(() => {
    const subjects = new Map(this.git.repository()?.commits.map(commit => [commit.oid, commit.subject]) ?? []);
    return this.action().oids.map(oid => ({ oid, subject: subjects.get(oid) ?? 'Selected commit' }));
  });

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement
      .querySelector<HTMLElement>('[data-history-dialog-cancel]')?.focus());
  }

  protected shortOid(oid: string): string {
    return oid.slice(0, 8);
  }
}
