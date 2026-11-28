import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, ui = false): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async ui => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const repository = git.repository();
    const status = { ...repository.status, staged: 0, unstaged: 0, untracked: 0, conflicted: 2, entryCount: 2, mergeInProgress: true,
      entries: ['original.txt', 'new.txt'].map(path => ({ path, indexStatus: 'U', worktreeStatus: 'U', conflicted: true })) };
    const snapshot = { ...repository, status };
    git.repositories.set([snapshot, { ...snapshot, id: 'other-conflict', path: '/fixture/other-conflict' }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    let recoveryStarted!: () => void;
    const state: any = { app, git, snapshot, outcome: 'success', calls: [], holdRecovery: false,
      recoveryStarted: new Promise<void>(resolve => { recoveryStarted = resolve; }) };
    (window as any).__conflictLifecycle = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'load_more_changes') return Promise.resolve(status);
      if (command === 'inspect_conflict') return Promise.resolve({ path: args.path, ancestor: 'base\n', current: 'current\n', incoming: 'incoming\n',
        output: 'working conflict\n', binary: false, truncated: false, editable: true,
        state: `${args.path}-reviewed`, currentExists: true, incomingExists: true, submodule: false });
      if (command === 'resolve_conflict' || command === 'fetch_repository' || command === 'stage_path') return new Promise((resolve, reject) => {
        state.finish = () => state.outcome === 'success' || state.outcome === 'unrelated-error'
          ? resolve(command === 'stage_path' ? status : snapshot)
          : reject({ kind: state.outcome === 'cancelled' ? 'operationCancelled' : 'gitFailure', message: 'Resolution refused' });
      });
      if (command === 'refresh_repository') {
        if (state.outcome === 'dismissed-error') git.dismissError();
        if (state.holdRecovery) return new Promise(resolve => { state.finishRecovery = resolve; recoveryStarted(); });
        return Promise.resolve(snapshot);
      }
      if (command === 'refresh_repository_status') return Promise.resolve(status);
      if (command === 'open_repository_in_file_manager') return Promise.reject({ message: 'Unrelated folder opening failed' });
      return Promise.resolve(null);
    } };
    if (!ui) await git.inspectConflict('original.txt');
  }, ui);
}

for (const operation of ['merge', 'rebase', 'cherryPick', 'revert', 'mailPatch', 'none'] as const) {
  test(`show conflicted files is read-only during ${operation}`, async ({ page }) => {
    await prepare(page, true);
    await page.evaluate(operation => {
      const { app, git } = (window as any).__conflictLifecycle;
      git.repositories.update((repos: any[]) => repos.map(repo => repo.id !== git.activeRepositoryId() ? repo : {
        ...repo, status: { ...repo.status, operations: operation === 'none' ? [] : [{ kind: operation, editStopped: false, split: null, noCommit: false }] },
      }));
      app.setPanelVisibility('commit-panel', false);
      app.fileFilter.set('hidden-by-a-previous-filter');
      app.conflictedFilesOpen.set(false);
    }, operation);
    const nav = page.getByRole('group', { name: 'Conflict navigation' });
    await expect(nav.getByRole('status')).toHaveText('2 files need conflict resolution');
    const show = nav.getByRole('button', { name: 'Show conflicted files' });
    await show.focus();
    await show.press('Enter');
    const inspector = page.getByRole('complementary', { name: 'Working directory inspector' });
    const heading = inspector.getByRole('button', { name: 'Conflicted Files (2)' });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await expect(inspector.getByRole('button', { name: 'original.txt', exact: true })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'new.txt', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__conflictLifecycle.calls.filter((call: any) =>
      /^(inspect_conflict|resolve_conflict|abort_|continue_|skip_|stage_)/.test(call.command)))).toEqual([]);
  });
}

test('the compact conflict shortcut focuses pagination when Git has more conflicts than the loaded file list', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 640 });
  await prepare(page, true);
  await page.evaluate(() => {
    const { app, git } = (window as any).__conflictLifecycle;
    git.repositories.update((repos: any[]) => repos.map(repo => repo.id !== git.activeRepositoryId() ? repo : {
      ...repo, status: { ...repo.status, entries: [], entriesTruncated: true, conflicted: 2, entryCount: 1001 },
    }));
    app.setPanelVisibility('commit-panel', false);
  });
  const nav = page.getByRole('group', { name: 'Conflict navigation' });
  await expect(nav.getByRole('status')).toHaveText('2 files need conflict resolution');
  await nav.getByRole('button', { name: 'Show conflicted files' }).click();
  const inspector = page.getByRole('complementary', { name: 'Working directory inspector' });
  await expect(inspector).toContainText('Conflicted files are outside the loaded list');
  await expect(inspector.getByRole('button', { name: /Show 1,000 more files/ })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__conflictLifecycle.calls.some((call: any) =>
    call.command === 'load_more_changes'))).toBe(false);
  await inspector.getByRole('button', { name: /Show 1,000 more files/ }).press('Enter');
  await expect(inspector.getByRole('button', { name: 'Conflicted Files (2)', exact: true })).toBeFocused();
});

