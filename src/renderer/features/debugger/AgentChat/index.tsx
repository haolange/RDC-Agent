import React, { useEffect, useRef } from 'react';
import type { AgentMode } from '@shared/types/layout';
import { useSessionStore } from '../../../stores/sessionStore';
import { EmptyWorkbenchPrompt } from '../../../patterns/EmptyWorkbenchPrompt';
import { AgentWorkstream } from '../AgentWorkstream';
import './AgentChat.css';

const STICKY_SCROLL_THRESHOLD = 96;

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const presentation = useSessionStore((state) => state.workstreamPresentation);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const itemCount = presentation?.items.length ?? 0;
  const isEmpty = itemCount === 0;

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
  }, [itemCount, presentation?.updatedAt]);

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
        <AgentWorkstream
          presentation={presentation}
          emptyState={<EmptyWorkbenchPrompt mode={mode} />}
        />
      </div>
    </div>
  );
};

export default AgentChat;

