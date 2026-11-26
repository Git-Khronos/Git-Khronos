// Distribute each consecutive group of Playwright cases across the CI shards.
import { readFileSync } from 'node:fs';

try {
  const [listing, part, count] = process.argv.slice(2);
  if (process.argv.length !== 5 || !listing || !/^[1-9]\d*$/.test(part) || !/^[1-9]\d*$/.test(count)) {
    throw new Error('Usage: node tools/plan-renderer-shard.mjs PLAYWRIGHT-LIST SHARD SHARD-COUNT');
  }
  const position = Number(part);
  const total = Number(count);
  const lines = readFileSync(listing, 'utf8').split(/\r?\n/);
  const tests = lines.filter(line => /^  \[chromium\] › /.test(line));
  const totals = lines.flatMap(line => /^Total: (\d+) tests? in \d+ files?$/.exec(line)?.slice(1) ?? []);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(position) || position > total || tests.length < total ||
      totals.length !== 1 || Number(totals[0]) !== tests.length || new Set(tests).size !== tests.length) {
    throw new Error('The Playwright listing does not uniquely cover a complete Chromium test suite or the shard is invalid.');
  }
  process.stdout.write(tests.filter((_test, index) => index % total === position - 1).join('\n') + '\n');
} catch (error) {
  console.error(`Git Khronos: ${error.message}`);
  process.exitCode = 1;
}
