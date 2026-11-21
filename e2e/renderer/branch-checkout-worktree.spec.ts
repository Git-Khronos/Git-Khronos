import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, sourceRegistrationPath?: string) {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  return page.evaluate(sourceRegistrationPath => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const source = git.repository();
    const branch = source.branches.find((entry: any) => entry.name === 'feature/partial-staging');
    const ownerPath = '/workspace/other-checkout';
    const worktrees = [
      ...source.worktrees.filter((entry: any) => entry.branch !== branch.name)
        .map((entry: any) => sourceRegistrationPath && entry.current ? { ...entry, path: sourceRegistrationPath } : entry),
      { ...source.worktrees[0], path: ownerPath, branch: branch.name, current: false,
        prunable: false, changes: 3, statusLoaded: true },
    ];
    const snapshot = { ...source, worktrees };
    git.repositories.update((tabs: any[]) => tabs.map(tab => tab.id === source.id ? snapshot : tab));
    app.localBranchesOpen.set(true);
    app.setAutoFetchInterval(0);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { calls: [] as any[], changed: false, missing: false, failRefresh: false,
      checkoutFailure: null as string | null,
      hold: false, finish: null as any, holdOpen: false, finishOpen: null as any, changedOpen: null as string | null,
      ownerPath, branch: branch.name, sourcePath: source.path, sourceId: source.id };
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
      if (command === 'open_repository') {
        const opened = {
          ...snapshot, id: source.id + '-owner',
          path: fixture.changedOpen === 'path' || fixture.changedOpen === 'canonical alias' ? '/workspace/redirected' : args.path,
          status: { ...source.status, branch: fixture.changedOpen === 'branch' ? 'different-branch' : branch.name },
          branches: source.branches.map((entry: any) => ({ ...entry, current: entry.name === branch.name })),
          worktrees: worktrees.filter(entry => fixture.changedOpen !== 'registration' || entry.path === args.path)
            .map(entry => ({ ...entry,
              path: fixture.changedOpen === 'path' && entry.path === args.path ? '/workspace/redirected' : entry.path,
              current: entry.path === args.path })),
        };
        if (fixture.holdOpen) return new Promise((resolve, reject) => {
          fixture.finishOpen = (fail = false) => fail ? reject(new Error('Owned late open failure')) : resolve(opened);
        });
        return Promise.resolve(opened);
      }
      if (command === 'checkout_branch') {
        if (fixture.checkoutFailure) return Promise.reject({ kind: fixture.checkoutFailure, message: 'Owned checkout refused' });
        return Promise.resolve({ ...snapshot, status: { ...source.status, branch: args.name },
          branches: source.branches.map((entry: any) => ({ ...entry, current: entry.name === args.name })) });
      }
      if (command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      if (command === 'inspect_commit') return Promise.resolve({ oid: args.oid, message: 'Owned fixture commit',
        signature: { status: 'unsigned', signer: null, key: null, fingerprint: null, trust: null }, files: [], filesTruncated: false });
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
    return { branch: branch.name, sourcePath: source.path, ownerPath };
  }, sourceRegistrationPath);
}

async function loseCachedOwner(page: Page, failureKind: string, failRefresh = false): Promise<void> {
  await page.evaluate(({ failureKind, failRefresh }) => {
    const fixture = (window as any).__checkoutWorktree;
    fixture.checkoutFailure = failureKind;
    fixture.failRefresh = failRefresh;
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((tabs: any[]) => tabs.map(tab => ({ ...tab,
      worktrees: tab.worktrees.filter((entry: any) => entry.current) })));
  }, { failureKind, failRefresh });
}

test('graph double click recovers when another checkout took the branch after the last read', async ({ page }) => {
  const fixture = await setup(page);
  await loseCachedOwner(page, 'branchInAnotherWorktree');
  await page.locator('.commit-row .branch-column .ref-pill.local', { hasText: fixture.branch }).dblclick();
  const dialog = page.getByRole('dialog', { name: 'Branch is open in another checkout' });
  await expect(dialog).toContainText(fixture.ownerPath);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  const calls = () => page.evaluate(() => (window as any).__checkoutWorktree.calls
    .filter((entry: any) => ['checkout_branch', 'refresh_repository', 'open_repository'].includes(entry.command))
    .map((entry: any) => entry.command));
  expect(await calls()).toEqual(['checkout_branch', 'refresh_repository']);
  await dialog.getByRole('button', { name: 'Open existing checkout' }).click();
  await expect(page.locator('.status-repository-path')).toHaveText(fixture.ownerPath);
  expect(await calls()).toEqual(['checkout_branch', 'refresh_repository', 'refresh_repository', 'open_repository']);
});

