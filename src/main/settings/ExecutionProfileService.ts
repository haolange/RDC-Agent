import type { AgentRole } from '@shared/types/agent';
import { isTopLevelAgentId } from '@shared/types/agent';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AppSettings, RuntimeResourceCatalog, LlmAgentRoute, SettingsDiagnostic } from '@shared/types/settings';
import type { EffectiveAgentRuntimeConfig } from '@shared/types/profile';
import type { WorkflowStage } from '@shared/types/workflow';
import { STAGE_PHASES } from '@shared/constants/stages';
import { AGENT_CATEGORIES, AGENT_WRITE_SCOPES } from '@shared/constants/agents';
import { agentRuntimeConfigService } from './AgentRuntimeConfigService';
import { resolveEffectiveModel } from './EffectiveModelResolver';

const profileForAgent = (settings: AppSettings, agentId: AgentRole): AgentManifestDefinition | undefined =>
  settings.agents.definitions.find((definition) => definition.id === agentId && definition.enabled);

export class ExecutionProfileService {
  ensureScaffold(): void {
    agentRuntimeConfigService.ensureScaffold();
  }

  normalizeResourceCatalog(catalog: RuntimeResourceCatalog): RuntimeResourceCatalog {
    this.ensureScaffold();
    return {
      ...catalog,
      availableSkills: agentRuntimeConfigService.listSkills(),
      availableMcpServers: agentRuntimeConfigService.listMcpServers(),
    };
  }

  resolveAgentRuntimeProfile(
    settings: AppSettings,
    stage: WorkflowStage,
    agentId: AgentRole,
  ): EffectiveAgentRuntimeConfig {
    const profile = profileForAgent(settings, agentId);
    const route = this.resolveAgentRoute(settings, agentId);
    return {
      agentId,
      systemPrompt: profile?.instructions ?? `You are ${agentId}.`,
      providerId: route?.providerId ?? '',
      modelId: route?.modelId ?? '',
      temperature: 0.3,
      category: isTopLevelAgentId(agentId) ? AGENT_CATEGORIES[agentId] : 'general',
      writeScope: isTopLevelAgentId(agentId) ? AGENT_WRITE_SCOPES[agentId] : [],
      stage,
      phase: STAGE_PHASES[stage],
      toolAllowlist: profile?.tools ?? [],
      skillIds: profile?.skills ?? [],
      mcpServerIds: profile?.mcpServers ?? [],
      source: { agentProfileId: profile?.id ?? agentId },
    };
  }

  getDiagnostics(settings: AppSettings): SettingsDiagnostic[] {
    return settings.llm.providers.some((provider) => provider.isConfigured)
      ? []
      : [{
          code: 'missing_configured_provider',
          severity: 'warning',
          message: 'No configured provider is available for agent execution.',
        }];
  }

  private resolveAgentRoute(
    settings: AppSettings,
    agentId: AgentRole,
  ): LlmAgentRoute | null {
    const route = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId) ?? null;
    if (!route?.providerId || !route.modelId) return null;
    const provider = settings.llm.providers.find((entry) => entry.id === route.providerId);
    if (!provider?.enabled || !provider.isConfigured || provider.status !== 'verified') return null;
    const model = resolveEffectiveModel(route.providerId, route.modelId, settings);
    return model ? { ...route, modelId: model.modelId } : null;
  }
}

export const executionProfileService = new ExecutionProfileService();
