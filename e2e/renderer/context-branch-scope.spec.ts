import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const state: any = { app, git, repository, authoritative: repository, calls: [] };
    (window as any).__contextBranchScope = state;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'create_branch_at' && state.hold) return new Promise(resolve => { state.finish = () => resolve(repository); });
      if (command === 'integrate_branch' && state.prepareMerge) {
        state.authoritative = {
          ...state.authoritative, status: { ...state.authoritative.status, operations: [{ kind: 'merge' }], staged: 1, conflicted: 0 },
        };
      }
      if (command === 'refresh_repository_status') return Promise.resolve(state.authoritative.status);
      return Promise.resolve(state.authoritative);
    } };
    state.replace = () => {
      app.openBranchMenu(new MouseEvent('contextmenu', { clientX: 600, clientY: 250 }), 'owned-replacement', repository.headOid);
      app.openContextBranchCreator(new Event('click'));
      app.contextBranchName.set('owned-newer-branch');
    };
    state.change = (kind: string) => {
      if (kind === 'repository') {
        const other = { ...repository, id: 'context-branch-B', path: '/owned/context-branch-B' };
        git.repositories.update((items: any[]) => [...items, other]); git.activeRepositoryId.set(other.id);
      } else git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
        ? { ...item, path: '/owned/context-branch-replacement' } : item));
    };
  });
});

async function open(page: Page) {
  await page.getByRole('button', { name: 'Local branch feature/partial-staging', exact: true }).first().click({ button: 'right' });
  await page.locator('[data-create-context-branch]').click();
  const form = page.getByRole('form', { name: 'Create branch here' });
  await expect(form).toBeVisible();
  await form.getByRole('textbox').fill('owned-created-branch');
  return form;
}

async function openIntegrationMenu(page: Page) {
  await page.getByRole('button', { name: 'Local branch feature/partial-staging', exact: true }).first().click({ button: 'right' });
  const action = page.getByRole('menuitem', { name: 'Merge feature/partial-staging into main', exact: true });
  await expect(action).toBeEnabled();
  return action;
}

for (const side of ['source', 'head', 'checkout', 'path']) {
  test(`context menu integration refuses a changed ${side} before dispatch`, async ({ page }) => {
    const action = await openIntegrationMenu(page);
    await action.evaluate((button, side) => {
      const s = (window as any).__contextBranchScope;
      s.git.repositories.update((items: any[]) => items.map(item => {
        if (item.id !== s.repository.id) return item;
        if (side === 'path') return { ...item, path: '/owned/changed-path' };
        if (side === 'head') return { ...item, headOid: 'c'.repeat(40) };
        if (side === 'checkout') return { ...item, status: { ...item.status, branch: 'release' } };
        return { ...item, branches: item.branches.map((branch: any) =>
          branch.name === 'feature/partial-staging' ? { ...branch, oid: 'b'.repeat(40) } : branch) };
      }));
      (button as HTMLButtonElement).click();
    }, side);
    expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'integrate_branch'))).toEqual([]);
    await expect.poll(() => page.evaluate(() => (window as any).__contextBranchScope.git.error())).toContain('Open the branch menu again');
  });
}

test('context menu integration sends the exact source and receiving checkout to native', async ({ page }) => {
  const action = await openIntegrationMenu(page);
  const expected = await page.evaluate(() => {
    const s = (window as any).__contextBranchScope;
    const target = s.repository.branches.find((b: any) => b.name === 'main');
    const source = s.repository.branches.find((b: any) => b.name === 'feature/partial-staging');
    return { repoId: s.repository.id, name: source.name, strategy: 'merge', review: {
      sourceBranch: source.name, sourceOid: source.oid, receivingBranch: target.name, receivingOid: target.oid,
    } };
  });
  await action.click();
  await expect.poll(() => page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'integrate_branch')))
    .toMatchObject([{ args: expected }]);
});

