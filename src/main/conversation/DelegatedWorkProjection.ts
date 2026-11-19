import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import { safeDelegationText as safeText } from './DelegationTraceText';
import { mergeThinkingPayload, selectCompletedThinking } from './ConversationThinkingArtifacts';
import { shouldProjectDiagnosticToWorkProcess } from './workProcessDiagnosticPolicy';
import { attachRuntimeHookDiagnostic, upsertLoopOutputItem, upsertLoopResult, upsertRuntimeToolApproval, upsertRuntimeToolCall, upsertWorkBlock } from './ConversationWorkTrace';
import { normalizeTaskSnapshotItems } from './ConversationTaskSnapshot';
import type { AgentAssistantDeltaPayload, AgentEvent } from '@shared/types/agentRuntime';
import type { ConversationLoopOutputPhase, ConversationTaskSnapshotItem, ConversationWorkTrace, ConversationWorkBlock } from '@shared/types/conversation';
import type { ProviderOutputRef, ThinkingArtifact } from '@shared/types/reasoning';

export interface DelegatedProjectionState {
  trace: ConversationWorkTrace;
  loop: number;
  loopText: string;
  thinking?: ThinkingArtifact;
  thinkingStatus?: ConversationWorkBlock['thinkingStatus'];
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
  let { trace, loop, loopText, thinking, thinkingStatus, hasTools, nextLoop } = state;
  const loopId = () => `loop-${loop}`;
  const beginContent = () => {
    if (!nextLoop) return;
    loop += 1;
    loopText = '';
    thinking = undefined;
    thinkingStatus = undefined;
    hasTools = false;
    nextLoop = false;
  };
  const loopOptions = () => ({ loopId: loopId(), loopResultText: loopText || undefined,
    loopThinking: thinking, loopThinkingStatus: thinkingStatus });
  const payload = event.payload as Record<string, unknown>;
  if (event.type === 'assistant.delta') {
    const delta = event.payload as AgentAssistantDeltaPayload;
    const chunk = safeText(delta.text);
    if (chunk) {
      beginContent();
      loopText += chunk;
      const previous = trace.blocks.find((block) => block.id === loopId())?.outputItems?.find((item) =>
        item.providerOutputRef.providerBlockKey === delta.providerOutputRef.providerBlockKey
        && item.providerOutputRef.contentIndex === delta.providerOutputRef.contentIndex);
      trace = upsertLoopResult(trace, loopId(), loopText, thinking, thinkingStatus,
        'streaming', undefined, hasTools ? 'commentary' : undefined);
      trace = upsertLoopOutputItem(trace, loopId(), delta.providerOutputRef, (previous?.text ?? '') + chunk,
        delta.phase, 'streaming');
    }
  } else if (event.type === 'assistant.text_end') {
    const item = event.payload as AgentAssistantDeltaPayload;
    trace = upsertLoopOutputItem(trace, loopId(), item.providerOutputRef, safeText(item.text), item.phase, 'complete');
  } else if (event.type === 'assistant.thinking_delta' || event.type === 'assistant.thinking_end') {
    const incoming = payload.thinking as ThinkingArtifact | undefined;
    if (incoming?.kind === 'opaque' || incoming?.visibility === 'hidden') return state;
    beginContent();
    thinking = safeThinking(mergeThinkingPayload(thinking,
      safeThinking(incoming),
      typeof payload.text === 'string' ? safeText(payload.text) : ''));
    if (thinking) {
      thinkingStatus = event.type === 'assistant.thinking_end' ? 'complete' : 'streaming';
      trace = upsertLoopResult(trace, loopId(), loopText || undefined, thinking, thinkingStatus,
        'streaming', undefined, hasTools ? 'commentary' : undefined);
    }
  } else if (event.type === 'tool.requested') {
    const call = payload.toolCall as { id?: string; name?: string; arguments?: unknown } | undefined;
    if (call?.id && call.name) {
      beginContent();
      hasTools = true;
      for (const item of trace.blocks.find((block) => block.id === loopId())?.outputItems ?? []) {
        if (!item.phase) trace = upsertLoopOutputItem(trace, loopId(), item.providerOutputRef, item.text, 'commentary', item.status);
      }
      trace = upsertRuntimeToolCall(trace, { id: call.id, toolName: call.name,
        status: 'pending', argsPreview: safeText(call.arguments ?? {}), startedAt: event.timestamp }, loopOptions());
      if (loopText) trace = upsertLoopResult(trace, loopId(), loopText, thinking, thinkingStatus,
        'streaming', undefined, 'commentary');
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
    const completedText = typeof payload.text === 'string' ? safeText(payload.text).trim() : '';
    const completedThinking = safeThinking(selectCompletedThinking(payload.thinking as ThinkingArtifact[] | undefined));
    thinking = completedThinking ?? thinking;
    if (thinking) thinkingStatus = 'complete';
    const outputPhase = hasTools || stopReason === 'tool_use' || stopReason === 'max_tokens'
      || stopReason === 'aborted' || stopReason === 'refusal' ? 'commentary' : 'final_answer';
    trace = upsertLoopResult(trace, loopId(), completedText || loopText || undefined, thinking,
      thinkingStatus, 'complete', stopReason, outputPhase);
    const existing = trace.blocks.find((block) => block.id === loopId())?.outputItems ?? [];
    const items = payload.textItems as Array<{ text: string; phase?: ConversationLoopOutputPhase; providerOutputRef: ProviderOutputRef }> | undefined;
    for (const item of items ?? existing) {
      const prior = existing.find((candidate) => candidate.providerOutputRef.providerBlockKey === item.providerOutputRef.providerBlockKey
        && candidate.providerOutputRef.contentIndex === item.providerOutputRef.contentIndex);
      const phase = item.phase ?? prior?.phase ?? (stopReason === 'end_turn' && outputPhase === 'final_answer' ? 'final_answer'
        : stopReason === 'tool_use' ? 'commentary' : undefined);
      trace = upsertLoopOutputItem(trace, loopId(), item.providerOutputRef, safeText(item.text), phase, 'complete');
    }
    nextLoop = true;
  } else if (event.type === 'diagnostic') {
    const code = String(payload.code ?? event.id);
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
  return { trace, loop, loopText, thinking, thinkingStatus, hasTools, nextLoop };
}
