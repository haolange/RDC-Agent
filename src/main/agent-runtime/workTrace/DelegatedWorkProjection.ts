import { assertNever } from '@shared/utils/assertNever';
import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import { loopTextItems, sameProviderBlock } from '@shared/conversation/loopItems';
import { resolveConversationLoopOutputPhase } from '@shared/conversation/loopOutputPhase';
import { safeDelegationText as safeText } from './DelegationTraceText';
import { mergeThinkingPayload } from './ConversationThinkingArtifacts';
import { shouldProjectDiagnosticToWorkProcess } from './workProcessDiagnosticPolicy';
import {
  attachRuntimeHookDiagnostic,
  discardLoopAttempt,
  settleLoopItems,
  upsertLoopResult,
  upsertLoopTextItem,
  upsertLoopThinkingItem,
  upsertRuntimeToolApproval,
  upsertRuntimeToolCall,
  upsertWorkBlock,
} from './ConversationWorkTrace';
import { normalizeTaskSnapshotItems } from './ConversationTaskSnapshot';
import type { AgentEvent } from '@shared/types/agentRuntime';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import type { ProviderOutputRef, ThinkingArtifact } from '@shared/types/reasoning';

export interface DelegatedProjectionState {
  trace: ConversationWorkTrace;
  loop: number;
  loopText: string;
  hasTools: boolean;
  nextLoop: boolean;
}

export function createDelegatedProjectionState(): DelegatedProjectionState {
  return {
    trace: { status: 'running', blocks: [], updatedAt: Date.now() },
    loop: 0,
    loopText: '',
    hasTools: false,
    nextLoop: false,
  };
}

function safeThinking(value: ThinkingArtifact | undefined): ThinkingArtifact | undefined {
  if (!value || value.kind === 'opaque' || value.visibility === 'hidden') return undefined;
  return {
    kind: value.kind,
    source: value.source,
    visibility: value.visibility,
    providerOutputRef: value.providerOutputRef ? { ...value.providerOutputRef } : undefined,
    text: value.text ? safeText(value.text) : undefined,
  };
}

