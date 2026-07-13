import type {
  ConversationAttachmentInput,
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerToolApprovalResult,
  ConversationAnswerUserInputRequest,
  ConversationAnswerUserInputResult,
  ConversationCancelActiveTurnRequest,
  ConversationCancelActiveTurnResult,
  ConversationLoopStopReason,
  ConversationLoopOutputPhase,
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationRewriteFromMessageRequest,
  ConversationThinkingStatus,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
  ConversationSendRequest,
  ConversationStreamEvent,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type {
  ConversationBranchState,
  ConversationSwitchBranchRequest,
  ConversationSwitchBranchResult,
} from '@shared/types/conversationBranch';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import type { AgentRole } from '@shared/types/agent';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import type {
  AppMode,
  OpenedCaptureState,
  ProjectInputRecord,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { isTopLevelAgentId } from '@shared/types/agent';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import { generateEventId, nowMs } from '@shared/utils/id';
import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import type { AgentEvent } from '@shared/types/agentRuntime';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { promptPlanBuilder, resolvePromptClock } from '../agent-runtime/prompt';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
import { traceService } from '../agent-trace/TraceService';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { rdxSessionService } from '../index';
import { settingsService } from '../settings/SettingsService';
import { agentManifestService } from '../settings/AgentManifestService';
import { agentRuntimeConfigService } from '../settings/AgentRuntimeConfigService';
import { scopedInstructionResolver } from '../runtime/ScopedInstructionResolver';
import { appPathService } from '../runtime/AppPathService';
import { planEffectiveModelRequest, resolveEffectiveModel } from '../settings/EffectiveModelResolver';
import { storageAdapter } from '../sessions/StorageAdapter';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { sessionContextJournal, type SessionContextRoute } from './SessionContextJournal';
import type { Message as AgentRuntimeMessage } from '../agent-runtime/core/types';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { normalizeToolName, resolveAgentToolAllowlist } from '../workflow/debugger/DebuggerRuntimePolicy';
import {
  createDefaultBranchState,
  normalizeBranchId,
  repairConversationBranchState,
  resolveVisibleConversationMessages,
} from './ConversationBranchResolver';
import { ConversationStreamPatchScheduler, type ConversationStreamPatchCommitOptions } from './ConversationStreamPatchScheduler';
import {
  createDraftWorkTrace,
  finalizeTrace,
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
import { beginAssistantContentLoopIfPending } from './ConversationLoopRuntimeState';

interface ConversationBranchTurnContext {
  branchId: string;
  forkId: string;
  variantIndex: number;
  parentBranchId: string;
  branchState: ConversationBranchState;
}

function mergeThinkingPayload(
  current: ThinkingArtifact | undefined,
  incoming: ThinkingArtifact | undefined,
  delta: string,
): ThinkingArtifact | undefined {
  if (incoming) {
    const incomingText = incoming.text ?? (delta ? `${current?.text ?? ''}${delta}` : current?.text);
    return cloneThinkingArtifact({
      ...incoming,
      ...(incomingText ? { text: incomingText } : {}),
    });
  }
  if (!delta) return current;
  return cloneThinkingArtifact({
    ...(current ?? {
      kind: 'raw',
      source: 'unknown',
      visibility: 'raw-collapsed',
      replayPolicy: 'none',
    }),
    text: `${current?.text ?? ''}${delta}`,
  });
}

function selectCompletedThinking(thinking: ThinkingArtifact[] | undefined): ThinkingArtifact | undefined {
  if (!Array.isArray(thinking) || thinking.length === 0) return undefined;
  for (let index = thinking.length - 1; index >= 0; index -= 1) {
    const candidate = thinking[index];
    if (candidate.artifact || candidate.text) return cloneThinkingArtifact(candidate);
  }
  return undefined;
}

function cloneThinkingArtifact(thinking: ThinkingArtifact): ThinkingArtifact {
  return {
    ...thinking,
    artifact: thinking.artifact
      ? {
          ...thinking.artifact,
          raw: thinking.artifact.raw ? { ...thinking.artifact.raw } : undefined,
        }
      : undefined,
  };
}
interface ConversationContextInput extends ConversationSendRequest {
  fallbackProjectId?: string | null;
  fallbackSessionId?: string | null;
  fallbackRunId?: string | null;
}

interface ConversationRewriteContextInput extends ConversationRewriteFromMessageRequest {
  fallbackProjectId?: string | null;
  fallbackSessionId?: string | null;
  fallbackRunId?: string | null;
}

interface ResolvedConversationContext {
  projectId: string | null;
  session: SessionRecord | null;
  currentRun: RunSummary | null;
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  openedCapturePath: string | null;
  replayDevice: ReplayDeviceEntry | null;
}

interface ActiveConversationTurn {
  turnId: string;
  sessionId: string | null;
  startedAt: number;
  abortController: AbortController;
  stop: () => void;
  /** Resolves only after completeProfileTurn has fully exited its terminal cleanup. */
  stopped: Promise<void>;
}

function resolveConversationAgentId(requestedMode: AppMode, requestedAgentId?: string | null): AgentRole {
  if (requestedAgentId && resolveEnabledAgentDefinition(requestedAgentId)) {
    return requestedAgentId as AgentRole;
  }
  if (requestedMode !== 'ask' && resolveEnabledAgentDefinition(requestedMode)) {
    return requestedMode as AgentRole;
  }
  return 'ask';
}

const ACTIVE_RUN_STATUSES: Array<RunSummary['status']> = [
  'planning',
  'awaiting_input',
  'awaiting_approval',
  'queued',
  'running',
  'stopping',
];

function isActiveRun(run: RunSummary | null | undefined): run is RunSummary {
  return Boolean(run && ACTIVE_RUN_STATUSES.includes(run.status));
}

const isLoopTool = (toolName: string): boolean => {
  const normalized = normalizeToolName(toolName);
  return normalized !== 'ask_user' && normalized !== 'agent_handoff';
};

function summarizeRuntimePayload(payload: AgentEvent['payload']): string {
  if ('message' in payload && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  if ('text' in payload && typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text.trim().slice(0, 240);
  }
  if ('error' in payload && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }
  if ('title' in payload && typeof payload.title === 'string' && payload.title.trim()) {
    return payload.title.trim();
  }
  return '';
}

function makeConversationMessage(
  role: ConversationMessage['role'],
  content: string,
  options: {
    turnId: string;
    sessionId?: string | null;
    projectId?: string | null;
    runId?: string | null;
    modeContext?: AppMode;
    agentId?: ConversationMessage['agentId'];
    attachments?: SessionAttachmentRecord[];
    status?: ConversationMessage['status'];
    workTrace?: ConversationWorkTrace | null;
    diagnostic?: ConversationMessage['diagnostic'];
    branchId?: string;
    forkId?: string;
    variantIndex?: number;
  },
): ConversationMessage {
  const createdAt = nowMs();
  return {
    id: generateEventId(role === 'user' ? 'msgu' : role === 'assistant' ? 'msga' : 'msgs'),
    turnId: options.turnId,
    sessionId: options.sessionId ?? null,
    projectId: options.projectId ?? null,
    runId: options.runId ?? null,
    modeContext: options.modeContext,
    role,
    agentId: options.agentId,
    content,
    status: options.status ?? (role === 'assistant' ? 'draft' : 'complete'),
    updatedAt: createdAt,
    workTrace: options.workTrace ?? null,
    diagnostic: options.diagnostic ?? null,
    attachments: options.attachments,
    branchId: options.branchId ?? ROOT_BRANCH_ID,
    forkId: options.forkId,
    variantIndex: options.variantIndex,
    createdAt,
  };
}

function resolveEnabledAgentDefinition(agentId: string) {
  return settingsService.getAll().agents.definitions.find((entry) => entry.id === agentId && entry.enabled) ?? null;
}

function getAgentLabel(agentId: AgentRole): string {
  const definition = resolveEnabledAgentDefinition(agentId);
  return definition?.name || (isTopLevelAgentId(agentId) ? AGENT_DISPLAY_NAMES[agentId] : agentId);
}

interface AgentRoutePreflightOk {
  ok: true;
  agentId: AgentRole;
  routeAgentId: AgentRole;
  providerId: string;
  modelId: string;
  routeCapability: AgentRouteCapability;
}

interface AgentRoutePreflightBlocked {
  ok: false;
  diagnostic: ConversationMessageDiagnostic;
}

type AgentRoutePreflight = AgentRoutePreflightOk | AgentRoutePreflightBlocked;

function redactTechnicalMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(Bearer\s+)[^\s"'`,;)}]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)["'\s:=]+)[^"',;\s)}]+/gi, '$1[redacted]')
    .slice(0, 1200);
}

