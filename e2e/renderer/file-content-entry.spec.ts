import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Context = 'commit' | 'stash' | 'revisions' | 'revisionWorktree' | 'staged' | 'unstaged' | 'conflicted';
const path = 'preview *[owned].png';
const previousPath = 'original-image.png';
const bytes = readFileSync(resolve('crates/git-core/tests/fixtures/media/tiles.png'));
const response = {
  before: { label: 'Selected base', path: previousPath, state: 'unavailable', oid: null, size: null,
    raster: null, dataUrl: null, lfs: null, message: 'Owned selected base object is unavailable' },
  after: { label: 'Selected target', path, state: 'raster', oid: 'd'.repeat(40), size: String(bytes.length),
    raster: { mime: 'image/png', width: 3, height: 2 }, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, lfs: null, message: null },
};

async function prepare(page: Page, context: Context, held = false) {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async ({ context, path, previousPath, response, held }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git, original = git.repository();
    await git.inspectCommit(original.headOid);
    const details = git.commitDetails();
    const base = original.commits.at(-1).oid;
    const file = { path, previousPath, status: 'R100', additions: null, deletions: null };
    const working = ['staged', 'unstaged', 'conflicted'].includes(context);
    if (context === 'revisions') await git.compareCommits(base, details.oid);
    else if (context === 'revisionWorktree') await git.compareCommitWithWorkingTree(base);
    if (context === 'revisions' || context === 'revisionWorktree') {
      git.commitComparison.update((comparison: any) => ({ ...comparison, files: [file] }));
    } else if (working) {
      app.selectWip();
      const status = { ...original.status, staged: context === 'staged' ? 1 : 0, unstaged: context === 'staged' ? 0 : 1,
        conflicted: context === 'conflicted' ? 1 : 0, untracked: 0, entryCount: 1, entriesTruncated: false,
        entries: [{ path, indexStatus: context === 'staged' ? 'R' : context === 'conflicted' ? 'U' : ' ', worktreeStatus: context === 'staged' ? ' ' : context === 'conflicted' ? 'U' : 'M', conflicted: context === 'conflicted' }] };
      git.repositories.set([{ ...original, status }, { ...original, id: 'other-content-repository', path: '/owned/other-content' }]);
    } else {
      git.commitDetails.set({ ...details, files: [file] });
      git.inspectedStashReference.set(context === 'stash' ? 'stash@{0}' : null);
    }
    app.changesOpen.set(working);
    app.diffViewerOpen.set(false);
    git.workingTreeFileDiff.set(null); git.commitFileDiff.set(null); git.comparisonFileDiff.set(null);
    const state: any = { app, git, calls: [], response, held, allowPatch: false, base, oid: details.oid };
    (window as any).__directContent = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'inspect_file_media') return state.held
        ? new Promise(resolve => { state.finish = () => resolve(state.response); }) : Promise.resolve(state.response);
      if (command === 'cancel_git_operation') return Promise.resolve(true);
      if (['inspect_working_tree_file', 'inspect_commit_file', 'inspect_stash_file', 'compare_commit_file', 'compare_commit_file_with_working_tree'].includes(command)) {
        if (!state.allowPatch) return Promise.reject({ message: 'Owned patch object is unavailable' });
        return Promise.resolve({ oid: args.oid, path: args.path, staged: args.staged, patch: 'Binary files differ', truncated: false });
      }
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      if (command === 'refresh_repository' || command === 'open_repository') return Promise.resolve(git.repository());
      return Promise.resolve(null);
    } };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
  }, { context, path, previousPath, response, held });
  return context === 'conflicted' ? page.getByTitle(`Open Merge Tool for ${path}`, { exact: true })
    : context === 'staged' ? page.getByRole('button', { name: `View staged changes in ${path}`, exact: true })
      : context === 'unstaged' ? page.getByRole('button', { name: `View changes in ${path}`, exact: true })
        : page.locator('.commit-file').first();
}

async function openContent(page: Page, row: ReturnType<Page['locator']>) {
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Preview file content', exact: true }).click();
  return page.getByRole('dialog', { name: path, exact: true });
}

for (const context of ['commit', 'stash', 'revisions', 'revisionWorktree', 'staged', 'unstaged', 'conflicted'] as const) {
  test(`opens ${context} content directly with no preceding patch request`, async ({ page }) => {
    const row = await prepare(page, context);
    const dialog = await openContent(page, row);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Displayed orientation: 3 × 2 px', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Owned selected base object is unavailable', { exact: true })).toBeVisible();
    const result = await page.evaluate(() => {
      const state = (window as any).__directContent;
      return { calls: state.calls, base: state.base, oid: state.oid };
    });
    const media = result.calls.filter((call: any) => call.command === 'inspect_file_media');
    expect(media).toHaveLength(1);
    expect(result.calls.filter((call: any) => /^(inspect_(working_tree|commit|stash)_file|compare_commit_file)/.test(call.command))).toEqual([]);
    const expected = context === 'commit' ? { kind: 'commit', oid: result.oid }
      : context === 'stash' ? { kind: 'stash', oid: result.oid, layer: 'combined' }
        : context === 'revisions' ? { kind: 'revisions', baseOid: result.base, targetOid: result.oid }
          : context === 'revisionWorktree' ? { kind: 'revisionWorktree', baseOid: result.base }
            : { kind: 'workingTree', staged: context === 'staged' };
    expect(media[0].args.request).toEqual({ context: expected, path,
      previousPath: ['staged', 'unstaged', 'conflicted'].includes(context) ? null : previousPath });
  });
}

