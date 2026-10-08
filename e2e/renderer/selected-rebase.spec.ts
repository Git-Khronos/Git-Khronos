import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const original = git.repository();
    const clean = { ...original, branches: [...original.branches,
      { ...original.branches[0], name: 'reviewed-destination', fullName: 'refs/heads/reviewed-destination',
        oid: 'd'.repeat(40), current: false, remote: false }], status: { ...original.status,
      staged: 0, unstaged: 0, untracked: 0, conflicted: 0, entryCount: 0, entries: [],
      rebaseInProgress: false, rebaseEditStopped: false } };
    git.repositories.update((items: any[]) => items.map(item => item.id === clean.id ? clean : item));
    const commits = app.visibleGraphRows().map((row: any) => row.commit)
      .filter((commit: any) => commit.parents.length === 1 && !app.stashForOid(commit.oid))
      .slice(0, 3).reverse();
    const fixture = { original: clean, commits, calls: [] as any[], deferred: false,
      finish: null as (() => void) | null, refused: false };
    (window as any).__selectedRebase = fixture;
    app.commitMessage.set('Retained unrelated draft');
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if ((command === 'refresh_repository_status' || command === 'refresh_repository') && args.repoId !== clean.id) {
          const repository = git.repositories().find((item: any) => item.id === args.repoId);
          if (!repository) return Promise.reject(new Error(`Unknown fixture repository ${args.repoId}`));
          return Promise.resolve(command === 'refresh_repository_status' ? repository.status : repository);
        }
        if (command === 'prepare_interactive_rebase') {
          if (fixture.refused) return Promise.reject(args.root ? { kind: 'shallowRootRebase',
            message: 'Whole-history editing requires complete history, not a shallow boundary.',
            hint: 'Deepen the repository to its actual root and prepare a fresh review.' } : { kind: 'invalidRebaseSelection',
            message: 'The selected commits are not a consecutive oldest-to-newest range on the current branch.',
            hint: 'Select one starting commit or a contiguous range. All later commits through HEAD will also be reviewed.' });
          const plan = { source: args.source, target: args.target, base: args.root ? '' : 'a'.repeat(40),
            commits: fixture.commits.map(commit => ({ oid: commit.oid, subject: commit.subject,
              message: `${commit.subject}\n\nRetained detail`, authorName: commit.authorName, authorEmail: commit.authorEmail })),
            remoteReachableOids: [fixture.commits[0].oid] };
          if (fixture.deferred) return new Promise(resolve => { fixture.finish = () => resolve(plan); });
          return Promise.resolve(plan);
        }
        if (command === 'execute_interactive_rebase') return Promise.resolve(fixture.original);
        if (command === 'refresh_repository_status') return Promise.resolve(fixture.original.status);
        if (command === 'refresh_repository') return Promise.resolve(fixture.original);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

async function requestSelection(page: Page, count = 2): Promise<void> {
  const subject = await page.evaluate(count => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const commits = (window as any).__selectedRebase.commits.slice(0, count);
    app.selectedCommits.set(commits.map((commit: any) => commit.oid));
    return commits[0].subject;
  }, count);
  await page.getByRole('button', { name: `Commit actions for ${subject}`, exact: true }).click();
  await page.getByRole('menuitem', { name: count === 1 ? 'Edit history from this commit…' : 'Edit selected range…', exact: true }).click();
}

async function requestRoot(page: Page): Promise<void> {
  const branch = await page.evaluate(() => (window as any).__selectedRebase.original.status.branch);
  await page.locator('.branch-item').filter({ hasText: branch }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit entire history, including root…', exact: true }).click();
}

test('whole-history review explicitly includes root with no unchanged base and sends only root IPC', async ({ page }) => {
  await requestRoot(page);
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await expect(dialog.getByRole('button', { name: 'Close interactive rebase' })).toBeFocused();
  await expect(dialog).toContainText('from root');
  await expect(dialog).toContainText('Entire history, including the root: all 3 reviewed commits may be rewritten');
  await expect(dialog).toContainText('There is no unchanged parent base');
  await expect(dialog).toContainText('Root commits cannot use guided splitting');
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.find((call: any) => call.command === 'prepare_interactive_rebase').args)
    .toEqual({ repoId: fixture.original.id, source: fixture.original.status.branch,
      target: fixture.original.status.branch, root: true });
  const first = fixture.commits[0].subject;
  await dialog.getByLabel(`Action for ${first}`).selectOption('reword');
  await dialog.getByLabel(`New message for ${first}`).fill('Reviewed root message');
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(() => (window as any).__selectedRebase);
  expect(result.calls.find((call: any) => call.command === 'execute_interactive_rebase').args)
    .toEqual({ repoId: fixture.original.id, source: fixture.original.status.branch,
      target: fixture.original.status.branch, root: true,
      steps: fixture.commits.map((commit: any, index: number) => ({ oid: commit.oid,
        action: index ? 'pick' : 'reword', message: index ? null : 'Reviewed root message' })) });
});

