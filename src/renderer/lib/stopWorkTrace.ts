import type { ConversationMessage } from '@shared/types/conversation';

export const stopWorkTrace = (message: ConversationMessage): ConversationMessage => {
  const stoppedAt = Date.now();
  // Keep the source revision so the main process's terminal message can
  // replace this optimistic projection even when it was committed earlier.
  const sourceUpdatedAt = message.updatedAt ?? message.createdAt;
  if (!message.workTrace) {
    return {
      ...message,
      status: 'stopped',
      updatedAt: sourceUpdatedAt,
    };
  }

  return {
    ...message,
    status: 'stopped',
    updatedAt: sourceUpdatedAt,
    workTrace: {
      ...message.workTrace,
      status: 'stopped',
      summary: message.workTrace.summary || 'Request stopped.',
      updatedAt: stoppedAt,
      blocks: (message.workTrace.blocks ?? []).map((block) => {
        const toolCalls = block.toolCalls.map((call) => {
          const approval = call.approval?.status === 'pending'
            ? { ...call.approval, status: 'cancelled' as const, resolvedAt: stoppedAt }
            : call.approval;
          const planReview = call.planReview?.status === 'awaiting'
            ? {
                ...call.planReview,
                status: 'rejected' as const,
                decision: call.planReview.decision ?? {
                  kind: 'reject' as const,
                  feedback: 'The request stopped before plan review.',
                },
              }
            : call.planReview;
          return {
            ...call,
            status: call.status === 'pending' ? 'skipped' as const
              : call.status === 'running' ? 'error' as const : call.status,
            completedAt: call.status === 'pending' || call.status === 'running'
              ? call.completedAt ?? stoppedAt : call.completedAt,
            resultPreview: call.status === 'pending'
              ? call.resultPreview ?? 'Run stopped before this tool call executed.'
              : call.resultPreview,
            error: call.status === 'running'
              ? call.error ?? 'Run ended before this tool call completed.'
              : call.error,
            approval,
            planReview,
          };
        });
        return {
          ...block,
          status: block.stage !== 'task' && (block.status === 'pending' || block.status === 'running')
            ? 'error' as const : block.status,
          ...(block.thinkingStatus ? { thinkingStatus: 'complete' as const } : {}),
          completedAt: block.stage === 'task' ? block.completedAt : block.completedAt ?? stoppedAt,
          result: block.kind === 'llm_turn'
            ? {
                ...block.result,
                status: 'complete' as const,
                toolCallIds: Array.from(new Set([
                  ...(block.result?.toolCallIds ?? []),
                  ...toolCalls.map((call) => call.id),
                ])),
              }
            : block.result,
          toolCalls,
        };
      }),
    },
  };
};
