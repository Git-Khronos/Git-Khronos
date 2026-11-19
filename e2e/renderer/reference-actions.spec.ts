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
        if (['transport_reference', 'manage_reference', 'configure_remote', 'refresh_repository', 'rename_reference', 'create_tag', 'set_branch_upstream'].includes(command)) {
          if (command === 'rename_reference' && (window as any).__renameReferenceError) {
            return Promise.reject((window as any).__renameReferenceError);
          }
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

test('a stale tag editor cannot dispatch into a newly selected repository', async ({ page }) => {
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create tag here…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create tag at v0.1.0' });
  await dialog.getByLabel('Tag name', { exact: true }).fill('source-only');
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const other = { ...git.repository(), id: 'other-tag-repository', path: '/workspace/other-tag-repository' };
    git.repositories.update((repositories: any[]) => [...repositories, other]);
    git.activeRepositoryId.set(other.id);
    // Invoke before Angular's repository-change effect retires the old review.
    await app.submitTagCreation();
  });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__referenceCalls
    .filter((entry: any) => ['create_tag', 'manage_reference'].includes(entry.command)))).toEqual([]);
});

test('a stale upstream editor cannot change an identically named branch in another repository', async ({ page }) => {
  await page.locator('.branch-item').filter({ hasText: /^main/ }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Change upstream…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set upstream for main' });
  await expect(dialog.getByLabel('Upstream branch')).toHaveValue('origin/main');
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const other = { ...git.repository(), id: 'other-upstream-repository', path: '/workspace/other-upstream-repository' };
    git.repositories.update((repositories: any[]) => [...repositories, other]);
    git.activeRepositoryId.set(other.id);
    await app.confirmBranchUpstream('upstream/main');
  });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__referenceCalls
    .filter((entry: any) => entry.command === 'set_branch_upstream'))).toEqual([]);
});

test('source path changes retire a tag review even when the repository ID stays the same', async ({ page }) => {
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create tag here…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create tag at v0.1.0' });
  await dialog.getByLabel('Tag name', { exact: true }).fill('do-not-dispatch');
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.repositories.update((repositories: any[]) => repositories.map(repository =>
      repository.id === git.activeRepositoryId() ? { ...repository, path: '/workspace/changed-path' } : repository));
    await app.submitTagCreation();
  });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__referenceCalls
    .some((entry: any) => ['create_tag', 'manage_reference'].includes(entry.command)))).toBe(false);
});

test('valid tag and upstream reviews retain their original native command payloads', async ({ page }) => {
  const source = await page.evaluate(() => {
    const repository = (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository();
    return { id: repository.id, oid: repository.tags[0].oid };
  });
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create tag here…' }).click();
  const tag = page.getByRole('dialog', { name: 'Create tag at v0.1.0' });
  await tag.getByLabel('Tag name', { exact: true }).fill('new-local-tag');
  await tag.getByRole('button', { name: 'Create Tag', exact: true }).click();
  await expect(tag).toHaveCount(0);
  await page.locator('.branch-item').filter({ hasText: /^main/ }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Change upstream…' }).click();
  const upstream = page.getByRole('dialog', { name: 'Set upstream for main' });
  await upstream.getByLabel('Upstream branch').selectOption('upstream/main');
  await upstream.getByRole('button', { name: 'Set Upstream', exact: true }).click();
  await expect(upstream).toHaveCount(0);
  const writes = await page.evaluate(() => (window as any).__referenceCalls
    .filter((entry: any) => ['create_tag', 'set_branch_upstream'].includes(entry.command)));
  expect(writes).toEqual([
    { command: 'create_tag', args: { repoId: source.id, name: 'new-local-tag', oid: source.oid, message: null } },
    { command: 'set_branch_upstream', args: { repoId: source.id, branch: 'main', upstream: 'upstream/main' } },
  ]);
});

test('a completed tag write cannot close or clear a replacement draft', async ({ page }) => {
  await page.evaluate(() => {
    const host = window as any;
    const invoke = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = (command: string, args: any) => command === 'manage_reference'
      ? new Promise(resolve => { host.__finishOwnedTag = () => invoke(command, args).then(resolve); })
      : invoke(command, args);
  });
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Create tag here…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create tag at v0.1.0' });
  await dialog.getByLabel('Tag name', { exact: true }).fill('first-tag');
  await dialog.getByRole('radio', { name: /Annotated/ }).check();
  await dialog.getByLabel('Tag message', { exact: true }).fill('First annotation');
  await dialog.getByRole('checkbox', { name: 'Sign this tag with the configured Git key' }).check();
  await dialog.getByRole('button', { name: 'Create Tag', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishOwnedTag)).toBe('function');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.showTagCreator(app.git.repository().headOid, 'replacement review');
    app.contextTagName.set('keep-this-new-draft');
  });
  dialog = page.getByRole('dialog', { name: 'Create tag at replacement review' });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as any).__finishOwnedTag());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(dialog.getByLabel('Tag name', { exact: true })).toHaveValue('keep-this-new-draft');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).__referenceCalls
    .filter((entry: any) => entry.command === 'manage_reference'))).toHaveLength(1);
});

