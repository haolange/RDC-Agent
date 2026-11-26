import { sanitizePastedText } from './contextMenuSanitize';
import { resolveReadonlySurface } from './contextMenuTarget';
import type { ContextMenuTarget } from './contextMenuTarget';

export type ContextMenuCommandId = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'pasteSanitized' | 'selectAll';

export interface ContextMenuCommandHost {
  copyText: (text: string) => Promise<boolean>;
  readText: () => Promise<string>;
}

function queryEnabled(command: string): boolean {
  try {
    return document.queryCommandEnabled(command);
  } catch {
    return false;
  }
}

function runExec(command: string, value?: string): boolean {
  try {
    return value === undefined ? document.execCommand(command) : document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

/**
 * What the context menu does to a CodeMirror editor. The editor registers it when it mounts, so the menu runs editor
 * commands without loading CodeMirror itself: CodeMirror is only in the bundle once an editor needs it.
 */
export interface CodeMirrorCommandSurface {
  undoDepth: () => number;
  redoDepth: () => number;
  undo: () => void;
  redo: () => void;
  focus: () => void;
  selectAll: () => void;
  selectedText: () => string;
  replaceSelection: (text: string) => void;
}

const registeredSurfaces = new WeakMap<HTMLElement, CodeMirrorCommandSurface>();

/** Registers an editor under its host and content elements; a null surface unregisters the host. */
export function registerCodeMirrorSurface(
  host: HTMLElement,
  content: HTMLElement | null,
  surface: CodeMirrorCommandSurface | null,
): void {
  if (surface && content) {
    registeredSurfaces.set(host, surface);
    registeredSurfaces.set(content, surface);
    return;
  }
  registeredSurfaces.delete(host);
}

function findCodeMirrorSurface(element: HTMLElement): CodeMirrorCommandSurface | null {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const surface = registeredSurfaces.get(node);
    if (surface) return surface;
  }
  return null;
}

function focusTarget(element: HTMLElement): void {
  if (document.activeElement !== element) {
    element.focus({ preventScroll: true });
  }
}

export function canUndo(target: ContextMenuTarget): boolean {
  if (target.kind === 'codemirror' && target.element) {
    const surface = findCodeMirrorSurface(target.element);
    return Boolean(surface && surface.undoDepth() > 0);
  }
  if (target.kind === 'editable') return queryEnabled('undo');
  return false;
}

export function canRedo(target: ContextMenuTarget): boolean {
  if (target.kind === 'codemirror' && target.element) {
    const surface = findCodeMirrorSurface(target.element);
    return Boolean(surface && surface.redoDepth() > 0);
  }
  if (target.kind === 'editable') return queryEnabled('redo');
  return false;
}

function selectAllReadonly(element: HTMLElement): void {
  const surface = resolveReadonlySurface(element) ?? element;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(surface);
  selection.removeAllRanges();
  selection.addRange(range);
}

async function runCodeMirrorCommand(
  target: ContextMenuTarget,
  id: ContextMenuCommandId,
  host: ContextMenuCommandHost,
): Promise<void> {
  if (!target.element) return;
  const surface = findCodeMirrorSurface(target.element);
  if (!surface) return;
  surface.focus();
  if (id === 'undo') {
    surface.undo();
    return;
  }
  if (id === 'redo') {
    surface.redo();
    return;
  }
  if (id === 'selectAll') {
    surface.selectAll();
    return;
  }
  const selected = surface.selectedText();
  if (id === 'copy') {
    await host.copyText(selected);
    return;
  }
  if (id === 'cut' && target.writable) {
    await host.copyText(selected);
    surface.replaceSelection('');
    return;
  }
  if ((id === 'paste' || id === 'pasteSanitized') && target.writable) {
    const raw = await host.readText();
    const text = id === 'pasteSanitized' ? sanitizePastedText(raw) : raw;
    surface.replaceSelection(text);
  }
}

async function runNativeCommand(
  target: ContextMenuTarget,
  id: ContextMenuCommandId,
  host: ContextMenuCommandHost,
): Promise<void> {
  if (!target.element) return;
  focusTarget(target.element);
  if (id === 'undo' || id === 'redo' || id === 'cut' || id === 'copy' || id === 'selectAll') {
    if (target.kind === 'readonly' && id === 'selectAll') {
      selectAllReadonly(target.element);
      return;
    }
    if (id === 'copy' && target.kind === 'readonly') {
      await host.copyText(target.selectedText);
      return;
    }
    runExec(id);
    return;
  }
  if (!target.writable) return;
  const raw = await host.readText();
  const text = id === 'pasteSanitized' ? sanitizePastedText(raw) : raw;
  runExec('insertText', text);
}

export async function runContextMenuCommand(
  target: ContextMenuTarget,
  id: ContextMenuCommandId,
  host: ContextMenuCommandHost,
): Promise<void> {
  if (target.kind === 'none') return;
  if (target.kind === 'codemirror') {
    await runCodeMirrorCommand(target, id, host);
    return;
  }
  await runNativeCommand(target, id, host);
}
