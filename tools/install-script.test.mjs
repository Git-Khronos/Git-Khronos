import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const installer = join(dirname(fileURLToPath(import.meta.url)), '..', 'install.sh');
const architecture = execFileSync('dpkg', ['--print-architecture'], { encoding: 'utf8' }).trim();
let root;

function buildPackage(name, packageName = 'git-khronos') {
  const tree = join(root, `tree-${name}`);
  mkdirSync(join(tree, 'DEBIAN'), { recursive: true });
  writeFileSync(join(tree, 'DEBIAN', 'control'), [
    `Package: ${packageName}`, 'Version: 0.1.0', `Architecture: ${architecture}`,
    'Maintainer: Installer Test <test@example.invalid>', 'Description: installer fixture', '',
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

test('rejects conflicting and unknown options', () => {
  assert.match(run(['--deb', 'x.deb', '--uninstall']).stderr, /cannot be combined/);
  assert.match(run(['--frobnicate']).stderr, /unknown option '--frobnicate'/);
  assert.match(run(['--version', '1.0; rm -rf /']).stderr, /not a valid version/);
});
