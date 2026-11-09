import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedCommand } from './owned-command.mjs';

const linux = { skip: process.platform !== 'linux', timeout: 10_000 };
const running = pid => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return !['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

test('preserves exit status and complete output from an ordinary owned command', linux, async () => {
  let stdout = '', stderr = '';
  const result = await runOwnedCommand(process.execPath, ['-e',
    'process.stdout.write("ordinary output"); process.stderr.write("ordinary error"); process.exitCode = 7;'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    onSpawn(child) {
      child.stdout.on('data', bytes => stdout += bytes);
      child.stderr.on('data', bytes => stderr += bytes);
    },
  });
  assert.deepEqual(result, { code: 7, signal: null });
  assert.equal(stdout, 'ordinary output');
  assert.equal(stderr, 'ordinary error');
});

test('a controller relays interruption through a nested wrapper before exiting', linux, async () => {
  const moduleUrl = new URL('./owned-command.mjs', import.meta.url).href;
  const leaf = 'process.stdout.write(JSON.stringify({ leaf: process.pid }) + "\\n"); setInterval(() => {}, 1000);';
  const wrapper = `
    const { runOwnedCommand } = await import(${JSON.stringify(moduleUrl)});
    const controller = new AbortController();
    process.on('SIGINT', () => controller.abort());
    try {
      await runOwnedCommand(process.execPath, ['-e', ${JSON.stringify(leaf)}], {
        signal: controller.signal, stdio: 'inherit', gracefulSignal: 'SIGINT', graceMs: 100,
      });
    } catch (error) { if (!controller.signal.aborted) throw error; process.exitCode = 130; }
  `;
  const outer = `
    const { runOwnedCommand } = await import(${JSON.stringify(moduleUrl)});
    const controller = new AbortController();
    process.on('SIGTERM', () => controller.abort());
    try {
      await runOwnedCommand(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(wrapper)}], {
        signal: controller.signal, stdio: 'inherit', gracefulSignal: 'SIGINT', graceMs: 1000,
      });
    } catch (error) { if (!controller.signal.aborted) throw error; process.exitCode = 143; }
  `;
  const controller = new AbortController();
  let leafPid, announce;
  const announced = new Promise(resolve => announce = resolve);
  const completion = runOwnedCommand(process.execPath, ['--input-type=module', '-e', outer], {
    signal: controller.signal, stdio: ['ignore', 'pipe', 'pipe'], graceMs: 2000,
    onSpawn(child) {
      let stdout = '';
      child.stdout.on('data', bytes => {
        stdout += bytes;
        if (stdout.includes('\n')) { leafPid = JSON.parse(stdout.trim()).leaf; announce(); }
      });
    },
  });
  const rejected = assert.rejects(completion, { name: 'AbortError' });
  let deadline;
  try {
    await Promise.race([announced, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Nested fixture did not become ready.')), 3000);
    })]);
    assert.equal(running(leafPid), true);
    controller.abort();
    await rejected;
    assert.equal(running(leafPid), false);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await rejected;
  }
});

test('an already aborted command never spawns', linux, async () => {
  const controller = new AbortController();
  controller.abort();
  let spawned = false;
  await assert.rejects(runOwnedCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    signal: controller.signal, onSpawn() { spawned = true; },
  }), { name: 'AbortError' });
  assert.equal(spawned, false);
});

