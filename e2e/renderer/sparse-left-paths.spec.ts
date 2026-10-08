import { expect, test } from '@playwright/test';

const left = { kind: 'sparsePathsLeft',
  message: 'The directory selection was applied, but Git kept 2 path(s) outside it because they have local changes or conflicts: docs/guide.md, docs/notes.md.',
  hint: 'Commit, stash, discard or resolve those paths, then choose Reapply. Nothing was deleted.' };

test('sparse selection names changed paths Git kept outside it and refreshes state', async ({ page }) => {
  await page.goto('/?sparse-preview');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.evaluate((left) => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const calls: any[] = (window as any).__sparseCalls = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      calls.push({ command, args });
      if (command === 'sparse_checkout_set' || command === 'sparse_checkout_reapply') return Promise.reject(left);
      if (command === 'refresh_repository') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  }, left);
  await page.getByRole('button', { name: 'Sparse checkout options' }).click();
  await page.getByRole('menuitem', { name: /Edit directories/ }).click();
  await page.getByRole('button', { name: 'Update Directories' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Apply this directory selection?' });
  await expect(confirmation).toContainText('Changed or conflicted files stay and are listed.');
  await confirmation.getByRole('button', { name: 'Apply Selection' }).click();
  const alert = page.getByRole('alert').filter({ hasText: left.hint });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('docs/guide.md, docs/notes.md');
  const calls = await page.evaluate(() => (window as any).__sparseCalls.map((call: any) => call.command));
  expect(calls).toContain('sparse_checkout_set');
  expect(calls).toContain('refresh_repository');
});

test('stage all discloses changed paths outside the sparse selection and shows Git status', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  const skipped = { kind: 'sparsePathsNotStaged',
    message: 'Other changes were staged, but Git left 1 changed path(s) outside the sparse checkout selection unstaged: docs/guide.md.',
    hint: 'Add their directories to the sparse checkout selection and stage again, or restore those files.' };
  await page.evaluate((skipped) => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const status = git.repository().status;
    const actual = { ...status, entries: status.entries.map((entry: any, index: number) => index ? entry : { ...entry, path: 'docs/guide.md' }) };
    const calls: any[] = (window as any).__sparseCalls = [];
    (window as any).__actualStatus = actual;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      calls.push({ command, args });
      if (command === 'stage_all') return Promise.reject(skipped);
      if (command === 'refresh_repository_status') return Promise.resolve(actual);
      if (command === 'refresh_repository') return Promise.resolve({ ...git.repository(), status: actual });
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  }, skipped);
  await page.getByRole('button', { name: 'Stage all changes', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: skipped.hint });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('docs/guide.md');
  const result = await page.evaluate(() => ({
    commands: (window as any).__sparseCalls.map((call: any) => call.command),
    paths: (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().status.entries.map((entry: any) => entry.path),
  }));
  expect(result.commands).toEqual(expect.arrayContaining(['stage_all', 'refresh_repository_status']));
  expect(result.paths).toContain('docs/guide.md');
});
