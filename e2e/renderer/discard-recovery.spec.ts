import { expect, test } from '@playwright/test';

const path = 'apps/desktop/src/app/app.component.html';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
});

for (const selected of [false, true]) {
  test(`previews ${selected ? 'selected' : 'all'} unstaged changes before discarding`, async ({ page }) => {
    await page.evaluate((path) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const git = app.git;
      const before = git.repository().status;
      const test = { calls: [] as Array<{ command: string; args: any }>, before };
      (window as any).__discardTest = test;
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string, args: any) => {
          test.calls.push({ command, args });
          if (command === 'preview_discard') return Promise.resolve({
            token: 'native-token', paths: [path, 'unloaded/file.bin'],
            skippedPaths: ['nested/'], untracked: 1,
          });
          if (command === 'discard_changes') return Promise.resolve({
            id: '1791408000000000000-12',
            status: { ...before, unstaged: 0, entries: before.entries.filter((entry: any) => entry.path !== path) },
          });
          if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
          return Promise.reject(new Error(`Unexpected command ${command}`));
        },
      };
    }, path);
    await expect(page.getByRole('checkbox', { name: `Select ${path} for discard` })).toHaveCount(0);
    await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
    if (selected) {
      await page.getByRole('menuitem', { name: /^Select files for discard/ }).click();
      await page.getByRole('checkbox', { name: `Select ${path} for discard` }).check();
      await page.getByRole('button', { name: 'Discard selected…' }).click();
    } else {
      await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
    }
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('unloaded/file.bin');
    await expect(dialog).toContainText('nested/');
    await expect(dialog).toContainText('Staged contents and ignored files remain untouched');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    const preview = await page.evaluate(() => (window as any).__discardTest.calls.filter(
      (call: { command: string }) => call.command !== 'refresh_repository_status'));
    expect(preview).toEqual([{ command: 'preview_discard', args: {
      repoId: expect.any(String), paths: selected ? [path] : null,
    } }]);
    await dialog.getByRole('button', { name: 'Discard captured changes' }).click();
    await expect(page.locator('#unstaged-files-list').getByRole('button', { name: `Stage ${path}` })).toHaveCount(0);
    const result = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      return { calls: (window as any).__discardTest.calls, staged: app.git.repository().status.staged,
        beforeStaged: (window as any).__discardTest.before.staged };
    });
    expect(result.staged).toBe(result.beforeStaged);
    expect(result.calls.find((call: { command: string }) => call.command === 'discard_changes')).toEqual({ command: 'discard_changes', args: {
      repoId: expect.any(String), token: 'native-token',
    } });
  });
}

test('a stale preview surfaces its error and keeps current files', async ({ page }) => {
  await page.evaluate((path) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'preview_discard') return Promise.resolve({
          token: 'stale', paths: [path], skippedPaths: [], untracked: 0,
        });
        if (command === 'discard_changes') return Promise.reject({
          kind: 'staleDiscard', message: 'Files changed after the preview. Nothing was discarded.',
        });
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  }, path);
  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard captured changes' }).click();
  await expect(page.locator('#unstaged-files-list').getByRole('button', { name: `Stage ${path}` })).toBeVisible();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.error()))
    .toContain('Nothing was discarded');
});

test('discovers saved recovery after restart and confirms capture removal', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__recoveryCalls = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        (window as any).__recoveryCalls.push({ command, args });
        if (command === 'load_discard_recoveries') return Promise.resolve([
          { id: '1791408000000000000-12', restored: false },
        ]);
        if (command === 'forget_saved_discard') return Promise.resolve();
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
  const opener = page.getByRole('button', { name: 'Working directory options', exact: true });
  await opener.click();
  await page.getByRole('menuitem', { name: /^Recover discarded/ }).click();
  const recovery = page.getByRole('dialog', { name: 'Discarded-change recovery' });
  await expect(recovery).toContainText('Captured');
  await recovery.getByRole('button', { name: 'Close' }).press('Escape');
  await expect(opener).toBeFocused();
  await opener.click();
  await page.getByRole('menuitem', { name: /^Recover discarded/ }).click();
  await recovery.getByRole('button', { name: 'Remove capture…' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('Permanently remove');
  await confirmation.getByRole('button', { name: 'Remove capture', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__recoveryCalls.at(-1))).toEqual({
    command: 'forget_saved_discard', args: { repoId: expect.any(String), id: '1791408000000000000-12' },
  });
});
