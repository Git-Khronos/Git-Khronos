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
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        if (['fetch_repository', 'pull_repository', 'push_repository'].includes(command)) {
          requestedRepo = args.repoId;
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
      const command = scenario === 'pull' ? 'pull_repository' : scenario === 'push' ? 'push_repository' : 'fetch_repository';
      const pending = git.remote(command);
      if (scenario === 'tab-switch' || scenario === 'unrelated-error') git.activateRepository(other.id);
      if (scenario === 'unrelated-error') await git.inspectCommit(other.headOid);
      if (scenario === 'dismissed-failure') reject({ message: 'Fetch authentication failed' });
      else if (scenario === 'cancelled') reject({ kind: 'operationCancelled', message: 'Cancelled', hint: null });
      else resolve(repository);
      await pending;
      return { requestedRepo, expectedRepo: repository.id, errors: git.backgroundFetchErrors(),
        active: git.activeRepositoryId(), error: git.error() };
    }, scenario);
    expect(result.requestedRepo).toBe(result.expectedRepo);
    const succeeded = ['tab-switch', 'unrelated-error', 'success'].includes(scenario);
    expect(result.errors[result.expectedRepo]).toBe(succeeded ? undefined : 'Original authentication failure');
    expect(result.errors['other-fetch']).toBe('Other failure');
    if (scenario === 'tab-switch' || scenario === 'unrelated-error') expect(result.active).toBe('other-fetch');
    if (scenario === 'unrelated-error') expect(result.error).toBe('Unrelated inspection error');
    if (scenario === 'dismissed-failure') expect(result.error).toBeNull();
  });
}
