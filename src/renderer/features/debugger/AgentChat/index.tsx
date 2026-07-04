import React, { useEffect, useRef } from 'react';
import type { AgentMode } from '@shared/types/layout';
import { useConversationStore } from '../../../stores/conversationStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { ConversationThread } from './ConversationThread';
import './AgentChat.css';
import './markdown-code.css';

const STICKY_SCROLL_THRESHOLD = 96;

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const messages = useConversationStore((state) => state.conversationMessages);
  const workflowState = useWorkflowStore((state) => state.workflowState);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const messageCount = messages.length;
  const isEmpty = messageCount === 0;

  // Track the latest message updatedAt so streaming patches re-trigger the
  // sticky scroll effect even when the message count stays the same.
  const latestMessageActivityAt = messages.reduce<number>((max, message) => {
    const candidate = message.updatedAt ?? message.createdAt;
    return candidate > max ? candidate : max;
  }, 0);

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
      behavior: 'smooth',
    });
  }, [
    messageCount,
    latestMessageActivityAt,
    workflowState?.currentStage,
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
