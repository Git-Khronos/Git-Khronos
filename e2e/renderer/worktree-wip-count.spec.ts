import { expect, test } from '@playwright/test';

for (const mode of ['background', 'manual', 'mutation', 'overview'] as const) {
  for (const trackedCount of mode === 'background' ? [0, 1] : [1]) {
    test(`keeps the WIP count consistent after ${mode} snapshots with ${trackedCount} tracked ${trackedCount === 1 ? 'change' : 'changes'}`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      const fixture = await page.evaluate(async ({ mode, trackedCount }) => {
        const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
        const repository = git.repository();
        const tracked = trackedCount
          ? [{ path: 'tracked.txt', indexStatus: 'M', worktreeStatus: 'M', conflicted: false }]
          : [];
        const untracked = Array.from({ length: 5 }, (_, index) => ({
          path: `new-${index}.txt`, indexStatus: '?', worktreeStatus: '?', conflicted: false,
        }));
        const complete = { ...repository.status, ahead: 3, behind: 2, staged: trackedCount, unstaged: trackedCount,
          untracked: untracked.length, conflicted: 0, entryCount: tracked.length + untracked.length,
          entries: [...tracked, ...untracked], entriesTruncated: false };
        const fast = { ...complete, untracked: 0, entryCount: tracked.length, entries: tracked };
        const initial = { ...repository, status: complete, worktrees: repository.worktrees.map((worktree: any) =>
          worktree.current ? { ...worktree, changes: complete.entryCount, ahead: complete.ahead, behind: complete.behind }
            : worktree) };
        const snapshot = { ...initial, status: fast, worktrees: initial.worktrees.map((worktree: any) =>
          worktree.current ? { ...worktree, changes: fast.entryCount } : worktree) };
        git.repositories.set([initial]);
        git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
        let finish!: (status: unknown) => void;
        let statusRequested!: () => void;
        const started = new Promise<void>(resolve => { statusRequested = resolve; });
        (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
          if (command === 'refresh_repository' || command === 'create_branch') return Promise.resolve(snapshot);
          if (command === 'refresh_repository_status') {
            statusRequested();
            return mode === 'overview' ? Promise.resolve(complete) : new Promise(resolve => { finish = resolve; });
          }
          return Promise.resolve(null);
        } };
        const pending = mode === 'background' ? git.refreshRepositoryInBackground(repository.id)
          : mode === 'manual' ? git.refresh()
            : mode === 'mutation' ? git.createBranch('new-branch')
              : git.refreshWorkspaceOverview();
        if (mode === 'overview') await pending;
        else await started;
        (window as any).__wipCount = { git, pending, finish: () => finish(complete) };
        return { count: complete.entryCount, path: repository.path };
      }, { mode, trackedCount });

      const row = page.locator('.wip-row:not(.linked-worktree)');
      const linked = page.locator('.wip-row.linked-worktree');
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('aria-label', `Working directory, branch main, ${fixture.count} changed files`);
      await expect(row.locator('.commit-description')).toContainText(`${fixture.count} changed files`);
      await expect(row.locator('.wip-commit-main')).toHaveAttribute('title', `${fixture.count} changed files in ${fixture.path}`);
      await expect(page.locator('.wip-nav small')).toHaveText(`${fixture.count} changed files`);
      await expect(page.locator('.worktree-list-item.current b')).toHaveText(`${fixture.count} WIP`);
      await expect(linked).toHaveAttribute('aria-label', 'Linked worktree git-khronos-partial-staging, branch feature/partial-staging, 2 changed files');

      if (mode !== 'overview') {
        await page.evaluate(async () => {
          const fixture = (window as any).__wipCount;
          fixture.finish();
          await fixture.pending;
        });
        await expect.poll(() => page.evaluate(() => (window as any).__wipCount.git.liveRefreshes.size)).toBe(0);
        await expect(row).toHaveAttribute('aria-label', `Working directory, branch main, ${fixture.count} changed files`);
      }
    });
  }
}

