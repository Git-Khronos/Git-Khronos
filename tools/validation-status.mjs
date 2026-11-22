import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
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

function rendererProgress(directory) {
  let fd;
  try {
    fd = openSync(join(directory, 'renderer-progress.json'),
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) return null;
    const bytes = Buffer.alloc(8193);
    const size = readSync(fd, bytes);
    if (!size || size === bytes.length) return null;
    const record = JSON.parse(bytes.toString('utf8', 0, size));
    const counts = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    if (record?.version !== 1 || ![record.totalTests, record.testsReported, record.attemptsReported].every(integer)
      || record.testsReported > record.totalTests || record.testsReported > record.attemptsReported
      || !counts.every(key => integer(record.latestOutcomes?.[key]))
      || counts.reduce((sum, key) => sum + record.latestOutcomes[key], 0) !== record.testsReported
      || ![null, 'passed', 'failed', 'timedout', 'interrupted'].includes(record.playwrightStatus)
      || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) return null;
    return {
      totalTests: record.totalTests, testsReported: record.testsReported, attemptsReported: record.attemptsReported,
      latestOutcomes: Object.fromEntries(counts.map(key => [key, record.latestOutcomes[key]])),
      playwrightStatus: record.playwrightStatus, updatedAt: record.updatedAt,
    };
  } catch {
    // A missing or damaged advisory snapshot does not change the run receipt.
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function validationStatus(directory) {
  const log = join(directory, 'output.log');
  const withProgress = value => {
    const progress = rendererProgress(directory);
    return progress ? { ...value, rendererProgress: progress } : value;
  };
  const result = () => {
    const record = receipt(directory, 'result.json');
    if (!record) return null;
    if (record.exitCode !== null && !Number.isSafeInteger(record.exitCode)) {
      throw new Error('Invalid validation result exit code');
    }
    return withProgress({ ...record, state: record.exitCode === 0 ? 'passed' : record.signal ? 'interrupted' : 'failed', log });
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
    return started ? withProgress({ ...pending, state: 'running', log }) : { ...pending, state: 'preparing', log };
  }
  // The runner may have published its result and exited during this read.
  return result() ?? { ...pending, state: 'stopped-without-result', log };
}
