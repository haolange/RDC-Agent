export type ContextMenuKind = 'none' | 'editable' | 'codemirror' | 'readonly';

export interface ContextMenuTarget {
  kind: ContextMenuKind;
  element: HTMLElement | null;
  writable: boolean;
  hasSelection: boolean;
  selectedText: string;
}

const EXCLUDED_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'file',
  'range',
  'color',
  'hidden',
  'image',
]);

const READONLY_SURFACES = [
  '.conversation-bubble',
  '.markdown-code-block',
  '.composer-markdown-preview',
  '.runtime-terminal-activity-pane',
  '.runtime-terminal-entry-body',
].join(',');

function asElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Text && target.parentElement) return target.parentElement;
  return null;
}

function isOwnedMenuSurface(element: HTMLElement): boolean {
  return Boolean(
    element.closest('[data-owns-context-menu]')
    || element.closest('.sidebar-context-menu')
    || element.closest('.app-context-menu'),
  );
}

function isTextField(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !EXCLUDED_INPUT_TYPES.has(element.type.toLowerCase());
}

function fieldSelection(element: HTMLInputElement | HTMLTextAreaElement): { hasSelection: boolean; selectedText: string } {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? 0;
  const selectedText = element.value.slice(start, end);
  return { hasSelection: selectedText.length > 0, selectedText };
}

function windowSelection(): { hasSelection: boolean; selectedText: string } {
  const text = window.getSelection()?.toString() ?? '';
  return { hasSelection: text.length > 0, selectedText: text };
}

export function resolveReadonlySurface(element: HTMLElement): HTMLElement | null {
  return element.closest(READONLY_SURFACES);
}

export function resolveContextMenuTarget(target: EventTarget | null): ContextMenuTarget {
  const empty: ContextMenuTarget = {
    kind: 'none',
    element: null,
    writable: false,
    hasSelection: false,
    selectedText: '',
  };
  const element = asElement(target);
  if (!element || isOwnedMenuSurface(element)) return empty;

  const cmContent = element.closest('.cm-content');
  if (cmContent instanceof HTMLElement) {
    const selection = windowSelection();
    return {
      kind: 'codemirror',
      element: cmContent,
      writable: cmContent.getAttribute('contenteditable') === 'true',
      hasSelection: selection.hasSelection,
      selectedText: selection.selectedText,
    };
  }

  const field = element.closest('input, textarea');
  if (field instanceof HTMLElement && isTextField(field)) {
    const writable = !field.readOnly && !field.disabled;
    const selection = fieldSelection(field);
    return {
      kind: writable ? 'editable' : 'readonly',
      element: field,
      writable,
      hasSelection: selection.hasSelection,
      selectedText: selection.selectedText,
    };
  }

  if (element.isContentEditable) {
    const selection = windowSelection();
    return {
      kind: 'editable',
      element,
      writable: true,
      hasSelection: selection.hasSelection,
      selectedText: selection.selectedText,
    };
  }

  const surface = resolveReadonlySurface(element);
  if (surface) {
    const selection = windowSelection();
    return {
      kind: 'readonly',
      element: surface,
      writable: false,
      hasSelection: selection.hasSelection,
      selectedText: selection.selectedText,
    };
  }

  const selection = windowSelection();
  if (selection.hasSelection) {
    return {
      kind: 'readonly',
      element,
      writable: false,
      hasSelection: true,
      selectedText: selection.selectedText,
    };
  }

  return empty;
}
