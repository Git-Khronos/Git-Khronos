import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertReviewedLicense, collectRustNotices } from './collect-rust-notices.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'git-khronos-notice-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const metadata = { workspace_members: ['app'], packages: [{ id: 'app', name: 'desktop' }], resolve: { nodes: [{ id: 'app', deps: [] }] } };
  function add(name, { license = 'MIT', source = 'registry+https://github.com/rust-lang/crates.io-index', kind = null, text = 'Copyright fixture contributors\r\nMIT fixture terms.\n' } = {}) {
    const directory = join(root, name);
    mkdirSync(directory);
    const manifest = join(directory, 'Cargo.toml');
    writeFileSync(manifest, '[package]\n');
    if (text !== null) writeFileSync(join(directory, 'LICENSE'), text);
    const pkg = { id: name, name, version: '1.2.3', license, source, manifest_path: manifest };
    metadata.packages.push(pkg);
    metadata.resolve.nodes.push({ id: name, deps: [] });
    metadata.resolve.nodes[0].deps.push({ pkg: name, dep_kinds: [{ kind }] });
    return { pkg, directory };
  }
  const collect = () => collectRustNotices(metadata, { rootPackage: 'desktop', target: 'x86_64-unknown-linux-gnu' });
  return { root, metadata, add, collect };
}

test('collects exact upstream bytes, hashes and pinned source locations deterministically', t => {
  const f = fixture(t);
  f.add('zebra');
  const text = 'Copyright owned fixture\r\nPermission terms\n';
  const { directory } = f.add('alpha', { text });
  writeFileSync(join(directory, 'NOTICE'), 'Additional upstream attribution\n');
  const result = f.collect();
  assert.deepEqual(result.packages.map(p => p.name), ['alpha', 'zebra']);
  const first = result.packages[0];
  assert.equal(first.source, 'https://static.crates.io/crates/alpha/alpha-1.2.3.crate');
  assert.equal(first.notices[0].text, text);
  assert.equal(first.notices[0].sha256, createHash('sha256').update(text).digest('hex'));
  assert.equal(first.notices.length, 2);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(f.root));
  assert.deepEqual(f.collect(), result);
  assert.match(result.scope, /not an exact linked-artifact SBOM or legal approval/);
});

test('includes normal/build and proc-macro dependency edges but excludes dev-only edges', t => {
  const f = fixture(t);
  f.add('normal');
  f.add('builder', { kind: 'build' });
  f.add('dev', { kind: 'dev', license: 'Unknown-License', text: null });
  f.add('macro');
  f.metadata.resolve.nodes[0].deps.push({ pkg: 'normal', dep_kinds: [{ kind: null }] });
  assert.deepEqual(f.collect().packages.map(p => p.name), ['builder', 'macro', 'normal']);
});

test('fails closed on missing, malformed, or unreviewed license declarations', () => {
  for (const license of [null, '', 'Unknown-License', 'MIT AND', '(MIT', 'MIT Apache-2.0', 'MIT WITH Unknown-exception', 'MIT; secret']) {
    assert.throws(() => assertReviewedLicense(license));
  }
  for (const license of ['MIT/Apache-2.0', 'Apache-2.0 / MIT', '(MIT OR Apache-2.0) AND Unicode-3.0', 'Apache-2.0 WITH LLVM-exception OR MIT']) {
    assert.doesNotThrow(() => assertReviewedLicense(license));
  }
});

test('never substitutes a license identifier for missing upstream terms', t => {
  const f = fixture(t);
  f.add('missing', { text: null });
  assert.throws(f.collect, /No upstream license or notice files/);
});

test('rejects unreviewed registries without exposing embedded credentials', t => {
  const f = fixture(t);
  f.add('private', { source: 'registry+https://user:fixture-secret@example.test/index' });
  assert.throws(f.collect, error => /Unreviewed package source/.test(error.message) && !error.message.includes('fixture-secret'));
});

test('includes declared nested license files and rejects parent-directory escapes', t => {
  const f = fixture(t);
  const { pkg, directory } = f.add('nested', { text: null });
  mkdirSync(join(directory, 'legal'));
  writeFileSync(join(directory, 'legal', 'terms.txt'), 'Declared upstream terms\n');
  pkg.license_file = 'legal/terms.txt';
  assert.equal(f.collect().packages[0].notices[0].file, 'legal/terms.txt');
  const outside = join(f.root, 'outside-secret');
  writeFileSync(outside, 'Do not copy fixture secret\n');
  pkg.license_file = '../outside-secret';
  assert.throws(f.collect, /escapes its package/);
});

