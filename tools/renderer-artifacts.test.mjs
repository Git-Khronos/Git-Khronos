import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Playwright keeps custom ports separate without changing explicit artifact paths', async t => {
  const setEnv = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  const port = 'PLAYWRIGHT_PORT';
  const output = 'GIT_KHRONOS_RENDERER_OUTPUT_DIR';
  const report = 'GIT_KHRONOS_RENDERER_REPORT_DIR';
  const keys = [port, output, report, 'CI'];
  const original = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => setEnv(key, original[i])));
  keys.forEach(key => setEnv(key));

  const load = async name => (await import('../playwright.config.ts?' + name)).default;
  assert.equal((await load('default')).outputDir, './test-results/renderer');
  setEnv(port, '4287');
  assert.equal((await load('first')).outputDir, './test-results/renderer-port-4287');
  setEnv(port, '4288');
  assert.equal((await load('second')).outputDir, './test-results/renderer-port-4288');

  setEnv('CI', 'true');
  setEnv(output, 'test-results/shard-artifacts');
  setEnv(report, 'test-results/shard-report');
  const explicit = await load('explicit');
  assert.equal(explicit.outputDir, 'test-results/shard-artifacts');
  assert.deepEqual(explicit.reporter.find(([name]) => name === 'html'),
    ['html', { open: 'never', outputFolder: 'test-results/shard-report' }]);
});