function createConversationDiagnostic(input: {
  agentId: AgentRole;
  code: ConversationMessageDiagnostic['code'];
  severity: ConversationMessageDiagnostic['severity'];
  userMessage: string;
  providerId?: string;
  modelId?: string;
  adapterId?: string;
  technicalMessage?: string;
}): ConversationMessageDiagnostic {
  return {
    code: input.code,
    severity: input.severity,
    userMessage: input.userMessage,
    agentId: input.agentId,
    providerId: input.providerId,
    modelId: input.modelId,
    adapterId: input.adapterId,
    technicalMessage: input.technicalMessage,
  };
}

function resolveAgentRoutePreflight(agentId: AgentRole, fallbackAgentId?: AgentRole): AgentRoutePreflight {
  const settings = settingsService.getAll();
  const primaryRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
  const fallbackRoute = fallbackAgentId
    ? settings.llm.agentRoutes.find((entry) => entry.agentId === fallbackAgentId)
    : undefined;
  const route = primaryRoute?.providerId && primaryRoute.modelId ? primaryRoute : fallbackRoute;
  const routeAgentId = route?.agentId ?? agentId;
  const label = getAgentLabel(agentId);
  if (!route?.providerId || !route.modelId) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_ROUTE_MISSING',
        severity: 'warning',
        userMessage: `当前 ${label} 链路还没绑定可用模型。请在 Settings 中为 \`${agentId}\` 选择 provider 和 model route。`,
      }),
    };
  }

  const provider = settings.llm.providers.find((entry) => entry.id === route.providerId);
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE',
        severity: 'error',
        userMessage: `当前 ${label} 链路的 provider 不可用：${route.providerId}。请检查该服务商的连接状态、账号或密钥后重试。`,
        providerId: route.providerId,
        modelId: route.modelId,
        technicalMessage: provider?.lastError ?? provider?.unavailableReason,
      }),
    };
  }

  if (provider.status !== 'verified') {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE',
        severity: 'error',
        userMessage: `Current ${label} route provider is not verified: ${route.providerId}. Verify the provider in Settings before running agent tools.`,
        providerId: route.providerId,
        modelId: route.modelId,
        technicalMessage: provider.lastError ?? provider.unavailableReason,
      }),
    };
  }

  const model = provider.models.find((entry) => entry.id === route.modelId);
  if (!model?.enabled) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_ROUTE_MISSING',
        severity: 'warning',
        userMessage: `当前 ${label} 链路的模型不可用：${route.providerId}/${route.modelId}。请在 Settings 中刷新模型列表或重新选择 route。`,
        providerId: route.providerId,
        modelId: route.modelId,
      }),
    };
  }

  return {
    ok: true,
    agentId,
    routeAgentId,
    providerId: route.providerId,
    modelId: route.modelId,
    routeCapability: resolveAgentRouteCapability(
      provider,
      route.modelId,
      resolveEffectiveModel(route.providerId, route.modelId, settings),
    ),
  };
}

function recordLlmDiagnostic(
  context: ResolvedConversationContext,
  diagnostic: ConversationMessageDiagnostic,
): void {
  runtimeLogService.log({
    scope: context.session?.sessionId ? 'session' : 'app',
    namespace: 'llm',
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    title: `${diagnostic.agentId ?? 'debugger'} -> ${diagnostic.providerId ?? 'route missing'}${diagnostic.modelId ? `/${diagnostic.modelId}` : ''}`,
    summary: diagnostic.userMessage,
    detail: diagnostic.technicalMessage,
    sessionId: context.session?.sessionId ?? null,
    projectId: context.projectId,
    runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
    raw: {
      code: diagnostic.code,
      agentId: diagnostic.agentId,
      providerId: diagnostic.providerId,
      modelId: diagnostic.modelId,
      adapterId: diagnostic.adapterId,
    },
  });
}

function createRequestFailedDiagnostic(route: AgentRoutePreflightOk, error: unknown): ConversationMessageDiagnostic {
  const label = getAgentLabel(route.agentId);
  return createConversationDiagnostic({
    agentId: route.agentId,
    code: 'CONVERSATION_LLM_REQUEST_FAILED',
    severity: 'error',
    userMessage: `模型请求失败：${label} 当前使用 ${route.providerId}/${route.modelId}，但服务商请求没有成功。请检查该账号、模型权限、额度或网络状态后重试。`,
    providerId: route.providerId,
    modelId: route.modelId,
    technicalMessage: redactTechnicalMessage(error),
  });
}

export class ConversationService {
  private activeTurns = new Map<string, ActiveConversationTurn>();
  /**
   * 待处理的 handoff（sessionId → {toProfile, prompt}）。
   *
   * agent_handoff 工具成功后由 AgentOrchestrator.consumePendingHandoff 消费并存入此 map，
   * 下次该 session 消息时优先用 toProfile 并把 prompt 前置到用户消息。
   * 内存维护（不持久化），session 重启后丢失（handoff 是即时意图）。
   */
  private readonly pendingHandoffs = new Map<string, { toProfile: AgentRole; prompt: string }>();

  async getHistory(sessionId: string): Promise<{
    messages: ConversationMessage[];
    branchState: ConversationBranchState | null;
  }> {
    const allMessages = storageAdapter.readConversationHistory(sessionId);
    const branchState = this.readRepairedBranchState(sessionId, allMessages);
    return {
      // The renderer owns visible projection and needs sibling anchors to keep
      // variant navigation concrete after refresh or session reselection.
      messages: allMessages,
      branchState,
    };
  }

  async clearHistory(sessionId: string): Promise<ConversationMessage[]> {
    storageAdapter.writeConversationHistory(sessionId, []);
    this.publishConversationTrace(sessionId, [], sessionId);
    return [];
  }

  async undoLastTurn(sessionId: string): Promise<ConversationMessage[]> {
    const history = storageAdapter.readConversationHistory(sessionId);
    const lastUserMessage = history
      .slice()
      .reverse()
      .find((message) => message.role === 'user');
    if (!lastUserMessage) {
      return history;
    }

    const nextHistory = history.filter((message) => message.turnId !== lastUserMessage.turnId);
    storageAdapter.writeConversationHistory(sessionId, nextHistory);
    this.publishConversationTrace(sessionId, nextHistory, sessionId);
    return nextHistory;
  }

  async compactHistory(sessionId: string): Promise<ConversationMessage[]> {
    const history = storageAdapter.readConversationHistory(sessionId);
    const keepCount = 6;
    if (history.length <= keepCount + 1) {
      return history;
    }

    const head = history.slice(0, -keepCount);
    const tail = history.slice(-keepCount);
    const compactedAt = nowMs();
    const summaryMessage: ConversationMessage = {
      id: `compact-${compactedAt}`,
      turnId: `compact-turn-${compactedAt}`,
      sessionId,
      projectId: tail[0]?.projectId ?? head[0]?.projectId ?? null,
      role: 'system',
      content: `Context compacted: ${head.length} earlier messages summarized. User messages: ${head.filter((message) => message.role === 'user').length}; assistant messages: ${head.filter((message) => message.role === 'assistant').length}; system messages: ${head.filter((message) => message.role === 'system').length}.`,
      status: 'complete',
      createdAt: compactedAt,
      updatedAt: compactedAt,
      workTrace: {
        status: 'complete',
        summary: `Compacted ${head.length} earlier messages.`,
        blocks: [],
        updatedAt: compactedAt,
      },
    };
    const nextHistory = [summaryMessage, ...tail];
    storageAdapter.writeConversationHistory(sessionId, nextHistory);
    this.publishConversationTrace(sessionId, nextHistory, sessionId);
    return nextHistory;
  }

