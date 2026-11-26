import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEvidence, checkPublisherKeyConfiguration, qualifiedPackageDigest } from './check-debian-update-evidence.mjs';

const key = 'owned-test-verification-key';
const sha = '7'.repeat(64);
const receipt = {
  version: 1, outputs: { package: { sha256: sha } },
  buildConfiguration: { updaterPublicKeySha256: createHash('sha256').update(key).digest('hex') },
};
const report = {
  suite: 'environment', passed: true, packageSha256: sha,
  scenarios: [
    'native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer',
    'native-updates-automatic-setting-describes-download-and-install-consent',
  ],
  applicationUpdates: { nativeStatus: { packageFormat: 'deb', configured: true, automatic: false, offerId: null, canInstall: false } },
};

test('publisher preflight checks the same envelope and key format the updater consumes', () => {
  const encode = input => Buffer.from(input).toString('base64');
  const rawKey = algorithm => Buffer.concat([Buffer.from(algorithm), Buffer.alloc(40, 1)]);
  const minisign = (body, newline = '\n') => `untrusted comment: fixture${newline}${body}${newline}`;
  for (const algorithm of ['Ed', 'ED']) {
    for (const newline of ['\n', '\r\n']) {
      const good = encode(minisign(encode(rawKey(algorithm)), newline));
      assert.doesNotThrow(() => checkPublisherKeyConfiguration(good));
      assert.doesNotThrow(() => checkPublisherKeyConfiguration(good + '\n\n'));
    }
  }
  const valid = encode(minisign(encode(rawKey('Ed'))));
  for (const invalid of [
    undefined, '', ' \n', valid + ' ', valid.replace(/=+$/, '') + '!',
    minisign(encode(rawKey('Ed'))), encode('comment only'), encode(Buffer.from([0xff])),
    encode(minisign(encode(rawKey('XX')))), encode(minisign(encode(rawKey('Ed').subarray(0, 41)))),
    encode(minisign(' ' + encode(rawKey('Ed')))), 'A'.repeat(4097),
    encode('owned-incorrect-input-not-for-logs'),
  ]) {
    assert.throws(() => checkPublisherKeyConfiguration(invalid), /Base64 public \.key\.pub contents/);
  }
  const cli = value => spawnSync(process.execPath, [
    'tools/check-debian-update-evidence.mjs', '--check-publisher-key',
  ], { encoding: 'utf8', env: { ...process.env, GIT_KHRONOS_UPDATER_PUBLIC_KEY: value } });
  const accepted = cli(valid);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout + accepted.stderr, '');
  const refused = cli('owned-incorrect-input-not-for-logs');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /GIT_KHRONOS_UPDATER_PUBLIC_KEY/);
  assert.doesNotMatch(refused.stderr, /owned-incorrect-input-not-for-logs/);
  assert.equal(refused.stdout, '');
});

