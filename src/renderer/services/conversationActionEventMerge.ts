import type { ConversationMessage, ConversationReasoningTrace } from '@shared/types/conversation';
import type { ActionEvent } from '@shared/types/evidence';

export const mergeToolExecutionActionEvent = (
  message: ConversationMessage,
  event: ActionEvent,
  nextTrace: ConversationReasoningTrace,
  upsertReasoningStep: (
    trace: ConversationReasoningTrace | null | undefined,
    stepId: string,
    patch: {
      title: string;
      stage?: string;
      status: 'pending' | 'running' | 'complete' | 'error';
      summary?: string;
      detail?: string;
      completedAt?: number;
    },
  ) => ConversationReasoningTrace,
): ConversationMessage | null => {
  if (event.event_type !== 'tool_execution') {
    return null;
  }

  const eventTime = event.ts_ms;
  const stepTrace = upsertReasoningStep(nextTrace, 'tool-execution', {
    title: '工具调用',
    stage: 'investigate',
    status: event.status === 'error' ? 'error' : 'running',
    summary: event.status === 'error' ? '工具调用失败。' : '正在记录工具调用。',
  });
  const step = stepTrace.steps.find((entry) => entry.id === 'tool-execution');
  if (step) {
    const toolName = String(event.payload.tool_name || 'unknown_tool');
    const existingIndex = step.toolCalls.findIndex((toolCall) => toolCall.id === event.event_id);
    const nextToolCall = {
      id: event.event_id,
      toolName,
      status: event.status === 'error' ? 'error' as const : 'complete' as const,
      argsPreview: JSON.stringify(event.payload.args ?? {}, null, 2),
      resultPreview: event.status === 'error'
        ? String((event.payload.error as { message?: string } | undefined)?.message || event.payload.error || 'Tool execution failed')
        : JSON.stringify(event.payload.data ?? event.payload.result ?? {}, null, 2),
      error: event.status === 'error'
        ? String((event.payload.error as { message?: string } | undefined)?.message || event.payload.error || 'Tool execution failed')
        : undefined,
      startedAt: eventTime,
      completedAt: eventTime + event.duration_ms,
    };
    if (existingIndex >= 0) {
      step.toolCalls[existingIndex] = nextToolCall;
    } else {
      step.toolCalls.push(nextToolCall);
    }
    step.status = step.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
    step.summary = step.status === 'error'
      ? '工具调用中出现错误。'
      : `已记录 ${step.toolCalls.length} 个工具调用。`;
    step.completedAt = eventTime + event.duration_ms;
  }
  return {
    ...message,
    reasoningTrace: stepTrace,
    updatedAt: Date.now(),
  };
};
