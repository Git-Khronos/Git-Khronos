import { expect, test } from '@playwright/test';

for (const command of ['push_repository', 'force_push_repository', 'publish_branch'] as const) {
  test(`${command} updates remote decorations in the same completion turn`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
    const result = await page.evaluate(async (command) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const git = app.git;
      const before = git.repository();
      // Prime the graph cache before accepting a snapshot with unchanged commit OIDs.
      const oldRows = app.graphRows();
      const oldSegments = oldRows.map((row: any) => row.segments);
      const snapshot = {
        ...before,
        status: { ...before.status, ahead: 0, behind: 0 },
        branches: before.branches.map((branch: any) => branch.name === 'origin/main'
          ? { ...branch, oid: before.headOid }
          : branch.current ? { ...branch, tracking: null } : branch),
        commits: before.commits.map((commit: any) => ({
          ...commit,
          decorations: [
            ...commit.decorations.filter((name: string) => name !== 'origin/main'),
            ...(commit.oid === before.headOid ? ['origin/main'] : []),
          ],
        })),
        worktrees: before.worktrees.map((worktree: any) => worktree.current
          ? { ...worktree, ahead: 0, behind: 0 } : worktree),
      };
      const calls: string[] = [];
      let complete!: (snapshot: unknown) => void;
      let staleRefresh!: (snapshot: unknown) => void;
      let staleStatus!: (status: unknown) => void;
      let statusRequests = 0;
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (name: string) => {
          calls.push(name);
          if (name === command) return new Promise(resolve => { complete = resolve; });
          if (name === 'refresh_repository') return new Promise(resolve => { staleRefresh = resolve; });
          // Leave status reconciliation pending: the graph must not depend on it.
          if (name === 'refresh_repository_status') {
            statusRequests += 1;
            return statusRequests === 1
              ? new Promise(resolve => { staleStatus = resolve; })
              : new Promise(() => {});
          }
          return Promise.reject(new Error(`Unexpected command ${name}`));
        },
      };
      const refresh = git.refreshRepositoryInBackground(before.id);
      const statusRefresh = git.refreshStatusInBackground(before.id, true);
      const push = git.mutate(command, 'Pushing…', 'Push complete', { remote: 'origin', branch: 'main' });
      const pendingRemote = git.repository().branches.find((branch: any) => branch.name === 'origin/main').oid;
      complete(snapshot);
      await push;
      const rows = app.graphRows();
      const completed = {
        activity: git.activity(), busy: git.busy(),
        ahead: git.repository().status.ahead,
        remote: git.repository().branches.find((branch: any) => branch.name === 'origin/main').oid,
        decorated: rows.filter((row: any) => row.commit.decorations.includes('origin/main')).map((row: any) => row.commit.oid),
        geometryReused: rows.every((row: any, i: number) => row.segments === oldSegments[i]),
      };
      // A refresh started before the push must not restore the old remote tip.
      staleRefresh(before);
      staleStatus(before.status);
      await refresh;
      await statusRefresh;
      (window as any).ng.applyChanges(app);
      const decoratedRows = [...document.querySelectorAll<HTMLElement>('.commit-row[data-commit-oid]')]
        .filter(row => row.querySelector('[aria-label="Remote branch origin/main"]'))
        .map(row => row.dataset['commitOid']);
      return { pendingRemote, oldRemote: before.branches.find((branch: any) => branch.name === 'origin/main').oid,
        head: before.headOid, completed, decoratedRows, finalAhead: git.repository().status.ahead, calls };
    }, command);
    expect(result.pendingRemote).toBe(result.oldRemote);
    expect(result.completed).toEqual({
      activity: 'Push complete', busy: false, ahead: 0, remote: result.head,
      decorated: [result.head], geometryReused: true,
    });
    expect(result.decoratedRows).toEqual([result.head]);
    expect(result.finalAhead).toBe(0);
    expect(result.calls.filter(call => call === command)).toHaveLength(1);
  });
}

test('a rejected push never moves the remote decoration to the local tip', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const before = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (name: string) => {
        if (name === 'push_repository') return Promise.reject({ kind: 'gitFailure', message: 'Push rejected' });
        if (name === 'refresh_repository') return Promise.resolve(before);
        if (name === 'refresh_repository_status') return Promise.resolve(before.status);
        return Promise.reject(new Error(`Unexpected command ${name}`));
      },
    };
    await git.remote('push_repository', { remote: 'origin', branch: 'main' });
    return {
      ahead: git.repository().status.ahead, error: git.error(),
      decorated: app.graphRows().filter((row: any) => row.commit.decorations.includes('origin/main')).map((row: any) => row.commit.oid),
      old: before.branches.find((branch: any) => branch.name === 'origin/main').oid,
    };
  });
  expect(result.ahead).toBe(1);
  expect(result.error).toContain('Push rejected');
  expect(result.decorated).toEqual([result.old]);
});
