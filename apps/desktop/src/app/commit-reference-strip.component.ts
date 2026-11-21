import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, input, viewChild } from '@angular/core';
import type { CommitSummary } from '@git-khronos/contracts';
import type { AppComponent } from './app.component';
import { IconComponent } from './icon.component';

@Component({
  selector: 'gc-commit-reference-strip',
  imports: [IconComponent, NgTemplateOutlet],
  templateUrl: './commit-reference-strip.component.html',
  styles: [`
    :host { display: contents; }
    @media (max-height: 720px) { .commit-detail-refs { margin-top: 6px; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitReferenceStripComponent {
  readonly selection = input.required<CommitSummary>();
  readonly model = input.required<AppComponent['commitReferenceStripView']>();
  readonly stackElement = viewChild<ElementRef<HTMLElement>>('detailReferenceStackElement');
}
