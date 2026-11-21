import { expect, test } from '@playwright/test';

test('a repository file event is not lost while a periodic status read is active', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const updated = { ...repository, tags: [
      { name: 'external-ref-update', fullName: 'refs/tags/external-ref-update', oid: repository.headOid },
    ] };
    const fixture: { finish?: () => void; refresh?: Promise<boolean>; metadataReads: number } = { metadataReads: 0 };
    (window as any).__watcherStatusRace = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'refresh_repository_status') {
          if (!fixture.finish) return new Promise(resolve => { fixture.finish = () => resolve(repository.status); });
          return Promise.resolve(repository.status);
        }
        if (command === 'refresh_repository') {
          fixture.metadataReads++;
          return Promise.resolve(updated);
        }
        return Promise.resolve(null);
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    fixture.refresh = git.refreshStatusInBackground(repository.id);
    if (!fixture.finish) throw new Error('expected a pending periodic status read');
    app.scheduleRepositoryRefresh(repository.id);
  });
  await page.clock.runFor(700);
  expect(await page.evaluate(() => (window as any).__watcherStatusRace.metadataReads)).toBe(0);
  await page.evaluate(async () => {
    const fixture = (window as any).__watcherStatusRace;
    fixture.finish();
    await fixture.refresh;
  });
  await page.clock.runFor(2_000);
  const state = await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    return { metadataReads: (window as any).__watcherStatusRace.metadataReads,
      names: git.repository().tags.map((tag: { name: string }) => tag.name) };
  });
  expect(state).toEqual({ metadataReads: 1, names: ['external-ref-update'] });
});

test('continuous repository watcher events cannot postpone a visible refresh indefinitely', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const fixture = { app, repository, reads: 0 };
    (window as any).__watcherBurst = fixture;
    const tags = [{ name: 'external-burst-tag', fullName: 'refs/tags/external-burst-tag', oid: repository.headOid }];
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      if (command === 'refresh_repository') {
        fixture.reads++;
        return { ...repository, tags };
      }
      if (command === 'refresh_repository_status') return repository.status;
      return null;
    } };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
  });
  for (let index = 0; index < 9; index++) {
    await page.evaluate(() => {
      const { app, repository } = (window as any).__watcherBurst;
      app.scheduleRepositoryRefresh(repository.id);
    });
    await page.clock.runFor(200);
  }
  const state = await page.evaluate(() => {
    const { app, reads } = (window as any).__watcherBurst;
    return { reads, tag: app.git.repository().tags.some((tag: { name: string }) => tag.name === 'external-burst-tag') };
  });
  expect(state).toEqual({ reads: 1, tag: true });
});

test('repository change timers retire on close and coalesce for the reopened tab', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const fixture = { app, git, repository, metadataReads: 0 };
    (window as any).__watcherCloseRace = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'open_repository') return Promise.resolve(repository);
        if (command === 'refresh_repository') {
          fixture.metadataReads++;
          return Promise.resolve(repository);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.resolve(null);
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    app.scheduleRepositoryRefresh(repository.id);
  });
  await page.clock.runFor(100);
  const reopened = await page.evaluate(async () => {
    const { git, repository } = (window as any).__watcherCloseRace;
    git.closeRepository(repository.id);
    return await git.openRepository(repository.path);
  });
  expect(reopened.status).toBe('success');
  await page.clock.runFor(500);
  expect(await page.evaluate(() => (window as any).__watcherCloseRace.metadataReads)).toBe(0);
  await page.evaluate(() => {
    const { app, repository } = (window as any).__watcherCloseRace;
    app.scheduleRepositoryRefresh(repository.id);
    app.scheduleRepositoryRefresh(repository.id);
  });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => (window as any).__watcherCloseRace.metadataReads)).toBe(1);
});

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

