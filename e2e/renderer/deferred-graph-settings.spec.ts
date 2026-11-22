import { expect, test, type Page } from '@playwright/test';

async function holdGraphSettings(page: Page, fail = false) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  let delivered = false;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    if (!body.includes('GraphSettingsContentComponent')) {
      await route.fulfill({ response, body });
      return;
    }
    requests++;
    await gate;
    if (fail) await route.abort();
    else await route.fulfill({ response, body });
    delivered = true;
  });
  return { release, requests: () => requests, delivered: () => delivered };
}

const opener = (page: Page) => page.getByRole('button', { name: 'Configure graph columns' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Graph settings', exact: true });

test('graph settings wait for the first open and a cancelled load does not take focus', async ({ page }) => {
  const held = await holdGraphSettings(page);
  try {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    expect(held.requests()).toBe(0);
    await opener(page).press('Enter');
    await expect.poll(held.requests).toBe(1);
    await expect(dialog(page).getByRole('status')).toHaveText('Loading graph settings…');
    await expect(dialog(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(opener(page)).toBeFocused();
    const outside = page.getByRole('button', { name: 'Hide Commit Panel', exact: true });
    await outside.focus();
    held.release();
    await expect.poll(held.delivered).toBe(true);
    await expect(dialog(page)).toHaveCount(0);
    await expect(outside).toBeFocused();
    await opener(page).press('Enter');
    await expect(dialog(page).getByRole('checkbox', { name: 'Scroll Markers' })).toBeVisible();
    expect(held.requests()).toBe(1);
  } finally { held.release(); }
});

test('a failed graph settings chunk leaves a keyboard-accessible close action', async ({ page }) => {
  const held = await holdGraphSettings(page, true);
  try {
    await page.goto('/');
    await opener(page).press('Enter');
    await expect(dialog(page).getByRole('status')).toBeVisible();
    held.release();
    await expect(dialog(page).getByRole('alert')).toContainText('Graph settings could not load');
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', { name: 'Close graph settings' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect(opener(page)).toBeFocused();
  } finally { held.release(); }
});

test('contextual graph settings refit to the viewport after the controls load', async ({ page }) => {
  const held = await holdGraphSettings(page);
  try {
    await page.setViewportSize({ width: 820, height: 540 });
    await page.goto('/');
    await page.locator('.graph-columns').dispatchEvent('contextmenu', { clientX: 792, clientY: 508, button: 2 });
    await expect(dialog(page).getByRole('status')).toBeVisible();
    held.release();
    await expect(dialog(page).getByRole('button', { name: 'Restore graph defaults' })).toBeVisible();
    await expect.poll(async () => {
      const rect = await dialog(page).boundingBox();
      return rect && rect.x + rect.width <= 820 && rect.y + rect.height <= 540;
    }).toBe(true);
    await expect(dialog(page)).toBeFocused();
  } finally { held.release(); }
});
