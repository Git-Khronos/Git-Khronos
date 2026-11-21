import { expect, test } from '@playwright/test';

for (const scenario of ['tab-switch', 'unrelated-error', 'dismissed-failure', 'cancelled', 'success', 'pull', 'push']) {
  test(`explicit fetch retry state follows its own result: ${scenario}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async scenario => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const other = { ...repository, id: 'other-fetch', path: '/fixture/other-fetch', name: 'Other fetch' };
      git.repositories.set([repository, other]);
      git.backgroundFetchErrors.set({ [repository.id]: 'Original authentication failure', [other.id]: 'Other failure' });
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
      if (scenario === 'dismissed-failure') reject({ message: 'Fetch authentication failed' });
      else if (scenario === 'cancelled') reject({ kind: 'operationCancelled', message: 'Cancelled', hint: null });
      else resolve(repository);
      await pending;
      return { requestedRepo, requestedCommand, expectedRepo: repository.id, errors: git.backgroundFetchErrors(),
        active: git.activeRepositoryId(), error: git.error() };
    }, scenario);
    expect(result.requestedRepo).toBe(result.expectedRepo);
    expect(result.requestedCommand).toBe(scenario === 'pull' ? 'pull_repository' :
      scenario === 'push' ? 'push_repository' : 'fetch_repository');
    const succeeded = ['tab-switch', 'unrelated-error', 'success'].includes(scenario);
    expect(result.errors[result.expectedRepo]).toBe(succeeded ? undefined : 'Original authentication failure');
    expect(result.errors['other-fetch']).toBe('Other failure');
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
        failure: git.backgroundFetchErrors()[repository.id] ?? null,
        fetching: git.backgroundFetchBusy(),
      };
    }, scope === 'reopened tab');
    expect(actual.active).toBe(actual.expected);
    expect(actual.failure).toBe(scope === 'same tab' ? 'Owned late authentication refusal' : null);
    expect(actual.fetching).toBe(false);
  });
}
