import { normalizeWebUrl, webHostname } from '@shared/utils/webUrl';
import { parsePreview } from './workProcessContentText';
import { extractWebToolPresentation } from './workProcessWebPresentation';
import type { MarkdownSource } from '../../patterns/Markdown/markdownSources';
import type { ConversationWorkTrace } from '@shared/types/conversation';

/**
 * Pages this turn really read: the web resources completed reads proved (`resourceRefs`), titled from the read and
 * summarized by the search result that led to it. Search engines' own addresses are never sources.
 */
export function answerSources(trace: ConversationWorkTrace | null | undefined): MarkdownSource[] {
  if (!trace) return [];
  const calls = trace.blocks.flatMap((block) => block.toolCalls);
  const snippets = new Map<string, string>();
  for (const call of calls) {
    if (call.toolName !== 'web_search' || call.status !== 'complete') continue;
    const { webPages } = extractWebToolPresentation(call.toolName, parsePreview(call.resultPreview), call.argsPreview, 'complete');
    for (const page of webPages ?? []) if (page.url && page.snippet) snippets.set(normalizeWebUrl(page.url), page.snippet);
  }
  const sources = new Map<string, MarkdownSource>();
  for (const call of calls) {
    if (call.toolName !== 'web_fetch' || call.status !== 'complete') continue;
    for (const ref of call.resourceRefs ?? []) {
      if (ref.kind !== 'web' || !ref.url) continue;
      const key = normalizeWebUrl(ref.url);
      const domain = webHostname(ref.url);
      const title = ref.label && ref.label !== ref.url && ref.label.replace(/^www\./, '') !== domain ? ref.label : undefined;
      if (!sources.has(key)) sources.set(key, { url: ref.url, domain, ...(title ? { title } : {}), ...(snippets.has(key) ? { summary: snippets.get(key) } : {}) });
    }
  }
  return [...sources.values()];
}
