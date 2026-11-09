import { expect, type Page } from '@playwright/test';

// Renderer protocol fixtures only. Actual disk/index and encoding outcomes are
// covered by owned Git fixtures in the Rust native/core suites.
export async function prepareEditor(page: Page, mode = 'ready', openPreview = true) {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(({ mode, openPreview }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git, repo = git.repository();
    const state: any = { app, git, calls: [], mode, serial: 0, disk: 'before\n', index: 'before\n', repoId: repo.id };
    state.snapshot = (path = 'notes.md') => ({ editorId: `editor-${state.serial}`, revision: `revision-${state.serial}`,
      path, text: state.disk, encoding: 'utf8', bom: false, encodedByteLen: String(state.disk.length),
      lineEndings: state.mode === 'mixed' ? 'mixed' : 'lf',
      readOnlyReason: state.mode === 'mixed' ? 'Mixed line endings require an external editor.' : null,
      workingReference: state.workingReference ?? 'refs/heads/main', headOid: state.headOid ?? repo.headOid });
    (window as any).__editor = state;
    state.editors = {}; state.copies = {}; state.nextDraft = 0;
    state.copyKey = (id: string, kind = 'committed') => `${id}:${kind}`;
    state.nextDraftId = () => (++state.nextDraft).toString(16).padStart(32, '0');
    state.summary = (record: any, kind = 'committed') => ({ id: record.id, repositoryPath: record.repositoryPath,
      path: record.path, encoding: record.encoding, textBytes: String(new TextEncoder().encode(record.text).byteLength),
      updatedAtMillis: record.updatedAtMillis, pending: kind === 'pending', sequence: record.sequence, gitContext: record.gitContext ?? null });
    state.seedCopy = (record: any, kind = 'committed', error: any = null) => {
      const key = state.copyKey(record.id, kind), token = `owned-${record.id}-${kind}-${record.sequence}`;
      state.copies[key] = { record, kind, token, error }; return token;
    };
    state.requireEditor = (args: any) => {
      const editor = state.editors[args.editorId];
      if (!editor || !editor.active || editor.revision !== args.revision) throw { message: 'Owned stale editor context' };
      return editor;
    };
    state.openSnapshot = (path = 'notes.md') => {
      const snapshot = state.snapshot(path);
      state.editors[snapshot.editorId] = { active: true, revision: snapshot.revision, draftId: state.nextDraftId(),
        sequence: 0, path, baselineText: state.disk, reference: snapshot.workingReference, headOid: snapshot.headOid };
      return snapshot;
    };
    state.windowCallbacks = {}; state.nextWindowCallback = 100; state.windowDestroyCalls = 0;
    state.windowUnlistens = [];
    state.requestNativeClose = () => {
      const handler = state.windowCallbacks[state.windowCloseHandler];
      if (!handler) throw Error('Owned close listener not installed');
      return handler({ event: 'tauri://close-requested', id: state.windowCloseHandler, payload: null });
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => state.windowUnlistens.push(id) };
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (handler: any) => { const id = ++state.nextWindowCallback; state.windowCallbacks[id] = handler; return id; },
      unregisterCallback: () => undefined,
      invoke: (command: string, args: any) => {
      state.calls.push({ command, args });
      if (command === 'plugin:event|listen') {
        if (args.event === 'tauri://close-requested') {
          state.windowCloseHandler = args.handler;
          if (state.mode === 'close-listen-error') return Promise.reject({ message: 'Owned close protection failure' });
          if (state.mode === 'held-close-listen') return new Promise(resolve => { state.finishWindowListen = () => resolve(args.handler); });
        }
        return Promise.resolve(args.handler);
      }
      if (command === 'plugin:window|destroy') {
        state.windowDestroyCalls++;
        return state.windowDestroyError ? Promise.reject({ message: 'Owned close refusal' }) : Promise.resolve(null);
      }
      if (command === 'open_working_file_editor') {
        if (state.mode === 'missing-file') return Promise.reject({ message: 'Owned working file missing' });
        state.serial++;
        if (state.mode === 'held-open') return new Promise(resolve => { state.finish = () => resolve(state.openSnapshot(args.path)); });
        return Promise.resolve(state.openSnapshot(args.path));
      }
      if (command === 'snapshot_editor_draft') {
        try {
          const editor = state.requireEditor(args);
          if (editor.retired) return Promise.reject({ message: 'Owned recovery context retired' });
          if (state.snapshotFailure) return Promise.reject({ message: 'Owned recovery storage refusal' });
          if (args.sequence <= editor.sequence) return Promise.reject({ message: 'Owned stale recovery sequence' });
          const record = { version: 1, id: editor.draftId, repositoryPath: repo.path, path: editor.path, encoding: 'utf8',
            baselineSha256: 'b'.repeat(64), gitContext: { workingReference: editor.reference, headOid: editor.headOid },
            revision: args.revision, sequence: args.sequence, text: args.text, updatedAtMillis: '1793530000000' };
          editor.sequence = args.sequence; state.seedCopy(record);
          const summary = state.summary(record);
          if (state.mode === 'held-snapshot-reply') return new Promise(resolve => { state.finishSnapshot = () => resolve(summary); });
          return Promise.resolve(summary);
        } catch (error) { return Promise.reject(error); }
      }
      if (command === 'discard_editor_draft') {
        try {
          const editor = state.requireEditor(args);
          editor.retired = true;
          if (state.discardFailure) return Promise.reject({ message: 'Owned recovery discard refusal' });
          delete state.copies[state.copyKey(editor.draftId)];
          editor.draftId = state.nextDraftId(); editor.retired = false; editor.sequence = 0; editor.revision = `revision-${++state.serial}`;
          return Promise.resolve({ editorId: args.editorId, revision: editor.revision });
        } catch (error) { return Promise.reject(error); }
      }
      if (command === 'inspect_editor_drafts') {
        if (state.inventoryFailure) return Promise.reject({ message: 'Owned recovery inventory refusal' });
        const entries = Object.values(state.copies).map((copy: any) => ({ id: copy.record.id, kind: copy.kind,
          reviewToken: copy.unsafe ? null : copy.token, draft: copy.error ? null : state.summary(copy.record, copy.kind), error: copy.error }));
        return Promise.resolve({ entries, issues: state.inventoryIssues ?? [], incomplete: !!state.inventoryIncomplete || entries.some((entry: any) => !!entry.error) });
      }
      if (command === 'load_editor_draft_entry' || command === 'review_editor_draft' || command === 'discard_editor_draft_entry') {
        const request = command === 'review_editor_draft' ? args.request : args;
        const copy = state.copies[state.copyKey(request.id, request.kind)];
        if (!copy || copy.token !== request.reviewToken) return Promise.reject({ message: 'Owned recovery copy changed after review' });
        if (command === 'discard_editor_draft_entry') {
          const active = Object.values(state.editors).some((editor: any) => editor.active && !editor.retired && editor.draftId === request.id);
          if (active) return Promise.reject({ message: 'Owned recovery copy belongs to an open editor' });
          if (state.sourceCleanupFailure) return Promise.reject({ message: 'Owned source cleanup refusal' });
          delete state.copies[state.copyKey(request.id, request.kind)]; return Promise.resolve(null);
        }
        if (copy.error) return Promise.reject(copy.error);
        if (command === 'load_editor_draft_entry') return Promise.resolve(copy.record);
        try {
          const editor = state.requireEditor(request), record = copy.record;
          return Promise.resolve({ editorId: request.editorId, revision: request.revision, draft: record, comparison: {
            repositoryLocationMatches: record.repositoryPath === repo.path, pathMatches: record.path === editor.path, encodingMatches: record.encoding === 'utf8',
            baselineTextMatches: state.baselineMatches !== false,
            gitContext: !record.gitContext ? 'unknown' : record.gitContext.workingReference === editor.reference && record.gitContext.headOid === editor.headOid ? 'same' : 'changed',
          } });
        } catch (error) { return Promise.reject(error); }
      }
      if (command === 'save_working_file_editor' || command === 'stage_saved_working_file_editor') {
        if (state.mode === 'transport-error') return Promise.reject({ message: 'Owned transport reply lost' });
        const finish = () => {
          const editor = state.requireEditor(args);
          if (state.disk !== editor.baselineText || (state.workingReference ?? 'refs/heads/main') !== editor.reference
            || (state.headOid ?? repo.headOid) !== editor.headOid) throw { message: 'Owned working file or Git context changed' };
          if (command === 'save_working_file_editor') {
            state.disk = args.text;
            const copy = state.copies[state.copyKey(editor.draftId)];
            if (copy?.record.text === args.text) delete state.copies[state.copyKey(editor.draftId)];
            editor.draftId = state.nextDraftId(); editor.retired = false; editor.sequence = 0; editor.baselineText = state.disk;
          }
          if ((args.stage || command === 'stage_saved_working_file_editor') && state.mode !== 'stage-error') state.index = state.disk;
          state.serial++; editor.revision = `revision-${state.serial}`;
          return { editorId: args.editorId, revision: `revision-${state.serial}`,
            file: { ...state.snapshot(editor.path), editorId: args.editorId }, disk: command === 'save_working_file_editor' ? 'saved' : 'unchanged',
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
      if (command === 'read_repository_file_text') {
        const text = state.disk;
        if (state.holdTextPreview) return new Promise(resolve => { state.releaseTextPreview = () => resolve(text); });
        return Promise.resolve(text);
      }
      if (command === 'list_file_tool_sessions') return Promise.resolve([]);
      if (command === 'close_working_file_editor') { if (state.editors[args.editorId]) state.editors[args.editorId].active = false; return Promise.resolve(true); }
      if (command === 'cancel_git_operation') return Promise.resolve(true);
      if (command === 'refresh_repository_status') return Promise.resolve(repo.status);
      if (command === 'refresh_repository') return Promise.resolve(repo);
      return Promise.resolve(null);
    } };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer editor fixture' }));
    if (openPreview) { app.fileContextMenu.set({ content: { repoId: repo.id, request: {
      context: { kind: 'commit', oid: repo.headOid }, path: 'notes.md', previousPath: null,
    } } });
    app.viewContextFileContent('working'); }
  }, { mode, openPreview });
  if (openPreview) await expect(page.getByRole('button', { name: 'Edit working copy', exact: true })).toBeVisible();
}
export async function openEditor(page: Page, mode = 'ready') {
  await prepareEditor(page, mode);
  await page.getByRole('button', { name: 'Edit working copy', exact: true }).click();
  if (mode !== 'held-open') await expect(page.getByRole('textbox', { name: 'Working file text', exact: true })).toHaveValue('before\n');
}
