import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const state: any = { app, replies: [], calls: [], fresh: { baseOid: 'new-base', targetOid: 'new-target', workingTree: false, files: [] } };
    (window as any).__historyComparison = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'compare_history_revisions') return new Promise((resolve, reject) => state.replies.push({ resolve, reject }));
      if (command === 'compare_commits' || command === 'compare_commit_with_working_tree') return Promise.resolve({ ...state.fresh, workingTree: command !== 'compare_commits' });
      if (command === 'inspect_commit') return Promise.resolve({ oid: args.oid, message: 'New selection', files: [], signature: { status: 'unsigned' } });
      if (command === 'inspect_working_tree_file') return Promise.resolve({ path: args.path, staged: false, patch: 'new working-tree diff', truncated: false });
      if (command === 'compare_commit_file') return Promise.resolve({ oid: args.targetOid, path: args.path, patch: 'comparison diff', truncated: false });
      return Promise.resolve(null);
    } };
  });
}

for (const selection of ['history-newer', 'graph', 'working-tree', 'commit', 'file', 'clear', 'tab-cycle']) {
  test(`history comparison cannot replace a newer ${selection} inspection`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async selection => {
      const state = (window as any).__historyComparison;
      const { git, historySearch } = state.app;
      const first = historySearch.compare('old-base', 'old-target', 'direct');
      if (selection === 'history-newer') {
        const next = historySearch.compare('new-base', 'new-target', 'mergeBase');
        state.replies[1].resolve(state.fresh);
        await next;
      }
      if (selection === 'graph') await git.compareCommits('new-base', 'new-target');
      if (selection === 'working-tree') await git.compareCommitWithWorkingTree('new-base');
      if (selection === 'commit') await git.inspectCommit(git.repository().headOid);
      if (selection === 'file') await git.inspectWorkingTreeFile('new-file.txt', false);
      if (selection === 'clear') git.clearComparisonInspection();
      if (selection === 'tab-cycle') {
        const repo = git.repository();
        git.repositories.update((repositories: any[]) => [...repositories, { ...repo, id: 'comparison-other', path: '/fixture/comparison-other' }]);
        git.activateRepository('comparison-other');
        git.activateRepository(repo.id);
      }
      const expected = { comparison: git.commitComparison(), details: git.commitDetails(),
        selectedFile: git.selectedWorkingTreeFile(), diff: git.workingTreeFileDiff() };
      if (selection === 'graph') historySearch.cancelComparison();
      state.replies[0].resolve({ ...state.fresh, targetOid: 'obsolete-target' });
      await first;
      return { expected, actual: { comparison: git.commitComparison(), details: git.commitDetails(),
        selectedFile: git.selectedWorkingTreeFile(), diff: git.workingTreeFileDiff() } };
    }, selection);
    expect(result.actual).toEqual(result.expected);
  });
}

for (const mode of ['direct', 'mergeBase']) {
  test(`current ${mode} history comparison keeps its mode and opens the first file`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async mode => {
      const state = (window as any).__historyComparison;
      const pending = state.app.historySearch.compare('base-ref', 'target-ref', mode);
      state.replies[0].resolve({ ...state.fresh, files: [{ path: 'compared.txt', previousPath: null, status: 'M', additions: 1, deletions: 0 }] });
      await pending;
      return { comparison: state.app.git.commitComparison(), selected: state.app.git.selectedComparisonFile(),
        diff: state.app.git.comparisonFileDiff(), args: state.calls[0].args };
    }, mode);
    expect(result.comparison.comparisonMode).toBe(mode);
    expect(result.selected).toBe('compared.txt');
    expect(result.diff.path).toBe('compared.txt');
    expect(result.args).toMatchObject({ base: 'base-ref', target: 'target-ref', mode });
  });
}

for (const outcome of ['success', 'error']) {
  test(`closed history comparison ${outcome} cannot disturb a reopened pending comparison`, async ({ page }) => {
    await prepare(page);
    const opener = page.getByRole('button', { name: 'Search all repository history', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Search repository history', exact: true });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      const state = (window as any).__historyComparison;
      state.component = (window as any).ng.getComponent(document.querySelector('gc-history-search'));
      state.first = state.component.compare();
    });
    await dialog.getByRole('button', { name: 'Close history search', exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    const result = await page.evaluate(async outcome => {
      const state = (window as any).__historyComparison;
      const clearedOnClose = state.app.git.commitComparison();
      const busyOnReopen = state.component.comparing();
      state.component.target = 'new-target';
      state.second = state.component.compare();
      if (outcome === 'error') state.replies[0].reject({ message: 'Obsolete comparison failed' });
      else state.replies[0].resolve({ ...state.fresh, targetOid: 'obsolete-target' });
      await state.first;
      return { clearedOnClose, busyOnReopen, busy: state.component.comparing(), error: state.component.comparisonError(),
        comparison: state.app.git.commitComparison(), dialogOpen: document.querySelector('gc-history-search dialog')?.hasAttribute('open') };
    }, outcome);
    expect(result).toEqual({ clearedOnClose: null, busyOnReopen: false, busy: true, error: null, comparison: null, dialogOpen: true });
    await page.evaluate(async () => {
      const state = (window as any).__historyComparison;
      state.replies[1].resolve(state.fresh);
      await state.second;
    });
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => (window as any).__historyComparison.app.git.commitComparison().targetOid)).toBe('new-target');
  });
}

test('current history comparison errors stay in the open dialog', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Search all repository history', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search repository history', exact: true });
  await expect(dialog).toBeVisible();
  const error = await page.evaluate(async () => {
    const state = (window as any).__historyComparison;
    const component = (window as any).ng.getComponent(document.querySelector('gc-history-search'));
    const pending = component.compare();
    state.replies[0].reject({ message: 'Current comparison failed' });
    await pending;
    return component.comparisonError();
  });
  expect(error).toBe('Current comparison failed');
  await expect(dialog).toBeVisible();
});
