import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const root = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = root.git;
    const stash = { reference: 'stash@{0}', oid: 'a'.repeat(40), message: 'Owned selected stash' };
    const repository = { ...git.repository(), stashes: [stash] };
    git.repositories.set([repository]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    root.selectedCommit.set(stash.oid);
    const state: any = { root, git, stash, repository, calls: [] };
    (window as any).__stashAction = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: unknown) => {
      state.calls.push({ command, args });
      if (command === 'apply_stash' || command === 'pop_stash_entry' || command === 'pop_stash') return new Promise(resolve => { state.finish = resolve; });
      return Promise.resolve(command === 'refresh_repository_status' ? repository.status : repository);
    } };
  });
}

for (const pop of [false, true]) {
  test(`${pop ? 'pop' : 'apply'} uses the selected object and does not steal a newer inspection`, async ({ page }) => {
    await prepare(page);
    await page.evaluate((pop) => {
      const state = (window as any).__stashAction;
      state.pending = state.root.applyStashFromMenu(pop);
    }, pop);
    const calls = await page.evaluate(() => (window as any).__stashAction.calls);
    expect(calls[0].args.expectedOid).toBe('a'.repeat(40));
    await page.evaluate(async () => {
      const state = (window as any).__stashAction;
      state.root.selectedCommit.set('newer-inspection');
      state.finish(state.repository);
      await state.pending;
    });
    expect(await page.evaluate(() => (window as any).__stashAction.root.selectedCommit())).toBe('newer-inspection');
  });
}

test('a stash menu owned by another repository cannot start a mutation', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).__stashAction;
    state.git.repositories.set([state.repository, { ...state.repository, id: 'other-repository' }]);
    state.git.activeRepositoryId.set('other-repository');
    state.root.actionOverlays.open({ kind: 'stash', value: { repositoryId: state.repository.id, stash: state.stash, x: 100, y: 100 } });
    void state.root.applyStashFromMenu(true);
  });
  expect(await page.evaluate(() => (window as any).__stashAction.calls)).toHaveLength(0);
});

for (const change of ['shifted-stack', 'other-repository']) {
  test(`captured palette stash actions reject a ${change}`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async (change) => {
      const state = (window as any).__stashAction;
      state.root.commandQuery.set('stash');
      const actions = state.root.commandActions().filter((action: any) =>
        ['apply-stash', 'pop'].includes(action.id) || action.id.startsWith('stash-apply:') || action.id.startsWith('stash-pop:'));
      if (change === 'shifted-stack') {
        state.git.repositories.set([{ ...state.repository, stashes: [
          { ...state.stash, oid: 'b'.repeat(40) }, { ...state.stash, reference: 'stash@{1}' },
        ] }]);
      } else {
        state.git.repositories.set([state.repository, { ...state.repository, id: 'other-repository' }]);
        state.git.activeRepositoryId.set('other-repository');
      }
      state.actionCount = actions.length;
      for (const action of actions) await state.root.runCommand(action);
    }, change);
    expect(await page.evaluate(() => (window as any).__stashAction.actionCount)).toBe(4);
    expect(await page.evaluate(() => (window as any).__stashAction.calls)).toHaveLength(0);
  });
}

test('rename confirmation cannot mutate another repository with an identical stash object', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).__stashAction;
    state.root.beginStashRename(state.stash);
    state.root.stashRenameMessage.set('Owned renamed stash');
    state.git.repositories.set([state.repository, { ...state.repository, id: 'other-repository' }]);
    state.git.activeRepositoryId.set('other-repository');
    await state.root.confirmStashRename();
  });
  expect(await page.evaluate(() => (window as any).__stashAction.calls)).toHaveLength(0);
});

test('latest-pop rejects repeated submissions while its first call is pending', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).__stashAction;
    const first = state.git.popStash(state.stash, state.repository.id);
    state.second = await state.git.popStash(state.stash, state.repository.id);
    state.finish({ ...state.repository, stashes: [] });
    state.first = await first;
  });
  const state = await page.evaluate(() => {
    const state = (window as any).__stashAction;
    return { calls: state.calls.filter((call: any) => call.command === 'pop_stash'), first: state.first, second: state.second };
  });
  expect(state.first).toBe(true);
  expect(state.second).toBe(false);
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].args.expectedOid).toBe('a'.repeat(40));
});
