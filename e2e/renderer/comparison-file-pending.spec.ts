import { expect, test } from '@playwright/test';

for (const outcome of ['success', 'error']) {
  test(`old comparison file ${outcome} cannot clear the next file's loading indicator`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await page.evaluate(() => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const files = ['first.txt', 'second.txt'].map(path => ({ path, previousPath: null, status: 'M', additions: 1, deletions: 0 }));
      const replies: Array<{ resolve: (value: unknown) => void; reject: (value: unknown) => void }> = [];
      const state: any = { git, files, replies };
      (window as any).__pendingComparisonFile = state;
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'compare_commits') return Promise.resolve({
          baseOid: 'base', targetOid: 'target', workingTree: false, files, lineTotalsPartial: false,
        });
        if (command === 'compare_commit_file') return new Promise((resolve, reject) => replies.push({ resolve, reject }));
        return Promise.resolve(null);
      } };
      state.comparison = git.compareCommits('base', 'target');
    });
    await page.waitForFunction(() => (window as any).__pendingComparisonFile.replies.length === 1);
    await page.evaluate(() => {
      const state = (window as any).__pendingComparisonFile;
      state.selected = state.git.inspectComparisonFile(state.files[1]);
    });
    await page.waitForFunction(() => (window as any).__pendingComparisonFile.replies.length === 2);
    const held = await page.evaluate(async outcome => {
      const state = (window as any).__pendingComparisonFile;
      if (outcome === 'error') state.replies[0].reject({ message: 'The retired file read failed' });
      else state.replies[0].resolve({ oid: 'target', path: 'first.txt', patch: 'retired patch', truncated: false });
      await state.comparison;
      const git = state.git;
      return { busy: git.detailsBusy(), selected: git.selectedComparisonFile(), diff: git.comparisonFileDiff(), error: git.error() };
    }, outcome);
    expect(held).toEqual({ busy: true, selected: 'second.txt', diff: null, error: null });

    const settled = await page.evaluate(async () => {
      const state = (window as any).__pendingComparisonFile;
      state.replies[1].resolve({ oid: 'target', path: 'second.txt', patch: 'selected patch', truncated: false });
      await state.selected;
      return { busy: state.git.detailsBusy(), diff: state.git.comparisonFileDiff()?.patch };
    });
    expect(settled).toEqual({ busy: false, diff: 'selected patch' });
  });
}
