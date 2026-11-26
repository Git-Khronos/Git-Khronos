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
  write('apps/desktop/project.json');
  copyFileSync(new URL('../apps/desktop/project.json', import.meta.url), join(cwd, 'apps/desktop/project.json'));
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
  assert.deepEqual(result.stdout.match(/^invoked .+$/gm), ['invoked <nx>', 'invoked <run>', 'invoked <desktop:check>', 'invoked <--output-style=static>']);
});

test('help explains the broad fallback and invalid bases fail without running tests', t => {
  const f = fixture(t);
  assert.match(f.run('--help'), /Usage: pnpm test:changed/);
  const result = spawnSync(process.execPath, ['tools/retest-changed.mjs', '--base', 'missing-ref', '--run'], {
    cwd: f.cwd, encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Could not resolve test base "missing-ref"/);
  assert.doesNotMatch(result.stdout, /nx run/);
});

test('editing the retest planner selects tooling checks without launching browsers', t => {
  const f = fixture(t);
  f.write('tools/retest-changed.test.mjs');
  const plan = f.run();
  assert.match(plan, /desktop:owned-process-test/);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check/);
});

test('staged selection does not include unstaged edits or untracked files', t => {
  const f = fixture(t);
  f.write('shared.ts');
  f.commit();
  f.write('e2e/renderer/application-updates.spec.ts');
  f.git('add', 'e2e');
  f.write('shared.ts', 'unstaged');
  f.write('untracked.ts');
  const plan = f.run('--staged');
  assert.match(plan, /application-updates\.spec\.ts/);
  assert.doesNotMatch(plan, /shared\.ts|untracked\.ts|desktop:check/);
});

test('worker overrides apply only to browser tests', t => {
  const f = fixture(t);
  f.write('tools/retest-changed.test.mjs');
  f.write('e2e/renderer/application-updates.spec.ts');
  const plan = f.run('--workers=4');
  assert.match(plan, /"desktop:e2e"[^\n]*"--workers=4"/);
  assert.doesNotMatch(plan, /"desktop:owned-process-test"[^\n]*--workers/);
  assert.throws(() => f.run('--workers=0'), /positive integer/);
});

test('does not schedule a second browser run for a spec covered by the selected profile', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/worktree-lock-dialog.component.ts');
  f.write('e2e/renderer/worktree-move.spec.ts');
  f.write('e2e/renderer/application-updates.spec.ts');
  const plan = f.run();
  assert.match(plan, /"desktop:e2e:worktrees"/);
  assert.ok(plan.includes('application-updates[.]spec[.]ts$'));
  assert.ok(!plan.includes('worktree-move[.]spec[.]ts$'));
});

test('WebKit opt-in applies only to selected browser targets', t => {
  const f = fixture(t);
  f.write('tools/retest-changed.test.mjs');
  f.write('e2e/renderer/application-updates.spec.ts');
  const plan = f.run('--webkit');
  assert.match(plan, /GIT_KHRONOS_RENDERER_WEBKIT=1 pnpm nx run "desktop:e2e"[^\n]*"--project=webkit"/);
  assert.doesNotMatch(plan, /GIT_KHRONOS_RENDERER_WEBKIT=1 pnpm nx run "desktop:owned-process-test"/);
});

test('editor fixture changes cover editing, file tools and draft recovery without duplicate runs', t => {
  const f = fixture(t);
  f.write('e2e/renderer/editor-protocol-fixture.ts');
  for (const name of ['working-file-editor', 'file-tools', 'editor-draft-recovery']) {
    f.write(`e2e/renderer/${name}.spec.ts`);
  }
  const plan = f.run('--webkit', '--workers=2');
  assert.ok(plan.includes('"desktop:e2e:editor" "--output-style=static" "--" "--workers=2" "--project=webkit"'));
  assert.equal(plan.match(/pnpm nx run/g)?.length, 1);
});

test('Markdown implementation changes also exercise the unit spec exactly once', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/markdown-preview.worker.ts');
  f.write('apps/desktop/src/app/markdown-preview.ts');
  f.write('apps/desktop/src/app/markdown-preview.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:editor/);
  const unit = plan.split('\n').find(line => line.includes('desktop:renderer-unit-test:focused'));
  assert.match(unit, /"--" "apps\/desktop\/src\/app\/markdown-preview\.spec\.ts"$/);
});

test('discard recovery display changes select only the discard profile', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/discard-recovery-display.ts');
  f.write('apps/desktop/src/app/saved-discard-list.component.ts');
  f.write('e2e/renderer/discard-recovery.spec.ts');
  f.write('e2e/renderer/working-tree-lifecycle.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:discard/);
  assert.equal(plan.match(/pnpm nx run/g)?.length, 1);
});

test('a native harness unit-test edit selects no browser or package run', t => {
  const f = fixture(t);
  f.write('tools/native_acceptance_test.py');
  const plan = f.run('--webkit');
  assert.match(plan, /desktop:native-harness-test/);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check|project=webkit/);
  f.write('tools/native_acceptance.py');
  const harness = f.run();
  assert.match(harness, /desktop:native-harness-test/);
  assert.match(harness, /affected native suite/);
  assert.doesNotMatch(harness, /desktop:e2e|desktop:check/);
  f.write('shared.ts');
  assert.match(f.run(), /desktop:check[\s\S]*desktop:native-harness-test/);
});

test('package specs select only the package lane when registered in Nx', t => {
  const f = fixture(t);
  f.write('tools/package-deb.test.mjs');
  const plan = f.run();
  assert.match(plan, /desktop:package-test/);
  assert.doesNotMatch(plan, /desktop:check|desktop:e2e/);
  f.write('tools/not-registered.test.mjs');
  assert.match(f.run(), /desktop:check/);
});

test('selects an individual renderer unit spec without starting Playwright', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/shortcut-labels.spec.ts');
  const plan = f.run('--webkit');
  assert.match(plan, /"desktop:renderer-unit-test:focused" "--output-style=static" "--" "apps\/desktop\/src\/app\/shortcut-labels.spec.ts"/);
  assert.doesNotMatch(plan, /desktop:e2e|project=webkit/);
});
