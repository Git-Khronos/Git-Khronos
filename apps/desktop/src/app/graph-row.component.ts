import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { GraphRow, GraphRowView } from './app.component';
import { IconComponent } from './icon.component';
import { SearchHighlightPipe } from './search-highlight.pipe';

@Component({
  selector: 'gc-graph-row',
  imports: [NgTemplateOutlet, IconComponent, SearchHighlightPipe],
  templateUrl: './graph-row.component.html',
  styles: ':host { display: contents; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphRowComponent {
  readonly graphRow = input.required<GraphRow>();
  readonly top = input.required<number>();
  readonly presenter = input.required<GraphRowView>();

  protected readonly ghostBranch = computed(() =>
    this.presenter().ghostBranchFor(this.graphRow().commit.oid));
  protected readonly highlighted = computed(() =>
    this.presenter().isCommitHighlighted(this.graphRow().commit.oid));
  protected readonly dimmed = computed(() =>
    this.presenter().isCommitDimmed(this.graphRow().commit.oid));
}
