import { expect, test, type Page } from '@playwright/test';
import { lazyChunkForExport, requestIsChunk } from './lazy-chunk-routing';

const compactActionsToggleName = 'More repository actions';

async function holdCompactActions(page: Page, fail: boolean) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  let chunkUrl = '';
  let compactActionsChunk: string | null = null;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    compactActionsChunk = lazyChunkForExport(body, 'CompactRepositoryActionsComponent') ?? compactActionsChunk;
    if (requestIsChunk(route.request().url(), compactActionsChunk)) {
      requests++;
      chunkUrl = route.request().url();
      await gate;
      if (fail) { await route.abort(); return; }
    }
    await route.fulfill({ response, body });
  });
  return { release, requests: () => requests, chunkUrl: () => chunkUrl };
}

for (const intent of ['hover', 'focus', 'failed prefetch'] as const) {
  test(`compact toolbar ${intent} starts fetching without opening the menu`, async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 700 });
    const fails = intent === 'failed prefetch';
    const held = await holdCompactActions(page, fails);
    try {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      const opener = page.getByRole('button', { name: compactActionsToggleName, exact: true });
      const menu = page.getByRole('menu', { name: compactActionsToggleName, exact: true });
      await expect(opener).toBeVisible();
      expect(held.requests()).toBe(0);

      if (intent === 'focus') {
        const next = page.getByRole('button', { name: 'Hide Commit Panel', exact: true });
        await next.focus();
        await page.keyboard.press('Shift+Tab');
        await expect(opener).toBeFocused();
      } else {
        await opener.hover();
      }
      await expect.poll(held.requests).toBe(1);
      await expect(opener).toHaveAttribute('aria-expanded', 'false');
      await expect(menu).toHaveCount(0);

      const loaded = fails
        ? page.waitForEvent('requestfailed', { predicate: request => request.url() === held.chunkUrl() })
        : page.waitForEvent('requestfinished', { predicate: request => request.url() === held.chunkUrl() });
      held.release();
      await loaded;
      await expect(menu).toHaveCount(0);

      if (intent === 'focus') await page.keyboard.press('Enter');
      else await opener.click();
      if (fails) await expect(menu.getByRole('alert')).toContainText('could not load');
      else await expect(menu.getByRole('menuitem', { name: /^Fetch branches with options/ })).toBeVisible();
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      expect(held.requests()).toBe(1);
    } finally { held.release(); }
  });
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
