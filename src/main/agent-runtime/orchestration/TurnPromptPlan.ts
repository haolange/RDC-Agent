import { mergeTurnPreloadSkillIds } from '@shared/utils/turnSkillRefs';
import { AppError } from '@shared/errors/appError';
import { approvedExecutionOfferForAgent } from '../../sessions/run/handoffSkills';
import { appPathService } from '../../runtime/AppPathService';
import { scopedInstructionResolver } from '../../runtime/ScopedInstructionResolver';
import { agentRuntimeConfigService } from '../../settings/agent-manifests/AgentRuntimeConfigService';
import { promptPlanBuilder, resolvePromptClock } from '../prompt';
import { combineActiveSkillAllowlists, normalizeToolName } from './RuntimeToolPolicy';
import type { AgentPermissionSettings } from '@shared/types/settings';
import type { PromptPlan, PromptSegment } from '@shared/types/rdcRuntime';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { AgentRole } from '@shared/types/agent';

export interface TurnPromptPlanInput {
  agentId: AgentRole;
  /** The resolved, enabled profile; its instructions may be replaced by `instructions`. */
  profile: AgentManifestDefinition;
  profileCatalog: readonly AgentManifestDefinition[];
  /** Skills the profile preloads: the frozen plan's when one exists, otherwise the profile's own. */
  profileSkills: readonly string[];
  instructions?: string;
  /** Tools the profile may use under its ceiling, before active skills narrow them. */
  baseTools: readonly string[];
  projectRootPath: string | null;
  /** Files the turn touches beyond the project root (an open capture, attachments), for scoped instructions. */
  activePaths?: readonly string[];
  sessionId: string | null;
  messageText: string;
  pendingSkillIds?: readonly string[];
  permissionConstraints: Omit<AgentPermissionSettings, 'mode'>;
  routeCapability: AgentRouteCapability;
  requestPlan: RequestPlan;
  contextWindowTokens: number;
  extraSegments?: PromptSegment[];
}

export interface TurnPromptPlan {
  promptPlan: PromptPlan;
  /** Skills actually preloaded: profile skills, `$skill` references in the message and pending hand-off skills. */
  preloadSkillIds: string[];
  /** Tools after active skills narrowed the profile's set. */
  tools: string[];
}

/**
 * The one PromptPlan build for a turn, shared by conversation turns and profile/child turns. Callers resolve
 * the profile and its frozen facts; this resolves scoped instructions, preloads skills, narrows tools and
 * assembles the plan the same way for both.
 */
export function buildTurnPromptPlan(input: TurnPromptPlanInput): TurnPromptPlan {
  const projectRoot = input.projectRootPath ?? undefined;
  const activePaths = [input.projectRootPath, ...(input.activePaths ?? [])]
    .filter((value): value is string => Boolean(value));
  const scopedInstructions = input.projectRootPath
    ? scopedInstructionResolver.resolveForPaths({
        userInstructionsPath: appPathService.getUserRdcPaths().instructionsPath,
        projectRoot: input.projectRootPath,
        activePaths,
      })
    : { sources: [], totalBytes: 0, diagnostics: [] };
  const approvedExecutionOffer = approvedExecutionOfferForAgent(input.sessionId, input.agentId);
  const preloadSkillIds = mergeTurnPreloadSkillIds({
    profileSkills: [...input.profileSkills],
    messageText: input.messageText,
    pendingSkillIds: [...(input.pendingSkillIds ?? []), ...(approvedExecutionOffer?.requiredSkillIds ?? [])],
  });
  const preloadedSkills = preloadSkillIds.map((skillId) => {
    const skill = agentRuntimeConfigService.loadSkill(skillId, projectRoot, input.agentId);
    if (!skill) throw new AppError('SKILL_UNAVAILABLE', `skill is not configured: ${skillId}`);
    return skill;
  });
  const baseTools = input.baseTools.map((toolName) => normalizeToolName(toolName));
  const tools = combineActiveSkillAllowlists(baseTools, preloadedSkills.map((skill) => skill.allowedTools)) ?? baseTools;
  const promptClock = resolvePromptClock();
  const promptPlan = promptPlanBuilder.build({
    profile: {
      ...input.profile,
      skills: [...input.profileSkills],
      ...(input.instructions ? { instructions: input.instructions } : {}),
    },
    profileCatalog: input.profileCatalog,
    scopedInstructions,
    preloadedSkills,
    skillCatalog: agentRuntimeConfigService.listSkillMetadata(projectRoot, input.agentId),
    tools,
    workDir: input.projectRootPath ?? '',
    sessionId: input.sessionId,
    approvedExecutionOffer,
    routeCapability: input.routeCapability,
    requestPlan: input.requestPlan,
    permissionConstraints: input.permissionConstraints,
    currentDate: promptClock.currentDate,
    timeZone: promptClock.timeZone,
    contextWindowTokens: input.contextWindowTokens,
    extraSegments: input.extraSegments ?? [],
  });
  return { promptPlan, preloadSkillIds, tools };
}
