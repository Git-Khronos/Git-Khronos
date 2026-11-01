import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const state = window as any;
    const app = state.ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer tools fixture' }));
    state.toolCalls = []; let sequence = 0, callback = 100;
    state.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    state.__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        state.toolCalls.push({ command, args });
        if (command === 'validate_tool_profile') {
          if (state.rejectToolValidation) return Promise.reject({ message: 'Owned profile validation refusal' });
          return Promise.resolve(null);
        }
        if (command === 'open_configured_terminal') {
          if (state.failToolStartup) { state.failToolStartup = false; return Promise.reject({ message: 'Owned program unavailable' }); }
          return Promise.resolve({ id: `configured-${++sequence}`, label: args.profile.name, cwd: '/fixture' });
        }
        if (command === 'open_terminal') return Promise.resolve({ id: `system-${++sequence}`, label: 'system shell', cwd: '/fixture' });
        if (command === 'plugin:event|listen') return Promise.resolve(++callback);
        return Promise.resolve(null);
      }, transformCallback: () => ++callback, unregisterCallback: () => undefined,
    };
  });
}
async function preferences(page: Page) {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preferences' });
  await dialog.getByRole('tab', { name: /^Terminal/ }).click();
  return dialog;
}
async function create(page: Page, name = 'Owned shell') {
  await page.getByRole('button', { name: 'New program profile', exact: true }).click();
  await page.getByRole('textbox', { name: 'Program profile name' }).fill(name);
  await page.getByRole('textbox', { name: 'Program executable path' }).fill('/owned/program path');
  await page.getByRole('button', { name: 'Add argument', exact: true }).click();
  await page.getByRole('textbox', { name: 'Program argument 1', exact: true }).fill("literal 'quoted';$(value) {repository}");
}

test('persists a default with literal arguments and starts only on an explicit terminal action', async ({ page }) => {
  await prepare(page); const dialog = await preferences(page); await create(page);
  await page.getByRole('checkbox', { name: 'Use for new terminal tabs' }).check();
  await page.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).toolCalls.filter((c: any) => c.command.startsWith('open_')))).toEqual([]);
  await dialog.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  await expect(page.locator('gc-terminal-panel').getByRole('tab', { name: 'Owned shell 1', exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).toolCalls.filter((c: any) => c.command === 'open_configured_terminal'));
  expect(calls).toHaveLength(1);
  expect(calls[0].args.profile.executable).toBe('/owned/program path');
  expect(calls[0].args.profile.arguments).toEqual(["literal 'quoted';$(value) {repository}"]);
  expect(calls[0].args.repoId).toBeTruthy();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('git-khronos.tools.v1')!).profiles[0].name)).toBe('Owned shell');
});

test('retains the submitted draft after native validation refuses it', async ({ page }) => {
  await prepare(page); await preferences(page); await create(page);
  await page.evaluate(() => { (window as any).rejectToolValidation = true; });
  await page.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Owned profile validation refusal');
  await expect(page.getByRole('textbox', { name: 'Program executable path' })).toHaveValue('/owned/program path');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.tools.v1'))).toBeNull();
});

test('retries the captured configured program after a launch failure', async ({ page }) => {
  await prepare(page); const dialog = await preferences(page); await create(page, 'Owned agent');
  await page.getByRole('combobox', { name: 'Program profile role' }).selectOption('agent');
  await page.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  const panel = page.locator('gc-terminal-panel');
  await expect(panel.getByRole('tab', { name: 'system shell 1', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'New agent session' }).click();
  const selected = await panel.locator('select option').filter({ hasText: 'Owned agent' }).getAttribute('value');
  await panel.locator('select').selectOption(selected!);
  await page.evaluate(() => { (window as any).failToolStartup = true; });
  await panel.getByRole('button', { name: 'Start agent', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Owned program unavailable');
  const changed = await preferences(page);
  await changed.locator('.profiles button').filter({ hasText: 'Owned agent' }).click();
  await changed.getByRole('textbox', { name: 'Program executable path' }).fill('/owned/replacement-after-failure');
  await changed.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(changed.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  await changed.getByRole('button', { name: 'Close preferences' }).click();
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(panel.getByRole('tab', { name: 'Owned agent 2', exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).toolCalls.filter((c: any) => c.command === 'open_configured_terminal'));
  expect(calls).toHaveLength(2); expect(calls[0].args).toEqual(calls[1].args);
});

test('switching to the system shell updates an open profile form and the persisted default', async ({ page }) => {
  await prepare(page); const dialog = await preferences(page); await create(page);
  await page.getByRole('checkbox', { name: 'Use for new terminal tabs' }).check();
  await page.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  await dialog.locator('.profiles button').filter({ hasText: 'Owned shell' }).click();
  await expect(page.getByRole('checkbox', { name: 'Use for new terminal tabs' })).toBeChecked();
  await page.getByRole('button', { name: 'Use system shell for new terminal tabs' }).click();
  await expect(page.getByRole('checkbox', { name: 'Use for new terminal tabs' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('git-khronos.tools.v1')!).defaultTerminalId)).toBeNull();
});

for (const width of [320, 700]) {
  test(`keeps the configured program form inside a ${width}px window`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 }); await prepare(page);
    const dialog = await preferences(page); await create(page);
    await expect(page.getByRole('textbox', { name: 'Program argument 1', exact: true })).toBeVisible();
    const bounds = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    await page.screenshot({ path: testInfo.outputPath(`configured-tools-${width}.png`) });
  });
}
