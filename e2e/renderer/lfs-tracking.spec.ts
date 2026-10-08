import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.repositories.update((items: any[]) => items.map((item) => ({ ...item,
      remotes: [{ name: 'origin', fetchUrl: '/local/origin.git', pushUrl: '/local/origin.git' },
        { name: 'backup', fetchUrl: '/local/backup.git', pushUrl: '/local/backup.git' }],
      lfs: { available: true, enabled: true, version: 'git-lfs/3.7.1', trackedFiles: 2 } })));
    const fixture = { calls: [] as any[], fail: false, loadFail: false, empty: false, hold: false, finish: null as any, removed: false, attributeFail: false, attributeHold: false, objectsFail: false, objectsHold: false, objectsEmpty: false,
      fetchPreviewFail: false, fetchFail: false, fetchHold: false, fetchCancelled: false, fetched: false,
      checkoutPreviewFail: false, checkoutFail: false, checkoutHold: false, checkoutCancelled: false, hydrated: false };
    (window as any).__lfsTracking = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'lfs_checkout_preview') {
        if (fixture.checkoutPreviewFail) return Promise.reject({ kind: 'unsafeLfsCheckout', message: 'The working file no longer matches the index pointer. Modified and sparse-excluded files are not replaced.' });
        return Promise.resolve({ file: args.file, oid: args.expectedOid, size: args.expectedSize, state: 'hydration-lease' });
      }
      if (command === 'lfs_checkout_object') {
        if (fixture.checkoutFail) return Promise.reject({ kind: 'corruptLfsHydrationObject', message: 'The copied local LFS object does not match the reviewed SHA-256 and size. The working pointer was not replaced.' });
        const complete = () => {
          if (fixture.checkoutCancelled) return Promise.reject({ kind: 'operationCancelled', message: 'Hydration cancelled.' });
          fixture.hydrated = true;
          return git.repositories().find((repository: any) => repository.id === args.repoId);
        };
        if (fixture.checkoutHold) return new Promise((resolve) => { fixture.finish = () => resolve(complete()); });
        return Promise.resolve(complete());
      }
      if (command === 'lfs_fetch_preview') {
        if (fixture.fetchPreviewFail) return Promise.reject({ kind: 'stagedLfsObjectNotFetchable', message: 'The inspected object does not match committed HEAD. Commit the intended pointer or use local Git LFS for staged-only objects.' });
        return Promise.resolve({ file: args.file, remote: args.remote, head: '1'.repeat(40), oid: args.expectedOid, size: args.expectedSize, settings: 'b'.repeat(40) });
      }
      if (command === 'lfs_fetch_object') {
        if (fixture.fetchFail) return Promise.reject({ kind: 'staleLfsFetch', message: 'HEAD or effective Git/LFS settings changed after review. Inspect objects again and review the selected file and remote. No transfer started.' });
        const complete = () => {
          if (fixture.fetchCancelled) return Promise.reject({ kind: 'operationCancelled', message: 'LFS fetch was cancelled.' });
          fixture.fetched = true;
          return git.repositories().find((repository: any) => repository.id === args.repoId);
        };
        if (fixture.fetchHold) return new Promise((resolve) => { fixture.finish = () => resolve(complete()); });
        return Promise.resolve(complete());
      }
      if (command === 'cancel_git_operation') {
        fixture.fetchCancelled = true;
        fixture.checkoutCancelled = true;
        fixture.finish();
        return Promise.resolve(true);
      }
      if (command === 'lfs_objects') {
        if (fixture.objectsFail) return Promise.reject({ kind: 'unsupportedLfsObjectOutput', message: 'Git LFS returned an unsupported object list. Upgrade Git LFS or inspect objects with local Git LFS.' });
        const file = { size: 25, oidType: 'sha256', oid: 'a'.repeat(64), version: 'https://git-lfs.github.com/spec/v1', checkout: false, downloaded: false };
        const result = { files: fixture.objectsEmpty ? [] : [
          { ...file, name: 'assets/pointer.bin', workingState: fixture.hydrated ? 'contentSizeMatches' : 'pointer', downloaded: true },
          { ...file, name: 'assets/missing.bin', workingState: 'missing', downloaded: fixture.fetched },
          { ...file, name: 'assets/modified.bin', workingState: 'contentSizeMatches', checkout: true },
        ] };
        if (fixture.objectsHold) return new Promise((resolve) => { fixture.finish = () => resolve(result); });
        return Promise.resolve(result);
      }
      if (command === 'lfs_file_attributes') {
        if (fixture.attributeFail) return Promise.reject({ kind: 'invalidAttributePath', message: 'Enter a repository-relative file path without parent or absolute path components.' });
        const result = { path: args.file, attributes: [
          { name: 'filter', working: 'unset', index: 'lfs' },
          { name: 'diff', working: 'custom', index: 'lfs' },
          { name: 'merge', working: 'unspecified', index: 'lfs' },
          { name: 'text', working: 'set', index: 'unset' },
          { name: 'lockable', working: 'unset', index: 'set' },
        ] };
        if (fixture.attributeHold) return new Promise((resolve) => { fixture.finish = () => resolve(result); });
        return Promise.resolve(result);
      }
      if (command === 'lfs_tracking_rules') {
        if (fixture.loadFail) return Promise.reject({ kind: 'lfsUnavailable', message: 'Git LFS is not available on PATH. Install Git LFS and retry.' });
        return Promise.resolve({ patterns: fixture.empty ? [] : [
          ...(!fixture.removed ? [{ pattern: '*.psd', source: '.gitattributes', lockable: true, tracked: true }] : []),
          { pattern: '*.bin', source: 'nested/.gitattributes', lockable: false, tracked: true },
          { pattern: '*.excluded', source: '.gitattributes', lockable: false, tracked: false },
        ], state: fixture.removed ? 'updated-state' : 'reviewed-state',
          rootAttributes: '*.psd filter=lfs diff=lfs merge=lfs -text lockable\n*.txt text eol=lf\n' });
      }
      if (command === 'lfs_untrack_pattern') {
        if (fixture.fail) return Promise.reject({ kind: 'staleLfsAttributes', message: 'HEAD or .gitattributes changed after review. Reload tracking patterns before retrying.' });
        const complete = () => { fixture.removed = true; return git.repository(); };
        if (fixture.hold) return new Promise((resolve) => { fixture.finish = () => resolve(complete()); });
        return Promise.resolve(complete());
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
}

