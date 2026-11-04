import { expect, test } from '@playwright/test';

for (const initialBusy of [false, true]) {
  for (const key of ['Tab', 'Shift+Tab', 'Escape']) {
  test(`workspace menu dismisses with ${key} when ${initialBusy ? 'opened busy' : 'its actions become disabled'}`, async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Workspace: Default', exact: true });
    await expect(toggle).toBeVisible();
    // Renderer-only state fixture: no real Git operation or production hook.
    await page.evaluate(() => {
      const root = (window as any).ng.getComponent(document.querySelector('gc-root'));
      root.git.operationBusy.set(true);
    });
    await toggle.focus();
    if (key !== 'Escape') {
      await page.keyboard.press(key);
      await expect(page.locator('body')).not.toBeFocused();
      await page.evaluate(() => document.activeElement?.setAttribute('data-busy-menu-tab-target', 'true'));
    }
    if (!initialBusy) {
      await page.evaluate(() => {
        (window as any).ng.getComponent(document.querySelector('gc-root')).git.operationBusy.set(false);
      });
    }
    await toggle.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Workspaces', exact: true });
    await expect(menu).toBeVisible();
    if (!initialBusy) {
      await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
      await page.evaluate(() => {
        (window as any).ng.getComponent(document.querySelector('gc-root')).git.operationBusy.set(true);
      });
    }
    await expect(menu.locator('button:not(:disabled)')).toHaveCount(0);
    await page.keyboard.press(key);
    await expect(menu).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    if (key === 'Escape') await expect(toggle).toBeFocused();
    else await expect(page.locator('[data-busy-menu-tab-target]')).toBeFocused();
  });
  }
}
