import { expect, test, type Page } from '@playwright/test';

async function openSeparatedChanges(page: Page, options: {width?: number; fontSize?: number; wordWrap?: boolean; reducedMotion?: 'reduce' | 'no-preference'} = {}): Promise<void> {
  const {width = 1440, fontSize = 13, wordWrap = false, reducedMotion = 'reduce'} = options;
  await page.setViewportSize({width, height: 900});
  await page.addInitScript(({fontSize, wordWrap}) => {
    localStorage.setItem('git-khronos.diff.font-size', String(fontSize));
    localStorage.setItem('git-khronos.diff.word-wrap', String(wordWrap));
  }, {fontSize, wordWrap});
  await page.emulateMedia({reducedMotion});
  await page.goto('/?compare-commits&diff-viewer=split');
  await expect(page.getByRole('region', {name: 'Before and after file changes'})).toBeVisible();
  await page.evaluate(wordWrap => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const patch = 'diff --git a/large.txt b/large.txt\n--- a/large.txt\n+++ b/large.txt\n'
      + '@@ -1,140 +1,140 @@\n-old opening\n+new opening\n'
      + Array.from({length: 139}, (_, i) => ` context line ${i + 2}${wordWrap ? ' long readable source content'.repeat(8) : ''}\n`).join('')
      + '@@ -200,70 +200,70 @@\n-old later change\n+new later change\n'
      + Array.from({length: 69}, (_, i) => ` context line ${i + 201}${wordWrap ? ' long readable source content'.repeat(8) : ''}\n`).join('');
    app.git.comparisonFileDiff.update((diff: any) => ({...diff, patch}));
  }, wordWrap);
  await expect(page.locator('.diff-primary-view')).toContainText('context line 269');
  await page.getByRole('button', {name: 'Next change', exact: true}).click();
  await expect(page.locator('.diff-hunk-nav')).toContainText('2 / 2');
  await expect(page.locator('.diff-primary-view [data-diff-hunk="1"]')).toBeInViewport();
}

test('changing diff layouts keeps the selected later change visible without moving toolbar focus', async ({page}) => {
  await openSeparatedChanges(page);
  for (const mode of ['hunk', 'inline', 'split']) {
    const button = page.locator(`[data-diff-mode="${mode}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toBeFocused();
    await expect(page.locator('.diff-hunk-nav')).toContainText('2 / 2');
    await expect(page.locator('.diff-primary-view [data-diff-hunk="1"]')).toBeInViewport();
  }
});

test('keyboard diff layout changes preserve the selected change and roving focus', async ({page}) => {
  await openSeparatedChanges(page);
  await page.locator('[data-diff-mode="split"]').focus();
  for (const [key, mode] of [['Home', 'hunk'], ['ArrowRight', 'inline'], ['End', 'split']]) {
    await page.keyboard.press(key);
    await expect(page.locator(`[data-diff-mode="${mode}"]`)).toBeFocused();
    await expect(page.locator(`[data-diff-mode="${mode}"]`)).toHaveAttribute('tabindex', '0');
    await expect(page.locator('.diff-hunk-nav')).toContainText('2 / 2');
    await expect(page.locator('.diff-primary-view [data-diff-hunk="1"]')).toBeInViewport();
  }
});

test('selecting the active layout saves the preference without moving the reading position', async ({page}) => {
  await openSeparatedChanges(page);
  const source = page.locator('.split-diff-body');
  await source.click({position: {x: 150, y: 150}});
  await source.evaluate(element => { element.scrollTop = 300; });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const top = await source.evaluate(element => element.scrollTop);
  await page.evaluate(() => localStorage.removeItem('git-khronos.diff.view-mode'));
  const split = page.locator('[data-diff-mode="split"]');
  await split.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.diff.view-mode'))).toBe('split');
  await expect(split).toBeFocused();
  await expect.poll(() => source.evaluate(element => element.scrollTop)).toBe(top);
  await expect(page.locator('.diff-hunk-nav')).toContainText('2 / 2');
});

for (const options of [
  {width: 1440, fontSize: 13},
  {width: 1440, fontSize: 16},
  {width: 1100, fontSize: 13},
  {width: 1100, fontSize: 16},
  {width: 1440, fontSize: 13, wordWrap: true},
  {width: 1100, fontSize: 16, wordWrap: true},
  {width: 1440, fontSize: 13, reducedMotion: 'no-preference' as const},
]) {
  test(`layout changes preserve manually scrolled source at ${options.width}px, font ${options.fontSize}, wrap ${!!options.wordWrap}, motion ${options.reducedMotion ?? 'reduce'}`, async ({page}) => {
    await openSeparatedChanges(page, options);
    const lines = page.locator('.diff-primary-view code').filter({hasText: /^\s*context line 120(?:\s|$)/});
    const painted = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    // Pointer interaction releases the prior explicit-change anchor before
    // this independent manual reading position is established.
    await page.locator('.split-diff-body').click({position: {x: 150, y: 150}});
    await lines.first().evaluate(element => element.scrollIntoView({block: 'start', behavior: 'auto'}));
    await painted();
    const offset = () => lines.evaluateAll(elements => {
      const visible = elements.flatMap(element => {
        const primary = element.closest('.diff-primary-view')!;
        const scroller = primary.querySelector('.split-diff-body') ?? primary;
        const bounds = scroller.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom
          ? [rect.top - bounds.top] : [];
      });
      return visible.sort((left, right) => Math.abs(left) - Math.abs(right))[0] ?? null;
    });
    await expect.poll(offset).not.toBeNull();
    const before = (await offset())!;
    for (const mode of ['hunk', 'inline', 'split']) {
      await page.locator(`[data-diff-mode="${mode}"]`).click();
      await expect(page.locator(`[data-diff-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
      await painted();
      await expect.poll(async () => {
        const current = await offset();
        return current === null ? Infinity : Math.abs(current - before);
      }).toBeLessThan(8);
      await expect(page.locator('.diff-hunk-nav')).toContainText('2 / 2');
    }
    if (options.fontSize === 13 && !options.wordWrap) {
      await page.screenshot({path: `test-results/navigation-review/diff-layout-anchor-${options.width}-${options.reducedMotion ?? 'reduce'}.png`});
    }
  });
}

test('an explicit change request during layout redraw wins the older viewport restoration', async ({page}) => {
  await openSeparatedChanges(page);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.setDiffViewMode('hunk');
    app.jumpToDiffHunk(0);
  });
  await expect(page.locator('[data-diff-mode="hunk"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.diff-hunk-nav')).toContainText('1 / 2');
  await expect(page.locator('.diff-primary-view [data-diff-hunk="0"]')).toBeInViewport();
});

