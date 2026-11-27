import { expect, test, type Page } from '@playwright/test';

const kinds = ['fetch', 'move', 'repair'];
const writes = ['fetch_branches', 'move_worktree', 'repair_worktree'];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const repository = git.repository();
    const state: any = { app, git, repository, calls: [], pickers: [] };
    (window as any).__deferredScope = state;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'plugin:dialog|open') return new Promise((resolve, reject) => { state.pickers.push({ resolve, reject }); });
      if (command === 'shallow_history_state') return Promise.resolve({ shallow: false, boundaryCommits: 0 });
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.resolve(repository);
    } };
    state.open = (kind: string) => {
      const owner = { repositoryId: repository.id, repositoryPath: repository.path, returnFocus: null };
      if (kind === 'fetch') app.fetchRequest.set({ ...owner, repositoryVisit: git.activeRepositoryReadScope() });
      else app.worktreeMoveRequest.set({ ...owner, repair: kind === 'repair', worktree: {
        ...repository.worktrees[0], current: false, locked: false, prunable: kind === 'repair',
        path: '/owned/reviewed-linked', branch: 'owned-topic', oid: repository.headOid,
      } });
    };
    state.change = (kind: string) => {
      if (kind === 'repository') {
        const other = { ...repository, id: 'deferred-scope-B', path: '/owned/deferred-scope-B' };
        git.repositories.update((items: any[]) => [...items, other]); git.activeRepositoryId.set(other.id);
      } else git.repositories.update((items: any[]) => items.map(item => item.id === repository.id ? { ...item, path: '/owned/deferred-path-replacement' } : item));
    };
  });
});

async function open(page: Page, kind: string) {
  await page.evaluate(kind => (window as any).__deferredScope.open(kind), kind);
  const dialog = page.locator(kind === 'fetch' ? 'gk-fetch-options-dialog [role=dialog]' : 'gk-worktree-move-dialog [role=dialog]');
  await expect(dialog).toBeVisible();
  if (kind === 'move') await dialog.getByLabel('New folder name').fill('owned-moved');
  if (kind === 'repair') await dialog.getByLabel('Actual moved worktree directory').fill('/owned/moved-linked');
  await expect(dialog.locator('button[type=submit]')).toBeEnabled();
  return dialog;
}

for (const kind of kinds) {
  for (const change of ['repository', 'path']) {
    test(`${kind} retires and refuses a pre-effect ${change} change`, async ({ page }) => {
      const dialog = await open(page, kind);
      await page.evaluate(({ kind, change }) => {
        const selector = kind === 'fetch' ? 'gk-fetch-options-dialog' : 'gk-worktree-move-dialog';
        const confirm = document.querySelector<HTMLButtonElement>(selector + ' button[type=submit]')!;
        (window as any).__deferredScope.change(change); confirm.click();
      }, { kind, change });
      expect(await page.evaluate(writes => (window as any).__deferredScope.calls.filter((call: any) => writes.includes(call.command)), writes)).toEqual([]);
      await expect(dialog).toHaveCount(0);
    });
  }

  test(`${kind} still dispatches valid captured native payload`, async ({ page }) => {
    const dialog = await open(page, kind);
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    const calls = await page.evaluate(writes => (window as any).__deferredScope.calls.filter((call: any) => writes.includes(call.command)), writes);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.repoId).toBe(await page.evaluate(() => (window as any).__deferredScope.repository.id));
    if (kind === 'move') expect(calls[0].args.request).toMatchObject({ path: '/owned/reviewed-linked', parentPath: '/owned', folder: 'owned-moved' });
    if (kind === 'repair') expect(calls[0].args.request).toMatchObject({ path: '/owned/reviewed-linked', actualPath: '/owned/moved-linked' });
  });

  for (const action of ['confirm', 'cancel']) {
    test(`outgoing ${kind} ${action} cannot consume its replacement`, async ({ page }) => {
      const dialog = await open(page, kind);
      await page.evaluate(({ kind, action }) => {
        const component = kind === 'fetch' ? 'gk-fetch-options-dialog' : 'gk-worktree-move-dialog';
        const control = document.querySelector<HTMLButtonElement>(component + (action === 'confirm' ? ' button[type=submit]' : ' footer button[type=button]'))!;
        (window as any).__deferredScope.open(kind); control.click();
      }, { kind, action });
      expect(await page.evaluate(writes => (window as any).__deferredScope.calls.filter((call: any) => writes.includes(call.command)), writes)).toEqual([]);
      await expect(dialog).toBeVisible();
    });
  }
}

