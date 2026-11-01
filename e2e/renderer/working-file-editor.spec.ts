import { expect, test } from '@playwright/test';
import { prepareEditor as prepare, openEditor as open } from './editor-protocol-fixture';

test('opens the current working file only after explicit editor selection from historical content', async ({ page }) => {
  await prepare(page);
  expect(await page.evaluate(() => (window as any).__editor.calls.filter((c: any) => c.command === 'open_working_file_editor'))).toEqual([]);
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('before\n');
  const call = await page.evaluate(() => (window as any).__editor.calls.find((c: any) => c.command === 'open_working_file_editor'));
  expect(call.args.path).toBe('notes.md');
  expect(call.args).not.toHaveProperty('oid');
  expect(call.args.encoding).toBeNull();
});

test('save-only and stage-saved remain separate while an unsaved draft stays visible', async ({ page }) => {
  await open(page);
  const text = page.getByLabel('Working file text', { exact: true });
  await text.fill('saved\n');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect(page.getByText('File saved.', { exact: true })).toBeVisible();
  await text.fill('unsaved draft\n');
  await page.getByRole('button', { name: 'Stage saved file', exact: true }).click();
  await expect(text).toHaveValue('unsaved draft\n');
  await expect(page.getByText('Working copy editor · Unsaved draft', { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__editor.calls.filter((c: any) => /^(save_working|stage_saved)/.test(c.command)));
  expect(calls).toHaveLength(2);
  expect(calls[0].args).toMatchObject({ text: 'saved\n', stage: false, revision: 'revision-1' });
  expect(calls[1].args).not.toHaveProperty('text');
  expect(calls[1].args.revision).toBe('revision-2');
});

test('save-and-stage reports a successful disk save alongside a staging refusal', async ({ page }) => {
  await open(page, 'stage-error');
  await page.getByLabel('Working file text', { exact: true }).fill('retained on disk\n');
  await page.getByRole('button', { name: 'Save and stage', exact: true }).click();
  await expect(page.getByText('File saved. Staging was not confirmed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Owned stage refusal');
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('retained on disk\n');
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
});

test('Escape reviews dirty text and keep-editing preserves it before an explicit discard', async ({ page }) => {
  await open(page);
  const text = page.getByLabel('Working file text', { exact: true });
  await text.fill('private draft'); await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Review unsaved draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(text).toHaveValue('private draft'); await expect(text).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit working copy', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__editor.calls.some((c: any) => c.command === 'save_working_file_editor'))).toBe(false);
});

test('repository switches retain a draft and disable writes to another repository', async ({ page }) => {
  await open(page);
  await page.getByLabel('Working file text', { exact: true }).fill('original repository draft');
  await page.evaluate(() => (window as any).__editor.git.activeRepositoryId.set('another-repository'));
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('original repository draft');
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stage saved file', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__editor.calls.some((c: any) => c.command === 'save_working_file_editor'))).toBe(false);
  await page.evaluate(() => { const s = (window as any).__editor; s.git.activeRepositoryId.set(s.repoId); });
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeEnabled();
});

test('an unmounted held open is cancelled and its late context is closed', async ({ page }) => {
  await open(page, 'held-open');
  await page.getByRole('button', { name: 'Back to preview', exact: true }).click();
  await expect(page.locator('gc-working-file-editor')).toHaveCount(0);
  await page.evaluate(() => (window as any).__editor.finish());
  await expect.poll(() => page.evaluate(() => (window as any).__editor.calls.filter((c: any) => c.command === 'close_working_file_editor').length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__editor.calls.some((c: any) => c.command === 'cancel_git_operation'))).toBe(true);
});

test('a lost write reply preserves the draft and requires disk review before another write', async ({ page }) => {
  await open(page, 'transport-error');
  await page.getByLabel('Working file text', { exact: true }).fill('retain this draft');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Retain your draft');
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('retain this draft');
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload disk', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Review unsaved draft' })).toBeVisible();
});

test('a held save blocks dismissal and editing until its actual result arrives', async ({ page }) => {
  await open(page, 'held-save');
  const text = page.getByLabel('Working file text', { exact: true });
  await text.fill('pending write'); await page.keyboard.press('Control+s');
  await expect(text).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Back to preview', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(text).toBeVisible();
  await page.evaluate(() => (window as any).__editor.finish());
  await expect(page.getByText('File saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to preview', exact: true })).toBeEnabled();
});

test('mixed newline text stays read-only while stage-saved is explicit', async ({ page }) => {
  await open(page, 'mixed');
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stage saved file', exact: true })).toBeEnabled();
});

