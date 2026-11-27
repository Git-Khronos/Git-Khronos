import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, open, readFile, readdir, readlink, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { checkPackage, verifyGlibcBaseline } from './check-linux-abi.mjs';
import { checkEvidence } from './check-debian-update-evidence.mjs';
import { checkInstalledDeb, findReplacedProcesses } from './check-installed-deb.mjs';
import { pruneIsolatedLinuxPackageCache, requireLinuxPackageSpace } from './finish-linux-package-cache.mjs';
import { checkLinuxPackageWatcher } from './check-linux-package-watcher.mjs';
import { reportInstalledAcceptance } from './report-installed-acceptance.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('isolated build cleanup keeps Debian and AppImage bundles, evidence, and shared caches', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gk-isolated-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'target/local-review/run/work/source');
  const release = join(root, 'target/release');
  const outside = join(directory, 'shared');
  await mkdir(join(release, 'deps'), { recursive: true });
  await mkdir(join(release, 'bundle/deb'), { recursive: true });
  await mkdir(outside);
  await symlink(outside, join(release, 'build'), 'dir');
  const packageFile = join(release, 'bundle/deb/candidate.deb');
  await writeFile(packageFile, 'retained');
  await writeFile(join(outside, 'keep'), 'shared');
  assert.equal(pruneIsolatedLinuxPackageCache(root, outside), 0);
  assert.ok(await stat(join(release, 'deps')));
  assert.equal(pruneIsolatedLinuxPackageCache(root), 1);
  await assert.rejects(stat(join(release, 'deps')), { code: 'ENOENT' });
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
test('task run follows the Cargo output directory without falling back to an old executable', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'gk-cargo-launch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyFile(join(repositoryRoot, 'Taskfile.yml'), join(root, 'Taskfile.yml'));
  const bin = join(root, 'bin');
  await mkdir(bin);
  for (const tool of ['node', 'pnpm', 'rustc', 'git']) {
    await writeFile(join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }

  for (const [name, target, directory] of [
    ['default', '', join(root, 'target')],
    ['relative', 'reuse cache $literal', join(root, 'reuse cache $literal')],
    ['absolute', join(root, 'absolute cache'), join(root, 'absolute cache')],
  ]) {
    const release = join(directory, 'release');
    await mkdir(release, { recursive: true });
    await writeFile(join(release, 'git-khronos'), `#!/bin/sh\nprintf '%s\\n' 'ran-${name}'\n`, { mode: 0o755 });
    const result = spawnSync('task', ['run'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH, CARGO_TARGET_DIR: target },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `ran-${name}`);
  }
});

test('launcher probe help describes archive verification without starting a desktop', () => {
  const script = join(repositoryRoot, 'tools', 'check-installed-x11-launch.sh');
  for (const flag of ['--help', '-h']) {
    const result = spawnSync('bash', [script, flag], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /With PACKAGE\.deb, also requires Node/);
    assert.match(result.stdout, /does not verify installed bytes/);
    assert.match(result.stdout, /GIT_KHRONOS_ACCEPTANCE_PYTHON/);
    assert.match(result.stdout, /not a host-specific pinned shortcut or WSLg/);
    assert.equal(result.stderr, '');
  }
  const missingArchive = spawnSync('bash', [script, '--renderer-recovery'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(missingArchive.status, 2, missingArchive.stderr);
  assert.match(missingArchive.stderr, /^Usage:/);
});

test('installed status and release verifiers do not silently skip checks through a symlink', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-status-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, args, diagnostic] of [
    ['check-installed-deb', [], /Usage: node tools\/check-installed-deb\.mjs PACKAGE\.deb/],
    ['report-installed-acceptance', [], /Usage: node tools\/report-installed-acceptance\.mjs/],
    ['check-debian-update-evidence', [], /Usage: check-debian-update-evidence/],
    ['check-debian-candidate-run', [join(root, 'missing-run.json'), '10'], /ENOENT/],
    ['check-linux-abi', [], /Usage: node tools\/check-linux-abi\.mjs/],
    ['check-linux-package-watcher', [], /Expected the package Cargo manifest path/],
    ['run-focused-installed-acceptance', [], /Usage: node tools\/run-focused-installed-acceptance\.mjs/],
  ]) {
    const cli = join(root, `${name}.mjs`);
    await symlink(join(repositoryRoot, 'tools', `${name}.mjs`), cli);
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.match(result.stderr, diagnostic);
  }
});

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

test('detects an owned running executable replaced on disk without stopping it', {
  skip: process.platform !== 'linux', timeout: 10_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-stale-process-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'owned-process');
  const build = spawnSync('cc', ['-x', 'c', '-o', path, '-'], {
    encoding: 'utf8',
    input: '#include <unistd.h>\nint main(void) { if (write(1, "R", 1) != 1) return 1; for (;;) pause(); }',
  });
  assert.equal(build.status, 0, build.stderr);
  const child = spawn(path, [], { stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
  });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', chunk => {
      if (chunk.toString() === 'R') resolve();
      else reject(new Error('Unexpected readiness marker from the owned fixture'));
    });
    child.once('exit', code => reject(new Error(`Owned fixture exited before readiness: ${code}`)));
    child.once('error', reject);
  });
  assert.equal(await readlink(`/proc/${child.pid}/exe`), path);
  assert.deepEqual(findReplacedProcesses(path), []);
  const replacement = join(root, 'replacement');
  await copyFile(path, replacement);
  await rename(replacement, path);
  assert.equal(await readlink(`/proc/${child.pid}/exe`), path + ' (deleted)');
  assert.deepEqual(findReplacedProcesses(path), [child.pid]);
  assert.deepEqual(findReplacedProcesses(path + '-different'), []);
  assert.deepEqual(findReplacedProcesses(path, '/proc', process.getuid() + 1), []);
  assert.equal(child.exitCode, null);
});

test('the no-install preview isolates app settings and rejects an unreviewed archive', {
  skip: process.getuid?.() === 0 || process.arch !== 'x64' ? 'requires an unprivileged amd64 desktop user' : false,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-launch-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = join(root, 'payload');
  const caller = join(root, 'caller');
  const temporary = join(root, 'temporary');
  for (const path of [join(payload, 'DEBIAN'), join(payload, 'usr/bin'), caller, temporary]) {
    await mkdir(path, { recursive: true });
  }
  await writeFile(join(caller, '.Xauthority'), 'not used to connect in this fixture');
  await writeFile(join(payload, 'DEBIAN/control'),
    'Package: git-khronos\nVersion: 0.1.6\nArchitecture: amd64\nMaintainer: Fixture <fixture@example.test>\nDescription: Owned test archive\n');
  await writeFile(join(payload, 'usr/bin/git-khronos'), `#!/bin/bash
set -eu
test -d "$HOME"
test "$HOME" = "$PWD"
test "$HOME" != "$CALLER_HOME"
test "$XAUTHORITY" = "$CALLER_HOME/.Xauthority"
for name in AT_SPI_BUS_ADDRESS XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME; do
  ! [[ -v $name ]] || exit 91
done
test -n "$DBUS_SESSION_BUS_ADDRESS"
test "$DBUS_SESSION_BUS_ADDRESS" != "$CALLER_BUS"
printf 'fixture executable ran\\n'
exit 17
`, { mode: 0o755 });
  const archive = join(root, 'preview with spaces.deb');
  const build = spawnSync('dpkg-deb', ['--root-owner-group', '--build', payload, archive], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
  const { XAUTHORITY: _ignored, ...env } = process.env;
  const options = {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 10000,
    env: { ...env, HOME: caller, TMPDIR: temporary, DISPLAY: ':999', CALLER_HOME: caller,
      CALLER_BUS: 'unix:path=/unusable-caller-bus',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/unusable-caller-bus', AT_SPI_BUS_ADDRESS: 'inherited',
      XDG_CONFIG_HOME: caller, XDG_DATA_HOME: caller, XDG_STATE_HOME: caller, XDG_CACHE_HOME: caller },
  };
  const call = (digest, packagePath = archive) => spawnSync('bash',
    ['tools/preview-linux-package.sh', packagePath, digest], options);
  const fifo = join(root, 'not-a-package.deb');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  for (const path of [fifo, root, join(root, 'missing.deb')]) {
    const refused = call(sha, path);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /Choose a readable regular Debian archive/);
    assert.doesNotMatch(refused.stdout, /fixture executable ran/);
  }
  assert.deepEqual(await readdir(temporary), []);
  const refused = call('0'.repeat(64));
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /Archive checksum does not match/);
  assert.doesNotMatch(refused.stdout, /fixture executable ran/);
  assert.deepEqual(await readdir(temporary), []);
  const opened = spawnSync('task', ['--exit-code', 'install:linux:preview', '--', archive, sha], options);
  assert.equal(opened.status, 17, opened.stderr);
  assert.match(opened.stdout, /fixture executable ran/);
  assert.deepEqual(await readdir(temporary), []);
  assert.deepEqual(await readdir(caller), ['.Xauthority']);
});

