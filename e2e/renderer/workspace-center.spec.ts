import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, section: boolean | 'files' = false) {
  await page.getByRole('button', { name: /^Workspace: / }).click();
  const item = section === 'files' ? 'Repository files' : section ? 'Identity profiles' : 'Repository overview';
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  return page.getByRole('dialog', { name: 'Workspace center', exact: true });
}

async function installFileBrowser(page: Page, repositoryFileCreationAvailable = true) {
  await page.evaluate((canCreate) => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test', repositoryFileCreationAvailable: canCreate }));
    fixture.calls = [];
    fixture.files = [
      { path: 'a.txt', tracked: true, ignored: false, symbolicLink: false, deletable: true },
      { path: 'b.txt', tracked: false, ignored: false, symbolicLink: false, deletable: false, deletableWithRecovery: true },
      { path: 'ignored.log', tracked: false, ignored: true, symbolicLink: false, deletable: false },
      { path: 'z.txt', tracked: false, ignored: false, symbolicLink: false, deletable: false, deletableWithRecovery: true },
    ];
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'list_repository_files') {
        if (fixture.listError) return Promise.reject(fixture.listError);
        if (fixture.holdQuery === args.query) return new Promise(resolve => {
          fixture.releaseQuery = () => resolve({
            files: [{ path: 'STALE.txt', tracked: true, ignored: false, symbolicLink: false, deletable: true }],
            nextCursor: null, incomplete: false,
          });
        });
        const files = fixture.files
          .filter((file: any) => file.path.toLowerCase().includes(args.query.toLowerCase()))
          .filter((file: any) => !args.cursor || file.path > args.cursor)
          .sort((a: any, b: any) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const page = files.slice(0, 2);
        return Promise.resolve({ files: page, nextCursor: files.length > 2 ? page.at(-1).path : null, incomplete: !!fixture.incomplete });
      }
      if (command === 'create_repository_file') {
        if (fixture.createError) return Promise.reject(fixture.createError);
        if (fixture.holdCreate) return new Promise(resolve => {
          fixture.releaseCreate = () => {
            fixture.files.push({ path: args.path, tracked: false, ignored: false, symbolicLink: false, deletable: false });
            resolve({ snapshot: null, refreshError: { kind: 'refreshFailed', message: 'Snapshot unavailable.', hint: 'Refresh later.' } });
          };
        });
        return Promise.resolve({ snapshot: fixture.first, refreshError: null });
      }
      if (command === 'delete_repository_file' || command === 'delete_untracked_repository_file') {
        if (fixture.deleteError) return Promise.reject(fixture.deleteError);
        return Promise.resolve({ snapshot: fixture.first, refreshError: null });
      }
      if (command === 'read_repository_file_text') {
        if (fixture.textError) return Promise.reject(fixture.textError);
        if (fixture.holdText) return new Promise(resolve => {
          fixture.releaseText = (text: string | null) => resolve(text);
          (fixture.textReleases ??= []).push(fixture.releaseText);
        });
        if ('textResponse' in fixture) return Promise.resolve(fixture.textResponse);
        return Promise.resolve('ignored content\n');
      }
      if (command === 'inspect_file_media') {
        const side = { path: args.request.path, oid: null, size: null, raster: null, dataUrl: null, lfs: null, message: null };
        const response = {
          before: { ...side, label: 'Index', state: 'absent' },
          after: { ...side, label: 'Working tree', state: 'text' },
        };
        if (fixture.holdMedia) return new Promise(resolve => { fixture.releaseMedia = () => resolve(response); });
        return Promise.resolve(response);
      }
      if (command === 'cancel_git_operation') {
        const reply = fixture.cancelReplies?.shift() ?? true;
        if (reply === 'error') return Promise.reject({ message: 'Cancellation IPC refused' });
        if (reply === 'held') return new Promise(resolve => { fixture.releaseCancel = resolve; });
        return Promise.resolve(reply);
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(fixture.first);
      if (command === 'refresh_repository_status') return Promise.resolve(fixture.first.status);
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
  }, repositoryFileCreationAvailable);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.branch-item').first()).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem('git-khronos.identity-profiles.v1');
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const base = git.repository();
    const first = { ...base, name: 'Alpha', path: '/owned/alpha', status: { ...base.status, branch: 'main', ahead: 2, behind: 1, staged: 1, unstaged: 2, untracked: 3, conflicted: 1, mergeInProgress: true }, branches: [{ ...base.branches[0], current: true, upstream: 'origin/main' }] };
    const second = { ...base, id: 'clean-repo', name: 'Beta', path: '/owned/beta', branches: [], status: { ...base.status, branch: null, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ahead: 0, behind: 0, mergeInProgress: false, rebaseInProgress: false, historyOperation: null, bisectInProgress: false } };
    git.repositories.set([first, second]);
    (window as any).__center = { first, second, calls: [], fail: false };
    app.commitMessage.set('Workspace draft');
  });
});

test('shows local repository state, filters attention and opens a repository', async ({ page }) => {
  const dialog = await open(page);
  await expect(dialog).toContainText('2 of 2 open repositories');
  await expect(dialog).toContainText('1 staged · 2 unstaged · 3 untracked · 1 conflicts');
  await expect(dialog).toContainText('origin/main: 2 ahead · 1 behind');
  await expect(dialog).toContainText('No upstream configured');
  await dialog.getByLabel('Needs attention', { exact: true }).check();
  await expect(dialog.getByRole('article')).toHaveCount(1);
  await dialog.getByLabel('Needs attention', { exact: true }).uncheck();
  await dialog.getByLabel('Filter repositories', { exact: true }).fill('beta');
  await expect(dialog.getByRole('article')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Open repository', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.activeRepositoryId())).toBe('clean-repo');
});

async function prepareWorkspaceClone(page: Page, heldFolder: string | null = null) {
  await page.evaluate(held => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const fixture = (window as any).__center;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'plugin:dialog|open') return Promise.resolve('/owned/clones');
      if (command === 'clone_repository') {
        if (args.folder === 'blocked') return Promise.reject({ kind: 'destinationExists', message: 'The clone destination already exists.' });
        const snapshot = { ...fixture.second, id: 'clone-' + args.folder, name: args.folder, path: args.parentPath + '/' + args.folder };
        if (args.folder === held) return new Promise(resolve => fixture.releaseClone = () => resolve(snapshot));
        return Promise.resolve(snapshot);
      }
      if (command === 'refresh_repository_metadata') return Promise.resolve(git.repositories().find((repo: any) => repo.id === args.repoId));
      return Promise.resolve(null);
    } };
  }, heldFolder);
}

async function reviewWorkspaceClones(page: Page, sources: string) {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Clone multiple repositories', exact: true }).click();
  const form = dialog.getByRole('region', { name: 'Clone multiple repositories' });
  await form.getByLabel('Repository URLs or paths').fill(sources);
  await form.getByRole('button', { name: 'Choose destination…' }).click();
  await form.getByRole('button', { name: 'Review clones' }).click();
  return form;
}

async function cloneCalls(page: Page): Promise<{ remote: string; parentPath: string; folder: string }[]> {
  return page.evaluate(() => (window as any).__center.calls
    .filter((entry: any) => entry.command === 'clone_repository').map((entry: any) => entry.args));
}

test('reviews workspace clones and keeps successful tabs without switching even if a clone fails', async ({ page }) => {
  await prepareWorkspaceClone(page);
  const form = await reviewWorkspaceClones(page, 'https://example.test/team/example.git\n/fixtures/blocked.git\ngit@example.test:other/example.git');
  const confirm = form.getByRole('button', { name: 'Clone 3 repositories' });
  await expect(confirm).toBeDisabled();
  await expect(form.getByRole('status')).toContainText('Each clone needs a different folder name.');
  await form.getByLabel('Folder for repository 3').fill('../outside');
  await expect(confirm).toBeDisabled();
  await form.getByLabel('Folder for repository 3').fill('other-example');
  expect(await cloneCalls(page)).toHaveLength(0);
  await confirm.click();
  await expect(form.getByRole('status')).toHaveText('Cloned 2 of 3 repositories.');
  await expect(form.getByRole('list', { name: 'Clone results' })).toContainText('blocked — Could not clone');
  await expect(form.getByRole('list', { name: 'Clone results' })).toContainText('The clone destination already exists.');
  expect((await cloneCalls(page)).map(({ remote, parentPath, folder }) => [remote, parentPath, folder])).toEqual([
    ['https://example.test/team/example.git', '/owned/clones', 'example'],
    ['/fixtures/blocked.git', '/owned/clones', 'blocked'],
    ['git@example.test:other/example.git', '/owned/clones', 'other-example'],
  ]);
  expect(await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    return { active: git.repository().path, tabs: git.repositories().map((repo: any) => repo.path), saved: git.activeWorkspace().repositoryPaths };
  })).toEqual({ active: '/owned/alpha', tabs: ['/owned/alpha', '/owned/beta', '/owned/clones/example', '/owned/clones/other-example'],
    saved: ['/owned/alpha', '/owned/beta', '/owned/clones/example', '/owned/clones/other-example'] });
});

test('stopping workspace clones leaves the current clone alone and does not start the next', async ({ page }) => {
  await prepareWorkspaceClone(page, 'first');
  const form = await reviewWorkspaceClones(page, '/fixtures/first.git\n/fixtures/second.git');
  await form.getByRole('button', { name: 'Clone 2 repositories' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseClone)).toBe('function');
  await form.getByRole('button', { name: 'Stop after current clone' }).click();
  await expect(form.getByRole('status')).toContainText('Stopping after the current clone');
  await page.evaluate(() => (window as any).__center.releaseClone());
  await expect(form.getByRole('status')).toHaveText('Cloned 1 of 2 repositories. 1 not started.');
  await expect(form.getByRole('list', { name: 'Clone results' })).toContainText('second — Not started');
  expect((await cloneCalls(page)).map(call => call.folder)).toEqual(['first']);
});

test('closing workspace clones saves a completed checkout without opening it or starting another', async ({ page }) => {
  await prepareWorkspaceClone(page, 'first');
  const form = await reviewWorkspaceClones(page, '/fixtures/first.git\n/fixtures/second.git');
  await form.getByRole('button', { name: 'Clone 2 repositories' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseClone)).toBe('function');
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
  await page.evaluate(() => (window as any).__center.releaseClone());
  await expect.poll(() => page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    return { busy: git.busy(), active: git.repository().path, tabs: git.repositories().map((repo: any) => repo.path),
      saved: git.activeWorkspace().repositoryPaths.includes('/owned/clones/first') };
  })).toEqual({ busy: false, active: '/owned/alpha', tabs: ['/owned/alpha', '/owned/beta'], saved: true });
  expect((await cloneCalls(page)).map(call => call.folder)).toEqual(['first']);
});

test('workspace clones do not review or dispatch input with embedded credentials', async ({ page }) => {
  await prepareWorkspaceClone(page);
  const form = await reviewWorkspaceClones(page, 'https://user:example-only@example.test/team/repo.git');
  await expect(form.getByRole('alert')).toContainText('Remove embedded credentials from repository 1.');
  await expect(form.getByRole('button', { name: 'Clone 1 repository' })).toHaveCount(0);
  expect(await cloneCalls(page)).toHaveLength(0);
});

async function openCloneRecipe(page: Page, denyClipboard = false) {
  await prepareWorkspaceClone(page);
  await page.evaluate(deny => {
    const host = window as any;
    const { git } = host.ng.getComponent(document.querySelector('gk-app'));
    const fixture = host.__center;
    fixture.clipboard = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
      if (deny) throw new Error('Clipboard denied by fixture');
      fixture.clipboard.push(text);
    } } });
    git.repositories.set([
      { ...fixture.first, remotes: [
        { name: 'mirror', fetchUrl: 'ssh://git@mirror.example.test:2222/team/app.git', pushUrl: 'ssh://git@push.example.test/private' },
        { name: 'origin', fetchUrl: 'https://git.example.test/team/app.git', pushUrl: 'https://push.example.test/private' },
        { name: 'local', fetchUrl: '/home/user/private-checkout', pushUrl: '/home/user/private-checkout' },
        { name: 'credential', fetchUrl: 'https://token@git.example.test/team/app.git', pushUrl: '' },
      ] },
      { ...fixture.second, remotes: [{ name: 'origin', fetchUrl: 'git@git.example.test:tools/app.git', pushUrl: 'https://push.example.test/other' }] },
      { ...fixture.second, path: '/owned/unshareable', id: 'no-share', name: 'Unshareable',
        remotes: [{ name: 'origin', fetchUrl: '/home/user/private-checkout', pushUrl: 'https://push.example.test/other' }] },
    ]);
  }, denyClipboard);
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Share clone recipe…' }).click();
  return { dialog, recipe: dialog.getByRole('region', { name: 'Share clone recipe' }) };
}

