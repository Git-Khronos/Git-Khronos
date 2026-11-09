import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.repositories.update((items: any[]) => items.map((item) => ({ ...item,
      lfs: { available: true, enabled: true, version: 'git-lfs/3.7.1', trackedFiles: 2 } })));
    const fixture = { calls: [] as any[], listFail: false, lockFail: false, unlockFail: false,
      locks: [
        { id: '7', path: 'art/mine.psd', owner: 'Tester', lockedAt: '2026-01-02T03:04:05Z', ours: true },
        { id: '9', path: 'art/theirs.psd', owner: 'Ada', lockedAt: '2026-01-03T03:04:05Z', ours: false },
      ] as any[] };
    (window as any).__lfsLocks = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'lfs_tracking_rules') return Promise.resolve({ patterns: [], state: 'state', rootAttributes: '' });
      if (command === 'lfs_locks') {
        if (fixture.listFail) return Promise.reject({ kind: 'lfsLocksUnavailable', message: 'Git LFS could not list file locks from the server.', hint: 'Check the LFS endpoint.' });
        return Promise.resolve({ locks: fixture.locks });
      }
      if (command === 'lfs_lock_file') {
        if (fixture.lockFail) return Promise.reject({ kind: 'lfsLockPathNotTracked', message: 'Only files tracked by Git can be locked.' });
        fixture.locks = [...fixture.locks, { id: '11', path: args.file, owner: 'Tester', lockedAt: '2026-01-04T00:00:00Z', ours: true }];
        return Promise.resolve(git.repository());
      }
      if (command === 'lfs_unlock_file') {
        if (fixture.unlockFail) return Promise.reject({ kind: 'lfsUnlockDirtyFile', message: 'art/mine.psd has uncommitted changes, so the lock was kept.' });
        fixture.locks = fixture.locks.filter((lock) => lock.id !== args.lock.id);
        return Promise.resolve(git.repository());
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
}

async function openLocks(page: Page) {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await page.getByRole('button', { name: 'Manage tracking patterns…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await dialog.getByText('File locks on the LFS server', { exact: true }).click();
  return dialog;
}

const calls = (page: Page) => page.evaluate(() => (window as any).__lfsLocks.calls.map((call: any) => call.command));

test('locks load only on request and distinguish own from collaborator locks', async ({ page }) => {
  await setup(page);
  const dialog = await openLocks(page);
  expect(await calls(page)).not.toContain('lfs_locks');
  await dialog.getByRole('button', { name: 'Load locks', exact: true }).click();
  const list = dialog.getByRole('list', { name: 'LFS file locks' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('Locked by you');
  await expect(list).toContainText('Locked by Ada');
  await expect(dialog.locator('.lock-result')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Unlock art/mine.psd', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Unlock art/theirs.psd', exact: true })).toHaveCount(0);
});

test('lock and unlock own files, then reload the server list', async ({ page }) => {
  await setup(page);
  const dialog = await openLocks(page);
  await dialog.getByLabel('Tracked file to lock').fill('art/new.psd');
  await dialog.getByRole('button', { name: 'Lock file', exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'LFS file locks' })).toContainText('art/new.psd');
  await expect(dialog.getByText(/^Locked art\/new\.psd\./)).toBeFocused();
  await expect(dialog.getByLabel('Tracked file to lock')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Unlock art/mine.psd', exact: true }).click();
  await expect(dialog.getByText('Unlocked art/mine.psd.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'LFS file locks' }).getByRole('listitem')).toHaveCount(2);
  const unlock = await page.evaluate(() => (window as any).__lfsLocks.calls.find((call: any) => call.command === 'lfs_unlock_file').args);
  expect(unlock.force).toBe(false);
  expect(unlock.lock.id).toBe('7');
});

test('force unlock requires an explicit warning review and can be declined', async ({ page }) => {
  await setup(page);
  const dialog = await openLocks(page);
  await dialog.getByRole('button', { name: 'Load locks', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review force unlock of art/theirs.psd', exact: true }).click();
  await expect(dialog).toContainText('Ada holds this lock');
  await expect(dialog.getByRole('button', { name: 'Force unlock', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep lock', exact: true }).click();
  expect(await calls(page)).not.toContain('lfs_unlock_file');
  await dialog.getByRole('button', { name: 'Review force unlock of art/theirs.psd', exact: true }).click();
  await dialog.getByRole('button', { name: 'Force unlock', exact: true }).click();
  await expect(dialog.getByText(/^Broke the lock on art\/theirs\.psd\. Tell Ada/)).toBeVisible();
  const unlock = await page.evaluate(() => (window as any).__lfsLocks.calls.find((call: any) => call.command === 'lfs_unlock_file').args);
  expect(unlock.force).toBe(true);
});

test('server and dirty-file refusals are announced and keep the lock list unchanged', async ({ page }) => {
  await setup(page);
  const dialog = await openLocks(page);
  await page.evaluate(() => { (window as any).__lfsLocks.listFail = true; });
  await dialog.getByRole('button', { name: 'Load locks', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not list file locks');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await page.evaluate(() => { const fixture = (window as any).__lfsLocks; fixture.listFail = false; fixture.unlockFail = true; });
  await dialog.getByRole('button', { name: 'Load locks', exact: true }).click();
  await dialog.getByRole('button', { name: 'Unlock art/mine.psd', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('uncommitted changes, so the lock was kept');
  await expect(dialog.getByRole('list', { name: 'LFS file locks' }).getByRole('listitem')).toHaveCount(2);
});
