import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const original = git.repository();
    const status = { ...original.status, staged: 0, unstaged: 2, untracked: 0, conflicted: 0, entryCount: 2,
      entries: ['file.txt', 'new.txt'].map(path => ({ path, indexStatus: ' ', worktreeStatus: 'M', conflicted: false })) };
    const repository = { ...original, status };
    git.repositories.set([repository, { ...repository, id: 'other-diff', path: '/fixture/other-diff' }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n-old\n+new\n keep\n';
    const state: any = { app, git, repository, patch, calls: [], outcome: 'success' };
    (window as any).__diffAction = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'inspect_working_tree_file') return Promise.resolve({ path: args.path, staged: args.staged,
        patch: state.patch, truncated: false });
      if (command === 'apply_working_tree_hunk' || command === 'apply_working_tree_lines') return new Promise((resolve, reject) => {
        state.finish = () => state.outcome === 'dismissed-error' || (state.rejectStale && args.expectedPatch !== state.patch)
          ? reject({ kind: 'staleDiff', message: 'Reviewed patch changed; nothing applied' }) : resolve(status);
      });
      if (command === 'ignore_path' && state.outcome === 'ignore-precedence') return Promise.reject({
        kind: 'ignoreRuleIneffective',
        message: 'The rule was added to the root .gitignore, but Git does not ignore the selected file.',
        hint: 'The index was not changed. Review higher-priority ignore rules and refresh before retrying.',
      });
      if (command === 'ignore_path' && 'ignoreFailure' in state) {
        if (state.deferIgnore) return new Promise((_, reject) => {
          state.finishIgnore = () => reject(state.ignoreFailure);
        });
        return Promise.reject(state.ignoreFailure);
      }
      if (command === 'ignore_path' && state.deferIgnoreSuccess) return new Promise(resolve => {
        state.finishIgnore = () => resolve(repository);
      });
      if (command === 'ignore_path' && state.ignoreSnapshot) return Promise.resolve(state.ignoreSnapshot);
      if (command === 'refresh_repository' && state.refreshFailure) {
        if (state.deferRefresh) return new Promise((_, reject) => {
          state.finishRefresh = () => reject(state.refreshFailure);
        });
        return Promise.reject(state.refreshFailure);
      }
      if (command === 'refresh_repository_status') {
        if (state.outcome === 'dismissed-error') git.dismissError();
        if (state.statusRefreshFailure) return Promise.reject(state.statusRefreshFailure);
        return Promise.resolve(status);
      }
      if (command === 'open_repository_in_file_manager') return Promise.reject({ message: 'Unrelated folder error' });
      return Promise.resolve(repository);
    } };
    app.selectWip();
    await app.inspectWorkingTreeFile('file.txt', false);
    app.toggleDiffLineSelection({ hunkIndex: 0, changeIndices: [0] });
  });
}

for (const action of ['discard', 'ignore', 'restore-commit']) {
  test(`file confirmation ${action} stays bound to its original repository`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async action => {
      const state = (window as any).__diffAction;
      const { app, git } = state;
      if (action === 'restore-commit') {
        app.commitFileContextMenu.set({ file: { path: 'file.txt' }, oid: state.repository.headOid });
        app.requestRestoreCommitFile();
      } else {
        app.fileContextMenu.set({ path: 'file.txt', staged: false, untracked: false });
        if (action === 'discard') app.requestDiscardFile();
        else await app.requestIgnoreFile('file');
      }
      const repositoryId = app.pendingFileAction().repositoryId;
      git.activateRepository('other-diff');
      const count = state.calls.length;
      await app.confirmFileAction();
      return { repositoryId, expected: state.repository.id, calls: state.calls.slice(count), error: git.error() };
    }, action);
    expect(result.repositoryId).toBe(result.expected);
    expect(result.calls).toEqual([]);
    expect(result.error).toContain('active repository changed');
  });
}

