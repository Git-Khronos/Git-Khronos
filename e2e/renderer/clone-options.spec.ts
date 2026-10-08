import { expect, test } from '@playwright/test';

const incomplete = {
  kind: 'submoduleCloneIncomplete',
  message: 'The repository was cloned, but some submodules could not be cloned. Git reported: fatal: repository not found',
  hint: 'Open /work/vendor-app and review its Submodules to retry the missing ones, or delete that folder and clone again.',
};

async function openCloneForm(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate((failure) => {
    (window as any).__cloneCalls = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'plugin:dialog|open') return Promise.resolve('/work');
      if (command === 'clone_repository') {
        (window as any).__cloneCalls.push(args);
        return Promise.reject(failure);
      }
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  }, incomplete);
  await page.locator('.new-tab').click();
  const dialog = page.getByRole('dialog', { name: 'Repository management' });
  await dialog.getByRole('tab', { name: 'Clone' }).click();
  await expect(dialog.getByRole('heading', { name: 'Clone a Repository' })).toBeVisible();
  await dialog.getByLabel('Repository URL').fill('https://example.test/team/vendor-app.git');
  await dialog.getByRole('button', { name: 'Browse' }).click();
  await expect(dialog.locator('input[name="cloneParent"]')).toHaveValue('/work');
  await expect(dialog.getByLabel('Folder name')).toHaveValue('vendor-app');
  return dialog;
}

test('clones without submodules unless the option is chosen', async ({ page }) => {
  const dialog = await openCloneForm(page);
  const submodules = dialog.getByRole('checkbox', { name: /Include submodules/ });
  await expect(submodules).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Clone the repo' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__cloneCalls.length)).toBe(1);
  const [call] = await page.evaluate(() => (window as any).__cloneCalls);
  expect(call).toMatchObject({ remote: 'https://example.test/team/vendor-app.git', parentPath: '/work', folder: 'vendor-app', recurseSubmodules: false, depth: null });
});

test('requests a recursive clone and explains a partly cloned superproject', async ({ page }) => {
  const dialog = await openCloneForm(page);
  const submodules = dialog.getByRole('checkbox', { name: /Include submodules/ });
  await submodules.check();
  await expect(dialog.getByText('Submodule history is not shortened')).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: /Shallow clone/ }).check();
  await expect(dialog.getByText(/Submodule history is not shortened/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Clone the repo' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__cloneCalls.length)).toBe(1);
  const [call] = await page.evaluate(() => (window as any).__cloneCalls);
  expect(call).toMatchObject({ recurseSubmodules: true, depth: 1 });
  await expect(page.getByRole('alert').filter({ hasText: incomplete.hint })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(submodules).toBeChecked();
  await expect(dialog.getByLabel('Repository URL')).toHaveValue('https://example.test/team/vendor-app.git');
});
