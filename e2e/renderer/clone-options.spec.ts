import { expect, test, type Page } from '@playwright/test';

const incomplete = {
  kind: 'submoduleCloneIncomplete',
  message: 'The repository was cloned, but some submodules could not be cloned. Git reported: fatal: repository not found',
  hint: 'Open /work/vendor-app and review its Submodules to retry the missing ones, or delete that folder and clone again.',
};

async function openCloneForm(page: Page, worktrees = false) {
  await page.goto(worktrees ? '/?worktree-tabs' : '/');
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

async function deferNativeCreation(page: Page, command: 'clone_repository' | 'initialize_repository', path: string) {
  await page.evaluate(({ command, path }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const bridge = (window as any).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    const snapshot = { ...app.git.repository(), id: 'owned-created-repository', name: path.split('/').at(-1), path };
    (window as any).__creationCalls = 0;
    bridge.invoke = (name: string, args: any) => {
      if (name !== command) return invoke(name, args);
      (window as any).__creationCalls++;
      return new Promise((resolve, reject) => {
        (window as any).__finishOwnedCreation = (failure?: string) => failure
          ? reject({ kind: 'ownedCreationFailure', message: failure }) : resolve(snapshot);
      });
    };
  }, { command, path });
}

async function finishNativeCreation(page: Page) {
  await page.evaluate(() => (window as any).__finishOwnedCreation());
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
}

async function creationState(page: Page, path: string) {
  return page.evaluate(path => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    return {
      recent: git.recentPaths().includes(path),
      saved: git.activeWorkspace().repositoryPaths.filter((item: string) => item === path).length,
      opened: git.repositories().some((repository: any) => repository.path === path),
      requests: (window as any).__creationCalls,
    };
  }, path);
}

for (const changeTab of [false, true]) {
  test(`closing a pending clone retains the native result without switching tabs (${changeTab ? 'new tab selection' : 'same tab'})`, async ({ page }) => {
    const dialog = await openCloneForm(page, true);
    const path = '/work/vendor-app';
    await deferNativeCreation(page, 'clone_repository', path);
    await dialog.getByRole('button', { name: 'Clone repository', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__finishOwnedCreation)).toBe('function');
    await dialog.getByRole('button', { name: 'Close repository management' }).click();
    await expect(dialog).toHaveCount(0);
    if (changeTab) await page.locator('.repo-tab-main').nth(1).click();
    const original = await page.locator('.status-repository-path').innerText();
    await finishNativeCreation(page);
    await expect(page.locator('.status-repository-path')).toHaveText(original);
    expect(await creationState(page, path)).toEqual({ recent: true, saved: 1, opened: false, requests: 1 });
  });
}

test('coming back to Clone does not revive the previous form visit', async ({ page }) => {
  const dialog = await openCloneForm(page, true);
  const path = '/work/vendor-app';
  await deferNativeCreation(page, 'clone_repository', path);
  await dialog.getByRole('button', { name: 'Clone repository', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishOwnedCreation)).toBe('function');
  const original = await page.locator('.status-repository-path').innerText();
  await dialog.getByRole('tab', { name: 'Initialize' }).click();
  await dialog.getByRole('tab', { name: 'Clone' }).click();
  await finishNativeCreation(page);
  await expect(dialog.getByText(`Cloned ${path}. Saved in`, { exact: false })).toHaveCount(0);
  await expect(page.locator('.status-repository-path')).toHaveText(original);
  expect(await creationState(page, path)).toEqual({ recent: true, saved: 1, opened: false, requests: 1 });
});

test('a successful clone opens exactly once while its requesting form is still current', async ({ page }) => {
  const dialog = await openCloneForm(page, true);
  const path = '/work/vendor-app';
  await deferNativeCreation(page, 'clone_repository', path);
  await dialog.getByRole('button', { name: 'Clone repository', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishOwnedCreation)).toBe('function');
  await finishNativeCreation(page);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.status-repository-path')).toHaveText(path);
  expect(await creationState(page, path)).toEqual({ recent: true, saved: 1, opened: true, requests: 1 });
});

test('initialization completed after close does not take over a reopened manager', async ({ page }) => {
  const dialog = await openCloneForm(page, true);
  const path = '/work/owned-init';
  await dialog.getByRole('tab', { name: 'Initialize' }).click();
  await dialog.getByLabel('Repository name').fill('owned-init');
  await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(dialog.locator('.repository-destination')).toContainText(path);
  await deferNativeCreation(page, 'initialize_repository', path);
  await dialog.getByRole('button', { name: 'Create repository', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishOwnedCreation)).toBe('function');
  const original = await page.locator('.status-repository-path').innerText();
  await dialog.getByRole('button', { name: 'Close repository management' }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.new-tab').click();
  await expect(dialog).toBeVisible();
  await finishNativeCreation(page);
  await expect(dialog.getByRole('button', { name: `Open owned-init at ${path}`, exact: true })).toBeVisible();
  await expect(page.locator('.status-repository-path')).toHaveText(original);
  expect(await creationState(page, path)).toEqual({ recent: true, saved: 1, opened: false, requests: 1 });
});

test('a retired clone failure is recorded without taking over a replacement dialog', async ({ page }) => {
  const dialog = await openCloneForm(page, true);
  const path = '/work/vendor-app';
  await deferNativeCreation(page, 'clone_repository', path);
  await dialog.getByRole('button', { name: 'Clone repository', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishOwnedCreation)).toBe('function');
  await dialog.getByRole('button', { name: 'Close repository management' }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.new-tab').click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as any).__finishOwnedCreation('Owned native clone failure'));
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
  await expect(dialog).toBeVisible();
  expect(await creationState(page, path)).toEqual({ recent: false, saved: 0, opened: false, requests: 1 });
  expect(await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const outcome = git.activityLogs().find((activity: any) => activity.description === 'Cloning vendor-app');
    return { error: git.error(), status: outcome?.status, detail: outcome?.detail };
  })).toEqual({ error: null, status: 'error', detail: 'Owned native clone failure' });
});

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
