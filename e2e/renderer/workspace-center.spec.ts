import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, identities = false) {
  await page.getByRole('button', { name: /^Workspace: / }).click();
  await page.getByRole('menuitem', { name: identities ? 'Identity profiles' : 'Repository overview', exact: true }).click();
  return page.getByRole('dialog', { name: 'Workspace center', exact: true });
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
