import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import type { GraphColumn } from './app.component';
import { IconComponent } from './icon.component';

export interface GraphSettingsContentView {
  readonly graphColumnLabels: Readonly<Record<GraphColumn, string>>;
  readonly graphColumnOrder: () => readonly GraphColumn[];
  readonly graphColumnVisible: (column: GraphColumn) => boolean;
  readonly graphRequiredLaneCount: () => number;
  readonly graphMaximumWidth: () => number;
  readonly compactGraphColumn: () => boolean;
  readonly showGraphScrollMarkers: () => boolean;
  readonly graphHorizontalScroll: () => boolean;
  readonly smartBranchVisibility: () => boolean;
  readonly showCheckpoints: () => boolean;
  readonly checkpointVisibilityDisabled: () => boolean;
  readonly fitGraphColumnToBranches: (event: Event) => void;
  readonly setCompactGraphColumn: (visible: boolean) => void;
  readonly setGraphScrollMarkers: (visible: boolean) => void;
  readonly setGraphHorizontalScroll: (visible: boolean) => void;
  readonly setSmartBranchVisibility: (visible: boolean) => void;
  readonly setCheckpointVisibility: (visible: boolean, input: HTMLInputElement) => void;
  readonly setGraphColumn: (column: GraphColumn, visible: boolean) => void;
  readonly moveGraphColumn: (column: GraphColumn, direction: -1 | 1) => void;
  readonly restoreGraphDefaults: () => void;
}

@Component({
  selector: 'gk-graph-settings-content',
  imports: [IconComponent],
  templateUrl: './graph-settings-content.component.html',
  styleUrl: './graph-settings-content.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphSettingsContentComponent {
  readonly model = input.required<GraphSettingsContentView>();
  readonly ready = output<HTMLElement>();

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement;
    afterNextRender(() => this.ready.emit(host));
  }
}