  async cancelActiveTurn(
    request: ConversationCancelActiveTurnRequest = {},
  ): Promise<ConversationCancelActiveTurnResult> {
    const candidates = Array.from(this.activeTurns.values())
      .filter((turn) => !request.turnId || turn.turnId === request.turnId)
      .filter((turn) => !request.sessionId || turn.sessionId === request.sessionId)
      .sort((left, right) => right.startedAt - left.startedAt);
    const target = candidates[0];
    if (!target) {
      return { success: false, error: 'No active conversation turn.' };
    }

    target.stop();
    return {
      success: true,
      cancelledTurnId: target.turnId,
    };
  }

  answerUserInput(request: ConversationAnswerUserInputRequest): ConversationAnswerUserInputResult {
    return agentUserInputRequestService.answer(request);
  }

  answerToolApproval(request: ConversationAnswerToolApprovalRequest): ConversationAnswerToolApprovalResult {
    return agentToolApprovalRequestService.answer(request);
  }

  private registerActiveTurn(turn: ActiveConversationTurn): void {
    this.activeTurns.set(turn.turnId, turn);
  }

  private clearActiveTurn(turnId: string, controller: AbortController): void {
    const active = this.activeTurns.get(turnId);
    if (active?.abortController === controller) {
      this.activeTurns.delete(turnId);
    }
  }

  async sendMessage(input: ConversationContextInput): Promise<ConversationTurnResult> {
    const trimmed = input.message.trim();
    const context = await this.resolveContext(input);
    return this.startProfileTurn(
      context,
      input.mode,
      input.agentId ?? null,
      trimmed,
      input.attachments ?? [],
      undefined,
      input.turnControls,
    );
  }

  async rewriteFromMessage(input: ConversationRewriteContextInput): Promise<ConversationTurnResult> {
    const trimmed = input.message.trim();
    const context = await this.resolveContext(input);
    const sessionId = input.sessionId ?? context.session?.sessionId ?? null;
    if (!sessionId) {
      return this.startProfileTurn(
        context,
        input.mode,
        input.agentId ?? null,
        trimmed,
        input.attachments ?? [],
        undefined,
        input.turnControls,
      );
    }

    const initialHistory = storageAdapter.readConversationHistory(sessionId);
    const initialTargetIndex = initialHistory.findIndex((message) => message.id === input.messageId);
    const initialTargetMessage = initialTargetIndex >= 0 ? initialHistory[initialTargetIndex] : null;
    if (!initialTargetMessage || initialTargetMessage.role !== 'user') {
      throw new Error('Can only edit and resend an existing user message.');
    }

    const downstreamTurnIds = new Set(
      initialHistory.slice(initialTargetIndex + 1).map((message) => message.turnId),
    );
    // Also stop the target turn itself if it is still streaming (edit during reply).
    downstreamTurnIds.add(initialTargetMessage.turnId);
    const turnsToStop = Array.from(this.activeTurns.values()).filter((activeTurn) => (
      activeTurn.sessionId === sessionId && downstreamTurnIds.has(activeTurn.turnId)
    ));
    for (const activeTurn of turnsToStop) {
      activeTurn.stop();
    }
    if (turnsToStop.length > 0) {
      await Promise.allSettled(turnsToStop.map((turn) => turn.stopped));
    }

    // Re-read after every stopped turn has fully left completeProfileTurn. Its
    // terminal flush may have appended a newer snapshot for the target branch.
    const history = storageAdapter.readConversationHistory(sessionId);
    const targetIndex = history.findIndex((message) => message.id === input.messageId);
    const targetMessage = targetIndex >= 0 ? history[targetIndex] : null;
    if (!targetMessage || targetMessage.role !== 'user') {
      throw new Error('Can only edit and resend an existing user message.');
    }

    let branchState = storageAdapter.readConversationBranchState(sessionId) ?? createDefaultBranchState(sessionId);
    const targetBranchId = normalizeBranchId(targetMessage.branchId);
    const forkId = targetMessage.forkId ?? targetMessage.id;
    const anchorMessageId = branchState.forks.find((fork) => fork.forkId === forkId)?.anchorMessageId ?? targetMessage.id;

    let fork = branchState.forks.find((entry) => entry.forkId === forkId);
    if (!fork) {
      fork = {
        forkId,
        anchorMessageId,
        activeBranchId: targetBranchId,
        branches: [{
          branchId: targetBranchId,
          parentBranchId: null,
          variantIndex: targetMessage.variantIndex ?? 0,
          anchorUserMessageId: targetMessage.id,
          rootTurnId: targetMessage.turnId,
        }],
      };
      branchState.forks.push(fork);
    } else if (!fork.branches.some((branch) => branch.anchorUserMessageId === targetMessage.id)) {
      const variantIndex = targetMessage.variantIndex ?? fork.branches.length;
      if (!fork.branches.some((branch) => branch.variantIndex === variantIndex)) {
        fork.branches.push({
          branchId: targetBranchId,
          parentBranchId: fork.branches[0]?.parentBranchId ?? null,
          variantIndex,
          anchorUserMessageId: targetMessage.id,
          rootTurnId: targetMessage.turnId,
        });
      }
    }

    const newBranchId = generateEventId('branch');
    const variantIndex = fork.branches.length;

    const updatedContext: ResolvedConversationContext = {
      ...context,
      session: storageAdapter.readSession(sessionId) ?? context.session,
    };
    return this.startProfileTurn(
      updatedContext,
      input.mode,
      input.agentId ?? null,
      trimmed,
      input.attachments ?? [],
      {
        branchId: newBranchId,
        forkId,
        variantIndex,
        parentBranchId: targetBranchId,
        branchState,
      },
      input.turnControls,
    );
  }

  async switchConversationBranch(input: ConversationSwitchBranchRequest): Promise<ConversationSwitchBranchResult> {
    const activeTurns = Array.from(this.activeTurns.values()).filter((turn) => turn.sessionId === input.sessionId);
    for (const turn of activeTurns) turn.stop();
    if (activeTurns.length > 0) {
      await Promise.allSettled(activeTurns.map((turn) => turn.stopped));
    }
    const allMessages = storageAdapter.readConversationHistory(input.sessionId);
    const branchState = this.readRepairedBranchState(input.sessionId, allMessages);
    if (!branchState) {
      return { success: false, messages: [], error: 'No conversation branch state found.' };
    }
    const fork = branchState.forks.find((entry) => entry.forkId === input.forkId);
    const branch = fork?.branches.find((entry) => entry.branchId === input.branchId);
    if (!fork || !branch) {
      return { success: false, messages: [], error: 'Invalid conversation branch selection.' };
    }

    fork.activeBranchId = input.branchId;
    branchState.activeLeafBranchId = input.branchId;
    storageAdapter.writeConversationBranchState(input.sessionId, branchState);

    const visibleMessages = resolveVisibleConversationMessages(allMessages, branchState);
    const tracePresentation = await traceService.buildConversationPresentation(input.sessionId, visibleMessages);
    workflowProjectionPublisher.publishTraceProjectionChanged(input.sessionId, tracePresentation);
    this.publishConversationTrace(input.sessionId, visibleMessages, input.sessionId);

    return {
      success: true,
      messages: allMessages,
      branchState,
      tracePresentation,
    };
  }

  private readRepairedBranchState(
    sessionId: string,
    allMessages: ConversationMessage[],
  ): ConversationBranchState | null {
    const current = storageAdapter.readConversationBranchState(sessionId);
    const { branchState, repaired } = repairConversationBranchState(allMessages, current);
    if (branchState && repaired) {
      storageAdapter.writeConversationBranchState(sessionId, branchState);
    }
    return branchState;
  }

