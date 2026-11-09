import { expect, test, type Page } from '@playwright/test';

const remote = 'git@example.test:owned/project.git';
const uri = 'git-khronos://repository?v=1&remote=git%40example.test%3Aowned%2Fproject.git';

async function prepare(page: Page, held: 'discover' | 'open' | 'create' | null = null) {
  page.on('pageerror', error => console.error('Owned link page error:', error.message));
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(({ remote, uri, held }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = { ...git.repository(), remotes: [{ name: 'origin', fetchUrl: remote, pushUrl: remote }] };
    git.repositories.set([repository]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'owned link test' }));
    const inspection = { link: { remote, target: { kind: 'repository' } }, path: repository.path,
      bare: false, matchedRemotes: ['origin'], target: { kind: 'repository' } };
    const state: any = { app, git, repository, inspection, calls: [], held, policies: {}, uri };
    (window as any).__links = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      const result = command === 'discover_repository_link' ? { link: inspection.link, inspectedPaths: args.knownPaths.length,
        matches: state.noMatch ? [] : [inspection], unavailable: [] }
        : command === 'open_repository_link' ? { repository, inspection }
          : command === 'create_repository_link' ? uri : null;
      if (command === 'repository_link_read_policies') {
        const policies = structuredClone(state.policies);
        return state.holdPolicies ? new Promise(resolve => { state.finishPolicies = () => resolve(policies); }) : Promise.resolve(policies);
      }
      if (command === 'resume_repository_link_auto_fetch') { state.policies[args.repoId] = { noLazyReads: true, autoFetchPaused: false }; return Promise.resolve(null); }
      if (command === 'cancel_git_operation') return Promise.resolve(true);
      if (command === 'discover_repository_link' && held === 'discover'
        || command === 'open_repository_link' && held === 'open'
        || command === 'create_repository_link' && held === 'create') return new Promise(resolve => { state.finish = () => resolve(result); });
      if (command === 'open_repository_link') state.policies[repository.id] = { noLazyReads: true, autoFetchPaused: true };
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      if (/^refresh_repository/.test(command)) return Promise.resolve(repository);
      if (command === 'open_repository' || command === 'clone_repository' || command === 'fetch_repository') return Promise.resolve(repository);
      if (result !== null) return Promise.resolve(result);
      return Promise.resolve(null);
    } };
  }, { remote, uri, held });
}
async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Open repository link');
  await page.getByRole('option', { name: /Open repository link/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Open repository link', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Repository link', exact: true }).fill(uri);
  return dialog;
}
async function shareDialog(page: Page) {
  await page.locator('.repo-tab').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share repository context…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Share repository context', exact: true });
}
async function calls(page: Page, command: string) {
  return page.evaluate(command => (window as any).__links.calls.filter((call: any) => call.command === command), command);
}

test('selects a known local copy explicitly and pauses only its automatic fetch schedule', async ({ page }) => {
  await prepare(page);
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Find local copies', exact: true }).click();
  await expect(dialog.getByText('Matched remotes: origin', { exact: true })).toBeVisible();
  expect(await calls(page, 'open_repository_link')).toHaveLength(0);
  expect((await calls(page, 'discover_repository_link'))[0].args.knownPaths.length).toBeLessThanOrEqual(32);
  await dialog.getByRole('button', { name: 'Open this local copy', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.auto-fetch-status')).toHaveText('Auto-fetch paused');
  expect(await calls(page, 'fetch_repository')).toHaveLength(0);
  await page.locator('.auto-fetch-status').click();
  await expect.poll(async () => (await calls(page, 'resume_repository_link_auto_fetch')).length).toBe(1);
  await expect(page.locator('.auto-fetch-status')).not.toHaveText('Auto-fetch paused');
  expect(await calls(page, 'fetch_repository')).toHaveLength(0);
});

test('manual fetch remains explicit while the link session automatic fetch stays paused', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).__links;
    state.git.repositoryLinkPolicies.set({ [state.repository.id]: { noLazyReads: true, autoFetchPaused: true } });
  });
  await expect(page.locator('.auto-fetch-status')).toHaveText('Auto-fetch paused');
  await page.getByRole('button', { name: 'Fetch all remotes', exact: true }).click();
  await expect.poll(async () => (await calls(page, 'fetch_repository')).length).toBe(1);
  expect(await calls(page, 'resume_repository_link_auto_fetch')).toHaveLength(0);
  await expect(page.locator('.auto-fetch-status')).toHaveText('Auto-fetch paused');
});