test('shares selected fetch remotes and imports the preview without auto-starting workspace clones', async ({ page }) => {
  const { dialog, recipe } = await openCloneRecipe(page);
  await expect(recipe.getByRole('checkbox', { name: 'Include Unshareable' })).toBeDisabled();
  const fetch = recipe.getByLabel('Fetch remote for Alpha');
  await expect(fetch).toHaveValue('origin');
  await expect(fetch.getByRole('option')).toHaveCount(2);
  await fetch.selectOption('mirror');
  const beta = recipe.getByRole('checkbox', { name: 'Include Beta' });
  await beta.uncheck();
  await expect(recipe.getByRole('button', { name: 'Copy clone recipe (1)' })).toBeEnabled();
  await beta.check();
  const body = await recipe.getByLabel('Recipe preview').inputValue();
  expect(JSON.parse(body)).toEqual({ format: 'git-khronos.clone-recipe', version: 1, repositories: [
    { source: 'ssh://git@mirror.example.test:2222/team/app.git', folder: 'app' },
    { source: 'git@git.example.test:tools/app.git', folder: 'app-2' },
  ] });
  await recipe.getByRole('button', { name: 'Copy clone recipe (2)' }).click();
  await expect(recipe.getByRole('status')).toHaveText('Clone recipe copied.');
  expect(await page.evaluate(() => (window as any).__center.clipboard)).toEqual([body]);
  expect(await cloneCalls(page)).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Share clone recipe…' }).click();
  await dialog.getByRole('button', { name: 'Clone multiple repositories', exact: true }).click();
  const clone = dialog.getByRole('region', { name: 'Clone multiple repositories' });
  await clone.getByLabel('Repository URLs or paths').fill(body);
  await clone.getByRole('button', { name: 'Choose destination…' }).click();
  await clone.getByRole('button', { name: 'Review clones' }).click();
  await expect(clone.getByLabel('Folder for repository 2')).toHaveValue('app-2');
  expect(await cloneCalls(page)).toHaveLength(0);
  await clone.getByRole('button', { name: 'Clone 2 repositories' }).click();
  await expect(clone.getByRole('status')).toHaveText('Cloned 2 of 2 repositories.');
  expect((await cloneCalls(page)).map(({ remote, folder }) => [remote, folder])).toEqual([
    ['ssh://git@mirror.example.test:2222/team/app.git', 'app'], ['git@git.example.test:tools/app.git', 'app-2'],
  ]);
});

test('keeps the clone recipe preview usable when the clipboard denies the write', async ({ page }) => {
  const { recipe } = await openCloneRecipe(page, true);
  const preview = recipe.getByLabel('Recipe preview');
  const body = await preview.inputValue();
  await recipe.getByRole('button', { name: 'Copy clone recipe (2)' }).click();
  await expect(recipe.getByRole('alert')).toContainText('copy it manually');
  await expect(preview).toHaveValue(body);
  expect(await cloneCalls(page)).toHaveLength(0);
});

test('refuses to copy a clone recipe when a selected fetch remote has changed', async ({ page }) => {
  const { recipe } = await openCloneRecipe(page);
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.repositories.update((rows: any[]) => rows.map(row => row.name === 'Alpha' ? { ...row, remotes: [] } : row));
  });
  await recipe.getByRole('button', { name: 'Copy clone recipe (2)' }).click();
  await expect(recipe.getByRole('alert')).toContainText('A selected remote changed.');
  expect(await page.evaluate(() => (window as any).__center.clipboard)).toEqual([]);
});

test('rejects a clone recipe with an unsafe entry before any repository is cloned', async ({ page }) => {
  await prepareWorkspaceClone(page);
  const body = (source: string, folder: string) => JSON.stringify({ format: 'git-khronos.clone-recipe', version: 1, repositories: [
    { source: 'https://git.example.test/project.git', folder: 'project' }, { source, folder },
  ] });
  const form = await reviewWorkspaceClones(page, body('file:///home/user/private', 'private'));
  await expect(form.getByRole('alert')).toContainText('Recipe repository 2 needs a shareable HTTPS or SSH URL');
  await form.getByLabel('Repository URLs or paths').fill(body('ssh://git@git.example.test/private.git', '../outside'));
  await form.getByRole('button', { name: 'Review clones' }).click();
  await expect(form.getByRole('alert')).toContainText('a single folder name');
  await expect(form.getByRole('button', { name: 'Clone 2 repositories' })).toHaveCount(0);
  expect(await cloneCalls(page)).toHaveLength(0);
});

test('reopens a closed tab in its own workspace and original saved slot', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const workspace = git.activeWorkspace();
    const third = { ...fixture.second, id: 'reopen-third', path: '/owned/third', name: 'Gamma' };
    fixture.origin = workspace.id;
    fixture.alternate = 'reopen-alternate';
    fixture.calls = [];
    git.repositories.set([fixture.first, fixture.second, third]);
    git.workspaces.set([
      { ...workspace, repositoryPaths: ['/owned/alpha', '/owned/offline', '/owned/beta', '/owned/third'] },
      { id: fixture.alternate, name: 'Alternate reopen', repositoryPaths: [fixture.second.path], activeRepositoryPath: fixture.second.path },
    ]);
    git.workspaceRepositoryCache.set(fixture.alternate, [fixture.second]);
    git.systemInfo.update((previous: any) => ({ ...previous, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'open_repository') {
        fixture.calls.push({ path: args.path, workspace: git.activeWorkspaceId() });
        if (args.path !== fixture.second.path || fixture.failReopen) return Promise.reject({ message: 'Checkout unavailable' });
        return Promise.resolve(git.activeWorkspaceId() === fixture.origin
          ? { ...fixture.second, path: '/owned/beta-canonical' } : fixture.second);
      }
      const active = git.repositories().find((repo: any) => repo.id === args?.repoId) ?? git.repository();
      if (command === 'refresh_repository_status' && active) return Promise.resolve(active.status);
      if ((command === 'refresh_repository' || command === 'refresh_repository_metadata') && active) return Promise.resolve(active);
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
  });
  const switchTo = (target: string) => page.evaluate(async key => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    await git.switchWorkspace((window as any).__center[key]);
  }, target);
  const reopen = () => page.evaluate(async () => (window as any).ng.getComponent(document.querySelector('gk-app')).git.reopenClosedRepository());
  const recent = () => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.recentlyClosedRepositoryPath());
  const closeBeta = page.getByRole('button', { name: 'Close Beta', exact: true });
  const betaTab = page.getByRole('tab', { name: /^Beta(?:,|$)/ });
  await betaTab.hover();
  await closeBeta.click();
  await expect.poll(recent).toBe('/owned/beta');
  await switchTo('alternate');
  expect(await recent()).toBeNull();
  expect(await reopen()).toBe(false);
  await closeBeta.click();
  await expect.poll(recent).toBe('/owned/beta');
  await page.getByRole('button', { name: /^Reopen beta/i }).click();
  await expect(betaTab).toBeVisible();
  await expect.poll(recent).toBeNull();

  await switchTo('origin');
  expect(await recent()).toBe('/owned/beta');
  await page.evaluate(() => { (window as any).__center.failReopen = true; });
  expect(await reopen()).toBe(false);
  expect(await recent()).toBe('/owned/beta');
  await page.evaluate(() => { (window as any).__center.failReopen = false; });
  await page.keyboard.press('Control+Shift+T');
  await expect(betaTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(recent).toBeNull();
  const state = await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const fixture = (window as any).__center;
    const workspaces = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!);
    return {
      open: git.repositories().map((repo: any) => repo.path),
      origin: workspaces.find((item: any) => item.id === fixture.origin).repositoryPaths,
      alternate: workspaces.find((item: any) => item.id === fixture.alternate).repositoryPaths,
      reopenRequests: fixture.calls.filter((call: any) => call.path === '/owned/beta')
        .map((call: any) => call.workspace === fixture.alternate ? 'alternate' : 'origin'),
    };
  });
  expect(state).toEqual({
    open: ['/owned/alpha', '/owned/beta-canonical', '/owned/third'],
    origin: ['/owned/alpha', '/owned/offline', '/owned/beta-canonical', '/owned/third'],
    alternate: ['/owned/beta'],
    reopenRequests: ['alternate', 'origin', 'origin'],
  });
});

test('a reopen reply from an earlier visit cannot repopulate the current workspace', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.systemInfo.update((value: any) => ({ ...value, appVersion: 'renderer test' }));
    git.closeRepository(fixture.second.id);
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'open_repository') return new Promise(resolve => { fixture.releaseReopen = () => resolve(fixture.second); });
      return Promise.reject(Error(`Unexpected ${command}`));
    } };
    fixture.reopening = git.reopenClosedRepository();
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseReopen)).toBe('function');
  const state = await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    // Change the visit while deliberately keeping the same ID and closed entry.
    git.workspaceVisit += 1;
    fixture.releaseReopen();
    const applied = await fixture.reopening;
    return { applied, paths: git.repositories().map((repo: any) => repo.path), retry: git.recentlyClosedRepositoryPath() };
  });
  expect(state).toEqual({ applied: false, paths: ['/owned/alpha'], retry: '/owned/beta' });
});

async function prepareSavedStatus(page: Page, hold = false) {
  await page.evaluate(hold => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const { git } = app;
    const fixture = (window as any).__center;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const workspace = git.activeWorkspace();
    git.workspaces.update((workspaces: any[]) => workspaces.map(item => item.id === workspace.id
      ? { ...item, repositoryPaths: [fixture.first.path, fixture.second.path, '/saved/dirty', '/saved/missing'] } : item));
    const status = { branch: 'release/work', bare: false, unborn: false, staged: 1, unstaged: 2, untracked: 3, conflicted: 1, ahead: 2, behind: 0 };
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'cancel_git_operation') return Promise.resolve(true);
      if (command !== 'inspect_saved_checkout_status') return Promise.resolve(null);
      if (args.path === '/saved/missing') return Promise.reject({ message: 'That path no longer exists.' });
      if (hold) return new Promise(resolve => fixture.releaseStatus = () => resolve(status));
      return Promise.resolve(status);
    } };
  }, hold);
}

test('checks saved checkout status without opening tabs and keeps errors per path', async ({ page }) => {
  await prepareSavedStatus(page);
  const dialog = await open(page);
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  await saved.getByRole('button', { name: 'Check saved status (2)' }).click();
  const dirty = saved.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'Select saved path /saved/dirty' }) });
  await expect(dirty).toContainText('release/work');
  await expect(dirty).toContainText('1 staged · 2 unstaged · 3 untracked entries · 1 conflict');
  await expect(dirty).toContainText('2 ahead · 0 behind');
  await expect(saved.getByRole('alert')).toContainText('That path no longer exists.');
  expect(await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    return { active: git.repository().path, tabs: git.repositories().map((repo: any) => repo.path),
      reads: (window as any).__center.calls.filter((call: any) => /saved_checkout_status|open_repository|fetch_/.test(call.command))
        .map((call: any) => [call.command, call.args.path]) };
  })).toEqual({ active: '/owned/alpha', tabs: ['/owned/alpha', '/owned/beta'],
    reads: [['inspect_saved_checkout_status', '/saved/dirty'], ['inspect_saved_checkout_status', '/saved/missing']] });
});

test('checks only the selected saved checkout when a selection exists', async ({ page }) => {
  await prepareSavedStatus(page);
  const saved = (await open(page)).getByRole('region', { name: 'Saved repositories not open' });
  await saved.getByRole('checkbox', { name: 'Select saved path /saved/missing' }).check();
  await saved.getByRole('button', { name: 'Check saved status (1)' }).click();
  await expect(saved.getByRole('status')).toContainText('1 of 1 saved paths checked.');
  await expect(saved.getByRole('alert')).toContainText('That path no longer exists.');
  expect(await page.evaluate(() => (window as any).__center.calls
    .filter((call: any) => call.command === 'inspect_saved_checkout_status')
    .map((call: any) => call.args.path))).toEqual(['/saved/missing']);
});

test('stopping saved status discards the current result and does not dispatch remaining checkouts', async ({ page }) => {
  await prepareSavedStatus(page, true);
  const dialog = await open(page);
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  await saved.getByRole('button', { name: 'Check saved status (2)' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseStatus)).toBe('function');
  await saved.getByRole('button', { name: 'Stop checking status' }).click();
  await page.evaluate(() => (window as any).__center.releaseStatus());
  await expect(saved).toContainText('Stopped. 0 of 2 saved paths checked.');
  await expect(saved).not.toContainText('release/work');
  const calls = await page.evaluate(() => (window as any).__center.calls.filter((call: any) =>
    ['inspect_saved_checkout_status', 'cancel_git_operation'].includes(call.command)));
  expect(calls.map((call: any) => call.command)).toEqual(['inspect_saved_checkout_status', 'cancel_git_operation']);
  expect(calls[1].args.operationId).toBe(calls[0].args.operationId);
});

test('closing the overview retires a pending saved checkout result', async ({ page }) => {
  await prepareSavedStatus(page, true);
  const dialog = await open(page);
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  await saved.getByRole('button', { name: 'Check saved status (2)' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseStatus)).toBe('function');
  await expect(saved.getByRole('button', { name: 'Stop checking status' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await open(page);
  await page.evaluate(() => (window as any).__center.releaseStatus());
  await expect(saved.getByRole('button', { name: 'Check saved status (2)' })).toBeEnabled();
  await expect(saved).not.toContainText('release/work');
  expect(await page.evaluate(() => (window as any).__center.calls.filter((call: any) =>
    ['inspect_saved_checkout_status', 'cancel_git_operation'].includes(call.command))
    .map((call: any) => call.command))).toEqual(['inspect_saved_checkout_status', 'cancel_git_operation']);
});

test('retries a saved path, preserves membership and does not carry a draft into the opened checkout', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const workspace = git.activeWorkspace();
    git.workspaces.update((items: any[]) => items.map(item => item.id === workspace.id ? {
      ...item, repositoryPaths: [fixture.first.path, '/saved/alias', '/saved/offline', fixture.second.path],
    } : item));
    fixture.canonical = { ...fixture.first, id: 'canonical-checkout', path: '/owned/canonical', name: 'Canonical' };
    const openRepository = git.openRepository.bind(git);
    git.openRepository = async (path: string) => {
      const result = await openRepository(path);
      // A separate read can report a problem while the successful open settles.
      git.error.set('An unrelated background read failed.');
      return result;
    };
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'open_repository') {
        fixture.calls.push(args.path);
        if (args.path === '/saved/alias') return fixture.canonical;
      }
      throw Error(`Unexpected command: ${command}`);
    } };
  });
  const dialog = await open(page);
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  await expect(saved).toContainText('/saved/offline');
  await saved.getByRole('button', { name: 'Retry opening /saved/alias' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.status-repository-path')).toHaveText('/owned/canonical');
  await expect(page.getByRole('textbox', { name: 'Commit summary', exact: true })).toHaveValue('');
  const state = await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    return { saved: git.activeWorkspace().repositoryPaths, opened: (window as any).__center.calls };
  });
  expect(state).toEqual({
    saved: ['/owned/alpha', '/owned/canonical', '/saved/offline', '/owned/beta'],
    opened: ['/saved/alias'],
  });
  await page.getByRole('tab', { name: /^Alpha(?:,|$)/i }).click();
  await expect(page.getByRole('textbox', { name: 'Commit summary', exact: true })).toHaveValue('Workspace draft');
});

