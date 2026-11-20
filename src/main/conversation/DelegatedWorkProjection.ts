import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import { loopTextItems, sameProviderBlock } from '@shared/conversation/loopItems';
import { resolveConversationLoopOutputPhase } from '@shared/conversation/loopOutputPhase';
import { safeDelegationText as safeText } from './DelegationTraceText';
import { mergeThinkingPayload } from './ConversationThinkingArtifacts';
import { shouldProjectDiagnosticToWorkProcess } from './workProcessDiagnosticPolicy';
import {
  attachRuntimeHookDiagnostic, discardLoopAttempt, settleLoopItems, upsertLoopResult, upsertLoopTextItem, upsertLoopThinkingItem,
  upsertRuntimeToolApproval, upsertRuntimeToolCall, upsertWorkBlock,
} from './ConversationWorkTrace';
import { normalizeTaskSnapshotItems } from './ConversationTaskSnapshot';
import type { AgentAssistantDeltaPayload, AgentEvent } from '@shared/types/agentRuntime';
import type { ConversationLoopOutputPhase, ConversationTaskSnapshotItem, ConversationWorkTrace } from '@shared/types/conversation';
import type { ProviderOutputRef, ThinkingArtifact } from '@shared/types/reasoning';

export interface DelegatedProjectionState {
  trace: ConversationWorkTrace;
  loop: number;
  loopText: string;
  hasTools: boolean;
  nextLoop: boolean;
}

export function createDelegatedProjectionState(): DelegatedProjectionState {
  return { trace: { status: 'running', blocks: [], updatedAt: Date.now() }, loop: 0,
    loopText: '', hasTools: false, nextLoop: false };
}

