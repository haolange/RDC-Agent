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
import type { PromptPlan, EffectiveAgentProfile } from '@shared/types/rdxRuntime';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import type {
  OpenedCaptureState,
  ProjectInputRecord,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { generateEventId, nowMs } from '@shared/utils/id';
import {
  classifyAgentToolEligibility,
  describeAgentToolIneligibility,
  isAgentToolExecutableModel,
} from '@shared/utils/agentToolCapability';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { normalizeToolName } from '../workflow/debugger/DebuggerRuntimePolicy';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
import { settingsService } from '../settings/SettingsService';
import { agentManifestService } from '../settings/AgentManifestService';
import { resolveEffectiveModelSelection } from '../settings/EffectiveModelResolver';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import {
  AgentRecoveryAbortError,
  findProviderHttpError,
  isProviderStreamProtocolError,
  redactRecoverySnippet,
  type ErrorCategory,
} from '../agent-runtime/agent/ErrorRecovery';
import {
  isProviderEmptyStreamError,
  isProviderWireFailureError,
  ProviderTimeoutError,
} from '../agent-runtime/providers/internal/http';
import { AgentLoopTerminationError } from '../agent-runtime/agent/LoopProgressGuard';
import { isMissionCompletionError } from '../investigation/missionCompletionContract';

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
  /** Exact User/Project-resolved profile frozen for this turn. */
  effectiveProfile: EffectiveAgentProfile;
  /** Enabled profile ids from the same resolution snapshot, used by handoff validation. */
  effectiveProfileIds: string[];
  allowedToolNames: string[];
  promptPlan: PromptPlan;
  visibleTurnIds: string[];
  overlayDiagnostics?: string[];
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

function throwUnavailableConversationAgent(agentId: string, projectRootPath?: string | null): never {
  const lookup = findEffectiveAgentProfile(agentId, projectRootPath);
  const code = lookup.found ? 'CONVERSATION_PROFILE_DISABLED' : 'CONVERSATION_PROFILE_UNKNOWN';
  const reason = lookup.found ? 'disabled' : 'not in the project-aware snapshot';
  throw new Error(`${code}: requested profile \`${agentId}\` is ${reason}.`);
}

export function resolveConversationAgentId(
  requestedAgentId?: string | null,
  requestedProfileId?: string | null,
  projectRootPath?: string | null,
): AgentRole {
  const candidate = requestedAgentId?.trim() || requestedProfileId?.trim();
  if (candidate) {
    if (findEffectiveAgentProfile(candidate, projectRootPath).enabled) {
      return candidate as AgentRole;
    }
    throwUnavailableConversationAgent(candidate, projectRootPath);
  }
  if (findEffectiveAgentProfile(DEFAULT_AGENT_ID, projectRootPath).enabled) {
    return DEFAULT_AGENT_ID;
  }
  throw new Error(
    `CONVERSATION_AGENT_UNAVAILABLE: default profile \`${DEFAULT_AGENT_ID}\` is not enabled.`,
  );
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
    requestFingerprint?: string;
    turnId: string;
    sessionId?: string | null;
    projectId?: string | null;
    runId?: string | null;
    profileId?: string;
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
    requestFingerprint: options.requestFingerprint,
    turnId: options.turnId,
    sessionId: options.sessionId ?? null,
    projectId: options.projectId ?? null,
    runId: options.runId ?? null,
    profileId: options.profileId ?? options.agentId,
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

function isOverlayDiagnosticForProfile(entry: string, agentId: string): boolean {
  return entry.includes(`${agentId}.agent.md`)
    || ((entry.includes('PROJECT_AGENT_MANIFEST_INVALID') || entry.includes('USER_AGENT_MANIFEST_INVALID'))
      && entry.includes(agentId));
}

export function findEffectiveAgentProfile(agentId: string, projectRootPath?: string | null) {
  const settings = settingsService.getAll();
  if (!settings.paths) {
    return { found: false as const, enabled: false as const, profile: null };
  }
  const snapshot = agentManifestService.resolveEffectiveSnapshot(
    settings.paths,
    projectRootPath ?? undefined,
  );
  const profile = snapshot.profiles.find((entry) => entry.id === agentId) ?? null;
  return {
    found: Boolean(profile),
    enabled: Boolean(profile?.enabled),
    profile,
  };
}

export function resolveEffectiveAgentSnapshot(agentId: string, projectRootPath?: string | null) {
  const settings = settingsService.getAll();
  if (!settings.paths) {
    return { profile: null, overlayDiagnostics: [] as string[], diagnostics: [] as string[] };
  }
  const snapshot = agentManifestService.resolveEffectiveSnapshot(
    settings.paths,
    projectRootPath ?? undefined,
  );
  const profile = snapshot.profiles.find((entry) => entry.id === agentId && entry.enabled) ?? null;
  return {
    profile,
    overlayDiagnostics: snapshot.diagnostics.filter((entry) => isOverlayDiagnosticForProfile(entry, agentId)),
    diagnostics: snapshot.diagnostics,
  };
}

export function resolveEnabledAgentDefinition(agentId: string, projectRootPath?: string | null) {
  return resolveEffectiveAgentSnapshot(agentId, projectRootPath).profile;
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
  overlayDiagnostics?: string[];
  aliasRemap?: { from: string; to: string };
}

export interface AgentRoutePreflightBlocked {
  ok: false;
  diagnostic: ConversationMessageDiagnostic;
  overlayDiagnostics?: string[];
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

export function resolveAgentRoutePreflight(
  agentId: AgentRole,
  fallbackAgentId?: AgentRole,
  modelOverride?: { providerId: string; modelId: string } | null,
  projectRootPath?: string | null,
): AgentRoutePreflight {
  const settings = settingsService.getAll();
  const snapshot = resolveEffectiveAgentSnapshot(agentId, projectRootPath);
  const effectiveProfile = snapshot.profile;
  const compiled = effectiveProfile?.compiledRoute;
  const fallbackProfile = fallbackAgentId ? resolveEnabledAgentDefinition(fallbackAgentId, projectRootPath) : null;
  const route = compiled?.providerId && compiled.modelId
    ? compiled
    : fallbackProfile?.compiledRoute;
  const routeAgentId = (route?.agentId ?? agentId) as AgentRole;
  const label = getAgentLabel(agentId);
  const providerId = modelOverride?.providerId || route?.providerId;
  const modelId = modelOverride?.modelId || route?.modelId;
  const withOverlay = <T extends AgentRoutePreflight>(result: T): T => (
    snapshot.overlayDiagnostics.length > 0
      ? { ...result, overlayDiagnostics: snapshot.overlayDiagnostics }
      : result
  );
  if (!providerId || !modelId) {
    return withOverlay({
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_ROUTE_MISSING',
        severity: 'warning',
        userMessage: `当前 ${label} 链路还没绑定可用模型。请在 Settings 中为 \`${agentId}\` 选择 provider 和 model route。`,
      }),
    });
  }

  const provider = settings.llm.providers.find((entry) => entry.id === providerId);
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return withOverlay({
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE',
        severity: 'error',
        userMessage: `当前 ${label} 链路的 provider 不可用：${providerId}。请检查该服务商的连接状态、账号或密钥后重试。`,
        providerId,
        modelId,
        technicalMessage: provider?.lastError ?? provider?.unavailableReason,
      }),
    });
  }

  if (provider.status !== 'verified') {
    return withOverlay({
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE',
        severity: 'error',
        userMessage: `Current ${label} route provider is not verified: ${providerId}. Verify the provider in Settings before running agent tools.`,
        providerId,
        modelId,
        technicalMessage: provider.lastError ?? provider.unavailableReason,
      }),
    });
  }

  const selection = resolveEffectiveModelSelection(providerId, modelId, settings);
  const effectiveModel = selection.model;
  if (!effectiveModel) {
    const recommendationText = selection.recommendations.map((entry) => entry.modelId).join(', ');
    return withOverlay({
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_ROUTE_MISSING',
        severity: 'warning',
        userMessage: `当前 ${label} 路由的模型不可用：${providerId}/${modelId}。请在 Settings 中刷新模型目录或显式选择同一 provider 的其它模型。`,
        providerId,
        modelId,
        technicalMessage: `MODEL_UNAVAILABLE: ${providerId}/${modelId} is absent, disabled, or unavailable in the effective catalog.${recommendationText ? ` Recommendations: ${recommendationText}.` : ''}`,
        recommendations: selection.recommendations,
      }),
    });
  }
  const effectiveModelId = effectiveModel.modelId;
  if (!isAgentToolExecutableModel(effectiveModel)) {
    const eligibility = classifyAgentToolEligibility(effectiveModel);
    const detail = eligibility === 'executable'
      ? {
          technicalCode: 'MODEL_UNAVAILABLE',
          userMessage: `当前 ${label} 路由的模型不可执行：${providerId}/${effectiveModelId}。`,
          technicalMessage: `MODEL_UNAVAILABLE: ${providerId}/${effectiveModelId} is not Agent-executable.`,
        }
      : describeAgentToolIneligibility(eligibility, providerId, effectiveModelId);
    const recommendationText = selection.recommendations.map((entry) => entry.modelId).join(', ');
    return withOverlay({
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_TOOLS_UNAVAILABLE',
        severity: 'warning',
        userMessage: recommendationText
          ? `${detail.userMessage} 可改选：${recommendationText}。`
          : detail.userMessage,
        providerId,
        modelId: effectiveModelId,
        technicalMessage: `${detail.technicalMessage}${recommendationText ? ` Recommendations: ${recommendationText}.` : ''}`,
        recommendations: selection.recommendations,
      }),
    });
  }

  return withOverlay({
    ok: true,
    agentId,
    routeAgentId,
    providerId,
    modelId: effectiveModelId,
    routeCapability: resolveAgentRouteCapability(
      provider,
      effectiveModelId,
      effectiveModel,
    ),
    ...(selection.remappedFrom
      ? { aliasRemap: { from: selection.remappedFrom, to: effectiveModelId } }
      : {}),
  });
}