test('ignore reports an ineffective rule without claiming the file was untracked', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).__diffAction;
    state.outcome = 'ignore-precedence';
    state.app.fileContextMenu.set({ path: 'file.txt', staged: false, untracked: false });
    await state.app.requestIgnoreFile('extension');
  });
  const dialog = page.getByRole('alertdialog', { name: 'file.txt' });
  await dialog.getByRole('button', { name: 'Ignore and stop tracking' }).click();
  const error = page.getByRole('alert');
  await expect(error).toContainText('The rule was added to the root .gitignore');
  await expect(error).toContainText('The index was not changed');
  expect(await page.evaluate(() => {
    const state = (window as any).__diffAction;
    return {
      calls: state.calls.filter((call: any) => call.command === 'ignore_path'),
      refreshed: state.calls.some((call: any) => call.command === 'refresh_repository'),
      activity: state.git.activity(),
    };
  })).toEqual({
    calls: [expect.objectContaining({ args: expect.objectContaining({ path: 'file.txt', patternKind: 'extension', stopTracking: true }) })],
    refreshed: true,
    activity: 'Operation failed',
  });
});

test('ignoring an untracked file still succeeds without a confirmation', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (window as any).__diffAction;
    state.app.fileContextMenu.set({ path: 'file.txt', staged: false, untracked: true });
    await state.app.requestIgnoreFile('file');
    return {
      calls: state.calls.filter((call: any) => call.command === 'ignore_path'),
      error: state.git.error(),
      activity: state.git.activity(),
      dialog: state.app.pendingFileAction(),
    };
  });
  expect(result.calls).toEqual([expect.objectContaining({ args: expect.objectContaining({
    path: 'file.txt', patternKind: 'file', stopTracking: false,
  }) })]);
  expect(result.error).toBeNull();
  expect(result.activity).toBe('Ignore rule added');
  expect(result.dialog).toBeNull();
});

test('ignore options use Git path separators for literal backslashes and extensions', async ({ page }) => {
  await prepare(page);
  for (const { path, extension, directory } of [
    { path: 'report.part\\suffix', extension: true, directory: false },
    { path: 'folder\\name', extension: false, directory: false },
    { path: 'folder\\name/report.part\\suffix', extension: true, directory: true },
    { path: 'nested/Makefile', extension: false, directory: true },
    { path: 'nested/.env', extension: false, directory: true },
    { path: 'nested/.env.local', extension: true, directory: true },
    { path: 'report.', extension: false, directory: false },
  ]) {
    await page.evaluate(path => {
      (window as any).__diffAction.app.fileContextMenu.set({
        path, x: 20, y: 20, content: null, staged: false, untracked: true, conflicted: false,
      });
    }, path);
    const menu = page.locator('.file-context-menu');
    await expect(menu.locator('.context-heading')).toContainText(path);
    const extensionAction = menu.getByRole('menuitem', { name: 'Ignore all with this extension', exact: true });
    const directoryAction = menu.getByRole('menuitem', { name: 'Ignore directory', exact: true });
    if (extension) await expect(extensionAction, path).toBeEnabled();
    else await expect(extensionAction, path).toBeDisabled();
    if (directory) await expect(directoryAction, path).toBeEnabled();
    else await expect(directoryAction, path).toBeDisabled();
  }
});

test('a literal backslash filename reaches the extension action unchanged', async ({ page }) => {
  await prepare(page);
  const path = 'report.part\\suffix';
  await page.evaluate(path => {
    const state = (window as any).__diffAction;
    const status = {
      ...state.repository.status, staged: 0, unstaged: 0, untracked: 1, entryCount: 1,
      entries: [{ path, indexStatus: '?', worktreeStatus: '?', conflicted: false }],
    };
    state.git.repositories.update((repositories: any[]) => repositories.map(repository =>
      repository.id === state.repository.id ? { ...repository, status } : repository));
  }, path);

  await page.getByRole('button', { name: `View changes in ${path}`, exact: true }).click({ button: 'right' });
  const menu = page.locator('.file-context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Ignore directory', exact: true })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Ignore all with this extension', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__diffAction.calls
    .filter((call: any) => call.command === 'ignore_path')
    .map((call: any) => call.args))).toEqual([
    expect.objectContaining({ path, patternKind: 'extension', stopTracking: false }),
  ]);
});

