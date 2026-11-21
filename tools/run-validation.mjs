import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedCommand } from './owned-command.mjs';
import { processStart, validationStatus } from './validation-status.mjs';

const [mode, runDirectory, ...args] = process.argv.slice(2);
const useSnapshot = args[0] === '--snapshot';
const snapshot = useSnapshot ? args.splice(0, 2)[1] : undefined;
if (!runDirectory || !['start', 'run', 'status'].includes(mode)) {
  throw new Error('Expected start|run DIRECTORY [--snapshot REF] [Nx arguments], or status DIRECTORY');
}
if (mode === 'status') {
  if (useSnapshot || args.length) throw new Error('status accepts only a run directory');
  writeFileSync(process.stdout.fd, JSON.stringify(validationStatus(resolve(runDirectory)), null, 2) + '\n');
  process.exit(0);
}
if (useSnapshot && (!snapshot || !args.length)) {
  throw new Error('--snapshot needs a Git ref followed by Nx arguments');
}
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
const rendererSnapshot = Boolean(commit) && (
  args.some(argument => argument === 'desktop:e2e' || argument.startsWith('desktop:e2e:'))
  || (args[0] === 'e2e' && args[1] === 'desktop')
);

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
};
if (mode === 'start') {
  const runner = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', directory,
    ...(commit ? ['--snapshot', commit] : []), ...args], {
    cwd: process.cwd(), detached: true, stdio: 'ignore',
    env: { ...environment, NX_DAEMON: 'false', NX_ISOLATE_PLUGINS: 'false' },
  });
  runner.unref();
  console.log(JSON.stringify({ runnerPid: runner.pid, directory }));
} else {
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const command = ['pnpm', 'nx', ...args];
  const source = commit ? { cwd: process.cwd(), commit, commandCwd, mode: 'commit-snapshot' }
    : { cwd: process.cwd(), commit: gitValue(['rev-parse', 'HEAD']),
      branch: gitValue(['symbolic-ref', '--short', '-q', 'HEAD']),
      status: gitValue(['status', '--porcelain=v1', '--untracked-files=normal']) };
  const started = new Date().toISOString();
  const runner = { runnerPid: process.pid, runnerStart: processStart(process.pid) };
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
  const finish = (exitCode, signal, error) => {
    closeSync(output);
    writeReceipt('result.json', {
      ...runner, command, source, started, rendererPort, finished: new Date().toISOString(), exitCode, signal, error,
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
    if (commit) {
      writeReceipt('preparing.json', { ...runner, command, source, started });
      const archive = join(directory, 'snapshot.tar');
      mkdirSync(commandCwd);
      await prepare('Exporting committed source', 'git', [...gitArgs, 'archive', '--format=tar',
        `--output=${archive}`, commit], { cwd: process.cwd(), env: gitEnv });
      await prepare('Extracting the snapshot', 'tar', ['-xf', archive]);
      rmSync(archive);
      await prepare('Installing pinned dependencies offline', 'pnpm', ['install', '--offline', '--frozen-lockfile']);
    }
    if (rendererSnapshot) {
      rendererPort = environment.PLAYWRIGHT_PORT ?? await selectRendererPort();
      environment.PLAYWRIGHT_PORT = rendererPort;
      writeFileSync(output, `==> Renderer test server: 127.0.0.1:${rendererPort}\n`);
    }
    const result = await runOwnedCommand(command[0], command.slice(1), {
      ...ownedOptions,
      onSpawn(child) {
        writeReceipt('started.json', { ...runner, childPid: child.pid, command, source, started, rendererPort });
      },
    });
    outcome = [result.code, result.signal, undefined];
  } catch (error) {
    outcome = [interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1,
      interrupted ?? null, String(error)];
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
  // Persist once, outside the command catch: a reporting failure must remain a
  // nonzero worker failure, not trigger another close or masquerade as success.
  finish(...outcome);
}
