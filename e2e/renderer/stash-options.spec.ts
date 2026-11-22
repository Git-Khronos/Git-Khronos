import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    (window as any).__stashCalls = [];
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        (window as any).__stashCalls.push({ command, args });
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        if (['stash_selected', 'apply_stash_options', 'branch_from_stash', 'stash_checkout', 'refresh_repository'].includes(command)) {
          return Promise.resolve(git.repository());
        }
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

test('opens advanced stash controls from the toolbar and restores focus', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Stash options' });
  await toggle.click();
  const menu = page.getByRole('menu', { name: 'Stash options' });
  await menu.getByRole('menuitem', { name: /Stash with options/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash with options' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('the keyboard palette opens a non-mutating stash review and returns focus on Escape', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Command palette', exact: true });
  await opener.focus();
  await opener.press('Enter');
  const search = page.getByRole('combobox', { name: 'Search commands', exact: true });
  await search.fill('stash with options');
  await expect(page.getByRole('option', { name: /^Stash with options/ })).toBeEnabled();
  await search.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Stash with options' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog.getByLabel('Changes to save')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => (window as any).__stashCalls.filter((call: any) =>
    call.command === 'stash_changes' || call.command === 'stash_selected'))).toEqual([]);
});

for (const branch of [false, true]) {
  test(`the palette reviews ${branch ? 'a new branch from' : 'a staged-state apply for'} a specific stash before dispatch`, async ({ page }) => {
    const selectedOid = 'b'.repeat(40);
    await page.evaluate(({ selectedOid, branch }) => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repo = git.repository();
      git.repositories.set([{ ...repo, stashes: [
        { reference: 'stash@{0}', oid: 'a'.repeat(40), message: 'Latest work' },
        { reference: 'stash@{1}', oid: selectedOid, message: 'Earlier work' },
      ], status: branch ? { ...repo.status, entryCount: 0, entries: [], staged: 0, unstaged: 0, untracked: 0 } : repo.status }]);
    }, { selectedOid, branch });
    const opener = page.getByRole('button', { name: 'Command palette', exact: true });
    await opener.click();
    const search = page.getByRole('combobox', { name: 'Search commands', exact: true });
    await search.fill(branch ? 'create branch from stash@{1}' : 'review applying stash@{1}');
    const option = page.getByRole('option', { name: branch ? /^Create branch from stash@\{1\}/ : /^Review applying stash@\{1\}/ });
    await expect(option).toBeEnabled();
    await search.press('Enter');
    const dialog = page.getByRole('dialog', { name: branch ? 'Create branch from stash' : 'Apply stash' });
    await expect(dialog).toContainText('Earlier work');
    const command = branch ? 'branch_from_stash' : 'apply_stash_options';
    const dispatched = () => page.evaluate(command => (window as any).__stashCalls.filter((call: any) => call.command === command), command);
    expect(await dispatched()).toEqual([]);
    if (branch) await dialog.getByLabel('New branch name').fill('restore-earlier');
    else await dialog.getByLabel('Restore which changes were staged').check();
    await dialog.getByRole('button', { name: branch ? 'Create branch and restore' : 'Apply and keep stash' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await dispatched()).toEqual([{ command, args: {
      repoId: expect.any(String), reference: 'stash@{1}', expectedOid: selectedOid,
      ...(branch ? { name: 'restore-earlier' } : { restoreIndex: true }),
    } }]);
  });
}

test('a captured palette stash review does not follow a shifted reference or checkout', async ({ page }) => {
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
    git.repositories.set([{ ...git.repository(), stashes: [{ reference: 'stash@{0}', oid: 'a'.repeat(40), message: 'Earlier work' }] }]);
  });
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands', exact: true }).fill('review applying stash@{0}');
  await expect(page.getByRole('option', { name: /^Review applying stash@\{0\}/ })).toBeEnabled();
  const result = await page.evaluate(async () => {
    const root = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const palette = (window as any).ng.getComponent(document.querySelector('gc-command-palette'));
    const git = root.git;
    const repo = git.repository();
    const apply = palette.commandActions().find((action: any) => action.stashReview?.action === 'apply');
    git.repositories.set([{ ...repo, stashes: [{ ...repo.stashes[0], oid: 'b'.repeat(40) }] }]);
    await root.runCommand(apply);
    const shifted = root.stashDialog();
    git.repositories.set([{ ...repo, path: '/tmp/other-checkout' }]);
    await root.runCommand(apply);
    return { shifted, otherCheckout: root.stashDialog() };
  });
  expect(result).toEqual({ shifted: null, otherCheckout: null });
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
});

test('selected stash options disclose staged state and send only chosen paths', async ({ page }) => {
  const path = 'apps/desktop/src/app/app.component.html';
  const opener = page.getByRole('button', { name: 'Working directory options', exact: true });
  await opener.click();
  await page.getByRole('menuitem', { name: /^Stash with options/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash with options' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog.getByLabel('Stash source')).toContainText('main4 changed filesHEAD');
  await expect(dialog.getByRole('button', { name: 'Create stash' })).toHaveClass(/primary/);
  await dialog.getByLabel('Message').fill('Selected work');
  await dialog.getByLabel('Changes to save').selectOption('keep-index');
  await expect(dialog).toContainText('staged contents remain');
  await dialog.getByLabel('Include untracked files').uncheck();
  await dialog.getByText('Choose specific files', { exact: true }).click();
  await dialog.getByLabel('Save only selected files').check();
  await expect(dialog.getByRole('button', { name: 'Create stash' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: `Stash ${path}`, exact: true }).check();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).stashDialog().returnFocus
    === document.querySelector('[aria-label="Working directory options"]'))).toBe(true);
  await dialog.getByRole('button', { name: 'Create stash' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__stashCalls.find((call: any) => call.command === 'stash_selected')))
    .toEqual({ command: 'stash_selected', args: { repoId: expect.any(String), options: {
      mode: 'keep-index', includeUntracked: false, paths: [path], message: 'Selected work',
    } } });
  await expect(opener).toBeFocused();
});

