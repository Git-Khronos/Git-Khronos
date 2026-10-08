import { expect, test, type Page } from '@playwright/test';
import type { CommitDetails } from '../../libs/contracts/src/index';

async function mockRecovery(page: Page, stale = false, loadFailure = false): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  await page.evaluate(({ stale, loadFailure }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const repository = git.repository();
    const record = {
      id: '1791408000000000000-12', label: 'hard reset to original base',
      headOid: repository.headOid, snapshotOid: 'b'.repeat(40),
      headReference: 'refs/git-chronos/recovery/1791408000000000000-12-head',
      snapshotReference: 'refs/git-chronos/recovery/1791408000000000000-12-changes',
      restored: false,
    };
    const fixture = { calls: [] as Array<{ command: string; args: any }>, records: [record], stale };
    (window as any).__operationTest = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'preview_reset') return Promise.resolve({
          token: `reset-${args.mode}`, headOid: repository.headOid,
          targetOid: args.oid, mode: args.mode,
          paths: args.mode === 'soft' ? [] : ['file.txt', 'unloaded/binary.bin'],
        });
        if (command === 'execute_prepared_reset') {
          if (fixture.stale) return Promise.reject({
            kind: 'staleReset', message: 'The working files changed. Nothing was reset. Review a new preview.',
          });
          return Promise.resolve({ ...repository, headOid: repository.commits[1].oid });
        }
        if (command === 'load_reflog') return Promise.resolve({ entries: [], truncated: false });
        if (command === 'load_operation_recoveries') {
          if (loadFailure) return Promise.reject({
            kind: 'invalidRecoveryMetadata', message: 'A saved recovery record could not be read. Inspect recovery storage.',
          });
          return Promise.resolve(fixture.records);
        }
        if (command === 'restore_operation_recovery') {
          fixture.records[0].restored = true;
          return Promise.resolve({ ...repository, status: { ...repository.status, branch: args.branch } });
        }
        if (command === 'forget_operation_recovery') { fixture.records = []; return Promise.resolve(); }
        if (command === 'refresh_repository') return Promise.resolve(git.repository());
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        if (command === 'inspect_commit') return Promise.resolve({
          oid: args.oid, message: 'Selected', files: [], filesTruncated: false,
          signature: { status: 'unsigned', signer: null, key: null, fingerprint: null, trust: null },
        } satisfies CommitDetails);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  }, { stale, loadFailure });
}

async function openReset(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Commit actions for Polish repository activity drawer' }).click();
  await page.getByRole('menuitem', { name: 'Reset to this commit…' }).click();
}

async function openRecovery(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitem', { name: /Recovery History/ }).click();
}

