import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// This runner owns Linux process groups. Use the process start counter as
// well as the PID so a reused PID cannot make a retired run look active.
export function processStart(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== 'linux') return null;
  let stat;
  try { stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); }
  catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
  const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
  return ['X', 'Z'].includes(fields[0]) || !/^[0-9]+$/.test(fields[19] ?? '') ? null : fields[19];
}

function receipt(directory, name) {
  try {
    const report = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      throw new Error(`Invalid validation receipt: ${name}`);
    }
    return report;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function validationStatus(directory) {
  const log = join(directory, 'output.log');
  const result = () => {
    const record = receipt(directory, 'result.json');
    if (!record) return null;
    if (record.exitCode !== null && !Number.isSafeInteger(record.exitCode)) {
      throw new Error('Invalid validation result exit code');
    }
    return { ...record, state: record.exitCode === 0 ? 'passed' : record.signal ? 'interrupted' : 'failed', log };
  };
  const complete = result();
  if (complete) return complete;
  const started = receipt(directory, 'started.json');
  const pending = started ?? receipt(directory, 'preparing.json');
  if (!pending) return result() ?? { state: 'not-started', log };
  if (typeof pending.runnerStart !== 'string' || !/^[0-9]+$/.test(pending.runnerStart)) {
    return result() ?? { ...pending, state: 'unverified', log };
  }
  if (processStart(pending.runnerPid) === pending.runnerStart) {
    return { ...pending, state: started ? 'running' : 'preparing', log };
  }
  // The runner may have published its result and exited during this read.
  return result() ?? { ...pending, state: 'stopped-without-result', log };
}
