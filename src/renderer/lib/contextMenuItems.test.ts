import { describe, expect, it } from 'vitest';
import { buildContextMenuItems, resolveContextMenuShortcuts } from './contextMenuItems';
import type { ContextMenuTarget } from './contextMenuTarget';

const labels = {
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  pasteSanitized: 'Paste sanitized',
  selectAll: 'Select all',
};

describe('context menu items', () => {
  it('uses platform shortcuts', () => {
    expect(resolveContextMenuShortcuts('darwin').copy).toBe('⌘C');
    expect(resolveContextMenuShortcuts('win32').copy).toBe('Ctrl+C');
  });

  it('keeps readonly surfaces to copy and select all', () => {
    const target: ContextMenuTarget = {
      kind: 'readonly',
      element: null,
      writable: false,
      hasSelection: false,
      selectedText: '',
    };
    const items = buildContextMenuItems(target, 'clip', labels, resolveContextMenuShortcuts('win32'));
    const commands = items.filter((item) => item.type === 'command');
    expect(commands.map((item) => item.id)).toEqual(['copy', 'selectAll']);
    expect(commands.find((item) => item.id === 'copy')?.disabled).toBe(true);
  });

  it('disables paste when the clipboard is empty', () => {
    const target: ContextMenuTarget = {
      kind: 'codemirror',
      element: null,
      writable: true,
      hasSelection: true,
      selectedText: 'sel',
    };
    const items = buildContextMenuItems(target, '', labels, resolveContextMenuShortcuts('win32'));
    const commands = items.filter((item) => item.type === 'command');
    const paste = commands.find((item) => item.id === 'paste');
    const sanitized = commands.find((item) => item.id === 'pasteSanitized');
    expect(paste?.disabled).toBe(true);
    expect(sanitized?.disabled).toBe(true);
  });
});