async function open(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await page.getByRole('button', { name: 'Manage tracking patterns…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'LFS tracking patterns' })).toBeVisible();
}

test('LFS help opens its selected topic without changing rules and returns to the still-open parent', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns', exact: true });
  await expect(dialog.getByRole('button', { name: 'Review removal of *.psd', exact: true })).toBeVisible();
  const callsBefore = await page.evaluate(() => (window as any).__lfsTracking.calls.length);
  const opener = dialog.getByRole('button', { name: 'Learn about tracking rules and LFS pointers…', exact: true });
  await opener.click();
  const documentation = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(documentation.locator('details[open]')).toContainText('removing a rule does not convert existing pointers');
  await expect(documentation.locator('details[open] summary')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(documentation).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).__lfsTracking.calls.length)).toBe(callsBefore);
});

test('review root LFS rule with explicit source scope and pinned state, then refresh list', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await expect(dialog).toContainText('Only root .gitattributes rules');
  await expect(dialog).toContainText('Excluded from LFS');
  await expect(dialog.getByRole('button', { name: 'Review removal of *.bin' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Review removal of *.excluded' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Review removal of *.psd' }).click();
  await expect(dialog).toContainText('does not convert existing LFS pointers');
  await expect(dialog.getByLabel('Current root attributes')).toContainText('*.txt text eol=lf');
  await expect(dialog.getByRole('button', { name: 'Remove root rule', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Remove root rule', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Review and commit .gitattributes');
  await expect(dialog.getByRole('status')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Review removal of *.psd' })).toHaveCount(0);
  const call = await page.evaluate(() => (window as any).__lfsTracking.calls.find((entry: any) => entry.command === 'lfs_untrack_pattern'));
  expect(call.args).toEqual({ repoId: expect.any(String), pattern: '*.psd', expectedState: 'reviewed-state' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage tracking patterns…', exact: true })).toBeFocused();
});

test('stale LFS state retains selected rule, focuses refusal, and requires fresh review after reload', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.getByRole('button', { name: 'Review removal of *.psd' }).click();
  await page.evaluate(() => { (window as any).__lfsTracking.fail = true; });
  await dialog.getByRole('button', { name: 'Remove root rule', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed after review');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('heading', { name: /Remove root rule/ })).toContainText('*.psd');
  await dialog.getByRole('button', { name: 'Reload patterns', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Remove root rule', exact: true })).toHaveCount(0);
});

test('LFS removal blocks dismissal and choices while native mutation is pending', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.getByRole('button', { name: 'Review removal of *.psd' }).click();
  await page.evaluate(() => { (window as any).__lfsTracking.hold = true; });
  await dialog.getByRole('button', { name: 'Remove root rule', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Remove root rule', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Inspect attributes', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Reload patterns', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => { (window as any).__lfsTracking.finish(); });
  await expect(dialog.getByRole('status')).toContainText('Root tracking rule removed');
});

test('LFS patterns modal contains keyboard focus in a compact window and restores opener', async ({ page }) => {
  await setup(page);
  await open(page);
  await page.setViewportSize({ width: 900, height: 640 });
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Inspect local objects', exact: true })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage tracking patterns…', exact: true })).toBeFocused();
});

test('repository switch prevents untracking rules in the previously reviewed repository', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.getByRole('button', { name: 'Review removal of *.psd' }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
  });
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.getByRole('button', { name: 'Remove root rule', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__lfsTracking.calls.some((entry: any) => entry.command === 'lfs_untrack_pattern'))).toBe(false);
});

test('empty pattern list is explicit; missing LFS remains an actionable error with retry', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__lfsTracking.empty = true; });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await expect(dialog).toContainText('No LFS tracking patterns');
  await page.evaluate(() => { (window as any).__lfsTracking.loadFail = true; });
  await dialog.getByRole('button', { name: 'Reload patterns', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Install Git LFS and retry');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog).not.toContainText('No LFS tracking patterns');
  await expect(dialog.getByRole('button', { name: 'Reload patterns', exact: true })).toBeEnabled();
});

test('effective attributes compare working and index rules for a literal missing path', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.getByLabel('Repository-relative file path').fill('nested/space [*] file.psd');
  await dialog.getByRole('button', { name: 'Inspect attributes', exact: true }).click();
  const result = dialog.locator('.attribute-result');
  await expect(result).toBeFocused();
  await expect(result).toContainText('nested/space [*] file.psd');
  const filter = result.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'filter', exact: true }) });
  await expect(filter.getByRole('cell')).toHaveText(['unset', 'lfs']);
  await expect(result).toContainText('does not prove LFS is installed');
  const call = await page.evaluate(() => (window as any).__lfsTracking.calls.find((entry: any) => entry.command === 'lfs_file_attributes'));
  expect(call.args).toEqual({ repoId: expect.any(String), file: 'nested/space [*] file.psd' });
  await dialog.getByLabel('Repository-relative file path').fill('different.psd');
  await expect(result).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__lfsTracking.calls.some((entry: any) => entry.command === 'lfs_untrack_pattern'))).toBe(false);
});

