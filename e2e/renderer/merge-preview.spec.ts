import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, keyboard = false): Promise<void> {
  const branch = page.locator('.branch-item').filter({ hasText: 'preview-target' }).first();
  if (keyboard) { await branch.focus(); await branch.press('Shift+F10'); }
  else await branch.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Preview merge conflicts…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Preview merge conflicts', exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.branch-item').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const repo = git.repository();
    const original = { ...repo, headOid: 'a'.repeat(40),
      branches: [
        { fullName: 'refs/heads/preview-source', name: 'preview-source', oid: 'a'.repeat(40), current: true, remote: false, upstream: null, tracking: null },
        { fullName: 'refs/heads/preview-target', name: 'preview-target', oid: 'b'.repeat(40), current: false, remote: false, upstream: null, tracking: null },
        { fullName: 'refs/remotes/origin/main', name: 'origin/main', oid: 'c'.repeat(40), current: false, remote: true, upstream: null, tracking: null },
      ], status: { ...repo.status, branch: 'preview-source' } };
    git.repositories.update((items: any[]) => items.map(item => item.id === original.id ? original : item));
    app.commitMessage.set('Retained draft');
    const fixture = { original, calls: [] as any[], hold: false, fail: false, clean: true, paths: [] as string[], finish: null as (() => void) | null };
    (window as any).__mergePreview = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'preview_merge') {
        if (fixture.fail) return Promise.reject({ kind: 'mergePreviewUnsupported', message: 'Merge preview requires complete history.', hint: 'No merge was started.' });
        const result = { request: args.request, clean: fixture.clean, conflictedPaths: fixture.paths };
        if (fixture.hold) return new Promise(resolve => { fixture.finish = () => resolve(result); });
        return Promise.resolve(result);
      }
      if (command === 'cancel_git_operation') return Promise.resolve(true);
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
  });
});

test('explicit preview sends exact direction and commit IDs without starting a merge', async ({ page }) => {
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Preview merge conflicts', exact: true });
  await expect(dialog.getByLabel('Merge source branch')).toHaveValue('refs/heads/preview-target');
  await expect(dialog.getByLabel('Into target branch')).toHaveValue('refs/heads/preview-source');
  expect(await page.evaluate(() => (window as any).__mergePreview.calls.filter((x: any) => x.command === 'preview_merge'))).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await expect(dialog).toContainText('No conflicts reported for these commits');
  await expect(dialog).toContainText('a'.repeat(40));
  await expect(dialog).toContainText('b'.repeat(40));
  await expect(dialog).toContainText('Uncommitted changes and remote updates not yet fetched are excluded');
  const calls = await page.evaluate(() => (window as any).__mergePreview.calls);
  const call = calls.find((x: any) => x.command === 'preview_merge');
  expect(call.args.request).toEqual({ source: 'refs/heads/preview-target', target: 'refs/heads/preview-source', sourceOid: 'b'.repeat(40), targetOid: 'a'.repeat(40) });
  expect(call.args.operationId).toMatch(/^[a-f\d-]{36}$/);
  expect(calls.every((x: any) => ['preview_merge', 'refresh_repository_status', 'refresh_repository_metadata'].includes(x.command))).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Retained draft');
});

test('conflicted paths and pathless conflicts remain distinct from a clean preview', async ({ page }) => {
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Preview merge conflicts', exact: true });
  await page.evaluate(() => { const f = (window as any).__mergePreview; f.clean = false; f.paths = ['source\nname', 'deleted.txt']; });
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await expect(dialog).toContainText('Git reports merge conflicts');
  await expect(dialog.getByRole('list', { name: 'Predicted conflicted paths' }).locator('li')).toHaveCount(2);
  await page.evaluate(() => { (window as any).__mergePreview.paths = []; });
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await expect(dialog).toContainText('without individual conflicted path records');
  await expect(dialog).not.toContainText('No conflicts reported');
});

test('moved or deleted references invalidate the displayed result and selection changes clear it', async ({ page }) => {
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Preview merge conflicts', exact: true });
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await expect(dialog).toContainText('No conflicts reported');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => items.map(repo => ({ ...repo, branches: repo.branches.map((b: any) => b.name === 'preview-target' ? { ...b, oid: 'd'.repeat(40) } : b) })));
  });
  await expect(dialog).toContainText('References changed');
  await expect(dialog).not.toContainText('No conflicts reported');
  await dialog.getByLabel('Into target branch').selectOption('refs/remotes/origin/main');
  await expect(dialog).not.toContainText('References changed');
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await expect(dialog).toContainText('c'.repeat(40));
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => items.map(repo => ({ ...repo, branches: repo.branches.filter((b: any) => b.fullName !== 'refs/remotes/origin/main') })));
  });
  await expect(dialog).toContainText('References changed');
  await expect(dialog.getByRole('button', { name: 'Preview conflicts', exact: true })).toBeDisabled();
});

test('cancellation suppresses even a late successful reply and permits an explicit retry', async ({ page }) => {
  await page.evaluate(() => { (window as any).__mergePreview.hold = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Preview merge conflicts', exact: true });
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await expect(dialog.getByLabel('Into target branch')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).__mergePreview; f.finish(); f.hold = false; });
  await expect(dialog).toContainText('Preview cancelled');
  await expect(dialog).not.toContainText('No conflicts reported');
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await expect(dialog).toContainText('No conflicts reported');
  const calls = await page.evaluate(() => (window as any).__mergePreview.calls);
  expect(calls.find((x: any) => x.command === 'cancel_git_operation').args.operationId)
    .toBe(calls.find((x: any) => x.command === 'preview_merge').args.operationId);
});

test('repository switch closes and cancels pending preview and discards its reply', async ({ page }) => {
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Preview merge conflicts', exact: true });
  await page.evaluate(() => { (window as any).__mergePreview.hold = true; });
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const other = { ...git.repository(), id: 'other-preview-repo', name: 'Other fixture', path: '/owned/other' };
    git.repositories.update((items: any[]) => [...items, other]); git.activeRepositoryId.set(other.id);
  });
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__mergePreview.calls.some((x: any) => x.command === 'cancel_git_operation'))).toBe(true);
  await page.evaluate(() => { (window as any).__mergePreview.finish(); });
  await expect(page.locator('gc-merge-preview-dialog')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('No conflicts reported for these commits');
});

test('unsupported history reports a failure and never a clean result', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__mergePreview.fail = true; });
  const dialog = page.getByRole('dialog', { name: 'Preview merge conflicts', exact: true });
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('complete history');
  await expect(dialog).not.toContainText('No conflicts reported');
});

test('keyboard access, focus trap, escape and compact layout remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, true);
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('dialog', { name: 'Preview merge conflicts', exact: true });
  await expect(dialog.getByLabel('Into target branch')).toBeFocused();
  await dialog.getByRole('button', { name: 'Preview conflicts', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Preview conflicts', exact: true })).toBeFocused();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(550);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await dialog.screenshot({ path: 'target/merge-preview-dialog-compact.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open left panel', exact: true })).toBeFocused();
});