for (const mode of ['hold', 'fail'] as const) {
  test(`reference editor preserves a keyboard escape when its chunk ${mode === 'hold' ? 'loads late' : 'fails'}`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      if (!source.includes('TagCreationDialogComponent') || !source.includes('BranchUpstreamDialogComponent')) {
        await route.fulfill({ response, body: source }); return;
      }
      await held;
      if (mode === 'hold') await route.fulfill({ response, body: source });
      else await route.abort();
    });
    await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Create tag here…' }).click();
    const loading = page.getByRole('dialog', { name: 'Loading reference editor' });
    await expect(loading.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(loading.getByRole('button', { name: 'Cancel' })).toBeFocused();
    if (mode === 'hold') {
      await page.keyboard.press('Escape');
      await expect(loading).toHaveCount(0);
      release();
      await expect(page.getByRole('dialog', { name: 'Create tag at v0.1.0' })).toHaveCount(0);
    } else {
      release();
      const failed = page.getByRole('dialog', { name: 'Reference editor unavailable' });
      await expect(failed.getByRole('button', { name: 'Close' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(failed).toHaveCount(0);
    }
    expect(await page.evaluate(() => (window as any).__referenceCalls
      .filter((entry: any) => ['create_tag', 'manage_reference'].includes(entry.command)))).toEqual([]);
  });
}

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

test('tag rename validates the new name and can rename the remote copy after checking it', async ({ page }) => {
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const id = git.activeRepositoryId();
    git.repositories.update((repositories: any[]) => repositories.map((repository) => repository.id !== id ? repository : {
      ...repository,
      tags: [...repository.tags, { fullName: 'refs/tags/v0.2.0', name: 'v0.2.0', oid: repository.tags[0].oid }] }));
  });
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename tag…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Rename tag' });
  const name = dialog.getByLabel('New name', { exact: true });
  const confirm = dialog.getByRole('button', { name: 'Rename tag', exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('v0.1.0');
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByLabel('Remote', { exact: true })).toHaveCount(0);

  await name.fill('v0.2.0');
  await expect(dialog.getByRole('alert')).toHaveText('A tag with this name already exists.');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(confirm).toBeDisabled();
  await name.fill('bad..name');
  await expect(dialog.getByRole('alert')).toHaveText('Git does not allow this name.');
  await name.fill('release/v0.1.0');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(confirm).toBeEnabled();

  await dialog.getByRole('checkbox', { name: 'Also rename the tag on a remote' }).check();
  const remoteConfirm = dialog.getByRole('button', { name: 'Rename tag here and on remote', exact: true });
  await expect(remoteConfirm).toBeDisabled();
  await dialog.getByLabel('Remote', { exact: true }).selectOption('upstream');
  await dialog.getByRole('button', { name: 'Check remote tag' }).click();
  await expect(remoteConfirm).toBeEnabled();
  await remoteConfirm.click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => (window as any).__referenceCalls.find((call: any) => call.command === 'rename_reference'));
  expect(call.args).toMatchObject({ operationId: expect.any(String), request: {
    kind: 'tag', name: 'v0.1.0', newName: 'release/v0.1.0', remote: 'upstream', remoteObject: 'b'.repeat(40),
    expectedOid: expect.stringMatching(/^[0-9a-f]{40}$/),
  } });
});

