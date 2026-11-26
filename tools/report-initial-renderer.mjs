import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

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

const workspaceEntryPoint = 'apps/desktop/src/app/app.component.ts';

function buildOutput(metadata, output) {
  const entry = Object.hasOwn(metadata.outputs ?? {}, output) ? metadata.outputs[output] : null;
  if (!Number.isSafeInteger(entry?.bytes) || entry.bytes < 0 || !Array.isArray(entry.imports)) {
    throw new Error(`Missing or invalid build metadata for initial asset: ${output}`);
  }
  return entry;
}

function staticImports(entry) {
  return entry.imports
    .filter(dependency => !dependency.external && (dependency.kind === 'import-statement' || dependency.kind === 'import-rule'))
    .map(dependency => localOutputPath(dependency.path));
}

function workspaceStartupReport(metadata, initial) {
  // StartupComponent loads AppComponent immediately via a dynamic import.
  // Follow that one known boundary and then static edges only. Do not count
  // optional feature chunks or describe these offline bytes as paint timing.
  const roots = new Set();
  for (const output of initial.keys()) {
    for (const dependency of buildOutput(metadata, output).imports) {
      if (dependency.external || dependency.kind !== 'dynamic-import') continue;
      const path = localOutputPath(dependency.path);
      if (metadata.outputs[path]?.entryPoint === workspaceEntryPoint) roots.add(path);
    }
  }
  if (!roots.size) return undefined;
  if (roots.size > 1) throw new Error('Found multiple workspace startup entry chunks.');
  const [entry] = roots;
  const pending = [entry];
  const additional = new Map();
  while (pending.length) {
    const path = pending.pop();
    if (initial.has(path) || additional.has(path)) continue;
    const output = buildOutput(metadata, path);
    additional.set(path, output.bytes);
    pending.push(...staticImports(output));
  }
  const additionalAssets = [...additional].sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bytes]) => ({ path, bytes }));
  const additionalBytes = additionalAssets.reduce((sum, asset) => sum + asset.bytes, 0);
  return { entry, additionalBytes, additionalAssets };
}

// Include exactly the emitted entry files and their static import graph.
// Assets behind a dynamic import don't contribute unless the index eagerly
// preloads them or another initial file also statically imports them.
export function initialRendererReport(html, metadata, budget) {
  const pending = [...rootsInIndex(html)];
  const seen = new Map();
  const contributions = new Map();
  const outputsOverAttributed = [];
  while (pending.length) {
    const output = pending.pop();
    if (seen.has(output)) continue;
    const entry = buildOutput(metadata, output);
    seen.set(output, entry.bytes);
    pending.push(...staticImports(entry));
    let metadataInputBytes = 0;
    for (const [input, contribution] of Object.entries(entry.inputs ?? {})) {
      const bytes = contribution?.bytesInOutput;
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`Invalid source size for ${input}`);
      metadataInputBytes += bytes;
      contributions.set(input, (contributions.get(input) ?? 0) + bytes);
    }
    if (metadataInputBytes > entry.bytes) {
      outputsOverAttributed.push({ path: output, emittedBytes: entry.bytes, metadataInputBytes });
    }
  }

  const initialBytes = [...seen.values()].reduce((sum, bytes) => sum + bytes, 0);
  const warningBytes = budgetBytes(budget?.maximumWarning);
  const errorBytes = budgetBytes(budget?.maximumError);
  const workspace = workspaceStartupReport(metadata, seen);
  return {
    initialBytes, warningBytes, errorBytes,
    ...(workspace ? { workspaceStartup: { ...workspace, totalBytes: initialBytes + workspace.additionalBytes } } : {}),
    warningOverageBytes: Math.max(0, initialBytes - warningBytes),
    errorHeadroomBytes: errorBytes - initialBytes,
    assets: [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path, bytes })),
    // Angular's stats can assign more bytes to inputs than exist in the
    // emitted file. Use those numbers for ranking, never for budget accounting.
    inputAttribution: {
      kind: 'unverified-bundler-metadata',
      outputsOverAttributed: outputsOverAttributed.sort((a, b) => a.path.localeCompare(b.path)),
      largestInputs: [...contributions].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 15).map(([path, metadataInputBytes]) => ({ path, metadataInputBytes })),
    },
  };
}

function readRendererBuild(directory, budget) {
  const browser = join(directory, 'browser');
  const report = initialRendererReport(
    readFileSync(join(browser, 'index.html'), 'utf8'),
    JSON.parse(readFileSync(join(directory, 'browser-stats.json'), 'utf8')), budget,
  );
  for (const asset of [...report.assets, ...(report.workspaceStartup?.additionalAssets ?? [])]) {
    const file = statSync(join(browser, asset.path));
    if (!file.isFile() || file.size !== asset.bytes) {
      throw new Error(`Build metadata and emitted asset size differ: ${asset.path}`);
    }
  }
  return { browser, report };
}