for (const { pattern, menuName, scope } of [
  { pattern: 'file', menuName: 'Ignore file and stop tracking…', scope: null },
  { pattern: 'extension', menuName: 'Ignore all with this extension and stop tracking…',
    scope: 'other untracked files and directories with this extension throughout the repository' },
  { pattern: 'directory', menuName: 'Ignore directory and stop tracking…',
    scope: 'other untracked files in this directory and its subdirectories' },
]) {
  test(`ignore ${pattern} confirmation explains its scope and untracks only the selected file`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => {
      (window as any).__diffAction.app.fileContextMenu.set({
        path: 'nested/file.txt', x: 20, y: 20, content: null, staged: false, untracked: false, conflicted: false,
      });
    });
    await page.locator('.file-context-menu').getByRole('menuitem', { name: menuName, exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'nested/file.txt' });
    await expect(dialog).toContainText('stages removal of this file from Git’s index');
    await expect(dialog).toContainText('The file stays on disk');
    if (scope) {
      await expect(dialog).toContainText(scope);
      await expect(dialog).toContainText('Other tracked files stay tracked');
    } else {
      await expect(dialog).not.toContainText('Other tracked files stay tracked');
    }
    await dialog.getByRole('button', { name: 'Ignore and stop tracking', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__diffAction.calls
      .filter((call: any) => call.command === 'ignore_path')
      .map((call: any) => call.args))).toEqual([
      expect.objectContaining({ path: 'nested/file.txt', patternKind: pattern, stopTracking: true }),
    ]);
  });
}

test('ignore warns about an interrupted response even when refresh also fails', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).__diffAction;
    state.ignoreFailure = { message: 'Desktop connection interrupted.' };
    state.refreshFailure = { message: 'Snapshot unavailable.' };
    state.statusRefreshFailure = { message: 'Status unavailable.' };
    state.app.fileContextMenu.set({ path: 'file.txt', staged: false, untracked: false });
    await state.app.requestIgnoreFile('extension');
  });
  const dialog = page.getByRole('alertdialog', { name: 'file.txt' });
  await dialog.getByRole('button', { name: 'Ignore and stop tracking' }).click();
  const error = page.getByRole('alert');
  await expect(error).toContainText('ignore operation could not be confirmed');
  await expect(error).toContainText('Desktop connection interrupted');
  await expect(error).toContainText('.gitignore file or Git index may have changed');
  await expect(error).toContainText('inspect both before retrying');
  await expect(error).toContainText('Repository refresh also failed: Snapshot unavailable');
  const result = await page.evaluate(() => {
    const state = (window as any).__diffAction;
    return {
      diff: state.git.workingTreeFileDiff(),
      calls: state.calls.filter((call: any) => ['ignore_path', 'refresh_repository', 'refresh_repository_status'].includes(call.command)),
    };
  });
  expect(result.diff).toBeNull();
  expect(result.calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ command: 'ignore_path', args: expect.objectContaining({
      path: 'file.txt', patternKind: 'extension', stopTracking: true,
    }) }),
    expect.objectContaining({ command: 'refresh_repository' }),
    expect.objectContaining({ command: 'refresh_repository_status' }),
  ]));
});

for (const failure of [
  { kind: 'backgroundTaskFailure', message: 'Worker interrupted.',
    hint: 'Try the operation again or reopen the repository.' },
  { kind: 'gitFailure', message: 'Git could not finish removing the index entry.' },
  { kind: 'writeIgnoreFileFailed', message: 'Could not remove the ignore lock.' },
  { kind: 'newBackendFailure', message: 'Unexpected backend response.' },
]) {
  test(`ignore treats ${failure.kind} as an uncertain outcome`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async failure => {
      const state = (window as any).__diffAction;
      state.ignoreFailure = failure;
      state.refreshFailure = { message: 'Snapshot unavailable.' };
      await state.git.ignorePath('file.txt', 'file', true);
      return { error: state.git.error(), diff: state.git.workingTreeFileDiff() };
    }, failure);
    expect(result.error).toContain(failure.message);
    expect(result.error).toContain('.gitignore file or Git index may have changed');
    expect(result.error).toContain('inspect both before retrying');
    if ('hint' in failure && failure.hint) {
      expect(result.error).toContain(failure.hint);
      expect(result.error.indexOf('before retrying')).toBeLessThan(result.error.indexOf(failure.hint));
    }
    expect(result.diff).toBeNull();
  });
}

for (const failure of [null, 'IPC disconnected']) {
  test(`ignore treats a ${failure === null ? 'null' : 'string'} rejection as uncertain`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async failure => {
      const state = (window as any).__diffAction;
      state.ignoreFailure = failure;
      await state.git.ignorePath('file.txt', 'file', false);
      return { error: state.git.error(), diff: state.git.workingTreeFileDiff(),
        refreshed: state.calls.some((call: any) => call.command === 'refresh_repository') };
    }, failure);
    expect(result.error).toContain(String(failure));
    expect(result.error).toContain('.gitignore file or Git index may have changed');
    expect(result.error).toContain('inspect both before retrying');
    expect(result.diff).toBeNull();
    expect(result.refreshed).toBe(true);
  });
}

