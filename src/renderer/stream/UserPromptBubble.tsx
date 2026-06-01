import React from 'react';
import type { AgentNode } from '@shared/types/agentTimeline';
import { formatTime } from '../services/timelineFormatters';
import { DocumentContent } from './TimelinePrimitives';

export const UserPromptBubble: React.FC<{ node: AgentNode }> = ({ node }) => {
  const summary = node.summary ?? '';
  const isDocument = summary.length > 220 || summary.includes('\n');
  return (
    <article className={`amt-user-message chat-message user ${isDocument ? 'is-document' : ''}`} data-testid="agent-timeline-user-message" data-node-id={node.id}>
      <div className="amt-avatar amt-user-avatar" aria-hidden="true">人</div>
      <div className="amt-user-bubble message-bubble" data-testid="conversation-user-brief">
        {isDocument ? <DocumentContent content={summary} /> : <p>{summary}</p>}
        <span className="amt-message-time">{formatTime(node.createdAt)}</span>
      </div>
    </article>
  );
};