test('removing a saved path revokes its pending restore only in this workspace', async ({ page }) => {
  await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const path = '/saved/removable';
    const workspace = git.activeWorkspace();
    git.workspaces.update((items: any[]) => [
      ...items.map(item => item.id === workspace.id ? { ...item, repositoryPaths: [fixture.first.path, path, fixture.second.path] } : item),
      { id: 'keep-saved-path', name: 'Keep saved path', repositoryPaths: [path], activeRepositoryPath: path },
    ]);
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      fixture.calls.push(command);
      if (command === 'open_repository') return new Promise(resolve => {
        fixture.finishRestore = () => resolve({ ...fixture.first, id: 'not-reopened', path });
      });
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
    const restoration = { workspaceId: workspace.id, pending: new Set([path]), failed: new Set() };
    git.repositoryRestoration = restoration;
    fixture.restore = git.restoreRepositoryTabs(restoration);
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.finishRestore)).toBe('function');
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Remove /saved/removable from workspace' }).click();
  await expect(dialog.getByRole('region', { name: 'Saved repositories not open' })).toContainText('No files were changed.');
  await expect(dialog.getByLabel('Filter repositories')).toBeFocused();
  const state = await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    fixture.finishRestore();
    await fixture.restore;
    const workspaces = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!);
    return {
      open: git.repositories().map((repository: any) => repository.path),
      current: workspaces.find((workspace: any) => workspace.id === git.activeWorkspaceId()).repositoryPaths,
      other: workspaces.find((workspace: any) => workspace.id === 'keep-saved-path').repositoryPaths,
      opens: fixture.calls.filter((command: string) => command === 'open_repository').length,
    };
  });
  expect(state).toEqual({
    open: ['/owned/alpha', '/owned/beta'],
    current: ['/owned/alpha', '/owned/beta'],
    other: ['/saved/removable'],
    opens: 1,
  });
});

const movedPath = '/saved/moved checkout';
const removablePaths = ['/saved/remove first', '/saved/remove second'];
const retainedPath = '/saved/retain';

async function prepareSavedRemoval(page: Page, holdRestore = false) {
  await page.evaluate(({ paths, retained, hold }) => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const workspace = git.activeWorkspace();
    git.workspaces.update((items: any[]) => [
      ...items.map(item => item.id === workspace.id ? {
        ...item, repositoryPaths: [fixture.first.path, paths[0], retained, paths[1], fixture.second.path],
      } : item),
      { id: 'other-saved', name: 'Other saved', repositoryPaths: paths, activeRepositoryPath: paths[0] },
    ]);
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      const path = args?.path;
      if (command === 'open_repository' && path === paths[0] && hold) {
        return new Promise(resolve => { fixture.releaseSavedRestore = () => resolve({ ...fixture.first, id: 'restored-stale', path }); });
      }
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
    if (hold) {
      const restoration = { workspaceId: workspace.id, pending: new Set(paths), failed: new Set() };
      git.repositoryRestoration = restoration;
      fixture.savedRestore = git.restoreRepositoryTabs(restoration);
    }
  }, { paths: removablePaths, retained: retainedPath, hold: holdRestore });
}

test('reviews and removes selected unopened paths in one workspace without dispatching stale restores', async ({ page }) => {
  await prepareSavedRemoval(page, true);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseSavedRestore)).toBe('function');
  const dialog = await open(page);
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  await saved.getByRole('button', { name: 'Select all saved paths' }).click();
  const keep = saved.getByRole('checkbox', { name: 'Select saved path ' + retainedPath });
  // A native uncheck is a no-op if Angular has not painted Select all yet.
  await expect(keep).toBeChecked();
  await keep.uncheck();
  await expect(keep).not.toBeChecked();
  const remove = saved.getByRole('button', { name: 'Remove selected saved paths (2)…' });
  await remove.click();
  const review = page.getByRole('alertdialog', { name: 'Remove selected saved paths?' });
  await expect(review.getByRole('listitem')).toHaveText(removablePaths);
  await expect(review.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(saved.getByRole('checkbox', { name: 'Select saved path ' + removablePaths[0] })).toBeChecked();

  await remove.click();
  await review.getByRole('button', { name: 'Remove 2 saved paths', exact: true }).click();
  await expect(saved.getByRole('status')).toHaveText('Removed 2 saved paths from this workspace. No files were changed.');
  await expect(saved.getByRole('checkbox')).toHaveCount(1);
  await expect(dialog.getByRole('searchbox', { name: 'Filter repositories' })).toBeFocused();
  await expect(dialog.getByRole('complementary', { name: 'Repository action results' }).getByRole('listitem')).toHaveText([
    '/saved/remove first — success: Saved path removed', '/saved/remove second — success: Saved path removed',
  ]);
  const current = await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    fixture.releaseSavedRestore();
    await fixture.savedRestore;
    const workspaces = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!);
    return {
      open: git.repositories().map((repository: any) => repository.path),
      active: git.repository().path,
      currentPaths: workspaces.find((workspace: any) => workspace.id === git.activeWorkspaceId()).repositoryPaths,
      otherPaths: workspaces.find((workspace: any) => workspace.id === 'other-saved').repositoryPaths,
      opened: fixture.calls.filter((call: any) => call.command === 'open_repository').map((call: any) => call.args.path),
    };
  });
  expect(current).toEqual({
    open: ['/owned/alpha', '/owned/beta'], active: '/owned/alpha',
    currentPaths: ['/owned/alpha', retainedPath, '/owned/beta'], otherPaths: removablePaths,
    opened: [removablePaths[0]],
  });
});

test('refuses the entire saved-path removal when one reviewed checkout becomes open', async ({ page }) => {
  await prepareSavedRemoval(page);
  const dialog = await open(page);
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  for (const path of removablePaths) await saved.getByRole('checkbox', { name: 'Select saved path ' + path }).check();
  await saved.getByRole('button', { name: 'Remove selected saved paths (2)…' }).click();
  await page.evaluate(path => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.repositories.update((repos: any[]) => [...repos, { ...fixture.first, id: 'newly-restored', path, name: 'Newly restored' }]);
  }, removablePaths[0]);
  const review = page.getByRole('alertdialog', { name: 'Remove selected saved paths?' });
  await review.getByRole('button', { name: 'Remove 2 saved paths', exact: true }).click();
  await expect(saved.getByRole('alert')).toContainText('No paths were removed.');
  await expect(saved.getByRole('button', { name: 'Remove selected saved paths (1)…' })).toBeFocused();
  await expect(dialog.getByRole('article', { name: 'Newly restored' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.activeWorkspace().repositoryPaths))
    .toEqual(['/owned/alpha', removablePaths[0], retainedPath, removablePaths[1], '/owned/beta']);
});

async function installSavedPathPicker(page: Page) {
  await page.evaluate(path => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const workspace = git.activeWorkspace();
    git.workspaces.update((items: any[]) => [
      ...items.map(item => item.id === workspace.id ? {
        ...item, repositoryPaths: [fixture.first.path, path, '/saved/offline', fixture.second.path],
      } : item),
      { id: 'other-layout', name: 'Other layout', repositoryPaths: [path], activeRepositoryPath: path },
    ]);
    fixture.replacement = { ...fixture.first, id: 'moved-checkout', path: '/owned/new location', name: 'Moved checkout' };
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'plugin:dialog|open') {
        fixture.calls.push({ command, options: args.options });
        return new Promise(resolve => { fixture.choose = resolve; });
      }
      if (command === 'open_repository') {
        fixture.calls.push({ command, path: args.path });
        if (args.path === path) return new Promise(resolve => {
          fixture.restoreOld = () => resolve({ ...fixture.first, id: 'stale-restored-checkout', path });
        });
        if (fixture.failOpen) return Promise.reject({ message: 'Not a Git repository' });
        if (fixture.holdOpen) return new Promise(resolve => { fixture.finishOpen = () => resolve(fixture.replacement); });
        return Promise.resolve(fixture.replacement);
      }
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
  }, movedPath);
}

async function chooseRelocationFolder(page: Page, path: string | null) {
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.choose)).toBe('function');
  await page.evaluate(choice => {
    const fixture = (window as any).__center;
    const resolve = fixture.choose;
    fixture.choose = null;
    resolve(choice);
  }, path);
}

test('locates a moved checkout in its saved slot and revokes a late restore of the old path', async ({ page }) => {
  await installSavedPathPicker(page);
  await page.evaluate(path => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const restoration = { workspaceId: git.activeWorkspaceId(), pending: new Set([path]), failed: new Set() };
    git.repositoryRestoration = restoration;
    fixture.restore = git.restoreRepositoryTabs(restoration);
  }, movedPath);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.restoreOld)).toBe('function');
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Locate and open ' + movedPath, exact: true }).click();
  await chooseRelocationFolder(page, '/alias/selected folder');
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  await expect(saved.getByRole('status')).toContainText('Replaced the saved path with /owned/new location');
  await expect(dialog.getByRole('searchbox', { name: 'Filter repositories' })).toBeFocused();
  const state = await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    fixture.restoreOld();
    await fixture.restore;
    const workspaces = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!);
    return {
      current: workspaces.find((ws: any) => ws.id === git.activeWorkspaceId()).repositoryPaths,
      other: workspaces.find((ws: any) => ws.id === 'other-layout').repositoryPaths,
      active: git.repository().path,
      tabs: git.repositories().map((repo: any) => repo.path),
      calls: fixture.calls,
    };
  });
  expect(state).toEqual({
    current: ['/owned/alpha', '/owned/new location', '/saved/offline', '/owned/beta'],
    other: [movedPath],
    active: '/owned/new location',
    tabs: ['/owned/alpha', '/owned/new location', '/owned/beta'],
    calls: [
      { command: 'open_repository', path: movedPath },
      { command: 'plugin:dialog|open', options: { directory: true, multiple: false, defaultPath: movedPath,
        title: 'Locate the new folder for moved checkout' } },
      { command: 'open_repository', path: '/alias/selected folder' },
    ],
  });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Commit summary', exact: true })).toHaveValue('');
  await page.getByRole('tab', { name: /^Alpha(?:,|$)/i }).click();
  await expect(page.getByRole('textbox', { name: 'Commit summary', exact: true })).toHaveValue('Workspace draft');
});

test('keeps saved paths when relocation is cancelled, invalid, or resolves to another member', async ({ page }) => {
  await installSavedPathPicker(page);
  const dialog = await open(page);
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  const locate = saved.getByRole('button', { name: 'Locate and open ' + movedPath, exact: true });
  await locate.click();
  await chooseRelocationFolder(page, null);
  await expect(locate).toBeFocused();
  await page.evaluate(() => { (window as any).__center.failOpen = true; });
  await locate.click();
  await chooseRelocationFolder(page, '/not-a-repo');
  await expect(saved.getByRole('alert')).toContainText('Not a Git repository');
  await expect(locate).toBeFocused();
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    fixture.failOpen = false;
    fixture.replacement = fixture.second;
  });
  await locate.click();
  await chooseRelocationFolder(page, '/alias/duplicate');
  await expect(saved.getByRole('alert')).toContainText('already in this workspace');
  await expect(locate).toBeFocused();
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    fixture.replacement = { ...fixture.replacement, id: 'another-saved', path: '/saved/offline' };
  });
  await locate.click();
  await chooseRelocationFolder(page, '/alias/another-saved');
  await expect(saved.getByRole('alert')).toContainText('already in this workspace');
  await expect(locate).toBeFocused();
  const state = await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    return {
      paths: git.activeWorkspace().repositoryPaths, active: git.repository().path,
      opened: (window as any).__center.calls.filter((call: any) => call.command === 'open_repository').map((call: any) => call.path),
    };
  });
  expect(state).toEqual({
    paths: ['/owned/alpha', movedPath, '/saved/offline', '/owned/beta'], active: '/owned/alpha',
    opened: ['/not-a-repo', '/alias/duplicate', '/alias/another-saved'],
  });
});

test('closing the overview retires both the folder picker and a pending relocation result', async ({ page }) => {
  await installSavedPathPicker(page);
  const dialog = await open(page);
  const locate = dialog.getByRole('button', { name: 'Locate and open ' + movedPath, exact: true });
  await locate.click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await chooseRelocationFolder(page, '/never-open');
  await open(page);
  await page.evaluate(() => { (window as any).__center.holdOpen = true; });
  await locate.click();
  await chooseRelocationFolder(page, '/opened-but-retired');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.finishOpen)).toBe('function');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).__center.finishOpen());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.busy())).toBe(false);
  const state = await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    return {
      paths: git.activeWorkspace().repositoryPaths, active: git.repository().path,
      opened: (window as any).__center.calls.filter((call: any) => call.command === 'open_repository').map((call: any) => call.path),
    };
  });
  expect(state).toEqual({
    paths: ['/owned/alpha', movedPath, '/saved/offline', '/owned/beta'], active: '/owned/alpha',
    opened: ['/opened-but-retired'],
  });
});

