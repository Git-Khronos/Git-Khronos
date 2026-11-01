import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorDraftSnapshots } from '../apps/desktop/src/app/editor-draft-snapshots.ts';
import { discardReviewedEditorDraft } from '../apps/desktop/src/app/editor-draft-recovery.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const context = { editorId: 'owned-editor', revision: 'revision-one' };
const summary = (id, args = { sequence: 1, text: 'text' }) => ({ id, sequence: args.sequence, textBytes: String(new TextEncoder().encode(args.text).byteLength), updatedAtMillis: '1' });
async function started() { await new Promise(resolve => setImmediate(resolve)); }
function fixture(overrides = {}) {
  const calls = [], states = [];
  const transport = {
    async snapshot_editor_draft(args) { calls.push(['snapshot', args]); return summary('owned-draft', args); },
    async discard_editor_draft(args) { calls.push(['discard', args]); return { editorId: args.editorId, revision: 'revision-two' }; },
    ...overrides,
  };
  const controller = new EditorDraftSnapshots(transport, state => states.push(state), 60_000);
  controller.bind(context);
  return { controller, calls, states };
}

test('coalesces rapid edits and acknowledges only the submitted latest text', async () => {
  const { controller, calls, states } = fixture();
  try {
    controller.schedule('first'); controller.schedule('latest');
    assert.equal(await controller.flush(), true);
    assert.deepEqual(calls, [['snapshot', { ...context, sequence: 1, text: 'latest' }]]);
    assert.equal(states.at(-1).kind, 'saved');
    controller.schedule('latest'); await controller.flush();
    assert.equal(calls.length, 1);
  } finally { controller.dispose(); }
});

test('automatically persists an edited buffer after the debounce without a manual flush', { timeout: 2000 }, async () => {
  const completed = deferred(), calls = [];
  const controller = new EditorDraftSnapshots({
    async snapshot_editor_draft(args) { calls.push(args); return summary('automatic', args); },
    async discard_editor_draft() { throw new Error('automatic snapshots must not discard'); },
  }, state => { if (state.kind === 'saved') completed.resolve(); }, 1);
  controller.bind(context);
  try {
    controller.schedule('automatic text');
    await completed.promise;
    assert.deepEqual(calls, [{ ...context, sequence: 1, text: 'automatic text' }]);
  } finally { controller.dispose(); }
});

test('serializes overlapping flushes and does not label an older buffer saved', async () => {
  const first = deferred(), second = deferred(), calls = [], states = [];
  const controller = new EditorDraftSnapshots({
    snapshot_editor_draft(args) { calls.push(args); return calls.length === 1 ? first.promise : second.promise; },
    discard_editor_draft: async () => ({ ...context, revision: 'revision-two' }),
  }, state => states.push(state), 60_000);
  controller.bind(context);
  try {
    const one = controller.flush('one'); await started();
    const two = controller.flush('two');
    assert.equal(calls.length, 1);
    first.resolve(summary('one', calls[0])); await started();
    assert.equal(await one, false);
    assert.deepEqual(calls.map(call => [call.sequence, call.text]), [[1, 'one'], [2, 'two']]);
    assert.equal(states.some(state => state.kind === 'saved' && state.summary.id === 'one'), false);
    second.resolve(summary('two', calls[1]));
    assert.equal(await two, true);
    assert.equal(states.at(-1).summary.id, 'two');
  } finally { controller.dispose(); }
});

test('new editor binding ignores an old in-flight response and resets its sequence', async () => {
  const pending = deferred(), calls = [];
  const { controller, states } = fixture({ snapshot_editor_draft(args) {
    calls.push(args); return calls.length === 1 ? pending.promise : Promise.resolve(summary('new', args));
  } });
  try {
    const old = controller.flush('old'); await started();
    controller.bind({ editorId: 'new-editor', revision: 'new-revision' });
    const fresh = controller.flush('new'); pending.resolve(summary('old'));
    assert.equal(await old, false); assert.equal(await fresh, true);
    assert.equal(states.some(state => state.kind === 'saved' && state.summary.id === 'old'), false);
    assert.deepEqual(calls[1], { editorId: 'new-editor', revision: 'new-revision', sequence: 1, text: 'new' });
  } finally { controller.dispose(); }
});

