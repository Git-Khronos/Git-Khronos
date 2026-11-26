import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkAppImage, checkAppImageFile } from './check-linux-appimage.mjs';

const elf = Buffer.alloc(64);
Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x41, 0x49, 0x02]).copy(elf);
elf.writeUInt16LE(2, 16);
elf.writeUInt16LE(62, 18);

function imageFixture({ sectionAfterTable = false } = {}) {
  const offset = sectionAfterTable ? 144 : 128;
  const image = Buffer.alloc(offset + 104);
  elf.copy(image);
  image.writeBigUInt64LE(64n, 40);
  image.writeUInt16LE(64, 58);
  image.writeUInt16LE(1, 60);
  if (sectionAfterTable) {
    image.writeBigUInt64LE(128n, 64 + 24);
    image.writeBigUInt64LE(16n, 64 + 32);
  }
  image.write('hsqs', offset);
  image.writeUInt16LE(4, offset + 28);
  image.writeBigUInt64LE(100n, offset + 40);
  return image;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-appimage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('accepts padded Type 2 payloads after the section table or final section', async (t) => {
  const root = await fixture(t);
  const artifact = join(root, 'Git-Khronos_0.1.0_amd64.AppImage');
  await writeFile(artifact, imageFixture(), { mode: 0o755 });
  assert.equal(await checkAppImage(root), artifact);
  await writeFile(artifact, imageFixture({ sectionAfterTable: true }));
  assert.equal(await checkAppImage(root), artifact);
});

test('rejects a valid-looking header with a missing, misplaced, or truncated payload', async (t) => {
  const root = await fixture(t);
  const artifact = join(root, 'one.AppImage');
  await writeFile(artifact, elf, { mode: 0o755 });
  await assert.rejects(checkAppImage(root), /invalid ELF section table/);
  const image = imageFixture();
  await writeFile(artifact, image.subarray(0, 128));
  await assert.rejects(checkAppImage(root), /no complete SquashFS superblock/);
  await writeFile(artifact, image.subarray(0, 225));
  await assert.rejects(checkAppImage(root), /payload is truncated/);
  image.write('hsqs', 64);
  image.fill(0, 128, 132);
  await writeFile(artifact, image);
  await assert.rejects(checkAppImage(root), /no valid SquashFS 4.0 superblock at the payload offset/);
});

test('rejects a plain ELF, Type 1 AppImage, and a foreign runtime architecture', async (t) => {
  const root = await fixture(t);
  const artifact = join(root, 'one.AppImage');
  const header = Buffer.from(elf);
  header.fill(0, 8, 11);
  await writeFile(artifact, header, { mode: 0o755 });
  await assert.rejects(checkAppImage(root), /Type 2 AppImage marker/);
  header.set([0x41, 0x49, 0x01], 8);
  await writeFile(artifact, header);
  await assert.rejects(checkAppImage(root), /Type 2 AppImage marker/);
  header[10] = 2;
  header.writeUInt16LE(183, 18);
  await writeFile(artifact, header);
  await assert.rejects(checkAppImage(root), /not an amd64 ELF executable/);
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

test('does not block when the selected filename has become a pipe', { skip: process.platform !== 'linux' }, async (t) => {
  const root = await fixture(t);
  const path = join(root, 'replaced.AppImage');
  execFileSync('mkfifo', [path]);
  const module = new URL('./check-linux-appimage.mjs', import.meta.url).href;
  const code = `import { checkAppImageFile } from ${JSON.stringify(module)};
    await checkAppImageFile(process.argv[1]).then(
      () => process.exit(2),
      error => { if (!error.message.includes('regular executable file')) throw error; }
    );`;
  execFileSync(process.execPath, ['--input-type=module', '-e', code, path], { timeout: 2_000 });
});
