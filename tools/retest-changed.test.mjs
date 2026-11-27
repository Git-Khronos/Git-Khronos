import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('renderer budget tooling changes verify emitted production assets without running UI E2E', t => {
  const f = fixture(t);
  f.write('tools/report-initial-renderer.mjs', 'baseline');
  f.write('tools/report-initial-renderer.test.mjs', 'baseline');
  f.commit();
  f.write('tools/report-initial-renderer.mjs', 'updated');
  const plan = f.run();
  assert.match(plan, /"desktop:package-test:focused"[^\n]*"tools\/report-initial-renderer\.test\.mjs"/);
  assert.match(plan, /"desktop:build:production"/);
  assert.doesNotMatch(plan, /desktop:check|desktop:e2e/);
  f.git('rm', 'tools/report-initial-renderer.test.mjs');
  assert.match(f.run(), /desktop:check/, 'do not select a narrow plan without its test');
});

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

test('native keyboard and context-branch changes share one packaged retest', t => {
  const f = fixture(t);
  f.write('candidate.deb');
  f.commit();
  f.write('tools/native_setup_keyboard_scenarios.py');
  f.write('tools/native_context_branch_scenarios.py');
  const plan = f.run('--native-package', 'candidate.deb');
  assert.match(plan, /"desktop:native-harness-test"/);
  assert.equal(plan.match(/"desktop:native-setup-keyboard"/g)?.length, 1);
  assert.doesNotMatch(plan, /desktop:native-full|desktop:e2e|desktop:check/);
});

test('packaged main menu changes select native smoke without full acceptance', t => {
  const f = fixture(t);
  f.write('candidate.deb');
  f.commit();
  f.write('tools/native_main_menu_scenarios.py');
  const plan = f.run('--native-package', 'candidate.deb');
  assert.match(plan, /"desktop:native-harness-test"/);
  assert.match(plan, /"desktop:native-smoke"/);
  assert.doesNotMatch(plan, /desktop:native-full|desktop:e2e|desktop:check/);
});

test('native remote review changes select the focused packaged Git workflow', t => {
  const f = fixture(t);
  f.write('candidate.deb');
  f.commit();
  f.write('tools/native_remote_review_scenarios.py');
  const plan = f.run('--native-package', 'candidate.deb');
  assert.match(plan, /"desktop:native-harness-test"/);
  assert.match(plan, /"desktop:native-remote-reviews"/);
  assert.doesNotMatch(plan, /desktop:native-full|desktop:e2e|desktop:check/);
});

test('repository confirmation edits select the scoped profile and deduplicate a covered spec', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/repository-confirmations.component.html');
  f.write('e2e/renderer/repository-confirmation-scope.spec.ts');
  f.write('e2e/renderer/application-updates.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:repository-confirmations/);
  assert.ok(plan.includes('e2e/renderer/application-updates[.]spec[.]ts$'));
  assert.ok(!plan.includes('e2e/renderer/repository-confirmation-scope[.]spec[.]ts$'));
  assert.doesNotMatch(plan, /desktop:check/);
});

test('history review edits keep reset, replay and checkout coverage without running full E2E', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/history-review-dialog.component.ts');
  f.write('e2e/renderer/operation-recovery.spec.ts');
  f.write('e2e/renderer/no-commit-replay.spec.ts');
  f.write('e2e/renderer/application-updates.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:history-confirmations/);
  assert.ok(plan.includes('e2e/renderer/application-updates[.]spec[.]ts$'));
  assert.ok(!plan.includes('e2e/renderer/operation-recovery[.]spec[.]ts$'));
  assert.ok(!plan.includes('e2e/renderer/no-commit-replay[.]spec[.]ts$'));
  assert.doesNotMatch(plan, /desktop:check/);
});

test('reference dialog edits select both action and deferred ownership scenarios', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/reference-action-dialog.component.ts');
  f.write('e2e/renderer/reference-action-scope.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:reference-actions/);
  assert.ok(!plan.includes('e2e/renderer/reference-action-scope[.]spec[.]ts$'));
  assert.doesNotMatch(plan, /desktop:check/);
});

test('workflow dialog edits select the Gitflow review suite without duplicate cases', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/branch-workflow-dialog.component.ts');
  f.write('e2e/renderer/branch-workflows.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:branch-workflows/);
  assert.ok(!plan.includes('e2e/renderer/branch-workflows[.]spec[.]ts$'));
  assert.doesNotMatch(plan, /desktop:check/);
});

