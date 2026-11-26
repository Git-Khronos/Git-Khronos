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

test('summarizes valid native timings without using them as pass evidence', () => {
  const phase = (name, durationSeconds) => ({ phase: name, durationSeconds, scenariosCompleted: 0 });
  const phases = [phase('preflight', 1), phase('primary', 10), phase('startup', 3), phase('cleanup', 2)];
  const timing = { elapsedSeconds: 16, phases };
  const summary = summarizeInstalledReport(candidate, { ...report, passed: false, timing, failurePhase: 'gitlab-catalogue' });
  assert.equal(summary.passed, false);
  assert.equal(summary.failurePhase, 'gitlab-catalogue');
  assert.equal(summarizeInstalledReport(candidate, { ...report, passed: false, failurePhase: '../unexpected' }).failurePhase, undefined);
  assert.equal(summarizeInstalledReport(candidate, { ...report, failurePhase: 'primary' }).failurePhase, undefined);
  assert.equal(summary.elapsedSeconds, 16);
  assert.deepEqual(summary.slowestPhases, [phases[1], phases[2], phases[3]]);
  assert.equal(phases[0].phase, 'preflight');
  for (const invalid of [{ ...timing, elapsedSeconds: -1 }, { ...timing, phases: [null] },
    { ...timing, phases: [phase('../unsafe', 3)] }]) {
    const ignored = summarizeInstalledReport(candidate, { ...report, timing: invalid });
    assert.equal(ignored.passed, true);
    assert.equal(ignored.elapsedSeconds, undefined);
  }
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
  'ubuntu:24.04': ['smoke', 'gitlab', 'application-update-consent', 'workspace-batch', 'workspace-pull-upstreams', 'pull-submodule-scope',
    'workspace-saved-removal',
    'workspace-locate', 'workspace-bulk-locate', 'workspace-locate-nearby', 'workspace-reopen',
    'discard-subset', 'discard-deletion', 'discard-stale-review', 'discard-large', 'discard-limit', 'submodule-initialize', 'submodule-update', 'stash-selection', 'patch-export',
    'tracked-file-search', 'file-menu-copy', 'reference-copy', 'feature-rebase', 'comparison-responsiveness', 'merge-rebase-review', 'commit-rewrite', 'commit-responsiveness', 'file-review-scope', 'repository-creation-scope',
    'first-status', 'working-tree-recaps', 'repository-open-scope', 'detached-checkout', 'checkout-snapshot', 'checkout-responsiveness', 'history-control-responsiveness',
    'local-mutation-responsiveness'],
  'ubuntu:26.04': ['smoke', 'gitlab', 'gitlab-connect-refused', 'worktrees'],
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
  assert.equal(complete.checks.length, Object.values(requiredMatrix).flat().length);
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

test('installed discard needs both actions, exact direct selection, recovery of a deletion, and safe refusals', () => {
  const fixtures = matrixFixtures();
  for (const [suite, scenario] of [
    ['discard-subset', 'native-ui-direct-selection-discards-only-reviewed-path-and-undo-restores-bytes'],
    ['discard-subset', 'native-ui-nested-tracked-discard-restores-index-and-undo-restores-working-bytes'],
    ['discard-subset', 'native-ui-single-nested-file-discard-and-undo-preserve-index-and-head'],
    ['discard-deletion', 'native-ui-nested-deletion-discards-undoes-and-redoes-without-changing-index'],
    ['discard-deletion', 'native-text-undo-does-not-restore-discarded-repository-file'],
    ['discard-deletion', 'native-ui-trash-discards-nested-untracked-file-and-undo-restores-it'],
    ['discard-deletion', 'native-palette-previews-all-unstaged-and-cancels-without-checkout-changes'],
    ['discard-stale-review', 'native-ui-single-discard-refuses-newer-working-edit-without-capture'],
    ['discard-stale-review', 'native-ui-fresh-single-discard-after-stale-review-can-undo-newer-edit'],
    ['discard-stale-review', 'native-ui-refused-keyboard-discard-returns-focus-and-keeps-files'],
    ['discard-large', 'native-ui-discards-and-recovers-four-large-nested-untracked-files'],
    ['discard-large', 'native-large-discard-capture-survives-restart-and-recovers-exact-bytes'],
    ['discard-limit', 'native-oversized-nested-file-gets-size-specific-refusal-without-mutation'],
    ['discard-limit', 'native-oversized-nested-bulk-gets-size-specific-refusal-without-mutation'],
    ['discard-limit', 'native-palette-restores-opener-after-oversized-bulk-discard-refusal'],
    ['discard-limit', 'native-mixed-discard-labels-oversized-paths-and-leaves-all-files-unchanged'],
  ]) {
    const partial = fixtures.map(report => report.suite === suite
      ? { ...report, scenarios: report.scenarios.filter(name => name !== scenario) }
      : report);
    const matrix = summarizeReleaseMatrix(partial);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), [suite]);
  }
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
  const progress = summarizeReleaseProgress(matrix, validated);
  assert.equal(progress.totalChecks, matrix.checks.length);
  assert.deepEqual(progress.counts, {
    satisfied: matrix.checks.length - 3, failed: 1, incomplete: 1, 'awaiting-report': 1,
  });
  assert.deepEqual(progress.checks.slice(0, 4).map(check => check.state),
    ['satisfied', 'failed', 'incomplete', 'awaiting-report']);
  assert.deepEqual(progress.failedReports, ['previous-failed-report.json', failed.path]);
  assert.equal(progress.checks[0].report, passed.path);
  assert.equal(progress.checks[3].report, null);
  assert.deepEqual(progress.checks[2].closestPassingReport, {
    report: incomplete.path, inheritedGitEnvironmentMatches: true, missingScenarios: incomplete.scenarios,
  });
});

