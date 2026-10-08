import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    (window as any).__stashCalls = [];
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        (window as any).__stashCalls.push({ command, args });
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        if (['stash_selected', 'apply_stash_options', 'branch_from_stash', 'stash_checkout', 'refresh_repository'].includes(command)) {
          return Promise.resolve(git.repository());
        }
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

test('selected stash options disclose staged state and send only chosen paths', async ({ page }) => {
  const path = 'apps/desktop/src/app/app.component.html';
  const opener = page.getByRole('button', { name: 'Working directory options', exact: true });
  await opener.click();
  await page.getByRole('menuitem', { name: /^Stash with options/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash with options' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByLabel('Message (optional)').fill('Selected work');
  await dialog.getByLabel('What to save').selectOption('keep-index');
  await expect(dialog).toContainText('staged contents remain');
  await dialog.getByLabel('Include untracked files').uncheck();
  await dialog.getByText('Choose specific files', { exact: true }).click();
  await dialog.getByLabel('Save only selected files').check();
  await expect(dialog.getByRole('button', { name: 'Create stash' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: `Stash ${path}`, exact: true }).check();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).stashDialog().returnFocus
    === document.querySelector('[aria-label="Working directory options"]'))).toBe(true);
  await dialog.getByRole('button', { name: 'Create stash' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__stashCalls.find((call: any) => call.command === 'stash_selected')))
    .toEqual({ command: 'stash_selected', args: { repoId: expect.any(String), options: {
      mode: 'keep-index', includeUntracked: false, paths: [path], message: 'Selected work',
    } } });
  await expect(opener).toBeFocused();
});

test('staged-only mode excludes untracked files and keeps escape inside the workflow', async ({ page }) => {
  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Stash with options/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash with options' });
  await dialog.getByLabel('What to save').selectOption('staged-only');
  await expect(dialog.getByLabel('Include untracked files')).not.toBeChecked();
  await expect(dialog.getByLabel('Include untracked files')).toBeDisabled();
  await expect(dialog).toContainText('overlapping changes may be refused');
  await dialog.getByRole('button', { name: 'Create stash' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Message (optional)')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('apply options restore the index using the selected immutable stash', async ({ page }) => {
  const row = page.locator('.commit-row.stash-row').first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Apply with staged-state options…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply stash' });
  await expect(dialog.getByLabel('Restore which changes were staged')).toBeChecked();
  await expect(dialog).toContainText('The stash is kept');
  await dialog.getByRole('button', { name: 'Apply and keep stash' }).click();
  const result = await page.evaluate(() => ({
    call: (window as any).__stashCalls.find((call: any) => call.command === 'apply_stash_options'),
    stash: (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().stashes[0],
  }));
  expect(result.call).toEqual({ command: 'apply_stash_options', args: {
    repoId: expect.any(String), reference: result.stash.reference, expectedOid: result.stash.oid, restoreIndex: true,
  } });
});

test('stash branch recovery requires a clean working directory', async ({ page }) => {
  await page.locator('.commit-row.stash-row').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create branch from stash…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create branch from stash' });
  await dialog.getByLabel('New branch name').fill('recover/my-work');
  await expect(dialog.getByRole('button', { name: 'Create branch and restore' })).toBeDisabled();
  await expect(dialog).toContainText('Requires a clean working directory');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((repos: any[]) => repos.map(repo => ({
      ...repo, status: { ...repo.status, entryCount: 0, entries: [], staged: 0, unstaged: 0, untracked: 0 },
    })));
  });
  await dialog.getByRole('button', { name: 'Create branch and restore' }).click();
  expect(await page.evaluate(() => (window as any).__stashCalls.find((call: any) => call.command === 'branch_from_stash').args.name))
    .toBe('recover/my-work');
});

test('stash-and-switch is explicit and leases both branch tips', async ({ page }) => {
  await page.getByLabel('Local branch feature/partial-staging', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Stash changes and checkout…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash and switch branch' });
  await expect(dialog).toContainText('does not automatically apply');
  await dialog.getByRole('button', { name: 'Stash and checkout' }).click();
  const args = await page.evaluate(() => (window as any).__stashCalls.find((call: any) => call.command === 'stash_checkout').args);
  expect(args).toMatchObject({ name: 'feature/partial-staging', expectedHead: expect.stringMatching(/^[0-9a-f]{40}$/),
    expectedTarget: expect.stringMatching(/^[0-9a-f]{40}$/) });
});
