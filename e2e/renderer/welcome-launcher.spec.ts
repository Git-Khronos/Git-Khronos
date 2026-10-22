import { expect, test } from '@playwright/test';

test('starts an empty welcome screen at its primary repository action', async ({ page }) => {
  await page.goto('/?welcome-preview');

  const openRepository = page.getByRole('button', { name: /Open repository/ });
  await expect(openRepository).toBeFocused();

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
