import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('./run-validation.mjs', import.meta.url));

test('named validations in one checkout cannot erase another run or caller-owned artifact files', () => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-isolation-'));
  try {
    const bin = join(root, 'bin'), cwd = join(root, 'same checkout'), shared = join(root, 'shared');
    for (const path of [bin, cwd, shared]) mkdirSync(path);
    writeFileSync(join(shared, 'retain'), 'caller-owned fixture evidence');
    // Simulate the destructive startup behavior of a renderer runner, not its internals.
    writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
const fs = require('node:fs');
for (const key of ['GIT_KHRONOS_RENDERER_OUTPUT_DIR', 'GIT_KHRONOS_RENDERER_REPORT_DIR']) {
  const directory = process.env[key];
  fs.rmSync(directory, {recursive:true, force:true});
  fs.mkdirSync(directory, {recursive:true});
  fs.writeFileSync(directory + '/retained', process.env.OWNED_VALIDATION_LABEL);
}
`, { mode: 0o700 });
    for (const label of ['first', 'second']) {
      const directory = join(root, `run ${label}`);
      execFileSync(process.execPath, [launcher, 'run', directory, 'run', 'desktop:e2e'], {
        cwd, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OWNED_VALIDATION_LABEL: label,
          GIT_KHRONOS_RENDERER_OUTPUT_DIR: shared, GIT_KHRONOS_RENDERER_REPORT_DIR: shared },
      });
      const started = JSON.parse(readFileSync(join(directory, 'started.json'), 'utf8'));
      const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
      assert.equal(started.source.cwd, cwd); assert.equal(result.source.cwd, cwd);
      assert.equal(result.exitCode, 0);
    }
    for (const label of ['first', 'second']) {
      for (const type of ['renderer-artifacts', 'renderer-report']) {
        assert.equal(readFileSync(join(root, `run ${label}`, type, 'retained'), 'utf8'), label);
      }
    }
    assert.equal(readFileSync(join(shared, 'retain'), 'utf8'), 'caller-owned fixture evidence');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an existing evidence directory is refused without modifying its contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-existing-'));
  try {
    writeFileSync(join(root, 'retain'), 'existing fixture evidence');
    assert.throws(() => execFileSync(process.execPath, [launcher, 'run', root, 'run', 'desktop:e2e'], { stdio: 'ignore' }));
    assert.equal(readFileSync(join(root, 'retain'), 'utf8'), 'existing fixture evidence');
    assert.equal(existsSync(join(root, 'result.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('checkout provenance ignores inherited Git repository selectors', () => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-provenance-'));
  try {
    const cwd = join(root, 'project'), outside = join(root, 'outside'), bin = join(root, 'bin');
    mkdirSync(bin);
    const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const gitEnv = { ...clean, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    const commits = [];
    for (const path of [cwd, outside]) {
      execFileSync('git', ['-c', 'init.templateDir=', 'init', '-q', '-b', 'main', path], { env: gitEnv });
      execFileSync('git', ['-C', path, '-c', 'user.name=Validation Fixture', '-c', 'user.email=validation@example.test',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '-m', path], { env: gitEnv });
      commits.push(execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { env: gitEnv, encoding: 'utf8' }).trim());
    }
    assert.notEqual(commits[0], commits[1]);
    writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o700 });
    const directory = join(root, 'evidence');
    execFileSync(process.execPath, [launcher, 'run', directory, 'run', 'desktop:e2e'], {
      cwd, env: { ...gitEnv, PATH: `${bin}:${process.env.PATH}`, GIT_DIR: join(outside, '.git'), GIT_WORK_TREE: outside },
    });
    const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
    assert.equal(result.source.cwd, cwd); assert.equal(result.source.commit, commits[0]);
    assert.equal(result.source.branch, 'main'); assert.equal(result.source.status, '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('snapshot validations use committed tests with their own dependencies and server', () => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-snapshot-'));
  try {
    const cwd = join(root, 'live checkout'), bin = join(root, 'bin'), directory = join(cwd, 'evidence');
    mkdirSync(cwd);
    mkdirSync(bin);
    const spec = join(cwd, 'graph.spec.ts');
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
    git('-c', 'init.templateDir=', 'init', '-q', '-b', 'main');
    writeFileSync(spec, 'committed test');
    git('add', '--', 'graph.spec.ts');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false',
      '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Freeze the original test');
    const commit = git('rev-parse', 'HEAD');
    writeFileSync(spec, 'dirty checkout before start');
    writeFileSync(join(cwd, 'untracked.spec.ts'), 'not evidence');
    writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
assert.equal(fs.readFileSync('graph.spec.ts', 'utf8'), 'committed test');
assert.equal(fs.existsSync('untracked.spec.ts'), false);
assert.equal(fs.existsSync('.git'), false);
assert.equal(process.env.CI, '1');
assert.equal(process.env.GIT_DIR, undefined);
assert.equal(process.env.NX_WORKSPACE_ROOT_PATH, process.cwd());
assert.equal(spawnSync('git', ['rev-parse', '--show-toplevel']).status, 128);
if (args[0] === 'install') {
  assert.deepEqual(args, ['install', '--offline', '--frozen-lockfile']);
  if (process.env.FIXTURE_FAIL_INSTALL === '1') process.exit(3);
  fs.writeFileSync(process.env.FIXTURE_SPEC, 'live edit during validation');
  fs.writeFileSync('offline-install', 'owned dependency setup');
} else {
  assert.deepEqual(args, ['nx', 'run', 'desktop:e2e']);
  assert.equal(fs.readFileSync('offline-install', 'utf8'), 'owned dependency setup');
  fs.writeFileSync('tested', 'committed test');
}
`, { mode: 0o700 });
    const options = { cwd, env: { ...env, PATH: `${bin}:${process.env.PATH}`, CI: '', FIXTURE_SPEC: spec,
      GIT_DIR: '/nonexistent', NX_WORKSPACE_ROOT_PATH: cwd } };
    execFileSync(process.execPath, [launcher, 'run', directory, '--snapshot', 'HEAD', 'run', 'desktop:e2e'], options);
    const expected = { cwd, commit, commandCwd: join(directory, 'source'), mode: 'commit-snapshot' };
    for (const receipt of ['preparing.json', 'started.json', 'result.json']) {
      assert.deepEqual(JSON.parse(readFileSync(join(directory, receipt), 'utf8')).source, expected);
    }
    assert.equal(readFileSync(join(expected.commandCwd, 'tested'), 'utf8'), 'committed test');
    assert.equal(readFileSync(spec, 'utf8'), 'live edit during validation');
    assert.equal(git('rev-parse', 'HEAD'), commit);
    assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);

    const failed = join(cwd, 'failed evidence');
    assert.throws(() => execFileSync(process.execPath, [launcher, 'run', failed, '--snapshot', commit, 'run', 'desktop:e2e'],
      { ...options, env: { ...options.env, FIXTURE_FAIL_INSTALL: '1' } }));
    assert.equal(existsSync(join(failed, 'started.json')), false);
    const result = JSON.parse(readFileSync(join(failed, 'result.json'), 'utf8'));
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /Installing pinned dependencies offline failed \(3\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an invalid snapshot ref never creates a run or starts Nx', () => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-invalid-ref-'));
  try {
    const directory = join(root, 'evidence');
    assert.throws(() => execFileSync(process.execPath,
      [launcher, 'start', directory, '--snapshot', 'refs/heads/absent', 'run', 'desktop:e2e'],
      { cwd: root, stdio: 'pipe' }), /Snapshot ref does not resolve/);
    assert.equal(existsSync(directory), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