test('local-only tag rename sends no remote and keeps the dialog open on failure', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__renameReferenceError = { kind: 'referenceExists', message: "A tag named 'v2' already exists." };
  });
  await page.getByRole('button', { name: 'Tag v0.1.0', exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename tag…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Rename tag' });
  await dialog.getByLabel('New name', { exact: true }).fill('v2');
  await dialog.getByLabel('New name', { exact: true }).press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await expect(dialog.getByLabel('New name', { exact: true })).toHaveValue('v2');
  const call = await page.evaluate(() => (window as any).__referenceCalls.find((call: any) => call.command === 'rename_reference'));
  expect(call.args.request).toMatchObject({ kind: 'tag', name: 'v0.1.0', newName: 'v2', remote: null, remoteObject: null });
  expect(await page.evaluate(() => (window as any).__referenceCalls.some((call: any) => call.command === 'preview_remote_tag'))).toBe(false);
});

test('remote branch rename pins the remote and commit and carries graph filters to the new name', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.hiddenBranches.set(['origin/docs', 'upstream/docs']);
    app.soloBranches.set([]);
  });
  const remote = page.getByRole('button', { name: 'Remote branch origin/docs', exact: true });
  await remote.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename branch on remote…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Rename branch on remote' });
  await expect(dialog.getByLabel('Remote', { exact: true })).toBeDisabled();
  await expect(dialog).toContainText('Expected remote commit');
  const name = dialog.getByLabel('New name', { exact: true });
  await name.fill('main');
  await expect(dialog.getByRole('alert')).toHaveText('This remote already has a branch with this name.');
  await name.fill('team/docs');
  await dialog.getByRole('button', { name: 'Rename remote branch', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return {
      call: (window as any).__referenceCalls.find((call: any) => call.command === 'rename_reference'),
      oid: app.git.repository().branches.find((branch: any) => branch.name === 'origin/docs').oid,
      hidden: app.hiddenBranches(),
    };
  });
  expect(result.call.args.request).toMatchObject({
    kind: 'remote-branch', remote: 'origin', name: 'docs', newName: 'team/docs', expectedOid: result.oid, remoteObject: null,
  });
  expect(result.hidden).toEqual(['origin/team/docs', 'upstream/docs']);
});
test('local branch rename carries hidden and pinned preferences to the new name', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.hiddenBranches.set(['feature/partial-staging', 'origin/docs']);
    app.soloBranches.set([]);
    app.pinnedBranch.set('feature/partial-staging');
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command !== 'rename_branch') return invoke(command, args);
      (window as any).__referenceCalls.push({ command, args });
      return Promise.resolve(app.git.repository());
    };
  });
  await page.getByRole('button', { name: 'Local branch feature/partial-staging' }).click({ button: 'right' });
  await page.getByLabel('Rename branch', { exact: true }).fill('feature/renamed');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__referenceCalls
    .some((call: any) => call.command === 'rename_branch'))).toBe(true);
  const result = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return {
      call: (window as any).__referenceCalls.find((call: any) => call.command === 'rename_branch'),
      hidden: app.hiddenBranches(),
      pinned: app.pinnedBranch(),
    };
  });
  expect(result.call.args).toMatchObject({ oldName: 'feature/partial-staging', newName: 'feature/renamed' });
  expect(result.hidden).toEqual(['feature/renamed', 'origin/docs']);
  expect(result.pinned).toBe('feature/renamed');
});

for (const editor of ['tag', 'upstream'] as const) {
  test(`a retired ${editor} editor cannot swallow the next global shortcut before its DOM is removed`, async ({ page }) => {
    if (editor === 'tag') {
      await page.keyboard.press('Control+P');
      await page.getByRole('combobox', { name: 'Search commands' }).fill('create tag');
      await page.getByRole('option').filter({ hasText: 'Create Tag' }).click();
    } else {
      await page.locator('.branch-item').filter({ hasText: /^main/ }).first().click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Change upstream…' }).click();
    }
    const dialog = page.getByRole('dialog', { name: editor === 'tag' ? /Create tag at/ : 'Set upstream for main' });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    // Deliver the next key in the closing DOM's lifetime, before Angular's
    // removal frame. No delays, forced rendering, or mutation command retries.
    const stillConnected = await dialog.evaluate(element => {
      const cancel = [...element.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.trim() === 'Cancel')!;
      cancel.click();
      cancel.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true, cancelable: true,
      }));
      return cancel.isConnected;
    });
    expect(stillConnected).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__referenceCalls
      .filter((entry: any) => ['create_tag', 'manage_reference', 'set_branch_upstream'].includes(entry.command)))).toEqual([]);
  });
}
