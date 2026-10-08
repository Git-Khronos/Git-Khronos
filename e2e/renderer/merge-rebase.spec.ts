import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.branch-item').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const original = git.repository();
    const clean = { ...original, branches: [...original.branches,
      { ...original.branches[0], name: 'merge-destination', oid: 'd'.repeat(40), current: false, remote: false }],
      status: { ...original.status, staged: 0, unstaged: 0, untracked: 0, conflicted: 0,
        entryCount: 0, entries: [], rebaseInProgress: false, rebaseEditStopped: false } };
    git.repositories.update((items: any[]) => items.map(item => item.id === clean.id ? clean : item));
    const plan = { request: { source: clean.status.branch, target: 'merge-destination',
      sourceOid: 'c'.repeat(40), targetOid: 'd'.repeat(40), base: 'a'.repeat(40) },
      commits: [
        { oid: 'b'.repeat(40), subject: 'Reviewed ordinary', message: 'Reviewed ordinary',
          authorName: 'Owned Author', authorEmail: 'owned@example.test', parents: ['a'.repeat(40)] },
        { oid: 'c'.repeat(40), subject: 'Reviewed merge', message: 'Reviewed merge',
          authorName: 'Owned Author', authorEmail: 'owned@example.test', parents: ['b'.repeat(40), 'e'.repeat(40)] },
      ], remoteReachableOids: ['b'.repeat(40)] };
    const fixture = { original: clean, plan, calls: [] as any[], refused: false, executionRefused: false,
      deferred: false, finish: null as (() => void) | null };
    (window as any).__mergeRebase = fixture;
    app.commitMessage.set('Retained unrelated draft');
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'prepare_merge_rebase') {
        if (fixture.refused) return Promise.reject({ kind: 'shallowMergeRebase',
          message: 'Merge-preserving review requires complete history.', hint: 'Deepen and reload the complete review.' });
        if (fixture.deferred) return new Promise(resolve => { fixture.finish = () => resolve(fixture.plan); });
        return Promise.resolve(fixture.plan);
      }
      if (command === 'execute_merge_rebase') {
        if (fixture.executionRefused) return Promise.reject({ kind: 'staleMergeRebase',
          message: 'Source, destination or common base changed after review.', hint: 'Reload the complete topology before starting.' });
        return Promise.resolve(fixture.original);
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_status') {
        const repo = git.repositories().find((item: any) => item.id === args.repoId);
        if (!repo) return Promise.reject(new Error('Unknown fixture repository'));
        return Promise.resolve(command === 'refresh_repository' ? repo : repo.status);
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
  });
});

async function openReview(page: Page, keyboard = false): Promise<void> {
  const branch = page.locator('.branch-item').filter({ hasText: 'merge-destination' });
  if (keyboard) {
    await branch.focus();
    await branch.press('Shift+F10');
  } else await branch.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rebase preserving merges…', exact: true }).click();
}

test('merge review discloses topology, cousin scope and resolution loss before exact protected execution', async ({ page }) => {
  await openReview(page);
  const dialog = page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog).toContainText('no-rebase-cousins');
  await expect(dialog).toContainText('retain their original branch points');
  await expect(dialog).toContainText('manual merge resolutions are not automatically preserved');
  await expect(dialog).toContainText('Final contents can differ');
  await expect(dialog).toContainText('Hooks and configured signing remain enabled');
  await expect(dialog).toContainText('Recorded remote-reachable');
  await expect(dialog).toContainText('Publication unknown');
  await expect(dialog.getByRole('list', { name: 'Reviewed merge-preserving topology' }).locator('li')).toHaveCount(2);
  const fixture = await page.evaluate(() => (window as any).__mergeRebase);
  expect(fixture.calls.find((call: any) => call.command === 'prepare_merge_rebase').args)
    .toEqual({ repoId: fixture.original.id, source: fixture.original.status.branch, target: 'merge-destination' });
  expect(fixture.calls.some((call: any) => call.command === 'execute_merge_rebase')).toBe(false);
  await dialog.getByRole('button', { name: 'Start merge-preserving rebase', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(() => (window as any).__mergeRebase);
  expect(result.calls.find((call: any) => call.command === 'execute_merge_rebase').args)
    .toEqual({ repoId: fixture.original.id, request: fixture.plan.request });
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Retained unrelated draft');
});

test('compact reduced-motion merge help returns focus and keyboard cancellation never starts Git', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openReview(page, true);
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true });
  const help = dialog.getByRole('button', { name: 'Learn about preserving merge topology…', exact: true });
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Git command reference' })).toContainText('no-rebase-cousins');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  const start = dialog.getByRole('button', { name: 'Start merge-preserving rebase', exact: true });
  await start.scrollIntoViewIfNeeded();
  const bounds = await start.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(24);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(550);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await start.focus();
  await page.keyboard.press('Tab');
  await expect(help).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(start).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open left panel', exact: true })).toBeFocused();
  expect((await page.evaluate(() => (window as any).__mergeRebase.calls))
    .some((call: any) => call.command === 'execute_merge_rebase')).toBe(false);
});

