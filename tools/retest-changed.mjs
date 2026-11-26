// Local feedback only; this is not a replacement for release checks.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const split = value => value.split('\0').filter(Boolean);
const profiles = [
  [/^(?:worktree-(?:lock|move|registration)-dialog|checkout-worktree-dialog|submodule-state-review)\.component\.(?:ts|html|scss)$/, 'worktrees'],
  [/^gitlab-(projects|fork-create|fork-records)\.component\./, 'gitlab'],
  [/^working-file-editor\.component\.(?:ts|html|scss)$/, 'editor'],
  [/^working-tree-summary\.component\.(?:ts|html|scss)$/, 'recaps'],
  [/^(?:discard-recovery-display\.ts|saved-discard-list\.component\.(?:ts|html|scss))$/, 'discard'],
  [/^stash-(?:options|delete|clear)-dialog\.component\.(?:ts|html|scss)$/, 'stash'],
  [/^history-search\.component\.(?:ts|html|scss)$/, 'history'],
  [/^fetch-options-dialog\.component\.(?:ts|html|scss)$/, 'transport'],
  [/^application-updates-dialog\.component\./, 'updates'],
];
const prefix = 'apps/desktop/src/app/';
const rendererFixtureSpecs = new Map([
  ['e2e/renderer/graph-layout-test-helpers.ts', ['graph-columns', 'graph-layout-readiness']],
  ['e2e/renderer/lazy-chunk-routing.ts', [
    'deferred-compact-toolbar', 'deferred-graph-settings', 'deferred-main-menu',
    'deferred-toolbar-options', 'revision-inspector-loading', 'startup-failures',
  ]],
]);
const { values } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h' },
  base: { type: 'string', default: 'HEAD' },
  staged: { type: 'boolean' },
  workers: { type: 'string' },
  webkit: { type: 'boolean' },
  run: { type: 'boolean' },
  'allow-full': { type: 'boolean' },
} });

if (values.help) {
  console.log(`Usage: pnpm test:changed [--base <local Git ref>] [--staged] [--workers <count>] [--webkit] [--run [--allow-full]]

Preview checks for staged, unstaged and untracked changes against HEAD by default.
Use --base to compare against another local commit, for example origin/dev.
Use --staged to select only changes in the index relative to the base.
Tests still run against your working files, not an isolated staged snapshot.
Use --workers to override the browser worker count and --webkit to select WebKit.
Use --run for focused checks; add --allow-full to execute a broad fallback.
This command does not fetch or replace the release test suite.`);
  process.exit(0);
}

if (values.workers !== undefined && !/^[1-9][0-9]{0,2}$/.test(values.workers)) {
  console.error('--workers must be a positive integer from 1 to 999.');
  process.exit(2);
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

let desktopTargets;
function targets() {
  return desktopTargets ??= JSON.parse(readFileSync(join(cwd, 'apps/desktop/project.json'), 'utf8')).targets;
}

function isPackageTest(path) {
  if (!/^tools\/[a-z0-9-]+\.test\.mjs$/.test(path) || !existsSync(join(cwd, path))) return false;
  const command = targets()['package-test']?.options?.command ?? '';
  return /^node --test(?: tools\/[a-z0-9-]+\.test\.mjs)+$/.test(command)
    && command.split(' ').includes(path);
}

const selected = new Set();
const specs = new Set();
const unitSpecs = new Set();
let retestTools = false;
let packageTests = false;
let nativeHarnessTests = false;
let nativeHarnessSource = false;
let graphTypecheck = false;
let broad = false;
for (const path of changed) {
  let plan;
  if (/^(README\.md|docs\/.*\.md)$/.test(path)) {
    plan = 'documentation only';
  } else if (/^tools\/retest-changed(?:\.test)?\.mjs$/.test(path) && existsSync(join(cwd, path))) {
    retestTools = true;
    plan = 'test selection and local process checks';
  } else if (/^tools\/native_[a-z0-9_]+_test\.py$/.test(path) && existsSync(join(cwd, path))) {
    nativeHarnessTests = true;
    plan = 'native harness unit tests';
  } else if (/^tools\/native_[a-z0-9_]+\.py$/.test(path) && existsSync(join(cwd, path))) {
    nativeHarnessTests = true;
    nativeHarnessSource = true;
    plan = 'native harness unit tests; packaged scenario validation is separate';
  } else if (/^apps\/desktop\/src\/app\/[a-z0-9-]+\.spec\.ts$/.test(path) && existsSync(join(cwd, path))) {
    unitSpecs.add(path);
    plan = 'individual renderer unit spec';
  } else if (/^apps\/desktop\/src\/app\/markdown-preview(?:\.component|\.worker)?\.ts$/.test(path) && existsSync(join(cwd, path))) {
    selected.add('editor');
    unitSpecs.add(prefix + 'markdown-preview.spec.ts');
    plan = 'editor renderer profile and Markdown unit spec';
  } else if (path === 'e2e/renderer/editor-protocol-fixture.ts' && existsSync(join(cwd, path))) {
    selected.add('editor');
    plan = 'editor renderer profile (shared editor fixture)';
  } else if (rendererFixtureSpecs.has(path) && existsSync(join(cwd, path))) {
    for (const spec of rendererFixtureSpecs.get(path)) specs.add(`e2e/renderer/${spec}.spec.ts`);
    if (path === 'e2e/renderer/graph-layout-test-helpers.ts') graphTypecheck = true;
    plan = 'all direct renderer fixture consumers';
  } else if (isPackageTest(path)) {
    packageTests = true;
    plan = 'package tooling tests';
  } else if (/^e2e\/renderer\/[a-z0-9-]+\.spec\.ts$/.test(path) && existsSync(join(cwd, path))) {
    specs.add(path);
    plan = 'individual renderer spec';
  } else {
    const profile = path.startsWith(prefix) && profiles.find(([test]) => test.test(path.slice(prefix.length)))?.[1];
    if (profile && existsSync(join(cwd, path))) {
      selected.add(profile);
      plan = profile + ' renderer profile';
    } else {
      broad = true;
      if (/^tools\/native_[^/]+\.py$/.test(path)) nativeHarnessTests = true;
      plan = 'broader checks (shared, removed or unmapped file)';
    }
  }
  console.log(JSON.stringify(path) + ': ' + plan);
}

function filtersFor(selectedProfiles) {
  if (!selectedProfiles.size) return [];
  const configurations = targets().e2e.configurations;
  // Only infer coverage for a plain Playwright file regex. If a profile gains
  // flags or a wrapper, keep the direct spec rather than risking a missed test.
  return [...selectedProfiles].flatMap(profile => {
    const command = configurations[profile]?.command ?? '';
    const match = /^playwright test '(e2e\/renderer\/[^']+)'$/.exec(command);
    return match ? [new RegExp(match[1])] : [];
  });
}

