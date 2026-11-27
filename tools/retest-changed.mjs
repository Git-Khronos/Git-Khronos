// Local feedback only; this is not a replacement for release checks.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const split = value => value.split('\0').filter(Boolean);
const profiles = [
  [/^(?:worktree-(?:lock|move|registration)-dialog|checkout-worktree-dialog)\.component\.(?:ts|html|scss)$/, 'worktrees'],
  [/^submodule-state-review\.component\.(?:ts|html|scss)$/, 'submodules'],
  [/^lfs-(?:tracking|prune)-dialog\.component\.(?:ts|html|scss)$/, 'lfs'],
  [/^repository-confirmations\.component\.(?:ts|html|scss)$/, 'repository-confirmations'],
  [/^history-review-dialog\.component\.(?:ts|html|scss)$/, 'history-confirmations'],
  [/^reference-action-dialog\.component\.(?:ts|html|scss)$/, 'reference-actions'],
  [/^branch-workflow-dialog\.component\.(?:ts|html|scss)$/, 'branch-workflows'],
  [/^gitlab-(projects|fork-create|fork-records)\.component\./, 'gitlab'],
  [/^working-file-editor\.component\.(?:ts|html|scss)$/, 'editor'],
  [/^working-tree-summary\.component\.(?:ts|html|scss)$/, 'recaps'],
  [/^graph-viewport\.component\.(?:ts|html|scss)$/, 'graph'],
  [/^(?:discard-recovery-display\.ts|saved-discard-list\.component\.(?:ts|html|scss))$/, 'discard'],
  [/^stash-(?:options|delete|clear)-dialog\.component\.(?:ts|html|scss)$/, 'stash'],
  [/^(?:file-history|history-search)\.component\.(?:ts|html|scss)$/, 'history-search'],
  [/^fetch-options-dialog\.component\.(?:ts|html|scss)$/, 'transport'],
  [/^git-documentation(?:-dialog\.component|\.service)\.(?:ts|html|scss)$/, 'git-documentation'],
  [/^application-updates-dialog\.component\./, 'updates'],
];
const prefix = 'apps/desktop/src/app/';
const rendererSourceChecks = [
  [/^markdown-preview(?:\.component|\.worker)?\.ts$/, 'editor', 'markdown-preview.spec.ts'],
  [/^application-updates\.service\.ts$/, 'updates', 'application-updates.service.spec.ts'],
  [/^submodule-findings\.ts$/, 'submodules', 'submodule-findings.spec.ts'],
  [/^git-documentation-topics\.ts$/, 'git-documentation', 'git-documentation-topics.spec.ts'],
];
const rendererFixtureSpecs = new Map([
  ['e2e/renderer/preview-repository-ready.ts', [
    'branch-rename-scope', 'branch-workflows', 'confirmation-keyboard', 'history-review-loading', 'lfs-tracking', 'mainline-replay', 'operation-recovery',
    'ordered-revert', 'rebase-split', 'repository-confirmation-scope', 'stash-action-lifecycle', 'stash-delete-lifecycle', 'stash-review-scope',
    'deferred-action-scope', 'reference-action-scope', 'reference-actions', 'worktree-registration',
  ]],
  ['e2e/renderer/graph-layout-test-helpers.ts', ['graph-columns', 'graph-layout-readiness']],
  ['e2e/renderer/lazy-chunk-routing.ts', [
    'deferred-compact-toolbar', 'deferred-graph-settings', 'deferred-main-menu',
    'deferred-toolbar-options', 'revision-inspector-loading', 'startup-failures',
  ]],
]);
// Representative focused suites; this is not a transitive Python dependency graph.
const packagedScenarios = new Map([
  ['tools/native_application_updates_scenarios.py', ['native-application-updates', 'native-application-update-release-link']],
  ['tools/native_browser_launcher_fixture.py', ['native-git-documentation', 'native-application-update-release-link']],
  ['tools/native_lfs_lock_ui_scenarios.py', ['native-lfs-lock-actions']],
  ['tools/native_feature_rebase_scenarios.py', ['native-feature-rebase', 'native-merge-rebase-review']],
  ['tools/native_gitlab_fork_scenarios.py', ['native-gitlab-fork-ui']],
  ['tools/native_git_documentation_scenarios.py', ['native-git-documentation']],
  ['tools/native_gitlab_scenarios.py', ['native-gitlab', 'native-gitlab-fork-ui']],
  ['tools/native_gitlab_ssh_fixture.py', ['native-gitlab']],
  ['tools/native_gitlab_ssh_scenarios.py', ['native-gitlab']],
  ['tools/native_unstaged_summary_scenarios.py', ['native-working-tree-recaps']],
  ['tools/native_workspace_batch_scenarios.py', ['native-workspace-batch']],
  ['tools/native_workspace_locate_scenarios.py', ['native-workspace-bulk-locate']],
  ['tools/native_worktree_scenarios.py', ['native-worktrees', 'native-worktree-reservation']],
  ['tools/native_sparse_checkout_scenarios.py', ['native-sparse-checkout']],
  ['tools/native_submodule_initialize_scenarios.py', ['native-submodule-initialize']],
  ['tools/native_submodule_update_scenarios.py', ['native-submodule-update']],
  ['tools/native_discard_subset_scenarios.py', [
    'native-discard-subset', 'native-discard-busy', 'native-discard-deletion',
    'native-discard-stale-review', 'native-discard-large', 'native-discard-limit',
  ]],
]);
const debianWorkflowSources = new Set([
  'tools/build-linux-package.sh', 'tools/manage-linux-package.sh',
  'tools/finish-linux-package-cache.mjs', 'tools/package-build-receipt.mjs',
  'tools/check-linux-package-watcher.mjs',
  '.github/workflows/linux-package-acceptance.yml',
  '.github/workflows/release.yml',
  '.github/workflows/publish-signed-debian.yml',
]);
const packageSourceTests = new Map([
  ['tools/download-qualified-debian.sh', 'tools/check-debian-candidate-run.test.mjs'],
  ['tools/check-debian-candidate-run.mjs', 'tools/check-debian-candidate-run.test.mjs'],
]);
// These are named #[cfg(test)] modules, not shared helpers or production code.
const gitCoreTestModules = new Set([
  'branch_comparison_tests', 'no_commit_replay_tests', 'ordered_revert_tests',
  'rebase_split_tests', 'reference_actions_tests', 'reference_rename_tests',
  'selected_rebase_tests', 'stash_file_restore_tests',
  ...(process.platform === 'win32' ? [] : ['literal_file_tests', 'transport_stderr_tests']),
]);
const { values } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h' },
  base: { type: 'string', default: 'HEAD' },
  staged: { type: 'boolean' },
  workers: { type: 'string' },
  webkit: { type: 'boolean' },
  run: { type: 'boolean' },
  'native-package': { type: 'string' },
  'allow-full': { type: 'boolean' },
} });

