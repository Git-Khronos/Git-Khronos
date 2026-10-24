import { expect, test } from '@playwright/test';

for (const outcome of ['page', 'error', 'replacement page']) {
  test(`closed history requests cannot update a reopened repository with a late ${outcome}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async outcome => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = { ...git.repository(), historyTruncated: true };
      const fresh = { ...repository, historyTruncated: true,
        commits: [{ ...repository.commits[0], oid: 'reopened-history', subject: 'New session history' }] };
      git.repositories.set([repository]);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      let resolve!: (page: unknown) => void;
      let reject!: (error: unknown) => void;
      let nextResolve!: (page: unknown) => void;
      let requests = 0;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'load_more_commits') return new Promise((yes, no) => {
          if (++requests === 1) { resolve = yes; reject = no; }
          else nextResolve = yes;
        });
        if (command === 'open_repository') return Promise.resolve(fresh);
        return Promise.resolve(null);
      } };
      const pending = git.loadMoreHistory();
      git.closeRepository(repository.id);
      await git.openRepository(repository.path);
      const replacement = outcome === 'replacement page' ? git.loadMoreHistory() : null;
      if (outcome === 'error') reject({ message: 'Failure from the closed session' });
      else resolve({ commits: repository.commits, historyTruncated: false });
      const loaded = await pending;
      const loadingAfterOldReply = git.historyLoading();
      if (replacement) {
        if (nextResolve) nextResolve({ commits: [], historyTruncated: true });
        await replacement;
      }
      return { loaded, commits: git.repository().commits, truncated: git.repository().historyTruncated,
        error: git.error(), loading: git.historyLoading(), loadingAfterOldReply, expected: fresh.commits };
    }, outcome);
    expect(result.commits).toEqual(result.expected);
    expect(result.truncated).toBe(true);
    expect(result.error).toBeNull();
    expect(result.loaded).toBe(false);
    expect(result.loading).toBe(false);
    expect(result.loadingAfterOldReply).toBe(outcome === 'replacement page');
  });
}

test('history paging still updates an open repository after switching tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = { ...git.repository(), historyTruncated: true };
    const other = { ...repository, id: 'other-repository', path: '/fixture/other' };
    git.repositories.set([repository, other]);
    const commit = { ...repository.commits[0], oid: 'next-history-page' };
    let finish!: (page: unknown) => void;
    (window as any).__TAURI_INTERNALS__ = { invoke: () => new Promise(resolve => { finish = resolve; }) };
    const pending = git.loadMoreHistory();
    git.activateRepository(other.id);
    finish({ commits: [commit], historyTruncated: false });
    const loaded = await pending;
    return { loaded, active: git.activeRepositoryId(),
      original: git.repositories().find((candidate: any) => candidate.id === repository.id).commits.at(-1).oid,
      other: git.repository().commits.some((candidate: any) => candidate.oid === commit.oid) };
  });
  expect(result).toEqual({ loaded: true, active: 'other-repository', original: 'next-history-page', other: false });
});
