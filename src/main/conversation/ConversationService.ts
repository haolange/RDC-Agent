import type {
  ConversationAttachmentInput,
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerToolApprovalResult,
  ConversationAnswerUserInputRequest,
  ConversationAnswerUserInputResult,
  ConversationCancelActiveTurnRequest,
  ConversationCancelActiveTurnResult,
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationRewriteFromMessageRequest,
  ConversationThinkingPresentation,
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
import type { AgentRouteCapability, ReasoningDelivery } from '@shared/types/agentRuntime';
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
import { generateEventId, nowMs } from '@shared/utils/id';
import type { AgentEvent } from '@shared/types/agentRuntime';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { PromptAssembler } from '../agent-runtime/prompt';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
import { traceService } from '../agent-trace/TraceService';
import { replayDeviceService } from '../captures/ReplayDeviceService';
import { rdxSessionService } from '../index';
import { settingsService } from '../settings/SettingsService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { AGENT_DESCRIPTIONS, AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { normalizeToolName, resolveAgentToolAllowlist } from '../workflow/debugger/DebuggerRuntimePolicy';
import {
  createDefaultBranchState,
  normalizeBranchId,
  resolveVisibleConversationMessages,
} from './ConversationBranchResolver';

interface ConversationBranchTurnContext {
  branchId: string;
  forkId?: string;
  variantIndex?: number;
}

function resolveThinkingPresentation(
  reasoningDelivery: ReasoningDelivery | undefined,
  hasThinking: boolean,
): ConversationThinkingPresentation {
  if (!hasThinking || !reasoningDelivery || reasoningDelivery === 'none' || reasoningDelivery === 'hidden') {
    return 'none';
  }
  if (reasoningDelivery === 'summary-only') return 'summary';
  return 'full';
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

function createWorkBlock(
  id: string,
  title: string,
  stage?: string,
  kind: ConversationWorkBlock['kind'] = 'reasoning',
): ConversationWorkBlock {
  return {
    id,
    kind,
    title,
    stage,
    status: 'pending',
    toolCalls: [],
    startedAt: nowMs(),
  };
}

function createDraftWorkTrace(summary?: string, blocks: ConversationWorkBlock[] = []): ConversationWorkTrace {
  return {
    status: 'running',
    summary,
    blocks,
    updatedAt: nowMs(),
  };
}

function cloneTrace(trace: ConversationWorkTrace | null | undefined): ConversationWorkTrace {
  return trace
    ? {
        ...trace,
        blocks: trace.blocks.map((block) => ({
          ...block,
          toolCalls: block.toolCalls.map((toolCall) => ({ ...toolCall })),
        })),
      }
    : {
        status: 'idle',
        blocks: [],
        updatedAt: nowMs(),
  };
}

function upsertWorkBlock(
  trace: ConversationWorkTrace | null | undefined,
  blockId: string,
  patch: Partial<ConversationWorkBlock>,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const blockIndex = nextTrace.blocks.findIndex((block) => block.id === blockId);
  if (blockIndex >= 0) {
    nextTrace.blocks[blockIndex] = {
      ...nextTrace.blocks[blockIndex],
      ...patch,
      toolCalls: patch.toolCalls
        ? patch.toolCalls.map((toolCall) => ({ ...toolCall }))
        : nextTrace.blocks[blockIndex].toolCalls.map((toolCall) => ({ ...toolCall })),
    };
  } else {
    nextTrace.blocks.push({
      ...createWorkBlock(blockId, patch.title || blockId, patch.stage, patch.kind),
      ...patch,
      kind: patch.kind ?? 'reasoning',
      toolCalls: patch.toolCalls ? patch.toolCalls.map((toolCall) => ({ ...toolCall })) : [],
    });
  }
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

function finalizeTrace(
  trace: ConversationWorkTrace | null | undefined,
  status: ConversationWorkTrace['status'],
  summary?: string,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const terminalBlockStatus: ConversationWorkBlock['status'] | null =
    status === 'complete'
      ? 'complete'
      : status === 'error' || status === 'stopped'
        ? 'error'
        : null;

  if (terminalBlockStatus) {
    const terminalAt = nowMs();
    nextTrace.blocks = nextTrace.blocks.map((block) => {
      const blockStatus = block.status === 'pending' || block.status === 'running'
        ? terminalBlockStatus
        : block.status;
      const blockCompletedAt = block.completedAt ?? terminalAt;
      return {
        ...block,
        status: blockStatus,
        completedAt: blockCompletedAt,
        toolCalls: block.toolCalls.map((toolCall) => {
          if (toolCall.status !== 'pending' && toolCall.status !== 'running') {
            return { ...toolCall };
          }
          return {
            ...toolCall,
            status: terminalBlockStatus,
            completedAt: toolCall.completedAt ?? terminalAt,
            error: terminalBlockStatus === 'error'
              ? (toolCall.error ?? 'Run ended before this tool call completed.')
              : toolCall.error,
          };
        }),
      };
    });
  }

  nextTrace.status = status;
  nextTrace.summary = summary ?? nextTrace.summary;
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

function upsertRuntimeToolCall(
  trace: ConversationWorkTrace | null | undefined,
  patch: Partial<ConversationToolCall> & { id: string; toolName: string },
  options?: {
    segmentId?: string;
    segmentSummary?: string;
    segmentThinking?: string;
    segmentThinkingPresentation?: ConversationThinkingPresentation;
  },
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  const blockMeta = getRuntimeToolBlockMeta(patch.toolName, options?.segmentId);
  const blockId = blockMeta.id;
  let block = nextTrace.blocks.find((entry) => entry.id === blockId);
  if (!block) {
    block = createWorkBlock(blockId, blockMeta.title, blockMeta.stage, blockMeta.kind);
    block.status = 'running';
    nextTrace.blocks.push(block);
  }
  // Segment 工具块：增量写入轮次可见叙述（summary）与 thinking 全文（detail）。
  if (options?.segmentId && blockId === options.segmentId) {
    applySegmentNarrationFields(
      block,
      options.segmentSummary,
      options.segmentThinking,
      options.segmentThinkingPresentation,
    );
  }
  const toolIndex = block.toolCalls.findIndex((toolCall) => toolCall.id === patch.id);
  if (toolIndex >= 0) {
    block.toolCalls[toolIndex] = {
      ...block.toolCalls[toolIndex],
      ...patch,
    };
  } else {
    block.toolCalls.push({
      id: patch.id,
      toolName: patch.toolName,
      status: patch.status ?? 'pending',
      argsPreview: patch.argsPreview,
      resultPreview: patch.resultPreview,
      error: patch.error,
      startedAt: patch.startedAt ?? nowMs(),
      completedAt: patch.completedAt,
    });
  }
  if (block.toolCalls.length > 0 && block.toolCalls.every((toolCall) => toolCall.status === 'complete' || toolCall.status === 'error')) {
    block.status = block.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
    block.completedAt = nowMs();
  }
  nextTrace.status = 'running';
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

/** summary = 轮次可见叙述（result text）；detail = 轮次 thinking 全文。以 turn 结束回填为权威。 */
function applySegmentNarrationFields(
  block: ConversationWorkBlock,
  narration?: string,
  thinking?: string,
  thinkingPresentation?: ConversationThinkingPresentation,
): void {
  const nextNarration = narration?.trim();
  const nextThinking = thinking?.trim();
  if (nextNarration && (!block.summary || nextNarration.length >= block.summary.length)) {
    block.summary = nextNarration;
  }
  if (nextThinking && (!block.detail || nextThinking.length >= block.detail.length)) {
    block.detail = nextThinking;
    const presentation = thinkingPresentation
      ?? resolveThinkingPresentation(undefined, true);
    if (presentation !== 'none') {
      block.thinkingPresentation = presentation;
    }
  }
}

function upsertSegmentNarration(
  trace: ConversationWorkTrace | null | undefined,
  segmentId: string,
  narration?: string,
  thinking?: string,
  thinkingPresentation?: ConversationThinkingPresentation,
): ConversationWorkTrace {
  const nextTrace = cloneTrace(trace);
  let block = nextTrace.blocks.find((entry) => entry.id === segmentId);
  if (!block) {
    block = createWorkBlock(segmentId, '工具调用', 'tool', 'tool');
    block.status = 'running';
    nextTrace.blocks.push(block);
  }
  applySegmentNarrationFields(block, narration, thinking, thinkingPresentation);
  nextTrace.status = 'running';
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}

function getRuntimeToolBlockMeta(
  toolName: string,
  segmentId?: string,
): Pick<ConversationWorkBlock, 'id' | 'title' | 'stage' | 'kind'> {
  const normalizedToolName = normalizeToolName(toolName);
  if (normalizedToolName === 'ask_user') {
    return {
      id: 'runtime-user-input',
      title: '请求用户决策',
      stage: 'decision',
      kind: 'user_input',
    };
  }
  if (normalizedToolName === 'agent_handoff') {
    return {
      id: 'runtime-handoff',
      title: '准备交接',
      stage: 'handoff',
      kind: 'handoff',
    };
  }
  return {
    id: segmentId ?? 'runtime-tools',
    title: '工具调用',
    stage: 'tool',
    kind: 'tool',
  };
}

const isSegmentTool = (toolName: string): boolean => {
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

function getAgentDescription(agentId: AgentRole): string {
  const definition = resolveEnabledAgentDefinition(agentId);
  return definition?.description || (isTopLevelAgentId(agentId) ? AGENT_DESCRIPTIONS[agentId] : 'Workspace agent profile.');
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
    routeCapability: resolveAgentRouteCapability(provider, route.modelId),
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
  private readonly promptAssembler = new PromptAssembler();
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
    const branchState = storageAdapter.readConversationBranchState(sessionId);
    return {
      messages: resolveVisibleConversationMessages(allMessages, branchState),
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
    return this.startProfileTurn(context, input.mode, input.agentId ?? null, trimmed, input.attachments ?? []);
  }

  async rewriteFromMessage(input: ConversationRewriteContextInput): Promise<ConversationTurnResult> {
    const trimmed = input.message.trim();
    const context = await this.resolveContext(input);
    const sessionId = input.sessionId ?? context.session?.sessionId ?? null;
    if (!sessionId) {
      return this.startProfileTurn(context, input.mode, input.agentId ?? null, trimmed, input.attachments ?? []);
    }

    const history = storageAdapter.readConversationHistory(sessionId);
    const targetIndex = history.findIndex((message) => message.id === input.messageId);
    const targetMessage = targetIndex >= 0 ? history[targetIndex] : null;
    if (!targetMessage || targetMessage.role !== 'user') {
      throw new Error('Can only edit and resend an existing user message.');
    }

    const downstreamTurnIds = new Set(
      history.slice(targetIndex + 1).map((message) => message.turnId),
    );
    for (const activeTurn of Array.from(this.activeTurns.values())) {
      if (activeTurn.sessionId === sessionId && downstreamTurnIds.has(activeTurn.turnId)) {
        activeTurn.stop();
      }
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
      if (!targetMessage.forkId) {
        targetMessage.forkId = forkId;
        targetMessage.variantIndex = targetMessage.variantIndex ?? 0;
        storageAdapter.appendConversationMessage(sessionId, {
          ...targetMessage,
          updatedAt: nowMs(),
        });
      }
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
    fork.branches.push({
      branchId: newBranchId,
      parentBranchId: targetBranchId,
      variantIndex,
      anchorUserMessageId: '',
      rootTurnId: '',
    });
    fork.activeBranchId = newBranchId;
    branchState.activeLeafBranchId = newBranchId;
    storageAdapter.writeConversationBranchState(sessionId, branchState);

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
      },
      fork,
    );
  }

  async switchConversationBranch(input: ConversationSwitchBranchRequest): Promise<ConversationSwitchBranchResult> {
    const branchState = storageAdapter.readConversationBranchState(input.sessionId);
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

    const allMessages = storageAdapter.readConversationHistory(input.sessionId);
    const visibleMessages = resolveVisibleConversationMessages(allMessages, branchState);
    const tracePresentation = await traceService.buildConversationPresentation(input.sessionId, visibleMessages);
    workflowProjectionPublisher.publishTraceProjectionChanged(input.sessionId, tracePresentation);
    this.publishConversationTrace(input.sessionId, visibleMessages, input.sessionId);

    return {
      success: true,
      messages: visibleMessages,
      branchState,
      tracePresentation,
    };
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
    const activeOpenedCapture = openedCapture?.projectId === projectId && openedCapture.status === 'open'
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
    forkToUpdate?: import('@shared/types/conversationBranch').ConversationFork,
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
    let branchState = sessionIdForBranch
      ? storageAdapter.readConversationBranchState(sessionIdForBranch)
      : null;
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
    if (forkToUpdate && sessionIdForBranch && branchState) {
      const pendingBranch = forkToUpdate.branches.find((entry) => entry.branchId === branchId);
      if (pendingBranch) {
        pendingBranch.anchorUserMessageId = userMessage.id;
        pendingBranch.rootTurnId = turnId;
      }
      forkToUpdate.activeBranchId = branchId;
      branchState.activeLeafBranchId = branchId;
      storageAdapter.writeConversationBranchState(sessionIdForBranch, branchState);
    } else if (sessionIdForBranch && branchState && branchContext?.branchId) {
      branchState.activeLeafBranchId = branchContext.branchId;
      storageAdapter.writeConversationBranchState(sessionIdForBranch, branchState);
    }
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

    this.persistConversationSnapshot(workingSession?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);
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
    });

    return {
      session: workingSession,
      mode: 'talk',
      userMessage,
      assistantDraftMessage,
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
  }) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const traceSessionId = sessionId ?? this.ephemeralTraceSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();
    const conversationAgentId: AgentRole = input.requestedAgentId;
    const agentLabel = getAgentLabel(conversationAgentId);
    const showWorkTrace = true;

    const commitAssistantMessage = (type: ConversationStreamEvent['type'], patch: Partial<ConversationMessage>) => {
      if (abortController.signal.aborted && patch.status !== 'stopped') {
        return;
      }
      assistantMessage = {
        ...assistantMessage,
        ...patch,
        updatedAt: nowMs(),
      };
      this.persistConversationSnapshot(sessionId, assistantMessage);
      this.emitConversationEvent({
        type,
        sessionId: sessionId ?? '',
        turnId: assistantMessage.turnId,
        message: assistantMessage,
      } as ConversationStreamEvent);
      this.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
    };

    const commitStoppedMessage = () => {
      commitAssistantMessage('message_completed', {
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

    this.registerActiveTurn({
      turnId: assistantMessage.turnId,
      sessionId,
      startedAt: nowMs(),
      abortController,
      stop: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
          commitStoppedMessage();
        }
      },
    });

    const commitVisibleAssistantText = () => {
      commitAssistantMessage('message_patched', {
        status: 'streaming',
        content: visibleResponse,
      });
    };

    const withWorkTrace = (workTrace: ConversationWorkTrace): Partial<ConversationMessage> => (
      showWorkTrace ? { workTrace } : {}
    );

    let rawResponse = '';
    let visibleResponse = '';
    // 思维链按 assistant 轮次分段：每个含工具的轮次 = 一个小节（runtime-segment-<seq>），
    // currentSegmentText = 轮次可见叙述（summary），currentSegmentThinking = 轮次 thinking 全文（detail）；
    // 最终回答只取最后一轮文本，不再拼接中间叙述。
    let currentSegmentText = '';
    let currentSegmentThinking = '';
    let segmentSeq = 1;
    let segmentHasTools = false;
    let pendingNewSegment = false;
    const currentSegmentId = () => `runtime-segment-${segmentSeq}`;
    let errorViewModel: ConversationTurnResult['errorViewModel'] = null;
    let llmDiagnostic: ConversationMessageDiagnostic | null = null;
    const routePreflight = resolveAgentRoutePreflight(conversationAgentId);
    const segmentThinkingPresentation = (): ConversationThinkingPresentation => (
      routePreflight.ok
        ? resolveThinkingPresentation(routePreflight.routeCapability.reasoningDelivery, Boolean(currentSegmentThinking.trim()))
        : 'none'
    );
    const currentSegmentOptions = () => ({
      segmentId: currentSegmentId(),
      segmentSummary: currentSegmentText.trim() || undefined,
      segmentThinking: currentSegmentThinking.trim() || undefined,
      segmentThinkingPresentation: segmentThinkingPresentation(),
    });

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
          title: '模型路由诊断',
          stage: 'preflight',
          summary: llmDiagnostic.userMessage,
          detail: llmDiagnostic.technicalMessage,
          completedAt: nowMs(),
        })),
      });
    } else {
      try {
        const definition = resolveEnabledAgentDefinition(conversationAgentId);
        const promptDefinition = {
          agentId: conversationAgentId,
          agentLabel,
          agentDescription: getAgentDescription(conversationAgentId),
          baseInstructions: definition?.instructions,
          globalInstructions: settingsService.getAll().agents.globalInstructions,
        };
        const allowedToolNames = resolveAgentToolAllowlist(conversationAgentId, 'investigate')
          .map((toolName) => normalizeToolName(toolName));
        const projectRootPath = input.context.projectId
          ? storageAdapter.getProjectById(input.context.projectId)?.rootPath ?? null
          : null;
        const memoryIndex = await agentOrchestrator.getMemoryIndex();
        const promptContext = {
          workDir: projectRootPath ?? '',
          tools: allowedToolNames,
          memoryIndex: memoryIndex || undefined,
          model: {
            provider: routePreflight.routeCapability.providerId,
            name: routePreflight.routeCapability.modelId,
          },
          mode: this.modeForProfile(conversationAgentId),
          profile: promptDefinition,
          routeCapability: routePreflight.routeCapability,
          permissionSettings: settingsService.getAll().agentRuntime.permissions,
          allowedToolNames,
        };
        const systemPrompt = this.promptAssembler.assembleSystemPrompt(promptContext);
        const promptMetrics = this.promptAssembler.measureSections(promptContext);
        const responseText = await agentOrchestrator.sendProfileMessage(
          conversationAgentId,
          input.rawMessage,
          {
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            stage: 'investigate',
            patternId: 'free-agent',
            projectRootPath,
            projectId: input.context.projectId,
            systemPrompt,
            promptMetrics,
            maxTokens: 1200,
            temperature: 0.35,
            signal: abortController.signal,
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
                    title: '启动 Agent Loop',
                    stage: 'preflight',
                    status: 'running',
                    summary: `${agentLabel} 已进入模型与工具循环。`,
                    detail: details || undefined,
                    startedAt: nowMs(),
                  }),
                });
              }
              if (event.type === 'assistant.delta') {
                const chunk = typeof event.payload.text === 'string' ? event.payload.text : '';
                if (chunk) {
                  // 上一轮已含工具且现在又有新文本 → 进入新一轮：另起小节并清空可见缓冲，
                  // 使最终气泡只跟随最后一轮文本。
                  if (pendingNewSegment) {
                    segmentSeq += 1;
                    currentSegmentText = '';
                    currentSegmentThinking = '';
                    segmentHasTools = false;
                    pendingNewSegment = false;
                    visibleResponse = '';
                  }
                  rawResponse += chunk;
                  currentSegmentText += chunk;
                  visibleResponse = currentSegmentText;
                  commitVisibleAssistantText();
                }
              }
              if (event.type === 'assistant.thinking_delta') {
                const chunk = typeof event.payload.text === 'string' ? event.payload.text : '';
                if (chunk) {
                  currentSegmentThinking += chunk;
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertSegmentNarration(
                      assistantMessage.workTrace,
                      currentSegmentId(),
                      undefined,
                      currentSegmentThinking,
                      segmentThinkingPresentation(),
                    ),
                  });
                }
              }
              if (event.type === 'assistant.thinking_end') {
                const text = typeof event.payload.text === 'string' ? event.payload.text.trim() : '';
                if (text && text.length >= currentSegmentThinking.length) {
                  currentSegmentThinking = text;
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertSegmentNarration(
                      assistantMessage.workTrace,
                      currentSegmentId(),
                      undefined,
                      currentSegmentThinking,
                      segmentThinkingPresentation(),
                    ),
                  });
                }
              }
              if (event.type === 'diagnostic') {
                const payload = event.payload as { code?: string; message?: string; severity?: string };
                const summary = typeof payload.message === 'string' && payload.message
                  ? payload.message
                  : 'Received runtime diagnostic.';
                if (payload.code === 'MODEL_THINKING_STARTED' || payload.code === 'MODEL_THINKING_COMPLETED') {
                  return;
                }
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `runtime-diagnostic-${payload.code ?? 'runtime'}`, {
                    kind: 'diagnostic',
                    status: payload.severity === 'error' ? 'error' : 'complete',
                    title: 'Runtime diagnostic',
                    summary,
                    completedAt: nowMs(),
                  }),
                });
              }
              if (event.type === 'tool.requested') {
                const payload = event.payload as {
                  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
                };
                if (payload.toolCall?.id && payload.toolCall.name) {
                  const segmented = isSegmentTool(String(payload.toolCall.name));
                  if (segmented) segmentHasTools = true;
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                      id: String(payload.toolCall.id),
                      toolName: String(payload.toolCall.name),
                      status: 'pending',
                      argsPreview: JSON.stringify(payload.toolCall.arguments ?? {}).slice(0, 600),
                      startedAt: nowMs(),
                    }, segmented ? currentSegmentOptions() : undefined),
                  });
                }
              }
              if (event.type === 'tool.started') {
                const segmented = isSegmentTool(String(event.payload.toolName));
                if (segmented) segmentHasTools = true;
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: 'running',
                    argsPreview: JSON.stringify(event.payload.args ?? {}).slice(0, 600),
                    startedAt: nowMs(),
                  }, segmented ? currentSegmentOptions() : undefined),
                });
              }
              if (event.type === 'tool.denied') {
                const reason = typeof event.payload.reason === 'string'
                  ? event.payload.reason
                  : 'Profile policy denied this tool call.';
                const segmentedDenied = isSegmentTool(String(event.payload.toolName));
                if (segmentedDenied) segmentHasTools = true;
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: 'error',
                    resultPreview: JSON.stringify(event.payload.result ?? { reason }).slice(0, 800),
                    error: reason,
                    completedAt: nowMs(),
                  }, segmentedDenied ? currentSegmentOptions() : undefined),
                });
              }
              if (event.type === 'approval.requested') {
                const payload = event.payload as {
                  approvalId?: string;
                  reason?: string;
                  toolCallId?: string;
                  toolName?: string;
                  kind?: string;
                  question?: string;
                  options?: string[];
                  risk?: unknown;
                  reviewer?: unknown;
                };
                const approvalId = payload.approvalId ?? `approval-${payload.toolCallId ?? 'runtime'}`;
                const toolCallId = String(payload.toolCallId ?? approvalId);
                const toolName = String(payload.toolName ?? 'approval');
                if (payload.kind === 'ask_user' || normalizeToolName(toolName) === 'ask_user') {
                  const question = typeof payload.question === 'string' && payload.question
                    ? payload.question
                    : typeof payload.reason === 'string' && payload.reason
                      ? payload.reason
                      : 'The agent needs user input before continuing.';
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                      id: toolCallId,
                      toolName: 'ask_user',
                      status: 'running',
                      argsPreview: JSON.stringify({
                        question,
                        choices: Array.isArray(payload.options) ? payload.options : [],
                      }).slice(0, 600),
                      startedAt: nowMs(),
                    }),
                  });
                  return;
                }
                const reason = typeof payload.reason === 'string' && payload.reason
                  ? payload.reason
                  : 'This action requires user approval before it can run.';
                const traceWithTool = upsertRuntimeToolCall(assistantMessage.workTrace, {
                  id: toolCallId,
                  toolName,
                  status: 'running',
                  resultPreview: reason,
                }, currentSegmentOptions());
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(traceWithTool, `runtime-approval-${approvalId}`, {
                    kind: 'approval',
                    title: '请求批准',
                    stage: 'decision',
                    status: 'running',
                    summary: reason,
                    detail: JSON.stringify({
                      approvalId,
                      toolCallId,
                      toolName,
                      risk: payload.risk,
                      reviewer: payload.reviewer,
                    }, null, 2),
                  }),
                });
              }
              if (event.type === 'approval.answered') {
                const payload = event.payload as {
                  approvalId?: string;
                  status?: string;
                  answer?: unknown;
                  kind?: string;
                  toolCallId?: string;
                  toolName?: string;
                  question?: string;
                };
                const approvalId = payload.approvalId ?? 'runtime';
                if (payload.kind === 'ask_user' || normalizeToolName(String(payload.toolName ?? '')) === 'ask_user') {
                  const failed = payload.status === 'rejected' || payload.status === 'cancelled';
                  const answerText = payload.answer === undefined || payload.answer === null
                    ? ''
                    : typeof payload.answer === 'string'
                      ? payload.answer.trim()
                      : String(payload.answer).trim();
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                      id: String(payload.toolCallId ?? approvalId),
                      toolName: 'ask_user',
                      status: failed ? 'error' : 'running',
                      resultPreview: failed
                        ? String(payload.answer ?? 'User input request was cancelled.')
                        : answerText || 'User answered.',
                      error: failed ? String(payload.answer ?? 'User input request was cancelled.') : undefined,
                      completedAt: failed ? nowMs() : undefined,
                    }),
                  });
                  return;
                }
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `runtime-approval-${approvalId}`, {
                    kind: 'approval',
                    title: '审批结果',
                    stage: 'decision',
                    status: payload.status === 'rejected' || payload.status === 'cancelled' ? 'error' : 'complete',
                    summary: `审批状态：${payload.status ?? 'answered'}`,
                    detail: payload.answer === undefined ? undefined : JSON.stringify(payload.answer).slice(0, 800),
                    completedAt: nowMs(),
                  }),
                });
              }
              if (event.type === 'tool.completed') {
                const result = event.payload.result as { ok?: boolean; error?: { message?: string } } | undefined;
                const isAskUserTool = normalizeToolName(String(event.payload.toolName)) === 'ask_user';
                const toolCallPatch: Partial<ConversationToolCall> & { id: string; toolName: string } = {
                  id: String(event.payload.toolCallId),
                  toolName: String(event.payload.toolName),
                  status: result?.ok ? 'complete' : 'error',
                  error: result?.ok ? undefined : result?.error?.message,
                  completedAt: nowMs(),
                };
                if (!(isAskUserTool && result?.ok)) {
                  toolCallPatch.resultPreview = JSON.stringify(event.payload.result ?? {}).slice(0, 800);
                }
                const segmentedCompleted = isSegmentTool(String(event.payload.toolName));
                commitAssistantMessage('message_patched', {
                  workTrace: upsertRuntimeToolCall(
                    assistantMessage.workTrace,
                    toolCallPatch,
                    segmentedCompleted ? currentSegmentOptions() : undefined,
                  ),
                });
              }
              if (event.type === 'task.created' || event.type === 'task.updated') {
                const payload = event.payload as {
                  taskId?: string;
                  title?: string;
                  status?: string;
                };
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, 'runtime-tasks', {
                    kind: 'subagent',
                    title: '任务状态',
                    stage: 'tool',
                    status: payload.status === 'failed' ? 'error' : 'complete',
                    summary: `${payload.title ?? payload.taskId ?? 'Task'}${payload.status ? `：${payload.status}` : ''}`,
                    completedAt: nowMs(),
                  }),
                });
              }
              if (event.type === 'subagent.started') {
                const payload = event.payload as { subagentId: string; profile: string; parentToolCallId: string; text?: string };
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
                    kind: 'subagent',
                    title: `子 Agent：${payload.profile}`,
                    stage: 'tool',
                    status: 'running',
                    summary: payload.text?.slice(0, 200) ?? '',
                  }),
                });
              }
              if (event.type === 'subagent.delta') {
                const payload = event.payload as { subagentId: string; text?: string };
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
                    kind: 'subagent',
                    title: `子 Agent`,
                    stage: 'tool',
                    status: 'running',
                    summary: payload.text ? payload.text.slice(-200) : undefined,
                  }),
                });
              }
              if (event.type === 'subagent.completed') {
                const payload = event.payload as { subagentId: string; profile: string; text?: string; status?: string };
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
                    kind: 'subagent',
                    title: `子 Agent：${payload.profile}`,
                    stage: 'tool',
                    status: payload.status === 'failed' ? 'error' : 'complete',
                    summary: payload.text?.slice(0, 500) ?? '',
                    detail: payload.text,
                    completedAt: nowMs(),
                  }),
                });
              }
              if (event.type === 'assistant.completed') {
                const payload = event.payload as { text?: string; thinkingText?: string };
                const narration = typeof payload.text === 'string' ? payload.text.trim() : '';
                const thinking = (typeof payload.thinkingText === 'string' ? payload.thinkingText.trim() : '')
                  || currentSegmentThinking.trim();
                if (thinking) {
                  currentSegmentThinking = thinking;
                }
                if (narration || thinking) {
                  commitAssistantMessage('message_patched', {
                    workTrace: upsertSegmentNarration(
                      assistantMessage.workTrace,
                      currentSegmentId(),
                      narration || undefined,
                      thinking || undefined,
                      thinking ? segmentThinkingPresentation() : undefined,
                    ),
                  });
                }
                // 本轮含工具 → 它是中间叙述轮：标记下一轮文本应另起小节（工具的
                // started/completed 在本事件之后到达，仍归属当前 segment，故延后切段）。
                if (segmentHasTools) {
                  pendingNewSegment = true;
                }
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, 'assistant-output', {
                    kind: 'output',
                    title: '生成最终回答',
                    stage: 'respond',
                    status: 'complete',
                    summary: '最终回答已生成。',
                    completedAt: nowMs(),
                  }),
                });
              }
              if (event.type === 'run.completed') {
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, 'runtime-run', {
                    kind: 'reasoning',
                    title: 'Agent Loop 完成',
                    stage: 'respond',
                    status: 'complete',
                    summary: '模型与工具循环已完成。',
                    completedAt: nowMs(),
                  }),
                });
              }
              if (event.type === 'run.failed' || event.type === 'run.cancelled') {
                const failed = event.type === 'run.failed';
                commitAssistantMessage('message_patched', {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `runtime-${event.type}`, {
                    kind: 'diagnostic',
                    title: failed ? 'Agent Loop 失败' : 'Agent Loop 已取消',
                    stage: 'respond',
                    status: failed ? 'error' : 'complete',
                    summary: summarizeRuntimePayload(event.payload) || (failed ? 'Agent Loop 失败。' : 'Agent Loop 已取消。'),
                    completedAt: nowMs(),
                  }),
                });
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
        currentSegmentText = llmDiagnostic.userMessage;
        recordLlmDiagnostic(input.context, llmDiagnostic);
        commitVisibleAssistantText();
      }
    }

    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }

    // 最终回答只取最后一轮文本（currentSegmentText）；中间叙述已分流到各思维链小节。
    const assistantContent = (currentSegmentText.trim() || rawResponse || visibleResponse).trim();
    visibleResponse = assistantContent;
    const isRouteMissingDiagnostic = llmDiagnostic?.code === 'CONVERSATION_LLM_ROUTE_MISSING';
    const finalStatus: ConversationMessage['status'] = errorViewModel && !isRouteMissingDiagnostic ? 'error' : 'complete';
    const traceStatus: ConversationWorkTrace['status'] = errorViewModel && !isRouteMissingDiagnostic ? 'error' : 'complete';

    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }

    const outputSummary = llmDiagnostic
      ? llmDiagnostic.code === 'CONVERSATION_LLM_REQUEST_FAILED'
        ? '模型请求失败，已记录诊断。'
        : '模型链路不可用，已给出配置诊断。'
      : '最终回答已生成。';

    commitAssistantMessage(finalStatus === 'error' ? 'message_errored' : 'message_completed', {
      status: finalStatus,
      content: assistantContent,
      diagnostic: llmDiagnostic,
      ...withWorkTrace(finalizeTrace(
        upsertWorkBlock(assistantMessage.workTrace, 'assistant-output', {
          kind: 'output',
          status: finalStatus === 'error' ? 'error' : 'complete',
          summary: outputSummary,
          detail: llmDiagnostic?.technicalMessage,
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

    this.clearActiveTurn(assistantMessage.turnId, abortController);
  }

  private persistConversationSnapshot(sessionId: string | null | undefined, message: ConversationMessage) {
    if (sessionId) {
      storageAdapter.appendConversationMessage(sessionId, message);
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
  private modeForProfile(agentId: AgentRole): 'ask' | 'debugger' | 'edit' | 'analyzer' | 'optimizer' {
    if (agentId === 'plan' || agentId === 'ask') {
      return 'ask';
    }
    if (agentId === 'debugger') {
      return 'debugger';
    }
    if (agentId === 'analyzer') {
      return 'analyzer';
    }
    if (agentId === 'optimizer') {
      return 'optimizer';
    }
    if (agentId === 'edit') {
      return 'edit';
    }
    return 'edit';
  }

}

export const conversationService = new ConversationService();
