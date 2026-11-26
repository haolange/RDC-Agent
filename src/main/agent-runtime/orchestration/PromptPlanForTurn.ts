/**
 * PromptPlanForTurn — build PromptPlan for Debug sendMessage / profile turns.
 */

import { isTopLevelAgentId } from '@shared/types/agent';
import { AGENT_DESCRIPTIONS, AGENT_DISPLAY_NAMES } from '@shared/constants/agents';
import { resolveAgentRouteCapability } from '../capabilities/RouteCapabilityResolver';
import { appPathService } from '../../runtime/AppPathService';
import { agentManifestService } from '../../settings/agent-manifests/AgentManifestService';
import { settingsService } from '../../settings/settings-core/SettingsService';
import { buildTurnPromptPlan } from './TurnPromptPlan';
import type { EffectiveRuntimePlan } from '../EffectiveRuntimePlan';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AgentId, AgentRole } from '@shared/types/agent';

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
    requestPlan: RequestPlan;
    systemPrompt?: string;
    messageText?: string;
    preloadSkillIds?: string[];
    extraSegments?: import('@shared/types/rdcRuntime').PromptSegment[];
    /** Exact effective profile snapshot resolved by the caller. */
    effectiveProfile?: AgentManifestDefinition | null;
    /** Same resolved catalog used by the caller; absent means only this profile is known. */
    effectiveProfiles?: readonly AgentManifestDefinition[];
    /**
     * Same-turn frozen plan. When present, permission / profileSkills / toolAllowlist
     * come from the plan — never re-read settings for those execution semantics.
     */
    effectivePlan?: Pick<
      EffectiveRuntimePlan,
      'permissionConstraints' | 'profileSkills' | 'toolAllowlist' | 'projectRootPath'
    >;
  }): PromptPlan | null {
    const plan = input.effectivePlan;
    const profiles =
      input.effectiveProfiles ??
      (input.effectiveProfile
        ? [input.effectiveProfile]
        : agentManifestService.getEffectiveProfiles(
            appPathService.getRuntimePaths(),
            plan?.projectRootPath ?? input.projectRootPath ?? undefined,
          ));
    const definition =
      input.effectiveProfile ?? profiles.find((profile) => profile.id === input.agentId && profile.enabled) ?? null;
    if (!definition || !definition.enabled) {
      return null;
    }
    const provider = settingsService.providerConnections.get(input.providerId);
    return buildTurnPromptPlan({
      agentId: input.agentId,
      profile: definition,
      profileCatalog: profiles,
      profileSkills: plan ? plan.profileSkills : definition.skills,
      ...(input.systemPrompt ? { instructions: input.systemPrompt } : {}),
      baseTools: plan ? plan.toolAllowlist : input.toolAllowlist,
      projectRootPath: plan?.projectRootPath ?? input.projectRootPath,
      sessionId: input.sessionId ?? null,
      messageText: input.messageText ?? '',
      pendingSkillIds: input.preloadSkillIds,
      permissionConstraints: plan?.permissionConstraints ?? settingsService.snapshot().user.agentRuntime.permissions,
      routeCapability: resolveAgentRouteCapability(provider, input.modelId, input.capability),
      requestPlan: input.requestPlan,
      contextWindowTokens: input.contextWindowTokens,
      extraSegments: input.extraSegments,
    }).promptPlan;
  }
}