test('release progress explains why a passing receipt cannot replace an earlier failed gate', () => {
  const fixtures = matrixFixtures();
  const environment = fixtures.find(report => report.suite === 'environment');
  const reports = [
    { ...environment, path: 'old-failure/report.json', passed: false },
    { ...environment, path: 'wrong-context/report.json', inheritedGitEnvironment: false },
    { ...environment, path: 'unsigned/report.json', scenarios: environment.scenarios.slice(1) },
  ];
  const matrix = summarizeReleaseMatrix(reports);
  const check = summarizeReleaseProgress(matrix, reports)
    .checks.find(item => item.suite === 'environment');
  assert.equal(check.state, 'failed');
  assert.equal(check.report, null);
  assert.deepEqual(check.closestPassingReport, {
    report: 'unsigned/report.json', inheritedGitEnvironmentMatches: true, missingScenarios: environment.scenarios.slice(0, 1),
  });
});

test('isolated release checks require proof of isolated Git configuration', () => {
  const fixtures = matrixFixtures();
  const isolated = fixtures.find(report => report.suite === 'discard-subset');
  const other = fixtures.filter(report => report !== isolated);
  for (const inheritedGitEnvironment of [true, undefined]) {
    const wrong = { ...isolated, inheritedGitEnvironment, path: 'wrong-context/report.json' };
    const reports = [...other, wrong, { ...wrong, path: 'wrong-context-failure/report.json', passed: false }];
    const matrix = summarizeReleaseMatrix(reports);
    assert.equal(matrix.complete, false);
    const check = summarizeReleaseProgress(matrix, reports).checks.find(item => item.suite === isolated.suite);
    assert.equal(check.state, 'incomplete');
    assert.deepEqual(check.closestPassingReport, {
      report: wrong.path, inheritedGitEnvironmentMatches: false, missingScenarios: [],
    });
    assert.equal(summarizeReleaseMatrix([...reports, isolated]).complete, true);
  }
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
    inheritedGitEnvironment: first.inheritedGitEnvironment ?? false,
    scenarios: first.requiredScenarios, packageSha256: packageEvidence.packageSha256,
    executableSha256: packageEvidence.installedPayload.executableSha256,
    installedDesktopEntry: { ...report.installedDesktopEntry, sha256: packageEvidence.installedPayload.desktopEntrySha256 },
  };
  const paths = Object.fromEntries(['passing', 'wrong', 'malformed', 'failed', 'partial'].map(name => [name, join(root, `${name}.json`)]));
  await writeFile(paths.passing, JSON.stringify(passing));
  await writeFile(paths.wrong, JSON.stringify({
    ...passing, suite: second.suite, linuxDistribution: second.distribution,
    inheritedGitEnvironment: second.inheritedGitEnvironment ?? false,
    scenarios: second.requiredScenarios, packageSha256: '0'.repeat(64),
  }));
  await writeFile(paths.malformed, 'untrusted text that cannot be decoded');
  await writeFile(paths.failed, JSON.stringify({ ...passing, passed: false, scenarios: [] }));
  await writeFile(paths.partial, JSON.stringify({ ...passing, suite: second.suite,
    inheritedGitEnvironment: second.inheritedGitEnvironment ?? false, scenarios: ['other-scenario'] }));
  const cli = fileURLToPath(new URL('./report-installed-acceptance.mjs', import.meta.url));
  const run = (mode, ...paths) =>
    spawnSync(process.execPath, [cli, mode, artifact, ...paths], { encoding: 'utf8' });
  const progress = run('--release-progress', paths.wrong, paths.passing, paths.malformed, paths.failed, paths.partial);
  assert.equal(progress.status, 1);
  assert.equal(progress.stderr, '');
  const result = JSON.parse(progress.stdout);
  assert.equal(result.kind, 'installed-release-progress');
  assert.equal(result.sha256, packageEvidence.packageSha256);
  assert.deepEqual(result.reports.map(row => row.path), [paths.passing, paths.failed, paths.partial]);
  assert.deepEqual(result.releaseProgress.failedReports, [paths.failed]);
  assert.equal(result.releaseProgress.counts.satisfied, 1);
  assert.equal(result.releaseProgress.checks[0].report, paths.passing);
  assert.equal(result.releaseProgress.checks[1].report, null);
  assert.deepEqual(result.releaseProgress.checks[1].closestPassingReport, {
    report: paths.partial, inheritedGitEnvironmentMatches: true, missingScenarios: second.requiredScenarios,
  });
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

  await t.test('a lane retry uses only exact, passing installed evidence with all required scenarios', async () => {
    const jammy = summarizeReleaseMatrix([]).checks.filter(check => check.distribution.versionId === '22.04');
    const directory = join(root, 'retained');
    const writeReport = async (suite, overrides = {}) => {
      const check = jammy.find(check => check.suite === suite);
      const dir = join(directory, suite);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'report.json'), JSON.stringify({
        ...passing, suite, scenarios: check.requiredScenarios,
        inheritedGitEnvironment: check.inheritedGitEnvironment ?? false, ...overrides,
      }));
    };
    const retry = (...inputs) => spawnSync(process.execPath, [
      cli, '--plan-release-lane', 'ubuntu', '22.04', artifact, ...inputs,
    ], { encoding: 'utf8' });
    await writeReport('gitlab', { passed: false });
    await writeReport('watcher-refresh', { scenarios: jammy.find(({ suite }) => suite === 'watcher-refresh').requiredScenarios.slice(0, 1) });
    await writeReport('environment', { inheritedGitEnvironment: false });
    await writeReport('lfs-counts', { linuxDistribution: { id: 'ubuntu', versionId: '24.04' } });
    const result = retry(paths.passing, '--reports-dir', directory);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseFocusedAcceptance(JSON.parse(result.stdout)).map(check => check.suite),
      jammy.slice(1).map(check => check.suite));
    const focused = spawnSync(process.execPath, [
      cli, '--plan-release-lane', 'ubuntu', '22.04', '--suite', 'smoke', '--suite', 'environment',
      artifact, paths.passing, '--reports-dir', directory,
    ], { encoding: 'utf8' });
    assert.equal(focused.status, 0, focused.stderr);
    assert.deepEqual(parseFocusedAcceptance(JSON.parse(focused.stdout)).map(({ suite, inheritedGitEnvironment }) =>
      [suite, inheritedGitEnvironment]), [['environment', true]]);
    for (const [file, diagnostic] of [[paths.wrong, /different Debian package/], [paths.malformed, /Invalid JSON/]]) {
      const bad = retry(file);
      assert.equal(bad.status, 1);
      assert.equal(bad.stdout, '');
      assert.match(bad.stderr, diagnostic);
    }
    for (const { suite } of jammy.slice(1)) await writeReport(suite);
    const complete = retry(paths.passing, '--reports-dir', directory);
    assert.equal(complete.status, 0, complete.stderr);
    assert.deepEqual(JSON.parse(complete.stdout), { version: 1, checks: [] });
    const notRelease = run('--release-matrix', paths.passing, '--reports-dir', directory);
    assert.equal(notRelease.status, 1);
    assert.equal(JSON.parse(notRelease.stdout).releaseMatrix.complete, false);
  });
});

