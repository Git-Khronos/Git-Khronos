import { expect, test, type Page } from '@playwright/test';

async function holdCompactActions(page: Page, fail: boolean) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('CompactRepositoryActionsComponent')) {
      requests++;
      await gate;
      if (fail) { await route.abort(); return; }
    }
    await route.fulfill({ response, body });
  });
  return { release, requests: () => requests };
}

for (const fails of [false, true]) {
  test(`compact toolbar ${fails ? 'failed' : 'late'} content preserves dismissal`, async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 700 });
    const held = await holdCompactActions(page, fails);
    try {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      expect(held.requests()).toBe(0);
      const opener = page.getByRole('button', { name: 'More repository actions', exact: true });
      const menu = page.getByRole('menu', { name: 'More repository actions', exact: true });
      await opener.press('Enter');
      await expect.poll(held.requests).toBe(1);
      await expect(menu.getByRole('status')).toHaveText('Loading repository actions…');
      await expect(menu.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
      if (fails) {
        held.release();
        await expect(menu.getByRole('alert')).toContainText('could not load');
        await expect(menu.getByRole('menuitem', { name: 'Close', exact: true })).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(opener).toBeFocused();
      held.release();
      await opener.press('Enter');
      if (fails) await expect(menu.getByRole('alert')).toBeVisible();
      else await expect(menu.getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally { held.release(); }
  });
}

test('late compact actions do not steal focus from an outside control', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 700 });
  const held = await holdCompactActions(page, false);
  try {
    await page.goto('/');
    const opener = page.getByRole('button', { name: 'More repository actions', exact: true });
    const menu = page.getByRole('menu', { name: 'More repository actions', exact: true });
    const outside = page.getByRole('button', { name: 'Hide Commit Panel', exact: true });
    await opener.click();
    await expect(menu.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
    await outside.focus();
    held.release();
    await expect(menu.getByRole('menuitem', { name: /^Fetch branches with options/ })).toBeVisible();
    await expect(outside).toBeFocused();
  } finally { held.release(); }
});
