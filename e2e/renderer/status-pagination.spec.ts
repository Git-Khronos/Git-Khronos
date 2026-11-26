import { expect, test } from '@playwright/test';

for (const interruption of ['stage', 'reopen']) {
  test(`ignores expanded status captured before ${interruption}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async interruption => {
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      const repository = git.repository();
      const old = { ...repository.status, staged: 0, unstaged: 0, untracked: 1,
        entryCount: 1, entriesTruncated: true,
        entries: [{ path: 'new.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false }] };
      const fresh = interruption === 'stage'
        ? { ...old, staged: 1, untracked: 0, entries: [{ ...old.entries[0], indexStatus: 'A', worktreeStatus: ' ' }] }
        : { ...old, untracked: 0, entryCount: 0, entries: [] };
      git.repositories.set([{ ...repository, status: old }]);
      let finish!: (status: unknown) => void;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string) => {
          if (command === 'load_more_changes') return new Promise(resolve => { finish = resolve; });
          if (command === 'stage_all') return Promise.resolve(fresh);
          if (command === 'open_repository') return Promise.resolve({ ...repository, status: fresh });
          return Promise.resolve(null);
        },
      };
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      const loading = git.loadMoreChanges();
      if (interruption === 'stage') await git.stageAll();
      else {
        git.closeRepository(repository.id);
        await git.openRepository(repository.path);
      }
      finish({ ...old, entriesTruncated: false });
      await loading;
      return { status: git.repository().status, expected: fresh };
    }, interruption);
    expect(result.status).toEqual(result.expected);
  });
}

test('expanded status updates the current worktree change count', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    const status = { ...repository.status, staged: 0, unstaged: 0, untracked: 0,
      entryCount: 0, entries: [], entriesTruncated: false };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(status) };
    await git.loadMoreChanges(true);
    return { status: git.repository().status.entryCount,
      worktree: git.repository().worktrees.find((worktree: any) => worktree.current).changes };
  });
  expect(result).toEqual({ status: 0, worktree: 0 });
});

test('loading more changed files preserves keyboard focus and then returns it to the filter', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repo = git.repository();
    const status = { ...repo.status, entryCount: repo.status.entries.length + 2, entriesTruncated: true };
    const test = { requests: 0, finish: (_last: boolean) => {} };
    (window as any).__changedPage = test;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'working_tree_change_summary') return Promise.resolve({ staged: null, unstaged: null });
        if (command !== 'load_more_changes') return Promise.reject(new Error(`Unexpected command ${command}`));
        test.requests += 1;
        return new Promise(resolve => {
          test.finish = (last: boolean) => resolve({ ...status, entriesTruncated: !last, entries: [
            ...status.entries, { path: 'from-next-page.txt', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
            ...(last ? [{ path: 'from-final-page.txt', indexStatus: ' ', worktreeStatus: 'M', conflicted: false }] : []),
          ] });
        });
      },
    };
    git.repositories.set([{ ...repo, status }]);
  });
  const more = page.locator('.change-loader button');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAccessibleName('Loading more changed files…');
  await expect(more).toBeFocused();
  await expect(more).toBeDisabled();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__changedPage.requests)).toBe(1);
  await page.evaluate(() => (window as any).__changedPage.finish(false));
  await expect(more).toHaveAccessibleName(/Show 1,000 more files/);
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAccessibleName('Loading more changed files…');
  expect(await page.evaluate(() => (window as any).__changedPage.requests)).toBe(2);
  await page.evaluate(() => (window as any).__changedPage.finish(true));
  await expect(more).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Filter changed files' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'View changes in from-final-page.txt' })).toBeVisible();
});

test('status pagination stays independent across checkouts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const first = git.repository();
    const status = { ...first.status, entriesTruncated: true };
    git.repositories.set([{
      ...first, status,
    }, {
      ...first, id: 'other-owned', path: '/tmp/other-owned', status,
    }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const requests = new Map<string, () => void>();
    (window as any).__latePageRequests = requests;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: { repoId: string }) => command === 'load_more_changes'
        ? new Promise((resolve, reject) => {
          requests.set(args.repoId, () => args.repoId === 'other-owned'
            ? resolve({ ...status, entriesTruncated: false })
            : reject(new Error('Owned fixture status page failed')));
        })
        : Promise.resolve({ staged: null, unstaged: null }),
    };
  });
  const more = page.locator('.change-loader button');
  await more.click();
  await page.waitForFunction(() => (window as any).__latePageRequests.has('browser-preview'));
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.activeRepositoryId.set('other-owned');
  });
  await expect(more).toBeEnabled();
  await more.click();
  await page.waitForFunction(() => (window as any).__latePageRequests.has('other-owned'));
  await page.evaluate(() => (window as any).__latePageRequests.get('browser-preview')());
  await page.waitForFunction(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    return !git.changesLoadingRepositories().has('browser-preview');
  });
  await expect(more).toHaveAccessibleName('Loading more changed files…');
  await expect(page.locator('.error-toast')).toHaveCount(0);
  await page.evaluate(() => (window as any).__latePageRequests.get('other-owned')());
  await expect.poll(() => page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    return { loading: git.changesLoading(), id: git.repository()?.id, error: git.error() };
  })).toEqual({ loading: false, id: 'other-owned', error: null });
});
