import { expect, test, type Page } from '@playwright/test';

async function installHistoryFixture(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const oldOid = 'a'.repeat(40);
    const parentOid = 'b'.repeat(40);
    const query = { message: '', author: '', oid: '', since: '', until: '', path: '', scope: '' };
    const entry = { oid: oldOid, authorName: 'Old Author', authorEmail: 'old@example.test', authoredAt: '2001-01-01T00:00:00Z', subject: 'Older than every loaded graph page' };
    const state = { app, oldOid, parentOid, query, entry, calls: [] as any[], searchPages: 0, filePages: 0, failNext: false, holdNext: false, reject: null as any };
    (window as any).__historyFixture = state;
    app.git.systemInfo.set({ appVersion: 'history fixture', gitVersion: '2.50.0', gitSupported: true, minimumGitVersion: '2.39.0' });
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        state.calls.push({ command, args });
        if (command === 'search_repository_history') {
          if (state.holdNext) return new Promise((_, reject) => state.reject = reject);
          if (state.failNext) { state.failNext = false; return Promise.reject({ kind: 'historyTimeout', message: 'Query timed out. Narrow filters and retry.' }); }
          state.searchPages++;
          return Promise.resolve(state.searchPages === 1
            ? { entries: [entry], cursor: { query: args.query, revisions: [oldOid], offset: 200 }, scanned: 200, complete: false }
            : { entries: [], cursor: null, scanned: 30, complete: true });
        }
        if (command === 'cancel_git_operation') {
          state.holdNext = false;
          state.reject?.({ kind: 'operationCancelled', message: 'History search cancelled; results are incomplete.' });
          return Promise.resolve(true);
        }
        if (command === 'search_tracked_files') return Promise.resolve({ paths: [], truncated: false });
        if (command === 'inspect_history_commit') return Promise.resolve({ ...entry, oid: args.oid, parents: [parentOid], description: 'Original commit metadata', decorations: [] });
        if (command === 'inspect_commit') return Promise.resolve({ oid: args.oid, message: entry.subject, signature: { status: 'unsigned' }, files: [], filesTruncated: false });
        if (command === 'inspect_commit_file') return Promise.resolve({ oid: args.oid, path: args.path, patch: '+historical source\n', truncated: false });
        if (command === 'inspect_file_history_page') {
          state.filePages++;
          return Promise.resolve({ entries: [{ ...entry, oid: state.filePages === 1 ? oldOid : parentOid, path: state.filePages === 1 ? 'new.txt' : 'old.txt', previousPath: state.filePages === 1 ? 'old.txt' : null }],
            cursor: state.filePages === 1 ? { revision: args.revision, path: args.path, historicalPath: 'old.txt', offset: 100 } : null, complete: state.filePages > 1 });
        }
        if (command === 'inspect_blame_navigation') return Promise.resolve({ oid: oldOid, path: 'old.txt', parents: [parentOid], parentPath: 'before.txt' });
        if (command === 'compare_history_revisions') return Promise.resolve({ baseOid: parentOid, targetOid: oldOid, workingTree: false, lineTotalsPartial: false, files: [] });
        if (command === 'refresh_repository') return Promise.resolve(app.git.repository());
        if (command === 'refresh_repository_status') return Promise.resolve(app.git.repository().status);
        return Promise.reject({ message: `Unexpected history command ${command}` });
      },
    };
  });
}

test.beforeEach(async ({ page }) => installHistoryFixture(page));

