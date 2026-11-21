import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const installer = join(dirname(fileURLToPath(import.meta.url)), '..', 'install.sh');
const architecture = execFileSync('dpkg', ['--print-architecture'], { encoding: 'utf8' }).trim();
let root;

function buildPackage(name, packageName = 'git-khronos', depends = '') {
  const tree = join(root, `tree-${name}`);
  mkdirSync(join(tree, 'DEBIAN'), { recursive: true });
  writeFileSync(join(tree, 'DEBIAN', 'control'), [
    `Package: ${packageName}`, 'Version: 0.1.0', `Architecture: ${architecture}`,
    'Maintainer: Installer Test <test@example.invalid>', 'Description: installer fixture',
    ...(depends ? [`Depends: ${depends}`] : []), '',
  ].join('\n'));
  const output = join(root, `${name}.deb`);
  execFileSync('dpkg-deb', ['--root-owner-group', '--build', tree, output], { stdio: 'ignore' });
  return output;
}

function publish(directory, packageFile, checksum) {
  mkdirSync(directory, { recursive: true });
  const asset = `Git-Khronos_0.1.0_${architecture}.deb`;
  const body = readFileSync(packageFile);
  writeFileSync(join(directory, asset), body);
  const digest = checksum ?? createHash('sha256').update(body).digest('hex');
  writeFileSync(join(directory, 'SHA256SUMS'), `${digest}  ${asset}\n`);
}

function run(args, releases = join(root, 'releases')) {
  return spawnSync('bash', [installer, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_KHRONOS_RELEASE_BASE_URL: `file://${releases}` },
  });
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'git-khronos-installer-'));
  const valid = buildPackage('valid');
  publish(join(root, 'releases', 'latest', 'download'), valid);
  publish(join(root, 'releases', 'download', 'v0.1.0'), valid);
  publish(join(root, 'tampered', 'latest', 'download'), valid, '0'.repeat(64));
});

after(() => rmSync(root, { recursive: true, force: true }));