test('local release checks include every installed Ubuntu 24.04 workflow review required by CI', () => {
  const workflow = readFileSync(new URL('../.github/workflows/linux-package-acceptance.yml', import.meta.url), 'utf8');
  const lanes = ['workspace-review', 'file-review', 'history-review'];
  const include = workflow.match(/include: >-\r?\n\s+\$\{\{ fromJSON\(inputs\.expect-update-trust\s+&& '([^']+)'\s+\|\| '([^']+)'\) \}\}/);
  assert.ok(include, 'Missing conditional acceptance lane expansion');
  const noble = lanes.map(lane => ({ ubuntu: '24.04', lane }));
  assert.deepEqual(JSON.parse(include[1]), [...noble, { ubuntu: '22.04', lane: 'publisher' }]);
  assert.deepEqual(JSON.parse(include[2]), noble);
  const steps = [...workflow.matchAll(/- name: Verify installed workspace and Git workflow reviews \([^)]+\)\r?\n([\s\S]*?)(?=      - name:)/g)];
  assert.equal(steps.length, lanes.length);
  const plans = steps.map(([, step], index) => {
    assert.match(step, /matrix\.ubuntu == '24\.04'/);
    assert.ok(step.includes(`matrix.lane == '${lanes[index]}'`));
    const plan = step.match(/run: >-\r?\n\s+bash tools\/run-native-suites\.sh "\$PACKAGE"\s+([\s\S]+)$/)?.[1];
    assert.ok(plan, 'Missing the installed suite batch plan');
    return plan.trim().split(/\s+/);
  });
  const consent = workflow.match(/- name: Verify installed update consent without external networking\r?\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(consent, 'Missing CI update-consent step');
  assert.match(consent, /inputs\.expect-update-trust && matrix\.ubuntu == '24\.04'/);
  assert.match(consent, /sudo unshare --net/);
  const consentSuite = consent.match(/--suite (application-update-consent) --headless --installed/)?.[1];
  assert.ok(consentSuite, 'Missing installed update-consent suite');
  assert.match(consent, /matrix\.lane == 'runtime'/);
  const ciSuites = [consentSuite, ...plans.flat()];
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
  const identities = new Set();
  for (const { distribution, suite, inheritedGitEnvironment, requiredScenarios } of declared.checks) {
    const identity = `${distribution.id}:${distribution.versionId}:${suite}:${!!inheritedGitEnvironment}`;
    assert.ok(!identities.has(identity), `Duplicate release lane: ${identity}`);
    identities.add(identity);
    assert.ok(requiredScenarios.length > 0, `No required scenario for ${identity}`);
    assert.equal(new Set(requiredScenarios).size, requiredScenarios.length, `Duplicate required scenario in ${identity}`);
  }
  const mixed = spawnSync(process.execPath, [cli, '--list-release-matrix', 'installer.deb'], { encoding: 'utf8' });
  assert.equal(mixed.status, 1);
  assert.equal(mixed.stdout, '');
  assert.match(mixed.stderr, /Usage:/);
});

