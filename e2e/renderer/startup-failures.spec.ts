import { expect, test, type Page } from '@playwright/test';

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

async function holdSavedRepositoryStartup(page: Page) {
  const snapshot = await page.evaluate(() => ({
    ...(window as any).ng.getComponent(document.querySelector('gc-root')).git.repository(),
    id: 'saved-startup',
    path: '/owned/startup-project',
    name: 'startup-project',
  }));
  await page.addInitScript(repository => {
    const scope = window as any;
    const fixture: any = { mounts: 0, calls: [] };
    scope.__savedStartup = fixture;
    const workspace = { id: 'default', name: 'Default', repositoryPaths: [repository.path], activeRepositoryPath: repository.path };
    localStorage.setItem('git-khronos.workspaces.v1', JSON.stringify([workspace]));
    localStorage.setItem('git-khronos.recent-repositories.v1', JSON.stringify([repository.path]));
    new MutationObserver(records => {
      fixture.mounts += records.flatMap(record => [...record.addedNodes]).filter(node =>
        node instanceof Element && (node.matches('gc-welcome-launcher') || node.querySelector('gc-welcome-launcher')),
      ).length;
    }).observe(document, { subtree: true, childList: true });
    scope.isTauri = true;
    scope.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      invoke(command: string, args: any) {
        fixture.calls.push({ command, args });
        if (command === 'system_info') return new Promise(resolve => {
          fixture.start = () => resolve({ appVersion: 'owned native startup', gitVersion: '2.53.0', gitSupported: true, minimumGitVersion: '2.39.0' });
        });
        if (command === 'plugin:event|listen') return Promise.resolve(1);
        if (command === 'incoming_repository_links') return Promise.resolve({ requests: [], overflowed: false });
        if (command === 'repository_link_read_policies') return Promise.resolve({});
        if (command === 'open_repository') return new Promise((resolve, reject) => {
          fixture.success = () => resolve(repository);
          fixture.failure = () => reject(new Error('Owned repository unavailable'));
        });
        if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(repository);
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.resolve(null);
      },
    };
  }, snapshot);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__savedStartup.start)).toBe('function');
}

test('restores a saved repository without mounting the welcome launcher', async ({ page }) => {
  await holdSavedRepositoryStartup(page);
  const startup = page.getByRole('heading', { name: 'Restoring saved repository…' });
  await expect(startup).toBeVisible();
  await expect(page.locator('gc-welcome-launcher')).toHaveCount(0);
  await page.evaluate(() => (window as any).__savedStartup.start());
  await expect.poll(() => page.evaluate(() => typeof (window as any).__savedStartup.success)).toBe('function');
  await expect(startup).toBeVisible();
  await page.evaluate(() => (window as any).__savedStartup.success());
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await expect(startup).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__savedStartup.mounts)).toBe(0);
});

test('shows the welcome launcher after startup cannot restore a saved repository', async ({ page }) => {
  await holdSavedRepositoryStartup(page);
  await page.evaluate(() => (window as any).__savedStartup.start());
  await expect.poll(() => page.evaluate(() => typeof (window as any).__savedStartup.failure)).toBe('function');
  await expect(page.locator('gc-welcome-launcher')).toHaveCount(0);
  await page.evaluate(() => (window as any).__savedStartup.failure());
  await expect(page.locator('gc-welcome-launcher').getByRole('button', { name: /Open repository/ })).toBeVisible();
  await expect(page.locator('.error-toast')).toContainText('Could not restore 1 saved repository: startup-project');
});

test('a keyboard user can request the launcher before saved restoration completes', async ({ page }) => {
  await holdSavedRepositoryStartup(page);
  const show = page.getByRole('button', { name: 'Show repository launcher' });
  await show.focus();
  await show.press('Enter');
  await expect(page.locator('gc-welcome-launcher').getByRole('button', { name: /Open repository/ })).toBeFocused();
  await page.evaluate(() => (window as any).__savedStartup.start());
  await expect.poll(() => page.evaluate(() => typeof (window as any).__savedStartup.success)).toBe('function');
  await page.evaluate(() => (window as any).__savedStartup.success());
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await expect(page.locator('gc-welcome-launcher')).toHaveCount(0);
});

test('keeps a local-open entry point if the welcome code cannot load', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('gc-welcome-launcher') && body.includes('welcome-launcher-title')) await route.abort();
    else await route.fulfill({ response, body });
  });
  await holdSavedRepositoryStartup(page);
  await page.getByRole('button', { name: 'Show repository launcher' }).click();
  const fallback = page.getByRole('main', { name: 'Repository launcher unavailable' });
  await expect(fallback.getByRole('alert')).toContainText('The launcher could not load.');
  await expect(fallback.getByRole('button', { name: 'Open repository…' })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__savedStartup.calls.filter((call: any) => call.command === 'open_repository'))).toEqual([]);
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