test('a replacement worktree picker owns its pending state despite an older result', async ({ page }) => {
  let dialog = await open(page, 'move');
  await dialog.getByRole('button', { name: 'Browse…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__deferredScope.pickers.length)).toBe(1);
  dialog = await open(page, 'move');
  await expect(dialog.getByRole('button', { name: 'Browse…', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Browse…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__deferredScope.pickers.length)).toBe(2);
  await page.evaluate(() => (window as any).__deferredScope.pickers[0].resolve('/owned/obsolete-picker'));
  await expect(dialog.getByRole('button', { name: 'Browse…', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Destination parent directory')).toHaveValue('/owned');
  await page.evaluate(() => (window as any).__deferredScope.pickers[1].resolve('/owned/fresh-picker'));
  await expect(dialog.getByLabel('Destination parent directory')).toHaveValue('/owned/fresh-picker');
  await expect(dialog.getByRole('button', { name: 'Browse…', exact: true })).toBeEnabled();
});

test('a retired directory picker cannot overwrite a newer source error', async ({ page }) => {
  const dialog = await open(page, 'move');
  await dialog.getByRole('button', { name: 'Browse…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__deferredScope.pickers.length)).toBe(1);
  await page.evaluate(() => {
    const s = (window as any).__deferredScope; s.change('repository'); s.git.error.set('Current source feedback');
    s.pickers[0].reject({ kind: 'ownedPickerFailure', message: 'Obsolete directory picker failed' });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__deferredScope.git.error())).toBe('Current source feedback');
});

for (const kind of ['fetch', 'move']) {
  test(`outgoing ${kind} field cannot leave a value in its replacement`, async ({ page }) => {
    const dialog = await open(page, kind);
    await page.evaluate(kind => {
      const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(kind === 'fetch' ? '#fetch-options-remote' : '#move-parent')!;
      (window as any).__deferredScope.open(kind);
      field.value = kind === 'fetch' ? 'upstream' : '/owned/obsolete-parent';
      field.dispatchEvent(new Event(kind === 'fetch' ? 'change' : 'input', { bubbles: true }));
    }, kind);
    await expect(dialog.getByLabel(kind === 'fetch' ? 'Fetch from' : 'Destination parent directory')).toHaveValue(kind === 'fetch' ? 'origin' : '/owned');
  });
}

for (const kind of kinds) {
  test(`${kind} keeps the background palette closed while editing`, async ({ page }) => {
    const dialog = await open(page, kind);
    const field = dialog.locator(kind === 'fetch' ? '#fetch-options-remote' : kind === 'move' ? '#move-folder' : '#repair-directory');
    await field.focus();
    await field.press('Control+p');
    await expect(page.locator('gk-command-palette')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(writes => (window as any).__deferredScope.calls.filter((call: any) => writes.includes(call.command)), writes)).toEqual([]);
  });
}

for (const kind of ['reference', 'stash']) {
  test(`${kind} close cannot restore focus over a newer fetch review`, async ({ page }) => {
    await page.evaluate(kind => {
      const s = (window as any).__deferredScope;
      const opener = document.createElement('button'); opener.id = 'owned-deferred-opener'; opener.textContent = 'Owned deferred opener';
      document.body.append(opener); opener.focus();
      const owner = { repositoryId: s.repository.id, repositoryPath: s.repository.path, returnFocus: opener };
      if (kind === 'reference') s.app.referenceAction.set({ ...owner, action: 'delete-tag', name: 'v0.1.0', oid: s.repository.headOid });
      else s.app.stashDialog.set({ ...owner, action: 'save', checkoutVisit: s.git.activeRepositoryReadScope() });
    }, kind);
    await expect(page.locator(kind === 'reference' ? 'gk-reference-action-dialog [role=alertdialog]' : 'gk-stash-options-dialog [role=dialog]')).toBeVisible();
    await page.evaluate(kind => {
      const s = (window as any).__deferredScope; s.oldFocus = 0;
      document.addEventListener('focusin', event => { if ((event.target as HTMLElement).id === 'owned-deferred-opener') s.oldFocus++; });
      document.querySelector<HTMLButtonElement>(kind === 'reference' ? '[data-reference-cancel]' : '[data-stash-cancel]')!.click();
      s.open('fetch');
    }, kind);
    await expect(page.locator('gk-fetch-options-dialog [data-fetch-cancel]')).toBeFocused();
    expect(await page.evaluate(() => (window as any).__deferredScope.oldFocus)).toBe(0);
  });
}