test('the real validation CLI records interruption after reclaiming its command tree', linux, async () => {
  const root = mkdtempSync(join(tmpdir(), 'git-khronos-validation-cli-'));
  const bin = join(root, 'bin');
  const directory = join(root, 'run');
  mkdirSync(bin, { mode: 0o700 });
  // Replace pnpm only for this fixture's environment. No Nx, browser, or build
  // is launched, and neither the user's PATH nor their package manager changes.
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'process.send("ready"); setInterval(() => {}, 1000);'],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.on('message', () => console.log(JSON.stringify({ leaf: child.pid })));
    setInterval(() => {}, 1000);
  `, { mode: 0o700 });
  const controller = new AbortController();
  const completion = runOwnedCommand(process.execPath, [
    fileURLToPath(new URL('./run-validation.mjs', import.meta.url)), 'run', directory, 'fixture',
  ], {
    signal: controller.signal, graceMs: 3000, stdio: 'ignore',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
  const rejected = assert.rejects(completion, { name: 'AbortError' });
  try {
    const deadline = Date.now() + 3000;
    let leaf;
    while (!leaf) {
      const output = join(directory, 'output.log');
      const text = existsSync(output) ? readFileSync(output, 'utf8') : '';
      if (text.includes('\n')) leaf = JSON.parse(text.trim()).leaf;
      if (Date.now() > deadline) throw new Error('Validation CLI fixture did not become ready.');
      if (!leaf) await delay(25);
    }
    const started = JSON.parse(readFileSync(join(directory, 'started.json'), 'utf8'));
    assert.equal(running(started.childPid), true);
    assert.equal(running(leaf), true);
    controller.abort();
    await rejected;
    const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
    assert.equal(result.exitCode, 143);
    assert.equal(result.signal, 'SIGTERM');
    assert.equal(running(started.runnerPid), false);
    assert.equal(running(started.childPid), false);
    assert.equal(running(leaf), false);
  } finally {
    controller.abort();
    await rejected;
    // Exclusively created fixture, after all owned processes have stopped.
    rmSync(root, { recursive: true });
  }
});

test('a spawn failure reports its original error without signaling any group', linux, async () => {
  await assert.rejects(runOwnedCommand(`/tmp/git-khronos-absent-executable-${process.pid}`, []), { code: 'ENOENT' });
});

test('a terminal report write failure remains nonzero and never closes output twice', linux, async () => {
  const root = mkdtempSync(join(tmpdir(), 'git-khronos-validation-report-'));
  const bin = join(root, 'bin');
  const directory = join(root, 'run');
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
    require('node:fs').mkdirSync(require('node:path').join(process.env.GIT_KHRONOS_TEST_RUN_DIRECTORY, 'result.json'));
  `, { mode: 0o700 });
  let stderr = '';
  try {
    const result = await runOwnedCommand(process.execPath, [
      fileURLToPath(new URL('./run-validation.mjs', import.meta.url)), 'run', directory, 'fixture',
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, GIT_KHRONOS_TEST_RUN_DIRECTORY: directory },
      onSpawn(child) { child.stderr.on('data', bytes => stderr += bytes); },
    });
    assert.notEqual(result.code, 0);
    assert.match(stderr, /EISDIR/);
    assert.doesNotMatch(stderr, /EBADF/, 'the original reporting error must not be hidden by a second close');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('reclaims a descendant after its command leader has already exited', linux, async () => {
  let stdout = '';
  const script = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    child.on('spawn', () => { process.stdout.write(String(child.pid)); process.exit(0); });
  `;
  const result = await runOwnedCommand(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'], graceMs: 100,
    onSpawn(child) { child.stdout.on('data', bytes => stdout += bytes); },
  });
  assert.equal(result.code, 0);
  assert.match(stdout, /^\d+$/);
  assert.equal(running(Number(stdout)), false, 'the background descendant must not survive the command');
});

test('abort stops the owned tree, escalates resistant children, and leaves another group alive', linux, async () => {
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true, stdio: 'ignore',
  });
  await once(sentinel, 'spawn');
  const controller = new AbortController();
  let leader, descendant;
  let ready;
  const announced = new Promise(resolve => ready = resolve);
  const script = `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const child = spawn(process.execPath, ['-e',
      'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000);'],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.on('message', () => process.stdout.write(String(child.pid) + '\\n'));
    setInterval(() => {}, 1000);
  `;
  const completion = runOwnedCommand(process.execPath, ['-e', script], {
    signal: controller.signal, stdio: ['ignore', 'pipe', 'pipe'], graceMs: 100,
    onSpawn(child) {
      leader = child.pid;
      let stdout = '';
      child.stdout.on('data', bytes => {
        stdout += bytes;
        if (stdout.includes('\n')) { descendant = Number(stdout.trim()); ready(); }
      });
    },
  });
  // Attach rejection handling before abort, so cancellation is never an
  // unhandled-rejection race in the test itself.
  const rejected = assert.rejects(completion, { name: 'AbortError' });
  let deadline;
  try {
    await Promise.race([announced, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Resistant fixture did not become ready.')), 3000);
    })]);
    assert.equal(running(leader), true);
    assert.equal(running(descendant), true);
    controller.abort();
    await rejected;
    assert.equal(running(leader), false);
    assert.equal(running(descendant), false);
    assert.equal(running(sentinel.pid), true, 'an unrelated group is outside cleanup scope');
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await rejected;
    const exited = once(sentinel, 'exit');
    sentinel.kill('SIGTERM');
    await exited;
  }
});