test('LFS dialog edits select the focused LFS profile without duplicate specs', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/lfs-tracking-dialog.component.ts');
  f.write('apps/desktop/src/app/lfs-prune-dialog.component.html');
  f.write('e2e/renderer/lfs-locks.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:lfs/);
  assert.ok(!plan.includes('e2e/renderer/lfs-locks[.]spec[.]ts$'));
  assert.doesNotMatch(plan, /desktop:check/);
});

test('file and repository history panels share one focused search retest', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/file-history.component.ts');
  f.write('apps/desktop/src/app/history-search.component.ts');
  f.write('e2e/renderer/history-search-lifecycle.spec.ts');
  const plan = f.run();
  assert.equal(plan.match(/"desktop:e2e:history-search"/g)?.length, 1);
  assert.ok(!plan.includes('e2e/renderer/history-search-lifecycle[.]spec[.]ts$'));
  assert.doesNotMatch(plan, /"desktop:e2e:history"|desktop:check/);
});

test('Git help changes select the reference browser and topic checks without repeating the direct spec', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/git-documentation-dialog.component.ts');
  f.write('apps/desktop/src/app/git-documentation.service.ts');
  f.write('apps/desktop/src/app/git-documentation-topics.ts');
  f.write('apps/desktop/src/app/git-documentation-topics.spec.ts');
  f.write('e2e/renderer/git-documentation.spec.ts');
  const plan = f.run();
  assert.equal(plan.match(/"desktop:e2e:git-documentation"/g)?.length, 1);
  assert.match(plan, /"desktop:renderer-unit-test:focused"[^\n]*git-documentation-topics\.spec\.ts/);
  assert.doesNotMatch(plan, /git-documentation\[\.\]spec\[\.\]ts|desktop:check/);
});

test('changes to the release download handoff select only its candidate-attempt tests', t => {
  const f = fixture(t);
  f.write('tools/check-debian-candidate-run.test.mjs');
  f.commit();
  f.write('tools/download-qualified-debian.sh');
  f.write('tools/check-debian-candidate-run.mjs');
  const plan = f.run();
  assert.match(plan, /"desktop:package-test:focused"[^\n]*"tools\/check-debian-candidate-run\.test\.mjs"/);
  assert.doesNotMatch(plan, /"desktop:package-test"|desktop:check|desktop:e2e/);
});

test('an edited LFS lock fixture selects its packaged suite with an explicit archive', t => {
  const f = fixture(t);
  f.write('.gitignore', 'artifacts/\n');
  f.commit();
  f.write('artifacts/check.deb');
  f.write('tools/native_lfs_lock_ui_scenarios.py');
  const plan = f.run('--native-package', 'artifacts/check.deb');
  assert.match(plan, /"desktop:native-lfs-lock-actions" "--output-style=stream" "--" "--package"/);
  assert.doesNotMatch(plan, /desktop:e2e|--installed/);
});

