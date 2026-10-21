import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const original = git.repository();
    const paused = { ...original, headOid: 'c'.repeat(40),
      commits: [{ ...original.commits[0], oid: 'c'.repeat(40), subject: 'Reviewed compound commit' }, ...original.commits],
      status: { ...original.status, branch: null, staged: 0, unstaged: 0, untracked: 0, conflicted: 0,
        entryCount: 0, entriesTruncated: false, entries: [], rebaseInProgress: true, rebaseEditStopped: true, rebaseSplit: null } };
    const fixture = { paused, snapshot: paused, calls: [] as any[], refused: false, hookRefused: false,
      refreshOnly: null as any, deferred: false, finish: null as (() => void) | null };
    (window as any).__split = fixture;
    git.repositories.update((items: any[]) => items.map(item => item.id === original.id ? paused : item));
    app.selectWip();
    app.commitMessage.set('Retained unrelated draft');
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if ((command === 'refresh_repository_status' || command === 'refresh_repository') && args.repoId !== paused.id) {
          const repository = git.repositories().find((item: any) => item.id === args.repoId);
          if (!repository) return Promise.reject(new Error(`Unknown fixture repository ${args.repoId}`));
          return Promise.resolve(command === 'refresh_repository_status' ? repository.status : repository);
        }
        if (command === 'begin_rebase_split') {
          if (fixture.refused) return Promise.reject({ kind: 'staleRebaseSplit',
            message: 'The stopped commit changed after split confirmation was opened.',
            hint: 'Review the current Edit stop and open a new confirmation.' });
          fixture.snapshot = { ...paused, headOid: 'a'.repeat(40), status: { ...paused.status,
            unstaged: 1, untracked: 1, entryCount: 2,
            rebaseSplit: { preparing: false, partCount: 0, treeMatches: false },
            entries: [{ path: 'existing.txt', indexStatus: '.', worktreeStatus: 'M', conflicted: false },
              { path: 'new.txt', indexStatus: '?', worktreeStatus: '?', conflicted: false }] } };
          if (fixture.deferred) return new Promise(resolve => { fixture.finish = () => resolve(fixture.snapshot); });
          return Promise.resolve(fixture.snapshot);
        }
        if (command === 'stage_path') {
          const before = fixture.snapshot.status;
          const entries = before.entries.map((entry: any) => entry.path === args.path
            ? { ...entry, indexStatus: entry.indexStatus === '?' ? 'A' : 'M', worktreeStatus: '.' } : entry);
          fixture.snapshot = { ...fixture.snapshot, status: { ...before, entries,
            staged: entries.filter((entry: any) => ['M', 'A'].includes(entry.indexStatus)).length,
            unstaged: entries.filter((entry: any) => entry.indexStatus === '.').length,
            untracked: entries.filter((entry: any) => entry.indexStatus === '?').length } };
          return Promise.resolve(fixture.snapshot.status);
        }
        if (command === 'commit_changes') {
          if (fixture.hookRefused) return Promise.reject({ kind: 'gitFailure', message: 'The split part hook refused. Review and retry this part explicitly.' });
          const count = fixture.snapshot.status.rebaseSplit.partCount + 1;
          const entries = fixture.snapshot.status.entries.filter((entry: any) => !['M', 'A'].includes(entry.indexStatus));
          const head = String(count).repeat(40);
          fixture.snapshot = { ...fixture.snapshot, headOid: head,
            commits: [{ ...paused.commits[0], oid: head, subject: args.message }, ...fixture.snapshot.commits],
            status: { ...fixture.snapshot.status, staged: 0, entryCount: entries.length, entries,
              rebaseSplit: { preparing: false, partCount: count, treeMatches: count >= 2 && entries.length === 0 } } };
          return Promise.resolve(fixture.snapshot);
        }
        if (command === 'continue_rebase' || command === 'abort_rebase') {
          fixture.refreshOnly = null;
          fixture.snapshot = { ...fixture.snapshot, status: { ...paused.status,
            rebaseInProgress: false, rebaseEditStopped: false, rebaseSplit: null } };
          return Promise.resolve(fixture.snapshot);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(fixture.refreshOnly ?? fixture.snapshot.status);
        if (command === 'refresh_repository') return Promise.resolve(fixture.snapshot);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

async function openSplit(page: Page): Promise<void> {
  await page.getByRole('status', { name: 'Git rebase in progress' })
    .getByRole('button', { name: 'Split this commit…', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

test('split confirmation explains preserved contents, explicit identity and Abort obstruction before focused cancellation', async ({ page }) => {
  await openSplit(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog).toContainText('keeping this commit\'s changes unstaged');
  await expect(dialog).toContainText('at least two separate commits');
  await expect(dialog).toContainText('original author and signatures are not automatically inherited');
  await expect(dialog).toContainText('review and stage only those files');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__split.calls.some((call: any) => call.command === 'begin_rebase_split'))).toBe(false);
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Retained unrelated draft');
});

test('split stages and commits explicit parts without Amend, implicit Continue or Skip and preserves hook-failed draft', async ({ page }) => {
  await openSplit(page);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Begin split', exact: true }).click();
  const banner = page.getByRole('status', { name: 'Git rebase in progress' });
  await expect(banner).toContainText('REBASE PAUSED FOR SPLIT');
  await expect(banner).toContainText('0 part(s) committed');
  await expect(banner.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(banner.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Amend previous commit', { exact: true })).toBeDisabled();
  const fixture = await page.evaluate(() => (window as any).__split);
  expect(fixture.calls.find((call: any) => call.command === 'begin_rebase_split').args)
    .toEqual({ repoId: fixture.paused.id, expectedHead: fixture.paused.headOid });
  await page.getByRole('button', { name: 'Stage existing.txt', exact: true }).click();
  await page.getByLabel('Commit summary', { exact: true }).fill('First reviewed part');
  await page.evaluate(() => { (window as any).__split.hookRefused = true; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.locator('.error-toast')).toContainText('split part hook refused');
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('First reviewed part');
  await expect(banner).toContainText('0 part(s) committed');
  await page.evaluate(() => { (window as any).__split.hookRefused = false; });
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.locator('.commit-form button[type=submit]').click();
  await expect(banner).toContainText('1 part(s) committed');
  await expect(banner.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stage new.txt', exact: true }).click();
  await page.getByLabel('Commit summary', { exact: true }).fill('Second reviewed part');
  await page.locator('.commit-form button[type=submit]').click();
  await expect(banner).toContainText('2 part(s) committed');
  await expect(banner.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).__split.calls);
  expect(calls.filter((call: any) => call.command === 'commit_changes').every((call: any) => call.args.amend === false && call.args.skipHooks === false)).toBe(true);
  expect(calls.some((call: any) => ['continue_rebase', 'skip_rebase'].includes(call.command))).toBe(false);
  await banner.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(banner).toHaveCount(0);
});

test('split refusal retains focused review and stale expected head without resetting twice', async ({ page }) => {
  await openSplit(page);
  await page.evaluate(() => { (window as any).__split.refused = true; });
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Begin split', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('stopped commit changed');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog).toContainText('open a new confirmation');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__split.calls);
  expect(calls.filter((call: any) => call.command === 'begin_rebase_split')).toHaveLength(1);
  expect(calls.some((call: any) => call.command === 'commit_changes')).toBe(false);
});

test('split-only refresh changes at equal file counts invalidate Continue and expose uncertain reset after restart', async ({ page }) => {
  await openSplit(page);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Begin split', exact: true }).click();
  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const fixture = (window as any).__split;
    fixture.snapshot = { ...fixture.snapshot, status: { ...fixture.snapshot.status,
      staged: 0, unstaged: 0, untracked: 0, entryCount: 0, entries: [],
      rebaseSplit: { preparing: false, partCount: 2, treeMatches: true } } };
    await git.refreshStatusInBackground(git.activeRepositoryId(), true);
  });
  const banner = page.getByRole('status', { name: 'Git rebase in progress' });
  await expect(banner.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const fixture = (window as any).__split;
    fixture.refreshOnly = { ...fixture.snapshot.status, rebaseSplit: { preparing: false, partCount: 2, treeMatches: false } };
    await git.refreshStatusInBackground(git.activeRepositoryId(), true);
  });
  await expect(banner.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.evaluate(async () => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const fixture = (window as any).__split;
    fixture.refreshOnly = { ...fixture.snapshot.status, rebaseSplit: { preparing: true, partCount: 0, treeMatches: false } };
    await git.refreshStatusInBackground(git.activeRepositoryId(), true);
  });
  await expect(banner).toContainText('Split reset was interrupted');
  await expect(page.locator('#commit-readiness')).toHaveText('The split reset needs attention. Abort it from the operation banner before committing.');
  await expect(banner.getByRole('button', { name: 'Split this commit…', exact: true })).toHaveCount(0);
  await expect(banner.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.locator('.commit-form button[type=submit]')).toBeDisabled();
  await banner.getByRole('button', { name: 'Abort', exact: true }).click();
  await expect(banner).toHaveCount(0);
});

test('compact split help restores the opener and cancellation preserves paused HEAD and unrelated draft', async ({ page }) => {
  await openSplit(page);
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('alertdialog');
  const help = dialog.getByRole('button', { name: 'Learn about splitting commits…' });
  await help.click();
  const reference = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(reference).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reference).toHaveCount(0);
  await expect(help).toBeFocused();
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.focus();
  const box = await cancel.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(550);
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
  await cancel.click();
  const state = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return { head: app.git.repository().headOid, draft: app.commitMessage(), fixture: (window as any).__split };
  });
  expect(state.head).toBe(state.fixture.paused.headOid);
  expect(state.draft).toBe('Retained unrelated draft');
  expect(state.fixture.calls.some((call: any) => call.command === 'begin_rebase_split')).toBe(false);
});

test('in-flight split completion cannot alter another repository draft or create follow-up commits', async ({ page }) => {
  await openSplit(page);
  await page.evaluate(() => { (window as any).__split.deferred = true; });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Begin split', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__split.finish)).toBe(true);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const source = (window as any).__split.paused;
    app.git.repositories.update((items: any[]) => [...items, { ...source, id: 'split-other', path: '/owned/other',
      status: { ...source.status, rebaseInProgress: false, rebaseEditStopped: false, rebaseSplit: null } }]);
    app.git.activeRepositoryId.set('split-other');
  });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByLabel('Commit summary', { exact: true }).fill('Other repository draft');
  await page.evaluate(() => { (window as any).__split.finish(); });
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Other repository draft');
  await expect(page.getByRole('status', { name: 'Git rebase in progress' })).toHaveCount(0);
  const fixture = await page.evaluate(() => (window as any).__split);
  expect(fixture.calls.some((call: any) => call.command === 'commit_changes')).toBe(false);
  expect(fixture.calls.filter((call: any) => call.command === 'begin_rebase_split')).toHaveLength(1);
});
