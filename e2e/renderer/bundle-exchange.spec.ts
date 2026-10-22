import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const repository = git.repository();
    app.commitMessage.set('Keep the unrelated draft');
    const fixture = {
      repository, calls: [] as any[], selectedFile: '/owned/history.bundle' as string | null,
      destination: '/owned/export.bundle' as string | null, refused: false, importRefused: false,
      refreshRefused: false, deferred: false, finish: null as (() => void) | null,
      request: { file: '/owned/history.bundle', fingerprint: 'b'.repeat(40), bytes: 4200, tips: [
        { reference: 'HEAD', oid: 'a'.repeat(40) },
        { reference: 'refs/heads/shared/branch', oid: 'a'.repeat(40) },
        { reference: 'refs/tags/v1', oid: 'c'.repeat(40) },
        { reference: 'refs/heads/' + 'long-name-'.repeat(18), oid: 'd'.repeat(40) },
      ] },
    };
    (window as any).__bundle = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'plugin:dialog|open') return Promise.resolve(fixture.selectedFile);
      if (command === 'plugin:dialog|save') return Promise.resolve(fixture.destination);
      if (command === 'export_git_bundle') {
        if (fixture.refused) return Promise.reject({ kind: 'bundleExchangeRefused', message: 'The source branch changed. Refresh before exporting.' });
        return Promise.resolve(4200);
      }
      if (command === 'review_git_bundle') {
        if (fixture.refused) return Promise.reject({ kind: 'bundleExchangeRefused', message: 'Missing prerequisite commits. No objects imported.' });
        const review = { request: fixture.request, verification: 'Complete advertised references; prerequisites available. Not an authenticity check.' };
        if (fixture.deferred) return new Promise(resolve => { fixture.finish = () => resolve(review); });
        return Promise.resolve(review);
      }
      if (command === 'import_git_bundle') {
        if (fixture.importRefused) return Promise.reject({ kind: 'bundleRecoveryFailed',
          message: 'Bundle objects were imported, but its recovery reference could not be created.',
          hint: 'Inspect and prepare a fresh review.' });
        return Promise.resolve('refs/git-khronos/recovery/owned-bundle');
      }
      if (['refresh_repository', 'refresh_repository_metadata', 'refresh_repository_status'].includes(command)) {
        if (fixture.refreshRefused) return Promise.reject(new Error('Refresh fixture failed'));
        const repo = git.repositories().find((item: any) => item.id === args.repoId);
        if (!repo) return Promise.reject(new Error('Unknown bundle fixture repository'));
        return Promise.resolve(command === 'refresh_repository_status' ? repo.status : repo);
      }
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await expect(page.locator('gc-bundle-exchange-panel')).toBeVisible();
  await page.locator('gc-bundle-exchange-panel summary').click();
}

