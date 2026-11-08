import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, file: boolean): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async file => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const history = app.historySearch;
    await history.reset();
    app.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    let started!: () => void;
    const state: any = { app, history, file, reads: [], cancellations: [], started: new Promise<void>(resolve => { started = resolve; }) };
    state.start = (name: string) => file ? history.openFile('HEAD', name) : history.search({ message: name });
    (window as any).__historyLifecycle = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'cancel_git_operation') return new Promise((resolve, reject) => {
        state.cancellations.push({ resolve, reject, operationId: args.operationId });
      });
      if (command === 'search_repository_history' || command === 'inspect_file_history_page') {
        const name = file ? args.path : args.query.message;
        state.reads.push({ name, repoId: args.repoId });
        if (state.reads.length === 1) return new Promise(resolve => { state.finishInitial = resolve; started(); });
        return Promise.resolve({ entries: [{ oid: 'a'.repeat(40), subject: name,
          authorName: 'Fixture', authorEmail: 'fixture@example.test', authoredAt: '2026-01-01T00:00:00Z',
          path: name, previousPath: null }], cursor: null, complete: true, scanned: 1 });
      }
      return Promise.resolve(null);
    } };
    state.initial = state.start('initial');
    await state.started;
  }, file);
}

async function showHistory(page: Page, file: boolean) {
  if (!file) {
    await page.getByRole('button', { name: /Search all repository history/ }).click();
    return page.getByRole('dialog', { name: 'Search repository history' });
  }
  await page.evaluate(() => {
    const { app } = (window as any).__historyLifecycle;
    app.changesOpen.set(false);
    app.git.commitFileDiff.set({ oid: 'HEAD', path: 'initial', patch: '+line', truncated: false });
    app.openDiffViewer();
    app.diffInsightMode.set('history');
  });
  return page.getByRole('region', { name: 'File history', exact: true });
}

for (const file of [false, true]) {
  for (const change of ['newer-request', 'reset', 'repository-switch', 'repository-switch-immediate']) {
    test(`${file ? 'file history' : 'repository search'} cannot restart obsolete work after ${change}`, async ({ page }) => {
      await prepare(page, file);
      const result = await page.evaluate(async change => {
        const state = (window as any).__historyLifecycle;
        const { app, history } = state;
        const obsolete = state.start('obsolete');
        if (change === 'newer-request') {
          const newest = state.start('newest');
          state.cancellations[0].resolve(true);
          await newest;
        } else if (change === 'reset') {
          void history.reset();
        } else {
          const repo = app.git.repository();
          app.git.repositories.update((repositories: any[]) => [...repositories, { ...repo, id: 'other-search', path: '/fixture/other-search' }]);
          app.git.activateRepository('other-search');
          // Allow the repository-change effect to invalidate both search kinds.
          if (change === 'repository-switch') await new Promise(requestAnimationFrame);
        }
        for (const cancellation of state.cancellations) cancellation.resolve(true);
        await obsolete;
        state.finishInitial({ entries: [], cursor: null, complete: true, scanned: 0 });
        await state.initial;
        if (change === 'repository-switch-immediate') await new Promise(requestAnimationFrame);
        return { reads: state.reads.map((read: any) => read.name),
          subjects: (state.file ? history.files() : history.entries()).map((entry: any) => entry.subject),
          status: history.status() };
      }, change);
      expect(result.reads).toEqual(change === 'newer-request' ? ['initial', 'newest'] : ['initial']);
      expect(result.subjects).toEqual(change === 'newer-request' ? ['newest'] : []);
      if (!file && change !== 'newer-request') expect(result.status).toContain('Enter filters');
    });
  }

  for (const stale of [false, true]) {
    test(`${file ? 'file history' : 'repository search'} cancellation failure is ${stale ? 'ignored after completion' : 'reported for current work'}`, async ({ page }) => {
      await prepare(page, file);
      const warnings = await page.evaluate(async stale => {
        const state = (window as any).__historyLifecycle;
        const cancellation = state.file ? state.history.cancelFile() : state.history.cancel();
        if (stale) {
          state.finishInitial({ entries: [], cursor: null, complete: true, scanned: 0 });
          await state.initial;
          await state.start('newest');
        }
        state.cancellations[0].reject({ message: 'Cancellation transport failed' });
        await cancellation;
        const warnings = state.app.git.backgroundOperationWarnings().map((warning: any) => warning.message);
        if (!stale) {
          state.finishInitial({ entries: [], cursor: null, complete: true, scanned: 0 });
          await state.initial;
        }
        return warnings;
      }, stale);
      if (stale) expect(warnings).toEqual([]);
      else expect(warnings).toEqual([expect.stringContaining('Cancellation transport failed')]);
    });
  }
}