test('installed Ubuntu 26.04 review suites match the release verifier plan', () => {
  const workflow = readFileSync(new URL('../.github/workflows/linux-package-acceptance.yml', import.meta.url), 'utf8');
  const step = workflow.match(/- name: Verify installed GitLab refusal and occupied branch handling\r?\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(step, 'Missing Ubuntu 26.04 review step');
  assert.match(step, /matrix\.ubuntu == '26\.04'/);
  const plan = step.match(/run: bash tools\/run-native-suites\.sh "\$PACKAGE" (.+)/)?.[1];
  assert.ok(plan, 'Missing the installed suite batch plan');
  const localSuites = summarizeReleaseMatrix([]).checks.filter(check =>
    check.distribution.id === 'ubuntu' && check.distribution.versionId === '26.04' &&
    !['smoke', 'gitlab'].includes(check.suite)).map(check => check.suite);
  assert.deepEqual(localSuites, plan.trim().split(/\s+/));
});

test('each supported release distribution produces a runnable focused plan without a package', () => {
  const cli = fileURLToPath(new URL('./report-installed-acceptance.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, '--plan-release-lane', ...args], { encoding: 'utf8' });
  const matrix = summarizeReleaseMatrix([]).checks;
  for (const key of Object.keys(requiredMatrix)) {
    const [id, versionId] = key.split(':');
    const result = run(id, versionId);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseFocusedAcceptance(JSON.parse(result.stdout)), matrix.filter(check =>
      check.distribution.id === id && check.distribution.versionId === versionId
    ).map(({ report, inheritedGitEnvironment = false, ...check }) => ({ ...check, inheritedGitEnvironment })));
  }
  const selected = run('ubuntu', '24.04', '--suite', 'working-tree-recaps', '--suite', 'discard-large');
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(parseFocusedAcceptance(JSON.parse(selected.stdout)).map(({ suite }) => suite),
    ['discard-large', 'working-tree-recaps']);
  for (const [args, diagnostic] of [
    [['ubuntu', '24.04', '--suite'], /distinct native suite name/],
    [['ubuntu', '24.04', '--suite', 'smoke', '--suite', 'smoke'], /distinct native suite name/],
    [['ubuntu', '24.04', '--suite', 'worktrees'], /not required on ubuntu 24.04/],
    [['debian', '24.04'], /Unsupported release distribution/],
    [['ubuntu'], /Usage:/],
    [['ubuntu', '24.04', '--reports-dir', 'results'], /Usage:/],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, diagnostic);
  }
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

test('the installed tracked-file review needs all five search and history behaviors', () => {
  const fixtures = matrixFixtures();
  const search = fixtures.find(report => report.suite === 'tracked-file-search');
  assert.deepEqual(search.scenarios, [
    'native-tracked-file-search-uses-distinct-unmerged-paths-before-the-result-limit',
    'native-tracked-file-palette-keeps-one-history-and-blame-per-path-without-changing-merge-state',
    'native-file-history-copies-deleted-path-without-git-mutation',
    'native-file-history-long-subject-keeps-copy-actions-visible',
    'native-file-history-copies-full-commit-id-without-git-mutation',
    'native-file-history-clears-copied-path-feedback-on-starting-revision-change',
    'native-file-history-selects-tag-branch-and-commit-start-points-and-restores-diff-revision',
    'native-file-history-opens-a-deleted-literal-path-and-its-removal-diff',
  ]);
  for (const scenario of search.scenarios) {
    const partial = { ...search, scenarios: search.scenarios.filter(name => name !== scenario) };
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

test('the installed commit gate requires responsiveness for all three editing paths', () => {
  const fixtures = matrixFixtures();
  const responsive = fixtures.find(report => report.suite === 'commit-responsiveness');
  for (const scenario of [
    'native-commit-and-amend-do-not-block-unrelated-native-status-or-include-unstaged-data',
    'native-message-only-amend-keeps-status-responsive-and-preserves-index',
    'native-ancestor-edit-keeps-status-responsive-and-preserves-trees-and-staging',
  ]) {
    const partial = fixtures.map(report => report === responsive
      ? { ...report, scenarios: report.scenarios.filter(name => name !== scenario) } : report);
    const matrix = summarizeReleaseMatrix(partial);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite),
      ['commit-responsiveness']);
  }
});

test('GitLab evidence must cover fork restart and both initial and stale navigation', () => {
  const fixtures = matrixFixtures();
  const forkRestart = 'native-gitlab-fork-lost-reply-private-outcome-survives-real-process-restart-without-credential-or-post-replay';
  const staleNavigation = 'native-webdriver-explicit-stale-refusal-clicks-only-the-owned-replacement';
  const initialNavigation = 'native-webdriver-initial-navigation-ignores-disabled-duplicate';
  for (const gitlab of fixtures.filter(report => report.suite === 'gitlab')) {
    const required = [forkRestart, staleNavigation, initialNavigation];
    if (gitlab.linuxDistribution.id === 'ubuntu' && gitlab.linuxDistribution.versionId === '26.04') {
      required.push('native-webdriver-waits-for-delayed-navigation-and-clicks-once');
    }
    for (const missing of required) {
      const partial = { ...gitlab, scenarios: gitlab.scenarios.filter(scenario => scenario !== missing) };
      // Reported success on this and every other platform is not a substitute.
      const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== gitlab), partial]);
      assert.equal(matrix.complete, false);
      assert.deepEqual(matrix.checks.filter(check => check.report === null).map(({ distribution, suite }) => ({
        distribution, suite,
      })), [{ distribution: gitlab.linuxDistribution, suite: 'gitlab' }]);
    }
  }
});

test('a successful GitLab connection does not substitute for installed TCP-refusal coverage', () => {
  const fixtures = matrixFixtures();
  const refusal = fixtures.find(report => report.suite === 'gitlab-connect-refused');
  const successfulConnect = 'native-gitlab-explicit-connect-verified-private-tls-native-account-and-cleared-token';
  for (const replacement of [
    { ...refusal, scenarios: [successfulConnect] },
    { ...refusal, linuxDistribution: { id: 'ubuntu', versionId: '24.04' } },
    { ...refusal, passed: false },
  ]) {
    const matrix = summarizeReleaseMatrix(fixtures.map(report => report === refusal ? replacement : report));
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite),
      ['gitlab-connect-refused']);
  }
});

