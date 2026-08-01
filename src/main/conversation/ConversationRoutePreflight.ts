import type {
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import type { AgentRole } from '@shared/types/agent';
import { isTopLevelAgentId } from '@shared/types/agent';
import type { AgentRouteCapability, AgentEvent } from '@shared/types/agentRuntime';
import type { PromptPlan } from '@shared/types/rdxRuntime';
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
import { generateEventId, nowMs } from '@shared/utils/id';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { normalizeToolName } from '../workflow/debugger/DebuggerRuntimePolicy';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
import { settingsService } from '../settings/SettingsService';
import { resolveEffectiveModelSelection } from '../settings/EffectiveModelResolver';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { AgentLoopTerminationError } from '../agent-runtime/agent/LoopProgressGuard';

export interface ConversationBranchTurnContext {
  branchId: string;
  forkId: string;
  variantIndex: number;
  parentBranchId: string;
  branchState: ConversationBranchState;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function mergeThinkingPayload(
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
    }),
    text: `${current?.text ?? ''}${delta}`,
  });
}

export function selectCompletedThinking(thinking: ThinkingArtifact[] | undefined): ThinkingArtifact | undefined {
  if (!Array.isArray(thinking) || thinking.length === 0) return undefined;
  for (let index = thinking.length - 1; index >= 0; index -= 1) {
    const candidate = thinking[index];
    if (candidate.continuation || candidate.text) return cloneThinkingArtifact(candidate);
  }
  return undefined;
}

export function cloneThinkingArtifact(thinking: ThinkingArtifact): ThinkingArtifact {
  return {
    ...thinking,
    continuation: thinking.continuation ? { ...thinking.continuation } : undefined,
  };
}

export interface ResolvedConversationContext {
  projectId: string | null;
  session: SessionRecord | null;
  currentRun: RunSummary | null;
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  openedCapturePath: string | null;
  replayDevice: ReplayDeviceEntry | null;
}

export interface PreparedConversationPrompt {
  projectRootPath: string | null;
  allowedToolNames: string[];
  promptPlan: PromptPlan;
  visibleTurnIds: string[];
}

export interface ActiveConversationTurn {
  requestId: string;
  turnId: string;
  sessionId: string | null;
  startedAt: number;
  abortController: AbortController;
  stop: () => void;
  /** Resolves only after completeProfileTurn has fully exited its terminal cleanup. */
  stopped: Promise<void>;
}

export function resolveConversationAgentId(requestedMode: AppMode, requestedAgentId?: string | null): AgentRole {
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

export function isActiveRun(run: RunSummary | null | undefined): run is RunSummary {
  return Boolean(run && ACTIVE_RUN_STATUSES.includes(run.status));
}

export const isLoopTool = (toolName: string): boolean => {
  const normalized = normalizeToolName(toolName);
  return normalized !== 'ask_user' && normalized !== 'agent_handoff';
};

export function summarizeRuntimePayload(payload: AgentEvent['payload']): string {
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

export function createConversationMessage(
  role: ConversationMessage['role'],
  content: string,
  options: {
    requestId?: string;
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
    preparedContext?: ConversationMessage['preparedContext'];
  },
): ConversationMessage {
  const createdAt = nowMs();
  return {
    id: generateEventId(role === 'user' ? 'msgu' : role === 'assistant' ? 'msga' : 'msgs'),
    requestId: options.requestId,
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
    preparedContext: options.preparedContext,
    createdAt,
  };
}

export function resolveEnabledAgentDefinition(agentId: string) {
  return settingsService.getAll().agents.definitions.find((entry) => entry.id === agentId && entry.enabled) ?? null;
}

export function getAgentLabel(agentId: AgentRole): string {
  const definition = resolveEnabledAgentDefinition(agentId);
  return definition?.name || (isTopLevelAgentId(agentId) ? AGENT_DISPLAY_NAMES[agentId] : agentId);
}

export interface AgentRoutePreflightOk {
  ok: true;
  agentId: AgentRole;
  routeAgentId: AgentRole;
  providerId: string;
  modelId: string;
  routeCapability: AgentRouteCapability;
  aliasRemap?: { from: string; to: string };
}

export interface AgentRoutePreflightBlocked {
  ok: false;
  diagnostic: ConversationMessageDiagnostic;
}

export type AgentRoutePreflight = AgentRoutePreflightOk | AgentRoutePreflightBlocked;

export function redactTechnicalMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(Bearer\s+)[^\s"'`,;)}]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)["'\s:=]+)[^"',;\s)}]+/gi, '$1[redacted]')
    .slice(0, 1200);
}

export function createConversationDiagnostic(input: {
  agentId: AgentRole;
  code: ConversationMessageDiagnostic['code'];
  severity: ConversationMessageDiagnostic['severity'];
  userMessage: string;
  providerId?: string;
  modelId?: string;
  adapterId?: string;
  technicalMessage?: string;
  recommendations?: ConversationMessageDiagnostic['recommendations'];
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
    recommendations: input.recommendations,
  };
}

export function resolveAgentRoutePreflight(agentId: AgentRole, fallbackAgentId?: AgentRole): AgentRoutePreflight {
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

  const selection = resolveEffectiveModelSelection(route.providerId, route.modelId, settings);
  const effectiveModel = selection.model;
  if (!effectiveModel) {
    const recommendationText = selection.recommendations.map((entry) => entry.modelId).join(', ');
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_ROUTE_MISSING',
        severity: 'warning',
        userMessage: `当前 ${label} 路由的模型不可用：${route.providerId}/${route.modelId}。请在 Settings 中刷新模型目录或显式选择同一 provider 的其它模型。`,
        providerId: route.providerId,
        modelId: route.modelId,
        technicalMessage: `MODEL_UNAVAILABLE: ${route.providerId}/${route.modelId} is absent, disabled, or unavailable in the effective catalog.${recommendationText ? ` Recommendations: ${recommendationText}.` : ''}`,
        recommendations: selection.recommendations,
      }),
    };
  }
  const effectiveModelId = effectiveModel.modelId;

  return {
    ok: true,
    agentId,
    routeAgentId,
    providerId: route.providerId,
    modelId: effectiveModelId,
    routeCapability: resolveAgentRouteCapability(
      provider,
      effectiveModelId,
      effectiveModel,
    ),
    ...(selection.remappedFrom
      ? { aliasRemap: { from: selection.remappedFrom, to: effectiveModelId } }
      : {}),
  };
}

export function recordLlmDiagnostic(
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

export function createTurnFailedDiagnostic(
  route: Pick<AgentRoutePreflightOk, 'agentId' | 'providerId' | 'modelId'>,
  error: unknown,
): ConversationMessageDiagnostic {
  const label = getAgentLabel(route.agentId);
  if (error instanceof AgentLoopTerminationError) {
    const isNoProgress = error.code === 'AGENT_NO_PROGRESS';
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: isNoProgress
        ? 'CONVERSATION_AGENT_LOOP_STALLED'
        : 'CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED',
      severity: 'error',
      userMessage: isNoProgress
        ? `${label} 连续三轮执行了相同的工具、参数并得到相同结果。本次 Agent Loop 已停止，以免继续无效消耗。请调整任务或改用具备所需工具的 Agent 后重试。`
        : `${label} 在 ${error.maxTurns ?? error.turn} 轮上限内仍需要继续调用工具。本次 Agent Loop 已停止；请缩小任务范围或调整 Agent 的轮次策略后重试。`,
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(error),
    });
  }
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
