import { expect, test, type Page } from '@playwright/test';

const REFERENCE_COUNT = 300;
const MAX_RENDERED_ROWS = 30;

async function loadManyReferences(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate((count) => {
    const root = document.querySelector('gc-root');
    if (!root) throw new Error('Application root not found');
    const app = (window as Window & {
      ng: { getComponent(element: Element): { git: { repository(): any; repositories: { update(updater: (items: any[]) => any[]): void } } } };
    }).ng.getComponent(root);
    const repository = app.git.repository();
    const localTemplate = repository.branches.find((branch: { remote: boolean }) => !branch.remote);
    const oid = (index: number) => index.toString(16).padStart(40, '0');
    const branches = [
      localTemplate,
      ...Array.from({ length: count }, (_, index) => ({
        ...localTemplate,
        fullName: `refs/heads/local-${index.toString().padStart(4, '0')}`,
        name: `local-${index.toString().padStart(4, '0')}`,
        oid: oid(index + 1),
        current: false,
        remote: false,
        upstream: null,
        tracking: null,
      })),
      ...Array.from({ length: count }, (_, index) => ({
        ...localTemplate,
        fullName: `refs/remotes/origin/remote-${index.toString().padStart(4, '0')}`,
        name: `origin/remote-${index.toString().padStart(4, '0')}`,
        oid: oid(index + count + 1),
        current: false,
        remote: true,
        upstream: null,
        tracking: null,
      })),
    ];
    const tags = Array.from({ length: count }, (_, index) => ({
      ...repository.tags[0],
      fullName: `refs/tags/tag-${index.toString().padStart(4, '0')}`,
      name: `tag-${index.toString().padStart(4, '0')}`,
      oid: oid(index + count * 2 + 1),
    }));
    const stashes = Array.from({ length: count }, (_, index) => ({
      ...repository.stashes[0],
      reference: `stash@{${index}}`,
      oid: oid(index + count * 3 + 1),
      message: `WIP reference-${index.toString().padStart(4, '0')}`,
    }));
    app.git.repositories.update((items) => items.map((item) => item.id === repository.id
      ? { ...item, branches, tags, stashes }
      : item));
  }, REFERENCE_COUNT);
}

