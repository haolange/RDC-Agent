import React, { useMemo, useState } from 'react';
import type { ConversationMessage } from '@shared/types/conversation';
import { useConversationStore } from '../../../stores/conversationStore';
import { ActiveSignalText } from '../../../ui/ActiveSignalText';
import { useI18n } from '../../../i18n';
import { Button } from '../../../ui/Button';
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

const findPendingToolApproval = (messages: ConversationMessage[]): PendingToolApprovalRequest | null => {
  const assistantMessages = messages
    .filter((message) => message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming'))
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const message of assistantMessages) {
    for (const block of message.workTrace?.blocks ?? []) {
      for (const toolCall of block.toolCalls) {
        if (toolCall.approval?.status !== 'pending') continue;
        return {
          sessionId: message.sessionId,
          turnId: message.turnId,
          approvalId: toolCall.approval.approvalId,
          toolCallId: toolCall.id,
          toolName: toolCall.toolName,
          question: toolCall.approval.reason?.trim()
            || block.summary?.trim()
            || 'The agent needs approval before continuing.',
          risk: (toolCall.approval.risk === 'low' || toolCall.approval.risk === 'high'
            ? toolCall.approval.risk
            : 'medium') as PendingToolApprovalRequest['risk'],
          reviewer: toolCall.approval.reviewer,
        };
      }
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
  const { t } = useI18n();
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
        <ActiveSignalText active tone="info" className="composer-tool-approval-kicker">{t('composer.toolApprovalKicker')}</ActiveSignalText>
        <p>{request.question}</p>
      </div>
      <div className="composer-tool-approval-meta" aria-label="Approval context">
        <span>{request.toolName}</span>
        <span>{t((
          {
            low: 'composer.toolApprovalRisk.low',
            medium: 'composer.toolApprovalRisk.medium',
            high: 'composer.toolApprovalRisk.high',
          } as const
        )[request.risk])}</span>
        {request.reviewer ? <span>{request.reviewer}</span> : null}
      </div>
      <div className="composer-tool-approval-actions">
        <Button
          variant="secondary"
          className="composer-tool-approval-deny"
          disabled={isSubmitting}
          onClick={() => void submitDecision(false)}
        >
          {t('composer.toolApprovalDeny')}
        </Button>
        <Button
          variant="primary"
          className="composer-tool-approval-approve"
          disabled={isSubmitting}
          onClick={() => void submitDecision(true)}
        >
          {t('composer.toolApprovalApproveOnce')}
        </Button>
      </div>
      {error ? (
        <p className="composer-user-input-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
