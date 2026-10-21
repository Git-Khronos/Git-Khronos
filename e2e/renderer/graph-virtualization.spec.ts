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

test('scrolling evaluates graph paths only for rows entering the window', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await loadLongHistory(page, 20_000);
  const work = await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const list = document.querySelector<HTMLElement>('.commit-list')!;
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitForRows = async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await nextFrame();
        if (app.graphScrollTop() !== list.scrollTop) continue;
        const last = app.virtualGraphWindow().items.at(-1).commit;
        const subject = document.querySelector(`[data-commit-oid="${last.oid}"] .subject`)?.textContent?.trim();
        if (subject === last.subject) return;
      }
      throw new Error('History rows did not catch up with the scroll position');
    };
    list.scrollTop = 4000;
    await waitForRows();
    const presenter = app.graphRowView();
    const original = presenter.graphSegmentPath;
    let evaluations = 0;
    presenter.graphSegmentPath = function (...args: unknown[]) {
      evaluations += 1;
      return original.apply(this, args);
    };
    const samples: number[] = [];
    try {
      for (let step = 0; step < 12; step += 1) {
        evaluations = 0;
        list.scrollTop += 40;
        await waitForRows();
        samples.push(evaluations);
      }
      return { samples, rows: document.querySelectorAll('.commit-row[data-commit-oid]').length };
    } finally {
      presenter.graphSegmentPath = original;
    }
  });
  expect(work.rows).toBeGreaterThan(20);
  // A one-row scroll must not evaluate paths for the entire rendered window.
  expect(Math.min(...work.samples)).toBeGreaterThan(0);
  expect(Math.max(...work.samples)).toBeLessThanOrEqual(6);
  expect(await renderedRowProblems(page)).toEqual([]);
});

test('rapid wheel scrolling keeps the entire viewport covered in both directions', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await loadLongHistory(page, 20_000);
  const list = page.locator('.commit-list');
  await list.evaluate((element) => { element.scrollTop = 20_000; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await list.hover();
  const initialTop = await list.evaluate((element) => element.scrollTop);
  for (const direction of [1, -1]) {
    for (let step = 0; step < 12; step += 1) {
      await page.mouse.wheel(0, direction * 400);
      const covered = await page.evaluate(() => new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => {
          const list = document.querySelector<HTMLElement>('.commit-list')!;
          const viewport = list.getBoundingClientRect();
          const rows = [...list.querySelectorAll<HTMLElement>('.commit-row[data-commit-oid]')]
            .map((row) => row.getBoundingClientRect());
          resolve(
            Math.min(...rows.map((row) => row.top)) <= viewport.top + 1
            && Math.max(...rows.map((row) => row.bottom)) >= viewport.bottom - 1,
          );
        });

      }));
      expect(covered, `direction ${direction}, wheel step ${step}`).toBe(true);
    }
    const currentTop = await list.evaluate((element) => element.scrollTop);
    if (direction === 1) expect(currentTop).toBeGreaterThan(initialTop + 3000);
    else expect(currentTop).toBeLessThan(initialTop + 1000);
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await renderedRowProblems(page)).toEqual([]);
});

test('wheel bursts larger than the overscan never expose an empty viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await loadLongHistory(page, 20_000);
  const list = page.locator('.commit-list');
  await list.evaluate((element) => { element.scrollTop = 100_000; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await list.hover();
  await page.evaluate(() => {
    const state = { gaps: [] as number[], frames: 0, running: true };
    (window as any).__wheelCoverage = state;
    const sample = () => {
      const list = document.querySelector<HTMLElement>('.commit-list')!;
      const viewport = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll<HTMLElement>('.commit-row[data-commit-oid]')]
        .map((row) => row.getBoundingClientRect());
      state.frames += 1;
      if (Math.min(...rows.map((row) => row.top)) > viewport.top + 1
        || Math.max(...rows.map((row) => row.bottom)) < viewport.bottom - 1) {
        state.gaps.push(list.scrollTop);
      }
      if (state.running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (const direction of [1, -1, 1, -1]) {
    for (let step = 0; step < 5; step += 1) {
      await page.mouse.wheel(0, direction * 6000);
    }
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(() => {
    const state = (window as any).__wheelCoverage;
    state.running = false;
    return { frames: state.frames, gaps: state.gaps };
  });
  expect(result.frames).toBeGreaterThan(0);
  expect(result.gaps).toEqual([]);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(100_000);
  expect(await renderedRowProblems(page)).toEqual([]);
});

test('wheel rendering checks only the history viewport, not the working-tree panel', async ({ page }) => {
  await loadLongHistory(page, 20_000);
  const result = await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const viewport = app.graphViewport();
    const originalRender = viewport.render;
    const originalDirectory = app.fileDirectory;
    let panelChecks = 0;
    let renders = 0;
    let rendering = false;
    app.fileDirectory = function (...args: unknown[]) {
      if (rendering) panelChecks += 1;
      return originalDirectory.apply(this, args);
    };
    viewport.render = function () {
      renders += 1;
      rendering = true;
      try { originalRender.call(this); } finally { rendering = false; }
    };
    try {
      rendering = true;
      (window as any).ng.applyChanges(app);
      rendering = false;
      const rootPanelChecks = panelChecks;
      panelChecks = 0;
      const list = document.querySelector<HTMLElement>('.commit-list')!;
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: 4000, cancelable: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { rootPanelChecks, panelChecks, renders, top: list.scrollTop };
    } finally {
      app.fileDirectory = originalDirectory;
      viewport.render = originalRender;
    }
  });
  expect(result.rootPanelChecks).toBeGreaterThan(0);
  expect(result.renders).toBe(1);
  expect(result.panelChecks).toBe(0);
  expect(result.top).toBe(4000);
  expect(await renderedRowProblems(page)).toEqual([]);
});

for (const input of ['wheel', 'scrollbar'] as const) {
  test(`hover ancestry stays stable during ${input} input and resumes on the row under the pointer`, async ({ page }) => {
    await loadLongHistory(page, 20_000);
    const list = page.locator('.commit-list');
    await list.hover();
    const result = await page.evaluate((input) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const list = document.querySelector<HTMLElement>('.commit-list')!;
      const before = app.hoveredCommitOid();
      if (input === 'wheel') {
        list.dispatchEvent(new WheelEvent('wheel', { deltaY: 4000, cancelable: true }));
      } else {
        list.scrollTop = 4000;
        list.dispatchEvent(new Event('scroll'));
      }
      for (let i = 0; i < 100; i += 1) app.previewCommit(i.toString(16).padStart(40, '0'));
      return { before, during: app.hoveredCommitOid() };
    }, input);
    expect(result.during).toBe(result.before);
    await expect.poll(() => page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const row = document.querySelector<HTMLElement>('.commit-row[data-commit-oid]:hover');
      return app.graphHoverResumeTimer === null
        && app.hoveredCommitOid() === (row?.dataset['commitOid'] ?? null);
    })).toBe(true);
  });
}

