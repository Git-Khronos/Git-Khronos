export type IconName =
  | 'archive'
  | 'archive-restore'
  | 'activity'
  | 'bell'
  | 'branch'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-up'
  | 'chevron-right'
  | 'clock'
  | 'columns'
  | 'cherry-pick'
  | 'copy'
  | 'file'
  | 'filter'
  | 'folder-git'
  | 'git-commit'
  | 'globe'
  | 'history'
  | 'keyboard'
  | 'link'
  | 'merge'
  | 'maximize'
  | 'more'
  | 'edit'
  | 'external-terminal'
  | 'eye'
  | 'eye-off'
  | 'panel-left'
  | 'panel-right'
  | 'pin'
  | 'minus'
  | 'plus'
  | 'pull'
  | 'push'
  | 'refresh'
  | 'remote'
  | 'repo'
  | 'reset'
  | 'revert'
  | 'search'
  | 'server'
  | 'settings'
  | 'star'
  | 'tag'
  | 'terminal'
  | 'trash'
  | 'undo'
  | 'redo'
  | 'user'
  | 'warning'
  | 'x';

export type IconPrimitive =
  | { readonly kind: 'path'; readonly d: string }
  | { readonly kind: 'circle'; readonly cx: string; readonly cy: string; readonly r: string; readonly fill?: 'currentColor' }
  | { readonly kind: 'rect'; readonly x: string; readonly y: string; readonly width: string; readonly height: string; readonly rx: string };

