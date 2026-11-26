// Node resolves a symlinked entry before setting its module URL.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isCliEntry(meta) {
  if (typeof meta.main === 'boolean') return meta.main;
  if (!process.argv[1]) return false;
  try { return meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
}
