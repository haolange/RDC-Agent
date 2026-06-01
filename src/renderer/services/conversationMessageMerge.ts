import type {
  ConversationMessage,
  ConversationReasoningTrace,
} from '@shared/types/conversation';
import type { ActionEvent } from '@shared/types/evidence';
import type { ToolTraceEntry } from '@shared/types/tool';
import { mergeToolExecutionActionEvent } from './conversationActionEventMerge';

const cloneReasoningTrace = (trace: ConversationReasoningTrace | null | undefined): ConversationReasoningTrace => (
  trace
    ? {
        ...trace,
        steps: trace.steps.map((step) => ({
          ...step,
          toolCalls: step.toolCalls.map((toolCall) => ({ ...toolCall })),
        })),
      }
    : {
        status: 'idle',
        steps: [],
        updatedAt: Date.now(),
      }
);

const upsertReasoningStep = (
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
): ConversationReasoningTrace => {
  const nextTrace = cloneReasoningTrace(trace);
  const nextIndex = nextTrace.steps.findIndex((step) => step.id === stepId);
  if (nextIndex >= 0) {
    nextTrace.steps[nextIndex] = {
      ...nextTrace.steps[nextIndex],
      ...patch,
    };
  } else {
    nextTrace.steps.push({
      id: stepId,
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
  const nextTrace = upsertReasoningStep(message.reasoningTrace, 'tool-execution', {
    title: '工具调用',
    stage: 'investigate',
    status: trace.result.ok ? 'running' : 'error',
    summary: trace.result.ok ? '正在执行工具调用。' : '工具调用失败。',
  });
  const step = nextTrace.steps.find((entry) => entry.id === 'tool-execution');
  if (step) {
    const existingIndex = step.toolCalls.findIndex((toolCall) => toolCall.id === trace.traceId);
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
      step.toolCalls[existingIndex] = nextToolCall;
    } else {
      step.toolCalls.push(nextToolCall);
    }
    step.status = step.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
    step.summary = step.status === 'error'
      ? '工具调用中出现错误。'
      : `已记录 ${step.toolCalls.length} 个工具调用。`;
    step.completedAt = Date.now();
  }

  nextTrace.status = step?.status === 'error' ? 'error' : 'running';

  return {
    ...message,
    reasoningTrace: nextTrace,
    updatedAt: Date.now(),
  };
};

export const applyActionEventToMessage = (message: ConversationMessage, event: ActionEvent): ConversationMessage => {
  if (!event.turn_id || message.turnId !== event.turn_id || message.role !== 'assistant') {
    return message;
  }

  const nextTrace = cloneReasoningTrace(message.reasoningTrace);
  const eventTime = event.ts_ms;

  const toolMerged = mergeToolExecutionActionEvent(message, event, nextTrace, upsertReasoningStep);
  if (toolMerged) {
    return toolMerged;
  }

  const stage = typeof event.payload.toStage === 'string'
    ? event.payload.toStage
    : typeof event.payload.stage === 'string'
      ? event.payload.stage
      : undefined;
  const stepId = `${event.event_type}:${stage || event.event_id}`;
  const summary = String(
    event.payload.summary
    || event.payload.reason
    || event.payload.objective
    || event.payload.content
    || event.payload.verdict
    || event.payload.toStage
    || event.event_type,
  );
  const nextStepTrace = upsertReasoningStep(nextTrace, stepId, {
    title: stage ? `阶段：${stage}` : event.event_type,
    stage,
    status: event.status === 'error' || event.status === 'blocked' || event.status === 'fail'
      ? 'error'
      : 'complete',
    summary,
    detail: JSON.stringify(event.payload, null, 2),
    completedAt: eventTime + event.duration_ms,
  });
  nextStepTrace.status = event.status === 'error' || event.status === 'blocked' || event.status === 'fail'
    ? 'error'
    : 'running';

  return {
    ...message,
    reasoningTrace: nextStepTrace,
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
