#!/usr/bin/env node
import { watch } from 'node:fs';
import { isCliEntry } from './cli-entry.mjs';

// Tauri watches the Cargo manifest even during a non-interactive build.
// Probe the same file in this build environment without leaving a watcher
// open or trying to change host resource limits.
export function checkLinuxPackageWatcher(manifest, openWatch = watch) {
  try {
    openWatch(manifest, { persistent: false }, () => {}).close();
  } catch (error) {
    const explanation = {
      EMFILE: 'The process descriptor limit or the account’s inotify instance limit may be exhausted.',
      ENFILE: 'The system-wide open-file limit is exhausted.',
      ENOSPC: 'The account’s inotify watch limit may be exhausted.',
    }[error.code];
    const hint = explanation
      ? ` ${explanation} Close unused watchers or adjust limits in the isolated build runner before retrying.`
      : ' Check that the Cargo manifest exists and can be watched in this build workspace.';
    throw new Error(`Cannot watch ${manifest} (${error.code ?? 'unknown error'}).${hint}`, { cause: error });
  }
}

if (isCliEntry(import.meta)) {
  try {
    if (!process.argv[2]) throw new Error('Expected the package Cargo manifest path.');
    checkLinuxPackageWatcher(process.argv[2]);
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
