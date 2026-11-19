import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  return page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const source = git.repository();
    const branch = source.branches.find((entry: any) => entry.name === 'feature/partial-staging');
    const ownerPath = '/workspace/other-checkout';
    const worktrees = [
      ...source.worktrees.filter((entry: any) => entry.branch !== branch.name),
      { ...source.worktrees[0], path: ownerPath, branch: branch.name, current: false,
        prunable: false, changes: 3, statusLoaded: true },
    ];
    const snapshot = { ...source, worktrees };
    git.repositories.update((tabs: any[]) => tabs.map(tab => tab.id === source.id ? snapshot : tab));
    app.localBranchesOpen.set(true);
    app.setAutoFetchInterval(0);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { calls: [] as any[], changed: false, missing: false, failRefresh: false,
      hold: false, finish: null as any, ownerPath, branch: branch.name, sourcePath: source.path, sourceId: source.id };
    (window as any).__checkoutWorktree = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'refresh_repository') {
        if (fixture.failRefresh) return Promise.reject({ message: 'Owned refresh failed' });
        const refreshed = () => ({ ...snapshot, worktrees: worktrees.map(entry => entry.path === ownerPath
          ? { ...entry, branch: fixture.changed ? 'different-branch' : entry.branch, prunable: fixture.missing } : entry) });
        if (fixture.hold) return new Promise(resolve => { fixture.finish = () => resolve(refreshed()); });
        return Promise.resolve(refreshed());
      }
      if (command === 'open_repository') return Promise.resolve({ ...snapshot, id: source.id + '-owner',
        path: args.path, name: source.name, status: { ...source.status, branch: branch.name },
        branches: source.branches.map((entry: any) => ({ ...entry, current: entry.name === branch.name })),
        worktrees: worktrees.map(entry => ({ ...entry, current: entry.path === args.path })) });
      if (command === 'checkout_branch') return Promise.resolve({ ...snapshot,
        status: { ...source.status, branch: args.name },
        branches: source.branches.map((entry: any) => ({ ...entry, current: entry.name === args.name })) });
      if (command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      if (command === 'inspect_commit') return Promise.resolve({ oid: args.oid, message: 'Owned fixture commit',
        signature: { status: 'unsigned', signer: null, key: null, fingerprint: null, trust: null }, files: [], filesTruncated: false });
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
    return { branch: branch.name, sourcePath: source.path, ownerPath };
  });
}

async function requestCheckout(page: Page, branch: string) {
  const item = page.getByRole('list', { name: 'Local branches' })
    .getByRole('button', { name: 'Local branch ' + branch, exact: false }).first();
  await item.dblclick();
  return page.getByRole('dialog', { name: 'Branch is open in another checkout' });
}

test('occupied branch requires explicit navigation and sends no checkout command', async ({ page }) => {
  const fixture = await setup(page);
  await page.evaluate(() => {
    (window as any).ng.getComponent(document.querySelector('gc-root')).commitMessage.set('Keep my source draft');
  });
  const dialog = await requestCheckout(page, fixture.branch);
  await expect(dialog).toContainText(fixture.sourcePath);
  await expect(dialog).toContainText(fixture.ownerPath);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Open existing checkout' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls.filter((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command)).length)).toBe(0);
  await dialog.getByRole('button', { name: 'Open existing checkout' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.status-repository-path')).toHaveText(fixture.ownerPath);
  const calls = await page.evaluate(() => (window as any).__checkoutWorktree.calls);
  expect(calls.filter((entry: any) => entry.command === 'checkout_branch')).toEqual([]);
  expect(calls.filter((entry: any) => entry.command === 'open_repository')).toEqual([
    { command: 'open_repository', args: { path: fixture.ownerPath } },
  ]);
  expect(calls.findIndex((entry: any) => entry.command === 'refresh_repository'))
    .toBeLessThan(calls.findIndex((entry: any) => entry.command === 'open_repository'));
  expect(await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return app.commitDrafts.get((window as any).__checkoutWorktree.sourceId)?.summary;
  })).toBe('Keep my source draft');
});

test('available local branches still use one ordinary native checkout', async ({ page }) => {
  const fixture = await setup(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((tabs: any[]) => tabs.map(tab => ({ ...tab,
      worktrees: tab.worktrees.filter((entry: any) => entry.current) })));
  });
  const item = page.getByRole('list', { name: 'Local branches' })
    .getByRole('button', { name: 'Local branch ' + fixture.branch, exact: false }).first();
  await item.dblclick();
  await expect.poll(() => page.evaluate(() => (window as any).__checkoutWorktree.calls
    .filter((entry: any) => entry.command === 'checkout_branch'))).toEqual([
    { command: 'checkout_branch', args: { repoId: expect.any(String), name: fixture.branch } },
  ]);
  await expect(page.getByRole('dialog', { name: 'Branch is open in another checkout' })).toHaveCount(0);
});