test('previews reset modes and executes only the captured native token', async ({ page }) => {
  await mockRecovery(page);
  await openReset(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog).toContainText('2 index paths affected');
  await dialog.locator('summary').click();
  await expect(dialog).toContainText('unloaded/binary.bin');
  await expect(dialog).toContainText('even after restarting');
  await dialog.getByRole('radio', { name: /Soft/ }).check();
  await expect(dialog).toContainText('0 tracked paths affected');
  await dialog.getByRole('radio', { name: /Hard/ }).check();
  await expect(dialog).toContainText('2 tracked paths affected');
  await dialog.getByRole('button', { name: 'Reset hard', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__operationTest.calls);
  expect(calls.filter((call: { command: string }) => call.command === 'preview_reset')
    .map((call: { args: { mode: string } }) => call.args.mode)).toEqual(['mixed', 'soft', 'hard']);
  expect(calls.find((call: { command: string }) => call.command === 'execute_prepared_reset')).toEqual({
    command: 'execute_prepared_reset', args: { repoId: expect.any(String), token: 'reset-hard' },
  });
  expect(calls.some((call: { command: string }) => call.command === 'reset_to_commit')).toBe(false);
});

test('keeps a failed stale reset open and requires a fresh preview', async ({ page }) => {
  await mockRecovery(page, true);
  await openReset(page);
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Reset mixed', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Nothing was reset');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Reset mixed', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__operationTest.stale = false; });
  await dialog.getByRole('button', { name: 'Review a new preview' }).click();
  await expect(dialog.getByRole('button', { name: 'Reset mixed', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('discovers durable reset captures and restores on an explicitly named clean branch', async ({ page }) => {
  await mockRecovery(page);
  await openRecovery(page);
  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  const capture = dialog.locator('.operation-capture');
  await expect(capture).toContainText('History and tracked contents');
  await capture.getByRole('button', { name: 'Restore on new branch...' }).click();
  const name = capture.getByLabel('Recovery branch name');
  await expect(name).toBeFocused();
  await name.fill('recovery/original-work');
  await expect(capture.getByRole('button', { name: 'Restore and switch' })).toBeDisabled();
  await expect(capture).toContainText('Save current changes');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repository = app.git.repository();
    app.git.repositories.update((repositories: any[]) => repositories.map((item) => item.id === repository.id
      ? { ...item, status: { ...item.status, entryCount: 0, entries: [], staged: 0, unstaged: 0, untracked: 0 } } : item));
  });
  await capture.getByRole('button', { name: 'Restore and switch' }).click();
  await expect(capture).toContainText('Previously restored');
  await expect(dialog.getByRole('button', { name: 'Refresh recovery history' })).toBeFocused();
  const call = await page.evaluate(() => (window as any).__operationTest.calls.find(
    (call: { command: string }) => call.command === 'restore_operation_recovery'));
  expect(call.args).toEqual({ repoId: expect.any(String), id: '1791408000000000000-12', branch: 'recovery/original-work' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Main menu' })).toBeFocused();
  await openRecovery(page);
  await expect(dialog.locator('.operation-capture')).toContainText('Previously restored');
});

test('confirms irreversible capture removal and preserves keyboard focus', async ({ page }) => {
  await mockRecovery(page);
  await openRecovery(page);
  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  const capture = dialog.locator('.operation-capture');
  await capture.getByRole('button', { name: 'Remove capture...' }).click();
  await expect(capture).toContainText('may become unrecoverable');
  await expect(capture.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await capture.getByRole('button', { name: 'Cancel' }).click();
  await expect(capture.getByRole('button', { name: 'Remove capture...' })).toBeFocused();
  await capture.getByRole('button', { name: 'Remove capture...' }).click();
  await capture.getByRole('button', { name: 'Permanently remove capture' }).click();
  await expect(capture).toHaveCount(0);
  await expect(dialog).toContainText('No saved operation captures');
});

test('shows recovery read failures instead of a success-shaped empty state', async ({ page }) => {
  await mockRecovery(page, false, true);
  await openRecovery(page);
  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  await expect(dialog.getByRole('alert')).toContainText('could not be read');
  await expect(dialog).not.toContainText('No saved operation captures');
});

test('blocks cross-repository capture actions and focuses the recovery error', async ({ page }) => {
  await mockRecovery(page);
  await openRecovery(page);
  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  const capture = dialog.locator('.operation-capture');
  await capture.getByRole('button', { name: 'Remove capture...' }).click();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const other = { ...app.git.repository(), id: 'another-repository', path: '/test/another' };
    app.git.repositories.update((repositories: any[]) => [...repositories, other]);
    app.git.activeRepositoryId.set('another-repository');
  });
  await capture.getByRole('button', { name: 'Permanently remove capture' }).click();
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.getByRole('alert')).toBeFocused();
  expect(await page.evaluate(() => (window as any).__operationTest.calls.some(
    (call: { command: string }) => call.command === 'forget_operation_recovery'))).toBe(false);
});

test('keeps recovery controls within the dialog at compact desktop sizes', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await mockRecovery(page);
  await openRecovery(page);
  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  await expect(dialog.getByRole('searchbox', { name: 'Search recovery history' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Restore on new branch...' }).click();
  await expect(dialog.getByLabel('Recovery branch name')).toBeFocused();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close recovery history', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
});

test('keeps reflog branch creation scoped to the reviewed repository', async ({ page }) => {
  await mockRecovery(page);
  await openRecovery(page);
  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.reflog.set({
      entries: [{
        oid: app.git.repository().headOid, selector: 'HEAD@{0}', subject: 'Before reset',
        authorName: 'Fixture', authorEmail: 'fixture@example.invalid',
      }], truncated: false,
    });
  });
  await dialog.getByRole('button', { name: 'Create branch', exact: true }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((repositories: any[]) => [
      ...repositories, { ...git.repository(), id: 'another-repository', path: '/test/another' },
    ]);
    git.activeRepositoryId.set('another-repository');
  });
  await dialog.getByRole('button', { name: /^Create at/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.getByRole('alert')).toBeFocused();
  expect(await page.evaluate(() => (window as any).__operationTest.calls.some(
    (call: { command: string }) => call.command === 'create_branch_at'))).toBe(false);
});
