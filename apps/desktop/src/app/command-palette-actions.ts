import type { CommandAction, CommandPaletteActionSources, CommandPaletteScope } from './app.component';
import type { IconName } from './icon.component';
import { DEFAULT_ZOOM, ZOOM_LEVELS } from './ui-zoom';
import { COMMAND_QUICK_ACTION_LIMIT, matchesCommandQuery } from './command-query';

const COMMAND_DYNAMIC_RESULT_LIMIT = 80;
const COMMAND_QUICK_ACTION_IDS: readonly string[] = ['fetch', 'pull', 'push', 'refresh', 'terminal', 'search', 'open', 'clone', 'preferences', 'shortcuts'];
const COMMAND_GROUP_ORDER: readonly string[] = ['Quick Actions', 'Workspace', 'Repository', 'Git Features', 'Edit', 'Remote', 'Branch', 'Working Tree', 'History', 'View'];

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

export function buildCommandActions(source: CommandPaletteActionSources, search: string, scope: CommandPaletteScope): CommandAction[] {
  const repository = source.git.repository();
  const busy = source.git.busy();
  const bisectTarget = source.bisectVoteTarget();
  const bisectOid = bisectTarget ? bisectTarget.candidate.oid.slice(0, 7) : 'unavailable';
  const actions: CommandAction[] = [
    ...source.git.workspaces().map((workspace, index): CommandAction => {
      const current = workspace.id === source.git.activeWorkspaceId();
      const count = source.git.workspaceRepositoryCount(workspace);
      return {
        id: `workspace:${workspace.id}`,
        group: 'Workspace',
        label: `Switch to ${workspace.name}`,
        detail: `${current ? 'Current workspace · ' : ''}${count} ${count === 1 ? 'repository' : 'repositories'}`,
        shortcut: index < 9 ? `${source.primaryShortcutKey} Shift ${index + 1}` : undefined,
        enabled: !current && !busy,
        icon: 'repo',
      };
    }),
    { id: 'hosting-center', group: 'Workspace', label: 'Reviews and checks', detail: 'Inspect GitHub pull requests, issues and workflow runs', enabled: !!repository && !busy, icon: 'repo' },
    { id: 'workspace-overview', group: 'Workspace', label: 'Repository overview', detail: 'Inspect local changes and tracking state across open repositories', enabled: !busy, icon: 'repo' },
    { id: 'identity-profiles', group: 'Workspace', label: 'Identity profiles', detail: 'Save and explicitly apply repository commit identities', enabled: !busy, icon: 'edit' },
    { id: 'workspace-create', group: 'Workspace', label: 'New Workspace', detail: 'Create a separate set of repository tabs', enabled: !busy, icon: 'plus' },
    { id: 'workspace-rename', group: 'Workspace', label: 'Rename Current Workspace', detail: `Rename ${source.git.activeWorkspace().name}`, enabled: !busy, icon: 'edit' },
    { id: 'workspace-delete', group: 'Workspace', label: 'Delete Current Workspace', detail: 'Remove this saved tab layout without deleting repositories', enabled: source.git.workspaces().length > 1 && !busy, icon: 'trash' },
    { id: 'new-tab', group: 'Repository', label: 'New Tab', detail: 'Open repository management', shortcut: `${source.primaryShortcutKey} T`, enabled: !busy, icon: 'plus' },
    { id: 'incoming-links', group: 'Repository', label: 'Incoming repository links', detail: 'Review queued external requests without replacing other dialogs', enabled: !busy && source.git.incomingRepositoryLinksReady() && !source.git.browserPreview(), icon: 'repo' },
    { id: 'open-link', group: 'Repository', label: 'Open repository link…', detail: 'Review shared context in a matching local copy', enabled: !busy && !source.git.browserPreview(), icon: 'repo' },
    { id: 'open', group: 'Repository', label: 'Open Repository', detail: 'Open a local Git working tree', shortcut: `${source.primaryShortcutKey} Shift O`, enabled: !busy, icon: 'folder-git' },
    { id: 'clone', group: 'Repository', label: 'Clone Repository', detail: 'Download a remote repository to this machine', enabled: !busy, icon: 'copy' },
    { id: 'init', group: 'Repository', label: 'Initialize Repository', detail: 'Create a new local Git working tree', enabled: !busy, icon: 'repo' },
    { id: 'previous-tab', group: 'Repository', label: 'Previous Repository Tab', detail: 'Switch to the repository tab on the left', shortcut: 'Ctrl Shift Tab', enabled: source.git.repositories().length > 1, icon: 'chevron-left' },
    { id: 'next-tab', group: 'Repository', label: 'Next Repository Tab', detail: 'Switch to the repository tab on the right', shortcut: 'Ctrl Tab', enabled: source.git.repositories().length > 1, icon: 'chevron-right' },
    { id: 'close-tab', group: 'Repository', label: 'Close Repository Tab', detail: 'Close the current repository workspace', shortcut: `${source.primaryShortcutKey} W`, enabled: !!repository && !busy, icon: 'x' },
    { id: 'reopen-tab', group: 'Repository', label: 'Reopen Closed Repository', detail: source.git.recentlyClosedRepositoryPath() ?? 'No repository tab has been closed in this workspace', shortcut: `${source.primaryShortcutKey} Shift T`, enabled: !!source.git.recentlyClosedRepositoryPath() && !busy, icon: 'redo' },
    { id: 'refresh', group: 'Repository', label: 'Refresh Repository', detail: 'Reload status, references, and history', enabled: !!repository && !busy, icon: 'refresh' },
    { id: 'branch-workflows', group: 'Branch', label: 'Branch workflows', detail: 'Configure, start and finish features, releases and hotfixes', enabled: !!repository && !repository.bare && !busy, icon: 'merge' },
    { id: 'integrate-branch', group: 'Branch', label: `Merge or rebase into ${repository?.status.branch ?? 'current branch'}…`, detail: 'Bring another branch\'s changes in: fast-forward, merge, rebase or squash', enabled: !!repository?.status.branch && !busy, icon: 'merge' },
    { id: 'merge-preview', group: 'Branch', label: 'Preview merge conflicts', detail: 'Inspect committed branch tips without starting a merge', enabled: !!repository?.headOid && !busy, icon: 'merge' },
    { id: 'maintenance', group: 'Repository', label: 'Perform Repository Maintenance', detail: 'Check integrity, pack refs/commit graph; no pruning', enabled: !!repository && !busy, icon: 'settings' },
    { id: 'undo', group: 'Edit', label: source.git.undoLabel() ?? 'Undo', detail: source.git.undoLabel() ? 'Reverse the latest supported repository action' : 'No supported repository action to undo', shortcut: source.undoShortcut, enabled: !!source.git.undoLabel() && !busy, icon: 'undo' },
    { id: 'redo', group: 'Edit', label: source.git.redoLabel() ?? 'Redo', detail: source.git.redoLabel() ? 'Repeat the last repository action that was undone' : 'No supported repository action to redo', shortcut: source.redoShortcut, enabled: !!source.git.redoLabel() && !busy, icon: 'redo' },
    { id: 'fetch', group: 'Remote', label: 'Fetch All', detail: 'Fetch and prune remote references', enabled: !!repository && !busy, icon: 'refresh' },
    { id: 'fetch-options', group: 'Remote', label: 'Fetch branches with options', detail: 'Choose remote and pruning; leave tags unchanged', enabled: !!repository && !busy, icon: 'remote' },
    { id: 'add-remote', group: 'Remote', label: 'Add Remote', detail: 'Connect another tracked Git repository', enabled: !!repository && !busy, icon: 'remote' },
    { id: 'pull', group: 'Remote', label: 'Pull', detail: 'Fetch and integrate upstream changes', enabled: !!repository && !busy, icon: 'pull' },
    {
      id: 'push',
      group: 'Remote',
      label: source.currentBranch()?.upstream ? 'Push' : 'Publish Branch',
      detail: source.currentBranch()?.upstream
        ? 'Push the current branch upstream'
        : 'Choose a remote and publish the current branch',
      enabled: !!source.currentBranch() && !busy,
      icon: 'push',
    },
    { id: 'force-push', group: 'Remote', label: 'Force Push with Lease', detail: 'Rewrite the upstream only if it still matches the reviewed fetched commit', enabled: !!source.currentBranch()?.upstream && !busy, icon: 'warning' },
    { id: 'branch', group: 'Branch', label: 'Create Branch', detail: 'Create a branch from the current HEAD', enabled: !!repository && !busy, icon: 'branch' },
    { id: 'tag-create', group: 'Branch', label: 'Create Tag', detail: source.selectedCommit() && !source.changesOpen() ? 'Tag the selected commit' : 'Tag the current HEAD', enabled: !!repository?.headOid && !busy, icon: 'tag' },
    { id: 'stage-all', group: 'Working Tree', label: 'Stage All Changes', detail: repository?.status.conflicted ? 'Resolve conflicts before staging all files' : 'Add every current working-tree change to the index', enabled: !!source.unstagedEntries().length && !repository?.status.conflicted && !busy, icon: 'check' },
    { id: 'unstage-all', group: 'Working Tree', label: 'Unstage All Changes', detail: repository?.status.conflicted ? 'Resolve conflicts before unstaging all files' : 'Move every staged change back to the working tree', enabled: !!source.stagedEntries().length && !repository?.status.conflicted && !busy, icon: 'reset' },
    { id: 'stash', group: 'Working Tree', label: 'Stash Changes', detail: 'Stash tracked and untracked changes', enabled: !!repository?.status.entryCount && !busy, icon: 'archive' },
    { id: 'apply-stash', group: 'Working Tree', label: 'Apply Latest Stash', detail: 'Apply the newest stash without removing it', enabled: !!repository?.stashes.length && !busy, icon: 'archive-restore', stashTarget: repository?.stashes[0] ? { repositoryId: repository.id, stash: repository.stashes[0] } : undefined },
    { id: 'pop', group: 'Working Tree', label: 'Pop Latest Stash', detail: 'Apply and remove the newest stash', enabled: !!repository?.stashes.length && !busy, icon: 'archive-restore', stashTarget: repository?.stashes[0] ? { repositoryId: repository.id, stash: repository.stashes[0] } : undefined },
    { id: 'working-tree', group: 'Working Tree', label: 'View Working Directory Changes', detail: 'Return to staging and commit preparation', enabled: !!repository, icon: 'file' },
    { id: 'terminal', group: 'View', label: 'Open Terminal', detail: 'Open a shell in this repository', shortcut: `${source.alternateShortcutKey} T / ${source.primaryShortcutKey} \``, enabled: !!repository, icon: 'terminal' },
    { id: 'file-manager', group: 'View', label: 'Open Repository Folder', detail: 'Show the working tree in the system file manager', shortcut: `${source.alternateShortcutKey} O`, enabled: !!repository, icon: 'folder-git' },
    { id: 'fullscreen', group: 'View', label: 'Toggle Fullscreen', detail: 'Enter or leave fullscreen mode', shortcut: source.fullscreenShortcut, enabled: true, icon: 'maximize' },
    { id: 'search', group: 'View', label: 'Search All History', detail: 'Search whole-repository history with optional advanced filters', shortcut: `${source.primaryShortcutKey} Shift F`, enabled: !!repository, icon: 'search' },
    { id: 'file-search', group: 'History', label: 'Find File History or Blame', detail: 'Search every tracked file in this repository', shortcut: `${source.primaryShortcutKey} Shift H`, enabled: !!repository, icon: 'history' },
    { id: 'file-tools', group: 'Edit', label: 'External File Tools', detail: 'Inspect reviewed editor, comparison and merge sessions', enabled: !!repository && !busy && !source.fileContentDialog(), icon: 'terminal' },
    { id: 'editor-draft-recovery', group: 'Edit', label: 'Editor Draft Recovery', detail: 'Inspect retained editor copies and review a working file', enabled: !busy && !source.fileContentDialog(), icon: 'history' },
    { id: 'recovery-history', group: 'History', label: 'Recovery History', detail: 'Find previous reference positions and preserve a commit with a new branch', enabled: !!repository && !busy, icon: 'history' },
    ...((repository && source.repositoryOperation().mergeInProgress) ? [
      { id: 'merge-continue', group: 'Branch', label: 'Continue Merge', detail: repository.status.conflicted ? 'Resolve and stage every conflicted file first' : 'Create the merge commit from the resolved index', enabled: !repository.status.conflicted && !busy, icon: 'merge' as IconName },
      { id: 'merge-abort', group: 'Branch', label: 'Abort Merge', detail: 'Stop the merge and restore its pre-merge state', enabled: !busy, icon: 'reset' as IconName },
    ] : []),
    ...((repository && source.repositoryOperation().historyOperation) ? [
      { id: 'history-operation-continue', group: 'History', label: `Continue ${source.repositoryOperation().historyOperation === 'cherry-pick' ? 'Cherry-pick' : 'Revert'}`, detail: source.repositoryOperation().historyNoCommit ? 'Stage resolutions and apply remaining changes without committing' : repository.status.conflicted ? 'Resolve and stage every conflicted file first' : 'Continue the interrupted history operation', enabled: !repository.status.conflicted && !(source.repositoryOperation().historyNoCommit && repository.status.unstaged) && !busy, icon: (source.repositoryOperation().historyOperation === 'cherry-pick' ? 'cherry-pick' : 'revert') as IconName },
      { id: 'history-operation-skip', group: 'History', label: `Skip Current ${source.repositoryOperation().historyOperation === 'cherry-pick' ? 'Cherry-pick' : 'Revert'}`, detail: 'Omit the current commit and advance the operation', enabled: !source.repositoryOperation().historyNoCommit && !busy, icon: 'redo' as IconName },
      { id: 'history-operation-abort', group: 'History', label: `Abort ${source.repositoryOperation().historyOperation === 'cherry-pick' ? 'Cherry-pick' : 'Revert'}`, detail: 'Stop the operation and restore its original state', enabled: !busy, icon: 'reset' as IconName },
      ...(source.repositoryOperation().historyNoCommit ? [{ id: 'history-operation-quit', group: 'History', label: 'Finish No-commit Replay Manually', detail: 'End the saved sequence while retaining all current files and staged changes', enabled: !busy, icon: 'check' as IconName }] : []),
    ] : []),
    ...((repository && source.repositoryOperation().bisectInProgress) ? [
      ...(!source.git.bisectResult() ? [
      { id: 'bisect-good', group: 'History', label: 'Bisect: Mark Current Commit Good', detail: `Mark candidate ${bisectOid} as known good`, enabled: !busy && !!bisectTarget, icon: 'check' as IconName, bisectTarget },
      { id: 'bisect-bad', group: 'History', label: 'Bisect: Mark Current Commit Bad', detail: `Mark candidate ${bisectOid} as known bad`, enabled: !busy && !!bisectTarget, icon: 'warning' as IconName, bisectTarget },
      { id: 'bisect-skip', group: 'History', label: 'Bisect: Skip Current Commit', detail: `Continue without classifying candidate ${bisectOid}`, enabled: !busy && !!bisectTarget, icon: 'redo' as IconName, bisectTarget },
      ] : []),
      { id: 'bisect-reset', group: 'History', label: 'Bisect: Reset', detail: 'Stop the search and restore the original branch', enabled: !busy, icon: 'reset' as IconName },
    ] : [
      { id: 'bisect-start', group: 'History', label: 'Start Bisect from Selected Commit', detail: 'Treat the selected commit as good and the current HEAD as bad', enabled: !!source.selectedCommitData() && source.selectedCommitData()?.oid !== repository?.headOid && !repository?.status.entryCount && !(repository && source.repositoryOperation().rebaseInProgress) && !busy, icon: 'history' as IconName },
    ]),
    { id: 'left-panel', group: 'View', label: 'Toggle Left Panel', detail: 'Show or hide repository references', shortcut: `${source.primaryShortcutKey} J`, enabled: !!repository, icon: 'panel-left' },
    { id: 'commit-panel', group: 'View', label: 'Toggle Commit Panel', detail: 'Show or hide commit details', shortcut: `${source.primaryShortcutKey} K`, enabled: !!repository, icon: 'panel-right' },
    { id: 'preferences', group: 'View', label: 'Open Preferences', detail: 'Customize appearance, graph, Git features, and terminal defaults', enabled: true, icon: 'settings' },
    { id: 'reset-ui', group: 'View', label: 'Restore Interface Defaults', detail: 'Review and reset appearance and layout preferences without changing Git data', enabled: true, icon: 'reset' },
    { id: 'theme-toggle', group: 'View', label: source.appTheme() === 'khronos' ? 'Switch to Midnight Contrast' : 'Switch to Khronos Dark', detail: 'Change the global application color theme', enabled: true, icon: 'eye' },
    { id: 'zoom-in', group: 'View', label: 'Increase Zoom', detail: 'Increase the interface zoom level', shortcut: `${source.primaryShortcutKey} +`, enabled: source.zoomPercent() < ZOOM_LEVELS.at(-1)!, icon: 'plus' },
    { id: 'zoom-out', group: 'View', label: 'Decrease Zoom', detail: 'Decrease the interface zoom level', shortcut: `${source.primaryShortcutKey} -`, enabled: source.zoomPercent() > ZOOM_LEVELS[0], icon: 'reset' },
    { id: 'zoom-reset', group: 'View', label: 'Reset Zoom', detail: `Return interface zoom to ${DEFAULT_ZOOM}% (automatic scale ${source.autoZoom()}%)`, shortcut: `${source.primaryShortcutKey} 0`, enabled: source.zoomPercent() !== DEFAULT_ZOOM, icon: 'reset' },
    { id: 'diff-view', group: 'View', label: 'Open Diff View', detail: 'Inspect the selected file in the focused diff workspace', shortcut: `${source.primaryShortcutKey} D`, enabled: !!source.activeDiff(), icon: 'file' },
    { id: 'shortcuts', group: 'View', label: 'Keyboard Shortcuts', detail: 'Open the desktop shortcut reference', shortcut: `${source.primaryShortcutKey} /`, enabled: true, icon: 'keyboard' },
    { id: 'activity-log', group: 'View', label: 'Activity Logs', detail: 'Inspect application and repository operations', enabled: !!repository, icon: 'activity' },
    { id: 'sparse-configure', group: 'Git Features', label: 'Configure Sparse Checkout', detail: repository?.sparseCheckout.enabled ? 'Edit the checked-out repository directories' : 'Limit the working tree to selected directories', enabled: !!repository && !busy, icon: 'folder-git' },
    { id: 'sparse-reapply', group: 'Git Features', label: 'Reapply Sparse Checkout', detail: 'Restore the configured sparse working tree', enabled: !!repository?.sparseCheckout.enabled && !busy, icon: 'refresh' },
    { id: 'sparse-disable', group: 'Git Features', label: 'Disable Sparse Checkout', detail: 'Restore every tracked file to the working tree', enabled: !!repository?.sparseCheckout.enabled && !busy, icon: 'folder-git' },
    { id: 'submodule-manage', group: 'Git Features', label: 'Manage Submodules', detail: 'Review, synchronize, check out, deinitialize, or remove submodules', enabled: !!repository && !busy, icon: 'repo' },
    { id: 'submodule-add', group: 'Git Features', label: 'Add Submodule', detail: 'Reference another repository at a fixed commit', enabled: !!repository && !busy, icon: 'plus' },
    { id: 'lfs-configure', group: 'Git Features', label: 'Configure Git LFS', detail: 'Open repository Git LFS settings', enabled: !!repository?.lfs.available && !busy, icon: 'server' },
  ];

  const query = search.trim();
  const filesOnly = scope === 'files';
  const branchesOnly = scope === 'branches';
  if (!repository) return filesOnly || branchesOnly ? [] : actions;
  if (branchesOnly) {
    const matches = source.branchPickerMatches(query);
    return [
      ...matches.local.map((branch): CommandAction => ({
        id: `local-branch:${branch.name}`,
        group: 'Local Branch',
        label: branch.name,
        detail: source.branchPickerDescription(branch),
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
        icon: source.remoteIcon(source.remoteLocationName(group.primary.name)),
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
  for (const candidate of source.git.repositories()) {
    const current = candidate.id === repository.id;
    append({
      id: `repository:${candidate.id}`,
      group: 'Repository',
      label: `Switch to ${source.git.repositoryLabel(candidate)}`,
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
      icon: source.remoteIcon(source.remoteLocationName(branch.name)),
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
      detail: `Jump to ${source.shortLabel(tag.oid)}`,
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
  for (const path of source.git.trackedFileSearch()?.paths ?? []) {
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
}

export function rankCommandActions(actions: readonly CommandAction[], search: string, recent: readonly string[]): CommandAction[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) {
    const ordered = [...actions].sort((left, right) => {
      const leftGroup = COMMAND_GROUP_ORDER.indexOf(left.group);
      const rightGroup = COMMAND_GROUP_ORDER.indexOf(right.group);
      return (leftGroup < 0 ? COMMAND_GROUP_ORDER.length : leftGroup)
        - (rightGroup < 0 ? COMMAND_GROUP_ORDER.length : rightGroup);
    });
    const actionsById = new Map(ordered.map((action) => [action.id, action]));
    const quickIds = [...new Set([...recent, ...COMMAND_QUICK_ACTION_IDS])];
    const quickActions = quickIds
      .map((id) => actionsById.get(id))
      .filter((action): action is CommandAction => !!action?.enabled)
      .slice(0, COMMAND_QUICK_ACTION_LIMIT)
      .map((action) => ({ ...action, group: 'Quick Actions' }));
    const quickActionIds = new Set(quickActions.map((action) => action.id));
    return [...quickActions, ...ordered.filter((action) => !quickActionIds.has(action.id))];
  }
  return actions
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
}
