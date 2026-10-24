// Linux validation commands own a new process group. Never use this helper for
// a PID supplied by a caller or for interactive, user-owned applications.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

function groupIsRunning(group) {
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === group && !['Z', 'X'].includes(fields[0])) return true;
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
    }
  }
  return false;
}

async function stopGroup(group, graceMs, gracefulSignal) {
  if (!Number.isSafeInteger(group) || group <= 1 || group === process.pid) {
    throw new Error('Refusing to signal an invalid owned process group.');
  }
  for (const signal of [gracefulSignal, 'SIGKILL']) {
    try { process.kill(-group, signal); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    const deadline = Date.now() + graceMs;
    while (groupIsRunning(group)) {
      if (Date.now() >= deadline) break;
      await delay(25);
    }
    if (!groupIsRunning(group)) return;
  }
  throw new Error('Owned validation descendants did not stop; retain their artifacts.');
}

/** Run one Linux validation command, reclaiming its group even if the leader exits first. */
export async function runOwnedCommand(command, args, {
  signal, onSpawn, graceMs = 1000, gracefulSignal = 'SIGTERM', ...options
} = {}) {
  if (process.platform !== 'linux') throw new Error('Owned validation command cleanup currently requires Linux.');
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('Invalid cleanup grace period.');
  if (!['SIGTERM', 'SIGINT'].includes(gracefulSignal)) throw new Error('Invalid graceful cleanup signal.');
  signal?.throwIfAborted();
  // detached is deliberately applied last: the caller cannot put an existing
  // process group (including this controller's group) in cleanup scope.
  const child = spawn(command, args, { ...options, detached: true });
  const closed = new Promise(resolve => child.once('close', resolve));
  const exited = new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal }));
  });
  const ready = new Promise(resolve => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });
  let stop;
  const cleanup = () => stop ??= ready.then(spawned => spawned ? stopGroup(child.pid, graceMs, gracefulSignal) : undefined);
  const abort = () => { void cleanup().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    onSpawn?.(child);
    const result = await exited;
    await cleanup();
    // An escaped descendant must not keep a controller waiting on inherited
    // pipes forever. Closing our handles is safe; never chase unrelated PIDs.
    let closeTimer;
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          closeTimer = setTimeout(() => {
            child.stdin?.destroy();
            child.stdout?.destroy();
            child.stderr?.destroy();
            reject(new Error('Owned command pipes did not close after group cleanup.'));
          }, Math.max(1000, graceMs));
        }),
      ]);
    } finally { clearTimeout(closeTimer); }
    signal?.throwIfAborted();
    if (result.error) throw result.error;
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    await cleanup();
    await exited;
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
}
