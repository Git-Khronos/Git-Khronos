import { expect, test, type Page } from '@playwright/test';

async function installHistoryFixture(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
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
          return Promise.resolve({ entries: [{ ...entry, oid: state.filePages === 1 ? oldOid : parentOid, path: state.filePages === 1 ? args.path : 'old.txt', previousPath: state.filePages === 1 ? 'old.txt' : null }],
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

test('a long file history subject keeps both copy actions available in a narrow window', async ({ page }) => {
  const subject = 'unbroken-commit-subject-'.repeat(25).replaceAll('-', '');
  const path = 'docs/notes.md';
  await page.setViewportSize({ width: 820, height: 800 });
  await page.evaluate(({ subject, path }) => {
    const { app, entry } = (window as any).__historyFixture;
    entry.subject = subject;
    return app.openTrackedFileInsight(path, 'history');
  }, { subject, path });
  const history = page.getByRole('region', { name: 'File history', exact: true });
  const title = history.getByRole('button', { name: subject, exact: true });
  await expect(title).toHaveAttribute('title', subject);
  const copyPath = history.getByRole('button', { name: `Copy path: ${path}`, exact: true });
  const copyId = history.getByRole('button', { name: 'Copy commit ID: aaaaaaaa', exact: true });
  await expect(copyPath).toBeInViewport();
  await expect(copyId).toBeInViewport();
  expect(await title.evaluate(button => {
    const { overflowX, textOverflow } = getComputedStyle(button);
    return { overflowX, textOverflow, clipped: button.scrollWidth > button.clientWidth };
  })).toEqual({ overflowX: 'hidden', textOverflow: 'ellipsis', clipped: true });
});

test('file history identifies the previous name on the rename row and copies it exactly', async ({ page }) => {
  const path = 'docs/nouveau résumé.md';
  const previous = 'archive/ancient [notes] naïve.md';
  await page.setViewportSize({ width: 820, height: 800 });
  await page.evaluate(({ path, previous }) => {
    const state = (window as any).__historyFixture;
    const native = (window as any).__TAURI_INTERNALS__;
    const invoke = native.invoke;
    native.invoke = async (command: string, args: any) => {
      const result = await invoke(command, args);
      if (command === 'inspect_file_history_page') {
        result.entries[0] = state.filePages === 1
          ? { ...result.entries[0], status: 'R', previousPath: previous }
          : { ...result.entries[0], path: previous, status: 'M' };
      }
      return result;
    };
    const values: string[] = state.copiedPaths = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { values.push(value); } },
    });
    return state.app.openTrackedFileInsight(path, 'history');
  }, { path, previous });
  const panel = page.getByRole('region', { name: 'File history', exact: true });
  const rename = panel.getByRole('article').first();
  await expect(rename).toContainText(path);
  const copy = rename.getByRole('button', { name: `Copy previous path: ${previous}`, exact: true });
  await expect(copy).toHaveText(`Previous path: ${previous}`);
  await expect(copy).toBeInViewport();
  await copy.focus();
  await copy.press('Enter');
  await expect(panel.getByRole('status')).toHaveText(`Copied previous path: ${previous}`);
  expect(await page.evaluate(() => (window as any).__historyFixture.copiedPaths)).toEqual([previous]);

  await panel.getByRole('button', { name: 'Load older file history' }).click();
  const older = panel.getByRole('article').nth(1);
  await expect(older).toContainText(previous);
  await expect(older.getByRole('button', { name: /^Copy previous path:/ })).toHaveCount(0);
});

