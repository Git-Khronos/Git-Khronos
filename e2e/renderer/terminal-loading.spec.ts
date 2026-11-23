import { expect, test } from '@playwright/test';

for (const scenario of ['cancel while loading', 'failed import', 'failure after moving focus'] as const) {
  test(`a deferred terminal can return to the graph after a ${scenario}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let settled!: () => void;
    const chunkSettled = new Promise<void>(resolve => { settled = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes('gk-terminal-panel') || !body.includes('Repository terminals for')) {
        await route.fulfill({ response, body });
        return;
      }
      if (scenario !== 'failed import') await gate;
      if (scenario === 'cancel while loading') await route.fulfill({ response, body });
      else await route.abort();
      settled();
    });

    try {
      await page.goto('/');
      const opener = page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)');
      await opener.click();
      const loading = page.getByRole('complementary', { name: 'Loading terminal' });
      const failed = page.getByRole('complementary', { name: 'Terminal unavailable' });
      const fallback = scenario === 'failed import' ? failed : loading;
      const close = fallback.getByRole('button', { name: 'Back to graph', exact: true });
      await expect(close).toBeFocused();
      await expect(page.locator('gk-terminal-panel')).toHaveCount(0);
      if (scenario === 'failure after moving focus') {
        const search = page.getByRole('button', { name: 'Search all repository history', exact: true });
        await search.focus();
        release();
        await expect(failed.getByRole('alert')).toBeVisible();
        await expect(search).toBeFocused();
        await failed.getByRole('button', { name: 'Back to graph', exact: true }).click();
      } else if (scenario === 'failed import') {
        await expect(fallback.getByRole('alert')).toContainText('Restart Git Khronos');
        await close.click();
      } else {
        await close.press('Escape');
      }
      release();
      await chunkSettled;
      await expect(opener).toBeFocused();
      await expect(loading).toHaveCount(0);
      await expect(failed).toHaveCount(0);
      await expect(page.locator('gk-terminal-panel')).toHaveCount(0);
      await expect(page.locator('.commit-row').first()).toBeVisible();
    } finally {
      release();
    }
  });
}
