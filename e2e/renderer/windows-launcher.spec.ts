import { expect, test, type Page } from '@playwright/test';

const IDENTITY = 'Microsoft.RemoteApp.fixtureIdentity0123456789=';
const OTHER = 'Microsoft.RemoteApp.otherFixtureIdentity98765=';
const WSLG = 'C:\\Program Files\\WSL\\wslg.exe';
const ARGS = '-d DEV --cd "~" -- git-khronos';
const SPLIT_ARGS = 'Files\\WSL\\wslg.exe -d DEV --cd "~" -- git-khronos';
const PIN = 'C:\\Users\\fixture\\AppData\\Roaming\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\Git Khronos (DEV).lnk';
const IMPLICIT = 'C:\\Users\\fixture\\AppData\\Roaming\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\ImplicitAppShortcuts\\0001\\Git Khronos (DEV).lnk';
const START = 'C:\\Users\\fixture\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\DEV\\Git Khronos (DEV).lnk';
const BACKUP = 'C:\\Users\\fixture\\AppData\\Local\\Git Khronos\\Windows shortcut backups\\1767225600000-42-0\\original\\Git Khronos (DEV).lnk';

type Plan = { target: string | null; arguments: string | null; appIdentity: string | null };
function shortcut(location: string, path: string, launch: string, identity: string, appIdentity: string | null, repair: Plan | null = null, note: string | null = null, split = false) {
  return {
    location, path, target: split ? 'C:\\Program' : WSLG, arguments: split ? SPLIT_ARGS : ARGS, appIdentity,
    launch, identity, fingerprint: `${location}-hash`, repair, note,
  };
}
const identityPlan: Plan = { target: null, arguments: null, appIdentity: IDENTITY };
const targetPlan: Plan = { target: WSLG, arguments: ARGS, appIdentity: null };
const START_ROW = shortcut('startMenu', START, 'works', 'missing', null, null, 'WSL recreates this shortcut, so Git Khronos does not change it. Pins made from it can be repaired separately.');
const BASE = { supported: true, message: null, distribution: 'DEV', appIdentity: IDENTITY, identitySource: IMPLICIT, conflictingIdentities: [], launcher: WSLG, incomplete: [] as string[] };

const UNREPAIRED = {
  ...BASE,
  shortcuts: [START_ROW, shortcut('taskbarPin', PIN, 'works', 'missing', null, identityPlan), shortcut('implicit', IMPLICIT, 'works', 'matching', IDENTITY)],
};
const REPAIRED = { ...UNREPAIRED, shortcuts: [START_ROW, shortcut('taskbarPin', PIN, 'works', 'matching', IDENTITY), UNREPAIRED.shortcuts[2]] };

async function mock(page: Page, responses: { inspect: unknown[]; repair?: unknown }, wsl = true) {
  await page.evaluate(({ responses, wsl }) => {
    const calls: Array<{ command: string; args: any }> = [];
    const inspections = [...responses.inspect];
    (window as any).__launcherCalls = calls;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        calls.push({ command, args });
        if (command === 'inspect_windows_launcher') {
          const next = inspections.length > 1 ? inspections.shift() : inspections[0];
          return (next as any)?.kind ? Promise.reject(next) : Promise.resolve(next);
        }
        if (command === 'repair_windows_shortcut') {
          return (responses.repair as any)?.kind ? Promise.reject(responses.repair) : Promise.resolve(responses.repair);
        }
        return Promise.resolve(null);
      },
    };
    (window as any).ng.getComponent(document.querySelector('gc-root')).git.systemInfo.set({
      appVersion: 'launcher fixture', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0', windowsSubsystemForLinux: wsl, windowsInteropAvailable: wsl,
    });
  }, { responses, wsl });
}
const calls = (page: Page, command: string) => page.evaluate(command =>
  (window as any).__launcherCalls.filter((call: { command: string }) => call.command === command).map((call: { args: any }) => call.args), command);
async function open(page: Page) {
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /Windows taskbar shortcut/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Windows taskbar shortcut', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Check again' })).toBeEnabled();
  const summaries = dialog.locator('details:not([open]) > summary');
  while (await summaries.count()) await summaries.first().click();
  return dialog;
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('offers the shortcut check only under WSL', async ({ page }) => {
  await mock(page, { inspect: [UNREPAIRED] }, false);
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Preferences/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Windows taskbar shortcut/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await mock(page, { inspect: [UNREPAIRED] }, true);
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Windows taskbar shortcut/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.systemInfo.update((info: object) => ({ ...info, windowsInteropAvailable: false })));
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Windows taskbar shortcut/ })).toHaveCount(0);
});

