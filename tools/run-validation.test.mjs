import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { currentBootId, processStart } from './validation-status.mjs';
import { validationSourceFingerprint } from './validation-source.mjs';
import RendererProgress from './renderer-progress-reporter.cjs';

const launcher = fileURLToPath(new URL('./run-validation.mjs', import.meta.url));

const readStatus = directory => JSON.parse(execFileSync(process.execPath,
  [launcher, 'status', directory], { encoding: 'utf8' }));

test('guarded validation rejects changed bytes even when the Git status names stay the same', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'checkout'), bin = join(root, 'bin');
  mkdirSync(cwd); mkdirSync(bin);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git('init', '-q');
  const file = join(cwd, 'owned source\nname.txt');
  writeFileSync(file, 'first');
  git('add', '--', 'owned source\nname.txt');
  const originalStatus = git('status', '--porcelain=v1');
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
if (process.env.CHANGE_GUARDED_SOURCE) {
  require('node:fs').writeFileSync(process.env.CHANGE_GUARDED_SOURCE, 'third');
}
`, { mode: 0o700 });
  // Keep the file dirty with the same Git status and length before and after
  // the child changes it; neither pathname nor length proves input identity.
  writeFileSync(file, 'other');
  const dirtyStatus = git('status', '--porcelain=v1');
  assert.notEqual(dirtyStatus, originalStatus);
  for (const change of [false, true]) {
    const directory = join(root, change ? 'changed' : 'unchanged');
    const result = spawnSync(process.execPath, [launcher, 'run', directory, '--guard-source', 'desktop:test'], {
      cwd, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
        CHANGE_GUARDED_SOURCE: change ? file : '' },
    });
    assert.equal(result.status, change ? 1 : 0, result.stderr);
    const receipt = readStatus(directory);
    assert.equal(receipt.sourceCheck.state, change ? 'changed' : 'unchanged');
    assert.equal(receipt.source.inputFingerprint === receipt.sourceCheck.fingerprint, !change);
    assert.equal(git('status', '--porcelain=v1'), dirtyStatus);
  }
});

test('the checkout fingerprint does not follow a replaced tracked directory outside the fixture', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-guard-link-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'checkout'), outside = join(root, 'outside'), tracked = join(cwd, 'tracked');
  mkdirSync(cwd); mkdirSync(outside); mkdirSync(tracked);
  execFileSync('git', ['init', '-q'], { cwd });
  writeFileSync(join(tracked, 'file'), 'owned checkout file');
  execFileSync('git', ['add', 'tracked/file'], { cwd });
  assert.match(validationSourceFingerprint(cwd, process.env), /^[a-f0-9]{64}$/);
  rmSync(tracked, { recursive: true });
  writeFileSync(join(outside, 'file'), 'must not read this');
  symlinkSync(outside, tracked);
  assert.throws(() => validationSourceFingerprint(cwd, process.env), /input directory has been replaced/);
});

test('guarded runs launched in a subdirectory also fingerprint worktree-root files', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-guard-worktree-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'checkout with trailing space '), subdirectory = join(cwd, 'nested');
  mkdirSync(subdirectory, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd });
  writeFileSync(join(subdirectory, 'spec'), 'nested');
  const input = join(cwd, 'root-input');
  writeFileSync(input, 'earlier');
  const before = validationSourceFingerprint(subdirectory, process.env);
  assert.equal(before, validationSourceFingerprint(cwd, process.env));
  writeFileSync(input, 'changed');
  assert.notEqual(validationSourceFingerprint(subdirectory, process.env), before);
});

test('renderer shards spread adjacent cases, preserve their identities, and reject incomplete lists', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-renderer-shards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('./plan-renderer-shard.mjs', import.meta.url));
  const input = join(root, 'playwright-list');
  const cases = Array.from({ length: 7 }, (_, index) =>
    `  [chromium] › graph-columns.spec.ts:${index + 1}:1 › case ${index + 1}`);
  const writeList = (entries, count = entries.length) =>
    writeFileSync(input, `Listing tests:\n${entries.join('\n')}\nTotal: ${count} tests in 1 file\n`);
  const run = (part, total) => spawnSync(process.execPath, [cli, input, part, total], { encoding: 'utf8' });
  writeList(cases);
  const shards = ['1', '2', '3'].map(part => {
    const result = run(part, '3');
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trimEnd().split('\n');
  });
  assert.deepEqual(shards, [[cases[0], cases[3], cases[6]], [cases[1], cases[4]], [cases[2], cases[5]]]);
  assert.equal(run('4', '3').status, 1);
  assert.equal(run('1', '8').status, 1);
  writeList(cases.slice(1), cases.length);
  assert.equal(run('1', '3').status, 1);
  writeList([...cases, cases[0]]);
  assert.equal(run('1', '3').status, 1);
});

test('validation help shows the Nx run form and missing commands create no run directory', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-validation-help-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'no-command');
  const help = spawnSync(process.execPath, [launcher, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /run desktop:e2e -- --workers=2/);
  for (const mode of ['start', 'run']) {
    const missing = spawnSync(process.execPath, [launcher, mode, directory], { encoding: 'utf8' });
    assert.equal(missing.status, 2, missing.stderr);
    assert.match(missing.stderr, /NX_COMMAND/);
    assert.equal(existsSync(directory), false);
  }
});

test('waiting for an existing run returns its terminal receipt and exit code', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'khronos-validation-wait-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const wait = () => spawnSync(process.execPath, [launcher, 'wait', directory], { encoding: 'utf8' });
  const missing = wait();
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).state, 'not-started');

  const owner = { runnerPid: process.pid, runnerStart: processStart(process.pid) };
  writeFileSync(join(directory, 'preparing.json'), JSON.stringify({ ...owner, runnerStart: '0' }));
  const stopped = wait();
  assert.equal(stopped.status, 1);
  assert.equal(JSON.parse(stopped.stdout).state, 'stopped-without-result');

  writeFileSync(join(directory, 'preparing.json'), JSON.stringify(owner));
  const waiter = spawn(process.execPath, [launcher, 'wait', directory]);
  t.after(() => waiter.kill());
  let output = '';
  waiter.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const closed = new Promise(resolve => waiter.once('close', resolve));
  await delay(150);
  assert.equal(waiter.exitCode, null);
  const pendingResult = join(directory, 'result.tmp');
  writeFileSync(pendingResult, JSON.stringify({ ...owner, exitCode: 7, signal: null }));
  renameSync(pendingResult, join(directory, 'result.json'));
  assert.equal(await closed, 7);
  assert.equal(JSON.parse(output).state, 'failed');
});

test('live renderer validation chooses an available test-server port unless overridden', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-live-renderer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const occupied = String(listener.address().port);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
process.stdout.write(process.env.PLAYWRIGHT_PORT + ' reuse=' + process.env.PLAYWRIGHT_REUSE_SERVER);
`, { mode: 0o700 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  delete env.PLAYWRIGHT_PORT;
  env.PLAYWRIGHT_REUSE_SERVER = '1';
  for (const targets of ['e2e,e2e-webkit', 'e2e,e2e-quick']) {
    const mixed = spawnSync(process.execPath, [launcher, 'run', join(root, 'mixed'),
      'run-many', `--targets=${targets}`, '--projects=desktop'], { cwd: root, env });
    assert.notEqual(mixed.status, 0);
    assert.match(String(mixed.stderr), /separate validation directories/);
  }
  for (const [name, override, args] of [
    ['auto', undefined, ['run', 'desktop:e2e']],
    ['explicit', occupied, ['run', 'desktop:e2e']],
    ['bare', undefined, ['desktop:e2e']],
    ['many', undefined, ['run-many', '--targets=test,e2e', '--projects=desktop']],
    ['many-short', undefined, ['run-many', '-t', 'check,e2e', '-p', 'desktop']],
    ['quick', undefined, ['desktop:e2e-quick']],
    ['quick-shorthand', undefined, ['e2e-quick', 'desktop']],
    ['quick-many', undefined, ['run-many', '--targets=check,e2e-quick', '--projects=desktop']],
    ['webkit', undefined, ['desktop:e2e-webkit']],
    ['webkit-shorthand', undefined, ['e2e-webkit', 'desktop']],
    ['webkit-many', undefined, ['run-many', '--targets=check,e2e-webkit', '--projects=desktop']],
  ]) {
    const directory = join(root, name);
    const run = spawnSync(process.execPath, [launcher, 'run', directory, ...args], {
      cwd: root, env: override ? { ...env, PLAYWRIGHT_PORT: override } : env,
    });
    assert.equal(run.status, 0, String(run.stderr));
    const { rendererPort } = readStatus(directory);
    assert.match(rendererPort, /^[0-9]+$/);
    if (override) assert.equal(rendererPort, override);
    else assert.notEqual(rendererPort, occupied);
    assert.ok(readFileSync(join(directory, 'output.log'), 'utf8').endsWith(rendererPort + ' reuse=0'));
    if (name === 'bare') {
      const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
      assert.deepEqual(result.command, ['pnpm', 'nx', 'run', 'desktop:e2e']);
    }
  }
});

