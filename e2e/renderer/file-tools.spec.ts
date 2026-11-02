import { expect, test, type Page } from '@playwright/test';
import { prepareEditor, openEditor } from './editor-protocol-fixture';

// Protocol tests exercise the independent renderer. Native owned-file/process
// fixtures separately qualify actual execution, byte publication and Git staging.
async function prepare(page: Page, editing = false, mode = 'ready') {
  await page.addInitScript(() => {
    localStorage.setItem('git-khronos.tools.v1', JSON.stringify({ version: 2,
      profiles: ['editor', 'diff', 'merge'].map(role => ({ version: 1, id: `owned-${role}`, name: `Owned ${role}`,
        role, executable: '/owned/program path', arguments: ['literal ;$(inert)', `{${role === 'editor' ? 'file' : role === 'diff' ? 'before' : 'merged'}}`] })),
      defaultTerminalId: null, defaultEditorId: 'owned-editor', defaultDiffId: 'owned-diff', defaultMergeId: 'owned-merge' }));
  });
  if (editing) await openEditor(page, mode); else await prepareEditor(page, mode);
  await page.evaluate(() => {
    const state = (window as any).__editor, internal = (window as any).__TAURI_INTERNALS__, invoke = internal.invoke;
    const tool: any = { calls: [], sessions: [], serial: 0 };
    (window as any).__tools = tool;
    tool.token = () => (++tool.serial).toString(16).padStart(32, '0');
    internal.invoke = async (command: string, args: any) => {
      if (!/file_tool/.test(command)) return invoke(command, args);
      tool.calls.push({ command, args });
      if (command === 'list_file_tool_sessions') return structuredClone(tool.sessions);
      if (command === 'discard_file_tool_review') return null;
      if (command === 'prepare_file_tool_launch') {
        const request = args.request, profile = request.profile;
        const review = { profileId: profile.id, profileName: profile.name, role: profile.role,
          executable: profile.executable, repositoryPath: '/owned/repository',
          arguments: ['literal ;$(inert)', '', '/owned/private copy'],
          sides: [{ role: profile.role === 'editor' ? 'file' : 'before', path: request.request.path ?? request.request.request?.path ?? 'notes.md', kind: 'regular', bytes: 7, oid: null }] };
        tool.prepared = { token: tool.token(), review };
        if (tool.holdReview) return new Promise(resolve => { tool.finishReview = () => resolve(tool.prepared); });
        return structuredClone(tool.prepared);
      }
      if (command === 'launch_reviewed_file_tool') {
        const session = { id: tool.token(), revision: tool.token(), requestedAtMillis: '1793578000000', repoId: state.repoId,
          review: tool.prepared.review, phase: 'launched', error: null, canReviewStaging: false,
          process: { state: 'exited', code: 0, signal: null, success: true, cancellationRequested: false } };
        tool.sessions.push(session);
        if (tool.loseLaunch) throw { message: 'Owned launch reply lost' };
        return structuredClone(session);
      }
      const session = tool.sessions[0];
      if (command === 'review_file_tool_result') return { token: tool.token(), sessionId: session.id,
        output: { path: 'notes.md', bytes: '16', sha256: 'a'.repeat(64), binary: false, truncated: false,
          textPreview: '<script>inert</script>' } };
      if (command === 'save_reviewed_file_tool_result') {
        session.canReviewStaging = true;
        return { session: structuredClone(session), write: { status: 'saved', warning: null, canReviewStaging: true } };
      }
      if (command === 'review_file_tool_staging') return { token: tool.token(), sessionId: session.id, path: 'notes.md', bytes: '16', sha256: 'a'.repeat(64) };
      if (command === 'stage_reviewed_file_tool_result') {
        session.canReviewStaging = false;
        return { session: structuredClone(session), stage: { confirmed: true, error: null, warning: null } };
      }
      if (command === 'review_file_tool_cleanup') return { token: tool.token(), sessionId: session.id,
        review: { copyDirectory: '/owned/private copies', outputBytes: 16, sides: session.review.sides } };
      if (command === 'discard_reviewed_file_tool_session') { tool.sessions = []; return true; }
      throw { message: `Unhandled owned tool command ${command}` };
    };
  });
}
const panel = (page: Page) => page.locator('gc-file-tools-dialog');
const calls = (page: Page, command: string) => page.evaluate(command => (window as any).__tools.calls.filter((c: any) => c.command === command), command);
async function review(page: Page) {
  await panel(page).getByRole('button', { name: 'Review external program launch', exact: true }).click();
  await expect(panel(page).getByRole('region', { name: 'Review external program launch' })).toBeVisible();
}
async function start(page: Page) {
  await review(page);
  await panel(page).getByRole('button', { name: 'Start reviewed program', exact: true }).click();
  await expect(panel(page).getByText('Owned command exited', { exact: true }).first()).toBeVisible();
}

