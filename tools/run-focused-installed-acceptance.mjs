#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './cli-entry.mjs';
import { checkPackageIdentity } from './check-linux-abi.mjs';
import { checkInstalledDeb } from './check-installed-deb.mjs';
import {
  expandAcceptanceReports, readFocusedAcceptancePlan, reportInstalledAcceptance,
} from './report-installed-acceptance.mjs';

const harness = fileURLToPath(new URL('./native_acceptance.py', import.meta.url));
const pythonOverride = 'GIT_KHRONOS_ACCEPTANCE_PYTHON';

function describeRunner(python) {
  const result = spawnSync(python, [harness, '--describe-runner'], {
    encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL',
  });
  if (result.error || result.status !== 0) {
    const hint = result.error?.code === 'ENOENT'
      ? ` Put python3 on PATH or set ${pythonOverride} to an absolute interpreter path.` : '';
    throw new Error(`Cannot describe the native acceptance runner: ${result.error?.message ?? result.stderr.trim()}.${hint}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('The native acceptance runner did not return its JSON description.');
  }
}

function runHarness(python, args) {
  const result = spawnSync(python, [harness, ...args], { stdio: 'inherit' });
  return { exitCode: result.status, signal: result.signal, error: result.error?.message ?? null };
}

function checkRunner(plan, runner) {
  const validSuites = values => Array.isArray(values)
    && values.every(value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    && new Set(values).size === values.length;
  if (!runner || !validSuites(runner.suites) || !runner.suites.length
      || !validSuites(runner.forcedInheritedGitEnvironment)
      || runner.forcedInheritedGitEnvironment.some(suite => !runner.suites.includes(suite))
      || (runner.distribution !== null && (typeof runner.distribution?.id !== 'string'
        || typeof runner.distribution?.versionId !== 'string'))
      || typeof runner.expectedPackageName !== 'string'
      || !/^Git-Khronos_[A-Za-z0-9.+-]+_amd64\.deb$/.test(runner.expectedPackageName)) {
    throw new Error('The native acceptance runner returned an invalid capability description.');
  }
  const { distribution, suites, forcedInheritedGitEnvironment } = runner;
  const label = distribution ? `${distribution.id} ${distribution.versionId}` : 'unidentified Linux userspace';
  for (const { distribution: target, suite, inheritedGitEnvironment } of plan.checks) {
    if (distribution?.id !== target.id || distribution.versionId !== target.versionId) {
      throw new Error(`Suite ${suite} needs ${target.id} ${target.versionId}; this runner is ${label}. Run a separate plan per distribution.`);
    }
    if (!suites.includes(suite)) throw new Error(`Unknown native acceptance suite: ${suite}.`);
    if (!inheritedGitEnvironment && forcedInheritedGitEnvironment.includes(suite)) {
      throw new Error(`Suite ${suite} always requires inheritedGitEnvironment: true.`);
    }
  }
}

export async function runFocusedInstalledAcceptance(planPath, packagePath, outputPath, {
  python = process.env[pythonOverride],
  describe = () => describeRunner(python ?? 'python3'), verifyPackage = checkPackageIdentity,
  verifyInstalled = checkInstalledDeb,
  run = args => runHarness(python ?? 'python3', args), verify = reportInstalledAcceptance,
  clock = () => performance.now(),
} = {}) {
  if (python !== undefined && (typeof python !== 'string' || !isAbsolute(python))) {
    throw new Error(`${pythonOverride} must be an absolute Python interpreter path.`);
  }
  const plan = await readFocusedAcceptancePlan(planPath);
  const runner = describe();
  checkRunner(plan, runner);
  const installer = await realpath(packagePath);
  if (basename(installer) !== runner.expectedPackageName) {
    throw new Error(`Native acceptance needs the original archive name ${runner.expectedPackageName}, got ${basename(installer)}.`);
  }
  const { packageSha256 } = verifyPackage(installer);
  // A common failure (old installed bytes with an identical version) is
  // shared by every suite. Refuse before allocating any lane or evidence.
  verifyInstalled(installer);
  const output = resolve(outputPath);
  // A second attempt must get a new directory; stale receipts cannot qualify it.
  await mkdir(output, { mode: 0o700 });
  await writeFile(join(output, 'focused-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  const results = join(output, 'results');
  await mkdir(results);
  const summary = {
    kind: 'focused-installed-acceptance-run', complete: false, package: installer,
    sha256: packageSha256, lanes: [], verification: null, verificationError: null,
  };
  const started = clock();
  const elapsed = since => Math.round(clock() - since);
  let progressAvailable = true;
  const publish = async (phase, activeLane = null) => {
    if (!progressAvailable) return;
    const destination = join(output, 'progress.json');
    const progress = {
      phase, activeLane, completedLanes: summary.lanes.length,
      totalLanes: plan.checks.length, elapsedMs: elapsed(started),
    };
    try {
      await writeFile(destination + '.tmp', JSON.stringify(progress, null, 2) + '\n', { flag: 'wx' });
      await rename(destination + '.tmp', destination);
    } catch {
      // The final receipt and verified reports, not this advisory file,
      // determine the outcome.
      progressAvailable = false;
    }
  };
  for (const check of plan.checks) {
    const outputRoot = join(results, `${check.suite}-${check.inheritedGitEnvironment ? 'inherited' : 'normal'}`);
    const args = ['--suite', check.suite, '--installed', '--headless', '--package', installer, '--output', outputRoot];
    if (check.inheritedGitEnvironment) args.push('--inherited-git-environment');
    await publish('running', { suite: check.suite, inheritedGitEnvironment: check.inheritedGitEnvironment, output: outputRoot });
    const laneStarted = clock();
    const result = run(args);
    summary.lanes.push({ ...check, output: outputRoot, ...result, durationMs: elapsed(laneStarted) });
    if (result.signal || result.error || result.exitCode >= 128) break;
  }
  await publish('verifying');
  try {
    const paths = await expandAcceptanceReports(['--reports-dir', results], { allowEmptyDirectories: true });
    const report = await verify(installer, paths, { focusedRequest: plan });
    if (report.sha256 !== packageSha256) throw new Error('The Debian package changed during acceptance.');
    summary.verification = report;
    summary.complete = report.focusedAcceptance.complete && summary.lanes.length === plan.checks.length
      && summary.lanes.every(lane => lane.exitCode === 0 && !lane.signal && !lane.error);
  } catch (error) {
    summary.verificationError = error.message;
  }
  const receipt = join(output, 'run.json');
  summary.durationMs = elapsed(started);
  await writeFile(receipt + '.tmp', JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  await rename(receipt + '.tmp', receipt);
  await publish(summary.complete ? 'passed' : 'incomplete');
  return { complete: summary.complete, receipt };
}

if (isCliEntry(import.meta)) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 3 || args.some(arg => !arg || arg.startsWith('--'))) {
      throw new Error('Usage: node tools/run-focused-installed-acceptance.mjs PLAN PACKAGE.deb NEW_OUTPUT_DIR');
    }
    const result = await runFocusedInstalledAcceptance(...args);
    console.log(`Focused installed acceptance ${result.complete ? 'passed' : 'incomplete'}: ${result.receipt}`);
    if (!result.complete) process.exitCode = 1;
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
