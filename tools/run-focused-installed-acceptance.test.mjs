import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { runFocusedInstalledAcceptance } from './run-focused-installed-acceptance.mjs';

const distribution = { id: 'ubuntu', versionId: '24.04' };
const lane = (suite, inheritedGitEnvironment = true) => ({
  suite, distribution, inheritedGitEnvironment, requiredScenarios: ['native-example-proof'],
});
const sha = 'a'.repeat(64);

async function fixture(t, checks) {
  const dir = await mkdtemp(join(tmpdir(), 'khronos-focused-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const plan = join(dir, 'plan.json');
  const pkg = join(dir, 'package with spaces.deb');
  const output = join(dir, 'new results');
  await writeFile(plan, JSON.stringify({ version: 1, checks }));
  const calls = [];
  const options = {
    describe: () => ({ suites: ['smoke', 'environment', 'branch-workflow-recovery'], distribution,
      forcedInheritedGitEnvironment: ['environment'] }),
    verifyPackage: installer => { assert.equal(installer, pkg); return { packageSha256: sha }; },
    run: args => {
      calls.push(args);
      return { exitCode: 0, signal: null, error: null };
    },
    verify: async (installer, paths, { focusedRequest }) => {
      assert.equal(installer, pkg);
      assert.deepEqual(paths, []);
      assert.deepEqual(focusedRequest, { version: 1, checks });
      return { sha256: sha, focusedAcceptance: { complete: true } };
    },
  };
  return { calls, options, output, pkg, launch: () => runFocusedInstalledAcceptance(plan, pkg, output, options) };
}

test('runs exactly the reviewed suites and Git environments, and retains the frozen plan', async t => {
  const checks = [lane('smoke', false), lane('smoke'), lane('branch-workflow-recovery')];
  const f = await fixture(t, checks);
  const { complete, receipt } = await f.launch();
  assert.equal(complete, true);
  assert.deepEqual(f.calls, checks.map(check => [
    '--suite', check.suite, '--installed', '--headless', '--package', f.pkg, '--output',
    join(f.output, 'results', `${check.suite}-${check.inheritedGitEnvironment ? 'inherited' : 'normal'}`),
    ...(check.inheritedGitEnvironment ? ['--inherited-git-environment'] : []),
  ]));
  const retained = JSON.parse(await readFile(join(f.output, 'focused-plan.json')));
  assert.deepEqual(retained, { version: 1, checks });
  assert.equal(JSON.parse(await readFile(receipt)).sha256, sha);
  await assert.rejects(f.launch(), { code: 'EEXIST' });
  assert.equal(f.calls.length, 3);
});

test('uses the same explicit interpreter for capability discovery and suite dispatch', async t => {
  const f = await fixture(t, [lane('smoke')]);
  const executable = join(dirname(f.output), 'python with spaces');
  await writeFile(executable, `#!/bin/sh
case "$2" in
  --describe-runner) printf '%s\\n' '{"suites":["smoke"],"distribution":{"id":"ubuntu","versionId":"24.04"},"forcedInheritedGitEnvironment":[]}' ;;
  --suite) test "$3" = smoke && test "$4" = --installed ;;
  *) exit 17 ;;
esac
`, { mode: 0o700 });
  f.options.python = executable;
  delete f.options.describe;
  delete f.options.run;
  assert.equal((await f.launch()).complete, true);
});

test('rejects relative or missing Python overrides before starting any suite', async t => {
  const f = await fixture(t, [lane('smoke')]);
  f.options.python = 'python3.11';
  delete f.options.describe;
  await assert.rejects(f.launch(), /GIT_KHRONOS_ACCEPTANCE_PYTHON must be an absolute/);
  f.options.python = join(dirname(f.output), 'missing python3.11');
  await assert.rejects(f.launch(), /ENOENT.*GIT_KHRONOS_ACCEPTANCE_PYTHON/);
  assert.deepEqual(f.calls, []);
  await assert.rejects(readFile(join(f.output, 'run.json')), { code: 'ENOENT' });
});

test('refuses wrong userspace, unknown suite, and impossible Git environment before any lane starts', async t => {
  const badChecks = [
    [{ ...lane('smoke'), distribution: { id: 'debian', versionId: '12' } }, /needs debian 12/],
    [lane('imaginary-suite'), /Unknown native acceptance suite/],
    [lane('environment', false), /always requires inheritedGitEnvironment: true/],
  ];
  for (const [bad, pattern] of badChecks) {
    // A valid first lane must not run when a later one is impossible.
    const f = await fixture(t, [lane('smoke'), bad]);
    await assert.rejects(f.launch(), pattern);
    assert.deepEqual(f.calls, []);
    await assert.rejects(readFile(join(f.output, 'run.json')), { code: 'ENOENT' });
  }
});

test('a successful process without requested scenario coverage cannot qualify', async t => {
  const f = await fixture(t, [lane('smoke')]);
  f.options.verify = async () => ({ sha256: sha, focusedAcceptance: { complete: false } });
  const { complete, receipt } = await f.launch();
  assert.equal(complete, false);
  assert.equal(JSON.parse(await readFile(receipt)).verification.focusedAcceptance.complete, false);
});

test('preserves failed lane evidence and rejects changed package bytes', async t => {
  const f = await fixture(t, [lane('smoke'), lane('environment')]);
  let index = 0;
  f.options.run = args => {
    f.calls.push(args);
    return { exitCode: index++ === 0 ? 1 : 0, signal: null, error: null };
  };
  f.options.verify = async () => ({ sha256: 'b'.repeat(64), focusedAcceptance: { complete: true } });
  const { complete, receipt } = await f.launch();
  assert.equal(complete, false);
  const stored = JSON.parse(await readFile(receipt));
  assert.deepEqual(stored.lanes.map(lane => lane.exitCode), [1, 0]);
  assert.match(stored.verificationError, /package changed/);
});

for (const interrupt of [{ exitCode: null, signal: 'SIGTERM' }, { exitCode: 130, signal: null }]) {
  test(`an interrupted child (${interrupt.signal ?? interrupt.exitCode}) stops dispatching later lanes`, async t => {
    const f = await fixture(t, [lane('smoke'), lane('environment')]);
    f.options.run = args => {
      f.calls.push(args);
      return { ...interrupt, error: null };
    };
    const result = await f.launch();
    assert.equal(result.complete, false);
    assert.equal(f.calls.length, 1);
    const { exitCode, signal } = JSON.parse(await readFile(result.receipt)).lanes[0];
    assert.deepEqual({ exitCode, signal }, interrupt);
  });
}
