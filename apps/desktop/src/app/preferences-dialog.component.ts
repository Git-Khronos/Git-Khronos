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
  viewChild,
} from '@angular/core';
import { ConfiguredToolsPanelComponent } from './configured-tools-panel.component';
import { FormsModule } from '@angular/forms';
import type { RepositorySnapshot } from '@git-khronos/contracts';
import { APP_THEME_OPTIONS } from './app-theme';
import type { PreferencesDialogView } from './app.component';
import { GitKhronosService } from './git-khronos.service';
import { GitDocumentationService } from './git-documentation.service';
import { IconComponent } from './icon.component';
import { IntegrityPanelComponent } from './integrity-panel.component';
import { PatchExchangePanelComponent } from './patch-exchange-panel.component';

type PreferenceSection = 'general' | 'graph' | 'git' | 'editor' | 'terminal';

interface PreferenceSearchEntry {
  readonly label: string;
  readonly category: string;
  readonly section: PreferenceSection;
  readonly targetId: string;
  readonly keywords: string;
}

const PREFERENCE_SEARCH_ENTRIES: readonly PreferenceSearchEntry[] = [
  { label: 'Terminal and agent programs', category: 'Terminal', section: 'terminal', targetId: 'preference-programs', keywords: 'configured tools executable arguments profiles default shell' },
  { label: 'Application theme', category: 'General', section: 'general', targetId: 'preference-appearance', keywords: 'appearance color dark midnight chronos' },
  { label: 'Toolbar labels', category: 'General', section: 'general', targetId: 'preference-toolbar', keywords: 'buttons icons actions' },
  { label: 'Worktree tab groups', category: 'General', section: 'general', targetId: 'preference-tabs', keywords: 'tabs repositories grouping' },
  { label: 'Left panel visibility', category: 'General', section: 'general', targetId: 'preference-left-panel', keywords: 'sidebar layout show hide' },
  { label: 'Commit panel and file layout', category: 'General', section: 'general', targetId: 'preference-commit-panel', keywords: 'details path tree show hide' },
  { label: 'Restore interface defaults', category: 'General', section: 'general', targetId: 'preference-reset', keywords: 'reset layout appearance' },
  { label: 'Commit date format', category: 'Commit Graph', section: 'graph', targetId: 'preference-graph', keywords: 'relative compact iso time' },
  { label: 'Author markers', category: 'Commit Graph', section: 'graph', targetId: 'preference-graph', keywords: 'initials colors avatars' },
  { label: 'Graph behavior', category: 'Commit Graph', section: 'graph', targetId: 'preference-graph', keywords: 'highlight scroll markers smart branch visibility' },
  { label: 'Visible graph columns', category: 'Commit Graph', section: 'graph', targetId: 'preference-graph', keywords: 'branch tag message author date sha' },
  { label: 'Automatic remote fetch', category: 'Git Features', section: 'git', targetId: 'preference-remote-updates', keywords: 'sync interval prune updates' },
  { label: 'Commit signing', category: 'Git Features', section: 'git', targetId: 'preference-signing', keywords: 'gpg ssh signer verification' },
  { label: 'Sparse checkout', category: 'Git Features', section: 'git', targetId: 'preference-sparse-checkout', keywords: 'directories cone sparse index' },
  { label: 'Git LFS', category: 'Git Features', section: 'git', targetId: 'preference-lfs', keywords: 'large files tracking patterns locks' },
  { label: 'Git command reference', category: 'Git Features', section: 'git', targetId: 'preference-reference', keywords: 'help learning manuals' },
  { label: 'Diff viewer font size', category: 'Diff Viewer', section: 'editor', targetId: 'preference-diff-viewer', keywords: 'text editor readability' },
  { label: 'Diff tab width', category: 'Diff Viewer', section: 'editor', targetId: 'preference-diff-viewer', keywords: 'spaces indentation' },
  { label: 'Diff line wrapping', category: 'Diff Viewer', section: 'editor', targetId: 'preference-diff-viewer', keywords: 'word wrap long lines' },
  { label: 'Terminal font and size', category: 'Terminal', section: 'terminal', targetId: 'preference-terminal', keywords: 'monospace text shell' },
  { label: 'Terminal line height and cursor', category: 'Terminal', section: 'terminal', targetId: 'preference-terminal', keywords: 'spacing block underline bar shell' },
];

@Component({
  selector: 'gc-preferences-dialog',
  imports: [FormsModule, ConfiguredToolsPanelComponent, IconComponent, IntegrityPanelComponent, PatchExchangePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferences-dialog.component.html',
})
export class PreferencesDialogComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly git = inject(GitKhronosService);
  protected readonly documentation = inject(GitDocumentationService);
  protected readonly appThemeOptions = APP_THEME_OPTIONS;
  protected readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  readonly repository = input.required<RepositorySnapshot>();
  readonly view = input.required<PreferencesDialogView>();
  readonly closed = output<void>();
  protected readonly searchQuery = signal('');
  protected readonly searchResults = computed(() => {
    const terms = this.searchQuery().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return PREFERENCE_SEARCH_ENTRIES.filter((entry) => {
      const searchable = `${entry.label} ${entry.category} ${entry.keywords}`.toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    }).slice(0, 8);
  });

  constructor() {
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  protected selectSearchResult(entry: PreferenceSearchEntry): void {
    this.view().preferencesSection.set(entry.section);
    this.searchQuery.set('');
    requestAnimationFrame(() => {
      const target = this.element.nativeElement.querySelector<HTMLElement>(`#${entry.targetId}`);
      if (!target) return;
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      target.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]')?.focus({ preventScroll: true });
    });
  }

  protected handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.searchQuery()) return;
    event.stopPropagation();
    this.searchQuery.set('');
  }
}