if (values.help) {
  console.log(`Usage: pnpm test:changed [--base <local Git ref>] [--staged] [--workers <count>] [--webkit] [--native-package <archive.deb>] [--run [--allow-full]]

Preview checks for staged, unstaged and untracked changes against HEAD by default.
Use --base to compare against another local commit, for example origin/dev.
Use --staged to select only changes in the index relative to the base.
Tests still run against your working files, not an isolated staged snapshot.
Use --workers to override the browser worker count and --webkit to select WebKit.
Use --native-package to include mapped native scenario suites with an explicit Debian archive.
Use --run for focused checks; add --allow-full to execute a broad fallback.
This command does not fetch or replace the release test suite.`);
  process.exit(0);
}

if (values.workers !== undefined && !/^[1-9][0-9]{0,2}$/.test(values.workers)) {
  console.error('--workers must be a positive integer from 1 to 999.');
  process.exit(2);
}

let nativePackage;
if (values['native-package'] !== undefined) {
  nativePackage = resolve(values['native-package']);
  if (!nativePackage.endsWith('.deb') || !statSync(nativePackage, { throwIfNoEntry: false })?.isFile()) {
    console.error('--native-package requires the path to an existing .deb file.');
    process.exit(2);
  }
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
const gitCoreModules = new Set();
const nativeSuites = new Set();
let retestTools = false;
const packageSpecs = new Set();
let authenticationTests = false;
let nativeHarnessTests = false;
let archiveCacheTests = false;
let unmappedNativeSource = false;
let graphTypecheck = false;
let broad = false;
for (const path of changed) {
  let plan;
  const gitCoreModule = /^crates\/git-core\/src\/([a-z_]+)\.rs$/.exec(path)?.[1];
  const sourceCheck = path.startsWith(prefix)
    ? rendererSourceChecks.find(([test]) => test.test(path.slice(prefix.length))) : undefined;
  if (/^(README\.md|docs\/.*\.md)$/.test(path)) {
    plan = 'documentation only';
  } else if (/^apps\/desktop\/src-tauri\/tests\/(?:authentication_transport\.rs|fixtures\/https_git_server\.py)$/.test(path)
    && existsSync(join(cwd, path))) {
    authenticationTests = true;
    plan = 'focused native authentication transport tests';
  } else if (gitCoreTestModules.has(gitCoreModule) && existsSync(join(cwd, path))) {
    gitCoreModules.add(gitCoreModule + '::');
    plan = 'focused Git core Rust test module';
  } else if (/^tools\/(?:(?:retest-changed(?:\.test)?|renderer-artifacts\.test|run-validation(?:\.test)?|validation-(?:source|space|status)|plan-renderer-shard|compare-renderer-shard-load)\.mjs|renderer-progress-reporter\.cjs)$/.test(path)
    && existsSync(join(cwd, path))) {
    retestTools = true;
    plan = 'test selection and local process checks';
  } else if (/^tools\/prune_local_build_caches(?:_test)?\.py$/.test(path) && existsSync(join(cwd, path))) {
    archiveCacheTests = true;
    plan = 'archive cache cleanup safety tests';
  } else if ((/^tools\/native_[a-z0-9_]+_test\.py$/.test(path) || path === 'tools/check-wslg-transport.py')
    && existsSync(join(cwd, path))) {
    nativeHarnessTests = true;
    plan = 'native harness unit tests';
  } else if (/^tools\/native_[a-z0-9_]+\.py$/.test(path) && existsSync(join(cwd, path))) {
    nativeHarnessTests = true;
    const suites = packagedScenarios.get(path);
    const registered = suites?.every(suite => targets()[suite]?.options?.command
      === 'python3 tools/native_acceptance.py --suite ' + suite.slice('native-'.length) + ' --headless');
    if (registered) {
      for (const suite of suites) nativeSuites.add(suite);
      plan = 'native harness unit tests and packaged suites: ' + suites.join(', ');
    } else {
      unmappedNativeSource = true;
      plan = 'native harness unit tests; packaged scenario validation is separate';
    }
  } else if (/^apps\/desktop\/src\/app\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.spec\.ts$/.test(path) && existsSync(join(cwd, path))) {
    unitSpecs.add(path);
    plan = 'individual renderer unit spec';
  } else if (sourceCheck && existsSync(join(cwd, path))) {
    const [, profile, unitSpec] = sourceCheck;
    selected.add(profile);
    unitSpecs.add(prefix + unitSpec);
    plan = profile + ' renderer profile and ' + unitSpec;
  } else if (path === 'e2e/renderer/editor-protocol-fixture.ts' && existsSync(join(cwd, path))) {
    selected.add('editor');
    plan = 'editor renderer profile (shared editor fixture)';
  } else if (rendererFixtureSpecs.has(path) && existsSync(join(cwd, path))) {
    for (const spec of rendererFixtureSpecs.get(path)) specs.add(`e2e/renderer/${spec}.spec.ts`);
    if (path === 'e2e/renderer/graph-layout-test-helpers.ts') graphTypecheck = true;
    plan = 'all direct renderer fixture consumers';
  } else if ((path === 'Taskfile.yml' || debianWorkflowSources.has(path))
    && isPackageTest('tools/package-deb.test.mjs')) {
    packageSpecs.add('tools/package-deb.test.mjs');
    if (path === 'Taskfile.yml' || !existsSync(join(cwd, path))) {
      broad = true;
      plan = 'package tooling and broader checks (shared or removed file)';
    } else {
      plan = 'Debian package workflow tests (local only; hosted qualification is separate)';
    }
  } else if (packageSourceTests.has(path) && existsSync(join(cwd, path))
    && isPackageTest(packageSourceTests.get(path))) {
    packageSpecs.add(packageSourceTests.get(path));
    plan = 'focused Debian qualification handoff tests';
  } else if (isPackageTest(path)) {
    packageSpecs.add(path);
    plan = 'individual package tooling spec';
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

// The worktree profile already covers the standalone submodule spec. Verify
// the actual profile regex before dropping the narrower invocation.
if (!broad && selected.has('worktrees') && selected.has('submodules')) {
  const onlySubmoduleSpec = "playwright test 'e2e/renderer/submodule-review[.]spec[.]ts$'";
  if (targets().e2e.configurations.submodules?.command === onlySubmoduleSpec
    && filtersFor(new Set(['worktrees'])).some(filter => filter.test('e2e/renderer/submodule-review.spec.ts'))) {
    selected.delete('submodules');
  }
}
const filters = broad ? [] : filtersFor(selected);
const directSpecs = [...specs].filter(path => !filters.some(filter => filter.test(path)));
const extraChecks = [
  ...(packageSpecs.size ? [broad ? ['desktop:package-test'] : ['desktop:package-test:focused', '--', ...packageSpecs]] : []),
  ...(nativeHarnessTests ? [['desktop:native-harness-test']] : []),
  ...(archiveCacheTests ? [['desktop:archive-cache-test']] : []),
  ...(nativePackage ? [...nativeSuites].map(suite => ['desktop:' + suite, '--', '--package', nativePackage]) : []),
];
const commands = broad
  ? [['desktop:check'], ['desktop:test'], ...extraChecks, ['desktop:e2e']]
  : [...(retestTools ? [['desktop:owned-process-test']] : []),
     ...(graphTypecheck ? [['desktop:graph-test-typecheck']] : []),
     ...extraChecks,
     ...(authenticationTests ? [['desktop:test-authentication']] : []),
     ...(gitCoreModules.size ? [['desktop:git-core-unit-test', '--', ...gitCoreModules]] : []),
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
if (nativeSuites.size && !nativePackage) {
  console.log('Add --native-package <archive.deb> to include the mapped packaged suites.');
}
if (unmappedNativeSource) {
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
  // The selection above may legitimately use an alternate index. Tests use
  // their own repositories and must not inherit the caller's Git-local paths.
  const testEnv = { ...process.env };
  for (const key of git('rev-parse', '--local-env-vars').trim().split(/\r?\n/)) delete testEnv[key];
  for (const args of commands) {
    const env = values.webkit && isBrowser(args)
      ? { ...testEnv, GIT_KHRONOS_RENDERER_WEBKIT: '1' }
      : testEnv;
    const result = spawnSync('pnpm', ['nx', 'run', ...args], { cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
