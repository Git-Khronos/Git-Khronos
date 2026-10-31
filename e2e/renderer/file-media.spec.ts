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
    const state: any = { app, git, calls: [], mode, response: { before: { ...side, label: 'First parent' }, after: side } };
    (window as any).__media = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'inspect_file_media') {
        if (state.mode === 'held') return new Promise(resolve => { state.finish = () => resolve(state.response); });
        if (state.mode === 'error') return Promise.reject({ message: 'Owned media read refused' });
        return Promise.resolve(state.response);
      }
      if (command === 'cancel_git_operation') return Promise.resolve(true);
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
  await expect(page.getByText('Content load cancelled.', { exact: false })).toBeVisible();
  await page.evaluate(() => { const state = (window as any).__media; state.finish(); state.mode = 'ready'; });
  await expect(page.locator('gc-file-media').getByRole('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__media.calls.some((call: any) => call.command === 'cancel_git_operation'))).toBe(true);
  await page.getByRole('button', { name: 'Retry content load', exact: true }).click();
  await expect(page.getByText('Displayed orientation: 3 × 2 px', { exact: true })).toHaveCount(2);
});

test('destroys a content view on navigation and never applies a late old selection', async ({ page }) => {
  await prepare(page, raster(), 'held');
  await page.getByRole('group', { name: 'File view', exact: true }).getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(page.getByRole('region', { name: 'After image preview', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__media.finish());
  await expect(page.locator('gc-file-media')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__media.calls.filter((call: any) => call.command === 'cancel_git_operation').length)).toBe(1);
});

for (const width of [320, 360, 700, 1440]) {
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
    const toolbarBoxes = await page.locator('.diff-workspace-toolbar button:visible').evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') ?? element.textContent, x, y, width, height };
    }));
    for (let index = 0; index < toolbarBoxes.length; index++) {
      const current = toolbarBoxes[index];
      expect(current.x, current.label ?? '').toBeGreaterThanOrEqual(0);
      expect(current.x + current.width, current.label ?? '').toBeLessThanOrEqual(width + 1);
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