test('effective attributes remain available when LFS is missing, and inspection failures retain path', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).__lfsTracking.loadFail = true;
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => items.map((item) => ({ ...item, lfs: { ...item.lfs, available: false, enabled: false } })));
  });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await expect(dialog.getByRole('alert')).toContainText('Git LFS is not available');
  await dialog.getByLabel('Repository-relative file path').fill('assets/file.psd');
  await dialog.getByRole('button', { name: 'Inspect attributes', exact: true }).click();
  await expect(dialog.locator('.attribute-result')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__lfsTracking.attributeFail = true; });
  await dialog.getByLabel('Repository-relative file path').fill('../file');
  await dialog.getByRole('button', { name: 'Inspect attributes', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByLabel('Repository-relative file path')).toHaveValue('../file');
  await expect(dialog.locator('.attribute-result')).toHaveCount(0);
});

test('effective attribute read blocks edits and dismissal and remains keyboard contained', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.getByLabel('Repository-relative file path').fill('assets/file.psd');
  await page.evaluate(() => { (window as any).__lfsTracking.attributeHold = true; });
  await dialog.getByRole('button', { name: 'Inspect attributes', exact: true }).click();
  await expect(dialog.getByLabel('Repository-relative file path')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => { (window as any).__lfsTracking.finish(); });
  await expect(dialog.locator('.attribute-result')).toBeFocused();
  await page.setViewportSize({ width: 900, height: 640 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByLabel('Repository-relative file path').focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => { (window as any).__lfsTracking.finish(); });
  await expect(dialog.locator('.attribute-result')).toBeFocused();
});