  private async resolveContext(input: ConversationContextInput): Promise<ResolvedConversationContext> {
    const projectId = input.projectId ?? input.fallbackProjectId ?? storageAdapter.getCurrentProjectId() ?? null;
    const persistedSessionId = await storageAdapter.getCurrentSessionId();
    const resolvedSessionId = input.sessionId ?? input.fallbackSessionId ?? persistedSessionId ?? null;
    const session = resolvedSessionId ? storageAdapter.readSession(resolvedSessionId) : null;
    const currentRun = resolvedSessionId
      ? storageAdapter.listRuns(resolvedSessionId).find((entry) => entry.runId === (input.currentRunId ?? input.fallbackRunId))
        ?? storageAdapter.getLatestRun(resolvedSessionId)
      : null;
    const projectInputs = projectId ? storageAdapter.listProjectInputs(projectId) : [];
    const openedCapture = rdxSessionService.snapshotOpenedCapture();
    const activeOpenedCapture = openedCapture?.projectId === projectId
      && openedCapture.status === 'open'
      && openedCapture.ownerSessionId === resolvedSessionId
      ? openedCapture
      : null;
    const replayDevice = replayDeviceService.getDeviceById(input.replayDeviceId || 'local') ?? replayDeviceService.getDeviceById('local');

    return {
      projectId,
      session,
      currentRun,
      projectInputs,
      openedCapture: activeOpenedCapture,
      openedCapturePath: activeOpenedCapture?.filePath ?? null,
      replayDevice,
    };
  }

  private async startProfileTurn(
    context: ResolvedConversationContext,
    requestedMode: AppMode,
    requestedAgentId: string | null,
    rawMessage: string,
    pendingAttachments: ConversationAttachmentInput[],
    branchContext?: ConversationBranchTurnContext,
    requestTurnControls?: ConversationTurnControls,
  ): Promise<ConversationTurnResult> {
    let workingSession = context.session;
    if (!workingSession && context.projectId) {
      workingSession = storageAdapter.createSession(context.projectId, rawMessage.slice(0, 80));
    }

    // 检查待处理 handoff：若有，优先用 handoff 的 toProfile，并把 prompt 前置到用户消息。
    let effectiveMessage = rawMessage;
    let handoffProfile: AgentRole | null = null;
    if (workingSession) {
      const pending = this.pendingHandoffs.get(workingSession.sessionId);
      if (pending && resolveEnabledAgentDefinition(pending.toProfile)) {
        handoffProfile = pending.toProfile;
        this.pendingHandoffs.delete(workingSession.sessionId);
        // handoff prompt 前置为上下文引导，保留用户原始消息。
        effectiveMessage = `${pending.prompt}\n\n---\n用户消息：${rawMessage}`;
      }
    }

    // 优先级：handoff > 显式 requestedAgentId > requestedMode > ask
    const conversationAgentId = handoffProfile
      ?? resolveConversationAgentId(requestedMode, requestedAgentId);

    const turnId = generateEventId('turn');
    const sessionIdForBranch = workingSession?.sessionId ?? null;
    let branchState = branchContext?.branchState ?? (sessionIdForBranch
      ? storageAdapter.readConversationBranchState(sessionIdForBranch)
      : null);
    if (sessionIdForBranch && !branchState) {
      branchState = createDefaultBranchState(sessionIdForBranch);
      storageAdapter.writeConversationBranchState(sessionIdForBranch, branchState);
    }
    const branchId = branchContext?.branchId
      ?? branchState?.activeLeafBranchId
      ?? ROOT_BRANCH_ID;
    const importedAttachments = workingSession
      ? storageAdapter.importSessionAttachments(
          workingSession.sessionId,
          pendingAttachments.map((entry) => entry.sourcePath),
        )
      : [];
    const userMessage = makeConversationMessage('user', rawMessage, {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context.projectId,
      runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
      modeContext: requestedMode,
      attachments: importedAttachments,
      status: 'complete',
      branchId,
      forkId: branchContext?.forkId,
      variantIndex: branchContext?.variantIndex,
    });
    const assistantDraftMessage = makeConversationMessage('assistant', '', {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context.projectId,
      runId: isActiveRun(context.currentRun) ? context.currentRun.runId : null,
      modeContext: requestedMode,
      agentId: conversationAgentId,
      status: 'streaming',
      workTrace: createDraftWorkTrace(),
      branchId,
    });

    const previousBranchState = branchState;
    if (sessionIdForBranch && branchState && branchContext) {
      const nextBranchState = structuredClone(branchState);
      const fork = nextBranchState.forks.find((entry) => entry.forkId === branchContext.forkId);
      if (!fork || fork.branches.some((entry) => entry.branchId === branchId)) {
        throw new Error('Edit and resend failed: conversation branch state changed before the new variant was committed.');
      }
      fork.branches.push({
        branchId,
        parentBranchId: branchContext.parentBranchId,
        variantIndex: branchContext.variantIndex,
        anchorUserMessageId: userMessage.id,
        rootTurnId: turnId,
      });
      fork.activeBranchId = branchId;
      nextBranchState.activeLeafBranchId = branchId;
      try {
        storageAdapter.writeConversationBranchState(sessionIdForBranch, nextBranchState);
        branchState = nextBranchState;
      } catch (error) {
        console.error(`[ConversationService] Failed to persist branch state during rewrite for ${sessionIdForBranch}:`, error);
        throw new Error(
          error instanceof Error
            ? `Edit and resend failed: ${error.message}`
            : 'Edit and resend failed: could not persist conversation branch state.',
        );
      }
    }
    const userPersistError = this.persistConversationSnapshot(workingSession?.sessionId ?? null, userMessage);
    const assistantPersistError = this.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);
    if (userPersistError || assistantPersistError) {
      if (sessionIdForBranch && branchContext && previousBranchState) {
        try {
          storageAdapter.writeConversationBranchState(sessionIdForBranch, previousBranchState);
        } catch (rollbackError) {
          console.error(`[ConversationService] Failed to roll back branch state for ${sessionIdForBranch}:`, rollbackError);
        }
      }
      const error = userPersistError ?? assistantPersistError;
      throw new Error(`Conversation could not be saved: ${error?.message ?? 'unknown persistence error'}`);
    }
    const visibleMessages = workingSession?.sessionId && branchState
      ? resolveVisibleConversationMessages(
          storageAdapter.readConversationHistory(workingSession.sessionId),
          branchState,
        )
      : [userMessage, assistantDraftMessage];
    const traceSessionId = workingSession?.sessionId ?? this.ephemeralTraceSessionId(turnId);
    const tracePresentation = await traceService.buildConversationPresentation(
      traceSessionId,
      [userMessage, assistantDraftMessage],
    );
    workflowProjectionPublisher.publishTraceProjectionChanged(traceSessionId, tracePresentation);
    this.publishConversationTrace(traceSessionId, [userMessage, assistantDraftMessage], workingSession?.sessionId ?? null);

    void this.completeProfileTurn({
      context: {
        ...context,
        session: workingSession,
      },
      requestedMode,
      requestedAgentId: conversationAgentId,
      rawMessage: effectiveMessage,
      importedAttachments,
      userMessage,
      assistantDraftMessage,
      requestTurnControls,
    });

