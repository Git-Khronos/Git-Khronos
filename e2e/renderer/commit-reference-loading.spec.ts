import { expect, test } from '@playwright/test';

for (const scenario of ['ready', 'abandoned', 'failed'] as const) {
  test(`commit references stay independent of the inspector when their chunk is ${scenario}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let settled!: () => void;
    const chunkSettled = new Promise<void>(resolve => { settled = resolve; });
    let referenceRequests = 0;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes('gk-commit-reference-strip') || !body.includes('References on selected commit')) {
        await route.fulfill({ response, body });
        return;
      }
      referenceRequests++;
      await gate;
      if (scenario === 'failed') await route.abort();
      else await route.fulfill({ response, body });
      settled();
    });
    try {
      await page.goto('/');
      const commit = page.locator('.commit-row').filter({ hasText: 'Polish repository activity drawer' }).first();
      await expect(commit).toBeVisible();
      expect(referenceRequests).toBe(0);
      await commit.click();
      const inspector = page.locator('#repository-commit-panel');
      await expect(inspector.getByText('Loading commit references…', { exact: true })).toBeVisible();
      await expect(inspector.getByRole('heading', { name: 'Polish repository activity drawer', exact: true })).toBeVisible();
      const strip = page.locator('gk-commit-reference-strip');
      await expect(strip).toHaveCount(0);
      if (scenario === 'abandoned') await page.locator('.wip-nav').click();
      release();
      await chunkSettled;
      if (scenario === 'ready') {
        await expect(strip.getByLabel('Commit references', { exact: true })).toBeVisible();
        await expect(inspector.getByText('Loading commit references…', { exact: true })).toHaveCount(0);
      } else if (scenario === 'failed') {
        await expect(inspector.getByRole('alert')).toContainText('Commit references could not load');
        await expect(inspector.getByRole('heading', { name: 'Polish repository activity drawer', exact: true })).toBeVisible();
        await expect(strip).toHaveCount(0);
      } else {
        await expect(page.locator('.commit-composer')).toBeVisible();
        await expect(strip).toHaveCount(0);
      }
    } finally {
      release();
    }
  });
}
