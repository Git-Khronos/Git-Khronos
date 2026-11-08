import { expect, test } from '@playwright/test';

for (const outcome of ['page', 'error']) {
  test(`reopening waits for a closed repository's pending history ${outcome}`, async ({ page }) => {
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
      let openCalled = false;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'load_more_commits') return new Promise((yes, no) => {
          resolve = yes; reject = no;
        });
        if (command === 'open_repository') { openCalled = true; return Promise.resolve(fresh); }
        return Promise.resolve(null);
      } };
      const pending = git.loadMoreHistory();
      git.closeRepository(repository.id);
      const reopening = git.openRepository(repository.path);
      await Promise.resolve();
      const openedBeforePageSettled = openCalled;
      if (outcome === 'error') reject({ message: 'Failure from the closed session' });
      else resolve({ commits: repository.commits, historyTruncated: false });
      const loaded = await pending;
      const opened = await reopening;
      return { loaded, commits: git.repository().commits, truncated: git.repository().historyTruncated,
        error: git.error(), loading: git.historyLoading(), openedBeforePageSettled,
        openCalled, opened: opened.status, expected: fresh.commits };
    }, outcome);
    expect(result.openedBeforePageSettled).toBe(false);
    expect(result.openCalled).toBe(true);
    expect(result.opened).toBe('success');
    expect(result.commits).toEqual(result.expected);
    expect(result.truncated).toBe(true);
    expect(result.error).toBeNull();
    expect(result.loaded).toBe(false);
    expect(result.loading).toBe(false);
  });

  test(`a closed repository's late history ${outcome} cannot affect another tab's page`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async outcome => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const closed = { ...git.repository(), historyTruncated: true };
      const other = { ...closed, id: 'other-repository', path: '/fixture/other',
        commits: [{ ...closed.commits[0], oid: 'other-first' }] };
      const newCommit = { ...other.commits[0], oid: 'other-next' };
      git.repositories.set([closed, other]);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      let resolveOld!: (page: unknown) => void;
      let rejectOld!: (error: unknown) => void;
      let resolveNew!: (page: unknown) => void;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        if (command === 'load_more_commits') return new Promise((yes, no) => {
          if (args.repoId === closed.id) { resolveOld = yes; rejectOld = no; }
          else resolveNew = yes;
        });
        return Promise.resolve(null);
      } };
      const pending = git.loadMoreHistory();
      git.closeRepository(closed.id);
      const replacement = git.loadMoreHistory();
      if (outcome === 'error') rejectOld({ message: 'Failure from the closed session' });
      else resolveOld({ commits: closed.commits, historyTruncated: false });
      const oldLoaded = await pending;
      const loadingAfterOldReply = git.historyLoading();
      const commitsAfterOldReply = git.repository().commits.map((commit: any) => commit.oid);
      const errorAfterOldReply = git.error();
      resolveNew({ commits: [newCommit], historyTruncated: false });
      const newLoaded = await replacement;
      return { oldLoaded, loadingAfterOldReply, commitsAfterOldReply, errorAfterOldReply,
        newLoaded, commits: git.repository().commits.map((commit: any) => commit.oid),
        loading: git.historyLoading(), error: git.error() };
    }, outcome);
    expect(result).toEqual({
      oldLoaded: false, loadingAfterOldReply: true, commitsAfterOldReply: ['other-first'],
      errorAfterOldReply: null, newLoaded: true, commits: ['other-first', 'other-next'],
      loading: false, error: null,
    });
  });

  test(`reopening waits for every outstanding history request after a closed ${outcome}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async outcome => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const closed = { ...git.repository(), historyTruncated: true };
      const other = { ...closed, id: 'other-repository', path: '/fixture/other',
        commits: [{ ...closed.commits[0], oid: 'other-first' }] };
      const fresh = { ...closed, commits: [{ ...closed.commits[0], oid: 'reopened-first' }] };
      git.repositories.set([closed, other]);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      let resolveOld!: (page: unknown) => void;
      let rejectOld!: (error: unknown) => void;
      let resolveOther!: (page: unknown) => void;
      let resolveReopened!: (page: unknown) => void;
      let closedRequests = 0;
      let openCalled = false;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        if (command === 'load_more_commits') return new Promise((yes, no) => {
          if (args.repoId === other.id) resolveOther = yes;
          else if (++closedRequests === 1) { resolveOld = yes; rejectOld = no; }
          else resolveReopened = yes;
        });
        if (command === 'open_repository') { openCalled = true; return Promise.resolve(fresh); }
        return Promise.resolve(null);
      } };
      const pendingOld = git.loadMoreHistory();
      git.closeRepository(closed.id);
      const pendingOther = git.loadMoreHistory();
      const reopening = git.openRepository(closed.path);
      resolveOther({ commits: [{ ...other.commits[0], oid: 'other-next' }], historyTruncated: false });
      const otherLoaded = await pendingOther;
      await new Promise(resolve => setTimeout(resolve, 0));
      const openedBeforeOldSettled = openCalled;
      if (outcome === 'error') rejectOld({ message: 'Failure from the closed session' });
      else resolveOld({ commits: closed.commits, historyTruncated: false });
      const oldLoaded = await pendingOld;
      const opened = await reopening;
      const next = git.loadMoreHistory();
      resolveReopened({ commits: [{ ...fresh.commits[0], oid: 'reopened-next' }], historyTruncated: false });
      const nextLoaded = await next;
      return {
        openedBeforeOldSettled, openCalled, opened: opened.status, otherLoaded, oldLoaded, nextLoaded,
        reopened: git.repository().commits.map((commit: any) => commit.oid),
        other: git.repositories().find((repository: any) => repository.id === other.id)
          .commits.map((commit: any) => commit.oid),
        error: git.error(), loading: git.historyLoading(),
      };
    }, outcome);
    expect(result).toEqual({
      openedBeforeOldSettled: false, openCalled: true, opened: 'success',
      otherLoaded: true, oldLoaded: false, nextLoaded: true,
      reopened: ['reopened-first', 'reopened-next'], other: ['other-first', 'other-next'],
      error: null, loading: false,
    });
  });
}

test('background snapshots wait for every outstanding history request', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const closed = { ...git.repository(), historyTruncated: true };
    const other = { ...closed, id: 'other-repository', path: '/fixture/other',
      commits: [{ ...closed.commits[0], oid: 'other-first' }] };
    const nextCommit = { ...other.commits[0], oid: 'other-next' };
    const refreshed = { ...other, commits: [...other.commits, nextCommit], historyTruncated: false };
    git.repositories.set([closed, other]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    let rejectOld!: (error: unknown) => void;
    let resolveOther!: (page: unknown) => void;
    let refreshCalled = false;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'load_more_commits') return new Promise((yes, no) => {
        if (args.repoId === closed.id) rejectOld = no;
        else resolveOther = yes;
      });
      if (command === 'refresh_repository') { refreshCalled = true; return Promise.resolve(refreshed); }
      if (command === 'refresh_repository_status') return Promise.resolve(other.status);
      return Promise.resolve(null);
    } };
    const pendingOld = git.loadMoreHistory();
    git.closeRepository(closed.id);
    const pendingOther = git.loadMoreHistory();
    const pendingRefresh = git.refreshRepositoryInBackground(other.id);
    resolveOther({ commits: [nextCommit], historyTruncated: false });
    const otherLoaded = await pendingOther;
    await new Promise(resolve => setTimeout(resolve, 0));
    const refreshedBeforeOldSettled = refreshCalled;
    rejectOld({ message: 'Failure from the closed session' });
    const oldLoaded = await pendingOld;
    const didRefresh = await pendingRefresh;
    return {
      refreshedBeforeOldSettled, refreshCalled, didRefresh, otherLoaded, oldLoaded,
      commits: git.repository().commits.map((commit: any) => commit.oid), error: git.error(),
    };
  });
  expect(result).toEqual({
    refreshedBeforeOldSettled: false, refreshCalled: true, didRefresh: true,
    otherLoaded: true, oldLoaded: false, commits: ['other-first', 'other-next'], error: null,
  });
});

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