test('validation status verifies live ownership and the real final result', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-status-'));
  const directory = join(root, 'evidence'), bin = join(root, 'bin'), permit = join(root, 'continue');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
const fs = require('node:fs');
const timer = setInterval(() => {
  if (fs.existsSync(process.env.ALLOW_FINISH)) { clearInterval(timer); process.exit(7); }
}, 10);
`, { mode: 0o700 });
  assert.equal(readStatus(directory).state, 'not-started');
  const runner = spawn(process.execPath, [launcher, 'run', directory, 'run', 'desktop:fixture'], {
    cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ALLOW_FINISH: permit }, stdio: 'ignore',
  });
  const finished = new Promise(resolve => runner.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (runner.exitCode === null && !runner.signalCode) runner.kill('SIGTERM');
    await finished;
    rmSync(root, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 200 && !existsSync(join(directory, 'started.json')); attempt++) await delay(10);
  const active = readStatus(directory);
  assert.equal(active.state, 'running');
  assert.equal(active.runnerPid, runner.pid);
  assert.equal(active.runnerStart, processStart(runner.pid));
  assert.equal(active.log, join(directory, 'output.log'));
  writeFileSync(permit, '');
  assert.deepEqual(await finished, { code: 7, signal: null });
  const result = readStatus(directory);
  assert.equal(result.state, 'failed');
  assert.equal(result.exitCode, 7);
  assert.equal(result.runnerStart, active.runnerStart);
});

test('validation status distinguishes waiting, stale ownership and unverified legacy receipts', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-status-ownership-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipt = join(root, 'preparing.json');
  const runnerStart = processStart(process.pid);
  writeFileSync(receipt, JSON.stringify({ runnerPid: process.pid, runnerStart }));
  assert.equal(readStatus(root).state, 'preparing');
  writeFileSync(receipt, JSON.stringify({ runnerPid: process.pid, runnerStart: runnerStart + '0' }));
  assert.equal(readStatus(root).state, 'stopped-without-result');
  writeFileSync(receipt, JSON.stringify({ runnerPid: process.pid }));
  assert.equal(readStatus(root).state, 'unverified');
  writeFileSync(join(root, 'result.json'), JSON.stringify({ exitCode: 143, signal: 'SIGTERM' }));
  assert.equal(readStatus(root).state, 'interrupted');
});

test('validation status rejects nonregular or oversized terminal receipts without hanging', { skip: process.platform !== 'linux' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-invalid-run-receipt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipt = join(root, 'result.json');
  const inspect = () => {
    const run = spawnSync(process.execPath, [launcher, 'status', root], { encoding: 'utf8', timeout: 2000 });
    assert.ifError(run.error);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Invalid validation receipt: result\.json/);
    assert.equal(run.stdout, '');
    unlinkSync(receipt);
  };
  const other = join(root, 'other.json');
  writeFileSync(other, '{"exitCode":0}');
  symlinkSync(other, receipt);
  inspect();
  execFileSync('mkfifo', [receipt]);
  inspect();
  writeFileSync(receipt, '{"exitCode":0}' + ' '.repeat(1024 * 1024));
  inspect();
  assert.equal(readStatus(root).state, 'not-started');
});

test('renderer progress updates retry outcomes without deciding the validation result', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-renderer-progress-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runner = { runnerPid: process.pid, runnerStart: processStart(process.pid) };
  writeFileSync(join(root, 'started.json'), JSON.stringify(runner));
  const reporter = new RendererProgress({ path: join(root, 'renderer-progress.json') });
  const first = { id: 'owned-first', location: { file: join(root, 'first.spec.ts'), line: 42 } };
  const second = { id: 'owned-second', location: { file: join(root, 'second.spec.ts'), line: -5 } };
  reporter.onBegin(undefined, { allTests: () => [first, second] });
  const started = readStatus(root);
  assert.equal(started.state, 'running');
  assert.equal(started.rendererProgress.totalTests, 2);
  assert.equal(started.rendererProgress.testsReported, 0);
  assert.equal(started.rendererProgress.testsRemainingToReport, 2);
  assert.equal(started.rendererProgress.reportedPercent, 0);
  assert.equal(started.rendererProgress.activeAttempts, 0);
  assert.ok(Number.isSafeInteger(started.rendererProgress.testPhaseElapsedMs));
  assert.equal(started.rendererProgress.totalAttemptDurationMs, 0);
  reporter.onTestBegin(first);
  reporter.publish(null);
  const active = readStatus(root).rendererProgress;
  assert.equal(active.activeAttempts, 1);
  assert.equal(active.oldestActiveAttempts[0].spec, 'first.spec.ts');
  assert.equal(active.oldestActiveAttempts[0].line, 42);
  assert.ok(Number.isFinite(Date.parse(active.oldestActiveAttempts[0].startedAt)));
  assert.equal(active.testsReported, 0, 'an ongoing test must not count as completed');
  reporter.onTestBegin(second);
  reporter.publish(null);
  assert.equal(readStatus(root).rendererProgress.oldestActiveAttempts[1].line, undefined);
  reporter.onTestEnd(first, { status: 'failed', duration: 300 });
  reporter.onTestBegin(first);
  reporter.onTestEnd(first, { status: 'passed', duration: 200 });
  reporter.onTestEnd(second, { status: 'skipped', duration: 0 });
  reporter.onEnd({ status: 'passed' });
  writeFileSync(join(root, 'result.json'), JSON.stringify({ ...runner, exitCode: 7, signal: null }));
  const final = readStatus(root);
  assert.equal(final.state, 'failed', 'Playwright progress must not override the owned command receipt');
  assert.equal(final.rendererProgress.playwrightStatus, 'passed');
  assert.equal(final.rendererProgress.testsReported, 2);
  assert.equal(final.rendererProgress.testsRemainingToReport, 0);
  assert.equal(final.rendererProgress.reportedPercent, 100);
  assert.equal(final.rendererProgress.attemptsReported, 3);
  assert.ok(final.rendererProgress.testPhaseElapsedMs >= started.rendererProgress.testPhaseElapsedMs);
  assert.equal(final.rendererProgress.totalAttemptDurationMs, 500);
  assert.equal(final.rendererProgress.activeAttempts, 0);
  assert.deepEqual(final.rendererProgress.oldestActiveAttempts, []);
  assert.deepEqual(final.rendererProgress.slowestSpecsByAttemptTime, [
    { spec: 'first.spec.ts', durationMs: 500, timedAttempts: 2, maxAttemptMs: 300, maxAttemptLine: 42 },
    { spec: 'second.spec.ts', durationMs: 0, timedAttempts: 1, maxAttemptMs: 0 },
  ]);
  assert.deepEqual(final.rendererProgress.latestOutcomes, { passed: 1, failed: 0, timedOut: 0, skipped: 1, interrupted: 0 });
  rmSync(join(root, 'result.json'));
  writeFileSync(join(root, 'started.json'), JSON.stringify({ ...runner, runnerStart: runner.runnerStart + '0' }));
  const stopped = readStatus(root);
  assert.equal(stopped.state, 'stopped-without-result', 'a passing snapshot is not a missing command receipt');
  assert.deepEqual(stopped.rendererProgress, final.rendererProgress, 'keep the last observation after abrupt stop');
  writeFileSync(join(root, 'result.json'), JSON.stringify({ ...runner, exitCode: 7, signal: null }));
  const progressPath = join(root, 'renderer-progress.json');
  const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
  progress.slowestSpecsByAttemptTime = [
    { spec: 'old.spec.ts', durationMs: 500 },
    { spec: 'invalid-detail.spec.ts', durationMs: 50, timedAttempts: 99, maxAttemptMs: 60 },
  ];
  writeFileSync(progressPath, JSON.stringify(progress));
  assert.deepEqual(readStatus(root).rendererProgress.slowestSpecsByAttemptTime, [
    { spec: 'old.spec.ts', durationMs: 500 },
    { spec: 'invalid-detail.spec.ts', durationMs: 50 },
  ]);
  progress.slowestSpecsByAttemptTime = [{ spec: '/untrusted/path', durationMs: -1 }];
  progress.activeAttempts = 1;
  progress.testPhaseElapsedMs = -1;
  progress.totalAttemptDurationMs = '500';
  progress.oldestActiveAttempts = [{ spec: '/untrusted/path', startedAt: progress.updatedAt }];
  writeFileSync(progressPath, JSON.stringify(progress));
  const ignored = readStatus(root);
  assert.equal(ignored.rendererProgress.slowestSpecsByAttemptTime, undefined);
  assert.equal(ignored.rendererProgress.activeAttempts, undefined);
  assert.equal(ignored.rendererProgress.testPhaseElapsedMs, undefined);
  assert.equal(ignored.rendererProgress.totalAttemptDurationMs, undefined);
  assert.equal(ignored.rendererProgress.testsReported, 2);
  progress.totalTests = 10_000;
  progress.testsReported = 9_999;
  progress.attemptsReported = 10_038;
  progress.latestOutcomes = { passed: 9_998, failed: 1, timedOut: 0, skipped: 0, interrupted: 0 };
  writeFileSync(progressPath, JSON.stringify(progress));
  assert.equal(readStatus(root).rendererProgress.reportedPercent, 99.9);
  assert.equal(readStatus(root).rendererProgress.testsRemainingToReport, 1);
  progress.totalTests = 0;
  progress.testsReported = 0;
  progress.attemptsReported = 0;
  progress.latestOutcomes = { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 };
  writeFileSync(progressPath, JSON.stringify(progress));
  assert.equal(readStatus(root).rendererProgress.reportedPercent, null);
  writeFileSync(join(root, 'renderer-progress.json'), ' '.repeat(8193));
  const invalid = readStatus(root);
  assert.equal(invalid.state, 'failed');
  assert.equal(invalid.rendererProgress, undefined);
});

test('named validations in one checkout cannot erase another run or caller-owned artifact files', () => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-isolation-'));
  try {
    const bin = join(root, 'bin'), cwd = join(root, 'same checkout'), shared = join(root, 'shared');
    for (const path of [bin, cwd, shared]) mkdirSync(path);
    writeFileSync(join(shared, 'retain'), 'caller-owned fixture evidence');
    // Simulate the destructive startup behavior of a renderer runner, not its internals.
    writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.GIT_KHRONOS_RENDERER_PROGRESS_FILE, process.env.OWNED_VALIDATION_LABEL);
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
          GIT_KHRONOS_RENDERER_OUTPUT_DIR: shared, GIT_KHRONOS_RENDERER_REPORT_DIR: shared,
          GIT_KHRONOS_RENDERER_PROGRESS_FILE: join(shared, 'retain') },
      });
      const started = JSON.parse(readFileSync(join(directory, 'started.json'), 'utf8'));
      const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
      assert.equal(started.source.cwd, cwd); assert.equal(result.source.cwd, cwd);
      assert.equal(result.exitCode, 0);
    }
    for (const label of ['first', 'second']) {
      assert.equal(readFileSync(join(root, `run ${label}`, 'renderer-progress.json'), 'utf8'), label);
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

test('detached start refuses an existing directory or missing parent before returning success', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-start-refusal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'retain'), 'existing fixture evidence');
  for (const [path, error] of [[root, 'EEXIST'], [join(root, 'missing', 'run'), 'ENOENT']]) {
    const result = spawnSync(process.execPath, [launcher, 'start', path, 'run', 'desktop:fixture'], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, new RegExp(error));
    assert.equal(existsSync(join(path, 'preparing.json')), false);
  }
  assert.equal(readFileSync(join(root, 'retain'), 'utf8'), 'existing fixture evidence');
});

test('concurrent detached starts acknowledge only the owner with a visible receipt', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-run-start-claim-'));
  const directory = join(root, 'evidence'), bin = join(root, 'bin');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o700 });
  const start = () => new Promise((resolve, reject) => {
    const process_ = spawn(process.execPath, [launcher, 'start', directory, 'run', 'desktop:fixture'], {
      cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    process_.stdout.on('data', chunk => { stdout += chunk; });
    process_.stderr.on('data', chunk => { stderr += chunk; });
    process_.once('error', reject);
    process_.once('close', status => resolve({ status, stdout, stderr, receipt: readStatus(directory) }));
  });
  const results = await Promise.all([start(), start()]);
  assert.deepEqual(results.map(result => result.status).sort(), [0, 1]);
  const won = results.find(result => result.status === 0);
  const lost = results.find(result => result.status === 1);
  assert.match(lost.stderr, /EEXIST/);
  assert.equal(lost.stdout, '');
  assert.equal(won.receipt.runnerPid, JSON.parse(won.stdout).runnerPid);
  for (let attempt = 0; attempt < 200 && !existsSync(join(directory, 'result.json')); attempt++) await delay(10);
  assert.equal(readStatus(directory).state, 'passed');
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
  for (const path of ['node_modules', '.angular/cache', '.nx/cache']) {
    fs.mkdirSync(path, { recursive: true });
    fs.writeFileSync(path + '/owned-cache', 'generated and disposable');
  }
} else {
  assert.deepEqual(args, ['nx', 'run', 'desktop:e2e']);
  assert.equal(fs.readFileSync('offline-install', 'utf8'), 'owned dependency setup');
  assert.match(process.env.PLAYWRIGHT_PORT, /^[0-9]+$/);
  fs.writeFileSync('tested', process.env.PLAYWRIGHT_PORT);
}
`, { mode: 0o700 });
    const options = { cwd, env: { ...env, PATH: `${bin}:${process.env.PATH}`, CI: '', FIXTURE_SPEC: spec,
      GIT_DIR: '/nonexistent', NX_WORKSPACE_ROOT_PATH: cwd } };
    delete options.env.PLAYWRIGHT_PORT;
    execFileSync(process.execPath, [launcher, 'run', directory, '--snapshot', 'HEAD', 'run', 'desktop:e2e'], options);
    const expected = { cwd, commit, commandCwd: join(directory, 'source'), mode: 'commit-snapshot' };
    for (const receipt of ['preparing.json', 'started.json', 'result.json']) {
      assert.deepEqual(JSON.parse(readFileSync(join(directory, receipt), 'utf8')).source, expected);
    }
    const port = readFileSync(join(expected.commandCwd, 'tested'), 'utf8');
    assert.ok(Number(port) > 0 && Number(port) <= 65535);
    for (const receipt of ['started.json', 'result.json']) {
      assert.equal(JSON.parse(readFileSync(join(directory, receipt), 'utf8')).rendererPort, port);
    }
    for (const cache of ['node_modules', '.angular/cache', '.nx/cache']) {
      assert.equal(existsSync(join(expected.commandCwd, cache)), false, cache);
    }
    assert.equal(readFileSync(join(expected.commandCwd, 'graph.spec.ts'), 'utf8'), 'committed test');
    assert.equal(readFileSync(spec, 'utf8'), 'live edit during validation');
    assert.equal(git('rev-parse', 'HEAD'), commit);
    assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);

    const specified = join(cwd, 'specified port');
    execFileSync(process.execPath, [launcher, 'run', specified, '--snapshot', commit, 'run', 'desktop:e2e'],
      { ...options, env: { ...options.env, PLAYWRIGHT_PORT: '44213' } });
    assert.equal(readFileSync(join(specified, 'source/tested'), 'utf8'), '44213');
    assert.equal(JSON.parse(readFileSync(join(specified, 'result.json'), 'utf8')).rendererPort, '44213');

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