test('submitted search filters do not change while cancellation is pending', async ({ page }) => {
  await prepare(page, false);
  const reads = await page.evaluate(async () => {
    const state = (window as any).__historyLifecycle;
    const query = { message: 'submitted filters' };
    const pending = state.history.search(query);
    query.message = 'later editor changes';
    state.cancellations[0].resolve(true);
    await pending;
    state.finishInitial({ entries: [], cursor: null, complete: true, scanned: 0 });
    await state.initial;
    return state.reads.map((read: any) => read.name);
  });
  expect(reads).toEqual(['initial', 'submitted filters']);
});

test('file replacement invalidates the old owner before cancellation completes', async ({page}) => {
  await prepare(page, true);
  const result = await page.evaluate(async () => {
    const {history, start, cancellations, finishInitial, initial} = (window as any).__historyLifecycle;
    const replacement = start('replacement');
    const oldMatches = history.matchesFile('HEAD', 'initial');
    const pendingMatches = history.matchesFile('HEAD', 'replacement');
    cancellations[0].resolve(true);
    await replacement;
    finishInitial({entries: [], cursor: null, complete: true});
    await initial;
    return {oldMatches, pendingMatches, currentMatches: history.matchesFile('HEAD', 'replacement'), subjects: history.files().map((entry: any) => entry.subject)};
  });
  expect(result).toEqual({oldMatches: false, pendingMatches: false, currentMatches: true, subjects: ['replacement']});
});