for (const failure of [
  { kind: 'trackedFileRequiresUntracking', message: 'Git cannot ignore a file that is still tracked.',
    hint: 'Choose Ignore and stop tracking instead.' },
  { kind: 'ignoreFileChanged', message: 'A .gitignore file appeared before the rule could be published.',
    hint: 'Review the existing .gitignore before retrying.' },
  { kind: 'ignoreLockUnavailable', message: 'The .gitignore lock already exists.',
    hint: 'Wait for the other writer or inspect .gitignore.lock before retrying.' },
  { kind: 'unsupportedPlatform', message: 'Ignore rules cannot be published safely on this platform.',
    hint: 'Edit .gitignore manually instead.' },
]) {
  test(`definite ${failure.kind} ignore refusal retains the original diff if refresh fails`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async failure => {
      const state = (window as any).__diffAction;
      state.ignoreFailure = failure;
      state.refreshFailure = { message: 'Snapshot unavailable.' };
      const expected = state.git.workingTreeFileDiff();
      await state.git.ignorePath('file.txt', 'file', false);
      return { error: state.git.error(), expected, actual: state.git.workingTreeFileDiff() };
    }, failure);
    expect(result.error).toContain(failure.message);
    expect(result.error).toContain(failure.hint);
    expect(result.error).toContain('Repository refresh also failed: Snapshot unavailable');
    expect(result.error).not.toContain('may have changed');
    expect(result.actual).toEqual(result.expected);
  });
}

for (const failure of [
  { kind: 'ignoreRuleSyncFailed', message: 'The ignore rule was added, but persistence could not be confirmed.',
    hint: 'The index was not changed. Review .gitignore before retrying.' },
  { kind: 'ignoreRuleVerificationFailed', message: 'The ignore rule was added, but Git could not verify it.',
    hint: 'The index was not changed. Review .gitignore before retrying.' },
  { kind: 'ignoreRuleIneffective', message: 'The ignore rule was added, but does not ignore the selected file.',
    hint: 'The index was not changed. Review higher-priority rules before retrying.' },
  { kind: 'ignoreRuleAddedButUntrackingFailed', message: 'The ignore rule was added, but untracking could not be confirmed.',
    hint: 'Inspect .gitignore and the index before retrying.' },
  { kind: 'ignoreRuleRefreshFailed', message: 'The ignore operation completed, but the repository view could not be refreshed.',
    hint: 'Refresh and inspect .gitignore and the index before retrying.' },
  { kind: 'ignoreRulePublicationUncertain', message: 'Could not confirm safe publication of the ignore rule.',
    hint: 'No overwrite fallback was attempted and the index was not changed. Check hard-link support and, on Linux, /proc/self/fd; inspect .gitignore and .gitignore.lock before retrying.' },
  { kind: 'ignoreRuleLockCleanupFailed', message: 'The ignore rule was published, but its .gitignore.lock could not be safely removed.',
    hint: 'The index was not changed. Inspect .gitignore and its lock before retrying.' },
  { kind: 'ignoreLockChanged', message: 'Could not confirm ownership of .gitignore.lock before publication.',
    hint: 'This operation did not publish the rule or change the index. Inspect .gitignore, the lock, and any moved staging file before retrying.' },
  { kind: 'ignoreLockCleanupFailed',
    message: 'A .gitignore file appeared before the rule could be published. The .gitignore.lock could not be safely removed.',
    hint: 'Review the existing .gitignore. Inspect .gitignore, .gitignore.lock, and the index before retrying.' },
]) {
  test(`ignore preserves specific ${failure.kind} details`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async failure => {
      const state = (window as any).__diffAction;
      state.ignoreFailure = failure;
      state.refreshFailure = { message: 'Snapshot unavailable.' };
      await state.git.ignorePath('file.txt', 'file', true);
      return { error: state.git.error(), diff: state.git.workingTreeFileDiff() };
    }, failure);
    expect(result.error).toContain(failure.message);
    expect(result.error).toContain(failure.hint);
    expect(result.error).toContain('Repository refresh also failed: Snapshot unavailable');
    expect(result.error).not.toContain('ignore operation could not be confirmed');
    expect(result.diff).toBeNull();
  });
}

