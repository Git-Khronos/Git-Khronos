import { expect, it } from 'vitest';
import { isTabKey } from './tab-key';

it.each([
  ['Tab', 'Tab', false, true],
  ['Tab', 'Tab', true, true],
  ['Unidentified', 'Tab', true, true],
  ['Unidentified', 'Tab', false, false],
  ['Unidentified', 'KeyT', true, false],
  ['Escape', 'Tab', true, false],
] as const)('recognizes keyboard event %s %s (Shift=%s) as Tab: %s', (key, code, shiftKey, expected) => {
  expect(isTabKey({ key, code, shiftKey })).toBe(expected);
});
