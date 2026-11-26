import { AppError } from '@shared/errors/appError';
/**
 * AgentEventBridge translates main's loop events (`AgentLoopEvent`) into the shared AgentEvent
 * contract consumed by IPC, Trace, and ConversationService.
 */

import { assertNever } from '@shared/utils/assertNever';
import { generateEventId, nowMs } from '@shared/utils/id';
import { toSharedThinkingArtifact } from './reasoning/ReasoningArtifacts';
import type {
  AgentEvent,
  AgentEventOf,
  AgentEventPayloadMap,
  AgentEventType,
  AgentRouteCapability,
} from '@shared/types/agentRuntime';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import type { ConversationLoopStopReason } from '@shared/types/conversation';
import type { AgentRole } from '@shared/types/agent';
import type {
  AgentLoopEvent,
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  ThinkingContent,
  ToolResultMessage,
  StopReason,
} from './core/types';

/** Context fields copied into the shared AgentEvent. */
export interface AgentEventBridgeContext {
  agentId?: AgentRole;
  runId?: string;
  turnId?: string;
  sessionId?: string | null;
  profileId?: string;
  providerId?: string;
  modelId?: string;
  toolAllowlist?: string[];
  routeCapability?: AgentRouteCapability;
}

/** Creates a shared AgentEvent with normalized runtime context. */
export function buildSharedAgentEvent<T extends AgentEventType>(
  type: T,
  payload: AgentEventPayloadMap[T],
  context: AgentEventBridgeContext,
): AgentEventOf<T> {
  return {
    id: generateEventId('agent-event'),
    type,
    timestamp: nowMs(),
    runId: context.runId,
    turnId: context.turnId,
    sessionId: context.sessionId ?? null,
    agentId: context.agentId,
    payload,
  };
}

export function buildDiagnosticAgentEvent(
  context: AgentEventBridgeContext,
  input: {
    code: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    technicalMessage?: string;
    toolCallId?: string;
  },
): AgentEventOf<'diagnostic'> {
  return buildSharedAgentEvent(
    'diagnostic',
    {
      code: input.code,
      severity: input.severity,
      message: input.message,
      technicalMessage: input.technicalMessage,
      toolCallId: input.toolCallId,
    },
    context,
  );
}

export function mentionsTextualToolCall(text: string): boolean {
  return /(?:tool\s*call|function\s*call|工具调用|调用工具)\s*[:：]\s*[\w.-]+\s*\(/i.test(text);
}

export function translateCoreToSharedAgentEvent(
  event: AgentLoopEvent,
  context: AgentEventBridgeContext,
): AgentEvent | null {
  switch (event.type) {
    case 'agent_start': {
      const profileId = context.profileId ?? context.agentId;
      if (!profileId) throw new AppError('AGENT_IDENTITY_MISSING', 'run.started requires a profileId or agentId');
      return buildSharedAgentEvent(
        'run.started',
        {
          profileId,
          providerId: context.providerId ?? '',
          modelId: context.modelId ?? '',
          toolAllowlist: context.toolAllowlist ?? [],
          routeCapability: context.routeCapability,
        },
        context,
      );
    }
    case 'agent_end': {
      const text = extractAssistantText(event.messages);
      return buildSharedAgentEvent(
        'run.completed',
        {
          status: 'complete',
          text,
        },
        context,
      );
    }
    case 'message_update':
      return translateAssistantMessageEvent(event.assistantMessageEvent, context);
    case 'message_end': {
      if (event.message.role === 'assistant') {
        const text = extractAssistantTextFromContent(event.message.content);
        const thinking = extractAssistantThinkingFromContent(event.message.content);
        return buildSharedAgentEvent(
          'assistant.completed',
          {
            text,
            textItems: event.message.content.flatMap((block) =>
              block.type === 'text' && block.providerOutputRef
                ? [{ text: block.text, phase: block.phase, providerOutputRef: { ...block.providerOutputRef } }]
                : [],
            ),
            thinking: thinking.length > 0 ? thinking : undefined,
            providerOutputRefs: extractAssistantTextOutputRefs(event.message.content),
            stopReason: mapCoreStopReasonToShared(event.message.stopReason),
            usage: {
              inputTokens: event.message.usage.inputTokens,
              outputTokens: event.message.usage.outputTokens,
            },
          },
          context,
        );
      }
      return null;
    }
    case 'tool_execution_start': {
      return buildSharedAgentEvent(
        'tool.started',
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          permissionState: event.permissionState,
        },
        context,
      );
    }
    case 'tool_execution_end': {
      const sharedResult = toolResultToSharedResult(event.result, event.durationMs);
      const approvalReason = getApprovalRequiredReason(event.result);
      if (approvalReason) {
        return buildSharedAgentEvent(
          'approval.requested',
          {
            approvalId: `approval-${event.toolCallId}`,
            title: `Approve ${event.toolName}`,
            status: 'pending',
            reason: approvalReason,
            kind: 'tool',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          },
          context,
        );
      }
      const denialReason = getPolicyDenialReason(event.result);
      if (denialReason) {
        return buildSharedAgentEvent(
          'tool.denied',
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            reason: denialReason,
            result: sharedResult,
          },
          context,
        );
      }
      return buildSharedAgentEvent(
        'tool.completed',
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: sharedResult,
        },
        context,
      );
    }
    case 'approval_requested': {
      return buildSharedAgentEvent(
        'approval.requested',
        {
          approvalId: `approval-${event.toolCallId}`,
          title: `Approve ${event.toolName}`,
          status: 'pending',
          reason: `Approval required before ${event.toolName} can run.`,
          kind: 'tool',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        },
        context,
      );
    }
    case 'approval_resolved': {
      return buildSharedAgentEvent(
        'approval.answered',
        {
          approvalId: `approval-${event.toolCallId}`,
          title: `Approve ${event.toolCallId}`,
          status: event.approved ? 'approved' : 'rejected',
          kind: 'tool',
          toolCallId: event.toolCallId,
        },
        context,
      );
    }
    case 'error': {
      if (event.aborted) {
        return buildSharedAgentEvent(
          'run.cancelled',
          {
            status: 'cancelled',
            error: event.error.message || String(event.error),
          },
          context,
        );
      }
      return buildSharedAgentEvent(
        'run.failed',
        {
          status: 'failed',
          error: event.error.message || String(event.error),
        },
        context,
      );
    }
    case 'compaction': {
      const { type: _type, ...progress } = event;
      return buildSharedAgentEvent('context.compacted', progress, context);
    }
    case 'diagnostic': {
      return buildSharedAgentEvent(
        'diagnostic',
        {
          code: event.code,
          severity: event.severity,
          message: event.message,
          technicalMessage: event.technicalMessage,
          phase: event.phase,
        },
        context,
      );
    }
    case 'turn_start':
    case 'turn_end':
    case 'message_start':
    case 'tool_execution_update':
      return null;
    default:
      return assertNever(event);
  }
}

