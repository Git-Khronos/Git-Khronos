import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.goto('/');
  await page.locator('.commit-row.stash-row').first().click();
  await expect(page.locator('.commit-panel .commit-file-list')).toBeVisible();
  await page.evaluate(() => {
    const root = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = root.git;
    const repository = git.repository();
    const stash = root.selectedStash();
    const file = { path: 'selected.txt', previousPath: 'old.txt', status: 'R100', additions: 1, deletions: 1 };
    const other = { path: 'other.txt', previousPath: null, status: 'M', additions: 1, deletions: 1 };
    git.commitDetails.update((details: any) => ({ ...details, oid: stash.oid, files: [file, other], filesTruncated: false }));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const state: any = { root, git, repository, stash, file, calls: [] };
    (window as any).__stashFile = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'inspect_stash_file') {
        return Promise.resolve({ oid: stash.oid, path: file.path, patch: '+saved change', truncated: false });
      }
      if (command === 'apply_stashed_file' && state.fail) {
        return Promise.reject({ message: 'The current file conflicts with the saved change.' });
      }
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      if (command === 'apply_stashed_file' || command === 'refresh_repository') return Promise.resolve(repository);
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
  });
}

test('a selected stash file is applied as a reviewed change while the stash and index are kept', async ({ page }) => {
  await prepare(page);
  const action = page.getByRole('button', { name: 'Apply selected stashed file…' });
  await expect(action).toBeDisabled();
  await page.getByRole('button', { name: 'Open diff for old.txt renamed to selected.txt' }).click();
  await expect(action).toBeEnabled();
  await action.click();
  const dialog = page.getByRole('dialog', { name: 'Apply stashed file' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog).toContainText('old.txt → selected.txt');
  await expect(dialog).toContainText('The index and stash stay unchanged');
  await dialog.getByRole('button', { name: 'Apply file and keep stash' }).click();
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(() => {
    const state = (window as any).__stashFile;
    return { call: state.calls.find((call: any) => call.command === 'apply_stashed_file'), stash: state.stash, repoId: state.repository.id };
  });
  expect(result.call).toEqual({ command: 'apply_stashed_file', args: {
    repoId: result.repoId, reference: result.stash.reference, expectedOid: result.stash.oid,
    path: 'selected.txt', previousPath: 'old.txt',
  } });
  await expect(action).toBeFocused();
});

test('the stash file context menu applies a change rather than restoring a commit snapshot', async ({ page }) => {
  await prepare(page);
  const file = page.getByRole('button', { name: 'Open diff for old.txt renamed to selected.txt' });
  await file.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('.commit-file-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Apply stashed changes for this file…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /from this commit/ })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Apply stashed changes for this file…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply stashed file' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(file).toBeFocused();
});

test('a shifted stash stack or changed repository cannot apply a captured file', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Open diff for old.txt renamed to selected.txt' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Apply stashed changes for this file…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply stashed file' });
  await page.evaluate(() => {
    const state = (window as any).__stashFile;
    state.git.repositories.set([{ ...state.repository, stashes: [
      { ...state.stash, oid: 'b'.repeat(40) }, { ...state.stash, reference: 'stash@{1}' },
    ] }]);
  });
  await dialog.getByRole('button', { name: 'Apply file and keep stash' }).click();
  await expect(dialog.getByRole('alert')).toContainText('stash list changed');
  expect(await page.evaluate(() => (window as any).__stashFile.calls.filter((call: any) => call.command === 'apply_stashed_file'))).toHaveLength(0);
  await page.evaluate(() => {
    const state = (window as any).__stashFile;
    state.git.repositories.set([state.repository, { ...state.repository, id: 'another-repository' }]);
    state.git.activeRepositoryId.set('another-repository');
  });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__stashFile.calls.filter((call: any) => call.command === 'apply_stashed_file'))).toHaveLength(0);
});

test('a refused patch leaves the review open with an actionable error', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Open diff for old.txt renamed to selected.txt' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Apply stashed changes for this file…' }).click();
  await page.evaluate(() => { (window as any).__stashFile.fail = true; });
  const dialog = page.getByRole('dialog', { name: 'Apply stashed file' });
  await dialog.getByRole('button', { name: 'Apply file and keep stash' }).click();
  await expect(dialog.getByRole('alert')).toContainText('current file conflicts');
  await expect(dialog).toBeVisible();
});
