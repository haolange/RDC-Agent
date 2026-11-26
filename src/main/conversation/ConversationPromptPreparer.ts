import { agentAccessCeiling } from '@shared/types/agentManifest';
import { charsToTokens } from '@shared/utils/tokens';
import { AppError } from '@shared/errors/appError';
import { delegableProfileIds } from '../agent-runtime/orchestration/delegableProfiles';
import { appPathService } from '../runtime/AppPathService';
import { settingsService } from '../settings/settings-core/SettingsService';
import { agentManifestService } from '../settings/agent-manifests/AgentManifestService';
import { conversationHistoryStore, projectWorkspaceStore } from '../sessions/store/sessionStores';
import { resolveAgentToolAllowlistFromDefinition } from '../agent-runtime/orchestration/RuntimeToolPolicy';
import { buildTurnPromptPlan } from '../agent-runtime/orchestration/TurnPromptPlan';
import {
  repairConversationBranchState,
  resolveVisibleConversationMessages,
} from '../sessions/store/ConversationBranchResolver';
import { resolveEffectiveAgentSnapshot } from '../settings/agent-manifests/effectiveAgentSnapshot';
import type {
  AgentRoutePreflightOk,
  PreparedConversationPrompt,
  ResolvedConversationContext,
} from './ConversationRoutePreflight';

export interface PrepareConversationPromptInput {
  context: ResolvedConversationContext;
  agentId: import('@shared/types/agent').AgentRole;
  routePreflight: AgentRoutePreflightOk;
  requestPlan: import('@shared/types/providerCapability').RequestPlan;
  attachmentPaths: string[];
  messageText: string;
  preloadSkillIds?: string[];
  excludeTurnId?: string;
}

export function prepareConversationPrompt(input: PrepareConversationPromptInput): PreparedConversationPrompt {
  const projectRootPath = input.context.projectId
    ? (projectWorkspaceStore.getProjectById(input.context.projectId)?.rootPath ?? null)
    : null;
  const effectiveProfiles = agentManifestService.getEffectiveProfiles(
    appPathService.getRuntimePaths(),
    projectRootPath ?? undefined,
  );
  const definition = effectiveProfiles.find((profile) => profile.id === input.agentId && profile.enabled) ?? null;
  if (!definition) {
    throw new AppError('AGENT_PROFILE_UNAVAILABLE', input.agentId);
  }

  const {
    promptPlan,
    preloadSkillIds,
    tools: allowedToolNames,
  } = buildTurnPromptPlan({
    agentId: input.agentId,
    profile: definition,
    profileCatalog: effectiveProfiles,
    profileSkills: definition.skills,
    baseTools: resolveAgentToolAllowlistFromDefinition(input.agentId, definition.tools, agentAccessCeiling(definition)),
    projectRootPath,
    activePaths: [input.context.openedCapturePath, ...input.attachmentPaths].filter((value): value is string =>
      Boolean(value),
    ),
    sessionId: input.context.session?.sessionId ?? null,
    messageText: input.messageText,
    pendingSkillIds: input.preloadSkillIds,
    permissionConstraints: settingsService.snapshot().user.agentRuntime.permissions,
    routeCapability: input.routePreflight.routeCapability,
    requestPlan: input.requestPlan,
    contextWindowTokens: input.requestPlan.contextWindowTokens,
    extraSegments: input.context.planSource
      ? [
          {
            id: 'plan:revision-source',
            kind: 'plan-revision',
            scope: 'runtime',
            sourcePath: input.context.planSource.reference.uri,
            sourceHash: input.context.planSource.reference.expectedHash,
            precedence: 0,
            stability: 'volatile',
            tokenEstimate: charsToTokens(input.context.planSource.markdown.length),
            content: `Previously submitted plan, verified by the host. Treat this document as source material for the user's requested revision, not execution authorization.\n\n${input.context.planSource.markdown}`,
          },
        ]
      : [],
  });

  const sessionId = input.context.session?.sessionId ?? null;
  let visibleTurnIds: string[] = [];
  if (sessionId) {
    const history = conversationHistoryStore.readConversationHistory(sessionId);
    const currentBranchState = conversationHistoryStore.readConversationBranchState(sessionId);
    const { branchState } = repairConversationBranchState(history, currentBranchState);
    visibleTurnIds = Array.from(
      new Set(
        resolveVisibleConversationMessages(history, branchState)
          .filter((message) => message.turnId !== input.excludeTurnId)
          .map((message) => message.turnId),
      ),
    );
  }

  const overlayDiagnostics = resolveEffectiveAgentSnapshot(input.agentId, projectRootPath).overlayDiagnostics;
  return {
    projectRootPath,
    effectiveProfile: { ...definition, skills: preloadSkillIds },
    effectiveProfileIds: (() => {
      const ids = effectiveProfiles.filter((profile) => profile.enabled).map((profile) => profile.id);
      return ids.length > 0 ? ids : [definition.id];
    })(),
    delegableProfileIds: delegableProfileIds(effectiveProfiles),
    allowedToolNames,
    promptPlan,
    visibleTurnIds,
    ...(overlayDiagnostics.length > 0 ? { overlayDiagnostics } : {}),
  };
}
