import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectPublisherReport, summarizeInstalledReport, summarizeReleaseMatrix } from './report-installed-acceptance.mjs';

const candidate = {
  packageSha256: 'a'.repeat(64),
  installedPayload: { executableSha256: 'b'.repeat(64), desktopEntrySha256: 'c'.repeat(64) },
};
const report = {
  suite: 'setup-keyboard',
  git: 'git version 2.43.0',
  platform: 'Linux-WSL2-with-glibc2.39',
  linuxDistribution: { id: 'ubuntu', versionId: '24.04' },
  passed: true,
  scenarios: ['fixture-a', 'fixture-b'],
  packageSha256: candidate.packageSha256,
  installedExecutable: true,
  executable: '/usr/bin/git-khronos',
  executableSha256: candidate.installedPayload.executableSha256,
  installedDesktopEntry: {
    path: '/usr/share/applications/git-khronos.desktop',
    sha256: candidate.installedPayload.desktopEntrySha256,
  },
  inheritedGitEnvironment: true,
};

test('keeps installed suite results and userspace separate from the shared kernel', () => {
  assert.deepEqual(summarizeInstalledReport(candidate, report), {
    suite: 'setup-keyboard', git: 'git version 2.43.0', platform: 'Linux-WSL2-with-glibc2.39',
    distribution: { id: 'ubuntu', versionId: '24.04' }, passed: true, completedScenarios: 2,
    inheritedGitEnvironment: true,
  });
  assert.equal(summarizeInstalledReport(candidate, { ...report, linuxDistribution: undefined }).distribution, null);
});

test('does not report mismatched package bytes, extract-only runs, or different installed files', () => {
  assert.throws(() => summarizeInstalledReport(candidate, { ...report, packageSha256: 'd'.repeat(64) }),
    /different Debian package/);
  for (const substitution of [
    { installedExecutable: false },
    { executable: '/tmp/extracted/usr/bin/git-khronos' },
    { executableSha256: 'd'.repeat(64) },
    { installedDesktopEntry: { ...report.installedDesktopEntry, sha256: 'd'.repeat(64) } },
    { installedDesktopEntry: { ...report.installedDesktopEntry, path: '/tmp/other.desktop' } },
  ]) {
    assert.throws(() => summarizeInstalledReport(candidate, { ...report, ...substitution }), /installed executable and launcher/);
  }
});

test('distinguishes an incomplete run from a passing run and refuses malformed scenario counts', () => {
  assert.deepEqual(summarizeInstalledReport(candidate, { ...report, passed: false, scenarios: [] }),
    { ...summarizeInstalledReport(candidate, report), passed: false, completedScenarios: 0 });
  for (const substitution of [
    { passed: 1 }, { suite: '../setup' }, { git: null }, { scenarios: [] },
    { scenarios: ['fixture-a', 'fixture-a'] }, { scenarios: ['fixture-a', null] },
  ]) {
    assert.throws(() => summarizeInstalledReport(candidate, { ...report, ...substitution }), /invalid suite or scenario/);
  }
});

const requiredMatrix = {
  'ubuntu:22.04': ['smoke', 'gitlab', 'watcher-refresh', 'lfs-counts', 'lfs-snapshot-timeout', 'environment'],
  'ubuntu:24.04': ['smoke', 'gitlab', 'workspace-batch', 'workspace-saved-removal',
    'workspace-locate', 'workspace-bulk-locate', 'workspace-locate-nearby', 'workspace-reopen',
    'discard-subset', 'submodule-initialize', 'submodule-update', 'stash-selection', 'patch-export', 'feature-rebase'],
  'ubuntu:26.04': ['smoke', 'gitlab'],
  'debian:12': ['incoming-links', 'gitlab'],
  'debian:13': ['smoke', 'gitlab'],
};

function matrixFixtures() {
  return summarizeReleaseMatrix([]).checks.map(check => ({
    path: `${check.distribution.id}-${check.distribution.versionId}-${check.suite}/report.json`,
    linuxDistribution: check.distribution,
    suite: check.suite,
    passed: true,
    inheritedGitEnvironment: check.inheritedGitEnvironment === true,
    scenarios: check.requiredScenarios,
  }));
}

test('the release matrix needs exact suites on all supported userspaces', () => {
  const fixtures = matrixFixtures();
  const complete = summarizeReleaseMatrix(fixtures);
  assert.equal(complete.complete, true);
  assert.equal(complete.checks.length, 26);
  for (const [platform, suites] of Object.entries(requiredMatrix)) {
    assert.deepEqual(complete.checks.filter(({ distribution }) => `${distribution.id}:${distribution.versionId}` === platform)
      .map(check => check.suite), suites);
  }
  const absent = fixtures.find(report => report.suite === 'smoke' && report.linuxDistribution.versionId === '24.04');
  const unrelated = { ...absent, linuxDistribution: undefined, platform: 'Ubuntu 24.04', path: 'shared-kernel/report.json' };
  const partial = summarizeReleaseMatrix([...fixtures.filter(report => report !== absent), unrelated]);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.checks.filter(check => check.report === null).map(({ distribution, suite }) => [distribution.versionId, suite]),
    [['24.04', 'smoke']]);
});

