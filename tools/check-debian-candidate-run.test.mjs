import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchCandidateIdentity, selectCandidateRun } from './check-debian-candidate-run.mjs';

const repo = 'Git-Khronos/Git-Khronos';
const head = 'b'.repeat(40);
const commit = 'a'.repeat(40);
const run = {
  id: 123456, run_attempt: 2, head_sha: head, head_branch: 'main',
  head_repository: { full_name: repo }, repository: { full_name: repo },
  status: 'completed', conclusion: 'success', event: 'workflow_dispatch',
  path: '.github/workflows/release.yml',
};
const candidate = { schema: 1, repository: repo, runId: '123456', attempt: '2', tag: 'v0.1.6', commit };

test('selects the exact successful official main workflow attempt and identifies its tagged candidate', () => {
  assert.deepEqual(selectCandidateRun(run, '123456'), { head, attempt: '2' });
  assert.doesNotThrow(() => matchCandidateIdentity(run, candidate, '123456', 'v0.1.6', commit));
});

test('rejects nonterminal or failed runs and evidence from the wrong workflow, branch or repository', () => {
  for (const fields of [
    { status: 'in_progress' }, { conclusion: 'cancelled' }, { run_attempt: null },
    { path: '.github/workflows/ci.yml' }, { head_branch: 'dev' }, { event: 'push' },
    { head_sha: 'refs/heads/main' }, { id: 123457 }, { repository: {} },
    { head_repository: { full_name: 'fork/Git-Khronos' } },
  ]) {
    assert.throws(() => selectCandidateRun({ ...run, ...fields }, '123456'), /successful release candidate/);
  }
  assert.throws(() => selectCandidateRun(run, '../123456'), /successful release candidate/);
});

test('rejects stale attempt, moved tag, wrong version, or substituted candidate records', () => {
  for (const fields of [
    { schema: 2 }, { attempt: '1' }, { tag: 'v0.1.7' },
    { commit: head }, { runId: '234567' }, { repository: 'fork/Git-Khronos' },
  ]) {
    assert.throws(() => matchCandidateIdentity(run, { ...candidate, ...fields }, '123456', 'v0.1.6', commit), /does not match/);
  }
  const tag = 'v0.01.6';
  assert.throws(() => matchCandidateIdentity(run, { ...candidate, tag }, '123456', tag, commit), /does not match/);
});
