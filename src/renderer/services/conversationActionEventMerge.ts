import type { ConversationMessage, ConversationWorkBlock, ConversationWorkTrace } from '@shared/types/conversation';
import type { ActionEvent } from '@shared/types/evidence';

export const mergeToolExecutionActionEvent = (
  message: ConversationMessage,
  event: ActionEvent,
  nextTrace: ConversationWorkTrace,
  upsertWorkBlock: (
    trace: ConversationWorkTrace | null | undefined,
    blockId: string,
    patch: {
      kind?: ConversationWorkBlock['kind'];
      title: string;
      stage?: string;
      status: ConversationWorkBlock['status'];
      summary?: string;
      detail?: string;
      completedAt?: number;
    },
  ) => ConversationWorkTrace,
): ConversationMessage | null => {
  if (event.event_type !== 'tool_execution') {
    return null;
  }

  const eventTime = event.ts_ms;
  const stepTrace = upsertWorkBlock(nextTrace, 'tool-execution', {
    kind: 'llm_turn',
    title: 'LLM turn',
    stage: 'runtime',
    status: event.status === 'error' ? 'error' : 'running',
    summary: event.status === 'error' ? 'Tool execution failed.' : 'Recording tool execution.',
  });
  const block = stepTrace.blocks.find((entry) => entry.id === 'tool-execution');
  if (block) {
    const toolName = String(event.payload.tool_name || 'unknown_tool');
    const existingIndex = block.toolCalls.findIndex((toolCall) => toolCall.id === event.event_id);
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
      block.toolCalls[existingIndex] = nextToolCall;
    } else {
      block.toolCalls.push(nextToolCall);
    }
    block.status = block.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
    block.result = {
      text: block.status === 'error'
        ? 'Tool execution failed.'
        : 'Requested ' + block.toolCalls.length + ' tool' + (block.toolCalls.length === 1 ? '' : 's') + '.',
      status: 'complete',
      toolCallIds: block.toolCalls.map((toolCall) => toolCall.id),
    };
    block.completedAt = eventTime + event.duration_ms;
  }
  return {
    ...message,
    workTrace: stepTrace,
    updatedAt: Date.now(),
  };
};
