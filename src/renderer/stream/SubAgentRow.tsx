import React from 'react';
import type { AgentNode } from '@shared/types/agentTimeline';
import type { SubAgentRunPayload } from '@shared/types/agentTimeline';
import { getPayload } from '../services/timelineFormatters';
import { StatusBadge } from './TimelinePrimitives';

export const SubAgentRow: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<SubAgentRunPayload>(node);
  const confidence = payload?.confidence !== undefined ? `${Math.round(payload.confidence * 100)}%` : null;

  return (
    <article className={`amt-subagent-card amt-node-status-${node.status}`} data-testid="agent-timeline-subagent" data-node-id={node.id}>
      <div className="amt-subagent-icon" aria-hidden="true">◆</div>
      <div className="amt-subagent-main">
        <div className="amt-subagent-title-row">
          <strong>{payload?.agentName ?? node.title}</strong>
          <StatusBadge status={node.status} />
        </div>
        <p>{payload?.outputSummary ?? node.summary}</p>
        <span className="amt-muted">{payload?.agentRole ?? payload?.objective}</span>
      </div>
      {confidence ? <span className="amt-subagent-confidence">{confidence}</span> : null}
    </article>
  );
};