test('restored tags load after the deferred metadata read meets an in-flight status read', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const thin = { ...repository, tags: [] };
    const full = { ...thin, tags: [{ name: 'retained-tag', fullName: 'refs/tags/retained-tag', oid: repository.commits[0].oid }] };
    const fixture: { release?: () => void; status?: Promise<boolean>; metadataReads: number } = { metadataReads: 0 };
    (window as any).__metadataRace = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'open_repository') return Promise.resolve(thin);
        if (command === 'refresh_repository') {
          fixture.metadataReads++;
          return Promise.resolve(full);
        }
        if (command === 'refresh_repository_status') {
          if (!fixture.release) return new Promise(resolve => { fixture.release = () => resolve(thin.status); });
          return Promise.resolve(full.status);
        }
        return Promise.resolve(null);
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.closeRepository(repository.id);
    await git.openRepository(repository.path);
    fixture.status = git.refreshStatusInBackground(repository.id);
    if (!fixture.release) throw new Error('expected a pending status read');
  });
  const pane = page.locator('#reference-section-tags');
  const heading = pane.locator('.sidebar-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await expect(pane.getByRole('status')).toHaveText('Loading tags…');
  await expect(pane.getByText('No tags', { exact: true })).toHaveCount(0);
  await page.clock.runFor(1_300);
  expect(await page.evaluate(() => (window as any).__metadataRace.metadataReads)).toBe(0);
  await page.evaluate(async () => {
    const fixture = (window as any).__metadataRace;
    fixture.release();
    await fixture.status;
  });
  await page.clock.runFor(1_300);
  await expect(pane.getByRole('button', { name: 'Tag retained-tag' })).toBeVisible();
  await expect(pane.getByRole('status')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__metadataRace.metadataReads)).toBe(1);
  await page.getByRole('searchbox', { name: 'Filter references' }).fill('not-present');
  await expect(pane.getByText('No matching tags', { exact: true })).toBeVisible();
});

test('a failed tags read stays distinguishable from an empty repository and retries from the sidebar', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = { ...git.repository(), tags: [] };
    const state = { reads: 0 };
    (window as any).__tagReadRetry = state;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'open_repository') return Promise.resolve(repository);
        if (command === 'refresh_repository') {
          state.reads++;
          if (state.reads === 1) return Promise.reject(new Error('owned fixture unavailable'));
          return Promise.resolve(repository);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.resolve(null);
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.closeRepository(repository.id);
    await git.openRepository(repository.path);
  });
  const pane = page.locator('#reference-section-tags');
  const heading = pane.locator('.sidebar-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await page.clock.runFor(1_300);
  await expect(pane.getByRole('status')).toHaveText('Could not load tags.');
  await expect(pane.getByText('No tags', { exact: true })).toHaveCount(0);
  await page.clock.runFor(2_500);
  expect(await page.evaluate(() => (window as any).__tagReadRetry.reads)).toBe(1);
  const retry = pane.getByRole('button', { name: 'Retry loading tags' });
  await retry.focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(250);
  await expect(pane.getByText('No tags', { exact: true })).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect(heading).toBeFocused();
  expect(await page.evaluate(() => (window as any).__tagReadRetry.reads)).toBe(2);
});

test('each workspace keeps its own tag-loading state when the same repository is open in both', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const originalWorkspace = git.activeWorkspaceId();
    const thin = { ...git.repository(), tags: [] };
    const hydrated = { ...thin, tags: [{ name: 'shared-tag', fullName: 'refs/tags/shared-tag', oid: thin.commits[0].oid }] };
    const fixture = { git, sharedWorkspace: '', sharedReads: 0 };
    (window as any).__sharedWorkspaceMetadata = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'open_repository') return Promise.resolve(thin);
        if (command === 'refresh_repository') {
          if (git.activeWorkspaceId() === fixture.sharedWorkspace) {
            fixture.sharedReads++;
            return Promise.reject(new Error('owned workspace read failed'));
          }
          return Promise.resolve(hydrated);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(thin.status);
        return Promise.resolve(null);
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.closeRepository(thin.id);
    await git.openRepository(thin.path);
    fixture.sharedWorkspace = (await git.createWorkspace('Shared checkout')).id;
    await git.openRepository(thin.path);
    await git.switchWorkspace(originalWorkspace);
  });
  const pane = page.locator('#reference-section-tags');
  const heading = pane.locator('.sidebar-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await page.clock.runFor(1_300);
  await expect(pane.getByRole('button', { name: 'Tag shared-tag' })).toBeVisible();
  await page.evaluate(async () => {
    const fixture = (window as any).__sharedWorkspaceMetadata;
    await fixture.git.switchWorkspace(fixture.sharedWorkspace);
  });
  await expect(pane.getByRole('status')).toHaveText('Loading tags…');
  await expect(pane.getByText('No tags', { exact: true })).toHaveCount(0);
  await page.clock.runFor(1_300);
  await expect(pane.getByRole('status')).toHaveText('Could not load tags.');
  expect(await page.evaluate(() => (window as any).__sharedWorkspaceMetadata.sharedReads)).toBe(1);
});