test('whole-history all-drop cannot start and Reset plus compact help and Escape retain root scope and drafts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await requestRoot(page);
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  for (const commit of fixture.commits) await dialog.getByLabel(`Action for ${commit.subject}`).selectOption('drop');
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeEnabled();
  await dialog.getByLabel(`Action for ${fixture.commits[0].subject}`).selectOption('reword');
  await dialog.getByLabel(`New message for ${fixture.commits[0].subject}`).fill('Retained root draft');
  const help = dialog.getByRole('button', { name: 'Learn about interactive rebase…', exact: true });
  await help.click();
  const reference = page.getByRole('dialog', { name: 'Git command reference' });
  await expect(reference).toContainText('Whole-history editing');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await expect(dialog.getByLabel(`New message for ${fixture.commits[0].subject}`)).toHaveValue('Retained root draft');
  const start = dialog.getByRole('button', { name: 'Start Rebase', exact: true });
  await start.scrollIntoViewIfNeeded();
  const bounds = await start.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(24);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(() => ({
    calls: (window as any).__selectedRebase.calls,
    draft: (window as any).ng.getComponent(document.querySelector('gc-root')).commitMessage(),
  }));
  expect(result.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
  expect(result.draft).toBe('Retained unrelated draft');
});

test('shallow whole-history refusal is explicit and retry prepares a fresh complete review', async ({ page }) => {
  await page.evaluate(() => { (window as any).__selectedRebase.refused = true; });
  await requestRoot(page);
  await expect(page.locator('.error-toast')).toContainText('not a shallow boundary');
  await expect(page.locator('.error-toast')).toContainText('prepare a fresh review');
  await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.evaluate(() => { (window as any).__selectedRebase.refused = false; });
  await requestRoot(page);
  await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toBeVisible();
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.filter((call: any) => call.command === 'prepare_interactive_rebase')).toHaveLength(2);
  expect(fixture.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});

test('loaded whole-history review is invalidated on repository switch without execution', async ({ page }) => {
  await requestRoot(page);
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const source = (window as any).__selectedRebase.original;
    app.git.repositories.update((items: any[]) => [...items, { ...source, id: 'root-other', path: '/owned/other' }]);
    app.git.activeRepositoryId.set('root-other');
  });
  await expect(dialog).toHaveCount(0);
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});

test('a clean root Edit stop offers amendment and Continue without a parent-based split action', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const fixture = (window as any).__selectedRebase;
    const root = { ...fixture.commits[0], parents: [] };
    const stopped = { ...fixture.original, headOid: root.oid,
      commits: [root, ...fixture.original.commits.filter((commit: any) => commit.oid !== root.oid)],
      status: { ...fixture.original.status, rebaseInProgress: true, rebaseEditStopped: true } };
    fixture.original = stopped;
    app.git.repositories.update((items: any[]) => items.map(item => item.id === stopped.id ? stopped : item));
  });
  const banner = page.getByRole('status', { name: 'Git rebase in progress' });
  await expect(banner).toContainText('Continue unchanged');
  await expect(banner).toContainText('Guided splitting requires a parent');
  await expect(banner.getByRole('button', { name: 'Split this commit…' })).toHaveCount(0);
  await expect(banner.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await expect(banner.getByRole('button', { name: 'Abort', exact: true })).toBeEnabled();
});

