import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { GitChronosService, type ActivityLogEntry } from './git-chronos.service';
import { IconComponent } from './icon.component';

export type ActivityLogTab = 'application' | 'repository';

const DEFAULT_ACTIVITY_LOG_HEIGHT = 285;
const MINIMUM_ACTIVITY_LOG_HEIGHT = 176;
const ACTIVITY_LOG_TOP_CLEARANCE = 110;
const ACTIVITY_LOG_HEIGHT_KEY = 'git-chronos.ui.activity-log-height';

@Component({
  selector: 'gc-activity-log-drawer',
  imports: [DatePipe, IconComponent],
  templateUrl: './activity-log-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityLogDrawerComponent {
  protected readonly git = inject(GitChronosService);
  private readonly drawer = viewChild.required<ElementRef<HTMLElement>>('drawer');
  readonly tab = model.required<ActivityLogTab>();
  readonly closed = output<void>();
  protected readonly maximumHeight = signal(this.availableHeight());
  protected readonly minimumHeight = computed(() => Math.min(MINIMUM_ACTIVITY_LOG_HEIGHT, this.maximumHeight()));
  private preferredHeight = this.readHeight();
  protected readonly height = signal(this.clampHeight(this.preferredHeight));
  private resizePointerId: number | null = null;
  private resizeOriginY = 0;
  private resizeOriginHeight = 0;

  protected readonly visibleLogs = computed(() => {
    const repositoryId = this.git.activeRepositoryId();
    return [...this.git.activityLogs()
      .filter((entry) => this.tab() === 'application'
        ? entry.repositoryId === null
        : repositoryId !== null && entry.repositoryId === repositoryId)]
      .reverse();
  });

  protected readonly counts = computed(() => {
    const repositoryId = this.git.activeRepositoryId();
    const entries = this.git.activityLogs();
    return {
      application: entries.filter((entry) => entry.repositoryId === null).length,
      repository: repositoryId === null ? 0 : entries.filter((entry) => entry.repositoryId === repositoryId).length,
    };
  });

  constructor() {
    afterNextRender(() => this.drawer().nativeElement
      .querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]:not(:disabled)')
      ?.focus());
  }

  protected clear(): void {
    this.git.clearActivityLogs(this.tab() === 'application' ? null : this.git.activeRepositoryId());
  }

  protected statusLabel(status: ActivityLogEntry['status']): string {
    switch (status) {
      case 'running': return 'Running';
      case 'success': return 'Success';
      case 'error': return 'Failed';
      case 'cancelled': return 'Cancelled';
    }
  }

  protected startResize(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    this.resizePointerId = event.pointerId;
    this.resizeOriginY = event.clientY;
    this.resizeOriginHeight = this.height();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  protected resize(event: PointerEvent): void {
    if (event.pointerId !== this.resizePointerId) return;
    event.preventDefault();
    const height = this.clampHeight(this.resizeOriginHeight + this.resizeOriginY - event.clientY);
    this.preferredHeight = height;
    this.height.set(height);
  }

  protected finishResize(event: PointerEvent): void {
    if (event.pointerId !== this.resizePointerId) return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    this.resizePointerId = null;
    this.persistHeight();
  }

  protected resizeWithKeyboard(event: KeyboardEvent): void {
    const increments: Partial<Record<string, number>> = { ArrowUp: 24, ArrowDown: -24 };
    if (event.key === 'Home') this.setHeight(this.minimumHeight());
    else if (event.key === 'End') this.setHeight(this.maximumHeight());
    else if (event.key === 'Enter' || event.key === ' ') this.resetHeight();
    else if (increments[event.key]) this.stepHeight(increments[event.key]! * (event.shiftKey ? 2 : 1));
    else return;
    event.preventDefault();
  }

  protected stepHeight(delta: number): void {
    this.setHeight(this.height() + delta);
  }

  protected resetHeight(): void {
    this.setHeight(DEFAULT_ACTIVITY_LOG_HEIGHT);
  }

  @HostListener('window:resize')
  protected fitToViewport(): void {
    this.maximumHeight.set(this.availableHeight());
    const fitted = this.clampHeight(this.preferredHeight);
    if (fitted !== this.height()) this.height.set(fitted);
  }

  protected handleTabKey(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...(event.currentTarget as HTMLElement)
      .querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
    if (!tabs.length) return;
    const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else next = (current - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    const nextTab = tabs[next];
    this.tab.set(nextTab.dataset['activityTab'] === 'repository' ? 'repository' : 'application');
    queueMicrotask(() => nextTab.focus());
  }

  private setHeight(height: number): void {
    const fitted = this.clampHeight(height);
    this.preferredHeight = fitted;
    this.height.set(fitted);
    this.persistHeight();
  }

  private clampHeight(height: number): number {
    return Math.round(Math.min(this.maximumHeight(), Math.max(this.minimumHeight(), height)));
  }

  private availableHeight(): number {
    return typeof window === 'undefined'
      ? DEFAULT_ACTIVITY_LOG_HEIGHT
      : Math.max(120, window.innerHeight - ACTIVITY_LOG_TOP_CLEARANCE);
  }

  private readHeight(): number {
    if (typeof localStorage === 'undefined') return DEFAULT_ACTIVITY_LOG_HEIGHT;
    const stored = Number.parseFloat(localStorage.getItem(ACTIVITY_LOG_HEIGHT_KEY) ?? '');
    return Number.isFinite(stored) ? stored : DEFAULT_ACTIVITY_LOG_HEIGHT;
  }

  private persistHeight(): void {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVITY_LOG_HEIGHT_KEY, String(this.height()));
  }
}
