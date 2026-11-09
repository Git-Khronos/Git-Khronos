import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptBindings } from './generate-ipc.mjs';

test('derives named arguments, native names, and nullable top-level options', () => {
  const source = `import { invoke as TAURI_INVOKE } from "@tauri-apps/api/core";
  export const commands = {
    async fetchBranches(repoId: string, options: FetchOptions, operationId: string | null): Promise<Snapshot> {
      return await TAURI_INVOKE("fetch_branches", { repoId, options, operationId });
    },
    async systemInfo(): Promise<Info> { return await TAURI_INVOKE("system_info"); }
  };`;
  const output = adaptBindings(source);
  assert.match(output, /function fetch_branches\(args: \{ repoId: string; options: FetchOptions; operationId\?: string \| null \}/);
  assert.match(output, /Promise<Snapshot>/);
  assert.doesNotMatch(output, /export const commands/);
  assert.match(output, /function system_info\(args: \{  \} = \{\}\)/);
  assert.match(output, /safeInvoke as TAURI_INVOKE/);
});

test('fails closed when the exporter shape changes', () => {
  assert.throws(() => adaptBindings('export const commands = null;'), /Missing generated commands/);
  assert.throws(() => adaptBindings('export const commands = { async wrong(): Promise<null> { return null; } };'), /Missing native command/);
});

test('normalizes trailing exporter whitespace without changing literal spaces', () => {
  const source = 'import { invoke as TAURI_INVOKE } from "@tauri-apps/api/core"; \t\n'
    + 'export type Info = { field: " "; \t\n};\n'
    + 'export const commands = { async systemInfo(): Promise<Info> { return await TAURI_INVOKE("system_info"); } };';
  const output = adaptBindings(source);
  assert.doesNotMatch(output, /[ \t]+$/m);
  assert.match(output, /field: " ";\n/);
});
