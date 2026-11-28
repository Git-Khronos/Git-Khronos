#!/usr/bin/env node
// Summarize operator-owned reports without confusing extracted builds, other
// package bytes, or repeated scenarios with installed release evidence.
import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isCliEntry } from './cli-entry.mjs';
import { checkPackage, checkPackageIdentity } from './check-linux-abi.mjs';
import { checkEvidenceWithReport, UPDATE_CONSENT_SCENARIO } from './check-debian-update-evidence.mjs';

const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_REPORTS = 512;
const MAX_DISCOVERY_DEPTH = 12;
const MAX_DISCOVERY_ENTRIES = 10_000;
const SMOKE_SCENARIOS = [
  'native-ui-reviewed-checkpoint-deletion-preserves-sibling-and-repository',
  'native-toolbar-menu-tab-returns-to-toolbar-after-focus-gap',
];
const GITLAB_SCENARIOS = [
  'native-gitlab-catalogue-preserves-independent-git-refs-index-config-and-working-tree',
  'native-gitlab-fork-lost-reply-private-outcome-survives-real-process-restart-without-credential-or-post-replay',
  'native-webdriver-explicit-stale-refusal-clicks-only-the-owned-replacement',
  'native-webdriver-initial-navigation-ignores-disabled-duplicate',
  'native-webdriver-navigation-without-paint-frames-clicks-once',
];

