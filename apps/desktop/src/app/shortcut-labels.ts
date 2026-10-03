export interface ShortcutLabels {
  primary: 'Ctrl' | '⌘';
  alternate: 'Alt' | 'Option';
  favorite: 'Ctrl Alt' | '⌘ Control';
  fullscreen: 'F11' | 'Control ⌘ F';
  undo: 'Ctrl Z' | '⌘ Z';
  redo: 'Ctrl Y' | '⌘ Shift Z';
  firstCommit: 'Ctrl Home' | '⌘ ↑';
  lastCommit: 'Ctrl End' | '⌘ ↓';
}

export function shortcutLabelsForPlatform(platform: string): ShortcutLabels {
  const apple = /mac|iphone|ipad|ipod/i.test(platform);
  return apple
    ? {
        primary: '⌘',
        alternate: 'Option',
        favorite: '⌘ Control',
        fullscreen: 'Control ⌘ F',
        undo: '⌘ Z',
        redo: '⌘ Shift Z',
        firstCommit: '⌘ ↑',
        lastCommit: '⌘ ↓',
      }
    : {
        primary: 'Ctrl',
        alternate: 'Alt',
        favorite: 'Ctrl Alt',
        fullscreen: 'F11',
        undo: 'Ctrl Z',
        redo: 'Ctrl Y',
        firstCommit: 'Ctrl Home',
        lastCommit: 'Ctrl End',
      };
}
