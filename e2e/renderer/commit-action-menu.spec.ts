import { expect, test, type Page } from '@playwright/test';

const commitSubject = 'Polish repository activity drawer';

async function openCommitMenu(page: Page) {
  const trigger = page.getByRole('button', { name: `Commit actions for ${commitSubject}`, exact: true });
  await trigger.click();
  const menu = page.getByRole('menu', { name: `Actions for commit ${commitSubject}`, exact: true });
  await expect(menu).toBeVisible();
  return { menu, trigger };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
});

test('groups commit actions and restores the row action trigger after keyboard dismissal', async ({ page }) => {
  const { menu, trigger } = await openCommitMenu(page);
  await expect(menu.locator('.context-section-label')).toHaveText([
    'Inspect or checkout',
    'History operations',
    'Move current branch',
    'Create reference',
  ]);

  const checkout = menu.getByRole('menuitem', { name: 'Checkout this commit', exact: true });
  const copy = menu.getByRole('menuitem', { name: 'Copy commit SHA', exact: true });
  const createTag = menu.getByRole('menuitem', { name: 'Create tag here…', exact: true });
  await expect(checkout).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(copy).toBeFocused();
  await page.keyboard.press('End');
  await expect(createTag).toBeFocused();
  await page.keyboard.press('Home');
  await expect(checkout).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('keeps multi-commit actions legible and disables commands that require one commit', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  const subject = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const commits = app.visibleGraphRows().map((row: any) => row.commit)
      .filter((commit: any) => commit && !app.stashForOid(commit.oid)).slice(0, 3);
    app.selectedCommits.set(commits.map((commit: any) => commit.oid));
    app.commitSelectionAnchor.set(commits[0].oid);
    app.selectedCommit.set(commits[0].oid);
    return commits[0].subject;
  });

  await page.getByRole('button', { name: `Commit actions for ${subject}`, exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Actions for 3 selected commits', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Oldest to newest');
  await expect(menu.getByRole('menuitem', { name: 'Checkout this commit', exact: true })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Compare with working directory', exact: true })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Cherry-pick 3 commits', exact: true })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: 'Revert 3 commits', exact: true })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: 'Reset to this commit…', exact: true })).toBeDisabled();

  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(820 - 8);
  expect(bounds!.y).toBeGreaterThanOrEqual(8);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
});