test('changing preview startup selects every direct consumer of that fixture', t => {
  const f = fixture(t);
  f.write('e2e/renderer/preview-repository-ready.ts');
  const plan = f.run();
  const renderer = new URL('../e2e/renderer/', import.meta.url);
  const consumers = readdirSync(renderer).filter(name => name.endsWith('.spec.ts') &&
    /\bfrom\s+['"]\.\/preview-repository-ready['"]/.test(readFileSync(new URL(name, renderer), 'utf8')));
  assert.ok(consumers.length > 0, 'expected real renderer specs using the startup helper');
  for (const spec of consumers) {
    const name = spec.slice(0, -'.spec.ts'.length);
    assert.ok(plan.includes(`e2e/renderer/${name}[.]spec[.]ts$`), name);
  }
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

test('editing renderer artifact tooling or the validation runner selects browser-free tests', t => {
  const f = fixture(t);
  for (const path of ['tools/renderer-artifacts.test.mjs', 'tools/run-validation.mjs', 'tools/validation-status.mjs',
    'tools/renderer-progress-reporter.cjs', 'tools/validation-space.mjs']) {
    f.write(path);
    const plan = f.run();
    assert.match(plan, /desktop:owned-process-test/);
    assert.doesNotMatch(plan, /desktop:e2e|desktop:check/);
    f.commit();
  }
});

test('editing the WSLg diagnostic selects the harness tests without launching the native app', t => {
  const f = fixture(t);
  f.write('tools/check-wslg-transport.py');
  const plan = f.run();
  assert.match(plan, /desktop:native-harness-test/);
  assert.doesNotMatch(plan, /desktop:native-full|desktop:e2e|desktop:check/);
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
  assert.ok(plan.includes('"desktop:e2e:editor" "--output-style=stream" "--" "--workers=2" "--project=webkit"'));
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

test('updater service and submodule findings select their unit and browser checks', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/application-updates.service.spec.ts');
  const unitOnly = f.run();
  assert.match(unitOnly, /desktop:renderer-unit-test:focused/);
  assert.doesNotMatch(unitOnly, /desktop:e2e|desktop:check/);
  f.write('apps/desktop/src/app/application-updates.service.ts');
  f.write('apps/desktop/src/app/submodule-findings.ts');
  const plan = f.run();
  const unit = plan.split('\n').find(line => line.includes('desktop:renderer-unit-test:focused'));
  assert.equal(unit.match(/application-updates\.service\.spec\.ts/g)?.length, 1);
  assert.match(unit, /submodule-findings\.spec\.ts/);
  assert.match(plan, /desktop:e2e:updates/);
  assert.match(plan, /desktop:e2e:submodules/);
  assert.doesNotMatch(plan, /desktop:check/);
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

test('working-tree recap edits select the staged and unstaged summary cases once', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/working-tree-summary.component.ts');
  f.write('e2e/renderer/unstaged-summary.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:recaps/);
  assert.equal(plan.match(/pnpm nx run/g)?.length, 1);
});

test('occupied-checkout dialog selects branch checkout alone unless broader worktree changes also need it', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/checkout-worktree-dialog.component.ts');
  f.write('e2e/renderer/branch-checkout-worktree.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:branch-checkout/);
  assert.doesNotMatch(plan, /desktop:e2e:worktrees/);
  assert.equal(plan.match(/pnpm nx run/g)?.length, 1);
  f.write('apps/desktop/src/app/worktree-lock-dialog.component.ts');
  const combined = f.run();
  assert.match(combined, /desktop:e2e:worktrees/);
  assert.equal(combined.match(/pnpm nx run/g)?.length, 1);
});

test('submodule review changes select only the submodule profile', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/submodule-state-review.component.ts');
  f.write('e2e/renderer/submodule-review.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:submodules/);
  assert.equal(plan.match(/pnpm nx run/g)?.length, 1);
  f.write('apps/desktop/src/app/worktree-lock-dialog.component.ts');
  const combined = f.run();
  assert.match(combined, /desktop:e2e:worktrees/);
  assert.equal(combined.match(/pnpm nx run/g)?.length, 1);
});

test('graph fixture changes retain exhaustive columns coverage and graph type checking', t => {
  const f = fixture(t);
  f.write('e2e/renderer/graph-layout-test-helpers.ts');
  f.write('e2e/renderer/graph-columns.spec.ts');
  const plan = f.run();
  assert.match(plan, /desktop:graph-test-typecheck/);
  const command = plan.split('\n').find(line => line.includes('"desktop:e2e"'));
  assert.equal(command.match(/graph-columns/g)?.length, 1);
  assert.match(command, /graph-layout-readiness/);
  assert.doesNotMatch(plan, /desktop:check|grep-invert/);
});

test('graph viewport edits select the representative graph profile', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/graph-viewport.component.ts');
  const plan = f.run();
  assert.match(plan, /desktop:e2e:graph/);
  assert.doesNotMatch(plan, /desktop:check/);
});

test('lazy-chunk fixture changes select all six dependent browser suites', t => {
  const f = fixture(t);
  f.write('e2e/renderer/lazy-chunk-routing.ts');
  const plan = f.run();
  const command = plan.split('\n').find(line => line.includes('"desktop:e2e"'));
  assert.equal(command.match(/\[\.\]spec\[\.\]ts\$/g)?.length, 6);
  assert.match(command, /startup-failures/);
  assert.doesNotMatch(plan, /desktop:check/);
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

test('registered package specs share one filtered Node test run', t => {
  const f = fixture(t);
  f.write('tools/report-initial-renderer.test.mjs');
  f.write('tools/prepare-frontend-notices.test.mjs');
  const plan = f.run();
  assert.match(plan, /"desktop:package-test:focused" "--output-style=static" "--" "tools\/prepare-frontend-notices.test.mjs" "tools\/report-initial-renderer.test.mjs"/);
  assert.doesNotMatch(plan, /desktop:check|desktop:e2e/);
  f.write('tools/not-registered.test.mjs');
  const broad = f.run();
  assert.match(broad, /desktop:check/);
  assert.match(broad, /"desktop:package-test"/);
  assert.doesNotMatch(broad, /desktop:package-test:focused/);
});

test('Debian workflow scripts select package tests, while Taskfile edits keep broader checks', t => {
  const f = fixture(t);
  f.write('tools/package-deb.test.mjs');
  f.commit();
  f.write('tools/build-linux-package.sh');
  f.write('tools/package-build-receipt.mjs');
  const focused = f.run();
  assert.match(focused, /"desktop:package-test:focused" "--output-style=static" "--" "tools\/package-deb.test.mjs"/);
  assert.doesNotMatch(focused, /desktop:check|desktop:e2e/);
  f.write('Taskfile.yml');
  const broad = f.run();
  assert.match(broad, /"desktop:package-test"/);
  assert.match(broad, /desktop:check[\s\S]*desktop:e2e/);
  assert.doesNotMatch(broad, /desktop:package-test:focused/);
});

test('selects an individual renderer unit spec without starting Playwright', t => {
  const f = fixture(t);
  f.write('apps/desktop/src/app/shortcut-labels.spec.ts');
  const plan = f.run('--webkit');
  assert.match(plan, /"desktop:renderer-unit-test:focused" "--output-style=static" "--" "apps\/desktop\/src\/app\/shortcut-labels.spec.ts"/);
  assert.doesNotMatch(plan, /desktop:e2e|project=webkit/);
});

test('mapped native scenario edits require an explicit archive and do not start Playwright', t => {
  const f = fixture(t);
  const archive = 'artifacts/local candidate.deb';
  f.write('.gitignore', 'artifacts/\n');
  f.commit();
  f.write(archive);
  f.write('tools/native_sparse_checkout_scenarios.py');
  const plan = f.run();
  assert.match(plan, /Add --native-package/);
  assert.doesNotMatch(plan, /"desktop:native-sparse-checkout"/);

  const packaged = f.run('--native-package', archive, '--webkit');
  assert.match(packaged, /"desktop:native-harness-test"/);
  assert.ok(packaged.includes('"desktop:native-sparse-checkout" "--output-style=stream" "--" "--package" '
    + JSON.stringify(join(f.cwd, archive))));
  assert.doesNotMatch(packaged, /desktop:e2e|desktop:check|project=webkit/);
});

test('dedicated Debian workflows select local packaging tests, while shared CI keeps broad checks', t => {
  const f = fixture(t);
  f.write('tools/package-deb.test.mjs');
  f.commit();
  for (const workflow of ['release', 'publish-signed-debian', 'linux-package-acceptance']) {
    f.write(`.github/workflows/${workflow}.yml`);
  }
  const focused = f.run();
  assert.match(focused, /local only; hosted qualification is separate/);
  assert.equal(focused.match(/"desktop:package-test:focused"/g)?.length, 1);
  assert.doesNotMatch(focused, /"desktop:check"|"desktop:test"|"desktop:e2e"/);
  f.write('.github/workflows/ci.yml');
  assert.match(f.run(), /"desktop:check"[\s\S]*"desktop:e2e"/);
});

test('updater fixture edits select offline package checks, not an installed update', t => {
  const f = fixture(t);
  f.write('.gitignore', 'artifacts/\n');
  f.commit();
  f.write('artifacts/candidate.deb');
  f.write('tools/native_application_updates_scenarios.py');
  const plan = f.run('--native-package', 'artifacts/candidate.deb');
  assert.match(plan, /"desktop:native-application-updates" "--output-style=stream" "--" "--package"/);
  assert.match(plan, /"desktop:native-application-update-release-link" "--output-style=stream" "--" "--package"/);
  assert.doesNotMatch(plan, /application-update-consent|--installed|desktop:native-full|desktop:e2e/);
});

test('changes to the shared launcher fixture retest browser and file manager handoffs', t => {
  const f = fixture(t);
  f.write('.gitignore', 'candidate.deb\n');
  f.commit();
  f.write('candidate.deb');
  f.write('tools/native_desktop_launcher_fixture.py');
  const plan = f.run('--native-package', 'candidate.deb');
  assert.match(plan, /"desktop:native-git-documentation"/);
  assert.match(plan, /"desktop:native-application-update-release-link"/);
  assert.match(plan, /"desktop:native-file-manager-launch"/);
  assert.doesNotMatch(plan, /"desktop:native-application-updates"|desktop:e2e|desktop:check/);
});

test('rebase fixture edits select both packaged rebase reviews without a browser run', t => {
  const f = fixture(t);
  f.write('.gitignore', 'artifacts/\n');
  f.commit();
  f.write('artifacts/rebase.deb');
  f.write('tools/native_feature_rebase_scenarios.py');
  const plan = f.run('--native-package', 'artifacts/rebase.deb');
  for (const target of ['native-feature-rebase', 'native-merge-rebase-review']) {
    assert.ok(plan.includes(`"desktop:${target}" "--output-style=stream" "--" "--package" `
      + JSON.stringify(join(f.cwd, 'artifacts/rebase.deb'))));
  }
  assert.doesNotMatch(plan, /--installed|desktop:native-full|desktop:e2e/);
});

test('an invalid native archive fails before scheduling checks', t => {
  const f = fixture(t);
  f.write('tools/native_sparse_checkout_scenarios.py');
  const result = spawnSync(process.execPath, ['tools/retest-changed.mjs', '--native-package', 'missing.deb', '--run'], {
    cwd: f.cwd, encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /existing \.deb file/);
  assert.doesNotMatch(result.stdout, /nx run/);
});

test('a shared discard scenario file selects all six registered discard suites', t => {
  const f = fixture(t);
  f.write('candidate.deb');
  f.write('.gitignore', 'candidate.deb\n');
  f.commit();
  f.write('tools/native_discard_subset_scenarios.py');
  const plan = f.run('--native-package', 'candidate.deb');
  const suites = [...plan.matchAll(/"desktop:native-(discard-[a-z-]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(suites, [
    'discard-busy', 'discard-deletion', 'discard-large', 'discard-limit',
    'discard-stale-review', 'discard-subset',
  ]);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check/);
});

test('GitLab fixture and fork edits share one catalogue run and one fork UI run', t => {
  const f = fixture(t);
  f.write('.gitignore', 'candidate.deb\n');
  f.commit();
  f.write('candidate.deb');
  f.write('tools/native_gitlab_fork_scenarios.py');
  const forkOnly = f.run('--native-package', 'candidate.deb');
  assert.match(forkOnly, /"desktop:native-gitlab-fork-ui"/);
  assert.doesNotMatch(forkOnly, /"desktop:native-gitlab"/);
  f.write('tools/native_gitlab_scenarios.py');
  const plan = f.run('--native-package', 'candidate.deb');
  assert.deepEqual([...plan.matchAll(/"desktop:native-(gitlab[^"]*)"/g)].map(match => match[1]).sort(), [
    'gitlab', 'gitlab-fork-ui',
  ]);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check/);
});

test('worktree edits include branch reservation and recap edits select the recap target', t => {
  const f = fixture(t);
  f.write('.gitignore', 'candidate.deb\n');
  f.commit();
  f.write('candidate.deb');
  f.write('tools/native_worktree_scenarios.py');
  f.write('tools/native_unstaged_summary_scenarios.py');
  const plan = f.run('--native-package', 'candidate.deb');
  assert.match(plan, /"desktop:native-worktree-reservation"/);
  assert.match(plan, /"desktop:native-worktrees"/);
  assert.match(plan, /"desktop:native-working-tree-recaps"/);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check/);
});

test('GitLab SSH fixture changes select the catalogue only, not the fork UI suite', t => {
  const f = fixture(t);
  f.write('.gitignore', 'candidate.deb\n');
  f.commit();
  f.write('candidate.deb');
  f.write('tools/native_gitlab_ssh_fixture.py');
  f.write('tools/native_gitlab_ssh_scenarios.py');
  const plan = f.run('--native-package', 'candidate.deb');
  assert.equal([...plan.matchAll(/"desktop:native-gitlab"/g)].length, 1);
  assert.doesNotMatch(plan, /"desktop:native-gitlab-fork-ui"|desktop:e2e|desktop:check/);
});

test('workspace batch changes select the real-Git package scenario without unrelated suites', t => {
  const f = fixture(t);
  f.write('.gitignore', 'candidate.deb\n');
  f.commit();
  f.write('candidate.deb');
  f.write('tools/native_workspace_batch_scenarios.py');
  assert.doesNotMatch(f.run(), /"desktop:native-workspace-batch"/);
  const plan = f.run('--native-package', 'candidate.deb');
  assert.match(plan, /"desktop:native-workspace-batch"/);
  assert.doesNotMatch(plan, /"desktop:native-(?:workspace-bulk-locate|worktrees)"|desktop:e2e|desktop:check/);
});

test('changed Git core unit modules share one Cargo run without Playwright or browser flags', t => {
  const f = fixture(t);
  f.write('crates/git-core/src/branch_comparison_tests.rs');
  f.write('crates/git-core/src/reference_rename_tests.rs');
  const plan = f.run('--webkit', '--workers=4');
  assert.match(plan, /"desktop:git-core-unit-test" "--output-style=static" "--" "branch_comparison_tests::" "reference_rename_tests::"/);
  assert.equal([...plan.matchAll(/pnpm nx run/g)].length, 1);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check|project=webkit|workers=4/);
  f.write('crates/git-core/src/reference_rename.rs');
  const broad = f.run();
  assert.match(broad, /"desktop:test"/);
  assert.doesNotMatch(broad, /"desktop:git-core-unit-test"/);
});

test('native authentication transport and its HTTPS fixture share one focused Cargo run', t => {
  const f = fixture(t);
  f.write('apps/desktop/src-tauri/tests/authentication_transport.rs');
  f.write('apps/desktop/src-tauri/tests/fixtures/https_git_server.py');
  const plan = f.run('--webkit');
  assert.equal([...plan.matchAll(/"desktop:test-authentication"/g)].length, 1);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check|project=webkit/);
  f.write('apps/desktop/src-tauri/src/lib.rs');
  assert.doesNotMatch(f.run(), /"desktop:test-authentication"/);
});

test('selection can use an alternate index without leaking it to test fixtures', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const bin = join(f.cwd, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nprintf "index=<%s> fixture=<%s>\\n" "$GIT_INDEX_FILE" "$GIT_KHRONOS_SSHD"\n', { mode: 0o700 });
  const env = { ...process.env, PATH: bin + delimiter + process.env.PATH,
    GIT_INDEX_FILE: join(f.cwd, 'alternate-index'), GIT_KHRONOS_SSHD: '/owned/sshd' };
  const git = (...args) => execFileSync('git', args, { cwd: f.cwd, env });
  git('read-tree', 'HEAD');
  const spec = 'apps/desktop/src-tauri/tests/authentication_transport.rs';
  f.write(spec);
  git('add', spec);
  assert.doesNotMatch(f.run('--staged'), /test-authentication/);

  const output = execFileSync(process.execPath, ['tools/retest-changed.mjs', '--staged', '--run'], {
    cwd: f.cwd, encoding: 'utf8', env,
  });
  assert.match(output, /"desktop:test-authentication"/);
  assert.match(output, /index=<> fixture=<\/owned\/sshd>/);
});

test('workspace relocation changes select the owned native folder chooser with an explicit archive', t => {
  const f = fixture(t);
  f.write('.gitignore', 'candidate.deb\n');
  f.commit();
  f.write('candidate.deb');
  f.write('tools/native_workspace_locate_scenarios.py');
  const plan = f.run('--native-package', 'candidate.deb');
  assert.match(plan, /"desktop:native-workspace-bulk-locate"/);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check/);
});

test('archive cleaner edits run the cleanup safety tests without browser validation', t => {
  const f = fixture(t);
  f.write('tools/prune_local_build_caches.py');
  f.write('tools/prune_local_build_caches_test.py');
  const plan = f.run();
  assert.equal([...plan.matchAll(/"desktop:archive-cache-test"/g)].length, 1);
  assert.doesNotMatch(plan, /desktop:e2e|desktop:check|desktop:native-harness-test/);
});
