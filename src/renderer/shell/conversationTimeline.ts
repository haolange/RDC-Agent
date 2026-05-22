import type { AgentTimelineEntry } from '@shared/types/agent';
import type {
  ConversationMessage,
  ConversationReasoningTrace,
} from '@shared/types/conversation';
import type { ActionEvent } from '@shared/types/evidence';
import type { CaptureDescriptor, ContextSnapshot } from '@shared/types/session';
import type { ToolTraceEntry } from '@shared/types/tool';

export const mergeCapturesWithSnapshot = (
  currentCaptures: CaptureDescriptor[],
  snapshot: ContextSnapshot,
): CaptureDescriptor[] => {
  if (!snapshot.captureDescriptors?.length) {
    return currentCaptures;
  }

  const incomingById = new Map(snapshot.captureDescriptors.map((capture) => [capture.id, capture]));
  const merged = currentCaptures.map((capture) => {
    const incoming = incomingById.get(capture.id);
    return incoming ? { ...capture, ...incoming } : capture;
  });

  snapshot.captureDescriptors.forEach((capture) => {
    if (!merged.some((entry) => entry.id === capture.id)) {
      merged.push(capture);
    }
  });

  return merged;
};

export const mapActionEventToTimelineEntry = (event: ActionEvent): AgentTimelineEntry | null => {
  switch (event.event_type) {
    case 'user_message':
      if (String(event.payload.role || 'user') !== 'user') {
        return null;
      }
      return {
        id: event.event_id,
        type: 'user',
        content: String(event.payload.content || ''),
        timestamp: event.ts_ms,
      };
    case 'agent_summary':
      if (String(event.payload.role || '') === 'assistant') {
        return {
          id: event.event_id,
          type: 'agent',
          agentRole: event.agent_id as AgentTimelineEntry['agentRole'],
          content: String(event.payload.content || event.payload.summary || ''),
          actionEvent: event,
          timestamp: event.ts_ms,
        };
      }
      return null;
    case 'system':
      if (!event.payload.message) {
        return null;
      }
      return {
        id: event.event_id,
        type: 'system',
        title: 'System',
        status: event.status,
        content: String(event.payload.message || ''),
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'report_published':
      return {
        id: event.event_id,
        type: 'system',
        title: 'Report',
        content: `璋冭瘯鎶ュ憡宸茬敓鎴愶細${String(event.payload.htmlPath || event.payload.markdownPath || 'reports ready')}`,
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    default:
      return null;
  }
};

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

  if (event.event_type === 'tool_execution') {
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

  return messages.map((message) => (
    sortedEvents.reduce((currentMessage, event) => applyActionEventToMessage(currentMessage, event), message)
  ));
};
