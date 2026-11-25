import { rootScopeId } from '@shared/utils/executionScope';
import { isAutomaticToolApproval } from '@shared/utils/toolApproval';
import { nowMs } from '@shared/utils/id';
import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import {
  resolveConversationLoopOutputPhase,
  resolveConversationReasoningState,
  type ConversationLoopContinuationState,
} from '@shared/conversation/loopOutputPhase';
import { lastLoopThinking, sameProviderBlock } from '@shared/conversation/loopItems';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { redactCredentialLikeText, redactedArgumentsPreview } from '../runtime/secretRedaction';
import { normalizeToolName } from '../agent-runtime/orchestration/RuntimeToolPolicy';
import { buildConversationToolCompletion } from './ConversationToolCompletion';
import { shouldProjectDiagnosticToWorkProcess } from './workProcessDiagnosticPolicy';
import {
  attachRuntimeHookDiagnostic,
  upsertRuntimeToolApproval,
  upsertRuntimeToolCall,
  upsertLoopResult,
  discardLoopAttempt,
  settleLoopItems,
  upsertLoopTextItem,
  upsertLoopThinkingItem,
  upsertWorkBlock,
} from './ConversationWorkTrace';
import {
  applyPlanReviewAnswered,
  applyPlanReviewRequested,
  isPlanReviewApprovalPayload,
} from './ConversationPlanReviewEvents';
import { delegationTraceStore } from './DelegationTraceStore';
import {
  isActiveRun,
  isLoopTool,
  summarizeRuntimePayload,
} from './ConversationRoutePreflight';
import { normalizeTaskSnapshotItems } from './ConversationTaskSnapshot';
import { mergeThinkingPayload } from './ConversationThinkingArtifacts';
import type { ToolCallResult } from '@shared/types/tool';
import type { ProviderOutputRef, ThinkingArtifact } from '@shared/types/reasoning';
import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationToolCall,
  ConversationTaskSnapshotItem,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { AgentEvent } from '@shared/types/agentRuntime';
import type { ConversationTurnRunnerHost, CompleteProfileTurnInput } from './ConversationTurnRunner';
import type { PlanReviewDecision } from '@shared/types/planReview';

export interface TurnStreamState {
  currentLoopText: string;
  currentLoopProviderOutputRefs: ProviderOutputRef[];
  loopHasTools: boolean;
  runWasCancelled: boolean;
  loopSeq: number;
  pendingNewLoop: boolean;
  currentLoopOutputPhase: ConversationLoopOutputPhase | undefined;
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
    type: import('@shared/conversation/messageUpdateEvent').MessageUpdateType,
    patch: Partial<ConversationMessage>,
    options?: Partial<import('./ConversationStreamPatchScheduler').ConversationStreamPatchCommitOptions>,
  ) => void;
  commitThinkingTrace: (workTrace: ConversationWorkTrace) => void;
  beginAssistantContentLoop: () => void;
  markLoopCommentary: () => void;
  currentLoopId: () => string;
  resolveStreamingOutputPhase: () => ConversationLoopOutputPhase | undefined;
  seenCompactionSummaries: Set<string>;
  showWorkTrace: boolean;
  withWorkTrace: (workTrace: ConversationWorkTrace) => Partial<ConversationMessage>;
  recordProviderOutputRefs: (refs?: ProviderOutputRef[]) => void;
  currentLoopOptions: () => {
    loopId: string;
    loopProviderOutputRefs: ProviderOutputRef[];
  };
  pendingContinuation: ConversationLoopContinuationState;
}

