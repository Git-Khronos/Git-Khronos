import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { calls: [] as any[], fail: false };
    (window as any).__documentation = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'open_external_url') {
        if (fixture.fail) return Promise.reject({ kind: 'externalUrlUnavailable', message: 'The link could not be opened. Check your default browser.' });
        return Promise.resolve();
      }
      if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
}

async function openReference(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /^Git/ }).click();
  await preferences.getByRole('button', { name: 'Git command reference…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Git command reference', exact: true })).toBeVisible();
}

test('searchable hints explain command scope, open only official manual on demand and never execute Git actions', async ({ page }) => {
  await setup(page);
  await openReference(page);
  const dialog = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(dialog.getByLabel('Find a feature or command')).toBeFocused();
  await expect(dialog.locator('summary')).toHaveCount(40);
  expect(await page.evaluate(() => (window as any).__documentation.calls.filter((call: any) => call.command === 'open_external_url'))).toHaveLength(0);
  await dialog.getByLabel('Find a feature or command').fill('fetch and prune');
  await dialog.getByText('Fetch and prune remote-tracking branches', { exact: true }).click();
  await expect(dialog).toContainText('leaves tags unchanged');
  await dialog.getByRole('button', { name: /^Official manual: Fetch and prune/ }).click();
  expect(await page.evaluate(() => (window as any).__documentation.calls.find((call: any) => call.command === 'open_external_url').args)).toEqual({
    url: 'https://git-scm.com/docs/git-fetch',
  });
  expect(await page.evaluate(() => (window as any).__documentation.calls.some((call: any) => ['fetch_repository', 'fetch_with_options', 'lfs_prune', 'remove_worktree'].includes(call.command)))).toBe(false);
  await dialog.getByLabel('Find a feature or command').fill('no-such-git-command');
  await expect(dialog.getByRole('status')).toContainText('No matching feature');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Git command reference…', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
});

test('contextual help selects the relevant command, contains keyboard focus and restores its opener', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /^Git/ }).click();
  const opener = preferences.getByRole('button', { name: 'Learn about sparse checkout…', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  const selected = dialog.locator('details[open]');
  await expect(selected).toContainText('Choose directories and use sparse index');
  await expect(selected.locator('summary')).toBeFocused();
  await page.setViewportSize({ width: 900, height: 640 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Find a feature or command')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('manual opening failures are explicit, focused and retryable without losing the selected topic', async ({ page }) => {
  await setup(page);
  await openReference(page);
  const dialog = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await dialog.getByLabel('Find a feature or command').fill('unreferenced LFS storage');
  await dialog.locator('summary').click();
  await expect(dialog).toContainText('Shared or external storage, shallow history and partial clones are refused');
  await page.evaluate(() => { (window as any).__documentation.fail = true; });
  await dialog.getByRole('button', { name: /^Official manual:/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be opened');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.locator('details[open]')).toHaveCount(1);
  await expect(page.locator('.error-toast')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__documentation.fail = false; });
  await dialog.getByRole('button', { name: /^Official manual:/ }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('lazy reference loading has a focused keyboard escape before any external link is opened', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Git command reference') && text.includes('Before you act:')) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await route.fulfill({ response, body: text });
  });

  await setup(page);
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await page.getByRole('button', { name: 'Git command reference…', exact: true }).click();
  const loading = page.getByRole('dialog', { name: 'Loading Git reference', exact: true });
  await expect(loading).toBeVisible();
  await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(loading).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Git command reference…', exact: true })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__documentation.calls.some((call: any) => call.command === 'open_external_url'))).toBe(false);
});

test('failed reference chunk offers a focused escape without running a command', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Git command reference') && text.includes('Before you act:')) await route.abort();
    else await route.fulfill({ response, body: text });
  });
  await setup(page);
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  const opener = page.getByRole('button', { name: 'Git command reference…', exact: true });
  await opener.click();
  const error = page.getByRole('dialog', { name: 'Git reference unavailable', exact: true });
  await expect(error.getByRole('alert')).toContainText('Restart the application');
  await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(error).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => (window as any).__documentation.calls.some((call: any) => call.command === 'open_external_url'))).toBe(false);
});