test('counts a newly tracked file once while preserving other untracked changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const tracked = { path: 'tracked.txt', indexStatus: 'M', worktreeStatus: 'M', conflicted: false };
    const untracked = Array.from({ length: 5 }, (_, index) => ({
      path: `new-${index}.txt`, indexStatus: '?', worktreeStatus: '?', conflicted: false,
    }));
    const previous = { ...repository.status, staged: 1, unstaged: 1, untracked: 5, conflicted: 0,
      entryCount: 6, entries: [tracked, ...untracked], entriesTruncated: false };
    const newlyTracked = { ...untracked[0], indexStatus: 'A', worktreeStatus: ' ' };
    const fast = { ...previous, staged: 2, untracked: 0, entryCount: 2, entries: [tracked, newlyTracked] };
    const complete = { ...fast, untracked: 4, entryCount: 6, entries: [tracked, newlyTracked, ...untracked.slice(1)] };
    const snapshot = { ...repository, status: fast, worktrees: repository.worktrees.map((worktree: any) =>
      worktree.current ? { ...worktree, changes: 2 } : worktree) };
    git.repositories.set([{ ...repository, status: previous }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    let finish!: (status: unknown) => void;
    let statusRequested!: () => void;
    const started = new Promise<void>(resolve => { statusRequested = resolve; });
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'refresh_repository') return Promise.resolve(snapshot);
      if (command === 'refresh_repository_status') return new Promise(resolve => { finish = resolve; statusRequested(); });
      return Promise.resolve(null);
    } };
    const pending = git.refreshRepositoryInBackground(repository.id);
    await started;
    (window as any).__wipCount = { pending, finish: () => finish(complete) };
    const status = git.repository().status;
    return { entryCount: status.entryCount, untracked: status.untracked, paths: status.entries.map((entry: any) => entry.path) };
  });

  expect(result).toEqual({ entryCount: 6, untracked: 4,
    paths: ['tracked.txt', 'new-0.txt', 'new-1.txt', 'new-2.txt', 'new-3.txt', 'new-4.txt'] });
  const row = page.locator('.wip-row:not(.linked-worktree)');
  await expect(row).toHaveAttribute('aria-label', 'Working directory, branch main, 6 changed files');
  await expect(row.locator('.commit-description')).toContainText('6 changed files');
  await expect(page.locator('.wip-nav small')).toHaveText('6 changed files');
  await page.evaluate(async () => {
    const fixture = (window as any).__wipCount;
    fixture.finish();
    await fixture.pending;
  });
  await expect(row).toHaveAttribute('aria-label', 'Working directory, branch main, 6 changed files');
});

test('retains the WIP count when untracked paths are outside a truncated status', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const entry = { path: 'tracked.txt', indexStatus: 'M', worktreeStatus: 'M', conflicted: false };
    const previous = { ...repository.status, staged: 1, unstaged: 1, untracked: 5, conflicted: 0,
      entryCount: 6, entries: [entry], entriesTruncated: true };
    const fast = { ...previous, untracked: 0, entryCount: 1, entriesTruncated: false };
    const snapshot = { ...repository, status: fast, worktrees: repository.worktrees.map((worktree: any) =>
      worktree.current ? { ...worktree, changes: 1 } : worktree) };
    git.repositories.set([{ ...repository, status: previous }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    let finish!: (status: unknown) => void;
    let statusRequested!: () => void;
    const started = new Promise<void>(resolve => { statusRequested = resolve; });
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'refresh_repository') return Promise.resolve(snapshot);
      if (command === 'refresh_repository_status') return new Promise(resolve => { finish = resolve; statusRequested(); });
      return Promise.resolve(null);
    } };
    const pending = git.refreshRepositoryInBackground(repository.id);
    await started;
    (window as any).__wipCount = { pending, finish: () => finish(previous) };
    const status = git.repository().status;
    return { entryCount: status.entryCount, untracked: status.untracked, entriesTruncated: status.entriesTruncated };
  });

  expect(result).toEqual({ entryCount: 6, untracked: 5, entriesTruncated: true });
  const row = page.locator('.wip-row:not(.linked-worktree)');
  await expect(row).toHaveAttribute('aria-label', 'Working directory, branch main, 6 changed files');
  await expect(page.locator('.wip-nav small')).toHaveText('6 changed files');
  await page.evaluate(async () => {
    const fixture = (window as any).__wipCount;
    fixture.finish();
    await fixture.pending;
  });
  await expect(row).toHaveAttribute('aria-label', 'Working directory, branch main, 6 changed files');
});

for (const count of [0, 6]) {
  test(`reconciles an unchanged status with a stale current worktree count of ${count ? 0 : 4}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async count => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const entries = Array.from({ length: count }, (_, index) => ({
        path: `new-${index}.txt`, indexStatus: '?', worktreeStatus: '?', conflicted: false,
      }));
      const status = { ...repository.status, ahead: 3, behind: 2, staged: 0, unstaged: 0, untracked: count,
        conflicted: 0, entryCount: count, entries, entriesTruncated: false };
      const worktrees = repository.worktrees.map((worktree: any) => worktree.current
        ? { ...worktree, changes: count ? 0 : 4, ahead: 0, behind: 0 }
        : worktree);
      git.repositories.set([{ ...repository, status, worktrees }]);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(status) };
      await git.refreshStatusInBackground(repository.id, true);
      const refreshed = git.repository();
      return {
        statusPreserved: refreshed.status === status,
        current: refreshed.worktrees.find((worktree: any) => worktree.current),
        linked: refreshed.worktrees.find((worktree: any) => !worktree.current),
      };
    }, count);

    expect(result.statusPreserved).toBe(true);
    expect(result.current).toMatchObject({ changes: count, ahead: 3, behind: 2 });
    expect(result.linked).toMatchObject({ changes: 2, ahead: 0, behind: 0 });
    const row = page.locator('.wip-row:not(.linked-worktree)');
    if (count) {
      await expect(row).toHaveAttribute('aria-label', `Working directory, branch main, ${count} changed files`);
    } else {
      await expect(row).toHaveCount(0);
    }
  });
}

test('keeps repository identities when status and current worktree already agree', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const unchanged = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repositories = git.repositories();
    const repository = git.repository();
    const status = { ...repository.status, entries: repository.status.entries.map((entry: any) => ({ ...entry })) };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(status) };
    await git.refreshStatusInBackground(repository.id, true);
    return git.repositories() === repositories && git.repository() === repository;
  });
  expect(unchanged).toBe(true);
});
