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
  await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(dialog.locator('input[name="cloneParent"]')).toHaveValue('/work');
  await expect(dialog.getByLabel('Folder name')).toHaveValue('vendor-app');
  await expect(dialog.getByText('Destination', { exact: true })).toBeVisible();
  await expect(dialog.locator('.repository-destination')).toContainText('/work/vendor-app');
  await expect(dialog.getByRole('group', { name: 'Clone options' })).toBeVisible();
  await expect(dialog.locator('.form-readiness')).toHaveText('Ready to clone');
  return dialog;
}

test('clones without submodules unless the option is chosen', async ({ page }) => {
  const dialog = await openCloneForm(page);
  const submodules = dialog.getByRole('checkbox', { name: /Include submodules/ });
  await expect(submodules).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Clone repository', exact: true }).click();
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
  await dialog.getByRole('button', { name: 'Clone repository', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__cloneCalls.length)).toBe(1);
  const [call] = await page.evaluate(() => (window as any).__cloneCalls);
  expect(call).toMatchObject({ recurseSubmodules: true, depth: 1 });
  await expect(page.getByRole('alert').filter({ hasText: incomplete.hint })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(submodules).toBeChecked();
  await expect(dialog.getByLabel('Repository URL')).toHaveValue('https://example.test/team/vendor-app.git');
});

for (const retire of ['close then reopen', 'switch away and back', 'start a newer picker'] as const) {
  test(`a retired clone folder picker cannot replace the destination after ${retire}`, async ({ page }) => {
    const dialog = await openCloneForm(page);
    await page.evaluate(() => {
      const bridge = (window as any).__TAURI_INTERNALS__;
      const invoke = bridge.invoke;
      const replies: Array<(path: string) => void> = [];
      (window as any).__cloneFolderReplies = replies;
      bridge.invoke = (command: string, args: any) => command === 'plugin:dialog|open'
        ? new Promise<string>(resolve => replies.push(resolve)) : invoke(command, args);
    });
    const browse = dialog.getByRole('button', { name: 'Browse', exact: true });
    const parent = dialog.locator('input[name="cloneParent"]');
    const wait = (count: number) => expect.poll(() => page.evaluate(() => (window as any).__cloneFolderReplies.length)).toBe(count);
    const reply = (index: number, path: string) => page.evaluate(({ index, path }) => {
      (window as any).__cloneFolderReplies[index](path);
    }, { index, path });
    await browse.click();
    await wait(1);
    if (retire === 'close then reopen') {
      await dialog.getByRole('button', { name: 'Close repository management' }).click();
      await expect(dialog).toHaveCount(0);
      await page.locator('.new-tab').click();
      await dialog.getByRole('tab', { name: 'Clone', exact: true }).click();
    } else if (retire === 'switch away and back') {
      await dialog.getByRole('tab', { name: 'Initialize', exact: true }).click();
      await dialog.getByRole('tab', { name: 'Clone', exact: true }).click();
    }
    if (retire !== 'switch away and back') {
      await browse.click();
      await wait(2);
      await reply(1, '/owned/current-destination');
      await expect(parent).toHaveValue('/owned/current-destination');
    }
    await reply(0, '/owned/retired-destination');
    // Flush the old native promise and Angular rendering before inspecting it.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const expected = retire === 'switch away and back' ? '/work' : '/owned/current-destination';
    await expect(parent).toHaveValue(expected);
    await dialog.getByRole('button', { name: 'Clone repository', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__cloneCalls.map((call: any) => call.parentPath)))
      .toEqual([expected]);
  });
}

test('a picker error from a closed init form does not appear in a replacement clone form', async ({ page }) => {
  const dialog = await openCloneForm(page);
  await dialog.getByRole('tab', { name: 'Initialize', exact: true }).click();
  await page.evaluate(() => {
    const bridge = (window as any).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    bridge.invoke = (command: string, args: any) => command === 'plugin:dialog|open'
      ? new Promise((_resolve, reject) => { (window as any).__rejectInitPicker = reject; }) : invoke(command, args);
  });
  await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__rejectInitPicker)).toBe('function');
  await dialog.getByRole('button', { name: 'Close repository management' }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.new-tab').click();
  await dialog.getByRole('tab', { name: 'Clone', exact: true }).click();
  await page.evaluate(() => {
    (window as any).__rejectInitPicker(new Error('Owned retired destination picker failed'));
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(dialog.locator('input[name="cloneParent"]')).toHaveValue('/work');
  await expect(page.getByText('Owned retired destination picker failed')).toHaveCount(0);
});