test('rejects notice-file and ancestor symlinks', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const { pkg, directory } = f.add('linked', { text: null });
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret'), 'Owned secret sentinel\n');
  symlinkSync(join(outside, 'secret'), join(directory, 'LICENSE'));
  assert.throws(f.collect, /escapes its package/);
  rmSync(join(directory, 'LICENSE'));
  symlinkSync(outside, join(directory, 'legal'));
  pkg.license_file = 'legal/secret';
  assert.throws(f.collect, /escapes its package/);
});

test('rejects oversized, empty, binary and invalid UTF-8 notice files', t => {
  const f = fixture(t);
  const { directory } = f.add('bad');
  const path = join(directory, 'LICENSE');
  for (const bytes of [Buffer.alloc(0), Buffer.from([0]), Buffer.from([0xff])]) {
    writeFileSync(path, bytes);
    assert.throws(f.collect);
  }
  const descriptor = openSync(path, 'w');
  try { ftruncateSync(descriptor, 2 * 1024 * 1024 + 1); } finally { closeSync(descriptor); }
  assert.throws(f.collect, /size limit/);
});

test('rejects missing dependency nodes, duplicate identifiers and missing explicit target', t => {
  const f = fixture(t);
  f.add('one');
  assert.throws(() => collectRustNotices(f.metadata, { rootPackage: 'desktop' }), /explicit metadata target/);
  f.metadata.resolve.nodes.pop();
  assert.throws(f.collect, /Incomplete dependency closure/);
  f.metadata.packages.push(f.metadata.packages[1]);
  assert.throws(f.collect, /Duplicate Cargo metadata identifiers/);
});

function reviewedFixture(t) {
  const f = fixture(t);
  const { pkg, directory } = f.add('omitted', { text: null });
  pkg.repository = 'https://github.com/example/owned-fixture';
  const revision = 'a'.repeat(40);
  writeFileSync(join(directory, '.cargo_vcs_info.json'), JSON.stringify({ git: { sha1: revision }, path_in_vcs: '' }));
  const noticeRoot = join(f.root, 'retained');
  mkdirSync(noticeRoot);
  const text = 'Copyright owned fixture contributor\nReviewed fixture license terms\n';
  writeFileSync(join(noticeRoot, 'omitted-LICENSE'), text);
  const policy = {
    name: pkg.name, version: pkg.version, license: pkg.license, source: pkg.source, repository: pkg.repository,
    revision, pathInVcs: '', upstream: `${pkg.repository}/blob/${revision}/LICENSE`, file: 'omitted-LICENSE',
    sha256: createHash('sha256').update(text).digest('hex'),
    gitBlob: createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex'),
  };
  const collect = () => collectRustNotices(f.metadata, { rootPackage: 'desktop', target: 'x86_64-unknown-linux-gnu', reviewedNotices: [policy], noticeRoot });
  return { ...f, pkg, directory, noticeRoot, policy, text, collect };
}

test('uses only explicitly reviewed exact-version upstream terms with matching VCS and hashes', t => {
  const f = reviewedFixture(t);
  const retained = f.collect().packages[0].notices[0];
  assert.equal(retained.text, f.text);
  assert.equal(retained.omittedFromPublishedCrate, true);
  assert.equal(retained.upstream, f.policy.upstream);
  assert.equal(retained.revision, f.policy.revision);
});

test('reviewed notices cannot apply to another version or changed license/source/repository', t => {
  const f = reviewedFixture(t);
  for (const [key, value] of [['version', '9.0.0'], ['license', 'Apache-2.0'], ['source', 'registry+https://index.crates.io/'], ['repository', 'https://github.com/example/other']]) {
    const original = f.policy[key];
    f.policy[key] = value;
    assert.throws(f.collect, key === 'version' ? /No upstream license/ : /provenance changed/);
    f.policy[key] = original;
  }
});

test('rejects changed published VCS revisions and unpinned upstream notice URLs', t => {
  const f = reviewedFixture(t);
  writeFileSync(join(f.directory, '.cargo_vcs_info.json'), JSON.stringify({ git: { sha1: 'b'.repeat(40) }, path_in_vcs: '' }));
  assert.throws(f.collect, /revision differs/);
  f.policy.upstream = `${f.pkg.repository}/blob/main/LICENSE`;
  writeFileSync(join(f.directory, '.cargo_vcs_info.json'), JSON.stringify({ git: { sha1: f.policy.revision }, path_in_vcs: '' }));
  assert.throws(f.collect, /must pin its repository and revision/);
});

