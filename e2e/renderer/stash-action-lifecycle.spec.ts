import { expect, test, type Page } from '@playwright/test';
import { openPreviewRepository } from './preview-repository-ready';

async function prepare(page: Page) {
  await openPreviewRepository(page, page.locator('.commit-row').first());
  await page.evaluate(() => {
    const root = (window as any).ng.getComponent(document.querySelector('gk-app'));
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
      if (command === 'working_tree_change_summary') {
        const repo = git.repositories().find((candidate: { id: string }) => candidate.id === (args as { repoId: string }).repoId);
        if (!repo) return Promise.reject(new Error('Unexpected repository in owned recap read'));
        return Promise.resolve({ staged: null, unstaged: { additions: 0, deletions: 0, uncountedFiles: repo.status.unstaged + repo.status.untracked, partial: true } });
      }
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
    const calls = await page.evaluate(() => (window as any).__stashAction.calls.filter(
      (call: { command: string }) => ['apply_stash', 'pop_stash', 'pop_stash_entry'].includes(call.command)));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: pop ? 'pop_stash_entry' : 'apply_stash', args: { expectedOid: 'a'.repeat(40) } });
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
    const checkoutVisit = state.git.activeRepositoryReadScope();
    state.git.repositories.set([state.repository, { ...state.repository, id: 'other-repository' }]);
    state.git.activeRepositoryId.set('other-repository');
    state.root.actionOverlays.open({ kind: 'stash', value: { checkoutVisit, repositoryId: state.repository.id, stash: state.stash, x: 100, y: 100 } });
    void state.root.applyStashFromMenu(true);
  });
  expect(await page.evaluate(() => (window as any).__stashAction.calls.filter(
    (call: { command: string }) => call.command !== 'working_tree_change_summary'))).toHaveLength(0);
});

test('apply uses the selected object without replacing its inspection in a later checkout visit', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const s = (window as any).__stashAction;
    s.pending = s.root.applyStashFromMenu(false);
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__stashAction.finish)).toBe('function');
  await page.evaluate(async () => {
    const s = (window as any).__stashAction;
    s.git.repositories.update((items: any[]) => [...items, { ...s.repository, id: 'stash-result-other', path: '/owned/stash-result-other' }]);
    s.git.activateRepository('stash-result-other');
    s.git.activateRepository(s.repository.id);
    s.root.selectedCommit.set(s.stash.oid);
    s.finish(s.repository);
    await s.pending;
  });
  expect(await page.evaluate(() => (window as any).__stashAction.root.selectedCommit())).toBe('a'.repeat(40));
});

for (const label of ['Apply Stash', 'Pop Stash']) {
  test(`an old ${label} menu cannot dispatch after returning to the same checkout`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => {
      const { root, stash } = (window as any).__stashAction;
      root.openStashMenu(new MouseEvent('contextmenu', { clientX: 100, clientY: 100 }), stash, false);
    });
    const menu = page.getByRole('menu', { name: 'Stash actions', exact: true });
    const action = menu.getByRole('menuitem', { name: label, exact: true });
    await expect(action).toBeVisible();
    await action.evaluate(button => {
      const { git, repository } = (window as any).__stashAction;
      git.repositories.update((items: any[]) => [...items, { ...repository, id: 'stash-menu-other', path: '/owned/stash-menu-other' }]);
      git.activateRepository('stash-menu-other');
      git.activateRepository(repository.id);
      (button as HTMLButtonElement).click();
    });
    expect(await page.evaluate(() => (window as any).__stashAction.calls.filter(
      (call: { command: string }) => ['apply_stash', 'pop_stash', 'pop_stash_entry'].includes(call.command)))).toEqual([]);
    await expect(menu).toBeHidden();
  });
}

for (const change of ['shifted-stack', 'other-repository']) {
  test(`captured palette stash actions reject a ${change}`, async ({ page }) => {
    await prepare(page);
    await page.getByRole('button', { name: 'Command palette', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search commands', exact: true }).fill('stash');
    await expect(page.getByRole('option', { name: /^Apply stash@/ })).toBeVisible();
    await page.evaluate(async (change) => {
      const state = (window as any).__stashAction;
      const palette = (window as any).ng.getComponent(document.querySelector('gk-command-palette'));
      const actions = palette.commandActions().filter((action: any) =>
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
    expect(await page.evaluate(() => (window as any).__stashAction.calls.filter(
      (call: { command: string }) => ['apply_stash', 'pop_stash_entry', 'pop_stash'].includes(call.command)))).toHaveLength(0);
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
  expect(await page.evaluate(() => (window as any).__stashAction.calls.filter(
    (call: { command: string }) => call.command !== 'working_tree_change_summary'))).toHaveLength(0);
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