test('an exact path absent at HEAD opens its deletion and then the historical diff', async ({ page }) => {
  const path = 'docs/removed [1].txt';
  const expected = await page.evaluate((path) => {
    const state = (window as any).__historyFixture;
    const native = (window as any).__TAURI_INTERNALS__;
    const invoke = native.invoke;
    native.invoke = (command: string, args: any) => {
      if (command === 'search_tracked_files') return Promise.resolve({ paths: [], truncated: false });
      if (command === 'inspect_file_history_page') {
        state.calls.push({ command, args });
        return Promise.resolve({ entries: [{ ...state.entry, subject: 'Remove old notes', path,
          previousPath: null, status: 'D' }], cursor: null, complete: true });
      }
      if (command === 'inspect_commit_file') {
        state.calls.push({ command, args });
        return Promise.resolve({ oid: args.oid, path: args.path, truncated: false,
          patch: '@@ -1 +0,0 @@\n-last saved contents\n' });
      }
      return invoke(command, args);
    };
    return { head: state.app.git.repository().headOid, deleted: state.oldOid };
  }, path);

  await page.keyboard.press('Control+Shift+H');
  const search = page.getByRole('combobox', { name: 'Search tracked files', exact: true });
  await search.fill(path);
  await expect(page.getByRole('option', { name: /Blame:/ })).toHaveCount(0);
  await page.getByRole('option').filter({ hasText: 'File history for exact path: ' + path }).click();
  const history = page.getByRole('region', { name: 'File history', exact: true });
  await expect(history).toContainText('Deleted');
  const read = await page.evaluate(() => (window as any).__historyFixture.calls.find((call: any) =>
    call.command === 'inspect_file_history_page')?.args);
  expect(read).toMatchObject({ path, revision: expected.head, cursor: null });
  await history.getByRole('button', { name: 'Remove old notes' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__historyFixture.calls.find((call: any) =>
    call.command === 'inspect_commit_file')?.args)).toMatchObject({ oid: expected.deleted, path, previousPath: null });
  await expect(page.getByRole('region', { name: 'Diff viewer' })).toContainText('last saved contents');
});

test('a retired exact path action cannot look up history on a different HEAD', async ({ page }) => {
  await page.keyboard.press('Control+Shift+H');
  const search = page.getByRole('combobox', { name: 'Search tracked files', exact: true });
  await search.fill('docs/deleted.txt');
  const action = page.getByRole('option').filter({ hasText: 'File history for exact path: docs/deleted.txt' });
  await expect(action).toBeVisible();
  await action.evaluate((button: HTMLButtonElement) => {
    const { git } = (window as any).__historyFixture.app;
    git.repositories.update((items: any[]) => items.map(item => item.id === git.activeRepositoryId()
      ? { ...item, headOid: 'f'.repeat(40) } : item));
    button.click();
  });
  expect(await page.evaluate(() => (window as any).__historyFixture.calls.some((call: any) =>
    call.command === 'inspect_file_history_page'))).toBe(false);
  await expect(page.getByRole('region', { name: 'File history', exact: true })).toHaveCount(0);
});

