import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeInstalledReport } from './report-installed-acceptance.mjs';

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
