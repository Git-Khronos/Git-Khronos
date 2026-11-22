import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ipc } from '@git-khronos/contracts';
import { assertSafeIntegers, checked } from '@git-khronos/contracts';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  invoke: bridge.invoke,
}));

describe('generated native IPC contract', () => {
  it('covers the complete registered command surface', () => {
    expect(Object.keys(ipc).length).toBeGreaterThan(150);
    expect(ipc.open_repository).toBeTypeOf('function');
    expect(ipc.answer_authentication).toBeTypeOf('function');
    expect(ipc.inspect_file_history_page).toBeTypeOf('function');
  });

  it('preserves named wire calls and default empty arguments', async () => {
    const snapshot = { id: 'fixture' };
    bridge.invoke.mockReset().mockResolvedValue(snapshot);
    const args = { path: '/owned/checkout' };
    expect(await ipc.open_repository(args)).toBe(snapshot);
    await ipc.system_info();
    await ipc.system_info({});
    expect(bridge.invoke.mock.calls).toEqual([
      ['open_repository', args],
      ['system_info', {}],
      ['system_info', {}],
    ]);
  });

  it('checks request and response numbers without replacing native rejections', async () => {
    const refusal = { kind: 'operationCancelled', message: 'Cancelled', hint: null };
    bridge.invoke.mockReset();
    await expect(ipc.open_terminal({ repoId: 'fixture', rows: Infinity, cols: 80 })).rejects.toThrow(RangeError);
    expect(bridge.invoke).not.toHaveBeenCalled();
    bridge.invoke.mockResolvedValueOnce({ nested: [Number.MAX_SAFE_INTEGER + 1] });
    await expect(ipc.system_info()).rejects.toThrow(RangeError);
    bridge.invoke.mockRejectedValueOnce(refusal);
    await expect(ipc.system_info()).rejects.toBe(refusal);
  });

  it('does not allow application code to bypass generated command or event bindings', () => {
    const offenders = readdirSync(__dirname).filter(name => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .filter(name => /\bimport\b[^;]*\b(?:invoke|listen)\b[^;]*from ['"]@tauri-apps\/api\/(?:core|event)['"]/.test(readFileSync(join(__dirname, name), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('accepts representable JSON numbers and rejects unsafe nested integers', async () => {
    expect(() => assertSafeIntegers({ values: [null, 0, 0.5, Number.MAX_SAFE_INTEGER] })).not.toThrow();
    expect(() => assertSafeIntegers({ values: [Number.MAX_SAFE_INTEGER + 1] })).toThrow(RangeError);
    await expect(checked(Promise.resolve({ bytes: Number.MAX_SAFE_INTEGER + 1 }))).rejects.toThrow(RangeError);
  });

  it('rejects non-finite numbers instead of silently serializing them as null', async () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(JSON.stringify({ value })).toBe('{"value":null}');
      expect(() => assertSafeIntegers({ nested: [value] })).toThrow(RangeError);
      await expect(checked(Promise.resolve({ value }))).rejects.toThrow(RangeError);
    }
  });

  it('preserves native failure rejection objects', async () => {
    const error = { kind: 'operationCancelled', message: 'Cancelled', hint: null };
    await expect(checked(Promise.reject(error))).rejects.toBe(error);
  });
});