test('rejects other notice repositories and never echoes malformed VCS content', t => {
  const f = reviewedFixture(t);
  const original = f.policy.upstream;
  f.policy.upstream = `https://example.test/other/blob/${f.policy.revision}/LICENSE`;
  assert.throws(f.collect, /must pin its repository and revision/);
  f.policy.upstream = original;
  writeFileSync(join(f.directory, '.cargo_vcs_info.json'), '{fixture-secret-token: invalid json}');
  assert.throws(f.collect, error => /Invalid published package VCS metadata/.test(error.message)
    && !error.message.includes('fixture-secret'));
});

test('rejects edited retained notice bytes and incorrect Git blob provenance', t => {
  const f = reviewedFixture(t);
  writeFileSync(join(f.noticeRoot, f.policy.file), `${f.text}edited\n`);
  assert.throws(f.collect, /hash changed/);
  writeFileSync(join(f.noticeRoot, f.policy.file), f.text);
  f.policy.gitBlob = 'c'.repeat(40);
  assert.throws(f.collect, /hash changed/);
});

test('does not let a reviewed exception hide newly supplied package notice files', t => {
  const f = reviewedFixture(t);
  writeFileSync(join(f.directory, 'LICENSE'), f.text);
  assert.throws(f.collect, /exception no longer matches/);
});

test('preserves every explicitly reviewed upstream notice for dual-license packages', t => {
  const f = reviewedFixture(t);
  const extra = 'Additional owned fixture terms\n';
  writeFileSync(join(f.noticeRoot, 'second-LICENSE'), extra);
  f.policy.notices = [
    { file: f.policy.file, sha256: f.policy.sha256, gitBlob: f.policy.gitBlob, upstream: f.policy.upstream },
    { file: 'second-LICENSE', sha256: createHash('sha256').update(extra).digest('hex'),
      gitBlob: createHash('sha1').update(`blob ${Buffer.byteLength(extra)}\0`).update(extra).digest('hex'),
      upstream: `${f.pkg.repository}/blob/${f.policy.revision}/SECOND-LICENSE` },
  ];
  assert.deepEqual(f.collect().packages[0].notices.map(n => n.text), [f.text, extra]);
  f.policy.notices.push(f.policy.notices[0]);
  assert.throws(f.collect, /Invalid reviewed notice file list/);
});

test('old root VCS records cannot silently authorize a nested source path', t => {
  const f = reviewedFixture(t);
  writeFileSync(join(f.directory, '.cargo_vcs_info.json'), JSON.stringify({ git: { sha1: f.policy.revision } }));
  assert.equal(f.collect().packages[0].notices.length, 1);
  f.policy.pathInVcs = 'nested';
  assert.throws(f.collect, /revision differs/);
});

test('missing repository metadata requires an explicit reviewed upstream and cannot replace a declared repository', t => {
  const f = reviewedFixture(t);
  f.policy.upstreamRepository = f.pkg.repository;
  f.pkg.repository = null;
  f.policy.repository = null;
  assert.equal(f.collect().packages[0].notices.length, 1);
  delete f.policy.upstreamRepository;
  assert.throws(f.collect);
  f.pkg.repository = 'https://github.com/example/declared';
  f.policy.repository = f.pkg.repository;
  f.policy.upstreamRepository = 'https://github.com/example/different';
  assert.throws(f.collect, /cannot override declared provenance/);
});

function mplFixture(t) {
  const f = reviewedFixture(t);
  const source = '/* This Source Code Form is subject to the terms of the Mozilla Public\n'
    + ' * License, v. 2.0. If a copy of the MPL was not distributed with this\n'
    + ' * file, You can obtain one at https://mozilla.org/MPL/2.0/. */\n'
    + '// Owned synthetic implementation sentinel, not for notice output.\n';
  f.pkg.license = f.policy.license = 'MPL-2.0';
  f.policy.kind = 'mpl-source-availability';
  delete f.policy.gitBlob;
  delete f.policy.upstream;
  f.policy.sourceArchive = `https://static.crates.io/crates/${f.pkg.name}/${f.pkg.name}-${f.pkg.version}.crate`;
  f.policy.licenseUrl = 'https://www.mozilla.org/en-US/MPL/2.0/';
  f.policy.sourceEvidence = {
    file: 'lib.rs', upstream: `${f.pkg.repository}/blob/${f.policy.revision}/lib.rs`,
    sha256: createHash('sha256').update(source).digest('hex'),
    gitBlob: createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex'),
  };
  writeFileSync(join(f.directory, 'lib.rs'), source);
  const text = `${f.pkg.name} ${f.pkg.version} MPL-2.0\n${f.policy.sourceArchive}\n${f.policy.licenseUrl}\nProject-authored source availability notice.\n`;
  writeFileSync(join(f.noticeRoot, f.policy.file), text);
  f.policy.sha256 = createHash('sha256').update(text).digest('hex');
  return { ...f, source, text };
}

