/**
 * PromptPlanForTurn — build PromptPlan for Debug sendMessage / profile turns.
 */

import type { AgentId, AgentRole } from '@shared/types/agent';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import { isTopLevelAgentId } from '@shared/types/agent';
import {
  AGENT_DESCRIPTIONS,
  AGENT_DISPLAY_NAMES,
} from '@shared/constants/agents';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { PromptPlan } from '@shared/types/rdxRuntime';
import { mergeTurnPreloadSkillIds } from '@shared/utils/turnSkillRefs';
import type { EffectiveRuntimePlan } from '../../agent-runtime/EffectiveRuntimePlan';
import { promptPlanBuilder, resolvePromptClock } from '../../agent-runtime/prompt';
import { resolveAgentRouteCapability } from '../../agent-runtime/capabilities/RouteCapabilityResolver';
import { appPathService } from '../../runtime/AppPathService';
import { scopedInstructionResolver } from '../../runtime/ScopedInstructionResolver';
import { agentManifestService } from '../../settings/AgentManifestService';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import { settingsService } from '../../settings/SettingsService';
import { normalizeToolName } from './DebuggerRuntimePolicy';

export class PromptPlanForTurn {
  systemPromptForAgent(agentId: AgentRole, prompt?: string): string {
    if (prompt) {
      return prompt;
    }
    const topLevelAgentId: AgentId | null = isTopLevelAgentId(agentId) ? agentId : null;
    return topLevelAgentId
      ? `You are the ${AGENT_DISPLAY_NAMES[topLevelAgentId]}. ${AGENT_DESCRIPTIONS[topLevelAgentId]}`
      : `You are ${agentId}. Follow the active .agent.md profile and report evidence clearly.`;
  }

  buildPromptPlanForAgentTurn(input: {
    agentId: AgentRole;
    projectRootPath: string | null;
    sessionId?: string | null;
    providerId: string;
    modelId: string;
    toolAllowlist: string[];
    contextWindowTokens: number;
    capability: EffectiveModel;
    systemPrompt?: string;
    messageText?: string;
    preloadSkillIds?: string[];
    /** Exact effective profile snapshot resolved by the caller. */
    effectiveProfile?: AgentManifestDefinition | null;
    /**
     * Same-turn frozen plan. When present, permission / profileSkills / toolAllowlist
     * come from the plan — never re-read settings for those execution semantics.
     */
    effectivePlan?: Pick<
      EffectiveRuntimePlan,
      'permissionSettings' | 'profileSkills' | 'toolAllowlist' | 'projectRootPath'
    >;
  }): PromptPlan | null {
    const plan = input.effectivePlan;
    const runtimeSettings = settingsService.getAll();
    const definition = input.effectiveProfile
      ?? agentManifestService.getEffectiveProfiles(
        runtimeSettings.paths,
        runtimeSettings.llm.providers,
        runtimeSettings.llm.agentRoutes,
        (plan?.projectRootPath ?? input.projectRootPath) ?? undefined,
      ).find((profile) => profile.id === input.agentId && profile.enabled)
      ?? null;
    if (!definition || !definition.enabled) {
      return null;
    }
    const profileSkills = plan ? [...plan.profileSkills] : definition.skills;
    const activeDefinition = input.systemPrompt
      ? { ...definition, instructions: input.systemPrompt, skills: profileSkills }
      : { ...definition, skills: profileSkills };

    const provider = runtimeSettings.llm.providers.find((entry) => entry.id === input.providerId);
    const routeCapability = resolveAgentRouteCapability(provider, input.modelId, input.capability);
    const projectRootPath = plan?.projectRootPath ?? input.projectRootPath;
    const activePaths = [projectRootPath].filter((value): value is string => Boolean(value));
    const scopedInstructions = projectRootPath
      ? scopedInstructionResolver.resolveForPaths({
          userInstructionsPath: appPathService.getUserRdxPaths().instructionsPath,
          projectRoot: projectRootPath,
          activePaths,
        })
      : { sources: [], totalBytes: 0, diagnostics: [] };
    const preloadSkillIds = mergeTurnPreloadSkillIds({
      profileSkills,
      messageText: input.messageText ?? '',
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
    const tools = (plan ? [...plan.toolAllowlist] : input.toolAllowlist)
      .map((toolName) => normalizeToolName(toolName));
    const permissionSettings = plan?.permissionSettings ?? runtimeSettings.agentRuntime.permissions;
    const promptClock = resolvePromptClock();
    return promptPlanBuilder.build({
      profile: activeDefinition,
      scopedInstructions,
      preloadedSkills,
      skillCatalog: agentRuntimeConfigService.listSkillMetadata(projectRootPath ?? undefined),
      tools,
      workDir: projectRootPath ?? '',
      sessionId: input.sessionId ?? null,
      routeCapability,
      effectiveModel: input.capability,
      permissionSettings,
      currentDate: promptClock.currentDate,
      timeZone: promptClock.timeZone,
      contextWindowTokens: input.contextWindowTokens,
    });
  }
}