test('locates selected checkouts in saved order and stops remaining prompts when the chooser is cancelled', async ({ page }) => {
  await installSavedPathPicker(page);
  const chosenPaths = [movedPath, '/saved/offline', '/saved/invalid', '/saved/cancelled', '/saved/not-started'];
  await page.evaluate(paths => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.workspaces.update((items: any[]) => items.map(item => item.id === git.activeWorkspaceId() ? {
      ...item, repositoryPaths: [fixture.first.path, ...paths, fixture.second.path],
    } : item));
  }, chosenPaths);
  const dialog = await open(page);
  const saved = dialog.getByRole('region', { name: 'Saved repositories not open' });
  await saved.getByRole('button', { name: 'Select all saved paths' }).click();
  const locate = saved.getByRole('button', { name: 'Locate selected saved paths (5)…' });
  await expect(locate).toHaveAccessibleDescription(/Cancel stops any remaining prompts/);
  await locate.click();
  const results = dialog.getByRole('complementary', { name: 'Repository action results' });
  await expect(results.getByRole('listitem').first()).toContainText('running: Choose a replacement folder');
  await chooseRelocationFolder(page, '/alias/first replacement');
  await expect(results.getByRole('listitem').first()).toContainText('success: Replaced the saved path with /owned/new location');
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    fixture.replacement = { ...fixture.replacement, id: 'second-moved-checkout', path: '/owned/second location' };
  });
  await chooseRelocationFolder(page, '/alias/second replacement');
  await expect(results.getByRole('listitem').nth(1)).toContainText('success: Replaced the saved path with /owned/second location');
  await page.evaluate(() => { (window as any).__center.failOpen = true; });
  await chooseRelocationFolder(page, '/alias/not-a-repository');
  await expect(results.getByRole('listitem').nth(2)).toContainText('error: Not a Git repository');
  await chooseRelocationFolder(page, null);
  await expect(results.getByRole('listitem').nth(3)).toContainText('cancelled: No replacement folder chosen');
  await expect(results.getByRole('listitem').nth(4)).toContainText('cancelled: Stopped before choosing a folder');
  await expect(saved).toContainText('Located 2 of 5 selected repositories');
  const state = await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const layouts = JSON.parse(localStorage.getItem('git-khronos.workspaces.v1')!);
    return { current: layouts.find((ws: any) => ws.id === git.activeWorkspaceId()).repositoryPaths,
      other: layouts.find((ws: any) => ws.id === 'other-layout').repositoryPaths,
      active: git.repository().path, picked: fixture.calls.filter((entry: any) => entry.command === 'plugin:dialog|open').map((entry: any) => entry.options),
      opened: fixture.calls.filter((entry: any) => entry.command === 'open_repository').map((entry: any) => entry.path) };
  });
  expect(state).toEqual({
    current: ['/owned/alpha', '/owned/new location', '/owned/second location', ...chosenPaths.slice(2), '/owned/beta'],
    other: [movedPath], active: '/owned/second location',
    picked: chosenPaths.slice(0, 4).map((path, index) => ({
      directory: true, multiple: false, defaultPath: path, title: `Locate the new folder for ${path} (${index + 1} of 5)`,
    })),
    opened: ['/alias/first replacement', '/alias/second replacement', '/alias/not-a-repository'],
  });
});

test('closing a batch keeps a late native open from applying and never prompts for the next path', async ({ page }) => {
  await installSavedPathPicker(page);
  await page.evaluate(() => { (window as any).__center.holdOpen = true; });
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Select all saved paths' }).click();
  await dialog.getByRole('button', { name: 'Locate selected saved paths (2)…' }).click();
  await chooseRelocationFolder(page, '/alias/held');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.finishOpen)).toBe('function');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).__center.finishOpen());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.busy())).toBe(false);
  const state = await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    return { paths: git.activeWorkspace().repositoryPaths, active: git.repository().path,
      titles: fixture.calls.filter((entry: any) => entry.command === 'plugin:dialog|open').map((entry: any) => entry.options.title) };
  });
  expect(state).toEqual({
    paths: ['/owned/alpha', movedPath, '/saved/offline', '/owned/beta'], active: '/owned/alpha',
    titles: [`Locate the new folder for ${movedPath} (1 of 2)`],
  });
});

test('refreshes every local repository, retains failed cached rows and performs no transport', async ({ page }) => {
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const fixture = (window as any).__center; fixture.calls.push({ command, args });
      if (command === 'working_tree_change_summary') {
        const repo = git.repositories().find((candidate: { id: string }) => candidate.id === args.repoId);
        if (!repo) throw Error('Unexpected repository in owned recap read');
        return { staged: null, unstaged: { additions: 0, deletions: 0, uncountedFiles: repo.status.unstaged + repo.status.untracked, partial: true } };
      }
      if (args.repoId === 'clean-repo') throw { kind: 'missingRepository', message: 'Fixture unavailable' };
      if (command === 'refresh_repository') return fixture.first;
      if (command === 'refresh_repository_status') return { ...fixture.first.status, staged: 4 };
      throw Error(`Unexpected ${command}`);
    } };
  });
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Refresh local state', exact: true }).click();
  await expect(dialog).toContainText('4 staged');
  await expect(dialog).toContainText('Fixture unavailable');
  await expect(dialog).toContainText('Read locally at');
  const calls = await page.evaluate(() => (window as any).__center.calls);
  expect(calls.some((call: any) => call.command === 'refresh_repository' && call.args.repoId === 'clean-repo')).toBe(true);
  expect(calls.every((call: any) => ['refresh_repository', 'refresh_repository_status', 'refresh_repository_metadata', 'working_tree_change_summary'].includes(call.command))).toBe(true);
});

test('fetches selected repositories independently and reports each result', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    fixture.calls = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'fetch_repository') {
        if (args.repoId === 'clean-repo') throw { kind: 'gitFailure', message: 'No remote configured.' };
        return fixture.first;
      }
      if (command === 'pull_repository') return args.repoId === 'clean-repo' ? fixture.second : fixture.first;
      if (command === 'refresh_repository') return args.repoId === 'clean-repo' ? fixture.second : fixture.first;
      if (command === 'refresh_repository_status') return args.repoId === 'clean-repo' ? fixture.second.status : fixture.first.status;
      throw Error(`Unexpected command: ${command}`);
    } };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  await dialog.getByRole('button', { name: 'Fetch selected (2)', exact: true }).click();
  await expect(dialog.getByLabel('Repository action results')).toContainText('alpha — success');
  await expect(dialog.getByLabel('Repository action results')).toContainText('beta — error: No remote configured.');
  const calls = await page.evaluate(() => (window as any).__center.calls);
  const fetches = calls.filter((call: any) => call.command === 'fetch_repository');
  const firstRepositoryId = await page.evaluate(() => (window as any).__center.first.id);
  expect(fetches.map((call: any) => call.args.repoId)).toEqual([firstRepositoryId, 'clean-repo']);
  expect(new Set(fetches.map((call: any) => call.args.operationId)).size).toBe(2);
  await dialog.getByRole('button', { name: 'Pull selected (2)', exact: true }).click();
  await expect(dialog.getByLabel('Repository action results')).toContainText('alpha — success');
  await expect(dialog.getByLabel('Repository action results')).toContainText('beta — success');
  const pulls = (await page.evaluate(() => (window as any).__center.calls)).filter((call: any) => call.command === 'pull_repository');
  expect(pulls.map((call: any) => call.args.repoId)).toEqual([firstRepositoryId, 'clean-repo']);
});

for (const replacement of ['original', 'matching newer failure']) {
  test(`workspace Fetch resumes only the selected checkout's matching pause: ${replacement}`, async ({ page }) => {
    await page.evaluate(async () => {
      const fixture = (window as any).__center;
      const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
        const repository = args?.repoId === fixture.second.id ? fixture.second : fixture.first;
        if (command === 'sync_repository') throw { kind: 'fetchUpdatesLocalBranch', message: 'Fetch scope refused' };
        if (command === 'fetch_repository') return new Promise(resolve => {
          fixture.finishFetch = () => resolve(repository);
        });
        if (command === 'refresh_repository_status') return repository.status;
        return null;
      } };
      await git.fetchInBackground(fixture.first.id);
      await git.fetchInBackground(fixture.second.id);
      fixture.pauseMessages = () => [fixture.first.id, fixture.second.id]
        .map(id => git.backgroundFetchErrors()[id]?.message ?? null);
      fixture.replacePause = () => git.backgroundFetchFailures.update((errors: any) => ({
        ...errors, [fixture.second.id]: { ...errors[fixture.second.id] },
      }));
    });
    const pauses = () => page.evaluate(() => (window as any).__center.pauseMessages());
    expect(await pauses()).toEqual(['Fetch scope refused', 'Fetch scope refused']);
    await expect(page.locator('.auto-fetch-status')).toHaveText('Fetch paused');
    const dialog = await open(page);
    await dialog.getByLabel('Select beta').check();
    await dialog.getByRole('button', { name: 'Fetch selected (1)', exact: true }).click();
    await page.waitForFunction(() => (window as any).__center.finishFetch);
    await page.evaluate(replace => {
      const fixture = (window as any).__center;
      if (replace) fixture.replacePause();
      fixture.finishFetch();
    }, replacement !== 'original');
    await expect(dialog.getByLabel('Repository action results')).toContainText('beta — success');
    expect(await pauses()).toEqual(['Fetch scope refused', replacement === 'original' ? null : 'Fetch scope refused']);
  });
}

test('workspace Pull distinguishes a prepared merge and still processes the next repository', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const first = { ...fixture.first, status: { ...fixture.first.status, operations: [], conflicted: 0 } };
    const prepared = { ...first, status: { ...first.status, operations: [{ kind: 'merge' }], staged: 1 } };
    git.repositories.update((repos: any[]) => repos.map(repo => repo.id === first.id ? first : repo));
    let merged = false;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      if (command === 'pull_repository' && args.repoId === first.id) merged = true;
      const next = args?.repoId === first.id ? (merged ? prepared : first) : fixture.second;
      if (command === 'pull_repository' || command === 'refresh_repository') return next;
      if (command === 'refresh_repository_status') return next.status;
      return null;
    } };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  await dialog.getByRole('button', { name: 'Pull selected (2)', exact: true }).click();
  const results = dialog.getByLabel('Repository action results');
  await expect(results).toContainText('alpha — review needed: Merge prepared, not committed');
  await expect(results).toContainText('beta — success');
});

test('workspace Pull explains an ambiguous upstream and continues to the next repository', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const isFirst = args.repoId === fixture.first.id;
      const repo = isFirst ? fixture.first : fixture.second;
      if (command === 'pull_repository') {
        fixture.calls.push({ command, args });
        if (isFirst) throw {
          kind: 'multiplePullUpstreams',
          message: 'More than one upstream branch is configured. Nothing was fetched or integrated.',
          hint: 'Open this repository and review the destination in Pull options, or configure a single upstream before retrying the batch.',
        };
        return repo;
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return repo;
      if (command === 'refresh_repository_status') return repo.status;
      throw Error(`Unexpected command: ${command}`);
    } };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  await dialog.getByRole('button', { name: 'Pull selected (2)', exact: true }).click();
  const results = dialog.getByLabel('Repository action results');
  await expect(results).toContainText('alpha — error: More than one upstream branch is configured. Nothing was fetched or integrated.');
  await expect(results).toContainText('review the destination in Pull options');
  await expect(results).toContainText('beta — success');
  const calls = await page.evaluate(() => (window as any).__center.calls.filter(
    ({ command }: any) => command === 'pull_repository',
  ).map(({ args }: any) => args.repoId));
  expect(calls).toEqual([
    await page.evaluate(() => (window as any).__center.first.id), 'clean-repo',
  ]);
});

test('workspace Pull honors the saved strategy and keeps it for the whole batch', async ({ page }) => {
  await page.getByRole('button', { name: 'Pull options', exact: true }).click();
  await page.locator('.pull-menu').getByRole('menuitemradio', { name: 'Make Fast-forward only the default pull strategy' }).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const { git } = app;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const repository = args.repoId === fixture.second.id ? fixture.second : fixture.first;
      if (command === 'pull_repository') {
        fixture.calls.push(args);
        if (fixture.calls.length === 1) {
          await new Promise<void>(resolve => {
            fixture.releasePull = () => {
              app.pullStrategy.set('rebase');
              resolve();
            };
          });
        }
        return repository;
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return repository;
      if (command === 'refresh_repository_status') return repository.status;
      throw Error(`Unexpected command: ${command}`);
    } };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  const pull = dialog.getByRole('button', { name: 'Pull selected (2)', exact: true });
  await expect(pull).toHaveAccessibleDescription('Pull uses each repository’s configured upstream. Default strategy: Fast-forward only.');
  await pull.click();
  const results = dialog.getByLabel('Repository action results');
  await expect(results).toContainText('alpha — running');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releasePull)).toBe('function');
  await page.evaluate(() => (window as any).__center.releasePull());
  await expect(results).toContainText('beta — success');
  const strategies = () => page.evaluate(() => (window as any).__center.calls.map((args: any) => args.strategy));
  expect(await strategies()).toEqual(['ff-only', 'ff-only']);
  await expect(pull).toHaveAccessibleDescription('Pull uses each repository’s configured upstream. Default strategy: Rebase.');
  await dialog.getByLabel('Select alpha').uncheck();
  await dialog.getByRole('button', { name: 'Pull selected (1)', exact: true }).click();
  await expect(results).toContainText('beta — success');
  expect(await strategies()).toEqual(['ff-only', 'ff-only', 'rebase']);
  expect(await page.evaluate(() => (window as any).__center.calls.every((args: any) =>
    args.remote === undefined && args.branch === undefined))).toBe(true);
});