test('explicit onto choice retains full suffix and drafts and executes the captured destination only on Start', async ({ page }) => {
  await requestSelection(page, 1);
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  const first = fixture.commits[0].subject;
  await dialog.getByLabel(`Action for ${first}`).selectOption('reword');
  await dialog.getByLabel(`New message for ${first}`).fill('Moved reviewed message');
  await dialog.getByLabel('Replay destination', { exact: true }).selectOption('d'.repeat(40));
  await expect(dialog).toContainText('changes after boundary aaaaaaaa will be replayed onto the chosen destination');
  await expect(dialog).toContainText('Explicit --onto destination: ' + 'd'.repeat(40));
  await expect(dialog).toContainText('captured commit, not a moving branch');
  await expect(dialog).toContainText('destination reference is not changed');
  await expect(dialog).toContainText('1 selected commit(s), plus 2 later commit(s)');
  await expect(dialog.getByLabel(`New message for ${first}`)).toHaveValue('Moved reviewed message');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.repositories.update((items: any[]) => items.map(item => ({ ...item,
      branches: item.branches.map((branch: any) => branch.name === 'reviewed-destination'
        ? { ...branch, oid: 'e'.repeat(40) } : branch) })));
  });
  expect((await page.evaluate(() => (window as any).__selectedRebase.calls))
    .some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__selectedRebase.calls);
  expect(calls.find((call: any) => call.command === 'execute_interactive_rebase').args)
    .toEqual({ repoId: fixture.original.id, source: fixture.original.status.branch,
      target: fixture.original.status.branch, selectionOids: [fixture.commits[0].oid],
      ontoOid: 'd'.repeat(40), steps: fixture.commits.map((commit: any, index: number) => ({
        oid: commit.oid, action: index ? 'pick' : 'reword', message: index ? null : 'Moved reviewed message',
      })) });
});

test('compact destination choice and help preserve drafts and can return to unchanged base without execution', async ({ page }) => {
  await requestSelection(page);
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  const select = dialog.getByLabel('Replay destination', { exact: true });
  await select.selectOption('d'.repeat(40));
  const bounds = await select.boundingBox();
  expect(bounds!.width).toBeLessThan(550);
  expect(bounds!.height).toBeGreaterThanOrEqual(24);
  await dialog.getByRole('button', { name: 'Learn about interactive rebase…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Git command reference' })).toContainText('captured destination commit');
  await page.keyboard.press('Escape');
  await expect(select).toHaveValue('d'.repeat(40));
  await select.selectOption('');
  await expect(dialog).toContainText('base aaaaaaaa remains unchanged');
  await expect(dialog).not.toContainText('Explicit --onto destination');
  await page.keyboard.press('Escape');
  const calls = await page.evaluate(() => (window as any).__selectedRebase.calls);
  expect(calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});

test('repository switching invalidates an onto destination and cannot execute captured rows elsewhere', async ({ page }) => {
  await requestSelection(page);
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await dialog.getByLabel('Replay destination', { exact: true }).selectOption('d'.repeat(40));
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const source = (window as any).__selectedRebase.original;
    app.git.repositories.update((items: any[]) => [...items, { ...source, id: 'onto-other', path: '/owned/other' }]);
    app.git.activeRepositoryId.set('onto-other');
  });
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__selectedRebase.calls);
  expect(calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});

test('range preview discloses later descendants and recorded versus unknown publication before exact IPC', async ({ page }) => {
  await requestSelection(page);
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close interactive rebase' })).toBeFocused();
  await expect(dialog).toContainText('2 selected commit(s), plus 1 later commit(s) through HEAD');
  await expect(dialog).toContainText('base aaaaaaaa remains unchanged');
  await expect(dialog).toContainText('Unknown does not mean unpublished');
  await expect(dialog.locator('.rebase-step')).toHaveCount(3);
  await expect(dialog.locator('.rebase-step').first()).toContainText('Recorded remote-reachable');
  await expect(dialog.locator('.rebase-step').last()).toContainText('Publication unknown');
  await expect(dialog.locator('.rebase-step').last()).toContainText('Later descendant');
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.find((call: any) => call.command === 'prepare_interactive_rebase').args)
    .toEqual({ repoId: fixture.original.id, source: fixture.original.status.branch, target: fixture.original.status.branch,
      selectionOids: fixture.commits.slice(0, 2).map((commit: any) => commit.oid) });
  expect(fixture.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
  await dialog.getByLabel(`Action for ${fixture.commits[0].subject}`).selectOption('reword');
  await dialog.getByLabel(`New message for ${fixture.commits[0].subject}`).fill('Reviewed starting message');
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(() => ({
    fixture: (window as any).__selectedRebase,
    draft: (window as any).ng.getComponent(document.querySelector('gc-root')).commitMessage(),
  }));
  expect(result.fixture.calls.find((call: any) => call.command === 'execute_interactive_rebase').args)
    .toEqual({ repoId: fixture.original.id, source: fixture.original.status.branch, target: fixture.original.status.branch,
      selectionOids: fixture.commits.slice(0, 2).map((commit: any) => commit.oid),
      steps: fixture.commits.map((commit: any, index: number) => ({ oid: commit.oid,
        action: index ? 'pick' : 'reword', message: index ? null : 'Reviewed starting message' })) });
  expect(result.draft).toBe('Retained unrelated draft');
});

