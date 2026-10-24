import { expect, test } from '@playwright/test';

for (const operation of ['discardPath', 'hunk', 'lines']) {
  for (const scenario of ['unrelated-error', 'dismissed-failure']) {
    test(`${operation} records discard recovery from its own ${scenario} outcome`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      await page.evaluate(({ operation, scenario }) => {
        const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
        const repository = git.repository();
        git.repositories.set([repository, { ...repository, id: 'other-working-tree', path: '/fixture/other', name: 'Other' }]);
        git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
        const state: any = { git, repository };
        (window as any).__workingTreeTest = state;
        (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
          if (command === 'inspect_commit') return Promise.reject({ message: 'Unrelated inspection failed' });
          if (command === 'refresh_repository_status') {
            if (scenario === 'dismissed-failure') git.dismissError();
            return Promise.resolve(repository.status);
          }
          return new Promise((resolve, reject) => { state.finish = () => scenario === 'dismissed-failure'
            ? reject({ message: 'Discard refused' }) : resolve(repository.status); });
        } };
        state.pending = operation === 'discardPath' ? git.discardPath('file.txt', false)
          : operation === 'hunk' ? git.applyWorkingTreeHunk('file.txt', false, 0, 'discard')
          : git.applyWorkingTreeLines('file.txt', false, 0, [0], 'discard');
      }, { operation, scenario });
      await page.locator('[data-repository-tab-id="other-working-tree"]').click();
      const result = await page.evaluate(async scenario => {
        const state = (window as any).__workingTreeTest;
        if (scenario === 'unrelated-error') await state.git.inspectCommit(state.git.repository().headOid);
        state.finish();
        await state.pending;
        return state.git.operationHistory()[state.repository.id] ?? null;
      }, scenario);
      if (scenario === 'unrelated-error') expect(result).toMatchObject({ kind: 'discard', undone: false });
      else expect(result).toBeNull();
    });
  }
}

for (const operation of ['hunk', 'lines', 'stagePath']) {
  for (const navigation of ['other-tab', 'new-file', 'closed-diff', 'unchanged']) {
    if (operation === 'stagePath' && navigation === 'unchanged') continue;
    test(`${operation} completion preserves inspection after ${navigation}`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.commit-row').first()).toBeVisible();
      const result = await page.evaluate(async ({ operation, navigation }) => {
        const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
        const original = git.repository();
        const entries = ['file.txt', 'new-file.txt'].map(path => ({ path, indexStatus: ' ', worktreeStatus: 'M', conflicted: false }));
        const repository = { ...original, status: { ...original.status, entries, entryCount: 2, unstaged: 2 } };
        const other = { ...repository, id: 'inspection-other', path: '/fixture/inspection-other' };
        git.repositories.set([repository, other]);
        git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
        const calls: any[] = [];
        let finish!: (status: unknown) => void;
        (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
          calls.push({ command, args });
          if (command === 'inspect_working_tree_file') return Promise.resolve({
            path: args.path, staged: args.staged, patch: `diff for ${args.repoId}/${args.path}`, truncated: false,
          });
          return new Promise(resolve => { finish = resolve; });
        } };
        await git.inspectWorkingTreeFile('file.txt', false);
        const pending = operation === 'hunk' ? git.applyWorkingTreeHunk('file.txt', false, 0, 'stage')
          : operation === 'lines' ? git.applyWorkingTreeLines('file.txt', false, 0, [0], 'stage')
          : git.stagePath('file.txt');
        if (navigation === 'other-tab') git.activateRepository(other.id);
        if (navigation === 'closed-diff') git.clearWorkingTreeInspection();
        else if (navigation !== 'unchanged') await git.inspectWorkingTreeFile('new-file.txt', false);
        const expected = { selected: git.selectedWorkingTreeFile(), diff: git.workingTreeFileDiff() };
        const inspections = calls.filter(call => call.command === 'inspect_working_tree_file').length;
        finish(repository.status);
        await pending;
        return { expected, actual: { selected: git.selectedWorkingTreeFile(), diff: git.workingTreeFileDiff() },
          inspections, actualInspections: calls.filter(call => call.command === 'inspect_working_tree_file').length };
      }, { operation, navigation });
      expect(result.actual).toEqual(result.expected);
      expect(result.actualInspections).toBe(result.inspections + (navigation === 'unchanged' ? 1 : 0));
    });
  }
}