test('reopening attributes in another repository does not retain the previous path or result', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.getByLabel('Repository-relative file path').fill('private-to-first.psd');
  await dialog.getByRole('button', { name: 'Inspect attributes', exact: true }).click();
  await expect(dialog.locator('.attribute-result')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
  });

  await page.getByRole('button', { name: 'Manage tracking patterns…', exact: true }).click();
  await expect(dialog.getByLabel('Repository-relative file path')).toHaveValue('');
  await expect(dialog.locator('.attribute-result')).toHaveCount(0);
});

test('lazy LFS panel loading can be cancelled by keyboard before any panel IPC runs', async ({ page }) => {
  await setup(page);
  const gate = Promise.withResolvers<void>();
  await page.route(/\.js(?:\?.*)?$/, async (route) => {
    await gate.promise;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await page.getByRole('button', { name: 'Manage tracking patterns…', exact: true }).click();
  const loader = page.getByRole('dialog', { name: 'Loading LFS tools', exact: true });
  await expect(loader).toBeVisible();
  await expect(loader.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(loader.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  gate.resolve();
  await expect(loader).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage tracking patterns…', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__lfsTracking.calls.some((entry: any) =>
    entry.command === 'lfs_tracking_rules' || entry.command === 'lfs_file_attributes'))).toBe(false);
});

test('failed lazy LFS panel load shows an explicit focused escape route', async ({ page }) => {
  await setup(page);
  await page.route(/\.js(?:\?.*)?$/, (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await page.getByRole('button', { name: 'Manage tracking patterns…', exact: true }).click();
  const error = page.getByRole('dialog', { name: 'LFS tools unavailable', exact: true });
  await expect(error.getByRole('alert')).toContainText('could not be loaded');
  await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(error).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage tracking patterns…', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__lfsTracking.calls.some((entry: any) =>
    entry.command === 'lfs_tracking_rules' || entry.command === 'lfs_file_attributes'))).toBe(false);
});