for (const read of ['metadata', 'background fetch'] as const) {
  test(`a ${read} reply from an earlier visit cannot replace a revisited workspace`, async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await page.evaluate(async read => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const origin = git.activeWorkspaceId();
      const thin = { ...git.repository(), tags: [] };
      const withTag = (name: string) => ({
        ...thin, tags: [{ name, fullName: `refs/tags/${name}`, oid: thin.commits[0].oid }],
      });
      const fixture: { git: any; origin: string; release?: () => void; reads: number } = { git, origin, reads: 0 };
      (window as any).__revisitedWorkspace = fixture;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string) => {
          if (command === 'open_repository') return Promise.resolve(thin);
          if (command === 'refresh_repository' || command === 'sync_repository') {
            if (++fixture.reads === 1 && (read === 'metadata' || command === 'sync_repository')) {
              return new Promise(resolve => { fixture.release = () => resolve(withTag('retired-tag')); });
            }
            return Promise.resolve(withTag('current-tag'));
          }
          if (command === 'refresh_repository_status') return Promise.resolve(thin.status);
          return Promise.resolve(null);
        },
      };
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      git.closeRepository(thin.id);
      await git.openRepository(thin.path);
      if (read === 'background fetch') void git.fetchInBackground(thin.id);
    }, read);
    if (read === 'metadata') await page.clock.runFor(1_300);
    await page.evaluate(async () => {
      const fixture = (window as any).__revisitedWorkspace;
      if (!fixture.release) throw new Error('expected the first metadata read to be in flight');
      await fixture.git.createWorkspace('Temporary visit');
      await fixture.git.switchWorkspace(fixture.origin);
      fixture.release();
    });
    const pane = page.locator('#reference-section-tags');
    const heading = pane.locator('.sidebar-heading');
    if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
    await expect(pane.getByRole('status')).toHaveText('Loading tags…');
    await expect(pane.getByRole('button', { name: 'Tag retired-tag' })).toHaveCount(0);
    await page.clock.runFor(1_300);
    await expect(pane.getByRole('button', { name: 'Tag current-tag' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__revisitedWorkspace.reads)).toBe(2);
  });
}

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

test('retries inconsistent branch snapshots without looping or losing untracked files', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const initial = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const knownEntry = { path: 'known.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false };
    const nextEntry = { path: 'after-checkout.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false };
    const known = { ...repository.status, entries: [knownEntry], entryCount: 1, staged: 0, unstaged: 0, untracked: 1 };
    const stale = { ...known, entries: [], entryCount: 0, untracked: 0 };
    const complete = { ...stale, branch: 'externally-checked-out', entries: [nextEntry], entryCount: 1, untracked: 1 };
    const fixture = { git, commands: [] as string[], snapshots: 0 };
    (window as any).__branchRefreshFixture = fixture;
    git.repositories.update((repositories: any[]) => repositories.map((candidate) =>
      candidate.id === repository.id ? { ...candidate, status: known } : candidate));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        fixture.commands.push(command);
        if (command === 'refresh_repository_status') return Promise.resolve(complete);
        if (command === 'refresh_repository') {
          fixture.snapshots++;
          const status = fixture.snapshots < 3 ? stale : { ...stale, branch: complete.branch };
          return Promise.resolve({ ...repository, status });
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const refreshed = await git.refreshStatusInBackground(repository.id, true);
    return { refreshed, commands: [...fixture.commands], status: git.repository().status };
  });
  expect(initial.refreshed).toBe(false);
  expect(initial.commands).toEqual(['refresh_repository_status', 'refresh_repository', 'refresh_repository_status']);
  expect(initial.status.entries.map((entry: { path: string }) => entry.path)).toEqual(['known.txt']);

  await expect.poll(() => page.evaluate(() => (window as any).__branchRefreshFixture.git.repository().status.branch),
    { timeout: 10_000 }).toBe('externally-checked-out');
  const result = await page.evaluate(() => {
    const fixture = (window as any).__branchRefreshFixture;
    return { snapshots: fixture.snapshots, status: fixture.git.repository().status };
  });
  expect(result.snapshots).toBe(3);
  expect(result.status.untracked).toBe(1);
  expect(result.status.entries.map((entry: { path: string }) => entry.path)).toEqual(['after-checkout.txt']);
});

test('reports an inconsistent branch after a manual refresh', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const commands: string[] = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        commands.push(command);
        if (command === 'refresh_repository') return Promise.resolve(repository);
        if (command === 'refresh_repository_status') {
          return Promise.resolve({ ...repository.status, branch: 'externally-checked-out' });
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    await git.refresh();
    return { error: git.error(), commands };
  });
  expect(result.commands).toEqual(['refresh_repository', 'refresh_repository_status']);
  expect(result.error).toBe('Could not refresh repository status. Try again.');
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
