import type { ConversationMessage } from '@shared/types/conversation';

/**
 * Tools whose results come from outside the model. A URL they returned, or one the person wrote, was not invented by
 * the model, so an image at that URL may load by itself; any other URL loads only when the person asks.
 */
const NON_MODEL_TOOLS = new Set(['web_fetch', 'web_search', 'knowledge_browse', 'knowledge_search', 'knowledge_read']);
const HTTPS_URL = /https:\/\/[^\s<>"'`()[\]{}]+/gu;
const SESSION_LIMIT = 8;

/** The comparable form of an https URL (no fragment, trailing sentence punctuation dropped); null for anything else. */
export function normalizeRemoteImageUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim().replace(/[.,;:!?]+$/u, ''));
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function nonModelTexts(message: ConversationMessage): string[] {
  if (message.role === 'user') return [message.content];
  if (message.role !== 'assistant') return [];
  return (message.workTrace?.blocks ?? []).flatMap((block) => block.toolCalls)
    .filter((call) => NON_MODEL_TOOLS.has(call.toolName) && call.status === 'complete')
    .map((call) => call.resultPreview ?? '');
}

/**
 * Per session, the https URLs that appeared in non-model sources. Built from the session history the first time a
 * session asks and rebuilt when its history changed since; the history read is the store's cached copy.
 */
export class RemoteImageProvenance {
  private readonly bySession = new Map<string, { stamp: string; urls: Set<string> }>();

  constructor(private readonly readHistory: (sessionId: string) => ConversationMessage[]) {}

  isFromNonModelSource(sessionId: string, url: string): boolean {
    const normalized = normalizeRemoteImageUrl(url);
    if (!normalized) return false;
    const history = this.readHistory(sessionId);
    const last = history.at(-1);
    const stamp = `${history.length}:${last?.id ?? ''}:${last?.updatedAt ?? last?.createdAt ?? 0}`;
    let entry = this.bySession.get(sessionId);
    if (entry?.stamp !== stamp) {
      const urls = new Set<string>();
      for (const message of history) {
        for (const text of nonModelTexts(message)) {
          for (const match of text.matchAll(HTTPS_URL)) {
            const found = normalizeRemoteImageUrl(match[0]);
            if (found) urls.add(found);
          }
        }
      }
      entry = { stamp, urls };
    }
    this.bySession.delete(sessionId);
    this.bySession.set(sessionId, entry);
    if (this.bySession.size > SESSION_LIMIT) this.bySession.delete(this.bySession.keys().next().value!);
    return entry.urls.has(normalized);
  }
}
