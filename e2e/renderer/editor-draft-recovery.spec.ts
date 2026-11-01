import { expect, test, type Page } from '@playwright/test';
import { prepareEditor, openEditor } from './editor-protocol-fixture';

// Browser interaction/protocol evidence only. Private storage and actual
// process-kill/relaunch acceptance are separate native-package gates.
async function seed(page: Page, options: { context?: 'same' | 'changed' | 'unknown'; text?: string; corruptPending?: boolean } = {}) {
  await page.evaluate(options => {
    const state = (window as any).__editor, repo = state.git.repository();
    const record = { version: 1, id: 'a'.repeat(32), repositoryPath: repo.path, path: 'notes.md', encoding: 'utf8',
      baselineSha256: 'b'.repeat(64), gitContext: options.context === 'unknown' ? null : { workingReference: 'refs/heads/main', headOid: repo.headOid },
      revision: 'c'.repeat(32), sequence: 1, text: options.text ?? 'recovered text\n', updatedAtMillis: '1793530000000' };
    state.seedCopy(record); state.seededRecord = record;
    if (options.context === 'changed') { state.workingReference = 'refs/heads/other'; state.baselineMatches = false; }
    if (options.corruptPending) state.seedCopy({ ...record, sequence: 2 }, 'pending', { kind: 'ownedCorrupt', message: 'Owned truncated pending copy', hint: null });
  }, options);
}
async function panel(page: Page) {
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /Editor draft recovery/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Editor draft recovery', exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
async function review(page: Page, context: 'same' | 'changed' | 'unknown' = 'same') {
  await prepareEditor(page, 'ready', false); await seed(page, { context });
  const dialog = await panel(page);
  await dialog.getByRole('button', { name: /notes.md.*Committed copy/ }).click();
  await expect(dialog.getByLabel('Retained draft text', { exact: true })).toHaveValue('recovered text\n');
  await dialog.getByRole('button', { name: 'Review working file', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('before\n');
  await expect(page.getByRole('region', { name: 'Compare retained editor draft' })).toBeVisible();
}
async function mutations(page: Page) {
  return page.evaluate(() => (window as any).__editor.calls.filter((call: any) =>
    /^(save_working_file_editor|stage_saved_working_file_editor|checkout_branch|fetch_repository|set_repository_identity)$/.test(call.command)));
}

test('previews inert retained text beside a corrupt pending copy without repository mutations', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('recovery.invalid')) requests.push(request.url()); });
  await prepareEditor(page, 'ready', false);
  const text = '<img src="https://recovery.invalid/never-load" onerror="window.__recoveryExecuted=true">\n';
  await seed(page, { text, corruptPending: true });
  const dialog = await panel(page);
  await expect(dialog.getByRole('alert').filter({ hasText: 'Some recovery data could not be fully inspected' })).toBeVisible();
  await dialog.getByRole('button', { name: /notes.md.*Committed copy/ }).click();
  await expect(dialog.getByLabel('Retained draft text', { exact: true })).toHaveValue(text);
  await dialog.getByRole('button', { name: /Unreadable recovery copy.*Pending replacement/ }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Owned truncated pending copy' })).toBeVisible();
  expect(await mutations(page)).toEqual([]); expect(requests).toEqual([]);
  expect(await page.evaluate(() => (window as any).__recoveryExecuted)).toBeUndefined();
});

test('loads text only after review and writes the file only after explicit save', async ({ page }) => {
  await review(page);
  expect(await mutations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Load recovered text into editor', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('recovered text\n');
  expect(await mutations(page)).toEqual([]);
  expect(await page.evaluate(() => [(window as any).__editor.disk, (window as any).__editor.index])).toEqual(['before\n', 'before\n']);
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^File saved\.$/ })).toBeVisible();
  expect(await page.evaluate(() => [(window as any).__editor.disk, (window as any).__editor.index, Object.keys((window as any).__editor.copies).length])).toEqual(['recovered text\n', 'before\n', 0]);
  const writes = await mutations(page); expect(writes).toHaveLength(1); expect(writes[0].args.stage).toBe(false);
  await page.getByRole('button', { name: 'Back to preview', exact: true }).click();
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('recovered text\n');
  await expect(page.getByText(/Recovery review could not complete/)).toHaveCount(0);
});

