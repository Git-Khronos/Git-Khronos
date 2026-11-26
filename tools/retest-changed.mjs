// Local feedback only; this is not a replacement for release checks.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const split = value => value.split('\0').filter(Boolean);
const profiles = [
  [/^worktree-(lock|move|registration)-dialog\.component\./, 'worktrees'],
  [/^gitlab-(projects|fork-create|fork-records)\.component\./, 'gitlab'],
  [/^working-file-editor\.component\.(?:ts|html|scss)$/, 'working-files'],
  [/^stash-(?:options|delete|clear)-dialog\.component\.(?:ts|html|scss)$/, 'stash'],
  [/^history-search\.component\.(?:ts|html|scss)$/, 'history'],
  [/^fetch-options-dialog\.component\.(?:ts|html|scss)$/, 'transport'],
  [/^application-updates-dialog\.component\./, 'updates'],
];
const prefix = 'apps/desktop/src/app/';
const { values } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h' },
  base: { type: 'string', default: 'HEAD' },
  staged: { type: 'boolean' },
  run: { type: 'boolean' },
  'allow-full': { type: 'boolean' },
} });

if (values.help) {
  console.log(`Usage: pnpm test:changed [--base <local Git ref>] [--staged] [--run [--allow-full]]

Preview checks for staged, unstaged and untracked changes against HEAD by default.
Use --base to compare against another local commit, for example origin/dev.
Use --staged to select only changes in the index relative to the base.
Tests still run against your working files, not an isolated staged snapshot.
Use --run for focused checks; add --allow-full to execute a broad fallback.
This command does not fetch or replace the release test suite.`);
  process.exit(0);
}

const revision = spawnSync('git', ['rev-parse', '--verify', '--end-of-options', values.base + '^{commit}'], {
  cwd, encoding: 'utf8',
});
if (revision.error) throw revision.error;
if (revision.status !== 0) {
  console.error('Could not resolve test base ' + JSON.stringify(values.base) + ' as a local Git commit.');
  process.exit(2);
}
const base = revision.stdout.trim();
// --no-renames ensures removal of an old name is visible even after a rename.
const changed = [...new Set([
  ...split(git('diff', '--cached', '--no-ext-diff', '--name-only', '--no-renames', '-z', base, '--')),
  ...(values.staged ? [] : [
    ...split(git('diff', '--no-ext-diff', '--name-only', '--no-renames', '-z', base, '--')),
    ...split(git('ls-files', '--others', '--exclude-standard', '-z')),
  ]),
])].sort();

const selected = new Set();
const specs = [];
let retestTools = false;
let broad = false;
for (const path of changed) {
  let plan;
  if (/^(README\.md|docs\/.*\.md)$/.test(path)) {
    plan = 'documentation only';
  } else if (/^tools\/retest-changed(?:\.test)?\.mjs$/.test(path) && existsSync(join(cwd, path))) {
    retestTools = true;
    plan = 'test selection and local process checks';
  } else if (/^e2e\/renderer\/[a-z0-9-]+\.spec\.ts$/.test(path) && existsSync(join(cwd, path))) {
    specs.push(path);
    plan = 'individual renderer spec';
  } else {
    const profile = path.startsWith(prefix) && profiles.find(([test]) => test.test(path.slice(prefix.length)))?.[1];
    if (profile && existsSync(join(cwd, path))) {
      selected.add(profile);
      plan = profile + ' renderer profile';
    } else {
      broad = true;
      plan = 'broader checks (shared, removed or unmapped file)';
    }
  }
  console.log(JSON.stringify(path) + ': ' + plan);
}

const commands = broad
  ? [['desktop:check'], ['desktop:test'], ['desktop:e2e']]
  : [...(retestTools ? [['desktop:owned-process-test']] : []),
     ...[...selected].sort().map(profile => ['desktop:e2e:' + profile]),
     ...(specs.length ? [['desktop:e2e', '--', ...specs.map(path => path.replaceAll('.', '[.]') + '$')]] : [])];
for (const command of commands) console.log('pnpm nx run ' + command.map(arg => JSON.stringify(arg)).join(' '));
if (!commands.length) console.log('No test-relevant changes selected.');
else if (!values.run) console.log('Plan only. Add --run to execute.');
else if (broad && !values['allow-full']) {
  console.error('Broad validation requires --run --allow-full. Review the plan above first.');
  process.exitCode = 2;
} else {
  // Use the workspace package manager; each target must succeed before the next.
  for (const args of commands) {
    const result = spawnSync('pnpm', ['nx', 'run', ...args], { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