test('comparison preserves the selected native context and starts once only after complete argument review', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
  await expect(panel(page).getByRole('combobox', { name: 'Saved program' })).toHaveValue('owned-diff');
  expect(await calls(page, 'prepare_file_tool_launch')).toEqual([]);
  await review(page);
  const prepared = await calls(page, 'prepare_file_tool_launch');
  expect(prepared[0].args.request.request).toEqual(await page.evaluate(() => ({ kind: 'comparison', request: (window as any).__editor.app.fileContentDialog().selection.request })));
  await expect(panel(page).locator('.arguments li')).toHaveText(['"literal ;$(inert)"', '""', '"/owned/private copy"']);
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
  await panel(page).getByRole('button', { name: 'Start reviewed program', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Start reviewed program', exact: true })).toHaveCount(0);
  expect(await calls(page, 'launch_reviewed_file_tool')).toHaveLength(1);
  const args = (await calls(page, 'launch_reviewed_file_tool'))[0].args.request;
  expect(Object.keys(args).sort()).toEqual(['contextId', 'operationId', 'token']);
});

test('dirty draft is retained and snapshotted while a saved-file handoff opens and closes', async ({ page }) => {
  await prepare(page, true);
  await page.getByLabel('Working file text', { exact: true }).fill('retained unsaved draft');
  await page.getByRole('button', { name: 'Review external editor', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved file while retaining draft', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => Object.values((window as any).__editor.copies).some((copy: any) => copy.record.text === 'retained unsaved draft'))).toBe(true);
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('retained unsaved draft');
  expect(await page.evaluate(() => (window as any).__editor.calls.some((c: any) => c.command === 'save_working_file_editor'))).toBe(false);
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
});

test('failed draft snapshot blocks external handoff and preserves editable text', async ({ page }) => {
  await prepare(page, true);
  await page.evaluate(() => { (window as any).__editor.snapshotFailure = true; });
  await page.getByLabel('Working file text', { exact: true }).fill('must remain here');
  await page.getByRole('button', { name: 'Review external editor', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved file while retaining draft', exact: true }).click();
  await expect(page.getByText('The recovery copy could not be confirmed. Your draft is retained here.', { exact: true })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('must remain here');
});

test('save-and-review handoff confirms disk save while leaving index separate', async ({ page }) => {
  await prepare(page, true);
  await page.getByLabel('Working file text', { exact: true }).fill('save before handoff');
  await page.getByRole('button', { name: 'Review external editor', exact: true }).click();
  await page.getByRole('button', { name: 'Save and review', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  expect(await page.evaluate(() => ({ disk: (window as any).__editor.disk, index: (window as any).__editor.index }))).toEqual({ disk: 'save before handoff', index: 'before\n' });
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
});

test('lost launch reply is inspectable without repeating the consumed launch', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Review external editor for working file', exact: true }).click();
  await review(page);
  await page.evaluate(() => { (window as any).__tools.loseLaunch = true; });
  await panel(page).getByRole('button', { name: 'Start reviewed program', exact: true }).click();
  await expect(panel(page).getByText('Owned launch reply lost', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Refresh tool sessions', exact: true }).click();
  await expect(panel(page).locator('.sessions li')).toHaveCount(1);
  expect(await calls(page, 'launch_reviewed_file_tool')).toHaveLength(1);
});

test('closing an in-flight review retires its late token without starting a command', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
  await page.evaluate(() => { (window as any).__tools.holdReview = true; });
  await panel(page).getByRole('button', { name: 'Review external program launch', exact: true }).click();
  await expect.poll(() => calls(page, 'prepare_file_tool_launch')).toHaveLength(1);
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await page.evaluate(() => (window as any).__tools.finishReview());
  await expect.poll(() => calls(page, 'discard_file_tool_review')).toHaveLength(1);
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
});

for (const width of [320, 780]) {
  test(`external launch review preserves literal arguments and focus inside ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 600 }); await prepare(page);
    await page.getByRole('button', { name: 'Compare with external program', exact: true }).click(); await review(page);
    const dialog = panel(page).getByRole('dialog');
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await panel(page).getByRole('button', { name: 'Discard launch review', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(panel(page).getByRole('button', { name: 'Refresh tool sessions', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(panel(page).getByRole('button', { name: 'Close external file tools' })).toBeFocused();
    await page.screenshot({ path: info.outputPath(`file-tools-${width}.png`) });
  });
}

async function openMerge(page: Page, screenshots?: { normal: string; compact: string }) {
  await prepare(page);
  await page.getByRole('button', { name: 'Close file content', exact: true }).click();
  await page.evaluate(() => {
    const state = (window as any).__editor;
    state.git.conflictDetails.set({ path: 'notes.md', current: 'ours', incoming: 'theirs', output: 'draft',
      currentExists: true, incomingExists: true, editable: true, binary: false, submodule: false });
    state.app.conflictOutput.set('retained internal merge draft');
  });
  const external = page.getByRole('button', { name: 'Review external merge program', exact: true });
  await expect(external).toBeVisible();
  if (screenshots) {
    const viewport = page.viewportSize()!;
    await page.screenshot({ path: screenshots.normal });
    await page.setViewportSize({ width: 780, height: 560 });
    const dialog = page.getByRole('dialog', { name: 'Merge conflict editor', exact: true });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshots.compact });
    await page.setViewportSize(viewport);
  }
  await external.click();
}

test('merge output is inert and saving and staging require separate consumed reviews', async ({ page }, info) => {
  await openMerge(page, { normal: info.outputPath('merge-header-normal.png'), compact: info.outputPath('merge-header-780.png') }); await start(page);
  await panel(page).getByRole('button', { name: 'Inspect current merge output', exact: true }).click();
  await expect(panel(page).getByLabel('Merge output text')).toHaveText('<script>inert</script>');
  await expect(panel(page).locator('script')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Save reviewed merge output', exact: true })).toBeDisabled();
  await panel(page).getByRole('checkbox', { name: 'I finished editing and reviewed this output.' }).check();
  await panel(page).getByRole('button', { name: 'Save reviewed merge output', exact: true }).click();
  await expect(panel(page).getByText('Reviewed output saved. The index is unchanged; staging requires a separate review.', { exact: true })).toBeVisible();
  expect(await calls(page, 'stage_reviewed_file_tool_result')).toEqual([]);
  const saved = (await calls(page, 'save_reviewed_file_tool_result'))[0].args.request;
  expect(Object.keys(saved).sort()).toEqual(['contextId', 'finishedEditing', 'operationId', 'token']);
  await panel(page).getByRole('button', { name: 'Review saved result for staging', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Stage reviewed saved result', exact: true }).click();
  await expect(panel(page).getByText('Saved result staged.', { exact: true })).toBeVisible();
  expect(await calls(page, 'save_reviewed_file_tool_result')).toHaveLength(1);
  expect(await calls(page, 'stage_reviewed_file_tool_result')).toHaveLength(1);
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await expect(page.getByRole('textbox', { name: 'Resolved output for notes.md' })).toHaveValue('retained internal merge draft');
});

test('private cleanup requires explicit finished-GUI acknowledgement', async ({ page }) => {
  await openMerge(page); await start(page);
  await panel(page).getByRole('button', { name: 'Review tool-session cleanup', exact: true }).click();
  const cleanup = panel(page).getByRole('button', { name: 'Remove reviewed private copies and retire session', exact: true });
  await expect(cleanup).toBeDisabled();
  expect(await calls(page, 'discard_reviewed_file_tool_session')).toEqual([]);
  await panel(page).getByRole('checkbox', { name: 'The external program and any GUI handoff have finished using these files.' }).check();
  await cleanup.click();
  await expect(panel(page).getByText('Tool session retired. Working files and the Git index were not changed by cleanup.', { exact: true })).toBeVisible();
  expect((await calls(page, 'discard_reviewed_file_tool_session'))[0].args.request.finishedUsingFiles).toBe(true);
  await expect(panel(page).locator('.sessions li')).toHaveText('No tool sessions are recorded in this application process.');
});

test('native window-close review stays visible after a nested external handoff', async ({ page }) => {
  await prepare(page, true);
  await page.getByLabel('Working file text', { exact: true }).fill('window draft');
  await page.getByRole('button', { name: 'Review external editor', exact: true }).click();
  await page.getByRole('button', { name: 'Review saved file while retaining draft', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await page.evaluate(() => (window as any).__editor.requestNativeClose());
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Review unsaved draft' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__editor.windowDestroyCalls)).toBe(0);
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('Working file text', { exact: true })).toHaveValue('window draft');
});