test('keyboard branch-picker activation reviews occupancy and returns to its opener', async ({ page }) => {
  const fixture = await setup(page);
  const toggle = page.getByRole('button', { name: /Switch branch, current/ });
  await toggle.click();
  const picker = page.getByRole('dialog', { name: 'Switch branch', exact: true });
  await picker.getByRole('searchbox').fill(fixture.branch);
  await picker.getByRole('searchbox').press('Enter');
  const review = page.getByRole('dialog', { name: 'Branch is open in another checkout' });
  await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  await expect(toggle).toBeFocused();
  expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls
    .some((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command)))).toBe(false);
});

test('duplicate repository names include distinguishing paths in their tab names', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const source = git.repository();
    git.repositories.set([
      { ...source, path: '/workspace/one/project', name: 'project',
        worktrees: [{ ...source.worktrees[0], path: '/workspace/one/project', current: true }] },
      { ...source, id: 'second-project', path: '/workspace/two/project', name: 'project',
        worktrees: [{ ...source.worktrees[0], path: '/workspace/two/project', current: true }] },
    ]);
  });
  await expect(page.getByRole('tab', { name: /project · one\/project/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /project · two\/project/ })).toBeVisible();
  await expect(page.locator('.status-repository-path')).toHaveText('/workspace/one/project');
});

for (const mode of ['changed', 'missing', 'failRefresh'] as const) {
  test(`fresh ${mode} evidence prevents navigation without falling back to checkout`, async ({ page }) => {
    const fixture = await setup(page);
    const dialog = await requestCheckout(page, fixture.branch);
    await page.evaluate(mode => { (window as any).__checkoutWorktree[mode] = true; }, mode);
    await dialog.getByRole('button', { name: 'Open existing checkout' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('alert')).toBeFocused();
    await expect(page.locator('.status-repository-path')).toHaveText(fixture.sourcePath);
    expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls
      .filter((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command)))).toEqual([]);
  });
}

test('Escape cancels navigation without changing repository or files', async ({ page }) => {
  const fixture = await setup(page);
  const dialog = await requestCheckout(page, fixture.branch);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.status-repository-path')).toHaveText(fixture.sourcePath);
  expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls.filter((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command)))).toEqual([]);
});

test('compact checkout review keeps long paths and actions within its bounds', async ({ page }) => {
  const fixture = await setup(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(branch => {
    void (window as any).ng.getComponent(document.querySelector('gc-root')).checkoutBranch(branch);
  }, fixture.branch);
  const dialog = page.getByRole('dialog', { name: 'Branch is open in another checkout' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => {
    const r = element.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth && r.left >= 0 && r.right <= innerWidth;
  })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

for (const mode of ['hold', 'fail'] as const) {
  test(`checkout review has a keyboard escape when its chunk ${mode === 'hold' ? 'loads late' : 'fails'}`, async ({ page }) => {
    const fixture = await setup(page);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      if (!source.includes('CheckoutWorktreeDialogComponent') || !source.includes('Owning checkout:')) {
        await route.fulfill({ response, body: source }); return;
      }
      await held;
      if (mode === 'fail') await route.abort();
      else await route.fulfill({ response, body: source });
    });
    await page.evaluate(branch => {
      void (window as any).ng.getComponent(document.querySelector('gc-root')).checkoutBranch(branch);
    }, fixture.branch);
    const loading = page.getByRole('dialog', { name: 'Loading checkout review' });
    await expect(loading.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(loading.getByRole('button', { name: 'Cancel' })).toBeFocused();
    if (mode === 'hold') {
      await page.keyboard.press('Escape');
      await expect(loading).toHaveCount(0);
      release();
      await expect(page.getByRole('dialog', { name: 'Branch is open in another checkout' })).toHaveCount(0);
    } else {
      release();
      const failed = page.getByRole('dialog', { name: 'Checkout review unavailable' });
      await expect(failed.getByRole('button', { name: 'Close' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(failed).toHaveCount(0);
    }
    expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls
      .some((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command)))).toBe(false);
  });
}

test('late refresh cannot navigate after the source repository changes', async ({ page }) => {
  const fixture = await setup(page);
  const dialog = await requestCheckout(page, fixture.branch);
  await page.evaluate(() => { (window as any).__checkoutWorktree.hold = true; });
  await dialog.getByRole('button', { name: 'Open existing checkout' }).click();
  await expect(dialog.getByRole('button', { name: 'Open existing checkout' })).toBeDisabled();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const other = { ...git.repository(), id: 'another-repository', path: '/workspace/unrelated' };
    git.repositories.update((tabs: any[]) => [...tabs, other]);
    git.activeRepositoryId.set(other.id);
  });
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).__checkoutWorktree.finish());
  await expect(page.locator('.status-repository-path')).toHaveText('/workspace/unrelated');
  expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls
    .some((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command)))).toBe(false);
});

test('graph double-click and context-menu checkout use the same occupancy review', async ({ page }) => {
  const fixture = await setup(page);
  await page.locator('.commit-row .branch-column .ref-pill.local', { hasText: fixture.branch }).dblclick();
  const dialog = page.getByRole('dialog', { name: 'Branch is open in another checkout' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('list', { name: 'Local branches' })
    .getByRole('button', { name: 'Local branch ' + fixture.branch, exact: false }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Checkout branch/ }).click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls.filter((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command)))).toEqual([]);
});
