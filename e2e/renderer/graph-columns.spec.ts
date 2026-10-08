import { expect, test, type Page } from '@playwright/test';

// Exhaustive layout checks for the commit history columns: every ordering, resizing from every
// separator, both horizontal-scroll modes, window resizes, and real drag-and-drop reordering.

type Column = 'branch' | 'graph' | 'message' | 'author' | 'date' | 'sha';

const REPOSITORY_KEY = 'git-chronos.graph.%2Fhome%2Fmaya%2Fprojects%2Fgit-chronos';
const DEFAULT_VISIBLE: Column[] = ['branch', 'graph', 'message', 'author', 'date'];
const SEPARATORS: Record<Column, string> = {
  branch: 'Resize Branch and Tag column',
  graph: 'Resize Graph column',
  message: 'Resize Commit Message column',
  author: 'Resize Author column',
  date: 'Resize Date and Time column',
  sha: 'Resize SHA column',
};
const HEADINGS: Record<Column, string> = {
  branch: 'BRANCH / TAG', graph: 'GRAPH', message: 'COMMIT MESSAGE', author: 'AUTHOR', date: 'DATE / TIME', sha: 'SHA',
};

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

async function openWithLayout(page: Page, order: Column[], options: { scroll?: boolean; sha?: boolean } = {}) {
  await page.evaluate(({ key, order, options }) => {
    localStorage.clear();
    const hidden = (['branch', 'graph', 'message', 'author', 'date', 'sha'] as const).filter((column) => !order.includes(column));
    localStorage.setItem(`${key}.column.order`, JSON.stringify([...order, ...hidden]));
    if (options.sha) localStorage.setItem(`${key}.column.sha.visible`, 'true');
    if (options.scroll === false) localStorage.setItem('git-chronos.graph.horizontal-scroll', 'false');
  }, { key: REPOSITORY_KEY, order, options });
  await page.reload();
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
}

