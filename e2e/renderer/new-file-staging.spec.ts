import { expect, test, type Page } from '@playwright/test';

const file = 'fresh.txt';
const patch = 'diff --git a/fresh.txt b/fresh.txt\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/fresh.txt\n@@ -0,0 +1,3 @@\n+first\n+second\n+third\n';

async function mockNewFile(page: Page, truncated = false, stale = false, staged = false,
  trackedPatch?: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(({ file, patch, truncated, stale, staged, tracked }) => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const status = {
      ...repository.status, staged: staged ? 1 : 0, unstaged: tracked ? 1 : 0, untracked: staged || tracked ? 0 : 1, entryCount: 1,
      entries: [{ path: file, originalPath: null, indexStatus: staged ? 'A' : tracked ? '.' : '?',
        worktreeStatus: staged ? ' ' : tracked ? 'M' : '?', conflicted: false }],
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
  }, { file, patch: trackedPatch ?? patch, truncated, stale, staged, tracked: trackedPatch !== undefined });
  await page.getByTitle(`${staged ? 'View staged changes in' : 'View changes in'} ${file}`).click();
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

test('patch-like text inside a hunk retains its line numbers and exact native selection', async ({ page }) => {
  const trackedPatch = [
    'diff --git a/fresh.txt b/fresh.txt', 'index 1111111..2222222 100644',
    '--- a/fresh.txt', '+++ b/fresh.txt', '@@ -1,4 +1,4 @@',
    '--- old heading', '+++ new heading', ' keep one', ' keep two', '-old tail', '+new tail',
    '\\ No newline at end of file', '',
  ].join('\n');
  await mockNewFile(page, false, false, false, trackedPatch);
  const diff = page.getByLabel('Diff viewer');
  await expect(diff.locator('.diff-additions')).toHaveText('+2');
  await expect(diff.locator('.diff-deletions')).toHaveText('−2');
  await expect(diff.getByRole('button', { name: 'Select added line 1', exact: true })).toBeVisible();
  await expect(diff.getByRole('button', { name: 'Select removed line 1', exact: true })).toBeVisible();
  const marker = diff.locator('.focus-diff-line').filter({ hasText: 'No newline at end of file' });
  await expect(marker).toBeVisible();
  await expect(marker).not.toHaveAttribute('data-diff-new-line', /./);
  await expect(marker).not.toHaveAttribute('data-diff-old-line', /./);
  await diff.getByRole('button', { name: 'Select added line 4', exact: true }).click();
  await diff.getByRole('group', { name: 'Selected line actions' }).getByRole('button', { name: 'Stage', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__newFileTest.calls);
  expect(calls.find((call: { command: string }) => call.command === 'apply_working_tree_lines')).toEqual({
    command: 'apply_working_tree_lines',
    args: { repoId: expect.any(String), path: file, staged: false, hunkIndex: 0,
      lineIndices: [2, 3], action: 'stage', expectedPatch: trackedPatch },
  });
});

test('end-of-file notices do not split a replacement into independently selected lines', async ({ page }) => {
  const trackedPatch = [
    'diff --git a/fresh.txt b/fresh.txt', 'index 1111111..2222222 100644',
    '--- a/fresh.txt', '+++ b/fresh.txt', '@@ -1 +1 @@',
    '-old final line', '\\ No newline at end of file',
    '+new final line', '\\ No newline at end of file', '',
  ].join('\n');
  await mockNewFile(page, false, false, false, trackedPatch);
  const diff = page.getByLabel('Diff viewer');
  await diff.locator('[data-diff-mode="split"]').click();
  const row = diff.locator('.split-row').filter({ hasText: 'old final line' });
  await expect(row).toContainText('new final line');
  await expect(diff.getByText('Before: No newline at end of file', { exact: true })).toBeVisible();
  await expect(diff.getByText('After: No newline at end of file', { exact: true })).toBeVisible();
  await diff.locator('[data-diff-mode="inline"]').click();
  await diff.getByRole('button', { name: 'Select added line 1', exact: true }).click();
  await expect(diff.getByRole('button', { name: 'Deselect removed line 1', exact: true })).toBeVisible();
  await diff.getByRole('group', { name: 'Selected line actions' }).getByRole('button', { name: 'Stage', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__newFileTest.calls);
  expect(calls.find((call: { command: string }) => call.command === 'apply_working_tree_lines')?.args)
    .toMatchObject({ hunkIndex: 0, lineIndices: [0, 1], expectedPatch: trackedPatch });
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

test('unstages only chosen new-file lines with the displayed native preview', async ({ page }) => {
  await mockNewFile(page, false, false, true);
  const diff = page.getByLabel('Diff viewer');
  await diff.getByRole('button', { name: 'Select added line 2', exact: true }).click();
  await diff.getByRole('group', { name: 'Selected line actions' }).getByRole('button', { name: 'Unstage', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__newFileTest.calls);
  expect(calls.find((call: { command: string }) => call.command === 'apply_working_tree_lines')).toEqual({
    command: 'apply_working_tree_lines',
    args: { repoId: expect.any(String), path: file, staged: true, hunkIndex: 0,
      lineIndices: [1], action: 'unstage', expectedPatch: patch },
  });
  expect(calls.some((call: { command: string }) => ['unstage_path', 'unstage_all'].includes(call.command))).toBe(false);
});

test('allows explicit full-hunk unstage of a staged new text file', async ({ page }) => {
  await mockNewFile(page, false, false, true);
  await page.getByLabel('Diff viewer').getByRole('button', { name: 'Unstage Hunk', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__newFileTest.calls);
  expect(calls.find((call: { command: string }) => call.command === 'apply_working_tree_hunk')).toEqual({
    command: 'apply_working_tree_hunk',
    args: { repoId: expect.any(String), path: file, staged: true, hunkIndex: 0,
      action: 'unstage', expectedPatch: patch },
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
