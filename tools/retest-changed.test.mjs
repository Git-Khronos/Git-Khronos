import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, delimiter, join } from 'node:path';
import test from 'node:test';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'gk-retest-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const write = (path, value = '') => {
    const file = join(cwd, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, value);
  };
  write('tools/retest-changed.mjs');
  copyFileSync(new URL('./retest-changed.mjs', import.meta.url), join(cwd, 'tools/retest-changed.mjs'));
  git('init', '-q');
  const commit = () => {
    git('add', '-A');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  };
  commit();
  const run = (...args) => execFileSync(process.execPath, ['tools/retest-changed.mjs', ...args], { cwd, encoding: 'utf8' });
  return { cwd, git, write, commit, run };
}

test('selects an untracked renderer spec and a staged feature edit', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/worktree-lock-dialog.component.ts', 'baseline');
  f.commit();
  f.write('apps/desktop/src/app/worktree-lock-dialog.component.ts', 'staged');
  f.git('add', '-A');
  f.write('apps/desktop/src/app/worktree-lock-dialog.component.ts', 'baseline');
  f.write('e2e/renderer/application-updates.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:worktrees/);
  assert.ok(plan.includes('e2e/renderer/application-updates[.]spec[.]ts$'));
  assert.doesNotMatch(plan, /desktop:check/);
});

test('removing a spec falls back rather than silently dropping coverage', t => {
  const f = fixture(t);
  const spec = 'e2e/renderer/application-updates.spec.ts';
  f.write(spec);
  f.commit();
  f.git('rm', spec);
  assert.match(f.run(), /desktop:check[\s\S]*desktop:test[\s\S]*desktop:e2e/);
});

test('does not launch broad validation without explicit opt-in', t => {
  const f = fixture(t);
  f.write('shared.ts');
  const result = spawnSync(process.execPath, ['tools/retest-changed.mjs', '--run'], { cwd: f.cwd, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--run --allow-full/);
});

test('execution preserves argument boundaries and stops at the first failure', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const bin = mkdtempSync(join(tmpdir(), 'gk-retest-bin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const path = join(bin, 'pnpm');
  writeFileSync(path, '#!/bin/sh\nprintf "invoked <%s>\\n" "$@"\nexit 17\n', { mode: 0o700 });
  f.write('shared.ts');
  const result = spawnSync(process.execPath, ['tools/retest-changed.mjs', '--run', '--allow-full'], {
    cwd: f.cwd, encoding: 'utf8', env: { ...process.env, PATH: bin + delimiter + process.env.PATH },
  });
  assert.equal(result.status, 17);
  assert.deepEqual(result.stdout.match(/^invoked .+$/gm), ['invoked <nx>', 'invoked <run>', 'invoked <desktop:check>']);
});
