// Compare complete repeat runs by case identity, without exposing test titles.
import { readFileSync } from 'node:fs';
import { isCliEntry } from './cli-entry.mjs';

function collect(reports) {
  const cases = new Map();
  if (!reports.length) throw new Error('Expected at least one report in each run.');
  return reports.map(report => {
    if (report?.version !== 1 || !Number.isSafeInteger(report.totalCases) || report.totalCases < 1
      || !Array.isArray(report.caseTimings) || report.caseTimings.length !== report.totalCases) {
      throw new Error('Expected a complete per-case timing report.');
    }
    return report.caseTimings.map(({ id, durationMs } = {}) => {
      if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id) || cases.has(id)
        || !Number.isSafeInteger(durationMs) || durationMs < 0) {
        throw new Error('Invalid or duplicate case timing within a run.');
      }
      cases.set(id, durationMs);
      return { id, durationMs };
    });
  });
}

export function compareRendererCaseTimings(baseline, repeat, { sharedOnly = false } = {}) {
  const before = collect(baseline).flat();
  const after = collect(repeat);
  const byId = new Map(before.map(({ id, durationMs }) => [id, durationMs]));
  const repeatCases = after.reduce((total, shard) => total + shard.length, 0);
  const matched = after.map(shard => shard.filter(({ id }) => byId.has(id)));
  const totalCases = matched.reduce((total, shard) => total + shard.length, 0);
  if (!sharedOnly && (totalCases !== before.length || totalCases !== repeatCases)) {
    throw new Error('The timing runs do not cover the same case IDs.');
  }
  if (!totalCases) throw new Error('The timing runs have no cases in common.');
  const quantile = (sorted, q) => sorted.length ? sorted[Math.ceil(sorted.length * q) - 1] : null;
  return {
    totalCases,
    ...(sharedOnly ? { baselineOnlyCases: before.length - totalCases, repeatOnlyCases: repeatCases - totalCases } : {}),
    repeatShards: matched.map((shard, index) => {
      const ratios = shard.filter(({ id }) => byId.get(id) > 0)
        .map(({ id, durationMs }) => durationMs / byId.get(id)).sort((a, b) => a - b);
      return {
        shard: index + 1,
        cases: shard.length,
        comparedRatios: ratios.length,
        baselineDurationMs: shard.reduce((sum, { id }) => sum + byId.get(id), 0),
        repeatDurationMs: shard.reduce((sum, { durationMs }) => sum + durationMs, 0),
        medianRatio: quantile(ratios, 0.5),
        p90Ratio: quantile(ratios, 0.9),
      };
    }),
  };
}

if (isCliEntry(import.meta)) {
  try {
    const args = process.argv.slice(2);
    const sharedOnly = args[0] === '--shared-only';
    if (sharedOnly) args.shift();
    const split = args.indexOf('--');
    if (split < 1 || split === args.length - 1 || args.lastIndexOf('--') !== split) {
      throw new Error('Usage: node tools/compare-renderer-case-timings.mjs [--shared-only] BASELINE-JSON... -- REPEAT-JSON...');
    }
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const result = compareRendererCaseTimings(args.slice(0, split).map(read), args.slice(split + 1).map(read), { sharedOnly });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
