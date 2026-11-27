// Compare scheduling models without changing the hosted shard plan.
import { readFileSync } from 'node:fs';
import { isCliEntry } from './cli-entry.mjs';
import { readRendererListing } from './plan-renderer-shard.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;

export function compareRendererShardLoad(listing, shardCount, reports) {
  const cases = readRendererListing(listing);
  if (!positive(shardCount) || shardCount > cases.length || !Array.isArray(reports) || !reports.length) {
    throw new Error('Expected a valid shard count and at least one clean timing report.');
  }
  const bySpec = new Map();
  for (const report of reports) {
    if (report?.version !== 1 || !positive(report.totalCases) || !Array.isArray(report.specs)) {
      throw new Error('Invalid clean timing report.');
    }
    const observed = new Set();
    let reportCases = 0;
    for (const entry of report.specs) {
      const { spec, cases, durationMs } = entry ?? {};
      if (typeof spec !== 'string' || !/^[\w.-]+\.spec\.[cm]?[jt]s$/.test(spec)
        || observed.has(spec) || !positive(cases) || !nonnegative(durationMs)) {
        throw new Error('Invalid or duplicate spec in timing report.');
      }
      observed.add(spec);
      reportCases += cases;
      const previous = bySpec.get(spec) ?? { cases: 0, durationMs: 0 };
      const combined = { cases: previous.cases + cases, durationMs: previous.durationMs + durationMs };
      if (!positive(combined.cases) || !nonnegative(combined.durationMs)) throw new Error('Timing total overflow.');
      bySpec.set(spec, combined);
    }
    if (reportCases !== report.totalCases) throw new Error('Timing report totals do not match its spec entries.');
  }

  const perSpec = new Map();
  const weights = cases.map((line, index) => {
    const spec = /^  \[chromium\] › (?:[^:]*\/)?([^/:]+):\d+:\d+ › /.exec(line)?.[1];
    const evidence = bySpec.get(spec);
    if (!evidence) throw new Error('The timing reports do not match the Chromium listing by spec and case count.');
    perSpec.set(spec, (perSpec.get(spec) ?? 0) + 1);
    return { index, weight: Math.max(1, Math.round(evidence.durationMs / evidence.cases)) };
  });
  if (perSpec.size !== bySpec.size || [...perSpec].some(([spec, count]) => bySpec.get(spec).cases !== count)) {
    throw new Error('The timing reports do not match the Chromium listing by spec and case count.');
  }
  const shards = () => Array.from({ length: shardCount }, (_unused, index) => ({
    shard: index + 1, cases: 0, estimatedMs: 0,
  }));
  function add(shard, weight) {
    shard.cases++;
    shard.estimatedMs += weight;
    if (!nonnegative(shard.estimatedMs)) throw new Error('Shard workload overflow.');
  }
  const roundRobin = shards();
  const greedy = shards();
  for (const { index, weight } of weights) add(roundRobin[index % shardCount], weight);
  for (const { weight } of [...weights].sort((a, b) => b.weight - a.weight || a.index - b.index)) {
    const leastLoaded = greedy.reduce((a, b) => b.estimatedMs < a.estimatedMs ? b : a);
    add(leastLoaded, weight);
  }
  return { totalCases: cases.length, roundRobin, greedy,
    estimatedLongestRoundRobinMs: Math.max(...roundRobin.map(shard => shard.estimatedMs)),
    estimatedLongestGreedyMs: Math.max(...greedy.map(shard => shard.estimatedMs)) };
}

if (isCliEntry(import.meta)) {
  try {
    const [listing, count, ...paths] = process.argv.slice(2);
    if (!listing || !/^[1-9]\d*$/.test(count ?? '') || !paths.length) {
      throw new Error('Usage: node tools/compare-renderer-shard-load.mjs PLAYWRIGHT-LIST SHARD-COUNT TIMING-JSON...');
    }
    const compare = compareRendererShardLoad(readFileSync(listing, 'utf8'), Number(count),
      paths.map(path => JSON.parse(readFileSync(path, 'utf8'))));
    process.stdout.write(JSON.stringify(compare, null, 2) + '\n');
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
