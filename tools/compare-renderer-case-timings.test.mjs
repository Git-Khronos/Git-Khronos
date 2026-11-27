import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRendererCaseTimings } from './compare-renderer-case-timings.mjs';

const report = (...pairs) => ({
  version: 1,
  totalCases: pairs.length,
  caseTimings: pairs.map(([key, durationMs]) => ({ id: key.repeat(64), durationMs })),
});

test('matches cases after reassignment and ignores zero baselines when dividing', () => {
  const result = compareRendererCaseTimings(
    [report(['a', 10], ['b', 0]), report(['c', 5])],
    [report(['b', 20], ['c', 10]), report(['a', 5])],
  );
  assert.deepEqual(result, { totalCases: 3, repeatShards: [
    { shard: 1, cases: 2, comparedRatios: 1, baselineDurationMs: 5, repeatDurationMs: 30, medianRatio: 2, p90Ratio: 2 },
    { shard: 2, cases: 1, comparedRatios: 1, baselineDurationMs: 10, repeatDurationMs: 5, medianRatio: 0.5, p90Ratio: 0.5 },
  ] });
});

test('rejects missing, duplicate and replaced case IDs rather than comparing partial runs', () => {
  assert.throws(() => compareRendererCaseTimings([report(['a', 1])], [report(['b', 1])]), /same case IDs/);
  assert.throws(() => compareRendererCaseTimings([report(['a', 1])], [report(['a', 1]), report(['a', 1])]), /duplicate/);
  assert.throws(() => compareRendererCaseTimings([report(['a', 1])], [{ version: 1, totalCases: 1 }]), /complete/);
});

test('shared-only mode counts coverage differences and excludes them from timing totals', () => {
  const baseline = [report(['a', 10], ['b', 900])];
  const repeat = [report(['a', 20]), report(['c', 800])];
  const result = compareRendererCaseTimings(baseline, repeat, { sharedOnly: true });
  assert.deepEqual(result, {
    totalCases: 1, baselineOnlyCases: 1, repeatOnlyCases: 1, repeatShards: [
      { shard: 1, cases: 1, comparedRatios: 1, baselineDurationMs: 10, repeatDurationMs: 20, medianRatio: 2, p90Ratio: 2 },
      { shard: 2, cases: 0, comparedRatios: 0, baselineDurationMs: 0, repeatDurationMs: 0, medianRatio: null, p90Ratio: null },
    ],
  });
  assert.throws(() => compareRendererCaseTimings(baseline, [repeat[1]], { sharedOnly: true }), /no cases in common/);
});