test('context Merge reports a prepared merge instead of claiming completion', async ({ page }) => {
  const action = await openIntegrationMenu(page);
  await page.evaluate(() => {
    const state = (window as any).__contextBranchScope;
    state.prepareMerge = true;
  });
  await action.click();
  await expect(page.locator('.activity-status')).toContainText('Merge prepared, not committed');
});

async function openRebaseReview(page: Page) {
  await openIntegrationMenu(page);
  await page.getByRole('menuitem', { name: 'Rebase main onto feature/partial-staging…', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'feature/partial-staging' });
  await expect(dialog).toContainText('rebasing main onto feature/partial-staging');
  return dialog;
}

for (const side of ['source', 'checkout']) {
  test(`context rebase review refuses a changed ${side} before dispatch`, async ({ page }) => {
    const dialog = await openRebaseReview(page);
    await page.evaluate(async side => {
      const s = (window as any).__contextBranchScope;
      const current = s.git.repository();
      // The native fixture must agree with the simulated external move:
      // a background status poll can legitimately run before the final click.
      s.authoritative = side === 'checkout' ? { ...current, status: { ...current.status, branch: 'release' } }
          : { ...current, branches: current.branches.map((branch: any) =>
            branch.name === 'feature/partial-staging' ? { ...branch, oid: 'd'.repeat(40) } : branch) };
      s.git.repositories.update((items: any[]) => items.map(item =>
        item.id === current.id ? s.authoritative : item));
      await s.git.refreshStatusInBackground(current.id, true);
    }, side);
    await expect(dialog).toContainText('rebasing main onto feature/partial-staging');
    await expect.poll(() => page.evaluate(side => {
      const current = (window as any).__contextBranchScope.git.repository();
      return side === 'checkout' ? current.status.branch
        : current.branches.find((branch: any) => branch.name === 'feature/partial-staging').oid;
    }, side)).toBe(side === 'checkout' ? 'release' : 'd'.repeat(40));
    await dialog.getByRole('button', { name: 'Rebase', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'integrate_branch'))).toEqual([]);
    await expect.poll(() => page.evaluate(() => (window as any).__contextBranchScope.git.error())).toContain('Open the branch menu again');
  });
}

test('context rebase review sends its exact two tips to native', async ({ page }) => {
  const dialog = await openRebaseReview(page);
  const expected = await page.evaluate(() => {
    const s = (window as any).__contextBranchScope;
    return {
      strategy: 'rebase', name: 'feature/partial-staging', repoId: s.repository.id,
      review: { sourceBranch: 'feature/partial-staging', receivingBranch: 'main', receivingOid: s.repository.headOid,
        sourceOid: s.repository.branches.find((branch: any) => branch.name === 'feature/partial-staging').oid },
    };
  });
  await dialog.getByRole('button', { name: 'Rebase', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'integrate_branch')))
    .toMatchObject([{ args: expected }]);
});

for (const change of ['repository', 'path']) {
  test(`context branch creation rejects a pre-effect ${change} change`, async ({ page }) => {
    await open(page);
    await page.evaluate(change => {
      const submit = document.querySelector<HTMLButtonElement>('.context-create-branch-form button[type=submit]')!;
      (window as any).__contextBranchScope.change(change); submit.click();
    }, change);
    expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'create_branch_at'))).toEqual([]);
  });
}

for (const action of ['confirm', 'cancel', 'field']) {
  test(`outgoing context branch ${action} cannot consume a replacement creator`, async ({ page }) => {
    const form = await open(page);
    await page.evaluate(action => {
      const old = document.querySelector<HTMLFormElement>('.context-create-branch-form')!;
      const state = (window as any).__contextBranchScope;
      state.replace();
      if (action === 'field') {
        const input = old.querySelector<HTMLInputElement>('input')!;
        input.value = 'obsolete-field'; input.dispatchEvent(new Event('input', { bubbles: true }));
      } else old.querySelector<HTMLButtonElement>(action === 'confirm' ? '[type=submit]' : '[aria-label="Cancel branch creation"]')!.click();
    }, action);
    expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'create_branch_at'))).toEqual([]);
    await expect(form).toBeVisible();
    await expect(form.getByRole('textbox')).toHaveValue('owned-newer-branch');
  });
}