    return {
      session: workingSession,
      mode: 'talk',
      userMessage,
      assistantDraftMessage,
      messages: visibleMessages,
      branchState: branchState ?? null,
      executionTransition: { action: 'none' },
      runUpdate: null,
      tracePresentation,
      errorViewModel: null,
    };
  }

  private async completeProfileTurn(input: {
    context: ResolvedConversationContext;
    requestedMode: AppMode;
    requestedAgentId: AgentRole;
    rawMessage: string;
    importedAttachments: SessionAttachmentRecord[];
    userMessage: ConversationMessage;
    assistantDraftMessage: ConversationMessage;
    requestTurnControls?: ConversationTurnControls;
  }) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const traceSessionId = sessionId ?? this.ephemeralTraceSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();
    const conversationAgentId: AgentRole = input.requestedAgentId;
    const capturedBranchId = input.assistantDraftMessage.branchId
      ?? input.userMessage.branchId
      ?? ROOT_BRANCH_ID;
    const agentLabel = getAgentLabel(conversationAgentId);
    const showWorkTrace = true;

    const settings = settingsService.getAll();
    const route = settings.llm.agentRoutes.find((entry) => entry.agentId === conversationAgentId);
    const capability = route?.providerId && route.modelId
      ? resolveEffectiveModel(route.providerId, route.modelId, settings)
      : null;
    const planning = route?.providerId && route.modelId
      ? planEffectiveModelRequest({
          providerId: route.providerId,
          modelId: route.modelId,
          settings,
          controls: {
            ...(input.context.session?.turnControls ?? {}),
            ...(input.requestTurnControls ?? {}),
          },
          requestedTemperature: 0.35,
        })
      : null;
    if (planning && !planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
    const turnControls = planning?.ok ? planning.controls : undefined;
    if (sessionId && turnControls) {
      storageAdapter.updateSession(sessionId, { turnControls });
    }

    let streamScheduler: ConversationStreamPatchScheduler | null = null;
    let conversationPersistenceError: Error | null = null;
    const terminalContext: { value: {
      messages: AgentRuntimeMessage[];
      route: SessionContextRoute;
      status: 'complete' | 'stopped' | 'error';
    } | null } = { value: null };

    const applyAssistantMessagePatch = (
      type: ConversationStreamEvent['type'],
      patch: Partial<ConversationMessage>,
      options: ConversationStreamPatchCommitOptions = { persist: true, publishTrace: true },
    ) => {
      if (abortController.signal.aborted && patch.status !== 'stopped') {
        return;
      }
      assistantMessage = {
        ...assistantMessage,
        ...patch,
        updatedAt: nowMs(),
      };
      if (options.persist) {
        const persistError = this.persistConversationSnapshot(sessionId, assistantMessage);
        if (persistError) {
          conversationPersistenceError ??= persistError;
          abortController.abort();
          assistantMessage = {
            ...assistantMessage,
            status: 'error',
            diagnostic: {
              code: 'CONVERSATION_LLM_REQUEST_FAILED',
              severity: 'error',
              userMessage: 'Conversation state could not be saved. Retry before continuing.',
              technicalMessage: persistError.message,
            },
            updatedAt: nowMs(),
          };
          this.emitConversationEvent({
            type: 'message_errored',
            sessionId: sessionId ?? '',
            turnId: assistantMessage.turnId,
            message: assistantMessage,
          });
          this.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
          return;
        }
      }
      this.emitConversationEvent({
        type,
        sessionId: sessionId ?? '',
        turnId: assistantMessage.turnId,
        message: assistantMessage,
      } as ConversationStreamEvent);
      if (options.publishTrace) {
        this.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
      }
    };

    streamScheduler = new ConversationStreamPatchScheduler({
      commit: ({ type, patch, options }) => applyAssistantMessagePatch(type, patch, options),
    });

    const commitAssistantMessage = (
      type: ConversationStreamEvent['type'],
      patch: Partial<ConversationMessage>,
      options: Partial<ConversationStreamPatchCommitOptions> = {},
    ) => {
      streamScheduler?.commitImmediate(type, patch, options);
    };

    const commitTerminalAssistantMessage = (
      type: ConversationStreamEvent['type'],
      patch: Partial<ConversationMessage>,
    ) => {
      streamScheduler?.commitTerminal(type, patch);
    };

    const commitStoppedMessage = () => {
      agentUserInputRequestService.cancelTurn(assistantMessage.turnId);
      agentToolApprovalRequestService.cancelTurn(assistantMessage.turnId);
      commitTerminalAssistantMessage('message_completed', {
        status: 'stopped',
        content: assistantMessage.content || '当前请求已停止。',
        workTrace: finalizeTrace(
          upsertWorkBlock(assistantMessage.workTrace, 'assistant-output', {
            status: 'complete',
            summary: '用户已停止当前请求。',
            completedAt: nowMs(),
          }),
          'stopped',
          '请求已停止',
        ),
      });
    };

    let settleStopped = () => {};
    const stopped = new Promise<void>((resolve) => {
      settleStopped = resolve;
    });
    this.registerActiveTurn({
      turnId: assistantMessage.turnId,
      sessionId,
      startedAt: nowMs(),
      abortController,
      stopped,
      stop: () => {
        if (!abortController.signal.aborted) {
          try {
            streamScheduler?.flushPending({ forcePersist: true, publishTrace: true });
          } catch (error) {
            console.error('[ConversationService] stop flush failed:', error);
          }
          abortController.abort();
        }
      },
    });

    try {

    const commitVisibleAssistantText = () => {
      streamScheduler?.queueText({
        status: 'streaming',
        content: visibleResponse,
      });
    };

    const commitThinkingTrace = (workTrace: ConversationWorkTrace) => {
      streamScheduler?.queueTrace({ workTrace });
    };

    const withWorkTrace = (workTrace: ConversationWorkTrace): Partial<ConversationMessage> => (
      showWorkTrace ? { workTrace } : {}
    );

    let rawResponse = '';
    let visibleResponse = '';
    // Assistant turns are split into LLM loop turns. The loop result is model output;
    let currentLoopText = '';
    let currentLoopThinking: ThinkingArtifact | undefined;
    let currentLoopThinkingStatus: ConversationThinkingStatus | undefined;
    let loopSeq = 1;
    let loopHasTools = false;
    let pendingNewLoop = false;
    let currentLoopOutputPhase: ConversationLoopOutputPhase | undefined;
    /** Once true for this turn, process commentary must not stream into the answer bubble. */
    let turnHasProcessEvidence = false;
    /** After ask_user pause, subsequent assistant content must not reuse the ask commentary loop. */
    let turnHadAskPause = false;
    const pendingContinuation: ConversationLoopContinuationState = {
      approval: false,
      userInput: false,
      subagent: false,
      handoff: false,
    };
    const markProcessEvidence = () => {
      turnHasProcessEvidence = true;
    };
    const markLoopCommentary = () => {
      // Commentary evidence is monotonic within a loop. Final-answer phase is
      // assigned only by assistant.completed after the stop reason is known.
      currentLoopOutputPhase = 'commentary';
      markProcessEvidence();
    };
    const hasPendingContinuation = () => (
      pendingContinuation.approval
      || pendingContinuation.userInput
      || pendingContinuation.subagent
      || pendingContinuation.handoff
    );
    const resolveStreamingOutputPhase = (): ConversationLoopOutputPhase | undefined => {
      return currentLoopOutputPhase;
    };
    const syncVisibleResponseForStreaming = () => {
      const phase = resolveStreamingOutputPhase();
      const thinkingInFlight = currentLoopThinkingStatus === 'streaming';
      // Stream into the bubble only for clear finals — never while thinking/tools/ask are active.
      if (
        phase === 'final_answer'
        && !thinkingInFlight
        && !loopHasTools
        && !hasPendingContinuation()
      ) {
        visibleResponse = currentLoopText;
      } else if (
        phase === undefined
        && !turnHasProcessEvidence
        && !loopHasTools
        && !currentLoopThinking
        && !hasPendingContinuation()
        && !turnHadAskPause
      ) {
        visibleResponse = currentLoopText;
      } else if (visibleResponse) {
        visibleResponse = '';
      }
    };
    const currentLoopId = () => `runtime-loop-${loopSeq}`;
    let errorViewModel: ConversationTurnResult['errorViewModel'] = null;
    let llmDiagnostic: ConversationMessageDiagnostic | null = null;
    let runWasCancelled = false;
    const seenCompactionSummaries = new Set<string>();
    const routePreflight = resolveAgentRoutePreflight(conversationAgentId);
    const currentLoopOptions = () => ({
      loopId: currentLoopId(),
      loopResultText: currentLoopText.trim() || undefined,
      loopThinking: currentLoopThinking,
      loopThinkingStatus: currentLoopThinkingStatus,
    });
    const beginAssistantContentLoop = () => {
      const previousLoopSeq = loopSeq;
      const next = beginAssistantContentLoopIfPending({
        loopSeq,
        currentLoopText,
        currentLoopThinking,
        currentLoopThinkingStatus,
        loopHasTools,
        pendingNewLoop,
        visibleResponse,
      });
      loopSeq = next.loopSeq;
      currentLoopText = next.currentLoopText;
      currentLoopThinking = next.currentLoopThinking;
      currentLoopThinkingStatus = next.currentLoopThinkingStatus;
      loopHasTools = next.loopHasTools;
      pendingNewLoop = next.pendingNewLoop;
      visibleResponse = next.visibleResponse;
      if (next.loopSeq !== previousLoopSeq) {
        currentLoopOutputPhase = undefined;
      }
    };

    if (!routePreflight.ok) {
      llmDiagnostic = routePreflight.diagnostic;
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage,
      };
      rawResponse = llmDiagnostic.userMessage;
      visibleResponse = llmDiagnostic.userMessage;
      recordLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
      commitAssistantMessage('message_patched', {
        ...withWorkTrace(upsertWorkBlock(assistantMessage.workTrace, 'runtime-route-diagnostic', {
          kind: 'diagnostic',
          status: llmDiagnostic.severity === 'error' ? 'error' : 'complete',
          title: 'Model route diagnostic',
          stage: 'preflight',
          summary: [llmDiagnostic.userMessage, llmDiagnostic.technicalMessage].filter(Boolean).join('\n'),
          completedAt: nowMs(),
        })),
      });
    } else {
      try {
        const projectRootPath = input.context.projectId
          ? storageAdapter.getProjectById(input.context.projectId)?.rootPath ?? null
          : null;
        const runtimeSettings = settingsService.getAll();
        const definition = agentManifestService.getEffectiveProfiles(
          runtimeSettings.paths,
          runtimeSettings.llm.providers,
          runtimeSettings.llm.agentRoutes,
          projectRootPath ?? undefined,
        ).find((profile) => profile.id === conversationAgentId && profile.enabled)
          ?? resolveEnabledAgentDefinition(conversationAgentId);
        if (!definition) throw new Error(`No effective agent profile is configured for ${conversationAgentId}.`);
        const allowedToolNames = resolveAgentToolAllowlist(conversationAgentId, 'investigate')
          .map((toolName) => normalizeToolName(toolName));
        const activePaths = [
          projectRootPath,
          input.context.openedCapturePath,
          ...input.importedAttachments.map((attachment) => attachment.filePath),
        ].filter((value): value is string => Boolean(value));
        const scopedInstructions = projectRootPath
          ? scopedInstructionResolver.resolveForPaths({
              userInstructionsPath: appPathService.getUserRdxPaths().instructionsPath,
              projectRoot: projectRootPath,
              activePaths,
            })
          : { sources: [], totalBytes: 0, diagnostics: [] };
        const preloadedSkills = definition.skills
          .map((skillId) => agentRuntimeConfigService.loadSkill(skillId, projectRootPath ?? undefined))
          .filter((skill): skill is NonNullable<typeof skill> => skill !== null);
        const promptClock = resolvePromptClock();
        const promptPlan = promptPlanBuilder.build({
          profile: definition,
          scopedInstructions,
          preloadedSkills,
          skillCatalog: agentRuntimeConfigService.listSkillMetadata(projectRootPath ?? undefined),
          tools: allowedToolNames,
          workDir: projectRootPath ?? '',
          routeCapability: routePreflight.routeCapability,
          effectiveModel: capability ?? undefined,
          permissionSettings: runtimeSettings.agentRuntime.permissions,
          currentDate: promptClock.currentDate,
          timeZone: promptClock.timeZone,
          contextWindowTokens: planning?.ok ? planning.plan.contextBudgetTokens : undefined,
        });
        const visibleTurnIds = sessionId
          ? Array.from(new Set(resolveVisibleConversationMessages(
              storageAdapter.readConversationHistory(sessionId),
              this.readRepairedBranchState(sessionId, storageAdapter.readConversationHistory(sessionId)),
            ).filter((message) => message.turnId !== assistantMessage.turnId).map((message) => message.turnId)))
          : [];
        const responseText = await agentOrchestrator.sendProfileMessage(
          conversationAgentId,
          input.rawMessage,
          {
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            stage: 'investigate',
            projectRootPath,
            projectId: input.context.projectId,
            systemPrompt: promptPlan.systemPrompt,
            promptPlan,
            maxTokens: 1200,
            temperature: 0.35,
            signal: abortController.signal,
            turnControls,
            visibleTurnIds,
            activeBranchId: assistantMessage.branchId ?? input.userMessage.branchId ?? ROOT_BRANCH_ID,
            onTerminalContext: (result) => {
              terminalContext.value = {
                messages: result.messages,
                route: result.route,
                status: result.status,
              };
            },
            onEvent: (event: AgentEvent) => {
              this.emitConversationEvent({
                type: 'agent_event',
                sessionId: sessionId ?? '',
                turnId: assistantMessage.turnId,
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
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, 'runtime-run', {
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
                    workTrace: upsertWorkBlock(assistantMessage.workTrace, `compaction-${event.id}`, {
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
                const chunk = typeof event.payload.text === 'string' ? event.payload.text : '';
                if (chunk) {
                  beginAssistantContentLoop();
                  rawResponse += chunk;
                  currentLoopText += chunk;
                  syncVisibleResponseForStreaming();
                  commitVisibleAssistantText();
                  commitThinkingTrace(upsertLoopResult(
                    assistantMessage.workTrace,
                    currentLoopId(),
                    currentLoopText,
                    currentLoopThinking,
                    currentLoopThinkingStatus,
                    'streaming',
                    undefined,
                    resolveStreamingOutputPhase(),
                  ));
                }
              }
              if (event.type === 'assistant.thinking_delta') {
                const payload = event.payload as { text?: string; thinking?: ThinkingArtifact };
                beginAssistantContentLoop();
                markProcessEvidence();
                currentLoopThinking = mergeThinkingPayload(
                  currentLoopThinking,
                  payload.thinking,
                  typeof payload.text === 'string' ? payload.text : '',
                );
                if (currentLoopThinking) {
                  currentLoopThinkingStatus = 'streaming';
                  // Thinking owns the process area; clear any optimistic bubble text.
                  // Do not force outputPhase=commentary — that flashes final tokens into WP prose
                  // when text deltas arrive on the same loop before completed reclassifies.
                  if (visibleResponse) {
                    visibleResponse = '';
                    commitVisibleAssistantText();
                  }
                  commitThinkingTrace(upsertLoopResult(
                    assistantMessage.workTrace,
                    currentLoopId(),
                    currentLoopText || undefined,
                    currentLoopThinking,
                    currentLoopThinkingStatus,
                    'streaming',
                    undefined,
                    resolveStreamingOutputPhase(),
                  ));
                }
              }
              if (event.type === 'assistant.thinking_end') {
                const payload = event.payload as { text?: string; thinking?: ThinkingArtifact };
                beginAssistantContentLoop();
                markProcessEvidence();
                currentLoopThinking = mergeThinkingPayload(
                  currentLoopThinking,
                  payload.thinking,
                  typeof payload.text === 'string' ? payload.text : '',
                );
                if (visibleResponse) {
                  visibleResponse = '';
                  commitVisibleAssistantText();
                }
                if (currentLoopThinking) {
                  currentLoopThinkingStatus = 'complete';
                  commitThinkingTrace(upsertLoopResult(
                    assistantMessage.workTrace,
                    currentLoopId(),
                    currentLoopText || undefined,
                    currentLoopThinking,
                    currentLoopThinkingStatus,
                    'streaming',
                    undefined,
                    resolveStreamingOutputPhase(),
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
                if (payload.code === 'MODEL_THINKING_STARTED' || payload.code === 'MODEL_THINKING_COMPLETED') {
                  return;
                }
                const isRecovery = typeof payload.code === 'string' && payload.code.startsWith('error_recovery_');
                const blockStatus = payload.phase === 'started'
                  ? 'running'
                  : payload.severity === 'error'
                    ? 'error'
                    : 'complete';
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `runtime-diagnostic-${payload.code ?? 'runtime'}`, {
                    kind: 'diagnostic',
                    status: blockStatus,
                    title: isRecovery ? '错误恢复' : 'Runtime diagnostic',
                    summary,
                    completedAt: blockStatus === 'running' ? undefined : nowMs(),
                  }),
                });
              }
              if (event.type === 'tool.requested') {
                const payload = event.payload as {
                  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
                };
                if (payload.toolCall?.id && payload.toolCall.name) {
                  const loopScoped = isLoopTool(String(payload.toolCall.name));
                  if (loopScoped) {
                    loopHasTools = true;
                    markLoopCommentary();
                    // Tool loops keep commentary in Work Process; clear bubble flash.
                    if (visibleResponse) {
                      visibleResponse = '';
                      commitVisibleAssistantText();
                    }
                    // Stamp commentary explicitly so projection does not hide pre-tool narrative.
                    if (currentLoopText.trim()) {
                      commitThinkingTrace(upsertLoopResult(
                        assistantMessage.workTrace,
                        currentLoopId(),
                        currentLoopText,
                        currentLoopThinking,
                        currentLoopThinkingStatus,
                        'streaming',
                        undefined,
                        'commentary',
                      ));
                    }
                  }
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                      id: String(payload.toolCall.id),
                      toolName: String(payload.toolCall.name),
                      status: 'pending',
                      argsPreview: JSON.stringify(payload.toolCall.arguments ?? {}).slice(0, 600),
                      startedAt: nowMs(),
                    }, loopScoped ? currentLoopOptions() : undefined),
                  });
                }
              }
              if (event.type === 'tool.started') {
                const loopScoped = isLoopTool(String(event.payload.toolName));
                if (loopScoped) {
                  loopHasTools = true;
                  markLoopCommentary();
                }
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
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
                  loopHasTools = true;
                  markLoopCommentary();
                }
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
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
                  turnHadAskPause = true;
                  // Insurance: assistant.completed(tool_use) arrives before ask_user approval.
                  // Force the next assistant content onto a fresh loop even if that earlier
                  // completed handler missed the pause (ask_user is not a loop-scoped tool).
                  pendingNewLoop = true;
                  markLoopCommentary();
                  // Retract any mis-classified final_answer bubble text from the ask pause.
                  if (visibleResponse) {
                    visibleResponse = '';
                    commitVisibleAssistantText();
                  }
                  const questions = normalizeAskUserQuestions({ questions: payload.questions });
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertLoopResult(
                      upsertRuntimeToolCall(assistantMessage.workTrace, {
                        id: toolCallId,
                        toolName: 'ask_user',
                        status: 'running',
                        userInputQuestions: questions,
                        argsPreview: questions.map((question) => question.prompt).join(' | ').slice(0, 600),
                        startedAt: nowMs(),
                      }),
                      currentLoopId(),
                      currentLoopText || undefined,
                      currentLoopThinking,
                      currentLoopThinkingStatus,
                      'complete',
                      'tool_use',
                      'commentary',
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
                  workTrace: upsertRuntimeToolApproval(assistantMessage.workTrace, {
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
                    workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
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
                  workTrace: upsertRuntimeToolApproval(assistantMessage.workTrace, {
                    approvalId,
                    toolCallId: String(payload.toolCallId ?? approvalId),
                    toolName: String(payload.toolName ?? 'approval'),
                    status: approvalStatus,
                    answer: answerText,
                  }, currentLoopOptions()),
                });
              }
              if (event.type === 'tool.completed') {
                const result = event.payload.result as { ok?: boolean; error?: { message?: string } } | undefined;
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
                if (!(isAskUserTool && result?.ok)) {
                  toolCallPatch.resultPreview = buildToolResultPreview(event.payload.result ?? {});
                }
                const loopScopedCompleted = isLoopTool(String(event.payload.toolName));
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(
                    assistantMessage.workTrace,
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
                };
                const taskId = typeof payload.taskId === 'string' && payload.taskId.trim()
                  ? payload.taskId.trim()
                  : 'runtime-tasks';
                const title = typeof payload.title === 'string' && payload.title.trim()
                  ? payload.title.trim()
                  : taskId;
                const blockStatus: ConversationWorkBlock['status'] = payload.status === 'failed'
                  || payload.status === 'deleted'
                  ? 'error'
                  : payload.status === 'in_progress'
                    ? 'running'
                    : payload.status === 'pending'
                      ? 'pending'
                      : 'complete';
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, taskId, {
                    kind: 'command',
                    title,
                    stage: 'tool',
                    status: blockStatus,
                    summary: title,
                    completedAt: blockStatus === 'running' || blockStatus === 'pending' ? undefined : nowMs(),
                  }),
                });
              }
              if (event.type === 'subagent.started') {
                const payload = event.payload as { subagentId: string; profile: string; parentToolCallId: string; text?: string };
                pendingContinuation.subagent = true;
                markLoopCommentary();
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
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
                    workTrace: upsertSubagentChild(assistantMessage.workTrace, blockId, {
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
                    workTrace: upsertWorkBlock(assistantMessage.workTrace, blockId, {
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
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
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
                  stopReason?: ConversationLoopStopReason;
                };
                beginAssistantContentLoop();
                const loopResult = typeof payload.text === 'string' ? payload.text.trim() : '';
                const stopReason = payload.stopReason;
                const completedThinking = selectCompletedThinking(payload.thinking) ?? currentLoopThinking;
                if (completedThinking) {
                  currentLoopThinking = completedThinking;
                  currentLoopThinkingStatus = 'complete';
                }
                const resolvedOutputPhase = resolveConversationLoopOutputPhase({
                  stopReason,
                  loopHasTools,
                  hasPendingContinuation: pendingContinuation,
                });
                const outputPhase = currentLoopOutputPhase ?? resolvedOutputPhase;
                currentLoopOutputPhase = outputPhase;
                const reasoningState = resolveConversationReasoningState(
                  completedThinking,
                  routePreflight.routeCapability.reasoningDelivery,
                );
                if (loopResult || currentLoopThinking || stopReason || outputPhase) {
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertLoopResult(
                      assistantMessage.workTrace,
                      currentLoopId(),
                      loopResult || undefined,
                      currentLoopThinking,
                      currentLoopThinkingStatus,
                      'complete',
                      stopReason,
                      outputPhase,
                      reasoningState,
                    ),
                  });
                }
                if (outputPhase === 'final_answer') {
                  visibleResponse = loopResult;
                } else {
                  // Commentary stays in Work Process; never leave process text in the bubble.
                  visibleResponse = '';
                }
                commitVisibleAssistantText();
                // Any commentary / pending continuation ends this loop so the next assistant
                // content (including post-ask final answers) cannot reuse a stale commentary phase.
                if (
                  outputPhase === 'commentary'
                  || hasPendingContinuation()
                  || loopHasTools
                  || turnHadAskPause
                  || stopReason === 'tool_use'
                ) {
                  pendingNewLoop = true;
                }
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, 'assistant-output', {
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
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, 'runtime-run', {
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
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `runtime-${event.type}`, {
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
                runWasCancelled = true;
              }
            },
          },
        );

        if (!rawResponse) {
          rawResponse = responseText;
        }
      } catch (error) {
        llmDiagnostic = createRequestFailedDiagnostic(routePreflight, error);
        errorViewModel = {
          code: llmDiagnostic.code,
          message: llmDiagnostic.userMessage,
          technicalMessage: llmDiagnostic.technicalMessage,
        };
        rawResponse = llmDiagnostic.userMessage;
        visibleResponse = llmDiagnostic.userMessage;
        currentLoopText = llmDiagnostic.userMessage;
        recordLlmDiagnostic(input.context, llmDiagnostic);
        commitVisibleAssistantText();
      }
    }

    if (abortController.signal.aborted || runWasCancelled) return;
    const assistantContent = (currentLoopText.trim() || rawResponse || visibleResponse).trim();
    visibleResponse = assistantContent;
    const isRouteMissingDiagnostic = llmDiagnostic?.code === 'CONVERSATION_LLM_ROUTE_MISSING';
    const finalStatus: ConversationMessage['status'] = runWasCancelled
      ? 'stopped'
      : errorViewModel && !isRouteMissingDiagnostic
        ? 'error'
        : 'complete';
    const traceStatus: ConversationWorkTrace['status'] = runWasCancelled
      ? 'stopped'
      : errorViewModel && !isRouteMissingDiagnostic
        ? 'error'
        : 'complete';

    if (abortController.signal.aborted || runWasCancelled) return;

    const outputSummary = llmDiagnostic
      ? llmDiagnostic.code === 'CONVERSATION_LLM_REQUEST_FAILED'
        ? 'Model request failed; diagnostic recorded.'
        : 'Model route unavailable; configuration diagnostic returned.'
      : 'Final answer generated.';

    commitTerminalAssistantMessage(finalStatus === 'error' ? 'message_errored' : 'message_completed', {
      status: finalStatus,
      content: assistantContent,
      diagnostic: llmDiagnostic,
      ...withWorkTrace(finalizeTrace(
        upsertWorkBlock(assistantMessage.workTrace, 'assistant-output', {
          kind: 'output',
          status: finalStatus === 'error' ? 'error' : 'complete',
          summary: outputSummary,
          completedAt: nowMs(),
        }),
        traceStatus,
        llmDiagnostic
          ? finalStatus === 'error'
            ? '回复失败'
            : '等待模型配置'
          : '回复已完成',
      )),
    });
    // handoff 消费：agent_handoff 工具成功时设置 pendingHandoff，
    // turn 完成后 consume → emit handoff.requested 事件 + 存入 pendingHandoffs map，
    // 下次该 session 消息自动用新 profile 并前置 handoff prompt。
    if (finalStatus !== 'error' && input.context.session) {
      const handoff = agentOrchestrator.consumePendingHandoff();
      if (handoff && handoff.toProfile && resolveEnabledAgentDefinition(handoff.toProfile)) {
        this.pendingHandoffs.set(input.context.session.sessionId, {
          toProfile: handoff.toProfile,
          prompt: handoff.prompt,
        });
        this.emitConversationEvent({
          type: 'agent_event',
          sessionId: input.context.session.sessionId,
          turnId: assistantMessage.turnId,
          event: {
            id: generateEventId('agent-event'),
            type: 'handoff.requested',
            timestamp: nowMs(),
            sessionId: input.context.session.sessionId,
            agentId: handoff.fromAgentId,
            payload: {
              fromAgentId: handoff.fromAgentId,
              toProfile: handoff.toProfile,
              prompt: handoff.prompt,
              label: handoff.label,
            },
          },
        });
      }
    }

    } finally {
      if (abortController.signal.aborted && !conversationPersistenceError && assistantMessage.status === 'streaming') {
        try {
          commitStoppedMessage();
        } catch (error) {
          console.error('[ConversationService] terminal stop commit failed:', error);
        }
      }
      if (sessionId && terminalContext.value && !conversationPersistenceError) {
        const capturedContext = terminalContext.value;
        try {
          this.assertTerminalContextOwnership(
            sessionId,
            assistantMessage.turnId,
            input.userMessage.id,
            assistantMessage.id,
            capturedBranchId,
          );
          sessionContextJournal.append(sessionId, {
            schemaVersion: 1,
            turnId: assistantMessage.turnId,
            userMessageId: input.userMessage.id,
            assistantMessageId: assistantMessage.id,
            branchId: capturedBranchId,
            agentId: conversationAgentId,
            route: capturedContext.route,
            controls: turnControls ?? { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
            status: assistantMessage.status === 'stopped' ? 'stopped' : assistantMessage.status === 'error' ? 'error' : capturedContext.status,
            messages: capturedContext.messages,
            createdAt: input.userMessage.createdAt,
            completedAt: assistantMessage.updatedAt ?? nowMs(),
          });
        } catch (error) {
          console.error(`[ConversationService] Context journal append failed for ${assistantMessage.turnId}:`, error);
          if (assistantMessage.status !== 'stopped') {
            assistantMessage = {
              ...assistantMessage,
              status: 'error',
              diagnostic: {
                code: 'CONVERSATION_LLM_REQUEST_FAILED',
                severity: 'error',
                userMessage: 'Conversation context could not be saved. Retry before continuing.',
                technicalMessage: error instanceof Error ? error.message : String(error),
              },
              updatedAt: nowMs(),
            };
            const terminalPersistError = this.persistConversationSnapshot(sessionId, assistantMessage);
            if (terminalPersistError) {
              console.error(
                `[ConversationService] Failed to persist context-persistence error for ${assistantMessage.turnId}; subsequent materialization will fail closed.`,
                terminalPersistError,
              );
            }
            this.emitConversationEvent({
              type: 'message_errored',
              sessionId,
              turnId: assistantMessage.turnId,
              message: assistantMessage,
            });
            this.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
          }
        }
      }
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      settleStopped();
    }
  }

  private persistConversationSnapshot(
    sessionId: string | null | undefined,
    message: ConversationMessage,
  ): Error | null {
    if (!sessionId) {
      return null;
    }
    try {
      storageAdapter.appendConversationMessage(sessionId, message);
      return null;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (/^Session not found for conversation history:/i.test(normalized.message)) {
        console.info(`[ConversationService] Ignored conversation write after session teardown for ${sessionId}.`);
        return null;
      }
      console.error(`[ConversationService] Failed to persist conversation snapshot for ${sessionId}:`, normalized);
      return normalized;
    }
  }

  private assertTerminalContextOwnership(
    sessionId: string,
    turnId: string,
    userMessageId: string,
    assistantMessageId: string,
    branchId: string,
  ): void {
    const history = storageAdapter.readConversationHistory(sessionId);
    const user = history.find((message) => message.id === userMessageId);
    const assistant = history.find((message) => message.id === assistantMessageId);
    const normalizedBranchId = normalizeBranchId(branchId);
    if (
      !user
      || user.role !== 'user'
      || user.turnId !== turnId
      || normalizeBranchId(user.branchId) !== normalizedBranchId
      || !assistant
      || assistant.role !== 'assistant'
      || assistant.turnId !== turnId
      || normalizeBranchId(assistant.branchId) !== normalizedBranchId
    ) {
      throw new Error(`Conversation message ownership changed before context journal append for turn ${turnId}.`);
    }
    if (normalizedBranchId === ROOT_BRANCH_ID) return;
    const branchState = storageAdapter.readConversationBranchState(sessionId);
    const concreteBranch = branchState?.forks
      .flatMap((fork) => fork.branches)
      .find((branch) => branch.branchId === normalizedBranchId);
    if (
      !concreteBranch
      || concreteBranch.anchorUserMessageId !== userMessageId
      || concreteBranch.rootTurnId !== turnId
    ) {
      throw new Error(`Conversation branch ownership changed before context journal append for turn ${turnId}.`);
    }
  }

  private emitConversationEvent(event: ConversationStreamEvent) {
    workflowProjectionPublisher.publishConversationEvent(event);
  }

  private publishTraceProjection(sessionId: string | null | undefined): void {
    if (!sessionId) {
      return;
    }

    void traceService.getSession(sessionId)
      .then((result) => {
        if (result.success && result.presentation) {
          workflowProjectionPublisher.publishTraceProjectionChanged(sessionId, result.presentation);
        }
      })
      .catch((error) => {
        console.error('[ConversationService] Failed to publish trace projection:', error);
      });
  }

  private publishConversationTrace(
    traceSessionId: string,
    messages: ConversationMessage[],
    persistedSessionId?: string | null,
  ): void {
    if (persistedSessionId) {
      this.publishTraceProjection(persistedSessionId);
      return;
    }

    void traceService.buildConversationPresentation(traceSessionId, messages)
      .then((presentation) => {
        workflowProjectionPublisher.publishTraceProjectionChanged(traceSessionId, presentation);
      });
  }

  private ephemeralTraceSessionId(turnId: string): string {
    return `conversation-${turnId}`;
  }

  /**
   * 将 agentId 映射为 PromptContext.mode。
   *
   * Plan 归入 ask（ReadOnly 变体），非顶层 agent 归入 edit；
   * 与 AgentOrchestrator.modeForAgent 保持一致语义。
   */
}

export const conversationService = new ConversationService();
