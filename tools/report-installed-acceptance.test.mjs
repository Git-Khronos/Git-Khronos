import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPackage } from './check-linux-abi.mjs';
import { expandAcceptanceReports, parseFocusedAcceptance, reportInstalledAcceptance, selectPublisherReport, summarizeFocusedAcceptance, summarizeInstalledReport, summarizeReleaseMatrix, summarizeReleaseProgress } from './report-installed-acceptance.mjs';

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
  assert.deepEqual(await expandAcceptanceReports(['--reports-dir', empty], { allowEmptyDirectories: true }), []);
  const link = join(root, 'linked');
  await symlink(empty, link);
  await assert.rejects(expandAcceptanceReports(['--reports-dir', link]), /real acceptance report directory/);
  await assert.rejects(expandAcceptanceReports(['--reports-dir', root]), /does not follow links/);
  await symlink(join(empty, 'progress.json'), join(empty, 'report.json'));
  await assert.rejects(expandAcceptanceReports(['--reports-dir', empty]), /does not follow links/);
  await assert.rejects(expandAcceptanceReports(['--reports-dir', empty], { allowEmptyDirectories: true }), /does not follow links/);
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
  'ubuntu:24.04': ['smoke', 'gitlab', 'workspace-batch', 'workspace-pull-upstreams', 'pull-submodule-scope',
    'workspace-saved-removal',
    'workspace-locate', 'workspace-bulk-locate', 'workspace-locate-nearby', 'workspace-reopen',
    'discard-subset', 'submodule-initialize', 'submodule-update', 'stash-selection', 'patch-export',
    'tracked-file-search', 'feature-rebase', 'commit-rewrite', 'file-review-scope', 'repository-creation-scope',
    'first-status', 'working-tree-recaps', 'repository-open-scope', 'detached-checkout', 'checkout-snapshot'],
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

const focusedLane = {
  distribution: { id: 'ubuntu', versionId: '24.04' },
  suite: 'setup-keyboard',
  inheritedGitEnvironment: true,
  requiredScenarios: ['owned-a', 'owned-b'],
};

test('focused plans require non-empty, unambiguous lanes with explicit Git setup', async () => {
  const plan = { version: 1, checks: [focusedLane] };
  assert.deepEqual(parseFocusedAcceptance(plan), [focusedLane]);
  for (const invalid of [
    { ...plan, version: 2 }, { ...plan, checks: [] }, { ...plan, ignored: true },
    { ...plan, checks: [{ ...focusedLane, inheritedGitEnvironment: undefined }] },
    { ...plan, checks: [{ ...focusedLane, requiredScenarios: [] }] },
    { ...plan, checks: [{ ...focusedLane, requiredScenarios: ['same', 'same'] }] },
    { ...plan, checks: [{ ...focusedLane, distribution: { id: 'ubuntu', versionId: 24.04 } }] },
  ]) {
    assert.throws(() => parseFocusedAcceptance(invalid), /focused acceptance/);
  }
  assert.throws(() => parseFocusedAcceptance({ ...plan, checks: [focusedLane, {
    ...focusedLane, requiredScenarios: ['different-scope'],
  }] }), /Duplicate focused acceptance lane/);
  await assert.rejects(reportInstalledAcceptance('not-read.deb', [], {
    releaseMatrix: true, focusedRequest: plan,
  }), /cannot qualify a release matrix/);
  await assert.rejects(reportInstalledAcceptance('not-read.deb', [], {
    publisherPreflight: {}, focusedRequest: plan,
  }), /cannot qualify a release matrix/);
});

test('focused acceptance requires one exact passing report per lane and cannot stitch scenarios', () => {
  const secondLane = { ...focusedLane, suite: 'detached-checkout', inheritedGitEnvironment: false, requiredScenarios: ['owned-c'] };
  const plan = { version: 1, checks: [focusedLane, secondLane] };
  const report = {
    suite: focusedLane.suite,
    linuxDistribution: focusedLane.distribution,
    inheritedGitEnvironment: true,
    passed: true,
    scenarios: ['owned-a', 'owned-b'],
    path: '/owned/ready.json',
  };
  const other = {
    ...report, suite: secondLane.suite, inheritedGitEnvironment: false,
    scenarios: ['owned-c'], path: '/owned/second.json',
  };
  const result = summarizeFocusedAcceptance(plan, [report, other]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.checks.map(check => check.report), [report.path, other.path]);
  for (const evidence of [
    [report],
    [report, { ...other, inheritedGitEnvironment: true }],
    [report, { ...other, inheritedGitEnvironment: undefined }],
    [report, { ...other, linuxDistribution: { id: 'ubuntu', versionId: '22.04' } }],
    [{ ...report, scenarios: ['owned-a'] }, { ...report, scenarios: ['owned-b'], path: '/owned/split.json' }, other],
  ]) {
    assert.equal(summarizeFocusedAcceptance(plan, evidence).complete, false);
  }
  const failed = { ...report, passed: false, path: '/owned/failed.json' };
  const mixed = summarizeFocusedAcceptance(plan, [report, other, failed]);
  assert.equal(mixed.complete, false);
  assert.deepEqual(mixed.failedReports, [failed.path]);
});

