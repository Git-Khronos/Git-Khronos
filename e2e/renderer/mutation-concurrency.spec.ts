import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    const entries = ['first.txt', 'second.txt'].map(path => ({ path, indexStatus: ' ', worktreeStatus: 'M', conflicted: false }));
    const before = { ...repository.status, entries, staged: 0, unstaged: 2, untracked: 0, conflicted: 0,
      entryCount: 2, entriesTruncated: false };
    const first = { ...before, staged: 1, unstaged: 1,
      entries: entries.map((entry, index) => index ? entry : { ...entry, indexStatus: 'M', worktreeStatus: ' ' }) };
    const fresh = { ...before, staged: 2, unstaged: 0,
      entries: entries.map(entry => ({ ...entry, indexStatus: 'M', worktreeStatus: ' ' })) };
    git.repositories.set([{ ...repository, status: before }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__concurrentMutations = { git, repository: { ...repository, status: before }, before, first, fresh };
  });
}

for (const order of ['in-order', 'reversed']) {
  test(`overlapping stage replies reconcile final Git status when ${order}`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async order => {
      const { git, first, fresh } = (window as any).__concurrentMutations;
      const finish: Record<string, (status: unknown) => void> = {};
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => command === 'stage_path'
        ? new Promise(resolve => { finish[args.path] = resolve; }) : Promise.resolve(fresh) };
      const one = git.stagePath('first.txt');
      const two = git.stagePath('second.txt');
      if (order === 'reversed') { finish['second.txt'](fresh); await two; finish['first.txt'](first); }
      else { finish['first.txt'](first); await one; finish['second.txt'](fresh); }
      await Promise.all([one, two]);
      return { actual: git.repository().status, expected: fresh };
    }, order);
    expect(result.actual).toEqual(result.expected);
  });
}

test('finishing one operation keeps busy set until the other operation finishes', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { git, first, fresh } = (window as any).__concurrentMutations;
    const finish: Record<string, (status: unknown) => void> = {};
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => command === 'stage_path'
      ? new Promise(resolve => { finish[args.path] = resolve; }) : Promise.resolve(fresh) };
    const one = git.stagePath('first.txt');
    const two = git.stagePath('second.txt');
    finish['first.txt'](first);
    await one;
    const during = git.busy();
    finish['second.txt'](fresh);
    await two;
    return { during, after: git.busy() };
  });
  expect(result).toEqual({ during: true, after: false });
});

test('failed-operation reconciliation cannot overwrite a newer completed stage', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { git, before, fresh } = (window as any).__concurrentMutations;
    let refreshStarted!: () => void;
    const started = new Promise<void>(resolve => { refreshStarted = resolve; });
    let finishRefresh!: (status: unknown) => void;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'stage_path') return args.path === 'first.txt'
        ? Promise.reject({ message: 'First stage refused' }) : Promise.resolve(fresh);
      return new Promise(resolve => { finishRefresh = resolve; refreshStarted(); });
    } };
    const failed = git.stagePath('first.txt');
    await started;
    await git.stagePath('second.txt');
    finishRefresh(before);
    await failed;
    return { actual: git.repository().status, expected: fresh };
  });
  expect(result.actual).toEqual(result.expected);
});

test('a forced status reply cannot erase the prediction of a pending stage', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { git, repository, before, first } = (window as any).__concurrentMutations;
    let finish!: (status: unknown) => void;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => command === 'stage_path'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(before) };
    const pending = git.stagePath('first.txt');
    await git.refreshStatusInBackground(repository.id, true);
    const during = git.repository().status;
    finish(first);
    await pending;
    return { during, expected: first };
  });
  expect(result.during).toEqual(result.expected);
});

test('a stage reply from a closed session reconciles instead of overwriting reopened status', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { git, repository, before, first } = (window as any).__concurrentMutations;
    let finish!: (status: unknown) => void;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      if (command === 'stage_path') return new Promise(resolve => { finish = resolve; });
      return Promise.resolve(command === 'open_repository' ? repository : before);
    } };
    const pending = git.stagePath('first.txt');
    git.closeRepository(repository.id);
    await git.openRepository(repository.path);
    finish(first);
    await pending;
    return { actual: git.repository().status, expected: before };
  });
  expect(result.actual).toEqual(result.expected);
});

for (const first of ['restore', 'operation']) {
  test(`repository restoration participates in busy tracking when ${first} finishes first`, async ({ page }) => {
    await prepare(page);
    const result = await page.evaluate(async first => {
      const { git, repository, before } = (window as any).__concurrentMutations;
      git.workspaces.set([{ ...git.activeWorkspace(), repositoryPaths: [repository.path], activeRepositoryPath: repository.path }]);
      let finishRestore!: (snapshot: unknown) => void;
      let finishOperation!: () => void;
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => command === 'open_repository'
        ? new Promise(resolve => { finishRestore = resolve; }) : Promise.resolve(before) };
      const restoring = git.restoreRepositories();
      const running = git.run('Concurrent action', () => new Promise<void>(resolve => { finishOperation = resolve; }));
      if (first === 'restore') { finishRestore(repository); await restoring; }
      else { finishOperation(); await running; }
      const during = git.busy();
      if (first === 'restore') finishOperation();
      else finishRestore(repository);
      await Promise.all([restoring, running]);
      return { during, after: git.busy() };
    }, first);
    expect(result).toEqual({ during: true, after: false });
  });
}