test('checks the installed launcher and executable bytes even when the package versions match', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-installed-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidate = join(root, 'candidate');
  const installed = join(root, 'installed');
  const database = join(root, 'dpkg');
  const executable = 'usr/bin/git-khronos';
  const launcher = 'usr/share/applications/git-khronos.desktop';
  for (const directory of [candidate, installed]) {
    for (const [file, data, mode] of [[executable, 'new build', 0o755], [launcher, 'new launcher', 0o644]]) {
      const path = join(directory, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, { mode });
    }
  }
  await mkdir(database);
  await mkdir(join(candidate, 'DEBIAN'));
  const metadata = (version, architecture) =>
    `Package: git-khronos\nVersion: ${version}\nArchitecture: ${architecture}\nMaintainer: Fixture <fixture@example.test>\nDescription: Owned test archive\n`;
  await writeFile(join(candidate, 'DEBIAN/control'), metadata('0.1.6', 'amd64'));
  const packagePath = join(root, 'Git-Khronos_0.1.6_amd64.deb');
  const build = spawnSync('dpkg-deb', ['--root-owner-group', '--build', candidate, packagePath], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const status = join(database, 'status');
  const setStatus = (version = '0.1.6', state = 'installed') =>
    writeFile(status, metadata(version, 'amd64') + `Status: install ok ${state}\n\n`);
  const userDataDirectory = join(root, 'user-data');
  const desktopDataDirectory = join(root, 'local-share');
  const installedExecutable = join(installed, executable);
  const shadow = join(root, 'private-bin', 'git-khronos');
  const searchPath = [dirname(shadow), dirname(installedExecutable)].join(delimiter);
  const check = () => checkInstalledDeb(packagePath, {
    root: installed, administrativeDirectory: database, userDataDirectory, searchPath,
    desktopDataDirectories: ['relative-dir-is-ignored', desktopDataDirectory, join(installed, 'usr/share')],
  });

  await setStatus();
  assert.equal(check().version, '0.1.6');
  assert.deepEqual(check().files, [join(installed, executable), join(installed, launcher)]);
  assert.equal(check().userLauncher, null);
  assert.equal(check().desktopSearchLauncher, null);
  const localLauncher = join(desktopDataDirectory, 'applications', 'git-khronos.desktop');
  await mkdir(dirname(localLauncher), { recursive: true });
  await writeFile(localLauncher, 'stale local launcher');
  assert.deepEqual(check().desktopSearchLauncher, { path: localLauncher, state: 'differs' });
  assert.deepEqual(check().shellExecutable, { path: installedExecutable, state: 'matches' });
  await mkdir(dirname(shadow));
  await writeFile(shadow, 'different executable', { mode: 0o644 });
  assert.deepEqual(check().shellExecutable, { path: installedExecutable, state: 'matches' });
  await chmod(shadow, 0o755);
  assert.deepEqual(check().shellExecutable, { path: shadow, state: 'differs' });
  await writeFile(shadow, '');
  assert.deepEqual(check().shellExecutable, { path: shadow, state: 'unverified' });
  await rm(shadow);
  await symlink(installedExecutable, shadow);
  assert.deepEqual(check().shellExecutable, { path: shadow, state: 'matches' });
  const userLauncher = join(userDataDirectory, 'applications', 'git-khronos.desktop');
  await mkdir(dirname(userLauncher), { recursive: true });
  await writeFile(userLauncher, 'old user launcher');
  assert.deepEqual(check().userLauncher, { path: userLauncher, state: 'differs' });
  assert.equal(check().desktopSearchLauncher, null, 'a higher-priority user launcher wins');
  await writeFile(userLauncher, 'new launcher');
  assert.deepEqual(check().userLauncher, { path: userLauncher, state: 'matches' });
  await rm(userLauncher);
  await symlink(join(candidate, launcher), userLauncher);
  assert.deepEqual(check().userLauncher, { path: userLauncher, state: 'unverified' });
  await writeFile(join(installed, executable), 'old build');
  await writeFile(join(installed, launcher), 'old launcher');
  assert.throws(check, /Version 0\.1\.6 matches, but .*usr\/bin\/git-khronos differs \(SHA-256 prefixes: .*\); .*git-khronos\.desktop differs/);
  const fingerprint = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
  assert.throws(check, error => [
    ['old build', 'new build'], ['old launcher', 'new launcher'],
  ].every(([actual, expected]) => error.message.includes(`installed ${fingerprint(actual)}, archive ${fingerprint(expected)}`)));
  assert.throws(check, error => error.message.includes(JSON.stringify(packagePath))
    && error.message.includes('then quit and relaunch Git Khronos'));
  await writeFile(join(installed, executable), 'new build');
  await writeFile(join(installed, launcher), 'new launcher');
  await chmod(join(installed, executable), 0o644);
  assert.throws(check, /Expected a regular, bounded executable/);
  await chmod(join(installed, executable), 0o755);
  await rm(join(installed, launcher));
  await symlink(join(candidate, launcher), join(installed, launcher));
  assert.throws(check, /git-khronos\.desktop could not be checked/);
  await setStatus('0.1.5');
  assert.throws(check, /Installed 0\.1\.5 \(amd64\) does not match package 0\.1\.6/);
  await setStatus('0.1.6', 'unpacked');
  assert.throws(check, /is unpacked, not installed/);
  await writeFile(status, '');
  assert.throws(check, /is not installed/);
});

test('packaged CI uploads one verified archive and preserves separate acceptance diagnostics', async () => {
  const ci = (await readFile(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8')).replaceAll('\r\n', '\n');
  const archive = ci.indexOf('name: ubuntu-package');
  const acceptance = ci.indexOf('name: Run packaged WebKitGTK acceptance');
  assert.ok(archive > 0 && acceptance > archive, 'Upload the package before acceptance can fail');
  assert.match(ci, /node tools\/check-linux-abi\.mjs[\s\S]*?sha256sum --check SHA256SUMS\)[\s\S]*?id: native-package-artifact\n\s+with:\n\s+name: ubuntu-package\n\s+path: ubuntu-package\/\*/);
  assert.match(ci, /name: Upload packaged acceptance diagnostics\n\s+uses: actions\/upload-artifact@v4\n\s+if: \$\{\{ !cancelled\(\) && steps\.native-package-artifact\.outcome == 'success' \}\}[\s\S]*?name: packaged-native-[^\n]+\n\s+path: test-results\/native\/\n/);
});

test('installed review diagnostics continue after a sibling failure without publishing qualification evidence', async () => {
  const workflow = (await readFile(join(repositoryRoot, '.github/workflows/linux-package-acceptance.yml'), 'utf8')).replaceAll('\r\n', '\n');
  const [ubuntu, debian] = workflow.split('\n  debian-runtime:\n');
  assert.ok(debian);
  assert.match(ubuntu, /id: package_install/);
  assert.match(ubuntu, /run: bash tools\/run-native-suites\.sh "\$PACKAGE" smoke gitlab/);
  assert.match(ubuntu, /Verify installed GitLab refusal and occupied branch handling\n\s+if: \$\{\{ !cancelled\(\) && steps\.package_install\.outcome == 'success' && matrix\.ubuntu == '26\.04' \}\}\n\s+run: bash tools\/run-native-suites\.sh "\$PACKAGE" gitlab-connect-refused worktrees/);
  assert.match(ubuntu, /Verify the installed app recovers from renderer crashes\n\s+if: \$\{\{ !cancelled\(\) && steps\.package_install\.outcome == 'success' && matrix\.ubuntu == '24\.04' && matrix\.lane == 'runtime' \}\}[\s\S]*?set -o pipefail[\s\S]*?check-installed-x11-launch\.sh --renderer-recovery "\$PACKAGE"[\s\S]*?tee ubuntu-package\/renderer-recovery\.log/);
  assert.match(ubuntu, /path: \|\n(?:\s+[^\n]+\n)*\s+ubuntu-package\/renderer-recovery\.log/);
  const reviews = [...ubuntu.matchAll(/Verify installed workspace and Git workflow reviews \(([^)]+)\)\n\s+if: \$\{\{ !cancelled\(\) && steps\.package_install\.outcome == 'success' && matrix\.ubuntu == '24\.04' && matrix\.lane == '([^']+)' \}\}/g)];
  assert.deepEqual(reviews.map(([, name, lane]) => [name, lane]), [
    ['workspace', 'workspace-review'], ['files', 'file-review'], ['history', 'history-review'],
  ]);
  assert.match(ubuntu, /if: \$\{\{ success\(\) && matrix\.lane == 'publisher' \}\}[\s\S]*?name: debian-candidate-evidence-/);
  assert.match(debian, /fail-fast: false/);
  assert.match(debian, /Verify installed GitLab workflows independently of smoke\n\s+if: \$\{\{ !cancelled\(\) && steps\.package_install\.outcome == 'success' \}\}/);
  assert.doesNotMatch(workflow, /\bcontinue-on-error:/);
});

test('publisher-enabled Jammy acceptance uses independent runtime and publisher lanes', async () => {
  const workflow = await readFile(join(repositoryRoot, '.github/workflows/linux-package-acceptance.yml'), 'utf8');
  const ubuntu = workflow.split('\n  debian-runtime:\n')[0];
  const include = ubuntu.match(/lane: \[runtime\]\s+include: >-\s+\$\{\{ fromJSON\(inputs\.expect-update-trust\s+&& '([^']+)'\s+\|\| '([^']+)'\) \}\}/);
  assert.ok(include, 'Missing release-only lane configuration');
  const jammy = lanes => JSON.parse(lanes).filter(lane => lane.ubuntu === '22.04');
  assert.deepEqual(jammy(include[1]), [{ ubuntu: '22.04', lane: 'publisher' }]);
  assert.deepEqual(jammy(include[2]), []);
  assert.match(ubuntu, /Exercise the installed executable[^\n]*\n\s+if: matrix\.lane == 'runtime'\n\s+run: .* smoke gitlab/);
  assert.match(ubuntu, /Verify installed packed-ref refresh[^\n]*\n\s+if: [^\n]*matrix\.lane == 'runtime'/);
  assert.match(ubuntu, /Exercise Git LFS snapshots[^\n]*\n\s+if: [^\n]*matrix\.lane == 'runtime'/);
  assert.match(ubuntu, /Qualify publisher trust[^\n]*\n\s+if: [^\n]*matrix\.lane == 'publisher'/);
  assert.match(ubuntu, /name: ubuntu-\$\{\{ matrix\.ubuntu \}\}-\$\{\{ matrix\.lane \}\}-/);
});

test('release qualification refuses installer and native version drift before building', async t => {
  const workflow = (await readFile(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')).replaceAll('\r\n', '\n');
  const step = workflow.match(/- name: Check release tag matches installer and runtime versions\n\s+run: \|\n([\s\S]*?)(?=      - name: Install Linux build prerequisites)/)?.[1];
  assert.ok(step, 'Missing early version gate');
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-release-version-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['bin', 'apps/desktop/src-tauri', 'packaging/debian']) {
    await mkdir(join(root, folder), { recursive: true });
  }
  await writeFile(join(root, 'bin/cargo'), `#!/bin/sh
test "$*" = 'metadata --no-deps --format-version 1 --offline --locked' || exit 2
cat metadata.json
`, { mode: 0o755 });
  const current = '2.3.4';
  const defaults = { project: current, app: current, changelog: current, desktop: current, core: current };
  const versionFixtures = async (overrides = {}) => {
    const { project, app, changelog, desktop, core } = { ...defaults, ...overrides };
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: project }));
    await writeFile(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), JSON.stringify({ version: app }));
    await writeFile(join(root, 'packaging/debian/changelog'), `git-khronos (${changelog}) unstable; urgency=medium

  * Isolated release gate fixture.

 -- Fixture <fixture@example.test>  Wed, 18 Nov 2026 10:38:17 +0100
`);
    await writeFile(join(root, 'metadata.json'), JSON.stringify({ packages: [
      { name: 'git-khronos-desktop', version: desktop },
      { name: 'git-khronos-git-core', version: core },
    ] }));
  };
  const run = () => spawnSync('bash', ['-c', step.replace(/^          /gm, '')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, RELEASE_TAG: `v${current}` },
  });
  await versionFixtures();
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  for (const [field, source] of [
    ['project', 'package.json'], ['app', 'tauri.conf.json'], ['changelog', 'Debian-changelog'],
    ['desktop', 'git-khronos-desktop'], ['core', 'git-khronos-git-core'],
  ]) {
    await versionFixtures({ [field]: '2.3.5' });
    const bad = run();
    assert.equal(bad.status, 1);
    assert.ok(bad.stdout.includes(`::error::${source} version 2.3.5 does not match release tag v2.3.4.`), bad.stdout);
  }
});

