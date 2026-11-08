import { expect, test, type Page } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    app.worktreesOpen.set(true);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { calls: [] as any[], fail: false, hold: false, empty: false, finish: null as any, pruneFail: false, pruned: false };
    (window as any).__worktreeRegistration = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'worktree_registration_review') {
        if (fixture.fail) return Promise.reject({ kind: 'worktreeRegistrationReviewUnavailable', message: 'The complete registration list is unsupported. Inspect it with local Git; no registration was removed.' });
        const result = {
          registrations: [
            { path: '/workspace/main', oid: 'a'.repeat(40), branch: 'main', bare: false, locked: false, lockReason: null, prunable: false, pruneReason: null },
            ...(fixture.pruned ? [] : [{ path: '/workspace/missing\nliteral', oid: 'b'.repeat(40), branch: 'topic', bare: false, locked: false, lockReason: null, prunable: true, pruneReason: 'gitdir file points to non-existent location' }]),
            { path: '/volumes/offline', oid: 'c'.repeat(40), branch: null, bare: false, locked: true, lockReason: 'portable disk', prunable: false, pruneReason: null },
          ],
          pruneReport: fixture.empty ? '' : 'Removing worktrees/missing: gitdir file points to non-existent location\n',
        };
        if (fixture.hold) return new Promise(resolve => { fixture.finish = () => resolve(result); });
        return Promise.resolve(result);
      }
      if (command === 'prune_worktree_registration') {
        if (fixture.pruneFail) return Promise.reject({ kind: 'staleWorktree', message: 'Worktree registrations changed after review. Nothing was removed; the recovery copy is retained.' });
        fixture.pruned = true;
        return Promise.resolve({ recoveryReferences: ['refs/git-khronos/recovery/1-2'], metadataBackup: '/workspace/.git/git-khronos-worktree-registrations/1-2-missing' });
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
}

async function open(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Review registrations and prune report…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review worktree registrations', exact: true })).toBeVisible();
}

test('registration review distinguishes prunable and locked entries and invokes only the read-only native command', async ({ page }) => {
  await setup(page);
  const actions = page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Review registrations and prune report…', exact: true }).evaluate((item) => {
    if (!(item instanceof HTMLButtonElement)) throw new Error('Expected a worktree menu button.');
    item.click();
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.evaluate(() =>
    (window as any).ng.getComponent(document.querySelector('gc-root')).worktreeRegistrationRequest())).toBeNull();
  await expect(actions).toBeFocused();
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls)).toEqual([]);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review worktree registrations', exact: true });
  await expect(dialog.getByRole('status')).toContainText('3 registrations reported');
  await expect(dialog.getByRole('status')).toBeFocused();
  await expect(dialog).toContainText('Locked — protected from pruning');
  await expect(dialog).toContainText('portable disk');
  await expect(dialog).toContainText('prune --dry-run --expire=now');
  await expect(dialog).toContainText('not a deletion lease');
  await expect(dialog).toContainText('If a directory was moved, repair');
  await expect(dialog.getByLabel('Git worktree prune dry-run report')).toContainText('Removing worktrees/missing');
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.filter((call: any) => call.command === 'worktree_registration_review'))).toEqual([
    { command: 'worktree_registration_review', args: { repoId: expect.any(String) } },
  ]);
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.some((call: any) => ['remove_worktree', 'repair_worktree', 'prune_worktrees'].includes(call.command)))).toBe(false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true })).toBeFocused();
});

test('failed registration review focuses native feedback and offers explicit retry, not an empty successful report', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__worktreeRegistration.fail = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review worktree registrations', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('unsupported');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('list')).toHaveCount(0);
  await expect(page.locator('.error-toast')).toHaveCount(0);
  await page.evaluate(() => {
    const fixture = (window as any).__worktreeRegistration;
    fixture.fail = false; fixture.empty = true;
  });
  await dialog.getByRole('button', { name: 'Reload review', exact: true }).click();
  await expect(dialog).toContainText('No removals were reported');
  await expect(dialog).toContainText('does not prove every registration link is healthy');
});

