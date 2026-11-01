#!/usr/bin/env node
// A completed receipt binds Task's source checksum to this Cargo output set.
// Pending state survives an uncatchable interruption; no receipt is a cache miss.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cargo = process.env.CARGO_TARGET_DIR ? resolve(process.cwd(), process.env.CARGO_TARGET_DIR) : join(root, 'target');
const receiptPath = join(cargo, 'release/.git-khronos-package-build.v1.json');
const pendingPath = `${receiptPath}.pending`;
const [action, checksum] = process.argv.slice(2);
const fail = (message) => { throw new Error(message); };
const exists = async (path) => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

async function readJson(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65536) fail('Invalid package build receipt metadata.');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file, owned = false;
  try {
    file = await open(temporary, 'wx', 0o600); owned = true;
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.close(); file = null;
    await rename(temporary, path);
  } finally { if (file) await file.close(); if (owned) await rm(temporary, { force: true }); }
}
async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const parts = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(')').slice(-1)[0].trim().split(/\s+/);
    return ['Z', 'X'].includes(parts[0]) ? null : { pid, started: parts[19] };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
}
const sameOwner = (a, b) => !!a && !!b && a.pid === b.pid && a.started === b.started;
async function outputDigest(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size === 0n) fail(`Package build output is missing or empty: ${path}`);
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
      if (before[key] !== after[key] || before[key] !== current[key]) fail('A package build output changed while checking it.');
    }
    if (!current.isFile() || current.isSymbolicLink()) fail('Package build outputs must be regular files.');
    return { path: resolve(path), bytes: String(before.size), sha256: hash.digest('hex') };
  } finally { await file.close(); }
}
async function outputDigests() {
  // print-package validates the actual Debian payload before returning its path.
  const result = spawnSync('bash', [join(root, 'tools/manage-linux-package.sh'), 'print-package'], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) fail(result.stderr.trim() || 'The Debian package could not be verified.');
  const packagePath = resolve(result.stdout.trim());
  if (dirname(packagePath) !== join(cargo, 'release/bundle/deb') || !packagePath.endsWith('.deb')) fail('The verified Debian package is outside the selected Cargo output.');
  const paths = {
    executable: join(cargo, 'release/git-khronos'), package: packagePath,
    changelog: join(root, 'target/package-assets/changelog.gz'), manual: join(root, 'target/package-assets/git-khronos.1.gz'),
    rustNotices: join(root, 'target/package-assets/rust-dependency-notices.json.gz'),
    frontendNotices: join(root, 'target/package-assets/frontend-dependency-notices.txt.gz'),
    frontendLicenses: join(root, 'dist/apps/desktop/3rdpartylicenses.txt'), renderer: join(root, 'dist/apps/desktop/browser/index.html'),
  };
  const outputs = {};
  for (const [name, path] of Object.entries(paths)) outputs[name] = await outputDigest(path);
  return outputs;
}
function validBase(value) {
  return value && typeof value === 'object' && value.version === 1 && value.checksum === checksum && value.workspace === root && value.cargoTarget === cargo;
}
async function main() {
  if (!['begin', 'complete', 'check'].includes(action) || !/^[A-Za-z0-9_:+/=.-]{1,256}$/.test(checksum ?? '')) fail('Usage: package-build-receipt.mjs {begin|complete|check} <Task source checksum>');
  if (action === 'begin') {
    if (await exists(pendingPath)) {
      const previous = await readJson(pendingPath);
      if (!Number.isInteger(previous?.owner?.pid) || previous.owner.pid <= 0 || !/^[0-9]+$/.test(previous.owner.started ?? '')) fail('The unfinished package build has invalid owner metadata; preserve it for inspection.');
      if (sameOwner(previous.owner, await processIdentity(previous.owner.pid))) fail('Another package build still owns this Cargo output.');
    }
    await mkdir(dirname(pendingPath), { recursive: true });
    const owner = await processIdentity(process.ppid);
    if (!owner) fail('The package build owner is no longer available.');
    await atomicJson(pendingPath, { version: 1, checksum, workspace: root, cargoTarget: cargo, owner, attempt: randomUUID() });
    return;
  }
  if (action === 'complete') {
    const pending = await readJson(pendingPath);
    if (!validBase(pending) || !sameOwner(pending.owner, await processIdentity(process.ppid))) fail('The pending package build does not match this command and source checksum.');
    const outputs = await outputDigests();
    const current = await readJson(pendingPath);
    if (current.attempt !== pending.attempt || !validBase(current)) fail('The pending package build changed before completion.');
    await atomicJson(receiptPath, { version: 1, checksum, workspace: root, cargoTarget: cargo, outputs, recordedAt: new Date().toISOString() });
    await rm(pendingPath);
    console.log('Recorded completed Debian package build receipt.');
    return;
  }
  if (await exists(pendingPath)) fail('A package build is unfinished; older outputs cannot be reused.');
  const receipt = await readJson(receiptPath);
  if (!validBase(receipt)) fail('The package build receipt does not match these source inputs and Cargo output.');
  const outputs = await outputDigests();
  if (JSON.stringify(receipt.outputs) !== JSON.stringify(outputs)) fail('Package outputs differ from the completed build receipt.');
  if (await exists(pendingPath)) fail('A package build started while checking the cache.');
}
main().catch(error => { console.error(`Git Khronos: ${error.message}`); process.exitCode = 1; });
