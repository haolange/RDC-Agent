import type { ConversationToolCall, ConversationWorkTrace } from '../types/conversation';

export function cancelConversationToolCall(call: ConversationToolCall, at: number): ConversationToolCall {
  const active = call.status === 'pending' || call.status === 'running';
  return {
    ...call,
    ...(active ? { status: call.status === 'pending' ? 'skipped' : 'cancelled',
      completedAt: call.completedAt ?? at } : {}),
    approval: call.approval?.status === 'pending'
      ? { ...call.approval, status: 'cancelled', resolvedAt: call.approval.resolvedAt ?? at }
      : call.approval,
    planReview: call.planReview?.status === 'awaiting'
      ? { ...call.planReview, status: 'cancelled' }
      : call.planReview,
  };
}

/** Pure settlement shared by main and the optimistic renderer projection. */
export function cancelWorkTrace(trace: ConversationWorkTrace, at: number): ConversationWorkTrace {
  return {
    ...trace, status: 'stopped', summary: undefined, updatedAt: at,
    blocks: trace.blocks.map(block => {
      if (block.stage === 'task') return block;
      const toolCalls = block.toolCalls.map(call => cancelConversationToolCall(call, at));
      return {
        ...block, toolCalls,
        status: block.status === 'pending' || block.status === 'running' ? 'cancelled' : block.status,
        completedAt: block.completedAt ?? at,
        ...(block.thinkingStatus ? { thinkingStatus: 'complete' as const } : {}),
        ...(block.kind === 'llm_turn' ? { result: { ...block.result, status: 'complete' as const,
          stopReason: block.result?.status === 'streaming' ? 'aborted' as const : block.result?.stopReason,
          toolCallIds: Array.from(new Set([...(block.result?.toolCallIds ?? []), ...toolCalls.map(call => call.id)])),
        } } : {}),
      };
    }),
  };
}
