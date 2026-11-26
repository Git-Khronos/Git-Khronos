import { expect, test, type Page } from '@playwright/test';

const path = 'apps/desktop/src/app/app.component.html';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
});

test('collapsing Staged Files docks its header and expands the virtualized Unstaged Files list', { tag: '@daily-driver-smoke' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repo = git.repository();
    const entries = Array.from({ length: 60 }, (_, index) => ({
      path: `changed-${String(index).padStart(2, '0')}.txt`, indexStatus: ' ', worktreeStatus: 'M', conflicted: false,
    }));
    entries.push({ path: 'staged.txt', indexStatus: 'M', worktreeStatus: ' ', conflicted: false });
    git.repositories.set([{ ...repo, status: { ...repo.status, staged: 1, unstaged: 60, untracked: 0, conflicted: 0,
      entryCount: entries.length, entries, entriesTruncated: false } }]);
  });
  const list = page.getByRole('region', { name: 'Unstaged files', exact: true });
  const staged = page.getByRole('button', { name: 'Staged Files (1)', exact: true });
  const height = () => list.evaluate(element => element.clientHeight);
  await expect(page.getByRole('button', { name: 'View changes in changed-00.txt' })).toBeVisible();
  await page.getByRole('separator', { name: 'Resize Unstaged Files section' }).press('ArrowDown');
  const initialHeight = await height();
  await staged.press('Enter');
  await expect(staged).toBeFocused();
  await expect(staged).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(height).toBeGreaterThan(initialHeight);
  const distanceFromBottom = () => staged.evaluate(button => {
    const panel = button.closest('.working-tree-scroll')!;
    return Math.abs(panel.getBoundingClientRect().bottom - button.closest('section')!.getBoundingClientRect().bottom);
  });
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  const wideHeight = await height();
  await page.setViewportSize({ width: 1280, height: 820 });
  await expect.poll(height).toBeLessThan(wideHeight);
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repo = git.repository();
    git.repositories.set([{ ...repo, status: { ...repo.status, entriesTruncated: true } }]);
  });
  await expect(page.getByRole('button', { name: /Show 1,000 more files/ })).toBeVisible();
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await list.press('End');
  await expect(list).toBeFocused();
  await expect(list.getByRole('button', { name: 'View changes in changed-59.txt' })).toBeInViewport();
  await list.press('Home');
  await expect(list).toBeFocused();
  await expect(list.getByRole('button', { name: 'View changes in changed-00.txt' })).toBeInViewport();
  await staged.press('Enter');
  await expect(staged).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(height).toBe(initialHeight);
  await expect(page.getByRole('region', { name: 'Staged files', exact: true })).toBeVisible();
});

test('unstaged header trash previews all files even when filtered and Cancel returns focus', { tag: '@daily-driver-smoke' }, async ({ page }) => {
  const trash = page.getByRole('button', { name: 'Discard all unstaged changes', exact: true });
  await page.getByRole('searchbox', { name: 'Filter changed files' }).fill('no-matching-fixture-file');
  await trash.click();
  const review = page.getByRole('alertdialog');
  await expect(review.getByText('apps/desktop/src/app/app.component.html', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(trash).toBeFocused();
});

test('the row discard action remains focused but announces when Git is busy', { tag: '@daily-driver-smoke' }, async ({ page }) => {
  const trash = page.getByRole('button', { name: `Discard changes in ${path}`, exact: true });
  const review = page.getByRole('alertdialog');
  const setBusy = (busy: boolean) => page.evaluate(value => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.branchMutationPending.set(value);
  }, busy);

  await trash.focus();
  await setBusy(true);
  await expect(trash).toBeFocused();
  await expect(trash).toBeDisabled();
  await expect(trash).toHaveAttribute('title', 'Wait for the current Git operation before discarding changes');
  await page.keyboard.press('Enter');
  await expect(review).toHaveCount(0);

  await setBusy(false);
  await expect(trash).toBeEnabled();
  await expect(trash).toBeFocused();
  await trash.press('Enter');
  await expect(review.getByText(path, { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trash).toBeFocused();
});

test('Cancel returns focus to Discard selected and keeps the file selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Select files for discard/ }).press('Enter');
  const file = page.getByRole('checkbox', { name: `Select ${path} for discard` });
  await file.check();
  const discard = page.getByRole('button', { name: 'Discard selected…' });
  await discard.press('Enter');
  const review = page.getByRole('alertdialog');
  await expect(review.getByText(path, { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
  await expect(review).toHaveCount(0);
  await expect(discard).toBeFocused();
  await expect(file).toBeChecked();
});

test('discard selection explains hidden rows and keeps selections while collapsed', async ({ page }) => {
  const disclosure = page.getByRole('button', { name: /^Unstaged Files \(/ });
  const guidance = page.getByRole('group', { name: 'Select unstaged files for discard' });
  const file = page.getByRole('checkbox', { name: `Select ${path} for discard` });
  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Select files for discard/ }).press('Enter');

  await disclosure.press('Enter');
  await expect(guidance).toContainText('Expand Unstaged Files to select files');
  await expect(file).toHaveCount(0);
  await disclosure.press('Enter');
  const filter = page.getByRole('searchbox', { name: 'Filter changed files' });
  await filter.fill('no-matching-fixture-file');
  await expect(guidance).toContainText('Clear the filter to select unstaged files');
  await filter.clear();
  await expect(guidance).toContainText('Select files below');

  await file.check();
  await disclosure.press('Enter');
  await expect(guidance).toContainText('1 selected');
  await disclosure.press('Enter');
  await expect(file).toBeChecked();
});

for (const outcome of ['expanded folder', 'unselected sibling', 'missing selection', 'canceled selection'] as const) {
  test(`selected discard validates the native preview scope: ${outcome}`, async ({ page }) => {
    await page.evaluate(({ path, outcome }) => {
      const browser = window as any;
      const { git } = browser.ng.getComponent(document.querySelector('gk-app'));
      const repository = git.repository();
      const folder = { path: 'new-folder/', indexStatus: '?', worktreeStatus: '?', conflicted: false };
      git.repositories.set([{ ...repository, status: { ...repository.status,
        untracked: repository.status.untracked + 1, entries: [...repository.status.entries, folder] } }]);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      browser.__selectionScopeCalls = [];
      browser.__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        browser.__selectionScopeCalls.push({ command, args });
        if (command !== 'preview_discard') return Promise.reject(new Error(`Unexpected command ${command}`));
        const preview = {
          token: 'owned-test-token',
          paths: ['new-folder/child.txt', ...(outcome === 'unselected sibling' ? ['new-folder-other/child.txt'] : [])],
          blockedPaths: [],
          skippedPaths: outcome === 'missing selection' ? [] : [path],
          untracked: 1,
        };
        return outcome === 'canceled selection'
          ? new Promise(resolve => { browser.__completeSelectionScopePreview = () => resolve(preview); })
          : Promise.resolve(preview);
      } };
    }, { path, outcome });
    await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Select files for discard/ }).click();
    await page.getByRole('checkbox', { name: `Select ${path} for discard` }).check();
    await page.getByRole('checkbox', { name: 'Select new-folder/ for discard' }).check();
    const discard = page.getByRole('button', { name: 'Discard selected…' });
    await discard.press('Enter');
    const review = page.getByRole('alertdialog');
    if (outcome === 'expanded folder') {
      await expect(review.getByText('new-folder/child.txt', { exact: true })).toBeVisible();
      await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else if (outcome === 'canceled selection') {
      await expect.poll(() => page.evaluate(() => typeof (window as any).__completeSelectionScopePreview)).toBe('function');
      await page.getByRole('button', { name: 'Cancel selection' }).press('Enter');
      await page.evaluate(() => (window as any).__completeSelectionScopePreview());
      await expect.poll(() => page.evaluate(() =>
        (window as any).ng.getComponent(document.querySelector('gk-app')).git.busy())).toBe(false);
      await expect(page.locator('#unstaged-files-list')).toBeFocused();
      await expect(discard).toBeHidden();
      await expect(review).toHaveCount(0);
    } else {
      await expect(page.locator('.error-toast')).toContainText('The discard preview no longer matches your selection.');
      await expect(review).toHaveCount(0);
    }
    if (outcome !== 'canceled selection') await expect(discard).toBeFocused();
    const calls = await page.evaluate(() => (window as any).__selectionScopeCalls
      .filter(({ command }: { command: string }) => command === 'preview_discard' || command === 'discard_changes'));
    expect(calls).toEqual([{ command: 'preview_discard', args: { repoId: expect.any(String), paths: [path, 'new-folder/'] } }]);
  });
}

test('a discard preview does not wait for an unrelated history page', async ({ page }) => {
  await page.evaluate(path => {
    const w = window as any;
    const { git } = w.ng.getComponent(document.querySelector('gk-app'));
    const repo = git.repository();
    git.repositories.set([{ ...repo, historyTruncated: true }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    w.__discardWhilePaging = [];
    w.__TAURI_INTERNALS__ = { invoke: (command: string) => {
      w.__discardWhilePaging.push(command);
      if (command === 'load_more_commits') return new Promise(resolve => {
        w.__finishDiscardHistoryPage = () => resolve({ commits: [], historyTruncated: false });
      });
      if (command === 'preview_discard') return Promise.resolve({
        token: 'owned-preview', paths: [path], skippedPaths: [], blockedPaths: [], untracked: 0,
      });
      if (command === 'working_tree_change_summary') return Promise.resolve({ staged: null, unstaged: null });
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
    void git.loadMoreHistory();
  }, path);
  await expect.poll(() => page.evaluate(() => (window as any).__discardWhilePaging)).toContain('load_more_commits');
  const trash = page.getByRole('button', { name: 'Discard all unstaged changes', exact: true });
  await trash.click();
  const review = page.getByRole('alertdialog');
  await expect(review.getByText(path, { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__discardWhilePaging)).not.toContain('discard_changes');
  await page.evaluate(() => (window as any).__finishDiscardHistoryPage());
});

for (const action of ['Stage All Changes', 'Unstage All Changes'] as const) {
  test(`${action} reaches the whole index from a partial status page`, async ({ page }) => {
    const stage = action === 'Stage All Changes';
    await page.evaluate(stage => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const repo = git.repository();
      const entries = stage
        ? [{ path: 'staged-visible.txt', indexStatus: 'M', worktreeStatus: ' ', conflicted: false }]
        : [{ path: 'unstaged-visible.txt', indexStatus: ' ', worktreeStatus: 'M', conflicted: false }];
      const status = {
        ...repo.status, staged: 1, unstaged: 1, untracked: 0,
        conflicted: 0, entryCount: 2, entries, entriesTruncated: true,
      };
      const calls: Array<{ command: string; args: unknown }> = [];
      (window as any).__pagedIndexCalls = calls;
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: unknown) => {
          if (command === 'stage_all' || command === 'unstage_all') calls.push({ command, args });
          if (command === 'working_tree_change_summary') return { staged: null, unstaged: null };
          return status;
        },
      };
      git.repositories.set([{ ...repo, status }]);
    }, stage);
    const header = page.getByRole('button', { name: stage ? 'Stage all changes' : 'Unstage all', exact: true });
    await expect(header).toBeEnabled();
    await expect(page.getByText(`${stage ? 'Unstaged' : 'Staged'} changes are outside the loaded list.`, { exact: false })).toBeVisible();
    const filter = page.getByRole('searchbox', { name: 'Filter changed files' });
    await filter.fill('possibly-on-the-next-page');
    await expect(page.getByText('The filter only searches loaded files.', { exact: false })).toBeVisible();
    await filter.fill('');
    await page.keyboard.press('Control+p');
    const palette = page.locator('gk-command-palette');
    await palette.locator('input').fill(action);
    await palette.getByRole('option', { name: new RegExp(`^${action}`) }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__pagedIndexCalls)).toEqual([
      { command: stage ? 'stage_all' : 'unstage_all', args: { repoId: 'browser-preview' } },
    ]);
  });
}

test('unstaged header trash stays disabled when only staged changes remain', async ({ page }) => {
  const trash = page.getByRole('button', { name: 'Discard all unstaged changes', exact: true });
  await expect(trash).toBeEnabled();
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repo = git.repository();
    const entries = [{ path: 'already-staged.txt', indexStatus: 'M', worktreeStatus: ' ', conflicted: false }];
    git.repositories.set([{ ...repo, status: { ...repo.status, unstaged: 0, untracked: 0, staged: 1, entries } }]);
  });
  await expect(trash).toBeDisabled();
  await page.keyboard.press('Control+p');
  const palette = page.locator('gk-command-palette');
  await palette.locator('input').fill('discard all unstaged');
  await expect(palette.getByRole('option', { name: /Discard All Unstaged Changes/ })).toBeDisabled();
  await palette.locator('input').press('Enter');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('captured whole-tree palette actions cannot target a different checkout', async ({ page }) => {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const palette = page.locator('gk-command-palette');
  await expect(palette).toBeVisible();
  const result = await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const palette = (window as any).ng.getComponent(document.querySelector('gk-command-palette'));
    const { git } = app;
    const repo = git.repository();
    const ids = ['stage-all', 'unstage-all', 'discard-all-unstaged'];
    const actions = ids.map(id => palette.commandActions().find((action: any) => action.id === id));
    const invoked: string[] = [];
    git.stageAll = async () => { invoked.push('stage-all'); };
    git.unstageAll = async () => { invoked.push('unstage-all'); };
    git.previewDiscard = async () => { invoked.push('discard-all-unstaged'); return null; };
    git.repositories.set([{ ...repo, path: '/tmp/other-owned-checkout' }]);
    for (const action of actions) if (action?.enabled) await app.runCommand(action);
    return { enabled: actions.map(action => action?.enabled), invoked };
  });
  expect(result).toEqual({ enabled: [true, true, true], invoked: [] });
  await expect(palette).toBeVisible();
});