test('publication fails closed when GitHub reports no required release reviewer', async t => {
  const workflow = (await readFile(join(repositoryRoot, '.github/workflows/publish-signed-debian.yml'), 'utf8')).replaceAll('\r\n', '\n');
  const [verify, publish] = workflow.split('\n  publish:\n');
  const preflight = verify.match(/- name: Require a reviewer-protected release environment before publication\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(preflight);
  assert.match(preflight, /if: vars\.GIT_KHRONOS_SIGNED_PUBLICATION_ENABLED == 'true'/);
  assert.match(publish, /needs: verify[\s\S]*?environment: signed-release[\s\S]*?actions: read/);
  const step = preflight.split('        run: |\n')[1]?.replace(/^          /gm, '');
  assert.ok(step);
  const lastGuard = publish.match(/          # A missing environment[\s\S]*?\n(          if ! gh api[\s\S]*?\n          fi)\n          gh release create/)?.[1];
  assert.ok(lastGuard, 'Check protection again before publishing');
  const guards = [step, 'set -euo pipefail\n' + lastGuard.replace(/^          /gm, '')];
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-release-protection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'gh'), `#!/bin/sh
test "$1 $2" = 'api repos/Git-Khronos/Git-Khronos/environments/signed-release' || exit 9
test "$#" -eq 2 || exit 9
test "$STATUS" = ok || exit 1
printf '%s\n' "$REPLY"
`, { mode: 0o755 });
  for (const guard of guards) {
    const run = (info, STATUS = 'ok') => spawnSync('bash', ['-c', guard], { encoding: 'utf8', env: {
      ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY: 'Git-Khronos/Git-Khronos', STATUS, REPLY: JSON.stringify(info),
    } });
    const good = { name: 'signed-release', protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'Team' }] }] };
    const accepted = run(good);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    for (const bad of [
      run(good, 'unavailable'),
      run({ ...good, name: 'unrelated' }),
      run({ ...good, protection_rules: [] }),
      run({ ...good, protection_rules: [{ type: 'wait_timer' }] }),
      run({ ...good, protection_rules: [{ type: 'required_reviewers', reviewers: [] }] }),
    ]) {
      assert.equal(bad.status, 1);
      assert.match(bad.stdout, /::error::.*reviewer/i);
      assert.doesNotMatch(bad.stdout, /Team/);
    }
  }
});

test('signed publication requires installed reports from the selected candidate attempt', async () => {
  const runtime = await readFile(join(repositoryRoot, '.github/workflows/linux-package-acceptance.yml'), 'utf8');
  const publish = await readFile(join(repositoryRoot, '.github/workflows/publish-signed-debian.yml'), 'utf8');
  for (const platform of ['ubuntu', 'debian']) {
    assert.ok(runtime.includes(`debian-runtime-reports-\${{ github.run_attempt }}-${platform}-`));
  }
  assert.equal((runtime.match(/path: test-results\/native\/\*\*\/report\.json/g) ?? []).length, 2);
  assert.ok(publish.includes('pattern: debian-runtime-reports-${{ steps.candidate.outputs.attempt }}-*'));
  const beforeStaging = publish.split('name: Prepare and reverify exactly the assets to upload')[0];
  assert.match(beforeStaging, /report-installed-acceptance\.mjs --verify-release[\s\S]*?--reports-dir candidate-matrix/);
});

