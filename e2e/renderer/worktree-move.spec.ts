import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    app.worktreesOpen.set(true);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { calls: [] as any[], fail: false, hold: false, finish: null as any };
    (window as any).__worktreeMove = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'move_worktree') {
        if (fixture.fail) return Promise.reject({ kind: 'staleWorktree',
          message: 'The selected worktree HEAD changed. Close this dialog, refresh and review again.' });
        const snapshot = () => ({ ...git.repository(), worktrees: git.repository().worktrees.map((worktree: any) =>
          worktree.path === args.request.path ? { ...worktree, path: `${args.request.parentPath}/${args.request.folder}` } : worktree) });
        if (fixture.hold) return new Promise((resolve) => { fixture.finish = () => resolve(snapshot()); });
        return Promise.resolve(snapshot());
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
}

async function openMove(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move linked worktree…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Move linked worktree' })).toBeVisible();
}

test('worktree move reviews destination and sends selected HEAD and branch without force', async ({ page }) => {
  await setup(page);
  await openMove(page);
  const dialog = page.getByRole('dialog', { name: 'Move linked worktree' });
  await expect(dialog).toContainText('staged, unstaged, untracked and ignored files');
  await expect(dialog).toContainText('No force option is used');
  await expect(dialog.getByRole('button', { name: 'Move worktree', exact: true })).toBeDisabled();
  await dialog.getByLabel('Destination parent directory').fill('/workspace');
  await dialog.getByLabel('New folder name').fill('moved topic');
  await expect(dialog).toContainText('/workspace/moved topic');
  await dialog.getByRole('button', { name: 'Move worktree', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => (window as any).__worktreeMove.calls.find((entry: any) => entry.command === 'move_worktree'));
  expect(call.args).toEqual({ repoId: expect.any(String), request: {
    path: expect.any(String), parentPath: '/workspace', folder: 'moved topic',
    expectedOid: expect.stringMatching(/^[a-f0-9]{40}$/), expectedBranch: 'feature/partial-staging',
  } });
  await expect(page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true })).toBeFocused();
});

test('failed move keeps destination and focuses native refusal for recovery', async ({ page }) => {
  await setup(page);
  await openMove(page);
  const dialog = page.getByRole('dialog', { name: 'Move linked worktree' });
  await dialog.getByLabel('New folder name').fill('chosen folder');
  await page.evaluate(() => { (window as any).__worktreeMove.fail = true; });
  await dialog.getByRole('button', { name: 'Move worktree', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('HEAD changed');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByLabel('New folder name')).toHaveValue('chosen folder');
});

test('compact move dialog traps focus and returns opener focus after cancel', async ({ page }) => {
  await setup(page);
  await openMove(page);
  await page.setViewportSize({ width: 900, height: 640 });
  const dialog = page.getByRole('dialog', { name: 'Move linked worktree' });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByLabel('New folder name').fill('next');
  const confirm = dialog.getByRole('button', { name: 'Move worktree', exact: true });
  await confirm.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Destination parent directory')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open left panel', exact: true })).toBeFocused();
});

test('moving blocks dismissal and changes until native completion', async ({ page }) => {
  await setup(page);
  await openMove(page);
  const dialog = page.getByRole('dialog', { name: 'Move linked worktree' });
  await dialog.getByLabel('New folder name').fill('next');
  await page.evaluate(() => { (window as any).__worktreeMove.hold = true; });
  await dialog.getByRole('button', { name: 'Move worktree', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Moving…' })).toBeDisabled();
  await expect(dialog.getByLabel('Destination parent directory')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => { (window as any).__worktreeMove.finish(); });
  await expect(dialog).toHaveCount(0);
});

test('repository switch prevents old worktree move submission', async ({ page }) => {
  await setup(page);
  await openMove(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
  });
  const dialog = page.getByRole('dialog', { name: 'Move linked worktree' });
  await dialog.getByLabel('New folder name').fill('not moved');
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.getByRole('button', { name: 'Move worktree', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__worktreeMove.calls.some((entry: any) => entry.command === 'move_worktree'))).toBe(false);
});

test('locked worktree move is unavailable from its contextual menu', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => items.map((item) => ({ ...item,
      worktrees: item.worktrees.map((worktree: any) => !worktree.current ? { ...worktree, locked: true } : worktree) })));
  });

  await page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Move linked worktree…', exact: true })).toBeDisabled();
});

test('open worktree tab disables moving and explains the required close action', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const snapshot = git.repository();
    const worktree = snapshot.worktrees.find((item: any) => !item.current);
    git.repositories.update((items: any[]) => [...items, { ...snapshot, id: 'linked-tab', path: worktree.path }]);
  });
  await page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Move linked worktree…', exact: true })).toBeDisabled();
  await expect(page.locator('.worktree-card-menu')).toContainText('Close its repository tab before moving');
});
