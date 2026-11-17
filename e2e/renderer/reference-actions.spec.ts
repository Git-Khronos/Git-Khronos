import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    app.tagsOpen.set(true);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__referenceCalls = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        (window as any).__referenceCalls.push({ command, args });
        if (command === 'preview_remote_tag') return Promise.resolve('b'.repeat(40));
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        if (['transport_reference', 'manage_reference', 'configure_remote', 'refresh_repository'].includes(command)) {
          if (command === 'manage_reference' && (window as any).__referenceSigningError) {
            return Promise.reject({ kind: 'gitFailure', message: 'Configured signing key or tag signature unavailable.' });
          }
          if ((window as any).__referenceError && command === 'transport_reference') {
            return Promise.reject({ kind: 'gitFailure', message: 'Remote reference moved; deletion rejected.' });
          }
          return Promise.resolve(git.repository());
        }
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

test('signed tag refusal preserves the annotation and opt-in for explicit retry', async ({ page }) => {
  await page.evaluate(() => { (window as any).__referenceSigningError = true; });
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create tag here…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create tag at v0.1.0' });
  await dialog.getByLabel('Tag name', { exact: true }).fill('signed-release');
  await dialog.getByRole('radio', { name: /Annotated/ }).check();
  await dialog.getByLabel('Tag message', { exact: true }).fill('Release annotation retained on failure');
  await dialog.getByRole('checkbox', { name: 'Sign this tag with the configured Git key' }).check();
  await dialog.getByRole('button', { name: 'Create Tag', exact: true }).click();
  await expect(page.locator('.error-toast')).toContainText('signing key or tag signature unavailable');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Tag name', { exact: true })).toHaveValue('signed-release');
  await expect(dialog.getByLabel('Tag message', { exact: true })).toHaveValue('Release annotation retained on failure');
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  expect(await page.evaluate(() => (window as any).__referenceCalls
    .filter((call: any) => ['manage_reference', 'create_tag', 'transport_reference'].includes(call.command))))
    .toEqual([expect.objectContaining({ command: 'manage_reference', args: expect.objectContaining({
      action: 'signed-tag', name: 'signed-release', message: 'Release annotation retained on failure',
      expectedOid: expect.stringMatching(/^[0-9a-f]{40}$/),
    }) })]);
  await page.evaluate(() => { (window as any).__referenceSigningError = false; });
  await dialog.getByRole('button', { name: 'Create Tag', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const attempts = await page.evaluate(() => (window as any).__referenceCalls
    .filter((call: any) => call.command === 'manage_reference'));
  expect(attempts).toHaveLength(2);
  expect(attempts[1].args).toEqual(attempts[0].args);
});

for (const refused of [false, true]) {
  test(`tag verification ${refused ? 'refusal' : 'success'} reports Git's result without tag transport`, async ({ page }) => {
    await page.evaluate(value => { (window as any).__referenceSigningError = value; }, refused);
    await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Verify tag signature' }).click();
    if (refused) {
      await expect(page.locator('.error-toast')).toContainText('tag signature unavailable');
      await expect(page.getByText('Tag signature verified by Git', { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText('Tag signature verified by Git', { exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => (window as any).__referenceCalls
      .filter((call: any) => ['manage_reference', 'transport_reference', 'create_tag'].includes(call.command))))
      .toEqual([expect.objectContaining({ command: 'manage_reference',
        args: expect.objectContaining({ action: 'verify-tag', name: 'v0.1.0' }) })]);
  });
}

test('selected tag push chooses one remote and pins the displayed target', async ({ page }) => {
  const tag = page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first();
  await tag.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Push this tag…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Push selected tag' });
  await expect(dialog).toContainText('Other tags and branches are unchanged');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByLabel('Remote', { exact: true }).selectOption('upstream');
  await dialog.getByRole('button', { name: 'Push tag' }).click();
  const result = await page.evaluate(() => ({
    call: (window as any).__referenceCalls.find((call: any) => call.command === 'transport_reference'),
    tag: (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().tags[0],
  }));
  expect(result.call.args).toMatchObject({ request: { remote: 'upstream', name: 'v0.1.0', kind: 'tag',
    delete: false, expectedOid: result.tag.oid }, operationId: expect.any(String) });
  await expect(dialog).toHaveCount(0);
  await expect(tag).toBeFocused();
});

test('compact reference confirmation separates its field and wraps its actions', async ({ page }) => {
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete tag on remote…', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete tag on remote', exact: true });
  await page.getByRole('button', { name: 'Check remote tag', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 650 });
  await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).setZoom(200));
  expect(await dialog.getByLabel('Remote', { exact: true }).evaluate(select => {
    const label = (select as HTMLSelectElement).labels![0];
    return select.getBoundingClientRect().top - label.getBoundingClientRect().bottom;
  })).toBeGreaterThanOrEqual(6);
  expect(await dialog.locator('footer').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('button')].every(button => {
      const action = button.getBoundingClientRect();
      return action.left >= bounds.left - 1 && action.right <= bounds.right + 1;
    });
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).__referenceCalls
    .some((call: any) => call.command === 'transport_reference'))).toBe(false);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

for (const mode of ['cancel', 'failure'] as const) {
  test(`deferred Git action ${mode} restores its opener without transporting a reference`, async ({ page }) => {
    let finished!: () => void;
    const chunkFinished = new Promise<void>(resolve => { finished = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      const actionChunk = text.includes('Push selected tag') && text.includes('data-reference-cancel');
      if (actionChunk && mode === 'failure') await route.abort();
      else {
        if (actionChunk) await new Promise(resolve => setTimeout(resolve, 1500));
        await route.fulfill({ response, body: text });
      }
      if (actionChunk) finished();
    });
    const opener = page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first();
    await opener.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Push this tag…' }).click();
    const panel = page.getByRole('dialog', { name: mode === 'cancel' ? 'Loading Git action' : 'Git action unavailable', exact: true });
    await expect(panel.getByRole('button', { name: mode === 'cancel' ? 'Cancel' : 'Close', exact: true })).toBeFocused();
    if (mode === 'failure') await expect(panel.getByRole('alert')).toContainText('No command was run');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
    await chunkFinished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.getByRole('alertdialog', { name: 'Push selected tag', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__referenceCalls.some((call: any) => call.command === 'transport_reference'))).toBe(false);
  });
}

test('remote tag deletion requires a fresh exact-object preview per destination', async ({ page }) => {
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete tag on remote…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete tag on remote' });
  const confirm = dialog.getByRole('button', { name: 'Delete remote reference' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check remote tag' }).click();
  await expect(confirm).toBeEnabled();
  await dialog.getByLabel('Remote', { exact: true }).selectOption('upstream');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check remote tag' }).click();
  await expect(dialog).toContainText('b'.repeat(40));
  await confirm.click();
  const call = await page.evaluate(() => (window as any).__referenceCalls.find((call: any) => call.command === 'transport_reference'));
  expect(call.args.request).toMatchObject({ remote: 'upstream', name: 'v0.1.0', kind: 'tag', delete: true, expectedOid: 'b'.repeat(40) });
});

test('local deletion states its protected recovery scope', async ({ page }) => {
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete tag locally…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete local tag' });
  await expect(dialog).toContainText('Remote tags and working files are unchanged');
  await expect(dialog).toContainText('recovery reference');
  await dialog.getByRole('button', { name: 'Delete local tag' }).click();
  const call = await page.evaluate(() => (window as any).__referenceCalls.find((call: any) => call.command === 'manage_reference'));
  expect(call.args).toMatchObject({ action: 'delete-tag', name: 'v0.1.0', expectedOid: expect.stringMatching(/^[0-9a-f]{40}$/) });
});

test('stale remote deletion stays open with an actionable native error', async ({ page }) => {
  await page.evaluate(() => { (window as any).__referenceError = true; });
  const remote = page.getByRole('button', { name: 'Remote branch origin/main', exact: true });
  await remote.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete branch on remote…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete branch on remote' });
  await expect(dialog.getByLabel('Remote', { exact: true })).toBeDisabled();
  await expect(dialog).toContainText('Expected remote commit');
  await dialog.getByRole('button', { name: 'Delete remote reference' }).click();
  await expect(dialog.getByRole('alert')).toContainText('deletion rejected');
  const call = await page.evaluate(() => (window as any).__referenceCalls.find((call: any) => call.command === 'transport_reference'));
  expect(call.args.request).toMatchObject({ remote: 'origin', name: 'main', kind: 'branch', delete: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('separate push URLs are advanced and save both destinations in one operation', async ({ page }) => {
  await page.getByLabel('Edit remote origin').click();
  const dialog = page.getByRole('dialog', { name: 'Edit Remote' });
  await expect(dialog.getByLabel('Push URL', { exact: true })).toBeHidden();
  await dialog.getByText('Advanced: separate push destination', { exact: true }).click();
  await dialog.getByLabel('Push URL', { exact: true }).fill('/local/push-destination.git');
  await dialog.getByRole('button', { name: 'Save Remote' }).click();
  const call = await page.evaluate(() => (window as any).__referenceCalls.find((call: any) => call.command === 'configure_remote'));
  expect(call.args).toMatchObject({ name: 'origin', pushUrl: '/local/push-destination.git', changePush: true, add: false });
});

test('renaming a remote saves URL changes in one operation and keeps its preferences', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    (window as any).__renameFailure = null;
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command !== 'configure_remote' || !args.previousName) return invoke(command, args);
      (window as any).__referenceCalls.push({ command, args });
      if ((window as any).__renameFailure) return Promise.reject((window as any).__renameFailure);
      const repository = git.repository();
      const previous = `${args.previousName}/`;
      const rename = (name: string | null) => name?.startsWith(previous) ? `${args.name}/${name.slice(previous.length)}` : name;
      return Promise.resolve({
        ...repository,
        remotes: repository.remotes.map((remote: any) => remote.name === args.previousName
          ? { name: args.name, fetchUrl: args.fetchUrl, pushUrl: args.pushUrl ?? args.fetchUrl }
          : remote),
        branches: repository.branches.map((branch: any) => ({
          ...branch,
          name: branch.remote ? rename(branch.name) : branch.name,
          fullName: branch.remote ? `refs/remotes/${rename(branch.name)}` : branch.fullName,
          upstream: rename(branch.upstream),
        })),
      });
    };
  });

  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.hiddenBranches.set(['origin/docs', 'upstream/main']);
  });
  await page.getByRole('region', { name: 'Remote origin' })
    .getByRole('button', { name: 'Collapse remote origin' }).click();
  await page.getByLabel('Edit remote origin').click();
  const dialog = page.getByRole('dialog', { name: 'Edit Remote' });
  const name = dialog.getByLabel('Name', { exact: true });
  const save = dialog.getByRole('button', { name: 'Save Remote' });
  await expect(name).toBeEditable();

  await name.fill('upstream');
  await expect(dialog.getByRole('alert')).toHaveText('Another remote already uses this name.');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(save).toBeDisabled();

  await page.evaluate(() => {
    (window as any).__renameFailure = { kind: 'invalidRemoteName', message: "'bad name' cannot be used as a remote name." };
  });
  await name.fill('bad name');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('.error-toast')).toContainText('cannot be used as a remote name');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Fetch and push destinations for origin');
  await expect(page.getByRole('region', { name: 'Remote origin' })).toBeVisible();

  await page.evaluate(() => { (window as any).__renameFailure = null; });
  await name.fill('team/primary');
  await dialog.getByLabel('Fetch URL').fill('/local/renamed.git');
  await dialog.getByLabel('Remote location icon').selectOption('globe');
  await save.click();
  await expect(dialog).toHaveCount(0);

  const calls = await page.evaluate(() => (window as any).__referenceCalls
    .filter((call: any) => call.command === 'configure_remote' || call.command === 'set_remote_url'));
  expect(calls.at(-1).args).toMatchObject({
    previousName: 'origin', name: 'team/primary', fetchUrl: '/local/renamed.git', changePush: false, add: false,
  });
  expect(calls.filter((call: any) => call.command === 'set_remote_url')).toEqual([]);
  await expect(page.getByLabel('Edit remote origin')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Remote team/primary' })
    .getByRole('button', { name: 'Expand remote team/primary' })).toHaveAttribute('aria-expanded', 'false');
  const preferences = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return { icons: app.remoteLocationIcons(), collapsed: app.collapsedRemoteLocations(), hidden: app.hiddenBranches() };
  });
  expect(preferences.hidden).toEqual(['team/primary/docs', 'upstream/main']);
  expect(preferences.icons).toMatchObject({ 'team/primary': 'globe' });
  expect(preferences.icons).not.toHaveProperty('origin');
  expect(preferences.collapsed).not.toContain('origin');
  expect(preferences.collapsed).toContain('team/primary');
});