test('release consent evidence must cover manual checks and both opt-in and opt-out after restart', () => {
  const fixtures = matrixFixtures();
  const consent = fixtures.find(report => report.suite === 'application-update-consent');
  assert.equal(consent.scenarios.length, 3);
  for (const omitted of consent.scenarios) {
    const partial = { ...consent, scenarios: consent.scenarios.filter(item => item !== omitted) };
    const matrix = summarizeReleaseMatrix(fixtures.map(report => report === consent ? partial : report));
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['application-update-consent']);
  }
});

test('release worktree evidence must prove occupied-branch review, navigation and stale refusal', () => {
  const fixtures = matrixFixtures();
  const worktrees = fixtures.find(report => report.suite === 'worktrees');
  assert.deepEqual(worktrees.scenarios, [
    'native-occupied-branch-review-cancel-preserves-both-dirty-checkouts',
    'native-occupied-branch-navigation-opens-registered-owner-without-checkout-or-data-loss',
    'native-occupied-branch-graph-double-click-opens-registered-owner-without-detaching-head',
    'native-occupied-dev-graph-double-click-returns-from-linked-to-primary-checkout',
    'native-occupied-branch-review-refuses-changed-owner-without-fallback-checkout',
  ]);
  for (const omitted of worktrees.scenarios) {
    const partial = { ...worktrees, scenarios: worktrees.scenarios.filter(item => item !== omitted) };
    const matrix = summarizeReleaseMatrix(fixtures.map(report => report === worktrees ? partial : report));
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['worktrees']);
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
    'native-first-file-scan-drains-large-diagnostics-without-blocking-status',
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

test('release evidence must cover updater consent, keyboard recovery, discard and external file tools', () => {
  const fixtures = matrixFixtures();
  for (const [suite, scenario] of [
    ['environment', 'native-updates-tab-recovers-to-first-or-last-action-without-changing-git'],
    ['environment', 'native-updates-automatic-setting-describes-download-and-install-consent'],
    ['environment', 'native-occupied-branch-review-wraps-shift-tab-without-navigating'],
    ['environment', 'native-shortcut-reference-wraps-shift-tab-without-changing-git-or-draft'],
    ['environment', 'native-ui-file-diff-exact-index-working-private-bytes-literal-argv-sanitized-context'],
    ['environment', 'native-ui-file-merge-stage-roles-binary-output-review-save-without-staging'],
    ['environment', 'native-ui-file-merge-separate-reviewed-real-index-staging-and-private-cleanup'],
    ['discard-subset', 'native-discard-review-wraps-shift-tab-without-applying-the-preview'],
    ['working-tree-recaps', 'native-discard-picker-explains-collapsed-and-filtered-out-files-without-writes'],
  ]) {
    const older = fixtures.map(report => report.suite === suite
      ? { ...report, scenarios: report.scenarios.filter(name => name !== scenario) } : report);
    const matrix = summarizeReleaseMatrix(older);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), [suite]);
  }
});

