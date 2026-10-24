import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, fail = false) {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(fail => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const state = { app, fail, hold: false, total: 205, longText: null as string | null, calls: [] as any[], pending: [] as any[] };
    const result = (first: number) => ({ lines: Array.from({length: Math.max(0, Math.min(100, state.total - first + 1))}, (_, index) => ({
      lineNumber: first + index, oid: 'a'.repeat(40), authorName: 'Fixture', authorEmail: 'fixture@example.test',
      authoredAt: 1767225600, summary: 'Blame fixture', text: state.longText ?? `source line ${first + index}`, path: 'old.ts',
    })), nextLine: first + 100 <= state.total ? first + 100 : null });
    (window as any).__blamePages = { state, result };
    app.git.systemInfo.set({appVersion: 'blame fixture', gitVersion: '2.53.0', gitSupported: true, minimumGitVersion: '2.39.0'});
    (window as any).__TAURI_INTERNALS__ = { invoke(command: string, args: any) {
      if (command === 'inspect_file_blame_page') {
        state.calls.push(args);
        if (state.hold) return new Promise((resolve, reject) => state.pending.push({resolve, reject, args}));
        if (state.fail) { state.fail = false; return Promise.reject({message: 'Owned blame read failed'}); }
        return Promise.resolve(result(args.firstLine));
      }
      if (command === 'refresh_repository') return Promise.resolve(app.git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(app.git.repository().status);
      return Promise.resolve(null);
    }};
    const oid = app.git.repository().headOid;
    app.git.commitFileDiff.set({oid, path: 'source.ts', patch: '+source\n', truncated: false});
    app.changesOpen.set(false);
    app.openDiffViewer();
    app.diffInsightMode.set('blame');
    void app.git.inspectFileBlame('source.ts', oid);
  }, fail);
  await expect(page.getByRole('region', {name: 'File blame', exact: true})).toBeVisible();
}

test('blame pages keep DOM bounded and disclose the actual range and end', async ({page}) => {
  await prepare(page);
  const pane = page.getByRole('region', {name: 'File blame', exact: true});
  await expect(pane.locator('.blame-line')).toHaveCount(100);
  await expect(pane).toContainText('Lines 1–100 · more available');
  await pane.getByRole('button', {name: 'Next lines', exact: true}).click();
  await expect(pane).toContainText('Lines 101–200 · more available');
  await pane.getByRole('button', {name: 'Next lines', exact: true}).click();
  await expect(pane.locator('.blame-line')).toHaveCount(5);
  await expect(pane).toContainText('Lines 201–205 · end');
  await expect(pane.getByRole('button', {name: 'Next lines', exact: true})).toBeDisabled();
  await pane.getByRole('button', {name: 'Previous lines', exact: true}).click();
  await expect(pane).toContainText('Lines 101–200');
});

test('initial blame failure is not an empty result and offers explicit retry', async ({page}) => {
  await prepare(page, true);
  const pane = page.getByRole('region', {name: 'File blame', exact: true});
  await expect(pane.getByRole('alert')).toContainText('Owned blame read failed');
  await expect(pane.locator('.file-insight-empty')).toHaveCount(0);
  await pane.getByRole('button', {name: 'Retry blame page'}).click();
  await expect(pane.getByRole('alert')).toHaveCount(0);
  await expect(pane.locator('.blame-line')).toHaveCount(100);
});

test('failed next page retains the visible page and retries the failed range', async ({page}) => {
  await prepare(page);
  const pane = page.getByRole('region', {name: 'File blame', exact: true});
  await expect(pane.locator('.blame-line')).toHaveCount(100);
  await page.evaluate(() => { (window as any).__blamePages.state.fail = true; });
  await pane.getByRole('button', {name: 'Next lines'}).click();
  await expect(pane.getByRole('alert')).toContainText('Owned blame read failed');
  await expect(pane.locator('.blame-line').first()).toContainText('source line 1');
  await pane.getByRole('button', {name: 'Retry blame page'}).click();
  await expect(pane).toContainText('Lines 101–200');
  expect(await page.evaluate(() => (window as any).__blamePages.state.calls.map((call: any) => call.firstLine))).toEqual([1, 101, 101]);
});