/** Measures the header and the first commit row, returning every violated layout invariant. */
function layoutProblems(page: Page, expectedOrder: Column[], fit: boolean) {
  return page.evaluate(({ expectedOrder, fit }) => {
    const problems: string[] = [];
    const header = document.querySelector<HTMLElement>('.graph-columns')!;
    const list = document.querySelector<HTMLElement>('.commit-list')!;
    const row = document.querySelector<HTMLElement>('.commit-row[data-commit-oid]')!;
    const byOrder = (parent: Element, selector: string) => [...parent.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.style.order !== '' && element.getBoundingClientRect().width > 0)
      .sort((a, b) => Number(a.style.order) - Number(b.style.order));
    const headings = byOrder(header, ':scope > .draggable-column');
    const cells = byOrder(row, ':scope > [style*="order"]');
    const titles = headings.map((heading) => (heading.textContent ?? '').replace(/\s+/g, ' ').trim());
    if (headings.length !== expectedOrder.length) problems.push(`expected ${expectedOrder.length} headings, found ${headings.length}: ${titles.join('|')}`);
    const boxes = headings.map((heading) => heading.getBoundingClientRect());
    for (let index = 1; index < boxes.length; index += 1) {
      const gap = boxes[index].left - boxes[index - 1].right;
      if (Math.abs(gap) > 1) problems.push(`${gap < 0 ? 'overlap' : 'gap'} of ${gap.toFixed(1)}px between headings ${index - 1} and ${index}`);
    }
    for (const [index, box] of boxes.entries()) {
      if (box.width < 30) problems.push(`heading ${index} is only ${box.width.toFixed(1)}px wide`);
    }
    // Row cells share the heading tracks.
    for (const [index, cell] of cells.entries()) {
      const heading = boxes[index];
      const box = cell.getBoundingClientRect();
      if (heading && Math.abs(box.left - heading.left) > 1.5) problems.push(`row cell ${index} starts at ${box.left.toFixed(1)}, heading at ${heading.left.toFixed(1)}`);
    }
    // Resizing moves only a column's right edge, so narrowing may leave free space after the last
    // heading. The last heading never spills past the visible header, and the settings button stays
    // at the panel's right end.
    const gear = document.querySelector<HTMLElement>('[aria-label="Configure graph columns"]')!.getBoundingClientRect();
    const last = boxes.at(-1)!;
    const overflow = list.scrollWidth - list.clientWidth;
    const visibleRight = header.getBoundingClientRect().left + header.clientWidth - parseFloat(getComputedStyle(header).paddingRight);
    if (gear.width < 20 || gear.width > 32) problems.push(`settings button is ${gear.width.toFixed(1)}px wide`);
    if (overflow <= 1) {
      if (last.right > visibleRight + 1) problems.push(`last heading ends at ${last.right.toFixed(1)}, past the panel edge at ${visibleRight.toFixed(1)}`);
      if (Math.abs(gear.right - visibleRight) > 4) problems.push(`settings button ${gear.left.toFixed(1)}-${gear.right.toFixed(1)} is not at the panel edge ${visibleRight.toFixed(1)}`);
    }
    // Scroll markers stay in their own rail and never cover the settings button, or row actions once
    // they rest at the end (no overflow, or scrolled fully right). Until then, overflowing content
    // scrolls under the rail as it would under a scrollbar.
    const atEnd = list.scrollWidth - list.clientWidth - list.scrollLeft <= 1;
    const actions = [
      ...(atEnd ? [...document.querySelectorAll<HTMLElement>('.commit-row .row-menu')].map((element) => element.getBoundingClientRect()) : []),
      document.querySelector<HTMLElement>('[aria-label="Configure graph columns"]')!.getBoundingClientRect(),
    ];
    for (const marker of document.querySelectorAll<HTMLElement>('.graph-scroll-marker')) {
      const box = marker.getBoundingClientRect();
      if (actions.some((action) => box.left < action.right && action.left < box.right && box.top < action.bottom && action.top < box.bottom)) {
        problems.push(`scroll marker ${marker.getAttribute('aria-label')} at ${box.left.toFixed(1)}-${box.right.toFixed(1)} covers a row action`);
      }
    }
    if (fit && overflow > 1) problems.push(`fitted columns overflow by ${overflow}px`);
    if (Math.abs(header.scrollLeft - list.scrollLeft) > 1) problems.push(`header scroll ${header.scrollLeft} differs from list scroll ${list.scrollLeft}`);
    // Separators report sane, in-range widths that match what is drawn.
    for (const [index, heading] of headings.entries()) {
      const separator = heading.querySelector<HTMLElement>(':scope > [role="separator"]');
      if (!separator) { problems.push(`heading ${index} has no separator`); continue; }
      const now = Number(separator.getAttribute('aria-valuenow'));
      const min = Number(separator.getAttribute('aria-valuemin'));
      const max = Number(separator.getAttribute('aria-valuemax'));
      const label = separator.getAttribute('aria-label');
      if (!(min <= now && now <= Math.max(max, now - 0) && min <= max)) problems.push(`${label}: now ${now} outside ${min}-${max}`);
      if (now < min) problems.push(`${label}: ${now} below minimum ${min}`);
      const drawn = boxes[index].width - (index === boxes.length - 1 && headings.length ? 26 : 0);
      if (Math.abs(now - drawn) > 1.5 && Math.abs(now - boxes[index].width) > 1.5) problems.push(`${label}: reports ${now}px, draws ${drawn.toFixed(1)}px`);
      // Every column, including the last, resizes from its own right edge.
      const handle = separator.getBoundingClientRect();
      const handleCenter = handle.left + handle.width / 2;
      if (handleCenter <= boxes[index].left + boxes[index].width / 2 || handleCenter > boxes[index].right + 1) {
        problems.push(`${label}: handle at ${handleCenter.toFixed(1)} is not on the right edge ending at ${boxes[index].right.toFixed(1)}`);
      }
    }
    return { problems, titles };
  }, { expectedOrder, fit });
}

async function expectLayout(page: Page, order: Column[], context: string, fit = false) {
  try {
    await expect.poll(async () => (await layoutProblems(page, order, fit)).problems, { timeout: 3000 }).toEqual([]);
  } catch {
    throw new Error(`${context}: ${(await layoutProblems(page, order, fit)).problems.join('; ')}`);
  }
  const { titles } = await layoutProblems(page, order, fit);
  expect(titles.map((title) => title.toUpperCase()), context).toEqual(order.map((column) => expect.stringContaining(HEADINGS[column])));
}

async function separatorWidth(page: Page, column: Column) {
  return Number(await page.getByRole('separator', { name: SEPARATORS[column], exact: true }).getAttribute('aria-valuenow'));
}

