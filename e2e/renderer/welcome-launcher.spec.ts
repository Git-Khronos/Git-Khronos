import { expect, test } from '@playwright/test';

test('starts an empty welcome screen at its primary repository action', async ({ page }) => {
  await page.goto('/?welcome-preview');

  const openRepository = page.getByRole('button', { name: /Open repository/ });
  await expect(openRepository).toBeFocused();
  await expect(page.locator('.welcome-nav .brand')).toHaveText('Git Khronos');
  const logo = page.locator('.welcome-nav img.brand-mark');
  await expect(logo).toHaveAttribute('src', 'assets/icon.svg');
  await expect(logo).toHaveAttribute('alt', '');
  await expect.poll(() => logo.evaluate((element) =>
    element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);

  await openRepository.press('Tab');
  await expect(page.getByRole('button', { name: /Clone repository/ })).toBeFocused();
});

test('preserves natural document focus when repository history is available', async ({ page }) => {
  await page.goto('/?welcome-preview');
  await page.evaluate(() => {
    localStorage.setItem('git-khronos.recent-repositories.v1', JSON.stringify([
      '/home/maya/projects/atlas-ui',
    ]));
  });
  await page.reload();

  await expect(page.getByRole('button', { name: /Open repository/ })).not.toBeFocused();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});

test('styles the shell-owned workspace menu inside the compact welcome launcher', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/?welcome-preview');

  const welcome = page.locator('gk-welcome-launcher');
  const workspace = welcome.getByRole('button', { name: /^Workspace: / });
  await expect(welcome.locator('.hero-actions')).toHaveCSS('display', 'grid');
  await expect(welcome.getByRole('button', { name: 'Switch application theme' })).toHaveCSS('width', '31px');
  await expect(workspace).toHaveCSS('max-width', '145px');
  await workspace.click();

  const menu = welcome.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('position', 'fixed');
  await expect(menu).toHaveCSS('top', '65px');
});
