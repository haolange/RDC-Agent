/**
 * AgentTurnSubscription — the subscription phase of an agent turn: streams text, records
 * structured tool-calling evidence, captures the canonical final answer, records context usage,
 * emits response diagnostics, forwards shared events, and bridges abort to the agent.
 */

import { resolveConversationLoopOutputPhase } from '@shared/conversation/loopOutputPhase';
import { charsToTokens } from '@shared/utils/tokens';
import { claimStructuredToolCallingEvidence } from '../capabilities/RouteCapabilityResolver';
import {
  buildDiagnosticAgentEvent,
  mentionsTextualToolCall,
  translateCoreToSharedAgentEvent,
} from '../AgentEventBridge';
import { debuggerLlmService } from '../context/DebuggerLlmService';
import { isMcpPrefixedToolName, partitionDeferredTools } from './deferredTools';
import { isSuccessfulProviderResponse, reportedUsageFields } from './AgentSlotFactory';
import { persistToolCallingSupport } from './AgentTurnCapabilityObservations';
import type { AgentTurnRun, AgentTurnSetup } from './AgentTurnRunner';
import type { AgentSlot } from './AgentSlotRegistry';
import type { TurnCompletionDeclaration } from './TurnCoordinator';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { AgentLoopEvent, AgentMessage, AssistantMessage, ToolDefinition } from '../core/types';
import type { ContextUsageBreakdownEntry } from '@shared/types/session';

/** What the subscription observes for the prompt phase and the completion receipt. */
export interface AgentTurnOutput {
  responseText: string;
  canonicalFinalAnswerText: string;
  partialFinalSnapshot: { text: string; declaration: TurnCompletionDeclaration; toolCalls: number } | undefined;
  sawStructuredToolCall: boolean;
  readonly structuredToolCallingEvidenceGate: { recorded: boolean };
}

/** Subscribe to the agent, register it as a turn producer and bridge the caller's abort signal. */
export function subscribeAgentTurnEvents(run: AgentTurnRun, setup: AgentTurnSetup): AgentTurnOutput {
  const { input, turnHandle } = run;
  const { activeSlot } = setup;
  const output: AgentTurnOutput = {
    responseText: '',
    canonicalFinalAnswerText: '',
    partialFinalSnapshot: undefined,
    sawStructuredToolCall: false,
    structuredToolCallingEvidenceGate: { recorded: false },
  };
  run.unsubscribe = activeSlot.agent.subscribe((event: AgentLoopEvent) => handleAgentEvent(run, setup, output, event));

  // abort 信号桥接到 Agent.abort()；同时注册为 turn producer。
  run.unregisterAgentProducer = turnHandle.registerProducer({
    id: `agent:${run.slotKey}`,
    abort: () => {
      try {
        activeSlot.agent.abort();
      } catch {
        // ignore
      }
    },
    join: async () => {
      await activeSlot.agent.abortAndJoin();
    },
  });
  if (input.options?.signal) {
    if (input.options.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    run.abortListener = () => {
      void turnHandle.abortAndJoin({ reason: 'user_stop' });
    };
    input.options.signal.addEventListener('abort', run.abortListener, { once: true });
  }
  return output;
}

function handleAgentEvent(run: AgentTurnRun, setup: AgentTurnSetup, output: AgentTurnOutput, event: AgentLoopEvent): void {
  const { input, turnHandle } = run;
  const { routeCapability } = run.preparedRuntime;
  if (event.type === 'message_update') {
    const ev = event.assistantMessageEvent;
    if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
      input.options?.onChunk?.(ev.delta);
    }
    if (ev.type === 'toolcall_end') {
      output.sawStructuredToolCall = true;
      claimStructuredToolCallingEvidence(
        ev.type,
        routeCapability,
        output.structuredToolCallingEvidenceGate,
      );
    }
  }
  if (event.type === 'tool_execution_end' && !event.result.isError) {
    if (claimStructuredToolCallingEvidence(
      event.type,
      routeCapability,
      output.structuredToolCallingEvidenceGate,
    )) {
      persistToolCallingSupport(run);
    }
  }
  if (event.type === 'message_end' && event.message.role === 'assistant') {
    recordAssistantMessage(run, setup, output, event.message);
  }
  const sharedEvent = translateCoreToSharedAgentEvent(event, setup.sharedEventContext);
  if (sharedEvent) {
    if (turnHandle.isLive(setup.turnGeneration)) {
      turnHandle.eventSink?.onEvent?.(sharedEvent);
    }
  }
}

