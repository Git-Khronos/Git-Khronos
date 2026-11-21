import { expect, test } from '@playwright/test';

for (const scenario of ['load', 'close', 'error'] as const) {
  test(`deferred diff workspace handles ${scenario} without losing keyboard ownership`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let settled!: () => void;
    const chunkSettled = new Promise<void>(resolve => { settled = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      if (!text.includes('gc-diff-workspace') || !text.includes('Jump to change')) {
        await route.fulfill({ response, body: text });
        return;
      }
      if (scenario === 'error') await route.abort();
      else {
        await gate;
        await route.fulfill({ response, body: text });
      }
      settled();
    });

    try {
      await page.goto('/?compare-commits&diff-viewer=split');
      const label = scenario === 'error' ? 'Diff viewer unavailable' : 'Loading diff viewer';
      const fallback = page.getByRole('complementary', { name: label, exact: true });
      const back = fallback.getByRole('button', { name: 'Back to graph' });
      const viewer = page.getByRole('region', { name: 'Diff viewer', exact: true });
      await expect(back).toBeFocused();
      await expect(viewer).toHaveCount(0);
      if (scenario === 'load') {
        release();
        await expect(viewer).toBeFocused();
        await expect(viewer.getByRole('region', { name: 'Before and after file changes' })).toBeVisible();
        await expect(viewer.locator('#diff-split-layout-hint')).toHaveCSS('position', 'absolute');
        await expect(fallback).toHaveCount(0);
        await page.keyboard.press('Escape');
      } else {
        if (scenario === 'error') await expect(fallback.getByRole('alert')).toContainText('could not load');
        await page.keyboard.press('Escape');
        release();
      }
      await chunkSettled;
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await expect(fallback).toHaveCount(0);
      await expect(viewer).toHaveCount(0);
      await expect(page.locator('.commit-row').first()).toBeVisible();
    } finally {
      release();
    }
  });
}
