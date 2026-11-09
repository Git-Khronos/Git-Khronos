import { expect, test } from '@playwright/test';

for (const interruption of ['stage', 'reopen']) {
  test(`ignores expanded status captured before ${interruption}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async interruption => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