export function recordOverlayProfileDiagnostics(
  context: ResolvedConversationContext,
  agentId: AgentRole,
  overlayDiagnostics: string[] | undefined,
  continuedWithLowerScope: boolean,
): void {
  if (!overlayDiagnostics?.length) return;
  for (const entry of overlayDiagnostics) {
    recordLlmDiagnostic(context, createConversationDiagnostic({
      agentId,
      code: 'CONVERSATION_PROFILE_OVERLAY_INVALID',
      severity: 'warning',
      userMessage: continuedWithLowerScope
        ? `当前项目的 profile 覆盖无效，已继续使用较低 scope 的有效 profile。${entry}`
        : `当前项目的 profile 覆盖无效，且当前没有可用的较低 scope 路由。${entry}`,
      technicalMessage: entry,
    }));
  }
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
  if (isMissionCompletionError(error)) {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'MISSION_COMPLETION_DENIED',
      severity: 'error',
      userMessage: `${label} 不能把本次 Mission 标为已完成：缺少可解引用的 Checkpoint、ready 报告，或 final_answer 未引用该报告。Partial / Inconclusive / Blocked 不得伪装完成。`,
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(error),
    });
  }
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
  if (isStreamProtocolTurnFailure(error)) {
    const streamCode = error instanceof AgentRecoveryAbortError
      ? error.streamCode
      : typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
    const streamLabel = streamCode ? `（${streamCode}）` : '';
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: 'CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION',
      severity: 'error',
      userMessage: `${label} 当前使用 ${route.providerId}/${route.modelId} 时，本地流式协议完整性校验失败${streamLabel}。这是客户端对流式输出分段的完整性故障，与账号、额度或网络无关。请将技术详情提供给开发者。`,
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage: redactTechnicalMessage(error),
    });
  }
  const technicalMessage = redactTechnicalMessage(error);
  const matchedCode = technicalMessage.match(/^([A-Z][A-Z0-9_]+):/u)?.[1];
  const attachmentCode = matchedCode === 'ATTACHMENT_LIMIT_EXCEEDED'
    || matchedCode === 'ATTACHMENT_MEDIA_UNSUPPORTED'
    || matchedCode === 'ATTACHMENT_NOT_FOUND'
    || matchedCode === 'ATTACHMENT_INVALID'
    || matchedCode === 'VISION_INPUT_UNSUPPORTED'
    ? matchedCode
    : null;
  if (attachmentCode) {
    return createConversationDiagnostic({
      agentId: route.agentId,
      code: attachmentCode,
      severity: 'error',
      userMessage: attachmentCode === 'VISION_INPUT_UNSUPPORTED'
        ? `${label} 当前模型不接受图片附件。请更换支持视觉输入的模型后重试。`
        : `附件未能用于本次请求（${attachmentCode}）。请移除无效附件后重试。`,
      providerId: route.providerId,
      modelId: route.modelId,
      technicalMessage,
    });
  }
  const failure = classifyLlmRequestFailure(error);
  return createConversationDiagnostic({
    agentId: route.agentId,
    code: 'CONVERSATION_LLM_REQUEST_FAILED',
    severity: 'error',
    userMessage: llmRequestFailureUserMessage(label, route.providerId, route.modelId, failure),
    providerId: route.providerId,
    modelId: route.modelId,
    technicalMessage: formatLlmFailureTechnicalMessage(failure),
  });
}