test('MPL source-availability output is project-authored and never copies implementation evidence', t => {
  const f = mplFixture(t);
  const result = f.collect();
  const retained = result.packages[0].notices[0];
  assert.equal(retained.authoredByProject, true);
  assert.equal(retained.kind, 'mpl-source-availability');
  assert.equal(retained.text, f.text);
  assert.deepEqual(retained.sourceEvidence, f.policy.sourceEvidence);
  assert.equal(retained.upstream, undefined);
  assert.equal(retained.omittedFromPublishedCrate, undefined);
  assert.doesNotMatch(JSON.stringify(result), /synthetic implementation sentinel/);
});

test('MPL source availability rejects false upstream identities and wrong package/archive/license provenance', t => {
  const f = mplFixture(t);
  for (const [key, value] of [
    ['gitBlob', 'b'.repeat(40)], ['upstream', 'https://example.test/LICENSE'],
    ['notices', []], ['licenseUrl', 'https://example.test/MPL'],
    ['sourceArchive', 'https://static.crates.io/crates/other/other-1.0.0.crate'],
    ['sha256', 'b'.repeat(64)], ['kind', 'unreviewed-fallback'],
  ]) {
    const old = f.policy[key];
    f.policy[key] = value;
    assert.throws(f.collect, undefined, key);
    if (old === undefined) delete f.policy[key]; else f.policy[key] = old;
  }
  f.pkg.license = f.policy.license = 'MIT';
  assert.throws(f.collect, /explicit MPL provenance/);
});

test('MPL evidence requires exact source bytes, Git identity and a real license header', t => {
  const f = mplFixture(t);
  for (const key of ['sha256', 'gitBlob', 'upstream']) {
    const old = f.policy.sourceEvidence[key];
    f.policy.sourceEvidence[key] = key === 'upstream' ? `${f.pkg.repository}/blob/main/lib.rs` : 'b'.repeat(old.length);
    assert.throws(f.collect);
    f.policy.sourceEvidence[key] = old;
  }
  writeFileSync(join(f.directory, 'lib.rs'), `${f.source}changed\n`);
  assert.throws(f.collect, /source evidence changed/);
  const unlicensed = '// Owned fixture without a license header.\n';
  writeFileSync(join(f.directory, 'lib.rs'), unlicensed);
  f.policy.sourceEvidence.sha256 = createHash('sha256').update(unlicensed).digest('hex');
  f.policy.sourceEvidence.gitBlob = createHash('sha1').update(`blob ${Buffer.byteLength(unlicensed)}\0`).update(unlicensed).digest('hex');
  assert.throws(f.collect, /expected MPL-2.0 notice/);
});

test('MPL notice must retain retrieval information even when its new hash matches', t => {
  const f = mplFixture(t);
  for (const value of [f.policy.sourceArchive, f.policy.licenseUrl, 'MPL-2.0', f.pkg.name, f.pkg.version]) {
    const text = f.text.replaceAll(value, '[omitted]');
    writeFileSync(join(f.noticeRoot, f.policy.file), text);
    f.policy.sha256 = createHash('sha256').update(text).digest('hex');
    assert.throws(f.collect, /omits required package or retrieval information/);
  }
});

test('checked-in reviewed notice files retain their exact upstream identities', () => {
  const policies = JSON.parse(readFileSync(new URL('../packaging/licenses/reviewed-rust-notices.json', import.meta.url), 'utf8'));
  assert.equal(new Set(policies.map(p => `${p.name}@${p.version}`)).size, policies.length);
  for (const policy of policies) {
    assertReviewedLicense(policy.license);
    assert.match(policy.revision, /^[a-f0-9]{40}$/);
    for (const file of policy.notices ?? [policy]) {
      assert.match(file.file, /^[A-Za-z0-9_.-]+$/);
      const bytes = readFileSync(new URL(`../packaging/licenses/${file.file}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.file);
      if (policy.kind === 'mpl-source-availability') {
        assert.equal(policy.license, 'MPL-2.0');
        assert.equal(file.upstream, undefined);
        assert.equal(file.gitBlob, undefined);
        assert.ok(policy.sourceEvidence.upstream.includes(`/blob/${policy.revision}/`));
        assert.match(policy.sourceEvidence.sha256, /^[a-f0-9]{64}$/);
        assert.match(policy.sourceEvidence.gitBlob, /^[a-f0-9]{40}$/);
        assert.ok(bytes.toString('utf8').includes(policy.sourceArchive));
        assert.ok(bytes.toString('utf8').includes(policy.licenseUrl));
        continue;
      }
      assert.ok(file.upstream.includes(`/blob/${policy.revision}/`));
      assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), file.gitBlob, file.file);
    }
  }
});
