import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const source = git.repository();
    const repository = { ...source, status: { ...source.status, entries: [
      { path: 'tracked.txt', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
      { path: 'staged[1]\tline\nfile.bin', indexStatus: 'A', worktreeStatus: ' ', conflicted: false },
      { path: 'untracked', indexStatus: '?', worktreeStatus: '?', conflicted: false },
    ], entryCount: 3 } };
    git.repositories.update((items: any[]) => items.map(item => item.id === repository.id ? repository : item));
    const request = { file: '/owned/input.patch', target: 'worktree', patch: [1, 2, 3, 4],
      headOid: 'a'.repeat(40), headRef: 'refs/heads/main\n', indexState: [5, 6] };
    const fixture = { repository, calls: [] as any[], selectedFile: '/owned/input.patch' as string | null,
      destination: '/owned/export.patch' as string | null, request,
      refused: false, applyRefused: false, deferred: false, finish: null as (() => void) | null };
    (window as any).__patch = fixture;
    app.commitMessage.set('Keep unrelated draft');
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'plugin:dialog|open') return Promise.resolve(fixture.selectedFile);
      if (command === 'plugin:dialog|save') return Promise.resolve(fixture.destination);
      if (command === 'export_diff_patch') return Promise.resolve(1500);
      if (command === 'review_diff_patch') {
        if (fixture.refused) return Promise.reject({ kind: 'patchExchangeRefused',
          message: 'Patch import requires a completely clean index and working tree.',
          hint: 'Preserve local changes and prepare a fresh review.' });
        const review = { request: { ...fixture.request, target: args.target },
          files: [{ path: 'tracked.txt', added: 2, deleted: 1 },
            { path: 'a-very-long-literal-file-name-'.repeat(5) + '.bin', added: null, deleted: null }],
          summary: ' create mode 100644 new-file\n' };
        if (fixture.deferred) return new Promise(resolve => { fixture.finish = () => resolve(review); });
        return Promise.resolve(review);
      }
      if (command === 'import_diff_patch') {
        if (fixture.applyRefused) return Promise.reject({ kind: 'patchExchangeRefused',
          message: 'The patch file, HEAD, branch or index changed after review. No patch was applied.',
          hint: 'Prepare a fresh review; do not repeat blindly.' });
        return Promise.resolve(fixture.repository);
      }
      if (['refresh_repository', 'refresh_repository_metadata', 'refresh_repository_status'].includes(command)) {
        const repo = git.repositories().find((item: any) => item.id === args.repoId);
        if (!repo) return Promise.reject(new Error('Unknown patch fixture repository'));
        return Promise.resolve(command === 'refresh_repository_status' ? repo.status : repo);
      }
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  const panel = page.locator('gc-patch-exchange-panel');
  await expect(panel).toBeVisible();
  await panel.locator(':scope > details > summary').click();
}

