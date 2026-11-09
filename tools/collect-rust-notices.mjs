import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_NOTICE_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_NOTICES = 128;
const REVIEWED_LICENSES = new Set([
  'MIT', 'MIT-0', 'Apache-2.0', 'MPL-2.0', 'Unlicense', 'Zlib', 'Unicode-3.0',
  '0BSD', 'ISC', 'CC0-1.0', 'BSD-2-Clause', 'BSD-3-Clause', 'GPL-3.0-only',
]);
const REVIEWED_EXCEPTIONS = new Set(['LLVM-exception']);
const CRATES_IO = new Set([
  'registry+https://github.com/rust-lang/crates.io-index',
  'registry+https://index.crates.io/',
]);

// Validate declarations; do not select a license or assert legal compatibility.
export function assertReviewedLicense(declaration) {
  if (typeof declaration !== 'string' || declaration.length > 512) throw new Error('Missing or oversized license declaration');
  const tokens = declaration.match(/[A-Za-z0-9.+-]+|[()/]/g) ?? [];
  if (tokens.join('') !== declaration.replace(/\s/g, '') || tokens.length > 128) throw new Error('Unsupported license declaration');
  let index = 0;
  function primary(depth) {
    if (depth > 32) throw new Error('License declaration nesting exceeds limit');
    if (tokens[index] === '(') {
      index++;
      expression(depth + 1);
      if (tokens[index++] !== ')') throw new Error('Unbalanced license declaration');
    } else {
      if (!REVIEWED_LICENSES.has(tokens[index++])) throw new Error('Unreviewed license identifier');
      if (tokens[index] === 'WITH') {
        index++;
        if (!REVIEWED_EXCEPTIONS.has(tokens[index++])) throw new Error('Unreviewed license exception');
      }
    }
  }
  function expression(depth) {
    primary(depth);
    while (['AND', 'OR', '/'].includes(tokens[index])) { index++; primary(depth); }
  }
  expression(0);
  if (index !== tokens.length) throw new Error('Unsupported license declaration structure');
}