test('complete branch export passes captured tip and original branch name without altering the draft', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  await expect(panel.getByRole('button', { name: 'Save branch bundle…', exact: true })).toBeDisabled();
  const branch = await page.evaluate(() => (window as any).__bundle.repository.branches.find((branch: any) => !branch.remote));
  await panel.getByLabel('Source branch', { exact: true }).selectOption(branch.name);
  await panel.getByRole('button', { name: 'Save branch bundle…', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Saved 4200 bytes');
  const fixture = await page.evaluate(() => (window as any).__bundle);
  expect(fixture.calls.find((call: any) => call.command === 'export_git_bundle').args)
    .toEqual({ repoId: fixture.repository.id, branch: branch.name, expectedOid: branch.oid, destination: '/owned/export.bundle' });
  await page.getByRole('button', { name: 'Close preferences' }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Keep the unrelated draft');
});

test('bundle review exposes all tips but requires explicit branch-only choice before exact recovery import', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  await panel.getByRole('button', { name: 'Choose and verify bundle…', exact: true }).click();
  const review = panel.getByRole('region', { name: 'Bundle import review' });
  await expect(review).toBeFocused();
  await expect(review.getByRole('list', { name: 'All advertised bundle tips' }).locator('li')).toHaveCount(4);
  await expect(review.getByRole('button', { name: 'Import into new recovery reference' })).toBeDisabled();
  await expect(review.getByLabel('Advertised branch to preserve').locator('option')).toHaveCount(3);
  expect((await page.evaluate(() => (window as any).__bundle.calls)).some((call: any) => call.command === 'import_git_bundle')).toBe(false);
  await review.getByLabel('Advertised branch to preserve').selectOption('refs/heads/shared/branch');
  await review.getByRole('button', { name: 'Import into new recovery reference' }).click();
  await expect(review).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('refs/git-khronos/recovery/owned-bundle');
  await expect(panel.getByRole('status')).toContainText('No existing branch or working file moved');
  const fixture = await page.evaluate(() => (window as any).__bundle);
  expect(fixture.calls.find((call: any) => call.command === 'import_git_bundle').args)
    .toEqual({ repoId: fixture.repository.id, request: fixture.request, tip: fixture.request.tips[1] });
  expect(fixture.calls.some((call: any) => call.command === 'refresh_repository' && call.args.repoId === fixture.repository.id)).toBe(true);
});

test('bundle chooser cancellations perform no native bundle operations', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  await page.evaluate(() => { (window as any).__bundle.selectedFile = null; (window as any).__bundle.destination = null; });
  await panel.getByRole('button', { name: 'Choose and verify bundle…' }).click();
  await expect(panel.getByRole('status')).toContainText('No objects imported');
  const branch = await page.evaluate(() => (window as any).__bundle.repository.branches.find((branch: any) => !branch.remote).name);
  await panel.getByLabel('Source branch', { exact: true }).selectOption(branch);
  await panel.getByRole('button', { name: 'Save branch bundle…' }).click();
  await expect(panel.getByRole('status')).toContainText('No file written');
  expect((await page.evaluate(() => (window as any).__bundle.calls))
    .some((call: any) => ['export_git_bundle', 'review_git_bundle', 'import_git_bundle'].includes(call.command))).toBe(false);
});

test('prerequisite and partial recovery failures focus explicit errors and cannot silently repeat imports', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  await page.evaluate(() => { (window as any).__bundle.refused = true; });
  await panel.getByRole('button', { name: 'Choose and verify bundle…' }).click();
  await expect(panel.getByRole('alert')).toContainText('Missing prerequisite');
  await expect(panel.getByRole('alert')).toBeFocused();
  await page.evaluate(() => { (window as any).__bundle.refused = false; (window as any).__bundle.importRefused = true; });
  await panel.getByRole('button', { name: 'Choose and verify bundle…' }).click();
  await panel.getByLabel('Advertised branch to preserve').selectOption('refs/heads/shared/branch');
  await panel.getByRole('button', { name: 'Import into new recovery reference' }).click();
  await expect(panel.getByRole('alert')).toContainText('objects were imported');
  await expect(panel.getByRole('alert')).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Import into new recovery reference' })).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__bundle.calls)).filter((call: any) => call.command === 'import_git_bundle')).toHaveLength(1);
});

test('post-import refresh refusal keeps the successful recovery reference visible and prevents blind retry', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  await panel.getByRole('button', { name: 'Choose and verify bundle…' }).click();
  await panel.getByLabel('Advertised branch to preserve').selectOption('refs/heads/shared/branch');
  await page.evaluate(() => { (window as any).__bundle.refreshRefused = true; });
  await panel.getByRole('button', { name: 'Import into new recovery reference' }).click();
  await expect(panel.getByRole('status')).toContainText('refs/git-khronos/recovery/owned-bundle');
  await expect(panel.getByRole('alert')).toContainText('refresh failed');
  await expect(panel.getByRole('alert')).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Import into new recovery reference' })).toHaveCount(0);
});

