import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    app.referencePaneVisibility.update((panes: any) => ({ ...panes, submodules: true }));
    app.submodulesOpen.set(true);
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const entry = (overrides: any) => ({ path: 'vendor/lane-engine', name: 'vendor/lane-engine', declaredUrl: '/lane', registeredUrl: '/lane',
      urlMatches: true, headOid: a, indexOid: a, checkoutOid: a, conflict: null, checkedOut: true, commitChanged: false,
      trackedChanges: false, untrackedChanges: false, stagedChange: false, undeclared: false, missingGitlink: false, ...overrides });
    const fixture = { calls: [] as any[], fail: false, hold: false, finish: null as any, clean: false, syncFail: false, holdSync: false, finishSync: null as any, checkoutFail: false };
    (window as any).__submoduleReview = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'submodule_state_review') {
        if (fixture.fail) return Promise.reject({ kind: 'submoduleReviewUnavailable', message: 'The complete status exceeds the submodule review limit.', hint: 'Inspect submodules with local Git status and submodule status. This review changes nothing.' });
        const result = { gitmodulesPresent: true, entries: fixture.clean ? [entry({})] : [
          entry({ commitChanged: true, checkoutOid: b, trackedChanges: true }),
          entry({ path: 'plugins/diff-driver', name: 'diff', checkedOut: false, registeredUrl: null, urlMatches: null, checkoutOid: null }),
          entry({ path: 'raw link', name: null, declaredUrl: null, registeredUrl: null, urlMatches: null, undeclared: true, checkedOut: false, headOid: null, stagedChange: true, checkoutOid: null }),
          entry({ path: 'merge/lib', indexOid: null, headOid: null, conflict: { base: a, ours: b, theirs: 'c'.repeat(40), mixedTypes: false } }),
          entry({ path: 'synced', urlMatches: false, registeredUrl: '/elsewhere' }),
          entry({ path: 'moved', commitChanged: true, checkoutOid: b, untrackedChanges: true }),
        ] };
        if (fixture.hold) return new Promise(resolve => { fixture.finish = () => resolve(result); });
        return Promise.resolve(result);
      }
      if (command === 'sync_submodule_url') {
        if (fixture.syncFail) return Promise.reject({ kind: 'submoduleUrlSyncRefused', message: 'The local submodule URL changed after the review.', hint: 'Review the submodule state again. Nothing was changed.' });
        fixture.clean = true;
        const done = { path: 'synced', name: 'synced', previousRegisteredUrl: '/elsewhere', registeredUrl: '/lane', remoteName: 'origin', previousRemoteUrl: '/elsewhere', remoteUrl: '/lane' };
        if (fixture.holdSync) return new Promise(resolve => { fixture.finishSync = () => resolve(done); });
        return Promise.resolve(done);
      }
      if (command === 'checkout_recorded_submodule_commit') {
        if (fixture.checkoutFail) return Promise.reject({ kind: 'submoduleCheckoutRefused', message: 'The recorded commit is not available in this submodule, and this action never fetches.', hint: 'Fetch inside the submodule, then review again. Nothing was changed.' });
        fixture.clean = true;
        const nested = args.request.recursive ? [{ path: 'moved/inner', previousOid: a, recordedOid: b, recoveryReference: 'refs/git-chronos/recovery/3-4', skipped: null },
          { path: 'moved/docs', previousOid: null, recordedOid: a, recoveryReference: null, skipped: 'not initialized' }] : [];
        return Promise.resolve({ path: 'moved', previousOid: b, previousBranch: 'refs/heads/topic', recordedOid: a, recoveryReference: 'refs/git-chronos/recovery/1-2', nested });
      }
      if (command === 'remove_submodule') {
        fixture.clean = true;
        return Promise.resolve({ path: 'plugins/diff-driver', name: 'diff', recordedOid: a, gitDirectory: null, keptSettings: [{ key: 'submodule.diff.url', value: '/lane' }] });
      }
      if (command === 'deinit_submodule') {
        fixture.clean = true;
        return Promise.resolve({ path: 'synced', name: 'synced', checkoutOid: a, gitDirectory: '/repo/.git/modules/synced', absorbed: false,
          removedSettings: [{ key: 'submodule.synced.url', value: '/elsewhere' }, { key: 'submodule.synced.active', value: 'true' }] });
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
}

