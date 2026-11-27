import { expect, test, type Page } from '@playwright/test';
import { openPreviewRepository } from './preview-repository-ready';

const actions = ['save', 'apply', 'apply-file', 'branch', 'switch'];
const commands = ['stash_selected', 'apply_stash_options', 'apply_stashed_file', 'branch_from_stash', 'stash_checkout'];

test.beforeEach(async ({ page }) => {
  await openPreviewRepository(page, page.locator('#unstaged-files-list'));
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const repository = git.repository();
    const state: any = { app, git, repository, calls: [] };
    (window as any).__stashScope = state;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      const snapshot = git.repositories().find((item: any) => item.id === args?.repoId) ?? repository;
      if (['stash_selected', 'apply_stash_options', 'apply_stashed_file', 'branch_from_stash', 'stash_checkout'].includes(command)) {
        if (state.fail) return Promise.reject({ kind: 'gitFailure', message: 'Owned stash refusal' });
        if (state.hold) return new Promise(resolve => { state.finish = () => resolve(snapshot); });
      }
      if (command === 'refresh_repository' && state.holdRecoveryRefresh) return new Promise(resolve => { state.finishRefresh = () => resolve(snapshot); });
      if (command === 'refresh_repository_status') return Promise.resolve(snapshot.status);
      return Promise.resolve(snapshot);
    } };
    state.open = (action: string) => {
      if (action === 'branch') git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
        ? { ...item, status: { ...item.status, entryCount: 0, entries: [] } } : item));
      const source = git.repository();
      const request = { action, repositoryId: source.id, repositoryPath: source.path, stash: source.stashes[0],
        checkoutVisit: git.activeRepositoryReadScope(),
        file: { path: 'owned-stashed-file.txt', previousPath: null, status: 'M', additions: 1, deletions: 0 },
        branch: { name: 'feature/partial-staging', oid: source.headOid }, headOid: source.headOid, returnFocus: null };
      app.stashDialog.set(request); return request;
    };
    state.change = (kind: string) => {
      if (kind === 'revisit') {
        const current = git.repository();
        const other = { ...current, id: 'stash-revisit', path: '/owned/stash-revisit' };
        git.repositories.update((items: any[]) => [...items, other]);
        git.activateRepository(other.id);
        git.activateRepository(current.id);
        return;
      }
      if (kind === 'repository') {
        const other = { ...git.repository(), id: 'stash-scope-B', path: '/owned/stash-scope-B' };
        git.repositories.update((items: any[]) => [...items, other]); git.activeRepositoryId.set(other.id);
      } else git.repositories.update((items: any[]) => items.map(item => item.id === repository.id ? { ...item, path: '/owned/stash-path-replacement' } : item));
    };
  });
});

async function open(page: Page, action: string) {
  await page.evaluate(action => (window as any).__stashScope.open(action), action);
  const dialog = page.locator('gk-stash-options-dialog [role=dialog]');
  await expect(dialog).toBeVisible();
  if (action === 'branch') await dialog.getByLabel('New branch name').fill('owned-restored-branch');
  await expect(dialog.locator('footer .primary')).toBeEnabled();
  return dialog;
}

for (const action of actions) {
  for (const change of ['repository', 'path', 'revisit']) {
    test(`${action} stash review rejects a pre-effect ${change} change`, async ({ page }) => {
      await open(page, action);
      await page.evaluate(change => {
        const confirm = document.querySelector<HTMLButtonElement>('gk-stash-options-dialog footer .primary')!;
        (window as any).__stashScope.change(change); confirm.click();
      }, change);
      expect(await page.evaluate(commands => (window as any).__stashScope.calls.filter((call: any) => commands.includes(call.command)), commands)).toEqual([]);
      await expect(page.locator('gk-stash-options-dialog [role=dialog]')).toHaveCount(0);
    });
  }

  test(`${action} stash review retains a valid native dispatch`, async ({ page }) => {
    const dialog = await open(page, action);
    await dialog.locator('footer .primary').click();
    await expect(dialog).toHaveCount(0);
    const calls = await page.evaluate(commands => (window as any).__stashScope.calls.filter((call: any) => commands.includes(call.command)), commands);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.repoId).toBe(await page.evaluate(() => (window as any).__stashScope.repository.id));
  });
}