test('virtualizes reference lists while retaining filtering, collapse, scrolling, and tab navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await loadManyReferences(page);

  const localList = page.locator('#reference-section-local .branch-list');
  const remoteList = page.locator('#reference-section-remote .remote-locations');
  const tagsList = page.locator('#reference-section-tags .reference-content');
  const stashesList = page.locator('#reference-section-stashes .reference-content');

  await page.locator('#reference-section-tags .collapsible-heading').click();
  await page.locator('#reference-section-stashes .collapsible-heading').click();
  await expect(tagsList).toBeVisible();
  await expect(stashesList).toBeVisible();
  await expect.poll(() => tagsList.locator('[data-reference-index]').count()).toBeGreaterThan(0);
  await expect.poll(() => stashesList.locator('[data-reference-index]').count()).toBeGreaterThan(0);
  expect(await localList.locator('.branch-list-row').count()).toBeLessThanOrEqual(MAX_RENDERED_ROWS);
  await expect.poll(() => remoteList.locator('.remote-branch-row').count()).toBeLessThanOrEqual(MAX_RENDERED_ROWS);
  expect(await remoteList.locator('[data-reference-index]').count()).toBeLessThanOrEqual(MAX_RENDERED_ROWS);
  await expect.poll(() => tagsList.locator('[data-reference-index]').count()).toBeLessThanOrEqual(MAX_RENDERED_ROWS);
  await expect.poll(() => stashesList.locator('[data-reference-index]').count()).toBeLessThanOrEqual(MAX_RENDERED_ROWS);
  expect(await localList.locator('[data-reference-index]').count()).toBeLessThanOrEqual(MAX_RENDERED_ROWS);
  const localRowHeights = await localList.locator('.branch-list-row').evaluateAll((rows) =>
    rows.map((row) => (row as HTMLElement).getBoundingClientRect().height));
  expect(localRowHeights.every((height) => height === 30)).toBe(true);
  const remoteRowHeights = await remoteList.locator('[data-reference-index]').evaluateAll((rows) =>
    rows.map((row) => (row as HTMLElement).getBoundingClientRect().height));
  expect(remoteRowHeights.every((height) => height === 30)).toBe(true);

  await localList.evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const lastRenderedIndex = await localList.locator('[data-reference-index]').evaluateAll((rows) =>
    Math.max(...rows.map((row) => Number((row as HTMLElement).dataset['referenceIndex']))));
  expect(lastRenderedIndex).toBeGreaterThan(REFERENCE_COUNT - MAX_RENDERED_ROWS);

  await page.locator('.branch-search-control input').fill('local-0299');
  await expect(localList.locator('.branch-list-row')).toHaveCount(1);
  await expect(localList.locator('.branch-item')).toContainText('local-0299');
  await page.locator('.branch-search-control input').fill('');

  await remoteList.evaluate((list) => { list.scrollTop = 0; });
  await page.getByRole('button', { name: 'Collapse remote origin' }).click();
  await expect(remoteList.locator('.remote-branch-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand remote origin' }).click();
  await expect.poll(() => remoteList.locator('.remote-branch-row').count()).toBeGreaterThan(0);
  expect(await remoteList.locator('.remote-branch-row').count()).toBeLessThanOrEqual(MAX_RENDERED_ROWS);
  expect(await remoteList.locator('[data-reference-index]').count()).toBeLessThanOrEqual(MAX_RENDERED_ROWS);

  await localList.evaluate((list) => { list.scrollTop = 0; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const lastControlInFirstRow = localList.locator('[data-reference-index="0"] .visibility-toggle');
  await lastControlInFirstRow.focus();
  await lastControlInFirstRow.press('Tab');
  await expect(localList.locator('[data-reference-index="1"] .branch-item')).toBeFocused();
});

test('expands the rendered reference window when the list grows without scrolling', async ({ page }) => {
  await loadManyReferences(page);
  const list = page.locator('#reference-section-local .reference-content');
  await list.evaluate((element) => { element.scrollTop = 100 * 30; });
  await expect(list.locator('[data-reference-index="100"]')).toBeVisible();
  await list.evaluate((element) => { element.style.maxHeight = '800px'; });
  await expect.poll(() => list.evaluate((element) => element.clientHeight)).toBe(800);
  await expect.poll(() => list.evaluate((element) => {
    const rows = [...element.querySelectorAll('[data-reference-index]')];
    const last = rows.at(-1)?.getBoundingClientRect();
    return !!last && last.bottom >= element.getBoundingClientRect().bottom;
  })).toBe(true);
});

test('keeps remote group boundaries inside the virtual row height', async ({ page }) => {
  await loadManyReferences(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => items.map(item => ({
      ...item,
      branches: item.branches.filter((branch: { remote: boolean }) => !branch.remote),
      remotes: Array.from({ length: 30 }, (_, index) => ({
        name: `remote-${String(index).padStart(2, '0')}`,
        fetchUrl: `https://example.test/project-${index}.git`,
        pushUrl: `https://example.test/project-${index}.git`,
      })),
    })));
  });
  const list = page.locator('#reference-section-remote .reference-content');
  await expect.poll(() => list.evaluate(element => {
    const style = getComputedStyle(element);
    return element.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  })).toBe(30 * 30);
  await list.evaluate(element => { element.scrollTop = 15 * 30; });
  await expect.poll(() => list.locator('[data-reference-index="15"]').evaluate(row => {
    const list = row.closest('.reference-content')!;
    return Math.abs(row.getBoundingClientRect().top - list.getBoundingClientRect().top);
  })).toBeLessThan(1);
});