export function createAgentEventHandler(deps: AgentEventHandlerDeps) {
  const {
    host, sessionId, input, agentLabel, turnStreamState,
    commitAssistantMessage, commitThinkingTrace,
    beginAssistantContentLoop, markLoopCommentary,
    currentLoopId, resolveStreamingOutputPhase,
    seenCompactionSummaries, recordProviderOutputRefs,
    currentLoopOptions, pendingContinuation,
  } = deps;
  const currentLoopItem = (kind: 'text' | 'thinking', ref: ProviderOutputRef) => turnStreamState.assistantMessage.workTrace
    ?.blocks.find((block) => block.id === currentLoopId())
    ?.items?.find((item) => item.kind === kind && sameProviderBlock(item.providerOutputRef, ref));
  /** The retried request streams the loop again from its first token; nothing from the failed try survives. */
  const discardFailedAttempt = () => {
    commitThinkingTrace(discardLoopAttempt(turnStreamState.assistantMessage.workTrace, currentLoopId()));
    turnStreamState.currentLoopText = '';
    turnStreamState.currentLoopProviderOutputRefs = [];
    turnStreamState.currentLoopOutputPhase = undefined;
    turnStreamState.loopHasTools = false;
  };
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
              const payload = event.payload as {
                summary?: string;
                compactionId?: string;
                usage?: { inputTokens: number; outputTokens: number };
                status?: 'running' | 'complete' | 'error';
                sourceUri?: string;
                sourceHash?: string;
                messagesBefore?: number;
                messagesAfter?: number;
                tokensBefore?: number;
                tokensAfter?: number;
              };
              const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
              const status = payload.status ?? 'complete';
              const identity = payload.compactionId ?? event.id;
              const notificationKey = `${identity}:${status}`;
              if (summary && !seenCompactionSummaries.has(notificationKey)) {
                seenCompactionSummaries.add(notificationKey);
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, `compaction-${identity}`, {
                    kind: 'compaction',
                    title: status === 'running' ? '正在整理上下文' : status === 'complete' ? '上下文已自动压缩' : '上下文整理失败',
                    stage: 'context',
                    status,
                    summary,
                    compactionStats: {
                      provenance: 'auto',
                      usage: payload.usage,
                      sourceUri: payload.sourceUri,
                      sourceHash: payload.sourceHash,
                      messagesBefore: payload.messagesBefore,
                      messagesAfter: payload.messagesAfter,
                      tokensBefore: payload.tokensBefore,
                      tokensAfter: payload.tokensAfter,
                    },
                    ...(status === 'running' ? { startedAt: nowMs() } : { completedAt: nowMs() }),
                  }),
                });
              }
            }
            if (event.type === 'assistant.delta') {
              const payload = event.payload as { text?: string; phase?: ConversationLoopOutputPhase; providerOutputRef: ProviderOutputRef };
              const chunk = typeof payload.text === 'string' ? payload.text : '';
              if (chunk) {
                beginAssistantContentLoop();
                recordProviderOutputRefs([payload.providerOutputRef]);
                turnStreamState.currentLoopText += chunk;
                const previous = currentLoopItem('text', payload.providerOutputRef);
                const trace = upsertLoopResult(turnStreamState.assistantMessage.workTrace, currentLoopId(), { status: 'streaming', outputPhase: resolveStreamingOutputPhase(), providerOutputRefs: turnStreamState.currentLoopProviderOutputRefs });
                commitThinkingTrace(upsertLoopTextItem(trace, currentLoopId(), payload.providerOutputRef,
                  (previous?.kind === 'text' ? previous.text : '') + chunk, payload.phase, 'streaming'));
              }
            }
            if (event.type === 'assistant.text_end') {
              const payload = event.payload as { text: string; phase?: ConversationLoopOutputPhase; providerOutputRef: ProviderOutputRef };
              beginAssistantContentLoop();
              recordProviderOutputRefs([payload.providerOutputRef]);
              const trace = turnStreamState.assistantMessage.workTrace;
              if (trace) commitThinkingTrace(upsertLoopTextItem(trace, currentLoopId(), payload.providerOutputRef,
                payload.text, payload.phase, 'complete'));
            }
            if (event.type === 'assistant.thinking_delta' || event.type === 'assistant.thinking_end') {
              const payload = event.payload as { text?: string; thinking?: ThinkingArtifact; providerOutputRef: ProviderOutputRef };
              beginAssistantContentLoop();
              // Each provider thinking block is its own item, keyed by its output ref.
              const previous = currentLoopItem('thinking', payload.providerOutputRef);
              const thinking = mergeThinkingPayload(
                previous?.kind === 'thinking' ? previous.thinking : undefined,
                payload.thinking,
                typeof payload.text === 'string' ? payload.text : '',
              );
              if (thinking) {
                commitThinkingTrace(upsertLoopThinkingItem(turnStreamState.assistantMessage.workTrace, currentLoopId(),
                  payload.providerOutputRef, thinking, event.type === 'assistant.thinking_end' ? 'complete' : 'streaming'));
              }
            }
            if (event.type === 'diagnostic') {
              const payload = event.payload as {
                code?: string;
                message?: string;
                severity?: string;
                phase?: 'started' | 'completed';
                toolCallId?: string;
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
                  if (payload.phase === 'started') discardFailedAttempt();
                }
                return;
              }
              const blockStatus = payload.phase === 'started'
                ? 'running'
                : payload.severity === 'error'
                  ? 'error'
                  : 'complete';
              const hookTrace = typeof payload.code === 'string' && payload.code.startsWith('hook.')
                && typeof payload.toolCallId === 'string'
                ? attachRuntimeHookDiagnostic(turnStreamState.assistantMessage.workTrace, payload.toolCallId, {
                  id: event.id,
                  code: payload.code,
                  severity: payload.severity === 'error' || payload.severity === 'warning' ? payload.severity : 'info',
                  message: summary,
                  timestamp: event.timestamp,
                })
                : null;
              commitAssistantMessage('message_patched', {
                workTrace: hookTrace ?? upsertWorkBlock(turnStreamState.assistantMessage.workTrace,
                  `runtime-diagnostic-${payload.code?.startsWith('hook.') ? `hook.${event.id}` : payload.code ?? 'runtime'}`, {
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
                beginAssistantContentLoop();
                turnStreamState.loopHasTools = true;
                markLoopCommentary();
                let trace = turnStreamState.assistantMessage.workTrace;
                const textItems = (trace?.blocks.find((block) => block.id === currentLoopId())?.items ?? [])
                  .filter((item) => item.kind === 'text');
                for (const item of textItems) {
                  if (trace && !item.phase) trace = upsertLoopTextItem(trace, currentLoopId(), item.providerOutputRef,
                    item.text, 'commentary', item.status);
                }
                if (trace && textItems.length) commitThinkingTrace(trace);
                // Stamp commentary explicitly so projection does not hide pre-tool narrative.
                if (turnStreamState.currentLoopText.trim()) {
                  commitThinkingTrace(upsertLoopResult(turnStreamState.assistantMessage.workTrace, currentLoopId(), { status: 'streaming', outputPhase: 'commentary', providerOutputRefs: turnStreamState.currentLoopProviderOutputRefs }));
                }
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
                    id: String(payload.toolCall.id),
                    toolName: String(payload.toolCall.name),
                    status: 'pending',
                    providerOutputRef: payload.providerOutputRef ? { ...payload.providerOutputRef } : undefined,
                    argsPreview: redactedArgumentsPreview(payload.toolCall.arguments),
                    startedAt: nowMs(),
                  }, currentLoopOptions()),
                });
              }
            }
            if (event.type === 'tool.started') {
              const loopScoped = isLoopTool(String(event.payload.toolName));
              const isSubagent = normalizeToolName(String(event.payload.toolName)) === 'subagent';
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
                  executionStartedAt: event.timestamp,
                  argsPreview: redactedArgumentsPreview(event.payload.args),
                  ...(isSubagent ? {
                    delegation: {
                      task: redactCredentialLikeText(String((event.payload.args as Record<string, unknown> | undefined)?.task ?? '')),
                      profile: String((event.payload.args as Record<string, unknown> | undefined)?.profile ?? event.agentId ?? ''),
                      mode: (event.payload.args as Record<string, unknown> | undefined)?.mode === 'background' ? 'background' as const : 'wait' as const,
                    },
                  } : {}),
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
            if (event.type === 'approval.requested' || event.type === 'approval.answered') {
              const payload = event.payload as import('@shared/types/agentRuntime').AgentApprovalEventPayload;
              if (payload.delegatedRequest) {
                const originalToolCallId = payload.toolCallId ?? payload.approvalId;
                const delegatedRequest = { ...payload.delegatedRequest, toolCallId: originalToolCallId };
                const pending = payload.status === 'pending';
                const rejected = payload.status === 'rejected' || payload.status === 'cancelled';
                if (event.sessionId !== sessionId && event.sessionId !== delegatedRequest.childSessionId) return;
                const message = { ...turnStreamState.assistantMessage, updatedAt: nowMs(),
                  workTrace: upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
                    id: `${delegatedRequest.childSessionId}::${originalToolCallId}`,
                    toolName: payload.toolName ?? 'approval',
                    delegatedRequest,
                    status: pending ? 'running' : rejected ? 'error' : 'complete',
                    argsPreview: `Child execution ${delegatedRequest.executionId}`,
                    userInputQuestions: payload.kind === 'ask_user' ? normalizeAskUserQuestions({ questions: payload.questions }) : undefined,
                    planReview: payload.kind === 'plan_review' ? payload.planReview : undefined,
                    resultPreview: pending ? undefined : String(payload.answer ?? 'Response delivered to child execution.'),
                    approval: payload.kind === 'ask_user' || payload.kind === 'plan_review' ? undefined : {
                      approvalId: payload.approvalId, status: payload.status, reason: payload.reason,
                      risk: typeof payload.risk === 'string' ? payload.risk : undefined, reviewer: typeof payload.reviewer === 'string' ? payload.reviewer : undefined,
                      reviewMethod: payload.reviewMethod, errorCode: payload.errorCode,
                    },
                  }),
                };
                const failure = host.persistConversationSnapshot(sessionId, message);
                if (failure) throw failure;
                turnStreamState.assistantMessage = message;
                host.emitConversationEvent({ type: 'message_patched', sessionId: sessionId ?? '', turnId: message.turnId, message });
                host.publishConversationTrace(sessionId ?? '', [input.userMessage, message], sessionId);
                // A child question does not retract the parent's final reply or mutate its loop continuation.
                return;
              }
            }
            if (event.type === 'approval.requested') {
              const payload = event.payload as {
                approvalId?: string;
                reason?: string;
                toolCallId?: string;
                toolName?: string;
                kind?: string;
                questions?: unknown;
                planReview?: ConversationToolCall['planReview'];
                risk?: unknown;
                reviewer?: unknown;
                reviewMethod?: unknown;
                errorCode?: unknown;
              };
              const approvalId = payload.approvalId ?? `approval-${payload.toolCallId ?? 'runtime'}`;
              const toolCallId = String(payload.toolCallId ?? approvalId);
              const toolName = String(payload.toolName ?? 'approval');
              if (isPlanReviewApprovalPayload({ kind: payload.kind, toolName })) {
                pendingContinuation.planReview = true;
                turnStreamState.pendingNewLoop = true;
                markLoopCommentary();
                if (!payload.planReview) return;
                commitAssistantMessage('message_patched', {
                  workTrace: applyPlanReviewRequested({
                    payload,
                    workTrace: turnStreamState.assistantMessage.workTrace,
                    loopId: currentLoopId(),
                  }),
                });
                return;
              }
              if (payload.kind === 'ask_user' || normalizeToolName(toolName) === 'ask_user') {
                pendingContinuation.userInput = true;
                // The user interaction stays with the response that requested it.
                turnStreamState.pendingNewLoop = true;
                markLoopCommentary();
                const questions = normalizeAskUserQuestions({ questions: payload.questions });
                commitAssistantMessage('message_patched', {
                  workTrace: upsertLoopResult(upsertRuntimeToolCall(turnStreamState.assistantMessage.workTrace, {
                      id: toolCallId,
                      toolName: 'ask_user',
                      status: 'running',
                      userInputQuestions: questions,
                      argsPreview: questions.map((question) => question.prompt).join(' | ').slice(0, 600),
                      startedAt: nowMs(),
                    }, currentLoopOptions()), currentLoopId(), { status: 'complete', stopReason: 'tool_use', outputPhase: 'commentary', providerOutputRefs: turnStreamState.currentLoopProviderOutputRefs }),
                });
                return;
              }
              const reason = typeof payload.reason === 'string' && payload.reason
                ? payload.reason
                : 'This action requires user approval before it can run.';
              if (!isAutomaticToolApproval(payload)) pendingContinuation.approval = true;
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
                  reviewMethod: payload.reviewMethod,
                  errorCode: payload.errorCode,
                }, currentLoopOptions()),
              });
            }
            if (event.type === 'approval.answered') {
              const payload = event.payload as {
                reviewMethod?: unknown;
                errorCode?: unknown;
                approvalId?: string;
                status?: string;
                answer?: unknown;
                answers?: unknown;
                kind?: string;
                toolCallId?: string;
                toolName?: string;
                planReview?: ConversationToolCall['planReview'];
                decision?: PlanReviewDecision;
              };
              const approvalId = payload.approvalId ?? 'runtime';
              if (isPlanReviewApprovalPayload({ kind: payload.kind, toolName: payload.toolName })) {
                if (payload.status !== 'cancelled') {
                  pendingContinuation.planReview = false;
                }
                commitAssistantMessage('message_patched', {
                  workTrace: applyPlanReviewAnswered({
                    payload,
                    workTrace: turnStreamState.assistantMessage.workTrace,
                  }),
                });
                return;
              }
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
              pendingContinuation.approval = (turnStreamState.assistantMessage.workTrace?.blocks ?? []).some(block => block.toolCalls.some(call => !call.delegatedRequest && call.approval?.status === 'pending' && call.approval.approvalId !== approvalId && !isAutomaticToolApproval(call.approval)));
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
                  reviewMethod: payload.reviewMethod,
                  errorCode: payload.errorCode,
                }, currentLoopOptions()),
              });
            }
            if (event.type === 'tool.completed') {
              const result = event.payload.result as ToolCallResult | undefined;
              if (sessionId && normalizeToolName(String(event.payload.toolName)) === 'subagent') {
                delegationTraceStore.setParentReceipt(rootScopeId(sessionId),
                  String(event.payload.toolCallId), result ?? {});
              }
              const isAskUserTool = normalizeToolName(String(event.payload.toolName)) === 'ask_user';
              const isPlanArtifactTool = normalizeToolName(String(event.payload.toolName)) === 'plan_artifact';
              if (isAskUserTool && result?.ok) {
                pendingContinuation.userInput = false;
              }
              if (isPlanArtifactTool && result?.ok) {
                pendingContinuation.planReview = false;
              }
              const toolCallId = String(event.payload.toolCallId);
              const existing = turnStreamState.assistantMessage.workTrace?.blocks.flatMap((block) => block.toolCalls)
                .find((call) => call.id === toolCallId);
              const toolCallPatch = buildConversationToolCompletion(
                toolCallId, String(event.payload.toolName), result, existing, nowMs(),
              );
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
                snapshot?: ConversationTaskSnapshotItem[];
              };
              const items = normalizeTaskSnapshotItems(payload);
              const completed = items.filter((item) => item.status === 'completed').length;
              const snapshotId = `task-snapshot-${event.id}`;
              commitAssistantMessage('message_patched', {
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, snapshotId, {
                  kind: 'task_snapshot',
                  parentLoopId: currentLoopId(),
                  title: event.type === 'task.created' ? 'Tasks added' : 'Tasks updated',
                  stage: 'task',
                  status: 'complete',
                  taskSnapshot: { change: event.type === 'task.created' ? 'created' : 'updated', completed, total: items.length, items },
                  summary: `${completed} of ${items.length} completed`,
                  startedAt: event.timestamp,
                  completedAt: event.timestamp,
                }),
              });
            }
            if (event.type === 'assistant.completed') {
              const payload = event.payload as {
                text?: string;
                textItems?: Array<{ text: string; phase?: ConversationLoopOutputPhase; providerOutputRef: ProviderOutputRef }>;
                thinking?: ThinkingArtifact[];
                providerOutputRefs?: ProviderOutputRef[];
                stopReason?: ConversationLoopStopReason;
              };
              beginAssistantContentLoop();
              const loopResult = typeof payload.text === 'string' ? payload.text.trim() : '';
              recordProviderOutputRefs(payload.providerOutputRefs);
              const stopReason = payload.stopReason;
              const resolvedOutputPhase = resolveConversationLoopOutputPhase({
                stopReason,
                loopHasTools: turnStreamState.loopHasTools,
                hasPendingContinuation: pendingContinuation,
              });
              const outputPhase = turnStreamState.currentLoopOutputPhase ?? resolvedOutputPhase;
              turnStreamState.currentLoopOutputPhase = outputPhase;
              const completedTrace = turnStreamState.assistantMessage.workTrace;
              if (loopResult || completedTrace?.blocks.some((block) => block.id === currentLoopId()) || payload.thinking?.length || stopReason) {
                let trace = settleLoopItems(
                  upsertLoopResult(completedTrace, currentLoopId(), { status: 'complete', stopReason, outputPhase, providerOutputRefs: turnStreamState.currentLoopProviderOutputRefs }),
                  currentLoopId(), { stopReason, outputPhase }, { textItems: payload.textItems, thinking: payload.thinking },
                );
                const reasoningState = resolveConversationReasoningState(
                  lastLoopThinking(trace.blocks.find((block) => block.id === currentLoopId())),
                  input.preparedTurn.runtime.routeCapability.reasoningDelivery,
                );
                trace = upsertLoopResult(trace, currentLoopId(), { status: 'complete', reasoningState });
                commitAssistantMessage('message_patched', {
                  workTrace: trace,
                });
              }
              // Provider completion closes this response, even when the host requests another one.
              // The owning turn's validated completion receipt is the only publisher of an answer.
              turnStreamState.pendingNewLoop = true;
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
                workTrace: upsertWorkBlock(turnStreamState.assistantMessage.workTrace, 'runtime-run', {
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