test('keyboard merge cancellation restores its visible branch opener without changing history', async ({ page }) => {
  await openReview(page, true);
  const dialog = page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.branch-item').filter({ hasText: 'merge-destination' })).toBeFocused();
  expect((await page.evaluate(() => (window as any).__mergeRebase.calls))
    .some((call: any) => call.command === 'execute_merge_rebase')).toBe(false);
});

test('stale execution retains focused error and requires a new review rather than duplicate replay', async ({ page }) => {
  await openReview(page);
  await page.evaluate(() => { (window as any).__mergeRebase.executionRefused = true; });
  const dialog = page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true });
  await dialog.getByRole('button', { name: 'Start merge-preserving rebase', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Source, destination or common base changed');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Start merge-preserving rebase', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => { (window as any).__mergeRebase.executionRefused = false; });
  await openReview(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start merge-preserving rebase', exact: true })).toBeEnabled();
  expect((await page.evaluate(() => (window as any).__mergeRebase.calls))
    .filter((call: any) => call.command === 'execute_merge_rebase')).toHaveLength(1);
});

test('preparation refusal is explicit and retry never substitutes ordinary flattened rebase', async ({ page }) => {
  await page.evaluate(() => { (window as any).__mergeRebase.refused = true; });
  await openReview(page);
  await expect(page.locator('.error-toast')).toContainText('requires complete history');
  await expect(page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.evaluate(() => { (window as any).__mergeRebase.refused = false; });
  await openReview(page);
  await expect(page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__mergeRebase.calls);
  expect(calls.some((call: any) => call.command === 'execute_interactive_rebase' || call.command === 'execute_merge_rebase')).toBe(false);
});

test('late preparation after switching away and back cannot reopen captured merge review', async ({ page }) => {
  await page.evaluate(() => { (window as any).__mergeRebase.deferred = true; });
  await openReview(page);
  await expect.poll(() => page.evaluate(() => !!(window as any).__mergeRebase.finish)).toBe(true);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const source = (window as any).__mergeRebase.original;
    app.git.repositories.update((items: any[]) => [...items, { ...source, id: 'merge-other', path: '/owned/other' }]);
    app.git.activeRepositoryId.set('merge-other');
  });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId())).toBe('merge-other');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.activeRepositoryId.set((window as any).__mergeRebase.original.id);
  });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId()))
    .toBe(await page.evaluate(() => (window as any).__mergeRebase.original.id));
  await page.evaluate(() => { (window as any).__mergeRebase.finish(); });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true })).toHaveCount(0);
});

test('loaded merge review closes on repository switch without rewriting another repository', async ({ page }) => {
  await openReview(page);
  const dialog = page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const source = (window as any).__mergeRebase.original;
    app.git.repositories.update((items: any[]) => [...items, { ...source, id: 'merge-other', path: '/owned/other' }]);
    app.git.activeRepositoryId.set('merge-other');
  });
  await expect(dialog).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__mergeRebase.calls))
    .some((call: any) => call.command === 'execute_merge_rebase')).toBe(false);
});

for (const action of ['cancel', 'failure'] as const) {
  test(`deferred merge review ${action} retains focused escape and never starts history`, async ({ page }) => {
    let release: (() => void) | null = null;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      if (!text.includes('data-merge-rebase-cancel')) {
        await route.fulfill({ response, body: text });
        return;
      }
      if (action === 'failure') await route.abort('failed');
      else {
        await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ response, body: text });
      }
    });
    await openReview(page);
    const dialog = page.getByRole('dialog', { name: action === 'failure' ? 'Rebase editor unavailable' : 'Loading interactive rebase', exact: true });
    const button = dialog.getByRole('button', { name: action === 'failure' ? 'Close' : 'Cancel', exact: true });
    await expect(button).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.keyboard.press('Escape');
    if (release) (release as () => void)();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Rebase preserving merges', exact: true })).toHaveCount(0);
    expect((await page.evaluate(() => (window as any).__mergeRebase.calls))
      .some((call: any) => call.command === 'execute_merge_rebase')).toBe(false);
  });
}
