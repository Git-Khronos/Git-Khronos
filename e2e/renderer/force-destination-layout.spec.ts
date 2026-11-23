import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 780, height: 560 }, { width: 1100, height: 700 }]) {
  test(`a complete destination review stays usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).requestForcePush());
    const modal = page.getByRole('alertdialog', { name: 'Force push main', exact: true });
    const destinations = modal.getByRole('list', { name: 'Configured push destinations' });
    await expect(destinations).toBeVisible();
    // Presentation-only probe at the native count limit; no Git command runs.
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      (window as any).__layoutPushes = 0;
      app.git.forcePushWithLease = () => { (window as any).__layoutPushes++; };
      app.forcePushDestination.set({ state: 'd'.repeat(64), destinations: Array.from({ length: 128 }, (_, index) =>
        `https://owned-fixture.invalid/${'long-reviewed-path/'.repeat(12)}destination-${index}.git`) });
    });
    await expect(destinations.locator('li')).toHaveCount(128);
    await expect(modal).toContainText('A later failure can leave earlier destinations updated');
    const bounds = await modal.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        width: innerWidth, height: innerHeight, clippedHorizontally: element.scrollWidth > element.clientWidth + 1 };
    });
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    expect(bounds.clippedHorizontally).toBe(false);
    await destinations.focus();
    await page.keyboard.press('End');
    await expect.poll(() => destinations.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Tab');
    const cancel = modal.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    const cancelBounds = (await cancel.boundingBox())!;
    expect(cancelBounds.y).toBeGreaterThanOrEqual(0);
    expect(cancelBounds.y + cancelBounds.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Tab');
    await expect(modal.getByRole('button', { name: 'Force Push with Lease', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(destinations).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__layoutPushes)).toBe(0);
  });
}
