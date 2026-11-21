import { expect, test } from '@playwright/test';

for (const outcome of ['ready', 'failed'] as const) {
  test(`preferences styles stay off the startup path when the dialog chunk is ${outcome}`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      if (!/class\s+_?PreferencesDialogComponent\b/.test(source)) {
        await route.fulfill({ response, body: source });
        return;
      }
      requests++;
      await held;
      if (outcome === 'failed') await route.abort();
      else await route.fulfill({ response, body: source });
    });
    const layoutInDocument = () => page.evaluate(() => Array.from(document.styleSheets).some(sheet => {
      try { return Array.from(sheet.cssRules).some(rule => rule.cssText.includes('.preferences-sidebar')); }
      catch { return false; }
    }));
    try {
      await page.setViewportSize({ width: 460, height: 720 });
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      expect(requests).toBe(0);
      expect(await layoutInDocument()).toBe(false);
      const opener = page.getByRole('button', { name: 'Preferences', exact: true });
      await opener.click();
      await expect.poll(() => requests).toBe(1);
      const loading = page.getByRole('dialog', { name: 'Loading preferences', exact: true });
      await expect(loading).toHaveCSS('position', 'fixed');
      expect(await layoutInDocument()).toBe(false);
      release();
      if (outcome === 'ready') {
        const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
        const categories = preferences.getByRole('tablist', { name: 'Preference categories' });
        await expect(categories).toHaveCSS('display', 'grid');
        await expect(preferences.getByRole('button', { name: 'Close preferences' })).toBeFocused();
        expect(await layoutInDocument()).toBe(true);
      } else {
        const unavailable = page.getByRole('dialog', { name: 'Preferences unavailable', exact: true });
        await expect(unavailable).toHaveCSS('position', 'fixed');
        expect(await layoutInDocument()).toBe(false);
        await unavailable.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(opener).toHaveAttribute('aria-expanded', 'false');
      }
    } finally { release(); }
  });
}