/** Drives every separator through shrinking, growing, the extremes, and a reset. */
async function exerciseSeparators(page: Page, order: Column[], context: string, fit: boolean) {
  for (const column of order) {
    const separator = page.getByRole('separator', { name: SEPARATORS[column], exact: true });
    await separator.focus();
    for (const key of ['Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowRight', 'Home', 'End', 'Home']) {
      await page.keyboard.press(key);
      await expectLayout(page, order, `${context} · ${column} ${key}`, fit);
    }
    await separator.dispatchEvent('dblclick');
    await expectLayout(page, order, `${context} · ${column} reset`, fit);
  }
}

const allOrders = permutations(DEFAULT_VISIBLE);

for (const first of DEFAULT_VISIBLE) {
  test(`keeps every column ordering starting with ${first} aligned while resizing`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/');
    for (const order of allOrders.filter((candidate) => candidate[0] === first)) {
      await openWithLayout(page, order);
      await expectLayout(page, order, `${order.join()} initial`);
      await exerciseSeparators(page, order, order.join(), false);
    }
  });

  test(`fits every column ordering starting with ${first} when horizontal scrolling is off`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    for (const order of allOrders.filter((candidate) => candidate[0] === first)) {
      await openWithLayout(page, order, { scroll: false });
      await expectLayout(page, order, `${order.join()} fitted initial`, true);
      await exerciseSeparators(page, order, `${order.join()} fitted`, true);
    }
  });
}

test('keeps the SHA column aligned in every position', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  for (const base of [DEFAULT_VISIBLE, [...DEFAULT_VISIBLE].reverse()]) {
    for (let position = 0; position <= base.length; position += 1) {
      const order = [...base.slice(0, position), 'sha', ...base.slice(position)] as Column[];
      for (const scroll of [true, false]) {
        await openWithLayout(page, order, { sha: true, scroll });
        await expectLayout(page, order, `${order.join()} scroll=${scroll}`, !scroll);
        await exerciseSeparators(page, order, `${order.join()} scroll=${scroll}`, !scroll);
      }
    }
  }
});

test('keeps orderings aligned with only some columns shown', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  const subsets: Column[][] = [
    ['message'], ['graph', 'message'], ['message', 'graph'], ['author', 'message'], ['message', 'date'],
    ['date', 'branch'], ['graph', 'author', 'date'], ['sha', 'branch', 'message'],
  ];
  for (const order of subsets) {
    for (const scroll of [true, false]) {
      await page.evaluate(({ key, order, scroll }) => {
        localStorage.clear();
        const all = ['branch', 'graph', 'message', 'author', 'date', 'sha'];
        for (const column of all) localStorage.setItem(`${key}.column.${column}.visible`, String(order.includes(column)));
        localStorage.setItem(`${key}.column.order`, JSON.stringify([...order, ...all.filter((column) => !order.includes(column))]));
        localStorage.setItem('git-chronos.graph.horizontal-scroll', String(scroll));
      }, { key: REPOSITORY_KEY, order, scroll });
      await page.reload();
      await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
      await expectLayout(page, order, `${order.join()} scroll=${scroll}`, !scroll);
      await exerciseSeparators(page, order, `${order.join()} scroll=${scroll}`, !scroll);
    }
  }
});