test('file history can start from another local ref without switching the checkout', async ({ page }) => {
  const path = 'release-only.txt';
  const { head, tag, pinned } = await page.evaluate(() => {
    const state = (window as any).__historyFixture;
    const head = state.app.git.repository().headOid;
    const tag = 'refs/tags/v1.0';
    const pinned = 'e'.repeat(40);
    const original = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command !== 'inspect_file_history_page') return original(command, args);
      state.calls.push({ command, args });
      if (args.revision === 'missing-tag') return Promise.reject({ message: 'Unknown revision: missing-tag' });
      if (args.revision !== tag) return Promise.resolve({ entries: [], cursor: null, complete: true });
      return Promise.resolve({
        entries: [{ ...state.entry, oid: args.cursor ? state.parentOid : pinned,
          subject: args.cursor ? 'Older release edit' : 'Release-only change', path: args.path }],
        cursor: args.cursor ? null : { revision: pinned, requestedRevision: tag, path: args.path, historicalPath: args.path, offset: 100 },
        complete: !!args.cursor,
      });
    };
    return { head, tag, pinned };
  });
  const reads = () => page.evaluate(() => (window as any).__historyFixture.calls.filter((call: any) =>
    call.command === 'inspect_file_history_page').map((call: any) => call.args));
  await page.keyboard.press('Control+Shift+H');
  await page.getByRole('combobox', { name: 'Search tracked files', exact: true }).fill(path);
  await page.getByRole('option', { name: `File history for exact path: ${path}` }).click();
  const pane = page.getByRole('region', { name: 'File history', exact: true });
  await expect(pane).toContainText('No history was found');
  expect(await reads()).toMatchObject([{ revision: head, path, cursor: null }]);

  const startingPoint = pane.locator('summary');
  await startingPoint.click();
  const ref = pane.getByRole('textbox', { name: 'Branch, tag or commit' });
  await ref.fill('missing-tag');
  await ref.press('Enter');
  await expect(pane.getByRole('alert')).toContainText('Unknown revision');
  await expect(ref).toBeFocused();

  await ref.fill(tag);
  await pane.getByRole('button', { name: 'Search from revision' }).click();
  await expect(startingPoint).toHaveText(`Starting point: ${tag}`);
  await expect(pane.getByRole('alert')).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Release-only change' })).toBeVisible();
  await pane.getByRole('button', { name: 'Load older file history' }).click();
  await expect(pane.getByRole('button', { name: 'Older release edit' })).toBeVisible();
  expect(await reads()).toMatchObject([
    { revision: head, path, cursor: null },
    { revision: 'missing-tag', path, cursor: null },
    { revision: tag, path, cursor: null },
    { revision: tag, path, cursor: { revision: pinned, requestedRevision: tag, offset: 100 } },
  ]);

  const toggle = page.locator('.diff-insight-toggle');
  await toggle.getByRole('button', { name: 'Diff', exact: true }).click();
  await toggle.getByRole('button', { name: 'History', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Older release edit' })).toBeVisible();
  expect(await reads()).toHaveLength(4);

  await pane.getByRole('button', { name: 'Reload file history' }).click();
  await expect(pane.getByRole('button', { name: 'Older release edit' })).toHaveCount(0);
  expect((await reads()).at(-1)).toMatchObject({ revision: tag, path, cursor: null });
  await pane.getByRole('button', { name: 'Use diff revision' }).click();
  await expect(pane).toContainText('No history was found');
  await expect(startingPoint).toHaveText('Starting point: Diff revision');
  expect((await reads()).at(-1)).toMatchObject({ revision: head, path, cursor: null });
  expect(await page.evaluate(() => {
    const { app, calls } = (window as any).__historyFixture;
    return { head: app.git.repository().headOid, checkouts: calls.filter((call: any) => call.command.includes('checkout')) };
  })).toEqual({ head, checkouts: [] });
});

test('deferred history preserves entered filters across closing and restores the search opener', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Search all repository history', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Search repository history', exact: true });
  await dialog.getByLabel('Message contains').fill('retain my search');
  await dialog.getByRole('button', { name: 'Close history search', exact: true }).click();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog.getByLabel('Message contains')).toHaveValue('retain my search');
  await expect(dialog.getByLabel('Message contains')).toBeFocused();
});

test('cancelled history chunk loading does not open late or issue a search', async ({ page }) => {
  let finished!: () => void;
  const chunkFinished = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    const historyChunk = text.includes('Search repository history') && text.includes('Compare two revisions');
    if (historyChunk) await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ response, body: text });
    if (historyChunk) finished();
  });
  const opener = page.getByRole('button', { name: 'Search all repository history', exact: true });
  await opener.click();
  const loading = page.getByRole('dialog', { name: 'Loading history search', exact: true });
  await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await chunkFinished;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByRole('dialog', { name: 'Search repository history', exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__historyFixture.calls.some((call: any) => call.command === 'search_repository_history'))).toBe(false);
  await opener.click();
  await expect(page.getByRole('dialog', { name: 'Search repository history', exact: true })).toBeVisible();
});

test('paging code loads only on demand and a closed viewer cannot start a late file-history read', async ({ page }) => {
  let release!: () => void;
  let requests = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Searching a bounded history page') && text.includes('HistorySearchService')) {
      requests++;
      await gate;
    }
    await route.fulfill({ response, body: text });
  });
  try {
    expect(requests).toBe(0);
    await page.evaluate(() => {
      const state = (window as any).__historyFixture;
      state.pendingInsight = state.app.openTrackedFileInsight('new.txt', 'history');
    });
    await expect.poll(() => requests).toBe(1);
    await page.evaluate(() => (window as any).__historyFixture.app.closeDiffViewer());
    release();
    const result = await page.evaluate(async () => {
      const state = (window as any).__historyFixture;
      await state.pendingInsight;
      return { fileReads: state.calls.filter((call: any) => call.command === 'inspect_file_history_page'), open: state.app.diffViewerOpen() };
    });
    expect(result).toEqual({ fileReads: [], open: false });
    await expect(page.getByRole('region', { name: 'File history', exact: true })).toHaveCount(0);
  } finally { release(); }
});

