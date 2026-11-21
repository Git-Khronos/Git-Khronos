import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEvidence, qualifiedPackageDigest } from './check-debian-update-evidence.mjs';

const key = 'owned-test-verification-key';
const sha = '7'.repeat(64);
const receipt = {
  version: 1, outputs: { package: { sha256: sha } },
  buildConfiguration: { updaterPublicKeySha256: createHash('sha256').update(key).digest('hex') },
};
const report = {
  suite: 'environment', passed: true, packageSha256: sha,
  scenarios: ['native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer'],
  applicationUpdates: { nativeStatus: { packageFormat: 'deb', configured: true, automatic: false, offerId: null, canInstall: false } },
};

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
    { ...report, applicationUpdates: { nativeStatus: { ...report.applicationUpdates.nativeStatus, automatic: true } } },
    { ...report, applicationUpdates: { nativeStatus: { ...report.applicationUpdates.nativeStatus, configured: false } } },
  ]) {
    assert.throws(() => qualifiedPackageDigest(receipt, incomplete, key), /does not qualify/);
  }
});

test('reads bounded regular local files and refuses symlinks and oversized evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'khronos-release-evidence-'));
  try {
    const paths = ['receipt.json', 'report.json', 'key.pub'].map(name => join(root, name));
    await Promise.all([JSON.stringify(receipt), JSON.stringify(report), key].map((value, i) => writeFile(paths[i], value)));
    assert.equal(await checkEvidence(...paths), sha);
    const link = join(root, 'linked-report.json');
    await symlink(paths[1], link);
    await assert.rejects(checkEvidence(paths[0], link, paths[2]));
    await writeFile(paths[0], 'x'.repeat(65537));
    await assert.rejects(checkEvidence(...paths), /Invalid release evidence file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
