import { expect, test } from '@playwright/test';

test('main menu Tab resumes normal focus order on the repository screen', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Main menu', exact: true });
  await toggle.focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).not.toBeFocused();
  await page.evaluate(() => document.activeElement?.setAttribute('data-main-menu-tab-target', 'true'));
  const expected = page.locator('[data-main-menu-tab-target]');
  await toggle.click();
  const menu = page.getByRole('menu', { name: 'Git Khronos menu', exact: true });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await expect(expected).toBeFocused();
  await toggle.click();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
});

for (const welcome of [false, true]) {
  for (const key of ['Tab', 'Shift+Tab']) {
    test(`workspace menu ${key} resumes normal focus order on the ${welcome ? 'welcome' : 'repository'} screen`, async ({ page }) => {
      await page.goto(welcome ? '/?welcome-preview' : '/');
      const toggle = page.getByRole('button', { name: 'Workspace: Default', exact: true });
      await toggle.focus();
      await page.keyboard.press(key);
      const outsideDocument = await page.evaluate(() => document.activeElement === document.body && !document.hasFocus());
      if (!outsideDocument) {
        await expect(page.locator('body')).not.toBeFocused();
        await page.evaluate(() => document.activeElement?.setAttribute('data-workspace-tab-target', 'true'));
      }
      const expected = page.locator('[data-workspace-tab-target]');
      if (!outsideDocument) await expect(expected).toBeFocused();
      await toggle.click();
      const menu = page.getByRole('menu', { name: 'Workspaces', exact: true });
      await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
      await page.keyboard.press(key);
      await expect(menu).toHaveCount(0);
      if (outsideDocument) {
        await expect.poll(() => page.evaluate(() => document.activeElement === document.body && !document.hasFocus())).toBe(true);
      } else await expect(expected).toBeFocused();
      await toggle.click();
      await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
    });
  }
}

for (const welcome of [false, true]) {
  test(`workspace menu dismisses on outside pointer-down in the ${welcome ? 'welcome' : 'repository'} screen`, async ({ page }) => {
    await page.goto(welcome ? '/?welcome-preview' : '/');
    const toggle = page.getByRole('button', { name: 'Workspace: Default', exact: true });
    const menu = page.getByRole('menu', { name: 'Workspaces', exact: true });
    await toggle.click();
    await expect(menu).toBeVisible();
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width - 8, viewport.height - 8);
    await page.mouse.down();
    try {
      // Dismiss before releasing the mouse: do not wait for a click event.
      await expect(menu).toHaveCount(0);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    } finally { await page.mouse.up(); }
  });
}

test('workspace dismissal survives stopped pointer events and preserves the outside action', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const outside = page.getByRole('button', { name: 'Hide Left Panel', exact: true });
  await expect(outside).toBeVisible();
  await outside.evaluate(button => button.addEventListener('pointerdown', event => event.stopPropagation(), { once: true }));
  await page.getByRole('button', { name: 'Workspace: Default', exact: true }).click();
  await outside.hover();
  const box = (await outside.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try { await expect(page.getByRole('menu', { name: 'Workspaces', exact: true })).toHaveCount(0); }
  finally { await page.mouse.up(); }
  await expect(page.getByRole('button', { name: 'Show Left Panel', exact: true })).toBeVisible();
});

test('workspace pointer dismissal preserves inside controls, toggle and Escape focus', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Workspace: Default', exact: true });
  const menu = page.getByRole('menu', { name: 'Workspaces', exact: true });
  await toggle.click();
  await menu.locator('header').click();
  await expect(menu).toBeVisible();
  await toggle.click();
  await expect(menu).toHaveCount(0);
  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await menu.getByRole('menuitem', { name: 'New workspace', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'New Workspace', exact: true })).toBeVisible();
});