test('changed baseline and branch require acknowledgement without checking out the original branch', async ({ page }) => {
  await review(page, 'changed');
  const load = page.getByRole('button', { name: 'Load recovered text into editor', exact: true });
  await expect(load).toBeDisabled();
  await expect(page.getByText('refs/heads/other', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I reviewed the changed or unknown file and Git context.', exact: true }).check();
  await expect(load).toBeEnabled(); await load.click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('recovered text\n');
  expect(await mutations(page)).toEqual([]);
});

test('confirmed file save with refused source cleanup preserves the copy and never replays the write', async ({ page }) => {
  await review(page);
  await page.evaluate(() => { (window as any).__editor.sourceCleanupFailure = true; });
  await page.getByRole('button', { name: 'Load recovered text into editor', exact: true }).click();
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'The file save is confirmed; cleanup of the loaded recovery copy was not confirmed' }))
    .toContainText('Owned source cleanup refusal');
  expect(await page.evaluate(() => {
    const state = (window as any).__editor;
    return [state.disk, state.index, Object.values(state.copies).map((copy: any) => copy.record.text)];
  })).toEqual(['recovered text\n', 'before\n', ['recovered text\n']]);
  expect(await mutations(page)).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to preview', exact: true }).click();
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('recovered text\n');
  await expect(page.getByRole('region', { name: 'Compare retained editor draft' })).toBeVisible();
  expect(await mutations(page)).toHaveLength(1);
});

