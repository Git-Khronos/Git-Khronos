import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputs = [
  'target/release/git-khronos-desktop',
  'target/release/bundle/deb/Git Khronos_0.1.0_amd64.deb',
  'target/package-assets/changelog.gz',
  'target/package-assets/git-khronos-desktop.1.gz',
  'dist/apps/desktop/browser/index.html',
];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-incremental-deb-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, content = 'fixture') => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await copyFile(join(repositoryRoot, 'Taskfile.yml'), join(root, 'Taskfile.yml'));
  await put('tools/check-node.mjs', '');
  await put('apps/desktop/src/main.ts');
  await put('apps/desktop/src-tauri/tauri.conf.json');
  await put('crates/git-core/src/lib.rs');
  await put('packaging/debian/changelog');
  await put('bin/pnpm', `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
if (process.argv[2] === '--version') {
  console.log('12.14.0');
} else {
  if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify([
    'exec', 'tauri', 'build', '--bundles', 'deb', '--config',
    'apps/desktop/src-tauri/tauri.conf.json'
  ])) throw new Error('Unexpected build command: ' + process.argv.slice(2));
  appendFileSync('calls', 'build\\n');
  if (process.env.FAIL_BUILD) process.exit(1);
  for (const path of ${JSON.stringify(outputs)}) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'built');
  }
  mkdirSync('apps/desktop/src-tauri/gen/schemas', { recursive: true });
  writeFileSync('apps/desktop/src-tauri/gen/schemas/capabilities.json', Date.now().toString());
}
`);
  await put('bin/rustc', '#!/bin/sh\nprintf "rustc fixture\\n"\n');
  await put('tools/manage-linux-package.sh', `#!/bin/sh
printf '%s\\n' "$1" >> calls
test -z "$FAIL_VERIFY"
`);
  for (const executable of ['bin/pnpm', 'bin/rustc', 'tools/manage-linux-package.sh']) {
    await chmod(join(root, executable), 0o755);
  }
  const run = (args = ['package:deb'], extraEnv = {}) => spawnSync('task', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
  });
  const ok = (args, env) => {
    const result = run(args, env);
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  };
  const calls = async () => (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n');
  const builds = async () => (await calls()).filter((call) => call === 'build').length;
  return { root, put, run, ok, calls, builds };
}

test('unchanged packaging skips Tauri but still verifies, including the deb alias', async (t) => {
  const f = await fixture(t);
  for (const path of outputs) await f.put(path, 'existing build without a checksum baseline');
  f.ok();
  f.ok();
  f.ok(['deb']);
  assert.deepEqual(await f.calls(), ['build', 'verify', 'verify', 'verify']);
  await utimes(join(f.root, 'apps/desktop/src/main.ts'), new Date(), new Date());
  await f.put('apps/desktop/src-tauri/gen/schemas/capabilities.json', 'regenerated');
  await f.put('apps/desktop/src-tauri/target/debug/generated', 'regenerated');
  f.ok();
  assert.equal(await f.builds(), 1);
});

test('input edits, additions, renames and deletions invalidate the build', async (t) => {
  const f = await fixture(t);
  f.ok();
  for (const path of [
    'apps/desktop/src/main.ts',
    'apps/desktop/src-tauri/tauri.conf.json',
    'crates/git-core/src/lib.rs',
    'libs/contracts/src/index.ts',
    'packaging/debian/changelog',
    'tools/prepare-linux-package.mjs',
    'Cargo.lock',
    'pnpm-lock.yaml',
    'angular.json',
    'nx.json',
    'tsconfig.base.json',
    '.cargo/config.toml',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    const previous = await f.builds();
    await f.put(path, 'changed');
    await utimes(join(f.root, path), new Date(0), new Date(0));
    f.ok();
    assert.equal(await f.builds(), previous + 1, path);
  }
  await f.put('apps/desktop/src/new.ts');
  f.ok();
  const previous = await f.builds();
  await rm(join(f.root, 'apps/desktop/src/new.ts'));
  await f.put('apps/desktop/src/renamed.ts');
  f.ok();
  assert.equal(await f.builds(), previous + 1);
  await rm(join(f.root, 'apps/desktop/src/renamed.ts'));
  f.ok();
  assert.equal(await f.builds(), previous + 2);
});

test('missing required outputs rebuild and --force rebuilds unchanged inputs', async (t) => {
  const f = await fixture(t);
  f.ok();
  for (const path of outputs) {
    const previous = await f.builds();
    await rm(join(f.root, path));
    f.ok();
    assert.equal(await f.builds(), previous + 1, path);
  }
  const previous = await f.builds();
  f.ok(['--force', 'package:deb']);
  assert.equal(await f.builds(), previous + 1);
});

test('failed builds are retried, and failed verification is not skipped', async (t) => {
  const f = await fixture(t);
  f.ok();
  await f.put('apps/desktop/src/main.ts', 'changed');
  assert.notEqual(f.run(undefined, { FAIL_BUILD: '1' }).status, 0);
  const previous = await f.builds();
  f.ok();
  assert.equal(await f.builds(), previous + 1);
  assert.notEqual(f.run(undefined, { FAIL_VERIFY: '1' }).status, 0);
  const builds = await f.builds();
  f.ok();
  assert.equal(await f.builds(), builds);
  assert.equal((await f.calls()).at(-1), 'verify');
});

test('system installation uses the same incremental packaging path', async (t) => {
  const f = await fixture(t);
  f.ok(['install:system']);
  f.ok(['install:system']);
  assert.deepEqual(await f.calls(), ['build', 'verify', 'install', 'verify', 'install']);
});