test('a single starting commit includes the full suffix and keyboard cancellation does not execute', async ({ page }) => {
  await requestSelection(page, 1);
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await expect(dialog).toContainText('1 selected commit(s), plus 2 later commit(s) through HEAD');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close interactive rebase' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});

test('compact help preserves reword and full selection with reduced motion and usable controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await requestSelection(page);
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  const subject = await page.evaluate(() => (window as any).__selectedRebase.commits[0].subject);
  await dialog.getByLabel(`Action for ${subject}`).selectOption('reword');
  await dialog.getByLabel(`New message for ${subject}`).fill('Retained compact draft');
  const help = dialog.getByRole('button', { name: 'Learn about interactive rebase…' });
  await help.click();
  const reference = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(reference).toBeVisible();
  await expect(reference).toContainText('all later descendants through HEAD');
  await expect(reference).toContainText('unknown does not mean unpublished');
  await page.keyboard.press('Escape');
  await expect(reference).toHaveCount(0);
  await expect(help).toBeFocused();
  await expect(dialog.getByLabel(`New message for ${subject}`)).toHaveValue('Retained compact draft');
  const start = dialog.getByRole('button', { name: 'Start Rebase', exact: true });
  await start.focus();
  const box = await start.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
  expect(box!.x + box!.width).toBeLessThanOrEqual(550);
  expect(await dialog.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});

test('native invalid-selection refusal displays full-suffix guidance and allows a fresh review', async ({ page }) => {
  await page.evaluate(() => { (window as any).__selectedRebase.refused = true; });
  await requestSelection(page);
  await expect(page.locator('.error-toast')).toContainText('not a consecutive oldest-to-newest range');
  await expect(page.locator('.error-toast')).toContainText('All later commits through HEAD will also be reviewed');
  await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__selectedRebase.refused = false; });
  await requestSelection(page, 1);
  await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toBeVisible();
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});

test('repository switch cancels selected review and delayed preparation cannot reopen after switching back', async ({ page }) => {
  await page.evaluate(() => { (window as any).__selectedRebase.deferred = true; });
  await requestSelection(page);
  await expect.poll(() => page.evaluate(() => !!(window as any).__selectedRebase.finish)).toBe(true);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const source = (window as any).__selectedRebase.original;
    git.repositories.update((items: any[]) => [...items, { ...source, id: 'selected-other', path: '/owned/other' }]);
    git.activeRepositoryId.set('selected-other');
  });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId())).toBe('selected-other');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.activeRepositoryId.set((window as any).__selectedRebase.original.id);
  });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activeRepositoryId()))
    .toBe(await page.evaluate(() => (window as any).__selectedRebase.original.id));
  await page.evaluate(() => { (window as any).__selectedRebase.finish(); });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toHaveCount(0);
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});

test('loaded selected review closes on repository switch without executing against another repository', async ({ page }) => {
  await requestSelection(page);
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const source = (window as any).__selectedRebase.original;
    app.git.repositories.update((items: any[]) => [...items, { ...source, id: 'selected-other', path: '/owned/other' }]);
    app.git.activeRepositoryId.set('selected-other');
  });
  await expect(dialog).toHaveCount(0);
  const fixture = await page.evaluate(() => (window as any).__selectedRebase);
  expect(fixture.calls.some((call: any) => call.command === 'execute_interactive_rebase')).toBe(false);
});
