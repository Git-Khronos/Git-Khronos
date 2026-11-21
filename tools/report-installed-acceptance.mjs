#!/usr/bin/env node
// Summarize operator-owned reports without confusing extracted builds, other
// package bytes, or repeated scenarios with installed release evidence.
import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPackage } from './check-linux-abi.mjs';
import { checkEvidenceWithReport } from './check-debian-update-evidence.mjs';

const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_REPORTS = 512;
const MAX_DISCOVERY_DEPTH = 12;
const MAX_DISCOVERY_ENTRIES = 10_000;
const SMOKE_SCENARIO = 'native-ui-reviewed-checkpoint-deletion-preserves-sibling-and-repository';
const GITLAB_SCENARIOS = [
  'native-gitlab-catalogue-preserves-independent-git-refs-index-config-and-working-tree',
  'native-gitlab-fork-lost-reply-private-outcome-survives-real-process-restart-without-credential-or-post-replay',
];

// Keep the local checklist aligned with linux-package-acceptance.yml. It
// checks retained runtime evidence, not the hosted job or publisher key.
const UBUNTU_NOBLE_REVIEWS = [
  ['workspace-batch', 'native-workspace-batch-stop-completes-active-fetch-and-never-dispatches-queued-fetch'],
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
    'native-stash-refuses-mixed-mode-selection-without-changing-index-stash-or-files',
    'native-stash-mode-change-saves-only-currently-eligible-selected-paths',
  ]],
  ['patch-export', [
    'native-patch-export-clean-scope-disables-destination-picker',
    'native-patch-export-missing-reviewed-path-blocks-ui-and-native-partial-write',
    'native-patch-export-recovered-selection-opens-real-picker-and-native-export-writes-only-selected-diff',
  ]],
  ['tracked-file-search', [
    'native-tracked-file-search-uses-distinct-unmerged-paths-before-the-result-limit',
    'native-tracked-file-palette-keeps-one-history-and-blame-per-path-without-changing-merge-state',
  ]],
  ['feature-rebase', 'native-feature-rebase-uses-configured-development-without-moving-sibling-refs'],
  ['commit-rewrite', [
    'native-commit-rewrite-refuses-a-stale-branch-at-the-same-head',
    'native-commit-editor-rewrites-only-the-reviewed-branch-and-keeps-staged-and-working-bytes',
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
  ]],
];

const RELEASE_MATRIX = [
  ['ubuntu', '22.04', 'smoke', SMOKE_SCENARIO],
  ['ubuntu', '22.04', 'gitlab', GITLAB_SCENARIOS],
  ['ubuntu', '22.04', 'watcher-refresh', [
    'native-packed-ref-refresh-replays-read-after-held-status',
    'native-loose-ref-refresh-converges-during-continuous-watcher-events',
  ]],
  ['ubuntu', '22.04', 'lfs-counts', 'native-lfs-checkout-counts-handle-literal-filenames-without-following-transfer-filters'],
  ['ubuntu', '22.04', 'lfs-snapshot-timeout', 'native-lfs-stalled-listing-does-not-block-opening-or-invent-counts'],
  ['ubuntu', '22.04', 'environment', [
    'native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer',
    'native-saved-repository-paths-survive-workspace-switch-and-support-retry-and-removal',
  ], true],
  ['ubuntu', '24.04', 'smoke', SMOKE_SCENARIO],
  ['ubuntu', '24.04', 'gitlab', GITLAB_SCENARIOS],
  ...UBUNTU_NOBLE_REVIEWS.map(([suite, scenarios]) => ['ubuntu', '24.04', suite, scenarios]),
  ['ubuntu', '26.04', 'smoke', SMOKE_SCENARIO],
  ['ubuntu', '26.04', 'gitlab', GITLAB_SCENARIOS],
  ['debian', '12', 'incoming-links', 'native-incoming-cold-saved-promisor-restoration-and-patch-read-never-fetch-with-independent-positive-control', true],
  ['debian', '12', 'gitlab', GITLAB_SCENARIOS],
  ['debian', '13', 'smoke', SMOKE_SCENARIO],
  ['debian', '13', 'gitlab', GITLAB_SCENARIOS],
];

export async function expandAcceptanceReports(args) {
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
      if (reports.length === first) throw new Error(`No completed report.json files found in ${directory}.`);
      reports.splice(first, reports.length - first, ...reports.slice(first).sort());
    } else if (arg.startsWith('--')) throw new Error(`Unknown acceptance report option: ${arg}`);
    else append(arg);
  }
  return reports;
}

