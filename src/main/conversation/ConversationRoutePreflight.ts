import { formatAgentManifestDiagnostic } from '@shared/utils/agentManifestDiagnostic';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import { isTopLevelAgentId } from '@shared/types/agent';
import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import { nowMs } from '@shared/utils/id';
import {
  classifyAgentToolEligibility,
  describeAgentToolIneligibility,
  isAgentToolExecutableModel,
} from '@shared/utils/agentToolCapability';
import { AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { AppError } from '@shared/errors/appError';
import { normalizeToolName } from '../agent-runtime/orchestration/RuntimeToolPolicy';
import { resolveAgentRouteCapability } from '../agent-runtime/capabilities/RouteCapabilityResolver';
import { appPathService } from '../runtime/AppPathService';
import { settingsService } from '../settings/settings-core/SettingsService';
import { agentManifestService } from '../settings/agent-manifests/AgentManifestService';
import { resolveEffectiveAgentSnapshot, resolveEnabledAgentDefinition } from '../settings/agent-manifests/effectiveAgentSnapshot';
import { resolveEffectiveModelSelection } from '../settings/provider-catalog/EffectiveModelResolver';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { diagnosticText } from './diagnosticText';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type {
  OpenedCaptureState,
  ProjectInputRecord,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { EffectiveAgentProfile } from '../settings/agent-manifests/agentRuntimeTypes';
import type { AgentRouteCapability, AgentEvent } from '@shared/types/agentRuntime';
import type { AgentRole } from '@shared/types/agent';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type {
  ConversationMessage,
  ConversationMessageDiagnostic,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { AgentManifestDiagnostic } from '@shared/types/agentManifest';

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
  /** Revise only: the verified rejected plan, sent to the planner as runtime material. */
  planSource?: { reference: import('@shared/types/planReview').PlanReadRequest; markdown: string };
  /** The verified plan the user message executes or revises; persisted on that message. */
  planReference?: import('@shared/types/planReview').ConversationPlanReference;
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
  /** Profiles other agents may hand work to (enabled, not `disable-model-invocation`). */
  delegableProfileIds: string[];
  allowedToolNames: string[];
  promptPlan: PromptPlan;
  visibleTurnIds: string[];
  overlayDiagnostics?: AgentManifestDiagnostic[];
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
  throw new AppError(
    'CONVERSATION_AGENT_UNAVAILABLE', `default profile \`${DEFAULT_AGENT_ID}\` is not enabled.`,
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
    /** From `conversationTurnIds(requestId)`: main and the renderer name a request's messages alike. */
    id: string;
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
    planReference?: ConversationMessage['planReference'];
  },
): ConversationMessage {
  const createdAt = nowMs();
  return {
    id: options.id,
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
    ...(options.planReference ? { planReference: options.planReference } : {}),
    createdAt,
  };
}

export function findEffectiveAgentProfile(agentId: string, projectRootPath?: string | null) {
  const snapshot = agentManifestService.resolveEffectiveSnapshot(
    appPathService.getRuntimePaths(),
    projectRootPath ?? undefined,
  );
  const profile = snapshot.profiles.find((entry) => entry.id === agentId) ?? null;
  return {
    found: Boolean(profile),
    enabled: Boolean(profile?.enabled),
    profile,
  };
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
  overlayDiagnostics?: AgentManifestDiagnostic[];
  aliasRemap?: { from: string; to: string };
}

export interface AgentRoutePreflightBlocked {
  ok: false;
  diagnostic: ConversationMessageDiagnostic;
  overlayDiagnostics?: AgentManifestDiagnostic[];
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
  const providers = settingsService.providerConnections;
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
        userMessage: diagnosticText('routeMissing', { agent: label }),
      }),
    });
  }

  const provider = providers.get(providerId);
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return withOverlay({
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE',
        severity: 'error',
        userMessage: diagnosticText('providerUnavailable', { agent: label, provider: providerId }),
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
        userMessage: diagnosticText('providerUnverified', { agent: label, provider: providerId }),
        providerId,
        modelId,
        technicalMessage: provider.lastError ?? provider.unavailableReason,
      }),
    });
  }

  const selection = resolveEffectiveModelSelection(providerId, modelId, providers);
  const effectiveModel = selection.model;
  if (!effectiveModel) {
    const recommendationText = selection.recommendations.map((entry) => entry.modelId).join(', ');
    return withOverlay({
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: 'CONVERSATION_LLM_ROUTE_MISSING',
        severity: 'warning',
        userMessage: diagnosticText('modelUnavailable', { agent: label, model: modelId }),
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
          userMessage: diagnosticText('modelNotExecutable', { agent: label, model: effectiveModelId }),
          technicalMessage: `MODEL_UNAVAILABLE: ${providerId}/${effectiveModelId} is not Agent-executable.`,
        }
      : describeAgentToolIneligibility(eligibility, providerId, effectiveModelId);
    const recommendationText = selection.recommendations.map((entry) => entry.modelId).join(', ');
    return withOverlay({
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        // Unknown availability is a catalog state, not a tools verdict; keep them apart for the UI and logs.
        code: eligibility === 'availability-unknown'
          ? 'CONVERSATION_LLM_MODEL_AVAILABILITY_UNVERIFIED'
          : 'CONVERSATION_LLM_TOOLS_UNAVAILABLE',
        severity: 'warning',
        userMessage: recommendationText
          ? diagnosticText('modelAlternatives', { reason: detail.userMessage, alternatives: recommendationText })
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
  overlayDiagnostics: AgentManifestDiagnostic[] | undefined,
  continuedWithLowerScope: boolean,
): void {
  if (!overlayDiagnostics?.length) return;
  for (const entry of overlayDiagnostics) {
    recordLlmDiagnostic(context, createConversationDiagnostic({
      agentId,
      code: 'CONVERSATION_PROFILE_OVERLAY_INVALID',
      severity: 'warning',
      userMessage: diagnosticText(continuedWithLowerScope ? 'profileOverrideFallback' : 'profileOverrideBlocked', {
        scope: diagnosticText(entry.scope === 'user' ? 'scopeUser' : 'scopeProject'),
        detail: formatAgentManifestDiagnostic(entry),
      }),
      technicalMessage: formatAgentManifestDiagnostic(entry),
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