function within(root, path) {
  const suffix = relative(root, path);
  return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`);
}

function notice(root, path, budget) {
  // Never follow a selected notice or an ancestor into unrelated host files.
  if (!within(root, path) || !within(root, realpathSync(path)) || !lstatSync(path).isFile()) {
    throw new Error('Upstream notice must be an ordinary file inside its package');
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > MAX_NOTICE_BYTES) throw new Error('Upstream notice exceeds its size limit');
    // Bound the read itself too: a file can grow after fstat.
    const buffer = Buffer.alloc(MAX_NOTICE_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const size = readSync(descriptor, buffer, count, buffer.length - count, null);
      if (!size) break;
      count += size;
    }
    if (!count || count > MAX_NOTICE_BYTES) throw new Error('Empty or oversized upstream notice');
    budget.remaining -= count;
    if (budget.remaining < 0) throw new Error('Notice catalog exceeds its size limit');
    bytes = buffer.subarray(0, count);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (bytes.includes(0)) throw new Error('Upstream notice contains binary data');
  } finally { closeSync(descriptor); }
  return {
    file: relative(root, path).split(sep).join('/'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    text: bytes.toString('utf8'),
  };
}

function reviewedNotice(pkg, root, budget, policy, noticeRoot) {
  if (policy.license !== pkg.license || policy.source !== pkg.source || policy.repository !== pkg.repository) {
    throw new Error('Reviewed notice package provenance changed');
  }
  if (!/^[a-f0-9]{40}$/.test(policy.revision) || typeof policy.pathInVcs !== 'string') throw new Error('Reviewed notice needs a pinned revision and VCS path');
  if (policy.repository && policy.upstreamRepository && policy.repository !== policy.upstreamRepository) throw new Error('Reviewed repository cannot override declared provenance');
  const repository = new URL(policy.upstreamRepository ?? policy.repository);
  const repositoryPath = repository.pathname.replace(/(?:\.git)?\/?$/, '');
  let vcs;
  try { vcs = JSON.parse(notice(root, resolve(root, '.cargo_vcs_info.json'), budget).text); }
  catch { throw new Error('Invalid published package VCS metadata'); }
  // Older root-crate VCS records omit path_in_vcs. Never infer a nested path.
  const publishedPath = vcs?.path_in_vcs === undefined ? '' : vcs.path_in_vcs;
  if (vcs?.git?.sha1 !== policy.revision || publishedPath !== policy.pathInVcs) {
    throw new Error('Published package revision differs from reviewed notice');
  }
  if (typeof noticeRoot !== 'string' || !lstatSync(noticeRoot).isDirectory()) throw new Error('Reviewed notice root must be an ordinary directory');
  const retainedRoot = realpathSync(noticeRoot);
  const reviewedUrl = value => {
    const upstream = new URL(value);
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash
        || repository.protocol !== 'https:' || repository.username || repository.password || repository.search || repository.hash
        || upstream.origin !== repository.origin
        || !upstream.pathname.startsWith(`${repositoryPath}/blob/${policy.revision}/`)) {
      throw new Error('Reviewed notice URL must pin its repository and revision');
    }
    return upstream;
  };
  if (policy.kind === 'mpl-source-availability') {
    if (pkg.license !== 'MPL-2.0' || policy.gitBlob !== undefined || policy.upstream !== undefined || policy.notices !== undefined) {
      throw new Error('Project source-availability notices require explicit MPL provenance, not upstream-file identity');
    }
    const proof = policy.sourceEvidence;
    if (!proof || !/^[a-f0-9]{64}$/.test(proof.sha256) || !/^[a-f0-9]{40}$/.test(proof.gitBlob)) throw new Error('Missing reviewed MPL source evidence');
    const upstream = reviewedUrl(proof.upstream);
    const evidence = notice(root, resolve(root, proof.file), budget);
    const bytes = Buffer.from(evidence.text, 'utf8');
    const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (evidence.sha256 !== proof.sha256 || gitBlob !== proof.gitBlob) throw new Error('Reviewed MPL source evidence changed');
    if (!/^\/\* This Source Code Form[\s\S]{0,512}?Mozilla Public[\s\S]{0,512}?License, v\. 2\.0\.[\s\S]{0,512}?https:\/\/mozilla\.org\/MPL\/2\.0\/[\s\S]{0,32}?\*\//.test(evidence.text)) {
      throw new Error('Reviewed source does not carry the expected MPL-2.0 notice');
    }
    const sourceArchive = `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`;
    const licenseUrl = 'https://www.mozilla.org/en-US/MPL/2.0/';
    if (policy.licenseUrl !== licenseUrl || policy.sourceArchive !== sourceArchive || !/^[a-f0-9]{64}$/.test(policy.sha256)) throw new Error('Source-availability locations must identify the exact package and license');
    const retained = notice(retainedRoot, resolve(retainedRoot, policy.file), budget);
    if (retained.sha256 !== policy.sha256) throw new Error('Project source-availability notice hash changed');
    if (![pkg.name, pkg.version, 'MPL-2.0', sourceArchive, licenseUrl].every(value => retained.text.includes(value))) throw new Error('Source-availability notice omits required package or retrieval information');
    return [{ ...retained, kind: policy.kind, authoredByProject: true, sourceArchive, licenseUrl,
      sourceEvidence: { file: proof.file, sha256: proof.sha256, gitBlob: proof.gitBlob, upstream: upstream.href } }];
  }
  if (policy.kind !== undefined && policy.kind !== 'upstream-files') throw new Error('Unreviewed notice exception kind');
  const files = policy.notices ?? [policy];
  if (!Array.isArray(files) || !files.length || files.length > MAX_PACKAGE_NOTICES
      || new Set(files.map(file => file.file)).size !== files.length) throw new Error('Invalid reviewed notice file list');
  return files.map(file => {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !/^[a-f0-9]{40}$/.test(file.gitBlob)) throw new Error('Reviewed notice needs pinned hashes');
    const upstream = reviewedUrl(file.upstream);
    const retained = notice(retainedRoot, resolve(retainedRoot, file.file), budget);
    const bytes = Buffer.from(retained.text, 'utf8');
    const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (retained.sha256 !== file.sha256 || gitBlob !== file.gitBlob) throw new Error('Reviewed upstream notice hash changed');
    return { ...retained, upstream: upstream.href, revision: policy.revision, omittedFromPublishedCrate: true };
  });
}

function packageNotices(pkg, budget, policy, noticeRoot) {
  if (!lstatSync(pkg.manifest_path).isFile()) throw new Error('Package manifest must be an ordinary file');
  const root = realpathSync(dirname(pkg.manifest_path));
  const paths = new Set();
  let entries = 0;
  function add(path, depth = 0) {
    if (++entries > 512) throw new Error('Too many upstream notice entries');
    if (!within(root, path) || !within(root, realpathSync(path))) throw new Error('Upstream notice escapes its package');
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) throw new Error('Linked upstream notices are not supported');
    if (metadata.isDirectory()) {
      if (depth >= 3) throw new Error('Upstream notice directory nesting exceeds limit');
      for (const entry of readdirSync(path).sort()) add(resolve(path, entry), depth + 1);
    } else if (metadata.isFile()) {
      paths.add(path);
      if (paths.size > MAX_PACKAGE_NOTICES) throw new Error('Too many upstream notice files');
    } else throw new Error('Special upstream notice file is not supported');
  }
  for (const entry of readdirSync(root).sort()) {
    if (/^(?:licen[cs]e|copying|copyright|notice)(?:$|[._-]|s$)/i.test(entry)) add(resolve(root, entry));
  }
  if (pkg.license_file) add(resolve(root, pkg.license_file));
  if (!paths.size) {
    if (policy) return reviewedNotice(pkg, root, budget, policy, noticeRoot);
    throw new Error('No upstream license or notice files were found');
  }
  if (policy) throw new Error('Reviewed notice exception no longer matches a missing-notice package');
  return [...paths].sort().map(path => notice(root, path, budget));
}

/** Conservative normal/build closure, including proc-macro tooling. Not an artifact SBOM. */
export function collectRustNotices(metadata, { rootPackage, target, reviewedNotices = [], noticeRoot }) {
  if (!target || !/^[A-Za-z0-9_.-]+$/.test(target)) throw new Error('An explicit metadata target is required');
  if (!Array.isArray(metadata.packages) || !Array.isArray(metadata.resolve?.nodes)
      || !Array.isArray(metadata.workspace_members)) throw new Error('Incomplete Cargo metadata');
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  if (packages.size !== metadata.packages.length || nodes.size !== metadata.resolve.nodes.length) throw new Error('Duplicate Cargo metadata identifiers');
  const owned = new Set(metadata.workspace_members);
  const roots = metadata.packages.filter(pkg => owned.has(pkg.id) && pkg.name === rootPackage);
  if (roots.length !== 1) throw new Error('Select exactly one workspace root package');
  const queue = [roots[0].id], seen = new Set(), result = [];
  if (!Array.isArray(reviewedNotices)) throw new Error('Reviewed notices must be an explicit list');
  const policies = new Map(reviewedNotices.map(policy => [`${policy.name}@${policy.version}`, policy]));
  if (policies.size !== reviewedNotices.length) throw new Error('Duplicate reviewed notice exceptions');
  const budget = { remaining: 32 * 1024 * 1024 };
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const pkg = packages.get(id), node = nodes.get(id);
    if (!pkg || !node || !Array.isArray(node.deps)) throw new Error('Incomplete dependency closure');
    for (const dependency of node.deps) {
      if (!Array.isArray(dependency.dep_kinds)) throw new Error('Missing dependency-kind metadata');
      if (dependency.dep_kinds.some(kind => kind.kind === null || kind.kind === 'build')) queue.push(dependency.pkg);
    }
    if (owned.has(id)) continue;
    const identityValid = typeof pkg.name === 'string' && typeof pkg.version === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(pkg.name)
      && /^\d+\.\d+\.\d+[A-Za-z0-9.+-]*$/.test(pkg.version);
    try {
      if (!identityValid) throw new Error('Unsupported package identity');
      if (!CRATES_IO.has(pkg.source)) throw new Error('Unreviewed package source');
      assertReviewedLicense(pkg.license);
      result.push({
        name: pkg.name, version: pkg.version, license: pkg.license,
        source: `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`,
        notices: packageNotices(pkg, budget, policies.get(`${pkg.name}@${pkg.version}`), noticeRoot),
      });
    } catch (error) {
      // Do not echo unreviewed URLs, absolute paths, or file contents.
      const label = identityValid ? `${pkg.name}@${pkg.version}` : 'invalid package identity';
      throw new Error(`Cannot collect upstream notices for ${label}: ${error.code ?? error.message}`);
    }
  }
  result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
  return {
    schemaVersion: 1, target, rootPackage,
    scope: 'Conservative Cargo normal/build dependency closure; includes build/proc-macro tooling; not an exact linked-artifact SBOM or legal approval.',
    packages: result,
  };
}
