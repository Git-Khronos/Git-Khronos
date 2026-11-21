import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { expandAcceptanceReports, selectPublisherReport, summarizeInstalledReport, summarizeReleaseMatrix } from './report-installed-acceptance.mjs';

test('discovers only final native reports from explicitly selected roots in stable order', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'khronos-report-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, 'first results');
  const second = join(root, 'second results');
  const late = join(first, 'smoke/run-b');
  const early = join(first, 'smoke/run-a');
  for (const directory of [late, early, second]) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'report.json'), '{}');
    await writeFile(join(directory, 'progress.json'), '{}');
  }
  assert.deepEqual(await expandAcceptanceReports(['explicit.json', '--reports-dir', first, '--reports-dir', second]),
    ['explicit.json', join(early, 'report.json'), join(late, 'report.json'), join(second, 'report.json')]);
});

test('directory discovery refuses missing, linked, empty and excessively nested evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'khronos-report-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const empty = join(root, 'empty');
  await mkdir(empty);
  await writeFile(join(empty, 'progress.json'), '{}');
  await assert.rejects(expandAcceptanceReports(['--reports-dir']), /Supply a directory/);
  await assert.rejects(expandAcceptanceReports(['--bogus']), /Unknown acceptance report option/);
  await assert.rejects(expandAcceptanceReports(['--reports-dir', join(root, 'absent')]), { code: 'ENOENT' });
  await assert.rejects(expandAcceptanceReports(['--reports-dir', empty]), /No completed report.json/);
  const link = join(root, 'linked');
  await symlink(empty, link);
  await assert.rejects(expandAcceptanceReports(['--reports-dir', link]), /real acceptance report directory/);
  await assert.rejects(expandAcceptanceReports(['--reports-dir', root]), /does not follow links/);
  await symlink(join(empty, 'progress.json'), join(empty, 'report.json'));
  await assert.rejects(expandAcceptanceReports(['--reports-dir', empty]), /does not follow links/);
  const deep = join(root, 'deep');
  await mkdir(join(deep, ...Array(14).fill('child')), { recursive: true });
  await assert.rejects(expandAcceptanceReports(['--reports-dir', deep]), /directory is too deep/);
});

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
    'discard-subset', 'submodule-initialize', 'submodule-update', 'stash-selection', 'patch-export',
    'tracked-file-search', 'feature-rebase', 'commit-rewrite', 'file-review-scope', 'repository-creation-scope', 'first-status', 'repository-open-scope'],
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
  assert.equal(complete.checks.length, 32);
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

test('the installed tracked-file review must prove distinct native paths and correct palette actions', () => {
  const fixtures = matrixFixtures();
  const search = fixtures.find(report => report.suite === 'tracked-file-search');
  for (const scenario of search.scenarios) {
    const partial = { ...search, scenarios: [scenario] };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== search), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite),
      ['tracked-file-search']);
  }
});

test('the installed rewrite review needs both the stale refusal and the real editor rewrite', () => {
  const fixtures = matrixFixtures();
  const rewrite = fixtures.find(report => report.suite === 'commit-rewrite');
  for (const scenario of rewrite.scenarios) {
    const partial = { ...rewrite, scenarios: [scenario] };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== rewrite), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite),
      ['commit-rewrite']);
  }
});

test('GitLab catalogue-only evidence cannot qualify an installed platform without fork restart recovery', () => {
  const fixtures = matrixFixtures();
  const forkRestart = 'native-gitlab-fork-lost-reply-private-outcome-survives-real-process-restart-without-credential-or-post-replay';
  for (const gitlab of fixtures.filter(report => report.suite === 'gitlab')) {
    const partial = { ...gitlab, scenarios: gitlab.scenarios.filter(scenario => scenario !== forkRestart) };
    // Reported success on this and every other platform is not a substitute.
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== gitlab), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(({ distribution, suite }) => ({
      distribution, suite,
    })), [{ distribution: gitlab.linuxDistribution, suite: 'gitlab' }]);
  }
});

test('installed file discard must prove stale refusal and fresh, scoped success', () => {
  const fixtures = matrixFixtures();
  const fileReview = fixtures.find(report => report.suite === 'file-review-scope');
  const scenarios = [
    'native-same-tip-external-checkout-disables-the-old-file-discard-review',
    'native-fresh-file-review-discards-only-the-newly-reviewed-edit',
  ];
  for (const scenario of scenarios) {
    const partial = { ...fileReview, scenarios: scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== fileReview), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite),
      ['file-review-scope']);
  }
});

test('installed repository creation needs both non-activation and recovery without replay', () => {
  const fixtures = matrixFixtures();
  const review = fixtures.find(report => report.suite === 'repository-creation-scope');
  const scenarios = [
    'native-late-clone-result-is-persisted-without-taking-over-the-active-repository',
    'native-late-clone-can-be-opened-from-recents-without-replaying-git',
  ];
  for (const scenario of scenarios) {
    const partial = { ...review, scenarios: review.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== review), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite),
      ['repository-creation-scope']);
  }
});

test('installed startup must show pending files and publish both accurate line recaps', () => {
  const fixtures = matrixFixtures();
  const firstStatus = fixtures.find(report => report.suite === 'first-status');
  for (const name of [
    'native-first-file-scan-shows-loading-not-clean-while-history-is-usable',
    'native-first-file-scan-publishes-real-staged-and-unstaged-recaps-without-writes',
  ]) {
    const incomplete = { ...firstStatus, scenarios: firstStatus.scenarios.filter(scenario => scenario !== name) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== firstStatus), incomplete]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['first-status']);
  }
});

test('installed Browse must reject a retired reply and still open a fresh selection', () => {
  const fixtures = matrixFixtures();
  const open = fixtures.find(report => report.suite === 'repository-open-scope');
  for (const name of [
    'native-retired-repository-read-preserves-active-tab-draft-and-saved-membership',
    'native-current-repository-selection-still-opens-the-chosen-checkout',
  ]) {
    const partial = { ...open, scenarios: open.scenarios.filter(scenario => scenario !== name) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== open), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['repository-open-scope']);
  }
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
