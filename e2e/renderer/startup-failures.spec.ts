import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
});

test('reports native startup failures without presenting sample data', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.repositories.set([]);
    git.activeRepositoryId.set(null);
    git.systemInfo.set(null);
    git.error.set(null);
    (globalThis as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async () => {
        throw new Error('Native bridge unavailable');
      },
    };

    await git.initialize();
    return {
      error: git.error(),
      repositoryCount: git.repositories().length,
      browserPreview: git.browserPreview(),
    };
  });

  expect(result).toEqual({
    error: 'Native bridge unavailable',
    repositoryCount: 0,
    browserPreview: false,
  });

  const toast = page.locator('.error-toast');
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss error' }).focus();
  await page.keyboard.press('Escape');
  await expect(toast).toBeHidden();
});

test('preserves saved repository paths and reports when none can be restored', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const savedWorkspace = {
      id: 'default',
      name: 'Default',
      repositoryPaths: ['/repos/missing-project'],
      activeRepositoryPath: '/repos/missing-project',
    };
    localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify([savedWorkspace]));
    git.workspaces.set([savedWorkspace]);
    git.activeWorkspaceId.set('default');
    git.repositories.set([]);
    git.activeRepositoryId.set(null);
    git.systemInfo.set(null);
    git.error.set(null);
    (globalThis as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === 'system_info') {
          return {
            appVersion: '0.1.0',
            gitVersion: '2.50.0',
            gitSupported: true,
            minimumGitVersion: '2.39.0',
          };
        }
        if (command === 'open_repository') throw new Error('Folder is unavailable');
        throw new Error(`Unexpected command: ${command}`);
      },
    };

    await git.initialize();
    return {
      error: git.error(),
      storedPaths: JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!)[0].repositoryPaths,
      repositoryCount: git.repositories().length,
    };
  });

  expect(result.error).toContain('Could not restore 1 saved repository: missing-project');
  expect(result.storedPaths).toEqual(['/repos/missing-project']);
  expect(result.repositoryCount).toBe(0);
});


test('preserves unavailable paths when another saved repository restores', async ({ page }) => {
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const snapshot = { ...git.repository(), path: '/repos/available-project' };
    const savedWorkspace = {
      id: 'default', name: 'Default',
      repositoryPaths: ['/repos/missing-project', snapshot.path],
      activeRepositoryPath: '/repos/missing-project',
    };
    const other = { id: 'other', name: 'Other', repositoryPaths: [], activeRepositoryPath: null };
    localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify([savedWorkspace, other]));
    git.workspaces.set([savedWorkspace, other]);
    git.activeWorkspaceId.set('default');
    git.repositories.set([]);
    git.activeRepositoryId.set(null);
    git.error.set(null);
    (globalThis as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: { path?: string }) => {
        if (command === 'system_info') return { appVersion: '0.1.0', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' };
        if (command === 'open_repository') {
          if (args.path === snapshot.path) return snapshot;
          throw new Error('Folder is unavailable');
        }
        if (command === 'refresh_repository') return snapshot;
        if (command === 'refresh_repository_status') return snapshot.status;
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    await git.initialize();
  });
  await expect(page.locator('.error-toast')).toContainText('Could not restore 1 saved repository: missing-project');
  const state = await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    return {
      restoredPaths: git.repositories().map((repo: { path: string }) => repo.path),
      savedPaths: JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!)[0].repositoryPaths,
    };
  });
  expect(state.restoredPaths).toEqual(['/repos/available-project']);
  expect(state.savedPaths).toEqual(['/repos/missing-project', '/repos/available-project']);

  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.activateRepository(git.activeRepositoryId());
    await git.switchWorkspace('other');
  });
  const afterSwitch = await page.evaluate(() => JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!)[0].repositoryPaths);
  expect(afterSwitch).toEqual(['/repos/missing-project', '/repos/available-project']);

  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    await git.switchWorkspace('default');
    git.closeRepository(git.activeRepositoryId());
  });
  const afterClose = await page.evaluate(() => JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!)[0].repositoryPaths);
  expect(afterClose).toEqual(['/repos/missing-project']);
});

test('announces operation outcomes in a persistent status region', async ({ page }) => {
  const status = page.locator('[data-git-operation-status]');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await page.evaluate(() => {
    (window as any).ng.getComponent(document.querySelector('gc-root')).git.activity.set('Fetch completed');
  });
  await expect(status).toHaveText('Git status: Fetch completed');
});

test('shows LFS entries without full working-tree files in the toolbar and options', async ({ page }) => {
  await page.goto('/?lfs-preview');
  await expect(page.locator('.lfs-pointer-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Git LFS options', exact: true }).click();
  await expect(page.locator('.lfs-menu-status')).toContainText('2 not materialized');
});

test('discloses an unavailable LFS count without reporting zero or blocking LFS work', async ({ page }) => {
  await page.goto('/?lfs-preview');
  await expect(page.locator('.lfs-pointer-count')).toHaveText('2');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((repositories: any[]) => repositories.map(repo => ({
      ...repo, lfs: { ...repo.lfs, trackedFiles: null, pointerFiles: null },
    })));
  });
  await expect(page.locator('.lfs-pointer-count')).toHaveCount(0);
  await page.getByRole('button', { name: 'Git LFS options', exact: true }).click();
  await expect(page.locator('.lfs-menu-status')).toContainText('File counts unavailable');
  await expect(page.locator('.lfs-menu-status')).not.toContainText('0 tracked files');
  await expect(page.getByRole('menuitem', { name: /Pull LFS objects/ })).toBeEnabled();
});
