import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { pruneIsolatedLinuxPackageCache, requireLinuxPackageSpace } from './finish-linux-package-cache.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('isolated build cleanup keeps Debian and AppImage bundles, evidence, and shared caches', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gk-isolated-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'target/local-review/run/work/source');
  const release = join(root, 'target/release');
  const nodeCache = join(root, 'target/package-tmp/node-compile-cache');
  const localNodeCache = join(directory, 'target/package-tmp/node-compile-cache');
  const outside = join(directory, 'shared');
  await mkdir(join(release, 'deps'), { recursive: true });
  await mkdir(join(release, 'bundle/deb'), { recursive: true });
  await mkdir(outside);
  await mkdir(nodeCache, { recursive: true });
  await mkdir(localNodeCache, { recursive: true });
  await symlink(outside, join(release, 'build'), 'dir');
  const packageFile = join(release, 'bundle/deb/candidate.deb');
  await writeFile(packageFile, 'retained');
  await writeFile(join(outside, 'keep'), 'shared');
  const tempEvidence = join(root, 'target/package-tmp/build-diagnostic');
  await writeFile(tempEvidence, 'keep this adjacent file');
  assert.equal(pruneIsolatedLinuxPackageCache(directory), 0);
  assert.ok(await stat(localNodeCache));
  assert.equal(pruneIsolatedLinuxPackageCache(root, outside), 0);
  assert.ok(await stat(join(release, 'deps')));
  assert.ok(await stat(nodeCache));
  assert.equal(pruneIsolatedLinuxPackageCache(root), 2);
  await assert.rejects(stat(join(release, 'deps')), { code: 'ENOENT' });
  await assert.rejects(stat(nodeCache), { code: 'ENOENT' });
  assert.equal(await readFile(tempEvidence, 'utf8'), 'keep this adjacent file');
  assert.equal(await readFile(packageFile, 'utf8'), 'retained');
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'shared');
});

test('local package preflight refuses insufficient build space before allocating anything', () => {
  const ci = process.env.CI;
  try {
    delete process.env.CI;
    const stats = gib => () => ({ bsize: 1024n ** 3n, bavail: BigInt(gib) });
    assert.throws(() => requireLinuxPackageSpace(repositoryRoot, null, stats(11)), /need at least 12 GiB/);
    assert.doesNotThrow(() => requireLinuxPackageSpace(repositoryRoot, null, stats(12)));
  } finally {
    if (ci === undefined) delete process.env.CI;
    else process.env.CI = ci;
  }
});
test('an external Cargo target does not bypass the checkout and package staging storage checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gk-package-space-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  const staging = join(checkout, 'target');
  const cargo = join(root, 'external-cargo');
  await Promise.all([mkdir(staging, { recursive: true }), mkdir(cargo)]);
  const ci = process.env.CI;
  try {
    delete process.env.CI;
    const available = new Map([[checkout, 1n], [staging, 2n], [cargo, 12n]]);
    const stats = path => ({ bsize: 1024n ** 3n, bavail: available.get(path) });
    assert.throws(() => requireLinuxPackageSpace(checkout, cargo, stats, ''), /checkout:.*need at least 2 GiB/);
    available.set(checkout, 2n);
    available.set(staging, 1n);
    assert.throws(() => requireLinuxPackageSpace(checkout, cargo, stats, ''), /package staging:.*need at least 2 GiB/);
    available.set(staging, 2n);
    assert.doesNotThrow(() => requireLinuxPackageSpace(checkout, cargo, stats, ''));
  } finally {
    if (ci === undefined) delete process.env.CI;
    else process.env.CI = ci;
  }
});

test('a custom temporary directory must have enough space independently of the checkout', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gk-package-tmp-space-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  const temporary = join(root, 'external-tmp');
  await Promise.all([mkdir(checkout), mkdir(temporary)]);
  const ci = process.env.CI;
  try {
    delete process.env.CI;
    const stats = path => ({ bsize: 1024n ** 3n, bavail: path === temporary ? 1n : 12n });
    assert.throws(() => requireLinuxPackageSpace(checkout, null, stats, join(temporary, 'new')),
      /package temporary files:.*need at least 2 GiB/);
  } finally {
    if (ci === undefined) delete process.env.CI;
    else process.env.CI = ci;
  }
});