test('keeps column layouts intact across window resizes', async ({ page }) => {
  test.setTimeout(240_000);
  const orders: Column[][] = [
    DEFAULT_VISIBLE,
    ['branch', 'graph', 'message', 'date', 'author'],
    ['author', 'date', 'message', 'graph', 'branch'],
    ['graph', 'branch', 'date', 'author', 'message'],
  ];
  for (const order of orders) {
    for (const scroll of [true, false]) {
      await page.setViewportSize({ width: 1920, height: 900 });
      await page.goto('/');
      await openWithLayout(page, order, { scroll });
      // Freeze the message width with a real resize, then widen a middle column.
      await page.getByRole('separator', { name: SEPARATORS[order[1]], exact: true }).focus();
      await page.keyboard.press('Shift+ArrowRight');
      for (const width of [1440, 1700, 2200, 1500, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await expectLayout(page, order, `${order.join()} scroll=${scroll} at ${width}px`, !scroll);
      }
    }
  }
});

test('resizes the last column from its right edge without moving columns to its left', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  for (const order of [
    ['branch', 'graph', 'message', 'date', 'author'],
    ['branch', 'graph', 'author', 'date', 'message'],
    ['branch', 'message', 'author', 'date', 'graph'],
    ['graph', 'message', 'author', 'date', 'branch'],
  ] as Column[][]) {
    for (const scroll of [true, false]) {
      await openWithLayout(page, order, { scroll });
      const last = order.at(-1)!;
      const neighbour = order.at(-2)!;
      // Freeze the automatic layout first so widths are exact.
      await page.getByRole('separator', { name: SEPARATORS[order[0]], exact: true }).focus();
      await page.keyboard.press('ArrowLeft');
      const startLast = await separatorWidth(page, last);
      const startNeighbour = await separatorWidth(page, neighbour);
      const lastHeading = page.locator('.graph-columns > .draggable-column').filter({ hasText: HEADINGS[last] }).first();
      const lastBox = (await lastHeading.boundingBox())!;
      const handle = (await page.getByRole('separator', { name: SEPARATORS[last], exact: true }).boundingBox())!;
      // The handle sits at the column's right end, not on the boundary with the neighbour.
      expect(handle.x + handle.width / 2, order.join()).toBeGreaterThan(lastBox.x + lastBox.width / 2);
      const y = handle.y + handle.height / 2;
      const shrinkBy = Math.min(40, startLast - Number(await page.getByRole('separator', { name: SEPARATORS[last], exact: true }).getAttribute('aria-valuemin')));
      expect(shrinkBy, `${order.join()} last column has room`).toBeGreaterThan(5);
      await page.mouse.move(handle.x + handle.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 - shrinkBy, y, { steps: 3 });
      await expect.poll(() => separatorWidth(page, last), order.join()).toBe(startLast - shrinkBy);
      expect(await separatorWidth(page, neighbour), `${order.join()} neighbour unchanged`).toBe(startNeighbour);
      expect((await lastHeading.boundingBox())!.x, `${order.join()} left edge fixed`).toBeCloseTo(lastBox.x, 0);
      await page.mouse.move(handle.x + handle.width / 2, y, { steps: 3 });
      await expect.poll(() => separatorWidth(page, last), order.join()).toBe(startLast);
      expect(await separatorWidth(page, neighbour), `${order.join()} neighbour unchanged`).toBe(startNeighbour);
      await page.mouse.move(handle.x + handle.width / 2 - shrinkBy, y, { steps: 3 });
      await page.mouse.up();
      await expect.poll(() => separatorWidth(page, last), order.join()).toBe(startLast - shrinkBy);
      expect(await separatorWidth(page, neighbour), `${order.join()} neighbour unchanged`).toBe(startNeighbour);
      await page.reload();
      await expect.poll(() => separatorWidth(page, last), `${order.join()} persisted`).toBe(startLast - shrinkBy);
      expect(await separatorWidth(page, neighbour), `${order.join()} neighbour persisted`).toBe(startNeighbour);
    }
  }
});

test('reorders columns by dragging headings in both directions and persists the order', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  await openWithLayout(page, DEFAULT_VISIBLE);
  const heading = (column: Column) => page.locator('.graph-columns > .draggable-column').filter({ hasText: HEADINGS[column] }).first();
  let order = [...DEFAULT_VISIBLE];
  const moves: [Column, Column][] = [
    ['branch', 'date'], // to the far right: lands last
    ['date', 'graph'], // leftwards: lands before the target
    ['author', 'branch'], // rightwards onto the last column: becomes last
    ['branch', 'graph'], // leftwards to the first column
    ['message', 'author'], // rightwards by one
    ['date', 'message'], // leftwards by one
  ];
  for (const [source, target] of moves) {
    const from = order.indexOf(source);
    const to = order.indexOf(target);
    order = order.filter((column) => column !== source);
    order.splice(order.indexOf(target) + (from < to ? 1 : 0), 0, source);
    await heading(source).locator('.column-heading-label, :scope').first().dragTo(heading(target));
    await expectLayout(page, order, `after dragging ${source} onto ${target}`);
    await exerciseSeparators(page, order, `dragged ${source} onto ${target}`, false);
  }
  await page.reload();
  await expectLayout(page, order, 'after reload');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(`${key}.column.order`) ?? '[]'), REPOSITORY_KEY))
    .toEqual(expect.arrayContaining(order));
});