test('incomplete enumeration is not reported as clean', async ({ page }) => {
  await mock(page, { inspect: [{ ...UNREPAIRED, incomplete: ['Access denied'] }] });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Windows taskbar shortcut/ })).toContainText("Couldn't check");
});

for (const launch of ['splitPath', 'launcherMissing', 'unreadable']) {
  test(`menu needs attention for ${launch}`, async ({ page }) => {
    await mock(page, { inspect: [{ ...BASE, shortcuts: [shortcut('taskbarPin', PIN, launch, 'unknown', null)] }] });
    await page.getByRole('button', { name: 'Main menu', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /Windows taskbar shortcut/ })).toContainText('Needs attention');
  });
}

test('menu opens without waiting for inspection and reports failures', async ({ page }) => {
  await mock(page, { inspect: [UNREPAIRED] });
  await page.evaluate(() => {
    const original = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: unknown) =>
      command === 'inspect_windows_launcher'
        ? new Promise((_, reject) => { (window as any).__rejectInspection = reject; })
        : original(command, args);
  });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  const menu = page.getByRole('menuitem', { name: /Windows taskbar shortcut/ });
  await expect(menu).toContainText('Checking…');
  await expect(page.getByRole('menuitem', { name: /Preferences/ })).toBeVisible();
  await page.evaluate(() => (window as any).__rejectInspection({ message: 'Unavailable' }));
  await expect(menu).toContainText("Couldn't check");
});

test('reopening the menu sees an externally repaired launcher', async ({ page }) => {
  const broken = { ...BASE, shortcuts: [shortcut('taskbarPin', PIN, 'splitPath', 'missing', null, targetPlan, null, true)] };
  await mock(page, { inspect: [broken, UNREPAIRED] });
  const toggle = page.getByRole('button', { name: 'Main menu', exact: true });
  const menu = page.getByRole('menuitem', { name: /Windows taskbar shortcut/ });
  await toggle.click();
  await expect(menu).toContainText('Needs attention');
  await page.keyboard.press('Escape');
  await toggle.click();
  await expect(menu).toContainText('No launcher problems in checked files');
  expect(await calls(page, 'inspect_windows_launcher')).toHaveLength(2);
});

test('reopening the menu refreshes an acknowledged file changed externally', async ({ page }) => {
  const changed = { ...UNREPAIRED, shortcuts: [START_ROW, { ...UNREPAIRED.shortcuts[1], fingerprint: 'changed-externally' }, UNREPAIRED.shortcuts[2]] };
  await mock(page, { inspect: [UNREPAIRED, changed] });
  const dialog = await open(page);
  const pin = dialog.getByRole('listitem').filter({ hasText: PIN });
  await pin.getByRole('button', { name: 'This pin works' }).click();
  await expect(pin.getByText('You marked this shortcut as working.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  const menu = page.getByRole('menuitem', { name: /Windows taskbar shortcut/ });
  await expect(menu).toContainText('No launcher problems in checked files');
  await menu.click();
  await expect(pin.getByText('You marked this shortcut as working.')).toHaveCount(0);
  await pin.locator('summary').click();
  await expect(pin.getByRole('button', { name: 'This pin works' })).toBeVisible();
  expect(await calls(page, 'inspect_windows_launcher')).toHaveLength(2);
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([]);
});

test('transient interop failure remains visible and retries on reopening', async ({ page }) => {
  await mock(page, { inspect: [
    { ...BASE, supported: false, interopUnavailable: true, message: 'Windows programs could not start.', shortcuts: [] },
    UNREPAIRED,
  ] });
  const toggle = page.getByRole('button', { name: 'Main menu', exact: true });
  const menu = page.getByRole('menuitem', { name: /Windows taskbar shortcut/ });
  await toggle.click();
  await expect(menu).toContainText("Couldn't check");
  await page.keyboard.press('Escape');
  await toggle.click();
  await expect(menu).toContainText('No launcher problems in checked files');
  expect(await calls(page, 'inspect_windows_launcher')).toHaveLength(2);
});

test('does not imply a pin was checked when only other shortcut files exist', async ({ page }) => {
  await mock(page, { inspect: [{ ...BASE, shortcuts: [START_ROW, UNREPAIRED.shortcuts[2]] }] });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Windows taskbar shortcut/ })).toContainText('No matching taskbar pin file found');
});

