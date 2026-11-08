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
      if (command === 'cancel_git_operation' && tool.cancelMode) {
        tool.calls.push({ command, args });
        if (tool.cancelMode === 'hang') return new Promise(() => {});
        if (tool.cancelMode === 'hold') return new Promise(resolve => { tool.finishCancellation = resolve; });
        if (tool.cancelMode === 'reject') throw { message: 'Cancellation transport failed' };
        return tool.cancelMode === 'accept';
      }
      if (!/file_tool/.test(command)) return invoke(command, args);
      tool.calls.push({ command, args });
      if (command === 'list_file_tool_sessions') return structuredClone(tool.sessions);
      if (command === 'discard_file_tool_review') {
        if (tool.failDiscard) throw { message: 'Review retirement failed' };
        if (tool.holdDiscard) return new Promise(resolve => { tool.finishDiscard = () => resolve(null); });
        return null;
      }
      if (command === 'prepare_file_tool_launch') {
        const request = args.request, profile = request.profile;
        const review = { profileId: profile.id, profileName: profile.name, role: profile.role,
          executable: profile.executable, repositoryPath: '/owned/repository',
          arguments: ['literal ;$(inert)', '', '/owned/private copy'],
          sides: [{ role: profile.role === 'editor' ? 'file' : 'before', path: request.request.path ?? request.request.request?.path ?? 'notes.md', kind: 'regular', bytes: 7, oid: null }] };
        tool.prepared = { token: tool.token(), review };
        if (tool.holdReview) return new Promise((resolve, reject) => {
          tool.finishReview = () => resolve(tool.prepared);
          tool.failReview = () => reject({ kind: 'fileToolSnapshotRefused', message: 'Unexpected private files were retained.' });
        });
        return structuredClone(tool.prepared);
      }
      if (command === 'launch_reviewed_file_tool') {
        const session = { id: tool.token(), revision: tool.token(), requestedAtMillis: '1793578000000', repoId: state.repoId,
          review: tool.prepared.review, phase: 'launched', error: null, canReviewStaging: false,
          process: { state: tool.running ? 'running' : 'exited', code: 0, signal: null, success: true, cancellationRequested: false } };
        tool.sessions.push(session);
        if (tool.holdLaunch) return new Promise((resolve, reject) => {
          tool.finishLaunch = () => resolve(structuredClone(session));
          tool.failLaunch = () => reject({ message: 'Owned launch reply lost' });
        });
        if (tool.loseLaunch) throw { message: 'Owned launch reply lost' };
        return structuredClone(session);
      }
      const session = tool.sessions[0];
      if (command === 'stop_file_tool_command') {
        if (tool.holdStop) return new Promise(resolve => {
          tool.finishStop = () => { session.process.state = 'exited'; resolve(structuredClone(session)); };
        });
        session.process.state = 'exited';
        return structuredClone(session);
      }
      if (command === 'review_file_tool_result') return { token: tool.token(), sessionId: session.id,
        output: { path: 'notes.md', bytes: '16', sha256: 'a'.repeat(64), binary: false, truncated: false,
          textPreview: '<script>inert</script>' } };
      if (command === 'save_reviewed_file_tool_result') {
        session.canReviewStaging = true;
        const result = { session: structuredClone(session), write: { status: tool.unconfirmedSave ? 'unconfirmed' : 'saved', warning: null, canReviewStaging: true } };
        if (tool.holdSave) return new Promise(resolve => { tool.finishSave = () => resolve(result); });
        return result;
      }
      if (command === 'review_file_tool_staging') return { token: tool.token(), sessionId: session.id, path: 'notes.md', bytes: '16', sha256: 'a'.repeat(64) };
      if (command === 'stage_reviewed_file_tool_result') {
        session.canReviewStaging = false;
        return { session: structuredClone(session), stage: { confirmed: !tool.unconfirmedStage, error: null, warning: null } };
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

test('closing external comparison restores focus to its content-dialog opener', async ({ page }) => {
  await prepare(page);
  const opener = page.getByRole('button', { name: 'Compare with external program', exact: true });
  await opener.click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await expect(opener).toBeFocused();
});

for (const mode of ['cancel', 'failure'] as const) {
  test(`external-tool loader ${mode} restores focus to its opener`, async ({ page }) => {
    let release!: () => void;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    await prepare(page);
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch(), text = await response.text();
      const toolsChunk = text.includes('Review external program launch') && text.includes('Close external file tools');
      if (toolsChunk && mode === 'failure') await route.abort();
      else {
        if (toolsChunk) await new Promise<void>(resolve => { release = resolve; });
        await route.fulfill({ response, body: text });
      }
      if (toolsChunk) finish();
    });
    const opener = page.getByRole('button', { name: 'Compare with external program', exact: true });
    await opener.click();
    const loader = page.getByRole('dialog', { name: mode === 'cancel' ? 'Opening file tools' : 'File tools unavailable', exact: true });
    await expect(loader.getByRole('button', { name: mode === 'cancel' ? 'Cancel' : 'Close', exact: true })).toBeFocused();
    if (mode === 'cancel') await expect.poll(() => typeof release).toBe('function');
    await page.keyboard.press('Escape');
    await expect(loader).toHaveCount(0);
    await expect(opener).toBeFocused();
    if (mode === 'cancel') release();
    await finished;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(panel(page)).toHaveCount(0);
    expect(await calls(page, 'prepare_file_tool_launch')).toEqual([]);
  });
}

