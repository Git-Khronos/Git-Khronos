import { expect, test } from '@playwright/test';

for (const outcome of ['success', 'error', 'cancelled']) {
  for (const navigation of ['other-tab', 'new-file', 'closed-diff', 'unchanged']) {
    test(`snapshot mutation ${outcome} preserves inspection after ${navigation}`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      const result = await page.evaluate(async ({ outcome, navigation }) => {
        const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
        const repository = git.repository();
        const other = { ...repository, id: 'other-snapshot', path: '/fixture/other-snapshot' };
        git.repositories.set([repository, other]);
        git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
        let finish!: () => void;
        (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
          if (command === 'inspect_working_tree_file') return Promise.resolve({
            path: args.path, staged: args.staged, patch: `diff for ${args.repoId}/${args.path}`, truncated: false,
          });
          if (command === 'refresh_repository') return Promise.resolve(repository);
          if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
          if (command === 'fetch_repository') return new Promise((resolve, reject) => {
            finish = () => outcome === 'success' ? resolve(repository)
              : reject({ kind: outcome === 'cancelled' ? 'operationCancelled' : 'gitFailure', message: outcome });
          });
          return Promise.resolve(null);
        } };
        await git.inspectWorkingTreeFile('original.txt', false);
        const pending = git.remote('fetch_repository');
        if (navigation === 'other-tab') git.activateRepository(other.id);
        if (navigation === 'closed-diff') git.clearWorkingTreeInspection();
        else if (navigation !== 'unchanged') await git.inspectWorkingTreeFile('new-file.txt', false);
        const expected = { selected: git.selectedWorkingTreeFile(), diff: git.workingTreeFileDiff() };
        finish();
        await pending;
        return { expected, actual: { selected: git.selectedWorkingTreeFile(), diff: git.workingTreeFileDiff() },
          activity: git.activityLogs().at(-1).status };
      }, { outcome, navigation });
      expect(result.activity).toBe(outcome);
      expect(result.actual).toEqual(navigation === 'unchanged' ? { selected: null, diff: null } : result.expected);
    });
  }
}

for (const outcome of ['error', 'cancelled']) {
  for (const change of ['newer-mutation', 'reopened', 'unchanged']) {
    test(`${outcome} recovery cannot replace a ${change} repository snapshot`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      const head = await page.evaluate(async ({ outcome, change }) => {
        const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
        const repository = git.repository();
        const newer = { ...repository, headOid: 'newer-head' };
        const stale = { ...repository, headOid: 'recovery-head' };
        git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
        let finish!: (value: unknown) => void;
        let started!: () => void;
        let newerMutations = 0;
        const recoveryStarted = new Promise<void>(resolve => { started = resolve; });
        (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
          if (command === 'fetch_repository') return Promise.reject({
            kind: outcome === 'cancelled' ? 'operationCancelled' : 'gitFailure', message: outcome,
          });
          if (command === 'refresh_repository') return new Promise(resolve => { finish = resolve; started(); });
          if (command === 'pull_repository') { newerMutations++; return Promise.resolve(newer); }
          if (command === 'open_repository') return Promise.resolve(newer);
          if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
          return Promise.resolve(null);
        } };
        const pending = git.remote('fetch_repository');
        await recoveryStarted;
        if (change === 'newer-mutation') await git.remote('pull_repository');
        if (change === 'reopened') {
          git.closeRepository(repository.id);
          await git.openRepository(repository.path);
        }
        finish(stale);
        await pending;
        return { head: git.repository().headOid, newerMutations };
      }, { outcome, change });
      expect(head).toEqual({
        head: change === 'unchanged' ? 'recovery-head' : 'newer-head',
        newerMutations: change === 'newer-mutation' ? 1 : 0,
      });
    });
  }
}
