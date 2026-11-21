#!/usr/bin/env node
// Summarize operator-owned reports without confusing extracted builds, other
// package bytes, or repeated scenarios with installed release evidence.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPackage } from './check-linux-abi.mjs';

const MAX_REPORT_BYTES = 4 * 1024 * 1024;

async function readReport(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_REPORT_BYTES) {
      throw new Error('Expected a bounded, regular acceptance report');
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error('The acceptance report changed while reading it');
    return JSON.parse(bytes.subarray(0, offset).toString('utf8'));
  } finally {
    await file.close();
  }
}

export function summarizeInstalledReport(candidate, report) {
  if (report?.packageSha256 !== candidate.packageSha256) {
    throw new Error('The report is for a different Debian package');
  }
  if (report.installedExecutable !== true || report.executable !== '/usr/bin/git-khronos' ||
      report.installedDesktopEntry?.path !== '/usr/share/applications/git-khronos.desktop' ||
      report.executableSha256 !== candidate.installedPayload.executableSha256 ||
      report.installedDesktopEntry.sha256 !== candidate.installedPayload.desktopEntrySha256) {
    throw new Error('The report does not match the package’s installed executable and launcher');
  }
  if (typeof report.passed !== 'boolean' || typeof report.suite !== 'string' ||
      !/^[a-z]+(?:-[a-z]+)*$/.test(report.suite) || typeof report.git !== 'string' || !/^git version \S/.test(report.git) ||
      typeof report.platform !== 'string' || !report.platform || !Array.isArray(report.scenarios) ||
      (report.passed && !report.scenarios.length) ||
      report.scenarios.some(name => typeof name !== 'string' || !name.trim()) ||
      new Set(report.scenarios).size !== report.scenarios.length) {
    throw new Error('The report has invalid suite or scenario evidence');
  }
  const distro = report.linuxDistribution;
  return {
    suite: report.suite,
    passed: report.passed,
    completedScenarios: report.scenarios.length,
    git: report.git,
    platform: report.platform,
    distribution: typeof distro?.id === 'string' && distro.id
      ? { id: distro.id, versionId: typeof distro.versionId === 'string' ? distro.versionId : null } : null,
    inheritedGitEnvironment: report.inheritedGitEnvironment === true,
  };
}

export async function reportInstalledAcceptance(packagePath, reportPaths) {
  const candidate = checkPackage(resolve(packagePath));
  const reports = [];
  const seen = new Set();
  for (const path of reportPaths) {
    const absolute = resolve(path);
    if (seen.has(absolute)) throw new Error(`Duplicate report path: ${path}`);
    seen.add(absolute);
    try {
      reports.push({ path, ...summarizeInstalledReport(candidate, await readReport(absolute)) });
    } catch (error) {
      throw new Error(`${path}: ${error.message}`, { cause: error });
    }
  }
  return {
    package: candidate.package,
    version: candidate.version,
    sha256: candidate.packageSha256,
    reports,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [packagePath, ...reportPaths] = process.argv.slice(2);
    if (!packagePath || !reportPaths.length) {
      throw new Error('Usage: node tools/report-installed-acceptance.mjs PACKAGE.deb REPORT.json [REPORT.json …]');
    }
    const summary = await reportInstalledAcceptance(packagePath, reportPaths);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.reports.some(report => !report.passed)) process.exitCode = 1;
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