test('a replaced external-tool loader retains focus instead of the previous opener', async ({ page }) => {
  let release!: () => void;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  await prepare(page);
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch(), text = await response.text();
    const toolsChunk = text.includes('Review external program launch') && text.includes('Close external file tools');
    if (toolsChunk) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ response, body: text });
    if (toolsChunk) finish();
  });
  const opener = page.getByRole('button', { name: 'Compare with external program', exact: true });
  await opener.click();
  const loader = page.getByRole('dialog', { name: 'Opening file tools', exact: true });
  await expect(loader.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect.poll(() => typeof release).toBe('function');
  await page.evaluate(() => {
    const dialog = (window as any).ng.getComponent(document.querySelector('gc-file-content-dialog'));
    const request = dialog.toolRequest();
    dialog.closeToolLoader();
    dialog.toolRequest.set({ ...request, id: 'replacement-tool-request' });
  });
  await expect(loader.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(opener).not.toBeFocused();
  release();
  await finished;
  await expect(panel(page)).toBeVisible();
});

test('closing external editor after a dirty-draft handoff restores focus to the editor opener', async ({ page }) => {
  await prepare(page, true);
  await page.getByLabel('Working file text', { exact: true }).fill('retained unsaved draft');
  const opener = page.getByRole('button', { name: 'Review external editor', exact: true });
  await opener.click();
  await page.getByRole('button', { name: 'Review saved file while retaining draft', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await expect(opener).toBeFocused();
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
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await page.getByRole('button', { name: 'Review external editor for working file', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
  await panel(page).getByRole('checkbox', { name: 'I inspected the earlier tool action.' }).check();
  await panel(page).getByRole('button', { name: 'Continue after inspection', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeEnabled();
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

for (const mode of ['unacknowledged', 'hang', 'reject'] as const) {
  test(`tool cancellation reports ${mode} while the original request remains active`, async ({ page }) => {
    await prepare(page);
    await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
    await page.evaluate(mode => {
      (window as any).__tools.holdReview = true;
      (window as any).__tools.cancelMode = mode;
    }, mode);
    await panel(page).getByRole('button', { name: 'Review external program launch', exact: true }).click();
    const cancel = panel(page).getByRole('button', { name: 'Cancel tool request', exact: true });
    await cancel.focus();
    await cancel.click();
    await expect(panel(page).getByRole('alert')).toContainText('Cancellation was not confirmed');
    await expect(panel(page).getByRole('button', { name: 'Retry cancellation', exact: true })).toBeFocused();
    await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
    expect(await calls(page, 'cancel_git_operation')).toHaveLength(mode === 'unacknowledged' ? 3 : 1);
    await page.evaluate(() => (window as any).__tools.finishReview());
    await expect.poll(() => calls(page, 'discard_file_tool_review')).toHaveLength(1);
    await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeEnabled();
    await expect(panel(page).getByRole('region', { name: 'Review external program launch' })).toHaveCount(0);
    expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
  });
}

test('closing a tool review reports cancellation failure outside the closed panel', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
  await page.evaluate(() => { (window as any).__tools.holdReview = true; (window as any).__tools.cancelMode = 'unacknowledged'; });
  await panel(page).getByRole('button', { name: 'Review external program launch', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  const warning = page.getByRole('region', { name: 'Background operation warnings' });
  await expect(warning).toContainText('Cancellation was not confirmed');
  expect(await calls(page, 'cancel_git_operation')).toHaveLength(3);
  await page.evaluate(() => (window as any).__tools.finishReview());
  await expect.poll(() => calls(page, 'discard_file_tool_review')).toHaveLength(1);
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
});

test('a late review-retirement failure remains visible after the tool panel closes', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
  await page.evaluate(() => { (window as any).__tools.holdReview = true; (window as any).__tools.failDiscard = true; });
  await panel(page).getByRole('button', { name: 'Review external program launch', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await page.evaluate(() => (window as any).__tools.finishReview());
  await expect(page.getByRole('region', { name: 'Background operation warnings' })).toContainText('unused review could not be retired');
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
});

test('a cancelled review reports native cleanup failure after the tool panel closes', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
  await page.evaluate(() => { (window as any).__tools.holdReview = true; });
  await panel(page).getByRole('button', { name: 'Review external program launch', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await page.evaluate(() => (window as any).__tools.failReview());
  await expect(page.getByRole('region', { name: 'Background operation warnings' })).toContainText('Unexpected private files were retained.');
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
});

test('a finished review cannot produce a late cancellation warning while retirement stalls', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
  await page.evaluate(() => {
    (window as any).__tools.holdReview = true;
    (window as any).__tools.holdDiscard = true;
    (window as any).__tools.cancelMode = 'hold';
  });
  await panel(page).getByRole('button', { name: 'Review external program launch', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Cancel tool request', exact: true }).click();
  await page.evaluate(() => (window as any).__tools.finishReview());
  await expect(panel(page).getByText('Retiring unused tool review…', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Requesting cancellation…', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__tools.finishCancellation(false));
  const alert = panel(page).getByRole('alert');
  await expect(alert).toContainText('An unused review could not be retired');
  await expect(alert).not.toContainText('Cancellation was not confirmed');
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeEnabled();
  await page.evaluate(() => (window as any).__tools.finishDiscard());
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
});

test('stalled retirement after closing a tool review is reported outside the panel', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
  await page.evaluate(() => { (window as any).__tools.holdReview = true; (window as any).__tools.holdDiscard = true; });
  await panel(page).getByRole('button', { name: 'Review external program launch', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await page.evaluate(() => (window as any).__tools.finishReview());
  await expect(page.getByRole('region', { name: 'Background operation warnings' })).toContainText('An unused review could not be retired');
  await page.evaluate(() => (window as any).__tools.finishDiscard());
  expect(await calls(page, 'launch_reviewed_file_tool')).toEqual([]);
});

test('a cancelled launch remains guarded across closing until its native outcome arrives', async ({ page }) => {
  await prepare(page);
  const opener = page.getByRole('button', { name: 'Compare with external program', exact: true });
  await opener.click();
  await review(page);
  await page.evaluate(() => { (window as any).__tools.holdLaunch = true; (window as any).__tools.cancelMode = 'accept'; });
  await panel(page).getByRole('button', { name: 'Start reviewed program', exact: true }).click();
  const cancel = panel(page).getByRole('button', { name: 'Cancel tool request', exact: true });
  await cancel.click();
  await expect(panel(page).getByRole('button', { name: 'Cancellation requested', exact: true })).toBeFocused();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await expect(page.getByRole('region', { name: 'Background operation warnings' })).toContainText('was still running when the panel closed');
  await opener.click();
  await expect(panel(page).getByText('Another external tool action is still running. Wait for its outcome before starting another action.', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
  expect(await calls(page, 'launch_reviewed_file_tool')).toHaveLength(1);
  await page.evaluate(() => (window as any).__tools.finishLaunch());
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeEnabled();
  await expect(panel(page).getByText('Owned command exited', { exact: true }).first()).toBeVisible();
  expect(await calls(page, 'launch_reviewed_file_tool')).toHaveLength(1);
});

test('a launch reply lost after closing remains blocked until its outcome is inspected', async ({ page }) => {
  await prepare(page);
  const opener = page.getByRole('button', { name: 'Compare with external program', exact: true });
  await opener.click();
  await review(page);
  await page.evaluate(() => { (window as any).__tools.holdLaunch = true; });
  await panel(page).getByRole('button', { name: 'Start reviewed program', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await opener.click();
  await page.evaluate(() => (window as any).__tools.failLaunch());
  await expect(panel(page).getByText('Inspect the earlier tool action', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
  await expect(panel(page).getByRole('region', { name: 'Background operation warnings' })).toContainText('outcome was not confirmed');
  await panel(page).getByRole('checkbox', { name: 'I inspected the earlier tool action.' }).check();
  await panel(page).getByRole('button', { name: 'Continue after inspection', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeEnabled();
  expect(await calls(page, 'launch_reviewed_file_tool')).toHaveLength(1);
});

test('stopping an owned process does not offer cancellation for an unsupported request', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
  await page.evaluate(() => { (window as any).__tools.running = true; (window as any).__tools.holdStop = true; });
  await review(page);
  await panel(page).getByRole('button', { name: 'Start reviewed program', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Stop owned command', exact: true }).click();
  await expect(panel(page).getByText('Stopping owned command…', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Cancel tool request', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__tools.finishStop());
  await expect(panel(page).getByText('Owned command exited', { exact: true }).first()).toBeVisible();
  expect(await calls(page, 'cancel_git_operation')).toEqual([]);
});

test('closing a pending stop never requests unsupported cancellation or allows a duplicate stop', async ({ page }) => {
  await prepare(page);
  const opener = page.getByRole('button', { name: 'Compare with external program', exact: true });
  await opener.click();
  await page.evaluate(() => { (window as any).__tools.running = true; (window as any).__tools.holdStop = true; (window as any).__tools.cancelMode = 'accept'; });
  await review(page);
  await panel(page).getByRole('button', { name: 'Start reviewed program', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Stop owned command', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await opener.click();
  await expect(panel(page).getByText('Another external tool action is still running. Wait for its outcome before starting another action.', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
  expect(await calls(page, 'cancel_git_operation')).toEqual([]);
  expect(await calls(page, 'stop_file_tool_command')).toHaveLength(1);
  await page.evaluate(() => (window as any).__tools.finishStop());
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeEnabled();
  await expect(panel(page).getByText('Owned command exited', { exact: true }).first()).toBeVisible();
});

for (const moved of [false, true]) {
  test(`finishing a cancelled tool action ${moved ? 'preserves moved focus' : 'restores focus from its cancel control'}`, async ({ page }) => {
    await prepare(page);
    await page.getByRole('button', { name: 'Compare with external program', exact: true }).click();
    await review(page);
    await page.evaluate(() => { (window as any).__tools.holdLaunch = true; (window as any).__tools.cancelMode = 'accept'; });
    await panel(page).getByRole('button', { name: 'Start reviewed program', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Cancel tool request', exact: true }).click();
    const close = panel(page).getByRole('button', { name: 'Close external file tools' });
    if (moved) await close.focus();
    await page.evaluate(() => (window as any).__tools.finishLaunch());
    await expect(panel(page).getByText('Owned command exited', { exact: true }).first()).toBeVisible();
    if (moved) await expect(close).toBeFocused();
    else await expect(panel(page).getByRole('heading', { name: 'External file tools', exact: true })).toBeFocused();
  });
}

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

test('closing external merge tools restores focus to the merge-editor opener', async ({ page }) => {
  await openMerge(page);
  const opener = page.getByRole('button', { name: 'Review external merge program', exact: true });
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await expect(opener).toBeFocused();
});

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

test('a save remains guarded after closing and refreshes the repository when its outcome arrives', async ({ page }) => {
  await openMerge(page);
  await start(page);
  await panel(page).getByRole('button', { name: 'Inspect current merge output', exact: true }).click();
  await panel(page).getByRole('checkbox', { name: 'I finished editing and reviewed this output.' }).check();
  await page.evaluate(() => {
    (window as any).__tools.holdSave = true;
    const state = (window as any).__editor;
    state.refreshed = [];
    state.git.refreshRepositoryInBackground = async (id: string) => { state.refreshed.push(id); return true; };
  });
  await panel(page).getByRole('button', { name: 'Save reviewed merge output', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await page.getByRole('button', { name: 'Review external merge program', exact: true }).click();
  await expect(panel(page).getByText('Another external tool action is still running. Wait for its outcome before starting another action.', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__tools.finishSave());
  await expect.poll(() => page.evaluate(() => (window as any).__editor.refreshed)).toEqual([
    await page.evaluate(() => (window as any).__editor.repoId),
  ]);
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeEnabled();
  expect(await calls(page, 'save_reviewed_file_tool_result')).toHaveLength(1);
});

test('an unconfirmed save requires inspection even after reopening tool sessions', async ({ page }) => {
  await openMerge(page);
  await start(page);
  await panel(page).getByRole('button', { name: 'Inspect current merge output', exact: true }).click();
  await panel(page).getByRole('checkbox', { name: 'I finished editing and reviewed this output.' }).check();
  await page.evaluate(() => { (window as any).__tools.unconfirmedSave = true; });
  await panel(page).getByRole('button', { name: 'Save reviewed merge output', exact: true }).click();
  await expect(panel(page).getByText('Save outcome is unconfirmed. Inspect the working file before another action.', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Review saved result for staging', exact: true })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Close external file tools' }).click();
  await page.getByRole('button', { name: 'Review external merge program', exact: true }).click();
  await expect(panel(page).getByText('Inspect the earlier tool action', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeDisabled();
  await panel(page).getByRole('checkbox', { name: 'I inspected the earlier tool action.' }).check();
  await panel(page).getByRole('button', { name: 'Continue after inspection', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Review external program launch', exact: true })).toBeEnabled();
});

test('unconfirmed staging blocks another tool action until the index is inspected', async ({ page }) => {
  await openMerge(page);
  await start(page);
  await panel(page).getByRole('button', { name: 'Inspect current merge output', exact: true }).click();
  await panel(page).getByRole('checkbox', { name: 'I finished editing and reviewed this output.' }).check();
  await panel(page).getByRole('button', { name: 'Save reviewed merge output', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Review saved result for staging', exact: true }).click();
  await page.evaluate(() => { (window as any).__tools.unconfirmedStage = true; });
  await panel(page).getByRole('button', { name: 'Stage reviewed saved result', exact: true }).click();
  await expect(panel(page).getByText('Staging is unconfirmed. Inspect the index before another action.', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('Inspect the Git index and recorded tool session before another action.', { exact: false })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Inspect current merge output', exact: true })).toBeDisabled();
  expect(await calls(page, 'stage_reviewed_file_tool_result')).toHaveLength(1);
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
