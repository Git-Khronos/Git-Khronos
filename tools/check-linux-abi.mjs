#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const baseline = '2.35';
const compare = (left, right) => {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

export function verifyGlibcBaseline(depends, versionInfo) {
  const floors = depends.split(',').map(clause => clause.trim())
    .filter(clause => /^libc6(?:\s|:|$)/.test(clause))
    .map(clause => {
      const match = /^libc6 \(>= ([0-9]+(?:\.[0-9]+)+)\)$/.exec(clause);
      if (!match) throw new Error(`Unsupported glibc dependency: ${clause}`);
      return match[1];
    });
  if (!floors.length) throw new Error('Missing versioned libc6 dependency.');
  const declared = floors.sort(compare).at(-1);
  if (compare(declared, baseline) !== 0) {
    throw new Error(`Release libc6 floor is ${declared}; expected the Jammy baseline ${baseline}.`);
  }
  const versions = [...versionInfo.matchAll(/\bName: GLIBC_(\S+)/g)].map(match => match[1]);
  if (!versions.length) throw new Error('No GLIBC version requirements found in the executable.');
  for (const version of versions) {
    if (!/^[0-9]+(?:\.[0-9]+)+$/.test(version) || compare(version, baseline) > 0) {
      throw new Error(`Executable requires GLIBC_${version}, outside the Jammy ${baseline} ABI.`);
    }
  }
  return { baseline, declared, required: [...new Set(versions)].sort(compare) };
}

function payloadDigest(path, limit) {
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(file);
    if (!info.isFile() || info.size < 1 || info.size > limit) {
      throw new Error('Expected a bounded, regular Debian payload file.');
    }
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } finally {
    closeSync(file);
  }
}

export function checkPackage(packagePath) {
  const run = (command, args) => execFileSync(command, args, {
    encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const field = name => run('dpkg-deb', ['--field', packagePath, name]).trim();
  if (field('Package') !== 'git-khronos' || field('Architecture') !== 'amd64') {
    throw new Error('The Ubuntu release gate requires the git-khronos amd64 Debian package.');
  }
  const depends = field('Depends');
  const version = field('Version');
  const directory = mkdtempSync(join(tmpdir(), 'git-khronos-abi-'));
  try {
    run('dpkg-deb', ['--extract', packagePath, directory]);
    const executable = join(directory, 'usr/bin/git-khronos');
    const installedPayload = {
      executableSha256: payloadDigest(executable, 512 * 1024 * 1024),
      desktopEntrySha256: payloadDigest(join(directory, 'usr/share/applications/git-khronos.desktop'), 64 * 1024),
    };
    const header = run('readelf', ['--file-header', '--wide', executable]);
    if (!/Class:\s+ELF64\b/.test(header) || !/Machine:\s+Advanced Micro Devices X86-64\b/.test(header)) {
      throw new Error('The packaged executable is not an amd64 ELF64 binary.');
    }
    const glibc = verifyGlibcBaseline(depends, run('readelf', ['--version-info', '--wide', executable]));
    const dynamic = run('readelf', ['--dynamic', '--wide', executable]);
    return {
      package: resolve(packagePath),
      packageSha256: createHash('sha256').update(readFileSync(packagePath)).digest('hex'),
      version, depends, glibc, installedPayload,
      neededLibraries: [...dynamic.matchAll(/\(NEEDED\).*Shared library: \[([^\]]+)\]/g)].map(match => match[1]),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node tools/check-linux-abi.mjs PACKAGE.deb');
    console.log(JSON.stringify(checkPackage(resolve(process.argv[2])), null, 2));
  } catch (error) {
    console.error(`Ubuntu release ABI check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
