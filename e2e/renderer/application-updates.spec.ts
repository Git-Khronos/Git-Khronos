import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const state: any = { app, git, repository, calls: [], callbacks: new Map(), listeners: new Map(), sequence: 0,
      status: { revision: 1, phase: 'idle', runningVersion: '0.1.6', installedVersion: null,
        packageFormat: 'deb', configured: true, automatic: false, offerId: null, offeredVersion: null,
        notes: '', verified: false, downloadedBytes: 0, totalBytes: null, message: 'Owned updater ready',
        storageError: null, canCheck: true, canDownload: false, canInstall: false, canInspect: false } };
    (window as any).__updates = state;
    (window as any).isTauri = true;
    state.emit = () => {
      for (const [id, listener] of state.listeners) {
        if (listener.event === 'application-update-changed') state.callbacks.get(listener.handler)?.({ event: listener.event, id, payload: { state: state.status } });
      }
    };
    state.replace = (patch: any) => { state.status = { ...state.status, ...patch, revision: state.status.revision + 1 }; state.emit(); };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback: (callback: any) => { const id = ++state.sequence; state.callbacks.set(id, callback); return id; },
      unregisterCallback: (id: number) => state.callbacks.delete(id),
      invoke: (command: string, args: any) => {
        state.calls.push({ command, args });
        if (command === 'plugin:event|listen') { const id = ++state.sequence; state.listeners.set(id, args); return Promise.resolve(id); }
        if (command === 'plugin:event|unlisten') return Promise.resolve();
        if (command === 'application_update_status') return Promise.resolve(state.status);
        if (command === 'open_external_url') {
          if (state.rejectBrowser) return Promise.reject({ message: 'Owned browser is unavailable' });
          return Promise.resolve();
        }
        if (command === 'set_automatic_application_updates') {
          if (state.rejectSetting) return Promise.reject({ message: 'Owned preference write failure' });
          state.replace({ automatic: args.enabled });
          if (state.loseSettingReply) return Promise.reject({ message: 'Owned response lost; inspect native status' });
          return Promise.resolve(state.status);
        }
        if (command === 'check_application_update') {
          state.replace({ phase: 'available', offeredVersion: '0.2.0', offerId: 'owned-offer-A',
            notes: '<script>not executable</script>', canDownload: true, message: 'Owned release offered' });
          return Promise.resolve(state.status);
        }
        if (command === 'download_application_update') {
          state.replace({ phase: 'ready', verified: true, downloadedBytes: 1234, totalBytes: 1234,
            canDownload: false, canInstall: true, message: 'Owned verified package ready' });
          return Promise.resolve(state.status);
        }
        if (command === 'install_application_update') {
          state.replace({ phase: 'installing', canInstall: false, canCheck: false, message: 'Owned installer in progress' });
          const finish = () => { state.replace({ phase: 'installed', installedVersion: '0.2.0', message: 'Owned installation confirmed; restart later' }); return state.status; };
          if (state.holdInstall) return new Promise(resolve => { state.finishInstall = () => resolve(finish()); });
          return Promise.resolve(finish());
        }
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.resolve(repository);
      },
    };
  });
});

async function open(page: Page) {
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Updates/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Updates', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('0.1.6');
  return dialog;
}