for (const target of ['worktree', 'index', 'both']) {
  test(`patch ${target} requires a complete review before exact immutable IPC without changing drafts or refs`, async ({ page }) => {
    await setup(page);
    const panel = page.locator('gc-patch-exchange-panel');
    await panel.getByLabel('Apply to', { exact: true }).selectOption(target);
    await panel.getByRole('button', { name: 'Choose and check patch…', exact: true }).click();
    const review = panel.getByRole('region', { name: 'Patch import review', exact: true });
    await expect(review).toBeFocused();
    await expect(review).toContainText('4 bytes');
    await expect(review).toContainText('Binary change');
    await expect(review.getByRole('list', { name: 'Complete patch paths' }).locator('li')).toHaveCount(2);
    expect((await page.evaluate(() => (window as any).__patch.calls))
      .some((call: any) => call.command === 'import_diff_patch')).toBe(false);
    await review.getByRole('button', { name: 'Apply reviewed patch', exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(panel.getByRole('status')).toContainText('Inspect the changes before committing');
    const fixture = await page.evaluate(() => (window as any).__patch);
    expect(fixture.calls.find((call: any) => call.command === 'review_diff_patch').args)
      .toEqual({ repoId: fixture.repository.id, file: '/owned/input.patch', target });
    expect(fixture.calls.find((call: any) => call.command === 'import_diff_patch').args)
      .toEqual({ repoId: fixture.repository.id, request: { ...fixture.request, target } });
    await page.getByRole('button', { name: 'Close preferences' }).click();
    await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Keep unrelated draft');
  });
}

test('staged literal export excludes untracked files and passes the complete selected path without string splitting', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-patch-exchange-panel');
  await panel.getByLabel('Diff source', { exact: true }).selectOption({ label: 'Staged: index compared with HEAD' });
  await panel.getByLabel('All tracked changes in this scope', { exact: true }).uncheck();
  const selected = panel.getByLabel('Patch export file selection').getByRole('checkbox');
  await expect(selected).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Save diff patch…', exact: true })).toBeDisabled();
  await selected.check();
  await panel.getByRole('button', { name: 'Save diff patch…', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Saved 1500 bytes');
  const fixture = await page.evaluate(() => (window as any).__patch);
  expect(fixture.calls.find((call: any) => call.command === 'export_diff_patch').args)
    .toEqual({ repoId: fixture.repository.id, staged: true, paths: ['staged[1]\tline\nfile.bin'], destination: '/owned/export.patch' });
  expect(fixture.calls.some((call: any) => call.command === 'import_diff_patch')).toBe(false);
});

test('native file chooser cancellations perform no Git calls and target changes invalidate a previously checked review', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-patch-exchange-panel');
  await page.evaluate(() => { (window as any).__patch.selectedFile = null; (window as any).__patch.destination = null; });
  await panel.getByRole('button', { name: 'Choose and check patch…', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('selection cancelled');
  await panel.getByRole('button', { name: 'Save diff patch…', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Export cancelled');
  expect((await page.evaluate(() => (window as any).__patch.calls))
    .some((call: any) => ['review_diff_patch', 'export_diff_patch', 'import_diff_patch'].includes(call.command))).toBe(false);
  await page.evaluate(() => { (window as any).__patch.selectedFile = '/owned/input.patch'; });
  await panel.getByRole('button', { name: 'Choose and check patch…', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Patch import review' })).toBeVisible();
  await panel.getByLabel('Apply to', { exact: true }).selectOption('both');
  await expect(panel.getByRole('region', { name: 'Patch import review' })).toHaveCount(0);
});

test('preflight and stale-apply failures are focused, explicit and require a fresh check rather than replaying twice', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-patch-exchange-panel');
  await page.evaluate(() => { (window as any).__patch.refused = true; });
  await panel.getByRole('button', { name: 'Choose and check patch…', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('completely clean');
  await expect(panel.getByRole('alert')).toBeFocused();
  await page.evaluate(() => { (window as any).__patch.refused = false; (window as any).__patch.applyRefused = true; });
  await panel.getByRole('button', { name: 'Choose and check patch…', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply reviewed patch', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('changed after review');
  await expect(panel.getByRole('alert')).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Apply reviewed patch', exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__patch.calls))
    .filter((call: any) => call.command === 'import_diff_patch')).toHaveLength(1);
});

test('late checked patch never returns after switching away and back to the original repository', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-patch-exchange-panel');
  await page.evaluate(() => { (window as any).__patch.deferred = true; });
  await panel.getByRole('button', { name: 'Choose and check patch…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__patch.finish)).toBe(true);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const source = (window as any).__patch.repository;
    git.repositories.update((items: any[]) => [...items, { ...source, id: 'patch-other', path: '/owned/patch-other' }]);
    git.activeRepositoryId.set('patch-other');
  });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId())).toBe('patch-other');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.activeRepositoryId.set((window as any).__patch.repository.id);
  });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId()))
    .toBe(await page.evaluate(() => (window as any).__patch.repository.id));
  await page.evaluate(() => { (window as any).__patch.finish(); });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(panel.getByRole('region', { name: 'Patch import review' })).toHaveCount(0);
});

test('compact reduced-motion review remains bounded and help/cancel retain keyboard focus without applying', async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 550, height: 700 });
  const panel = page.locator('gc-patch-exchange-panel');
  await panel.getByRole('button', { name: 'Choose and check patch…', exact: true }).click();
  const help = panel.getByRole('button', { name: 'Learn about diff patches and apply…', exact: true });
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Git command reference' })).toContainText('Index-only application');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  const apply = panel.getByRole('button', { name: 'Apply reviewed patch', exact: true });
  await apply.scrollIntoViewIfNeeded();
  const bounds = await apply.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(24);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(550);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await panel.getByRole('button', { name: 'Cancel patch review', exact: true }).click();
  await expect(panel.getByLabel('Apply to', { exact: true })).toBeFocused();
  await expect(panel.getByRole('region', { name: 'Patch import review' })).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__patch.calls))
    .some((call: any) => call.command === 'import_diff_patch')).toBe(false);
});

test('loaded patch review is discarded when the active repository changes without importing elsewhere', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-patch-exchange-panel');
  await panel.getByRole('button', { name: 'Choose and check patch…', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Patch import review' })).toBeVisible();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const source = (window as any).__patch.repository;
    git.repositories.update((items: any[]) => [...items, { ...source, id: 'loaded-other', path: '/owned/loaded-other' }]);
    git.activeRepositoryId.set('loaded-other');
  });
  await expect(panel.getByRole('region', { name: 'Patch import review' })).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__patch.calls))
    .some((call: any) => call.command === 'import_diff_patch')).toBe(false);
});

for (const action of ['cancel', 'failure'] as const) {
  test(`deferred patch tools ${action} leaves preferences escapable and never runs patch commands`, async ({ page }) => {
    let release: (() => void) | null = null;
    let patchFetched = false;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      if (!text.includes('review_diff_patch') || !text.includes('Choose and check patch')) {
        await route.fulfill({ response, body: text });
        return;
      }
      patchFetched = true;
      if (action === 'failure') await route.abort();
      else {
        await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ response, body: text });
      }
    });
    await page.goto('/');
    await expect(page.locator('#unstaged-files-list')).toBeVisible();
    expect(patchFetched).toBe(false);
    await page.evaluate(() => {
      (window as any).__patchCommands = [];
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        (window as any).__patchCommands.push(command);
        const repo = git.repositories().find((item: any) => item.id === args?.repoId);
        if (command === 'refresh_repository_status') return Promise.resolve(repo?.status);
        if (command === 'refresh_repository_metadata') return Promise.resolve(repo);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      } };
    });
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    const preferences = page.getByRole('dialog', { name: 'Preferences' });
    await preferences.getByRole('tab', { name: /^Git/ }).click();
    if (action === 'failure') await expect(preferences.getByRole('alert')).toContainText('Repository tools unavailable');
    else {
      await expect(preferences.getByRole('status')).toContainText('Loading repository tools');
      await expect.poll(() => !!release).toBe(true);
    }
    await page.getByRole('button', { name: 'Close preferences', exact: true }).click();
    if (release) (release as () => void)();
    await expect(preferences).toHaveCount(0);
    await expect(page.locator('gc-patch-exchange-panel')).toHaveCount(0);
    expect((await page.evaluate(() => (window as any).__patchCommands))
      .some((command: string) => ['review_diff_patch', 'export_diff_patch', 'import_diff_patch'].includes(command))).toBe(false);
  });
}