function safeThinking(value: ThinkingArtifact | undefined): ThinkingArtifact | undefined {
  if (!value || value.kind === 'opaque' || value.visibility === 'hidden') return undefined;
  return { kind: value.kind, source: value.source, visibility: value.visibility,
    providerOutputRef: value.providerOutputRef ? { ...value.providerOutputRef } : undefined,
    text: value.text ? safeText(value.text) : undefined };
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
  const loopItem = (kind: 'text' | 'thinking', ref: ProviderOutputRef) => trace.blocks.find((block) => block.id === loopId())
    ?.items?.find((item) => item.kind === kind && sameProviderBlock(item.providerOutputRef, ref));
  const payload = event.payload as Record<string, unknown>;
  if (event.type === 'assistant.delta') {
    const delta = event.payload as AgentAssistantDeltaPayload;
    const chunk = safeText(delta.text);
    if (chunk) {
      beginContent();
      loopText += chunk;
      const previous = loopItem('text', delta.providerOutputRef);
      trace = upsertLoopResult(trace, loopId(), { status: 'streaming', outputPhase: hasTools ? 'commentary' : undefined });
      trace = upsertLoopTextItem(trace, loopId(), delta.providerOutputRef,
        (previous?.kind === 'text' ? previous.text : '') + chunk, delta.phase, 'streaming');
    }
  } else if (event.type === 'assistant.text_end') {
    const item = event.payload as AgentAssistantDeltaPayload;
    trace = upsertLoopTextItem(trace, loopId(), item.providerOutputRef, safeText(item.text), item.phase, 'complete');
  } else if (event.type === 'assistant.thinking_delta' || event.type === 'assistant.thinking_end') {
    const incoming = payload.thinking as ThinkingArtifact | undefined;
    const ref = payload.providerOutputRef as ProviderOutputRef | undefined;
    if (!ref || incoming?.kind === 'opaque' || incoming?.visibility === 'hidden') return state;
    beginContent();
    const previous = loopItem('thinking', ref);
    const thinking = safeThinking(mergeThinkingPayload(previous?.kind === 'thinking' ? previous.thinking : undefined,
      safeThinking(incoming),
      typeof payload.text === 'string' ? safeText(payload.text) : ''));
    if (thinking) {
      trace = upsertLoopThinkingItem(trace, loopId(), ref, thinking,
        event.type === 'assistant.thinking_end' ? 'complete' : 'streaming');
    }
  } else if (event.type === 'tool.requested') {
    const call = payload.toolCall as { id?: string; name?: string; arguments?: unknown } | undefined;
    if (call?.id && call.name) {
      beginContent();
      hasTools = true;
      for (const item of loopTextItems(trace.blocks.find((block) => block.id === loopId()))) {
        if (!item.phase) trace = upsertLoopTextItem(trace, loopId(), item.providerOutputRef, item.text, 'commentary', item.status);
      }
      trace = upsertRuntimeToolCall(trace, { id: call.id, toolName: call.name,
        status: 'pending', argsPreview: safeText(call.arguments ?? {}), startedAt: event.timestamp }, loopOptions());
      if (loopText) trace = upsertLoopResult(trace, loopId(), { status: 'streaming', outputPhase: 'commentary' });
    }
  } else if (event.type === 'tool.started') {
    const toolName = String(payload.toolName ?? 'tool');
    hasTools = true;
    trace = upsertRuntimeToolCall(trace, { id: String(payload.toolCallId ?? event.id), toolName,
      status: 'running', executionStartedAt: event.timestamp, argsPreview: safeText(payload.args ?? {}), startedAt: event.timestamp,
      ...(toolName === 'subagent' ? { delegation: {
        task: safeText((payload.args as Record<string, unknown> | undefined)?.task ?? ''),
        profile: String((payload.args as Record<string, unknown> | undefined)?.profile ?? event.agentId ?? ''),
        mode: (payload.args as Record<string, unknown> | undefined)?.mode === 'background' ? 'background' as const : 'wait' as const,
      } } : {}),
    }, loopOptions());
  } else if (event.type === 'tool.completed' || event.type === 'tool.denied') {
    const result = payload.result as { ok?: boolean; error?: { message?: string } } | undefined;
    const failed = event.type === 'tool.denied' || result?.ok === false;
    trace = upsertRuntimeToolCall(trace, { id: String(payload.toolCallId ?? event.id),
      toolName: String(payload.toolName ?? 'tool'), status: failed ? 'error' : 'complete',
      resultPreview: safeText(event.type === 'tool.denied' ? payload.reason ?? '' : buildToolResultPreview(result ?? {})).slice(0, 16_000),
      error: failed ? safeText(payload.reason ?? result?.error?.message ?? '') : undefined,
      completedAt: event.timestamp,
    }, loopOptions());
  } else if (event.type === 'approval.requested' || event.type === 'approval.answered') {
    trace = upsertRuntimeToolApproval(trace, {
      approvalId: String(payload.approvalId ?? event.id),
      toolCallId: String(payload.toolCallId ?? payload.approvalId ?? event.id),
      toolName: String(payload.toolName ?? 'approval'),
      status: String(payload.status ?? 'pending'), reason: safeText(payload.reason ?? ''),
      answer: safeText(payload.answer ?? ''), risk: payload.risk, reviewer: payload.reviewer,
      reviewMethod: payload.reviewMethod, errorCode: payload.errorCode,
    }, loopOptions());
  } else if (event.type === 'task.created' || event.type === 'task.updated') {
    const items = normalizeTaskSnapshotItems(payload as { taskId?: string; title?: string; status?: string;
      statusReason?: string; snapshot?: ConversationTaskSnapshotItem[] }).map((item) => ({ ...item, title: safeText(item.title),
      statusReason: item.statusReason ? safeText(item.statusReason) : undefined }));
    const completed = items.filter((item) => item.status === 'completed').length;
    trace = upsertWorkBlock(trace, `task-snapshot-${event.id}`, { kind: 'task_snapshot', parentLoopId: loopId(),
      title: event.type === 'task.created' ? 'Tasks added' : 'Tasks updated', stage: 'task', status: 'complete',
      taskSnapshot: { change: event.type === 'task.created' ? 'created' : 'updated', completed, total: items.length, items },
      summary: `${completed} of ${items.length} completed`, startedAt: event.timestamp, completedAt: event.timestamp });
  } else if (event.type === 'assistant.completed') {
    beginContent();
    const stopReason = payload.stopReason as import('@shared/types/conversation').ConversationLoopStopReason | undefined;
    // A child has no approvals or user input of its own to wait on, so only tools keep a loop open.
    const outputPhase = resolveConversationLoopOutputPhase({ stopReason, loopHasTools: hasTools });
    trace = upsertLoopResult(trace, loopId(), { status: 'complete', stopReason, outputPhase });
    const textItems = payload.textItems as Array<{ text: string; phase?: ConversationLoopOutputPhase; providerOutputRef: ProviderOutputRef }> | undefined;
    const completedThinking = (payload.thinking as ThinkingArtifact[] | undefined)
      ?.map(safeThinking).filter((artifact): artifact is ThinkingArtifact => Boolean(artifact));
    trace = settleLoopItems(trace, loopId(), { stopReason, outputPhase }, {
      textItems: textItems?.map((item) => ({ ...item, text: safeText(item.text) })),
      thinking: completedThinking,
    });
    nextLoop = true;
  } else if (event.type === 'diagnostic') {
    const code = String(payload.code ?? event.id);
    if (code.startsWith('error_recovery_') && payload.phase === 'started') {
      trace = discardLoopAttempt(trace, loopId());
      loopText = '';
      hasTools = false;
    }
    if (shouldProjectDiagnosticToWorkProcess(code)) {
      const status = payload.phase === 'started' ? 'running' : payload.severity === 'error' ? 'error' : 'complete';
      const hookTrace = code.startsWith('hook.') && typeof payload.toolCallId === 'string'
        ? attachRuntimeHookDiagnostic(trace, payload.toolCallId, {
          id: event.id,
          code,
          severity: payload.severity === 'error' || payload.severity === 'warning' ? payload.severity : 'info',
          message: safeText(payload.message ?? ''),
          timestamp: event.timestamp,
        })
        : null;
      trace = hookTrace ?? upsertWorkBlock(trace, `diagnostic-${code.startsWith('hook.') ? `hook.${event.id}` : code}`, { kind: 'diagnostic', title: 'Runtime diagnostic',
        status, diagnosticSeverity: payload.severity === 'error' || payload.severity === 'warning' ? payload.severity : 'info',
        summary: safeText(payload.message ?? ''), startedAt: event.timestamp,
        completedAt: status === 'running' ? undefined : event.timestamp });
    }
  } else if (event.type === 'run.failed') {
    trace = upsertWorkBlock(trace, `run-failed-${event.id}`, { kind: 'diagnostic', title: 'Agent Loop failed',
      status: 'error', diagnosticSeverity: 'error', summary: safeText(payload.error ?? payload.message ?? 'Agent Loop failed.'),
      startedAt: event.timestamp, completedAt: event.timestamp });
  }
  return { trace, loop, loopText, hasTools, nextLoop };
}
