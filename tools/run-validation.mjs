import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runOwnedCommand } from './owned-command.mjs';
import { currentBootId, processStart, validationStatus } from './validation-status.mjs';
import { validationSourceFingerprint } from './validation-source.mjs';
import { requireRendererSnapshotSpace } from './validation-space.mjs';

function reclaimSnapshotCaches(source, output) {
  let failures = 0;
  for (const cache of ['node_modules', '.angular/cache', '.nx/cache']) {
    const path = join(source, cache);
    try {
      // Do not follow a replaced snapshot or cache parent/link outside it.
      if (realpathSync(path) === path) rmSync(path, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        failures++;
        writeFileSync(output, `==> Could not remove snapshot cache ${cache}: ${error.code ?? 'unknown error'}\n`);
      }
    }
  }
  return failures;
}

function discardRendererWorkerScratch(directory) {
  const artifacts = join(directory, 'renderer-artifacts');
  try {
    if (realpathSync(artifacts) !== artifacts) throw new Error('renderer-artifacts is not a local directory');
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let count = 0;
  for (const entry of readdirSync(artifacts, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\.playwright-artifacts-\d+$/.test(entry.name)) continue;
    const scratch = join(artifacts, entry.name);
    if (realpathSync(scratch) !== scratch) continue;
    rmSync(scratch, { recursive: true, force: true });
    count++;
  }
  return count;
}

const rendererTargets = new Set(['e2e', 'e2e-quick', 'e2e-webkit']);
const isDesktopRenderer = value => {
  const [project, target] = (value ?? '').split(':');
  return project === 'desktop' && rendererTargets.has(target);
};
function rendererSelection(args) {
  const nxArgs = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
  const selectedRendererTargets = nxArgs[0] === 'run-many' ? new Set(nxArgs.flatMap((argument, index) => {
    const flag = /^(?:-t|--target|--targets)(?:=(.*))?$/.exec(argument);
    return flag ? (flag[1] ?? nxArgs[index + 1] ?? '').split(/[,\s]+/).filter(target => rendererTargets.has(target)) : [];
  })) : new Set();
  return {
    ambiguous: selectedRendererTargets.size > 1,
    rendererRun: (nxArgs[0] === 'run' && isDesktopRenderer(nxArgs[1]))
      || (rendererTargets.has(nxArgs[0]) && nxArgs[1] === 'desktop')
      || selectedRendererTargets.size === 1,
  };
}

const [mode, runDirectory, ...args] = process.argv.slice(2);
const usage = `Usage:
  node tools/run-validation.mjs start DIRECTORY [--snapshot REF | --guard-source] NX_COMMAND [NX_ARGS...]
  node tools/run-validation.mjs run   DIRECTORY [--snapshot REF | --guard-source] NX_COMMAND [NX_ARGS...]
  node tools/run-validation.mjs status DIRECTORY
  node tools/run-validation.mjs wait   DIRECTORY
  node tools/run-validation.mjs reclaim DIRECTORY [--discard-worker-scratch]

Use start for a detached run, or run to wait in the foreground.
Without --snapshot the run uses the current checkout; with it, it uses the named local commit.
--guard-source refuses a passing result if Git-visible checkout files differ at the end.
Use wait to observe an existing run and return its exit code, without taking ownership.
Use reclaim to remove disposable caches from an interrupted renderer snapshot after a reboot.
--discard-worker-scratch also removes raw Playwright worker recordings, including unfinished-test diagnostics.
It keeps exported failure screenshots and trace archives, progress, and logs.

Example:
  node tools/run-validation.mjs start target/validation-runs/local-check run desktop:e2e -- --workers=2
`;
if (mode === '--help' || mode === '-h') {
  process.stdout.write(usage);
  process.exit(0);
}
const useSnapshot = args[0] === '--snapshot';
const snapshot = useSnapshot ? args.splice(0, 2)[1] : undefined;
const guardSource = !useSnapshot && args[0] === '--guard-source';
if (guardSource) args.shift();
if (!runDirectory || !['start', 'run', 'status', 'wait', 'reclaim'].includes(mode)) {
  throw new Error('Expected start|run DIRECTORY [--snapshot REF] [Nx arguments], or status|wait|reclaim DIRECTORY');
}
if (mode === 'reclaim') {
  const discardScratch = args.length === 1 && args[0] === '--discard-worker-scratch';
  if (useSnapshot || guardSource || (args.length && !discardScratch)) {
    throw new Error('reclaim accepts a run directory and optional --discard-worker-scratch');
  }
  const directory = resolve(runDirectory);
  const source = join(directory, 'source');
  const status = validationStatus(directory);
  // A boot can interrupt pnpm install before the run has a renderer port.
  // Classify the recorded Nx command, not the later Playwright metadata.
  const command = status.command;
  const rendererSnapshot = Array.isArray(command) && command.every(arg => typeof arg === 'string')
    && command[0] === 'pnpm' && command[1] === 'nx'
    && rendererSelection(command.slice(2)).rendererRun;
  if (status.state !== 'stopped-without-result' || status.stopReason !== 'different-boot'
    || status.source?.mode !== 'commit-snapshot' || status.source.commandCwd !== source
    || !rendererSnapshot
    || realpathSync(directory) !== directory || realpathSync(source) !== source) {
    throw new Error('Refusing to reclaim: expected an owned renderer snapshot interrupted on a previous boot.');
  }
  const failures = reclaimSnapshotCaches(source, process.stderr.fd);
  if (failures) process.exit(1);
  if (discardScratch) {
    const count = discardRendererWorkerScratch(directory);
    console.log(`Reclaimed disposable renderer snapshot caches and ${count} raw Playwright worker directories. Exported reports and traces, sources, progress and logs are untouched.`);
  } else {
    console.log('Reclaimed disposable renderer snapshot caches. Sources, logs, and evidence are untouched.');
  }
  process.exit(0);
}
if (mode === 'status' || mode === 'wait') {
  if (useSnapshot || guardSource || args.length) throw new Error(`${mode} accepts only a run directory`);
  const directory = resolve(runDirectory);
  let status = validationStatus(directory);
  while (mode === 'wait' && ['preparing', 'running'].includes(status.state)) {
    await delay(1000);
    status = validationStatus(directory);
  }
  writeFileSync(process.stdout.fd, JSON.stringify(status, null, 2) + '\n');
  if (mode === 'status') process.exit(0);
  const code = status.exitCode;
  process.exit(Number.isInteger(code) && code >= 0 && code <= 255 ? code : 1);
}
if (useSnapshot && (!snapshot || !args.length)) {
  throw new Error('--snapshot needs a Git ref followed by Nx arguments');
}
if (!args.length) {
  process.stderr.write(usage);
  process.exit(2);
}
// Accept the target notation used in diagnostics, but Nx needs the explicit
// run verb before a project:target[:configuration] argument.
if (/^[\w@][\w@./-]*:[\w.-]+(?::[\w.-]+)?$/.test(args[0])) args.unshift('run');
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const gitArgs = ['--no-optional-locks', '-c', 'core.fsmonitor=false'];
const gitValue = args => {
  const result = spawnSync('git', [...gitArgs, ...args], {
    cwd: process.cwd(), env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : null;
};
// Resolve a moving ref before the detached worker can be delayed or the
// caller can move the branch. The worker receives only the resolved commit.
const commit = snapshot && gitValue(['rev-parse', '--verify', '--end-of-options', `${snapshot}^{commit}`]);
if (snapshot && !commit) throw new Error('Snapshot ref does not resolve to a local commit');

const directory = resolve(runDirectory);
const commandCwd = commit ? join(directory, 'source') : process.cwd();
if (commit && directory.includes(delimiter)) throw new Error('Snapshot run path contains Git’s path-list delimiter');
const { ambiguous, rendererRun } = rendererSelection(args);
if (ambiguous) {
  throw new Error('Run renderer targets in separate validation directories so each owns its port and renderer progress.');
}

async function selectRendererPort() {
  const server = createServer();
  await new Promise((ready, failed) => {
    server.once('error', failed);
    server.listen({ host: '127.0.0.1', port: 0 }, ready);
  });
  const { port } = server.address();
  await new Promise((ready, failed) => server.close(error => error ? failed(error) : ready()));
  return String(port);
}

// Every named invocation owns its artifacts, even if another run shares its checkout.
const environment = {
  ...(commit ? {
    ...gitEnv,
    // A run directory can be nested in the original checkout. Do not let
    // Git's upward search or an inherited Nx override reach live sources.
    GIT_CEILING_DIRECTORIES: directory, NX_WORKSPACE_ROOT_PATH: commandCwd,
    CI: '1', NX_DAEMON: 'false', NX_NO_CLOUD: 'true',
  } : process.env),
  GIT_KHRONOS_RENDERER_OUTPUT_DIR: join(directory, 'renderer-artifacts'),
  GIT_KHRONOS_RENDERER_REPORT_DIR: join(directory, 'renderer-report'),
  GIT_KHRONOS_RENDERER_PROGRESS_FILE: rendererRun ? join(directory, 'renderer-progress.json') : undefined,
};
if (mode === 'start') {
  const runner = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', directory,
    ...(commit ? ['--snapshot', commit] : guardSource ? ['--guard-source'] : []), ...args], {
    cwd: process.cwd(), detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...environment, NX_DAEMON: 'false', NX_ISOLATE_PLUGINS: 'false' },
  });
  try {
    // A PID only proves spawn succeeded. Report success after this worker
    // claims the evidence directory and publishes its first readable receipt.
    const startup = await new Promise((ready, failed) => {
      runner.once('message', ready);
      runner.once('error', failed);
      runner.once('disconnect', () => failed(new Error('Validation worker disconnected before startup')));
      runner.once('exit', (code, signal) => failed(new Error(`Validation worker exited before startup (${signal ?? code})`)));
    });
    if (startup.ready !== true) throw new Error(startup.error ?? 'Invalid validation startup response');
    console.log(JSON.stringify({ runnerPid: runner.pid, directory }));
  } catch (error) {
    console.error(`Could not start validation: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (runner.connected) runner.disconnect();
    runner.unref();
  }
} else {
  try {
    await runValidation();
  } catch (error) {
    if (!process.connected) throw error;
    process.send({ error: error.message }, () => {});
    process.exitCode = 1;
  }
}

async function runValidation() {
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const command = ['pnpm', 'nx', ...args];
  const source = commit ? { cwd: process.cwd(), commit, commandCwd, mode: 'commit-snapshot' }
    : { cwd: process.cwd(), commit: gitValue(['rev-parse', 'HEAD']),
      branch: gitValue(['symbolic-ref', '--short', '-q', 'HEAD']),
      status: gitValue(['status', '--porcelain=v1', '--untracked-files=normal']) };
  const started = new Date().toISOString();
  const runnerBootId = currentBootId();
  const runner = { runnerPid: process.pid, runnerStart: processStart(process.pid), ...(runnerBootId ? { runnerBootId } : {}) };
  const writeReceipt = (name, data) => {
    const destination = join(directory, name);
    const temporary = `${destination}.${process.pid}.tmp`;
    const file = openSync(temporary, 'wx', 0o600);
    try {
      try { writeFileSync(file, JSON.stringify(data, null, 2)); }
      finally { closeSync(file); }
      renameSync(temporary, destination);
    } finally { rmSync(temporary, { force: true }); }
  };
  const output = openSync(join(directory, 'output.log'), 'wx', 0o600);
  const controller = new AbortController();
  let interrupted;
  const interrupt = signal => { interrupted ??= signal; controller.abort(); };
  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  let rendererPort;
  let sourceCheck;
  const finish = (exitCode, signal, error) => {
    closeSync(output);
    writeReceipt('result.json', {
      ...runner, command, source, started, rendererPort, finished: new Date().toISOString(), exitCode, signal, error, sourceCheck,
    });
    process.exitCode = exitCode ?? 1;
  };
  let outcome;
  const ownedOptions = {
    cwd: commandCwd, env: environment, stdio: ['ignore', output, output], signal: controller.signal,
    gracefulSignal: 'SIGINT', graceMs: 10_000,
  };
  const prepare = async (label, binary, arguments_, options = {}) => {
    writeFileSync(output, `==> ${label}\n`);
    const { code, signal } = await runOwnedCommand(binary, arguments_, { ...ownedOptions, ...options });
    if (code !== 0) throw new Error(`${label} failed (${signal ?? code}); see output.log`);
  };
  try {
    writeReceipt('preparing.json', { ...runner, command, source, started });
    if (process.connected) process.send({ ready: true }, () => {});
    if (guardSource) {
      source.inputFingerprint = validationSourceFingerprint(commandCwd, gitEnv);
    }
    if (commit) {
      if (rendererRun) requireRendererSnapshotSpace(directory);
      const archive = join(directory, 'snapshot.tar');
      mkdirSync(commandCwd);
      await prepare('Exporting committed source', 'git', [...gitArgs, 'archive', '--format=tar',
        `--output=${archive}`, commit], { cwd: process.cwd(), env: gitEnv });
      await prepare('Extracting the snapshot', 'tar', ['-xf', archive]);
      rmSync(archive);
      await prepare('Installing pinned dependencies offline', 'pnpm', ['install', '--offline', '--frozen-lockfile']);
    }
    if (rendererRun) {
      rendererPort = environment.PLAYWRIGHT_PORT ?? await selectRendererPort();
      environment.PLAYWRIGHT_PORT = rendererPort;
      // A named receipt must come from the source this run serves, not an
      // unrelated server that the parent shell opted into for interactive use.
      environment.PLAYWRIGHT_REUSE_SERVER = '0';
      writeFileSync(output, `==> Renderer test server: 127.0.0.1:${rendererPort}\n`);
    }
    const result = await runOwnedCommand(command[0], command.slice(1), {
      ...ownedOptions,
      onSpawn(child) {
        writeReceipt('started.json', { ...runner, childPid: child.pid, command, source, started, rendererPort });
      },
    });
    outcome = [result.code, result.signal, undefined];
    if (guardSource) {
      try {
        const fingerprint = validationSourceFingerprint(commandCwd, gitEnv);
        const changed = fingerprint !== source.inputFingerprint
          || gitValue(['rev-parse', 'HEAD']) !== source.commit
          || gitValue(['symbolic-ref', '--short', '-q', 'HEAD']) !== source.branch;
        sourceCheck = { state: changed ? 'changed' : 'unchanged', fingerprint };
      } catch (error) {
        sourceCheck = { state: 'unverified', error: error.message };
      }
      if (sourceCheck.state !== 'unchanged' && result.code === 0) {
        outcome = [1, null, 'Validation command passed, but the checkout input guard did not.'];
      }
    }
  } catch (error) {
    outcome = [interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1,
      interrupted ?? null, String(error)];
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
  // Renderer artifacts are written outside the exported source. Keep those
  // and the source itself; reclaim only generated caches in our own snapshot.
  if (commit && rendererRun) reclaimSnapshotCaches(commandCwd, output);
  // Persist once, outside the command catch: a reporting failure must remain a
  // nonzero worker failure, not trigger another close or masquerade as success.
  finish(...outcome);
}
