import type { ContextMenuCommandId } from './contextMenuCommands';
import { canRedo, canUndo } from './contextMenuCommands';
import type { ContextMenuTarget } from './contextMenuTarget';

export type ContextMenuItem =
  | { type: 'separator' }
  | {
    type: 'command';
    id: ContextMenuCommandId;
    label: string;
    shortcut: string;
    disabled: boolean;
  };

export interface ContextMenuLabels {
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  pasteSanitized: string;
  selectAll: string;
}

export interface ContextMenuShortcuts {
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  pasteSanitized: string;
  selectAll: string;
}

export function resolveContextMenuShortcuts(platform: string): ContextMenuShortcuts {
  const mac = platform === 'darwin' || /mac/i.test(platform);
  if (mac) {
    return {
      undo: '⌘Z',
      redo: '⇧⌘Z',
      cut: '⌘X',
      copy: '⌘C',
      paste: '⌘V',
      pasteSanitized: '⇧⌘V',
      selectAll: '⌘A',
    };
  }
  return {
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Y',
    cut: 'Ctrl+X',
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    pasteSanitized: 'Ctrl+Shift+V',
    selectAll: 'Ctrl+A',
  };
}

function command(
  id: ContextMenuCommandId,
  labels: ContextMenuLabels,
  shortcuts: ContextMenuShortcuts,
  disabled: boolean,
): ContextMenuItem {
  return { type: 'command', id, label: labels[id], shortcut: shortcuts[id], disabled };
}

export function buildContextMenuItems(
  target: ContextMenuTarget,
  clipboardText: string,
  labels: ContextMenuLabels,
  shortcuts: ContextMenuShortcuts,
): ContextMenuItem[] {
  if (target.kind === 'none') return [];
  const clipboardEmpty = clipboardText.length === 0;
  if (!target.writable) {
    return [
      command('copy', labels, shortcuts, !target.hasSelection),
      command('selectAll', labels, shortcuts, false),
    ];
  }
  return [
    command('undo', labels, shortcuts, !canUndo(target)),
    command('redo', labels, shortcuts, !canRedo(target)),
    { type: 'separator' },
    command('cut', labels, shortcuts, !target.hasSelection),
    command('copy', labels, shortcuts, !target.hasSelection),
    command('paste', labels, shortcuts, clipboardEmpty),
    command('pasteSanitized', labels, shortcuts, clipboardEmpty),
    { type: 'separator' },
    command('selectAll', labels, shortcuts, false),
  ];
}