test('compact bundle review wraps long refs, links official help and cancels without Git mutation', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 550, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = page.locator('gc-bundle-exchange-panel');
  await panel.getByRole('button', { name: 'Choose and verify bundle…' }).click();
  const help = panel.getByRole('button', { name: 'Learn about offline bundles…', exact: true });
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Git command reference' })).toContainText('not authenticity');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  const cancel = panel.getByRole('button', { name: 'Cancel bundle review' });
  await cancel.scrollIntoViewIfNeeded();
  const bounds = await cancel.boundingBox();
  expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 550).toBeTruthy();
  await cancel.click();
  await expect(panel.getByRole('region', { name: 'Bundle import review' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Choose and verify bundle…' })).toBeFocused();
  expect((await page.evaluate(() => (window as any).__bundle.calls)).some((call: any) => call.command === 'import_git_bundle')).toBe(false);
});

test('complete advertised tips and prerequisite report remain keyboard-scrollable without importing objects', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  await page.evaluate(() => {
    for (let index = 0; index < 30; index++) (window as any).__bundle.request.tips.push({ reference: `refs/heads/scroll-${index}`, oid: 'a'.repeat(40) });
  });
  await panel.getByRole('button', { name: 'Choose and verify bundle…' }).click();
  await expect(panel.getByRole('region', { name: 'Bundle import review' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByLabel('Bundle prerequisite verification')).toBeFocused();
  await page.keyboard.press('Tab');
  const tips = panel.getByRole('list', { name: 'All advertised bundle tips' });
  await expect(tips).toBeFocused();
  await expect(tips.locator('li')).toHaveCount(34);
  await page.keyboard.press('PageDown');
  await expect.poll(() => tips.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect((await page.evaluate(() => (window as any).__bundle.calls)).some((call: any) => call.command === 'import_git_bundle')).toBe(false);
});

test('changed branch export refuses explicitly rather than claiming a saved file', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  const branch = await page.evaluate(() => {
    (window as any).__bundle.refused = true;
    return (window as any).__bundle.repository.branches.find((branch: any) => !branch.remote).name;
  });
  await panel.getByLabel('Source branch', { exact: true }).selectOption(branch);
  await panel.getByRole('button', { name: 'Save branch bundle…' }).click();
  await expect(panel.getByRole('alert')).toContainText('source branch changed');
  await expect(panel.getByRole('alert')).toBeFocused();
  await expect(panel.getByRole('status')).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__bundle.calls)).filter((call: any) => call.command === 'export_git_bundle')).toHaveLength(1);
});

test('loaded bundle review and explicit selection clear on repository switch without importing elsewhere', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  await panel.getByRole('button', { name: 'Choose and verify bundle…' }).click();
  await panel.getByLabel('Advertised branch to preserve').selectOption('refs/heads/shared/branch');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const source = (window as any).__bundle.repository;
    git.repositories.update((items: any[]) => [...items, { ...source, id: 'bundle-loaded-other', path: '/owned/loaded-other' }]);
    git.activeRepositoryId.set('bundle-loaded-other');
  });
  await expect(panel.getByRole('region', { name: 'Bundle import review' })).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__bundle.calls)).some((call: any) => call.command === 'import_git_bundle')).toBe(false);
});

test('late verified bundle never returns after switching away and back', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-bundle-exchange-panel');
  await page.evaluate(() => { (window as any).__bundle.deferred = true; });
  await panel.getByRole('button', { name: 'Choose and verify bundle…' }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__bundle.finish)).toBe(true);
  await expect(panel.getByRole('status')).toContainText('Verifying complete offline bundle');
  await expect(panel.getByRole('button', { name: 'Choose and verify bundle…' })).toBeDisabled();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const source = (window as any).__bundle.repository;
    git.repositories.update((items: any[]) => [...items, { ...source, id: 'bundle-other', path: '/owned/other' }]);
    git.activeRepositoryId.set('bundle-other');
  });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId())).toBe('bundle-other');
  await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId.set((window as any).__bundle.repository.id));
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId())).toBe(await page.evaluate(() => (window as any).__bundle.repository.id));
  await page.evaluate(() => (window as any).__bundle.finish());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(panel.getByRole('region', { name: 'Bundle import review' })).toHaveCount(0);
});
