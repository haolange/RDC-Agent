import { mergeTurnPreloadSkillIds } from '@shared/utils/turnSkillRefs';
import { promptPlanBuilder, resolvePromptClock } from '../agent-runtime/prompt';
import { settingsService } from '../settings/SettingsService';
import { agentManifestService } from '../settings/AgentManifestService';
import { agentRuntimeConfigService } from '../settings/AgentRuntimeConfigService';
import { scopedInstructionResolver } from '../runtime/ScopedInstructionResolver';
import { appPathService } from '../runtime/AppPathService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { normalizeToolName, resolveAgentToolAllowlistFromDefinition } from '../workflow/debugger/DebuggerRuntimePolicy';
import { repairConversationBranchState, resolveVisibleConversationMessages } from './ConversationBranchResolver';
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
  effectiveModel: import('@shared/types/providerCapability').EffectiveModel | null;
  attachmentPaths: string[];
  messageText: string;
  preloadSkillIds?: string[];
  excludeTurnId?: string;
}

export function prepareConversationPrompt(input: PrepareConversationPromptInput): PreparedConversationPrompt {
  const projectRootPath = input.context.projectId
    ? storageAdapter.getProjectById(input.context.projectId)?.rootPath ?? null
    : null;
  const runtimeSettings = settingsService.getAll();
  const effectiveProfiles = agentManifestService.getEffectiveProfiles(
    runtimeSettings.paths,
    runtimeSettings.llm.providers,
    runtimeSettings.llm.agentRoutes,
    projectRootPath ?? undefined,
  );
  const definition = effectiveProfiles.find((profile) => profile.id === input.agentId && profile.enabled) ?? null;
  if (!definition) {
    throw new Error(`AGENT_PROFILE_UNAVAILABLE: ${input.agentId}`);
  }

  const allowedToolNames = resolveAgentToolAllowlistFromDefinition(input.agentId, definition.tools)
    .map((toolName) => normalizeToolName(toolName));
  const activePaths = [
    projectRootPath,
    input.context.openedCapturePath,
    ...input.attachmentPaths,
  ].filter((value): value is string => Boolean(value));
  const scopedInstructions = projectRootPath
    ? scopedInstructionResolver.resolveForPaths({
        userInstructionsPath: appPathService.getUserRdxPaths().instructionsPath,
        projectRoot: projectRootPath,
        activePaths,
      })
    : { sources: [], totalBytes: 0, diagnostics: [] };
  const preloadSkillIds = mergeTurnPreloadSkillIds({
    profileSkills: definition.skills,
    messageText: input.messageText,
    pendingSkillIds: input.preloadSkillIds,
  });
  const preloadedSkills = [];
  for (const skillId of preloadSkillIds) {
    const skill = agentRuntimeConfigService.loadSkill(skillId, projectRootPath ?? undefined);
    if (!skill) {
      throw new Error(`SKILL_UNAVAILABLE: skill is not configured: ${skillId}`);
    }
    preloadedSkills.push(skill);
  }
  const promptClock = resolvePromptClock();
  const promptPlan = promptPlanBuilder.build({
    profile: definition,
    scopedInstructions,
    preloadedSkills,
    skillCatalog: agentRuntimeConfigService.listSkillMetadata(projectRootPath ?? undefined),
    tools: allowedToolNames,
    workDir: projectRootPath ?? '',
    routeCapability: input.routePreflight.routeCapability,
    effectiveModel: input.effectiveModel ?? undefined,
    permissionSettings: runtimeSettings.agentRuntime.permissions,
    currentDate: promptClock.currentDate,
    timeZone: promptClock.timeZone,
    contextWindowTokens: input.requestPlan.contextWindowTokens,
  });

  const sessionId = input.context.session?.sessionId ?? null;
  let visibleTurnIds: string[] = [];
  if (sessionId) {
    const history = storageAdapter.readConversationHistory(sessionId);
    const currentBranchState = storageAdapter.readConversationBranchState(sessionId);
    const { branchState } = repairConversationBranchState(history, currentBranchState);
    visibleTurnIds = Array.from(new Set(
      resolveVisibleConversationMessages(history, branchState)
        .filter((message) => message.turnId !== input.excludeTurnId)
        .map((message) => message.turnId),
    ));
  }

  return {
    projectRootPath,
    effectiveProfile: definition,
    effectiveProfileIds: (() => {
      const ids = effectiveProfiles.filter((profile) => profile.enabled).map((profile) => profile.id);
      return ids.length > 0 ? ids : [definition.id];
    })(),
    allowedToolNames,
    promptPlan,
    visibleTurnIds,
  };
}