test('LFS object scan explains pointer, missing cache and size-only content evidence without transfer', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.locator('summary').click();
  await dialog.getByRole('button', { name: 'Inspect local objects', exact: true }).click();
  const result = dialog.locator('.object-result');
  await expect(result).toBeFocused();
  await expect(result).toContainText('3 paths reported');
  await expect(result).toContainText('canonical pointer to this object; not hydrated');
  await expect(result).toContainText('content size matches; bytes are not verified');
  await expect(result).toContainText('missing or wrong size');
  await expect(result).toContainText('available by size (not hash-verified)');
  await expect(result).toContainText('sparse-excluded');
  await expect(result).toContainText('before retrying');
  const calls = await page.evaluate(() => (window as any).__lfsTracking.calls);
  expect(calls.find((entry: any) => entry.command === 'lfs_objects').args).toEqual({ repoId: expect.any(String) });
  expect(calls.some((entry: any) => ['lfs_pull', 'lfs_prune', 'lfs_untrack_pattern'].includes(entry.command))).toBe(false);
  await page.setViewportSize({ width: 900, height: 640 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('LFS object scan failures remain errors and empty scope never implies hydration', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.locator('summary').click();
  await page.evaluate(() => { (window as any).__lfsTracking.objectsFail = true; });
  await dialog.getByRole('button', { name: 'Inspect local objects', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('alert')).toContainText('unsupported object list');
  await expect(dialog.locator('.object-result')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__lfsTracking.objectsFail = false;
    (window as any).__lfsTracking.objectsEmpty = true;
  });
  await dialog.getByRole('button', { name: 'Inspect local objects', exact: true }).click();
  await expect(dialog.locator('.object-result')).toBeFocused();
  await expect(dialog.locator('.object-result')).toContainText('does not prove all files are hydrated');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('LFS object scan blocks dismissals while pending and repository switches prevent scans', async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.locator('summary').click();
  await page.evaluate(() => { (window as any).__lfsTracking.objectsHold = true; });
  await dialog.getByRole('button', { name: 'Inspect local objects', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await expect(dialog.locator('summary')).toHaveAttribute('aria-disabled', 'true');
  await dialog.locator('summary').dispatchEvent('click');
  await expect(dialog.locator('details')).toHaveAttribute('open', '');
  await dialog.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('details')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => { (window as any).__lfsTracking.finish(); });
  await expect(dialog.locator('.object-result')).toBeFocused();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
  });

  await expect(dialog.getByRole('button', { name: 'Inspect local objects', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
});

async function openFetchReview(page: Page): Promise<void> {
    await setup(page);
    await open(page);
    const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
    await dialog.locator('summary').click();
    await dialog.getByRole('button', { name: 'Inspect local objects', exact: true }).click();
    await dialog.getByLabel('Remote for selective fetch').selectOption('backup');
    await dialog.getByRole('button', { name: 'Review fetch of assets/missing.bin', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Fetch reviewed object', exact: true })).toBeFocused();
  }

test('selective LFS fetch reviews exact committed object and remote before downloading without checkout', async ({ page }) => {
    await openFetchReview(page);
    const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
    await expect(dialog.locator('.fetch-review')).toContainText('assets/missing.bin');
    await expect(dialog.locator('.fetch-review')).toContainText('from backup');
    await expect(dialog.locator('.fetch-review')).toContainText('Does not hydrate, stage, prune or update Git references');
    await expect(dialog.locator('.fetch-review')).toContainText('Availability is checked by size, not hash');
    let calls = await page.evaluate(() => (window as any).__lfsTracking.calls);
    expect(calls.find((entry: any) => entry.command === 'lfs_fetch_preview').args).toEqual({
      repoId: expect.any(String), file: 'assets/missing.bin', remote: 'backup', expectedOid: 'a'.repeat(64), expectedSize: 25,
    });
    expect(calls.some((entry: any) => entry.command === 'lfs_fetch_object')).toBe(false);
    await page.setViewportSize({ width: 900, height: 640 });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Fetch reviewed object', exact: true }).click();
    await expect(dialog.locator('.object-result')).toBeFocused();
    await expect(dialog).toContainText('Reviewed object fetched into local storage. Working files were not hydrated');
    const missingRow = dialog.getByRole('list', { name: 'Local LFS objects' }).getByRole('listitem').filter({ hasText: 'assets/missing.bin' });
    await expect(missingRow).toContainText('missing (may be deleted or sparse-excluded)');
    await expect(missingRow).toContainText('available by size (not hash-verified)');
    calls = await page.evaluate(() => (window as any).__lfsTracking.calls);
    expect(calls.find((entry: any) => entry.command === 'lfs_fetch_object').args).toEqual({
      repoId: expect.any(String), operationId: expect.any(String),
      preview: { file: 'assets/missing.bin', remote: 'backup', oid: 'a'.repeat(64), size: 25, head: '1'.repeat(40), settings: 'b'.repeat(40) },
    });
    expect(calls.some((entry: any) => ['lfs_pull', 'lfs_prune', 'stage_path'].includes(entry.command))).toBe(false);
  });

test('selective LFS fetch refuses staged-only preview and stale execution, retaining selected remote for fresh review', async ({ page }) => {
    await openFetchReview(page);
    const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
    await dialog.getByLabel('Remote for selective fetch').selectOption('origin');
    await expect(dialog.locator('.fetch-review')).toHaveCount(0);
    await page.evaluate(() => { (window as any).__lfsTracking.fetchPreviewFail = true; });
    await dialog.getByRole('button', { name: 'Review fetch of assets/missing.bin', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeFocused();
    await expect(dialog.getByRole('alert')).toContainText('staged-only');
    await expect(dialog.getByLabel('Remote for selective fetch')).toHaveValue('origin');
    await expect(dialog.locator('.fetch-review')).toHaveCount(0);
    await page.evaluate(() => {
      (window as any).__lfsTracking.fetchPreviewFail = false;
      (window as any).__lfsTracking.fetchFail = true;
    });
    await dialog.getByRole('button', { name: 'Review fetch of assets/missing.bin', exact: true }).click();
    await dialog.getByRole('button', { name: 'Fetch reviewed object', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeFocused();
    await expect(dialog.getByRole('alert')).toContainText('No transfer started');
    await expect(dialog.locator('.fetch-review')).toHaveCount(0);
    await page.evaluate(() => { (window as any).__lfsTracking.fetchFail = false; });
    await dialog.getByRole('button', { name: 'Review fetch of assets/missing.bin', exact: true }).click();
    await dialog.getByRole('button', { name: 'Fetch reviewed object', exact: true }).click();
    await expect(dialog).toContainText('Reviewed object fetched into local storage');
  });

test('selective LFS transfer is keyboard-contained and cancel never presents downloaded success', async ({ page }) => {
    await openFetchReview(page);
    const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
    await page.evaluate(() => { (window as any).__lfsTracking.fetchHold = true; });
    await dialog.getByRole('button', { name: 'Fetch reviewed object', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Remote for selective fetch')).toBeDisabled();
    await expect(dialog.locator('summary')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel transfer', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel transfer', exact: true }).click();
    const notice = dialog.getByRole('status').filter({ hasText: 'LFS fetch cancelled' });
    await expect(notice).toBeFocused();
    await expect(notice).toContainText('Downloaded or partial cache data may remain');
    await expect(dialog).not.toContainText('Reviewed object fetched into local storage');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
    await expect(dialog.locator('.fetch-review')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__lfsTracking.fetched)).toBe(false);
  });

test('repository switch after LFS fetch review disables transfer without invoking a new repository', async ({ page }) => {
    await openFetchReview(page);
    const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
    await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
      git.activeRepositoryId.set('other');
    });
    await expect(dialog.getByRole('button', { name: 'Fetch reviewed object', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText('active repository changed');
    expect(await page.evaluate(() => (window as any).__lfsTracking.calls.some((entry: any) => entry.command === 'lfs_fetch_object'))).toBe(false);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Manage tracking patterns…', exact: true }).click();
    await expect(dialog.locator('.fetch-review')).toHaveCount(0);
    await dialog.locator('summary').click();
    await dialog.getByRole('button', { name: 'Inspect local objects', exact: true }).click();
    await expect(dialog.getByLabel('Remote for selective fetch')).toHaveValue('');
  });

test('repository switch during LFS fetch completion does not scan the newly active repository', async ({ page }) => {
  await openFetchReview(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await page.evaluate(() => { (window as any).__lfsTracking.fetchHold = true; });
  await dialog.getByRole('button', { name: 'Fetch reviewed object', exact: true }).click();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
    (window as any).__lfsTracking.finish();
  });
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  await expect(dialog.locator('.fetch-review')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__lfsTracking.calls);
  expect(calls.filter((entry: any) => entry.command === 'lfs_objects')).toHaveLength(1);
  expect(calls.filter((entry: any) => ['lfs_fetch_preview', 'lfs_fetch_object'].includes(entry.command))
    .every((entry: any) => entry.args.repoId !== 'other')).toBe(true);
});

async function openHydrationReview(page: Page): Promise<void> {
  await setup(page);
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.locator('summary').click();
  await dialog.getByRole('button', { name: 'Inspect local objects', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review hydration of assets/pointer.bin', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Hydrate reviewed file', exact: true })).toBeFocused();
}

test('local LFS hydration reviews exact pointer lease and verifies contents without fetch or staging', async ({ page }) => {
  await openHydrationReview(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await expect(dialog.locator('.checkout-review')).toContainText('assets/pointer.bin');
  await expect(dialog.locator('.checkout-review')).toContainText('verifies SHA-256 and size');
  await expect(dialog.locator('.checkout-review')).toContainText('No network transfer, staging, pruning, lock/unlock or reference update');
  await expect(dialog.getByRole('button', { name: 'Review hydration of assets/missing.bin' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Review hydration of assets/modified.bin' })).toHaveCount(0);
  const initialCalls = await page.evaluate(() => (window as any).__lfsTracking.calls);
  expect(initialCalls.find((entry: any) => entry.command === 'lfs_checkout_preview').args).toEqual({
    repoId: expect.any(String), file: 'assets/pointer.bin', expectedOid: 'a'.repeat(64), expectedSize: 25,
  });
  expect(initialCalls.some((entry: any) => entry.command === 'lfs_checkout_object')).toBe(false);
  await page.setViewportSize({ width: 900, height: 640 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Hydrate reviewed file', exact: true }).click();
  await expect(dialog.locator('.object-result')).toBeFocused();
  await expect(dialog).toContainText('Reviewed working pointer hydrated from SHA-256-verified local contents');
  await expect(dialog.getByRole('button', { name: 'Review hydration of assets/pointer.bin', exact: true })).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__lfsTracking.calls);
  expect(calls.find((entry: any) => entry.command === 'lfs_checkout_object').args).toEqual({
    repoId: expect.any(String), operationId: expect.any(String),
    preview: { file: 'assets/pointer.bin', oid: 'a'.repeat(64), size: 25, state: 'hydration-lease' },
  });
  expect(calls.some((entry: any) => ['lfs_fetch_object', 'lfs_pull', 'lfs_prune', 'stage_path'].includes(entry.command))).toBe(false);
});

test('local LFS hydration preview and corrupt-cache refusal remain errors with fresh reviewed retry', async ({ page }) => {
  await openHydrationReview(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await page.evaluate(() => { (window as any).__lfsTracking.checkoutFail = true; });
  await dialog.getByRole('button', { name: 'Hydrate reviewed file', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('alert')).toContainText('working pointer was not replaced');
  await expect(dialog.locator('.checkout-review')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__lfsTracking.checkoutPreviewFail = true; });
  await dialog.getByRole('button', { name: 'Review hydration of assets/pointer.bin', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Modified and sparse-excluded files');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.locator('.checkout-review')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__lfsTracking.checkoutPreviewFail = false;
    (window as any).__lfsTracking.checkoutFail = false;
  });
  await dialog.getByRole('button', { name: 'Review hydration of assets/pointer.bin', exact: true }).click();
  await dialog.getByRole('button', { name: 'Hydrate reviewed file', exact: true }).click();
  await expect(dialog).toContainText('Reviewed working pointer hydrated');
});

test('local LFS hydration pending state traps keyboard focus and cancellation never claims success', async ({ page }) => {
  await openHydrationReview(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await page.evaluate(() => { (window as any).__lfsTracking.checkoutHold = true; });
  await dialog.getByRole('button', { name: 'Hydrate reviewed file', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await expect(dialog.locator('summary')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel hydration', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel hydration', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel hydration', exact: true }).click();
  const notice = dialog.getByRole('status').filter({ hasText: 'Hydration cancelled' });
  await expect(notice).toBeFocused();
  await expect(notice).toContainText('cancellation may arrive after replacement');
  await expect(dialog).not.toContainText('Reviewed working pointer hydrated');
  await expect(dialog.locator('.checkout-review')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__lfsTracking.hydrated)).toBe(false);
});

test('LFS hydration and fetch reviews are mutually exclusive and reload clears hydration review', async ({ page }) => {
  await openHydrationReview(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await dialog.getByLabel('Remote for selective fetch').selectOption('origin');
  await dialog.getByRole('button', { name: 'Review fetch of assets/pointer.bin', exact: true }).click();
  await expect(dialog.locator('.checkout-review')).toHaveCount(0);
  await expect(dialog.locator('.fetch-review')).toBeVisible();
  await dialog.getByRole('button', { name: 'Review hydration of assets/pointer.bin', exact: true }).click();
  await expect(dialog.locator('.fetch-review')).toHaveCount(0);
  await expect(dialog.locator('.checkout-review')).toBeVisible();
  await dialog.getByRole('button', { name: 'Reload patterns', exact: true }).click();
  await expect(dialog.locator('.checkout-review')).toHaveCount(0);
  await expect(dialog.locator('.object-result')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__lfsTracking.calls.some((entry: any) => entry.command === 'lfs_checkout_object'))).toBe(false);
});

test('LFS hydration repository switch blocks execution and reopening discards old file review', async ({ page }) => {
  await openHydrationReview(page);
  const dialog = page.getByRole('dialog', { name: 'LFS tracking patterns' });
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other' }]);
    git.activeRepositoryId.set('other');
  });
  await expect(dialog.getByRole('button', { name: 'Hydrate reviewed file', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('active repository changed');
  expect(await page.evaluate(() => (window as any).__lfsTracking.calls.some((entry: any) => entry.command === 'lfs_checkout_object'))).toBe(false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Manage tracking patterns…', exact: true }).click();
  await expect(dialog.locator('.checkout-review')).toHaveCount(0);
});