test('Linux runtime CI provisions authenticated X11, D-Bus and matching WebDriver packages', async (t) => {
  const workflow = (await readFile(join(repositoryRoot, '.github/workflows/linux-package-acceptance.yml'), 'utf8')).replaceAll('\r\n', '\n');
  const step = workflow.match(/      - name: Install runtime acceptance prerequisites\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(step, 'Missing runtime prerequisite step');
  assert.match(step, /UBUNTU_RELEASE: \$\{\{ matrix\.ubuntu \}\}/);
  const script = step.split('        run: |\n')[1]?.replace(/^          /gm, '');
  assert.ok(script, 'Missing runtime prerequisite commands');
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-webdriver-ci-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  await mkdir(bin);
  const commands = {
    sudo: '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n',
    'apt-get': '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\n',
    install: '#!/bin/sh\nprintf "install %s\\n" "$*" >> "$COMMAND_LOG"\n',
    dpkg: '#!/bin/sh\n[ "$1" = --print-architecture ] && printf "amd64\\n"\n',
    cargo: '#!/bin/sh\nprintf "cargo %s\\n" "$*" >> "$COMMAND_LOG"\n',
    rustup: '#!/bin/sh\nprintf "rustup %s\\n" "$*" >> "$COMMAND_LOG"\n',
    WebKitWebDriver: '#!/bin/sh\nexit 99\n',
    'dbus-daemon': '#!/bin/sh\nexit 99\n',
    'dbus-send': '#!/bin/sh\nexit 99\n',
    'dbus-run-session': '#!/bin/sh\nexit 99\n',
    'dpkg-query': `#!/bin/sh
case "$*" in
  *libwebkit2gtk-4.1-0) printf '%s' "$RUNTIME_VERSION" ;;
  *) printf '%s' '2.52.0-1' ;;
esac
`,
  };
  for (const [name, content] of Object.entries(commands)) {
    await writeFile(join(bin, name), content, { mode: 0o755 });
  }
  for (const [release, expected] of [
    ['22.04', 'webkit2gtk-driver'], ['24.04', 'webkit2gtk-driver'], ['26.04', 'webkitgtk-webdriver'],
  ]) {
    const log = join(root, release);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: log,
      UBUNTU_RELEASE: release, ACCEPTANCE_LANE: 'runtime', EXPECT_UPDATE_TRUST: 'false', RUNTIME_VERSION: '2.52.0-1' };
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    for (const tool of ['WebKitWebDriver', 'dbus-daemon', 'dbus-send', 'dbus-run-session']) {
      assert.ok(result.stdout.includes(join(bin, tool)), `Missing discovery check for ${tool}`);
    }
    const calls = await readFile(log, 'utf8');
    assert.match(calls, new RegExp(`install --yes ${expected} libwebkit2gtk-4\\.1-0 `));
    assert.match(calls, / xvfb xauth /);
    assert.match(calls, / dbus\s/);
    assert.doesNotMatch(calls, / dbus-(?:daemon|bin)(?:\s|$)/);
    assert.doesNotMatch(calls, / iproute2 util-linux/);
    assert.match(calls, /cargo install tauri-driver --locked --version 2\.0\.6/);
    await writeFile(log, '');
    const trusted = spawnSync('bash', ['-c', script], {
      encoding: 'utf8', env: { ...env, EXPECT_UPDATE_TRUST: 'true' },
    });
    assert.equal(trusted.status, 0, trusted.stderr);
    assert.equal((await readFile(log, 'utf8')).includes(' iproute2 util-linux'), release === '24.04');
    if (release === '24.04') {
      await writeFile(log, '');
      const review = spawnSync('bash', ['-c', script], {
        encoding: 'utf8', env: { ...env, ACCEPTANCE_LANE: 'workspace-review', EXPECT_UPDATE_TRUST: 'true' },
      });
      assert.equal(review.status, 0, review.stderr);
      assert.doesNotMatch(await readFile(log, 'utf8'), / iproute2 util-linux/);
    }
    await writeFile(log, '');
    const mismatch = spawnSync('bash', ['-c', script], {
      encoding: 'utf8', env: { ...env, RUNTIME_VERSION: '2.50.0-1' },
    });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /WebKitWebDriver and WebKitGTK runtime versions differ/);
    assert.doesNotMatch(await readFile(log, 'utf8'), /cargo/);
  }
  const unknownLog = join(root, 'unknown');
  const unknown = spawnSync('bash', ['-c', script], { encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: unknownLog,
      UBUNTU_RELEASE: 'unknown' } });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unsupported Ubuntu release/);
  await assert.rejects(readFile(unknownLog), { code: 'ENOENT' });
  const ci = (await readFile(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8')).replaceAll('\r\n', '\n');
  const buildScript = ci.match(/      - name: Install Linux package and WebDriver prerequisites\n        run: \|\n([\s\S]*?)(?=      - )/)?.[1]?.replace(/^          /gm, '');
  assert.ok(buildScript, 'Missing Jammy build prerequisite commands');
  const buildLog = join(root, 'build');
  const build = spawnSync('bash', ['-c', buildScript], { encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: buildLog } });
  assert.equal(build.status, 0, build.stderr);
  const buildCalls = await readFile(buildLog, 'utf8');
  assert.match(buildCalls, / webkit2gtk-driver /);
  assert.match(buildCalls, / dbus\s/);
  assert.doesNotMatch(buildCalls, / dbus-(?:daemon|bin)(?:\s|$)/);
  for (const tool of ['WebKitWebDriver', 'dbus-daemon', 'dbus-send', 'dbus-run-session']) {
    assert.ok(build.stdout.includes(join(bin, tool)), `Missing Jammy discovery check for ${tool}`);
  }

  const debianStep = workflow.match(/      - name: Install Debian runtime acceptance prerequisites\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(debianStep, 'Missing Debian runtime prerequisite step');
  assert.match(debianStep, /DEBIAN_RELEASE: \$\{\{ matrix\.debian \}\}/);
  const debianScript = debianStep.split('        run: |\n')[1]?.replace(/^          /gm, '');
  assert.ok(debianScript, 'Missing Debian runtime prerequisite commands');
  for (const [release, expected] of [['12', 'webkit2gtk-driver'], ['13', 'webkitgtk-webdriver']]) {
    const log = join(root, `debian-${release}`);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COMMAND_LOG: log,
      DEBIAN_RELEASE: release, RUNTIME_VERSION: '2.52.0-1' };
    const result = spawnSync('bash', ['-c', debianScript], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    for (const tool of ['WebKitWebDriver', 'dbus-daemon', 'dbus-send', 'dbus-run-session']) {
      assert.ok(result.stdout.includes(join(bin, tool)), `Missing Debian discovery check for ${tool}`);
    }
    for (const tool of ['cargo', 'rustup']) {
      assert.ok(result.stdout.includes(join(bin, tool)), `Missing Debian tool path for ${tool}`);
    }
    const calls = await readFile(log, 'utf8');
    assert.match(calls, / xvfb xauth /);
    assert.match(calls, new RegExp(`install --yes ${expected} libwebkit2gtk-4\\.1-0`));
    assert.match(calls, /install -d -m 0755 \/run\/sshd/);
    assert.match(calls, /dbus-daemon dbus-bin/);
    assert.match(calls, /cargo install tauri-driver --locked --version 2\.0\.6/);
    const mismatch = spawnSync('bash', ['-c', debianScript], {
      encoding: 'utf8', env: { ...env, COMMAND_LOG: `${log}-mismatch`, RUNTIME_VERSION: '2.50.0-1' },
    });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /WebKitWebDriver and WebKitGTK runtime versions differ/);
    assert.doesNotMatch(await readFile(`${log}-mismatch`, 'utf8'), /cargo/);
  }
  assert.match(workflow, /debian: \["12", "13"\]/);
  assert.match(workflow, /apt-get install --yes --no-remove "\$package"/);
  assert.match(workflow, /sha256sum --check SHA256SUMS/);
  const debianWorkflow = workflow.split('  debian-runtime:\n')[1];
  assert.ok(debianWorkflow, 'Missing Debian runtime job');
  assert.match(debianWorkflow, /strategy:\n      fail-fast: false\n      matrix:\n        debian:/);
  const bootstrap = debianWorkflow.match(/      - name: Bootstrap tools for Debian container actions\n([\s\S]*?)(?=      - (?:name:|uses:))/)?.[1];
  assert.ok(bootstrap, 'Missing Debian container action prerequisites');
  assert.match(bootstrap, /apt-get install --yes ca-certificates curl gcc git libc6-dev tar xz-utils/);
  const bootstrapIndex = debianWorkflow.indexOf('Bootstrap tools for Debian container actions');
  for (const action of ['actions/setup-node@v4', 'dtolnay/rust-toolchain@master', 'Swatinem/rust-cache@v2']) {
    assert.ok(bootstrapIndex < debianWorkflow.indexOf(action), `Debian bootstrap must precede ${action}`);
  }
  assert.match(workflow, /name: debian-\$\{\{ matrix\.debian \}\}-runtime-\$\{\{ github\.run_id \}\}\n\s+path: \|\n\s+test-results\/native\/\*\*\n\s+ubuntu-package\/abi-runtime\.json/);
});

test('Jammy CI restores known dpkg hooks after successful and failed fixture runs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'git-khronos-ci-hooks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hooks = join(root, 'hooks');
  const bin = join(root, 'bin');
  const temporary = join(root, 'temporary');
  for (const directory of [hooks, bin, temporary]) await mkdir(directory);
  const originals = { needrestart: 'post-invoke=fixture-needrestart\n',
    'pkg-config-hook-config': 'post-invoke=fixture-pkg-config\n',
    unrelated: 'preserve\n' };
  for (const [name, content] of Object.entries(originals)) {
    await writeFile(join(hooks, name), content, { mode: 0o640 });
  }
  await symlink('missing-hook-target', join(hooks, 'pkgconf-hook-config'));
  await writeFile(join(bin, 'sudo'), `#!/bin/sh
[ "$1" = mv ] || exit 99
if [ "$3" = "$HOOK_DIRECTORY/pkg-config-hook-config" ] && [ "\${FAIL_HOOK_MOVE:-}" = 1 ]; then
  exit 23
fi
exec "$@"
`, { mode: 0o755 });
  await writeFile(join(bin, 'pnpm'), `#!/bin/sh
[ ! -e "$HOOK_DIRECTORY/needrestart" ] || exit 98
[ ! -e "$HOOK_DIRECTORY/pkg-config-hook-config" ] || exit 98
[ ! -L "$HOOK_DIRECTORY/pkgconf-hook-config" ] || exit 98
[ -f "$HOOK_DIRECTORY/unrelated" ] || exit 98
printf 'isolated fixtures\\n'
exit "$FIXTURE_EXIT"
`, { mode: 0o755 });
  for (const file of ['ci.yml', 'release.yml']) {
    const workflow = (await readFile(join(repositoryRoot, '.github/workflows', file), 'utf8')).replaceAll('\r\n', '\n');
    assert.match(workflow, /^      - uses: \.\/\.github\/actions\/debian-package-regressions$/m,
      `Missing shared packaging regression action in ${file}`);
  }
  const action = join(repositoryRoot, '.github/actions/debian-package-regressions');
  assert.match(await readFile(join(action, 'action.yml'), 'utf8'), /run: bash "\$GITHUB_ACTION_PATH\/run\.sh"/);
  const source = await readFile(join(action, 'run.sh'), 'utf8');
  assert.ok(source.includes('config=/etc/dpkg/dpkg.cfg.d\n'));
  const script = source.replace('config=/etc/dpkg/dpkg.cfg.d\n', 'config="$HOOK_DIRECTORY"\n');
  for (const { exit, failMove } of [{ exit: 0 }, { exit: 7 }, { exit: 23, failMove: true }]) {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: temporary,
        HOOK_DIRECTORY: hooks, FIXTURE_EXIT: String(exit), FAIL_HOOK_MOVE: failMove ? '1' : '' } });
    assert.equal(result.status, exit, result.stderr);
    if (failMove) {
      assert.doesNotMatch(result.stdout, /isolated fixtures/);
      assert.match(result.stderr, /Could not temporarily disable dpkg hook: pkg-config-hook-config/);
    } else {
      assert.match(result.stdout, /isolated fixtures/);
    }
    for (const [name, content] of Object.entries(originals)) {
      assert.equal(await readFile(join(hooks, name), 'utf8'), content);
      assert.equal((await stat(join(hooks, name))).mode & 0o777, 0o640);
    }
    assert.equal(await readlink(join(hooks, 'pkgconf-hook-config')), 'missing-hook-target');
    assert.deepEqual(await readdir(temporary), []);
  }
});

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