test('supports keyboard context entry, traps dialog focus and restores the original row', async ({ page }) => {
  const row = await prepare(page, 'unstaged');
  await row.focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Preview file content', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: path, exact: true });
  await expect(dialog.getByRole('button', { name: 'Close file content', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
});

test('closing a held content dialog cancels its request and ignores its late reply', async ({ page }) => {
  const row = await prepare(page, 'unstaged', true);
  const dialog = await openContent(page, row);
  await expect(dialog.getByRole('button', { name: 'Cancel content load', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close file content', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__directContent.calls.filter((call: any) => call.command === 'cancel_git_operation').length)).toBe(1);
  await page.evaluate(() => (window as any).__directContent.finish());
  await expect(dialog).toHaveCount(0);
});

test('a repository switch dismisses a held content dialog and cancels the old request', async ({ page }) => {
  const row = await prepare(page, 'unstaged', true);
  const dialog = await openContent(page, row);
  await expect(dialog.getByRole('button', { name: 'Cancel content load', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__directContent.git.activeRepositoryId.set('other-content-repository'));
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).__directContent.finish());
  expect(await page.evaluate(() => (window as any).__directContent.calls.some((call: any) => call.command === 'cancel_git_operation'))).toBe(true);
});

test('View changes still reads a patch only after its explicit menu action', async ({ page }) => {
  const row = await prepare(page, 'unstaged');
  await row.click({ button: 'right' });
  expect(await page.evaluate(() => (window as any).__directContent.calls.filter((call: any) => call.command === 'inspect_working_tree_file').length)).toBe(0);
  await page.evaluate(() => { (window as any).__directContent.allowPatch = true; });
  await page.getByRole('menuitem', { name: 'View changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close diff', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__directContent.calls.filter((call: any) => call.command === 'inspect_working_tree_file').length)).toBe(1);
});

test('an open comparison menu preserves its original revision pair across a background selection update', async ({ page }) => {
  const row = await prepare(page, 'revisions');
  await row.click({ button: 'right' });
  const action = page.getByRole('menuitem', { name: 'Preview file content', exact: true });
  await expect(action).toBeVisible();
  await expect(action).toBeEnabled();
  await action.evaluate(button => {
    const state = (window as any).__directContent;
    state.git.commitComparison.update((comparison: any) => ({ ...comparison, baseOid: 'e'.repeat(40), targetOid: 'f'.repeat(40) }));
    if (!(button instanceof HTMLButtonElement)) throw Error('Expected a file content menu button');
    button.click();
  });
  await expect(page.getByRole('dialog', { name: path, exact: true })).toBeVisible();
  const selection = await page.evaluate(() => {
    const state = (window as any).__directContent;
    return { request: state.calls.find((call: any) => call.command === 'inspect_file_media')?.args.request,
      expected: { kind: 'revisions', baseOid: state.base, targetOid: state.oid } };
  });
  expect(selection.request.context).toEqual(selection.expected);
});

test('a stale menu click cannot read the same path from a different repository', async ({ page }) => {
  const row = await prepare(page, 'unstaged');
  await row.click({ button: 'right' });
  const action = page.getByRole('menuitem', { name: 'Preview file content', exact: true });
  await expect(action).toBeVisible();
  await expect(action).toBeEnabled();
  await action.evaluate(button => {
    const state = (window as any).__directContent;
    state.git.activeRepositoryId.set('other-content-repository');
    if (!(button instanceof HTMLButtonElement)) throw Error('Expected a file content menu button');
    button.click();
  });
  await expect(page.locator('gc-file-content-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__directContent.calls.filter((call: any) => call.command === 'inspect_file_media').length)).toBe(0);
});

for (const width of [320, 700, 1440]) {
  test(`keeps the standalone content dialog within a ${width}px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const row = await prepare(page, 'unstaged');
    const dialog = await openContent(page, row);
    await expect(dialog.getByText('Displayed orientation: 3 × 2 px', { exact: true })).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(800);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`direct-content-${width}.png`), fullPage: true });
  });
}

test('a content dialog whose code cannot load keeps a keyboard escape route without reading a file', async ({ page }) => {
  const row = await prepare(page, 'unstaged');
  const blocked: string[] = [];
  await page.route('**/*.js', async route => { blocked.push(route.request().url()); await route.abort(); });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Preview file content', exact: true }).click();
  const unavailable = page.getByRole('dialog', { name: 'File content unavailable', exact: true });
  await expect(unavailable).toBeVisible();
  expect(blocked.length).toBeGreaterThan(0);
  await expect(unavailable.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(unavailable.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(unavailable).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => (window as any).__directContent.calls.filter((call: any) => call.command === 'inspect_file_media').length)).toBe(0);
});

test('cancelling before deferred content code arrives never starts a late file read', async ({ page }) => {
  const row = await prepare(page, 'unstaged');
  const pending: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*.js', async route => {
    pending.push(route.request().url());
    await gate;
    await route.continue();
  });
  try {
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Preview file content', exact: true }).click();
    const loading = page.getByRole('dialog', { name: 'Opening file content', exact: true });
    await expect(loading.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    expect(pending.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(loading).toHaveCount(0);
    release();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('gc-file-content-dialog')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__directContent.calls.filter((call: any) => call.command === 'inspect_file_media').length)).toBe(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
