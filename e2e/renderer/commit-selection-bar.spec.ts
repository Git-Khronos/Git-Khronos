import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
});

test('exposes multi-commit selection actions and restores focus when cleared', async ({ page }) => {
  const commits = page.locator('.commit-row[data-commit-oid]');
  const first = commits.filter({ hasText: 'Polish repository activity drawer' });
  const last = commits.filter({ hasText: 'Add hunk-level staging actions' });
  await first.click();
  await last.click({ modifiers: ['Shift'] });

  const bar = page.getByLabel('Commit selection actions');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('status')).toHaveText(/3 commits selected/);
  await expect(bar).toContainText(/Shift selects a range/);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  const actions = bar.getByRole('button', { name: 'Actions', exact: true });
  await actions.click();
  const menu = page.getByRole('menu', { name: 'Actions for 3 selected commits', exact: true });
  await expect(menu).toBeVisible();
  await expect(actions).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();

  await bar.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(bar).toHaveCount(0);
  const workingDirectory = page.locator('.wip-row:not(.linked-worktree)[data-graph-row]').first();
  await expect(workingDirectory).toHaveAttribute('aria-pressed', 'true');
  await expect(workingDirectory).toBeFocused();
});

test('keeps the contextual selection bar operable in the compact repository layout', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  const commits = page.locator('.commit-row[data-commit-oid]');
  await commits.filter({ hasText: 'Polish repository activity drawer' }).click();
  await commits.filter({ hasText: 'Add hunk-level staging actions' }).click({ modifiers: ['Shift'] });

  const bar = page.getByLabel('Commit selection actions');
  await expect(bar).toBeVisible();
  await expect(bar.locator('small')).toBeHidden();
  await expect(bar.getByRole('button', { name: 'Actions', exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
  const bounds = await bar.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(820);
});

test('keeps the row divider selectable without treating a resize drag as a commit click', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  const commit = page.locator('.commit-row[data-commit-oid]').filter({ hasText: 'Polish repository activity drawer' });
  const divider = commit.locator('.graph-row-resizer');

  await divider.click();
  await expect(commit).toHaveAttribute('aria-pressed', 'true');

  const workingDirectory = page.locator('.wip-row:not(.linked-worktree)[data-graph-row]').first();
  await workingDirectory.locator('.graph-row-resizer').click();
  await expect(workingDirectory).toHaveAttribute('aria-pressed', 'true');
  const bounds = await divider.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 28, bounds!.y + bounds!.height / 2);
  await page.mouse.up();

  await expect(workingDirectory).toHaveAttribute('aria-pressed', 'true');
  await expect(commit).toHaveAttribute('aria-pressed', 'false');

  await page.waitForTimeout(300);
  await commit.locator('.commit-main').click();
  await expect(commit).toHaveAttribute('aria-pressed', 'true');
});
