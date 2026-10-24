import { expect, test } from '@playwright/test';

test('ignores status replies started before closing and reopening a repository', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const status = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const fresh = { ...repository, status: { ...repository.status,
      entries: [], entryCount: 0, staged: 0, unstaged: 0, untracked: 0 } };
    let reply!: (status: unknown) => void;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'refresh_repository_status') return new Promise(resolve => { reply = resolve; });
        if (command === 'open_repository') return Promise.resolve(fresh);
        return Promise.resolve(null);
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const refresh = git.refreshStatusInBackground(repository.id);
    git.closeRepository(repository.id);
    await git.openRepository(repository.path);
    reply(repository.status);
    await refresh;
    return git.repository().status;
  });
  expect(status.entries).toEqual([]);
  expect(status.entryCount).toBe(0);
});

test('keeps untracked discovery after an external branch change', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const clean = { ...repository.status, branch: 'externally-checked-out',
      entries: [], entryCount: 0, staged: 0, unstaged: 0, untracked: 0 };
    const complete = { ...clean, untracked: 1, entryCount: 1,
      entries: [{ path: 'after-checkout.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false }] };
    const commands: string[] = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        commands.push(command);
        if (command === 'refresh_repository') return Promise.resolve({ ...repository, status: clean });
        if (command === 'refresh_repository_status') return Promise.resolve(complete);
        return Promise.resolve(null);
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    await git.refreshStatusInBackground(repository.id);
    return { status: git.repository().status, commands };
  });
  expect(result.commands).toContain('refresh_repository');
  expect(result.status.branch).toBe('externally-checked-out');
  expect(result.status.untracked).toBe(1);
  expect(result.status.entries.map((entry: { path: string }) => entry.path)).toEqual(['after-checkout.txt']);
  await expect(page.getByRole('button', { name: 'Stage all changes', exact: true })).toBeEnabled();
});

for (const mode of ['background', 'manual', 'fetch']) {
  test(`discovers untracked files after a ${mode} metadata refresh`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async (mode) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const git = app.git;
      const repository = git.repository();
      const clean = { ...repository.status, entries: [], entryCount: 0, staged: 0, unstaged: 0, untracked: 0 };
      const snapshot = { ...repository, status: clean };
      const complete = { ...clean, untracked: 1, entryCount: 1,
        entries: [{ path: 'new-file.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false }] };
      const commands: string[] = [];
      git.repositories.set([snapshot]);
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string) => {
          commands.push(command);
          if (command === 'refresh_repository' || command === 'sync_repository') return Promise.resolve(snapshot);
          if (command === 'refresh_repository_status') return Promise.resolve(complete);
          return Promise.resolve(null);
        },
      };
      git.systemInfo.set({ appVersion: 'renderer test', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' });
      if (mode === 'background') await git.refreshRepositoryInBackground(repository.id);
      else if (mode === 'fetch') await git.fetchInBackground(repository.id);
      else await git.refresh();
      return { paths: git.repository().status.entries.map((entry: { path: string }) => entry.path), commands };
    }, mode);
    expect(result.commands).toContain('refresh_repository_status');
    expect(result.paths).toEqual(['new-file.txt']);
    await expect(page.getByRole('button', { name: 'Stage all changes', exact: true })).toBeEnabled();
  });
}
