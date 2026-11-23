import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import type { AppComponent } from './app.component';
import { FileBlameComponent } from './file-blame.component';
import { FileHistoryComponent } from './file-history.component';
import { FileMediaComponent } from './file-media.component';
import { IconComponent } from './icon.component';
import { renderDiffLines, splitRenderedDiff, tokenizeDiffLine } from './diff-rendering';

@Component({
  selector: 'gk-diff-workspace',
  imports: [IconComponent, FileBlameComponent, FileHistoryComponent, FileMediaComponent],
  templateUrl: './diff-workspace.component.html',
  styleUrl: './diff-workspace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Retain the established responsive shell and theme selector specificity.
  encapsulation: ViewEncapsulation.None,
})
export class DiffWorkspaceComponent {
  readonly model = input.required<AppComponent['diffWorkspaceView']>();
  protected readonly diffLines = computed(() => {
    const diff = this.model().activeDiff();
    return renderDiffLines(diff?.patch, diff?.path ?? '');
  });
  protected readonly splitDiffRows = computed(() => splitRenderedDiff(this.diffLines()));
  protected readonly tokenizeBlame = (text: string, path: string) => tokenizeDiffLine([{ text, changed: false }], path);

  protected readonly diffStats = computed(() => this.diffLines().reduce(
    (stats, line) => ({
      additions: stats.additions + (line.kind === 'addition' ? 1 : 0),
      deletions: stats.deletions + (line.kind === 'deletion' ? 1 : 0),
    }),
    { additions: 0, deletions: 0 },
  ));

  readonly diffHunks = computed(() => {
    const lines = this.diffLines();
    return lines.flatMap((line, lineIndex) => line.kind === 'hunk' && line.hunkIndex !== null
      ? [{ index: line.hunkIndex, position: lines.length <= 1 ? 0 : lineIndex / (lines.length - 1) * 100 }]
      : []);
  });

  protected readonly diffMapMarks = computed(() => {
    const lines = this.diffLines();
    return lines.flatMap((line, lineIndex) => line.kind === 'addition' || line.kind === 'deletion'
      ? [{ kind: line.kind, position: lines.length <= 1 ? 0 : lineIndex / (lines.length - 1) * 100 }]
      : []);
  });
}