test('manual check, verify and install work while automatic mode stays off', async ({ page }) => {
  const dialog = await open(page);
  await expect(dialog.getByRole('checkbox', { name: 'Enable automatic updates' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(dialog).toContainText('0.2.0');
  await expect(dialog.locator('.notes')).toHaveText(/<script>not executable<\/script>/);
  await expect(dialog.locator('.notes script')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Install verified update', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Download and verify', exact: true }).click();
  await expect(dialog).toContainText('Package signature and signed version verified');
  await dialog.getByRole('button', { name: 'Install verified update', exact: true }).click();
  await expect(dialog).toContainText('Owned installation confirmed');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  expect(await page.evaluate(() => (window as any).__updates.calls.filter((call: any) => ['check_application_update', 'download_application_update', 'install_application_update'].includes(call.command))))
    .toMatchObject([{ command: 'check_application_update' }, { command: 'download_application_update', args: { offerId: 'owned-offer-A' } }, { command: 'install_application_update', args: { offerId: 'owned-offer-A' } }]);
});

test('automatic preference uses confirmed native state and restores the checkbox after refusal', async ({ page }) => {
  const dialog = await open(page);
  const automatic = dialog.getByRole('checkbox', { name: 'Enable automatic updates' });
  await page.evaluate(() => { (window as any).__updates.rejectSetting = true; });
  await automatic.click();
  await expect(dialog).toContainText('Owned preference write failure');
  await expect(automatic).not.toBeChecked();
  await page.evaluate(() => { const s = (window as any).__updates; s.rejectSetting = false; s.loseSettingReply = true; });
  await automatic.click();
  await expect(automatic).toBeChecked();
  await expect(dialog).toContainText('Owned response lost');
  await page.evaluate(() => { (window as any).__updates.loseSettingReply = false; });
  await automatic.click();
  await expect(automatic).not.toBeChecked();
});

test('unconfigured publisher trust never exposes an install or automatic opt-in', async ({ page }) => {
  await page.evaluate(() => (window as any).__updates.replace({ phase: 'unconfigured', configured: false,
    canCheck: false, message: 'Owned publisher signing key missing' }));
  const dialog = await open(page);
  await expect(dialog).toContainText('Owned publisher signing key missing');
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Install verified update', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__updates.calls.filter((call: any) => /^(check|download|install|set_automatic)_application_update/.test(call.command)))).toEqual([]);
});

test('manual release browsing uses the fixed URL without update trust or an installation request', async ({ page }) => {
  const official = 'https://github.com/Git-Khronos/Git-Khronos/releases';
  await page.evaluate(() => {
    const state = (window as any).__updates;
    state.rejectBrowser = true;
    state.replace({ phase: 'unconfigured', configured: false, canCheck: false, message: 'Owned publisher signing key missing',
      notes: 'Untrusted link: https://example.test/another-release' });
  });
  const dialog = await open(page);
  const browse = dialog.getByRole('button', { name: 'Browse official releases (opens browser)', exact: true });
  const calls = () => page.evaluate(() => (window as any).__updates.calls.filter((call: any) =>
    /^(open_external_url|check_application_update|download_application_update|install_application_update|set_automatic_application_updates)$/.test(call.command)));
  expect(await calls()).toEqual([]);
  await browse.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText(official);
  await expect(browse).toBeFocused();
  const openBrowser = { command: 'open_external_url', args: { url: official } };
  expect(await calls()).toEqual([openBrowser]);
  await page.evaluate(() => { (window as any).__updates.rejectBrowser = false; });
  await browse.click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await calls()).toEqual([openBrowser, openBrowser]);
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
});

test('install remains one-shot and cannot be dismissed before the native outcome', async ({ page }) => {
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await dialog.getByRole('button', { name: 'Download and verify', exact: true }).click();
  await page.evaluate(() => { (window as any).__updates.holdInstall = true; });
  await dialog.getByRole('button', { name: 'Install verified update', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  await dialog.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Install verified update', exact: true }).evaluate(button => button.click());
  expect(await page.evaluate(() => (window as any).__updates.calls.filter((call: any) => call.command === 'install_application_update'))).toHaveLength(1);
  await page.evaluate(() => (window as any).__updates.finishInstall());
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Main menu', exact: true })).toBeFocused();
});

for (const action of ['install', 'automatic', 'close', 'browse']) {
  test(`outgoing Updates ${action} cannot consume a replacement dialog`, async ({ page }) => {
    const dialog = await open(page);
    await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await dialog.getByRole('button', { name: 'Download and verify', exact: true }).click();
    await page.evaluate(action => {
      const old = document.querySelector('gc-application-updates-dialog')!;
      const s = (window as any).__updates;
      const request = s.app.applicationUpdatesRequest(); s.app.closeApplicationUpdates(request); s.app.openApplicationUpdates();
      if (action === 'automatic') {
        const checkbox = old.querySelector<HTMLInputElement>('input[type=checkbox]')!; checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const labels = { close: 'Close', install: 'Install verified update', browse: 'Browse official releases (opens browser)' };
        [...old.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === labels[action as keyof typeof labels])!.click();
      }
    }, action);
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => (window as any).__updates.calls.filter((call: any) => ['install_application_update', 'set_automatic_application_updates', 'open_external_url'].includes(call.command)))).toEqual([]);
  });
}

test('Updates remains usable at narrow width and contains keyboard focus', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 460, height: 720 });
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(dialog.locator('.notes')).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Refresh status', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('updates-narrow.png') });
});

test('manual Updates is available without an open repository and returns focus to its welcome action', async ({ page }) => {
  await page.evaluate(() => { const s = (window as any).__updates; s.git.repositories.set([]); s.git.activeRepositoryId.set(null); });
  const opener = page.getByRole('button', { name: 'Application updates', exact: true });
  await expect(opener).toBeVisible();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Updates', exact: true });
  await expect(dialog).toContainText('0.1.6');
  await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(dialog).toContainText('0.2.0');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(opener).toBeFocused();
});

test('unknown-length downloads use indeterminate progress until a native total is known', async ({ page }) => {
  await page.evaluate(() => (window as any).__updates.replace({ phase: 'downloading', downloadedBytes: 4096, totalBytes: null, canCheck: false }));
  const dialog = await open(page);
  const progress = dialog.getByRole('progressbar', { name: 'Update download' });
  await expect(progress).toBeVisible();
  await expect(progress).not.toHaveAttribute('value');
  await page.evaluate(() => (window as any).__updates.replace({ totalBytes: 8192 }));
  await expect(progress).toHaveAttribute('value', '4096');
  await expect(progress).toHaveAttribute('max', '8192');
});
