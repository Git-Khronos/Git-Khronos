import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});
test('keeps the global command launcher discoverable without crowding compact chrome', async ({ page }) => {
  const launcher = page.getByRole('button', { name: 'Command palette', exact: true });
  await expect(launcher).toContainText('Commands');
  await expect(launcher.locator('kbd')).toHaveText(/P$/);
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');

  await launcher.click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1100, height: 760 });
  await expect(launcher.locator('span')).toBeHidden();
  await expect(launcher.locator('kbd')).toBeHidden();
  await expect(launcher).toHaveAccessibleName('Command palette');
});

test('opens, filters, and recovers from an empty command search', async ({ page }) => {
  const opener = page.getByRole('button', { name: /Switch branch, current main/ });
  await opener.focus();
  await page.keyboard.press('Control+p');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await expect(palette).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-palette-option-0');
  await expect(palette.getByRole('option', { selected: true })).toBeEnabled();
  await expect(palette.getByRole('option').first()).toHaveAttribute('tabindex', '-1');

  const close = palette.getByRole('button', { name: 'Close command palette' });
  await expect(close).toHaveCSS('border-top-style', 'solid');
  expect(await close.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await close.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  })).toBeGreaterThanOrEqual(30);
  await search.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
  await expect(search).toBeFocused();
  await search.press('Shift+Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(search).toBeFocused();

  await search.fill('no-such-command-value');
  await expect(palette.getByRole('listbox')).toHaveCount(0);
  await expect(palette.getByRole('region', { name: 'Command search status' })).toBeVisible();
  await expect(palette.getByText('No matching commands, repositories, references, or files')).toBeVisible();
  await expect(palette.getByText('Try another phrase or browse the full list.')).toBeVisible();

  await palette.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(palette.getByRole('listbox', { name: 'Available commands' })).toBeVisible();
  await expect(palette.getByRole('option', { name: /Fetch All/ })).toBeVisible();

  await search.fill('terminal');
  const terminal = palette.getByRole('option', { name: /Open Terminal/ });
  await expect(terminal.locator('kbd')).toHaveText('Alt T / Ctrl `');

  await search.press('Escape');
  await expect(palette).toBeHidden();
  await expect(opener).toBeFocused();
});

test('keeps keyboard selection visible and executes a searched view command', async ({ page }) => {
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });

  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-palette-option-1');
  await expect(palette.locator('#command-palette-option-1')).toHaveAttribute('aria-selected', 'true');

  await search.fill('toggle left panel');
  const action = palette.getByRole('option', { name: /Toggle Left Panel/ });
  await expect(action).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');

  await expect(palette).toBeHidden();
  await expect(page.locator('.left-panel')).toBeHidden();
});

test('discloses compact command descriptions without expanding result rows', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 560 });
  await page.keyboard.press('Control+p');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const action = palette.getByRole('option', { name: /Search All History/ });
  const detail = action.locator('.palette-action-copy em');

  expect(await detail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(action).toHaveAttribute(
    'title',
    'Search All History — Search whole-repository history with optional advanced filters',
  );
});

test('ranks command-name matches ahead of incidental description matches', async ({ page }) => {
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });

  await search.fill('open');
  const options = palette.getByRole('option');
  await expect(options.first()).toContainText('Open Repository');
  await expect(options.first()).toContainText('Repository · Open a local Git working tree');
  await expect(palette.locator('.palette-group-heading')).toHaveCount(0);
  await expect(options.filter({ hasText: 'New Tab' })).not.toHaveCount(0);
});

test('returns focus to the palette opener after closing activity logs', async ({ page }) => {
  const opener = page.getByRole('button', { name: /Switch branch, current main/ });
  await opener.focus();
  await page.keyboard.press('Control+p');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await search.fill('activity logs');
  await expect(palette.getByRole('option', { name: /Activity Logs/ })).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');

  const drawer = page.getByRole('region', { name: 'Activity logs' });
  await expect(palette).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { selected: true })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});

test('opens a grouped branch switcher from the compact repository toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 720 });
  const more = page.getByRole('button', { name: 'More repository actions' });
  await more.click();
  const menu = page.getByRole('menu', { name: 'More repository actions' });
  await menu.getByRole('menuitem', { name: /Switch branch/ }).click();

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search branches' });
  await expect(palette.getByText('Branches', { exact: true })).toBeVisible();
  await expect(palette.getByRole('listbox', { name: 'Branch choices' })).toBeVisible();
  await expect(palette.locator('.palette-footer')).toContainText('Switch');
  await expect(palette.getByRole('option', { name: /^main/ })).toBeDisabled();
  await search.fill('partial');
  await expect(palette.getByRole('option', { name: /feature\/partial-staging/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
});