test('a queued workspace pull keeps the original checkout rather than adopting a later branch', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const checkedOut = { ...fixture.second, status: { ...fixture.second.status, branch: 'external-change' } };
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const repository = args.repoId === fixture.second.id ? checkedOut : fixture.first;
      if (command === 'pull_repository') {
        fixture.calls.push(args);
        if (args.repoId === fixture.first.id) {
          git.repositories.update((items: any[]) => items.map(item => item.id === checkedOut.id ? checkedOut : item));
        } else if (args.checkout?.branch !== checkedOut.status.branch) {
          throw { kind: 'stalePullCheckout', message: 'The checked-out branch or commit changed before Pull could start.' };
        }
        return repository;
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return repository;
      if (command === 'refresh_repository_status') return repository.status;
      throw Error(`Unexpected command: ${command}`);
    } };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  await dialog.getByRole('button', { name: 'Pull selected (2)', exact: true }).click();
  const results = dialog.getByLabel('Repository action results');
  await expect(results).toContainText('alpha — success');
  await expect(results).toContainText('beta — error: The checked-out branch or commit changed before Pull could start.');
  const dispatch = await page.evaluate(() => {
    const { calls, first, second } = (window as any).__center;
    return { calls, first: first.headOid, second: second.headOid };
  });
  expect(dispatch.calls.map((args: any) => args.checkout)).toEqual([
    { branch: 'main', headOid: dispatch.first },
    { branch: null, headOid: dispatch.second },
  ]);
});

test('a native cancellation stops the remaining selected pulls', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'pull_repository') {
        if (args.repoId === fixture.first.id) throw { kind: 'operationCancelled', message: 'Stopped by the user.' };
        return fixture.second;
      }
      const repository = args.repoId === fixture.second.id ? fixture.second : fixture.first;
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return repository;
      if (command === 'refresh_repository_status') return repository.status;
      throw Error(`Unexpected command: ${command}`);
    } };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  await dialog.getByRole('button', { name: 'Pull selected (2)', exact: true }).click();
  const results = dialog.getByLabel('Repository action results');
  await expect(results).toContainText('alpha — cancelled');
  await expect(results).toContainText('beta — cancelled: Not started because the current operation was cancelled.');
  expect(await page.evaluate(() => {
    const fixture = (window as any).__center;
    return fixture.calls.filter((call: any) => call.command === 'pull_repository').map((call: any) => call.args.repoId);
  })).toHaveLength(1);
});

test('stop after current keeps its real outcome and skips undispatched fetches', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    fixture.hold = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      const repository = args.repoId === fixture.second.id ? fixture.second : fixture.first;
      if (command === 'fetch_repository') {
        if (fixture.hold) return new Promise(resolve => { fixture.finishFetch = () => resolve(repository); });
        return Promise.resolve(repository);
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(repository);
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  const fetch = dialog.getByRole('button', { name: 'Fetch selected (2)', exact: true });
  await fetch.click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.finishFetch)).toBe('function');
  const results = dialog.getByLabel('Repository action results');
  await expect(results).toContainText('alpha — running');
  const stop = results.getByRole('button', { name: 'Stop after current repository', exact: true });
  await stop.click();
  await expect(results).toContainText('beta — cancelled: Stopped before this repository was started.');
  await expect(results).toContainText('alpha — running');
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    fixture.hold = false;
    fixture.finishFetch();
  });
  await expect(results).toContainText('alpha — success');
  await expect(results.getByRole('heading')).toBeFocused();
  expect(await page.evaluate(() => (window as any).__center.calls
    .filter((call: any) => ['fetch_repository', 'cancel_git_operation'].includes(call.command))
    .map((call: any) => call.command))).toEqual(['fetch_repository']);

  await fetch.click();
  await expect(results).toContainText('beta — success');
  expect(await page.evaluate(() => (window as any).__center.calls
    .filter((call: any) => call.command === 'fetch_repository'))).toHaveLength(3);
});

test('opens multiple selected directories, keeps individual outcomes and switches commit drafts', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    fixture.calls = [];
    fixture.gamma = { ...fixture.first, id: 'gamma-repo', name: 'Gamma', path: '/owned/gamma' };
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'plugin:dialog|open') return new Promise(resolve => { fixture.resolveDialog = resolve; });
      if (command === 'open_repository' && args.path === '/owned/gamma/subdir') return fixture.gamma;
      if (command === 'open_repository' && args.path === '/owned/delta') throw { kind: 'gitFailure', message: 'Not a repository.' };
      throw Error(`Unexpected command: ${command}`);
    } };
  });
  const dialog = await open(page);
  const chooseRepositories = dialog.getByRole('button', { name: 'Open multiple repositories…', exact: true });
  await chooseRepositories.click();
  await expect(chooseRepositories).toBeDisabled();
  expect((await page.evaluate(() => (window as any).__center.calls)).filter((call: any) => call.command === 'plugin:dialog|open')).toHaveLength(1);
  await page.evaluate(() => (window as any).__center.resolveDialog(['/owned/gamma/subdir', '/owned/gamma', '/owned/delta']));
  await expect(dialog.getByLabel('Repository action results')).toContainText('subdir — success: Opened repository at /owned/gamma.');
  await expect(dialog.getByLabel('Repository action results')).toContainText('gamma — success: Already open in this workspace.');
  await expect(dialog.getByLabel('Repository action results')).toContainText('delta — error: Not a repository.');
  const calls = await page.evaluate(() => (window as any).__center.calls);
  expect(calls.filter((call: any) => call.command === 'open_repository').map((call: any) => call.args.path)).toEqual(['/owned/gamma/subdir', '/owned/delta']);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.status-repository-path')).toHaveText('/owned/gamma');
  const summary = page.getByRole('textbox', { name: 'Commit summary', exact: true });
  await expect(summary).toHaveValue('');
  await page.getByRole('tab', { name: /^Alpha(?:,|$)/i }).click();
  await expect(summary).toHaveValue('Workspace draft');
});

test('closing the overview stops queued opens and keeps draft edits made while an open finishes', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'plugin:dialog|open') return Promise.resolve(['/owned/first-open', '/owned/not-dispatched']);
      if (command === 'open_repository') {
        fixture.calls.push(args.path);
        if (args.path === '/owned/first-open') return new Promise(resolve => {
          fixture.finishFirstOpen = () => resolve({ ...fixture.first, id: 'first-open', path: args.path, name: 'First open' });
        });
      }
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
  });
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Open multiple repositories…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.finishFirstOpen)).toBe('function');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.status-repository-path')).toHaveText('/owned/alpha');
  const summary = page.getByRole('textbox', { name: 'Commit summary', exact: true });
  const description = page.getByRole('textbox', { name: 'Commit description', exact: true });
  await summary.fill('Draft edited while the checkout was opening');
  await description.fill('These source edits must survive the open.');
  await page.evaluate(() => (window as any).__center.finishFirstOpen());
  await expect(page.locator('.status-repository-path')).toHaveText('/owned/first-open');
  await expect(summary).toHaveValue('');
  await expect(description).toHaveValue('');
  expect(await page.evaluate(() => (window as any).__center.calls)).toEqual(['/owned/first-open']);
  await page.getByRole('tab', { name: /^Alpha(?:,|$)/i }).click();
  await expect(summary).toHaveValue('Draft edited while the checkout was opening');
  await expect(description).toHaveValue('These source edits must survive the open.');
});

test('closing the active tab does not revive its former draft when reopened', async ({ page }) => {
  const path = page.locator('.status-repository-path');
  const summary = page.getByRole('textbox', { name: 'Commit summary', exact: true });
  await expect(summary).toHaveValue('Workspace draft');
  await page.getByRole('button', { name: 'Close Alpha', exact: true }).click();
  await expect(path).toHaveText('/owned/beta');
  await page.keyboard.press('Control+Shift+T');
  await expect(path).toHaveText('/owned/alpha');
  await expect(summary).toHaveValue('');
});

test('a bulk pull invalidates its old diff without clearing a newer inspection', async ({ page }) => {
  await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    fixture.calls = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'pull_repository') {
        if (fixture.holdPull) return new Promise(resolve => { fixture.releasePull = () => resolve(fixture.first); });
        return Promise.resolve(fixture.first);
      }
      if (command === 'inspect_working_tree_file') return Promise.resolve({ path: args.path, staged: args.staged, patch: args.path, truncated: false });
      if (command === 'refresh_repository') return Promise.resolve(fixture.first);
      if (command === 'refresh_repository_status') return Promise.resolve(fixture.first.status);
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
    await git.inspectWorkingTreeFile('old.txt', false);
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByRole('button', { name: 'Pull selected (1)' }).click();
  await expect(dialog.getByLabel('Repository action results')).toContainText('alpha — success');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.workingTreeFileDiff())).toBeNull();
  expect(await page.evaluate(() => (window as any).__center.calls.some((call: any) => call.command === 'refresh_repository_status'))).toBe(true);

  await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    await git.inspectWorkingTreeFile('old.txt', false);
    fixture.holdPull = true;
  });
  await dialog.getByRole('button', { name: 'Pull selected (1)' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releasePull)).toBe('function');
  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    await git.inspectWorkingTreeFile('new.txt', false);
    (window as any).__center.releasePull();
  });
  await expect(dialog.getByLabel('Repository action results')).toContainText('alpha — success');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.workingTreeFileDiff()?.path)).toBe('new.txt');
});

test('reviews filtered-out selections and closes only those tabs without touching Git', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const gamma = { ...fixture.second, id: 'keep-open', name: 'Gamma', path: '/owned/gamma' };
    git.repositories.update((items: any[]) => [...items, gamma]);
    const active = git.activeWorkspace();
    git.workspaces.update((items: any[]) => [
      ...items.map(item => item.id === active.id ? {
        ...item, repositoryPaths: [fixture.first.path, fixture.second.path, gamma.path, '/owned/unavailable'],
      } : item),
      { id: 'other-saved', name: 'Other saved', repositoryPaths: [fixture.first.path], activeRepositoryPath: fixture.first.path },
    ]);
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      fixture.calls.push(command);
      return Promise.reject(Error(`Unexpected command: ${command}`));
    } };
  });
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  const filter = dialog.getByLabel('Filter repositories');
  await filter.fill('gamma');
  const trigger = dialog.getByRole('button', { name: 'Close selected (2)…', exact: true });
  await trigger.click();
  const review = dialog.getByRole('alertdialog', { name: 'Close selected repository tabs?' });
  await expect(review.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(review).toContainText('/owned/alpha');
  await expect(review).toContainText('/owned/beta');
  await expect(review).not.toContainText('/owned/gamma');
  await expect(review).toContainText('commit drafts will be discarded');
  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('tab')).toHaveCount(3);

  await trigger.click();
  await review.getByRole('button', { name: 'Close 2 tabs', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(filter).toBeFocused();
  await expect(dialog.getByLabel('Repository action results')).toContainText('alpha — success: Tab closed');
  await expect(dialog.getByLabel('Repository action results')).toContainText('beta — success: Tab closed');
  await expect(page.locator('.status-repository-path')).toHaveText('/owned/gamma');
  const state = await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    return { open: git.repositories().map((repo: any) => repo.path), saved: git.activeWorkspace().repositoryPaths,
      other: git.workspaces().find((item: any) => item.id === 'other-saved').repositoryPaths,
      ipc: fixture.calls };
  });
  expect(state).toEqual({ open: ['/owned/gamma'], saved: ['/owned/gamma', '/owned/unavailable'],
    other: ['/owned/alpha'], ipc: [] });
});

test('refuses the whole close review when a selected tab no longer matches its reviewed path', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByLabel('Select alpha').check();
  await dialog.getByLabel('Select beta').check();
  await dialog.getByRole('button', { name: 'Close selected (2)…', exact: true }).click();
  const review = dialog.getByRole('alertdialog', { name: 'Close selected repository tabs?' });
  await expect(review).toContainText('/owned/beta');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.repositories.update((items: any[]) => items.map(item => item.id === 'clean-repo' ? { ...item, path: '/owned/beta-replacement' } : item));
  });
  await review.getByRole('button', { name: 'Close 2 tabs', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('No tabs were closed');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.status-repository-path')).toHaveText('/owned/alpha');
});

test('closing all selected tabs leaves the workspace available', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Select shown', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close selected (2)…', exact: true }).click();
  await dialog.getByRole('alertdialog').getByRole('button', { name: 'Close 2 tabs' }).click();
  await expect(dialog).toContainText('0 of 0 open repositories');
  await expect(dialog.getByRole('button', { name: 'Close selected (0)…', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('gk-welcome-launcher')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace: Default' })).toBeFocused();
});

test('an open response cannot attach to a workspace that changed while opening', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'open_repository') return new Promise(resolve => { fixture.releaseOpen = () => resolve({ ...fixture.first, id: 'foreign', path: '/owned/foreign' }); });
      return Promise.reject(Error(`Unexpected ${command}`));
    } };
    fixture.openResult = git.openRepository('/owned/foreign');
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseOpen)).toBe('function');
  const result = await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.activeWorkspaceId.set('different-workspace');
    fixture.releaseOpen();
    return { result: await fixture.openResult, paths: git.repositories().map((repo: any) => repo.path) };
  });
  expect(result.result.status).toBe('error');
  expect(result.result.error).toContain('workspace changed');
  expect(result.paths).not.toContain('/owned/foreign');
});

