import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedCommand } from './owned-command.mjs';

const [mode, runDirectory, ...args] = process.argv.slice(2);
const useSnapshot = args[0] === '--snapshot';
const snapshot = useSnapshot ? args.splice(0, 2)[1] : undefined;
if (!runDirectory || !['start', 'run'].includes(mode)) {
  throw new Error('Expected start|run DIRECTORY [--snapshot REF] [Nx arguments]');
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
  const output = openSync(join(directory, 'output.log'), 'wx', 0o600);
  const controller = new AbortController();
  let interrupted;
  const interrupt = signal => { interrupted ??= signal; controller.abort(); };
  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const finish = (exitCode, signal, error) => {
    closeSync(output);
    writeFileSync(join(directory, 'result.json'), JSON.stringify({
      command, source, started, finished: new Date().toISOString(), exitCode, signal, error,
    }, null, 2), { mode: 0o600 });
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
      writeFileSync(join(directory, 'preparing.json'), JSON.stringify({
        runnerPid: process.pid, command, source, started,
      }, null, 2), { mode: 0o600 });
      const archive = join(directory, 'snapshot.tar');
      mkdirSync(commandCwd);
      await prepare('Exporting committed source', 'git', [...gitArgs, 'archive', '--format=tar',
        `--output=${archive}`, commit], { cwd: process.cwd(), env: gitEnv });
      await prepare('Extracting the snapshot', 'tar', ['-xf', archive]);
      rmSync(archive);
      await prepare('Installing pinned dependencies offline', 'pnpm', ['install', '--offline', '--frozen-lockfile']);
    }
    const result = await runOwnedCommand(command[0], command.slice(1), {
      ...ownedOptions,
      onSpawn(child) {
        writeFileSync(join(directory, 'started.json'), JSON.stringify({
          runnerPid: process.pid, childPid: child.pid, command, source, started,
        }, null, 2), { mode: 0o600 });
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
