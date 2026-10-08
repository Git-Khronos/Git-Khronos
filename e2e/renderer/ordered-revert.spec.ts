import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const repository = git.repository();
    const original = { ...repository, status: { ...repository.status,
      staged: 0, unstaged: 0, untracked: 0, conflicted: 0, entryCount: 0, entries: [],
      historyOperation: null, historyNoCommit: false } };
    const commits = app.visibleGraphRows().map((row: any) => row.commit)
      .filter((commit: any) => commit.parents.length === 1 && !app.stashForOid(commit.oid)).slice(0, 3);
    const fixture = { original, snapshot: original, commits, calls: [] as any[],
      refused: false, conflict: false, deferred: false, complete: null as (() => void) | null };
    (window as any).__orderedRevert = fixture;
    git.repositories.update((items: any[]) => items.map(item => item.id === original.id ? original : item));
    app.commitMessage.set('Retained draft for later work');
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'revert_commit') {
          if (fixture.deferred) return new Promise(resolve => {
            fixture.complete = () => {
              fixture.snapshot = { ...original, headOid: 'f'.repeat(40) };
              resolve(fixture.snapshot);
            };
          });
          if (fixture.refused) return Promise.reject({ kind: 'dirtyWorkingTree', message: 'Commit or stash local changes before replaying changes.' });
          if (fixture.conflict) {
            fixture.snapshot = { ...original, headOid: 'e'.repeat(40), status: { ...original.status,
              conflicted: 1, historyOperation: 'revert', entryCount: 1,
              entries: [{ path: 'file', oldPath: null, indexStatus: 'U', worktreeStatus: 'U', conflicted: true }] } };
            return Promise.reject({ kind: 'gitFailure', message: 'A later inverse conflicted; earlier inverse commits remain in the paused sequence.' });
          }
          fixture.snapshot = { ...original, headOid: 'f'.repeat(40) };
          return Promise.resolve(fixture.snapshot);
        }
        if (command === 'control_history_operation') {
          fixture.snapshot = args.action === 'abort' ? original : { ...original, headOid: 'f'.repeat(40) };
          return Promise.resolve(fixture.snapshot);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(fixture.snapshot.status);
        if (command === 'refresh_repository') return Promise.resolve(fixture.snapshot);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

async function openSelection(page: Page): Promise<void> {
  const subject = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const commits = (window as any).__orderedRevert.commits;
    app.selectedCommits.set(commits.map((commit: any) => commit.oid));
    return commits[0].subject;
  });
  await page.getByRole('button', { name: `Commit actions for ${subject}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Revert 3 commits', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

test('multi-selection reviews every inverse newest-first and sends the exact list only after confirmation', async ({ page }) => {
  await openSelection(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog).toContainText('newest-to-oldest order');
  const fixture = await page.evaluate(() => (window as any).__orderedRevert);
  const rows = dialog.getByRole('list', { name: 'Reviewed revert order' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    await expect(rows.nth(index)).toContainText(fixture.commits[index].subject);
    await expect(rows.nth(index).locator('code')).toHaveAttribute('title', fixture.commits[index].oid);
  }
  expect(fixture.calls.every((call: any) => call.command === 'refresh_repository_status')).toBe(true);
  await dialog.getByRole('button', { name: 'Revert 3 commits', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return { fixture: (window as any).__orderedRevert, draft: app.commitMessage(), activity: app.git.activity() };
  });
  expect(result.fixture.calls.find((call: any) => call.command === 'revert_commit').args)
    .toEqual({ repoId: fixture.original.id, oid: fixture.commits[0].oid,
      oids: fixture.commits.map((commit: any) => commit.oid), mainline: null });
  expect(result.draft).toBe('Retained draft for later work');
  expect(result.activity).toBe('3 revert commits created');
});

test('compact keyboard cancellation and contextual official help preserve the reviewed order without execution', async ({ page }) => {
  await openSelection(page);
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('alertdialog');
  const help = dialog.getByRole('button', { name: 'Learn about ordered revert…' });
  await help.click();
  const documentation = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(documentation).toContainText('without revision traversal');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(550);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Revert 3 commits', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(help).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__orderedRevert.calls
    .every((call: any) => call.command === 'refresh_repository_status'))).toBe(true);
});

test('preflight refusal retains the exact reviewed list and provides a focused error for explicit retry', async ({ page }) => {
  await openSelection(page);
  await page.evaluate(() => { (window as any).__orderedRevert.refused = true; });
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Revert 3 commits', exact: true }).click();
  await expect(dialog.locator('.recovery-error')).toContainText('Commit or stash');
  await expect(dialog.locator('.recovery-error')).toBeFocused();
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await expect(dialog).toContainText('Do not replay the whole selection again');
  await page.evaluate(() => { (window as any).__orderedRevert.refused = false; });
  await dialog.getByRole('button', { name: 'Revert 3 commits', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__orderedRevert.calls.filter((call: any) => call.command === 'revert_commit'));
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
});

test('multi-selection containing a merge cannot use an implicit shared mainline or run an ordinary prefix', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const fixture = (window as any).__orderedRevert;
    const mergeOid = fixture.commits[1].oid;
    app.git.repositories.update((items: any[]) => items.map(item => item.id === fixture.original.id
      ? { ...item, commits: item.commits.map((commit: any) => commit.oid === mergeOid
        ? { ...commit, parents: ['a'.repeat(40), 'b'.repeat(40)] } : commit) } : item));
  });
  await openSelection(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Replay merge commits individually');
  await expect(dialog.getByRole('button', { name: 'Revert 3 commits', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__orderedRevert.calls
    .every((call: any) => call.command === 'refresh_repository_status'))).toBe(true);
  await page.keyboard.press('Escape');
});

for (const action of ['continue', 'skip', 'abort'] as const) {
  test(`paused multi-revert ${action} controls the existing native sequence instead of replaying the selection`, async ({ page }) => {
    await openSelection(page);
    await page.evaluate(() => { (window as any).__orderedRevert.conflict = true; });
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Revert 3 commits', exact: true }).click();
    await expect(dialog.locator('.recovery-error')).toContainText('later inverse conflicted');
    await page.keyboard.press('Escape');
    const progress = page.getByRole('status', { name: 'Git revert in progress' });
    await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    if (action === 'continue') {
      await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const fixture = (window as any).__orderedRevert;
        fixture.snapshot = { ...fixture.snapshot, status: { ...fixture.snapshot.status, conflicted: 0,
          staged: 1, entries: [{ path: 'file', oldPath: null, indexStatus: 'M', worktreeStatus: '.', conflicted: false }] } };
        app.git.repositories.update((items: any[]) => items.map(item => item.id === fixture.original.id ? fixture.snapshot : item));
      });
    }

    await progress.getByRole('button', { name: action[0].toUpperCase() + action.slice(1), exact: true }).click();
    await expect(progress).toHaveCount(0);
    const result = await page.evaluate(() => ({ fixture: (window as any).__orderedRevert,
      head: (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().headOid }));
    expect(result.fixture.calls.filter((call: any) => call.command === 'revert_commit')).toHaveLength(1);
    expect(result.fixture.calls.find((call: any) => call.command === 'control_history_operation').args)
      .toEqual({ repoId: result.fixture.original.id, operation: 'revert', action });
    expect(result.head).toBe(action === 'abort' ? result.fixture.original.headOid : 'f'.repeat(40));
  });
}

test('repository switch during ordered revert cannot redirect captured completion or its Undo history', async ({ page }) => {
  await openSelection(page);
  await page.evaluate(() => { (window as any).__orderedRevert.deferred = true; });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revert 3 commits', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__orderedRevert.complete)).toBe(true);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const original = (window as any).__orderedRevert.original;
    app.git.repositories.update((items: any[]) => [...items,
      { ...original, id: 'other-ordered-revert', name: 'Other repository', headOid: 'd'.repeat(40) }]);
    app.git.activeRepositoryId.set('other-ordered-revert');
  });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__orderedRevert.complete(); });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  const result = await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    return { fixture: (window as any).__orderedRevert, active: git.repository(), history: git.operationHistory() };
  });
  expect(result.active.id).toBe('other-ordered-revert');
  expect(result.active.headOid).toBe('d'.repeat(40));
  expect(result.history[result.fixture.original.id]).toMatchObject({
    beforeOid: result.fixture.original.headOid, afterOid: 'f'.repeat(40), label: 'Revert 3 Commits',
  });
  expect(result.history['other-ordered-revert']).toBeUndefined();
  expect(result.fixture.calls.filter((call: any) => call.command === 'revert_commit')).toHaveLength(1);
});
