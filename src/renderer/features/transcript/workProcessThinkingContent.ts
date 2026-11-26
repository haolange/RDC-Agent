import { useEffect, useSyncExternalStore } from 'react';
import { whenIdle } from '../../lib/whenIdle';

type MarkdownParser = (typeof import('@codemirror/lang-markdown'))['markdownLanguage']['parser'];
type MarkdownNode = ReturnType<MarkdownParser['parse']>['topNode'];

/**
 * Whether thinking text renders anything is decided by the Markdown parser CodeMirror ships, which is its own chunk:
 * `prefetchThinkingMarkdownParser` fetches it once the app is idle. Until it arrives, any non-blank text counts as
 * visible; presentations built before then are rebuilt once it is loaded (`useThinkingMarkdownParser`).
 */
let parser: MarkdownParser | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadThinkingMarkdownParser(): Promise<void> {
  loading ??= import('@codemirror/lang-markdown')
    .then(({ markdownLanguage }) => {
      parser = markdownLanguage.parser;
      for (const listener of listeners) listener();
    })
    .catch((error: unknown) => {
      loading = null;
      console.warn('[transcript] could not load the Markdown parser for thinking rows', error);
    });
  return loading;
}

function isRenderableBlock(node: MarkdownNode, source: string): boolean {
  return (
    node.name !== 'LinkReference' &&
    !(/^ATXHeading/u.test(node.name) && /^#{1,6}(?:[ \t]+#+)?[ \t]*$/u.test(source.slice(node.from, node.to)))
  );
}

export function hasVisibleThinkingMarkdown(source: string): boolean {
  if (!source.trim()) return false;
  if (!parser) return true;
  const document = parser.parse(source).topNode;
  for (let block = document.firstChild; block; block = block.nextSibling) {
    if (isRenderableBlock(block, source)) return true;
  }
  return false;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const parserLoaded = () => parser !== null;

/** True once the parser is loaded; a presentation memo that lists it rebuilds when it arrives. */
export function useThinkingMarkdownParser(): boolean {
  const loaded = useSyncExternalStore(subscribe, parserLoaded, parserLoaded);
  useEffect(() => {
    if (!parser) void loadThinkingMarkdownParser();
  }, []);
  return loaded;
}

export function prefetchThinkingMarkdownParser(): void {
  whenIdle(() => {
    void loadThinkingMarkdownParser();
  });
}
