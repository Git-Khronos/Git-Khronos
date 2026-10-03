import type { ITheme } from '@xterm/xterm';
import type { AppTheme } from './app-theme';

const CHRONOS_TERMINAL_THEME: Readonly<ITheme> = {
  background: '#11111a',
  foreground: '#d8d7e2',
  cursor: '#63dbb5',
  cursorAccent: '#11111a',
  selectionBackground: '#6558b966',
  black: '#171721',
  red: '#ef7186',
  green: '#65d6ae',
  yellow: '#e5b36b',
  blue: '#7d91ef',
  magenta: '#ba7be7',
  cyan: '#55cbd1',
  white: '#d8d7e2',
  brightBlack: '#626173',
  brightRed: '#ff8ba0',
  brightGreen: '#7ee8c2',
  brightYellow: '#f3c77e',
  brightBlue: '#9aabff',
  brightMagenta: '#d19af2',
  brightCyan: '#75e2e7',
  brightWhite: '#ffffff',
};

const MIDNIGHT_TERMINAL_THEME: Readonly<ITheme> = {
  background: '#080d14',
  foreground: '#dce6f2',
  cursor: '#69ddb7',
  cursorAccent: '#080d14',
  selectionBackground: '#5368c766',
  black: '#101824',
  red: '#ff7890',
  green: '#69ddb7',
  yellow: '#f2b96f',
  blue: '#86a0ff',
  magenta: '#b49cff',
  cyan: '#57d7dd',
  white: '#dce6f2',
  brightBlack: '#6d7b8e',
  brightRed: '#ff94a7',
  brightGreen: '#8ae9c9',
  brightYellow: '#f7cb88',
  brightBlue: '#a4b7ff',
  brightMagenta: '#ccbaff',
  brightCyan: '#7be3e8',
  brightWhite: '#ffffff',
};

export function terminalTheme(theme: AppTheme): ITheme {
  return theme === 'midnight' ? { ...MIDNIGHT_TERMINAL_THEME } : { ...CHRONOS_TERMINAL_THEME };
}