test('staged-only mode excludes untracked files and keeps escape inside the workflow', async ({ page }) => {
  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Stash with options/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash with options' });
  await dialog.getByLabel('Changes to save').selectOption('staged-only');
  await expect(dialog.getByLabel('Include untracked files')).not.toBeChecked();
  await expect(dialog.getByLabel('Include untracked files')).toBeDisabled();
  await expect(dialog).toContainText('overlapping changes may be refused');
  await dialog.getByRole('button', { name: 'Create stash' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Message')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('stash selections follow the mode and do not send hidden or ineligible paths', async ({ page }) => {
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repo = git.repository();
    const entries = [
      { path: 'staged.rs', indexStatus: 'M', worktreeStatus: ' ', conflicted: false },
      { path: 'dirty.rs', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
      { path: 'new notes.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false },
    ];
    git.repositories.update((repos: any[]) => repos.map(item => item.id === repo.id
      ? { ...repo, status: { ...repo.status, entries, entryCount: 3, staged: 1, unstaged: 1, untracked: 1, conflicted: 0 } } : item));
  });
  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Stash with options/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash with options' });
  const mode = dialog.getByLabel('Changes to save');
  const untracked = dialog.getByLabel('Include untracked files');
  const create = dialog.getByRole('button', { name: 'Create stash' });
  const dirtyPath = dialog.getByRole('checkbox', { name: 'Stash dirty.rs', exact: true });
  const newPath = dialog.getByRole('checkbox', { name: 'Stash new notes.txt', exact: true });
  const stagedPath = dialog.getByRole('checkbox', { name: 'Stash staged.rs', exact: true });
  await dialog.getByText('Choose specific files', { exact: true }).click();
  await dialog.getByLabel('Save only selected files').check();
  await dialog.getByRole('button', { name: 'Select all eligible files' }).click();
  await expect(dialog).toContainText('3 of 3 eligible files selected');
  await untracked.uncheck();
  await expect(newPath).toHaveCount(0);
  await expect(dialog).toContainText('2 of 2 eligible files selected');
  await mode.selectOption('staged-only');
  await expect(dirtyPath).toHaveCount(0);
  await expect(dialog).toContainText('1 of 1 eligible files selected');
  await mode.selectOption('all');
  await expect(untracked).not.toBeChecked();
  await expect(dirtyPath).not.toBeChecked();
  await expect(stagedPath).toBeChecked();
  await dialog.getByRole('button', { name: 'Clear selection' }).click();
  await expect(create).toBeDisabled();
  await mode.selectOption('staged-only');
  await dialog.getByRole('button', { name: 'Select all eligible files' }).click();
  await create.click();
  await expect(dialog).toHaveCount(0);
  const saves = await page.evaluate(() => (window as any).__stashCalls.filter((call: any) => call.command === 'stash_selected'));
  expect(saves).toEqual([{ command: 'stash_selected', args: { repoId: expect.any(String), options: {
    mode: 'staged-only', includeUntracked: false, paths: ['staged.rs'], message: '',
  } } }]);
});

test('apply options restore the index using the selected immutable stash', async ({ page }) => {
  const row = page.locator('.commit-row.stash-row').first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Apply with staged-state options…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply stash' });
  await expect(dialog.getByLabel('Restore which changes were staged')).toBeChecked();
  await expect(dialog).toContainText('The stash is kept');
  await dialog.getByRole('button', { name: 'Apply and keep stash' }).click();
  const result = await page.evaluate(() => ({
    call: (window as any).__stashCalls.find((call: any) => call.command === 'apply_stash_options'),
    stash: (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().stashes[0],
  }));
  expect(result.call).toEqual({ command: 'apply_stash_options', args: {
    repoId: expect.any(String), reference: result.stash.reference, expectedOid: result.stash.oid, restoreIndex: true,
  } });
});

test('stash branch recovery requires a clean working directory', async ({ page }) => {
  await page.locator('.commit-row.stash-row').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create branch from stash…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create branch from stash' });
  await dialog.getByLabel('New branch name').fill('recover/my-work');
  await expect(dialog.getByRole('button', { name: 'Create branch and restore' })).toBeDisabled();
  await expect(dialog).toContainText('Requires a clean working directory');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((repos: any[]) => repos.map(repo => ({
      ...repo, status: { ...repo.status, entryCount: 0, entries: [], staged: 0, unstaged: 0, untracked: 0 },
    })));
  });
  await dialog.getByRole('button', { name: 'Create branch and restore' }).click();
  expect(await page.evaluate(() => (window as any).__stashCalls.find((call: any) => call.command === 'branch_from_stash').args.name))
    .toBe('recover/my-work');
});

test('stash-and-switch is explicit and leases both branch tips', async ({ page }) => {
  await page.getByLabel('Local branch feature/partial-staging', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Stash changes and checkout…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash and switch branch' });
  await expect(dialog).toContainText('does not automatically apply');
  await dialog.getByRole('button', { name: 'Stash and checkout' }).click();
  const args = await page.evaluate(() => (window as any).__stashCalls.find((call: any) => call.command === 'stash_checkout').args);
  expect(args).toMatchObject({ name: 'feature/partial-staging', expectedHead: expect.stringMatching(/^[0-9a-f]{40}$/),
    expectedTarget: expect.stringMatching(/^[0-9a-f]{40}$/) });
});