test('snapshot refusal remains visible and does not throw away the editable text', async () => {
  const error = new Error('Owned private-store refusal');
  const { controller, states } = fixture({ snapshot_editor_draft: async () => { throw error; } });
  try {
    assert.equal(await controller.flush('retained text'), false);
    assert.equal(states.at(-1).kind, 'failed'); assert.equal(states.at(-1).error, error);
    assert.equal(controller.desired, 'retained text');
  } finally { controller.dispose(); }
});

test('storage refusal pauses background retries while retaining new edits for explicit retry', { timeout: 2000 }, async () => {
  const failed = deferred(), calls = [];
  const controller = new EditorDraftSnapshots({
    async snapshot_editor_draft(args) {
      calls.push(args); if (calls.length === 1) throw new Error('Owned storage refusal');
      return summary('retried', args);
    },
    async discard_editor_draft() { throw new Error('retry must not discard'); },
  }, state => { if (state.kind === 'failed') failed.resolve(); }, 1);
  controller.bind(context);
  try {
    controller.schedule('first'); await failed.promise;
    controller.schedule('latest retained text');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls.length, 1);
    assert.equal(await controller.flush(), true);
    assert.equal(calls[1].text, 'latest retained text');
  } finally { controller.dispose(); }
});

test('discard waits for a sent snapshot then retires queued text and binds the new revision', async () => {
  const pending = deferred(), calls = [];
  const { controller, states } = fixture({
    snapshot_editor_draft(args) { calls.push(['snapshot', args]); return calls.length === 1 ? pending.promise : Promise.resolve(summary('new', args)); },
    async discard_editor_draft(args) { calls.push(['discard', args]); return { editorId: args.editorId, revision: 'revision-two' }; },
  });
  try {
    const saved = controller.flush('sent'); await started();
    controller.schedule('not-sent');
    const discarded = controller.discard(); await started();
    controller.schedule('late while discarding');
    assert.equal(await controller.flush('late while discarding'), false);
    assert.equal(calls.length, 1);
    pending.resolve(summary('old'));
    assert.equal(await saved, false);
    assert.equal((await discarded).revision, 'revision-two');
    assert.equal(states.some(state => state.kind === 'saved' && state.summary.id === 'old'), false);
    assert.equal(await controller.flush('new text'), true);
    assert.deepEqual(calls.map(call => call[0]), ['snapshot', 'discard', 'snapshot']);
    assert.deepEqual(calls[2][1], { ...context, revision: 'revision-two', sequence: 1, text: 'new text' });
  } finally { controller.dispose(); }
});

test('failed discard does not rotate the editor revision or pretend cleanup succeeded', async () => {
  const error = new Error('Owned cleanup refusal');
  let snapshots = 0;
  const { controller, states } = fixture({
    snapshot_editor_draft: async args => { if (++snapshots > 1) throw error; return summary('retained', args); },
    discard_editor_draft: async () => { throw error; },
  });
  try {
    await controller.flush('retained');
    await assert.rejects(controller.discard(), error);
    assert.deepEqual(controller.context, context);
    assert.equal(await controller.flush('retained'), false);
    assert.equal(snapshots, 2);
    assert.equal(states.at(-1).kind, 'failed');
  } finally { controller.dispose(); }
});

test('a queued discard is not sent after its editor is replaced or disposed', async () => {
  for (const dispose of [false, true]) {
    const pending = deferred(), calls = [];
    const { controller } = fixture({
      snapshot_editor_draft: () => pending.promise,
      discard_editor_draft: async args => { calls.push(args); return { ...context, revision: 'discarded' }; },
    });
    try {
      const saving = controller.flush('sent'); await started();
      const discarded = assert.rejects(controller.discard(), /obsolete recovery discard was not sent/);
      if (dispose) controller.dispose(); else controller.bind({ editorId: 'new-editor', revision: 'new-revision' });
      pending.resolve(summary('old'));
      assert.equal(await saving, false); await discarded;
      assert.deepEqual(calls, []);
    } finally { controller.dispose(); }
  }
});

test('stage-only revision changes retain sequence ordering while confirmed saves start a new epoch', async () => {
  const { controller, calls } = fixture();
  try {
    await controller.flush('draft');
    controller.bind({ ...context, revision: 'after-stage' }, false);
    await controller.flush('draft');
    assert.equal(calls[1][1].sequence, 2);
    controller.bind({ ...context, revision: 'after-save' });
    await controller.flush('another draft');
    assert.equal(calls[2][1].sequence, 1);
  } finally { controller.dispose(); }
});