for (const phase of ['discover', 'open'] as const) {
  test(`closing during ${phase} cancels its request and ignores a late reply`, async ({ page }) => {
    await prepare(page, phase);
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: 'Find local copies', exact: true }).click();
    if (phase === 'open') await dialog.getByRole('button', { name: 'Open this local copy', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Cancel link operation', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close repository link', exact: true }).click();
    await expect.poll(async () => (await calls(page, 'cancel_git_operation')).length).toBe(1);
    await page.evaluate(() => (window as any).__links.finish());
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.auto-fetch-status')).not.toHaveText('Auto-fetch paused');
  });
}

test('editing the link invalidates a held lookup before its old result arrives', async ({ page }) => {
  await prepare(page, 'discover');
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Find local copies', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel link operation', exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Repository link', exact: true }).fill(uri + '&ref=refs%2Fheads%2Fother');
  await expect.poll(async () => (await calls(page, 'cancel_git_operation')).length).toBe(1);
  await page.evaluate(() => (window as any).__links.finish());
  await expect(dialog.getByRole('button', { name: 'Open this local copy', exact: true })).toHaveCount(0);
});

test('requires an explicit remote and generates the project-owned repository link', async ({ page }) => {
  await prepare(page);
  const dialog = await shareDialog(page);
  await expect(dialog.getByRole('button', { name: 'Create share link', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Link remote', exact: true }).selectOption(remote);
  await dialog.getByRole('button', { name: 'Create share link', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Share link', exact: true })).toHaveValue(uri);
  expect((await calls(page, 'create_repository_link'))[0].args).toEqual({ remote, target: { kind: 'repository' } });
  expect(await calls(page, 'open_repository_link')).toHaveLength(0);
  expect(await calls(page, 'clone_repository')).toHaveLength(0);
});

test('closing the source repository invalidates a held share result', async ({ page }) => {
  await prepare(page, 'create');
  const dialog = await shareDialog(page);
  await dialog.getByRole('combobox', { name: 'Link remote', exact: true }).selectOption(remote);
  await dialog.getByRole('button', { name: 'Create share link', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel link operation', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__links.git.repositories.set([]));
  await expect(dialog.getByText('Source repository is closed', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__links.finish());
  await expect(dialog.getByRole('textbox', { name: 'Share link', exact: true })).toHaveCount(0);
});

test('keeps clone review separate from normal drafts and does not download on lookup', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  const manual = page.getByRole('dialog', { name: 'Repository management', exact: true });
  await manual.getByRole('tab', { name: 'Clone', exact: true }).click();
  await manual.getByRole('textbox', { name: 'Repository URL', exact: true }).fill('https://manual.example.test/retained.git');
  await manual.getByRole('textbox', { name: 'Folder name', exact: true }).fill('retained-manual-folder');
  await manual.getByRole('button', { name: 'Close repository management', exact: true }).click();
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Find local copies', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review clone…', exact: true }).click();
  const clone = page.getByRole('dialog', { name: 'Repository management', exact: true });
  await expect(clone.getByRole('textbox', { name: 'Repository URL', exact: true })).toHaveValue(remote);
  await expect(clone.getByRole('tab', { name: 'Browse', exact: true })).toHaveCount(0);
  await expect(clone.getByRole('tab', { name: 'Initialize', exact: true })).toHaveCount(0);
  await expect(clone.getByRole('button', { name: 'Browse repositories on GitHub', exact: true })).toHaveCount(0);
  expect(await calls(page, 'clone_repository')).toHaveLength(0);
  await clone.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close repository link', exact: true })).toBeFocused();
  await expect(dialog.getByRole('textbox', { name: 'Repository link', exact: true })).toHaveValue(uri);
  await dialog.getByRole('button', { name: 'Close repository link', exact: true }).click();
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  await manual.getByRole('tab', { name: 'Clone', exact: true }).click();
  await expect(manual.getByRole('textbox', { name: 'Repository URL', exact: true })).toHaveValue('https://manual.example.test/retained.git');
  await expect(manual.getByRole('textbox', { name: 'Folder name', exact: true })).toHaveValue('retained-manual-folder');
});

for (const width of [360, 780, 1440]) {
  test(`keeps link controls within the viewport and keyboard focus inside at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await prepare(page);
    const dialog = await openDialog(page);
    await expect(dialog.getByRole('textbox', { name: 'Repository link', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Close repository link', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Command palette', exact: true })).toBeFocused();
  });
}


test('retains a missing target for review after opening its local repository without fetching', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).__links;
    state.inspection.link.target = { kind: 'reference', reference: 'refs/heads/unavailable-owned' };
    state.inspection.target = { kind: 'unavailable', message: 'The owned requested branch is unavailable locally.' };
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Find local copies', exact: true }).click();
  await expect(dialog.getByText('Shared target: refs/heads/unavailable-owned', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open this local copy', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The owned requested branch is unavailable locally.');
  await expect(dialog.getByRole('textbox', { name: 'Repository link', exact: true })).toHaveValue(uri);
  expect(await calls(page, 'fetch_repository')).toHaveLength(0);
  expect(await calls(page, 'checkout')).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Close repository link', exact: true }).click();
  await expect(page.locator('.auto-fetch-status')).toHaveText('Auto-fetch paused');
});

test('refuses late navigation after the active repository changes during opening', async ({ page }) => {
  await prepare(page, 'open');
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Find local copies', exact: true }).click();
  await dialog.getByRole('button', { name: 'Open this local copy', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel link operation', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = (window as any).__links;
    state.git.repositories.update((repositories: any[]) => [...repositories, { ...state.repository, id: 'owned-other-link-repository', path: '/owned/other-link' }]);
    state.git.activeRepositoryId.set('owned-other-link-repository');
    state.finish();
  });
  await expect(dialog.getByRole('alert')).toHaveText('The active repository changed. Review the local copy again.');
  expect(await page.evaluate(() => (window as any).__links.git.activeRepositoryId())).toBe('owned-other-link-repository');
});


test('recovers modal keyboard focus after a pending control loses focus', async ({ page }) => {
  await prepare(page, 'discover');
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Find local copies', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel link operation', exact: true })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close repository link', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await calls(page, 'cancel_git_operation')).length).toBe(1);
});


test('an older policy reply cannot undo explicit automatic-fetch resumption', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).__links;
    state.policies = { [state.repository.id]: { noLazyReads: true, autoFetchPaused: true } };
    state.git.repositoryLinkPolicies.set(structuredClone(state.policies));
    state.holdPolicies = true;
    state.refresh = state.git.refreshRepositoryLinkPolicies();
  });
  await expect(page.locator('.auto-fetch-status')).toHaveText('Auto-fetch paused');
  await page.locator('.auto-fetch-status').click();
  await expect.poll(async () => (await calls(page, 'resume_repository_link_auto_fetch')).length).toBe(1);
  await expect(page.locator('.auto-fetch-status')).not.toHaveText('Auto-fetch paused');
  await page.evaluate(async () => {
    const state = (window as any).__links;
    state.finishPolicies(); await state.refresh;
  });
  await expect(page.locator('.auto-fetch-status')).not.toHaveText('Auto-fetch paused');
});
