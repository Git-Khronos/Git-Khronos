import { expect, test } from '@playwright/test';

for (const kind of ['head', 'checkout', 'rename-branch', 'discard', 'saved-discard']) {
  for (const direction of ['undo', 'redo']) {
    const discard = kind === 'discard' || kind === 'saved-discard';
    const scenarios = ['unrelated-error', 'dismissed-failure', ...(discard ? ['dismissed-unknown-failure'] : [])];
    for (const scenario of scenarios) {
      test(`${direction} ${kind} tracks its own outcome during ${scenario}`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.commit-row').first()).toBeVisible();
        await page.evaluate(({ kind, direction, scenario }) => {
          const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
          const repository = git.repository();
          const other = { ...repository, id: 'other-replay', path: '/fixture/other-replay', name: 'Other replay' };
          const entry = { label: 'Test action', undone: direction === 'redo',
            ...(kind === 'head' ? { kind, beforeOid: 'before-head', afterOid: 'after-head' }
              : kind === 'checkout' ? { kind, beforeBranch: 'before-branch', afterBranch: 'after-branch' }
              : kind === 'rename-branch' ? { kind, beforeName: 'before-name', afterName: 'after-name' }
              : { kind: 'discard', ...(kind === 'saved-discard' ? { recoveryId: 'saved-recovery' } : {}) }) };
          git.repositories.set([repository, other]);
          git.operationHistory.set({ [repository.id]: entry });
          git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
          const state: any = { git, repository, entry, calls: [] };
          (window as any).__historyReplayTest = state;
          (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: unknown) => {
            state.calls.push({ command, args });
            if (command === 'inspect_commit') return Promise.reject({ message: 'Other inspection failed' });
            if (command === 'refresh_repository' || command === 'refresh_repository_status') {
              if (scenario !== 'unrelated-error') {
                if (git.error()) state.dismissedError = git.error();
                git.dismissError();
              }
              return Promise.resolve(command === 'refresh_repository' ? repository : repository.status);
            }
            return new Promise((resolve, reject) => {
              state.finish = () => {
                if (scenario === 'unrelated-error') {
                  resolve(command === 'apply_saved_discard' ? { status: repository.status, affectedToolbar: false } : repository);
                } else if (scenario === 'dismissed-unknown-failure') {
                  reject({ message: 'Desktop connection interrupted' });
                } else {
                  reject({ ...(kind === 'discard' || kind === 'saved-discard' ? { kind: 'discardRecoveryUnavailable' } : {}),
                    message: 'Replay refused' });
                }
              };
            });
          } };
          state.pending = git[direction]();
        }, { kind, direction, scenario });
        await page.locator('[data-repository-tab-id="other-replay"]').click();
        const result = await page.evaluate(async scenario => {
          const state = (window as any).__historyReplayTest;
          if (scenario === 'unrelated-error') await state.git.inspectCommit(state.git.repository().headOid);
          state.finish();
          await state.pending;
          return { entry: state.git.operationHistory()[state.repository.id] ?? null, error: state.git.error(),
            dismissedError: state.dismissedError,
            repoId: state.repository.id, calls: state.calls, active: state.git.activeRepositoryId() };
        }, scenario);
        if (scenario === 'dismissed-unknown-failure') {
          expect(result.entry).toBeNull();
          expect(result.dismissedError).toContain('Desktop connection interrupted');
          expect(result.dismissedError).toContain('recovery action may have changed files or recovery state');
        } else {
          expect(result.entry).toMatchObject({ undone: scenario === 'unrelated-error' ? direction === 'undo' : direction === 'redo' });
          if (scenario === 'dismissed-failure') expect(result.dismissedError).toContain('Replay refused');
        }
        expect(result.error).toBe(scenario === 'unrelated-error' ? 'Other inspection failed' : null);
        expect(result.active).toBe('other-replay');
        const mutation = result.calls[0];
        expect(mutation.args.repoId).toBe(result.repoId);
        if (kind === 'head') {
          expect(mutation.command).toBe('move_head');
          expect(mutation.args).toMatchObject({
            expectedOid: direction === 'undo' ? 'after-head' : 'before-head',
            targetOid: direction === 'undo' ? 'before-head' : 'after-head',
          });
        } else if (kind === 'checkout') {
          expect(mutation.command).toBe('checkout_branch');
          expect(mutation.args.name).toBe(direction === 'undo' ? 'before-branch' : 'after-branch');
        } else if (kind === 'rename-branch') {
          expect(mutation.command).toBe('rename_branch');
          expect(mutation.args).toMatchObject({
            oldName: direction === 'undo' ? 'after-name' : 'before-name',
            newName: direction === 'undo' ? 'before-name' : 'after-name',
          });
        } else if (kind === 'saved-discard') {
          expect(mutation.command).toBe('apply_saved_discard');
          expect(mutation.args).toMatchObject({ id: 'saved-recovery', reverse: direction === 'redo' });
        } else expect(mutation.command).toBe(`${direction}_discard`);
      });
    }
  }
}

for (const direction of ['undo', 'redo']) {
  test(`${direction} completion cannot mark a newer history entry`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async direction => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const entry = { kind: 'head', label: 'Old action', beforeOid: 'old-before', afterOid: 'old-after',
        undone: direction === 'redo' };
      const newer = { ...entry, label: 'Newer action', beforeOid: 'new-before', afterOid: 'new-after' };
      git.operationHistory.set({ [repository.id]: entry });
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      let finish!: (snapshot: unknown) => void;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => command === 'move_head'
        ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(repository.status) };
      const pending = git[direction]();
      git.operationHistory.set({ [repository.id]: newer });
      finish(repository);
      await pending;
      return { actual: git.operationHistory()[repository.id], expected: newer };
    }, direction);
    expect(result.actual).toEqual(result.expected);
  });
}
