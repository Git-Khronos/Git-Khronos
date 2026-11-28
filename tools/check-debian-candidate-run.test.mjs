import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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

test('download handoff refuses pending runs and mismatched candidate attempts before fetching evidence',
  { skip: process.platform !== 'linux' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'gk-release-download-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, 'bin');
    const output = join(root, 'release evidence');
    const publicKey = join(root, 'public.key');
    const runJson = join(root, 'run.json');
    const candidateJson = join(root, 'candidate.json');
    await mkdir(bin);
    await mkdir(output);
    await writeFile(publicKey, 'not read before candidate verification');
    await writeFile(join(bin, 'gh'), `#!/bin/bash
set -eu
if [[ "$*" == 'api --hostname github.com repos/Git-Khronos/Git-Khronos/actions/runs/123456' ]]; then
  cat "$RUN_JSON"
elif [[ "$#" = 9 && "$1 $2 $3 $4 $5 $6 $7 $8" == 'run download 123456 --repo github.com/Git-Khronos/Git-Khronos --name debian-candidate-2 --dir' ]]; then
  mkdir -- "$9"
  cp -- "$CANDIDATE_JSON" "$9/candidate.json"
else
  echo "unexpected request: $*" >&2
  exit 99
fi
`, { mode: 0o700 });
    await writeFile(join(bin, 'git'), `#!/bin/sh
test "$*" = 'ls-remote --exit-code https://github.com/Git-Khronos/Git-Khronos.git refs/tags/v0.1.6 refs/tags/v0.1.6^{}' || exit 99
printf '%s\\trefs/tags/v0.1.6\\n%s\\trefs/tags/v0.1.6^{}\\n' '${head}' '${commit}'
`, { mode: 0o700 });
    const script = fileURLToPath(new URL('./download-qualified-debian.sh', import.meta.url));
    const fixtureTools = join(root, 'tools');
    const fixtureHome = join(root, 'publisher');
    const keyDir = join(fixtureHome, '.config/git-khronos-signing');
    const defaultOutput = join(root, 'target/local-review/hosted-release-integration/candidate-123456');
    await mkdir(fixtureTools);
    await mkdir(keyDir, { recursive: true });
    for (const name of ['download-qualified-debian.sh', 'check-debian-candidate-run.mjs', 'cli-entry.mjs']) {
      await copyFile(fileURLToPath(new URL('./' + name, import.meta.url)), join(fixtureTools, name));
    }
    const invoke = (useDefaults = false) => spawnSync('bash', [
      useDefaults ? join(fixtureTools, 'download-qualified-debian.sh') : script, 'v0.1.6', '123456',
      ...(useDefaults ? [] : [publicKey, output]),
    ], {
      cwd: output, env: { ...process.env, HOME: fixtureHome, PATH: bin + delimiter + process.env.PATH,
        RUN_JSON: runJson, CANDIDATE_JSON: candidateJson },
      encoding: 'utf8',
    });
    await writeFile(runJson, JSON.stringify({ ...run, status: 'in_progress', conclusion: null }));
    const pending = invoke();
    assert.equal(pending.status, 1, pending.stderr);
    assert.match(pending.stderr, /Expected a successful release candidate/);
    assert.deepEqual(await readdir(output), []);
    assert.match(invoke(true).stderr, /Publisher public key is missing/);
    await writeFile(join(keyDir, 'git-khronos.key.pub'), 'trusted public key fixture');
    assert.match(invoke(true).stderr, /Expected a successful release candidate/);
    await assert.rejects(readdir(defaultOutput), { code: 'ENOENT' });
    await writeFile(runJson, JSON.stringify(run));
    await writeFile(candidateJson, JSON.stringify({ ...candidate, attempt: '1' }));
    const stale = invoke();
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /does not match this workflow attempt and release tag commit/);
    assert.match(stale.stderr, /Do not sign it\./);
    assert.doesNotMatch(stale.stderr, /unexpected request/);
    assert.equal(stale.stdout, '');
    const [work] = await readdir(output);
    assert.match(work, /^v0\.1\.6-run-123456-attempt-2\./);
    assert.deepEqual((await readdir(join(output, work))).sort(), ['candidate', 'candidate-run.json']);
    const defaultStale = invoke(true);
    assert.equal(defaultStale.status, 1, defaultStale.stderr);
    assert.match(defaultStale.stderr, /does not match this workflow attempt and release tag commit/);
    const [defaultWork] = await readdir(defaultOutput);
    assert.match(defaultWork, /^v0\.1\.6-run-123456-attempt-2\./);
    assert.deepEqual((await readdir(join(defaultOutput, defaultWork))).sort(), ['candidate', 'candidate-run.json']);
  });