test('release evidence must prove stash branch restoration preserves ignored local files and the stash', () => {
  const fixtures = matrixFixtures();
  const environment = fixtures.find(report => report.suite === 'environment');
  for (const name of [
    'native-stash-branch-refuses-ignored-obstruction-before-creating-branch',
    'native-reviewed-stash-branch-retains-exact-saved-state-and-source',
  ]) {
    const incomplete = { ...environment, scenarios: environment.scenarios.filter(scenario => scenario !== name) };
    const result = summarizeReleaseMatrix(fixtures.map(report => report === environment ? incomplete : report));
    assert.equal(result.complete, false);
    assert.deepEqual(result.checks.filter(check => check.report === null).map(check => check.suite), ['environment']);
  }
});

test('file path copy evidence does not substitute for full Git ref clipboard verification', () => {
  for (const scenarios of [
    ['native-working-file-menu-copies-literal-path-without-git-mutation'],
    ['native-ui-copies-ambiguous-local-remote-and-tag-namespaces-without-git-mutation'],
    ['native-ui-full-ref-keyboard-copy-restores-branch-focus'],
  ]) {
    const partial = matrixFixtures().map(report => report.suite === 'reference-copy'
      ? { ...report, scenarios } : report);
    const matrix = summarizeReleaseMatrix(partial);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['reference-copy']);
  }
});

test('generic nested discard evidence does not substitute for the CTI path regressions', () => {
  const fixtures = matrixFixtures();
  for (const [suite, regression] of [
    ['discard-subset', 'native-ui-nested-lockfile-discard-preserves-index-and-sibling-edit'],
    ['discard-large', 'native-cti-data-paths-and-sizes-recover-unchanged-after-restart'],
    ['discard-large', 'native-cti-sized-bulk-discard-skips-and-preserves-staged-only-file'],
  ]) {
    const older = fixtures.map(report => report.suite === suite
      ? { ...report, scenarios: report.scenarios.filter(name => name !== regression) } : report);
    const matrix = summarizeReleaseMatrix(older);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), [suite]);
  }
});