// Keep the local checklist aligned with linux-package-acceptance.yml. It
// checks retained runtime evidence, not the hosted job or publisher key.
const UBUNTU_NOBLE_REVIEWS = [
  ['workspace-batch', [
    'native-workspace-batch-stop-completes-active-fetch-and-never-dispatches-queued-fetch',
    'native-workspace-pull-refuses-same-tip-external-checkout-before-fetch',
    'native-workspace-pull-honors-fast-forward-only-on-diverged-repository',
  ]],
  ['workspace-pull-upstreams', [
    'native-workspace-pull-skips-multiple-upstreams-before-fetch-and-continues-the-batch',
    'native-single-branch-toolbar-pull-keeps-multi-upstream-config-and-excludes-the-other-branch',
    'native-pull-retains-local-tag-and-stale-tracking-ref-even-with-git-pruning-config',
    'native-pull-with-rebase-preserves-unreviewed-sibling-branches',
    'native-pull-honors-selected-strategy-over-implicit-squash',
    'native-pull-refuses-local-branch-fetch-mapping-before-fetch',
    'native-pull-fast-forward-refuses-to-overwrite-ignored-local-data',
  ]],
  ['pull-submodule-scope', [
    'native-pull-updates-the-parent-gitlink-without-fetching-or-changing-the-submodule',
    'native-pull-options-describe-separate-submodule-checkout-scope',
  ]],
  ['workspace-saved-removal', 'native-workspace-review-removes-only-selected-saved-paths-and-persists-across-reload'],
  ['workspace-locate', 'native-workspace-locate-replaces-one-path-using-owned-native-folder-picker'],
  ['workspace-bulk-locate', 'native-workspace-bulk-locate-stops-on-native-picker-cancel-and-preserves-saved-slots'],
  ['workspace-locate-nearby', 'native-workspace-locate-starts-in-the-previous-parent-and-selects-renamed-checkout'],
  ['workspace-reopen', [
    'native-ui-reopen-closed-tab-does-not-leak-across-workspaces',
    'native-ui-reopen-closed-tab-restores-saved-slot-without-changing-git',
  ]],
  ['discard-subset', [
    'native-ui-blocked-discard-returns-to-read-only-review-and-clears-selection',
    'native-ui-blocked-discard-confirms-only-reviewed-root-and-undo-restores-exact-state',
    'native-discard-review-wraps-shift-tab-without-applying-the-preview',
    'native-ui-direct-selection-discards-only-reviewed-path-and-undo-restores-bytes',
    'native-ui-nested-tracked-discard-restores-index-and-undo-restores-working-bytes',
    'native-ui-single-nested-file-discard-and-undo-preserve-index-and-head',
    'native-ui-nested-lockfile-discard-preserves-index-and-sibling-edit',
  ]],
  ['discard-deletion', [
    'native-ui-nested-deletion-discards-undoes-and-redoes-without-changing-index',
    'native-palette-previews-all-unstaged-and-cancels-without-checkout-changes',
    'native-text-undo-does-not-restore-discarded-repository-file',
    'native-ui-trash-discards-nested-untracked-file-and-undo-restores-it',
  ]],
  ['discard-stale-review', [
    'native-ui-single-discard-refuses-newer-working-edit-without-capture',
    'native-ui-fresh-single-discard-after-stale-review-can-undo-newer-edit',
    'native-ui-refused-keyboard-discard-returns-focus-and-keeps-files',
  ]],
  ['discard-large', [
    'native-ui-discards-and-recovers-four-large-nested-untracked-files',
    'native-large-discard-capture-survives-restart-and-recovers-exact-bytes',
    'native-cti-data-paths-and-sizes-recover-unchanged-after-restart',
    'native-cti-sized-bulk-discard-skips-and-preserves-staged-only-file',
    'native-cti-sized-bulk-discard-restores-index-version-of-tracked-file-and-undo-recovers-edit',
  ]],
  ['discard-limit', [
    'native-oversized-nested-file-gets-size-specific-refusal-without-mutation',
    'native-oversized-nested-bulk-reviews-and-rechecks-all-blocked-paths-without-mutation',
    'native-palette-restores-opener-after-canceling-an-all-blocked-discard-review',
    'native-mixed-discard-labels-oversized-paths-and-leaves-all-files-unchanged',
  ]],
  ['submodule-initialize', [
    'native-submodule-initialize-opener-and-cancel-do-not-touch-repository',
    'native-submodule-confirm-initializes-only-selected-path-including-nested',
  ]],
  ['submodule-update', [
    'native-submodule-remote-update-open-and-cancel-do-not-fetch',
    'native-submodule-remote-update-refuses-late-dirty-edit-before-fetch',
    'native-submodule-remote-update-moves-only-selected-checkout-and-preserves-parent-index',
  ]],
  ['stash-selection', [
    'native-whole-checkout-stash-only-saves-untracked-files-when-included',
    'native-stash-selection-loads-more-files-and-saves-only-explicit-paths',
    'native-stash-path-filter-keeps-hidden-selection-in-exact-stash',
    'native-stash-select-matching-adds-only-filtered-loaded-paths',
    'native-stash-refuses-mixed-mode-selection-without-changing-index-stash-or-files',
    'native-stash-mode-change-saves-only-currently-eligible-selected-paths',
    'native-stash-restore-refuses-local-untracked-collision-before-applying',
    'native-stash-restore-preserves-ignored-file-against-tracked-addition',
  ]],
  ['patch-export', [
    'native-patch-export-clean-scope-disables-destination-picker',
    'native-patch-export-missing-reviewed-path-blocks-ui-and-native-partial-write',
    'native-patch-export-recovered-selection-opens-real-picker-and-native-export-writes-only-selected-diff',
  ]],
  ['tracked-file-search', [
    'native-tracked-file-search-uses-distinct-unmerged-paths-before-the-result-limit',
    'native-tracked-file-palette-keeps-one-history-and-blame-per-path-without-changing-merge-state',
    'native-file-history-copies-deleted-path-without-git-mutation',
    'native-file-history-long-subject-keeps-copy-actions-visible',
    'native-file-history-copies-full-commit-id-without-git-mutation',
    'native-file-history-clears-copied-path-feedback-on-starting-revision-change',
    'native-file-history-selects-tag-branch-and-commit-start-points-and-restores-diff-revision',
    'native-file-history-opens-a-deleted-literal-path-and-its-removal-diff',
  ]],
  ['file-menu-copy', [
    'native-working-file-menu-copies-literal-path-without-git-mutation',
    'native-commit-file-menu-copies-literal-path-without-git-mutation',
  ]],
  ['reference-copy', [
    'native-ui-copies-ambiguous-local-remote-and-tag-namespaces-without-git-mutation',
    'native-ui-full-ref-keyboard-copy-restores-branch-focus',
  ]],
  ['feature-rebase', 'native-feature-rebase-uses-configured-development-without-moving-sibling-refs'],
  ['comparison-responsiveness', [
    'native-branch-comparison-keeps-native-status-responsive-and-preserves-checkout',
    'native-git-comparisons-do-not-block-unrelated-native-status-and-preserve-worktree',
  ]],
  ['merge-rebase-review', [
    'native-slow-merge-rebase-review-dismisses-before-git-finishes-without-writes',
    'native-merge-preserving-review-shows-exact-parents-and-cancel-leaves-checkout-unchanged',
    'native-merge-preserving-rebase-refuses-stale-destination-before-writing',
    'native-merge-preserving-rebase-keeps-topology-sibling-refs-and-protects-original-tip',
    'native-merge-preserving-rebase-leaves-native-status-responsive',
  ]],
  ['commit-rewrite', [
    'native-commit-rewrite-refuses-a-stale-branch-at-the-same-head',
    'native-commit-editor-rewrites-only-the-reviewed-branch-and-keeps-staged-and-working-bytes',
  ]],
  ['commit-responsiveness', [
    'native-commit-and-amend-do-not-block-unrelated-native-status-or-include-unstaged-data',
    'native-message-only-amend-keeps-status-responsive-and-preserves-index',
    'native-ancestor-edit-keeps-status-responsive-and-preserves-trees-and-staging',
  ]],
  ['file-review-scope', [
    'native-same-tip-external-checkout-disables-the-old-file-discard-review',
    'native-fresh-file-review-discards-only-the-newly-reviewed-edit',
  ]],
  ['repository-creation-scope', [
    'native-late-clone-result-is-persisted-without-taking-over-the-active-repository',
    'native-late-clone-can-be-opened-from-recents-without-replaying-git',
  ]],
  ['first-status', [
    'native-first-file-scan-shows-loading-not-clean-while-history-is-usable',
    'native-first-file-scan-publishes-real-staged-and-unstaged-recaps-without-writes',
    'native-first-file-scan-drains-large-diagnostics-without-blocking-status',
  ]],
  ['working-tree-recaps', [
    'native-working-tree-same-path-selects-each-index-side-from-its-tree-row',
    'native-unstaged-summary-counts-index-relative-lines-untracked-text-and-binary-exclusion-without-writes',
    'native-unstaged-summary-recounts-after-staging-without-including-staged-lines',
    'native-unstaged-recap-updates-after-external-edit-with-unchanged-porcelain',
    'native-unstaged-recap-is-complete-when-staged-recap-hits-its-bound',
    'native-compact-unstaged-recap-does-not-cover-bulk-actions',
    'native-unstaged-excluded-label-follows-both-theme-palettes',
    'native-collapsing-staged-files-docks-header-and-expands-unstaged-viewport',
    'native-staged-file-disclosure-persists-and-keeps-unstaged-space-after-reload',
    'native-collapsing-unstaged-files-expands-staged-viewport-without-writes',
    'native-palette-focuses-working-tree-filter-without-changing-draft-or-checkout',
    'native-palette-opens-and-focuses-only-the-requested-file-section',
    'native-collapsed-working-tree-headers-show-loaded-filter-matches',
    'native-discard-picker-reopens-and-focuses-unstaged-list-without-writes',
    'native-discard-picker-discloses-filtered-selections-and-restores-focus-on-cancel',
    'native-discard-picker-explains-collapsed-and-filtered-out-files-without-writes',
    'native-stage-all-reaches-unstaged-files-beyond-initial-status-page',
    'native-unstage-all-reaches-staged-files-beyond-initial-status-page',
    'native-expanded-unstaged-list-reaches-both-keyboard-edges-without-writes',
    'native-expanded-unstaged-scroll-jumps-keep-offset-and-visible-rows-without-writes',
    'native-final-working-tree-page-restores-keyboard-focus-without-changing-checkout',
    'native-unstaged-recap-survives-status-byte-bound-without-counting-conflicts',
    'native-worktree-rename-stages-and-unstages-both-paths-without-changing-files',
    'native-stage-and-unstage-preserve-executable-mode-change-and-exact-binary-bytes',
    'native-stage-and-unstage-gitlink-without-changing-dirty-submodule',
  ]],
  ['repository-open-scope', [
    'native-retired-repository-read-preserves-active-tab-draft-and-saved-membership',
    'native-current-repository-selection-still-opens-the-chosen-checkout',
  ]],
  ['detached-checkout', [
    'native-stale-local-checkout-does-not-recreate-remote-tracking-branch',
    'native-branch-and-detached-checkout-preserve-an-ignored-local-file',
    'native-reviewed-merge-refuses-to-overwrite-an-ignored-local-file',
    'native-reviewed-rebase-refuses-an-ignored-file-at-the-new-base',
    'native-local-branch-delete-refuses-a-moved-tip',
    'native-context-rebase-preserves-unreviewed-sibling-branches',
    'native-abort-apply-rebase-preserves-ignored-file-and-allows-safe-retry',
    'native-abort-apply-rebase-preserves-ignored-autostash-file',
    'native-skip-rebase-merge-preserves-ignored-reset-file',
    'native-skip-rebase-apply-preserves-ignored-reset-file',
    'native-merge-abort-preserves-ignored-reset-and-autostash-files',
    'native-mail-patch-skip-preserves-ignored-reset-file',
    'native-mail-patch-abort-preserves-ignored-reset-file',
    'native-bisect-reset-preserves-ignored-file-and-allows-safe-retry',
    'native-bisect-checkouts-refuse-ignored-data-loss-before-starting-or-voting',
    'native-bisect-large-range-allows-unrelated-ignored-data',
    'native-bisect-first-parent-reports-the-merge-and-keeps-ignored-side-paths',
    'native-bisect-start-refuses-a-stale-branch-at-the-same-tip',
    'native-bisect-start-keeps-dirty-checkout-unchanged-through-vote-and-reset',
    'native-bisect-vote-rejects-an-obsolete-no-checkout-candidate',
    'native-bisect-votes-use-the-current-old-and-new-terms',
    'native-bisect-result-reports-first-bad-and-prevents-extra-votes',
    'native-bisect-inconclusive-keeps-possible-results-and-refuses-extra-votes',
    'native-cherry-pick-abort-preserves-ignored-reset-file',
    'native-revert-skip-preserves-ignored-reset-file',
    'native-detached-checkout-review-cancel-preserves-branch-index-and-working-files',
    'native-detached-checkout-refuses-a-stale-branch-at-the-same-tip',
    'native-confirmed-detached-checkout-keeps-refs-and-non-overlapping-local-edits',
  ]],
  ['checkout-snapshot', 'native-snapshot-retries-mixed-reads-across-an-external-same-tip-checkout'],
  ['checkout-responsiveness', 'native-local-remote-and-detached-checkouts-keep-native-status-responsive'],
  ['history-control-responsiveness', [
    'native-interactive-review-replay-continue-and-abort-leave-status-responsive',
    'native-merge-continue-and-abort-leave-status-responsive-and-preserve-reviewed-history',
  ]],
  ['local-mutation-responsiveness', [
    'native-stash-save-apply-and-pop-keep-status-responsive-and-restore-owned-bytes',
    'native-cherry-pick-and-revert-keep-status-responsive-and-preserve-exact-history',
  ]],
];

