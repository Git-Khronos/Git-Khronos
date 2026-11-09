import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { prepareRustNotices } from './prepare-rust-notices.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'git-khronos-notice-preparation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packaging/licenses'), { recursive: true });
  writeFileSync(join(root, 'packaging/licenses/reviewed-rust-notices.json'), '[]');
  mkdirSync(join(root, 'dependency'));
  writeFileSync(join(root, 'dependency/Cargo.toml'), '[package]\n');
  writeFileSync(join(root, 'dependency/LICENSE'), 'Owned license fixture terms\r\n');
  const metadata = {
    workspace_members: ['app'],
    packages: [
      { id: 'app', name: 'git-khronos-desktop' },
      { id: 'dependency', name: 'owned-fixture', version: '1.0.0', license: 'MIT',
        source: 'registry+https://github.com/rust-lang/crates.io-index', manifest_path: join(root, 'dependency/Cargo.toml') },
    ],
    resolve: { nodes: [
      { id: 'app', deps: [{ pkg: 'dependency', dep_kinds: [{ kind: null }] }] },
      { id: 'dependency', deps: [] },
    ] },
  };
  const target = 'aarch64-unknown-linux-gnu';
  const run = (command, args, options) => {
    assert.equal(command, 'cargo');
    assert.deepEqual(args, ['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', target]);
    assert.equal(options.cwd, root);
    assert.equal(options.maxBuffer, 16 * 1024 * 1024);
    return JSON.stringify(metadata);
  };
  return { root, target, run, metadata };
}

test('prepares deterministic compressed notices for the explicit build target without leaking host paths', t => {
  const f = fixture(t);
  const options = { repositoryRoot: f.root, target: f.target, run: f.run };
  const first = prepareRustNotices(options);
  assert.deepEqual(first, prepareRustNotices(options));
  const text = gunzipSync(first).toString('utf8');
  const catalog = JSON.parse(text);
  assert.equal(catalog.target, f.target);
  assert.equal(catalog.packages.length, 1);
  assert.equal(catalog.packages[0].notices[0].text, 'Owned license fixture terms\r\n');
  assert.ok(!text.includes(f.root));
});

test('missing or invalid build targets fail before running Cargo', () => {
  for (const target of [undefined, '', '--help', 'target; command']) {
    assert.throws(() => prepareRustNotices({ target, run() { assert.fail('must not run'); } }), /explicit Tauri target/);
  }
});

test('Cargo metadata failures are redacted and never emit a partial notice payload', t => {
  const f = fixture(t);
  for (const run of [() => { throw new Error('fixture-secret-path'); }, () => '{fixture-secret-invalid-json}']) {
    assert.throws(() => prepareRustNotices({ repositoryRoot: f.root, target: f.target, run }), error =>
      /locked offline Cargo metadata/.test(error.message) && !error.message.includes('fixture-secret'));
  }
});

test('missing upstream terms and incomplete graphs fail package preparation', t => {
  const f = fixture(t);
  const options = { repositoryRoot: f.root, target: f.target, run: f.run };
  rmSync(join(f.root, 'dependency/LICENSE'));
  assert.throws(() => prepareRustNotices(options), /No upstream license/);
  f.metadata.resolve.nodes.pop();
  assert.throws(() => prepareRustNotices(options), /Incomplete dependency closure/);
});
