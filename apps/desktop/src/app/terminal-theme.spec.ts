import { describe, expect, it } from 'vitest';
import { terminalTheme } from './terminal-theme';

describe('terminal theme', () => {
  it('keeps each terminal canvas aligned with its application surface', () => {
    expect(terminalTheme('khronos')).toMatchObject({
      background: '#11111a',
      foreground: '#d8d7e2',
      cursor: '#63dbb5',
    });
    expect(terminalTheme('midnight')).toMatchObject({
      background: '#080d14',
      foreground: '#dce6f2',
      cursor: '#69ddb7',
    });
  });

  it('returns independent palette objects for live terminal updates', () => {
    expect(terminalTheme('khronos')).not.toBe(terminalTheme('khronos'));
  });
});