function measureAssets(browser, assets) {
  const sizes = { bytes: 0, javascriptBytes: 0, stylesheetBytes: 0, gzipBytes: 0, brotliBytes: 0 };
  for (const asset of assets) {
    const data = readFileSync(join(browser, asset.path));
    if (data.length !== asset.bytes) throw new Error(`Build asset changed while being measured: ${asset.path}`);
    sizes.bytes += data.length;
    if (/\.(?:m?js)$/.test(asset.path)) sizes.javascriptBytes += data.length;
    else if (asset.path.endsWith('.css')) sizes.stylesheetBytes += data.length;
    sizes.gzipBytes += gzipSync(data, { level: 9 }).length;
    sizes.brotliBytes += brotliCompressSync(data).length;
  }
  return sizes;
}

function measureRendererBuild(directory, budget) {
  const { browser, report } = readRendererBuild(directory, budget);
  const { bytes: initialBytes, ...encodings } = measureAssets(browser, report.assets);
  let workspace = null;
  if (report.workspaceStartup) {
    const { bytes, ...additional } = measureAssets(browser, report.workspaceStartup.additionalAssets);
    workspace = { totalBytes: initialBytes + bytes, additionalBytes: bytes,
      ...Object.fromEntries(Object.keys(encodings).map(key => [key, encodings[key] + additional[key]])) };
  }
  return { initial: { initialBytes, ...encodings }, workspace };
}

function difference(baseline, candidate) {
  return Object.fromEntries(Object.keys(baseline).map(key => [key, candidate[key] - baseline[key]]));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    const compare = args.length === 3 && args[0] === '--compare' && args.slice(1).every(arg => !arg.startsWith('--'));
    const enforceWarning = args.length === 3 && args[1] === '--record' && args[2] === '--enforce-warning';
    const record = enforceWarning || (args.length === 2 && args[1] === '--record');
    if (!compare && ((!record && args.length !== 1) || args[0].startsWith('--'))) {
      throw new Error('Usage: node tools/report-initial-renderer.mjs BUILD-OUTPUT-DIRECTORY [--record [--enforce-warning]]\n'
        + '   or: node tools/report-initial-renderer.mjs --compare BASELINE-DIRECTORY CANDIDATE-DIRECTORY');
    }
    const angular = JSON.parse(readFileSync(new URL('../angular.json', import.meta.url), 'utf8'));
    const budget = angular.projects.desktop.architect.build.configurations.production.budgets.find(item => item.type === 'initial');
    if (compare) {
      const before = measureRendererBuild(resolve(args[1]), budget);
      const after = measureRendererBuild(resolve(args[2]), budget);
      const baseline = before.initial;
      const candidate = after.initial;
      const workspaceStartup = before.workspace || after.workspace ? {
        baseline: before.workspace,
        candidate: after.workspace,
        delta: before.workspace && after.workspace ? difference(before.workspace, after.workspace) : null,
      } : undefined;
      console.log(JSON.stringify({ baseline, candidate, delta: difference(baseline, candidate),
        workspaceStartup, warningBytes: budgetBytes(budget.maximumWarning),
        errorBytes: budgetBytes(budget.maximumError) }, null, 2));
    } else {
      const directory = resolve(args[0]);
      const { report } = readRendererBuild(directory, budget);
      const json = JSON.stringify(report, null, 2);
      if (!record) console.log(json);
      else recordRendererReport(directory, report, json);
      if (enforceWarning && report.warningOverageBytes > 0) {
        throw new Error(`Initial renderer exceeds its warning budget by ${report.warningOverageBytes} bytes. See initial-renderer.json for the eager assets.`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function recordRendererReport(directory, report, json) {
  // Keep diagnostics beside the production browser directory, not inside
  // Tauri's packaged assets. Do not leave a partial report on write failure.
  const destination = join(directory, 'initial-renderer.json');
  const temporary = mkdtempSync(join(directory, '.initial-renderer-'));
  try {
    const staged = join(temporary, 'report.json');
    writeFileSync(staged, json + '\n');
    renameSync(staged, destination);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  if (report.workspaceStartup) console.log(`Workspace startup assets: ${report.workspaceStartup.totalBytes} bytes including the initial renderer; ${report.workspaceStartup.additionalBytes} bytes loaded after bootstrap.`);
  console.log(`Initial renderer: ${report.initialBytes} bytes (${report.warningOverageBytes} over warning, ${report.errorHeadroomBytes} error headroom). Report: ${destination}`);
}
