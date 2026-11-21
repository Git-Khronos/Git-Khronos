import { expect, test, type Page } from '@playwright/test';

async function installRename(page: Page): Promise<string> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  return page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repo = git.repository();
    const { status } = repo;
    const make = (indexStatus: string, worktreeStatus: string) => ({
      ...status, staged: indexStatus === 'R' ? 1 : 0, unstaged: worktreeStatus === 'R' ? 1 : 0,
      untracked: 0, conflicted: 0, entryCount: 1, entriesTruncated: false,
      entries: [{ path: 'after.txt', previousPath: 'before.txt', indexStatus, worktreeStatus, conflicted: false }],
    });
    let current = make(' ', 'R');
    const staged = make('R', ' ');
    const reset = {
      ...make(' ', 'R'), untracked: 1, entryCount: 2,
      entries: [
        { path: 'before.txt', indexStatus: ' ', worktreeStatus: 'D', conflicted: false },
        { path: 'after.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false },
      ],
    };
    const calls: { command: string; args: any }[] = [];
    (window as any).__indexRenameCalls = calls;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'stage_worktree_rename') {
        current = staged;
      } else if (command === 'unstage_index_rename') {
        current = reset;
      }
      if (command.includes('stage_')) calls.push({ command, args });
      if (command === 'inspect_working_tree_file') {
        calls.push({ command, args });
        return { ...args, truncated: false, patch: [
          'diff --git a/before.txt b/after.txt', 'similarity index 80%',
          'rename from before.txt', 'rename to after.txt',
          '--- a/before.txt', '+++ b/after.txt', '@@ -1,2 +1,2 @@',
          ' retained', '-old', '+new', '',
        ].join('\n') };
      }
      if (command === 'working_tree_change_summary') return { staged: null, unstaged: null };
      return current;
    } };
    git.repositories.set([{ ...repo, status: current }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    return repo.id as string;
  });
}

for (const layout of ['Path', 'Tree'] as const) {
  test(`the Stage and Unstage buttons move both reviewed rename paths in the ${layout} layout`, async ({ page }) => {
    const repoId = await installRename(page);
    await page.getByRole('button', { name: layout, exact: true }).click();
    const unstaged = page.getByRole('region', { name: 'Unstaged files' });
    const staged = page.getByRole('region', { name: 'Staged files' });
    const stage = unstaged.getByRole('button', { name: 'Stage after.txt', exact: true });
    const unstage = staged.getByRole('button', { name: 'Unstage after.txt', exact: true });
    await expect(stage).toHaveAttribute('title', 'Stage before.txt → after.txt');
    await stage.click();
    await expect(unstage).toHaveAttribute('title', 'Unstage before.txt → after.txt');
    await expect(staged.getByRole('button', { name: 'Discard changes in after.txt' })).toHaveCount(0);
    await unstage.click();
    await expect(unstaged.getByRole('button', { name: 'Stage before.txt', exact: true })).toBeVisible();
    await expect(stage).toHaveAttribute('title', 'Stage after.txt');
    expect(await page.evaluate(() => (window as any).__indexRenameCalls)).toEqual([
      { command: 'stage_worktree_rename', args: { repoId, source: 'before.txt', destination: 'after.txt' } },
      { command: 'unstage_index_rename', args: { repoId, source: 'before.txt', destination: 'after.txt' } },
    ]);
  });
}

test('working-tree rename filtering and the diff use the source path without offering partial changes', async ({ page }) => {
  const repoId = await installRename(page);
  await page.getByRole('searchbox', { name: 'Filter changed files' }).fill('before.txt');
  const row = page.locator('#unstaged-files-list').getByRole('button', { name: 'View changes in after.txt' });
  await expect(row).toBeVisible();
  await expect(page.getByRole('img', { name: 'Renamed from before.txt, not staged yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  await row.click();
  const diff = page.getByRole('region', { name: 'Diff viewer' });
  await expect(diff.getByText('Renamed from before.txt', { exact: true })).toBeVisible();
  await expect(diff.getByText('Stage or unstage the whole rename from Changes.')).toBeVisible();
  await expect(diff.locator('.diff-additions')).toContainText('+1');
  await expect(diff.locator('.diff-deletions')).toContainText('−1');
  await expect(diff.getByRole('button', { name: 'Stage Hunk' })).toHaveCount(0);
  await expect(diff.getByRole('button', { name: /select added line/i })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__indexRenameCalls)).toEqual([
    { command: 'inspect_working_tree_file', args: { repoId, path: 'after.txt', staged: false, previousPath: 'before.txt' } },
  ]);
});