test('saves, edits and deletes identities without changing a repository and persists on reopen', async ({ page }) => {
  let dialog = await open(page, true);
  await dialog.getByLabel('Profile label', { exact: true }).fill('Work');
  await dialog.getByLabel('Commit author name', { exact: true }).fill('Work Author');
  await dialog.getByLabel('Commit author email', { exact: true }).fill('work@example.test');
  await dialog.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(dialog).toContainText('Saved Work');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.repository().identity.name)).not.toBe('Work Author');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  dialog = await open(page, true);
  await expect(dialog.getByRole('button', { name: 'Edit Work', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Edit Work', exact: true }).click();
  await dialog.getByLabel('Profile label', { exact: true }).fill('Personal');
  await dialog.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Edit Work', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Delete Personal', exact: true }).click();
  await expect(dialog).toContainText('No saved identities');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('git-khronos.identity-profiles.v1')!))).toEqual([]);
});

test('requires an explicit repository confirmation before applying a profile', async ({ page }) => {
  const dialog = await open(page, true);
  await dialog.getByLabel('Profile label', { exact: true }).fill('Work');
  await dialog.getByLabel('Commit author name', { exact: true }).fill('Work Author');
  await dialog.getByLabel('Commit author email', { exact: true }).fill('work@example.test');
  await dialog.getByRole('button', { name: 'Save profile', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use Work…', exact: true }).click();
  await expect(dialog.getByLabel('Confirm repository identity')).toContainText('/owned/alpha');
  await dialog.getByRole('button', { name: 'Cancel identity change', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Apply to this repository', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Use Work…', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply to this repository', exact: true }).click();
  await expect(dialog).toContainText('Applied Work to /owned/alpha');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.repository().identity)).toEqual({ name: 'Work Author', email: 'work@example.test' });
  await dialog.getByRole('button', { name: 'Use Work…', exact: true }).click();
  await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.activeRepositoryId.set('clean-repo'));
  await expect(dialog.getByRole('button', { name: 'Apply to this repository', exact: true })).toHaveCount(0);
});

test('contains keyboard focus, restores opener and fits compact windows', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = await open(page);
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Open repository', exact: true }).last().focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(550);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Workspace: / })).toBeFocused();
});

test('keeps profiles unchanged when device storage refuses writes', async ({ page }) => {
  const dialog = await open(page, true);
  await dialog.getByLabel('Profile label', { exact: true }).fill('Work');
  await dialog.getByLabel('Commit author name', { exact: true }).fill('Work Author');
  await dialog.getByLabel('Commit author email', { exact: true }).fill('work@example.test');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Owned storage refusal', 'QuotaExceededError'); }; });
  await dialog.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save identities');
  await expect(dialog).toContainText('No saved identities');
});

test('does not accept mixed checkout snapshots as a successful overview refresh', async ({ page }) => {
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const fixture = (window as any).__center;
      const repo = args.repoId === 'clean-repo' ? fixture.second : fixture.first;
      if (command === 'refresh_repository') return repo;
      if (command === 'refresh_repository_status') return { ...repo.status, branch: 'externally-changed' };
      return null;
    } };
  });
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Refresh local state', exact: true }).click();
  await expect(dialog.getByRole('alert').first()).toContainText('Repository context changed');
  await expect(dialog).not.toContainText('Read locally at');
  await expect(dialog).toContainText('1 staged · 2 unstaged');
});

test('creates files and deletes files with explicit Git and recovery behavior', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.systemInfo.update((info: any) => ({ ...info, repositoryFileCreationAvailable: true }));
    fixture.files = {
      files: [
        { path: 'src/tracked.ts', tracked: true, ignored: false, symbolicLink: false, deletable: true },
        { path: 'notes.txt', tracked: false, ignored: false, symbolicLink: false, deletable: false, deletableWithRecovery: true },
      ],
      nextCursor: null,
      incomplete: false,
    };
    fixture.calls = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'list_repository_files') return { ...fixture.files, files: [...fixture.files.files] };
      if (command === 'create_repository_file') {
        fixture.files = {
          ...fixture.files,
          files: [...fixture.files.files, { path: args.path, tracked: false, ignored: false, symbolicLink: false, deletable: false }],
        };
        return { snapshot: fixture.first, refreshError: null };
      }
      if (command === 'delete_untracked_repository_file') {
        fixture.files = { ...fixture.files, files: fixture.files.files.filter((file: any) => file.path !== args.path) };
        return { snapshot: fixture.first, refreshError: null };
      }
      if (command === 'delete_repository_file') {
        fixture.files = { ...fixture.files, files: fixture.files.files.filter((file: any) => file.path !== args.path) };
        return { snapshot: fixture.first, refreshError: null };
      }
      if (command === 'refresh_repository') return fixture.first;
      if (command === 'refresh_repository_status') return fixture.first.status;
      throw Error(`Unexpected command: ${command}`);
    } };
  });
  const dialog = await open(page, 'files');
  await expect(dialog.getByRole('article')).toHaveCount(2);
  await dialog.getByLabel('New repository-relative file path').fill('new.ts');
  await dialog.getByRole('button', { name: 'Create file', exact: true }).click();
  await expect(dialog).toContainText('Created new.ts');
  await expect(dialog.getByRole('article')).toHaveCount(3);

  await dialog.getByRole('article').filter({ hasText: 'notes.txt' })
    .getByRole('button', { name: 'Delete with recovery', exact: true }).click();
  const confirmation = dialog.getByRole('alertdialog');
  await expect(confirmation).toContainText('saved to Recovery History');
  await confirmation.getByRole('button', { name: 'Delete file', exact: true }).click();
  await expect(dialog).toContainText('Deleted notes.txt and saved it to Recovery History');
  await expect(dialog.getByLabel('Filter files')).toBeFocused();

  await dialog.getByRole('article').filter({ hasText: 'src/tracked.ts' })
    .getByRole('button', { name: 'Delete and stage', exact: true }).click();
  await expect(dialog.getByRole('alertdialog')).toContainText('deletion staged');
  await dialog.getByRole('button', { name: 'Delete file', exact: true }).last().click();
  await expect(dialog).toContainText('Staged deletion of src/tracked.ts');
  await expect(dialog.getByLabel('Filter files')).toBeFocused();
  const calls = await page.evaluate(() => (window as any).__center.calls);
  expect(calls.some((call: any) => call.command === 'create_repository_file' && call.args.path === 'new.ts')).toBe(true);
  expect(calls.some((call: any) => call.command === 'delete_untracked_repository_file' && call.args.path === 'notes.txt')).toBe(true);
  expect(calls.some((call: any) => call.command === 'delete_repository_file' && call.args.path === 'src/tracked.ts')).toBe(true);
});

test('recovers a file deleted from the repository browser through Recovery History', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const internal = (window as any).__TAURI_INTERNALS__;
    const invoke = internal.invoke;
    internal.invoke = (command: string, args: any) => {
      if (command === 'delete_untracked_repository_file') {
        fixture.deletedFile = fixture.files.find((file: any) => file.path === args.path);
        fixture.files = fixture.files.filter((file: any) => file.path !== args.path);
        fixture.capture = { id: '1791408000000000000-12', restored: false,
          paths: [args.path], pathsTruncated: false, pathsError: null, contentSha256: 'b'.repeat(64) };
        return invoke(command, args);
      }
      if (command === 'load_reflog' || command === 'load_operation_recoveries'
        || command === 'load_discard_recoveries' || command === 'apply_saved_discard') {
        fixture.calls.push({ command, args });
        if (command === 'load_reflog') return Promise.resolve({ entries: [], truncated: false });
        if (command === 'load_operation_recoveries') return Promise.resolve([]);
        if (command === 'load_discard_recoveries') return Promise.resolve([fixture.capture]);
        fixture.files.push(fixture.deletedFile);
        fixture.capture.restored = true;
        return Promise.resolve({ status: fixture.first.status, affectedToolbar: false });
      }
      return invoke(command, args);
    };
  });
  let workspace = await open(page, 'files');
  await workspace.getByRole('article').filter({ hasText: 'b.txt' })
    .getByRole('button', { name: 'Delete with recovery' }).click();
  await workspace.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();
  await expect(workspace).toContainText('Deleted b.txt and saved it to Recovery History');
  await workspace.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitem', { name: /Recovery History/ }).click();
  const history = page.locator('.recovery-dialog');
  await history.getByRole('button', { name: 'Open discarded-change recovery…' }).click();
  const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
  await expect(saved).toContainText('Captured');
  await expect(saved.getByRole('list', { name: 'Files in this capture' })).toContainText('b.txt');
  await saved.getByRole('button', { name: 'Recover…' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Recover changes' }).click();
  await expect(history.getByRole('button', { name: 'Open discarded-change recovery…' })).toBeFocused();
  await history.getByRole('button', { name: 'Close', exact: true }).click();
  workspace = await open(page, 'files');
  await expect(workspace.getByRole('article').filter({ hasText: 'b.txt' })).toBeVisible();
  const result = await page.evaluate(() => ({
    repoId: (window as any).__center.first.id,
    calls: (window as any).__center.calls,
  }));
  expect(result.calls.find((call: any) => call.command === 'delete_untracked_repository_file').args)
    .toMatchObject({ repoId: result.repoId, path: 'b.txt' });
  expect(result.calls.find((call: any) => call.command === 'apply_saved_discard').args)
    .toEqual({ repoId: result.repoId, id: '1791408000000000000-12', reverse: false, expectedSha256: 'b'.repeat(64) });
});

test('pages native file results, filters the entire list and ignores stale or failed replies', async ({ page }) => {
  await installFileBrowser(page);
  const dialog = await open(page, 'files');
  await expect(dialog).toContainText('Showing 2 files · page 1');
  await expect(dialog.getByText('a.txt', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog).toContainText('Showing 2 files · page 2');
  await expect(dialog.getByText('z.txt', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__center.listError = { message: 'Page unavailable.', hint: 'Try again.' }; });
  await dialog.getByRole('button', { name: 'Refresh files' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Page unavailable. Try again.');
  await page.evaluate(() => { (window as any).__center.listError = null; });
  await dialog.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(dialog.getByText('b.txt', { exact: true })).toBeVisible();

  await page.evaluate(() => { (window as any).__center.holdQuery = 'slow'; });
  const filter = dialog.getByLabel('Filter files');
  await filter.fill('slow');
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseQuery)).toBe('function');
  await filter.fill('Z');
  await expect(dialog.getByText('z.txt', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__center.releaseQuery());
  await expect(dialog.getByText('STALE.txt', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('z.txt', { exact: true })).toBeVisible();

  await page.evaluate(() => { (window as any).__center.listError = { message: 'File scan failed.', hint: 'Check repository access.' }; });
  await filter.fill('missing');
  await expect(dialog.getByRole('alert')).toContainText('File scan failed. Check repository access.');
  await expect(dialog.getByText('No files match this filter.')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__center.listError = null; (window as any).__center.incomplete = true; });
  await filter.fill('');
  await expect(dialog.getByRole('alert')).toContainText('Some matching paths could not be displayed safely');
});

test('does not present an incomplete or exhausted page as an empty repository', async ({ page }) => {
  await installFileBrowser(page);
  const dialog = await open(page, 'files');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByText('z.txt', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__center.files = []; });
  await dialog.getByRole('button', { name: 'Refresh files' }).click();
  await expect(dialog.getByText('No files remain on this page. Use Previous to review earlier results.')).toBeVisible();
  await expect(dialog.getByText('No Git-visible files in this repository.')).toHaveCount(0);

  await page.evaluate(() => { (window as any).__center.incomplete = true; });
  await dialog.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Some matching paths could not be displayed safely');
  await expect(dialog.getByText('No files could be displayed safely on this page.')).toBeVisible();
  await expect(dialog.getByText('No Git-visible files in this repository.')).toHaveCount(0);
});

test('offers browsing but not creation when the native build cannot create files', async ({ page }) => {
  await installFileBrowser(page, false);
  const dialog = await open(page, 'files');
  await expect(dialog.getByText('a.txt', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create file', exact: true })).toHaveCount(0);
  await expect(dialog).toContainText('Create files in your file manager or editor, then refresh this list.');
  expect(await page.evaluate(async () => {
    const component = (window as any).ng.getComponent(document.querySelector('gk-workspace-center'));
    component.newFilePath.set('suppressed.txt');
    await component.createFile();
    return (window as any).__center.calls.some((call: any) => call.command === 'create_repository_file');
  })).toBe(false);
});

test('refuses subdirectory creation and preserves spaces in a valid root file name', async ({ page }) => {
  await installFileBrowser(page);
  const dialog = await open(page, 'files');
  const input = dialog.getByLabel('New repository-relative file path');
  const create = dialog.getByRole('button', { name: 'Create file', exact: true });
  for (const path of ['src/new.txt', 'src\\new.txt']) {
    await input.fill(path);
    await expect(create).toBeDisabled();
    await expect(dialog).toContainText('Enter a file name without folders.');
  }
  expect(await page.evaluate(async () => {
    const component = (window as any).ng.getComponent(document.querySelector('gk-workspace-center'));
    await component.createFile();
    return (window as any).__center.calls.some((call: any) => call.command === 'create_repository_file');
  })).toBe(false);
  const path = ' new file.txt';
  await input.fill(path);
  await create.click();
  await expect.poll(() => page.evaluate(() => (window as any).__center.calls
    .find((call: any) => call.command === 'create_repository_file')?.args.path)).toBe(path);
});

for (const returnToFirst of [false, true]) {
  test(`does not submit a file creation draft after ${returnToFirst ? 'returning to the original checkout' : 'switching checkouts'}`, async ({ page }) => {
    await installFileBrowser(page);
    const dialog = await open(page, 'files');
    await expect(dialog.getByText('a.txt', { exact: true })).toBeVisible();
    const input = dialog.getByLabel('New repository-relative file path');
    await input.fill('belongs-to-alpha.txt');
    expect(await page.evaluate(async (returnToFirst) => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const component = (window as any).ng.getComponent(document.querySelector('gk-workspace-center'));
      const first = app.git.activeRepositoryId();
      app.git.activateRepository('clean-repo');
      if (returnToFirst) app.git.activateRepository(first);
      await component.createFile();
      return (window as any).__center.calls.filter((call: any) => call.command === 'create_repository_file');
    }, returnToFirst)).toEqual([]);
    await expect(input).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Create file', exact: true })).toBeDisabled();
  });
}

test('explains why tracked files can be unavailable for deletion', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => {
    (window as any).__center.files = [
      { path: 'flagged.txt', tracked: true, ignored: false, symbolicLink: false, deletable: false },
    ];
  });
  const dialog = await open(page, 'files');
  const entry = dialog.getByRole('article').filter({ hasText: 'flagged.txt' });
  await expect(entry).toContainText('Tracked · deletion unavailable');
  await expect(entry.getByRole('button', { name: 'Delete and stage' })).toHaveCount(0);
  await expect(dialog).toContainText('without index flags that hide changes');
});