test('manual wheel scrolling releases wrapped change anchoring', async ({page}) => {
  await openSeparatedChanges(page, {wordWrap: true});
  const source = page.locator('.split-diff-body');
  const before = await source.evaluate(element => element.scrollTop);
  await source.hover();
  await page.mouse.wheel(0, -180);
  await expect.poll(() => source.evaluate(element => element.scrollTop)).toBeLessThan(before - 50);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await source.evaluate(element => element.scrollTop)).toBeLessThan(before - 50);
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).stopDiffViewportTracking)).toBeNull();
});

test('wrapped change anchoring stays idle at the beginning of the file', async ({page}) => {
  await page.addInitScript(() => {
    const Original = window.ResizeObserver;
    (window as any).__diffResizeCallbacks = 0;
    window.ResizeObserver = class extends Original {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          if (entries.some(entry => entry.target.matches('.diff-lines'))) (window as any).__diffResizeCallbacks++;
          callback(entries, observer);
        });
      }
    };
  });
  await openSeparatedChanges(page, {wordWrap: true});
  await page.evaluate(() => {
    (window as any).__diffResizeCallbacks = 0;
    (window as any).ng.getComponent(document.querySelector('gc-root')).jumpToDiffHunk(0);
  });
  await expect(page.locator('.diff-primary-view [data-diff-hunk="0"]')).toBeInViewport();
  await page.evaluate(() => new Promise<void>(resolve => {
    let remaining = 12;
    const frame = () => { if (--remaining) requestAnimationFrame(frame); else resolve(); };
    requestAnimationFrame(frame);
  }));
  expect(await page.evaluate(() => (window as any).__diffResizeCallbacks)).toBeLessThan(6);
  await page.getByRole('button', {name: 'Close diff', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).stopDiffViewportTracking)).toBeNull();
});

test('a layout callback cannot restore the old scroll position after closing and reopening the viewer', async ({page}) => {
  await openSeparatedChanges(page);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.setDiffViewMode('hunk');
    app.closeDiffViewer();
    app.openDiffViewer();
  });
  await expect(page.locator('.focus-diff-view.hunk')).toBeVisible();
  await expect(page.locator('.diff-hunk-nav')).toContainText('1 / 2');
  await expect(page.locator('.diff-primary-view [data-diff-hunk="0"]')).toBeInViewport();
});

test('F6 focuses the scrollable split source and arrows scroll without selecting graph commits', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/?compare-commits&diff-viewer=split');
  await expect(page.getByRole('region', {name: 'Before and after file changes'})).toBeVisible();
  const selected = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const patch = 'diff --git a/large.txt b/large.txt\n--- a/large.txt\n+++ b/large.txt\n@@ -0,0 +1,200 @@\n'
      + Array.from({length: 200}, (_, i) => `+source line ${i + 1}\n`).join('');
    app.git.comparisonFileDiff.update((diff: any) => ({...diff, patch}));
    return app.selectedCommit();
  });
  const source = page.locator('.split-diff-body');
  await page.locator('#repository-reference-panel').focus();
  await page.keyboard.press('F6');
  await expect(source).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => source.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).selectedCommit())).toBe(selected);
});

test('diff change navigation respects reduced-motion preferences', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/?compare-commits&diff-viewer=split');
  await expect(page.getByRole('region', {name: 'Before and after file changes'})).toBeVisible();
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.split-diff [data-diff-hunk="1"]')!;
    const original = target.scrollIntoView;
    (window as any).__diffScrollOptions = [];
    target.scrollIntoView = options => {
      (window as any).__diffScrollOptions.push(options);
      original.call(target, options);
    };
  });
  await page.keyboard.press('F7');
  await expect.poll(() => page.evaluate(() => (window as any).__diffScrollOptions)).toEqual([{behavior: 'auto', block: 'center'}]);
});
