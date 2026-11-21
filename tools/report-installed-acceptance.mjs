#!/usr/bin/env node
// Summarize operator-owned reports without confusing extracted builds, other
// package bytes, or repeated scenarios with installed release evidence.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPackage } from './check-linux-abi.mjs';

const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const SMOKE_SCENARIO = 'native-ui-reviewed-checkpoint-deletion-preserves-sibling-and-repository';
const GITLAB_SCENARIO = 'native-gitlab-catalogue-preserves-independent-git-refs-index-config-and-working-tree';

// Keep the local checklist aligned with linux-package-acceptance.yml. It
// checks retained runtime evidence, not the hosted job or publisher key.
const RELEASE_MATRIX = [
  ['ubuntu', '22.04', 'smoke', SMOKE_SCENARIO],
  ['ubuntu', '22.04', 'gitlab', GITLAB_SCENARIO],
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
  ['ubuntu', '24.04', 'gitlab', GITLAB_SCENARIO],
  ['ubuntu', '26.04', 'smoke', SMOKE_SCENARIO],
  ['ubuntu', '26.04', 'gitlab', GITLAB_SCENARIO],
  ['debian', '12', 'incoming-links', 'native-incoming-cold-saved-promisor-restoration-and-patch-read-never-fetch-with-independent-positive-control', true],
  ['debian', '12', 'gitlab', GITLAB_SCENARIO],
  ['debian', '13', 'smoke', SMOKE_SCENARIO],
  ['debian', '13', 'gitlab', GITLAB_SCENARIO],
];

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

export async function reportInstalledAcceptance(packagePath, reportPaths, { releaseMatrix = false } = {}) {
  const candidate = checkPackage(resolve(packagePath));
  const reports = [];
  const seen = new Set();
  const validatedReports = [];
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
      }
    } catch (error) {
      throw new Error(`${path}: ${error.message}`, { cause: error });
    }
  }
  return {
    package: candidate.package,
    version: candidate.version,
    sha256: candidate.packageSha256,
    reports,
    ...(releaseMatrix && { releaseMatrix: summarizeReleaseMatrix(validatedReports) }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const releaseMatrix = args[0] === '--release-matrix';
    if (releaseMatrix) args.shift();
    const [packagePath, ...reportPaths] = args;
    if (!packagePath || (!releaseMatrix && !reportPaths.length) || args.some(arg => arg.startsWith('--'))) {
      throw new Error('Usage: node tools/report-installed-acceptance.mjs [--release-matrix] PACKAGE.deb [REPORT.json …]');
    }
    const summary = await reportInstalledAcceptance(packagePath, reportPaths, { releaseMatrix });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.reports.some(report => !report.passed) || (releaseMatrix && !summary.releaseMatrix.complete)) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