test('opens untracked files without offering deletion when native recovery is unavailable', async ({ page }) => {
  await installFileBrowser(page, false);
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const root = fixture.files.find((file: any) => file.path === 'b.txt');
    fixture.files = [root, { ...root, path: 'src/notes.txt', deletableWithRecovery: false }];
  });
  const dialog = await open(page, 'files');
  const entry = dialog.getByRole('article').filter({ hasText: 'src/notes.txt' });
  await expect(entry).toContainText('Untracked · deletion unavailable');
  await expect(entry.getByRole('button', { name: 'Open' })).toBeEnabled();
  await expect(entry.getByRole('button', { name: 'Delete with recovery' })).toHaveCount(0);
  await expect(dialog.getByRole('article').filter({ hasText: 'b.txt' })
    .getByRole('button', { name: 'Delete with recovery' })).toBeEnabled();
  expect(await page.evaluate(() => {
    const component = (window as any).ng.getComponent(document.querySelector('gk-workspace-center'));
    component.confirmDelete(component.files().files.find((file: any) => file.path === 'src/notes.txt'));
    return component.pendingFileDelete() !== null;
  })).toBe(false);
});

test('a file deletion review cannot survive a round trip to the same checkout', async ({ page }) => {
  await installFileBrowser(page, false);
  const dialog = await open(page, 'files');
  await dialog.getByRole('article').filter({ hasText: 'b.txt' }).getByRole('button', { name: 'Delete with recovery' }).click();
  await expect(dialog.getByRole('alertdialog')).toBeVisible();
  expect(await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const component = (window as any).ng.getComponent(document.querySelector('gk-workspace-center'));
    const first = app.git.activeRepositoryId();
    app.git.activateRepository('clean-repo');
    app.git.activateRepository(first);
    await component.deleteFile(component.pendingFileDelete());
    return (window as any).__center.calls.filter((call: any) => call.command === 'delete_untracked_repository_file');
  })).toEqual([]);
  await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
});

test('dismissed file deletion controls cannot consume a replacement review', async ({ page }) => {
  await installFileBrowser(page, false);
  const dialog = await open(page, 'files');
  await dialog.getByRole('article').filter({ hasText: 'b.txt' }).getByRole('button', { name: 'Delete with recovery' }).click();
  await expect(dialog.getByRole('alertdialog')).toBeVisible();
  expect(await page.evaluate(async () => {
    const component = (window as any).ng.getComponent(document.querySelector('gk-workspace-center'));
    const previous = component.pendingFileDelete();
    component.cancelDelete(previous);
    component.confirmDelete(component.files().files.find((file: any) => file.path === 'a.txt'));
    await component.deleteFile(previous);
    component.cancelDelete(previous);
    return (window as any).__center.calls.filter((call: any) => call.command.startsWith('delete_'));
  })).toEqual([]);
  await expect(dialog.getByRole('alertdialog')).toHaveAccessibleName('Delete a.txt?');
});

test('traps the delete confirmation and restores focus on Escape', async ({ page }) => {
  await installFileBrowser(page);
  const dialog = await open(page, 'files');
  const opener = dialog.getByRole('article').filter({ hasText: 'a.txt' }).getByRole('button', { name: 'Delete and stage' });
  await opener.click();
  const confirmation = dialog.getByRole('alertdialog');
  const cancel = confirmation.getByRole('button', { name: 'Cancel' });
  const deleteButton = confirmation.getByRole('button', { name: 'Delete file' });
  await expect(cancel).toBeFocused();
  expect(await dialog.locator('[inert]').count()).toBe(1);
  await page.keyboard.press('Tab');
  await expect(deleteButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(deleteButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(dialog).toBeVisible();
});

test('guards duplicate submissions and reports completed changes with refresh failures', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => { (window as any).__center.holdCreate = true; });
  const dialog = await open(page, 'files');
  await expect(dialog.getByText('a.txt', { exact: true })).toBeVisible();
  await dialog.getByLabel('New repository-relative file path').fill('new.txt');
  await page.evaluate(() => {
    const component = (window as any).ng.getComponent(document.querySelector('gk-workspace-center'));
    void component.createFile(); void component.createFile();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__center.calls.filter((call: any) => call.command === 'create_repository_file').length)).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Create file' })).toBeDisabled();
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    fixture.listError = { message: 'File list unavailable.', hint: 'Try again.' };
    fixture.releaseCreate();
  });
  await expect(dialog.getByRole('status').filter({ hasText: 'Created new.txt' })).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('The file was created, but repository refresh failed: Snapshot unavailable. Refresh later.');
  await expect(dialog.getByRole('alert')).toContainText('The file was created, but the file list could not be refreshed: File list unavailable. Try again.');
  expect(await page.evaluate(() => (window as any).__center.calls.filter((call: any) => call.command === 'create_repository_file').length)).toBe(1);
});

for (const kind of ['repositoryFileRefused', 'gitFailure', 'gitUnavailable'] as const) {
  test(`keeps the confirmation and undo history after a safe ${kind} deletion error`, async ({ page }) => {
    await installFileBrowser(page);
    await page.evaluate((errorKind) => {
      const fixture = (window as any).__center;
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      git.recordDiscard(fixture.first.id, 'Earlier discard', 'earlier-id');
      fixture.deleteError = { kind: errorKind, message: 'File changed.', hint: 'Review it again.' };
    }, kind);
    const dialog = await open(page, 'files');
    await dialog.getByRole('article').filter({ hasText: 'a.txt' }).getByRole('button', { name: 'Delete and stage' }).click();
    const confirmation = dialog.getByRole('alertdialog');
    await confirmation.getByRole('button', { name: 'Delete file' }).click();
    await expect(confirmation.getByRole('alert')).toContainText('File changed. Review it again.');
    await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByText('Staged deletion of a.txt')).toHaveCount(0);
    const history = await page.evaluate(() => {
      const fixture = (window as any).__center;
      return (window as any).ng.getComponent(document.querySelector('gk-app')).git.operationHistory()[fixture.first.id];
    });
    expect(history).toMatchObject({ recoveryId: 'earlier-id', undone: false });
  });
}

for (const failure of ['backend', 'connection'] as const) {
  test(`refreshes and warns when tracked deletion has an uncertain ${failure} failure`, async ({ page }) => {
    await installFileBrowser(page);
    await page.evaluate((source) => {
      const fixture = (window as any).__center;
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      git.recordDiscard(fixture.first.id, 'Earlier discard', 'earlier-id');
      git.recordDiscard('clean-repo', 'Other discard', 'other-id');
      const internal = (window as any).__TAURI_INTERNALS__, invoke = internal.invoke;
      internal.invoke = (command: string, args: any) => {
        if (command === 'delete_repository_file') {
          fixture.files = fixture.files.filter((file: any) => file.path !== args.path);
          fixture.deleteError = source === 'backend'
            ? {
              kind: 'repositoryFileDeletionUncertain',
              message: 'Could not confirm file deletion.',
              hint: 'The file or index may already have changed. Refresh the repository and inspect both before retrying.',
            }
            : new Error('Desktop connection interrupted.');
        }
        return invoke(command, args);
      };
    }, failure);
    const dialog = await open(page, 'files');
    await dialog.getByRole('article').filter({ hasText: 'a.txt' }).getByRole('button', { name: 'Delete and stage' }).click();
    await dialog.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();
    await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toContainText('file or index may');
    await expect(dialog.getByRole('article').filter({ hasText: 'a.txt' })).toHaveCount(0);
    await expect(dialog.getByText('Staged deletion of a.txt')).toHaveCount(0);
    await expect(dialog.getByLabel('Filter files')).toBeFocused();
    const result = await page.evaluate(() => {
      const fixture = (window as any).__center;
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      return {
        history: git.operationHistory()[fixture.first.id] ?? null,
        other: git.operationHistory()['clean-repo'],
        deletions: fixture.calls.filter((call: any) => call.command === 'delete_repository_file').length,
      };
    });
    expect(result.history).toBeNull();
    expect(result.other).toMatchObject({ recoveryId: 'other-id', undone: false });
    expect(result.deletions).toBe(1);
  });
}

test('preserves newer undo history when an uncertain tracked deletion finishes late', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.recordDiscard(fixture.first.id, 'Earlier discard', 'earlier-id');
    const internal = (window as any).__TAURI_INTERNALS__, invoke = internal.invoke;
    internal.invoke = (command: string, args: any) => {
      if (command === 'delete_repository_file') {
        fixture.calls.push({ command, args });
        return new Promise((_, reject) => { fixture.rejectTrackedDelete = reject; });
      }
      return invoke(command, args);
    };
  });
  const dialog = await open(page, 'files');
  await dialog.getByRole('article').filter({ hasText: 'a.txt' }).getByRole('button', { name: 'Delete and stage' }).click();
  await dialog.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.rejectTrackedDelete)).toBe('function');
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.recordDiscard(fixture.first.id, 'Newer discard', 'newer-id');
    fixture.rejectTrackedDelete({
      kind: 'repositoryFileDeletionUncertain',
      message: 'Could not confirm file deletion.',
      hint: 'The file or index may already have changed. Inspect both before retrying.',
    });
  });
  await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toContainText('file or index may');
  const history = await page.evaluate(() => {
    const fixture = (window as any).__center;
    return (window as any).ng.getComponent(document.querySelector('gk-app')).git.operationHistory()[fixture.first.id];
  });
  expect(history).toMatchObject({ recoveryId: 'newer-id', undone: false });
});

test('retains the uncertainty warning when repository and file-list refreshes fail', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const internal = (window as any).__TAURI_INTERNALS__, invoke = internal.invoke;
    internal.invoke = (command: string, args: any) => {
      if (command === 'delete_repository_file') {
        fixture.deleteError = {
          kind: 'repositoryFileDeletionUncertain',
          message: 'Could not confirm file deletion.',
          hint: 'The file or index may already have changed. Inspect both before retrying.',
        };
        fixture.listError = { message: 'File list unavailable.', hint: 'Try again.' };
      }
      if (command === 'refresh_repository') return Promise.reject({ message: 'Repository unavailable.', hint: 'Check access.' });
      return invoke(command, args);
    };
  });
  const dialog = await open(page, 'files');
  await dialog.getByRole('article').filter({ hasText: 'a.txt' }).getByRole('button', { name: 'Delete and stage' }).click();
  await dialog.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();
  await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('file or index may already have changed');
  await expect(alert).toContainText('Repository refresh also failed: Repository unavailable. Check access.');
  await expect(alert).toContainText('The file list could not be refreshed: File list unavailable. Try again.');
  await expect(dialog.getByLabel('Filter files')).toBeFocused();
});

test('does not steal focus if the user moves it while the file list is refreshing', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const internal = (window as any).__TAURI_INTERNALS__, invoke = internal.invoke;
    internal.invoke = (command: string, args: any) => {
      if (command === 'delete_repository_file') fixture.holdQuery = '';
      return invoke(command, args);
    };
  });
  const dialog = await open(page, 'files');
  await dialog.getByRole('article').filter({ hasText: 'a.txt' }).getByRole('button', { name: 'Delete and stage' }).click();
  await dialog.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();
  await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releaseQuery)).toBe('function');
  await expect(dialog.getByLabel('Filter files')).toBeFocused();
  const filePath = dialog.getByLabel('New repository-relative file path');
  await filePath.focus();
  await page.evaluate(() => (window as any).__center.releaseQuery());
  await expect(dialog.getByRole('article').filter({ hasText: 'STALE.txt' })).toBeVisible();
  await expect(filePath).toBeFocused();
});

