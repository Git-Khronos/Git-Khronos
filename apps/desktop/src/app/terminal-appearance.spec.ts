import { describe, expect, it } from 'vitest';
import type { ITerminalOptions } from '@xterm/xterm';
import { applyTerminalAppearance, terminalAppearance } from './terminal-appearance';

describe('terminal appearance', () => {
  it('maps application preferences to mutable terminal options', () => {
    const appearance = terminalAppearance({
      theme: 'midnight',
      cursorStyle: 'bar',
      fontFamily: 'Example Mono',
      fontSize: 14,
      lineHeight: 1.4,
    });

    expect(appearance).toMatchObject({
      cursorStyle: 'bar',
      fontFamily: 'Example Mono',
      fontSize: 14,
      lineHeight: 1.4,
      theme: { background: '#080d14', cursor: '#69ddb7' },
    });
  });

  it('updates every existing terminal without replacing its options object', () => {
    const firstOptions: ITerminalOptions = { fontSize: 11 };
    const secondOptions: ITerminalOptions = { cursorStyle: 'block' };
    const appearance = terminalAppearance({
      theme: 'chronos',
      cursorStyle: 'underline',
      fontFamily: 'Readable Mono',
      fontSize: 16,
      lineHeight: 1.5,
    });

    applyTerminalAppearance([{ options: firstOptions }, { options: secondOptions }], appearance);

    expect(firstOptions).toMatchObject(appearance);
    expect(secondOptions).toMatchObject(appearance);
  });
});
