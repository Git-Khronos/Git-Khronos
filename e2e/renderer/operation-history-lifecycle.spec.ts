import { expect, test } from '@playwright/test';

const operations = ['checkout', 'checkoutRemote', 'updateHeadMessage', 'cherryPick', 'revertCommit', 'revertCommits', 'commit', 'renameBranch'];
for (const { operation, unrelatedError } of operations.flatMap(operation =>
  [false, true].map(unrelatedError => ({ operation, unrelatedError })))) {
  test(`${operation} records undo targets after a tab switch${unrelatedError ? ' with an unrelated inspection error' : ''}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await page.evaluate(operation => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const other = { ...repository, id: 'other-history', name: 'Other history', path: '/fixture/other-history',
        headOid: 'other-repository-head', status: { ...repository.status, branch: 'other-repository-branch' } };
      const fresh = { ...repository, headOid: 'originating-repository-head',
        status: { ...repository.status, branch: 'originating-repository-branch' } };
      git.repositories.set([repository, other]);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      const state: any = { git, repository, fresh, calls: [] };
      (window as any).__operationHistoryTest = state;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: unknown) => {
        state.calls.push({ command, args });
        if (command === 'inspect_commit') return Promise.reject({ message: 'Other repository inspection failed' });
        if (command === 'refresh_repository_status') return Promise.resolve(fresh.status);
        if (!state.started) {
          state.started = true;
          return new Promise(resolve => { state.finish = () => resolve(fresh); });
        }
        return Promise.resolve(fresh);
      } };
      const methods: Record<string, () => Promise<unknown>> = {
        checkout: () => git.checkout('feature/partial-staging'),
        checkoutRemote: () => git.checkoutRemote('origin/release'),
        updateHeadMessage: () => git.updateHeadMessage(repository.headOid, 'Edited title'),
        cherryPick: () => git.cherryPick([repository.commits[3].oid]),
        revertCommit: () => git.revertCommit(repository.commits[3].oid),
        revertCommits: () => git.revertCommits(repository.commits.slice(2, 4).map((commit: any) => commit.oid)),
        commit: () => git.commit('New commit'),
        renameBranch: () => git.renameBranch('main', 'renamed-main'),
      };
      state.pending = methods[operation]();
    }, operation);
    await page.locator('[data-repository-tab-id="other-history"]').click();
    const result = await page.evaluate(async ({ operation, unrelatedError }) => {
      const { git, repository, fresh, finish, pending, calls } = (window as any).__operationHistoryTest;
      if (unrelatedError) await git.inspectCommit(git.repository().headOid);
      finish();
      const outcome = await pending;
      const error = git.error();
      const entry = git.operationHistory()[repository.id];
      const otherEntry = git.operationHistory()['other-history'];
      const active = git.activeRepositoryId();
      git.activateRepository(repository.id);
      await git.undo();
      await git.redo();
      return { entry, otherEntry: otherEntry ?? null, active, calls, outcome, error,
        expectedBefore: operation.startsWith('checkout') ? repository.status.branch : repository.headOid,
        expectedAfter: operation.startsWith('checkout') ? fresh.status.branch : fresh.headOid };
    }, { operation, unrelatedError });
    expect(result.active).toBe('other-history');
    expect(result.otherEntry).toBeNull();
    expect(result.error).toBe(unrelatedError ? 'Other repository inspection failed' : null);
    if (operation === 'commit' || operation === 'updateHeadMessage') expect(result.outcome).toBe(true);
    if (operation === 'renameBranch') {
      expect(result.entry).toMatchObject({ kind: 'rename-branch', beforeName: 'main', afterName: 'renamed-main' });
      expect(result.calls.filter((call: any) => call.command === 'rename_branch').at(-1).args)
        .toMatchObject({ oldName: 'main', newName: 'renamed-main' });
    } else if (operation.startsWith('checkout')) {
      expect(result.entry).toMatchObject({ beforeBranch: result.expectedBefore, afterBranch: result.expectedAfter });
      expect(result.calls.filter((call: any) => call.command === 'checkout_branch').at(-1).args.name).toBe(result.expectedAfter);
    } else {
      expect(result.entry).toMatchObject({ beforeOid: result.expectedBefore, afterOid: result.expectedAfter });
      expect(result.calls.filter((call: any) => call.command === 'move_head').at(-1).args)
        .toMatchObject({ expectedOid: result.expectedBefore, targetOid: result.expectedAfter });
    }
  });
}

for (const operation of ['checkout', 'revertCommit', 'commit', 'renameBranch']) {
  test(`${operation} does not record failed work when its error is dismissed during refresh`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const entry = await page.evaluate(async operation => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const partial = { ...repository, headOid: 'partially-changed-head',
        status: { ...repository.status, branch: 'partially-changed-branch' } };
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'refresh_repository_status') return Promise.resolve(partial.status);
        if (command === 'refresh_repository') {
          // Dismissing a toast during error recovery must not turn a failure
          // into a successful operation-history entry, even if Git changed.
          git.dismissError();
          return Promise.resolve(partial);
        }
        return Promise.reject({ message: 'Mutation refused after a partial change' });
      } };
      const methods: Record<string, () => Promise<unknown>> = {
        checkout: () => git.checkout('feature/partial-staging'),
        revertCommit: () => git.revertCommit(repository.commits[3].oid),
        commit: () => git.commit('Refused commit'),
        renameBranch: () => git.renameBranch('main', 'renamed-main'),
      };
      await methods[operation]();
      return git.operationHistory()[repository.id] ?? null;
    }, operation);
    expect(entry).toBeNull();
  });
}
