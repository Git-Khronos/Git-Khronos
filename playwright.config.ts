import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['PLAYWRIGHT_PORT'] ?? 4201);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PLAYWRIGHT_PORT');

export default defineConfig({
  testDir: './e2e/renderer',
  // Playwright clears this directory at startup. Never clear native evidence
  // or another named audit stored alongside the renderer results.
  outputDir: './test-results/renderer',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: process.env['CI'] ? 1 : 2,
  reporter: process.env['CI'] ? [['line'], ['html', { open: 'never' }]] : 'line',
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
  ],
  webServer: {
    command: `pnpm exec ng serve desktop --no-hmr --live-reload=false --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
