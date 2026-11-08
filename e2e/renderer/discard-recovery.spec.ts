import { expect, test, type Page } from '@playwright/test';

const path = 'apps/desktop/src/app/app.component.html';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
});

async function mockHistoryDiscards(page: Page, options: { fail?: boolean; delay?: boolean } = {}): Promise<void> {
  await page.evaluate(({ fail, delay }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
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
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
  test(`previews ${selected ? 'selected' : 'all'} unstaged changes before discarding`, async ({ page }) => {
    await page.evaluate((path) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const git = app.git;
      const before = git.repository().status;
      const test = { calls: [] as Array<{ command: string; args: any }>, before };
      (window as any).__discardTest = test;
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = {
        invoke: (command: string, args: any) => {
          test.calls.push({ command, args });
          if (command === 'preview_discard') return Promise.resolve({
            token: 'native-token', paths: [path, 'unloaded/file.bin'],
            skippedPaths: ['nested/'], untracked: 1,
          });
          if (command === 'discard_changes') return Promise.resolve({
            id: '1791408000000000000-12',
            status: { ...before, unstaged: 0, entries: before.entries.filter((entry: any) => entry.path !== path) },
          });
          if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
          return Promise.reject(new Error(`Unexpected command ${command}`));
        },
      };
    }, path);
    await expect(page.getByRole('checkbox', { name: `Select ${path} for discard` })).toHaveCount(0);
    await page.getByRole('button', { name: 'Working directory options', exact: true }).click();
    if (selected) {
      await page.getByRole('menuitem', { name: /^Select files for discard/ }).click();
      await page.getByRole('checkbox', { name: `Select ${path} for discard` }).check();
      await page.getByRole('button', { name: 'Discard selected…' }).click();
    } else {
      await page.getByRole('menuitem', { name: /^Discard all unstaged/ }).click();
    }
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('unloaded/file.bin');
    await expect(dialog).toContainText('nested/');
    await expect(dialog).toContainText('Staged contents and ignored files remain untouched');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    const preview = await page.evaluate(() => (window as any).__discardTest.calls.filter(
      (call: { command: string }) => call.command !== 'refresh_repository_status'));
    expect(preview).toEqual([{ command: 'preview_discard', args: {
      repoId: expect.any(String), paths: selected ? [path] : null,
    } }]);
    await dialog.getByRole('button', { name: 'Discard captured changes' }).click();
    await expect(page.locator('#unstaged-files-list').getByRole('button', { name: `Stage ${path}` })).toHaveCount(0);
    const result = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      return { calls: (window as any).__discardTest.calls, staged: app.git.repository().status.staged,
        beforeStaged: (window as any).__discardTest.before.staged };
    });
    expect(result.staged).toBe(result.beforeStaged);
    expect(result.calls.find((call: { command: string }) => call.command === 'discard_changes')).toEqual({ command: 'discard_changes', args: {
      repoId: expect.any(String), token: 'native-token',
    } });
  });
}

test('a stale preview surfaces its error and keeps current files', async ({ page }) => {
  await page.evaluate((path) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'preview_discard') return Promise.resolve({
          token: 'stale', paths: [path], skippedPaths: [], untracked: 0,
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
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.error()))
    .toContain('Nothing was discarded');
});

test('manual recovery keeps matching toolbar undo and redo in sync', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const results = [];
    for (const kind of ['discardRefreshFailed', 'discardFailedWithRecovery', 'staleWorkingTreeFile', 'gitFailure', 'backgroundTaskFailure', 'unexpectedFailure', 'connection']) {
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
  expect(results.map((result: any) => result.cleared)).toEqual([true, true, false, false, true, true, true]);
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
        if (operation === 'bulk') await git.discardPrepared({ token: 'preview', paths: ['example.txt'], skippedPaths: [], untracked: 0 }, repository.id);
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
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
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
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__recoveryCalls = [];
    (window as any).__recoveryRepositoryId = app.git.activeRepositoryId();
    let records = [{ id: '1791408000000000000-12', restored: false,
      paths: ['notes.txt'], pathsTruncated: false, pathsError: null, contentSha256: 'c'.repeat(64) }];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        (window as any).__recoveryCalls.push({ command, args });
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
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
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
      (call: { command: string }) => call.command !== 'refresh_repository_status'),
  }));
  expect(result.repositoryId).toEqual(expect.any(String));
  const load = { command: 'load_discard_recoveries', args: { repoId: result.repositoryId } };
  expect(result.calls).toEqual([load, load, {
    command: 'forget_saved_discard',
    args: { repoId: result.repositoryId, id: '1791408000000000000-12', expectedSha256: 'c'.repeat(64) },
  }, load]);
});
