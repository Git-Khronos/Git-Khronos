import { readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function rootsInIndex(html) {
  const roots = new Set();
  for (const [, tag, markup] of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const attrs = new Map([...markup.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)]
      .map(([, key, double, single, bare]) => [key.toLowerCase(), double ?? single ?? bare]));
    const rel = attrs.get('rel')?.toLowerCase();
    const url = tag.toLowerCase() === 'script' ? attrs.get('src')
      : (rel === 'stylesheet' || rel === 'modulepreload') ? attrs.get('href') : undefined;
    if (url) roots.add(localOutputPath(url));
  }
  if (!roots.size) throw new Error('No initial scripts or styles found in the generated index.');
  return roots;
}

function localOutputPath(path) {
  if (!/^(?:\.\/)?[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').includes('..')) {
    throw new Error(`Expected a local renderer output path: ${path}`);
  }
  return posix.normalize(path);
}

export function budgetBytes(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb)?$/i.exec(value ?? '');
  if (!match) throw new Error(`Unsupported initial bundle budget: ${value}`);
  const bytes = Number(match[1]) * ({ b: 1, kb: 1_000, mb: 1_000_000 }[match[2]?.toLowerCase() ?? 'b']);
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error(`Invalid initial bundle budget: ${value}`);
  return bytes;
}

// Include exactly the emitted entry files and their static import graph.
// Assets behind a dynamic import don't contribute unless the index eagerly
// preloads them or another initial file also statically imports them.
export function initialRendererReport(html, metadata, budget) {
  const pending = [...rootsInIndex(html)];
  const seen = new Map();
  const contributions = new Map();
  while (pending.length) {
    const output = pending.pop();
    if (seen.has(output)) continue;
    const entry = Object.hasOwn(metadata.outputs ?? {}, output) ? metadata.outputs[output] : null;
    if (!Number.isSafeInteger(entry?.bytes) || entry.bytes < 0 || !Array.isArray(entry.imports)) {
      throw new Error(`Missing or invalid build metadata for initial asset: ${output}`);
    }
    seen.set(output, entry.bytes);
    for (const dependency of entry.imports) {
      if (!dependency.external && (dependency.kind === 'import-statement' || dependency.kind === 'import-rule')) {
        pending.push(localOutputPath(dependency.path));
      }
    }
    for (const [input, contribution] of Object.entries(entry.inputs ?? {})) {
      const bytes = contribution?.bytesInOutput;
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`Invalid source size for ${input}`);
      contributions.set(input, (contributions.get(input) ?? 0) + bytes);
    }
  }

  const initialBytes = [...seen.values()].reduce((sum, bytes) => sum + bytes, 0);
  const warningBytes = budgetBytes(budget?.maximumWarning);
  const errorBytes = budgetBytes(budget?.maximumError);
  return {
    initialBytes, warningBytes, errorBytes,
    warningOverageBytes: Math.max(0, initialBytes - warningBytes),
    errorHeadroomBytes: errorBytes - initialBytes,
    assets: [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path, bytes })),
    largestInputs: [...contributions].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15).map(([path, bytes]) => ({ path, bytes })),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node tools/report-initial-renderer.mjs BUILD-OUTPUT-DIRECTORY');
    const directory = resolve(process.argv[2]);
    const angular = JSON.parse(readFileSync(new URL('../angular.json', import.meta.url), 'utf8'));
    const budget = angular.projects.desktop.architect.build.configurations.production.budgets.find(item => item.type === 'initial');
    const browser = join(directory, 'browser');
    const report = initialRendererReport(
      readFileSync(join(browser, 'index.html'), 'utf8'),
      JSON.parse(readFileSync(join(directory, 'browser-stats.json'), 'utf8')), budget,
    );
    for (const asset of report.assets) {
      const file = statSync(join(browser, asset.path));
      if (!file.isFile() || file.size !== asset.bytes) {
        throw new Error(`Build metadata and emitted asset size differ: ${asset.path}`);
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
