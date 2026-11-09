import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ipc } from '@git-khronos/contracts';
import { assertSafeIntegers, checked } from '@git-khronos/contracts';

describe('generated native IPC contract', () => {
  it('covers the complete registered command surface', () => {
    expect(Object.keys(ipc).length).toBeGreaterThan(150);
    expect(ipc.open_repository).toBeTypeOf('function');
    expect(ipc.answer_authentication).toBeTypeOf('function');
    expect(ipc.inspect_file_history_page).toBeTypeOf('function');
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