test('command palette opens bulk discard review without applying changes and restores focus on cancel', async ({ page }) => {
  const filter = page.getByRole('searchbox', { name: 'Filter changed files' });
  await filter.fill('no-matching-fixture-file');
  await page.keyboard.press('Control+p');
  const palette = page.locator('gk-command-palette');
  await palette.locator('input').fill('discard all unstaged');
  await palette.getByRole('option', { name: /Discard All Unstaged Changes/ }).click();
  const review = page.getByRole('alertdialog');
  await expect(review.getByText(path, { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(filter).toBeFocused();
  await filter.fill('');
  await expect(page.getByRole('button', { name: `View changes in ${path}` })).toBeVisible();
});

for (const entry of ['command palette', 'working directory menu'] as const) {
  test(`${entry} restores focus when the native bulk discard preview is refused`, async ({ page }) => {
    await page.evaluate(() => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string) => Promise.reject({
          kind: 'repositoryFileRefused',
          message: command === 'preview_discard' ? 'Owned fixture refused the bulk discard preview.' : `Unexpected command ${command}`,
        }),
      };
    });
    const opener = entry === 'command palette'
      ? page.getByRole('searchbox', { name: 'Filter changed files' })
      : page.getByRole('button', { name: 'Working directory options', exact: true });
    if (entry === 'command palette') {
      await opener.focus();
      await page.keyboard.press('Control+p');
      const palette = page.locator('gk-command-palette');
      await palette.locator('input').fill('discard all unstaged');
      await palette.getByRole('option', { name: /Discard All Unstaged Changes/ }).click();
    } else {
      await opener.press('Enter');
      await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).press('Enter');
      await expect(page.getByRole('menu', { name: 'Working directory options' })).toHaveCount(0);
    }
    await expect(page.locator('.error-toast')).toContainText('Owned fixture refused the bulk discard preview.');
    await expect(opener).toBeFocused();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
}

test('a late bulk discard refusal does not steal focus from another control', async ({ page }) => {
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => command === 'preview_discard'
        ? new Promise((_resolve, reject) => {
          (window as any).__refuseDiscard = () => reject({
            kind: 'repositoryFileRefused', message: 'Owned fixture refused a late preview.',
          });
        })
        : Promise.reject(new Error(`Unexpected command ${command}`)),
    };
  });
  await page.getByRole('searchbox', { name: 'Filter changed files' }).focus();
  await page.keyboard.press('Control+p');
  const palette = page.locator('gk-command-palette');
  await palette.locator('input').fill('discard all unstaged');
  await palette.getByRole('option', { name: /Discard All Unstaged Changes/ }).click();
  await expect(palette).toHaveCount(0);
  await page.waitForFunction(() => typeof (window as any).__refuseDiscard === 'function');
  const staged = page.getByRole('button', { name: /^Staged Files \(/ });
  await staged.focus();
  await page.evaluate(() => (window as any).__refuseDiscard());
  await expect(page.locator('.error-toast')).toContainText('Owned fixture refused a late preview.');
  await expect(staged).toBeFocused();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('bulk discard focuses the Unstaged Files heading when the trash button becomes disabled', async ({ page }) => {
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repo = git.repository();
    const entries = [
      { path: 'staged.txt', indexStatus: 'M', worktreeStatus: ' ', conflicted: false },
      { path: 'generated/file.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false },
    ];
    git.repositories.set([{ ...repo, status: { ...repo.status, unstaged: 0, untracked: 1, staged: 1, entries } }]);
  });
  const trash = page.getByRole('button', { name: 'Discard all unstaged changes', exact: true });
  await trash.press('Enter');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard captured changes' }).click();
  await expect(trash).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Unstaged Files (0)', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Unstage staged.txt', exact: true })).toBeVisible();
});

test('a discard completion does not steal focus from a filter the user moved to', async ({ page }) => {
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repo = git.repository();
    const file = { path: 'owned.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false };
    const before = { ...repo.status, unstaged: 0, untracked: 1, staged: 0, entries: [file] };
    const after = { ...before, untracked: 0, entries: [] };
    git.repositories.set([{ ...repo, status: before }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'preview_discard') return Promise.resolve({
        token: 'owned', paths: [file.path], skippedPaths: [], blockedPaths: [], untracked: 1,
      });
      if (command === 'discard_changes') return new Promise(resolve => {
        (window as any).__finishFocusDiscard = () => resolve({ id: '100-1', status: after });
      });
      return Promise.resolve(null);
    } };
  });
  const trash = page.getByRole('button', { name: 'Discard all unstaged changes', exact: true });
  await trash.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard captured changes' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishFocusDiscard)).toBe('function');
  const filter = page.getByRole('searchbox', { name: 'Filter changed files' });
  await filter.focus();
  await page.evaluate(() => (window as any).__finishFocusDiscard());
  await expect(trash).toBeDisabled();
  await expect(filter).toBeFocused();
});

