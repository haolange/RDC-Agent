import type { AgentEvent } from '@shared/types/agentRuntime';
import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationThinkingStatus,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ProviderOutputRef, ThinkingArtifact } from '@shared/types/reasoning';
import { nowMs } from '@shared/utils/id';
import type { ToolCallResult } from '@shared/types/tool';
import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import { extractConversationToolResourceRefs } from './ConversationToolResourceRefs';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { shouldProjectDiagnosticToWorkProcess } from './workProcessDiagnosticPolicy';
import { normalizeToolName } from '../workflow/debugger/DebuggerRuntimePolicy';
import {
  upsertRuntimeToolApproval,
  upsertRuntimeToolCall,
  upsertLoopResult,
  upsertSubagentChild,
  upsertWorkBlock,
} from './ConversationWorkTrace';
import {
  resolveConversationLoopOutputPhase,
  resolveConversationReasoningState,
  type ConversationLoopContinuationState,
} from '@shared/conversation/loopOutputPhase';
import { reduceCanonicalAssistantOutput } from './CanonicalAssistantOutput';
import type { CanonicalAssistantOutputState } from './CanonicalAssistantOutput';
import {
  isActiveRun,
  isLoopTool,
  mergeThinkingPayload,
  selectCompletedThinking,
  summarizeRuntimePayload,
} from './ConversationRoutePreflight';
import type { ConversationTurnRunnerHost, CompleteProfileTurnInput } from './ConversationTurnRunner';

export interface TurnStreamState {
  currentLoopText: string;
  currentLoopThinking: ThinkingArtifact | undefined;
  currentLoopThinkingStatus: ConversationThinkingStatus | undefined;
  currentLoopProviderOutputRefs: ProviderOutputRef[];
  loopHasTools: boolean;
  visibleResponse: string;
  canonicalOutput: CanonicalAssistantOutputState;
  runWasCancelled: boolean;
  loopSeq: number;
  pendingNewLoop: boolean;
  currentLoopOutputPhase: ConversationLoopOutputPhase | undefined;
  turnHasProcessEvidence: boolean;
  turnHadAskPause: boolean;
  assistantMessage: ConversationMessage;
  errorViewModel: { code: string; message: string; technicalMessage?: string } | null;
  llmDiagnostic: ConversationMessageDiagnostic | undefined;
}

export interface AgentEventHandlerDeps {
  host: ConversationTurnRunnerHost;
  sessionId: string | null;
  input: CompleteProfileTurnInput;
  agentLabel: string;
  turnStreamState: TurnStreamState;
  commitAssistantMessage: (
    type: import('@shared/types/conversation').ConversationStreamEvent['type'],
    patch: Partial<ConversationMessage>,
    options?: Partial<import('./ConversationStreamPatchScheduler').ConversationStreamPatchCommitOptions>,
  ) => void;
  commitVisibleAssistantText: () => void;
  commitThinkingTrace: (workTrace: ConversationWorkTrace) => void;
  beginAssistantContentLoop: () => void;
  markProcessEvidence: () => void;
  markLoopCommentary: () => void;
  currentLoopId: () => string;
  resolveStreamingOutputPhase: () => ConversationLoopOutputPhase | undefined;
  syncVisibleResponseForStreaming: () => void;
  seenCompactionSummaries: Set<string>;
  showWorkTrace: boolean;
  withWorkTrace: (workTrace: ConversationWorkTrace) => Partial<ConversationMessage>;
  recordProviderOutputRefs: (refs?: ProviderOutputRef[]) => void;
  currentLoopOptions: () => {
    loopId: string;
    loopResultText: string | undefined;
    loopProviderOutputRefs: ProviderOutputRef[];
    loopThinking: ThinkingArtifact | undefined;
    loopThinkingStatus: ConversationThinkingStatus | undefined;
  };
  pendingContinuation: ConversationLoopContinuationState;
  hasPendingContinuation: () => boolean;
}