for (const failure of ['backend', 'connection', 'background', 'unknown'] as const) {
  test(`refreshes and warns when untracked deletion has an uncertain ${failure} failure`, async ({ page }) => {
    await installFileBrowser(page);
    await page.evaluate((source) => {
      const fixture = (window as any).__center;
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      git.recordDiscard(fixture.first.id, 'Earlier discard', 'earlier-id');
      git.recordDiscard('clean-repo', 'Other discard', 'other-id');
      const internal = (window as any).__TAURI_INTERNALS__, invoke = internal.invoke;
      internal.invoke = (command: string, args: any) => {
        if (command === 'delete_untracked_repository_file') {
          fixture.files = fixture.files.filter((file: any) => file.path !== args.path);
          fixture.deleteError = source === 'backend'
            ? {
              kind: 'discardFailedWithRecovery',
              message: 'Discard may have partially changed files.',
              hint: 'Inspect the working tree and the retained recovery before retrying.',
            }
            : source === 'connection'
              ? new Error('Desktop connection interrupted.')
              : { kind: source === 'background' ? 'backgroundTaskFailure' : 'unexpectedFailure', message: 'The discard did not return.' };
        }
        return invoke(command, args);
      };
    }, failure);
    const dialog = await open(page, 'files');
    await dialog.getByRole('article').filter({ hasText: 'b.txt' }).getByRole('button', { name: 'Delete with recovery' }).click();
    await dialog.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click();
    await expect(dialog.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toContainText(failure === 'backend' ? 'partially changed' : 'file may have changed');
    await expect(dialog.getByRole('article').filter({ hasText: 'b.txt' })).toHaveCount(0);
    await expect(dialog.getByLabel('Filter files')).toBeFocused();
    const result = await page.evaluate(() => {
      const fixture = (window as any).__center;
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      return {
        history: git.operationHistory()[fixture.first.id] ?? null,
        other: git.operationHistory()['clean-repo'],
        deletions: fixture.calls.filter((call: any) => call.command === 'delete_untracked_repository_file').length,
      };
    });
    expect(result.history).toBeNull();
    expect(result.other).toMatchObject({ recoveryId: 'other-id', undone: false });
    expect(result.deletions).toBe(1);
  });
}

test('keeps the confirmation and undo history after a safe untracked deletion refusal', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    git.recordDiscard(fixture.first.id, 'Earlier discard', 'earlier-id');
    fixture.deleteError = { kind: 'staleWorkingTreeFile', message: 'The file changed.', hint: 'Review it again.' };
  });
  const dialog = await open(page, 'files');
  await dialog.getByRole('article').filter({ hasText: 'b.txt' }).getByRole('button', { name: 'Delete with recovery' }).click();
  const confirmation = dialog.getByRole('alertdialog');
  await confirmation.getByRole('button', { name: 'Delete file' }).click();
  await expect(confirmation.getByRole('alert')).toContainText('The file changed. Review it again.');
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  const history = await page.evaluate(() => {
    const fixture = (window as any).__center;
    return (window as any).ng.getComponent(document.querySelector('gk-app')).git.operationHistory()[fixture.first.id];
  });
  expect(history).toMatchObject({ recoveryId: 'earlier-id', undone: false });
});

test('previews tracked and untracked working text without disabling editor actions', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => { (window as any).__center.textResponse = 'working text 雪\n'; });
  const workspace = await open(page, 'files');
  for (const path of ['a.txt', 'b.txt']) {
    await workspace.getByLabel('Filter files').fill(path);
    const opener = workspace.getByRole('article').filter({ hasText: path }).getByRole('button', { name: 'Open' });
    await opener.click();
    const content = page.getByRole('dialog', { name: path, exact: true });
    await expect(content.getByRole('region', { name: 'Read-only working text' })).toContainText('working text 雪');
    await expect(content.getByRole('button', { name: 'Edit working copy' })).toBeVisible();
    await expect(content.getByRole('button', { name: 'Review external editor for working file' })).toBeVisible();
    await content.getByRole('button', { name: 'Close file content' }).click();
    await expect(content).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

test('reloads workspace working text together with the content comparison', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => { (window as any).__center.textResponse = 'initial working text\n'; });
  const workspace = await open(page, 'files');
  await workspace.getByLabel('Filter files').fill('a.txt');
  await workspace.getByRole('article').filter({ hasText: 'a.txt' }).getByRole('button', { name: 'Open' }).click();
  const content = page.getByRole('dialog', { name: 'a.txt', exact: true });
  await expect(content.locator('pre')).toHaveText('initial working text\n');
  await page.evaluate(() => { (window as any).__center.textResponse = 'updated working text\n'; });
  await content.getByRole('button', { name: 'Reload content' }).click();
  await expect(content.locator('pre')).toHaveText('updated working text\n');
  const calls = await page.evaluate(() => (window as any).__center.calls);
  expect(calls.filter((call: any) => call.command === 'read_repository_file_text')).toHaveLength(2);
  expect(calls.filter((call: any) => call.command === 'inspect_file_media')).toHaveLength(2);
});

test('previews ignored text read-only while the underlying workspace dialog is suspended', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => { (window as any).__center.holdText = true; });
  const workspace = await open(page, 'files');
  await workspace.getByLabel('Filter files').fill('ignored');
  const file = workspace.getByRole('article').filter({ hasText: 'ignored.log' });
  await expect(file).toContainText('Ignored · read-only');
  await expect(file.getByRole('button', { name: /Delete/ })).toHaveCount(0);
  const opener = file.getByRole('button', { name: 'Open' });
  await opener.click();
  const content = page.getByRole('dialog', { name: 'ignored.log', exact: true });
  await expect(content.getByText('Reading text…')).toBeVisible();
  await expect(page.locator('gk-workspace-center .backdrop')).toHaveAttribute('inert', '');
  await expect(content.getByRole('button', { name: 'Close file content' })).toBeFocused();
  await page.evaluate(() => (window as any).__center.releaseText('private ignored text\n'));
  await expect(content.locator('pre')).toHaveText('private ignored text\n');
  await expect(content.getByRole('button', { name: /Edit/ })).toHaveCount(0);
  await page.keyboard.press('Tab');
  expect(await content.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await content.getByRole('button', { name: 'Close file content' }).click();
  await expect(content).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('cancels a held ignored-text preview when it closes', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => { (window as any).__center.holdText = true; });
  const workspace = await open(page, 'files');
  await workspace.getByLabel('Filter files').fill('ignored');
  await workspace.getByRole('article').filter({ hasText: 'ignored.log' }).getByRole('button', { name: 'Open' }).click();
  const content = page.getByRole('dialog', { name: 'ignored.log', exact: true });
  await expect(content.getByText('Reading text…')).toBeVisible();
  await content.getByRole('button', { name: 'Close file content' }).click();
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as any).__center.calls;
    const text = calls.find((call: any) => call.command === 'read_repository_file_text');
    return calls.some((call: any) => call.command === 'cancel_git_operation' && call.args.operationId === text?.args.operationId);
  })).toBe(true);
  await page.evaluate(() => (window as any).__center.releaseText('late reply'));
  await expect(content).toHaveCount(0);
});

for (const acknowledged of [true, false]) {
  test(`handles ${acknowledged ? 'late registration' : 'unacknowledged cancellation'} after closing a text preview`, async ({ page }) => {
    await installFileBrowser(page);
    await page.evaluate((acknowledged) => {
      (window as any).__center.holdText = true;
      (window as any).__center.cancelReplies = acknowledged ? [false, true] : [false, false, false];
    }, acknowledged);
    const workspace = await open(page, 'files');
    await workspace.getByLabel('Filter files').fill('ignored');
    await workspace.getByRole('article').filter({ hasText: 'ignored.log' }).getByRole('button', { name: 'Open' }).click();
    const content = page.getByRole('dialog', { name: 'ignored.log', exact: true });
    await expect(content.getByText('Reading text…')).toBeVisible();
    const operationId = await page.evaluate(() => (window as any).__center.calls
      .find((call: any) => call.command === 'read_repository_file_text').args.operationId);
    await content.getByRole('button', { name: 'Close file content' }).click();
    await expect(content).toHaveCount(0);
    await expect.poll(() => page.evaluate((operationId) => (window as any).__center.calls
      .filter((call: any) => call.command === 'cancel_git_operation' && call.args.operationId === operationId).length, operationId))
      .toBe(acknowledged ? 2 : 3);
    if (acknowledged) {
      expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.error())).toBeNull();
    } else {
      await expect(workspace.getByRole('region', { name: 'Background operation warnings' }).getByRole('alert'))
        .toContainText('previous text preview may still be running');
    }
    await page.evaluate(() => (window as any).__center.releaseText('late reply'));
    await expect(content).toHaveCount(0);
  });
}

test('shows a stalled text cancellation inside the current preview without replacing its new content', async ({ page }, testInfo) => {
  await installFileBrowser(page);
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    fixture.holdText = true;
    fixture.cancelReplies = ['held'];
    (window as any).ng.getComponent(document.querySelector('gk-app')).git.error.set('A separate Git error.');
  });
  const workspace = await open(page, 'files');
  await workspace.getByLabel('Filter files').fill('ignored');
  await workspace.getByRole('article').filter({ hasText: 'ignored.log' }).getByRole('button', { name: 'Open' }).click();
  const content = page.getByRole('dialog', { name: 'ignored.log', exact: true });
  await expect(content.getByText('Reading text…')).toBeVisible();
  await content.getByRole('button', { name: 'Reload content', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__center.textReleases.length)).toBe(2);
  const warning = content.getByRole('region', { name: 'Background operation warnings' });
  await expect(warning.getByRole('alert')).toContainText('previous text preview may still be running');
  await page.screenshot({ path: testInfo.outputPath('content-read-warnings-1440.png') });
  await page.evaluate(() => (window as any).__center.textReleases[1]('new text\n'));
  await expect(content.locator('pre')).toHaveText('new text\n');
  await page.evaluate(() => {
    (window as any).__center.releaseCancel(true);
    (window as any).__center.textReleases[0]('stale text\n');
  });
  await expect(content.locator('pre')).toHaveText('new text\n');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.error()))
    .toBe('A separate Git error.');
  await content.getByRole('button', { name: 'Close file content' }).click();
  const workspaceWarning = workspace.getByRole('region', { name: 'Background operation warnings' });
  await expect(workspaceWarning.getByRole('alert')).toContainText('previous text preview may still be running');
  await workspaceWarning.getByRole('button', { name: 'Dismiss background operation warning' }).click();
  await expect(workspaceWarning).toHaveCount(0);
});

test('keeps independent text and content cancellation warnings until each is dismissed', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 680 });
  await installFileBrowser(page);
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    fixture.holdText = true;
    fixture.holdMedia = true;
    fixture.cancelReplies = [false, false, false, false, false, false];
  });
  const workspace = await open(page, 'files');
  await workspace.getByLabel('Filter files').fill('ignored');
  await workspace.getByRole('article').filter({ hasText: 'ignored.log' }).getByRole('button', { name: 'Open' }).click();
  const content = page.getByRole('dialog', { name: 'ignored.log', exact: true });
  await expect(content.getByText('Reading text…')).toBeVisible();
  await expect(content.getByText('Reading selected sides…')).toBeVisible();
  await content.getByRole('button', { name: 'Close file content' }).click();
  const warnings = workspace.getByRole('region', { name: 'Background operation warnings' });
  await expect(warnings.getByRole('alert')).toHaveCount(2);
  const bounds = await warnings.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(680);
  await expect(warnings).toBeInViewport({ ratio: 1 });
  for (const warning of await warnings.locator('.background-operation-warning').all()) {
    const warningBounds = await warning.boundingBox();
    expect(warningBounds).not.toBeNull();
    expect(warningBounds!.y).toBeGreaterThanOrEqual(bounds!.y);
    expect(warningBounds!.y + warningBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  }
  const row = workspace.getByRole('article').filter({ hasText: 'ignored.log' });
  const path = await row.locator('code').boundingBox();
  const state = await row.locator('span').boundingBox();
  const openButton = await row.getByRole('button', { name: 'Open' }).boundingBox();
  expect(path).not.toBeNull();
  expect(state).not.toBeNull();
  expect(openButton).not.toBeNull();
  expect(path!.width).toBeGreaterThan(100);
  expect(path!.height).toBeLessThan(30);
  expect(path!.y + path!.height).toBeLessThanOrEqual(state!.y);
  expect(state!.y + state!.height).toBeLessThanOrEqual(openButton!.y);
  await page.screenshot({ path: testInfo.outputPath('content-read-warnings-320.png') });
  const textWarning = warnings.locator('.background-operation-warning').filter({ hasText: 'previous text preview' });
  const mediaWarning = warnings.locator('.background-operation-warning').filter({ hasText: 'previous content read' });
  await expect(textWarning).toBeVisible();
  await expect(mediaWarning).toBeVisible();
  await textWarning.getByRole('button', { name: 'Dismiss background operation warning' }).focus();
  await page.keyboard.press('Enter');
  await expect(textWarning).toHaveCount(0);
  await expect(mediaWarning).toBeVisible();
  await expect(mediaWarning.getByRole('button', { name: 'Dismiss background operation warning' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(warnings).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await expect(workspace.getByRole('button', { name: 'Close', exact: true })).toBeInViewport({ ratio: 1 });
  await page.evaluate(() => {
    (window as any).__center.releaseText('late text');
    (window as any).__center.releaseMedia();
  });
});

test('reports text preview errors and permits retry when the format is unavailable', async ({ page }) => {
  await installFileBrowser(page);
  await page.evaluate(() => {
    (window as any).__center.textError = { message: 'Text read failed.', hint: 'Check the file.' };
  });
  const workspace = await open(page, 'files');
  await workspace.getByLabel('Filter files').fill('ignored');
  await workspace.getByRole('article').filter({ hasText: 'ignored.log' }).getByRole('button', { name: 'Open' }).click();
  const content = page.getByRole('dialog', { name: 'ignored.log', exact: true });
  await expect(content.getByRole('alert')).toContainText('Text read failed. Check the file.');
  await page.evaluate(() => { (window as any).__center.textError = null; (window as any).__center.textResponse = null; });
  await content.getByRole('button', { name: 'Retry text preview' }).click();
  await expect(content).toContainText('Text could not be decoded automatically. The file remains read-only.');
});