test('WebKit preflight distinguishes a missing browser from an executable that cannot start', {
  skip: process.platform !== 'linux' ? 'uses a POSIX fixture executable' : false,
}, t => {
  const cache = mkdtempSync(join(tmpdir(), 'gk-webkit-preflight-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache };
  const check = fileURLToPath(new URL('./check-renderer-browser.mjs', import.meta.url));
  const run = (browser = 'webkit') => spawnSync(process.execPath, [check, browser], { env, encoding: 'utf8', timeout: 15_000 });
  const missing = run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /not installed or executable/);
  const executable = execFileSync(process.execPath, ['--input-type=module', '-e',
    'import { webkit } from "@playwright/test"; console.log(webkit.executablePath());'],
  { env, encoding: 'utf8' }).trim();
  assert.ok(executable.startsWith(cache + '/'), executable);
  mkdirSync(join(executable, '..'), { recursive: true });
  writeFileSync(join(executable, '..', 'DEPENDENCIES_VALIDATED'), '');
  writeFileSync(executable, '#!/bin/sh\nprintf "owned fixture refused launch\\n" >&2\nexit 24\n', { mode: 0o700 });
  const broken = run();
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /installed but could not start/);
  assert.match(broken.stderr, /owned fixture refused launch/);
  const missingChromium = run('chromium');
  assert.equal(missingChromium.status, 1);
  assert.match(missingChromium.stderr, /Playwright Chromium could not start/);
  assert.equal(run('unapproved-browser').status, 2);
});