test('local release checks include every installed Ubuntu 24.04 workflow review required by CI', () => {
  const workflow = readFileSync(new URL('../.github/workflows/linux-package-acceptance.yml', import.meta.url), 'utf8');
  const step = workflow.match(/- name: Verify installed workspace and Git workflow reviews\r?\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(step, 'Missing CI workflow review step');
  assert.match(step, /if: matrix\.ubuntu == '24\.04'/);
  const ciSuites = [...step.matchAll(/--suite ([a-z-]+) --headless --installed --package "\$PACKAGE"/g)].map(match => match[1]);
  const localSuites = summarizeReleaseMatrix([]).checks.filter(check =>
    check.distribution.id === 'ubuntu' && check.distribution.versionId === '24.04' &&
    !['smoke', 'gitlab'].includes(check.suite)).map(check => check.suite);
  assert.deepEqual(localSuites, ciSuites);
});

test('passing patch reports on other platforms or without cancellation evidence do not qualify Noble', () => {
  const fixtures = matrixFixtures();
  const patch = fixtures.find(report => report.suite === 'patch-export');
  const partial = { ...patch, path: 'partial-patch/report.json', scenarios: patch.scenarios.slice(0, 2) };
  const differentPlatform = { ...patch, path: 'jammy-patch/report.json', linuxDistribution: { id: 'ubuntu', versionId: '22.04' } };
  const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== patch), partial, differentPlatform]);
  assert.equal(matrix.complete, false);
  assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['patch-export']);
});

test('the release matrix refuses incomplete watcher, trust, and incoming-link reports', () => {
  const fixtures = matrixFixtures().map(report => {
    if (report.suite === 'watcher-refresh') return { ...report, scenarios: ['ordinary-smoke'] };
    if (report.suite === 'environment') return { ...report, passed: false };
    if (report.suite === 'incoming-links') return { ...report, inheritedGitEnvironment: false };
    return report;
  });
  const partial = summarizeReleaseMatrix(fixtures);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.checks.filter(check => check.report === null).map(check => check.suite),
    ['watcher-refresh', 'environment', 'incoming-links']);
});

test('split passing reports cannot combine to satisfy a required suite', () => {
  const fixtures = matrixFixtures();
  for (const [suite, milestones] of [
    ['watcher-refresh', [
      'native-packed-ref-refresh-replays-read-after-held-status',
      'native-loose-ref-refresh-converges-during-continuous-watcher-events',
    ]],
    ['environment', [
      'native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer',
      'native-saved-repository-paths-survive-workspace-switch-and-support-retry-and-removal',
    ]],
  ]) {
    const full = fixtures.find(report => report.suite === suite);
    assert.deepEqual(full.scenarios, milestones);
    const split = milestones.map((scenario, index) => ({ ...full, path: `${index}/report.json`, scenarios: [scenario] }));
    const outcome = summarizeReleaseMatrix([...fixtures.filter(report => report !== full), ...split]);
    assert.equal(outcome.complete, false);
    assert.deepEqual(outcome.checks.filter(check => check.report === null).map(check => check.suite), [suite]);
  }
});

test('publisher preflight receives the same raw Jammy report that satisfied the matrix', () => {
  const fixtures = matrixFixtures();
  const chosen = fixtures.find(item => item.suite === 'environment');
  const raw = { ...chosen, applicationUpdates: { nativeStatus: { configured: true, automatic: false } } };
  const alternatives = new Map([
    ['alternate-noble/report.json', { ...raw, linuxDistribution: { id: 'ubuntu', versionId: '24.04' } }],
    [chosen.path, raw],
  ]);
  const matrix = summarizeReleaseMatrix(fixtures);
  const selected = selectPublisherReport({ reports: fixtures, releaseMatrix: matrix }, alternatives);
  assert.equal(selected.path, chosen.path);
  assert.strictEqual(selected.raw, raw);
  assert.throws(() => selectPublisherReport({ reports: fixtures, releaseMatrix: matrix }, new Map()),
    /Missing raw Ubuntu 22.04 environment report/);
});

test('release verification does not proceed to the publisher check with missing or failed evidence', () => {
  const fixtures = matrixFixtures();
  const matrix = summarizeReleaseMatrix(fixtures.filter(item => item.suite !== 'watcher-refresh'));
  assert.throws(() => selectPublisherReport({ reports: fixtures, releaseMatrix: matrix }, new Map()),
    /incomplete: ubuntu 22.04: watcher-refresh/);
  assert.throws(() => selectPublisherReport({
    reports: [...fixtures, { passed: false }], releaseMatrix: summarizeReleaseMatrix(fixtures),
  }, new Map()), /every supplied report to pass/);
});