test('dispose drops pending timers and ignores an in-flight reply', async () => {
  const pending = deferred();
  const { controller, states } = fixture({ snapshot_editor_draft: () => pending.promise });
  const saving = controller.flush('sent'); await started();
  const count = states.length;
  controller.schedule('not-sent'); controller.dispose();
  const disposedCount = states.length;
  pending.resolve(summary('old'));
  assert.equal(await saving, false); assert.equal(await controller.flush('later'), false);
  assert.equal(states.length, disposedCount); assert.ok(disposedCount >= count);
});

test('a discard response for another editor cannot retarget the active draft', async () => {
  const { controller } = fixture({ discard_editor_draft: async () => ({ editorId: 'foreign', revision: 'foreign-revision' }) });
  try {
    await assert.rejects(controller.discard(), /could not be matched/);
    assert.deepEqual(controller.context, context);
  } finally { controller.dispose(); }
});

const reference = { id: 'reviewed-copy', kind: 'pending', reviewToken: 'exact-reviewed-token' };
test('reviewed-source cleanup dispatches only one exact-token delete', async () => {
  const calls = [];
  await discardReviewedEditorDraft({
    async discard_editor_draft_entry(args) { calls.push(args); return null; },
    async inspect_editor_drafts() { throw new Error('a confirmed delete needs no reconciliation'); },
  }, reference);
  assert.deepEqual(calls, [reference]);
});

test('a lost cleanup reply reconciles complete absence without replaying deletion or removing the other copy', async () => {
  const calls = [], error = new Error('Owned lost reply');
  await discardReviewedEditorDraft({
    async discard_editor_draft_entry(args) { calls.push(['delete', args]); throw error; },
    async inspect_editor_drafts() { calls.push(['inspect']); return { entries: [{ id: reference.id, kind: 'committed' }], issues: [], incomplete: false }; },
  }, reference);
  assert.deepEqual(calls, [['delete', reference], ['inspect']]);
});

test('an incomplete empty inspection cannot turn an uncertain cleanup into success', async () => {
  const error = new Error('Owned cleanup refusal');
  await assert.rejects(discardReviewedEditorDraft({
    async discard_editor_draft_entry() { throw error; },
    async inspect_editor_drafts() { return { entries: [], issues: [{ message: 'Partial inspection' }], incomplete: true }; },
  }, reference), error);
});

test('changed copies and unreadable inventories preserve the original cleanup error without another delete', async () => {
  for (const unreadable of [false, true]) {
    const error = new Error('Owned stale token'), calls = [];
    await assert.rejects(discardReviewedEditorDraft({
      async discard_editor_draft_entry(args) { calls.push(args); throw error; },
      async inspect_editor_drafts() {
        if (unreadable) throw new Error('Owned unreadable directory');
        return { entries: [{ ...reference, reviewToken: 'newer-token' }], issues: [], incomplete: false };
      },
    }, reference), error);
    assert.deepEqual(calls, [reference]);
  }
});


test('binding a full file snapshot sends only the declared recovery capability and draft fields', async () => {
  const { controller, calls } = fixture();
  try {
    controller.bind({ ...context, path: 'must-not-be-supplied.txt', text: 'old baseline', baseline: 'not IPC authority' });
    assert.equal(await controller.flush('current text'), true);
    assert.deepEqual(Object.keys(calls[0][1]).sort(), ['editorId', 'revision', 'sequence', 'text']);
    const discarded = await controller.discard();
    assert.equal(discarded.editorId, context.editorId);
    assert.deepEqual(calls[1][1], context);
  } finally { controller.dispose(); }
});

test('null, wrong-sequence and wrong-byte-count replies never produce a saved acknowledgement', async () => {
  for (const bad of [null, { id: 'copy', sequence: 99, textBytes: '3' }, { id: 'copy', sequence: 1, textBytes: '999' }]) {
    const { controller, states } = fixture({ snapshot_editor_draft: async () => bad });
    try {
      assert.equal(await controller.flush('é\n'), false);
      assert.equal(states.at(-1).kind, 'failed');
      assert.equal(states.some(state => state.kind === 'saved'), false);
    } finally { controller.dispose(); }
  }
});
