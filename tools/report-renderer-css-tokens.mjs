// Advisory source audit, not a CSS parser or a computed-style check.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isCliEntry } from './cli-entry.mjs';

export function unresolvedCssTokens(sources) {
  const assigned = new Set();
  const used = new Map();
  for (const { path, text } of sources) {
    const source = text.replaceAll(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
    for (const pattern of [
      /(--[A-Za-z_][\w-]*)\s*:/g,
      /\[style\.(--[A-Za-z_][\w-]*)\]/g,
      /\bsetProperty\(\s*['"](--[A-Za-z_][\w-]*)['"]/g,
    ]) {
      for (const match of source.matchAll(pattern)) assigned.add(match[1]);
    }
    for (const match of source.matchAll(/\bvar\(\s*(--[A-Za-z_][\w-]*)\s*\)/g)) {
      const occurrences = used.get(match[1]) ?? [];
      occurrences.push({ path, line: source.slice(0, match.index).split('\n').length });
      used.set(match[1], occurrences);
    }
  }
  return [...used].filter(([token]) => !assigned.has(token))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([token, occurrences]) => ({ token, occurrences }));
}

function* rendererSources(directory, root) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* rendererSources(path, root);
    else if (entry.isFile() && /\.(css|scss|html|ts)$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) {
      yield { path: relative(root, path), text: readFileSync(path, 'utf8') };
    }
  }
}

if (isCliEntry(import.meta)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--check')) {
    console.error('Usage: node tools/report-renderer-css-tokens.mjs [--check]');
    process.exitCode = 2;
  } else {
    const root = resolve('apps/desktop/src');
    const findings = unresolvedCssTokens(rendererSources(root, root));
    for (const { token, occurrences } of findings) {
      console.log(token);
      for (const { path, line } of occurrences) console.log(`  ${path}:${line}`);
    }
    if (args.length && findings.length) {
      console.error('Unresolved renderer CSS references. Use a defined token or supply a fallback for a dynamic assignment.');
      process.exitCode = 1;
    }
  }
}
