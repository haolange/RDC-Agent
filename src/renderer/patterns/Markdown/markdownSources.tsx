import React, { createContext, useContext, useMemo } from 'react';
import { normalizeWebUrl } from '@shared/utils/webUrl';

export interface MarkdownSource {
  url: string;
  domain: string;
  title?: string;
  summary?: string;
}

interface MarkdownSourceScope {
  /** Pages this turn really read, keyed by normalized URL. */
  sources: ReadonlyMap<string, MarkdownSource>;
  /** The session whose artifacts, attachments and project files media references resolve against. */
  sessionId: string | null;
}

const EMPTY_SCOPE: MarkdownSourceScope = { sources: new Map(), sessionId: null };
const MarkdownSourceContext = createContext<MarkdownSourceScope>(EMPTY_SCOPE);

export const MarkdownSourceProvider: React.FC<{
  sources: readonly MarkdownSource[];
  sessionId?: string | null;
  children: React.ReactNode;
}> = ({ sources, sessionId = null, children }) => {
  const value = useMemo<MarkdownSourceScope>(
    () => ({
      sources: new Map(sources.map((source) => [normalizeWebUrl(source.url), source])),
      sessionId,
    }),
    [sources, sessionId],
  );
  return <MarkdownSourceContext.Provider value={value}>{children}</MarkdownSourceContext.Provider>;
};

export const useMarkdownSourceScope = (): MarkdownSourceScope => useContext(MarkdownSourceContext);

/** Links in an answer that point at a page this turn read, in the order the answer first cites them. */
export function citedSources(content: string, sources: ReadonlyMap<string, MarkdownSource>): MarkdownSource[] {
  const cited = new Map<string, MarkdownSource>();
  for (const match of content.matchAll(/\]\(\s*<?(https?:\/\/[^)\s>]+)>?/g)) {
    const key = normalizeWebUrl(match[1]);
    const source = sources.get(key);
    if (source && !cited.has(key)) cited.set(key, source);
  }
  return [...cited.values()];
}
