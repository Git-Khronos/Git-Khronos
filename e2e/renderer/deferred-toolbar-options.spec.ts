import { expect, test, type Page } from '@playwright/test';

async function holdToolbarOptions(page: Page, fail = false) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('ToolbarOptionsComponent')) {
      requests++;
      await gate;
      if (fail) { await route.abort(); return; }
    }
    await route.fulfill({ response, body });
  });
  return { release, requests: () => requests };
}

const toggle = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const menu = (page: Page, name: string) => page.getByRole('menu', { name, exact: true });
const fetch = 'Fetch options';
const pull = 'Pull options';

test('split menu options are absent at startup and the latest opener takes ownership of a shared load', async ({ page }) => {
  const held = await holdToolbarOptions(page);
  try {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    expect(held.requests()).toBe(0);
    await toggle(page, fetch).press('Enter');
    await expect.poll(held.requests).toBe(1);
    await expect(menu(page, fetch).getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
    await toggle(page, pull).press('Enter');
    await expect(menu(page, fetch)).toHaveCount(0);
    await expect(menu(page, pull).getByRole('status')).toHaveText('Loading toolbar options…');
    held.release();
    await expect(menu(page, pull).getByRole('menuitem').first()).toBeFocused();
    await expect(menu(page, fetch)).toHaveCount(0);
    expect(held.requests()).toBe(1);
    await page.keyboard.press('Escape');
    await expect(toggle(page, pull)).toBeFocused();
    await expect(toggle(page, pull)).toHaveAttribute('aria-expanded', 'false');
  } finally { held.release(); }
});

test('Escape cancels a loading toolbar menu and late completion does not steal focus', async ({ page }) => {
  const held = await holdToolbarOptions(page);
  try {
    await page.goto('/');
    const opener = toggle(page, fetch);
    await opener.press('Enter');
    await expect(menu(page, fetch).getByRole('menuitem', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    const outside = toggle(page, 'Hide Commit Panel');
    await outside.focus();
    held.release();
    await expect(menu(page, fetch)).toHaveCount(0);
    await expect(outside).toBeFocused();
    await opener.press('Enter');
    await expect(menu(page, fetch).getByRole('menuitem').first()).toBeFocused();
  } finally { held.release(); }
});

test('a failed toolbar options chunk is focused, dismissible, and opens no Git review', async ({ page }) => {
  const held = await holdToolbarOptions(page, true);
  try {
    await page.goto('/');
    const opener = toggle(page, pull);
    await opener.press('Enter');
    await expect(menu(page, pull).getByRole('status')).toBeVisible();
    held.release();
    await expect(menu(page, pull).getByRole('alert')).toContainText('Toolbar options could not load');
    const close = menu(page, pull).getByRole('menuitem', { name: 'Close', exact: true });
    await expect(close).toBeFocused();
    await close.press('Enter');
    await expect(menu(page, pull)).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { held.release(); }
});

test('a toolbar menu still loading belongs to the original checkout visit', async ({ page }) => {
  const held = await holdToolbarOptions(page);
  try {
    await page.goto('/');
    const opener = toggle(page, pull);
    await opener.press('Enter');
    await expect(menu(page, pull).getByRole('status')).toBeVisible();
    await page.evaluate(() => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const previous = git.repository();
      const next = { ...previous, id: 'second-toolbar-checkout', path: '/owned/second-toolbar-checkout', name: 'Second checkout' };
      git.repositories.update((items: any[]) => [...items, next]);
      git.activeRepositoryId.set(next.id);
    });
    await expect(menu(page, pull)).toHaveCount(0);
    held.release();
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    await opener.press('Enter');
    await expect(menu(page, pull).getByRole('menuitem').first()).toBeFocused();
    expect(held.requests()).toBe(1);
  } finally { held.release(); }
});

test('a clean checkout keeps focus on the opener after a disabled Stash options menu loads', async ({ page }) => {
  const held = await holdToolbarOptions(page);
  try {
    await page.goto('/');
    await page.evaluate(() => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repository = git.repository();
      git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
        ? { ...repository, status: { ...repository.status, entryCount: 0 } } : item));
    });
    const name = 'Stash options';
    const opener = toggle(page, name);
    await opener.press('Enter');
    await expect(menu(page, name).getByRole('menuitem', { name: 'Cancel' })).toBeFocused();
    held.release();
    await expect(menu(page, name).getByRole('menuitem', { name: /^Stash all changes/ })).toBeDisabled();
    await expect(opener).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page, name)).toHaveCount(0);
  } finally { held.release(); }
});