for (const file of [false, true]) {
  const label = file ? 'file history' : 'repository search';

  test(`${label} retries unacknowledged cancellation and lets the user retry`, async ({ page }) => {
    await prepare(page, file);
    if (!file) await page.getByRole('button', { name: /Search all repository history/ }).click();
    await page.evaluate(() => {
      const state = (window as any).__historyLifecycle;
      state.firstCancel = state.file ? state.history.cancelFile() : state.history.cancel();
      state.cancellations[0].resolve(false);
    });
    for (const count of [2, 3]) {
      await expect.poll(() => page.evaluate(() => (window as any).__historyLifecycle.cancellations.length)).toBe(count);
      await page.evaluate(index => (window as any).__historyLifecycle.cancellations[index].resolve(false), count - 1);
    }
    const warning = page.getByRole('region', { name: 'Background operation warnings' });
    await expect(warning.getByRole('alert')).toContainText(`${label} may still be running`);
    if (!file) await expect(page.getByRole('dialog', { name: 'Search repository history' }).getByRole('region', { name: 'Background operation warnings' })).toBeVisible();
    expect(await page.evaluate(() => {
      const state = (window as any).__historyLifecycle;
      return state.file ? state.history.fileBusy() : state.history.busy();
    })).toBe(true);

    await page.evaluate(() => {
      const state = (window as any).__historyLifecycle;
      state.retryCancel = state.file ? state.history.cancelFile() : state.history.cancel();
      state.cancellations[3].resolve(true);
    });
    await page.evaluate(async () => {
      const state = (window as any).__historyLifecycle;
      await state.retryCancel;
      state.finishInitial({ entries: [{ oid: 'a'.repeat(40), subject: 'discarded late result',
        authorName: 'Fixture', authorEmail: 'fixture@example.test', authoredAt: '2026-01-01T00:00:00Z',
        path: 'initial', previousPath: null }], cursor: null, complete: true, scanned: 1 });
      await state.initial;
    });
    expect(await page.evaluate(() => {
      const state = (window as any).__historyLifecycle;
      return (state.file ? state.history.files() : state.history.entries()).map((entry: any) => entry.subject);
    })).toEqual([]);
  });

  test(`${label} replacement is not blocked by a stalled cancellation`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await prepare(page, file);
    if (!file) await page.getByRole('button', { name: /Search all repository history/ }).click();
    await page.evaluate(() => {
      const state = (window as any).__historyLifecycle;
      state.replacement = state.start('replacement');
    });
    await expect.poll(() => page.evaluate(() => (window as any).__historyLifecycle.reads.map((read: any) => read.name)),
      { timeout: 3500 }).toEqual(['initial', 'replacement']);
    const warning = page.getByRole('region', { name: 'Background operation warnings' });
    await expect(warning.getByRole('alert')).toContainText(`${label} may still be running`);
    if (!file) await expect(page.getByRole('dialog', { name: 'Search repository history' }).getByRole('region', { name: 'Background operation warnings' })).toBeVisible();
    await page.evaluate(async () => {
      const state = (window as any).__historyLifecycle;
      state.cancellations[0].reject(new Error('Late cancellation rejection'));
      state.finishInitial({ entries: [{ oid: 'b'.repeat(40), subject: 'stale',
        authorName: 'Fixture', authorEmail: 'fixture@example.test', authoredAt: '2026-01-01T00:00:00Z',
        path: 'initial', previousPath: null }], cursor: null, complete: true, scanned: 1 });
      await Promise.all([state.replacement, state.initial]);
    });
    await page.waitForTimeout(100);
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => {
      const state = (window as any).__historyLifecycle;
      return (state.file ? state.history.files() : state.history.entries()).map((entry: any) => entry.subject);
    })).toEqual(['replacement']);
  });

  test(`${label} can start again after a cancellation is accepted but the read remains active`, async ({ page }) => {
    await prepare(page, file);
    const view = await showHistory(page, file);
    const cancel = view.getByRole('button', { name: file ? /^(Cancel file history|Stopping…|Retry cancellation)$/ : /^(Cancel history search|Stopping…|Retry cancellation)$/ });
    await cancel.click();
    await expect(cancel).toHaveAttribute('aria-disabled', 'true');
    await page.evaluate(() => (window as any).__historyLifecycle.cancellations[0].resolve(true));
    const restart = view.getByRole('button', { name: file ? 'Reload file history' : 'Search repository', exact: true });
    await expect(restart).toBeEnabled();
    if (!file) await view.getByLabel('Message contains').fill('replacement');
    await restart.click();
    await expect.poll(() => page.evaluate(() => (window as any).__historyLifecycle.reads.length)).toBe(2);
    await page.evaluate(async () => {
      const state = (window as any).__historyLifecycle;
      state.finishInitial({ entries: [{ oid: 'b'.repeat(40), subject: 'stale',
        authorName: 'Fixture', authorEmail: 'fixture@example.test', authoredAt: '2026-01-01T00:00:00Z',
        path: 'initial', previousPath: null }], cursor: null, complete: true, scanned: 1 });
      await state.initial;
    });
    expect(await page.evaluate(() => {
      const state = (window as any).__historyLifecycle;
      return (state.file ? state.history.files() : state.history.entries()).map((entry: any) => entry.subject);
    })).toEqual([file ? 'initial' : 'replacement']);
  });

  for (const moveFocus of [false, true]) {
    test(`${label} ${moveFocus ? 'does not steal focus after the user moves it' : 'restores focus after a cancelled read finishes'}`, async ({ page }) => {
      await prepare(page, file);
      const view = await showHistory(page, file);
      const cancel = view.getByRole('button', { name: file ? /^(Cancel file history|Stopping…|Retry cancellation)$/ : /^(Cancel history search|Stopping…|Retry cancellation)$/ });
      await cancel.focus();
      await page.keyboard.press('Enter');
      await expect(cancel).toBeFocused();
      await expect(cancel).toHaveAttribute('aria-disabled', 'true');
      const other = file ? view.getByLabel('File history commits') : view.getByLabel('Message contains');
      if (moveFocus) await other.focus();
      await page.evaluate(async () => {
        const state = (window as any).__historyLifecycle;
        state.cancellations[0].resolve(true);
        state.finishInitial({ entries: [], cursor: null, complete: true, scanned: 0 });
        await state.initial;
      });
      const fallback = view.getByRole('button', { name: file ? 'Retry file history page' : 'Search repository', exact: true });
      await expect(moveFocus ? other : fallback).toBeFocused();
    });
  }
}
