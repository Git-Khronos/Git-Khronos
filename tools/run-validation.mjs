import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedCommand } from './owned-command.mjs';

const [mode, runDirectory, ...args] = process.argv.slice(2);
if (!runDirectory || !['start', 'run'].includes(mode)) {
  throw new Error('Expected start|run DIRECTORY [Nx arguments]');
}
const directory = resolve(runDirectory);
if (mode === 'start') {
  const runner = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', directory, ...args], {
    cwd: process.cwd(), detached: true, stdio: 'ignore',
    env: { ...process.env, NX_DAEMON: 'false', NX_ISOLATE_PLUGINS: 'false' },
  });
  runner.unref();
  console.log(JSON.stringify({ runnerPid: runner.pid, directory }));
} else {
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const command = ['pnpm', 'nx', ...args];
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
      command, started, finished: new Date().toISOString(), exitCode, signal, error,
    }, null, 2), { mode: 0o600 });
    process.exitCode = exitCode ?? 1;
  };
  let outcome;
  try {
    const result = await runOwnedCommand(command[0], command.slice(1), {
      cwd: process.cwd(), stdio: ['ignore', output, output], signal: controller.signal,
      gracefulSignal: 'SIGINT', graceMs: 10_000,
      onSpawn(child) {
        writeFileSync(join(directory, 'started.json'), JSON.stringify({
          runnerPid: process.pid, childPid: child.pid, command, started,
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
