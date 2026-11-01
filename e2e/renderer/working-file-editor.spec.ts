import { expect, test, type Page } from '@playwright/test';

// Renderer protocol fixtures only. Actual disk/index and encoding outcomes are
// covered by owned Git fixtures in the Rust native/core suites.
async function prepare(page: Page, mode = 'ready') {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(({ mode }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git, repo = git.repository();
    const state: any = { app, git, calls: [], mode, serial: 0, disk: 'before\n', repoId: repo.id };
    state.snapshot = () => ({ editorId: `editor-${state.serial}`, revision: `revision-${state.serial}`,
      path: 'notes.md', text: state.disk, encoding: 'utf8', bom: false, encodedByteLen: String(state.disk.length),
      lineEndings: state.mode === 'mixed' ? 'mixed' : 'lf',
      readOnlyReason: state.mode === 'mixed' ? 'Mixed line endings require an external editor.' : null,
      workingReference: 'refs/heads/main', headOid: repo.headOid });
    (window as any).__editor = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'open_working_file_editor') {
        state.serial++;
        if (state.mode === 'held-open') return new Promise(resolve => { state.finish = () => resolve(state.snapshot()); });
        return Promise.resolve(state.snapshot());
      }
      if (command === 'save_working_file_editor' || command === 'stage_saved_working_file_editor') {
        if (state.mode === 'transport-error') return Promise.reject({ message: 'Owned transport reply lost' });
        const finish = () => {
          if (command === 'save_working_file_editor') state.disk = args.text;
          state.serial++;
          return { editorId: args.editorId, revision: `revision-${state.serial}`,
            file: { ...state.snapshot(), editorId: args.editorId }, disk: command === 'save_working_file_editor' ? 'saved' : 'unchanged',
            stage: args.stage || command === 'stage_saved_working_file_editor' ? state.mode === 'stage-error' ? 'unconfirmed' : 'staged' : 'notRequested',
            stageError: state.mode === 'stage-error' ? { kind: 'ownedStageFailure', message: 'Owned stage refusal', hint: null } : null,
            warning: null };
        };
        if (state.mode === 'held-save') return new Promise(resolve => { state.finish = () => resolve(finish()); });
        return Promise.resolve(finish());
      }
      if (command === 'inspect_file_media') {
        const side = { label: 'Owned text fixture', path: 'notes.md', state: 'text', oid: null,
          size: '7', raster: null, dataUrl: null, lfs: null, message: null };
        return Promise.resolve({ before: side, after: side });
      }
      if (command === 'close_working_file_editor' || command === 'cancel_git_operation') return Promise.resolve(true);
      if (command === 'refresh_repository_status') return Promise.resolve(repo.status);
      if (command === 'refresh_repository') return Promise.resolve(repo);
      return Promise.resolve(null);
    } };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer editor fixture' }));
    app.fileContextMenu.set({ content: { repoId: repo.id, request: {
      context: { kind: 'commit', oid: repo.headOid }, path: 'notes.md', previousPath: null,
    } } });
    app.viewContextFileContent('working');
  }, { mode });
  await expect(page.getByRole('button', { name: 'Edit working copy', exact: true })).toBeVisible();
}
async function open(page: Page, mode = 'ready') {
  await prepare(page, mode);
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  if (mode !== 'held-open') await expect(page.getByRole('textbox', { name: 'Working file text', exact: true })).toHaveValue('before\n');
}

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