export function createAgentEventHandler(deps: AgentEventHandlerDeps) {
  const {
    host, sessionId, input, agentLabel, turnStreamState,
    commitAssistantMessage, commitVisibleAssistantText, commitThinkingTrace,
    beginAssistantContentLoop, markProcessEvidence, markLoopCommentary,
    currentLoopId, resolveStreamingOutputPhase, syncVisibleResponseForStreaming,
    seenCompactionSummaries, recordProviderOutputRefs,
    currentLoopOptions, pendingContinuation, hasPendingContinuation,
  } = deps;
  return (event: AgentEvent) => {
            host.emitConversationEvent({
              type: 'agent_event',
              sessionId: sessionId ?? '',
              turnId: turnStreamState.assistantMessage.turnId,
              event,
            });
            if (event.type === 'run.started') {
              const payload = event.payload as {
                providerId?: string;
                modelId?: string;
                toolAllowlist?: string[];
              };
              const details = [
                payload.providerId && payload.modelId ? `Model: ${payload.providerId} / ${payload.modelId}` : '',
                Array.isArray(payload.toolAllowlist) && payload.toolAllowlist.length > 0
                  ? `Tools: ${payload.toolAllowlist.join(', ')}`
                  : '',
              ].filter(Boolean).join('\n');
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, 'runtime-run', {
                  kind: 'reasoning',
                  title: 'Start Agent Loop',
                  stage: 'preflight',
                  status: 'running',
                  summary: [
                    `${agentLabel} started the model and tool loop.`,
                    details,
                  ].filter(Boolean).join('\n'),
                  startedAt: nowMs(),
                }),
              });
            }
            if (event.type === 'context.compacted') {
              const payload = event.payload as { summary?: string };
              const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
              if (summary && !seenCompactionSummaries.has(summary)) {
                seenCompactionSummaries.add(summary);
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, `compaction-${event.id}`, {
                    kind: 'compaction',
                    title: '上下文压缩',
                    stage: 'context',
                    status: 'complete',
                    summary,
                    completedAt: nowMs(),
                  }),
                });
              }
            }
            if (event.type === 'assistant.delta') {
              const payload = event.payload as { text?: string; providerOutputRef?: ProviderOutputRef };
              const chunk = typeof payload.text === 'string' ? payload.text : '';
              if (chunk) {
                recordProviderOutputRefs(payload.providerOutputRef ? [payload.providerOutputRef] : undefined);
                beginAssistantContentLoop();
                turnStreamState.currentLoopText += chunk;
                syncVisibleResponseForStreaming();
                commitVisibleAssistantText();
                commitThinkingTrace(upsertLoopResult(
                  turnStreamState.assistantMessage.workTrace,
                  currentLoopId(),
                  turnStreamState.currentLoopText,
                  turnStreamState.currentLoopThinking,
                  turnStreamState.currentLoopThinkingStatus,
                  'streaming',
                  undefined,
                  resolveStreamingOutputPhase(),
                  undefined,
                  turnStreamState.currentLoopProviderOutputRefs,
                ));
              }
            }
            if (event.type === 'assistant.thinking_delta') {
              const payload = event.payload as { text?: string; thinking?: ThinkingArtifact };
              beginAssistantContentLoop();
              markProcessEvidence();
              turnStreamState.currentLoopThinking = mergeThinkingPayload(
                turnStreamState.currentLoopThinking,
                payload.thinking,
                typeof payload.text === 'string' ? payload.text : '',
              );
              if (turnStreamState.currentLoopThinking) {
                turnStreamState.currentLoopThinkingStatus = 'streaming';
                // Thinking owns the process area; clear any optimistic bubble text.
                // Do not force outputPhase=commentary — that flashes final tokens into WP prose
                // when text deltas arrive on the same loop before completed reclassifies.
                if (turnStreamState.visibleResponse) {
                  turnStreamState.visibleResponse = '';
                  commitVisibleAssistantText();
                }
                commitThinkingTrace(upsertLoopResult(
                  turnStreamState.assistantMessage.workTrace,
                  currentLoopId(),
                  turnStreamState.currentLoopText || undefined,
                  turnStreamState.currentLoopThinking,
                  turnStreamState.currentLoopThinkingStatus,
                  'streaming',
                  undefined,
                  resolveStreamingOutputPhase(),
                  undefined,
                  turnStreamState.currentLoopProviderOutputRefs,
                ));
              }
            }
            if (event.type === 'assistant.thinking_end') {
              const payload = event.payload as { text?: string; thinking?: ThinkingArtifact };
              beginAssistantContentLoop();
              markProcessEvidence();
              turnStreamState.currentLoopThinking = mergeThinkingPayload(
                turnStreamState.currentLoopThinking,
                payload.thinking,
                typeof payload.text === 'string' ? payload.text : '',
              );
              if (turnStreamState.visibleResponse) {
                turnStreamState.visibleResponse = '';
                commitVisibleAssistantText();
              }
              if (turnStreamState.currentLoopThinking) {
                turnStreamState.currentLoopThinkingStatus = 'complete';
                commitThinkingTrace(upsertLoopResult(
                  turnStreamState.assistantMessage.workTrace,
                  currentLoopId(),
                  turnStreamState.currentLoopText || undefined,
                  turnStreamState.currentLoopThinking,
                  turnStreamState.currentLoopThinkingStatus,
                  'streaming',
                  undefined,
                  resolveStreamingOutputPhase(),
                  undefined,
                  turnStreamState.currentLoopProviderOutputRefs,
                ));
              }
            }
            if (event.type === 'diagnostic') {
              const payload = event.payload as {
                code?: string;
                message?: string;
                severity?: string;
                phase?: 'started' | 'completed';
              };
              const summary = typeof payload.message === 'string' && payload.message
                ? payload.message
                : 'Received runtime diagnostic.';
              if (!shouldProjectDiagnosticToWorkProcess(payload.code)) {
                // Recovery / thinking-lifecycle telemetry stays in Agent Activity only.
                const isRecovery = typeof payload.code === 'string'
                  && payload.code.startsWith('error_recovery_');
                if (isRecovery) {
                  runtimeLogService.log({
                    scope: sessionId ? 'session' : 'app',
                    namespace: 'agent',
                    severity: payload.severity === 'error'
                      ? 'error'
                      : payload.severity === 'warning'
                        ? 'warning'
                        : 'info',
                    title: payload.phase === 'started' ? 'Provider recovery' : 'Provider recovery complete',
                    summary,
                    sessionId,
                    projectId: input.context.projectId,
                    runId: isActiveRun(input.context.currentRun) ? input.context.currentRun.runId : null,
                    raw: {
                      code: payload.code,
                      phase: payload.phase,
                      surface: 'runtime-log',
                    },
                  });
                }
                return;
              }
              const blockStatus = payload.phase === 'started'
                ? 'running'
                : payload.severity === 'error'
                  ? 'error'
                  : 'complete';
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, `runtime-diagnostic-${payload.code ?? 'runtime'}`, {
                  kind: 'diagnostic',
                  status: blockStatus,
                  diagnosticSeverity: payload.severity === 'error' || payload.severity === 'warning'
                    ? payload.severity
                    : 'info',
                  title: 'Runtime diagnostic',
                  summary,
                  completedAt: blockStatus === 'running' ? undefined : nowMs(),
                }),
              });
            }
            if (event.type === 'tool.requested') {
              const payload = event.payload as {
                toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
                providerOutputRef?: ProviderOutputRef;
              };
              if (payload.toolCall?.id && payload.toolCall.name) {
                const loopScoped = isLoopTool(String(payload.toolCall.name));
                if (loopScoped) {
                  beginAssistantContentLoop();
                  turnStreamState.loopHasTools = true;
                  markLoopCommentary();
                  // Tool loops keep commentary in Work Process; clear bubble flash.
                  if (turnStreamState.visibleResponse) {
                    turnStreamState.visibleResponse = '';
                    commitVisibleAssistantText();
                  }
                  // Stamp commentary explicitly so projection does not hide pre-tool narrative.
                  if (turnStreamState.currentLoopText.trim()) {
                    commitThinkingTrace(upsertLoopResult(
                      turnStreamState.assistantMessage.workTrace,
                      currentLoopId(),
                      turnStreamState.currentLoopText,
                      turnStreamState.currentLoopThinking,
                      turnStreamState.currentLoopThinkingStatus,
                      'streaming',
                      undefined,
                      'commentary',
                      undefined,
                      turnStreamState.currentLoopProviderOutputRefs,
                    ));
                  }
                }
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
                    id: String(payload.toolCall.id),
                    toolName: String(payload.toolCall.name),
                    status: 'pending',
                    providerOutputRef: payload.providerOutputRef ? { ...payload.providerOutputRef } : undefined,
                    argsPreview: JSON.stringify(payload.toolCall.arguments ?? {}).slice(0, 600),
                    startedAt: nowMs(),
                  }, loopScoped ? currentLoopOptions() : undefined),
                });
              }
            }
            if (event.type === 'tool.started') {
              const loopScoped = isLoopTool(String(event.payload.toolName));
              if (loopScoped) {
                // Tool execution belongs to the provider loop that requested it. Only a
                // subsequent assistant semantic event may consume turnStreamState.pendingNewLoop.
                turnStreamState.loopHasTools = true;
                markLoopCommentary();
              }
              commitAssistantMessage('message_patched', {
                workTrace: upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
                  id: String(event.payload.toolCallId),
                  toolName: String(event.payload.toolName),
                  status: 'running',
                  argsPreview: JSON.stringify(event.payload.args ?? {}).slice(0, 600),
                  startedAt: nowMs(),
                }, loopScoped ? currentLoopOptions() : undefined),
              });
            }
            if (event.type === 'tool.denied') {
              const reason = typeof event.payload.reason === 'string'
                ? event.payload.reason
                : 'Profile policy denied this tool call.';
              const loopScopedDenied = isLoopTool(String(event.payload.toolName));
              if (loopScopedDenied) {
                turnStreamState.loopHasTools = true;
                markLoopCommentary();
              }
              commitAssistantMessage('message_patched', {
                workTrace: upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
                  id: String(event.payload.toolCallId),
                  toolName: String(event.payload.toolName),
                  status: 'error',
                  resultPreview: buildToolResultPreview(event.payload.result ?? { reason }),
                  error: reason,
                  completedAt: nowMs(),
                }, loopScopedDenied ? currentLoopOptions() : undefined),
              });
            }
            if (event.type === 'approval.requested') {
              const payload = event.payload as {
                approvalId?: string;
                reason?: string;
                toolCallId?: string;
                toolName?: string;
                kind?: string;
                questions?: unknown;
                risk?: unknown;
                reviewer?: unknown;
              };
              const approvalId = payload.approvalId ?? `approval-${payload.toolCallId ?? 'runtime'}`;
              const toolCallId = String(payload.toolCallId ?? approvalId);
              const toolName = String(payload.toolName ?? 'approval');
              if (payload.kind === 'ask_user' || normalizeToolName(toolName) === 'ask_user') {
                pendingContinuation.userInput = true;
                turnStreamState.turnHadAskPause = true;
                // Insurance: assistant.completed(tool_use) arrives before ask_user approval.
                // Force the next assistant content onto a fresh loop even if that earlier
                // completed handler missed the pause (ask_user is not a loop-scoped tool).
                turnStreamState.pendingNewLoop = true;
                markLoopCommentary();
                // Retract any mis-classified final_answer bubble text from the ask pause.
                if (turnStreamState.visibleResponse) {
                  turnStreamState.visibleResponse = '';
                  commitVisibleAssistantText();
                }
                const questions = normalizeAskUserQuestions({ questions: payload.questions });
                commitAssistantMessage('message_patched', {
                  workTrace: upsertLoopResult(
                    upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
                      id: toolCallId,
                      toolName: 'ask_user',
                      status: 'running',
                      userInputQuestions: questions,
                      argsPreview: questions.map((question) => question.prompt).join(' | ').slice(0, 600),
                      startedAt: nowMs(),
                    }),
                    currentLoopId(),
                    turnStreamState.currentLoopText || undefined,
                    turnStreamState.currentLoopThinking,
                    turnStreamState.currentLoopThinkingStatus,
                    'complete',
                    'tool_use',
                    'commentary',
                    undefined,
                    turnStreamState.currentLoopProviderOutputRefs,
                  ),
                });
                return;
              }
              const reason = typeof payload.reason === 'string' && payload.reason
                ? payload.reason
                : 'This action requires user approval before it can run.';
              pendingContinuation.approval = true;
              markLoopCommentary();
              commitAssistantMessage('message_patched', {
                workTrace: upsertRuntimeToolApproval(turnStreamState.assistantMessage.workTrace, {
                  approvalId,
                  toolCallId,
                  toolName,
                  status: 'pending',
                  reason,
                  risk: payload.risk,
                  reviewer: payload.reviewer,
                }, currentLoopOptions()),
              });
            }
            if (event.type === 'approval.answered') {
              const payload = event.payload as {
                approvalId?: string;
                status?: string;
                answer?: unknown;
                answers?: unknown;
                kind?: string;
                toolCallId?: string;
                toolName?: string;
              };
              const approvalId = payload.approvalId ?? 'runtime';
              if (payload.kind === 'ask_user' || normalizeToolName(String(payload.toolName ?? '')) === 'ask_user') {
                const failed = payload.status === 'rejected' || payload.status === 'cancelled';
                if (!failed) {
                  pendingContinuation.userInput = false;
                }
                const resultPreview = failed
                  ? String(payload.answer ?? 'User input request was cancelled.')
                  : JSON.stringify({ answers: Array.isArray(payload.answers) ? payload.answers : [] });
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
                    id: String(payload.toolCallId ?? approvalId),
                    toolName: 'ask_user',
                    status: failed ? 'error' : 'running',
                    resultPreview,
                    error: failed ? String(payload.answer ?? 'User input request was cancelled.') : undefined,
                    completedAt: failed ? nowMs() : undefined,
                  }),
                });
                return;
              }
              const approvalStatus = typeof payload.status === 'string' ? payload.status : 'approved';
              if (approvalStatus !== 'pending') {
                pendingContinuation.approval = false;
              }
              const answerText = payload.answer === undefined || payload.answer === null
                ? ''
                : typeof payload.answer === 'string'
                  ? payload.answer.trim()
                  : String(payload.answer).trim();
              commitAssistantMessage('message_patched', {
                workTrace: upsertRuntimeToolApproval(turnStreamState.assistantMessage.workTrace, {
                  approvalId,
                  toolCallId: String(payload.toolCallId ?? approvalId),
                  toolName: String(payload.toolName ?? 'approval'),
                  status: approvalStatus,
                  answer: answerText,
                }, currentLoopOptions()),
              });
            }
            if (event.type === 'tool.completed') {
              const result = event.payload.result as ToolCallResult | undefined;
              const isAskUserTool = normalizeToolName(String(event.payload.toolName)) === 'ask_user';
              const isHandoffTool = normalizeToolName(String(event.payload.toolName)) === 'agent_handoff';
              if (isAskUserTool && result?.ok) {
                pendingContinuation.userInput = false;
              }
              if (isHandoffTool && result?.ok) {
                pendingContinuation.handoff = true;
                markLoopCommentary();
              }
              const toolCallPatch: Partial<ConversationToolCall> & { id: string; toolName: string } = {
                id: String(event.payload.toolCallId),
                toolName: String(event.payload.toolName),
                status: result?.ok ? 'complete' : 'error',
                error: result?.ok ? undefined : result?.error?.message,
                completedAt: nowMs(),
              };
              const resourceRefs = extractConversationToolResourceRefs(String(event.payload.toolName), result);
              if (resourceRefs.length > 0) toolCallPatch.resourceRefs = resourceRefs;
              if (!(isAskUserTool && result?.ok)) {
                toolCallPatch.resultPreview = buildToolResultPreview(event.payload.result ?? {});
              }
              const loopScopedCompleted = isLoopTool(String(event.payload.toolName));
              commitAssistantMessage('message_patched', {
                workTrace: upsertRuntimeToolCall(
                  turnStreamState.assistantMessage.workTrace,
                  toolCallPatch,
                  loopScopedCompleted ? currentLoopOptions() : undefined,
                ),
              });
            }
            if (event.type === 'task.created' || event.type === 'task.updated') {
              const payload = event.payload as {
                taskId?: string;
                title?: string;
                status?: string;
                statusReason?: string;
              };
              const taskId = typeof payload.taskId === 'string' && payload.taskId.trim()
                ? payload.taskId.trim()
                : 'runtime-tasks';
              const title = typeof payload.title === 'string' && payload.title.trim()
                ? payload.title.trim()
                : taskId;
              const taskStatus = payload.status === 'in_progress'
                || payload.status === 'blocked'
                || payload.status === 'completed'
                || payload.status === 'cancelled'
                ? payload.status
                : 'pending';
              const blockStatus: ConversationWorkBlock['status'] = taskStatus === 'in_progress'
                ? 'running'
                : taskStatus === 'pending'
                  ? 'pending'
                  : taskStatus === 'blocked' || taskStatus === 'cancelled'
                    ? 'error'
                    : 'complete';
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, taskId, {
                  kind: 'command',
                  title,
                  stage: 'task',
                  status: blockStatus,
                  taskStatus,
                  taskStatusReason: typeof payload.statusReason === 'string' && payload.statusReason.trim()
                    ? payload.statusReason.trim()
                    : undefined,
                  summary: title,
                  completedAt: taskStatus === 'completed' || taskStatus === 'cancelled' ? nowMs() : undefined,
                }),
              });
            }
            if (event.type === 'subagent.started') {
              const payload = event.payload as { subagentId: string; profile: string; parentToolCallId: string; text?: string };
              pendingContinuation.subagent = true;
              markLoopCommentary();
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
                  kind: 'subagent',
                  title: `Sub-agent: ${payload.profile}`,
                  stage: 'tool',
                  status: 'running',
                  summary: payload.text?.slice(0, 200) ?? '',
                }),
              });
            }
            if (event.type === 'subagent.delta') {
              const payload = event.payload as {
                subagentId: string;
                text?: string;
                child?: {
                  id: string;
                  kind: 'llm_turn' | 'tool';
                  title: string;
                  summary?: string;
                  status: ConversationWorkBlock['status'];
                  toolName?: string;
                };
              };
              const blockId = `subagent-${payload.subagentId}`;
              if (payload.child) {
                const child = payload.child;
                commitAssistantMessage('message_patched', {
                  workTrace: upsertSubagentChild(turnStreamState.assistantMessage.workTrace, blockId, {
                    id: child.id,
                    kind: 'llm_turn',
                    title: child.title,
                    status: child.status,
                    summary: child.summary,
                    toolCalls: child.toolName
                      ? [{
                          id: child.id,
                          toolName: child.toolName,
                          status: child.status === 'error' ? 'error' : child.status === 'complete' ? 'complete' : 'running',
                          resultPreview: child.summary,
                          startedAt: nowMs(),
                          completedAt: child.status === 'complete' || child.status === 'error' ? nowMs() : undefined,
                        }]
                      : [],
                    startedAt: nowMs(),
                    completedAt: child.status === 'complete' || child.status === 'error' ? nowMs() : undefined,
                  }),
                });
              }
              if (payload.text) {
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, blockId, {
                    kind: 'subagent',
                    title: 'Sub-agent',
                    stage: 'tool',
                    status: 'running',
                    summary: payload.text.slice(-200),
                  }),
                });
              }
            }
            if (event.type === 'subagent.completed') {
              const payload = event.payload as { subagentId: string; profile: string; text?: string; status?: string };
              pendingContinuation.subagent = false;
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
                  kind: 'subagent',
                  title: `Sub-agent: ${payload.profile}`,
                  stage: 'tool',
                  status: payload.status === 'failed' ? 'error' : 'complete',
                  summary: payload.text?.slice(0, 500) ?? '',
                  completedAt: nowMs(),
                }),
              });
            }
            if (event.type === 'assistant.completed') {
              const payload = event.payload as {
                text?: string;
                thinking?: ThinkingArtifact[];
                providerOutputRefs?: ProviderOutputRef[];
                stopReason?: ConversationLoopStopReason;
              };
              beginAssistantContentLoop();
              const loopResult = typeof payload.text === 'string' ? payload.text.trim() : '';
              recordProviderOutputRefs(payload.providerOutputRefs);
              const stopReason = payload.stopReason;
              const completedThinking = selectCompletedThinking(payload.thinking) ?? turnStreamState.currentLoopThinking;
              if (completedThinking) {
                turnStreamState.currentLoopThinking = completedThinking;
                turnStreamState.currentLoopThinkingStatus = 'complete';
              }
              const resolvedOutputPhase = resolveConversationLoopOutputPhase({
                stopReason,
                loopHasTools: turnStreamState.loopHasTools,
                hasPendingContinuation: pendingContinuation,
              });
              const outputPhase = turnStreamState.currentLoopOutputPhase ?? resolvedOutputPhase;
              turnStreamState.currentLoopOutputPhase = outputPhase;
              const reasoningState = resolveConversationReasoningState(
                completedThinking,
                input.preparedTurn.runtime.routeCapability.reasoningDelivery,
              );
              if (loopResult || turnStreamState.currentLoopThinking || stopReason || outputPhase) {
                commitAssistantMessage('message_patched', {
                  workTrace: upsertLoopResult(
                    turnStreamState.assistantMessage.workTrace,
                    currentLoopId(),
                    loopResult || undefined,
                    turnStreamState.currentLoopThinking,
                    turnStreamState.currentLoopThinkingStatus,
                    'complete',
                    stopReason,
                    outputPhase,
                    reasoningState,
                    turnStreamState.currentLoopProviderOutputRefs,
                  ),
                });
              }
              if (outputPhase === 'final_answer') {
                turnStreamState.canonicalOutput = reduceCanonicalAssistantOutput(turnStreamState.canonicalOutput, loopResult, outputPhase);
                turnStreamState.visibleResponse = turnStreamState.canonicalOutput.finalAnswerText;
              } else {
                // Commentary stays in Work Process; never leave process text in the bubble.
                turnStreamState.visibleResponse = '';
              }
              commitVisibleAssistantText();
              // Any commentary / pending continuation ends this loop so the next assistant
              // content (including post-ask final answers) cannot reuse a stale commentary phase.
              if (
                outputPhase === 'commentary'
                || hasPendingContinuation()
                || turnStreamState.loopHasTools
                || turnStreamState.turnHadAskPause
                || stopReason === 'tool_use'
              ) {
                turnStreamState.pendingNewLoop = true;
              }
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, 'assistant-output', {
                  kind: 'output',
                  title: 'Assistant output ready',
                  stage: 'respond',
                  status: 'complete',
                  summary: 'Final answer generated.',
                  completedAt: nowMs(),
                }),
              });
            }
            if (event.type === 'run.completed') {
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, 'runtime-run', {
                  kind: 'reasoning',
                  title: 'Agent Loop completed',
                  stage: 'respond',
                  status: 'complete',
                  summary: 'Model and tool loop completed.',
                  completedAt: nowMs(),
                }),
              });
            }
            if (event.type === 'run.failed') {
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, `runtime-${event.type}`, {
                  kind: 'diagnostic',
                  title: 'Agent Loop failed',
                  stage: 'respond',
                  status: 'error',
                  summary: summarizeRuntimePayload(event.payload) || 'Agent Loop failed.',
                  completedAt: nowMs(),
                }),
              });
            }
            if (event.type === 'run.cancelled') {
              turnStreamState.runWasCancelled = true;
            }
  };
}