for (const action of ['confirm', 'cancel']) {
  test(`outgoing stash ${action} cannot consume a replacement review`, async ({ page }) => {
    await open(page, 'save');
    await page.evaluate(action => {
      const control = document.querySelector<HTMLButtonElement>(action === 'confirm'
        ? 'gk-stash-options-dialog footer .primary' : '[data-stash-cancel]')!;
      (window as any).__stashScope.open('save'); control.click();
    }, action);
    expect(await page.evaluate(commands => (window as any).__stashScope.calls.filter((call: any) => commands.includes(call.command)), commands)).toEqual([]);
    await expect(page.locator('gk-stash-options-dialog [role=dialog]')).toBeVisible();
  });
}

test('stash review contains shortcuts and keeps all options frozen during native work', async ({ page }) => {
  await page.evaluate(() => { (window as any).__stashScope.hold = true; });
  const dialog = await open(page, 'save');
  const message = dialog.getByLabel('Message');
  await message.fill('Captured stash message');
  await message.press('Control+p');
  await message.press('Control+Enter');
  await message.press('Control+Shift+Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('gk-command-palette')).toHaveCount(0);
  expect(await page.evaluate(commands => (window as any).__stashScope.calls.filter((call: any) => commands.includes(call.command)), commands)).toEqual([]);
  await dialog.locator('footer .primary').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__stashScope.finish)).toBe('function');
  await expect(message).toBeDisabled();
  await expect(dialog.getByLabel('Changes to save')).toBeDisabled();
  await expect(dialog.getByLabel('Include untracked files')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    const c = (window as any).ng.getComponent(document.querySelector('gk-stash-options-dialog'));
    c.changeMessage('Not captured', c.request()); c.changeMode('staged-only');
  });
  await expect(message).toHaveValue('Captured stash message');
  await page.evaluate(() => (window as any).__stashScope.finish());
  await expect(dialog).toHaveCount(0);
});

test('a failed stash is not dismissed when its global error is cleared during recovery inspection', async ({ page }) => {
  await page.evaluate(() => { const s = (window as any).__stashScope; s.fail = true; s.holdRecoveryRefresh = true; });
  const dialog = await open(page, 'save');
  await dialog.getByLabel('Message').fill('Retained after native refusal');
  await dialog.locator('footer .primary').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__stashScope.finishRefresh)).toBe('function');
  await page.evaluate(() => { const s = (window as any).__stashScope; s.git.dismissError(); s.finishRefresh(); });
  await expect.poll(() => page.evaluate(() => (window as any).__stashScope.git.busy())).toBe(false);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Message')).toHaveValue('Retained after native refusal');
});

test('late stash success cannot dismiss a newer stash review', async ({ page }) => {
  await page.evaluate(() => { (window as any).__stashScope.hold = true; });
  const dialog = await open(page, 'save');
  await dialog.locator('footer .primary').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__stashScope.finish)).toBe('function');
  await page.evaluate(() => { const s = (window as any).__stashScope; s.open('save'); s.finish(); });
  await expect.poll(() => page.evaluate(() => (window as any).__stashScope.git.busy())).toBe(false);
  await expect(dialog).toBeVisible();
});

test('an outgoing stash message field cannot edit a replacement draft', async ({ page }) => {
  const dialog = await open(page, 'save');
  await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('[name=stashMessage]')!;
    (window as any).__stashScope.open('save');
    field.value = 'Outgoing control'; field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(dialog.getByLabel('Message')).toHaveValue('');
});
