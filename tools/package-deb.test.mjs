import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputs = [
  'target/release/git-khronos',
  'target/release/bundle/deb/Git-Khronos_0.1.0_amd64.deb',
  'target/package-assets/changelog.gz',
  'target/package-assets/git-khronos.1.gz',
  'target/package-assets/rust-dependency-notices.json.gz',
  'target/package-assets/frontend-dependency-notices.txt.gz',
  'dist/apps/desktop/3rdpartylicenses.txt',
  'dist/apps/desktop/browser/index.html',
];

async function requireHookFreeDpkg() {
  const files = ['/etc/dpkg/dpkg.cfg', join(homedir(), '.dpkg.cfg')];
  const directory = '/etc/dpkg/dpkg.cfg.d';
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() || entry.isSymbolicLink()) files.push(join(directory, entry.name));
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of files) {
    try {
      const contents = await readFile(file, 'utf8');
      // Refuse configured external commands rather than run host hooks.
      assert.equal(/^\s*(?:--)?(?:pre-invoke|post-invoke|status-logger)\b/m.test(contents), false,
        `Private dpkg tests require a hook-free environment: ${file}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-incremental-deb-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, content = 'fixture') => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await copyFile(join(repositoryRoot, 'Taskfile.yml'), join(root, 'Taskfile.yml'));
  await put('tools/check-node.mjs', '');
  await copyFile(join(repositoryRoot, 'tools/package-build-receipt.mjs'), join(root, 'tools/package-build-receipt.mjs'));
  await put('apps/desktop/src/main.ts');
  await put('apps/desktop/src-tauri/tauri.conf.json');
  await put('crates/git-core/src/lib.rs');
  await put('packaging/debian/changelog');
  await put('bin/pnpm', `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
if (process.argv[2] === '--version') {
  console.log('12.14.0');
} else {
  if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify([
    'exec', 'tauri', 'build', '--bundles', 'deb', '--config',
    'apps/desktop/src-tauri/tauri.conf.json'
  ])) throw new Error('Unexpected build command: ' + process.argv.slice(2));
  if (!process.env.TMPDIR || !existsSync(process.env.TMPDIR)) throw new Error('Missing build temp directory');
  writeFileSync('build-tmpdir', process.env.TMPDIR);
  appendFileSync('calls', 'build\\n');
  if (process.env.HARD_STOP_BUILD) {
    // Kill only this fixture's direct Task parent; never a caller or host job.
    const parent = '/proc/' + process.ppid;
    if (!readlinkSync(parent + '/exe').endsWith('/task') || readlinkSync(parent + '/cwd') !== process.cwd()) {
      throw new Error('Refused to interrupt an unverified fixture parent');
    }
    process.kill(process.ppid, 'SIGKILL');
    process.exit(99);
  }
  if (process.env.FAIL_BUILD) process.exit(1);
  for (const path of ${JSON.stringify(outputs)}) {
    const output = process.env.CARGO_TARGET_DIR && path.startsWith('target/release/')
      ? process.env.CARGO_TARGET_DIR + path.slice('target'.length) : path;
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, 'built');
  }
  mkdirSync('apps/desktop/src-tauri/gen/schemas', { recursive: true });
  writeFileSync('apps/desktop/src-tauri/gen/schemas/capabilities.json', Date.now().toString());
}
`);
  await put('bin/rustc', '#!/bin/sh\nprintf "rustc fixture\\n"\n');
  await put('tools/manage-linux-package.sh', `#!/bin/sh
[ "$1" = name ] && exit 0
[ "$1" = print-package ] && { package="\${CARGO_TARGET_DIR:-target}/release/bundle/deb/Git-Khronos_0.1.0_amd64.deb"; grep -qx built "$package" || exit $?; case "$package" in /*) printf '%s\\n' "$package" ;; *) printf '%s\\n' "$PWD/$package" ;; esac; exit 0; }
printf '%s\\n' "$1" >> calls
test -z "$FAIL_VERIFY"
`);
  for (const executable of ['bin/pnpm', 'bin/rustc', 'tools/manage-linux-package.sh']) {
    await chmod(join(root, executable), 0o755);
  }
  const run = (args = ['package:deb'], extraEnv = {}) => spawnSync('task', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CARGO_TARGET_DIR: '', ...extraEnv, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
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
    'tools/prepare-rust-notices.mjs',
    'tools/prepare-frontend-notices.mjs',
    'tools/collect-rust-notices.mjs',
    'packaging/licenses/reviewed-rust-notices.json',
    'packaging/licenses/fixture-LICENSE',
    'tools/check-production-renderer.mjs',
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

test('an unreadable package rebuilds even when all output paths exist', async (t) => {
  const f = await fixture(t);
  f.ok();
  await f.put(outputs[1], 'incomplete package');
  f.ok();
  assert.equal(await f.builds(), 2);
});

test('packaging uses workspace temporary storage by default and honors explicit TMPDIR', async (t) => {
  const f = await fixture(t);
  f.ok(undefined, { TMPDIR: '' });
  assert.equal(await readFile(join(f.root, 'build-tmpdir'), 'utf8'), join(f.root, 'target/package-tmp'));
  const explicit = join(f.root, 'explicit-tmp');
  f.ok(['--force', 'package:deb'], { TMPDIR: explicit });
  assert.equal(await readFile(join(f.root, 'build-tmpdir'), 'utf8'), explicit);
});

test('packaging honors absolute and relative Cargo outputs without reusing another target cache', async (t) => {
  const f = await fixture(t);
  f.ok();
  for (const target of [join(f.root, 'absolute Cargo output'), 'relative Cargo output']) {
    const env = { CARGO_TARGET_DIR: target };
    f.ok(undefined, env);
    f.ok(undefined, env);
    const directory = target.startsWith('/') ? target : join(f.root, target);
    assert.equal(await readFile(join(directory, 'release/git-khronos'), 'utf8'), 'built');
  }
  assert.equal(await f.builds(), 3);
});

test('system installation uses the same incremental packaging path', async (t) => {
  const f = await fixture(t);
  f.ok(['install:system']);
  f.ok(['install:system']);
  assert.deepEqual(await f.calls(), ['build', 'verify', 'install', 'verify', 'install']);
});

test('names the real Debian artifact without spaces and keeps naming idempotent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-deb-name-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'tools'), { recursive: true });
  const script = join(root, 'tools/manage-linux-package.sh');
  await copyFile(join(repositoryRoot, 'tools/manage-linux-package.sh'), script);
  const payload = join(root, 'payload');
  await mkdir(join(payload, 'DEBIAN'), { recursive: true });
  await writeFile(join(payload, 'DEBIAN/control'), [
    'Package: git-khronos',
    'Version: 0.1.0',
    'Architecture: amd64',
    'Maintainer: Fixture <fixture@example.test>',
    'Description: Filename regression fixture',
    '',
  ].join('\n'));
  const directory = join(root, 'target/release/bundle/deb');
  await mkdir(directory, { recursive: true });
  const original = join(directory, 'Git Khronos_0.1.0_amd64.deb');
  const expected = join(directory, 'Git-Khronos_0.1.0_amd64.deb');
  const built = spawnSync('dpkg-deb', ['--build', payload, original], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const env = { ...process.env };
    delete env.TMPDIR;
    delete env.CARGO_TARGET_DIR;
    const result = spawnSync('bash', [script, 'name'], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
    assert.ok((await stat(expected)).isFile());
    await assert.rejects(stat(original), { code: 'ENOENT' });
    assert.ok((await stat(join(root, 'target/package-tmp'))).isDirectory());
  }
});

test('real artifact naming honors absolute and relative CARGO_TARGET_DIR with spaces', async (t) => {
  for (const relative of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), 'git-khronos-cargo-target-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'tools'));
    const script = join(root, 'tools/manage-linux-package.sh');
    await copyFile(join(repositoryRoot, 'tools/manage-linux-package.sh'), script);
    const payload = join(root, 'payload');
    await mkdir(join(payload, 'DEBIAN'), { recursive: true });
    await writeFile(join(payload, 'DEBIAN/control'), [
      'Package: git-khronos', 'Version: 0.1.0', 'Architecture: amd64',
      'Maintainer: Fixture <fixture@example.test>', 'Description: Cargo target fixture', '',
    ].join('\n'));
    const target = relative ? 'relative output' : join(root, 'absolute output');
    const directory = join(relative ? root : '', target, 'release/bundle/deb');
    await mkdir(directory, { recursive: true });
    const original = join(directory, 'Git Khronos_0.1.0_amd64.deb');
    const built = spawnSync('dpkg-deb', ['--build', payload, original], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const result = spawnSync('bash', [script, 'name'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: target },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), join(directory, 'Git-Khronos_0.1.0_amd64.deb'));
    await assert.rejects(stat(original), { code: 'ENOENT' });
    await assert.rejects(stat(join(root, 'target/release/bundle/deb')), { code: 'ENOENT' });
  }
});

async function packagePayloadFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-package-payload-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'tools'));
  const script = join(root, 'tools/manage-linux-package.sh');
  await copyFile(join(repositoryRoot, 'tools/manage-linux-package.sh'), script);
  const payload = join(root, 'payload');
  const put = async (path, content) => {
    const target = join(payload, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  await put('DEBIAN/control', [
    'Package: git-khronos', 'Version: 0.1.0', 'Architecture: amd64',
    'Conflicts: git-khronos-desktop', 'Replaces: git-khronos-desktop',
    'Section: vcs', 'Maintainer: Fixture <fixture@example.test>',
    'Depends: git (>= 1:2.39), libc6 (>= 2.39), libwebkit2gtk-4.1-0, libgtk-3-0',
    'Description: Package payload regression fixture', '',
  ].join('\n'));
  await put('usr/bin/git-khronos', '#!/bin/sh\nexit 0\n');
  await chmod(join(payload, 'usr/bin/git-khronos'), 0o755);
  await put('usr/share/applications/Git Khronos.desktop', [
    '[Desktop Entry]', 'Type=Application', 'Name=Git Khronos',
    'Exec=git-khronos %U', 'MimeType=x-scheme-handler/git-khronos;', 'Icon=git-khronos', 'StartupWMClass=git-khronos', '',
  ].join('\n'));
  for (const size of ['32x32', '128x128', '256x256@2']) {
    await put(`usr/share/icons/hicolor/${size}/apps/git-khronos.png`, 'fixture');
  }
  for (const name of ['copyright', 'THIRD_PARTY_NOTICES.md']) {
    await put(`usr/share/doc/git-khronos/${name}`, 'fixture');
  }
  await put('usr/share/doc/git-khronos/changelog.gz', gzipSync('fixture'));
  await put('usr/share/man/man1/git-khronos.1.gz', gzipSync('fixture'));
  const notices = gzipSync('{"scope":"Owned package fixture, not release metadata"}\n');
  await put('usr/share/doc/git-khronos/rust-dependency-notices.json.gz', notices);
  await mkdir(join(root, 'target/package-assets'), { recursive: true });
  await writeFile(join(root, 'target/package-assets/rust-dependency-notices.json.gz'), notices);
  const frontendNotices = gzipSync('Owned frontend notices fixture\n');
  await put('usr/share/doc/git-khronos/frontend-dependency-notices.txt.gz', frontendNotices);
  await writeFile(join(root, 'target/package-assets/frontend-dependency-notices.txt.gz'), frontendNotices);
  const directory = join(root, 'target/release/bundle/deb');
  await mkdir(directory, { recursive: true });
  await copyFile(join(payload, 'usr/bin/git-khronos'), join(root, 'target/release/git-khronos'));
  await chmod(join(root, 'target/release/git-khronos'), 0o755);
  const artifact = join(directory, 'fixture.deb');
  const build = () => {
    const result = spawnSync('dpkg-deb', ['--build', payload, artifact], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const verify = (extraEnv = {}) => spawnSync('bash', [script, 'verify'], {
    encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: '', TMPDIR: root, ...extraEnv },
  });
  const print = () => spawnSync('bash', [script, 'print-package'], {
    encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: '', TMPDIR: root },
  });
  return { root, script, payload, artifact, put, build, verify, print };
}

test('failed package extraction cleans its owned temporary directory without masking the error', async (t) => {
  const { root, build, verify } = await packagePayloadFixture(t);
  build();
  const temporaryRoot = join(root, "temp storage ' quoted");
  await mkdir(temporaryRoot);
  await writeFile(join(temporaryRoot, 'unrelated'), 'preserve');
  const bin = join(root, 'bin');
  await mkdir(bin);
  const extractor = join(bin, 'dpkg-deb');
  await writeFile(extractor, `#!/bin/bash
if [[ "$1" == --extract ]]; then
  mkdir -p -- "$3/partial-payload"
  printf 'fixture extraction failed\\n' >&2
  exit 7
fi
exec /usr/bin/dpkg-deb "$@"
`);
  await chmod(extractor, 0o755);
  const result = verify({ TMPDIR: temporaryRoot, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(result.status, 7, result.stderr);
  assert.match(result.stderr, /fixture extraction failed/);
  assert.doesNotMatch(result.stderr, /unbound variable/);
  assert.deepEqual(await readdir(temporaryRoot), ['unrelated'],
    'a rejected or damaged package must not leave its extracted files behind');
  assert.equal(await readFile(join(temporaryRoot, 'unrelated'), 'utf8'), 'preserve');
});

test('successful package verification cleans only its owned temporary directory', async (t) => {
  const { root, build, verify } = await packagePayloadFixture(t);
  build();
  const temporaryRoot = join(root, "temp storage ' quoted");
  await mkdir(temporaryRoot);
  await writeFile(join(temporaryRoot, 'unrelated'), 'preserve');

  const result = verify({ TMPDIR: temporaryRoot });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(temporaryRoot), ['unrelated']);
  assert.equal(await readFile(join(temporaryRoot, 'unrelated'), 'utf8'), 'preserve');
});

test('package verification requires the glibc version used by the supported build baseline', async (t) => {
  const { payload, put, build, verify } = await packagePayloadFixture(t);
  build();
  assert.equal(verify().status, 0);

  const control = await readFile(join(payload, 'DEBIAN/control'), 'utf8');
  await put('DEBIAN/control', control.replace('libc6 (>= 2.39)', 'libc6'));
  build();
  const refused = verify();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /glibc 2\.39 or newer/);
});

for (const [kind, filename] of [['Rust', 'rust-dependency-notices.json.gz'], ['frontend', 'frontend-dependency-notices.txt.gz']]) {
test(`package verification rejects missing, corrupt or stale ${kind} notice payloads`, async (t) => {
  const f = await packagePayloadFixture(t);
  f.build();
  assert.equal(f.verify().status, 0);
  const path = `usr/share/doc/git-khronos/${filename}`;
  await rm(join(f.payload, path));
  f.build();
  assert.match(f.verify().stderr, /payload is missing/);
  await f.put(path, 'not gzip');
  f.build();
  assert.notEqual(f.verify().status, 0);
  await f.put(path, gzipSync('different but valid gzip'));
  f.build();
  assert.match(f.verify().stderr, /notices differ/);
  const expected = join(f.root, `target/package-assets/${filename}`);
  await f.put(path, await readFile(expected));
  await rm(expected);
  f.build();
  assert.ok(f.verify().stderr.includes(`generated ${kind} notices are missing`));
});
}

test('both Linux bundle formats include the generated catalog from the preparation hook', async () => {
  const config = JSON.parse(await readFile(join(repositoryRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  assert.equal(config.build.beforeBundleCommand, 'node tools/prepare-linux-package.mjs');
  for (const format of ['deb', 'rpm']) {
    assert.equal(config.bundle.linux[format].files['/usr/share/doc/git-khronos/rust-dependency-notices.json.gz'],
      '../../../target/package-assets/rust-dependency-notices.json.gz');
    assert.equal(config.bundle.linux[format].files['/usr/share/doc/git-khronos/frontend-dependency-notices.txt.gz'],
      '../../../target/package-assets/frontend-dependency-notices.txt.gz');
  }
});

test('package verification rejects the development-only IPC exporter', async (t) => {
  const { put, build, verify } = await packagePayloadFixture(t);
  build();
  const valid = verify();
  assert.equal(valid.status, 0, valid.stderr);
  await put('usr/bin/export-ipc', 'development-only tool');
  build();
  const invalid = verify();
  assert.notEqual(invalid.status, 0, 'development-only generator must not ship');
  assert.match(invalid.stderr, /development-only.*export-ipc/);
});

test('package cache validity rejects readable control metadata with a missing executable', async (t) => {
  const { payload, artifact, build, print } = await packagePayloadFixture(t);
  build();
  const valid = print();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trim(), artifact);
  await rm(join(payload, 'usr/bin/git-khronos'));
  build();
  const control = spawnSync('dpkg-deb', ['--field', artifact, 'Package'], { encoding: 'utf8' });
  assert.equal(control.status, 0, control.stderr);
  assert.equal(control.stdout.trim(), 'git-khronos');
  const broken = print();
  assert.notEqual(broken.status, 0, 'the Task build status must reject an invalid payload, not just read its header');
  assert.match(broken.stderr, /executable is missing/);
  assert.equal(broken.stdout, '');
});

async function legacyPackageFixture(t) {
  await requireHookFreeDpkg();
  const { payload, artifact, put, build } = await packagePayloadFixture(t);
  const root = dirname(payload);
  // Consume the same relationship fields that Tauri writes to the real deb.
  // The real candidate must still be checked separately after rebuilding.
  const config = JSON.parse(await readFile(join(repositoryRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  const relationships = [['Conflicts', 'conflicts'], ['Replaces', 'replaces'], ['Provides', 'provides']]
    .filter(([, key]) => config.bundle.linux.deb[key]?.length)
    .map(([field, key]) => `${field}: ${config.bundle.linux.deb[key].join(', ')}`);
  const control = (await readFile(join(payload, 'DEBIAN/control'), 'utf8'))
    .split('\n').filter(line => !/^(Conflicts|Replaces|Provides):/.test(line)).join('\n');
  await put('DEBIAN/control', `${control}${relationships.join('\n')}\n`);
  build();

  const legacy = join(root, 'legacy');
  const legacyFile = async (path, contents) => {
    const file = join(legacy, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  await legacyFile('DEBIAN/control', [
    'Package: git-khronos-desktop', 'Version: 0.1.0', 'Architecture: amd64',
    'Maintainer: Fixture <fixture@example.test>',
    'Description: Independently constructed legacy ownership fixture', '',
  ].join('\n'));
  await legacyFile('usr/bin/git-khronos-desktop', '#!/bin/sh\nexit 0\n');
  await chmod(join(legacy, 'usr/bin/git-khronos-desktop'), 0o755);
  await legacyFile('usr/share/applications/Git Khronos.desktop', '[Desktop Entry]\nExec=git-khronos-desktop\n');
  const legacyDeb = join(root, 'legacy.deb');
  const packed = spawnSync('dpkg-deb', ['--build', legacy, legacyDeb], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);

  // Both packages have only a control file and data: no maintainer scripts.
  // Fakeroot simulates ownership; explicit root AND admin paths prohibit use
  // of the host dpkg database. No sudo, dependency forcing, or overwrite forcing.
  const privateRoot = join(root, 'private-dpkg-root');
  const admin = join(privateRoot, 'var/lib/dpkg');
  await mkdir(join(admin, 'updates'), { recursive: true });
  await writeFile(join(admin, 'status'), '');
  const sentinel = join(privateRoot, 'unrelated-user-data');
  await writeFile(sentinel, 'must remain unchanged\n');
  const dpkg = args => spawnSync('fakeroot', [
    'dpkg', `--root=${privateRoot}`, `--admindir=${admin}`, `--log=${join(admin, 'fixture.log')}`,
    ...args,
  ], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, timeout: 30_000 });
  const unpack = file => dpkg(['--unpack', file]);
  const old = unpack(legacyDeb);
  assert.equal(old.status, 0, `${old.error ?? ''}\n${old.stdout}\n${old.stderr}`);
  return { root, payload, artifact, put, build, privateRoot, admin, sentinel, dpkg, unpack };
}

test('renamed package replaces the legacy payload in a private dpkg database', async (t) => {
  const { artifact, privateRoot, sentinel, unpack } = await legacyPackageFixture(t);
  const upgraded = unpack(artifact);
  assert.equal(await readFile(sentinel, 'utf8'), 'must remain unchanged\n');
  if (upgraded.status !== 0) {
    assert.match(await readFile(join(privateRoot, 'usr/share/applications/Git Khronos.desktop'), 'utf8'), /^Exec=git-khronos-desktop$/m);
  }
  assert.equal(upgraded.status, 0, `${upgraded.error ?? ''}\n${upgraded.stdout}\n${upgraded.stderr}`);
  assert.equal(await readFile(join(privateRoot, 'usr/bin/git-khronos'), 'utf8'), '#!/bin/sh\nexit 0\n');
  assert.match(await readFile(join(privateRoot, 'usr/share/applications/Git Khronos.desktop'), 'utf8'), /^Exec=git-khronos %U$/m);
  await assert.rejects(stat(join(privateRoot, 'usr/bin/git-khronos-desktop')), { code: 'ENOENT' });
});

for (const unexpectedRemoval of [false, true]) {
  test(`real isolated APT ${unexpectedRemoval ? 'refuses an unrelated transitive removal before dpkg' : 'replaces only the legacy package'}`, async (t) => {
    const f = await legacyPackageFixture(t);
    const pack = async (name, extra, data = []) => {
      const directory = join(f.root, name);
      await mkdir(join(directory, 'DEBIAN'), { recursive: true });
      await writeFile(join(directory, 'DEBIAN/control'), [
        `Package: ${name}`, 'Version: 1', 'Architecture: all',
        'Maintainer: Fixture <fixture@example.test>',
        ...extra, 'Description: Private APT transaction fixture', '',
      ].join('\n'));
      for (const [path, content] of data) {
        await mkdir(dirname(join(directory, path)), { recursive: true });
        await writeFile(join(directory, path), content);
      }
      const artifact = join(f.root, `${name}.deb`);
      const result = spawnSync('dpkg-deb', ['--build', directory, artifact], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return artifact;
    };
    const unrelatedPath = 'usr/share/fixture-unrelated/keep';
    const unrelated = await pack('fixture-unrelated', [], [[unrelatedPath, 'preserved\n']]);
    const installed = f.unpack(unrelated);
    assert.equal(installed.status, 0, installed.stderr);
    const configured = f.dpkg(['--configure', 'git-khronos-desktop', 'fixture-unrelated']);
    assert.equal(configured.status, 0, configured.stderr);

    // The independent fixture runs /bin/sh, not GTK. Packaged native acceptance
    // separately checks the real application's runtime dependencies.
    let control = (await readFile(join(f.payload, 'DEBIAN/control'), 'utf8'))
      .split('\n').filter(line => !line.startsWith('Depends:')).join('\n');
    const artifacts = [f.artifact];
    if (unexpectedRemoval) {
      control += 'Depends: fixture-transition-helper\n';
      artifacts.push(await pack('fixture-transition-helper', ['Conflicts: fixture-unrelated']));
    }
    await f.put('DEBIAN/control', control);
    f.build();

    const apt = join(f.root, 'apt');
    for (const path of ['etc/parts', 'etc/sources', 'etc/preferences.d', 'state/lists/partial', 'cache/archives/partial', 'log']) {
      await mkdir(join(apt, path), { recursive: true });
    }
    const empty = join(apt, 'etc/empty.conf');
    await writeFile(empty, '');
    const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const dpkgWrapper = join(apt, 'private-dpkg');
    const mutations = join(apt, 'dpkg-mutations');
    await writeFile(dpkgWrapper, `#!/bin/bash
set -euo pipefail
original=("$@")
while (($#)); do
  argument="$1"
  case "$argument" in
    --unpack|--install|--configure|--remove|--purge|--triggers-only|--set-selections|--clear-selections|--update-avail|--merge-avail|-i|-r|-P|-A)
      printf '%s\\n' "$argument" >> ${shellQuote(mutations)} ;;
  esac
  case "$argument" in
    --root|--instdir|--admindir|--log)
      option="$argument"; shift; value="\${1-}" ;;
    --root=*|--instdir=*|--admindir=*|--log=*)
      option="\${argument%%=*}"; value="\${argument#*=}" ;;
    *) shift; continue ;;
  esac
  case "$option" in
    --root|--instdir) expected=${shellQuote(f.privateRoot)} ;;
    --admindir) expected=${shellQuote(f.admin)} ;;
    --log) expected=${shellQuote(join(f.admin, 'fixture.log'))} ;;
  esac
  if [[ "\${value%/}" != "$expected" ]]; then
    printf 'Fixture refused a dpkg directory override\\n' >&2; exit 86
  fi
  shift
done
exec /usr/bin/dpkg --root=${shellQuote(f.privateRoot)} --admindir=${shellQuote(f.admin)} --log=${shellQuote(join(f.admin, 'fixture.log'))} "\${original[@]}"
`);
    await chmod(dpkgWrapper, 0o755);
    const hookDirectory = await mkdtemp('/tmp/git-khronos-apt-fixture-');
    t.after(() => rm(hookDirectory, { recursive: true, force: true }));
    const hook = join(hookDirectory, 'check');
    await symlink(join(repositoryRoot, 'tools/guard-linux-package-transition.sh'), hook);
    const existingHook = join(hookDirectory, 'existing');
    const existingInput = join(apt, 'existing-hook-input');
    await writeFile(existingHook, `#!/bin/sh
IFS= read -r first || exit 1
printf '%s\\n' "$first" > ${shellQuote(existingInput)}
cat >/dev/null
`);
    await chmod(existingHook, 0o755);
    const settings = [
      ['Dir::Etc', join(apt, 'etc')], ['Dir::Etc::parts', join(apt, 'etc/parts')],
      ['Dir::Etc::main', empty], ['Dir::Etc::sourcelist', empty],
      ['Dir::Etc::sourceparts', join(apt, 'etc/sources')],
      ['Dir::State', join(apt, 'state')], ['Dir::State::status', join(f.admin, 'status')],
      ['Dir::State::extended_states', join(apt, 'state/extended_states')],
      ['Dir::State::lists', join(apt, 'state/lists')], ['Dir::Cache', join(apt, 'cache')],
      ['Dir::Cache::archives', join(apt, 'cache/archives')], ['Dir::Cache::pkgcache', ''],
      ['Dir::Cache::srcpkgcache', ''], ['Dir::Log', join(apt, 'log')],
      ['Dir::Bin::dpkg', dpkgWrapper], ['APT::Architecture', 'amd64'],
      ['APT::Sandbox::User', userInfo().username],
      ['DPkg::Inhibit-Shutdown', 'false'], ['DPkg::Inhibit-Sleep', 'false'],
    ];
    const configuration = settings.map(([key, value]) => {
      assert.equal(/["\\\r\n]/.test(value), false, 'Fixture path cannot be represented in APT configuration');
      return `${key} "${value}";`;
    }).join('\n') + `\nDPkg::Pre-Install-Pkgs {"${existingHook}";};\n`;
    const config = join(apt, 'private.conf');
    await writeFile(config, configuration);
    const before = await readFile(join(f.admin, 'status'));
    // Every dpkg invocation passes the private-root wrapper; APT also has no
    // repositories, host configuration/hooks, host state, logs, or inhibitors.
    // Match the production command-line hook options and confirmation policy.
    // Only the private fixture receives the synthetic user's confirmation.
    const runApt = input => spawnSync('fakeroot', ['/usr/bin/apt-get', 'install', '--reinstall',
      '-o', `DPkg::Pre-Install-Pkgs::=${hook}`,
      '-o', `DPkg::Tools::Options::${hook}::Version=2`,
      '-o', `DPkg::Tools::Options::${hook}::InfoFD=0`,
      '-o', 'APT::Get::Assume-Yes=false', ...artifacts], { input, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, APT_CONFIG: config, LC_ALL: 'C', DEBIAN_FRONTEND: 'noninteractive', BASH_ENV: '', ENV: '' } });
    if (!unexpectedRemoval) {
      const declined = runApt('n\n');
      assert.notEqual(declined.status, 0);
      assert.deepEqual(await readFile(join(f.admin, 'status')), before);
      await assert.rejects(stat(mutations), { code: 'ENOENT' });
      await assert.rejects(stat(existingInput), { code: 'ENOENT' });
    }
    const result = runApt('Y\n');
    const detail = `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`;
    assert.equal(await readFile(join(f.privateRoot, unrelatedPath), 'utf8'), 'preserved\n', detail);
    // Appending our hook preserves other hooks and their default v1 protocol.
    assert.match((await readFile(existingInput, 'utf8')).trimEnd(), /^\/.+\.deb$/, detail);
    if (unexpectedRemoval) {
      assert.notEqual(result.status, 0, detail);
      assert.match(result.stderr, /APT also proposes removing fixture-unrelated/, detail);
      assert.deepEqual(await readFile(join(f.admin, 'status')), before, detail);
      await assert.rejects(stat(mutations), { code: 'ENOENT' });
      await assert.rejects(stat(join(f.privateRoot, 'usr/bin/git-khronos')), { code: 'ENOENT' });
      assert.ok((await stat(join(f.privateRoot, 'usr/bin/git-khronos-desktop'))).isFile());
    } else {
      assert.equal(result.status, 0, detail);
      assert.match(await readFile(mutations, 'utf8'), /--unpack/);
      assert.equal(await readFile(join(f.privateRoot, 'usr/bin/git-khronos'), 'utf8'), '#!/bin/sh\nexit 0\n');
      await assert.rejects(stat(join(f.privateRoot, 'usr/bin/git-khronos-desktop')), { code: 'ENOENT' });
    }
  });
}

test('package verification requires the exact legacy replacement relationships', async (t) => {
  const { payload, put, build, verify } = await packagePayloadFixture(t);
  const original = await readFile(join(payload, 'DEBIAN/control'), 'utf8');
  for (const field of ['Conflicts', 'Replaces']) {
    for (const replacement of ['', `${field}: unrelated-package`]) {
      const changed = original.split('\n').flatMap(line => line.startsWith(`${field}:`)
        ? replacement ? [replacement] : [] : [line]).join('\n');
      await put('DEBIAN/control', changed);
      build();
      const refused = verify();
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, new RegExp(`package field ${field}`));
    }
  }
});

test('APT transition guard accepts only the legacy removal and valid action frames', () => {
  const guard = join(repositoryRoot, 'tools/guard-linux-package-transition.sh');
  const application = 'git-khronos - < 0.1.0 /tmp/a package.deb\n';
  const header = 'VERSION 2\nAcquire::https::Proxy=fixture-secret\n\n';
  const run = input => spawnSync('bash', [guard], { input, encoding: 'utf8', timeout: 5000 });
  for (const actions of [
    application,
    `git-khronos-desktop 0.1.0 > - **REMOVE**\n${application}`,
    `dependency 1 < 2 /var/cache/apt/archives/dependency_2.deb\n${application}git-khronos 0.1.0 = 0.1.0 **CONFIGURE**\n`,
  ]) {
    const accepted = run(header + actions);
    assert.equal(accepted.status, 0, `${accepted.error ?? ''}\n${accepted.stderr}`);
  }
  for (const input of [
    '', 'VERSION 1\n\n' + application, 'VERSION 3\n\n' + application,
    'VERSION 2\nfixture-secret\n\n' + application,
    'VERSION 2\nAcquire::https::Proxy=fixture-secret\n',
    header, header + application.trimEnd(), header + '\n' + application,
    header + 'git-khronos-desktop 0.1.0 > - **REMOVE**\n',
    header + application + 'unrelated-package 1 > - **REMOVE**\n',
    header + application + 'git-khronos 1 > - **REMOVE**\n',
    header + application + 'git-khronos-desktop-extra 1 > - **REMOVE**\n',
    header + application + 'bad:name 1 = 1 **CONFIGURE**\n',
    header + 'git-khronos missing\n',
    header + 'git-khronos 1 ? 2 /tmp/file.deb\n',
    header + 'git-khronos 1 = 1 **UNKNOWN**\n',
    header + 'git-khronos 1 = 1 **REMOVE** extra\n',
  ]) {
    const refused = run(input);
    assert.notEqual(refused.status, 0, input);
    assert.doesNotMatch(refused.stderr, /fixture-secret/);
  }
});

test('installer keeps fresh-install removal refusal and guards the actual legacy transaction', async (t) => {
  const f = await packagePayloadFixture(t);
  f.build();
  const guard = join(f.root, 'tools/guard-linux-package-transition.sh');
  await copyFile(join(repositoryRoot, 'tools/guard-linux-package-transition.sh'), guard);
  await chmod(guard, 0o755);
  const bin = join(f.root, 'bin');
  await mkdir(bin);
  const mock = async (name, contents) => {
    const file = join(bin, name);
    await writeFile(file, contents);
    await chmod(file, 0o755);
  };
  await mock('sudo', '#!/bin/sh\n[ "$1" = -- ] || exit 99\nshift\nexec "$@"\n');
  await mock('dpkg-query', '#!/bin/sh\nprintf "%s" "$GIT_KHRONOS_TEST_LEGACY_STATUS"\n');
  await mock('apt-get', `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = process.env.GIT_KHRONOS_PACKAGE_FIXTURE;
const args = process.argv.slice(2);
writeFileSync(root + '/apt-args.json', JSON.stringify(args));
const option = args.find(arg => arg.startsWith('DPkg::Pre-Install-Pkgs::='));
if (process.env.GIT_KHRONOS_TEST_LEGACY_STATUS && args.includes('--no-remove')) process.exit(100);
if (option) {
  const command = option.slice('DPkg::Pre-Install-Pkgs::='.length);
  if (!args.includes('DPkg::Tools::Options::' + command + '::Version=2')) process.exit(101);
  if (!args.includes('DPkg::Tools::Options::' + command + '::InfoFD=0')) process.exit(102);
  const result = spawnSync(command, [], { input: process.env.GIT_KHRONOS_APT_ACTIONS, encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr ?? 'Guard did not run'); process.exit(103); }
}
writeFileSync(root + '/apt-acted', 'fixture action only');
`);
  const run = (status, actions) => spawnSync('bash', [f.script, 'install'], {
    encoding: 'utf8', timeout: 10000,
    // This installer scenario owns its package under f.root. An inherited
    // Cargo target must never redirect verification to a real build artifact.
    env: { ...process.env, CARGO_TARGET_DIR: '', TMPDIR: f.root, PATH: `${bin}:${process.env.PATH}`,
      GIT_KHRONOS_PACKAGE_FIXTURE: f.root, GIT_KHRONOS_TEST_LEGACY_STATUS: status,
      GIT_KHRONOS_APT_ACTIONS: actions },
  });
  const application = 'git-khronos - < 0.1.0 /tmp/fixture.deb\n';
  for (const [status, actions, accepted] of [
    ['', '', true],
    ['installed', `VERSION 2\n\ngit-khronos-desktop 0.1.0 > - **REMOVE**\n${application}`, true],
    ['unpacked', `VERSION 2\n\n${application}`, true],
    ['installed', `VERSION 2\n\n${application}unrelated-package 1 > - **REMOVE**\n`, false],
  ]) {
    await rm(join(f.root, 'apt-acted'), { force: true });
    const result = run(status, actions);
    assert.equal(result.status === 0, accepted, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    const args = JSON.parse(await readFile(join(f.root, 'apt-args.json'), 'utf8'));
    assert.equal(args.includes('--no-remove'), status === '');
    const option = args.find(arg => arg.startsWith('DPkg::Pre-Install-Pkgs::='));
    if (status) {
      assert.ok(option);
      assert.ok(args.includes('APT::Get::Assume-Yes=false'));
      const path = option.slice('DPkg::Pre-Install-Pkgs::='.length);
      await assert.rejects(stat(dirname(path)), { code: 'ENOENT' },
        `guard cleanup failed for ${status}/${accepted}: ${result.stderr}`);
    }
    if (accepted) assert.equal(await readFile(join(f.root, 'apt-acted'), 'utf8'), 'fixture action only');
    else {
      await assert.rejects(stat(join(f.root, 'apt-acted')), { code: 'ENOENT' });
      assert.doesNotMatch(result.stdout, /Git Khronos is installed/);
    }
  }
});

test('uninstaller recognizes unpacked and partially configured packages without purging data', async (t) => {
  const f = await packagePayloadFixture(t);
  const bin = join(f.root, 'bin');
  await mkdir(bin);
  const mock = async (name, contents) => {
    const file = join(bin, name);
    await writeFile(file, contents);
    await chmod(file, 0o755);
  };
  await mock('sudo', '#!/bin/sh\n[ "$1" = -- ] || exit 99\nshift\nexec "$@"\n');
  await mock('dpkg-query', `#!/bin/sh
[ "$3" = git-khronos ] || exit 99
case "$GIT_KHRONOS_TEST_PACKAGE_STATUS" in
  absent) exit 1 ;;
esac
case "$2" in
  *Status-Abbrev*) printf '%s' "$GIT_KHRONOS_TEST_PACKAGE_ABBREV" ;;
  *) printf '%s' "$GIT_KHRONOS_TEST_PACKAGE_STATUS" ;;
esac
`);
  await mock('apt-get', `#!/bin/sh
printf '%s\\n' "$@" > "$GIT_KHRONOS_PACKAGE_FIXTURE/removal-args"
`);
  const record = join(f.root, 'removal-args');
  for (const [status, abbreviation, present] of [
    ['installed', 'ii ', true], ['installed', 'ri ', true], ['unpacked', 'iU ', true],
    ['half-installed', 'iH ', true], ['half-configured', 'iF ', true],
    ['triggers-awaited', 'iW ', true], ['triggers-pending', 'it ', true],
    ['config-files', 'rc ', false], ['not-installed', 'un ', false], ['absent', '', false],
  ]) {
    await rm(record, { force: true });
    const result = spawnSync('bash', [f.script, 'uninstall'], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, TMPDIR: f.root, PATH: `${bin}:${process.env.PATH}`,
        GIT_KHRONOS_PACKAGE_FIXTURE: f.root, GIT_KHRONOS_TEST_PACKAGE_STATUS: status,
        GIT_KHRONOS_TEST_PACKAGE_ABBREV: abbreviation } });
    assert.equal(result.status, 0, `${status}: ${result.stderr}`);
    if (present) {
      assert.equal(await readFile(record, 'utf8').catch(() => ''), 'remove\ngit-khronos\n', status);
      assert.doesNotMatch(result.stdout, /is not installed/);
    } else {
      await assert.rejects(stat(record), { code: 'ENOENT' });
      assert.match(result.stdout, /is not installed/);
    }
  }
});


for (const [name, transform, key] of [
  ['drops URI arguments', text => text.replace('Exec=git-khronos %U', 'Exec=git-khronos'), 'Exec'],
  ['omits scheme association', text => text.replace('MimeType=x-scheme-handler/git-khronos;\n', ''), 'MimeType'],
]) {
  test(`package verification rejects a desktop entry that ${name}`, async t => {
    const f = await packagePayloadFixture(t);
    const path = 'usr/share/applications/Git Khronos.desktop';
    await f.put(path, transform(await readFile(join(f.payload, path), 'utf8')));
    f.build();
    const result = f.verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`desktop entry.*${key}`));
  });
}


test('hard-stopped builds cannot accept older outputs as a completed current build', async (t) => {
  const f = await fixture(t); f.ok();
  await f.put('apps/desktop/src/main.ts', 'new source after completed old build');
  const interrupted = f.run(undefined, { HARD_STOP_BUILD: '1' });
  assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr);
  const previous = await f.builds();
  f.ok();
  assert.equal(await f.builds(), previous + 1, 'a hard stop must not bless old package outputs under the new source checksum');
});

test('returning to a prior Cargo target rebuilds outputs associated with an older source', async (t) => {
  const f = await fixture(t); f.ok();
  await f.put('apps/desktop/src/main.ts', 'new source for another target');
  f.ok(undefined, { CARGO_TARGET_DIR: join(f.root, 'another Cargo target') });
  const previous = await f.builds();
  f.ok();
  assert.equal(await f.builds(), previous + 1, 'a shared Task checksum must not qualify another target directory\'s older output');
});


test('completed package receipts reject modified outputs and missing receipts with unchanged source', async (t) => {
  const f = await fixture(t); f.ok();
  for (const path of [outputs[0], outputs[7], 'target/release/.git-khronos-package-build.v1.json']) {
    const previous = await f.builds();
    if (path.endsWith('.json')) await rm(join(f.root, path)); else await f.put(path, 'changed generated output');
    f.ok();
    assert.equal(await f.builds(), previous + 1, path);
  }
});

test('another live build owner is preserved before Tauri can overwrite outputs', async (t) => {
  const f = await fixture(t); f.ok();
  const started = (await readFile(`/proc/${process.pid}/stat`, 'utf8')).split(')').at(-1).trim().split(/\s+/)[19];
  const pending = 'target/release/.git-khronos-package-build.v1.json.pending';
  const value = JSON.stringify({ version: 1, owner: { pid: process.pid, started } });
  await f.put(pending, value); const previous = await f.builds();
  const refused = f.run(['--force', 'package:deb']);
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /Another package build still owns/);
  assert.equal(await f.builds(), previous); assert.equal(await readFile(join(f.root, pending), 'utf8'), value);
});

test('package verification rejects a stale bundled executable even when payload and notices are otherwise valid', async (t) => {
  const f = await packagePayloadFixture(t); f.build(); assert.equal(f.verify().status, 0);
  const executable = join(f.root, 'target/release/git-khronos');
  await writeFile(executable, '#!/bin/sh\nexit 23\n');
  const mismatch = f.verify(); assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /packaged executable differs from the current release/);
  await rm(executable);
  const missing = f.verify(); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /release executable is missing/);
});


test('package verification allows only the single Tauri Deb bundle marker transformation', async (t) => {
  const f = await packagePayloadFixture(t);
  const executable = join(f.root, 'target/release/git-khronos');
  const original = 'owned-prefix\0__TAURI_BUNDLE_TYPE_VAR_UNK\0owned-suffix';
  const bundled = original.replace('_VAR_UNK', '_VAR_DEB');
  await writeFile(executable, original);
  await f.put('usr/bin/git-khronos', bundled); f.build();
  assert.equal(f.verify().status, 0);
  await f.put('usr/bin/git-khronos', bundled + 'unexpected'); f.build();
  assert.notEqual(f.verify().status, 0);
  await writeFile(executable, original + original);
  await f.put('usr/bin/git-khronos', bundled + bundled); f.build();
  assert.notEqual(f.verify().status, 0);
  await writeFile(executable, original);
  await f.put('usr/bin/git-khronos', original.replace('_VAR_UNK', '_VAR_RPM')); f.build();
  assert.notEqual(f.verify().status, 0);
});
