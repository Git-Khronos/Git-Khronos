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
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
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

async function checkoutFixture(page: Page) {
  return page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const snapshot = git.repository();
    const target = snapshot.commits.find((commit: any) => commit.subject === 'Polish repository activity drawer');
    const calls: { command: string; args: unknown }[] = [];
    (window as any).__checkoutCommitCalls = calls;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      calls.push({ command, args });
      if (command === 'checkout_commit') return { ...snapshot, headOid: target.oid,
        status: { ...snapshot.status, branch: null } };
      return snapshot;
    } };
    return { head: snapshot.headOid, branch: snapshot.status.branch, oid: target.oid, id: snapshot.id, path: snapshot.path };
  });
}

test('explicit commit checkout explains detached HEAD and sends the reviewed selection once', async ({ page }) => {
  const fixture = await checkoutFixture(page);
  const { menu } = await openCommitMenu(page);
  await menu.getByRole('menuitem', { name: 'Checkout this commit', exact: true }).click();
  const review = page.getByRole('alertdialog', { name: commitSubject });
  await expect(review).toBeVisible();
  await expect(review).toContainText('detached HEAD');
  await expect(review).toContainText(fixture.path);
  await expect(review).toContainText(fixture.oid.slice(0, 8));
  await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__checkoutCommitCalls.filter((call: any) => call.command === 'checkout_commit'))).toEqual([]);
  await review.getByRole('button', { name: 'Check out detached HEAD', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__checkoutCommitCalls.filter((call: any) => call.command === 'checkout_commit')))
    .toEqual([{ command: 'checkout_commit', args: { repoId: fixture.id, oid: fixture.oid, expectedHeadOid: fixture.head, expectedBranch: fixture.branch } }]);
});

test('cancel and a same-tip branch change cannot trigger a detached checkout', async ({ page }) => {
  const fixture = await checkoutFixture(page);
  const first = await openCommitMenu(page);
  await first.menu.getByRole('menuitem', { name: 'Checkout this commit', exact: true }).click();
  const review = page.getByRole('alertdialog', { name: commitSubject });
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(first.trigger).toBeFocused();
  const { menu } = await openCommitMenu(page);
  await menu.getByRole('menuitem', { name: 'Checkout this commit', exact: true }).click();
  await page.evaluate(fixture => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.repositories.update((items: any[]) => items.map(repo => repo.id === fixture.id
      ? { ...repo, status: { ...repo.status, branch: 'switched-at-same-tip' } } : repo));
  }, fixture);
  await expect(review.getByRole('alert')).toContainText('changed');
  await expect(review.getByRole('button', { name: 'Check out detached HEAD', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__checkoutCommitCalls.filter((call: any) => call.command === 'checkout_commit'))).toEqual([]);
});

test('copying a commit SHA closes its menu and returns keyboard focus', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
  });
  const { menu, trigger } = await openCommitMenu(page);
  await menu.getByRole('menuitem', { name: 'Copy commit SHA', exact: true }).press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
