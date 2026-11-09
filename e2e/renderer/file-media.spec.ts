import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function raster(file = 'tiles.png', mime = 'image/png', width = 3, height = 2) {
  const bytes = readFileSync(resolve('crates/git-core/tests/fixtures/media', file));
  return { label: 'Selected commit', path: 'extensionless', state: 'raster', oid: 'a'.repeat(40), size: String(bytes.length),
    raster: { mime, width, height }, dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, lfs: null, message: null };
}

async function prepare(page: Page, side = raster(), mode = 'ready') {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async ({ side, mode }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    await git.inspectCommit(git.repository().headOid);
    const details = git.commitDetails();
    const state: any = { app, git, calls: [], mode, cancelReplies: [], response: { before: { ...side, label: 'First parent' }, after: side } };
    (window as any).__media = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'inspect_file_media') {
        if (state.mode === 'held') return new Promise(resolve => { state.finish = () => resolve(state.response); });
        if (state.mode === 'error') return Promise.reject({ message: 'Owned media read refused' });
        return Promise.resolve(state.response);
      }
      if (command === 'cancel_git_operation') {
        const reply = state.cancelReplies.shift() ?? true;
        if (reply === 'error') return Promise.reject({ message: 'Cancellation IPC refused' });
        if (reply === 'held') return new Promise((resolve, reject) => {
          state.finishCancel = resolve;
          state.failCancel = reject;
        });
        return Promise.resolve(reply);
      }
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      if (command === 'refresh_repository') return Promise.resolve(git.repository());
      return Promise.resolve(null);
    } };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    app.changesOpen.set(false);
    git.commitComparison.set(null);
    git.commitDetails.set({ ...details, files: [{ path: 'extensionless', previousPath: 'previous.png', status: 'R100', additions: null, deletions: null }] });
    git.commitFileDiff.set({ oid: details.oid, path: 'extensionless', patch: 'Binary files differ', truncated: false });
    app.openDiffViewer();
  }, { side, mode });
  await page.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Content', exact: true }).click();
}

async function mediaOperationId(page: Page): Promise<string> {
  const readOperationId = () => page.evaluate(() => (window as any).__media.calls
    .find((call: any) => call.command === 'inspect_file_media')?.args.operationId ?? null);
  await expect.poll(readOperationId).not.toBeNull();
  const operationId = await readOperationId();
  if (typeof operationId !== 'string') throw new Error('The media read did not return an operation ID.');
  return operationId;
}

for (const [file, mime, width, height] of [
  ['tiles.png', 'image/png', 3, 2], ['tiles.jpg', 'image/jpeg', 3, 2],
  ['tiles.gif', 'image/gif', 3, 2], ['tiles.webp', 'image/webp', 3, 2],
  ['tiles.bmp', 'image/bmp', 3, 2], ['tiles.ico', 'image/x-icon', 16, 16],
] as const) {
  test(`decodes owned ${mime} bytes without relying on the selected filename`, async ({ page }) => {
    await prepare(page, raster(file, mime, width, height));
    const panel = page.getByRole('region', { name: 'After image preview', exact: true });
    await expect(panel.getByRole('img')).toBeVisible();
    await expect(page.getByText(`Displayed orientation: ${width} × ${height} px`, { exact: true })).toHaveCount(2);
    expect(await panel.getByRole('img').evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width, height });
    const calls = await page.evaluate(() => (window as any).__media.calls.filter((call: any) => call.command === 'inspect_file_media'));
    expect(calls).toHaveLength(1);
    expect(calls[0].args.request).toMatchObject({ context: { kind: 'commit' }, path: 'extensionless', previousPath: 'previous.png' });
  });
}

