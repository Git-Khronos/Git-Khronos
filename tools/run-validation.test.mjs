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
