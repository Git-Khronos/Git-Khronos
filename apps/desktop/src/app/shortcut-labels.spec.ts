import { describe, expect, it } from 'vitest';
import { shortcutLabelsForPlatform } from './shortcut-labels';

describe('shortcutLabelsForPlatform', () => {
  it('uses Command and Option on Apple platforms', () => {
    expect(shortcutLabelsForPlatform('MacIntel')).toEqual({
      primary: '⌘',
      alternate: 'Option',
      favorite: '⌘ Control',
      fullscreen: 'Control ⌘ F',
      undo: '⌘ Z',
      redo: '⌘ Shift Z',
      firstCommit: '⌘ ↑',
      lastCommit: '⌘ ↓',
    });
  });

  it('uses Ctrl, Alt, and F11 on Linux and Windows', () => {
    expect(shortcutLabelsForPlatform('Linux x86_64')).toEqual({
      primary: 'Ctrl',
      alternate: 'Alt',
      favorite: 'Ctrl Alt',
      fullscreen: 'F11',
      undo: 'Ctrl Z',
      redo: 'Ctrl Y',
      firstCommit: 'Ctrl Home',
      lastCommit: 'Ctrl End',
    });
    expect(shortcutLabelsForPlatform('Win32').primary).toBe('Ctrl');
  });
});