for (const failure of ['other Git error', 'refresh failed'] as const) {
  test(`late checkout refusal keeps normal error feedback when ${failure === 'refresh failed' ? 'the refresh failed' : 'Git reports a different error'}`, async ({ page }) => {
    const fixture = await setup(page);
    await loseCachedOwner(page, failure === 'refresh failed' ? 'branchInAnotherWorktree' : 'gitFailure', failure === 'refresh failed');
    await page.locator('.commit-row .branch-column .ref-pill.local', { hasText: fixture.branch }).dblclick();
    await expect(page.locator('.error-toast')).toContainText(`Checkout ${fixture.branch} in ${fixture.sourcePath}: Owned checkout refused`);
    await expect(page.getByRole('dialog', { name: 'Branch is open in another checkout' })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls.filter(
      (entry: any) => entry.command === 'open_repository'))).toEqual([]);
  });
}

test('a late checkout refusal does not open a review in a different repository', async ({ page }) => {
  const fixture = await setup(page);
  await loseCachedOwner(page, 'branchInAnotherWorktree');
  await page.evaluate(() => { (window as any).__checkoutWorktree.hold = true; });
  await page.locator('.commit-row .branch-column .ref-pill.local', { hasText: fixture.branch }).dblclick();
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkoutWorktree.finish)).toBe(true);
  const activity = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const other = { ...git.repository(), id: 'another-repository', path: '/workspace/unrelated' };
    git.repositories.update((tabs: any[]) => [...tabs, other]);
    git.activeRepositoryId.set(other.id);
    const fixture = (window as any).__checkoutWorktree;
    fixture.finish();
    return fixture.calls.filter((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command));
  });
  expect(activity).toEqual([{ command: 'checkout_branch', args: { repoId: expect.any(String), name: fixture.branch } }]);
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
  await expect(page.locator('.status-repository-path')).toHaveText('/workspace/unrelated');
  await expect(page.getByRole('dialog', { name: 'Branch is open in another checkout' })).toHaveCount(0);
});

async function requestCheckout(page: Page, branch: string) {
  const item = page.getByRole('list', { name: 'Local branches' })
    .getByRole('button', { name: 'Local branch ' + branch, exact: false }).first();
  await item.dblclick();
  return page.getByRole('dialog', { name: 'Branch is open in another checkout' });
}

test('a checkout review closes when another workspace opens the same checkout', async ({ page }) => {
  const fixture = await setup(page);
  const dialog = await requestCheckout(page, fixture.branch);
  await expect(dialog).toBeVisible();
  const scope = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repo = git.repository();
    const workspace = { ...git.activeWorkspace(), id: 'same-checkout-workspace', name: 'Same checkout view',
      repositoryPaths: [repo.path], activeRepositoryPath: repo.path };
    git.workspaces.update((workspaces: any[]) => [...workspaces, workspace]);
    git.workspaceRepositoryCache.set(workspace.id, [repo]);
    await git.switchWorkspace(workspace.id);
    return { workspace: git.activeWorkspaceId(), sameCheckout: git.activeRepositoryId() === repo.id };
  });
  expect(scope).toEqual({ workspace: 'same-checkout-workspace', sameCheckout: true });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__checkoutWorktree.calls
    .some((entry: any) => ['checkout_branch', 'open_repository'].includes(entry.command)))).toBe(false);
});

