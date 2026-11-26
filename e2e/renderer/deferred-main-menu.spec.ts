import { expect, test, type Page } from '@playwright/test';
import { lazyChunkForExport, requestIsChunk } from './lazy-chunk-routing';

async function interceptMenu(page: Page, fail = false) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let delivered!: () => void;
  const delivery = new Promise<void>(resolve => { delivered = resolve; });
  let requests = 0;
  let menuChunk: string | null = null;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    menuChunk = lazyChunkForExport(source, 'MainMenuContentComponent') ?? menuChunk;
    if (!requestIsChunk(route.request().url(), menuChunk)) {
      await route.fulfill({ response, body: source });
      return;
    }
    requests++;
    await held;
    if (fail) await route.abort();
    else await route.fulfill({ response, body: source });
    delivered();
  });
  return {
    release,
    delivery,
    requests: () => requests,
    async finish() {
      release();
      // Drain in-flight chunk handlers before Playwright disposes their
      // response bodies and the browser context.
      await page.unrouteAll({ behavior: 'wait' });
    },
  };
}

for (const mode of ['late', 'failure'] as const) {
  test(`main menu ${mode} preserves a keyboard escape without running an action`, async ({ page }) => {
    const chunk = await interceptMenu(page, mode === 'failure');
    try {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      expect(chunk.requests()).toBe(0); // Not part of startup or idle prefetch.
      const toggle = page.getByRole('button', { name: 'Main menu', exact: true });
      const menu = page.getByRole('menu', { name: 'Git Khronos menu', exact: true });
      await toggle.click();
      await expect.poll(chunk.requests).toBe(1);
      await expect(menu.getByRole('status')).toHaveText('Loading menu…');
      await expect(menu.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
      if (mode === 'failure') {
        chunk.release();
        await expect(menu.getByRole('alert')).toContainText('could not load');
        await expect(menu.getByRole('menuitem', { name: 'Close', exact: true })).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(toggle).toBeFocused();
      chunk.release();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await toggle.click();
      if (mode === 'late') await expect(menu.getByRole('menuitem').first()).toBeFocused();
      else await expect(menu.getByRole('alert')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
    } finally { await chunk.finish(); }
  });
}

test('late main menu content does not take outside focus', async ({ page }) => {
  const chunk = await interceptMenu(page);
  try {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Main menu', exact: true });
    const menu = page.getByRole('menu', { name: 'Git Khronos menu', exact: true });
    const outside = page.getByRole('button', { name: 'Hide Left Panel', exact: true });
    await toggle.click();
    await expect.poll(chunk.requests).toBe(1);
    await expect(menu.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
    await outside.focus(); // Moving focus alone does not dismiss an open menu.
    chunk.release();
    await expect(menu.getByRole('menuitem', { name: 'Manage Repositories' })).toBeVisible();
    await expect(outside).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(toggle).toBeFocused();
  } finally { await chunk.finish(); }
});

for (const key of ['Tab', 'Shift+Tab']) {
  test(`loading main menu ${key} resumes the ordinary focus order`, async ({ page }) => {
    const chunk = await interceptMenu(page);
    try {
      await page.goto('/');
      const toggle = page.getByRole('button', { name: 'Main menu', exact: true });
      await toggle.focus();
      await page.keyboard.press(key);
      const outsideDocument = await page.evaluate(() => document.activeElement === document.body && !document.hasFocus());
      if (!outsideDocument) await page.evaluate(() => document.activeElement?.setAttribute('data-loading-menu-tab-target', 'true'));
      const expected = page.locator('[data-loading-menu-tab-target]');
      await toggle.click();
      await expect.poll(chunk.requests).toBe(1);
      await expect(page.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
      await page.keyboard.press(key);
      await expect(page.getByRole('menu', { name: 'Git Khronos menu', exact: true })).toHaveCount(0);
      if (outsideDocument) {
        await expect.poll(() => page.evaluate(() => document.activeElement === document.body && !document.hasFocus())).toBe(true);
      } else await expect(expected).toBeFocused();
      chunk.release();
      await expect(page.getByRole('menu', { name: 'Git Khronos menu', exact: true })).toHaveCount(0);
    } finally { await chunk.finish(); }
  });
}

test('retired main-menu DOM does not consume the next key', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Manage Repositories' })).toBeVisible();
  expect(await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const menu = document.querySelector('.app-menu-popover')!;
    app.appMenuOpen.set(false);
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    let menuHandled = false;
    // Inspect this owner's handling before the ambient document shortcuts run.
    menu.addEventListener('keydown', event => {
      menuHandled = event.defaultPrevented;
      event.stopPropagation();
    }, { once: true });
    menu.dispatchEvent(event);
    return menuHandled;
  })).toBe(false);
});


test('outside pointer dismissal while loading cannot be undone by late content', async ({ page }) => {
  const chunk = await interceptMenu(page);
  try {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Main menu', exact: true });
    const menu = page.getByRole('menu', { name: 'Git Khronos menu', exact: true });
    await toggle.click();
    await expect.poll(chunk.requests).toBe(1);
    await expect(menu.getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
    const outside = page.getByRole('button', { name: 'Hide Commit Panel', exact: true });
    await outside.hover();
    await page.mouse.down();
    try { await expect(menu).toHaveCount(0); }
    finally { await page.mouse.up(); }
    await expect(page.getByRole('button', { name: 'Show Commit Panel', exact: true })).toBeVisible();
    chunk.release();
    await chunk.delivery;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show Commit Panel', exact: true })).toBeFocused();
    await toggle.click();
    await expect(menu.getByRole('menuitem', { name: 'Manage Repositories' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(toggle).toBeFocused();
  } finally { await chunk.finish(); }
});