async function fixture(t, { isolated = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'git-khronos-incremental-deb-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = isolated ? join(directory, 'target/local-review/fixture/work/source') : directory;
  await mkdir(join(root, 'tools'), { recursive: true });
  const put = async (path, content = 'fixture') => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await copyFile(join(repositoryRoot, 'Taskfile.yml'), join(root, 'Taskfile.yml'));
  await put('tools/check-node.mjs', '');
  await put('tools/require-ubuntu-jammy.sh', '#!/bin/sh\ntest -z "$FAIL_HOST_CHECK"\n');
  await put('tools/check-linux-abi.mjs', `import { appendFileSync, readFileSync } from 'node:fs';
if (readFileSync(process.argv[2], 'utf8') !== 'built') throw new Error('Wrong ABI check input');
appendFileSync('calls', 'abi\\n');
if (process.env.FAIL_ABI) process.exit(1);
`);
  await copyFile(join(repositoryRoot, 'tools/package-build-receipt.mjs'), join(root, 'tools/package-build-receipt.mjs'));
  await copyFile(join(repositoryRoot, 'tools/build-linux-package.sh'), join(root, 'tools/build-linux-package.sh'));
  await copyFile(join(repositoryRoot, 'tools/finish-linux-package-cache.mjs'), join(root, 'tools/finish-linux-package-cache.mjs'));
  await copyFile(join(repositoryRoot, 'tools/check-linux-appimage.mjs'), join(root, 'tools/check-linux-appimage.mjs'));
  await copyFile(join(repositoryRoot, 'tools/check-linux-package-watcher.mjs'), join(root, 'tools/check-linux-package-watcher.mjs'));
  await copyFile(join(repositoryRoot, 'tools/cli-entry.mjs'), join(root, 'tools/cli-entry.mjs'));
  await put('apps/desktop/src/main.ts');
  await put('apps/desktop/src-tauri/tauri.conf.json');
  await put('apps/desktop/src-tauri/Cargo.toml');
  await put('crates/git-core/src/lib.rs');
  await put('packaging/debian/changelog');
  await put('bin/pnpm', `#!/usr/bin/env node
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
if (process.argv[2] === '--version') {
  console.log('12.14.0');
} else {
  const appimage = !!process.env.EXPECT_APPIMAGE;
  const expected = [
    'exec', 'tauri', 'build', '--bundles', appimage ? 'appimage' : 'deb', '--config',
    'apps/desktop/src-tauri/tauri.conf.json'
  ];
  if (process.env.EXPECT_JAMMY) expected.push('--config', 'packaging/linux/ubuntu-jammy.conf.json');
  if (appimage) expected.push('--config', 'packaging/linux/appimage-notices.conf.json');
  if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) {
    throw new Error('Unexpected build command: ' + process.argv.slice(2));
  }
  if (!process.env.TMPDIR || !existsSync(process.env.TMPDIR)) throw new Error('Missing build temp directory');
  const lock = spawnSync('flock', ['-n', '-E', '73', 'target/.git-khronos-linux-package.lock', 'true']);
  if (lock.status !== 73) throw new Error('Package writes started without the workspace lock');
  writeFileSync('build-tmpdir', process.env.TMPDIR);
  appendFileSync('calls', 'build\\n');
  if (process.env.PACKAGE_REAL_CARGO) {
    const probe = spawnSync('cargo', ['run', '--release', '--locked', '--offline', '--quiet'], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(probe.error ?? probe.stderr);
    writeFileSync('native-probe', probe.stdout);
  }
  if (process.env.HARD_STOP_BUILD) {
    // Kill only this fixture's direct writer; never a caller or host job.
    const parent = '/proc/' + process.ppid;
    const args = readFileSync(parent + '/cmdline', 'utf8').split('\0');
    if (!readlinkSync(parent + '/exe').endsWith('/bash') ||
        args[1] !== 'tools/build-linux-package.sh' || readlinkSync(parent + '/cwd') !== process.cwd()) {
      throw new Error('Refused to interrupt an unverified fixture parent');
    }
    process.kill(process.ppid, 'SIGKILL');
    process.exit(99);
  }
  if (process.env.FAIL_BUILD) process.exit(1);
  const generated = appimage
    ? ['target/release/bundle/appimage/Git-Khronos_0.1.0_amd64.AppImage']
    : ${JSON.stringify(outputs)};
  for (const path of generated) {
    const output = process.env.CARGO_TARGET_DIR && path.startsWith('target/release/')
      ? process.env.CARGO_TARGET_DIR + path.slice('target'.length) : path;
    mkdirSync(dirname(output), { recursive: true });
    const header = Buffer.alloc(232);
    header.set([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0, 0x41, 0x49, 0x02]);
    header.writeUInt16LE(2, 16);
    header.writeUInt16LE(62, 18);
    header.writeBigUInt64LE(64n, 40);
    header.writeUInt16LE(64, 58);
    header.writeUInt16LE(1, 60);
    header.write('hsqs', 128);
    header.writeUInt16LE(4, 156);
    header.writeBigUInt64LE(100n, 168);
    writeFileSync(output, appimage ? header : 'built');
    if (appimage) chmodSync(output, 0o755);
  }
  mkdirSync('apps/desktop/src-tauri/gen/schemas', { recursive: true });
  writeFileSync('apps/desktop/src-tauri/gen/schemas/capabilities.json', Date.now().toString());
}
`);
  await put('bin/rustc', '#!/bin/sh\nprintf "rustc fixture\\n"\n');
  await put('bin/cargo', `#!/bin/sh
if [ -n "$PACKAGE_REAL_CARGO" ]; then
  unset RUSTC
  if [ -z "$CARGO_TARGET_DIR" ]; then unset CARGO_TARGET_DIR; fi
  PATH="$PACKAGE_REAL_PATH" exec "$PACKAGE_REAL_CARGO" "$@"
fi
test -z "$FAIL_CARGO_CLEAN"
`);
  await put('tools/manage-linux-package.sh', `#!/bin/sh
[ "$1" = name ] && exit 0
[ "$1" = print-package ] && { package="\${CARGO_TARGET_DIR:-target}/release/bundle/deb/Git-Khronos_0.1.0_amd64.deb"; grep -qx built "$package" || exit $?; case "$package" in /*) printf '%s\\n' "$package" ;; *) printf '%s\\n' "$PWD/$package" ;; esac; exit 0; }
if [ "$1" = installed-status ]; then
  [ "$#" -le 2 ] || exit 2
  archive=latest
  [ "$#" -eq 1 ] || archive=$2
  printf 'installed-status %s\\n' "$archive" >> calls
  exit 0
fi
if [ "$1" = simulate-install ] && [ "$#" -gt 1 ]; then
  [ "$#" -eq 2 ] || exit 2
  printf 'simulate-install %s\\n' "$2" >> calls
  exit 0
fi
printf '%s\\n' "$1" >> calls
test -z "$FAIL_VERIFY"
`);
  for (const executable of ['bin/pnpm', 'bin/rustc', 'bin/cargo', 'tools/manage-linux-package.sh']) {
    await chmod(join(root, executable), 0o755);
  }
  const run = (args = ['package:deb'], extraEnv = {}) => spawnSync('task', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', CARGO_TARGET_DIR: '', ...extraEnv, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
  });
  const ok = (args, env) => {
    const result = run(args, env);
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  };
  const calls = async () => (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n');
  const builds = async () => (await calls()).filter((call) => call === 'build').length;
  return { root, put, run, ok, calls, builds };
}

test('installed status forwards a single selected archive without a build or install', async (t) => {
  const f = await fixture(t);
  const archive = 'archived installers/Git-Khronos_0.1.6_amd64.deb';
  f.ok(['install:linux:status']);
  f.ok(['install:linux:status', '--', archive]);
  assert.notEqual(f.run(['install:linux:status', '--', archive, 'another.deb']).status, 0);
  assert.deepEqual(await f.calls(), ['installed-status latest', 'installed-status ' + archive]);
});

test('package wrapper prunes isolated Rust internals on success and ordinary failure', async t => {
  const f = await fixture(t, { isolated: true });
  const cache = 'target/release/deps/generated.o';
  const keep = 'target/release/bundle/deb/Git-Khronos_0.1.0_amd64.deb';
  await f.put(cache);
  f.ok();
  await assert.rejects(stat(join(f.root, cache)), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.root, keep), 'utf8'), 'built');
  await f.put(cache);
  const failed = f.run(['--force', 'package:deb'], { FAIL_BUILD: '1' });
  assert.notEqual(failed.status, 0);
  await assert.rejects(stat(join(f.root, cache)), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.root, keep), 'utf8'), 'built');
});

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

test('Jammy records an exact package only after host and ABI gates and cannot reuse generic output', async (t) => {
  const f = await fixture(t);
  const jammy = ['package:ubuntu'];
  const env = { EXPECT_JAMMY: '1', GIT_KHRONOS_UPDATER_PUBLIC_KEY: 'fixture publisher key' };
  const receipt = join(f.root, 'target/release/.git-khronos-package-build.v1.json');
  assert.notEqual(f.run(jammy, { ...env, FAIL_HOST_CHECK: '1' }).status, 0);
  await assert.rejects(readFile(join(f.root, 'calls')), { code: 'ENOENT' });
  assert.notEqual(f.run(jammy, { ...env, FAIL_ABI: '1' }).status, 0);
  await assert.rejects(readFile(receipt), { code: 'ENOENT' });
  f.ok(jammy, env);
  f.ok(jammy, env);
  assert.deepEqual(await f.calls(), ['build', 'abi', 'build', 'abi']);
  assert.match(JSON.parse(await readFile(receipt, 'utf8')).checksum, /^ubuntu-jammy:.+/);
  f.ok(undefined, { GIT_KHRONOS_UPDATER_PUBLIC_KEY: env.GIT_KHRONOS_UPDATER_PUBLIC_KEY });
  assert.deepEqual((await f.calls()).slice(-2), ['build', 'verify']);
  f.ok(['--force', ...jammy], env);
  assert.deepEqual((await f.calls()).slice(-2), ['build', 'abi']);
});

