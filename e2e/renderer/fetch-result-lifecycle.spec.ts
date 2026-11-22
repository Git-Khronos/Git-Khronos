import { expect, test } from '@playwright/test';

for (const scenario of ['tab-switch', 'unrelated-error', 'dismissed-failure', 'cancelled', 'reopened-tab', 'wrong-checkout', 'success', 'pull', 'push']) {
  test(`explicit fetch retry state follows its own result: ${scenario}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async scenario => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const other = { ...repository, id: 'other-fetch', path: '/fixture/other-fetch', name: 'Other fetch' };
      git.repositories.set([repository, other]);
      git.backgroundFetchFailures.set({
        [repository.id]: { message: 'Original authentication failure', requiresFetchAll: false },
        [other.id]: { message: 'Other failure', requiresFetchAll: false },
      });
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      let requestedRepo: string | undefined;
      let requestedCommand: string | undefined;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        if (['fetch_repository', 'pull_repository', 'push_repository'].includes(command)) {
          requestedRepo = args.repoId;
          requestedCommand = command;
          return new Promise((yes, no) => { resolve = yes; reject = no; });
        }
        if (command === 'inspect_commit') return Promise.reject({ message: 'Unrelated inspection error' });
        if (command === 'open_repository') return Promise.resolve(repository);
        if (command === 'refresh_repository') {
          // Dismissing an error while its recovery read is pending must not
          // turn a failed fetch into a successful authentication retry.
          git.dismissError();
          return Promise.resolve(repository);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.resolve(null);
      } };
      const pending = scenario === 'pull' ? git.pull() :
        git.remote(scenario === 'push' ? 'push_repository' : 'fetch_repository');
      if (scenario === 'tab-switch' || scenario === 'unrelated-error') git.activateRepository(other.id);
      if (scenario === 'unrelated-error') await git.inspectCommit(other.headOid);
      if (scenario === 'reopened-tab') {
        git.closeRepository(repository.id);
        await git.openRepository(repository.path);
      }
      if (scenario === 'dismissed-failure') reject({ message: 'Fetch authentication failed' });
      else if (scenario === 'cancelled') reject({ kind: 'operationCancelled', message: 'Cancelled', hint: null });
      else resolve(scenario === 'wrong-checkout' ? other : repository);
      await pending;
      return { requestedRepo, requestedCommand, expectedRepo: repository.id, errors: git.backgroundFetchErrors(),
        active: git.activeRepositoryId(), error: git.error() };
    }, scenario);
    expect(result.requestedRepo).toBe(result.expectedRepo);
    expect(result.requestedCommand).toBe(scenario === 'pull' ? 'pull_repository' :
      scenario === 'push' ? 'push_repository' : 'fetch_repository');
    const succeeded = ['tab-switch', 'unrelated-error', 'success'].includes(scenario);
    expect(result.errors[result.expectedRepo]?.message).toBe(succeeded ? undefined : 'Original authentication failure');
    expect(result.errors['other-fetch']?.message).toBe('Other failure');
    if (scenario === 'tab-switch' || scenario === 'unrelated-error') expect(result.active).toBe('other-fetch');
    if (scenario === 'unrelated-error') expect(result.error).toBe('Unrelated inspection error');
    if (scenario === 'dismissed-failure') expect(result.error).toBeNull();
  });
}

for (const scope of ['same tab', 'reopened tab']) {
  test(`a late automatic Fetch failure belongs to its original checkout: ${scope}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const actual = await page.evaluate(async reopen => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repository = git.repository();
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      let started!: () => void;
      let fail!: () => void;
      const dispatched = new Promise<void>(resolve => { started = resolve; });
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'sync_repository') return new Promise((_resolve, reject) => {
          fail = () => reject({ message: 'Owned late authentication refusal' });
          started();
        });
        if (command === 'open_repository' || command === 'refresh_repository') return Promise.resolve(repository);
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.resolve(null);
      } };
      const pending = git.fetchInBackground(repository.id);
      await Promise.race([dispatched, pending.then(() => { throw new Error('Automatic Fetch was not dispatched'); })]);
      if (reopen) {
        git.closeRepository(repository.id);
        await git.openRepository(repository.path);
      }
      fail();
      await pending;
      return {
        active: git.activeRepositoryId(), expected: repository.id,
        failure: git.backgroundFetchErrors()[repository.id]?.message ?? null,
        fetching: git.backgroundFetchBusy(),
      };
    }, scope === 'reopened tab');
    expect(actual.active).toBe(actual.expected);
    expect(actual.failure).toBe(scope === 'same tab' ? 'Owned late authentication refusal' : null);
    expect(actual.fetching).toBe(false);
  });
}

for (const kind of ['fetchUpdatesLocalBranch', 'fetchAllPolicyUnavailable']) {
  test(`branch-only and named Fetch cannot resume automatic Fetch after a scope refusal: ${kind}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async kind => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const source = git.repository();
      if (!source.remotes.length) throw new Error('Fixture must have a remote');
      const repository = { ...source, remotes: [source.remotes[0]] };
      git.repositories.set([repository]);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      const calls: string[] = [];
      let repaired = false;
      (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => {
        if (command === 'sync_repository') {
          calls.push(command);
          if (!repaired) throw { kind, message: 'Automatic Fetch scope refused' };
          return repository;
        }
        if (command === 'fetch_repository' || command === 'fetch_branches') {
          calls.push(command);
          return repository;
        }
        if (command === 'refresh_repository_status') return repository.status;
        return null;
      } };
      const initial = await git.fetchInBackground(repository.id);
      const hasPause = () => !!git.backgroundFetchErrors()[repository.id];
      const before = hasPause();
      const branchOnly = await git.fetchBranches({ remote: null, prune: false }, repository.id);
      const afterBranchOnly = hasPause();
      await git.remote('fetch_repository', { remote: repository.remotes[0].name });
      const afterNamed = hasPause();
      const whilePaused = await git.fetchInBackground(repository.id);
      repaired = true;
      await git.remote('fetch_repository');
      const afterAll = hasPause();
      const resumed = await git.fetchInBackground(repository.id);
      return { initial, before, branchOnly, afterBranchOnly, afterNamed, whilePaused, afterAll, resumed, calls };
    }, kind);
    expect(result).toEqual({
      initial: false, before: true, branchOnly: 'success', afterBranchOnly: true, afterNamed: true,
      whilePaused: false, afterAll: false, resumed: true,
      calls: ['sync_repository', 'fetch_branches', 'fetch_repository', 'fetch_repository', 'sync_repository'],
    });
  });
}
