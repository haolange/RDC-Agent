/**
 * LegacyEventBridge — 把新 Agent Runtime 的 `core.AgentEvent` 翻译为
 * 旧 `@shared/types/agentRuntime.AgentEvent`。
 *
 * 旧 AgentEvent 是 IPC / Trace / ConversationService 的稳定契约
 * （IPC 广播事件名固定），本任务范围内不允许修改其结构；
 * 因此 AgentOrchestrator / ConversationService 对外仍然消费旧事件，
 * 只在内部用此模块完成翻译。
 */

import type {
  AgentEvent as LegacyAgentEvent,
  AgentEventPayload,
  AgentEventType,
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

/** 构建旧 AgentEvent 的可选上下文字段。 */
export interface LegacyEventContext {
  agentId?: AgentRole;
  runId?: string;
  turnId?: string;
  sessionId?: string | null;
  stage?: WorkflowStage | 'cowork' | 'report';
  phase?: WorkflowPhase;
  mode?: AppMode;
  patternId?: string;
  providerId?: string;
  modelId?: string;
  toolAllowlist?: string[];
}

/** 创建一个携带统一上下文的旧 AgentEvent。 */
function buildLegacyEvent(
  type: AgentEventType,
  payload: AgentEventPayload,
  context: LegacyEventContext,
): LegacyAgentEvent {
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

/**
 * 把核心 AgentEvent 翻译成 0~1 个旧 AgentEvent。
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
export function translateCoreToLegacy(
  event: CoreAgentEvent,
  context: LegacyEventContext,
): LegacyAgentEvent | null {
  switch (event.type) {
    case 'agent_start': {
      return buildLegacyEvent(
        'run.started',
        {
          mode: context.mode ?? 'debugger',
          patternId: context.patternId,
          providerId: context.providerId ?? '',
          modelId: context.modelId ?? '',
          toolAllowlist: context.toolAllowlist ?? [],
        },
        context,
      );
    }
    case 'agent_end': {
      const text = extractAssistantText(event.messages);
      return buildLegacyEvent(
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
        return buildLegacyEvent('assistant.delta', { text: ev.delta }, context);
      }
      return null;
    }
    case 'message_end': {
      if (event.message.role === 'assistant') {
        const text = event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('');
        return buildLegacyEvent(
          'assistant.completed',
          {
            text,
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
      return buildLegacyEvent(
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
      return buildLegacyEvent(
        'tool.completed',
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: toolResultToLegacy(event.result, event.durationMs),
        },
        context,
      );
    }
    case 'error': {
      return buildLegacyEvent(
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

function extractAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      return msg.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { text: string }).text)
        .join('');
    }
  }
  return '';
}

function toolResultToLegacy(result: ToolResultMessage, durationMs: number): import('@shared/types/tool').ToolCallResult {
  if (result.isError) {
    return {
      ok: false,
      data: {},
      artifacts: [],
      error: {
        code: 'AGENT_TOOL_FAILED',
        message: result.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('') || 'Tool execution failed.',
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
