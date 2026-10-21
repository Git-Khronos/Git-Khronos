import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { AppTheme } from './app-theme';
import { GitChronosService } from './git-chronos.service';
import { IconComponent } from './icon.component';
import type { RepositoryDialogMode } from './repository-dialog.component';

@Component({
  selector: 'gc-welcome-launcher',
  imports: [NgTemplateOutlet, IconComponent],
  templateUrl: './welcome-launcher.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeLauncherComponent {
  protected readonly git = inject(GitChronosService);
  private readonly openRepositoryAction = viewChild.required<ElementRef<HTMLButtonElement>>('openRepositoryAction');
  private readonly repositoryFilter = viewChild<ElementRef<HTMLInputElement>>('repositoryFilter');
  protected readonly repositoryQuery = signal('');
  protected readonly repositoryHistoryCount = computed(() =>
    this.git.favoritePaths().length + this.git.unpinnedRecentPaths().length);
  protected readonly filteredFavoritePaths = computed(() =>
    this.filterRepositoryPaths(this.git.favoritePaths()));
  protected readonly filteredRecentPaths = computed(() =>
    this.filterRepositoryPaths(this.git.unpinnedRecentPaths()));
  protected readonly visibleRepositoryCount = computed(() =>
    this.filteredFavoritePaths().length + this.filteredRecentPaths().length);
  readonly workspaceControl = input.required<TemplateRef<unknown>>();
  readonly appTheme = input.required<AppTheme>();
  readonly primaryShortcutKey = input.required<string>();
  readonly favoriteShortcut = input.required<string>();
  readonly repositoryChosen = output<void>();
  readonly repositoryManagerOpened = output<RepositoryDialogMode>();
  readonly closedRepositoryReopened = output<void>();
  readonly favoriteOpened = output<string>();
  readonly repositoryOpened = output<string>();
  readonly themeToggled = output<void>();

  constructor() {
    afterNextRender(() => {
      const hasRepositoryHistory = this.git.favoritePaths().length > 0
        || this.git.unpinnedRecentPaths().length > 0;
      if (!hasRepositoryHistory && document.activeElement === document.body) {
        this.openRepositoryAction().nativeElement.focus();
      }
    });
  }

  protected clearRepositoryFilter(): void {
    this.repositoryQuery.set('');
    queueMicrotask(() => this.repositoryFilter()?.nativeElement.focus());
  }

  private filterRepositoryPaths(paths: readonly string[]): string[] {
    const query = this.repositoryQuery().trim().toLocaleLowerCase();
    if (!query) return [...paths];
    return paths.filter((path) =>
      path.toLocaleLowerCase().includes(query)
      || this.git.pathLabel(path).toLocaleLowerCase().includes(query));
  }
}
