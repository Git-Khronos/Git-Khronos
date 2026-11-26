#!/usr/bin/env node
import { constants } from 'node:fs';
import { lstat, readdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = resolve(process.argv[2] ?? '');

async function checkSquashfsPayload(file, header, fileSize) {
  const tableStart = header.readBigUInt64LE(40);
  const entrySize = header.readUInt16LE(58);
  const entryCount = header.readUInt16LE(60);
  const tableEnd = tableStart + BigInt(entrySize * entryCount);
  if (tableStart < 64n || entrySize !== 64 || entryCount === 0
      || !Number.isSafeInteger(fileSize) || tableEnd > BigInt(fileSize)) {
    throw new Error('The AppImage has an invalid ELF section table.');
  }

  // The Type 2 runtime places the filesystem after the section table and
  // final section. Do not search for a magic sequence inside the runtime.
  const lastSection = Buffer.alloc(entrySize);
  const sectionRead = await file.read(lastSection, 0, entrySize, Number(tableEnd) - entrySize);
  if (sectionRead.bytesRead !== entrySize) {
    throw new Error('The AppImage has a truncated ELF section table.');
  }
  const sectionEnd = lastSection.readBigUInt64LE(24) + lastSection.readBigUInt64LE(32);
  const offset = sectionEnd > tableEnd ? sectionEnd : tableEnd;
  const superblock = Buffer.alloc(96);
  const available = BigInt(fileSize) - offset;
  if (available < BigInt(superblock.length)) {
    throw new Error('The AppImage has no complete SquashFS superblock.');
  }
  const { bytesRead } = await file.read(superblock, 0, superblock.length, Number(offset));
  if (bytesRead !== superblock.length || !superblock.subarray(0, 4).equals(Buffer.from('hsqs'))
      || superblock.readUInt16LE(28) !== 4 || superblock.readUInt16LE(30) !== 0) {
    throw new Error('The AppImage has no valid SquashFS 4.0 superblock at the payload offset.');
  }
  const used = superblock.readBigUInt64LE(40);
  if (used <= BigInt(superblock.length) || used > available) {
    throw new Error('The AppImage SquashFS payload is truncated or has an invalid size.');
  }
}

export async function checkAppImageFile(artifact) {
  // The directory entry can change before open; a substituted pipe must
  // not hang the packaging task and a symlink must not redirect the read.
  const file = await open(artifact, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat({ bigint: true });
    if (!metadata.isFile() || metadata.size === 0n || (metadata.mode & 0o111n) === 0n) {
      throw new Error('The AppImage must be a non-empty regular executable file.');
    }
    const header = Buffer.alloc(64);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
      throw new Error('The .AppImage artifact does not have an ELF runtime header.');
    }
    if (!header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02]))) {
      throw new Error('The ELF artifact is missing the Type 2 AppImage marker.');
    }
    const executableType = header.readUInt16LE(16);
    if (header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== 62
        || (executableType !== 2 && executableType !== 3)) {
      throw new Error('The Type 2 AppImage runtime is not an amd64 ELF executable.');
    }
    await checkSquashfsPayload(file, header, Number(metadata.size));
    const current = await lstat(artifact, { bigint: true });
    if (!current.isFile() || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => current[key] !== metadata[key])) {
      throw new Error('The AppImage changed while checking its structure.');
    }
  } finally {
    await file.close();
  }
  return artifact;
}

export async function checkAppImage(bundleDirectory) {
  const bundlePath = resolve(bundleDirectory);
  const entries = await readdir(bundlePath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.AppImage'))
    .map((entry) => join(bundlePath, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one regular .AppImage artifact in ${bundlePath}; found ${candidates.length}.`);
  }
  return checkAppImageFile(candidates[0]);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  (process.argv[2] ? checkAppImage(directory) : Promise.reject(new Error('Usage: check-linux-appimage.mjs <bundle-directory>')))
    .then((artifact) => console.log(artifact))
    .catch((error) => { console.error(`Git Khronos: ${error.message}`); process.exitCode = 1; });
}
