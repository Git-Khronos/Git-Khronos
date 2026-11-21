#!/usr/bin/env node
// Compare the system launcher and executable against one selected local .deb.
// This checks files on disk, not a currently running app or a pinned shortcut.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdtempSync, openSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const name = 'git-khronos';
const files = [
  ['usr/bin/git-khronos', 512 * 1024 * 1024, true],
  ['usr/share/applications/git-khronos.desktop', 64 * 1024, false],
];

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return result;
}

function packageCommand(args) {
  const result = run('dpkg-deb', args);
  if (result.status !== 0) throw new Error(`Cannot read Debian package: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function digest(path, limit, executable) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit || (executable && !(stat.mode & 0o111))) {
      throw new Error(`Expected a regular, bounded ${executable ? 'executable' : 'desktop entry'}: ${path}`);
    }
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let size = 0;
    for (let read; (read = readSync(fd, buffer)) > 0;) {
      size += read;
      if (size > stat.size) throw new Error(`File changed while checking: ${path}`);
      hash.update(buffer.subarray(0, read));
    }
    const after = fstatSync(fd);
    if (size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      throw new Error(`File changed while checking: ${path}`);
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

export function checkInstalledDeb(packagePath, { root = '/', administrativeDirectory = '/var/lib/dpkg' } = {}) {
  const archive = resolve(packagePath);
  const field = fieldName => packageCommand(['--field', archive, fieldName]);
  const version = field('Version'), architecture = field('Architecture');
  if (field('Package') !== name || !version || !/^[a-z0-9][a-z0-9-]*$/.test(architecture)) {
    throw new Error('Expected a Git Khronos Debian package with a version and architecture.');
  }
  const query = () => run('dpkg-query', [
    `--admindir=${administrativeDirectory}`, '--show',
    '--showformat=${db:Status-Status}\t${Version}\t${Architecture}\n', `${name}:${architecture}`,
  ]);
  const record = query();
  if (record.status === 1 && !record.stdout.trim()) {
    throw new Error(`The Debian package ${name}:${architecture} is not installed.`);
  }
  if (record.status !== 0) throw new Error(`Cannot read installed package state: ${record.stderr.trim()}`);
  const [status, installedVersion, installedArchitecture] = record.stdout.trim().split('\t');
  if (status !== 'installed') throw new Error(`The Debian package ${name}:${architecture} is ${status}, not installed.`);
  if (installedVersion !== version || installedArchitecture !== architecture) {
    throw new Error(`Installed ${installedVersion} (${installedArchitecture}) does not match package ${version} (${architecture}).`);
  }

  const extracted = mkdtempSync(join(tmpdir(), 'git-khronos-installed-check-'));
  try {
    packageCommand(['--extract', archive, extracted]);
    const differences = files.flatMap(([file, limit, executable]) => {
      const expected = digest(join(extracted, file), limit, executable);
      const installed = join(root, file);
      try {
        return digest(installed, limit, executable) === expected ? [] : [`${installed} differs`];
      } catch (error) {
        return [`${installed} could not be checked: ${error.message}`];
      }
    });
    const after = query();
    if (after.status !== 0 || after.stdout !== record.stdout) throw new Error('The package database changed while checking. Retry after APT finishes.');
    if (differences.length) {
      throw new Error(`Version ${version} matches, but the installed files do not: ${differences.join('; ')}.`);
    }
    return { archive, version, architecture, files: files.map(([file]) => join(root, file)) };
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node tools/check-installed-deb.mjs PACKAGE.deb');
    const { archive, version, architecture } = checkInstalledDeb(process.argv[2]);
    console.log(`Installed Git Khronos ${version} (${architecture}) executable and desktop entry match:\n  ${archive}`);
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
