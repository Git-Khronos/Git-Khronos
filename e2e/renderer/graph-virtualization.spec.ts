import { expect, test, type Page } from '@playwright/test';

const TOTAL = 3000;
const ROW_HEIGHT = 40;

/** Replaces the mock history with a long synthetic one (dev builds expose `ng` for this). */
async function loadLongHistory(page: Page, total = TOTAL): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  await page.evaluate((total) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repository = app.git.repository();
    const template = repository.commits[1];
    const oid = (index: number) => index.toString(16).padStart(40, '0');
    let time = Date.parse('2026-10-01T12:00:00Z');
    const commits = Array.from({ length: total }, (_, index) => {
      time -= 3_600_000;
      return {
        ...template,
        oid: oid(index),
        parents: index + 1 < total ? (index % 9 === 0 && index + 3 < total ? [oid(index + 1), oid(index + 3)] : [oid(index + 1)]) : [],
        authorName: `Author ${index % 5}`,
        authorEmail: `author${index % 5}@example.com`,
        authoredAt: new Date(time).toISOString(),
        committedAt: new Date(time).toISOString(),
        subject: `Synthetic commit ${index}`,
        summary: '',
        body: '',
      };
    });
    app.git.repositories.update((repositories: any[]) => repositories.map((candidate) =>
      candidate.id === repository.id ? { ...candidate, commits, historyTruncated: false } : candidate));
  }, total);
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toContainText('Synthetic commit 0');
}

/** Rendered commit rows must be contiguous, in visual order, and show their own commit. */
async function renderedRowProblems(page: Page): Promise<string[]> {
  return page.evaluate((rowHeight) => {
    const problems: string[] = [];
    // Recycled rows keep a fixed DOM slot, so compare them in visual (commit index) order.
    const rows = [...document.querySelectorAll<HTMLElement>('.commit-row[data-graph-row]:not(.wip-row)')]
      .sort((a, b) => parseInt(a.dataset['commitOid']!, 16) - parseInt(b.dataset['commitOid']!, 16));
    let previousIndex = -1;
    let previousTop = -Infinity;
    for (const row of rows) {
      const index = parseInt(row.dataset['commitOid']!, 16);
      const subject = row.querySelector('.subject')?.textContent?.trim();
      if (subject !== `Synthetic commit ${index}`) problems.push(`row ${index} shows "${subject}"`);
      if (!row.getAttribute('aria-label')?.startsWith(`Synthetic commit ${index},`)) problems.push(`row ${index} has a stale label`);
      if (previousIndex >= 0 && index !== previousIndex + 1) problems.push(`row ${index} follows ${previousIndex}`);
      const top = row.getBoundingClientRect().top;
      if (previousIndex >= 0 && Math.abs(top - previousTop - rowHeight) > 0.5) problems.push(`row ${index} is not directly below ${previousIndex}`);
      previousIndex = index;
      previousTop = top;
    }
    return problems;
  }, ROW_HEIGHT);
}

test('recycled history rows always show the commit at their position while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await loadLongHistory(page);
  const list = page.locator('.commit-list');
  const steps = [37, 120, 400, 1300, 7, 2200, 60_000, 30_000, 33_333, 0, 85_000, 119_000, 50];
  for (const scrollTop of steps) {
    await list.evaluate((element, top) => { element.scrollTop = top; }, scrollTop);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await renderedRowProblems(page), `after scrolling to ${scrollTop}`).toEqual([]);
    const firstVisible = await page.evaluate(() => {
      const listBox = document.querySelector('.commit-list')!.getBoundingClientRect();
      const row = [...document.querySelectorAll<HTMLElement>('.commit-row[data-graph-row]:not(.wip-row)')]
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .find((candidate) => candidate.getBoundingClientRect().bottom > listBox.top + 1);
      return row ? parseInt(row.dataset['commitOid']!, 16) : -1;
    });
    const leading = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.commit-row.wip-row')]
      .reduce((height, row) => height + row.offsetHeight, 0));
    const scrolled = await list.evaluate((element) => element.scrollTop);
    expect(firstVisible).toBe(Math.max(0, Math.floor((scrolled - leading) / ROW_HEIGHT)));
  }
});

test('recycled rows keep selection and per-commit state attached to the right commit', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await loadLongHistory(page);
  const list = page.locator('.commit-list');
  const target = page.locator(`[data-commit-oid="${(5).toString(16).padStart(40, '0')}"]`);
  await target.click();
  await expect(target).toHaveClass(/selected/);
  for (const top of [400, 2000, 9000, 40_000, 0]) {
    await list.evaluate((element, value) => { element.scrollTop = value; }, top);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const selected = await page.locator('.commit-row.selected[data-graph-row]:not(.wip-row)').evaluateAll((rows) =>
      rows.map((row) => parseInt((row as HTMLElement).dataset['commitOid']!, 16)));
    expect(selected, `selected rows after scrolling to ${top}`).toEqual(top < 1200 ? [5] : []);
  }
});

test('keyboard focus never moves to another commit when its row is recycled', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await loadLongHistory(page);
  const list = page.locator('.commit-list');
  const row = page.locator(`[data-commit-oid="${(3).toString(16).padStart(40, '0')}"]`);
  await row.click();
  await expect(row).toBeFocused();
  await list.evaluate((element) => { element.scrollTop = 4000; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const focusedOid = await page.evaluate(() => document.activeElement?.closest<HTMLElement>('[data-graph-row]')?.dataset['commitOid'] ?? null);
  expect(focusedOid === null || parseInt(focusedOid, 16) === 3).toBe(true);
  // Keyboard navigation still starts from the selected commit.
  await list.evaluate((element) => { element.scrollTop = 0; });
  await row.focus();
  await row.press('ArrowDown');
  await expect(page.locator(`[data-commit-oid="${(4).toString(16).padStart(40, '0')}"]`)).toBeFocused();
});

test('scrolling reuses row elements instead of rebuilding them', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await loadLongHistory(page, 20_000);
  const reuse = await page.evaluate(async () => {
    const list = document.querySelector<HTMLElement>('.commit-list')!;
    const rows = () => new Set(document.querySelectorAll('.commit-row[data-graph-row]:not(.wip-row)'));
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    list.scrollTop = 4000;
    await nextFrame();
    const before = rows();
    let moved = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) moved += record.addedNodes.length + record.removedNodes.length;
    });
    observer.observe(document.querySelector('.virtual-commit-rows')!, { childList: true });
    const changed: number[] = [];
    for (let step = 0; step < 40; step += 1) {
      list.scrollTop += step % 2 ? 120 : 1600;
      await nextFrame();
      const after = rows();
      changed.push([...after].filter((row) => !before.has(row)).length);
    }
    observer.disconnect();
    return { size: before.size, created: Math.max(...changed), moved };
  });
  // Row views are rebound in place, including after jumps far beyond the rendered window, and never
  // moved in the DOM (a move makes the engine restyle and repaint the row).
  expect(reuse.size).toBeGreaterThan(20);
  expect(reuse.created).toBe(0);
  expect(reuse.moved).toBe(0);
  expect(await renderedRowProblems(page)).toEqual([]);
});