test('retains JPEG orientation and offers keyboard-operated fit, zoom and side controls', async ({ page }) => {
  await prepare(page, raster('rotated.jpg', 'image/jpeg'));
  await expect(page.getByText('Displayed orientation: 2 × 3 px', { exact: true })).toHaveCount(2);
  const actual = page.getByRole('button', { name: 'Actual size', exact: true });
  await actual.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Image zoom', { exact: true })).toHaveText('100%');
  await page.getByRole('button', { name: 'Zoom images in', exact: true }).click();
  await expect(page.getByLabel('Image zoom', { exact: true })).toHaveText('200%');
  await page.getByRole('button', { name: 'After only', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Before image preview', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'After image preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fit images', exact: true }).click();
  await expect(page.getByLabel('Image zoom', { exact: true })).toHaveText('Fit');
});

test('reports actual browser decoding errors for a raster with a truncated body', async ({ page }) => {
  const side = raster();
  const bytes = readFileSync(resolve('crates/git-core/tests/fixtures/media/tiles.png'));
  side.dataUrl = `data:image/png;base64,${bytes.subarray(0, 24).toString('base64')}`;
  await prepare(page, side);
  await expect(page.getByText('Image decoding failed. Reload content to try again.', { exact: true })).toHaveCount(2);
  await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
});

test('keeps readable and absent sides distinct from an unavailable object', async ({ page }) => {
  const side: any = { ...raster(), state: 'unavailable', raster: null, dataUrl: null, size: null, oid: null, message: 'Selected object is unavailable' };
  await prepare(page, side);
  await expect(page.getByText('Selected object is unavailable', { exact: true })).toHaveCount(2);
  await page.evaluate(() => {
    const state = (window as any).__media;
    state.response = { before: { ...state.response.before, state: 'absent', message: null }, after: { ...state.response.after, state: 'text', size: '0', message: null } };
  });
  await page.getByRole('button', { name: 'Reload content', exact: true }).click();
  await expect(page.getByText('File is absent on this side.', { exact: true })).toBeVisible();
  await expect(page.getByText('Text content is available in the Diff view. SVG remains text.', { exact: true })).toBeVisible();
  await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
});

test('cancels a held native read and ignores its late response before an explicit retry', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await page.getByRole('button', { name: 'Cancel content load', exact: true }).click();
  await expect(page.getByText('Waiting for the content read to stop.', { exact: false })).toBeVisible();
  await page.evaluate(() => { const state = (window as any).__media; state.finish(); state.mode = 'ready'; });
  await expect(page.getByText('Content load dismissed.', { exact: false })).toBeVisible();
  await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__media.calls.some((call: any) => call.command === 'cancel_git_operation'))).toBe(true);
  await page.getByRole('button', { name: 'Retry content load', exact: true }).click();
  await expect(page.getByText('Displayed orientation: 3 × 2 px', { exact: true })).toHaveCount(2);
});

test('retries cancellation when the native read has not registered yet', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await page.evaluate(() => { (window as any).__media.cancelReplies = [false, true]; });
  const operationId = await mediaOperationId(page);
  await page.getByRole('button', { name: 'Cancel content load', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__media.calls
    .filter((call: any) => call.command === 'cancel_git_operation')
    .map((call: any) => call.args.operationId))).toEqual([operationId, operationId]);
  await expect(page.getByText('Waiting for the content read to stop.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry cancellation', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__media.finish());
  await expect(page.getByText('Content load dismissed.', { exact: false })).toBeVisible();
  await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
});

for (const failure of ['unacknowledged', 'error'] as const) {
  test(`reports ${failure} cancellation and permits a retry`, async ({ page }) => {
    await prepare(page, raster(), 'held');
    await page.evaluate((failure) => {
      (window as any).__media.cancelReplies = failure === 'error' ? ['error'] : [false, false, false];
    }, failure);
    await page.getByRole('button', { name: 'Cancel content load', exact: true }).click();
    const alert = page.locator('gc-file-media').getByRole('alert');
    await expect(alert).toContainText(failure === 'error' ? 'Cancellation IPC refused' : 'Cancellation was not acknowledged');
    await expect(alert).toContainText('may still be running');
    await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
    await page.evaluate(() => { (window as any).__media.cancelReplies = [true]; });
    await page.getByRole('button', { name: 'Retry cancellation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry cancellation', exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as any).__media.finish());
    await expect(page.getByText('Content load dismissed.', { exact: false })).toBeVisible();
    await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
  });
}