test('ignore reports a completed mutation when the returned snapshot is unusable', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (window as any).__diffAction;
    state.ignoreSnapshot = { ...state.repository, id: 'wrong-snapshot' };
    state.refreshFailure = { message: 'Snapshot unavailable.' };
    await state.git.ignorePath('file.txt', 'file', true);
    return {
      error: state.git.error(),
      diff: state.git.workingTreeFileDiff(),
      repositoryIds: state.git.repositories().map((repository: any) => repository.id),
    };
  });
  expect(result.error).toContain('ignore operation completed');
  expect(result.error).toContain('returned snapshot belongs to a different repository');
  expect(result.error).toContain('inspect .gitignore and the index before retrying');
  expect(result.error).toContain('Repository refresh also failed: Snapshot unavailable');
  expect(result.diff).toBeNull();
  expect(result.repositoryIds).not.toContain('wrong-snapshot');
});

test('ignore reports completed work when reconciling a stale snapshot fails', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).__diffAction;
    state.deferIgnoreSuccess = true;
    state.refreshFailure = { message: 'Snapshot unavailable.' };
    state.pendingIgnore = state.git.ignorePath('file.txt', 'file', true);
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__diffAction.finishIgnore)).toBe('function');
  const result = await page.evaluate(async () => {
    const state = (window as any).__diffAction;
    state.git.bumpStatusGeneration(state.repository.id);
    state.finishIgnore();
    await state.pendingIgnore;
    return { error: state.git.error(), diff: state.git.workingTreeFileDiff(),
      refreshCalls: state.calls.filter((call: any) => call.command === 'refresh_repository').length };
  });
  expect(result.error).toContain('ignore operation completed');
  expect(result.error).toContain('repository view could not be refreshed: Snapshot unavailable');
  expect(result.error).toContain('Repository refresh also failed: Snapshot unavailable');
  expect(result.error).toContain('inspect .gitignore and the index before retrying');
  expect(result.refreshCalls).toBe(2);
  expect(result.diff).toBeNull();
});

for (const scenario of ['new-file', 'reopened', 'other-tab', 'dismissed-error', 'unrelated-error']) {
  test(`uncertain ignore preserves newer state after ${scenario}`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => {
      const state = (window as any).__diffAction;
      state.ignoreFailure = { message: 'Desktop connection interrupted.' };
      state.refreshFailure = { message: 'Snapshot unavailable.' };
      state.deferIgnore = true;
      state.deferRefresh = true;
      state.pendingIgnore = state.git.ignorePath('file.txt', 'file', true);
    });
    await expect.poll(() => page.evaluate(() => typeof (window as any).__diffAction.finishIgnore)).toBe('function');
    await page.evaluate(async scenario => {
      const state = (window as any).__diffAction;
      if (scenario === 'other-tab') state.git.activateRepository('other-diff');
      if (['new-file', 'reopened', 'other-tab'].includes(scenario)) {
        if (scenario === 'reopened') state.app.closeDiffViewer();
        await state.app.inspectWorkingTreeFile(scenario === 'new-file' ? 'new.txt' : 'file.txt', false);
      }
      state.expectedDiff = state.git.workingTreeFileDiff();
      state.finishIgnore();
    }, scenario);
    await expect.poll(() => page.evaluate(() => typeof (window as any).__diffAction.finishRefresh)).toBe('function');
    const result = await page.evaluate(async scenario => {
      const state = (window as any).__diffAction;
      if (scenario === 'dismissed-error') state.git.dismissError();
      if (scenario === 'unrelated-error') await state.git.openRepositoryInFileManager('other-diff');
      state.finishRefresh();
      await state.pendingIgnore;
      return {
        error: state.git.error(),
        expectedDiff: state.expectedDiff,
        actualDiff: state.git.workingTreeFileDiff(),
        active: state.git.activeRepositoryId(),
      };
    }, scenario);
    if (['new-file', 'reopened', 'other-tab'].includes(scenario)) {
      expect(result.actualDiff).toEqual(result.expectedDiff);
      expect(result.error).toContain('Repository refresh also failed: Snapshot unavailable');
    } else {
      expect(result.actualDiff).toBeNull();
      expect(result.error).toBe(scenario === 'dismissed-error' ? null : 'Unrelated folder error');
    }
    if (scenario === 'other-tab') expect(result.active).toBe('other-diff');
  });
}