test('jump near the end of a 100000-line file renders one page and preserves focus', async ({page}) => {
  await prepare(page);
  await page.setViewportSize({width: 1024, height: 768});
  const pane = page.getByRole('region', {name: 'File blame', exact: true});
  await expect(pane.locator('.blame-line')).toHaveCount(100);
  await page.evaluate(() => { (window as any).__blamePages.state.total = 100000; });
  await pane.getByLabel('Go to line').fill('99901');
  const go = pane.getByRole('button', {name: 'Go', exact: true});
  await go.click();
  await expect(pane).toContainText('Lines 99901–100000 · end');
  await expect(pane.locator('.blame-line')).toHaveCount(100);
  await expect(go).toBeFocused();
  expect(await pane.locator('.blame-line > span:first-child').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
  await page.screenshot({path: 'test-results/blame-review/blame-page-compact.png'});
});

test('late blame rejection cannot replace a newer file result', async ({page}) => {
  await prepare(page);
  await expect(page.locator('.blame-line')).toHaveCount(100);
  await page.evaluate(async () => {
    const {state} = (window as any).__blamePages;
    state.hold = true;
    const obsolete = state.app.git.loadFileBlamePage(101);
    await Promise.resolve();
    state.hold = false;
    await state.app.git.inspectFileBlame('new.ts', 'b'.repeat(40));
    state.pending[0].reject({message: 'Obsolete blame failure'});
    await obsolete;
  });
  await expect(page.getByRole('region', {name: 'File blame', exact: true}).getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.blame-line')).toHaveCount(100);
});

test('old rejection cannot clear a newer pending page or its busy state', async ({page}) => {
  await prepare(page);
  await expect(page.locator('.blame-line')).toHaveCount(100);
  const pending = await page.evaluate(async () => {
    const {state, result} = (window as any).__blamePages;
    state.hold = true;
    const old = state.app.git.loadFileBlamePage(101);
    const current = state.app.git.inspectFileBlame('new.ts', 'b'.repeat(40));
    state.pending[0].reject({message: 'Old rejection'});
    await old;
    const snapshot = {busy: state.app.git.fileInsightBusy(), error: state.app.git.fileBlameError()};
    state.pending[1].resolve(result(1));
    await current;
    return snapshot;
  });
  expect(pending).toEqual({busy: true, error: null});
  await expect(page.locator('.blame-line')).toHaveCount(100);
});

test('a successful empty page is distinct from a failed read', async ({page}) => {
  await prepare(page);
  await page.evaluate(async () => {
    const {state} = (window as any).__blamePages;
    state.total = 0;
    await state.app.git.inspectFileBlame('empty.ts', 'b'.repeat(40));
  });
  const pane = page.getByRole('region', {name: 'File blame', exact: true});
  await expect(pane.getByRole('alert')).toHaveCount(0);
  await expect(pane.locator('.file-insight-empty')).toContainText('This file has no lines at this revision.');
  await expect(pane.getByRole('button', {name: 'Next lines'})).toBeDisabled();
});

test('long source lines remain reachable with horizontal keyboard scrolling', async ({page}) => {
  await prepare(page);
  await page.evaluate(async () => {
    const {state} = (window as any).__blamePages;
    state.total = 1;
    state.longText = 'x'.repeat(5000);
    await state.app.git.inspectFileBlame('long.ts', 'b'.repeat(40));
  });
  const source = page.locator('.blame-source');
  await expect(source).toHaveText('x'.repeat(5000));
  expect(await source.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const scroll = page.getByRole('region', {name: 'Blame source lines', exact: true});
  await scroll.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});

test('line numbers and dates retain readable contrast in both themes', async ({page}) => {
  await prepare(page);
  await expect(page.locator('.blame-line')).toHaveCount(100);
  for (const theme of ['chronos', 'midnight']) {
    await page.evaluate(theme => { document.documentElement.dataset['theme'] = theme; }, theme);
    const ratios = await page.locator('.blame-line').first().evaluate(row => {
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const background = luminance(getComputedStyle(row.closest('.file-insight-panel')!).backgroundColor);
      return [...row.querySelectorAll('span:first-child, time')].map(element => {
        const foreground = luminance(getComputedStyle(element).color);
        return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
      });
    });
    expect(ratios.length).toBeGreaterThan(0);
    for (const ratio of ratios) expect(ratio, `metadata contrast in ${theme}`).toBeGreaterThanOrEqual(4.5);
  }
});

test('switching Diff and Blame preserves the loaded range, draft line and viewport', async ({page}) => {
  await prepare(page);
  await page.setViewportSize({width: 1024, height: 768});
  const pane = page.getByRole('region', {name: 'File blame', exact: true});
  await pane.getByRole('button', {name: 'Next lines'}).click();
  await expect(pane).toContainText('Lines 101–200');
  await pane.getByLabel('Go to line').fill('150');
  const viewport = pane.getByRole('region', {name: 'Blame source lines', exact: true});
  await viewport.evaluate(element => { element.scrollTop = 240; element.scrollLeft = 40; });
  const before = await viewport.evaluate(element => ({top: element.scrollTop, left: element.scrollLeft}));
  const toggle = page.locator('.diff-insight-toggle');
  await toggle.getByRole('button', {name: 'Diff', exact: true}).click();
  await toggle.getByRole('button', {name: 'Blame', exact: true}).click();
  await expect(pane).toContainText('Lines 101–200');
  await expect(pane.getByLabel('Go to line')).toHaveValue('150');
  await expect.poll(() => viewport.evaluate(element => ({top: element.scrollTop, left: element.scrollLeft}))).toEqual(before);
  expect(await page.evaluate(() => (window as any).__blamePages.state.calls.length)).toBe(2);
});

test('returning to failed blame keeps the error until explicit retry', async ({page}) => {
  await prepare(page, true);
  const toggle = page.locator('.diff-insight-toggle');
  await expect(page.getByRole('alert')).toContainText('Owned blame read failed');
  await toggle.getByRole('button', {name: 'Diff', exact: true}).click();
  await toggle.getByRole('button', {name: 'Blame', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Owned blame read failed');
  expect(await page.evaluate(() => (window as any).__blamePages.state.calls.length)).toBe(1);
});

test('returning to pending blame does not start a duplicate read', async ({page}) => {
  await prepare(page);
  await page.evaluate(() => { (window as any).__blamePages.state.hold = true; });
  const pane = page.getByRole('region', {name: 'File blame', exact: true});
  await pane.getByRole('button', {name: 'Next lines'}).click();
  const toggle = page.locator('.diff-insight-toggle');
  await toggle.getByRole('button', {name: 'Diff', exact: true}).click();
  await toggle.getByRole('button', {name: 'Blame', exact: true}).click();
  expect(await page.evaluate(() => (window as any).__blamePages.state.calls.length)).toBe(2);
  await page.evaluate(() => {
    const {state, result} = (window as any).__blamePages;
    state.pending[0].resolve(result(101));
  });
  await expect(pane).toContainText('Lines 101–200');
});

test('blame resume is scoped to repository revision and path', async ({page}) => {
  await prepare(page);
  const calls = await page.evaluate(async () => {
    const {state} = (window as any).__blamePages;
    const git = state.app.git;
    const oid = git.repository().headOid;
    await git.resumeFileBlame('source.ts', oid);
    await git.resumeFileBlame('other.ts', oid);
    await git.resumeFileBlame('other.ts', 'b'.repeat(40));
    const repo = git.repository();
    git.repositories.update((repos: any[]) => [...repos, {...repo, id: 'other-blame', path: '/fixture/other-blame'}]);
    git.activateRepository('other-blame');
    await git.resumeFileBlame('other.ts', 'b'.repeat(40));
    return state.calls.map((call: any) => [call.repoId, call.path, call.revision]);
  });
  expect(calls).toHaveLength(4);
  expect(calls[1][1]).toBe('other.ts');
  expect(calls[2][2]).toBe('b'.repeat(40));
  expect(calls[3][0]).toBe('other-blame');
});

test('blame reads the displayed diff revision instead of surrounding commit metadata', async ({page}) => {
  await prepare(page);
  await page.evaluate(() => {
    const {app} = (window as any).__blamePages.state;
    app.showFileDiff();
    app.git.commitDetails.set({oid: 'c'.repeat(40), message: 'Stale details', signature: {status: 'unsigned'}, files: [], filesTruncated: false});
    app.git.commitFileDiff.set({oid: 'd'.repeat(40), path: 'source.ts', patch: '+displayed', truncated: false});
  });
  await page.locator('.diff-insight-toggle').getByRole('button', {name: 'Blame', exact: true}).click();
  expect(await page.evaluate(() => (window as any).__blamePages.state.calls.at(-1).revision)).toBe('d'.repeat(40));
});

test('blame arrow scrolling and graph keys cannot navigate away from the displayed file', async ({page}) => {
  await prepare(page);
  await page.evaluate(() => {
    const {app} = (window as any).__blamePages.state;
    app.selectedCommit.set(app.git.repository().headOid);
  });
  const source = page.getByRole('region', {name: 'Blame source lines', exact: true});
  const before = await page.evaluate(() => (window as any).__blamePages.state.app.selectedCommit());
  await source.focus();
  await source.press('ArrowDown');
  await expect.poll(() => source.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  for (const key of ['j', 'k', 'h', 'l']) {
    await source.press(key);
    expect(await page.evaluate(() => (window as any).__blamePages.state.app.selectedCommit()), `${key} must not select a graph commit from Blame`).toBe(before);
  }
  await source.press('Control+End');
  await expect.poll(() => source.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
  await source.press('Control+Home');
  await expect.poll(() => source.evaluate(element => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => (window as any).__blamePages.state.app.selectedCommit())).toBe(before);
});

test('F6 includes the visible blame view in both directions', async ({page}) => {
  await prepare(page);
  await page.setViewportSize({width: 1440, height: 900});
  const source = page.getByRole('region', {name: 'Blame source lines', exact: true});
  await page.locator('#repository-reference-panel').focus();
  await page.keyboard.press('F6');
  await expect(source).toBeFocused();
  await page.keyboard.press('F6');
  await expect(page.locator('#repository-commit-panel')).toBeFocused();
  await page.keyboard.press('Shift+F6');
  await expect(source).toBeFocused();
  await page.getByLabel('Go to line').focus();
  await page.keyboard.press('F6');
  await expect(page.locator('#repository-commit-panel')).toBeFocused();
});

test('F7 reveals and focuses the diff instead of navigating hidden changes behind Blame', async ({page}) => {
  await prepare(page);
  await page.evaluate(() => {
    const {app} = (window as any).__blamePages.state;
    app.git.commitFileDiff.update((diff: any) => ({...diff, patch: 'diff --git a/source.ts b/source.ts\n--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n-old\n+new\n@@ -100 +100 @@\n-before\n+after\n'}));
    app.activeDiffHunk.set(0);
  });
  await page.getByRole('region', {name: 'Blame source lines', exact: true}).press('F7');
  const diff = page.getByRole('region', {name: 'File changes', exact: true});
  await expect(diff).toBeVisible();
  await expect(diff).toBeFocused();
  expect(await page.evaluate(() => (window as any).__blamePages.state.app.activeDiffHunk())).toBe(1);
});

for (const close of [false, true]) {
  test(`deferred diff reveal cannot steal focus after ${close ? 'closing the viewer' : 'moving to another control'}`, async ({page}) => {
    await prepare(page);
    await page.getByRole('region', {name: 'Blame source lines', exact: true}).focus();
    await page.evaluate(async close => {
      const {app} = (window as any).__blamePages.state;
      app.diffViewerOpener = document.querySelector('.toolbar');
      app.git.commitFileDiff.update((diff: any) => ({...diff, patch: 'diff --git a/source.ts b/source.ts\n--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n-old\n+new\n'}));
      app.navigateDiffHunk(1);
      if (close) app.closeDiffViewer();
      document.querySelector<HTMLInputElement>('input[placeholder="Filter references"]')!.focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, close);
    await expect(page.getByPlaceholder('Filter references')).toBeFocused();
    if (close) await expect(page.getByLabel('Diff viewer', {exact: true})).toHaveCount(0);
  });
}
