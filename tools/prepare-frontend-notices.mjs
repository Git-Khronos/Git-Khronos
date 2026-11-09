import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { assertReviewedLicense } from './collect-rust-notices.mjs';

const MAX_BYTES = 2 * 1024 * 1024;

function noticeBytes(file) {
  let descriptor;
  try {
    if (!lstatSync(file).isFile()) throw new Error('Expected an ordinary generated notice file');
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) throw new Error('Generated notices exceed the size limit');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const size = readSync(descriptor, buffer, count, buffer.length - count, null);
      if (!size) break;
      count += size;
    }
    if (!count || count > MAX_BYTES) throw new Error('Empty or oversized generated notices');
    const bytes = buffer.subarray(0, count);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (bytes.includes(0)) throw new Error('Generated notices contain binary data');
    return Buffer.from(bytes);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function verifyIdentity(bytes, sha256, gitBlob) {
  if (!/^[a-f0-9]{64}$/.test(sha256) || !/^[a-f0-9]{40}$/.test(gitBlob)
      || createHash('sha256').update(bytes).digest('hex') !== sha256
      || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== gitBlob) {
    throw new Error('Reviewed frontend notice identity changed');
  }
}

function dialogSupplement(repositoryRoot, packages, licenses) {
  const retainedRoot = join(repositoryRoot, 'packaging/licenses');
  const policy = JSON.parse(noticeBytes(join(retainedRoot, 'reviewed-frontend-notices.json')));
  if (policy.name !== '@tauri-apps/plugin-dialog' || policy.repository !== 'https://github.com/tauri-apps/plugins-workspace'
      || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(policy.version) || !/^[a-f0-9]{40}$/.test(policy.revision)
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(policy.integrity)
      || policy.sourceArchive !== `https://registry.npmjs.org/@tauri-apps/plugin-dialog/-/plugin-dialog-${policy.version}.tgz`) {
    throw new Error('Unreviewed frontend notice provenance');
  }
  const indices = packages.flatMap(([_, name], index) => name === policy.name ? [index] : []);
  if (indices.length !== 1 || JSON.parse(licenses[indices[0]][1]) !== policy.license) throw new Error('Reviewed package no longer matches generated notices');
  const packageRoot = join(repositoryRoot, 'node_modules/@tauri-apps/plugin-dialog');
  const manifestBytes = noticeBytes(join(packageRoot, 'package.json'));
  const manifest = JSON.parse(manifestBytes);
  if (['name', 'version', 'license', 'repository'].some(key => manifest[key] !== policy[key])) throw new Error('Reviewed package manifest changed');
  verifyIdentity(manifestBytes, policy.manifestSha256, policy.manifestGitBlob);
  const upstreamRoot = `${policy.repository}/blob/${policy.revision}/`;
  if (policy.manifestUpstream !== `${upstreamRoot}plugins/dialog/package.json`) throw new Error('Unpinned frontend manifest source');
  const published = readdirSync(packageRoot).filter(name => /^(license|copying|copyright|notice)(?:$|[._-])/i.test(name)).sort();
  if (published.length !== 1 || published[0] !== 'LICENSE.spdx') throw new Error('Reviewed missing-terms exception is stale');
  verifyIdentity(noticeBytes(join(packageRoot, 'LICENSE.spdx')), policy.publishedNoticeSha256, policy.publishedNoticeGitBlob);
  // This intentionally pins the reviewed pnpm lock entry, not a permissive
  // general YAML parser. A lock-format change requires renewed review too.
  const lines = noticeBytes(join(repositoryRoot, 'pnpm-lock.yaml')).toString('utf8').split(/\r?\n/);
  const key = `  '${policy.name}@${policy.version}':`;
  const resolution = `    resolution: {integrity: ${policy.integrity}}`;
  if (lines.filter((line, index) => line === key && lines[index + 1] === resolution).length !== 1) throw new Error('Reviewed registry integrity differs from lock');
  if (!Array.isArray(policy.notices) || policy.notices.length !== 2
      || new Set(policy.notices.map(file => file.file)).size !== 2) throw new Error('Both reviewed upstream license files are required');
  const parts = [Buffer.from(`\n\nReviewed upstream license supplement for ${policy.name} ${policy.version}\nSource: ${policy.sourceArchive}\nIntegrity: ${policy.integrity}\nRevision: ${policy.revision}\n`)];
  for (const file of policy.notices) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]+$/.test(file.file) || ![`${upstreamRoot}LICENSE_MIT`, `${upstreamRoot}LICENSE_APACHE-2.0`].includes(file.upstream)) throw new Error('Unpinned frontend notice source');
    const bytes = noticeBytes(join(retainedRoot, file.file));
    verifyIdentity(bytes, file.sha256, file.gitBlob);
    parts.push(Buffer.from(`\nUpstream: ${file.upstream}\nSHA-256: ${file.sha256}\n\n`), bytes, Buffer.from('\n'));
  }
  if (new Set(policy.notices.map(file => file.upstream)).size !== 2) throw new Error('Repeated upstream notice');
  return parts;
}

/** Preserve generated bytes plus explicitly reviewed supplements, not legal approval. */
export function prepareFrontendNotices(file, { repositoryRoot } = {}) {
  try {
    const bytes = noticeBytes(file);
    const text = bytes.toString('utf8');
    const packages = [...text.matchAll(/^Package: ([^\r\n]+)\r?$/gm)];
    const licenses = [...text.matchAll(/^License: ([^\r\n]+)\r?$/gm)];
    if (!packages.length || packages.length !== licenses.length) throw new Error('Missing generated package/license records');
    for (const [, license] of licenses) assertReviewedLicense(JSON.parse(license));
    const parts = [bytes, ...(repositoryRoot ? dialogSupplement(repositoryRoot, packages, licenses) : [])];
    if (parts.reduce((size, part) => size + part.length, 0) > MAX_BYTES) throw new Error('Frontend notice payload exceeds limit');
    return gzipSync(Buffer.concat(parts), { level: 9 });
  } catch (error) {
    // Do not expose an unknown filename, malformed text or license declaration.
    throw new Error(`Cannot prepare generated frontend notices: ${error.code ?? 'missing, invalid or unreviewed notice data'}`);
  }
}
