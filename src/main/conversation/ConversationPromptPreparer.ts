import { agentAccessCeiling } from '@shared/types/agentManifest';
import { approvedExecutionOfferForAgent } from '../sessions/handoffSkills';
import { charsToTokens } from '@shared/utils/tokens';
import { mergeTurnPreloadSkillIds } from '@shared/utils/turnSkillRefs';
import { promptPlanBuilder, resolvePromptClock } from '../agent-runtime/prompt';
import { settingsService } from '../settings/SettingsService';
import { agentManifestService } from '../settings/AgentManifestService';
import { agentRuntimeConfigService } from '../settings/AgentRuntimeConfigService';
import { scopedInstructionResolver } from '../runtime/ScopedInstructionResolver';
import { appPathService } from '../runtime/AppPathService';
import { storageAdapter } from '../sessions/StorageAdapter';
import { combineActiveSkillAllowlists, normalizeToolName, resolveAgentToolAllowlistFromDefinition } from '../workflow/debugger/DebuggerRuntimePolicy';
import { repairConversationBranchState, resolveVisibleConversationMessages } from './ConversationBranchResolver';
import type {
  AgentRoutePreflightOk,
  PreparedConversationPrompt,
  ResolvedConversationContext,
} from './ConversationRoutePreflight';
import { resolveEffectiveAgentSnapshot } from './ConversationRoutePreflight';

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

  let allowedToolNames = resolveAgentToolAllowlistFromDefinition(input.agentId, definition.tools, agentAccessCeiling(definition))
    .map((toolName) => normalizeToolName(toolName));
  const activePaths = [
    projectRootPath,
    input.context.openedCapturePath,
    ...input.attachmentPaths,
  ].filter((value): value is string => Boolean(value));
  const scopedInstructions = projectRootPath
    ? scopedInstructionResolver.resolveForPaths({
        userInstructionsPath: appPathService.getUserRdcPaths().instructionsPath,
        projectRoot: projectRootPath,
        activePaths,
      })
    : { sources: [], totalBytes: 0, diagnostics: [] };
  const approvedExecutionOffer = approvedExecutionOfferForAgent(input.context.session?.sessionId, input.agentId);
  const preloadSkillIds = mergeTurnPreloadSkillIds({
    profileSkills: definition.skills,
    messageText: input.messageText,
    pendingSkillIds: [...(input.preloadSkillIds ?? []), ...(approvedExecutionOffer?.requiredSkillIds ?? [])],
  });
  const preloadedSkills = [];
  for (const skillId of preloadSkillIds) {
    const skill = agentRuntimeConfigService.loadSkill(skillId, projectRootPath ?? undefined, input.agentId);
    if (!skill) {
      throw new Error(`SKILL_UNAVAILABLE: skill is not configured: ${skillId}`);
    }
    preloadedSkills.push(skill);
  }
  allowedToolNames = combineActiveSkillAllowlists(allowedToolNames, preloadedSkills.map(skill => skill.allowedTools ?? [])) ?? allowedToolNames;
  const promptClock = resolvePromptClock();
  const promptPlan = promptPlanBuilder.build({
    extraSegments: input.context.planSource ? [{ id: 'plan:revision-source', kind: 'plan-revision', scope: 'runtime',
      sourcePath: input.context.planSource.reference.uri, sourceHash: input.context.planSource.reference.expectedHash,
      precedence: 0, stability: 'volatile', tokenEstimate: charsToTokens(input.context.planSource.markdown.length),
      content: `Previously submitted plan, verified by the host. Treat this document as source material for the user's requested revision, not execution authorization.\n\n${input.context.planSource.markdown}` }] : [],
    profile: definition,
    profileCatalog: effectiveProfiles,
    scopedInstructions,
    preloadedSkills,
    skillCatalog: agentRuntimeConfigService.listSkillMetadata(projectRootPath ?? undefined, input.agentId),
    tools: allowedToolNames,
    workDir: projectRootPath ?? '',
    sessionId: input.context.session?.sessionId ?? null,
    approvedExecutionOffer,
    routeCapability: input.routePreflight.routeCapability,
    effectiveModel: input.effectiveModel ?? undefined,
    requestPlan: input.requestPlan,
    permissionConstraints: runtimeSettings.agentRuntime.permissions,
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

  const overlayDiagnostics = resolveEffectiveAgentSnapshot(input.agentId, projectRootPath).overlayDiagnostics;
  return {
    projectRootPath,
    effectiveProfile: { ...definition, skills: preloadSkillIds },
    effectiveProfileIds: (() => {
      const ids = effectiveProfiles.filter((profile) => profile.enabled).map((profile) => profile.id);
      return ids.length > 0 ? ids : [definition.id];
    })(),
    allowedToolNames,
    promptPlan,
    visibleTurnIds,
    ...(overlayDiagnostics.length > 0 ? { overlayDiagnostics } : {}),
  };
}
