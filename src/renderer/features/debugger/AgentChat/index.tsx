import React, { useEffect, useRef } from 'react';
import type { AgentMode } from '@shared/types/layout';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { EmptyWorkbenchPrompt } from '../../../patterns/EmptyWorkbenchPrompt';
import { AgentRunView } from '../../../stream/AgentRunView';
import { PlanApprovalCard } from '../plan/PlanApprovalCard';
import './AgentChat.css';

const STICKY_SCROLL_THRESHOLD = 96;

export const AgentChat: React.FC<{ mode: AgentMode }> = ({ mode }) => {
  const presentation = useWorkflowStore((state) => state.tracePresentation);
  const workflowState = useWorkflowStore((state) => state.workflowState);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const itemCount = presentation?.runs.length ?? 0;
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
  }, [itemCount, presentation?.updatedAt, workflowState?.currentStage, workflowState?.approvalState]);

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
        <PlanApprovalCard />
        <AgentRunView
          presentation={presentation}
          emptyState={isEmpty ? <EmptyWorkbenchPrompt mode={mode} /> : null}
        />
      </div>
    </div>
  );
};

export default AgentChat;
