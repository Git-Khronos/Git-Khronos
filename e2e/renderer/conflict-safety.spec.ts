import { expect, test, type Page } from '@playwright/test';
import type { ConflictDetails } from '../../libs/contracts/src/index';

async function openConflict(page: Page, options: { stale?: boolean; rebase?: boolean; truncated?: boolean; deleted?: boolean; submodule?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate((options) => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const status = {
      ...repository.status, staged: 0, unstaged: 0, untracked: 0, conflicted: 1, entryCount: 1,
      mergeInProgress: !options.rebase, rebaseInProgress: !!options.rebase,
      entries: [{ path: 'shared.txt', originalPath: null, indexStatus: 'U', worktreeStatus: 'U', conflicted: true }],
    };
    const details: ConflictDetails = {
      path: 'shared.txt', ancestor: options.submodule ? 'Submodule commit aaaaaaaaaa\n' : 'base\n',
      current: options.submodule ? 'Submodule commit bbbbbbbbbb\n' : 'current\n',
      incoming: options.deleted ? null : options.submodule ? 'Submodule commit cccccccccc\n' : 'incoming\n',
      output: options.submodule ? null : 'working conflict\n',
      binary: false, truncated: !!options.truncated, editable: !options.truncated && !options.submodule,
      state: 'native-reviewed-state', currentExists: true, incomingExists: !options.deleted,
      submodule: !!options.submodule,
    };
    git.repositories.update((repositories: any[]) => repositories.map((item) =>
      item.id === repository.id ? { ...item, status } : item));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { details, calls: [] as Array<{ command: string; args: any }>, stale: !!options.stale };
    (window as any).__conflictTest = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'inspect_conflict') return Promise.resolve(fixture.details);
        if (command === 'resolve_conflict') {
          if (fixture.stale) return Promise.reject({
            kind: 'staleConflictPreview', message: 'The working file changed. Nothing was resolved. Reload the conflict.',
          });
          return Promise.resolve({ ...repository, status: { ...status, conflicted: 0, entries: [] } });
        }
        if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  }, options);
  await page.getByTitle('Open Merge Tool for shared.txt').click();
  await expect(page.getByRole('dialog', { name: 'Merge conflict editor' })).toBeVisible();
}

test('saves edited conflict output only with the reviewed native state', async ({ page }) => {
  await openConflict(page);
  const dialog = page.getByRole('dialog', { name: 'Merge conflict editor' });
  await expect(dialog.getByRole('button', { name: 'Close conflict editor' })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Resolved output for shared.txt' }).fill('resolved\n');
  await dialog.getByRole('button', { name: 'Save Output & Mark Resolved' }).click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => (window as any).__conflictTest.calls.find(
    (entry: { command: string }) => entry.command === 'resolve_conflict'));
  expect(call).toEqual({
    command: 'resolve_conflict',
    args: { repoId: expect.any(String), path: 'shared.txt', resolution: 'output',
      output: 'resolved\n', expectedState: 'native-reviewed-state' },
  });
});

test('retains edited output on stale failure and requires explicit reload', async ({ page }) => {
  await openConflict(page, { stale: true });
  const dialog = page.getByRole('dialog', { name: 'Merge conflict editor' });
  const output = dialog.getByRole('textbox', { name: 'Resolved output for shared.txt' });
  await output.fill('my edits\n');
  await dialog.getByRole('button', { name: 'Save Output & Mark Resolved' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Nothing was resolved');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(output).toHaveValue('my edits\n');
  await page.evaluate(() => {
    (window as any).__conflictTest.details = {
      ...(window as any).__conflictTest.details, state: 'new-state', output: 'external edits\n',
    };
  });
  await dialog.getByRole('button', { name: 'Reload conflict' }).click();
  await expect(output).toHaveValue('external edits\n');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('explains rebase side meanings and traps focus in a compact editor', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await openConflict(page, { rebase: true });
  const dialog = page.getByRole('dialog', { name: 'Merge conflict editor' });
  await expect(dialog).toContainText('Current is the destination history');
  await expect(dialog).toContainText('Incoming is the commit now being replayed');
  const last = dialog.getByRole('button', { name: 'Save Output & Mark Resolved' });
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close conflict editor' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  const bounds = await last.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTitle('Open Merge Tool for shared.txt')).toBeFocused();
});

test('keeps truncated conflict output read-only and provides complete-side actions', async ({ page }) => {
  await openConflict(page, { truncated: true });
  const dialog = page.getByRole('dialog', { name: 'Merge conflict editor' });
  await expect(dialog).toContainText('truncated at 256 KB');
  await expect(dialog.getByRole('textbox')).toHaveAttribute('readonly', '');
  await expect(dialog.getByRole('button', { name: 'Save Output & Mark Resolved' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Use current', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Take Current', exact: true })).toBeEnabled();
});

test('labels accepting a deleted side separately from saving an empty file', async ({ page }) => {
  await openConflict(page, { deleted: true });
  const dialog = page.getByRole('dialog', { name: 'Merge conflict editor' });
  await expect(dialog.getByRole('button', { name: 'Accept incoming deletion' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Use incoming', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save Output & Mark Resolved' })).toBeEnabled();
});

test('resolves a submodule conflict by staging one reviewed gitlink without presenting a text editor', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 560 });
  await openConflict(page, { submodule: true });
  const dialog = page.getByRole('dialog', { name: 'Merge conflict editor' });
  await expect(dialog).toContainText('Submodule commit conflict');
  await expect(dialog).toContainText('does not check out, fetch, reset, or modify files inside the submodule');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Keep Current Commit' })).toBeEnabled();
  const incoming = dialog.getByRole('button', { name: 'Keep Incoming Commit' });
  const bounds = await incoming.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(560);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await incoming.click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => (window as any).__conflictTest.calls.find(
    (entry: { command: string }) => entry.command === 'resolve_conflict'));
  expect(call).toEqual({
    command: 'resolve_conflict',
    args: { repoId: expect.any(String), path: 'shared.txt', resolution: 'incoming',
      output: null, expectedState: 'native-reviewed-state' },
  });
});

test('does not resolve an old conflict in a newly active repository', async ({ page }) => {
  await openConflict(page);
  const dialog = page.getByRole('dialog', { name: 'Merge conflict editor' });
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const other = { ...git.repository(), id: 'other-repository', path: '/test/other' };
    git.repositories.update((repositories: any[]) => [...repositories, other]);
    git.activeRepositoryId.set(other.id);
  });
  await dialog.getByRole('button', { name: 'Take Current', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  expect(await page.evaluate(() => (window as any).__conflictTest.calls.some(
    (call: { command: string }) => call.command === 'resolve_conflict'))).toBe(false);
});

test('keeps pending reload visible and never reopens a dismissed conflict', async ({ page }) => {
  await openConflict(page);
  const dialog = page.getByRole('dialog', { name: 'Merge conflict editor' });
  await page.evaluate(() => {
    const original = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command === 'inspect_conflict') return new Promise((resolve) => {
        (window as any).__conflictTest.release = () => resolve((window as any).__conflictTest.details);
      });
      return original(command, args);
    };
  });
  await dialog.getByRole('button', { name: 'Reload conflict' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Take Current', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close conflict editor' }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).__conflictTest.release());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(dialog).toHaveCount(0);
});