const RELEASE_MATRIX = [
  ['ubuntu', '22.04', 'smoke', SMOKE_SCENARIOS],
  ['ubuntu', '22.04', 'gitlab', GITLAB_SCENARIOS],
  ['ubuntu', '22.04', 'watcher-refresh', [
    'native-packed-ref-refresh-replays-read-after-held-status',
    'native-loose-ref-refresh-converges-during-continuous-watcher-events',
  ]],
  ['ubuntu', '22.04', 'lfs-counts', [
    'native-lfs-checkout-counts-handle-literal-filenames-without-following-transfer-filters',
    'native-lfs-preferences-show-tracked-and-pointer-counts-without-writes',
    'native-lfs-toolbar-menu-and-preferences-agree-on-measured-zero-without-writes',
  ]],
  ['ubuntu', '22.04', 'lfs-snapshot-timeout', [
    'native-lfs-stalled-listing-does-not-block-opening-or-invent-counts',
    'native-lfs-toolbar-distinguishes-unknown-count-and-keeps-pull-available',
    'native-lfs-stalled-attribute-discovery-shares-snapshot-deadline',
    'native-lfs-object-review-times-out-stalled-version-preflight-without-writes',
    'native-lfs-pull-refuses-stalled-eligibility-before-any-transfer',
    'native-lfs-pull-cancels-active-eligibility-before-any-transfer',
  ]],
  ['ubuntu', '22.04', 'environment', [
    'native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer',
    'native-updates-tab-recovers-to-first-or-last-action-without-changing-git',
    UPDATE_CONSENT_SCENARIO,
    'native-ui-file-diff-exact-index-working-private-bytes-literal-argv-sanitized-context',
    'native-ui-file-merge-stage-roles-binary-output-review-save-without-staging',
    'native-ui-file-merge-separate-reviewed-real-index-staging-and-private-cleanup',
    'native-saved-repository-paths-survive-workspace-switch-and-support-retry-and-removal',
    'native-worktree-and-branch-removal-requires-recovery-before-removing-checkout',
    'native-worktree-lock-menu-reviews-reason-and-blocks-removal',
    'native-occupied-branch-review-cancel-preserves-both-dirty-checkouts',
    'native-occupied-branch-review-wraps-shift-tab-without-navigating',
    'native-shortcut-reference-wraps-shift-tab-without-changing-git-or-draft',
    'native-occupied-branch-navigation-opens-registered-owner-without-checkout-or-data-loss',
    'native-occupied-branch-navigation-focuses-owner-tab-without-paint-frames',
    'native-occupied-branch-graph-double-click-opens-registered-owner-without-detaching-head',
    'native-occupied-branch-review-refuses-changed-owner-without-fallback-checkout',
    'native-ordinary-and-background-fetch-refuse-local-branch-refspecs',
    'native-stash-branch-refuses-ignored-obstruction-before-creating-branch',
    'native-reviewed-stash-branch-retains-exact-saved-state-and-source',
  ], true],
  ['ubuntu', '24.04', 'smoke', SMOKE_SCENARIOS],
  ['ubuntu', '24.04', 'gitlab', GITLAB_SCENARIOS],
  ['ubuntu', '24.04', 'application-update-consent', [
    'native-updater-manual-check-runs-offline-without-automatic-consent',
    'native-updater-opt-in-survives-process-restart-and-schedules-an-offline-check',
    'native-updater-opt-out-survives-process-restart-and-keeps-manual-checks-available',
  ]],
  ...UBUNTU_NOBLE_REVIEWS.map(([suite, scenarios]) => ['ubuntu', '24.04', suite, scenarios]),
  ['ubuntu', '26.04', 'smoke', SMOKE_SCENARIOS],
  ['ubuntu', '26.04', 'gitlab', [
    ...GITLAB_SCENARIOS,
    'native-webdriver-waits-for-delayed-navigation-and-clicks-once',
  ]],
  ['ubuntu', '26.04', 'gitlab-connect-refused',
    'native-gitlab-tcp-refusal-explains-failure-clears-token-and-sends-no-http'],
  ['ubuntu', '26.04', 'worktrees', [
    'native-occupied-branch-review-cancel-preserves-both-dirty-checkouts',
    'native-occupied-branch-navigation-opens-registered-owner-without-checkout-or-data-loss',
    'native-occupied-branch-navigation-focuses-owner-tab-without-paint-frames',
    'native-occupied-branch-graph-double-click-opens-registered-owner-without-detaching-head',
    'native-occupied-dev-graph-double-click-returns-from-linked-to-primary-checkout',
    'native-occupied-branch-review-refuses-changed-owner-without-fallback-checkout',
  ]],
  ['debian', '12', 'incoming-links', 'native-incoming-cold-saved-promisor-restoration-and-patch-read-never-fetch-with-independent-positive-control', true],
  ['debian', '12', 'gitlab', GITLAB_SCENARIOS],
  ['debian', '13', 'smoke', SMOKE_SCENARIOS],
  ['debian', '13', 'gitlab', GITLAB_SCENARIOS],
];