const filters = broad ? [] : filtersFor(selected);
const directSpecs = [...specs].filter(path => !filters.some(filter => filter.test(path)));
const extraChecks = [
  ...(packageTests ? [['desktop:package-test']] : []),
  ...(nativeHarnessTests ? [['desktop:native-harness-test']] : []),
];
const commands = broad
  ? [['desktop:check'], ['desktop:test'], ...extraChecks, ['desktop:e2e']]
  : [...(retestTools ? [['desktop:owned-process-test']] : []),
     ...(graphTypecheck ? [['desktop:graph-test-typecheck']] : []),
     ...extraChecks,
     ...(unitSpecs.size ? [['desktop:renderer-unit-test:focused', '--', ...unitSpecs]] : []),
     ...[...selected].sort().map(profile => ['desktop:e2e:' + profile]),
     ...(directSpecs.length ? [['desktop:e2e', '--', ...directSpecs.map(path => path.replaceAll('.', '[.]') + '$')]] : [])];
const isBrowser = command => command[0] === 'desktop:e2e' || command[0].startsWith('desktop:e2e:');
for (const command of commands.filter(isBrowser)) {
  if ((values.workers || values.webkit) && !command.includes('--')) command.push('--');
  if (values.workers) command.push('--workers=' + values.workers);
  if (values.webkit) command.push('--project=webkit');
}
// Nx 24's compact default omits child output even when redirected to a log.
// Keep compiler diagnostics and per-suite results visible in local retests.
for (const command of commands) command.splice(1, 0, '--output-style=static');
for (const command of commands) {
  const envPrefix = values.webkit && isBrowser(command) ? 'GIT_KHRONOS_RENDERER_WEBKIT=1 ' : '';
  console.log(envPrefix + 'pnpm nx run ' + command.map(arg => JSON.stringify(arg)).join(' '));
}
if (nativeHarnessSource) {
  console.log('For packaged acceptance, run the affected native suite against an explicit Debian archive.');
}
if (!commands.length) console.log('No test-relevant changes selected.');
else if (!values.run) console.log('Plan only. Add --run to execute.');
else if (broad && !values['allow-full']) {
  console.error('Broad validation requires --run --allow-full. Review the plan above first.');
  process.exitCode = 2;
} else {
  // Use the workspace package manager; each target must succeed before the next.
  if (values.webkit && commands.some(isBrowser)) {
    const check = spawnSync(process.execPath, ['tools/check-renderer-browser.mjs', 'webkit'], { cwd, stdio: 'inherit' });
    if (check.error) throw check.error;
    if (check.status !== 0) process.exit(check.status ?? 1);
  }
  for (const args of commands) {
    const env = values.webkit && isBrowser(args)
      ? { ...process.env, GIT_KHRONOS_RENDERER_WEBKIT: '1' }
      : process.env;
    const result = spawnSync('pnpm', ['nx', 'run', ...args], { cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
