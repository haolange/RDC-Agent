import { useEffect, useSyncExternalStore } from 'react';
import { whenIdle } from '../../lib/whenIdle';

type ComposerMarkdownInputComponent = (typeof import('./ComposerMarkdownInput'))['ComposerMarkdownInput'];

/**
 * The Markdown Composer's editor (CodeMirror and its Markdown language) is its own chunk: it loads when the Markdown
 * Composer first renders, and `prefetchComposerMarkdownInput` fetches it once the app is idle so that render rarely
 * waits. Until it arrives the Composer shows its plain field, bound to the same draft.
 */
let editor: ComposerMarkdownInputComponent | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadComposerMarkdownInput(): Promise<void> {
  loading ??= import('./ComposerMarkdownInput')
    .then(({ ComposerMarkdownInput }) => {
      editor = ComposerMarkdownInput;
      for (const listener of listeners) listener();
    })
    .catch((error: unknown) => {
      // The next render that needs the editor asks again; the plain field keeps the draft editable meanwhile.
      loading = null;
      console.warn('[composer] could not load the Markdown editor', error);
    });
  return loading;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const currentEditor = () => editor;

/** The loaded editor, or null while it loads; the first caller that needs it starts the load. */
export function useComposerMarkdownInput(needed: boolean): ComposerMarkdownInputComponent | null {
  const current = useSyncExternalStore(subscribe, currentEditor, currentEditor);
  useEffect(() => {
    if (needed && !editor) void loadComposerMarkdownInput();
  }, [needed]);
  return current;
}

export function prefetchComposerMarkdownInput(): void {
  whenIdle(() => {
    void loadComposerMarkdownInput();
  });
}
