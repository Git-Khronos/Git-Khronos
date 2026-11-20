import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const branch = repository.branches.find((item: any) => !item.current && !item.remote).name;
    const state: any = { app, git, repository, branch, calls: [] };
    (window as any).__renameScope = state;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'rename_branch' && state.hold) return new Promise(resolve => {
        state.finish = () => resolve(repository);
      });
      if (command === 'rename_branch' && state.fail) return Promise.reject({ kind: 'gitFailure', message: 'Owned rename refusal' });
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.resolve(repository);
    } };
    state.open = () => { app.requestPaletteBranchRename(branch); app.contextRenameName.set('renamed-topic'); };
    state.change = (kind: string) => {
      if (kind === 'repository') {
        const other = { ...repository, id: 'rename-scope-B', path: '/owned/rename-B' };
        git.repositories.update((items: any[]) => [...items, other]);
        git.activeRepositoryId.set(other.id);
      } else git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
        ? { ...item, path: '/owned/rename-replacement' } : item));
    };
  });
});

for (const change of ['repository', 'path']) {
  test(`branch rename refuses a pre-effect ${change} change`, async ({ page }) => {
    await page.evaluate(() => (window as any).__renameScope.open());
    const dialog = page.getByRole('dialog', { name: /^Rename branch / });
    await expect(dialog).toBeVisible();
    await page.evaluate(change => {
      const submit = document.querySelector<HTMLButtonElement>('[name=branchRenameName]')!.closest('form')!.querySelector<HTMLButtonElement>('[type=submit]')!;
      (window as any).__renameScope.change(change);
      submit.click();
    }, change);
    expect(await page.evaluate(() => (window as any).__renameScope.calls.filter((call: any) => call.command === 'rename_branch'))).toEqual([]);
    await expect(dialog).not.toBeVisible();
  });

  test(`late rename success cannot rewrite ${change} view preferences`, async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as any).__renameScope;
      s.hold = true;
      s.app.pinnedBranch.set(s.branch);
      s.open();
    });
    await page.getByRole('button', { name: 'Rename Branch', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__renameScope.finish)).toBe('function');
    await page.evaluate(change => {
      const s = (window as any).__renameScope;
      s.change(change);
      s.app.pinnedBranch.set(s.branch);
      s.app.hiddenBranches.set([s.branch]);
      s.app.soloBranches.set([s.branch]);
      s.before = JSON.stringify({ ...localStorage });
      s.finish();
    }, change);
    await expect.poll(() => page.evaluate(() => (window as any).__renameScope.git.busy())).toBe(false);
    expect(await page.evaluate(() => {
      const s = (window as any).__renameScope;
      return { pinned: s.app.pinnedBranch(), hidden: s.app.hiddenBranches(), solo: s.app.soloBranches(),
        unchanged: s.before === JSON.stringify({ ...localStorage }), branch: s.branch };
    })).toMatchObject({ pinned: 'feature/partial-staging', hidden: ['feature/partial-staging'], solo: ['feature/partial-staging'], unchanged: true });
  });
}

for (const action of ['confirm', 'cancel']) {
  test(`outgoing branch rename ${action} cannot retire a replacement request`, async ({ page }) => {
    await page.evaluate(() => (window as any).__renameScope.open());
    await expect(page.getByRole('dialog', { name: /^Rename branch / })).toBeVisible();
    await page.evaluate(action => {
      const form = document.querySelector('[name=branchRenameName]')!.closest('form')!;
      const control = form.querySelector<HTMLButtonElement>(action === 'confirm' ? '[type=submit]' : '[type=button]')!;
      (window as any).__renameScope.open();
      control.click();
    }, action);
    expect(await page.evaluate(() => (window as any).__renameScope.calls.filter((call: any) => call.command === 'rename_branch'))).toEqual([]);
    await expect(page.getByRole('dialog', { name: /^Rename branch / })).toBeVisible();
  });
}

test('successful branch rename follows source preferences and records undo', async ({ page }) => {
  await page.evaluate(() => {
    const s = (window as any).__renameScope;
    s.app.pinnedBranch.set(s.branch); s.app.hiddenBranches.set([s.branch]); s.app.soloBranches.set([s.branch]); s.open();
  });
  await page.getByRole('button', { name: 'Rename Branch', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__renameScope.git.busy())).toBe(false);
  expect(await page.evaluate(() => {
    const s = (window as any).__renameScope;
    return { pinned: s.app.pinnedBranch(), hidden: s.app.hiddenBranches(), solo: s.app.soloBranches(),
      calls: s.calls.filter((call: any) => call.command === 'rename_branch'), history: s.git.operationHistory()[s.repository.id] };
  })).toMatchObject({ pinned: 'renamed-topic', hidden: ['renamed-topic'], solo: ['renamed-topic'],
    calls: [{ args: { oldName: 'feature/partial-staging', newName: 'renamed-topic' } }], history: { kind: 'rename-branch' } });
});

