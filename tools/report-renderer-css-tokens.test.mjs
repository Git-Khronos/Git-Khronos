import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unresolvedCssTokens } from './report-renderer-css-tokens.mjs';

test('reports fallback-free references with no source definition or binding', () => {
  const sources = [
    { path: 'base.scss', text: ':root { --defined: red; }\n/* --missing: ignored;\nvar(--commented) */\nh1 { color: var(--missing); }' },
    { path: 'card.html', text: '<p [style.--bound]="color" style="color:var(--bound)"></p>' },
    { path: 'card.ts', text: 'style.setProperty("--assigned", "red");' },
    { path: 'card.scss', text: 'p { color: var(--assigned); border-color: var(--defined); background: var(--optional, var(--nested)); }' },
  ];
  assert.deepEqual(unresolvedCssTokens(sources), [
    { token: '--missing', occurrences: [{ path: 'base.scss', line: 4 }] },
    { token: '--nested', occurrences: [{ path: 'card.scss', line: 1 }] },
  ]);
});

test('the audit only blocks the caller in check mode', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'git-khronos-theme-audit-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const src = join(cwd, 'apps/desktop/src');
  mkdirSync(src, { recursive: true });
  const file = join(src, 'theme.scss');
  writeFileSync(file, 'p { color: var(--typo); }');
  const cli = fileURLToPath(new URL('./report-renderer-css-tokens.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  const advisory = run();
  assert.equal(advisory.status, 0, advisory.stderr);
  assert.match(advisory.stdout, /--typo\s+theme\.scss:1/);
  const strict = run('--check');
  assert.equal(strict.status, 1);
  assert.equal(strict.stdout, advisory.stdout);
  assert.match(strict.stderr, /Unresolved renderer CSS references/);
  writeFileSync(file, ':root { --typo: green; }\np { color: var(--typo); }');
  assert.equal(run('--check').status, 0);
});