test('hosted release preflight only reads the official repository and requires a main-only branch rule', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-release-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publisher = Buffer.from(`untrusted comment: fixture\n${Buffer.concat([Buffer.from('Ed'), Buffer.alloc(40, 1)]).toString('base64')}\n`).toString('base64');
  await writeFile(join(root, 'gh'), `#!/bin/sh
set -e
[ "$#" = 6 ] && [ "$1 $2 $3 $4 $5" = 'api --hostname github.com --method GET' ] || exit 98
case "$6" in
  repos/Git-Khronos/Git-Khronos/releases/latest) echo '{"tag_name":"v0.1.5"}' ;;
  repos/Git-Khronos/Git-Khronos/git/ref/tags/v0.1.6)
    echo '{"ref":"refs/tags/v0.1.6","object":{"type":"tag"}}' ;;
  repos/Git-Khronos/Git-Khronos/actions/variables/GIT_KHRONOS_UPDATER_PUBLIC_KEY)
    printf '{"value":"%s"}\n' "$FIXTURE_PUBLISHER" ;;
  repos/Git-Khronos/Git-Khronos/actions/variables/GIT_KHRONOS_SIGNED_PUBLICATION_ENABLED)
    echo '{"value":"true"}' ;;
  repos/Git-Khronos/Git-Khronos/environments/signed-release)
    printf '%s\n' "$FIXTURE_ENVIRONMENT" ;;
  'repos/Git-Khronos/Git-Khronos/environments/signed-release/deployment-branch-policies?per_page=2')
    printf '%s\n' "$FIXTURE_RULES" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  const environment = {
    name: 'signed-release', protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }],
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
  };
  const check = (rules, overrides = {}, tags = []) => spawnSync('bash', ['tools/check-hosted-debian-release.sh', ...tags], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: `${root}:${process.env.PATH}`, FIXTURE_PUBLISHER: publisher,
      FIXTURE_ENVIRONMENT: JSON.stringify(environment),
      FIXTURE_RULES: JSON.stringify({ total_count: rules.length, branch_policies: rules }), ...overrides },
  });
  const main = { name: 'main', type: 'branch' };
  const valid = check([main]);
  assert.equal(valid.status, 0, valid.stderr + valid.stdout);
  assert.match(valid.stdout, /exactly one branch rule for main/);
  assert.equal((valid.stdout + valid.stderr).includes(publisher), false);
  const tagged = check([main], {}, ['v0.1.6']);
  assert.equal(tagged.status, 0, tagged.stderr + tagged.stdout);
  assert.match(tagged.stdout, /Requested tag exists: v0.1.6/);
  const missingTag = check([main], {}, ['v0.1.7']);
  assert.equal(missingTag.status, 1);
  assert.match(missingTag.stdout, /Not confirmed: requested tag v0.1.7/);
  assert.equal(check([main], {}, ['refs/heads/main']).status, 2);
  for (const rules of [[], [{ name: 'main' }], [{ ...main, type: 'tag' }], [main, { ...main, name: 'dev' }]]) {
    const rejected = check(rules);
    assert.equal(rejected.status, 1, rejected.stderr + rejected.stdout);
    assert.match(rejected.stdout, /Not confirmed: main-only/);
  }
  const malformedKey = 'owned-malformed-publisher-not-for-output';
  const invalid = check([main], { FIXTURE_PUBLISHER: malformedKey });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /Not confirmed: publisher public key/);
  assert.equal((invalid.stdout + invalid.stderr).includes(malformedKey), false);
  const unreadable = check([main], { FIXTURE_ENVIRONMENT: '' });
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.stdout, /Not confirmed: signed-release environment/);
});

test('signed release preparation rejects missing inventories before staging output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-stage-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  const prepare = tag => spawnSync('bash', [
    'tools/prepare-signed-debian-release.sh', root, 'report.json', 'public.key', 'package.sig', tag, output,
  ], { encoding: 'utf8' });
  assert.match(prepare('0.1.6').stderr, /Expected a release tag/);
  const missingPackage = prepare('v0.1.6');
  assert.equal(missingPackage.status, 1);
  assert.match(missingPackage.stderr, /release inventory: .*Git-Khronos_0\.1\.6_amd64\.cdx\.json/);
  await writeFile(join(root, 'Git-Khronos_0.1.6_amd64.cdx.json'), '{}\n');
  await writeFile(join(root, 'Git-Khronos_0.1.6_source.cdx.json'), '');
  const emptySource = prepare('v0.1.6');
  assert.equal(emptySource.status, 1);
  assert.match(emptySource.stderr, /release inventory: .*Git-Khronos_0\.1\.6_source\.cdx\.json/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('release preparation retains only verified assets and cleans up failed staging', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-stage-cleanup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'output');
  const bin = join(root, 'bin');
  await mkdir(output);
  await mkdir(bin);
  await writeFile(join(output, 'previous-release'), 'preserve\n');
  for (const name of ['amd64', 'source']) {
    await writeFile(join(root, `Git-Khronos_0.1.6_${name}.cdx.json`), '{}\n');
  }
  const installer = 'Git-Khronos_0.1.6_amd64.deb';
  const inventories = ['Git-Khronos_0.1.6_amd64.cdx.json', 'Git-Khronos_0.1.6_source.cdx.json'];
  await writeFile(join(root, installer), 'fixture installer\n');
  const checksums = spawnSync('sha256sum', [installer, ...inventories], { cwd: root, encoding: 'utf8' });
  assert.equal(checksums.status, 0, checksums.stderr);
  await writeFile(join(root, 'SHA256SUMS'), checksums.stdout);
  await writeFile(join(bin, 'node'), `#!/bin/sh\nprintf '%s\\n' '${sha}'\n`, { mode: 0o755 });
  await writeFile(join(bin, 'cargo'), `#!/bin/sh
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift
if [ "$1" = "--verify-release" ]; then
  [ "$VERIFY_SUCCEEDS" = "1" ] && exit 0
  echo 'Owned fixture refused staged assets' >&2
  exit 1
fi
dir="$4/staged"
mkdir "$dir"
cp "$1" "$dir/Git-Khronos_0.1.6_amd64.deb"
touch "$dir/latest.json" "$dir/update-assets.sha256"
if [ "$REPLACE_INVENTORY" = "1" ]; then
  printf '{"changed":true}\\n' > "$(dirname "$1")/Git-Khronos_0.1.6_source.cdx.json"
fi
printf '%s\\n' "$dir"
`, { mode: 0o755 });
  const prepare = (verify, replace = '0', parent = output) => spawnSync('bash', [
    'tools/prepare-signed-debian-release.sh', root, 'report.json', 'public.key', 'package.sig', 'v0.1.6', parent,
  ], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VERIFY_SUCCEEDS: verify, REPLACE_INVENTORY: replace } });
  await writeFile(join(root, inventories[1]), '{"changed":true}\n');
  const mismatched = prepare('1');
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stderr, /do not match the qualification artifact SHA256SUMS/);
  assert.equal(mismatched.stdout, '');
  assert.deepEqual(await readdir(output), ['previous-release']);
  await writeFile(join(root, inventories[1]), '{}\n');
  const missingOutput = join(root, 'not-created');
  for (const parent of [missingOutput, join(output, 'previous-release')]) {
    const refused = prepare('1', '0', parent);
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /existing writable output directory/);
    assert.equal(refused.stdout, '');
  }
  await assert.rejects(stat(missingOutput), { code: 'ENOENT' });
  const changedDuringStaging = prepare('1', '1');
  assert.equal(changedDuringStaging.status, 1);
  assert.match(changedDuringStaging.stderr, /changed after the qualification checksum check/);
  assert.equal(changedDuringStaging.stdout, '');
  assert.deepEqual(await readdir(output), ['previous-release']);
  await writeFile(join(root, inventories[1]), '{}\n');
  const result = prepare('0');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Owned fixture refused staged assets/);
  assert.equal(result.stdout, '');
  assert.deepEqual(await readdir(output), ['previous-release']);
  const verified = prepare('1');
  assert.equal(verified.status, 0, verified.stderr);
  const directory = verified.stdout.trim();
  assert.ok(directory.startsWith(join(output, 'git-khronos-release.')));
  assert.deepEqual((await readdir(directory)).sort(), [
    'Git-Khronos_0.1.6_amd64.cdx.json', 'Git-Khronos_0.1.6_amd64.deb',
    'Git-Khronos_0.1.6_source.cdx.json', 'SHA256SUMS', 'latest.json',
  ]);
});