function isStreamProtocolTurnFailure(error: unknown): boolean {
  if (isProviderStreamProtocolError(error)) {
    return true;
  }
  return error instanceof AgentRecoveryAbortError && error.category === 'stream_protocol';
}

type LlmFailureClass = 'auth' | 'quota' | 'overloaded' | 'server' | 'empty_stream' | 'network' | 'generic';

interface LlmRequestFailure {
  kind: LlmFailureClass;
  status?: number;
  attempts: number;
  maxAttempts: number;
  snippet: string;
}

function classifyLlmRequestFailure(error: unknown): LlmRequestFailure {
  const abort = error instanceof AgentRecoveryAbortError ? error : undefined;
  const http = findProviderHttpError(error);
  const status = abort?.lastStatus ?? http?.status ?? extractStatusFromMessage(error);
  const attempts = abort?.attempts ?? 1;
  const maxAttempts = abort?.maxAttempts ?? 1;
  const snippetSource = abort?.bodySnippet
    ?? http?.bodyText
    ?? causeSnippet(error);
  const snippet = redactTechnicalMessage(snippetSource);
  const category = abort?.category ?? inferLlmFailureCategory(error, status);
  const kind = llmFailureKind(category, status, error);
  return { kind, status, attempts, maxAttempts, snippet };
}

