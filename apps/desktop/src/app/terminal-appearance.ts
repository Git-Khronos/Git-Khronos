import type { ITerminalOptions } from '@xterm/xterm';
import type { AppTheme } from './app-theme';
import { terminalTheme } from './terminal-theme';

export type TerminalCursorStyle = 'block' | 'underline' | 'bar';

export type TerminalAppearance = Required<Pick<
  ITerminalOptions,
  'cursorStyle' | 'fontFamily' | 'fontSize' | 'lineHeight' | 'theme'
>>;

export interface TerminalAppearancePreferences {
  readonly theme: AppTheme;
  readonly cursorStyle: TerminalCursorStyle;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
}

export function terminalAppearance(preferences: TerminalAppearancePreferences): TerminalAppearance {
  return {
    cursorStyle: preferences.cursorStyle,
    fontFamily: preferences.fontFamily,
    fontSize: preferences.fontSize,
    lineHeight: preferences.lineHeight,
    theme: terminalTheme(preferences.theme),
  };
}

export function applyTerminalAppearance(
  terminals: readonly { options: ITerminalOptions }[],
  appearance: TerminalAppearance,
): void {
  for (const terminal of terminals) Object.assign(terminal.options, appearance);
}