test('does not report a cancellation failure after the held read already finished', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await page.evaluate(() => { (window as any).__media.cancelReplies = ['held']; });
  await page.getByRole('button', { name: 'Cancel content load', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__media.finishCancel)).toBe('function');
  await page.evaluate(() => (window as any).__media.finish());
  await expect(page.getByText('Content load dismissed.', { exact: false })).toBeVisible();
  await page.evaluate(() => (window as any).__media.finishCancel(false));
  await expect(page.locator('gc-file-media').getByRole('alert')).toHaveText(/Content load dismissed/);
  await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
});

test('allows another cancellation request when the first reply never arrives', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await page.evaluate(() => { (window as any).__media.cancelReplies = ['held']; });
  await page.getByRole('button', { name: 'Cancel content load', exact: true }).click();
  await expect(page.locator('gc-file-media').getByRole('alert')).toContainText('Cancellation was not acknowledged');
  await page.evaluate(() => { (window as any).__media.cancelReplies = [true]; });
  await page.getByRole('button', { name: 'Retry cancellation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancellation requested', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = (window as any).__media;
    state.finishCancel(true);
    state.finish();
  });
  await expect(page.getByText('Content load dismissed.', { exact: false })).toBeVisible();
  await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
});

test('ignores a late cancellation rejection after a newer request succeeds', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await prepare(page, raster(), 'held');
  await page.evaluate(() => { (window as any).__media.cancelReplies = ['held']; });
  await page.getByRole('button', { name: 'Cancel content load', exact: true }).click();
  await expect(page.locator('gc-file-media').getByRole('alert')).toContainText('Cancellation was not acknowledged');
  await page.evaluate(() => { (window as any).__media.cancelReplies = [true]; });
  await page.getByRole('button', { name: 'Retry cancellation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancellation requested', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    (window as any).__media.failCancel(new Error('Late cancellation failure'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(page.getByRole('button', { name: 'Cancellation requested', exact: true })).toBeVisible();
  await expect(page.locator('gc-file-media').getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).__media.finish());
  await expect(page.getByText('Content load dismissed.', { exact: false })).toBeVisible();
});

test('returns keyboard focus to retry after a dismissed content read finishes', async ({ page }) => {
  await prepare(page, raster(), 'held');
  const cancel = page.getByRole('button', { name: 'Cancel content load', exact: true });
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Waiting for the content read to stop.', { exact: false })).toBeVisible();
  await page.evaluate(() => (window as any).__media.finish());
  await expect(page.getByRole('button', { name: 'Retry content load', exact: true })).toBeFocused();
});

test('does not steal focus if the user leaves the cancel control while the read finishes', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await page.getByRole('button', { name: 'Cancel content load', exact: true }).focus();
  await page.keyboard.press('Enter');
  const diff = page.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Diff', exact: true });
  await diff.focus();
  await page.evaluate(() => (window as any).__media.finish());
  await expect(page.getByRole('button', { name: 'Retry content load', exact: true })).toBeVisible();
  await expect(diff).toBeFocused();
});

test('destroys a content view on navigation and never applies a late old selection', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await expect(page.getByRole('button', { name: 'Cancel content load', exact: true })).toBeVisible();
  const operationId = await mediaOperationId(page);
  await page.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(page.locator('gc-file-media')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__media.calls
    .filter((call: any) => call.command === 'cancel_git_operation')
    .map((call: any) => call.args.operationId))).toEqual([operationId]);
  await page.evaluate(async () => { (window as any).__media.finish(); await Promise.resolve(); });
  await expect(page.locator('gc-file-media')).toHaveCount(0);
});

