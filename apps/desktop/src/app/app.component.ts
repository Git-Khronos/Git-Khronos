import { FileToolsDialogComponent } from './file-tools-dialog.component';
import type { FileToolsDialogRequest } from './file-tools-dialog-request';
import { RepositoryLinkDialogComponent, type RepositoryLinkDialogRequest } from './repository-link-dialog.component';
import { FileContentDialogComponent, type FileContentDialogRequest } from './file-content-dialog.component';
import { EditorDraftRecoveryComponent } from './editor-draft-recovery.component';
import type { EditorDraftOpenRequest } from './editor-draft-recovery';
import { FileMediaComponent, type FileMediaSelection } from './file-media.component';
import { BranchWorkflowDialogComponent, type BranchWorkflowDialogRequest } from './branch-workflow-dialog.component';
import { WorkspaceCenterComponent, type WorkspaceCenterRequest } from './workspace-center.component';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { MergePreviewDialogComponent, type MergePreviewDialogRequest } from './merge-preview-dialog.component';
import { TextValueDirective } from './text-value.directive';
import { type UnlistenFn } from '@tauri-apps/api/event';
import { events } from '@git-khronos/contracts';
import { StashDeleteDialogComponent, type StashDeleteRequest } from './stash-delete-dialog.component';
import { FileBlameComponent } from './file-blame.component';
import { FileHistoryComponent } from './file-history.component';
import type {
  Branch,
  CommitFile,
  FileComparisonContext,
  CommitPolicy,
  CommitSummary,
  DiscardPreview,
  DiscardRecovery,
  InteractiveRebaseStep,
  LfsPrunePreview,
  OperationRecovery,
  ReflogEntry,
  ResetMode,
  ResetPreview,
  Remote,
  RepositorySnapshot,
  StashEntry,
  Submodule,
  Worktree,
  WorkingTreeEntry,
} from '@git-khronos/contracts';
import { GitKhronosService, type RepositoryWorkspace } from './git-khronos.service';
import { IconComponent, type IconName } from './icon.component';
import { TerminalPanelComponent } from './terminal-panel.component';
import { AuthenticationComponent } from './authentication.component';
import { GraphViewportComponent } from './graph-viewport.component';
import { ViewportSizeDirective } from './viewport-size.directive';
import { WorkingTreeViewportComponent } from './working-tree-viewport.component';
import { WorktreeGraphRowComponent } from './worktree-graph-row.component';
import { ReferenceActionDialogComponent, type ReferenceActionRequest } from './reference-action-dialog.component';
import { StashOptionsDialogComponent, type StashDialogRequest } from './stash-options-dialog.component';
import { HistorySearchComponent } from './history-search.component';
import { HistorySearchService } from './history-search.service';
import { FetchOptionsDialogComponent, type FetchDialogRequest } from './fetch-options-dialog.component';
import { PreferencesDialogComponent } from './preferences-dialog.component';
import { CommandPaletteComponent } from './command-palette.component';
import { ActivityLogDrawerComponent, type ActivityLogTab } from './activity-log-drawer.component';
import { WelcomeLauncherComponent } from './welcome-launcher.component';
import { LfsPruneDialogComponent } from './lfs-prune-dialog.component';
import { RepositoryConfirmationsComponent } from './repository-confirmations.component';
import { ErrorToastComponent } from './error-toast.component';
import { KeyboardShortcutsDialogComponent } from './keyboard-shortcuts-dialog.component';
import { RepositoryDialogComponent, type RepositoryDialogMode } from './repository-dialog.component';
import { LfsTrackingDialogComponent, type LfsTrackingRequest } from './lfs-tracking-dialog.component';
import { WorktreeMoveDialogComponent, type WorktreeMoveRequest } from './worktree-move-dialog.component';
import { WorktreeRegistrationDialogComponent, type WorktreeRegistrationRequest } from './worktree-registration-dialog.component';
import { MergeRebaseDialogComponent, type MergeRebaseDialogState } from './merge-rebase-dialog.component';
import { GitDocumentationDialogComponent } from './git-documentation-dialog.component';
import { GitDocumentationService } from './git-documentation.service';
import { CommitPolicyFieldsComponent } from './commit-policy-fields.component';
import { CommitTemplateBannerComponent } from './commit-template-banner.component';
import { CommitSignatureComponent } from './commit-signature.component';
import { InteractiveRebaseEditorComponent, type InteractiveRebaseState, type RebaseAction, type RebaseStepView } from './interactive-rebase-editor.component';
import { HistoryReviewDialogComponent, type PendingHistoryAction } from './history-review-dialog.component';
import { calculateVirtualWindow, type VirtualWindow } from './virtual-list';
import { shortcutLabelsForPlatform } from './shortcut-labels';
import {
  boundedGraphLaneOffset,
  buildGraphSegmentPath,
  graphColumnLayout,
  graphColumnWidthForLaneCount,
  GRAPH_LANE_COLOR_COUNT,
  graphLaneCapacity,
  graphLaneOffset,
  graphNodeConnectionStemOffset,
  isAppendOnlyCommitHistory,
  isCompactAuthorColumn,
  isDefaultGraphColumnVisible,
  MAXIMUM_PERSISTED_GRAPH_COLUMN_WIDTH,
  normalizeGraphColumnWidth,
  advanceRequiredGraphLaneCount,
  stackOverlappingGraphEdges,
  type RequiredGraphLaneProgress,
  type GraphNodeConnection,
  type GraphSegmentGeometry,
} from './graph-layout';
import { graphScrollMarkerPosition, sampleGraphMarkers } from './graph-scroll-markers';
import {
  repositoryTabDropEdge,
  repositoryTabOverflowState,
  repositoryTabScrollPosition,
} from './repository-tabs';
import { shouldDecorateDiff, tokenizeDiffLine, type DiffSyntaxToken, type DiffTextSegment } from './diff-rendering';
import {
  APP_THEME_OPTIONS,
  appThemeNavigationValue,
  normalizeAppTheme,
  type AppTheme,
  type AppThemeNavigationKey,
} from './app-theme';
import { hostedReviewRequestsForRemotes } from './remote-hosting';
import {
  buildCompactReferenceSummary,
  buildReferenceGroups,
  describeReferenceGroups,
  type CompactReferenceSummary,
  type ReferenceGroup,
} from './reference-summary';
import { orderBranchesCurrentFirst } from './branch-order';
import { describeWorkingTreeStatus } from './working-tree-status';
import { buildRemoteNameOrder, compareRemoteNames } from './remote-order';
import { ResizePointer } from './resize-pointer';

interface ActiveGraphLane {
  oid: string;
  color: number;
}

interface GraphSegment extends GraphSegmentGeometry {
  color: number;
}

export interface GraphRow {
  commit: CommitSummary;
  nodeOffset: number;
  color: number;
  authorColor: string;
  segments: GraphSegment[];
}

interface GraphLayoutCache {
  key: string;
  commitOids: string[];
  rows: GraphRow[];
  active: (ActiveGraphLane | null)[];
  nextColor: number;
}

export interface WorktreeWipRow {
  worktree: Worktree;
  nodeOffset: number;
  color: number;
  segments: WorktreeWipSegment[];
}

export interface WorktreeWipSegment {
  offset: number;
  color: number;
  startY: number;
  endY: number;
}

type GraphScrollMarkerKind = 'working' | 'head' | 'selected' | 'search';

interface GraphScrollMarker {
  id: string;
  kind: GraphScrollMarkerKind;
  position: number;
  label: string;
  oid?: string;
  worktreePath?: string;
}

interface RepositoryTabGroup {
  key: string;
  label: string;
  tabs: RepositorySnapshot[];
  grouped: boolean;
}

interface CoAuthor {
  name: string;
  email: string;
}

interface CommitDraft {
  summary: string;
  description: string;
  coAuthors: CoAuthor[];
  amend: boolean;
  skipHooks: boolean;
  sign: boolean;
  pushAfter: boolean;
  policy: CommitPolicy;
}

interface DiffLine {
  text: string;
  kind: 'addition' | 'deletion' | 'hunk' | 'header' | 'context';
  oldLine: number | null;
  newLine: number | null;
  hunkIndex: number | null;
  changeIndices: number[];
  segments: DiffTextSegment[];
  tokens: DiffSyntaxToken[];
}

interface SplitDiffRow {
  kind: 'pair' | 'header' | 'hunk';
  left: DiffLine | null;
  right: DiffLine | null;
  label: string | null;
  hunkIndex: number | null;
}

interface DiffViewportPosition {
  top: number;
  left: number;
  anchor: {
    attribute: 'data-diff-old-line' | 'data-diff-new-line';
    line: string;
    offset: number;
  } | null;
}

interface DiffLineSelection {
  hunkIndex: number;
  lineIndices: number[];
}

interface CommitDateDisplay {
  primary: string;
  secondary: string;
  title: string;
}

interface CommitReadiness {
  ready: boolean;
  icon: IconName;
  message: string;
}

type DiffViewMode = 'hunk' | 'inline' | 'split';
type DiffInsightMode = 'diff' | 'history' | 'blame' | 'content';
export type CommandPaletteScope = 'all' | 'files' | 'branches';
type GraphDateFormat = 'compact' | 'relative' | 'iso';
type RemoteLocationIcon = 'remote' | 'server' | 'globe' | 'link';
type RemoteDialogMode = 'add' | 'edit';

interface RemoteBranchGroup extends Remote {
  branches: Branch[];
  branchCount: number;
}

type VirtualReferenceList = 'local' | 'remote' | 'tags' | 'stashes';

type VirtualRemoteBranchRow =
  | { key: string; kind: 'group'; group: RemoteBranchGroup }
  | { key: string; kind: 'branch'; group: RemoteBranchGroup; branch: Branch };

interface RemoteBranchLocationGroup {
  key: string;
  label: string;
  primary: Branch;
  locations: Branch[];
}

interface ToolbarRemoteBranchGroup {
  label: string;
  primary: Branch;
  locations: Branch[];
}

interface ReferencePresentation {
  summary: CompactReferenceSummary;
  groups: ReferenceGroup[];
}

interface FileChangeStats {
  additions: number;
  deletions: number;
  binaryFiles: number;
}

interface BranchSyncState {
  ahead: number;
  behind: number;
  upstream: string | null;
  gone: boolean;
}

interface ContextMenuState {
  kind: 'commit' | 'branch' | 'remote' | 'tag' | 'checkpoint';
  x: number;
  y: number;
  oid: string;
  oids: string[];
  label: string;
}

interface PendingCheckpointDelete {
  repoId: string;
  reference: string;
  oid: string;
}

interface TagPreviewPopover {
  name: string;
  oid: string;
  x: number;
  y: number;
}

interface RepositoryTabMenuState {
  x: number;
  y: number;
  repoId: string;
}

interface RemoteGroupMenuState {
  remote: string;
  x: number;
  y: number;
}

export interface CommandAction {
  id: string;
  group: string;
  label: string;
  detail: string;
  shortcut?: string;
  enabled: boolean;
  icon: IconName;
  stashTarget?: { repositoryId: string; stash: StashEntry };
}

interface PendingBisectStart {
  goodOid: string;
  goodLabel: string;
  badOid: string;
  badLabel: string;
}

interface PendingBranchAction {
  kind: 'rebase' | 'delete';
  branch: string;
  /** Set after Git refused a safe delete; confirming then force-deletes the branch. */
  unmerged?: boolean;
}

interface PendingBranchUpstream {
  branch: string;
  current: string | null;
}

interface PendingPublishBranch {
  branch: string;
}

interface PendingWorktreeAction {
  path: string;
  branch: string | null;
  deleteBranch: boolean;
  changes: number;
}

interface FileContextMenuState {
  content: FileMediaSelection | null;
  x: number;
  y: number;
  path: string;
  staged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

interface WorkingTreeDisplayRow {
  kind: 'directory' | 'file';
  key: string;
  label: string;
  path: string;
  depth: number;
  entry: WorkingTreeEntry | null;
}

interface CommitFileDisplayRow {
  kind: 'directory' | 'file';
  key: string;
  label: string;
  path: string;
  depth: number;
  file: CommitFile | null;
}

type DiffFileNavigationTarget =
  | { source: 'working'; path: string; staged: boolean }
  | { source: 'commit' | 'comparison'; file: CommitFile };

interface CommitFileContextMenuState {
  content: FileMediaSelection | null;
  x: number;
  y: number;
  oid: string;
  file: CommitFile;
  paths: string[];
  source: 'commit' | 'comparison';
}

interface StashContextMenuState {
  x: number;
  y: number;
  stash: StashEntry;
  repositoryId: string;
}

interface PendingFileAction {
  kind: 'discard' | 'discard-bulk' | 'recover-discard' | 'forget-discard' | 'discard-hunk' | 'discard-lines' | 'ignore' | 'restore-commit';
  path: string;
  untracked: boolean;
  oid?: string;
  paths?: string[];
  patternKind?: 'file' | 'extension' | 'directory';
  staged?: boolean;
  hunkIndex?: number;
  lineIndices?: number[];
  expectedPatch?: string;
  preview?: DiscardPreview;
  repositoryId?: string;
  recovery?: DiscardRecovery;
}

interface GhostBranchState {
  branch: Branch;
  commitOid: string;
}

interface BranchDropState {
  source: string;
  target: string;
  x: number;
  y: number;
}

type GraphColumn = 'branch' | 'graph' | 'message' | 'author' | 'date' | 'sha';
type PullStrategy = 'merge' | 'ff-only' | 'rebase';
type PreferencesSection = 'general' | 'graph' | 'git' | 'editor' | 'terminal';
type AuthorMarkerStyle = 'initials' | 'color';
type ReferenceSection = 'worktrees' | 'local' | 'remote' | 'tags' | 'stashes' | 'submodules';
type ReferenceDisclosureSection = ReferenceSection | 'pullRequests';
type ReferencePane = Exclude<ReferenceSection, 'local'> | 'pullRequests';
type ResizablePanel = 'sidebar' | 'details';
type TerminalCursorStyle = 'block' | 'underline' | 'bar';
type WorkingTreeViewMode = 'path' | 'tree';
type WorkingTreeFileListSection = 'unstaged' | 'staged';
type AutoFetchIntervalMinutes = 0 | 1 | 5 | 15 | 30;

const DEFAULT_GRAPH_COLUMNS: GraphColumn[] = ['branch', 'graph', 'message', 'author', 'date', 'sha'];
const GRAPH_COLUMN_TITLES: Record<GraphColumn, string> = {
  branch: 'BRANCH / TAG',
  graph: 'GRAPH',
  message: 'COMMIT MESSAGE',
  author: 'AUTHOR',
  date: 'DATE / TIME',
  sha: 'SHA',
};
const GRAPH_COLUMN_LABELS: Record<GraphColumn, string> = {
  branch: 'Branch / Tag',
  graph: 'Graph',
  message: 'Commit Message',
  author: 'Author',
  date: 'Date / Time',
  sha: 'SHA',
};
const GRAPH_COLUMN_ICONS: Record<GraphColumn, IconName> = {
  branch: 'branch',
  graph: 'merge',
  message: 'git-commit',
  author: 'user',
  date: 'clock',
  sha: 'git-commit',
};
const GRAPH_COLUMN_DEFAULT_WIDTHS: Record<GraphColumn, number> = {
  branch: 180,
  graph: 110,
  message: 260,
  author: 105,
  date: 100,
  sha: 68,
};
const GRAPH_SETTINGS_PANEL_WIDTH = 252;
const GRAPH_SETTINGS_VIEWPORT_GUTTER = 8;
const REMOTE_LOCATION_ICONS: ReadonlyArray<{ value: RemoteLocationIcon; label: string }> = [
  { value: 'remote', label: 'Cloud' },
  { value: 'server', label: 'Server' },
  { value: 'globe', label: 'Globe' },
  { value: 'link', label: 'Link' },
];
const DEFAULT_ZOOM = 100;
const ZOOM_LEVELS = [75, 80, 90, DEFAULT_ZOOM, 110, 125, 140, 150, 175, 200] as const;
const AUTO_FETCH_INTERVALS: readonly AutoFetchIntervalMinutes[] = [0, 1, 5, 15, 30];
const LIVE_STATUS_REFRESH_MS = 30_000;
const AUTHOR_PALETTE = [
  '#a95576', '#23798a', '#a8612b', '#7061bd', '#347e56', '#a85151',
  '#3e76ad', '#8c7332', '#a45c9a', '#357f7a', '#9a5f45', '#59699e',
] as const;
const COMMIT_ROW_HEIGHT = 40;
const WORKTREE_ROW_HEIGHT = 44;
const GRAPH_ACTION_MENU_WIDTH = 276;
const VIEWPORT_MENU_GUTTER = 8;
const GRAPH_OVERSCAN_ROWS = 12;

/**
 * Returns how many leading items `next` shares (by identity) with `previous` when `previous` is a
 * prefix of it, or 0 otherwise. History grows page by page, so derived data only processes the tail.
 */
function appendedFrom<T>(previous: readonly T[] | null, next: readonly T[]): number {
  if (!previous || previous.length > next.length) return 0;
  for (let index = previous.length - 1; index >= 0; index -= 1) if (previous[index] !== next[index]) return 0;
  return previous.length;
}

function sameVirtualWindow<T>(a: VirtualWindow<T>, b: VirtualWindow<T>): boolean {
  if (a.start !== b.start || a.capacity !== b.capacity || a.topPadding !== b.topPadding
    || a.bottomPadding !== b.bottomPadding || a.items.length !== b.items.length) return false;
  for (let index = 0; index < a.items.length; index += 1) if (a.items[index] !== b.items[index]) return false;
  return true;
}
const HISTORY_PREFETCH_ROWS = 120;
const RESPONSIVE_SIDEBAR_BREAKPOINT = 1050;
const FULL_WIDTH_INSPECTOR_BREAKPOINT = 760;
const WIDE_GRAPH_METADATA_BREAKPOINT = 1320;
// Enough room for the default Branch, Graph, Message, Author and Date tracks plus row chrome.
const GRAPH_METADATA_MIN_VIEWPORT_WIDTH = 780;
const GRAPH_DATE_COLUMN_FLOOR = 32;
const GRAPH_MESSAGE_COLUMN_MAX = 2400;
const GRAPH_HORIZONTAL_SCROLL_KEY = 'git-khronos.graph.horizontal-scroll';
const GRAPH_COLUMN_RESIZE_LABELS: Record<GraphColumn, string> = {
  branch: 'Resize Branch and Tag column',
  graph: 'Resize Graph column',
  message: 'Resize Commit Message column',
  author: 'Resize Author column',
  date: 'Resize Date and Time column',
  sha: 'Resize SHA column',
};
const PANEL_WIDTH_LIMITS: Record<ResizablePanel, { minimum: number; maximum: number; default: number }> = {
  sidebar: { minimum: 170, maximum: 420, default: 250 },
  details: { minimum: 280, maximum: 560, default: 355 },
};
const REFERENCE_SECTION_MIN_HEIGHT = 70;
const REFERENCE_SECTION_MAX_HEIGHT = 420;
const REFERENCE_SECTION_FALLBACK_HEIGHT = 120;
const REFERENCE_LIST_ROW_HEIGHT = 30;
const REFERENCE_LIST_OVERSCAN_ROWS = 5;
const WORKING_TREE_FILE_LIST_MIN_HEIGHT = 80;
const WORKING_TREE_FILE_LIST_MAX_HEIGHT = 420;
const WORKING_TREE_FILE_LIST_DEFAULT_HEIGHT = 165;
const WORKING_TREE_FILE_ROW_HEIGHT = 31;
const WORKING_TREE_FILE_OVERSCAN_ROWS = 6;
// Ghost branch hints are optional decoration. Keep their graph walk bounded so
// selecting a commit cannot monopolize the WebView on enormous histories.
const GHOST_BRANCH_VISIT_LIMIT = 4_096;
const RELATED_COMMIT_VISIT_LIMIT = 8_192;
const COMMIT_FILE_ROW_HEIGHT = 36;
const COMMIT_FILE_VIEWPORT_HEIGHT = 190;
const COMMIT_FILE_OVERSCAN_ROWS = 4;
const BRANCH_PICKER_RESULT_LIMIT = 80;
const COMMAND_DYNAMIC_RESULT_LIMIT = 80;
const COMMAND_QUICK_ACTION_LIMIT = 6;
const COMMAND_QUICK_ACTION_IDS: readonly string[] = ['fetch', 'pull', 'push', 'refresh', 'terminal', 'search', 'open', 'clone', 'preferences', 'shortcuts'];
const COMMAND_GROUP_ORDER: readonly string[] = ['Quick Actions', 'Workspace', 'Repository', 'Git Features', 'Edit', 'Remote', 'Branch', 'Working Tree', 'History', 'View'];
const EMPTY_COMMITS: CommitSummary[] = [];

function normalizeZoom(value: unknown): number {
  if (typeof value === 'string' && !value.trim()) return DEFAULT_ZOOM;
  const requested = Number(value);
  if (!Number.isFinite(requested)) return DEFAULT_ZOOM;
  if (requested <= ZOOM_LEVELS[0]) return ZOOM_LEVELS[0];
  if (requested >= ZOOM_LEVELS.at(-1)!) return ZOOM_LEVELS.at(-1)!;
  return ZOOM_LEVELS.reduce((closest, level) =>
    Math.abs(level - requested) < Math.abs(closest - requested) ? level : closest
  );
}

function stableAuthorColor(identity: string): string {
  let hash = 2_166_136_261;
  for (const character of identity) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return AUTHOR_PALETTE[(hash >>> 0) % AUTHOR_PALETTE.length];
}

function matchesCommandQuery(query: string, ...values: string[]): boolean {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const searchable = values.join(' ').toLocaleLowerCase();
  return tokens.every((token) => searchable.includes(token));
}

function commandMatchScore(query: string, action: CommandAction): number {
  const phrase = query.trim().toLocaleLowerCase();
  const tokens = phrase.split(/\s+/).filter(Boolean);
  const label = action.label.toLocaleLowerCase();
  const group = action.group.toLocaleLowerCase();
  const detail = action.detail.toLocaleLowerCase();

  if (label === phrase) return 1_000;
  if (label.startsWith(phrase)) return 900;
  if (tokens.every((token) => label.includes(token))) return 800;
  if (label.includes(phrase)) return 700;
  if (group === phrase) return 600;
  if (group.startsWith(phrase)) return 500;
  if (tokens.every((token) => group.includes(token))) return 400;
  if (detail.includes(phrase)) return 300;
  if (tokens.every((token) => detail.includes(token))) return 200;
  return 100;
}

@Component({
  selector: 'gc-root',
  imports: [FileToolsDialogComponent, EditorDraftRecoveryComponent, RepositoryLinkDialogComponent, FileContentDialogComponent, FileMediaComponent, BranchWorkflowDialogComponent, WorkspaceCenterComponent, MergePreviewDialogComponent, StashDeleteDialogComponent, FileBlameComponent, FileHistoryComponent,
    DatePipe, TextValueDirective, NgTemplateOutlet, IconComponent, TerminalPanelComponent, GraphViewportComponent, ViewportSizeDirective, WorkingTreeViewportComponent, WorktreeGraphRowComponent, AuthenticationComponent, HistorySearchComponent, ReferenceActionDialogComponent, StashOptionsDialogComponent, FetchOptionsDialogComponent, WorktreeMoveDialogComponent, LfsTrackingDialogComponent, KeyboardShortcutsDialogComponent, RepositoryDialogComponent, WorktreeRegistrationDialogComponent, GitDocumentationDialogComponent, CommitPolicyFieldsComponent, CommitTemplateBannerComponent, CommitSignatureComponent, InteractiveRebaseEditorComponent, HistoryReviewDialogComponent, MergeRebaseDialogComponent, PreferencesDialogComponent, CommandPaletteComponent, ActivityLogDrawerComponent, WelcomeLauncherComponent, LfsPruneDialogComponent, RepositoryConfirmationsComponent, ErrorToastComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  protected readonly authenticationLoadErrorDismissed = signal(false);
  private readonly appMenuToggle = viewChild<ElementRef<HTMLButtonElement>>('appMenuToggle');
  private readonly workspaceToggle = viewChild<ElementRef<HTMLButtonElement>>('workspaceToggle');
  private readonly workspaceNameInput = viewChild<ElementRef<HTMLInputElement>>('workspaceNameInput');
  private readonly commitSearch = viewChild<ElementRef<HTMLInputElement>>('commitSearch');
  private readonly commitSearchToggle = viewChild<ElementRef<HTMLButtonElement>>('commitSearchToggle');
  private readonly historySearchToggle = viewChild<ElementRef<HTMLButtonElement>>('historySearchToggle');
  private readonly diffFileMenuToggle = viewChild<ElementRef<HTMLButtonElement>>('diffFileMenuToggle');
  private readonly preferencesToggle = viewChild<ElementRef<HTMLButtonElement>>('preferencesToggle');
  private readonly worktreeDialogElement = viewChild<ElementRef<HTMLElement>>('worktreeDialogElement');
  private readonly submoduleDialogElement = viewChild<ElementRef<HTMLElement>>('submoduleDialogElement');
  private readonly remoteDialogElement = viewChild<ElementRef<HTMLElement>>('remoteDialogElement');
  private readonly workspaceDeleteDialog = viewChild<ElementRef<HTMLElement>>('workspaceDeleteDialog');
  private readonly lfsLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('lfsLoaderClose');
  private readonly documentationLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('documentationLoaderClose');
  private readonly worktreeReviewLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('worktreeReviewLoaderClose');
  private readonly repositoryLinkLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('repositoryLinkLoaderClose');
  private readonly repositoryLinkLoaderFocus = afterRenderEffect(() => this.repositoryLinkLoaderClose()?.nativeElement.focus());
  private readonly fileContentLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('fileContentLoaderClose');
  private readonly fileContentLoaderFocus = afterRenderEffect(() => this.fileContentLoaderClose()?.nativeElement.focus());
  private readonly actionLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('actionLoaderClose');
  private readonly historyLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('historyLoaderClose');
  private readonly workspaceCenterLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('workspaceCenterLoaderClose');
  private readonly workspaceCenterLoaderFocus = afterRenderEffect(() => this.workspaceCenterLoaderClose()?.nativeElement.focus());
  private readonly branchWorkflowLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('branchWorkflowLoaderClose');
  private readonly branchWorkflowLoaderFocus = afterRenderEffect(() => this.branchWorkflowLoaderClose()?.nativeElement.focus());
  private readonly mergePreviewLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('mergePreviewLoaderClose');
  private readonly mergePreviewLoaderFocus = afterRenderEffect(() => this.mergePreviewLoaderClose()?.nativeElement.focus());
  private readonly rebaseLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('rebaseLoaderClose');
  private readonly historyReviewLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('historyReviewLoaderClose');
  private readonly worktreeRemovalDialog = viewChild<ElementRef<HTMLElement>>('worktreeRemovalDialog');
  private readonly branchSearch = viewChild<ElementRef<HTMLInputElement>>('branchSearch');
  private readonly toolbarBranchToggle = viewChild<ElementRef<HTMLButtonElement>>('toolbarBranchToggle');
  private readonly toolbarBranchSearch = viewChild<ElementRef<HTMLInputElement>>('toolbarBranchSearch');
  private readonly toolbarRemoteToggle = viewChild<ElementRef<HTMLButtonElement>>('toolbarRemoteToggle');
  private readonly responsiveSidebarToggle = viewChild<ElementRef<HTMLButtonElement>>('responsiveSidebarToggle');
  private readonly commitPanelToggle = viewChild<ElementRef<HTMLButtonElement>>('commitPanelToggle');
  private readonly commitPanel = viewChild<ElementRef<HTMLElement>>('commitPanel');
  private readonly commitPanelClose = viewChild<ElementRef<HTMLButtonElement>>('commitPanelClose');
  private readonly authorFilterSearch = viewChild<ElementRef<HTMLInputElement>>('authorFilterSearch');
  private readonly commitSummary = viewChild<ElementRef<HTMLInputElement>>('commitSummary');
  private readonly editedCommitSummaryInput = viewChild<ElementRef<HTMLInputElement>>('editedCommitSummaryInput');
  private readonly focusedDiff = viewChild<ElementRef<HTMLElement>>('focusedDiff');
  private readonly graphSettingsToggle = viewChild<ElementRef<HTMLButtonElement>>('graphSettingsToggle');
  private readonly graphSettingsPanel = viewChild<ElementRef<HTMLElement>>('graphSettingsPanel');
  private readonly graphColumns = viewChild<ElementRef<HTMLElement>>('graphColumns');
  private readonly actionMenuElement = viewChild<ElementRef<HTMLElement>>('actionMenuElement');
  private readonly fileActionMenuElement = viewChild<ElementRef<HTMLElement>>('fileActionMenuElement');
  private readonly sidebarActionMenuElement = viewChild<ElementRef<HTMLElement>>('sidebarActionMenuElement');
  private readonly sidebarContextMenuElement = viewChild<ElementRef<HTMLElement>>('sidebarContextMenuElement');
  private readonly branchDropMenuElement = viewChild<ElementRef<HTMLElement>>('branchDropMenuElement');
  private readonly repositoryTabMenuElement = viewChild<ElementRef<HTMLElement>>('repositoryTabMenuElement');
  private readonly repositoryAliasInput = viewChild<ElementRef<HTMLInputElement>>('repositoryAliasInput');
  private readonly newRepositoryTab = viewChild<ElementRef<HTMLButtonElement>>('newRepositoryTab');
  private readonly repositoryTabsMenu = viewChild<ElementRef<HTMLElement>>('repositoryTabsMenu');
  private readonly repositoryTabsToggle = viewChild<ElementRef<HTMLButtonElement>>('repositoryTabsToggle');
  private readonly repositoryTabs = viewChild<ElementRef<HTMLElement>>('repositoryTabs');
  private readonly historyConfirmationDialog = viewChild<unknown, ElementRef<HTMLElement>>('historyConfirmationDialog', { read: ElementRef });
  private readonly branchConfirmationDialog = viewChild<ElementRef<HTMLElement>>('branchConfirmationDialog');
  private readonly checkpointConfirmationDialog = viewChild<ElementRef<HTMLElement>>('checkpointConfirmationDialog');
  private readonly fileConfirmationDialog = viewChild<ElementRef<HTMLElement>>('fileConfirmationDialog');
  private readonly workingTreeOptionsMenu = viewChild<ElementRef<HTMLElement>>('workingTreeOptionsMenu');
  private readonly workingTreeOptionsToggle = viewChild<ElementRef<HTMLButtonElement>>('workingTreeOptionsToggle');
  private readonly unstagedFilesList = viewChild<ElementRef<HTMLElement>>('unstagedFilesList');
  private readonly stagedFilesList = viewChild<ElementRef<HTMLElement>>('stagedFilesList');
  private readonly unstagedFilesViewport = viewChild<WorkingTreeViewportComponent>('unstagedFilesViewport');
  private readonly stagedFilesViewport = viewChild<WorkingTreeViewportComponent>('stagedFilesViewport');
  private readonly terminalToggle = viewChild<ElementRef<HTMLButtonElement>>('terminalToggle');
  private readonly commitList = viewChild<ElementRef<HTMLElement>>('commitList');
  private readonly commitListAttachEffect = effect(() => {
    const value = this.commitList();
    untracked(() => this.attachCommitList(value));
  });
  private attachCommitList(value: ElementRef<HTMLElement> | undefined): void {
    if ((value?.nativeElement ?? null) === this.commitListElement && this.commitListElement) return;
    this.commitListResizeObserver?.disconnect();
    this.detachGraphWheel();
    this.commitListElement = value?.nativeElement ?? null;
    if (!this.commitListElement) return;
    const element = this.commitListElement;
    element.addEventListener('wheel', this.handleGraphWheel, { passive: false });
    queueMicrotask(() => {
      if (this.commitListElement === element) {
        this.updateGraphViewport(element, true);
        this.prefetchOlderHistory(element);
      }
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.commitListResizeObserver = new ResizeObserver(() => {
        if (this.commitListElement) {
          this.updateGraphViewport(this.commitListElement, true);
          this.prefetchOlderHistory(this.commitListElement);
        }
      });
      this.commitListResizeObserver.observe(this.commitListElement);
    }
  }

  protected readonly git = inject(GitKhronosService);
  protected readonly historySearch = inject(HistorySearchService);
  private readonly externalHistoryCommit = signal<CommitSummary | null>(null);
  protected readonly repositoryHistorySearch = viewChild<HistorySearchComponent>('repositoryHistorySearch');
  protected readonly historySearchRequested = signal(false);
  private historySearchLoaderOpener: HTMLElement | null = null;
  private readonly graphViewport = viewChild(GraphViewportComponent);
  private readonly injector = inject(Injector);
  // Keep history-dependent computations insulated from status-only repository
  // updates. Angular otherwise invalidates every graph computation whenever the
  // repository object is replaced, even when the commits array is unchanged.
  private readonly graphCommits = computed(
    () => this.git.repository()?.commits ?? EMPTY_COMMITS,
    { equal: Object.is },
  );
  private readonly graphBranches = computed(
    () => this.git.repository()?.branches ?? [],
    { equal: Object.is },
  );
  private readonly graphStashes = computed(
    () => this.git.repository()?.stashes ?? [],
    { equal: Object.is },
  );
  protected readonly hostedReviewRequests = computed(() =>
    hostedReviewRequestsForRemotes(this.git.repository()?.remotes ?? []),
  );
  private readonly graphCommitByOid = computed(() => new Map(
    this.graphCommits().map((commit) => [commit.oid, commit] as const),
  ));
  private readonly branchByDecoration = computed(() => {
    const index = new Map<string, Branch>();
    for (const branch of this.graphBranches()) {
      const namespace = branch.remote ? 'remotes' : 'heads';
      for (const key of [branch.fullName, branch.name, `${namespace}/${branch.name}`, `refs/${namespace}/${branch.name}`]) {
        if (!index.has(key)) index.set(key, branch);
      }
    }
    return index;
  });
  private referencePresentationBranches: readonly Branch[] | null = null;
  private readonly referencePresentationCache = new Map<string, ReferencePresentation>();
  private contextMenuReturnFocus: HTMLElement | null = null;
  private fileContextMenuReturnFocus: HTMLElement | null = null;
  private sidebarActionMenuReturnFocus: HTMLElement | null = null;
  protected readonly sidebarActionMenuPosition = signal({ x: 8, y: 8 });
  private sidebarContextMenuReturnFocus: HTMLElement | null = null;
  private branchDropMenuReturnFocus: HTMLElement | null = null;
  private repositoryTabMenuReturnFocus: HTMLElement | null = null;
  private terminalOpener: HTMLElement | null = null;
  private historyActionReturnFocus: HTMLElement | null = null;
  private branchActionReturnFocus: HTMLElement | null = null;
  private checkpointActionReturnFocus: HTMLElement | null = null;
  private fileActionReturnFocus: HTMLElement | null = null;
  private readonly graphCommitChildrenByOid = computed(() => {
    const children = new Map<string, CommitSummary[]>();
    for (const commit of this.graphCommits()) {
      for (const parent of commit.parents) {
        const entries = children.get(parent) ?? [];
        entries.push(commit);
        children.set(parent, entries);
      }
    }
    return children;
  });
  protected readonly shortcutLabels = shortcutLabelsForPlatform(
    typeof navigator === 'undefined' ? '' : navigator.platform,
  );
  protected readonly primaryShortcutKey = this.shortcutLabels.primary;
  protected readonly alternateShortcutKey = this.shortcutLabels.alternate;
  protected readonly favoriteShortcut = this.shortcutLabels.favorite;
  protected readonly fullscreenShortcut = this.shortcutLabels.fullscreen;
  protected readonly undoShortcut = this.shortcutLabels.undo;
  protected readonly redoShortcut = this.shortcutLabels.redo;
  protected readonly firstCommitShortcut = this.shortcutLabels.firstCommit;
  protected readonly lastCommitShortcut = this.shortcutLabels.lastCommit;
  protected readonly commitMessage = signal('');
  protected readonly commitDescription = signal('');
  protected readonly stashMessage = signal('');
  protected readonly stashDialog = signal<StashDialogRequest | null>(null);
  protected readonly coAuthors = signal<CoAuthor[]>([]);
  protected readonly coAuthorPickerOpen = signal(false);
  protected readonly coAuthorName = signal('');
  protected readonly coAuthorEmail = signal('');
  protected readonly branchCreatorOpen = signal(false);
  protected readonly branchName = signal('');
  protected readonly branchCreationError = signal<string | null>(null);
  private branchCreatorReturnFocus: HTMLElement | null = null;
  private branchCreatorPreviousLocalHeight: number | null = null;
  protected readonly amendPrevious = signal(false);
  protected readonly skipGitHooks = signal(false);
  protected readonly commitPolicy = signal<CommitPolicy>({ signOff: false, allowEmpty: false, author: null, committer: null });
  protected readonly commitPolicyOpen = signal(false);
  protected readonly signCommit = signal(false);
  protected readonly pushAfterCommit = signal(false);
  protected readonly commitMessageEditing = signal(false);
  protected readonly editedCommitSummary = signal('');
  protected readonly editedCommitDescription = signal('');
  protected readonly editedCommitCoAuthors = signal<CoAuthor[]>([]);
  protected readonly mergePreviewRequest = signal<MergePreviewDialogRequest | null>(null);
  protected readonly contextMenu = signal<ContextMenuState | null>(null);
  protected readonly fileToolsDialog = signal<FileToolsDialogRequest | null>(null);
  private readonly fileToolsLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('fileToolsLoaderClose');
  protected openFileTools(action: FileToolsDialogRequest['action'] = null, returnFocus: HTMLElement | null = null): void {
    const repoId = this.git.activeRepositoryId();
    if (!repoId || this.git.busy() || this.fileContentDialog()) return;
    this.appMenuOpen.set(false);
    this.fileToolsDialog.set({ id: crypto.randomUUID(), repoId, action,
      returnFocus: returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null) });
  }
  protected closeFileTools(): void {
    const opener = this.fileToolsDialog()?.returnFocus; this.fileToolsDialog.set(null);
    queueMicrotask(() => { if (!this.fileToolsDialog() && opener?.isConnected && !opener.closest('[inert]')) opener.focus(); });
  }
  protected handleFileToolsLoaderKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.closeFileTools(); }
    else if (event.key === 'Tab') { event.preventDefault(); this.fileToolsLoaderClose()?.nativeElement.focus(); }
  }
  protected fileToolsChanged(repoId: string): void { this.scheduleRepositoryRefresh(repoId); }
  protected readonly fileContentDialog = signal<FileContentDialogRequest | null>(null);
  protected readonly editorDraftRecoveryOpen = signal(false);
  private editorDraftRecoveryReturnFocus: HTMLElement | null = null;
  private readonly editorDraftRecoveryLoaderClose = viewChild<ElementRef<HTMLButtonElement>>('editorDraftRecoveryLoaderClose');
  protected readonly repositoryLinkDialog = signal<RepositoryLinkDialogRequest | null>(null);
  protected readonly fileContextMenu = signal<FileContextMenuState | null>(null);
  protected readonly commitFileContextMenu = signal<CommitFileContextMenuState | null>(null);
  protected readonly stashContextMenu = signal<StashContextMenuState | null>(null);
  protected readonly selectedPanelFiles = signal<string[]>([]);
  protected readonly panelFileSelectionSource = signal<'commit' | 'comparison' | null>(null);
  protected readonly panelFileSelectionAnchor = signal<string | null>(null);
  protected readonly appMenuOpen = signal(false);
  protected readonly zoomControlsWidth = signal(208);
  protected readonly workspaceMenuOpen = signal(false);
  protected readonly branchWorkflowRequest = signal<BranchWorkflowDialogRequest | null>(null);
  protected readonly workspaceCenterRequest = signal<WorkspaceCenterRequest | null>(null);
  protected readonly workspaceDialogMode = signal<'create' | 'rename' | null>(null);
  protected readonly workspaceName = signal('');
  protected readonly pendingWorkspaceDelete = signal<RepositoryWorkspace | null>(null);
  protected readonly workspaceNameConflict = computed(() => {
    const name = this.workspaceName().trim().toLocaleLowerCase();
    const mode = this.workspaceDialogMode();
    if (!name || !mode) return false;
    const activeId = this.git.activeWorkspaceId();
    return this.git.workspaces().some((workspace) =>
      workspace.name.toLocaleLowerCase() === name
      && (mode === 'create' || workspace.id !== activeId));
  });
  protected readonly workspaceMenuItems = computed(() => {
    const activeWorkspaceId = this.git.activeWorkspaceId();
    const workspaces = this.git.workspaces();
    const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
    const ordered = active
      ? [active, ...workspaces.filter((workspace) => workspace.id !== activeWorkspaceId)]
      : workspaces;
    const activeRepositoryPaths = this.git.repositories().map((repository) => repository.path);
    return ordered.map((workspace) => {
      const paths = workspace.id === activeWorkspaceId && activeRepositoryPaths.length
        ? activeRepositoryPaths
        : workspace.repositoryPaths;
      const repositoryLabels = [...new Set(paths)].map((path) => this.git.pathLabel(path));
      const shortcutIndex = workspaces.indexOf(workspace) + 1;
      return {
        workspace,
        current: workspace.id === activeWorkspaceId,
        shortcutIndex: shortcutIndex <= 9 ? shortcutIndex : null,
        repositoryCount: this.git.workspaceRepositoryCount(workspace),
        repositoryLabels,
        repositorySummary: !repositoryLabels.length
          ? 'No repositories yet'
          : repositoryLabels.length === 1
            ? repositoryLabels[0]
            : `${repositoryLabels[0]} + ${repositoryLabels.length - 1} more`,
      };
    });
  });
  protected readonly repositoryTabsOpen = signal(false);
  protected readonly repositoryTabOverflow = signal(repositoryTabOverflowState({
    scrollPosition: 0,
    viewportWidth: 0,
    contentWidth: 0,
  }));
  protected readonly toolbarRemoteMenuOpen = signal(false);
  protected readonly selectedRemoteName = signal('');
  protected readonly toolbarCheckoutMenuOpen = signal(false);
  protected readonly toolbarBranchQuery = signal('');
  protected readonly repositoryTabMenu = signal<RepositoryTabMenuState | null>(null);
  protected readonly repositoryTabMenuRepository = computed(() => {
    const menu = this.repositoryTabMenu();
    return menu ? this.git.repositories().find((repository) => repository.id === menu.repoId) ?? null : null;
  });
  protected readonly repositoryTabsToRightCount = computed(() => {
    const target = this.repositoryTabMenuRepository();
    if (!target) return 0;
    const index = this.git.repositories().findIndex((repository) => repository.id === target.id);
    return index < 0 ? 0 : this.git.repositories().length - index - 1;
  });
  protected readonly remoteGroupMenu = signal<RemoteGroupMenuState | null>(null);
  protected readonly repositoryAlias = signal('');
  protected readonly repositoryAliasEditing = signal(false);
  protected readonly preferencesOpen = signal(false);
  protected readonly preferencesSection = signal<PreferencesSection>('general');
  protected readonly resetUiConfirmation = signal(false);
  protected readonly identityPopoverOpen = signal(false);
  protected readonly identityEditing = signal(false);
  protected readonly identityName = signal('');
  protected readonly identityEmail = signal('');
  protected readonly repositoryDialog = signal<RepositoryDialogMode | null>(null);
  protected readonly repositoryDialogFocusRequest = signal(0);
  protected readonly worktreeDialogOpen = signal(false);
  protected readonly worktreeBranch = signal('');
  protected readonly worktreeBase = signal('');
  protected readonly worktreeParent = signal('');
  protected readonly worktreeFolder = signal('');
  protected readonly worktreeHandoff = signal<'none' | 'terminal'>('none');
  protected readonly worktreeCreationSource = signal<string | null>(null);
  protected readonly worktreeMenuPath = signal<string | null>(null);
  protected readonly worktreeMoveRequest = signal<WorktreeMoveRequest | null>(null);
  protected readonly worktreeRegistrationRequest = signal<WorktreeRegistrationRequest | null>(null);
  protected readonly documentation = inject(GitDocumentationService);
  protected readonly lfsTrackingRequest = signal<LfsTrackingRequest | null>(null);
  protected readonly submoduleMenuPath = signal<string | null>(null);
  protected readonly referencePaneMenu = signal<{ x: number; y: number } | null>(null);
  protected readonly submoduleDialogOpen = signal(false);
  protected readonly submoduleUrl = signal('');
  protected readonly submodulePath = signal('');
  protected readonly remoteDialog = signal<RemoteDialogMode | null>(null);
  protected readonly remoteName = signal('');
  protected readonly remoteUrl = signal('');
  protected readonly remotePushUrl = signal('');
  private initialRemotePushUrl = '';
  protected readonly remoteDialogIcon = signal<RemoteLocationIcon>('remote');
  protected readonly pendingRemoteRemoval = signal<Remote | null>(null);
  protected readonly pendingLfsPrune = signal(false);
  protected readonly lfsPrunePreview = signal<LfsPrunePreview | null>(null);
  protected readonly lfsPruneReviewing = signal(false);
  protected readonly pendingSparseCheckoutAction = signal<'set' | 'disable' | null>(null);
  protected readonly pendingWorktreeAction = signal<PendingWorktreeAction | null>(null);
  protected readonly forceWorktreeRemoval = signal(false);
  protected readonly activityLogOpen = signal(false);
  protected readonly recoveryHistoryOpen = signal(false);
  protected readonly recoveryQuery = signal('');
  protected readonly recoveryBranchEntry = signal<ReflogEntry | null>(null);
  protected readonly recoveryBranchName = signal('');
  protected readonly recoveryBranchError = signal<string | null>(null);
  protected readonly terminalOpen = signal(false);
  protected readonly terminalRepositoryId = signal<string | null>(null);
  protected readonly terminalRepositoryIds = signal<string[]>([]);
  protected readonly activityLogTab = signal<ActivityLogTab>('repository');
  protected readonly contextBranchName = signal('');
  protected readonly contextBranchCreatorOpen = signal(false);
  protected readonly contextBranchError = signal<string | null>(null);
  private contextMenuGeneration = 0;
  protected readonly contextTagName = signal('');
  protected readonly pendingTagTarget = signal<{ oid: string; label: string } | null>(null);
  protected readonly tagCreationKind = signal<'lightweight' | 'annotated'>('lightweight');
  protected readonly tagCreationMessage = signal('');
  protected readonly contextRenameName = signal('');
  protected readonly pendingHistoryAction = signal<PendingHistoryAction | null>(null);
  private historyActionRepositoryId: string | null = null;
  protected readonly historyMainline = signal<number | null>(null);
  protected readonly historyNoCommit = signal(false);
  protected readonly historyMergeParents = computed(() => {
    const action = this.pendingHistoryAction();
    if (!action || action.kind === 'reset' || action.kind === 'split') return [];
    return action.oids.flatMap(oid => {
      const commit = this.graphCommitByOid().get(oid)
        ?? (this.externalHistoryCommit()?.oid === oid ? this.externalHistoryCommit() : null);
      return commit && commit.parents.length > 1 ? commit.parents : [];
    });
  });
  protected readonly pendingBisectStart = signal<PendingBisectStart | null>(null);
  protected readonly pendingBranchRename = signal<string | null>(null);
  protected readonly pendingBranchAction = signal<PendingBranchAction | null>(null);
  protected readonly pendingCheckpointDelete = signal<PendingCheckpointDelete | null>(null);
  protected readonly pendingBranchUpstream = signal<PendingBranchUpstream | null>(null);
  protected readonly branchUpstreamChoice = signal('');
  protected readonly pendingPublishBranch = signal<PendingPublishBranch | null>(null);
  protected readonly publishRemote = signal('');
  protected readonly pendingFileAction = signal<PendingFileAction | null>(null);
  protected readonly selectedDiscardPaths = signal<string[]>([]);
  protected readonly discardSelectionMode = signal(false);
  protected readonly savedDiscards = signal<DiscardRecovery[] | null>(null);
  protected readonly savedDiscardsRepositoryId = signal<string | null>(null);
  protected readonly referenceAction = signal<ReferenceActionRequest | null>(null);
  protected readonly signNewTag = signal(false);
  protected readonly pendingStashDelete = signal<StashDeleteRequest | null>(null);
  protected readonly stashRenameTarget = signal<StashEntry | null>(null);
  private stashRenameRepositoryId: string | null = null;
  protected readonly stashRenameMessage = signal('');
  protected readonly conflictOutput = signal('');
  protected readonly fetchRequest = signal<FetchDialogRequest | null>(null);
  private conflictReturnFocus: HTMLElement | null = null;
  private conflictActionRequest = 0;
  protected readonly forceBranchDelete = signal(false);
  protected readonly resetMode = signal<'soft' | 'mixed' | 'hard'>('mixed');
  protected readonly resetPreview = signal<ResetPreview | null>(null);
  protected readonly resetPreviewBusy = signal(false);
  private resetPreviewRequest = 0;
  private resetPreviewRepositoryId: string | null = null;
  protected readonly operationRecoveries = signal<OperationRecovery[] | null>(null);
  protected readonly recoveryCaptureBusy = signal(false);
  protected readonly recoveryCaptureAction = signal<{ record: OperationRecovery; kind: 'restore' | 'remove' } | null>(null);
  protected readonly recoveryCaptureBranch = signal('');
  private recoveryRepositoryId: string | null = null;
  private recoveryHistoryReturnFocus: HTMLElement | null = null;
  protected readonly filteredOperationRecoveries = computed(() => {
    const query = this.recoveryQuery().trim().toLowerCase();
    return (this.operationRecoveries() ?? []).filter((entry) =>
      !query || `${entry.label} ${entry.headOid} ${entry.id}`.toLowerCase().includes(query));
  });
  protected readonly commandPaletteOpen = signal(false);
  protected readonly keyboardShortcutsOpen = signal(false);
  protected readonly diffViewerOpen = signal(false);
  protected readonly diffFileMenuOpen = signal(false);
  protected readonly diffViewMode = signal<DiffViewMode>(this.readDiffViewMode());
  protected readonly diffWordWrap = signal(this.readDiffBoolean('word-wrap', false));
  protected readonly diffFontSize = signal(this.readDiffNumber('font-size', 13, [11, 12, 13, 14, 16]));
  protected readonly diffTabSize = signal(this.readDiffNumber('tab-size', 4, [2, 4, 8]));
  protected readonly activeDiffHunk = signal(0);
  protected readonly selectedDiffLineGroups = signal<string[]>([]);
  private readonly selectedDiffLineGroupSet = computed(() => new Set(this.selectedDiffLineGroups()));
  private readonly untrackedPaths = computed(() => new Set(
    (this.git.repository()?.status.entries ?? [])
      .filter((entry) => entry.indexStatus === '?')
      .map((entry) => entry.path),
  ));
  protected readonly diffInsightMode = signal<DiffInsightMode>('diff');
  protected readonly commandQuery = signal('');
  protected readonly commandPaletteScope = signal<CommandPaletteScope>('all');
  protected readonly commandSelection = signal(0);
  private readonly recentCommandIds = signal(this.readRecentCommandIds());
  protected readonly zoomPercent = signal(this.readZoom());
  protected readonly appTheme = signal<AppTheme>(this.readAppTheme());
  protected readonly appThemeOptions = APP_THEME_OPTIONS;
  protected readonly workingTreeViewMode = signal<WorkingTreeViewMode>(this.readWorkingTreeViewMode());
  protected readonly fileFilter = signal('');
  protected readonly commitOidCopyFeedback = signal<{ oid: string; status: 'copied' | 'failed' } | null>(null);
  private readonly commitFilesScrollTop = signal(0);
  private readonly workingTreeFilesScrollTop = { unstaged: signal(0), staged: signal(0) };
  private readonly referenceListScrollTop = {
    local: signal(0),
    remote: signal(0),
    tags: signal(0),
    stashes: signal(0),
  };
  private readonly referenceListViewportHeight = {
    local: signal(REFERENCE_SECTION_MAX_HEIGHT),
    remote: signal(REFERENCE_SECTION_MAX_HEIGHT),
    tags: signal(REFERENCE_SECTION_MAX_HEIGHT),
    stashes: signal(REFERENCE_SECTION_MAX_HEIGHT),
  };
  protected readonly fileFilterQuery = computed(() => this.fileFilter().trim().toLocaleLowerCase());
  protected readonly workingTreeSortAscending = signal(this.readUiPreference('working-tree-sort-ascending', true));
  protected readonly collapsedWorkingTreeDirectories = signal<string[]>([]);
  protected readonly collapsedCommitDirectories = signal<string[]>([]);
  protected readonly graphSettingsOpen = signal(false);
  protected readonly graphSettingsPosition = signal<{ x: number; y: number } | null>(null);
  protected readonly authorFilterOpen = signal(false);
  /** Author filter menu offset inside the graph header, aligned under its toggle. */
  protected readonly authorFilterPosition = signal({ x: 0, y: 25 });
  protected readonly authorFilter = signal<string | null>(null);
  protected readonly authorFilterQuery = signal('');
  protected readonly graphColumnOrder = signal<GraphColumn[]>([...DEFAULT_GRAPH_COLUMNS]);
  protected readonly graphDateFormat = signal<GraphDateFormat>(this.readGraphDateFormat());
  protected readonly authorMarkerStyle = signal<AuthorMarkerStyle>(this.readAuthorMarkerStyle());
  protected readonly draggedGraphColumn = signal<GraphColumn | null>(null);
  protected readonly fetchMenuOpen = signal(false);
  protected readonly pullMenuOpen = signal(false);
  protected readonly pushMenuOpen = signal(false);
  protected readonly branchMenuOpen = signal(false);
  protected readonly stashMenuOpen = signal(false);
  protected readonly lfsMenuOpen = signal(false);
  protected readonly sparseCheckoutMenuOpen = signal(false);
  protected readonly moreActionsMenuOpen = signal(false);
  protected readonly workingTreeOptionsOpen = signal(false);
  protected readonly pullStrategy = signal<PullStrategy>(this.readPullStrategy());
  protected readonly showToolbarLabels = signal(this.readUiPreference('toolbar-labels', true));
  protected readonly showWorktreeTabGroups = signal(this.readUiPreference('worktree-tab-groups', true));
  protected readonly highlightRelatedCommits = signal(this.readUiPreference('highlight-related-commits', true));
  protected readonly autoFetchIntervalMinutes = signal(this.readAutoFetchInterval());
  protected readonly lfsPattern = signal('');
  protected readonly lfsPatternLockable = signal(false);
  protected readonly sparseCheckoutPaths = signal('');
  protected readonly sparseCheckoutIndex = signal(true);
  protected readonly pendingForcePush = signal(false);
  protected readonly terminalFontFamily = signal(this.readTerminalFontFamily());
  protected readonly terminalFontSize = signal(this.readTerminalNumber('font-size', 13, [10, 11, 12, 13, 14, 16, 18]));
  protected readonly terminalLineHeight = signal(this.readTerminalNumber('line-height', 1.25, [1, 1.15, 1.25, 1.4, 1.5]));
  protected readonly terminalCursorStyle = signal<TerminalCursorStyle>(this.readTerminalCursorStyle());
  private readonly graphViewportWidth = signal(0);
  protected readonly showBranchColumn = signal(this.defaultGraphColumnVisible('branch'));
  protected readonly showGraphColumn = signal(this.defaultGraphColumnVisible('graph'));
  protected readonly showMessageColumn = signal(this.defaultGraphColumnVisible('message'));
  protected readonly showAuthorColumn = signal(this.defaultGraphColumnVisible('author'));
  protected readonly showDateColumn = signal(this.defaultGraphColumnVisible('date'));
  protected readonly showShaColumn = signal(this.defaultGraphColumnVisible('sha'));
  protected readonly compactGraphColumn = signal(false);
  protected readonly showGraphScrollMarkers = signal(true);
  protected readonly branchColumnWidth = signal(GRAPH_COLUMN_DEFAULT_WIDTHS.branch);
  protected readonly graphColumnWidth = signal(GRAPH_COLUMN_DEFAULT_WIDTHS.graph);
  protected readonly messageColumnWidth = signal(GRAPH_COLUMN_DEFAULT_WIDTHS.message);
  protected readonly messageColumnManuallyResized = signal(false);
  protected readonly authorColumnWidth = signal(GRAPH_COLUMN_DEFAULT_WIDTHS.author);
  protected readonly dateColumnWidth = signal(GRAPH_COLUMN_DEFAULT_WIDTHS.date);
  protected readonly shaColumnWidth = signal(GRAPH_COLUMN_DEFAULT_WIDTHS.sha);
  protected readonly selectedCommit = signal<string | null>(null);
  protected readonly selectedCommits = signal<string[]>([]);
  protected readonly selectedWorktreePath = signal<string | null>(null);
  private readonly commitSelectionAnchor = signal<string | null>(null);
  protected readonly changesOpen = signal(true);
  protected readonly conflictedFilesOpen = signal(true);
  protected readonly unstagedFilesOpen = signal(true);
  protected readonly stagedFilesOpen = signal(true);
  protected readonly workingTreeFileListHeights = {
    unstaged: signal(this.readWorkingTreeFileListHeight('unstaged')),
    staged: signal(this.readWorkingTreeFileListHeight('staged')),
  };
  protected readonly changedFilesOpen = signal(true);
  protected readonly branchFilter = signal('');
  protected readonly commitFilter = signal('');
  protected readonly commitSearchExpanded = signal(false);
  protected readonly commitSearchIndex = signal(0);
  private readonly graphScrollTop = signal(0);
  protected readonly graphCanScrollLeft = signal(false);
  protected readonly graphCanScrollRight = signal(false);
  // Width of the commit list's vertical scrollbar, mirrored on the header so columns stay aligned.
  protected readonly graphScrollbarGutter = signal(0);
  protected readonly showBackToHead = computed(() =>
    this.graphScrollTop() > WORKTREE_ROW_HEIGHT + COMMIT_ROW_HEIGHT * 2,
  );
  private readonly graphViewportHeight = signal(640);
  private responsiveSidebarMode = typeof window !== 'undefined'
    && window.innerWidth <= RESPONSIVE_SIDEBAR_BREAKPOINT;
  private wideViewportSidebarVisible = this.readUiPreference('left-panel', true);
  protected readonly sidebarVisible = signal(
    this.responsiveSidebarMode ? false : this.wideViewportSidebarVisible,
  );
  protected readonly detailsVisible = signal(this.readUiPreference('commit-panel', true));
  protected readonly fullWidthInspectorMode = signal(
    typeof window !== 'undefined' && window.innerWidth <= FULL_WIDTH_INSPECTOR_BREAKPOINT,
  );
  protected readonly historyInert = computed(() =>
    this.fullWidthInspectorMode() && this.detailsVisible(),
  );
  protected readonly stashesOpen = signal(this.readUiPreference('section-stashes-open', false));
  protected readonly submodulesOpen = signal(this.readUiPreference('section-submodules-open', true));
  protected readonly referencePaneVisibility = signal<Record<ReferencePane, boolean>>({
    worktrees: this.readUiPreference('pane-worktrees', true),
    remote: this.readUiPreference('pane-remote', true),
    pullRequests: this.readUiPreference('pane-pull-requests', true),
    tags: this.readUiPreference('pane-tags', true),
    stashes: this.readUiPreference('pane-stashes', true),
    submodules: this.readUiPreference('pane-submodules', true),
  });
  protected readonly tagsOpen = signal(this.readUiPreference('section-tags-open', false));
  protected readonly pullRequestsOpen = signal(this.readUiPreference('section-pull-requests-open', false));
  protected readonly worktreesOpen = signal(this.readUiPreference('section-worktrees-open', true));
  protected readonly localBranchesOpen = signal(this.readUiPreference('section-local-open', true));
  protected readonly remoteBranchesOpen = signal(this.readUiPreference('section-remote-open', true));
  protected readonly remoteLocationIcons = signal<Record<string, RemoteLocationIcon>>({});
  protected readonly collapsedRemoteLocations = signal<string[]>([]);
  protected readonly remoteIconOptions = REMOTE_LOCATION_ICONS;
  protected readonly maximizedReferenceSection = signal<ReferenceSection | null>(null);
  protected readonly referenceSectionHeights = signal<Record<ReferenceSection, number | null>>({
    worktrees: this.readReferenceSectionHeight('worktrees'),
    local: this.readReferenceSectionHeight('local'),
    remote: this.readReferenceSectionHeight('remote'),
    tags: this.readReferenceSectionHeight('tags'),
    stashes: this.readReferenceSectionHeight('stashes'),
    submodules: this.readReferenceSectionHeight('submodules'),
  });
  private readonly referenceSectionMeasuredHeights = signal<Record<ReferenceSection, number>>({
    worktrees: REFERENCE_SECTION_FALLBACK_HEIGHT,
    local: REFERENCE_SECTION_FALLBACK_HEIGHT,
    remote: REFERENCE_SECTION_FALLBACK_HEIGHT,
    tags: REFERENCE_SECTION_FALLBACK_HEIGHT,
    stashes: REFERENCE_SECTION_FALLBACK_HEIGHT,
    submodules: REFERENCE_SECTION_FALLBACK_HEIGHT,
  });
  protected readonly hoveredReferenceOid = signal<string | null>(null);
  protected readonly tagPreview = signal<TagPreviewPopover | null>(null);
  protected readonly collapsedReferenceStackOid = signal<string | null>(null);
  protected readonly expandedReferenceStackOid = signal<string | null>(null);
  private readonly pinnedReferenceStackOid = signal<string | null>(null);
  protected readonly upwardReferenceStackOid = signal<string | null>(null);
  protected readonly detailReferenceStackOpen = signal(false);
  protected readonly detailReferenceStackCollapsed = signal(false);
  protected readonly hoveredCommitOid = signal<string | null>(null);
  protected readonly hiddenBranches = signal<string[]>([]);
  protected readonly soloBranches = signal<string[]>([]);
  private readonly hiddenBranchSet = computed(() => new Set(this.hiddenBranches()));
  private readonly soloBranchSet = computed(() => new Set(this.soloBranches()));
  private readonly remoteBranchNamesByLocation = computed(() => {
    const groups = new Map<string, string[]>();
    for (const branch of this.git.repository()?.branches ?? []) {
      if (!branch.remote) continue;
      const location = this.remoteLocationName(branch.name);
      const names = groups.get(location);
      if (names) names.push(branch.name);
      else groups.set(location, [branch.name]);
    }
    return groups;
  });
  protected readonly smartBranchVisibility = signal(false);
  protected readonly hiddenStashOids = signal<string[]>([]);
  protected readonly pinnedBranch = signal<string | null>(null);
  protected readonly draggedTabId = signal<string | null>(null);
  protected readonly tabDropTarget = signal<{ repoId: string; edge: 'before' | 'after' } | null>(null);
  protected readonly tabOrderAnnouncement = signal('');
  protected readonly draggedBranch = signal<string | null>(null);
  protected readonly draggedCommit = signal<{ oid: string; label: string } | null>(null);
  protected readonly branchDropTarget = signal<string | null>(null);
  protected readonly branchDropMenu = signal<BranchDropState | null>(null);
  protected readonly interactiveRebase = signal<InteractiveRebaseState | null>(null);
  protected readonly mergeRebaseReview = signal<MergeRebaseDialogState | null>(null);
  protected readonly selectedRebaseOid = signal<string | null>(null);
  protected readonly draggedRebaseOid = signal<string | null>(null);
  protected readonly sidebarWidth = signal(this.readWidth('sidebar'));
  protected readonly detailsWidth = signal(this.readWidth('details'));
  private readonly manuallySizedPanels = signal({
    sidebar: this.hasStoredPanelWidth('sidebar'),
    details: this.hasStoredPanelWidth('details'),
  });
  private readonly viewportWidth = signal(window.innerWidth);
  private readonly renderedPanelWidths = computed(() => {
    const budget = Math.max(0, this.viewportWidth() - 420);
    const compact = this.viewportWidth() <= 1100;
    const requestedSidebar = compact && !this.manuallySizedPanels().sidebar ? 205 : this.sidebarWidth();
    const requestedDetails = compact && !this.manuallySizedPanels().details ? 310 : this.detailsWidth();
    const details = this.detailsVisible()
      ? Math.min(requestedDetails, Math.max(PANEL_WIDTH_LIMITS.details.minimum,
        budget - (this.sidebarVisible() ? PANEL_WIDTH_LIMITS.sidebar.minimum : 0)))
      : 0;
    const sidebar = this.sidebarVisible()
      ? Math.min(requestedSidebar, Math.max(PANEL_WIDTH_LIMITS.sidebar.minimum, budget - details))
      : 0;
    return { sidebar, details };
  });
  protected readonly gridColumns = computed(() => {
    const center = 'minmax(420px, 1fr)';
    if (this.sidebarVisible() && this.detailsVisible()) {
      return `${this.panelWidth('sidebar')}px ${center} ${this.panelWidth('details')}px`;
    }
    if (this.sidebarVisible()) return `${this.panelWidth('sidebar')}px ${center}`;
    if (this.detailsVisible()) return `${center} ${this.panelWidth('details')}px`;
    return center;
  });
  protected readonly graphGridColumns = computed(() => {
    const columns = this.graphColumnOrder()
      .filter((column) => this.isGraphColumnVisible(column))
      .map((column) => {
        if (column === 'message' && !this.messageColumnManuallyResized()) {
          return `minmax(${this.messageColumnWidth()}px, 1fr)`;
        }
        return `${this.columnWidthSignal(column)()}px`;
      });
    return columns.join(' ');
  });
  // A pinned trailing column spans the trailing actions lane, so it reaches the panel's right edge
  // with the column settings button (header) and row actions (rows) inside its right end.
  protected readonly graphHeaderGridColumns = computed(() => this.trailingGraphColumn()
    ? `${this.graphGridColumns()} 26px`
    : this.graphGridColumns());
  protected readonly commitRowGridColumns = computed(() => `${this.graphGridColumns()} 26px`);
  // Rows span every column track (plus 6px left and 24px right padding and the 26px actions track) so
  // hover and selection backgrounds cover columns scrolled past the viewport edge.
  protected readonly commitRowWidth = computed(() => 30 + 26 + this.graphColumnOrder()
    .filter((column) => this.isGraphColumnVisible(column))
    .reduce((total, column) => total + this.columnWidthSignal(column)(), 0));
  // Whichever column is last spans the actions lane, so it reaches the panel's right edge with the
  // settings button (header) and row actions (rows) inside its right end.
  protected readonly trailingGraphColumn = computed<GraphColumn | null>(() =>
    this.graphColumnOrder().filter((column) => this.isGraphColumnVisible(column)).at(-1) ?? null);
  private readonly graphMetadataVisibilityEffect = effect(() => {
    const viewportWidth = this.graphViewportWidth();
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId || viewportWidth <= 0) return;
    untracked(() => this.syncDefaultGraphMetadataColumns());
  });
  private readonly visibleGraphColumns = computed(() =>
    this.graphColumnOrder().filter((column) => this.isGraphColumnVisible(column)));
  protected readonly hiddenGraphColumnCount = computed(() =>
    DEFAULT_GRAPH_COLUMNS.length - this.visibleGraphColumns().length);
  /** Width the column tracks can use without scrolling: the list minus side padding (6px + 24px) and the 26px actions lane. */
  private readonly graphColumnsAvailableWidth = computed(() =>
    this.graphViewportWidth() ? this.graphViewportWidth() - 30 - 26 : 0);
  /** App-wide: when off, the columns always fit the history panel and never scroll horizontally. */
  protected readonly graphHorizontalScroll = signal(readStoredBoolean(GRAPH_HORIZONTAL_SCROLL_KEY, true));
  private readonly graphColumnFitEffect = effect(() => {
    if (this.graphHorizontalScroll()) return;
    const available = this.graphColumnsAvailableWidth();
    if (available <= 0) return;
    const visible = this.visibleGraphColumns();
    const widths = Object.fromEntries(visible.map((column) => [column, this.columnWidthSignal(column)()])) as Record<GraphColumn, number>;
    let excess = visible.reduce((total, column) => total + widths[column], 0) - available;
    if (excess <= 0.5) return;
    untracked(() => {
      // Commit Message gives way first, then every other column in proportion to its spare width.
      const order: GraphColumn[][] = [visible.filter((column) => column === 'message'), visible.filter((column) => column !== 'message')];
      for (const group of order) {
        const spare = group.reduce((total, column) => total + Math.max(0, widths[column] - this.graphColumnWidthLimits(column)[0]), 0);
        if (spare <= 0 || excess <= 0.5) continue;
        const ratio = Math.min(1, excess / spare);
        for (const column of group) {
          const cut = Math.max(0, widths[column] - this.graphColumnWidthLimits(column)[0]) * ratio;
          if (cut <= 0) continue;
          this.columnWidthSignal(column).set(Math.floor((widths[column] - cut) * 100) / 100);
        }
        excess -= Math.min(excess, spare);
      }
      if (visible.includes('message') && !this.messageColumnManuallyResized()) this.messageColumnManuallyResized.set(true);
    });
  });
  protected readonly compactAuthorColumn = computed(() => isCompactAuthorColumn(this.renderedGraphColumnWidth('author')));
  protected readonly graphColumnIcons = GRAPH_COLUMN_ICONS;
  protected readonly graphColumnLabels = GRAPH_COLUMN_LABELS;
  private readonly graphHeadingTitleWidths = signal<Partial<Record<GraphColumn, number>>>({});
  private readonly graphCellFontFamily = signal<string | null>(null);
  // Date / Time may never be narrower than its widest visible date or time line (plus 7px side padding).
  private dateLabelWidths = new Map<string, number>();
  private dateLabelWidthFont = '';
  private dateMeasureContext: CanvasRenderingContext2D | null = null;
  protected readonly dateColumnContentWidth = computed(() => {
    const family = this.graphCellFontFamily();
    const context = family
      ? this.dateMeasureContext ??= document.createElement('canvas').getContext('2d')
      : null;
    if (!context) return GRAPH_DATE_COLUMN_FLOOR;
    context.font = `400 12px ${family}`;
    // Each distinct label is measured once; later history pages only measure labels not seen before.
    if (this.dateLabelWidthFont !== context.font) {
      this.dateLabelWidths = new Map();
      this.dateLabelWidthFont = context.font;
    }
    const widths = this.dateLabelWidths;
    const measure = (label: string) => {
      let width = widths.get(label);
      if (width === undefined) {
        width = context.measureText(label).width;
        widths.set(label, width);
      }
      return width;
    };
    const dates = this.graphCommitDates();
    const commits = this.graphCommits();
    const progress = this.dateWidthProgress;
    const reusable = progress.dates === dates && progress.font === context.font;
    const start = reusable ? appendedFrom(progress.commits, commits) : 0;
    let widest = start ? progress.widest : measure('Now');
    for (let index = start; index < commits.length; index += 1) {
      const date = dates.get(commits[index].oid);
      if (date) widest = Math.max(widest, measure(date.primary), measure(date.secondary));
    }
    this.dateWidthProgress = { dates, font: context.font, commits, widest };
    return Math.max(GRAPH_DATE_COLUMN_FLOOR, Math.ceil(widest) + 16);
  });
  private dateWidthProgress: {
    dates: ReadonlyMap<string, CommitDateDisplay> | null;
    font: string;
    commits: readonly CommitSummary[] | null;
    widest: number;
  } = { dates: null, font: '', commits: null, widest: 0 };
  private readonly dateColumnFitEffect = effect(() => {
    const minimum = this.dateColumnContentWidth();
    if (this.dateColumnWidth() < minimum) this.dateColumnWidth.set(minimum);
  });
  protected readonly repositoryTabGroups = computed<RepositoryTabGroup[]>(() => {
    const repositories = this.git.repositories();
    if (!this.showWorktreeTabGroups()) {
      return repositories.map((repository) => ({
        key: repository.id,
        label: this.git.repositoryLabel(repository),
        tabs: [repository],
        grouped: false,
      }));
    }
    const groups: RepositorySnapshot[][] = [];
    for (const repository of repositories) {
      const paths = new Set(repository.worktrees.map((worktree) => worktree.path));
      const group = groups.find((candidates) => candidates.some((candidate) =>
        candidate.worktrees.some((worktree) => paths.has(worktree.path)),
      ));
      if (group) group.push(repository);
      else groups.push([repository]);
    }
    return groups.map((tabs) => ({
      key: tabs.map((tab) => tab.id).sort().join(':'),
      label: this.git.pathLabel(tabs[0].worktrees[0]?.path ?? tabs[0].path),
      tabs,
      grouped: tabs.length > 1,
    }));
  });

  protected repositoryTabCompactLabel(repository: RepositorySnapshot): string {
    if (repository.status.branch) return repository.status.branch;
    return repository.headOid ? `Detached ${shortLabel(repository.headOid)}` : this.git.repositoryLabel(repository);
  }

  private resizeTarget: 'sidebar' | 'details' | null = null;
  private resizePanelChanged = false;
  private readonly resizePointer = new ResizePointer();
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private columnResizeTarget: GraphColumn | null = null;
  private columnResizeMoved = false;
  private suppressColumnResizeClick = false;
  private columnResizeClickSuppressionUntil = 0;
  // Column widths when a resize began; with horizontal scrolling off, widening a column takes space
  // from these snapshots so dragging back returns it to the columns it came from.
  private columnResizeStartWidths: Partial<Record<GraphColumn, number>> = {};
  private referenceResizeTarget: ReferenceSection | null = null;
  private referenceResizeChanged = false;
  private referenceResizeStartY = 0;
  private referenceResizeStartHeight = 0;
  private workingTreeFileListResizeTarget: WorkingTreeFileListSection | null = null;
  private workingTreeFileListResizeStartY = 0;
  private workingTreeFileListResizeStartHeight = 0;
  private referenceOpenSnapshot: Record<ReferenceSection, boolean> | null = null;
  private readonly commitDrafts = new Map<string, CommitDraft>();
  private draftRepositoryId: string | null = null;
  private commitListElement: HTMLElement | null = null;
  private commitListResizeObserver: ResizeObserver | null = null;
  private readonly graphHeaderSyncEffect = effect(() => {
    this.graphGridColumns();
    queueMicrotask(() => this.syncGraphHeader());
  });
  private graphScrollFrame: number | null = null;
  private graphHeaderScrollLeft = -1;
  private pendingGraphScrollElement: HTMLElement | null = null;
  private graphWheelFrame: number | null = null;
  private pendingGraphWheelTop: number | null = null;
  private pendingGraphWheelLeft = 0;
  private graphHoverResumeTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly handleGraphWheel = (event: WheelEvent): void => {
    const list = this.commitListElement;
    if (!list || !event.cancelable || event.defaultPrevented || event.ctrlKey || event.shiftKey || !event.deltaY) return;
    if (event.target instanceof Element && event.target.closest('.reference-stack-popover')) return;
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? COMMIT_ROW_HEIGHT
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? list.clientHeight : 1;
    const top = Math.max(0, Math.min(
      (this.pendingGraphWheelTop ?? list.scrollTop) + event.deltaY * scale,
      list.scrollHeight - list.clientHeight,
    ));
    if (this.pendingGraphWheelTop === null && top === list.scrollTop) return;
    // Native asynchronous scrolling can outrun the virtual window. Keep the old painted rows
    // visible until the destination rows and scroll offset can be committed in the same frame.
    event.preventDefault();
    this.dismissGraphReferenceStack();
    this.deferGraphHover();
    this.pendingGraphWheelTop = top;
    this.pendingGraphWheelLeft += event.deltaX * scale;
    if (this.graphWheelFrame !== null) return;
    this.graphWheelFrame = requestAnimationFrame(() => {
      this.graphWheelFrame = null;
      const target = this.pendingGraphWheelTop;
      const left = this.pendingGraphWheelLeft;
      this.pendingGraphWheelTop = null;
      this.pendingGraphWheelLeft = 0;
      if (target === null || this.commitListElement !== list) return;
      this.graphScrollTop.set(target);
      this.graphViewport()?.render();
      list.scrollTop = target;
      if (left) list.scrollLeft += left;
      this.updateGraphViewport(list);
      this.prefetchOlderHistory(list);
    });
  };

  private detachGraphWheel(): void {
    this.commitListElement?.removeEventListener('wheel', this.handleGraphWheel);
    if (this.graphWheelFrame !== null) cancelAnimationFrame(this.graphWheelFrame);
    this.graphWheelFrame = null;
    this.pendingGraphWheelTop = null;
    this.pendingGraphWheelLeft = 0;
    if (this.graphHoverResumeTimer !== null) clearTimeout(this.graphHoverResumeTimer);
    this.graphHoverResumeTimer = null;
  }

  private deferGraphHover(): void {
    if (this.graphHoverResumeTimer !== null) clearTimeout(this.graphHoverResumeTimer);
    this.graphHoverResumeTimer = setTimeout(() => {
      this.graphHoverResumeTimer = null;
      if (this.graphWheelFrame !== null || this.graphScrollFrame !== null) {
        this.deferGraphHover();
        return;
      }
      const row = this.commitListElement?.querySelector<HTMLElement>('.commit-row[data-commit-oid]:hover');
      const oid = row?.dataset['commitOid'] ?? null;
      this.hoveredCommitOid.set(oid);
      const stack = row?.querySelector<HTMLElement>('.commit-ref-stack.multi-ref:hover');
      const pinnedOid = this.pinnedReferenceStackOid();
      if (stack && oid && (!pinnedOid || pinnedOid === oid) && this.collapsedReferenceStackOid() !== oid) {
        this.cancelReferenceStackClose();
        this.expandedReferenceStackOid.set(oid);
        this.positionReferenceStack(oid, stack);
      }
    }, 120);
  }
  private activityLogOpener: HTMLElement | null = null;
  private commandPaletteOpener: HTMLElement | null = null;
  private keyboardShortcutsOpener: HTMLElement | null = null;
  private preferencesOpener: HTMLElement | null = null;
  private diffViewerOpener: HTMLElement | null = null;
  private diffViewerGeneration = 0;
  private diffScrollRequest = 0;
  private stopDiffViewportTracking: (() => void) | null = null;
  private repositoryDialogOpener: HTMLElement | null = null;
  private workspaceDialogOpener: HTMLElement | null = null;
  private worktreeDialogOpener: HTMLElement | null = null;
  private submoduleDialogOpener: HTMLElement | null = null;
  private remoteDialogOpener: HTMLElement | null = null;
  private secondaryConfirmationOpener: HTMLElement | null = null;
  protected readonly preferencesDialogView = computed(() => ({
    preferencesSection: this.preferencesSection,
    appTheme: this.appTheme,
    setAppTheme: this.setAppTheme.bind(this),
    handleAppThemeKeydown: this.handleAppThemeKeydown.bind(this),
    showToolbarLabels: this.showToolbarLabels,
    showWorktreeTabGroups: this.showWorktreeTabGroups,
    sidebarVisible: this.sidebarVisible,
    detailsVisible: this.detailsVisible,
    setUiPreference: this.setUiPreference.bind(this),
    setPanelVisibility: this.setPanelVisibility.bind(this),
    graphDateFormat: this.graphDateFormat,
    setGraphDateFormat: this.setGraphDateFormat.bind(this),
    authorMarkerStyle: this.authorMarkerStyle,
    setAuthorMarkerStyle: this.setAuthorMarkerStyle.bind(this),
    highlightRelatedCommits: this.highlightRelatedCommits,
    showGraphScrollMarkers: this.showGraphScrollMarkers,
    setGraphScrollMarkers: this.setGraphScrollMarkers.bind(this),
    smartBranchVisibility: this.smartBranchVisibility,
    setSmartBranchVisibility: this.setSmartBranchVisibility.bind(this),
    showBranchColumn: this.showBranchColumn,
    showGraphColumn: this.showGraphColumn,
    showMessageColumn: this.showMessageColumn,
    showAuthorColumn: this.showAuthorColumn,
    showDateColumn: this.showDateColumn,
    showShaColumn: this.showShaColumn,
    setGraphColumn: this.setGraphColumn.bind(this),
    workingTreeViewMode: this.workingTreeViewMode,
    setWorkingTreeViewMode: this.setWorkingTreeViewMode.bind(this),
    autoFetchIntervalMinutes: this.autoFetchIntervalMinutes,
    setAutoFetchInterval: this.setAutoFetchInterval.bind(this),
    sparseCheckoutPaths: this.sparseCheckoutPaths,
    sparseCheckoutIndex: this.sparseCheckoutIndex,
    requestSparseCheckoutUpdate: this.requestSparseCheckoutUpdate.bind(this),
    reapplySparseCheckout: this.reapplySparseCheckout.bind(this),
    requestSparseCheckoutDisable: this.requestSparseCheckoutDisable.bind(this),
    initializeLfs: this.initializeLfs.bind(this),
    lfsPattern: this.lfsPattern,
    lfsPatternLockable: this.lfsPatternLockable,
    addLfsPattern: this.addLfsPattern.bind(this),
    openLfsTracking: this.openLfsTracking.bind(this),
    diffFontSize: this.diffFontSize,
    diffTabSize: this.diffTabSize,
    diffWordWrap: this.diffWordWrap,
    setDiffPreference: this.setDiffPreference.bind(this),
    terminalFontFamily: this.terminalFontFamily,
    terminalFontSize: this.terminalFontSize,
    terminalLineHeight: this.terminalLineHeight,
    terminalCursorStyle: this.terminalCursorStyle,
    setTerminalPreference: this.setTerminalPreference.bind(this),
    resetUiConfirmation: this.resetUiConfirmation,
    restoreInterfaceDefaults: this.restoreInterfaceDefaults.bind(this),
    handlePreferencesTabKeydown: this.handlePreferencesTabKeydown.bind(this),
    handleModalFocusKey: this.handleModalFocusKey.bind(this),
  }));
  private autoFetchTimer: ReturnType<typeof setTimeout> | null = null;
  private liveStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private trackedFileSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private referenceHighlightTimer: ReturnType<typeof setTimeout> | null = null;
  private referenceStackCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private detailReferenceStackCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private tagPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  private toolbarMenuReturnFocus: HTMLElement | null = null;
  private readonly repositoryRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private repositoryChangeUnlisten: UnlistenFn | null = null;
  private rebaseRequest = 0;
  private nativeWindowTitle = '';
  private zoomApplication = 0;

  constructor() {
    afterRenderEffect(() => this.fileToolsLoaderClose()?.nativeElement.focus());
    effect(() => {
      const request = this.fileContentDialog();
      if (request && !request.editing() && request.selection.repoId !== this.git.activeRepositoryId()) {
        untracked(() => this.fileContentDialog.set(null));
      }
    });
    effect(() => {
      const unstaged = this.unstagedFilesList()?.nativeElement;
      const staged = this.stagedFilesList()?.nativeElement;
      untracked(() => {
        this.workingTreeFilesScrollTop.unstaged.set(unstaged?.scrollTop ?? 0);
        this.workingTreeFilesScrollTop.staged.set(staged?.scrollTop ?? 0);
      });
    });
    effect(() => {
      this.git.activeRepositoryId();
      this.activeDiff();
      this.diffViewerOpen();
      this.diffInsightMode();
      this.diffWordWrap();
      this.stopDiffViewportTracking?.();
    });
    effect(() => {
      const title = this.repositoryWindowTitle(this.git.repository());
      const systemInfo = this.git.systemInfo();
      const browserPreview = this.git.browserPreview();
      if (document.title !== title) document.title = title;
      if (!systemInfo || browserPreview || this.nativeWindowTitle === title) return;
      this.nativeWindowTitle = title;
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        if (this.nativeWindowTitle === title) return getCurrentWindow().setTitle(title);
        return undefined;
      }).catch(() => {
        if (this.nativeWindowTitle === title) this.nativeWindowTitle = '';
      });
    });
    effect(() => {
      this.git.activeRepositoryId();
      untracked(() => {
        this.selectedDiscardPaths.set([]);
        this.discardSelectionMode.set(false);
        this.savedDiscards.set(null);
        this.referenceAction.set(null);
        this.stashDialog.set(null);
        this.rebaseRequest++;
        this.interactiveRebase.set(null);
        this.mergeRebaseReview.set(null);
        this.mergePreviewRequest.set(null);
        this.branchWorkflowRequest.set(null);
        this.selectedRebaseOid.set(null);
        this.pendingHistoryAction.set(null);
      });
    });
    this.applyAppTheme(this.appTheme());
    afterNextRender(() => {
      this.measureGraphHeadingTitles();
      this.updateRepositoryTabOverflow();
      void document.fonts?.ready.then(() => this.measureGraphHeadingTitles());
    });
    effect(() => {
      this.repositoryTabGroups();
      queueMicrotask(() => requestAnimationFrame(() => this.updateRepositoryTabOverflow()));
    });
    effect(() => {
      const repositoryId = this.git.activeRepositoryId();
      const interval = this.autoFetchIntervalMinutes();
      const browserPreview = this.git.browserPreview();
      this.cancelAutoFetchTimer();
      const paused = repositoryId ? this.git.repositoryLinkPolicies()[repositoryId]?.autoFetchPaused : false;
      if (!repositoryId || interval === 0 || browserPreview || paused || this.git.incomingRepositoryLinksPending()) return;
      queueMicrotask(() => this.scheduleAutoFetch(interval * 60_000));
    });
    effect(() => {
      const repositoryId = this.git.activeRepositoryId();
      const browserPreview = this.git.browserPreview();
      this.cancelLiveStatusRefresh();
      if (!repositoryId || browserPreview) return;
      queueMicrotask(() => this.scheduleLiveStatusRefresh(1_000));
    });
    effect(() => {
      this.git.activeRepositoryId();
      untracked(() => {
        this.finishResize();
        this.restoreBranchCreatorSectionHeight();
        this.branchCreatorOpen.set(false);
        this.branchName.set('');
        this.branchCreationError.set(null);
        this.branchCreatorReturnFocus = null;
        this.closeToolbarCheckoutMenu();
        this.dismissGraphActionMenu();
      });
    });
    effect(() => {
      this.git.activeRepositoryId();
      this.selectedCommit();
      this.cancelDetailReferenceStackClose();
      this.detailReferenceStackOpen.set(false);
      this.detailReferenceStackCollapsed.set(false);
    });
    effect(() => {
      const open = this.commandPaletteOpen();
      const repositoryId = this.git.activeRepositoryId();
      const scope = this.commandPaletteScope();
      const query = this.commandQuery().trim();
      if (this.trackedFileSearchTimer) clearTimeout(this.trackedFileSearchTimer);
      this.git.clearTrackedFileSearch();
      if (!open || !repositoryId || scope === 'branches' || query.length < 2) return;
      this.trackedFileSearchTimer = setTimeout(() => {
        this.trackedFileSearchTimer = null;
        void this.git.searchTrackedFiles(query);
      }, 180);
    });
  }

  private repositoryWindowTitle(repository: RepositorySnapshot | null): string {
    if (!repository) return 'Git Khronos';
    const repositoryLabel = this.git.repositoryLabel(repository);
    const location = repository.status.branch
      ?? (repository.headOid ? `Detached ${shortLabel(repository.headOid)}` : 'No commits');
    const changes = repository.status.entryCount
      ? ` • ${repository.status.entryCount} ${repository.status.entryCount === 1 ? 'change' : 'changes'}`
      : '';
    return `${repositoryLabel} — ${location}${changes} — Git Khronos`;
  }

  protected readonly selectedCommitData = computed(() => {
    const selected = this.selectedCommit();
    if (!selected) return this.graphCommits()[0] ?? null;
    return this.graphCommitByOid().get(selected)
      ?? (this.externalHistoryCommit()?.oid === selected ? this.externalHistoryCommit() : null);
  });
  protected readonly selectedCommitCopyStatus = computed<'idle' | 'copied' | 'failed'>(() => {
    const feedback = this.commitOidCopyFeedback();
    return feedback && feedback.oid === this.selectedCommitData()?.oid ? feedback.status : 'idle';
  });
  protected readonly selectedStash = computed(() => {
    const oid = this.selectedCommit();
    return this.git.repository()?.stashes.find((stash) => stash.oid === oid) ?? null;
  });
  protected readonly selectedCommitChildren = computed(() => {
    const repository = this.git.repository();
    const selected = this.selectedCommitData();
    if (!repository || !selected) return [];
    const stashOids = new Set(repository.stashes.map((stash) => stash.oid));
    return (this.graphCommitChildrenByOid().get(selected.oid) ?? [])
      .filter((commit) => !stashOids.has(commit.oid));
  });

  protected relatedCommitSubject(oid: string): string {
    return this.graphCommitByOid().get(oid)?.subject
      ?? (this.externalHistoryCommit()?.oid === oid ? this.externalHistoryCommit()?.subject : '')
      ?? '';
  }

  protected readonly selectedCommitNavigation = computed(() => {
    const selected = this.selectedCommit();
    const rows = this.visibleGraphRows();
    const index = selected ? rows.findIndex((row) => row.commit.oid === selected) : -1;
    return {
      newer: index > 0 ? rows[index - 1].commit : null,
      older: index >= 0 && index < rows.length - 1 ? rows[index + 1].commit : null,
      position: index >= 0 ? index + 1 : null,
      total: rows.length,
    };
  });
  protected readonly visibleListWorktrees = computed(() => {
    const filter = this.branchFilter().trim().toLowerCase();
    return (this.git.repository()?.worktrees ?? []).filter((worktree) =>
      !filter
      || worktree.branch?.toLowerCase().includes(filter)
      || worktree.path.toLowerCase().includes(filter),
    );
  });
  protected readonly visibleSubmodules = computed(() => {
    const filter = this.branchFilter().trim().toLowerCase();
    return (this.git.repository()?.submodules ?? []).filter((submodule) =>
      !filter
      || submodule.name.toLowerCase().includes(filter)
      || submodule.path.toLowerCase().includes(filter)
      || submodule.url.toLowerCase().includes(filter),
    );
  });

  protected readonly selectedCommitRows = computed(() => {
    const rows = this.visibleGraphRowByOid();
    return this.selectedCommits()
      .map((oid) => rows.get(oid))
      .filter((row): row is GraphRow => !!row);
  });

  protected readonly selectionIsContiguous = computed(() => {
    const selected = this.selectedCommits();
    if (selected.length <= 2) return true;
    const rowIndices = this.visibleGraphRowIndexByOid();
    const indices = selected
      .map((oid) => rowIndices.get(oid))
      .filter((index): index is number => index !== undefined)
      .sort((left, right) => left - right);
    return indices.length === selected.length && indices.at(-1)! - indices[0] + 1 === indices.length;
  });

  protected readonly selectedCommitBody = computed(() => {
    const message = this.git.commitDetails()?.message;
    const body = message
      ? commitMessageBody(message)
      : this.selectedCommitData()?.description ?? '';
    return parseCoAuthors(body).body;
  });
  protected readonly selectedCommitCoAuthors = computed(() => {
    const message = this.git.commitDetails()?.message;
    const body = message
      ? commitMessageBody(message)
      : this.selectedCommitData()?.description ?? '';
    return parseCoAuthors(body).authors;
  });

  protected readonly activeDiff = computed(() => this.changesOpen()
    ? this.git.workingTreeFileDiff()
    : this.git.comparisonFileDiff() ?? this.git.commitFileDiff());

  private readonly fileActionView = computed(() => [
    this.git.activeRepositoryId(), this.git.commitDetails(), this.git.commitComparison(),
    this.activeDiff(), this.diffViewerOpen(), this.changesOpen(),
  ]);

  private workingMediaSelection(path: string, staged: boolean): FileMediaSelection | null {
    const repoId = this.git.activeRepositoryId();
    return repoId ? { repoId, request: { context: { kind: 'workingTree', staged }, path, previousPath: null } } : null;
  }

  private commitMediaSelection(file: Pick<CommitFile, 'path' | 'previousPath'>, oid: string, source: 'commit' | 'comparison'): FileMediaSelection | null {
    const repoId = this.git.activeRepositoryId();
    if (!repoId) return null;
    const comparison = source === 'comparison' ? this.git.commitComparison() : null;
    if (source === 'comparison' && !comparison || source === 'commit' && !oid) return null;
    const context: FileComparisonContext = comparison
      ? comparison.workingTree ? { kind: 'revisionWorktree', baseOid: comparison.baseOid }
        : { kind: 'revisions', baseOid: comparison.baseOid, targetOid: comparison.targetOid }
      : this.git.inspectedStashReference() && this.git.commitDetails()?.oid === oid
        ? { kind: 'stash', oid, layer: 'combined' } : { kind: 'commit', oid };
    return { repoId, request: { context, path: file.path, previousPath: file.previousPath } };
  }

  protected readonly activeMediaSelection = computed<FileMediaSelection | null>(() => {
    const diff = this.activeDiff();
    if (!diff) return null;
    if (this.changesOpen()) {
      const working = this.git.workingTreeFileDiff();
      return working ? this.workingMediaSelection(working.path, working.staged) : null;
    }
    const comparison = this.git.commitComparison();
    const details = this.git.commitDetails();
    if (!comparison && !details) return null;
    const file = (comparison?.files ?? details?.files)?.find(file => file.path === diff.path);
    return this.commitMediaSelection({ path: diff.path, previousPath: file?.previousPath ?? null },
      comparison ? comparison.targetOid : details!.oid, comparison ? 'comparison' : 'commit');
  });

  protected readonly activeWorkingTreeDiff = computed(() => this.changesOpen()
    ? this.git.workingTreeFileDiff()
    : null);

  protected readonly activeDiffLabel = computed(() => {
    const workingTree = this.git.workingTreeFileDiff();
    if (this.changesOpen() && workingTree) return workingTree.staged ? 'Staged Changes' : 'Unstaged Changes';
    const comparison = this.git.commitComparison();
    if (comparison) return `${shortLabel(comparison.baseOid)} → ${comparison.workingTree ? 'WIP' : shortLabel(comparison.targetOid)}`;
    const details = this.git.commitDetails();
    return details ? shortLabel(details.oid) : 'File Diff';
  });

  protected readonly activeDiffCommitContext = computed(() => {
    if (this.changesOpen() || this.git.commitComparison()) return null;
    const details = this.git.commitDetails();
    const selected = this.selectedCommitData();
    if (!details || details.oid !== selected?.oid) return null;
    return selected.subject || '(no commit message)';
  });

  protected readonly activeDiffRevision = computed(() => {
    const diff = this.activeDiff();
    return diff && 'oid' in diff ? diff.oid : this.git.repository()?.headOid ?? null;
  });

  protected readonly canInspectActiveFile = computed(() => {
    const diff = this.activeDiff();
    return !!diff && !!this.activeDiffRevision() && !(this.changesOpen() && this.isUntrackedPath(diff.path));
  });

  protected readonly blameSyntaxTokens = (text: string, path: string) => tokenizeDiffLine([{ text, changed: false }], path);

  protected readonly diffLines = computed<DiffLine[]>(() => {
    const diff = this.activeDiff();
    const patch = diff?.patch;
    if (!patch) return [];
    const patchLines = patch.split('\n');
    const decorate = shouldDecorateDiff(patch.length, patchLines.length);
    let oldLine = 0;
    let newLine = 0;
    let hunkIndex = 0;
    let currentHunkIndex: number | null = null;
    let changeIndex = 0;
    const lines = patchLines.map((text): DiffLine => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        currentHunkIndex = hunkIndex++;
        changeIndex = 0;
        return { text, kind: 'hunk', oldLine: null, newLine: null, hunkIndex: currentHunkIndex, changeIndices: [], segments: [], tokens: [] };
      }
      if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') || text.startsWith('index ')) {
        return { text, kind: 'header', oldLine: null, newLine: null, hunkIndex: null, changeIndices: [], segments: [], tokens: [] };
      }
      if (text.startsWith('+')) {
        return { text, kind: 'addition', oldLine: null, newLine: newLine++, hunkIndex: currentHunkIndex, changeIndices: [changeIndex++], segments: [], tokens: [] };
      }
      if (text.startsWith('-')) {
        return { text, kind: 'deletion', oldLine: oldLine++, newLine: null, hunkIndex: currentHunkIndex, changeIndices: [changeIndex++], segments: [], tokens: [] };
      }
      const line: DiffLine = { text, kind: 'context', oldLine, newLine, hunkIndex: currentHunkIndex, changeIndices: [], segments: [], tokens: [] };
      oldLine += 1;
      newLine += 1;
      return line;
    });

    let index = 0;
    while (index < lines.length) {
      if (lines[index].kind !== 'deletion') {
        index += 1;
        continue;
      }
      const deletions: DiffLine[] = [];
      const additions: DiffLine[] = [];
      while (lines[index]?.kind === 'deletion') deletions.push(lines[index++]);
      while (lines[index]?.kind === 'addition') additions.push(lines[index++]);
      for (let pair = 0; pair < Math.min(deletions.length, additions.length); pair += 1) {
        const group = [...deletions[pair].changeIndices, ...additions[pair].changeIndices];
        deletions[pair].changeIndices = group;
        additions[pair].changeIndices = group;
        if (decorate) {
          const [left, right] = wordDiffSegments(deletions[pair].text, additions[pair].text);
          deletions[pair].segments = left;
          additions[pair].segments = right;
        }
      }
    }

    for (const line of lines) {
      if (!line.segments.length) line.segments = [{ text: line.text, changed: false }];
      line.tokens = decorate
        ? tokenizeDiffLine(line.segments, diff.path)
        : [{ text: line.text, kind: 'plain', changed: false }];
    }
    return lines;
  });

  protected readonly splitDiffRows = computed<SplitDiffRow[]>(() => {
    const lines = this.diffLines();
    const rows: SplitDiffRow[] = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (line.kind === 'header' || line.kind === 'hunk') {
        rows.push({ kind: line.kind, left: null, right: null, label: line.text, hunkIndex: line.hunkIndex });
        index += 1;
        continue;
      }
      if (line.kind === 'deletion') {
        const deletions: DiffLine[] = [];
        const additions: DiffLine[] = [];
        while (lines[index]?.kind === 'deletion') deletions.push(lines[index++]);
        while (lines[index]?.kind === 'addition') additions.push(lines[index++]);
        const count = Math.max(deletions.length, additions.length);
        for (let pair = 0; pair < count; pair += 1) {
          rows.push({ kind: 'pair', left: deletions[pair] ?? null, right: additions[pair] ?? null, label: null, hunkIndex: null });
        }
        continue;
      }
      if (line.kind === 'addition') {
        rows.push({ kind: 'pair', left: null, right: line, label: null, hunkIndex: null });
      } else {
        rows.push({ kind: 'pair', left: line, right: line, label: null, hunkIndex: null });
      }
      index += 1;
    }
    return rows;
  });

  protected readonly diffStats = computed(() => this.diffLines().reduce(
    (stats, line) => ({
      additions: stats.additions + (line.kind === 'addition' ? 1 : 0),
      deletions: stats.deletions + (line.kind === 'deletion' ? 1 : 0),
    }),
    { additions: 0, deletions: 0 },
  ));

  protected readonly selectedDiffLines = computed<DiffLineSelection | null>(() => {
    const groups = this.selectedDiffLineGroups();
    if (!groups.length) return null;
    const hunkIndex = Number(groups[0].split(':', 1)[0]);
    const lineIndices = [...new Set(groups.flatMap((group) => {
      const [hunk, indices = ''] = group.split(':');
      return Number(hunk) === hunkIndex
        ? indices.split(',').filter(Boolean).map(Number)
        : [];
    }))].sort((left, right) => left - right);
    return Number.isInteger(hunkIndex) && lineIndices.every(Number.isInteger)
      ? { hunkIndex, lineIndices }
      : null;
  });

  protected readonly diffHunks = computed(() => {
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

  private readonly remoteBranchesByLocalName = computed(() => {
    const branches = this.git.repository()?.branches ?? [];
    const locals = new Map(branches.filter((branch) => !branch.remote).map((branch) => [branch.name, branch]));
    const aligned = new Map<string, Branch[]>();
    for (const branch of branches) {
      if (!branch.remote) continue;
      const local = locals.get(this.remoteBranchLabel(branch.name));
      if (!local) continue;
      const locations = aligned.get(local.name) ?? [];
      locations.push(branch);
      aligned.set(local.name, locations);
    }
    for (const [localName, locations] of aligned) {
      const order = this.remoteNameOrder(locals.get(localName)?.upstream ?? null);
      locations.sort((left, right) => this.compareRemoteBranches(left, right, order));
    }
    return aligned;
  });

  private readonly groupedRemoteBranchFullNames = computed(() => new Set(
    [...this.remoteBranchesByLocalName().values()].flat().map((branch) => branch.fullName),
  ));

  private readonly remoteOnlyBranchGroups = computed<RemoteBranchLocationGroup[]>(() => {
    const repository = this.git.repository();
    if (!repository) return [];
    const remoteOrder = this.remoteNameOrder(
      repository.branches.find((branch) => branch.current)?.upstream ?? null,
    );
    const groups = new Map<string, Branch[]>();
    for (const branch of repository.branches) {
      if (!branch.remote || this.groupedRemoteBranchFullNames().has(branch.fullName)) continue;
      const label = this.remoteBranchLabel(branch.name);
      const key = label;
      const locations = groups.get(key) ?? [];
      locations.push(branch);
      groups.set(key, locations);
    }
    return [...groups.entries()].flatMap(([key, locations]) => {
      if (locations.length < 2) return [];
      locations.sort((left, right) => this.compareRemoteBranches(left, right, remoteOrder));
      return [{ key, label: this.remoteBranchLabel(locations[0].name), primary: locations[0], locations }];
    });
  });

  private readonly remoteOnlyBranchGroupByPrimary = computed(() => new Map(
    this.remoteOnlyBranchGroups().map((group) => [group.primary.fullName, group]),
  ));

  private readonly remoteOnlyBranchPeerFullNames = computed(() => new Set(
    this.remoteOnlyBranchGroups().flatMap((group) => group.locations.slice(1).map((branch) => branch.fullName)),
  ));

  protected readonly visibleBranches = computed(() => {
    const query = this.branchFilter().trim().toLocaleLowerCase();
    return orderBranchesCurrentFirst((this.git.repository()?.branches ?? []).filter(
      (branch) => !branch.remote && (!query
        || branch.name.toLocaleLowerCase().includes(query)
        || this.remoteLocationsForLocalBranch(branch).some((remote) => remote.name.toLocaleLowerCase().includes(query))),
    ));
  });
  protected readonly virtualBranches = computed(() => this.virtualReferenceWindow('local', this.visibleBranches()));

  protected remoteLocationsForLocalBranch(branch: Branch): Branch[] {
    return this.remoteBranchesByLocalName().get(branch.name) ?? [];
  }

  protected remoteOnlyBranchLocations(branch: Branch): Branch[] {
    return this.remoteOnlyBranchGroupByPrimary().get(branch.fullName)?.locations ?? [];
  }

  protected readonly currentBranch = computed(() =>
    (this.git.repository()?.branches ?? []).find((candidate) => candidate.current) ?? null,
  );

  protected readonly toolbarRemotes = computed(() => {
    const repository = this.git.repository();
    const upstream = this.currentBranch()?.upstream ?? null;
    const order = new Map(buildRemoteNameOrder(
      repository?.remotes.map((remote) => remote.name) ?? [],
      upstream,
    ));
    return [...(repository?.remotes ?? [])].sort((left, right) =>
      (order.get(left.name) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right.name) ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
  });

  protected readonly currentRemote = computed<Remote | null>(() => {
    const remotes = this.toolbarRemotes();
    const selected = this.selectedRemoteName();
    const upstream = this.currentBranch()?.upstream ?? '';
    const upstreamRemote = upstream.includes('/') ? upstream.slice(0, upstream.indexOf('/')) : '';
    return remotes.find((remote) => remote.name === selected)
      ?? remotes.find((remote) => remote.name === upstreamRemote)
      ?? remotes.find((remote) => remote.name === 'origin')
      ?? remotes[0]
      ?? null;
  });

  protected readonly currentRemoteBranch = computed(() => {
    const branch = this.currentBranch();
    const remote = this.currentRemote();
    if (!branch || !remote) return null;
    const prefix = `${remote.name}/`;
    return branch.upstream?.startsWith(prefix) ? branch.upstream.slice(prefix.length) : branch.name;
  });

  protected readonly currentRemoteIsUpstream = computed(() => {
    const upstream = this.currentBranch()?.upstream;
    const remote = this.currentRemote();
    return !!upstream && !!remote && upstream.startsWith(`${remote.name}/`);
  });

  protected readonly currentRemoteRoleLabel = computed(() => {
    if (!this.currentRemote()) return 'Configure remote';
    return 'Pull & push';
  });

  protected readonly currentBranchSync = computed<BranchSyncState>(() => {
    const branch = this.currentBranch();
    const tracking = branch?.tracking ?? '';
    return {
      ahead: Number(tracking.match(/ahead (\d+)/)?.[1] ?? 0),
      behind: Number(tracking.match(/behind (\d+)/)?.[1] ?? 0),
      upstream: branch?.upstream ?? null,
      gone: tracking === 'gone',
    };
  });

  protected readonly currentBranchStateLabel = computed(() => {
    const repository = this.git.repository();
    const branch = this.currentBranch();
    if (!repository || !branch) return 'Detached HEAD';

    const sync = this.currentBranchSync();
    const parts: string[] = [];
    if (sync.gone) {
      parts.push('Upstream missing');
    } else {
      if (sync.ahead) parts.push(`${sync.ahead} ahead`);
      if (sync.behind) parts.push(`${sync.behind} behind`);
      if (!sync.ahead && !sync.behind) parts.push(branch.upstream ? 'Up to date' : 'No upstream');
    }
    if (repository.status.entryCount) {
      parts.push(`${repository.status.entryCount} ${repository.status.entryCount === 1 ? 'change' : 'changes'}`);
    }
    return parts.join(' · ');
  });

  protected readonly toolbarBranchMatches = computed(() =>
    this.branchPickerMatches(this.toolbarBranchQuery()));

  private branchPickerMatches(queryValue: string): {
    local: Branch[];
    remote: ToolbarRemoteBranchGroup[];
    total: number;
    shown: number;
  } {
    const query = queryValue.trim().toLocaleLowerCase();
    const branches = this.git.repository()?.branches ?? [];
    const locals = branches.filter((branch) => !branch.remote);
    const localNames = new Set(locals.map((branch) => branch.name));
    const localMatches = orderBranchesCurrentFirst(locals.filter((branch) => !query
      || branch.name.toLocaleLowerCase().includes(query)
      || this.remoteLocationsForLocalBranch(branch).some((location) =>
        location.name.toLocaleLowerCase().includes(query))));
    const remoteGroups = new Map<string, Branch[]>();
    for (const branch of branches) {
      if (!branch.remote) continue;
      const label = this.remoteBranchLabel(branch.name);
      if (localNames.has(label)) continue;
      const locations = remoteGroups.get(label) ?? [];
      locations.push(branch);
      remoteGroups.set(label, locations);
    }
    const remoteOrder = this.remoteNameOrder(
      locals.find((branch) => branch.current)?.upstream ?? null,
    );
    const groupedRemoteMatches = [...remoteGroups.entries()]
      .map(([label, locations]): ToolbarRemoteBranchGroup => {
        locations.sort((left, right) => this.compareRemoteBranches(left, right, remoteOrder));
        return { label, primary: locations[0], locations };
      })
      .filter((group) => !query
        || group.label.toLocaleLowerCase().includes(query)
        || group.locations.some((location) => location.name.toLocaleLowerCase().includes(query)))
      .sort((left, right) => left.label.localeCompare(
        right.label,
        undefined,
        { numeric: true, sensitivity: 'base' },
      ));
    const local = localMatches.slice(0, BRANCH_PICKER_RESULT_LIMIT);
    const remote = groupedRemoteMatches.slice(0, BRANCH_PICKER_RESULT_LIMIT);
    return {
      local,
      remote,
      total: localMatches.length + groupedRemoteMatches.length,
      shown: local.length + remote.length,
    };
  }

  protected readonly toolbarBranchCreationName = computed(() => {
    const name = this.toolbarBranchQuery().trim();
    if (!name) return '';
    const normalized = name.toLocaleLowerCase();
    const exists = (this.git.repository()?.branches ?? []).some((branch) =>
      branch.name.toLocaleLowerCase() === normalized
      || (branch.remote && this.remoteBranchLabel(branch.name).toLocaleLowerCase() === normalized));
    return exists ? '' : name;
  });

  protected branchPickerDescription(branch: Branch): string {
    const context = branch.current ? 'Current branch' : 'Local branch';
    const upstream = branch.upstream ? ` · ${branch.upstream}` : '';
    const tracking = branch.tracking ? ` · ${branch.tracking}` : '';
    return `${context}${upstream}${tracking}`;
  }

  protected readonly remoteBranches = computed(() => {
    const query = this.branchFilter().trim().toLocaleLowerCase();
    return (this.git.repository()?.branches ?? []).filter(
      (branch) => branch.remote
        && !this.groupedRemoteBranchFullNames().has(branch.fullName)
        && !this.remoteOnlyBranchPeerFullNames().has(branch.fullName)
        && (!query
          || branch.name.toLocaleLowerCase().includes(query)
          || this.remoteOnlyBranchLocations(branch).some((location) => location.name.toLocaleLowerCase().includes(query))),
    );
  });

  protected readonly visibleTags = computed(() => {
    const query = this.branchFilter().trim().toLocaleLowerCase();
    return (this.git.repository()?.tags ?? []).filter((tag) =>
      !query || tag.name.toLocaleLowerCase().includes(query),
    );
  });

  protected readonly visibleStashes = computed(() => {
    const query = this.branchFilter().trim().toLocaleLowerCase();
    return (this.git.repository()?.stashes ?? []).filter((stash) =>
      !query
      || stash.reference.toLocaleLowerCase().includes(query)
      || stash.message.toLocaleLowerCase().includes(query),
    );
  });
  protected readonly virtualTags = computed(() => this.virtualReferenceWindow('tags', this.visibleTags()));
  protected readonly virtualStashes = computed(() => this.virtualReferenceWindow('stashes', this.visibleStashes()));

  protected readonly remoteBranchGroups = computed<RemoteBranchGroup[]>(() => {
    const repository = this.git.repository();
    const remotes = repository?.remotes ?? [];
    const remoteOrder = this.remoteNameOrder(
      repository?.branches.find((branch) => branch.current)?.upstream ?? null,
    );
    const groups = new Map(remotes.map((remote) => [remote.name, [] as Branch[]]));
    const branchCounts = new Map<string, number>();
    for (const branch of this.git.repository()?.branches ?? []) {
      if (!branch.remote) continue;
      const remote = this.remoteLocationName(branch.name);
      branchCounts.set(remote, (branchCounts.get(remote) ?? 0) + 1);
    }
    for (const branch of this.remoteBranches()) {
      const remote = this.remoteLocationName(branch.name);
      const branches = groups.get(remote) ?? [];
      branches.push(branch);
      groups.set(remote, branches);
    }
    const filtering = !!this.branchFilter().trim();
    return [...groups]
      .sort(([left], [right]) =>
        (remoteOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
          - (remoteOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
          || left.localeCompare(right),
      )
      .map(([name, branches]) => {
        const remote = remotes.find((candidate) => candidate.name === name);
        return {
          name,
          fetchUrl: remote?.fetchUrl ?? '',
          pushUrl: remote?.pushUrl ?? '',
          branches: branches.sort((left, right) =>
            this.remoteBranchLabel(left.name).localeCompare(
              this.remoteBranchLabel(right.name),
              undefined,
              { numeric: true, sensitivity: 'base' },
            ),
          ),
          branchCount: branchCounts.get(name) ?? 0,
        };
      })
      .filter((group) => !filtering || group.branches.length > 0);
  });
  protected readonly remoteSidebarRows = computed(() => {
    const rows: VirtualRemoteBranchRow[] = [];
    for (const group of this.remoteBranchGroups()) {
      rows.push({ key: `remote:${group.name}`, kind: 'group', group });
      if (this.isRemoteCollapsed(group.name)) continue;
      for (const branch of group.branches) {
        rows.push({ key: `branch:${branch.fullName}`, kind: 'branch', group, branch });
      }
    }
    return rows;
  });
  protected readonly virtualRemoteRows = computed(() =>
    this.virtualReferenceWindow('remote', this.remoteSidebarRows()),
  );
  protected readonly virtualRemoteSections = computed(() => {
    const window = this.virtualRemoteRows();
    const sections: Array<{
      group: RemoteBranchGroup;
      rows: Array<{ row: VirtualRemoteBranchRow; index: number }>;
    }> = [];
    window.items.forEach((row, index) => {
      let section = sections[sections.length - 1];
      if (!section || section.group.name !== row.group.name) {
        section = { group: row.group, rows: [] };
        sections.push(section);
      }
      section.rows.push({ row, index: window.start + index });
    });
    return sections;
  });

  protected readonly graphVisibleCommits = computed(() => {
    const commits = this.graphCommits();
    if (!commits.length) return [];
    const hidden = this.hiddenBranchSet();
    const solo = this.soloBranchSet();
    const hiddenStashes = new Set(this.hiddenStashOids());
    const candidates = hiddenStashes.size ? commits.filter((commit) => !hiddenStashes.has(commit.oid)) : commits;
    if (!hidden.size && !solo.size && !this.smartBranchVisibility()) return candidates;

    const visibleTips = this.graphBranches()
      .filter((branch) => this.isBranchGraphVisible(branch.name))
      .map((branch) => branch.oid)
      .concat(this.graphStashes().filter((stash) => !hiddenStashes.has(stash.oid)).map((stash) => stash.oid))
      .concat(this.git.repository()?.showCheckpoints
        ? candidates.filter((commit) => commit.decorations.some((decoration) =>
          decoration.startsWith('refs/copilot/checkpoints/'))).map((commit) => commit.oid)
        : []);
    const parentsByOid = new Map(commits.map((commit) => [commit.oid, commit.parents]));
    const reachable = new Set<string>();
    const pending = [...visibleTips];
    while (pending.length) {
      const oid = pending.pop()!;
      if (reachable.has(oid)) continue;
      reachable.add(oid);
      for (const parent of parentsByOid.get(oid) ?? []) pending.push(parent);
    }
    return candidates.filter((commit) => reachable.has(commit.oid));
  });

  protected readonly smartVisibleBranchNames = computed(() => {
    const repository = this.git.repository();
    const current = repository?.branches.find((branch) => branch.current && !branch.remote);
    if (!repository || !current) return [];
    const names = new Set<string>([current.name]);
    if (current.upstream) names.add(current.upstream);
    const local = repository.branches.filter((branch) => !branch.remote && !branch.current);
    const pinned = local.find((branch) => branch.name === this.pinnedBranch());
    const conventional = local.find((branch) => ['main', 'master', 'trunk', 'develop'].includes(branch.name));
    const target = pinned ?? conventional;
    if (target) {
      names.add(target.name);
      if (target.upstream) names.add(target.upstream);
    }
    return repository.branches.filter((branch) => names.has(branch.name)).map((branch) => branch.name);
  });

  protected readonly pinnedGraphBranch = computed(() => {
    const name = this.pinnedBranch();
    if (!name || !this.isBranchGraphVisible(name)) return null;
    return this.git.repository()?.branches.find((branch) => !branch.remote && branch.name === name) ?? null;
  });

  protected readonly dirtyWorktrees = computed(() => {
    const repository = this.git.repository();
    return (repository?.worktrees ?? [])
      .filter((worktree) => worktree.changes > 0 && (!worktree.branch || this.isBranchGraphVisible(worktree.branch)))
      .sort((left, right) => Number(right.current) - Number(left.current) || left.path.localeCompare(right.path));
  });

  private requiredLaneProgress: RequiredGraphLaneProgress | null = null;
  protected readonly graphRequiredLaneCount = computed(() => {
    this.requiredLaneProgress = advanceRequiredGraphLaneCount(
      this.requiredLaneProgress,
      this.graphVisibleCommits(),
      this.dirtyWorktrees().map((worktree) => worktree.oid),
    );
    return this.requiredLaneProgress.maximum;
  });
  protected readonly graphMaximumWidth = computed(() => graphColumnWidthForLaneCount(
    this.graphRequiredLaneCount(),
    this.compactGraphColumn(),
  ));

  protected readonly selectedLinkedWorktree = computed(() => {
    const path = this.selectedWorktreePath();
    return path ? this.git.repository()?.worktrees.find((worktree) => worktree.path === path) ?? null : null;
  });

  protected readonly worktreeWipRows = computed<WorktreeWipRow[]>(() => {
    const lanes = new Map<string, { offset: number; color: number }>();
    const compact = this.compactGraphColumn();
    const width = this.graphColumnWidth();
    const rows = this.dirtyWorktrees().map((worktree) => {
      let lane = lanes.get(worktree.oid);
      if (!lane) {
        const index = lanes.size;
        lane = { offset: boundedGraphLaneOffset(index, width, compact), color: index % GRAPH_LANE_COLOR_COUNT };
        lanes.set(worktree.oid, lane);
      }
      return { worktree, nodeOffset: lane.offset, color: lane.color };
    });

    const firstRowByOffset = new Map<number, number>();
    rows.forEach((row, index) => {
      if (!firstRowByOffset.has(row.nodeOffset)) firstRowByOffset.set(row.nodeOffset, index);
    });

    const visibleLanes = [...firstRowByOffset].map(([offset, firstRow]) => ({
      offset,
      firstRow,
      color: rows[firstRow].color,
    }));

    return rows.map((row, rowIndex) => ({
      ...row,
      segments: visibleLanes
        .filter((lane) => lane.firstRow <= rowIndex)
        .map((lane) => ({
          offset: lane.offset,
          color: lane.color,
          startY: lane.firstRow === rowIndex ? WORKTREE_ROW_HEIGHT / 2 : -2,
          endY: WORKTREE_ROW_HEIGHT + 2,
        })),
    }));
  });

  protected readonly authorColors = computed(() => {
    const commits = this.graphCommits();
    const start = appendedFrom(this.authorColorSource, commits);
    const colors = start ? this.authorColorMap : new Map<string, string>();
    for (let index = start; index < commits.length; index += 1) {
      const commit = commits[index];
      const identity = this.authorIdentity(commit.authorName, commit.authorEmail);
      if (!colors.has(identity)) colors.set(identity, stableAuthorColor(identity));
    }
    this.authorColorMap = colors;
    this.authorColorSource = commits;
    return colors;
  }, { equal: () => false });
  private authorColorMap = new Map<string, string>();
  private authorColorSource: readonly CommitSummary[] | null = null;

  private graphLayoutCache: GraphLayoutCache | null = null;

  // History grows page by page while scrolling, so each commit's date is formatted once per format.
  private commitDateCache = new Map<string, CommitDateDisplay>();
  private commitDateCacheFormat: GraphDateFormat | null = null;
  private commitDateCacheTime = 0;
  protected readonly graphCommitDates = computed(() => {
    const format = this.graphDateFormat();
    const now = Date.now();
    // Relative labels age, so they are reformatted at most a minute after they were cached.
    if (format !== this.commitDateCacheFormat || (format === 'relative' && now - this.commitDateCacheTime > 60_000)) {
      this.commitDateCache = new Map();
      this.commitDateCacheFormat = format;
      this.commitDateCacheTime = now;
    }
    const cache = this.commitDateCache;
    const commits = this.graphCommits();
    const start = this.commitDatesFor === cache ? appendedFrom(this.commitDatesSource, commits) : 0;
    const dates = start ? this.commitDates : new Map<string, CommitDateDisplay>();
    for (let index = start; index < commits.length; index += 1) {
      const commit = commits[index];
      let date = cache.get(commit.oid);
      if (!date) {
        date = formatCommitDate(commit.authoredAt, format, now);
        cache.set(commit.oid, date);
      }
      dates.set(commit.oid, date);
    }
    this.commitDates = dates;
    this.commitDatesSource = commits;
    this.commitDatesFor = cache;
    return dates;
  }, { equal: () => false });
  private commitDates = new Map<string, CommitDateDisplay>();
  private commitDatesSource: readonly CommitSummary[] | null = null;
  private commitDatesFor: Map<string, CommitDateDisplay> | null = null;

  protected readonly graphRows = computed<GraphRow[]>(() => {
    const commits = this.graphVisibleCommits();
    const seeded = new Map<string, ActiveGraphLane>();
    for (const row of this.worktreeWipRows()) {
      if (!seeded.has(row.worktree.oid)) seeded.set(row.worktree.oid, { oid: row.worktree.oid, color: row.color });
    }
    const compact = this.compactGraphColumn();
    const laneCapacity = graphLaneCapacity(this.graphColumnWidth(), compact);
    const laneOffset = (index: number) => graphLaneOffset(index, compact);
    const authorColors = this.authorColors();
    const pinned = this.graphBranches().find(
      (branch) => !branch.remote && branch.name === this.pinnedBranch() && this.isBranchGraphVisible(branch.name),
    );
    const parentsByOid = pinned
      ? new Map(this.graphCommits().map((commit) => [commit.oid, commit.parents]))
      : new Map<string, readonly string[]>();
    const pinnedHistory = new Set<string>();
    let pinnedOid = pinned?.oid;
    while (pinnedOid && !pinnedHistory.has(pinnedOid)) {
      pinnedHistory.add(pinnedOid);
      pinnedOid = parentsByOid.get(pinnedOid)?.[0];
    }
    const key = `${compact}\0${laneCapacity}\0${pinned?.oid ?? ''}\0${[...seeded.values()]
      .map((lane) => `${lane.oid}:${lane.color}`)
      .join('|')}`;
    const cache = this.graphLayoutCache;
    const canExtend = cache?.key === key && isAppendOnlyCommitHistory(cache.commitOids, commits);
    let active: (ActiveGraphLane | null)[] = canExtend
      ? cache.active.map((lane) => lane ? { ...lane } : null)
      : [...seeded.values()].slice(0, laneCapacity);
    let nextColor = canExtend ? cache.nextColor : active.length;
    // A push or fetch can move decorations without changing topology. Keep the geometry,
    // but rebind changed commit metadata so recycled rows do not display stale references.
    const rows = canExtend ? cache.rows.map((row, index) =>
      row.commit === commits[index] ? row : { ...row, commit: commits[index] }) : [];
    const pendingParentConnections = new Map<string, {
      fromOffset: number; color: number; nodeConnection?: GraphNodeConnection;
    }[]>();
    // Parents whose lane opened only for an adjacent side link have no lane above them.
    const sideLinkedParents = new Set<string>();

    for (let commitIndex = rows.length; commitIndex < commits.length; commitIndex += 1) {
      const commit = commits[commitIndex];
      let lane = active.findIndex((candidate) => candidate?.oid === commit.oid);
      const hasIncomingConnection = lane >= 0 && !sideLinkedParents.delete(commit.oid);
      if (lane < 0) {
        lane = active.indexOf(null);
        if (lane < 0) lane = Math.min(active.length, laneCapacity - 1);
        active[lane] = { oid: commit.oid, color: nextColor++ % GRAPH_LANE_COLOR_COUNT };
      }
      const before = active.map((candidate) => candidate ? { ...candidate } : null);
      const current = before[lane]!;
      // Reuse vacant slots without shifting unrelated, continuing lanes.
      const after = [...before];
      after[lane] = null;
      const nodeLane = pinnedHistory.has(commit.oid) ? 0 : lane;
      const afterIndexByOid = new Map(after.flatMap((candidate, index) => candidate ? [[candidate.oid, index] as const] : []));

      commit.parents.forEach((parent, parentIndex) => {
        if (afterIndexByOid.has(parent)) return;
        let insertion = parentIndex === 0 && !after[nodeLane] ? nodeLane : after.indexOf(null);
        if (insertion < 0) insertion = after.length;
        if (insertion >= laneCapacity) return;
        after[insertion] = {
          oid: parent,
          color: parentIndex === 0 ? current.color : nextColor++ % GRAPH_LANE_COLOR_COUNT,
        };
        afterIndexByOid.set(parent, insertion);
      });
      if (pinnedHistory.has(commit.oid) && commit.parents[0]) {
        const firstParentLane = afterIndexByOid.get(commit.parents[0]) ?? -1;
        if (firstParentLane > 0) {
          [after[0], after[firstParentLane]] = [after[firstParentLane], after[0]];
          after.forEach((candidate, index) => {
            if (candidate) afterIndexByOid.set(candidate.oid, index);
          });
        }
      }
      while (after.length && !after[after.length - 1]) after.pop();

      const firstParentLane = commit.parents[0]
        ? afterIndexByOid.get(commit.parents[0]) ?? -1
        : -1;
      const continuesStraight = lane === nodeLane && firstParentLane === nodeLane;
      const segments: GraphSegment[] = hasIncomingConnection ? [{
          x1: laneOffset(lane),
          y1: 0,
          x2: laneOffset(nodeLane),
          y2: continuesStraight ? 40 : 20,
          color: current.color,
          // Pinning can relocate an incoming lane; join the circle's side too.
          parentNodeRadius: lane !== nodeLane ? (compact ? 10 : 12) : undefined,
        }] : [];
      const parentConnections = pendingParentConnections.get(commit.oid) ?? [];
      pendingParentConnections.delete(commit.oid);
      parentConnections.forEach((connection) => {
        segments.push({
          x1: connection.fromOffset,
          y1: 0,
          x2: laneOffset(nodeLane),
          y2: 20,
          color: connection.color,
          parentNodeRadius: compact ? 10 : 12,
          nodeConnection: connection.nodeConnection,
        });
      });
      before.forEach((candidate, beforeIndex) => {
        if (!candidate || beforeIndex === lane) return;
        const afterIndex = afterIndexByOid.get(candidate.oid);
        if (afterIndex !== undefined) {
          segments.push({
            x1: laneOffset(beforeIndex),
            y1: 0,
            x2: laneOffset(afterIndex),
            y2: 40,
            color: candidate.color,
            bypassNode: { offset: laneOffset(nodeLane), radius: compact ? 10 : 12 },
          });
        }
      });
      commit.parents.forEach((parent, parentIndex) => {
        if (parentIndex === 0 && continuesStraight && hasIncomingConnection) return;
        const target = afterIndexByOid.get(parent);
        if (target === undefined) return;
        const color = parentIndex === 0 ? current.color : after[target]!.color;
        if (target !== nodeLane && commits[commitIndex + 1]?.oid === parent) {
          const fromOffset = laneOffset(nodeLane);
          const parentOffset = laneOffset(pinnedHistory.has(parent) ? 0 : target);
          const connection = fromOffset !== parentOffset ? {
            sourceOffset: fromOffset, parentOffset, nodeRadius: compact ? 10 : 12,
            sharedColumn: Boolean(after[nodeLane]),
          } : undefined;
          const boundaryOffset = connection ? graphNodeConnectionStemOffset(connection) : fromOffset;
          segments.push({
            x1: fromOffset,
            y1: 20,
            x2: boundaryOffset,
            y2: 40,
            color,
            nodeConnection: connection ? { ...connection, part: 'source' } : undefined,
          });
          if (connection && !before.some((candidate) => candidate?.oid === parent)) sideLinkedParents.add(parent);
          const connections = pendingParentConnections.get(parent) ?? [];
          connections.push({ fromOffset: boundaryOffset, color,
            nodeConnection: connection ? { ...connection, part: 'parent' } : undefined });
          pendingParentConnections.set(parent, connections);
          return;
        }
        segments.push({
          x1: laneOffset(nodeLane),
          y1: 20,
          x2: laneOffset(target),
          y2: 40,
          color,
          sourceNodeRadius: compact ? 10 : 12,
        });
      });
      active = after;
      rows.push({
        commit,
        nodeOffset: laneOffset(nodeLane),
        color: current.color,
        authorColor: authorColors.get(this.authorIdentity(commit.authorName, commit.authorEmail)) ?? AUTHOR_PALETTE[0],
        segments: stackOverlappingGraphEdges(segments),
      });
    }
    this.graphLayoutCache = {
      key,
      commitOids: commits.map((commit) => commit.oid),
      rows,
      active: active.map((lane) => lane ? { ...lane } : null),
      nextColor,
    };
    return rows;
  });

  protected readonly highlightedCommitOids = computed<Set<string> | null>(() => {
    if (!this.highlightRelatedCommits() || this.contextMenu() || this.stashContextMenu()) return null;
    const tip = this.hoveredReferenceOid() ?? this.hoveredCommitOid();
    const commits = this.graphCommits();
    if (!tip || !commits.length) return null;
    const parentsByOid = new Map(commits.map((commit) => [commit.oid, commit.parents]));
    if (!parentsByOid.has(tip)) return null;
    const reachable = new Set<string>();
    const pending = [tip];
    while (pending.length) {
      const oid = pending.pop()!;
      if (reachable.has(oid)) continue;
      if (reachable.size >= RELATED_COMMIT_VISIT_LIMIT) return null;
      reachable.add(oid);
      for (const parent of parentsByOid.get(oid) ?? []) pending.push(parent);
    }
    return reachable;
  });

  private readonly graphChildrenByOid = computed(() => {
    const children = new Map<string, string[]>();
    for (const commit of this.graphCommits()) {
      for (const parent of commit.parents) {
        const existing = children.get(parent);
        if (existing) existing.push(commit.oid);
        else children.set(parent, [commit.oid]);
      }
    }
    return children;
  });

  private readonly visibleLocalBranchesByOid = computed(() => {
    const branches = new Map<string, Branch[]>();
    const localBranches = this.graphBranches().filter(
      (branch) => !branch.remote && this.isBranchGraphVisible(branch.name),
    ).sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name));
    for (const branch of localBranches) {
      const existing = branches.get(branch.oid);
      if (existing) existing.push(branch);
      else branches.set(branch.oid, [branch]);
    }
    return branches;
  });

  protected readonly ghostBranch = computed<GhostBranchState | null>(() => {
    if (this.contextMenu() || this.stashContextMenu()) return null;
    const repository = this.git.repository();
    const commitOid = this.hoveredCommitOid() ?? (this.changesOpen() ? null : this.selectedCommit());
    if (!repository || !commitOid) return null;
    const branchesByOid = this.visibleLocalBranchesByOid();
    if (branchesByOid.has(commitOid)) return null;

    const childrenByOid = this.graphChildrenByOid();
    const visited = new Set([commitOid]);
    const pending = [commitOid];
    let cursor = 0;
    while (cursor < pending.length && visited.size <= GHOST_BRANCH_VISIT_LIMIT) {
      for (const child of childrenByOid.get(pending[cursor++]) ?? []) {
        if (visited.has(child)) continue;
        visited.add(child);
        const branch = branchesByOid.get(child)?.[0];
        if (branch) return { branch, commitOid };
        pending.push(child);
      }
    }
    return null;
  });

  protected readonly visibleGraphRows = computed(() => {
    const author = this.authorFilter();
    const rows = this.graphRows();
    return author ? rows.filter(({ commit }) => commit.authorEmail === author) : rows;
  });

  private visibleGraphRowLookupSource: readonly GraphRow[] | null = null;
  private visibleGraphRowLookup = { byOid: new Map<string, GraphRow>(), indexByOid: new Map<string, number>() };
  private readonly visibleGraphRowLookups = computed(() => {
    const rows = this.visibleGraphRows();
    const start = appendedFrom(this.visibleGraphRowLookupSource, rows);
    const lookup = start ? this.visibleGraphRowLookup : { byOid: new Map<string, GraphRow>(), indexByOid: new Map<string, number>() };
    for (let index = start; index < rows.length; index += 1) {
      lookup.byOid.set(rows[index].commit.oid, rows[index]);
      lookup.indexByOid.set(rows[index].commit.oid, index);
    }
    this.visibleGraphRowLookup = lookup;
    this.visibleGraphRowLookupSource = rows;
    return lookup;
  }, { equal: () => false });

  private readonly visibleGraphRowByOid = computed(() => this.visibleGraphRowLookups().byOid, { equal: () => false });

  private readonly visibleGraphRowIndexByOid = computed(() => this.visibleGraphRowLookups().indexByOid, { equal: () => false });

  protected readonly virtualGraphWindow = computed(() => calculateVirtualWindow(
    this.visibleGraphRows(),
    this.graphScrollTop(),
    this.graphViewportHeight(),
    COMMIT_ROW_HEIGHT,
    this.worktreeWipRows().length * WORKTREE_ROW_HEIGHT,
    Math.max(GRAPH_OVERSCAN_ROWS, Math.ceil(this.graphViewportHeight() / COMMIT_ROW_HEIGHT)),
  ), { equal: sameVirtualWindow });

  /**
   * Rows are recycled by slot (absolute index modulo the window capacity): while scrolling, only the
   * rows leaving the window are rebound to the rows entering it, so no row views are created or
   * destroyed and rows that stay visible are not repainted. The capacity only grows so slots stay
   * unique for every row in the window.
   */
  private graphRowSlotCapacityPeak = 1;
  private readonly graphRowSlotCapacity = computed(() => {
    this.graphRowSlotCapacityPeak = Math.max(this.graphRowSlotCapacityPeak, this.virtualGraphWindow().capacity);
    return this.graphRowSlotCapacityPeak;
  });

  /**
   * Rendered rows in slot order. Each slot keeps its DOM position for the life of the list and is
   * absolutely positioned at its row's offset, so scrolling only rebinds the rows that changed: no row
   * is ever moved in the DOM, which would force the engine to restyle and repaint it.
   */
  protected readonly graphRowSlots = computed(() => {
    const window = this.virtualGraphWindow();
    const capacity = this.graphRowSlotCapacity();
    const slots: ({ row: GraphRow; top: number } | null)[] = new Array(capacity).fill(null);
    for (let offset = 0; offset < window.items.length; offset += 1) {
      const index = window.start + offset;
      slots[index % capacity] = { row: window.items[offset], top: index * COMMIT_ROW_HEIGHT };
    }
    return slots;
  });

  // Stable callbacks keep row inputs unchanged during scrolling. Signals read through these
  // callbacks still notify each row when selection, columns, references, or preferences change.
  protected readonly graphRowView = computed(() => ({
    git: this.git,
    activeCommitSearchOid: this.activeCommitSearchOid.bind(this),
    allowBranchDrop: this.allowBranchDrop.bind(this),
    authorMarkerStyle: this.authorMarkerStyle.bind(this),
    beginColumnResize: this.beginColumnResize.bind(this),
    authorColor: this.authorColor.bind(this),
    handleGraphRowResizerClick: this.handleGraphRowResizerClick.bind(this),
    branchDropTarget: this.branchDropTarget.bind(this),
    branchForDecoration: this.branchForDecoration.bind(this),
    branchForReferenceGroup: this.branchForReferenceGroup.bind(this),
    branchTrackingLabel: this.branchTrackingLabel.bind(this),
    changesOpen: this.changesOpen.bind(this),
    checkoutGhostBranch: this.checkoutGhostBranch.bind(this),
    checkoutRemoteBranch: this.checkoutRemoteBranch.bind(this),
    closeTagPreview: this.closeTagPreview.bind(this),
    collapseReferenceStack: this.collapseReferenceStack.bind(this),
    collapsedReferenceStackOid: this.collapsedReferenceStackOid.bind(this),
    commitFilter: this.commitFilter.bind(this),
    commitRowGridColumns: this.commitRowGridColumns.bind(this),
    commitRowWidth: this.commitRowWidth.bind(this),
    commitSearchMatchOids: this.commitSearchMatchOids.bind(this),
    compactAuthorColumn: this.compactAuthorColumn.bind(this),
    compactReferenceSummary: this.compactReferenceSummary.bind(this),
    contextMenu: this.contextMenu.bind(this),
    currentBranch: this.currentBranch.bind(this),
    decorationKind: this.decorationKind.bind(this),
    decorationLabel: this.decorationLabel.bind(this),
    draggedBranch: this.draggedBranch.bind(this),
    draggedCommit: this.draggedCommit.bind(this),
    dropBranch: this.dropBranch.bind(this),
    expandedReferenceStackOid: this.expandedReferenceStackOid.bind(this),
    finishBranchDrag: this.finishBranchDrag.bind(this),
    fitGraphColumnToBranches: this.fitGraphColumnToBranches.bind(this),
    ghostBranchFor: this.ghostBranchFor.bind(this),
    graphColumnPosition: this.graphColumnPosition.bind(this),
    graphColumnWidth: this.graphColumnWidth.bind(this),
    graphCommitDates: this.graphCommitDates.bind(this),
    graphSegmentPath: this.graphSegmentPath.bind(this),
    handleCommitRowKeydown: this.handleCommitRowKeydown.bind(this),
    handleWorktreeGraphRowKeydown: this.handleWorktreeGraphRowKeydown.bind(this),
    handleWipRowResizerClick: this.handleWipRowResizerClick.bind(this),
    handleReferenceActionKeydown: this.handleReferenceActionKeydown.bind(this),
    handleReferenceStackMenuKeydown: this.handleReferenceStackMenuKeydown.bind(this),
    handleReferenceStackTriggerKeydown: this.handleReferenceStackTriggerKeydown.bind(this),
    highlightReference: this.highlightReference.bind(this),
    initials: this.initials.bind(this),
    isBranchPinned: this.isBranchPinned.bind(this),
    isCommitDimmed: this.isCommitDimmed.bind(this),
    isCommitHighlighted: this.isCommitHighlighted.bind(this),
    jumpToReference: this.jumpToReference.bind(this),
    openBranchMenu: this.openBranchMenu.bind(this),
    openCheckpointMenu: this.openCheckpointMenu.bind(this),
    openCommitMenu: this.openCommitMenu.bind(this),
    openReferenceStack: this.openReferenceStack.bind(this),
    openReferenceStackFromTrigger: this.openReferenceStackFromTrigger.bind(this),
    openRemoteMenu: this.openRemoteMenu.bind(this),
    openTagMenu: this.openTagMenu.bind(this),
    openWorktree: this.openWorktree.bind(this),
    primaryShortcutKey: this.primaryShortcutKey,
    previewCommit: this.previewCommit.bind(this),
    referenceGroupHeading: this.referenceGroupHeading.bind(this),
    referenceGroups: this.referenceGroups.bind(this),
    releaseReferenceStack: this.releaseReferenceStack.bind(this),
    remoteIconForDecoration: this.remoteIconForDecoration.bind(this),
    scheduleReferenceStackClose: this.scheduleReferenceStackClose.bind(this),
    scheduleTagPreview: this.scheduleTagPreview.bind(this),
    selectCommitWithModifiers: this.selectCommitWithModifiers.bind(this),
    selectedCommit: this.selectedCommit.bind(this),
    selectedCommits: this.selectedCommits.bind(this),
    selectedWorktreePath: this.selectedWorktreePath.bind(this),
    selectWorktreeGraphRow: this.selectWorktreeGraphRow.bind(this),
    shortOid: this.shortOid.bind(this),
    stashCurrentChanges: this.stashCurrentChanges.bind(this),
    stashMessage: this.stashMessage,
    showAuthorColumn: this.showAuthorColumn.bind(this),
    showBranchColumn: this.showBranchColumn.bind(this),
    showDateColumn: this.showDateColumn.bind(this),
    showGraphColumn: this.showGraphColumn.bind(this),
    showMessageColumn: this.showMessageColumn.bind(this),
    showShaColumn: this.showShaColumn.bind(this),
    startBranchDrag: this.startBranchDrag.bind(this),
    startCommitDrag: this.startCommitDrag.bind(this),
    stashForOid: this.stashForOid.bind(this),
    tagPreview: this.tagPreview.bind(this),
    trailingGraphColumn: this.trailingGraphColumn.bind(this),
    upwardReferenceStackOid: this.upwardReferenceStackOid.bind(this),
    visibleDecorations: this.visibleDecorations.bind(this),
  }));

  private focusedGraphRowOid: string | null = null;

  protected rememberFocusedGraphRow(event: FocusEvent): void {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-graph-row]');
    this.focusedGraphRowOid = row?.dataset['commitOid'] ?? null;
  }

  /** A recycled row must not carry keyboard focus over to the commit it now shows. */
  private readonly recycledGraphFocusGuard = afterRenderEffect(() => {
    this.virtualGraphWindow();
    const active = document.activeElement as HTMLElement | null;
    const row = active?.closest<HTMLElement>('[data-graph-row]');
    if (row && this.focusedGraphRowOid && row.dataset['commitOid'] !== this.focusedGraphRowOid) {
      active!.blur();
      this.focusedGraphRowOid = null;
    }
  });

  private readonly lfsLoaderFocus = afterRenderEffect(() => {
    this.lfsLoaderClose()?.nativeElement.focus();
  });
  private readonly referenceLoaderFocus = afterRenderEffect(() => {
    this.documentationLoaderClose()?.nativeElement.focus();
    this.worktreeReviewLoaderClose()?.nativeElement.focus();
    this.actionLoaderClose()?.nativeElement.focus();
    this.historyLoaderClose()?.nativeElement.focus();
    this.rebaseLoaderClose()?.nativeElement.focus();
    this.historyReviewLoaderClose()?.nativeElement.focus();
  });
  private readonly deferredHistoryFocus = afterRenderEffect(() => {
    const panel = this.repositoryHistorySearch();
    if (panel) untracked(() => {
      if (this.historySearchRequested()) {
        if (this.historySearchLoaderOpener?.isConnected) this.historySearchLoaderOpener.focus();
        panel.open();
      }
    });
  });

  protected readonly commitSearchMatches = computed(() => {
    const query = this.commitFilter().trim().toLocaleLowerCase();
    if (!query) return [];
    return this.visibleGraphRows().filter(({ commit }) =>
      commit.subject.toLocaleLowerCase().includes(query)
      || commit.description.toLocaleLowerCase().includes(query)
      || commit.authorName.toLocaleLowerCase().includes(query)
      || commit.authorEmail.toLocaleLowerCase().includes(query)
      || commit.oid.toLocaleLowerCase().startsWith(query));
  });

  protected readonly commitSearchMatchOids = computed(() =>
    new Set(this.commitSearchMatches().map(({ commit }) => commit.oid)),
  );

  protected readonly commitSearchPosition = computed(() => {
    const count = this.commitSearchMatches().length;
    return count ? Math.min(this.commitSearchIndex(), count - 1) + 1 : 0;
  });

  protected readonly activeCommitSearchOid = computed(() => {
    const matches = this.commitSearchMatches();
    if (!matches.length) return null;
    return matches[Math.min(this.commitSearchIndex(), matches.length - 1)].commit.oid;
  });

  protected readonly graphScrollMarkers = computed<GraphScrollMarker[]>(() => {
    if (!this.showGraphScrollMarkers()) return [];
    const worktrees = this.worktreeWipRows();
    const rows = this.visibleGraphRows();
    const rowIndexByOid = this.visibleGraphRowIndexByOid();
    const rowByOid = this.visibleGraphRowByOid();
    const totalHeight = worktrees.length * WORKTREE_ROW_HEIGHT + rows.length * COMMIT_ROW_HEIGHT;
    if (!totalHeight) return [];
    const markers: GraphScrollMarker[] = worktrees.map((row, index) => ({
      id: `working:${row.worktree.path}`,
      kind: 'working',
      position: graphScrollMarkerPosition(index * WORKTREE_ROW_HEIGHT, WORKTREE_ROW_HEIGHT, totalHeight),
      label: `Working changes · ${row.worktree.branch ?? this.git.pathLabel(row.worktree.path)}`,
      worktreePath: row.worktree.path,
    }));
    const appendCommitMarkers = (
      commits: readonly { oid: string; label: string }[],
      kind: Exclude<GraphScrollMarkerKind, 'working'>,
      limit: number,
    ) => {
      for (const commit of sampleGraphMarkers(commits, limit)) {
        const index = rowIndexByOid.get(commit.oid);
        if (index === undefined) continue;
        markers.push({
          id: `${kind}:${commit.oid}`,
          kind,
          position: graphScrollMarkerPosition(
            worktrees.length * WORKTREE_ROW_HEIGHT + index * COMMIT_ROW_HEIGHT,
            COMMIT_ROW_HEIGHT,
            totalHeight,
          ),
          label: commit.label,
          oid: commit.oid,
        });
      }
    };
    const headOid = this.currentBranch()?.oid ?? this.git.repository()?.headOid;
    if (headOid) appendCommitMarkers([{ oid: headOid, label: 'HEAD · current branch tip' }], 'head', 1);
    appendCommitMarkers(
      this.selectedCommits().map((oid) => ({
        oid,
        label: `Selected · ${rowByOid.get(oid)?.commit.subject ?? this.shortOid(oid)}`,
      })),
      'selected',
      80,
    );
    appendCommitMarkers(
      this.commitSearchMatches().map((row) => ({ oid: row.commit.oid, label: `Search · ${row.commit.subject}` })),
      'search',
      80,
    );
    return markers.sort((left, right) => left.position - right.position || left.kind.localeCompare(right.kind));
  });

  protected readonly graphAuthors = computed(() => {
    const authors = new Map<string, { name: string; email: string; commits: number }>();
    for (const row of this.graphRows()) {
      const existing = authors.get(row.commit.authorEmail);
      if (existing) existing.commits += 1;
      else authors.set(row.commit.authorEmail, {
        name: row.commit.authorName,
        email: row.commit.authorEmail,
        commits: 1,
      });
    }
    return [...authors.values()].sort((left, right) => right.commits - left.commits || left.name.localeCompare(right.name));
  });

  protected readonly authorFilterMatches = computed(() => {
    const query = this.authorFilterQuery();
    return this.graphAuthors().filter((author) => matchesCommandQuery(query, author.name, author.email));
  });

  protected readonly filteredGraphAuthors = computed(() => this.authorFilterMatches().slice(0, 80));

  protected readonly remoteUpstreamBranches = computed(() => (this.git.repository()?.branches ?? [])
    .filter((branch) => branch.remote && !branch.name.endsWith('/HEAD'))
    .sort((left, right) => left.name.localeCompare(right.name)));

  protected readonly filteredRecoveryEntries = computed(() => {
    const entries = this.git.reflog()?.entries ?? [];
    const query = this.recoveryQuery();
    if (!query.trim()) return entries;
    return entries.filter((entry) => matchesCommandQuery(
      query,
      entry.selector,
      entry.subject,
      entry.authorName,
      entry.authorEmail,
      entry.oid,
    ));
  });

  protected readonly activityAttentionCount = computed(() => {
    const repositoryId = this.git.activeRepositoryId();
    return this.git.activityLogs().filter((entry) =>
      entry.status === 'error' && (entry.repositoryId === null || entry.repositoryId === repositoryId),
    ).length;
  });

  protected readonly stagedEntries = computed(() =>
    (this.git.repository()?.status.entries ?? []).filter(
      (entry) => !entry.conflicted && entry.indexStatus !== ' ' && entry.indexStatus !== '?',
    ),
  );

  protected readonly unstagedEntries = computed(() =>
    (this.git.repository()?.status.entries ?? []).filter(
      (entry) => !entry.conflicted && (entry.worktreeStatus !== ' ' || entry.indexStatus === '?'),
    ),
  );

  protected readonly conflictedEntries = computed(() =>
    (this.git.repository()?.status.entries ?? []).filter((entry) => entry.conflicted && this.matchesFileFilter(entry.path)),
  );

  protected readonly sortedUnstagedEntries = computed(() =>
    sortWorkingTreeEntries(this.unstagedEntries().filter((entry) => this.matchesFileFilter(entry.path)), this.workingTreeSortAscending()),
  );

  protected readonly sortedStagedEntries = computed(() =>
    sortWorkingTreeEntries(this.stagedEntries().filter((entry) => this.matchesFileFilter(entry.path)), this.workingTreeSortAscending()),
  );

  protected readonly unstagedTreeRows = computed(() => buildWorkingTreeRows(
    this.unstagedEntries().filter((entry) => this.matchesFileFilter(entry.path)),
    this.workingTreeSortAscending(),
    new Set(this.collapsedWorkingTreeDirectories()),
  ));

  protected readonly stagedTreeRows = computed(() => buildWorkingTreeRows(
    this.stagedEntries().filter((entry) => this.matchesFileFilter(entry.path)),
    this.workingTreeSortAscending(),
    new Set(this.collapsedWorkingTreeDirectories()),
  ));

  protected readonly virtualUnstagedEntries = computed(() => calculateVirtualWindow(
    this.sortedUnstagedEntries(),
    this.workingTreeFilesScrollTop.unstaged(),
    this.workingTreeFileListHeight('unstaged'),
    WORKING_TREE_FILE_ROW_HEIGHT,
    0,
    WORKING_TREE_FILE_OVERSCAN_ROWS,
  ), { equal: sameVirtualWindow });
  protected readonly virtualStagedEntries = computed(() => calculateVirtualWindow(
    this.sortedStagedEntries(),
    this.workingTreeFilesScrollTop.staged(),
    this.workingTreeFileListHeight('staged'),
    WORKING_TREE_FILE_ROW_HEIGHT,
    0,
    WORKING_TREE_FILE_OVERSCAN_ROWS,
  ), { equal: sameVirtualWindow });
  protected readonly virtualUnstagedTreeRows = computed(() => calculateVirtualWindow(
    this.unstagedTreeRows(),
    this.workingTreeFilesScrollTop.unstaged(),
    this.workingTreeFileListHeight('unstaged'),
    WORKING_TREE_FILE_ROW_HEIGHT,
    0,
    WORKING_TREE_FILE_OVERSCAN_ROWS,
  ), { equal: sameVirtualWindow });
  protected readonly virtualStagedTreeRows = computed(() => calculateVirtualWindow(
    this.stagedTreeRows(),
    this.workingTreeFilesScrollTop.staged(),
    this.workingTreeFileListHeight('staged'),
    WORKING_TREE_FILE_ROW_HEIGHT,
    0,
    WORKING_TREE_FILE_OVERSCAN_ROWS,
  ), { equal: sameVirtualWindow });

  protected readonly visibleWorkingTreeFileCount = computed(() =>
    this.conflictedEntries().length + this.sortedUnstagedEntries().length + this.sortedStagedEntries().length,
  );

  protected readonly sortedCommitFiles = computed(() => sortCommitFiles(
    (this.git.commitDetails()?.files ?? []).filter((file) => this.matchesFileFilter(file.path, file.previousPath)),
    this.workingTreeSortAscending(),
  ));

  protected readonly commitFileTreeRows = computed(() => buildCommitFileRows(
    (this.git.commitDetails()?.files ?? []).filter((file) => this.matchesFileFilter(file.path, file.previousPath)),
    this.workingTreeSortAscending(),
    new Set(this.collapsedCommitDirectories()),
  ));

  protected readonly displayedCommitFiles = computed(() => this.workingTreeViewMode() === 'path'
    ? this.sortedCommitFiles()
    : this.commitFileTreeRows().flatMap((row) => row.file ? [row.file] : []));
  protected readonly virtualCommitFiles = computed(() => calculateVirtualWindow(
    this.sortedCommitFiles(),
    this.commitFilesScrollTop(),
    COMMIT_FILE_VIEWPORT_HEIGHT,
    COMMIT_FILE_ROW_HEIGHT,
    0,
    COMMIT_FILE_OVERSCAN_ROWS,
  ));
  protected readonly virtualCommitFileTreeRows = computed(() => calculateVirtualWindow(
    this.commitFileTreeRows(),
    this.commitFilesScrollTop(),
    COMMIT_FILE_VIEWPORT_HEIGHT,
    COMMIT_FILE_ROW_HEIGHT,
    0,
    COMMIT_FILE_OVERSCAN_ROWS,
  ));
  protected readonly selectedCommitFileStats = computed(() => summarizeFileChanges(
    this.git.commitDetails()?.files ?? [],
  ));

  protected readonly sortedComparisonFiles = computed(() => sortCommitFiles(
    (this.git.commitComparison()?.files ?? []).filter((file) => this.matchesFileFilter(file.path, file.previousPath)),
    this.workingTreeSortAscending(),
  ));

  protected readonly comparisonFileTreeRows = computed(() => buildCommitFileRows(
    (this.git.commitComparison()?.files ?? []).filter((file) => this.matchesFileFilter(file.path, file.previousPath)),
    this.workingTreeSortAscending(),
    new Set(this.collapsedCommitDirectories()),
  ));

  protected readonly displayedComparisonFiles = computed(() => this.workingTreeViewMode() === 'path'
    ? this.sortedComparisonFiles()
    : this.comparisonFileTreeRows().flatMap((row) => row.file ? [row.file] : []));
  protected readonly activeDiffFileTargets = computed<DiffFileNavigationTarget[]>(() => {
    if (this.changesOpen()) {
      return [
        ...this.sortedUnstagedEntries().map((entry) => ({ source: 'working' as const, path: entry.path, staged: false })),
        ...this.sortedStagedEntries().map((entry) => ({ source: 'working' as const, path: entry.path, staged: true })),
      ];
    }
    const source = this.git.commitComparison() ? 'comparison' as const : 'commit' as const;
    const files = source === 'comparison' ? this.displayedComparisonFiles() : this.displayedCommitFiles();
    return files.map((file) => ({ source, file }));
  });
  protected readonly activeDiffFileIndex = computed(() => {
    const diff = this.activeDiff();
    if (!diff) return -1;
    const workingTreeDiff = this.activeWorkingTreeDiff();
    return this.activeDiffFileTargets().findIndex((target) => target.source === 'working'
      ? !!workingTreeDiff && target.path === workingTreeDiff.path && target.staged === workingTreeDiff.staged
      : target.source === (this.git.commitComparison() ? 'comparison' : 'commit') && target.file.path === diff.path);
  });
  protected readonly activeDiffFileStatus = computed(() => {
    const target = this.activeDiffFileTargets()[this.activeDiffFileIndex()];
    return target ? this.diffFileTargetStatus(target) : '?';
  });
  protected readonly activeDiffFileChangeStats = computed(() => {
    const target = this.activeDiffFileTargets()[this.activeDiffFileIndex()];
    if (!target || target.source === 'working') return null;
    const { additions, deletions } = target.file;
    if (additions === null && deletions === null) return null;
    return { additions: additions ?? 0, deletions: deletions ?? 0 };
  });
  protected readonly virtualComparisonFiles = computed(() => calculateVirtualWindow(
    this.sortedComparisonFiles(),
    this.commitFilesScrollTop(),
    COMMIT_FILE_VIEWPORT_HEIGHT,
    COMMIT_FILE_ROW_HEIGHT,
    0,
    COMMIT_FILE_OVERSCAN_ROWS,
  ));
  protected readonly virtualComparisonFileTreeRows = computed(() => calculateVirtualWindow(
    this.comparisonFileTreeRows(),
    this.commitFilesScrollTop(),
    COMMIT_FILE_VIEWPORT_HEIGHT,
    COMMIT_FILE_ROW_HEIGHT,
    0,
    COMMIT_FILE_OVERSCAN_ROWS,
  ));
  protected readonly comparisonFileStats = computed(() => summarizeFileChanges(
    this.git.commitComparison()?.files ?? [],
  ));

  protected readonly commandActions = computed<CommandAction[]>(() => {
    const repository = this.git.repository();
    const busy = this.git.busy();
    const actions: CommandAction[] = [
      ...this.git.workspaces().map((workspace, index): CommandAction => {
        const current = workspace.id === this.git.activeWorkspaceId();
        const count = this.git.workspaceRepositoryCount(workspace);
        return {
          id: `workspace:${workspace.id}`,
          group: 'Workspace',
          label: `Switch to ${workspace.name}`,
          detail: `${current ? 'Current workspace · ' : ''}${count} ${count === 1 ? 'repository' : 'repositories'}`,
          shortcut: index < 9 ? `${this.primaryShortcutKey} Shift ${index + 1}` : undefined,
          enabled: !current && !busy,
          icon: 'repo',
        };
      }),
      { id: 'hosting-center', group: 'Workspace', label: 'Reviews and checks', detail: 'Inspect GitHub pull requests, issues and workflow runs', enabled: !!repository && !busy, icon: 'repo' },
      { id: 'workspace-overview', group: 'Workspace', label: 'Repository overview', detail: 'Inspect local changes and tracking state across open repositories', enabled: !busy, icon: 'repo' },
      { id: 'identity-profiles', group: 'Workspace', label: 'Identity profiles', detail: 'Save and explicitly apply repository commit identities', enabled: !busy, icon: 'edit' },
      { id: 'workspace-create', group: 'Workspace', label: 'New Workspace', detail: 'Create a separate set of repository tabs', enabled: !busy, icon: 'plus' },
      { id: 'workspace-rename', group: 'Workspace', label: 'Rename Current Workspace', detail: `Rename ${this.git.activeWorkspace().name}`, enabled: !busy, icon: 'edit' },
      { id: 'workspace-delete', group: 'Workspace', label: 'Delete Current Workspace', detail: 'Remove this saved tab layout without deleting repositories', enabled: this.git.workspaces().length > 1 && !busy, icon: 'trash' },
      { id: 'new-tab', group: 'Repository', label: 'New Tab', detail: 'Open repository management', shortcut: `${this.primaryShortcutKey} T`, enabled: !busy, icon: 'plus' },
      { id: 'incoming-links', group: 'Repository', label: 'Incoming repository links', detail: 'Review queued external requests without replacing other dialogs', enabled: !busy && this.git.incomingRepositoryLinksReady() && !this.git.browserPreview(), icon: 'repo' },
      { id: 'open-link', group: 'Repository', label: 'Open repository link…', detail: 'Review shared context in a matching local copy', enabled: !busy && !this.git.browserPreview(), icon: 'repo' },
      { id: 'open', group: 'Repository', label: 'Open Repository', detail: 'Open a local Git working tree', shortcut: `${this.primaryShortcutKey} Shift O`, enabled: !busy, icon: 'folder-git' },
      { id: 'clone', group: 'Repository', label: 'Clone Repository', detail: 'Download a remote repository to this machine', enabled: !busy, icon: 'copy' },
      { id: 'init', group: 'Repository', label: 'Initialize Repository', detail: 'Create a new local Git working tree', enabled: !busy, icon: 'repo' },
      { id: 'previous-tab', group: 'Repository', label: 'Previous Repository Tab', detail: 'Switch to the repository tab on the left', shortcut: 'Ctrl Shift Tab', enabled: this.git.repositories().length > 1, icon: 'chevron-left' },
      { id: 'next-tab', group: 'Repository', label: 'Next Repository Tab', detail: 'Switch to the repository tab on the right', shortcut: 'Ctrl Tab', enabled: this.git.repositories().length > 1, icon: 'chevron-right' },
      { id: 'close-tab', group: 'Repository', label: 'Close Repository Tab', detail: 'Close the current repository workspace', shortcut: `${this.primaryShortcutKey} W`, enabled: !!repository && !busy, icon: 'x' },
      { id: 'reopen-tab', group: 'Repository', label: 'Reopen Closed Repository', detail: this.git.recentlyClosedRepositoryPath() ?? 'No repository tab has been closed this session', shortcut: `${this.primaryShortcutKey} Shift T`, enabled: !!this.git.recentlyClosedRepositoryPath() && !busy, icon: 'redo' },
      { id: 'refresh', group: 'Repository', label: 'Refresh Repository', detail: 'Reload status, references, and history', enabled: !!repository && !busy, icon: 'refresh' },
      { id: 'branch-workflows', group: 'Branch', label: 'Branch workflows', detail: 'Configure, start and finish features, releases and hotfixes', enabled: !!repository && !repository.bare && !busy, icon: 'merge' },
      { id: 'merge-preview', group: 'Branch', label: 'Preview merge conflicts', detail: 'Inspect committed branch tips without starting a merge', enabled: !!repository?.headOid && !busy, icon: 'merge' },
      { id: 'maintenance', group: 'Repository', label: 'Perform Repository Maintenance', detail: 'Check integrity, pack refs/commit graph; no pruning', enabled: !!repository && !busy, icon: 'settings' },
      { id: 'undo', group: 'Edit', label: this.git.undoLabel() ?? 'Undo', detail: this.git.undoLabel() ? 'Reverse the latest supported repository action' : 'No supported repository action to undo', shortcut: this.undoShortcut, enabled: !!this.git.undoLabel() && !busy, icon: 'undo' },
      { id: 'redo', group: 'Edit', label: this.git.redoLabel() ?? 'Redo', detail: this.git.redoLabel() ? 'Repeat the last repository action that was undone' : 'No supported repository action to redo', shortcut: this.redoShortcut, enabled: !!this.git.redoLabel() && !busy, icon: 'redo' },
      { id: 'fetch', group: 'Remote', label: 'Fetch All', detail: 'Fetch and prune remote references', enabled: !!repository && !busy, icon: 'refresh' },
      { id: 'fetch-options', group: 'Remote', label: 'Fetch branches with options', detail: 'Choose remote and pruning; leave tags unchanged', enabled: !!repository && !busy, icon: 'remote' },
      { id: 'add-remote', group: 'Remote', label: 'Add Remote', detail: 'Connect another tracked Git repository', enabled: !!repository && !busy, icon: 'remote' },
      { id: 'pull', group: 'Remote', label: 'Pull', detail: 'Fetch and integrate upstream changes', enabled: !!repository && !busy, icon: 'pull' },
      {
        id: 'push',
        group: 'Remote',
        label: this.currentBranch()?.upstream ? 'Push' : 'Publish Branch',
        detail: this.currentBranch()?.upstream
          ? 'Push the current branch upstream'
          : 'Choose a remote and publish the current branch',
        enabled: !!this.currentBranch() && !busy,
        icon: 'push',
      },
      { id: 'force-push', group: 'Remote', label: 'Force Push with Lease', detail: 'Rewrite the upstream only if it still matches the last fetched state', enabled: !!this.currentBranch()?.upstream && !busy, icon: 'warning' },
      { id: 'branch', group: 'Branch', label: 'Create Branch', detail: 'Create a branch from the current HEAD', enabled: !!repository && !busy, icon: 'branch' },
      { id: 'tag-create', group: 'Branch', label: 'Create Tag', detail: this.selectedCommit() && !this.changesOpen() ? 'Tag the selected commit' : 'Tag the current HEAD', enabled: !!repository?.headOid && !busy, icon: 'tag' },
      { id: 'stage-all', group: 'Working Tree', label: 'Stage All Changes', detail: 'Add every current working-tree change to the index', enabled: !!this.unstagedEntries().length && !busy, icon: 'check' },
      { id: 'unstage-all', group: 'Working Tree', label: 'Unstage All Changes', detail: 'Move every staged change back to the working tree', enabled: !!this.stagedEntries().length && !busy, icon: 'reset' },
      { id: 'stash', group: 'Working Tree', label: 'Stash Changes', detail: 'Stash tracked and untracked changes', enabled: !!repository?.status.entryCount && !busy, icon: 'archive' },
      { id: 'apply-stash', group: 'Working Tree', label: 'Apply Latest Stash', detail: 'Apply the newest stash without removing it', enabled: !!repository?.stashes.length && !busy, icon: 'archive-restore', stashTarget: repository?.stashes[0] ? { repositoryId: repository.id, stash: repository.stashes[0] } : undefined },
      { id: 'pop', group: 'Working Tree', label: 'Pop Latest Stash', detail: 'Apply and remove the newest stash', enabled: !!repository?.stashes.length && !busy, icon: 'archive-restore', stashTarget: repository?.stashes[0] ? { repositoryId: repository.id, stash: repository.stashes[0] } : undefined },
      { id: 'working-tree', group: 'Working Tree', label: 'View Working Directory Changes', detail: 'Return to staging and commit preparation', enabled: !!repository, icon: 'file' },
      { id: 'terminal', group: 'View', label: 'Open Terminal', detail: 'Open a shell in this repository', shortcut: `${this.alternateShortcutKey} T / ${this.primaryShortcutKey} \``, enabled: !!repository, icon: 'terminal' },
      { id: 'file-manager', group: 'View', label: 'Open Repository Folder', detail: 'Show the working tree in the system file manager', shortcut: `${this.alternateShortcutKey} O`, enabled: !!repository, icon: 'folder-git' },
      { id: 'fullscreen', group: 'View', label: 'Toggle Fullscreen', detail: 'Enter or leave fullscreen mode', shortcut: this.fullscreenShortcut, enabled: true, icon: 'maximize' },
      { id: 'search', group: 'View', label: 'Search All History', detail: 'Search whole-repository history with optional advanced filters', shortcut: `${this.primaryShortcutKey} Shift F`, enabled: !!repository, icon: 'search' },
      { id: 'file-search', group: 'History', label: 'Find File History or Blame', detail: 'Search every tracked file in this repository', shortcut: `${this.primaryShortcutKey} Shift H`, enabled: !!repository, icon: 'history' },
      { id: 'file-tools', group: 'Edit', label: 'External File Tools', detail: 'Inspect reviewed editor, comparison and merge sessions', enabled: !!repository && !busy && !this.fileContentDialog(), icon: 'terminal' },
      { id: 'editor-draft-recovery', group: 'Edit', label: 'Editor Draft Recovery', detail: 'Inspect retained editor copies and review a working file', enabled: !busy && !this.fileContentDialog(), icon: 'history' },
      { id: 'recovery-history', group: 'History', label: 'Recovery History', detail: 'Find previous reference positions and preserve a commit with a new branch', enabled: !!repository && !busy, icon: 'history' },
      ...(repository?.status.mergeInProgress ? [
        { id: 'merge-continue', group: 'Branch', label: 'Continue Merge', detail: repository.status.conflicted ? 'Resolve and stage every conflicted file first' : 'Create the merge commit from the resolved index', enabled: !repository.status.conflicted && !busy, icon: 'merge' as IconName },
        { id: 'merge-abort', group: 'Branch', label: 'Abort Merge', detail: 'Stop the merge and restore its pre-merge state', enabled: !busy, icon: 'reset' as IconName },
      ] : []),
      ...(repository?.status.historyOperation ? [
        { id: 'history-operation-continue', group: 'History', label: `Continue ${repository.status.historyOperation === 'cherry-pick' ? 'Cherry-pick' : 'Revert'}`, detail: repository.status.historyNoCommit ? 'Stage resolutions and apply remaining changes without committing' : repository.status.conflicted ? 'Resolve and stage every conflicted file first' : 'Continue the interrupted history operation', enabled: !repository.status.conflicted && !(repository.status.historyNoCommit && repository.status.unstaged) && !busy, icon: (repository.status.historyOperation === 'cherry-pick' ? 'cherry-pick' : 'revert') as IconName },
        { id: 'history-operation-skip', group: 'History', label: `Skip Current ${repository.status.historyOperation === 'cherry-pick' ? 'Cherry-pick' : 'Revert'}`, detail: 'Omit the current commit and advance the operation', enabled: !repository.status.historyNoCommit && !busy, icon: 'redo' as IconName },
        { id: 'history-operation-abort', group: 'History', label: `Abort ${repository.status.historyOperation === 'cherry-pick' ? 'Cherry-pick' : 'Revert'}`, detail: 'Stop the operation and restore its original state', enabled: !busy, icon: 'reset' as IconName },
        ...(repository.status.historyNoCommit ? [{ id: 'history-operation-quit', group: 'History', label: 'Finish No-commit Replay Manually', detail: 'End the saved sequence while retaining all current files and staged changes', enabled: !busy, icon: 'check' as IconName }] : []),
      ] : []),
      ...(repository?.status.bisectInProgress ? [
        { id: 'bisect-good', group: 'History', label: 'Bisect: Mark Current Commit Good', detail: 'Continue the search using the current commit as a known-good result', enabled: !busy, icon: 'check' as IconName },
        { id: 'bisect-bad', group: 'History', label: 'Bisect: Mark Current Commit Bad', detail: 'Continue the search using the current commit as a known-bad result', enabled: !busy, icon: 'warning' as IconName },
        { id: 'bisect-skip', group: 'History', label: 'Bisect: Skip Current Commit', detail: 'Continue without classifying the current commit', enabled: !busy, icon: 'redo' as IconName },
        { id: 'bisect-reset', group: 'History', label: 'Bisect: Reset', detail: 'Stop the search and restore the original branch', enabled: !busy, icon: 'reset' as IconName },
      ] : [
        { id: 'bisect-start', group: 'History', label: 'Start Bisect from Selected Commit', detail: 'Treat the selected commit as good and the current HEAD as bad', enabled: !!this.selectedCommitData() && this.selectedCommitData()?.oid !== repository?.headOid && !repository?.status.entryCount && !repository?.status.rebaseInProgress && !busy, icon: 'history' as IconName },
      ]),
      { id: 'left-panel', group: 'View', label: 'Toggle Left Panel', detail: 'Show or hide repository references', shortcut: `${this.primaryShortcutKey} J`, enabled: !!repository, icon: 'panel-left' },
      { id: 'commit-panel', group: 'View', label: 'Toggle Commit Panel', detail: 'Show or hide commit details', shortcut: `${this.primaryShortcutKey} K`, enabled: !!repository, icon: 'panel-right' },
      { id: 'preferences', group: 'View', label: 'Open Preferences', detail: 'Customize appearance, graph, Git features, and terminal defaults', enabled: true, icon: 'settings' },
      { id: 'reset-ui', group: 'View', label: 'Restore Interface Defaults', detail: 'Review and reset appearance and layout preferences without changing Git data', enabled: true, icon: 'reset' },
      { id: 'theme-toggle', group: 'View', label: this.appTheme() === 'chronos' ? 'Switch to Midnight Contrast' : 'Switch to Chronos Dark', detail: 'Change the global application color theme', enabled: true, icon: 'eye' },
      { id: 'zoom-in', group: 'View', label: 'Increase Zoom', detail: 'Increase the interface zoom level', shortcut: `${this.primaryShortcutKey} +`, enabled: this.zoomPercent() < ZOOM_LEVELS.at(-1)!, icon: 'plus' },
      { id: 'zoom-out', group: 'View', label: 'Decrease Zoom', detail: 'Decrease the interface zoom level', shortcut: `${this.primaryShortcutKey} -`, enabled: this.zoomPercent() > ZOOM_LEVELS[0], icon: 'reset' },
      { id: 'zoom-reset', group: 'View', label: 'Reset Zoom', detail: 'Return interface zoom to 100%', shortcut: `${this.primaryShortcutKey} 0`, enabled: this.zoomPercent() !== 100, icon: 'reset' },
      { id: 'diff-view', group: 'View', label: 'Open Diff View', detail: 'Inspect the selected file in the focused diff workspace', shortcut: `${this.primaryShortcutKey} D`, enabled: !!this.activeDiff(), icon: 'file' },
      { id: 'shortcuts', group: 'View', label: 'Keyboard Shortcuts', detail: 'Open the desktop shortcut reference', shortcut: `${this.primaryShortcutKey} /`, enabled: true, icon: 'keyboard' },
      { id: 'activity-log', group: 'View', label: 'Activity Logs', detail: 'Inspect application and repository operations', enabled: !!repository, icon: 'activity' },
      { id: 'sparse-configure', group: 'Git Features', label: 'Configure Sparse Checkout', detail: repository?.sparseCheckout.enabled ? 'Edit the checked-out repository directories' : 'Limit the working tree to selected directories', enabled: !!repository && !busy, icon: 'folder-git' },
      { id: 'sparse-reapply', group: 'Git Features', label: 'Reapply Sparse Checkout', detail: 'Restore the configured sparse working tree', enabled: !!repository?.sparseCheckout.enabled && !busy, icon: 'refresh' },
      { id: 'sparse-disable', group: 'Git Features', label: 'Disable Sparse Checkout', detail: 'Restore every tracked file to the working tree', enabled: !!repository?.sparseCheckout.enabled && !busy, icon: 'folder-git' },
      { id: 'submodule-manage', group: 'Git Features', label: 'Manage Submodules', detail: 'Review, synchronize, check out, deinitialize, or remove submodules', enabled: !!repository && !busy, icon: 'repo' },
      { id: 'submodule-add', group: 'Git Features', label: 'Add Submodule', detail: 'Reference another repository at a fixed commit', enabled: !!repository && !busy, icon: 'plus' },
      { id: 'lfs-configure', group: 'Git Features', label: 'Configure Git LFS', detail: 'Open repository Git LFS settings', enabled: !!repository?.lfs.available && !busy, icon: 'server' },
    ];

    const query = this.commandQuery().trim();
    const filesOnly = this.commandPaletteScope() === 'files';
    const branchesOnly = this.commandPaletteScope() === 'branches';
    if (!repository) return filesOnly || branchesOnly ? [] : actions;
    if (branchesOnly) {
      const matches = this.branchPickerMatches(query);
      return [
        ...matches.local.map((branch): CommandAction => ({
          id: `local-branch:${branch.name}`,
          group: 'Local Branch',
          label: branch.name,
          detail: this.branchPickerDescription(branch),
          enabled: !branch.current && !busy,
          icon: 'branch',
        })),
        ...matches.remote.map((group): CommandAction => ({
          id: `remote-branch:${group.primary.name}`,
          group: 'Remote Branch',
          label: group.label,
          detail: group.locations.length === 1
            ? `Track ${group.primary.name}`
            : `Track ${group.primary.name} · ${group.locations.length} remote locations`,
          enabled: !busy,
          icon: this.remoteIcon(this.remoteLocationName(group.primary.name)),
        })),
      ].slice(0, COMMAND_DYNAMIC_RESULT_LIMIT);
    }
    if (!query) return filesOnly ? [] : actions;

    const dynamic: CommandAction[] = [];
    const append = (action: CommandAction): void => {
      if (dynamic.length >= COMMAND_DYNAMIC_RESULT_LIMIT) return;
      if (matchesCommandQuery(query, action.group, action.label, action.detail)) dynamic.push(action);
    };

    if (!filesOnly) {
    for (const candidate of this.git.repositories()) {
      const current = candidate.id === repository.id;
      append({
        id: `repository:${candidate.id}`,
        group: 'Repository',
        label: `Switch to ${this.git.repositoryLabel(candidate)}`,
        detail: `${current ? 'Current repository · ' : ''}${candidate.path}`,
        enabled: !current && !busy,
        icon: 'repo',
      });
    }
    for (const branch of repository.branches) {
      if (dynamic.length >= COMMAND_DYNAMIC_RESULT_LIMIT) break;
      append(branch.remote ? {
        id: `remote-branch:${branch.name}`,
        group: 'Checkout',
        label: `Track ${branch.name}`,
        detail: 'Create and checkout a local tracking branch',
        enabled: !busy,
        icon: this.remoteIcon(this.remoteLocationName(branch.name)),
      } : {
        id: `local-branch:${branch.name}`,
        group: 'Checkout',
        label: `Checkout ${branch.name}`,
        detail: branch.current ? 'Current branch' : branch.upstream ? `Local branch · ${branch.upstream}` : 'Local branch',
        enabled: !branch.current && !busy,
        icon: 'branch',
      });
      if (!branch.remote) {
        const encodedBranch = encodeURIComponent(branch.name);
        append({
          id: `branch-rename:${encodedBranch}`,
          group: 'Branch',
          label: `Rename ${branch.name}`,
          detail: branch.current ? 'Rename the current local branch' : 'Rename this local branch',
          enabled: !busy,
          icon: 'edit',
        });
        append({
          id: `branch-delete:${encodedBranch}`,
          group: 'Branch',
          label: `Delete ${branch.name}`,
          detail: branch.current ? 'The current branch cannot be deleted' : 'Delete this local branch',
          enabled: !branch.current && !busy,
          icon: 'trash',
        });
      }
    }
    for (const tag of repository.tags) {
      append({
        id: `tag:${tag.oid}`,
        group: 'Reference',
        label: `View tag ${tag.name}`,
        detail: `Jump to ${shortLabel(tag.oid)}`,
        enabled: true,
        icon: 'tag',
      });
    }
    for (const stash of repository.stashes) {
      append({
        id: `stash-reference:${stash.reference}`,
        group: 'Stash',
        label: `View ${stash.reference}`,
        detail: stash.message,
        enabled: true,
        icon: 'archive',
      });
      const encodedReference = encodeURIComponent(stash.reference);
      append({
        id: `stash-apply:${encodedReference}`,
        stashTarget: { repositoryId: repository.id, stash },
        group: 'Stash',
        label: `Apply ${stash.reference}`,
        detail: `${stash.message} · Keep this stash`,
        enabled: !busy,
        icon: 'archive-restore',
      });
      append({
        id: `stash-pop:${encodedReference}`,
        stashTarget: { repositoryId: repository.id, stash },
        group: 'Stash',
        label: `Pop ${stash.reference}`,
        detail: `${stash.message} · Remove after applying`,
        enabled: !busy,
        icon: 'archive-restore',
      });
    }
    for (const entry of repository.status.entries) {
      if (dynamic.length >= COMMAND_DYNAMIC_RESULT_LIMIT) break;
      const encodedPath = encodeURIComponent(entry.path);
      if (entry.conflicted) {
        append({
          id: `file-conflict:${encodedPath}`,
          group: 'File',
          label: `Open Merge Tool: ${entry.path}`,
          detail: 'Resolve the conflicted file',
          enabled: !busy,
          icon: 'merge',
        });
        continue;
      }
      const staged = entry.indexStatus !== ' ' && entry.indexStatus !== '?';
      const unstaged = entry.worktreeStatus !== ' ' || entry.indexStatus === '?';
      for (const area of [
        ...(unstaged ? [{ staged: false, label: entry.indexStatus === '?' ? 'Untracked' : 'Unstaged' }] : []),
        ...(staged ? [{ staged: true, label: 'Staged' }] : []),
      ]) {
        const state = area.staged ? '1' : '0';
        append({
          id: `file-diff:${state}:${encodedPath}`,
          group: 'File',
          label: `View Changes: ${entry.path}`,
          detail: `${area.label} file`,
          enabled: true,
          icon: 'file',
        });
        if (entry.indexStatus !== '?') {
          append({
            id: `file-history:${state}:${encodedPath}`,
            group: 'History',
            label: `File History: ${entry.path}`,
            detail: `Inspect revisions from ${repository.status.branch ?? 'HEAD'}`,
            enabled: true,
            icon: 'history',
          });
          append({
            id: `file-blame:${state}:${encodedPath}`,
            group: 'History',
            label: `Blame: ${entry.path}`,
            detail: 'Inspect line authorship at HEAD',
            enabled: true,
            icon: 'git-commit',
          });
        }
      }
    }
    }
    for (const path of this.git.trackedFileSearch()?.paths ?? []) {
      const encodedPath = encodeURIComponent(path);
      append({
        id: `tracked-history:${encodedPath}`,
        group: 'History',
        label: `File History: ${path}`,
        detail: `Inspect revisions from ${repository.status.branch ?? 'HEAD'}`,
        enabled: true,
        icon: 'history',
      });
      append({
        id: `tracked-blame:${encodedPath}`,
        group: 'History',
        label: `Blame: ${path}`,
        detail: 'Inspect line authorship at HEAD',
        enabled: true,
        icon: 'git-commit',
      });
    }
    return filesOnly ? dynamic : [...actions, ...dynamic];
  });

  protected readonly filteredCommands = computed(() => {
    const query = this.commandQuery().trim().toLocaleLowerCase();
    if (!query) {
      const actions = [...this.commandActions()].sort((left, right) => {
        const leftGroup = COMMAND_GROUP_ORDER.indexOf(left.group);
        const rightGroup = COMMAND_GROUP_ORDER.indexOf(right.group);
        return (leftGroup < 0 ? COMMAND_GROUP_ORDER.length : leftGroup)
          - (rightGroup < 0 ? COMMAND_GROUP_ORDER.length : rightGroup);
      });
      const actionsById = new Map(actions.map((action) => [action.id, action]));
      const quickIds = [...new Set([...this.recentCommandIds(), ...COMMAND_QUICK_ACTION_IDS])];
      const quickActions = quickIds
        .map((id) => actionsById.get(id))
        .filter((action): action is CommandAction => !!action?.enabled)
        .slice(0, COMMAND_QUICK_ACTION_LIMIT)
        .map((action) => ({ ...action, group: 'Quick Actions' }));
      const quickActionIds = new Set(quickActions.map((action) => action.id));
      return [...quickActions, ...actions.filter((action) => !quickActionIds.has(action.id))];
    }
    return this.commandActions()
      .filter((action) => matchesCommandQuery(query, action.group, action.label, action.detail))
      .sort((left, right) => {
        const enabledDifference = Number(right.enabled) - Number(left.enabled);
        if (enabledDifference) return enabledDifference;
        const scoreDifference = commandMatchScore(query, right) - commandMatchScore(query, left);
        if (scoreDifference) return scoreDifference;
        const leftGroup = COMMAND_GROUP_ORDER.indexOf(left.group);
        const rightGroup = COMMAND_GROUP_ORDER.indexOf(right.group);
        const groupDifference = (leftGroup < 0 ? COMMAND_GROUP_ORDER.length : leftGroup)
          - (rightGroup < 0 ? COMMAND_GROUP_ORDER.length : rightGroup);
        if (groupDifference) return groupDifference;
        return left.label.localeCompare(right.label);
      });
  });

  protected readonly canExecuteInteractiveRebase = computed(() => {
    const state = this.interactiveRebase();
    const first = state?.steps.find((step) => step.action !== 'drop');
    return !!state?.steps.length
      && (!state.root || !!first)
      && first?.action !== 'squash' && first?.action !== 'fixup'
      && state.steps.every((step) => step.action !== 'reword' || !!step.message.trim());
  });

  protected readonly isRebaseRootStop = computed(() => {
    const repository = this.git.repository();
    return !!repository?.status.rebaseEditStopped
      && repository.commits.find(commit => commit.oid === repository.headOid)?.parents.length === 0;
  });

  async ngOnInit(): Promise<void> {
    document.addEventListener('pointerdown', this.dismissWorkspace, true);
    document.addEventListener('pointerdown', this.dismissOutsideActionMenus, true);
    document.addEventListener('click', this.dismissOutsideActionMenus, true);
    await this.git.initialize();
    if (!this.git.browserPreview()) {
      try {
        this.repositoryChangeUnlisten = await events.repositoryChanged.listen(({ payload }) => {
          this.scheduleRepositoryRefresh(payload.repositoryId);
        });
      } catch {
        // Periodic status refresh and focus refresh remain available as fallbacks.
      }
    }
    this.restoreCommitDraft();
    this.loadGraphPreferences();
    if (!GIT_KHRONOS_BROWSER_PREVIEW_FIXTURES) {
      void this.applyZoom(this.zoomPercent());
      return;
    }
    // Repository-change effects clear old dialogs. Apply preview fixtures only
    // after that initial render so they cannot erase a newly opened fixture view.
    await new Promise<void>(resolve => afterNextRender(() => resolve(), { injector: this.injector }));
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('unpublished-branch')) {
      this.git.repositories.update((repositories) => repositories.map((repository) => {
        if (repository.id !== this.git.activeRepositoryId()) return repository;
        const branch = repository.branches.find((candidate) => candidate.name === 'feature/partial-staging');
        if (!branch) return repository;
        return {
          ...repository,
          headOid: branch.oid,
          status: { ...repository.status, branch: branch.name, ahead: 0, behind: 0 },
          branches: repository.branches.map((candidate) => ({
            ...candidate,
            current: candidate.fullName === branch.fullName,
          })),
        };
      }));
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('no-remotes')) {
      this.git.repositories.update((repositories) => repositories.map((repository) => repository.id === this.git.activeRepositoryId()
        ? { ...repository, remotes: [], branches: repository.branches.filter((branch) => !branch.remote) }
        : repository));
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('highlight-branch')) {
      this.hoveredReferenceOid.set(
        this.git.repository()?.branches.find((branch) => !branch.current && !branch.remote)?.oid ?? null,
      );
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('commit-search')) {
      const query = new URLSearchParams(window.location.search).get('commit-search') || 'graph';
      this.updateCommitSearch(query);
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('stash-message')) {
      this.stashMessage.set(new URLSearchParams(window.location.search).get('stash-message') || 'Park graph polish');
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('ghost-branch')) {
      const repository = this.git.repository();
      const commit = repository?.commits.find((candidate) => candidate.subject === 'Persist graph column preferences');
      if (commit) {
        this.hiddenBranches.set(['release']);
        this.selectedCommit.set(commit.oid);
        this.changesOpen.set(false);
      }
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('solo-branch')) {
      const branch = this.git.repository()?.branches.find((candidate) => !candidate.remote && !candidate.current);
      if (branch) {
        this.hiddenBranches.set([]);
        this.soloBranches.set([branch.name]);
      }
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('smart-branches')) {
      this.smartBranchVisibility.set(true);
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('branch-drop')) {
      const branches = this.git.repository()?.branches.filter((candidate) => !candidate.remote) ?? [];
      if (branches.length > 1) {
        this.branchDropMenu.set({
          source: branches.find((branch) => !branch.current)?.name ?? branches[0].name,
          target: branches.find((branch) => branch.current)?.name ?? branches[1].name,
          x: 255,
          y: 255,
        });
      }
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('pin-branch')) {
      this.pinnedBranch.set(
        this.git.repository()?.branches.find((branch) => !branch.remote && !branch.current)?.name ?? null,
      );
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('interactive-rebase')) {
      const repository = this.git.repository();
      const source = repository?.branches.find((branch) => !branch.remote && !branch.current)?.name;
      const target = repository?.branches.find((branch) => branch.current)?.name;
      const commits = repository?.commits.slice(-4, -1).reverse() ?? [];
      if (repository && source && target && commits.length) {
        const steps = commits.map((commit, index): RebaseStepView => ({
          oid: commit.oid,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          subject: commit.subject,
          message: commit.subject,
          action: index === 1 ? 'reword' : index === 2 ? 'squash' : 'pick',
        }));
        if (steps[1]) steps[1].message = 'Clarify graph column preferences\n\nKeep widths and order per repository.';
        this.interactiveRebase.set({
          repositoryId: repository.id,
          source,
          target,
          base: commits[0].parents[0] ?? '',
          original: steps.map((step) => ({ ...step, action: 'pick' })),
          steps,
        });
        this.selectedRebaseOid.set(steps[1]?.oid ?? steps[0].oid);
      }
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('merge-tool')) {
      const current = 'export function laneColor(index: number) {\n  return palette[index % palette.length];\n}\n';
      const incoming = 'export function laneColor(index: number) {\n  return graphColors.at(index % graphColors.length)!;\n}\n';
      this.git.conflictDetails.set({
        path: 'apps/desktop/src/app/graph-colors.ts',
        ancestor: 'export function laneColor(index: number) {\n  return colors[index];\n}\n',
        current,
        incoming,
        output: current,
        binary: false,
        truncated: false,
        editable: true,
        state: 'browser-conflict-preview',
        currentExists: true,
        incomingExists: true,
        submodule: false,
      });
      this.conflictOutput.set(current);
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('keyboard-shortcuts')) {
      this.openKeyboardShortcuts(null);
    }
    if (typeof window !== 'undefined') {
      const parameters = new URLSearchParams(window.location.search);
      if (parameters.has('linked-wip')) {
        const worktree = this.git.repository()?.worktrees.find((candidate) => !candidate.current && candidate.changes);
        if (worktree) this.selectWorktreeGraphRow(worktree);
      }
      if (parameters.has('worktree-dialog')) this.openWorktreeDialog();
      if (parameters.has('branch-worktree')) {
        const branch = this.git.repository()?.branches.find((candidate) => !candidate.remote && !candidate.current);
        if (branch) {
          this.contextMenu.set({
            kind: 'branch',
            oid: branch.oid,
            oids: [branch.oid],
            label: branch.name,
            x: 250,
            y: 220,
          });
          this.openContextWorktreeDialog();
        }
      }
      if (parameters.has('worktree-menu')) {
        this.worktreeMenuPath.set(this.git.repository()?.worktrees.find((worktree) => !worktree.current)?.path ?? null);
      }
      if (parameters.has('list-worktree-menu')) {
        this.worktreeMenuPath.set(this.git.repository()?.worktrees.find((worktree) => !worktree.current)?.path ?? null);
      }
      if (parameters.has('submodules') || parameters.has('submodule-menu')) {
        this.referencePaneVisibility.update((panes) => ({ ...panes, submodules: true }));
        this.submodulesOpen.set(true);
      }
      if (parameters.has('submodule-menu')) {
        this.submoduleMenuPath.set(this.git.repository()?.submodules[0]?.path ?? null);
      }
      if (parameters.has('add-submodule')) this.openSubmoduleDialog();
      if (parameters.has('pane-menu')) this.referencePaneMenu.set({ x: 185, y: 255 });
      if (parameters.has('coauthors')) {
        this.selectWip();
        this.commitMessage.set('Pair on commit panel polish');
        this.coAuthors.set([{ name: 'Leo Martin', email: 'leo@example.test' }]);
        this.coAuthorPickerOpen.set(true);
      }
      if (parameters.has('commit-template')) {
        const activeId = this.git.activeRepositoryId();
        this.git.repositories.update((repositories) => repositories.map((repository) => repository.id === activeId
          ? { ...repository, commitTemplate: 'feat: concise summary\n\nExplain the motivation and user impact.\n' }
          : repository));
        this.resetCommitForm();
        this.applyCommitTemplate();
      }
      const section = parameters.get('maximize-reference');
      if (section === 'worktrees' || section === 'local' || section === 'remote' || section === 'tags' || section === 'stashes' || section === 'submodules') {
        this.maximizeReferenceSection(section);
      }
      if (parameters.has('compare-commits')) {
        const commits = this.git.repository()?.commits.slice(0, 3) ?? [];
        if (commits.length === 3) {
          this.selectedCommits.set(commits.map((commit) => commit.oid));
          this.commitSelectionAnchor.set(commits[0].oid);
          this.selectedCommit.set(commits[0].oid);
          this.changesOpen.set(false);
          this.git.commitComparison.set({
            baseOid: commits[2].oid,
            targetOid: commits[0].oid,
            workingTree: false,
            files: [
              { status: 'M', path: 'apps/desktop/src/app/app.component.ts', previousPath: null, additions: 19, deletions: 7 },
              { status: 'A', path: 'apps/desktop/src/app/compare-panel.scss', previousPath: null, additions: 34, deletions: 0 },
            ],
          });
          this.git.selectedComparisonFile.set('apps/desktop/src/app/app.component.ts');
          this.git.comparisonFileDiff.set({
            oid: commits[0].oid,
            path: 'apps/desktop/src/app/app.component.ts',
            patch: 'diff --git a/apps/desktop/src/app/app.component.ts b/apps/desktop/src/app/app.component.ts\n--- a/apps/desktop/src/app/app.component.ts\n+++ b/apps/desktop/src/app/app.component.ts\n@@ -1,3 +1,4 @@\n export class AppComponent {\n+  readonly selectedCommits = signal<string[]>([]);\n }\n@@ -20,3 +21,4 @@\n   protected selectCommit(oid: string): void {\n-    this.selectedCommit.set(oid);\n+    this.selectedCommits.set([oid]);\n+    this.selectedCommit.set(oid);\n   }\n@@ -42,3 +44,4 @@\n   protected clearSelection(): void {\n     this.selectedCommit.set(null);\n+    this.selectedCommits.set([]);\n   }',
            truncated: false,
          });
          if (parameters.has('multi-commit-menu')) {
            this.contextMenu.set({
              kind: 'commit',
              oid: commits[0].oid,
              oids: [...commits].reverse().map((commit) => commit.oid),
              label: commits[0].subject || shortLabel(commits[0].oid),
              x: Math.max(20, window.innerWidth - 650),
              y: 230,
            });
          }
        }
      }
      const diffMode = parameters.get('diff-viewer');
      if (diffMode === 'hunk' || diffMode === 'inline' || diffMode === 'split') {
        this.diffViewMode.set(diffMode);
        this.diffViewerOpen.set(!!this.activeDiff());
      }
      const fileInsight = parameters.get('file-insight');
      if (fileInsight === 'history') {
        this.diffInsightMode.set('history');
        this.git.fileHistory.set([
          { oid: 'f19b263a8af31408d5f665caf7a5508e108c0fd1', authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: '2026-10-03T09:42:00Z', subject: 'Polish repository activity drawer' },
          { oid: '160acd10ef9e0c202cd3985aa41ee45d971bbb11', authorName: 'Leo Martin', authorEmail: 'leo@example.test', authoredAt: '2026-10-02T12:11:00Z', subject: 'Add hunk-level staging actions' },
          { oid: 'ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2', authorName: 'Alex Kim', authorEmail: 'alex@example.test', authoredAt: '2026-10-01T17:45:00Z', subject: 'Persist graph column preferences' },
        ]);
      } else if (fileInsight === 'blame') {
        this.diffInsightMode.set('blame');
        this.git.fileBlame.set([
          { path: null, lineNumber: 1, oid: '14adfbb0c1685f62cba66f031306e1e77d5c2', authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: 1791016920, summary: 'Initialize Git Khronos desktop', text: 'export class AppComponent {' },
          { path: null, lineNumber: 2, oid: 'f19b263a8af31408d5f665caf7a5508e108c0fd1', authorName: 'Leo Martin', authorEmail: 'leo@example.test', authoredAt: 1791019200, summary: 'Support commit comparison', text: '  readonly selectedCommits = signal<string[]>([]);' },
          { path: null, lineNumber: 3, oid: '14adfbb0c1685f62cba66f031306e1e77d5c2', authorName: 'Maya Chen', authorEmail: 'maya@example.test', authoredAt: 1791016920, summary: 'Initialize Git Khronos desktop', text: '}' },
        ]);
      }
      if (parameters.has('commit-file-menu')) {
        const comparison = this.git.commitComparison();
        const file = comparison?.files[0];
        if (comparison && file) {
          const paths = comparison.files.map((candidate) => candidate.path);
          this.selectedPanelFiles.set(paths);
          this.panelFileSelectionSource.set('comparison');
          this.panelFileSelectionAnchor.set(file.path);
          this.commitFileContextMenu.set({
            content: this.commitMediaSelection(file, comparison.targetOid, 'comparison'),
            x: Math.max(20, window.innerWidth - 620),
            y: 345,
            oid: comparison.targetOid,
            file,
            paths,
            source: 'comparison',
          });
        }
      }
    }
    void this.applyZoom(this.zoomPercent());
  }

  ngOnDestroy(): void {
    this.stopDiffViewportTracking?.();
    document.removeEventListener('pointerdown', this.dismissWorkspace, true);
    document.removeEventListener('pointerdown', this.dismissOutsideActionMenus, true);
    document.removeEventListener('click', this.dismissOutsideActionMenus, true);
    this.finishResize();
    this.commitListResizeObserver?.disconnect();
    this.detachGraphWheel();
    if (this.graphScrollFrame !== null) cancelAnimationFrame(this.graphScrollFrame);
    this.cancelAutoFetchTimer();
    this.cancelLiveStatusRefresh();
    if (this.trackedFileSearchTimer) clearTimeout(this.trackedFileSearchTimer);
    if (this.referenceHighlightTimer) clearTimeout(this.referenceHighlightTimer);
    if (this.referenceStackCloseTimer) clearTimeout(this.referenceStackCloseTimer);
    if (this.detailReferenceStackCloseTimer) clearTimeout(this.detailReferenceStackCloseTimer);
    if (this.tagPreviewTimer) clearTimeout(this.tagPreviewTimer);
    this.git.clearTrackedFileSearch();
    for (const timer of this.repositoryRefreshTimers.values()) clearTimeout(timer);
    this.repositoryRefreshTimers.clear();
    this.repositoryChangeUnlisten?.();
    this.git.stopIncomingRepositoryLinks();
  }

  @HostListener('document:visibilitychange')
  protected handleVisibilityChange(): void {
    if (document.hidden) {
      this.cancelAutoFetchTimer();
      this.cancelLiveStatusRefresh();
    } else {
      void this.runAutoFetchCycle(false);
      this.scheduleLiveStatusRefresh(250);
    }
  }

  @HostListener('window:online')
  protected handleOnline(): void {
    void this.runAutoFetchCycle(false);
  }

  @HostListener('window:focus')
  protected handleWindowFocus(): void {
    const repositoryId = this.git.activeRepositoryId();
    if (repositoryId) void this.git.refreshStatusInBackground(repositoryId);
    void this.runAutoFetchCycle(false);
  }

  protected openMergePreview(returnFocus: HTMLElement | null = null, source?: string, target?: string): void {
    const repository = this.git.repository();
    if (!repository?.headOid || this.git.busy()) return;
    this.contextMenu.set(null);
    this.mergePreviewRequest.set({ repositoryId: repository.id, source, target, returnFocus });
  }

  protected handleMergePreviewLoaderKey(event: KeyboardEvent): void {
    if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); this.mergePreviewLoaderClose()?.nativeElement.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeMergePreviewLoader(); }
  }

  protected closeMergePreviewLoader(): void {
    const opener = this.mergePreviewRequest()?.returnFocus;
    this.mergePreviewRequest.set(null);
    setTimeout(() => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus();
    });
  }

  protected previewContextMerge(): void {
    const menu = this.contextMenu();
    const branch = this.git.repository()?.branches.find(branch => branch.name === menu?.label);
    if (branch) this.openMergePreview(this.contextMenuReturnFocus, branch.fullName, this.git.repository()?.branches.find(candidate => candidate.current)?.fullName ?? 'HEAD');
  }

  @HostListener('document:keydown', ['$event'])
  protected handleShortcut(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.pendingCheckpointDelete()) {
      event.preventDefault();
      this.dismissCheckpointConfirmation(true);
      return;
    }
    if (this.fileToolsDialog() || this.fileContentDialog()) return;
    if (this.repositoryLinkDialog()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        const close = document.querySelector<HTMLButtonElement>('gc-repository-link-dialog [role=dialog] button[aria-label^="Close"]');
        if (close) close.click(); else this.closeRepositoryLink();
      }
      else if (event.key === 'Tab' && !(event.target instanceof Element && event.target.closest('gc-repository-link-dialog'))) {
        event.preventDefault();
        (document.querySelector<HTMLElement>('gc-repository-link-dialog [role=dialog] button:not(:disabled)') ?? this.repositoryLinkLoaderClose()?.nativeElement)?.focus();
      }
      return;
    }
    if (this.documentation.request() || this.worktreeRegistrationRequest() || this.mergeRebaseReview() || this.mergePreviewRequest() || this.workspaceCenterRequest() || this.branchWorkflowRequest()) return;
    // Disabling a focused item can move focus out of the menu. Its local
    // keydown handler may then never receive Tab, but dismissal must still work.
    if (event.key === 'Tab' && this.workspaceMenuOpen()) {
      this.dismissWorkspaceMenuForTab();
      return;
    }
    if (event.key === 'Escape' && this.pendingFileAction()) {
      event.preventDefault();
      this.dismissFileConfirmation(true);
      return;
    }
    if (event.key === 'Escape' && this.diffFileMenuOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeDiffFileMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.diffViewerOpen()) {
      event.preventDefault();
      this.closeDiffViewer();
      return;
    }
    if (this.pendingStashDelete()) return;
    if (event.key === 'Escape' && this.stashRenameTarget()) {
      event.preventDefault();
      this.stashRenameTarget.set(null);
      return;
    }
    if (event.key === 'Escape' && this.git.conflictDetails()) {
      event.preventDefault();
      this.closeConflictTool();
      return;
    }
    if (event.key === 'Escape' && this.interactiveRebase()) {
      event.preventDefault();
      this.interactiveRebase.set(null);
      this.selectedRebaseOid.set(null);
      return;
    }
    if (event.key === 'Escape' && this.branchDropMenu()) {
      event.preventDefault();
      this.dismissBranchDropMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.pendingHistoryAction()) {
      event.preventDefault();
      this.dismissHistoryConfirmation(true);
      return;
    }
    if (event.key === 'Escape' && this.pendingBisectStart()) {
      event.preventDefault();
      this.pendingBisectStart.set(null);
      return;
    }
    if (event.key === 'Escape' && this.pendingForcePush()) {
      event.preventDefault();
      this.pendingForcePush.set(false);
      return;
    }
    if (event.key === 'Escape' && this.pendingTagTarget()) {
      event.preventDefault();
      this.pendingTagTarget.set(null);
      return;
    }
    if (event.key === 'Escape' && this.pendingWorkspaceDelete()) {
      event.preventDefault();
      this.closeWorkspaceDelete();
      return;
    }
    if (event.key === 'Escape' && this.pendingLfsPrune()) {
      event.preventDefault();
      this.closeLfsPrune();
      return;
    }
    if (event.key === 'Escape' && this.pendingSparseCheckoutAction()) {
      event.preventDefault();
      this.closeSparseCheckoutConfirmation();
      return;
    }
    if (event.key === 'Escape' && this.workspaceDialogMode()) {
      event.preventDefault();
      this.closeWorkspaceDialog();
      return;
    }
    if (event.key === 'Escape' && this.repositoryDialog()) {
      event.preventDefault();
      this.closeRepositoryManager();
      return;
    }
    if (event.key === 'Escape' && this.worktreeDialogOpen()) {
      event.preventDefault();
      this.closeWorktreeDialog();
      return;
    }
    if (event.key === 'Escape' && this.pendingWorktreeAction()) {
      event.preventDefault();
      this.closeWorktreeRemoval();
      return;
    }
    if (event.key === 'Escape' && this.worktreeMenuPath()) {
      event.preventDefault();
      this.dismissSidebarActionMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.submoduleDialogOpen()) {
      event.preventDefault();
      this.closeSubmoduleDialog();
      return;
    }
    if (event.key === 'Escape' && this.remoteDialog()) {
      event.preventDefault();
      this.closeRemoteDialog();
      return;
    }
    if (event.key === 'Escape' && this.pendingRemoteRemoval()) {
      event.preventDefault();
      this.closeRemoteRemoval();
      return;
    }
    if (event.key === 'Escape' && this.submoduleMenuPath()) {
      event.preventDefault();
      this.dismissSidebarActionMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.referencePaneMenu()) {
      event.preventDefault();
      this.dismissSidebarContextMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.remoteGroupMenu()) {
      event.preventDefault();
      this.dismissSidebarContextMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.coAuthorPickerOpen()) {
      event.preventDefault();
      this.coAuthorPickerOpen.set(false);
      return;
    }
    if (event.key === 'Escape' && this.commitMessageEditing()) {
      event.preventDefault();
      this.cancelCommitMessageEdit();
      return;
    }
    if (event.key === 'Escape' && this.activityLogOpen()) {
      event.preventDefault();
      this.closeActivityLogs();
      return;
    }
    if (event.key === 'Escape' && this.recoveryHistoryOpen()) {
      event.preventDefault();
      this.closeRecoveryHistory();
      return;
    }
    if (event.key === 'Escape' && this.pendingBranchAction()) {
      event.preventDefault();
      this.dismissBranchConfirmation(true);
      return;
    }
    if (event.key === 'Escape' && this.pendingBranchRename()) {
      event.preventDefault();
      this.pendingBranchRename.set(null);
      return;
    }
    if (event.key === 'Escape' && this.pendingBranchUpstream()) {
      event.preventDefault();
      this.pendingBranchUpstream.set(null);
      return;
    }
    if (event.key === 'Escape' && this.pendingPublishBranch()) {
      event.preventDefault();
      this.pendingPublishBranch.set(null);
      return;
    }
    if (event.key === 'Escape' && this.commandPaletteOpen()) {
      event.preventDefault();
      this.closeCommandPalette();
      return;
    }
    if (event.key === 'Escape' && this.keyboardShortcutsOpen()) {
      event.preventDefault();
      this.closeKeyboardShortcuts();
      return;
    }
    if (event.key === 'Escape' && this.appMenuOpen()) {
      event.preventDefault();
      this.closeAppMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.workspaceMenuOpen()) {
      event.preventDefault();
      this.closeWorkspaceMenu(true);
      return;
    }
    if (event.key === 'Escape' && (this.contextMenu() || this.stashContextMenu())) {
      event.preventDefault();
      this.dismissGraphActionMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.fileContextMenu()) {
      event.preventDefault();
      this.dismissFileActionMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.commitFileContextMenu()) {
      event.preventDefault();
      this.dismissFileActionMenu(true);
      return;
    }
    if (event.key === 'Escape' && this.repositoryTabMenu()) {
      event.preventDefault();
      this.dismissRepositoryTabMenu(true);
      return;
    }
    if (event.key === 'Escape' && (this.repositoryTabsOpen() || this.toolbarRemoteMenuOpen() || this.toolbarCheckoutMenuOpen())) {
      event.preventDefault();
      this.repositoryTabsOpen.set(false);
      this.toolbarRemoteMenuOpen.set(false);
      this.toolbarCheckoutMenuOpen.set(false);
      return;
    }
    if (event.key === 'Escape' && this.preferencesOpen()) {
      event.preventDefault();
      this.closePreferences();
      return;
    }
    if (event.key === 'Escape' && this.identityPopoverOpen()) {
      event.preventDefault();
      this.identityPopoverOpen.set(false);
      return;
    }
    if (event.key === 'Escape' && this.authorFilterOpen()) {
      event.preventDefault();
      this.authorFilterOpen.set(false);
      return;
    }
    if (event.key === 'Escape' && this.graphSettingsOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeGraphSettings(true);
      return;
    }
    if (event.key === 'Escape' && (this.pullMenuOpen() || this.pushMenuOpen() || this.branchMenuOpen() || this.stashMenuOpen() || this.lfsMenuOpen() || this.sparseCheckoutMenuOpen() || this.moreActionsMenuOpen())) {
      event.preventDefault();
      this.closeToolbarMenus(true);
      return;
    }
    if (event.key === 'Escape' && this.workingTreeOptionsOpen()) {
      event.preventDefault();
      this.workingTreeOptionsOpen.set(false);
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLocaleLowerCase();
    const target = event.target as HTMLElement | null;
    if (event.key === 'Escape' && target?.closest('.detail-panel') && this.detailsVisible()) {
      event.preventDefault();
      this.setPanelVisibility('commit-panel', false);
      return;
    }
    if (event.key === 'Escape' && target?.closest('.sidebar') && this.sidebarVisible()) {
      event.preventDefault();
      if (this.responsiveSidebarMode) {
        this.closeResponsiveSidebar();
      } else {
        this.setPanelVisibility('left-panel', false);
      }
      return;
    }
    const editing = !!target?.closest('input, textarea, [contenteditable="true"]');
    const inFileWorkspace = !!target?.closest('.diff-workspace');
    const terminalEditing = !!target?.closest('gc-terminal-panel');
    const terminalShortcut = (event.altKey && key === 't') || (command && event.key === '`');
    if (event.key === 'F6' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (target?.closest('[aria-modal="true"], [role="menu"], [role="dialog"]')) return;
      event.preventDefault();
      this.focusWorkspaceRegion(event.shiftKey ? -1 : 1);
      return;
    }
    if (terminalEditing && !terminalShortcut) return;
    if (terminalShortcut && this.git.repository()) {
      event.preventDefault();
      this.toggleTerminal();
      return;
    }
    if (event.key === 'F11' || (event.ctrlKey && event.metaKey && key === 'f')) {
      event.preventDefault();
      void this.git.toggleFullscreen();
      return;
    }
    if (event.altKey && key === 'o' && this.git.repository()) {
      event.preventDefault();
      void this.git.openRepositoryInFileManager();
      return;
    }
    if (!editing && this.diffViewerOpen() && event.altKey && !command && (key === 'arrowup' || key === 'arrowdown')) {
      event.preventDefault();
      void this.navigateDiffFile(key === 'arrowup' ? -1 : 1);
      return;
    }
    if (!editing && this.diffViewerOpen() && !command && key === 'f7') {
      event.preventDefault();
      this.navigateDiffHunk(event.shiftKey ? -1 : 1);
      return;
    }
    if (!command) {
      if (event.altKey) return;
      if (!editing && this.interactiveRebase() && ['p', 's', 'r', 'e', 'f', 'd'].includes(event.key.toLocaleLowerCase())) {
        event.preventDefault();
        const action = ({ p: 'pick', s: 'squash', r: 'reword', e: 'edit', f: 'fixup', d: 'drop' } as const)[event.key.toLocaleLowerCase() as 'p' | 's' | 'r' | 'e' | 'f' | 'd'];
        this.setSelectedRebaseAction(action);
        return;
      }
      if (!editing && this.changesOpen() && (event.key.toLocaleLowerCase() === 's' || event.key.toLocaleLowerCase() === 'u')) {
        if (this.git.busy()) {
          event.preventDefault();
          return;
        }
        const selection = this.git.selectedWorkingTreeFile();
        if (!selection) return;
        const [area, ...pathParts] = selection.split(':');
        const path = pathParts.join(':');
        if (event.key.toLocaleLowerCase() === 's' && area === 'unstaged') {
          event.preventDefault();
          void this.git.stagePath(path);
        } else if (event.key.toLocaleLowerCase() === 'u' && area === 'staged') {
          event.preventDefault();
          void this.git.unstagePath(path);
        }
      }
      if (!editing && !inFileWorkspace && !this.interactiveRebase()) {
        const navigationKey = event.key.toLocaleLowerCase();
        if (['j', 'arrowdown', 'k', 'arrowup'].includes(navigationKey)) {
          event.preventDefault();
          const direction = ['j', 'arrowdown'].includes(navigationKey) ? 1 : -1;
          if (event.shiftKey) this.selectRelativeCommitInBranch(direction);
          else this.selectRelativeCommit(direction);
          return;
        }
        if (['h', 'arrowleft', 'l', 'arrowright'].includes(navigationKey)) {
          event.preventDefault();
          this.selectConnectedCommit(['h', 'arrowleft'].includes(navigationKey) ? -1 : 1);
        }
      }
      return;
    }

    if (key === '/') {
      event.preventDefault();
      if (this.keyboardShortcutsOpen()) this.closeKeyboardShortcuts();
      else this.openKeyboardShortcuts();
      return;
    }
    if (key === 'tab') {
      event.preventDefault();
      this.activateRelativeRepository(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.shiftKey && key === 'o') {
      event.preventDefault();
      void this.chooseRepository();
      return;
    }
    if (event.altKey && key === 'f') {
      event.preventDefault();
      this.setPanelVisibility('left-panel', true);
      queueMicrotask(() => this.branchSearch()?.nativeElement.focus());
      return;
    }
    if (event.shiftKey && key === 'm') {
      event.preventDefault();
      this.setPanelVisibility('commit-panel', true);
      this.selectWip();
      queueMicrotask(() => this.commitSummary()?.nativeElement.focus());
      return;
    }
    if (event.shiftKey && key === 'h' && this.git.repository()) {
      event.preventDefault();
      this.openCommandPalette('', 'files');
      return;
    }
    if (key === 'd') {
      if (!this.activeDiff()) return;
      event.preventDefault();
      this.openDiffViewer();
      return;
    }
    if (key === 'p') {
      event.preventDefault();
      this.openCommandPalette();
      return;
    }
    if (key === 'z' && !event.shiftKey && this.git.undoLabel()) {
      event.preventDefault();
      void this.git.undo();
      return;
    }
    if ((key === 'y' || (key === 'z' && event.shiftKey)) && this.git.redoLabel()) {
      event.preventDefault();
      void this.git.redo();
      return;
    }
    if (event.shiftKey && key === 't') {
      event.preventDefault();
      void this.reopenClosedRepository();
      return;
    }
    const workspaceShortcut = event.shiftKey && !event.altKey && /^Digit[1-9]$/.test(event.code);
    if (workspaceShortcut) {
      const workspace = this.git.workspaces()[Number(event.code.slice(-1)) - 1];
      if (workspace && workspace.id !== this.git.activeWorkspaceId()) {
        event.preventDefault();
        void this.selectWorkspace(workspace.id).then(() => {
          setTimeout(() => this.workspaceToggle()?.nativeElement.focus());
        });
      }
      return;
    }
    if (key === 't') {
      event.preventDefault();
      this.openRepositoryManager();
      return;
    }
    if (key === 'b') {
      event.preventDefault();
      this.openBranchCreator();
      return;
    }
    if (key === 'l') {
      event.preventDefault();
      if (!this.git.busy()) void this.git.remote('fetch_repository');
      return;
    }
    if (key === 'w' && this.git.activeRepositoryId()) {
      event.preventDefault();
      this.closeRepository(this.git.activeRepositoryId()!);
      return;
    }
    const favoriteShortcut = /^[1-9]$/.test(event.key) && (
      this.favoriteShortcut === '⌘ Control'
        ? event.metaKey && event.ctrlKey && !event.altKey
        : event.ctrlKey && event.altKey && !event.metaKey
    );
    if (favoriteShortcut) {
      const path = this.git.favoritePaths()[Number(event.key) - 1];
      if (path) {
        event.preventDefault();
        this.openFavoriteRepository(path);
      }
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const repository = this.git.repositories()[Number(event.key) - 1];
      if (repository) {
        event.preventDefault();
        this.activateRepository(repository.id);
      }
      return;
    }

    if (event.shiftKey && key === 's' && this.changesOpen()) {
      event.preventDefault();
      if (!this.git.busy()) void this.git.stageAll();
      return;
    }
    if (event.shiftKey && key === 'u' && this.changesOpen()) {
      event.preventDefault();
      if (!this.git.busy()) void this.git.unstageAll();
      return;
    }
    if (!editing && !inFileWorkspace && (event.key === 'Home' || (this.primaryShortcutKey === '⌘' && event.key === 'ArrowUp'))) {
      event.preventDefault();
      this.selectGraphBoundary(false);
      return;
    }
    if (!editing && !inFileWorkspace && (event.key === 'End' || (this.primaryShortcutKey === '⌘' && event.key === 'ArrowDown'))) {
      event.preventDefault();
      this.selectGraphBoundary(true);
      return;
    }
    if (['=', '+'].includes(event.key)) {
      event.preventDefault();
      void this.stepZoom(1);
      return;
    }
    if (event.key === '-') {
      event.preventDefault();
      void this.stepZoom(-1);
      return;
    }
    if (key === '0') {
      event.preventDefault();
      void this.setZoom(DEFAULT_ZOOM);
      return;
    }

    if (key === 'f') {
      if (!this.commitSearch()) return;
      event.preventDefault();
      if (event.shiftKey) this.openHistorySearch();
      else this.focusCommitSearch();
    } else if (key === 'j') {
      event.preventDefault();
      this.setPanelVisibility('left-panel', !this.sidebarVisible());
    } else if (key === 'k') {
      event.preventDefault();
      this.setPanelVisibility('commit-panel', !this.detailsVisible());
    } else if (event.key === 'Enter' && this.changesOpen()) {
      event.preventDefault();
      if (event.shiftKey) void this.stageAllAndCommit();
      else void this.commit();
    }
  }

  private focusWorkspaceRegion(direction: -1 | 1): void {
    if (!this.git.repository()) return;
    const selector = this.diffViewerOpen()
      ? this.diffInsightMode() === 'history' ? 'gc-file-history .history-list'
        : this.diffInsightMode() === 'blame' ? 'gc-file-blame .blame-lines' : '.split-diff-body, .focus-diff-view'
      : '.history-panel.workspace-focus-region';
    const central = document.querySelector<HTMLElement>(this.diffViewerOpen() ? '.diff-workspace' : selector);
    const terminal = document.querySelector<HTMLElement>('gc-terminal-panel .terminal-panel:not(.inactive)');
    const regions = [
      { element: document.querySelector<HTMLElement>('.toolbar.workspace-focus-region') },
      { element: document.querySelector<HTMLElement>('#repository-reference-panel:not(.panel-hidden)') },
      { element: central, focus: () => (central?.querySelector<HTMLElement>(selector) ?? central)?.focus({ preventScroll: true }) },
      { element: document.querySelector<HTMLElement>('#repository-commit-panel:not(.panel-hidden)') },
      { element: terminal, focus: () => (terminal?.querySelector<HTMLElement>('.terminal-host.active textarea') ?? terminal)?.focus({ preventScroll: true }) },
    ].filter((region): region is { element: HTMLElement; focus?: () => void } => !!region.element
      && !region.element.hasAttribute('inert')
      && region.element.getClientRects().length > 0);
    if (!regions.length) return;

    const active = document.activeElement;
    const current = regions.findIndex(({ element }) => element === active || element.contains(active));
    const next = current < 0
      ? (direction > 0 ? 0 : regions.length - 1)
      : (current + direction + regions.length) % regions.length;
    if (regions[next].focus) regions[next].focus();
    else regions[next].element.focus({ preventScroll: true });
  }

  @HostListener('document:click')
  protected closeContextMenu(): void {
    this.contextMenu.set(null);
    this.fileContextMenu.set(null);
    this.commitFileContextMenu.set(null);
    this.stashContextMenu.set(null);
    this.contextMenuReturnFocus = null;
    this.appMenuOpen.set(false);
    this.workspaceMenuOpen.set(false);
    this.repositoryTabsOpen.set(false);
    this.toolbarRemoteMenuOpen.set(false);
    this.toolbarCheckoutMenuOpen.set(false);
    this.repositoryTabMenu.set(null);
    this.repositoryTabMenuReturnFocus = null;
    this.remoteGroupMenu.set(null);
    this.preferencesOpen.set(false);
    this.identityPopoverOpen.set(false);
    this.authorFilterOpen.set(false);
    this.graphSettingsOpen.set(false);
    this.graphSettingsPosition.set(null);
    this.dismissBranchDropMenu();
    this.worktreeMenuPath.set(null);
    this.submoduleMenuPath.set(null);
    this.referencePaneMenu.set(null);
    this.coAuthorPickerOpen.set(false);
    this.workingTreeOptionsOpen.set(false);
    this.diffFileMenuOpen.set(false);
    this.closeToolbarMenus();
  }

  private readonly dismissWorkspace = (event: PointerEvent): void => {
    // Capture outside presses before controls can stop event propagation.
    if (!(event.target instanceof Element && event.target.closest('.workspace-control'))) {
      this.workspaceMenuOpen.set(false);
    }
  };

  @HostListener('window:blur')
  protected closeContextMenuOnBlur(): void {
    this.finishResize();
    this.closeContextMenu();
    this.commandPaletteOpen.set(false);
    this.commandPaletteOpener = null;
  }

  @HostListener('document:pointermove', ['$event'])
  protected resizePanel(event: PointerEvent): void {
    if (!this.resizePointer.matches(event)) return;
    if (this.workingTreeFileListResizeTarget) {
      this.workingTreeFileListHeightSignal(this.workingTreeFileListResizeTarget).set(Math.max(
        WORKING_TREE_FILE_LIST_MIN_HEIGHT,
        Math.min(
          WORKING_TREE_FILE_LIST_MAX_HEIGHT,
          this.workingTreeFileListResizeStartHeight + event.clientY - this.workingTreeFileListResizeStartY,
        ),
      ));
      return;
    }
    if (this.referenceResizeTarget) {
      const section = this.referenceResizeTarget;
      const height = Math.max(REFERENCE_SECTION_MIN_HEIGHT, Math.min(REFERENCE_SECTION_MAX_HEIGHT, this.referenceResizeStartHeight + event.clientY - this.referenceResizeStartY));
      const current = this.referenceSectionHeights()[section] ?? this.referenceResizeStartHeight;
      if (height === current) return;
      if (section === 'local') this.branchCreatorPreviousLocalHeight = null;
      this.referenceResizeChanged = true;
      this.referenceSectionHeights.update((heights) => ({ ...heights, [section]: height }));
      return;
    }
    if (this.columnResizeTarget) {
      const delta = event.clientX - this.resizeStartX;
      if (Math.abs(delta) >= 3) this.columnResizeMoved = true;
      this.setGraphColumnWidth(this.columnResizeTarget, this.resizeStartWidth + delta);
      this.revealResizedGraphColumn(this.columnResizeTarget);
      return;
    }
    if (!this.resizeTarget) return;
    const target = this.resizeTarget;
    const delta = event.clientX - this.resizeStartX;
    const next = this.resizeStartWidth + (target === 'sidebar' ? delta : -delta);
    const width = Math.min(this.panelMaximumWidth(target), this.clampPanelWidth(target, next));
    if (width === this.panelWidth(target)) return;
    if (target === 'sidebar') this.sidebarWidth.set(width);
    else this.detailsWidth.set(width);
    this.manuallySizedPanels.update((panels) => ({ ...panels, [target]: true }));
    this.resizePanelChanged = true;
  }

  @HostListener('document:pointerup', ['$event'])
  @HostListener('document:pointercancel', ['$event'])
  @HostListener('document:lostpointercapture', ['$event'])
  protected finishResize(event?: PointerEvent): void {
    if (!this.resizePointer.finish(event)) return;
    if (this.workingTreeFileListResizeTarget) {
      const section = this.workingTreeFileListResizeTarget;
      this.storeWorkingTreeFileListHeight(section, this.workingTreeFileListHeightSignal(section)());
      this.workingTreeFileListResizeTarget = null;
      return;
    }
    if (this.referenceResizeTarget) {
      const section = this.referenceResizeTarget;
      const height = this.referenceSectionHeights()[section];
      if (this.referenceResizeChanged && height !== null) this.storeReferenceSectionHeight(section, height);
      this.referenceResizeTarget = null;
      this.referenceResizeChanged = false;
      return;
    }
    if (this.columnResizeTarget) {
      this.storeResizedGraphColumnWidths(this.columnResizeTarget);
      this.columnResizeTarget = null;
      this.suppressColumnResizeClick = this.columnResizeMoved;
      this.columnResizeClickSuppressionUntil = this.columnResizeMoved ? performance.now() + 250 : 0;
      return;
    }
    if (!this.resizeTarget) return;
    if (this.resizePanelChanged) {
      this.storeWidth(this.resizeTarget, this.panelWidth(this.resizeTarget));
    }
    this.resizeTarget = null;
    this.resizePanelChanged = false;
  }

  protected beginResize(target: ResizablePanel, event: PointerEvent): void {
    if (!this.resizePointer.begin(event, 'col-resize')) return;
    this.resizeTarget = target;
    this.resizePanelChanged = false;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.panelWidth(target);
  }

  protected handlePanelResizeKeydown(target: ResizablePanel, event: KeyboardEvent): void {
    const limits = PANEL_WIDTH_LIMITS[target];
    const current = this.panelWidth(target);
    const step = event.shiftKey ? 32 : 10;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = current + (target === 'sidebar' ? -step : step);
        break;
      case 'ArrowRight':
        next = current + (target === 'sidebar' ? step : -step);
        break;
      case 'Home':
        next = limits.minimum;
        break;
      case 'End':
        next = limits.maximum;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const width = Math.min(this.panelMaximumWidth(target), this.clampPanelWidth(target, next));
    if (width === current) return;
    if (target === 'sidebar') this.sidebarWidth.set(width);
    else this.detailsWidth.set(width);
    this.manuallySizedPanels.update((panels) => ({ ...panels, [target]: true }));
    this.storeWidth(target, width);
  }

  protected resetPanelWidth(target: ResizablePanel, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const width = PANEL_WIDTH_LIMITS[target].default;
    if (target === 'sidebar') this.sidebarWidth.set(width);
    else this.detailsWidth.set(width);
    this.manuallySizedPanels.update((panels) => ({ ...panels, [target]: false }));
    try {
      localStorage.removeItem(`git-khronos.panel.${target}.width`);
    } catch {
      // The automatic panel width remains active for this session.
    }
  }

  protected beginColumnResize(target: GraphColumn, event: PointerEvent): void {
    if (!this.resizePointer.begin(event, 'col-resize')) return;
    this.columnResizeMoved = false;
    this.suppressColumnResizeClick = false;
    this.columnResizeClickSuppressionUntil = 0;
    this.freezeAutoFilledMessageColumn(target);
    this.columnResizeTarget = target;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.columnWidthSignal(target)();
    this.snapshotGraphColumnWidths();
  }

  protected handleGraphRowResizerClick(event: MouseEvent, oid: string): void {
    event.stopPropagation();
    if (this.consumeColumnResizeClickSuppression()) return;
    this.selectCommitWithModifiers(event, oid);
  }

  protected handleWipRowResizerClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.consumeColumnResizeClickSuppression()) return;
    this.selectWip();
  }

  @HostListener('document:click')
  protected clearColumnResizeClickSuppression(): void {
    this.suppressColumnResizeClick = false;
    this.columnResizeClickSuppressionUntil = 0;
  }

  private consumeColumnResizeClickSuppression(): boolean {
    const suppress = this.suppressColumnResizeClick
      && performance.now() <= this.columnResizeClickSuppressionUntil;
    this.suppressColumnResizeClick = false;
    this.columnResizeClickSuppressionUntil = 0;
    return suppress;
  }

  protected handleColumnResizeKeydown(target: GraphColumn, event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    this.freezeAutoFilledMessageColumn(target);
    this.snapshotGraphColumnWidths();
    const current = this.columnWidthSignal(target)();
    const step = event.shiftKey ? 32 : 8;
    let width: number;
    switch (event.key) {
      case 'ArrowLeft': width = current - step; break;
      case 'ArrowRight': width = current + step; break;
      case 'Home': width = -Infinity; break;
      case 'End': width = Infinity; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.setGraphColumnWidth(target, width);
    this.storeResizedGraphColumnWidths(target);
    this.revealResizedGraphColumn(target);
  }

  protected resetGraphColumnWidth(target: GraphColumn, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.freezeAutoFilledMessageColumn(target);
    const width = target === 'graph'
      ? this.graphMaximumWidth()
      : GRAPH_COLUMN_DEFAULT_WIDTHS[target];
    this.snapshotGraphColumnWidths();
    this.setGraphColumnWidth(target, width);
    this.storeResizedGraphColumnWidths(target);
    if (target === 'message') {
      this.messageColumnManuallyResized.set(false);
      try {
        localStorage.removeItem(this.graphPreferenceKey('column.message.width'));
      } catch {
        // The automatic width remains active for this session.
      }
    }
    this.revealResizedGraphColumn(target);
  }

  /** True when a heading is too narrow for its title, so it shows an icon with a tooltip instead. */
  protected graphColumnHeadingIconic(column: GraphColumn): boolean {
    if (column === 'author' && this.compactAuthorColumn()) return true;
    // The message minimum always fits its title, and its flexible width is not a signal.
    if (column === 'message') return false;
    const title = this.graphHeadingTitleWidths()[column];
    if (title === undefined) return false;
    return this.renderedGraphColumnWidth(column) < title + this.graphHeadingReservedWidth(column);
  }

  private graphHeadingReservedWidth(column: GraphColumn): number {
    // Left padding plus the part of the resize handle that overlaps the heading.
    const base = column === 'date' ? 10 : 14;
    if (column === 'author') return base + 27;
    if (column === 'graph' && this.pinnedGraphBranch()) return base + 20;
    return base;
  }

  private measureGraphHeadingTitles(): void {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    const style = getComputedStyle(this.graphColumns()?.nativeElement ?? document.body);
    context.font = `800 12px ${style.fontFamily}`;
    this.graphCellFontFamily.set(style.fontFamily);
    const widths: Partial<Record<GraphColumn, number>> = {};
    for (const column of DEFAULT_GRAPH_COLUMNS) {
      widths[column] = Math.ceil(context.measureText(GRAPH_COLUMN_TITLES[column]).width);
    }
    this.graphHeadingTitleWidths.set(widths);
  }

  protected graphColumnMinimumWidth(target: GraphColumn): number {
    return this.graphColumnWidthLimits(target)[0];
  }

  protected graphColumnMaximumWidth(target: GraphColumn): number {
    const maximum = this.graphColumnWidthLimits(target)[1];
    if (this.graphHorizontalScroll()) return maximum;
    const available = this.graphColumnsAvailableWidth();
    if (available <= 0) return maximum;
    const visible = this.visibleGraphColumns();
    const index = visible.indexOf(target);
    const others = visible.reduce((total, column, position) => total + (column === target ? 0
      : position < index ? this.renderedGraphColumnWidth(column) : this.graphColumnWidthLimits(column)[0]), 0);
    return Math.max(this.graphColumnWidthLimits(target)[0], Math.min(maximum, Math.floor(available - others)));
  }

  private snapshotGraphColumnWidths(): void {
    this.columnResizeStartWidths = Object.fromEntries(
      this.visibleGraphColumns().map((column) => [column, this.columnWidthSignal(column)()]),
    );
  }

  private storeResizedGraphColumnWidths(target: GraphColumn): void {
    for (const column of this.visibleGraphColumns()) {
      const start = this.columnResizeStartWidths[column];
      const width = this.columnWidthSignal(column)();
      if (column === target || (start !== undefined && Math.abs(start - width) >= 0.5)) {
        this.storeColumnWidth(column, width);
      }
    }
  }

  /**
   * Sets a column's width within its limits. With horizontal scrolling off, the columns must still
   * fit the panel: growth uses free space, then narrows only columns to its right, nearest first.
   * Columns on the left never change, and exhausted right-hand capacity clamps the dragged edge.
   */
  private setGraphColumnWidth(target: GraphColumn, requested: number): void {
    const available = this.graphColumnsAvailableWidth();
    const [minimum, maximum] = this.graphColumnWidthLimits(target);
    let width = Math.max(minimum, Math.min(maximum, requested));
    if (this.graphHorizontalScroll() || available <= 0) {
      this.columnWidthSignal(target).set(width);
      return;
    }
    const visible = this.visibleGraphColumns();
    const start = (column: GraphColumn) => this.columnResizeStartWidths[column] ?? this.columnWidthSignal(column)();
    const index = visible.indexOf(target);
    const donors = visible.slice(index + 1);
    const others = visible.filter((column) => column !== target)
      .reduce((total, column) => total + start(column), 0);
    width = Math.min(width, this.graphColumnMaximumWidth(target));
    let needed = width + others - available;
    const widths = new Map(donors.map((column) => [column, start(column)]));
    for (const column of donors) {
      if (needed <= 0) break;
      const cut = Math.min(needed, Math.max(0, start(column) - this.graphColumnWidthLimits(column)[0]));
      widths.set(column, start(column) - cut);
      needed -= cut;
    }
    if (needed > 0) width = Math.max(minimum, width - needed);
    for (const [column, value] of widths) this.columnWidthSignal(column).set(value);
    this.columnWidthSignal(target).set(width);
  }

  protected setGraphHorizontalScroll(enabled: boolean): void {
    this.graphHorizontalScroll.set(enabled);
    try {
      localStorage.setItem(GRAPH_HORIZONTAL_SCROLL_KEY, String(enabled));
    } catch {
      // The preference remains active for this session.
    }
    if (!enabled) {
      const list = this.commitListElement;
      if (list) {
        list.scrollLeft = 0;
        this.syncGraphHeader(list);
      }
    }
  }

  protected messageColumnAriaWidth(): number {
    return Math.round(this.renderedGraphColumnWidth('message'));
  }

  protected graphColumnResizeTitle(target: GraphColumn): string {
    return target === 'graph'
      ? 'Drag or use arrow keys to resize · Shift for larger steps · Double-click to fit all branch paths'
      : 'Drag or use arrow keys to resize · Shift for larger steps · Double-click to reset';
  }

  /**
   * Keeps the edge being resized in view, scrolling the history horizontally when the columns overflow.
   * Only the dragged edge is followed, so a widening column grows under the pointer.
   */
  private revealResizedGraphColumn(target: GraphColumn): void {
    // Measure after Angular renders the new widths.
    afterNextRender(() => {
      const list = this.commitListElement;
      const header = this.graphColumns()?.nativeElement;
      if (!list || !header || list.scrollWidth <= list.clientWidth + 1) return;
      const headings = [...header.querySelectorAll<HTMLElement>(':scope > .draggable-column')]
        .sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
      const index = headings.findIndex((heading) => heading.querySelector(`[aria-label="${GRAPH_COLUMN_RESIZE_LABELS[target]}"]`));
      if (index < 0) return;
      const column = headings[index];
      const origin = header.getBoundingClientRect().left - header.scrollLeft;
      const edge = column.getBoundingClientRect().right - origin
        - (column.classList.contains('trailing-column') ? 26 : 0);
      const visibleRight = list.clientWidth - 48;
      let scrollLeft = list.scrollLeft;
      scrollLeft = Math.max(scrollLeft, edge - visibleRight);
      scrollLeft = Math.min(scrollLeft, edge - 24);
      scrollLeft = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, Math.round(scrollLeft)));
      if (Math.abs(scrollLeft - list.scrollLeft) < 1) return;
      list.scrollLeft = scrollLeft;
      this.syncGraphHeader(list);
    }, { injector: this.injector });
  }

  protected graphColumnAriaWidth(column: GraphColumn): number {
    return Math.round(this.renderedGraphColumnWidth(column));
  }

  private renderedGraphColumnWidth(column: GraphColumn): number {
    const width = this.columnWidthSignal(column)();
    if (column !== 'message' || this.messageColumnManuallyResized()) return width;
    // The automatic message track takes whatever the other columns leave of the panel.
    const available = this.graphColumnsAvailableWidth();
    const others = this.visibleGraphColumns().filter((candidate) => candidate !== 'message')
      .reduce((total, candidate) => total + this.columnWidthSignal(candidate)(), 0);
    return Math.max(width, available > 0 ? available - others : 0);
  }

  private freezeAutoFilledMessageColumn(target: GraphColumn): void {
    if (this.messageColumnManuallyResized()) return;
    if (!this.showMessageColumn()) return;
    // Freeze the auto-filled track so resizing one column cannot resize another. Its track width is
    // computed rather than measured: a trailing heading's box also spans the actions lane.
    this.messageColumnWidth.set(this.renderedGraphColumnWidth('message'));
    this.messageColumnManuallyResized.set(true);
    if (target !== 'message') this.storeColumnWidth('message', this.messageColumnWidth());
  }

  protected beginReferenceSectionResize(section: ReferenceSection, event: PointerEvent): void {
    if (this.maximizedReferenceSection() || !this.referenceSectionOpen(section)) return;
    if (!this.resizePointer.begin(event, 'row-resize')) return;
    const container = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.reference-section');
    this.referenceResizeTarget = section;
    this.referenceResizeChanged = false;
    this.referenceResizeStartY = event.clientY;
    this.referenceResizeStartHeight = container?.getBoundingClientRect().height
      ?? this.referenceSectionHeights()[section]
      ?? REFERENCE_SECTION_FALLBACK_HEIGHT;
  }

  protected workingTreeFileListHeight(section: WorkingTreeFileListSection): number {
    return this.workingTreeFileListHeightSignal(section)();
  }

  protected beginWorkingTreeFileListResize(section: WorkingTreeFileListSection, event: PointerEvent): void {
    if (!this.resizePointer.begin(event, 'row-resize')) return;
    this.workingTreeFileListResizeTarget = section;
    this.workingTreeFileListResizeStartY = event.clientY;
    this.workingTreeFileListResizeStartHeight = this.workingTreeFileListHeightSignal(section)();
  }

  protected handleWorkingTreeFileListResizeKeydown(section: WorkingTreeFileListSection, event: KeyboardEvent): void {
    const step = event.shiftKey ? 32 : 10;
    const heightSignal = this.workingTreeFileListHeightSignal(section);
    let height: number;
    switch (event.key) {
      case 'ArrowUp': height = heightSignal() - step; break;
      case 'ArrowDown': height = heightSignal() + step; break;
      case 'Home': height = WORKING_TREE_FILE_LIST_MIN_HEIGHT; break;
      case 'End': height = WORKING_TREE_FILE_LIST_MAX_HEIGHT; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    height = Math.max(WORKING_TREE_FILE_LIST_MIN_HEIGHT, Math.min(WORKING_TREE_FILE_LIST_MAX_HEIGHT, height));
    heightSignal.set(height);
    this.storeWorkingTreeFileListHeight(section, height);
  }

  protected resetWorkingTreeFileListHeight(section: WorkingTreeFileListSection, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.workingTreeFileListHeightSignal(section).set(WORKING_TREE_FILE_LIST_DEFAULT_HEIGHT);
    try {
      localStorage.removeItem(`git-khronos.working-tree.${section}-file-list-height`);
    } catch {
      // The default remains active for this session when storage is unavailable.
    }
  }

  protected prepareReferenceSectionResize(section: ReferenceSection, event: FocusEvent): void {
    if (this.maximizedReferenceSection() || !this.referenceSectionOpen(section)) return;
    const height = this.measureReferenceSectionHeight(event.currentTarget, section);
    this.referenceSectionMeasuredHeights.update((heights) => ({ ...heights, [section]: height }));
  }

  protected handleReferenceSectionResizeKeydown(
    section: ReferenceSection,
    event: KeyboardEvent,
  ): void {
    if (this.maximizedReferenceSection() || !this.referenceSectionOpen(section)) return;
    const current = this.referenceSectionHeights()[section]
      ?? this.measureReferenceSectionHeight(event.currentTarget, section);
    const step = event.shiftKey ? 32 : 10;
    let height: number;
    switch (event.key) {
      case 'ArrowUp': height = current - step; break;
      case 'ArrowDown': height = current + step; break;
      case 'Home': height = REFERENCE_SECTION_MIN_HEIGHT; break;
      case 'End': height = REFERENCE_SECTION_MAX_HEIGHT; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    height = Math.max(REFERENCE_SECTION_MIN_HEIGHT, Math.min(REFERENCE_SECTION_MAX_HEIGHT, height));
    if (height === current) return;
    if (section === 'local') this.branchCreatorPreviousLocalHeight = null;
    this.referenceSectionHeights.update((heights) => ({ ...heights, [section]: height }));
    this.referenceSectionMeasuredHeights.update((heights) => ({ ...heights, [section]: height }));
    this.storeReferenceSectionHeight(section, height);
  }

  protected resetReferenceSectionHeight(section: ReferenceSection, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (section === 'local') this.branchCreatorPreviousLocalHeight = null;
    const target = event.currentTarget;
    this.referenceSectionHeights.update((heights) => ({ ...heights, [section]: null }));
    try {
      localStorage.removeItem(`git-khronos.sidebar.section.${section}.height`);
    } catch {
      // Automatic sizing remains restored for this session.
    }
    queueMicrotask(() => {
      const height = this.measureReferenceSectionHeight(target, section);
      this.referenceSectionMeasuredHeights.update((heights) => ({ ...heights, [section]: height }));
    });
  }

  protected referenceSectionAriaHeight(section: ReferenceSection): number {
    return Math.round(this.referenceSectionHeights()[section]
      ?? this.referenceSectionMeasuredHeights()[section]);
  }

  protected referenceSectionHeight(section: ReferenceSection): number | null {
    return this.maximizedReferenceSection() || !this.referenceSectionOpen(section)
      ? null
      : this.referenceSectionHeights()[section];
  }

  private measureReferenceSectionHeight(target: EventTarget | null, section: ReferenceSection): number {
    const measured = (target as HTMLElement | null)
      ?.closest<HTMLElement>('.reference-section')
      ?.getBoundingClientRect().height;
    const fallback = this.referenceSectionHeights()[section]
      ?? this.referenceSectionMeasuredHeights()[section]
      ?? REFERENCE_SECTION_FALLBACK_HEIGHT;
    return Math.round(Math.max(
      REFERENCE_SECTION_MIN_HEIGHT,
      Math.min(REFERENCE_SECTION_MAX_HEIGHT, measured || fallback),
    ));
  }

  protected startGraphColumnDrag(event: DragEvent, column: GraphColumn): void {
    this.draggedGraphColumn.set(column);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', column);
    }
  }

  protected dropGraphColumn(event: DragEvent, target: GraphColumn): void {
    event.preventDefault();
    const source = (this.draggedGraphColumn() ?? event.dataTransfer?.getData('text/plain')) as GraphColumn | null;
    if (!source || source === target || !DEFAULT_GRAPH_COLUMNS.includes(source)) return;
    // The dragged column takes the target's place: moving right lands after it, moving left before it.
    this.graphColumnOrder.update((columns) => {
      const movingRight = columns.indexOf(source) < columns.indexOf(target);
      const reordered = columns.filter((column) => column !== source);
      reordered.splice(reordered.indexOf(target) + (movingRight ? 1 : 0), 0, source);
      return reordered;
    });
    this.draggedGraphColumn.set(null);
    this.storeGraphColumnOrder();
  }

  protected moveGraphColumn(column: GraphColumn, direction: -1 | 1): void {
    const index = this.graphColumnOrder().indexOf(column);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.graphColumnOrder().length) return;
    this.graphColumnOrder.update((columns) => {
      const reordered = [...columns];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
    this.storeGraphColumnOrder();
  }

  protected graphColumnOrderIndex(column: GraphColumn): number {
    return this.graphColumnOrder().indexOf(column);
  }

  protected graphColumnVisible(column: GraphColumn): boolean {
    return this.isGraphColumnVisible(column);
  }

  private readonly graphColumnPositions = computed(() => {
    const positions = new Map<GraphColumn, number>();
    this.graphColumnOrder()
      .filter((candidate) => this.isGraphColumnVisible(candidate))
      .forEach((column, index) => positions.set(column, index));
    return positions;
  });

  protected graphColumnPosition(column: GraphColumn): number {
    return this.graphColumnPositions().get(column) ?? -1;
  }

  protected toggleGraphSettings(event: MouseEvent): void {
    event.stopPropagation();
    this.graphSettingsPosition.set(null);
    const open = !this.graphSettingsOpen();
    this.graphSettingsOpen.set(open);
    if (open) window.setTimeout(() => this.graphSettingsPanel()?.nativeElement.focus(), 0);
  }

  protected closeGraphSettings(returnFocus = false): void {
    this.graphSettingsOpen.set(false);
    this.graphSettingsPosition.set(null);
    if (returnFocus) queueMicrotask(() => this.graphSettingsToggle()?.nativeElement.focus());
  }

  protected openGraphSettingsContext(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('settings');
    this.graphSettingsPosition.set({
      x: Math.max(
        GRAPH_SETTINGS_VIEWPORT_GUTTER,
        Math.min(event.clientX, window.innerWidth - GRAPH_SETTINGS_PANEL_WIDTH - GRAPH_SETTINGS_VIEWPORT_GUTTER),
      ),
      y: Math.max(GRAPH_SETTINGS_VIEWPORT_GUTTER, Math.min(event.clientY, window.innerHeight - 230)),
    });
    this.graphSettingsOpen.set(true);
    queueMicrotask(() => requestAnimationFrame(() => {
      const element = this.graphSettingsPanel()?.nativeElement;
      if (!element || !this.graphSettingsOpen() || !this.graphSettingsPosition()) return;
      this.graphSettingsPosition.set(this.fittedMenuPosition(element, { x: event.clientX, y: event.clientY }));
      element.focus();
    }));
  }

  protected toggleAuthorFilter(event: MouseEvent): void {
    event.stopPropagation();
    this.graphSettingsOpen.set(false);
    this.graphSettingsPosition.set(null);
    const open = !this.authorFilterOpen();
    if (open) this.authorFilterPosition.set(this.authorFilterMenuPosition(event.currentTarget as HTMLElement | null));
    this.authorFilterOpen.set(open);
    if (open) {
      this.authorFilterQuery.set('');
      window.setTimeout(() => this.authorFilterSearch()?.nativeElement.focus({ preventScroll: true }), 0);
    }
  }

  /** Right-aligns the menu with its toggle, kept inside the graph header's width. */
  private authorFilterMenuPosition(toggle: HTMLElement | null): { x: number; y: number } {
    const header = toggle?.closest<HTMLElement>('.graph-header');
    if (!toggle || !header) return { x: 0, y: 25 };
    const headerBox = header.getBoundingClientRect();
    const toggleBox = toggle.getBoundingClientRect();
    const menuWidth = 260;
    const x = Math.max(0, Math.min(headerBox.width - menuWidth, toggleBox.right - headerBox.left - menuWidth));
    return { x: Math.round(x), y: Math.round(toggleBox.bottom - headerBox.top + 2) };
  }

  protected selectAuthorFilter(email: string | null): void {
    this.authorFilter.set(email);
    this.authorFilterQuery.set('');
    this.authorFilterOpen.set(false);
  }

  protected handleAuthorFilterKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.authorFilterQuery.set('');
      this.authorFilterOpen.set(false);
      return;
    }
    if (event.key !== 'Enter') return;
    const firstMatch = this.authorFilterMatches()[0];
    if (!firstMatch) return;
    event.preventDefault();
    this.selectAuthorFilter(firstMatch.email);
  }

  protected togglePreferences(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.preferencesOpen();
    if (open) this.openPreferences('general', this.preferencesToggle()?.nativeElement ?? null);
    else this.closePreferences();
  }

  protected openPreferences(section: PreferencesSection = 'general', returnFocus?: HTMLElement | null): void {
    let opener = returnFocus === undefined && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : returnFocus ?? null;
    if (opener?.closest('.app-menu-popover')) opener = this.appMenuToggle()?.nativeElement ?? opener;
    this.preferencesOpener = opener;
    this.identityPopoverOpen.set(false);
    this.resetUiConfirmation.set(false);
    this.preferencesSection.set(section);
    this.loadSparseCheckoutDraft();
    this.preferencesOpen.set(true);
  }

  protected closePreferences(restoreFocus = true): void {
    const opener = this.preferencesOpener;
    this.preferencesOpen.set(false);
    this.preferencesOpener = null;
    if (restoreFocus) this.restoreDialogFocus(opener);
  }

  protected async restoreInterfaceDefaults(): Promise<void> {
    this.resetUiConfirmation.set(false);
    this.setAppTheme('chronos');
    await this.setZoom(DEFAULT_ZOOM);
    this.showToolbarLabels.set(true);
    this.showWorktreeTabGroups.set(true);
    this.highlightRelatedCommits.set(true);
    this.sidebarVisible.set(true);
    this.detailsVisible.set(true);
    this.workingTreeViewMode.set('path');
    this.workingTreeSortAscending.set(true);
    this.sidebarWidth.set(PANEL_WIDTH_LIMITS.sidebar.default);
    this.detailsWidth.set(PANEL_WIDTH_LIMITS.details.default);
    this.manuallySizedPanels.set({ sidebar: false, details: false });
    this.referencePaneVisibility.set({
      worktrees: true,
      remote: true,
      pullRequests: true,
      tags: true,
      stashes: true,
      submodules: true,
    });
    this.worktreesOpen.set(true);
    this.localBranchesOpen.set(true);
    this.remoteBranchesOpen.set(true);
    this.pullRequestsOpen.set(false);
    this.tagsOpen.set(false);
    this.stashesOpen.set(false);
    this.submodulesOpen.set(true);
    this.referenceSectionHeights.set({
      worktrees: null,
      local: null,
      remote: null,
      tags: null,
      stashes: null,
      submodules: null,
    });
    this.graphColumnOrder.set([...DEFAULT_GRAPH_COLUMNS]);
    for (const column of DEFAULT_GRAPH_COLUMNS) {
      this.columnVisibilitySignal(column).set(this.defaultGraphColumnVisible(column));
    }
    this.graphDateFormat.set('compact');
    this.authorMarkerStyle.set('initials');
    this.smartBranchVisibility.set(false);
    this.compactGraphColumn.set(false);
    this.showGraphScrollMarkers.set(true);
    this.branchColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.branch);
    this.graphColumnWidth.set(graphColumnLayout(false).defaultWidth);
    this.messageColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.message);
    this.authorColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.author);
    this.dateColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.date);
    this.shaColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.sha);
    this.hiddenBranches.set([]);
    this.soloBranches.set([]);
    this.pinnedBranch.set(null);
    this.remoteLocationIcons.set({});
    this.collapsedRemoteLocations.set([]);
    this.selectedRemoteName.set('');
    this.diffViewMode.set('hunk');
    this.diffWordWrap.set(false);
    this.diffFontSize.set(13);
    this.diffTabSize.set(4);
    this.terminalFontFamily.set('"SFMono-Regular", Consolas, "Liberation Mono", monospace');
    this.terminalFontSize.set(13);
    this.terminalLineHeight.set(1.25);
    this.terminalCursorStyle.set('block');
    try {
      const exactKeys = [
        'git-khronos.ui.theme',
        'git-khronos.ui.zoom',
        'git-khronos.ui.toolbar-labels',
        'git-khronos.ui.worktree-tab-groups',
        'git-khronos.ui.highlight-related-commits',
        'git-khronos.ui.left-panel',
        'git-khronos.ui.commit-panel',
        'git-khronos.ui.working-tree-view',
        'git-khronos.ui.working-tree-sort-ascending',
        'git-khronos.ui.graph-date-format',
        'git-khronos.ui.author-marker-style',
        'git-khronos.ui.pane-worktrees',
        'git-khronos.ui.pane-remote',
        'git-khronos.ui.pane-pull-requests',
        'git-khronos.ui.pane-tags',
        'git-khronos.ui.pane-stashes',
        'git-khronos.ui.pane-submodules',
        'git-khronos.ui.section-worktrees-open',
        'git-khronos.ui.section-local-open',
        'git-khronos.ui.section-remote-open',
        'git-khronos.ui.section-pull-requests-open',
        'git-khronos.ui.section-tags-open',
        'git-khronos.ui.section-stashes-open',
        'git-khronos.ui.section-submodules-open',
        'git-khronos.panel.sidebar.width',
        'git-khronos.panel.details.width',
        'git-khronos.diff.view-mode',
        'git-khronos.diff.word-wrap',
        'git-khronos.diff.font-size',
        'git-khronos.diff.tab-size',
        'git-khronos.terminal.font-family',
        'git-khronos.terminal.font-size',
        'git-khronos.terminal.line-height',
        'git-khronos.terminal.cursor-style',
      ];
      for (const key of exactKeys) localStorage.removeItem(key);
      for (const section of ['worktrees', 'local', 'remote', 'tags', 'stashes', 'submodules']) {
        localStorage.removeItem(`git-khronos.sidebar.section.${section}.height`);
      }
      const graphPrefix = this.graphPreferenceKey('');
      const graphKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => !!key && key.startsWith(graphPrefix));
      for (const key of graphKeys) localStorage.removeItem(key);
    } catch {
      // Restored defaults remain active for this session when storage is unavailable.
    }
  }

  protected toggleToolbarRemoteMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.toolbarCheckoutMenuOpen.set(false);
    const open = !this.toolbarRemoteMenuOpen();
    this.toolbarRemoteMenuOpen.set(open);
    if (open) window.setTimeout(() => document.querySelector<HTMLButtonElement>(
      '.remote-nav-menu [aria-checked="true"], .remote-nav-menu [role="menuitem"]',
    )?.focus(), 0);
  }

  protected toggleWorkingTreeOptions(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.workingTreeOptionsOpen();
    this.workingTreeOptionsOpen.set(open);
    if (open) {
      window.setTimeout(() => this.workingTreeOptionsMenu()?.nativeElement
        .querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
        ?.focus(), 0);
    }
  }

  protected handleWorkingTreeOptionsKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeWorkingTreeOptions(true);
      return;
    }
    if (event.key === 'Tab') {
      this.workingTreeOptionsOpen.set(false);
      return;
    }
    this.navigateToolbarMenu(event);
  }

  private closeWorkingTreeOptions(restoreFocus = false): void {
    this.workingTreeOptionsOpen.set(false);
    if (restoreFocus) queueMicrotask(() => this.workingTreeOptionsToggle()?.nativeElement.focus());
  }

  protected selectToolbarRemote(remote: string): void {
    if (!this.git.repository()?.remotes.some((candidate) => candidate.name === remote)) return;
    this.selectedRemoteName.set(remote);
    this.toolbarRemoteMenuOpen.set(false);
    try {
      localStorage.setItem(this.graphPreferenceKey('selected-remote'), remote);
    } catch {
      // The selected remote remains active for this session.
    }
  }

  protected handleToolbarRemoteMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeToolbarRemoteMenu(true);
      return;
    }
    this.navigateToolbarMenu(event);
  }

  private closeToolbarRemoteMenu(restoreFocus = false): void {
    this.toolbarRemoteMenuOpen.set(false);
    if (restoreFocus) queueMicrotask(() => this.toolbarRemoteToggle()?.nativeElement.focus());
  }

  protected toggleToolbarCheckoutMenu(event: MouseEvent): void {
    event.stopPropagation();
    if (this.git.busy()) return;
    this.toolbarRemoteMenuOpen.set(false);
    const open = !this.toolbarCheckoutMenuOpen();
    this.toolbarCheckoutMenuOpen.set(open);
    if (open) {
      this.toolbarBranchQuery.set('');
      window.setTimeout(() => this.toolbarBranchSearch()?.nativeElement.focus(), 0);
    }
  }

  protected handleToolbarBranchSearchKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeToolbarCheckoutMenu(true);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    const matches = this.toolbarBranchMatches();
    const query = this.toolbarBranchQuery().trim().toLocaleLowerCase();
    const remoteLocations = matches.remote.flatMap((group) => group.locations);
    const branch = matches.local.find((candidate) => candidate.name.toLocaleLowerCase() === query)
      ?? remoteLocations.find((candidate) => candidate.name.toLocaleLowerCase() === query)
      ?? matches.local[0]
      ?? matches.remote[0]?.primary;
    if (branch) void this.checkoutFromBranchPicker(branch);
    else if (this.toolbarBranchCreationName()) this.createBranchFromPicker();
  }

  protected handleToolbarBranchMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeToolbarCheckoutMenu(true);
      return;
    }
    this.navigateToolbarMenu(event);
  }

  private navigateToolbarMenu(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const menu = event.currentTarget as HTMLElement;
    const items = Array.from(menu.children).filter((child): child is HTMLButtonElement =>
      child instanceof HTMLButtonElement && !child.disabled && !child.hidden);
    if (!items.length) return;
    const focused = (event.target as HTMLElement | null)?.closest('button');
    const current = items.indexOf(focused as HTMLButtonElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  }

  private closeToolbarCheckoutMenu(restoreFocus = false): void {
    this.toolbarCheckoutMenuOpen.set(false);
    this.toolbarBranchQuery.set('');
    if (restoreFocus) queueMicrotask(() => this.toolbarBranchToggle()?.nativeElement.focus());
  }

  protected clearToolbarBranchSearch(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.toolbarBranchQuery.set('');
    queueMicrotask(() => this.toolbarBranchSearch()?.nativeElement.focus());
  }

  protected createBranchFromPicker(): void {
    const suggestedName = this.toolbarBranchCreationName();
    this.closeToolbarCheckoutMenu();
    this.openBranchCreator(suggestedName || undefined, this.toolbarBranchToggle()?.nativeElement ?? null);
  }

  protected async checkoutFromBranchPicker(branch: Branch): Promise<void> {
    if (this.git.busy()) return;
    const picker = document.getElementById('branch-picker');
    const repositoryId = this.git.repository()?.id;
    const restoreFocus = () => queueMicrotask(() => {
      if (this.git.repository()?.id === repositoryId && this.canRestoreFocusFrom(picker)) {
        this.toolbarBranchToggle()?.nativeElement.focus({ preventScroll: true });
      }
    });
    this.closeToolbarCheckoutMenu();
    if (branch.current) {
      restoreFocus();
      return;
    }
    if (branch.remote) await this.git.checkoutRemote(branch.name);
    else await this.git.checkout(branch.name);
    restoreFocus();
  }

  protected toggleIdentityPopover(event: MouseEvent): void {
    event.stopPropagation();
    this.preferencesOpen.set(false);
    const open = !this.identityPopoverOpen();
    if (open) this.resetIdentityDraft();
    else this.identityEditing.set(false);
    this.identityPopoverOpen.set(open);
  }

  protected editRepositoryIdentity(): void {
    this.resetIdentityDraft();
    this.identityEditing.set(true);
  }

  protected cancelRepositoryIdentityEdit(): void {
    this.resetIdentityDraft();
    this.identityEditing.set(false);
  }

  protected async saveRepositoryIdentity(): Promise<void> {
    const name = this.identityName().trim();
    const email = this.identityEmail().trim();
    if (!name || !email || this.git.busy()) return;
    await this.git.setRepositoryIdentity(name, email);
    if (!this.git.error()) {
      this.identityName.set(name);
      this.identityEmail.set(email);
      this.identityEditing.set(false);
    }
  }

  private resetIdentityDraft(): void {
    const identity = this.git.repository()?.identity;
    this.identityName.set(identity?.name ?? '');
    this.identityEmail.set(identity?.email ?? '');
  }

  protected toggleActivityNotifications(event?: MouseEvent): void {
    if (this.activityLogOpen()) {
      this.closeActivityLogs();
      return;
    }
    const repositoryId = this.git.activeRepositoryId();
    const latestError = [...this.git.activityLogs()].reverse().find((entry) =>
      entry.status === 'error' && (entry.repositoryId === null || entry.repositoryId === repositoryId),
    );
    this.showActivityLogs(
      latestError?.repositoryId ? 'repository' : 'application',
      event?.currentTarget instanceof HTMLElement ? event.currentTarget : null,
    );
  }

  private showActivityLogs(tab: ActivityLogTab, opener: HTMLElement | null = null): void {
    this.activityLogOpener = opener;
    this.activityLogTab.set(tab);
    this.activityLogOpen.set(true);
  }

  protected closeActivityLogs(): void {
    const opener = this.activityLogOpener;
    this.activityLogOpen.set(false);
    this.activityLogOpener = null;
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  protected setUiPreference(
    preference: 'toolbar-labels' | 'worktree-tab-groups' | 'highlight-related-commits',
    value: boolean,
  ): void {
    if (preference === 'toolbar-labels') this.showToolbarLabels.set(value);
    else if (preference === 'worktree-tab-groups') this.showWorktreeTabGroups.set(value);
    else this.highlightRelatedCommits.set(value);
    try {
      localStorage.setItem(`git-khronos.ui.${preference}`, String(value));
    } catch {
      // UI preferences remain active for this session.
    }
  }

  protected setGraphDateFormat(value: string): void {
    const format: GraphDateFormat = value === 'relative' || value === 'iso' ? value : 'compact';
    this.graphDateFormat.set(format);
    try {
      localStorage.setItem('git-khronos.ui.graph-date-format', format);
    } catch {
      // Date formatting remains active for this session.
    }
  }

  protected setAuthorMarkerStyle(value: string): void {
    const style: AuthorMarkerStyle = value === 'color' ? 'color' : 'initials';
    this.authorMarkerStyle.set(style);
    try {
      localStorage.setItem('git-khronos.ui.author-marker-style', style);
    } catch {
      // Author marker choice remains active for this session.
    }
  }

  protected setAutoFetchInterval(value: number | string): void {
    const candidate = Number(value) as AutoFetchIntervalMinutes;
    const interval = AUTO_FETCH_INTERVALS.includes(candidate) ? candidate : 5;
    this.autoFetchIntervalMinutes.set(interval);
    try {
      localStorage.setItem('git-khronos.remote.auto-fetch-minutes', String(interval));
    } catch {
      // Auto-fetch scheduling remains active for this session.
    }
  }

  protected async initializeLfs(): Promise<void> {
    await this.git.initializeLfs();
  }

  protected async addLfsPattern(): Promise<void> {
    const pattern = this.lfsPattern().trim();
    if (!pattern) return;
    await this.git.trackLfsPattern(pattern, this.lfsPatternLockable());
    if (!this.git.error()) this.lfsPattern.set('');
  }

  protected configureLfsForContextFile(): void {
    const menu = this.fileContextMenu();
    if (!menu) return;
    const fileName = menu.path.split('/').at(-1) ?? menu.path;
    const extension = fileName.includes('.') ? fileName.split('.').at(-1) : null;
    this.lfsPattern.set(extension ? `*.${extension}` : menu.path);
    this.fileContextMenu.set(null);
    this.openPreferences('git');
  }

  protected openSparseCheckoutPreferences(): void {
    this.sparseCheckoutMenuOpen.set(false);
    this.openPreferences('git');
  }

  protected requestSparseCheckoutUpdate(returnFocus?: HTMLElement | null): void {
    const opener = this.captureSecondaryConfirmationOpener(returnFocus);
    this.closePreferences(false);
    this.secondaryConfirmationOpener = opener;
    this.pendingSparseCheckoutAction.set('set');
  }

  protected requestSparseCheckoutDisable(returnFocus?: HTMLElement | null): void {
    const opener = this.captureSecondaryConfirmationOpener(returnFocus);
    this.sparseCheckoutMenuOpen.set(false);
    this.toolbarMenuReturnFocus = null;
    this.closePreferences(false);
    this.secondaryConfirmationOpener = opener;
    this.pendingSparseCheckoutAction.set('disable');
  }

  protected closeSparseCheckoutConfirmation(): void {
    this.pendingSparseCheckoutAction.set(null);
    this.finishSecondaryConfirmation();
  }

  protected async confirmSparseCheckoutAction(): Promise<void> {
    const action = this.pendingSparseCheckoutAction();
    if (!action) return;
    this.closeSparseCheckoutConfirmation();
    if (action === 'disable') {
      await this.git.disableSparseCheckout();
      return;
    }
    const paths = this.sparseCheckoutPaths()
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    await this.git.setSparseCheckout(paths, this.sparseCheckoutIndex());
    if (!this.git.error()) this.loadSparseCheckoutDraft();
  }

  protected async reapplySparseCheckout(): Promise<void> {
    this.sparseCheckoutMenuOpen.set(false);
    await this.git.reapplySparseCheckout();
  }

  protected sparseCheckoutPathCount(): number {
    return this.sparseCheckoutPaths().split(/\r?\n/).filter((value) => value.trim()).length;
  }

  private loadSparseCheckoutDraft(): void {
    const sparse = this.git.repository()?.sparseCheckout;
    this.sparseCheckoutPaths.set(sparse?.paths.join('\n') ?? '');
    this.sparseCheckoutIndex.set(sparse?.enabled ? sparse.sparseIndex : true);
  }

  protected handleAutoFetchStatus(): void {
    if (this.git.incomingRepositoryLinksPending()) { this.openIncomingLinks(); return; }
    const repoId = this.git.activeRepositoryId();
    if (repoId && this.git.repositoryLinkPolicies()[repoId]?.autoFetchPaused) void this.git.resumeRepositoryLinkAutoFetch();
    else this.runAutoFetchNow();
  }

  protected openIncomingLinks(returnFocus: HTMLElement | null = null): void {
    if (this.git.busy() || !this.git.incomingRepositoryLinksReady() || [...document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="alertdialog"]')].some(element => element.getClientRects().length > 0 && !(element.closest('gc-command-palette') && !this.commandPaletteOpen()))) return;
    const opener = returnFocus ?? this.captureDialogOpener();
    this.closeContextMenu();
    this.repositoryLinkDialog.set({ mode: 'inbox', returnFocus: opener });
    void this.git.refreshIncomingRepositoryLinks();
  }

  protected openRepositoryLink(returnFocus: HTMLElement | null = null): void {
    this.repositoryLinkDialog.set({ mode: 'open', returnFocus: returnFocus ?? this.captureDialogOpener() });
  }

  protected shareRepositoryFromTab(): void {
    const menu = this.repositoryTabMenu();
    if (!menu) return;
    const returnFocus = this.repositoryTabMenuReturnFocus;
    this.dismissRepositoryTabMenu();
    this.repositoryLinkDialog.set({ mode: 'share', repoId: menu.repoId, target: { kind: 'repository' }, returnFocus });
  }

  protected shareRepositoryContext(): void {
    const menu = this.contextMenu();
    const repoId = this.git.activeRepositoryId();
    if (!menu || !repoId || (menu.kind === 'commit' && menu.oids.length !== 1)) return;
    const returnFocus = this.contextMenuReturnFocus;
    this.contextMenu.set(null);
    const target = menu.kind === 'commit' ? { kind: 'commit' as const, oid: menu.oid }
      : { kind: 'reference' as const, reference: `refs/${menu.kind === 'tag' ? 'tags' : menu.kind === 'remote' ? 'remotes' : 'heads'}/${menu.label}` };
    this.repositoryLinkDialog.set({ mode: 'share', repoId, target, returnFocus });
  }

  protected closeRepositoryLink(): void {
    const request = this.repositoryLinkDialog();
    this.repositoryLinkDialog.set(null);
    setTimeout(() => { if (!this.repositoryLinkDialog()) (request?.returnFocus?.isConnected ? request.returnFocus : document.querySelector<HTMLElement>('.workspace-toggle'))?.focus({ preventScroll: true }); });
  }

  protected handleRepositoryLinkLoaderKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.closeRepositoryLink(); }
    else if (event.key === 'Tab') { event.preventDefault(); this.repositoryLinkLoaderClose()?.nativeElement.focus(); }
  }

  protected finishRepositoryLink(oid: string | null): void {
    this.finishRepositoryCreation();
    if (oid) this.selectCommit(oid);
  }

  protected runAutoFetchNow(): void {
    void this.git.remote('fetch_repository');
  }

  protected openFetchOptions(returnFocus: HTMLElement | null = null): void {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId || this.git.busy()) return;
    const opener = returnFocus ?? document.querySelector<HTMLButtonElement>('button[aria-label="Pull options"]');
    this.pullMenuOpen.set(false);
    this.fetchRequest.set({ repositoryId, returnFocus: opener });
  }

  protected openFetchOptionsFromToolbar(): void {
    const returnFocus = this.toolbarMenuReturnFocus;
    this.closeToolbarMenus();
    this.openFetchOptions(returnFocus);
  }

  protected autoFetchStatusLabel(): string {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId) return 'Auto-fetch';
    if (this.git.incomingRepositoryLinksPending()) return 'Incoming links pending';
    if (this.git.repositoryLinkPolicies()[repositoryId]?.autoFetchPaused) return 'Auto-fetch paused';
    if (this.git.backgroundFetchRepositoryId() === repositoryId) return 'Fetching…';
    if (this.git.backgroundFetchErrors()[repositoryId]) return 'Fetch failed';
    const timestamp = this.git.backgroundFetchLastAt()[repositoryId];
    if (timestamp) {
      return `Fetched ${new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(timestamp)}`;
    }
    return `Auto-fetch ${this.autoFetchIntervalMinutes()}m`;
  }

  protected autoFetchStatusTitle(): string {
    if (this.git.incomingRepositoryLinksPending()) return 'Automatic fetch waits until incoming links are reviewed or dismissed. Click to open the incoming links.';
    const repositoryId = this.git.activeRepositoryId();
    if (repositoryId && this.git.repositoryLinkPolicies()[repositoryId]?.autoFetchPaused) return 'Automatic fetch is paused for this link session. Click to resume your configured schedule.';
    const error = repositoryId ? this.git.backgroundFetchErrors()[repositoryId] : null;
    if (error) return `Automatic fetch failed: ${error}. Click to retry.`;
    const timestamp = repositoryId ? this.git.backgroundFetchLastAt()[repositoryId] : null;
    if (timestamp) {
      return `Remote references last fetched at ${new Date(timestamp).toLocaleTimeString()}. Click to fetch now.`;
    }
    return `Fetch remote references every ${this.autoFetchIntervalMinutes()} minutes. Click to fetch now.`;
  }

  protected fetchMenuDetail(): string {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId) return 'Download remote references';
    if (this.git.backgroundFetchRepositoryId() === repositoryId) return 'Updating remote references';
    if (this.git.backgroundFetchErrors()[repositoryId]) return 'Last fetch failed · click to retry';
    const timestamp = this.git.backgroundFetchLastAt()[repositoryId];
    if (!timestamp) return 'Remote references not fetched this session';
    return `Last fetched at ${new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(timestamp)}`;
  }

  protected setTerminalPreference(
    preference: 'font-family' | 'font-size' | 'line-height' | 'cursor-style',
    value: string | number,
  ): void {
    if (preference === 'font-family') this.terminalFontFamily.set(String(value));
    else if (preference === 'font-size') this.terminalFontSize.set(Number(value));
    else if (preference === 'line-height') this.terminalLineHeight.set(Number(value));
    else this.terminalCursorStyle.set(value as TerminalCursorStyle);
    try {
      localStorage.setItem(`git-khronos.terminal.${preference}`, String(value));
    } catch {
      // Terminal preferences remain active for this session.
    }
  }

  protected setDiffPreference(
    preference: 'font-size' | 'tab-size' | 'word-wrap',
    value: number | boolean,
  ): void {
    if (preference === 'font-size') {
      const size = Number(value);
      if (![11, 12, 13, 14, 16].includes(size)) return;
      this.diffFontSize.set(size);
    } else if (preference === 'tab-size') {
      const size = Number(value);
      if (![2, 4, 8].includes(size)) return;
      this.diffTabSize.set(size);
    } else {
      this.diffWordWrap.set(Boolean(value));
    }
    try {
      localStorage.setItem(`git-khronos.diff.${preference}`, String(value));
    } catch {
      // Diff preferences remain active for this session.
    }
  }

  protected openReferencePaneMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('sidebar-context');
    this.contextMenu.set(null);
    this.stashContextMenu.set(null);
    this.fileContextMenu.set(null);
    this.commitFileContextMenu.set(null);
    this.worktreeMenuPath.set(null);
    this.submoduleMenuPath.set(null);
    this.remoteGroupMenu.set(null);
    this.sidebarContextMenuReturnFocus = this.sidebarMenuReturnTarget(event, '.heading-toggle');
    const preferredPosition = { x: event.clientX, y: event.clientY };
    this.referencePaneMenu.set({
      x: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.x, window.innerWidth - 230)),
      y: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.y, window.innerHeight - 285)),
    });
    this.settleSidebarContextMenuPosition('reference', 'reference', preferredPosition);
  }

  protected referencePaneVisible(pane: ReferencePane): boolean {
    return this.referencePaneVisibility()[pane];
  }

  protected toggleReferencePane(pane: ReferencePane): void {
    const visible = !this.referencePaneVisibility()[pane];
    if (!visible && pane !== 'pullRequests' && this.maximizedReferenceSection() === pane) {
      this.maximizeReferenceSection(pane);
    }
    this.referencePaneVisibility.update((panes) => ({ ...panes, [pane]: visible }));
    if (visible && pane === 'submodules') this.submodulesOpen.set(true);
    try {
      const storageName = pane === 'pullRequests' ? 'pull-requests' : pane;
      localStorage.setItem(`git-khronos.ui.pane-${storageName}`, String(visible));
    } catch {
      // Pane visibility remains active for this session.
    }
  }

  protected async openWorktree(path: string): Promise<void> {
    await this.openRepositoryPath(path);
  }

  protected async openRepositoryPath(path: string, closeManager = false): Promise<void> {
    if (path === this.git.repository()?.path) {
      if (closeManager) this.repositoryDialog.set(null);
      return;
    }
    this.saveCommitDraft();
    await this.git.openRepository(path);
    if (!this.git.error()) {
      this.syncOpenTerminalToActiveRepository();
      this.restoreCommitDraft();
      if (closeManager) this.repositoryDialog.set(null);
      this.selectWip();
      this.loadGraphPreferences();
    }
  }

  protected async selectWorktreeWip(worktree: Worktree): Promise<void> {
    if (worktree.current) {
      this.selectWip();
      return;
    }
    await this.openWorktree(worktree.path);
  }

  protected selectWorktreeGraphRow(worktree: Worktree, event?: MouseEvent): void {
    if (worktree.current) {
      if ((event?.ctrlKey || event?.metaKey) && this.selectedCommits().length === 1) {
        this.startWorkingTreeComparison(this.selectedCommits()[0]);
        return;
      }
      this.selectWip();
      return;
    }
    if (this.commitMessageEditing()) this.cancelCommitMessageEdit();
    this.clearPanelFileSelection();
    this.selectedWorktreePath.set(worktree.path);
    this.selectedCommit.set(null);
    this.selectedCommits.set([]);
    this.commitSelectionAnchor.set(null);
    this.changesOpen.set(false);
    this.closeDiffViewer();
    this.setPanelVisibility('commit-panel', true);
  }

  protected handleWorktreeGraphRowKeydown(event: KeyboardEvent, worktree: Worktree): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectWorktreeGraphRow(worktree);
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      return;
    }

    const worktrees = this.worktreeWipRows();
    const commits = this.visibleGraphRows();
    const currentIndex = worktrees.findIndex((row) => row.worktree.path === worktree.path);
    const rowCount = worktrees.length + commits.length;
    if (currentIndex < 0 || !rowCount) return;

    const pageSize = Math.max(1, Math.floor(this.graphViewportHeight() / COMMIT_ROW_HEIGHT) - 1);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = Math.min(rowCount - 1, currentIndex + 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === 'PageDown') nextIndex = Math.min(rowCount - 1, currentIndex + pageSize);
    else if (event.key === 'PageUp') nextIndex = Math.max(0, currentIndex - pageSize);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = rowCount - 1;
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    event.stopPropagation();
    if (nextIndex < worktrees.length) {
      const nextWorktree = worktrees[nextIndex].worktree;
      this.selectWorktreeGraphRow(nextWorktree);
      queueMicrotask(() => {
        const nextRow = Array.from(
          this.commitListElement?.querySelectorAll<HTMLElement>('.wip-row[data-graph-row]') ?? [],
        )[nextIndex];
        nextRow?.scrollIntoView({ block: 'nearest' });
        nextRow?.focus({ preventScroll: true });
      });
      return;
    }

    const nextCommit = commits[nextIndex - worktrees.length];
    if (!nextCommit) return;
    this.selectCommit(nextCommit.commit.oid);
    this.scrollGraphCommitIntoView(nextCommit.commit.oid, 'nearest');
    queueMicrotask(() => requestAnimationFrame(() => {
      this.commitListElement
        ?.querySelector<HTMLElement>(`[data-commit-oid="${nextCommit.commit.oid}"]`)
        ?.focus({ preventScroll: true });
    }));
  }

  protected openWorktreeDialog(returnFocus?: HTMLElement | null): void {
    const repository = this.git.repository();
    if (!repository) return;
    this.worktreeDialogOpener = this.captureDialogOpener(returnFocus);
    const existing = new Set(repository.branches.filter((branch) => !branch.remote).map((branch) => branch.name));
    let index = repository.worktrees.length + 1;
    let branch = `worktree/branch-${index}`;
    while (existing.has(branch)) branch = `worktree/branch-${++index}`;
    const parent = repository.path.replace(/[\\/][^\\/]+$/, '') || repository.path;
    this.worktreeCreationSource.set(null);
    this.worktreeBranch.set(branch);
    this.worktreeBase.set(repository.status.branch ?? repository.headOid ?? 'HEAD');
    this.worktreeParent.set(parent);
    this.worktreeFolder.set(`${repository.name}-${branch.replace(/[^a-zA-Z0-9._-]+/g, '-')}`);
    this.worktreeHandoff.set('none');
    this.worktreeDialogOpen.set(true);
    setTimeout(() => this.focusFirstEditableControl(this.worktreeDialogElement()));
  }

  protected canCreateContextWorktree(): boolean {
    const menu = this.contextMenu();
    const repository = this.git.repository();
    if (!menu || menu.kind !== 'branch' || !repository) return false;
    const branch = repository.branches.find((candidate) => !candidate.remote && candidate.name === menu.label);
    return !!branch
      && !branch.current
      && !repository.worktrees.some((worktree) => worktree.branch === branch.name);
  }

  protected openContextWorktreeDialog(): void {
    const menu = this.contextMenu();
    const repository = this.git.repository();
    if (!menu || menu.kind !== 'branch' || !repository || !this.canCreateContextWorktree()) return;
    this.worktreeDialogOpener = this.contextMenuReturnFocus ?? this.captureDialogOpener();
    const parent = repository.path.replace(/[\\/][^\\/]+$/, '') || repository.path;
    this.contextMenu.set(null);
    this.worktreeCreationSource.set(menu.label);
    this.worktreeBranch.set(menu.label);
    this.worktreeBase.set(menu.label);
    this.worktreeParent.set(parent);
    this.worktreeFolder.set(`${repository.name}-${menu.label.replace(/[^a-zA-Z0-9._-]+/g, '-')}`);
    this.worktreeHandoff.set('none');
    this.worktreeDialogOpen.set(true);
    setTimeout(() => this.focusFirstEditableControl(this.worktreeDialogElement()));
  }

  protected closeWorktreeDialog(restoreFocus = true): void {
    const opener = this.worktreeDialogOpener;
    this.worktreeDialogOpen.set(false);
    this.worktreeDialogOpener = null;
    if (restoreFocus) this.restoreDialogFocus(opener);
  }

  protected async chooseWorktreeParent(): Promise<void> {
    const selected = await this.git.chooseDirectory('Choose a parent folder for the worktree');
    if (selected) this.worktreeParent.set(selected);
  }

  protected async submitWorktree(): Promise<void> {
    const branch = this.worktreeBranch().trim();
    const source = this.worktreeCreationSource();
    const openTerminal = !source && this.worktreeHandoff() === 'terminal';
    const created = source
      ? await this.git.createWorktreeForBranch(
        this.worktreeParent(),
        this.worktreeFolder().trim(),
        source,
      )
      : await this.git.createWorktree(
        this.worktreeParent(),
        this.worktreeFolder().trim(),
        branch,
        this.worktreeBase(),
      );
    if (!created) return;
    const worktree = this.git.repository()?.worktrees.find((candidate) => candidate.branch === (source ?? branch));
    this.closeWorktreeDialog(false);
    if (worktree) {
      await this.openWorktree(worktree.path);
      const repositoryId = this.git.activeRepositoryId();
      if (openTerminal && repositoryId && !this.git.error()) this.showTerminalForRepository(repositoryId);
    }
  }

  protected toggleWorktreeMenu(event: MouseEvent, path: string): void {
    event.stopPropagation();
    const opening = this.worktreeMenuPath() !== path;
    this.prepareActionMenu('sidebar');
    this.sidebarActionMenuReturnFocus = opening && event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : null;
    this.submoduleMenuPath.set(null);
    this.worktreeMenuPath.set(opening ? path : null);
    if (opening) this.focusSidebarActionMenu(event);
  }

  protected openWorktreeMenu(event: MouseEvent, path: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('sidebar');
    this.sidebarActionMenuReturnFocus = this.sidebarMenuReturnTarget(event, '.worktree-list-main');
    this.submoduleMenuPath.set(null);
    this.worktreeMenuPath.set(path);
    this.focusSidebarActionMenu(event);
  }

  protected openWorktreeMove(worktree: Worktree): void {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId || this.git.busy() || worktree.current || worktree.locked || worktree.prunable || this.isWorktreeOpen(worktree.path)) return;
    const returnFocus = this.sidebarActionMenuReturnFocus;
    this.worktreeMenuPath.set(null);
    this.worktreeMoveRequest.set({ repositoryId, worktree, returnFocus });
  }

  protected openWorktreeRepair(worktree: Worktree): void {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId || this.git.busy() || worktree.current || worktree.locked || this.isWorktreeOpen(worktree.path)) return;
    const returnFocus = this.sidebarActionMenuReturnFocus;
    this.worktreeMenuPath.set(null);
    this.worktreeMoveRequest.set({ repositoryId, worktree, returnFocus, repair: true });
  }

  protected openWorktreeRegistrationReview(submodules?: boolean, returnFocus?: HTMLElement | null): void {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId || this.git.busy()) return;
    const opener = returnFocus
      ?? this.sidebarActionMenuReturnFocus
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.worktreeMenuPath.set(null);
    this.submoduleMenuPath.set(null);
    this.worktreeRegistrationRequest.set({ repositoryId, returnFocus: opener, submodules });
  }

  protected openLfsTracking(): void {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId || this.git.busy()) return;
    this.lfsTrackingRequest.set({ repositoryId, returnFocus: this.captureDialogOpener() });
  }

  protected closeLfsTrackingLoader(): void {
    const opener = this.lfsTrackingRequest()?.returnFocus;
    this.lfsTrackingRequest.set(null);
    setTimeout(() => { if (opener?.isConnected) opener.focus(); });
  }

  protected closeWorktreeRegistrationLoader(): void {
    const opener = this.worktreeRegistrationRequest()?.returnFocus;
    this.worktreeRegistrationRequest.set(null);
    setTimeout(() => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus();
    });
  }

  protected closeDeferredGitAction(): void {
    const opener = (this.referenceAction() ?? this.fetchRequest() ?? this.worktreeMoveRequest() ?? this.stashDialog())?.returnFocus;
    this.referenceAction.set(null);
    this.fetchRequest.set(null);
    this.worktreeMoveRequest.set(null);
    this.stashDialog.set(null);
    setTimeout(() => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else document.querySelector<HTMLButtonElement>('button[aria-label="Open left panel"]')?.focus();
    });
  }

  protected handleReferenceLoaderKey(event: KeyboardEvent, kind: 'documentation' | 'worktree' | 'action' | 'history'): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (kind === 'documentation') this.documentation.close();
      else if (kind === 'action') this.closeDeferredGitAction();
      else if (kind === 'history') this.closeHistorySearchLoader();
      else this.closeWorktreeRegistrationLoader();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('button')?.focus();
    }
  }

  protected handleLfsLoaderKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.closeLfsTrackingLoader(); }
    if (event.key === 'Tab') {
      event.preventDefault();
      (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('button')?.focus();
    }
  }

  protected openSubmoduleDialog(returnFocus?: HTMLElement | null): void {
    this.submoduleDialogOpener = this.captureDialogOpener(returnFocus);
    this.submoduleUrl.set('');
    this.submodulePath.set('');
    this.submoduleDialogOpen.set(true);
    setTimeout(() => this.focusFirstEditableControl(this.submoduleDialogElement()));
  }

  protected closeSubmoduleDialog(restoreFocus = true): void {
    const opener = this.submoduleDialogOpener;
    this.submoduleDialogOpen.set(false);
    this.submoduleDialogOpener = null;
    if (restoreFocus) this.restoreDialogFocus(opener);
  }

  protected openAddRemoteDialog(returnFocus?: HTMLElement | null): void {
    this.remoteDialogOpener = this.captureRemoteDialogOpener(returnFocus);
    const hasOrigin = this.git.repository()?.remotes.some((remote) => remote.name === 'origin');
    this.remoteName.set(hasOrigin ? '' : 'origin');
    this.remoteUrl.set('');
    this.remotePushUrl.set('');
    this.initialRemotePushUrl = '';
    this.remoteDialogIcon.set('remote');
    this.remoteDialog.set('add');
    setTimeout(() => this.focusFirstEditableControl(this.remoteDialogElement()));
  }

  protected openEditRemoteDialog(remote: Remote, returnFocus?: HTMLElement | null): void {
    this.remoteDialogOpener = this.captureRemoteDialogOpener(returnFocus);
    this.remoteName.set(remote.name);
    this.remoteUrl.set(remote.fetchUrl);
    this.remotePushUrl.set(remote.pushUrl === remote.fetchUrl ? '' : remote.pushUrl);
    this.initialRemotePushUrl = this.remotePushUrl();
    this.remoteDialogIcon.set(this.remoteIcon(remote.name));
    this.remoteDialog.set('edit');
    setTimeout(() => this.focusFirstEditableControl(this.remoteDialogElement()));
  }

  protected closeRemoteDialog(restoreFocus = true): void {
    const opener = this.remoteDialogOpener;
    this.remoteDialog.set(null);
    if (restoreFocus) {
      this.remoteDialogOpener = null;
      this.restoreDialogFocus(opener);
    }
  }

  protected editedRemotePushUrl(): string {
    return this.git.repository()?.remotes.find((remote) => remote.name === this.remoteName())?.pushUrl
      || 'the fetch URL';
  }

  protected async submitRemote(): Promise<void> {
    const mode = this.remoteDialog();
    const name = this.remoteName().trim();
    const url = this.remoteUrl().trim();
    if (!mode || !name || !url || this.git.busy()) return;
    this.setRemoteIcon(name, this.remoteDialogIcon());
    const repositoryId = this.git.activeRepositoryId();
    const pushUrl = this.remotePushUrl().trim();
    if (pushUrl !== this.initialRemotePushUrl) {
      await this.git.configureRemote(name, url, pushUrl || null, true, mode === 'add');
    } else if (mode === 'add') await this.git.addRemote(name, url);
    else await this.git.setRemoteUrl(name, url);
    if (repositoryId !== this.git.activeRepositoryId()) return;
    if (mode === 'add' && this.git.repository()?.remotes.some(remote => remote.name === name)) {
      this.remoteDialog.set('edit');
    }
    if (!this.git.error()) {
      this.closeRemoteDialog();
      this.remoteBranchesOpen.set(true);
    }
  }

  protected requestRemoteRemoval(): void {
    const name = this.remoteName();
    const remote = this.git.repository()?.remotes.find((candidate) => candidate.name === name);
    if (!remote) return;
    this.closeRemoteDialog(false);
    this.pendingRemoteRemoval.set(remote);
  }

  protected closeRemoteRemoval(): void {
    const opener = this.remoteDialogOpener;
    this.pendingRemoteRemoval.set(null);
    this.remoteDialogOpener = null;
    this.restoreDialogFocus(opener);
  }

  protected async confirmRemoteRemoval(): Promise<void> {
    const remote = this.pendingRemoteRemoval();
    if (!remote || this.git.busy()) return;
    this.closeRemoteRemoval();
    await this.git.removeRemote(remote.name);
  }

  protected async submitSubmodule(): Promise<void> {
    const url = this.submoduleUrl().trim();
    const path = this.submodulePath().trim();
    if (!url || !path || this.git.busy()) return;
    if (await this.git.addSubmodule(url, path)) {
      this.closeSubmoduleDialog();
      this.showSubmodulePane();
    }
  }

  private showSubmodulePane(): void {
    this.referencePaneVisibility.update((panes) => ({ ...panes, submodules: true }));
    this.submodulesOpen.set(true);
    try {
      localStorage.setItem('git-khronos.ui.pane-submodules', 'true');
      localStorage.setItem('git-khronos.ui.section-submodules-open', 'true');
    } catch {
      // Submodule controls remain visible for this session.
    }
  }

  private captureDialogOpener(returnFocus?: HTMLElement | null): HTMLElement | null {
    return returnFocus === undefined && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : returnFocus ?? null;
  }

  private captureRemoteDialogOpener(returnFocus?: HTMLElement | null): HTMLElement | null {
    let opener = this.captureDialogOpener(returnFocus);
    if (opener?.closest('.toolbar-nav-menu')) opener = this.toolbarRemoteToggle()?.nativeElement ?? opener;
    if (opener?.closest('.confirmation-dialog')) {
      opener = document.querySelector<HTMLElement>('.toolbar-actions button[aria-label^="Publish"]') ?? opener;
    }
    return opener;
  }

  private captureSecondaryConfirmationOpener(returnFocus?: HTMLElement | null): HTMLElement | null {
    let opener = this.captureDialogOpener(returnFocus);
    if (opener?.closest('.workspace-menu')) opener = this.workspaceToggle()?.nativeElement ?? opener;
    if (opener?.closest('.toolbar-menu')) opener = this.toolbarMenuReturnFocus ?? opener;
    if (opener?.closest('.worktree-card-menu')) opener = this.sidebarActionMenuReturnFocus ?? opener;
    if (opener?.closest('.preferences-popover')) {
      opener = this.preferencesOpener ?? this.preferencesToggle()?.nativeElement ?? opener;
    }
    return opener;
  }

  private focusFirstEditableControl(dialog?: ElementRef<HTMLElement>): void {
    dialog?.nativeElement
      ?.querySelector<HTMLElement>('input:not([readonly]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      ?.focus();
  }

  private focusConfirmationCancel(dialog?: ElementRef<HTMLElement>): void {
    dialog?.nativeElement.querySelector<HTMLElement>('footer button:not(:disabled)')?.focus();
  }

  private finishSecondaryConfirmation(restoreFocus = true): void {
    const opener = this.secondaryConfirmationOpener;
    this.secondaryConfirmationOpener = null;
    if (restoreFocus) this.restoreDialogFocus(opener);
  }

  private restoreDialogFocus(opener: HTMLElement | null): void {
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  protected toggleSubmoduleMenu(event: MouseEvent, path: string): void {
    event.stopPropagation();
    const opening = this.submoduleMenuPath() !== path;
    this.prepareActionMenu('sidebar');
    this.sidebarActionMenuReturnFocus = opening && event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : null;
    this.worktreeMenuPath.set(null);
    this.submoduleMenuPath.set(opening ? path : null);
    if (opening) this.focusSidebarActionMenu(event);
  }

  protected openSubmoduleMenu(event: MouseEvent, path: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('sidebar');
    this.sidebarActionMenuReturnFocus = this.sidebarMenuReturnTarget(event, '.submodule-main');
    this.worktreeMenuPath.set(null);
    this.submoduleMenuPath.set(path);
    this.focusSidebarActionMenu(event);
  }

  protected async openSubmodule(submodule: Submodule): Promise<void> {
    this.submoduleMenuPath.set(null);
    if (!submodule.initialized) {
      await this.git.initializeSubmodule(submodule.path);
      return;
    }
    await this.openRepositoryPath(submodule.absolutePath);
  }

  protected async initializeSubmodule(submodule: Submodule): Promise<void> {
    this.submoduleMenuPath.set(null);
    await this.git.initializeSubmodule(submodule.path);
  }

  protected async updateSubmodule(submodule: Submodule): Promise<void> {
    this.submoduleMenuPath.set(null);
    await this.git.updateSubmodule(submodule.path);
  }

  protected isWorktreeOpen(path: string): boolean {
    return this.git.repositories().some((repository) => repository.path === path);
  }

  protected async setWorktreeLocked(worktree: Worktree): Promise<void> {
    this.worktreeMenuPath.set(null);
    await this.git.setWorktreeLocked(worktree.path, !worktree.locked);
  }

  protected requestWorktreeRemoval(worktree: Worktree, deleteBranch: boolean): void {
    this.secondaryConfirmationOpener = this.captureSecondaryConfirmationOpener(this.sidebarActionMenuReturnFocus);
    this.worktreeMenuPath.set(null);
    this.sidebarActionMenuReturnFocus = null;
    this.forceWorktreeRemoval.set(false);
    this.pendingWorktreeAction.set({
      path: worktree.path,
      branch: worktree.branch,
      deleteBranch,
      changes: worktree.changes,
    });
    setTimeout(() => this.focusConfirmationCancel(this.worktreeRemovalDialog()));
  }

  protected closeWorktreeRemoval(): void {
    this.pendingWorktreeAction.set(null);
    this.finishSecondaryConfirmation();
  }

  protected async confirmWorktreeRemoval(): Promise<void> {
    const action = this.pendingWorktreeAction();
    if (!action) return;
    this.closeWorktreeRemoval();
    await this.git.removeWorktree(
      action.path,
      action.deleteBranch,
      action.changes > 0 && this.forceWorktreeRemoval(),
    );
  }

  protected setPanelVisibility(panel: 'left-panel' | 'commit-panel', visible: boolean): void {
    const focusResponsiveSidebar = panel === 'left-panel'
      && visible
      && !this.sidebarVisible()
      && this.responsiveSidebarMode;
    const focusFullWidthInspector = panel === 'commit-panel'
      && visible
      && !this.detailsVisible()
      && this.fullWidthInspectorMode();
    const restoreCommitPanelToggle = panel === 'commit-panel'
      && !visible
      && this.detailsVisible()
      && !!(document.activeElement as HTMLElement | null)?.closest('.detail-panel');
    if (panel === 'left-panel') {
      this.sidebarVisible.set(visible);
      if (!this.responsiveSidebarMode) this.wideViewportSidebarVisible = visible;
    } else {
      this.detailsVisible.set(visible);
    }
    try {
      if (panel !== 'left-panel' || !this.responsiveSidebarMode) {
        localStorage.setItem(`git-khronos.ui.${panel}`, String(visible));
      }
    } catch {
      // Panel visibility remains active for this session.
    }
    if (focusResponsiveSidebar) {
      setTimeout(() => this.branchSearch()?.nativeElement.focus({ preventScroll: true }));
    } else if (focusFullWidthInspector) {
      setTimeout(() => this.commitPanelClose()?.nativeElement.focus({ preventScroll: true }));
    } else if (restoreCommitPanelToggle) {
      setTimeout(() => this.commitPanelToggle()?.nativeElement.focus({ preventScroll: true }));
    }
  }

  @HostListener('window:resize')
  protected handleResponsiveLayout(): void {
    this.finishResize();
    this.viewportWidth.set(window.innerWidth);
    this.syncDefaultGraphMetadataColumns();
    const fullWidthInspector = window.innerWidth <= FULL_WIDTH_INSPECTOR_BREAKPOINT;
    const enteringFullWidthInspector = fullWidthInspector
      && !this.fullWidthInspectorMode()
      && this.detailsVisible();
    this.fullWidthInspectorMode.set(fullWidthInspector);
    if (enteringFullWidthInspector && !this.pendingHistoryAction() && !this.pendingCheckpointDelete()) {
      setTimeout(() => {
        if (!this.pendingHistoryAction() && !this.pendingCheckpointDelete()) this.commitPanelClose()?.nativeElement.focus({ preventScroll: true });
      });
    }
    const activeRepositoryId = this.git.activeRepositoryId();
    if (activeRepositoryId) this.revealRepositoryTab(activeRepositoryId);
    requestAnimationFrame(() => this.updateRepositoryTabOverflow());
    const responsive = window.innerWidth <= RESPONSIVE_SIDEBAR_BREAKPOINT;
    if (responsive === this.responsiveSidebarMode) return;
    this.responsiveSidebarMode = responsive;
    this.sidebarVisible.set(responsive ? false : this.wideViewportSidebarVisible);
  }

  /** Focuses an element from a deferred view, waiting a few frames for its chunk to render. */
  private focusWhenRendered(
    resolve: () => HTMLElement | undefined,
    frames = 30,
    shouldContinue: () => boolean = () => true,
  ): void {
    this.runWhenElementRendered(resolve, (element) => element.focus(), frames, shouldContinue);
  }

  private runWhenElementRendered<T extends HTMLElement>(
    resolve: () => T | undefined,
    onRendered: (element: T) => void,
    frames = 30,
    shouldContinue: () => boolean = () => true,
  ): void {
    if (!shouldContinue()) return;
    const element = resolve();
    if (element) onRendered(element);
    else if (frames > 0) {
      requestAnimationFrame(() => this.runWhenElementRendered(resolve, onRendered, frames - 1, shouldContinue));
    }
  }

  protected closeResponsiveSidebar(): void {
    this.setPanelVisibility('left-panel', false);
    setTimeout(() => this.responsiveSidebarToggle()?.nativeElement.focus({ preventScroll: true }));
  }

  protected setWorkingTreeViewMode(mode: WorkingTreeViewMode): void {
    this.workingTreeViewMode.set(mode);
    try {
      localStorage.setItem('git-khronos.ui.working-tree-view', mode);
    } catch {
      // The selected view remains active for this session.
    }
  }

  protected handleFileViewModeKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-file-view-mode]'),
    );
    if (!buttons.length) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
    else next = (current + 1) % buttons.length;
    const mode = buttons[next].dataset['fileViewMode'];
    if (mode !== 'path' && mode !== 'tree') return;
    event.preventDefault();
    event.stopPropagation();
    this.setWorkingTreeViewMode(mode);
    buttons[next].focus();
  }

  protected toggleWorkingTreeSort(): void {
    const ascending = !this.workingTreeSortAscending();
    this.workingTreeSortAscending.set(ascending);
    try {
      localStorage.setItem('git-khronos.ui.working-tree-sort-ascending', String(ascending));
    } catch {
      // The selected sort direction remains active for this session.
    }
  }

  protected toggleWorkingTreeDirectory(path: string): void {
    this.collapsedWorkingTreeDirectories.update((directories) => directories.includes(path)
      ? directories.filter((directory) => directory !== path)
      : [...directories, path]);
  }

  protected isWorkingTreeDirectoryCollapsed(path: string): boolean {
    return this.collapsedWorkingTreeDirectories().includes(path);
  }

  protected toggleCommitDirectory(path: string): void {
    this.collapsedCommitDirectories.update((directories) => directories.includes(path)
      ? directories.filter((directory) => directory !== path)
      : [...directories, path]);
  }

  protected isCommitDirectoryCollapsed(path: string): boolean {
    return this.collapsedCommitDirectories().includes(path);
  }

  protected setGraphColumn(column: GraphColumn, visible: boolean): void {
    this.columnVisibilitySignal(column).set(visible);
    try {
      localStorage.setItem(this.graphPreferenceKey(`column.${column}.visible`), String(visible));
    } catch {
      // Column selection remains available when WebView storage is unavailable.
    }
  }

  protected setCompactGraphColumn(compact: boolean): void {
    const previousMode = this.compactGraphColumn();
    const previousWidth = this.graphColumnWidth();
    let nextWidth = graphColumnLayout(compact).defaultWidth;
    try {
      localStorage.setItem(this.graphColumnWidthPreferenceKey(previousMode), String(previousWidth));
      localStorage.setItem(this.graphPreferenceKey('column.graph.compact'), String(compact));
      const storedWidth = Number(localStorage.getItem(this.graphColumnWidthPreferenceKey(compact)));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        nextWidth = normalizeGraphColumnWidth(
          storedWidth,
          compact,
          Math.max(
            MAXIMUM_PERSISTED_GRAPH_COLUMN_WIDTH,
            graphColumnWidthForLaneCount(this.graphRequiredLaneCount(), compact),
          ),
        );
      }
    } catch {
      // Graph density remains available for this session.
    }
    this.compactGraphColumn.set(compact);
    this.graphColumnWidth.set(nextWidth);
  }

  protected fitGraphColumnToBranches(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.freezeAutoFilledMessageColumn('graph');
    this.snapshotGraphColumnWidths();
    this.setGraphColumnWidth('graph', this.graphMaximumWidth());
    this.storeResizedGraphColumnWidths('graph');
    this.revealResizedGraphColumn('graph');
  }

  protected setGraphScrollMarkers(visible: boolean): void {
    this.showGraphScrollMarkers.set(visible);
    try {
      localStorage.setItem(this.graphPreferenceKey('scroll-markers'), String(visible));
    } catch {
      // Marker visibility remains available for this session.
    }
  }

  protected async setCheckpointVisibility(visible: boolean, input: HTMLInputElement): Promise<void> {
    const repositoryId = this.git.activeRepositoryId();
    await this.git.setCheckpointVisibility(visible);
    if (input.isConnected) input.checked = !!this.git.repository()?.showCheckpoints;
    this.reconcileCheckpointSelection(repositoryId);
  }

  private reconcileCheckpointSelection(repositoryId: string | null): void {
    if (!repositoryId || this.git.activeRepositoryId() !== repositoryId) return;
    const selected = this.selectedCommits();
    const visible = new Set(this.git.repository()?.commits.map((commit) => commit.oid) ?? []);
    if (selected.some((oid) => !visible.has(oid))) this.selectWip();
  }

  protected setSmartBranchVisibility(visible: boolean): void {
    if (visible) {
      this.hiddenBranches.set([]);
      this.soloBranches.set([]);
      this.storeReferenceFilters();
    }
    this.smartBranchVisibility.set(visible);
    try {
      localStorage.setItem(this.graphPreferenceKey('smart-branch-visibility'), String(visible));
    } catch {
      // Smart branch visibility remains active for this session.
    }
  }

  protected restoreGraphDefaults(): void {
    this.graphColumnOrder.set([...DEFAULT_GRAPH_COLUMNS]);
    for (const column of DEFAULT_GRAPH_COLUMNS) {
      this.columnVisibilitySignal(column).set(this.defaultGraphColumnVisible(column));
      this.columnWidthSignal(column).set(
        column === 'graph' ? graphColumnLayout(false).defaultWidth : GRAPH_COLUMN_DEFAULT_WIDTHS[column],
      );
    }
    this.compactGraphColumn.set(false);
    this.messageColumnManuallyResized.set(false);
    this.showGraphScrollMarkers.set(true);
    this.smartBranchVisibility.set(false);
    this.graphHorizontalScroll.set(true);
    try {
      localStorage.removeItem(GRAPH_HORIZONTAL_SCROLL_KEY);
      const keys = [
        'column.order',
        'column.graph.compact',
        'column.graph.width',
        'column.graph.compact.width',
        'column.graph.expanded.width',
        'scroll-markers',
        'smart-branch-visibility',
        ...DEFAULT_GRAPH_COLUMNS.flatMap((column) => [
          `column.${column}.visible`,
          `column.${column}.width`,
        ]),
      ];
      for (const key of keys) localStorage.removeItem(this.graphPreferenceKey(key));
    } catch {
      // Graph defaults remain restored for this session.
    }
  }

  protected commitActionReadiness(repository: RepositorySnapshot): CommitReadiness {
    if (this.git.busy()) {
      return { ready: false, icon: 'warning', message: 'Git is busy. Wait for the current operation to finish.' };
    }
    if (repository.status.historyNoCommit) {
      return { ready: false, icon: 'warning', message: 'Finish the no-commit replay from the operation banner before creating another commit.' };
    }
    const split = repository.status.rebaseSplit;
    if (split?.preparing) {
      return { ready: false, icon: 'warning', message: 'The split reset needs attention. Abort it from the operation banner before committing.' };
    }
    if (split && split.partCount >= 500) {
      return { ready: false, icon: 'warning', message: 'This split reached the 500-part safety limit. Continue or abort the rebase.' };
    }
    if (split && this.commitPolicy().allowEmpty) {
      return { ready: false, icon: 'warning', message: 'Empty commits are unavailable while splitting a commit.' };
    }
    if (split && !repository.status.staged) {
      return { ready: false, icon: 'warning', message: 'Stage selected changes for the next split commit.' };
    }
    if (!repository.status.staged && !this.amendPrevious() && !this.commitPolicy().allowEmpty) {
      return { ready: false, icon: 'warning', message: 'Stage at least one changed file to continue.' };
    }
    if (!this.commitMessage().trim()) {
      return { ready: false, icon: 'edit', message: 'Write a commit summary to continue.' };
    }

    const push = this.pushAfterCommit() ? ' and push it' : '';
    if (!split && this.amendPrevious()) {
      return { ready: true, icon: 'check', message: `Ready to amend the previous commit${push}.` };
    }
    if (!repository.status.staged && this.commitPolicy().allowEmpty) {
      return { ready: true, icon: 'check', message: `Ready to create an empty commit${push}.` };
    }
    const files = `${repository.status.staged} staged ${repository.status.staged === 1 ? 'file' : 'files'}`;
    return { ready: true, icon: 'check', message: `Ready to commit ${files}${push}.` };
  }

  protected async commit(): Promise<void> {
    const repository = this.git.repository();
    if (!repository || !this.commitActionReadiness(repository).ready) return;
    const trailers = this.coAuthors()
      .map((author) => `Co-authored-by: ${author.name} <${author.email}>`)
      .join('\n');
    const message = [this.commitMessage().trim(), this.commitDescription().trim(), trailers]
      .filter(Boolean)
      .join('\n\n');
    const pushAfter = this.pushAfterCommit();
    const committed = await this.git.commit(message, {
      amend: !repository.status.rebaseSplit && this.amendPrevious(),
      skipHooks: this.skipGitHooks(),
      sign: this.signCommit(),
      ...this.commitPolicy(),
      pushAfter: false,
    });
    if (committed) {
      this.commitDrafts.delete(repository.id);
      if (this.git.activeRepositoryId() !== repository.id) {
        if (pushAfter) this.git.error.set('The commit completed in the original repository. Push was not started because the active repository changed. Return to that repository to review and push.');
        return;
      }
      this.resetCommitForm();
      this.applyCommitTemplate();
      if (pushAfter) this.pushCurrentBranch();
    }
  }

  protected async stashCurrentChanges(): Promise<void> {
    const repository = this.git.repository();
    if (!repository?.status.entryCount || this.git.busy()) return;
    await this.git.stash(this.stashMessage());
    if (!this.git.error()) this.stashMessage.set('');
  }

  protected coAuthorSuggestions(): CoAuthor[] {
    const selected = new Set(this.coAuthors().map((author) => author.email.toLowerCase()));
    const authors = new Map<string, CoAuthor>();
    for (const commit of this.git.repository()?.commits ?? []) {
      const email = commit.authorEmail.trim();
      if (!email || selected.has(email.toLowerCase())) continue;
      authors.set(email.toLowerCase(), { name: commit.authorName.trim(), email });
    }
    return [...authors.values()].slice(0, 6);
  }

  protected toggleCoAuthorPicker(event: MouseEvent): void {
    event.stopPropagation();
    this.coAuthorPickerOpen.update((open) => !open);
  }

  protected addSuggestedCoAuthor(author: CoAuthor): void {
    this.addCoAuthor(author.name, author.email);
  }

  protected canAddManualCoAuthor(): boolean {
    return !!this.validCoAuthor(this.coAuthorName(), this.coAuthorEmail());
  }

  protected addManualCoAuthor(): void {
    if (!this.addCoAuthor(this.coAuthorName(), this.coAuthorEmail())) return;
    this.coAuthorName.set('');
    this.coAuthorEmail.set('');
  }

  protected removeCoAuthor(email: string): void {
    this.coAuthors.update((authors) => authors.filter((author) => author.email !== email));
  }

  protected reloadCommitTemplate(): void {
    if (this.git.busy()) return;
    this.commitMessage.set('');
    this.commitDescription.set('');
    this.coAuthors.set([]);
    this.applyCommitTemplate();
  }

  private addCoAuthor(name: string, email: string): boolean {
    const author = this.validCoAuthor(name, email);
    if (!author) return false;
    this.coAuthors.update((authors) => authors.some(
      (candidate) => candidate.email.toLowerCase() === author.email.toLowerCase(),
    ) ? authors : [...authors, author]);
    return true;
  }

  private validCoAuthor(name: string, email: string): CoAuthor | null {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim();
    if (!normalizedName || /[\r\n<>]/.test(normalizedName)) return null;
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(normalizedEmail)) return null;
    return { name: normalizedName, email: normalizedEmail };
  }

  private async stageAllAndCommit(): Promise<void> {
    if (this.git.busy()) return;
    await this.git.stageAll();
    if (this.git.repository()?.status.staged) await this.commit();
  }

  protected saveCommitDraft(): void {
    const repositoryId = this.draftRepositoryId ?? this.git.activeRepositoryId();
    if (!repositoryId) return;
    this.commitDrafts.set(repositoryId, {
      summary: this.commitMessage(),
      description: this.commitDescription(),
      coAuthors: this.coAuthors().map((author) => ({ ...author })),
      amend: this.amendPrevious(),
      skipHooks: this.skipGitHooks(),
      sign: this.signCommit(),
      pushAfter: this.pushAfterCommit(),
      policy: this.commitPolicy(),
    });
  }

  private restoreCommitDraft(): void {
    const repositoryId = this.git.activeRepositoryId();
    this.draftRepositoryId = repositoryId;
    this.resetCommitForm();
    if (!repositoryId) return;
    const draft = this.commitDrafts.get(repositoryId);
    if (!draft) {
      this.applyCommitTemplate();
      return;
    }
    this.commitMessage.set(draft.summary);
    this.commitDescription.set(draft.description);
    this.coAuthors.set(draft.coAuthors.map((author) => ({ ...author })));
    this.amendPrevious.set(draft.amend);
    this.skipGitHooks.set(draft.skipHooks);
    this.signCommit.set(draft.sign);
    this.pushAfterCommit.set(draft.pushAfter);
    this.commitPolicy.set(draft.policy);
  }

  private resetCommitForm(): void {
    this.commitMessage.set('');
    this.commitDescription.set('');
    this.coAuthors.set([]);
    this.coAuthorName.set('');
    this.coAuthorEmail.set('');
    this.coAuthorPickerOpen.set(false);
    this.amendPrevious.set(false);
    this.skipGitHooks.set(false);
    this.commitPolicy.set({ signOff: false, allowEmpty: false, author: null, committer: null });
    this.signCommit.set(this.git.repository()?.signing.enabled ?? false);
    this.pushAfterCommit.set(false);
  }

  private applyCommitTemplate(): void {
    if (this.commitMessage() || this.commitDescription()) return;
    const template = this.git.repository()?.commitTemplate;
    if (!template) return;
    const [summary, ...description] = template.trim().split('\n');
    const body = parseCoAuthors(description.join('\n').trim());
    this.commitMessage.set(summary);
    this.commitDescription.set(body.body);
    this.coAuthors.set(body.authors);
  }

  protected openBranchCreatorFromToolbarMenu(): void {
    const returnFocus = this.toolbarMenuReturnFocus;
    this.closeToolbarMenus();
    this.openBranchCreator(undefined, returnFocus);
  }

  protected openBranchCreator(suggestedName?: string, returnFocus: HTMLElement | null = null): void {
    if (this.git.busy()) return;
    const suggestion = suggestedName?.trim();
    if (!this.branchCreatorOpen()) {
      this.branchCreatorReturnFocus = returnFocus
        ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    if (!this.branchCreatorOpen() || suggestion) {
      this.branchName.set(suggestion || 'new-branch');
      this.branchCreationError.set(null);
    }
    this.setPanelVisibility('left-panel', true);
    this.maximizedReferenceSection.set(null);
    this.localBranchesOpen.set(true);
    this.branchCreatorOpen.set(true);
    const height = this.referenceSectionHeights().local;
    if (height !== null && height < 150) {
      this.branchCreatorPreviousLocalHeight = height;
      this.referenceSectionHeights.update((heights) => ({ ...heights, local: 150 }));
    }
    const repositoryId = this.git.repository()?.id;
    window.setTimeout(() => {
      if (!this.branchCreatorOpen() || this.git.repository()?.id !== repositoryId) return;
      const input = document.querySelector<HTMLInputElement>('.branch-create-form input[name="branch"]');
      input?.scrollIntoView({ block: 'nearest' });
      input?.focus();
      input?.select();
    }, 0);
  }

  protected closeBranchCreator(): void {
    if (this.git.busy()) return;
    const form = document.querySelector<HTMLElement>('.branch-create-form');
    this.restoreBranchCreatorSectionHeight();
    this.branchCreatorOpen.set(false);
    this.branchName.set('');
    this.branchCreationError.set(null);
    const target = this.branchCreatorReturnFocus;
    this.branchCreatorReturnFocus = null;
    queueMicrotask(() => {
      if (this.branchCreatorOpen() || !this.canRestoreFocusFrom(form)) return;
      if (target && target !== document.body && target !== document.documentElement
          && target.isConnected && target.getClientRects().length) {
        target.focus({ preventScroll: true });
        if (document.activeElement === target) return;
      }
      document.querySelector<HTMLButtonElement>('[aria-label="Create branch"]')?.focus({ preventScroll: true });
    });
  }

  private canRestoreFocusFrom(container: Element | null): boolean {
    const active = document.activeElement;
    return !active || active === document.body || active === document.documentElement
      || !active.isConnected || !!container?.contains(active);
  }

  private restoreBranchCreatorSectionHeight(): void {
    const height = this.branchCreatorPreviousLocalHeight;
    this.branchCreatorPreviousLocalHeight = null;
    if (height !== null && this.referenceSectionHeights().local === 150) {
      this.referenceSectionHeights.update((heights) => ({ ...heights, local: height }));
    }
  }

  protected handleBranchCreatorKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.closeBranchCreator();
  }

  private selectRelativeCommit(offset: number): void {
    const rows = this.visibleGraphRows();
    if (!rows.length) return;
    const selected = this.selectedCommit();
    const current = selected ? rows.findIndex((row) => row.commit.oid === selected) : -1;
    const next = current < 0
      ? (offset > 0 ? 0 : rows.length - 1)
      : Math.max(0, Math.min(rows.length - 1, current + offset));
    this.selectGraphCommit(rows[next].commit.oid);
  }

  protected navigateSelectedCommit(direction: -1 | 1): void {
    const navigation = this.selectedCommitNavigation();
    const target = direction < 0 ? navigation.newer : navigation.older;
    if (target) this.selectGraphCommit(target.oid);
  }

  private selectRelativeCommitInBranch(direction: -1 | 1): void {
    const visibleRows = this.visibleGraphRows();
    if (!visibleRows.length) return;
    const selected = this.selectedCommit();
    if (!selected) {
      this.selectRelativeCommit(direction);
      return;
    }

    const allRows = this.graphRows();
    const rowsByOid = new Map(allRows.map((row) => [row.commit.oid, row]));
    const visibleOids = new Set(visibleRows.map((row) => row.commit.oid));
    let nextOid: string | undefined;
    if (direction > 0) {
      let candidate = rowsByOid.get(selected)?.commit.parents[0];
      while (candidate && !visibleOids.has(candidate)) candidate = rowsByOid.get(candidate)?.commit.parents[0];
      nextOid = candidate;
    } else {
      const children = new Map<string, string[]>();
      for (const row of allRows) {
        const parent = row.commit.parents[0];
        if (parent) children.set(parent, [...(children.get(parent) ?? []), row.commit.oid]);
      }
      const pending = (children.get(selected) ?? []).map((oid) => ({ oid, distance: 1 }));
      const visited = new Set<string>();
      const candidates: Array<{ oid: string; distance: number; laneDistance: number }> = [];
      const selectedLane = rowsByOid.get(selected)?.nodeOffset ?? 0;
      while (pending.length) {
        const candidate = pending.shift()!;
        if (visited.has(candidate.oid)) continue;
        if (candidates.length && candidate.distance > candidates[0].distance) break;
        visited.add(candidate.oid);
        if (visibleOids.has(candidate.oid)) {
          candidates.push({
            ...candidate,
            laneDistance: Math.abs((rowsByOid.get(candidate.oid)?.nodeOffset ?? selectedLane) - selectedLane),
          });
          continue;
        }
        pending.push(...(children.get(candidate.oid) ?? []).map((oid) => ({ oid, distance: candidate.distance + 1 })));
      }
      nextOid = candidates.sort((left, right) => left.laneDistance - right.laneDistance)[0]?.oid;
    }
    if (nextOid) this.selectGraphCommit(nextOid);
  }

  private selectConnectedCommit(direction: -1 | 1): void {
    const selected = this.selectedCommit();
    const visibleRows = this.visibleGraphRows();
    if (!selected || !visibleRows.length) {
      this.selectRelativeCommit(direction);
      return;
    }
    const currentIndex = visibleRows.findIndex((row) => row.commit.oid === selected);
    if (currentIndex < 0) return;
    const current = visibleRows[currentIndex];
    const children = visibleRows.filter((row) => row.commit.parents.includes(selected));
    const parents = current.commit.parents
      .map((oid) => visibleRows.find((row) => row.commit.oid === oid))
      .filter((row): row is GraphRow => !!row);
    const candidate = [...parents, ...children]
      .filter((row) => direction < 0 ? row.nodeOffset < current.nodeOffset : row.nodeOffset > current.nodeOffset)
      .sort((left, right) => {
        const horizontal = Math.abs(left.nodeOffset - current.nodeOffset) - Math.abs(right.nodeOffset - current.nodeOffset);
        if (horizontal) return horizontal;
        const leftIndex = visibleRows.findIndex((row) => row.commit.oid === left.commit.oid);
        const rightIndex = visibleRows.findIndex((row) => row.commit.oid === right.commit.oid);
        return Math.abs(leftIndex - currentIndex) - Math.abs(rightIndex - currentIndex);
      })[0];
    if (candidate) this.selectGraphCommit(candidate.commit.oid);
  }

  private selectGraphCommit(oid: string): void {
    this.selectCommit(oid);
    this.scrollGraphCommitIntoView(oid, 'nearest');
  }

  private selectGraphBoundary(last: boolean): void {
    const rows = this.visibleGraphRows();
    const row = last ? rows.at(-1) : rows[0];
    if (!row) return;
    this.selectCommit(row.commit.oid);
    this.scrollGraphCommitIntoView(row.commit.oid, last ? 'end' : 'start');
  }

  private activateRelativeRepository(offset: number): void {
    const repositories = this.git.repositories();
    if (repositories.length < 2) return;
    const current = repositories.findIndex((repository) => repository.id === this.git.activeRepositoryId());
    const next = (current + offset + repositories.length) % repositories.length;
    this.activateRepository(repositories[next].id);
  }

  protected openFavoriteRepository(path: string): void {
    const repository = this.git.repositories().find((candidate) => candidate.path === path);
    if (repository) {
      this.activateRepository(repository.id);
      this.repositoryDialog.set(null);
    } else {
      void this.openRepositoryPath(path, true);
    }
  }

  protected async createBranch(): Promise<void> {
    if (this.git.busy()) return;
    const name = this.branchName().trim();
    if (!name) {
      this.branchCreationError.set('Enter a branch name.');
      return;
    }
    const repositoryId = this.git.repository()?.id;
    this.branchCreationError.set(null);
    const result = await this.git.createBranch(name);
    if (this.git.repository()?.id !== repositoryId || !this.branchCreatorOpen() || !result) return;
    if (result.status === 'success') this.closeBranchCreator();
    else {
      this.branchCreationError.set(result.error ?? 'Branch creation was interrupted. Try again.');
      queueMicrotask(() => requestAnimationFrame(() => {
        const form = document.querySelector<HTMLElement>('.branch-create-form');
        if (this.git.repository()?.id === repositoryId && this.branchCreatorOpen() && this.canRestoreFocusFrom(form)) {
          form?.querySelector<HTMLInputElement>('input[name="branch"]')?.focus();
        }
      }));
    }
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  protected authorColor(name: string, email: string): string {
    const identity = this.authorIdentity(name, email);
    return this.authorColors().get(identity) ?? stableAuthorColor(identity);
  }

  private authorIdentity(name: string, email: string): string {
    return (email || name).trim().toLowerCase();
  }

  protected shortOid(oid: string): string {
    return oid.slice(0, 8);
  }

  protected fileName(path: string): string {
    const normalized = path.replace(/\/+$/, '');
    return normalized.slice(normalized.lastIndexOf('/') + 1);
  }

  protected fileDirectory(path: string): string {
    const normalized = path.replace(/\/+$/, '');
    const separator = normalized.lastIndexOf('/');
    return separator < 0 ? '' : normalized.slice(0, separator + 1);
  }

  private matchesFileFilter(path: string, previousPath?: string | null): boolean {
    const query = this.fileFilterQuery();
    return !query || path.toLocaleLowerCase().includes(query) || !!previousPath?.toLocaleLowerCase().includes(query);
  }

  protected statusDescription(entry: WorkingTreeEntry, staged: boolean): string {
    return describeWorkingTreeStatus(entry, staged);
  }

  protected isUntrackedDirectory(entry: WorkingTreeEntry): boolean {
    return entry.indexStatus === '?' && entry.path.endsWith('/');
  }

  protected async expandUntrackedDirectory(path: string): Promise<void> {
    await this.git.loadMoreChanges(true);
    const directory = path.replace(/\/+$/, '');
    this.collapsedWorkingTreeDirectories.update((directories) =>
      directories.filter((candidate) => candidate !== directory));
  }

  protected decorationLabel(decoration: string): string {
    const label = decoration.replace(/^HEAD ->\s*/, '').replace(/^tag:\s*/, '');
    const branch = this.branchForRawDecoration(label);
    if (branch) return branch.name;
    return label
      .replace(/^refs\/heads\//, '')
      .replace(/^heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^remotes\//, '');
  }

  protected decorationKind(decoration: string): 'head' | 'tag' | 'remote' | 'local' | 'checkpoint' {
    if (decoration.startsWith('HEAD ->')) return 'head';
    if (decoration.startsWith('tag:')) return 'tag';
    if (decoration.startsWith('refs/copilot/checkpoints/')) return 'checkpoint';
    const branch = this.branchForRawDecoration(decoration);
    if (branch) return branch.remote ? 'remote' : 'local';
    if (/^(?:refs\/)?remotes\//.test(decoration)) return 'remote';
    return 'local';
  }

  private branchForRawDecoration(decoration: string): Branch | null {
    if (decoration.startsWith('refs/copilot/checkpoints/')) return null;
    const fullName = decoration.startsWith('refs/')
      ? decoration
      : decoration.startsWith('heads/') || decoration.startsWith('remotes/')
        ? `refs/${decoration}`
        : null;
    const normalized = decoration
      .replace(/^refs\/heads\//, '')
      .replace(/^heads\//, '')
      .replace(/^refs\/remotes\//, '')
      .replace(/^remotes\//, '');
    const index = this.branchByDecoration();
    return index.get(decoration)
      ?? (fullName ? index.get(fullName) : null)
      ?? index.get(normalized)
      ?? null;
  }

  protected remoteLocationName(branchName: string): string {
    const separator = branchName.indexOf('/');
    return separator > 0 ? branchName.slice(0, separator) : branchName;
  }

  protected remoteBranchLabel(branchName: string): string {
    const separator = branchName.indexOf('/');
    return separator > 0 ? branchName.slice(separator + 1) : branchName;
  }

  private remoteNameOrder(upstream: string | null): Map<string, number> {
    const configured = this.git.repository()?.remotes.map((remote) => remote.name) ?? [];
    return new Map(buildRemoteNameOrder(configured, upstream));
  }

  private compareRemoteBranches(left: Branch, right: Branch, order: ReadonlyMap<string, number>): number {
    return compareRemoteNames(
      this.remoteLocationName(left.name),
      this.remoteLocationName(right.name),
      order,
    ) || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  }

  private remoteGroupBranchNames(remote: string): string[] {
    return this.remoteBranchNamesByLocation().get(remote) ?? [];
  }

  protected isRemoteHidden(remote: string): boolean {
    const names = this.remoteGroupBranchNames(remote);
    const hidden = this.hiddenBranchSet();
    return !!names.length && names.every((name) => hidden.has(name));
  }

  protected isRemoteCollapsed(remote: string): boolean {
    return this.collapsedRemoteLocations().includes(remote);
  }

  protected toggleRemoteCollapsed(event: Event, remote: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.collapsedRemoteLocations.update((collapsed) => collapsed.includes(remote)
      ? collapsed.filter((name) => name !== remote)
      : [...collapsed, remote]);
    this.storeCollapsedRemoteLocations();
  }

  protected isRemoteSoloed(remote: string): boolean {
    const names = this.remoteGroupBranchNames(remote);
    const solo = this.soloBranchSet();
    return !!names.length && names.every((name) => solo.has(name));
  }

  protected toggleRemoteVisibility(event: Event, remote: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.soloBranches().length) this.toggleRemoteSolo(remote);
    else this.toggleRemoteHidden(remote);
  }

  protected openRemoteGroupMenu(event: MouseEvent, remote: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('sidebar-context');
    this.contextMenu.set(null);
    this.stashContextMenu.set(null);
    this.fileContextMenu.set(null);
    this.commitFileContextMenu.set(null);
    this.worktreeMenuPath.set(null);
    this.submoduleMenuPath.set(null);
    this.referencePaneMenu.set(null);
    this.sidebarContextMenuReturnFocus = this.sidebarMenuReturnTarget(event, '.remote-collapse');
    const preferredPosition = { x: event.clientX, y: event.clientY };
    this.remoteGroupMenu.set({
      remote,
      x: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.x, window.innerWidth - 242)),
      y: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.y, window.innerHeight - 190)),
    });
    this.settleSidebarContextMenuPosition('remote', remote, preferredPosition);
  }

  protected toggleRemoteHidden(remote: string): void {
    const names = this.remoteGroupBranchNames(remote);
    if (!names.length) return;
    this.setSmartBranchVisibility(false);
    this.soloBranches.set([]);
    const group = new Set(names);
    const allHidden = names.every((name) => this.hiddenBranches().includes(name));
    this.hiddenBranches.update((hidden) => allHidden
      ? hidden.filter((name) => !group.has(name))
      : [...new Set([...hidden, ...names])]);
    this.dismissSidebarContextMenu(true);
    this.storeReferenceFilters();
  }

  protected toggleRemoteSolo(remote: string): void {
    const names = this.remoteGroupBranchNames(remote);
    if (!names.length) return;
    this.setSmartBranchVisibility(false);
    this.hiddenBranches.set([]);
    const group = new Set(names);
    const allSoloed = names.every((name) => this.soloBranches().includes(name));
    this.soloBranches.update((solo) => allSoloed
      ? solo.filter((name) => !group.has(name))
      : [...new Set([...solo, ...names])]);
    this.dismissSidebarContextMenu(true);
    this.storeReferenceFilters();
  }

  protected branchTrackingLabel(tracking: string): string {
    if (tracking === 'gone') return 'gone';
    const ahead = tracking.match(/ahead (\d+)/)?.[1];
    const behind = tracking.match(/behind (\d+)/)?.[1];
    return [ahead ? `↑${ahead}` : '', behind ? `↓${behind}` : ''].filter(Boolean).join(' ') || tracking;
  }

  protected checkoutRemoteBranch(event: Event, branchName: string): void {
    event.preventDefault();
    event.stopPropagation();
    void this.git.checkoutRemote(branchName);
  }

  protected remoteIcon(remote: string): RemoteLocationIcon {
    const selected = this.remoteLocationIcons()[remote];
    if (selected) return selected;
    const configured = this.git.repository()?.remotes.map((candidate) => candidate.name) ?? [];
    const stableOrder = buildRemoteNameOrder(configured, null);
    const index = stableOrder.get(remote) ?? 0;
    return REMOTE_LOCATION_ICONS[index % REMOTE_LOCATION_ICONS.length].value;
  }

  protected remoteIconForDecoration(decoration: string): RemoteLocationIcon {
    return this.remoteIcon(this.remoteLocationName(this.decorationLabel(decoration)));
  }

  protected setRemoteIcon(remote: string, value: string): void {
    if (!isRemoteLocationIcon(value)) return;
    this.remoteLocationIcons.update((icons) => ({ ...icons, [remote]: value }));
    try {
      localStorage.setItem(this.graphPreferenceKey('remote-icons'), JSON.stringify(this.remoteLocationIcons()));
    } catch {
      // Remote icon choices remain available for this session.
    }
  }

  protected visibleDecorations(commit: CommitSummary): string[] {
    if (!this.git.repository()) return commit.decorations;
    return commit.decorations.filter((decoration) => {
      const branch = this.branchForRawDecoration(decoration.replace(/^HEAD ->\s*/, ''));
      return !branch || this.isBranchGraphVisible(branch.name);
    });
  }

  protected compactReferenceSummary(decorations: readonly string[]): CompactReferenceSummary {
    return this.referencePresentation(decorations).summary;
  }

  protected referenceGroups(decorations: readonly string[]): ReferenceGroup[] {
    return this.referencePresentation(decorations).groups;
  }

  private referencePresentation(decorations: readonly string[]): ReferencePresentation {
    const branches = this.graphBranches();
    if (this.referencePresentationBranches !== branches) {
      this.referencePresentationBranches = branches;
      this.referencePresentationCache.clear();
    }
    const key = decorations.join('\x1f');
    const cached = this.referencePresentationCache.get(key);
    if (cached) return cached;
    const identities = decorations.map((decoration) => ({
      decoration,
      label: this.decorationLabel(decoration),
      kind: this.decorationKind(decoration),
    }));
    const presentation = {
      summary: buildCompactReferenceSummary(identities),
      groups: buildReferenceGroups(identities),
    };
    this.referencePresentationCache.set(key, presentation);
    return presentation;
  }

  protected referenceGroupHeading(groups: readonly ReferenceGroup[]): string {
    return describeReferenceGroups(groups);
  }

  protected branchForReferenceGroup(group: ReferenceGroup): Branch | null {
    for (const location of group.locations) {
      const branch = this.branchForDecoration(location.decoration);
      if (branch) return branch;
    }
    return null;
  }

  protected branchForDecoration(decoration: string): Branch | null {
    const branch = this.branchForRawDecoration(decoration.replace(/^HEAD ->\s*/, ''));
    return branch && !branch.remote ? branch : null;
  }

  protected isBranchHidden(name: string): boolean {
    return this.hiddenBranchSet().has(name);
  }

  protected isBranchSoloed(name: string): boolean {
    return this.soloBranchSet().has(name);
  }

  protected isBranchGraphVisible(name: string): boolean {
    const smart = this.smartVisibleBranchNames();
    if (this.smartBranchVisibility() && smart.length && !smart.includes(name)) return false;
    const solo = this.soloBranches();
    return solo.length ? solo.includes(name) : !this.hiddenBranches().includes(name);
  }

  protected toggleBranchVisibility(event: MouseEvent, name: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.smartBranchVisibility()) this.setSmartBranchVisibility(false);
    if (this.soloBranches().length) this.toggleSoloBranch(name);
    else this.toggleHiddenBranch(name);
  }

  protected hideContextBranch(): void {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'branch') return;
    this.toggleHiddenBranch(menu.label);
    this.contextMenu.set(null);
  }

  protected soloContextBranch(): void {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'branch') return;
    this.toggleSoloBranch(menu.label);
    this.contextMenu.set(null);
  }

  protected clearReferenceFilter(event: Event): void {
    if (!this.branchFilter()) return;
    event.preventDefault();
    event.stopPropagation();
    this.branchFilter.set('');
    queueMicrotask(() => this.branchSearch()?.nativeElement.focus());
  }

  protected clearReferenceFilters(): void {
    this.hiddenBranches.set([]);
    this.soloBranches.set([]);
    this.setSmartBranchVisibility(false);
    this.storeReferenceFilters();
  }

  protected isBranchPinned(name: string): boolean {
    return this.pinnedBranch() === name;
  }

  protected updateCommitSearch(query: string): void {
    this.commitFilter.set(query);
    this.commitSearchIndex.set(0);
    queueMicrotask(() => this.scrollToActiveCommitSearch());
  }

  protected loadMoreHistoryOnScroll(event: Event): void {
    const list = event.currentTarget as HTMLElement;
    if (list.scrollTop !== this.graphScrollTop()) {
      this.dismissGraphReferenceStack();
      this.deferGraphHover();
    }
    this.pendingGraphScrollElement = list;
    if (this.graphScrollFrame !== null) return;
    this.graphScrollFrame = requestAnimationFrame(() => {
      this.graphScrollFrame = null;
      const pending = this.pendingGraphScrollElement;
      this.pendingGraphScrollElement = null;
      if (!pending || pending !== this.commitListElement) return;
      this.updateGraphViewport(pending);
      this.prefetchOlderHistory(pending);
    });
  }

  protected updateCommitFilesViewport(event: Event): void {
    this.commitFilesScrollTop.set((event.currentTarget as HTMLElement).scrollTop);
  }

  protected updateWorkingTreeFilesViewport(section: WorkingTreeFileListSection, event: Event): void {
    const scrollTop = (event.currentTarget as HTMLElement).scrollTop;
    if (scrollTop === this.workingTreeFilesScrollTop[section]()) return;
    this.workingTreeFilesScrollTop[section].set(scrollTop);
    const viewport = section === 'unstaged' ? this.unstagedFilesViewport() : this.stagedFilesViewport();
    // Refresh only this viewport before the browser paints the new scroll position.
    viewport?.render();
  }

  private virtualReferenceWindow<T>(list: VirtualReferenceList, items: readonly T[]): VirtualWindow<T> {
    return calculateVirtualWindow(
      items,
      this.referenceListScrollTop[list](),
      this.referenceListViewportHeight[list](),
      REFERENCE_LIST_ROW_HEIGHT,
      0,
      REFERENCE_LIST_OVERSCAN_ROWS,
    );
  }

  protected updateReferenceListHeight(list: VirtualReferenceList, height: number): void {
    this.referenceListViewportHeight[list].set(Math.max(REFERENCE_LIST_ROW_HEIGHT, height));
  }

  protected updateReferenceListViewport(list: VirtualReferenceList, event: Event): void {
    const element = event.currentTarget as HTMLElement;
    if (element.scrollTop !== this.referenceListScrollTop[list]()) {
      this.referenceListScrollTop[list].set(element.scrollTop);
    }
    const viewportHeight = Math.max(REFERENCE_LIST_ROW_HEIGHT, element.clientHeight);
    if (viewportHeight !== this.referenceListViewportHeight[list]()) {
      this.referenceListViewportHeight[list].set(viewportHeight);
    }
  }

  protected handleReferenceListKeydown(list: VirtualReferenceList, event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !(event.target instanceof HTMLElement)) return;
    const row = event.target.closest<HTMLElement>('[data-reference-index]');
    if (!row) return;
    const rowIndex = Number(row.dataset['referenceIndex']);
    if (!Number.isInteger(rowIndex)) return;

    const controls = [...row.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )];
    const focusedControl = controls.findIndex((control) => control === document.activeElement);
    if (focusedControl < 0) return;

    const nextIndex = event.shiftKey
      ? focusedControl === 0 ? rowIndex - 1 : -1
      : focusedControl === controls.length - 1 ? rowIndex + 1 : -1;
    if (nextIndex < 0 || nextIndex >= this.referenceListLength(list)) return;

    event.preventDefault();
    const viewport = event.currentTarget as HTMLElement;
    const top = nextIndex * REFERENCE_LIST_ROW_HEIGHT;
    viewport.scrollTop = top;
    this.referenceListScrollTop[list].set(top);
    this.referenceListViewportHeight[list].set(
      Math.max(REFERENCE_LIST_ROW_HEIGHT, viewport.clientHeight),
    );
    requestAnimationFrame(() => {
      const nextRow = viewport.querySelector<HTMLElement>(
        `[data-reference-index="${nextIndex}"]`,
      );
      const nextControls = nextRow?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      nextControls?.item(event.shiftKey ? nextControls.length - 1 : 0)?.focus();
    });
  }

  private referenceListLength(list: VirtualReferenceList): number {
    switch (list) {
      case 'local': return this.visibleBranches().length;
      case 'remote': return this.remoteSidebarRows().length;
      case 'tags': return this.visibleTags().length;
      case 'stashes': return this.visibleStashes().length;
    }
  }

  protected handleWorkingTreeFileListNavigation(section: WorkingTreeFileListSection, event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'Home' && event.key !== 'End') return;
    const list = event.currentTarget as HTMLElement;
    event.preventDefault();
    event.stopPropagation();
    list.scrollTo({ top: event.key === 'Home' ? 0 : list.scrollHeight - list.clientHeight, behavior: 'instant' });
    this.updateWorkingTreeFilesViewport(section, event);
  }

  private prefetchOlderHistory(list: HTMLElement): void {
    const repository = this.git.repository();
    if (!repository?.historyTruncated || this.git.historyLoading()) return;
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
    const threshold = Math.max(COMMIT_ROW_HEIGHT * HISTORY_PREFETCH_ROWS, list.clientHeight * 6);
    if (remaining > threshold) return;
    void this.git.loadMoreHistory().then((loaded) => {
      if (!loaded || this.commitListElement !== list) return;
      queueMicrotask(() => this.prefetchOlderHistory(list));
    });
  }

  protected navigateCommitSearch(direction: -1 | 1): void {
    const count = this.commitSearchMatches().length;
    if (!count) return;
    this.commitSearchIndex.update((index) => (index + direction + count) % count);
    queueMicrotask(() => this.scrollToActiveCommitSearch());
  }

  protected handleCommitSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.navigateCommitSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape' && this.commitFilter()) {
      event.preventDefault();
      event.stopPropagation();
      this.updateCommitSearch('');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.commitSearchExpanded.set(false);
      queueMicrotask(() => this.commitSearchToggle()?.nativeElement.focus());
    }
  }

  protected clearCommitSearch(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.updateCommitSearch('');
    queueMicrotask(() => this.commitSearch()?.nativeElement.focus());
  }

  protected focusCommitSearch(): void {
    this.commitSearchExpanded.set(true);
    window.setTimeout(() => {
      const input = this.commitSearch()?.nativeElement;
      input?.focus();
      input?.select();
    });
  }

  protected openHistorySearch(): void {
    const panel = this.repositoryHistorySearch();
    if (panel) panel.open();
    else {
      this.historySearchLoaderOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.historySearchRequested.set(true);
    }
  }

  protected closeHistorySearchLoader(): void {
    this.historySearchRequested.set(false);
    if (this.historySearchLoaderOpener?.isConnected) this.historySearchLoaderOpener.focus();
    else this.historySearchToggle()?.nativeElement.focus();
  }

  protected handleCommitSearchFocusOut(event: FocusEvent): void {
    const container = event.currentTarget as HTMLElement;
    window.setTimeout(() => {
      if (!this.commitFilter().trim() && !container.contains(document.activeElement)) {
        this.commitSearchExpanded.set(false);
      }
    }, 0);
  }

  private scrollToActiveCommitSearch(): void {
    const oid = this.activeCommitSearchOid();
    if (!oid) return;
    this.scrollGraphCommitIntoView(oid, 'center', 'smooth');
  }

  protected jumpToReference(event: Event, oid: string): void {
    event.preventDefault();
    event.stopPropagation();
    void this.jumpToCommit(oid);
  }

  protected returnToHead(): void {
    const oid = this.currentBranch()?.oid ?? this.git.repository()?.headOid;
    if (!oid) return;
    this.updateCommitSearch('');
    this.authorFilter.set(null);
    this.authorFilterOpen.set(false);
    this.clearReferenceFilters();
    this.selectCommit(oid);
    this.setPanelVisibility('commit-panel', true);
    queueMicrotask(() => {
      this.commitListElement?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  protected activateGraphScrollMarker(marker: GraphScrollMarker): void {
    if (marker.oid) {
      this.selectGraphCommit(marker.oid);
      return;
    }
    const index = this.worktreeWipRows().findIndex((row) => row.worktree.path === marker.worktreePath);
    const row = index >= 0 ? this.worktreeWipRows()[index] : null;
    if (!row) return;
    this.selectWorktreeGraphRow(row.worktree);
    const target = index * WORKTREE_ROW_HEIGHT;
    this.graphScrollTop.set(target);
    queueMicrotask(() => this.commitListElement?.scrollTo({ top: target, behavior: 'smooth' }));
  }

  protected async jumpToCommit(oid: string): Promise<void> {
    let repository = this.git.repository();
    if (!repository) return;
    const repositoryId = repository.id;
    if (!repository.commits.some((commit) => commit.oid === oid)
      && !repository.stashes.some((stash) => stash.oid === oid) && repository.historyTruncated) {
      await this.git.loadMoreHistory();
      repository = this.git.repository();
    }
    if (!repository || repository.id !== repositoryId
      || (!repository.commits.some((commit) => commit.oid === oid)
        && !repository.stashes.some((stash) => stash.oid === oid))) return;
    this.updateCommitSearch('');
    this.authorFilter.set(null);
    this.authorFilterOpen.set(false);
    if (!this.visibleGraphRows().some((row) => row.commit.oid === oid)) this.clearReferenceFilters();
    this.selectCommit(oid);
    this.setPanelVisibility('commit-panel', true);
    queueMicrotask(() => this.scrollGraphCommitIntoView(oid, 'center', 'smooth'));
  }

  /**
   * Vertical scrolling only moves the virtualized rows. Horizontal metrics are re-read only when the
   * list scrolled sideways; resizes and column changes re-sync them through their own paths.
   */
  private updateGraphViewport(list: HTMLElement, resized = false): void {
    this.graphScrollTop.set(list.scrollTop);
    if (resized) this.graphViewportHeight.set(Math.max(COMMIT_ROW_HEIGHT, list.clientHeight));
    if (resized || list.scrollLeft !== this.graphHeaderScrollLeft) this.syncGraphHeader(list);
  }

  /** The header strip mirrors the history's horizontal scroll and never scrolls vertically. */
  protected restoreGraphHeaderScroll(header: HTMLElement): void {
    if (header.scrollTop !== 0) header.scrollTop = 0;
    const list = this.commitListElement;
    if (!list || Math.abs(header.scrollLeft - list.scrollLeft) < 1) return;
    // Focus moved horizontally into a heading outside the view (for example a resize handle reached
    // with Tab), so scroll the history with it; the list then keeps both aligned within its range.
    if (document.activeElement && header.contains(document.activeElement)) {
      list.scrollLeft = header.scrollLeft;
      this.syncGraphHeader(list);
    }
    if (Math.abs(header.scrollLeft - list.scrollLeft) >= 1) header.scrollLeft = list.scrollLeft;
  }

  private syncGraphHeader(list = this.commitListElement): void {
    if (!list) {
      this.graphCanScrollLeft.set(false);
      this.graphCanScrollRight.set(false);
      return;
    }
    const style = getComputedStyle(list);
    const borders = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
    this.graphScrollbarGutter.set(Math.max(0, list.offsetWidth - list.clientWidth - borders));
    this.graphViewportWidth.set(list.clientWidth);
    this.graphHeaderScrollLeft = list.scrollLeft;
    const header = this.graphColumns()?.nativeElement;
    if (header && header.scrollLeft !== list.scrollLeft) header.scrollLeft = list.scrollLeft;
    this.graphCanScrollLeft.set(list.scrollLeft > 1);
    this.graphCanScrollRight.set(list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
  }

  private scrollGraphCommitIntoView(
    oid: string,
    block: 'start' | 'center' | 'end' | 'nearest',
    behavior: ScrollBehavior = 'auto',
  ): void {
    const list = this.commitListElement;
    if (!list) return;
    const index = this.visibleGraphRows().findIndex((row) => row.commit.oid === oid);
    if (index < 0) return;

    const rowTop = this.worktreeWipRows().length * WORKTREE_ROW_HEIGHT + index * COMMIT_ROW_HEIGHT;
    const rowBottom = rowTop + COMMIT_ROW_HEIGHT;
    const viewportTop = list.scrollTop;
    const viewportBottom = viewportTop + list.clientHeight;
    let target = viewportTop;
    if (block === 'start') target = rowTop;
    else if (block === 'center') target = rowTop - (list.clientHeight - COMMIT_ROW_HEIGHT) / 2;
    else if (block === 'end') target = rowBottom - list.clientHeight;
    else if (rowTop < viewportTop) target = rowTop;
    else if (rowBottom > viewportBottom) target = rowBottom - list.clientHeight;

    target = Math.max(0, target);
    this.graphScrollTop.set(target);
    this.graphViewportHeight.set(Math.max(COMMIT_ROW_HEIGHT, list.clientHeight));
    queueMicrotask(() => list.scrollTo({ top: target, behavior }));
  }

  protected toggleContextBranchPin(): void {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'branch') return;
    this.pinnedBranch.set(this.pinnedBranch() === menu.label ? null : menu.label);
    this.contextMenu.set(null);
    this.storePinnedBranch();
  }

  protected startBranchDrag(event: DragEvent, name: string): void {
    if (this.git.busy()) {
      event.preventDefault();
      return;
    }
    this.draggedCommit.set(null);
    this.draggedBranch.set(name);
    this.dismissBranchDropMenu();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-git-khronos-branch', name);
      event.dataTransfer.setData('text/plain', name);
    }
  }

  protected allowBranchDrop(event: DragEvent, target: string): void {
    if (this.git.busy()) return;
    const commitOid = this.draggedCommit()?.oid
      ?? event.dataTransfer?.getData('application/x-git-khronos-commit');
    const source = this.draggedBranch()
      ?? event.dataTransfer?.getData('application/x-git-khronos-branch');
    const targetBranch = this.git.repository()?.branches.find(
      (branch) => !branch.remote && branch.name === target,
    );
    if ((!source && !commitOid) || source === target || commitOid === targetBranch?.oid) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = commitOid ? 'copy' : 'move';
    this.branchDropTarget.set(target);
  }

  protected dropBranch(event: DragEvent, target: string): void {
    if (this.git.busy()) {
      this.finishBranchDrag();
      return;
    }
    const commitOid = this.draggedCommit()?.oid
      ?? event.dataTransfer?.getData('application/x-git-khronos-commit');
    const source = this.draggedBranch()
      ?? event.dataTransfer?.getData('application/x-git-khronos-branch')
      ?? (commitOid ? null : event.dataTransfer?.getData('text/plain'));
    const draggedCommit = commitOid
      ? this.graphCommitByOid().get(commitOid) ?? null
      : null;
    this.finishBranchDrag();
    if (draggedCommit) {
      const returnFocus = event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : null;
      const targetBranch = this.git.repository()?.branches.find(
        (branch) => !branch.remote && branch.name === target,
      );
      if (!targetBranch || targetBranch.oid === draggedCommit.oid) return;
      event.preventDefault();
      event.stopPropagation();
      this.openHistoryConfirmation({
        kind: 'cherry-pick',
        oid: draggedCommit.oid,
        oids: [draggedCommit.oid],
        label: draggedCommit.subject || shortLabel(draggedCommit.oid),
        targetBranch: target,
      }, returnFocus);
      return;
    }
    if (!source || source === target) return;
    event.preventDefault();
    event.stopPropagation();
    this.branchDropMenuReturnFocus = event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : null;
    const preferredPosition = { x: event.clientX, y: event.clientY };
    this.branchDropMenu.set({
      source,
      target,
      x: Math.max(VIEWPORT_MENU_GUTTER, preferredPosition.x),
      y: Math.max(VIEWPORT_MENU_GUTTER, preferredPosition.y),
    });
    this.settleBranchDropMenuPosition(source, target, preferredPosition);
  }

  protected finishBranchDrag(): void {
    this.draggedBranch.set(null);
    this.draggedCommit.set(null);
    this.branchDropTarget.set(null);
  }

  protected startCommitDrag(event: DragEvent, commit: CommitSummary): void {
    if (this.stashForOid(commit.oid)) {
      event.preventDefault();
      return;
    }
    this.draggedBranch.set(null);
    this.draggedCommit.set({
      oid: commit.oid,
      label: commit.subject || shortLabel(commit.oid),
    });
    this.dismissBranchDropMenu();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-git-khronos-commit', commit.oid);
      event.dataTransfer.setData('text/plain', commit.oid);
    }
  }

  protected async runBranchDrop(strategy: 'merge' | 'ff-only' | 'squash' | 'rebase'): Promise<void> {
    const operation = this.branchDropMenu();
    if (!operation || this.git.busy()) return;
    const repositoryId = this.git.activeRepositoryId();
    this.dismissBranchDropMenu();
    const checkout = strategy === 'rebase' ? operation.source : operation.target;
    const integrate = strategy === 'rebase' ? operation.target : operation.source;
    if (this.git.repository()?.status.branch !== checkout) {
      const result = await this.git.checkout(checkout);
      if (result?.status !== 'success'
        || this.git.activeRepositoryId() !== repositoryId
        || this.git.repository()?.status.branch !== checkout) return;
    }
    await this.git.integrateBranch(integrate, strategy);
  }

  protected async openInteractiveRebaseFromDrop(): Promise<void> {
    const operation = this.branchDropMenu();
    if (!operation) return;
    this.dismissBranchDropMenu();
    await this.openInteractiveRebase(operation.source, operation.target);
  }

  protected async openInteractiveRebaseFromContext(): Promise<void> {
    const menu = this.contextMenu();
    const source = this.git.repository()?.status.branch;
    if (!menu || menu.kind !== 'branch' || !source || source === menu.label) return;
    this.contextMenu.set(null);
    await this.openInteractiveRebase(source, menu.label);
  }

  protected async openMergeRebase(): Promise<void> {
    const menu = this.contextMenu();
    const source = this.git.repository()?.status.branch;
    const repositoryId = this.git.activeRepositoryId();
    if (!menu || menu.kind !== 'branch' || !source || !repositoryId || source === menu.label || this.git.busy()) return;
    const returnFocus = this.contextMenuReturnFocus;
    this.contextMenu.set(null);
    const request = ++this.rebaseRequest;
    const plan = await this.git.prepareMergeRebase(repositoryId, source, menu.label);
    if (plan && request === this.rebaseRequest && repositoryId === this.git.activeRepositoryId()) {
      this.mergeRebaseReview.set({ repositoryId, plan, returnFocus });
    }
  }

  protected async openSelectedRebase(): Promise<void> {
    const menu = this.contextMenu();
    const source = this.git.repository()?.status.branch;
    if (!menu || menu.kind !== 'commit' || !source || this.git.busy()) return;
    this.contextMenu.set(null);
    await this.openInteractiveRebase(source, source, [...menu.oids]);
  }

  protected async openRootRebase(): Promise<void> {
    const menu = this.contextMenu();
    const source = this.git.repository()?.status.branch;
    if (!menu || menu.kind !== 'branch' || menu.label !== source || !source || this.git.busy()) return;
    this.contextMenu.set(null);
    await this.openInteractiveRebase(source, source, undefined, true);
  }

  protected selectRebaseStep(oid: string): void {
    this.selectedRebaseOid.set(oid);
  }
  protected handleRebaseLoaderKey(event: KeyboardEvent): void {
    if (event.key !== 'Tab' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') this.closeRebaseReviewLoader();
    else this.rebaseLoaderClose()?.nativeElement.focus();
  }
  protected closeRebaseReviewLoader(): void {
    this.interactiveRebase.set(null);
    this.mergeRebaseReview.set(null);
  }
  protected readonly rebaseAuthorColor = (name: string, email: string): string => this.authorColor(name, email);
  protected moveRebaseStep(oid: string, direction: -1 | 1): void {
    const state = this.interactiveRebase();
    if (!state || state.repositoryId !== this.git.activeRepositoryId() || this.git.busy()) return;
    const index = state.steps.findIndex(step => step.oid === oid);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= state.steps.length) return;
    const steps = [...state.steps];
    [steps[index], steps[destination]] = [steps[destination], steps[index]];
    this.interactiveRebase.set({ ...state, steps });
    this.selectedRebaseOid.set(oid);
  }

  protected updateRebasePlan(steps: RebaseStepView[]): void {
    const state = this.interactiveRebase();
    if (state) this.interactiveRebase.set({ ...state, steps });
  }

  protected setRebaseAction(oid: string, action: RebaseAction): void {
    const state = this.interactiveRebase();
    if (!state) return;
    const index = state.steps.findIndex((step) => step.oid === oid);
    if ((action === 'squash' || action === 'fixup') && !this.canCombineRebaseStep(index)) return;
    this.interactiveRebase.set({
      ...state,
      steps: state.steps.map((step) => step.oid === oid ? { ...step, action } : step),
    });
    this.selectedRebaseOid.set(oid);
  }

  protected canCombineRebaseStep(index: number): boolean {
    return this.interactiveRebase()?.steps.slice(0, index).some((step) => step.action !== 'drop') ?? false;
  }

  protected updateRebaseMessage(oid: string, message: string): void {
    const state = this.interactiveRebase();
    if (!state) return;
    this.interactiveRebase.set({
      ...state,
      steps: state.steps.map((step) => step.oid === oid ? { ...step, message } : step),
    });
  }

  protected setRebaseDestination(oid: string): void {
    const state = this.interactiveRebase();
    if (!state?.destinations || (oid && !state.destinations.some(destination => destination.oid === oid))) return;
    this.interactiveRebase.set({ ...state, ontoOid: oid || undefined });
  }

  protected resetInteractiveRebase(): void {
    const state = this.interactiveRebase();
    if (!state) return;
    const steps = state.original.map((step) => ({ ...step }));
    this.interactiveRebase.set({ ...state, steps });
    this.selectedRebaseOid.set(steps[0]?.oid ?? null);
  }

  protected startRebaseStepDrag(event: DragEvent, oid: string): void {
    this.draggedRebaseOid.set(oid);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', oid);
    }
  }

  protected dropRebaseStep(event: DragEvent, targetOid: string): void {
    event.preventDefault();
    const sourceOid = this.draggedRebaseOid() ?? event.dataTransfer?.getData('text/plain');
    const state = this.interactiveRebase();
    if (!state || !sourceOid || sourceOid === targetOid) return;
    const reordered = state.steps.filter((step) => step.oid !== sourceOid);
    const source = state.steps.find((step) => step.oid === sourceOid);
    const targetIndex = reordered.findIndex((step) => step.oid === targetOid);
    if (!source || targetIndex < 0) return;
    reordered.splice(targetIndex, 0, source);
    this.interactiveRebase.set({ ...state, steps: reordered });
    this.draggedRebaseOid.set(null);
  }

  protected async executeInteractiveRebase(): Promise<void> {
    const state = this.interactiveRebase();
    if (!state || !this.git.requireRecoveryRepository(state.repositoryId)) return;
    const steps: InteractiveRebaseStep[] = state.steps.map((step) => ({
      oid: step.oid,
      action: step.action,
      message: step.action === 'reword' ? step.message.trim() : null,
    }));
    this.interactiveRebase.set(null);
    this.selectedRebaseOid.set(null);
    await this.git.executeInteractiveRebase(state.source, state.target, steps, state.selectionOids, state.root, state.ontoOid);
    if (this.git.repository()?.status.rebaseInProgress) this.selectWip();
  }

  protected async controlRebase(action: 'continue' | 'skip' | 'abort'): Promise<void> {
    if (action === 'continue') await this.git.continueRebase();
    else if (action === 'skip') await this.git.skipRebase();
    else await this.git.abortRebase();
    if (this.git.repository()?.status.rebaseInProgress) this.selectWip();
  }

  protected async controlMerge(action: 'continue' | 'abort'): Promise<void> {
    if (action === 'continue') await this.git.continueMerge();
    else await this.git.abortMerge();
    if (this.git.repository()?.status.mergeInProgress) this.selectWip();
  }

  protected async controlHistoryOperation(action: 'continue' | 'skip' | 'abort' | 'quit'): Promise<void> {
    await this.git.controlHistoryOperation(action);
    if (this.git.repository()?.status.historyOperation) this.selectWip();
  }

  protected async openConflictTool(path: string): Promise<void> {
    if (this.git.busy()) return;
    const request = ++this.conflictActionRequest;
    if (!this.git.conflictDetails()) {
      this.conflictReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const details = await this.git.inspectConflict(path);
    if (details) {
      this.conflictOutput.set(details.output ?? details.current ?? details.incoming ?? '');
      afterNextRender(() => {
        if (request !== this.conflictActionRequest || this.git.conflictDetails() !== details) return;
        document.querySelector<HTMLElement>('[aria-label="Close conflict editor"]')?.focus();
      }, { injector: this.injector });
    }
  }

  protected useConflictSide(side: 'current' | 'incoming'): void {
    const details = this.git.conflictDetails();
    if (!details) return;
    this.conflictOutput.set(details[side] ?? '');
  }

  protected async resolveOpenConflict(resolution: 'current' | 'incoming' | 'output'): Promise<void> {
    const details = this.git.conflictDetails();
    if (!details || this.git.busy()) return;
    const request = ++this.conflictActionRequest;
    const repositoryId = this.git.activeRepositoryId();
    const succeeded = await this.git.resolveConflict(
      details.path,
      resolution,
      resolution === 'output' ? this.conflictOutput() : undefined,
    );
    if (request !== this.conflictActionRequest || repositoryId !== this.git.activeRepositoryId()
      || (this.git.conflictDetails() && this.git.conflictDetails() !== details)) return;
    if (succeeded) this.closeConflictTool();
    else if (this.git.conflictDetails() === details) afterNextRender(() => {
      if (request !== this.conflictActionRequest || this.git.conflictDetails() !== details) return;
      document.querySelector<HTMLElement>('.merge-tool [role="alert"]')?.focus();
    }, { injector: this.injector });
  }

  protected closeConflictTool(): void {
    const request = ++this.conflictActionRequest;
    this.git.closeConflict();
    const opener = this.conflictReturnFocus;
    this.conflictReturnFocus = null;
    afterNextRender(() => {
      if (request === this.conflictActionRequest && opener?.isConnected) opener.focus();
    }, { injector: this.injector });
  }

  protected handleConflictKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeConflictTool();
      return;
    }
    this.cycleDialogFocus(document.querySelector<HTMLElement>('.merge-tool') ?? undefined, event);
  }

  protected async resolveContextConflict(resolution: 'current' | 'incoming'): Promise<void> {
    const menu = this.fileContextMenu();
    if (!menu || !menu.conflicted) return;
    this.fileContextMenu.set(null);
    await this.git.resolveConflict(menu.path, resolution);
  }

  private setSelectedRebaseAction(action: RebaseAction): void {
    const oid = this.selectedRebaseOid();
    if (oid) this.setRebaseAction(oid, action);
  }

  private async openInteractiveRebase(source: string, target: string, selectionOids?: string[], root = false): Promise<void> {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId || this.git.busy()) return;
    const request = ++this.rebaseRequest;
    const plan = await this.git.prepareInteractiveRebase(source, target, selectionOids, root);
    if (!plan || request !== this.rebaseRequest || repositoryId !== this.git.activeRepositoryId()) return;
    const steps = plan.commits.map((commit): RebaseStepView => ({
      ...commit,
      action: 'pick',
    }));
    this.interactiveRebase.set({
      repositoryId,
      source: plan.source,
      target: plan.target,
      base: plan.base,
      selectionOids,
      root,
      destinations: selectionOids || root ? this.git.repository()?.branches
        .filter(branch => !plan.commits.some(commit => commit.oid === branch.oid))
        .map(branch => ({ oid: branch.oid, label: branch.name })) : undefined,
      remoteReachableOids: plan.remoteReachableOids ?? [],
      original: steps.map((step) => ({ ...step })),
      steps,
    });
    this.selectedRebaseOid.set(steps[0]?.oid ?? null);
  }

  protected highlightReference(oid: string | null): void {
    if (this.referenceHighlightTimer) {
      clearTimeout(this.referenceHighlightTimer);
      this.referenceHighlightTimer = null;
    }
    this.hoveredReferenceOid.set(oid);
  }

  protected previewReference(oid: string | null): void {
    if (this.referenceHighlightTimer) clearTimeout(this.referenceHighlightTimer);
    this.referenceHighlightTimer = null;
    if (!oid) {
      this.hoveredReferenceOid.set(null);
      return;
    }
    this.referenceHighlightTimer = setTimeout(() => {
      this.referenceHighlightTimer = null;
      this.hoveredReferenceOid.set(oid);
    }, 140);
  }

  protected scheduleTagPreview(event: Event, name: string, oid: string, immediate = false): void {
    if (this.tagPreviewTimer) clearTimeout(this.tagPreviewTimer);
    this.tagPreviewTimer = null;
    const bounds = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    if (!bounds) return;
    const open = () => {
      this.tagPreviewTimer = null;
      this.tagPreview.set({
        name,
        oid,
        x: Math.max(8, Math.min(bounds.right + 8, window.innerWidth - 300)),
        y: Math.max(8, Math.min(bounds.top, window.innerHeight - 170)),
      });
      void this.git.inspectTag(name, oid);
    };
    if (immediate) open();
    else this.tagPreviewTimer = setTimeout(open, 240);
  }

  protected closeTagPreview(): void {
    if (this.tagPreviewTimer) clearTimeout(this.tagPreviewTimer);
    this.tagPreviewTimer = null;
    this.tagPreview.set(null);
    this.git.clearTagInspection();
  }

  protected collapseReferenceStack(event: Event, oid: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu.set(null);
    this.cancelReferenceStackClose();
    this.expandedReferenceStackOid.set(null);
    this.pinnedReferenceStackOid.set(null);
    this.upwardReferenceStackOid.set(null);
    const stack = event.currentTarget as HTMLElement | null;
    this.collapsedReferenceStackOid.set(stack?.matches(':hover') ? oid : null);
    (event.target as HTMLElement | null)?.blur();
    this.highlightReference(null);
  }

  protected releaseReferenceStack(oid: string): void {
    if (this.collapsedReferenceStackOid() === oid) this.collapsedReferenceStackOid.set(null);
  }

  protected openReferenceStack(oid: string, event?: Event): void {
    if (event?.type === 'pointerenter' && this.graphHoverResumeTimer !== null) return;
    const pinnedOid = this.pinnedReferenceStackOid();
    if (pinnedOid && pinnedOid !== oid) return;
    this.cancelReferenceStackClose();
    if (this.collapsedReferenceStackOid() !== oid) {
      this.expandedReferenceStackOid.set(oid);
      this.positionReferenceStack(oid, event?.currentTarget as HTMLElement | null);
    }
  }

  protected openReferenceStackFromTrigger(event: Event, oid: string, focusFirst = false): void {
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('stack');
    this.cancelReferenceStackClose();
    const stack = (event.currentTarget as HTMLElement).closest<HTMLElement>('.commit-ref-stack');
    if (!focusFirst && this.pinnedReferenceStackOid() === oid) {
      this.expandedReferenceStackOid.set(null);
      this.pinnedReferenceStackOid.set(null);
      this.upwardReferenceStackOid.set(null);
      this.collapsedReferenceStackOid.set(stack?.matches(':hover') ? oid : null);
      return;
    }
    this.collapsedReferenceStackOid.set(null);
    this.pinnedReferenceStackOid.set(oid);
    this.expandedReferenceStackOid.set(oid);
    this.positionReferenceStack(oid, stack);
    if (focusFirst) this.focusReferenceStackItem(stack);
  }

  protected handleReferenceStackTriggerKeydown(event: KeyboardEvent, oid: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation();
      return;
    }
    const contextRequest = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!contextRequest && !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('stack');
    this.cancelReferenceStackClose();
    this.collapsedReferenceStackOid.set(null);
    this.pinnedReferenceStackOid.set(oid);
    this.expandedReferenceStackOid.set(oid);
    const stack = (event.currentTarget as HTMLElement).closest<HTMLElement>('.commit-ref-stack');
    this.positionReferenceStack(oid, stack);
    this.focusReferenceStackItem(stack, event.key === 'ArrowUp' || event.key === 'End');
  }

  protected handleReferenceStackMenuKeydown(event: KeyboardEvent, oid: string): void {
    const menu = event.currentTarget as HTMLElement;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelReferenceStackClose();
      this.expandedReferenceStackOid.set(null);
      this.pinnedReferenceStackOid.set(null);
      this.upwardReferenceStackOid.set(null);
      const stack = menu.closest<HTMLElement>('.commit-ref-stack');
      this.collapsedReferenceStackOid.set(stack?.matches(':hover') ? oid : null);
      queueMicrotask(() => menu.parentElement
        ?.querySelector<HTMLElement>('.reference-stack-trigger')
        ?.focus({ preventScroll: true }));
      return;
    }
    if (event.key === 'Tab') {
      this.scheduleReferenceStackClose(oid);
      return;
    }
    if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  protected openDetailReferenceStack(): void {
    this.cancelDetailReferenceStackClose();
    if (this.detailReferenceStackCollapsed()) return;
    this.detailReferenceStackOpen.set(true);
  }

  protected openDetailReferenceStackFromTrigger(event: Event, focusFirst = false): void {
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('stack');
    this.detailReferenceStackCollapsed.set(false);
    this.openDetailReferenceStack();
    if (focusFirst) {
      this.focusReferenceStackItem(
        (event.currentTarget as HTMLElement).closest<HTMLElement>('.commit-detail-ref-stack'),
      );
    }
  }

  protected handleDetailReferenceStackTriggerKeydown(event: KeyboardEvent): void {
    const contextRequest = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!contextRequest && !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('stack');
    this.openDetailReferenceStack();
    const stack = (event.currentTarget as HTMLElement).closest<HTMLElement>('.commit-detail-ref-stack');
    this.focusReferenceStackItem(stack, event.key === 'ArrowUp' || event.key === 'End');
  }

  protected handleDetailReferenceStackMenuKeydown(event: KeyboardEvent): void {
    const menu = event.currentTarget as HTMLElement;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelDetailReferenceStackClose();
      this.detailReferenceStackOpen.set(false);
      this.detailReferenceStackCollapsed.set(true);
      queueMicrotask(() => menu.parentElement
        ?.querySelector<HTMLElement>('.detail-reference-stack-trigger')
        ?.focus({ preventScroll: true }));
      return;
    }
    if (event.key === 'Tab') {
      this.scheduleDetailReferenceStackClose();
      return;
    }
    if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  protected collapseDetailReferenceStack(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cancelDetailReferenceStackClose();
    this.detailReferenceStackOpen.set(false);
    this.detailReferenceStackCollapsed.set(true);
    const stack = event.currentTarget as HTMLElement;
    queueMicrotask(() => stack.querySelector<HTMLElement>('.detail-reference-stack-trigger')
      ?.focus({ preventScroll: true }));
  }

  protected releaseDetailReferenceStack(): void {
    this.detailReferenceStackCollapsed.set(false);
  }

  protected handleDetailReferenceStackFocusOut(event: FocusEvent): void {
    this.scheduleDetailReferenceStackClose();
    const stack = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node) || !stack.contains(event.relatedTarget)) {
      this.releaseDetailReferenceStack();
    }
  }

  protected scheduleDetailReferenceStackClose(): void {
    this.cancelDetailReferenceStackClose();
    this.detailReferenceStackCloseTimer = setTimeout(() => {
      this.detailReferenceStackCloseTimer = null;
      this.detailReferenceStackOpen.set(false);
    }, 160);
  }

  private cancelDetailReferenceStackClose(): void {
    if (!this.detailReferenceStackCloseTimer) return;
    clearTimeout(this.detailReferenceStackCloseTimer);
    this.detailReferenceStackCloseTimer = null;
  }

  private focusReferenceStackItem(stack: HTMLElement | null, last = false): void {
    queueMicrotask(() => requestAnimationFrame(() => {
      const items = Array.from(stack?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      items[last ? items.length - 1 : 0].focus({ preventScroll: true });
    }));
  }

  protected scheduleReferenceStackClose(oid: string, event?: Event): void {
    const stack = event?.currentTarget as HTMLElement | null;
    this.cancelReferenceStackClose();
    this.referenceStackCloseTimer = setTimeout(() => {
      this.referenceStackCloseTimer = null;
      if (stack?.matches(':hover, :focus-within')) return;
      if (this.expandedReferenceStackOid() === oid) {
        this.expandedReferenceStackOid.set(null);
        if (this.pinnedReferenceStackOid() === oid) this.pinnedReferenceStackOid.set(null);
        this.upwardReferenceStackOid.set(null);
      }
    }, 160);
  }

  private positionReferenceStack(oid: string, target: HTMLElement | null): void {
    const stack = target?.classList.contains('commit-ref-stack')
      ? target
      : target?.closest<HTMLElement>('.commit-ref-stack');
    this.upwardReferenceStackOid.set(null);
    if (!stack) return;
    queueMicrotask(() => requestAnimationFrame(() => {
      if (this.expandedReferenceStackOid() !== oid) return;
      const popover = stack.querySelector<HTMLElement>('.reference-stack-popover');
      const history = stack.closest<HTMLElement>('.commit-list');
      if (!popover || !history) return;
      const popoverBox = popover.getBoundingClientRect();
      const stackBox = stack.getBoundingClientRect();
      const historyBox = history.getBoundingClientRect();
      const lowerBoundary = Math.min(window.innerHeight, historyBox.bottom) - 4;
      const upperBoundary = Math.max(0, historyBox.top) + 4;
      const fitsAbove = stackBox.bottom - popoverBox.height >= upperBoundary;
      if (popoverBox.bottom > lowerBoundary && fitsAbove) this.upwardReferenceStackOid.set(oid);
    }));
  }

  private cancelReferenceStackClose(): void {
    if (!this.referenceStackCloseTimer) return;
    clearTimeout(this.referenceStackCloseTimer);
    this.referenceStackCloseTimer = null;
  }

  private dismissGraphReferenceStack(): void {
    this.cancelReferenceStackClose();
    this.expandedReferenceStackOid.set(null);
    this.pinnedReferenceStackOid.set(null);
    this.upwardReferenceStackOid.set(null);
    this.collapsedReferenceStackOid.set(null);
  }

  protected isCommitHighlighted(oid: string): boolean {
    return this.highlightedCommitOids()?.has(oid) ?? false;
  }

  protected isCommitDimmed(oid: string): boolean {
    const highlighted = this.highlightedCommitOids();
    return highlighted !== null && !highlighted.has(oid);
  }

  protected graphSegmentPath(segment: GraphSegment): string {
    return buildGraphSegmentPath(segment);
  }

  protected graphLaneColor(oid: string): number {
    return this.visibleGraphRowByOid().get(oid)?.color ?? 0;
  }

  protected previewCommit(oid: string | null): void {
    if (this.graphHoverResumeTimer !== null) return;
    this.hoveredCommitOid.set(oid);
  }

  protected ghostBranchFor(oid: string): Branch | null {
    const ghost = this.ghostBranch();
    return ghost?.commitOid === oid ? ghost.branch : null;
  }

  protected async checkoutGhostBranch(event: Event, branch: Branch): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.hoveredCommitOid.set(null);
    await this.git.checkout(branch.name);
  }

  protected selectCommit(oid: string): void {
    if (this.commitMessageEditing()) this.cancelCommitMessageEdit();
    this.clearPanelFileSelection();
    this.selectedWorktreePath.set(null);
    this.selectedCommits.set([oid]);
    this.commitSelectionAnchor.set(oid);
    this.selectedCommit.set(oid);
    if (!this.graphCommitByOid().has(oid)) {
      this.externalHistoryCommit.set(null);
      const repositoryId = this.git.activeRepositoryId();
      void this.historySearch.summary(oid).then(summary => {
        if (this.selectedCommit() === oid && this.git.activeRepositoryId() === repositoryId) this.externalHistoryCommit.set(summary);
      }).catch(error => {
        if (this.selectedCommit() === oid) this.git.error.set(String(error?.message ?? error));
      });
    }
    this.commitFilesScrollTop.set(0);
    this.changesOpen.set(false);
    this.setPanelVisibility('commit-panel', true);
    const stash = this.stashForOid(oid);
    if (stash) void this.git.inspectStash(stash);
    else void this.git.inspectCommit(oid);
  }

  protected handleCommitRowKeydown(event: KeyboardEvent, oid: string): void {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const commit = this.graphCommitByOid().get(oid);
      if (!commit) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement;
      const bounds = target.getBoundingClientRect();
      this.contextMenuReturnFocus = target;
      this.openCommitMenu(new MouseEvent('contextmenu', {
        clientX: Math.min(bounds.right - 16, bounds.left + 320),
        clientY: bounds.bottom,
      }), commit, true);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectCommit(oid);
      return;
    }

    const rows = this.visibleGraphRows();
    const currentIndex = rows.findIndex((row) => row.commit.oid === oid);
    if (currentIndex < 0 || !rows.length) return;

    if (event.key === 'ArrowUp' && currentIndex === 0 && !event.shiftKey) {
      const worktreeRows = Array.from(
        this.commitListElement?.querySelectorAll<HTMLElement>('.wip-row[data-graph-row]') ?? [],
      );
      const previousRow = worktreeRows.at(-1);
      if (!previousRow) return;
      event.preventDefault();
      event.stopPropagation();
      previousRow.click();
      queueMicrotask(() => {
        previousRow.scrollIntoView({ block: 'nearest' });
        previousRow.focus({ preventScroll: true });
      });
      return;
    }

    const pageSize = Math.max(1, Math.floor(this.graphViewportHeight() / COMMIT_ROW_HEIGHT) - 1);
    const appleBoundaryShortcut = this.primaryShortcutKey === '⌘' && event.metaKey;
    let nextIndex: number | null = null;
    if (appleBoundaryShortcut && event.key === 'ArrowDown') nextIndex = rows.length - 1;
    else if (appleBoundaryShortcut && event.key === 'ArrowUp') nextIndex = 0;
    else if (event.key === 'ArrowDown') nextIndex = Math.min(rows.length - 1, currentIndex + 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === 'PageDown') nextIndex = Math.min(rows.length - 1, currentIndex + pageSize);
    else if (event.key === 'PageUp') nextIndex = Math.max(0, currentIndex - pageSize);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = rows.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    event.stopPropagation();
    const nextOid = rows[nextIndex].commit.oid;
    if (event.shiftKey) this.extendCommitSelection(oid, nextOid);
    else this.selectCommit(nextOid);
    this.scrollGraphCommitIntoView(nextOid, 'nearest');
    queueMicrotask(() => requestAnimationFrame(() => {
      this.commitListElement
        ?.querySelector<HTMLElement>(`[data-commit-oid="${nextOid}"]`)
        ?.focus({ preventScroll: true });
    }));
  }

  protected selectCommitWithModifiers(event: MouseEvent, oid: string): void {
    if (this.consumeColumnResizeClickSuppression()) {
      event.stopPropagation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && this.changesOpen()) {
      this.startWorkingTreeComparison(oid);
      return;
    }
    this.clearPanelFileSelection();
    this.selectedWorktreePath.set(null);
    const rows = this.visibleGraphRows();
    const clickedIndex = rows.findIndex((row) => row.commit.oid === oid);
    if (clickedIndex < 0) return;
    const current = this.selectedCommits();
    let selection: string[];
    if (event.shiftKey && current.length) {
      const anchor = rows.findIndex((row) => row.commit.oid === this.commitSelectionAnchor());
      const start = Math.min(anchor < 0 ? clickedIndex : anchor, clickedIndex);
      const end = Math.max(anchor < 0 ? clickedIndex : anchor, clickedIndex);
      selection = rows.slice(start, end + 1).map((row) => row.commit.oid);
    } else if (event.ctrlKey || event.metaKey) {
      const selected = new Set(current);
      if (selected.has(oid)) selected.delete(oid);
      else selected.add(oid);
      selection = rows.map((row) => row.commit.oid).filter((candidate) => selected.has(candidate));
      this.commitSelectionAnchor.set(selected.has(oid) ? oid : selection.at(-1) ?? null);
    } else {
      this.selectCommit(oid);
      return;
    }

    if (!selection.length) {
      this.selectWip();
      return;
    }
    const primaryOid = selection.includes(oid) ? oid : selection.at(-1)!;
    this.applyCommitSelection(rows, selection, primaryOid);
  }

  private extendCommitSelection(focusedOid: string, targetOid: string): void {
    const rows = this.visibleGraphRows();
    const targetIndex = rows.findIndex((row) => row.commit.oid === targetOid);
    if (targetIndex < 0) return;

    const anchorOid = this.commitSelectionAnchor() ?? focusedOid;
    const anchorIndex = rows.findIndex((row) => row.commit.oid === anchorOid);
    const start = Math.min(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
    const end = Math.max(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex);
    const selection = rows.slice(start, end + 1).map((row) => row.commit.oid);
    this.commitSelectionAnchor.set(anchorIndex < 0 ? targetOid : anchorOid);
    this.clearPanelFileSelection();
    this.selectedWorktreePath.set(null);
    this.applyCommitSelection(rows, selection, targetOid);
  }

  private applyCommitSelection(
    rows: readonly GraphRow[],
    selection: string[],
    primaryOid: string,
  ): void {
    this.selectedCommits.set(selection);
    this.selectedCommit.set(primaryOid);
    this.changesOpen.set(false);
    this.setPanelVisibility('commit-panel', true);
    if (selection.length === 1) {
      const stash = this.stashForOid(primaryOid);
      if (stash) void this.git.inspectStash(stash);
      else void this.git.inspectCommit(primaryOid);
      return;
    }
    const indices = selection.map((selectedOid) => rows.findIndex((row) => row.commit.oid === selectedOid));
    const contiguous = selection.length <= 2 || Math.max(...indices) - Math.min(...indices) + 1 === selection.length;
    if (!contiguous) {
      this.git.clearComparisonInspection();
      return;
    }
    const ordered = rows.filter((row) => selection.includes(row.commit.oid));
    void this.git.compareCommits(ordered.at(-1)!.commit.oid, ordered[0].commit.oid);
  }

  protected selectWip(): void {
    if (this.commitMessageEditing()) this.cancelCommitMessageEdit();
    this.clearPanelFileSelection();
    this.selectedWorktreePath.set(null);
    this.selectedCommit.set(null);
    this.selectedCommits.set([]);
    this.commitSelectionAnchor.set(null);
    this.changesOpen.set(true);
    this.diffViewerOpen.set(false);
    this.diffViewerOpener = null;
    this.selectedDiffLineGroups.set([]);
    this.git.showWorkingTree();
  }

  protected async inspectWorkingTreeFile(path: string, staged: boolean): Promise<void> {
    this.selectedDiffLineGroups.set([]);
    await this.git.inspectWorkingTreeFile(path, staged);
    if (this.git.workingTreeFileDiff()) this.openDiffViewer();
  }

  protected async inspectCommitFile(file: CommitFile): Promise<void> {
    this.selectedDiffLineGroups.set([]);
    await this.git.inspectCommitFile(file);
    if (this.git.commitFileDiff()) this.openDiffViewer();
  }

  protected async inspectComparisonFile(file: CommitFile): Promise<void> {
    this.selectedDiffLineGroups.set([]);
    await this.git.inspectComparisonFile(file);
    if (this.git.comparisonFileDiff()) this.openDiffViewer();
  }

  protected selectPanelFile(
    event: MouseEvent,
    file: CommitFile,
    source: 'commit' | 'comparison',
    files: CommitFile[],
  ): void {
    const sameSource = this.panelFileSelectionSource() === source;
    const current = sameSource ? this.selectedPanelFiles() : [];
    let selected: string[];
    if (event.shiftKey && sameSource && this.panelFileSelectionAnchor()) {
      const anchorIndex = files.findIndex((candidate) => candidate.path === this.panelFileSelectionAnchor());
      const clickedIndex = files.findIndex((candidate) => candidate.path === file.path);
      const start = Math.min(anchorIndex < 0 ? clickedIndex : anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex < 0 ? clickedIndex : anchorIndex, clickedIndex);
      selected = files.slice(start, end + 1).map((candidate) => candidate.path);
    } else if (event.ctrlKey || event.metaKey) {
      const paths = new Set(current);
      if (paths.has(file.path)) paths.delete(file.path);
      else paths.add(file.path);
      selected = files.map((candidate) => candidate.path).filter((path) => paths.has(path));
      this.panelFileSelectionAnchor.set(paths.has(file.path) ? file.path : selected.at(-1) ?? null);
    } else {
      selected = [file.path];
      this.panelFileSelectionAnchor.set(file.path);
    }
    this.panelFileSelectionSource.set(selected.length ? source : null);
    this.selectedPanelFiles.set(selected);
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (source === 'comparison') void this.inspectComparisonFile(file);
    else void this.inspectCommitFile(file);
  }

  protected isPanelFileSelected(path: string, source: 'commit' | 'comparison'): boolean {
    if (this.panelFileSelectionSource() === source && this.selectedPanelFiles().length) {
      return this.selectedPanelFiles().includes(path);
    }
    return source === 'comparison'
      ? this.git.selectedComparisonFile() === path
      : this.git.selectedCommitFile() === path;
  }

  protected setDiffViewMode(mode: DiffViewMode): void {
    try {
      localStorage.setItem('git-khronos.diff.view-mode', mode);
    } catch {
      // The selected diff layout remains active for this session.
    }
    if (this.diffInsightMode() === 'diff' && this.diffViewMode() === mode) return;
    const position = this.captureDiffViewport();
    this.diffInsightMode.set('diff');
    this.diffViewMode.set(mode);
    this.afterDiffRender(() => {
      if (position) this.restoreDiffViewport(position);
      else this.scrollToDiffHunk(this.activeDiffHunk(), 'auto');
    });
  }

  private afterDiffRender(callback: () => void): void {
    this.stopDiffViewportTracking?.();
    const diff = this.activeDiff();
    const repoId = this.git.activeRepositoryId();
    const generation = this.diffViewerGeneration;
    const mode = this.diffViewMode();
    const request = ++this.diffScrollRequest;
    afterNextRender(() => {
      if (request !== this.diffScrollRequest || generation !== this.diffViewerGeneration || this.git.activeRepositoryId() !== repoId || this.activeDiff() !== diff || !this.diffViewerOpen() || this.diffInsightMode() !== 'diff' || this.diffViewMode() !== mode) return;
      callback();
    }, { injector: this.injector });
  }

  private captureDiffViewport(): DiffViewportPosition | null {
    const primary = this.focusedDiff()?.nativeElement;
    const scroller = primary?.querySelector<HTMLElement>('.split-diff-body') ?? primary;
    if (!scroller?.getClientRects().length) return null;
    const bounds = scroller.getBoundingClientRect();
    const top = bounds.top + scroller.clientTop;
    let anchor: DiffViewportPosition['anchor'] = null;
    // Hit-test only the visible viewport. Measuring every line forces skipped
    // content-visibility rows to lay out and can move the very anchor we save.
    for (let y = 1; y < scroller.clientHeight && !anchor; y += 4) {
      for (const fraction of [0.75, 0.25]) {
        const x = bounds.left + scroller.clientLeft + scroller.clientWidth * fraction;
        const line = document.elementFromPoint(x, top + y)?.closest<HTMLElement>('[data-diff-old-line], [data-diff-new-line]');
        if (!line || !scroller.contains(line)) continue;
        const attribute = line.hasAttribute('data-diff-new-line') ? 'data-diff-new-line' : 'data-diff-old-line';
        anchor = { attribute, line: line.getAttribute(attribute)!, offset: line.getBoundingClientRect().top - top };
        break;
      }
    }
    return { top: scroller.scrollTop, left: scroller.scrollLeft, anchor };
  }

  private restoreDiffViewport(position: DiffViewportPosition): void {
    const primary = this.focusedDiff()?.nativeElement;
    const scroller = primary?.querySelector<HTMLElement>('.split-diff-body') ?? primary;
    if (!scroller) return;
    let top = position.top;
    const anchor = position.anchor;
    const line = anchor ? scroller.querySelector<HTMLElement>(`[${anchor.attribute}="${anchor.line}"]`) : null;
    if (line && anchor) {
      // Reveal the anchor before measuring it, so content-visibility has laid
      // out the target instead of returning an offscreen estimated position.
      line.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
      const rect = line.getBoundingClientRect();
      // A wrapped source line may become shorter in the new layout. Keep at
      // least its last pixel visible rather than scrolling past that line.
      const offset = Math.max(anchor.offset, 1 - rect.height);
      top = scroller.scrollTop + rect.top - scroller.getBoundingClientRect().top - scroller.clientTop - offset;
    }
    // Layout continuity is immediate; explicit change navigation can animate.
    scroller.scrollTo({ top, left: position.left, behavior: 'auto' });
    if (line && anchor && this.diffWordWrap()) this.trackDiffViewport(scroller, line, anchor.offset, position.left);
  }

  private trackDiffViewport(scroller: HTMLElement, line: HTMLElement, offset: number, left: number): void {
    this.stopDiffViewportTracking?.();
    const content = scroller.querySelector('.diff-lines');
    if (!content || typeof ResizeObserver === 'undefined') return;
    const request = this.diffScrollRequest;
    const generation = this.diffViewerGeneration;
    const diff = this.activeDiff();
    const repoId = this.git.activeRepositoryId();
    let frame: number | null = null;
    let expectedTop = scroller.scrollTop;
    const current = () => request === this.diffScrollRequest && generation === this.diffViewerGeneration && this.git.activeRepositoryId() === repoId && this.activeDiff() === diff && this.diffViewerOpen() && this.diffInsightMode() === 'diff' && scroller.isConnected && line.isConnected;
    const stop = () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) scroller.removeEventListener(type, stop);
      scroller.removeEventListener('scroll', manualScroll);
      if (this.stopDiffViewportTracking === stop) this.stopDiffViewportTracking = null;
    };
    const manualScroll = () => {
      if (Math.abs(scroller.scrollTop - expectedTop) > 1) stop();
    };
    const observer = new ResizeObserver(() => {
      if (!current()) { stop(); return; }
      const rect = line.getBoundingClientRect();
      const desired = Math.max(offset, 1 - rect.height);
      const delta = rect.top - scroller.getBoundingClientRect().top - scroller.clientTop - desired;
      if (Math.abs(delta) < 1) return;
      const top = Math.max(0, Math.min(scroller.scrollTop + delta, scroller.scrollHeight - scroller.clientHeight));
      // At the beginning/end of a file, centering can be impossible. Do not
      // schedule resize corrections forever against a clamped scroll boundary.
      if (Math.abs(top - scroller.scrollTop) < 1) return;
      // Wrapped rows are measured as content-visibility reveals them. Realign
      // only the owned anchor; disconnect during writes to avoid resize loops.
      observer.disconnect();
      scroller.scrollTo({ top, left, behavior: 'auto' });
      expectedTop = scroller.scrollTop;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (current()) observer.observe(content);
        else stop();
      });
    });
    this.stopDiffViewportTracking = stop;
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) scroller.addEventListener(type, stop, { passive: true });
    scroller.addEventListener('scroll', manualScroll, { passive: true });
    observer.observe(content);
  }

  protected handleDiffModeKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-diff-mode]'),
    );
    if (!buttons.length) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
    else next = (current + 1) % buttons.length;
    const mode = buttons[next].dataset['diffMode'];
    if (mode !== 'hunk' && mode !== 'inline' && mode !== 'split') return;
    event.preventDefault();
    event.stopPropagation();
    this.setDiffViewMode(mode);
    buttons[next].focus();
  }

  protected navigateDiffHunk(direction: -1 | 1): void {
    const count = this.diffHunks().length;
    if (!count) return;
    const index = Math.max(0, Math.min(this.activeDiffHunk() + direction, count - 1));
    if (this.diffInsightMode() === 'diff') {
      this.jumpToDiffHunk(index);
      return;
    }
    const previousFocus = document.activeElement;
    this.activeDiffHunk.set(index);
    this.showFileDiff();
    this.afterDiffRender(() => {
      this.scrollToDiffHunk(this.activeDiffHunk());
      if (document.activeElement === previousFocus || document.activeElement === document.body) {
        const primary = this.focusedDiff()?.nativeElement;
        (primary?.querySelector<HTMLElement>('.split-diff-body') ?? primary)?.focus({ preventScroll: true });
      }
    });
  }

  protected async navigateDiffFile(direction: -1 | 1): Promise<void> {
    if (this.git.detailsBusy()) return;
    const currentIndex = this.activeDiffFileIndex();
    await this.selectDiffFile(currentIndex + direction, false);
  }

  protected toggleDiffFileMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.diffFileMenuOpen();
    const picker = (event.currentTarget as HTMLElement).closest('.diff-file-picker');
    this.diffFileMenuOpen.set(open);
    if (open) {
      setTimeout(() => picker
        ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"]')
        ?.focus({ preventScroll: true }));
    }
  }

  protected handleDiffFileMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeDiffFileMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      this.closeDiffFileMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  }

  protected closeDiffFileMenu(restoreFocus = false): void {
    this.diffFileMenuOpen.set(false);
    if (restoreFocus) setTimeout(() => this.diffFileMenuToggle()?.nativeElement.focus({ preventScroll: true }));
  }

  protected diffFileTargetPath(target: DiffFileNavigationTarget): string {
    return target.source === 'working' ? target.path : target.file.path;
  }

  protected diffFileTargetStatus(target: DiffFileNavigationTarget): string {
    if (target.source === 'working') {
      const entry = this.git.repository()?.status.entries.find(candidate => candidate.path === target.path);
      return (target.staged ? entry?.indexStatus : entry?.worktreeStatus) || '?';
    }
    return target.file.status.charAt(0) || '?';
  }

  protected diffFileStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied',
      T: 'Type changed', U: 'Unmerged', '?': 'Untracked',
    };
    return `Change status: ${labels[status] ?? status}`;
  }

  protected diffFileTargetContext(target: DiffFileNavigationTarget): string {
    if (target.source === 'working') return target.staged ? 'Staged' : 'Unstaged';
    return target.source === 'comparison' ? 'Comparison' : 'Commit';
  }

  protected diffFileTargetKey(target: DiffFileNavigationTarget): string {
    return target.source === 'working'
      ? `working:${target.staged ? 'staged' : 'unstaged'}:${target.path}`
      : `${target.source}:${target.file.path}`;
  }

  protected async selectDiffFile(index: number, restoreFocus = true): Promise<void> {
    if (this.git.detailsBusy()) return;
    const target = this.activeDiffFileTargets()[index];
    if (!target) return;
    this.diffFileMenuOpen.set(false);
    if (target.source === 'working') {
      await this.inspectWorkingTreeFile(target.path, target.staged);
    } else {
      this.panelFileSelectionSource.set(target.source);
      this.panelFileSelectionAnchor.set(target.file.path);
      this.selectedPanelFiles.set([target.file.path]);
      if (target.source === 'comparison') await this.inspectComparisonFile(target.file);
      else await this.inspectCommitFile(target.file);
    }
    if (restoreFocus) setTimeout(() => this.diffFileMenuToggle()?.nativeElement.focus({ preventScroll: true }));
  }

  protected jumpToDiffHunk(index: number): void {
    this.activeDiffHunk.set(index);
    this.afterDiffRender(() => this.scrollToDiffHunk(index));
  }

  private openDiffViewer(): void {
    const generation = ++this.diffViewerGeneration;
    const repoId = this.git.activeRepositoryId();
    const diff = this.activeDiff();
    const revealCommitContext = !!(this.git.commitFileDiff() || this.git.comparisonFileDiff());
    if (!this.diffViewerOpen()) {
      this.diffViewerOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.activeDiffHunk.set(0);
    this.diffFileMenuOpen.set(false);
    this.diffInsightMode.set('diff');
    this.diffViewerOpen.set(true);
    if (revealCommitContext) {
      requestAnimationFrame(() => {
        if (generation === this.diffViewerGeneration && this.diffViewerOpen() && this.git.activeRepositoryId() === repoId && this.activeDiff() === diff) {
          this.commitPanel()?.nativeElement.scrollTo({ top: 0, behavior: 'auto' });
        }
      });
    }
  }

  protected closeDiffViewer(): void {
    const generation = ++this.diffViewerGeneration;
    const repoId = this.git.activeRepositoryId();
    const previousFocus = document.activeElement;
    const returnFocus = document.querySelector<HTMLElement>(
      '.commit-panel .commit-file.selected, .commit-panel .file-row.selected .file-name-button',
    ) ?? this.diffViewerOpener;
    this.diffViewerOpen.set(false);
    this.diffFileMenuOpen.set(false);
    this.diffViewerOpener = null;
    this.selectedDiffLineGroups.set([]);
    setTimeout(() => {
      if (generation !== this.diffViewerGeneration || this.diffViewerOpen() || this.git.activeRepositoryId() !== repoId) return;
      if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus();
    });
  }

  protected showFileDiff(): void {
    this.diffInsightMode.set('diff');
  }

  protected async showFileHistory(): Promise<void> {
    if (this.diffInsightMode() === 'history') return;
    const diff = this.activeDiff();
    const revision = this.activeDiffRevision();
    if (!diff || !revision || !this.canInspectActiveFile()) return;
    this.diffInsightMode.set('history');
    await this.historySearch.resumeFile(revision, diff.path);
  }

  protected async showFileBlame(): Promise<void> {
    if (this.diffInsightMode() === 'blame') return;
    const diff = this.activeDiff();
    const revision = this.activeDiffRevision();
    if (!diff || !revision || !this.canInspectActiveFile()) return;
    this.diffInsightMode.set('blame');
    await this.git.resumeFileBlame(diff.path, revision);
  }

  private async openTrackedFileInsight(path: string, mode: 'history' | 'blame'): Promise<void> {
    const revision = this.git.repository()?.headOid;
    if (!revision) return;
    this.clearPanelFileSelection();
    this.selectedCommit.set(revision);
    this.selectedCommits.set([revision]);
    this.commitSelectionAnchor.set(revision);
    this.changesOpen.set(false);
    this.setPanelVisibility('commit-panel', true);
    this.git.commitDetails.set(null);
    this.git.commitComparison.set(null);
    this.git.comparisonFileDiff.set(null);
    this.git.selectedComparisonFile.set(null);
    this.git.workingTreeFileDiff.set(null);
    this.git.selectedWorkingTreeFile.set(null);
    this.git.commitFileDiff.set({ oid: revision, path, patch: '', truncated: false });
    this.git.selectedCommitFile.set(path);
    this.openDiffViewer();
    this.diffInsightMode.set(mode);
    if (mode === 'history') await this.historySearch.openFile(revision, path);
    else await this.git.inspectFileBlame(path, revision);
  }

  private scrollToDiffHunk(index: number, behavior?: ScrollBehavior): void {
    const primary = this.focusedDiff()?.nativeElement;
    const line = primary?.querySelector<HTMLElement>(`[data-diff-hunk="${index}"]`);
    if (!primary || !line) return;
    const wrapped = this.diffWordWrap();
    line.scrollIntoView({ behavior: wrapped ? 'auto' : behavior ?? (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'), block: 'center' });
    if (wrapped) {
      const scroller = primary.querySelector<HTMLElement>('.split-diff-body') ?? primary;
      this.trackDiffViewport(scroller, line, Math.max(0, (scroller.clientHeight - line.getBoundingClientRect().height) / 2), scroller.scrollLeft);
    }
  }

  protected showHistoryComparison(): void {
    this.changesOpen.set(false);
    this.selectedCommits.set([]);
    this.setPanelVisibility('commit-panel', true);
  }

  protected clearHistoryComparison(): void {
    this.git.commitComparison.set(null);
    this.git.comparisonFileDiff.set(null);
    const oid = this.git.repository()?.headOid;
    if (oid) this.selectCommit(oid);
    else this.changesOpen.set(true);
  }

  protected async openHistoricalFile(oid: string, path: string, previousPath: string | null = null): Promise<void> {
    const repositoryId = this.git.activeRepositoryId();
    this.selectedCommit.set(oid);
    this.selectedCommits.set([oid]);
    this.changesOpen.set(false);
    this.setPanelVisibility('commit-panel', true);
    try {
      const summary = await this.historySearch.summary(oid);
      if (this.git.activeRepositoryId() !== repositoryId || this.selectedCommit() !== oid) return;
      this.externalHistoryCommit.set(summary);
    }
    catch (error) { this.git.error.set(String((error as { message?: unknown })?.message ?? error)); return; }
    await this.git.inspectCommit(oid);
    if (this.git.activeRepositoryId() !== repositoryId || this.selectedCommit() !== oid) return;
    await this.git.inspectCommitFile({ path, previousPath, status: previousPath ? 'R' : 'M', additions: null, deletions: null });
    this.diffInsightMode.set('diff');
  }

  protected async navigateBlame(oid: string, path: string, parent: boolean): Promise<void> {
    try {
      const navigation = await this.historySearch.navigation(oid, path);
      if (parent) {
        if (!navigation.parents.length) {
          this.git.error.set('This is a root commit; it has no parent.');
          return;
        }
        await this.openHistoricalFile(navigation.parents[0], navigation.parentPath ?? path);
      } else {
        await this.openHistoricalFile(navigation.oid, navigation.path, navigation.parentPath === navigation.path ? null : navigation.parentPath);
      }
    } catch (error) {
      this.git.error.set(typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error));
    }
  }

  protected canEditSelectedCommitMessage(): boolean {
    const repository = this.git.repository();
    const commit = this.selectedCommitData();
    return !!repository?.headOid && !repository.status.rebaseSplit && commit?.oid === repository.headOid;
  }

  protected canEditContextCommitMessage(): boolean {
    const menu = this.contextMenu();
    return menu?.kind === 'commit'
      && menu.oids.length === 1
      && !this.git.repository()?.status.rebaseSplit
      && menu.oid === this.git.repository()?.headOid;
  }

  protected selectedHeadIsPublished(): boolean {
    const repository = this.git.repository();
    const currentBranch = repository?.branches.find((branch) => branch.current && !branch.remote);
    return !!currentBranch?.upstream && repository?.status.ahead === 0;
  }

  protected beginCommitMessageEdit(): void {
    if (!this.canEditSelectedCommitMessage()) return;
    const commit = this.selectedCommitData();
    if (!commit) return;
    const details = this.git.commitDetails();
    const body = details?.oid === commit.oid
      ? commitMessageBody(details.message)
      : commit.description;
    const parsed = parseCoAuthors(body);
    this.editedCommitSummary.set(commit.subject);
    this.editedCommitDescription.set(parsed.body);
    this.editedCommitCoAuthors.set(parsed.authors);
    this.commitMessageEditing.set(true);
    setTimeout(() => {
      this.editedCommitSummaryInput()?.nativeElement.focus();
      this.editedCommitSummaryInput()?.nativeElement.select();
    });
  }

  protected editContextCommitMessage(): void {
    if (!this.canEditContextCommitMessage()) return;
    const oid = this.contextMenu()!.oid;
    this.contextMenu.set(null);
    this.selectCommit(oid);
    this.beginCommitMessageEdit();
  }

  protected cancelCommitMessageEdit(): void {
    this.commitMessageEditing.set(false);
    this.editedCommitSummary.set('');
    this.editedCommitDescription.set('');
    this.editedCommitCoAuthors.set([]);
  }

  protected removeEditedCommitCoAuthor(email: string): void {
    this.editedCommitCoAuthors.update((authors) => authors.filter((author) => author.email !== email));
  }

  protected async submitCommitMessageEdit(): Promise<void> {
    const repository = this.git.repository();
    const expectedOid = this.selectedCommitData()?.oid;
    const summary = this.editedCommitSummary().trim();
    if (!repository || !expectedOid || expectedOid !== repository.headOid || !summary || this.git.busy()) return;
    const trailers = this.editedCommitCoAuthors()
      .map((author) => `Co-authored-by: ${author.name} <${author.email}>`)
      .join('\n');
    const message = [summary, this.editedCommitDescription().trim(), trailers]
      .filter(Boolean)
      .join('\n\n');
    if (!await this.git.updateHeadMessage(expectedOid, message)) return;
    this.cancelCommitMessageEdit();
    const updatedOid = this.git.repository()?.headOid;
    if (updatedOid) this.selectCommit(updatedOid);
  }

  protected toggleAmend(enabled: boolean): void {
    this.amendPrevious.set(enabled);
    if (!enabled || this.commitMessage().trim()) return;
    const repository = this.git.repository();
    const head = repository?.commits.find((commit) => commit.oid === repository.headOid);
    if (!head) return;
    const parsed = parseCoAuthors(head.description);
    this.commitMessage.set(head.subject);
    this.commitDescription.set(parsed.body);
    this.coAuthors.set(parsed.authors);
  }

  protected async chooseRepository(returnFocus?: HTMLElement | null): Promise<void> {
    if (this.git.browserPreview()) {
      this.openRepositoryManager('manager', returnFocus);
      return;
    }
    const previous = this.git.activeRepositoryId();
    this.saveCommitDraft();
    await this.git.chooseRepository();
    if (this.git.activeRepositoryId() !== previous) {
      this.syncOpenTerminalToActiveRepository();
      this.restoreCommitDraft();
      this.selectWip();
      this.loadGraphPreferences();
    }
  }

  protected openRepositoryManager(mode: RepositoryDialogMode = 'manager', returnFocus?: HTMLElement | null): void {
    let opener = returnFocus === undefined && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : returnFocus ?? null;
    if (opener?.closest('.app-menu-popover')) opener = this.appMenuToggle()?.nativeElement ?? opener;
    this.repositoryDialogOpener = opener;
    this.repositoryDialog.set(mode);
    this.repositoryDialogFocusRequest.update((request) => request + 1);
  }

  protected closeRepositoryManager(): void {
    const opener = this.repositoryDialogOpener;
    this.repositoryDialog.set(null);
    this.repositoryDialogOpener = null;
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  protected handlePreferencesTabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const sections: PreferencesSection[] = ['general', 'graph', 'git', 'editor', 'terminal'];
    const tabs = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = Math.max(0, sections.indexOf(this.preferencesSection()));
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % sections.length;
    else next = (current - 1 + sections.length) % sections.length;
    event.preventDefault();
    this.preferencesSection.set(sections[next]);
    queueMicrotask(() => tabs[next]?.focus());
  }

  protected async browseFromRepositoryManager(): Promise<void> {
    const previous = this.git.activeRepositoryId();
    await this.chooseRepository();
    if (this.git.activeRepositoryId() !== previous) this.repositoryDialog.set(null);
  }

  protected finishRepositoryCreation(): void {
    this.syncOpenTerminalToActiveRepository();
    this.restoreCommitDraft();
    this.repositoryDialog.set(null);
    this.selectWip();
    this.loadGraphPreferences();
    const repositoryId = this.git.activeRepositoryId();
    if (repositoryId) this.revealRepositoryTab(repositoryId);
  }

  protected activateRepository(repoId: string): void {
    if (repoId === this.git.activeRepositoryId()) {
      this.revealRepositoryTab(repoId);
      return;
    }
    this.saveCommitDraft();
    this.git.activateRepository(repoId);
    if (this.terminalOpen()) this.showTerminalForRepository(repoId);
    this.restoreCommitDraft();
    this.selectWip();
    this.loadGraphPreferences();
    this.revealRepositoryTab(repoId);
  }

  protected closeRepository(repoId: string): void {
    const wasActive = repoId === this.git.activeRepositoryId();
    const terminalWasOpen = this.terminalOpen();
    if (!wasActive) this.commitDrafts.delete(repoId);
    this.terminalRepositoryIds.update((ids) => ids.filter((id) => id !== repoId));
    this.git.closeRepository(repoId);
    if (terminalWasOpen) {
      const nextRepositoryId = this.git.activeRepositoryId();
      if (nextRepositoryId) this.showTerminalForRepository(nextRepositoryId);
      else {
        this.terminalOpen.set(false);
        this.terminalRepositoryId.set(null);
      }
    } else if (this.terminalRepositoryId() === repoId) {
      this.terminalRepositoryId.set(null);
    }
    if (wasActive) {
      this.commitDrafts.delete(repoId);
      this.restoreCommitDraft();
      this.selectWip();
      this.loadGraphPreferences();
    }
    const activeRepositoryId = this.git.activeRepositoryId();
    if (activeRepositoryId) this.revealRepositoryTab(activeRepositoryId);
  }

  protected closeRepositoryFromTabButton(event: MouseEvent, repoId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeRepository(repoId);
    queueMicrotask(() => requestAnimationFrame(() => {
      this.focusRepositoryTab(this.git.activeRepositoryId());
    }));
  }

  protected async reopenClosedRepository(): Promise<void> {
    this.saveCommitDraft();
    if (!await this.git.reopenClosedRepository()) return;
    this.syncOpenTerminalToActiveRepository();
    this.restoreCommitDraft();
    this.selectWip();
    this.loadGraphPreferences();
    const repositoryId = this.git.activeRepositoryId();
    if (repositoryId) this.revealRepositoryTab(repositoryId);
  }

  protected closeTabOnMiddleClick(event: MouseEvent, repoId: string): void {
    if (event.button !== 1) return;
    event.preventDefault();
    this.closeRepository(repoId);
  }

  protected startTabDrag(event: DragEvent, repoId: string): void {
    this.draggedTabId.set(repoId);
    this.tabDropTarget.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', repoId);
    }
  }

  protected allowTabDrop(event: DragEvent, targetId: string): void {
    event.preventDefault();
    const sourceId = this.draggedTabId() ?? event.dataTransfer?.getData('text/plain');
    if (!sourceId) return;
    const edge = repositoryTabDropEdge(
      this.git.repositories().map((repository) => repository.id),
      sourceId,
      targetId,
    );
    this.tabDropTarget.set(edge ? { repoId: targetId, edge } : null);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  protected finishTabDrag(): void {
    this.draggedTabId.set(null);
    this.tabDropTarget.set(null);
  }

  protected dropTab(event: DragEvent, targetId: string): void {
    event.preventDefault();
    const sourceId = this.draggedTabId() ?? event.dataTransfer?.getData('text/plain');
    if (sourceId) this.git.reorderRepository(sourceId, targetId);
    this.finishTabDrag();
  }

  protected toggleRepositoryTabs(event: MouseEvent): void {
    event.stopPropagation();
    this.repositoryTabMenu.set(null);
    const open = !this.repositoryTabsOpen();
    this.repositoryTabsOpen.set(open);
    if (open) {
      window.setTimeout(() => this.repositoryTabsMenu()?.nativeElement
        .querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"]')
        ?.focus(), 0);
    }
  }

  protected handleRepositoryTabsMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeRepositoryTabsMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      this.repositoryTabsOpen.set(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    event.preventDefault();
    items[next].focus();
  }

  private closeRepositoryTabsMenu(restoreFocus = false): void {
    this.repositoryTabsOpen.set(false);
    if (restoreFocus) queueMicrotask(() => this.repositoryTabsToggle()?.nativeElement.focus());
  }

  protected toggleAppMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.workspaceMenuOpen.set(false);
    this.repositoryTabsOpen.set(false);
    this.repositoryTabMenu.set(null);
    this.toolbarRemoteMenuOpen.set(false);
    this.toolbarCheckoutMenuOpen.set(false);
    this.preferencesOpen.set(false);
    this.identityPopoverOpen.set(false);
    const open = !this.appMenuOpen();
    this.appMenuOpen.set(open);
    if (open) {
      setTimeout(() => document.querySelector<HTMLElement>('.app-menu-popover [role="menuitem"]')?.focus());
    }
  }

  protected handleAppMenuKeydown(event: KeyboardEvent): void {
    const menu = event.currentTarget as HTMLElement;
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .filter((item) => !item.hasAttribute('disabled'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeAppMenu(true);
      return;
    } else if (event.key === 'Tab') {
      // Angular removes the menu after this event; exclude its items now so
      // native Tab navigation can continue from the opener without losing focus.
      menu.inert = true;
      this.appMenuToggle()?.nativeElement.focus({ preventScroll: true });
      this.appMenuOpen.set(false);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  }

  private closeAppMenu(restoreFocus = false): void {
    this.appMenuOpen.set(false);
    if (restoreFocus) queueMicrotask(() => this.appMenuToggle()?.nativeElement.focus());
  }

  protected toggleWorkspaceMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.appMenuOpen.set(false);
    this.repositoryTabsOpen.set(false);
    this.toolbarRemoteMenuOpen.set(false);
    this.toolbarCheckoutMenuOpen.set(false);
    const open = !this.workspaceMenuOpen();
    this.workspaceMenuOpen.set(open);
    if (open) {
      setTimeout(() => document.querySelector<HTMLElement>('.workspace-menu [role="menuitemradio"]')?.focus());
    }
  }

  protected handleWorkspaceMenuKeydown(event: KeyboardEvent): void {
    const menu = event.currentTarget as HTMLElement;
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')]
      .filter((item) => !item.hasAttribute('disabled'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeWorkspaceMenu(true);
      return;
    } else if (event.key === 'Tab') {
      this.dismissWorkspaceMenuForTab();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  }

  private closeWorkspaceMenu(restoreFocus = false): void {
    this.workspaceMenuOpen.set(false);
    if (restoreFocus) queueMicrotask(() => this.workspaceToggle()?.nativeElement.focus());
  }

  private dismissWorkspaceMenuForTab(): void {
    const menu = document.querySelector<HTMLElement>('.workspace-menu');
    const opener = this.workspaceToggle()?.nativeElement;
    const active = document.activeElement;
    if (menu) menu.inert = true;
    // Do not pull focus back from a separate outside control. When disabling
    // items left focus on the document, resume native Tab order from the opener.
    if (active === document.body || active === opener || (active && menu?.contains(active))) {
      opener?.focus({ preventScroll: true });
    }
    this.workspaceMenuOpen.set(false);
  }

  protected openBranchWorkflows(returnFocus: HTMLElement | null = null): void {
    const repository = this.git.repository();
    if (!repository || repository.bare || this.git.busy()) return;
    const opener = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.workspaceMenuOpen.set(false);
    this.contextMenu.set(null);
    this.branchWorkflowRequest.set({ repositoryId: repository.id, path: repository.path,
      returnFocus: opener?.getAttribute('role') === 'menuitem' ? this.workspaceToggle()?.nativeElement ?? null : opener });
  }

  protected closeBranchWorkflowLoader(): void {
    const opener = this.branchWorkflowRequest()?.returnFocus;
    this.branchWorkflowRequest.set(null);
    setTimeout(() => { if (opener?.isConnected && opener.getClientRects().length) opener.focus(); else this.workspaceToggle()?.nativeElement.focus(); });
  }

  protected handleBranchWorkflowLoaderKey(event: KeyboardEvent): void {
    if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); this.branchWorkflowLoaderClose()?.nativeElement.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeBranchWorkflowLoader(); }
  }

  protected closeWorkspaceCenterLoader(): void {
    const opener = this.workspaceCenterRequest()?.returnFocus;
    this.workspaceCenterRequest.set(null);
    setTimeout(() => { if (opener?.isConnected && opener.getClientRects().length) opener.focus(); else this.workspaceToggle()?.nativeElement.focus(); });
  }

  protected handleWorkspaceCenterLoaderKey(event: KeyboardEvent): void {
    if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); this.workspaceCenterLoaderClose()?.nativeElement.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeWorkspaceCenterLoader(); }
  }

  protected openWorkspaceCenter(panel: 'overview' | 'identities' | 'hosting', returnFocus: HTMLElement | null = null): void {
    if (this.git.busy()) return;
    const opener = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.workspaceMenuOpen.set(false);
    this.identityPopoverOpen.set(false);
    this.workspaceCenterRequest.set({ workspaceId: this.git.activeWorkspaceId(), panel, returnFocus: opener?.getAttribute('role') === 'menuitem' ? this.workspaceToggle()?.nativeElement ?? null : opener });
  }

  protected async selectWorkspace(workspaceId: string): Promise<void> {
    if (workspaceId === this.git.activeWorkspaceId()) {
      this.closeWorkspaceMenu(true);
      return;
    }
    this.saveCommitDraft();
    this.workspaceMenuOpen.set(false);
    await this.git.switchWorkspace(workspaceId);
    this.restoreCommitDraft();
    if (this.git.repository()) {
      this.syncOpenTerminalToActiveRepository();
      this.selectWip();
      this.loadGraphPreferences();
      const repositoryId = this.git.activeRepositoryId();
      if (repositoryId) this.revealRepositoryTab(repositoryId);
    } else {
      this.terminalOpen.set(false);
      this.terminalRepositoryId.set(null);
    }
  }

  protected openWorkspaceDialog(mode: 'create' | 'rename', returnFocus?: HTMLElement | null): void {
    let opener = returnFocus === undefined && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : returnFocus ?? null;
    if (opener?.closest('.workspace-menu')) opener = this.workspaceToggle()?.nativeElement ?? opener;
    this.workspaceDialogOpener = opener;
    this.workspaceMenuOpen.set(false);
    this.workspaceName.set(mode === 'rename' ? this.git.activeWorkspace()?.name ?? '' : '');
    this.workspaceDialogMode.set(mode);
    setTimeout(() => {
      const input = this.workspaceNameInput()?.nativeElement;
      input?.focus();
      input?.select();
    });
  }

  protected closeWorkspaceDialog(): void {
    const opener = this.workspaceDialogOpener;
    this.workspaceDialogMode.set(null);
    this.workspaceName.set('');
    this.workspaceDialogOpener = null;
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  protected async submitWorkspace(): Promise<void> {
    const mode = this.workspaceDialogMode();
    const name = this.workspaceName().trim();
    if (!mode || !name) return;
    if (mode === 'create') {
      this.saveCommitDraft();
      const workspace = await this.git.createWorkspace(name);
      if (!workspace) return;
      this.restoreCommitDraft();
      this.terminalOpen.set(false);
      this.terminalRepositoryId.set(null);
    } else {
      this.git.renameWorkspace(this.git.activeWorkspaceId(), name);
    }
    this.closeWorkspaceDialog();
  }

  protected requestWorkspaceDelete(returnFocus?: HTMLElement | null): void {
    const workspace = this.git.activeWorkspace();
    if (!workspace || this.git.workspaces().length <= 1) return;
    this.secondaryConfirmationOpener = this.captureSecondaryConfirmationOpener(returnFocus);
    this.workspaceMenuOpen.set(false);
    this.pendingWorkspaceDelete.set(workspace);
    setTimeout(() => this.focusConfirmationCancel(this.workspaceDeleteDialog()));
  }

  protected closeWorkspaceDelete(): void {
    this.pendingWorkspaceDelete.set(null);
    this.finishSecondaryConfirmation();
  }

  protected async confirmWorkspaceDelete(): Promise<void> {
    const workspace = this.pendingWorkspaceDelete();
    if (!workspace) return;
    this.saveCommitDraft();
    if (!await this.git.deleteWorkspace(workspace.id)) return;
    this.closeWorkspaceDelete();
    this.restoreCommitDraft();
    if (this.git.repository()) {
      this.syncOpenTerminalToActiveRepository();
      this.selectWip();
      this.loadGraphPreferences();
    } else {
      this.terminalOpen.set(false);
      this.terminalRepositoryId.set(null);
    }
  }

  protected selectRepositoryTab(repoId: string): void {
    this.repositoryTabsOpen.set(false);
    this.activateRepository(repoId);
  }

  protected handleRepositoryTabKeydown(event: KeyboardEvent, repoId: string): void {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement;
      const bounds = target.getBoundingClientRect();
      this.repositoryTabMenuReturnFocus = target;
      this.openRepositoryTabMenu(new MouseEvent('contextmenu', {
        clientX: Math.min(bounds.right - 12, bounds.left + 220),
        clientY: bounds.bottom,
      }), repoId, true);
      return;
    }

    const tabs = Array.from(
      (event.currentTarget as HTMLElement)
        .closest('[role="tablist"]')
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const current = tabs.findIndex((tab) => tab.dataset['repositoryTabId'] === repoId);
    if (current < 0 || !tabs.length) return;

    const reorderDirection = event.shiftKey && (event.ctrlKey || event.metaKey)
      ? event.key === 'PageUp' ? -1 : event.key === 'PageDown' ? 1 : 0
      : 0;
    if (reorderDirection) {
      event.preventDefault();
      event.stopPropagation();
      this.moveRepositoryTab(repoId, reorderDirection, true);
      return;
    }

    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else next = (current - 1 + tabs.length) % tabs.length;
    const nextId = tabs[next].dataset['repositoryTabId'];
    if (!nextId) return;
    event.preventDefault();
    event.stopPropagation();
    this.activateRepository(nextId);
    queueMicrotask(() => tabs[next].focus({ preventScroll: true }));
  }

  private focusRepositoryTab(repoId: string | null): void {
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-repository-tab-id]'));
    const target = tabs.find((tab) => tab.dataset['repositoryTabId'] === repoId);
    if (repoId) this.revealRepositoryTab(repoId);
    (target ?? this.newRepositoryTab()?.nativeElement)?.focus({ preventScroll: true });
  }

  private revealRepositoryTab(repoId: string): void {
    queueMicrotask(() => requestAnimationFrame(() => {
      const container = this.repositoryTabs()?.nativeElement;
      const tabButton = container?.querySelector<HTMLElement>(`[data-repository-tab-id="${CSS.escape(repoId)}"]`);
      const tab = tabButton?.closest<HTMLElement>('.repo-tab') ?? tabButton;
      if (!container || !tab) return;
      const containerBounds = container.getBoundingClientRect();
      const tabBounds = tab.getBoundingClientRect();
      const target = repositoryTabScrollPosition({
        containerStart: containerBounds.left,
        containerEnd: containerBounds.right,
        tabStart: tabBounds.left,
        tabEnd: tabBounds.right,
        scrollPosition: container.scrollLeft,
        maximumScrollPosition: container.scrollWidth - container.clientWidth,
      });
      if (target !== null) container.scrollTo({ left: target });
      this.updateRepositoryTabOverflow();
    }));
  }

  protected updateRepositoryTabOverflow(): void {
    const container = this.repositoryTabs()?.nativeElement;
    if (!container) return;
    this.repositoryTabOverflow.set(repositoryTabOverflowState({
      scrollPosition: container.scrollLeft,
      viewportWidth: container.clientWidth,
      contentWidth: container.scrollWidth,
    }));
  }

  protected scrollRepositoryTabs(direction: -1 | 1): void {
    const container = this.repositoryTabs()?.nativeElement;
    if (!container) return;
    const distance = Math.max(120, Math.round(container.clientWidth * .65));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollBy({ left: direction * distance, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  protected canMoveRepositoryTab(repoId: string, direction: -1 | 1): boolean {
    const repositories = this.git.repositories();
    const current = repositories.findIndex((repository) => repository.id === repoId);
    const next = current + direction;
    return current >= 0 && next >= 0 && next < repositories.length;
  }

  private moveRepositoryTab(repoId: string, direction: -1 | 1, restoreFocus: boolean): void {
    const repositories = this.git.repositories();
    const current = repositories.findIndex((repository) => repository.id === repoId);
    const next = current + direction;
    if (current < 0 || next < 0 || next >= repositories.length) return;
    this.git.reorderRepository(repoId, repositories[next].id);
    this.tabOrderAnnouncement.set(
      `${this.git.repositoryLabel(repositories[current])} moved to position ${next + 1} of ${repositories.length}.`,
    );
    if (restoreFocus) setTimeout(() => this.focusRepositoryTab(repoId));
  }

  protected moveRepositoryTabFromMenu(direction: -1 | 1): void {
    const menu = this.repositoryTabMenu();
    if (!menu) return;
    const restoreFocus = !!this.repositoryTabMenuReturnFocus;
    this.dismissRepositoryTabMenu();
    this.moveRepositoryTab(menu.repoId, direction, restoreFocus);
  }

  protected openRepositoryTabMenu(event: MouseEvent, repoId: string, focusMenu = true): void {
    event.preventDefault();
    event.stopPropagation();
    const repository = this.git.repositories().find((candidate) => candidate.id === repoId);
    if (!repository) return;
    this.prepareActionMenu('repository');
    if (focusMenu && event.currentTarget instanceof HTMLElement) {
      this.repositoryTabMenuReturnFocus = this.sidebarMenuReturnTarget(event, '.repo-tab-main');
    }
    if (!focusMenu) this.repositoryTabMenuReturnFocus = null;
    this.repositoryTabsOpen.set(false);
    this.repositoryAlias.set(this.git.repositoryAliases()[repository.path] ?? '');
    this.repositoryAliasEditing.set(false);
    this.repositoryTabMenu.set({
      repoId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 280)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 390)),
    });
    queueMicrotask(() => requestAnimationFrame(() => {
      const element = this.repositoryTabMenuElement()?.nativeElement;
      const menu = this.repositoryTabMenu();
      if (!element || menu?.repoId !== repoId) return;
      this.repositoryTabMenu.set({ ...menu, ...this.fittedMenuPosition(element, { x: event.clientX, y: event.clientY }) });
    }));
    if (focusMenu) {
      this.focusWhenRendered(
        () => this.repositoryTabMenuElement()?.nativeElement.querySelector<HTMLElement>(
          '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])',
        ) ?? undefined,
        30,
        () => this.repositoryTabMenu()?.repoId === repoId,
      );
    }
  }

  protected handleRepositoryTabMenuKeydown(event: KeyboardEvent): void {
    if (this.repositoryAliasEditing()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancelRepositoryAliasEdit();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled])',
      ));
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.target instanceof HTMLInputElement && ['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissRepositoryTabMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      this.dismissRepositoryTabMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])',
    ));
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowUp') nextIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
    else if (event.key === 'ArrowDown') nextIndex = activeIndex < 0 || activeIndex === items.length - 1 ? 0 : activeIndex + 1;
    items[nextIndex].focus();
  }

  private dismissRepositoryTabMenu(restoreFocus = false): void {
    const target = restoreFocus ? this.repositoryTabMenuReturnFocus : null;
    this.repositoryAliasEditing.set(false);
    this.repositoryTabMenu.set(null);
    this.repositoryTabMenuReturnFocus = null;
    if (target) queueMicrotask(() => target.focus({ preventScroll: true }));
  }

  protected beginRepositoryAliasEdit(): void {
    this.repositoryAliasEditing.set(true);
    queueMicrotask(() => requestAnimationFrame(() => {
      const input = this.repositoryAliasInput()?.nativeElement;
      input?.focus({ preventScroll: true });
      input?.select();
    }));
  }

  protected cancelRepositoryAliasEdit(): void {
    const repository = this.repositoryTabMenuRepository();
    if (repository) this.repositoryAlias.set(this.git.repositoryAliases()[repository.path] ?? '');
    this.repositoryAliasEditing.set(false);
    queueMicrotask(() => requestAnimationFrame(() => this.repositoryTabMenuElement()?.nativeElement
      .querySelector<HTMLElement>('[data-repository-alias-action]')
      ?.focus({ preventScroll: true })));
  }

  protected saveRepositoryAlias(): void {
    const menu = this.repositoryTabMenu();
    if (!menu) return;
    this.git.setRepositoryAlias(menu.repoId, this.repositoryAlias());
    this.dismissRepositoryTabMenu(true);
  }

  protected closeRepositoryFromMenu(): void {
    const menu = this.repositoryTabMenu();
    if (!menu) return;
    this.repositoryTabMenu.set(null);
    this.closeRepository(menu.repoId);
  }

  protected toggleRepositoryFavoriteFromMenu(): void {
    const repository = this.repositoryTabMenuRepository();
    if (!repository) return;
    this.git.toggleFavoritePath(repository.path);
  }

  protected openRepositoryTerminalFromMenu(): void {
    const menu = this.repositoryTabMenu();
    if (!menu) return;
    if (!this.terminalOpen()) this.terminalOpener = this.repositoryTabMenuReturnFocus;
    this.repositoryTabMenu.set(null);
    this.repositoryTabMenuReturnFocus = null;
    this.showTerminalForRepository(menu.repoId);
  }

  protected openRepositoryFolderFromMenu(): void {
    const menu = this.repositoryTabMenu();
    if (!menu) return;
    this.repositoryTabMenu.set(null);
    void this.git.openRepositoryInFileManager(menu.repoId);
  }

  protected closeRepositoriesToRightFromMenu(): void {
    const menu = this.repositoryTabMenu();
    if (!menu) return;
    const repositories = this.git.repositories();
    const index = repositories.findIndex((repository) => repository.id === menu.repoId);
    this.repositoryTabMenu.set(null);
    if (index < 0) return;
    for (const repository of repositories.slice(index + 1).reverse()) {
      this.closeRepository(repository.id);
    }
  }

  protected closeOtherRepositoriesFromMenu(): void {
    const menu = this.repositoryTabMenu();
    if (!menu) return;
    const repositories = this.git.repositories();
    const target = repositories.find((repository) => repository.id === menu.repoId);
    this.repositoryTabMenu.set(null);
    if (!target) return;
    this.activateRepository(target.id);
    for (const repository of repositories.filter((repository) => repository.id !== target.id).reverse()) {
      this.closeRepository(repository.id);
    }
  }

  protected openCommandPalette(
    query = '',
    scope: CommandPaletteScope = 'all',
    returnFocus?: HTMLElement | null,
  ): void {
    this.contextMenu.set(null);
    this.commandPaletteOpener = returnFocus ?? (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
    this.commandPaletteScope.set(scope);
    this.commandQuery.set(query);
    this.commandSelection.set(0);
    this.commandPaletteOpen.set(true);
    queueMicrotask(() => this.moveCommandSelection('first'));
  }

  protected openCompactBranchSwitcher(event: MouseEvent): void {
    const opener = (event.currentTarget as HTMLElement)
      .closest('.toolbar-overflow-control')
      ?.querySelector<HTMLElement>(':scope > .tool-button') ?? null;
    this.moreActionsMenuOpen.set(false);
    this.openCommandPalette('', 'branches', opener);
  }

  protected closeCommandPalette(): void {
    const opener = this.commandPaletteOpener;
    this.commandPaletteOpen.set(false);
    this.commandPaletteOpener = null;
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  protected openKeyboardShortcuts(returnFocus?: HTMLElement | null): void {
    let opener = returnFocus === undefined && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : returnFocus ?? null;
    if (opener?.closest('.app-menu-popover')) opener = this.appMenuToggle()?.nativeElement ?? opener;
    this.keyboardShortcutsOpener = opener;
    this.keyboardShortcutsOpen.set(true);
  }

  protected closeKeyboardShortcuts(): void {
    const opener = this.keyboardShortcutsOpener;
    this.keyboardShortcutsOpen.set(false);
    this.keyboardShortcutsOpener = null;
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus();
    });
  }

  protected updateCommandQuery(query: string): void {
    this.commandQuery.set(query);
    queueMicrotask(() => this.moveCommandSelection('first'));
  }

  protected handleModalFocusKey(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected previewCommandSelection(index: number, enabled: boolean): void {
    if (enabled) this.commandSelection.set(index);
  }

  protected moveCommandSelection(direction: number | 'first' | 'last'): void {
    const commands = this.filteredCommands();
    if (!commands.length) {
      this.commandSelection.set(0);
      return;
    }
    const step = direction === 'first' ? 1 : direction === 'last' ? -1 : Math.sign(direction);
    let index = direction === 'first'
      ? 0
      : direction === 'last'
        ? commands.length - 1
        : Math.max(0, Math.min(commands.length - 1, this.commandSelection() + direction));
    while (!commands[index]?.enabled && index + step >= 0 && index + step < commands.length) index += step;
    this.commandSelection.set(index);
    queueMicrotask(() => document.getElementById(`command-palette-option-${index}`)
      ?.scrollIntoView({ block: 'nearest' }));
  }

  protected async runCommand(action: CommandAction): Promise<void> {
    if (!action.enabled) return;
    this.rememberCommand(action.id);
    const paletteReturnFocus = this.commandPaletteOpener;
    this.commandPaletteOpen.set(false);
    this.commandPaletteOpener = null;
    if (action.id.startsWith('workspace:')) {
      await this.selectWorkspace(action.id.slice('workspace:'.length));
      setTimeout(() => this.workspaceToggle()?.nativeElement.focus());
      return;
    }
    if (action.id.startsWith('repository:')) {
      this.activateRepository(action.id.slice('repository:'.length));
      return;
    }
    if (action.id.startsWith('local-branch:')) {
      await this.git.checkout(action.id.slice('local-branch:'.length));
      return;
    }
    if (action.id.startsWith('remote-branch:')) {
      await this.git.checkoutRemote(action.id.slice('remote-branch:'.length));
      return;
    }
    if (action.id.startsWith('branch-rename:')) {
      this.requestPaletteBranchRename(decodeURIComponent(action.id.slice('branch-rename:'.length)));
      return;
    }
    if (action.id.startsWith('branch-delete:')) {
      this.requestPaletteBranchDelete(
        decodeURIComponent(action.id.slice('branch-delete:'.length)),
        paletteReturnFocus,
      );
      return;
    }
    if (action.id.startsWith('tag:')) {
      await this.jumpToCommit(action.id.slice('tag:'.length));
      return;
    }
    if (action.id.startsWith('stash-reference:')) {
      const reference = action.id.slice('stash-reference:'.length);
      const stash = this.git.repository()?.stashes.find((candidate) => candidate.reference === reference);
      if (stash) this.selectStash(stash);
      return;
    }
    if (action.id.startsWith('stash-apply:')) {
      if (action.stashTarget) await this.runSelectedStash(false, action.stashTarget.stash, action.stashTarget.repositoryId);
      return;
    }
    if (action.id.startsWith('stash-pop:')) {
      if (action.stashTarget) await this.runSelectedStash(true, action.stashTarget.stash, action.stashTarget.repositoryId);
      return;
    }
    if (action.id.startsWith('file-conflict:')) {
      await this.openConflictTool(decodeURIComponent(action.id.slice('file-conflict:'.length)));
      return;
    }
    if (action.id.startsWith('file-diff:') || action.id.startsWith('file-history:') || action.id.startsWith('file-blame:')) {
      const [kind, stagedValue, ...encodedPath] = action.id.split(':');
      const path = decodeURIComponent(encodedPath.join(':'));
      this.selectWip();
      await this.inspectWorkingTreeFile(path, stagedValue === '1');
      if (kind === 'file-history') await this.showFileHistory();
      else if (kind === 'file-blame') await this.showFileBlame();
      return;
    }
    if (action.id.startsWith('tracked-history:') || action.id.startsWith('tracked-blame:')) {
      const [kind, ...encodedPath] = action.id.split(':');
      await this.openTrackedFileInsight(
        decodeURIComponent(encodedPath.join(':')),
        kind === 'tracked-history' ? 'history' : 'blame',
      );
      return;
    }
    switch (action.id) {
      case 'branch-workflows': this.openBranchWorkflows(paletteReturnFocus); break;
      case 'hosting-center': this.openWorkspaceCenter('hosting', paletteReturnFocus); break;
      case 'workspace-overview': this.openWorkspaceCenter('overview', paletteReturnFocus); break;
      case 'identity-profiles': this.openWorkspaceCenter('identities', paletteReturnFocus); break;
      case 'workspace-create': this.openWorkspaceDialog('create', paletteReturnFocus); break;
      case 'workspace-rename': this.openWorkspaceDialog('rename', paletteReturnFocus); break;
      case 'workspace-delete': this.requestWorkspaceDelete(paletteReturnFocus); break;
      case 'new-tab': this.openRepositoryManager('manager', paletteReturnFocus); break;
      case 'incoming-links': this.openIncomingLinks(paletteReturnFocus); break;
      case 'open-link': this.openRepositoryLink(paletteReturnFocus); break;
      case 'open': await this.chooseRepository(paletteReturnFocus); break;
      case 'clone': this.openRepositoryManager('clone', paletteReturnFocus); break;
      case 'init': this.openRepositoryManager('init', paletteReturnFocus); break;
      case 'previous-tab': this.activateRelativeRepository(-1); break;
      case 'next-tab': this.activateRelativeRepository(1); break;
      case 'close-tab':
        if (this.git.activeRepositoryId()) this.closeRepository(this.git.activeRepositoryId()!);
        break;
      case 'reopen-tab': await this.reopenClosedRepository(); break;
      case 'refresh': await this.git.refresh(); break;
      case 'merge-preview': this.openMergePreview(paletteReturnFocus); break;
      case 'maintenance': await this.git.performRepositoryMaintenance(); break;
      case 'undo': await this.git.undo(); break;
      case 'redo': await this.git.redo(); break;
      case 'fetch': await this.git.remote('fetch_repository'); break;
      case 'fetch-options': this.openFetchOptions(paletteReturnFocus); break;
      case 'add-remote': this.openAddRemoteDialog(paletteReturnFocus); break;
      case 'pull': await this.pullCurrentBranch(); break;
      case 'push': this.pushCurrentBranch(); break;
      case 'force-push': this.requestForcePush(); break;
      case 'stage-all': await this.git.stageAll(); break;
      case 'unstage-all': await this.git.unstageAll(); break;
      case 'stash': await this.stashCurrentChanges(); break;
      case 'apply-stash': {
        if (action.stashTarget) await this.runSelectedStash(false, action.stashTarget.stash, action.stashTarget.repositoryId);
        break;
      }
      case 'pop':
        if (action.stashTarget) await this.runSelectedStash(true, action.stashTarget.stash, action.stashTarget.repositoryId);
        break;
      case 'working-tree': this.selectWip(); break;
      case 'terminal': this.toggleTerminal(); break;
      case 'file-manager': await this.git.openRepositoryInFileManager(); break;
      case 'fullscreen': await this.git.toggleFullscreen(); break;
      case 'branch':
        this.openBranchCreator();
        break;
      case 'tag-create': this.openTagCreator(); break;
      case 'search': this.openHistorySearch(); break;
      case 'file-search': this.openCommandPalette('', 'files'); break;
      case 'file-tools': this.openFileTools(null, paletteReturnFocus); break;
      case 'editor-draft-recovery': this.openEditorDraftRecovery(paletteReturnFocus); break;
      case 'recovery-history': await this.openRecoveryHistory(); break;
      case 'merge-continue': await this.controlMerge('continue'); break;
      case 'merge-abort': await this.controlMerge('abort'); break;
      case 'history-operation-continue': await this.controlHistoryOperation('continue'); break;
      case 'history-operation-skip': await this.controlHistoryOperation('skip'); break;
      case 'history-operation-abort': await this.controlHistoryOperation('abort'); break;
      case 'history-operation-quit': await this.controlHistoryOperation('quit'); break;
      case 'bisect-start': this.requestBisectFromSelection(); break;
      case 'bisect-good': await this.git.markBisect('good'); break;
      case 'bisect-bad': await this.git.markBisect('bad'); break;
      case 'bisect-skip': await this.git.markBisect('skip'); break;
      case 'bisect-reset': await this.git.resetBisect(); break;
      case 'left-panel': this.setPanelVisibility('left-panel', !this.sidebarVisible()); break;
      case 'commit-panel': this.setPanelVisibility('commit-panel', !this.detailsVisible()); break;
      case 'preferences': this.openPreferences('general', paletteReturnFocus); break;
      case 'reset-ui':
        this.openPreferences('general', paletteReturnFocus);
        this.resetUiConfirmation.set(true);
        break;
      case 'theme-toggle': this.toggleAppTheme(); break;
      case 'zoom-in': await this.stepZoom(1); break;
      case 'zoom-out': await this.stepZoom(-1); break;
      case 'zoom-reset': await this.setZoom(DEFAULT_ZOOM); break;
      case 'diff-view': this.openDiffViewer(); break;
      case 'shortcuts': this.openKeyboardShortcuts(paletteReturnFocus); break;
      case 'activity-log': this.showActivityLogs(this.activityLogTab(), paletteReturnFocus); break;
      case 'sparse-configure': this.openSparseCheckoutPreferences(); break;
      case 'sparse-reapply': await this.reapplySparseCheckout(); break;
      case 'sparse-disable': this.requestSparseCheckoutDisable(paletteReturnFocus); break;
      case 'submodule-manage':
        this.showSubmodulePane();
        this.openWorktreeRegistrationReview(true, paletteReturnFocus);
        break;
      case 'submodule-add':
        this.showSubmodulePane();
        this.openSubmoduleDialog(paletteReturnFocus);
        break;
      case 'lfs-configure':
        this.openPreferences('git');
        break;
    }
  }

  protected toggleTerminal(): void {
    const repository = this.git.repository();
    if (!repository) return;
    if (this.terminalOpen() && this.terminalRepositoryId() === repository.id) {
      this.terminalOpen.set(false);
      this.restoreTerminalFocus();
      return;
    }
    if (!this.terminalOpen()) this.rememberTerminalOpener();
    this.showTerminalForRepository(repository.id);
  }

  protected closeTerminalPanel(repoId: string): void {
    this.terminalRepositoryIds.update((ids) => ids.filter((id) => id !== repoId));
    if (this.terminalRepositoryId() === repoId) {
      this.terminalOpen.set(false);
      this.terminalRepositoryId.set(null);
      this.restoreTerminalFocus();
    }
  }

  protected hideTerminalPanel(repoId: string): void {
    if (this.terminalRepositoryId() !== repoId) return;
    this.terminalOpen.set(false);
    this.restoreTerminalFocus();
  }

  protected async setZoom(value: number): Promise<void> {
    const zoom = normalizeZoom(value);
    this.zoomPercent.set(zoom);
    try {
      localStorage.setItem('git-khronos.ui.zoom', String(zoom));
    } catch {
      // Zoom remains available when WebView storage is unavailable.
    }
    await this.applyZoom(zoom);
  }

  protected async stepZoom(direction: -1 | 1): Promise<void> {
    const current = this.zoomPercent();
    const next = direction > 0
      ? ZOOM_LEVELS.find((level) => level > current) ?? ZOOM_LEVELS.at(-1)!
      : [...ZOOM_LEVELS].reverse().find((level) => level < current) ?? ZOOM_LEVELS[0];
    await this.setZoom(next);
  }

  private showTerminalForRepository(repoId: string): void {
    this.terminalRepositoryIds.update((ids) => ids.includes(repoId) ? ids : [...ids, repoId]);
    this.terminalRepositoryId.set(repoId);
    this.terminalOpen.set(true);
  }

  private rememberTerminalOpener(): void {
    const active = document.activeElement;
    this.terminalOpener = active instanceof HTMLElement && !active.closest('gc-terminal-panel')
      ? active
      : null;
  }

  private restoreTerminalFocus(): void {
    const opener = this.terminalOpener;
    this.terminalOpener = null;
    setTimeout(() => {
      const target = opener?.isConnected ? opener : this.terminalToggle()?.nativeElement;
      target?.focus({ preventScroll: true });
    });
  }

  private syncOpenTerminalToActiveRepository(): void {
    const repoId = this.git.activeRepositoryId();
    if (this.terminalOpen() && repoId) this.showTerminalForRepository(repoId);
  }

  protected toggleFetchMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.fetchMenuOpen();
    this.pullMenuOpen.set(false);
    this.pushMenuOpen.set(false);
    this.branchMenuOpen.set(false);
    this.stashMenuOpen.set(false);
    this.lfsMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(false);
    this.moreActionsMenuOpen.set(false);
    this.fetchMenuOpen.set(open);
    this.prepareToolbarMenu(event, '.fetch-menu', open);
  }

  protected togglePullMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.pullMenuOpen();
    this.fetchMenuOpen.set(false);
    this.pushMenuOpen.set(false);
    this.branchMenuOpen.set(false);
    this.stashMenuOpen.set(false);
    this.lfsMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(false);
    this.moreActionsMenuOpen.set(false);
    this.pullMenuOpen.set(open);
    this.prepareToolbarMenu(event, '.pull-menu', open);
  }

  protected togglePushMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.pushMenuOpen();
    this.fetchMenuOpen.set(false);
    this.pullMenuOpen.set(false);
    this.branchMenuOpen.set(false);
    this.stashMenuOpen.set(false);
    this.lfsMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(false);
    this.moreActionsMenuOpen.set(false);
    this.pushMenuOpen.set(open);
    this.prepareToolbarMenu(event, '.push-menu', open);
  }

  protected toggleBranchMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.branchMenuOpen();
    this.fetchMenuOpen.set(false);
    this.pullMenuOpen.set(false);
    this.pushMenuOpen.set(false);
    this.stashMenuOpen.set(false);
    this.lfsMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(false);
    this.moreActionsMenuOpen.set(false);
    this.branchMenuOpen.set(open);
    this.prepareToolbarMenu(event, '.branch-menu', open);
  }

  protected toggleStashMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.stashMenuOpen();
    this.fetchMenuOpen.set(false);
    this.pullMenuOpen.set(false);
    this.pushMenuOpen.set(false);
    this.branchMenuOpen.set(false);
    this.lfsMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(false);
    this.moreActionsMenuOpen.set(false);
    this.stashMenuOpen.set(open);
    this.prepareToolbarMenu(event, '.stash-menu', open);
  }

  protected toggleLfsMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.lfsMenuOpen();
    this.fetchMenuOpen.set(false);
    this.pullMenuOpen.set(false);
    this.pushMenuOpen.set(false);
    this.branchMenuOpen.set(false);
    this.stashMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(false);
    this.moreActionsMenuOpen.set(false);
    this.lfsMenuOpen.set(open);
    this.prepareToolbarMenu(event, '.lfs-menu', open);
  }

  protected toggleSparseCheckoutMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.sparseCheckoutMenuOpen();
    this.fetchMenuOpen.set(false);
    this.pullMenuOpen.set(false);
    this.pushMenuOpen.set(false);
    this.branchMenuOpen.set(false);
    this.stashMenuOpen.set(false);
    this.lfsMenuOpen.set(false);
    this.moreActionsMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(open);
    this.prepareToolbarMenu(event, '.sparse-menu', open);
  }

  protected toggleMoreActionsMenu(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.moreActionsMenuOpen();
    this.fetchMenuOpen.set(false);
    this.pullMenuOpen.set(false);
    this.pushMenuOpen.set(false);
    this.branchMenuOpen.set(false);
    this.stashMenuOpen.set(false);
    this.lfsMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(false);
    this.moreActionsMenuOpen.set(open);
    this.prepareToolbarMenu(event, '.compact-action-menu', open);
  }

  protected handleToolbarActionMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeToolbarMenus(true);
      return;
    }
    if (event.key === 'Tab') {
      this.closeToolbarMenus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = this.visibleToolbarMenuItems(event.currentTarget as HTMLElement);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  }

  private prepareToolbarMenu(event: MouseEvent, selector: string, open: boolean): void {
    if (!open) {
      this.toolbarMenuReturnFocus = null;
      return;
    }
    this.toolbarMenuReturnFocus = event.currentTarget as HTMLElement;
    window.setTimeout(() => {
      const menu = document.querySelector<HTMLElement>(selector);
      if (menu) this.visibleToolbarMenuItems(menu)[0]?.focus();
    }, 0);
  }

  private visibleToolbarMenuItems(menu: ParentNode): HTMLButtonElement[] {
    return Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      .filter((item) => item.getClientRects().length > 0);
  }

  protected async pullLfsObjects(): Promise<void> {
    this.lfsMenuOpen.set(false);
    await this.git.lfs('lfs_pull');
  }

  protected requestLfsPrune(returnFocus?: HTMLElement | null): void {
    this.secondaryConfirmationOpener = this.captureSecondaryConfirmationOpener(returnFocus);
    this.lfsMenuOpen.set(false);
    this.toolbarMenuReturnFocus = null;
    this.pendingLfsPrune.set(true);
    this.lfsPrunePreview.set(null);
    void this.reviewLfsPrune();
  }

  private async reviewLfsPrune(): Promise<void> {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId) return;
    this.lfsPruneReviewing.set(true);
    let preview: LfsPrunePreview | null = null;
    try {
      preview = await this.git.previewLfsPrune(repositoryId);
    } finally {
      this.lfsPruneReviewing.set(false);
    }
    if (!this.pendingLfsPrune() || this.git.activeRepositoryId() !== repositoryId) return;
    if (!preview) {
      this.closeLfsPrune();
      return;
    }
    this.lfsPrunePreview.set(preview);
  }

  protected closeLfsPrune(): void {
    this.pendingLfsPrune.set(false);
    this.lfsPrunePreview.set(null);
    this.finishSecondaryConfirmation();
  }

  protected async confirmLfsPrune(): Promise<void> {
    const preview = this.lfsPrunePreview();
    const repositoryId = this.git.activeRepositoryId();
    if (!preview?.objects.length || !repositoryId) return;
    this.closeLfsPrune();
    await this.git.pruneLfsObjects(preview, repositoryId);
  }

  protected async confirmLfsRetentionPrune(): Promise<void> {
    this.closeLfsPrune();
    await this.git.lfs('lfs_prune');
  }

  protected async executePullStrategy(strategy: PullStrategy): Promise<void> {
    this.pullMenuOpen.set(false);
    await this.pullCurrentBranch(strategy);
  }

  protected async pullCurrentBranch(strategy: PullStrategy = this.pullStrategy()): Promise<void> {
    const remote = this.currentRemote();
    const branch = this.currentRemoteBranch();
    if (!remote || !branch || this.git.busy()) return;
    await this.git.pull(strategy, remote.name, branch);
  }

  protected setDefaultPullStrategy(event: Event, strategy: PullStrategy): void {
    event.preventDefault();
    event.stopPropagation();
    this.pullStrategy.set(strategy);
    try {
      localStorage.setItem('git-khronos.pull.strategy', strategy);
    } catch {
      // The selected strategy remains active for this session.
    }
  }

  protected pullStrategyLabel(): string {
    return {
      merge: 'Fast-forward if possible',
      'ff-only': 'Fast-forward only',
      rebase: 'Rebase',
    }[this.pullStrategy()];
  }

  protected pullToolbarLabel(): string {
    const sync = this.currentBranchSync();
    const remote = this.currentRemote();
    const branch = this.currentRemoteBranch();
    if (!remote || !branch) return 'Pull unavailable: no remote selected';
    if (this.currentRemoteIsUpstream() && sync.gone) return 'Pull unavailable: upstream branch is gone';
    if (this.currentRemoteIsUpstream() && sync.behind) return `Pull ${sync.behind} ${sync.behind === 1 ? 'commit' : 'commits'} from ${remote.name}/${branch}`;
    return `Pull from ${remote.name}/${branch}`;
  }

  protected pushToolbarLabel(): string {
    const sync = this.currentBranchSync();
    const remote = this.currentRemote();
    const branch = this.currentRemoteBranch();
    if (!remote || !branch) {
      const current = this.currentBranch();
      return current && !current.upstream
        ? `Publish ${current.name} to a remote`
        : 'Push unavailable: no remote selected';
    }
    if (this.currentRemoteIsUpstream() && sync.gone) return `Push and recreate ${remote.name}/${branch}`;
    if (this.currentRemoteIsUpstream() && sync.ahead) return `Push ${sync.ahead} ${sync.ahead === 1 ? 'commit' : 'commits'} to ${remote.name}/${branch}`;
    return this.currentBranch()?.upstream ? `Push to ${remote.name}/${branch}` : `Publish ${branch} to ${remote.name}`;
  }

  protected pushCurrentBranch(): void {
    this.pushMenuOpen.set(false);
    const branch = this.currentBranch();
    const remote = this.currentRemote();
    const targetBranch = this.currentRemoteBranch();
    if (!branch || this.git.busy()) return;
    if (!remote || !targetBranch) {
      if (!branch.upstream) {
        this.publishRemote.set('');
        this.pendingPublishBranch.set({ branch: branch.name });
      }
      return;
    }
    if (branch.upstream) {
      void this.git.remote('push_repository', { remote: remote.name, branch: targetBranch });
      return;
    }
    this.publishRemote.set(remote.name);
    this.pendingPublishBranch.set({ branch: branch.name });
  }

  protected requestForcePush(): void {
    this.pushMenuOpen.set(false);
    if (!this.currentRemoteIsUpstream() || this.git.busy()) return;
    this.pendingForcePush.set(true);
  }

  protected async confirmForcePush(): Promise<void> {
    if (!this.pendingForcePush()) return;
    this.pendingForcePush.set(false);
    const remote = this.currentRemote();
    const branch = this.currentRemoteBranch();
    if (remote && branch) await this.git.forcePushWithLease(remote.name, branch);
  }

  protected async confirmPublishBranch(): Promise<void> {
    const pending = this.pendingPublishBranch();
    const remote = this.publishRemote();
    if (!pending || !this.git.repository()?.remotes.some((candidate) => candidate.name === remote)) return;
    this.pendingPublishBranch.set(null);
    await this.git.publishBranch(remote, pending.branch);
  }

  protected async checkoutFromToolbar(branch: Branch): Promise<void> {
    if (this.git.busy()) return;
    const menu = document.getElementById('branch-options-menu');
    const target = this.toolbarMenuReturnFocus;
    const repositoryId = this.git.activeRepositoryId();
    this.closeToolbarMenus();
    if (!branch.current) await this.git.checkout(branch.name);
    queueMicrotask(() => requestAnimationFrame(() => {
      if (this.git.activeRepositoryId() === repositoryId && !this.branchMenuOpen()
        && this.canRestoreFocusFrom(menu) && target?.isConnected && !target.matches(':disabled')) {
        target.focus({ preventScroll: true });
      }
    }));
  }

  protected toggleReferenceSectionOpen(section: ReferenceDisclosureSection): void {
    const open = section === 'pullRequests'
      ? this.pullRequestsOpen
      : this.referenceSectionOpenSignal(section);
    const next = !open();
    open.set(next);
    const preference = section === 'pullRequests' ? 'pull-requests' : section;
    try {
      localStorage.setItem(`git-khronos.ui.section-${preference}-open`, String(next));
    } catch {
      // Disclosure state remains active for this session.
    }
  }

  protected openHostedReviewRequests(): void {
    const destination = this.hostedReviewRequests();
    if (!destination) return;
    void this.git.openExternalUrl(destination.reviewRequestsUrl, `${destination.provider} review requests opened`);
  }

  protected maximizeReferenceSection(section: ReferenceSection): void {
    if (this.maximizedReferenceSection() === section) {
      this.maximizedReferenceSection.set(null);
      const snapshot = this.referenceOpenSnapshot;
      if (snapshot) {
        this.worktreesOpen.set(snapshot.worktrees);
        this.localBranchesOpen.set(snapshot.local);
        this.remoteBranchesOpen.set(snapshot.remote);
        this.tagsOpen.set(snapshot.tags);
        this.stashesOpen.set(snapshot.stashes);
        this.submodulesOpen.set(snapshot.submodules);
      }
      this.referenceOpenSnapshot = null;
      return;
    }
    this.referenceOpenSnapshot = {
      worktrees: this.worktreesOpen(),
      local: this.localBranchesOpen(),
      remote: this.remoteBranchesOpen(),
      tags: this.tagsOpen(),
      stashes: this.stashesOpen(),
      submodules: this.submodulesOpen(),
    };
    this.referenceSectionOpenSignal(section).set(true);
    this.maximizedReferenceSection.set(section);
  }

  private referenceSectionOpen(section: ReferenceSection): boolean {
    return this.referenceSectionOpenSignal(section)();
  }

  private referenceSectionOpenSignal(section: ReferenceSection) {
    return {
      worktrees: this.worktreesOpen,
      local: this.localBranchesOpen,
      remote: this.remoteBranchesOpen,
      tags: this.tagsOpen,
      stashes: this.stashesOpen,
      submodules: this.submodulesOpen,
    }[section];
  }

  protected async openRecoveryHistory(): Promise<void> {
    this.recoveryHistoryReturnFocus = document.querySelector<HTMLElement>('[aria-label="Main menu"]');
    this.recoveryRepositoryId = this.git.activeRepositoryId();
    this.appMenuOpen.set(false);
    this.activityLogOpen.set(false);
    this.recoveryQuery.set('');
    this.recoveryBranchEntry.set(null);
    this.recoveryBranchName.set('');
    this.operationRecoveries.set(null);
    this.recoveryCaptureAction.set(null);
    this.recoveryBranchError.set(null);
    this.recoveryHistoryOpen.set(true);
    await this.refreshRecoveryHistory();
  }

  protected async refreshRecoveryHistory(): Promise<void> {
    if (this.git.busy() || this.recoveryCaptureBusy()) return;
    const repositoryId = this.recoveryRepositoryId;
    if (!repositoryId || !this.git.requireRecoveryRepository(repositoryId)) return;
    this.recoveryCaptureBusy.set(true);
    try {
      await this.git.loadReflog();
      const reflogError = this.git.error();
      const records = await this.git.loadOperationRecoveries(repositoryId);
      if (reflogError) this.git.error.set([reflogError, this.git.error()].filter(Boolean).join(' '));
      if (this.recoveryHistoryOpen() && this.recoveryRepositoryId === repositoryId) {
        this.operationRecoveries.set(records);
      }
    } finally {
      this.recoveryCaptureBusy.set(false);
    }
  }

  protected beginRecoveryCaptureAction(record: OperationRecovery, kind: 'restore' | 'remove'): void {
    this.recoveryCaptureAction.set({ record, kind });
    this.recoveryCaptureBranch.set(`recovery/${this.shortOid(record.headOid)}`);
    afterNextRender(() => {
      const form = document.querySelector<HTMLElement>('.recovery-capture-form');
      form?.querySelector<HTMLElement>(kind === 'restore' ? 'input' : '[data-capture-cancel]')?.focus();
    }, { injector: this.injector });
  }

  protected cancelRecoveryCaptureAction(): void {
    const action = this.recoveryCaptureAction();
    this.recoveryCaptureAction.set(null);
    afterNextRender(() => {
      if (!action) return;
      const captures = [...document.querySelectorAll<HTMLElement>('.operation-capture')];
      const capture = captures.find((element) => element.dataset['captureId'] === action.record.id);
      capture?.querySelector<HTMLElement>(`[data-capture-action="${action.kind}"]`)?.focus();
    }, { injector: this.injector });
  }

  protected async confirmRecoveryCaptureAction(): Promise<void> {
    const action = this.recoveryCaptureAction();
    const repositoryId = this.recoveryRepositoryId;
    if (!action || !repositoryId || this.git.busy() || this.recoveryCaptureBusy()) return;
    if (action.kind === 'restore') {
      const branch = this.recoveryCaptureBranch().trim();
      if (!branch) return;
      await this.git.restoreOperationRecovery(action.record.id, branch, repositoryId);
    } else {
      await this.git.forgetOperationRecovery(action.record.id, repositoryId);
    }
    if (this.git.error()) {
      afterNextRender(() => {
        document.querySelector<HTMLElement>('.recovery-dialog .recovery-error')?.focus();
      }, { injector: this.injector });
      return;
    }
    this.recoveryCaptureAction.set(null);
    await this.refreshRecoveryHistory();
    afterNextRender(() => {
      document.querySelector<HTMLElement>('[aria-label="Refresh recovery history"]')?.focus();
    }, { injector: this.injector });
  }

  protected handleRecoveryHistoryKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeRecoveryHistory();
      return;
    }
    this.cycleDialogFocus(document.querySelector<HTMLElement>('.recovery-dialog') ?? undefined, event);
  }

  protected closeRecoveryHistory(): void {
    this.recoveryHistoryOpen.set(false);
    this.recoveryQuery.set('');
    this.recoveryBranchEntry.set(null);
    this.recoveryBranchName.set('');
    this.recoveryCaptureAction.set(null);
    this.operationRecoveries.set(null);
    this.recoveryRepositoryId = null;
    this.recoveryBranchError.set(null);
    this.git.clearReflog();
    const opener = this.recoveryHistoryReturnFocus;
    this.recoveryHistoryReturnFocus = null;
    afterNextRender(() => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  protected recoveryEntryInGraph(entry: ReflogEntry): boolean {
    return this.graphCommitByOid().has(entry.oid);
  }

  protected async viewRecoveryEntry(entry: ReflogEntry): Promise<void> {
    if (!this.recoveryRepositoryId || !this.git.requireRecoveryRepository(this.recoveryRepositoryId)) return;
    this.closeRecoveryHistory();
    await this.jumpToCommit(entry.oid);
  }

  protected beginRecoveryBranch(entry: ReflogEntry): void {
    if (this.git.busy()) return;
    this.recoveryBranchEntry.set(entry);
    this.recoveryBranchName.set(`recovery/${this.shortOid(entry.oid)}`);
    this.recoveryBranchError.set(null);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.recovery-branch-form input');
      input?.focus();
      input?.select();
    });
  }

  protected async createRecoveryBranch(): Promise<void> {
    const entry = this.recoveryBranchEntry();
    const name = this.recoveryBranchName().trim();
    const repositoryId = this.recoveryRepositoryId;
    if (!entry || !name || !repositoryId || this.git.busy()) return;
    if (!this.git.requireRecoveryRepository(repositoryId)) {
      afterNextRender(() => {
        document.querySelector<HTMLElement>('.recovery-dialog .recovery-error')?.focus();
      }, { injector: this.injector });
      return;
    }
    const form = document.querySelector<HTMLElement>('.recovery-branch-form');
    const returnFocus = form?.closest('.recovery-entry')?.querySelector<HTMLButtonElement>('.recovery-actions .primary');
    this.recoveryBranchError.set(null);
    const result = await this.git.createBranchReference(name, entry.oid, repositoryId);
    if (!result || !this.recoveryHistoryOpen() || this.recoveryRepositoryId !== repositoryId
      || this.git.activeRepositoryId() !== repositoryId || this.recoveryBranchEntry() !== entry) return;
    if (result.status === 'success') {
      this.recoveryBranchEntry.set(null);
      this.recoveryBranchName.set('');
      queueMicrotask(() => requestAnimationFrame(() => {
        if (this.recoveryHistoryOpen() && this.git.activeRepositoryId() === repositoryId
          && !this.recoveryBranchEntry() && this.canRestoreFocusFrom(form)
          && returnFocus?.isConnected && !returnFocus.disabled) {
          returnFocus.focus({ preventScroll: true });
        }
      }));
      await this.git.loadReflog();
    } else {
      this.recoveryBranchError.set(result.error ?? 'Branch creation was interrupted. Try again.');
      queueMicrotask(() => requestAnimationFrame(() => {
        if (this.recoveryHistoryOpen() && this.git.activeRepositoryId() === repositoryId
          && this.recoveryBranchEntry() === entry && this.canRestoreFocusFrom(form)) {
          form?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
        }
      }));
    }
  }

  protected async copyRecoveryOid(entry: ReflogEntry): Promise<void> {
    await this.copyText(entry.oid);
  }

  protected openErrorActivityLog(): void {
    const latestError = [...this.git.activityLogs()].reverse().find((entry) => entry.status === 'error');
    this.repositoryDialog.set(null);
    this.showActivityLogs(latestError?.repositoryId ? 'repository' : 'application');
  }

  protected async copyCommitOid(oid: string): Promise<void> {
    const feedback = { oid, status: await this.copyText(oid) ? 'copied' : 'failed' } as const;
    this.commitOidCopyFeedback.set(feedback);
    window.setTimeout(() => {
      if (this.commitOidCopyFeedback() === feedback) this.commitOidCopyFeedback.set(null);
    }, 2_000);
  }

  protected openTagCreator(): void {
    const repository = this.git.repository();
    if (!repository) return;
    const selected = !this.changesOpen() ? this.selectedCommitData() : null;
    const oid = selected?.oid ?? repository.headOid;
    if (!oid) return;
    this.showTagCreator(
      oid,
      selected?.subject || this.currentBranch()?.name || shortLabel(oid),
    );
  }

  private showTagCreator(oid: string, label: string): void {
    this.contextTagName.set('');
    this.signNewTag.set(false);
    this.tagCreationKind.set('lightweight');
    this.tagCreationMessage.set('');
    this.pendingTagTarget.set({ oid, label });
  }

  protected async submitTagCreation(): Promise<void> {
    const target = this.pendingTagTarget();
    const name = this.contextTagName().trim();
    const message = this.tagCreationKind() === 'annotated' ? this.tagCreationMessage().trim() : null;
    if (!target || !name || (this.tagCreationKind() === 'annotated' && !message) || this.git.busy()) return;
    if (this.signNewTag() && message) await this.git.manageReference('signed-tag', name, { expectedOid: target.oid, message });
    else await this.git.createTag(name, target.oid, message);
    if (!this.git.error()) {
      this.pendingTagTarget.set(null);
      this.contextTagName.set('');
      this.tagCreationMessage.set('');
      this.tagsOpen.set(true);
    }
  }

  protected compareSelectedCommitWithWorkingTree(oid: string): void {
    this.startWorkingTreeComparison(oid);
  }

  protected requestSelectedCommitCherryPick(commit: CommitSummary, event?: MouseEvent): void {
    this.resetMode.set('mixed');
    this.openHistoryConfirmation({
      kind: 'cherry-pick',
      oid: commit.oid,
      oids: [commit.oid],
      label: commit.subject || shortLabel(commit.oid),
    }, event?.currentTarget instanceof HTMLElement ? event.currentTarget : null);
  }

  protected openCommitMenu(event: MouseEvent, commit: CommitSummary, focusMenu = true): void {
    const stash = this.stashForOid(commit.oid);
    if (stash) {
      this.openStashMenu(event, stash, focusMenu);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const selection = this.selectedCommits();
    if (!selection.includes(commit.oid)) this.selectCommit(commit.oid);
    const selected = this.selectedCommits();
    const orderedOids = this.visibleGraphRows()
      .filter((row) => selected.includes(row.commit.oid))
      .map((row) => row.commit.oid)
      .reverse();
    this.openContextMenu(
      'commit',
      commit.oid,
      commit.subject || shortLabel(commit.oid),
      event,
      orderedOids.length ? orderedOids : [commit.oid],
      focusMenu,
    );
  }

  protected openSelectedCommitActions(event: MouseEvent): void {
    const commit = this.selectedCommitData();
    if (!commit || this.selectedCommits().length < 2) return;
    this.openCommitMenu(event, commit, true);
  }

  protected clearCommitSelection(): void {
    this.selectWip();
    queueMicrotask(() => this.commitListElement
      ?.querySelector<HTMLElement>('.wip-row:not(.linked-worktree)[data-graph-row]')
      ?.focus({ preventScroll: true }));
  }

  protected handleContextMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissGraphActionMenu(true);
      return;
    }

    this.navigateContextMenu(event);
  }

  protected handleFileContextMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissFileActionMenu(true);
      return;
    }

    this.navigateContextMenu(event);
  }

  protected handleSidebarActionMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissSidebarActionMenu(true);
      return;
    }

    this.navigateContextMenu(event);
  }

  protected handleSidebarContextMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissSidebarContextMenu(true);
      return;
    }

    this.navigateContextMenu(event);
  }

  protected handleBranchDropMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissBranchDropMenu(true);
      return;
    }

    this.navigateContextMenu(event);
  }

  private navigateContextMenu(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const menuItems = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])',
      ),
    );
    if (!menuItems.length) return;
    event.preventDefault();
    event.stopPropagation();
    const activeIndex = menuItems.indexOf(document.activeElement as HTMLElement);
    let nextIndex = 0;
    if (event.key === 'End') nextIndex = menuItems.length - 1;
    else if (event.key === 'ArrowUp') nextIndex = activeIndex <= 0 ? menuItems.length - 1 : activeIndex - 1;
    else if (event.key === 'ArrowDown') nextIndex = activeIndex < 0 || activeIndex === menuItems.length - 1 ? 0 : activeIndex + 1;
    menuItems[nextIndex].focus();
  }

  protected compareContextCommitWithWorkingTree(): void {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'commit' || menu.oids.length !== 1) return;
    this.contextMenu.set(null);
    this.startWorkingTreeComparison(menu.oid);
  }

  protected compareContextReferenceWithWorkingTree(): void {
    const menu = this.contextMenu();
    if (!menu || (menu.kind !== 'branch' && menu.kind !== 'remote')) return;
    this.contextMenu.set(null);
    this.startWorkingTreeComparison(menu.oid);
  }

  private startWorkingTreeComparison(oid: string): void {
    this.clearPanelFileSelection();
    this.selectedWorktreePath.set(null);
    this.selectedCommits.set([oid]);
    this.commitSelectionAnchor.set(oid);
    this.selectedCommit.set(oid);
    this.changesOpen.set(false);
    this.setPanelVisibility('commit-panel', true);
    void this.git.compareCommitWithWorkingTree(oid);
  }

  protected stashForOid(oid: string): StashEntry | null {
    return this.git.repository()?.stashes.find((stash) => stash.oid === oid) ?? null;
  }

  protected isStashHidden(oid: string): boolean {
    return this.hiddenStashOids().includes(oid);
  }

  protected selectStash(stash: StashEntry): void {
    void this.jumpToCommit(stash.oid);
  }

  protected openStashMenu(event: MouseEvent, stash: StashEntry, focusMenu = true): void {
    event.preventDefault();
    event.stopPropagation();
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId) return;
    this.prepareActionMenu('graph');
    this.contextMenu.set(null);
    this.actionMenuElement()?.nativeElement.classList.remove('positioned');
    this.fileContextMenu.set(null);
    this.commitFileContextMenu.set(null);
    if (focusMenu && event.currentTarget instanceof HTMLElement) {
      this.contextMenuReturnFocus = event.currentTarget;
    } else if (!focusMenu) {
      this.contextMenuReturnFocus = null;
    }
    this.selectStash(stash);
    const anchor = this.actionMenuAnchor(event);
    const preferredPosition = {
      x: anchor?.x ?? event.clientX,
      y: anchor?.y ?? event.clientY,
    };
    this.stashContextMenu.set({
      stash,
      repositoryId,
      x: Math.max(VIEWPORT_MENU_GUTTER, Math.min(
        preferredPosition.x,
        window.innerWidth - GRAPH_ACTION_MENU_WIDTH - VIEWPORT_MENU_GUTTER,
      )),
      y: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.y, window.innerHeight - 320)),
    });
    this.settleGraphActionMenuPosition('stash', stash.reference, preferredPosition, focusMenu);
  }

  protected openStashOptions(action: StashDialogRequest['action'], stash?: StashEntry, explicitReturnFocus?: HTMLElement | null): void {
    const repository = this.git.repository();
    if (!repository || this.git.busy()) return;
    if (stash && !this.git.requireRecoveryRepository(this.stashActionRepositoryId(stash) ?? '')) return;
    const menu = this.contextMenu();
    const branch = action === 'switch' ? repository.branches.find(candidate =>
      !candidate.remote && candidate.name === menu?.label && !candidate.current) : undefined;
    if (action === 'switch' && (!branch || !repository.headOid)) return;
    const returnFocus = explicitReturnFocus !== undefined
      ? explicitReturnFocus
      : (action === 'save' ? this.workingTreeOptionsToggle()?.nativeElement : null) ?? this.contextMenuReturnFocus
        ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.contextMenu.set(null);
    this.stashContextMenu.set(null);
    this.workingTreeOptionsOpen.set(false);
    this.git.error.set(null);
    this.stashDialog.set({ action, repositoryId: repository.id, stash, branch,
      headOid: repository.headOid ?? undefined, message: this.stashMessage(), returnFocus });
  }

  protected openStashOptionsFromToolbar(): void {
    const returnFocus = this.toolbarMenuReturnFocus;
    this.closeToolbarMenus();
    this.openStashOptions('save', undefined, returnFocus);
  }

  protected beginStashRename(stash?: StashEntry): void {
    const target = stash ?? this.stashContextMenu()?.stash ?? this.selectedStash();
    if (!target) return;
    const repositoryId = this.stashActionRepositoryId(target);
    if (!repositoryId || !this.git.requireRecoveryRepository(repositoryId)) return;
    this.stashRenameRepositoryId = repositoryId;
    this.stashContextMenu.set(null);
    this.stashRenameMessage.set(target.message.replace(/^(?:On|WIP on) [^:]+:\s*/, ''));
    this.stashRenameTarget.set(target);
  }

  protected async confirmStashRename(): Promise<void> {
    const stash = this.stashRenameTarget();
    const message = this.stashRenameMessage().trim();
    const repositoryId = this.stashRenameRepositoryId;
    if (!stash || !message || !repositoryId || this.git.busy()) return;
    const renamed = await this.git.renameStash(stash.reference, stash.oid, message, repositoryId);
    if (renamed && this.stashRenameTarget() === stash && this.stashRenameRepositoryId === repositoryId) this.stashRenameTarget.set(null);
  }

  protected async applyStashFromMenu(pop: boolean): Promise<void> {
    const menu = this.stashContextMenu();
    const stash = menu?.stash ?? this.selectedStash();
    const repositoryId = menu?.repositoryId ?? this.git.activeRepositoryId();
    if (!stash || !repositoryId) return;
    this.stashContextMenu.set(null);
    await this.runSelectedStash(pop, stash, repositoryId);
  }

  private async runSelectedStash(pop: boolean, stash: StashEntry, repositoryId: string): Promise<void> {
    if (this.git.busy()) return;
    const inspection = this.selectedCommit();
    const succeeded = pop
      ? await this.git.popStashEntry(stash.reference, stash.oid, repositoryId)
      : await this.git.applyStash(stash.reference, stash.oid, repositoryId);
    if (succeeded && this.git.activeRepositoryId() === repositoryId && this.selectedCommit() === inspection) this.selectWip();
  }

  protected requestStashDelete(stash?: StashEntry): void {
    const target = stash ?? this.stashContextMenu()?.stash ?? this.selectedStash();
    const repositoryId = target ? this.stashActionRepositoryId(target) : null;
    if (!target || !repositoryId || this.pendingStashDelete() || !this.git.requireRecoveryRepository(repositoryId)) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.stashContextMenu.set(null);
    this.pendingStashDelete.set({ repositoryId, stash: target, returnFocus });
  }

  private stashActionRepositoryId(stash: StashEntry): string | null {
    const menu = this.stashContextMenu();
    return menu?.stash === stash ? menu.repositoryId : this.git.activeRepositoryId();
  }

  protected closeStashDelete(result: { request: StashDeleteRequest; deleted: boolean }): void {
    if (this.pendingStashDelete() !== result.request) return;
    this.pendingStashDelete.set(null);
    if (this.git.activeRepositoryId() !== result.request.repositoryId) return;
    if (result.deleted) this.selectWip();
    afterNextRender(() => {
      if (this.pendingStashDelete() || this.git.activeRepositoryId() !== result.request.repositoryId) return;
      const opener = result.request.returnFocus;
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLButtonElement>('.stash-item:not([disabled]), .wip-nav:not([disabled])')?.focus();
    }, { injector: this.injector });
  }

  protected toggleStashVisibility(stash: StashEntry): void {
    this.hiddenStashOids.update((oids) => oids.includes(stash.oid)
      ? oids.filter((oid) => oid !== stash.oid)
      : [...oids, stash.oid]);
    this.storeHiddenStashes();
    this.stashContextMenu.set(null);
  }

  protected showAllStashes(): void {
    this.hiddenStashOids.set([]);
    this.storeHiddenStashes();
    this.stashContextMenu.set(null);
  }

  protected hideAllStashes(): void {
    this.hiddenStashOids.set(this.git.repository()?.stashes.map((stash) => stash.oid) ?? []);
    this.storeHiddenStashes();
    this.stashContextMenu.set(null);
  }

  protected handleReferenceActionKeydown(
    event: KeyboardEvent,
    kind: 'branch' | 'remote' | 'tag' | 'checkpoint',
    name: string,
    oid: string,
  ): void {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const bounds = target.getBoundingClientRect();
    this.contextMenuReturnFocus = target;
    if (kind === 'tag') this.closeTagPreview();
    this.openContextMenu(kind, oid, name, new MouseEvent('contextmenu', {
      clientX: Math.min(bounds.right - 10, bounds.left + 220),
      clientY: bounds.bottom,
    }), [oid], true);
  }

  protected handleStashActionKeydown(event: KeyboardEvent, stash: StashEntry): void {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const bounds = target.getBoundingClientRect();
    this.contextMenuReturnFocus = target;
    this.openStashMenu(new MouseEvent('contextmenu', {
      clientX: Math.min(bounds.right - 10, bounds.left + 220),
      clientY: bounds.bottom,
    }), stash, true);
  }

  protected openBranchMenu(event: MouseEvent, name: string, oid: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.openContextMenu('branch', oid, name, event, [oid], true);
  }

  protected openCheckpointMenu(event: MouseEvent, reference: string, oid: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.openContextMenu('checkpoint', oid, reference, event, [oid], true);
  }

  protected openFileMenu(
    event: MouseEvent,
    entry: WorkingTreeEntry,
    staged: boolean,
    focusMenu = true,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isUntrackedDirectory(entry)) return;
    this.prepareActionMenu('file');
    this.contextMenu.set(null);
    this.stashContextMenu.set(null);
    this.commitFileContextMenu.set(null);
    const returnTarget = this.fileMenuReturnTarget(event);
    if (focusMenu && returnTarget) this.fileContextMenuReturnFocus = returnTarget;
    else if (!focusMenu) this.fileContextMenuReturnFocus = null;
    const preferredPosition = { x: event.clientX, y: event.clientY };
    const state: FileContextMenuState = {
      content: this.workingMediaSelection(entry.path, staged),
      path: entry.path,
      staged,
      untracked: entry.indexStatus === '?',
      conflicted: entry.conflicted,
      x: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.x, window.innerWidth - 260)),
      y: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.y, window.innerHeight - 310)),
    };
    this.fileContextMenu.set(state);
    this.settleFileActionMenuPosition('working', `${entry.path}:${staged}`, preferredPosition, focusMenu);
  }

  protected openCommitFileMenu(
    event: MouseEvent,
    file: CommitFile,
    oid: string,
    source: 'commit' | 'comparison',
    focusMenu = true,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    this.prepareActionMenu('file');
    this.contextMenu.set(null);
    this.stashContextMenu.set(null);
    this.fileContextMenu.set(null);
    const returnTarget = this.fileMenuReturnTarget(event);
    if (focusMenu && returnTarget) this.fileContextMenuReturnFocus = returnTarget;
    else if (!focusMenu) this.fileContextMenuReturnFocus = null;
    const selected = this.panelFileSelectionSource() === source && this.selectedPanelFiles().includes(file.path)
      ? this.selectedPanelFiles()
      : [file.path];
    this.selectedPanelFiles.set(selected);
    this.panelFileSelectionSource.set(source);
    this.panelFileSelectionAnchor.set(file.path);
    const preferredPosition = { x: event.clientX, y: event.clientY };
    this.commitFileContextMenu.set({
      content: this.commitMediaSelection(file, oid, source),
      file,
      oid,
      paths: selected,
      source,
      x: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.x, window.innerWidth - 278)),
      y: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.y, window.innerHeight - 245)),
    });
    this.settleFileActionMenuPosition(
      'commit',
      `${source}:${oid}:${file.path}`,
      preferredPosition,
      focusMenu,
    );
  }

  protected handleFileActionKeydown(
    event: KeyboardEvent,
    entry: WorkingTreeEntry,
    staged: boolean,
  ): void {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = this.fileMenuReturnTarget(event);
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    this.fileContextMenuReturnFocus = target;
    this.openFileMenu(new MouseEvent('contextmenu', {
      clientX: Math.min(bounds.right - 10, bounds.left + 240),
      clientY: bounds.bottom,
    }), entry, staged, true);
  }

  protected handleCommitFileActionKeydown(
    event: KeyboardEvent,
    file: CommitFile,
    oid: string,
    source: 'commit' | 'comparison',
  ): void {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = this.fileMenuReturnTarget(event);
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    this.fileContextMenuReturnFocus = target;
    this.openCommitFileMenu(new MouseEvent('contextmenu', {
      clientX: Math.min(bounds.right - 10, bounds.left + 250),
      clientY: bounds.bottom,
    }), file, oid, source, true);
  }

  protected viewContextFileContent(source: 'working' | 'commit'): void {
    const menu = source === 'working' ? this.fileContextMenu() : this.commitFileContextMenu();
    const selection = menu?.content;
    if (!selection) return;
    if (selection.repoId !== this.git.activeRepositoryId()) { this.dismissFileActionMenu(); return; }
    const returnFocus = this.fileContextMenuReturnFocus;
    this.dismissFileActionMenu();
    this.fileContentDialog.set({ selection, returnFocus, editing: signal(false) });
  }

  protected openEditorDraftRecovery(returnFocus: HTMLElement | null = null): void {
    if (this.fileContentDialog()) { this.git.error.set('Finish the current editor or file preview before opening draft recovery.'); return; }
    this.editorDraftRecoveryReturnFocus = returnFocus ?? this.appMenuToggle()?.nativeElement
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.appMenuOpen.set(false); this.editorDraftRecoveryOpen.set(true);
  }

  protected closeEditorDraftRecovery(): void {
    this.editorDraftRecoveryOpen.set(false);
    const target = this.editorDraftRecoveryReturnFocus; this.editorDraftRecoveryReturnFocus = null;
    queueMicrotask(() => { if (!this.fileContentDialog() && target?.isConnected) target.focus({ preventScroll: true }); });
  }

  protected reviewEditorDraft(request: EditorDraftOpenRequest): void {
    const repository = this.git.repository();
    if (this.git.busy() || this.fileContentDialog() || repository?.path !== request.repositoryPath) return;
    const selection = this.workingMediaSelection(request.path, false);
    if (!selection) return;
    const returnFocus = this.editorDraftRecoveryReturnFocus;
    this.editorDraftRecoveryOpen.set(false); this.editorDraftRecoveryReturnFocus = null;
    this.fileContentDialog.set({ selection, returnFocus, editing: signal(false), recovery: { ...request.reference } });
  }

  protected handleEditorDraftRecoveryLoaderKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.closeEditorDraftRecovery(); }
    else if (event.key === 'Tab') { event.preventDefault(); this.editorDraftRecoveryLoaderClose()?.nativeElement.focus(); }
  }

  protected handleFileContentLoaderKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.closeFileContentDialog(); }
    else if (event.key === 'Tab') { event.preventDefault(); this.fileContentLoaderClose()?.nativeElement.focus(); }
  }

  protected closeFileContentDialog(): void {
    const request = this.fileContentDialog();
    this.fileContentDialog.set(null);
    if (request?.selection.repoId === this.git.activeRepositoryId()) {
      setTimeout(() => {
        if (!this.fileContentDialog() && request.selection.repoId === this.git.activeRepositoryId() && request.returnFocus?.isConnected) {
          request.returnFocus.focus({ preventScroll: true });
        }
      });
    }
  }

  protected async viewCommitFileChanges(): Promise<void> {
    if (!await this.inspectContextCommitFile()) return;
    this.openDiffViewer();
  }

  protected async viewCommitFileInsight(mode: 'history' | 'blame'): Promise<void> {
    if (!await this.inspectContextCommitFile()) return;
    this.openDiffViewer();
    if (mode === 'history') await this.showFileHistory();
    else await this.showFileBlame();
  }

  protected requestRestoreCommitFile(): void {
    const menu = this.commitFileContextMenu();
    if (!menu) return;
    const returnFocus = this.fileContextMenuReturnFocus;
    this.dismissFileActionMenu();
    this.openFileConfirmation({
      kind: 'restore-commit',
      path: menu.file.path,
      paths: menu.paths,
      oid: menu.oid,
      untracked: false,
    }, returnFocus);
  }

  private async inspectContextCommitFile(): Promise<boolean> {
    const menu = this.commitFileContextMenu();
    if (!menu) return false;
    this.commitFileContextMenu.set(null);
    if (menu.source === 'comparison') await this.git.inspectComparisonFile(menu.file);
    else await this.git.inspectCommitFile(menu.file);
    return menu.source === 'comparison' ? !!this.git.comparisonFileDiff() : !!this.git.commitFileDiff();
  }

  private clearPanelFileSelection(): void {
    this.selectedPanelFiles.set([]);
    this.panelFileSelectionSource.set(null);
    this.panelFileSelectionAnchor.set(null);
  }

  protected async viewFileChanges(): Promise<void> {
    const menu = this.fileContextMenu();
    if (!menu) return;
    this.fileContextMenu.set(null);
    await this.inspectWorkingTreeFile(menu.path, menu.staged);
  }

  protected async toggleFileStaging(): Promise<void> {
    const menu = this.fileContextMenu();
    if (!menu) return;
    this.fileContextMenu.set(null);
    if (menu.staged) await this.git.unstagePath(menu.path);
    else await this.git.stagePath(menu.path);
  }

  protected requestDiscardFile(): void {
    const menu = this.fileContextMenu();
    if (!menu || menu.staged) return;
    const returnFocus = this.fileContextMenuReturnFocus;
    this.dismissFileActionMenu();
    this.openFileConfirmation({
      kind: 'discard',
      path: menu.path,
      untracked: menu.untracked,
    }, returnFocus);
  }

  protected toggleDiscardSelection(path: string): void {
    this.selectedDiscardPaths.update(paths => paths.includes(path)
      ? paths.filter(candidate => candidate !== path) : [...paths, path]);
  }

  protected async requestBulkDiscard(selected = false): Promise<void> {
    const repositoryId = this.git.activeRepositoryId();
    if (!repositoryId || this.git.busy()) return;
    const paths = selected ? this.selectedDiscardPaths().filter(path =>
      this.unstagedEntries().some(entry => entry.path === path)) : null;
    if (selected && !paths?.length) return;
    const preview = await this.git.previewDiscard(paths);
    if (!preview || repositoryId !== this.git.activeRepositoryId()) return;
    this.openFileConfirmation({
      kind: 'discard-bulk', path: `${preview.paths.length} unstaged files`,
      untracked: false, preview, repositoryId,
    }, this.workingTreeOptionsToggle()?.nativeElement ?? null);
  }

  protected async openSavedDiscards(): Promise<void> {
    const repositoryId = this.git.activeRepositoryId();
    const recoveries = await this.git.loadDiscardRecoveries();
    if (this.git.error() || repositoryId !== this.git.activeRepositoryId()) return;
    this.savedDiscardsRepositoryId.set(repositoryId);
    this.savedDiscards.set(recoveries);
    queueMicrotask(() => requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('[data-saved-discards-close]')?.focus()));
  }

  protected savedDiscardLabel(id: string): string {
    const nanos = Number(id.split('-')[0]);
    return Number.isFinite(nanos) ? new Date(nanos / 1_000_000).toLocaleString() : id;
  }

  protected requestSavedDiscard(recovery: DiscardRecovery, remove = false): void {
    const repositoryId = this.savedDiscardsRepositoryId();
    this.savedDiscards.set(null);
    this.openFileConfirmation({
      kind: remove ? 'forget-discard' : 'recover-discard',
      path: this.savedDiscardLabel(recovery.id), untracked: false, repositoryId: repositoryId ?? undefined, recovery,
    });
  }

  protected requestDiscardEntry(entry: WorkingTreeEntry, event: MouseEvent): void {
    event.stopPropagation();
    if (entry.conflicted || this.isUntrackedDirectory(entry)) return;
    this.openFileConfirmation({
      kind: 'discard',
      path: entry.path,
      untracked: entry.indexStatus === '?',
    }, event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
  }

  protected async applyHunk(path: string, staged: boolean, hunkIndex: number): Promise<void> {
    const diff = this.activeWorkingTreeDiff();
    if (!diff || diff.path !== path || diff.staged !== staged || diff.truncated || this.git.busy()) return;
    await this.applyDiffChange(() => this.git.applyWorkingTreeHunk(path, staged, hunkIndex, staged ? 'unstage' : 'stage', diff.patch));
  }

  private async applyDiffChange(change: () => Promise<boolean>): Promise<void> {
    const groups = this.selectedDiffLineGroups();
    const repositoryId = this.git.activeRepositoryId();
    if (await change() && repositoryId === this.git.activeRepositoryId() && groups === this.selectedDiffLineGroups()) {
      this.selectedDiffLineGroups.set([]);
    }
  }

  protected diffLineSelectionKey(line: DiffLine): string {
    return `${line.hunkIndex}:${line.changeIndices.join(',')}`;
  }

  protected isDiffLineSelected(line: DiffLine): boolean {
    return this.selectedDiffLineGroupSet().has(this.diffLineSelectionKey(line));
  }

  protected toggleDiffLineSelection(line: DiffLine): void {
    if (line.hunkIndex === null || !line.changeIndices.length || !this.activeWorkingTreeDiff()) return;
    const key = this.diffLineSelectionKey(line);
    this.selectedDiffLineGroups.update((groups) => {
      const sameHunk = groups.filter((group) => Number(group.split(':', 1)[0]) === line.hunkIndex);
      return sameHunk.includes(key) ? sameHunk.filter((group) => group !== key) : [...sameHunk, key];
    });
  }

  protected async applySelectedDiffLines(): Promise<void> {
    const diff = this.activeWorkingTreeDiff();
    const selection = this.selectedDiffLines();
    if (!diff || !selection || diff.truncated || this.git.busy()) return;
    await this.applyDiffChange(() => this.git.applyWorkingTreeLines(
      diff.path,
      diff.staged,
      selection.hunkIndex,
      selection.lineIndices,
      diff.staged ? 'unstage' : 'stage',
      diff.patch,
    ));
  }

  protected async reloadWorkingTreeDiff(): Promise<void> {
    const diff = this.activeWorkingTreeDiff();
    if (!diff || this.git.busy()) return;
    this.selectedDiffLineGroups.set([]);
    await this.git.inspectWorkingTreeFile(diff.path, diff.staged);
  }

  protected requestDiscardSelectedDiffLines(): void {
    const diff = this.activeWorkingTreeDiff();
    const selection = this.selectedDiffLines();
    if (!diff || diff.staged || diff.truncated || !selection || this.isUntrackedPath(diff.path)) return;
    this.openFileConfirmation({
      kind: 'discard-lines',
      path: diff.path,
      untracked: false,
      staged: false,
      hunkIndex: selection.hunkIndex,
      lineIndices: selection.lineIndices,
      expectedPatch: diff.patch,
    });
  }

  protected requestDiscardHunk(path: string, hunkIndex: number): void {
    const diff = this.activeWorkingTreeDiff();
    if (!diff || diff.path !== path || diff.staged || diff.truncated || this.isUntrackedPath(path)) return;
    this.openFileConfirmation({
      kind: 'discard-hunk',
      path,
      untracked: false,
      staged: false,
      hunkIndex,
      expectedPatch: diff.patch,
    });
  }

  protected async requestIgnoreFile(patternKind: 'file' | 'extension' | 'directory'): Promise<void> {
    const menu = this.fileContextMenu();
    if (!menu || menu.staged) return;
    const returnFocus = this.fileContextMenuReturnFocus;
    this.dismissFileActionMenu();
    if (menu.untracked) {
      await this.git.ignorePath(menu.path, patternKind, false);
      return;
    }
    this.openFileConfirmation({
      kind: 'ignore',
      path: menu.path,
      untracked: false,
      patternKind,
    }, returnFocus);
  }

  protected async confirmFileAction(): Promise<void> {
    const action = this.pendingFileAction();
    if (!action) return;
    this.dismissFileConfirmation(false);
    if (!action.repositoryId || !this.git.requireRecoveryRepository(action.repositoryId)) return;
    if (action.kind === 'discard-bulk' && action.preview) {
      const selection = this.selectedDiscardPaths();
      const succeeded = await this.git.discardPrepared(action.preview, action.repositoryId);
      if (succeeded && action.repositoryId === this.git.activeRepositoryId() && selection === this.selectedDiscardPaths()) {
        this.selectedDiscardPaths.set([]);
        this.discardSelectionMode.set(false);
      }
    } else if ((action.kind === 'recover-discard' || action.kind === 'forget-discard') && action.recovery) {
      if (action.kind === 'forget-discard') await this.git.forgetSavedDiscard(action.recovery.id);
      else await this.git.applySavedDiscard(action.recovery.id, action.recovery.restored);
    } else if (action.kind === 'discard') {
      await this.git.discardPath(action.path, action.untracked);
    } else if (action.kind === 'discard-hunk' && action.hunkIndex !== undefined) {
      await this.applyDiffChange(() => this.git.applyWorkingTreeHunk(action.path, false, action.hunkIndex!, 'discard', action.expectedPatch));
    } else if (action.kind === 'discard-lines' && action.hunkIndex !== undefined && action.lineIndices?.length) {
      await this.applyDiffChange(() => this.git.applyWorkingTreeLines(action.path, false, action.hunkIndex!, action.lineIndices!, 'discard', action.expectedPatch));
    } else if (action.kind === 'restore-commit' && action.oid) {
      const view = this.fileActionView();
      const succeeded = await this.git.restoreFilesFromCommit(action.oid, action.paths?.length ? action.paths : [action.path]);
      if (succeeded && view === this.fileActionView()) this.selectWip();
    } else if (action.patternKind) {
      await this.git.ignorePath(action.path, action.patternKind, true);
    }
  }

  protected isUntrackedPath(path: string): boolean {
    return this.untrackedPaths().has(path);
  }

  protected fileHasExtension(path: string): boolean {
    const name = path.split(/[\\/]/).at(-1) ?? '';
    return name.lastIndexOf('.') > 0 && name.lastIndexOf('.') < name.length - 1;
  }

  protected fileHasParentDirectory(path: string): boolean {
    return /[\\/]/.test(path);
  }

  protected async copyContextValue(value: string): Promise<void> {
    await this.copyText(value);
    this.contextMenu.set(null);
  }

  protected async checkoutContextTarget(): Promise<void> {
    const menu = this.contextMenu();
    if (!menu || (menu.kind !== 'tag' && this.git.busy())) return;
    const element = this.actionMenuElement()?.nativeElement ?? null;
    const target = this.contextMenuReturnFocus;
    const repositoryId = this.git.activeRepositoryId();
    this.dismissGraphActionMenu();
    const generation = this.contextMenuGeneration;
    if (menu.kind === 'branch') await this.git.checkout(menu.label);
    else if (menu.kind === 'commit') await this.git.checkoutCommit(menu.oid);
    else if (menu.kind === 'remote') await this.git.checkoutRemote(menu.label);
    else this.selectCommit(menu.oid);
    queueMicrotask(() => requestAnimationFrame(() => {
      if (this.git.activeRepositoryId() === repositoryId && generation === this.contextMenuGeneration
        && this.canRestoreFocusFrom(element) && target?.isConnected && !target.matches(':disabled')) {
        target.focus({ preventScroll: true });
      }
    }));
  }

  protected async createContextBranch(): Promise<void> {
    const menu = this.contextMenu();
    const name = this.contextBranchName().trim();
    if (!menu || !name || this.git.busy()) return;
    const generation = this.contextMenuGeneration;
    const repositoryId = this.git.repository()?.id;
    this.contextBranchError.set(null);
    const result = await this.git.createBranchAt(name, menu.oid);
    if (generation !== this.contextMenuGeneration || this.git.repository()?.id !== repositoryId || !this.contextMenu() || !result) return;
    if (result.status === 'success') {
      this.contextBranchName.set('');
      this.dismissGraphActionMenu(true);
      return;
    }
    this.contextBranchError.set(result.error ?? 'Branch creation was interrupted. Try again.');
    queueMicrotask(() => requestAnimationFrame(() => {
      const active = this.contextMenu();
      const element = this.actionMenuElement()?.nativeElement;
      if (generation !== this.contextMenuGeneration || !active || !element) return;
      this.contextMenu.set({ ...active, ...this.fittedMenuPosition(element, active) });
      if (this.canRestoreFocusFrom(element)) {
        element.querySelector<HTMLInputElement>('#context-branch-name')?.focus({ preventScroll: true });
        element.querySelector<HTMLElement>('#context-branch-error')?.scrollIntoView({ block: 'nearest' });
      }
    }));
  }

  protected openContextBranchCreator(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const menu = this.contextMenu();
    if (!menu) return;
    this.actionMenuElement()?.nativeElement.classList.remove('positioned');
    this.contextBranchCreatorOpen.set(true);
    this.settleGraphActionMenuPosition(
      'context',
      `${menu.kind}:${menu.oid}`,
      { x: menu.x, y: menu.y },
      false,
    );
    queueMicrotask(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      const active = this.contextMenu();
      if (active?.kind !== menu.kind || active.oid !== menu.oid || !this.contextBranchCreatorOpen()) return;
      this.actionMenuElement()?.nativeElement.querySelector<HTMLInputElement>('#context-branch-name')?.focus();
    })));
  }

  protected handleContextBranchCreatorKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.closeContextBranchCreator(event);
      return;
    }
    if (event.key !== 'Tab') return;
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const controls = [...form.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')];
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }

  protected closeContextBranchCreator(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const menu = this.contextMenu();
    if (!menu) return;
    this.actionMenuElement()?.nativeElement.classList.remove('positioned');
    this.contextBranchName.set('');
    this.contextBranchCreatorOpen.set(false);
    this.settleGraphActionMenuPosition(
      'context',
      `${menu.kind}:${menu.oid}`,
      { x: menu.x, y: menu.y },
      false,
    );
    queueMicrotask(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      this.actionMenuElement()?.nativeElement
        .querySelector<HTMLElement>('[data-create-context-branch]')
        ?.focus();
    })));
  }

  protected openContextTagCreator(): void {
    const menu = this.contextMenu();
    if (!menu) return;
    this.contextMenu.set(null);
    this.showTagCreator(menu.oid, menu.label);
  }

  protected requestReferenceAction(action: ReferenceActionRequest['action']): void {
    const menu = this.contextMenu();
    const repositoryId = this.git.activeRepositoryId();
    if (!menu || !repositoryId || this.git.busy()) return;
    if (action === 'delete-remote-branch' ? menu.kind !== 'remote' : menu.kind !== 'tag') return;
    const remote = menu.kind === 'remote' ? this.remoteLocationName(menu.label) : undefined;
    const name = menu.kind === 'remote' ? this.remoteBranchLabel(menu.label) : menu.label;
    const returnFocus = this.contextMenuReturnFocus;
    this.contextMenu.set(null);
    this.git.dismissError();
    this.referenceAction.set({ action, repositoryId, name, oid: menu.oid, remote, returnFocus });
  }

  protected async verifyContextTag(): Promise<void> {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'tag') return;
    this.contextMenu.set(null);
    await this.git.manageReference('verify-tag', menu.label);
  }

  protected async renameContextBranch(): Promise<void> {
    const menu = this.contextMenu();
    const name = this.contextRenameName().trim();
    if (!menu || menu.kind !== 'branch' || !name || name === menu.label || this.git.busy()) return;
    const wasPinned = this.pinnedBranch() === menu.label;
    this.contextMenu.set(null);
    await this.git.renameBranch(menu.label, name);
    if (!this.git.error() && wasPinned) {
      this.pinnedBranch.set(name);
      this.storePinnedBranch();
    }
  }

  private requestPaletteBranchRename(branch: string): void {
    if (!this.git.repository()?.branches.some((candidate) => !candidate.remote && candidate.name === branch)) return;
    this.contextRenameName.set(branch);
    this.pendingBranchRename.set(branch);
  }

  protected async confirmPaletteBranchRename(): Promise<void> {
    const branch = this.pendingBranchRename();
    const name = this.contextRenameName().trim();
    if (!branch || !name || name === branch) return;
    const wasPinned = this.pinnedBranch() === branch;
    this.pendingBranchRename.set(null);
    await this.git.renameBranch(branch, name);
    if (!this.git.error() && wasPinned) {
      this.pinnedBranch.set(name);
      this.storePinnedBranch();
    }
  }

  private requestPaletteBranchDelete(branch: string, returnFocus: HTMLElement | null = null): void {
    const candidate = this.git.repository()?.branches.find(
      (item) => !item.remote && item.name === branch,
    );
    if (!candidate || candidate.current) return;
    this.forceBranchDelete.set(false);
    this.openBranchConfirmation({ kind: 'delete', branch }, returnFocus);
  }

  protected contextBranchUpstream(name: string): string | null {
    return this.git.repository()?.branches.find((branch) => !branch.remote && branch.name === name)?.upstream ?? null;
  }

  protected requestBranchUpstream(): void {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'branch') return;
    const branch = this.git.repository()?.branches.find((candidate) => !candidate.remote && candidate.name === menu.label);
    const options = this.remoteUpstreamBranches();
    if (!branch || !options.length) return;
    const sameName = options.find((candidate) => candidate.name.endsWith(`/${branch.name}`));
    this.branchUpstreamChoice.set(branch.upstream ?? sameName?.name ?? options[0].name);
    this.pendingBranchUpstream.set({ branch: branch.name, current: branch.upstream });
    this.contextMenu.set(null);
  }

  protected async confirmBranchUpstream(upstream: string | null = this.branchUpstreamChoice()): Promise<void> {
    const pending = this.pendingBranchUpstream();
    if (!pending || this.git.busy() || (upstream !== null && !this.remoteUpstreamBranches().some((branch) => branch.name === upstream))) return;
    this.pendingBranchUpstream.set(null);
    await this.git.setBranchUpstream(pending.branch, upstream);
  }

  protected async unsetContextBranchUpstream(): Promise<void> {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'branch' || !this.contextBranchUpstream(menu.label) || this.git.busy()) return;
    this.contextMenu.set(null);
    await this.git.setBranchUpstream(menu.label, null);
  }

  protected async integrateContextBranch(strategy: 'merge' | 'ff-only' | 'squash'): Promise<void> {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'branch' || menu.label === this.git.repository()?.status.branch || this.git.busy()) return;
    this.contextMenu.set(null);
    await this.git.integrateBranch(menu.label, strategy);
  }

  protected requestBranchAction(kind: PendingBranchAction['kind']): void {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'branch' || menu.label === this.git.repository()?.status.branch) return;
    const returnFocus = this.contextMenuReturnFocus;
    this.dismissGraphActionMenu();
    this.forceBranchDelete.set(false);
    this.openBranchConfirmation({ kind, branch: menu.label }, returnFocus);
  }

  protected requestCheckpointDelete(): void {
    const menu = this.contextMenu();
    const repoId = this.git.activeRepositoryId();
    if (!menu || menu.kind !== 'checkpoint' || !repoId) return;
    const action = { repoId, reference: menu.label, oid: menu.oid };
    this.checkpointActionReturnFocus = this.contextMenuReturnFocus;
    this.dismissGraphActionMenu();
    this.pendingCheckpointDelete.set(action);
    queueMicrotask(() => requestAnimationFrame(() => {
      if (this.pendingCheckpointDelete() !== action) return;
      this.checkpointConfirmationDialog()?.nativeElement
        .querySelector<HTMLElement>('[data-checkpoint-dialog-cancel]')
        ?.focus();
    }));
  }

  protected dismissCheckpointConfirmation(restoreFocus = true): void {
    const target = restoreFocus ? this.checkpointActionReturnFocus : null;
    this.pendingCheckpointDelete.set(null);
    this.checkpointActionReturnFocus = null;
    if (restoreFocus) this.restoreCheckpointActionFocus(target);
  }

  protected handleCheckpointConfirmationKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissCheckpointConfirmation(true);
      return;
    }
    this.cycleDialogFocus(this.checkpointConfirmationDialog()?.nativeElement, event);
  }

  protected async confirmCheckpointDelete(): Promise<void> {
    const action = this.pendingCheckpointDelete();
    if (!action || this.git.busy() || this.git.historyLoading() || this.git.checkpointVisibilityUpdating()) return;
    const returnFocus = this.checkpointActionReturnFocus;
    this.dismissCheckpointConfirmation(false);
    if (this.git.activeRepositoryId() !== action.repoId) {
      this.git.error.set('The active repository changed. Open the checkpoint again before deleting it.');
      this.restoreCheckpointActionFocus(returnFocus);
      return;
    }
    await this.git.deleteCheckpointReference(action.reference, action.oid);
    this.reconcileCheckpointSelection(action.repoId);
    this.restoreCheckpointActionFocus(returnFocus);
  }

  private restoreCheckpointActionFocus(target: HTMLElement | null): void {
    queueMicrotask(() => {
      const fallback = this.historyInert()
        ? this.commitPanelClose()?.nativeElement
        : this.graphSettingsToggle()?.nativeElement;
      (target?.isConnected && target.getClientRects().length && !target.closest('[inert]') ? target : fallback)
        ?.focus({ preventScroll: true });
    });
  }

  protected async confirmBranchAction(): Promise<void> {
    const action = this.pendingBranchAction();
    if (!action || this.git.busy()) return;
    const returnFocus = this.branchActionReturnFocus;
    this.dismissBranchConfirmation(false);
    if (action.kind === 'rebase') await this.git.integrateBranch(action.branch, 'rebase');
    else {
      const wasPinned = this.pinnedBranch() === action.branch;
      const outcome = await this.git.deleteBranch(action.branch, action.unmerged || this.forceBranchDelete());
      if (outcome === 'notMerged') {
        this.forceBranchDelete.set(false);
        this.openBranchConfirmation({ kind: 'delete', branch: action.branch, unmerged: true }, returnFocus);
        return;
      }
      if (outcome === 'deleted' && wasPinned) {
        this.pinnedBranch.set(null);
        this.storePinnedBranch();
      }
    }
  }

  protected requestHistoryAction(kind: PendingHistoryAction['kind']): void {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'commit') return;
    const oids = kind === 'cherry-pick' ? menu.oids : kind === 'revert' ? [...menu.oids].reverse() : [menu.oid];
    const returnFocus = this.contextMenuReturnFocus;
    this.dismissGraphActionMenu();
    this.resetMode.set('mixed');
    this.openHistoryConfirmation(
      { kind, oid: kind === 'revert' ? oids[0] : menu.oid, oids, label: menu.label },
      returnFocus,
    );
  }

  protected requestRebaseSplit(): void {
    const repository = this.git.repository();
    if (!repository?.headOid || !repository.status.rebaseEditStopped || repository.status.rebaseSplit || this.isRebaseRootStop() || this.git.busy()) return;
    const head = repository.commits.find(commit => commit.oid === repository.headOid);
    this.openHistoryConfirmation({ kind: 'split', oid: repository.headOid,
      oids: [repository.headOid], label: head?.subject || shortLabel(repository.headOid) });
  }

  protected canStartBisectAt(oid: string): boolean {
    const repository = this.git.repository();
    return !!repository?.headOid
      && oid !== repository.headOid
      && !repository.status.entryCount
      && !repository.status.rebaseInProgress
      && !repository.status.bisectInProgress
      && !this.git.busy();
  }

  protected requestBisectFromContext(): void {
    const menu = this.contextMenu();
    if (!menu || menu.kind !== 'commit' || menu.oids.length !== 1 || !this.canStartBisectAt(menu.oid)) return;
    this.contextMenu.set(null);
    this.openBisectConfirmation(menu.oid, menu.label);
  }

  protected requestBisectFromSelection(): void {
    const commit = this.selectedCommitData();
    if (!commit || !this.canStartBisectAt(commit.oid)) return;
    this.openBisectConfirmation(commit.oid, commit.subject || shortLabel(commit.oid));
  }

  private openBisectConfirmation(goodOid: string, goodLabel: string): void {
    const repository = this.git.repository();
    if (!repository?.headOid) return;
    const head = repository.commits.find((commit) => commit.oid === repository.headOid);
    this.pendingBisectStart.set({
      goodOid,
      goodLabel,
      badOid: repository.headOid,
      badLabel: head?.subject || this.currentBranch()?.name || shortLabel(repository.headOid),
    });
  }

  protected async confirmBisectStart(): Promise<void> {
    const pending = this.pendingBisectStart();
    if (!pending) return;
    this.pendingBisectStart.set(null);
    await this.git.startBisect(pending.goodOid);
  }

  protected async markBisect(verdict: 'good' | 'bad' | 'skip'): Promise<void> {
    await this.git.markBisect(verdict);
  }

  protected async resetBisect(): Promise<void> {
    await this.git.resetBisect();
  }

  protected async confirmHistoryAction(): Promise<void> {
    const action = this.pendingHistoryAction();
    if (!action || this.git.busy()) return;
    const repositoryId = this.historyActionRepositoryId;
    if (!repositoryId || !this.git.requireRecoveryRepository(repositoryId)) return;
    const parents = this.historyMergeParents();
    const mainline = this.historyMainline();
    const noCommit = this.historyNoCommit();
    if (parents.length && (action.oids.length !== 1 || !mainline || mainline > parents.length)) return;
    if (action.kind === 'reset') {
      const preview = this.resetPreview();
      const repositoryId = this.resetPreviewRepositoryId;
      if (!preview || !repositoryId || preview.mode !== this.resetMode() || preview.targetOid !== action.oid) return;
      await this.git.resetPrepared(preview, repositoryId);
      this.resetPreview.set(null);
      if (!this.git.error()) this.dismissHistoryConfirmation(true);
      else afterNextRender(() => {
        this.historyConfirmationDialog()?.nativeElement.querySelector<HTMLElement>('.recovery-error')?.focus();
      }, { injector: this.injector });
      return;
    }
    if (action.kind === 'cherry-pick') {
      if (action.targetBranch && this.git.repository()?.status.branch !== action.targetBranch) {
        const result = await this.git.checkout(action.targetBranch);
        if (result?.status !== 'success' || this.pendingHistoryAction() !== action) return;
        if (!this.git.requireRecoveryRepository(repositoryId)) return;
        if (this.git.repository()?.status.branch !== action.targetBranch) return;
      }
      await this.git.cherryPick(action.oids, mainline, noCommit);
    }
    else if (action.kind === 'revert') {
      if (action.oids.length > 1) await this.git.revertCommits(action.oids);
      else await this.git.revertCommit(action.oid, mainline);
    }
    else if (action.kind === 'split') {
      await this.git.beginRebaseSplit(action.oid);
      if (!this.git.error() && repositoryId === this.git.activeRepositoryId()) {
        this.amendPrevious.set(false);
        this.selectWip();
      }
    }
    if (this.pendingHistoryAction() !== action || repositoryId !== this.git.activeRepositoryId()) return;
    if (!this.git.error()) this.dismissHistoryConfirmation(true);
    else afterNextRender(() => {
      if (this.pendingHistoryAction() !== action || repositoryId !== this.git.activeRepositoryId()) return;
      this.historyConfirmationDialog()?.nativeElement.querySelector<HTMLElement>('.recovery-error')?.focus();
    }, { injector: this.injector });
  }

  protected async refreshResetPreview(mode: ResetMode = this.resetMode()): Promise<void> {
    const action = this.pendingHistoryAction();
    if (action?.kind !== 'reset' || this.git.busy()) return;
    const request = ++this.resetPreviewRequest;
    this.resetMode.set(mode);
    this.resetPreview.set(null);
    this.resetPreviewBusy.set(true);
    const repositoryId = this.git.activeRepositoryId();
    this.resetPreviewRepositoryId = repositoryId;
    try {
      const preview = await this.git.previewReset(action.oid, mode);
      if (request === this.resetPreviewRequest && this.pendingHistoryAction() === action
        && repositoryId === this.git.activeRepositoryId()) {
        this.resetPreview.set(preview);
      }
    } finally {
      if (request === this.resetPreviewRequest) this.resetPreviewBusy.set(false);
    }
  }

  protected handleHistoryConfirmationKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismissHistoryConfirmation(true);
      return;
    }
    this.cycleDialogFocus(this.historyConfirmationDialog()?.nativeElement, event);
  }

  protected handleBranchConfirmationKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissBranchConfirmation(true);
      return;
    }
    this.cycleDialogFocus(this.branchConfirmationDialog()?.nativeElement, event);
  }

  protected handleFileConfirmationKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissFileConfirmation(true);
      return;
    }

    this.cycleDialogFocus(this.fileConfirmationDialog()?.nativeElement, event);
  }

  protected handleSavedDiscardsKeydown(event: KeyboardEvent): void {
    this.cycleDialogFocus(document.querySelector<HTMLElement>('.saved-discards-dialog') ?? undefined, event);
  }

  protected dismissSavedDiscards(): void {
    this.savedDiscards.set(null);
    queueMicrotask(() => this.workingTreeOptionsToggle()?.nativeElement.focus());
  }

  protected dismissFileConfirmation(restoreFocus = true): void {
    const target = restoreFocus ? this.fileActionReturnFocus : null;
    this.pendingFileAction.set(null);
    this.fileActionReturnFocus = null;
    if (target?.isConnected) {
      queueMicrotask(() => target.focus({ preventScroll: true }));
    }
  }

  private openFileConfirmation(
    action: PendingFileAction,
    returnFocus: HTMLElement | null = null,
  ): void {
    action.repositoryId ??= this.git.activeRepositoryId() ?? undefined;
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.fileActionReturnFocus = returnFocus ?? activeElement;
    this.pendingFileAction.set(action);
    queueMicrotask(() => requestAnimationFrame(() => {
      if (this.pendingFileAction() !== action) return;
      this.fileConfirmationDialog()?.nativeElement
        .querySelector<HTMLElement>('[data-file-dialog-cancel]')
        ?.focus();
    }));
  }

  protected dismissBranchConfirmation(restoreFocus = true): void {
    const target = restoreFocus ? this.branchActionReturnFocus : null;
    this.pendingBranchAction.set(null);
    this.branchActionReturnFocus = null;
    if (target?.isConnected) {
      queueMicrotask(() => target.focus({ preventScroll: true }));
    }
  }

  private openBranchConfirmation(
    action: PendingBranchAction,
    returnFocus: HTMLElement | null = null,
  ): void {
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.branchActionReturnFocus = returnFocus ?? activeElement;
    this.pendingBranchAction.set(action);
    queueMicrotask(() => requestAnimationFrame(() => {
      if (this.pendingBranchAction() !== action) return;
      this.branchConfirmationDialog()?.nativeElement
        .querySelector<HTMLElement>('[data-branch-dialog-cancel]')
        ?.focus();
    }));
  }

  private cycleDialogFocus(dialog: HTMLElement | undefined, event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !dialog) return;
    const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ));
    const unselectedRadioGroups = new Set<string>();
    const focusable = candidates.filter((element) => {
      if (element.hidden || element.getAttribute('aria-hidden') === 'true' || !element.getClientRects().length) {
        return false;
      }
      if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) {
        return true;
      }
      const selected = candidates.find((candidate) =>
        candidate instanceof HTMLInputElement
        && candidate.type === 'radio'
        && candidate.name === element.name
        && candidate.checked);
      if (selected) return selected === element;
      if (unselectedRadioGroups.has(element.name)) return false;
      unselectedRadioGroups.add(element.name);
      return true;
    });
    if (!focusable.length) return;

    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1)
      : (activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1);
    event.preventDefault();
    event.stopPropagation();
    focusable[nextIndex].focus();
  }

  protected dismissHistoryConfirmation(restoreFocus = true): void {
    const target = restoreFocus ? this.historyActionReturnFocus : null;
    this.pendingHistoryAction.set(null);
    this.resetPreviewRequest++;
    this.resetPreview.set(null);
    this.resetPreviewBusy.set(false);
    this.resetPreviewRepositoryId = null;
    this.historyActionReturnFocus = null;
    if (target?.isConnected) {
      queueMicrotask(() => target.focus({ preventScroll: true }));
    }
  }

  private openHistoryConfirmation(
    action: PendingHistoryAction,
    returnFocus: HTMLElement | null = null,
  ): void {
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.historyActionReturnFocus = returnFocus ?? activeElement;
    this.historyActionRepositoryId = this.git.activeRepositoryId();
    this.historyMainline.set(null);
    this.historyNoCommit.set(false);
    this.pendingHistoryAction.set(action);
    if (action.kind === 'reset') void this.refreshResetPreview();
    queueMicrotask(() => requestAnimationFrame(() => {
      if (this.pendingHistoryAction() !== action) return;
      this.historyConfirmationDialog()?.nativeElement
        .querySelector<HTMLElement>('[data-history-dialog-cancel]')
        ?.focus();
    }));
  }

  private openContextMenu(
    kind: 'commit' | 'branch' | 'remote' | 'tag' | 'checkpoint',
    oid: string,
    label: string,
    event: MouseEvent,
    oids: string[] = [oid],
    focusMenu = false,
  ): void {
    this.prepareActionMenu('graph');
    this.stashContextMenu.set(null);
    this.contextMenuGeneration += 1;
    this.actionMenuElement()?.nativeElement.classList.remove('positioned');
    if (focusMenu && event.currentTarget instanceof HTMLElement) {
      this.contextMenuReturnFocus = event.currentTarget;
    } else if (!focusMenu) {
      this.contextMenuReturnFocus = null;
    }
    this.contextBranchName.set('');
    this.contextBranchCreatorOpen.set(false);
    this.contextBranchError.set(null);
    this.contextTagName.set('');
    this.contextRenameName.set(kind === 'branch' ? label : '');
    const anchor = this.actionMenuAnchor(event);
    const preferredPosition = {
      x: anchor?.x ?? event.clientX,
      y: anchor?.y ?? event.clientY,
    };
    this.contextMenu.set({
      kind,
      oid,
      oids,
      label,
      x: Math.max(VIEWPORT_MENU_GUTTER, Math.min(
        preferredPosition.x,
        window.innerWidth - GRAPH_ACTION_MENU_WIDTH - VIEWPORT_MENU_GUTTER,
      )),
      y: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferredPosition.y, window.innerHeight - 440)),
    });
    this.settleGraphActionMenuPosition('context', `${kind}:${oid}`, preferredPosition, focusMenu);
  }

  private actionMenuAnchor(event: MouseEvent): { x: number; y: number } | null {
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)
      || !trigger.matches('.commit-row-action, .inspector-overflow-action, .branch-overflow-action, .remote-branch-overflow-action, .reference-overflow-action')) return null;
    const bounds = trigger.getBoundingClientRect();
    return { x: bounds.right - GRAPH_ACTION_MENU_WIDTH, y: bounds.bottom + 4 };
  }

  private fileMenuReturnTarget(event: Event): HTMLElement | null {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
      : null;
    if (target) return target;
    const current = event.currentTarget;
    if (!(current instanceof HTMLElement)) return null;
    if (current.tabIndex >= 0) return current;
    return current.querySelector<HTMLElement>('.file-name-button, .commit-file');
  }

  private sidebarMenuReturnTarget(event: Event, fallbackSelector: string): HTMLElement | null {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')
      : null;
    if (target) return target;
    return event.currentTarget instanceof HTMLElement
      ? event.currentTarget.querySelector<HTMLElement>(fallbackSelector)
      : null;
  }

  private focusSidebarActionMenu(event: MouseEvent): void {
    const bounds = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    const preferred = event.type === 'contextmenu' || !bounds
      ? { x: event.clientX, y: event.clientY }
      : { x: bounds.right - 218, y: bounds.bottom + 4 };
    this.sidebarActionMenuPosition.set(preferred);
    const key = this.worktreeMenuPath() ?? this.submoduleMenuPath();
    queueMicrotask(() => requestAnimationFrame(() => {
      const element = this.sidebarActionMenuElement()?.nativeElement;
      if (!element || key !== (this.worktreeMenuPath() ?? this.submoduleMenuPath())) return;
      this.sidebarActionMenuPosition.set(this.fittedMenuPosition(element, preferred));
      element.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    }));
  }

  private fittedMenuPosition(element: HTMLElement, preferred: { x: number; y: number }): { x: number; y: number } {
    return {
      x: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferred.x, window.innerWidth - element.offsetWidth - VIEWPORT_MENU_GUTTER)),
      y: Math.max(VIEWPORT_MENU_GUTTER, Math.min(preferred.y, window.innerHeight - element.offsetHeight - VIEWPORT_MENU_GUTTER)),
    };
  }

  // Pointer presses also reach disabled controls and do not require a completed click.
  private readonly dismissOutsideActionMenus = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!this.actionMenuElement()?.nativeElement.contains(target)) this.dismissGraphActionMenu();
    if (!this.fileActionMenuElement()?.nativeElement.contains(target)) this.dismissFileActionMenu();
    if (!this.sidebarContextMenuElement()?.nativeElement.contains(target)) this.dismissSidebarContextMenu();
    if (!this.repositoryTabMenuElement()?.nativeElement.contains(target)) this.dismissRepositoryTabMenu();
    const sidebarToggle = target instanceof Element && target.closest('.worktree-list-actions, .submodule-actions');
    if (!sidebarToggle && !this.sidebarActionMenuElement()?.nativeElement.contains(target)) this.dismissSidebarActionMenu();
    if (!this.branchDropMenuElement()?.nativeElement.contains(target)) this.dismissBranchDropMenu();
    if (!this.graphSettingsToggle()?.nativeElement.contains(target) && !this.graphSettingsPanel()?.nativeElement.contains(target)) {
      this.graphSettingsOpen.set(false);
      this.graphSettingsPosition.set(null);
    }
  };

  private prepareActionMenu(kind: 'graph' | 'file' | 'sidebar' | 'sidebar-context' | 'repository' | 'settings' | 'stack'): void {
    if (kind !== 'graph') this.dismissGraphActionMenu();
    if (kind !== 'file') this.dismissFileActionMenu();
    if (kind !== 'sidebar') this.dismissSidebarActionMenu();
    if (kind !== 'sidebar-context') this.dismissSidebarContextMenu();
    if (kind !== 'repository') this.dismissRepositoryTabMenu();
    if (kind !== 'settings') {
      this.graphSettingsOpen.set(false);
      this.graphSettingsPosition.set(null);
    }
    this.appMenuOpen.set(false);
    this.workspaceMenuOpen.set(false);
    this.repositoryTabsOpen.set(false);
    this.toolbarRemoteMenuOpen.set(false);
    this.closeToolbarCheckoutMenu();
    this.closeToolbarMenus();
    this.dismissBranchDropMenu();
  }

  private settleSidebarContextMenuPosition(
    target: 'reference' | 'remote',
    key: string,
    preferred: { x: number; y: number },
  ): void {
    const isCurrent = () => {
      const reference = this.referencePaneMenu();
      const remote = this.remoteGroupMenu();
      const activeKey = target === 'reference' ? reference && 'reference' : remote?.remote;
      return activeKey === key;
    };
    queueMicrotask(() => requestAnimationFrame(() => this.runWhenElementRendered(
      () => isCurrent() ? this.sidebarContextMenuElement()?.nativeElement : undefined,
      (element) => {
        const reference = this.referencePaneMenu();
        const remote = this.remoteGroupMenu();
        if (!isCurrent()) return;

        const x = Math.max(
          VIEWPORT_MENU_GUTTER,
          Math.min(preferred.x, window.innerWidth - element.offsetWidth - VIEWPORT_MENU_GUTTER),
        );
        const y = Math.max(
          VIEWPORT_MENU_GUTTER,
          Math.min(preferred.y, window.innerHeight - element.offsetHeight - VIEWPORT_MENU_GUTTER),
        );
        if (target === 'reference' && reference && (reference.x !== x || reference.y !== y)) {
          this.referencePaneMenu.set({ ...reference, x, y });
        } else if (target === 'remote' && remote && (remote.x !== x || remote.y !== y)) {
          this.remoteGroupMenu.set({ ...remote, x, y });
        }
        element.querySelector<HTMLElement>(
          '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])',
        )?.focus();
      },
      30,
      isCurrent,
    )));
  }

  private settleFileActionMenuPosition(
    target: 'working' | 'commit',
    key: string,
    preferred: { x: number; y: number },
    focusMenu: boolean,
  ): void {
    const isCurrent = () => {
      const working = this.fileContextMenu();
      const commit = this.commitFileContextMenu();
      const activeKey = target === 'working'
        ? working && `${working.path}:${working.staged}`
        : commit && `${commit.source}:${commit.oid}:${commit.file.path}`;
      return activeKey === key;
    };
    queueMicrotask(() => requestAnimationFrame(() => this.runWhenElementRendered(
      () => isCurrent() ? this.fileActionMenuElement()?.nativeElement : undefined,
      (element) => {
        const working = this.fileContextMenu();
        const commit = this.commitFileContextMenu();
        if (!isCurrent()) return;

        const x = Math.max(
          VIEWPORT_MENU_GUTTER,
          Math.min(preferred.x, window.innerWidth - element.offsetWidth - VIEWPORT_MENU_GUTTER),
        );
        const y = Math.max(
          VIEWPORT_MENU_GUTTER,
          Math.min(preferred.y, window.innerHeight - element.offsetHeight - VIEWPORT_MENU_GUTTER),
        );
        if (target === 'working' && working && (working.x !== x || working.y !== y)) {
          this.fileContextMenu.set({ ...working, x, y });
        } else if (target === 'commit' && commit && (commit.x !== x || commit.y !== y)) {
          this.commitFileContextMenu.set({ ...commit, x, y });
        }
        if (focusMenu) {
          element.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
        }
      },
      30,
      isCurrent,
    )));
  }

  private settleGraphActionMenuPosition(
    target: 'context' | 'stash',
    key: string,
    preferred: { x: number; y: number },
    focusMenu: boolean,
  ): void {
    queueMicrotask(() => requestAnimationFrame(() => {
      const element = this.actionMenuElement()?.nativeElement;
      const context = this.contextMenu();
      const stash = this.stashContextMenu();
      const activeKey = target === 'context'
        ? context && `${context.kind}:${context.oid}`
        : stash && stash.stash.reference;
      if (!element || activeKey !== key) return;

      const menuWidth = element.offsetWidth;
      const borderHeight = element.offsetHeight - element.clientHeight;
      const naturalMenuHeight = element.scrollHeight + borderHeight;
      const statusbarHeight = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--statusbar-height'),
      ) || 0;
      const bottomBoundary = window.innerHeight - statusbarHeight - VIEWPORT_MENU_GUTTER;
      const menuHeight = Math.min(
        naturalMenuHeight,
        bottomBoundary - VIEWPORT_MENU_GUTTER,
      );
      const x = Math.max(
        VIEWPORT_MENU_GUTTER,
        Math.min(preferred.x, window.innerWidth - menuWidth - VIEWPORT_MENU_GUTTER),
      );
      const y = Math.max(
        VIEWPORT_MENU_GUTTER,
        Math.min(preferred.y, bottomBoundary - menuHeight),
      );
      if (target === 'context' && context && (context.x !== x || context.y !== y)) {
        this.contextMenu.set({ ...context, x, y });
      } else if (target === 'stash' && stash && (stash.x !== x || stash.y !== y)) {
        this.stashContextMenu.set({ ...stash, x, y });
      }
      element.classList.add('positioned');
      if (focusMenu) {
        element.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
      }
    }));
  }

  private settleBranchDropMenuPosition(
    source: string,
    target: string,
    preferred: { x: number; y: number },
  ): void {
    const isCurrent = () => {
      const operation = this.branchDropMenu();
      return operation?.source === source && operation.target === target;
    };
    queueMicrotask(() => requestAnimationFrame(() => this.runWhenElementRendered(
      () => isCurrent() ? this.branchDropMenuElement()?.nativeElement : undefined,
      (element) => {
        const operation = this.branchDropMenu();
        if (!isCurrent() || !operation) return;

        const x = Math.max(
          VIEWPORT_MENU_GUTTER,
          Math.min(preferred.x, window.innerWidth - element.offsetWidth - VIEWPORT_MENU_GUTTER),
        );
        const y = Math.max(
          VIEWPORT_MENU_GUTTER,
          Math.min(preferred.y, window.innerHeight - element.offsetHeight - VIEWPORT_MENU_GUTTER),
        );
        if (operation.x !== x || operation.y !== y) {
          this.branchDropMenu.set({ ...operation, x, y });
        }
        element.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
      },
      30,
      isCurrent,
    )));
  }

  private dismissGraphActionMenu(restoreFocus = false): void {
    const target = restoreFocus ? this.contextMenuReturnFocus : null;
    const menu = this.actionMenuElement()?.nativeElement ?? null;
    this.contextMenuGeneration += 1;
    this.contextMenu.set(null);
    this.contextBranchCreatorOpen.set(false);
    this.stashContextMenu.set(null);
    this.contextBranchError.set(null);
    this.contextMenuReturnFocus = null;
    if (target) queueMicrotask(() => {
      if (target.isConnected && this.canRestoreFocusFrom(menu)) target.focus({ preventScroll: true });
    });
  }

  private dismissFileActionMenu(restoreFocus = false): void {
    const target = restoreFocus ? this.fileContextMenuReturnFocus : null;
    this.fileContextMenu.set(null);
    this.commitFileContextMenu.set(null);
    this.fileContextMenuReturnFocus = null;
    if (target) queueMicrotask(() => target.focus({ preventScroll: true }));
  }

  private dismissSidebarActionMenu(restoreFocus = false): void {
    const target = restoreFocus ? this.sidebarActionMenuReturnFocus : null;
    this.worktreeMenuPath.set(null);
    this.submoduleMenuPath.set(null);
    this.sidebarActionMenuReturnFocus = null;
    if (target) queueMicrotask(() => target.focus({ preventScroll: true }));
  }

  private dismissSidebarContextMenu(restoreFocus = false): void {
    const target = restoreFocus ? this.sidebarContextMenuReturnFocus : null;
    this.referencePaneMenu.set(null);
    this.remoteGroupMenu.set(null);
    this.sidebarContextMenuReturnFocus = null;
    if (target) queueMicrotask(() => target.focus({ preventScroll: true }));
  }

  protected dismissBranchDropMenu(restoreFocus = false): void {
    const target = restoreFocus ? this.branchDropMenuReturnFocus : null;
    this.branchDropMenu.set(null);
    this.branchDropTarget.set(null);
    this.branchDropMenuReturnFocus = null;
    if (target) queueMicrotask(() => target.focus({ preventScroll: true }));
  }

  protected openTagMenu(event: MouseEvent, name: string, oid: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeTagPreview();
    this.openContextMenu('tag', oid, name, event, [oid], true);
  }

  protected openRemoteMenu(event: MouseEvent, name: string, oid: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.openContextMenu('remote', oid, name, event, [oid], true);
  }

  private async copyText(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Clipboard access can be unavailable in browser-only previews.
      return false;
    }
  }

  private readWidth(panel: ResizablePanel): number {
    const fallback = PANEL_WIDTH_LIMITS[panel].default;
    try {
      const value = Number(localStorage.getItem(`git-khronos.panel.${panel}.width`));
      return Number.isFinite(value) && value > 0 ? this.clampPanelWidth(panel, value) : fallback;
    } catch {
      return fallback;
    }
  }

  private hasStoredPanelWidth(panel: ResizablePanel): boolean {
    try {
      const width = Number(localStorage.getItem(`git-khronos.panel.${panel}.width`));
      return Number.isFinite(width) && width > 0;
    } catch {
      return false;
    }
  }

  private clampPanelWidth(panel: ResizablePanel, width: number): number {
    const { minimum, maximum } = PANEL_WIDTH_LIMITS[panel];
    return Math.max(minimum, Math.min(maximum, width));
  }

  protected panelWidth(panel: ResizablePanel): number {
    return this.renderedPanelWidths()[panel];
  }

  protected panelMaximumWidth(panel: ResizablePanel): number {
    const other = panel === 'sidebar' ? 'details' : 'sidebar';
    return Math.max(PANEL_WIDTH_LIMITS[panel].minimum,
      Math.min(PANEL_WIDTH_LIMITS[panel].maximum, this.viewportWidth() - 420 - this.panelWidth(other)));
  }

  private readReferenceSectionHeight(section: ReferenceSection): number | null {
    try {
      const value = Number(localStorage.getItem(`git-khronos.sidebar.section.${section}.height`));
      return Number.isFinite(value) && value >= REFERENCE_SECTION_MIN_HEIGHT
        ? Math.min(value, REFERENCE_SECTION_MAX_HEIGHT)
        : null;
    } catch {
      return null;
    }
  }

  private storeReferenceSectionHeight(section: ReferenceSection, height: number): void {
    try {
      localStorage.setItem(`git-khronos.sidebar.section.${section}.height`, String(Math.round(height)));
    } catch {
      // Section resizing remains active for this session.
    }
  }

  private workingTreeFileListHeightSignal(section: WorkingTreeFileListSection) {
    return this.workingTreeFileListHeights[section];
  }

  private readWorkingTreeFileListHeight(section: WorkingTreeFileListSection): number {
    try {
      const value = Number(localStorage.getItem(`git-khronos.working-tree.${section}-file-list-height`));
      return Number.isFinite(value) && value >= WORKING_TREE_FILE_LIST_MIN_HEIGHT
        ? Math.min(value, WORKING_TREE_FILE_LIST_MAX_HEIGHT)
        : WORKING_TREE_FILE_LIST_DEFAULT_HEIGHT;
    } catch {
      return WORKING_TREE_FILE_LIST_DEFAULT_HEIGHT;
    }
  }

  private storeWorkingTreeFileListHeight(section: WorkingTreeFileListSection, height: number): void {
    try {
      localStorage.setItem(`git-khronos.working-tree.${section}-file-list-height`, String(Math.round(height)));
    } catch {
      // Resizing remains active for this session.
    }
  }

  private storeWidth(panel: ResizablePanel, width: number): void {
    try {
      localStorage.setItem(`git-khronos.panel.${panel}.width`, String(width));
    } catch {
      // Resizing remains usable when WebView storage is unavailable.
    }
  }

  private readZoom(): number {
    try {
      const stored = localStorage.getItem('git-khronos.ui.zoom');
      return stored === null ? DEFAULT_ZOOM : normalizeZoom(stored);
    } catch {
      return DEFAULT_ZOOM;
    }
  }

  private readAppTheme(): AppTheme {
    try {
      return normalizeAppTheme(localStorage.getItem('git-khronos.ui.theme'));
    } catch {
      return 'chronos';
    }
  }

  protected setAppTheme(value: unknown): void {
    const theme = normalizeAppTheme(value);
    this.appTheme.set(theme);
    this.applyAppTheme(theme);
    try {
      localStorage.setItem('git-khronos.ui.theme', theme);
    } catch {
      // The selected theme remains active for this session.
    }
  }

  protected toggleAppTheme(): void {
    this.setAppTheme(this.appTheme() === 'chronos' ? 'midnight' : 'chronos');
  }

  protected handleAppThemeKeydown(event: KeyboardEvent, theme: AppTheme): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = appThemeNavigationValue(theme, event.key as AppThemeNavigationKey);
    this.setAppTheme(next);
    queueMicrotask(() => (event.currentTarget as HTMLElement)
      .closest('[role="radiogroup"]')
      ?.querySelector<HTMLElement>(`[data-app-theme="${next}"]`)
      ?.focus());
  }

  private applyAppTheme(theme: AppTheme): void {
    if (typeof document !== 'undefined') document.documentElement.dataset['theme'] = theme;
  }

  private readWorkingTreeViewMode(): WorkingTreeViewMode {
    try {
      return localStorage.getItem('git-khronos.ui.working-tree-view') === 'tree' ? 'tree' : 'path';
    } catch {
      return 'path';
    }
  }

  private readPullStrategy(): PullStrategy {
    try {
      const value = localStorage.getItem('git-khronos.pull.strategy');
      return value === 'ff-only' || value === 'rebase' ? value : 'merge';
    } catch {
      return 'merge';
    }
  }

  private readUiPreference(preference: string, fallback: boolean): boolean {
    try {
      const value = localStorage.getItem(`git-khronos.ui.${preference}`);
      return value === null ? fallback : value === 'true';
    } catch {
      return fallback;
    }
  }

  private readRecentCommandIds(): string[] {
    try {
      const value = JSON.parse(localStorage.getItem('git-khronos.ui.recent-commands') ?? '[]');
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string').slice(0, COMMAND_QUICK_ACTION_LIMIT)
        : [];
    } catch {
      return [];
    }
  }

  private rememberCommand(id: string): void {
    const ids = [id, ...this.recentCommandIds().filter((candidate) => candidate !== id)]
      .slice(0, COMMAND_QUICK_ACTION_LIMIT);
    this.recentCommandIds.set(ids);
    try {
      localStorage.setItem('git-khronos.ui.recent-commands', JSON.stringify(ids));
    } catch {
      // The palette remains fully functional when preference storage is unavailable.
    }
  }

  private readGraphDateFormat(): GraphDateFormat {
    try {
      const value = localStorage.getItem('git-khronos.ui.graph-date-format');
      return value === 'relative' || value === 'iso' ? value : 'compact';
    } catch {
      return 'compact';
    }
  }

  private readAuthorMarkerStyle(): AuthorMarkerStyle {
    try {
      return localStorage.getItem('git-khronos.ui.author-marker-style') === 'color' ? 'color' : 'initials';
    } catch {
      return 'initials';
    }
  }

  private readAutoFetchInterval(): AutoFetchIntervalMinutes {
    try {
      const stored = localStorage.getItem('git-khronos.remote.auto-fetch-minutes');
      if (stored === null) return 5;
      const value = Number(stored) as AutoFetchIntervalMinutes;
      return AUTO_FETCH_INTERVALS.includes(value) ? value : 5;
    } catch {
      return 5;
    }
  }

  private async runAutoFetchCycle(force: boolean): Promise<void> {
    this.cancelAutoFetchTimer();
    const repositoryId = this.git.activeRepositoryId();
    const interval = this.autoFetchIntervalMinutes();
    if (!repositoryId || this.git.incomingRepositoryLinksPending() || this.git.repositoryLinkPolicies()[repositoryId]?.autoFetchPaused || this.git.browserPreview() || (interval === 0 && !force)) return;
    const intervalMs = (interval || 5) * 60_000;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.git.busy() || this.git.backgroundFetchBusy()) {
      this.scheduleAutoFetch(Math.min(intervalMs, 30_000));
      return;
    }
    const lastFetch = this.git.backgroundFetchLastAt()[repositoryId] ?? 0;
    const remaining = intervalMs - (Date.now() - lastFetch);
    if (!force && !lastFetch) {
      this.scheduleAutoFetch(intervalMs);
      return;
    }
    if (!force && lastFetch && remaining > 0) {
      this.scheduleAutoFetch(remaining);
      return;
    }
    await this.git.fetchInBackground(repositoryId);
    if (interval > 0) this.scheduleAutoFetch(intervalMs);
  }

  private scheduleAutoFetch(delayMs: number): void {
    if (typeof window === 'undefined') return;
    this.autoFetchTimer = window.setTimeout(
      () => void this.runAutoFetchCycle(true),
      Math.max(1_000, delayMs),
    );
  }

  private cancelAutoFetchTimer(): void {
    if (this.autoFetchTimer === null) return;
    clearTimeout(this.autoFetchTimer);
    this.autoFetchTimer = null;
  }

  private scheduleRepositoryRefresh(repositoryId: string): void {
    if (this.git.backgroundFetchRepositoryId() === repositoryId) return;
    const current = this.repositoryRefreshTimers.get(repositoryId);
    if (current) clearTimeout(current);
    const timer = window.setTimeout(() => {
      this.repositoryRefreshTimers.delete(repositoryId);
      if (this.git.backgroundFetchRepositoryId() === repositoryId) return;
      void this.git.refreshRepositoryInBackground(repositoryId);
    }, 450);
    this.repositoryRefreshTimers.set(repositoryId, timer);
  }

  private scheduleLiveStatusRefresh(delayMs = LIVE_STATUS_REFRESH_MS): void {
    this.cancelLiveStatusRefresh();
    if (typeof window === 'undefined' || this.git.browserPreview() || !this.git.activeRepositoryId()) return;
    this.liveStatusTimer = window.setTimeout(() => void this.runLiveStatusRefresh(), delayMs);
  }

  private async runLiveStatusRefresh(): Promise<void> {
    this.liveStatusTimer = null;
    if (typeof document !== 'undefined' && document.hidden) return;
    await this.git.refreshStatusInBackground();
    this.scheduleLiveStatusRefresh();
  }

  private cancelLiveStatusRefresh(): void {
    if (this.liveStatusTimer === null) return;
    clearTimeout(this.liveStatusTimer);
    this.liveStatusTimer = null;
  }

  private readTerminalFontFamily(): string {
    try {
      return localStorage.getItem('git-khronos.terminal.font-family')
        ?? '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
    } catch {
      return '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
    }
  }

  private readDiffNumber(preference: string, fallback: number, allowed: number[]): number {
    try {
      const value = Number(localStorage.getItem(`git-khronos.diff.${preference}`));
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  private readDiffBoolean(preference: string, fallback: boolean): boolean {
    try {
      const value = localStorage.getItem(`git-khronos.diff.${preference}`);
      return value === null ? fallback : value === 'true';
    } catch {
      return fallback;
    }
  }

  private readDiffViewMode(): DiffViewMode {
    try {
      const value = localStorage.getItem('git-khronos.diff.view-mode');
      return value === 'inline' || value === 'split' ? value : 'hunk';
    } catch {
      return 'hunk';
    }
  }

  private readTerminalNumber(preference: string, fallback: number, allowed: number[]): number {
    try {
      const value = Number(localStorage.getItem(`git-khronos.terminal.${preference}`));
      return allowed.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  private readTerminalCursorStyle(): TerminalCursorStyle {
    try {
      const value = localStorage.getItem('git-khronos.terminal.cursor-style');
      return value === 'underline' || value === 'bar' ? value : 'block';
    } catch {
      return 'block';
    }
  }

  private closeToolbarMenus(restoreFocus = false): void {
    this.fetchMenuOpen.set(false);
    this.pullMenuOpen.set(false);
    this.pushMenuOpen.set(false);
    this.branchMenuOpen.set(false);
    this.stashMenuOpen.set(false);
    this.lfsMenuOpen.set(false);
    this.sparseCheckoutMenuOpen.set(false);
    this.moreActionsMenuOpen.set(false);
    const returnFocus = this.toolbarMenuReturnFocus;
    this.toolbarMenuReturnFocus = null;
    if (restoreFocus) queueMicrotask(() => returnFocus?.focus());
  }

  private storeColumnWidth(column: GraphColumn, width: number): void {
    try {
      const key = column === 'graph'
        ? this.graphColumnWidthPreferenceKey(this.compactGraphColumn())
        : this.graphPreferenceKey(`column.${column}.width`);
      localStorage.setItem(key, String(width));
    } catch {
      // Column resizing remains available when WebView storage is unavailable.
    }
  }

  private graphColumnWidthLimits(column: GraphColumn): [number, number] {
    return {
      branch: [75, 800],
      graph: [42, Math.max(800, this.graphMaximumWidth())],
      message: [180, Math.max(GRAPH_MESSAGE_COLUMN_MAX, this.messageColumnWidth())],
      author: [70, 800],
      date: [this.dateColumnContentWidth(), 800],
      sha: [54, 800],
    }[column] as [number, number];
  }

  private columnWidthSignal(column: GraphColumn) {
    return {
      branch: this.branchColumnWidth,
      graph: this.graphColumnWidth,
      message: this.messageColumnWidth,
      author: this.authorColumnWidth,
      date: this.dateColumnWidth,
      sha: this.shaColumnWidth,
    }[column];
  }

  private isGraphColumnVisible(column: GraphColumn): boolean {
    return this.columnVisibilitySignal(column)();
  }

  private defaultGraphColumnVisible(column: GraphColumn): boolean {
    if (!isDefaultGraphColumnVisible(column)) return false;
    if (column !== 'author' && column !== 'date') return true;
    const viewportWidth = this.graphViewportWidth();
    if (viewportWidth > 0) return viewportWidth >= GRAPH_METADATA_MIN_VIEWPORT_WIDTH;
    return typeof window === 'undefined' || window.innerWidth >= WIDE_GRAPH_METADATA_BREAKPOINT;
  }

  private syncDefaultGraphMetadataColumns(): void {
    if (!this.git.repository()) return;
    for (const column of ['author', 'date'] as const) {
      let customized = false;
      try {
        customized = localStorage.getItem(this.graphPreferenceKey(`column.${column}.visible`)) !== null;
      } catch {
        // Keep the in-memory adaptive default when WebView storage is unavailable.
      }
      if (!customized) this.columnVisibilitySignal(column).set(this.defaultGraphColumnVisible(column));
    }
  }

  private columnVisibilitySignal(column: GraphColumn) {
    return {
      branch: this.showBranchColumn,
      graph: this.showGraphColumn,
      message: this.showMessageColumn,
      author: this.showAuthorColumn,
      date: this.showDateColumn,
      sha: this.showShaColumn,
    }[column];
  }

  private loadGraphPreferences(): void {
    if (!this.git.repository()) return;
    this.authorFilter.set(null);
    this.loadReferenceFilters();
    this.loadPinnedBranch();
    this.loadHiddenStashes();
    this.loadRemoteIcons();
    this.loadCollapsedRemoteLocations();
    try {
      this.selectedRemoteName.set(localStorage.getItem(this.graphPreferenceKey('selected-remote')) ?? '');
      const storedOrder = JSON.parse(localStorage.getItem(this.graphPreferenceKey('column.order')) ?? 'null');
      if (
        Array.isArray(storedOrder) &&
        storedOrder.length === DEFAULT_GRAPH_COLUMNS.length &&
        DEFAULT_GRAPH_COLUMNS.every((column) => storedOrder.includes(column))
      ) {
        this.graphColumnOrder.set(storedOrder as GraphColumn[]);
      } else {
        this.graphColumnOrder.set([...DEFAULT_GRAPH_COLUMNS]);
      }
      for (const column of DEFAULT_GRAPH_COLUMNS) {
        this.columnVisibilitySignal(column).set(
          this.readGraphBoolean(`column.${column}.visible`, this.defaultGraphColumnVisible(column)),
        );
      }
      this.smartBranchVisibility.set(this.readGraphBoolean('smart-branch-visibility', false));
      this.compactGraphColumn.set(this.readGraphBoolean('column.graph.compact', false));
      this.showGraphScrollMarkers.set(this.readGraphBoolean('scroll-markers', true));
      this.branchColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.branch);
      this.graphColumnWidth.set(graphColumnLayout(this.compactGraphColumn()).defaultWidth);
      this.messageColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.message);
      this.messageColumnManuallyResized.set(false);
      this.authorColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.author);
      this.dateColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.date);
      this.shaColumnWidth.set(GRAPH_COLUMN_DEFAULT_WIDTHS.sha);
      for (const column of DEFAULT_GRAPH_COLUMNS) {
        const preferredKey = column === 'graph'
          ? this.graphColumnWidthPreferenceKey(this.compactGraphColumn())
          : this.graphPreferenceKey(`column.${column}.width`);
        const preferred = localStorage.getItem(preferredKey);
        const legacy = column === 'graph' && !this.compactGraphColumn()
          ? localStorage.getItem(this.graphPreferenceKey('column.graph.width'))
          : null;
        const stored = Number(preferred ?? legacy);
        if (Number.isFinite(stored) && stored > 0) {
          this.columnWidthSignal(column).set(
            column === 'graph'
              ? normalizeGraphColumnWidth(
                  stored,
                  this.compactGraphColumn(),
                  Math.max(MAXIMUM_PERSISTED_GRAPH_COLUMN_WIDTH, this.graphMaximumWidth()),
                )
              : stored,
          );
        }
      }
      this.messageColumnManuallyResized.set(
        localStorage.getItem(this.graphPreferenceKey('column.message.width')) !== null,
      );
    } catch {
      this.selectedRemoteName.set('');
      this.graphColumnOrder.set([...DEFAULT_GRAPH_COLUMNS]);
      this.smartBranchVisibility.set(false);
      this.compactGraphColumn.set(false);
      this.showGraphScrollMarkers.set(true);
      this.messageColumnManuallyResized.set(false);
    }
  }

  private loadRemoteIcons(): void {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(this.graphPreferenceKey('remote-icons')) ?? '{}');
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        this.remoteLocationIcons.set({});
        return;
      }
      this.remoteLocationIcons.set(Object.fromEntries(
        Object.entries(stored).filter(
          (entry): entry is [string, RemoteLocationIcon] => isRemoteLocationIcon(entry[1]),
        ),
      ));
    } catch {
      this.remoteLocationIcons.set({});
    }
  }

  private loadCollapsedRemoteLocations(): void {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(this.graphPreferenceKey('remote-collapsed')) ?? '[]');
      const available = new Set(this.remoteBranchGroups().map((group) => group.name));
      this.collapsedRemoteLocations.set(Array.isArray(stored)
        ? stored.filter((name): name is string => typeof name === 'string' && available.has(name))
        : []);
    } catch {
      this.collapsedRemoteLocations.set([]);
    }
  }

  private storeCollapsedRemoteLocations(): void {
    try {
      localStorage.setItem(this.graphPreferenceKey('remote-collapsed'), JSON.stringify(this.collapsedRemoteLocations()));
    } catch {
      // Remote disclosure state remains available for this session.
    }
  }

  private readGraphBoolean(key: string, fallback: boolean): boolean {
    const value = localStorage.getItem(this.graphPreferenceKey(key));
    return value === null ? fallback : value === 'true';
  }

  private storeGraphColumnOrder(): void {
    try {
      localStorage.setItem(this.graphPreferenceKey('column.order'), JSON.stringify(this.graphColumnOrder()));
    } catch {
      // Column ordering remains available for this session.
    }
  }

  private graphPreferenceKey(setting: string): string {
    return `git-khronos.graph.${encodeURIComponent(this.git.repository()?.path ?? 'default')}.${setting}`;
  }

  private graphColumnWidthPreferenceKey(compact: boolean): string {
    return this.graphPreferenceKey(`column.graph.${compact ? 'compact' : 'expanded'}.width`);
  }

  private loadHiddenStashes(): void {
    try {
      const value = JSON.parse(localStorage.getItem(this.graphPreferenceKey('stash.hidden')) ?? '[]');
      const available = new Set(this.git.repository()?.stashes.map((stash) => stash.oid) ?? []);
      this.hiddenStashOids.set(Array.isArray(value)
        ? value.filter((oid): oid is string => typeof oid === 'string' && available.has(oid))
        : []);
    } catch {
      this.hiddenStashOids.set([]);
    }
  }

  private storeHiddenStashes(): void {
    try {
      localStorage.setItem(this.graphPreferenceKey('stash.hidden'), JSON.stringify(this.hiddenStashOids()));
    } catch {
      // Stash visibility remains available for this session.
    }
  }

  private toggleHiddenBranch(name: string): void {
    this.setSmartBranchVisibility(false);
    this.soloBranches.set([]);
    this.hiddenBranches.update((names) => names.includes(name)
      ? names.filter((candidate) => candidate !== name)
      : [...names, name]);
    this.storeReferenceFilters();
  }

  private toggleSoloBranch(name: string): void {
    this.setSmartBranchVisibility(false);
    this.hiddenBranches.set([]);
    this.soloBranches.update((names) => names.includes(name)
      ? names.filter((candidate) => candidate !== name)
      : [...names, name]);
    this.storeReferenceFilters();
  }

  private loadReferenceFilters(): void {
    try {
      const hidden = JSON.parse(localStorage.getItem(this.graphPreferenceKey('references.hidden')) ?? '[]');
      const solo = JSON.parse(localStorage.getItem(this.graphPreferenceKey('references.solo')) ?? '[]');
      this.hiddenBranches.set(Array.isArray(hidden) ? hidden.filter((name): name is string => typeof name === 'string') : []);
      this.soloBranches.set(Array.isArray(solo) ? solo.filter((name): name is string => typeof name === 'string') : []);
    } catch {
      this.hiddenBranches.set([]);
      this.soloBranches.set([]);
    }
  }

  private storeReferenceFilters(): void {
    try {
      localStorage.setItem(this.graphPreferenceKey('references.hidden'), JSON.stringify(this.hiddenBranches()));
      localStorage.setItem(this.graphPreferenceKey('references.solo'), JSON.stringify(this.soloBranches()));
    } catch {
      // Reference filters remain active for this session.
    }
  }

  private loadPinnedBranch(): void {
    try {
      const name = localStorage.getItem(this.graphPreferenceKey('branch.pinned'));
      const exists = this.git.repository()?.branches.some((branch) => !branch.remote && branch.name === name);
      this.pinnedBranch.set(exists ? name : null);
    } catch {
      this.pinnedBranch.set(null);
    }
  }

  private storePinnedBranch(): void {
    try {
      const name = this.pinnedBranch();
      if (name) localStorage.setItem(this.graphPreferenceKey('branch.pinned'), name);
      else localStorage.removeItem(this.graphPreferenceKey('branch.pinned'));
    } catch {
      // The pinned branch remains active for this session.
    }
  }

  private async applyZoom(value: number): Promise<void> {
    const request = ++this.zoomApplication;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      if (request !== this.zoomApplication) return;
      await getCurrentWebview().setZoom(value / 100);
    } catch {
      // Browser-only previews do not expose a Tauri webview.
    }
  }
}

interface WorkingTreeNode {
  directories: Map<string, WorkingTreeNode>;
  files: WorkingTreeEntry[];
}

interface CommitFileNode {
  directories: Map<string, CommitFileNode>;
  files: CommitFile[];
}

function sortWorkingTreeEntries(entries: WorkingTreeEntry[], ascending: boolean): WorkingTreeEntry[] {
  return [...entries].sort((left, right) => {
    const comparison = left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' });
    return ascending ? comparison : -comparison;
  });
}

function buildWorkingTreeRows(
  entries: WorkingTreeEntry[],
  ascending: boolean,
  collapsedDirectories: Set<string>,
): WorkingTreeDisplayRow[] {
  const root: WorkingTreeNode = { directories: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let node = root;
    for (const directory of parts.slice(0, -1)) {
      let child = node.directories.get(directory);
      if (!child) {
        child = { directories: new Map(), files: [] };
        node.directories.set(directory, child);
      }
      node = child;
    }
    node.files.push(entry);
  }

  const compare = (left: string, right: string) => {
    const comparison = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    return ascending ? comparison : -comparison;
  };
  const rows: WorkingTreeDisplayRow[] = [];
  const append = (node: WorkingTreeNode, parentPath: string, depth: number) => {
    for (const [name, child] of [...node.directories].sort(([left], [right]) => compare(left, right))) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      rows.push({ kind: 'directory', key: `directory:${path}`, label: name, path, depth, entry: null });
      if (!collapsedDirectories.has(path)) append(child, path, depth + 1);
    }
    for (const entry of [...node.files].sort((left, right) => compare(left.path, right.path))) {
      rows.push({
        kind: 'file',
        key: `file:${entry.path}`,
        label: entry.path.split('/').at(-1) ?? entry.path,
        path: entry.path,
        depth,
        entry,
      });
    }
  };
  append(root, '', 0);
  return rows;
}

function sortCommitFiles(files: CommitFile[], ascending: boolean): CommitFile[] {
  return [...files].sort((left, right) => {
    const comparison = left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' });
    return ascending ? comparison : -comparison;
  });
}

function buildCommitFileRows(
  files: CommitFile[],
  ascending: boolean,
  collapsedDirectories: Set<string>,
): CommitFileDisplayRow[] {
  const root: CommitFileNode = { directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let node = root;
    for (const directory of parts.slice(0, -1)) {
      let child = node.directories.get(directory);
      if (!child) {
        child = { directories: new Map(), files: [] };
        node.directories.set(directory, child);
      }
      node = child;
    }
    node.files.push(file);
  }

  const compare = (left: string, right: string) => {
    const comparison = left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    return ascending ? comparison : -comparison;
  };
  const rows: CommitFileDisplayRow[] = [];
  const append = (node: CommitFileNode, parentPath: string, depth: number) => {
    for (const [name, child] of [...node.directories].sort(([left], [right]) => compare(left, right))) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      rows.push({ kind: 'directory', key: `directory:${path}`, label: name, path, depth, file: null });
      if (!collapsedDirectories.has(path)) append(child, path, depth + 1);
    }
    for (const file of [...node.files].sort((left, right) => compare(left.path, right.path))) {
      rows.push({
        kind: 'file',
        key: `file:${file.path}`,
        label: file.path.split('/').at(-1) ?? file.path,
        path: file.path,
        depth,
        file,
      });
    }
  };
  append(root, '', 0);
  return rows;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

// Creating Intl formatters is far slower than using them, and history can hold many thousands of commits.
let commitDateFormatters: {
  title: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  relative: Intl.RelativeTimeFormat;
} | null = null;

function formatCommitDate(value: string, format: GraphDateFormat, now = Date.now()): CommitDateDisplay {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { primary: '—', secondary: '', title: value };
  const formatters = commitDateFormatters ??= {
    title: new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long', hourCycle: 'h23' }),
    date: new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    relative: new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' }),
  };
  const title = formatters.title.format(date);
  if (format === 'iso') {
    const iso = date.toISOString();
    return { primary: iso.slice(0, 10), secondary: `${iso.slice(11, 16)} Z`, title };
  }
  const compactDate = formatters.date.format(date);
  const compactTime = formatters.time.format(date);
  if (format === 'compact') return { primary: compactDate, secondary: compactTime, title };

  const seconds = (date.getTime() - now) / 1_000;
  const absolute = Math.abs(seconds);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = absolute < 60
    ? [0, 'second']
    : absolute < 3_600
      ? [Math.round(seconds / 60), 'minute']
      : absolute < 86_400
        ? [Math.round(seconds / 3_600), 'hour']
        : absolute < 604_800
          ? [Math.round(seconds / 86_400), 'day']
          : absolute < 2_592_000
            ? [Math.round(seconds / 604_800), 'week']
            : absolute < 31_536_000
              ? [Math.round(seconds / 2_592_000), 'month']
              : [Math.round(seconds / 31_536_000), 'year'];
  return {
    primary: formatters.relative.format(amount, unit),
    secondary: compactDate,
    title,
  };
}

function shortLabel(oid: string): string {
  return oid.slice(0, 8);
}

function isRemoteLocationIcon(value: unknown): value is RemoteLocationIcon {
  return REMOTE_LOCATION_ICONS.some((option) => option.value === value);
}

function wordDiffSegments(left: string, right: string): [DiffTextSegment[], DiffTextSegment[]] {
  const leftMarker = left.slice(0, 1);
  const rightMarker = right.slice(0, 1);
  const leftWords = splitDiffWords(left.slice(1));
  const rightWords = splitDiffWords(right.slice(1));
  if (leftWords.length * rightWords.length > 16_000) {
    return [
      [{ text: leftMarker, changed: false }, { text: left.slice(1), changed: true }],
      [{ text: rightMarker, changed: false }, { text: right.slice(1), changed: true }],
    ];
  }
  const table = Array.from({ length: leftWords.length + 1 }, () => new Uint16Array(rightWords.length + 1));
  for (let leftIndex = leftWords.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightWords.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] = leftWords[leftIndex] === rightWords[rightIndex]
        ? table[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }
  const leftSegments: DiffTextSegment[] = [{ text: leftMarker, changed: false }];
  const rightSegments: DiffTextSegment[] = [{ text: rightMarker, changed: false }];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftWords.length || rightIndex < rightWords.length) {
    if (leftWords[leftIndex] === rightWords[rightIndex]) {
      appendDiffSegment(leftSegments, leftWords[leftIndex], false);
      appendDiffSegment(rightSegments, rightWords[rightIndex], false);
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex >= rightWords.length || (leftIndex < leftWords.length && table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1])) {
      appendDiffSegment(leftSegments, leftWords[leftIndex++], true);
    } else {
      appendDiffSegment(rightSegments, rightWords[rightIndex++], true);
    }
  }
  return [leftSegments, rightSegments];
}

function splitDiffWords(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_$]+|./gu) ?? [];
}

function appendDiffSegment(segments: DiffTextSegment[], text: string | undefined, changed: boolean): void {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.changed === changed) previous.text += text;
  else segments.push({ text, changed });
}

function commitMessageBody(message: string): string {
  const newline = message.indexOf('\n');
  return newline < 0 ? '' : message.slice(newline + 1);
}

function parseCoAuthors(body: string): { body: string; authors: CoAuthor[] } {
  const authors: CoAuthor[] = [];
  const content: string[] = [];
  const seen = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*Co-authored-by:\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/i);
    if (!match) {
      content.push(line);
      continue;
    }
    const email = match[2].trim();
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    authors.push({ name: match[1].trim(), email });
  }
  return { body: content.join('\n').trim(), authors };
}

function summarizeFileChanges(files: CommitFile[]): FileChangeStats {
  return files.reduce<FileChangeStats>((total, file) => {
    if (file.additions === null || file.deletions === null) total.binaryFiles += 1;
    else {
      total.additions += file.additions;
      total.deletions += file.deletions;
    }
    return total;
  }, { additions: 0, deletions: 0, binaryFiles: 0 });
}

export type GraphRowView = ReturnType<AppComponent['graphRowView']>;
export type PreferencesDialogView = ReturnType<AppComponent['preferencesDialogView']>;