function causeSnippet(error: unknown): string {
  if (isProviderEmptyStreamError(error)) {
    return error.message;
  }
  if (isProviderWireFailureError(error)) {
    return error.bodyText ?? error.message;
  }
  if (error instanceof Error && error.cause instanceof Error) {
    if (isProviderEmptyStreamError(error.cause)) {
      return error.cause.message;
    }
    if (isProviderWireFailureError(error.cause)) {
      return error.cause.bodyText ?? error.cause.message;
    }
    return error.cause.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function inferLlmFailureCategory(error: unknown, status: number | undefined): ErrorCategory | undefined {
  if (isProviderEmptyStreamError(error)) {
    return 'empty_stream';
  }
  if (error instanceof ProviderTimeoutError) {
    return 'network_error';
  }
  if (status === 401 || status === 403) {
    return 'auth_error';
  }
  if (status === 429 || status === 402) {
    return 'rate_limit';
  }
  if (status === 529 || status === 503) {
    return 'overloaded';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'server_error';
  }
  const wire = isProviderWireFailureError(error) ? error : undefined;
  const raw = `${error instanceof Error ? `${error.message} ${error.name}` : String(error)} ${wire?.bodyText ?? ''}`.toLowerCase();
  if (raw.includes('quota') || raw.includes('rate_limit') || (raw.includes('rate') && raw.includes('limit'))) {
    return 'rate_limit';
  }
  if (
    raw.includes('overloaded')
    || raw.includes('service unavailable')
    || raw.includes('at capacity')
    || raw.includes('high demand')
  ) {
    return 'overloaded';
  }
  if (
    raw.includes('econnrefused')
    || raw.includes('econnreset')
    || raw.includes('etimedout')
    || raw.includes('enotfound')
    || raw.includes('timeout')
    || raw.includes('socket')
    || raw.includes('network')
  ) {
    return 'network_error';
  }
  return undefined;
}

function llmFailureKind(
  category: ErrorCategory | undefined,
  status: number | undefined,
  error: unknown,
): LlmFailureClass {
  if (category === 'empty_stream' || isProviderEmptyStreamError(error)) {
    return 'empty_stream';
  }
  if (category === 'auth_error' || status === 401 || status === 403) {
    return 'auth';
  }
  if (category === 'rate_limit' || status === 429 || status === 402) {
    return 'quota';
  }
  if (category === 'overloaded') {
    return 'overloaded';
  }
  if (category === 'server_error') {
    return 'server';
  }
  if (status === 529 || status === 503) {
    return 'overloaded';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'server';
  }
  if (category === 'network_error') {
    return 'network';
  }
  return 'generic';
}

function extractStatusFromMessage(error: unknown): number | undefined {
  const raw = error instanceof Error ? error.message : String(error);
  const match = raw.match(/\b(4\d{2}|5\d{2})\b/);
  if (!match) {
    return undefined;
  }
  const code = Number(match[1]);
  return Number.isNaN(code) ? undefined : code;
}

function llmRequestFailureUserMessage(
  label: string,
  providerId: string,
  modelId: string,
  failure: LlmRequestFailure,
): string {
  const route = `${providerId}/${modelId}`;
  switch (failure.kind) {
    case 'auth':
      return `${label} 当前使用 ${route} 时认证或权限失败。请检查该账号的 API Key、登录状态或模型访问权限后重试。`;
    case 'quota':
      return `${label} 当前使用 ${route} 时额度不足或触发了限流。请检查该账号额度、账单或稍后重试。`;
    case 'overloaded':
      return `${label} 当前使用 ${route} 时服务商过载或容量不足。请稍后重试；若持续出现，可改用更高服务等级或更换模型。`;
    case 'server':
      return `${label} 当前使用 ${route} 时服务商返回了服务端错误${failure.status ? `（HTTP ${failure.status}）` : ''}。请稍后重试。`;
    case 'empty_stream':
      return `${label} 当前使用 ${route} 时，服务商没有返回助手正文或结构化工具调用。请稍后重试；若持续出现，请检查该模型或更换模型。`;
    case 'network':
      return `${label} 当前使用 ${route} 时网络连接失败。请检查网络、代理或服务商可达性后重试。`;
    default:
      return `模型请求失败：${label} 当前使用 ${route}，但服务商请求没有成功。请检查该账号、模型权限、额度或网络状态后重试。`;
  }
}

function formatLlmFailureTechnicalMessage(failure: LlmRequestFailure): string {
  const snippet = redactRecoverySnippet(failure.snippet);
  return `provider HTTP ${failure.status ?? 'n/a'} · attempts ${failure.attempts}/${failure.maxAttempts} · ${snippet}`;
}
