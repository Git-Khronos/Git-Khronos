import { expect, test, type Page } from '@playwright/test';

const file = 'fresh.txt';
const patch = 'diff --git a/fresh.txt b/fresh.txt\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/fresh.txt\n@@ -0,0 +1,3 @@\n+first\n+second\n+third\n';

async function mockNewFile(page: Page, truncated = false, stale = false): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(({ file, patch, truncated, stale }) => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const status = {
      ...repository.status, staged: 0, unstaged: 0, untracked: 1, entryCount: 1,
      entries: [{ path: file, originalPath: null, indexStatus: '?', worktreeStatus: '?', conflicted: false }],
    };
    git.repositories.update((repositories: any[]) => repositories.map((item) =>
      item.id === repository.id ? { ...item, status } : item));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { calls: [] as Array<{ command: string; args: any }>, status, patch, stale };
    (window as any).__newFileTest = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'inspect_working_tree_file') return Promise.resolve({
          path: file, staged: args.staged, patch: fixture.patch, truncated,
        });
        if (command === 'apply_working_tree_lines' || command === 'apply_working_tree_hunk') {
          if (fixture.stale) return Promise.reject({
            kind: 'staleDiffSelection', message: 'The file changed. Nothing was staged. Reload the diff.',
          });
          return Promise.resolve({
            ...status, staged: 1, unstaged: 1, untracked: 0,
            entries: [{ ...status.entries[0], indexStatus: 'A', worktreeStatus: 'M' }],
          });
        }
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  }, { file, patch, truncated, stale });
  await page.getByTitle(`View changes in ${file}`).click();
  await expect(page.getByLabel('Diff viewer')).toBeVisible();
}

test('stages only chosen new-file lines with the displayed native preview', async ({ page }) => {
  await mockNewFile(page);
  const diff = page.getByLabel('Diff viewer');
  const selector = diff.getByRole('button', { name: 'Select added line 2', exact: true });
  await selector.focus();
  await page.keyboard.press('Space');
  const actions = diff.getByRole('group', { name: 'Selected line actions' });
  await expect(actions).toContainText('1 selected');
  await expect(actions.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0);
  await expect(diff.getByRole('button', { name: 'Discard Hunk', exact: true })).toBeDisabled();
  await actions.getByRole('button', { name: 'Stage', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__newFileTest.calls);
  expect(calls.find((call: { command: string }) => call.command === 'apply_working_tree_lines')).toEqual({
    command: 'apply_working_tree_lines',
    args: { repoId: expect.any(String), path: file, staged: false, hunkIndex: 0,
      lineIndices: [1], action: 'stage', expectedPatch: patch },
  });
  expect(calls.some((call: { command: string }) => ['stage_path', 'stage_all'].includes(call.command))).toBe(false);
});

test('allows explicit full-hunk staging of a new text file', async ({ page }) => {
  await mockNewFile(page);
  await page.getByLabel('Diff viewer').getByRole('button', { name: 'Stage Hunk', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__newFileTest.calls);
  expect(calls.find((call: { command: string }) => call.command === 'apply_working_tree_hunk')).toEqual({
    command: 'apply_working_tree_hunk',
    args: { repoId: expect.any(String), path: file, staged: false, hunkIndex: 0,
      action: 'stage', expectedPatch: patch },
  });
});

test('does not allow individual staging from a truncated new-file preview', async ({ page }) => {
  await mockNewFile(page, true);
  const diff = page.getByLabel('Diff viewer');
  await expect(diff.getByRole('button', { name: 'Select added line 2', exact: true })).toBeDisabled();
  await expect(diff.getByRole('button', { name: 'Stage Hunk', exact: true })).toBeDisabled();
  await expect(diff).toContainText('Preview truncated');
});

test('retains failed selections and offers an explicit fresh-diff retry', async ({ page }) => {
  await mockNewFile(page, false, true);
  const diff = page.getByLabel('Diff viewer');
  await diff.getByRole('button', { name: 'Select added line 2', exact: true }).click();
  await diff.getByRole('group', { name: 'Selected line actions' }).getByRole('button', { name: 'Stage', exact: true }).click();
  await expect(page.locator('.error-toast')).toContainText('Nothing was staged');
  await expect(diff.getByRole('button', { name: 'Deselect added line 2', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__newFileTest.patch = (window as any).__newFileTest.patch.replace('+second', '+updated');
  });
  await diff.getByRole('button', { name: 'Reload diff', exact: true }).click();
  await expect(diff).toContainText('updated');
  await expect(diff.getByRole('group', { name: 'Selected line actions' })).toHaveCount(0);
  await expect(diff.getByRole('button', { name: 'Select added line 2', exact: true })).toBeEnabled();
});
