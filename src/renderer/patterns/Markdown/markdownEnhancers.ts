import { useEffect, useSyncExternalStore } from 'react';
import type { HLJSApi } from 'highlight.js';
import type { Options } from 'react-markdown';

/**
 * The heavy parts of Markdown rendering — code highlighting (highlight.js and its languages) and KaTeX — load on
 * first use instead of with the app; `prefetchMarkdownEnhancers` starts that right after the first paint. Until they
 * arrive, Markdown renders the same structure unhighlighted, and renders again once they are loaded.
 */
export interface MarkdownEnhancers {
  /** Closed code blocks only; no language detection and no math while the source still streams. */
  streamingRehypePlugins: NonNullable<Options['rehypePlugins']>;
  fullRehypePlugins: NonNullable<Options['rehypePlugins']>;
  hljs: HLJSApi;
}

let enhancers: MarkdownEnhancers | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadMarkdownEnhancers(): Promise<void> {
  loading ??= Promise.all([import('rehype-highlight'), import('rehype-katex'), import('./markdownHighlight')])
    .then(([{ default: rehypeHighlight }, { default: rehypeKatex }, { hljs, MARKDOWN_LANGUAGES, MARKDOWN_LANGUAGE_ALIASES }]) => {
      const highlightOptions = { languages: MARKDOWN_LANGUAGES, aliases: MARKDOWN_LANGUAGE_ALIASES };
      enhancers = {
        streamingRehypePlugins: [[rehypeHighlight, { ...highlightOptions, detect: false }]],
        fullRehypePlugins: [rehypeKatex, [rehypeHighlight, { ...highlightOptions, detect: true }]],
        hljs,
      };
      for (const listener of listeners) listener();
    })
    .catch((error: unknown) => {
      // The next render that needs them asks again; meanwhile Markdown stays readable, only unhighlighted.
      loading = null;
      console.warn('[markdown] could not load highlighting and math rendering', error);
    });
  return loading;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const currentEnhancers = () => enhancers;

export function useMarkdownEnhancers(): MarkdownEnhancers | null {
  const current = useSyncExternalStore(subscribe, currentEnhancers, currentEnhancers);
  useEffect(() => {
    if (!enhancers) void loadMarkdownEnhancers();
  }, []);
  return current;
}

export function prefetchMarkdownEnhancers(): void {
  const start = () => { void loadMarkdownEnhancers(); };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 2000 });
  else window.setTimeout(start, 200);
}