test('discarding selected lines refuses external edits and retains the reviewed selection', async ({ page }) => {
  await prepare(page);
  const diff = page.getByLabel('Diff viewer', { exact: true });
  await diff.getByRole('button', { name: 'Clear selected lines', exact: true }).click();
  await diff.getByRole('button', { name: /Select added line/ }).click();
  await diff.getByRole('group', { name: 'Selected line actions', exact: true }).getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  const selected = await page.evaluate(() => {
    const state = (window as any).__diffAction;
    state.rejectStale = true;
    state.patch = state.patch.replace('+new', '+external edit');
    return state.app.selectedDiffLineGroups();
  });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard selected lines', exact: true }).click();
  await page.evaluate(() => (window as any).__diffAction.finish());
  await expect.poll(() => page.evaluate(() => (window as any).__diffAction.git.busy())).toBe(false);
  expect(await page.evaluate(() => (window as any).__diffAction.git.error())).toContain('nothing applied');
  expect(await page.evaluate(() => (window as any).__diffAction.app.selectedDiffLineGroups())).toEqual(selected);
});

for (const action of ['hunk', 'lines', 'discard-lines']) {
  for (const scenario of ['unchanged', 'new-file', 'new-selection', 'reopened', 'other-tab', 'dismissed-error', 'unrelated-error']) {
    test(`diff action ${action} preserves selection ownership after ${scenario}`, async ({ page }) => {
      await prepare(page);
      const result = await page.evaluate(async ({ action, scenario }) => {
        const state = (window as any).__diffAction;
        const { app, git } = state;
        state.outcome = scenario;
        if (action === 'discard-lines') app.requestDiscardSelectedDiffLines();
        const pending = action === 'hunk' ? app.applyHunk('file.txt', false, 0)
          : action === 'lines' ? app.applySelectedDiffLines() : app.confirmFileAction();
        if (scenario === 'other-tab') git.activateRepository('other-diff');
        if (['new-file', 'reopened', 'other-tab'].includes(scenario)) {
          if (scenario === 'reopened') app.closeDiffViewer();
          await app.inspectWorkingTreeFile(scenario === 'new-file' ? 'new.txt' : 'file.txt', false);
        }
        if (['new-file', 'reopened', 'other-tab', 'new-selection'].includes(scenario)) {
          app.toggleDiffLineSelection({ hunkIndex: 0, changeIndices: [1] });
        }
        if (scenario === 'unrelated-error') await git.openRepositoryInFileManager('other-diff');
        const expected = app.selectedDiffLineGroups();
        state.finish();
        await pending;
        return { expected, actual: app.selectedDiffLineGroups(),
          call: state.calls.find((call: any) => call.command.startsWith('apply_working_tree_')) };
      }, { action, scenario });
      expect(result.actual).toEqual(['unchanged', 'unrelated-error'].includes(scenario) ? [] : result.expected);
      expect(result.call.args).toMatchObject({ path: 'file.txt', staged: false,
        action: action === 'discard-lines' ? 'discard' : 'stage' });
    });
  }
}

for (const action of ['hunk', 'lines']) {
  test(`discard ${action} submits the patch reviewed before confirmation`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async action => {
      const state = (window as any).__diffAction;
      const reviewed = state.git.workingTreeFileDiff().patch;
      if (action === 'hunk') state.app.requestDiscardHunk('file.txt', 0);
      else state.app.requestDiscardSelectedDiffLines();
      state.patch = reviewed.replace('+new', '+external edit');
      await state.git.inspectWorkingTreeFile('file.txt', false);
      const pending = state.app.confirmFileAction();
      state.finish();
      await pending;
      return { reviewed, call: state.calls.find((call: any) => call.command.startsWith('apply_working_tree_')) };
    }, action);
    expect(result.call.args.expectedPatch).toBe(result.reviewed);
  });

  test(`discard ${action} refuses confirmation in a different repository`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async action => {
      const state = (window as any).__diffAction;
      if (action === 'hunk') state.app.requestDiscardHunk('file.txt', 0);
      else state.app.requestDiscardSelectedDiffLines();
      state.git.activateRepository('other-diff');
      const pending = state.app.confirmFileAction();
      if (state.finish) state.finish();
      await pending;
      return { calls: state.calls.filter((call: any) => call.command.startsWith('apply_working_tree_')), error: state.git.error() };
    }, action);
    expect(result.calls).toEqual([]);
    expect(result.error).toContain('active repository changed');
  });
}
