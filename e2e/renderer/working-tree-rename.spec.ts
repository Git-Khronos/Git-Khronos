import { expect, test } from '@playwright/test';

test('the Stage and Unstage buttons move both reviewed rename paths through native commands', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  const repoId = await page.evaluate(() => {
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
      if (command === 'working_tree_change_summary') return { staged: null, unstaged: null };
      return current;
    } };
    git.repositories.set([{ ...repo, status: current }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    return repo.id as string;
  });
  const stage = page.getByRole('button', { name: 'Stage after.txt', exact: true });
  await expect(stage).toHaveAttribute('title', 'Stage before.txt → after.txt');
  await stage.click();
  await page.getByRole('button', { name: 'Unstage after.txt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stage before.txt', exact: true })).toBeVisible();
  await expect(stage).toHaveAttribute('title', 'Stage after.txt');
  expect(await page.evaluate(() => (window as any).__indexRenameCalls)).toEqual([
    { command: 'stage_worktree_rename', args: { repoId, source: 'before.txt', destination: 'after.txt' } },
    { command: 'unstage_index_rename', args: { repoId, source: 'before.txt', destination: 'after.txt' } },
  ]);
});