test('repeated menu openings share an in-flight inspection', async ({ page }) => {
  await mock(page, { inspect: [UNREPAIRED] });
  await page.evaluate(() => {
    const original = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__inspectionCount = 0;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: unknown) => {
      if (command !== 'inspect_windows_launcher') return original(command, args);
      (window as any).__inspectionCount++;
      return new Promise(resolve => { (window as any).__resolveInspection = resolve; });
    };
  });
  const toggle = page.getByRole('button', { name: 'Main menu', exact: true });
  const menu = page.getByRole('menuitem', { name: /Windows taskbar shortcut/ });
  await toggle.click();
  await expect(menu).toContainText('Checking…');
  await page.keyboard.press('Escape');
  await toggle.click();
  await expect(menu).toContainText('Checking…');
  await menu.click();
  const dialog = page.getByRole('dialog', { name: 'Windows taskbar shortcut', exact: true });
  await expect(dialog.getByText('Reading Windows shortcuts…')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__inspectionCount)).toBe(1);
  await page.evaluate(data => (window as any).__resolveInspection(data), UNREPAIRED);
  await expect(dialog.getByText('Reading Windows shortcuts…')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__inspectionCount)).toBe(1);
});

test('adds the recorded identity to a pin made from the Start Menu only after confirmation', async ({ page }) => {
  await mock(page, { inspect: [UNREPAIRED, REPAIRED], repair: { path: PIN, plan: identityPlan, backupPath: BACKUP } });
  const dialog = await open(page);
  await expect(dialog.getByText(IDENTITY).first()).toBeVisible();
  await expect(dialog.getByText('WSL recreates this shortcut')).toBeVisible();
  await expect(dialog.getByText('This check reads shortcut files only.')).toBeVisible();
  expect(await calls(page, 'inspect_windows_launcher')).toHaveLength(1);
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([]);
  await expect(dialog.getByText('does not prove a pin is broken')).toBeVisible();
  await expect(dialog.getByText(/already opens the app and groups with its window, leave it unchanged/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Review possible repair…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Confirm shortcut repair' });
  await expect(confirm).toContainText('Skip this if the pin already works as expected.');
  await expect(confirm).toContainText(PIN);
  await expect(confirm).toContainText(`None → ${IDENTITY}`);
  await expect(confirm.getByText('Target', { exact: true })).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([]);

  await dialog.getByRole('button', { name: 'Review possible repair…' }).click();
  await dialog.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByText('The shortcut file now carries the identity from the window record.')).toBeVisible();
  await expect(dialog.getByText('could not be confirmed here')).toBeVisible();
  await expect(dialog.getByText(BACKUP)).toBeVisible();
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([{ path: PIN, fingerprint: 'taskbarPin-hash', plan: identityPlan }]);
  await expect(dialog.getByText(/groups with the running window/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Review possible repair…' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Main menu', exact: true })).toBeFocused();
});

test('rejoins a split launcher path on a pin made from the running window', async ({ page }) => {
  const plan = { ...targetPlan, appIdentity: IDENTITY };
  await mock(page, { inspect: [{ ...BASE, shortcuts: [START_ROW, shortcut('taskbarPin', PIN, 'splitPath', 'missing', null, plan, null, true), shortcut('implicit', IMPLICIT, 'works', 'matching', IDENTITY)] }],
    repair: { path: PIN, plan, backupPath: BACKUP } });
  const dialog = await open(page);
  await expect(dialog.getByText('Launcher path split at a space')).toBeVisible();
  await dialog.getByRole('button', { name: 'Review possible repair…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Confirm shortcut repair' });
  await expect(confirm).toContainText(`C:\\Program → ${WSLG}`);
  await expect(confirm).toContainText(`${SPLIT_ARGS} → ${ARGS}`);
  await expect(confirm).toContainText(`None → ${IDENTITY}`);
  await confirm.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByText(`The shortcut file now starts ${WSLG} and carries the identity from the window record.`)).toBeVisible();
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([{ path: PIN, fingerprint: 'taskbarPin-hash', plan }]);
});

