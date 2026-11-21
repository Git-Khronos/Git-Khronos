import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  assert.deepEqual(report.inputAttribution, {
    kind: 'unverified-bundler-metadata',
    outputsOverAttributed: [],
    largestInputs: [{ path: 'root.ts', metadataInputBytes: 61 }, { path: 'lib.ts', metadataInputBytes: 23 }],
  });
});

test('flags input attribution larger than emitted chunks without inflating the budget', () => {
  const metadata = structuredClone(metagraph);
  metadata.outputs['main.js'].inputs['root.ts'].bytesInOutput = 99;
  metadata.outputs['dialog.js'].inputs = { 'dialog.ts': { bytesInOutput: 900 } };
  const report = initialRendererReport(index, metadata, budget);
  assert.equal(report.initialBytes, 144);
  assert.equal(report.errorHeadroomBytes, 11);
  assert.deepEqual(report.inputAttribution.outputsOverAttributed, [
    { path: 'main.js', emittedBytes: 80, metadataInputBytes: 99 },
  ]);
  assert.deepEqual(report.inputAttribution.largestInputs[0], { path: 'root.ts', metadataInputBytes: 101 });
  assert.ok(report.inputAttribution.largestInputs.every(({ path }) => path !== 'dialog.ts'));
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
    const recorded = join(root, 'initial-renderer.json');
    const receipt = execFileSync(process.execPath, [...args, '--record'], { encoding: 'utf8' });
    assert.match(receipt, /Initial renderer: 3 bytes/);
    assert.deepEqual(JSON.parse(readFileSync(recorded, 'utf8')), report);
    assert.deepEqual(readdirSync(browser).sort(), ['index.html', 'main.js']);
    assert.deepEqual(readdirSync(root).sort(), ['browser', 'browser-stats.json', 'initial-renderer.json']);
    rmSync(recorded);
    writeFileSync(asset, 'changed');
    const mismatch = spawnSync(process.execPath, [...args, '--record'], { encoding: 'utf8' });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /asset size differ: main.js/);
    assert.equal(existsSync(recorded), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('compares two emitted builds without counting lazy files or rewriting reports', () => {
  const root = mkdtempSync(join(tmpdir(), 'khronos-renderer-compare-'));
  try {
    const baseline = join(root, 'baseline');
    const candidate = join(root, 'candidate');
    for (const [directory, js, css] of [[baseline, 16, 9], [candidate, 11, 10]]) {
      const browser = join(directory, 'browser');
      mkdirSync(browser, { recursive: true });
      writeFileSync(join(browser, 'index.html'), '<script src="main.js"></script><link rel="stylesheet" href="styles.css">');
      writeFileSync(join(browser, 'main.js'), 'x'.repeat(js));
      writeFileSync(join(browser, 'styles.css'), 'x'.repeat(css));
      writeFileSync(join(browser, 'optional.js'), 'x'.repeat(80));
      writeFileSync(join(directory, 'browser-stats.json'), JSON.stringify({ outputs: {
        'main.js': { bytes: js, imports: [{ kind: 'dynamic-import', path: 'optional.js' }] },
        'styles.css': { bytes: css, imports: [] },
        'optional.js': { bytes: 80, imports: [] },
      } }));
    }
    const cli = fileURLToPath(new URL('./report-initial-renderer.mjs', import.meta.url));
    const args = [cli, '--compare', baseline, candidate];
    const result = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
    assert.equal(result.baseline.initialBytes, 25);
    assert.equal(result.candidate.initialBytes, 21);
    assert.equal(result.delta.initialBytes, -4);
    assert.equal(result.delta.javascriptBytes, -5);
    assert.equal(result.delta.stylesheetBytes, 1);
    assert.equal(result.delta.gzipBytes, result.candidate.gzipBytes - result.baseline.gzipBytes);
    assert.equal(result.delta.brotliBytes, result.candidate.brotliBytes - result.baseline.brotliBytes);
    assert.equal(result.warningBytes, 900_000);
    assert.equal(existsSync(join(candidate, 'initial-renderer.json')), false);
    writeFileSync(join(candidate, 'browser', 'main.js'), 'changed');
    const mismatch = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /asset size differ: main.js/);
    assert.equal(spawnSync(process.execPath, [cli, '--compare', baseline]).status, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
