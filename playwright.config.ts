import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

const defaultPort = 4201;
const port = Number(process.env['PLAYWRIGHT_PORT'] ?? defaultPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PLAYWRIGHT_PORT');
const serverTimeout = Number(process.env['PLAYWRIGHT_SERVER_TIMEOUT_MS'] ?? 120_000);
if (!Number.isInteger(serverTimeout) || serverTimeout < 1 || serverTimeout > 2_147_483_647) {
  throw new Error('Invalid PLAYWRIGHT_SERVER_TIMEOUT_MS: expected positive milliseconds');
}
const reporters: ReporterDescription[] = [['line']];
if (process.env['CI']) reporters.push(['html', { open: 'never', outputFolder: process.env['GIT_KHRONOS_RENDERER_REPORT_DIR'] ?? 'playwright-report' }]);
const rendererProgress = process.env['GIT_KHRONOS_RENDERER_PROGRESS_FILE'];
if (rendererProgress) reporters.push(['./tools/renderer-progress-reporter.cjs', { path: rendererProgress }]);

export default defineConfig({
  testDir: './e2e/renderer',
  // Playwright clears this directory at startup. Never clear native evidence
  // or another named audit stored alongside the renderer results.
  outputDir: process.env['GIT_KHRONOS_RENDERER_OUTPUT_DIR']
    ?? (port === defaultPort ? './test-results/renderer' : `./test-results/renderer-port-${port}`),
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: process.env['CI'] ? 1 : 2,
  reporter: reporters,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    colorScheme: 'dark',
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    ...(process.env['GIT_KHRONOS_RENDERER_WEBKIT'] === '1'
      ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }]
      : []),
  ],
  webServer: {
    // Acceptance uses a fixed source snapshot. Watching the workspace is
    // unnecessary and can keep startup busy before the server starts listening.
    // Never silently test an arbitrary server on the local port; reusing a
    // known local server must be requested explicitly.
    command: `pnpm exec ng serve desktop --watch=false --no-hmr --live-reload=false --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'] && process.env['PLAYWRIGHT_REUSE_SERVER'] === '1',
    timeout: serverTimeout,
  },
});