const opener = (page: Page) => page.locator('.submodule-actions').first();

async function open(page: Page): Promise<void> {
  await opener(page).click();
  await page.getByRole('menuitem', { name: 'Review submodule state…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review submodule state', exact: true })).toBeVisible();
}

test('submodule review explains each state with exact commits and invokes only the read-only command', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await expect(dialog.getByRole('status')).toContainText('6 submodule paths; 6 need attention.');
  await expect(dialog.getByRole('status')).toBeFocused();
  const lane = dialog.getByRole('listitem', { name: 'Submodule vendor/lane-engine', exact: true });
  await expect(lane).toContainText('Different commit checked out');
  await expect(lane).toContainText(`Checked out ${'b'.repeat(10)}; recorded ${'a'.repeat(10)}`);
  await expect(lane).toContainText('Uncommitted changes inside');
  await expect(dialog.getByRole('listitem', { name: 'Submodule plugins/diff-driver', exact: true })).toContainText('Not initialized');
  await expect(dialog.getByRole('listitem', { name: 'Submodule plugins/diff-driver', exact: true })).toContainText('Name: diff');
  const raw = dialog.getByRole('listitem', { name: 'Submodule raw link', exact: true });
  await expect(raw).toContainText('Not declared in .gitmodules');
  await expect(raw).toContainText(`HEAD none → index ${'a'.repeat(10)}`);
  await expect(dialog.getByRole('listitem', { name: 'Submodule merge/lib', exact: true })).toContainText(`theirs ${'c'.repeat(10)}`);
  await expect(dialog.getByRole('listitem', { name: 'Submodule synced', exact: true })).toContainText('Local: /elsewhere');
  await expect(dialog).toContainText('A configured ignore setting does not hide changes here.');
  expect(await page.evaluate(() => (window as any).__submoduleReview.calls.map((call: any) => call.command)))
    .toEqual(['submodule_state_review']);
  expect(await page.evaluate(() => (window as any).__submoduleReview.calls[0].args)).toEqual({ repoId: expect.any(String) });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener(page)).toBeFocused();
});