/** Pure visible-process reducer. Main and child execution use the same canonical block/upsert semantics. */
export function projectDelegatedEvent(state: DelegatedProjectionState, event: AgentEvent): DelegatedProjectionState {
  let { trace, loop, loopText, hasTools, nextLoop } = state;
  const loopId = () => `loop-${loop}`;
  const beginContent = () => {
    if (!nextLoop) return;
    loop += 1;
    loopText = '';
    hasTools = false;
    nextLoop = false;
  };
  const loopOptions = () => ({ loopId: loopId() });
  const loopItem = (kind: 'text' | 'thinking', ref: ProviderOutputRef) =>
    trace.blocks
      .find((block) => block.id === loopId())
      ?.items?.find((item) => item.kind === kind && sameProviderBlock(item.providerOutputRef, ref));
  switch (event.type) {
    case 'assistant.delta': {
      const delta = event.payload;
      const chunk = safeText(delta.text);
      if (chunk) {
        beginContent();
        loopText += chunk;
        const previous = loopItem('text', delta.providerOutputRef);
        trace = upsertLoopResult(trace, loopId(), {
          status: 'streaming',
          outputPhase: hasTools ? 'commentary' : undefined,
        });
        trace = upsertLoopTextItem(
          trace,
          loopId(),
          delta.providerOutputRef,
          (previous?.kind === 'text' ? previous.text : '') + chunk,
          delta.phase,
          'streaming',
        );
      }
      break;
    }
    case 'assistant.text_end': {
      const item = event.payload;
      beginContent();
      trace = upsertLoopTextItem(trace, loopId(), item.providerOutputRef, safeText(item.text), item.phase, 'complete');
      break;
    }
    case 'assistant.thinking_delta':
    case 'assistant.thinking_end': {
      const { thinking: incoming, providerOutputRef: ref, text } = event.payload;
      if (incoming?.kind === 'opaque' || incoming?.visibility === 'hidden') return state;
      beginContent();
      const previous = loopItem('thinking', ref);
      const thinking = safeThinking(
        mergeThinkingPayload(
          previous?.kind === 'thinking' ? previous.thinking : undefined,
          safeThinking(incoming),
          safeText(text),
        ),
      );
      if (thinking) {
        trace = upsertLoopThinkingItem(
          trace,
          loopId(),
          ref,
          thinking,
          event.type === 'assistant.thinking_end' ? 'complete' : 'streaming',
        );
      }
      break;
    }
    case 'tool.requested': {
      const call = event.payload.toolCall;
      if (call.id && call.name) {
        beginContent();
        hasTools = true;
        for (const item of loopTextItems(trace.blocks.find((block) => block.id === loopId()))) {
          if (!item.phase)
            trace = upsertLoopTextItem(trace, loopId(), item.providerOutputRef, item.text, 'commentary', item.status);
        }
        trace = upsertRuntimeToolCall(
          trace,
          {
            id: call.id,
            toolName: call.name,
            status: 'pending',
            argsPreview: safeText(call.arguments),
            startedAt: event.timestamp,
          },
          loopOptions(),
        );
        if (loopText) trace = upsertLoopResult(trace, loopId(), { status: 'streaming', outputPhase: 'commentary' });
      }
      break;
    }
    case 'tool.started': {
      const { toolName, toolCallId, args } = event.payload;
      hasTools = true;
      trace = upsertRuntimeToolCall(
        trace,
        {
          id: toolCallId,
          toolName,
          status: 'running',
          executionStartedAt: event.timestamp,
          argsPreview: safeText(args),
          startedAt: event.timestamp,
          ...(toolName === 'subagent'
            ? {
                delegation: {
                  task: safeText(args.task ?? ''),
                  profile: String(args.profile ?? event.agentId ?? ''),
                  mode: args.mode === 'background' ? ('background' as const) : ('wait' as const),
                },
              }
            : {}),
        },
        loopOptions(),
      );
      break;
    }
    case 'tool.completed': {
      const { toolCallId, toolName, result } = event.payload;
      const failed = !result.ok;
      trace = upsertRuntimeToolCall(
        trace,
        {
          id: toolCallId,
          toolName,
          status: failed ? 'error' : 'complete',
          resultPreview: safeText(buildToolResultPreview(result)).slice(0, 16_000),
          error: failed ? safeText(result.error?.message ?? '') : undefined,
          completedAt: event.timestamp,
        },
        loopOptions(),
      );
      break;
    }
    case 'tool.denied': {
      const { toolCallId, toolName, reason } = event.payload;
      trace = upsertRuntimeToolCall(
        trace,
        {
          id: toolCallId,
          toolName,
          status: 'error',
          resultPreview: safeText(reason).slice(0, 16_000),
          error: safeText(reason),
          completedAt: event.timestamp,
        },
        loopOptions(),
      );
      break;
    }
    case 'approval.requested':
    case 'approval.answered': {
      const { payload } = event;
      trace = upsertRuntimeToolApproval(
        trace,
        {
          approvalId: payload.approvalId,
          toolCallId: payload.toolCallId ?? payload.approvalId,
          toolName: payload.toolName ?? 'approval',
          status: payload.status,
          reason: safeText(payload.reason ?? ''),
          answer: safeText(payload.answer ?? ''),
          risk: payload.risk,
          reviewer: payload.reviewer,
          reviewMethod: payload.reviewMethod,
          errorCode: payload.errorCode,
        },
        loopOptions(),
      );
      break;
    }
    case 'task.created':
    case 'task.updated': {
      const items = normalizeTaskSnapshotItems(event.payload).map((item) => ({
        ...item,
        title: safeText(item.title),
        statusReason: item.statusReason ? safeText(item.statusReason) : undefined,
      }));
      const completed = items.filter((item) => item.status === 'completed').length;
      trace = upsertWorkBlock(trace, `task-snapshot-${event.id}`, {
        kind: 'task_snapshot',
        parentLoopId: loopId(),
        title: event.type === 'task.created' ? 'Tasks added' : 'Tasks updated',
        stage: 'task',
        status: 'complete',
        taskSnapshot: {
          change: event.type === 'task.created' ? 'created' : 'updated',
          completed,
          total: items.length,
          items,
        },
        summary: `${completed} of ${items.length} completed`,
        startedAt: event.timestamp,
        completedAt: event.timestamp,
      });
      break;
    }
    case 'assistant.completed': {
      const { stopReason, textItems, thinking } = event.payload;
      beginContent();
      // A child has no approvals or user input of its own to wait on, so only tools keep a loop open.
      const outputPhase = resolveConversationLoopOutputPhase({ stopReason, loopHasTools: hasTools });
      trace = upsertLoopResult(trace, loopId(), { status: 'complete', stopReason, outputPhase });
      const completedThinking = thinking
        ?.map(safeThinking)
        .filter((artifact): artifact is ThinkingArtifact => Boolean(artifact));
      trace = settleLoopItems(
        trace,
        loopId(),
        { stopReason, outputPhase },
        {
          textItems: textItems?.map((item) => ({ ...item, text: safeText(item.text) })),
          thinking: completedThinking,
        },
      );
      nextLoop = true;
      break;
    }
    case 'diagnostic': {
      const { code, phase, severity, message, toolCallId } = event.payload;
      if (code.startsWith('error_recovery_') && phase === 'started') {
        trace = discardLoopAttempt(trace, loopId());
        loopText = '';
        hasTools = false;
      }
      if (shouldProjectDiagnosticToWorkProcess(code)) {
        const status = phase === 'started' ? 'running' : severity === 'error' ? 'error' : 'complete';
        const hookTrace =
          code.startsWith('hook.') && toolCallId !== undefined
            ? attachRuntimeHookDiagnostic(trace, toolCallId, {
                id: event.id,
                code,
                severity,
                message: safeText(message),
                timestamp: event.timestamp,
              })
            : null;
        trace =
          hookTrace ??
          upsertWorkBlock(trace, `diagnostic-${code.startsWith('hook.') ? `hook.${event.id}` : code}`, {
            kind: 'diagnostic',
            title: 'Runtime diagnostic',
            status,
            diagnosticSeverity: severity,
            summary: safeText(message),
            startedAt: event.timestamp,
            completedAt: status === 'running' ? undefined : event.timestamp,
          });
      }
      break;
    }
    case 'run.failed':
      trace = upsertWorkBlock(trace, `run-failed-${event.id}`, {
        kind: 'diagnostic',
        title: 'Agent Loop failed',
        status: 'error',
        diagnosticSeverity: 'error',
        summary: safeText(event.payload.error ?? 'Agent Loop failed.'),
        startedAt: event.timestamp,
        completedAt: event.timestamp,
      });
      break;
    case 'run.started':
    case 'run.completed':
    case 'run.cancelled':
    case 'context.compacted':
      break;
    default:
      return assertNever(event);
  }
  return { trace, loop, loopText, hasTools, nextLoop };
}
