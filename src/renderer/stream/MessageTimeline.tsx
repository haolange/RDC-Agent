import React, { useState } from 'react';
import type { TimelineProjection } from '@shared/types/agentTimeline';
import type { ExpandedState } from '../services/timelineFormatters';
import { ProjectionView } from './TimelineNodeView';
import './MessageTimeline.css';

export interface MessageTimelineProps {
  projections: TimelineProjection[];
  emptyState: React.ReactNode;
}

const jumpToEvidenceNode = (id: string) => {
  const target = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  if (!target) {
    return;
  }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('amt-node-highlight');
  window.setTimeout(() => target.classList.remove('amt-node-highlight'), 1400);
};

export const MessageTimeline: React.FC<MessageTimelineProps> = ({ projections, emptyState }) => {
  const [expandedState, setExpandedState] = useState<ExpandedState>({});
  const showOnlyFailed = false;
  const collapseSuccessfulTools = true;

  const handleToggle = (id: string, expanded: boolean) => {
    setExpandedState((current) => ({ ...current, [id]: !expanded }));
  };

  if (projections.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <section className="agent-message-timeline" data-testid="agent-message-timeline">
      <div className="amt-projections">
        {projections.map((projection) => (
          <ProjectionView
            key={projection.id}
            projection={projection}
            expandedState={expandedState}
            showOnlyFailed={showOnlyFailed}
            collapseSuccessfulTools={collapseSuccessfulTools}
            onToggle={handleToggle}
            onJumpEvidence={jumpToEvidenceNode}
          />
        ))}
      </div>
    </section>
  );
};

/** @deprecated Use MessageTimeline from stream/ */
export const AgentMessageTimeline = MessageTimeline;

export default MessageTimeline;