test('installed local mutations need stash and commit replay responsiveness evidence', () => {
  const fixtures = matrixFixtures();
  const mutations = fixtures.find(report => report.suite === 'local-mutation-responsiveness');
  for (const scenario of [
    'native-stash-save-apply-and-pop-keep-status-responsive-and-restore-owned-bytes',
    'native-cherry-pick-and-revert-keep-status-responsive-and-preserve-exact-history',
  ]) {
    assert.ok(mutations.scenarios.includes(scenario));
    const partial = { ...mutations, scenarios: mutations.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== mutations), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['local-mutation-responsiveness']);
  }
});

test('installed history controls must prove both interactive rebase and merge responsiveness', () => {
  const fixtures = matrixFixtures();
  const control = fixtures.find(report => report.suite === 'history-control-responsiveness');
  for (const scenario of [
    'native-interactive-review-replay-continue-and-abort-leave-status-responsive',
    'native-merge-continue-and-abort-leave-status-responsive-and-preserve-reviewed-history',
  ]) {
    assert.ok(control.scenarios.includes(scenario));
    const partial = { ...control, scenarios: control.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== control), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['history-control-responsiveness']);
  }
});

test('installed checkout safety and coherent snapshots cannot substitute responsiveness evidence', () => {
  const fixtures = matrixFixtures();
  const checkout = fixtures.find(report => report.suite === 'checkout-responsiveness');
  assert.deepEqual(checkout.scenarios, ['native-local-remote-and-detached-checkouts-keep-native-status-responsive']);
  const matrix = summarizeReleaseMatrix(fixtures.filter(report => report !== checkout));
  assert.equal(matrix.complete, false);
  assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['checkout-responsiveness']);
});

test('installed comparison evidence cannot substitute commit comparisons for branch comparisons', () => {
  const fixtures = matrixFixtures();
  const comparison = fixtures.find(report => report.suite === 'comparison-responsiveness');
  for (const missing of [
    'native-branch-comparison-keeps-native-status-responsive-and-preserves-checkout',
    'native-git-comparisons-do-not-block-unrelated-native-status-and-preserve-worktree',
  ]) {
    assert.ok(comparison.scenarios.includes(missing));
    const partial = { ...comparison, scenarios: comparison.scenarios.filter(name => name !== missing) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== comparison), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['comparison-responsiveness']);
  }
});

test('installed merge-preserving rebase must prove review, stale refusal, execution, and responsiveness', () => {
  const fixtures = matrixFixtures();
  const review = fixtures.find(report => report.suite === 'merge-rebase-review');
  for (const scenario of [
    'native-slow-merge-rebase-review-dismisses-before-git-finishes-without-writes',
    'native-merge-preserving-review-shows-exact-parents-and-cancel-leaves-checkout-unchanged',
    'native-merge-preserving-rebase-refuses-stale-destination-before-writing',
    'native-merge-preserving-rebase-keeps-topology-sibling-refs-and-protects-original-tip',
    'native-merge-preserving-rebase-leaves-native-status-responsive',
  ]) {
    assert.ok(review.scenarios.includes(scenario));
    const partial = { ...review, scenarios: review.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== review), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['merge-rebase-review']);
  }
});

test('installed recaps must prove distinct diff sides and independent line budgets', () => {
  const fixtures = matrixFixtures();
  const recaps = fixtures.find(report => report.suite === 'working-tree-recaps');
  for (const scenario of [
    'native-working-tree-same-path-selects-each-index-side-from-its-tree-row',
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
    'native-stage-all-reaches-unstaged-files-beyond-initial-status-page',
    'native-unstage-all-reaches-staged-files-beyond-initial-status-page',
    'native-expanded-unstaged-list-reaches-both-keyboard-edges-without-writes',
    'native-expanded-unstaged-scroll-jumps-keep-offset-and-visible-rows-without-writes',
    'native-final-working-tree-page-restores-keyboard-focus-without-changing-checkout',
    'native-unstaged-recap-survives-status-byte-bound-without-counting-conflicts',
    'native-stage-and-unstage-preserve-executable-mode-change-and-exact-binary-bytes',
    'native-stage-and-unstage-gitlink-without-changing-dirty-submodule',
  ]) {
    assert.ok(recaps.scenarios.includes(scenario));
    const priorEvidence = { ...recaps, scenarios: recaps.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== recaps), priorEvidence]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['working-tree-recaps']);
  }
});