test('AppImage fails before compiling if the file command is missing', () => {
  const result = spawnSync('/bin/bash', ['tools/build-linux-package.sh', 'ubuntu-jammy-appimage', 'owned', 'unused.json'], {
    cwd: repositoryRoot,
    env: { ...process.env, PATH: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /file command is required by the AppImage packager/);
});

test('AppImage builds only on the Jammy baseline, are checked as executable ELF artifacts, and rebuild each time', async (t) => {
  const f = await fixture(t);
  const appimage = ['package:appimage'];
  const env = { EXPECT_APPIMAGE: '1', EXPECT_JAMMY: '1' };
  assert.notEqual(f.run(appimage, { ...env, FAIL_HOST_CHECK: '1' }).status, 0);
  await assert.rejects(readFile(join(f.root, 'calls')), { code: 'ENOENT' });

  f.ok(appimage, env);
  f.ok(appimage, env);
  assert.deepEqual(await f.calls(), ['build', 'build']);
  const artifact = join(f.root, 'target/release/bundle/appimage/Git-Khronos_0.1.0_amd64.AppImage');
  assert.deepEqual((await readFile(artifact)).subarray(0, 4), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  assert.equal((await stat(artifact)).mode & 0o111, 0o111);
  const pathTask = f.run(['package:appimage:path'], env);
  assert.equal(pathTask.status, 0, `${pathTask.stdout}\n${pathTask.stderr}`);
  assert.match(pathTask.stdout, /Git-Khronos_0\.1\.0_amd64\.AppImage/);
  assert.equal(await f.builds(), 3);
  await assert.rejects(readFile(join(f.root, 'target/release/.git-khronos-package-build.v1.json')),
    { code: 'ENOENT' }, 'an AppImage must not be mistaken for the Debian package receipt');
});

test('Rust environment overrides invalidate the Debian build even when source files match', async (t) => {
  const f = await fixture(t);
  const first = { RUSTFLAGS: '--cfg owned_a' };
  const second = { RUSTFLAGS: '--cfg owned_b' };
  f.ok(undefined, first);
  f.ok(undefined, first);
  assert.equal(await f.builds(), 1);
  const path = join(f.root, 'target/release/.git-khronos-package-build.v1.json');
  const { checksum } = JSON.parse(await readFile(path, 'utf8'));
  const mismatch = spawnSync(process.execPath, ['tools/package-build-receipt.mjs', 'check', checksum],
    { cwd: f.root, encoding: 'utf8', env: { ...process.env, ...second } });
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /package build settings changed/);
  assert.doesNotMatch(mismatch.stderr, /owned_[ab]/);
  f.ok(undefined, second);
  assert.equal(await f.builds(), 2);
  f.ok(undefined, { ...second, CARGO_PROFILE_RELEASE_LTO: 'thin' });
  assert.equal(await f.builds(), 3);
  const receipt = await readFile(path, 'utf8');
  assert.match(JSON.parse(receipt).buildConfiguration.rustOverridesSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(receipt, /owned_[ab]|thin/);
});

test('cache checks reject nonregular receipts and renderer outputs without hanging', { skip: process.platform !== 'linux' }, async (t) => {
  const f = await fixture(t);
  f.ok();
  const receipt = join(f.root, 'target/release/.git-khronos-package-build.v1.json');
  const renderer = join(f.root, 'dist/apps/desktop/browser/index.html');
  const { checksum } = JSON.parse(await readFile(receipt, 'utf8'));
  const check = () => spawnSync(process.execPath,
    ['tools/package-build-receipt.mjs', 'check', checksum], { cwd: f.root, encoding: 'utf8', timeout: 2000 });
  for (const [file, message] of [
    [receipt, /Invalid package build receipt metadata/],
    [renderer, /Expected a bounded regular package build output/],
  ]) {
    const saved = file + '.owned-original';
    await rename(file, saved);
    const pipe = spawnSync('mkfifo', [file], { encoding: 'utf8' });
    assert.equal(pipe.status, 0, pipe.stderr);
    const rejected = check();
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, message);
    await unlink(file);
    await rename(saved, file);
  }
  const cached = check();
  assert.equal(cached.status, 0, cached.stderr);
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

test('a changed Rust workspace member is compiled even when its file is older than the Cargo cache', async (t) => {
  const cargo = spawnSync('which', ['cargo'], { encoding: 'utf8' });
  assert.equal(cargo.status, 0, 'this Linux package regression requires Cargo');
  const f = await fixture(t);
  await f.put('Cargo.toml', '[workspace]\nmembers = ["crates/git-core", "apps/desktop/src-tauri"]\nresolver = "2"\n');
  await f.put('crates/git-core/Cargo.toml', '[package]\nname = "probe-core"\nversion = "0.1.0"\nedition = "2021"\n');
  await f.put('apps/desktop/src-tauri/Cargo.toml', '[package]\nname = "probe-app"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nprobe-core = { path = "../../../crates/git-core" }\n');
  await f.put('apps/desktop/src-tauri/src/main.rs', 'fn main() { println!("{}", probe_core::value()); }\n');
  const core = 'crates/git-core/src/lib.rs';
  await f.put(core, 'pub fn value() -> u8 { 1 }\n');
  const lock = spawnSync(cargo.stdout.trim(), ['generate-lockfile', '--offline'], { cwd: f.root, encoding: 'utf8' });
  assert.equal(lock.status, 0, lock.stderr);
  const env = { PACKAGE_REAL_CARGO: cargo.stdout.trim(), PACKAGE_REAL_PATH: process.env.PATH };
  const value = () => readFile(join(f.root, 'native-probe'), 'utf8');
  f.ok(undefined, env);
  assert.equal(await value(), '1\n');
  await f.put(core, 'pub fn value() -> u8 { 2 }\n');
  await utimes(join(f.root, core), new Date(0), new Date(0));
  f.ok(undefined, env);
  assert.equal(await f.builds(), 2, 'Task noticed the changed bytes and invoked the package build');
  assert.equal(await value(), '2\n', 'the new package build must not reuse old native code');
  f.ok(undefined, env);
  assert.equal(await f.builds(), 2, 'an unchanged receipt still skips the build entirely');
});

test('failure to invalidate Cargo workspace outputs cannot qualify a package under a new source checksum', async (t) => {
  const f = await fixture(t);
  f.ok();
  const receipt = join(f.root, 'target/release/.git-khronos-package-build.v1.json');
  const oldReceipt = await readFile(receipt, 'utf8');
  await f.put('crates/git-core/src/lib.rs', 'new input');
  assert.notEqual(f.run(undefined, { FAIL_CARGO_CLEAN: '1' }).status, 0);
  assert.equal(await f.builds(), 1, 'Tauri did not start after the invalidation failure');
  assert.equal(await readFile(receipt, 'utf8'), oldReceipt);
  await stat(`${receipt}.pending`);
  f.ok();
  assert.equal(await f.builds(), 2);
  assert.notEqual(JSON.parse(await readFile(receipt, 'utf8')).checksum, JSON.parse(oldReceipt).checksum);
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

test('system installation rejects archive arguments instead of building or installing another package', async (t) => {
  const f = await fixture(t);
  const result = f.run(['install:linux', '--', 'archived builds/Git-Khronos_0.1.6_amd64.deb']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /takes no archive argument/);
  await assert.rejects(f.calls(), { code: 'ENOENT' });
});

test('the local install preview builds and verifies the package without invoking install', async (t) => {
  const f = await fixture(t);
  f.ok(['install:linux:dry-run']);
  f.ok(['install:system:dry-run']);
  assert.deepEqual(await f.calls(), ['build', 'verify', 'simulate-install', 'verify', 'simulate-install']);
  assert.notEqual(f.run(['install:linux:dry-run'], { FAIL_VERIFY: '1' }).status, 0);
  assert.equal((await f.calls()).at(-1), 'verify');
});

test('previewing a selected archive does not start a build', async (t) => {
  const f = await fixture(t);
  const archive = 'archived builds/Git-Khronos_0.1.6_amd64.deb';
  f.ok(['install:linux:dry-run', '--', archive]);
  assert.notEqual(f.run(['install:linux:dry-run', '--', archive, 'another.deb']).status, 0);
  assert.deepEqual(await f.calls(), ['simulate-install ' + archive]);
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
    'Depends: git (>= 1:2.39), libc6 (>= 2.35), libwebkit2gtk-4.1-0, libgtk-3-0',
    'Description: Package payload regression fixture', '',
  ].join('\n'));
  await put('usr/bin/git-khronos', '#!/bin/sh\nexit 0\n');
  await chmod(join(payload, 'usr/bin/git-khronos'), 0o755);
  await put('usr/share/applications/git-khronos.desktop', [
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

test('local install preview uses unprivileged APT simulation for normal and legacy installs', async (t) => {
  const f = await packagePayloadFixture(t);
  f.build();
  const bin = join(f.root, 'bin');
  const aptLog = join(f.root, 'apt-preview');
  const deniedLog = join(f.root, 'privileged-command');
  await mkdir(bin);
  const refuse = '#!/bin/sh\n: > "$DENIED_LOG"\nexit 99\n';
  await writeFile(join(bin, 'sudo'), refuse, { mode: 0o755 });
  await writeFile(join(f.root, 'tools/guard-linux-package-transition.sh'), refuse, { mode: 0o755 });
  await writeFile(join(bin, 'dpkg-query'), '#!/bin/sh\nprintf "%s" "$LEGACY_STATUS"\n', { mode: 0o755 });
  await writeFile(join(bin, 'apt-get'), '#!/bin/sh\n[ "$1" = install ] && [ "$2" = --simulate ] || exit 99\nprintf "%s\\n" "$@" > "$APT_LOG"\n', { mode: 0o755 });
  const run = (legacy, ...archives) => spawnSync('bash', [f.script, 'simulate-install', ...archives], { encoding: 'utf8',
    env: { ...process.env, CARGO_TARGET_DIR: '', TMPDIR: f.root, PATH: `${bin}:${process.env.PATH}`,
      APT_LOG: aptLog, DENIED_LOG: deniedLog, LEGACY_STATUS: legacy },
  });
  for (const [status, flags] of [['not-installed', ['--no-remove']], ['installed', ['-o', 'APT::Get::Assume-Yes=false']]]) {
    const preview = run(status);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /APT dry run only/);
    assert.doesNotMatch(preview.stdout, /Git Khronos is installed/);
    assert.deepEqual((await readFile(aptLog, 'utf8')).trim().split('\n'), [
      'install', '--simulate', '--reinstall', ...flags, f.artifact,
    ]);
    await assert.rejects(stat(deniedLog), { code: 'ENOENT' });
  }
  await rm(aptLog);
  await writeFile(join(f.root, 'target/release/git-khronos'), 'not the verified binary');
  const refused = run('not-installed');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /packaged executable differs/);
  await assert.rejects(stat(aptLog), { code: 'ENOENT' });

  // An explicit archive is independent of the most recent build directory,
  // but still only reaches unprivileged APT simulation with the exact path.
  const archive = join(f.root, 'archive with spaces.deb');
  await copyFile(f.artifact, archive);
  const explicit = run('not-installed', archive);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(explicit.stdout, /not verifying release provenance/);
  assert.deepEqual((await readFile(aptLog, 'utf8')).trim().split('\n'), [
    'install', '--simulate', '--reinstall', '--no-remove', archive,
  ]);
  await assert.rejects(stat(deniedLog), { code: 'ENOENT' });
  await rm(aptLog);
  const invalid = join(f.root, 'not-a-package.deb');
  await writeFile(invalid, 'not a package');
  assert.notEqual(run('not-installed', invalid).status, 0);
  await assert.rejects(stat(aptLog), { code: 'ENOENT' });

  const install = spawnSync('bash', [f.script, 'install', archive], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APT_LOG: aptLog, DENIED_LOG: deniedLog },
  });
  assert.notEqual(install.status, 0);
  assert.match(install.stderr, /install \(no archive argument\)/);
  await assert.rejects(stat(aptLog), { code: 'ENOENT' });
  await assert.rejects(stat(deniedLog), { code: 'ENOENT' });
});

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

test('local package verification keeps generated stronger glibc requirements and rejects a missing baseline', async (t) => {
  const { payload, put, build, verify } = await packagePayloadFixture(t);
  build();
  assert.equal(verify().status, 0);

  const control = await readFile(join(payload, 'DEBIAN/control'), 'utf8');
  await put('DEBIAN/control', control.replace('libc6 (>= 2.35)', 'libc6 (>= 2.39)'));
  build();
  assert.equal(verify().status, 0, 'local builds on newer systems must retain their truthful dependencies');
  await put('DEBIAN/control', control.replace('libc6 (>= 2.35)', 'libc6'));
  build();
  const refused = verify();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /glibc 2\.35 or newer/);
});

test('Ubuntu release ABI gate checks numeric symbol versions and declared requirements independently', () => {
  const versions = 'Name: GLIBC_2.9 Flags: none\nName: GLIBC_2.34 Flags: none\nName: GLIBC_2.35 Flags: none';
  assert.deepEqual(verifyGlibcBaseline('git (>= 1:2.39), libc6 (>= 2.35)', versions).required,
    ['2.9', '2.34', '2.35']);
  for (const [depends, info] of [
    ['libc6', versions],
    ['libc6 (>= 2.34)', versions],
    ['libc6 (>= 2.35), libc6 (>= 2.39)', versions],
    ['libc6 (>= 2.35) | other-libc', versions],
    ['libc6 (>= 2.35)', 'No version information found'],
    ['libc6 (>= 2.35)', 'Name: GLIBC_2.36 Flags: none'],
    ['libc6 (>= 2.35)', 'Name: GLIBC_ABI_DT_RELR Flags: none'],
    ['libc6 (>= 2.35)', 'Name: GLIBC_PRIVATE Flags: none'],
  ]) {
    assert.throws(() => verifyGlibcBaseline(depends, info), undefined, `${depends}\n${info}`);
  }
});

test('Jammy release overlay retains every other explicit runtime dependency', async () => {
  const normal = JSON.parse(await readFile(join(repositoryRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  const jammy = JSON.parse(await readFile(join(repositoryRoot, 'packaging/linux/ubuntu-jammy.conf.json'), 'utf8'));
  const withoutLibc = depends => depends.filter(dependency => !dependency.startsWith('libc6 '));
  assert.deepEqual(withoutLibc(jammy.bundle.linux.deb.depends), withoutLibc(normal.bundle.linux.deb.depends));
  assert.deepEqual(Object.keys(jammy.bundle.linux.deb), ['depends']);
});

test('Ubuntu ABI gate inspects the actual packaged ELF without running it', async (t) => {
  const f = await packagePayloadFixture(t);
  const executable = join(f.payload, 'usr/bin/git-khronos');
  const compiled = spawnSync('cc', ['-x', 'c', '-o', executable, '-'], {
    input: 'int main(void) { return 73; }\n', encoding: 'utf8',
  });
  assert.equal(compiled.status, 0, `${compiled.error ?? ''}\n${compiled.stderr}`);
  f.build();
  const result = checkPackage(f.artifact);
  assert.equal(result.glibc.declared, '2.35');
  assert.match(result.packageSha256, /^[0-9a-f]{64}$/);
  const key = 'owned-fixture-key';
  const receipt = {
    version: 1, checksum: 'ubuntu-jammy:fixture',
    buildConfiguration: { updaterPublicKeySha256: createHash('sha256').update(key).digest('hex') },
    outputs: { package: { sha256: result.packageSha256 } },
  };
  const report = {
    suite: 'environment', passed: true, packageSha256: result.packageSha256,
    installedExecutable: true, executable: '/usr/bin/git-khronos',
    executableSha256: createHash('sha256').update(await readFile(executable)).digest('hex'),
    installedDesktopEntry: {
      path: '/usr/share/applications/git-khronos.desktop',
      sha256: createHash('sha256').update(await readFile(join(f.payload, 'usr/share/applications/git-khronos.desktop'))).digest('hex'),
    },
    inheritedGitEnvironment: true,
    initialRepositoryIntegrity: { passed: true, exitCode: 0 },
    repositoryIntegrity: { passed: true, exitCode: 0 },
    scenarios: [
      'native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer',
      'native-updates-automatic-setting-describes-download-and-install-consent',
    ],
    applicationUpdates: { nativeStatus: { runningVersion: '0.1.0', packageFormat: 'deb',
      configured: true, automatic: false, offerId: null, canInstall: false } },
  };
  const evidence = ['receipt.json', 'report.json', 'public.key'].map(name => join(f.root, name));
  const saveEvidence = async (nativeReport = report) => {
    await Promise.all([JSON.stringify(receipt), JSON.stringify(nativeReport), key]
      .map((value, index) => writeFile(evidence[index], value)));
  };
  await saveEvidence();
  assert.equal(await checkEvidence(...evidence, f.artifact), result.packageSha256);
  for (const change of [{ installedExecutable: false }, { executable: '/tmp/extracted/usr/bin/git-khronos' },
    { installedDesktopEntry: null }, { inheritedGitEnvironment: false }, { initialRepositoryIntegrity: null },
    { repositoryIntegrity: { passed: false, exitCode: 1 } }]) {
    await saveEvidence({ ...report, ...change });
    await assert.rejects(checkEvidence(...evidence, f.artifact), /Expected an installed environment report/);
  }
  for (const change of [{ executableSha256: '8'.repeat(64) },
    { installedDesktopEntry: { ...report.installedDesktopEntry, sha256: '9'.repeat(64) } },
    { applicationUpdates: { nativeStatus: { ...report.applicationUpdates.nativeStatus, runningVersion: '0.0.1' } } }]) {
    await saveEvidence({ ...report, ...change });
    await assert.rejects(checkEvidence(...evidence, f.artifact), /Installed runtime evidence differs from the qualified artifact/);
  }
  const control = await readFile(join(f.payload, 'DEBIAN/control'), 'utf8');
  await f.put('DEBIAN/control', control.replace('libc6 (>= 2.35)', 'libc6 (>= 2.39)'));
  f.build();
  assert.throws(() => checkPackage(f.artifact), /Release libc6 floor is 2.39/);
  const focusedRequest = { version: 1, checks: [{
    suite: 'smoke', distribution: { id: 'ubuntu', versionId: '24.04' },
    inheritedGitEnvironment: false, requiredScenarios: ['production-csp'],
  }] };
  const focused = await reportInstalledAcceptance(f.artifact, [], { focusedRequest });
  assert.equal(focused.focusedAcceptance.complete, false);
  assert.equal(focused.releaseMatrix, undefined);
  await assert.rejects(reportInstalledAcceptance(f.artifact, [], { releaseMatrix: true }), /Release libc6 floor is 2.39/);
  await assert.rejects(reportInstalledAcceptance(f.artifact, [], { releaseMatrix: true, focusedRequest }),
    /Focused acceptance cannot qualify a release matrix/);
  receipt.outputs.package.sha256 = report.packageSha256 = createHash('sha256')
    .update(await readFile(f.artifact)).digest('hex');
  await saveEvidence();
  await assert.rejects(checkEvidence(...evidence, f.artifact), /Release libc6 floor is 2.39/);
  await f.put('usr/bin/git-khronos', '#!/bin/sh\nexit 0\n');
  f.build();
  assert.throws(() => checkPackage(f.artifact), /Command failed/);
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
  assert.match(await readFile(join(privateRoot, 'usr/share/applications/git-khronos.desktop'), 'utf8'), /^Exec=git-khronos %U$/m);
  await assert.rejects(stat(join(privateRoot, 'usr/bin/git-khronos-desktop')), { code: 'ENOENT' });
});

test('Debian install-time downgrade refusal preserves a newly installed version and payload', async (t) => {
  await requireHookFreeDpkg();
  const root = await mkdtemp(join(tmpdir(), 'khronos-update-version-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateRoot = join(root, 'private-dpkg-root');
  const admin = join(privateRoot, 'var/lib/dpkg');
  const payload = 'usr/share/khronos-updater-fixture/version';
  const packageName = 'khronos-updater-fixture';
  const options = { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, timeout: 30_000 };
  await mkdir(join(admin, 'updates'), { recursive: true });
  await writeFile(join(admin, 'status'), '');
  for (const version of ['1.0.0', '2.0.0', '3.0.0']) {
    const source = join(root, version);
    await mkdir(join(source, 'DEBIAN'), { recursive: true });
    await mkdir(dirname(join(source, payload)), { recursive: true });
    await writeFile(join(source, 'DEBIAN/control'), [
      `Package: ${packageName}`, `Version: ${version}`, 'Architecture: all',
      'Maintainer: Fixture <fixture@example.test>', 'Description: Local updater guard fixture', '',
    ].join('\n'));
    await writeFile(join(source, payload), version);
    const packed = spawnSync('dpkg-deb', ['--root-owner-group', '--build', source, join(root, `${version}.deb`)], options);
    assert.equal(packed.status, 0, packed.stderr);
  }

  // The harmless fixtures have no maintainer scripts. The root and admin
  // database are private even when the suite runs under an administrator.
  for (const [offered, expected] of [['2.0.0', '2.0.0'], ['1.0.0', '2.0.0'], ['3.0.0', '3.0.0']]) {
    const install = spawnSync('fakeroot', ['dpkg', `--root=${privateRoot}`, `--admindir=${admin}`,
      `--log=${join(admin, 'fixture.log')}`, '--refuse-downgrade', '-i', join(root, `${offered}.deb`)], options);
    assert.equal(install.status, 0, install.stderr);
    const query = spawnSync('dpkg-query', [`--admindir=${admin}`, '-W', '-f=${Version}', packageName], options);
    assert.equal(query.status, 0, query.stderr);
    assert.equal(query.stdout, expected);
    assert.equal(await readFile(join(privateRoot, payload), 'utf8'), expected);
  }
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
  await writeFile(join(f.root, 'tools/check-installed-deb.mjs'), `import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.GIT_KHRONOS_PACKAGE_FIXTURE;
assert.equal(readFileSync(join(root, 'apt-acted'), 'utf8'), 'fixture action only');
assert.equal(process.argv[2], ${JSON.stringify(f.artifact)});
if (process.env.GIT_KHRONOS_TEST_INSTALLED_MISMATCH) {
  console.error('Installed fixture payload differs');
  process.exit(1);
}
writeFileSync(join(root, 'installed-checked'), process.argv[2]);
`);
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
  const run = (status, actions, mismatch = false) => spawnSync('bash', [f.script, 'install'], {
    encoding: 'utf8', timeout: 10000,
    // This installer scenario owns its package under f.root. An inherited
    // Cargo target must never redirect verification to a real build artifact.
    env: { ...process.env, CARGO_TARGET_DIR: '', TMPDIR: f.root, PATH: `${bin}:${process.env.PATH}`,
      GIT_KHRONOS_PACKAGE_FIXTURE: f.root, GIT_KHRONOS_TEST_LEGACY_STATUS: status,
      GIT_KHRONOS_APT_ACTIONS: actions, GIT_KHRONOS_TEST_INSTALLED_MISMATCH: mismatch ? '1' : '' },
  });
  const application = 'git-khronos - < 0.1.0 /tmp/fixture.deb\n';
  for (const [status, actions, accepted] of [
    ['', '', true],
    ['installed', `VERSION 2\n\ngit-khronos-desktop 0.1.0 > - **REMOVE**\n${application}`, true],
    ['unpacked', `VERSION 2\n\n${application}`, true],
    ['installed', `VERSION 2\n\n${application}unrelated-package 1 > - **REMOVE**\n`, false],
  ]) {
    await rm(join(f.root, 'apt-acted'), { force: true });
    await rm(join(f.root, 'installed-checked'), { force: true });
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
    if (accepted) {
      assert.equal(await readFile(join(f.root, 'apt-acted'), 'utf8'), 'fixture action only');
      assert.equal(await readFile(join(f.root, 'installed-checked'), 'utf8'), f.artifact);
      assert.match(result.stdout, /Restart any running instance/);
    }
    else {
      await assert.rejects(stat(join(f.root, 'apt-acted')), { code: 'ENOENT' });
      await assert.rejects(stat(join(f.root, 'installed-checked')), { code: 'ENOENT' });
      assert.doesNotMatch(result.stdout, /Restart any running instance/);
    }
  }
  const mismatch = run('', '', true);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /Installed fixture payload differs/);
  assert.equal(await readFile(join(f.root, 'apt-acted'), 'utf8'), 'fixture action only');
  await assert.rejects(stat(join(f.root, 'installed-checked')), { code: 'ENOENT' });
  assert.doesNotMatch(mismatch.stdout, /Restart any running instance/);
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
    const path = 'usr/share/applications/git-khronos.desktop';
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
  assert.notEqual(interrupted.status, 0, interrupted.stderr);
  assert.doesNotMatch(interrupted.stderr, /Refused to interrupt/);
  assert.ok(JSON.parse(await readFile(join(f.root, 'target/release/.git-khronos-package-build.v1.json.pending'), 'utf8')).owner);
  const previous = await f.builds();
  f.ok();
  assert.equal(await f.builds(), previous + 1, 'a hard stop must not bless old package outputs under the new source checksum');
});

test('the packaging watcher probe releases its handle and distinguishes limit failures', () => {
  const manifest = 'apps/desktop/src-tauri/Cargo.toml';
  let closed = 0;
  checkLinuxPackageWatcher(manifest, (path, options) => {
    assert.equal(path, manifest);
    assert.deepEqual(options, { persistent: false });
    return { close: () => closed++ };
  });
  assert.equal(closed, 1);
  for (const [code, explanation] of [
    ['EMFILE', /process descriptor limit or the account’s inotify instance limit/],
    ['ENFILE', /system-wide open-file limit/],
    ['ENOSPC', /inotify watch limit/],
    ['EACCES', /manifest exists and can be watched/],
  ]) {
    const error = Object.assign(new Error('fixture'), { code });
    assert.throws(() => checkLinuxPackageWatcher(manifest, () => { throw error; }),
      thrown => thrown.cause === error && thrown.message.includes(code) && explanation.test(thrown.message));
  }
});

test('a package build with a missing watcher target fails before starting Tauri or its receipt', async (t) => {
  const f = await fixture(t);
  await rm(join(f.root, 'apps/desktop/src-tauri/Cargo.toml'), { force: true });
  const result = f.run(['--force', 'package:deb']);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /cannot watch .*Cargo\.toml/i);
  await assert.rejects(stat(join(f.root, 'calls')), { code: 'ENOENT' });
  await assert.rejects(stat(join(f.root, 'target/release/.git-khronos-package-build.v1.json.pending')), { code: 'ENOENT' });
});

test('local and Jammy builds with different Cargo targets cannot overlap workspace writes', async (t) => {
  const f = await fixture(t);
  const lockPath = join(f.root, 'target/.git-khronos-linux-package.lock');
  const alternate = join(f.root, 'other Cargo target');
  await mkdir(dirname(lockPath), { recursive: true });
  const held = await open(lockPath, 'a', 0o600);
  try {
    // The test retains the descriptor after flock exits, just like the writer.
    const lock = spawnSync('flock', ['--exclusive', '--nonblock', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', held.fd],
    });
    assert.equal(lock.status, 0, lock.stderr?.toString());
    for (const [task, env] of [
      ['package:deb', {}],
      ['package:ubuntu', { CARGO_TARGET_DIR: alternate, EXPECT_JAMMY: '1' }],
    ]) {
      const blocked = f.run(['--force', task], env);
      assert.notEqual(blocked.status, 0, blocked.stderr);
      assert.match(blocked.stderr, /another Linux package build holds this workspace lock/);
      await assert.rejects(stat(join(f.root, 'calls')), { code: 'ENOENT' });
    }
  } finally {
    await held.close();
  }
  f.ok(['package:deb']);
  f.ok(['package:ubuntu'], { CARGO_TARGET_DIR: alternate, EXPECT_JAMMY: '1' });
  assert.equal(await f.builds(), 2);
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


test('package cache binds the compiled updater public key including removing trust', async (t) => {
  const f = await fixture(t); f.ok(undefined, { GIT_KHRONOS_UPDATER_PUBLIC_KEY: '' });
  let previous = await f.builds();
  f.ok(undefined, { GIT_KHRONOS_UPDATER_PUBLIC_KEY: 'owned-public-key-A' });
  assert.equal(await f.builds(), ++previous);
  f.ok(undefined, { GIT_KHRONOS_UPDATER_PUBLIC_KEY: 'owned-public-key-A' });
  assert.equal(await f.builds(), previous, 'unchanged trust may reuse a verified completed build');
  f.ok(undefined, { GIT_KHRONOS_UPDATER_PUBLIC_KEY: 'owned-public-key-B' });
  assert.equal(await f.builds(), ++previous);
  f.ok(undefined, { GIT_KHRONOS_UPDATER_PUBLIC_KEY: '' });
  assert.equal(await f.builds(), ++previous, 'removing trust must not reuse a previously trusted binary');
});