test('failed history chunk has a focused close route and leaves repository state untouched', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Search repository history') && text.includes('Compare two revisions')) await route.abort();
    else await route.fulfill({ response, body: text });
  });
  const opener = page.getByRole('button', { name: 'Search all repository history', exact: true });
  await opener.click();
  const error = page.getByRole('dialog', { name: 'History search unavailable', exact: true });
  await expect(error.getByRole('alert')).toContainText('No search was run');
  await expect(error.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(error).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('opens contextual native history search with keyboard focus and progressive filters', async ({ page }) => {
  await expect(page.getByRole('dialog', { name: 'Search repository history' })).not.toBeVisible();
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('Search loaded commits by message, SHA, or author')).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Search repository history' })).not.toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+f');
  const dialog = page.getByRole('dialog', { name: 'Search repository history' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Message contains')).toBeFocused();
  await expect(dialog.getByLabel('Author name/email contains')).not.toBeVisible();
  await dialog.getByText('Advanced filters', { exact: true }).click();
  await dialog.getByLabel('Author name/email contains').fill('Old Author');
  await dialog.getByLabel('Ref or A..B range').fill('main..topic');
  await dialog.getByRole('button', { name: 'Search repository', exact: true }).click();
  await expect(dialog).toContainText('Older than every loaded graph page');
  await expect(dialog).toContainText('more history remains');
  await expect.poll(() => page.evaluate(() => (window as any).__historyFixture.calls.find((call: any) => call.command === 'search_repository_history').args.query.scope)).toBe('main..topic');
  await dialog.getByRole('button', { name: 'Continue searching older history' }).click();
  await expect(dialog).toContainText('1 results · search complete');
  await dialog.getByRole('button', { name: /Older than every loaded/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.commit-panel')).toContainText('Older than every loaded graph page');
  const selected = await page.evaluate(() => (window as any).__historyFixture.app.selectedCommitData().oid);
  expect(selected).toBe('a'.repeat(40));
});

test('keeps history search structured, responsive, and easy to reset', async ({ page }) => {
  await page.keyboard.press('Control+Shift+f');
  const dialog = page.getByRole('dialog', { name: 'Search repository history' });
  const message = dialog.getByLabel('Message contains');
  const close = dialog.getByRole('button', { name: 'Close history search', exact: true });

  await expect(dialog.getByText('Find commits beyond the history currently loaded in the graph.')).toBeVisible();
  await expect(message).toBeFocused();
  expect(await close.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.width >= 32 && bounds.height >= 32;
  })).toBe(true);

  await message.fill('keep this message');
  await dialog.getByText('Advanced filters', { exact: true }).click();
  await dialog.getByLabel('Author name/email contains').fill('Old Author');
  await dialog.getByLabel('Repository-relative path').fill('src/history.ts');
  await expect(dialog.getByText('2 active', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(dialog.getByLabel('Author name/email contains')).toHaveValue('');
  await expect(dialog.getByLabel('Repository-relative path')).toHaveValue('');
  await expect(message).toHaveValue('keep this message');

  await page.setViewportSize({ width: 560, height: 640 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => ({
    fitsViewport: element.getBoundingClientRect().width <= window.innerWidth,
    noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
  }))).toEqual({ fitsViewport: true, noHorizontalOverflow: true });
});

test('retains results and cursor after real operation cancellation, reports incomplete and supports retry', async ({ page }) => {
  await page.getByRole('button', { name: 'Search all repository history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search repository history' });
  await dialog.getByRole('button', { name: 'Search repository', exact: true }).click();
  await page.evaluate(() => (window as any).__historyFixture.holdNext = true);
  await dialog.getByRole('button', { name: 'Continue searching older history' }).click();
  await expect(dialog.getByRole('button', { name: 'Search repository', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel history search' }).click();
  await expect(dialog.getByRole('alert')).toContainText('discarded after cancellation was requested');
  await expect(dialog).toContainText('Search incomplete');
  await expect(dialog).toContainText('Older than every loaded graph page');
  await dialog.getByRole('button', { name: 'Retry history page' }).click();
  await expect(dialog).toContainText('search complete');
  const cursor = await page.evaluate(() => (window as any).__historyFixture.calls.filter((call: any) => call.command === 'search_repository_history').at(-1).args.cursor);
  expect(cursor.offset).toBe(200);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Search all repository history' })).toBeFocused();
});

test('file pagination opens historical renamed paths and blame can open the first parent', async ({ page }) => {
  await page.evaluate(async () => {
    const { app, oldOid } = (window as any).__historyFixture;
    app.changesOpen.set(false);
    app.git.commitFileDiff.set({ oid: oldOid, path: 'new.txt', patch: '+line', truncated: false });
    app.openDiffViewer();
    app.diffInsightMode.set('history');
    const history = await app.loadHistorySearch();
    void history.openFile(oldOid, 'new.txt');
  });
  const history = page.getByRole('region', { name: 'File history', exact: true });
  await expect(history).toContainText('incomplete');
  await history.getByRole('button', { name: 'Load older file history' }).click();
  await expect(history).toContainText('2 commits · complete');
  await history.getByRole('button', { name: 'Older than every loaded graph page' }).last().click();
  await expect.poll(() => page.evaluate(() => (window as any).__historyFixture.calls.findLast((call: any) => call.command === 'inspect_commit_file')?.args.path)).toBe('old.txt');
  await page.evaluate(() => {
    const { app, oldOid } = (window as any).__historyFixture;
    app.diffInsightMode.set('blame');
    app.git.fileBlame.set([{ lineNumber: 1, oid: oldOid, path: 'old.txt', authorName: 'Old Author', authorEmail: 'old@example.test', authoredAt: 1, summary: 'blamed line', text: 'line' }]);
  });
  await page.getByRole('button', { name: 'Parent', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__historyFixture.calls.findLast((call: any) => call.command === 'inspect_commit_file')?.args.path)).toBe('before.txt');
});

for (const change of ['repository', 'closed viewer', 'newer navigation']) {
  test(`retired blame navigation cannot redirect the ${change}`, async ({ page }) => {
    const result = await page.evaluate(async change => {
      const { app, oldOid, parentOid, calls } = (window as any).__historyFixture;
      const git = app.git;
      app.changesOpen.set(false);
      git.commitFileDiff.set({ oid: oldOid, path: 'old.txt', patch: '+line', truncated: false });
      app.openDiffViewer();
      app.diffInsightMode.set('blame');
      const native = (window as any).__TAURI_INTERNALS__;
      const invoke = native.invoke;
      let finish!: (value: unknown) => void;
      const held = new Promise(resolve => { finish = resolve; });
      native.invoke = (command: string, args: any) =>
        command === 'inspect_blame_navigation' && args.path === 'old.txt' ? held : invoke(command, args);
      const pending = app.navigateBlame(oldOid, 'old.txt', true);
      if (change === 'repository') {
        git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other-blame', path: '/fixture/other-blame' }]);
        git.activateRepository('other-blame');
      } else if (change === 'closed viewer') {
        app.closeDiffViewer();
      } else {
        await app.navigateBlame(oldOid, 'newer.txt', false);
      }
      finish({ oid: oldOid, path: 'old.txt', parents: [parentOid], parentPath: 'stale-parent.txt' });
      await pending;
      return { paths: calls.filter((item: any) => item.command === 'inspect_commit_file').map((item: any) => item.args.path),
        parentSelected: app.selectedCommit() === parentOid };
    }, change);
    expect(result).toEqual({ paths: change === 'newer navigation' ? ['old.txt'] : [], parentSelected: false });
  });
}

test('retired commit summary failures do not replace the current history selection', async ({ page }) => {
  const state = await page.evaluate(async () => {
    const { app, oldOid } = (window as any).__historyFixture;
    const native = (window as any).__TAURI_INTERNALS__;
    const invoke = native.invoke;
    let summaryReads = 0;
    let rejectFirst!: (error: unknown) => void;
    native.invoke = (command: string, args: any) => {
      if (command === 'inspect_history_commit' && ++summaryReads === 1) {
        return new Promise((_, reject) => { rejectFirst = reject; });
      }
      return invoke(command, args);
    };
    app.selectCommit(oldOid);
    app.selectCommit(oldOid);
    await new Promise(requestAnimationFrame);
    rejectFirst({ message: 'Older summary request failed' });
    await new Promise(requestAnimationFrame);
    return { summaryReads, selected: app.selectedCommit() === oldOid,
      subject: app.externalHistoryCommit()?.subject, error: app.git.error() };
  });
  expect(state).toEqual({ summaryReads: 2, selected: true, subject: 'Older than every loaded graph page', error: null });
});

test('returning to file history preserves loaded pages instead of repeating the read', async ({page}) => {
  await page.evaluate(async () => {
    const {app, oldOid} = (window as any).__historyFixture;
    app.changesOpen.set(false);
    app.git.commitFileDiff.set({oid: oldOid, path: 'new.txt', patch: '+line', truncated: false});
    app.openDiffViewer();
    app.diffInsightMode.set('history');
    const history = await app.loadHistorySearch();
    await history.openFile(oldOid, 'new.txt');
    await history.nextFile();
  });
  const pane = page.getByRole('region', {name: 'File history', exact: true});
  await expect(pane).toContainText('2 commits · complete');
  const toggle = page.locator('.diff-insight-toggle');
  await toggle.getByRole('button', {name: 'Diff', exact: true}).click();
  await toggle.getByRole('button', {name: 'History', exact: true}).click();
  await expect(pane).toContainText('2 commits · complete');
  expect(await page.evaluate(() => (window as any).__historyFixture.filePages)).toBe(2);
});

test('file history keeps its scroll position when returning from Diff', async ({page}) => {
  await page.evaluate(async () => {
    const {app, oldOid, entry} = (window as any).__historyFixture;
    app.changesOpen.set(false);
    app.git.commitFileDiff.set({oid: oldOid, path: 'new.txt', patch: '+line', truncated: false});
    app.openDiffViewer();
    await app.showFileHistory();
    const history = await app.loadHistorySearch();
    history.files.set(Array.from({length: 100}, (_, i) => ({...entry, oid: (i + 1).toString(16).padStart(40, '0'), path: 'new.txt', previousPath: null})));
  });
  const viewport = page.locator('gc-file-history .history-list');
  const commitButton = viewport.locator('.history-entry button').first();
  await expect(commitButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(commitButton).toHaveCSS('text-align', 'left');
  await expect(commitButton).toHaveCSS('font-size', '13px');
  await viewport.evaluate(element => { element.scrollTop = 280; });
  const before = await viewport.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(0);
  const toggle = page.locator('.diff-insight-toggle');
  await toggle.getByRole('button', {name: 'Diff', exact: true}).click();
  await toggle.getByRole('button', {name: 'History', exact: true}).click();
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(before);
  await page.locator('#repository-reference-panel').focus();
  await page.keyboard.press('F6');
  await expect(viewport).toBeFocused();
  await page.getByRole('button', {name: 'Reload file history', exact: true}).focus();
  await page.keyboard.press('F6');
  await expect(page.locator('#repository-commit-panel')).toBeFocused();
  await page.keyboard.press('Shift+F6');
  await expect(viewport).toBeFocused();
  for (const theme of ['khronos', 'midnight']) {
    await page.evaluate(theme => { document.documentElement.dataset['theme'] = theme; }, theme);
    const ratio = await viewport.evaluate(list => {
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const background = luminance(getComputedStyle(list.closest('.file-insight-panel')!).backgroundColor);
      const foreground = luminance(getComputedStyle(list.querySelector('.history-entry small')!).color);
      return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
    });
    expect(ratio, `History metadata contrast in ${theme}`).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({path: `test-results/navigation-review/history-return-${theme}.png`});
  }
  expect(await page.evaluate(() => (window as any).__historyFixture.filePages)).toBe(1);
});

test('failed file history stays failed on return and reload is explicit', async ({page}) => {
  await page.evaluate(async () => {
    const state = (window as any).__historyFixture;
    const {app, oldOid} = state;
    const original = (window as any).__TAURI_INTERNALS__.invoke;
    state.fileAttempts = 0;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command === 'inspect_file_history_page' && ++state.fileAttempts === 1) return Promise.reject({message: 'Owned file history failed'});
      return original(command, args);
    };
    app.changesOpen.set(false);
    app.git.commitFileDiff.set({oid: oldOid, path: 'new.txt', patch: '+line', truncated: false});
    app.openDiffViewer();
    await app.showFileHistory();
  });
  const pane = page.getByRole('region', {name: 'File history', exact: true});
  await expect(pane.getByRole('alert')).toContainText('Owned file history failed');
  const toggle = page.locator('.diff-insight-toggle');
  await toggle.getByRole('button', {name: 'Diff', exact: true}).click();
  await toggle.getByRole('button', {name: 'History', exact: true}).click();
  await expect(pane.getByRole('alert')).toContainText('Owned file history failed');
  expect(await page.evaluate(() => (window as any).__historyFixture.fileAttempts)).toBe(1);
  await pane.getByRole('button', {name: 'Reload file history', exact: true}).click();
  await expect(pane.locator('.history-entry')).toHaveCount(1);
  await expect(pane.getByRole('alert')).toHaveCount(0);
});

test('file history pagination controls stay mounted while reading and on completion', async ({page}) => {
  await page.evaluate(async () => {
    const state = (window as any).__historyFixture;
    const {app, oldOid} = state;
    app.changesOpen.set(false);
    app.git.commitFileDiff.set({oid: oldOid, path: 'new.txt', patch: '+line', truncated: false});
    app.openDiffViewer();
    await app.showFileHistory();
    const original = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: any) => command === 'inspect_file_history_page'
      ? new Promise(resolve => { state.finishHistoryPage = resolve; }) : original(command, args);
  });
  const pane = page.getByRole('region', {name: 'File history', exact: true});
  const more = pane.locator('footer button').first();
  const initial = await more.elementHandle();
  await more.click();
  await expect(more).toBeVisible();
  await expect(more).toBeDisabled();
  await expect(pane.getByRole('button', {name: 'Reload file history', exact: true})).toBeDisabled();
  await expect(pane.getByRole('button', {name: 'Cancel file history', exact: true})).toBeVisible();
  await page.evaluate(() => (window as any).__historyFixture.finishHistoryPage({entries: [], cursor: null, complete: true}));
  await expect(more).toHaveText('All available file history loaded');
  expect(await more.evaluate((element, initial) => element === initial, initial)).toBe(true);
});

test('explicit comparison mode reaches native merge-base command and displays unloaded revisions', async ({ page }) => {
  await page.getByRole('button', { name: 'Search all repository history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search repository history' });
  await dialog.getByText('Compare two revisions', { exact: true }).click();
  await dialog.getByLabel('Base ref or commit').fill('main');
  await dialog.getByLabel('Target ref or commit').fill('topic');
  await dialog.getByLabel('Comparison mode').selectOption('mergeBase');
  await dialog.getByRole('button', { name: 'Compare revisions', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.comparison-summary')).toContainText('bbbbbbbb');
  await expect(page.locator('.comparison-summary')).toContainText('aaaaaaaa');
  await expect.poll(() => page.evaluate(() => (window as any).__historyFixture.calls.find((call: any) => call.command === 'compare_history_revisions').args.mode)).toBe('mergeBase');
});

test('distinguishes timeout from empty completed results', async ({ page }) => {
  await page.getByRole('button', { name: 'Search all repository history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search repository history' });
  await page.evaluate(() => (window as any).__historyFixture.failNext = true);
  await dialog.getByRole('button', { name: 'Search repository', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('timed out');
  await expect(dialog).not.toContainText('No matching commits');
  await page.evaluate(() => (window as any).__historyFixture.searchPages = 1);
  await dialog.getByRole('button', { name: 'Retry history page' }).click();
  await expect(dialog).toContainText('No matching commits in the selected history.');
});