test('failed submodule review focuses the native reason and recovers through explicit reload', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__submoduleReview.fail = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('exceeds the submodule review limit');
  await expect(dialog.getByRole('alert')).toContainText('This review changes nothing.');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('list', { name: 'Submodule states' })).toHaveCount(0);
  await page.evaluate(() => { const fixture = (window as any).__submoduleReview; fixture.fail = false; fixture.clean = true; });
  await dialog.getByRole('button', { name: 'Reload review', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('1 submodule path; none need attention.');
  await expect(dialog).toContainText('Matches the recorded commit');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('pending submodule review blocks dismissal and a repository switch discards its result', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__submoduleReview.hold = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
    (window as any).__submoduleReview.finish();
  });
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.getByRole('list', { name: 'Submodule states' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Reload review', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__submoduleReview.calls.filter((call: any) => call.command === 'submodule_state_review'))).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('submodule review fits a compact window, contains Tab focus and returns from contextual help', async ({ page }) => {
  await setup(page);
  await open(page);
  await page.setViewportSize({ width: 900, height: 640 });
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await expect(dialog.getByRole('status')).toContainText('6 submodule paths');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const help = dialog.getByRole('button', { name: 'Learn about submodule state…', exact: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Check out recorded commit…' }).first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await help.click();
  const documentation = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(documentation.locator('details[open]')).toContainText('git submodule');
  await page.keyboard.press('Escape');
  await expect(documentation).toHaveCount(0);
  await expect(help).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open left panel', exact: true })).toBeFocused();
});

test('URL sync is offered only for differing initialized entries, confirms scope and sends the reviewed values', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await expect(dialog.getByRole('status')).toContainText('6 submodule paths');
  await expect(dialog.getByRole('button', { name: 'Sync local URL from .gitmodules…' })).toHaveCount(1);
  const synced = dialog.getByRole('listitem', { name: 'Submodule synced', exact: true });
  await synced.getByRole('button', { name: 'Sync local URL from .gitmodules…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Synchronize URL for synced' });
  await expect(confirm).toContainText('Committed files, the index and other submodules do not change.');
  await expect(confirm.getByRole('button', { name: 'Sync URL', exact: true })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(synced.getByRole('button', { name: 'Sync local URL from .gitmodules…' })).toBeFocused();
  await page.evaluate(() => { (window as any).__submoduleReview.holdSync = true; });
  await synced.getByRole('button', { name: 'Sync local URL from .gitmodules…' }).click();
  await confirm.getByRole('button', { name: 'Sync URL', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as any).__submoduleReview.finishSync());
  const notice = dialog.locator('[data-submodule-sync]');
  await expect(notice).toContainText('local URL changed from /elsewhere to /lane');
  await expect(notice).toContainText('Submodule remote origin changed from /elsewhere to /lane');
  await expect(notice).toBeFocused();
  await expect(dialog.locator('[data-submodule-result]')).toContainText('none need attention');
  const calls = await page.evaluate(() => (window as any).__submoduleReview.calls);
  expect(calls.map((call: any) => call.command)).toEqual(['submodule_state_review', 'sync_submodule_url', 'submodule_state_review']);
  expect(calls[1].args.request).toEqual({ path: 'synced', expectedDeclaredUrl: '/lane', expectedRegisteredUrl: '/elsewhere' });
});

test('refused URL sync focuses the reason and shows a fresh review', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__submoduleReview.syncFail = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await dialog.getByRole('listitem', { name: 'Submodule synced', exact: true }).getByRole('button', { name: 'Sync local URL from .gitmodules…' }).click();
  await dialog.getByRole('button', { name: 'Sync URL', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed after the review');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.locator('[data-submodule-result]')).toContainText('6 submodule paths');
  expect(await page.evaluate(() => (window as any).__submoduleReview.calls.map((call: any) => call.command)))
    .toEqual(['submodule_state_review', 'sync_submodule_url', 'submodule_state_review']);
});

test('recorded-commit checkout is offered only for clean moved checkouts and discloses its protection', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await expect(dialog.getByRole('status')).toContainText('6 submodule paths');
  await expect(dialog.getByRole('button', { name: 'Check out recorded commit…' })).toHaveCount(2);
  await expect(dialog.getByRole('listitem', { name: 'Submodule plugins/diff-driver', exact: true }).getByRole('button', { name: /Check out/ })).toHaveCount(0);
  const moved = dialog.getByRole('listitem', { name: 'Submodule moved', exact: true });
  await moved.getByRole('button', { name: 'Check out recorded commit…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Check out recorded commit for moved' });
  await expect(confirm).toContainText('without fetching');
  await expect(confirm).toContainText('recovery reference');
  await expect(confirm).toContainText('Nested submodules are left as they are.');
  await expect(confirm.getByRole('checkbox', { name: /nested submodules/ })).not.toBeChecked();
  await expect(confirm).toContainText('Current: bbbbbbbbbb Recorded: aaaaaaaaaa');
  await expect(dialog.getByRole('button', { name: 'Sync local URL from .gitmodules…' })).toBeDisabled();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(moved.getByRole('button', { name: 'Check out recorded commit…' })).toBeFocused();
  await moved.getByRole('button', { name: 'Check out recorded commit…' }).click();
  await expect(confirm.getByRole('button', { name: 'Check out recorded commit', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const notice = dialog.locator('[data-submodule-sync]');
  await expect(notice).toContainText('Checked out aaaaaaaaaa in moved');
  await expect(notice).toContainText('refs/git-chronos/recovery/1-2 inside the submodule');
  await expect(notice).toContainText('Branch topic was left unchanged');
  await expect(notice).toBeFocused();
  const calls = await page.evaluate(() => (window as any).__submoduleReview.calls);
  expect(calls.map((call: any) => call.command))
    .toEqual(['submodule_state_review', 'checkout_recorded_submodule_commit', 'submodule_state_review']);
  expect(calls[1].args.request).toEqual({ path: 'moved', expectedIndexOid: 'a'.repeat(40), expectedCheckoutOid: 'b'.repeat(40), recursive: false });
});

test('refused recorded-commit checkout focuses the no-fetch reason', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__submoduleReview.checkoutFail = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await dialog.getByRole('listitem', { name: 'Submodule moved', exact: true }).getByRole('button', { name: 'Check out recorded commit…' }).click();
  await dialog.getByRole('button', { name: 'Check out recorded commit', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('never fetches');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.locator('[data-submodule-result]')).toContainText('6 submodule paths');
});

test('recursive recorded-commit checkout reports each nested result and skip', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await dialog.getByRole('listitem', { name: 'Submodule moved', exact: true }).getByRole('button', { name: 'Check out recorded commit…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Check out recorded commit for moved' });
  await confirm.getByRole('checkbox', { name: /nested submodules/ }).check();
  await expect(confirm).not.toContainText('Nested submodules are left as they are.');
  await confirm.getByRole('button', { name: 'Check out recorded commit', exact: true }).click();
  const notice = dialog.locator('[data-submodule-sync]');
  await expect(notice).toContainText('Nested moved/inner: aaaaaaaaaa → bbbbbbbbbb, previous kept at refs/git-chronos/recovery/3-4.');
  await expect(notice).toContainText('Nested moved/docs skipped: not initialized');
  const calls = await page.evaluate(() => (window as any).__submoduleReview.calls);
  expect(calls[1].args.request.recursive).toBe(true);
});

test('deinit is offered only for clean recorded checkouts and reports kept data and removed settings', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await expect(dialog.getByRole('status')).toContainText('6 submodule paths');
  await expect(dialog.getByRole('button', { name: 'Deinitialize…' })).toHaveCount(1);
  const synced = dialog.getByRole('listitem', { name: 'Submodule synced', exact: true });
  await synced.getByRole('button', { name: 'Deinitialize…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Deinitialize synced', exact: true });
  await expect(confirm).toContainText('repository data, its branches, the recorded commit and .gitmodules stay');
  await expect(confirm.getByRole('button', { name: 'Deinitialize', exact: true })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(synced.getByRole('button', { name: 'Deinitialize…' })).toBeFocused();
  await synced.getByRole('button', { name: 'Deinitialize…' }).click();
  await confirm.getByRole('button', { name: 'Deinitialize', exact: true }).click();
  const notice = dialog.locator('[data-submodule-sync]');
  await expect(notice).toContainText('Deinitialized synced. Repository data remains at /repo/.git/modules/synced.');
  await expect(notice).toContainText('submodule.synced.url=/elsewhere, submodule.synced.active=true');
  await expect(notice).toBeFocused();
  const calls = await page.evaluate(() => (window as any).__submoduleReview.calls);
  expect(calls[1]).toEqual({ command: 'deinit_submodule', args: { repoId: expect.any(String), request: { path: 'synced', expectedCheckoutOid: 'a'.repeat(40) } } });
});

test('removal stages only reviewed declared entries and explains what remains', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review submodule state', exact: true });
  await expect(dialog.getByRole('status')).toContainText('6 submodule paths');
  await expect(dialog.getByRole('button', { name: 'Remove from project…' })).toHaveCount(2);
  for (const path of ['vendor/lane-engine', 'raw link', 'merge/lib', 'moved']) {
    await expect(dialog.getByRole('listitem', { name: `Submodule ${path}`, exact: true }).getByRole('button', { name: 'Remove from project…' })).toHaveCount(0);
  }
  const idle = dialog.getByRole('listitem', { name: 'Submodule plugins/diff-driver', exact: true });
  await idle.getByRole('button', { name: 'Remove from project…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Remove plugins/diff-driver from the project', exact: true });
  await expect(confirm).toContainText('nothing is committed');
  await expect(confirm.getByRole('button', { name: 'Stage removal', exact: true })).toBeFocused();
  await confirm.getByRole('button', { name: 'Stage removal', exact: true }).click();
  const notice = dialog.locator('[data-submodule-sync]');
  await expect(notice).toContainText('Staged removal of plugins/diff-driver and its declaration. Commit to finish.');
  await expect(notice).toContainText('git config --remove-section submodule.diff');
  await expect(notice).toBeFocused();
  const calls = await page.evaluate(() => (window as any).__submoduleReview.calls);
  expect(calls[1].args.request).toEqual({ path: 'plugins/diff-driver', expectedIndexOid: 'a'.repeat(40) });
});
