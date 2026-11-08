import { expect, test } from '@playwright/test';

for (const order of ['in-order', 'reversed', 'same-turn']) {
  test(`overlapping checkout and fetch reconcile current metadata when replies arrive ${order}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async order => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const first = { ...repository, headOid: repository.commits[2].oid,
        status: { ...repository.status, branch: 'first-branch' } };
      const fresh = { ...repository, headOid: repository.commits[3].oid,
        status: { ...repository.status, branch: 'second-branch' } };
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      const finish: Record<string, (value: unknown) => void> = {};
      let metadataReads = 0;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        if (command === 'checkout_branch') return new Promise(resolve => { finish['checkout'] = resolve; });
        if (command === 'fetch_repository') return new Promise(resolve => { finish['fetch'] = resolve; });
        if (command === 'refresh_repository') { metadataReads++; return Promise.resolve(fresh); }
        if (command === 'refresh_repository_status') return Promise.resolve(fresh.status);
        return Promise.resolve(null);
      } };
      const one = git.checkout('first-branch');
      const two = git.remote('fetch_repository');
      if (order === 'in-order') { finish['checkout'](first); await one; finish['fetch'](fresh); }
      else if (order === 'reversed') { finish['fetch'](fresh); await two; finish['checkout'](first); }
      else { finish['fetch'](fresh); finish['checkout'](first); }
      await Promise.all([one, two]);
      return { actual: git.repository().headOid, expected: fresh.headOid, metadataReads };
    }, order);
    expect(result.actual).toBe(result.expected);
  });
}

test('a pending branch action refuses another branch action until it finishes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const calls: string[] = [];
    let finish!: (value: unknown) => void;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'checkout_branch') {
        calls.push(command);
        return new Promise(resolve => { finish = resolve; });
      }
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.resolve(repository);
    } };
    const pending = git.checkout('first-branch');
    const blocked = await git.checkout('second-branch');
    finish(repository);
    await pending;
    const retry = git.checkout('second-branch');
    finish(repository);
    await retry;
    return { blocked, calls };
  });
  expect(result.blocked).toBeNull();
  expect(result.calls).toEqual(['checkout_branch', 'checkout_branch']);
});

for (const reopen of [false, true]) {
  test(`a late successful checkout cannot restore a ${reopen ? 'reopened' : 'closed'} session snapshot`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async reopen => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const fresh = { ...repository, headOid: repository.commits[3].oid };
      let finish!: (value: unknown) => void;
      let metadataReads = 0;
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
        if (command === 'checkout_branch') return new Promise(resolve => { finish = resolve; });
        if (command === 'open_repository') return Promise.resolve(fresh);
        if (command === 'refresh_repository') { metadataReads++; return Promise.resolve(fresh); }
        if (command === 'refresh_repository_status') return Promise.resolve(fresh.status);
        return Promise.resolve(null);
      } };
      const pending = git.checkout('first-branch');
      git.closeRepository(repository.id);
      if (reopen) await git.openRepository(repository.path);
      finish(repository);
      await pending;
      return { head: git.repository()?.headOid ?? null, expected: fresh.headOid, metadataReads };
    }, reopen);
    expect(result.head).toBe(reopen ? result.expected : null);
    if (!reopen) expect(result.metadataReads).toBe(0);
  });
}

for (const reconcile of ['normal', 'newer-change', 'read-failure']) {
  test(`snapshot reconciliation preserves operation results during ${reconcile}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const result = await page.evaluate(async reconcile => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      const latest = { ...repository, headOid: repository.commits[3].oid };
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      const finish: Record<string, (value: unknown) => void> = {};
      let finishRead!: (value: unknown) => void;
      let started!: () => void;
      const readStarted = new Promise<void>(resolve => { started = resolve; });
      let metadataReads = 0;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        if (command === 'create_branch') return new Promise(resolve => { finish['branch'] = resolve; });
        if (command === 'fetch_repository') return new Promise(resolve => { finish['fetch'] = resolve; });
        if (command === 'pull_repository') return new Promise(resolve => { finish['pull'] = resolve; });
        if (command === 'refresh_repository') {
          metadataReads++;
          started();
          return reconcile === 'read-failure' ? Promise.reject({ message: 'Metadata read failed' })
            : new Promise(resolve => { finishRead = resolve; });
        }
        if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
        return Promise.resolve(null);
      } };
      const one = git.createBranch('first');
      if (reconcile === 'normal') {
        finish['branch'](repository);
        await one;
      } else {
        const two = git.remote('fetch_repository');
        finish['fetch'](repository);
        await two;
        finish['branch'](repository);
        await Promise.race([readStarted, one]);
        if (reconcile === 'newer-change' && metadataReads) {
          const three = git.pull();
          finish['pull'](latest);
          await three;
          finishRead(repository);
        }
        await one;
      }
      return { metadataReads, head: git.repository().headOid, expected: latest.headOid,
        statuses: git.activityLogs().slice(-3).map((entry: any) => entry.status),
        deferred: git.deferredMetadataRefreshes.has(repository.id) };
    }, reconcile);
    expect(result.statuses.every((status: string) => status === 'success')).toBe(true);
    if (reconcile === 'normal') expect(result.metadataReads).toBe(0);
    if (reconcile === 'newer-change') expect(result.head).toBe(result.expected);
    if (reconcile === 'read-failure') expect(result.deferred).toBe(true);
  });
}
