import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, section: boolean | 'files' = false) {
  await page.getByRole('button', { name: /^Workspace: / }).click();
  const item = section === 'files' ? 'Repository files' : section ? 'Identity profiles' : 'Repository overview';
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  return page.getByRole('dialog', { name: 'Workspace center', exact: true });
}

async function installFileBrowser(page: Page) {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    fixture.calls = [];
    fixture.files = [
      { path: 'a.txt', tracked: true, ignored: false, symbolicLink: false, deletable: true },
      { path: 'b.txt', tracked: false, ignored: false, symbolicLink: false, deletable: false },
      { path: 'ignored.log', tracked: false, ignored: true, symbolicLink: false, deletable: false },
      { path: 'z.txt', tracked: false, ignored: false, symbolicLink: false, deletable: false },
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
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.branch-item').first()).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem('git-khronos.identity-profiles.v1');
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
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
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId())).toBe('clean-repo');
});

test('refreshes every local repository, retains failed cached rows and performs no transport', async ({ page }) => {
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      const fixture = (window as any).__center; fixture.calls.push({ command, args });
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
  expect(calls.every((call: any) => ['refresh_repository', 'refresh_repository_status', 'refresh_repository_metadata'].includes(call.command))).toBe(true);
});

test('fetches selected repositories independently and reports each result', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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

test('opens multiple selected directories and continues after an individual failure', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
});

test('a bulk pull invalidates its old diff without clearing a newer inspection', async ({ page }) => {
  await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.workingTreeFileDiff())).toBeNull();
  expect(await page.evaluate(() => (window as any).__center.calls.some((call: any) => call.command === 'refresh_repository_status'))).toBe(true);

  await page.evaluate(async () => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    await git.inspectWorkingTreeFile('old.txt', false);
    fixture.holdPull = true;
  });
  await dialog.getByRole('button', { name: 'Pull selected (1)' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__center.releasePull)).toBe('function');
  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    await git.inspectWorkingTreeFile('new.txt', false);
    (window as any).__center.releasePull();
  });
  await expect(dialog.getByLabel('Repository action results')).toContainText('alpha — success');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.workingTreeFileDiff()?.path)).toBe('new.txt');
});

test('an open response cannot attach to a workspace that changed while opening', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__center;
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().identity.name)).not.toBe('Work Author');
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
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().identity)).toEqual({ name: 'Work Author', email: 'work@example.test' });
  await dialog.getByRole('button', { name: 'Use Work…', exact: true }).click();
  await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId.set('clean-repo'));
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    fixture.files = {
      files: [
        { path: 'src/tracked.ts', tracked: true, ignored: false, symbolicLink: false, deletable: true },
        { path: 'notes.txt', tracked: false, ignored: false, symbolicLink: false, deletable: false },
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
  await dialog.getByLabel('New repository-relative file path').fill('src/new.ts');
  await dialog.getByRole('button', { name: 'Create file', exact: true }).click();
  await expect(dialog).toContainText('Created src/new.ts');
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
  expect(calls.some((call: any) => call.command === 'create_repository_file' && call.args.path === 'src/new.ts')).toBe(true);
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

test('preserves spaces in a new repository file path', async ({ page }) => {
  await installFileBrowser(page);
  const dialog = await open(page, 'files');
  const path = ' folder/new file .txt ';
  await dialog.getByLabel('New repository-relative file path').fill(path);
  await dialog.getByRole('button', { name: 'Create file', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__center.calls
    .find((call: any) => call.command === 'create_repository_file')?.args.path)).toBe(path);
});

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
    const component = (window as any).ng.getComponent(document.querySelector('gc-workspace-center'));
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
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
      return (window as any).ng.getComponent(document.querySelector('gc-root')).git.operationHistory()[fixture.first.id];
    });
    expect(history).toMatchObject({ recoveryId: 'earlier-id', undone: false });
  });
}

for (const failure of ['backend', 'connection'] as const) {
  test(`refreshes and warns when tracked deletion has an uncertain ${failure} failure`, async ({ page }) => {
    await installFileBrowser(page);
    await page.evaluate((source) => {
      const fixture = (window as any).__center;
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    return (window as any).ng.getComponent(document.querySelector('gc-root')).git.operationHistory()[fixture.first.id];
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
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    return (window as any).ng.getComponent(document.querySelector('gc-root')).git.operationHistory()[fixture.first.id];
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
  await expect(page.locator('gc-workspace-center .backdrop')).toHaveAttribute('inert', '');
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
      expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.error())).toBeNull();
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
    (window as any).ng.getComponent(document.querySelector('gc-root')).git.error.set('A separate Git error.');
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
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.error()))
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