for (const width of [320, 700]) {
 test(`encoding selection retains dirty text and dialog focus at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 600 });
  await open(page);
  await page.getByLabel('Working file text', { exact: true }).fill('encoding draft');
  await expect(page.getByLabel('Read encoding', { exact: true })).toBeDisabled();
  const last = page.getByRole('button', { name: 'Stage saved file', exact: true });
  await last.focus(); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Back to preview', exact: true })).toBeFocused();
  const bounds = await page.getByLabel('Working file text', { exact: true }).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`working-editor-${width}.png`) });
 });
}

test('Markdown renders the unsaved draft with a real worker without writing or losing text', async ({ page }) => {
  await open(page);
  const draft = '# Draft title\n\n**bold** and *emphasis*\n\n| Name | Value |\n| - | - |\n| Owned | 42 |\n\n```text\n<literal>\n```\n';
  await page.getByLabel('Working file text', { exact: true }).fill(draft);
  await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Markdown draft preview', exact: true });
  await expect(preview.getByRole('heading', { name: 'Draft title', exact: true })).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('bold');
  await expect(preview.getByRole('cell', { name: '42', exact: true })).toBeVisible();
  await expect(preview.locator('pre code')).toHaveText('<literal>');
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue(draft);
  expect(await page.evaluate(() => (window as any).__editor.calls.some((c: any) => c.command === 'save_working_file_editor'))).toBe(false);
});

test('Markdown HTML and destinations stay inactive without loading remote images or running code', async ({ page }) => {
  await open(page);
  const requests: string[] = [];
  await page.route('https://unrequested.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
  const draft = '# Inert draft\n\n<img src="https://unrequested.invalid/raw" onerror="window.__ownedExecuted=true">\n<script>window.__ownedExecuted=true</script>\n\n[unsafe](javascript:alert%281%29) ![remote](https://unrequested.invalid/image)';
  await page.getByLabel('Working file text', { exact: true }).fill(draft);
  await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Markdown draft preview', exact: true });
  await expect(preview.getByRole('heading', { name: 'Inert draft', exact: true })).toBeVisible();
  await expect(preview).toContainText('<img src=');
  await expect(preview).toContainText('javascript:');
  await expect(preview).toContainText('[Image: remote]');
  await expect(preview.locator('img, script, iframe, a[href], object, embed')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => (window as any).__ownedExecuted)).toBeUndefined();
});

test('oversize Markdown preview refuses without truncating or changing the draft', async ({ page }) => {
  await open(page);
  const draft = 'a'.repeat(128 * 1024 + 1);
  await page.getByLabel('Working file text', { exact: true }).fill(draft);
  await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('128 KiB');
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue(draft);
});

test('a timed-out Markdown worker is terminated while the draft remains editable', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const Original = window.Worker;
    const state = (window as any).__editor; state.terminated = 0;
    window.Worker = class extends Original {
      override postMessage(): void { /* Owned fixture holds the worker request. */ }
      override terminate(): void { state.terminated++; super.terminate(); }
    };
  });
  await page.getByLabel('Working file text', { exact: true }).fill('# Retained draft');
  await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('time limit');
  expect(await page.evaluate(() => (window as any).__editor.terminated)).toBe(1);
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('# Retained draft');
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeEnabled();
});

async function requestWindowClose(page: Page) {
  await page.evaluate(() => (window as any).__editor.requestNativeClose());
}
async function destroyedWindows(page: Page) {
  return page.evaluate(() => (window as any).__editor.windowDestroyCalls);
}

test('dirty window-close review preserves the draft and cancels the close intent on keep editing', async ({ page }) => {
  await open(page);
  const text = page.getByRole('textbox', { name: 'Working file text', exact: true });
  await text.fill('retained for window close\n');
  await requestWindowClose(page);
  await expect(page.getByRole('group', { name: 'Review unsaved draft' })).toContainText('closing the window');
  expect(await destroyedWindows(page)).toBe(0);
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(text).toHaveValue('retained for window close\n');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect(page.locator('gc-working-file-editor [role=status]')).toContainText('File saved.');
  expect(await destroyedWindows(page)).toBe(0);
});

test('saving a dirty window-close review saves once without staging before requesting destruction', async ({ page }) => {
  await open(page);
  await page.getByRole('textbox', { name: 'Working file text', exact: true }).fill('save before close\n');
  await requestWindowClose(page);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => destroyedWindows(page)).toBe(1);
  const result = await page.evaluate(() => ({ disk: (window as any).__editor.disk, calls: (window as any).__editor.calls.filter((c: any) => c.command === 'save_working_file_editor') }));
  expect(result.disk).toBe('save before close\n'); expect(result.calls).toHaveLength(1); expect(result.calls[0].args.stage).toBe(false);
});

test('discarding a dirty window-close review requests destruction without saving or staging', async ({ page }) => {
  await open(page);
  await page.getByRole('textbox', { name: 'Working file text', exact: true }).fill('explicit discard\n');
  await requestWindowClose(page);
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect.poll(() => destroyedWindows(page)).toBe(1);
  expect(await page.evaluate(() => (window as any).__editor.calls.filter((c: any) => ['save_working_file_editor', 'stage_saved_working_file_editor'].includes(c.command)))).toEqual([]);
});

test('a lost save reply retains a window-close draft without requesting destruction', async ({ page }) => {
  await open(page, 'transport-error');
  const text = page.getByRole('textbox', { name: 'Working file text', exact: true }); await text.fill('uncertain save\n');
  await requestWindowClose(page); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('gc-working-file-editor [role=alert]')).toContainText('Retain your draft');
  await expect(text).toHaveValue('uncertain save\n'); expect(await destroyedWindows(page)).toBe(0);
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Review unsaved draft' })).toHaveCount(0);
});

test('a window-close request waits for an already running save without replaying it', async ({ page }) => {
  await open(page, 'held-save');
  await page.getByRole('textbox', { name: 'Working file text', exact: true }).fill('save already in progress\n');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__editor.finish)).toBe('function');
  await requestWindowClose(page);
  await expect(page.getByRole('button', { name: 'Discard draft', exact: true })).toBeDisabled();
  expect(await destroyedWindows(page)).toBe(0);
  await page.evaluate(() => (window as any).__editor.finish());
  await expect.poll(() => destroyedWindows(page)).toBe(1);
  expect(await page.evaluate(() => (window as any).__editor.calls.filter((c: any) => c.command === 'save_working_file_editor').length)).toBe(1);
});

test('a refused window destruction retains the draft and requires an explicit retry', async ({ page }) => {
  await open(page);
  const text = page.getByRole('textbox', { name: 'Working file text', exact: true }); await text.fill('keep after close failure\n');
  await page.evaluate(() => { (window as any).__editor.windowDestroyError = true; });
  await requestWindowClose(page); await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.locator('gc-working-file-editor [role=alert]')).toContainText('Your draft is retained');
  expect(await destroyedWindows(page)).toBe(1); await expect(text).toHaveValue('keep after close failure\n');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  expect(await destroyedWindows(page)).toBe(1);
  await page.evaluate(() => { (window as any).__editor.windowDestroyError = false; });
  await requestWindowClose(page); await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect.poll(() => destroyedWindows(page)).toBe(2);
});

test('late window-close listener registration is removed without opening an editor', async ({ page }) => {
  await prepare(page, 'held-close-listen');
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparing editor…', exact: true })).toBeDisabled();
  await expect(page.locator('gc-working-file-editor')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__editor.finishWindowListen)).toBe('function');
  await page.getByRole('button', { name: 'Close file content', exact: true }).click();
  await page.evaluate(() => (window as any).__editor.finishWindowListen());
  await expect.poll(() => page.evaluate(() => (window as any).__editor.windowUnlistens.length)).toBe(1);
  await expect(page.locator('gc-working-file-editor')).toHaveCount(0); expect(await destroyedWindows(page)).toBe(0);
});

test('failed close protection refuses editing and permits explicit installation retry', async ({ page }) => {
  await prepare(page, 'close-listen-error');
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  await expect(page.locator('gc-file-content-dialog [role=alert]')).toContainText('Editing has not opened');
  await expect(page.locator('gc-working-file-editor')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__editor.mode = 'ready'; });
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Working file text', exact: true })).toHaveValue('before\n');
});


test('late close protection does not open an editor for a replaced file request', async ({ page }) => {
  await prepare(page, 'held-close-listen');
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__editor.finishWindowListen)).toBe('function');
  await page.evaluate(() => {
    const state = (window as any).__editor, previous = state.app.fileContentDialog();
    state.app.fileContentDialog.set({ ...previous, selection: { ...previous.selection,
      request: { ...previous.selection.request, path: 'replacement.md' } } });
  });
  await expect(page.locator('#standalone-content-title')).toHaveText('replacement.md');
  await page.evaluate(() => (window as any).__editor.finishWindowListen());
  await expect.poll(() => page.evaluate(() => (window as any).__editor.windowUnlistens.length)).toBe(1);
  await expect(page.locator('gc-working-file-editor')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__editor.calls.filter((c: any) => c.command === 'open_working_file_editor'))).toEqual([]);
});
