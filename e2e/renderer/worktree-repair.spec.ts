import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    app.worktreesOpen.set(true);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.repositories.update((items: any[]) => items.map((item) => ({ ...item,
      worktrees: item.worktrees.map((worktree: any) => !worktree.current
        ? { ...worktree, prunable: true, statusLoaded: false } : worktree) })));
    const fixture = { calls: [] as any[], fail: false, hold: false, finish: null as any };
    (window as any).__worktreeRepair = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'repair_worktree') {
        if (fixture.fail) return Promise.reject({ kind: 'unrelatedWorktree',
          message: 'That directory does not belong to the selected missing worktree. Choose its actual directory.' });
        const snapshot = () => ({ ...git.repository(), worktrees: git.repository().worktrees.map((worktree: any) =>
          worktree.path === args.request.path ? { ...worktree, path: args.request.actualPath, prunable: false, statusLoaded: true } : worktree) });
        if (fixture.hold) return new Promise((resolve) => { fixture.finish = () => resolve(snapshot()); });
        return Promise.resolve(snapshot());
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
}

async function openRepair(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Move linked worktree…', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Repair after external move…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Repair moved worktree' })).toBeVisible();
}

test('repair missing worktree explains registration-only scope and pins selected identity', async ({ page }) => {
  await setup(page);
  await openRepair(page);
  const dialog = page.getByRole('dialog', { name: 'Repair moved worktree' });
  await expect(dialog).toContainText('No files are moved or deleted');
  await expect(dialog).toContainText('no registration is pruned');
  await expect(dialog).toContainText('not a copy or another worktree');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Repair registration', exact: true })).toBeDisabled();
  await dialog.getByLabel('Actual moved worktree directory').fill('/workspace/reconnected');
  await dialog.getByRole('button', { name: 'Repair registration', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => (window as any).__worktreeRepair.calls.find((entry: any) => entry.command === 'repair_worktree'));
  expect(call.args).toEqual({ repoId: expect.any(String), request: {
    path: expect.any(String), actualPath: '/workspace/reconnected',
    expectedOid: expect.stringMatching(/^[a-f0-9]{40}$/), expectedBranch: 'feature/partial-staging',
  } });
  await expect(page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true })).toBeFocused();
});

test('unrelated repair target retains directory choice and focuses actionable native refusal', async ({ page }) => {
  await setup(page);
  await openRepair(page);
  const dialog = page.getByRole('dialog', { name: 'Repair moved worktree' });
  await dialog.getByLabel('Actual moved worktree directory').fill('/workspace/unrelated');
  await page.evaluate(() => { (window as any).__worktreeRepair.fail = true; });
  await dialog.getByRole('button', { name: 'Repair registration', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('does not belong');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByLabel('Actual moved worktree directory')).toHaveValue('/workspace/unrelated');
});

test('repair dialog is keyboard-contained in compact layout and has a visible escape route', async ({ page }) => {
  await setup(page);
  await openRepair(page);
  await page.setViewportSize({ width: 900, height: 640 });
  const dialog = page.getByRole('dialog', { name: 'Repair moved worktree' });
  await dialog.getByLabel('Actual moved worktree directory').fill('/workspace/reconnected');
  const confirm = dialog.getByRole('button', { name: 'Repair registration', exact: true });
  await confirm.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Actual moved worktree directory')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open left panel', exact: true })).toBeFocused();
});

test('repair blocks edits and dismissal until native links are verified', async ({ page }) => {
  await setup(page);
  await openRepair(page);
  const dialog = page.getByRole('dialog', { name: 'Repair moved worktree' });
  await dialog.getByLabel('Actual moved worktree directory').fill('/workspace/reconnected');
  await page.evaluate(() => { (window as any).__worktreeRepair.hold = true; });
  await dialog.getByRole('button', { name: 'Repair registration', exact: true }).click();
  await expect(dialog.getByLabel('Actual moved worktree directory')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Repairing…' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => { (window as any).__worktreeRepair.finish(); });
  await expect(dialog).toHaveCount(0);
});

test('repository switch prevents repairing an old repository registration', async ({ page }) => {
  await setup(page);
  await openRepair(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
  });
  const dialog = page.getByRole('dialog', { name: 'Repair moved worktree' });
  await dialog.getByLabel('Actual moved worktree directory').fill('/workspace/reconnected');
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.getByRole('button', { name: 'Repair registration', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__worktreeRepair.calls.some((entry: any) => entry.command === 'repair_worktree'))).toBe(false);
});

test('locked and open missing registrations cannot be repaired from their menu', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => items.map((item) => ({ ...item,
      worktrees: item.worktrees.map((worktree: any) => !worktree.current ? { ...worktree, locked: true } : worktree) })));
  });
  const actions = page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true });
  await actions.click();
  await expect(page.getByRole('menuitem', { name: 'Repair after external move…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const snapshot = git.repository();
    const worktree = snapshot.worktrees.find((item: any) => !item.current);
    git.repositories.update((items: any[]) => [...items.map((item) => ({ ...item,
      worktrees: item.worktrees.map((tree: any) => ({ ...tree, locked: false })) })),
      { ...snapshot, id: 'old-tab', path: worktree.path }]);
  });
  await actions.click();
  await expect(page.getByRole('menuitem', { name: 'Repair after external move…', exact: true })).toBeDisabled();
});