async function readReport(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_REPORT_BYTES) {
      throw new Error('Expected a bounded, regular acceptance report');
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error('The acceptance report changed while reading it');
    return JSON.parse(bytes.subarray(0, offset).toString('utf8'));
  } finally {
    await file.close();
  }
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
  return {
    suite: report.suite,
    passed: report.passed,
    completedScenarios: report.scenarios.length,
    git: report.git,
    platform: report.platform,
    distribution: typeof distro?.id === 'string' && distro.id
      ? { id: distro.id, versionId: typeof distro.versionId === 'string' ? distro.versionId : null } : null,
    inheritedGitEnvironment: report.inheritedGitEnvironment === true,
  };
}

// Input reports must already have been matched to the installed payload.
export function summarizeReleaseMatrix(validatedReports) {
  const checks = RELEASE_MATRIX.map(([id, versionId, suite, scenario, inheritedGitEnvironment = false]) => {
    const requiredScenarios = Array.isArray(scenario) ? scenario : [scenario];
    const observed = validatedReports.find(report => report.passed === true &&
      report.linuxDistribution?.id === id && report.linuxDistribution.versionId === versionId &&
      report.suite === suite && (!inheritedGitEnvironment || report.inheritedGitEnvironment === true) &&
      requiredScenarios.every(required => report.scenarios.includes(required)));
    return {
      distribution: { id, versionId },
      suite,
      ...(inheritedGitEnvironment && { inheritedGitEnvironment }),
      requiredScenarios: [...requiredScenarios],
      report: observed?.path ?? null,
    };
  });
  return { complete: checks.every(check => check.report !== null), checks };
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

export async function reportInstalledAcceptance(packagePath, reportPaths, { releaseMatrix = false, publisherPreflight } = {}) {
  releaseMatrix ||= !!publisherPreflight;
  const candidate = checkPackage(resolve(packagePath));
  const reports = [];
  const seen = new Set();
  const validatedReports = [];
  const environmentReports = new Map();
  for (const path of reportPaths) {
    const absolute = resolve(path);
    if (seen.has(absolute)) throw new Error(`Duplicate report path: ${path}`);
    seen.add(absolute);
    try {
      const report = await readReport(absolute);
      reports.push({ path, ...summarizeInstalledReport(candidate, report) });
      if (releaseMatrix) {
        const { suite, passed, scenarios, linuxDistribution, inheritedGitEnvironment } = report;
        validatedReports.push({ path, suite, passed, scenarios, linuxDistribution, inheritedGitEnvironment });
        if (publisherPreflight && suite === 'environment' && linuxDistribution?.id === 'ubuntu'
            && linuxDistribution.versionId === '22.04' && passed) environmentReports.set(path, report);
      }
    } catch (error) {
      throw new Error(`${path}: ${error.message}`, { cause: error });
    }
  }
  const summary = {
    package: candidate.package,
    version: candidate.version,
    sha256: candidate.packageSha256,
    reports,
    ...(releaseMatrix && { releaseMatrix: summarizeReleaseMatrix(validatedReports) }),
  };
  if (publisherPreflight) {
    const { path, raw } = selectPublisherReport(summary, environmentReports);
    const sha256 = await checkEvidenceWithReport(publisherPreflight.receipt, raw, publisherPreflight.key, resolve(packagePath));
    if (sha256 !== summary.sha256) throw new Error('The package changed between installed matrix and publisher preflight checks.');
    summary.publisherPreflight = { sha256, report: path };
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const usage = 'Usage: node tools/report-installed-acceptance.mjs [--release-matrix | --verify-release BUILD-RECEIPT PUBLIC-KEY] PACKAGE.deb [REPORT.json | --reports-dir DIRECTORY] …';
    const releaseMatrix = args[0] === '--release-matrix';
    let publisherPreflight;
    if (releaseMatrix) args.shift();
    else if (args[0] === '--verify-release') {
      const [, receipt, key] = args.splice(0, 3);
      if (!receipt || !key || [receipt, key].some(arg => arg.startsWith('--'))) throw new Error(usage);
      publisherPreflight = { receipt, key };
    }
    const [packagePath, ...reportInputs] = args;
    if (!packagePath || packagePath.startsWith('--') || (!releaseMatrix && !reportInputs.length)) {
      throw new Error(usage);
    }
    const reportPaths = await expandAcceptanceReports(reportInputs);
    const summary = await reportInstalledAcceptance(packagePath, reportPaths, { releaseMatrix, publisherPreflight });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.reports.some(report => !report.passed) || (releaseMatrix && !summary.releaseMatrix.complete)) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
