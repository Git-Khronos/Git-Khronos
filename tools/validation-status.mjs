import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';

// This runner owns Linux process groups. Use the process start counter as
// well as the PID so a reused PID cannot make a retired run look active.
const bootIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function currentBootId() {
  if (process.platform !== 'linux') return null;
  try {
    const id = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return bootIdPattern.test(id) ? id : null;
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return null;
    throw error;
  }
}

export function processStart(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== 'linux') return null;
  let stat;
  try { stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); }
  catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
  const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
  return ['X', 'Z'].includes(fields[0]) || !/^[0-9]+$/.test(fields[19] ?? '') ? null : fields[19];
}

function readRunJson(path, maxBytes) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) {
      throw new Error('Expected a bounded regular JSON file');
    }
    const bytes = Buffer.alloc(info.size);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size);
      if (!count) throw new Error('JSON file shortened during read');
      size += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1)) throw new Error('JSON file grew during read');
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

function receipt(directory, name) {
  try {
    const report = readRunJson(join(directory, name), 1024 * 1024);
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      throw new Error('Expected a JSON object');
    }
    return report;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Invalid validation receipt: ${name}`, { cause: error });
  }
}

function rendererProgress(directory) {
  try {
    const record = readRunJson(join(directory, 'renderer-progress.json'), 8192);
    const counts = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    if (record?.version !== 1 || ![record.totalTests, record.testsReported, record.attemptsReported].every(integer)
      || record.testsReported > record.totalTests || record.testsReported > record.attemptsReported
      || !counts.every(key => integer(record.latestOutcomes?.[key]))
      || counts.reduce((sum, key) => sum + record.latestOutcomes[key], 0) !== record.testsReported
      || ![null, 'passed', 'failed', 'timedout', 'interrupted'].includes(record.playwrightStatus)
      || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) return null;
    const validSpec = spec => typeof spec === 'string' && spec.length > 0
      && spec.length <= 255 && !/[\\/\x00-\x1f]/.test(spec);
    const active = record.oldestActiveAttempts;
    const validActive = integer(record.activeAttempts) && record.activeAttempts <= record.totalTests
      && Array.isArray(active) && active.length === Math.min(record.activeAttempts, 5)
      && (record.playwrightStatus === null || record.activeAttempts === 0)
      && active.every(item => validSpec(item?.spec) && typeof item.startedAt === 'string'
        && Number.isFinite(Date.parse(item.startedAt)));
    const timings = record.slowestSpecsByAttemptTime;
    const validTimings = Array.isArray(timings) && timings.length <= 5
      && timings.every(item => validSpec(item?.spec) && integer(item.durationMs));
    const validTimingDetail = ({ timedAttempts, maxAttemptMs, durationMs }) =>
      integer(timedAttempts) && timedAttempts > 0 && timedAttempts <= record.attemptsReported
      && integer(maxAttemptMs) && maxAttemptMs <= durationMs;
    const failures = record.recentFailureLocations;
    const validFailures = Array.isArray(failures) && failures.length <= 8
      && failures.length <= record.latestOutcomes.failed + record.latestOutcomes.timedOut
      && failures.every(item => validSpec(item?.spec) && Buffer.byteLength(item.spec) <= 160
        && Number.isSafeInteger(item.line) && item.line > 0 && ['failed', 'timedOut'].includes(item.outcome));
    return {
      totalTests: record.totalTests, testsReported: record.testsReported, attemptsReported: record.attemptsReported,
      testsRemainingToReport: record.totalTests - record.testsReported,
      // A test can still retry or fail. This measures reported cases, not
      // success, and rounds down so an incomplete run never displays 100%.
      reportedPercent: record.totalTests > 0 ? Math.floor(1000 * (record.testsReported / record.totalTests)) / 10 : null,
      latestOutcomes: Object.fromEntries(counts.map(key => [key, record.latestOutcomes[key]])),
      playwrightStatus: record.playwrightStatus, updatedAt: record.updatedAt,
      ...(integer(record.testPhaseElapsedMs) ? { testPhaseElapsedMs: record.testPhaseElapsedMs } : {}),
      ...(integer(record.totalAttemptDurationMs) ? { totalAttemptDurationMs: record.totalAttemptDurationMs } : {}),
      ...(validActive ? { activeAttempts: record.activeAttempts,
        oldestActiveAttempts: active.map(({ spec, startedAt, line }) => ({
          spec, startedAt, ...(integer(line) && line > 0 ? { line } : {}),
        })) } : {}),
      ...(validFailures ? { recentFailureLocations: failures.map(({ spec, line, outcome }) => ({ spec, line, outcome })) } : {}),
      ...(validTimings ? { slowestSpecsByAttemptTime: timings.map(item => ({
        spec: item.spec, durationMs: item.durationMs,
        ...(validTimingDetail(item) ? { timedAttempts: item.timedAttempts, maxAttemptMs: item.maxAttemptMs,
          ...(integer(item.maxAttemptLine) && item.maxAttemptLine > 0 ? { maxAttemptLine: item.maxAttemptLine } : {}),
        } : {}),
      })) } : {}),
    };
  } catch {
    // A missing or damaged advisory snapshot does not change the run receipt.
    return null;
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
  const boot = pending.runnerBootId === undefined ? null : currentBootId();
  if (pending.runnerBootId !== undefined &&
      (!bootIdPattern.test(pending.runnerBootId ?? '') || !boot)) {
    return result() ?? { ...pending, state: 'unverified', log };
  }
  const previousBoot = boot !== null && boot !== pending.runnerBootId;
  const observedStart = previousBoot ? null : processStart(pending.runnerPid);
  if (!previousBoot && observedStart === pending.runnerStart) {
    return started ? withProgress({ ...pending, state: 'running', log }) : { ...pending, state: 'preparing', log };
  }
  // The runner may have published its result and exited during this read.
  const stopReason = previousBoot ? 'different-boot' : observedStart === null ? 'process-not-live' : 'pid-reused';
  const stopped = { ...pending, state: 'stopped-without-result', stopReason, log };
  // Preserve the last observation for troubleshooting, without making it a
  // verdict or implying that the previously active attempts are still alive.
  return result() ?? (started ? withProgress(stopped) : stopped);
}