/** Streamed assistant output; only the semantic boundaries and deltas the conversation projects cross over. */
function translateAssistantMessageEvent(
  ev: AssistantMessageEvent,
  context: AgentEventBridgeContext,
): AgentEvent | null {
  switch (ev.type) {
    case 'text_delta':
      return buildSharedAgentEvent(
        'assistant.delta',
        { text: ev.delta, phase: ev.phase, providerOutputRef: { ...ev.providerOutputRef } },
        context,
      );
    case 'text_end':
      return buildSharedAgentEvent(
        'assistant.text_end',
        {
          text: ev.content,
          phase: ev.phase,
          providerOutputRef: { ...ev.providerOutputRef },
        },
        context,
      );
    case 'thinking_delta':
      return buildSharedAgentEvent(
        'assistant.thinking_delta',
        {
          text: ev.delta,
          thinking: toSharedThinkingArtifact(ev.thinking),
          providerOutputRef: { ...ev.providerOutputRef },
        },
        context,
      );
    case 'thinking_end':
      return buildSharedAgentEvent(
        'assistant.thinking_end',
        {
          text: ev.content,
          thinking: toSharedThinkingArtifact(ev.thinking),
          providerOutputRef: { ...ev.providerOutputRef },
        },
        context,
      );
    case 'toolcall_end': {
      // The content block's tag and unparsed argument text are main's; the event carries the shared `ToolCall`.
      const { id, name, arguments: args } = ev.toolCall;
      return buildSharedAgentEvent(
        'tool.requested',
        { toolCall: { id, name, arguments: args }, providerOutputRef: { ...ev.providerOutputRef } },
        context,
      );
    }
    case 'start':
    case 'text_start':
    case 'thinking_start':
    case 'toolcall_start':
    case 'toolcall_delta':
    case 'done':
    case 'error':
      return null;
    default:
      return assertNever(ev);
  }
}

function mapCoreStopReasonToShared(reason: StopReason): ConversationLoopStopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'toolUse':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    case 'error':
      return 'error';
    case 'aborted':
      return 'aborted';
    default:
      return 'error';
  }
}

function getApprovalRequiredReason(result: ToolResultMessage): string | null {
  if (!result.isError) return null;
  const message = extractToolResultText(result);
  return message.toLowerCase().includes('approval required') ? message : null;
}

function getPolicyDenialReason(result: ToolResultMessage): string | null {
  if (!result.isError) return null;
  const message = extractToolResultText(result);
  return message.toLowerCase().includes('policy denied') ? message : null;
}

function extractToolResultText(result: ToolResultMessage): string {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('');
}

function extractAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      return extractAssistantTextFromContent(msg.content);
    }
  }
  return '';
}

function extractAssistantTextFromContent(content: AssistantMessage['content']): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function extractAssistantTextOutputRefs(
  content: AssistantMessage['content'],
): NonNullable<import('@shared/types/agentRuntime').AgentAssistantCompletedPayload['providerOutputRefs']> | undefined {
  const refs = content
    .filter((block) => block.type === 'text' && block.providerOutputRef)
    .map((block) => ({ ...block.providerOutputRef! }));
  return refs.length > 0 ? refs : undefined;
}

function extractAssistantThinkingFromContent(content: AssistantMessage['content']): ThinkingArtifact[] {
  return content.filter(isThinkingContent).map((block) => toSharedThinkingArtifact(block));
}

function isThinkingContent(block: AssistantMessage['content'][number]): block is ThinkingContent {
  return block.type === 'thinking';
}

function toRecordDetails(details: unknown): Record<string, unknown> | undefined {
  return details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : undefined;
}

export function toolResultToSharedResult(
  result: ToolResultMessage,
  durationMs: number,
): import('@shared/types/tool').ToolCallResult {
  if (result.isError) {
    return {
      ok: false,
      data: {},
      artifacts: [],
      error: {
        code: 'AGENT_TOOL_FAILED',
        message: extractToolResultText(result) || 'Tool execution failed.',
        category: 'execution',
        details: toRecordDetails(result.details),
      },
      duration_ms: durationMs,
      trace_id: result.toolCallId,
    };
  }
  return {
    ok: true,
    data: {
      content: result.content,
      details: result.details ?? null,
    },
    artifacts: [],
    duration_ms: durationMs,
    trace_id: result.toolCallId,
  };
}