test('repairs only the target of a split window record and still uses its identity', async ({ page }) => {
  await mock(page, { inspect: [{ ...BASE, shortcuts: [shortcut('implicit', IMPLICIT, 'splitPath', 'matching', IDENTITY, targetPlan, null, true)] }],
    repair: { path: IMPLICIT, plan: targetPlan, backupPath: BACKUP } });
  const dialog = await open(page);
  await expect(dialog.getByText('Window record (ImplicitAppShortcuts)')).toBeVisible();
  await expect(dialog.getByText('No Git Khronos shortcut was found in the taskbar pins folder.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Review possible repair…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Confirm shortcut repair' });
  await expect(confirm.getByText('Identity', { exact: true })).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByText(`The shortcut file now starts ${WSLG}.`)).toBeVisible();
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([{ path: IMPLICIT, fingerprint: 'implicit-hash', plan: targetPlan }]);
});

test('explains first-time setup and conflicting records without guessing an identity', async ({ page }) => {
  const missing = 'No single recorded identity is available, so the application id cannot be set.';
  await mock(page, { inspect: [
    { ...BASE, appIdentity: null, identitySource: null, launcher: null, shortcuts: [START_ROW, shortcut('taskbarPin', PIN, 'splitPath', 'missing', null, targetPlan, missing, true)] },
    { ...BASE, appIdentity: null, identitySource: null, conflictingIdentities: [IDENTITY, OTHER], shortcuts: [shortcut('taskbarPin', PIN, 'works', 'missing', null, null, missing)] },
  ] });
  const dialog = await open(page);
  await expect(dialog.getByText('No window record with an application identity was found.')).toBeVisible();
  await expect(dialog.getByText('Git Khronos cannot create one')).toBeVisible();
  await expect(dialog.getByText(/^Optional: .*pinned from its running taskbar button.*not documented Windows behavior/)).toBeVisible();
  await expect(dialog).not.toContainText('Keep Git Khronos open');
  await expect(dialog.getByText(missing)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review possible repair…' })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog.getByRole('alert')).toContainText('more than one identity');
  await expect(dialog.getByRole('button', { name: 'Review possible repair…' })).toHaveCount(0);
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([]);
});

test('menu reports only launcher problems and treats missing identities as informational', async ({ page }) => {
  const broken = { ...BASE, shortcuts: [shortcut('taskbarPin', PIN, 'splitPath', 'missing', null, targetPlan, null, true)] };
  const empty = { ...BASE, shortcuts: [], incomplete: [] };
  await mock(page, { inspect: [UNREPAIRED, broken, broken, empty, empty] });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  const menu = page.getByRole('menuitem', { name: /Windows taskbar shortcut/ });
  await expect(menu).toContainText('No launcher problems in checked files');
  await menu.click();
  const dialog = page.getByRole('dialog', { name: 'Windows taskbar shortcut', exact: true });
  await expect(dialog.locator('[data-identity="missing"]:visible')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Review possible repair…' })).toBeHidden();
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog.getByText('Launcher path split at a space')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(menu).toContainText('Needs attention');
  await menu.click();
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog.getByText('No Git Khronos shortcuts were found for this distribution.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(menu).toContainText("Couldn't check");
  expect(await calls(page, 'inspect_windows_launcher')).toHaveLength(5);
});

test('acknowledgement persists for the same file and disappears when its fingerprint changes', async ({ page }) => {
  const changed = { ...UNREPAIRED, shortcuts: [START_ROW, { ...UNREPAIRED.shortcuts[1], fingerprint: 'changed-hash' }, UNREPAIRED.shortcuts[2]] };
  await mock(page, { inspect: [UNREPAIRED, UNREPAIRED, changed] });
  const dialog = await open(page);
  const pin = dialog.getByRole('listitem').filter({ hasText: PIN });
  await pin.getByRole('button', { name: 'This pin works' }).click();
  await expect(pin.getByText('You marked this shortcut as working.')).toBeVisible();
  await expect(pin.getByRole('button', { name: 'Review possible repair…' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await mock(page, { inspect: [UNREPAIRED, changed] });
  await open(page);
  await expect(pin.getByText('You marked this shortcut as working.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(pin.getByText('You marked this shortcut as working.')).toHaveCount(0);
  await pin.locator('summary').click();
  await expect(pin.getByRole('button', { name: 'This pin works' })).toBeVisible();
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([]);
});

test('explains an ambiguous launcher without offering a repair', async ({ page }) => {
  const note = 'Working Git Khronos shortcuts start different launchers, so the split path is ambiguous and is left unchanged.';
  await mock(page, { inspect: [{ ...BASE, launcher: null, shortcuts: [shortcut('taskbarPin', PIN, 'splitPath', 'missing', null, null, note, true)] }] });
  const dialog = await open(page);
  await expect(dialog.getByText(note)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review possible repair…' })).toHaveCount(0);
});

test('reports unsupported hosts and failed requests', async ({ page }) => {
  await mock(page, { inspect: [
    { supported: false, message: 'Windows programs cannot be started from this WSL distribution.', distribution: null, appIdentity: null, identitySource: null, conflictingIdentities: [], launcher: null, shortcuts: [], incomplete: [] },
    { kind: 'windowsShortcutScriptFailed', message: 'Windows reported an error while handling the shortcuts: denied', hint: null },
  ] });
  const dialog = await open(page);
  await expect(dialog.getByText('Windows programs cannot be started from this WSL distribution.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog.getByRole('alert')).toContainText('denied');
  expect(await calls(page, 'repair_windows_shortcut')).toEqual([]);
});

test('shows a rejected repair without retrying it', async ({ page }) => {
  await mock(page, { inspect: [UNREPAIRED], repair: { kind: 'windowsShortcutChanged', message: 'The shortcut changed after it was reviewed. Nothing was modified.', hint: 'Check the shortcuts again and review the new result.' } });
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Review possible repair…' }).click();
  await dialog.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Nothing was modified');
  await expect(dialog.getByRole('alert')).toContainText('review the new result');
  expect(await calls(page, 'repair_windows_shortcut')).toHaveLength(1);
});

test('keeps the backup location visible after a failed write', async ({ page }) => {
  await mock(page, { inspect: [UNREPAIRED], repair: {
    kind: 'windowsShortcutRestoreUnverified',
    message: `The shortcut could not be rewritten, and restoring its original contents could not be confirmed. The original is saved at ${BACKUP}.`,
    hint: 'Copy the backup over the shortcut, or unpin it and pin Git Khronos again from the Start Menu.',
  } });
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Review possible repair…' }).click();
  await dialog.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByRole('alert')).toContainText(BACKUP);
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog.getByRole('button', { name: 'Review possible repair…' })).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText(BACKUP);
  expect(await calls(page, 'repair_windows_shortcut')).toHaveLength(1);
});

test('warns that the list may be incomplete when shortcuts or folders could not be read', async ({ page }) => {
  const problem = 'A folder could not be fully listed: Access to the path is denied.';
  await mock(page, { inspect: [{ ...UNREPAIRED, incomplete: [problem, '1 shortcut file could not be read, so it is unknown whether it belongs to Git Khronos.'] }, UNREPAIRED] });
  const dialog = await open(page);
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('this list may be incomplete');
  await expect(alert.getByRole('listitem')).toHaveCount(2);
  await expect(alert).toContainText(problem);
  await dialog.getByRole('button', { name: 'Check again' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('describes exactly which shortcut fields are compared before confirming', async ({ page }) => {
  await mock(page, { inspect: [UNREPAIRED] });
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Review possible repair…' }).click();
  await expect(dialog).toContainText('other shortcut data is not compared');
  await expect(dialog).toContainText('in a new folder under');
  await expect(dialog).not.toContainText('Everything else');
});

for (const repair of [
  { kind: 'windowsShortcutRepairFailed', message: 'A new backup of the shortcut could not be saved in %LOCALAPPDATA%\\Git Khronos\\Windows shortcut backups, so nothing was modified.', hint: 'Check that the folder is writable, then try again.' },
  { kind: 'windowsShortcutBackupDamaged', message: `The shortcut was updated, but the backup at ${BACKUP} no longer matches the original shortcut, so it cannot be used to undo the change.`, hint: 'Check the shortcuts again. If the shortcut does not work, unpin it and pin Git Khronos again from the Start Menu.' },
]) {
  test(`reports ${repair.kind} after confirming`, async ({ page }) => {
    await mock(page, { inspect: [UNREPAIRED], repair });
    const dialog = await open(page);
    await dialog.getByRole('button', { name: 'Review possible repair…' }).click();
    await dialog.getByRole('button', { name: 'Apply changes' }).click();
    await expect(dialog.getByRole('alert')).toContainText(repair.message);
    await expect(dialog.getByRole('alert')).toContainText(repair.hint);
    expect(await calls(page, 'repair_windows_shortcut')).toHaveLength(1);
  });
}