test('shares an in-flight cancellation when navigation destroys the content view', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await page.evaluate(() => { (window as any).__media.cancelReplies = ['held', true]; });
  const operationId = await mediaOperationId(page);
  await page.getByRole('button', { name: 'Cancel content load', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__media.finishCancel)).toBe('function');
  await page.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(page.locator('gc-file-media')).toHaveCount(0);
  await page.evaluate(() => (window as any).__media.finishCancel(false));
  await expect.poll(() => page.evaluate(() => (window as any).__media.calls
    .filter((call: any) => call.command === 'cancel_git_operation')
    .map((call: any) => call.args.operationId))).toEqual([operationId, operationId]);
  expect(await page.evaluate(() => (window as any).__media.git.error())).toBeNull();
  await page.evaluate(() => (window as any).__media.finish());
});

test('retries cancellation after navigation and reports an unacknowledged read', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await page.evaluate(() => {
    (window as any).__media.cancelReplies = [false, false, false];
    (window as any).__media.git.error.set('A separate Git error.');
  });
  const operationId = await mediaOperationId(page);
  await page.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(page.locator('gc-file-media')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__media.calls
    .filter((call: any) => call.command === 'cancel_git_operation')
    .map((call: any) => call.args.operationId))).toEqual([operationId, operationId, operationId]);
  const warning = page.getByRole('region', { name: 'Background operation warnings' });
  await expect(warning.getByRole('alert')).toContainText('previous content read may still be running');
  expect(await page.evaluate(() => (window as any).__media.git.error())).toBe('A separate Git error.');
  await warning.getByRole('button', { name: 'Dismiss background operation warning' }).click();
  await expect(warning).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__media.git.error())).toBe('A separate Git error.');
  await page.evaluate(() => (window as any).__media.finish());
  await expect(page.locator('gc-file-media')).toHaveCount(0);
});

for (const width of [320, 360, 700, 780, 1051, 1440]) {
  test(`keeps content controls and side metadata usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page);
    await expect(page.getByText('Displayed orientation: 3 × 2 px', { exact: true })).toHaveCount(2);
    const host = page.locator('gc-file-media');
    const controls = page.getByRole('group', { name: 'File view', exact: true }).getByRole('button');
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    const toolbar = await page.locator('.diff-workspace-toolbar').boundingBox();
    expect(toolbar).not.toBeNull();
    const back = await page.locator('.diff-back').boundingBox();
    const identity = await page.locator('.diff-file-identity').boundingBox();
    expect(back).not.toBeNull(); expect(identity).not.toBeNull();
    expect(back!.x + back!.width).toBeLessThanOrEqual(identity!.x + 1);
    const toolbarBoxes = await page.locator('.diff-workspace-toolbar button:visible').evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') ?? element.textContent, x, y, width, height };
    }));
    for (let index = 0; index < toolbarBoxes.length; index++) {
      const current = toolbarBoxes[index];
      expect(current.x, current.label ?? '').toBeGreaterThanOrEqual(toolbar!.x - 1);
      expect(current.x + current.width, current.label ?? '').toBeLessThanOrEqual(toolbar!.x + toolbar!.width + 1);
      for (const other of toolbarBoxes.slice(index + 1)) {
        const overlapX = Math.min(current.x + current.width, other.x + other.width) - Math.max(current.x, other.x);
        const overlapY = Math.min(current.y + current.height, other.y + other.height) - Math.max(current.y, other.y);
        expect(overlapX > 1 && overlapY > 1, `${current.label} overlaps ${other.label}`).toBe(false);
      }
    }
    expect(await host.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const name of ['Both sides', 'Before only', 'After only', 'Fit images', 'Actual size']) {
      await expect(host.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath(`media-${width}.png`), fullPage: true });
  });
}

for (const url of ['https://example.test/forbidden.png', 'data:text/html;base64,PHNjcmlwdD50aHJvdyAxPC9zY3JpcHQ+', 'data:image/svg+xml;base64,PHN2Zy8+']) {
  test(`refuses a non-raster response URI ${url.split(',')[0]}`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => { if (request.url().includes('example.test')) requests.push(request.url()); });
    await prepare(page, { ...raster(), dataUrl: url });
    const host = page.locator('gc-file-media');
    await expect(host.getByText('Image response is invalid. Reload content to try again.', { exact: true })).toHaveCount(2);
    await expect(host.locator('img, iframe, object, embed')).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}