test('pending registration scan blocks dismissal and repository switches prevent another scan', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__worktreeRegistration.hold = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review worktree registrations', exact: true });
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
    (window as any).__worktreeRegistration.finish();
  });
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.getByRole('button', { name: 'Reload review', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.filter((call: any) => call.command === 'worktree_registration_review'))).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('registration review remains keyboard-contained in a compact window and contextual Git help returns to its opener', async ({ page }) => {
  await setup(page);
  await open(page);
  await page.setViewportSize({ width: 900, height: 640 });
  const dialog = page.getByRole('dialog', { name: 'Review worktree registrations', exact: true });
  await expect(dialog.getByRole('status')).toContainText('3 registrations');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const help = dialog.getByRole('button', { name: 'Learn about worktree registration and pruning…', exact: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Remove with recovery…', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Reload review', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(help).toBeFocused();
  await help.click();
  const documentation = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(documentation.locator('details[open]')).toContainText('removes only one reviewed missing, unlocked registration');
  await page.keyboard.press('Escape');
  await expect(documentation).toHaveCount(0);
  await expect(help).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('delayed review chunk can be cancelled without a native query or a late-opened dialog', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reviewHeld = false;
  let finished!: () => void;
  const chunkFinished = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    const reviewChunk = text.includes('Review worktree registrations') && text.includes('data-registration-result');
    if (reviewChunk) {
      reviewHeld = true;
      await gate;
    }
    await route.fulfill({ response, body: text });
    if (reviewChunk) finished();
  });
  try {
    await setup(page);
    const opener = page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true });
    await opener.click();
    await page.getByRole('menuitem', { name: 'Review registrations and prune report…', exact: true }).click();
    const loading = page.getByRole('dialog', { name: 'Loading review', exact: true });
    await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await expect.poll(() => reviewHeld).toBe(true);
    await page.keyboard.press('Escape');
    await expect(loading).toHaveCount(0);
    await expect(opener).toBeFocused();
    release();
    await chunkFinished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.getByRole('dialog', { name: 'Review worktree registrations', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.some((call: any) => call.command === 'worktree_registration_review'))).toBe(false);
  } finally {
    release();
  }
});

test('failed registration chunk has an explicit no-command error and a keyboard close route', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Review worktree registrations') && text.includes('data-registration-result')) await route.abort();
    else await route.fulfill({ response, body: text });
  });
  await setup(page);
  const opener = page.getByRole('button', { name: 'Worktree actions for feature/partial-staging', exact: true });
  await opener.click();
  await page.getByRole('menuitem', { name: 'Review registrations and prune report…', exact: true }).click();
  const error = page.getByRole('dialog', { name: 'Review unavailable', exact: true });
  await expect(error.getByRole('alert')).toContainText('No command was run');
  await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(error).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.some((call: any) => call.command === 'worktree_registration_review'))).toBe(false);
});

test('reviewed registration removal confirms scope, sends the exact expected identity and reports preserved recovery data', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review worktree registrations', exact: true });
  await expect(dialog.getByRole('button', { name: 'Remove with recovery…', exact: true })).toHaveCount(1);
  const opener = dialog.getByRole('button', { name: 'Remove with recovery…', exact: true });
  await opener.click();
  const confirm = dialog.getByRole('group', { name: 'Confirm registration removal', exact: true });
  await expect(confirm).toContainText('without force');
  await expect(confirm).toContainText('branch topic is not deleted');
  await expect(confirm).toContainText('Uncommitted work in a disconnected directory is not recovered');
  await expect(confirm.getByRole('button', { name: 'Remove registration', exact: true })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.some((call: any) => call.command === 'prune_worktree_registration'))).toBe(false);
  await opener.click();
  await confirm.getByRole('button', { name: 'Remove registration', exact: true }).click();
  const done = dialog.locator('[data-prune-result]');
  await expect(done).toContainText('refs/git-khronos/recovery/1-2');
  await expect(done).toContainText('git-khronos-worktree-registrations/1-2-missing');
  await expect(done).toBeFocused();
  await expect(dialog.getByRole('status').first()).toBeVisible();
  await expect(dialog).toContainText('2 registrations reported');
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.filter((call: any) => call.command === 'prune_worktree_registration'))).toEqual([
    { command: 'prune_worktree_registration', args: { repoId: expect.any(String), request: { path: '/workspace/missing\nliteral', expectedOid: 'b'.repeat(40), expectedBranch: 'topic' } } },
  ]);
  await expect(dialog.getByRole('button', { name: 'Remove with recovery…', exact: true })).toHaveCount(0);
});

test('refused registration removal focuses native feedback, keeps the entry and requires an explicit fresh review', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__worktreeRegistration.pruneFail = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review worktree registrations', exact: true });
  await dialog.getByRole('button', { name: 'Remove with recovery…', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove registration', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Nothing was removed');
  await expect(dialog.getByRole('alert')).toContainText('Reload the review before retrying');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('group', { name: 'Confirm registration removal', exact: true })).toHaveCount(0);
  await expect(dialog).toContainText('/workspace/missing');
  await expect(page.locator('.error-toast')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.filter((call: any) => call.command === 'prune_worktree_registration'))).toHaveLength(1);
  await page.evaluate(() => { (window as any).__worktreeRegistration.pruneFail = false; });
  await dialog.getByRole('button', { name: 'Reload review', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Remove with recovery…', exact: true })).toBeEnabled();
});

test('locked and main registrations never offer removal, and a repository switch disables pending confirmation', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Review worktree registrations', exact: true });
  const items = dialog.getByRole('list', { name: 'Worktree registrations', exact: true }).locator(':scope > li');
  await expect(items.nth(0).getByRole('button')).toHaveCount(0);
  await expect(items.nth(2).getByRole('button')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Remove with recovery…', exact: true }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
  });
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.getByRole('button', { name: 'Remove registration', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__worktreeRegistration.calls.some((call: any) => call.command === 'prune_worktree_registration'))).toBe(false);
});
