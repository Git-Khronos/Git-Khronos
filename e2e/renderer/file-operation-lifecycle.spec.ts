import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const original = git.repository();
    await git.inspectCommit(original.headOid);
    const details = git.commitDetails();
    const entries = ['first.txt', 'second.txt'].map(path => ({ path, indexStatus: ' ', worktreeStatus: 'M', conflicted: false }));
    const before = { ...original.status, entries, entryCount: 2, staged: 0, unstaged: 2, untracked: 0, conflicted: 0 };
    const discarded = { ...before, entries: [entries[1]], entryCount: 1, unstaged: 1 };
    const fresh = { ...discarded, staged: 1, unstaged: 0, entries: [{ ...entries[1], indexStatus: 'M', worktreeStatus: ' ' }] };
    const repository = { ...original, status: before };
    const state: any = { app, git, repository, before, discarded, fresh, details, calls: [], outcome: 'success',
      preview: { token: 'reviewed-discard', paths: ['first.txt'], skippedPaths: [], untracked: 0 } };
    (window as any).__fileOperation = state;
    git.repositories.set([repository, { ...repository, id: 'file-other', path: '/fixture/file-other' }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'discard_changes' || command === 'restore_files_from_commit' || command === 'stage_path') return new Promise((resolve, reject) => {
        const finish = () => state.outcome === 'dismissed-error' ? reject({ message: 'File operation refused' })
          : resolve(command === 'discard_changes' ? { id: 'capture-1', status: discarded }
            : command === 'stage_path' ? fresh : { ...repository, status: fresh });
        if (command === 'stage_path') state.finishStage = finish;
        else state.finish = finish;
      });
      if (command === 'refresh_repository_status') {
        if (state.outcome === 'dismissed-error') git.dismissError();
        return Promise.resolve(fresh);
      }
      if (command === 'refresh_repository' || command === 'open_repository') return Promise.resolve({ ...repository, status: fresh });
      if (command === 'inspect_working_tree_file') return Promise.resolve({ path: args.path, staged: args.staged, patch: 'diff fixture', truncated: false });
      if (command === 'inspect_commit') return Promise.resolve({ ...details, oid: args.oid });
      if (command === 'inspect_commit_file') return Promise.resolve({ path: args.path, patch: 'commit diff fixture', truncated: false });
      if (command === 'inspect_conflict') return Promise.resolve({ path: args.path, ancestor: '', current: 'current', incoming: 'incoming',
        output: 'draft', binary: false, truncated: false, editable: true, state: 'reviewed', currentExists: true, incomingExists: true, submodule: false });
      if (command === 'open_repository_in_file_manager') return Promise.reject({ message: 'Unrelated folder failure' });
      return Promise.resolve(null);
    } };
    app.selectWip();
    await app.inspectWorkingTreeFile('first.txt', false);
  });
}

test('bulk discard browser preview keeps staging intact without a native mutation', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (window as any).__fileOperation;
    // Install the preview's starting status in the same turn as its mutation;
    // native-mode focus refreshes may have completed since prepare returned.
    state.git.repositories.update((repositories: any[]) => repositories.map(repository =>
      repository.id === state.repository.id ? state.repository : repository));
    state.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'browser preview' }));
    const succeeded = await state.git.discardPrepared(state.preview, state.repository.id);
    return { succeeded, actual: state.git.repository().status, expected: state.discarded,
      nativeCalls: state.calls.filter((call: any) => call.command === 'discard_changes') };
  });
  expect(result.succeeded).toBe(true);
  expect(result.actual).toEqual(result.expected);
  expect(result.nativeCalls).toEqual([]);
});

for (const navigation of ['unchanged', 'new-file', 'closed-diff', 'other-tab', 'new-conflict']) {
  test(`bulk discard preserves inspection after ${navigation}`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async navigation => {
      const { app, git, repository, preview } = (window as any).__fileOperation;
      const state = (window as any).__fileOperation;
      const pending = git.discardPrepared(preview, repository.id);
      if (navigation === 'other-tab') git.activateRepository('file-other');
      if (navigation === 'closed-diff') { app.closeDiffViewer(); git.clearWorkingTreeInspection(); }
      if (['other-tab', 'new-file'].includes(navigation)) await app.inspectWorkingTreeFile('second.txt', false);
      if (navigation === 'new-conflict') await git.inspectConflict('second.txt');
      const expected = { diff: git.workingTreeFileDiff(), conflict: git.conflictDetails(), selected: git.selectedWorkingTreeFile() };
      state.finish();
      await pending;
      return { expected, actual: { diff: git.workingTreeFileDiff(), conflict: git.conflictDetails(), selected: git.selectedWorkingTreeFile() },
        recovery: git.operationHistory()[repository.id] };
    }, navigation);
    expect(result.actual).toEqual(navigation === 'unchanged' || navigation === 'new-conflict'
      ? { diff: null, conflict: navigation === 'new-conflict' ? result.expected.conflict : null, selected: null }
      : result.expected);
    expect(result.recovery).toMatchObject({ kind: 'discard', recoveryId: 'capture-1' });
  });
}

