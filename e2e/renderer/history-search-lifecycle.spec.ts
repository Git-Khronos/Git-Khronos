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
          state.cancellations[1].resolve(true);
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
    test(`${file ? 'file history' : 'repository search'} cancellation failure is ${stale ? 'ignored after replacement' : 'reported for current work'}`, async ({ page }) => {
      await prepare(page, file);
      const error = await page.evaluate(async stale => {
        const state = (window as any).__historyLifecycle;
        const cancellation = state.file ? state.history.cancelFile() : state.history.cancel();
        if (stale) {
          state.finishInitial({ entries: [], cursor: null, complete: true, scanned: 0 });
          await state.initial;
          await state.start('newest');
        }
        state.cancellations[0].reject({ message: 'Cancellation transport failed' });
        await cancellation;
        const error = state.file ? state.history.fileError() : state.history.error();
        if (!stale) {
          state.finishInitial({ entries: [], cursor: null, complete: true, scanned: 0 });
          await state.initial;
        }
        return error;
      }, stale);
      if (stale) expect(error).toBeNull();
      else expect(error).toContain('Cancellation transport failed');
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
