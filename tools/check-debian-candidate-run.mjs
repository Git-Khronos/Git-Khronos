import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'Git-Khronos/Git-Khronos';
const WORKFLOW = '.github/workflows/release.yml';
const TAG = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]{0,15}$/;

export function selectCandidateRun(run, runId) {
  if (!ID.test(runId) || !Number.isSafeInteger(run?.id) || String(run.id) !== runId ||
      run.path !== WORKFLOW || run.event !== 'workflow_dispatch' ||
      run.head_branch !== 'main' || run.head_repository?.full_name !== REPO ||
      run.repository?.full_name !== REPO || !COMMIT.test(run.head_sha ?? '') ||
      run.status !== 'completed' || run.conclusion !== 'success' ||
      !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error('Expected a successful release candidate workflow dispatched on official main.');
  }
  return { head: run.head_sha, attempt: String(run.run_attempt) };
}

export function matchCandidateIdentity(run, candidate, runId, tag, commit) {
  const { attempt } = selectCandidateRun(run, runId);
  if (!TAG.test(tag) || !COMMIT.test(commit) || candidate?.schema !== 1 ||
      candidate.repository !== REPO || candidate.runId !== runId ||
      candidate.tag !== tag || candidate.commit !== commit || candidate.attempt !== attempt) {
    throw new Error('The downloaded candidate does not match this workflow attempt and release tag commit.');
  }
}

async function json(path, limit) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > limit) throw new Error('Invalid candidate metadata size.');
  return JSON.parse(await readFile(path, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [runPath, runId, candidatePath, tag, commit] = process.argv.slice(2);
    const run = await json(runPath, 128 * 1024);
    if (process.argv.length === 4) {
      const { head, attempt } = selectCandidateRun(run, runId);
      console.log(`${head} ${attempt}`);
    } else if (process.argv.length === 7) {
      matchCandidateIdentity(run, await json(candidatePath, 4096), runId, tag, commit);
    } else {
      throw new Error('Usage: check-debian-candidate-run RUN-JSON RUN-ID [CANDIDATE-JSON TAG COMMIT]');
    }
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
