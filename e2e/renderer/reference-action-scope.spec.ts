import { expect, test } from '@playwright/test';

const actions = ['push-tag', 'delete-tag', 'delete-remote-tag', 'delete-remote-branch', 'rename-tag', 'rename-remote-branch'];
const writes = ['transport_reference', 'manage_reference', 'rename_reference'];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const repository = git.repository();
    const state: any = { app, git, repository, calls: [] };
    (window as any).__refScope = state;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === state.hold) return new Promise(resolve => { state.finish = () => resolve(command === 'preview_remote_tag' ? 'b'.repeat(40) : repository); });
      if (command === 'preview_remote_tag') return Promise.resolve('b'.repeat(40));
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.resolve(repository);
    } };
    state.open = (action: string) => {
      const request = { action, repositoryId: repository.id, repositoryPath: repository.path,
        name: action.includes('branch') ? 'feature/search' : 'v0.1.0', oid: 'a'.repeat(40), remote: 'origin', returnFocus: null };
      app.referenceAction.set(request); return request;
    };
    state.change = (kind: string) => {
      if (kind === 'repository') {
        const other = { ...repository, id: 'ref-scope-B', path: '/owned/ref-scope-B' };
        git.repositories.update((items: any[]) => [...items, other]); git.activeRepositoryId.set(other.id);
      } else git.repositories.update((items: any[]) => items.map(item => item.id === repository.id ? { ...item, path: '/owned/ref-path-replacement' } : item));
    };
  });
});

async function open(page: import('@playwright/test').Page, action: string) {
  await page.evaluate(action => (window as any).__refScope.open(action), action);
  const dialog = page.locator('gk-reference-action-dialog [role=alertdialog]');
  await expect(dialog).toBeVisible();
  await page.evaluate(action => {
    const component = (window as any).ng.getComponent(document.querySelector('gk-reference-action-dialog'));
    if (action.startsWith('rename')) component.newName.set('owned-renamed-reference');
    if (action === 'delete-remote-tag') component.remoteExpected.set('b'.repeat(40));
  }, action);
  await expect(dialog.locator('footer button').last()).toBeEnabled();
  return dialog;
}

for (const action of actions) {
  test(`${action} refuses a same-ID checkout replacement before effects run`, async ({ page }) => {
    await open(page, action);
    await page.evaluate(() => {
      const confirm = document.querySelector<HTMLButtonElement>('gk-reference-action-dialog footer button:last-child')!;
      (window as any).__refScope.change('path'); confirm.click();
    });
    expect(await page.evaluate(writes => (window as any).__refScope.calls.filter((call: any) => writes.includes(call.command)), writes)).toEqual([]);
    await expect(page.locator('gk-reference-action-dialog [role=alertdialog]')).toHaveCount(0);
  });

  test(`${action} still dispatches the valid source-bound action`, async ({ page }) => {
    const dialog = await open(page, action);
    await dialog.locator('footer button').last().click();
    await expect(dialog).toHaveCount(0);
    const calls = await page.evaluate(writes => (window as any).__refScope.calls.filter((call: any) => writes.includes(call.command)), writes);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.repoId).toBe(await page.evaluate(() => (window as any).__refScope.repository.id));
  });
}

for (const action of ['confirm', 'cancel']) {
  test(`outgoing reference ${action} cannot consume a replacement request`, async ({ page }) => {
    await open(page, 'rename-tag');
    await page.evaluate(action => {
      const control = document.querySelector<HTMLButtonElement>(action === 'confirm'
        ? 'gk-reference-action-dialog footer button:last-child' : '[data-reference-cancel]')!;
      (window as any).__refScope.open('rename-tag'); control.click();
    }, action);
    expect(await page.evaluate(writes => (window as any).__refScope.calls.filter((call: any) => writes.includes(call.command)), writes)).toEqual([]);
    await expect(page.locator('gk-reference-action-dialog [role=alertdialog]')).toBeVisible();
  });
}

for (const change of ['repository', 'path']) {
  test(`late remote rename cannot update ${change} reference filters`, async ({ page }) => {
    await page.evaluate(() => { (window as any).__refScope.hold = 'rename_reference'; });
    const dialog = await open(page, 'rename-remote-branch');
    await dialog.locator('footer button').last().click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__refScope.finish)).toBe('function');
    await page.evaluate(change => {
      const s = (window as any).__refScope; s.change(change);
      s.app.hiddenBranches.set(['origin/feature/search']); s.app.soloBranches.set(['origin/feature/search']); s.finish();
    }, change);
    await expect.poll(() => page.evaluate(() => (window as any).__refScope.git.busy())).toBe(false);
    expect(await page.evaluate(() => { const a = (window as any).__refScope.app; return { hidden: a.hiddenBranches(), solo: a.soloBranches() }; }))
      .toEqual({ hidden: ['origin/feature/search'], solo: ['origin/feature/search'] });
  });
}

test('reference rename isolates modifier shortcuts but supports explicit Enter', async ({ page }) => {
  const dialog = await open(page, 'rename-tag');
  const field = dialog.getByRole('textbox', { name: 'New name' });
  await expect(field).toBeFocused();
  await expect(dialog).toContainText(await page.evaluate(() => (window as any).__refScope.repository.path));
  await field.press('Control+Enter');
  await field.press('Control+Shift+Enter');
  await field.press('Control+p');
  await expect(dialog).toBeVisible();
  await expect(page.locator('gk-command-palette')).toHaveCount(0);
  expect(await page.evaluate(writes => (window as any).__refScope.calls.filter((call: any) => writes.includes(call.command)), writes)).toEqual([]);
  await field.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(writes => (window as any).__refScope.calls.filter((call: any) => writes.includes(call.command)).length, writes)).toBe(1);
});

test('late remote-tag read cannot qualify a replacement reference review', async ({ page }) => {
  await page.evaluate(() => { (window as any).__refScope.hold = 'preview_remote_tag'; });
  const dialog = await open(page, 'delete-remote-tag');
  await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-reference-action-dialog')).remoteExpected.set(null));
  await dialog.getByRole('button', { name: 'Check remote tag', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__refScope.finish)).toBe('function');
  await page.evaluate(() => (window as any).__refScope.open('delete-remote-tag'));
  await expect(dialog.getByRole('button', { name: 'Delete remote reference', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__refScope.finish());
  await expect.poll(() => page.evaluate(() => (window as any).__refScope.git.busy())).toBe(false);
  await expect(dialog.getByRole('button', { name: 'Delete remote reference', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('Check the remote tag before confirming deletion.');
});

test('an outgoing reference name field cannot leave text in a replacement review', async ({ page }) => {
  const dialog = await open(page, 'rename-tag');
  await dialog.getByRole('textbox', { name: 'New name' }).fill('v0.1.0');
  await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('#reference-new-name')!;
    (window as any).__refScope.open('rename-tag');
    field.value = 'owned-outgoing-text'; field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(dialog.getByRole('textbox', { name: 'New name' })).toHaveValue('v0.1.0');
});