for (const order of ['discard-first', 'stage-first']) {
  test(`bulk discard and stage reconcile status in ${order} reply order`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async order => {
      const state = (window as any).__fileOperation;
      const discard = state.git.discardPrepared(state.preview, state.repository.id);
      const stage = state.git.stagePath('second.txt');
      if (order === 'discard-first') { state.finish(); await discard; state.finishStage(); }
      else { state.finishStage(); await stage; state.finish(); }
      await Promise.all([discard, stage]);
      return { actual: state.git.repository().status, expected: state.fresh };
    }, order);
    expect(result.actual).toEqual(result.expected);
  });
}

test('bulk discard reconciles a reply from a closed and reopened session', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (window as any).__fileOperation;
    const pending = state.git.discardPrepared(state.preview, state.repository.id);
    state.git.closeRepository(state.repository.id);
    await state.git.openRepository(state.repository.path);
    state.finish();
    await pending;
    return { actual: state.git.repository().status, expected: state.fresh };
  });
  expect(result.actual).toEqual(result.expected);
});

for (const scenario of ['unchanged', 'new-selection', 'other-tab', 'dismissed-error', 'unrelated-error']) {
  test(`bulk discard UI cleanup respects ${scenario}`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async scenario => {
      const state = (window as any).__fileOperation;
      const { app, git } = state;
      state.outcome = scenario;
      app.selectedDiscardPaths.set(['first.txt']);
      app.discardSelectionMode.set(true);
      app.openFileConfirmation({ kind: 'discard-bulk', path: 'first.txt', untracked: false, preview: state.preview });
      const pending = app.confirmFileAction();
      if (scenario === 'other-tab') {
        git.activateRepository('file-other');
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        app.discardSelectionMode.set(true);
      }
      if (scenario === 'new-selection' || scenario === 'other-tab') app.selectedDiscardPaths.set(['second.txt']);
      if (scenario === 'unrelated-error') await git.openRepositoryInFileManager('file-other');
      const expected = app.selectedDiscardPaths();
      state.finish();
      await pending;
      return { expected, paths: app.selectedDiscardPaths(), mode: app.discardSelectionMode() };
    }, scenario);
    const completedOriginal = ['unchanged', 'unrelated-error'].includes(scenario);
    expect(result.paths).toEqual(completedOriginal ? [] : result.expected);
    expect(result.mode).toBe(!completedOriginal);
  });
}

for (const scenario of ['unchanged', 'new-commit', 'new-file', 'closed-diff', 'other-tab', 'dismissed-error', 'unrelated-error']) {
  test(`file restore UI cleanup respects ${scenario}`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async scenario => {
      const state = (window as any).__fileOperation;
      const { app, git } = state;
      state.outcome = scenario;
      app.changesOpen.set(false);
      app.selectedCommit.set(state.details.oid);
      git.commitDetails.set(state.details);
      await app.inspectCommitFile({ path: 'first.txt', status: 'M', additions: 1, deletions: 1 });
      app.openFileConfirmation({ kind: 'restore-commit', path: 'first.txt', untracked: false, oid: state.details.oid });
      const pending = app.confirmFileAction();
      if (scenario === 'other-tab') git.activateRepository('file-other');
      if (scenario === 'new-commit' || scenario === 'other-tab') {
        const oid = 'b'.repeat(40);
        app.selectedCommit.set(oid);
        await git.inspectCommit(oid);
      }
      if (scenario === 'new-file') await app.inspectCommitFile({ path: 'second.txt', status: 'M', additions: 1, deletions: 1 });
      if (scenario === 'closed-diff') app.closeDiffViewer();
      if (scenario === 'unrelated-error') await git.openRepositoryInFileManager('file-other');
      const readView = () => ({ wip: app.changesOpen(), commit: app.selectedCommit(), diff: app.activeDiff(), open: app.diffViewerOpen() });
      const expected = readView();
      state.finish();
      await pending;
      return { expected, actual: readView() };
    }, scenario);
    if (['unchanged', 'unrelated-error'].includes(scenario)) expect(result.actual).toMatchObject({ wip: true, commit: null });
    else expect(result.actual).toEqual(result.expected);
  });
}
