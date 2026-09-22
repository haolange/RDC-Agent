import React from 'react';
import { useTranscriptScroll } from './useTranscriptScroll';
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

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const messageCount = useConversationStore(selectConversationMessageCount);
  const latestMessageActivityAt = useConversationStore(selectLatestMessageActivityAt);
  const { scrollContainerRef, handleScroll } = useTranscriptScroll(messageCount, latestMessageActivityAt);
  const isEmpty = messageCount === 0;

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