test('sample discard previews include nested tracked edits and deletions', async ({ page }) => {
  const preview = await page.evaluate(async () => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repo = git.repository();
    git.repositories.set([{ ...repo, status: { ...repo.status, entries: [
      { path: 'nested/edit.txt', indexStatus: ' ', worktreeStatus: 'M', conflicted: false },
      { path: 'nested/deleted.txt', indexStatus: ' ', worktreeStatus: 'D', conflicted: false },
      { path: 'nested/untracked.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false },
      { path: 'nested/type-changed.txt', indexStatus: ' ', worktreeStatus: 'T', conflicted: false },
      { path: 'nested/conflict.txt', indexStatus: 'U', worktreeStatus: 'U', conflicted: true },
    ] } }]);
    return git.previewDiscard(null);
  });
  expect(preview).toMatchObject({
    paths: ['nested/edit.txt', 'nested/deleted.txt', 'nested/untracked.txt'],
    blockedPaths: ['nested/type-changed.txt'],
    skippedPaths: ['nested/conflict.txt'],
    untracked: 1,
  });
});

test('single-file discard confirms only the prepared native token', async ({ page }) => {
  const discard = page.locator('#unstaged-files-list button.row-discard').first();
  const selectedPath = (await discard.getAttribute('aria-label'))!.replace(/^Discard changes in /, '');
  const repositoryId = await page.evaluate(file => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    const entry = repository.status.entries.find((item: any) => item.path === file);
    const fixture = { calls: [] as Array<{ command: string; args: any }> };
    (window as any).__singleDiscard = fixture;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'preview_discard') {
        return Promise.resolve({ token: 'reviewed-token', paths: [file], skippedPaths: [],
          blockedPaths: [], untracked: Number(entry.indexStatus === '?') });
      }
      if (command === 'discard_changes') {
        return Promise.reject({ kind: 'staleDiscard', message: 'Working files changed after review.' });
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
    return repository.id;
  }, selectedPath);
  await discard.click();
  const confirmation = page.getByRole('alertdialog');
  const confirm = confirmation.getByRole('button', { name: 'Discard changes', exact: true });
  await expect(confirm).toBeEnabled();
  const calls = () => page.evaluate(() => (window as any).__singleDiscard.calls
    .filter(({ command }: { command: string }) => ['preview_discard', 'discard_changes', 'discard_path'].includes(command)));
  expect(await calls()).toEqual([{ command: 'preview_discard', args: { repoId: repositoryId, paths: [selectedPath] } }]);
  await confirm.click();
  await expect(page.getByText('Working files changed after review.', { exact: false })).toBeVisible();
  expect(await calls()).toEqual([
    { command: 'preview_discard', args: { repoId: repositoryId, paths: [selectedPath] } },
    { command: 'discard_changes', args: { repoId: repositoryId, token: 'reviewed-token' } },
  ]);
});

async function mockHistoryDiscards(page: Page, options: { fail?: boolean; delay?: boolean } = {}): Promise<void> {
  await page.evaluate(({ fail, delay }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const repository = git.repository();
    const fixture = {
      fail, delay, calls: [] as Array<{ command: string; args: any }>,
      records: [{ id: '1791408000000000000-12', restored: false,
        paths: ['notes.txt'], pathsTruncated: false, pathsError: null, contentSha256: 'a'.repeat(64) }],
      applyFailure: false,
      release: null as null | (() => void),
    };
    (window as any).__historyDiscards = fixture;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'load_reflog') return Promise.resolve({ entries: [], truncated: false });
        if (command === 'load_operation_recoveries') return Promise.resolve([]);
        if (command === 'load_discard_recoveries') {
          if (fixture.fail) return Promise.reject({ message: 'Discard recovery storage could not be read.' });
          if (fixture.delay) {
            return new Promise(resolve => {
              fixture.release = () => resolve(fixture.records);
            });
          }
          return Promise.resolve(fixture.records);
        }
        if (command === 'apply_saved_discard') {
          if (fixture.applyFailure) return Promise.reject({ message: 'Current files conflict with this capture.' });
          fixture.records[0].restored = true;
          return Promise.resolve({ status: repository.status, affectedToolbar: false });
        }
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  }, { fail: !!options.fail, delay: !!options.delay });
}

async function openRecoveryHistory(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menuitem', { name: /Recovery History/ }).click();
  await expect(page.getByRole('dialog', { name: 'Recovery history' })
    .getByRole('button', { name: 'Open discarded-change recovery…' })).toBeEnabled();
}

test('finds discarded changes in Recovery History and returns focus through recovery', async ({ page }) => {
  await mockHistoryDiscards(page);
  await openRecoveryHistory(page);
  const history = page.locator('.recovery-dialog');
  const backdrop = page.locator('.recovery-backdrop');
  const openDiscards = history.getByRole('button', { name: 'Open discarded-change recovery…' });
  const search = history.getByRole('searchbox', { name: 'Search recovery history' });
  await search.fill('preserved search');
  await openDiscards.click();
  const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
  await expect(saved).toContainText('Captured');
  await expect(saved.getByRole('list', { name: 'Files in this capture' })).toContainText('notes.txt');
  await expect(backdrop).toHaveAttribute('inert', '');
  await expect(saved.getByRole('button', { name: 'Back to Recovery History' })).toBeFocused();
  await saved.getByRole('button', { name: 'Back to Recovery History' }).press('Escape');
  await expect(saved).toHaveCount(0);
  await expect(backdrop).not.toHaveAttribute('inert', '');
  await expect(openDiscards).toBeFocused();
  await expect(search).toHaveValue('preserved search');

  await openDiscards.click();
  await expect(saved).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Escape');
  await expect(saved).toHaveCount(0);
  await expect(openDiscards).toBeFocused();

  await openDiscards.click();
  await saved.getByRole('button', { name: 'Recover…' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(backdrop).toHaveAttribute('inert', '');
  await expect(confirmation).toContainText('notes.txt');
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel' }).press('Escape');
  await expect(openDiscards).toBeFocused();
  await expect(history).toBeVisible();

  await openDiscards.click();
  await saved.getByRole('button', { name: 'Recover…' }).click();
  await confirmation.getByRole('button', { name: 'Recover changes' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(openDiscards).toBeFocused();
  const calls = await page.evaluate(() => (window as any).__historyDiscards.calls);
  expect(calls.find((call: { command: string }) => call.command === 'apply_saved_discard')).toEqual({
    command: 'apply_saved_discard',
    args: { repoId: expect.any(String), id: '1791408000000000000-12', reverse: false, expectedSha256: 'a'.repeat(64) },
  });
  await history.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Main menu' })).toBeFocused();
});

for (const mode of ['load', 'cancel', 'failure'] as const) {
  test(`file action review ${mode} keeps confirmation safe and focus contained`, async ({ page }) => {
    await mockHistoryDiscards(page);
    await openRecoveryHistory(page);
    const opener = page.getByRole('button', { name: 'Open discarded-change recovery…' });
    await opener.click();
    const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
    await expect(saved).toContainText('notes.txt');
    let release!: () => void;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      const reviewChunk = text.includes('FileConfirmationDetailsComponent')
        && text.includes('Discard only the selected hunk');
      if (reviewChunk && mode === 'failure') await route.abort();
      else {
        if (reviewChunk) await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ response, body: text });
      }
      if (reviewChunk) finish();
    });
    await saved.getByRole('button', { name: 'Recover…' }).click();
    const dialog = page.getByRole('alertdialog');
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    const recover = dialog.getByRole('button', { name: 'Recover changes' });
    await expect(cancel).toBeFocused();
    await expect(recover).toBeDisabled();
    if (mode === 'failure') {
      await expect(dialog.getByRole('alert')).toContainText('No changes were made');
    } else {
      await expect(dialog.getByRole('status')).toContainText('Loading file action review');
      await expect.poll(() => typeof release).toBe('function');
    }
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    if (mode === 'load') {
      release();
      await finished;
      await expect(dialog).toContainText('notes.txt');
      await expect(recover).toBeEnabled();
      await expect(cancel).toBeFocused();
      expect(await cancel.evaluate(button => !button.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Unidentified', code: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
      })))).toBe(true);
      await expect(recover).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(recover).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    if (mode === 'cancel') release();
    await finished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__historyDiscards.calls
      .filter((call: { command: string }) => call.command === 'apply_saved_discard'))).toEqual([]);
  });
}

for (const mode of ['cancel', 'failure'] as const) {
  test(`saved capture list ${mode} remains dismissible`, async ({ page }) => {
    await mockHistoryDiscards(page);
    await openRecoveryHistory(page);
    let release!: () => void;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const text = await response.text();
      const listChunk = text.includes('SavedDiscardListComponent')
        && text.includes('No saved discarded changes in this worktree.');
      if (listChunk && mode === 'failure') await route.abort();
      else {
        if (listChunk) await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ response, body: text });
      }
      if (listChunk) finish();
    });
    const opener = page.getByRole('button', { name: 'Open discarded-change recovery…' });
    await opener.click();
    const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
    const close = saved.getByRole('button', { name: 'Back to Recovery History' });
    await expect(close).toBeFocused();
    if (mode === 'failure') await expect(saved.getByRole('alert')).toContainText('could not be displayed');
    else {
      await expect(saved.getByRole('status')).toContainText('Opening saved captures');
      await expect.poll(() => typeof release).toBe('function');
    }
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(saved).toHaveCount(0);
    await expect(opener).toBeFocused();
    if (mode === 'cancel') release();
    await finished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(saved).toHaveCount(0);
  });
}

