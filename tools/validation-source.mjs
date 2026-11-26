import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync } from 'node:fs';

const maxInputBytes = 128 * 1024 * 1024;

// This is an endpoint comparison, not a worktree snapshot. It cannot detect
// edits that are reverted before the second read, or inputs ignored by Git.
export function validationSourceFingerprint(cwd, env) {
  const worktree = spawnSync('git', ['--no-optional-locks', 'rev-parse', '--show-toplevel'],
    { cwd, env, encoding: 'utf8', timeout: 10_000 });
  if (worktree.status !== 0 || !worktree.stdout.endsWith('\n')) {
    throw new Error('Cannot resolve the Git worktree for validation');
  }
  // Nx can load inputs from its root even when launched in a subdirectory.
  // Do not silently fingerprint only the caller's subtree.
  cwd = worktree.stdout.slice(0, -1);
  const files = spawnSync('git', ['--no-optional-locks', 'ls-files', '-z',
    '--cached', '--others', '--exclude-standard'], { cwd, env, maxBuffer: 8 * 1024 * 1024, timeout: 10_000 });
  if (files.status !== 0) throw new Error('Cannot list Git validation inputs');
  const root = Buffer.from(cwd + '/');
  const names = [];
  for (let start = 0; start < files.stdout.length;) {
    const end = files.stdout.indexOf(0, start);
    if (end === -1) throw new Error('Invalid Git path list');
    names.push(files.stdout.subarray(start, end));
    start = end + 1;
  }
  names.sort(Buffer.compare);
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  const checkedDirectories = new Set();
  let bytes = 0;
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    if (index && name.equals(names[index - 1])) continue;
    const path = Buffer.concat([root, name]);
    // A tracked directory can have been replaced with a symlink. Do not
    // follow it to fingerprint data outside the checkout.
    for (let slash = name.indexOf(47); slash !== -1; slash = name.indexOf(47, slash + 1)) {
      const prefix = name.subarray(0, slash);
      const key = prefix.toString('hex');
      if (checkedDirectories.has(key)) continue;
      let parent;
      try { parent = lstatSync(Buffer.concat([root, prefix])); }
      catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) break;
        throw error;
      }
      if (!parent.isDirectory()) throw new Error('Validation input directory has been replaced');
      checkedDirectories.add(key);
    }
    hash.update(name).update('\0');
    let entry;
    try { entry = lstatSync(path); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      hash.update('missing\0');
      continue;
    }
    if (entry.isSymbolicLink()) {
      hash.update('link\0').update(readlinkSync(path, { encoding: 'buffer' })).update('\0');
      continue;
    }
    if (!entry.isFile()) throw new Error('Git input is not a regular file or symlink');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const file = fstatSync(fd);
      if (!file.isFile() || file.dev !== entry.dev || file.ino !== entry.ino) {
        throw new Error('Validation input changed while opening it');
      }
      bytes += file.size;
      if (bytes > maxInputBytes) throw new Error('Git validation inputs exceed 128 MiB');
      hash.update(`file:${file.mode & 0o111}:${file.size}\0`);
      let total = 0;
      for (let count; (count = readSync(fd, buffer));) {
        total += count;
        if (total > file.size) throw new Error('Validation input grew while reading it');
        hash.update(buffer.subarray(0, count));
      }
      if (total !== file.size || file.mtimeMs !== fstatSync(fd).mtimeMs) {
        throw new Error('Validation input changed while reading it');
      }
    } finally { closeSync(fd); }
  }
  return hash.digest('hex');
}
