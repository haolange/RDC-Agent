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
import type { PromptPlan, EffectiveAgentProfile } from '@shared/types/rdcRuntime';
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
import { normalizeToolName } from '../agent-runtime/orchestration/RuntimeToolPolicy';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
import { settingsService } from '../settings/settings-core/SettingsService';
import { agentManifestService } from '../settings/agent-manifests/AgentManifestService';
import { resolveEffectiveModelSelection } from '../settings/provider-catalog/EffectiveModelResolver';
import { runtimeLogService } from '../runtime/RuntimeLogService';

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

export interface ResolvedConversationContext {
  planSource?: { reference: import('@shared/types/planReview').PlanReadRequest; markdown: string };
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
  return normalized !== 'ask_user' && normalized !== 'plan_artifact';
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
    title: `${diagnostic.agentId ?? 'unknown-agent'} -> ${diagnostic.providerId ?? 'route missing'}${diagnostic.modelId ? `/${diagnostic.modelId}` : ''}`,
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