test('the conflict section distinguishes loaded conflicts from the repository total', async ({ page }) => {
  await prepare(page, true);
  await page.evaluate(() => {
    const { app, git } = (window as any).__conflictLifecycle;
    git.repositories.update((repos: any[]) => repos.map(repo => repo.id !== git.activeRepositoryId() ? repo : {
      ...repo, status: { ...repo.status, entries: repo.status.entries.slice(0, 1), conflicted: 2,
        entriesTruncated: true, entryCount: 1001 },
    }));
    app.setPanelVisibility('commit-panel', false);
  });
  await page.getByRole('button', { name: 'Show conflicted files' }).click();
  const inspector = page.getByRole('complementary', { name: 'Working directory inspector' });
  await expect(inspector.getByRole('button', { name: 'Conflicted Files (1 of 2)', exact: true })).toBeFocused();
  const hidden = inspector.getByText('More conflicted files are outside the loaded list.', { exact: false });
  await expect(hidden).toBeVisible();
  const loadMore = inspector.getByRole('button', { name: /Show 1,000 more files/ });
  await loadMore.focus();
  await loadMore.press('Enter');
  await expect(inspector.getByRole('button', { name: 'Conflicted Files (2)', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'new.txt', exact: true })).toBeVisible();
  await expect(hidden).toHaveCount(0);
  const mutations = await page.evaluate(() => (window as any).__conflictLifecycle.calls
    .filter((call: { command: string }) => /^(resolve_conflict|continue_merge|abort_merge)$/.test(call.command)));
  expect(mutations).toEqual([]);
});

