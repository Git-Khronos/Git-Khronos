import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, options: { empty?: boolean; fail?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate((options) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.repositories.update((items: any[]) => items.map((item) => ({ ...item,
      lfs: { available: true, enabled: true, version: 'git-lfs/3.7.1', trackedFiles: 2 } })));
    const fixture = { calls: [] as any[] };
    (window as any).__lfsPrune = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'lfs_prune_preview') {
        if (options.fail) return Promise.reject({ kind: 'unsafeLfsPrune', message: 'LFS storage outside this repository\'s Git directory may be shared with other repositories.', hint: 'Nothing was removed.' });
        return Promise.resolve(options.empty
          ? { objects: [], totalSize: 0, remaining: 0, referenced: 4, recent: 1 }
          : { objects: [{ oid: 'a'.repeat(64), size: 2048 }, { oid: 'b'.repeat(64), size: 3 * 1024 * 1024 }], totalSize: 2048 + 3 * 1024 * 1024, remaining: 0, referenced: 7, recent: 1 });
      }
      if (command === 'lfs_prune_objects' || command === 'lfs_prune') {
        return Promise.resolve(git.repositories().find((repository: any) => repository.id === args.repoId));
      }
      return Promise.resolve(null);
    } };
  }, options);
}

async function openClean(page: Page) {
  const lfsOptions = page.getByRole('button', { name: 'Git LFS options' });
  await lfsOptions.click();
  await page.getByRole('menuitem', { name: /Clean LFS storage/ }).click();
  return { lfsOptions, dialog: page.getByRole('alertdialog', { name: 'Remove unreferenced LFS objects?' }) };
}

const calls = (page: Page) => page.evaluate(() => (window as any).__lfsPrune.calls.map((call: any) => call.command));

test('reviews exact unreferenced LFS objects before removing only that batch', async ({ page }) => {
  await setup(page);
  const { lfsOptions, dialog } = await openClean(page);
  await expect(dialog).toContainText('2 objects · 3.0 MiB');
  await expect(dialog).toContainText('not referenced by any Git object');
  const list = dialog.getByRole('list', { name: 'Reviewed unreferenced LFS objects' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('aaaaaaaaaaaa');
  await expect(list).toContainText('2.0 KiB');
  await expect(dialog).toContainText('Kept: 7 referenced, 1 written in the last hour');
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const remove = dialog.getByRole('button', { name: 'Remove 2 Objects' });
  await expect(cancel).toBeFocused();
  await expect(remove).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(lfsOptions).toBeFocused();
  expect(await calls(page)).toEqual(['lfs_prune_preview']);

  const reopened = await openClean(page);
  await reopened.dialog.getByRole('button', { name: 'Remove 2 Objects' }).click();
  await expect(reopened.dialog).toHaveCount(0);
  const commands = await calls(page);
  expect(commands).toContain('lfs_prune_objects');
  expect(commands).not.toContain('lfs_prune');
  const removal = await page.evaluate(() => (window as any).__lfsPrune.calls.find((call: any) => call.command === 'lfs_prune_objects').args);
  expect(removal.preview.objects).toHaveLength(2);
  await expect(page.locator('.activity-status')).toContainText('Reviewed unreferenced LFS objects removed');
});

test('nothing to remove keeps removal disabled and retention prune behind an explicit advanced action', async ({ page }) => {
  await setup(page, { empty: true });
  const { dialog } = await openClean(page);
  await expect(dialog).toContainText('Nothing to remove.');
  await expect(dialog.getByRole('button', { name: 'Remove Objects' })).toBeDisabled();
  const advanced = dialog.getByText('Advanced: Git LFS retention prune');
  await expect(dialog.getByRole('button', { name: 'Run git lfs prune' })).toBeHidden();
  await advanced.click();
  await expect(dialog).toContainText('reflogs do not protect them');
  await dialog.getByRole('button', { name: 'Run git lfs prune' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await calls(page)).toEqual(['lfs_prune_preview', 'lfs_prune']);
});

test('a refused review closes without removing anything and explains why', async ({ page }) => {
  await setup(page, { fail: true });
  const { dialog } = await openClean(page);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('may be shared with other repositories');
  expect(await calls(page)).toEqual(['lfs_prune_preview']);
});