for (const [kind, flags] of Object.entries({ control: { ctrlKey: true }, repeat: { repeat: true }, composing: { isComposing: true } })) {
  test(`context creator cancels ${kind} Enter default submission`, async ({ page }) => {
    const form = await open(page);
    expect(await form.getByRole('textbox').evaluate((input, flags) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true, ...flags });
      input.dispatchEvent(event); return event.defaultPrevented;
    }, flags)).toBe(true);
    await expect(form).toBeVisible();
    expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'create_branch_at'))).toEqual([]);
  });
}

test('context branch creator retains one explicit valid dispatch at its selected tip', async ({ page }) => {
  const form = await open(page);
  const expected = await page.evaluate(() => {
    const state = (window as any).__contextBranchScope;
    return { repoId: state.repository.id, oid: state.app.contextMenu().oid, name: 'owned-created-branch' };
  });
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'create_branch_at')))
    .toMatchObject([{ args: expected }]);
});

for (const action of ['confirm', 'cancel', 'field']) {
  test(`same-menu reopened creator rejects its outgoing ${action}`, async ({ page }) => {
    const form = await open(page);
    await page.evaluate(action => {
      const old = document.querySelector<HTMLFormElement>('.context-create-branch-form')!;
      const s = (window as any).__contextBranchScope;
      s.app.closeContextBranchCreator();
      s.app.openContextBranchCreator(new Event('click'));
      s.app.contextBranchName.set('owned-reopened-branch');
      if (action === 'field') {
        const field = old.querySelector<HTMLInputElement>('input')!;
        field.value = 'obsolete-field'; field.dispatchEvent(new Event('input', { bubbles: true }));
      } else old.querySelector<HTMLButtonElement>(action === 'confirm' ? '[type=submit]' : '[aria-label="Cancel branch creation"]')!.click();
    }, action);
    await expect(form.getByRole('textbox')).toHaveValue('owned-reopened-branch');
    expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'create_branch_at'))).toEqual([]);
  });
}

test('held context creation cannot rewrite frozen options or consume a reopened creator', async ({ page }) => {
  const form = await open(page);
  await page.evaluate(() => { (window as any).__contextBranchScope.hold = true; });
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__contextBranchScope.finish)).toBe('function');
  await expect(form.getByRole('textbox')).toBeDisabled();
  await form.getByRole('textbox').evaluate(input => {
    (input as HTMLInputElement).value = 'obsolete-pending-field';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => (window as any).__contextBranchScope.app.contextBranchName())).toBe('owned-created-branch');
  await page.evaluate(() => {
    const s = (window as any).__contextBranchScope;
    s.app.closeContextBranchCreator(); s.app.openContextBranchCreator(new Event('click'));
    s.app.contextBranchName.set('owned-after-pending'); s.finish();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__contextBranchScope.git.busy())).toBe(false);
  await expect(form.getByRole('textbox')).toHaveValue('owned-after-pending');
  await expect(form.getByRole('textbox')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'create_branch_at'))).toHaveLength(1);
});

test('plain Enter creates once and modifier palette shortcuts stay local', async ({ page }) => {
  const form = await open(page);
  await form.getByRole('textbox').press('Control+p');
  await expect(page.locator('gc-command-palette')).toHaveCount(0);
  await expect(form).toContainText(await page.evaluate(() => (window as any).__contextBranchScope.repository.path));
  await form.getByRole('textbox').press('Enter');
  await expect(form).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__contextBranchScope.calls.filter((call: any) => call.command === 'create_branch_at'))).toHaveLength(1);
});