test('filtering out every conflict keeps the conflict total visible', async ({ page }) => {
  await prepare(page, true);
  await page.getByRole('button', { name: 'Show conflicted files' }).click();
  const inspector = page.getByRole('complementary', { name: 'Working directory inspector' });
  await inspector.getByRole('searchbox', { name: 'Filter changed files' }).fill('no-matching-conflict');
  await expect(inspector.getByRole('button', { name: 'Conflicted Files (0 of 2)', exact: true })).toBeVisible();
  await expect(inspector.getByText('No loaded conflicts match the file filter.')).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Merge Tool' })).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Clear file filter' }).click();
  await expect(inspector.getByRole('button', { name: 'Conflicted Files (2)', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Merge Tool' })).toHaveCount(2);
});

test('the conflicted-file menu opens a review instead of resolving a side immediately', async ({ page }) => {
  await prepare(page, true);
  await page.getByRole('button', { name: 'Show conflicted files' }).click();
  await page.getByRole('button', { name: 'original.txt', exact: true }).click({ button: 'right' });
  const open = page.getByRole('menuitem', { name: 'Open Merge Tool', exact: true });
  await expect(open).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Take (current|incoming)$/i })).toHaveCount(0);
  await open.click();
  const review = page.getByRole('dialog', { name: 'Merge conflict editor' });
  await expect(review.getByRole('button', { name: 'Take Current', exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Take Incoming', exact: true })).toBeVisible();
  const commands = await page.evaluate(() => (window as any).__conflictLifecycle.calls
    .map((call: { command: string }) => call.command));
  expect(commands).toContain('inspect_conflict');
  expect(commands).not.toContain('resolve_conflict');
});

test('an outgoing conflict shortcut cannot open the inspector in another checkout visit', async ({ page }) => {
  await prepare(page, true);
  await page.evaluate(() => (window as any).__conflictLifecycle.app.setPanelVisibility('commit-panel', false));
  const show = page.getByRole('button', { name: 'Show conflicted files' });
  const opened = await show.evaluate((button: HTMLButtonElement) => {
    const { app, git } = (window as any).__conflictLifecycle;
    git.activeWorkspaceId.set('same-checkout-different-workspace');
    button.click();
    return app.detailsVisible();
  });
  expect(opened).toBe(false);
});

for (const outcome of ['success', 'error', 'dismissed-error', 'unrelated-error']) {
  for (const navigation of ['same', 'new-file', 'reopened']) {
    test(`conflict resolution ${outcome} preserves the ${navigation} editor lifecycle`, async ({ page }) => {
      await prepare(page);
      const result = await page.evaluate(async ({ outcome, navigation }) => {
        const state = (window as any).__conflictLifecycle;
        state.outcome = outcome;
        const pending = state.git.resolveConflict('original.txt', 'output', 'my resolution\n');
        if (navigation === 'new-file') await state.git.inspectConflict('new.txt');
        if (navigation === 'reopened') { state.git.closeConflict(); await state.git.inspectConflict('original.txt'); }
        const expected = state.git.conflictDetails();
        if (outcome === 'unrelated-error') await state.git.openRepositoryInFileManager('other-conflict');
        state.finish();
        const succeeded = await pending;
        return { succeeded, actual: state.git.conflictDetails(), expected,
          args: state.calls.find((call: any) => call.command === 'resolve_conflict').args };
      }, { outcome, navigation });
      expect(result.actual).toEqual(navigation === 'same' && ['success', 'unrelated-error'].includes(outcome) ? null : result.expected);
      expect(result.succeeded).toBe(['success', 'unrelated-error'].includes(outcome));
      expect(result.args).toMatchObject({ path: 'original.txt', expectedState: 'original.txt-reviewed', output: 'my resolution\n' });
    });
  }
}

for (const operation of ['metadata', 'working-tree']) {
  for (const outcome of ['success', 'error', 'cancelled']) {
    test(`${operation} ${outcome} completion preserves a newer conflict editor`, async ({ page }) => {
      await prepare(page);
      const result = await page.evaluate(async ({ outcome, operation }) => {
        const state = (window as any).__conflictLifecycle;
        state.outcome = outcome;
        const pending = operation === 'metadata' ? state.git.remote('fetch_repository') : state.git.stagePath('original.txt');
        await state.git.inspectConflict('new.txt');
        const expected = state.git.conflictDetails();
        state.finish();
        await pending;
        return { actual: state.git.conflictDetails(), expected };
      }, { outcome, operation });
      expect(result.actual).toEqual(result.expected);
    });
  }
}

for (const scenario of ['dismissed-error', 'replacement-editor', 'unrelated-error']) {
  test(`conflict UI retains the right draft and focus during ${scenario}`, async ({ page }) => {
    await prepare(page, true);
    const opener = page.getByTitle('Open Merge Tool for original.txt', { exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Merge conflict editor', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Resolved output for original.txt', exact: true }).fill('original edited draft\n');
    await page.evaluate(scenario => {
      const state = (window as any).__conflictLifecycle;
      state.outcome = scenario === 'replacement-editor' ? 'error' : scenario;
      state.holdRecovery = scenario === 'replacement-editor';
      state.pending = state.app.resolveOpenConflict('output');
    }, scenario);
    if (scenario === 'unrelated-error') await page.evaluate(async () => {
      await (window as any).__conflictLifecycle.git.openRepositoryInFileManager('other-conflict');
    });
    await page.evaluate(() => (window as any).__conflictLifecycle.finish());
    if (scenario === 'replacement-editor') {
      await page.evaluate(() => (window as any).__conflictLifecycle.recoveryStarted);
      await dialog.getByRole('button', { name: 'Close conflict editor', exact: true }).click();
      await page.getByTitle('Open Merge Tool for new.txt', { exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Resolved output for new.txt', exact: true }).fill('new edited draft\n');
      await page.evaluate(() => {
        const state = (window as any).__conflictLifecycle;
        state.finishRecovery(state.snapshot);
      });
    }
    await page.evaluate(() => (window as any).__conflictLifecycle.pending);
    if (scenario === 'unrelated-error') {
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(await page.evaluate(() => (window as any).__conflictLifecycle.git.error())).toBe('Unrelated folder opening failed');
    } else {
      const output = dialog.getByRole('textbox', { name: `Resolved output for ${scenario === 'replacement-editor' ? 'new' : 'original'}.txt`, exact: true });
      await expect(output).toHaveValue(scenario === 'replacement-editor' ? 'new edited draft\n' : 'original edited draft\n');
      if (scenario === 'replacement-editor') await expect(output).toBeFocused();
    }
  });
}

for (const mode of ['late', 'failure'] as const) {
  test(`conflict editor ${mode} import cannot write or reopen a dismissed request`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let settle!: () => void;
    const settled = new Promise<void>(resolve => { settle = resolve; });
    let requests = 0;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      if (!/\bclass\s+_?ConflictEditorComponent\b/.test(source)) {
        await route.fulfill({ response, body: source });
        return;
      }
      requests++;
      await held;
      if (mode === 'failure') await route.abort();
      else await route.fulfill({ response, body: source });
      settle();
    });
    try {
      await prepare(page, true);
      expect(requests).toBe(0);
      const opener = page.getByTitle('Open Merge Tool for original.txt', { exact: true });
      const loading = page.getByRole('dialog', { name: 'Opening merge conflict editor', exact: true });
      const failed = page.getByRole('dialog', { name: 'Merge conflict editor unavailable', exact: true });
      await opener.click();
      await expect.poll(() => requests).toBe(1);
      await expect(loading.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(loading.getByRole('button', { name: 'Cancel' })).toBeFocused();
      if (mode === 'failure') {
        release();
        await expect(failed.getByRole('alert')).toContainText('No file was changed.');
        await expect(failed.getByRole('button', { name: 'Close' })).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(loading).toHaveCount(0);
      await expect(failed).toHaveCount(0);
      await expect(opener).toBeFocused();
      release();
      await settled;
      await expect(page.getByRole('dialog', { name: 'Merge conflict editor', exact: true })).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(await page.evaluate(() => (window as any).__conflictLifecycle.calls.filter(
        (call: { command: string }) => call.command === 'resolve_conflict'))).toEqual([]);
    } finally { release(); }
  });
}