test('returns only the matching qualified digest with the same public-key normalization used at build time', () => {
  assert.equal(qualifiedPackageDigest(receipt, report, key + '\n'), sha);
  assert.throws(() => qualifiedPackageDigest(receipt, report, key + ' '), /does not bind/);
  assert.throws(() => qualifiedPackageDigest(receipt, report, '\n'), /Missing release publisher key/);
  assert.throws(() => qualifiedPackageDigest(receipt, report, 'different public key'), /does not bind/);
});

test('rejects wrong build evidence, partial coverage, wrong updater state, and the wrong package', () => {
  for (const invalid of [null, {}, { ...receipt, version: 2 }, { ...receipt, outputs: { package: { sha256: 123 } } }]) {
    assert.throws(() => qualifiedPackageDigest(invalid, report, key), /does not bind/);
  }
  for (const incomplete of [null, {}, { ...report, passed: false }, { ...report, suite: 'smoke' },
    { ...report, packageSha256: '4'.repeat(64) }, { ...report, scenarios: [] },
    { ...report, scenarios: report.scenarios.slice(1) },
    { ...report, applicationUpdates: { nativeStatus: { ...report.applicationUpdates.nativeStatus, automatic: true } } },
    { ...report, applicationUpdates: { nativeStatus: { ...report.applicationUpdates.nativeStatus, configured: false } } },
  ]) {
    assert.throws(() => qualifiedPackageDigest(receipt, incomplete, key), /does not qualify/);
  }
  assert.throws(() => qualifiedPackageDigest(receipt, { ...report, scenarios: report.scenarios.slice(0, 1) }, key),
    /lacks automatic-update consent evidence; rerun installed environment acceptance/);
});

test('reads bounded regular local files and refuses symlinks and oversized evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'khronos-release-evidence-'));
  try {
    const paths = ['receipt.json', 'report.json', 'key.pub'].map(name => join(root, name));
    await Promise.all([JSON.stringify(receipt), JSON.stringify(report), key].map((value, i) => writeFile(paths[i], value)));
    assert.equal(await checkEvidence(...paths), sha);
    const packagePath = join(root, 'fixture.deb');
    await assert.rejects(checkEvidence(...paths, packagePath), /requires a completed Ubuntu 22.04 build receipt/);
    await writeFile(paths[0], JSON.stringify({ ...receipt, checksum: 'ubuntu-jammy:fixture' }));
    await writeFile(packagePath, 'unqualified package bytes');
    await assert.rejects(checkEvidence(...paths, packagePath), /differs from the qualified artifact/);
    const packageLink = join(root, 'linked-package.deb');
    await symlink(packagePath, packageLink);
    await assert.rejects(checkEvidence(...paths, packageLink), { code: 'ELOOP' });
    const link = join(root, 'linked-report.json');
    await symlink(paths[1], link);
    await assert.rejects(checkEvidence(paths[0], link, paths[2]));
    await writeFile(paths[0], 'x'.repeat(65537));
    await assert.rejects(checkEvidence(...paths), /Invalid release evidence file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