test('file history copies the exact path and full commit ID without Git mutations', async ({ page }) => {
  const path = 'docs/Release notes/naïve résumé.md';
  await page.evaluate(() => {
    const state = (window as any).__historyFixture;
    state.copyAttempts = [];
    state.rejectCopy = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => {
        state.copyAttempts.push(value);
        if (state.rejectCopy) throw new Error('Clipboard denied');
      } },
    });
  });
  await page.evaluate((path) => (window as any).__historyFixture.app.openTrackedFileInsight(path, 'history'), path);

  const history = page.getByRole('region', { name: 'File history', exact: true });
  const copy = history.getByRole('button', { name: `Copy path: ${path}`, exact: true });
  await expect(copy).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__historyFixture.calls.some((call: any) =>
    call.command === 'inspect_file_history_page'))).toBe(true);
  await expect(copy).toBeVisible();

  const before = await page.evaluate(() => {
    const state = (window as any).__historyFixture;
    return { head: state.app.git.repository().headOid, calls: state.calls.length, oid: state.entry.oid };
  });
  // The desktop refreshes read-only status when the user refocuses its window.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate((offset) => (window as any).__historyFixture.calls
    .slice(offset).some((call: { command: string }) => call.command === 'refresh_repository_status'), before.calls)).toBe(true);
  const searchedPath = history.getByRole('button', { name: 'Copy searched path', exact: true });
  await searchedPath.focus();
  await searchedPath.press('Enter');
  await expect(history.getByRole('status')).toHaveText(`Copied searched path: ${path}`);
  await expect(searchedPath).toBeFocused();
  await copy.click();
  await expect(history.getByRole('status')).toHaveText(`Copied file path: ${path}`);
  await expect(history.getByRole('status')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__historyFixture.copyAttempts)).toEqual([path, path]);

  const commit = history.getByRole('button', { name: `Copy commit ID: ${before.oid.slice(0, 8)}`, exact: true });
  await commit.focus();
  await commit.press('Enter');
  await expect(history.getByRole('status')).toHaveText(`Copied commit ID: ${before.oid}`);
  await expect(commit).toBeFocused();

  await page.evaluate(() => { (window as any).__historyFixture.rejectCopy = true; });
  await copy.click();
  await expect(history.getByRole('status')).toHaveText(`Could not copy file path: ${path}. Clipboard access is unavailable.`);
  await expect(history.getByRole('status')).toBeVisible();
  const after = await page.evaluate((offset) => {
    const state = (window as any).__historyFixture;
    return {
      head: state.app.git.repository().headOid,
      commands: state.calls.slice(offset).map((call: { command: string }) => call.command),
      copyAttempts: state.copyAttempts,
    };
  }, before.calls);
  expect(after.head).toBe(before.head);
  expect(after.copyAttempts).toEqual([path, path, before.oid, path]);
  expect(after.commands.filter((command: string) => command !== 'refresh_repository_status')).toEqual([]);
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
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async () => undefined },
    });
  });
  await pane.getByRole('button', { name: `Copy path: ${path}`, exact: true }).click();
  await expect(pane.getByRole('status')).toHaveText(`Copied file path: ${path}`);
  await page.evaluate(() => {
    const state = (window as any).__historyFixture;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => new Promise<void>(resolve => { state.finishCopy = resolve; }) },
    });
  });
  await pane.getByRole('button', { name: `Copy path: ${path}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__historyFixture.finishCopy)).toBe('function');
  await pane.getByRole('button', { name: 'Use diff revision' }).click();
  await expect(pane).toContainText('No history was found');
  await expect(pane.getByRole('status')).toBeEmpty();
  await expect(startingPoint).toHaveText('Starting point: Diff revision');
  expect((await reads()).at(-1)).toMatchObject({ revision: head, path, cursor: null });
  // Reopen the same matching row before the clipboard reply. Comparing only
  // the current commit/path would incorrectly accept the retired operation.
  await ref.fill(tag);
  await ref.press('Enter');
  await expect(pane.getByRole('button', { name: 'Release-only change' })).toBeVisible();
  await page.evaluate(async () => {
    (window as any).__historyFixture.finishCopy();
    await Promise.resolve();
  });
  await expect(pane.getByRole('status')).toBeEmpty();
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

test('closing advanced history search focuses the compact opener when the original button is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 720 });
  const compact = page.locator('.graph-search-toggle');
  const advanced = page.locator('.graph-search-advanced');
  await compact.click();
  await advanced.click();
  const dialog = page.getByRole('dialog', { name: 'Search repository history', exact: true });
  await expect(dialog.getByLabel('Message contains')).toBeFocused();
  await expect(compact).toHaveAttribute('aria-expanded', 'false');
  await expect(advanced).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(compact).toBeFocused();
  await compact.press('Enter');
  await expect(page.getByLabel('Search loaded commits by message, SHA, or author')).toBeFocused();
});

test('closing history search does not take focus back from another control', async ({ page }) => {
  await page.getByRole('button', { name: 'Search all repository history', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search repository history', exact: true });
  await expect(dialog.getByLabel('Message contains')).toBeFocused();
  const other = page.locator('.toolbar-panel-button[aria-label="Hide Commit Panel"]');
  await other.evaluate(button => {
    document.querySelector<HTMLDialogElement>('#repository-history-dialog')!.close();
    (button as HTMLButtonElement).focus();
  });
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve))));
  await expect(other).toBeFocused();
});

test('cancelling the delayed history loader restores the compact opener', async ({ page }) => {
  let release!: () => void;
  let intercepted = false;
  let fulfilled = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const historyChunk = body.includes('Search repository history') && body.includes('Compare two revisions');
    if (historyChunk) {
      intercepted = true;
      await held;
    }
    await route.fulfill({ response, body });
    if (historyChunk) fulfilled = true;
  });
  try {
    await page.setViewportSize({ width: 700, height: 720 });
    const compact = page.locator('.graph-search-toggle');
    await compact.click();
    await page.locator('.graph-search-advanced').click();
    const loading = page.getByRole('dialog', { name: 'Loading history search', exact: true });
    await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await expect.poll(() => intercepted).toBe(true);
    await expect(compact).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(loading).toHaveCount(0);
    await expect(compact).toBeFocused();
    release();
    await expect.poll(() => fulfilled).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Search repository history', exact: true })).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
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
  const result = dialog.getByRole('button', { name: /Older than every loaded/ });
  for (const [theme, color] of [['khronos', 'rgb(43, 43, 64)'], ['midnight', 'rgb(35, 49, 72)']]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await result.hover();
    await expect(result).toHaveCSS('background-color', color);
    await page.mouse.move(0, 0);
    await expect(result).not.toHaveCSS('background-color', color);
  }
  await result.click();
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
  await expect(dialog.getByRole('button', { name: 'Retry history page' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toContainText('search complete');
  await expect(dialog.getByRole('button', { name: 'All matching history loaded' })).toBeFocused();
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

test('blame jump validates locally without offering to retry an unrelated read', async ({ page }) => {
  await page.evaluate(() => {
    const { app, oldOid } = (window as any).__historyFixture;
    const native = (window as any).__TAURI_INTERNALS__;
    const invoke = native.invoke;
    native.invoke = (command: string, args: any) => {
      if (command !== 'inspect_file_blame_page') return invoke(command, args);
      (window as any).__historyFixture.calls.push({ command, args });
      return Promise.resolve({
        lines: [{ lineNumber: args.firstLine, oid: oldOid, path: 'source.txt', authorName: 'Fixture', authorEmail: 'fixture@example.test', authoredAt: 1, summary: 'Source', text: 'source line' }],
        nextLine: null,
      });
    };
    app.changesOpen.set(false);
    app.git.commitFileDiff.set({ oid: oldOid, path: 'source.txt', patch: '+line', truncated: false });
    app.openDiffViewer();
  });
  await page.getByRole('button', {name: 'Blame', exact: true}).click();
  const blame = page.getByRole('region', {name: 'File blame', exact: true});
  const line = blame.getByRole('spinbutton', {name: 'Go to line'});
  const go = blame.getByRole('button', {name: 'Go', exact: true});
  const requests = () => page.evaluate(() => (window as any).__historyFixture.calls
    .filter((call: any) => call.command === 'inspect_file_blame_page').map((call: any) => call.args.firstLine));
  await expect(blame).toContainText('Lines 1–1');
  for (const invalid of ['', '0', '1.5', '4294967196']) {
    await line.fill(invalid);
    await go.click();
    await expect(line).toBeFocused();
    await expect(line).toHaveAttribute('aria-invalid', 'true');
    await expect(blame.getByRole('alert')).toHaveText('Enter a positive whole line number.');
    await expect(blame.getByRole('button', {name: 'Retry blame page'})).toHaveCount(0);
    expect(await requests()).toEqual([1]);
  }
  await line.fill('101');
  await expect(blame.getByRole('alert')).toHaveCount(0);
  await line.press('Enter');
  await expect(blame).toContainText('Lines 101–101');
  expect(await requests()).toEqual([1, 101]);
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
  const viewport = page.locator('gk-file-history .history-list');
  const commitButton = viewport.locator('.history-entry > div > button').first();
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

async function openRevisionComparison(page: Page) {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('compare revisions');
  await palette.getByRole('option').filter({ hasText: 'Compare revisions…' }).click();
  const comparison = page.getByRole('dialog', { name: 'Compare repository revisions' });
  await expect(comparison.getByLabel('Base ref or commit')).toBeFocused();
  return comparison;
}

async function showExportableComparison(page: Page, picker: 'file' | 'cancel' | 'hold') {
  await page.evaluate(mode => {
    const fixture = (window as any).__historyFixture;
    const native = (window as any).__TAURI_INTERNALS__, invoke = native.invoke;
    const content = { status: 'M', path: 'changes.txt', previousPath: null, additions: 3, deletions: 1 };
    native.invoke = (command: string, args: any) => {
      if (command === 'compare_commit_file') return Promise.resolve({ oid: args.targetOid, path: args.path, patch: '', truncated: false });
      if (command === 'compare_history_revisions' || command === 'plugin:dialog|save' || command === 'export_revision_patch') {
        fixture.calls.push({ command, args });
        if (command === 'compare_history_revisions') return Promise.resolve({
          baseOid: fixture.parentOid, targetOid: fixture.oldOid, workingTree: false, lineTotalsPartial: false, files: [content],
        });
        if (command === 'export_revision_patch') return Promise.resolve(123);
        if (mode === 'hold') return new Promise(resolve => fixture.releasePatchPicker = resolve);
        return Promise.resolve(mode === 'cancel' ? null : '/owned/comparison.patch');
      }
      return invoke(command, args);
    };
  }, picker);
  const dialog = await openRevisionComparison(page);
  await dialog.getByLabel('Base ref or commit').fill('main');
  await dialog.getByLabel('Target ref or commit').fill('topic');
  await dialog.getByLabel('Comparison mode').selectOption('mergeBase');
  await dialog.getByRole('button', { name: 'Compare revisions', exact: true }).click();
  const save = page.getByRole('button', { name: 'Save comparison patch…', exact: true });
  await expect(save).toBeEnabled();
  return save;
}

test('comparison patch uses resolved merge-base endpoints without a file filter or a checkout', async ({ page }) => {
  const save = await showExportableComparison(page, 'file');
  await page.locator('.comparison-files').getByRole('searchbox', { name: 'Filter changed files' }).fill('no matches');
  await save.click();
  await expect(page.locator('[data-git-operation-status]')).toContainText('Saved comparison patch');
  const received = await page.evaluate(() => {
    const fixture = (window as any).__historyFixture;
    return { repoId: fixture.app.git.activeRepositoryId(),
      calls: fixture.calls.filter((call: any) => /dialog\|save|export_revision_patch|checkout_/.test(call.command)) };
  });
  expect(received.calls).toEqual([
    { command: 'plugin:dialog|save', args: { options: expect.objectContaining({
      defaultPath: `comparison-${'b'.repeat(12)}-${'a'.repeat(12)}.patch`,
      filters: [{ name: 'Git patch', extensions: ['patch'] }],
    }) } },
    { command: 'export_revision_patch', args: {
      repoId: received.repoId, baseOid: 'b'.repeat(40), targetOid: 'a'.repeat(40),
      destination: '/owned/comparison.patch', operationId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    } },
  ]);
});

test('cancelling a comparison patch save leaves the comparison open and writes nothing', async ({ page }) => {
  const save = await showExportableComparison(page, 'cancel');
  await save.click();
  await expect(save).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__historyFixture.calls
    .filter((call: any) => /dialog\|save|export_revision_patch/.test(call.command))
    .map((call: any) => call.command))).toEqual(['plugin:dialog|save']);
});

test('a retired comparison cannot export from a late save result and WIP has no comparison export', async ({ page }) => {
  const save = await showExportableComparison(page, 'hold');
  await save.click();
  await expect(save).toBeDisabled();
  await page.evaluate(() => {
    const fixture = (window as any).__historyFixture;
    fixture.app.git.commitComparison.update((result: any) => ({ ...result, workingTree: true }));
    fixture.releasePatchPicker('/owned/late-comparison.patch');
  });
  await expect(save).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__historyFixture.app.git.choosingComparisonPatchDestination())).toBe(false);
  expect(await page.evaluate(() => (window as any).__historyFixture.calls.some((call: any) => call.command === 'export_revision_patch'))).toBe(false);
});

test('command palette opens revision comparison directly with grouped refs and reversible endpoints', async ({ page }) => {
  const expected = await page.evaluate(() => {
    const git = (window as any).__historyFixture.app.git;
    const repo = git.repository();
    return { id: repo.id, head: repo.headOid, remote: repo.branches.find((branch: any) => branch.remote).fullName,
      tag: repo.tags[0].fullName };
  });
  const dialog = await openRevisionComparison(page);
  await expect(dialog.getByLabel('Message contains')).toHaveCount(0);
  const base = dialog.getByLabel('Base ref or commit');
  const target = dialog.getByLabel('Target ref or commit');
  await dialog.getByLabel('Choose base branch or tag').selectOption(expected.remote);
  await dialog.getByLabel('Choose target branch or tag').selectOption(expected.tag);
  await expect(base).toHaveValue(expected.remote);
  await expect(target).toHaveValue(expected.tag);
  await dialog.getByRole('button', { name: 'Swap base and target' }).click();
  await expect(base).toHaveValue(expected.tag);
  await expect(target).toHaveValue(expected.remote);
  await dialog.getByLabel('Comparison mode').selectOption('mergeBase');
  await dialog.getByRole('button', { name: 'Compare revisions', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const summary = page.locator('.comparison-summary');
  await expect(summary).toContainText('Merge base → target comparison');
  await expect(summary).toContainText(expected.tag);
  await expect(summary).toContainText(expected.remote);
  const received = await page.evaluate(() => {
    const fixture = (window as any).__historyFixture;
    return { calls: fixture.calls.filter((call: any) => /compare_history|checkout_|fetch_/.test(call.command)),
      active: fixture.app.git.activeRepositoryId(), head: fixture.app.git.repository().headOid };
  });
  expect(received).toEqual({ active: expected.id, head: expected.head,
    calls: [{ command: 'compare_history_revisions', args: { repoId: expected.id, base: expected.tag, target: expected.remote, mode: 'mergeBase' } }] });
});

test('a commit action prefills its immutable ID without opening a comparison until confirmed', async ({ page }) => {
  const actions = page.getByRole('button', { name: 'Commit actions for Add hunk-level staging actions', exact: true });
  const oid = await actions.evaluate(node => node.closest<HTMLElement>('.commit-row')?.dataset['commitOid']);
  await actions.click();
  await page.getByRole('menuitem', { name: 'Compare from this commit…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare repository revisions' });
  await expect(dialog.getByLabel('Base ref or commit')).toHaveValue(oid!);
  await expect(dialog.getByLabel('Target ref or commit')).toHaveValue('HEAD');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(actions).toBeFocused();
  expect(await page.evaluate(() => (window as any).__historyFixture.calls.some((call: any) => call.command === 'compare_history_revisions'))).toBe(false);
});

test('an in-flight revision comparison cannot open results after changing checkout visits', async ({ page }) => {
  await page.evaluate(() => {
    const fixture = (window as any).__historyFixture;
    const native = (window as any).__TAURI_INTERNALS__, invoke = native.invoke;
    native.invoke = (command: string, args: any) => command === 'compare_history_revisions' ? new Promise(resolve => {
      fixture.releaseComparison = () => resolve({ baseOid: fixture.parentOid, targetOid: fixture.oldOid,
        workingTree: false, lineTotalsPartial: false, files: [] });
    }) : invoke(command, args);
  });
  const dialog = await openRevisionComparison(page);
  await dialog.getByRole('button', { name: 'Compare revisions', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__historyFixture.releaseComparison)).toBe('function');
  await page.evaluate(() => {
    const { git } = (window as any).__historyFixture.app;
    const repository = git.repository();
    git.repositories.update((rows: any[]) => [...rows, { ...repository, id: 'different-comparison-repository', path: '/owned/comparison-other' }]);
    git.activeRepositoryId.set('different-comparison-repository');
  });
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() => (window as any).__historyFixture.releaseComparison());
  await expect(page.locator('.comparison-summary')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__historyFixture.app.git.commitComparison())).toBeNull();
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