export async function expandAcceptanceReports(args, { allowEmptyDirectories = false } = {}) {
  const reports = [];
  let entriesVisited = 0;
  const append = path => {
    if (reports.length >= MAX_REPORTS) throw new Error('Too many acceptance reports; select one candidate run.');
    reports.push(path);
  };
  async function discover(directory, depth) {
    if (depth > MAX_DISCOVERY_DEPTH) throw new Error(`Acceptance report directory is too deep: ${directory}`);
    if (!(await lstat(directory)).isDirectory()) {
      throw new Error(`Use a real acceptance report directory, not a file or link: ${directory}`);
    }
    for await (const entry of await opendir(directory)) {
      if (++entriesVisited > MAX_DISCOVERY_ENTRIES) {
        throw new Error('Too many directory entries; select acceptance results, not a build or workspace tree.');
      }
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Acceptance report discovery does not follow links: ${path}`);
      if (entry.name === 'report.json') {
        if (!entry.isFile()) throw new Error(`Expected a regular acceptance report: ${path}`);
        append(path);
      } else if (entry.isDirectory()) await discover(path, depth + 1);
    }
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--reports-dir') {
      const directory = args[++i];
      if (!directory || directory.startsWith('--')) throw new Error('Supply a directory after --reports-dir.');
      const first = reports.length;
      await discover(resolve(directory), 0);
      if (reports.length === first && !allowEmptyDirectories) {
        throw new Error(`No completed report.json files found in ${directory}.`);
      }
      reports.splice(first, reports.length - first, ...reports.slice(first).sort());
    } else if (arg.startsWith('--')) throw new Error(`Unknown acceptance report option: ${arg}`);
    else append(arg);
  }
  return reports;
}

async function readBoundedJson(path, label, maxBytes) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) {
      throw new Error(`Expected a bounded, regular ${label}`);
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error(`The ${label} changed while reading it`);
    try { return JSON.parse(bytes.subarray(0, offset).toString('utf8')); }
    catch (error) { throw new Error(`Invalid JSON in the ${label}`, { cause: error }); }
  } finally {
    await file.close();
  }
}

export function parseFocusedAcceptance(request) {
  const keysAre = (value, keys) => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
  if (!keysAre(request, ['version', 'checks']) || request.version !== 1 ||
      !Array.isArray(request.checks) || !request.checks.length || request.checks.length > 128) {
    throw new Error('Expected focused acceptance version 1 and between 1 and 128 checks.');
  }
  const unique = new Set();
  return request.checks.map((check, index) => {
    if (!keysAre(check, ['distribution', 'suite', 'inheritedGitEnvironment', 'requiredScenarios']) ||
        !keysAre(check.distribution, ['id', 'versionId']) ||
        typeof check.distribution.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(check.distribution.id) ||
        typeof check.distribution.versionId !== 'string' || !/^\d+(?:\.\d+)*$/.test(check.distribution.versionId) ||
        typeof check.suite !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/.test(check.suite) ||
        typeof check.inheritedGitEnvironment !== 'boolean' ||
        !Array.isArray(check.requiredScenarios) || !check.requiredScenarios.length ||
        check.requiredScenarios.length > 512 ||
        check.requiredScenarios.some(name => typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,159}$/.test(name)) ||
        new Set(check.requiredScenarios).size !== check.requiredScenarios.length) {
      throw new Error(`Invalid focused acceptance check ${index + 1}.`);
    }
    const key = JSON.stringify([check.distribution.id, check.distribution.versionId, check.suite, check.inheritedGitEnvironment]);
    if (unique.has(key)) throw new Error(`Duplicate focused acceptance lane at check ${index + 1}; list its scenarios together.`);
    unique.add(key);
    return {
      distribution: { ...check.distribution }, suite: check.suite,
      inheritedGitEnvironment: check.inheritedGitEnvironment,
      requiredScenarios: [...check.requiredScenarios],
    };
  });
}

export async function readFocusedAcceptancePlan(path) {
  const request = await readBoundedJson(resolve(path), 'focused acceptance plan', 256 * 1024);
  return { version: 1, checks: parseFocusedAcceptance(request) };
}

export function summarizeInstalledReport(candidate, report) {
  if (report?.packageSha256 !== candidate.packageSha256) {
    throw new Error('The report is for a different Debian package');
  }
  if (report.installedExecutable !== true || report.executable !== '/usr/bin/git-khronos' ||
      report.installedDesktopEntry?.path !== '/usr/share/applications/git-khronos.desktop' ||
      report.executableSha256 !== candidate.installedPayload.executableSha256 ||
      report.installedDesktopEntry.sha256 !== candidate.installedPayload.desktopEntrySha256) {
    throw new Error('The report does not match the package’s installed executable and launcher');
  }
  if (typeof report.passed !== 'boolean' || typeof report.suite !== 'string' ||
      !/^[a-z]+(?:-[a-z]+)*$/.test(report.suite) || typeof report.git !== 'string' || !/^git version \S/.test(report.git) ||
      typeof report.platform !== 'string' || !report.platform || !Array.isArray(report.scenarios) ||
      (report.passed && !report.scenarios.length) ||
      report.scenarios.some(name => typeof name !== 'string' || !name.trim()) ||
      new Set(report.scenarios).size !== report.scenarios.length) {
    throw new Error('The report has invalid suite or scenario evidence');
  }
  const distro = report.linuxDistribution;
  // Advisory timings help diagnose slow lanes; they do not decide acceptance.
  const seconds = value => Number.isFinite(value) && value >= 0;
  const phaseName = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const { elapsedSeconds, phases } = report.timing ?? {};
  const timed = seconds(elapsedSeconds) && Array.isArray(phases) && phases.length <= 128 &&
    phases.every(item => phaseName(item?.phase) &&
      seconds(item.durationSeconds) && Number.isSafeInteger(item.scenariosCompleted) &&
      item.scenariosCompleted >= 0 && item.scenariosCompleted <= report.scenarios.length);
  return {
    suite: report.suite,
    passed: report.passed,
    completedScenarios: report.scenarios.length,
    git: report.git,
    platform: report.platform,
    distribution: typeof distro?.id === 'string' && distro.id
      ? { id: distro.id, versionId: typeof distro.versionId === 'string' ? distro.versionId : null } : null,
    inheritedGitEnvironment: report.inheritedGitEnvironment === true,
    ...(!report.passed && phaseName(report.failurePhase) ? { failurePhase: report.failurePhase } : {}),
    ...(timed ? { elapsedSeconds, slowestPhases: [...phases]
      .sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 3)
      .map(({ phase, durationSeconds, scenariosCompleted }) => ({ phase, durationSeconds, scenariosCompleted })) } : {}),
  };
}

function releaseRequirements() {
  return RELEASE_MATRIX.map(([id, versionId, suite, scenario, inheritedGitEnvironment = false]) => ({
    distribution: { id, versionId },
    suite,
    ...(inheritedGitEnvironment && { inheritedGitEnvironment }),
    requiredScenarios: Array.isArray(scenario) ? [...scenario] : [scenario],
  }));
}

// Input reports must already have been matched to the installed payload.
function gitEnvironmentMatches(requirement, report) {
  return report.inheritedGitEnvironment === (requirement.inheritedGitEnvironment ?? false);
}

function matchChecks(requirements, validatedReports) {
  return requirements.map(requirement => {
    const { distribution: { id, versionId }, suite, requiredScenarios } = requirement;
    const observed = validatedReports.find(report => report.passed === true &&
      report.linuxDistribution?.id === id && report.linuxDistribution.versionId === versionId &&
      report.suite === suite &&
      gitEnvironmentMatches(requirement, report) &&
      requiredScenarios.every(required => report.scenarios.includes(required)));
    return { ...requirement, report: observed?.path ?? null };
  });
}

export function summarizeReleaseMatrix(validatedReports) {
  const checks = matchChecks(releaseRequirements(), validatedReports);
  return { complete: checks.every(check => check.report !== null), checks };
}

export function summarizeFocusedAcceptance(request, validatedReports) {
  const checks = matchChecks(parseFocusedAcceptance(request), validatedReports);
  const failedReports = validatedReports.filter(report => !report.passed).map(report => report.path);
  return { complete: !failedReports.length && checks.every(check => check.report !== null), checks, failedReports };
}

// Progress reports cannot qualify an installer or check a publisher key.
// Keep their states tied to final, payload-matched evidence, not live files.
export function summarizeReleaseProgress(matrix, reports) {
  const counts = { satisfied: 0, failed: 0, incomplete: 0, 'awaiting-report': 0 };
  const checks = matrix.checks.map(check => {
    const matching = reports.filter(report => report.suite === check.suite
      && report.linuxDistribution?.id === check.distribution.id
      && report.linuxDistribution.versionId === check.distribution.versionId);
    const state = check.report !== null ? 'satisfied'
      : matching.some(report => !report.passed && gitEnvironmentMatches(check, report)) ? 'failed'
      : matching.length ? 'incomplete' : 'awaiting-report';
    counts[state] += 1;
    // Explain why an otherwise passing report does not qualify. Do not
    // combine scenarios across reports or allow an old failure to hide this
    // diagnostic; only matchChecks can satisfy the requirement.
    const closestPassingReport = check.report === null ? matching.filter(report => report.passed)
      .map(report => ({
        report: report.path,
        inheritedGitEnvironmentMatches: gitEnvironmentMatches(check, report),
        missingScenarios: check.requiredScenarios.filter(scenario => !report.scenarios.includes(scenario)),
      }))
      .sort((a, b) => Number(b.inheritedGitEnvironmentMatches) - Number(a.inheritedGitEnvironmentMatches)
        || a.missingScenarios.length - b.missingScenarios.length)[0] : undefined;
    return { ...check, state, ...(closestPassingReport && { closestPassingReport }) };
  });
  return {
    totalChecks: checks.length, counts,
    failedReports: reports.filter(report => !report.passed).map(report => report.path),
    checks,
  };
}

export function selectPublisherReport(summary, environmentReports) {
  if (summary.reports.some(report => !report.passed)) {
    throw new Error('Release verification requires every supplied report to pass.');
  }
  if (!summary.releaseMatrix?.complete) {
    const missing = summary.releaseMatrix?.checks.filter(check => !check.report)
      .map(({ distribution, suite }) => `${distribution.id} ${distribution.versionId}: ${suite}`);
    throw new Error(`The installed release matrix is incomplete${missing?.length ? ': ' + missing.join(', ') : '.'}`);
  }
  const selected = summary.releaseMatrix.checks.find(check => check.suite === 'environment'
    && check.distribution.id === 'ubuntu' && check.distribution.versionId === '22.04')?.report;
  const raw = environmentReports.get(selected);
  if (!raw) throw new Error('Missing raw Ubuntu 22.04 environment report for publisher preflight.');
  return { path: selected, raw };
}

async function collectInstalledReports(candidate, reportPaths, { collectScenarios, collectEnvironment, keepRejected = false }) {
  const reports = [];
  const rejectedReports = [];
  const seen = new Set();
  const validatedReports = [];
  const environmentReports = new Map();
  for (const path of reportPaths) {
    const absolute = resolve(path);
    if (seen.has(absolute)) throw new Error(`Duplicate report path: ${path}`);
    seen.add(absolute);
    try {
      const report = await readBoundedJson(absolute, 'acceptance report', MAX_REPORT_BYTES);
      reports.push({ path, ...summarizeInstalledReport(candidate, report) });
      if (collectScenarios) {
        const { suite, passed, scenarios, linuxDistribution, inheritedGitEnvironment } = report;
        validatedReports.push({ path, suite, passed, scenarios, linuxDistribution, inheritedGitEnvironment });
        if (collectEnvironment && suite === 'environment' && linuxDistribution?.id === 'ubuntu'
            && linuxDistribution.versionId === '22.04' && passed) environmentReports.set(path, report);
      }
    } catch (error) {
      if (!keepRejected) throw new Error(`${path}: ${error.message}`, { cause: error });
      // Until a report is verified, none of its scope, status or scenario
      // fields is trusted. Keep the rejection separate from lane evidence.
      rejectedReports.push({ path, reason: error.message });
    }
  }
  return { reports, validatedReports, environmentReports, rejectedReports };
}

function installerReportSummary(candidate, reports) {
  return {
    package: candidate.package,
    version: candidate.version,
    sha256: candidate.packageSha256,
    reports,
  };
}

async function reportInstalledProgress(packagePath, reportPaths) {
  const candidate = checkPackage(resolve(packagePath));
  const { reports, validatedReports, rejectedReports } = await collectInstalledReports(candidate, reportPaths, {
    collectScenarios: true, keepRejected: true,
  });
  return {
    kind: 'installed-release-progress',
    ...installerReportSummary(candidate, reports),
    rejectedReports,
    releaseProgress: summarizeReleaseProgress(summarizeReleaseMatrix(validatedReports), validatedReports),
  };
}

export async function reportInstalledAcceptance(packagePath, reportPaths, { releaseMatrix = false, publisherPreflight, focusedRequest } = {}) {
  releaseMatrix ||= !!publisherPreflight;
  if (focusedRequest !== undefined && releaseMatrix) throw new Error('Focused acceptance cannot qualify a release matrix.');
  const inspect = focusedRequest !== undefined ? checkPackageIdentity : checkPackage;
  const candidate = inspect(resolve(packagePath));
  const { reports, validatedReports, environmentReports } = await collectInstalledReports(candidate, reportPaths, {
    collectScenarios: releaseMatrix || focusedRequest !== undefined,
    collectEnvironment: !!publisherPreflight,
  });
  const summary = {
    ...installerReportSummary(candidate, reports),
    ...(releaseMatrix && { releaseMatrix: summarizeReleaseMatrix(validatedReports) }),
    ...(focusedRequest !== undefined && { focusedAcceptance: summarizeFocusedAcceptance(focusedRequest, validatedReports) }),
  };
  if (publisherPreflight) {
    const { path, raw } = selectPublisherReport(summary, environmentReports);
    const sha256 = await checkEvidenceWithReport(publisherPreflight.receipt, raw, publisherPreflight.key, resolve(packagePath));
    if (sha256 !== summary.sha256) throw new Error('The package changed between installed matrix and publisher preflight checks.');
    summary.publisherPreflight = { sha256, report: path };
  }
  return summary;
}

async function planReleaseLane(id, versionId, packagePath, reportInputs, suites = []) {
  const inLane = ({ distribution }) => distribution.id === id && distribution.versionId === versionId;
  const lane = releaseRequirements().filter(inLane);
  if (!lane.length) throw new Error(`Unsupported release distribution: ${id} ${versionId}. Use --list-release-matrix.`);
  for (const suite of suites) {
    if (!lane.some(check => check.suite === suite)) {
      throw new Error(`Suite ${suite} is not required on ${id} ${versionId}. Use --list-release-matrix.`);
    }
  }
  const inSelection = check => inLane(check) && (!suites.length || suites.includes(check.suite));
  let checks = lane.filter(inSelection);
  if (packagePath !== undefined) {
    const reportPaths = await expandAcceptanceReports(reportInputs, { allowEmptyDirectories: true });
    // The strict collector rejects foreign or malformed evidence. A valid failed
    // report is expected on retries, but cannot satisfy any release check.
    const { releaseMatrix } = await reportInstalledAcceptance(packagePath, reportPaths, { releaseMatrix: true });
    checks = releaseMatrix.checks.filter(check => inSelection(check) && check.report === null);
  }
  const plan = {
    version: 1,
    checks: checks.map(({ distribution, suite, inheritedGitEnvironment = false, requiredScenarios }) => ({
      distribution, suite, inheritedGitEnvironment, requiredScenarios,
    })),
  };
  return plan.checks.length ? { version: 1, checks: parseFocusedAcceptance(plan) } : plan;
}

async function main(args) {
  try {
    const usage = 'Usage: node tools/report-installed-acceptance.mjs --list-release-matrix\n'
      + '   or: node tools/report-installed-acceptance.mjs --plan-release-lane ID VERSION_ID [--suite SUITE]… [PACKAGE.deb [REPORT.json | --reports-dir DIRECTORY] …]\n'
      + '   or: node tools/report-installed-acceptance.mjs [--verify-focused PLAN | --release-progress | --release-matrix | --verify-release BUILD-RECEIPT PUBLIC-KEY] PACKAGE.deb [REPORT.json | --reports-dir DIRECTORY] …';
    if (args[0] === '--list-release-matrix') {
      if (args.length !== 1) throw new Error(usage);
      const checks = releaseRequirements();
      console.log(JSON.stringify({ kind: 'requirements', totalChecks: checks.length, checks }, null, 2));
      return;
    }
    if (args[0] === '--plan-release-lane') {
      const [, id, versionId, ...selection] = args;
      const suites = [];
      while (selection[0] === '--suite') {
        const [, suite] = selection.splice(0, 2);
        if (!suite || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(suite) || suites.includes(suite)) {
          throw new Error('Supply a distinct native suite name for each --suite.');
        }
        suites.push(suite);
      }
      const [packagePath, ...reportInputs] = selection;
      if (!id || !versionId || [id, versionId].some(arg => arg.startsWith('--')) ||
          packagePath === '' || packagePath?.startsWith('--')) throw new Error(usage);
      console.log(JSON.stringify(await planReleaseLane(id, versionId, packagePath, reportInputs, suites), null, 2));
      return;
    }
    const releaseMatrix = args[0] === '--release-matrix';
    const releaseProgress = args[0] === '--release-progress';
    let publisherPreflight;
    let focusedPlan;
    if (releaseMatrix || releaseProgress) args.shift();
    else if (args[0] === '--verify-release') {
      const [, receipt, key] = args.splice(0, 3);
      if (!receipt || !key || [receipt, key].some(arg => arg.startsWith('--'))) throw new Error(usage);
      publisherPreflight = { receipt, key };
    } else if (args[0] === '--verify-focused') {
      [, focusedPlan] = args.splice(0, 2);
      if (!focusedPlan || focusedPlan.startsWith('--')) throw new Error(usage);
    }
    const [packagePath, ...reportInputs] = args;
    if (!packagePath || packagePath.startsWith('--') ||
        (!releaseMatrix && !releaseProgress && focusedPlan === undefined && !reportInputs.length)) {
      throw new Error(usage);
    }
    const focusedRequest = focusedPlan === undefined ? undefined : await readFocusedAcceptancePlan(focusedPlan);
    const reportPaths = await expandAcceptanceReports(reportInputs, {
      allowEmptyDirectories: releaseProgress || focusedPlan !== undefined,
    });
    if (releaseProgress) {
      const progress = await reportInstalledProgress(packagePath, reportPaths);
      console.log(JSON.stringify(progress, null, 2));
      if (progress.rejectedReports.length || progress.releaseProgress.failedReports.length) process.exitCode = 1;
      return;
    }
    const summary = await reportInstalledAcceptance(packagePath, reportPaths, {
      releaseMatrix, publisherPreflight, focusedRequest,
    });
    if (focusedPlan !== undefined) {
      console.log(JSON.stringify({ kind: 'focused-installed-acceptance', ...summary }, null, 2));
      if (!summary.focusedAcceptance.complete) process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(summary, null, 2));
    if (summary.reports.some(report => !report.passed) || (releaseMatrix && !summary.releaseMatrix.complete)) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta)) {
  await main(process.argv.slice(2));
}