test('a receipt from another Linux boot cannot claim a live PID', { skip: !currentBootId() }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'gk-run-boot-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'started.json');
  const owner = { runnerPid: process.pid, runnerStart: processStart(process.pid), runnerBootId: currentBootId() };
  writeFileSync(file, JSON.stringify(owner));
  assert.equal(readStatus(directory).state, 'running');
  writeFileSync(file, JSON.stringify({ ...owner, runnerBootId: owner.runnerBootId.replace(/^./, c => c === '0' ? '1' : '0') }));
  const stopped = readStatus(directory);
  assert.equal(stopped.state, 'stopped-without-result');
  assert.equal(stopped.stopReason, 'different-boot');
});

test('reclaim removes only disposable caches from a renderer snapshot on a previous boot', { skip: !currentBootId() }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'gk-reclaim-snapshot-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const outside = join(directory, 'outside');
  mkdirSync(join(outside, 'cache'), { recursive: true });
  mkdirSync(join(source, 'node_modules'), { recursive: true });
  symlinkSync(outside, join(source, '.nx'), 'dir');
  const committed = join(source, 'package.json');
  const log = join(directory, 'output.log');
  writeFileSync(committed, 'committed input');
  writeFileSync(log, 'interrupted evidence');
  const owner = {
    runnerPid: process.pid, runnerStart: processStart(process.pid), runnerBootId: currentBootId(),
    command: ['pnpm', 'nx', 'run', 'desktop:e2e'],
    rendererPort: '4202', source: { mode: 'commit-snapshot', commandCwd: source },
  };
  const receipt = join(directory, 'started.json');
  const reclaim = () => spawnSync(process.execPath, [launcher, 'reclaim', directory], { encoding: 'utf8' });
  writeFileSync(receipt, JSON.stringify(owner));
  assert.notEqual(reclaim().status, 0);
  assert.ok(existsSync(join(source, 'node_modules')));
  const old = owner.runnerBootId.replace(/^./, c => c === '0' ? '1' : '0');
  writeFileSync(receipt, JSON.stringify({ ...owner, runnerBootId: old }));
  const result = reclaim();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(source, 'node_modules')), false);
  assert.ok(existsSync(join(outside, 'cache')));
  assert.equal(readFileSync(committed, 'utf8'), 'committed input');
  assert.equal(readFileSync(log, 'utf8'), 'interrupted evidence');
  assert.equal(readStatus(directory).state, 'stopped-without-result');
});

