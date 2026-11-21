import { expect, test } from '@playwright/test';

for (const scenario of ['late controls', 'dismissed', 'failed import'] as const) {
  test(`graph settings remain dismissible with ${scenario}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let settled!: () => void;
    const arrived = new Promise<void>(resolve => { settled = resolve; });
    let optionRequests = 0;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes('gc-graph-settings-options') || !body.includes('Restore graph defaults')) {
        await route.fulfill({ response, body });
        return;
      }
      optionRequests++;
      await gate;
      if (scenario === 'failed import') await route.abort();
      else await route.fulfill({ response, body });
      settled();
    });
    try {
      await page.setViewportSize({ width: 900, height: 640 });
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      expect(optionRequests).toBe(0);
      const toggle = page.getByRole('button', { name: 'Configure graph columns', exact: true });
      if (scenario === 'late controls') {
        await page.locator('.graph-columns').dispatchEvent('contextmenu', { button: 2, clientX: 899, clientY: 639 });
      } else {
        await toggle.click();
      }
      const dialog = page.getByRole('dialog', { name: 'Graph settings' });
      const close = dialog.getByRole('button', { name: 'Close graph settings' });
      await expect(dialog).toBeFocused();
      await expect(close).toBeVisible();
      await expect(dialog.getByRole('status')).toHaveText('Loading graph controls…');
      if (scenario === 'dismissed') await page.keyboard.press('Escape');
      release();
      await arrived;
      if (scenario === 'late controls') {
        await expect(dialog.getByRole('button', { name: 'Restore graph defaults' })).toBeVisible();
        await expect.poll(async () => {
          const bounds = await dialog.boundingBox();
          return !!bounds && bounds.y + bounds.height <= 632 && bounds.x + bounds.width <= 892;
        }).toBe(true);
        await expect(dialog).toBeFocused();
        await close.click();
      } else if (scenario === 'failed import') {
        await expect(dialog.getByRole('alert')).toContainText('Graph controls could not load');
        await close.click();
      }
      await expect(dialog).toHaveCount(0);
      await expect(toggle).toBeFocused();
      await expect(page.locator('gc-graph-settings-options')).toHaveCount(0);
    } finally {
      release();
    }
  });
}