test('verifies the latest release checksum and only simulates in dry-run mode', () => {
  const result = run(['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Verified SHA-256 [0-9a-f]{64}/);
  assert.match(result.stdout, /Inst git-khronos/);
});

test('resolves an explicitly requested release version', () => {
  const result = run(['--version', 'v0.1.0', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Inst git-khronos/);
});

test('discards a download whose checksum does not match', () => {
  const result = run(['--dry-run'], join(root, 'tampered'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
  assert.doesNotMatch(result.stdout, /Inst /);
});

test('explains how to proceed when no release is published', () => {
  const result = run(['--dry-run'], join(root, 'missing'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no published release was found.*--from-source/);
});

test('refuses a local package that is not Git Khronos', () => {
  const result = run(['--deb', buildPackage('other', 'other-tool'), '--dry-run']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains 'other-tool', not git-khronos/);
});

test('accepts a local Git Khronos package', () => {
  const result = run(['--deb', join(root, 'valid.deb'), '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Inst git-khronos/);
});

test('checks the reviewed local digest before any APT simulation', () => {
  const file = join(root, 'valid.deb');
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  const accepted = run(['--deb', file, '--sha256', digest.toUpperCase(), '--dry-run']);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stderr, new RegExp(`Verified local SHA-256 ${digest}`));
  assert.match(accepted.stdout, /Inst git-khronos/);
  const mismatch = run(['--deb', file, '--sha256', '0'.repeat(64), '--dry-run']);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /local package checksum mismatch/);
  assert.doesNotMatch(mismatch.stdout, /Inst /);
  for (const args of [
    ['--sha256', digest], ['--deb', file, '--sha256', 'not-a-digest'],
    ['--deb', file, '--sha256'], ['--deb', file, '--sha256', digest, '--sha256', digest],
  ]) {
    const invalid = run([...args, '--dry-run']);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /--sha256/);
    assert.doesNotMatch(invalid.stdout, /Inst /);
  }
});

test('passes the verified private copy to APT, not the mutable source path', () => {
  const file = buildPackage('reviewed-snapshot');
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  const bin = join(root, 'reviewed-snapshot-bin');
  mkdirSync(bin);
  const apt = join(bin, 'apt-get');
  writeFileSync(apt, `#!/bin/sh
set -eu
[ "$3" = --simulate ] || [ "$4" = --simulate ] || exit 98
for staged do :; done
[ "$staged" != "$OWNED_SOURCE" ] || exit 99
printf '%s\\n' 'source replaced after verification' > "$OWNED_SOURCE"
sha256sum < "$staged"
printf '%s\\n' "$staged"
`);
  chmodSync(apt, 0o755);
  const result = spawnSync('bash', [installer, '--deb', file, '--sha256', digest, '--dry-run'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OWNED_SOURCE: file },
  });
  assert.equal(result.status, 0, result.stderr);
  const [observed, staged] = result.stdout.trimEnd().split('\n');
  assert.equal(observed.split(' ')[0], digest);
  assert.match(staged, /git-khronos-install\.[^/]+\/reviewed\.deb$/);
  assert.throws(() => readFileSync(staged), { code: 'ENOENT' });
  assert.equal(readFileSync(file, 'utf8'), 'source replaced after verification\n');
});

function gitPrerequisiteFixture(id, release) {
  const packageFile = buildPackage(`requires-newer-git-${id}-${release}`, 'git-khronos', 'git (>= 1:2.39)');
  const directory = join(root, `git-prerequisite-${id}-${release}`);
  const bin = join(directory, 'bin');
  mkdirSync(directory);
  mkdirSync(bin);
  const osRelease = join(directory, 'os-release');
  writeFileSync(osRelease, `ID=${id}\nVERSION_ID=${release}\n`);
  const script = join(directory, 'install.sh');
  writeFileSync(script, readFileSync(installer, 'utf8').replaceAll('/etc/os-release',
    "'" + osRelease.replaceAll("'", "'\\''") + "'"));
  const query = join(bin, 'dpkg-query');
  writeFileSync(query, `#!/bin/sh
case "$*" in
  *'git-khronos-desktop'*) exit 1 ;;
  *'git') printf '%s\\t%s' "$FIXTURE_GIT_STATE" "$FIXTURE_GIT_VERSION" ;;
  *) exit 99 ;;
esac
`);
  chmodSync(query, 0o755);
  const apt = join(bin, 'apt-get');
  writeFileSync(apt, `#!/bin/sh
case "$*" in
  *--simulate*) printf 'APT simulation\\n' ;;
  *) printf 'Fixture refuses a real APT operation\\n' >&2; exit 99 ;;
esac
`);
  chmodSync(apt, 0o755);
  return (state, version) => spawnSync('bash', [script, '--deb', packageFile, '--dry-run'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      FIXTURE_GIT_STATE: state, FIXTURE_GIT_VERSION: version },
  });
}

test('requires separately provisioned Git without asking APT to upgrade stock Jammy Git', () => {
  const run = gitPrerequisiteFixture('ubuntu', '22.04');
  for (const [state, version] of [
    ['', ''], ['installed', '1:2.34.1-1ubuntu1.18'], ['config-files', '1:2.53.0-1ubuntu1'],
  ]) {
    const result = run(state, version);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /separately provision a maintained newer Git/);
    assert.doesNotMatch(result.stdout, /APT simulation/);
  }
  const accepted = run('installed', '1:2.43.0-1ubuntu7');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /APT simulation/);
});

for (const [id, release] of [['ubuntu', '24.04'], ['ubuntu', '26.04'], ['debian', '12'], ['debian', '13']]) {
  test(`lets APT resolve Git on ${id} ${release}, whether Git is absent or already supported`, () => {
    const run = gitPrerequisiteFixture(id, release);
    for (const [state, version] of [
      ['', ''], ['installed', '1:2.43.0-1ubuntu7'], ['installed', '1:2.34.1-1ubuntu1.18'],
    ]) {
      const result = run(state, version);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /APT simulation/);
      assert.doesNotMatch(result.stderr, /separately provision/);
    }
  });
}

test('rejects conflicting and unknown options', () => {
  assert.match(run(['--deb', 'x.deb', '--uninstall']).stderr, /cannot be combined/);
  assert.match(run(['--frobnicate']).stderr, /unknown option '--frobnicate'/);
  assert.match(run(['--version', '1.0; rm -rf /']).stderr, /not a valid version/);
});
