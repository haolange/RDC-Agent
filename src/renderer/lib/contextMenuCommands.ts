import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { sanitizePastedText } from './contextMenuSanitize';
import type { ContextMenuTarget } from './contextMenuTarget';
import { resolveReadonlySurface } from './contextMenuTarget';

export type ContextMenuCommandId =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteSanitized'
  | 'selectAll';

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
    return value === undefined
      ? document.execCommand(command)
      : document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

const registeredViews = new WeakMap<HTMLElement, EditorView>();

export function registerCodeMirrorView(host: HTMLElement, view: EditorView | null): void {
  if (view) {
    registeredViews.set(host, view);
    registeredViews.set(view.contentDOM, view);
    return;
  }
  registeredViews.delete(host);
}

function findCodeMirrorView(element: HTMLElement): EditorView | null {
  return registeredViews.get(element)
    ?? EditorView.findFromDOM(element)
    ?? null;
}

function focusTarget(element: HTMLElement): void {
  if (document.activeElement !== element) {
    element.focus({ preventScroll: true });
  }
}

export function canUndo(target: ContextMenuTarget): boolean {
  if (target.kind === 'codemirror' && target.element) {
    const view = findCodeMirrorView(target.element);
    return Boolean(view && undoDepth(view.state) > 0);
  }
  if (target.kind === 'editable') return queryEnabled('undo');
  return false;
}

export function canRedo(target: ContextMenuTarget): boolean {
  if (target.kind === 'codemirror' && target.element) {
    const view = findCodeMirrorView(target.element);
    return Boolean(view && redoDepth(view.state) > 0);
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
  const view = findCodeMirrorView(target.element);
  if (!view) return;
  view.focus();
  if (id === 'undo') {
    undo(view);
    return;
  }
  if (id === 'redo') {
    redo(view);
    return;
  }
  if (id === 'selectAll') {
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    return;
  }
  const selected = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  if (id === 'copy') {
    await host.copyText(selected);
    return;
  }
  if (id === 'cut' && target.writable) {
    await host.copyText(selected);
    view.dispatch(view.state.replaceSelection(''));
    return;
  }
  if ((id === 'paste' || id === 'pasteSanitized') && target.writable) {
    const raw = await host.readText();
    const text = id === 'pasteSanitized' ? sanitizePastedText(raw) : raw;
    view.dispatch(view.state.replaceSelection(text));
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
