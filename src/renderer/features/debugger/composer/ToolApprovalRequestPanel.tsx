import React, { useMemo, useState } from 'react';
import type { ConversationMessage, ConversationWorkBlock } from '@shared/types/conversation';
import { useConversationStore } from '../../../stores/conversationStore';
import { useToolApprovalSubmit } from './useToolApprovalSubmit';

export interface PendingToolApprovalRequest {
  sessionId: string | null;
  turnId: string;
  approvalId: string;
  toolCallId?: string;
  toolName: string;
  question: string;
  risk: 'low' | 'medium' | 'high';
  reviewer?: string;
}

const safeParseJson = (value?: string): unknown => {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const parseApprovalDetail = (block: ConversationWorkBlock): Partial<PendingToolApprovalRequest> => {
  const parsed = safeParseJson(block.detail);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  return {
    approvalId: typeof record.approvalId === 'string' ? record.approvalId : undefined,
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
    toolName: typeof record.toolName === 'string' ? record.toolName : undefined,
    risk: record.risk === 'low' || record.risk === 'medium' || record.risk === 'high' ? record.risk : undefined,
    reviewer: typeof record.reviewer === 'string' ? record.reviewer : undefined,
  };
};

const fallbackApprovalId = (blockId: string): string => (
  blockId.startsWith('runtime-approval-')
    ? blockId.slice('runtime-approval-'.length)
    : blockId
);

const findPendingToolApproval = (messages: ConversationMessage[]): PendingToolApprovalRequest | null => {
  const assistantMessages = messages
    .filter((message) => message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming'))
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const message of assistantMessages) {
    for (const block of message.workTrace?.blocks ?? []) {
      if (block.kind !== 'approval' || block.status !== 'running') continue;

      const detail = parseApprovalDetail(block);
      const approvalId = detail.approvalId || fallbackApprovalId(block.id);
      return {
        sessionId: message.sessionId,
        turnId: message.turnId,
        approvalId,
        toolCallId: detail.toolCallId,
        toolName: detail.toolName || 'tool',
        question: block.summary?.trim() || 'The agent needs approval before continuing.',
        risk: detail.risk || 'medium',
        reviewer: detail.reviewer,
      };
    }
  }

  return null;
};

export const usePendingToolApprovalRequest = (): PendingToolApprovalRequest | null => {
  const messages = useConversationStore((state) => state.conversationMessages);
  return useMemo(() => findPendingToolApproval(messages), [messages]);
};

export const ToolApprovalRequestPanel: React.FC<{
  request: PendingToolApprovalRequest;
}> = ({ request }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitApproval = useToolApprovalSubmit();

  const submitDecision = async (approved: boolean) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitApproval(request, approved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit the approval decision.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="composer-tool-approval-panel" data-testid="composer-tool-approval-panel">
      <div className="composer-tool-approval-header">
        <span className="composer-tool-approval-kicker">Approval requested</span>
        <p>{request.question}</p>
      </div>
      <div className="composer-tool-approval-meta" aria-label="Approval context">
        <span>{request.toolName}</span>
        <span>{request.risk} risk</span>
        {request.reviewer ? <span>{request.reviewer}</span> : null}
      </div>
      <div className="composer-tool-approval-actions">
        <button
          type="button"
          className="button button-secondary composer-tool-approval-deny"
          disabled={isSubmitting}
          onClick={() => void submitDecision(false)}
        >
          Deny
        </button>
        <button
          type="button"
          className="button button-primary composer-tool-approval-approve"
          disabled={isSubmitting}
          onClick={() => void submitDecision(true)}
        >
          Approve once
        </button>
      </div>
      {error ? (
        <p className="composer-user-input-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