test('a missing working file refuses opening while retained text remains available for review', async ({ page }) => {
  await prepareEditor(page, 'missing-file', false); await seed(page);
  const dialog = await panel(page);
  await dialog.getByRole('button', { name: /notes.md.*Committed copy/ }).click();
  await expect(dialog.getByLabel('Retained draft text', { exact: true })).toHaveValue('recovered text\n');
  await dialog.getByRole('button', { name: 'Review working file', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Owned working file missing' })).toBeVisible();
  expect(await mutations(page)).toEqual([]);
  expect(await page.evaluate(() => Object.values((window as any).__editor.copies).map((copy: any) => copy.record.text)))
    .toEqual(['recovered text\n']);
});

test('legacy unknown Git context is never assumed to match the current repository', async ({ page }) => {
  await review(page, 'unknown');
  const load = page.getByRole('button', { name: 'Load recovered text into editor', exact: true });
  await expect(load).toBeDisabled();
  await expect(page.getByText(/Original Git context: unknown/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'I reviewed the changed or unknown file and Git context.', exact: true }).check();
  await load.click(); expect(await mutations(page)).toEqual([]);
});

test('failed inventory is an actionable error rather than an empty successful list', async ({ page }) => {
  await prepareEditor(page, 'ready', false); await seed(page);
  await page.evaluate(() => { (window as any).__editor.inventoryFailure = true; });
  const dialog = await panel(page);
  await expect(dialog.getByRole('alert')).toHaveText('Owned recovery inventory refusal');
  await expect(dialog.getByText('No retained editor drafts.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__editor.inventoryFailure = false; });
  await dialog.getByRole('button', { name: 'Refresh recovery copies', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /notes.md.*Committed copy/ })).toBeVisible();
});

test('an incomplete empty inventory preserves the partial-inspection warning', async ({ page }) => {
  await prepareEditor(page, 'ready', false);
  await page.evaluate(() => { const s = (window as any).__editor; s.inventoryIncomplete = true; s.inventoryIssues = [{ id: null, message: 'Owned unknown data preserved' }]; });
  const dialog = await panel(page);
  await expect(dialog.getByText('No complete copy is shown in this partial inspection.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('No retained editor drafts.', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Owned unknown data preserved', { exact: true })).toBeVisible();
});

test('explicit discard removes only the selected corrupt pending copy', async ({ page }) => {
  await prepareEditor(page, 'ready', false); await seed(page, { corruptPending: true });
  const dialog = await panel(page);
  await dialog.getByRole('button', { name: /Unreadable recovery copy.*Pending replacement/ }).click();
  await dialog.getByRole('button', { name: 'Discard selected copy…', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard this recovery copy', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Unreadable recovery copy.*Pending replacement/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /notes.md.*Committed copy/ })).toBeVisible();
  expect(await page.evaluate(() => Object.values((window as any).__editor.copies).map((copy: any) => copy.kind))).toEqual(['committed']);
  expect(await mutations(page)).toEqual([]);
});

test('changed review tokens preserve the replacement and dispatch no second delete', async ({ page }) => {
  await prepareEditor(page, 'ready', false); await seed(page);
  const dialog = await panel(page);
  await dialog.getByRole('button', { name: /notes.md.*Committed copy/ }).click();
  await expect(dialog.getByLabel('Retained draft text', { exact: true })).toHaveValue('recovered text\n');
  await page.evaluate(() => { const s = (window as any).__editor, copy = s.copies[s.copyKey(s.seededRecord.id)]; copy.token = 'newer-token'; copy.record = { ...copy.record, text: 'newer retained data' }; });
  await dialog.getByRole('button', { name: 'Discard selected copy…', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard this recovery copy', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Owned recovery copy changed after review');
  expect(await page.evaluate(() => { const s = (window as any).__editor; return [s.copies[s.copyKey(s.seededRecord.id)].record.text, s.calls.filter((c: any) => c.command === 'discard_editor_draft_entry').length]; })).toEqual(['newer retained data', 1]);
});

test('a storage refusal retains new typing and explicit retry confirms its latest text', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => { (window as any).__editor.snapshotFailure = true; });
  const text = page.getByLabel('Working file text', { exact: true });
  await text.fill('retained before failure');
  await expect(page.getByRole('alert').filter({ hasText: 'Recovery copy not confirmed' })).toBeVisible();
  await text.fill('latest retained text');
  await expect(text).toHaveValue('latest retained text');
  await page.evaluate(() => { (window as any).__editor.snapshotFailure = false; });
  await page.getByRole('button', { name: 'Retry recovery snapshot', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local recovery copy saved.' })).toBeVisible();
  expect(await page.evaluate(() => Object.values((window as any).__editor.copies).map((copy: any) => copy.record.text))).toEqual(['latest retained text']);
  expect(await mutations(page)).toEqual([]);
});

test('unmount during a held snapshot reply prevents dispatching a late file save', async ({ page }) => {
  await openEditor(page, 'held-snapshot-reply');
  await page.getByLabel('Working file text', { exact: true }).fill('retained before unmount');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__editor.finishSnapshot)).toBe('function');
  await page.evaluate(() => { const s = (window as any).__editor; s.app.fileContentDialog.set(null); });
  await expect(page.locator('gc-working-file-editor')).toHaveCount(0);
  await page.evaluate(() => (window as any).__editor.finishSnapshot());
  expect(await mutations(page)).toEqual([]);
  expect(await page.evaluate(() => Object.values((window as any).__editor.copies).map((copy: any) => copy.record.text))).toEqual(['retained before unmount']);
});

test('a refused editor discard keeps editable text and the recovery copy available', async ({ page }) => {
  await openEditor(page);
  await page.getByLabel('Working file text', { exact: true }).fill('keep this draft');
  await expect(page.getByRole('status').filter({ hasText: 'Local recovery copy saved.' })).toBeVisible();
  await page.evaluate(() => { (window as any).__editor.discardFailure = true; });
  await page.getByRole('button', { name: 'Back to preview', exact: true }).click();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'cleanup was not confirmed' })).toBeVisible();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('keep this draft');
  expect(await mutations(page)).toEqual([]);
});

test('welcome recovery remains readable without an open repository at compact width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await prepareEditor(page, 'ready', false); await seed(page);
  await page.evaluate(() => { const s = (window as any).__editor; s.git.repositories.set([]); s.git.activeRepositoryId.set(null); });
  const opener = page.getByRole('button', { name: 'Editor draft recovery', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Editor draft recovery', exact: true });
  await dialog.getByRole('button', { name: /notes.md.*Committed copy/ }).click();
  await expect(dialog.getByLabel('Retained draft text', { exact: true })).toHaveValue('recovered text\n');
  await expect(dialog.getByRole('button', { name: 'Review working file', exact: true })).toBeDisabled();
  expect(await dialog.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
  const navigation = await dialog.getByRole('navigation', { name: 'Retained editor copies' }).boundingBox();
  const selectedCopy = await dialog.getByRole('button', { name: /notes.md.*Committed copy/ }).boundingBox();
  expect(navigation!.height).toBeGreaterThanOrEqual(80);
  expect(selectedCopy!.y + selectedCopy!.height).toBeLessThanOrEqual(navigation!.y + navigation!.height + 1);
  await page.screenshot({ path: test.info().outputPath('recovery-compact.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
});
