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

test('selects a non-default terminal profile and retries its captured command after a launch failure', async ({ page }) => {
  await prepare(page); const dialog = await preferences(page); await create(page, 'First shell');
  await page.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  await create(page, 'Other shell');
  await expect(page.getByRole('combobox', { name: 'Program profile role' }).locator('option[value="agent"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  const panel = page.locator('gc-terminal-panel');
  await expect(panel.getByRole('tab', { name: 'system shell 1', exact: true })).toBeVisible();
  const opener = panel.getByRole('button', { name: 'Choose terminal profile' });
  await opener.click();
  await expect(panel.getByLabel('Terminal profile', { exact: true })).toBeFocused();
  await panel.getByLabel('Terminal profile', { exact: true }).press('Escape');
  await expect(opener).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Open terminal', exact: true })).toHaveCount(0);
  await opener.click();
  await panel.getByLabel('Terminal profile', { exact: true }).selectOption({ label: 'Other shell' });
  expect(await page.evaluate(() => (window as any).toolCalls.filter((c: any) => c.command === 'open_configured_terminal'))).toEqual([]);
  await page.evaluate(() => { (window as any).failToolStartup = true; });
  await panel.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Owned program unavailable');
  const changed = await preferences(page);
  await changed.locator('.profiles button').filter({ hasText: 'Other shell' }).click();
  await changed.getByRole('textbox', { name: 'Program executable path' }).fill('/owned/replacement-after-failure');
  await changed.getByRole('button', { name: 'Save program profile', exact: true }).click();
  await expect(changed.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  await changed.getByRole('button', { name: 'Close preferences' }).click();
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(panel.getByRole('tab', { name: 'Other shell 2', exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).toolCalls.filter((c: any) => c.command === 'open_configured_terminal'));
  expect(calls).toHaveLength(2); expect(calls[0].args).toEqual(calls[1].args);
});

test('shows legacy profiles as terminal profiles without starting or silently defaulting them', async ({ page }) => {
  const raw = JSON.stringify({
    version: 2,
    profiles: [{ version: 1, id: 'legacy', name: 'Saved program', role: 'agent', executable: '/owned/legacy', arguments: ['{repository}'] }],
    defaultTerminalId: null, defaultEditorId: null, defaultDiffId: null, defaultMergeId: null,
  });
  await page.addInitScript((stored) => localStorage.setItem('git-khronos.tools.v1', stored), raw);
  await prepare(page);
  const dialog = await preferences(page);
  await expect(dialog.getByRole('status')).toContainText('Previously saved agent profiles are now terminal profiles');
  await expect(dialog.locator('.profiles button').filter({ hasText: 'Saved program · terminal' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.tools.v1'))).toBe(raw);
  expect(await page.evaluate(() => (window as any).toolCalls.filter((c: any) => c.command.startsWith('open_')))).toEqual([]);
  await dialog.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  const panel = page.locator('gc-terminal-panel');
  await expect(panel.getByRole('tab', { name: 'system shell 1', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Choose terminal profile' }).click();
  await panel.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await expect(panel.getByRole('tab', { name: 'Saved program 2', exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).toolCalls.filter((c: any) => c.command === 'open_configured_terminal'));
  expect(calls).toHaveLength(1);
  expect(calls[0].args.profile).toMatchObject({ id: 'legacy', role: 'terminal', executable: '/owned/legacy', arguments: ['{repository}'] });
});

test('requires another selection when an open terminal profile is deleted', async ({ page }) => {
  await prepare(page); const dialog = await preferences(page);
  for (const name of ['First shell', 'Deleted shell']) {
    await create(page, name);
    await page.getByRole('button', { name: 'Save program profile', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  const panel = page.locator('gc-terminal-panel');
  await expect(panel.getByRole('tab', { name: 'system shell 1', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Choose terminal profile' }).click();
  await panel.getByLabel('Terminal profile', { exact: true }).selectOption({ label: 'Deleted shell' });
  const changed = await preferences(page);
  await changed.locator('.profiles button').filter({ hasText: 'Deleted shell' }).click();
  await changed.getByRole('button', { name: 'Delete program profile', exact: true }).click();
  await changed.getByRole('button', { name: 'Close preferences' }).click();
  await panel.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('no longer available');
  expect(await page.evaluate(() => (window as any).toolCalls.filter((c: any) => c.command === 'open_configured_terminal'))).toEqual([]);
  await panel.getByLabel('Terminal profile', { exact: true }).selectOption({ label: 'First shell' });
  await panel.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await expect(panel.getByRole('tab', { name: 'First shell 2', exact: true })).toBeVisible();
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

  test(`keeps the terminal profile chooser usable at ${width}px`, async ({ page }, testInfo) => {
    const name = 'Long-shell-profile-'.repeat(3);
    await page.addInitScript((profileName) => localStorage.setItem('git-khronos.tools.v1', JSON.stringify({
      version: 2,
      profiles: [{ version: 1, id: 'shell', name: profileName, role: 'terminal', executable: '/owned/shell', arguments: [] }],
      defaultTerminalId: null, defaultEditorId: null, defaultDiffId: null, defaultMergeId: null,
    })), name);
    await page.setViewportSize({ width, height: 800 });
    await prepare(page);
    await page.keyboard.press('Alt+t');
    const panel = page.locator('gc-terminal-panel');
    await expect(panel.getByRole('tab', { name: 'system shell 1', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Choose terminal profile' }).click();
    const chooser = panel.locator('.terminal-profile-launcher');
    const bounds = await chooser.evaluate(el => {
      const { left, right } = el.getBoundingClientRect();
      const controls = Array.from(el.querySelectorAll('select, button'), control => {
        const { left, right } = control.getBoundingClientRect();
        return { left, right };
      });
      return { width: el.clientWidth, scroll: el.scrollWidth, left, right, controls };
    });
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    for (const control of bounds.controls) {
      expect(control.left).toBeGreaterThanOrEqual(bounds.left);
      expect(control.right).toBeLessThanOrEqual(bounds.right);
    }
    await expect(chooser.getByLabel('Terminal profile', { exact: true })).toBeFocused();
    await expect(chooser.getByRole('button', { name: 'Open terminal', exact: true })).toBeInViewport();
    await panel.locator('.terminal-panel').screenshot({ path: testInfo.outputPath(`terminal-profiles-${width}.png`) });
    await chooser.getByRole('button', { name: 'Open terminal', exact: true }).click();
    await expect(panel.getByRole('tab', { name: `${name} 2`, exact: true })).toBeVisible();
  });
}