test('distinguishes captures and warns when file details are incomplete', async ({ page }) => {
  await mockHistoryDiscards(page);
  await page.evaluate(() => {
    (window as any).__historyDiscards.records = [
      { id: '1791408000000000000-12', restored: false, paths: ['known.txt'],
        pathsTruncated: true, pathsError: null, contentSha256: 'a'.repeat(64) },
      { id: '1791408000000000001-12', restored: false, paths: [],
        pathsTruncated: false, pathsError: 'The capture could not be inspected.', contentSha256: null },
    ];
  });
  await openRecoveryHistory(page);
  await page.getByRole('button', { name: 'Open discarded-change recovery…' }).click();
  const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
  const truncated = saved.locator('.saved-discard-item').filter({ hasText: 'known.txt' });
  const unavailable = saved.locator('.saved-discard-item').filter({ hasText: 'could not be inspected' });
  await expect(truncated).toContainText('Additional files are not shown');
  await expect(truncated).toContainText('Recovery applies the entire capture');
  await expect(unavailable).toContainText('Recovery may affect files not shown here');
  await expect(unavailable).toContainText('Changes to this capture after review cannot be detected');

  await truncated.getByRole('button', { name: 'Recover…' }).click();
  let confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('known.txt');
  await expect(confirmation).toContainText('This action affects the entire capture');
  await confirmation.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Open discarded-change recovery…' }).click();
  await unavailable.getByRole('button', { name: 'Recover…' }).click();
  confirmation = page.getByRole('alertdialog');
  await expect(confirmation.getByRole('alert').first()).toContainText('The capture could not be inspected');
  await expect(confirmation.getByRole('alert').first()).toContainText('This action may affect files not shown here');
  await expect(confirmation.getByRole('alert').last()).toContainText('Changes to this capture after review cannot be detected');
  await confirmation.getByRole('button', { name: 'Recover changes' }).click();
  const calls = await page.evaluate(() => (window as any).__historyDiscards.calls);
  expect(calls.find((call: { command: string }) => call.command === 'apply_saved_discard').args)
    .toMatchObject({ id: '1791408000000000001-12', expectedSha256: null });
});

