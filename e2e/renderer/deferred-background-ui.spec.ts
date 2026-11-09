import { expect, test, type Page } from '@playwright/test';

async function interceptChunk(
  page: Page,
  matches: (source: string) => boolean,
  mode: 'hold' | 'fail',
): Promise<{ requested: Promise<void>; release: () => void }> {
  let markRequested!: () => void;
  let release!: () => void;
  const requested = new Promise<void>(resolve => { markRequested = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    if (!matches(source)) {
      await route.fulfill({ response, body: source });
      return;
    }
    markRequested();
    if (mode === 'hold') {
      await held;
      await route.fulfill({ response, body: source });
    } else {
      await held;
      await route.abort();
    }
  });
  return { requested, release };
}

for (const mode of ['hold', 'fail'] as const) {
  test(`keeps history usable when commit rows ${mode === 'hold' ? 'load late' : 'cannot load'}`, async ({ page }) => {
    const chunk = await interceptChunk(page,
      source => source.includes('GraphViewportComponent') && source.includes('virtual-commit-rows'), mode);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await chunk.requested;
    const fallback = page.locator('.graph-history-fallback');
    await expect(fallback.getByRole('status')).toContainText('Loading commit history');

    if (mode === 'hold') {
      await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const repository = app.git.repository();
        const template = repository.commits[1];
        const oid = (index: number) => index.toString(16).padStart(40, '0');
        const commits = Array.from({ length: 300 }, (_, index) => ({
          ...template,
          oid: oid(index),
          parents: index < 299 ? [oid(index + 1)] : [],
          subject: `Deferred commit ${index}`,
        }));
        app.git.repositories.update((repositories: any[]) => repositories.map((candidate) =>
          candidate.id === repository.id ? { ...candidate, commits, historyTruncated: false } : candidate));
      });
      await expect(fallback).toHaveCSS('height', '12000px');
      const list = page.locator('.commit-list');
      await list.evaluate(element => { element.scrollTop = 1800; });
      await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(1800);
      chunk.release();
      await expect(fallback).toHaveCount(0);
      await expect(page.locator('.virtual-commit-rows .commit-row').first()).toBeVisible();
      await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(1800);
      const firstVisible = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>('.commit-list')!;
        const top = list.getBoundingClientRect().top;
        const row = [...list.querySelectorAll<HTMLElement>('.commit-row[data-commit-oid]')]
          .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
          .find(candidate => candidate.getBoundingClientRect().bottom > top + 1);
        const leading = [...list.querySelectorAll<HTMLElement>('.wip-row')]
          .reduce((height, candidate) => height + candidate.offsetHeight, 0);
        return { oid: row?.dataset['commitOid'], index: Math.floor((list.scrollTop - leading) / 40) };
      });
      expect(firstVisible.oid).toBe(firstVisible.index.toString(16).padStart(40, '0'));
    } else {
      chunk.release();
      await expect(fallback.getByRole('alert')).toContainText('Commit history could not load');
      await expect(page.getByText('No commits yet')).toHaveCount(0);
      await page.locator('.wip-nav').click();
      await expect(page.locator('.wip-nav')).toHaveClass(/selected/);
      await page.evaluate(() => {
        const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
        const repository = git.repository();
        git.repositories.update((repositories: any[]) => repositories.map((candidate) =>
          candidate.id === repository.id ? { ...candidate, commits: [], historyTruncated: false } : candidate));
      });
      await expect(fallback).toHaveCount(0);
      await expect(page.getByText('No commits yet')).toBeVisible();
    }
  });
}

for (const mode of ['hold', 'fail'] as const) {
  test(`preserves graph row space while worktree row code ${mode === 'hold' ? 'loads' : 'fails to load'}`, async ({ page }) => {
    const chunk = await interceptChunk(page,
      source => source.includes('Stash message') && source.includes('Open Worktree'), mode);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await chunk.requested;
    const fallback = page.locator('.graph-row-fallback');
    await expect(fallback).toHaveCount(2);
    await expect(fallback.first().getByRole('status')).toContainText('Loading worktree changes');
    const before = await page.evaluate(() => {
      const placeholders = [...document.querySelectorAll<HTMLElement>('.graph-row-fallback')];
      const firstCommit = document.querySelector<HTMLElement>('.virtual-commit-rows .commit-row')!;
      return { heights: placeholders.map(row => row.getBoundingClientRect().height), commitTop: firstCommit.getBoundingClientRect().top };
    });
    expect(before.heights).toEqual([44, 44]);
    chunk.release();
    if (mode === 'hold') {
      await expect(fallback).toHaveCount(0);
      await expect(page.locator('.wip-row[role="button"]')).toHaveCount(2);
      const after = await page.locator('.virtual-commit-rows .commit-row').first().boundingBox();
      expect(after).not.toBeNull();
      expect(after!.y).toBe(before.commitTop);
      await page.locator('.wip-row[role="button"]:not(.linked-worktree)').click();
      await expect(page.locator('.wip-row[role="button"]:not(.linked-worktree)')).toHaveAttribute('aria-pressed', 'true');
    } else {
      await expect(fallback.first().getByRole('alert')).toContainText('Worktree rows could not load');
      await expect(page.locator('.virtual-commit-rows .commit-row').first()).toBeVisible();
      await page.locator('.wip-nav').click();
      await expect(page.locator('.wip-nav')).toHaveClass(/selected/);
    }
  });
}

test('preserves independent warnings and keyboard focus if warning controls cannot load', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.virtual-commit-rows .commit-row').first()).toBeVisible();
  const chunk = await interceptChunk(page,
    source => source.includes('background-operation-warning') && source.includes('Dismiss background operation warning'), 'fail');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.reportBackgroundOperationWarning('warning-one', 'The first read may still be running.');
    git.reportBackgroundOperationWarning('warning-two', 'The second read may still be running.');
  });
  await chunk.requested;
  await expect(page.getByRole('status').filter({ hasText: 'Loading background operation warnings' })).toBeVisible();
  chunk.release();
  const warnings = page.getByRole('region', { name: 'Background operation warnings' });
  await expect(warnings).toContainText('Warning controls could not load');
  await expect(warnings.getByRole('alert')).toHaveCount(2);
  const buttons = warnings.getByRole('button', { name: 'Dismiss background operation warning' });
  await buttons.first().focus();
  await page.keyboard.press('Enter');
  await expect(warnings.getByRole('alert')).toHaveCount(1);
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(warnings).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});