test('scrolling defers reference-stack pointer previews but preserves keyboard focus', async ({ page }) => {
  await loadLongHistory(page);
  const result = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const list = document.querySelector<HTMLElement>('.commit-list')!;
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 4000, cancelable: true }));
    app.openReferenceStack('pointer-preview', new PointerEvent('pointerenter'));
    const pointer = app.expandedReferenceStackOid();
    app.openReferenceStack('keyboard-preview', new FocusEvent('focusin'));
    const keyboard = app.expandedReferenceStackOid();
    app.expandedReferenceStackOid.set(null);
    return { pointer, keyboard };
  });
  expect(result.pointer).toBeNull();
  expect(result.keyboard).toBe('keyboard-preview');
});

test('scrolling releases a pinned reference stack after its virtual row leaves the viewport', async ({ page }) => {
  await loadLongHistory(page);
  const result = await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const list = document.querySelector<HTMLElement>('.commit-list')!;
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    app.pinnedReferenceStackOid.set('stale-anchor');
    app.expandedReferenceStackOid.set('stale-anchor');
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 4000, cancelable: true }));
    await frame();
    const afterWheel = {
      pinned: app.pinnedReferenceStackOid(),
      expanded: app.expandedReferenceStackOid(),
    };

    app.openReferenceStack('next-anchor', new FocusEvent('focusin'));
    const reopened = app.expandedReferenceStackOid();

    app.pinnedReferenceStackOid.set('second-stale-anchor');
    app.expandedReferenceStackOid.set('second-stale-anchor');
    list.scrollTop += 4000;
    list.dispatchEvent(new Event('scroll'));
    await frame();
    return {
      afterWheel,
      reopened,
      afterNativeScroll: {
        pinned: app.pinnedReferenceStackOid(),
        expanded: app.expandedReferenceStackOid(),
      },
    };
  });

  expect(result.afterWheel).toEqual({ pinned: null, expanded: null });
  expect(result.reopened).toBe('next-anchor');
  expect(result.afterNativeScroll).toEqual({ pinned: null, expanded: null });
});

test('frame-coordinated wheel input preserves distance, delta modes, and zoom gestures', async ({ page }) => {
  await loadLongHistory(page, 20_000);
  const result = await page.evaluate(async () => {
    const list = document.querySelector<HTMLElement>('.commit-list')!;
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    list.scrollTop = 10_000;
    await frame();
    let prevented = 0;
    for (let index = 0; index < 100; index += 1) {
      const wheel = new WheelEvent('wheel', { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_LINE, cancelable: true });
      list.dispatchEvent(wheel);
      if (wheel.defaultPrevented) prevented += 1;
    }
    await frame();
    const afterLines = list.scrollTop;
    const height = list.clientHeight;
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE, cancelable: true }));
    await frame();
    const afterPage = list.scrollTop;
    const zoom = new WheelEvent('wheel', { deltaY: 50, ctrlKey: true, cancelable: true });
    const horizontal = new WheelEvent('wheel', { deltaY: 50, shiftKey: true, cancelable: true });
    const cancelled = new WheelEvent('wheel', { deltaY: 5000, cancelable: true });
    cancelled.preventDefault();
    list.dispatchEvent(zoom);
    list.dispatchEvent(horizontal);
    list.dispatchEvent(cancelled);
    await frame();
    return { prevented, afterLines, afterPage, finalTop: list.scrollTop, height, zoomPrevented: zoom.defaultPrevented, horizontalPrevented: horizontal.defaultPrevented };
  });
  expect(result.prevented).toBe(100);
  expect(result.afterLines).toBe(14_000);
  expect(result.afterPage).toBe(14_000 - result.height);
  expect(result.finalTop).toBe(result.afterPage);
  expect(result.zoomPrevented).toBe(false);
  expect(result.horizontalPrevented).toBe(false);
  expect(await renderedRowProblems(page)).toEqual([]);
});
