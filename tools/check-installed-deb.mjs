#!/usr/bin/env node
// Compare the system launcher and executable against one selected local .deb.
// This compares installed files and can flag a replaced executable still in use.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { isCliEntry } from './cli-entry.mjs';

const name = 'git-khronos';
const executablePath = 'usr/bin/git-khronos';
const executableLimit = 512 * 1024 * 1024;
const desktopEntry = 'usr/share/applications/git-khronos.desktop';
const desktopEntryLimit = 64 * 1024;
const files = [
  [executablePath, executableLimit, true],
  [desktopEntry, desktopEntryLimit, false],
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
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.size < 1n || stat.size > BigInt(limit) || (executable && (stat.mode & 0o111n) === 0n)) {
      throw new Error(`Expected a regular, bounded ${executable ? 'executable' : 'desktop entry'}: ${path}`);
    }
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    const limitBytes = Number(stat.size);
    let size = 0;
    for (let read; (read = readSync(fd, buffer)) > 0;) {
      size += read;
      if (size > limitBytes) throw new Error(`File changed while checking: ${path}`);
      hash.update(buffer.subarray(0, read));
    }
    const after = fstatSync(fd, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    if (size !== limitBytes || !current.isFile() ||
        ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => stat[key] !== after[key] || stat[key] !== current[key])) {
      throw new Error(`File changed while checking: ${path}`);
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function firstExecutable(searchPath) {
  if (searchPath === undefined) return null;
  for (const directory of searchPath.split(delimiter)) {
    const path = resolve(directory || '.', name);
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      // This candidate cannot be used as a command. Check the next directory.
    }
  }
  return null;
}

// APT may replace the executable while the old process still has it mapped.
// Look only at /proc entries owned by this user and at this exact install path.
export function findReplacedProcesses(executable, procDirectory = '/proc', uid = process.getuid?.()) {
  if (uid === undefined) return [];
  let entries;
  try { entries = readdirSync(procDirectory); } catch { return []; }
  const replaced = [];
  for (const entry of entries) {
    if (!/^[1-9][0-9]*$/.test(entry)) continue;
    const processPath = join(procDirectory, entry);
    try {
      const owner = lstatSync(processPath);
      if (!owner.isDirectory() || owner.uid !== uid) continue;
      if (readlinkSync(join(processPath, 'exe')) === `${executable} (deleted)`) {
        replaced.push(Number(entry));
      }
    } catch {
      // A transient or inaccessible process is not evidence of a stale build.
    }
  }
  return replaced.sort((left, right) => left - right);
}

export function checkInstalledDeb(packagePath, {
  root = '/', administrativeDirectory = '/var/lib/dpkg', userDataDirectory, desktopDataDirectories = [], searchPath,
} = {}) {
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
    const expectedDigests = new Map();
    const differences = files.flatMap(([file, limit, executable]) => {
      const expected = digest(join(extracted, file), limit, executable);
      expectedDigests.set(file, expected);
      const installed = join(root, file);
      try {
        const actual = digest(installed, limit, executable);
        return actual === expected ? [] : [
          `${installed} differs (SHA-256 prefixes: installed ${actual.slice(0, 12)}, archive ${expected.slice(0, 12)})`,
        ];
      } catch (error) {
        return [`${installed} could not be checked: ${error.message}`];
      }
    });
    const after = query();
    if (after.status !== 0 || after.stdout !== record.stdout) throw new Error('The package database changed while checking. Retry after APT finishes.');
    if (differences.length) {
      throw new Error(
        `Version ${version} matches, but the installed files do not: ${differences.join('; ')}.\n` +
        `Compared with ${JSON.stringify(archive)}. If this is the build you want, install that reviewed archive, ` +
        'then quit and relaunch Git Khronos.',
      );
    }
    function inspectLauncher(directory) {
      const path = join(directory, 'applications', 'git-khronos.desktop');
      try {
        const launcherDigest = digest(path, desktopEntryLimit, false);
        return { path, state: launcherDigest === expectedDigests.get(desktopEntry) ? 'matches' : 'differs' };
      } catch (error) {
        return error.code === 'ENOENT' ? null : { path, state: 'unverified' };
      }
    }
    const userLauncher = userDataDirectory ? inspectLauncher(userDataDirectory) : null;
    let desktopSearchLauncher = null;
    if (!userLauncher) {
      for (const directory of desktopDataDirectories) {
        if (!isAbsolute(directory)) continue;
        const candidate = inspectLauncher(directory);
        if (!candidate) continue;
        if (candidate.path !== join(root, desktopEntry)) desktopSearchLauncher = candidate;
        break;
      }
    }
    let shellExecutable = null;
    const path = firstExecutable(searchPath);
    if (path) {
      try {
        const resolved = realpathSync(path);
        const matches = resolved === resolve(root, executablePath)
          || digest(resolved, executableLimit, true) === expectedDigests.get(executablePath);
        shellExecutable = { path, state: matches ? 'matches' : 'differs' };
      } catch {
        shellExecutable = { path, state: 'unverified' };
      }
    }
    return { archive, version, architecture, files: files.map(([file]) => join(root, file)),
      userLauncher, desktopSearchLauncher, shellExecutable };
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node tools/check-installed-deb.mjs PACKAGE.deb');
    const xdg = process.env.XDG_DATA_HOME;
    const userDataDirectory = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'share');
    const desktopDataDirectories = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(delimiter);
    const { archive, version, architecture, userLauncher, desktopSearchLauncher, shellExecutable } = checkInstalledDeb(
      process.argv[2], { userDataDirectory, desktopDataDirectories, searchPath: process.env.PATH },
    );
    console.log(`Installed Git Khronos ${version} (${architecture}) executable and desktop entry match:\n  ${archive}`);
    if (userLauncher && userLauncher.state !== 'matches') {
      console.warn(`User desktop entry ${userLauncher.state === 'differs' ? 'differs from the package' : 'could not be verified'} and may override the installed desktop entry:\n  ${JSON.stringify(userLauncher.path)}`);
    }
    if (desktopSearchLauncher && desktopSearchLauncher.state !== 'matches') {
      console.warn(`Desktop search-path entry ${desktopSearchLauncher.state === 'differs' ? 'differs from the package' : 'could not be verified'} and may override the installed desktop entry:\n  ${JSON.stringify(desktopSearchLauncher.path)}`);
    }
    if (shellExecutable && shellExecutable.state !== 'matches') {
      console.warn(`The first Git Khronos executable on this shell's PATH ${shellExecutable.state === 'differs' ? 'differs from the package' : 'could not be verified'}:\n  ${JSON.stringify(shellExecutable.path)}`);
    }
    const replaced = findReplacedProcesses(join('/', executablePath));
    if (replaced.length) {
      console.warn(`Restart Git Khronos: a running process is still using a replaced system executable (PID ${replaced.join(', ')}).`);
    }
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
