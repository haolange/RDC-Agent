import React from 'react';
import type { AgentNode } from '@shared/types/agentTimeline';
import type { ConversationMessageDiagnostic } from '@shared/types/conversation';
import { formatTime, getPayload } from '../services/timelineFormatters';
import { DocumentContent } from './TimelinePrimitives';

interface AssistantMessagePayload {
  diagnostic?: ConversationMessageDiagnostic | null;
}

export const AgentThinkingBubble: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<AssistantMessagePayload>(node);
  const diagnostic = payload?.diagnostic ?? null;
  const routeLabel = [diagnostic?.providerId, diagnostic?.modelId].filter(Boolean).join('/');
  const summary = node.summary ?? '';

  return (
    <article
      className={`amt-assistant-message chat-message assistant ${diagnostic ? 'has-diagnostic' : ''}`}
      data-testid="agent-timeline-assistant-message"
      data-node-id={node.id}
    >
      <div className="amt-avatar amt-assistant-avatar" aria-hidden="true">A</div>
      <div className="amt-assistant-bubble message-bubble" data-testid="conversation-assistant-card">
        <div>
          <DocumentContent content={summary} testId="assistant-document-flow" />
          {diagnostic ? (
            <div className={`amt-assistant-diagnostic is-${diagnostic.severity}`} data-testid="conversation-message-diagnostic">
              <strong>模型链路诊断</strong>
              <span>{diagnostic.code}</span>
              {routeLabel ? <span>{routeLabel}</span> : null}
              {diagnostic.technicalMessage ? <code>{diagnostic.technicalMessage}</code> : null}
            </div>
          ) : null}
          <span className="amt-message-time">{formatTime(node.createdAt)}</span>
        </div>
      </div>
    </article>
  );
};
