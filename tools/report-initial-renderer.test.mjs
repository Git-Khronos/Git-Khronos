import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { budgetBytes, initialRendererReport } from './report-initial-renderer.mjs';

const budget = { maximumWarning: '100B', maximumError: '155B' };
const index = `<link rel="stylesheet" href="styles.css" media="print">
<link rel='stylesheet' href='styles.css'>
<link rel="modulepreload" href="./shared.js">
<link rel="preload" as="image" href="logo.svg">
<script type="module" src="main.js"></script>
<script>const inline = true;</script>`;

const metagraph = { outputs: {
  'main.js': { bytes: 80, imports: [{ kind: 'import-statement', path: 'shared.js' },
    { kind: 'dynamic-import', path: 'dialog.js' }, { kind: 'import-statement', path: '@outside', external: true }],
  inputs: { 'root.ts': { bytesInOutput: 59 } } },
  'shared.js': { bytes: 20, imports: [{ kind: 'import-statement', path: 'core.js' }],
    inputs: { 'root.ts': { bytesInOutput: 2 }, 'lib.ts': { bytesInOutput: 15 } } },
  'core.js': { bytes: 12, imports: [], inputs: { 'lib.ts': { bytesInOutput: 8 } } },
  'styles.css': { bytes: 25, imports: [{ kind: 'import-rule', path: 'tokens.css' },
    { kind: 'url-token', path: 'font.woff2' }] },
  'tokens.css': { bytes: 7, imports: [] },
  'dialog.js': { bytes: 850, imports: [{ kind: 'import-statement', path: 'shared.js' }] },
} };

test('reports unique emitted entry files and static imports, not lazily loaded dialogs', () => {
  const report = initialRendererReport(index, metagraph, budget);
  assert.equal(report.initialBytes, 144);
  assert.equal(report.warningOverageBytes, 44);
  assert.equal(report.errorHeadroomBytes, 11);
  assert.deepEqual(report.assets.map(asset => asset.path), ['core.js', 'main.js', 'shared.js', 'styles.css', 'tokens.css']);
  assert.deepEqual(report.largestInputs, [{ path: 'root.ts', bytes: 61 }, { path: 'lib.ts', bytes: 23 }]);
});

test('matches decimal Angular budget units without changing the budgets', () => {
  assert.equal(budgetBytes('900kB'), 900_000);
  assert.equal(budgetBytes('1.45MB'), 1_450_000);
  for (const invalid of [undefined, '0kB', '3GiB', '-15kB', '0.1B']) {
    assert.throws(() => budgetBytes(invalid), /initial bundle budget/);
  }
});

test('refuses mismatched build metadata and nonlocal asset paths', () => {
  for (const source of ['', '<script src="./not-in-build.js"></script>', '<link rel="stylesheet" href="../outside.css">']) {
    assert.throws(() => initialRendererReport(source, metagraph, budget), /initial|local renderer/);
  }
  const incomplete = structuredClone(metagraph);
  delete incomplete.outputs['core.js'];
  assert.throws(() => initialRendererReport(index, incomplete, budget), /initial asset: core.js/);
});

test('CLI cross-checks file sizes against metadata in the selected output directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-initial-renderer-'));
  try {
    const browser = join(root, 'browser');
    mkdirSync(browser);
    writeFileSync(join(browser, 'index.html'), '<script type="module" src="main.js"></script>');
    writeFileSync(join(root, 'browser-stats.json'), JSON.stringify({ outputs: { 'main.js': { bytes: 3, imports: [] } } }));
    const asset = join(browser, 'main.js');
    writeFileSync(asset, '123');
    const args = [fileURLToPath(new URL('./report-initial-renderer.mjs', import.meta.url)), root];
    const report = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
    assert.equal(report.initialBytes, 3);
    writeFileSync(asset, 'changed');
    const mismatch = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /asset size differ: main.js/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
