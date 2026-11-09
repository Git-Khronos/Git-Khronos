import { invoke } from '@tauri-apps/api/core';

/** Reject numeric corruption at the JSON boundary without changing wire types. */
export function assertSafeIntegers(value: unknown): void {
  if (typeof value === 'number'
    && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
    throw new RangeError('Unsafe native IPC number.');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeIntegers(item);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) assertSafeIntegers(item);
  }
}

export async function checked<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  assertSafeIntegers(value);
  return value;
}

export async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  assertSafeIntegers(args);
  return checked(invoke<T>(command, args));
}
