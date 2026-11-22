import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkAppImage } from './check-linux-appimage.mjs';

const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-appimage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('accepts exactly one executable ELF AppImage and returns its absolute path', async (t) => {
  const root = await fixture(t);
  const artifact = join(root, 'Git-Khronos_0.1.0_amd64.AppImage');
  await writeFile(artifact, elf);
  await chmod(artifact, 0o755);
  assert.equal(await checkAppImage(root), artifact);
});

test('rejects missing, duplicate, non-executable and non-ELF artifacts', async (t) => {
  const root = await fixture(t);
  await assert.rejects(checkAppImage(root), /found 0/);
  const first = join(root, 'one.AppImage');
  await writeFile(first, elf);
  await chmod(first, 0o644);
  await assert.rejects(checkAppImage(root), /regular executable file/);
  await writeFile(first, 'not an executable image');
  await chmod(first, 0o755);
  await assert.rejects(checkAppImage(root), /ELF runtime header/);
  await writeFile(first, elf);
  await writeFile(join(root, 'two.AppImage'), elf);
  await assert.rejects(checkAppImage(root), /found 2/);
});

test('rejects symlink-only AppImage candidates', async (t) => {
  const root = await fixture(t);
  const target = join(root, 'payload');
  await writeFile(target, elf);
  await chmod(target, 0o755);
  await symlink(target, join(root, 'linked.AppImage'));
  await assert.rejects(checkAppImage(root), /found 0/);
});

test('rejects a missing bundle directory', async (t) => {
  const root = await fixture(t);
  await assert.rejects(checkAppImage(join(root, 'missing')));
});