test('a late checkout refusal cannot reopen a review after leaving and returning to the same tab', async ({ page }) => {
  const fixture = await setup(page);
  await loseCachedOwner(page, 'branchInAnotherWorktree');
  await page.evaluate(() => { (window as any).__checkoutWorktree.hold = true; });
  await page.locator('.commit-row .branch-column .ref-pill.local', { hasText: fixture.branch }).dblclick();
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkoutWorktree.finish)).toBe(true);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const source = git.repository();
    const other = { ...source, id: 'other-checkout-visit', path: '/fixture/other-checkout-visit' };
    git.repositories.update((repositories: any[]) => [...repositories, other]);
    git.activateRepository(other.id);
    git.activateRepository(source.id);
    (window as any).__checkoutWorktree.finish();
  });
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
  await expect(page.locator('.status-repository-path')).toHaveText(fixture.sourcePath);
  await expect(page.getByRole('dialog', { name: 'Branch is open in another checkout' })).toHaveCount(0);
});

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
  await expect(page.locator('.repo-tab-main[aria-selected="true"]')).toBeFocused();
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

for (const change of ['branch', 'path', 'registration']) {
  test(`the returned checkout must still match the reviewed ${change}`, async ({ page }) => {
    const fixture = await setup(page);
    const dialog = await requestCheckout(page, fixture.branch);
    await page.evaluate(change => { (window as any).__checkoutWorktree.changedOpen = change; }, change);
    await dialog.getByRole('button', { name: 'Open existing checkout' }).click();
    const feedback = dialog.getByRole('alert');
    await expect(feedback).toContainText('That checkout no longer matches the branch you reviewed');
    await expect(feedback).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Open existing checkout' })).toBeDisabled();
    await expect(page.locator('.error-toast')).toHaveCount(0);
    await expect(page.locator('.status-repository-path')).toHaveText(fixture.sourcePath);
    const state = await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const fixture = (window as any).__checkoutWorktree;
      return { writes: fixture.calls.filter((entry: any) => entry.command === 'checkout_branch'),
        opened: git.repositories().some((repository: any) => repository.id === fixture.sourceId + '-owner') };
    });
    expect(state).toEqual({ writes: [], opened: false });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Local branches' })
      .getByRole('button', { name: 'Local branch ' + fixture.branch, exact: false }).first()).toBeFocused();
  });
}

for (const lateReply of ['success', 'failure'] as const) {
  test(`cancel retires navigation while the native owner open is pending (${lateReply})`, async ({ page }) => {
    const fixture = await setup(page);
    const dialog = await requestCheckout(page, fixture.branch);
    await page.evaluate(() => { (window as any).__checkoutWorktree.holdOpen = true; });
    await dialog.getByRole('button', { name: 'Open existing checkout' }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).__checkoutWorktree.finishOpen)).toBe('function');
    await expect(dialog.getByRole('status')).toHaveText('Opening existing checkout…');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.evaluate(fail => (window as any).__checkoutWorktree.finishOpen(fail), lateReply === 'failure');
    await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
    await expect(page.locator('.status-repository-path')).toHaveText(fixture.sourcePath);
    await expect(page.locator('.error-toast')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const fixture = (window as any).__checkoutWorktree;
      return git.repositories().some((repository: any) => repository.id === fixture.sourceId + '-owner');
    })).toBe(false);
  });
}

test('an open reply cannot navigate after leaving and returning to the same checkout', async ({ page }) => {
  const fixture = await setup(page);
  const dialog = await requestCheckout(page, fixture.branch);
  await page.evaluate(() => { (window as any).__checkoutWorktree.holdOpen = true; });
  await dialog.getByRole('button', { name: 'Open existing checkout' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__checkoutWorktree.finishOpen)).toBe('function');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const source = git.repository();
    git.repositories.update((tabs: any[]) => [...tabs, { ...source, id: 'different-visit', path: '/owned/different-visit' }]);
    git.activateRepository('different-visit');
    git.activateRepository(source.id);
    (window as any).__checkoutWorktree.finishOpen();
  });
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
  await expect(page.locator('.status-repository-path')).toHaveText(fixture.sourcePath);
  expect(await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const fixture = (window as any).__checkoutWorktree;
    return git.repositories().some((repository: any) => repository.id === fixture.sourceId + '-owner');
  })).toBe(false);
});

test('the verified registration may resolve to a differently formatted canonical path', async ({ page }) => {
  const fixture = await setup(page, '/workspace/raw-source-registration');
  const dialog = await requestCheckout(page, fixture.branch);
  await page.evaluate(() => { (window as any).__checkoutWorktree.changedOpen = 'canonical alias'; });
  await dialog.getByRole('button', { name: 'Open existing checkout' }).click();
  await expect(page.locator('.status-repository-path')).toHaveText('/workspace/redirected');
});