test('reclaim accepts renderer dependency setup after a reboot, not another snapshot type',
  { skip: !currentBootId() }, t => {
    const directory = mkdtempSync(join(tmpdir(), 'gk-reclaim-preparing-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const source = join(directory, 'source');
    const cache = join(source, 'node_modules');
    mkdirSync(cache, { recursive: true });
    const receipt = join(directory, 'preparing.json');
    const owner = {
      runnerPid: process.pid, runnerStart: processStart(process.pid), runnerBootId: currentBootId(),
      source: { mode: 'commit-snapshot', commandCwd: source },
    };
    const record = (runnerBootId, target) => writeFileSync(receipt, JSON.stringify({
      ...owner, runnerBootId, command: ['pnpm', 'nx', 'run', target],
    }));
    const reclaim = () => spawnSync(process.execPath, [launcher, 'reclaim', directory], { encoding: 'utf8' });
    const old = owner.runnerBootId.replace(/^./, c => c === '0' ? '1' : '0');
    record(owner.runnerBootId, 'desktop:e2e:repository-confirmations');
    assert.notEqual(reclaim().status, 0);
    record(old, 'desktop:package-deb');
    assert.notEqual(reclaim().status, 0);
    assert.ok(existsSync(cache));
    record(old, 'desktop:e2e:repository-confirmations');
    const removed = reclaim();
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(cache), false);
    assert.equal(readStatus(directory).state, 'stopped-without-result');
  });
