import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
});

test('foreground lifetime survives cleared logs and ends only after the last concurrent completion', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    let firstDone!: () => void;
    let secondDone!: () => void;
    const first = git.run('First…', () => new Promise<void>(resolve => { firstDone = resolve; }), null, null, false, false);
    const second = git.run('Second…', () => new Promise<void>(resolve => { secondDone = resolve; }), null, null, false, false);
    git.clearActivityLogs(null);
    const whileRunning = git.busy();
    firstDone();
    const firstOutcome = await first;
    const whileSecondRuns = git.busy();
    secondDone();
    return { whileRunning, firstOutcome, whileSecondRuns, secondOutcome: await second, after: git.busy() };
  });
  expect(result).toEqual({ whileRunning: true, firstOutcome: 'success', whileSecondRuns: true,
    secondOutcome: 'success', after: false });
});

for (const outcome of ['success', 'cancelled']) {
  test(`cancellation acceptance remains distinct from ${outcome} completion and a refused request can retry`, async ({ page }) => {
    const result = await page.evaluate(async outcome => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      let complete!: () => void;
      let fail!: (error: unknown) => void;
      let attempts = 0;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command !== 'cancel_git_operation') throw new Error(`Unexpected ${command}`);
        return Promise.resolve(++attempts > 1);
      } };
      const running = git.run('Transport…', () => new Promise<void>((resolve, reject) => {
        complete = resolve; fail = reject;
      }), null, 'characterized-operation', false, false);
      await git.cancelActiveOperation();
      const refused = { busy: git.busy(), cancelling: git.cancellingOperationIds() };
      await git.cancelActiveOperation();
      await git.cancelActiveOperation();
      const accepted = { busy: git.busy(), cancelling: git.cancellingOperationIds(),
        status: git.activeActivity()?.status };
      if (outcome === 'success') complete();
      else fail({ kind: 'operationCancelled', message: 'Stopped' });
      return { refused, accepted, attempts, outcome: await running,
        busy: git.busy(), cancelling: git.cancellingOperationIds() };
    }, outcome);
    expect(result).toEqual({
      refused: { busy: true, cancelling: [] },
      accepted: { busy: true, cancelling: ['characterized-operation'], status: 'running' },
      attempts: 2, outcome, busy: false, cancelling: [],
    });
  });
}

for (const fails of [false, true]) {
  test(`background fetch owns its repository until ${fails ? 'failure' : 'completion after closure'} and does not retry failures`, async ({ page }) => {
    const result = await page.evaluate(async fails => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      let complete!: (snapshot: unknown) => void;
      let fail!: (error: unknown) => void;
      let calls = 0;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command !== 'sync_repository') throw new Error(`Unexpected ${command}`);
        ++calls;
        return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
      } };
      const fetching = git.fetchInBackground(repository.id);
      const during = { busy: git.backgroundFetchBusy(), repositoryId: git.backgroundFetchRepositoryId() };
      const duplicate = await git.fetchInBackground(repository.id);
      if (fails) fail({ message: 'Authentication refused' });
      else { git.repositories.set([]); complete(repository); }
      const outcome = await fetching;
      const retry = await git.fetchInBackground(repository.id);
      return { during, duplicate, outcome, retry, calls, repositoryId: repository.id,
        after: { busy: git.backgroundFetchBusy(), repositoryId: git.backgroundFetchRepositoryId() },
        error: Boolean(git.backgroundFetchErrors()[repository.id]),
        timestamp: git.backgroundFetchLastAt()[repository.id] ?? null,
        foregroundBusy: git.busy() };
    }, fails);
    expect(result).toEqual({
      during: { busy: true, repositoryId: result.repositoryId },
      duplicate: false, outcome: !fails, retry: false, calls: 1, repositoryId: result.repositoryId,
      after: { busy: false, repositoryId: null }, error: fails, timestamp: null, foregroundBusy: false,
    });
  });
}