test('blocks mismatched recovery states and warns before using legacy states', async ({ page }) => {
  await mockHistoryDiscards(page);
  await page.evaluate(() => {
    (window as any).__historyDiscards.records = [
      { id: '1791408000000000000-12', restored: true, stateBlocked: true,
        stateWarning: 'The recovery state cannot be matched to this saved capture.',
        paths: ['mismatched.txt'], pathsTruncated: false, pathsError: null, contentSha256: 'a'.repeat(64) },
      { id: '1791408000000000001-12', restored: true, stateBlocked: false,
        stateWarning: 'This older recovery state is not bound to its capture.',
        paths: ['legacy.txt'], pathsTruncated: false, pathsError: null, contentSha256: 'b'.repeat(64) },
    ];
  });
  await openRecoveryHistory(page);
  const opener = page.getByRole('button', { name: 'Open discarded-change recovery…' });
  await opener.click();
  const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
  const mismatch = saved.locator('.saved-discard-item').filter({ hasText: 'mismatched.txt' });
  await expect(mismatch).toContainText('State needs review');
  await expect(mismatch.getByRole('alert')).toContainText('cannot be matched');
  await expect(mismatch.getByRole('button', { name: 'Discard again…' })).toBeDisabled();
  await mismatch.getByRole('button', { name: 'Remove capture…' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation.getByRole('alert')).toContainText('cannot be matched');
  await confirmation.getByRole('button', { name: 'Cancel' }).click();

  await opener.click();
  const legacy = saved.locator('.saved-discard-item').filter({ hasText: 'legacy.txt' });
  await expect(legacy.getByRole('button', { name: 'Discard again…' })).toBeEnabled();
  await legacy.getByRole('button', { name: 'Discard again…' }).click();
  await expect(confirmation.getByRole('alert')).toContainText('older recovery state');
  await expect(confirmation.getByRole('button', { name: 'Discard again' })).toBeEnabled();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  const calls = await page.evaluate(() => (window as any).__historyDiscards.calls);
  expect(calls.some((call: { command: string }) => call.command === 'apply_saved_discard')).toBe(false);
});

test('makes control characters in captured file names unambiguous', async ({ page }) => {
  await mockHistoryDiscards(page);
  await page.evaluate(() => { (window as any).__historyDiscards.records[0].paths = ['note\twith\nlines.txt']; });
  await openRecoveryHistory(page);
  await page.getByRole('button', { name: 'Open discarded-change recovery…' }).click();
  const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
  await expect(saved.getByRole('list', { name: 'Files in this capture' })).toContainText('"note\\twith\\nlines.txt"');
  await saved.getByRole('button', { name: 'Recover…' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('"note\\twith\\nlines.txt"');
});

for (const width of [320, 700]) {
  test(`keeps recovery file details and controls usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 520 });
    await mockHistoryDiscards(page);
    await page.evaluate(() => {
      (window as any).__historyDiscards.records[0].paths = [
        `nested/${'long-file-name-'.repeat(8)}.txt`,
        ...Array.from({ length: 20 }, (_, index) => `folder/file-${index}.txt`),
      ];
    });
    await openRecoveryHistory(page);
    await page.getByRole('button', { name: 'Open discarded-change recovery…' }).click();
    const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
    await expect(saved.getByRole('button', { name: 'Recover…' })).toBeVisible();
    expect(await saved.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const layout = await saved.evaluate(element => ({
      action: element.querySelector('.capture-actions')!.getBoundingClientRect().bottom,
      firstPath: element.querySelector('.saved-discard-details li')!.getBoundingClientRect().top,
      listBottom: element.querySelector('.saved-discard-list')!.getBoundingClientRect().bottom,
    }));
    expect(layout.action).toBeLessThanOrEqual(layout.firstPath);
    expect(layout.action).toBeLessThanOrEqual(layout.listBottom);
    await saved.screenshot({ path: testInfo.outputPath(`discard-paths-${width}.png`) });
    await saved.getByRole('button', { name: 'Recover…' }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(confirmation).toContainText('folder/file-19.txt');
    expect(await confirmation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(confirmation.getByRole('button', { name: 'Recover changes' })).toBeVisible();
    await confirmation.screenshot({ path: testInfo.outputPath(`discard-confirmation-${width}.png`) });
  });
}

test('reports discarded-change load errors in Recovery History and permits retry', async ({ page }) => {
  await mockHistoryDiscards(page, { fail: true });
  await openRecoveryHistory(page);
  const history = page.getByRole('dialog', { name: 'Recovery history' });
  const openDiscards = history.getByRole('button', { name: 'Open discarded-change recovery…' });
  await openDiscards.click();
  await expect(history.getByRole('alert')).toContainText('Discard recovery storage could not be read');
  await expect(history.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Discarded-change recovery' })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__historyDiscards.fail = false; });
  await openDiscards.click();
  await expect(page.getByRole('dialog', { name: 'Discarded-change recovery' })).toContainText('Captured');
});

test('reports canceled discarded-change reads without presenting an empty recovery list', async ({ page }) => {
  await mockHistoryDiscards(page);
  await page.evaluate(() => {
    const internal = (window as any).__TAURI_INTERNALS__;
    const invoke = internal.invoke;
    internal.invoke = (command: string, args: any) => command === 'load_discard_recoveries'
      ? Promise.reject({ kind: 'operationCancelled', message: 'Reading discarded changes was canceled.' })
      : invoke(command, args);
  });
  await openRecoveryHistory(page);
  const history = page.getByRole('dialog', { name: 'Recovery history' });
  await history.getByRole('button', { name: 'Open discarded-change recovery…' }).click();
  await expect(history.getByRole('alert')).toContainText('Reading discarded changes was canceled');
  await expect(history.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Discarded-change recovery' })).toHaveCount(0);
});

test('reports failed recovery in History and keeps the capture available', async ({ page }) => {
  await mockHistoryDiscards(page);
  await page.evaluate(() => { (window as any).__historyDiscards.applyFailure = true; });
  await openRecoveryHistory(page);
  const history = page.locator('.recovery-dialog');
  const openDiscards = history.getByRole('button', { name: 'Open discarded-change recovery…' });
  await openDiscards.click();
  const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
  await saved.getByRole('button', { name: 'Recover…' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Recover changes' }).click();
  await expect(history.getByRole('alert')).toContainText('Current files conflict with this capture');
  await expect(history.getByRole('alert')).toBeFocused();
  await page.evaluate(() => { (window as any).__historyDiscards.applyFailure = false; });
  await openDiscards.click();
  await expect(saved).toContainText('Captured');
});

for (const action of ['apply', 'forget'] as const) {
  test(`refreshes a changed capture after refusing ${action}`, async ({ page }) => {
    await mockHistoryDiscards(page);
    await page.evaluate((action) => {
      const fixture = (window as any).__historyDiscards;
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      const repository = git.repository();
      git.recordDiscard(repository.id, 'Current discard', fixture.records[0].id);
      git.recordDiscard('other-repository', 'Other discard', 'other-id');
      const internal = (window as any).__TAURI_INTERNALS__;
      const invoke = internal.invoke;
      let stale = true;
      internal.invoke = (command: string, args: any) => {
        const target = action === 'apply' ? 'apply_saved_discard' : 'forget_saved_discard';
        if (command !== target) return invoke(command, args);
        fixture.calls.push({ command, args });
        if (stale) {
          stale = false;
          fixture.records[0].contentSha256 = 'b'.repeat(64);
          return Promise.reject({
            kind: 'discardRecoveryChanged', affectedToolbar: true,
            message: 'The capture changed. Nothing was changed; review it again.',
          });
        }
        if (action === 'forget') {
          fixture.records = [];
          return Promise.resolve(false);
        }
        fixture.records[0].restored = true;
        return Promise.resolve({ status: repository.status, affectedToolbar: false });
      };
    }, action);
    await openRecoveryHistory(page);
    const history = page.locator('.recovery-dialog');
    const openDiscards = history.getByRole('button', { name: 'Open discarded-change recovery…' });
    const saved = page.getByRole('dialog', { name: 'Discarded-change recovery' });
    const choose = action === 'apply' ? 'Recover…' : 'Remove capture…';
    const confirm = action === 'apply' ? 'Recover changes' : 'Remove capture';
    await openDiscards.click();
    await saved.getByRole('button', { name: choose }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: confirm, exact: true }).click();
    await expect(history.getByRole('alert')).toContainText('Nothing was changed');
    await expect(history.getByRole('alert')).toBeFocused();
    const afterFailure = await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      return {
        current: git.operationHistory()[git.repository().id] ?? null,
        other: git.operationHistory()['other-repository'],
      };
    });
    expect(afterFailure.current).toBeNull();
    expect(afterFailure.other).toMatchObject({ recoveryId: 'other-id', undone: false });
    await openDiscards.click();
    await saved.getByRole('button', { name: choose }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: confirm, exact: true }).click();
    await expect(openDiscards).toBeFocused();
    const calls = await page.evaluate((action) => (window as any).__historyDiscards.calls.filter(
      (call: { command: string }) => call.command === (action === 'apply' ? 'apply_saved_discard' : 'forget_saved_discard'),
    ), action);
    expect(calls.map((call: any) => call.args.expectedSha256)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });
}

test('ignores a discarded-change load completed after Recovery History was closed', async ({ page }) => {
  await mockHistoryDiscards(page, { delay: true });
  await openRecoveryHistory(page);
  const history = page.getByRole('dialog', { name: 'Recovery history' });
  await history.getByRole('button', { name: 'Open discarded-change recovery…' }).click();
  await expect(history.getByRole('status')).toContainText('Reading discarded-change captures');
  await history.getByRole('button', { name: 'Close recovery history' }).click();
  await page.evaluate(() => (window as any).__historyDiscards.release());
  await expect.poll(() => page.evaluate(() =>
    (window as any).ng.getComponent(document.querySelector('gk-app')).git.busy())).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Discarded-change recovery' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Recovery history' })).toHaveCount(0);
});

test('does not open stale discarded-change captures after a repository switch', async ({ page }) => {
  await mockHistoryDiscards(page, { delay: true });
  await openRecoveryHistory(page);
  const history = page.getByRole('dialog', { name: 'Recovery history' });
  await history.getByRole('button', { name: 'Open discarded-change recovery…' }).click();
  await expect(history.getByRole('status')).toContainText('Reading discarded-change captures');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const other = { ...git.repository(), id: 'another-repository', path: '/test/another' };
    git.repositories.update((repositories: any[]) => [...repositories, other]);
    git.activeRepositoryId.set(other.id);
    (window as any).__historyDiscards.release();
  });
  await expect(history.getByRole('alert')).toContainText('active repository changed');
  await expect(history.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Discarded-change recovery' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__historyDiscards.calls.some(
    (call: { command: string }) => call.command === 'apply_saved_discard'))).toBe(false);
});

for (const selected of [false, true]) {
  test(selected
    ? 'refuses a selected nested path before discarding'
    : 'refuses a mixed root and nested bulk request before discarding', async ({ page }) => {
    await page.evaluate(({ path, selected }) => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const git = app.git;
      const before = git.repository().status;
      const test = { calls: [] as Array<{ command: string; args: any }>, before };
      (window as any).__discardTest = test;
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string, args: any) => {
          test.calls.push({ command, args });
          if (command === 'working_tree_change_summary') return Promise.resolve({ staged: null, unstaged: { additions: 0, deletions: 0,
            uncountedFiles: git.repository().status.unstaged + git.repository().status.untracked, partial: true } });
          if (command === 'preview_discard') {
            if (selected) return Promise.reject({
              kind: 'repositoryFileRefused',
              message: 'The selected nested path cannot be discarded safely.',
            });
            return Promise.resolve({
              token: 'native-token',
              paths: ['tracked-root.txt'],
              skippedPaths: ['nested-repository/'],
              blockedPaths: [path, 'unloaded/file.bin'],
              untracked: 1,
            });
          }
          if (command === 'discard_changes') return Promise.resolve({
            id: '1791408000000000000-12',
            status: { ...before, unstaged: 0, entries: before.entries.filter((entry: any) => entry.path !== path) },
          });
          if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
          return Promise.reject(new Error(`Unexpected command ${command}`));
        },
      };
    }, { path, selected });
    await expect(page.getByRole('checkbox', { name: `Select ${path} for discard` })).toHaveCount(0);
    if (selected) {
      await page.getByRole('button', { name: /^Unstaged Files/ }).click();
      await expect(page.locator('#unstaged-files-list')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
    if (selected) {
      await page.getByRole('menuitem', { name: /^Select files for discard/ }).click();
      await expect(page.locator('#unstaged-files-list')).toBeFocused();
      await page.getByRole('checkbox', { name: `Select ${path} for discard` }).check();
      await page.getByRole('searchbox', { name: 'Filter changed files' }).fill('not-a-matching-path');
      await expect(page.getByRole('checkbox', { name: `Select ${path} for discard` })).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Select unstaged files for discard' }))
        .toContainText('1 selected · 1 hidden by the filter');
      await page.getByRole('button', { name: 'Discard selected…' }).click();
    } else {
      await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
    }
    const dialog = page.getByRole('alertdialog');
    if (selected) {
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => page.evaluate(() =>
        (window as any).ng.getComponent(document.querySelector('gk-app')).git.error()))
        .toContain('selected nested path cannot be discarded safely');
      await expect(page.getByRole('button', { name: 'Discard selected…' })).toBeFocused();
      const preview = await page.evaluate(() => (window as any).__discardTest.calls.filter(
        (call: { command: string }) => call.command !== 'refresh_repository_status' && call.command !== 'working_tree_change_summary'));
      expect(preview).toEqual([{ command: 'preview_discard', args: {
        repoId: expect.any(String), paths: [path],
      } }]);
      expect((await page.evaluate(() => (window as any).__discardTest.calls))
        .some((call: { command: string }) => call.command === 'discard_changes')).toBe(false);
      await page.getByRole('button', { name: 'Cancel selection' }).click();
      await expect(page.locator('#unstaged-files-list')).toBeFocused();
      return;
    }
    await expect(dialog).toContainText(selected ? path : 'unloaded/file.bin');
    await expect(dialog).toContainText('The paths below cannot be discarded with recovery');
    await expect(dialog).toContainText('No files were discarded');
    if (!selected) {
      await expect(dialog).toContainText('tracked-root.txt');
      await expect(dialog).toContainText('Also excluded: conflicts, submodule working trees, and nested repositories.');
    }
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Discard captured changes' })).toBeDisabled();
    const preview = await page.evaluate(() => (window as any).__discardTest.calls.filter(
      (call: { command: string }) => call.command !== 'refresh_repository_status' && call.command !== 'working_tree_change_summary'));
    expect(preview).toEqual([{ command: 'preview_discard', args: {
      repoId: expect.any(String), paths: selected ? [path] : null,
    } }]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const result = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      return { calls: (window as any).__discardTest.calls, status: app.git.repository().status,
        before: (window as any).__discardTest.before };
    });
    expect(result.status).toEqual(result.before);
    expect(result.calls.some((call: { command: string }) => call.command === 'discard_changes')).toBe(false);
  });
}

test('offers a fresh root-file preview after blocking a mixed discard request', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const before = git.repository().status;
    const fixture = { calls: [] as Array<{ command: string; args: any }>, before, previews: 0 };
    (window as any).__discardChoiceTest = fixture;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'preview_discard') {
          fixture.previews++;
          if (fixture.previews === 1) return Promise.resolve({
            token: 'blocked-token', paths: ['initial-root.txt'], skippedPaths: [],
            blockedPaths: ['oversized-root.txt'], oversizedPaths: ['oversized-root.txt'], untracked: 0,
          });
          if (fixture.previews === 2) return Promise.resolve({
            token: 'refreshed-token', paths: ['root-a.txt', 'root-b.txt'], skippedPaths: ['conflicted.txt'],
            blockedPaths: ['nested/current.txt', 'nested/link.txt'], oversizedPaths: ['nested/current.txt'], untracked: 1,
          });
          return Promise.resolve({
            token: 'selected-token', paths: args.paths, skippedPaths: [], blockedPaths: [], untracked: 0,
          });
        }
        if (command === 'discard_changes') return Promise.resolve({
          id: '1791408000000000000-12',
          status: { ...before, unstaged: 0, entries: before.entries.filter((entry: any) => entry.path !== 'root-b.txt') },
        });
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });

  let releaseReview: (() => void) | undefined;
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('FileConfirmationDetailsComponent') && text.includes('Discard only the selected hunk')) {
      await new Promise<void>(resolve => { releaseReview = resolve; });
    }
    await route.fulfill({ response, body: text });
  });
  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
  const dialog = page.getByRole('alertdialog');
  const chooseRoot = dialog.getByRole('button', { name: 'Choose eligible files…' });
  await expect(dialog.getByRole('status')).toContainText('Loading file action review');
  await expect(chooseRoot).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  expect(await page.evaluate(() => (window as any).__discardChoiceTest.previews)).toBe(1);
  await expect.poll(() => typeof releaseReview).toBe('function');
  releaseReview?.();
  await expect(dialog).toContainText('oversized-root.txt');
  await expect(dialog.locator('.discard-preview-paths li').filter({ hasText: 'oversized-root.txt' }))
    .toContainText('Too large to save for recovery');
  await expect(dialog.getByRole('button', { name: 'Discard captured changes' })).toBeDisabled();
  await chooseRoot.click();

  await expect(dialog).toContainText('Still blocked; these paths will remain unchanged');
  await expect(dialog).toContainText('nested/current.txt');
  await expect(dialog.locator('.discard-preview-paths li').filter({ hasText: 'nested/current.txt' }))
    .toContainText('Too large to save for recovery');
  await expect(dialog.locator('.discard-preview-paths li').filter({ hasText: 'nested/link.txt' }))
    .not.toContainText('Too large to save for recovery');
  await expect(dialog).toContainText('conflicted.txt');
  const rootA = dialog.getByRole('checkbox', { name: 'Select root-a.txt for fresh discard review' });
  const rootB = dialog.getByRole('checkbox', { name: 'Select root-b.txt for fresh discard review' });
  await expect(rootA).toBeFocused();
  await expect(rootA).not.toBeChecked();
  await expect(rootB).not.toBeChecked();
  const eligible = dialog.getByRole('group', { name: 'Eligible files' });
  const selectAll = eligible.getByRole('button', { name: 'Select all eligible' });
  const clear = eligible.getByRole('button', { name: 'Clear selection' });
  await expect(clear).toBeDisabled();
  await selectAll.click();
  await expect(eligible.getByRole('status')).toContainText('2 of 2 eligible files selected.');
  await expect(rootA).toBeChecked();
  await expect(rootB).toBeChecked();
  await expect(selectAll).toBeDisabled();
  await expect(selectAll).toBeFocused();
  await clear.click();
  await expect(eligible.getByRole('status')).toContainText('0 of 2 eligible files selected.');
  await expect(rootA).not.toBeChecked();
  await expect(rootB).not.toBeChecked();
  await expect(clear).toBeFocused();
  expect(await page.evaluate(() => (window as any).__discardChoiceTest.previews)).toBe(2);
  await rootB.check();
  await dialog.getByRole('button', { name: 'Preview selected files' }).click();

  await expect(dialog).toContainText('1 unstaged files');
  await expect(dialog.getByRole('button', { name: 'Discard captured changes' })).toBeEnabled();
  let calls = await page.evaluate(() => (window as any).__discardChoiceTest.calls);
  expect(calls.filter((call: { command: string }) => call.command === 'preview_discard')
    .map((call: { args: any }) => call.args.paths)).toEqual([null, null, ['root-b.txt']]);
  expect(calls.some((call: { command: string }) => call.command === 'discard_changes')).toBe(false);

  await dialog.getByRole('button', { name: 'Discard captured changes' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  calls = await page.evaluate(() => (window as any).__discardChoiceTest.calls);
  expect(calls.find((call: { command: string }) => call.command === 'discard_changes')?.args).toEqual({
    repoId: expect.any(String),
    token: 'selected-token',
  });
});

test('returns to the blocked review without retaining root selections', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const before = git.repository().status;
    const fixture = { calls: [] as Array<{ command: string; args: any }>, before, previews: 0 };
    (window as any).__discardChoiceTest = fixture;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'preview_discard') {
          fixture.previews++;
          return Promise.resolve(fixture.previews === 1
            ? { token: 'blocked-token', paths: ['initial-root.txt'], skippedPaths: [], blockedPaths: ['nested/file.txt'], untracked: 0 }
            : { token: 'refreshed-token', paths: ['root-a.txt'], skippedPaths: [], blockedPaths: ['nested/file.txt'], untracked: 0 });
        }
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });

  const options = page.getByRole('button', { name: 'Working directory options', exact: true });
  await options.click();
  await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Choose eligible files…' }).click();
  const rootA = dialog.getByRole('checkbox', { name: 'Select root-a.txt for fresh discard review' });
  await rootA.check();
  await dialog.getByRole('button', { name: 'Back to blocked review' }).click();

  await expect(dialog.getByRole('button', { name: 'Choose eligible files…' })).toBeFocused();
  await expect(dialog.getByRole('checkbox', { name: 'Select root-a.txt for fresh discard review' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Discard captured changes' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(options).toBeFocused();
  const result = await page.evaluate(() => (window as any).__discardChoiceTest);
  expect(result.calls.some((call: { command: string }) => call.command === 'discard_changes')).toBe(false);
  expect(result.before).toEqual((await page.evaluate(() =>
    (window as any).ng.getComponent(document.querySelector('gk-app')).git.repository().status)));
});

test('does not use a refreshed preview after switching repositories and back', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const repository = git.repository();
    const fixture = { calls: [] as Array<{ command: string; args: any }>, release: null as null | (() => void) };
    (window as any).__discardChoiceTest = fixture;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'preview_discard' && args.paths === null) {
          if (fixture.calls.filter((call: { command: string }) => call.command === 'preview_discard').length === 1) {
            return Promise.resolve({
              token: 'blocked-token', paths: ['initial-root.txt'], skippedPaths: [], blockedPaths: ['nested/file.txt'], untracked: 0,
            });
          }
          return new Promise(resolve => {
            fixture.release = () => resolve({
              token: 'late-refreshed-token', paths: ['stale-root.txt'], skippedPaths: [], blockedPaths: ['nested/file.txt'], untracked: 0,
            });
          });
        }
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });

  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Choose eligible files…' }).click();
  await expect(dialog.getByRole('status')).toContainText('Refreshing the file list');
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const original = git.repository();
    const other = { ...original, id: 'another-discard-repository', path: '/test/another' };
    git.repositories.update((repositories: any[]) => [...repositories, other]);
    git.activeRepositoryId.set(other.id);
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    git.activeRepositoryId.set(original.id);
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    (window as any).__discardChoiceTest.release();
  });

  await expect(dialog.getByRole('button', { name: 'Choose eligible files…' })).toBeEnabled();
  await expect(dialog.getByRole('checkbox', { name: 'Select stale-root.txt for fresh discard review' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Discard captured changes' })).toBeDisabled();
  const calls = await page.evaluate(() => (window as any).__discardChoiceTest.calls);
  expect(calls.filter((call: { command: string }) => call.command === 'preview_discard')).toHaveLength(2);
  expect(calls.some((call: { command: string }) => call.command === 'discard_changes')).toBe(false);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('refuses a selected-file preview that contains unselected paths', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const fixture = { calls: [] as Array<{ command: string; args: any }>, previews: 0 };
    (window as any).__discardChoiceTest = fixture;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'preview_discard') {
          fixture.previews++;
          if (fixture.previews === 1) return Promise.resolve({
            token: 'blocked-token', paths: ['initial-root.txt'], skippedPaths: [], blockedPaths: ['nested/file.txt'], untracked: 0,
          });
          if (fixture.previews === 2) return Promise.resolve({
            token: 'refreshed-token', paths: ['root-a.txt', 'root-b.txt'], skippedPaths: [], blockedPaths: ['nested/file.txt'], untracked: 0,
          });
          return Promise.resolve({
            token: 'broader-token', paths: ['root-a.txt', 'root-b.txt'], skippedPaths: [], blockedPaths: [], untracked: 0,
          });
        }
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });

  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Choose eligible files…' }).click();
  await dialog.getByRole('checkbox', { name: 'Select root-a.txt for fresh discard review' }).check();
  await dialog.getByRole('button', { name: 'Preview selected files' }).click();
  await expect(dialog.getByRole('alert')).toContainText('files you did not select: root-b.txt');
  await expect(dialog.getByRole('button', { name: 'Preview selected files' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Discard captured changes' })).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__discardChoiceTest.calls);
  expect(calls.filter((call: { command: string }) => call.command === 'preview_discard')
    .map((call: { args: any }) => call.args.paths)).toEqual([null, null, ['root-a.txt']]);
  expect(calls.some((call: { command: string }) => call.command === 'discard_changes')).toBe(false);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('keeps stale root selections in review without discarding', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const fixture = { calls: [] as Array<{ command: string; args: any }>, previews: 0 };
    (window as any).__discardChoiceTest = fixture;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'preview_discard') {
          fixture.previews++;
          if (fixture.previews === 1) return Promise.resolve({
            token: 'blocked-token', paths: ['initial-root.txt'], skippedPaths: [], blockedPaths: ['nested/file.txt'], untracked: 0,
          });
          if (fixture.previews === 2) return Promise.resolve({
            token: 'refreshed-token', paths: ['root-a.txt'], skippedPaths: [], blockedPaths: ['nested/file.txt'], untracked: 0,
          });
          return Promise.reject({ kind: 'emptyDiscard', message: 'The selected file changed before review.' });
        }
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });

  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Choose eligible files…' }).click();
  await dialog.getByRole('checkbox', { name: 'Select root-a.txt for fresh discard review' }).check();
  await dialog.getByRole('button', { name: 'Preview selected files' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The selected file changed before review');
  await expect(dialog.getByRole('checkbox', { name: 'Select root-a.txt for fresh discard review' })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Preview selected files' })).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).__discardChoiceTest.calls);
  expect(calls.some((call: { command: string }) => call.command === 'discard_changes')).toBe(false);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('a stale preview surfaces its error and keeps current files', { tag: '@daily-driver-smoke' }, async ({ page }) => {
  await page.evaluate((path) => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'preview_discard') return Promise.resolve({
          token: 'stale', paths: [path], skippedPaths: [], blockedPaths: [], untracked: 0,
        });
        if (command === 'discard_changes') return Promise.reject({
          kind: 'staleDiscard', message: 'Files changed after the preview. Nothing was discarded.',
        });
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  }, path);
  await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard captured changes' }).click();
  await expect(page.locator('#unstaged-files-list').getByRole('button', { name: `Stage ${path}` })).toBeVisible();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.error()))
    .toContain('Nothing was discarded');
});

test('manual recovery keeps matching toolbar undo and redo in sync', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.recordDiscard(repository.id, 'Discard Unstaged Changes', 'saved-id');
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'apply_saved_discard') return Promise.resolve({ status: repository.status, affectedToolbar: false });
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
    await git.applySavedDiscard('saved-id');
    const afterRestore = { undo: git.undoLabel(), redo: git.redoLabel() };
    await git.applySavedDiscard('saved-id', true);
    return { afterRestore, afterRedo: { undo: git.undoLabel(), redo: git.redoLabel() } };
  });
  expect(result.afterRestore).toEqual({ undo: null, redo: 'Redo Discard Unstaged Changes' });
  expect(result.afterRedo).toEqual({ undo: 'Undo Discard Unstaged Changes', redo: null });
});

test('removing a saved recovery clears only its matching toolbar action', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.recordDiscard(repository.id, 'Current discard', 'saved-id');
    git.recordDiscard('other-repository', 'Other discard', 'other-id');
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'forget_saved_discard') return Promise.resolve(false);
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
    await git.forgetSavedDiscard('saved-id');
    return { current: git.operationHistory()[repository.id] ?? null, other: git.operationHistory()['other-repository'] };
  });
  expect(result.current).toBeNull();
  expect(result.other).toMatchObject({ recoveryId: 'other-id', undone: false });
});

test('saved recovery updates a legacy toolbar entry only when native ownership matches', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const results = [];
    for (const affectedToolbar of [false, true]) {
      git.recordDiscard(repository.id, 'Legacy discard');
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'apply_saved_discard') return Promise.resolve({ status: repository.status, affectedToolbar });
        if (command === 'forget_saved_discard') return Promise.resolve(affectedToolbar);
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      } };
      await git.applySavedDiscard('saved-id');
      const restored = git.operationHistory()[repository.id]?.undone;
      await git.forgetSavedDiscard('saved-id');
      results.push({ affectedToolbar, restored, remaining: !!git.operationHistory()[repository.id] });
    }
    return results;
  });
  expect(results).toEqual([
    { affectedToolbar: false, restored: false, remaining: true },
    { affectedToolbar: true, restored: true, remaining: false },
  ]);
});

for (const [action, outcome] of [
  ['apply', 'success'], ['forget', 'success'], ['apply', 'missing'], ['forget', 'missing'],
  ['apply', 'connection'], ['forget', 'connection'],
] as const) {
  test(`late saved-recovery ${action} ${outcome} cannot replace newer history`, async ({ page }) => {
    const result = await page.evaluate(async ({ action, outcome }) => {
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      const repository = git.repository();
      git.recordDiscard(repository.id, 'Older discard', 'saved-id');
      git.recordDiscard('other-repository', 'Other discard', 'other-id');
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      let finish!: (value: unknown) => void;
      let markStarted!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'apply_saved_discard' || command === 'forget_saved_discard') {
          return new Promise((resolve, reject) => {
            finish = outcome === 'success' ? resolve : reject;
            markStarted();
          });
        }
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      } };
      const pending = action === 'apply' ? git.applySavedDiscard('saved-id') : git.forgetSavedDiscard('saved-id');
      await started;
      git.recordDiscard(repository.id, 'Newer discard', 'newer-id');
      finish(outcome === 'missing'
        ? { kind: 'discardRecoveryMissing', affectedToolbar: true, message: 'Capture is missing.' }
        : outcome === 'connection' ? new Error('Desktop connection interrupted.')
        : action === 'apply' ? { status: repository.status, affectedToolbar: true } : true);
      await pending;
      return { current: git.operationHistory()[repository.id], other: git.operationHistory()['other-repository'] };
    }, { action, outcome });
    expect(result.current).toMatchObject({ label: 'Newer discard', recoveryId: 'newer-id', undone: false });
    expect(result.other).toMatchObject({ recoveryId: 'other-id', undone: false });
  });
}

test('partial recovery outcomes invalidate only the matching history entry', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const cases = [
      { kind: 'discardRecoveryRecordFailed', id: 'saved-id', affectedToolbar: false, clear: true },
      { kind: 'discardRecoveryFailedWithRecovery', id: undefined, affectedToolbar: true, clear: true },
      { kind: 'discardRecoveryRefreshFailed', id: undefined, affectedToolbar: true, clear: true },
      { kind: 'discardRecoveryStateChanged', id: 'saved-id', affectedToolbar: false, clear: true },
      { kind: 'discardRecoveryRecordFailed', id: undefined, affectedToolbar: false, clear: false },
      { kind: 'discardRecoveryRecordFailed', id: 'newer-id', affectedToolbar: true, clear: false },
      { kind: 'discardRecoveryMissing', id: 'saved-id', affectedToolbar: false, clear: true },
      { kind: 'discardRecoveryMissing', id: undefined, affectedToolbar: true, clear: true },
      { kind: 'discardRecoveryMissing', id: undefined, affectedToolbar: false, clear: false },
      { kind: 'discardRecoveryMissing', id: 'newer-id', affectedToolbar: true, clear: false },
      { kind: 'discardRecoveryChanged', id: 'saved-id', affectedToolbar: true, clear: true },
      { kind: 'discardRecoveryChanged', id: undefined, affectedToolbar: false, clear: false },
      { kind: 'discardRecoveryChanged', id: 'newer-id', affectedToolbar: true, clear: false },
      { kind: 'discardRecoveryUnavailable', id: 'saved-id', affectedToolbar: true, clear: false },
      { kind: 'ordinaryFailure', id: 'saved-id', affectedToolbar: true, clear: true },
    ];
    const results = [];
    for (const item of cases) {
      git.recordDiscard(repository.id, 'Current discard', item.id);
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'apply_saved_discard') return Promise.reject({
          kind: item.kind, affectedToolbar: item.affectedToolbar, message: `Failure: ${item.kind}`,
        });
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      } };
      await git.applySavedDiscard('saved-id');
      results.push({ kind: item.kind, cleared: !git.operationHistory()[repository.id], expected: item.clear, error: git.error() });
    }
    return results;
  });
  for (const result of results) {
    expect(result.cleared, result.kind).toBe(result.expected);
    expect(result.error).toContain(result.kind);
  }
});

test('partial capture removal and toolbar recovery invalidate only affected actions', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const results = [];
    for (const [command, kind, affectedToolbar, id, expected] of [
      ['forget_saved_discard', 'discardRecoveryCaptureRemoved', true, undefined, true],
      ['forget_saved_discard', 'discardRecoveryCaptureRemoved', false, undefined, false],
      ['forget_saved_discard', 'discardRecoveryMissing', true, undefined, true],
      ['forget_saved_discard', 'discardRecoveryMissing', false, undefined, false],
      ['forget_saved_discard', 'discardRecoveryMissing', false, 'saved-id', true],
      ['forget_saved_discard', 'discardRecoveryMissing', true, 'newer-id', false],
      ['forget_saved_discard', 'discardRecoveryChanged', true, 'saved-id', true],
      ['forget_saved_discard', 'discardRecoveryChanged', false, undefined, false],
      ['forget_saved_discard', 'discardRecoveryChanged', true, 'newer-id', false],
      ['forget_saved_discard', 'discardRecoveryUnavailable', true, 'saved-id', false],
      ['undo_discard', 'discardRecoveryRefreshFailed', true, undefined, true],
      ['undo_discard', 'discardToolbarRecoveryUnavailable', true, undefined, true],
      ['undo_discard', 'discardRecoveryMissing', true, undefined, true],
      ['redo_discard', 'discardRecoveryMissing', true, undefined, true],
      ['undo_discard', 'discardRecoveryChanged', true, undefined, true],
      ['redo_discard', 'discardRecoveryChanged', true, undefined, true],
      ['undo_discard', 'discardRecoveryUnavailable', true, undefined, false],
      ['undo_discard', 'ordinaryFailure', true, undefined, true],
    ] as const) {
      git.recordDiscard(repository.id, 'Current discard', id);
      if (command === 'redo_discard') {
        git.operationHistory.update((history: any) => ({
          ...history, [repository.id]: { ...history[repository.id], undone: true },
        }));
      }
      (window as any).__TAURI_INTERNALS__ = { invoke: (name: string) => {
        if (name === command) return Promise.reject({ kind, affectedToolbar, message: `Failure: ${kind}` });
        if (name === 'refresh_repository') return Promise.resolve(repository);
        if (name === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.reject(new Error(`Unexpected command ${name}`));
      } };
      if (command === 'undo_discard') await git.undo();
      else if (command === 'redo_discard') await git.redo();
      else await git.forgetSavedDiscard('saved-id');
      results.push({ command, kind, affectedToolbar, cleared: !git.operationHistory()[repository.id], expected, error: git.error() });
    }
    return results;
  });
  for (const result of results) {
    expect(result.cleared, `${result.command}: ${result.kind}`).toBe(result.expected);
    expect(result.error).toContain(result.kind);
  }
});

test('unknown recovery outcomes invalidate only possibly affected undo actions', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const results = [];
    for (const operation of ['apply', 'forget', 'undo', 'redo']) {
      for (const kind of ['connection', 'backgroundTaskFailure']) {
        const ids = operation === 'apply' || operation === 'forget' ? ['saved-id', 'different-id', undefined] : [undefined];
        for (const id of ids) {
          git.recordDiscard(repository.id, 'Current discard', id);
          git.recordDiscard('other-repository', 'Other discard', 'other-id');
          if (operation === 'redo') {
            git.operationHistory.update((history: any) => ({
              ...history, [repository.id]: { ...history[repository.id], undone: true },
            }));
          }
          (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
            if (command === 'inspect_working_tree_file') return Promise.resolve({ path: args.path, staged: false, patch: 'diff fixture', truncated: false });
            if (command === 'refresh_repository') return Promise.resolve(repository);
            if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
            return Promise.reject(kind === 'connection'
              ? new Error('Desktop connection interrupted.')
              : { kind, message: 'The background task did not return.', affectedToolbar: false });
          } };
          await git.inspectWorkingTreeFile('example.txt', false);
          if (operation === 'apply') await git.applySavedDiscard('saved-id');
          if (operation === 'forget') await git.forgetSavedDiscard('saved-id');
          if (operation === 'undo') await git.undo();
          if (operation === 'redo') await git.redo();
          results.push({
            operation, kind, id, history: git.operationHistory()[repository.id] ?? null,
            other: git.operationHistory()['other-repository'], diff: git.workingTreeFileDiff(), error: git.error(),
          });
        }
      }
    }
    return results;
  });
  for (const result of results) {
    if (result.id === 'different-id') expect(result.history).toMatchObject({ recoveryId: 'different-id' });
    else expect(result.history, `${result.operation}: ${result.kind}`).toBeNull();
    expect(result.other).toMatchObject({ recoveryId: 'other-id' });
    if (result.operation === 'forget') {
      expect(result.diff).toMatchObject({ path: 'example.txt' });
      expect(result.error).toContain('recovery capture may already have been removed');
    } else {
      expect(result.diff, result.operation).toBeNull();
      expect(result.error).toContain('recovery action may have changed files or recovery state');
    }
  }
});

test('an uncertain discard invalidates the previous toolbar action without hiding its error', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const results = [];
    for (const kind of ['discardRefreshFailed', 'discardFailedWithRecovery', 'staleWorkingTreeFile',
      'gitFailure', 'discardFileTooLarge', 'backgroundTaskFailure', 'unexpectedFailure', 'connection']) {
      git.recordDiscard(repository.id, 'Earlier discard', 'old-id');
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'discard_path') return Promise.reject(kind === 'connection'
          ? new Error(`Failure: ${kind}`)
          : { kind, message: `Failure: ${kind}` });
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      } };
      await git.discardPath('example.txt', true);
      results.push({ kind, cleared: !git.operationHistory()[repository.id], error: git.error() });
    }
    return results;
  });
  expect(results.map((result: any) => result.cleared)).toEqual([true, true, false, false, false, true, true, true]);
  for (const result of results) {
    expect(result.error).toContain(result.kind);
    if (['backgroundTaskFailure', 'unexpectedFailure', 'connection'].includes(result.kind)) {
      expect(result.error).toContain('working tree may have changed');
      expect(result.error).toContain('before retrying');
    }
  }
});

test('unknown discard outcomes invalidate the matching diff and undo across discard actions', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const results = [];
    for (const operation of ['path', 'bulk', 'hunk', 'lines']) {
      for (const kind of ['connection', 'staleWorkingTreeFile']) {
        git.recordDiscard(repository.id, 'Earlier discard', 'old-id');
        (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
          if (command === 'inspect_working_tree_file') return Promise.resolve({ path: 'example.txt', staged: false, patch: 'diff fixture', truncated: false });
          if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
          return Promise.reject(kind === 'connection'
            ? new Error('Desktop connection interrupted.')
            : { kind, message: 'The reviewed file changed.' });
        } };
        await git.inspectWorkingTreeFile('example.txt', false);
        if (operation === 'path') await git.discardPath('example.txt', false);
        if (operation === 'bulk') await git.discardPrepared({ token: 'preview', paths: ['example.txt'], skippedPaths: [], blockedPaths: [], untracked: 0 }, repository.id);
        if (operation === 'hunk') await git.applyWorkingTreeHunk('example.txt', false, 0, 'discard');
        if (operation === 'lines') await git.applyWorkingTreeLines('example.txt', false, 0, [0], 'discard');
        results.push({
          operation, kind, history: git.operationHistory()[repository.id] ?? null,
          diff: git.workingTreeFileDiff(), error: git.error(),
        });
      }
    }
    return results;
  });
  for (const result of results) {
    if (result.kind === 'connection') {
      expect(result.history, result.operation).toBeNull();
      expect(result.diff, result.operation).toBeNull();
      expect(result.error, result.operation).toContain('working tree may have changed');
    } else {
      expect(result.history, result.operation).toMatchObject({ recoveryId: 'old-id' });
      expect(result.diff, result.operation).toMatchObject({ path: 'example.txt' });
      expect(result.error, result.operation).toContain('reviewed file changed');
    }
  }
});

test('a late uncertain discard preserves a newer undo action and inspection', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
    const repository = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.recordDiscard(repository.id, 'Earlier discard', 'old-id');
    let rejectDiscard!: (error: Error) => void;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'inspect_working_tree_file') return Promise.resolve({ path: args.path, staged: false, patch: 'diff fixture', truncated: false });
      if (command === 'discard_path') return new Promise((_, reject) => { rejectDiscard = reject; });
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
    await git.inspectWorkingTreeFile('old.txt', false);
    const pending = git.discardPath('old.txt', false);
    await git.inspectWorkingTreeFile('new.txt', false);
    git.recordDiscard(repository.id, 'Newer discard', 'new-id');
    rejectDiscard(new Error('Desktop connection interrupted.'));
    await pending;
    return { history: git.operationHistory()[repository.id], diff: git.workingTreeFileDiff(), error: git.error() };
  });
  expect(result.history).toMatchObject({ recoveryId: 'new-id', undone: false });
  expect(result.diff).toMatchObject({ path: 'new.txt' });
  expect(result.error).toContain('working tree may have changed');
});

test('discovers saved recovery after restart and confirms capture removal', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    app.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__recoveryCalls = [];
    (window as any).__recoveryRepositoryId = app.git.activeRepositoryId();
    let records = [{ id: '1791408000000000000-12', restored: false,
      paths: ['notes.txt'], pathsTruncated: false, pathsError: null, contentSha256: 'c'.repeat(64) }];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        (window as any).__recoveryCalls.push({ command, args });
        if (command === 'working_tree_change_summary') return Promise.resolve({ staged: null, unstaged: { additions: 0, deletions: 0,
          uncountedFiles: app.git.repository().status.unstaged + app.git.repository().status.untracked, partial: true } });
        if (command === 'load_discard_recoveries') return Promise.resolve(records);
        if (command === 'forget_saved_discard') {
          records = records.filter(record => record.id !== args.id);
          return Promise.resolve(false);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(app.git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
  const opener = page.getByRole('button', { name: 'Working directory options', exact: true });
  await opener.click();
  await page.getByRole('menuitem', { name: /^Recover discarded/ }).click();
  const recovery = page.getByRole('dialog', { name: 'Discarded-change recovery' });
  await expect(recovery).toContainText('Captured');
  await recovery.getByRole('button', { name: 'Close' }).press('Escape');
  await expect(opener).toBeFocused();
  await opener.click();
  await page.getByRole('menuitem', { name: /^Recover discarded/ }).click();
  await recovery.getByRole('button', { name: 'Remove capture…' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('Permanently remove');
  expect(await page.evaluate(() => (window as any).__recoveryCalls.filter(
    (call: { command: string }) => call.command === 'forget_saved_discard'))).toEqual([]);
  await confirmation.getByRole('button', { name: 'Remove capture', exact: true }).click();
  // A legitimate background read can follow deletion; it is not the mutation
  // under test and must not determine whether capture removal succeeded.
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    await app.git.refreshStatusInBackground(app.git.activeRepositoryId(), true);
  });
  await expect(confirmation).toHaveCount(0);
  await opener.click();
  await page.getByRole('menuitem', { name: /^Recover discarded/ }).click();
  await expect(recovery).toContainText('No saved discarded changes in this worktree.');
  await expect(recovery.getByRole('button', { name: 'Remove capture…' })).toHaveCount(0);
  const result = await page.evaluate(() => ({
    repositoryId: (window as any).__recoveryRepositoryId,
    calls: (window as any).__recoveryCalls.filter(
      (call: { command: string }) => call.command !== 'refresh_repository_status' && call.command !== 'working_tree_change_summary'),
  }));
  expect(result.repositoryId).toEqual(expect.any(String));
  const load = { command: 'load_discard_recoveries', args: { repoId: result.repositoryId } };
  expect(result.calls).toEqual([load, load, {
    command: 'forget_saved_discard',
    args: { repoId: result.repositoryId, id: '1791408000000000000-12', expectedSha256: 'c'.repeat(64) },
  }, load]);
});
