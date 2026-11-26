import { useEffect, useRef, useState } from 'react';
import { selectOrderedConversationMessages, useConversationStore } from '../../stores/conversationStore';
import { useI18n } from '../../i18n';
import type { ConversationMessage } from '@shared/types/conversation';

const ANNOUNCE_LIMIT = 300;

/** A reply as a screen reader should hear it: Markdown punctuation dropped, one paragraph, capped at a word. */
export function announcementText(markdown: string): string {
  const text = markdown
    .replace(/^\s*```.*$/gmu, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_~#>|]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text.length <= ANNOUNCE_LIMIT) return text;
  const cut = text.slice(0, ANNOUNCE_LIMIT);
  const wordEnd = cut.lastIndexOf(' ');
  return `${(wordEnd > ANNOUNCE_LIMIT * 0.6 ? cut.slice(0, wordEnd) : cut).trimEnd()}…`;
}

const isSettledReply = (message: ConversationMessage) =>
  message.role === 'assistant' &&
  message.status !== 'streaming' &&
  message.status !== 'draft' &&
  message.content.trim() !== '';

/**
 * The transcript's polite live region. Each assistant reply is read once, when it settles, so streaming text is not
 * read token by token; replies already on screen when a session opens are history and stay silent.
 */
export function ReplyAnnouncer() {
  const { t } = useI18n();
  const messages = useConversationStore(selectOrderedConversationMessages);
  const [announcement, setAnnouncement] = useState('');
  const heard = useRef<{ sessionId: string | null; ids: Set<string> } | null>(null);

  useEffect(() => {
    if (messages.length === 0) {
      heard.current = null;
      setAnnouncement('');
      return;
    }
    const settled = messages.filter(isSettledReply);
    const sessionId = messages[0].sessionId;
    const known = heard.current;
    if (!known || (known.sessionId !== null && sessionId !== null && known.sessionId !== sessionId)) {
      heard.current = { sessionId, ids: new Set(settled.map((message) => message.id)) };
      setAnnouncement('');
      return;
    }
    known.sessionId ??= sessionId;
    const fresh = settled.filter((message) => !known.ids.has(message.id));
    for (const message of fresh) known.ids.add(message.id);
    const latest = fresh.at(-1);
    if (latest) setAnnouncement(t('chat.replyAnnouncement', { text: announcementText(latest.content) }));
  }, [messages, t]);

  return (
    <div
      className="visually-hidden"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="transcript-reply-announcer"
    >
      {announcement}
    </div>
  );
}