// Existing project-created geometry, preserved in draw order. No HTML or external SVG is injected.
export const ICON_SHAPES: Readonly<Record<IconName, readonly IconPrimitive[]>> = {
  "undo": [{"kind": "path", "d": "M9 14 4 9l5-5"}, {"kind": "path", "d": "M4 9h10a6 6 0 0 1 6 6v1"}],
  "redo": [{"kind": "path", "d": "m15 14 5-5-5-5"}, {"kind": "path", "d": "M20 9H10a6 6 0 0 0-6 6v1"}],
  "chevron-left": [{"kind": "path", "d": "m15 18-6-6 6-6"}],
  "pull": [{"kind": "path", "d": "M12 3v14"}, {"kind": "path", "d": "m7 12 5 5 5-5"}, {"kind": "path", "d": "M5 21h14"}],
  "push": [{"kind": "path", "d": "M12 21V7"}, {"kind": "path", "d": "m7 12 5-5 5 5"}, {"kind": "path", "d": "M5 3h14"}],
  "branch": [{"kind": "circle", "cx": "6", "cy": "5", "r": "2"}, {"kind": "circle", "cx": "18", "cy": "6", "r": "2"}, {"kind": "circle", "cx": "6", "cy": "19", "r": "2"}, {"kind": "path", "d": "M6 7v10M8 9h4a6 6 0 0 0 6-1"}],
  "archive": [{"kind": "path", "d": "M4 7v13h16V7"}, {"kind": "path", "d": "M3 4h18v3H3zM9 11h6"}],
  "archive-restore": [{"kind": "path", "d": "M4 7v13h16V7"}, {"kind": "path", "d": "M3 4h18v3H3zM12 17v-6m-3 3 3-3 3 3"}],
  "activity": [{"kind": "path", "d": "M3 12h4l2-6 4 12 2-6h6"}],
  "bell": [{"kind": "path", "d": "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"}, {"kind": "path", "d": "M10 21h4"}],
  "clock": [{"kind": "circle", "cx": "12", "cy": "12", "r": "9"}, {"kind": "path", "d": "M12 7v5l3.5 2"}],
  "columns": [{"kind": "rect", "x": "3", "y": "5", "width": "18", "height": "14", "rx": "1.5"}, {"kind": "path", "d": "M9 5v14M15 5v14"}],
  "filter": [{"kind": "path", "d": "M4 5h16l-6.5 7.2V19l-3 1v-7.8z"}],
  "history": [{"kind": "path", "d": "M3 12a9 9 0 1 0 3-6.7L3 8"}, {"kind": "path", "d": "M3 3v5h5M12 7v5l3 2"}],
  "user": [{"kind": "circle", "cx": "12", "cy": "8", "r": "4"}, {"kind": "path", "d": "M5 21a7 7 0 0 1 14 0"}],
  "globe": [{"kind": "circle", "cx": "12", "cy": "12", "r": "9"}, {"kind": "path", "d": "M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"}],
  "link": [{"kind": "path", "d": "M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"}, {"kind": "path", "d": "M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"}],
  "refresh": [{"kind": "path", "d": "M20 6v5h-5M4 18v-5h5"}, {"kind": "path", "d": "M18 9a7 7 0 0 0-12-2L4 11m2 4a7 7 0 0 0 12 2l2-4"}],
  "remote": [{"kind": "path", "d": "M7.2 18h9.7a4 4 0 0 0 .8-7.9A6 6 0 0 0 6.4 8.8 4.6 4.6 0 0 0 7.2 18Z"}, {"kind": "circle", "cx": "9", "cy": "14", "r": ".8", "fill": "currentColor"}, {"kind": "circle", "cx": "15", "cy": "14", "r": ".8", "fill": "currentColor"}, {"kind": "path", "d": "M10 14h4"}],
  "search": [{"kind": "circle", "cx": "11", "cy": "11", "r": "7"}, {"kind": "path", "d": "m20 20-4-4"}],
  "server": [{"kind": "rect", "x": "4", "y": "4", "width": "16", "height": "6", "rx": "1"}, {"kind": "rect", "x": "4", "y": "14", "width": "16", "height": "6", "rx": "1"}, {"kind": "path", "d": "M8 7h.01M8 17h.01M12 7h5M12 17h5"}],
  "settings": [{"kind": "circle", "cx": "12", "cy": "12", "r": "3"}, {"kind": "path", "d": "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"}],
  "star": [{"kind": "path", "d": "m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"}],
  "keyboard": [{"kind": "rect", "x": "3", "y": "5", "width": "18", "height": "14", "rx": "2"}, {"kind": "path", "d": "M7 9h.01M10 9h.01M13 9h.01M16 9h.01M7 13h.01M10 13h.01M13 13h4M7 16h10"}],
  "minus": [{"kind": "path", "d": "M5 12h14"}],
  "plus": [{"kind": "path", "d": "M12 5v14M5 12h14"}],
  "x": [{"kind": "path", "d": "m6 6 12 12M18 6 6 18"}],
  "chevron-down": [{"kind": "path", "d": "m6 9 6 6 6-6"}],
  "chevron-up": [{"kind": "path", "d": "m6 15 6-6 6 6"}],
  "chevron-right": [{"kind": "path", "d": "m9 18 6-6-6-6"}],
  "tag": [{"kind": "path", "d": "M20 13 11 4H4v7l9 9 7-7Z"}, {"kind": "circle", "cx": "7.5", "cy": "7.5", "r": ".7", "fill": "currentColor"}],
  "terminal": [{"kind": "rect", "x": "3", "y": "4", "width": "18", "height": "16", "rx": "2"}, {"kind": "path", "d": "m7 9 3 3-3 3M13 15h4"}],
  "external-terminal": [{"kind": "path", "d": "M13 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}, {"kind": "path", "d": "m7 10 3 3-3 3M17 3h4v4M21 3l-6 6"}],
  "repo": [{"kind": "path", "d": "M3 5h7l2 2h9v12H3z"}, {"kind": "path", "d": "M8 12h8M8 16h5"}],
  "folder-git": [{"kind": "path", "d": "M3 6h7l2 2h9v11H3z"}, {"kind": "circle", "cx": "9", "cy": "13", "r": "1"}, {"kind": "circle", "cx": "16", "cy": "12", "r": "1"}, {"kind": "circle", "cx": "9", "cy": "17", "r": "1"}, {"kind": "path", "d": "M9 14v2m1-2h2a4 4 0 0 0 4-1"}],
  "copy": [{"kind": "rect", "x": "9", "y": "9", "width": "11", "height": "11", "rx": "2"}, {"kind": "path", "d": "M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"}],
  "check": [{"kind": "path", "d": "m5 12 4 4L19 6"}],
  "warning": [{"kind": "path", "d": "M12 3 2.8 20h18.4Z"}, {"kind": "path", "d": "M12 9v5M12 17h.01"}],
  "git-commit": [{"kind": "path", "d": "M2 12h6m8 0h6"}, {"kind": "circle", "cx": "12", "cy": "12", "r": "4"}],
  "merge": [{"kind": "circle", "cx": "6", "cy": "5", "r": "2"}, {"kind": "circle", "cx": "18", "cy": "6", "r": "2"}, {"kind": "circle", "cx": "6", "cy": "19", "r": "2"}, {"kind": "path", "d": "M6 7v10M18 8v1a7 7 0 0 1-7 7H8"}],
  "maximize": [{"kind": "path", "d": "M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"}],
  "more": [{"kind": "circle", "cx": "5", "cy": "12", "r": "1", "fill": "currentColor"}, {"kind": "circle", "cx": "12", "cy": "12", "r": "1", "fill": "currentColor"}, {"kind": "circle", "cx": "19", "cy": "12", "r": "1", "fill": "currentColor"}],
  "edit": [{"kind": "path", "d": "M12 20h9"}, {"kind": "path", "d": "M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"}],
  "eye": [{"kind": "path", "d": "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"}, {"kind": "circle", "cx": "12", "cy": "12", "r": "2.5"}],
  "eye-off": [{"kind": "path", "d": "m3 3 18 18"}, {"kind": "path", "d": "M10.6 6.1A11.8 11.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.7 6.8C3.6 8.5 2 12 2 12s3.5 6 10 6c1.8 0 3.3-.4 4.6-1"}, {"kind": "path", "d": "M10.3 10.3a2.5 2.5 0 0 0 3.4 3.4"}],
  "trash": [{"kind": "path", "d": "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"}],
  "file": [{"kind": "path", "d": "M6 2h8l4 4v16H6z"}, {"kind": "path", "d": "M14 2v5h5"}],
  "cherry-pick": [{"kind": "path", "d": "M4 7h6a4 4 0 0 1 4 4v6"}, {"kind": "path", "d": "m10 13 4 4 4-4"}, {"kind": "circle", "cx": "4", "cy": "7", "r": "2"}],
  "revert": [{"kind": "path", "d": "M9 14 4 9l5-5"}, {"kind": "path", "d": "M4 9h9a7 7 0 0 1 7 7v2"}],
  "reset": [{"kind": "path", "d": "M5 4v6h6"}, {"kind": "path", "d": "M5.5 10A8 8 0 1 1 4 15"}],
  "panel-left": [{"kind": "rect", "x": "3", "y": "4", "width": "18", "height": "16", "rx": "2"}, {"kind": "path", "d": "M9 4v16"}],
  "panel-right": [{"kind": "rect", "x": "3", "y": "4", "width": "18", "height": "16", "rx": "2"}, {"kind": "path", "d": "M15 4v16"}],
  "pin": [{"kind": "path", "d": "m14 4 6 6-3 1-4 4-1 5-2-2-4-4-2-2 5-1 4-4Z"}, {"kind": "path", "d": "m9 15-5 5"}],
};

/** Preserve the previous empty-SVG fallback for unknown runtime names. */
export function iconPrimitives(name: string): readonly IconPrimitive[] {
  return Object.hasOwn(ICON_SHAPES, name) ? ICON_SHAPES[name as IconName] : [];
}