test('installed LFS counts must prove positive and measured-zero UI states', () => {
  const fixtures = matrixFixtures();
  const counts = fixtures.find(report => report.suite === 'lfs-counts');
  for (const scenario of [
    'native-lfs-preferences-show-tracked-and-pointer-counts-without-writes',
    'native-lfs-toolbar-menu-and-preferences-agree-on-measured-zero-without-writes',
  ]) {
    assert.ok(counts.scenarios.includes(scenario));
    const partial = { ...counts, scenarios: counts.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== counts), partial]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['lfs-counts']);
  }
});

test('installed LFS timeout evidence covers discovery, listing, toolbar, and review preflight', () => {
  const fixtures = matrixFixtures();
  const timeout = fixtures.find(report => report.suite === 'lfs-snapshot-timeout');
  for (const scenario of [
    'native-lfs-stalled-listing-does-not-block-opening-or-invent-counts',
    'native-lfs-toolbar-distinguishes-unknown-count-and-keeps-pull-available',
    'native-lfs-stalled-attribute-discovery-shares-snapshot-deadline',
    'native-lfs-object-review-times-out-stalled-version-preflight-without-writes',
    'native-lfs-pull-refuses-stalled-eligibility-before-any-transfer',
    'native-lfs-pull-cancels-active-eligibility-before-any-transfer',
  ]) {
    assert.ok(timeout.scenarios.includes(scenario));
    const older = { ...timeout, scenarios: timeout.scenarios.filter(name => name !== scenario) };
    const matrix = summarizeReleaseMatrix([...fixtures.filter(report => report !== timeout), older]);
    assert.equal(matrix.complete, false);
    assert.deepEqual(matrix.checks.filter(check => check.report === null).map(check => check.suite), ['lfs-snapshot-timeout']);
  }
});

test('installed stash qualification requires whole-checkout scope, pagination, and both restore collision checks', () => {
  const fixtures = matrixFixtures();
  const stash = fixtures.find(report => report.suite === 'stash-selection');
  for (const scenario of [
    'native-whole-checkout-stash-only-saves-untracked-files-when-included',
    'native-stash-selection-loads-more-files-and-saves-only-explicit-paths',
    'native-stash-path-filter-keeps-hidden-selection-in-exact-stash',
    'native-stash-select-matching-adds-only-filtered-loaded-paths',
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
      'native-updates-tab-recovers-to-first-or-last-action-without-changing-git',
      'native-updates-automatic-setting-describes-download-and-install-consent',
      'native-ui-file-diff-exact-index-working-private-bytes-literal-argv-sanitized-context',
      'native-ui-file-merge-stage-roles-binary-output-review-save-without-staging',
      'native-ui-file-merge-separate-reviewed-real-index-staging-and-private-cleanup',
      'native-saved-repository-paths-survive-workspace-switch-and-support-retry-and-removal',
      'native-worktree-and-branch-removal-requires-recovery-before-removing-checkout',
      'native-occupied-branch-review-cancel-preserves-both-dirty-checkouts',
      'native-occupied-branch-review-wraps-shift-tab-without-navigating',
      'native-shortcut-reference-wraps-shift-tab-without-changing-git-or-draft',
      'native-occupied-branch-navigation-opens-registered-owner-without-checkout-or-data-loss',
      'native-occupied-branch-graph-double-click-opens-registered-owner-without-detaching-head',
      'native-occupied-branch-review-refuses-changed-owner-without-fallback-checkout',
      'native-ordinary-and-background-fetch-refuse-local-branch-refspecs',
      'native-stash-branch-refuses-ignored-obstruction-before-creating-branch',
      'native-reviewed-stash-branch-retains-exact-saved-state-and-source',
    ]],
  ]) {
    const full = fixtures.find(report => report.suite === suite);
    assert.deepEqual(full.scenarios, milestones);
    const split = milestones.map((scenario, index) => ({ ...full, path: `${index}/report.json`, scenarios: [scenario] }));
    const outcome = summarizeReleaseMatrix([...fixtures.filter(report => report !== full), ...split]);
    assert.equal(outcome.complete, false);
    assert.deepEqual(outcome.checks.filter(check => check.report === null).map(check => check.suite), [suite]);
    for (const missing of milestones) {
      const partial = { ...full, scenarios: full.scenarios.filter(name => name !== missing) };
      assert.equal(summarizeReleaseMatrix([...fixtures.filter(report => report !== full), partial]).complete, false);
    }
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