test('the CLI rejects missing or combined focused options before looking up package bytes', () => {
  const cli = fileURLToPath(new URL('./report-installed-acceptance.mjs', import.meta.url));
  for (const args of [
    ['--verify-focused'],
    ['--verify-focused', '--release-matrix', 'owned.deb', 'report.json'],
    ['--verify-release', 'receipt.json', 'publisher.pub', '--verify-focused', 'plan.json', 'owned.deb', 'report.json'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, '');
  }
});

test('the release matrix needs exact suites on all supported userspaces', () => {
  const fixtures = matrixFixtures();
  const complete = summarizeReleaseMatrix(fixtures);
  assert.equal(complete.complete, true);
  assert.equal(complete.checks.length, 37);
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

test('release progress distinguishes missing, incomplete, failed and satisfied installed evidence', () => {
  const [passed, failed, incomplete, ...remaining] = matrixFixtures();
  const validated = [
    passed,
    { ...passed, path: 'previous-failed-report.json', passed: false },
    { ...failed, passed: false },
    { ...incomplete, scenarios: ['another-scenario'] },
    ...remaining.slice(1),
  ];
  const matrix = summarizeReleaseMatrix(validated);
  const reports = validated.map(report => ({ ...report, distribution: report.linuxDistribution }));
  const progress = summarizeReleaseProgress(matrix, reports);
  assert.equal(progress.totalChecks, matrix.checks.length);
  assert.deepEqual(progress.counts, {
    satisfied: matrix.checks.length - 3, failed: 1, incomplete: 1, 'awaiting-report': 1,
  });
  assert.deepEqual(progress.checks.slice(0, 4).map(check => check.state),
    ['satisfied', 'failed', 'incomplete', 'awaiting-report']);
  assert.deepEqual(progress.failedReports, ['previous-failed-report.json', failed.path]);
  assert.equal(progress.checks[0].report, passed.path);
  assert.equal(progress.checks[3].report, null);
});

test('progress keeps valid parallel results visible when a report is malformed or belongs to another installer', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'khronos-installed-progress-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = join(root, 'payload');
  for (const directory of ['DEBIAN', 'usr/bin', 'usr/share/applications']) {
    await mkdir(join(payload, directory), { recursive: true });
  }
  await writeFile(join(payload, 'DEBIAN/control'), [
    'Package: git-khronos', 'Version: 0.1.6', 'Architecture: amd64',
    'Maintainer: Fixture <owned@example.test>', 'Description: Progress test fixture',
    'Depends: libc6 (>= 2.35)', '',
  ].join('\n'));
  await writeFile(join(payload, 'usr/share/applications/git-khronos.desktop'), '[Desktop Entry]\n');
  const executable = join(payload, 'usr/bin/git-khronos');
  const compiled = spawnSync('cc', ['-x', 'c', '-o', executable, '-'], {
    input: 'int main(void) { return 0; }\n', encoding: 'utf8',
  });
  assert.equal(compiled.status, 0, compiled.stderr);
  const artifact = join(root, 'candidate.deb');
  const build = spawnSync('dpkg-deb', ['--root-owner-group', '--build', payload, artifact], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const packageEvidence = checkPackage(artifact);
  const [first, second] = summarizeReleaseMatrix([]).checks;
  const passing = {
    ...report, suite: first.suite, linuxDistribution: first.distribution,
    scenarios: first.requiredScenarios, packageSha256: packageEvidence.packageSha256,
    executableSha256: packageEvidence.installedPayload.executableSha256,
    installedDesktopEntry: { ...report.installedDesktopEntry, sha256: packageEvidence.installedPayload.desktopEntrySha256 },
  };
  const paths = Object.fromEntries(['passing', 'wrong', 'malformed', 'failed'].map(name => [name, join(root, `${name}.json`)]));
  await writeFile(paths.passing, JSON.stringify(passing));
  await writeFile(paths.wrong, JSON.stringify({
    ...passing, suite: second.suite, linuxDistribution: second.distribution,
    scenarios: second.requiredScenarios, packageSha256: '0'.repeat(64),
  }));
  await writeFile(paths.malformed, 'untrusted text that cannot be decoded');
  await writeFile(paths.failed, JSON.stringify({ ...passing, passed: false, scenarios: [] }));
  const cli = fileURLToPath(new URL('./report-installed-acceptance.mjs', import.meta.url));
  const run = (mode, ...paths) =>
    spawnSync(process.execPath, [cli, mode, artifact, ...paths], { encoding: 'utf8' });
  const progress = run('--release-progress', paths.wrong, paths.passing, paths.malformed, paths.failed);
  assert.equal(progress.status, 1);
  assert.equal(progress.stderr, '');
  const result = JSON.parse(progress.stdout);
  assert.equal(result.kind, 'installed-release-progress');
  assert.equal(result.sha256, packageEvidence.packageSha256);
  assert.deepEqual(result.reports.map(row => row.path), [paths.passing, paths.failed]);
  assert.deepEqual(result.releaseProgress.failedReports, [paths.failed]);
  assert.equal(result.releaseProgress.counts.satisfied, 1);
  assert.equal(result.releaseProgress.checks[0].report, paths.passing);
  assert.equal(result.releaseProgress.checks[1].report, null);
  assert.deepEqual(result.rejectedReports.map(row => row.path), [paths.wrong, paths.malformed]);
  assert.match(result.rejectedReports[0].reason, /different Debian package/);
  assert.match(result.rejectedReports[1].reason, /Invalid JSON/);
  assert.doesNotMatch(progress.stdout, /untrusted text/);
  assert.equal('publisherPreflight' in result, false);
  assert.equal('releaseMatrix' in result, false);
  const strict = run('--release-matrix', paths.passing, paths.wrong);
  assert.equal(strict.status, 1);
  assert.equal(strict.stdout, '');
  assert.match(strict.stderr, /different Debian package/);
});

test('local release checks include every installed Ubuntu 24.04 workflow review required by CI', () => {
  const workflow = readFileSync(new URL('../.github/workflows/linux-package-acceptance.yml', import.meta.url), 'utf8');
  const step = workflow.match(/- name: Verify installed workspace and Git workflow reviews\r?\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(step, 'Missing CI workflow review step');
  assert.match(step, /matrix\.ubuntu == '24\.04'/);
  const plan = step.match(/run: >-\r?\n\s+bash tools\/run-native-suites\.sh "\$PACKAGE"\s+([\s\S]+)$/)?.[1];
  assert.ok(plan, 'Missing the installed suite batch plan');
  const ciSuites = plan.trim().split(/\s+/);
  const localSuites = summarizeReleaseMatrix([]).checks.filter(check =>
    check.distribution.id === 'ubuntu' && check.distribution.versionId === '24.04' &&
    !['smoke', 'gitlab'].includes(check.suite)).map(check => check.suite);
  assert.deepEqual(localSuites, ciSuites);
});

test('the CLI lists requirements without a package and cannot pass them off as evidence', () => {
  const cli = fileURLToPath(new URL('./report-installed-acceptance.mjs', import.meta.url));
  const list = spawnSync(process.execPath, [cli, '--list-release-matrix'], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  const declared = JSON.parse(list.stdout);
  const wouldVerify = summarizeReleaseMatrix([]);
  assert.equal(declared.kind, 'requirements');
  assert.equal(declared.totalChecks, wouldVerify.checks.length);
  assert.equal('complete' in declared, false);
  assert.ok(declared.checks.every(check => !('report' in check)));
  assert.deepEqual(declared.checks, wouldVerify.checks.map(({ report, ...check }) => check));
  const mixed = spawnSync(process.execPath, [cli, '--list-release-matrix', 'installer.deb'], { encoding: 'utf8' });
  assert.equal(mixed.status, 1);
  assert.equal(mixed.stdout, '');
  assert.match(mixed.stderr, /Usage:/);
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

test('installed workspace batch must preserve its checkout and saved Pull policy', () => {
  const fixtures = matrixFixtures();
  const batch = fixtures.find(report => report.suite === 'workspace-batch');
  for (const scenario of [
    'native-workspace-pull-refuses-same-tip-external-checkout-before-fetch',
    'native-workspace-pull-honors-fast-forward-only-on-diverged-repository',
  ]) {
    const olderEvidence = { ...batch, scenarios: batch.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== batch), olderEvidence]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['workspace-batch']);
  }
});

test('installed environment must prove manual and background Fetch protect local branches', () => {
  const fixtures = matrixFixtures();
  const environment = fixtures.find(report => report.suite === 'environment');
  const scenario = 'native-ordinary-and-background-fetch-refuse-local-branch-refspecs';
  assert.ok(environment.scenarios.includes(scenario));
  const older = { ...environment, scenarios: environment.scenarios.filter(name => name !== scenario) };
  const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== environment), older]);
  assert.equal(matrix.complete, false);
  assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['environment']);
});

test('installed recaps must prove distinct diff sides and independent line budgets', () => {
  const fixtures = matrixFixtures();
  const recaps = fixtures.find(report => report.suite === 'working-tree-recaps');
  for (const scenario of [
    'native-working-tree-same-path-selects-each-index-side-from-its-tree-row',
    'native-unstaged-recap-is-complete-when-staged-recap-hits-its-bound',
    'native-unstaged-recap-survives-status-byte-bound-without-counting-conflicts',
  ]) {
    assert.ok(recaps.scenarios.includes(scenario));
    const priorEvidence = { ...recaps, scenarios: recaps.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== recaps), priorEvidence]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['working-tree-recaps']);
  }
});