/** The final answer, usage and diagnostics of one completed assistant message. */
function recordAssistantMessage(run: AgentTurnRun, setup: AgentTurnSetup, output: AgentTurnOutput, message: AssistantMessage): void {
  const { input, turnHandle, executionScopeId } = run;
  const { turnGeneration, sharedEventContext } = setup;
  output.responseText = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('');
  const outputPhase = resolveConversationLoopOutputPhase({
    stopReason: message.stopReason === 'stop' ? 'end_turn' : undefined,
    loopHasTools: message.content.some((block) => block.type === 'toolCall'),
    hasPendingContinuation: { handoff: Boolean(turnHandle.pendingHandoff) },
  });
  const finalText = turnHandle.isLive(turnGeneration) && outputPhase === 'final_answer'
    ? message.content.map(block => block.type === 'text' && block.phase !== 'commentary' ? block.text : '')
      .join('').trim() : '';
  const declaration = turnHandle.completionDeclaration;
  if (finalText) {
    output.canonicalFinalAnswerText = finalText;
    output.partialFinalSnapshot = declaration && ['partial', 'blocked'].includes(declaration.disposition)
      ? { text: finalText, declaration, toolCalls: turnHandle.policyBudget.toolCalls } : undefined;
  } else if (turnHandle.isLive(turnGeneration) && outputPhase === 'final_answer'
    && output.partialFinalSnapshot && declaration === output.partialFinalSnapshot.declaration
    && turnHandle.policyBudget.toolCalls === output.partialFinalSnapshot.toolCalls) {
    // A reassessment can end without text after the same partial was already reported.
    output.canonicalFinalAnswerText = output.partialFinalSnapshot.text;
  } else {
    output.canonicalFinalAnswerText = '';
    output.partialFinalSnapshot = undefined;
  }
  if (message.usage && isSuccessfulProviderResponse(message)) {
    const precomputedBreakdown = buildContextUsageBreakdown(setup.activeSlot, setup.runtimeTools.definitions, run.preparedRuntime.promptPlan);
    debuggerLlmService.recordAgentTurnUsage({
      runId: input.runId,
      turnId: turnHandle.turnId,
      sessionId: executionScopeId,
      providerId: input.providerId,
      modelId: input.modelId,
      inputTokens: message.usage.inputTokens,
      outputTokens: message.usage.outputTokens,
      ...reportedUsageFields(message.usage),
      ...(message.usage.cost ? { cost: message.usage.cost } : {}),
      precomputedBreakdown,
    });
  }
  const diagnosticIsLive = turnHandle.isLive(turnGeneration);
  if (diagnosticIsLive && isSuccessfulProviderResponse(message) && !output.sawStructuredToolCall && !output.responseText.trim()) {
    input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
      code: 'empty_response_without_tool_call',
      severity: 'warning',
      message: 'Provider returned an empty assistant message without a structured tool call.',
    }));
  } else if (diagnosticIsLive && isSuccessfulProviderResponse(message) && !output.sawStructuredToolCall && mentionsTextualToolCall(output.responseText)) {
    input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
      code: 'textual_tool_call_not_executed',
      severity: 'warning',
      message: 'The model wrote a textual tool call, but no structured provider tool call was returned. No tool was executed.',
      technicalMessage: output.responseText.slice(0, 1200),
    }));
  }
}

/**
 * 按当前实际注入的工具定义计量（含本 turn 内新激活的 deferred 工具）；
 * deferred 段仅计未激活 schema 估算，且仅在 >0 时加入。
 */
function buildContextUsageBreakdown(
  activeSlot: AgentSlot,
  allDefinitions: readonly ToolDefinition[],
  promptPlan: PromptPlan,
): ContextUsageBreakdownEntry[] {
  const injectedDefs = activeSlot.agent.state.tools ?? [];
  const { deferredMcp: deferredMcpDefs, deferredBuiltin: deferredBuiltinDefs } = partitionDeferredTools(
    allDefinitions,
    activeSlot.activatedDeferredTools,
  );
  const isMcpDef = (d: ToolDefinition) => isMcpPrefixedToolName(d.name);
  const isSubagentDef = (d: ToolDefinition) => d.name === 'subagent';
  const mcpDefs = injectedDefs.filter(isMcpDef);
  const subagentDefs = injectedDefs.filter(isSubagentDef);
  const systemDefs = injectedDefs.filter((d) => !isMcpDef(d) && !isSubagentDef(d));

  const pm = promptPlan.metrics;
  const systemPromptChars = pm
    ? pm.systemPrompt
    : promptPlan.systemPrompt.length;
  const rulesChars    = pm?.scopedInstructions ?? 0;
  const skillsChars   = pm?.skills ?? 0;

  // 压缩统计：在 message_end 时对当前 agent 的消息历史分类。
  const compressionStats = activeSlot.contextManager.classifyMessages(
    activeSlot.agent.messages as AgentMessage[],
  );

  return [
    { id: 'system_prompt', tokens: charsToTokens(systemPromptChars) },
    ...(rulesChars > 0 ? [{ id: 'memory_files' as const, tokens: charsToTokens(rulesChars) }] : []),
    ...(skillsChars > 0 ? [{ id: 'skills' as const, tokens: charsToTokens(skillsChars) }] : []),
    { id: 'system_tools',          tokens: charsToTokens(JSON.stringify(systemDefs).length),   count: systemDefs.length },
    ...(mcpDefs.length > 0
      ? [{
          id: 'mcp_tools' as const,
          tokens: charsToTokens(JSON.stringify(mcpDefs).length),
          count: mcpDefs.length,
        }]
      : []),
    ...(deferredMcpDefs.length > 0
      ? [{
          id: 'mcp_tools_deferred' as const,
          tokens: charsToTokens(JSON.stringify(deferredMcpDefs).length),
          count: deferredMcpDefs.length,
        }]
      : []),
    ...(deferredBuiltinDefs.length > 0
      ? [{
          id: 'builtin_tools_deferred' as const,
          tokens: charsToTokens(JSON.stringify(deferredBuiltinDefs).length),
          count: deferredBuiltinDefs.length,
        }]
      : []),
    ...(subagentDefs.length > 0
      ? [{
          id: 'subagent_definitions' as const,
          tokens: charsToTokens(JSON.stringify(subagentDefs).length),
          count: subagentDefs.length,
        }]
      : []),
    ...(compressionStats.summaryTokens > 0
      ? [{ id: 'summarized_conversation' as const, tokens: compressionStats.summaryTokens }]
      : []),
    { id: 'conversation', tokens: compressionStats.conversationTokens, count: compressionStats.conversationCount },
  ];
}
