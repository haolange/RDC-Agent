import React, { useEffect, useRef } from 'react';
import type { AgentMode } from '@shared/types/layout';
import {
  selectConversationMessageCount,
  selectLatestMessageActivityAt,
  useConversationStore,
} from '../../stores/conversationStore';
import { ConversationThread } from './ConversationThread';
import './AgentChat.css';
import './AgentChat.markdown.css';
import './AgentChat.extras.css';
import '../../patterns/Markdown/markdown-code.css';

const STICKY_SCROLL_THRESHOLD = 96;

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const messageCount = useConversationStore(selectConversationMessageCount);
  const latestMessageActivityAt = useConversationStore(selectLatestMessageActivityAt);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const isEmpty = messageCount === 0;

  useEffect(() => {
    if (navigator.webdriver) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container || !shouldStickToBottomRef.current) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'auto',
    });
  }, [
    messageCount,
    latestMessageActivityAt,
  ]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < STICKY_SCROLL_THRESHOLD;
  };

  return (
    <div className={`agent-chat ${isEmpty ? 'is-empty' : ''}`} data-testid="agent-chat">
      <div className="chat-top-hard-stop" aria-hidden="true" />
      <div className="chat-top-transition-fade" aria-hidden="true" />
      <div
        ref={scrollContainerRef}
        className={`chat-messages scrollbar-thin ${isEmpty ? 'chat-messages-empty' : ''}`}
        data-testid="chat-messages"
        onScroll={handleScroll}
      >
        <ConversationThread mode={mode} />
      </div>
    </div>
  );
};

export default AgentChat;