test('installed stash selection must prove both restore collision checks refuse before mutation', () => {
  const fixtures = matrixFixtures();
  const stash = fixtures.find(report => report.suite === 'stash-selection');
  for (const scenario of [
    'native-stash-restore-refuses-local-untracked-collision-before-applying',
    'native-stash-restore-preserves-ignored-file-against-tracked-addition',
  ]) {
    assert.ok(stash.scenarios.includes(scenario));
    const older = { ...stash, scenarios: stash.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== stash), older]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['stash-selection']);
  }
});

test('installed Pull requires both repository-scope and explicit single-branch evidence', () => {
  const fixtures = matrixFixtures();
  for (const { suite, scenario } of [
    { suite: 'workspace-pull-upstreams',
      scenario: 'native-single-branch-toolbar-pull-keeps-multi-upstream-config-and-excludes-the-other-branch' },
    { suite: 'workspace-pull-upstreams',
      scenario: 'native-pull-retains-local-tag-and-stale-tracking-ref-even-with-git-pruning-config' },
    { suite: 'workspace-pull-upstreams',
      scenario: 'native-pull-with-rebase-preserves-unreviewed-sibling-branches' },
    { suite: 'workspace-pull-upstreams',
      scenario: 'native-pull-honors-selected-strategy-over-implicit-squash' },
    { suite: 'workspace-pull-upstreams',
      scenario: 'native-pull-refuses-local-branch-fetch-mapping-before-fetch' },
    { suite: 'workspace-pull-upstreams',
      scenario: 'native-pull-fast-forward-refuses-to-overwrite-ignored-local-data' },
    { suite: 'pull-submodule-scope',
      scenario: 'native-pull-updates-the-parent-gitlink-without-fetching-or-changing-the-submodule' },
  ]) {
    const original = fixtures.find(report => report.suite === suite);
    assert.ok(original.scenarios.includes(scenario));
    const incomplete = { ...original, scenarios: original.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== original), incomplete]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), [suite]);
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

test('installed detached checkout requires safe switches and ignored-file recovery checks', () => {
  const fixtures = matrixFixtures();
  const detach = fixtures.find(report => report.suite === 'detached-checkout');
  for (const name of [
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
  ]) {
    const partial = { ...detach, scenarios: detach.scenarios.filter(scenario => scenario !== name) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== detach), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['detached-checkout']);
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

test('checkout snapshot accepts neither a smoke-only report nor a failed race scenario', () => {
  const fixtures = matrixFixtures();
  const checkout = fixtures.find(report => report.suite === 'checkout-snapshot');
  for (const invalid of [{ ...checkout, scenarios: ['ordinary-smoke'] }, { ...checkout, passed: false }]) {
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== checkout), invalid]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['checkout-snapshot']);
  }
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
      'native-worktree-and-branch-removal-requires-recovery-before-removing-checkout',
      'native-ordinary-and-background-fetch-refuse-local-branch-refspecs',
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
