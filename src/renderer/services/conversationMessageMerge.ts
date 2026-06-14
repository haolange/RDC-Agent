import type {
  ConversationMessage,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ActionEvent } from '@shared/types/evidence';
import type { ToolTraceEntry } from '@shared/types/tool';
import { mergeToolExecutionActionEvent } from './conversationActionEventMerge';

const cloneWorkTrace = (trace: ConversationWorkTrace | null | undefined): ConversationWorkTrace => (
  trace
    ? {
        ...trace,
        blocks: trace.blocks.map((block) => ({
          ...block,
          toolCalls: block.toolCalls.map((toolCall) => ({ ...toolCall })),
        })),
      }
    : {
        status: 'idle',
        blocks: [],
        updatedAt: Date.now(),
      }
);

const upsertWorkBlock = (
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
): ConversationWorkTrace => {
  const nextTrace = cloneWorkTrace(trace);
  const nextIndex = nextTrace.blocks.findIndex((block) => block.id === blockId);
  if (nextIndex >= 0) {
    nextTrace.blocks[nextIndex] = {
      ...nextTrace.blocks[nextIndex],
      ...patch,
      kind: patch.kind ?? nextTrace.blocks[nextIndex].kind,
    };
  } else {
    nextTrace.blocks.push({
      id: blockId,
      kind: patch.kind ?? 'diagnostic',
      title: patch.title,
      stage: patch.stage,
      status: patch.status,
      summary: patch.summary,
      detail: patch.detail,
      toolCalls: [],
      startedAt: Date.now(),
      completedAt: patch.completedAt,
    });
  }
  nextTrace.status = patch.status === 'error' ? 'error' : 'running';
  nextTrace.updatedAt = Date.now();
  return nextTrace;
};

export const applyToolTraceToMessage = (message: ConversationMessage, trace: ToolTraceEntry): ConversationMessage => {
  const nextTrace = upsertWorkBlock(message.workTrace ?? null, 'tool-execution', {
    kind: 'tool',
    title: '工具调用',
    stage: 'runtime',
    status: trace.result.ok ? 'running' : 'error',
    summary: trace.result.ok ? '正在执行工具调用。' : '工具调用失败。',
  });
  const block = nextTrace.blocks.find((entry) => entry.id === 'tool-execution');
  if (block) {
    const existingIndex = block.toolCalls.findIndex((toolCall) => toolCall.id === trace.traceId);
    const nextToolCall = {
      id: trace.traceId,
      toolName: trace.toolName,
      status: trace.result.ok ? 'complete' as const : 'error' as const,
      argsPreview: JSON.stringify(trace.args, null, 2),
      resultPreview: trace.result.ok
        ? JSON.stringify(trace.result.data ?? trace.result.artifacts ?? {}, null, 2)
        : trace.result.error?.message,
      error: trace.result.error?.message,
      startedAt: trace.timestamp,
      completedAt: trace.timestamp + trace.result.duration_ms,
    };

    if (existingIndex >= 0) {
      block.toolCalls[existingIndex] = nextToolCall;
    } else {
      block.toolCalls.push(nextToolCall);
    }
    block.status = block.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
    block.summary = block.status === 'error'
      ? '工具调用中出现错误。'
      : `已记录 ${block.toolCalls.length} 个工具调用。`;
    block.completedAt = Date.now();
  }

  nextTrace.status = block?.status === 'error' ? 'error' : 'running';

  return {
    ...message,
    workTrace: nextTrace,
    updatedAt: Date.now(),
  };
};

export const applyActionEventToMessage = (message: ConversationMessage, event: ActionEvent): ConversationMessage => {
  if (!event.turn_id || message.turnId !== event.turn_id || message.role !== 'assistant') {
    return message;
  }

  const nextTrace = cloneWorkTrace(message.workTrace ?? null);
  const eventTime = event.ts_ms;

  const toolMerged = mergeToolExecutionActionEvent(message, event, nextTrace, upsertWorkBlock);
  if (toolMerged) {
    return toolMerged;
  }

  const stage = typeof event.payload.toStage === 'string'
    ? event.payload.toStage
    : typeof event.payload.stage === 'string'
      ? event.payload.stage
      : undefined;
  const blockId = `${event.event_type}:${stage || event.event_id}`;
  const summary = String(
    event.payload.summary
    || event.payload.reason
    || event.payload.objective
    || event.payload.content
    || event.payload.verdict
    || event.payload.toStage
    || event.event_type,
  );
  const nextBlockTrace = upsertWorkBlock(nextTrace, blockId, {
    kind: event.status === 'error' || event.status === 'blocked' || event.status === 'fail'
      ? 'diagnostic'
      : 'output',
    title: stage ? `阶段：${stage}` : event.event_type,
    stage,
    status: event.status === 'error' || event.status === 'blocked' || event.status === 'fail'
      ? 'error'
      : 'complete',
    summary,
    detail: JSON.stringify(event.payload, null, 2),
    completedAt: eventTime + event.duration_ms,
  });
  nextBlockTrace.status = event.status === 'error' || event.status === 'blocked' || event.status === 'fail'
    ? 'error'
    : 'running';

  return {
    ...message,
    workTrace: nextBlockTrace,
    updatedAt: Date.now(),
  };
};

export const hydrateMessagesWithActionEvents = (
  messages: ConversationMessage[],
  events: ActionEvent[],
): ConversationMessage[] => {
  const sortedEvents = events
    .slice()
    .sort((left, right) => left.ts_ms - right.ts_ms);

  return messages.map((message) => sortedEvents.reduce(
    (currentMessage, event) => applyActionEventToMessage(currentMessage, event),
    message,
  ));
};
