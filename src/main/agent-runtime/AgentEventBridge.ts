/**
 * AgentEventBridge translates core runtime events into the shared AgentEvent
 * contract consumed by IPC, Trace, and ConversationService.
 */

import type {
  AgentEvent as SharedAgentEvent,
  AgentEventPayload,
  AgentEventType,
  AgentRouteCapability,
} from '@shared/types/agentRuntime';
import type { AgentRole } from '@shared/types/agent';
import type { AppMode } from '@shared/types/session';
import type { WorkflowPhase, WorkflowStage } from '@shared/types/workflow';
import { generateEventId, nowMs } from '@shared/utils/id';
import type {
  AgentEvent as CoreAgentEvent,
  AssistantMessageEvent,
  Message,
  ToolResultMessage,
} from './core/types';

/** Context fields copied into the shared AgentEvent. */
export interface AgentEventBridgeContext {
  agentId?: AgentRole;
  runId?: string;
  turnId?: string;
  sessionId?: string | null;
  stage?: WorkflowStage | 'report';
  phase?: WorkflowPhase;
  mode?: AppMode;
  patternId?: string;
  providerId?: string;
  modelId?: string;
  toolAllowlist?: string[];
  routeCapability?: AgentRouteCapability;
}

/** Creates a shared AgentEvent with normalized runtime context. */
export function buildSharedAgentEvent(
  type: AgentEventType,
  payload: AgentEventPayload,
  context: AgentEventBridgeContext,
): SharedAgentEvent {
  return {
    id: generateEventId('agent-event'),
    type,
    timestamp: nowMs(),
    runId: context.runId,
    turnId: context.turnId,
    sessionId: context.sessionId ?? null,
    agentId: context.agentId,
    stage: context.stage,
    phase: context.phase,
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
  },
): SharedAgentEvent {
  return buildSharedAgentEvent(
    'diagnostic',
    {
      code: input.code,
      severity: input.severity,
      message: input.message,
      technicalMessage: input.technicalMessage,
    },
    context,
  );
}

export function mentionsTextualToolCall(text: string): boolean {
  return /(?:tool\s*call|function\s*call|工具调用|调用工具)\s*[:：]\s*[\w.-]+\s*\(/i.test(text);
}

/**
 * Translates one core AgentEvent into zero or one shared AgentEvent.
 *
 * 翻译规则：
 *  - `agent_start` → `run.started`
 *  - `agent_end`   → `run.completed`
 *  - `message_update`（text_delta） → `assistant.delta`
 *  - `message_end`（assistant 文本） → `assistant.completed`
 *  - `tool_execution_start` → `tool.started`
 *  - `tool_execution_end`   → `tool.completed`
 *  - `error`               → `run.failed`
 *  - 其它事件返回 null（不翻译）。
 */
export function translateCoreToSharedAgentEvent(
  event: CoreAgentEvent,
  context: AgentEventBridgeContext,
): SharedAgentEvent | null {
  switch (event.type) {
    case 'agent_start': {
      return buildSharedAgentEvent(
        'run.started',
        {
          mode: context.mode ?? 'debugger',
          patternId: context.patternId,
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
    case 'message_update': {
      const ev = event.assistantMessageEvent as AssistantMessageEvent;
      if (ev.type === 'text_delta') {
        return buildSharedAgentEvent('assistant.delta', { text: ev.delta }, context);
      }
      if (ev.type === 'thinking_delta') {
        return buildSharedAgentEvent('assistant.thinking_delta', { text: ev.delta }, context);
      }
      if (ev.type === 'thinking_end') {
        return buildSharedAgentEvent('assistant.thinking_end', { text: ev.content }, context);
      }
      if (ev.type === 'thinking_start') {
        return null;
      }
      if (ev.type === 'toolcall_end') {
        return buildSharedAgentEvent(
          'tool.requested',
          {
            toolCall: {
              id: ev.toolCall.id,
              name: ev.toolCall.name,
              arguments: ev.toolCall.arguments,
            },
          },
          context,
        );
      }
      return null;
    }
    case 'message_end': {
      if (event.message.role === 'assistant') {
        const text = extractAssistantTextFromContent(event.message.content);
        const thinkingText = extractAssistantThinkingFromContent(event.message.content);
        return buildSharedAgentEvent(
          'assistant.completed',
          {
            text,
            thinkingText: thinkingText || undefined,
            usage: event.message.usage
              ? {
                  inputTokens: event.message.usage.inputTokens,
                  outputTokens: event.message.usage.outputTokens,
                }
              : undefined,
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
      return buildSharedAgentEvent(
        'run.failed',
        {
          status: 'failed',
          error: event.error.message || String(event.error),
        },
        context,
      );
    }
    default:
      return null;
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

function extractAssistantTextFromContent(
  content: Array<{ type: string; text?: string; thinking?: string }>,
): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

function extractAssistantThinkingFromContent(
  content: Array<{ type: string; text?: string; thinking?: string }>,
): string {
  return content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking ?? '')
    .join('');
}

function toolResultToSharedResult(result: ToolResultMessage, durationMs: number): import('@shared/types/tool').ToolCallResult {
  if (result.isError) {
    return {
      ok: false,
      data: {},
      artifacts: [],
      error: {
        code: 'AGENT_TOOL_FAILED',
        message: extractToolResultText(result) || 'Tool execution failed.',
        category: 'execution',
      },
      duration_ms: durationMs,
      trace_id: result.toolCallId,
    };
  }
  return {
    ok: true,
    data: {
      content: result.content,
    },
    artifacts: [],
    duration_ms: durationMs,
    trace_id: result.toolCallId,
  };
}
