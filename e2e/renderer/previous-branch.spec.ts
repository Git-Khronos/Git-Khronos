import { expect, test, type Page } from '@playwright/test';

const label = 'Find previous local branch…';
const target = 'refs/heads/release';

async function installFixture(page: Page, result: 'target' | 'empty' | 'hold' | 'failed') {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(({ result, target }) => {
    const host = window as any;
    const { git } = host.ng.getComponent(document.querySelector('gk-app'));
    let repo = { ...git.repository(), worktrees: git.repository().worktrees.filter((tree: any) => tree.current) };
    git.repositories.update((rows: any[]) => rows.map(candidate => candidate.id === repo.id ? repo : candidate));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'previous branch fixture' }));
    const state: { calls: { command: string; args: Record<string, unknown> }[]; resolve?: (value: string) => void } = { calls: [] };
    host.__previousBranch = state;
    host.__TAURI_INTERNALS__ = { invoke: (command: string, args: Record<string, unknown>) => {
      if (command === 'refresh_repository_status') return Promise.resolve(repo.status);
      if (command === 'refresh_repository') return Promise.resolve(repo);
      if (command === 'inspect_previous_local_branch') {
        state.calls.push({ command, args });
        if (result === 'hold') return new Promise(resolve => state.resolve = resolve);
        if (result === 'failed') return Promise.reject({ message: 'Previous checkout lookup exceeded its time limit.' });
        return Promise.resolve(result === 'empty' ? null : target);
      }
      if (command === 'checkout_branch') {
        state.calls.push({ command, args });
        const next = repo.branches.find((branch: any) => !branch.remote && branch.name === args['name']);
        repo = { ...repo, headOid: next.oid, status: { ...repo.status, branch: next.name },
          branches: repo.branches.map((branch: any) => ({ ...branch, current: branch === next })) };
        return Promise.resolve(repo);
      }
      return Promise.resolve(null);
    } };
  }, { result, target });
}

async function calls(page: Page) {
  return page.evaluate(() => (window as any).__previousBranch.calls.map((call: any) =>
    [call.command, call.args.name ?? null]));
}

async function fromBranchOptions(page: Page) {
  const opener = page.getByRole('button', { name: 'Branch options', exact: true });
  await opener.click();
  await page.getByRole('menu', { name: 'Branch options', exact: true }).getByRole('menuitem', { name: new RegExp(label) }).click();
  return { opener, palette: page.getByRole('dialog', { name: 'Command palette', exact: true }) };
}

test('previous branch lookup is read-only until the displayed local branch is chosen', async ({ page }) => {
  await installFixture(page, 'target');
  const { opener, palette } = await fromBranchOptions(page);
  const search = palette.getByRole('combobox', { name: 'Search branches' });
  await expect(search).toHaveValue(target);
  await expect(palette.getByRole('status').filter({ hasText: 'Previous local branch: release.' })).toBeVisible();
  expect(await calls(page)).toEqual([['inspect_previous_local_branch', null]]);
  await expect(palette.getByRole('option')).toHaveCount(1);
  await search.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Switch branch, current release,/ })).toBeVisible();
  await expect(opener).toBeFocused();
  expect(await calls(page)).toEqual([['inspect_previous_local_branch', null], ['checkout_branch', 'release']]);
});

test('the command palette can look up a previous branch without falling back on Enter when unavailable', async ({ page }) => {
  await installFixture(page, 'empty');
  const opener = page.getByRole('button', { name: 'Command palette', exact: true });
  await opener.click();
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('previous local branch');
  await palette.getByRole('option', { name: new RegExp(label) }).click();
  await expect(palette.getByRole('status').filter({ hasText: 'No previous local branch is available' })).toBeVisible();
  await expect(palette.getByRole('option')).toHaveCount(0);
  const search = palette.getByRole('combobox', { name: 'Search branches' });
  await search.press('Enter');
  expect(await calls(page)).toEqual([['inspect_previous_local_branch', null]]);
  await search.fill('feature/partial');
  await expect(palette.getByRole('option', { name: /feature\/partial-staging/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

for (const retirement of ['typing another query', 'changing the checkout', 'closing the palette'] as const) {
  test(`a pending previous branch read is retired by ${retirement}`, async ({ page }) => {
    await installFixture(page, 'hold');
    const { opener, palette } = await fromBranchOptions(page);
    const search = palette.getByRole('combobox', { name: 'Search branches' });
    await expect(palette.getByRole('status').filter({ hasText: 'Finding the previous local branch' })).toBeVisible();
    await search.press('Enter');
    await expect(palette.getByRole('option')).toHaveCount(0);
    if (retirement === 'typing another query') await search.fill('feature/partial');
    else if (retirement === 'closing the palette') {
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
    } else await page.evaluate(() => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const next = { ...git.repository(), id: 'next-previous-branch-visit', path: '/owned/previous-branch-other' };
      git.repositories.update((repos: any[]) => [...repos, next]);
      git.activeRepositoryId.set(next.id);
    });
    await page.evaluate(target => (window as any).__previousBranch.resolve(target), target);
    if (retirement === 'typing another query') await expect(search).toHaveValue('feature/partial');
    else await expect(palette).toHaveCount(0);
    expect(await calls(page)).toEqual([['inspect_previous_local_branch', null]]);
  });
}

test('a failed previous branch read explains the failure and never picks a fallback', async ({ page }) => {
  await installFixture(page, 'failed');
  const { palette } = await fromBranchOptions(page);
  await expect(palette.getByRole('alert')).toContainText('Previous checkout lookup exceeded its time limit.');
  await expect(palette.getByRole('option')).toHaveCount(0);
  expect(await calls(page)).toEqual([['inspect_previous_local_branch', null]]);
});