test('rename dialog traps focus, isolates background shortcuts and restores its opener', async ({ page }) => {
  await page.evaluate(() => {
    const s = (window as any).__renameScope;
    const opener = document.createElement('button'); opener.id = 'owned-rename-opener'; opener.textContent = 'Owned rename opener';
    document.body.append(opener); opener.focus(); s.open();
  });
  const dialog = page.getByRole('dialog', { name: /^Rename branch / });
  const field = dialog.getByRole('textbox');
  await expect(field).toBeFocused();
  await expect(dialog).toContainText(await page.evaluate(() => (window as any).__renameScope.repository.path));
  await field.press('Control+p');
  await expect(page.locator('gc-command-palette')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Rename Branch', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(field).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Rename Branch', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#owned-rename-opener')).toBeFocused();
  expect(await page.evaluate(() => (window as any).__renameScope.calls.filter((call: any) => call.command === 'rename_branch'))).toEqual([]);
});

test('busy programmatic confirmation cannot dispatch or retire its rename request', async ({ page }) => {
  await page.evaluate(() => (window as any).__renameScope.open());
  await expect(page.getByRole('dialog', { name: /^Rename branch / })).toBeVisible();
  expect(await page.evaluate(async () => {
    const s = (window as any).__renameScope;
    const original = s.git.busy; s.git.busy = () => true;
    const request = s.app.pendingBranchRename();
    try { await s.app.confirmPaletteBranchRename(); return s.app.pendingBranchRename() === request; }
    finally { s.git.busy = original; }
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).__renameScope.calls.filter((call: any) => call.command === 'rename_branch'))).toEqual([]);
});

test('failed rename does not follow preferences or create undo history', async ({ page }) => {
  await page.evaluate(() => {
    const s = (window as any).__renameScope; s.fail = true;
    s.app.pinnedBranch.set(s.branch); s.app.hiddenBranches.set([s.branch]); s.open();
  });
  await page.getByRole('button', { name: 'Rename Branch', exact: true }).click();
  await expect(page.locator('.error-toast')).toContainText('Owned rename refusal');
  expect(await page.evaluate(() => {
    const s = (window as any).__renameScope;
    return { pinned: s.app.pinnedBranch(), hidden: s.app.hiddenBranches(), history: s.git.operationHistory()[s.repository.id] ?? null };
  })).toEqual({ pinned: 'feature/partial-staging', hidden: ['feature/partial-staging'], history: null });
});

for (const change of ['repository', 'path']) {
  test(`context rename refuses a pre-effect ${change} change`, async ({ page }) => {
    await page.getByRole('button', { name: 'Local branch feature/partial-staging', exact: true }).first().click({ button: 'right' });
    const field = page.locator('#context-rename-name');
    await expect(field).toBeVisible();
    await field.fill('renamed-topic');
    await page.evaluate(change => {
      const form = document.querySelector('#context-rename-name')!.closest('form')!;
      (window as any).__renameScope.change(change);
      form.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    }, change);
    expect(await page.evaluate(() => (window as any).__renameScope.calls.filter((call: any) => call.command === 'rename_branch'))).toEqual([]);
  });
}

for (const [kind, flags] of Object.entries({
  control: { ctrlKey: true }, meta: { metaKey: true }, alt: { altKey: true },
  shift: { shiftKey: true }, repeated: { repeat: true }, composing: { isComposing: true },
})) {
  test(`palette rename cancels ${kind} Enter browser-default submission`, async ({ page }) => {
    await page.evaluate(() => (window as any).__renameScope.open());
    const field = page.getByRole('dialog', { name: /^Rename branch / }).getByRole('textbox');
    await expect(field).toBeFocused();
    const result = await field.evaluate((input, flags) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...flags });
      return { allowedDefault: input.dispatchEvent(event), cancelled: event.defaultPrevented };
    }, flags);
    // Chromium can ignore a chord that another engine may submit. Verify the
    // cancellation contract directly, not only one engine's implicit behavior.
    expect(result).toEqual({ allowedDefault: false, cancelled: true });
    await expect(field).toBeVisible();
    expect(await page.evaluate(() => (window as any).__renameScope.calls.filter((call: any) => call.command === 'rename_branch'))).toEqual([]);
  });
}

test('plain Enter still confirms the palette branch rename once', async ({ page }) => {
  await page.evaluate(() => (window as any).__renameScope.open());
  const field = page.getByRole('dialog', { name: /^Rename branch / }).getByRole('textbox');
  await expect(field).toBeFocused();
  await field.press('Enter');
  await expect(page.getByRole('dialog', { name: /^Rename branch / })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__renameScope.calls.filter((call: any) => call.command === 'rename_branch')))
    .toMatchObject([{ args: { oldName: 'feature/partial-staging', newName: 'renamed-topic' } }]);
});
